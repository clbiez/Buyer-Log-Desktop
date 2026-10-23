'use strict';

const fs = require('fs');
const path = require('path');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const {guardedDocumentMutation,HELD_DOCUMENT_LEASE}=require('./guarded-document-mutation');
const { withFileLeaseSync } = require('./shared-file-transaction');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const ledger = require('./quotation-ledger');

const FILE = path.join(SERVER_DATA_ROOT, 'quotations.json');
/* Delta motoruna taşınmış belge; kimlik veri köküne göreli yol. */
const DOCUMENT_ID = 'quotations.json';
const { createDocumentApi } = require('./delta-store');
let documents = createDocumentApi(null);
function attachDeltaStore(store) { documents = createDocumentApi(store); return documents; }
const VISIBILITY_DIR = path.join(SERVER_DATA_ROOT, 'quotation-visibility');
const RETENTION_YEARS = 2;
const MAX_IMPORT_REQUESTS = 10000;
const MAX_ITEMS = 50000;
const MAX_MANUFACTURERS = 1000;

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function cleanId(value) { return clean(value, 160).replace(/[^A-Za-z0-9_.:-]/g, '_'); }
function cleanObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanId).filter(Boolean))].slice(0, 500);
}
function now() { return new Date().toISOString(); }
function defaultStore() { return { schemaVersion: 1, requests: [], deletedRequests: {}, _revision: 0, _updatedAt: null }; }
/* Silme izi: saklama süresi dolan kayıt kaldırılınca kimliği zamanıyla tutulur.
   Cihazlar arası liste birleşimi kimlikle yapıldığından, izi olmayan silme eski
   bir uzak kopyadan geri gelirdi. */
const MAX_DELETED_REQUESTS = 2000;
function normalizeDeletedRequests(value) {
  const src = cleanObject(value);
  return Object.fromEntries(Object.entries(src)
    .map(([id, at]) => [cleanId(id), clean(at, 80)]).filter(([id, at]) => id && at)
    .sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_DELETED_REQUESTS));
}
function withoutDeletedRequests(requests, deleted) {
  return requests.filter(request => !(deleted[request.id] && String(deleted[request.id]) >= String(request.updatedAt || '')));
}

