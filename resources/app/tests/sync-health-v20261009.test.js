'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const health = require('../server/lib/sync-health');

const NOW = '2026-10-09T10:00:00.000Z';
test('health requires an absolute settled-device majority, not a plurality',()=>{
  for(const distribution of [[2,1,1],[3,2,2]]){
    const reports=distribution.flatMap((count,index)=>Array.from({length:count},()=>report({sharedHash:String(index+1).repeat(64)})));
    const result=health.classifyReports(reports,{now:NOW});
    assert.equal(result.majorityHash,null);assert.ok(result.devices.every(device=>device.status==='indeterminate'));
  }
});
function state(records) { return { records, journal: [], conflicts: [] }; }
function digest(records) { return health.computeSharedDigest(state(records)); }
function report(overrides = {}) {
  return { schemaVersion: 1, deviceId: 'device-a', updatedAt: NOW, sharedHash: 'a'.repeat(64), settled: true, ...overrides };
}

test('digest ignores device metadata, local CP fields, rules and non-peer documents', () => {
  const first = digest({
    'cp-order:1': { dates: { ex: '2026-11-01' }, suppFob: 12, notes: 'private', _revision: 4, _fieldWriters: { suppFob: { d: 'a', s: 3 } } },
    'store:settings.json': { modelConnections: ['a'] },
    'store:collection-workspaces/shared-collection.json': { rows: [1] },
    'cp-order:notes-only': { notes: 'local' },
  });
  const second = digest({
    'cp-order:1': { suppFob: 12, _revision: 99, dates: { ex: '2026-11-01' }, notes: 'different', _fieldWriters: { suppFob: { d: 'b', s: 8 } } },
    'store:settings.json': { modelConnections: ['b'] },
  });
  assert.equal(first.sharedHash, second.sharedHash);
  assert.equal(first.sharedRecordCount, 1);
  assert.match(first.sharedHash, /^[0-9a-f]{64}$/);
  assert.match(first.recordHashes['cp-order:1'], /^[0-9a-f]{16}$/);
});

test('each allowed CP field contributes to the digest and exact record diff', () => {
  for (const field of ['dates', 'subManufacturer', 'suppFob', 'suppFobMeta']) {
    const value = field === 'dates' ? { ex: '2026-11-02' } : field === 'suppFobMeta' ? { source: 'cpupdate' } : 'changed';
    const local = digest({ 'cp-order:1': { suppFob: 1 }, 'cp-order:2': { suppFob: 2 } });
    const remote = digest({ 'cp-order:1': { suppFob: 1, [field]: value }, 'cp-order:2': { suppFob: 2 } });
    assert.notEqual(local.sharedHash, remote.sharedHash, field);
    assert.deepEqual(health.compareReports(local, remote).different, ['cp-order:1']);
  }
});

test('business dates remain significant even when their field name resembles a timestamp', () => {
  const first = digest({ 'cp-order:1': { dates: { at: '2026-11-01', updatedAt: '2026-11-02' } } });
  const second = digest({ 'cp-order:1': { dates: { at: '2026-11-01', updatedAt: '2026-11-03' } } });
  assert.notEqual(first.sharedHash, second.sharedHash);
});

test('email directory is included despite GLOBAL_MASTER classification and canonicalizes identity arrays', () => {
  const first = digest({ 'store:email-groups.json': {
    records: [{ id: 'b', email: 'b@demo.invalid', aliases: ['Beta', 'B'], updatedAt: 'yesterday', lock: { userId: 'a', at: NOW } }, { id: 'a', email: 'a@demo.invalid' }],
    countries: [{ id: 'tr', name: 'TR' }, { id: 'uk', name: 'UK' }],
    _revision: 1, storeRevisionMeta: { deviceId: 'a' },
  } });
  const second = digest({ 'store:email-groups.json': {
    countries: [{ name: 'UK', id: 'uk' }, { name: 'TR', id: 'tr' }],
    storeRevisionMeta: { deviceId: 'b' }, _revision: 99,
    records: [{ email: 'a@demo.invalid', id: 'a' }, { aliases: ['B', 'Beta'], email: 'b@demo.invalid', id: 'b', updatedAt: NOW, lock: null }],
  } });
  assert.equal(first.sharedHash, second.sharedHash);
  assert.equal(first.sharedRecordCount, 1);
  assert.notEqual(first.sharedHash, digest({ 'store:email-groups.json': { records: [] } }).sharedHash);
});

test('email tombstones retain identities but exclude their device audit timestamps', () => {
  const first = digest({ 'store:email-groups.json': { records: [], deletedRecords: { a: 'yesterday' } } });
  const same = digest({ 'store:email-groups.json': { records: [], deletedRecords: { a: NOW } } });
  const different = digest({ 'store:email-groups.json': { records: [], deletedRecords: { b: NOW } } });
  assert.equal(first.sharedHash, same.sharedHash);
  assert.notEqual(first.sharedHash, different.sharedHash);
});

