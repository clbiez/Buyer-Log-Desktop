'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {api,fixture,project,compareActual,clone,hash,modelDef,pinned,pins} = require('./runtime-fixture.cjs');
const fallback = f => assert.strictEqual(f.compiler.select(f.full,f.context),f.full,'EXACT full envelope identity');
function plan(f) { const result = f.compiler.compile(f.full,f.context); assert.equal(result.supported,true,result.reason); return result; }

test('actual f076 source blobs and authoritative42/32/10 remain unchanged; no new inventory', () => {
  const f = fixture(); for (const name of Object.keys(pins.captures)) pinned(name);
  assert.equal(f.inventory.fields.length,42);
  assert.equal(f.inventory.fields.filter(v => v.classification === 'ince satırda gerekli').length,32);
  assert.equal(f.inventory.fields.filter(v => v.classification === 'belirsiz').length,10);
  assert.ok(f.inventory.fields.every(v => v.removable === false));
  assert.deepEqual(plan(f).protectedCanonicalIds,f.inventory.fields.map(v => v.canonicalId));
});

test('actual legacy full/full normalization/formula controls agree before any finite selection', () => {
  const definitions=[{id:'read',label:'Read',formula:'[Probe]'}], a=fixture({formulas:definitions}), b=fixture({formulas:definitions});
  const first=compareActual(a,{fields:a.context.schema.rowKeys,omittedKeys:[]});
  const second=compareActual(b,{fields:b.context.schema.rowKeys,omittedKeys:[]});
  assert.equal(a.reference.serialize(first,'projection'),b.reference.serialize(second,'projection'));
  assert.deepEqual(first.map(r=>r.__f_read),[0,false]);
});

test('only explicitly registered hidden modelCustom __CPX keys are candidates; all unknown/nonmodel/native keys stay', () => {
  const f = fixture(), p = plan(f);
  assert.deepEqual(p.omittedKeys,['__CPX_PROBE','__CPX_UNUSED','__CPX_ZERO','__CPX_FALSE','__CPX_NULL','__CPX_SHARED']);
  for (const key of ['Order Code','Probe','__CPX_UNREGISTERED','__CPX_VISIBLE','unknown','__proto__','constructor','_logisticSegments','_logisticTotalQty'])
    assert.ok(p.fields.includes(key),key);
  assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.token)); assert.ok(Object.isFrozen(p.fields));
});

test('actual normalization and all42 canonical readers preserve exact retained ordered keys/types/values/SHA', () => {
  const f = fixture(), p = plan(f), before = hash(JSON.stringify(f.full));
  const rows = compareActual(f,p); assert.equal(rows.length,2);
  assert.equal(rows[0]['Order Code'],rows[1]['Order Code']);
  assert.ok(rows[0].OPD instanceof Date); assert.equal(rows[0]._logisticTotalQty,false);
  assert.equal(hash(JSON.stringify(f.full)),before);
});

test('real formula own Probe=0 beats model alias while absent Probe reads false; hidden dependency is retained', () => {
  const f = fixture({formulas:[{id:'read',label:'Read',formula:'[Probe]'}]}), p = plan(f);
  assert.ok(p.fields.includes('__CPX_PROBE')); assert.ok(!p.omittedKeys.includes('__CPX_PROBE'));
  assert.deepEqual(compareActual(f,p).map(r => r.__f_read),[0,false]);
});

test('actual compile.columns keeps both IF branches even when a hidden branch is never executed', () => {
  const f = fixture({formulas:[{id:'lazy',label:'Lazy',formula:'IF(0, [__CPX_UNUSED], [Order Quantity])'}]}), p = plan(f);
  assert.ok(p.fields.includes('__CPX_UNUSED')); assert.deepEqual(compareActual(f,p).map(r => r.__f_lazy),[100,0]);
});

test('real stable-key calculated dependency DAG retains the transitive model dependency', () => {
  const f = fixture({formulas:[{id:'first',label:'First',formula:'[__CPX_PROBE]'},
    {id:'second',label:'Second',formula:'[__f_first]'}]}), p = plan(f);
  assert.ok(p.fields.includes('__CPX_PROBE'));
  assert.deepEqual(compareActual(f,p).map(r => [r.__f_first,r.__f_second]),[[999,999],[false,false]]);
});

test('real calculated alias beats model label; conservative closure retains both possible inputs', () => {
  const f = fixture({formulas:[{id:'shared',label:'Shared',formula:'[Order Quantity]'},
    {id:'out',label:'Output',formula:'[Shared]'}]}), p = plan(f);
  assert.ok(p.fields.includes('__CPX_SHARED'));
  assert.deepEqual(compareActual(f,p).map(r => r.__f_out),[100,0]);
});

