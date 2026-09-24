'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { toDocumentRecord } = require('./delta-store');
const policy = require('./shared-sync-policy');
const cpSharedStore = require('./cp-shared-store');

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

function emailDirectoryStats(value) {
  const src = value && typeof value === 'object' ? value : {};
  const records = Array.isArray(src.records) ? src.records : [];
  return {
    records:records.length,
    recipients:records.filter(record => String(record && record.email || '').trim()).length,
    countries:Array.isArray(src.countries) ? src.countries.length : 0,
    types:Array.isArray(src.types) ? src.types.length : 0,
  };
}

/* A normal, healthy Master must never be replaced wholesale from an old
   backup merely because the backup is larger. Focused e-mail recovery is
   allowed only when the persisted e-mail document itself is demonstrably
   richer: an empty current document, or a richer document with a strictly
   newer store revision. The recovered content is MERGED below rather than
   replacing current edits. */
function safeFocusedEmailRecovery(recovered, current) {
  if (!recovered || typeof recovered !== 'object') return false;
  const oldStats = emailDirectoryStats(recovered);
  const nowStats = emailDirectoryStats(current);
  const oldHasData = oldStats.records > 0 || oldStats.recipients > 0 || oldStats.countries > 0 || oldStats.types > 0;
  if (!oldHasData) return false;
  if (!current || typeof current !== 'object' || !Object.keys(current).length) return true;
  if (nowStats.records === 0 && oldStats.records > 0) return true;
  if (documentRevision(recovered) <= documentRevision(current)) return false;
  return oldStats.records > nowStats.records
    || oldStats.recipients > nowStats.recipients
    || oldStats.countries > nowStats.countries
    || oldStats.types > nowStats.types;
}

function emailRecoveryKey(record) {
  const src = record && typeof record === 'object' ? record : {};
  const manufacturer = String(src.manufacturer || '').trim().toLocaleLowerCase('tr-TR').replace(/[ıi]/g, 'i').replace(/\s+/g, ' ');
  if (manufacturer) return 'm:' + manufacturer;
  const email = String(src.email || '').trim().toLowerCase();
  if (email) return 'e:' + email;
  const id = String(src.id || '').trim();
  return id ? 'i:' + id : '';
}

