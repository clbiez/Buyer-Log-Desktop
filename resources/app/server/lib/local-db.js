'use strict';

/*
 * Buyer Log local-first store.
 *
 * The file intentionally has a .db suffix but uses a small, dependency-free
 * JSON envelope.  This keeps the portable Node install dependency-free while
 * providing the database semantics the UI needs: journal-before-sync,
 * idempotent events, revisions, field-level merges and tombstones.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { withFileLeaseAsync, replaceFileWithRetry, assertHeldFileLeases } = require('./shared-file-transaction');
const { resolveLocalDbFolder } = require('./local-path-policy');
const { createDurableFileRecovery } = require('./durable-file-recovery');
const { jsonToBuffer, jsonSha256, jsonPreview, parseJsonBuffer, DIRECT_PARSE_MAX_BYTES } = require('./large-json');

const hybridClock = require('./hlc');
const emailClockLists = require('./hlc-email-list');
const quotationLedger = require('./quotation-ledger');

const SCHEMA_VERSION = 3;
const DEFAULT_DB_NAME = 'BuyerLogLocal.db';
const SHARED_CP_FIELDS = new Set(['dates', 'subManufacturer', 'suppFob', 'suppFobMeta']);
function compareEventOrder(a, b) {
  if (a && a.hlc && b && b.hlc) return hybridClock.compare(a.hlc, b.hlc);
  const time = String(a && a.at || '').localeCompare(String(b && b.at || ''));
  return time || (String(a && a.deviceId || '') < String(b && b.deviceId || '') ? -1 : String(a && a.deviceId || '') > String(b && b.deviceId || '') ? 1 : 0);
}

/* BİLEŞİK PAYLAŞILAN ALAN (v7.0.294). CP tarih revizyonu tek `dates`
   nesnesinde (ex / retail / mb) taşınır. Alan bütün olarak yarıştığında aynı
   satırda bir cihaz Ex-Factory'yi, öteki Retail Date'i eşzamanlı revize
   edince son yazan nesnenin tamamını yazıyor, diğer tarih SESSİZCE
   kayboluyordu. Olay artık gerçekten yazdığı alt alanları `subfields` ile
   bildirir; alıcı yalnız onları birleştirir ve alt alan başına son yazanı
   (_subfieldWriters/_subfieldOrders) tutar. `subfields` taşımayan eski sürüm
   olayı nesnenin tamamını yazar: eski davranış aynen korunur. */
const COMPOSITE_FIELDS = Object.freeze({ dates: Object.freeze(['ex', 'retail', 'mb']) });
function normalizeSubfields(patch, subfields) {
  if (!subfields || typeof subfields !== 'object' || !patch || typeof patch !== 'object') return null;
  const out = {};
  for (const [field, allowed] of Object.entries(COMPOSITE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, field) || !Array.isArray(subfields[field])) continue;
    const value = patch[field];
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) continue;
    const list = [...new Set(subfields[field].map(String))].filter(sub => allowed.includes(sub)).sort();
    if (list.length) out[field] = list;
  }
  return Object.keys(out).length ? out : null;
}
function subValue(value) { return value == null || String(value).trim() === '' ? undefined : value; }
function mergeCompositeField({ current, value, subs, allowed, writer, seen, order, ownerAllowed, wholeWriter, wholeOrder, priorWriters, priorOrders }) {
  const result = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  const incoming = value && typeof value === 'object' ? value : {};
  const subWriters = {}, subOrders = {};
  // Alt alan saatleri henüz yoksa (eski kayıt) son bütün-nesne yazımı hepsini
  // yazmıştır. Saatler bir kez tutulmaya başlandıysa bütün yazara düşülmez:
  // o yazar yalnız başka bir alt alanı yazmış olabilir.
  const legacy = !priorWriters || typeof priorWriters !== 'object';
  for (const sub of allowed) {
    const lastWriter = legacy ? wholeWriter : priorWriters[sub], lastOrder = legacy ? wholeOrder : priorOrders && priorOrders[sub];
    if (lastWriter) subWriters[sub] = { ...lastWriter };
    if (lastOrder) subOrders[sub] = { ...lastOrder };
  }
  const conflicting = {};
  let applied = false;
  for (const sub of subs) {
    const nextValue = subValue(incoming[sub]);
    const lastWriter = writer && seen && subWriters[sub] && subWriters[sub].d ? subWriters[sub] : null;
    if (lastWriter) {
      if (lastWriter.d === writer.d) {
        if (writer.s < (Number(lastWriter.s) || 0)) continue;
      } else if (!(Number(seen[lastWriter.d]) >= (Number(lastWriter.s) || 0)) && JSON.stringify(result[sub]) !== JSON.stringify(nextValue)) {
        const lastOrder = subOrders[sub];
        if (!(ownerAllowed && order && lastOrder && lastOrder.userId === order.userId)) { conflicting[sub] = nextValue; continue; }
        if (compareEventOrder(order, lastOrder) < 0) continue;
      }
    }
    if (nextValue === undefined) delete result[sub]; else result[sub] = nextValue;
    if (writer) subWriters[sub] = { ...writer };
    if (order && ownerAllowed) subOrders[sub] = { ...order }; else delete subOrders[sub];
    applied = true;
  }
  // Yazarın bildiği ama bu olayda yazmadığı alt alan, burada hiç bilinmiyorsa doldurulur.
  for (const sub of allowed) {
    if (subs.includes(sub) || Object.prototype.hasOwnProperty.call(result, sub) || subWriters[sub]) continue;
    const known = subValue(incoming[sub]);
    if (known !== undefined) { result[sub] = known; applied = true; }
  }
  const merged = Object.keys(result).length ? result : null;
  const conflict = Object.keys(conflicting).length ? { current: clone(merged), incoming: (() => {
    const next = { ...result };
    for (const [sub, item] of Object.entries(conflicting)) { if (item === undefined) delete next[sub]; else next[sub] = item; }
    return Object.keys(next).length ? clone(next) : null;
  })() } : null;
  return { value: merged, applied, conflict, subWriters, subOrders };
}

