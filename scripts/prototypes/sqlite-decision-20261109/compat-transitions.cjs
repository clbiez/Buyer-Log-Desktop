'use strict';
// Pure state transitions copied from pinned Main local-db.js. See
// compat-r2/transition-provenance.json. No filesystem or createLocalDb engine.
const crypto = require('node:crypto');
const hybridClock = require('../../../resources/app/server/lib/hlc');
const emailClockLists = require('../../../resources/app/server/lib/hlc-email-list');
const quotationLedger = require('../../../resources/app/server/lib/quotation-ledger');
const SCHEMA_VERSION = 3;
const CLONE_WRITER_SUFFIX = '#clone';
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


function retiredDeviceIds(state) {
  return Array.isArray(state && state.retiredDeviceIds) ? state.retiredDeviceIds.filter(item => item && item.deviceId) : [];
}

function isRetiredDeviceId(state, id) {
  const wanted = String(id || '');
  return Boolean(wanted) && retiredDeviceIds(state).some(item => String(item.deviceId) === wanted);
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

function pruneResolvedConflict(item) {
  if (!item || !item.resolved || item.valuesPruned) return item;
  delete item.current; delete item.incoming;
  item.valuesPruned = true;
  return item;
}

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


function transitions({ clock = Date.now, trace = null } = {}) {
  let transportFilter = null, sharedOwnerResolver = null;
  function setSharedOwnerResolver(resolve) { sharedOwnerResolver = typeof resolve === 'function' ? resolve : null; }

  function sharedOwnerOf(id, userId) {
    if (!String(id).startsWith('cp-order:') || !sharedOwnerResolver) return { allowed: true, known: false };
    return sharedOwnerResolver(id, userId);
  }

  function closeIfLocalOnly(journalItem) {
    if (!transportFilter) return;
    let transportable = true;
    try { transportable = transportFilter(journalItem) !== false; } catch (_) { transportable = true; }
    if (transportable) return;
    journalItem.localOnly = true;
    journalItem.uploaded = true; journalItem.synced = true; journalItem.acknowledged = true;
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

  function resolvePatch(item = {}) {
    const key = recordId(item.id);
    if (!key) throw new Error('Local record id is required.');
    const owner = sharedOwnerOf(key, item.userId);
    if (owner.known && !owner.allowed && Object.keys(item.patch || {}).some(field => SHARED_CP_FIELDS.has(field))) throw Object.assign(new Error('Only the order owner can edit shared fields.'), { code:'ORDER_SHARED_OWNER_ONLY', statusCode:403 });
    return { ...item, id: key, eventId: eventId(item.eventId) || crypto.randomUUID(), at: item.at || now(), owner };
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
  return { setSharedOwnerResolver, validateTransportClocks, stampOperation, applyLocalPatch, applyLocalTombstone, applyRemoteDelta, resolvePatch, applyMarkSynced, applyMarkAcknowledged, applyMarkAcknowledgedThrough, compactedPendingAckCount };
}
module.exports = { transitions, emptyState, normalizeState, clone, eventId, recordId, receiptFirstSequence, pruneResolvedConflict };
