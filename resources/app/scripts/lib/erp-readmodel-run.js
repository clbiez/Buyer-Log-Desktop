'use strict';

/*
 * ERP okuma modeli benchmark'ı (#1072) — tek koşu: yalıtılmış fixture kökü,
 * gerçek server.js, kaynak yenileme, yeniden başlatma, masaüstü köprüsü taklidiyle
 * formdan giriş, açılış sonrası pencere, modül ilk açılışları, CPU profili ve yük boyutları.
 * Uygulama koduna dokunmaz; yalnız gözlemler.
 */

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { requestJson, readRendererMetrics, initializeBenchmarkState, compactRefreshStatus } = require('./startup-benchmark');
const P = require('./erp-readmodel-probe');
const { buildCollectionWorkspace } = require('./erp-collection-fixture');

const PASSWORD = 'synthetic-startup-only-123';
const TEMP_PREFIX = 'buyerlog-startup-';
const MODULES = {
  cp: { ready: () => Boolean(document.querySelector('#cpTable tbody tr[data-id]')), rows: () => window.state?.cp?.rows?.length ?? null },
  orders: { ready: () => Boolean(document.querySelector('#ordersTable tbody tr[data-id]')), rows: () => window.state?.orders?.rows?.length ?? null },
  koleksiyon: {
    ready: () => Boolean(document.querySelector('#kolTable tbody tr[data-id]') || document.getElementById('kolEmptyState')?.offsetParent),
    rows: () => document.querySelectorAll('#kolTable tbody tr[data-id]').length,
  },
  backlog: {
    // #backlogEmpty yükleme ve hata yer tutucusu olarak da kullanılır (showBacklogLoadingState);
    // yalnız BLUI durum işareti taşımayan, görünür boş durum "hazır" sayılır.
    ready: () => {
      if (document.querySelector('#backlogTreeBody tr')) return true;
      const empty = document.getElementById('backlogEmpty');
      return Boolean(empty?.offsetParent && !empty.dataset.uiState && empty.getAttribute('aria-busy') !== 'true');
    },
    failed: () => document.getElementById('backlogEmpty')?.dataset.uiState === 'error',
    rows: () => document.querySelectorAll('#backlogTreeBody tr').length,
  },
  // #1079 WS6d: CP Fiyat Çalışmaları modalı (CP sekmesi açıkken araç çubuğundan). --quotation-cp-rows ile tohumlanır.
  cpquotations: {
    tab: 'cp',
    open: () => document.getElementById('cpQuotationsBtn'),
    ready: () => Boolean(document.querySelector('#quotationModal table.quotationTable tbody tr') || document.querySelector('#quotationModal #quotationDetail')?.textContent.trim()),
    rows: () => document.querySelectorAll('#quotationModal table.quotationTable tbody tr').length,
  },
  // #1079 WS6d: Açık Maliyet editörü. --opencosting-records ile tohumlanır.
  opencosting: {
    ready: () => Boolean(document.getElementById('ocEditor') && !document.getElementById('ocEditor').hidden && document.querySelector('#ocEditor .ocCostSection')) || Boolean(document.getElementById('ocWorkspaceEmpty')?.offsetParent),
    rows: () => document.querySelectorAll('#ocRecordList [data-id], #ocRecordList .ocRecordItem').length,
  },
};
// Tarayıcıda çalışır (kaynak metni olarak gönderilir).
// openButton/tab (isteğe bağlı): sekme düğmesi yerine bir modül içi düğme (ör. CP Fiyat Çalışmaları) tıklanır.
function openModuleInPage(module, isReady, countRows, timeoutMs, isFailed, openButton, tab) {
  return new Promise(resolve => {
    const activeTab = tab || module;
    const button = openButton ? openButton() : (document.querySelector(`#railModules button[data-tab="${module}"]`) || document.querySelector(`button[data-tab="${module}"]`));
    if (!button) { resolve({ module, error: 'tab button missing' }); return; }
    const t0 = performance.now();
    button.click();
    const tick = () => {
      if (document.body.dataset.activeTab === activeTab && isFailed && isFailed()) { resolve({ module, t0, t1: performance.now(), error: 'module error state' }); return; }
      if (document.body.dataset.activeTab === activeTab && isReady()) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ module, t0, t1: performance.now(), rows: countRows() })));
        return;
      }
      if (performance.now() - t0 > timeoutMs) { resolve({ module, t0, t1: performance.now(), timedOut: true, activeTab: document.body.dataset.activeTab }); return; }
      setTimeout(tick, 16);
    };
    tick();
  });
}
// Backlog V3 Genel Bakış paneli (#1079 WS6b): ağaç satırı görününce "hazır" sayılan
// modül, tam satırları (/api/backlog-export?format=json) ondan SONRA indirip normalleştirir.
// --backlog-settle verilirse panel kutucukları (veya hata) görünene kadar beklenir.
function waitBacklogOverviewInPage(t0, timeoutMs) {
  return new Promise(resolve => {
    const tick = () => {
      const host = document.getElementById('backlogOverviewBody'), now = performance.now();
      if (!host || !host.childElementCount && !host.textContent.trim()) { resolve({ t2: now, state: 'absent' }); return; }
      if (!host.querySelector('.bpaLoading') && host.querySelector('.bpaTile, .bpaError')) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ t2: performance.now(), state: host.querySelector('.bpaError') ? 'error' : 'ready' })));
        return;
      }
      if (now - t0 > timeoutMs) { resolve({ t2: now, state: 'timeout' }); return; }
      setTimeout(tick, 16);
    };
    tick();
  });
}
function openModuleExpression(module, spec, timeoutMs) {
  return `(${openModuleInPage})(${JSON.stringify(module)}, ${spec.ready}, ${spec.rows}, ${Number(timeoutMs)}, ${spec.failed || 'null'}, ${spec.open || 'null'}, ${JSON.stringify(spec.tab || '')})`;
}
// #1079 WS6d: Açık Maliyet meta alanına yazma (her tuş öneri listesini yeniden kurar). Tarayıcıda çalışır.
function typeOpenCostingInPage(text, settleMs) {
  return new Promise(resolve => {
    const input = document.querySelector('#ocEditor input[data-oc-meta="modelCode"]');
    if (!input) { resolve({ error: 'model input missing' }); return; }
    input.focus();
    input.value = '';
    const t0 = performance.now(), chars = [...String(text)];
    let i = 0;
    const step = () => {
      if (i >= chars.length) { setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ t0, t1: performance.now(), keys: chars.length, options: document.querySelectorAll('.ocMetaSuggestDrop .submfrDropItem').length }))), settleMs); return; }
      input.value += chars[i++];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(step, 0);
    };
    step();
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// İlk görünme anı izlenen bölgeler (#1077): Genel Bakış CP özet kartı (eski ve model yolu aynı kap).
const WATCH = { cpCards: '#cpAssistant .cpaOverviewMetrics', flowMap: '#globalFlowMeta[data-tone="normal"], #globalFlowMeta[data-tone="warn"]' };

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX + label + '-'));
  if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith(TEMP_PREFIX)) throw Error('Unexpected temp root: ' + dir);
  return dir;
}
function removeTemp(dir) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(TEMP_PREFIX)) throw Error('Refusing to remove non-benchmark dir: ' + dir);
  fs.rmSync(resolved, { recursive: true, force: true });
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

