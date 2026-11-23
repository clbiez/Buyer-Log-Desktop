'use strict';

/*
 * Yenileme sonrası pencere ölçümü (8.0.12 saha kilidi: capture + compute-read damgası).
 * Yalnız sentetik yerel veri, tarayıcı yok. Gerçek sunucu süreci, gerçek /api/refresh.
 *
 *   node scripts/benchmark-post-refresh-window.js --app-root ../main --candidate-root . --pairs 3 --rows 60000 --lfl-source cp
 *
 * Kaynak: sahadaki gibi Data Model (database) yolu. benchmark-snapshot-composition.js ile aynı
 * sentetik ASAS/IAS satırları (generate-demo-data seed 7 + üretim katalog başlıkları) gerçek
 * model-refresh.js'ten geçer; yalnız DAX yürütücüsü (modelQuery.runModelRows/discoverSchema)
 * benchmark preload'unda bu satırları döndürür (ürün kodu değişmez). LFL ayrı kapsam olmadığı
 * için CP'yi besleyen ASAS run'ından üretilir (sahadaki bileşim, ~320 MiB kaynak).
 * Her koşu: yenileme #1 (arşiv tabanı + sayfa önbelleği) →
 * Planlanan & Gerçekleşen işareti yazılana kadar bekleme → --notes satıra not yazılır
 * (overrides büyür ve girdi anahtarları değişir: tam yeniden üretim yolu, sahadaki gibi) →
 * ÖLÇÜLEN yenileme #2 → işaret yazılana kadar + 2 sn. Pencere boyunca:
 *   longestPostRefreshBlockMs  yenileme SONRASI (page-cache-write başlangıcından pencere sonuna) en uzun
 *                    tek olay döngüsü bloğu (preload, 5 ms tik); longestBlockMs yenilemenin kendisi dahil
 *   blocksOver200    200 ms üstü blok sayısı ve toplamı
 *   refreshMs        POST /api/refresh → yenileme bitti (status)
 *   pageCacheWriteMs sunucu günlüğü [Local storage] [page-cache-write] END duration
 *   captureMs        yenileme bitişi → arşivde yeni işaretin görünmesi (15 sn erteleme dahil)
 *   windowMs         POST → işaret + 2 sn (toplam)
 *   heapPeakMiB / rssPeakMiB   pencere boyunca sunucu süreci tepe değerleri
 * Sırası her çiftte dönüşümlüdür (M,A / A,M / M,A).
 * Seçenekler: --rows N (60000) --pairs N (3) --notes N (6000) --out FILE --keep-fixture
 */

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const { removeTemp, tempDir } = require('./lib/erp-readmodel-run');
const { requestJson, initializeBenchmarkState, compactRefreshStatus } = require('./lib/startup-benchmark');

const PASSWORD = 'synthetic-startup-only-123';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = (value, digits = 0) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const median = values => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

