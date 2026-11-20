'use strict';

/*
 * CP kayıt akışı ölçümü (#1078 takip / WS7b). Yalnız sentetik yerel veri, tarayıcı yok.
 *
 *   node scripts/benchmark-cp-save-flow.js --app-root ../main --candidate-root . --pairs 3 --rows 30000
 *
 * Her koşu: sentetik fixture (seed 7) → yenileme → yeniden başlatma → cp/overview/orders/collection-catalog
 * projeksiyonları ısıtılır → boşta bekleme (RSS) → açık döngü kayıt akışı: iki "sekme" (A/B istemci kimliği)
 * sırayla --saves kayıt, --interval-ms arayla (POST /api/overrides/rows; not / Del. Type / Retail Date karışık).
 * Ölçülenler:
 *   ack            kayıt onayı (istek → yanıt)
 *   visible        diğer sekmenin SSE akışında (/api/live-events) satır yamasının görünmesi (istek başından)
 *   status lag     /api/status gecikmesi (250 ms aralık; olay döngüsü blokajı vekili)
 *   orders read    akış sırasında Siparişler sayfa projeksiyonu okuması (kayıt aralığının ortasında)
 *   lastSettled    son kayıt isteğinden, ardından gelen Siparişler okumasının bitişine kadar (bekleyen
 *                  projeksiyon yeniden yazımları okumadan önce biter: pendingRewritesSettled)
 *   mainCpuMs      sunucu ana iş parçacığı CPU (utime+stime, /proc/<pid>/task/<pid>/stat) akış boyunca
 *   processCpuMs   süreç toplamı (işçi iş parçacıkları dahil)
 *   rss            boşta (akıştan önce ve sonra --idle-ms bekleme ile) ve akış tepe değeri
 * Seçenekler: --rows N (30000) --pairs N --runs N --saves N (16) --interval-ms N (2500) --idle-ms N (15000)
 *   --source-fixture DIR --keep-fixture --out FILE --env NAME=VALUE (iki kola da, tekrarlanabilir)
 * Sınırlar: Linux /proc gerektirir; görünme süresi sunucu yayınıdır (tarayıcı çizimi dahil değil).
 */

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), http = require('node:http'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { prepareSource, removeTemp, tempDir } = require('./lib/erp-readmodel-run');
const { requestJson, initializeBenchmarkState, compactRefreshStatus } = require('./lib/startup-benchmark');

const PASSWORD = 'synthetic-startup-only-123';
const MODULES = ['cp', 'overview', 'orders', 'collection-catalog'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 0) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
function quantile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
const median = values => quantile(values, 0.5);

function parseArgs(argv) {
  const value = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const int = (name, fallback, min) => {
    const n = Number(value(name, fallback));
    if (!Number.isSafeInteger(n) || n < min) throw Error(`Invalid ${name}`);
    return n;
  };
  const candidate = value('--candidate-root', '');
  const opts = {
    rows: int('--rows', 30000, 100), runs: int('--runs', 1, 1), pairs: argv.includes('--pairs') ? int('--pairs', 3, 1) : 0,
    saves: int('--saves', 16, 1), intervalMs: int('--interval-ms', 2500, 50), idleMs: int('--idle-ms', 15000, 0),
    appRoot: path.resolve(value('--app-root', path.resolve(__dirname, '..'))), candidateRoot: candidate ? path.resolve(candidate) : null,
    sourceFixture: value('--source-fixture', ''), keepFixture: argv.includes('--keep-fixture'), out: value('--out', ''),
    env: Object.fromEntries(argv.flatMap((arg, i) => (arg === '--env' ? [argv[i + 1]] : [])).map(pair => {
      const at = String(pair || '').indexOf('=');
      if (at < 1) throw Error('Invalid --env NAME=VALUE');
      return [pair.slice(0, at), pair.slice(at + 1)];
    })),
  };
  if (opts.candidateRoot && !opts.pairs) opts.pairs = 3;
  for (const dir of [opts.appRoot, opts.candidateRoot].filter(Boolean)) if (!fs.existsSync(path.join(dir, 'server', 'server.js'))) throw Error('Not a Buyer Log app root: ' + dir);
  return opts;
}

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}
const TICK_MS = 1000 / (Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout) || 100);
function cpuMs(file) {
  try {
    const stat = fs.readFileSync(file, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(fields[11]) + Number(fields[12])) * TICK_MS;
  } catch (_) { return null; }
}
function rssMB(pid) {
  try { return round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024); } catch (_) { return null; }
}

