'use strict';
// Reproducible validation, outside all measurement windows; source tests are read-only.
const { fs, path, APP, DOC, assert, admission, save } = require('../../../scripts/prototypes/admin01-real-server-20261108/common.cjs');
const { spawnSync } = require('node:child_process');
assert.equal(spawnSync('flock', ['-n', '-E', '75', '/tmp/buyerlog-performance-measurement.lock', 'true']).status, 75);
const name = process.argv[2]; assert.match(name || '', /^[a-z0-9-]+$/);
const root = path.join(DOC, 'runtime', name); assert.ok(!fs.existsSync(root));
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true }); fs.mkdirSync(path.join(root, 'home'));
const record = { root, admission: admission(root), checks: [] };
const env = { PATH: process.env.PATH, HOME: path.join(root, 'home'), LANG: 'C.UTF-8', TZ: 'UTC',
  TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp'), NODE_OPTIONS: '--require ' + path.join(APP, 'scripts/phase7-test-env.cjs') };
const sourceTests = fs.readdirSync(path.join(APP, 'tests')).filter(f => /(?:backup|full-system-restore|user-restore).*\.test\.js$/.test(f) || f === 'compute-response.test.js').sort().map(f => path.join(APP, 'tests', f));
const tests = [...sourceTests,
  path.resolve(DOC, '../../../scripts/prototypes/admin01-real-server-20261108/inherited/resources/app/tests/backup-crc-sha-preparation.test.js'),
  path.resolve(DOC, '../../../scripts/prototypes/admin01-real-server-20261108/diagnostic.test.cjs')];
for (const [label, command, args] of [
  ['related-tests', process.execPath, ['--test', '--test-concurrency=1', ...tests]],
  ['i18n', 'npm', ['run', 'i18n:check']],
]) {
  const log = path.join(DOC, name + '-' + label + '.log'), fd = fs.openSync(log, 'wx');
  const result = spawnSync(command, args, { cwd: APP, env, stdio: ['ignore', fd, fd], timeout: 300000 }); fs.closeSync(fd);
  record.checks.push({ label, command, args, log, exitCode: result.status, signal: result.signal, error: result.error?.message || null });
  save(path.join(DOC, name + '.json'), record);
}
record.testFiles = tests.length; record.passed = record.checks.every(c => c.exitCode === 0 && !c.error);
save(path.join(DOC, name + '.json'), record);
if (!record.passed) process.exitCode = 1;
