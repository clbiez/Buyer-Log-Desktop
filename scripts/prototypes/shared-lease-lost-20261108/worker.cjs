'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CLOCK, item, inspect } = require('./workload.cjs');
const config = JSON.parse(process.argv[2]);
const events = [];
const record = (event, detail = {}) => events.push({ ns: process.hrtime.bigint().toString(),
  wall: new Date().toISOString(), pid: process.pid, event, ...detail });
function save() { fs.writeFileSync(config.timeline, events.map(e => JSON.stringify(e)).join('\n') + '\n'); }
async function main() {
  record('runtime', { versions: process.versions, config });
  if (config.trace) require('./trace.cjs').install(record, config);
  const { createLocalDb } = require('../../../resources/app/server/lib/local-db');
  const db = createLocalDb(config.file, { clock: () => CLOCK }); // Production defaults, including lease and WAL.
  if (config.mode === 'verify') {
    record('reopen:start');
    const state = await db.read();
    const result = inspect(state, config.ranges);
    record('reopen:verified', result);
    fs.writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
    return;
  }
  record('api:start', { method: 'ensure' }); await db.ensure(); record('api:ack', { method: 'ensure' });
  record('api:start', { method: 'initialize' });
  await db.transaction(state => { state.deviceId = 'synthetic-lease-diagnostic'; });
  record('api:ack', { method: 'initialize' });
  for (let first = 0; first < config.size; first += 10000) {
    const count = Math.min(10000, config.size - first);
    const batch = Array.from({ length: count }, (_, i) => item(first + i));
    record('api:start', { method: 'queuePatches', first, count });
    const result = await db.queuePatches(batch);
    assert.equal(result.count, count);
    assert.equal(result.results.length, count);
    for (let i = 0; i < count; i++) {
      assert.equal(result.results[i].eventId, batch[i].eventId);
      assert.equal(result.results[i].duplicate, false);
      assert.equal(result.results[i].localSequence, first + i + 1);
    }
    record('api:ack', { method: 'queuePatches', first, count });
    console.log(JSON.stringify({ progress: first + count, size: config.size }));
  }
  record('api:start', { method: 'markSynced' });
  await db.markSynced(Array.from({ length: Math.floor(config.size * .8) }, (_, i) => item(i).eventId));
  record('api:ack', { method: 'markSynced' });
  const before = inspect(await db.read(), [{ writer: 'single', count: config.size }]);
  record('api:start', { method: 'compact' }); const compact = await db.compact(); record('api:ack', { method: 'compact' });
  const after = inspect(await db.read(), [{ writer: 'single', count: config.size }]);
  assert.equal(before.businessHash, after.businessHash);
  assert.equal(before.eventIdsHash, after.eventIdsHash);
  const result = { before, after, compacted: compact.compacted, versions: process.versions,
    maxRssBytes: process.resourceUsage().maxRSS * 1024 };
  fs.writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
  record('run:passed', result);
}
main().then(save).catch(error => {
  record('run:failed', { code: error.code, message: error.message, stack: error.stack });
  save(); console.error(error.stack); process.exitCode = 1;
});