function mergeEmailDirectoryRecovery(current, recovered) {
  const nowValue = current && typeof current === 'object' ? clone(current) : {};
  const oldValue = recovered && typeof recovered === 'object' ? clone(recovered) : {};
  const merged = { ...oldValue, ...nowValue };

  const mergeHeadings = (currentList, recoveredList) => {
    const out = Array.isArray(currentList) ? clone(currentList) : [];
    const keys = new Set(out.map(item => String(item && (item.id || item.name) || '').trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
    for (const item of Array.isArray(recoveredList) ? recoveredList : []) {
      const key = String(item && (item.id || item.name) || '').trim().toLocaleLowerCase('tr-TR');
      if (!key || keys.has(key)) continue;
      out.push(clone(item));
      keys.add(key);
    }
    return out.map((item, order) => ({ ...item, order }));
  };

  merged.countries = mergeHeadings(nowValue.countries, oldValue.countries);
  merged.types = mergeHeadings(nowValue.types, oldValue.types);

  const records = Array.isArray(nowValue.records) ? clone(nowValue.records) : [];
  const byKey = new Map();
  records.forEach((record, index) => {
    const key = emailRecoveryKey(record);
    if (key && !byKey.has(key)) byKey.set(key, index);
  });
  const fillable = ['email','contact','phone','note','countryId','typeId'];
  for (const oldRecord of Array.isArray(oldValue.records) ? oldValue.records : []) {
    const key = emailRecoveryKey(oldRecord);
    const index = key ? byKey.get(key) : undefined;
    if (index == null) {
      const copy = clone(oldRecord);
      records.push(copy);
      if (key) byKey.set(key, records.length - 1);
      continue;
    }
    const target = { ...records[index] };
    for (const field of fillable) {
      if (!String(target[field] == null ? '' : target[field]).trim() && String(oldRecord && oldRecord[field] == null ? '' : oldRecord[field]).trim()) {
        target[field] = clone(oldRecord[field]);
      }
    }
    records[index] = target;
  }
  merged.records = records;
  merged.storeRevisionMeta = {
    ...(oldValue.storeRevisionMeta || {}),
    ...(nowValue.storeRevisionMeta || {}),
    revision:Math.max(documentRevision(oldValue), documentRevision(nowValue)) + 1,
    updatedAt:new Date().toISOString(),
  };
  return merged;
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
    const recoveredRows = arraySize(recovered.snapshot && recovered.snapshot.records);
    const currentRows = arraySize(current.snapshot && current.snapshot.records);
    // A later-created empty/default snapshot must never beat a real persisted
    // Endeksmatik dataset merely because its timestamp is newer.
    if (recoveredRows > 0 && currentRows === 0) return true;
    if (recoveredRows === 0 && currentRows > 0) return false;
    const recoveredStamp = endeksmatikStamp(recovered), currentStamp = endeksmatikStamp(current);
    if (recoveredStamp !== currentStamp) return recoveredStamp > currentStamp;
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

function legacyQuotationEmailDirectory(value) {
  const src = value && typeof value === 'object' ? value : {};
  const requests = Array.isArray(src.requests) ? src.requests.slice() : [];
  if (!requests.length) return null;
  // Old quotation requests are an authoritative historical copy of the
  // recipient list that Send to Pricing actually used. Process oldest->newest
  // so a later request for the same manufacturer wins.
  requests.sort((a,b) => {
    const stamp = item => Date.parse(item && (item.updatedAt || item.createdAt) || '') || 0;
    return stamp(a) - stamp(b);
  });
  const byManufacturer = new Map();
  let latestStamp = '';
  for (const request of requests) {
    const stamp = String(request && (request.updatedAt || request.createdAt) || '');
    if (Date.parse(stamp) > Date.parse(latestStamp || '')) latestStamp = stamp;
    for (const item of Array.isArray(request && request.manufacturers) ? request.manufacturers : []) {
      const manufacturer = String(item && item.name || '').trim().slice(0, 240);
      const email = String(item && item.email || '').trim().slice(0, 2000);
      if (!manufacturer || !email) continue;
      const key = manufacturer.toLocaleLowerCase('tr-TR').replace(/[ıi]/g,'i').replace(/\s+/g,' ').trim();
      const id = 'em-legacy-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
      byManufacturer.set(key, {
        id,
        manufacturer,
        email,
        contact:'',
        phone:'',
        note:'Recovered from legacy quotation recipient history',
        countryId:'',
        typeId:'',
        createdAt:String(request.createdAt || request.updatedAt || latestStamp || ''),
        createdBy:'',
        createdByName:'',
        updatedAt:String(request.updatedAt || request.createdAt || latestStamp || ''),
        updatedBy:'',
        updatedByName:'',
        lock:null,
      });
    }
  }
  if (!byManufacturer.size) return null;
  return {
    schemaVersion:1,
    countries:[],
    types:[],
    records:[...byManufacturer.values()],
    _revision:Math.max(1, Number(src._revision) || requests.length),
    _updatedAt:String(src._updatedAt || latestStamp || ''),
  };
}

function mergeMasterRecordsFromServerDataRoot(records, serverRoot) {
  if (!serverRoot || !fs.existsSync(serverRoot)) return records;
  for (const filename of ['settings.json', 'overrides.json', 'fx-rates.json', 'email-groups.json']) {
    // Current file first, then its validated previous generation. Recovery is
    // semantic: a .bak with real data is allowed to beat a one-revision-newer
    // empty/default file, while a genuinely richer current file remains newer.
    for (const candidateFile of [path.join(serverRoot, filename), path.join(serverRoot, filename + '.bak')]) {
      const value = readJson(candidateFile);
      const candidate = makeStoreRecord(filename, value);
      if (!candidate) continue;
      const id = 'store:' + filename;
      if (shouldPreferRecovery(id, candidate, records[id])) records[id] = candidate;
    }
  }
  // Some pre-central-directory versions did not persist email-groups.json at
  // all. Their quotation history still contains the exact manufacturer +
  // recipient lists used by Send to Pricing. Use that as a narrow recovery
  // source and MERGE it into the current directory; current non-empty fields
  // always win.
  for (const candidateFile of [
    path.join(serverRoot, 'quotations.json'),
    path.join(serverRoot, 'quotations.json.bak'),
  ]) {
    const quotations = readJson(candidateFile);
    const legacyDirectory = legacyQuotationEmailDirectory(quotations);
    const candidate = makeStoreRecord('email-groups.json', legacyDirectory);
    if (!candidate) continue;
    const id = 'store:email-groups.json';
    if (safeFocusedEmailRecovery(candidate, records[id])) {
      records[id] = policy.scrubSecrets(mergeEmailDirectoryRecovery(records[id], candidate));
    }
  }

  for (const candidateFile of [
    path.join(serverRoot, 'endeksmatik-snapshot.json.gz'),
    path.join(serverRoot, 'endeksmatik-snapshot.json.gz.bak'),
  ]) {
    const endeksmatik = readGzipJson(candidateFile);
    if (!endeksmatik || !Array.isArray(endeksmatik.records)) continue;
    const candidate = policy.scrubSecrets(toDocumentRecord({ snapshot:endeksmatik }));
    const id = 'endeksmatik:snapshot';
    if (shouldPreferRecovery(id, candidate, records[id])) records[id] = candidate;
  }
  return records;
}

function loadMasterRecordsFromServerDataRoot(serverRoot, recoveredState = {}) {
  const records = clone(policy.masterRecordsFromState(recoveredState)) || {};
  return mergeMasterRecordsFromServerDataRoot(records, serverRoot);
}

function mergeLegacyFxValues(values) {
  const candidates = (Array.isArray(values) ? values : []).filter(value => value && typeof value === 'object');
  if (!candidates.length) return null;
  candidates.sort((a,b) => (Date.parse(a.updatedAt || a._updatedAt || '') || 0) - (Date.parse(b.updatedAt || b._updatedAt || '') || 0));
  const merged = { base:'USD', currencies:[], months:{}, updatedAt:null, sourceFile:null, sourceType:null, sourceModifiedAt:null, _revision:0 };
  let hasRates = false;
  for (const value of candidates) {
    if (typeof value.base === 'string' && value.base) merged.base = value.base;
    merged.currencies = [...new Set([...merged.currencies, ...(Array.isArray(value.currencies) ? value.currencies.filter(Boolean) : [])])];
    for (const [month, rates] of Object.entries(value.months || {})) {
      if (!rates || typeof rates !== 'object' || !Object.keys(rates).length) continue;
      merged.months[month] = { ...(merged.months[month] || {}), ...rates };
      hasRates = true;
    }
    merged.updatedAt = value.updatedAt || merged.updatedAt;
    merged.sourceFile = value.sourceFile || merged.sourceFile;
    merged.sourceType = value.sourceType || merged.sourceType;
    merged.sourceModifiedAt = value.sourceModifiedAt || merged.sourceModifiedAt;
    merged._revision = Math.max(Number(merged._revision)||0, Number(value._revision)||0);
  }
  return hasRates ? merged : null;
}

function loadLegacyFxFromAppDataRoot(appRoot) {
  if (!appRoot || !fs.existsSync(appRoot)) return null;
  const files = [path.join(appRoot, 'fx-rates.json')];
  const userRoot = path.join(appRoot, 'user-source-data');
  try {
    for (const entry of fs.readdirSync(userRoot, { withFileTypes:true })) {
      if (entry.isDirectory()) files.push(path.join(userRoot, entry.name, 'fx-rates.json'));
    }
  } catch (_) {}
  return mergeLegacyFxValues(files.filter(file => fs.existsSync(file)).map(readJson));
}

function appendLocalFirstRoots(roots, localDataRoot) {
  const localFirst = path.join(localDataRoot, 'local-first', 'backups');
  try {
    const backups = fs.readdirSync(localFirst, { withFileTypes:true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(localFirst, entry.name, 'legacy-server-data'))
      .filter(root => fs.existsSync(root))
      .sort();
    roots.push(...backups);
  } catch (_) {}
  return roots;
}


function businessValueMeaningful(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(businessValueMeaningful);
  if (typeof value === 'object') return Object.values(value).some(businessValueMeaningful);
  return true;
}

function explicitBlankNoteRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const touched = Object.prototype.hasOwnProperty.call(value, 'Notes') || Object.prototype.hasOwnProperty.call(value, 'EkNot');
  if (!touched) return false;
  const notes = String(value.Notes == null ? '' : value.Notes).trim();
  const extra = String(value.EkNot == null ? '' : value.EkNot).trim();
  return !notes && !extra;
}

function overrideCandidateStamp(value) {
  const stamp = Date.parse(value && value._updatedAt || '');
  return {
    time:Number.isFinite(stamp) ? stamp : 0,
    revision:Math.max(0, Number(value && value._revision) || 0),
  };
}

function compareOverrideCandidates(a, b) {
  const sa=overrideCandidateStamp(a.value), sb=overrideCandidateStamp(b.value);
  return sa.time - sb.time || sa.revision - sb.revision || String(a.file).localeCompare(String(b.file));
}

function collectOverrideCandidates(roots) {
  const out = [];
  for (const root of Array.isArray(roots) ? roots : []) {
    if (!root || !fs.existsSync(root)) continue;
    for (const file of [path.join(root, 'overrides.json'), path.join(root, 'overrides.json.bak')]) {
      if (!fs.existsSync(file)) continue;
      const value = readJson(file);
      if (value && typeof value === 'object') out.push({ file, value });
    }
  }
  return out.sort(compareOverrideCandidates);
}

function mergeLegacyCpBusinessCandidates(candidates) {
  const legacy = {};
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const overrides = candidate && candidate.value;
    if (!overrides || typeof overrides !== 'object') continue;
    for (const id of cpSharedStore.legacyKeys(overrides)) {
      const record = cpSharedStore.recordFromOverrides(overrides, id);
      const key = 'cp-order:' + String(id);
      const target = legacy[key] || (legacy[key] = {});
      // Empty legacy placeholders are not tombstones. They were frequently
      // emitted by old Buyer Log versions and must not erase an older real
      // note/date/sub-manufacturer during verified backup recovery.
      for (const [field, value] of Object.entries(record)) {
        if (!businessValueMeaningful(value)) continue;
        target[field] = clone(value);
      }
    }
  }
  return legacy;
}

function mergeRecoveredBusinessRecords(currentRecords, recoveredRecords, tombstones = {}) {
  const current = clone(currentRecords && typeof currentRecords === 'object' ? currentRecords : {}) || {};
  const recovered = recoveredRecords && typeof recoveredRecords === 'object' ? recoveredRecords : {};
  const changed = {};
  let fieldsAdded = 0;
  for (const [id, recoveredRecord] of Object.entries(recovered)) {
    if (!recoveredRecord || typeof recoveredRecord !== 'object') continue;
    if (tombstones && tombstones[id]) continue;
    const existing = current[id];
    if (!existing || typeof existing !== 'object' || !Object.keys(existing).length) {
      changed[id] = clone(recoveredRecord);
      current[id] = clone(recoveredRecord);
      fieldsAdded += Object.keys(recoveredRecord).filter(key => !String(key).startsWith('_')).length;
      continue;
    }
    if (!String(id).startsWith('cp-order:')) continue;

    const merged = clone(existing) || {};
    let recordChanged = false;
    for (const [field, value] of Object.entries(recoveredRecord)) {
      if (String(field).startsWith('_') || !businessValueMeaningful(value)) continue;
      // Explicit null is the modern CP-store tombstone and is respected.
      if (Object.prototype.hasOwnProperty.call(existing, field) && existing[field] === null) continue;
      // Compatibility with deletions made before the explicit-null fix:
      // old clients persisted {Notes:'', EkNot:''}. That still means the user
      // intentionally cleared the note and must beat any pre-wipe backup.
      if (field === 'notes' && Object.prototype.hasOwnProperty.call(existing, field) && explicitBlankNoteRecord(existing[field])) continue;
      if (Object.prototype.hasOwnProperty.call(existing, field) && businessValueMeaningful(existing[field])) continue;
      merged[field] = clone(value);
      recordChanged = true;
      fieldsAdded += 1;
    }
    if (recordChanged) {
      changed[id] = merged;
      current[id] = merged;
    }
  }
  return { records:current, changed, ids:Object.keys(changed), fieldsAdded };
}

function loadBusinessRecordsFromFullSystemRoots({ serverDataRoot, appDataRoot, localDataRoot }, recoveredState = {}) {
  const current = clone(policy.businessRecordsFromState(recoveredState)) || {};
  const roots = [
    serverDataRoot,
    path.join(localDataRoot, 'application-data'),
    path.join(localDataRoot, 'data'),
    appDataRoot,
  ].filter(Boolean);
  appendLocalFirstRoots(roots, localDataRoot);
  const legacy = mergeLegacyCpBusinessCandidates(collectOverrideCandidates(roots));
  return mergeRecoveredBusinessRecords(current, legacy, recoveredState && recoveredState.tombstones).records;
}

function loadBusinessRecordsFromExtractedBackup(tempRoot, recoveredState = {}) {
  const systemRoot = path.join(tempRoot, 'system');
  return loadBusinessRecordsFromFullSystemRoots({
    serverDataRoot:path.join(systemRoot, 'server-data'),
    appDataRoot:path.join(systemRoot, 'app-data'),
    localDataRoot:path.join(systemRoot, 'local-data'),
  }, recoveredState);
}

function businessCoverage(records) {
  const source = records && typeof records === 'object' ? records : {};
  const cp = Object.entries(source).filter(([id]) => String(id).startsWith('cp-order:'));
  const countField = field => cp.filter(([,record]) => record && businessValueMeaningful(record[field])).length;
  return {
    records:Object.keys(source).length,
    cpOrderRecords:cp.length,
    notes:countField('notes'),
    subManufacturers:countField('subManufacturer'),
    revisedDates:countField('dates'),
    deliveryTypes:countField('delivery'),
    licensors:countField('licensor'),
    supplierFobs:countField('suppFob'),
  };
}

function loadMasterRecordsFromFullSystemRoots({ serverDataRoot, appDataRoot, localDataRoot }, recoveredState = {}) {
  const records = clone(policy.masterRecordsFromState(recoveredState)) || {};
  const roots = [
    serverDataRoot,
    path.join(localDataRoot, 'application-data'),
    path.join(localDataRoot, 'data'),
    appDataRoot,
  ].filter(Boolean);
  appendLocalFirstRoots(roots, localDataRoot);
  for (const root of roots) mergeMasterRecordsFromServerDataRoot(records, root);

  const currentFx = records['store:fx-rates.json'];
  const currentMonths = currentFx && currentFx.months && typeof currentFx.months === 'object' ? Object.keys(currentFx.months).length : 0;
  if (!currentMonths) {
    const legacyFx = loadLegacyFxFromAppDataRoot(appDataRoot);
    const candidate = makeStoreRecord('fx-rates.json', legacyFx);
    if (candidate && shouldPreferRecovery('store:fx-rates.json', candidate, currentFx)) records['store:fx-rates.json'] = candidate;
  }
  return records;
}

function loadMasterRecordsFromLegacyDataRoot(dataRoot, recoveredState = {}) {
  return loadMasterRecordsFromFullSystemRoots({
    serverDataRoot:path.join(dataRoot, 'server'),
    appDataRoot:path.join(dataRoot, 'app'),
    localDataRoot:path.join(dataRoot, 'local'),
  }, recoveredState);
}

function loadMasterRecordsFromExtractedBackup(tempRoot, recoveredState = {}) {
  const systemRoot = path.join(tempRoot, 'system');
  return loadMasterRecordsFromFullSystemRoots({
    serverDataRoot:path.join(systemRoot, 'server-data'),
    appDataRoot:path.join(systemRoot, 'app-data'),
    localDataRoot:path.join(systemRoot, 'local-data'),
  }, recoveredState);
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
    emailRecipients:emailDirectoryStats(email).recipients,
    emailCountries:arraySize(email.countries),
    fxKeys:fx.months && typeof fx.months === 'object' ? Object.keys(fx.months).length : 0,
    endeksmatikRecords:Array.isArray(endSnapshot && endSnapshot.records) ? endSnapshot.records.length : 0,
  };
}

module.exports = {
  readJson,
  readGzipJson,
  documentRevision,
  emailDirectoryStats,
  safeFocusedEmailRecovery,
  mergeEmailDirectoryRecovery,
  legacyQuotationEmailDirectory,
  shouldPreferRecovery,
  masterRecoveryIds,
  mergeMasterRecordsFromServerDataRoot,
  loadMasterRecordsFromServerDataRoot,
  loadLegacyFxFromAppDataRoot,
  loadMasterRecordsFromFullSystemRoots,
  loadMasterRecordsFromLegacyDataRoot,
  loadMasterRecordsFromExtractedBackup,
  businessValueMeaningful,
  explicitBlankNoteRecord,
  collectOverrideCandidates,
  mergeLegacyCpBusinessCandidates,
  mergeRecoveredBusinessRecords,
  loadBusinessRecordsFromFullSystemRoots,
  loadBusinessRecordsFromExtractedBackup,
  masterCoverage,
  businessCoverage,
};