function normalizeManufacturer(value) {
  const src = cleanObject(value);
  return { name: clean(src.name, 240), email: clean(src.email, 320) };
}
function normalizeItem(value) {
  const src = cleanObject(value);
  const rowId = src.rowId !== null && src.rowId !== '' && Number.isFinite(Number(src.rowId)) ? Number(src.rowId) : null;
  const quantity = src.quantity !== null && src.quantity !== '' && Number.isFinite(Number(src.quantity)) ? Number(src.quantity) : null;
  return {
    id: cleanId(src.id) || `quote-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    modelKey: clean(src.modelKey, 300), rowId,
    orderCode: clean(src.orderCode, 160), plmId: clean(src.plmId, 160), modelCode: clean(src.modelCode, 240), license: clean(src.license, 240),
    category: clean(src.category, 240), colour: clean(src.colour, 240), fabric: clean(src.fabric, 1000), season: clean(src.season, 120),
    picture: clean(src.picture, 5000000), inStoreMonth: clean(src.inStoreMonth, 120), quantity, targetPrice: clean(src.targetPrice, 120),
    manufacturer: clean(src.manufacturer, 240), manufacturerEmail: clean(src.manufacturerEmail, 320), price: clean(src.price, 120),
    approved: Boolean(src.approved), dropped: Boolean(src.dropped),
    // Fiyat Defteri: satır revizyonu, son değişiklik ve değişmez olay kaydı.
    rev: Number.isFinite(Number(src.rev)) && Number(src.rev) > 0 ? Math.floor(Number(src.rev)) : 0,
    updatedAt: clean(src.updatedAt, 80), updatedBy: cleanId(src.updatedBy),
    history: ledger.normalizeHistory(src.history),
  };
}
function normalizeRequest(value, defaults = {}) {
  const src = cleanObject(value);
  const createdAt = clean(src.createdAt, 80) || now();
  const status = src.status === 'closed' ? 'closed' : 'active';
  const ownerId = cleanId(src.ownerId || defaults.ownerId);
  const ownerName = clean(src.ownerName || defaults.ownerName, 240);
  return {
    id: cleanId(src.id) || `quotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: src.source === 'cp' ? 'cp' : 'collection',
    origin: src.origin === 'manual-collection' ? 'manual-collection' : '',
    createdAt,
    updatedAt: clean(src.updatedAt, 80) || createdAt,
    status,
    closedAt: status === 'closed' ? (clean(src.closedAt, 80) || clean(src.updatedAt, 80) || now()) : '',
    ownerId,
    ownerName,
    editorIds: uniqueIds(src.editorIds).filter(id => id !== ownerId),
    note: clean(src.note, 10000),
    capacityConfirmed: Boolean(src.capacityConfirmed),
    manufacturers: (Array.isArray(src.manufacturers) ? src.manufacturers : []).slice(0, MAX_MANUFACTURERS).map(normalizeManufacturer).filter(item => item.name),
    items: (Array.isArray(src.items) ? src.items : []).slice(0, MAX_ITEMS).map(normalizeItem).filter(item => item.modelKey && item.manufacturer),
    sortOrder: Number.isFinite(Number(src.sortOrder)) ? Number(src.sortOrder) : 0,
    archived: Boolean(src.archived),
    archiveReason: clean(src.archiveReason, 120),
    mergedIntoId: cleanId(src.mergedIntoId),
    mergedAt: clean(src.mergedAt, 80),
    // Pazarlık turu: 1'den başlar; "Yeni tur" her seferinde bir artırır.
    round: Number.isFinite(Number(src.round)) && Number(src.round) >= 1 ? Math.floor(Number(src.round)) : 1,
    rounds: ledger.normalizeRounds(src.rounds),
  };
}
function normalizeStore(raw) {
  const base = defaultStore();
  return {
    ...base,
    ...cleanObject(raw),
    schemaVersion: 1,
    deletedRequests: normalizeDeletedRequests(raw && raw.deletedRequests),
    requests: withoutDeletedRequests((Array.isArray(raw && raw.requests) ? raw.requests : []).map(item => normalizeRequest(item)), normalizeDeletedRequests(raw && raw.deletedRequests)),
    _revision: Math.max(0, Number(raw && raw._revision) || 0),
  };
}
function loadStore() {
  // Delta yetkiliyse kayıt oradan, değilse eski dosyadan; ikisi de aynı
  // normalizasyondan geçer, yani biçim özdeştir.
  const fromDelta = documents.read(DOCUMENT_ID);
  if (fromDelta) return normalizeStore(fromDelta);
  return readJsonWithValidatedBackup(FILE, {
    fallback: () => defaultStore(),
    normalize: normalizeStore,
    restore: value => atomicWriteJson(FILE, value),
  });
}
function saveStore(store,options={}) {
  const write=()=>{
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const current = loadStore();options.assertAuthority?.();if(options.expectedRevision!=null&&current._revision!==options.expectedRevision)throw Object.assign(new Error('Quotation preview changed.'),{code:'REVISION_CONFLICT',statusCode:409});
  const expected=Math.max(0,Number(store&&store._revision)||0);
  if(current._revision!==expected){const error=new Error('Quotation records changed in another Buyer Log instance. Reload and retry.');error.code='REVISION_CONFLICT';error.statusCode=409;error.expectedRevision=expected;error.currentRevision=current._revision;throw error;}
  const persist=()=>{
  const saved = {
    schemaVersion: 1,
    requests: (Array.isArray(store && store.requests) ? store.requests : []).map(item => normalizeRequest(item)),
    deletedRequests: normalizeDeletedRequests(store && store.deletedRequests !== undefined ? store.deletedRequests : current.deletedRequests),
    _revision: current._revision + 1,
    _updatedAt: now(),
  };
  if (documents.writesLegacy){if(options.legacyWrites)options.legacyWrites.push(()=>{if(!documents.attached)options.assertAuthority?.();atomicWriteJson(FILE,saved);});else atomicWriteJson(FILE,saved);}
  const mirrored=documents.mirror(DOCUMENT_ID,saved,{guardSource:!!options.mirrorResults,assertAuthority:options.assertAuthority});options.mirrorResults?.push(mirrored);
  return saved;
  };return options.withDependencies?options.withDependencies(persist):persist();
  };return options[HELD_DOCUMENT_LEASE]?write():withFileLeaseSync(FILE,write);
}

