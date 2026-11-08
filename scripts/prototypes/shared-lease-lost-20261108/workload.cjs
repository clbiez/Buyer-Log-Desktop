'use strict';
// Independent synthetic diagnostic workload; does not import/rebuild #900.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const CLOCK = Date.parse('2026-11-08T00:00:00Z');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function item(index, writer = 'single') {
  return { eventId: `diag-${writer}-${index}`, id: `diag:${writer}:${Math.floor(index / 4)}`,
    at: new Date(CLOCK + index * 1000).toISOString(), origin: 'synthetic-lease-diagnostic',
    patch: { kind: 'diagnostic', writer, index, quantity: index % 997,
      note: 'Synthetic evidence only; no business or customer data. '.repeat(6) } };
}
function inspect(state, ranges) {
  const ids = [...Object.keys(state.events), ...Object.keys(state.syncLedger.eventIds)].sort();
  const expectedIds = ranges.flatMap(({ writer, count }) => Array.from({ length: count }, (_, i) => item(i, writer).eventId)).sort();
  assert.deepEqual(ids, expectedIds, 'all and only accepted event IDs must reopen');
  const expectedRecords = new Map();
  for (const { writer, count } of ranges) for (let i = 0; i < count; i++) {
    const e = item(i, writer); expectedRecords.set(e.id, e.patch);
  }
  assert.equal(Object.keys(state.records).length, expectedRecords.size);
  for (const [id, patch] of expectedRecords) {
    const actual = Object.fromEntries(Object.entries(state.records[id]).filter(([key]) => !key.startsWith('_')));
    assert.deepEqual(actual, patch, id);
  }
  const expectedCount = expectedIds.length;
  assert.equal(state.localSequence, expectedCount);
  return { records: expectedRecords.size, acceptedEvents: expectedCount, sequence: state.localSequence,
    eventIdsHash: hash(ids), businessHash: hash([...expectedRecords].sort(([a], [b]) => a.localeCompare(b))),
    events: Object.keys(state.events).length, ledger: Object.keys(state.syncLedger.eventIds).length,
    pending: state.journal.filter(e => !e.uploaded).length, allExpectedValuesChecked: true };
}
module.exports = { CLOCK, item, inspect, hash };
