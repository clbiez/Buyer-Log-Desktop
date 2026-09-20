'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const modelQuery = require('../server/lib/modelQuery');
const modelRefresh = require('../server/lib/model-refresh');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('model query cancellation reaches the active runner and rejects as REFRESH_CANCELLED', async () => {
  const controller = new AbortController();
  let receivedSignal = null;
  const pending = modelQuery.runModelQuery({
    server: 'LOCALHOST', catalog: 'MODEL', query: 'EVALUATE ROW("x", 1)',
  }, {
    signal: controller.signal,
    runner: (_args, _timeout, options = {}) => new Promise((_resolve, reject) => {
      receivedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })), { once:true });
    }),
  });
  controller.abort();
  await assert.rejects(pending, error => error && error.code === 'REFRESH_CANCELLED');
  assert.equal(receivedSignal, controller.signal);
});

test('large CSV parsing yields to the event loop and preserves every row', async () => {
  const lines = ['id;name'];
  for (let index = 0; index < 6000; index++) lines.push(`${index};MODEL-${index}`);
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const result = await modelQuery.parseSemicolonCsvAsync(lines.join('\n'), { yieldEvery:250 });
  assert.equal(yielded, true);
  assert.equal(result.rows.length, 6000);
  assert.deepEqual(result.rows[5999], { id:'5999', name:'MODEL-5999' });
  assert.ok(result.uiBlockingMs >= 0);
});

test('large CSV parsing observes cancellation between chunks', async () => {
  const lines = ['id;name'];
  for (let index = 0; index < 20000; index++) lines.push(`${index};MODEL-${index}`);
  const controller = new AbortController();
  setImmediate(() => controller.abort());
  await assert.rejects(
    modelQuery.parseSemicolonCsvAsync(lines.join('\n'), { yieldEvery:100, signal:controller.signal }),
    error => error && error.code === 'REFRESH_CANCELLED',
  );
});

test('independent model scopes use bounded concurrency', async () => {
  let active = 0, peak = 0;
  const result = await modelRefresh.mapWithConcurrency([1, 2, 3, 4], 2, async value => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8]);
  assert.equal(peak, 2);
});

test('background refresh stages data and only publishes after the final cancellation gate', () => {
  assert.match(SERVER, /loadFromModels\(id, targets, \{[\s\S]{0,240}?deferPublish:\s*true/);
  assert.match(SERVER, /throwIfRefreshCancelled\(\);[\s\S]{0,180}?publishRefreshedRuntime\(id, staged/);
  assert.match(SERVER, /function publishRefreshedRuntime|async function publishRefreshedRuntime/);
  assert.match(SERVER, /job\.controller\.abort\(\)/);
  assert.match(SERVER, /commitStarted/);
  assert.match(SERVER, /metrics:\s*job\.metrics/);
  assert.match(SERVER, /localDbWriteMs/);
  assert.match(SERVER, /localSnapshotWriteMs/);
});

test('local store remains versioned atomic JSON; SQLite-only tuning is not fabricated', () => {
  const localDb = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'local-db.js'), 'utf8');
  const recovery = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'durable-file-recovery.js'), 'utf8');
  assert.match(localDb, /dependency-free[\s\S]{0,20}JSON envelope/);
  assert.match(localDb, /createDurableFileRecovery/);
  assert.match(localDb, /\.buyerlog-db-recovery/);
  assert.match(recovery, /\.tmp/);
  assert.match(recovery, /replaceTarget/);
  assert.match(recovery, /Durable target verification failed/);
  assert.doesNotMatch(localDb, /PRAGMA\s+(?:journal_mode|busy_timeout|synchronous)/i);
});