function retentionTimestamp(request) {
  return Math.max(...['createdAt','updatedAt','closedAt','mergedAt'].map(key => {
    const value = Date.parse(request && request[key] || '');
    return Number.isFinite(value) ? value : 0;
  }));
}
function isRetentionExpired(request, at = Date.now()) {
  const stamp = retentionTimestamp(request);
  if (!(stamp > 0)) return false;
  // '2 sene'yi sabit 730 gün olarak yorumlamak artık yıl içeren dönemlerde bir
  // günü erken purge edebilir. Takvim yılı esas alınır: bugün 25.08.2026 ise
  // ancak 25.08.2024 ve öncesindeki son iş zamanı retention dışındadır.
  const cutoff = new Date(at);
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  return stamp <= cutoff.getTime();
}
function visibilityFile(profileOrId) {
  const id = cleanId(typeof profileOrId === 'string' ? profileOrId : profileOrId && profileOrId.id);
  return id ? path.join(VISIBILITY_DIR, `${id}.json`) : '';
}
function loadVisibility(profileOrId) {
  const file = visibilityFile(profileOrId);
  if (!file || !fs.existsSync(file)) return { schemaVersion: 1, hidden: {} };
  try {
    const raw = cleanObject(JSON.parse(fs.readFileSync(file, 'utf8')));
    const hidden = {};
    for (const [id, stamp] of Object.entries(cleanObject(raw.hidden))) {
      const key = cleanId(id), value = clean(stamp, 80);
      if (key && value) hidden[key] = value;
    }
    return { schemaVersion: 1, hidden };
  } catch (_) { return { schemaVersion: 1, hidden: {} }; }
}
function saveVisibility(profileOrId, value) {
  const file = visibilityFile(profileOrId);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteJson(file, { schemaVersion: 1, hidden: cleanObject(value && value.hidden), _updatedAt: now() });
}
function requestsForUser(profile, options = {}) {
  const store = loadStore();
  const hidden = loadVisibility(profile).hidden;
  const includeHidden = Boolean(options.includeHidden);
  // Görünürlük yetkisi çağırandan gelir (bkz. quotation-visibility.js);
  // düzenleme hakkı olan her zaman görür.
  const canView = typeof options.canView === 'function' ? options.canView : null;
  return {
    ...store,
    requests: store.requests.filter(request => !request.archived && (includeHidden || !hidden[request.id])
      && (!canView || canEdit(profile, request) || canView(request))),
    hiddenIds: includeHidden ? Object.keys(hidden) : [],
  };
}
function hideRequest(profile, id) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request || request.archived) return null;
  const visibility = loadVisibility(profile);
  visibility.hidden[request.id] = now();
  saveVisibility(profile, visibility);
  return request;
}
function restoreRequest(profile, id) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request || request.archived) return null;
  const visibility = loadVisibility(profile);
  delete visibility.hidden[request.id];
  saveVisibility(profile, visibility);
  return request;
}
function cleanupExpired(at = Date.now()) {
  const store = loadStore();
  const expired = new Set(store.requests.filter(request => isRetentionExpired(request, at)).map(request => request.id));
  if (!expired.size) return { removed: 0 };
  store.requests = store.requests.filter(request => !expired.has(request.id));
  const stamp = now();
  store.deletedRequests = normalizeDeletedRequests(store.deletedRequests);
  for (const id of expired) store.deletedRequests[id] = stamp;
  saveStore(store);
  if (fs.existsSync(VISIBILITY_DIR)) {
    for (const name of fs.readdirSync(VISIBILITY_DIR)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(VISIBILITY_DIR, name);
      try {
        const raw = cleanObject(JSON.parse(fs.readFileSync(file, 'utf8')));
        const hidden = cleanObject(raw.hidden);
        let changed = false;
        for (const id of expired) if (Object.prototype.hasOwnProperty.call(hidden, id)) { delete hidden[id]; changed = true; }
        if (changed) atomicWriteJson(file, { ...raw, hidden, _updatedAt: now() });
      } catch (_) {}
    }
  }
  return { removed: expired.size };
}

