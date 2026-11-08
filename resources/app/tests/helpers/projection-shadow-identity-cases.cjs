'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, deferred, nextTurn } = require('./projection-shadow-fixture.cjs');

test('RED candidate: concurrent same-context hydration preserves the first published full-record identity', async () => {
  const firstHookEntered = deferred(), releaseFirstHook = deferred();
  const { session } = fixture({ count: 1, prepareFull: async (rows, context, call) => {
    if (call === 1) { firstHookEntered.resolve(); await releaseFirstHook.promise; }
  } });
  const first = session.requireFull([0]); await firstHookEntered.promise;
  let earlySecond = null;
  const second = session.requireFull([0]).then(result => { earlySecond = result.rows[0]; return result; });
  // v1 allows the second private preparation to publish while the first hook waits.
  // A future implementation may share preparation instead; this test permits that strategy too.
  await nextTurn(); const alreadyReturned = earlySecond; releaseFirstHook.resolve();
  const [one, two] = await Promise.all([first, second]), retained = await session.requireFull([0]);
  assert.strictEqual(one.rows[0], two.rows[0], 'both concurrent callers must receive the single published identity');
  assert.strictEqual(retained.rows[0], one.rows[0], 'subsequent hydration must retain that identity');
  if (alreadyReturned) assert.strictEqual(retained.rows[0], alreadyReturned, 'a later-finishing hook cannot orphan an earlier returned record');
  one.assertCurrent(); two.assertCurrent(); retained.assertCurrent();
});
