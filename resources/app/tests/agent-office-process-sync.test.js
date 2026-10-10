'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {fork}=require('node:child_process');
const {hash}=require('../server/lib/agent-office-store');
const workerFile=path.join(__dirname,'fixtures','agent-office-sync-worker.js');
async function start(root,shared,device){
  const child=fork(workerFile,[root,shared,device],{stdio:['ignore','pipe','pipe','ipc']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Worker startup timeout '+logs)),15000);child.once('error',err=>{clearTimeout(timeout);reject(err);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Worker exit '+code+' '+logs));});child.on('message',m=>{if(m.type==='ready'){clearTimeout(timeout);resolve(m);}});});
  return {child,pid:ready.pid,port:ready.port,async stop(){if(child.exitCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.send({type:'stop'});await exited;},async role(owner,role){const id=Math.random().toString();await new Promise(resolve=>{const handler=m=>{if(m.id===id){child.off('message',handler);resolve();}};child.on('message',handler);child.send({type:'role',owner,role,id});});}};
}
async function request(worker,user,url,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(`http://127.0.0.1:${worker.port}/api/agent-office${url}`,{method,headers:{'x-test-user':user,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await response.text();return {status:response.status,data:response.headers.get('content-type')?.includes('ndjson')?text.trim().split('\n').map(line=>JSON.parse(line)):JSON.parse(text)};
}
async function ok(worker,user,url,body,method){const result=await request(worker,user,url,body,method);assert.ok(result.status>=200&&result.status<300,JSON.stringify(result));return result.data;}
async function files(root){let found=[];for(const entry of await fs.readdir(root,{withFileTypes:true})){const name=path.join(root,entry.name);found=found.concat(entry.isDirectory()?await files(name):[name]);}return found;}

test('two isolated Node HTTP processes verify encrypted trust, durable updates, revocation and scoped catalog copy',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-process-sync-')),shared=path.join(root,'shared');await fs.mkdir(shared);
  const rootA=path.join(root,'device-owner'),rootB=path.join(root,'device-moderator');
  let a,b;t.after(async()=>{await Promise.all([a?.stop(),b?.stop()]);await fs.rm(root,{recursive:true,force:true});});
  a=await start(rootA,shared,'device-owner');b=await start(rootB,shared,'device-moderator');assert.notEqual(a.pid,b.pid);
  const created=await ok(a,'owner','/profiles',{name:'Anonymous CP assistant',areas:['cp','orders','collection'],instructions:'Only anonymous fixture data'}),agent=created.profile;
  const learned=await ok(a,'owner',`/profiles/${agent.id}/memory`,{text:'Private durable fixture instruction',type:'instruction',approved:true,shareable:false});
  const sharedMemory=await ok(a,'owner',`/profiles/${agent.id}/memory`,{text:'Approved shareable fixture rule',type:'instruction',approved:true,shareable:true});
  const unapproved=await ok(a,'owner',`/profiles/${agent.id}/memory`,{text:'Unapproved fixture rule',type:'instruction',approved:false,shareable:true});
  const run=await ok(a,'owner','/run',{profileIds:[agent.id],task:'Anonymous persisted fixture conversation',lang:'en'});
  const result=run.find(event=>event.type==='result')?.result;assert.ok(result,'Real run route must complete');
  await ok(a,'owner','/sync',{});await ok(b,'moderator','/sync',{});
  const keyA=(await ok(b,'moderator','/sync/keys')).keys.find(k=>k.ownerId==='owner'),keyB=(await ok(a,'owner','/sync/keys')).keys.find(k=>k.ownerId==='moderator');
  assert.ok(keyA&&!keyA.trusted);assert.ok(keyB&&!keyB.trusted);
  const privateTarget=path.join(shared,'BUYER_LOG_SYNC','agent-office','v1','private',hash('owner'),keyB.keyId);
  await assert.rejects(fs.stat(privateTarget),err=>err.code==='ENOENT');
  await ok(b,'moderator','/sync',{owners:['owner']});
  assert.equal((await ok(b,'moderator','/moderation/owner')).state.archive.messages,0);
  assert.equal((await request(a,'owner','/sync/keys/trust',{keyId:keyB.keyId,fingerprint:keyB.fingerprint})).status,409);
  assert.equal((await request(a,'owner','/sync/keys/trust',{keyId:keyB.keyId,fingerprint:'0'.repeat(64),confirmed:true})).status,403);
  await ok(a,'owner','/sync/keys/trust',{keyId:keyB.keyId,fingerprint:keyB.fingerprint,confirmed:true});
  await ok(a,'owner','/sync',{});
  const waiting=await ok(b,'moderator','/sync',{owners:['owner']});assert.equal(waiting.sync.received,0);assert.equal(waiting.sync.pending,true);
  await ok(b,'moderator','/sync/keys/trust',{keyId:keyA.keyId,fingerprint:keyA.fingerprint,confirmed:true});
  const imported=await ok(b,'moderator','/sync',{owners:['owner']});assert.ok(imported.sync.received>0);
  const msgs=(await ok(b,'moderator',`/moderation/owner/conversations/${result.conversation.id}/messages`)).messages;
  assert.deepEqual(msgs.map(m=>m.role),['user','assistant']);assert.equal(msgs[0].text,'Anonymous persisted fixture conversation');
  const snapshot=(await ok(b,'moderator','/moderation/owner')).state;
  assert.ok(snapshot.memory.some(m=>m.id===learned.memory.id));
  assert.equal((await ok(b,'moderator','/sync',{owners:['owner']})).sync.received,0,'Replay must deduplicate');
  const encryptedFiles=(await files(privateTarget)).filter(name=>!name.endsWith('head.json'));
  assert.ok(encryptedFiles.length>0);for(const name of encryptedFiles){const body=await fs.readFile(name,'utf8');assert.ok(!body.includes('Private durable fixture instruction'));const envelope=JSON.parse(body);assert.equal(envelope.version,1);assert.ok(envelope.signature&&envelope.data&&envelope.key);}
  const updated=await ok(a,'owner',`/memory/${learned.memory.id}`,{text:'Updated private fixture instruction',revision:learned.memory.revision},'PUT');
  await ok(a,'owner','/sync',{});assert.ok((await ok(b,'moderator','/sync',{owners:['owner']})).sync.received>0);
  assert.equal((await ok(b,'moderator','/moderation/owner')).state.memory.find(m=>m.id===updated.memory.id).text,'Updated private fixture instruction');
  const previousPid=b.pid;await b.stop();b=await start(rootB,shared,'device-moderator');assert.notEqual(b.pid,previousPid);
  assert.equal((await ok(b,'moderator',`/moderation/owner/conversations/${result.conversation.id}/messages`)).messages.length,2);
  assert.equal((await ok(b,'moderator','/sync/keys')).keys.find(k=>k.keyId===keyA.keyId).trusted,true);
  assert.equal((await ok(b,'moderator','/sync',{owners:['owner']})).sync.received,0);
  assert.equal((await request(b,'peer','/moderation/owner')).status,403);
  assert.equal((await request(b,'peer','/sync',{owners:['owner']})).status,403);
  assert.equal((await request(b,'peer','/sync/keys/trust',{keyId:keyA.keyId,fingerprint:keyA.fingerprint,confirmed:true})).status,403);
  await b.role('moderator','buyer');await a.role('moderator','buyer');
  assert.equal((await request(b,'moderator','/moderation/owner')).status,403);
  assert.equal((await request(b,'moderator','/sync',{owners:['owner']})).status,403);
  const countBefore=(await files(privateTarget)).length;
  await ok(a,'owner',`/memory/${updated.memory.id}`,{text:'After role revoke',revision:updated.memory.revision},'PUT');await ok(a,'owner','/sync',{});
  assert.equal((await files(privateTarget)).length,countBefore,'Fresh role must stop publishing to revoked moderator');
  assert.equal((await request(a,'owner',`/profiles/${agent.id}/publish`,{confirmed:false})).status,409);
  const entry=(await ok(a,'owner',`/profiles/${agent.id}/publish`,{confirmed:true})).entry;
  assert.equal(entry.transcriptsIncluded,false);assert.deepEqual(entry.memory.map(m=>m.id),[sharedMemory.memory.id]);assert.ok(!entry.memory.some(m=>m.id===unapproved.memory.id));
  const copied=(await ok(b,'peer','/catalog/copy',{ownerId:'owner',profileId:agent.id,mode:'rental'})).profile;
  assert.deepEqual(copied.areas,['collection']);assert.equal(copied.ownerId,'peer');assert.equal(copied.lineage.mode,'rental');
  const peerState=(await ok(b,'peer','/state')).state,copiedMemory=peerState.memory.filter(m=>m.profileId===copied.id);
  assert.equal(copiedMemory.length,1);assert.equal(copiedMemory[0].approved,false);assert.equal(copiedMemory[0].origin,'copied');assert.equal(peerState.archive.messages,0);
  assert.equal((await request(b,'peer',`/profiles/${agent.id}`,{name:'Forbidden'},'PUT')).status,404);
  assert.equal((await request(b,'peer','/jobs/fixture/automation/preview',{})).status,403);
  console.log(JSON.stringify({fixture:'anonymous test-only two-process local filesystem',pids:[a.pid,b.pid],messages:msgs.length,encryptedBatches:encryptedFiles.length,mutualTrust:true,replayDedup:true,restartPersistence:true,roleRevocation:true,copyAreas:copied.areas}));
});
