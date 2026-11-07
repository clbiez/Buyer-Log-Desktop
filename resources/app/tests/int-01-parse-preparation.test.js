'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture } = require('../scripts/lib/int-01-fixture');
const { loadHarness } = require('../scripts/lib/int-01-refresh-harness');
const parse = require('../server/lib/parse');
const before = process.env.INT01_STRATEGY === 'before';
const strategy = before ? undefined : require('../scripts/lib/int-01-parse-prototype').createStrategy;

function projection(result) {
  return Object.fromEntries(['partialTargets', 'asasOrders', 'antrepoMap', 'asasOrdersByTarget', 'antrepoMapByTarget',
    'fabricHeaderInfo', 'fabricHeaderInfoByTarget', 'lflRows', 'lflMeta', 'warnings', 'warningDetails', 'scopes', 'appliedHorizons', 'sources']
    .map(key => [key, result[key]]));
}
async function run(separate = false, options = {}, selectedStrategy = strategy) {
  const fixture = createFixture(40, separate);
  const harness = loadHarness(selectedStrategy);
  const result = await harness.refresh.loadFromModelConnections(fixture.items, { ...fixture.options, ...options });
  return { fixture, harness, result };
}

test('INT-01 common scope parses ASAS once for four targets and IAS once for three', async () => {
  const { fixture, harness, result } = await run();
  assert.equal(fixture.transportCalls(), 2);
  assert.equal(harness.events.filter(e => e.kind === 'asas').length, 1);
  assert.equal(harness.events.filter(e => e.kind === 'antrepo').length, 1);
  assert.equal(result.asasOrdersByTarget.priceanalysis.length, 40);
});

test('INT-01 unmodified production and observed baseline agree; candidate preserves full target values', async () => {
  const fixture = createFixture(40);
  const direct = await require('../server/lib/model-refresh').loadFromModelConnections(fixture.items, fixture.options);
  const observed = await run(false, {}, null);
  const candidate = await run();
  assert.deepEqual(projection(observed.result), projection(direct));
  assert.deepEqual(projection(candidate.result), projection(direct));
  for (const target of ['cp', 'orders', 'backlog']) {
    assert.deepEqual(parse.antrepoParseMeta(candidate.result.antrepoMapByTarget[target]), parse.antrepoParseMeta(direct.antrepoMapByTarget[target]));
    assert.equal(Object.getOwnPropertyDescriptor(candidate.result.antrepoMapByTarget[target], '__antrepoMeta').enumerable, false);
  }
});

test('INT-01 separate scope results stay separate, even with the same parser/rule', async () => {
  const candidate = await run(true);
  const baseline = await run(true, {}, null);
  assert.equal(candidate.fixture.transportCalls(), 8);
  assert.equal(candidate.harness.events.filter(e => e.kind === 'asas').length, 4);
  assert.equal(candidate.harness.events.filter(e => e.kind === 'antrepo').length, 3);
  assert.deepEqual(projection(candidate.result), projection(baseline.result));
  assert.notDeepEqual(candidate.result.asasOrdersByTarget.cp, candidate.result.asasOrdersByTarget.orders);
});

test('INT-01 target mutations including Date, nested fields and hidden IAS metadata never cross targets', async () => {
  const { result } = await run();
  const sibling = structuredClone(result.asasOrdersByTarget.orders);
  const cp = result.asasOrdersByTarget.cp;
  assert.ok(cp[0].ex instanceof Date);
  cp[0].ex.setUTCFullYear(1999);
  cp[0]._sourceFields['mutation'] = true;
  cp[0]._matchValues['mutation'] = true;
  cp.push({ mutation: true });
  assert.deepEqual(result.asasOrdersByTarget.orders, sibling);
  result.fabricHeaderInfoByTarget.cp.warnings.push('mutation');
  assert.equal(result.fabricHeaderInfoByTarget.orders.warnings.includes('mutation'), false);
  assert.equal(result.asasOrders, result.asasOrdersByTarget.cp);
  const map = result.antrepoMapByTarget.cp;
  const other = result.antrepoMapByTarget.orders;
  const key = Object.keys(map)[0];
  const expected = structuredClone(other[key]);
  map[key]._sourceFields['mutation'] = true;
  map[key].arr?.setUTCFullYear(1999);
  parse.antrepoParseMeta(map).statusCounts.push(['mutation', 999]);
  assert.deepEqual(other[key], expected);
  assert.equal(parse.antrepoParseMeta(other).statusCounts.some(([name]) => name === 'mutation'), false);
  assert.equal(result.antrepoMap, result.antrepoMapByTarget.cp);
});

test('INT-01 CP-only, omitted LFL target and preset null-LFL semantics remain equal', async () => {
  for (const options of [
    { targets: ['cp'], includeLfl: false },
    { targets: ['cp'], includeLfl: true },
    { targets: ['cp'], includeLfl: false, presetLfl: { rows: [{ sentinel: true }], meta: {} } },
    { targets: ['lfl'], includeAsas: false, includeAntrepo: false },
    { targets: ['lfl'], includeLfl: false, presetLfl: { rows: [], meta: {} } },
  ]) {
    const candidate = await run(false, options);
    const baseline = await run(false, options, null);
    assert.deepEqual(projection(candidate.result), projection(baseline.result));
    if (options.targets[0] === 'cp') {
      assert.equal(candidate.result.lflRows, null);
      assert.equal(candidate.result.lflMeta, null);
    }
  }
});

