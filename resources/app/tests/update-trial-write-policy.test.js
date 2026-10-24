'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const express=require('express'),fixture=require('./helpers/manual-patch-v3-fixture.cjs');
const {createLauncherState}=require('../electron/update/launcher-state'),{createTrialWritePolicy}=require('../electron/update/trial-backend');
const {createLocalDb}=require('../server/lib/local-db'),{createSyncSettings}=require('../server/lib/sync-settings');
async function setup(t){
 const f=fixture(t);fs.unlinkSync(f.db);const db=createLocalDb(f.db);await db.ensure();await db.queuePatch({id:'before',patch:{value:'acknowledged before trial'}});await db.transaction(s=>{s.migrations.baseline=true;});
 const p=f.build();f.manager().apply(p.manifest,p.archiveFile);const life=createLauncherState({bootstrapCore:f.base,portableRoot:f.portable}),trial=life.activatePending();
 const env={BUYER_LOG_UPDATE_HEALTH_TOKEN:trial.activation.token,BUYER_LOG_LOCAL_DATA_ROOT:path.dirname(f.db),BUYER_LOG_ACTIVE_VERSION:'7.0.294',BUYER_LOG_ACTIVE_APP_CORE:life.currentPointer().appCoreRoot};
 return {...f,localDb:db,life,trial,env,policy:createTrialWritePolicy({env})};
}
async function server(t,f){
 const app=express();app.use(f.policy.middleware);app.use(express.json());
 app.post('/api/business/patch',async(req,res)=>{await f.localDb.queuePatch({id:'during',patch:{value:'acknowledged after health'}});res.json({ok:true});});
 app.post('/api/user-login',(_req,res)=>res.json({ok:true}));app.get('/api/read',(_req,res)=>res.json({ok:true}));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 return route=>fetch(base+route,{method:route==='/api/read'?'GET':'POST',headers:{'Content-Type':'application/json'},...(route==='/api/read'?{}:{body:'{}'})});
}
test('unconfirmed trial HTTP writes are never acknowledged; reads and login can establish native readiness',async t=>{
 const f=await setup(t),call=await server(t,f),before=fs.readFileSync(f.db);
 const denied=await call('/api/business/patch');assert.equal(denied.status,503);assert.equal((await denied.json()).code,'UPDATE_TRIAL_VERIFYING');assert.deepEqual(fs.readFileSync(f.db),before);
 assert.equal((await call('/API/BUSINESS/PATCH')).status,503,'Express default case-insensitive routing must not bypass the fence');
 assert.equal((await call('/api/read')).status,200);assert.equal((await call('/api/user-login')).status,200);
 f.life.requestRollback(f.trial.activation,'synthetic failure');f.life.rollbackExistingTrial();
 assert.equal(f.policy.isConfirmed(),false);assert.equal((await createLocalDb(f.db).read()).records.during,undefined);
});
test('only exact durable health confirmation releases writes and later acknowledged data cannot roll back',async t=>{
 const f=await setup(t),call=await server(t,f);
 assert.equal(f.life.confirmHealth('wrong-token',{version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true}),false);assert.equal(f.policy.isConfirmed(),false);
 assert.equal(f.life.confirmHealth(f.trial.activation.token,{version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true}),true);
 assert.equal((await call('/api/business/patch')).status,200);assert.equal(f.life.rollbackExistingTrial(),null);
 assert.equal((await createLocalDb(f.db).read()).records.during.value,'acknowledged after health');
});
test('sync waits without touching shared transport; peer changes arriving during a failed trial remain recoverable',async t=>{
 const f=await setup(t),hub=path.join(f.root,'hub'),peerRoot=path.join(f.root,'peer');fs.mkdirSync(hub);fs.mkdirSync(peerRoot);
 const peer=createLocalDb(path.join(peerRoot,'BuyerLogLocal.db'));await peer.queuePatch({id:'peer',patch:{value:'acknowledged peer change'}});
 const peerSync=createSyncSettings({localDataRoot:peerRoot,localDb:peer}),events=[];
 const sync=createSyncSettings({localDataRoot:path.dirname(f.db),localDb:f.localDb,allowSync:f.policy.isConfirmed,trace:(event)=>events.push(event)});
 await peerSync.save(hub);await sync.save(hub);assert.equal((await peerSync.syncOnce()).online,true);
 const paused=await sync.syncOnce();assert.equal(paused.paused,true);assert.equal(events.includes('NETWORK_FIRST_ACCESS'),false);assert.equal((await f.localDb.read()).records.peer,undefined);
 f.life.requestRollback(f.trial.activation,'synthetic failure');f.life.rollbackExistingTrial();
 const recoveredDb=createLocalDb(f.db),recovered=createSyncSettings({localDataRoot:path.dirname(f.db),localDb:recoveredDb,allowSync:createTrialWritePolicy({env:{}}).isConfirmed});
 assert.equal((await recovered.syncOnce()).online,true);assert.equal((await recoveredDb.read()).records.peer.value,'acknowledged peer change');
 assert.equal((await recoveredDb.read()).records.before.value,'acknowledged before trial');
});
test('missing/corrupt/wrong-core completion state never releases an unconfirmed trial',async t=>{
 const f=await setup(t);assert.equal(f.policy.isConfirmed(),false);
 for(const value of ['{',JSON.stringify({schemaVersion:1,activation:null,lastConfirmedTrial:{token:f.env.BUYER_LOG_UPDATE_HEALTH_TOKEN,version:'7.0.294',appCoreRoot:f.base}})]){
  fs.writeFileSync(f.stateFile,value);assert.equal(createTrialWritePolicy({env:f.env}).isConfirmed(),false);
 }
 fs.unlinkSync(f.stateFile);assert.equal(createTrialWritePolicy({env:f.env}).isConfirmed(),false);
});