test('canonical ordering preserves explicit directory order and ordered business-date arrays', () => {
  const directory = order => digest({ 'store:email-groups.json': { types: [{ id: 'type-a', name: 'A', order }] } });
  assert.notEqual(directory(0).sharedHash, directory(1).sharedHash);
  const dates = dates => digest({ 'cp-order:1': { dates } });
  assert.notEqual(dates(['2026-11-01', '2026-11-02']).sharedHash, dates(['2026-11-02', '2026-11-01']).sharedHash);
});

test('digest is pure and stable for record insertion and nested key order', () => {
  const source = state({ 'cp-order:2': { dates: { b: 'two', a: 'one' } }, 'cp-order:1': { suppFob: 2, suppFobMeta: { source: 'manual', at: NOW } } });
  const original = JSON.stringify(source);
  const first = health.computeSharedDigest(source);
  const second = digest({ 'cp-order:1': { suppFobMeta: { at: 'different', source: 'manual' }, suppFob: 2 }, 'cp-order:2': { dates: { a: 'one', b: 'two' } } });
  assert.equal(first.sharedHash, second.sharedHash);
  assert.equal(JSON.stringify(source), original);
});

test('empty digest is valid and no-details states still produce stable shared hashes', () => {
  const empty = health.computeSharedDigest();
  assert.equal(empty.sharedRecordCount, 0);
  assert.equal(empty.detailsAvailable, true);
  const records = Object.fromEntries(Array.from({ length: 20001 }, (_, index) => [`cp-order:${index}`, { suppFob: index }]));
  const large = digest(records);
  assert.equal(large.sharedRecordCount, 20001);
  assert.equal(large.detailsAvailable, false);
  assert.deepEqual(large.recordHashes, {});
  assert.match(large.sharedHash, /^[0-9a-f]{64}$/);
});

test('one-mebibyte detail bound counts UTF-8 bytes rather than JavaScript characters', () => {
  const records = Object.fromEntries(Array.from({ length: 7000 }, (_, index) => [`cp-order:${'ı'.repeat(100)}:${index}`, { suppFob: index }]));
  const large = digest(records);
  assert.equal(large.detailsAvailable, false);
  assert.deepEqual(large.recordHashes, {});
  assert.ok(Buffer.byteLength(JSON.stringify(health.buildHealthReport({ state: state(records), status: { online: true, lastSync: NOW }, now: NOW }), null, 2)) <= 1024 * 1024);
});

test('report drops details when compact JSON fits but the actual pretty-written file would exceed one mebibyte', () => {
  const records = Object.fromEntries(Array.from({ length: 18000 }, (_, index) => [`cp-order:${'x'.repeat(18)}:${index}`, { suppFob: index }]));
  const expectedHashes = Object.fromEntries(Object.keys(records).map(id => [id, 'a'.repeat(16)]));
  assert.ok(Buffer.byteLength(JSON.stringify(expectedHashes), 'utf8') < 1024 * 1024 - 4096);
  assert.ok(Buffer.byteLength(JSON.stringify({ recordHashes: expectedHashes }, null, 2), 'utf8') > 1024 * 1024);
  const built = health.buildHealthReport({ state: state(records), status: { online: true, lastSync: NOW }, now: NOW });
  assert.equal(built.detailsAvailable, false);
  assert.deepEqual(built.recordHashes, {});
  assert.equal(built.sharedRecordCount, 18000);
  assert.match(built.sharedHash, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.byteLength(JSON.stringify(built, null, 2), 'utf8') <= 1024 * 1024);
});

test('report derives published sequences and conflicts without treating local-only events as publication', () => {
  const source = state({ 'cp-order:1': { suppFob: 5 } });
  source.deviceId = 'state-device';
  source.syncLedger = { compactedThrough: 3 };
  source.journal = [{ uploaded: true, localSequence: 7 }, { uploaded: false, localSequence: 12 }, { uploaded: true, localOnly: true, localSequence: 15 }];
  source.conflicts = [{ resolved: true }, { resolved: false }];
  const built = health.buildHealthReport({ state: source, status: { online: true, pendingUpload: 0, lastSync: NOW }, userId: 'user', displayName: 'Demo', appVersion: '7.0.1', masterRevisionApplied: 4, now: NOW });
  assert.equal(built.schemaVersion, 1);
  assert.equal(built.deviceId, 'state-device');
  assert.equal(built.latestPublishedSeq, 7);
  assert.equal(built.lastSyncAt, NOW);
  assert.equal(built.masterRevisionApplied, 4);
  assert.equal(built.openConflicts, 1);
  assert.equal(built.settled, false);
});

