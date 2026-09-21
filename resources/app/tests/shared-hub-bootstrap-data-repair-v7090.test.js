'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('Shared Hub bootstrap waits for legacy-to-delta maintenance before declaring the cache ready', () => {
  const bootstrap = server.slice(server.indexOf('async function bootstrapSharedHub'), server.indexOf('// Local auth starts first.'));
  assert.match(bootstrap, /await ensureLocalDbMaintenanceReady\(\)/);
  assert.match(server, /setTimeout\(\(\) => \{ void ensureLocalDbMaintenanceReady\(\)/);
  assert.doesNotMatch(server, /setTimeout\(\(\) => \{ void runLocalDbMaintenance\(\); \}/);
});

test('completed revision metadata cannot hide missing or stale master/business checkpoint records', () => {
  assert.match(server, /function checkpointUnaccountedIds\(/);
  assert.match(server, /function checkpointRemoteAheadIds\(/);
  assert.match(server, /function checkpointRecoverableIds\(/);
  assert.match(server, /checkpointDocumentRevision\(record\)/);
  assert.match(server, /remoteClock\.value > localClock\.value/);
  assert.match(server, /!Object\.hasOwn\(local, id\) && !Object\.hasOwn\(deleted, id\)/);
  assert.match(server, /async function reconcileSharedCheckpointCoverage\(/);
  const bootstrap = server.slice(server.indexOf('async function bootstrapSharedHub'), server.indexOf('// Local auth starts first.'));
  assert.match(bootstrap, /const checkpointRepair = await reconcileSharedCheckpointCoverage\(checked\.root, checked\.manifest\)/);
  assert.match(server, /next\.records\[id\] = JSON\.parse\(JSON\.stringify\(remoteRecords\[id\]\)\)/);
  assert.match(server, /SHARED_HUB_DATA_INCOMPLETE/);
});

test('an incomplete local cache is forbidden from replacing a richer Shared Hub checkpoint', () => {
  const master = server.slice(server.indexOf("async function publishMasterCheckpoint"), server.indexOf('let masterCheckpointTimer'));
  assert.match(master, /guardCheckpointPublish\('master'/);
  assert.match(master, /local-master-incomplete/);
  assert.match(master, /SHARED_CHECKPOINT_PUBLISH_PROTECTED/);
  assert.match(master, /staleRecords:guard\.stale\.slice/);

  const business = server.slice(server.indexOf("async function publishBusinessCheckpoint"), server.indexOf('let businessCheckpointTimer'));
  assert.match(business, /guardCheckpointPublish\('business'/);
  assert.match(business, /local-business-incomplete/);
  assert.match(business, /SHARED_CHECKPOINT_PUBLISH_PROTECTED/);
  assert.match(business, /staleRecords:guard\.stale\.slice/);
});


test('bootstrap exposes record counts so an empty Shared Hub cannot masquerade as a successful data restore', () => {
  const bootstrap = server.slice(server.indexOf('async function bootstrapSharedHub'), server.indexOf('// Local auth starts first.'));
  assert.match(bootstrap, /dataInventory:\{/);
  assert.match(bootstrap, /localMasterRecords:Object\.keys\(verifiedMasterRecords\)\.length/);
  assert.match(bootstrap, /remoteMasterRecords:Number\(checkpointRepair\.master\.remoteRecords\)\|\|0/);
  assert.match(bootstrap, /localBusinessRecords:Object\.keys\(verifiedBusinessRecords\)\.length/);
  assert.match(bootstrap, /remoteBusinessRecords:Number\(checkpointRepair\.business\.remoteRecords\)\|\|0/);
});
