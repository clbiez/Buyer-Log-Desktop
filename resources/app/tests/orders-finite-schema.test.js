'use strict';
// Ten original metadata behavioral cases, now using the actual portable public
// runtime. Historical source/provenance assertions remain in their unchanged
// original packet; official contracts separately pin every actual runtime.
const test=require('node:test'),assert=require('node:assert/strict');
const {api,fixture,pins,modelDef}=require('./contracts/orders/runtime-fixture.cjs');
const dependencyPlan=require('../public/projection-dependency-plan');
function metadata(f){const result=f.compiler.compileSchema(f.context);assert.equal(result.supported,true,result.reason);return result;}
function full(f){const result=f.compiler.compile(f.full,f.context);assert.equal(result.supported,true,result.reason);return result;}
function compilerWith(f,formulaColumns){return api.createOrdersFiniteClosure({canonical:f.canonical,formulaEngine:f.engine,formulaColumns,dependencyPlan,inventory:f.inventory,inventoryRef:{pr:891,head:pins.inventory.head}});}

test('metadata-only plans equal full-body plans through the same actual finite closure core',()=>{
 for(const formulas of [[],[{id:'probe',label:'Probe value',formula:'[Probe]'}],[{id:'lazy',label:'Lazy',formula:'IF(0,[__CPX_UNUSED],[Order Quantity])'}]]){
  const f=fixture({formulas}),before=JSON.stringify(f.context);
  assert.equal(typeof f.compiler.compileSchema,'function');assert.deepEqual(metadata(f),full(f));
  assert.equal(JSON.stringify(f.context),before);assert.ok(Object.isFrozen(metadata(f)));
 }
});

test('metadata compilation needs no envelope/row provider and fabricates no rows to validate closure',()=>{
 const f=fixture({formulas:[{id:'probe',label:'Probe value',formula:'[Probe]'}]}),expected=full(f);let reads=0;
 f.scope.BLFormulaRows.orders=()=>{reads++;throw Error('cold metadata must not request full rows');};
 f.setRows(undefined);f.full=null;
 assert.deepEqual(metadata(f),expected);assert.equal(reads,0);
});

test('metadata rowCount type/range/zero consistency is checked; full mode still checks actual positive count',()=>{
 for(const rowCount of [-1,1.5,'2',null,undefined,NaN,Infinity,200001,0]){
  const f=fixture();f.context.schema.rowCount=rowCount;
  const result=f.compiler.compileSchema(f.context);assert.equal(result.supported,false);assert.equal(result.mode,'full');
 }
 const f=fixture();f.context.schema.rowCount++;
 assert.strictEqual(f.compiler.select(f.full,f.context),f.full,'full wrapper must compare against actual complete rows');
 // Metadata mode cannot independently disprove a plausible positive count.
 // The API requires real server certification of these producer attributes.
});

test('duplicate/missing/unknown/CP/versioned schema cannot produce metadata authority',()=>{
 const changes=[f=>{f.context.schema.rowKeys.push(f.context.schema.rowKeys[0]);},f=>{f.context.schema=null;},f=>{delete f.context.schema.rowKeys;},f=>{f.context.schema.status='unknown';},f=>{f.context.schema.module='cp';},f=>{f.context.schema.schemaVersion=2;},f=>{f.context.schema.extra='unrecognized schema shape';}];
 for(const change of changes){const f=fixture();change(f);assert.equal(f.compiler.compileSchema(f.context).supported,false);assert.strictEqual(f.compiler.select(f.full,f.context),f.full);}
});

test('complete metadata includes late raw fields and literal demand without firstN source sampling',()=>{
 const rows=Array.from({length:61},(_,index)=>({'Order Code':'same',ordinal:index}));
 rows[60].lateNative=false;rows[60].__CPX_LATE=null;
 const f=fixture({rows,modelDefinitions:[modelDef('LATE')]});f.context.filterKeys=['__CPX_LATE'];
 const plan=metadata(f);assert.deepEqual(plan,full(f));assert.ok(plan.fields.includes('lateNative'));assert.ok(plan.fields.includes('__CPX_LATE'));
 const g=fixture();g.full.rows[1].notInEarlierSchema=0;
 assert.strictEqual(g.compiler.select(g.full,g.context),g.full,'full API must detect a late raw key absent from supplied schema');
 g.refreshSchema();assert.ok(metadata(g).fields.includes('notInEarlierSchema'));
});

