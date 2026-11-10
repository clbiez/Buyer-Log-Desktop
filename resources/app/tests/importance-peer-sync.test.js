'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const policy = require('../server/lib/shared-sync-policy');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { createOwnershipResolver } = require('../server/lib/cp-field-ownership');
const OI = require('../public/order-importance');
const ID = 'cp-order:1001|DEMO MODEL|BLUE';
const resolve = createOwnershipResolver({ 1001:[{ buyer:'Demo Owner' }] }, [{ id:'owner', username:'Demo Owner' }, { id:'other', username:'Other' }]);
const ownerOf = (recordId, userId) => resolve({ recordId, userId });

async function devices(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'importance-sync-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:50 }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared);
  const result = [];
  for (const name of ['a','b']) {
    const file = path.join(root, name, 'BuyerLogLocal.db');
    const db = createLocalDb(file);
    db.setSharedOwnerResolver(ownerOf);
    db.setTransportFilter(delta => policy.filterDeltas([delta]).length === 1);
    const sync = createSyncSettings({ localDataRoot:path.join(root,name,'settings'), localDb:db,
      filterIncomingDeltas:d => policy.filterDeltas(d, 'incoming'), filterOutgoingDeltas:d => policy.filterDeltas(d, 'outgoing') });
    await sync.save(shared);
    result.push({ db,sync,file });
  }
  return result;
}
async function exchange(a,b) {
  for (const device of [a,b,a,b]) {
    const result = await device.sync.syncOnce();
    assert.equal(result.online, true, result.lastError || 'folder transport stays online');
  }
}

test('Importance survives both delta directions, Regular and null without sharing private fields', () => {
  for (const direction of ['incoming','outgoing']) for (const importance of ['bts','regular',null]) {
    const delta = { id:ID, patch:{ importance, notes:{ Notes:'private' }, delivery:'Gemi', shortage:true } };
    assert.deepEqual(policy.sanitizeDelta(delta,direction).patch, { importance });
    assert.equal(delta.patch.notes.Notes, 'private', 'input is not mutated');
  }
  assert.equal(policy.sanitizeDelta({id:ID,delete:true}), null);
  assert.equal(policy.conflictInPeerScope({id:ID,type:'field',field:'importance'}), true);
  assert.ok(policy.MASTER_OVERRIDE_FIELDS.has('importanceSettings'), 'catalog remains moderator master data');
});

test('business checkpoints preserve Importance and field clocks, repair keeps private notes', () => {
  const record = { importance:'bts', notes:{Notes:'private'}, _revision:3,
    _fieldRevisions:{ importance:3, notes:2 }, _fieldWriters:{ importance:{d:'a',s:3}, notes:{d:'a',s:2} } };
  for (const scoped of [policy.businessRecordsFromState({records:{[ID]:record}}), policy.scopeCheckpointRecords('business',{[ID]:record})]) {
    assert.equal(scoped[ID].importance, 'bts');
    assert.deepEqual(scoped[ID]._fieldRevisions, {importance:3});
    assert.deepEqual(scoped[ID]._fieldWriters, {importance:{d:'a',s:3}});
    assert.equal(scoped[ID].notes, undefined);
    const repaired = policy.mergeCheckpointRecord({ notes:{Notes:'keep'}, _revision:1 },scoped[ID]);
    assert.equal(repaired.importance, 'bts');
    assert.deepEqual(repaired.notes, {Notes:'keep'});
  }
});

test('two real folder peers converge on assignments, reverse edits, Regular, clear and cold reload', async t => {
  const [a,b] = await devices(t);
  for (const [writer,reader,importance] of [[a,b,'bts'],[b,a,'new-year'],[a,b,'regular'],[b,a,null]]) {
    await writer.db.queuePatch({id:ID,patch:{importance},userId:'owner'});
    assert.equal(await writer.db.pendingCount(), 1);
    await exchange(writer,reader);
    for (const device of [a,b]) {
      assert.equal((await device.db.read()).records[ID].importance,importance);
      assert.equal((await createLocalDb(device.file).read()).records[ID].importance,importance);
      assert.equal((await device.db.listConflicts()).length,0);
    }
    assert.equal((await reader.sync.syncOnce()).downloadedPackages,0, 'idle does not download again');
  }
});

