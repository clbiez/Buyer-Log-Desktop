'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process'),{once}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-request-lease-'));
function child(name,args){return fork(path.join(__dirname,'helpers',name),args,{stdio:['ignore','ignore','pipe','ipc']});}
async function stop(proc){if(proc.exitCode!==null)return;const done=once(proc,'exit');proc.send({stop:true});await done;}
test('contended request writers leave unrelated HTTP health responsive and acknowledge only after durable completion',async t=>{
 const server=child('request-lease-server.cjs',[root]);let holder;
 t.after(async()=>{if(holder?.exitCode===null)await stop(holder);await stop(server);fs.rmSync(root,{recursive:true,force:true});});
 const [info]=await once(server,'message'),base=`http://127.0.0.1:${info.port}`;
 for(const [name,target] of Object.entries(info.targets)){
  await t.test(name,async()=>{
   fs.mkdirSync(path.dirname(target),{recursive:true});
   holder=child('file-lease-worker.cjs',['hold',target]);const [entered]=await once(holder,'message');assert.equal(entered.entered,true);
   const started=performance.now();let acknowledged=false;
   const write=fetch(`${base}/write/${name}`).then(async response=>({status:response.status,body:await response.json()})).finally(()=>{acknowledged=true;});
   await new Promise(resolve=>setTimeout(resolve,60));
   const healthStart=performance.now(),response=await fetch(`${base}/health`),elapsed=performance.now()-started,healthMs=performance.now()-healthStart;
   const pendingBeforeRelease=!acknowledged;
   await stop(holder);holder=null;
   const result=await write;
   t.diagnostic(`${name} health RTT while resource held: ${healthMs.toFixed(1)} ms; ${elapsed.toFixed(1)} ms since write`);
   assert.equal(response.status,200);assert.equal(result.status,200,JSON.stringify(result.body));
   assert.ok(pendingBeforeRelease,`${name}: writer timed out or acknowledged before external lock release (${Math.round(elapsed)} ms health)`);
   assert.ok(fs.existsSync(target),`${name}: persisted file must exist before success`);
   const saved=JSON.parse(fs.readFileSync(target,'utf8'));
   if(name==='fabric')assert.equal(saved.cards['1001'].summary,'Synthetic fabric');
   if(name==='checklist')assert.ok(saved.definitions.some(item=>item.id==='demo'));
   if(name==='preferences')assert.equal(saved.entries['lcw.todo.demo'].value,'Synthetic note');
  });
 }
});