function parseArgs(argv) {
  const value = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const int = (name, fallback, min) => { const n = Number(value(name, fallback)); if (!Number.isSafeInteger(n) || n < min) throw Error(`Invalid ${name}`); return n; };
  const candidate = value('--candidate-root', '');
  const opts = { rows: int('--rows', 60000, 100), pairs: int('--pairs', 3, 1), notes: int('--notes', 6000, 0),
    appRoot: path.resolve(value('--app-root', path.resolve(__dirname, '..'))), candidateRoot: candidate ? path.resolve(candidate) : null,
    out: value('--out', ''), keepFixture: argv.includes('--keep-fixture') };
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

// benchmark-snapshot-composition.js ile aynı zenginleştirme (üretim katalog başlıkları).
const ASAS_EXTRA = ['Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo', 'Teknik Resim', 'Lisansör', 'Marka Müdürlükleri',
  'Para Birimi', 'Initial Inspection Geçme Tarih', 'Ürün Tanım'];
const CPX = ['__CPX_Tedarikçi Grup', '__CPX_Planlama Statü', '__CPX_Sezon Tipi'];
const IAS_EXTRA = ['İthalat Dosya No', 'Konteyner No', 'Gemi Ad', 'Supplier Portal Statü Detay', 'Yükleme Talep Tarih',
  'Yükleme İthalat Onay Tarih', 'ETA Tarih', 'Antrepo Firma', 'Sezon', 'Merch Alt Grup Kod', 'Merch Marka Yaş Grup Kod',
  'Marka Müdürlükleri', 'Buyer Grup (TR)'];
function records(aoa, headerIndex) {
  const header = aoa[headerIndex];
  return aoa.slice(headerIndex + 1).map(row => Object.fromEntries(header.map((name, i) => [name, row[i] ?? null])));
}
function buildFixture(harnessRoot, rows) {
  const { build } = require(path.join(harnessRoot, 'scripts', 'generate-demo-data'));
  const data = build({ rows, seed: 7, today: new Date(Date.UTC(2026, 10, 5)) });
  const asas = records(data.asas, 2).map((r, i) => ({ ...r,
    [ASAS_EXTRA[0]]: i % 7 ? 0 : 120, [ASAS_EXTRA[1]]: `https://plm.example.invalid/images/style/${r['Plm Kod']}/technical-front.jpg`,
    [ASAS_EXTRA[2]]: ['Disney', 'Warner Bros', 'Mattel'][i % 3], [ASAS_EXTRA[3]]: ['ÇOCUK MÜDÜRLÜĞÜ', 'GENÇ MÜDÜRLÜĞÜ'][i % 2],
    [ASAS_EXTRA[4]]: 'USD', [ASAS_EXTRA[5]]: r['Initial Inspection Geçme Tarih Gün Ay Yıl'], [ASAS_EXTRA[6]]: r['Ürün Ana Tanım'],
    [CPX[0]]: `GRUP ${i % 9}`, [CPX[1]]: i % 4 ? 'Planlandı' : '', [CPX[2]]: 'Ana Sezon' }));
  const byCode = new Map(asas.map(r => [r['Sipariş Kod'], r]));
  const ias = records(data.antrepo, 0).map((r, i) => { const a = byCode.get(r['Sipariş Kod']) || {}; return { ...r,
    [IAS_EXTRA[0]]: `ITH-2026-${String(100000 + i)}`, [IAS_EXTRA[1]]: `MSKU${String(7000000 + i)}`, [IAS_EXTRA[2]]: ['MAERSK EDIRNE', 'MSC IZMIR'][i % 2],
    [IAS_EXTRA[3]]: r['Supplier Portal Statü'], [IAS_EXTRA[4]]: r['Tahmini Antrepo Giriş Tarihi'], [IAS_EXTRA[5]]: r['HANDOVER Tarihi'] || null,
    [IAS_EXTRA[6]]: r['Tahmini Antrepo Giriş Tarihi'], [IAS_EXTRA[7]]: 'DEMO ANTREPO', [IAS_EXTRA[8]]: a['Sezon'] || null,
    [IAS_EXTRA[9]]: a['Merch Alt Grup Kod'] || null, [IAS_EXTRA[10]]: a['Merch Marka Yaş Grup Kod'] || null,
    [IAS_EXTRA[11]]: ['ÇOCUK MÜDÜRLÜĞÜ', 'GENÇ MÜDÜRLÜĞÜ'][i % 2], [IAS_EXTRA[12]]: a['Buyer Grup (TR)'] || null }; });
  const modelFields = require(path.join(harnessRoot, 'server', 'lib', 'model-fields'));
  const asasMapping = {}, iasMapping = {};
  for (const field of modelFields.fieldsForRole('asas')) asasMapping[field.header] = { table: 'Model Özellikleri', name: field.header, kind: 'column' };
  for (const field of modelFields.fieldsForRole('antrepo')) iasMapping[field.header] = { table: 'Ithalat', name: field.header, kind: 'column' };
  const connections = [
    { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
      horizon: { table: 'Model Özellikleri', seasonTable: 'Model Özellikleri', seasonField: 'Sezon', seasons: ['6W26', '6S27'], groups: [] }, mapping: asasMapping },
    { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'IASv2', refreshEnabled: true, horizon: { table: 'Ithalat', groups: [] }, mapping: iasMapping },
  ];
  const holder = tempDir('post-refresh-src'), dir = path.join(holder, 'source');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'asas.json'), JSON.stringify(asas));
  fs.writeFileSync(path.join(dir, 'ias.json'), JSON.stringify(ias));
  fs.writeFileSync(path.join(dir, 'connections.json'), JSON.stringify(connections));
  fs.writeFileSync(path.join(dir, 'benchmark-fixture.json'), JSON.stringify({ synthetic: true, rows, seed: 7 }));
  return { holder, dir };
}