function now() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function eventId(value) { return String(value || '').trim().slice(0, 160); }
function recordId(value) { return String(value || '').trim().slice(0, 240); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function receiptFirstSequence(delta) {
  const first = Number(delta.sourceFirstSeq) || Number(delta.localSequence) || 0;
  if (delta.coverFromSeq == null) return first;
  const cover = Number(delta.coverFromSeq);
  if (!Number.isSafeInteger(cover) || cover < 1 || cover >= first) throw new Error('Delta cover range is invalid.');
  return cover;
}

function emptyState(deviceId = crypto.randomUUID()) {
  return {
    schemaVersion: SCHEMA_VERSION, revision: 0, deviceId: String(deviceId), localSequence: 0,
    hlc: null, records: {}, tombstones: {}, events: {}, appliedEvents: {}, appliedPackages: {}, conflicts: [], journal: [],
    syncCheckpoints: {}, syncLedger: { version: 1, eventIds: {}, acknowledgedEventIds: {}, compactedEvents: 0, compactedThrough: 0, acknowledgedThrough: 0, ranges: [], receivedBeyondByDevice: {} }, assets: {}, migrations: {},
  };
}

/* Kopyalanmış kurulum koruması (7.0.178). Bir kurulumun data klasörü başka
   bir bilgisayara/kullanıcıya kopyalanırsa deviceId de kopyalanır; iki kurulum
   Shared Hub'da aynı cihaz klasörüne yazar, birbirinin klasörünü "kendi
   klasörüm" diye okumaz ve aynı cihaz sıra numaralarını paylaşır. Emekli
   edilen kimlikler burada tutulur. */
const CLONE_WRITER_SUFFIX = '#clone';
function retiredDeviceIds(state) {
  return Array.isArray(state && state.retiredDeviceIds) ? state.retiredDeviceIds.filter(item => item && item.deviceId) : [];
}
function isRetiredDeviceId(state, id) {
  const wanted = String(id || '');
  return Boolean(wanted) && retiredDeviceIds(state).some(item => String(item.deviceId) === wanted);
}

function dataIntegrityError(file, errors = []) {
  const details = errors.map(item => `${path.basename(item.file)}: ${item.error && item.error.message || item.error}`).join('; ');
  return Object.assign(new Error(`BuyerLogLocal.db okunamadı; mevcut veri korunuyor. ${details}`), {
    code: 'DATA_INTEGRITY_ERROR', statusCode: 503, file, errors,
  });
}
function normalizeState(raw, deviceId) {
  const state = { ...emptyState(deviceId || undefined), ...(raw && typeof raw === 'object' ? raw : {}) };
  state.schemaVersion = SCHEMA_VERSION;
  state.deviceId = String(state.deviceId || deviceId || crypto.randomUUID());
  state.localSequence = Number(state.localSequence) || 0;
  state.hlc = state.hlc == null ? null : hybridClock.parse(hybridClock.serialize(state.hlc));
  state.appliedEvents = state.appliedEvents && typeof state.appliedEvents === 'object' ? state.appliedEvents : {};
  state.appliedPackages = state.appliedPackages && typeof state.appliedPackages === 'object' ? state.appliedPackages : {};
  state.conflicts = Array.isArray(state.conflicts) ? state.conflicts : [];
  for (const item of state.conflicts) pruneResolvedConflict(item);
  state.syncCheckpoints = state.syncCheckpoints && typeof state.syncCheckpoints === 'object' ? state.syncCheckpoints : {};
  const ledger = state.syncLedger && typeof state.syncLedger === 'object' ? state.syncLedger : {};
  state.syncLedger = {
    version: 1,
    eventIds: ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {},
    acknowledgedEventIds: ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {},
    compactedEvents: Math.max(0, Number(ledger.compactedEvents) || 0),
    compactedThrough: Math.max(0, Number(ledger.compactedThrough) || 0),
    acknowledgedThrough: Math.max(0, Number(ledger.acknowledgedThrough) || 0),
    ranges: Array.isArray(ledger.ranges) ? ledger.ranges.slice(-200) : [],
    receivedBeyondByDevice: ledger.receivedBeyondByDevice && typeof ledger.receivedBeyondByDevice === 'object' ? ledger.receivedBeyondByDevice : {},
  };
  state.records = state.records && typeof state.records === 'object' ? state.records : {};
  state.tombstones = state.tombstones && typeof state.tombstones === 'object' ? state.tombstones : {};
  state.events = state.events && typeof state.events === 'object' ? state.events : {};
  state.journal = Array.isArray(state.journal) ? state.journal : [];
  state.assets = state.assets && typeof state.assets === 'object' ? state.assets : {};
  state.migrations = state.migrations && typeof state.migrations === 'object' ? state.migrations : {};
  // Olay dışı yoldan (checkpoint onarımı) edinilmiş bilgi: kaynak cihaz → sıra.
  state.causalKnowledge = state.causalKnowledge && typeof state.causalKnowledge === 'object' ? state.causalKnowledge : {};
  return state;
}
/* Kapanmış çakışmanın iki tarafının TAM değeri artık hiçbir yolda okunmaz
   (liste ve çözüm yalnız açık kayıtlara bakar). Büyük belge alanlarında bu
   kopyalar anlık görüntüyü yüzlerce MB şişirip V8 string sınırına
   taşıyordu; kapanan kaydın yalnız künyesi tutulur. */
function pruneResolvedConflict(item) {
  if (!item || !item.resolved || item.valuesPruned) return item;
  delete item.current; delete item.incoming;
  item.valuesPruned = true;
  return item;
}
/* Çakışmanın arayüze giden hafif özeti. Değerler sınırlı önizleme olarak
   taşınır; çözüm sunucuda kayıtlı tam değerle yapılır. */
function summarizeConflict(item, previewChars = 4000) {
  if (!item || typeof item !== 'object') return null;
  const side = value => {
    if (value === undefined) return { preview: '', truncated: false, missing: true };
    const { text, truncated } = jsonPreview(value, previewChars);
    return { preview: text, truncated };
  };
  const out = {};
  for (const key of ['conflictId', 'eventId', 'id', 'type', 'field', 'ownerId', 'rowId', 'at', 'currentRevision', 'baseRevision', 'resolved', 'resolution']) {
    if (item[key] !== undefined) out[key] = item[key];
  }
  out.current = side(item.current);
  out.incoming = side(item.incoming);
  return out;
}
/* Anlık görüntü dosyası; V8 string sınırını aşan boyutta da okunur. */
async function readJsonFile(file) { return parseJsonBuffer(await fsp.readFile(file)); }
async function readState(file, deviceId = null) {
  const errors = [];
  for (const candidate of [file, `${file}.bak`]) {
    try {
      const state = normalizeState(await readJsonFile(candidate), deviceId);
      if (candidate !== file) {
        // Keep the unreadable primary for forensics, then restore the validated
        // backup. writeState must not copy the corrupt primary over the backup.
        if (fs.existsSync(file)) {
          const quarantine = `${file}.corrupt-${Date.now()}`;
          await replaceFileWithRetry(file, quarantine);
        }
        await writeState(file, state);
        /* Çağıran bunu bilmek zorunda: yedekten dönülen görüntü, WAL'daki
           işlemleri İÇERMEZ. Oynatma bittikten sonra yeniden sıkıştırılmalı,
           yoksa onarılmış birincil dosya eksik kalır. Sayılmayan alan olarak
           iliştirilir; JSON.stringify ve Object.keys etkilenmez. */
        Object.defineProperty(state, '__restoredFromBackup', { value: true, enumerable: false, configurable: true });
      }
      return state;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      errors.push({ file: candidate, error });
    }
  }
  if (!fs.existsSync(file) && !fs.existsSync(`${file}.bak`) && !errors.length) return emptyState(deviceId || undefined);
  throw dataIntegrityError(file, errors);
}

async function writeState(file, state) {
  const folder = path.dirname(path.resolve(file));
  const recovery = createDurableFileRecovery({
    recoveryRoot: path.join(folder, '.buyerlog-db-recovery'),
    allowedRoots: [folder],
  });
  /* Parçalı serileştirme: tek dev string oluşmaz (bkz. large-json.js). Girinti
     yok — okuyan her yol JSON.parse kullanır; dosya ~%30 küçülür. */
  await recovery.replace(file, jsonToBuffer(state));
}

/* Belge defteri (delta-store DOCUMENT_REVISION_META): her cihaz kendi
   yazımında yerel revizyon sayacını ve zaman damgasını günceller. İş verisi
   değildir; kullanıcıya "çakışma" olarak sorulacak bir seçim içermez. Yüksek
   revizyonlu defter kazanır, eşitlikte yerel kalır. */
const DOCUMENT_REVISION_META_FIELD = 'storeRevisionMeta';
function newerRevisionMeta(current, incoming) {
  const currentRevision = Number(current && current.revision) || 0;
  const incomingRevision = Number(incoming && incoming.revision) || 0;
  return incoming && typeof incoming === 'object' && incomingRevision > currentRevision ? incoming : current;
}

/* PAYLAŞILAN BELGE LİSTELERİ — kayıt bazında birleşim.
   Fiyat talepleri ve e-posta grupları tek bir belge alanında dizi olarak
   durur. İki cihaz aynı aralıkta AYRI kayıt eklediğinde alanı bütün olarak
   seçmek (çakışma) bir tarafın kaydını kaybettirirdi. Bu alanlar kimliğe göre
   birleştirilir: aynı kayıtta en yeni updatedAt kazanır (eşitlikte içerik
   karşılaştırması iki cihazda aynı sonucu verir); silinen e-posta kaydı
   silindi işaretiyle birleşimden düşer. Birleşim değişmeli ve tekrarlanabilir
   olduğu için cihazlar yeniden yayına gerek kalmadan aynı sonuca yakınsar. */
const DOCUMENT_LIST_MERGE = Object.freeze({
  /* Fiyat talebi kayıtları satır bazında birleşir: aynı talebin iki kopyasında
     ortak satırların durumu satırın kendi updatedAt'ine göre seçilir ve Fiyat
     Defteri olayları birleşir (bkz. quotation-ledger.js mergeRequestCopies). */
  'store:quotations.json': { requests: { tombstones: 'deletedRequests', itemMerge: 'quotationRequest' }, deletedRequests: { tombstoneMap: true } },
  'store:email-groups.json': { records: { tombstones: 'deletedRecords' }, deletedRecords: { tombstoneMap: true }, migratedNonDtrNames: { stringSet: true } },
});
function mergeTombstoneMaps(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [id, at] of Object.entries(b && typeof b === 'object' ? b : {})) if (!out[id] || String(at) > String(out[id])) out[id] = at;
  return out;
}
function newerListItem(a, b) {
  const at = String(a && a.updatedAt || ''), bt = String(b && b.updatedAt || '');
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
const LIST_ITEM_MERGES = Object.freeze({ quotationRequest: quotationLedger.mergeRequestCopies });
function mergeListById(current, incoming, tombstones = {}, itemMerge = '') {
  const out = new Map(), extra = [];
  const merge = LIST_ITEM_MERGES[itemMerge] || newerListItem;
  for (const item of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const id = item && typeof item === 'object' ? String(item.id || '') : '';
    if (!id) { extra.push(item); continue; }
    out.set(id, out.has(id) ? merge(out.get(id), item) : item);
  }
  return [...out.values()].filter(item => !(tombstones[item.id] && String(tombstones[item.id]) >= String(item.updatedAt || ''))).concat(extra);
}
function listMergeRule(recordKey, field) {
  const rules = DOCUMENT_LIST_MERGE[String(recordKey || '')];
  return rules && Object.prototype.hasOwnProperty.call(rules, field) ? rules[field] : null;
}

/* NEDENSEL ÇAKIŞMA ALGILAMA (v20260926).
   Cihaz sayaçları bağımsız ilerlediği için "uzak tabanı < yerel alan
   revizyonu" kuralı, sayacı ileride olan cihazın yerel değişikliği HİÇ
   görmeden yaptığı yazımı sıralı sanıyor ve çakışma olmadan son yazan
   kazanıyordu. Artık her alan son yazanını (_fieldWriters: cihaz + sıra) tutar;
   uzak olay yazıldığı andaki sürüm vektörünü (seen: kaynak cihaz → alınan son
   sıra) taşır. Olayı yazan cihaz alanın son yazımını görmemişse gerçek
   eşzamanlılıktır → çakışma. Vektörü olmayan (eski sürüm) olay veya son yazanı
   bilinmeyen alan eski kuralla değerlendirilir. causal = { writer, seen }. */
function fieldMerge(current, incoming, revision, baseRevision = null, recordKey = '', causal = null) {
  const base = current && typeof current === 'object' ? current : {};
  const next = { ...base };
  const fields = { ...(base._fieldRevisions || {}) };
  const writers = { ...(base._fieldWriters || {}) };
  const orders = { ...(base._fieldOrders || {}) };
  const order = causal && causal.order;
  const emailDocument = recordKey === 'store:email-groups.json' || causal && causal.documentId === 'store:email-groups.json';
  const emailMerge = emailDocument && recordKey ? emailClockLists.mergeEmailLists(base, { ...incoming, _listOrders: causal && causal.listClocks || {} }) : null;
  if (emailDocument) next._listOrders = emailMerge ? emailMerge._listOrders : causal && causal.listClocks || base._listOrders || {};
  if (emailMerge && !Object.hasOwn(incoming, 'records') && Object.hasOwn(emailMerge, 'records')) next.records = emailMerge.records;
  const owner = causal && causal.owner;
  const rememberOrder = key => { if (order && owner && owner.known && owner.allowed && SHARED_CP_FIELDS.has(key)) orders[key] = { ...order }; else delete orders[key]; };
  const writer = causal && causal.writer && causal.writer.d ? { d: String(causal.writer.d), s: Number(causal.writer.s) || 0 } : null;
  const seen = writer && causal.seen && typeof causal.seen === 'object' ? causal.seen : null;
  const conflicts = [];
  const subWriters = { ...(base._subfieldWriters || {}) }, subOrders = { ...(base._subfieldOrders || {}) };
  const compositeHandled = new Set();
  for (const [key, value] of Object.entries(incoming && typeof incoming === 'object' ? incoming : {})) {
    if (key === '_fieldRevisions' || key === '_revision' || key === '_fieldWriters' || key === '_fieldOrders' || key === '_listOrders' || key === '_subfieldWriters' || key === '_subfieldOrders') continue;
    const previousRevision = Number(fields[key]) || 0;
    const subs = causal && causal.subfields && COMPOSITE_FIELDS[key] && Array.isArray(causal.subfields[key]) ? causal.subfields[key] : null;
    if (subs) {
      compositeHandled.add(key);
      const merged = mergeCompositeField({ current: next[key], value, subs, allowed: COMPOSITE_FIELDS[key], writer, seen, order,
        ownerAllowed: Boolean(owner && owner.known && owner.allowed && SHARED_CP_FIELDS.has(key)),
        wholeWriter: writers[key], wholeOrder: orders[key], priorWriters: subWriters[key], priorOrders: subOrders[key] });
      subWriters[key] = merged.subWriters; subOrders[key] = merged.subOrders;
      if (merged.applied) {
        next[key] = merged.value; fields[key] = Math.max(previousRevision, revision);
        if (writer) writers[key] = writer;
        rememberOrder(key);
      }
      if (merged.conflict) conflicts.push({ field: key, current: merged.conflict.current, incoming: merged.conflict.incoming, currentRevision: previousRevision, baseRevision: Number(baseRevision) || 0 });
      continue;
    }
    if (key === DOCUMENT_REVISION_META_FIELD && next[key] && typeof next[key] === 'object') {
      next[key] = newerRevisionMeta(next[key], value);
      fields[key] = Math.max(previousRevision, revision);
      continue;
    }
    /* Uzak olayda liste alanı HER ZAMAN kimlikle birleşir. Cihaz sayaçları
       bağımsız ilerlediği için "yerelde değişti mi" sorusu revizyonla her zaman
       doğru cevaplanamaz; yerel kaydı hiç görmemiş cihazın yüksek tabanlı olayı
       listeyi bütün olarak yazıp yeni kaydı sessizce siliyordu. Birleşim
       değişmeli ve tekrarlanabilir olduğundan her durumda güvenlidir; silme,
       silme iziyle taşınır. (Yerel yazımda recordKey yoktur: liste aynen yazılır.) */
    const listRule = recordKey ? listMergeRule(recordKey, key) : null;
    if (emailMerge && (key === 'records' || key === 'deletedRecords')) {
      next[key] = emailMerge[key]; fields[key] = Math.max(previousRevision, revision);
      if (writer) writers[key] = writer; continue;
    }
    if (listRule && next[key] !== undefined) {
      if (listRule.stringSet) next[key] = [...new Set([...(Array.isArray(next[key]) ? next[key] : []), ...(Array.isArray(value) ? value : [])])].sort();
      else if (listRule.tombstoneMap) next[key] = mergeTombstoneMaps(next[key], value);
      else next[key] = mergeListById(next[key], value, listRule.tombstones ? mergeTombstoneMaps(next[listRule.tombstones], incoming[listRule.tombstones]) : {}, listRule.itemMerge);
      fields[key] = Math.max(previousRevision, revision);
      if (writer) writers[key] = writer;
      continue;
    }
    const lastWriter = seen && writers[key] && writers[key].d ? writers[key] : null;
    const concurrent = lastWriter
      ? lastWriter.d !== writer.d && !(Number(seen[lastWriter.d]) >= (Number(lastWriter.s) || 0))
      : baseRevision != null && previousRevision > Number(baseRevision || 0);
    if (concurrent && owner && owner.known && owner.allowed && SHARED_CP_FIELDS.has(key) && order && orders[key] && orders[key].userId === order.userId) {
      if (compareEventOrder(order, orders[key]) < 0) continue;
      next[key] = value; fields[key] = Math.max(previousRevision, revision);
      if (writer) writers[key] = writer; rememberOrder(key);
      continue;
    }
    if (lastWriter) {
      if (lastWriter.d === writer.d) {
        // Aynı cihazın daha eski olayı daha yeni değeri geri almaz.
        if (writer.s < (Number(lastWriter.s) || 0)) continue;
      } else if (!(Number(seen[lastWriter.d]) >= (Number(lastWriter.s) || 0)) && JSON.stringify(next[key]) !== JSON.stringify(value)) {
        conflicts.push({ field: key, current: clone(next[key]), incoming: clone(value), currentRevision: previousRevision, baseRevision: Number(baseRevision) || 0 });
        continue;
      }
      next[key] = value;
      rememberOrder(key);
      fields[key] = Math.max(previousRevision, revision);
      writers[key] = writer;
      continue;
    }
    const changedLocally = baseRevision != null && previousRevision > Number(baseRevision || 0) && JSON.stringify(next[key]) !== JSON.stringify(value);
    if (changedLocally || (baseRevision == null && previousRevision > revision)) {
      const rule = listMergeRule(recordKey, key);
      if (rule) {
        if (rule.tombstoneMap) next[key] = mergeTombstoneMaps(next[key], value);
        else {
          const tombstones = rule.tombstones ? mergeTombstoneMaps(next[rule.tombstones], incoming[rule.tombstones]) : {};
          next[key] = mergeListById(next[key], value, tombstones, rule.itemMerge);
        }
        fields[key] = Math.max(previousRevision, revision);
        continue;
      }
      conflicts.push({ field: key, current: clone(next[key]), incoming: clone(value), currentRevision: previousRevision, baseRevision: Number(baseRevision) || 0 });
      continue;
    }
    next[key] = value;
    rememberOrder(key);
    fields[key] = revision;
    if (writer) writers[key] = writer;
  }
  // Bütün nesne olarak yazılan (eski sürüm / çakışma çözümü) bileşik alanın
  // alt alan saatleri geçersizdir; sonraki alt alan yazımı bütün yazarı esas alır.
  for (const key of Object.keys(COMPOSITE_FIELDS)) {
    if (compositeHandled.has(key) || !Object.prototype.hasOwnProperty.call(incoming || {}, key)) continue;
    if (next[key] !== base[key] || writers[key] !== (base._fieldWriters || {})[key]) { delete subWriters[key]; delete subOrders[key]; }
  }
  if (Object.keys(subWriters).length) next._subfieldWriters = subWriters; else delete next._subfieldWriters;
  if (Object.keys(subOrders).length) next._subfieldOrders = subOrders; else delete next._subfieldOrders;
  next._fieldRevisions = fields;
  if (Object.keys(orders).length) next._fieldOrders = orders; else delete next._fieldOrders;
  if (Object.keys(writers).length) next._fieldWriters = writers;
  next._revision = Math.max(Number(base._revision) || 0, revision);
  return { value: next, conflicts };
}

/* ===================================================================
   APPEND-ONLY JOURNAL (WAL)

   PROBLEM. Yerel DB tek bir JSON zarfı ve her transaction bütün durumu
   yeniden yazıyor. Ortak iş verisi motora taşındıktan sonra bu maliyet
   gerçek oldu; ölçüldü:

     500 satırlık çalışma alanı  -> DB 0.2 MB, küçük bir yazma  10 ms
     5.000 satır                 -> DB 1.7 MB, küçük bir yazma  30 ms
     50.000 satır                -> DB 17.4 MB, küçük bir yazma 207 ms

   Yani tek bir ayar değişikliği, ilgisiz bir Koleksiyon sayfası büyüdüğü
   için yavaşlıyor. Maliyet veriye göre doğrusal.

   ÇÖZÜM. Yazma iki parçaya ayrılır:

     BuyerLogLocal.db      anlık görüntü — BİÇİMİ DEĞİŞMEDİ
     BuyerLogLocal.db.wal  o görüntüden sonraki işlemler, satır satır

   Sıcak yol (patch/tombstone/delta) yalnız WAL'a bir satır ekler: maliyet
   işlemin boyutuyla orantılı, durumun boyutuyla değil. Okuma anlık
   görüntüyü alır ve WAL'ı üzerine oynatır. WAL büyüyünce yeni bir anlık
   görüntü yazılıp WAL boşaltılır (compaction).

   ANLIK GÖRÜNTÜ BİÇİMİ AYNI KALDI. Bu bilinçli: WAL silinse bile eski
   sürüm dosyayı okuyabilir, yani geri dönüş her zaman mümkün.

   ÇÖKME GÜVENLİĞİ. Her satır kendi sha256'sını taşır. Yarım yazılmış ya
   da bozuk bir satırda oynatma DURUR ve sonrası atılır — append-only
   olduğu için sıra korunur, dolayısıyla bozuk satırdan sonrası zaten
   onaylanmamış yazmalardır. Satır fsync edilmeden çağırana dönülmez, yani
   onaylanmış hiçbir yazma kaybolmaz.

   REPLAY DETERMİNİST OLMALI. eventId ve zaman damgası çağrı anında
   üretilip WAL'a YAZILIR; oynatma sırasında yeniden üretilmez. revision ve
   localSequence durumdan türediği için sıralı oynatmada kendiliğinden
   aynı çıkar.
   =================================================================== */
const WAL_SUFFIX = '.wal';
const WAL_VERSION = 1;
/* Eşikler: WAL bu boyutu ya da satır sayısını aşınca sıkıştırılır. Amaç,
   açılıştaki oynatma maliyetini sınırlı tutmak. */
const WAL_MAX_BYTES = 1024 * 1024;
const WAL_MAX_ENTRIES = 2000;

function walLine(operation, payload) {
  const entry = { v: WAL_VERSION, op: operation, payload };
  entry.sha256 = sha256(Buffer.from(JSON.stringify(entry), 'utf8'));
  return `${JSON.stringify(entry)}\n`;
}

/* Bozuk ya da yarım satırda durur. Döndürülen sayı, güvenle uygulanabilen
   işlem sayısıdır; sonrası sessizce atılmaz, `truncated` ile bildirilir. */
function walLines(input) {
  if (!Buffer.isBuffer(input)) return String(input || '').split('\n');
  // Büyük WAL tek string'e çevrilmez; satırlar tampon üzerinde ayrılır.
  const lines = [];
  for (let start = 0; start < input.length;) {
    let end = input.indexOf(0x0a, start);
    if (end < 0) end = input.length;
    lines.push(input.toString('utf8', start, end));
    start = end + 1;
  }
  return lines;
}
function parseWal(text) {
  const entries = [];
  let truncated = false, tornTail = false;
  const lines = walLines(text);
  const endsWithNewline = Buffer.isBuffer(text) ? text.at(-1) === 0x0a : String(text || '').endsWith('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let entry = null;
    try { entry = JSON.parse(line); } catch (_) {
      truncated = true;
      // Only a final unterminated JSON fragment can be a torn append. A bad
      // checksum/schema or corruption before later lines needs explicit repair.
      tornTail = index === lines.length - 1 && !endsWithNewline;
      break;
    }
    if (!entry || entry.v !== WAL_VERSION || !entry.op) { truncated = true; break; }
    const expected = sha256(Buffer.from(JSON.stringify({ v: entry.v, op: entry.op, payload: entry.payload }), 'utf8'));
    if (expected !== entry.sha256) { truncated = true; break; }
    entries.push(entry);
  }
  return { entries, truncated, tornTail, endsWithNewline };
}

/* Kimlik için bütün DB'yi senkron okuyup parse etmek hem olay döngüsünü
   bloke eder hem de büyük dosyada V8 string sınırına takılıp sessizce YENİ
   bir kimlik üretirdi. Büyük dosyada üst seviye deviceId (emptyState sırası
   gereği schemaVersion/revision'dan hemen sonra gelir) dosyanın başından okunur. */
function readDeviceIdSync(file) {
  const size = fs.statSync(file).size;
  if (size <= DIRECT_PARSE_MAX_BYTES) {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    return existing && existing.deviceId ? String(existing.deviceId) : '';
  }
  const handle = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    fs.readSync(handle, head, 0, head.length, 0);
    const match = head.toString('utf8').match(/^\s*\{(?:\s*"(?:schemaVersion|revision)"\s*:\s*-?[\d.eE+-]+\s*,)*\s*"deviceId"\s*:\s*("(?:[^"\\]|\\.)*")/);
    return match ? String(JSON.parse(match[1])) : '';
  } finally { fs.closeSync(handle); }
}

function createLocalDb(file, { clock = Date.now, trace = null, walMaxBytes = WAL_MAX_BYTES } = {}) {
  let dbFile = path.resolve(file);
  let deviceId = null;
  /* Taşıma kapsamı (v20261009). Ortak klasöre hiç gitmeyecek bir yerel yazım
     journal'da "yüklenmeyi bekliyor" olarak durursa sync durumu sahte
     "N changes waiting" gösterir ve ilk Shared Hub eşitlemesi bekleyen
     değişiklik var diye kilitlenir. Sunucu sync politikasını buraya bağlar;
     kapsam dışı olay yazıldığı anda yerel olarak kapanır. Bağlanmamışsa
     (testler, eski çağıranlar) her olay eskisi gibi taşınabilir sayılır. */
  let transportFilter = null, sharedOwnerResolver = null;
  function setSharedOwnerResolver(resolve) { sharedOwnerResolver = typeof resolve === 'function' ? resolve : null; }
  function sharedOwnerOf(id, userId) {
    if (!String(id).startsWith('cp-order:') || !sharedOwnerResolver) return { allowed: true, known: false };
    return sharedOwnerResolver(id, userId);
  }
  function setTransportFilter(filter) { transportFilter = typeof filter === 'function' ? filter : null; }
  function closeIfLocalOnly(journalItem) {
    if (!transportFilter) return;
    let transportable = true;
    try { transportable = transportFilter(journalItem) !== false; } catch (_) { transportable = true; }
    if (transportable) return;
    journalItem.localOnly = true;
    journalItem.uploaded = true; journalItem.synced = true; journalItem.acknowledged = true;
  }
  let recoveredFolder = '';
  function recoverPendingWrites() {
    const folder = path.dirname(dbFile);
    if (recoveredFolder === folder) return;
    const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
    const result = recovery.recoverSync();
    if (result.conflicts || result.errors.length) throw dataIntegrityError(dbFile, result.errors.map(item => ({ file: item.file, error: new Error(item.error) })));
    recoveredFolder = folder;
  }
  /* ===================================================================
     v7.85 — YAPICI ARTIK DİSKE DOKUNMUYOR.

     createLocalDb, modül yüklenirken iki senkron iş yapıyordu: bütün
     recovery klasörünü tarayıp her intent için payload'ı ve hedefi baştan
     sona okuyup hashlemek, ve deviceId'yi almak için DB'nin tamamını
     readFileSync ile okumak. İkisi de HTTP sunucusu porta bağlanmadan
     ÖNCE, olay döngüsünü bloke ederek çalışıyordu; birikmiş intent'ler ve
     soğuk disk önbelleği bunu saniyeler mertebesine çıkarabiliyordu.

     Kurtarma artık ihtiyaç anında yapılıyor. Doğruluk için bir şey
     kaybedilmez: DB'ye dokunan HER yol (ensure, read, transaction) zaten
     recoverPendingWrites çağırıyor, yani ilk okuma ya da yazmadan önce
     kurtarma mutlaka çalışır. Yapıcı yalnız yolu hesaplar.
     =================================================================== */
  function loadDeviceId() {
    if (deviceId) return deviceId;
    recoverPendingWrites();
    for (const candidate of [dbFile, `${dbFile}.bak`]) {
      try {
        const found = readDeviceIdSync(candidate);
        if (found) { deviceId = found; return deviceId; }
      } catch (_) { /* yoksa ya da okunamıyorsa sıradaki adaya geç */ }
    }
    deviceId = crypto.randomUUID();
    return deviceId;
  }
  function walFile() { return `${dbFile}${WAL_SUFFIX}`; }

  /* WAL'daki işlemleri anlık görüntünün üzerine oynatır. Uygulama, canlı
     yolun kullandığı fonksiyonların ta kendisidir — oynatma ile normal
     çalışma arasında davranış farkı olamaz. */
  function replayWal(state, entries) {
    for (const entry of entries) {
      if (entry.op === 'patch') applyLocalPatch(state, entry.payload);
      else if (entry.op === 'tombstone') applyLocalTombstone(state, entry.payload);
      else if (entry.op === 'delta') applyRemoteDelta(state, entry.payload);
      else if (entry.op === 'mark-synced') applyMarkSynced(state, entry.payload);
      else if (entry.op === 'mark-ack') applyMarkAcknowledged(state, entry.payload);
      else if (entry.op === 'mark-ack-through') applyMarkAcknowledgedThrough(state, entry.payload);
      else if (entry.op === 'package') applyPackageToState(state, entry.payload);
      else if (entry.op === 'private-records') applyPrivateRecords(state, entry.payload);
    }
    return state;
  }

  async function readWalEntries(target) {
    try {
      const bytes = await fsp.readFile(target);
      return { ...parseWal(bytes), bytes };
    }
    catch (error) {
      if (error && error.code === 'ENOENT') return { entries: [], truncated: false };
      throw error;
    }
  }

  /* Anlık görüntü + WAL. Çağıranların gördüğü durum her zaman budur.

     Bir ÖNCEKİ kuşak WAL de oynatılır. Sebebi şu: readState birincil dosya
     okunamazsa .bak'a düşer, ve .bak sıkıştırmadan ÖNCEKİ görüntüdür. O
     görüntüye katlanmış işlemler yalnız eski WAL'da durur; saklanmasaydı
     bozuk bir anlık görüntüde aradaki yazmalar kaybolurdu.

     Fazladan oynatmanın bedeli yok: her işlem eventId ile idempotent, yani
     zaten uygulanmış olanlar duplicate olarak geçilir. */
  /* Durum bellekte tutulur ve dosya imzalarıyla doğrulanır.

     WAL yazmayı ucuzlattı ama okuma hâlâ bütün görüntüyü okuyup parse
     ediyordu; 17 MB'lık bir durumda küçük bir yazma bu yüzden 60 ms sürüyordu.
     İmza (boyut+mtime) değişmediyse yeniden okumaya gerek yok — db.js'teki
     jsonReadCache ile aynı desen.

     Başka bir süreç yazarsa imza değişir ve durum yeniden yüklenir; ayrıca
     yazmalar zaten dosya kirasıyla sıralanıyor. Döndürülen nesne canlıdır:
     transaction mutator'ları onu bilerek değiştirir, okuyucular değiştirmez
     (pending/listConflicts kendi kopyalarını üretir). */
  let cachedState = null;
  let cachedTags = null;
  let walMetadata = null;
  function statTag(stat) { return `${stat.ino}-${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`; }
  async function fileTag(target) {
    try { return statTag(await fsp.stat(target)); }
    catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  }
  async function currentTags() {
    return `${await fileTag(dbFile)}|${await fileTag(walFile())}|${await fileTag(`${walFile()}.bak`)}`;
  }
  function invalidateCache() { cachedState = null; cachedTags = null; walMetadata = null; }
  async function withDbLease(operation) {
    try { return await withFileLeaseAsync(dbFile, operation); }
    catch (error) { invalidateCache(); throw error; }
  }

  async function loadState() {
    const tags = await currentTags();
    if (cachedState && cachedTags === tags) return cachedState;
    const state = await loadStateFromDisk();
    cachedState = state;
    cachedTags = await currentTags();
    return state;
  }

  async function loadStateFromDisk() {
    const state = await readState(dbFile, loadDeviceId());
    deviceId = state.deviceId;
    const previous = await readWalEntries(`${walFile()}.bak`);
    const current = await readWalEntries(walFile());
    const entries = previous.entries.concat(current.entries);
    if (!entries.length) return state;
    const replayed = replayWal(state, entries);
    /* Birincil dosya bozulmuş ve yedekten dönülmüşse, o görüntü WAL'daki
       işlemleri içermiyor. Onarımı yarım bırakmamak için tam durumu hemen
       kalıcı yaz: bundan sonra birincil dosya tek başına eksiksizdir. */
    if (state.__restoredFromBackup) await writeSnapshot(replayed);
    return replayed;
  }

  /* Anlık görüntüyü yazar, sonra WAL'ı bir kuşak geriye döndürür. Sıra
     önemli: görüntü kalıcı olmadan WAL kaybolursa o işlemler yok olur.
     writeState hedefi yazdıktan sonra sha256 ile doğruluyor, yani buraya
     dönülmüşse görüntü gerçekten diskte. */
  async function writeSnapshot(state) {
    await inspectWalForWrite(true);
    await writeState(dbFile, state);
    try { await replaceFileWithRetry(walFile(), `${walFile()}.bak`); }
    catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    walMetadata = null;
  }

  async function inspectWalForWrite(preserveTorn = false) {
    const tag = await fileTag(walFile());
    let current = walMetadata && walMetadata.tag === tag ? walMetadata : null;
    if (!current) {
      const parsed = await readWalEntries(walFile());
      current = {
        tag, entryCount: parsed.entries.length, byteLength: parsed.bytes?.length || 0,
        truncated: parsed.truncated, tornTail: parsed.tornTail || false,
        endsWithNewline: parsed.endsWithNewline || false,
        ...(parsed.tornTail ? { bytes: parsed.bytes } : {}),
      };
      walMetadata = current;
    }
    if (current.truncated && !current.tornTail) {
      invalidateCache();
      throw dataIntegrityError(dbFile, [{ file: walFile(), error: new Error('WAL integrity check failed / WAL bütünlük denetimi başarısız') }]);
    }
    if (preserveTorn && current.tornTail) {
      // Preserve every original byte before any snapshot/rotation can touch it.
      const folder = path.dirname(dbFile);
      const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
      await recovery.replace(`${walFile()}.corrupt-${crypto.randomUUID()}`, current.bytes);
    }
    return current;
  }

  function validateTransportClocks(delta) {
    if (delta.hlc != null) hybridClock.parse(hybridClock.serialize(delta.hlc));
    emailClockLists.validateListClocks(delta.listClocks);
  }
  function restoreHlc(state, value) {
    if (!value) return;
    const stamp = hybridClock.parse(hybridClock.serialize(value));
    if (!state.hlc || hybridClock.compare(stamp, state.hlc) > 0) state.hlc = stamp;
  }
  // Called only inside the existing checkpoint snapshot transaction. Observe
  // imported field/item clocks once, without scanning records on each edit.
  function mergeCheckpointClockState(state, records) {
    let greatest = null;
    const observe = value => {
      if (!value) return;
      const stamp = hybridClock.parse(hybridClock.serialize(value));
      if (!greatest || hybridClock.compare(stamp, greatest) > 0) greatest = stamp;
    };
    for (const record of Object.values(records || {})) {
      if (!record || typeof record !== 'object') continue;
      for (const order of Object.values(record._fieldOrders || {})) observe(order && order.hlc);
      for (const map of Object.values(record._listOrders || {})) for (const order of Object.values(map || {})) observe(order && order.hlc);
    }
    if (!greatest) return;
    const hlc = hybridClock.createHlc({ node:state.deviceId, state:state.hlc, now:clock, onSkew:event => {
      if (typeof trace === 'function') { try { trace(event.code,event); } catch (_) {} }
    } });
    state.hlc = hlc.receive(greatest);
  }
  function stampOperation(state, operation) {
    const payload = operation.payload;
    const known = eid => state.events[eid] || state.appliedEvents[eid] || state.syncLedger?.eventIds?.[eid];
    const hlc = hybridClock.createHlc({ node: state.deviceId, state: state.hlc, now: clock, onSkew: event => {
      if (typeof trace === 'function') { try { trace(event.code, event); } catch (_) {} }
    } });
    if (operation.op === 'patch' || operation.op === 'tombstone') {
      if (known(payload.eventId)) return;
      payload.hlc = hlc.tick();
      if (operation.op === 'patch' && payload.id === 'store:email-groups.json') {
        const prepared = emailClockLists.prepareEmailPatch(state.records[payload.id], payload.patch, { hlc:payload.hlc, at:payload.at, deviceId:state.deviceId });
        payload.listClocks = prepared._listOrders;
      }
    } else if (operation.op === 'delta') {
      if (!known(payload.eventId) && payload.delta.hlc) payload.clockState = hlc.receive(payload.delta.hlc);
    } else if (operation.op === 'package' && !state.appliedPackages[payload.packageId]) {
      const seen = new Set();
      payload.clockStates = (payload.events || []).map(delta => {
        const eid = eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex');
        if (known(eid) || seen.has(eid)) return null;
        seen.add(eid);
        return delta.hlc ? hlc.receive(delta.hlc) : null;
      });
    }
  }

  /* Sıcak yol. Durumun tamamını değil yalnız işlemleri yazar. */
  async function appendOperations(operations) {
    // Validate the whole batch before the first operation mutates cached state.
    for (const operation of typeof operations === 'function' ? [] : operations) {
      if (operation.op === 'delta') validateTransportClocks(operation.payload.delta);
      else if (operation.op === 'package') for (const delta of operation.payload.events || []) validateTransportClocks(delta);
    }
    return withDbLease(async () => {
      recoverPendingWrites();
      await fsp.mkdir(path.dirname(dbFile), { recursive: true });
      /* WAL'ın altında her zaman bir temel anlık görüntü bulunmalı. Yoksa
         dosya hiç oluşmaz; yedekleme, taşıma ve .bak kurtarma yolu dayanacak
         bir taban bulamaz. Yalnız ilk yazmada bir kez ödenir. */
      if (!fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.bak`)) await writeState(dbFile, emptyState(loadDeviceId()));
      const currentWal = await inspectWalForWrite();
      const state = await loadState();
      if (currentWal.tornTail) await writeSnapshot(state);
      if (typeof operations === 'function') operations = await operations(state);
      try {
        const results = operations.map(item => { stampOperation(state, item); return item.apply(state); });

        // A valid checksummed final record may lack its newline. Keep the next
        // record separate so both remain replayable after a restart.
        // Backup recovery/rotation clears metadata. Otherwise the held lease
        // keeps the already validated WAL identity stable during preparation.
        const appendWal = walMetadata || await inspectWalForWrite();
        const separator = appendWal.byteLength && !appendWal.endsWithNewline ? '\n' : '';
        const lines = separator + operations.map(item => walLine(item.op, item.payload)).join('');
        const handle = await fsp.open(walFile(), 'a');
        // fsync ÖNCE, dönüş SONRA: çağırana "kaydedildi" dendiğinde satır diskte.
        try { assertHeldFileLeases(); await handle.writeFile(lines, 'utf8'); await handle.sync(); assertHeldFileLeases(); } finally { await handle.close(); }

        const walStat = await fsp.stat(walFile());
        walMetadata = {
          tag: statTag(walStat), byteLength: walStat.size,
          entryCount: appendWal.entryCount + operations.length,
          endsWithNewline: lines ? lines.endsWith('\n') : appendWal.endsWithNewline,
          truncated: false, tornTail: false,
        };
        if (walStat.size > walMaxBytes || walMetadata.entryCount > WAL_MAX_ENTRIES) await writeSnapshot(state);
        // Durum yerinde değişti ve dosyalar yeniden yazıldı: imzayı tazele ki
        // sıradaki okuma diski boşuna baştan okumasın.
        cachedState = state; cachedTags = await currentTags();
        return results;
      } catch (error) {
        // A later clock/merge/WAL failure must not expose uncommitted cached
        // mutations. Reload the durable snapshot + WAL on the next read.
        invalidateCache();
        throw error;
      }
    });
  }

  // Private application documents share the durable WAL, but never create
  // transport events. The prepared writes and CAS run under the same lease.
  function applyPrivateRecords(state, payload) {
    for (const [key,record] of Object.entries(payload.records || {})) state.records[key] = record;
    state.conflicts.push(...(payload.conflicts || []));
    state.revision = Math.max(Number(state.revision) || 0, Number(payload.revision) || 0);
  }
  async function privateRecordTransaction(prepare) {
    let result;
    await appendOperations(async state => {
      const prepared = await prepare(state); result = prepared.result;
      const payload = {records:prepared.records || {}, conflicts:prepared.conflicts || [], revision:Number(state.revision || 0) + 1};
      for (const [key,record] of Object.entries(payload.records)) {
        if (!record?.doc || !String(key).startsWith(record.doc.kind + ':')) throw new Error('Invalid private document');
      }
      return [{op:'private-records',payload,apply:current => applyPrivateRecords(current,payload)}];
    });
    return result;
  }

  async function transaction(mutator) {
    return withDbLease(async () => {
      recoverPendingWrites();
      const state = await loadState();
      const result = await mutator(state);
      // Rastgele bir mutasyonu işleme çevirmek mümkün değil; bu yol tam
      // görüntü yazar. Sık çağrılmaz (migration işareti, markSynced,
      // çakışma çözümü), sıcak yol appendOperations'tan geçer.
      await writeSnapshot(state);
      cachedState = state; cachedTags = await currentTags();
      return result;
    });
  }
  async function ensure() {
    await fsp.mkdir(path.dirname(dbFile), { recursive: true });
    recoverPendingWrites();
    if (!fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.bak`)) await writeState(dbFile, emptyState(loadDeviceId()));
    return loadState();
  }
  async function read() { return ensure(); }
  function setFolder(folder) {
    const next = path.join(resolveLocalDbFolder(folder), path.basename(dbFile));
    dbFile = next;
    recoveredFolder = '';
    // Konum değişti: bellekteki durum başka bir dosyaya ait.
    invalidateCache();
    recoverPendingWrites();
    return dbFile;
  }
  async function moveTo(folder) {
    const previous = dbFile, next = path.join(resolveLocalDbFolder(folder), path.basename(previous));
    if (path.resolve(previous) === path.resolve(next)) return dbFile;
    await ensure();
    await fsp.mkdir(path.dirname(next), { recursive: true });
    if (fs.existsSync(next)) throw new Error('Seçilen klasörde BuyerLogLocal.db zaten var; veri ezilmedi.');
    // Anlık görüntü tek başına eksiktir: WAL'daki işlemler henüz içine
    // alınmamış olabilir. Taşımadan önce sıkıştır ki hiçbir yazma geride
    // kalmasın, sonra tam durumu yeni konuma yaz.
    const state = await loadState();
    await writeSnapshot(state);
    await writeState(next, state);
    const copied = await readState(next);
    if (Number(copied.revision) !== Number(state.revision) || Object.keys(copied.records || {}).length !== Object.keys(state.records || {}).length) {
      try { await fsp.rm(next, { force: true }); } catch (_) {}
      throw new Error('Yerel DB kopyası doğrulanamadı; eski konum korunuyor.');
    }
    dbFile = next;
    recoveredFolder = path.dirname(next);
    invalidateCache();
    return dbFile;
  }

  /* Tek bir patch'i AÇIK bir transaction state'i üzerine uygular. queuePatch ile
     queuePatches aynı gövdeyi paylaşır; böylece toplu yol tek kayıtlık yoldan
     ayrışıp farklı journal/merge davranışına kayamaz. */
  function applyLocalPatch(state, { id, patch, eventId: eid, at, origin = 'local', baseRevision = null, entityType = 'record', userId = null, owner = { allowed:true, known:false }, hlc = null, listClocks = null, subfields: rawSubfields = null }) {
    const key = recordId(id);
    const subfields = normalizeSubfields(patch, rawSubfields);
    if (state.events[eid] || state.syncLedger?.eventIds?.[eid]) return { duplicate: true, record: clone(state.records[key]), revision: state.revision, eventId: eid };
    restoreHlc(state, hlc);
    // A normal local edit is based on the record revision actually visible on
    // this client. Persist that revision in the outgoing journal so a remote
    // client can distinguish a real same-field race from a sequential edit.
    // Explicit callers (bootstrap/conflict-resolution) may still supply a base.
    const effectiveBaseRevision = baseRevision == null
      ? Number(state.records[key] && state.records[key]._revision) || 0
      : Number(baseRevision) || 0;
    const revision = Math.max(Number(state.revision) || 0, effectiveBaseRevision) + 1;
    // Local writes are authoritative for this device; baseRevision is carried
    // in the journal for remote conflict detection, not used to reject the edit.
    const merged = fieldMerge(state.records[key], patch, revision, null, '', { writer: { d: state.deviceId, s: (Number(state.localSequence) || 0) + 1 }, owner, documentId:key, listClocks, subfields, order:{ userId:String(userId || ''), at, deviceId:state.deviceId, ...(hlc ? {hlc} : {}) } });
    const operation = state.records[key] ? 'update' : 'create';
    state.revision = revision;
    state.localSequence = Number(state.localSequence) + 1;
    state.records[key] = { ...merged.value, _deleted: false };
    delete state.tombstones[key];
    // Sürüm vektörü: bu yazım anında her kaynak cihazdan kesintisiz alınmış son sıra.
    const seenVector = {};
    for (const source of [state.syncCheckpoints || {}, state.causalKnowledge || {}]) {
      for (const [device, seq] of Object.entries(source)) if (Number(seq) > (seenVector[device] || 0)) seenVector[device] = Number(seq);
    }
    const journalItem = { schemaVersion: SCHEMA_VERSION, eventId: eid, id: key, entityType: String(entityType || 'record'), userId: userId == null ? null : String(userId), deviceId: state.deviceId, operation, patch: clone(patch || {}), revision, baseRevision: effectiveBaseRevision, seen: seenVector, localSequence: state.localSequence, at, origin, ...(hlc ? {hlc} : {}), ...(listClocks ? {listClocks} : {}), ...(subfields ? {subfields} : {}), uploaded: false, acknowledged: false, synced: false };
    closeIfLocalOnly(journalItem);
    journalItem.sha256 = sha256(Buffer.from(JSON.stringify({ ...journalItem, sha256: undefined }), 'utf8'));
    state.events[eid] = { eventId: eid, revision, at, origin, deviceId: state.deviceId, localSequence: state.localSequence };
    state.journal.push(journalItem);
    return { duplicate: false, record: clone(state.records[key]), revision, conflicts: merged.conflicts, eventId: eid, localSequence: state.localSequence };
  }

  function applyLocalTombstone(state, { id, eventId: eid, at, origin = 'local', baseRevision = null, entityType = 'record', userId = null, hlc = null }) {
    const key = recordId(id);
    if (state.events[eid] || state.syncLedger?.eventIds?.[eid]) return { duplicate: true, revision: state.revision };
    restoreHlc(state, hlc);
    const effectiveBaseRevision = baseRevision == null
      ? Number(state.records[key] && state.records[key]._revision || state.tombstones[key] && state.tombstones[key].revision) || 0
      : Number(baseRevision) || 0;
    const revision = Math.max(Number(state.revision) || 0, effectiveBaseRevision) + 1;
    state.localSequence = Number(state.localSequence) + 1;
    state.revision = revision;
    state.tombstones[key] = { id: key, revision, baseRevision: effectiveBaseRevision, at, deviceId: state.deviceId };
    delete state.records[key];
    const journalItem = { schemaVersion: SCHEMA_VERSION, eventId: eid, id: key, entityType: String(entityType || 'record'), userId: userId == null ? null : String(userId), deviceId: state.deviceId, operation: 'delete', delete: true, revision, baseRevision: effectiveBaseRevision, localSequence: state.localSequence, at, origin, ...(hlc ? {hlc} : {}), uploaded: false, acknowledged: false, synced: false };
    closeIfLocalOnly(journalItem);
    journalItem.sha256 = sha256(Buffer.from(JSON.stringify({ ...journalItem, sha256: undefined }), 'utf8'));
    state.events[eid] = { eventId: eid, revision, at, origin, deviceId: state.deviceId, localSequence: state.localSequence };
    state.journal.push(journalItem);
    return { duplicate: false, revision, eventId: eid, localSequence: state.localSequence };
  }

  function recordSyncReceipt(state, sourceDeviceId, firstSequence, lastSequence) {
    const source = String(sourceDeviceId || '').trim();
    const first = Math.max(0, Number(firstSequence) || 0), last = Math.max(first, Number(lastSequence) || first);
    if (!source || !last) return Number(state.syncCheckpoints[source] || 0);
    const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, ranges: [], receivedBeyondByDevice: {} };
    ledger.receivedBeyondByDevice = ledger.receivedBeyondByDevice && typeof ledger.receivedBeyondByDevice === 'object' ? ledger.receivedBeyondByDevice : {};
    let checkpoint = Math.max(0, Number(state.syncCheckpoints[source]) || 0);
    let ranges = Array.isArray(ledger.receivedBeyondByDevice[source]) ? ledger.receivedBeyondByDevice[source].map(item => ({ first: Number(item.first)||0, last: Number(item.last)||0 })).filter(item => item.last > checkpoint) : [];
    ranges.push({ first: first || last, last });
    ranges.sort((a,b) => a.first - b.first || a.last - b.last);
    const merged=[];
    for (const range of ranges) {
      const prev=merged[merged.length-1];
      if (prev && range.first <= prev.last + 1) prev.last=Math.max(prev.last,range.last);
      else merged.push({...range});
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      const idx = merged.findIndex(range => range.first <= checkpoint + 1 && range.last > checkpoint);
      if (idx >= 0) { checkpoint = Math.max(checkpoint, merged[idx].last); merged.splice(idx,1); progressed = true; }
      while (merged.length && merged[0].last <= checkpoint) merged.shift();
    }
    state.syncCheckpoints[source] = checkpoint;
    ledger.receivedBeyondByDevice[source] = merged.slice(0, 500);
    return checkpoint;
  }

  function applyRemoteDelta(state, { delta, eventId: eid, at, conflictIds = [], owner = { allowed:true, known:false }, receiptOnly = false, clockState = null }) {
    restoreHlc(state, clockState);
    const firstReceipt = receiptFirstSequence(delta);
    if (state.events[eid] || state.appliedEvents[eid] || state.syncLedger?.eventIds?.[eid]) {
      if (delta.deviceId) recordSyncReceipt(state, delta.deviceId, firstReceipt, Number(delta.sourceLastSeq) || Number(delta.localSequence) || 0);
      return { duplicate: true, applied: false, revision: state.revision };
    }
    const key = recordId(delta.id);
    if (receiptOnly || (owner.known && !owner.allowed && Object.keys(delta.patch || delta.value || {}).some(field => SHARED_CP_FIELDS.has(field)))) {
      state.appliedEvents[eid] = { eventId:eid, deviceId:delta.deviceId || null, userId:delta.userId || null, at, origin:'receipt-only' };
      if (delta.deviceId) recordSyncReceipt(state, delta.deviceId, firstReceipt, Number(delta.sourceLastSeq) || Number(delta.localSequence) || 0);
      return { applied:false, duplicate:false, conflicts:[] };
    }
    const revision = Math.max(Number(delta.revision) || 0, Number(state.revision) || 0);
    const tomb = state.tombstones[key];
    // Çakışma kimlikleri de çağrı anında üretilip WAL'a yazılır; oynatmada
    // yeniden üretilseydi aynı çakışma her açılışta yeni kimlik alırdı.
    let conflictIndex = 0;
    const nextConflictId = () => conflictIds[conflictIndex++] || crypto.randomUUID();
    if (delta.delete || delta.tombstone) {
      const currentRevision = Number(state.records[key]?._revision || tomb?.revision || 0);
      if (delta.baseRevision != null && currentRevision > Number(delta.baseRevision || 0)) {
        state.conflicts.push({ conflictId: nextConflictId(), eventId: eid, id: key, type: 'delete', current: clone(state.records[key] || tomb), incoming: { delete: true }, currentRevision, baseRevision: Number(delta.baseRevision) || 0, at, resolved: false });
      } else {
        if (!tomb || Number(tomb.revision) <= revision) state.tombstones[key] = { id: key, revision, baseRevision: Number(delta.baseRevision) || 0, at, deviceId: delta.deviceId || null };
        delete state.records[key];
      }
    } else if (!tomb || Number(tomb.revision) <= revision) {
      // Bu cihazın emekli kimliğiyle gelen ve yerelde olmayan olay, klasörü
      // kopyalanmış bir kardeş kurulumdan gelir: "aynı cihazın eski olayı"
      // kuralıyla sessizce atlanmamalı, ayrı yazar olarak değerlendirilmeli.
      const writerDevice = delta.deviceId && isRetiredDeviceId(state, delta.deviceId) ? `${delta.deviceId}${CLONE_WRITER_SUFFIX}` : String(delta.deviceId || '');
      const causal = delta.deviceId ? { writer: { d: writerDevice, s: Number(delta.sourceLastSeq) || Number(delta.localSequence) || 0 }, seen: delta.seen, owner, listClocks:delta.listClocks, subfields:normalizeSubfields(delta.patch || delta.value, delta.subfields), order:{ userId:String(delta.userId || ''), at:delta.at || '', deviceId:delta.deviceId, ...(delta.hlc ? {hlc:delta.hlc} : {}) } } : null;
      const merged = fieldMerge(state.records[key], delta.patch || delta.value || {}, revision, delta.baseRevision, key, causal);
      state.records[key] = { ...merged.value, _deleted: false };
      delete state.tombstones[key];
      // Alan, çakışmayı görmüş daha yeni bir olayla çakışmasız güncellendi:
      // o alandaki eski çakışmanın seçenekleri artık geçersiz, kayıt kapanır.
      const conflictedFields = new Set(merged.conflicts.map(item => item.field));
      const appliedFields = new Set(Object.keys(delta.patch || delta.value || {}).filter(field => !conflictedFields.has(field)));
      for (const open of state.conflicts) {
        if (!open.resolved && open.type === 'field' && open.id === key && appliedFields.has(open.field)) {
          open.resolved = true; open.resolvedAt = at; open.resolution = 'superseded';
          pruneResolvedConflict(open);
        }
      }
      for (const conflict of merged.conflicts) state.conflicts.push({ conflictId: nextConflictId(), eventId: eid, id: key, type: 'field', ...conflict, at, resolved: false });
    }
    state.revision = Math.max(Number(state.revision) || 0, revision);
    state.events[eid] = { eventId: eid, revision, at, origin: 'remote', deviceId: delta.deviceId || null, localSequence: Number(delta.localSequence) || 0 };
    state.appliedEvents[eid] = { eventId: eid, revision, at, origin: delta.origin || 'remote', deviceId: delta.deviceId || null, userId:delta.userId || null };
    if (delta.deviceId) recordSyncReceipt(state, delta.deviceId, firstReceipt, Number(delta.sourceLastSeq) || Number(delta.localSequence) || 0);
    return { duplicate: false, applied: true, revision, id: key, conflicts: state.conflicts.filter(item => item.eventId === eid) };
  }

  /* İşlem kimliği ve zaman damgası ÇAĞRI ANINDA çözülür ve WAL'a öyle yazılır.
     Oynatma sırasında yeniden üretilselerdi her açılış farklı bir sonuç verirdi. */
  function resolvePatch(item = {}) {
    const key = recordId(item.id);
    if (!key) throw new Error('Local record id is required.');
    const owner = sharedOwnerOf(key, item.userId);
    if (owner.known && !owner.allowed && Object.keys(item.patch || {}).some(field => SHARED_CP_FIELDS.has(field))) throw Object.assign(new Error('Only the order owner can edit shared fields.'), { code:'ORDER_SHARED_OWNER_ONLY', statusCode:403 });
    return { ...item, id: key, eventId: eventId(item.eventId) || crypto.randomUUID(), at: item.at || now(), owner };
  }

  async function retireOwnerConflicts() {
    const before = await read();
    if (!before.conflicts.some(item => !item.resolved && String(item.id).startsWith('cp-order:') && SHARED_CP_FIELDS.has(item.field))) return 0;
    return transaction(state => {
      let closed = 0;
      for (const conflict of state.conflicts) {
        if (conflict.resolved || !String(conflict.id).startsWith('cp-order:') || !SHARED_CP_FIELDS.has(conflict.field)) continue;
        const record = state.records[conflict.id], currentOrder = record && record._fieldOrders && record._fieldOrders[conflict.field];
        const writer = record && record._fieldWriters && record._fieldWriters[conflict.field];
        const localEvent = writer && state.journal.find(item => item.deviceId === writer.d && Number(item.localSequence) === Number(writer.s));
        const currentOwner = sharedOwnerOf(conflict.id, currentOrder && currentOrder.userId || localEvent && localEvent.userId);
        const authority = sharedOwnerOf(conflict.id, null);
        const event = state.appliedEvents[conflict.eventId];
        const incomingOwner = sharedOwnerOf(conflict.id, event && event.userId);
        if (!authority.authorityKnown && !(currentOwner.known && currentOwner.allowed) && !(incomingOwner.known && incomingOwner.allowed)) continue;
        if (!(currentOwner.known && currentOwner.allowed) && record && incomingOwner.known && incomingOwner.allowed) record[conflict.field] = clone(conflict.incoming);
        conflict.resolved = true; conflict.resolvedAt = now(); conflict.resolution = 'owner-rule'; pruneResolvedConflict(conflict); closed++;
      }
      return closed;
    });
  }

  async function queuePatch(item = {}) {
    const payload = resolvePatch(item);
    const [result] = await appendOperations([{ op: 'patch', payload, apply: state => applyLocalPatch(state, payload) }]);
    return result;
  }

  /* Toplu yazma. Bir içe aktarma binlerce kayıt taşıyabilir; hepsi tek kilit
     turunda ve tek WAL yazımında toplanır. Journal yine kayıt başına bir olay
     üretir — yani sync tanesini ayrı taşıyabilir. */
  async function queuePatches(items = [], { assertCurrent } = {}) {
    const list = (Array.isArray(items) ? items : []).filter(item => item && recordId(item.id)).map(resolvePatch);
    if (!list.length) return { count: 0, results: [] };
    const operations=list.map(payload => ({ op: 'patch', payload, apply: state => applyLocalPatch(state, payload) }));
    const results = await appendOperations(assertCurrent ? state=>{assertCurrent(state);return operations;} : operations);
    return { count: results.filter(result => !result.duplicate).length, results };
  }

  async function tombstone(item = {}) {
    const payload = resolvePatch(item);
    const [result] = await appendOperations([{ op: 'tombstone', payload, apply: state => applyLocalTombstone(state, payload) }]);
    return result;
  }

  async function applyDelta(delta = {}, { receiptOnly = false } = {}) {
    receiptFirstSequence(delta);
    const key = recordId(delta.id);
    if (!key) throw new Error('Delta record id is required.');
    if (delta.sha256) {
      const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
      if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
    }
    const payload = {
      delta, receiptOnly, owner:sharedOwnerOf(key, delta.userId),
      eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
      at: now(),
      // Çakışma başına bir kimlik ayır; alan sayısı üst sınırdır.
      conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, () => crypto.randomUUID()),
    };
    const [result] = await appendOperations([{ op: 'delta', payload, apply: state => applyRemoteDelta(state, payload) }]);
    return result;
  }

  /* v2 sync packages are applied in one local WAL/lease turn. This preserves
     event-level idempotency/conflict semantics while avoiding hundreds of
     local snapshot transactions for one network package. */
  async function applyDeltas(deltas = []) {
    const list = (Array.isArray(deltas) ? deltas : []).filter(Boolean);
    if (!list.length) return { count: 0, applied: 0, duplicates: 0, conflicts: [], results: [] };
    const operations = list.map(delta => {
      receiptFirstSequence(delta);
      const key = recordId(delta.id);
      if (!key) throw new Error('Delta record id is required.');
      if (delta.sha256) {
        const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
        if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
      }
      const payload = {
        delta, owner:sharedOwnerOf(key, delta.userId),
        eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
        at: now(),
        conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, () => crypto.randomUUID()),
      };
      return { op: 'delta', payload, apply: state => applyRemoteDelta(state, payload) };
    });
    const results = await appendOperations(operations);
    const conflicts = results.flatMap(result => Array.isArray(result && result.conflicts) ? result.conflicts : []);
    return {
      count: results.length,
      applied: results.filter(result => result && result.applied).length,
      duplicates: results.filter(result => result && result.duplicate).length,
      conflicts,
      results,
    };
  }

  function applyPackageToState(next, payload = {}) {
    const pid = eventId(payload.packageId);
    const list = (Array.isArray(payload.events) ? payload.events : []).filter(Boolean);
    if (!pid) throw new Error('Sync package id is required.');
    next.appliedPackages = next.appliedPackages && typeof next.appliedPackages === 'object' ? next.appliedPackages : {};
    if (next.appliedPackages[pid]) return { duplicate: true, applied: 0, duplicates: list.length, conflicts: [], packageId: pid };
    for (const delta of list) receiptFirstSequence(delta);
    let applied = 0, duplicates = 0;
    const conflicts = [];
    for (const [index, delta] of list.entries()) {
      const key = recordId(delta && delta.id);
      if (!key) throw new Error('Delta record id is required.');
      if (delta.sha256) {
        const expected = sha256(Buffer.from(JSON.stringify({ ...delta, sha256: undefined }), 'utf8'));
        if (expected !== String(delta.sha256)) throw new Error('Delta checksum doğrulanamadı.');
      }
      const itemPayload = {
        delta, owner:payload.owners && payload.owners[index], clockState:payload.clockStates && payload.clockStates[index],
        eventId: eventId(delta.eventId) || crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
        at: payload.at || now(),
        conflictIds: Array.from({ length: Object.keys(delta.patch || delta.value || {}).length + 1 }, (_, index) => `${pid}:${index}:${eventId(delta.eventId) || key}`),
      };
      const item = applyRemoteDelta(next, itemPayload);
      if (item.applied) applied++;
      if (item.duplicate) duplicates++;
      if (Array.isArray(item.conflicts)) conflicts.push(...item.conflicts);
    }
    const firstSeq = Math.max(0, Number(payload.firstSeq) || (list.length ? Math.min(...list.map(item => Number(item.sourceFirstSeq) || Number(item.localSequence) || 0).filter(Boolean)) : 0));
    const lastSeq = Math.max(firstSeq, Number(payload.lastSeq) || 0);
    next.appliedPackages[pid] = { packageId: pid, sourceDeviceId: String(payload.sourceDeviceId || ''), firstSeq, lastSeq, at: payload.at || now() };
    if (payload.sourceDeviceId && lastSeq) recordSyncReceipt(next, payload.sourceDeviceId, firstSeq || lastSeq, lastSeq);
    return { duplicate: false, applied, duplicates, conflicts, packageId: pid, checkpoint: Number(next.syncCheckpoints[payload.sourceDeviceId] || 0) };
  }

  async function applyPackage({ packageId, sourceDeviceId, firstSeq = 0, lastSeq = 0, events = [] } = {}) {
    const pid = eventId(packageId);
    if (!pid) throw new Error('Sync package id is required.');
    const state = await read();
    if (state.appliedPackages && state.appliedPackages[pid]) return { duplicate: true, applied: 0, duplicates: (events || []).length, conflicts: [], packageId: pid };
    const payload = { owners:(Array.isArray(events) ? events : []).filter(Boolean).map(delta => sharedOwnerOf(delta.id, delta.userId)), packageId: pid, sourceDeviceId: String(sourceDeviceId || ''), firstSeq: Number(firstSeq)||0, lastSeq: Number(lastSeq)||0, events: (Array.isArray(events)?events:[]), at: now() };
    const [result] = await appendOperations([{ op: 'package', payload, apply: next => applyPackageToState(next, payload) }]);
    return result;
  }

  function applyMarkSynced(state, payload = {}) {
    const wanted = new Set((payload.ids || []).map(eventId).filter(Boolean));
    if (!wanted.size) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    for (const item of state.journal) {
      if (!wanted.has(item.eventId) || item.uploaded) continue;
      item.uploaded = true; item.uploadedAt = at; item.synced = true; marked += 1;
    }
    return { marked };
  }
  function applyMarkAcknowledged(state, payload = {}) {
    const wanted = new Set((payload.ids || []).map(eventId).filter(Boolean));
    if (!wanted.size) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, ranges: [] };
    ledger.eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
    ledger.acknowledgedEventIds = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
    const journalIds = new Set();
    for (const item of state.journal) {
      if (!item || !wanted.has(item.eventId)) continue;
      journalIds.add(item.eventId);
      if (item.acknowledged) continue;
      item.acknowledged = true; item.acknowledgedAt = at; marked += 1;
    }
    // Compaction removes full payloads but deliberately keeps lightweight
    // event identities in syncLedger. A legacy/per-event ACK that arrives
    // afterwards must still be remembered, otherwise pendingAck would jump
    // back after a restart/compaction.
    for (const id of wanted) {
      if (journalIds.has(id) || !Object.prototype.hasOwnProperty.call(ledger.eventIds, id) || ledger.acknowledgedEventIds[id]) continue;
      ledger.acknowledgedEventIds[id] = at;
      marked += 1;
    }
    return { marked };
  }
  function applyMarkAcknowledgedThrough(state, payload = {}) {
    const limit = Math.max(0, Number(payload.lastSequence) || 0);
    if (!limit) return { marked: 0 };
    let marked = 0;
    const at = payload.at || now();
    for (const item of state.journal) {
      if (!item.uploaded || item.acknowledged || Number(item.localSequence) > limit) continue;
      item.acknowledged = true; item.acknowledgedAt = at; marked += 1;
    }
    state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, ranges: [] };
    state.syncLedger.acknowledgedThrough = Math.max(Number(state.syncLedger.acknowledgedThrough) || 0, limit);
    // Per-event ACK exceptions at/below the contiguous checkpoint are now
    // redundant. Removing only their ACK markers bounds this metadata; event
    // identities stay for idempotency/duplicate detection.
    const acked = state.syncLedger.acknowledgedEventIds && typeof state.syncLedger.acknowledgedEventIds === 'object' ? state.syncLedger.acknowledgedEventIds : {};
    for (const [id, _at] of Object.entries(acked)) {
      const seq = Number(state.syncLedger.eventIds && state.syncLedger.eventIds[id]) || 0;
      if (seq && seq <= state.syncLedger.acknowledgedThrough) delete acked[id];
    }
    state.syncLedger.acknowledgedEventIds = acked;
    return { marked };
  }

  /* "Yüklenmeyi bekleyen" = henüz hub a yazılmamış olay. Eskiden ölçüt
     !acknowledged idi; onay ise ANCAK BAŞKA bir cihaz paketi okuyup ACK
     yazdığında geliyor. Tek cihazlı kurulumda onaylayacak eş olmadığı için
     sayaç hiç düşmüyor, senkron başarılı olduğu hâlde arayüz kalıcı olarak
     "464 Pending" gösteriyor ve yükleme döngüsü her turda aynı 464 paketi
     yeniden tarıyordu. acknowledged bayrağı yerinde duruyor; görevi yalnızca
     journal budamasıdır (onaylanmamış olay asla atılmaz). */
  async function pending(limit = 1000) {
    const state = await read();
    return state.journal.filter(item => !item.uploaded).slice(0, Math.max(1, Number(limit) || 1000)).map(clone);
  }
  /* Sync'in taşıma politikasını DERİN klondan önce uygular.
     Collection gibi genel delta kanalından bilinçli olarak çıkarılmış büyük
     belgeler, pending() içinde JSON.stringify edilirse V8'in string sınırına
     takılıp bütün senkronu durdurabilir. Filtre ham journal dizisini yalnız
     okumalıdır; kabul edilen kayıtları zaten sanitize/clone ederek döndürür.
     Böylece elenen kayıtların payload'ı hiç serialize edilmez. */
  async function pendingForSync(limit = 1000, filter = null) {
    const state = await read();
    const candidates = state.journal.filter(item => !item.uploaded).slice(0, Math.max(1, Number(limit) || 1000));
    if (typeof filter !== 'function') {
      return { pending: candidates.map(clone), discardedEventIds: [], sourceCount: candidates.length };
    }
    const filtered = filter(candidates);
    const pending = Array.isArray(filtered) ? filtered : [];
    const retained = new Set(pending.map(item => eventId(item && item.eventId)).filter(Boolean));
    const discardedEventIds = candidates
      .map(item => eventId(item && item.eventId))
      .filter(id => id && !retained.has(id));
    return { pending, discardedEventIds, sourceCount: candidates.length };
  }
  /* Yalnız SAYI için: pending()'in varsayılan limiti (1000) gerçek bekleyen
     sayısı ondan büyük olduğunda durum raporunu yanlış gösterirdi (ör. 15.000
     bekleyen kayıt varken "1000 Pending" yazardı). Bu, dilimlemeden/klonlamadan
     tüm günlüğü sayar. */
  async function pendingCount() {
    const state = await read();
    return state.journal.filter(item => !item.uploaded).length;
  }
  /* Onay bekleyen olaylar: budama ve tanılama için. */
  function compactedPendingAckCount(state) {
    const ledger = state && state.syncLedger || {};
    const eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
    const acked = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
    const through = Math.max(0, Number(ledger.acknowledgedThrough) || 0);
    let count = 0;
    for (const [id, rawSeq] of Object.entries(eventIds)) {
      const seq = Math.max(0, Number(rawSeq) || 0);
      if (seq > through && !acked[id]) count += 1;
    }
    return count;
  }
  async function unacknowledged(limit = 1000) {
    const state = await read();
    const max = Math.max(1, Number(limit) || 1000);
    const out = state.journal.filter(item => !item.acknowledged).slice(0, max).map(clone);
    // Full payloads were intentionally compacted. Expose only lightweight
    // diagnostic stubs when a caller explicitly requests the list; sync uses
    // unacknowledgedCount(), so network semantics never depend on these stubs.
    if (out.length < max) {
      const ledger = state.syncLedger || {}, through = Math.max(0, Number(ledger.acknowledgedThrough) || 0);
      const acked = ledger.acknowledgedEventIds || {};
      for (const [id, rawSeq] of Object.entries(ledger.eventIds || {})) {
        const seq = Math.max(0, Number(rawSeq) || 0);
        if (seq <= through || acked[id]) continue;
        out.push({ eventId: id, localSequence: seq, uploaded: true, acknowledged: false, compacted: true });
        if (out.length >= max) break;
      }
    }
    return out;
  }
  async function unacknowledgedCount() {
    const state = await read();
    return state.journal.filter(item => !item.acknowledged).length + compactedPendingAckCount(state);
  }
  async function markSynced(ids = []) {
    const normalized = [...new Set(ids.map(eventId).filter(Boolean))];
    if (!normalized.length) return { marked: 0 };
    const payload = { ids: normalized, at: now() };
    const [result] = await appendOperations([{ op: 'mark-synced', payload, apply: state => applyMarkSynced(state, payload) }]);
    return result;
  }
  async function markAcknowledged(ids = []) {
    const normalized = [...new Set(ids.map(eventId).filter(Boolean))];
    if (!normalized.length) return { marked: 0 };
    const payload = { ids: normalized, at: now() };
    const [result] = await appendOperations([{ op: 'mark-ack', payload, apply: state => applyMarkAcknowledged(state, payload) }]);
    return result;
  }
  async function markAcknowledgedThrough(lastSequence) {
    const limit = Math.max(0, Number(lastSequence) || 0);
    if (!limit) return { marked: 0 };
    const payload = { lastSequence: limit, at: now() };
    const [result] = await appendOperations([{ op: 'mark-ack-through', payload, apply: state => applyMarkAcknowledgedThrough(state, payload) }]);
    return result;
  }

  function businessStateHashFromState(state) {
    const business = {
      records: state.records || {}, tombstones: state.tombstones || {}, conflicts: state.conflicts || [],
      assets: state.assets || {}, migrations: state.migrations || {}, revision: Number(state.revision) || 0,
    };
    return jsonSha256(business);
  }
  async function businessHash() { return businessStateHashFromState(await read()); }
  async function stats() {
    const state = await read();
    let bytes = 0, backupBytes = 0, walBytes = 0;
    try { bytes = (await fsp.stat(dbFile)).size; } catch (_) {}
    try { backupBytes = (await fsp.stat(`${dbFile}.bak`)).size; } catch (_) {}
    try { walBytes = (await fsp.stat(walFile())).size; } catch (_) {}
    const journal = state.journal || [];
    return {
      schemaVersion: state.schemaVersion, bytes, backupBytes, walBytes,
      records: Object.keys(state.records || {}).length, journal: journal.length,
      events: Object.keys(state.events || {}).length,
      unsynced: journal.filter(item => !item.uploaded).length,
      uploaded: journal.filter(item => item.uploaded).length,
      acknowledged: journal.filter(item => item.acknowledged).length + Math.max(0, Object.keys(state.syncLedger?.eventIds || {}).length - compactedPendingAckCount(state)),
      pendingAck: journal.filter(item => !item.acknowledged).length + compactedPendingAckCount(state),
      compactedEvents: Number(state.syncLedger?.compactedEvents) || 0,
      compactedThrough: Number(state.syncLedger?.compactedThrough) || 0,
      ledgerEventIds: Object.keys(state.syncLedger?.eventIds || {}).length,
      businessHash: businessStateHashFromState(state),
    };
  }

  async function compact(options = {}) {
    const keepUploadedTail = Math.max(100, Number(options.keepUploadedTail) || 1000);
    return withDbLease(async () => {
      recoverPendingWrites();
      await inspectWalForWrite(true);
      const state = await loadState();
      const beforeHash = businessStateHashFromState(state);
      const before = await stats();
      const journal = Array.isArray(state.journal) ? state.journal : [];
      const uploadedIndexes = journal.map((item, index) => item && item.uploaded ? index : -1).filter(index => index >= 0);
      const keepIndexes = new Set(uploadedIndexes.slice(-keepUploadedTail));
      const nextJournal = [];
      const ledger = state.syncLedger = state.syncLedger || { version: 1, eventIds: {}, acknowledgedEventIds: {}, compactedEvents: 0, compactedThrough: 0, acknowledgedThrough: 0, ranges: [] };
      ledger.eventIds = ledger.eventIds && typeof ledger.eventIds === 'object' ? ledger.eventIds : {};
      ledger.acknowledgedEventIds = ledger.acknowledgedEventIds && typeof ledger.acknowledgedEventIds === 'object' ? ledger.acknowledgedEventIds : {};
      let compacted = 0, firstSeq = 0, lastSeq = 0;
      for (let index = 0; index < journal.length; index += 1) {
        const item = journal[index];
        if (!item || !item.uploaded || keepIndexes.has(index)) { nextJournal.push(item); continue; }
        const seq = Number(item.localSequence) || 0;
        ledger.eventIds[item.eventId] = seq;
        if (state.events && state.events[item.eventId]) delete state.events[item.eventId];
        compacted += 1;
        if (!firstSeq || (seq && seq < firstSeq)) firstSeq = seq;
        if (seq > lastSeq) lastSeq = seq;
      }
      if (compacted) {
        ledger.compactedEvents = (Number(ledger.compactedEvents) || 0) + compacted;
        ledger.compactedThrough = Math.max(Number(ledger.compactedThrough) || 0, lastSeq);
        ledger.ranges = Array.isArray(ledger.ranges) ? ledger.ranges : [];
        ledger.ranges.push({ firstSequence: firstSeq, lastSequence: lastSeq, count: compacted, compactedAt: now() });
        ledger.ranges = ledger.ranges.slice(-200);
      }
      state.journal = nextJournal;
      // Drop references to compacted full payloads before serializing the new
      // state. On a 295 MB real DB this materially lowers peak memory during
      // compaction; retained tail objects are still referenced by nextJournal.
      journal.length = 0;
      state.schemaVersion = SCHEMA_VERSION;
      const afterHash = businessStateHashFromState(state);
      if (beforeHash !== afterHash) throw Object.assign(new Error('LOCAL_DB_COMPACTION_BUSINESS_HASH_MISMATCH'), { code: 'DATA_INTEGRITY_ERROR' });

      const buffer = jsonToBuffer(state);
      const compacting = `${dbFile}.compacting`;
      const handle = await fsp.open(compacting, 'w');
      try { await handle.writeFile(buffer); try { await handle.sync(); } catch (_) {} } finally { await handle.close(); }
      const verified = normalizeState(await readJsonFile(compacting), state.deviceId);
      if (businessStateHashFromState(verified) !== beforeHash) throw Object.assign(new Error('LOCAL_DB_COMPACTION_TEMP_VALIDATION_FAILED'), { code: 'DATA_INTEGRITY_ERROR' });
      const folder = path.dirname(dbFile);
      const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
      await recovery.replace(dbFile, buffer);
      // The recovery layer first creates a .bak of the old large file. Replace
      // that backup only AFTER the compacted primary has been validated.
      await recovery.replace(`${dbFile}.bak`, buffer);
      // Replacing the backup itself creates a temporary backup-of-backup in
      // the generic recovery layer. At this point both primary and .bak have
      // independently verified compact hashes, so the redundant pre-compact
      // backup can be removed safely.
      try { await fsp.unlink(`${dbFile}.bak.bak`); } catch (_) {}
      await recovery.replace(walFile(), Buffer.alloc(0));
      await recovery.replace(`${walFile()}.bak`, Buffer.alloc(0));
      try { await fsp.unlink(`${walFile()}.bak.bak`); } catch (_) {}
      try { await fsp.unlink(compacting); } catch (_) {}
      cachedState = state; cachedTags = await currentTags();
      const after = await stats();
      return { compacted, keepUploadedTail, before, after, bytesFreed: Math.max(0, (before.bytes + before.backupBytes + before.walBytes) - (after.bytes + after.backupBytes + after.walBytes)), businessHashBefore: beforeHash, businessHashAfter: after.businessHash };
    });
  }

  async function listConflicts(limit = 200) {
    const state = await read();
    return state.conflicts.filter(item => !item.resolved).slice(0, Math.max(1, Number(limit) || 200)).map(clone);
  }
  /* Arayüz için hafif liste: iki tarafın tam değeri yerine sınırlı önizleme.
     Tam değerleri tek JSON yanıtına koymak büyük belge alanlarında V8 string
     sınırını aşıp "Sync çakışmaları okunamadı" hatası veriyordu. */
  async function listConflictSummaries(limit = 200, previewChars = 4000) {
    const state = await read();
    return state.conflicts.filter(item => !item.resolved).slice(0, Math.max(1, Number(limit) || 200)).map(item => summarizeConflict(item, previewChars));
  }
  async function resolveConflict(conflictId, choice = 'current', customValue) {
    const id = eventId(conflictId);
    const state = await read();
    const conflict = state.conflicts.find(item => item.conflictId === id && !item.resolved);
    if (!conflict) throw new Error('Çakışma bulunamadı veya zaten çözüldü.');
    /* Çözüm, çakışan İKİ revizyonu da aşan bir tabanla yayımlanır. Aksi hâlde
       karşı değeri kabul etmiş cihazlar kararı yeni bir çakışma sayar ya da
       ("benimkini koru" seçiminde) hiç duymaz ve cihazlar kalıcı olarak ayrışır. */
    const incomingRevision = Number(state.events[conflict.eventId] && state.events[conflict.eventId].revision) || 0;
    const resolutionBase = Math.max(Number(conflict.currentRevision) || 0, incomingRevision);
    if (choice === 'incoming' && conflict.type === 'field') {
      await queuePatch({ id: conflict.id, patch: { [conflict.field]: customValue === undefined ? conflict.incoming : customValue }, baseRevision: resolutionBase, origin: 'conflict-resolution' });
    } else if (choice === 'current' && conflict.type === 'field') {
      const record = state.records[conflict.id];
      const kept = record && Object.prototype.hasOwnProperty.call(record, conflict.field) ? record[conflict.field] : conflict.current;
      await queuePatch({ id: conflict.id, patch: { [conflict.field]: kept === undefined ? null : clone(kept) }, baseRevision: resolutionBase, origin: 'conflict-resolution' });
    } else if (choice === 'incoming' && conflict.type === 'delete') {
      await tombstone({ id: conflict.id, baseRevision: conflict.currentRevision, origin: 'conflict-resolution' });
    } else if (choice !== 'current' && choice !== 'incoming') {
      throw new Error('Çakışma seçimi geçersiz.');
    }
    return transaction(async next => {
      const item = next.conflicts.find(entry => entry.conflictId === id);
      if (item) { item.resolved = true; item.resolvedAt = now(); item.resolution = choice; pruneResolvedConflict(item); }
      return item ? clone(item) : null;
    });
  }
  async function putAsset({ id, buffer, mimeType = '', filename = '' } = {}) {
    const key = recordId(id);
    if (!key || !Buffer.isBuffer(buffer)) throw new Error('Local asset id and buffer are required.');
    return transaction(async state => {
      const item = { id: key, mimeType: String(mimeType), filename: String(filename), bytes: buffer.length, sha256: sha256(buffer), data: buffer.toString('base64'), updatedAt: now() };
      state.assets[key] = item;
      return { ...item, data: undefined };
    });
  }
  async function putAssets(items = []) {
    const normalized = items.filter(item => item && recordId(item.id) && Buffer.isBuffer(item.buffer)).map(item => ({
      id: recordId(item.id), mimeType: String(item.mimeType || ''), filename: String(item.filename || ''),
      bytes: item.buffer.length, sha256: sha256(item.buffer), data: item.buffer.toString('base64'), updatedAt: now(),
    }));
    if (!normalized.length) return { count: 0 };
    return transaction(async state => { for (const item of normalized) state.assets[item.id] = item; return { count: normalized.length }; });
  }
  /* CİHAZ KİMLİĞİNİ YENİLE (kopya kurulum onarımı).

     Yeni bir deviceId üretilir ve bu kurulumun journal'ında duran bütün yerel
     olaylar AYNI eventId ile, yeni kimlik altında 1'den başlayan kesintisiz
     sırayla yeniden yayımlanmak üzere kuyruğa alınır:
     - olayı zaten almış cihazlar eventId ile duplicate sayar, iki kez uygulamaz;
     - kardeş kopya (eski ortak klasörü "kendi klasörü" sandığı için) hiç
       almadığı olayları bu yolla alır.
     Eski kimliğe kadar kendi yazdıklarımız nedensel olarak "görülmüş" kalır;
     böylece önceki kendi düzenlemelerimiz diğer cihazlarda sahte çakışma
     üretmez. Eski kimliğin sıkıştırılmış (yeniden yayımlanamayan) olaylarının
     ACK borcu kapatılır; sıra alanı yeni kimlikle sıfırdan başlar.
     İş kaydı (records) değişmez. */
  async function rotateDeviceId({ reason = 'manual', fingerprint = '' } = {}) {
    return withDbLease(async () => {
      recoverPendingWrites();
      await fsp.mkdir(path.dirname(dbFile), { recursive: true });
      if (!fs.existsSync(dbFile) && !fs.existsSync(`${dbFile}.bak`)) await writeState(dbFile, emptyState(loadDeviceId()));
      const state = await loadState();
      const at = now();
      const previous = String(state.deviceId || '');
      const previousSequence = Number(state.localSequence) || 0;
      let next = crypto.randomUUID();
      while (next === previous || isRetiredDeviceId(state, next)) next = crypto.randomUUID();
      if (previous) {
        state.causalKnowledge = state.causalKnowledge && typeof state.causalKnowledge === 'object' ? state.causalKnowledge : {};
        state.causalKnowledge[previous] = Math.max(Number(state.causalKnowledge[previous]) || 0, previousSequence);
        state.retiredDeviceIds = retiredDeviceIds(state).concat([{ deviceId: previous, lastSequence: previousSequence, retiredAt: at, reason: String(reason || '').slice(0, 80) }]).slice(-20);
      }
      const inJournal = new Set();
      let sequence = 0;
      for (const item of state.journal) {
        if (!item || !item.eventId) continue;
        sequence += 1;
        inJournal.add(item.eventId);
        item.deviceId = next;
        item.localSequence = sequence;
        // Yerel kalan olay hiç yayımlanmaz; yeni kimlikte de kapalı kalır.
        if (!item.localOnly) {
          item.uploaded = false; item.synced = false; item.acknowledged = false;
          delete item.uploadedAt; delete item.acknowledgedAt;
        }
        item.reissuedFrom = previous;
        item.sha256 = sha256(Buffer.from(JSON.stringify({ ...item, sha256: undefined }), 'utf8'));
        if (state.events[item.eventId]) state.events[item.eventId] = { ...state.events[item.eventId], deviceId: next, localSequence: sequence };
      }
      const ledger = state.syncLedger;
      for (const id of Object.keys(ledger.eventIds || {})) {
        if (!inJournal.has(id) && !ledger.acknowledgedEventIds[id]) ledger.acknowledgedEventIds[id] = at;
      }
      ledger.acknowledgedThrough = 0;
      ledger.compactedThrough = 0;
      state.localSequence = sequence;
      state.deviceId = next;
      state.deviceBinding = { fingerprint: String(fingerprint || (state.deviceBinding && state.deviceBinding.fingerprint) || ''), deviceId: next, boundAt: at };
      await writeSnapshot(state);
      // Eski WAL'lar emekli kimliğin "yüklendi" işaretlerini taşır; oynatılırsa
      // yeniden kuyruğa alınan olaylar tekrar "yüklendi" sayılırdı.
      const folder = path.dirname(dbFile);
      const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
      await recovery.replace(walFile(), Buffer.alloc(0));
      await recovery.replace(`${walFile()}.bak`, Buffer.alloc(0));
      try { await fsp.unlink(`${walFile()}.bak.bak`); } catch (_) {}
      deviceId = next;
      cachedState = state; cachedTags = await currentTags();
      return { rotated: true, previousDeviceId: previous, deviceId: next, reissued: sequence, reason: String(reason || '') };
    });
  }
  /* Kurulum parmak izi (bilgisayar + Windows kullanıcısı) DB'ye mühürlenir.
     Mühürsüz eski DB bu kurulumu sahiplenir; mühür başka bir kuruluma aitse
     veri klasörü kopyalanmış demektir ve kimlik yenilenir. */
  async function ensureDeviceBinding(fingerprint) {
    const fp = String(fingerprint || '').trim();
    if (!fp) return { status: 'skipped', deviceId: loadDeviceId() };
    const state = await read();
    const binding = state.deviceBinding && typeof state.deviceBinding === 'object' ? state.deviceBinding : null;
    if (binding && binding.fingerprint && binding.fingerprint !== fp) {
      return { status: 'rotated', ...(await rotateDeviceId({ reason: 'installation-copied', fingerprint: fp })) };
    }
    if (binding && binding.fingerprint === fp && binding.deviceId === state.deviceId) return { status: 'bound', deviceId: state.deviceId };
    const status = binding && binding.fingerprint === fp ? 'bound' : 'adopted';
    return transaction(async current => {
      current.deviceBinding = { fingerprint: fp, deviceId: current.deviceId, boundAt: now() };
      return { status, deviceId: current.deviceId };
    });
  }
  return { get file() { return dbFile; }, getFile: () => dbFile, getDeviceId: () => loadDeviceId(), setTransportFilter, setSharedOwnerResolver, retireOwnerConflicts, rotateDeviceId, ensureDeviceBinding, setFolder, moveTo, ensure, read, transaction, privateRecordTransaction, mergeCheckpointClockState, queuePatch, queuePatches, tombstone, applyDelta, applyDeltas, applyPackage, pending, pendingForSync, pendingCount, unacknowledged, unacknowledgedCount, markSynced, markAcknowledged, markAcknowledgedThrough, stats, businessHash, compact, listConflicts, listConflictSummaries, resolveConflict, putAsset, putAssets };
}

