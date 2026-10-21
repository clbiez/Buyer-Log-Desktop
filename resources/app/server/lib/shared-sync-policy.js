'use strict';

/* Shared Hub sınıflandırma sınırı.
 * Bu dosya ağ taşıma katmanının hangi kalıcı state'i taşıyabileceğini tek yerde
 * tarif eder. Renderer/UI bu kararı vermez; secret/device-local alanlar paket
 * oluşturulmadan önce burada elenir. */

const MASTER_OVERRIDE_FIELDS = new Set([
  'pricingRules', 'licenseCards', 'transitRules', 'nonDtrManufacturers', 'landedMultipliers',
  'freightRates', 'transitAnalysis', 'antrepoMatchRule', 'antrepoMatchConfig', 'antrepoSourceMode',
  'asasSourceMode', 'lflSourceMode', 'antrepoMatchConfigVersion', 'noteColumnDefs',
  // Önem etiketi kataloğu + Line kuralları: Moderatör yayımıyla ekibe dağılır.
  'importanceSettings',
  'storeRevisionMeta',
  // v7.0.290 — Moderatörün tüm kullanıcılara yayımladığı CP kural/checklist seti.
  'cpManagedRules',
]);
const CP_OVERRIDE_FIELDS = new Set([
  'notesmap', 'submap', 'suppfobmap', 'suppfobmetamap', 'delmap', 'licensormap',
  'noteColumnValues', 'datemap', 'shortagemap', 'importancemap',
]);
const DEVICE_SETTING_FIELDS = new Set(['sourceFolder', 'sourceFolders']);

/* EŞLER ARASI KANAL — İZİN LİSTESİ (v20261009).
   200 eşzamanlı kullanıcıda her cihaz her cihazın değişikliğini okur. Bu
   kanaldan geçen her alan, iki kişinin aynı anda yazabildiği bir çakışma
   yüzeyidir. Bu yüzden kanal "varsayılan: paylaş" değil "varsayılan: yerel"
   çalışır; yalnız kullanıcılar arası aktarılması GEREKEN iş verisi buradan
   geçer:
     - cp-order:*            → Ex-Factory revizeleri (dates), Sub-Manufacturer,
                               Supp. FOB (+ meta). Notlar, teslim tipi,
                               shortage vb. yereldir.
     - store:email-groups    → Manufacturers e-posta rehberi (kimlikle
                               birleşir, aynı alan yarışı çakışma üretmez).
   Koleksiyon kendi sahip-bazlı replikasyonuyla, görünüm/filtre ön ayarları
   talep üzerine paylaşımla taşınır. Çalışma kuralları (bağlantılar, kur,
   endeksmatik, yol süreleri, DTR/Non-DTR, fiyat kuralları) bu kanaldan HİÇ
   geçmez: yalnız Moderatörün yayımladığı Master checkpoint'ten alınır. */
const PEER_CP_FIELDS = new Set(['dates', 'subManufacturer', 'suppFob', 'suppFobMeta']);
const PEER_DOCUMENTS = new Set(['store:email-groups.json']);
const META_FIELD = /^_/;
const SECRET_KEY = /(password|passphrase|secret|token|authorization|cookie|credential|private.?key|client.?secret|api.?key)/i;
const RUNTIME_KEY = /^(lastRun|lastError|lastAttempt|outFile|localPath|cachePath|tempPath)$/i;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function scrubSecrets(value) {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = scrubSecrets(item);
  }
  return out;
}
function sanitizeSettings(record) {
  const source = scrubSecrets(clone(record || {}));
  for (const key of DEVICE_SETTING_FIELDS) delete source[key];
  if (Array.isArray(source.modelConnections)) {
    source.modelConnections = source.modelConnections.map(item => {
      const next = item && typeof item === 'object' ? { ...item } : item;
      if (!next || typeof next !== 'object') return next;
      for (const key of Object.keys(next)) if (RUNTIME_KEY.test(key)) delete next[key];
      return next;
    });
  }
  return source;
}
function sanitizeOverridesMaster(record) {
  const source = scrubSecrets(clone(record || {})), out = {};
  for (const key of MASTER_OVERRIDE_FIELDS) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}