test('settled requires a successful completed sync, no upload and no conflicts', () => {
  const make = status => health.buildHealthReport({ state: state({}), status, now: NOW });
  assert.equal(make({ online: true, pendingUpload: 0, conflict: 0, lastSync: NOW }).settled, true);
  for (const status of [
    {}, { online: false, lastSync: NOW }, { online: true },
    { online: true, lastSync: NOW, lastError: 'warning' },
    { online: true, lastSync: NOW, pendingUpload: 1 },
    { online: true, lastSync: NOW, conflict: 1 },
  ]) assert.equal(make(status).settled, false, JSON.stringify(status));
});

test('report explicit status overrides and injected time are honored', () => {
  const built = health.buildHealthReport({ state: state({}), deviceId: 'd', status: { online: true, lastSyncAt: NOW, latestPublishedSeq: 8, openConflicts: 0 }, now: Date.parse(NOW) });
  assert.equal(built.deviceId, 'd');
  assert.equal(built.updatedAt, NOW);
  assert.equal(built.latestPublishedSeq, 8);
  assert.equal(built.settled, true);
});

test('report has bounded identity fields and cannot settle during active progress', () => {
  const built = health.buildHealthReport({ state: state({}), deviceId: 'd'.repeat(2000000), displayName: 'x'.repeat(2000000), status: { online: true, lastSync: NOW, progress: { phase: 'download' } }, now: NOW });
  assert.equal(built.deviceId.length, 160);
  assert.equal(built.displayName.length, 240);
  assert.equal(built.settled, false);
  assert.ok(Buffer.byteLength(JSON.stringify(built, null, 2)) <= 1024 * 1024);
});

test('diff directions, missing details and global result limit are explicit', () => {
  const local = digest({ 'cp-order:a': { suppFob: 1 }, 'cp-order:b': { suppFob: 1 } });
  const remote = digest({ 'cp-order:a': { suppFob: 2 }, 'cp-order:c': { suppFob: 1 } });
  assert.deepEqual(health.compareReports(local, remote), { different: ['cp-order:a'], onlyThere: ['cp-order:c'], onlyHere: ['cp-order:b'], truncated: false, detailsAvailable: true });
  const limited = health.compareReports(local, remote, { limit: 2 });
  assert.equal(limited.different.length + limited.onlyThere.length + limited.onlyHere.length, 2);
  assert.equal(limited.truncated, true);
  assert.equal(health.compareReports(local, { detailsAvailable: false, recordHashes: {} }).detailsAvailable, false);
  assert.equal(health.compareReports(local, {}).detailsAvailable, false);
});

test('diff maximum is 200 even when the caller requests more', () => {
  const many = { detailsAvailable: true, recordHashes: Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`cp-order:${i}`, 'f'.repeat(16)])) };
  const diff = health.compareReports({ detailsAvailable: true, recordHashes: {} }, many, { limit: 999 });
  assert.equal(diff.onlyThere.length, 200);
  assert.equal(diff.truncated, true);
});

test('classification elects a unique settled fresh hash and excludes stale or syncing votes', () => {
  const reports = [report(), report({ deviceId: 'b' }), report({ deviceId: 'c', sharedHash: 'b'.repeat(64) }), report({ deviceId: 'syncing', settled: false, sharedHash: 'b'.repeat(64) }), report({ deviceId: 'stale', updatedAt: '2026-10-07T10:00:00.000Z', sharedHash: 'b'.repeat(64) }), { deviceId: 'old' }];
  const classified = health.classifyReports(reports, { now: NOW });
  assert.equal(classified.majorityHash, 'a'.repeat(64));
  assert.equal(classified.indeterminate, false);
  assert.deepEqual(classified.devices.map(device => device.status), ['same', 'same', 'diverged', 'syncing', 'stale', 'old-version']);
  assert.equal(reports[0].status, undefined);
});

test('classification ties are indeterminate and do not accuse either device of divergence', () => {
  const classified = health.classifyReports([report(), report({ deviceId: 'b', sharedHash: 'b'.repeat(64) })], { now: NOW });
  assert.equal(classified.majorityHash, null);
  assert.equal(classified.indeterminate, true);
  assert.deepEqual(classified.devices.map(device => device.status), ['indeterminate', 'indeterminate']);
});

test('classification handles no reports, missing valid timestamps and the exact stale boundary', () => {
  assert.deepEqual(health.classifyReports([], { now: NOW }), { majorityHash: null, indeterminate: true, devices: [] });
  const classified = health.classifyReports([report({ updatedAt: '2026-10-08T10:00:00.000Z' }), report({ deviceId: 'invalid', updatedAt: 'bad' })], { now: NOW });
  assert.equal(classified.devices[0].status, 'same');
  assert.equal(classified.devices[1].status, 'old-version');
});