/* ===================================================================
   v7.85 — ÖLÜ LEGACY ASSET YÜKÜNÜN SICAK DURUMDAN ÇIKARILMASI

   Emekliye ayrılan whole-folder migration'ı (aşağıdaki migrateLegacyFiles)
   kullanıcı klasörlerindeki dosyaları Base64 olarak state.assets içine
   kopyalamıştı. Bu kayıtları HİÇBİR kod okumuyor: putAsset/putAssets'in
   üretimde çağıranı yok ve state.assets yalnız yazılıyor.

   Ölçüldü: gerçek bir kullanıcı DB'sinde 1149 asset = 11.6 MB, yani
   dosyanın %99.4'ü. Her transaction bu yükü baştan sona ödüyor —
   readState (11.7 MB oku + parse), prepare (hedefi hashle, payload yaz),
   commitPrepared (payload'ı geri oku + hashle, tmp yaz, .bak'a kopyala,
   hedefi tekrar oku + hashle). Tek bir kayıt için ~70 MB I/O ve 11.7 MB
   üzerinde 4 SHA-256 geçişi.

   Ölçüm: 110 ms/transaction → 12 ms/transaction, dosya 11.7 MB → 5 KB.

   Kayıtlar SİLİNMEZ; yanına arşiv dosyasına taşınır ve sıcak durumdan
   çıkarılır. Migration idempotenttir: işaret konduktan sonra tekrar
   çalışmaz.
   =================================================================== */
