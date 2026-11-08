'use strict';
// UNRUN. Root can point the unchanged assertions at v1-frozen for behavioral RED preparation.
const test = require('node:test'), assert = require('node:assert/strict');
const api = require(process.env.BUYERLOG_DEPENDENCY_MODULE || './dependency-plan.js');
const F = require('./runtime-fixture.cjs');
const select = fixture => fixture.compiler.select(fixture.full, fixture.request);

test('the authoritative inventory stays 32 required, 10 uncertain, zero removable; contracts/matrix remain references', () => {
  const f = F.fixture(api), plan = select(f);
  assert.equal(plan.supported, true); assert.equal(plan.mode, 'candidate');
  assert.equal(F.inventory.fields.filter(field => field.classification === 'ince satırda gerekli').length, 32);
  assert.equal(F.inventory.fields.filter(field => field.classification === 'belirsiz').length, 10);
  assert.equal(F.inventory.fields.some(field => field.removable), false);
  assert.deepEqual([...plan.protectedCanonicalIds], F.inventory.fields.map(field => field.canonicalId));
  for (const id of plan.protectedCanonicalIds) for (const key of f.runtime.canonical.bindingFor('orders', id)?.keys || []) assert.ok(plan.fields.includes(key));
  assert.deepEqual([...plan.contractIds].sort(), F.contracts.contracts.map(item => item.id).sort());
  assert.equal(F.matrix.cases.length, 24);
  assert.equal(plan.authority, 'server-certification-still-required');
});

test('missing closure, unknown/omitted consumer or dynamic consumer returns exact full identity', () => {
  for (const mutate of [request => { delete request.coverage; }, request => { request.coverage.consumerIds.push('unknown'); },
    request => { request.coverage.consumerIds.pop(); }, request => { request.coverage.manifestRevision = 'old'; }]) {
    const f = F.fixture(api); mutate(f.request); assert.equal(select(f), f.full);
  }
  const f = F.fixture(api); f.adapters[0].declare = request => ({ contextKey: request.contextKey, revision: '1', mode: 'dynamic' });
  const compiler = api.createCompiler({ canonical: f.runtime.canonical, formulaEngine: f.runtime.engine, inventory: F.inventory,
    inventoryRef: { pr: 891, head: api.INVENTORY_HEAD }, manifest: f.manifest, adapters: f.adapters });
  assert.equal(compiler.select(f.full, f.request), f.full);
});

test('missing adapter and unproven deferred full barrier cannot be silently ignored', () => {
  const f = F.fixture(api), options = { canonical: f.runtime.canonical, formulaEngine: f.runtime.engine, inventory: F.inventory,
    inventoryRef: { pr: 891, head: api.INVENTORY_HEAD }, manifest: f.manifest, adapters: f.adapters.slice(1) };
  assert.throws(() => api.createCompiler(options), { code: 'MISSING_CONSUMER_ADAPTER' });
  f.adapters.at(-1).guaranteesFullBeforeUse = false;
  const compiler = api.createCompiler({ ...options, adapters: f.adapters }); assert.equal(compiler.select(f.full, f.request), f.full);
});

test('first-N trace, sampled keys, unknown source contract and context drift cannot certify a plan', () => {
  for (const patch of [{ kind: 'row-trace' }, { traceDerived: true }, { wholeContext: false }, { contextKey: 'other' }]) {
    const f = F.fixture(api); Object.assign(f.request.producer, patch); assert.equal(select(f), f.full);
  }
});

test('real runtime module binding order is retained without raw header rewriting', () => {
  for (const module of ['cp','orders']) {
    const f = F.fixture(api, module), binding = f.runtime.canonical.bindingFor(module, 'orderCode');
    f.request.state.canonicalIds = ['orderCode'];
    f.request.producer.canonicalModes.orderCode = { mode: 'own-first-nonblank', key: binding.keys[0], everyRowOwn: true,
      everyRowNonBlank: true, canonicalOverrideAbsent: true, contextKey: f.request.contextKey, producerRevision: f.request.producer.revision };
    const plan = select(f); assert.equal(plan.supported, true);
    const positions = binding.keys.map(key => plan.fields.indexOf(key)); assert.deepEqual([...positions].sort((a,b) => a-b), [...positions]);
    assert.equal(f.runtime.canonical.canonicalValue({ [binding.keys[0]]: 0 }, module, 'orderCode'), 0);
    assert.equal(f.runtime.canonical.canonicalValue({ [binding.keys[0]]: false }, module, 'orderCode'), false);
  }
});

