'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./projection-shadow-fixture.cjs');

// These are ordinary JSON view values, not the separate nine-cache null-value profile.
const cases = [
  { name: 'own zero cannot become false', view: { Probe: 0 }, full: { Probe: false, extra: 'full' } },
  { name: 'an own present false field cannot disappear', view: { Probe: false }, full: { extra: 'full' } },
  { name: 'a retained custom nested value cannot change', view: { custom: { value: false, zero: 0 } }, full: { custom: { value: 0, zero: 0 }, extra: 'full' } },
  { name: 'known real absence cannot become present null', view: { Probe: 0 }, absent: ['realMissing'], full: { Probe: 0, realMissing: null, extra: 'full' } },
];
for (const item of cases) test('RED candidate: same-context detail compatibility — ' + item.name, async () => {
  const { session, state } = fixture({ count: 1, viewRows: [item.view], fullRows: [item.full], absentKeys: [item.absent || []] });
  // Context, ordinal, opaque handle and complete:true all match. Only actual view data contradicts the detail.
  await assert.rejects(session.requireFull([0]), error => error?.code === 'VIEW_DETAIL_MISMATCH');
  assert.equal(state.prepareCalls, 0, 'contradictory details must be rejected before normalizer/pricing hooks');
  assert.equal(session.completeness(0).state, 'view', 'no contradictory complete record may publish');
  assert.deepEqual(session.viewRows[0], item.view, 'existing private view remains untouched');
});