const LEGACY_ASSET_ARCHIVE_SUFFIX = '.assets-legacy.json';

async function offloadLegacyAssets(db) {
  const before = await db.read();
  if (before.migrations && before.migrations.legacyAssets) return { moved: 0, skipped: true };
  const count = Object.keys(before.assets || {}).length;
  if (count) {
    const archive = `${db.getFile ? db.getFile() : db.file}${LEGACY_ASSET_ARCHIVE_SUFFIX}`;
    const folder = path.dirname(path.resolve(archive));
    const recovery = createDurableFileRecovery({ recoveryRoot: path.join(folder, '.buyerlog-db-recovery'), allowedRoots: [folder] });
    await recovery.replace(archive, Buffer.from(JSON.stringify({
      archivedAt: now(), reason: 'unreferenced-legacy-file-import', count, assets: before.assets,
    }, null, 2), 'utf8'));
  }
  await db.transaction(async state => {
    state.assets = {};
    state.migrations = { ...(state.migrations || {}), legacyAssets: { at: now(), count, status: 'archived' } };
    return null;
  });
  return { moved: count, skipped: false };
}

/* Atomic temp → rename yolunda hedef dosya Windows tarafından kilitliyken
   (Defender taraması, yedekleme ajanı) rename EPERM verir ve finally içindeki
   unlink de aynı kilide takılır. Geride tam boyutlu bir .tmp kalır ve hiçbir
   şey onu toplamaz. Gerçek bir kullanıcı klasöründe ölçüldü: 127 yetim tmp,
   toplam 1.24 GB. Süpürücü yalnız bu kod tabanının temp adlandırma desenine
   uyan ve eşik yaşından eski dosyaları siler; uçuştaki yazımlara dokunmaz. */