function findRequest(store, id) { return (store.requests || []).find(item => item.id === cleanId(id)) || null; }
function canEdit(profile, request) {
  if (!profile || !request) return false;
  return profile.role === 'moderator' || request.ownerId === profile.id || request.editorIds.includes(profile.id);
}
function canManageAccess(profile, request) {
  return Boolean(profile && request && (profile.role === 'moderator' || request.ownerId === profile.id));
}
function createRequest(profile, payload,options={}) {
  const store = loadStore();
  const request = normalizeRequest(payload, { ownerId: profile.id, ownerName: profile.displayName });
  request.ownerId = profile.id;
  request.ownerName = clean(profile.displayName || profile.username || profile.id, 240);
  request.editorIds = [];
  request.status = 'active';
  request.closedAt = '';
  request.createdAt = clean(payload && payload.createdAt, 80) || now();
  request.updatedAt = request.createdAt;
  request.sortOrder = Date.now();
  request.round = 1; request.rounds = [];
  // İlk fiyatlar (ör. Koleksiyon'dan elle girilen fiyat) deftere ilk olay olarak yazılır.
  request.items = request.items.map(item => seedLine({ ...item, history: [], rev: 0, updatedAt: '', updatedBy: '' }, profile, request));
  store.requests.unshift(request);
  saveStore(store,options);
  return request;
}
function updateRequest(profile, id, payload,options={}) {
  const store = loadStore();
  const current = findRequest(store, id);
  if (!current) return null;
  if (!canEdit(profile, current)) {
    const error = new Error('Bu quotation kaydını düzenleme yetkiniz bulunmuyor.');
    error.statusCode = 403; error.code = 'QUOTATION_EDIT_DENIED'; throw error;
  }
  // v6.51 — Kapalı quotation içeriğinin düzenlenmesini engelleyen kısıtlama
  // kaldırıldı (kullanıcı kararı: "kapalı quotation'lara edit yasağı koyma").
  // Sahiplik/erişim kontrolü (yukarıdaki canEdit) hâlâ geçerli; yalnız statü
  // temelli kilit kaldırıldı.
  const incoming = normalizeRequest({ ...payload, id: current.id }, { ownerId: current.ownerId, ownerName: current.ownerName });
  incoming.ownerId = current.ownerId;
  incoming.ownerName = current.ownerName;
  incoming.source = current.source;
  incoming.origin = current.origin;
  incoming.editorIds = current.editorIds;
  incoming.createdAt = current.createdAt;
  incoming.status = current.status;
  incoming.closedAt = current.closedAt;
  incoming.updatedAt = now();
  incoming.sortOrder = Number.isFinite(Number(payload && payload.sortOrder)) ? Number(payload.sortOrder) : current.sortOrder;
  incoming.round = current.round || 1;
  incoming.rounds = current.rounds || [];
  incoming.items = reconcileLines(current, incoming.items, rawItems(payload), profile);
  const index = store.requests.findIndex(item => item.id === current.id);
  store.requests[index] = incoming;
  saveStore(store,options);
  return incoming;
}
function rawItems(payload) {
  const map = new Map();
  for (const raw of Array.isArray(payload && payload.items) ? payload.items : []) {
    const id = cleanId(raw && raw.id);
    if (id) map.set(id, raw);
  }
  return map;
}
// Yeni bir satırın ilk durumu deftere yazılır (fiyat ve/veya onay).
function seedLine(line, profile, request) {
  const empty = { price: '', approved: false, dropped: false, history: [], rev: 0 };
  const result = ledger.applyLineChange(empty, { price: line.price, dropped: line.dropped, approved: line.approved }, profile, { round: request.round || 1, source: 'manual' });
  return result.changed ? { ...line, price: result.line.price, approved: result.line.approved, dropped: result.line.dropped, history: result.line.history, rev: result.line.rev, updatedAt: result.line.updatedAt, updatedBy: result.line.updatedBy } : { ...line, history: [], rev: 0 };
}
/* Tam talep (PUT) kaydında satır durumu sunucu defteriyle uzlaştırılır:
   · İstemcinin gönderdiği history yok sayılır; mevcut defter korunur.
   · İstemci satırın daha eski bir revizyonuna dayanıyorsa (rev < mevcut) o
     satırın fiyat/onay/drop alanları EZİLMEZ: başka bir kullanıcının girdiği
     fiyat, not/kapasite gibi ilgisiz bir kayıtla kaybolmaz.
   · rev göndermeyen eski istemci eski davranışla yazar; değişiklik yine
     deftere olay olarak eklenir. */
