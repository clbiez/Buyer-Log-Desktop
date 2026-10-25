'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-local-credentials-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');process.env.BUYER_LOG_CENTRAL_IAM_ENABLED='0';
const access=require('../server/lib/user-access'),runtime=access.buildUserAccess({ensureDataLoaded:async()=>{},getOrders:()=>[]});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const request=(body={},cookie='')=>({body,headers:{cookie},socket:{remoteAddress:'127.0.0.1'}});
const response=()=>({statusCode:200,body:null,cookie:'',status(n){this.statusCode=n;return this;},append(name,value){if(name==='Set-Cookie')this.cookie=value.split(';')[0];return this;},json(body){this.body=body;return this;}});
async function login(username,password){const res=response();await runtime.loginHandler(request({username,password}),res);assert.equal(res.statusCode,200,JSON.stringify(res.body));return res.cookie;}
function initialize(){const store=access.loadStore(),hash=access.hashPin('Original-admin-123');store.moderator.username='admin';store.moderator.passwordHash=store.moderator.pinHash=hash;store.users=[{id:'buyer',username:'buyer',displayName:'Synthetic Buyer',title:'Buyer',role:'buyer',systemRole:'buyer',orgLevel:'job_title',managerId:'moderator',enabled:true,status:'ACTIVE',passwordHash:access.hashPin('Buyer-original-123')}];access.saveStore(store,store._revision);}

test('local password reset invalidates the old authenticated cookie while keeping the account active',async()=>{
 initialize();const old=await login('admin','Original-admin-123'),before=runtime.sessionProfile(request({},old)),store=access.loadStore(),res=response();
 runtime.adminUpdateHandler({...request({expectedRevision:store._revision,password:'New-admin-456',reason:'Synthetic local credential test',confirmCritical:true},old),currentUser:before,params:{id:'moderator'}},res);
 assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(runtime.profileById('moderator').enabled,true);assert.equal(runtime.sessionProfile(request({},old)),null);
 const current=await login('admin','New-admin-456');assert.equal(runtime.sessionProfile(request({},current)).credentialRevision,before.credentialRevision+1);
});

test('local unrelated profile updates retain sessions and cannot reduce credential generations',async()=>{
 const cookie=await login('admin','New-admin-456'),before=runtime.sessionProfile(request({},cookie)),store=access.loadStore();store.moderator.title='Updated synthetic title';store.moderator.credentialRevision=1;
 access.saveStore(store,store._revision);const current=runtime.sessionProfile(request({},cookie));assert.ok(current);assert.equal(current.credentialRevision,before.credentialRevision);
});

test('restoring an earlier password still advances its generation and leaves other users authenticated',async()=>{
 const old=await login('admin','New-admin-456'),other=await login('buyer','Buyer-original-123'),before=runtime.profileById('moderator').credentialRevision,otherBefore=runtime.sessionProfile(request({},other)).credentialRevision,store=access.loadStore();
 store.moderator.passwordHash=store.moderator.pinHash=access.hashPin('Original-admin-123');store.moderator.credentialRevision=1;access.saveStore(store,store._revision);
 assert.equal(runtime.sessionProfile(request({},old)),null);assert.equal(runtime.profileById('moderator').credentialRevision,before+1);assert.equal(runtime.sessionProfile(request({},other)).credentialRevision,otherBefore);assert.ok(await login('admin','Original-admin-123'));
});

test('actual backup restore ignores imported credential generations and cannot revive an old cookie',async()=>{
 const old=await login('admin','Original-admin-123'),oldGeneration=runtime.profileById('moderator').credentialRevision,store=access.loadStore();store.moderator.passwordHash=store.moderator.pinHash=access.hashPin('Backup-current-789');access.saveStore(store,store._revision);
 assert.equal(runtime.sessionProfile(request({},old)),null);const current=await login('admin','Backup-current-789'),generation=runtime.profileById('moderator').credentialRevision,snapshot=access.backupSafeStore();
 snapshot.moderator.credentialRevision=oldGeneration;snapshot.moderator.passwordHash='Untrusted imported hash';snapshot.users.push({id:'imported',username:'imported',displayName:'Synthetic imported user',title:'Buyer',role:'buyer',systemRole:'buyer',enabled:true,status:'ACTIVE',credentialRevision:999});
 const result=runtime.restoreBackupSnapshot(snapshot);assert.equal(result.applied,true);assert.equal(runtime.profileById('moderator').credentialRevision,generation);assert.equal(runtime.sessionProfile(request({},old)),null);assert.ok(runtime.sessionProfile(request({},current)));assert.equal(runtime.profileById('imported').credentialRevision,1);assert.equal(runtime.profileById('imported').passwordHash,'');
});
