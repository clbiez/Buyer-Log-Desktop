'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { toDocumentRecord } = require('./delta-store');
const policy = require('./shared-sync-policy');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function readGzipJson(file) {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
  catch (_) { return null; }
}

function documentRevision(record) {
  const value = Number(record && record.storeRevisionMeta && record.storeRevisionMeta.revision);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function objectSize(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).filter(key => !String(key).startsWith('_') && key !== 'storeRevisionMeta').length
    : 0;
}

function arraySize(value) {
  return Array.isArray(value) ? value.length : 0;
}

function endeksmatikStamp(record) {
  const snapshot = record && record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : record;
  const stamp = Date.parse(snapshot && (snapshot.generatedAt || snapshot.sourceUpdatedAt || snapshot.updatedAt) || '');
  return Number.isFinite(stamp) ? stamp : 0;
}

function fieldHasMore(recovered, current, field) {
  const a = recovered && recovered[field];
  const b = current && current[field];
  if (Array.isArray(a)) return a.length > 0 && (!Array.isArray(b) || b.length === 0);
  if (a && typeof a === 'object') return objectSize(a) > 0 && objectSize(b) === 0;
  if (typeof a === 'string') return Boolean(a.trim()) && !String(b || '').trim();
  return a != null && b == null;
}

function shouldPreferRecovery(id, recovered, current) {
  if (!recovered || typeof recovered !== 'object') return false;
  if (!current || typeof current !== 'object' || !Object.keys(current).length) return true;

  const key = String(id || '');
  // Verified pre-wipe content beats a later-created EMPTY/default local
  // document even if that empty document happened to increment its revision.
  if (key === 'store:overrides.json') {
    for (const field of policy.MASTER_OVERRIDE_FIELDS) {
      if (field === 'storeRevisionMeta') continue;
      if (fieldHasMore(recovered, current, field)) return true;
    }
  } else if (key === 'store:email-groups.json') {
    if (arraySize(recovered.records) > 0 && arraySize(current.records) === 0) return true;
    if (arraySize(recovered.countries) > 0 && arraySize(current.countries) === 0) return true;
  } else if (key === 'store:fx-rates.json') {
    const recoveredMonths = recovered.months && typeof recovered.months === 'object' ? Object.keys(recovered.months).length : 0;
    const currentMonths = current.months && typeof current.months === 'object' ? Object.keys(current.months).length : 0;
    if (recoveredMonths > 0 && currentMonths === 0) return true;
  } else if (key === 'store:settings.json') {
    if (arraySize(recovered.modelConnections) > 0 && arraySize(current.modelConnections) === 0) return true;
    if (objectSize(recovered) > 0 && objectSize(current) === 0) return true;
  } else if (/^endeksmatik:/.test(key)) {
    const recoveredStamp = endeksmatikStamp(recovered), currentStamp = endeksmatikStamp(current);
    if (recoveredStamp !== currentStamp) return recoveredStamp > currentStamp;
    const recoveredRows = arraySize(recovered.snapshot && recovered.snapshot.records);
    const currentRows = arraySize(current.snapshot && current.snapshot.records);
    if (recoveredRows > 0 && currentRows === 0) return true;
  }

  const recoveredRevision = documentRevision(recovered);
  const currentRevision = documentRevision(current);
  return recoveredRevision > currentRevision;
}

function masterRecoveryIds(recoveredRecords, currentRecords) {
  const recovered = recoveredRecords && typeof recoveredRecords === 'object' ? recoveredRecords : {};
  const current = currentRecords && typeof currentRecords === 'object' ? currentRecords : {};
  return Object.entries(recovered)
    .filter(([id, record]) => shouldPreferRecovery(id, record, current[id]))
    .map(([id]) => id);
}

function makeStoreRecord(filename, value) {
  if (!value || typeof value !== 'object') return null;
  const record = toDocumentRecord(value);
  if (filename === 'settings.json') return policy.sanitizeSettings(record);
  if (filename === 'overrides.json') return policy.sanitizeOverridesMaster(record);
  return policy.scrubSecrets(record);
}

function loadMasterRecordsFromServerDataRoot(serverRoot, recoveredState = {}) {
  const records = clone(policy.masterRecordsFromState(recoveredState)) || {};
  if (!serverRoot) return records;

  for (const filename of ['settings.json', 'overrides.json', 'fx-rates.json', 'email-groups.json']) {
    const value = readJson(path.join(serverRoot, filename));
    const candidate = makeStoreRecord(filename, value);
    if (!candidate) continue;
    const id = 'store:' + filename;
    if (shouldPreferRecovery(id, candidate, records[id])) records[id] = candidate;
  }

  const endeksmatik = readGzipJson(path.join(serverRoot, 'endeksmatik-snapshot.json.gz'));
  if (endeksmatik && Array.isArray(endeksmatik.records)) {
    const candidate = policy.scrubSecrets(toDocumentRecord({ snapshot:endeksmatik }));
    const id = 'endeksmatik:snapshot';
    if (shouldPreferRecovery(id, candidate, records[id])) records[id] = candidate;
  }

  return records;
}

function loadMasterRecordsFromExtractedBackup(tempRoot, recoveredState = {}) {
  return loadMasterRecordsFromServerDataRoot(path.join(tempRoot, 'system', 'server-data'), recoveredState);
}

function masterCoverage(records) {
  const source = records && typeof records === 'object' ? records : {};
  const overrides = source['store:overrides.json'] || {};
  const email = source['store:email-groups.json'] || {};
  const fx = source['store:fx-rates.json'] || {};
  const settings = source['store:settings.json'] || {};
  const endek = Object.entries(source).find(([id]) => /^endeksmatik:/.test(id));
  const endSnapshot = endek && endek[1] && endek[1].snapshot;
  return {
    records:Object.keys(source).length,
    settings:Boolean(source['store:settings.json']),
    modelConnections:arraySize(settings.modelConnections),
    royaltyRules:arraySize(overrides.pricingRules),
    transitRules:arraySize(overrides.transitRules),
    nonDtrManufacturers:arraySize(overrides.nonDtrManufacturers),
    landedMultipliers:objectSize(overrides.landedMultipliers),
    freightRates:objectSize(overrides.freightRates),
    emailGroups:arraySize(email.records),
    emailCountries:arraySize(email.countries),
    fxKeys:fx.months && typeof fx.months === 'object' ? Object.keys(fx.months).length : 0,
    endeksmatikRecords:Array.isArray(endSnapshot && endSnapshot.records) ? endSnapshot.records.length : 0,
  };
}

module.exports = {
  readJson,
  readGzipJson,
  documentRevision,
  shouldPreferRecovery,
  masterRecoveryIds,
  loadMasterRecordsFromServerDataRoot,
  loadMasterRecordsFromExtractedBackup,
  masterCoverage,
};
