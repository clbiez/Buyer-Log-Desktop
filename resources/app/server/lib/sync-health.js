'use strict';

/* Ölçüm katmanı: izin verilen iş değerlerini karşılaştırır; dosya okumaz,
   kayıtları değiştirmez, SYNC veya otomatik onarım başlatmaz. */
const crypto = require('node:crypto');
const policy = require('./shared-sync-policy');

const MAX_DETAIL_RECORDS = 20000;
const MAX_REPORT_BYTES = 1024 * 1024;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const AUDIT_TIMESTAMP = /^(at|createdAt|updatedAt|modifiedAt|savedAt|syncedAt|lastSyncAt|lastSync|lastRun|lastAttempt|lastError|lockAt|expiresAt)$/i;

function integer(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0; }
function text(value, max = 160) { return String(value == null ? '' : value).slice(0, max); }
function time(now) { return new Date(now === undefined ? Date.now() : now); }
function stableJson(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(item => stableJson(item) ?? 'null').join(',') + ']';
  return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

/* CP dates iş tarihleri olabilir: burada zaman damgasına benzeyen bir
   anahtarı bile silmeyiz. Diğer alanlarda kayıt/motor saatleri iş özeti değil.
   E-posta dizini kimlikle birleşir; listeye eklenme sırası iş farkı değildir. */
function canonicalValue(value, { businessDates = false, directory = false, key = '' } = {}) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalValue(item, { businessDates, directory, key }));
    if (directory && key === 'aliases' && items.every(item => typeof item === 'string')) return items.sort();
    if (directory && items.length && items.every(item => item && typeof item === 'object' && !Array.isArray(item) && item.id != null)) {
      const ids = items.map(item => String(item.id));
      if (new Set(ids).size === ids.length) return items.sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
    }
    return items;
  }
  if (!value || typeof value !== 'object') return value;
  const entries = [];
  for (const field of Object.keys(value).sort()) {
    if (field.startsWith('_') || field === 'storeRevisionMeta') continue;
    if (!businessDates && AUDIT_TIMESTAMP.test(field)) continue;
    if (directory && (field === 'lock' || field === 'revision' || field === 'lockTtlMs')) continue;
    if (directory && field === 'deletedRecords' && value[field] && typeof value[field] === 'object') {
      // Kayıt tombstone kimliğini koru; yerel/audit silinme saatini hash'e alma.
      entries.push([field, Object.fromEntries(Object.keys(value[field]).sort().map(id => [id, true]))]);
    } else entries.push([field, canonicalValue(value[field], { businessDates, directory, key: field })]);
  }
  return Object.fromEntries(entries);
}

function computeSharedDigest(state) {
  const scoped = {};
  for (const [id, record] of Object.entries(policy.businessRecordsFromState(state))) {
    if (!/^cp-order:/.test(id)) continue;
    const fields = [];
    for (const key of policy.PEER_CP_FIELDS) {
      if (Object.hasOwn(record, key)) fields.push([key, canonicalValue(record[key], { businessDates: key === 'dates' })]);
    }
    if (fields.length) scoped[id] = Object.fromEntries(fields);
  }
  for (const id of policy.PEER_DOCUMENTS) {
    if (state && state.records && Object.hasOwn(state.records, id)) scoped[id] = canonicalValue(state.records[id], { directory: true });
  }
  const ids = Object.keys(scoped).sort();
  const hash = crypto.createHash('sha256');
  hash.update('{');
  const detailEntries = [];
  let detailsAvailable = ids.length <= MAX_DETAIL_RECORDS;
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index], serialized = stableJson(scoped[id]);
    if (index) hash.update(',');
    hash.update(JSON.stringify(id)); hash.update(':'); hash.update(serialized);
    if (detailsAvailable) detailEntries.push([id, crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 16)]);
  }
  hash.update('}');
  let recordHashes = Object.fromEntries(detailEntries);
  // The writer uses pretty JSON; include the nested map indentation and
  // reserve room for identities/status so compact JSON cannot hide overflow.
  if (detailsAvailable && Buffer.byteLength(JSON.stringify({ recordHashes }, null, 2), 'utf8') > MAX_REPORT_BYTES - 4096) detailsAvailable = false;
  if (!detailsAvailable) recordHashes = {};
  return { sharedHash: hash.digest('hex'), sharedRecordCount: ids.length, recordHashes, detailsAvailable };
}