// Sunucu sürecine --require ile yüklenir; ürün kodu bu dosyayı bilmez. DAX yürütücüsü
// sentetik satırları döndürür (benchmark-snapshot-composition.js 'model' modu ile aynı).
const PRELOAD = `'use strict';
const fs=require('node:fs'),path=require('node:path');const {performance}=require('node:perf_hooks');
const mq=require(path.join(process.env.BL_BENCH_APP_ROOT,'server','lib','modelQuery'));
const src=process.env.BL_BENCH_SOURCE_DIR;
mq.discoverSchema=async()=>({columns:[],measures:[]});
mq.runModelRows=async plan=>{const rows=JSON.parse(fs.readFileSync(path.join(src,/'Ithalat'/.test(plan.query)?'ias.json':'asas.json'),'utf8'));return {rows,rowCount:rows.length};};
const out=process.env.BL_BENCH_LOOP_FILE,TICK=5;let prev=performance.now();const blocks=[];let heapPeak=0,rssPeak=0,samples=[];
const t=setInterval(()=>{const now=performance.now(),gap=now-prev-TICK;prev=now;if(gap>=50)blocks.push([Date.now()-Math.round(gap),Math.round(gap)]);},TICK);t.unref();
const m=setInterval(()=>{const u=process.memoryUsage();samples.push([Date.now(),Math.round(u.heapUsed/1048576),Math.round(u.rss/1048576)]);if(samples.length>20000)samples.shift();},250);m.unref();
const flush=()=>{try{fs.writeFileSync(out,JSON.stringify({blocks,samples}));}catch(_){}};
const f=setInterval(flush,1000);f.unref();process.on('exit',flush);
`;

function readMarkers(file) {
  try { const a = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); return a.base ? 1 + (a.deltas || []).length : 0; } catch (_) { return 0; }
}

