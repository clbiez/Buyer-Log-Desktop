'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-agent-worker-'));
const env=Object.fromEntries(['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'].map(key=>[key,root]));
Object.assign(process.env,env);
const access=require('../server/lib/user-access').buildUserAccess({ensureDataLoaded:()=>{},getOrders:()=>[],centralIam:{enabled:false}}),workspace=require('../server/lib/collection-workspaces'),worker=require('../server/lib/collection-save-worker-client');
const permissions=require('../server/lib/collection-permissions-store').createCollectionPermissionsStore({file:path.join(root,'collection-permissions.json')});
access.setCollectionAccessResolver(profile=>permissions.isReady()?permissions.effectiveOwners(profile.id):null);
const {assertCollectionAccess}=require('../server/lib/agent-collection-authority');
test.after(async()=>{await worker.shutdown();fs.rmSync(root,{recursive:true,force:true});});
const actor=()=>access.profileById('moderator'),authorization=()=>({actorId:'moderator',stamp:JSON.stringify(access.publicProfile(actor())),centralIamEnabled:false});
function run(ownerId,row,revision,extra={}){return worker.runCollectionSave({ownerId,mode:'rows',env,body:Buffer.from(JSON.stringify({upserts:[row],atomic:true})),expectedRevision:revision,authorization:{...authorization(),...extra}});}
test('real persistent worker saves with current IAM, rejects a later source revision and preserves the existing normal path',async()=>{
 const current=workspace.saveWorkspace('moderator',{rows:[{id:1,modelKod:'BEFORE'}]},0);
 const saved=await run('moderator',{...current.rows[0],modelKod:'AFTER'},current._revision);assert.equal(saved.revision,current._revision+1);assert.equal(workspace.loadWorkspace('moderator').rows[0].modelKod,'AFTER');
 await assert.rejects(run('moderator',{...current.rows[0],modelKod:'STALE'},current._revision),{code:'REVISION_CONFLICT'});
 const actual=workspace.loadWorkspace('moderator');await worker.runCollectionSave({ownerId:'moderator',mode:'rows',env,body:Buffer.from(JSON.stringify({upserts:[{...actual.rows[0],modelKod:'NORMAL'}],atomic:true}))});assert.equal(workspace.loadWorkspace('moderator').rows[0].modelKod,'NORMAL');
});
test('a quotation editor without a Collection grant cannot read or preview another owner',()=>{
 assert.equal(access.collectionAccessLevel(actor(),'other'),null);assert.throws(()=>assertCollectionAccess(access,actor(),'other'),{code:'OFFICE_TOOL_FORBIDDEN'});assert.throws(()=>assertCollectionAccess(access,actor(),'other',true),{code:'OFFICE_TOOL_FORBIDDEN'});
});
test('grant revoked while the worker waits for the real workspace lease prevents all writes',async()=>{
 const file=path.join(root,'collection-permissions.json'),writeGrant=grants=>fs.writeFileSync(file,JSON.stringify({revision:1,grants,migrations:{legacyInboundAccessV1:true}}));
 writeGrant([{ownerId:'other',granteeId:'moderator',level:'edit'}]);const current=workspace.saveWorkspace('other',{rows:[{id:1,modelKod:'SAFE'}]},0);assert.equal(access.collectionAccessLevel(actor(),'other'),'edit');
 let pending;await require('../server/lib/shared-file-transaction').withFileLeaseAsync(workspace.workspaceFile('other'),async()=>{pending=run('other',{...current.rows[0],modelKod:'FORBIDDEN'},current._revision);pending.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,60));writeGrant([]);});
 await assert.rejects(pending,error=>['COLLECTION_EDIT_DENIED','OFFICE_TOOL_FORBIDDEN'].includes(error.code));assert.equal(workspace.loadWorkspace('other').rows[0].modelKod,'SAFE');
});
test('delta-only quotation and Collection documents are the actual worker source and survive readback',async()=>{
 const delta=require('../server/lib/delta-store').createDeltaStore({localDb:require('../server/lib/local-db').createLocalDb(require('../server/user-data').LOCAL_DB_FILE),mode:'delta-only'}),docs=require('../server/lib/delta-store').createDocumentApi(delta);
 await delta.hydrate();assert.equal((await docs.mirror('quotations.json',{requests:[],_revision:7})).ok,true);
 const current=workspace.loadWorkspace('moderator');const authoritative={...current,_revision:current._revision+5,rows:[{...current.rows[0],modelKod:'DELTA'}]};assert.equal((await docs.mirror(workspace.documentId('moderator'),authoritative)).ok,true);
 const saved=await run('moderator',{...authoritative.rows[0],modelKod:'DELTA SAVED'},authoritative._revision,{deltaStoreMode:'delta-only',quotationRevision:7});assert.equal(saved.revision,authoritative._revision+1);await delta.hydrate();assert.equal(docs.read(workspace.documentId('moderator')).rows[0].modelKod,'DELTA SAVED');
 await assert.rejects(run('moderator',{...authoritative.rows[0],modelKod:'STALE SOURCE'},saved.revision,{deltaStoreMode:'delta-only',quotationRevision:6}),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(workspace.loadWorkspace('moderator').rows[0].modelKod,'DELTA SAVED');
});

test('persistent native worker configuration rollover preserves the new worker tasks and their actual receipts',async()=>{
 const alternate={...env};delete alternate.BUYER_LOG_AUTH_DATA_ROOT;
 for(const [index,selectedEnv]of [alternate,env,alternate].entries()){const before=workspace.loadWorkspace('moderator'),rows=[{...(before.rows[0]||{id:1}),modelKod:'NATIVE ENV '+index}];const saved=await worker.runCollectionSave({ownerId:'moderator',mode:'rows',env:selectedEnv,body:Buffer.from(JSON.stringify({upserts:rows,atomic:true})),expectedRevision:before._revision,authorization:authorization()});assert.equal(saved.revision,before._revision+1);assert.equal(workspace.loadWorkspace('moderator').rows[0].modelKod,'NATIVE ENV '+index);}
});

test('actual worker journal append rejects revoked grants and preserves actual peer edits before legacy projection',async()=>{
 const {Worker}=require('node:worker_threads'),{createLocalDb}=require('../server/lib/local-db'),{createDeltaStore,createDocumentApi,toDocumentRecord}=require('../server/lib/delta-store'),localFile=require('../server/user-data').LOCAL_DB_FILE;
 for(const mode of ['delta','delta-only'])for(const kind of ['source','iam','refresh']){const owner='journal-'+mode+'-'+kind,grantFile=path.join(root,'collection-permissions.json');require('../server/user-data').atomicWriteJson(grantFile,{revision:10,grants:[{ownerId:owner,granteeId:'moderator',level:'edit'}],migrations:{legacyInboundAccessV1:true}});
 const before=workspace.saveWorkspace(owner,{rows:[{id:1,modelKod:'SAFE',peerNote:'INITIAL'}]},0),legacyBefore=fs.readFileSync(workspace.workspaceFile(owner)),delta=createDeltaStore({localDb:createLocalDb(localFile),mode});await delta.hydrate();assert.equal((await createDocumentApi(delta).mirror(workspace.documentId(owner),before)).ok,true);
 const journalBefore=createDocumentApi(delta).read(workspace.documentId(owner)),peer={...journalBefore,rows:before.rows.map(row=>({...row,peerNote:'ACTUAL NATIVE PEER',_rev:workspace.rowRev(row)+1})),_revision:before._revision+1},thread=new Worker(path.join(__dirname,'helpers/collection-worker-journal-race.js'),{workerData:{env,target:'store:'+workspace.documentId(owner),documentId:workspace.documentId(owner),peerNative:peer,refreshRace:kind==='refresh',...(kind==='iam'?{grantFile}:{peerPatch:toDocumentRecord(peer)})}});
 try{const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native worker timed out')),10000);thread.on('error',error=>{clearTimeout(timer);reject(error);});thread.on('message',message=>{if(message.ready){thread.postMessage({id:1,ownerId:owner,mode:'rows',expectedRevision:before._revision,authorization:{...authorization(),deltaStoreMode:mode},body:Buffer.from(JSON.stringify({upserts:[{...before.rows[0],modelKod:'STALE APPROVAL'}],atomic:true}))});return;}clearTimeout(timer);resolve(message);});});assert.equal(response.ok,false);assert.ok(['OFFICE_PREVIEW_CHANGED','COLLECTION_EDIT_DENIED','OFFICE_TOOL_FORBIDDEN'].includes(response.code));const reader=createDeltaStore({localDb:createLocalDb(localFile),mode});await reader.hydrate();const actual=createDocumentApi(reader).read(workspace.documentId(owner));if(kind==='iam')assert.deepEqual(actual,journalBefore);else assert.deepEqual(actual,peer);assert.deepEqual(fs.readFileSync(workspace.workspaceFile(owner)),legacyBefore);}finally{await thread.terminate();}}
});
