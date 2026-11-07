'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), v8 = require('node:v8'), vm = require('node:vm');
const { Worker, MessageChannel } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../..'), APP = path.join(ROOT, 'resources/app');
const SOURCE = '69950f289a012f0bb7c61290bec9890f340f6c64', BASE = '1d8e8d39257b66443fad8e80739261b4f0a82227';
const MiB = 1024 * 1024, sha = x => crypto.createHash('sha256').update(x).digest('hex');
const git = async (dir, ...args) => (await promisify(execFile)('git', args, { cwd: dir, encoding: 'utf8' })).stdout.trim();
const requireApp = createRequire(path.join(APP, 'package.json'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function assertTemp(dir, prefix) {
  const real = fs.realpathSync(dir);
  assert.equal(path.dirname(real), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(real).startsWith(prefix));
  assert.equal(fs.lstatSync(dir).isSymbolicLink(), false);
  return real;
}
async function prepare(dir) {
  assertTemp(dir, 'buyerlog-fx-b1-');
  assert.equal(await git(ROOT, 'rev-parse', SOURCE), SOURCE);
  const XLSX = requireApp('xlsx'), parser = requireApp('./server/lib/parse'), codec = requireApp('./server/lib/compute-source-codec');
  const asasPath = path.join(dir, 'ASAS - Demo.xlsx'), antrepoPath = path.join(dir, 'Antrepo - Demo.xlsx');
  assert.ok(fs.existsSync(asasPath) && fs.existsSync(antrepoPath), 'Run the pinned demo generator first');
  const asas = parser.parseASASWorkbook(XLSX.readFile(asasPath, { cellDates: false, raw: true, dense: true }));
  assert.equal(asas.orders.length, 30000);
  const source = { loadedAt: '2026-11-07T12:00:00.000Z', asasOrders: asas.orders, antrepoMap: parser.parseAntrepoWorkbook(XLSX.readFile(antrepoPath, { cellDates: false, raw: true, dense: true })), lflRows: [] };
  const snapshot = v8.serialize({ source, antrepoMetadata: codec.captureAntrepoMetadata(source) });
  fs.writeFileSync(path.join(dir, 'source.v8'), snapshot);
  const validDir = path.join(dir, 'valid'); fs.mkdirSync(validDir, { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[null, null, '2026-10'], [null, 'TRY', 40], [null, 'EUR', 0.91], [null, 'GBP', 0.8]]), 'Synthetic rates');
  const kur = path.join(validDir, 'KUR.xlsx'); XLSX.writeFile(wb, kur); fs.utimesSync(kur, new Date('2026-11-01T00:00:00.000Z'), new Date('2026-11-01T00:00:00.000Z'));
  const parsed = requireApp('./server/lib/fxWorkbook').readFxWorkbook(kur);
  assert.equal(parsed.data.months['2026-10'].TRY, 40);
  const files = ['ASAS - Demo.xlsx', 'Antrepo - Demo.xlsx', 'source.v8', 'valid/KUR.xlsx'];
  const manifest = { synthetic: true, seed: 7, rows: 30000, sourceSha: SOURCE, files: Object.fromEntries(files.map(f => [f, sha(fs.readFileSync(path.join(dir, f)))])), sourceBytes: snapshot.length, kurExpected: parsed.data.months };
  fs.writeFileSync(path.join(dir, 'fx-fixture.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
function fixture(dir) {
  assertTemp(dir, 'buyerlog-fx-b1-');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'fx-fixture.json')));
  assert.equal(manifest.synthetic, true); assert.equal(manifest.rows, 30000); assert.equal(manifest.sourceSha, SOURCE);
  for (const [file, hash] of Object.entries(manifest.files)) assert.equal(sha(fs.readFileSync(path.join(dir, file))), hash);
  return manifest;
}
function extractSync(app) {
  const text = fs.readFileSync(path.join(app, 'server/server.js'), 'utf8');
  const start = text.indexOf('let folderFxSyncStatus = null;'), end = text.indexOf('// Date nesneleri JSON.stringify', start);
  assert.ok(start > 0 && end > start);
  return text.slice(start, end) + '\n;globalThis.sync=syncFxFromKurWorkbook;globalThis.status=()=>folderFxSyncStatus;';
}
function normalized(value) {
  // Only wall-clock audit timestamps differ between fresh isolated processes.
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, ['updatedAt', '_updatedAt'].includes(key) && val ? '<audit-time>' : normalized(val)]));
  return value;
}
function classify(events, label) {
  const admission = events.find(e => e.event === 'admission' && e.label === label);
  if (!admission) return null;
  const timer = events.find(e => e.event === 'deadline-registered' && e.label === label);
  const dispatched = events.find(e => e.event === 'dispatch' && e.job === admission.job && e.system === admission.system);
  const received = events.find(e => e.event === 'task-received' && e.id === admission.job && e.system === admission.system);
  const fired = events.find(e => e.event === 'deadline-fired' && e.label === label);
  const settled = events.find(e => e.event === 'settled' && e.label === label);
  const slotEvent = name => dispatched && events.find(e => e.event === name && e.slot === dispatched.slot && e.system === dispatched.system);
  const constructed = slotEvent('worker-construct'), preload = slotEvent('worker-preload'), ready = slotEvent('worker-listener-installed');
  const resultPost = events.find(e => e.event === 'result-post' && e.id === admission.job && e.system === admission.system);
  const diff = (a, b) => a && b ? Number(BigInt(a.ns) - BigInt(b.ns)) / 1e6 : null;
  const beforeDeadline = event => Boolean(event && (!fired || BigInt(event.ns) < BigInt(fired.ns)));
  const atDeadline = fired ? !beforeDeadline(dispatched) ? 'queue' : !beforeDeadline(received) ? 'worker-startup-or-dispatch' : 'execution-or-result-transport' : 'no-timeout';
  return { job: admission.job, system: admission.system, timeoutMs: timer?.timeoutMs ?? null, atDeadline,
    admissionNs: admission.ns, deadlineRegisteredNs: timer?.ns ?? null, dispatchNs: dispatched?.ns ?? null, receivedNs: received?.ns ?? null, firedNs: fired?.ns ?? null, settledNs: settled?.ns ?? null,
    workerConstructNs: constructed?.ns ?? null, workerPreloadNs: preload?.ns ?? null, workerReadyNs: ready?.ns ?? null, resultPostNs: resultPost?.ns ?? null,
    workerStartupMs: diff(ready, constructed), receiveToResultPostMs: diff(resultPost, received), resultPostToSettledMs: diff(settled, resultPost),
    queueToDispatchMs: diff(dispatched, admission), dispatchToReceiveMs: diff(received, dispatched), admissionToDeadlineMs: diff(fired, admission), timerToFireMs: diff(fired, timer), admissionToSettledMs: diff(settled, admission),
    metrics: settled?.metrics || null, error: settled?.error || null };
}
async function child(options) {
  const { arm, state, kur, dir, baselineApp } = options, manifest = fixture(dir);
  assert.ok(['candidate', 'baseline'].includes(arm) && ['cold', 'warm', 'busy'].includes(state) && ['missing', 'valid'].includes(kur));
  assert.equal(await git(ROOT, 'diff', '--name-only', SOURCE, '--', 'resources/app'), '', 'Pinned production source changed');
  assert.equal(await git(path.dirname(baselineApp), 'rev-parse', 'HEAD'), BASE);
  assert.equal(await git(path.dirname(baselineApp), 'diff', '--name-only', BASE, '--', 'resources/app'), '', 'Baseline production source changed');
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fx-b1-run-'));
  for (const [key, sub] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_AUTH_DATA_ROOT: 'auth', BUYER_LOG_TEMP_ROOT: 'temp' })) process.env[key] = path.join(runRoot, sub);
  process.env.BUYER_LOG_LOCAL_DB = path.join(runRoot, 'local/BuyerLogLocal.db');
  process.env.BUYER_LOG_CONFIG_PATH = path.join(runRoot, 'config.json');
  process.env.BUYER_LOG_CENTRAL_IAM_ENABLED = '0';
  const events = [], ports = [], keepAlive = setInterval(() => {}, 1000);
  const emit = (event, extra = {}) => { const value = { event, ns: process.hrtime.bigint().toString(), wall: new Date().toISOString(), ...extra }; events.push(value); return value; };
  let slot = 0;
  class ObservedWorker extends Worker {
    constructor(file, workerOptions = {}) {
      const number = ++slot, channel = new MessageChannel(), system = file.endsWith('compute-worker.js') ? 'shared' : 'baseline';
      emit('worker-construct', { slot: number, system });
      super(file, { ...workerOptions, workerData: { ...workerOptions.workerData, fxDiagnosticPort: channel.port2 }, transferList: [...(workerOptions.transferList || []), channel.port2], execArgv: [...(workerOptions.execArgv || []), '--require', path.join(__dirname, 'worker-observer.cjs')] });
      this.diagnosticSlot = number; this.system = system;
      ports.push(channel.port1); channel.port1.on('message', e => events.push({ ...e, slot: number, system })); channel.port1.unref();
      this.on('online', () => emit('worker-online-observed', { slot: number, system }));
      this.on('exit', code => emit('worker-exit-observed', { slot: number, system, code }));
    }
    postMessage(message, ...rest) {
      emit('dispatch', { job: message.id, task: message.task, slot: this.diagnosticSlot, system: this.system });
      return super.postMessage(message, ...rest);
    }
    terminate() { emit('worker-terminate', { slot: this.diagnosticSlot, system: this.system }); return super.terminate(); }
  }
  const pool = requireApp('./server/lib/compute-pool').createComputePool({ WorkerClass: ObservedWorker, maxPendingBytes: 512 * MiB });
  const nativeRun = pool.run.bind(pool); let next = 0;
  pool.run = function (task, payload, opts) {
    const job = ++next, label = task === 'excel-utility' ? 'fx' : task + '-' + job;
    emit('admission', { label, job, task, system: 'shared', timeoutMs: opts.timeoutMs ?? 600000, stats: pool.stats() });
    const set = global.setTimeout;
    global.setTimeout = function (callback, ms, ...args) {
      if (ms !== 5000) return set(callback, ms, ...args);
      emit('deadline-registered', { label, job, system: 'shared', timeoutMs: ms });
      return set(() => { emit('deadline-fired', { label, job, system: 'shared', stats: pool.stats() }); callback(...args); }, ms);
    };
    let promise; try { promise = nativeRun(task, payload, opts); } finally { global.setTimeout = set; }
    return promise.then(lease => { emit('settled', { label, job, system: 'shared', metrics: lease.metrics }); return lease; }, error => { emit('settled', { label, job, system: 'shared', error: error.code, metrics: error.computeMetrics }); throw error; });
  };
  const service = requireApp('./server/lib/compute-service').createComputeService({ pool, root: runRoot });
  const selectedApp = arm === 'candidate' ? APP : baselineApp, selectedRequire = createRequire(path.join(selectedApp, 'package.json'));
  const db = selectedRequire('./server/db'), saves = [], errors = [], publications = [];
  const initial = db.saveFx({ base: 'USD', months: { '2026-09': { TRY: 39, EUR: 0.9 } }, currencies: ['TRY', 'EUR'], sourceType: 'UPLOAD', reportMonth: '2026-09', updatedAt: '2026-09-01T00:00:00.000Z' }, db.loadFx()._revision);
  let baselineNext = 0;
  const excel = selectedRequire('./server/excel-worker-client').createExcelWorkerClient({ WorkerClass: ObservedWorker });
  const context = { require: createRequire(path.join(selectedApp, 'server/server.js')), __dirname: path.join(selectedApp, 'server'), path,
    sourceUserId: () => 'fx-demo', sourceFolderForUser: () => kur === 'valid' ? path.join(dir, 'valid') : dir,
    loadFx: db.loadFx, saveFx: (...args) => { const saved = db.saveFx(...args); saves.push(saved._revision); return saved; },
    serverCompute: () => service, publishSharedMasterChange: (...args) => publications.push(args[0]),
    logRuntimeFailure: (key, error) => errors.push({ key, code: error.code, metrics: error.computeMetrics || null }),
    runExcelTask(task, payload, opts) {
      const job = ++baselineNext; emit('admission', { label: 'fx', job, task, system: 'baseline', timeoutMs: opts.timeoutMs });
      const set = global.setTimeout;
      global.setTimeout = function (callback, ms, ...args) {
        if (ms !== 5000) return set(callback, ms, ...args);
        emit('deadline-registered', { label: 'fx', job, system: 'baseline', timeoutMs: ms });
        return set(() => { emit('deadline-fired', { label: 'fx', job, system: 'baseline' }); callback(...args); }, ms);
      };
      let promise; try { promise = excel.runExcelTask(task, payload, { ...opts, onMetrics: metrics => emit('baseline-metrics', { job, metrics }) }); } finally { global.setTimeout = set; }
      return promise.then(value => { emit('settled', { label: 'fx', job, system: 'baseline' }); return value; }, error => { emit('settled', { label: 'fx', job, system: 'baseline', error: error.code }); throw error; });
    } };
  vm.createContext(context); vm.runInContext(extractSync(selectedApp), context);
  const express = requireApp('express'), app = express(), allow = (_req, _res, done) => done();
  selectedRequire('./server/routes/costing-fx-shipping-routes')(app, { loadFx: db.loadFx, fxMonthResolved: db.fxMonthResolved, getFolderFxSyncStatus: context.status,
    userAccess: { requireAnyArea: () => allow, requireArea: () => allow, requirePermission: () => allow } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const readApi = async () => {
    const fx = await fetch(url + '/api/fx'), resolve = await fetch(url + '/api/fx/resolve/2026-10');
    return { status: fx.status, cacheControl: fx.headers.get('cache-control'), body: await fx.json(), resolveStatus: resolve.status, resolve: await resolve.json() };
  };
  let blocking = [], result;
  try {
    if (state !== 'cold') await service.warm();
    if (state === 'busy') {
      const loaded = v8.deserialize(fs.readFileSync(path.join(dir, 'source.v8')));
      for (const item of loaded.antrepoMetadata) Object.defineProperty(item.map, '__antrepoMeta', { value: item.value, enumerable: false, configurable: true });
      const descriptor = await service.seedSource({ ownerId: 'demo', generation: '1', source: loaded.source, uncompressedBytes: manifest.sourceBytes });
      blocking = Array.from({ length: pool.stats().maxWorkers }, () => service.run('projections', descriptor, { modules: ['cp', 'orders', 'overview', 'order-summary', 'collection-catalog'], overrides: {} }).then(lease => { const metrics = lease.metrics; lease.release(); return { ok: true, metrics }; }, error => ({ ok: false, code: error.code, metrics: error.computeMetrics })));
      const start = Date.now();
      while (events.filter(e => e.event === 'task-received' && e.task === 'projections').length < pool.stats().maxWorkers) { if (Date.now() - start > 120000) throw Error('Projection start observation timed out'); await sleep(10); }
      assert.equal(pool.stats().activeWorkers, pool.stats().maxWorkers);
    }
    emit('fx-call', { arm, state, kur, stats: pool.stats() });
    const returned = await context.sync('fx-demo');
    emit('fx-return', { stats: pool.stats() });
    const store = db.loadFx(), api = await readApi();
    const sourceFiles = ['server/server.js', 'server/lib/compute-pool.js', 'server/lib/compute-service.js', 'server/workers/compute-worker.js', 'server/workers/excel-worker.js', 'server/excel-worker-client.js', 'server/lib/fxWorkbook.js', 'server/db.js', 'server/routes/costing-fx-shipping-routes.js'];
    result = { synthetic: true, arm, state, kur, fixture: manifest, sourceHashes: Object.fromEntries(sourceFiles.map(f => [f, fs.existsSync(path.join(selectedApp, f)) ? sha(fs.readFileSync(path.join(selectedApp, f))) : null])),
      sharedSourceHashes: Object.fromEntries(sourceFiles.filter(f => f.includes('compute-')).map(f => [f, sha(fs.readFileSync(path.join(APP, f)))])),
      initial, returned: JSON.parse(JSON.stringify(returned)), store, api, saves, publications, errors, atFxReturn: pool.stats() };
    result.blocking = await Promise.all(blocking);
    await sleep(20); // Drain the separate observer channel, outside the measured interval.
    result.timing = classify(events, 'fx');
  } finally {
    await service.close();
    await new Promise(resolve => server.close(resolve));
    for (const port of ports) port.close(); clearInterval(keepAlive);
  }
  result.events = events.sort((a, b) => BigInt(a.ns) < BigInt(b.ns) ? -1 : BigInt(a.ns) > BigInt(b.ns) ? 1 : 0);
  result.runRoot = runRoot;
  return result;
}
async function runMatrix(dir, baselineApp, output, reps = 3) {
  fixture(dir); const runs = [];
  const report = () => ({ sourceSha: SOURCE, baselineSha: BASE, synthetic: true, repetitions: reps, collectorSha256: sha(fs.readFileSync(__filename)), observerSha256: sha(fs.readFileSync(path.join(__dirname, 'worker-observer.cjs'))),
    environment: { node: process.version, v8: process.versions.v8, cpu: os.cpus()[0]?.model, parallelism: os.availableParallelism(), cpuQuota: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryLimit: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() }, runs });
  for (let rep = 1; rep <= reps; rep++) for (const kur of ['missing', 'valid']) for (const state of ['cold', 'warm', 'busy']) for (const arm of rep % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
    const options = { rep, arm, state, kur, dir, baselineApp };
    const log = output + '.' + [rep, kur, state, arm].join('-') + '.stderr';
    const errors = fs.openSync(log, 'w');
    const childProcess = spawn(process.execPath, [__filename, '_child', JSON.stringify(options)], { env: process.env, stdio: ['ignore', 'pipe', errors] }); fs.closeSync(errors);
    let stdout = ''; childProcess.stdout.on('data', chunk => stdout += chunk);
    const exitCode = await new Promise(resolve => childProcess.on('exit', resolve));
    if (exitCode !== 0) { runs.push({ ...options, failed: true, exitCode, stderr: fs.readFileSync(log, 'utf8') }); fs.writeFileSync(output, JSON.stringify(report(), null, 2)); throw Error('Diagnostic child failed: ' + log); }
    const run = { rep, ...JSON.parse(stdout) }; runs.push(run); fs.writeFileSync(output, JSON.stringify(report(), null, 2) + '\n');
    console.log([rep, kur, state, arm, run.timing.atDeadline, run.timing.admissionToSettledMs.toFixed(1), 'ms', 'revision', run.store._revision].join(' '));
  }
  const comparisons = [];
  for (let rep = 1; rep <= reps; rep++) for (const kur of ['missing', 'valid']) for (const state of ['cold', 'warm', 'busy']) {
    const arms = runs.filter(r => r.rep === rep && r.kur === kur && r.state === state);
    const a = arms.find(r => r.arm === 'baseline'), b = arms.find(r => r.arm === 'candidate');
    comparisons.push({ rep, kur, state, dataEqual: JSON.stringify(normalized(a.store)) === JSON.stringify(normalized(b.store)), revisionEqual: a.store._revision === b.store._revision,
      statusEqual: JSON.stringify(normalized(a.api)) === JSON.stringify(normalized(b.api)), returnedEqual: JSON.stringify(normalized(a.returned)) === JSON.stringify(normalized(b.returned)) });
  }
  fs.writeFileSync(output, JSON.stringify({ ...report(), comparisons }, null, 2) + '\n');
}
module.exports = { classify, normalized, extractSync, SOURCE, BASE };
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  const action = command === 'prepare' ? Promise.resolve().then(() => prepare(args[0])) : command === '_child' ? child(JSON.parse(args[0])).then(value => process.stdout.write(JSON.stringify(value))) : command === 'run' ? runMatrix(args[0], path.resolve(args[1]), path.resolve(args[2]), Number(args[3] || 3)) : Promise.reject(Error('Usage: prepare SOURCE_DIR | run SOURCE_DIR BASELINE_APP OUTPUT [REPS]'));
  action.catch(error => { console.error(error); process.exitCode = 1; });
}
