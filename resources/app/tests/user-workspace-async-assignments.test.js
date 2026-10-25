'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-workspace-assignments-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');process.env.BUYER_LOG_CENTRAL_IAM_ENABLED='0';
const access=require('../server/lib/user-access'),prefs=require('../server/lib/user-preferences'),{withFileLeaseAsync}=require('../server/lib/shared-file-transaction');
const runtime=access.buildUserAccess({ensureDataLoaded:async()=>{},getOrders:()=>[]}),owner='moderator',key=prefs.horizonKey('cp'),target=path.join(root,'user-preferences',owner+'.json');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function assign(stamp,value){const store=access.loadStore();store.iam.workspaceTemplates={...store.iam.workspaceTemplates,userDefaults:[{userId:owner,assignedAt:stamp,assignedBy:owner,sourceName:'Synthetic assignment',entries:{[key]:{value:JSON.stringify({groups:[value]}),updatedAt:stamp}}}]};access.saveStore(store,store._revision);}
async function hold(){let enter,release;const ready=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;}),done=withFileLeaseAsync(target,async()=>{enter();await gate;});await ready;return {done,release};}

test('async assigned-default migration rechecks authority, retries after denial and retains tombstones',async()=>{
 access.loadStore();await prefs.mergeAsync(owner,{[key]:{value:'{"groups":["old"]}',updatedAt:'2020-01-01T00:00:00.000Z'}});assign('2026-10-24T10:00:00.000Z','assigned');
 const before=await fsp.readFile(target),held=await hold();let allowed=true;
 const pending=runtime.roleWorkspaceEntriesAsync(owner,{assertAuthority:()=>{if(!allowed)throw Object.assign(Error('Denied'),{code:'DENIED'});}}),denied=assert.rejects(pending,{code:'DENIED'});
 allowed=false;held.release();await held.done;await denied;assert.deepEqual(await fsp.readFile(target),before);
 const inherited=await runtime.roleWorkspaceEntriesAsync(owner),current=await prefs.loadAsync(owner);assert.deepEqual(JSON.parse(inherited[key].value).groups,['assigned']);assert.equal(current.entries[key],undefined);assert.ok(current.deletions[key]);assert.equal(current._horizonRevisions[key],2);
});

test('async assigned defaults retain a newer personal decision',async()=>{
 await prefs.mergeAsync(owner,{[key]:{value:'{"groups":["personal"]}',updatedAt:'2099-01-01T00:00:00.000Z'}});assign('2026-10-24T11:00:00.000Z','assigned-again');
 const inherited=await runtime.roleWorkspaceEntriesAsync(owner),current=await prefs.loadAsync(owner);assert.deepEqual(prefs.workspaceSnapshot(current,'cp',inherited).horizon.groups,['personal']);
});

test('an assignment changed while preference migration waits returns the current assigned default',async()=>{
 assign('2026-10-24T12:00:00.000Z','first');const held=await hold(),pending=runtime.roleWorkspaceEntriesAsync(owner);
 assign('2026-10-24T13:00:00.000Z','latest');held.release();await held.done;const inherited=await pending;assert.deepEqual(JSON.parse(inherited[key].value).groups,['latest']);
});
