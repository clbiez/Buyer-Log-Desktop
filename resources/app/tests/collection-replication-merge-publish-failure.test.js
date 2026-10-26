'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createCollectionReplication}=require('../server/lib/collection-replication');
test('live poll preserves a pending merged publication when the exact remote head returns after I/O failure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-merge-publish-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const initial={ownerId:'owner',_revision:1,initialized:true,rows:[{id:1,_rev:1,modelKod:'initial',not:''}],manufacturers:[],customColumns:[],nextId:2};
 let local=structuredClone(initial),peer=structuredClone(initial),arm=false,target,backup;
 const seen=[];
 const a=createCollectionReplication({workspaces:{loadWorkspace:()=>local,replaceWorkspaceReplica:async(_owner,incoming)=>{local=structuredClone(incoming);if(arm){arm=false;await fs.rename(target,backup);await fs.mkdir(target);}return{applied:true,workspace:local}}},permissions:{accessLevel:()=> 'edit'},getSharedSyncRoot:async()=>root,stateFile:path.join(root,'a/state.json'),onApplied:r=>seen.push(r)});
 const b=createCollectionReplication({workspaces:{loadWorkspace:()=>peer,replaceWorkspaceReplica:async()=>({applied:false})},permissions:{accessLevel:()=> 'edit'},getSharedSyncRoot:async()=>root,stateFile:path.join(root,'b/state.json')});
 await a.publishOwner('owner');await a.pollOwners('owner',['owner']);await b.syncOwner('owner','owner');
 peer={...peer,_revision:2,rows:[{...peer.rows[0],_rev:2,not:'peer-note'}]};await b.publishOwner('owner');
 local={...local,_revision:3,rows:[{...local.rows[0],_rev:3,modelKod:'accepted-local'}]};target=a.remoteWorkspaceFile(root,'owner');backup=target+'.backup';arm=true;
 await a.pollOwners('owner',['owner']);
 assert.equal(local.rows[0].modelKod,'accepted-local');assert.equal(local.rows[0].not,'peer-note');
 assert.equal((await a.status('owner')).state,'error');
 // Restoring the original file restores its exact mtime/size, like a short outage.
 await fs.rmdir(target);await fs.rename(backup,target);
 await a.pollOwners('owner',['owner']);
 const final=JSON.parse(await fs.readFile(target,'utf8')).workspace;
 assert.equal(final.rows[0].modelKod,'accepted-local');assert.equal(final.rows[0].not,'peer-note');
 assert.equal((await a.status('owner')).ok,true);
 const failed=seen.find(r=>r.reason==='EISDIR');assert.equal(failed?.state,'error','real merge publication failure must reach save feedback as sharing pending');assert.equal(failed.ok,false);
});