test('metadata-only canonical token closure retains every colliding physical key, including late blank/false aliases',()=>{
 const rows=Array.from({length:60},(_,index)=>({'Order Code':'same',ordinal:index}));rows[0].__CPX_TOKEN='';rows[59].__CPX__TOKEN=false;
 const f=fixture({rows,modelDefinitions:[modelDef('TOKEN'),modelDef('_TOKEN')]}),binding=f.canonical.bindingFor('orders','manufacturer');
 f.canonical.registerModule('orders',{manufacturer:{keys:[...binding.keys,'__CPX_TOKEN'],semantic:binding.semantic}});
 const plan=metadata(f);assert.deepEqual(plan,full(f));assert.ok(plan.fields.includes('__CPX_TOKEN'));assert.ok(plan.fields.includes('__CPX__TOKEN'));assert.deepEqual(plan.omittedKeys,[]);
});

test('formula and captured hidden/filter setting changes compile fresh metadata closure instead of reusing an old plan',()=>{
 const f=fixture(),before=metadata(f);assert.ok(before.omittedKeys.includes('__CPX_PROBE'));assert.ok(before.omittedKeys.includes('__CPX_UNUSED'));
 f.formula.save('orders',[{id:'new',label:'New',formula:'[Probe]'}]);
 f.scope.colmgr.orders.hidden.delete('__CPX_UNUSED');f.context.hiddenKeys=[...f.scope.colmgr.orders.hidden];f.context.filterKeys=['__CPX_ZERO'];f.context.token.planRevision='settings-2';
 const after=metadata(f);assert.deepEqual(after,full(f));
 for(const key of ['__CPX_PROBE','__CPX_UNUSED','__CPX_ZERO'])assert.ok(after.fields.includes(key),key);
 assert.ok(before.omittedKeys.includes('__CPX_PROBE'));assert.notEqual(before.token.planRevision,after.token.planRevision);
});

test('actual formula storage drift during metadata compilation rejects rather than certifying stale fields',()=>{
 const f=fixture();let calls=0;
 const facade={...f.formula,definitions(table){if(++calls===2)f.formula.save('orders',[{id:'drift',label:'Drift',formula:'[Order Quantity]'}]);return f.formula.definitions(table);}};
 const result=compilerWith(f,facade).compileSchema(f.context);
 assert.equal(result.supported,false);assert.equal(result.reason,'FORMULA_SETTINGS_CHANGED');
});

test('actual canonical binding drift during metadata compilation keeps full mode',()=>{
 const f=fixture();let calls=0;
 const facade={...f.formula,definitions(table){if(++calls===2){const binding=f.canonical.bindingFor('orders','manufacturer');f.canonical.registerModule('orders',{manufacturer:{keys:[...binding.keys,'__CPX_UNUSED'],semantic:binding.semantic}});}return f.formula.definitions(table);}};
 const result=compilerWith(f,facade).compileSchema(f.context);
 assert.equal(result.supported,false);assert.equal(result.reason,'CANONICAL_BINDING_CHANGED');
});

test('metadata getters/proxies and unknown declarations are rejected without invoking hooks',()=>{
 let reads=0;
 const getter=fixture();Object.defineProperty(getter.context.schema,'rowKeys',{enumerable:true,get(){reads++;throw Error('metadata getter');}});
 assert.equal(getter.compiler.compileSchema(getter.context).supported,false);
 const proxy=fixture();proxy.context.schema=new Proxy(proxy.context.schema,{ownKeys(){reads++;throw Error('metadata proxy');},getPrototypeOf(){reads++;throw Error('metadata proxy');}});
 assert.equal(proxy.compiler.compileSchema(proxy.context).supported,false);
 const guard=fixture();guard.context.guards.consumerClosure='unreviewed';assert.equal(guard.compiler.compileSchema(guard.context).supported,false);
 assert.equal(reads,0);
});