async function runOnce({ appRoot, label, source, opts, log }) {
  const root = tempDir('post-refresh');
  const preload = path.join(root, 'loop-preload.js'), loopFile = path.join(root, 'loop.json');
  fs.writeFileSync(preload, PRELOAD);
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local', 'BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp'), BL_BENCH_LOOP_FILE: loopFile,
    BL_BENCH_APP_ROOT: appRoot, BL_BENCH_SOURCE_DIR: source.dir,
    NODE_OPTIONS: [process.env.NODE_OPTIONS || '', `--require ${JSON.stringify(preload).slice(1, -1)}`].join(' ').trim() };
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).stdout.trim() || null;
  const result = { label, appRoot, revision, status: 'running' };
  const archive = path.join(root, 'local', 'backlog-plan-actual', 'moderator.json.gz');
  let server = null, base = '', cookie = '';
  const api = (url, init = {}) => requestJson(base + url, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...init.headers } });
  const logFile = path.join(root, 'server.log');
  async function start() {
    const fd = fs.openSync(logFile, 'a');
    server = spawn(process.execPath, [path.join(appRoot, 'server', 'server.js')], { cwd: appRoot, env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    for (let i = 0; i < 480; i++) {
      if (server.exitCode !== null) throw Error('Server exited: ' + server.exitCode);
      try { await api('/api/status'); return; } catch (_) { await delay(250); }
    }
    throw Error('Server startup timed out');
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const done = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM'); await Promise.race([done, delay(15000)]);
    if (server.exitCode === null) { server.kill('SIGKILL'); await done; }
  }
  async function login() {
    const response = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'moderator', password: PASSWORD, newPassword: PASSWORD }) });
    if (!response.ok) throw Error('Synthetic login failed: ' + response.status);
    cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  }
  async function refresh() {
    const started = Date.now();
    const accepted = await api('/api/refresh', { method: 'POST', body: '{}' });
    if (accepted && accepted.error) throw Error('Refresh rejected: ' + JSON.stringify(accepted));
    for (let i = 0; i < 2400; i++) {
      await delay(250);
      const status = compactRefreshStatus(await api('/api/refresh-status'));
      if (!status.running) { if (status.error) throw Error(JSON.stringify(status.error)); return { started, ended: Date.now() }; }
    }
    throw Error('Refresh timed out');
  }
  async function waitMarker(count, timeoutMs = 600000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) { if (readMarkers(archive) >= count) return Date.now(); await delay(100); }
    throw Error('Plan-actual marker timed out');
  }
  try {
    initializeBenchmarkState(root);
    // Kaynak modları ve Data Model bağlantıları (sahadaki database yolu).
    fs.mkdirSync(env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
    fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT, 'overrides.json'), JSON.stringify({ asasSourceMode: 'database', antrepoSourceMode: 'database', lflSourceMode: 'database', _revision: 1 }));
    fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT, 'settings.json'), JSON.stringify({ modelConnections: JSON.parse(fs.readFileSync(path.join(source.dir, 'connections.json'), 'utf8')), _revision: 1 }));
    const port = await freePort();
    base = 'http://127.0.0.1:' + port;
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1' }));
    await start(); await login();
    log(`${label}: refresh #1`);
    await refresh(); await waitMarker(1);
    // Notlar: overrides büyür (sahadaki kopya maliyeti) ve tüm girdi anahtarları değişir.
    if (opts.notes) {
      const read = await fetch(base + '/api/page-projection/cp', { headers: { cookie } });
      const rows = (await read.json()).rows || [];
      const items = [];
      for (const row of rows) {
        const code = Number(row['Order Code']);
        if (!Number.isSafeInteger(code) || !row['Model Name'] || !row['C.Code']) continue;
        items.push({ orderCode: code, patch: { model: String(row['Model Name']), ccode: String(row['C.Code']), notes: { Notes: `bench note ${items.length} lorem ipsum dolor sit amet` } }, base: { notes: { Notes: '' } } });
        if (items.length >= opts.notes) break;
      }
      for (let i = 0; i < items.length; i += 500) {
        const response = await fetch(base + '/api/overrides/rows', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Client-Id': 'bench' }, body: JSON.stringify({ items: items.slice(i, i + 500) }) });
        if (!response.ok) throw Error('Note save failed: ' + response.status + ' ' + (await response.text()).slice(0, 300));
      }
      result.notes = items.length;
    }
    await delay(5000);
    log(`${label}: refresh #2 (measured)`);
    const logOffset = fs.statSync(logFile).size;
    const markersBefore = readMarkers(archive);
    const measured = await refresh();
    const markerAt = await waitMarker(markersBefore + 1);
    await delay(2000);
    const windowEnd = Date.now();
    await stop();
    const loop = JSON.parse(fs.readFileSync(loopFile, 'utf8'));
    const blocks = loop.blocks.filter(([at]) => at >= measured.started && at <= windowEnd).map(([, ms]) => ms);
    const samples = loop.samples.filter(([at]) => at >= measured.started && at <= windowEnd);
    const text = fs.readFileSync(logFile, 'utf8').slice(logOffset);
    const pageCache = /\[Local storage\] \[page-cache-write\] END duration=(\d+)ms/.exec(text);
    // Yenileme SONRASI iş: sayfa önbelleği yazımının başlangıcından pencere sonuna.
    const postStartMatch = /\[([0-9T:.\-]+Z)\] \[Local storage\] \[page-cache-write\] START/.exec(text);
    const postStart = postStartMatch ? Date.parse(postStartMatch[1]) : measured.ended;
    const postBlocks = loop.blocks.filter(([at]) => at >= postStart && at <= windowEnd).map(([, ms]) => ms);
    let pageCacheWorker = null;
    try {
      const dir = path.join(root, 'local', 'page-cache');
      const file = fs.readdirSync(dir).map(name => path.join(dir, name, 'manifest.json')).find(candidate => fs.existsSync(candidate));
      const perf = file && JSON.parse(fs.readFileSync(file, 'utf8')).performance;
      if (perf) pageCacheWorker = { queueWaitMs: round(perf.queueWaitMs), durationMs: round(perf.durationMs), reusedModules: perf.reusedModules };
    } catch (_) {}
    Object.assign(result, {
      status: 'ok', refreshMs: measured.ended - measured.started, pageCacheWriteMs: pageCache ? Number(pageCache[1]) : null, pageCacheWorker,
      captureMs: markerAt - measured.ended, windowMs: windowEnd - measured.started,
      longestBlockMs: blocks.length ? Math.max(...blocks) : 0, longestPostRefreshBlockMs: postBlocks.length ? Math.max(...postBlocks) : 0,
      postRefreshBlocksOver200: postBlocks.filter(ms => ms > 200).length, postRefreshBlockedOver200Ms: postBlocks.filter(ms => ms > 200).reduce((a, b) => a + b, 0), blocksOver200: blocks.filter(ms => ms > 200).length,
      blockedOver200Ms: blocks.filter(ms => ms > 200).reduce((a, b) => a + b, 0),
      heapPeakMiB: samples.length ? Math.max(...samples.map(s => s[1])) : null, rssPeakMiB: samples.length ? Math.max(...samples.map(s => s[2])) : null,
      stalls: (text.match(/event-loop-stall blockedMs=\d+/g) || []).slice(0, 10),
    });
  } catch (error) {
    result.status = 'error'; result.error = String(error && error.stack || error);
    try { result.logTail = fs.readFileSync(logFile, 'utf8').slice(-4000); } catch (_) {}
    await stop();
  } finally {
    if (!opts.keepFixture) try { removeTemp(root); } catch (_) {}
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = message => process.stderr.write(`[post-refresh] ${message}\n`);
  const source = buildFixture(opts.appRoot, opts.rows);
  const arms = opts.candidateRoot ? [['main', opts.appRoot], ['candidate', opts.candidateRoot]] : [['main', opts.appRoot]];
  const runs = [];
  try {
    for (let pair = 0; pair < (opts.candidateRoot ? opts.pairs : 1); pair++) {
      const order = pair % 2 ? [...arms].reverse() : arms;
      for (const [label, appRoot] of order) { const r = await runOnce({ appRoot, label, source, opts, log }); r.pair = pair; runs.push(r); log(JSON.stringify(r)); }
    }
  } finally { if (!opts.keepFixture) removeTemp(source.holder); }
  const metrics = ['longestPostRefreshBlockMs', 'postRefreshBlocksOver200', 'postRefreshBlockedOver200Ms', 'longestBlockMs', 'blocksOver200', 'blockedOver200Ms', 'refreshMs', 'pageCacheWriteMs', 'captureMs', 'windowMs', 'heapPeakMiB', 'rssPeakMiB'];
  const summary = Object.fromEntries(arms.map(([label]) => [label, Object.fromEntries(metrics.map(m => [m, { median: median(runs.filter(r => r.label === label && r.status === 'ok').map(r => r[m])), samples: runs.filter(r => r.label === label).map(r => r[m]) }]))]));
  const report = { schemaVersion: 1, synthetic: true, source: 'model', lfl: 'cp-run', rows: opts.rows, notes: opts.notes, pairs: opts.pairs, summary, runs };
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (runs.some(r => r.status !== 'ok')) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
