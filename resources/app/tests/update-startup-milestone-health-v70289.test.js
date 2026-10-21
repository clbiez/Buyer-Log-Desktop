'use strict';
/* Regression for 2026-10-21 field logs:
   7.0.288 LOCAL_DB_READY +23.5s, delayed HTTP +74s, launcher rolls back
   at 60s. Read only actual process-owned, complete startup markers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BackendProcess } = require('../electron/backend');
const root = path.resolve(__dirname, '..');

function harness() {
  const calls = [];
  const backend = new BackendProcess({
    paths: { logsRoot: '/unused' }, appCoreRoot: '/unused',
    onStartupReady: value => calls.push(value),
  });
  backend.child = { pid: 123 }; // no process is actually launched
  backend.exited = false;
  return { backend, calls };
}

test('complete backend server and DB milestones confirm exactly once, including split stream chunks', () => {
  const { backend, calls } = harness();
  backend.observeStartupOutput('[PERF] APP_BOOT_START +1ms\n[PERF] SERVER_RE');
  assert.equal(calls.length, 0);
  backend.observeStartupOutput('ADY +15608ms\r\n[PERF] LOCAL_DB_READY +23510ms\n');
  assert.deepEqual(calls, [{ serverReady: true, localDbReady: true }]);
  backend.observeStartupOutput('[PERF] LOCAL_DB_READY +25000ms\n');
  assert.equal(calls.length, 1);
});

test('do not confirm on only a TCP listener, only a DB, unrelated text, or a dead backend', () => {
  const first = harness();
  first.backend.observeStartupOutput('[PERF] SERVER_READY +15000ms\n');
  assert.equal(first.calls.length, 0);
  first.backend.observeStartupOutput('INFO: [PERF] LOCAL_DB_READY +20000ms\n');
  assert.equal(first.calls.length, 0);
  first.backend.exited = true;
  first.backend.observeStartupOutput('[PERF] LOCAL_DB_READY +23000ms\n');
  assert.equal(first.calls.length, 0);
  const second = harness();
  second.backend.observeStartupOutput('[PERF] LOCAL_DB_READY +23000ms\n');
  assert.equal(second.calls.length, 0);
});

test('watchdog restarting the server invalidates previous partial milestones', () => {
  const { backend, calls } = harness();
  backend.observeStartupOutput('[PERF] SERVER_READY +100ms\n[PERF] APP_BOOT_START +0ms\n[PERF] LOCAL_DB_READY +300ms\n');
  assert.equal(calls.length, 0);
  backend.observeStartupOutput('[PERF] SERVER_READY +900ms\n');
  assert.equal(calls.length, 1);
});

test('the early readiness bridge preserves the existing signed trial confirmation and rollback requirements', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const backend = fs.readFileSync(path.join(root, 'electron', 'backend.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'electron', 'update', 'launcher-state.js'), 'utf8');
  assert.match(main, /onStartupReady: \(\) => \{[\s\S]*?confirmLauncherHealth\(\)/);
  assert.match(backend, /observeStartupOutput\(message\)/);
  assert.match(main, /process\.env\.BUYER_LOG_UPDATE_HEALTH_TOKEN/);
  assert.match(main, /localDbReady: Boolean\(paths && paths\.localDbPath && fs\.existsSync\(paths\.localDbPath\)\)/);
  assert.match(launcher, /trial\.token !== expectedToken/);
  assert.match(launcher, /info\.backendReady!==true\|\|info\.rendererReady!==true\|\|info\.localDbReady!==true/);
  assert.match(launcher, /restoreLocalDb\(activation\.dbSnapshot\)/);
});
