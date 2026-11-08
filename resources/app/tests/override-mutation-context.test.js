'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const current=fs.readFileSync(path.join(__dirname,'../public/override-sync.js'),'utf8'),original=fs.readFileSync(path.join(__dirname,'fixtures/orders-import-action-closure/override-sync-before.js'),'utf8');
assert.equal(crypto.createHash('sha256').update(original).digest('hex'),'f42f91aa3b6a2fa8d45249ab5e8282bdbec6e776c504d0c343dec7ca6cde674d','frozen real queue predecessor');
function fixture(source=current,fetch){
 const requests=[],events=[],reloads=[],toasts=[],state={storeRevisions:{orders:7,suppFob:2}};
 const c=vm.createContext({state,Promise,Set,Map,Object,Date,appLang:'en',window:{BL_CLIENT_ID:'synthetic-client',dispatchEvent:e=>events.push(e.type)},CustomEvent:class{constructor(type){this.type=type;}},
  showToast:text=>toasts.push(text),loadFromServer:async()=>reloads.push(true),fetchJSON:async(url,opts)=>{requests.push([url,JSON.parse(JSON.stringify(opts))]);return fetch?fetch(url,opts):{revision:8,revisions:{suppFob:3},overrides:{_revision:9}};}});
 vm.runInContext(source,c);return {c,state,requests,events,reloads,toasts};
}
const opts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[]})};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('unchanged legacy success and conflict traces remain exactly equal to the frozen real queue',async()=>{
 for(const conflict of [false,true]){
  const results=[];
  for(const source of [original,current]){
   const f=fixture(source,conflict?async()=>{throw Object.assign(Error('conflict'),{code:'REVISION_CONFLICT',currentRevision:11});}:undefined);
   let outcome;try{outcome=await f.c.enqueueOverrideMutation('orders','/api/overrides/batch',opts);}catch(error){outcome={code:error.code};}
   results.push(JSON.stringify({outcome,state:f.state,requests:f.requests,events:f.events,reloads:f.reloads,toasts:f.toasts}));
  }
  assert.equal(results[0],results[1]);
 }
});
for(const guard of [()=>false,()=>0,async()=>true,()=>Promise.reject(Error('rejected guard')),{}])test('invalid/async guard cannot start a transport request: '+String(guard),async()=>{
 const f=fixture();await assert.rejects(f.c.enqueueOverrideMutation('orders','/api/overrides/batch',{...opts,assertCurrent:guard}),e=>e.code==='OVERRIDE_CONTEXT_CHANGED');assert.equal(f.requests.length,0);
 await f.c.enqueueOverrideMutation('orders','/api/overrides/batch',opts);assert.equal(f.requests.length,1,'cancelled predecessor does not poison the queue');
});
test('late guarded success leaves current revisions and ACK notifications untouched',async()=>{
 const wait=deferred(),f=fixture(current,()=>wait.promise);let active=true;
 const p=f.c.enqueueOverrideMutation('orders','/api/overrides/batch',{...opts,assertCurrent:()=>active});p.catch(()=>{});await turn();active=false;wait.resolve({revision:19,revisions:{suppFob:21}});
 await assert.rejects(p,e=>e.code==='OVERRIDE_CONTEXT_CHANGED');assert.equal(f.state.storeRevisions.orders,7);assert.equal(f.state.storeRevisions.suppFob,2);assert.equal(f.events.length,0);
});
test('late stale conflict cannot change another context revision or trigger its reload',async()=>{
 const wait=deferred(),f=fixture(current,()=>wait.promise);let active=true;
 const p=f.c.enqueueOverrideMutation('orders','/api/overrides/batch',{...opts,assertCurrent:()=>active});p.catch(()=>{});await turn();active=false;wait.reject(Object.assign(Error('old conflict'),{code:'REVISION_CONFLICT',currentRevision:99}));
 await assert.rejects(p,e=>e.code==='OVERRIDE_CONTEXT_CHANGED');assert.equal(f.state.storeRevisions.orders,7);assert.equal(f.reloads.length,0);assert.equal(f.toasts.length,0);
});
test('the local guard function is never forwarded to the HTTP adapter',async()=>{
 const f=fixture(current,async(_url,request)=>{assert.equal(Object.hasOwn(request,'assertCurrent'),false);return {revision:8};});
 await f.c.enqueueOverrideMutation('orders','/api/overrides/batch',{...opts,assertCurrent:()=>true});assert.equal(f.events.length,1);
});
