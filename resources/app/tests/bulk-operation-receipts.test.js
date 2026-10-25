'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Bulk=require('../public/bulk-operations');
function setup(){const values=new Map();let user='alice';return {values,setUser:value=>user=value,api:Bulk.createController({storage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},scope:()=>user,nonce:()=>String(values.size+1)})};}
test('a bulk intent sends once, persists pending before send and records only acknowledged items',async()=>{
 const {api}=setup();let calls=0,release;const intent={module:'cp',owner:'a',items:[{key:'x'},{key:'y'}],guard:()=>true,send:async()=>{calls++;assert.equal(api.history()[0].status,'unknown');await new Promise(r=>release=r);return {revision:4,outcomes:[{key:'x',status:'accepted'},{key:'y',status:'rejected'}]};}};
 const first=api.execute(intent),second=api.execute(intent);await Promise.resolve();release();const [a,b]=await Promise.all([first,second]);assert.equal(calls,1);assert.equal(a,b);assert.equal(a.status,'partial');assert.deepEqual(api.rejected(a).map(i=>i.key),['y']);assert.equal(api.history()[0].revision,4);
});
test('lost response and restart remain unknown; reading a receipt never replays it',async()=>{
 const {api}=setup();let calls=0;const result=await api.execute({module:'cp',owner:'a',items:[{key:'x'}],guard:()=>true,send:async()=>{calls++;throw new TypeError('connection lost');}});assert.equal(result.status,'unknown');assert.equal(api.rejected(result).length,0);assert.equal(api.history()[0].status,'unknown');assert.equal(calls,1);
});
test('preview guard, current session and receipt storage failure prevent writes',async()=>{
 const {api,setUser}=setup();let calls=0;const spec={module:'cp',owner:'a',items:[{key:'x'}],guard:()=>false,send:async()=>calls++};await assert.rejects(api.execute(spec),{code:'BULK_STALE'});assert.equal(calls,0);
 const user=api.captureScope();setUser('bob');await assert.rejects(api.execute({...spec,scope:user,guard:()=>true}),{code:'BULK_STALE'});assert.equal(api.history().length,0);
 const broken=Bulk.createController({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}},scope:()=> 'bob'});await assert.rejects(broken.execute({...spec,guard:()=>true}),{code:'BULK_RECEIPT_STORAGE'});assert.equal(calls,0);
});
test('confirmed rejection is retryable; omitted or duplicate item results are unknown',async()=>{
 const {api}=setup();const rejected=await api.execute({module:'checklist',owner:'a',items:[{key:'x'}],guard:()=>true,send:async()=>{throw Object.assign(Error('conflict'),{status:409});}});assert.equal(rejected.status,'rejected');assert.equal(api.rejected(rejected).length,1);
 const malformed=await api.execute({module:'cp',owner:'a',items:[{key:'x'},{key:'y'}],guard:()=>true,send:async()=>({outcomes:[{key:'x',status:'accepted'},{key:'x',status:'accepted'}]})});assert.equal(malformed.status,'unknown');assert.equal(api.rejected(malformed).length,0);
});