const TEMP_DEBRIS = /\.\d+\.\d+(\.[0-9a-f]+)?\.(tmp|rollback)$/i;

async function sweepWriteDebris(folder, { olderThanMs = 3600000 } = {}) {
  const result = { removed: 0, bytes: 0, failed: 0 };
  let names = [];
  try { names = await fsp.readdir(folder); } catch (_) { return result; }
  const cutoff = Date.now() - Math.max(60000, Number(olderThanMs) || 3600000);
  for (const name of names) {
    if (!TEMP_DEBRIS.test(name)) continue;
    const file = path.join(folder, name);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
      await fsp.unlink(file);
      result.removed += 1; result.bytes += stat.size;
    } catch (_) { result.failed += 1; }
  }
  return result;
}

async function migrateLegacyFiles(db, roots = []) {
  const before = await db.read();
  if (before.migrations && before.migrations.legacyFiles) return [];
  // This migration predated the delta-sync registry and copied every local file
  // as Base64 into one JSON database.  Nothing reads those legacy asset records;
  // on real user folders the aggregate string exceeded V8's string limit and the
  // failed scan repeated at every startup.  Retire it with an idempotent marker.
  await db.transaction(async state => {
    state.migrations = { ...(state.migrations || {}), legacyFiles: { at: now(), count: 0, status: 'retired', reason: 'delta-sync-managed-data-only' } };
    return null;
  });
  return [];
}

module.exports = { SCHEMA_VERSION, DEFAULT_DB_NAME, createLocalDb, summarizeConflict, migrateLegacyFiles, offloadLegacyAssets, sweepWriteDebris };