function sanitizeOverridesBusiness(record) {
  const source = scrubSecrets(clone(record || {})), out = {};
  for (const key of CP_OVERRIDE_FIELDS) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}
function classifyRecordId(id) {
  const key = String(id || '');
  if (/^license-card:(?:state|license-[a-f0-9]{24})$/.test(key)) return 'SHARED_BUSINESS';
  if (/^store:settings\.json$/.test(key)) return 'GLOBAL_MASTER';
  if (/^store:overrides\.json$/.test(key)) return 'MIXED_OVERRIDE';
  if (/^store:(email-groups|fx-rates)\.json$/.test(key)) return 'GLOBAL_MASTER';
  if (/^endeksmatik:/.test(key)) return 'GLOBAL_MASTER';
  if (/^cp-order:/.test(key)) return 'SHARED_BUSINESS';
  if (/^store:collection-workspaces\/shared-collection\.json$/.test(key)) return 'SHARED_BUSINESS';
  if (/^store:collection-workspaces\//.test(key)) return 'LEGACY_COLLECTION';
  if (/imagemap|model-image|asset/i.test(key)) return 'SHARED_ASSET';
  if (/user-preferences|views|filters|refresh-history/i.test(key)) return 'USER_OR_DEVICE';
  // Tanınmayan kayıt cihazda kalır. Eskiden varsayılan SHARED_BUSINESS idi;
  // kullanıcıya özel dosyalar (sevkiyat karşılaştırması, açık maliyet, şablon,
  // fiyat talebi…) farkında olunmadan 200 cihaza yayılıyordu.
  return 'LOCAL_ONLY';
}
function isCpOrderId(id) { return /^cp-order:/.test(String(id || '')); }
/* Kayıt eşler arası delta kanalında taşınabilir mi? */
function peerChannelAllows(id) {
  const key = String(id || '');
  return isCpOrderId(key) || PEER_DOCUMENTS.has(key) || /^license-card:(?:state|license-[a-f0-9]{24})$/.test(key);
}
/* cp-order kaydından yalnız paylaşılan alanları (ve motor metasını) bırakır.
   Meta alanlarının alan bazlı haritaları da aynı kapsama indirilir. */
function pickPeerCpFields(record, { keepMeta = true } = {}) {
  const out = {};
  for (const [key, value] of Object.entries(record && typeof record === 'object' ? record : {})) {
    if (PEER_CP_FIELDS.has(key)) out[key] = value;
    else if (keepMeta && META_FIELD.test(key)) {
      if ((key === '_fieldRevisions' || key === '_fieldWriters') && value && typeof value === 'object') {
        const scoped = {};
        for (const [field, item] of Object.entries(value)) if (PEER_CP_FIELDS.has(field)) scoped[field] = item;
        out[key] = scoped;
      } else out[key] = value;
    }
  }
  return out;
}
/* Açık bir çakışma hâlâ eşler arası kapsamda mı? Kapsam dışına alınmış
   kayıt/alan için kullanıcıya "hangisini tutayım" sorusu artık anlamsızdır. */
function conflictInPeerScope(conflict) {
  if (!conflict || typeof conflict !== 'object') return false;
  const id = String(conflict.id || '');
  if (!peerChannelAllows(id)) return false;
  if (isCpOrderId(id)) return conflict.type === 'field' && PEER_CP_FIELDS.has(String(conflict.field || ''));
  return true;
}
/* Eşler arası kanal filtresi. İki yönde de aynı kural uygulanır: eski sürüm
   bir eş kapsam dışı kayıt yayımlasa bile bu cihaz onu uygulamaz. */
function sanitizeDelta(delta, direction = 'outgoing') {
  if (!delta || typeof delta !== 'object') return null;
  if (!peerChannelAllows(delta.id)) return null;
  const cpOrder = isCpOrderId(delta.id);
  // cp-order kaydının bütünü silinmez: kayıtta artık yerel kalan alanlar da
  // (notlar vb.) var. Paylaşılan alan temizliği alan değeri null ile taşınır.
  if (cpOrder && (delta.delete || delta.tombstone)) return null;
  const next = clone(delta), patch = next.patch || next.value;
  if(String(delta.id).startsWith('license-card:')){
    if(delta.delete||delta.tombstone||!patch||typeof patch!=='object')return null;
    const allowed=delta.id==='license-card:state'?['initialized','lastImportedAt']:['profile','contracts'];
    next.patch=Object.fromEntries(allowed.filter(key=>Object.hasOwn(patch,key)).map(key=>[key,scrubSecrets(patch[key])]));
    if(!Object.keys(next.patch).length)return null;
    delete next.value;next.syncClass='SHARED_BUSINESS';return next;
  }
  if (patch && typeof patch === 'object') {
    next.patch = cpOrder ? pickPeerCpFields(scrubSecrets(patch), { keepMeta: false }) : scrubSecrets(patch);
    if (cpOrder && !Object.keys(next.patch).length) return null;
    if ('value' in next) delete next.value;
  } else if (cpOrder) return null;
  next.syncClass = 'SHARED_BUSINESS';
  return next;
}
function filterDeltas(deltas, direction = 'outgoing') {
  const out = [];
  for (const delta of Array.isArray(deltas) ? deltas : []) {
    const safe = sanitizeDelta(delta, direction);
    if (safe) out.push(safe);
  }
  return out;
}

function businessRecordsFromState(state) {
  const records = {};
  for (const [id, value] of Object.entries(state && state.records || {})) {
    if (classifyRecordId(id) !== 'SHARED_BUSINESS') continue;
    if (isCpOrderId(id)) {
      const scoped = pickPeerCpFields(scrubSecrets(value));
      if (Object.keys(scoped).some(key => PEER_CP_FIELDS.has(key))) records[id] = scoped;
      continue;
    }
    records[id] = scrubSecrets(value);
  }
  return records;
}
/* Ortak klasördeki checkpoint, eski sürümlerin yayımladığı kapsam dışı
   kayıtları taşıyabilir. Karşılaştırma ve onarım yalnız bu sürümün kapsamı
   üzerinden yapılır; aksi hâlde "yerelde eksik" sayılan kayıt yayımı kalıcı
   olarak kilitler ya da yerel alanı uzak kopyayla ezerdi. */
function scopeCheckpointRecords(area, records) {
  const out = {};
  for (const [id, value] of Object.entries(records && typeof records === 'object' ? records : {})) {
    const classification = classifyRecordId(id);
    if (area === 'master') {
      if (classification === 'GLOBAL_MASTER' || classification === 'MIXED_OVERRIDE') out[id] = value;
    } else if (classification === 'SHARED_BUSINESS') {
      if (!isCpOrderId(id)) { out[id] = value; continue; }
      const scoped = pickPeerCpFields(value);
      if (Object.keys(scoped).some(key => PEER_CP_FIELDS.has(key))) out[id] = scoped;
    }
  }
  return out;
}
function masterRecordsFromState(state) {
  const records = {};
  for (const [id, value] of Object.entries(state && state.records || {})) {
    const classification = classifyRecordId(id);
    if (classification === 'GLOBAL_MASTER') records[id] = /^store:settings\.json$/.test(id) ? sanitizeSettings(value) : scrubSecrets(value);
    else if (classification === 'MIXED_OVERRIDE') {
      const safe = sanitizeOverridesMaster(value);
      if (!Object.keys(safe).length) continue;
      // Revizyon saati de taşınır: checkpoint'ten onarılan cihazın sonraki
      // yazımı doğru tabanı gösterir, diğer cihazlarda sahte çakışma olmaz.
      const fields = {};
      for (const key of Object.keys(safe)) if (value._fieldRevisions && value._fieldRevisions[key] != null) fields[key] = value._fieldRevisions[key];
      if (value._revision != null) safe._revision = value._revision;
      if (Object.keys(fields).length) safe._fieldRevisions = fields;
      // Nedensel çakışma algılaması için alanın son yazanı da taşınır.
      const writers = {};
      for (const key of Object.keys(safe)) if (value._fieldWriters && value._fieldWriters[key]) writers[key] = value._fieldWriters[key];
      if (Object.keys(writers).length) safe._fieldWriters = writers;
      records[id] = safe;
    }
  }
  return records;
}

/* Checkpoint onarımı yerel kaydı ezmez: checkpoint'teki alanlar alınır,
   checkpoint'te olmayan cihaza özel/iş alanları (settings.sourceFolders,
   overrides.notesmap) korunur ve revizyon saati hiçbir zaman geri gitmez. */
function checkpointRecordRevision(record) {
  let max = Number(record && record._revision) || 0;
  for (const value of Object.values(record && record._fieldRevisions || {})) max = Math.max(max, Number(value) || 0);
  return max;
}
/* Master checkpoint'teki bağlantı listesi cihaz alanlarından (son çalıştırma,
   yerel yol, gizli alan) arındırılmış gelir. Listeyi bütün olarak almak bu
   cihazın kendi çalıştırma bilgisini silerdi; aynı kimlikli bağlantıda yalnız
   arındırılmış alanlar yerelden geri konur. */
function keepLocalConnectionState(localList, remoteList) {
  if (!Array.isArray(remoteList) || !Array.isArray(localList)) return remoteList;
  const byId = new Map(localList.filter(item => item && typeof item === 'object' && item.id != null).map(item => [String(item.id), item]));
  return remoteList.map(item => {
    const local = item && typeof item === 'object' && item.id != null ? byId.get(String(item.id)) : null;
    if (!local) return item;
    const next = { ...item };
    for (const [key, value] of Object.entries(local)) {
      if (!Object.hasOwn(next, key) && (RUNTIME_KEY.test(key) || SECRET_KEY.test(key))) next[key] = value;
    }
    return next;
  });
}
function mergeCheckpointRecord(local, remote) {
  const incoming = clone(remote || {});
  if (!local || typeof local !== 'object') return incoming;
  const out = clone(local);
  const fields = { ...(local._fieldRevisions || {}) };
  const remoteFields = incoming._fieldRevisions || {};
  const writers = { ...(local._fieldWriters || {}) };
  const remoteWriters = incoming._fieldWriters || {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key === '_revision' || key === '_fieldRevisions' || key === '_fieldWriters') continue;
    out[key] = key === 'modelConnections' ? keepLocalConnectionState(local[key], value) : value;
    const revision = Number(remoteFields[key]) || 0;
    if (revision > (Number(fields[key]) || 0)) fields[key] = revision;
    if (remoteWriters[key]) writers[key] = remoteWriters[key];
  }
  out._fieldRevisions = fields;
  if (Object.keys(writers).length) out._fieldWriters = writers;
  out._revision = Math.max(Number(local._revision) || 0, checkpointRecordRevision(incoming));
  return out;
}