test('real canonical token fallback, blank-own path and unknown canonical ID select full', () => {
  const f = F.fixture(api), key = f.runtime.canonical.bindingFor('orders','manufacturer').keys[0];
  assert.equal(f.runtime.canonical.canonicalValue({ MaNuFaCtUrEr: 'DEMO' }, 'orders','manufacturer'), 'DEMO');
  f.request.state.canonicalIds = ['manufacturer'];
  f.request.producer.canonicalModes.manufacturer = { mode: 'token-fallback', contextKey: f.request.contextKey, producerRevision: f.request.producer.revision };
  assert.equal(select(f), f.full);
  f.request.producer.canonicalModes.manufacturer = { mode: 'own-first-nonblank', key, everyRowOwn: true, everyRowNonBlank: false,
    canonicalOverrideAbsent: true, contextKey: f.request.contextKey, producerRevision: f.request.producer.revision };
  assert.equal(select(f), f.full);
  f.request.state.canonicalIds = ['not-registered']; assert.equal(select(f), f.full);
});

test('real own __canonical override preserves null/false precedence and retains the entire container', () => {
  const f = F.fixture(api); f.request.state.canonicalIds = ['orderCode'];
  f.request.producer.canonicalModes.orderCode = { mode: 'own-canonical-override', everyRowOwnOverride: true,
    contextKey: f.request.contextKey, producerRevision: f.request.producer.revision };
  const plan = select(f); assert.equal(plan.supported, true); assert.ok(plan.fields.includes('__canonical'));
  assert.equal(f.runtime.canonical.canonicalValue({ __canonical: { orderCode: null }, 'Order Code': 'later' }, 'orders','orderCode'), null);
  assert.equal(f.runtime.canonical.canonicalValue({ __canonical: { orderCode: false }, 'Order Code': 'later' }, 'orders','orderCode'), false);
});

test('actual formula own 0 and hidden model alias false both survive a finite conservative plan', () => {
  const f = F.fixture(api), defs = [{ id: 'probe', label: 'Result', formula: '[Probe]' }];
  f.runtime.formula.save('orders', defs); f.request.state.formulas = F.clone(f.runtime.formula.definitions('orders'));
  const plan = select(f); assert.equal(plan.supported, true); assert.ok(plan.fields.includes('Probe')); assert.ok(plan.fields.includes('__CPX_6A_PROBE'));
  const source = [{ 'Order Code': 'same', Probe: 0, __CPX_6A_PROBE: 999, 'Synthetic extra': 'retained-full' },
    { 'Order Code': 'same', __CPX_6A_PROBE: false, 'Synthetic extra': 'retained-full' }];
  const thin = source.map(row => Object.fromEntries(Object.keys(row).filter(key => plan.fields.includes(key)).map(key => [key,row[key]])));
  const full = F.clone(source); f.runtime.setRows(full); assert.equal(Object.keys(f.runtime.formula.refresh('orders', full).errors).length, 0);
  f.runtime.setRows(thin); assert.equal(Object.keys(f.runtime.formula.refresh('orders', thin).errors).length, 0);
  assert.deepEqual(thin.map(row => row.__f_probe), full.map(row => row.__f_probe)); assert.deepEqual(thin.map(row => row.__f_probe), [0,false]);
  assert.equal(Object.hasOwn(thin[1], 'Probe'), false);
});

test('live formula settings change the finite demand without using earlier row observations', () => {
  const f = F.fixture(api); const empty = select(f); assert.equal(empty.fields.includes('__CPX_6A_PROBE'), false);
  f.request.state.formulas = [{ id: 'toggle', label: 'Toggled', formula: '[Probe]' }]; f.request.planRevision = 'synthetic-enabled';
  const enabled = select(f); assert.ok(enabled.fields.includes('__CPX_6A_PROBE')); assert.equal(enabled.planRevision, 'synthetic-enabled');
  f.request.state.formulas = []; f.request.planRevision = 'synthetic-disabled';
  const disabled = select(f); assert.equal(disabled.fields.includes('__CPX_6A_PROBE'), false); assert.equal(disabled.planRevision, 'synthetic-disabled');
});

