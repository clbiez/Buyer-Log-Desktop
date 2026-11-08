'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { PowerBiImportDashboardConnector, createDashboardCheckpointStore,
  createDashboardRefreshManifest, applyDashboardBatchResult, assertDashboardManifestComplete } = require('../server/lib/power-bi-import-dashboard');
const { createFixture, identity, assertEquivalent } = require('../scripts/lib/powerbi-checkpoint-fixture');
const { createHash } = require('node:crypto');

const helper = path.join(__dirname, 'helpers/powerbi-checkpoint-process.cjs');

test('INT-06 repeated batch/state transitions never double count terminal orders', () => {
  const manifest = createDashboardRefreshManifest(['A', 'B', 'C']);
  for (const patch of [
    { rows: [{ 'Sipariş Kod': 'A' }], counts: [1, 0, 0] },
    { rows: [{ 'Sipariş Kod': 'A' }], counts: [1, 0, 0] },
    { error: Error('synthetic failure'), counts: [0, 0, 1] },
    { rows: [], counts: [0, 1, 0] },
    { rows: [{ 'Sipariş Kod': 'A' }], counts: [1, 0, 0] },
  ]) {
    applyDashboardBatchResult(manifest, ['A', 'A'], patch.rows, patch.error);
    assert.equal(manifest.processedOrders, 1);
    assert.deepEqual([manifest.successfulOrders, manifest.notFoundOrders, manifest.failedOrders], patch.counts);
    assert.deepEqual(manifest.failedOrderCodes, patch.error ? ['A'] : []);
  }
  applyDashboardBatchResult(manifest, ['B', 'C'], [{ 'Sipariş Kod': 'B' }]);
  assert.equal(assertDashboardManifestComplete(manifest).processedOrders, 3);
  assert.deepEqual({ ...manifest.orderStates }, { A: 'SUCCESS', B: 'SUCCESS', C: 'NOT_FOUND' });
});

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function subprocess(config) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = fork(helper, [JSON.stringify(config)], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = '', boundary = null;
    child.stdout.resume(); child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(Error(`INT-06 subprocess timeout: ${stderr}`)); }, 15000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('message', message => {
      if (message.type === 'durable-boundary') { boundary = message.checkpoints; child.kill('SIGKILL'); }
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (config.killAt) {
        try { assert.equal(boundary, config.killAt, stderr); assert.equal(signal, 'SIGKILL'); resolve({ boundary }); }
        catch (error) { reject(error); }
      } else if (code !== 0) reject(Error(`INT-06 child exit ${code}/${signal}: ${stderr}`));
      else resolve(JSON.parse(fs.readFileSync(path.join(config.root, 'result.json'), 'utf8')));
    });
  });
}

for (const scenario of ['steady', 'split-retry']) {
  test(`INT-06 ${scenario}: kill and disk-only resume at EVERY committed batch boundary`, async t => {
    const fixture = createFixture({ orders: 12, batchSize: 4, scenario });
    const config = { orders: 12, batchSize: 4, scenario };
    const baseline = await subprocess({ ...config, root: temp(t) });
    assertEquivalent(baseline.result, fixture.expected);
    // Fixed 12-order fixture: 3 normal batches, or 5 two-order leaves plus
    // one FAILED singleton and its SUCCESS sibling. Do not derive the matrix
    // length only from the implementation's observed checkpoint frequency.
    assert.equal(baseline.checkpoints, scenario === 'steady' ? 3 : 7);
    t.diagnostic(`${scenario}: SIGKILL/resume checked at all ${baseline.checkpoints} committed boundaries`);
    if (scenario === 'split-retry') {
      assert.ok(baseline.stats.splitRejections > 0);
      assert.ok(baseline.stats.transientFailures > 0);
      assert.ok(baseline.stats.terminalFailures > 0);
    }
    for (let boundary = 1; boundary <= baseline.checkpoints; boundary += 1) {
      const root = temp(t);
      await subprocess({ ...config, root, killAt: boundary });
      const saved = createDashboardCheckpointStore({ root, userId: 'synthetic' }).load();
      assert.ok(saved, `disk checkpoint ${boundary}`);
      assert.equal(saved.processedOrders, Object.keys(saved.orderStates).length);
      assert.equal(saved.processedOrders, saved.successfulOrders + saved.notFoundOrders + saved.failedOrders);
      const resumed = await subprocess({ ...config, root });
      assertEquivalent(resumed.result, fixture.expected);
      assert.deepEqual(resumed.result.rows, baseline.result.rows);
      assert.ok(resumed.queriedCodes.every(code => !saved.orderStates[identity(code)]),
        `boundary ${boundary}: terminal SUCCESS/NOT_FOUND/FAILED must never be queried again`);
      if (boundary === baseline.checkpoints) assert.equal(resumed.queriedCodes.length, 0);
    }
  });

  test(`INT-06 ${scenario}: repeated crashes in one refresh preserve every prior durable batch`, async t => {
    const config = { orders: 12, batchSize: 4, scenario }, root = temp(t);
    const fixture = createFixture(config);
    let previousCount = 0;
    for (let index = 0; index < (scenario === 'steady' ? 3 : 7); index += 1) {
      await subprocess({ ...config, root, killAt: 1 });
      const saved = createDashboardCheckpointStore({ root, userId: 'synthetic' }).load();
      assert.ok(saved.processedOrders > previousCount, 'each new process commits another batch');
      const states = fixture.expected.orderStates;
      for (const [code, state] of Object.entries(saved.orderStates)) assert.equal(state, states[code]);
      assert.deepEqual(saved.rows, fixture.expected.rows.filter(row => saved.orderStates[identity(row['Sipariş Kod'])]));
      previousCount = saved.processedOrders;
    }
    const resumed = await subprocess({ ...config, root });
    assert.equal(resumed.queriedCodes.length, 0, 'last durable batch completes the same refresh');
    assertEquivalent(resumed.result, fixture.expected);
  });
}

