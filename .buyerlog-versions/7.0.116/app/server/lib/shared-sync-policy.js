'use strict';

/* Shared Hub sınıflandırma sınırı.
 * Bu dosya ağ taşıma katmanının hangi kalıcı state'i taşıyabileceğini tek yerde
 * tarif eder. Renderer/UI bu kararı vermez; secret/device-local alanlar paket
 * oluşturulmadan önce burada elenir. */

const MASTER_OVERRIDE_FIELDS = new Set([
  'pricingRules', 'transitRules', 'nonDtrManufacturers', 'landedMultipliers',
  'freightRates', 'antrepoMatchRule', 'antrepoMatchConfig', 'antrepoSourceMode',
  'asasSourceMode', 'lflSourceMode', 'antrepoMatchConfigVersion', 'noteColumnDefs',
  'storeRevisionMeta',
]);
const CP_OVERRIDE_FIELDS = new Set([
  'notesmap', 'submap', 'suppfobmap', 'suppfobmetamap', 'delmap', 'licensormap',
  'noteColumnValues', 'datemap',
]);
const DEVICE_SETTING_FIELDS = new Set(['sourceFolder', 'sourceFolders']);
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
  if (/^store:settings\.json$/.test(key)) return 'GLOBAL_MASTER';
  if (/^store:overrides\.json$/.test(key)) return 'MIXED_OVERRIDE';
  if (/^store:(email-groups|fx-rates)\.json$/.test(key)) return 'GLOBAL_MASTER';
  if (/^endeksmatik:/.test(key)) return 'GLOBAL_MASTER';
  if (/^cp-order:/.test(key)) return 'SHARED_BUSINESS';
  if (/^store:collection-workspaces\/shared-collection\.json$/.test(key)) return 'SHARED_BUSINESS';
  if (/^store:collection-workspaces\//.test(key)) return 'LEGACY_COLLECTION';
  if (/imagemap|model-image|asset/i.test(key)) return 'SHARED_ASSET';
  if (/user-preferences|views|filters|refresh-history/i.test(key)) return 'USER_OR_DEVICE';
  return 'SHARED_BUSINESS';
}
function sanitizeDelta(delta, direction = 'outgoing') {
  if (!delta || typeof delta !== 'object') return null;
  const classification = classifyRecordId(delta.id);
  if (classification === 'LEGACY_COLLECTION' || classification === 'SHARED_ASSET' || classification === 'USER_OR_DEVICE') return null;
  const next = clone(delta), patch = next.patch || next.value;
  if (patch && typeof patch === 'object') {
    if (classification === 'GLOBAL_MASTER' && /^store:settings\.json$/.test(String(next.id))) next.patch = sanitizeSettings(patch);
    else if (classification === 'MIXED_OVERRIDE') {
      // Legacy overrides deltas are retained only for global master fields.
      // CP row state has its own record-level channel; imagemap is asset-owned.
      next.patch = sanitizeOverridesMaster(patch);
      if (!Object.keys(next.patch).length) return null;
    } else next.patch = scrubSecrets(patch);
    if ('value' in next) delete next.value;
  }
  next.syncClass = classification === 'MIXED_OVERRIDE' ? 'GLOBAL_MASTER' : classification;
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
    records[id] = scrubSecrets(value);
  }
  return records;
}
function masterRecordsFromState(state) {
  const records = {};
  for (const [id, value] of Object.entries(state && state.records || {})) {
    const classification = classifyRecordId(id);
    if (classification === 'GLOBAL_MASTER') records[id] = /^store:settings\.json$/.test(id) ? sanitizeSettings(value) : scrubSecrets(value);
    else if (classification === 'MIXED_OVERRIDE') {
      const safe = sanitizeOverridesMaster(value);
      if (Object.keys(safe).length) records[id] = safe;
    }
  }
  return records;
}

module.exports = {
  MASTER_OVERRIDE_FIELDS, CP_OVERRIDE_FIELDS, classifyRecordId, scrubSecrets,
  sanitizeSettings, sanitizeOverridesMaster, sanitizeOverridesBusiness,
  sanitizeDelta, filterDeltas, masterRecordsFromState, businessRecordsFromState,
};
