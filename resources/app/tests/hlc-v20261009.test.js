'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHlc, compare, serialize, parse } = require('../server/lib/hlc');

test('local ticks advance physical time and logical time during clock rollback', () => {
  let physical = 1000;
  const clock = createHlc({ node: 'a', now: () => physical });
  const first = clock.tick();
  assert.deepEqual(first, { wallMs: 1000, counter: 0, node: 'a' });
  assert.deepEqual(clock.tick(), { wallMs: 1000, counter: 1, node: 'a' });
  physical = 500;
  const rollback = clock.tick();
  assert.deepEqual(rollback, { wallMs: 1000, counter: 2, node: 'a' });
  assert.ok(compare(rollback, first) > 0);
  physical = 1200;
  assert.deepEqual(clock.tick(), { wallMs: 1200, counter: 0, node: 'a' });
});

test('receive follows all physical/local/remote maximum clock cases', () => {
  const cases = [
    { physical: 2000, local: [1000, 9], remote: [1500, 12], expected: [2000, 0] },
    { physical: 500, local: [1000, 9], remote: [900, 12], expected: [1000, 10] },
    { physical: 500, local: [1000, 9], remote: [1100, 12], expected: [1100, 13] },
    { physical: 500, local: [1000, 9], remote: [1000, 12], expected: [1000, 13] },
    { physical: 1000, local: [1000, 12], remote: [1000, 9], expected: [1000, 13] },
  ];
  for (const item of cases) {
    const local = { wallMs: item.local[0], counter: item.local[1], node: 'a' };
    const remote = { wallMs: item.remote[0], counter: item.remote[1], node: 'b' };
    const clock = createHlc({ node: 'a', now: () => item.physical, state: local });
    const received = clock.receive(remote);
    assert.deepEqual(received, { wallMs: item.expected[0], counter: item.expected[1], node: 'a' });
    assert.ok(compare(received, local) > 0);
    assert.ok(compare(received, remote) > 0);
  }
});

test('same wall and counter use deterministic node order independent of locale', () => {
  const nodes = ['a', 'a:clone', 'b', 'İ', 'ı', '\ud83d\ude00', '\uffff'];
  const stamps = nodes.map(node => ({ wallMs: 1234, counter: 5, node }));
  for (const left of stamps) for (const right of stamps) {
    const expected = left.node < right.node ? -1 : left.node > right.node ? 1 : 0;
    assert.equal(compare(left, right), expected);
    assert.equal(Math.sign(compare(left, right)), -Math.sign(compare(right, left)) || 0);
  }
});

test('serialization roundtrips and lexical ordering exactly matches stamp ordering', () => {
  const stamps = [
    { wallMs: 0, counter: 0, node: 'a' },
    { wallMs: 9, counter: 99, node: 'z' },
    { wallMs: 10, counter: 0, node: 'a' },
    { wallMs: 10, counter: 1, node: 'a' },
    { wallMs: 10, counter: 1, node: 'a:clone' },
    { wallMs: 10, counter: 1, node: 'ı' },
    { wallMs: 10, counter: 1, node: '\ud83d\ude00' },
    { wallMs: 10, counter: 1, node: '\uffff' },
    { wallMs: Number.MAX_SAFE_INTEGER, counter: Number.MAX_SAFE_INTEGER, node: 'a' },
  ];
  for (const stamp of stamps) assert.deepEqual(parse(serialize(stamp)), stamp);
  assert.deepEqual(stamps.map(serialize).sort().map(parse), [...stamps].sort(compare));
  for (const left of stamps) for (const right of stamps) {
    const a = serialize(left), b = serialize(right);
    assert.equal(a < b ? -1 : a > b ? 1 : 0, compare(left, right));
    assert.equal(compare(a, b), compare(left, right));
  }
});

test('persisted state resumes monotonically even with a lower physical clock or new device node', () => {
  const first = createHlc({ node: 'old', now: () => 5000 });
  first.tick(); first.tick();
  const persisted = first.state();
  const restored = createHlc({ node: 'new', now: () => 1000, state: persisted });
  const next = restored.tick();
  assert.ok(compare(next, persisted) > 0);
  assert.deepEqual(next, { wallMs: 5000, counter: 2, node: 'new' });
  const textRestored = createHlc({ node: 'old', now: () => 1000, state: serialize(persisted) });
  assert.ok(compare(textRestored.tick(), persisted) > 0);
});

