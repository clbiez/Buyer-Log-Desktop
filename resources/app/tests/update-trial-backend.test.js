'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Fence = require('../server/lib/update-trial-backend');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-trial-fence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: { BUYER_LOG_LOCAL_DATA_ROOT: root, BUYER_LOG_UPDATE_HEALTH_TOKEN: 'synthetic-trial' } };
}
test('ordinary server startup needs no trial ledger', () => {
  assert.equal(Fence.waitForTrialBackend({ env: {} }), false);
  assert.equal(Fence.registerTrialBackend(123, {}), false);
});
test('trial writer can start only with its exact durable token, parent and child PIDs', t => {
  const f = fixture(t);
  assert.equal(Fence.registerTrialBackend(123, f.env), true);
  assert.equal(Fence.waitForTrialBackend({ env: f.env, pid: 123, parentPid: process.pid, timeoutMs: 20 }), true);
  assert.throws(() => Fence.waitForTrialBackend({ env: f.env, pid: 456, parentPid: process.pid, timeoutMs: 20 }), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' });
  assert.throws(() => Fence.waitForTrialBackend({ env: f.env, pid: 123, parentPid: 456, timeoutMs: 20 }), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' });
});
test('missing, corrupt and token-mismatched ledgers fail before the server may open data', t => {
  const f = fixture(t);
  assert.throws(() => Fence.waitForTrialBackend({ env: f.env, timeoutMs: 20 }), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' });
  const file = Fence.ledgerFile(f.root, 'synthetic-trial'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{');
  assert.throws(() => Fence.waitForTrialBackend({ env: f.env, timeoutMs: 20 }), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, token: 'another-trial', watchdogPid: 1, serverPid: 2 }));
  assert.throws(() => Fence.waitForTrialBackend({ env: f.env, timeoutMs: 20 }), { code: 'UPDATE_TRIAL_FENCE_UNAVAILABLE' });
});
test('server entry runs the trial fence before loading persistence or third-party modules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.ok(source.startsWith("require('./lib/update-trial-backend').waitForTrialBackend();"));
});
test('an actual child cannot write after the startup gate without durable writer registration', t => {
  const f = fixture(t), marker = path.join(f.root, 'must-not-exist');
  const helper = path.join(__dirname, '../server/lib/update-trial-backend');
  const script = `require(${JSON.stringify(helper)}).waitForTrialBackend({timeoutMs:100});require('fs').writeFileSync(${JSON.stringify(marker)},'opened data');`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', script], { env: { ...process.env, ...f.env } });
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), /UPDATE_TRIAL_FENCE_UNAVAILABLE/);
  assert.equal(fs.existsSync(marker), false);
});