function reconcileLines(current, items, raws, profile) {
  const before = new Map((current.items || []).map(item => [item.id, item]));
  return (items || []).map(item => {
    const prev = before.get(item.id);
    if (!prev) return seedLine(item, profile, current);
    const raw = raws.get(item.id);
    const baseRev = raw && raw.rev != null && raw.rev !== '' && Number.isFinite(Number(raw.rev)) ? Number(raw.rev) : null;
    const keep = { history: prev.history, rev: prev.rev, updatedAt: prev.updatedAt, updatedBy: prev.updatedBy };
    if (baseRev != null && baseRev < (prev.rev || 0)) return { ...item, price: prev.price, approved: prev.approved, dropped: prev.dropped, ...keep };
    const result = ledger.applyLineChange(prev, { price: item.price, dropped: item.dropped, approved: item.approved }, profile, { round: current.round || 1, source: 'manual' });
    if (!result.changed) return { ...item, price: prev.price, approved: prev.approved, dropped: prev.dropped, ...keep };
    return { ...item, price: result.line.price, approved: result.line.approved, dropped: result.line.dropped, history: result.line.history, rev: result.line.rev, updatedAt: result.line.updatedAt, updatedBy: result.line.updatedBy };
  });
}
function editDenied(message) {
  return Object.assign(new Error(message), { statusCode: 403, code: 'QUOTATION_EDIT_DENIED' });
}
/* TEK SATIR OLAYI (PATCH /api/quotations/:id/lines/:lineId).
   Fiyat girişi, onay ve drop artık bütün talebi yeniden göndermez; yalnız bu
   satırın değişikliği deftere bir olay olarak yazılır. Onay, aynı sahibin aynı
   modeldeki diğer onaylarını kaldırır (model başına tek onay) ve o satırlara
   da "exclusive" kaynaklı unapprove olayı eklenir.
   baseRev farklıysa yazma yine yapılır (önceki değer defterde kalır) ve yanıt
   conflict:true döner; istemci kullanıcıya bilgi verir. */
