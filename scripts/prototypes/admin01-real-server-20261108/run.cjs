'use strict';
const { fs, path, assert, REPO, APP, DOC, sha, now, delay, inside, quantiles, admission, identity, environment, save } = require('./common.cjs');
const { spawn, fork, spawnSync } = require('node:child_process'), http = require('node:http'), net = require('node:net'), zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { fileHash } = require('./inherited/resources/app/scripts/lib/backup-diagnostic-fixture.js');
let server, client, cookie = '', base, report, resourceTimer, resourceSamples = [];
const episodes = [];
function persist() { if (report) save(report.output, report); }
async function child(script, args, env, logPath) {
  const fd = fs.openSync(logPath, 'wx'), proc = spawn(process.execPath, [script, ...args], { env, cwd: APP, stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
  await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error('child failed: ' + script + ' code=' + code + ' signal=' + signal))); });
}
async function json(endpoint, { method = 'GET', body, anonymous = false } = {}) {
  const started = now();
  const response = await fetch(base + endpoint, { method, signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', ...(anonymous ? {} : { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (method !== 'GET') { report.mutations.push({ endpoint, method, status: response.status, latencyMs: now() - started, retries: 0 }); persist(); }
  const value = await response.json();
  assert.ok(response.ok, endpoint + ' ' + response.status + ' ' + JSON.stringify(value).slice(0, 300));
  return { value, response };
}
async function start(root, source, observed) {
  const env = environment(root), socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  save(env.BUYER_LOG_CONFIG_PATH, { port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } });
  const args = [path.join(APP, 'server/server.js')];
  if (observed) {
    args.unshift('--require', path.join(__dirname, 'observe.cjs'));
    env.ADMIN01_OBSERVATION = path.join(report.evidenceRoot, 'observation.json');
    env.ADMIN01_PROFILE = report.scenario === 'profile' ? '1' : '0';
  }
  const log = fs.openSync(path.join(report.evidenceRoot, 'server.log'), 'wx');
  server = spawn(process.execPath, args, { cwd: APP, env, stdio: ['ignore', log, log, 'ipc'] }); fs.closeSync(log);
  report.server = { pid: server.pid, port, args, environment: env }; persist();
  server.on('message', message => { episodes.push(message); });
  base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 120; i++) {
    assert.equal(server.exitCode, null, 'server exited before readiness');
    try { await json('/api/health', { anonymous: true }); return env; } catch (_) { await delay(250); }
  }
  throw Error('server readiness timeout');
}
async function stop() {
  clearInterval(resourceTimer);
  if (client?.connected) {
    const done = new Promise(resolve => client.once('exit', resolve)); client.send({ stop: true });
    await Promise.race([done, delay(15000)]);
    if (client.exitCode === null && !client.signalCode) { client.kill('SIGKILL'); report.clientForced = true; }
  }
  if (server && server.exitCode === null && !server.signalCode) {
    const done = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM');
    await Promise.race([done, delay(10000)]);
    if (server.exitCode === null && !server.signalCode) { server.kill('SIGKILL'); await done; report.serverForced = true; }
  }
  if (server) report.serverExit = { code: server.exitCode, signal: server.signalCode };
}
async function login(first = false) {
  const password = 'synthetic-startup-only-123';
  const { value, response } = await json('/api/user-login', { method: 'POST', anonymous: true,
    body: { userId: 'moderator', password, ...(first ? { newPassword: password } : {}) } });
  cookie = String(response.headers.get('set-cookie') || '').split(';')[0]; assert.ok(cookie);
  report.login = { ok: value.ok, userId: value.user?.id || value.profile?.id || null, normalPasswordFlow: true };
}
function manifest(root) { return JSON.parse(fs.readFileSync(path.join(root, 'local/page-cache/moderator/manifest.json'))); }
async function projection(module) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/api/page-projection/' + module, { headers: { Cookie: cookie, 'Accept-Encoding': 'gzip' } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 200); assert.equal(res.headers['content-encoding'], 'gzip');
          const bytes = Buffer.concat(chunks), data = JSON.parse(zlib.gunzipSync(bytes));
          assert.ok(Array.isArray(data.rows), 'projection row array required');
          resolve({ sha256: sha(bytes), bytes: bytes.length, rows: data.rows.length,
            generation: res.headers['x-page-cache-generation'], cache: res.headers['x-page-cache'] });
        } catch (error) { reject(error); }
      });
    }); req.setTimeout(60000, () => req.destroy(Error('projection timeout'))); req.on('error', reject);
  });
}
async function validate(root, seed) {
  const payload = JSON.parse(fs.readFileSync(path.join(seed, 'payload.json')));
  assert.equal(payload.synthetic, true); assert.equal(payload.source.rows, 30000);
  for (const [file, hash] of Object.entries(payload.source.hashes)) assert.equal(await fileHash(path.join(seed, 'source', file)), hash);
  for (const f of payload.mapped) assert.equal(await fileHash(path.join(root, f.serverRelative)), f.sha256);
  const initial = (await json('/api/data?mode=initial')).value, projections = {};
  for (const module of ['overview', 'orders']) projections['/api/page-projection/' + module] = await projection(module);
  const m = manifest(root);
  assert.ok(m.activeGeneration && m.sourceRevisionKey);
  for (const value of Object.values(projections)) assert.equal(value.generation, m.activeGeneration);
  assert.equal(projections['/api/page-projection/orders'].rows, 30000);
  assert.ok(projections['/api/page-projection/overview'].rows > 0);
  return { generation: m.activeGeneration, sourceRevision: m.sourceRevisionKey, sourceLoadedAt: m.sourceLoadedAt,
    revisions: initial.storeRevisions, projections, inheritedFixtureSha256: payload.inheritedFixtureSha256,
    sourceHashes: payload.source.hashes, payloadSha256: sha(fs.readFileSync(path.join(seed, 'payload.json'))) };
}
function sampleResources(pid) {
  const processes = [];
  function visit(id) {
    try {
      const status = fs.readFileSync('/proc/' + id + '/status', 'utf8');
      const stat = fs.readFileSync('/proc/' + id + '/stat', 'utf8').split(') ')[1].split(' ');
      processes.push({ pid: id, rssBytes: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024,
        userTicks: Number(stat[11]), systemTicks: Number(stat[12]), threads: Number(stat[17]) });
      const children = fs.readFileSync('/proc/' + id + '/task/' + id + '/children', 'utf8').trim();
      for (const childPid of children ? children.split(/\s+/).map(Number) : []) visit(childPid);
    } catch (_) { /* exited between external polls; exact parent CPU is also recorded */ }
  }
  visit(pid); return { atMs: now(), processes };
}
async function prepare(root, materialized) {
  inside(path.join(DOC, 'runtime'), root); assert.ok(!fs.existsSync(root)); fs.mkdirSync(root, { recursive: true });
  report = { operation: 'prepare-server-seed-once', synthetic: true, status: 'running', evidenceRoot: root, output: path.join(root, 'prepare.json'), mutations: [] }; persist();
  try {
    Object.assign(report, { admission: admission(root, 5), identity: identity() }); persist();
    const env = environment(root);
    if (materialized) {
      inside(path.join(DOC, 'runtime'), materialized);
      const payload = JSON.parse(fs.readFileSync(path.join(materialized, 'payload.json'))); assert.equal(payload.synthetic, true);
      for (const part of ['source', 'local/admin01-payload']) fs.cpSync(path.join(materialized, part), path.join(root, part), { recursive: true, force: false, errorOnExist: true });
      fs.copyFileSync(path.join(materialized, 'payload.json'), path.join(root, 'payload.json')); report.materializedBytesFrom = materialized;
    } else await child(path.join(__dirname, 'seed-builder.cjs'), [root], env, path.join(root, 'seed-builder.log'));
    await start(root, path.join(root, 'source'), false); await login(true);
    await json('/api/refresh', { method: 'POST', body: {} });
    let done = false;
    for (let i = 0; i < 900; i++) {
      const value = (await json('/api/refresh-status')).value;
      if (!value.running) { assert.ok(!value.error, JSON.stringify(value.error)); assert.ok(value.jobId); done = true; break; }
      await delay(500);
    }
    assert.ok(done, 'refresh timeout');
    report.expected = await validate(root, root); report.status = 'passed';
  } finally { await stop(); persist(); }
}
async function run(seed, evidenceRoot, scenario, ordinal) {
  assert.ok(['backup-only', 'backup-interactive', 'profile'].includes(scenario)); inside(DOC, evidenceRoot);
  assert.ok(!fs.existsSync(evidenceRoot), 'new evidence directory required'); fs.mkdirSync(evidenceRoot, { recursive: true });
  const seedReport = JSON.parse(fs.readFileSync(path.join(seed, 'prepare.json')));
  assert.equal(seedReport.synthetic, true); assert.equal(seedReport.status, 'passed');
  inside(path.join(DOC, 'runtime'), seed);
  const root = path.join(DOC, 'runtime', path.basename(path.dirname(evidenceRoot)) + '-' + path.basename(evidenceRoot));
  assert.ok(!fs.existsSync(root), 'new independent runtime required'); fs.mkdirSync(root);
  report = { synthetic: true, status: 'running', scenario, ordinal, root, seed, evidenceRoot, output: path.join(evidenceRoot, 'report.json'),
    identity: identity(), admission: admission(root), mutations: [], measurementsAreBeforeAfter: false, startedAt: new Date().toISOString() }; persist();
  try {
    for (const part of ['data', 'auth', 'app', 'local']) fs.cpSync(path.join(seed, part), path.join(root, part), { recursive: true, errorOnExist: true, force: false });
    const env = await start(root, path.join(seed, 'source'), true);
    const unauthorized = await fetch(base + '/api/page-projection/orders', { signal: AbortSignal.timeout(10000) });
    report.anonymousProjectionStatus = unauthorized.status; await unauthorized.arrayBuffer(); assert.ok([401, 403].includes(unauthorized.status), 'normal authorization must reject anonymous projection');
    await login(); report.before = await validate(root, seed);
    assert.equal(report.before.generation, seedReport.expected.generation); assert.equal(report.before.sourceRevision, seedReport.expected.sourceRevision);
    assert.deepEqual(report.before.revisions, seedReport.expected.revisions); persist();
    // Startup hydration writes the real local DB asynchronously. Let that normal
    // work finish; never suppress a writer or relax the archive source guard.
    await delay(10000);
    let stableFrom = now(), lastSignature = '', settled = false;
    const settlingStarted = now();
    for (let i = 0; i < 120; i++) {
      const stat = fs.statSync(env.BUYER_LOG_LOCAL_DB), signature = stat.size + ':' + stat.mtimeMs;
      if (signature !== lastSignature) { lastSignature = signature; stableFrom = now(); }
      if (now() - stableFrom >= 3000) { settled = true; break; }
      await delay(500);
    }
    assert.ok(settled, 'local DB did not settle before backup');
    report.quiescence = { initialSettleMs: 10000, signatureStableMs: now() - stableFrom, totalPollMs: now() - settlingStarted, localDbSignature: lastSignature }; persist();
    client = fork(path.join(__dirname, 'load.cjs'), [], { env: environment(root), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    await new Promise((resolve, reject) => {
      client.once('error', reject); client.once('exit', code => reject(Error('load client exited before ready: ' + code)));
      client.on('message', m => { if (m.ready) resolve(); });
      client.send({ port: report.server.port, cookie, scenario, expected: report.before.projections, output: path.join(evidenceRoot, 'attempts.json') });
    });
    resourceTimer = setInterval(() => resourceSamples.push(sampleResources(server.pid)), 50);
    await delay(250);
    const postStartedMs = now(), job = (await json('/api/backups', { method: 'POST', body: { mode: 'full' } })).value;
    report.jobId = job.id; assert.ok(job.id); persist();
    let measurement;
    for (let i = 0; i < 2400; i++) {
      assert.equal(server.exitCode, null, 'server exited during backup');
      measurement = episodes.find(e => e.kind === 'backup-end')?.measurement;
      if (measurement) break;
      await delay(50);
    }
    report.measurement = measurement;
    assert.ok(measurement, 'backup observation timeout'); assert.ok(!measurement.error, JSON.stringify(measurement.error));
    const status = (await json('/api/backups/' + job.id + '/status')).value;
    assert.equal(status.ready, true); assert.equal(status.error, null);
    report.postToReadyMs = now() - postStartedMs;
    await stopClient(); clearInterval(resourceTimer);
    const attempts = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'attempts.json'))).attempts;
    const selected = attempts.filter(a => a.sentMs >= measurement.startedMs && a.sentMs < measurement.endedMs);
    report.http = Object.fromEntries([...new Set(attempts.map(a => a.endpoint))].map(endpoint => [endpoint, quantiles(selected.filter(a => a.endpoint === endpoint))]));
    for (const [endpoint, stats] of Object.entries(report.http)) {
      assert.equal(stats.failures, 0, endpoint + ' HTTP errors'); assert.ok(stats.count >= (endpoint === '/api/health' ? 20 : 3), 'insufficient samples: ' + endpoint);
    }
    report.eventLoop = quantiles(measurement.gaps.map(g => ({ latencyMs: g.gapMs, status: 200 })));
    report.resources = resourceSamples.filter(s => s.atMs >= measurement.startedMs && s.atMs <= measurement.endedMs);
    save(path.join(evidenceRoot, 'resources.json'), report.resources);
    report.sampledParentPeakRssBytes = Math.max(0, ...report.resources.map(s => s.processes.find(p => p.pid === server.pid)?.rssBytes || 0));
    report.sampledTreePeakRssSumBytes = Math.max(0, ...report.resources.map(s => s.processes.reduce((n, p) => n + p.rssBytes, 0)));
    delete report.resources;
    report.after = await validate(root, seed); assert.deepEqual(report.after, report.before, 'fixture/generation/revisions changed during backup');
    const response = await fetch(base + '/api/backups/' + job.id + '/download', { signal: AbortSignal.timeout(60000), headers: { Cookie: cookie } }); assert.equal(response.status, 200);
    const archive = path.join(root, 'download.zip'); await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive, { flags: 'wx' }));
    assert.equal(fs.statSync(archive).size, measurement.archive.size);
    await child(path.join(__dirname, 'verify.cjs'), [archive, path.join(root, 'restored'), path.join(seed, 'payload.json'), path.join(evidenceRoot, 'correctness.json')], env, path.join(evidenceRoot, 'verify.log'));
    report.correctness = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'correctness.json'))).passed;
    report.status = 'passed';
  } finally { await stop(); report.finishedAt = new Date().toISOString(); persist(); }
}
async function stopClient() {
  if (!client) return;
  const proc = client;
  await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('exit', code => code === 0 ? resolve() : reject(Error('load client failed: ' + code))); proc.send({ stop: true }); });
  client = null;
}
(async () => {
  const check = spawnSync('flock', ['-n', '-E', '75', '/tmp/buyerlog-performance-measurement.lock', 'true']);
  assert.equal(check.status, 75, 'invoke through flock -n -E 75 /tmp/buyerlog-performance-measurement.lock');
  const [mode, first, second, scenario, ordinal] = process.argv.slice(2);
  if (mode === 'prepare') await prepare(path.resolve(first), second ? path.resolve(second) : null);
  else if (mode === 'run') await run(path.resolve(first), path.resolve(second), scenario, Number(ordinal));
  else throw Error('usage: run.cjs prepare NEW_SEED | run SEED NEW_EVIDENCE backup-only|backup-interactive|profile ORDINAL');
})().catch(async error => {
  if (report) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; await stop(); persist(); }
  console.error(error); process.exitCode = 1;
});
