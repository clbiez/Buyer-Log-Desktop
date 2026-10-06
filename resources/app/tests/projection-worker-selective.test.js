'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const {runProjectionWorker}=require('../server/lib/projection-worker-client');
const parse=require('../server/lib/parse');
const rows=Array.from({length:24},(_,i)=>({ocode:1000+i,kalan:i%3?10:0,qty:20,antrepo:10,fob:5.25,license:'Marvel',manufacturer:'Demo',season:'S1',countryRaw:'TURKIYE',category:'Cat',model:`Model ${i}`,ccode:`C${i}`,colour:'Red',opd:new Date(2026,0,1),ex:new Date(2026,0,5),retail:new Date(2026,0,10),mb:new Date(2026,0,12)}));
const payload={cpSource:rows,ordersSource:rows,cpAntrepo:{},ordersAntrepo:{},overrides:{},shared:true,orderSummaryAllowed:true,editableOrderCodes:rows.map(r=>r.ocode)};
const decode=entry=>JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)));
test('selective production worker preserves CP and catalog outputs, including cached Orders and empty fallback',async()=>{
  const full=await runProjectionWorker(payload);
  assert.ok(decode(full.compressed.cp).rows.every(r=>Object.hasOwn(r,'Priority')));
  assert.ok(decode(full.compressed.orders).rows.every(r=>!Object.hasOwn(r,'Priority')));
  const selected=await runProjectionWorker({...payload,modules:['cp','collection-catalog'],catalogOrdersBuffer:full.compressed.orders.buffer});
  assert.deepEqual(Object.keys(selected.compressed).sort(),['collection-catalog','cp']);
  for(const key of Object.keys(selected.compressed))assert.deepEqual(decode(selected.compressed[key]),decode(full.compressed[key]));
  const empty=await runProjectionWorker({...payload,ordersSource:[],shared:false});
  const fallback=await runProjectionWorker({...payload,ordersSource:[],shared:false,modules:['collection-catalog'],catalogOrdersBuffer:empty.compressed.orders.buffer});
  assert.deepEqual(decode(fallback.compressed['collection-catalog']),decode(empty.compressed['collection-catalog']));
});
test('shared parse retains every CP value and every Orders operational value while omitting Orders priority',()=>{
  const shared=parse.buildSharedOrderProjectionRowsFromASAS(rows,{},{});
  const json=v=>JSON.parse(JSON.stringify(v));
  assert.deepEqual(json(shared.cp),json(parse.buildCPRowsFromASAS(rows,{},{})));
  assert.deepEqual(json(shared.orders),json(parse.buildOrdersRowsFromASAS(rows,{},{})));
  assert.equal(shared.orders.length,24);assert.equal(shared.cp.length,16);
});