test('far-future remote stamps are accepted and emit a trace without rejecting on callback failure', () => {
  const traces = [];
  const clock = createHlc({ node: 'a', now: () => 1000, onSkew: trace => traces.push(trace) });
  const remote = { wallMs: 1000 + 5 * 60 * 1000 + 1, counter: 8, node: 'b' };
  const received = clock.receive(remote);
  assert.ok(compare(received, remote) > 0);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].code, 'SYNC_HLC_CLOCK_SKEW');
  assert.equal(traces[0].skewMs, 5 * 60 * 1000 + 1);
  assert.equal(traces[0].localWallMs, 1000);
  assert.deepEqual(traces[0].remote, remote);
  const failingTrace = createHlc({ node: 'a', now: () => 1000, onSkew() { throw new Error('trace unavailable'); } });
  assert.ok(compare(failingTrace.receive(serialize(remote)), remote) > 0);
});

test('exactly five minutes ahead does not emit a skew trace', () => {
  let traces = 0;
  const clock = createHlc({ node: 'a', now: () => 1000, onSkew: () => traces++ });
  clock.receive({ wallMs: 301000, counter: 0, node: 'b' });
  assert.equal(traces, 0);
});

test('returned snapshots and remote inputs cannot mutate the live clock', () => {
  const clock = createHlc({ node: 'a', now: () => 1000 });
  const tick = clock.tick(); tick.counter = 999;
  const snapshot = clock.state(); snapshot.wallMs = 0;
  const remote = { wallMs: 1100, counter: 3, node: 'b' };
  const before = { ...remote };
  clock.receive(remote);
  assert.deepEqual(remote, before);
  remote.counter = 999;
  assert.deepEqual(clock.state(), { wallMs: 1100, counter: 4, node: 'a' });
});

test('overflow advances the representable wall clock and exhausted clocks fail without state mutation', () => {
  const clock = createHlc({ node: 'a', now: () => 0, state: { wallMs: 1000, counter: Number.MAX_SAFE_INTEGER, node: 'a' } });
  assert.deepEqual(clock.tick(), { wallMs: 1001, counter: 0, node: 'a' });
  const exhausted = { wallMs: Number.MAX_SAFE_INTEGER, counter: Number.MAX_SAFE_INTEGER, node: 'a' };
  const terminal = createHlc({ node: 'a', now: () => 0, state: exhausted });
  assert.throws(() => terminal.tick(), /exhausted/i);
  assert.deepEqual(terminal.state(), exhausted);
});

test('invalid stamps, serialized forms and physical clocks are rejected', () => {
  for (const stamp of [null, {}, { wallMs: -1, counter: 0, node: 'a' }, { wallMs: 1.5, counter: 0, node: 'a' }, { wallMs: 1, counter: Infinity, node: 'a' }, { wallMs: 1, counter: 0, node: '' }]) {
    assert.throws(() => serialize(stamp));
  }
  for (const serialized of ['', '2026-10-09', '1-0-a', 'ffffffffffffffff-0000000000000000-0061', '0000000000000001-0000000000000000-z']) assert.throws(() => parse(serialized));
  assert.throws(() => createHlc({ node: '' }));
  assert.throws(() => createHlc({ node: 'a', now: () => NaN }).tick());
});

test('two devices preserve causal ordering despite opposite ten-minute clock shifts', () => {
  const base = 1700000000000;
  const a = createHlc({ node: 'a', now: () => base - 10 * 60 * 1000 });
  const b = createHlc({ node: 'b', now: () => base + 10 * 60 * 1000 });
  const first = a.tick();
  const second = b.receive(first);
  const third = b.tick();
  const fourth = a.receive(third);
  const fifth = a.tick();
  for (const [left, right] of [[first, second], [second, third], [third, fourth], [fourth, fifth]]) assert.ok(compare(left, right) < 0);
});