test('same owner concurrent Importance edits converge; foreign owner remote write is receipt-only', async t => {
  const [a,b] = await devices(t);
  await assert.rejects(a.db.queuePatch({id:ID,patch:{importance:'bts'},userId:'other'}), {code:'ORDER_SHARED_OWNER_ONLY'});
  await a.db.queuePatch({id:ID,patch:{importance:'bts'},userId:'owner'});
  await exchange(a,b);
  await a.db.queuePatch({id:ID,patch:{importance:'bayram'},userId:'owner',at:'2026-11-10T10:00:00Z'});
  await b.db.queuePatch({id:ID,patch:{importance:'new-year'},userId:'owner',at:'2026-11-10T11:00:00Z'});
  await exchange(a,b);
  const stateA = await a.db.read(), stateB = await b.db.read();
  assert.equal(stateA.records[ID].importance,stateB.records[ID].importance);
  assert.equal(stateA.conflicts.filter(c=>!c.resolved).length,0);
  assert.equal(stateB.conflicts.filter(c=>!c.resolved).length,0);
  const current=stateA.records[ID].importance;
  const result=await a.db.applyDelta({ id:ID,eventId:'foreign-importance',deviceId:'foreign-device',userId:'other',localSequence:1,revision:99,patch:{importance:'ekvator'} });
  assert.equal(result.applied,false);
  assert.equal((await a.db.read()).records[ID].importance,current);
});

test('bulk paste and bulk history cannot bypass revoked shared Importance access', () => {
  const {loadAppMainFunctions}=require('./helpers/app-main-functions');
  const row={_canEdit:true,_canEditShared:false};
  const functions=loadAppMainFunctions(['cpPasteTarget','cpBulkHistoryCurrent'],{
    window:{BLOrderImportanceUI:{pasteResolve:()=>({ok:true})}},isAreaFrozen:()=>false,
    orderLinePeerOwner:()=> 'owner',orderLinePeerRows:()=>[row],
    state:{storeRevisions:{orders:1,suppFob:1}},
  });
  assert.equal(functions.cpPasteTarget(row,{k:'Importance',type:'importance'}),null);
  assert.equal(functions.cpBulkHistoryCurrent({bulkGuard:{owner:'owner',orders:1,suppFob:1},actions:[{kind:'importance',lineKey:'1001|DEMO|BLUE'}]}),false);
});

test('Importance UI renders a shared view-only row without editing and refuses paste', () => {
  const document = { documentElement:{lang:'en'},addEventListener(){} };
  const window = { BLOrderImportance:OI,addEventListener(){} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/order-importance-ui.js'),'utf8'),{window,document});
  const row = {_id:1,'Order Code':1001,_importanceId:'bts',_importanceSource:'manual',_canEdit:true,_canEditShared:false};
  const ui=window.BLOrderImportanceUI;
  assert.match(ui.cellHtml(row,true,'cp'), /BTS/);
  assert.doesNotMatch(ui.cellHtml(row,true,'cp'), /<button/);
  assert.equal(ui.pasteAssign(row,'bayram'),false);
  assert.equal(row._importanceId,'bts');
});

test('API ownership guard includes Importance without changing other write scopes', () => {
  const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  const start=server.indexOf('function rejectSharedOwnerWrites('),end=server.indexOf('\nfunction sharedAccessRows',start);
  const context={userAccess:{sharedOwnerOf:()=>({known:true,allowed:false}),authoritativeOrderRows:()=>[],appendAudit(){}},parseLib:{orderLineKey:()=> '1001|DEMO MODEL|BLUE'}};
  vm.runInNewContext(server.slice(start,end),context);
  let status,body;
  const res={status(value){status=value;return this;},json(value){body=value;}};
  assert.equal(context.rejectSharedOwnerWrites({currentUser:{id:'other'}},res,[{orderCode:1001,patch:{model:'DEMO MODEL',ccode:'BLUE',importance:'bts'}}]),true);
  assert.equal(status,403);
  assert.equal(body.code,'ORDER_SHARED_OWNER_ONLY');
});
