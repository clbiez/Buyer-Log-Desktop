'use strict';

// Runs the actual Orders page against the same synthetic workbook in each checkout.
// See README.md for the invocation, budgets, and results.
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const [main, candidate, output] = process.argv.slice(2).map(value => path.resolve(value));
assert.ok(main && candidate && output, 'Usage: node measure.cjs <main checkout> <candidate checkout> <output.json>');
const appOf = checkout => path.join(checkout, 'resources/app');
const app = appOf(candidate);
const XLSX = require(path.join(app, 'node_modules/xlsx'));
const { build } = require(path.join(app, 'scripts/generate-demo-data'));
const { initializeBenchmarkState } = require(path.join(app, 'scripts/lib/startup-benchmark'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = input => createHash('sha256').update(input).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const variants = { A: main, B: candidate };
const root = fs.mkdtempSync(path.join(process.env.BL_ACCEPTANCE_WORK || os.tmpdir(), 'orders-grid-l2-'));
const chrome = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const sizes = (process.env.BL_BENCH_ROWS || '1200,30000').split(',').map(Number);
const orders = (process.env.BL_BENCH_PAIRS || 'AB,BA,AB').split(',');
assert.ok(sizes.every(size=>size>300)&&orders.every(pair=>['AA','AB','BA'].includes(pair)));
const sources = git(candidate, 'diff', '--name-only', git(main, 'rev-parse', 'HEAD')).split('\n')
  .filter(file => /^resources\/app\/public\/.*\.(?:js|css|html)$/.test(file));
const report = {
  env: { chromium: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim(), node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model,
    viewport: [1600, 820], reducedMotion: true, harness: sha(fs.readFileSync(__filename)) },
  main: git(main, 'rev-parse', 'HEAD'), candidateParent: git(candidate, 'rev-parse', 'HEAD'),
  runtime: Object.fromEntries(sources.map(file => [file, sha(fs.readFileSync(path.join(candidate, file)))])),
  sizes: {}, runs: [],
};
const persist = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');

function fixture(count) {
  const dir = path.join(root, 'source-' + count);
  fs.mkdirSync(dir);
  const demo = build({ rows: count, seed: 11, today: new Date('2026-11-06T00:00:00Z') });
  const files = {};
  for (const [name, sheet, rows] of [['ASAS.xlsx', 'ASAS', demo.asas], ['Antrepo.xlsx', 'Antrepo', demo.antrepo]]) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
    const file = path.join(dir, name);
    XLSX.writeFile(book, file);
    files[name] = sha(fs.readFileSync(file));
  }
  report.sizes[count] = files;
  return dir;
}

async function demoServer(checkout, source, label) {
  const dir = path.join(root, label), cwd = appOf(checkout);
  fs.mkdirSync(dir);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
    BUYER_LOG_CONFIG_PATH: path.join(dir, 'config.json'), BUYER_LOG_SERVER_DATA_ROOT: path.join(dir, 'data'),
    BUYER_LOG_AUTH_DATA_ROOT: path.join(dir, 'data'), BUYER_LOG_DATA_ROOT: path.join(dir, 'app'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(dir, 'local'), BUYER_LOG_LOCAL_DB: path.join(dir, 'local/BuyerLogLocal.db'),
    BUYER_LOG_TEMP_ROOT: path.join(dir, 'tmp') };
  initializeBenchmarkState(dir);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  const server = spawn(process.execPath, ['server/server.js'], { cwd, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const close = async () => {
    if(server.exitCode!==null||server.signalCode)return;
    const closed=new Promise(resolve=>server.once('exit',resolve));
    server.kill();
    await closed;
  };
  let cookie = '';
  async function api(url, method, body) {
    const response = await fetch(base + url, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(120000), headers: { cookie, 'Content-Type': 'application/json' } });
    assert.ok(response.ok, url + ' ' + response.status);
    return response;
  }
  try {
    const end = Date.now() + 30000;
    for (;;) {
      assert.ok(server.exitCode === null && Date.now() < end, 'Server failed to become ready: ' + dir);
      try { await api('/api/health'); break; } catch (_) { await delay(200); }
    }
    const password = 'synthetic-grid-benchmark-11';
    const login = await api('/api/user-login', 'POST', { userId: 'moderator', password, newPassword: password });
    cookie = login.headers.get('set-cookie').split(';')[0];
    await api('/api/refresh', 'POST', {});
    const deadline = Date.now() + 600000;
    for (;;) {
      const status = await (await api('/api/refresh-status')).json();
      if (!status.running) { assert.equal(status.error, null); break; }
      assert.ok(Date.now() < deadline, 'Synthetic refresh timed out: ' + dir);
      await delay(500);
    }
    return { base, cookie, close };
  } catch (error) { await close(); throw error; }
}

function installProbe() {
  window.gridBench = { tasks: [], primary: null };
  window.addEventListener('bl:primary-screen-ready', () => { window.gridBench.primary = performance.now(); }, { once: true });
  new PerformanceObserver(list => {
    window.gridBench.tasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
  }).observe({ type: 'longtask', buffered: true });
  localStorage.setItem('bl.user.moderator.bl.tableRange.orders.v1', 'all');
  for (const key of ['bl.releaseNotes.lastSeenStable.v1', 'bl.user.moderator.bl.releaseNotes.lastSeenStable.v1']) localStorage.setItem(key, '99.0.0');
}

async function measure(server,variant,count) {
  const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 820 }, reducedMotion: 'reduce' });
    const split = server.cookie.indexOf('=');
    await context.addCookies([{ name: server.cookie.slice(0, split), value: server.cookie.slice(split + 1), url: server.base }]);
    await context.addInitScript(installProbe);
    const page = await context.newPage();
    const requests = new Map(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Performance.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.startsWith(server.base+'/api/')) requests.set(event.requestId, { path: new URL(event.request.url).pathname, bytes: 0 });
    });
    cdp.on('Network.loadingFinished', event => {
      const request = requests.get(event.requestId);
      if (request) request.bytes = event.encodedDataLength;
    });
    await page.goto(server.base + '/?module=orders', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForSelector('[data-boot-continue]', { timeout: 180000 });
    // Isolate Orders from the application's existing idle module preload in both versions.
    await page.evaluate(() => { backgroundWarmupStarted = true; });
    await page.click('[data-boot-continue]');
    await page.waitForFunction(() => !document.getElementById('blBootGuard') && document.querySelector('#ordersTable tbody tr[data-id]'));
    const first = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const table = document.getElementById('ordersTable');
      return { usableMs: performance.now(), readyMs: window.gridBench.primary, rows: state.orders.rows.length, rendered: table.querySelectorAll('tbody tr[data-id]').length, cells: table.querySelectorAll('tbody td').length, cpLoaded: Boolean(state.cp) };
    });
    assert.equal(first.cpLoaded, false);
    assert.equal(first.rows, count);
    await page.waitForFunction(() => !window.isAreaFrozen?.('orders'));
    const tableOps = () => page.evaluate(async () => {
      const table = document.getElementById('ordersTable'), wrap = table.closest('.tablewrap');
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const waitFor = async test => {
        const deadline = performance.now()+20000;
        while (!test()) { if (performance.now()>deadline) throw Error('Orders table did not paint'); await frame(); }
        await frame();
      };
      const firstRow = () => table.querySelector('tbody tr[data-id]')?.dataset.id;
      const scroll = [];
      for (const fraction of [.1,.4,.75,.9,.25,0]) {
        const previous = firstRow(), start = performance.now();
        wrap.scrollTop = wrap.scrollHeight*fraction;
        await waitFor(() => firstRow()!==previous);
        scroll.push({ start, end: performance.now() });
      }
      const search = document.getElementById('ordersSearch');
      const filters = [];
      for (const code of ['4100050','4100250','4100300']) {
        const start = performance.now();
        search.value = code;
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => table._blRenderedRows.length === 1 && String(table._blRenderedRows[0]['Order Code']) === code);
        filters.push({ start, end: performance.now() });
      }
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await waitFor(() => table._blRenderedRows.length>300);
      return { scroll, filters, cells: table.querySelectorAll('tbody td').length };
    });
    assert.equal(await page.locator('#ordersTableToolbar [data-range-size]').inputValue(),'all');
    const cold = await tableOps();
    const coldRequests = [...requests.values()];
    assert.ok(!coldRequests.some(request => /\/api\/(?:page-projection|data)\/cp$/.test(request.path)));
    let edit = null;
    if (variant === 'B') {
      edit = await page.evaluate(() => {
        const td = document.querySelector('#ordersTable td[data-key="Supp. FOB"].viewOnlyCell');
        if(!td)throw Error('Expected a locked price on cold Orders');
        const start = performance.now(), cpBefore = Boolean(state.cp);
        return new Promise((resolve,reject)=>{
          let feedback = null, measuringFeedback = false;
          const observer=new MutationObserver(()=>{
            if(!measuringFeedback&&[...document.querySelectorAll('.uiFeedbackMessage,#_toast')].some(node=>node.textContent.includes('Düzenleme yetkileri yükleniyor'))){
              measuringFeedback=true;
              requestAnimationFrame(()=>requestAnimationFrame(()=>{feedback=performance.now()-start;}));
            }
            if(document.activeElement?.dataset.kind==='suppfob'){
              observer.disconnect();clearTimeout(timer);
              resolve({ feedback, editorMs:performance.now()-start, cpBefore });
            }
          });
          observer.observe(document.body,{childList:true,subtree:true});
          const timer=setTimeout(()=>{observer.disconnect();reject(Error('Lazy editor did not open'));},30000);
          td.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
          document.getElementById('ordersTable').dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));
        });
      });
      await page.keyboard.press('Escape');
    } else {
      await page.evaluate(()=>ensureCpLoaded({ deferRender:true, reason:'orders-benchmark' }));
      await page.evaluate(()=>renderOrders());
    }
    // The first candidate edit leaves a selection and focus. Compare warm
    // scrolling from the same grid state in both variants.
    await page.evaluate(async () => {
      window.BLGridClipboard.clear('ordersTable');
      document.activeElement?.blur();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const warm = await tableOps();
    const memory = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const dom = await cdp.send('Memory.getDOMCounters');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return { ...dom, jsHeapUsedBytes: metrics.find(metric=>metric.name==='JSHeapUsedSize').value };
    };
    const retention = [await memory()], reopen = [];
    for (let cycle=0;cycle<5;cycle++) {
      reopen.push(await page.evaluate(async () => {
        // Use the app's tab switcher. CP has already been loaded by intent.
        const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        switchTab('cp');
        await paint();
        const start = performance.now();
        switchTab('orders');
        await paint();
        return { start, end: performance.now() };
      }));
      retention.push(await memory());
    }
    const tasks = await page.evaluate(() => window.gridBench.tasks);
    assert.deepEqual(errors, []);
    return { first, cold, warm, edit, reopen, retention, tasks, coldRequests, requests: [...requests.values()] };
  } finally { await browser.close(); }
}

(async () => {
  for (const count of sizes) {
    const source = fixture(count), servers = {};
    persist();
    try {
      for (const variant of new Set(orders.join(''))) {
        console.error('Prepare', count, variant);
        servers[variant] = await demoServer(variants[variant], source, count + '-' + variant);
      }
      for (const [index, order] of orders.entries()) for (const variant of order) {
        console.error('Measure', count, index+1, variant);
        const values = await measure(servers[variant],variant,count);
        report.runs.push({ count, pair: index+1, variant, ...values });
        persist();
      }
    } finally {
      for (const server of Object.values(servers)) await server.close();
    }
  }
  console.log(output);
})().catch(error => { console.error(root, error); process.exitCode=1; });