test('INT-01 new refresh owns a new cache and never returns a previous target mutation', async () => {
  const harness = loadHarness(strategy);
  const fixture = createFixture(40);
  const one = await harness.refresh.loadFromModelConnections(fixture.items, fixture.options);
  one.asasOrdersByTarget.cp[0].model = 'mutation';
  const two = await harness.refresh.loadFromModelConnections(fixture.items, fixture.options);
  assert.notEqual(two.asasOrdersByTarget.cp[0].model, 'mutation');
  assert.equal(harness.events.filter(e => e.kind === 'asas').length, 2);
});

// Bu testler helper'ın anahtar/lifecycle sözleşmesidir; üretime bağlanmaz.
test('INT-01 cache keys include actual run identity, normalized match config and parser version', () => {
  const { createRunCache } = require('../scripts/lib/int-01-parse-prototype');
  let calls = 0;
  const cache = createRunCache((kind, rows, rule) => { calls++; return { kind, rows, rule }; });
  const rows = [{ date: new Date('2026-01-01') }], runA = { rows }, runB = { rows };
  const a = cache('asas', runA, null, 'v1');
  const b = cache('asas', runA, null, 'v1');
  assert.deepEqual(a, b); assert.notEqual(a.rows, b.rows); assert.equal(calls, 1);
  cache('asas', runB, null, 'v1'); assert.equal(calls, 2, 'same rows do not establish same run');
  cache('asas', runA, null, 'v2'); assert.equal(calls, 3);
  cache('antrepo', runA, null, 'v1'); assert.equal(calls, 4);
  const rule = parse.normalizeAntrepoMatchConfig(null);
  cache('asas', runA, rule, 'v1'); assert.equal(calls, 4, 'equivalent normalized rule');
  rule.conditions.pop();
  cache('asas', runA, rule, 'v1'); assert.equal(calls, 5, 'rule mutation changes key');
});

test('INT-01 different actual match rules preserve each parser result without reusing the other rule', () => {
  const { createRunCache } = require('../scripts/lib/int-01-parse-prototype');
  const fixture = createFixture(40);
  let calls = 0;
  const cache = createRunCache((kind, rows, rule) => {
    calls++;
    return (kind === 'asas' ? parse.parseASASRows : parse.parseAntrepoRows)(rows, rule);
  });
  const fullRule = parse.normalizeAntrepoMatchConfig(null);
  const shortRule = structuredClone(fullRule);
  shortRule.conditions.pop();
  for (const kind of ['asas', 'antrepo']) {
    const run = { rows: fixture.source[kind] };
    const parser = kind === 'asas' ? parse.parseASASRows : parse.parseAntrepoRows;
    for (const rule of [fullRule, shortRule]) {
      const actual = cache(kind, run, rule, 'fixture-parser-v1');
      const expected = parser(run.rows, rule);
      assert.deepEqual(actual, expected);
      if (kind === 'antrepo') assert.deepEqual(parse.antrepoParseMeta(actual), parse.antrepoParseMeta(expected));
    }
    assert.notDeepEqual(cache(kind, run, fullRule, 'fixture-parser-v1'), cache(kind, run, shortRule, 'fixture-parser-v1'));
  }
  assert.equal(calls, 4);
});

test('INT-01 clone preserves descriptors, null prototype, Date types and within-target aliases', () => {
  const { createRunCache } = require('../scripts/lib/int-01-parse-prototype');
  const date = new Date('2026-01-01'), graph = Object.create(null);
  graph.a = { date }; graph.b = graph.a; graph.self = graph;
  Object.defineProperty(graph, '__antrepoMeta', { value: { date }, enumerable: false, configurable: true });
  const cache = createRunCache(() => graph), run = { rows: [] };
  const a = cache('antrepo', run, null, 'v1'), b = cache('antrepo', run, null, 'v1');
  assert.equal(Object.getPrototypeOf(a), null); assert.equal(a.a, a.b); assert.equal(a.self, a);
  assert.equal(a.a.date, a.__antrepoMeta.date); assert.notEqual(a.a.date, b.a.date);
  assert.deepEqual(Object.getOwnPropertyDescriptor(a, '__antrepoMeta'), { ...Object.getOwnPropertyDescriptor(graph, '__antrepoMeta'), value: a.__antrepoMeta });
  a.a.date.setUTCFullYear(2000); assert.equal(b.a.date.getUTCFullYear(), 2026);
});

test('INT-01 parser failure is propagated and never cached as a successful result', () => {
  const { createRunCache } = require('../scripts/lib/int-01-parse-prototype');
  let calls = 0;
  const cache = createRunCache(() => { calls++; throw Error('sentinel parser error'); });
  const run = { rows: [] };
  assert.throws(() => cache('asas', run, null, 'v1'), /sentinel parser error/);
  assert.throws(() => cache('asas', run, null, 'v1'), /sentinel parser error/);
  assert.equal(calls, 2);
});
