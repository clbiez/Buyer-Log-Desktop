'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const REPO = path.resolve(__dirname, '../../..'), APP = path.join(REPO, 'resources/app');
const DOC = path.join(REPO, 'docs/performance-program/admin01-real-server-20261108');
const BASE = '1796193f0a57c7785e7bf9fdb3557e33c550b25e';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function inside(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'path outside diagnostic root');
}
function quantiles(attempts) {
  const values = attempts.map(a => a.latencyMs).sort((a, b) => a - b);
  assert.ok(values.every(Number.isFinite));
  const q = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  return { count: values.length, failures: attempts.filter(a => a.error || a.status !== 200).length,
    p50Ms: q(.5), p95Ms: q(.95), maxMs: q(1) };
}
function admission(root, diskGiB = 3) {
  const stat = fs.statfsSync(root), available = stat.bavail * stat.bsize;
  const read = file => fs.readFileSync('/sys/fs/cgroup/' + file, 'utf8').trim();
  const current = Number(read('memory.current')), limit = Number(read('memory.max'));
  assert.ok(available >= diskGiB * 2 ** 30, 'insufficient disk admission');
  assert.ok(Number.isFinite(limit) && limit - current >= 4 * 2 ** 30, 'insufficient memory admission');
  return { diskAvailableBytes: available, requiredDiskBytes: diskGiB * 2 ** 30,
    memoryCurrentBytes: current, memoryLimitBytes: limit, requiredMemoryHeadroomBytes: 4 * 2 ** 30,
    fsType: '0x' + stat.type.toString(16), filesystem: execFileSync('df', ['-T', root], { encoding: 'utf8' }).trim(),
    cpuQuota: read('cpu.max'), cpuModel: os.cpus()[0].model, availableParallelism: os.availableParallelism(),
    node: process.version, kernel: os.release(), platform: process.platform, arch: process.arch };
}
function identity() {
  const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  const files = ['server/server.js', 'server/lib/backup-archive.js', 'server/lib/backup-service.js',
    'server/lib/compute-service.js', 'server/lib/user-access.js', 'server/lib/page-projection-cache.js', 'scripts/generate-demo-data.js'];
  const hashes = Object.fromEntries(files.map(f => [f, sha(fs.readFileSync(path.join(APP, f)))]));
  for (const f of files) assert.equal(hashes[f], sha(execFileSync('git', ['show', BASE + ':resources/app/' + f], { cwd: REPO, maxBuffer: 20 * 2 ** 20 })), 'production changed: ' + f);
  const inherited = JSON.parse(fs.readFileSync(path.join(DOC, 'inheritance.json')));
  for (const f of inherited.files) assert.equal(sha(fs.readFileSync(path.join(REPO, f.path))), f.sha256, 'inherited bytes changed');
  return { base: BASE, head: git(['rev-parse', 'HEAD']), inheritedCommit: inherited.commit, sourceHashes: hashes,
    harnessHashes: Object.fromEntries(fs.readdirSync(__dirname).filter(f => /\.(cjs|sh)$/.test(f)).sort().map(f => [f, sha(fs.readFileSync(path.join(__dirname, f)))])) };
}
function environment(root) {
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC', NODE_ENV: 'production',
    HOME: path.join(root, 'home'), XDG_CACHE_HOME: path.join(root, 'home/cache'),
    TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'),
    BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
    BUYER_LOG_LOCAL_DB: path.join(root, 'local/BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
  for (const dir of ['home/cache', 'tmp', 'data', 'auth', 'app', 'local']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  return env;
}
function save(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
module.exports = { fs, path, assert, REPO, APP, DOC, BASE, sha, now, delay, inside, quantiles, admission, identity, environment, save };