test('a Collection GET serves its local revision without publishing it until exact trial health confirmation',async t=>{
 const f=await setup(t),{createCollectionReplication}=require('../server/lib/collection-replication'),hub=path.join(f.root,'collection-hub'),stateFile=path.join(f.root,'replica-state.json');
 let workspace={schemaVersion:1,ownerId:'owner',initialized:true,_revision:1,rows:[{id:1,_rev:1,note:'baseline'}],manufacturers:[],customColumns:[],nextId:2};
 const options={workspaces:{loadWorkspace:()=>structuredClone(workspace),replaceWorkspaceReplica:async()=>{throw Error('Local-newer fixture must not replace the workspace');}},permissions:{accessLevel:()=> 'edit'},getSharedSyncRoot:async()=>hub,stateFile};
 const baseline=createCollectionReplication({...options,trialPolicy:createTrialWritePolicy({env:{}})});assert.equal((await baseline.publishOwner('owner')).published,true);
 const remote=baseline.remoteWorkspaceFile(hub,'owner'),before=fs.readFileSync(remote);
 workspace={...workspace,_revision:2,rows:[{id:1,_rev:2,note:'acknowledged local revision'}]};
 const held=createCollectionReplication({...options,trialPolicy:f.policy}),app=express();app.use(f.policy.middleware);
 app.get('/api/collection-workspaces/owner',async(_req,res)=>{await held.syncOwner('owner','owner');res.json(workspace);});
 const listener=http.createServer(app);await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>listener.close(resolve)));
 const url='http://127.0.0.1:'+listener.address().port+'/api/collection-workspaces/owner';
 assert.equal((await (await fetch(url)).json())._revision,2);assert.deepEqual(fs.readFileSync(remote),before);
 await assert.rejects(held.publishOwner('owner'),{code:'UPDATE_TRIAL_VERIFYING'});
 f.life.confirmHealth(f.trial.activation.token,{version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true});
 assert.equal((await fetch(url)).status,200);assert.equal(JSON.parse(fs.readFileSync(remote,'utf8')).workspace._revision,2);
});

test('trial startup cannot publish ACL migration or consume a previously acknowledged license outbox',async t=>{
 const f=await setup(t),{createCollectionPermissionsStore}=require('../server/lib/collection-permissions-store'),{createLicenseCardSync}=require('../server/lib/license-card-sync');
 const profiles=[{id:'owner',enabled:true},{id:'viewer',enabled:true,collectionAccess:[{ownerId:'owner',level:'view'}]}],hub=path.join(f.root,'acl-hub');
 const acl=createCollectionPermissionsStore({file:path.join(f.root,'acl-cache.json'),getProfiles:()=>profiles,getSharedSyncRoot:async()=>hub,trialPolicy:f.policy});
 await assert.rejects(acl.migrateLegacyInboundAccess(profiles),{code:'UPDATE_TRIAL_VERIFYING'});assert.equal(fs.existsSync(hub),false);
 let mirrorCalls=0,overrides={_revision:1,licenseCardOutbox:{card:{actorId:'owner',fields:{profile:{id:'card',license:'Synthetic'}}}}};const original=JSON.stringify(overrides);
 const outbox=createLicenseCardSync({deltaStore:{mirror:async()=>{mirrorCalls++;return {ok:true};}},loadOverrides:()=>overrides,saveOverrides:value=>overrides=value,trialPolicy:f.policy});
 assert.equal((await outbox.flushOutbox()).paused,true);assert.equal(mirrorCalls,0);assert.equal(JSON.stringify(overrides),original);
 await assert.rejects(outbox.publish({currentUser:{id:'owner'}},{}),{code:'UPDATE_TRIAL_VERIFYING'});assert.equal(JSON.stringify(overrides),original);
 f.life.confirmHealth(f.trial.activation.token,{version:'7.0.294',backendReady:true,rendererReady:true,localDbReady:true});
 assert.equal((await acl.migrateLegacyInboundAccess(profiles)).created,1);assert.equal(fs.existsSync(hub),true);
 assert.equal((await outbox.flushOutbox()).ok,true);assert.equal(mirrorCalls,1);assert.deepEqual(overrides.licenseCardOutbox,{});
});