test('real lazy IF compile includes both branches rather than two-row observed reads', () => {
  const f = F.fixture(api); f.request.state.formulas = [{ id: 'branch', label: 'Branch', formula: 'IF([Probe], [Order Quantity], [Other])' }];
  const plan = select(f); assert.equal(plan.supported, true);
  for (const key of ['Probe','__CPX_6A_PROBE','Order Quantity','Other']) assert.ok(plan.fields.includes(key));
});

test('formula alias dependency closure uses the actual formula API and preserves own-name alternatives', () => {
  const f = F.fixture(api); f.request.state.formulas = [{ id: 'first', label: 'First', formula: '[Probe]' }, { id: 'second', label: 'Second', formula: '[First]*2' }];
  const plan = select(f); assert.equal(plan.supported, true); assert.ok(plan.fields.includes('First')); assert.ok(plan.fields.includes('__CPX_6A_PROBE'));
});

test('unresolved/model references, invalid functions and cyclic formulas keep exact full fallback', () => {
  for (const formulas of [[{ id: 'unknown', formula: '[UnknownModel]', label: 'Unknown' }],
    [{ id: 'syntax', formula: '[Probe]+', label: 'Bad' }], [{ id: 'call', formula: 'UNKNOWNFUNC([Probe])', label: 'Bad' }],
    [{ id: 'self', formula: '[Self]', label: 'Self' }]]) {
    const f = F.fixture(api); f.request.state.formulas = formulas; assert.equal(select(f), f.full);
  }
});

test('unknown literal filter/sort/raw key or unresolved rule declaration cannot be omitted', () => {
  for (const slot of ['columnKeys','filterKeys','sortKeys']) {
    const f = F.fixture(api); f.request.state[slot] = ['unresolved-key']; assert.equal(select(f), f.full);
  }
});

test('constructor snapshots adapter/manifest declarations instead of following same-revision object mutations', () => {
  const f = F.fixture(api); f.request.producer.rawKeys.push('Injected after constructor');
  f.adapters[0].declare = request => ({ contextKey: request.contextKey, revision: '1', mode: 'finite', enumeration: false,
    tokenFallback: false, rawKeys: ['Injected after constructor'], canonicalIds: [], formulas: null });
  f.manifest.consumers[0].contractIds.length = 0;
  const plan = select(f); assert.equal(plan.supported, true); assert.equal(plan.fields.includes('Injected after constructor'), false);
  assert.ok(plan.contractIds.includes('C01'));
});

test('an adapter cannot mutate request identity while composing an apparently closed plan', () => {
  const f = F.fixture(api); f.adapters[0].declare = request => { request.contextKey = 'changed'; return { contextKey: request.contextKey,
    revision: '1', mode: 'finite', enumeration: false, tokenFallback: false, rawKeys: [], canonicalIds: [], formulas: null }; };
  const compiler = api.createCompiler({ canonical: f.runtime.canonical, formulaEngine: f.runtime.engine, inventory: F.inventory,
    inventoryRef: { pr: 891, head: api.INVENTORY_HEAD }, manifest: f.manifest, adapters: f.adapters });
  assert.equal(compiler.select(f.full, f.request), f.full); assert.equal(f.request.contextKey, 'synthetic-context');
});

test('runtime canonical bindings changing during dependency composition keep the exact full envelope', () => {
  const f = F.fixture(api), previous = f.adapters[0].declare;
  f.adapters[0].declare = request => { f.runtime.canonical.registerModule('orders', { orderCode: { keys: ['Changed after capture'], semantic: 'asasOrder' } }); return previous(request); };
  const compiler = api.createCompiler({ canonical: f.runtime.canonical, formulaEngine: f.runtime.engine, inventory: F.inventory,
    inventoryRef: { pr: 891, head: api.INVENTORY_HEAD }, manifest: f.manifest, adapters: f.adapters });
  assert.equal(compiler.select(f.full, f.request), f.full);
});
