#!/usr/bin/env node
'use strict';

/*
 * LFL /api/lfl yanıt boyutu + LFL ekranı açılış süresi + renderer heap ölçümü.
 *
 * İzole bir kökte GERÇEK server.js başlatılır; generate-demo-data.js LFL satırları
 * üretim ASAS genişliğine (~41 sütun) sentetik sütunlarla genişletilip
 * /api/lfl/upload ile yüklenir (gerçek parseLflBuffer → parseDetectedSheet yolu).
 * Kullanıcı verisi okunmaz. Aynı betik main ve aday çalışma kopyasında
 * (--app-root) koşturularak L2 A/B yapılır.
 *
 *   node scripts/benchmark-lfl-asas-payload.js [--app-root <dir>] [--rows 35000] [--port 6491]
 *        [--breakdown "Asas Ek Alan 03"] [--out <json>]
 */

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const XLSX = require('xlsx');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const app = path.resolve(arg('--app-root', path.join(__dirname, '..')));
const asasRows = Number(arg('--rows', 35000)) || 35000;
const port = Number(arg('--port', 6491)) || 6491;
const breakdownHeader = arg('--breakdown', '');
const out = arg('--out', '');
const base = `http://127.0.0.1:${port}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-lfl-asas-bench-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const MiB = n => +(n / 1048576).toFixed(2);

// Üretim ASAS LFL sorgusunun genişliği (~41 sütun) — değerler deterministik ve sentetiktir.
const EXTRA = Array.from({ length: 28 }, (_, i) => `Asas Ek Alan ${String(i + 1).padStart(2, '0')}`);
function extraValue(col, row) {
  switch (col % 7) {
    case 0: return `KOD-${(row * 31 + col) % 9973}`;
    case 1: return ['DEMO GRUP A', 'DEMO GRUP B', 'DEMO GRUP C', 'DEMO GRUP D'][(row + col) % 4];
    case 2: return `2026-${String(1 + (row + col) % 12).padStart(2, '0')}-${String(1 + (row % 28)).padStart(2, '0')}`;
    case 3: return ((row * 7 + col) % 1000) / 10;
    case 4: return `Sentetik açıklama metni ${(row + col) % 211}`;
    case 5: return (row + col) % 3 ? 'EVET' : 'HAYIR';
    default: return `${(row * 13 + col) % 100000}`;
  }
}
function lflWorkbook() {
  const { build } = require(path.join(__dirname, 'generate-demo-data'));
  const data = build({ rows: asasRows, seed: 7, today: new Date(Date.UTC(2026, 10, 5)) });
  const header = [...data.lfl[1], ...EXTRA];
  const body = data.lfl.slice(2).map((row, r) => [...row, ...EXTRA.map((_, c) => extraValue(c, r))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'LFL');
  return { buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }), rows: body.length, columns: header.length };
}

let server, browser;
async function stop() {
  if (browser) await browser.close().catch(() => {});
  if (!server || server.exitCode !== null) return;
  const done = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([done, delay(10000)]);
  if (server.exitCode === null) { server.kill('SIGKILL'); await done; }
}

(async () => {
  const env = { ...process.env, BUYER_LOG_CENTRAL_IAM_ENABLED: '0', BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
    BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_TEMP_ROOT: path.join(root, 'temp'),
    BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
  for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_TEMP_ROOT']) fs.mkdirSync(env[key], { recursive: true });
  fs.mkdirSync(path.join(root, 'source'));
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, sourceFolder: path.join(root, 'source') }));
  const log = fs.openSync(path.join(root, 'server.log'), 'a');
  server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
  server.on('exit', (code, signal) => { if (code || signal) console.error('server exited', code, signal); });
  for (let i = 0; i < 160; i++) { try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(500) })).status < 500) break; } catch (_) {} await delay(250); }
  const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', newPassword: 'demo-lfl-bench-123', password: 'demo-lfl-bench-123' }) });
  assert.equal(login.status, 200, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (url, body) => {
    const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    assert.equal(res.status, 200, text.slice(0, 400));
    return text;
  };
  await api('/api/lfl');
  const book = lflWorkbook();
  // Büyük gövde Node http ile gönderilir (undici fetch büyük gövdede EPIPE verebiliyor).
  await new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: 'synthetic-lfl.xlsx', dataBase64: book.buffer.toString('base64') });
    const req = require('node:http').request({ host: '127.0.0.1', port, path: '/api/lfl/upload', method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.on('data', chunk => { if (text.length < 400) text += chunk; }); res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(`upload ${res.statusCode}: ${text.slice(0, 400)}`)));
    });
    req.on('error', reject); req.end(body);
  });

  // Sunucu yanıtı: ilk istek yanıt önbelleğini kurar; sonraki üç istek ölçülür.
  const query = breakdownHeader ? `?asas=${encodeURIComponent(JSON.stringify([breakdownHeader]))}` : '';
  const warm = await api('/api/lfl' + query);
  const apiSamples = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); const text = await api('/api/lfl' + query); apiSamples.push({ ms: +(performance.now() - t).toFixed(1), bytes: Buffer.byteLength(text) }); }
  const parsed = JSON.parse(warm);
  const rowCount = parsed.rows.length;

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--js-flags=--expose-gc'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' });
  const [name, ...rest] = cookie.split('=');
  await context.addCookies([{ name, value: rest.join('='), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => { try { localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'); } catch (_) {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.dismiss());
  const lflResponses = [];
  page.on('response', async response => {
    const url = response.url();
    if (!/\/api\/lfl(\/asas-columns)?(\?|$)/.test(url)) return;
    try { const body = await response.body(); lflResponses.push({ url: url.replace(base, ''), bytes: body.length }); } catch (_) {}
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BLPerf && typeof switchTab === 'function', null, { timeout: 90000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 90000 });
  if (breakdownHeader) {
    await page.evaluate(header => { BLStorage.setItem('lcw.lfl.filters.v5', JSON.stringify({ breakdown: ['mag', 'asas:' + header] })); }, breakdownHeader);
  }
  await page.waitForTimeout(1500);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(200); await cdp.send('HeapProfiler.collectGarbage'); const m = await cdp.send('Performance.getMetrics'); return m.metrics.find(x => x.name === 'JSHeapUsedSize').value; };
  const heapBefore = await heap();
  const openStarted = Date.now();
  await page.evaluate(() => { window.__lflOpenT0 = performance.now(); switchTab('lfl'); });
  await page.waitForFunction(() => { const c = document.getElementById('lflContent'), v = document.getElementById('view-lfl'); return c && !c.hidden && v && !v.classList.contains('lflIsLoading') && document.querySelector('#lflGroupTableWrap tbody tr'); }, null, { timeout: 180000, polling: 50 });
  const openMs = await page.evaluate(() => +(performance.now() - window.__lflOpenT0).toFixed(1));
  const wallMs = Date.now() - openStarted;
  await page.waitForTimeout(500);
  const heapAfter = await heap();
  const groupLabels = await page.evaluate(() => [...document.querySelectorAll('#lflGroupTableWrap tbody tr')].slice(0, 8).map(tr => tr.textContent.trim().slice(0, 80)));
  const report = {
    app, asasRows, lflRows: book.rows, columns: book.columns, responseRows: rowCount, breakdown: breakdownHeader || null,
    api: { samples: apiSamples, medianMs: apiSamples.map(s => s.ms).sort((a, b) => a - b)[1], bytes: apiSamples[0].bytes, MiB: MiB(apiSamples[0].bytes) },
    browser: { openMs, wallMs, heapBeforeMiB: MiB(heapBefore), heapAfterMiB: MiB(heapAfter), heapDeltaMiB: MiB(heapAfter - heapBefore), lflResponses, groupLabels, errors },
  };
  console.log(JSON.stringify(report, null, 2));
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + '\n'); }
  await stop();
  fs.rmSync(root, { recursive: true, force: true });
})().catch(async err => { console.error(err && err.stack || err, err && err.cause); console.error('server log:', path.join(root, 'server.log')); await stop(); process.exit(1); });