function patchLine(profile, id, lineId, patch = {}, options = {}) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request) return null;
  const index = request.items.findIndex(item => item.id === cleanId(lineId));
  if (index < 0) return null;
  if (!canEdit(profile, request)) throw editDenied('Bu quotation kaydını düzenleme yetkiniz bulunmuyor.');
  const line = request.items[index];
  const changes = {};
  for (const key of ['price', 'approved', 'dropped']) if (Object.prototype.hasOwnProperty.call(patch, key)) changes[key] = patch[key];
  if (changes.approved === true && ledger.priceNumber(Object.prototype.hasOwnProperty.call(changes, 'price') ? changes.price : line.price) == null) {
    throw Object.assign(new Error('Onay için geçerli bir teklif fiyatı gerekir.'), { code: 'QUOTATION_PRICE_REQUIRED', statusCode: 422 });
  }
  const baseRev = patch.baseRev != null && patch.baseRev !== '' && Number.isFinite(Number(patch.baseRev)) ? Number(patch.baseRev) : null;
  const conflict = baseRev != null && baseRev !== (line.rev || 0);
  const source = ['manual', 'matrix', 'paste', 'import', 'bulk', 'ai', 'collection', 'undo'].includes(patch.source) ? patch.source : 'manual';
  const at = now();
  const result = ledger.applyLineChange(line, changes, profile, { round: request.round || 1, source, at });
  const affected = new Map();
  if (result.changed) {
    request.items[index] = { ...line, ...result.line };
    affected.set(request.id, request);
  }
  if (result.line.approved && !line.approved) {
    // Model başına tek onay: aynı kaynak + sahip + model için diğer onaylar kalkar.
    for (const other of store.requests) {
      if (other.archived || other.source !== request.source || other.ownerId !== request.ownerId || !canEdit(profile, other)) continue;
      if (options.visibleRequestIds && !options.visibleRequestIds.includes(other.id)) continue;
      other.items = other.items.map(item => {
        if (item.id === line.id && other.id === request.id) return item;
        if (item.modelKey !== line.modelKey || !item.approved) return item;
        const off = ledger.applyLineChange(item, { approved: false }, profile, { round: other.round || 1, source: 'exclusive', at });
        if (off.changed) affected.set(other.id, other);
        return off.changed ? { ...item, ...off.line } : item;
      });
    }
  }
  if (!affected.size) return { request, affected: [], changed: false, conflict, line: request.items[index] };
  for (const changed of affected.values()) changed.updatedAt = at;
  saveStore(store, options);
  return { request, affected: [...affected.values()].filter(item => item.id !== request.id), changed: true, conflict, line: request.items[index] };
}
/* Yeni pazarlık turu: sonraki teklif olayları bu tur numarasını taşır. */
function startRound(profile, id, note = '', options = {}) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request) return null;
  if (!canEdit(profile, request)) throw editDenied('Bu quotation kaydını düzenleme yetkiniz bulunmuyor.');
  const at = now(), next = (request.round || 1) + 1;
  request.round = next;
  request.rounds = ledger.normalizeRounds([...(request.rounds || []), { n: next, at, by: profile.id, byName: profile.displayName || profile.username || profile.id, note: clean(note, 1000) }]);
  request.updatedAt = at;
  saveStore(store, options);
  return request;
}
function setStatus(profile, id, status,options={}) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request) return null;
  if (!canEdit(profile, request)) {
    const error = new Error('Bu quotation kaydının durumunu değiştirme yetkiniz bulunmuyor.');
    error.statusCode = 403; error.code = 'QUOTATION_EDIT_DENIED'; throw error;
  }
  request.status = status === 'closed' ? 'closed' : 'active';
  request.closedAt = request.status === 'closed' ? now() : '';
  request.updatedAt = now();
  saveStore(store,options);
  return request;
}
function setEditors(profile, id, editorIds, validUserIds) {
  const store = loadStore();
  const request = findRequest(store, id);
  if (!request) return null;
  if (!canManageAccess(profile, request)) {
    const error = new Error('Bu quotation kaydının düzenleme yetkilerini değiştiremezsiniz.');
    error.statusCode = 403; error.code = 'QUOTATION_ACCESS_DENIED'; throw error;
  }
  const valid = new Set(validUserIds || []);
  request.editorIds = uniqueIds(editorIds).filter(userId => userId !== request.ownerId && valid.has(userId));
  request.updatedAt = now();
  saveStore(store);
  return request;
}
function deleteRequest(profile, id) { return hideRequest(profile, id); }
function mergeRequests(profile, sourceId, targetId) {
  const store = loadStore();
  const source = findRequest(store, sourceId);
  const target = findRequest(store, targetId);
  if (!source || !target) return null;
  if (source.id === target.id || source.source !== target.source) {
    const error = new Error('Yalnız aynı ekrandaki iki farklı quotation kaydı birleştirilebilir.');
    error.statusCode = 400; error.code = 'QUOTATION_MERGE_INVALID'; throw error;
  }
  if (!canManageAccess(profile, source) || !canManageAccess(profile, target)) {
    const error = new Error('Quotation birleştirme işlemi için iki kaydın da sahibi olmanız gerekir.');
    error.statusCode = 403; error.code = 'QUOTATION_MERGE_DENIED'; throw error;
  }
  // v6.47 — Kapalı kayıtları birleştirme yasağı KALDIRILDI (kullanıcı kararı:
  // "kapalı kayıt hem kaynak hem hedef olabilsin, tam serbest"). Kapalı bir
  // kayıt artık hem kaynak (silinir) hem hedef (korunur, içeriği zenginleşir)
  // olabilir. Hedef kapalıysa birleşme sonrası da KAPALI kalır — birleştirme
  // statüyü değiştirmez, yalnız iki kaydın içeriğini tek kayıtta toplar.

  // Bırakma hedefi ana kayıttır. Aynı model + üretici satırı iki kayıtta da
  // varsa hedefteki dolu değerler korunur; yalnız hedefte boş olan alanlar
  // kaynak satırdan tamamlanır. Böylece fiyat/onay kaybı veya çift satır oluşmaz.
  const manufacturers = new Map();
  [...target.manufacturers, ...source.manufacturers].forEach(item => {
    const normalized = normalizeManufacturer(item); if (!normalized.name) return;
    const key = normalized.name.toLocaleUpperCase('tr-TR');
    const current = manufacturers.get(key);
    manufacturers.set(key, current ? { ...current, email: current.email || normalized.email } : normalized);
  });
  const items = new Map();
  const itemKey = item => `${clean(item.modelKey, 300).toLocaleUpperCase('tr-TR')}\u0000${clean(item.manufacturer, 240).toLocaleUpperCase('tr-TR')}`;
  [...target.items, ...source.items].forEach(raw => {
    const item = normalizeItem(raw), key = itemKey(item), current = items.get(key);
    if (!current) { items.set(key, item); return; }
    const merged = { ...current };
    for (const field of ['orderCode','plmId','modelCode','license','category','colour','fabric','season','picture','inStoreMonth','targetPrice','manufacturerEmail','price']) {
      if (!clean(merged[field], field === 'picture' ? 5000000 : 1000) && clean(item[field], field === 'picture' ? 5000000 : 1000)) merged[field] = item[field];
    }
    if (merged.rowId == null && item.rowId != null) merged.rowId = item.rowId;
    if (merged.quantity == null && item.quantity != null) merged.quantity = item.quantity;
    merged.approved = Boolean(merged.approved || item.approved);
    merged.dropped = Boolean(merged.dropped && item.dropped);
    merged.history = ledger.unionHistory(current.history, item.history);
    merged.rev = Math.max(current.rev || 0, item.rev || 0);
    items.set(key, merged);
  });
  const notes = [clean(target.note, 10000), clean(source.note, 10000)].filter(Boolean);
  target.note = [...new Set(notes)].join('\n\n').slice(0, 10000);
  target.capacityConfirmed = Boolean(target.capacityConfirmed || source.capacityConfirmed);
  target.manufacturers = [...manufacturers.values()];
  target.items = [...items.values()];
  target.round = Math.max(target.round || 1, source.round || 1);
  target.rounds = ledger.normalizeRounds([...(target.rounds || []), ...(source.rounds || [])]);
  target.updatedAt = now();
  source.archived = true;
  source.archiveReason = 'merged';
  source.mergedIntoId = target.id;
  source.mergedAt = now();
  source.updatedAt = source.mergedAt;
  const sourceIndex = store.requests.findIndex(item => item.id === source.id);
  if (sourceIndex >= 0) store.requests[sourceIndex] = normalizeRequest(source);
  const targetIndex = store.requests.findIndex(item => item.id === target.id);
  store.requests[targetIndex] = normalizeRequest(target);
  saveStore(store);
  return { request: store.requests[targetIndex], removedId: source.id };
}
function importLegacy(profile, requests) {
  const store = loadStore();
  const existing = new Set(store.requests.map(item => item.id));
  let imported = 0;
  for (const raw of (Array.isArray(requests) ? requests : []).slice(0, MAX_IMPORT_REQUESTS)) {
    const request = normalizeRequest(raw, { ownerId: profile.id, ownerName: profile.displayName });
    if (existing.has(request.id)) continue;
    request.ownerId = profile.id;
    request.ownerName = clean(profile.displayName || profile.username || profile.id, 240);
    request.editorIds = [];
    request.status = raw && raw.status === 'closed' ? 'closed' : 'active';
    request.closedAt = request.status === 'closed' ? (clean(raw.closedAt, 80) || now()) : '';
    // Defter sunucu tarafından yazılır: istemcinin getirdiği geçmiş/tur kabul edilmez.
    // Eski kayıt defterle gelmez; okuyan taraf talep tarihinde "legacy" teklif türetir.
    request.round = 1; request.rounds = [];
    request.items = request.items.map(item => ({ ...item, history: [], rev: 0, updatedAt: '', updatedBy: '' }));
    store.requests.push(request); existing.add(request.id); imported += 1;
  }
  if (imported) saveStore(store);
  return { imported, requests: requestsForUser(profile).requests };
}