/* Checkpoint'ten alınan değerler, yazan cihazların o sıraya kadarki
   değişikliklerinin bu cihazda bulunduğunu gösterir. Sürüm vektörüne eklenir;
   yoksa checkpoint ile güncellenen cihazın sonraki yazımı "görmeden yazılmış"
   sayılıp sahte çakışma üretirdi. */
function checkpointWriterKnowledge(records) {
  const out = {};
  for (const record of Object.values(records && typeof records === 'object' ? records : {})) {
    for (const writer of Object.values(record && record._fieldWriters || {})) {
      const device = String(writer && writer.d || '').trim(), seq = Number(writer && writer.s) || 0;
      if (device && seq > (out[device] || 0)) out[device] = seq;
    }
  }
  return out;
}
function mergeKnowledge(current, incoming) {
  const out = { ...(current && typeof current === 'object' ? current : {}) };
  for (const [device, seq] of Object.entries(incoming || {})) if ((Number(seq) || 0) > (Number(out[device]) || 0)) out[device] = Number(seq);
  return out;
}

module.exports = {
  PEER_CP_FIELDS, PEER_DOCUMENTS, peerChannelAllows, conflictInPeerScope, scopeCheckpointRecords,
  checkpointWriterKnowledge, mergeKnowledge,
  MASTER_OVERRIDE_FIELDS, CP_OVERRIDE_FIELDS, classifyRecordId, scrubSecrets,
  sanitizeSettings, sanitizeOverridesMaster, sanitizeOverridesBusiness,
  sanitizeDelta, filterDeltas, masterRecordsFromState, businessRecordsFromState,
  mergeCheckpointRecord, checkpointRecordRevision,
};
