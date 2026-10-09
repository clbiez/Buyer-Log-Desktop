'use strict';

// Canlı IAM/authority sınırı: role ve sahiplik gelen delta tarafından verilemez.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shared-owner-iam-'));
const isolation = {
  BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'),
  BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
};
const previous = Object.fromEntries(Object.keys(isolation).map(key => [key, process.env[key]]));
Object.assign(process.env, isolation);
fs.mkdirSync(isolation.BUYER_LOG_AUTH_DATA_ROOT, { recursive: true });
test.after(() => {
  fs.rmSync(root, { recursive:true, force:true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const iam = require('../server/lib/iam-core');
const sourceBuyer = 'ALİ YILMAZ';
const buyerId = crypto.createHash('sha256').update(sourceBuyer.toLocaleUpperCase('tr-TR')).digest('hex').slice(0, 20);
const seed = iam.migrateStore({ schemaVersion:8, _revision:1,
  moderator: { id:'moderator', username:'admin', displayName:'Admin', role:'moderator', systemRole:'moderator', enabled:true },
  users: [
    { id:'owner', username:'corporate-login', displayName:'Yeni Kurumsal Ad', role:'buyer', systemRole:'buyer', enabled:true,
      stableIds:{ buyerId, sourceId:`asas-buyer:${buyerId}` },
      dataScope:{ mode:'CUSTOM', buyers:[sourceBuyer] }, mags:['MAG-1'], mmygs:['MMYG-1'], buyingGroups:['BG-1'] },
    { id:'manager', username:'manager', displayName:'Manager', role:'manager', systemRole:'manager', enabled:true,
      dataScope:{ mode:'MAG' }, mags:['MAG-1'], mmygs:['MMYG-1'], buyingGroups:['BG-1'] },
    { id:'disabled', username:'disabled', displayName:'Disabled', role:'moderator', systemRole:'moderator', enabled:false, status:'INACTIVE' },
  ],
});
fs.writeFileSync(path.join(isolation.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(seed));
const access = require('../server/lib/user-access');
const runtime = access.buildUserAccess({ ensureDataLoaded:async () => {}, getOrders:() => [] });
const authoritative = [{ ocode:4100002, buyer:sourceBuyer, merch:'MAG-1', ageGroup:'MMYG-1', buyerGrup:'BG-1' }];
runtime.syncProfiles(authoritative, { authoritative:true });

function profile(id) { return runtime.profileById(id); }
function row() { return runtime.authoritativeOrderRows(4100002)[0]; }
const recordId = 'cp-order:4100002|MODEL|BLUE';

test('live IAM manager retains normal MAG editing but sharedOnly denies another owner', () => {
  const manager = profile('manager'), order = row();
  assert.equal(runtime.canEditOrder(manager, order), true);
  assert.equal(runtime.canEditOrder(manager, order, { sharedOnly:true, recordId }), false);
  assert.deepEqual(runtime.sharedOwnerOf(recordId, manager.id).ownerUserIds, ['owner']);
  assert.equal(runtime.sharedOwnerOf(recordId, manager.id).known, true);
  assert.equal(runtime.sharedOwnerOf(recordId, manager.id).allowed, false);
});

test('live stable ASAS identity authorizes renamed owner and verified Moderator', () => {
  const owner = profile('owner'), moderator = profile('moderator'), order = row();
  assert.notEqual(owner.username, sourceBuyer); assert.notEqual(owner.displayName, sourceBuyer);
  assert.equal(runtime.sharedOwnerOf(recordId, owner.id).allowed, true);
  assert.equal(runtime.canEditOrder(owner, order, { sharedOnly:true, recordId }), true);
  const moderatorDecision = runtime.sharedOwnerOf(recordId, moderator.id);
  assert.equal(moderatorDecision.allowed, true); assert.equal(moderatorDecision.moderator, true);
  assert.equal(runtime.canEditOrder(moderator, order, { sharedOnly:true, recordId }), true);
});

test('incoming event cannot spoof Moderator role or bypass owner by using an unregistered/disabled actor', () => {
  const spoof = { id:recordId, userId:'manager', systemRole:'moderator', role:'moderator', patch:{ suppFob:99 } };
  const decision = runtime.sharedOwnerOf(spoof.id, spoof.userId, spoof);
  assert.equal(decision.allowed, false); assert.equal(decision.moderator, undefined);
  for (const userId of ['unknown-profile', 'disabled']) {
    const result = runtime.sharedOwnerOf(recordId, userId, { systemRole:'moderator' });
    assert.equal(result.allowed, false); assert.equal(result.known, true); assert.equal(result.moderator, undefined);
  }
});

test('unknown order and missing sender preserve legacy decisions without broadening normal edit permissions', () => {
  const manager = profile('manager'), order = row();
  for (const result of [runtime.sharedOwnerOf('cp-order:9999999|MODEL|BLUE', manager.id), runtime.sharedOwnerOf(recordId, null)]) {
    assert.equal(result.allowed, true); assert.equal(result.known, false);
  }
  assert.equal(runtime.canEditOrder(manager, order, { sharedOnly:true, recordId:'cp-order:9999999|MODEL|BLUE' }), runtime.canEditOrder(manager, order));
});

test('unverified user refresh cannot replace the Moderators authoritative ownership snapshot', () => {
  runtime.syncProfiles([{ ...authoritative[0], buyer:'Manager' }], { authoritative:false });
  assert.equal(row().buyer, sourceBuyer);
  assert.equal(runtime.sharedOwnerOf(recordId, 'manager').allowed, false);
  assert.equal(runtime.sharedOwnerOf(recordId, 'owner').allowed, true);
});

test('empty verified authority snapshot keeps legacy sharedOnly scope behavior', () => {
  const manager = profile('manager'), prior = row();
  runtime.syncProfiles([], { authoritative:true });
  const decision = runtime.sharedOwnerOf(recordId, manager.id);
  assert.equal(decision.allowed, true); assert.equal(decision.known, false);
  assert.equal(runtime.canEditOrder(manager, prior, { sharedOnly:true, recordId }), runtime.canEditOrder(manager, prior));
});