// Aynı kaynak baytları main ve aday için bir kez üretilir (seed 7).
function prepareSource({ harnessRoot, rows, sourceFixture }) {
  if (sourceFixture) {
    const resolved = fs.realpathSync(sourceFixture);
    const meta = JSON.parse(fs.readFileSync(path.join(resolved, 'benchmark-fixture.json'), 'utf8'));
    if (meta.synthetic !== true || meta.rows !== rows) throw Error('Source fixture row count mismatch');
    return { dir: resolved, owned: false, meta };
  }
  const holder = tempDir('erp-src'), dir = path.join(holder, 'source');
  fs.mkdirSync(dir);
  const generated = spawnSync(process.execPath, [path.join(harnessRoot, 'scripts', 'generate-demo-data.js'), dir, '--rows', String(rows), '--seed', '7'], { cwd: harnessRoot, encoding: 'utf8' });
  if (generated.status !== 0) throw Error(generated.stderr || 'Demo generation failed');
  const hashes = Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.xlsx')).sort().map(f => [f, sha256File(path.join(dir, f))]));
  const meta = { synthetic: true, rows, seed: 7, generatedAt: new Date().toISOString(), hashes };
  fs.writeFileSync(path.join(dir, 'benchmark-fixture.json'), JSON.stringify(meta, null, 2));
  return { dir, owned: true, holder, meta };
}
function verifySource(dir, meta) {
  for (const [file, hash] of Object.entries(meta.hashes)) if (path.basename(file) !== file || sha256File(path.join(dir, file)) !== hash) throw Error('Fixture checksum mismatch: ' + file);
}

