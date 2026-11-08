'use strict';
// Invoke through run.sh: all child work stays under the shared flock.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const [label, sizeArg = '200000', traceArg = 'plain'] = process.argv.slice(2);
assert.match(label || '', /^[a-z0-9-]+$/);
const size = Number(sizeArg); assert.ok(Number.isSafeInteger(size) && size > 0 && size <= 200000);
assert.ok(['plain', 'trace'].includes(traceArg));
const output = path.join(root, 'docs/performance-program/shared-lease-lost-20261108', label);
fs.mkdirSync(output, { recursive: false }); // Never overwrite a failed attempt.
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-shared-lease-diag-'));
const file = path.join(dataRoot, 'BuyerLogLocal.db');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, p))).digest('hex');
const sources = ['resources/app/server/lib/local-db.js', 'resources/app/server/lib/shared-file-transaction.js',
  'resources/app/server/lib/durable-file-recovery.js', 'resources/app/server/lib/lease-worker-registry.js'];
const historical = 'abc683e4bcc247a7e8e412c07532bc8059fe3adb';
const sourcePins = Object.fromEntries(sources.map(p => {
  const old = execFileSync('git', ['show', `${historical}:${p}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const historicalSha256 = crypto.createHash('sha256').update(old).digest('hex');
  const sha256 = digest(p); assert.equal(sha256, historicalSha256, p);
  return [p, { sha256, historicalSha256 }];
}));
const stat = fs.statfsSync(dataRoot);
const preflight = { freeDiskBytes: Number(stat.bavail) * Number(stat.bsize), freeMemoryBytes: os.freemem(),
  totalMemoryBytes: os.totalmem(), dataRoot, lock: '/tmp/buyerlog-performance-measurement.lock' };
assert.ok(preflight.freeDiskBytes >= 4 * 1024 ** 3, 'at least 4 GiB free required for 200k diagnostic');
assert.ok(preflight.freeMemoryBytes >= 4 * 1024 ** 3, 'at least 4 GiB free required for 200k diagnostic');
const manifest = { label, size, trace: traceArg, runtime: process.execPath, versions: process.versions,
  sourceBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), historical,
  sourcePins, harnessPins: Object.fromEntries(fs.readdirSync(__dirname).filter(p => /\.(cjs|sh)$/.test(p))
    .map(p => [p, digest(path.relative(root, path.join(__dirname, p)))])),
  preflight, started: new Date().toISOString(),
  classification: traceArg === 'plain' ? 'unmodified-source; harness API boundaries only' : 'unmodified-source; observational in-memory method/IO wrappers; timing affected',
  equivalence: 'Independent 200k-cardinality diagnostic, not a replay of historical #900 workload or Electron 39' };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
async function child(mode) {
  const config = { mode, size, file, trace: traceArg === 'trace',
    ranges: [{ writer: 'single', count: size }],
    timeline: path.join(output, `${mode}.timeline.jsonl`), result: path.join(output, `${mode}.result.json`) };
  const configFile = path.join(output, `${mode}.config.json`);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  const args = ['--max-old-space-size=6144', path.join(__dirname, 'worker.cjs'), JSON.stringify(config)];
  const out = fs.openSync(path.join(output, `${mode}.stdout.log`), 'wx');
  const err = fs.openSync(path.join(output, `${mode}.stderr.log`), 'wx');
  const received = fs.openSync(path.join(output, `${mode}.streams.jsonl`), 'wx');
  const env = { ...process.env, BUYER_LOG_INSTANCE_ID: `diag-${label}-${mode}`,
    BUYER_LOG_SERVER_DATA_ROOT: dataRoot, BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataRoot, 'local'),
    BUYER_LOG_DATA_ROOT: path.join(dataRoot, 'app'), BUYER_LOG_CONFIG_PATH: path.join(dataRoot, 'config.json') };
  delete env.BUYER_LOG_DEBUG_LEASE;
  const p = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const [name, stream, fd] of [['stdout', p.stdout, out], ['stderr', p.stderr, err]]) stream.on('data', chunk => {
    fs.writeSync(fd, chunk); fs.writeSync(received, JSON.stringify({ ns: process.hrtime.bigint().toString(),
      wall: new Date().toISOString(), stream: name, base64: chunk.toString('base64') }) + '\n');
  });
  const timer = setTimeout(() => p.kill('SIGKILL'), 15 * 60 * 1000);
  const status = await new Promise((resolve, reject) => { p.once('error', reject); p.once('close', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer); [out, err, received].forEach(fd => fs.closeSync(fd));
  fs.writeFileSync(path.join(output, `${mode}.exit.json`), JSON.stringify(status, null, 2) + '\n');
  assert.equal(status.code, 0, `${mode}: ${JSON.stringify(status)}`);
}
(async () => {
  try {
    await child('write'); await child('verify');
    const written = JSON.parse(fs.readFileSync(path.join(output, 'write.result.json')));
    const reopened = JSON.parse(fs.readFileSync(path.join(output, 'verify.result.json')));
    assert.deepEqual(reopened, written.after);
    manifest.status = 'passed';
  } catch (error) { manifest.status = 'failed'; manifest.error = error.stack; process.exitCode = 1; }
  finally {
    manifest.ended = new Date().toISOString();
    manifest.diskFiles = fs.readdirSync(dataRoot).map(name => { const s = fs.statSync(path.join(dataRoot, name));
      return { name, size: s.size, directory: s.isDirectory() }; });
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ output, status: manifest.status, dataRoot }));
  }
})();