// SSE aboneliği: satır yamalarının varış zamanları (orderCode → ilk görülme).
function subscribe(base, cookie, clientId) {
  const seen = [];
  const req = http.get(base + '/api/live-events?clientId=' + encodeURIComponent(clientId), { headers: { cookie, Accept: 'text/event-stream' } }, res => {
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', chunk => {
      const at = performance.now();
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          const patches = event.rowPatches || event.meta?.rowPatches || [];
          seen.push({ at, origin: event.originClientId || null, codes: patches.map(p => Number(p.orderCode)), reload: !patches.length });
        } catch (_) { /* yorum/ping */ }
      }
    });
  });
  req.on('error', () => {});
  return { seen, close: () => req.destroy() };
}

async function timedFetch(url, init) {
  const started = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(180000) });
  const body = await response.arrayBuffer();
  return { started, ms: performance.now() - started, ended: performance.now(), status: response.status, headers: response.headers, body: Buffer.from(body) };
}

async function runOnce({ appRoot, label, source, opts, log }) {
  const root = tempDir('cp-save');
  const env = { ...process.env, ...opts.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local', 'BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).stdout.trim() || null;
  const result = { label, appRoot, revision, status: 'running' };
  let server = null, base = '', cookie = '', subs = [];
  const api = (url, init = {}) => requestJson(base + url, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...init.headers } });
  async function start() {
    const fd = fs.openSync(path.join(root, 'server.log'), 'a');
    server = spawn(process.execPath, [path.join(appRoot, 'server', 'server.js')], { cwd: appRoot, env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    for (let i = 0; i < 240; i++) {
      if (server.exitCode !== null) throw Error('Server exited: ' + server.exitCode);
      try { await api('/api/status'); return; } catch (_) { await delay(250); }
    }
    throw Error('Server startup timed out');
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const done = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([done, delay(10000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await done; }
  }
  async function login() {
    const response = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'moderator', password: PASSWORD, newPassword: PASSWORD }) });
    if (!response.ok) throw Error('Synthetic login failed: ' + response.status);
    cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  }
  try {
    const dataSource = path.join(root, 'source');
    fs.cpSync(source.dir, dataSource, { recursive: true });
    initializeBenchmarkState(root);
    const port = await freePort();
    base = 'http://127.0.0.1:' + port;
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, sourceFolder: dataSource, host: '127.0.0.1' }));
    await start(); await login();
    await api('/api/refresh', { method: 'POST', body: '{}' });
    for (let i = 0; i < 1200; i++) {
      const refresh = compactRefreshStatus(await api('/api/refresh-status'));
      if (!refresh.running) { if (refresh.error) throw Error(JSON.stringify(refresh.error)); break; }
      await delay(500);
    }
    await stop(); await start(); await login();
    // Projeksiyonlar (kullanıcının açtığı modüller); CP satırları hedef seçimi için.
    let cpRows = null;
    for (const module of MODULES) {
      const read = await timedFetch(base + '/api/page-projection/' + module, { headers: { cookie } });
      if (read.status !== 200) throw Error(`${module} projection ${read.status}`);
      if (module === 'cp') cpRows = JSON.parse(read.body.toString('utf8')).rows;
    }
    const targets = [], used = new Set();
    for (const row of cpRows || []) {
      const code = Number(row['Order Code']);
      if (!Number.isSafeInteger(code) || used.has(code) || !row['Model Name'] || !row['C.Code']) continue;
      used.add(code); targets.push({ orderCode: code, model: String(row['Model Name']), ccode: String(row['C.Code']), delType: row['Del. Type'] || '' });
      if (targets.length >= opts.saves) break;
    }
    if (targets.length < opts.saves) throw Error('Not enough CP rows for targets');
    await delay(opts.idleMs);
    const pid = server.pid;
    result.idleBeforeRssMB = rssMB(pid);
    subs = [subscribe(base, cookie, 'bench-tab-A'), subscribe(base, cookie, 'bench-tab-B')];
    await delay(500);
    // /api/status gecikmesi.
    const lag = [];
    let probing = true;
    const prober = (async () => {
      while (probing) {
        const started = performance.now();
        try { await fetch(base + '/api/status', { headers: { cookie } }).then(r => r.arrayBuffer()); } catch (_) {}
        lag.push(performance.now() - started);
        await delay(Math.max(0, 250 - (performance.now() - started)));
      }
    })();
    let peakRss = 0;
    const rssTimer = setInterval(() => { peakRss = Math.max(peakRss, rssMB(pid) || 0); }, 500);
    const mainCpu0 = cpuMs(`/proc/${pid}/task/${pid}/stat`), procCpu0 = cpuMs(`/proc/${pid}/stat`), flowStarted = performance.now();
    const saves = [], reads = [], inflight = [];
    for (let i = 0; i < opts.saves; i++) {
      const target = targets[i], tab = i % 2 ? 'B' : 'A', kind = ['notes', 'delType', 'dates'][i % 3];
      const patch = { model: target.model, ccode: target.ccode }, baseValues = {};
      if (kind === 'notes') { patch.notes = { Notes: `bench note ${i}` }; baseValues.notes = { Notes: '' }; }
      else if (kind === 'delType') { patch.delType = target.delType === 'AIR' ? 'SEA' : 'AIR'; baseValues.delType = null; }
      else { const d = new Date(Date.UTC(2027, i % 12, 1 + i)); patch.dates = { retailDate: d.toISOString().slice(0, 10) }; baseValues.dates = { retailDate: null }; }
      const save = { i, tab, kind, orderCode: target.orderCode };
      saves.push(save);
      inflight.push(timedFetch(base + '/api/overrides/rows', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Client-Id': 'bench-tab-' + tab },
        body: JSON.stringify({ items: [{ orderCode: target.orderCode, patch, base: baseValues }] }) }).then(r => {
        save.started = r.started; save.ackMs = r.ms; save.status = r.status;
        try { const body = JSON.parse(r.body.toString('utf8')); save.applied = (body.applied || []).filter(a => !a.noop).length; save.conflicts = (body.conflicts || []).length; } catch (_) {}
      }));
      // Kayıt aralığının ortasında Siparişler projeksiyon okuması.
      setTimeout(() => {
        inflight.push(timedFetch(base + '/api/page-projection/orders', { headers: { cookie } }).then(r => reads.push({ i, ms: r.ms, status: r.status, cache: r.headers.get('x-page-cache') })));
      }, opts.intervalMs / 2);
      await delay(opts.intervalMs);
    }
    await Promise.all(inflight.slice(0, opts.saves * 2));
    await Promise.all(inflight);
    const last = saves[saves.length - 1];
    const settle = await timedFetch(base + '/api/page-projection/orders', { headers: { cookie } });
    result.lastSettledMs = round(settle.ended - last.started);
    result.flowWallMs = round(performance.now() - flowStarted);
    const mainCpu1 = cpuMs(`/proc/${pid}/task/${pid}/stat`), procCpu1 = cpuMs(`/proc/${pid}/stat`);
    probing = false; await prober; clearInterval(rssTimer);
    await delay(1500);
    for (const save of saves) {
      const other = subs[save.tab === 'A' ? 1 : 0];
      const hit = other.seen.find(event => event.at >= save.started && event.codes.includes(save.orderCode));
      save.visibleMs = hit ? round(hit.at - save.started) : null;
    }
    subs.forEach(sub => sub.close()); subs = [];
    await delay(opts.idleMs);
    result.idleAfterRssMB = rssMB(pid);
    result.peakRssMB = peakRss;
    result.mainCpuMs = round(mainCpu1 - mainCpu0); result.processCpuMs = round(procCpu1 - procCpu0);
    result.mainCpuPerSaveMs = round((mainCpu1 - mainCpu0) / opts.saves);
    result.saves = saves.map(s => ({ i: s.i, tab: s.tab, kind: s.kind, status: s.status, applied: s.applied, conflicts: s.conflicts, ackMs: round(s.ackMs), visibleMs: s.visibleMs }));
    result.reads = reads.map(r => ({ ...r, ms: round(r.ms) }));
    result.lag = { count: lag.length, p50Ms: round(median(lag)), p95Ms: round(quantile(lag, 0.95)), maxMs: round(Math.max(...lag)) };
    result.ack = { p50Ms: round(median(saves.map(s => s.ackMs))), p95Ms: round(quantile(saves.map(s => s.ackMs), 0.95)) };
    result.visible = { p50Ms: round(median(saves.map(s => s.visibleMs))), p95Ms: round(quantile(saves.map(s => s.visibleMs), 0.95)), missing: saves.filter(s => s.visibleMs == null).length };
    result.ordersRead = { p50Ms: round(median(reads.map(r => r.ms))), p95Ms: round(quantile(reads.map(r => r.ms), 0.95)), maxMs: round(Math.max(...reads.map(r => r.ms))), misses: reads.filter(r => r.cache && r.cache !== 'hit').length };
    const ok = saves.every(s => s.status === 200 && s.applied === 1);
    result.status = ok ? 'passed' : 'partial';
    if (!ok) result.note = 'some saves were not applied';
  } catch (error) {
    result.status = 'failed'; result.error = { message: error.message, stack: error.stack };
  } finally {
    subs.forEach(sub => sub.close());
    await stop().catch(() => {});
    if (!opts.keepFixture) removeTemp(root); else result.root = root;
  }
  return result;
}

