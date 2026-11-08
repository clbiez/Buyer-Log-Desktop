'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { createHash } = require('node:crypto');
const { openCheckpointJournal, readLegacyCheckpoint } = require('../server/lib/power-bi-checkpoint-journal');
const { createDashboardCheckpointStore } = require('../server/lib/power-bi-import-dashboard');
const { refresh } = require('./fixtures/int06-checkpoint-journal/adapter.cjs');
const { createFixture, assertEquivalent, identity } = require('./fixtures/int06-checkpoint-journal/inherited/resources/app/scripts/lib/powerbi-checkpoint-fixture.js.source');
const fixtureDir = path.join(__dirname, 'fixtures/int06-checkpoint-journal');
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-crash-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function subprocess(config) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(fixtureDir, 'process.cjs'), [JSON.stringify(config)], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = '', boundary;
    child.stdout.resume(); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`INT-06 subprocess timeout: ${stderr}`)); }, 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('message', message => { boundary = message; child.kill('SIGKILL'); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      try {
        if (config.killAt || config.killPhase) {
          assert.equal(signal, 'SIGKILL', stderr); assert.ok(boundary, stderr);
          if (config.killAt) { assert.equal(boundary.checkpoints, config.killAt); assert.equal(boundary.ack.durable, true); }
          if (config.killPhase) assert.equal(boundary.phase, config.killPhase);
          resolve(boundary);
        } else {
          assert.equal(code, 0, stderr);
          resolve(JSON.parse(fs.readFileSync(path.join(config.root, 'result.json'), 'utf8')));
        }
      } catch (error) { reject(error); }
    });
  });
}
const asResult = saved => ({ ok: true, stopped: false, manifest: saved, rows: saved.rows });

for (const scenario of ['steady', 'split-retry']) {
  test(`INT-06 journal ${scenario}: SIGKILL at EVERY ACK and repeated disk-only continuation`, async t => {
    const config = { orders: 12, batchSize: 4, scenario }, fixture = createFixture(config);
    const baseline = await subprocess({ ...config, root: temp(t) });
    const boundaries = scenario === 'steady' ? 3 : 7;
    assert.equal(baseline.checkpoints, boundaries);
    assertEquivalent(baseline.result, fixture.expected);
    assertEquivalent(asResult(baseline.saved), fixture.expected);
    for (let killAt = 1; killAt <= boundaries; killAt += 1) {
      const root = temp(t);
      await subprocess({ ...config, root, killAt });
      const saved = openCheckpointJournal({ root: path.join(root, 'checkpoint') }).materialize();
      const resumed = await subprocess({ ...config, root });
      assertEquivalent(resumed.result, fixture.expected);
      assertEquivalent(asResult(resumed.saved), fixture.expected);
      assert.ok(resumed.queriedCodes.every(code => !saved.orderStates[identity(code)]));
    }
    const root = temp(t);
    let previous = 0;
    for (let i = 0; i < boundaries; i += 1) {
      await subprocess({ ...config, root, killAt: 1 });
      const saved = openCheckpointJournal({ root: path.join(root, 'checkpoint') }).materialize();
      assert.ok(saved.processedOrders > previous); previous = saved.processedOrders;
    }
    const final = await subprocess({ ...config, root });
    assert.deepEqual(final.queriedCodes, []);
    assertEquivalent(asResult(final.saved), fixture.expected);
  });
}

test('INT-06 real SIGKILL during append, snapshot write/rename and journal retirement', async t => {
  const config = { orders: 12, batchSize: 4, scenario: 'split-retry', snapshotEvery: 2 }, fixture = createFixture(config);
  for (const killPhase of ['journal:written', 'journal:durable', 'commit:applied',
    'snapshot:written', 'snapshot:synced', 'snapshot:renamed', 'snapshot:durable',
    'retirement:written', 'retirement:synced', 'retirement:renamed', 'retirement:durable']) {
    const root = temp(t);
    await subprocess({ ...config, root, killPhase });
    const resumed = await subprocess({ ...config, root });
    assertEquivalent(resumed.result, fixture.expected);
    assertEquivalent(asResult(resumed.saved), fixture.expected);
    t.diagnostic(`SIGKILL/resume ${killPhase}: complete oracle parity`);
  }
});

test('INT-06 journal cancellation and frozen v1 migration/export preserve full oracle', async t => {
  const config = { orders: 12, batchSize: 4, scenario: 'split-retry' }, fixture = createFixture(config);
  for (const cancellation of [{ cancelBefore: true }, { cancelAt: 1 }, { cancelAt: 3 },
    { cancelDuring: 'query' }, { cancelDuring: 'retry' }]) {
    const root = temp(t);
    const stopped = await refresh({ ...config, root, ...cancellation });
    assert.equal(stopped.result.stopped, true); assert.equal(stopped.saved.retryPending, 0);
    if (cancellation.cancelDuring) assert.equal(stopped.saved.processedOrders, 0);
    assertEquivalent((await refresh({ ...config, root })).result, fixture.expected);
  }
  const root = temp(t), legacyFile = path.join(root, 'old.json');
  const frozen = fs.readFileSync(path.join(fixtureDir, 'inherited/resources/app/tests/fixtures/powerbi-checkpoint-v1.json.source'));
  assert.equal(createHash('sha256').update(frozen).digest('hex'), '8cb6fc65977e761d6ba75c3f7958dfa22d59ef8bab2fe16690e5c1b58a2c4840');
  fs.writeFileSync(legacyFile, frozen);
  const migrated = await refresh({ ...config, root, legacyFile });
  assertEquivalent(migrated.result, fixture.expected);
  assert.deepEqual(migrated.queriedCodes, ['SYN-0000012']);
  assert.deepEqual(fs.readFileSync(legacyFile), frozen, 'migration never overwrites old checkpoint');
  const journal = openCheckpointJournal({ root: path.join(root, 'checkpoint') });
  const oldStore = createDashboardCheckpointStore({ root, userId: 'rollback' });
  journal.exportLegacy(oldStore.file);
  assertEquivalent(asResult(oldStore.load()), fixture.expected);
  assertEquivalent(asResult(readLegacyCheckpoint(oldStore.file)), fixture.expected);
  fs.writeFileSync(path.join(root, 'checkpoint/snapshot.json'), '{"format":999}');
  assert.throws(() => openCheckpointJournal({ root: path.join(root, 'checkpoint'), legacyFile }), { code: 'CHECKPOINT_CORRUPT' });
});
