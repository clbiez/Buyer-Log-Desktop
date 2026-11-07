'use strict';
// Standalone preparation collector. No production module is patched on disk.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const inspector = require('node:inspector');
const zlib = require('node:zlib');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { fixture, hash, isolate, response } = require('./fixture.cjs');
const args = process.argv.slice(2);
function option(name, fallback) { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; }
const source = path.resolve(option('--source', path.join(__dirname, '../../..')));
const out = path.resolve(option('--out', path.join(__dirname, 'artifacts/result.json')));
const trace = args.includes('--trace');
const root = isolate();
const files = ['user-access.js', 'iam-core.js'];
const sourceHashes = Object.fromEntries(files.map(name => [name, hash(fs.readFileSync(path.join(source, 'resources/app/server/lib', name), 'utf8'))]));
function installCounters() {
  const original = Module._extensions['.js'];
  const names = new Set(['childrenByManager', 'descendants', 'assignedPermissionDetails', 'effectivePermissionDetails', 'effectiveDataScope', 'reportsByManager', 'descendantProfiles', 'publicProfile', 'adminUser', 'adminListHandler']);
  global.__admin03Counts = {};
  Module._extensions['.js'] = (mod, filename) => {
    if (!files.some(name => filename === path.join(source, 'resources/app/server/lib', name))) return original(mod, filename);
    const code = fs.readFileSync(filename, 'utf8').replace(/^(\s*)function (\w+)\([^\n]*\) \{$/gm, (line, _indent, name) => {
      if (!names.has(name)) return line;
      const key = `${path.basename(filename)}:${name}`;
      return `${line} global.__admin03Counts[${JSON.stringify(key)}] = (global.__admin03Counts[${JSON.stringify(key)}] || 0) + 1;`;
    });
    mod._compile(code, filename);
  };
  return () => { Module._extensions['.js'] = original; };
}
function installFixture(access, count, fanout) {
  const seed = fixture(count, fanout), bytes = JSON.stringify(seed);
  fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), bytes);
  const store = access.readStore();
  return { store, fixtureSha256: hash(bytes), depth: Math.max(...store.users.map(p => {
    let d = 1, cursor = p; const byId = new Map(store.users.map(v => [v.id, v]));
    while (byId.has(cursor.managerId)) { d++; cursor = byId.get(cursor.managerId); } return d;
  })) };
}
function samples(work, count, warmup) {
  for (let i = 0; i < warmup; i++) work();
  const values = [], cpu = process.cpuUsage();
  let digest;
  for (let i = 0; i < count; i++) {
    const start = performance.now(), value = work(); values.push(performance.now() - start);
    const next = hash(value); if (digest && digest !== next) throw new Error('Non-deterministic DTO'); digest = next;
  }
  const elapsed = process.cpuUsage(cpu), sorted = values.slice().sort((a,b) => a-b);
  return { samplesMs: values, p50Ms: sorted[Math.ceil(count * .5) - 1], p95Ms: sorted[Math.ceil(count * .95) - 1],
    cpuMsIncludingHash: (elapsed.user + elapsed.system) / 1000, dtoSha256: digest };
}
async function main() {
  const access = require(path.join(source, 'resources/app/server/lib/user-access'));
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const result = { kind: trace ? 'diagnostic-node-profile' : 'preparation-AA-not-optimized',
    label: option('--label', 'diagnostic'), run: Number(option('--run', 0)), startedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
    requiredMain: '5a1656e98deeb573f6245f4b24a8135cc77a0d7b', sourceHashes,
    harnessSha256: hash(fs.readFileSync(__filename, 'utf8')), fixtureSourceSha256: hash(fs.readFileSync(path.join(__dirname, 'fixture.cjs'), 'utf8')),
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.availableParallelism(),
      cpuModel: os.cpus()[0].model, memoryBytes: os.totalmem(), cpuMax: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
      memoryMax: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() }, scenarios: [] };
  const post = (session, method) => new Promise((resolve, reject) => session.post(method, (error, value) => error ? reject(error) : resolve(value)));
  let session;
  if (trace) { session = new inspector.Session(); session.connect(); await post(session, 'Profiler.enable'); await post(session, 'Profiler.start'); }
  for (const [count, fanout] of trace ? [[100, 4]] : [[30, 3], [100, 4], [300, 6], [100, 1]]) {
    const { store, ...metadata } = installFixture(access, count, fanout);
    const admin = () => { const res = response(); runtime.adminListHandler({ currentUser: store.moderator, headers: {} }, res); return res.body; };
    const scenario = { users: count, fanout, ...metadata,
      publicProfile: samples(() => access.publicProfile(store.users[0], store), trace ? 30 : 60, 5),
      adminList: samples(admin, trace ? 5 : 20, 2) };
    result.scenarios.push(scenario);
  }
  if (session) {
    const { profile } = await post(session, 'Profiler.stop'); session.disconnect();
    fs.writeFileSync(out + '.cpuprofile.gz', zlib.gzipSync(JSON.stringify(profile)));
    // Count calls separately from unmodified timing/profile capture.
    for (const name of files) delete require.cache[require.resolve(path.join(source, 'resources/app/server/lib', name))];
    const restore = installCounters();
    try {
      const counted = require(path.join(source, 'resources/app/server/lib/user-access'));
      const { store } = installFixture(counted, 100, 4);
      const runtime2 = counted.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
      global.__admin03Counts = {}; counted.publicProfile(store.users[0], store); result.publicProfileCalls = { ...global.__admin03Counts };
      global.__admin03Counts = {}; runtime2.adminListHandler({ currentUser: store.moderator, headers: {} }, response()); result.adminListCalls = { ...global.__admin03Counts };
    } finally { restore(); }
  }
  result.endedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, kind: result.kind, scenarios: result.scenarios.map(s => ({ users: s.users, fanout: s.fanout, publicP50: s.publicProfile.p50Ms, adminP95: s.adminList.p95Ms })) }));
}
main().catch(error => { fs.writeFileSync(out, JSON.stringify({ failed: true, error: error.stack }, null, 2)); process.exitCode = 1; })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
