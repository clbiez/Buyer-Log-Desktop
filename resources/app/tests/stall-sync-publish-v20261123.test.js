'use strict';
/* Sync/publish ana iş parçacığı donmaları (8.0.12 saha CPU profili):
   - publish başına tüm Master payload'ının defalarca senkron stableJson + SHA'sı,
   - değişmeyen yayında bile checkpoint + arşivin yeniden okunup doğrulanması,
   - sync-settings.read() her çağrıda dosya okuması.
   Bu testler davranışı (aynı özet, tek blok sınırı, gereksiz okuma yok) ve
   P1 sınırını (başka cihazın/diskin değişikliği ASLA kaçırılmaz) sabitler. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const digestLib = require('../server/lib/stable-digest');
const { createSharedHub } = require('../server/lib/shared-hub');
const releases = require('../server/lib/master-releases');
const { createSyncSettings } = require('../server/lib/sync-settings');

function referenceStable(value) {
  if (Array.isArray(value)) return `[${value.map(referenceStable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${referenceStable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const referenceSha = value => crypto.createHash('sha256').update(Buffer.from(referenceStable(value), 'utf8')).digest('hex');

async function temp(t, prefix = 'buyerlog-stall-') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(dir, { recursive:true, force:true }));
  return dir;
}
async function hub(t) {
  const root = await temp(t), shared = path.join(root, 'shared');
  await fsp.mkdir(shared);
  const a = createSharedHub({ localDataRoot:path.join(root, 'device-a'), appVersion:'test' });
  await a.initialize(shared, { createdBy:'moderator' });
  const b = createSharedHub({ localDataRoot:path.join(root, 'device-b'), appVersion:'test' });
  return { root, shared, a, b };
}
// Synthetic, anonymised field-like Master volume (no business data).
function masterPayload(scale = 1, label = 'v1') {
  const records = {};
  records['store:overrides.json'] = {
    pricingRules:Array.from({ length:3000 * scale }, (_, i) => ({ id:`pr-${i}`, season:['SS25', 'AW25'][i % 2], multiplier:1 + (i % 97) / 100, notes:`Not ${i} ğüşİ`, tiers:[{ qty:500, discount:0.05 }, { qty:1000, discount:0.1 }] })),
    licenseCards:{ items:Array.from({ length:800 * scale }, (_, i) => ({ id:`lc-${i}`, licensor:`Licensor ${i % 50}`, royalty:(i % 15) / 100, stages:Array.from({ length:5 }, (_, k) => ({ stage:k, days:k * 3 })) })) },
    freightRates:Array.from({ length:600 * scale }, (_, i) => ({ lane:`L${i}`, usdPerKg:(i % 50) / 10 })),
    label,
  };
  records['store:settings.json'] = { modelConnections:[{ id:'c1', name:'Demo' }] };
  for (let i = 0; i < 1500 * scale; i++) records[`endeksmatik:${i}`] = { id:i, series:Array.from({ length:12 }, (_, k) => k * i % 101) };
  return { authority:'moderator', records };
}
function countIo(t) {
  const counts = { checkpointReads:0, archiveOpens:0 };
  const readFile = fsp.readFile, open = fsp.open;
  fsp.readFile = function patchedReadFile(file, ...rest) {
    if (/[\\/]master[\\/]checkpoints[\\/].*\.json\.gz$/.test(String(file))) counts.checkpointReads++;
    return readFile.call(this, file, ...rest);
  };
  fsp.open = function patchedOpen(file, ...rest) {
    if (/[\\/]master[\\/]releases[\\/]\d+\.json\.gz$/.test(String(file))) counts.archiveOpens++;
    return open.call(this, file, ...rest);
  };
  const restore = () => { fsp.readFile = readFile; fsp.open = open; };
  t.after(restore);
  return { counts, restore };
}
async function longestBlockDuring(work) {
  let longest = 0, last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 1);
  try { const result = await work(); const now = performance.now(); longest = Math.max(longest, now - last); return { result, longest }; }
  finally { clearInterval(timer); }
}

test('streamed stable digest is byte-identical to sha256(stableJson) on edge values', async () => {
  const cases = [
    { a:undefined, b:[1, undefined, () => 1, Symbol('s'), , 3], c:NaN, d:new Date(0), e:'ğüşİ\ud800', f:[[], {}], g:null, h:-0, i:Infinity, 'é':{ z:1, a:[{}] } },
    [undefined], [], {}, 'x', 5, null, [[[[1]]]], { nested:{ deep:{ deeper:[{ k:'v' }] } } },
    masterPayload(1),
  ];
  for (const value of cases) assert.equal(await digestLib.stableSha256(value), referenceSha(value));
  const envelope = { schemaVersion:1, revision:3, actorId:'m', payload:masterPayload(1) };
  assert.deepEqual(await digestLib.stableSha256Pair(envelope, 'payload'), { outer:referenceSha(envelope), inner:referenceSha(envelope.payload) });
  assert.equal(digestLib.stableJson(cases[0]), referenceStable(cases[0]));
});

test('streamed digest yields to the event loop instead of one long block', async () => {
  const value = masterPayload(3);
  let interleaved = 0;
  const timer = setInterval(() => { interleaved++; }, 1);
  const { result, longest } = await longestBlockDuring(() => digestLib.stableSha256(value));
  clearInterval(timer);
  assert.equal(result, referenceSha(value));
  assert.ok(interleaved > 0, 'timers must run while a large digest is computed');
  assert.ok(longest < 150, `longest event-loop block ${longest.toFixed(1)} ms`);
});

test('unchanged moderator publish reuses the verified head: no checkpoint/archive re-read, short blocks', async t => {
  const { shared, a } = await hub(t), payload = masterPayload(3);
  const first = await a.publishMaster(shared, payload, { actorId:'moderator' });
  assert.equal(first.revision, 1);
  const io = countIo(t);
  let lazyCalls = 0;
  const { result:again, longest } = await longestBlockDuring(() => a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1, changedEntities:() => { lazyCalls++; return ['pricingRules']; } }));
  io.restore();
  assert.equal(again.unchanged, true);
  assert.equal(again.revision, 1);
  assert.deepEqual(again.release, first.release);
  assert.equal(io.counts.checkpointReads, 0, 'unchanged publish must not re-read the checkpoint');
  assert.equal(io.counts.archiveOpens, 0, 'unchanged publish must not re-read the archive');
  assert.equal(lazyCalls, 0, 'changed-entity diff is release metadata only and must not run when unchanged');
  assert.ok(longest < 150, `longest event-loop block ${longest.toFixed(1)} ms`);
  // A real change is still detected and its lazy metadata is evaluated exactly once.
  const changed = masterPayload(3, 'v2');
  const next = await a.publishMaster(shared, changed, { actorId:'moderator', previousRevision:1, changedEntities:async () => { lazyCalls++; return ['pricingRules', 'pricingRules', 7]; } });
  assert.equal(next.revision, 2);
  assert.equal(lazyCalls, 1);
  assert.deepEqual(next.release.changedEntities, ['pricingRules']);
  const archived = await releases.readRelease(shared, 2);
  assert.equal(archived.checkpoint.payload.records['store:overrides.json'].label, 'v2');
  assert.equal(next.rulesSha256, referenceSha(changed));
  assert.equal(next.payloadSha256, referenceSha(archived.checkpoint.payload));
});

test('another device publishing is always seen through the shared head (no missed change)', async t => {
  const { shared, a, b } = await hub(t);
  await a.publishMaster(shared, masterPayload(1, 'a1'), { actorId:'moderator' });
  await a.publishMaster(shared, masterPayload(1, 'a1'), { actorId:'moderator', previousRevision:1 });
  const remote = await b.publishMaster(shared, masterPayload(1, 'b2'), { actorId:'moderator', previousRevision:1 });
  assert.equal(remote.revision, 2);
  // Device A still remembers revision 1 as verified; the newer shared head wins.
  await assert.rejects(a.publishMaster(shared, masterPayload(1, 'a1'), { actorId:'moderator', previousRevision:1 }), { code:'MASTER_REVISION_CONFLICT' });
  const same = await a.publishMaster(shared, masterPayload(1, 'b2'), { actorId:'moderator', previousRevision:2 });
  assert.equal(same.unchanged, true);
  assert.equal(same.revision, 2);
  assert.equal(same.release.version, 2);
  const mine = await a.publishMaster(shared, masterPayload(1, 'a3'), { actorId:'moderator', previousRevision:2 });
  assert.equal(mine.revision, 3);
  const read = await b.readMaster(shared);
  assert.equal(read.envelope.payload.records['store:overrides.json'].label, 'a3');
  assert.deepEqual((await releases.listReleases(shared)).map(item => item.version), [3, 2, 1]);
});

test('archive deleted or corrupted after verification is repaired or rejected exactly as before', async t => {
  const { shared, a } = await hub(t), payload = masterPayload(1);
  await a.publishMaster(shared, payload, { actorId:'moderator' });
  await a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1 });
  const archive = path.join(shared, 'master', 'releases', '1.json.gz');
  await fsp.unlink(archive);
  const repaired = await a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1 });
  assert.equal(repaired.unchanged, true);
  assert.equal((await releases.readRelease(shared, 1)).checkpoint.revision, 1, 'deleted archive is re-created from the head');
  await fsp.writeFile(archive, 'not a gzip archive');
  await assert.rejects(a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1 }), { code:'MASTER_RELEASE_DECODE_INVALID' });
  await assert.rejects(a.publishMaster(shared, masterPayload(1, 'next'), { actorId:'moderator', previousRevision:1 }), { code:'MASTER_RELEASE_DECODE_INVALID' });
  assert.equal((await a.readMasterHead(shared)).revision, 1, 'a corrupt archive still blocks advancing');
});

test('checkpoint file removed behind the head is noticed, not masked by the verification memo', async t => {
  const { shared, a } = await hub(t), payload = masterPayload(1);
  const first = await a.publishMaster(shared, payload, { actorId:'moderator' });
  await a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1 });
  await fsp.unlink(path.join(shared, 'master', first.file));
  await assert.rejects(a.publishMaster(shared, payload, { actorId:'moderator', previousRevision:1 }), { code:'ENOENT' });
});

test('unversioned business checkpoint keeps exact payload digest and content dedupe', async t => {
  const { shared, a } = await hub(t);
  const payload = { records:{ 'license-card:state':{ items:[{ id:'x', value:1 }] } }, syncHeads:{ d1:3 } };
  const first = await a.publishBusiness(shared, payload, { actorId:'moderator' });
  assert.equal(first.payloadSha256, referenceSha(payload));
  assert.equal((await a.publishBusiness(shared, payload, { actorId:'moderator', previousRevision:1 })).unchanged, true);
  const changed = { ...payload, syncHeads:{ d1:4 } };
  const second = await a.publishBusiness(shared, changed, { actorId:'moderator', previousRevision:1 });
  assert.equal(second.revision, 2);
  assert.equal(second.payloadSha256, referenceSha(changed));
});

test('sync-settings read() serves repeated calls from a stat-validated cache and never misses a write', async t => {
  const dir = await temp(t, 'buyerlog-sync-settings-cache-');
  const dbFile = path.join(dir, 'BuyerLogLocal.db');
  const settings = createSyncSettings({ localDataRoot:dir, localDb:{ getFile:() => dbFile, getDeviceId:() => 'device-1' }, allowSync:() => true });
  const file = path.join(dir, 'sync-settings.json');
  fs.writeFileSync(file, JSON.stringify({ sharedSyncRoot:path.join(dir, 'one'), localDbPath:dbFile, syncPeriodMinutes:5 }));
  let reads = 0;
  const readFile = fsp.readFile;
  fsp.readFile = function patched(target, ...rest) { if (path.resolve(String(target)) === file) reads++; return readFile.call(this, target, ...rest); };
  t.after(() => { fsp.readFile = readFile; });
  const first = await settings.read();
  assert.equal(first.sharedSyncRoot, path.join(dir, 'one'));
  const burst = await Promise.all(Array.from({ length:20 }, () => settings.read()));
  for (let i = 0; i < 20; i++) await settings.read();
  assert.equal(reads, 1, 'unchanged settings file is read once');
  // Callers mutate the returned object; that must never leak into later reads.
  burst[0].sharedSyncRoot = 'mutated'; burst[1].checkpoint.x = 1;
  assert.equal((await settings.read()).sharedSyncRoot, path.join(dir, 'one'));
  assert.deepEqual((await settings.read()).checkpoint, {});
  // External rewrite with identical length and the old mtime is still seen.
  const before = fs.statSync(file);
  fs.writeFileSync(file, JSON.stringify({ sharedSyncRoot:path.join(dir, 'two'), localDbPath:dbFile, syncPeriodMinutes:5 }));
  fs.utimesSync(file, before.atime, before.mtime);
  assert.equal((await settings.read()).sharedSyncRoot, path.join(dir, 'two'));
  // Own writes are visible immediately, including to a read that started during the write.
  const saving = settings.savePeriod(10);
  const during = settings.read();
  await saving;
  assert.equal((await settings.read()).syncPeriodMinutes, 10);
  await during;
  await settings.save(path.join(dir, 'three'));
  assert.equal((await settings.read()).sharedSyncRoot, path.join(dir, 'three'));
  fs.unlinkSync(file);
  assert.equal((await settings.read()).sharedSyncRoot, '', 'a removed file falls back to defaults, not to the cache');
});

test('server publish reuses the guard read and computes changed entities lazily without blocking', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const publish = server.slice(server.indexOf('async function publishMasterCheckpoint('), server.indexOf('/* MODERATÖR KURALLARININ ALINMASI'));
  assert.match(publish, /Object\.hasOwn\(guard, 'remote'\) \? guard\.remote : await sharedHub\.readMaster\(checked\.root, null\)/);
  assert.match(publish, /const changedEntities = \(\) => changedMasterEntities\(/);
  assert.match(server, /async function changedMasterEntities\(remoteRecords, localRecords, ids\) \{[\s\S]{0,700}const tick = createYielder\(\);[\s\S]{0,200}await tick\(\);/);
  const calls = [...server.matchAll(/(.{0,16})\bchangedMasterEntities\(/g)].map(match => match[1]).filter(prefix => !/function $/.test(prefix));
  assert.equal(calls.length, 3);
  for (const prefix of calls) assert.match(prefix, /(?:await |\(\) => )$/, `every caller awaits the cooperative diff: ${prefix}`);
});