function metrics(run) {
  if (run.status === 'failed') return {};
  return {
    'ack.p50Ms': run.ack.p50Ms, 'ack.p95Ms': run.ack.p95Ms, 'visible.p50Ms': run.visible.p50Ms, 'visible.p95Ms': run.visible.p95Ms,
    'statusLag.p50Ms': run.lag.p50Ms, 'statusLag.p95Ms': run.lag.p95Ms, 'statusLag.maxMs': run.lag.maxMs,
    'ordersRead.p50Ms': run.ordersRead.p50Ms, 'ordersRead.p95Ms': run.ordersRead.p95Ms, 'ordersRead.maxMs': run.ordersRead.maxMs,
    lastSettledMs: run.lastSettledMs, mainCpuMs: run.mainCpuMs, mainCpuPerSaveMs: run.mainCpuPerSaveMs, processCpuMs: run.processCpuMs,
    idleBeforeRssMB: run.idleBeforeRssMB, idleAfterRssMB: run.idleAfterRssMB, peakRssMB: run.peakRssMB,
  };
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const log = msg => console.log(msg);
  const report = { schemaVersion: 1, tool: 'benchmark-cp-save-flow', synthetic: true, startedAt: new Date().toISOString(),
    harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
    options: { ...opts, out: undefined }, runs: [] };
  const outFile = path.resolve(opts.out || path.join(tempDir('cp-save-report'), 'report.json'));
  let source = null;
  try {
    source = prepareSource({ harnessRoot: path.resolve(__dirname, '..'), rows: opts.rows, sourceFixture: opts.sourceFixture });
    report.fixture = source.meta;
    const plan = [];
    if (opts.candidateRoot) for (let i = 0; i < opts.pairs; i++) {
      const pair = [['main', opts.appRoot], ['candidate', opts.candidateRoot]];
      if (i % 2) pair.reverse(); // ABBA
      for (const [label, appRoot] of pair) plan.push({ label, appRoot, pair: i + 1 });
    } else for (let i = 0; i < opts.runs; i++) plan.push({ label: 'main', appRoot: opts.appRoot, run: i + 1 });
    for (const [index, step] of plan.entries()) {
      log(`[${index + 1}/${plan.length}] ${step.label} ${step.appRoot}`);
      const run = await runOnce({ appRoot: step.appRoot, label: step.label, source, opts, log });
      run.pair = step.pair ?? null; run.order = index + 1; run.metrics = metrics(run);
      report.runs.push(run);
      log(`  status=${run.status}${run.error ? ' error=' + run.error.message : ''} ${JSON.stringify(run.metrics)}`);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile + '.partial', JSON.stringify(report, null, 2));
    }
    const labels = [...new Set(report.runs.map(r => r.label))];
    report.summary = Object.fromEntries(labels.map(l => {
      const runs = report.runs.filter(r => r.label === l && r.status !== 'failed');
      const keys = [...new Set(runs.flatMap(r => Object.keys(r.metrics)))];
      return [l, Object.fromEntries(keys.map(k => [k, { median: round(median(runs.map(r => r.metrics[k])), 1), samples: runs.map(r => r.metrics[k] ?? null) }]))];
    }));
    const keys = [...new Set(labels.flatMap(l => Object.keys(report.summary[l])))];
    report.summaryTable = [['metric', ...labels.map(l => `${l} median (samples)`)].join(' | '),
      ...keys.map(k => [k, ...labels.map(l => { const s = report.summary[l][k]; return s ? `${s.median} (${s.samples.join(', ')})` : '—'; })].join(' | '))].join('\n');
    report.status = report.runs.every(r => r.status === 'passed') ? 'passed' : 'partial';
  } finally {
    report.finishedAt = new Date().toISOString();
    if (source?.owned && !opts.keepFixture) removeTemp(source.holder);
    else if (source?.owned) report.sourceFixtureDir = source.dir;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(outFile + '.partial', { force: true });
    if (report.summaryTable) console.log('\n' + report.summaryTable + '\n');
    console.log(`Report: ${outFile} (status=${report.status})`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
