'use strict';
// PREPARED ONLY. A passing rejection test rejects this candidate for CP use.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fromRecord}=require('./lazy-row.cjs'),B=require('./boundaries.cjs');B.preflight();
const pins=require('./pins.json'),root=pins.root;
test('isolated adapter keeps own keys/order, presence, duplicate IDs, mutable slots, Dates and basic ordinary operations',()=>{
 const date=new Date('2026-10-05T00:00:00Z'),source=JSON.parse('{"2":"two","1":"one","Order Code":"same","zero":0,"flag":false,"nil":null,"nested":{"x":1}}');source.date=date;
 const first=fromRecord(source,0),second=fromRecord({...source},1),row=first.row;
 assert.equal(typeof row,'object');assert.notEqual(row,second.row);assert.equal(first.ordinal,0);assert.equal(second.ordinal,1);assert.equal(row.date,date);assert.equal(row.date instanceof Date,true);
 assert.deepEqual(Object.keys(row),Object.keys(source));assert.deepEqual({...row},source);assert.equal(JSON.stringify(row),JSON.stringify(source));assert.equal(Object.hasOwn(row,'nil'),true);assert.equal(Object.hasOwn(row,'missing'),false);
 row.zero=4;row.flag=false;delete row.nil;row.nil=null;row.extra=0;row['0']='zero-index';assert.equal(row.zero,4);assert.equal(first.packed.cells[first.packed.keys.indexOf('zero')],4);
 const expected={...source};expected.zero=4;delete expected.nil;expected.nil=null;expected.extra=0;expected['0']='zero-index';assert.deepEqual(Object.keys(row),Object.keys(expected));assert.equal(JSON.stringify(row),JSON.stringify(expected));
});
test('native detection rejects source Proxies/getters/custom toJSON before packing or invoking traps',()=>{
 let invoked=0;const proxy=new Proxy({}, {ownKeys(){invoked++;return [];}});assert.throws(()=>fromRecord(proxy),/PROXY/);assert.equal(invoked,0);
 const getter={};Object.defineProperty(getter,'x',{get(){invoked++;return 1;},enumerable:true,configurable:true});assert.throws(()=>fromRecord(getter),/DESCRIPTOR/);assert.equal(invoked,0);
 assert.throws(()=>fromRecord({toJSON(){invoked++;return {};}}),/TO_JSON/);assert.equal(invoked,0);
 assert.throws(()=>fromRecord({nested:{get x(){invoked++;return 1;}}}),/DESCRIPTOR/);assert.equal(invoked,0);
});
test('actual current normalizer/canonical/formula/checklist/CP decision computation works on a tiny retained-field fixture only',()=>{
 const normalize=require(path.join(root,'tests/helpers/projection-current-normalizer.js')).loadReference().normalize;
 const Fields=require(path.join(root,'public/canonical-fields.js')),Formula=require(path.join(root,'public/formula-engine.js')),C=require(path.join(root,'public/checklist-components-engine.js')),Rules=require(path.join(root,'public/cp-rules-engine.js')),Engine=require(path.join(root,'public/cp-readiness-engine.js'));
 const input=[{'Order Code':'same','Order Quantity':0,'Category':'PIJAMA','Ürün Tanım':'PIJAMA TAKIM 2 Lİ','Ex-factory':'2026-10-05','Retail Date':'2026-11-02',flag:false,nil:null},
 {'Order Code':'same','Order Quantity':10,'Category':'KAZAK','Ürün Tanım':'KAZAK','Ex-factory':'2026-10-05','Retail Date':'2026-11-02'}];
 const ordinary=JSON.parse(JSON.stringify(input)),lazy=JSON.parse(JSON.stringify(input)).map((record,i)=>fromRecord(record,i).row);
 normalize(ordinary);normalize(lazy);assert.equal(JSON.stringify(lazy),JSON.stringify(ordinary));
 assert.equal(Fields.value(lazy[0],'cp','productDescription'),Fields.value(ordinary[0],'cp','productDescription'));
 const program=Formula.compile('[Order Quantity] + 1');assert.equal(program.ok,true);assert.deepEqual(program.evaluate(lazy[0],{strictColumns:true}),program.evaluate(ordinary[0],{strictColumns:true}));
 const parts=rows=>C.withRowCache(()=>rows.map((row,i)=>({set:C.isSet(row,'cp'),count:C.count(row,'cp'),parts:C.partsFor({orderKey:'SYNTH-'+i,sourceRow:row},{})})));
 assert.deepEqual(parts(lazy),parts(ordinary));
 const a=Engine.analyze(ordinary,{today:20000}),b=Engine.analyze(lazy,{today:20000});assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(a)));
 const evaluate=model=>C.withRowCache(()=>model.orders.map(order=>Rules.evaluateOrder(order,{rules:Rules.DEFAULT_RULES,answers:{},today:20000})));
 assert.deepEqual(JSON.parse(JSON.stringify(evaluate(b))),JSON.parse(JSON.stringify(evaluate(a))));
});
test('native Proxy structured clone, actual CP runtime worker boundary and actual bulk snapshot path reject default CP use',async()=>{
 const evidence=await B.run();assert.equal(evidence.nativeStructuredClone.name,'DataCloneError');assert.equal(evidence.actualRuntime.nativeThrows[0].type,'batch');
 assert.equal(evidence.actualRuntime.stats.workerJobs,0);assert.equal(evidence.actualRuntime.stats.fallbackJobs,1);assert.equal(evidence.actualRuntime.stats.failed,1);assert.equal(evidence.actualWithCpBulkDraft.failure.name,'DataCloneError');assert.equal(evidence.actualWithCpBulkDraft.workCallbackCalled,false);
});
test('prototype deliberately rejects unsupported descriptor/seal operations rather than pretending full object equivalence',()=>{
 const row=fromRecord({x:1}).row;assert.throws(()=>Object.defineProperty(row,'secret',{value:2,enumerable:false}),/UNSUPPORTED_DEFINE_PROPERTY/);assert.throws(()=>Object.preventExtensions(row),/UNSUPPORTED_PREVENT_EXTENSIONS/);
});
