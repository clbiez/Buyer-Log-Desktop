'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const parse=require('../server/lib/parse'),snapshot=require('../server/lib/model-snapshot');
const codec=require('../server/lib/compute-source-codec');
const iso='2026-04-05T00:00:00.000Z';
function source(){
  const rows=[{ocode:123,model:iso,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',license:'',manufacturer:'Demo',season:'W7',countryRaw:'TURKIYE',qty:10,kalan:10,fob:5,
    ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_sourceFields:{'Literal ISO':iso}}];
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
test('exact source replica preserves ISO text, Dates, aliases and real parser output',()=>{
  const input=source(),encoded=codec.encode({ownerId:'a',generation:'g1',source:input});
  const restored=codec.decode(encoded.bytes,{ownerId:'a',generation:'g1',checksum:encoded.checksum});
  assert.equal(restored.asasOrders[0].model,iso);assert.equal(restored.asasOrders[0]._sourceFields['Literal ISO'],iso);
  assert.ok(restored.asasOrders[0].ex instanceof Date);assert.equal(restored.asasOrdersByTarget.cp,restored.asasOrders);assert.equal(restored.asasOrdersByTarget.backlog,restored.asasOrders);
  for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS,parse.buildOrderSummaryRowsFromASAS])assert.deepEqual(build(restored.asasOrders,{},{}),build(input.asasOrders,{},{}));
});
test('source decoder verifies content and owner/generation before giving access to records',()=>{
  const encoded=codec.encode({ownerId:'a',generation:'g1',source:source()});
  assert.throws(()=>codec.decode(encoded.bytes,{ownerId:'b',generation:'g1',checksum:encoded.checksum}),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});
  assert.throws(()=>codec.decode(encoded.bytes,{ownerId:'a',generation:'g2',checksum:encoded.checksum}),{code:'COMPUTE_STALE_GENERATION'});
  const damaged=Buffer.from(encoded.bytes);damaged[damaged.length-1]^=1;
  assert.throws(()=>codec.decode(damaged,{ownerId:'a',generation:'g1',checksum:encoded.checksum}),{code:'COMPUTE_SOURCE_CORRUPT'});
});
test('legacy snapshot revival is intentionally not a lossless substitute for live source',()=>{
  const input=source(),legacy=JSON.parse(JSON.stringify(input));snapshot.reviveSnapshotDates(legacy);
  assert.equal(typeof input.asasOrders[0].model,'string');assert.ok(legacy.asasOrders[0].model instanceof Date);
  assert.notDeepEqual(parse.buildCPRowsFromASAS(legacy.asasOrders,{},{}),parse.buildCPRowsFromASAS(input.asasOrders,{},{}));
  assert.equal(typeof input.asasOrders[0]._sourceFields['Literal ISO'],'string');
});
test('source replica also preserves parser-owned non-enumerable Antrepo metadata and its aliases',()=>{
  const input=source(),map={one:[{qty:3}]},meta={sourceKind:'synthetic',matchableRows:1};
  Object.defineProperty(map,'__antrepoMeta',{value:meta,enumerable:false,configurable:true});input.antrepoMap=map;input.antrepoMapByTarget={cp:map,orders:map,backlog:map};input.antrepoHeaderInfo=meta;
  const encoded=codec.encode({ownerId:'a',generation:'g1',source:input}),decoded=codec.decode(encoded.bytes,{ownerId:'a',generation:'g1',checksum:encoded.checksum});
  assert.deepEqual(decoded.antrepoMap.__antrepoMeta,meta);assert.equal(decoded.antrepoMap.__antrepoMeta,decoded.antrepoHeaderInfo);assert.equal(decoded.antrepoMapByTarget.cp,decoded.antrepoMap);assert.equal(Object.prototype.propertyIsEnumerable.call(decoded.antrepoMap,'__antrepoMeta'),false);
});
