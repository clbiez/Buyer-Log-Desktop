'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-audit-null-'));
// All roots are synthetic, including legacy/auth migration candidates.
Object.assign(process.env,{
  BUYER_LOG_CENTRAL_IAM_ENABLED:'0',
  BUYER_LOG_AUTH_DATA_ROOT:root,BUYER_LOG_SERVER_DATA_ROOT:root,
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp'),
});
const ua=require('../server/lib/user-access');
const profile={id:'moderator',role:'moderator',systemRole:'moderator',displayName:'Synthetic moderator'};
const orderAccess=Object.fromEntries(Array.from({length:30000},(_,i)=>['DEMO-'+i,{ownerId:'demo-buyer',canEdit:true}]));
const store=ua.loadStore();store.orderAccess=orderAccess;
store.moderator.passwordHash='synthetic-password-hash';
store.nested={token:'synthetic-token',safe:'preserved',children:[{pinHash:'synthetic-pin',value:7}]};
ua.saveStore(store,store._revision);
const access=ua.buildUserAccess({});
const file=path.join(root,'user-audit.jsonl');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

test('detail-free LOGIN, LOGOUT and PASSWORD_SETUP append small null details without orderAccess',()=>{
  for(const action of ['LOGIN','LOGOUT','PASSWORD_SETUP']){
    assert.equal(access.appendAudit(profile,action,'session'),true);
    const line=fs.readFileSync(file,'utf8').trim().split('\n').at(-1),record=JSON.parse(line);
    assert.equal(record.details===null,true,action+' details must be null');
    assert.equal(record.action,action);assert.equal(record.actorId,profile.id);
    assert.equal(line.includes('orderAccess'),false,action);
    assert.ok(Buffer.byteLength(line)<1024,action+' audit line should be under 1 KiB');
  }
});

test('explicit null details and nested details preserve redaction semantics',()=>{
  access.appendAudit(profile,'NULL','session',null);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8').trim().split('\n').at(-1)).details,null);
  const details={reason:'synthetic',oldValue:{passwordHash:'removed',token:'removed',amount:4},newValue:{amount:7},nested:[{cookie:'removed',value:8}]};
  access.appendAudit(profile,'UPDATE','session',details);
  const record=JSON.parse(fs.readFileSync(file,'utf8').trim().split('\n').at(-1));
  assert.deepEqual(record.details,{reason:'synthetic',oldValue:{amount:4},newValue:{amount:7},nested:[{value:8}]});
  assert.deepEqual(record.oldValue,{amount:4});assert.deepEqual(record.newValue,{amount:7});
  assert.equal(details.oldValue.passwordHash,'removed','caller input is not mutated');
});

test('no-argument backupSafeStore and backupSnapshot still return the sanitized complete store',()=>{
  for(const backup of [ua.backupSafeStore(),access.backupSnapshot()]){
    assert.deepEqual(backup.orderAccess,orderAccess);
    assert.equal(backup.moderator.passwordHash,undefined);
    assert.deepEqual(backup.nested,{safe:'preserved',children:[{value:7}]});
  }
  assert.equal(ua.readStore().moderator.passwordHash,'synthetic-password-hash');
});

test('append preserves existing audit lines and historical archive bytes',()=>{
  const archive=path.join(root,'user-audit.20260101T000000Z.jsonl'),historical='{"id":"synthetic-historical","details":{"orderAccess":{"legacy":true}}}\n';
  fs.writeFileSync(archive,historical);
  const before=fs.readFileSync(file),archiveBefore=fs.readFileSync(archive);
  access.appendAudit(profile,'LOGIN','session');
  assert.deepEqual(fs.readFileSync(file).subarray(0,before.length),before);
  assert.deepEqual(fs.readFileSync(archive),archiveBefore);
});