test('enable/change live definitions rebuilds closure rather than reusing a hidden-field decision', () => {
  const f = fixture(); assert.ok(plan(f).omittedKeys.includes('__CPX_PROBE'));
  f.formula.save('orders',[{id:'x',label:'X',formula:'[Probe]'}]); f.context.token.planRevision = 'changed-1';
  assert.ok(!plan(f).omittedKeys.includes('__CPX_PROBE'));
  f.formula.save('orders',[{id:'x',label:'X',formula:'[__CPX_UNUSED]'}]); f.context.token.planRevision = 'changed-2';
  const p = plan(f); assert.ok(p.omittedKeys.includes('__CPX_PROBE')); assert.ok(p.fields.includes('__CPX_UNUSED'));
  assert.deepEqual(compareActual(f,p).map(r => r.__f_x),[0,false]);
});

test('unresolved, malformed, unsupported-function/arity and cyclic actual formulas select exact full fallback', () => {
  for (const definitions of [[{id:'x',label:'X',formula:'[NO_SUCH_REFERENCE]'}],
    [{id:'x',label:'X',formula:'[Probe] +'}],[{id:'x',label:'X',formula:'NO_SUCH_FUNCTION(1)'}],
    [{id:'x',label:'X',formula:'IF(1)'}],
    [{id:'x',label:'X',formula:'[Y]'},{id:'y',label:'Y',formula:'[X]'}]]) fallback(fixture({formulas:definitions}));
});

test('literal filter/sort/both-rule-operands/offset/current-operation inputs retain their hidden keys including0/false/null', () => {
  const f = fixture(); f.context.filterKeys = ['__CPX_ZERO']; f.context.sortKeys = ['__CPX_FALSE'];
  f.context.ruleKeys = ['__CPX_NULL','__CPX_UNUSED']; f.context.operationKeys = ['__CPX_PROBE'];
  const p = plan(f); for (const key of ['__CPX_ZERO','__CPX_FALSE','__CPX_NULL','__CPX_UNUSED','__CPX_PROBE']) assert.ok(p.fields.includes(key));
  const rows = compareActual(f,p); assert.equal(rows[0].__CPX_ZERO,0); assert.equal(Object.hasOwn(rows[1],'__CPX_ZERO'),false);
  assert.equal(rows[0].__CPX_FALSE,false); assert.equal(rows[0].__CPX_NULL,null);
});

test('whole-source union keeps ALL canonical token matches including blank/false aliases after row50', () => {
  const definitions = [modelDef('TOKEN'),modelDef('_TOKEN')], rows = Array.from({length:60},(_,i) => ({'Order Code':'same',n:i}));
  rows[0].__CPX_TOKEN = ''; rows[59].__CPX__TOKEN = false;
  const f = fixture({modelDefinitions:definitions,rows}), current = f.canonical.bindingFor('orders','manufacturer');
  f.canonical.registerModule('orders',{manufacturer:{keys:[...current.keys,'__CPX_TOKEN'],semantic:current.semantic}});
  const p = plan(f); assert.ok(p.fields.includes('__CPX_TOKEN')); assert.ok(p.fields.includes('__CPX__TOKEN'));
  assert.equal(f.canonical.canonicalValue(f.full.rows[59],'orders','manufacturer'),false);
  assert.deepEqual(p.omittedKeys,[]); compareActual(f,p);
});

test('complete __canonical own overrides preserve null/false and cannot be stripped with a model field', () => {
  const f = fixture(); f.full.rows[0].__canonical = {manufacturer:null,orderQuantity:false};
  f.full.rows[1].__canonical = {manufacturer:false,orderQuantity:0}; f.refreshSchema();
  const p = plan(f); assert.ok(p.fields.includes('__canonical')); compareActual(f,p);
});

test('unknown consumer closure, predicate, operation or trace-derived claim forces full before any omission', () => {
  for (const change of [{consumerClosure:'future-reader'},{predicates:'arbitrary-function'},{operationsKnown:false},
    {traceDerived:true},{canonicalReads:'first-n-nonblank'}]) {
    const f = fixture(); Object.assign(f.context.guards,change); fallback(f);
  }
  const extra = fixture(); extra.context.newConsumer = []; fallback(extra);
});

test('pending/unknown migration or unknown formula storage cannot treat missing references as removable', () => {
  for (const change of [{migration:'pending'},{migration:'unknown'},{formulaStorageKnown:false}]) {
    const f = fixture(); Object.assign(f.context.guards,change); fallback(f);
  }
});