test('INT-06 cancellation before query and between split batches persists then resumes identically', async t => {
  const config = { orders: 12, batchSize: 4, scenario: 'split-retry' };
  const fixture = createFixture(config);
  for (const cancellation of [{ cancelBefore: true }, { cancelAt: 1 }, { cancelAt: 3 }]) {
    const root = temp(t);
    const stopped = await subprocess({ ...config, root, ...cancellation });
    assert.equal(stopped.result.ok, false);
    assert.equal(stopped.result.stopped, true);
    if (cancellation.cancelBefore) assert.equal(stopped.queriedCodes.length, 0);
    const saved = createDashboardCheckpointStore({ root, userId: 'synthetic' }).load();
    assert.equal(saved.retryPending, 0);
    const resumed = await subprocess({ ...config, root });
    assertEquivalent(resumed.result, fixture.expected);
    assert.ok(resumed.queriedCodes.every(code => !saved.orderStates[identity(code)]));
  }
});

test('INT-06 cancellation inside query/retry never marks unfinished orders terminal', async t => {
  for (const duringRetry of [false, true]) {
    const root = temp(t), fixture = createFixture({ orders: 12, batchSize: 4 });
    const controller = new AbortController(), transport = fixture.transport();
    let calls = 0;
    transport.queryBatch = async () => {
      calls += 1;
      if (duringRetry) {
        setImmediate(() => controller.abort());
        throw Error('synthetic retry wait');
      }
      controller.abort();
      throw Object.assign(Error('cancelled in transport'), { code: 'POWERBI_DASHBOARD_CANCELLED' });
    };
    const store = createDashboardCheckpointStore({ root, userId: 'synthetic' });
    const connector = new PowerBiImportDashboardConnector({ transport, batchSize: 4, maxRetries: 1, backoffMs: 20 });
    const result = await connector.refresh({ orderCodes: fixture.orderCodes, signal: controller.signal, checkpoint: value => store.save(value) });
    assert.equal(result.stopped, true);
    assert.equal(calls, 1);
    assert.equal(store.load().processedOrders, 0);
    assert.deepEqual(store.load().rows, []);
    assertEquivalent((await subprocess({ orders: 12, batchSize: 4, scenario: 'steady', root })).result, fixture.expected);
  }
});

test('INT-06 frozen schema-v1 checkpoint resumes all three terminal states without reinterpretation', async t => {
  const root = temp(t), fixture = createFixture({ orders: 12, batchSize: 4, scenario: 'split-retry' });
  const store = createDashboardCheckpointStore({ root, userId: 'synthetic' });
  const frozenFile = path.join(__dirname, 'fixtures/powerbi-checkpoint-v1.json');
  assert.equal(createHash('sha256').update(fs.readFileSync(frozenFile)).digest('hex'),
    '8cb6fc65977e761d6ba75c3f7958dfa22d59ef8bab2fe16690e5c1b58a2c4840', 'v1 fixture must remain frozen');
  fs.copyFileSync(frozenFile, store.file);
  const saved = store.load();
  assert.equal(saved.schemaVersion, 1);
  assert.deepEqual([saved.successfulOrders, saved.notFoundOrders, saved.failedOrders], [8, 2, 1]);
  const resumed = await subprocess({ orders: 12, batchSize: 4, scenario: 'split-retry', root });
  assertEquivalent(resumed.result, fixture.expected);
  assert.deepEqual(resumed.queriedCodes, ['SYN-0000012']);
});
