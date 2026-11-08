'use strict';
// Run only while holding /tmp/buyerlog-performance-measurement.lock.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'resources/app');
const evidence = path.join(__dirname, 'evidence/final');
fs.mkdirSync(evidence, { recursive: true });
const tests = [
  'collection-committed-source', 'collection-delta-commit', 'collection-delta-native27',
  'local-db-wal-v807', 'local-db-wal-tail-recovery', 'local-db-wal-metadata',
  'local-db-compaction', 'local-db-crash-recovery', 'local-db-business-integrity',
  'i18n-coverage-guard',
];
const files = [
  'resources/app/server/lib/collection-committed-source.js',
  'resources/app/server/lib/collection-delta-commit.js',
  ...tests.map(name => 'resources/app/tests/' + name + '.test.js'),
  ...['collection-committed-native', 'collection-commit-crash-child', 'collection-native27-binding'].map(name => 'resources/app/tests/fixtures/' + name + '.cjs'),
  'resources/app/server/lib/local-db.js',
  'docs/performance-program/parallel-handoff-20261108/03-collection-server/native/collection-delta-service.cjs',
  'docs/performance-program/parallel-handoff-20261108/03-collection-server/native/collection-delta-service.test.cjs',
];
const receipt = {
  base: 'd66c1f803097af5991616f0420392e1027888f2e',
  branch: fs.readFileSync(path.join(root, '.git/HEAD'), 'utf8').trim().replace('ref: refs/heads/', ''),
  environment: { node: process.version, platform: process.platform, arch: process.arch, kernel: os.release() },
  lock: '/tmp/buyerlog-performance-measurement.lock', startedAt: new Date().toISOString(),
  sha256: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  checks: [],
};
async function run(name, args, file) {
  const startedAt = new Date().toISOString();
  const log = path.join(evidence, file), fd = fs.openSync(log, 'w');
  const child = spawn(process.execPath, args, { cwd: app, stdio: ['ignore', fd, fd] });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => resolve({ status, signal })); });
  fs.closeSync(fd);
  const output = fs.readFileSync(log, 'utf8');
  const number = key => Number(output.match(new RegExp('^# ' + key + ' (\\d+)', 'm'))?.[1] || 0);
  receipt.checks.push({ name, command: [process.execPath, ...args], startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, tests: number('tests'), pass: number('pass'), fail: number('fail'), skipped: number('skipped'), cancelled: number('cancelled'), log: 'evidence/final/' + file });
  process.stdout.write(name + ': ' + (result.status === 0 ? 'PASS' : 'FAIL') + '\n');
}
(async () => {
  for (const name of tests) await run(name, ['--test-reporter=tap', 'tests/' + name + '.test.js'], name + '.tap');
  await run('i18n:check', ['scripts/i18n-coverage.js'], 'i18n-check.log');
  for (const file of files.filter(file => file.includes('/collection-') && !file.includes('parallel-handoff'))) await run('syntax:' + file, ['--check', path.join(root, file)], path.basename(file) + '.syntax.log');
  receipt.finishedAt = new Date().toISOString();
  receipt.passed = receipt.checks.every(check => check.exitCode === 0 && (!tests.includes(check.name) || check.tests > 0 && check.tests === check.pass && check.fail === 0 && check.skipped === 0 && check.cancelled === 0));
  fs.writeFileSync(path.join(__dirname, 'validation.json'), JSON.stringify(receipt, null, 2) + '\n');
  process.exitCode = receipt.passed ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
