'use strict';

/* Koleksiyon kumaş kartları: kumaş kodu → kısa özet (TR + EN) + ayrıntı.
 *
 * PLM "Main Fabric Information" metni satırda olduğu gibi kalır (veri kaybı
 * yok); bu sözlük yalnız GÖRÜNÜMÜ kısaltır. Kart bir kez oluşturulduktan
 * sonra aynı kodlu her model onu kullanır; LCW AI'a tekrar sorulmaz.
 * Sözlük, PLM çeviri sözlüğü (plm-translations.js) gibi tüm Koleksiyon
 * kullanıcıları için ortaktır ve revizyonla korunur. */
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteJsonAsync } = require('../user-data');
const { RevisionConflictError, expectedNumber } = require('../db');
const { readJsonWithValidatedBackup, readJsonWithValidatedBackupAsync } = require('./safe-json-read');
const { withFileLeaseAsync } = require('./shared-file-transaction');
const fabricEngine = require('../../public/fabric-cards-engine');
const fabricSegments = require('../../public/fabric-card-segments');

const FILE = path.join(SERVER_DATA_ROOT, 'fabric-cards.json');
const MAX_CARDS = 20000;
const SUMMARY_MAX = Infinity;
const DETAIL_MAX = Infinity;
const RAW_MAX = 4000;
const DETAIL_FIELDS = Object.freeze(['category', 'type', 'yarn', 'weight', 'composition', 'finish', 'sustainability']);
const SOURCES = new Set(['ai', 'rule', 'manual']);
const DELTA_COLLECTION = 'fabric-card';
let deltaStore = null;
function attachDeltaStore(store) { deltaStore = store || null; }

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeCode(value) {
  const text = clean(value, 20);
  return /^\d{3,12}$/.test(text) ? text : '';
}
function actorName(actor) { return clean(actor && (actor.displayName || actor.username || actor.id), 160); }
function emptyStore() {
  return { schemaVersion: 1, cards: {}, _revision: 0, _updatedAt: null };
}
function normalizeCard(raw, fallbackCode = '', { strictSegments = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const code = normalizeCode(raw.code || fallbackCode);
  const segmented = raw.summarySegments && typeof raw.summarySegments === 'object' ? raw.summarySegments : null;
  const checked = segmented ? fabricSegments.validatePair(segmented.tr, segmented.en) : null;
  if (strictSegments && segmented && !checked.ok) {
    throw Object.assign(new Error('Geçersiz kumaş özeti parçaları. / Invalid fabric summary segments.'), { code:checked.code, statusCode:422 });
  }
  const structured = checked && checked.ok;
  const summary = fabricEngine.normalizeSummaryPolyester(fabricEngine.normalizeComposition(clean(structured ? fabricSegments.compose(checked.tr) : raw.summary, SUMMARY_MAX)), 'tr');
  const summaryEn = fabricEngine.normalizeSummaryPolyester(fabricEngine.normalizeComposition(clean(structured ? fabricSegments.compose(checked.en) : raw.summaryEn, SUMMARY_MAX)), 'en');
  if (!code || !summary) return null;
  const overrides = raw.translationOverrides && typeof raw.translationOverrides === 'object' ? raw.translationOverrides : {};
  const translationOverrides = { tr:[0,1,2,3].map(i=>Boolean(overrides.tr && overrides.tr[i])), en:[0,1,2,3].map(i=>Boolean(overrides.en && overrides.en[i])) };
  const details = {};
  for (const key of DETAIL_FIELDS) { const value=clean(raw.details && raw.details[key], DETAIL_MAX); details[key]=key==='composition'?fabricEngine.normalizeComposition(value):value; }
  const source = clean(raw.summarySource, 20);
  return {
    code,
    summary,
    summaryEn,
    ...(structured ? { summarySegments:{ tr:checked.tr, en:checked.en }, translationOverrides, segmentSourceLang:raw.segmentSourceLang==='en'?'en':'tr' } : {}),
    details,
    summarySource: SOURCES.has(source) ? source : 'manual',
    raw: clean(raw.raw, RAW_MAX),
    createdAt: clean(raw.createdAt, 80) || null,
    createdBy: clean(raw.createdBy, 160),
    updatedAt: clean(raw.updatedAt, 80) || null,
    updatedBy: clean(raw.updatedBy, 160),
    revisionId: clean(raw.revisionId, 80),
  };
}
function normalizeStore(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  out._revision = Math.max(0, Number(raw._revision) || 0);
  out._updatedAt = raw._updatedAt || null;
  out._pending = {};
  for (const [code,entry] of Object.entries(raw._pending && typeof raw._pending === 'object' ? raw._pending : {}).slice(0,MAX_CARDS)) {
    if (normalizeCode(code)!==code || !entry || typeof entry!=='object') continue;
    out._pending[code]={ card:entry.card ? normalizeCard(entry.card) : null, deleted:entry.deleted===true,
      baseRevisionId:clean(entry.baseRevisionId,80),actorId:clean(entry.actorId,160) };
  }
  const cards = raw.cards && typeof raw.cards === 'object' && !Array.isArray(raw.cards) ? raw.cards : {};
  for (const [key, item] of Object.entries(cards).slice(0, MAX_CARDS)) {
    const card = normalizeCard(item, key);
    if (card) out.cards[card.code] = card;
  }
  return out;
}
function loadFabricCards() {
  return readJsonWithValidatedBackup(FILE, {
    fallback: emptyStore,
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}
async function loadFabricCardsAsync({ recover = false, assertAuthority } = {}) {
  return readJsonWithValidatedBackupAsync(FILE, {
    fallback: emptyStore, normalize: normalizeStore,
    ...(recover ? { beforeRestore: assertAuthority, restore: value => atomicWriteJsonAsync(FILE, value) } : {}),
  });
}
/* A single shared delta record per fabric code; legacy JSON is never bulk-replicated. */
function sharedEntries() {
  const records=deltaStore && deltaStore.readAllSync(DELTA_COLLECTION);
  return records && typeof records==='object' ? records : null;
}
function mergedStore(store) {
  const remote=sharedEntries();
  if(!remote)return store;
  const visible={...store,cards:{...store.cards}};
  for(const [code,record] of Object.entries(remote)) {
    if(normalizeCode(code)!==code || !record || typeof record!=='object')continue;
    if(record.deleted===true){delete visible.cards[code];continue;}
    const card=normalizeCard(record.card,code);
    if(card)visible.cards[code]=card;
  }
  // A durable offline draft stays visible, but is never silently accepted as
  // published when a newer remote edit exists.
  for(const [code,change] of Object.entries(store._pending||{})) {
    if(change.deleted)delete visible.cards[code];
    else if(change.card)visible.cards[code]=change.card;
  }
  return visible;
}
function remoteVersion(record) {
  return String(record && (record.revisionId || (record.card && record.card.revisionId)) || '');
}
function pendingConflicts(store) {
  const remote=sharedEntries()||{},found=[];
  for(const [code,entry] of Object.entries(store._pending||{})) {
    const record=remote[code];
    if(record && remoteVersion(record)!==entry.baseRevisionId
      && !(entry.card && remoteVersion(record)===entry.card.revisionId)) {
      found.push({code,local:entry.card,remote:record.deleted?null:normalizeCard(record.card,code)});
    }
  }
  return found;
}
function sharedFingerprint() {
  const remote=sharedEntries()||{},joined=Object.keys(remote).sort().map(code=>{
    const item=remote[code];return code+':'+remoteVersion(item)+':'+Boolean(item && item.deleted);
  }).join('|');
  return crypto.createHash('sha256').update(joined).digest('hex');
}
async function seedSharedCards() {
  if(!deltaStore)return {seeded:0};
  const legacy=await loadFabricCardsAsync();
  const existing=sharedEntries()||{};
  const records=Object.fromEntries(Object.entries(legacy.cards).filter(([code])=>!Object.hasOwn(existing,code)).slice(0,120)
    .map(([code,card])=>[code,{card,deleted:false,revisionId:card.revisionId||''}]));
  return deltaStore.seedMissing(DELTA_COLLECTION,records);
}
async function flushOutbox() {
  if(!deltaStore)return {published:0,pending:true};
  const snapshot=await loadFabricCardsAsync(),pending=snapshot._pending||{},remote=sharedEntries()||{};
  let published=0;
  for(const [code,entry] of Object.entries(pending)) {
    const current=remote[code],version=remoteVersion(current);
    if(current && version!==entry.baseRevisionId && !(entry.card && version===entry.card.revisionId))continue;
    // Stage only this code. A failed delta write leaves the durable outbox intact.
    const revisionId=entry.card&&entry.card.revisionId||crypto.randomUUID();
    const changes={card:entry.deleted?null:entry.card,deleted:entry.deleted,revisionId};
    const result=await deltaStore.mirror(DELTA_COLLECTION,{[code]:changes},{userId:entry.actorId||null});
    if(!result || result.ok===false)continue;
    await withFileLeaseAsync(FILE,async()=>{
      const latest=await loadFabricCardsAsync({recover:true});
      if(JSON.stringify(latest._pending?.[code])!==JSON.stringify(entry))return;
      delete latest._pending[code];
      await atomicWriteJsonAsync(FILE,latest);
    });
    published++;
  }
  const remaining=await loadFabricCardsAsync();
  return {published,pending:Object.keys(remaining._pending||{}).length>0,conflicts:pendingConflicts(remaining)};
}
function publicCards(store = loadFabricCards()) {
  const visible=mergedStore(store);
  return { cards:Object.values(visible.cards).map(card=>({...card,details:{...card.details}})),revision:store._revision,updatedAt:store._updatedAt,
    pendingCodes:Object.keys(store._pending||{}),conflicts:pendingConflicts(store) };
}
function checkRevision(store, expectedRevision) {
  const wanted = expectedNumber(expectedRevision);
  if (wanted != null && wanted !== store._revision) throw new RevisionConflictError('Kumaş kartları', wanted, store._revision); // i18n-ignore
}
async function persist(store) {
  store._revision += 1;
  store._updatedAt = new Date().toISOString();
  await atomicWriteJsonAsync(FILE, store);
}

/* Kartları ekler/günceller. onlyMissing=true ise mevcut kart EZİLMEZ
   (otomatik oluşturma başka kullanıcının düzenlemesini bozmasın). */
function upsertFabricCards(items, actor, expectedRevision = null, { onlyMissing = false, assertAuthority } = {}) {
  return withFileLeaseAsync(FILE, async () => {
  assertAuthority?.();
  const store = await loadFabricCardsAsync({ recover: true, assertAuthority });
  checkRevision(store, expectedRevision);
  const visible=mergedStore(store);
  const now = new Date().toISOString(), by = actorName(actor);
  let updated = 0, skipped = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const card = normalizeCard(item, '', { strictSegments: true });
    if (!card) { skipped += 1; continue; }
    const current = visible.cards[card.code];
    if (current && !onlyMissing && deltaStore && Object.hasOwn(item,'expectedRevisionId') && String(item.expectedRevisionId||'')!==String(current.revisionId||''))
      throw Object.assign(new Error('Kumaş kartı değişti. / Fabric card changed.'),{code:'FABRIC_CARD_CONFLICT',statusCode:409,current});
    if (current && !onlyMissing && deltaStore && !Object.hasOwn(item,'expectedRevisionId'))
      throw Object.assign(new Error('Kart revizyonu gerekli. / Fabric card revision is required.'),{code:'FABRIC_CARD_REVISION_REQUIRED',statusCode:409,current});
    if (current && onlyMissing) { skipped += 1; continue; }
    if (!current && Object.keys(store.cards).length >= MAX_CARDS) { skipped += 1; continue; }
    if (current && current.summary === card.summary && current.summaryEn === card.summaryEn && current.summarySource === card.summarySource
      && DETAIL_FIELDS.every(key => current.details[key] === card.details[key]) && JSON.stringify(current.summarySegments||null)===JSON.stringify(card.summarySegments||null)
      && JSON.stringify(current.translationOverrides||null)===JSON.stringify(card.translationOverrides||null)
      && (current.raw === card.raw || !card.raw)) { skipped += 1; continue; }
    const updatedCard = {
      ...card,
      revisionId:crypto.randomUUID(),
      raw: card.raw || (current && current.raw) || '',
      createdAt: current && current.createdAt || now,
      createdBy: current && current.createdBy || by,
      updatedAt: now,
      updatedBy: by,
    };
    store.cards[card.code]=updatedCard;
    if(deltaStore)store._pending[card.code]={card:updatedCard,deleted:false,baseRevisionId:String(current&&current.revisionId||''),actorId:clean(actor&&actor.id,160)};
    updated += 1;
  }
  if (updated) { assertAuthority?.(); await persist(store); }
  return { ...publicCards(store), updated, skipped };
  });
}
function deleteFabricCard(code, actor, expectedRevision = null, { assertAuthority, expectedRevisionId } = {}) {
  return withFileLeaseAsync(FILE, async () => {
  assertAuthority?.();
  const store = await loadFabricCardsAsync({ recover: true, assertAuthority });
  checkRevision(store, expectedRevision);
  const key = normalizeCode(code);
  const current=mergedStore(store).cards[key];
  if (!key || !current) return { ...publicCards(store), deleted: false };
  if(deltaStore && expectedRevisionId!==undefined && String(expectedRevisionId||'')!==String(current.revisionId||''))
    throw Object.assign(new Error('Kumaş kartı değişti. / Fabric card changed.'),{code:'FABRIC_CARD_CONFLICT',statusCode:409,current});
  if(deltaStore && expectedRevisionId===undefined)
    throw Object.assign(new Error('Kart revizyonu gerekli. / Fabric card revision is required.'),{code:'FABRIC_CARD_REVISION_REQUIRED',statusCode:409,current});
  delete store.cards[key];
  if(deltaStore)store._pending[key]={card:null,deleted:true,baseRevisionId:String(current.revisionId||''),actorId:clean(actor&&actor.id,160)};
  assertAuthority?.(); await persist(store);
  return { ...publicCards(store), deleted: true, deletedBy: actorName(actor) };
  });
}

// Trusted service inverse: target records only, same native lease/CAS. This
// entry point is never exposed as raw store data or a caller-selected function.
function restoreFabricCards(before, expectedRevision, { assertAuthority } = {}) {
  return withFileLeaseAsync(FILE, async () => {
    assertAuthority?.();
    const store=await loadFabricCardsAsync({ recover: true, assertAuthority }); checkRevision(store,expectedRevision);
    if (expectedNumber(expectedRevision)==null || !before || Array.isArray(before) || Object.keys(before).length>50) throw new TypeError('Invalid fabric inverse');
    for (const [code,record] of Object.entries(before)) {
      if (normalizeCode(code)!==code || record && normalizeCard(record)?.code!==code) throw new TypeError('Invalid fabric inverse');
      if (record===null) delete store.cards[code];
      else store.cards[code]=normalizeCard(record);
    }
    assertAuthority?.(); await persist(store); return publicCards(store);
  });
}

module.exports = { FILE, DETAIL_FIELDS, SUMMARY_MAX, MAX_CARDS, DELTA_COLLECTION, attachDeltaStore, seedSharedCards, flushOutbox, mergedStore, sharedFingerprint, normalizeCode, normalizeCard, normalizeStore, loadFabricCards, loadFabricCardsAsync, publicCards, upsertFabricCards, deleteFabricCard, restoreFabricCards };