function approveLine(profile,id,lineId,approved,options={}){
 const store=loadStore(),request=findRequest(store,id),line=request?.items.find(item=>item.id===lineId);if(!request||!line)return null;if(!canEdit(profile,request))throw Object.assign(new Error('Quotation denied.'),{code:'QUOTATION_EDIT_DENIED',statusCode:403});
 const engine=require('../../public/pricing-workspace-engine');if(approved&&!engine.price(line.price))throw Object.assign(new Error('A valid price is required.'),{code:'QUOTATION_PRICE_REQUIRED',statusCode:422});const before=new Map(store.requests.map(r=>[r.id,new Map(r.items.map(item=>[item.id,!!item.approved]))]));const affected=engine.approveQuotationLine(store.requests.filter(r=>!options.visibleRequestIds||options.visibleRequestIds.includes(r.id)),request,line,approved,other=>canEdit(profile,other));const at=now();
 // Defter: onay değişen her satıra olay eklenir (LCW AI / Office yolu da aynı kaydı bırakır).
 affected.forEach(item=>{item.updatedAt=at;item.items=item.items.map(entry=>{const was=before.get(item.id)?.get(entry.id);if(was===undefined||was===!!entry.approved)return entry;const result=ledger.applyLineChange({...entry,approved:was},{approved:!!entry.approved},profile,{round:item.round||1,source:entry.id===line.id?'ai':'exclusive',at});return result.changed?{...entry,...result.line}:entry;});});saveStore(store,options);return {request,affectedIds:affected.map(item=>item.id)};
}
function restoreRequests(profile,receipt,options={}){const store=loadStore();for(const [id,prior]of Object.entries(receipt.before)){const current=findRequest(store,id);if(current&&!canEdit(profile,current)||prior&&!canEdit(profile,prior))throw Object.assign(new Error('Quotation denied.'),{code:'QUOTATION_EDIT_DENIED',statusCode:403});const index=store.requests.findIndex(item=>item.id===id);if(prior){if(index>=0)store.requests[index]=prior;else store.requests.push(prior);}else if(index>=0)store.requests.splice(index,1);}const saved=saveStore(store,{...options,expectedRevision:receipt.expectedRevision});return {verified:true,revision:saved._revision};}
module.exports = {
  FILE,attachDeltaStore,approveLine,restoreRequests,patchLine,startRound,mutateAgent:work=>guardedDocumentMutation(documents,FILE,work),
  loadStore, requestsForUser, createRequest, updateRequest, setStatus, setEditors, deleteRequest, hideRequest, restoreRequest, mergeRequests, importLegacy, cleanupExpired,
  canEdit, canManageAccess, normalizeRequest, isRetentionExpired, RETENTION_YEARS,
};