function buildHealthReport({ state, status = {}, deviceId, userId, displayName, appVersion, masterRevisionApplied, now } = {}) {
  const digest = computeSharedDigest(state);
  let published = integer(state && state.syncLedger && state.syncLedger.compactedThrough);
  for (const entry of state && Array.isArray(state.journal) ? state.journal : []) {
    if (entry && entry.uploaded && !entry.localOnly) published = Math.max(published, integer(entry.localSequence));
  }
  const lastSyncAt = status.lastSyncAt || status.lastSync ? text(status.lastSyncAt || status.lastSync, 80) : null;
  const conflicts = (state && Array.isArray(state.conflicts) ? state.conflicts : []).filter(item => item && !item.resolved).length;
  const pendingUpload = integer(status.pendingUpload);
  const openConflicts = integer(status.openConflicts == null ? status.conflict == null ? conflicts : status.conflict : status.openConflicts);
  const report = {
    schemaVersion: 1,
    deviceId: text(deviceId == null ? state && state.deviceId : deviceId),
    userId: text(userId), displayName: text(displayName, 240), appVersion: text(appVersion, 80),
    updatedAt: time(now).toISOString(), lastSyncAt,
    latestPublishedSeq: status.latestPublishedSeq == null ? published : integer(status.latestPublishedSeq),
    pendingUpload, openConflicts, rejectedOwnerDeltas:integer(status.rejectedOwnerDeltas), masterRevisionApplied: integer(masterRevisionApplied),
    ...digest,
    settled: status.online === true && !status.lastError && !status.progress && Number.isFinite(Date.parse(lastSyncAt || '')) && pendingUpload === 0 && openConflicts === 0,
  };
  if (Buffer.byteLength(JSON.stringify(report, null, 2), 'utf8') > MAX_REPORT_BYTES) {
    report.recordHashes = {}; report.detailsAvailable = false;
  }
  return report;
}

function compareReports(local, remote, { limit = 200 } = {}) {
  const result = { different: [], onlyThere: [], onlyHere: [], truncated: false, detailsAvailable: false };
  if (!local || !remote || local.detailsAvailable === false || remote.detailsAvailable === false ||
      !local.recordHashes || !remote.recordHashes || typeof local.recordHashes !== 'object' || typeof remote.recordHashes !== 'object') return result;
  result.detailsAvailable = true;
  const max = Math.min(200, integer(limit));
  let total = 0;
  const here = local.recordHashes, there = remote.recordHashes;
  for (const id of [...new Set([...Object.keys(here), ...Object.keys(there)])].sort()) {
    const bucket = !Object.hasOwn(here, id) ? 'onlyThere' : !Object.hasOwn(there, id) ? 'onlyHere' : here[id] !== there[id] ? 'different' : null;
    if (!bucket) continue;
    if (total++ < max) result[bucket].push(id);
  }
  result.truncated = total > max;
  return result;
}

function classifyReports(reports, { now } = {}) {
  const instant = time(now).getTime();
  const devices = (Array.isArray(reports) ? reports : []).filter(report => report && typeof report === 'object').map(report => {
    const updated = Date.parse(report.updatedAt || '');
    let status;
    if (report.oldVersion || report.schemaVersion !== 1 || !/^[0-9a-f]{64}$/i.test(String(report.sharedHash || '')) || !Number.isFinite(updated)) status = 'old-version';
    else if (instant - updated > STALE_AFTER_MS) status = 'stale';
    else if (report.settled !== true) status = 'syncing';
    else status = 'indeterminate';
    return { ...report, status };
  });
  const counts = new Map();
  for (const device of devices) if (device.status === 'indeterminate') counts.set(device.sharedHash, (counts.get(device.sharedHash) || 0) + 1);
  const ranking = [...counts].sort((a, b) => b[1] - a[1]);
  const settledCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const majorityHash = ranking.length && ranking[0][1] > settledCount / 2 ? ranking[0][0] : null;
  if (majorityHash) for (const device of devices) if (device.status === 'indeterminate') device.status = device.sharedHash === majorityHash ? 'same' : 'diverged';
  return { majorityHash, indeterminate: majorityHash === null, devices };
}

module.exports = { computeSharedDigest, buildHealthReport, compareReports, classifyReports };