test('every named full-before-use barrier is mandatory; synthetic labels are not production barrier proof', () => {
  for (const barrier of api.BARRIERS) { const f = fixture(); f.context.fullBeforeUse = f.context.fullBeforeUse.filter(k => k !== barrier); fallback(f); }
  const unknown = fixture(); unknown.context.fullBeforeUse.push('not-reviewed'); fallback(unknown);
});

test('CP token, CP schema, unknown/missing/versioned schema and wrong rowcount/key universe stay full', () => {
  for (const change of [f => {f.context.token.module='cp';},f => {f.context.schema.module='cp';},
    f => {f.context.schema.status='unknown';},f => {f.context.schema=null;},f => {f.context.schema.schemaVersion=2;},
    f => {f.context.schema.rowCount++;},f => {f.context.schema.rowKeys.pop();}]) {const f=fixture();change(f);fallback(f);}
});

test('visible/unregistered/model-metadata mismatch never drops a key; duplicate registration selects full', () => {
  const f = fixture(); f.context.hiddenKeys.push('__CPX_UNREGISTERED','__CPX_VISIBLE');
  f.context.columns.find(c => c.k==='__CPX_VISIBLE').modelCustom=false;
  const p = plan(f); assert.ok(p.fields.includes('__CPX_UNREGISTERED')); assert.ok(p.fields.includes('__CPX_VISIBLE'));
  const missing = fixture(); missing.context.schema.modelColumns.pop(); fallback(missing);
  const duplicate = fixture(); duplicate.context.columns.push(clone(duplicate.context.columns[2])); fallback(duplicate);
  const drift = fixture(); drift.context.columns[2].label='renamed-without-runtime-sync'; fallback(drift);
});

test('getters/nonplain/proxy unsupported inputs select full without invoking getters; source stays untouched', () => {
  const f = fixture(); let invoked=0;
  Object.defineProperty(f.full.rows[0],'trap',{enumerable:true,get(){invoked++;throw new Error('must not invoke');}});
  fallback(f); assert.equal(invoked,0);
  const c = fixture(); Object.defineProperty(c.context.guards,'migration',{enumerable:true,get(){invoked++;return 'settled-on-full-v1';}});
  fallback(c); assert.equal(invoked,0);
  const unusual = fixture(); Object.setPrototypeOf(unusual.full.rows[0],{custom:true}); fallback(unusual);
  const proxy = fixture(); proxy.full.rows[0]=new Proxy(proxy.full.rows[0],{ownKeys(){throw new Error('must not trap');}}); fallback(proxy);
});

test('sparse rows, extra array properties and512-key union admission overflow leave exact full fallback', () => {
  const sparse = fixture(); delete sparse.full.rows[1]; fallback(sparse);
  const extra = fixture(); extra.full.rows.extra=true; fallback(extra);
  const wide = fixture(); for(let i=0;i<513;i++)wide.full.rows[0]['custom-'+i]=i; fallback(wide);
});

test('legacy full/no-omission and unsupported profile paths preserve source; no source graph is copied by compile', () => {
  const f = fixture(), before=JSON.stringify(f.full), nested=f.full.rows[0].unknown;
  f.context.hiddenKeys=[]; assert.deepEqual(plan(f).omittedKeys,[]);
  assert.strictEqual(f.full.rows[0].unknown,nested); assert.equal(JSON.stringify(f.full),before);
  const profile = fixture(); profile.full.profile='future'; fallback(profile);
  const metadata = fixture(); metadata.full.completeness=[]; fallback(metadata);
});

test('candidate fields compose with actual frozen stateless core and exact bounded full details before public use', () => {
  pinned('projection-view-core.js'); const core=require('./pinned/projection-view-core'), f=fixture(), p=plan(f), secret=Buffer.alloc(32,7);
  const trusted=core.compileFinitePlan({token:f.context.token,viewId:'orders-synthetic-finite',readers:['orders']},
    {revision:f.context.token.planRevision,readers:new Map([['orders',{mode:'finite',fields:p.fields}]])});
  assert.ok(trusted); const view=core.buildView(f.full,f.context.token,trusted,secret);
  assert.equal(view.profile,core.VIEW); assert.deepEqual(Object.keys(view.rows[0]),Object.keys(project(f.full,p.fields)[0]));
  const detail=core.resolveDetails(f.full,{token:f.context.token,records:view.completeness.map(({ordinal,handle})=>({ordinal,handle}))},f.context.token,secret);
  assert.equal(JSON.stringify(detail.records.map(r=>r.row)),JSON.stringify(f.full.rows));
  assert.notEqual(view.completeness[0].handle,view.completeness[1].handle); // Duplicate business IDs remain separate ordinals.
  assert.deepEqual(detail.records.map(r=>Object.keys(r.row)),f.full.rows.map(Object.keys));
});