function gitRevision(appRoot) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

/*
 * runOnce({ appRoot, label, source, chromium, options }) → ölçüm nesnesi.
 * options: { postOpenTimeoutMs, settleMs, moduleTimeoutMs, modules, topN, keepFixture, log }
 */
async function runOnce({ appRoot, label, source, chromium, options }) {
  const log = options.log || (() => {});
  const root = tempDir('erp');
  const logFile = path.join(root, 'server.log');
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_LOCAL_DB: path.join(root, 'local', 'BuyerLogLocal.db'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'), BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp') };
  const result = { label, appRoot, revision: gitRevision(appRoot), fixtureRoot: root, status: 'running', startedAt: new Date().toISOString() };
  let server = null, browser = null, base = '', cookie = '';
  const api = (url, init = {}) => requestJson(base + url, { ...init, headers: { cookie, 'Content-Type': 'application/json', ...init.headers } });
  async function start() {
    const started = performance.now(), fd = fs.openSync(logFile, 'a');
    server = spawn(process.execPath, [path.join(appRoot, 'server', 'server.js')], { cwd: appRoot, env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    let spawnError; server.on('error', e => { spawnError = e; });
    for (let i = 0; i < 120; i++) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw Error('Server exited: ' + server.exitCode);
      try { await api('/api/status'); return performance.now() - started; } catch (_) { /* henüz hazır değil */ }
      await delay(250);
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
  async function apiLogin() {
    const response = await fetch(base + '/api/user-login', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'moderator', password: PASSWORD, newPassword: PASSWORD }) });
    if (!response.ok) throw Error('Synthetic login failed: ' + response.status);
    cookie = String(response.headers.get('set-cookie') || '').split(';')[0];
  }
  try {
    const dataSource = path.join(root, 'source');
    fs.cpSync(source.dir, dataSource, { recursive: true });
    verifySource(dataSource, source.meta);
    initializeBenchmarkState(root);
    const port = await freePort();
    base = 'http://127.0.0.1:' + port;
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, sourceFolder: dataSource, host: '127.0.0.1' }));
    // 1) İlk başlatma + kaynak yenileme (sayfa önbelleği üretilir).
    await start(); await apiLogin();
    const refreshStarted = performance.now();
    await api('/api/refresh', { method: 'POST', body: '{}' });
    let refresh = null;
    for (let i = 0; i < 1200; i++) {
      refresh = compactRefreshStatus(await api('/api/refresh-status'));
      if (!refresh.running) { if (refresh.error) throw Error(JSON.stringify(refresh.error)); break; }
      await delay(500);
    }
    if (!refresh || refresh.running) throw Error('Synthetic refresh timed out');
    result.refreshWallMs = P.round(performance.now() - refreshStarted);
    // 1b) İsteğe bağlı sentetik Koleksiyon çalışma alanı (#1079): WS0 fixture'ında Koleksiyon boştur.
    if (options.collectionRows > 0) {
      const list = await api('/api/collection-workspaces');
      const ownerId = list && list.currentOwnerId;
      if (!ownerId) throw Error('Collection owner missing');
      const workspace = buildCollectionWorkspace(options.collectionRows, 7);
      const saved = await api('/api/collection-workspaces/' + encodeURIComponent(ownerId), { method: 'PUT', body: JSON.stringify(workspace) });
      if (!saved || !saved.ok || saved.workspace?.rowCount !== options.collectionRows) throw Error('Collection seed failed: ' + JSON.stringify(saved).slice(0, 200));
      result.collectionRows = options.collectionRows;
    }
    // 1c) İsteğe bağlı CP Fiyat Çalışması ve Açık Maliyet kaydı (#1079 WS6d). Satırlar gerçek CP
    // projeksiyonundan alınır; kalem biçimi BL_QUOTATIONS.recordRequest ile aynıdır.
    if (options.quotationCpRows > 0 || options.openCostingRecords > 0) {
      const cp = await api('/api/data/cp');
      const cpRows = Array.isArray(cp && cp.rows) ? cp.rows : [];
      if (cpRows.length < options.quotationCpRows) throw Error('CP rows missing for quotation seed');
      const s = v => String(v == null ? '' : v).trim();
      if (options.quotationCpRows > 0) {
        const step = Math.max(1, Math.floor(cpRows.length / options.quotationCpRows)), picked = [];
        for (let i = 0; i < options.quotationCpRows; i++) picked.push(cpRows[(i * step) % cpRows.length]);
        const mfrs = [{ name: 'Synthetic Supplier A', email: '' }, { name: 'Synthetic Supplier B', email: '' }], now = new Date().toISOString();
        const items = [];
        picked.forEach((row, ri) => mfrs.forEach((m, mi) => items.push({ id: `quote-${ri}-${mi}-seed`, modelKey: `cp:${s(row._sourceOrderCode) || s(row.plmId) || s(row.modelKod) || ri}`, rowId: null,
          orderCode: s(row._sourceOrderCode || row['Order Code']), plmId: s(row.plmId || row['PLM ID']), modelCode: s(row.modelKod || row['Model Name']), license: s(row.lisans || row.License),
          category: s(row.urunTipi || row.Category), colour: s(row.colour || row.Colour), colourCode: s(row.colourCode || row['C.Code'] || row['Colour Code']), fabric: '', season: s(row.season || row.Season),
          picture: '', inStoreMonth: s(row.inStoreMonth || row['In Store Month']), quantity: Number(row['Order Quantity']) || null, manufacturer: m.name, manufacturerEmail: '', price: mi ? '' : '4,25', approved: false, dropped: false })));
        const created = await api('/api/quotations', { method: 'POST', body: JSON.stringify({ id: 'quotation-ws6d-seed', source: 'cp', createdAt: now, updatedAt: now, status: 'active', closedAt: '', editorIds: [], note: '', capacityConfirmed: false, manufacturers: mfrs, items }) });
        if (!created || !created.ok || created.request?.items?.length !== items.length) throw Error('Quotation seed failed: ' + JSON.stringify(created).slice(0, 200));
        result.quotationCpLines = items.length;
      }
      for (let i = 0; i < options.openCostingRecords; i++) {
        const row = cpRows[(i * 997) % cpRows.length];
        const saved = await api('/api/open-costing', { method: 'POST', body: JSON.stringify({ title: 'Synthetic costing ' + (i + 1), meta: { modelCode: s(row['Model Name']), manufacturer: s(row['Sub-Manufacturer'] || row.Manufacturer), season: s(row.Season), currency: 'USD' }, sections: {}, rates: {} }) });
        if (!saved || !saved.item) throw Error('Open costing seed failed: ' + JSON.stringify(saved).slice(0, 200));
      }
      result.openCostingRecords = options.openCostingRecords;
    }
    // 2) Sıcak olmayan yeniden başlatma: ölçülen açılış önbellekten gelir.
    await stop();
    result.backendStartupMs = P.round(await start());
    cookie = '';
    const access = JSON.parse(fs.readFileSync(path.join(root, 'data', 'user-access.json'), 'utf8'));
    const username = access?.moderator?.username;
    if (!username) throw Error('Fixture moderator username missing');
    // 3) Tarayıcı.
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
    result.chromium = browser.version();
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'tr-TR' });
    await context.addInitScript(P.installErpProbe, { lagIntervalMs: 50, bridge: true, flags: options.flags || {}, watch: WATCH });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    const cdp = await context.newCDPSession(page);
    // Yük boyutları (yalnız /api/page-projection/* ve /api/data*).
    let phase = 'login';
    const requests = new Map(), payloads = [];
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
    cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
      const url = new URL(request.url);
      // --backlog-settle: Backlog yükleri ve V3 okuma modeli (#1079 WS6c) istekleri, süre ve sunucu zamanlamasıyla.
      const backlogRead = options.backlogSettle && (url.pathname.startsWith('/api/backlog') || url.pathname.startsWith('/api/read-model/backlog/'));
      if (url.origin === base && (P.isTrackedPayload(url.pathname) || backlogRead)) requests.set(requestId, { path: url.pathname, query: url.search, phase, decodedBytes: 0, ...(backlogRead ? { startedAt: timestamp } : {}) });
    });
    cdp.on('Network.responseReceived', ({ requestId, response, timestamp }) => {
      const r = requests.get(requestId); if (!r) return;
      r.status = response.status;
      if (r.startedAt !== undefined) {
        r.responseMs = P.round((timestamp - r.startedAt) * 1000);
        const timing = Object.entries(response.headers || {}).find(([key]) => key.toLowerCase() === 'x-read-model-timing');
        if (timing) try { r.serverTiming = JSON.parse(timing[1]); } catch (_) { /* biçimsiz başlık */ }
      }
    });
    cdp.on('Network.dataReceived', ({ requestId, dataLength }) => { const r = requests.get(requestId); if (r) r.decodedBytes += dataLength; });
    cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength, timestamp }) => {
      const r = requests.get(requestId);
      if (r) { r.encodedBytes = encodedDataLength; if (r.startedAt !== undefined) { r.totalMs = P.round((timestamp - r.startedAt) * 1000); delete r.startedAt; } payloads.push(r); requests.delete(requestId); }
    });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
    // 4) Formdan giriş.
    await page.goto(base + '/select-user.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('#username').fill(username);
    const option = page.locator('#suggestions [role="option"]').first();
    if (await option.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
      await option.click();
      await page.locator('#suggestions').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    await page.locator('#password').fill(PASSWORD);
    phase = 'startup';
    await page.locator('#loginBtn').click({ noWaitAfter: true });
    await page.waitForURL(base + '/', { waitUntil: 'commit', timeout: 120000 });
    await page.waitForFunction(() => Number.isFinite(window.__erpProbe?.events['bl:startup-ready']), null, { timeout: options.moduleTimeoutMs, polling: 100 });
    await page.evaluate(() => { window.BLBootGuard?.continue?.({ intentAtMs: window.__erpProbe.events['bl:startup-ready'] }); });
    await page.waitForFunction(() => Number.isFinite(window.__erpProbe?.events['bl:startup-complete']), null, { timeout: options.moduleTimeoutMs, polling: 100 });
    // 4b) İsteğe bağlı erken modül açılışı (#1077): açılıştan hemen sonra, ön ısıtma /
    // Genel Bakış modeli işçiyi kullanırken bir modül açılır (ör. Siparişler ilk penceresi).
    let early = null;
    if (options.earlyModule) {
      phase = 'early:' + options.earlyModule;
      await delay(options.earlyDelayMs || 0);
      const spec = MODULES[options.earlyModule];
      early = await page.evaluate(openModuleExpression(options.earlyModule, spec, options.moduleTimeoutMs));
      log(`  ${label} early ${options.earlyModule}: ${early.timedOut ? 'TIMEOUT' : P.round(early.t1 - early.t0) + ' ms'}`);
    }
    // 5) Açılış sonrası pencere: BACKGROUND_WARMUP_DONE veya süre sınırı. --post-open-window-ms
    // verilirse iki kol için de sabit pencere (bl:startup-complete + N ms) kullanılır.
    phase = 'post-open';
    const warmupDone = options.postOpenWindowMs
      ? await page.waitForFunction(ms => performance.now() >= window.__erpProbe.events['bl:startup-complete'] + ms, options.postOpenWindowMs, { timeout: options.postOpenWindowMs + 60000, polling: 250 }).then(() => false, () => false)
      : await page.waitForFunction(() => window.BLPerf?.timeline?.().some(m => m.name === 'BACKGROUND_WARMUP_DONE'), null, { timeout: options.postOpenTimeoutMs, polling: 250 }).then(() => true, () => false);
    const post = await page.evaluate(() => {
      const p = window.__erpProbe, origin = window.BLPerf?.origin?.() ?? 0;
      const done = (window.BLPerf?.timeline?.() || []).find(m => m.name === 'BACKGROUND_WARMUP_DONE');
      return { events: p.events, anchor: p.anchor, now: performance.now(), warmupDonePerfMs: done ? done.atMs + origin : null };
    });
    const openMs = post.events['bl:startup-complete'];
    const postEnd = options.postOpenWindowMs ? Math.min(post.now, openMs + options.postOpenWindowMs)
      : warmupDone && Number.isFinite(post.warmupDonePerfMs) ? post.warmupDonePerfMs : post.now;
    result.heapAfterPostOpen = await readRendererMetrics(context, page, 30000);
    // Isınma bittikten sonra sakinleşme; modül ölçümü warmup ile karışmaz.
    await delay(options.settleMs);
    // 6) Modül ilk açılışları: tıklama → tablo satırı (veya boş durum) görünür + 2 kare.
    const moduleResults = [];
    for (const module of options.modules) {
      phase = 'module:' + module;
      const spec = MODULES[module];
      // Kaynak metin olarak gömülür: sayfa CSP'si new Function/eval'e izin vermeyebilir.
      const measured = await page.evaluate(openModuleExpression(module, spec, options.moduleTimeoutMs));
      if (module === 'backlog' && options.backlogSettle && Number.isFinite(measured.t0) && !measured.timedOut && !measured.error) {
        measured.settle = await page.evaluate(`(${waitBacklogOverviewInPage})(${Number(measured.t0)}, ${Number(options.moduleTimeoutMs)})`);
        log(`  ${label} backlog overview: ${measured.settle.state} ${P.round(measured.settle.t2 - measured.t0)} ms`);
      }
      moduleResults.push(measured);
      log(`  ${label} ${module}: ${measured.timedOut ? 'TIMEOUT' : P.round(measured.t1 - measured.t0) + ' ms'}`);
      await delay(options.settleMs);
      // #1079 WS6d: --opencosting-type TEXT ile modül açıldıktan sonra model alanına tuş tuş yazılır.
      if (module === 'opencosting' && options.openCostingType && !measured.timedOut && !measured.error) {
        phase = 'module:opencosting-type';
        const typed = await page.evaluate(`(${typeOpenCostingInPage})(${JSON.stringify(options.openCostingType)}, 0)`);
        moduleResults.push({ module: 'opencosting-type', ...typed });
        log(`  ${label} opencosting-type: ${typed.error || P.round(typed.t1 - typed.t0) + ' ms / ' + typed.keys + ' keys'}`);
        await delay(options.settleMs);
      }
      if (module === 'cpquotations') await page.evaluate(() => document.querySelector('#quotationModal [data-close-quotation]')?.click());
    }
    phase = 'done';
    // Sunucu süreci belleği (Linux /proc; işçi iş parçacıkları aynı süreçte): anlık RSS ve tepe.
    try {
      const status = fs.readFileSync(`/proc/${server.pid}/status`, 'utf8'), kb = name => Number((status.match(new RegExp(name + ':\\s+(\\d+)')) || [])[1]);
      result.serverMemory = { rssMB: P.round(kb('VmRSS') / 1024), peakMB: P.round(kb('VmHWM') / 1024) };
    } catch (_) { result.serverMemory = null; }
    const { profile } = await cdp.send('Profiler.stop');
    const final = await page.evaluate(() => ({ longTasks: window.__erpProbe.longTasks, lag: window.__erpProbe.lag, longTaskUnsupported: !!window.__erpProbe.longTaskUnsupported,
      timeline: window.BLPerf?.timeline?.() || [], origin: window.BLPerf?.origin?.() ?? 0, anchor: window.__erpProbe.anchor }));
    result.heapFinal = await readRendererMetrics(context, page, 30000);
    // 7) Analiz.
    const windows = [
      { name: 'startup', startMs: 0, endMs: openMs },
      { name: 'post-open', startMs: openMs, endMs: postEnd },
      ...moduleResults.filter(m => Number.isFinite(m.t0)).map(m => ({ name: 'module:' + m.module, startMs: m.t0, endMs: m.t1 })),
      ...moduleResults.filter(m => m.settle && Number.isFinite(m.settle.t2)).map(m => ({ name: 'module:' + m.module + ':settle', startMs: m.t0, endMs: m.settle.t2 })),
    ];
    result.events = Object.fromEntries(Object.entries(post.events).map(([k, v]) => [k, P.round(v)]));
    result.postOpen = {
      startMs: P.round(openMs), endMs: P.round(postEnd), durationMs: P.round(postEnd - openMs),
      endReason: options.postOpenWindowMs ? 'fixed-window' : warmupDone ? 'BACKGROUND_WARMUP_DONE' : 'timeout', timeoutMs: options.postOpenTimeoutMs,
      longTasks: P.longTaskStats(final.longTasks, openMs, postEnd), eventLoopLag: P.lagStats(final.lag, openMs, postEnd),
      jsHeapUsedBytes: result.heapAfterPostOpen.jsHeapUsedBytes,
    };
    result.startup = { longTasks: P.longTaskStats(final.longTasks, 0, openMs), eventLoopLag: P.lagStats(final.lag, 0, openMs) };
    if (early) result.early = { ...early, t0: P.round(early.t0), t1: P.round(early.t1), openMs: Number.isFinite(early.t0) ? P.round(early.t1 - early.t0) : null,
      sinceStartupCompleteMs: Number.isFinite(early.t0) ? P.round(early.t0 - openMs) : null, longTasks: Number.isFinite(early.t0) ? P.longTaskStats(final.longTasks, early.t0, early.t1) : null };
    result.modules = moduleResults.map(m => ({
      ...m, t0: P.round(m.t0), t1: P.round(m.t1), openMs: Number.isFinite(m.t0) ? P.round(m.t1 - m.t0) : null,
      longTasks: Number.isFinite(m.t0) ? P.longTaskStats(final.longTasks, m.t0, m.t1) : null,
      eventLoopLag: Number.isFinite(m.t0) ? P.lagStats(final.lag, m.t0, m.t1) : null,
      ...(m.settle ? { settle: { state: m.settle.state, t2: P.round(m.settle.t2), settledMs: P.round(m.settle.t2 - m.t0),
        longTasks: P.longTaskStats(final.longTasks, m.t0, m.settle.t2), eventLoopLag: P.lagStats(final.lag, m.t0, m.settle.t2) } } : {}),
    }));
    result.cpu = P.analyzeProfile(profile, { anchorPerfMs: final.anchor?.startMs, windows, topN: options.topN });
    if (!result.cpu.aligned) result.cpu.warning = 'Profile anchor not found; CPU windows unavailable';
    result.timeline = P.timelineToPerf(final.timeline, final.origin);
    result.payloads = { entries: payloads.map(p => ({ ...p })), byPath: P.summarizePayloads(payloads) };
    result.raw = { longTasks: final.longTasks.map(t => [P.round(t.startTime), P.round(t.duration)]), eventLoopLag: final.lag.map(([a, l]) => [P.round(a), P.round(l)]), longTaskUnsupported: final.longTaskUnsupported };
    result.errors = errors;
    result.status = moduleResults.some(m => m.timedOut || m.error || m.settle?.state === 'timeout' || m.settle?.state === 'error') || early?.timedOut || early?.error ? 'partial' : 'passed';
    await cdp.detach().catch(() => {});
  } catch (error) {
    result.status = 'failed';
    result.error = { message: error.message, stack: error.stack };
    try { result.serverLogTail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-40); } catch (_) { /* yok */ }
  } finally {
    try { if (browser) await browser.close(); } finally { await stop(); }
    result.finishedAt = new Date().toISOString();
    if (!options.keepFixture) { removeTemp(root); result.fixtureRoot = null; }
  }
  return result;
}

module.exports = { runOnce, prepareSource, removeTemp, tempDir, MODULES, TEMP_PREFIX };
