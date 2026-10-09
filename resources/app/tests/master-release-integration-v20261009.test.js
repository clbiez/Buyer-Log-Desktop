'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const preparedApp = path.resolve(__dirname, '..');
const actualApp = process.env.BUYERLOG_P6_APP_ROOT || preparedApp;
const { createSharedHub } = require('../server/lib/shared-hub');
const releases = require('../server/lib/master-releases');
const { createLocalDb } = require(path.join(actualApp, 'server/lib/local-db'));
const { createDeltaStore } = require(path.join(actualApp, 'server/lib/delta-store'));
const { compare:compareHlc } = require(path.join(actualApp, 'server/lib/hlc'));
const sharedSyncPolicy = require(path.join(actualApp, 'server/lib/shared-sync-policy'));
const prewipeMasterRecovery = require(path.join(actualApp, 'server/lib/prewipe-master-recovery'));
const { atomicWriteJson } = require(path.join(actualApp, 'server/user-data'));

// Evaluate the real declarations without starting unrelated HTTP/auth providers.
// All persistence, merge, scope, publication and archive dependencies are real.
const acornModule = { exports:{} };
new Function('exports', 'module', process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'])(acornModule.exports, acornModule);
const source = fs.readFileSync(path.join(preparedApp, 'server/server.js'), 'utf8');
const declarations = acornModule.exports.parse(source, { ecmaVersion:'latest', sourceType:'script' }).body;
const names = new Set(['isModeratorProfile', 'masterReleaseNote', 'publishMasterCheckpoint', 'readModeratorMasterState',
  'rememberModeratorMasterRevision', 'pullModeratorMasterIfNewer', 'applyModeratorMasterCheckpoint', 'changedMasterEntities',
  'checkpointRecords', 'checkpointUnaccountedIds', 'checkpointDocumentRevision', 'checkpointRecordClock',
  'checkpointRemoteAheadIds', 'guardCheckpointPublish', 'masterCheckpointHasModeratorAuthority']);
const functions = declarations.filter(item => item.type === 'FunctionDeclaration' && names.has(item.id.name));
assert.equal(functions.length, names.size);
const script = new vm.Script(functions.map(item => source.slice(item.start, item.end)).join('\n'), { filename:'real-master-release-functions.js' });
async function temp(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-release-integration-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  return root;
}
async function hubRoot(t) {
  const root = await temp(t), shared = path.join(root, 'shared');
  await fsp.mkdir(shared);
  const hub = createSharedHub({ localDataRoot:path.join(root, 'bootstrap'), appVersion:'test' });
  const initialized = await hub.initialize(shared, { createdBy:'moderator' });
  return { root, shared, hub, hubId:initialized.manifest.hubId };
}
async function device(root, shared, hubId, name, moderator, clock = null) {
  const localRoot = path.join(root, name);
  const localDb = createLocalDb(path.join(localRoot, 'BuyerLogLocal.db'), clock ? { clock } : {});
  await localDb.ensure();
  const deltaStore = createDeltaStore({ localDb, mode:'delta' });
  const sharedHub = createSharedHub({ localDataRoot:localRoot, appVersion:'test' });
  await sharedHub.markBootstrap({ root:shared, hubId, completed:true });
  const notifications = [];
  const context = vm.createContext({ fs, atomicWriteJson, localDb, deltaStore, sharedHub,
    masterReleases:releases, sharedSyncPolicy, prewipeMasterRecovery,
    MODERATOR_MASTER_STATE_FILE:path.join(localRoot, 'moderator-master-state.json'),
    moderatorActiveOnThisDevice:() => moderator,
    moderatorSessionActor:'moderator',
    userAccess:{ profileById:id => ({ id, enabled:id !== 'disabled', systemRole:id === 'moderator' ? 'moderator' : 'buyer' }) },
    syncSettings:{ read:async () => ({ sharedSyncRoot:shared }) },
    masterRulePublicationTail:Promise.resolve(),
    masterCheckpointPending:false, masterCheckpointTimer:null, masterCheckpointInFlight:false,
    markStartup:() => {}, announceRecoveredMasterEntities:entities => notifications.push({ entities }),
    liveEvents:{ notifyChange:area => notifications.push({ area }) },
  });
  script.runInContext(context);
  return { localDb, deltaStore, sharedHub, context, notifications };
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function payload(value) { return { authority:'moderator', records:{ 'store:settings.json':{ modelConnections:[{ id:'c1', name:value }] } } }; }

test('master publication archives actual revision and separates full integrity from release-free equality', async t => {
  const { shared, hub } = await hubRoot(t), first = await hub.publishMaster(shared, payload('old'), { actorId:'moderator' });
  assert.equal(first.revision, 1);
  assert.equal(first.release.version, 1);
  const read = await hub.readMaster(shared);
  assert.equal(first.payloadSha256, digest(read.envelope.payload));
  const { release, ...rules } = read.envelope.payload;
  assert.equal(first.rulesSha256, digest(rules));
  assert.equal((await releases.readRelease(shared, 1)).release.publishedBy, 'moderator');
  const automatic = await hub.publishMaster(shared, { ...payload('old'), release:{ version:999, note:'fake', publishedAt:new Date().toISOString() } }, { actorId:'moderator' });
  assert.equal(automatic.unchanged, true);
  assert.equal(automatic.revision, 1);
  const noted = await hub.publishMaster(shared, payload('old'), { actorId:'moderator', note:'Reviewed and approved', previousRevision:1 });
  assert.equal(noted.revision, 2);
  assert.equal(noted.release.version, 2);
  assert.equal(noted.rulesSha256, first.rulesSha256);
  assert.notEqual(noted.payloadSha256, first.payloadSha256);
  assert.equal((await releases.listReleases(shared)).length, 2);
  const forced = await hub.publishMaster(shared, payload('old'), { actorId:'moderator', forceRevision:true, previousRevision:2 });
  assert.equal(forced.revision, 3);
  const concurrent = await Promise.allSettled([1, 2].map(i => hub.publishMaster(shared, payload(`concurrent-${i}`), { actorId:'moderator', previousRevision:3 })));
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
  assert.equal((await hub.readMasterHead(shared)).revision, 4);
  assert.equal((await releases.listReleases(shared))[0].version, 4);
});

test('archive failure repairs published head before equality or next revision; no published release is skipped', async t => {
  const { shared, hub } = await hubRoot(t), archive = path.join(shared, 'master/releases');
  await fsp.writeFile(archive, 'blocked');
  await assert.rejects(hub.publishMaster(shared, payload('old'), { actorId:'moderator' }));
  assert.equal((await hub.readMasterHead(shared)).revision, 1);
  await assert.rejects(hub.publishMaster(shared, payload('new'), { actorId:'moderator' }));
  assert.equal((await hub.readMasterHead(shared)).revision, 1);
  await fsp.unlink(archive);
  const retry = await hub.publishMaster(shared, payload('old'), { actorId:'moderator' });
  assert.equal(retry.unchanged, true);
  assert.equal(retry.revision, 1);
  assert.equal((await releases.readRelease(shared, 1)).checkpoint.payload.records['store:settings.json'].modelConnections[0].name, 'old');
  assert.equal((await hub.publishMaster(shared, payload('new'), { actorId:'moderator' })).revision, 2);
  assert.deepEqual((await releases.listReleases(shared)).map(item => item.version), [2, 1]);
});

test('real publish/archive/restore/new-user pull preserves CP/email/local data and journal with zero conflicts', async t => {
  const { root, shared, hubId, hub } = await hubRoot(t);
  const mod = await device(root, shared, hubId, 'moderator', true, () => 2000000);
  const settings = { modelConnections:[{ id:'c1', name:'old-rule', lastRun:'moderator-local' }], sourceFolders:{ orders:'/mod-local' } };
  await mod.localDb.queuePatches([
    { id:'store:settings.json', patch:settings, userId:'moderator' },
    { id:'store:overrides.json', patch:{ transitRules:[{ country:'TR', days:7 }], notesmap:{ order:'private' } }, userId:'moderator' },
    { id:'store:email-groups.json', patch:{ records:[{ id:'mail', email:'initial@example.com' }] }, userId:'moderator' },
    { id:'cp-order:o1', patch:{ suppFob:33, notes:'mod-private' }, userId:'moderator' },
  ]);
  // Existing checkpoints may retain field clocks from their originating writer.
  // Use the real event stamp, while the receiving buyer clock is behind it.
  await mod.localDb.transaction(next => {
    next.records['store:settings.json']._fieldOrders = { modelConnections:{ userId:'moderator', hlc:next.journal[0].hlc } };
  });
  const v1 = await mod.context.publishMasterCheckpoint('moderator', { note:'Initial rules' });
  assert.equal(v1.head.revision, 1);
  assert.equal(v1.head.release.version, 1);
  const old = await releases.readRelease(shared, 1);
  assert.equal(old.checkpoint.payload.records['store:settings.json'].sourceFolders, undefined);
  assert.equal(old.checkpoint.payload.records['store:settings.json'].modelConnections[0].lastRun, undefined);
  await mod.localDb.queuePatches([
    { id:'store:settings.json', patch:{ modelConnections:[{ id:'c1', name:'new-rule', lastRun:'moderator-local' }] }, userId:'moderator' },
    { id:'store:overrides.json', patch:{ transitRules:[{ country:'TR', days:21 }] }, userId:'moderator' },
    { id:'store:email-groups.json', patch:{ records:[{ id:'mail', email:'current@example.com' }] }, userId:'moderator' },
  ]);
  assert.equal((await mod.context.publishMasterCheckpoint('moderator')).head.revision, 2);
  const modBefore = await mod.localDb.read();
  const restored = await mod.context.publishMasterCheckpoint('moderator', { note:'Restore reviewed rules', restoredSnapshot:old.checkpoint.payload });
  assert.equal(restored.head.revision, 3);
  assert.equal(restored.head.release.version, 3);
  assert.equal((await hub.readMasterHead(shared)).revision, 3);
  const v3 = await releases.readRelease(shared, 3);
  assert.equal(v3.checkpoint.payload.authority, 'moderator');
  assert.equal(v3.checkpoint.payload.records['store:settings.json'].modelConnections[0].name, 'old-rule');
  const modAfter = await mod.localDb.read();
  assert.deepEqual(modAfter.journal, modBefore.journal);
  assert.deepEqual(modAfter.records['cp-order:o1'], modBefore.records['cp-order:o1']);
  assert.deepEqual(modAfter.records['store:email-groups.json'], modBefore.records['store:email-groups.json']);
  assert.equal(modAfter.records['store:settings.json'].sourceFolders.orders, '/mod-local');
  assert.equal(modAfter.records['store:settings.json'].modelConnections[0].lastRun, 'moderator-local');
  assert.equal(modAfter.records['store:overrides.json'].notesmap.order, 'private');
  assert.equal((await mod.context.publishMasterCheckpoint('moderator')).unchanged, true);
  assert.equal((await hub.readMasterHead(shared)).revision, 3);
  const buyer = await device(root, shared, hubId, 'fresh-buyer', false, () => 1000000);
  await buyer.localDb.queuePatches([
    { id:'store:settings.json', patch:{ modelConnections:[{ id:'c1', name:'locally-old', lastRun:'buyer-local' }], sourceFolders:{ orders:'/buyer-local' } }, userId:'buyer' },
    { id:'store:overrides.json', patch:{ transitRules:[{ country:'TR', days:2 }], notesmap:{ order:'buyer-private' } }, userId:'buyer' },
    { id:'store:email-groups.json', patch:{ records:[{ id:'buyer-mail', email:'buyer@example.com' }] }, userId:'buyer' },
    { id:'cp-order:buyer-order', patch:{ suppFob:91, notes:'buyer-private' }, userId:'buyer' },
  ]);
  const before = await buyer.localDb.read();
  const pulled = await buyer.context.pullModeratorMasterIfNewer();
  assert.equal(pulled.revision, 3);
  const after = await buyer.localDb.read();
  assert.equal(after.records['store:settings.json'].modelConnections[0].name, 'old-rule');
  const importedClock = v3.checkpoint.payload.records['store:settings.json']._fieldOrders.modelConnections.hlc;
  assert.ok(compareHlc(after.hlc, importedClock) > 0, 'checkpoint import observes its remote HLC despite buyer clock skew');
  assert.equal(after.records['store:overrides.json'].transitRules[0].days, 7);
  assert.equal(after.records['store:settings.json'].modelConnections[0].lastRun, 'buyer-local');
  assert.equal(after.records['store:settings.json'].sourceFolders.orders, '/buyer-local');
  assert.equal(after.records['store:overrides.json'].notesmap.order, 'buyer-private');
  assert.deepEqual(after.journal, before.journal);
  assert.deepEqual(after.records['cp-order:buyer-order'], before.records['cp-order:buyer-order']);
  assert.deepEqual(after.records['store:email-groups.json'], before.records['store:email-groups.json']);
  assert.equal(after.conflicts.filter(item => !item.resolved).length, 0);
  assert.equal(modAfter.conflicts.filter(item => !item.resolved).length, 0);
  assert.equal(buyer.deltaStore.readAllSync('store')['settings.json'].modelConnections[0].name, 'old-rule');
  const marker = buyer.context.readModeratorMasterState();
  assert.equal(marker.revision, 3);
  assert.equal(marker.release.version, 3);
  assert.equal(marker.hubId, hubId);
  assert.equal(buyer.notifications.filter(item => item.area === 'master-rules').length, 1);
  assert.equal((await buyer.context.pullModeratorMasterIfNewer()).unchanged, true);
  assert.equal(buyer.notifications.filter(item => item.area === 'master-rules').length, 1);
  const denied = await mod.context.publishMasterCheckpoint('buyer', { note:'not allowed' });
  assert.equal(denied.reason, 'moderator-only');
  assert.equal((await hub.readMasterHead(shared)).revision, 3);
});


test('moderator marker never pairs a newer legacy revision with an older release summary', async t => {
  const { root, shared, hubId } = await hubRoot(t);
  const buyer = await device(root, shared, hubId, 'marker-test', false);
  await buyer.context.rememberModeratorMasterRevision(hubId, 3, { version:3, note:'current' });
  await buyer.context.rememberModeratorMasterRevision(hubId, 2, { version:2, note:'stale' });
  assert.equal(buyer.context.readModeratorMasterState().release.version, 3);
  await buyer.context.rememberModeratorMasterRevision(hubId, 4);
  assert.equal(buyer.context.readModeratorMasterState().revision, 4);
  assert.equal(buyer.context.readModeratorMasterState().release, null);
  await buyer.context.rememberModeratorMasterRevision('different-hub', 1);
  assert.equal(buyer.context.readModeratorMasterState().revision, 1);
  assert.equal(buyer.context.readModeratorMasterState().release, null);
});

test('stalled ordinary pull cannot undo a later restore and stale snapshots never regress applied rules', {timeout:5000},async t=>{
 const {root,shared,hubId}=await hubRoot(t),mod=await device(root,shared,hubId,'moderator',true);
 await mod.localDb.queuePatch({id:'store:settings.json',patch:{modelConnections:[{id:'c1',name:'old-rule'}]},userId:'moderator'});
 await mod.context.publishMasterCheckpoint('moderator',{note:'v1'});const v1=await releases.readRelease(shared,1);
 await mod.localDb.queuePatch({id:'store:settings.json',patch:{modelConnections:[{id:'c1',name:'new-rule'}]},userId:'moderator'});
 await mod.context.publishMasterCheckpoint('moderator',{note:'v2'});
 // Simulate v2 published elsewhere but not yet observed by the local marker.
 atomicWriteJson(mod.context.MODERATOR_MASTER_STATE_FILE,{hubId,revision:1,release:v1.release});
 let began,resume;const started=new Promise(resolve=>began=resolve),gate=new Promise(resolve=>resume=resolve);
 const readMaster=mod.sharedHub.readMaster;let stalledSnapshot,first=true;
 mod.sharedHub.readMaster=async(...args)=>{const value=await readMaster(...args);if(first){first=false;stalledSnapshot=value;began();await gate;}return value;};
 const pull=mod.context.pullModeratorMasterIfNewer();await started;
 const restore=mod.context.publishMasterCheckpoint('moderator',{restoredSnapshot:v1.checkpoint.payload});
 await new Promise(resolve=>setImmediate(resolve));assert.equal((await mod.sharedHub.readMasterHead(shared)).revision,2);
 resume();await pull;await restore;
 assert.equal((await mod.localDb.read()).records['store:settings.json'].modelConnections[0].name,'old-rule');
 assert.equal(mod.context.readModeratorMasterState().revision,3);
 assert.equal((await mod.context.applyModeratorMasterCheckpoint(stalledSnapshot,hubId)).unchanged,true);
 assert.equal((await mod.localDb.read()).records['store:settings.json'].modelConnections[0].name,'old-rule');
 assert.equal((await mod.context.pullModeratorMasterIfNewer()).unchanged,true);
});
