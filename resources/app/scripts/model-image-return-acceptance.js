'use strict';

/*
 * CP model görselleri — sayfa dönüşü kabul ölçümü (gerçek sunucu + Chromium).
 *
 *   node scripts/model-image-return-acceptance.js [--keep] [--json out.json]
 *
 * Geçici bir veri kökünde demo kaynak Excel'lerini üretir, Buyer Log sunucusunu
 * gerçekten başlatır, her PLM ID + Renk Kodu için sentetik PNG bağlar ve
 * Playwright/Chromium ile şu senaryoları ölçer:
 *   CP → Koleksiyon → CP, CP → Orders → CP, Koleksiyon'dayken arka plan
 *   yeniden çizimi, Koleksiyon'da kayıt yayımı (PLM eşitleme, görsel aynı),
 *   Koleksiyon'dayken görsel değişimi ve uygulamanın kapatılıp açılması.
 * Her dönüşte CDP ile görsel isteklerinin ağa çıkıp çıkmadığı, ilk karede kaç
 * görünür görselin gerçek kaynağıyla yerinde olduğu ve kaç kare yer tutucu
 * göründüğü kaydedilir. Kabul ölçütü sağlanmazsa çıkış kodu 1'dir.
 *
 * Playwright bağımlılık değildir: PLAYWRIGHT_MODULE ile yol verilebilir.
 * Gerçek şirket verisi kullanılmaz; her şey geçici klasörde üretilir.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const KEEP = process.argv.includes('--keep');
const JSON_OUT = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : ''; })();
const PORT = 6390 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'acceptance-pass-123';
const IMG_RE = /\/api\/(collection|cp)-images\//;

// ---- sentetik PNG ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, sum]);
}
function png(seed, w = 240, h = 320) {
  const raw = Buffer.alloc((w * 3 + 1) * h); let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const r0 = rnd() * 255, g0 = rnd() * 255, b0 = rnd() * 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3, n = rnd() * 40;
    raw[o] = (r0 + x / 2 + n) & 255; raw[o + 1] = (g0 + y / 2 + n) & 255; raw[o + 2] = (b0 + ((x * y) >> 6) + n) & 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- sunucu ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-image-return-'));
const env = {
  ...process.env,
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(root, 'tmp'),
};
let server = null, cookie = '';
async function startServer() {
  server = spawn(process.execPath, [path.join(APP_ROOT, 'server', 'server.js')], { cwd: APP_ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).status < 500) break; } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  const res = await fetch(`${BASE}/api/user-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'moderator', newPassword: PASSWORD, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Giriş başarısız: ${res.status}`);
  cookie = String(res.headers.get('set-cookie') || '').split(';')[0];
}
const api = (url, options = {}) => fetch(BASE + url, { ...options, headers: { cookie, 'Content-Type': 'application/json', ...(options.headers || {}) } });
async function seed() {
  const source = path.join(root, 'source');
  const gen = spawnSync(process.execPath, [path.join(__dirname, 'generate-demo-data.js'), source, '--rows', '400'], { cwd: APP_ROOT, encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(gen.stderr || 'Demo veri üretilemedi.');
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port: PORT, sourceFolder: source }));
  await startServer();
  await api('/api/refresh', { method: 'POST', body: '{}' });
  for (let i = 0; i < 240; i++) { const s = await (await api('/api/refresh-status')).json(); if (!s.running) break; await new Promise(r => setTimeout(r, 500)); }
  const data = await (await api('/api/data/cp')).json();
  const seen = new Set(); let linked = 0;
  for (const row of data.rows || []) {
    const id = `${row['PLM ID']}|${row['C.Code']}`; if (!row['PLM ID'] || !row['C.Code'] || seen.has(id)) continue; seen.add(id);
    const key = `plm:${String(row['PLM ID']).trim().toUpperCase()}|colour:${String(row['C.Code']).trim().toUpperCase()}`;
    const up = await (await api('/api/cp-images', { method: 'POST', body: JSON.stringify({ rowId: key, filename: 'demo.png', mimeType: 'image/png', base64: png(linked + 1).toString('base64') }) })).json();
    await api(`/api/overrides/${encodeURIComponent(row['Order Code'])}`, { method: 'PATCH', body: JSON.stringify({ model: row['Model Name'], ccode: row['C.Code'], imagePlmId: row['PLM ID'], imageColourCode: row['C.Code'], imageRef: up.image.id }) });
    linked++;
  }
  return linked;
}

// ---- tarayıcı ----
const profile = path.join(root, 'browser-profile');
async function open() {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1600, height: 1000 } });
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value: cookie.slice(name.length + 1) || value, domain: '127.0.0.1', path: '/', httpOnly: true }]);
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
  const net = new Map();
  cdp.on('Network.requestWillBeSent', e => { if (IMG_RE.test(e.request.url)) net.set(e.requestId, { t: Date.now(), url: new URL(e.request.url).pathname }); });
  cdp.on('Network.requestServedFromCache', e => { const r = net.get(e.requestId); if (r) r.memory = true; });
  cdp.on('Network.responseReceived', e => { const r = net.get(e.requestId); if (r) { r.status = e.response.status; r.disk = !!e.response.fromDiskCache; } });
  return { ctx, page, net };
}
async function boot(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('nav.tabs button[data-tab="cp"]') && window.BLImageRuntime, null, { timeout: 60000 });
  const go = page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/);
  await go.waitFor({ timeout: 60000 }).then(() => go.click()).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
}
const PROBE = `(() => {
  const out = { frames: 0, placeholderFrames: 0, firstReal: null, firstPlaceholders: null, doneAt: null, visible: 0, newVisible: 0, start: performance.now() };
  document.querySelectorAll('#cpTable tbody img.cpThumb').forEach(img => { img.__old = true; });
  const sample = () => {
    if (!document.getElementById('view-cp').classList.contains('active')) return requestAnimationFrame(sample);
    const vis = [...document.querySelectorAll('#cpTable tbody img.cpThumb')].filter(img => { if (img.dataset.hasImage !== '1') return false; const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; });
    const ph = vis.filter(img => !img.complete || img.naturalWidth === 0 || /^data:/.test(img.currentSrc || img.src));
    out.frames++; if (ph.length) out.placeholderFrames++;
    if (out.firstReal === null) { out.firstReal = vis.length - ph.length; out.firstPlaceholders = ph.length; }
    out.visible = vis.length; out.newVisible = vis.filter(img => !img.__old).length; out.visibleSources = vis.map(img => img.dataset.src);
    if (!ph.length && vis.length && out.doneAt === null) out.doneAt = performance.now() - out.start;
    if (out.doneAt === null && performance.now() - out.start < 15000) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample); window.__probe = out;
})()`;
async function settle(page) {
  await page.waitForFunction(() => {
    const vis = [...document.querySelectorAll('#cpTable tbody img.cpThumb')].filter(i => i.dataset.hasImage === '1' && i.getBoundingClientRect().top < innerHeight);
    return vis.length > 5 && vis.every(i => i.complete && i.naturalWidth > 0 && !/^data:/.test(i.currentSrc || i.src));
  }, null, { timeout: 60000, polling: 100 });
}
async function enterCp(page, net, name) {
  await page.evaluate(PROBE); const t0 = Date.now();
  await page.locator('nav.tabs button[data-tab="cp"]').click();
  await page.waitForFunction(() => window.__probe.doneAt !== null || performance.now() - window.__probe.start > 15000, null, { timeout: 30000, polling: 50 });
  await page.waitForTimeout(800);
  const p = await page.evaluate(() => window.__probe);
  // Görünür görsellerin istekleri ile ekran dışı satırların ısıtma istekleri ayrı sayılır.
  const visibleSet = new Set(p.visibleSources || []);
  const list = [...net.values()].filter(r => r.t >= t0 && visibleSet.has(r.url)), network = list.filter(r => r.status && !r.disk && !r.memory);
  const warm = [...net.values()].filter(r => r.t >= t0 && !visibleSet.has(r.url));
  return { name, imageRequests: list.length, toNetwork: network.length, fromDiskCache: list.filter(r => r.disk).length, warmupRequests: warm.length, visible: p.visible, firstFrameReal: p.firstReal, placeholderFrames: p.placeholderFrames, allVisibleMs: p.doneAt === null ? null : Math.round(p.doneAt), newImgElements: p.newVisible };
}
const tab = (page, name) => page.locator(`nav.tabs button[data-tab="${name}"]`).click();

(async () => {
  const results = [], failures = [];
  try {
    const linked = await seed();
    let { ctx, page, net } = await open();
    await boot(page);
    results.push(await enterCp(page, net, 'İlk CP girişi')); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(2000);
    results.push({ ...await enterCp(page, net, 'Koleksiyon → CP'), returnCase: true }); await settle(page);
    await tab(page, 'orders'); await page.waitForTimeout(2000);
    results.push({ ...await enterCp(page, net, 'Orders → CP'), returnCase: true }); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(1200);
    await page.evaluate(() => renderCP()); await page.waitForTimeout(600);
    results.push({ ...await enterCp(page, net, 'Koleksiyon (arka plan yeniden çizim) → CP'), returnCase: true }); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const imagemap = {};
      state.cp.rows.forEach(r => { if (r._imageRef) imagemap[`plm:${String(r['PLM ID']).trim().toUpperCase()}|colour:${String(r['C.Code']).trim().toUpperCase()}`] = r._imageRef; });
      applySyncedPlmImages({ overrides: { imagemap }, images: [] }); plmSyncRepaintAll();
    });
    await page.waitForTimeout(600);
    results.push({ ...await enterCp(page, net, 'Koleksiyon (PLM eşitleme, görsel aynı) → CP'), returnCase: true }); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(1200);
    const changed = await page.evaluate(async () => {
      const img = [...document.querySelectorAll('#cpTable tbody img.cpThumb')].find(i => i.dataset.hasImage === '1');
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 160;
      const g = canvas.getContext('2d'); g.fillStyle = '#c0392b'; g.fillRect(0, 0, 120, 160);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      await cpSaveRowImage(cpImageRowById(img.dataset.id), new File([blob], 'changed.png', { type: 'image/png' }));
      return { id: img.dataset.id, before: img.dataset.src };
    });
    await page.waitForTimeout(800);
    const change = { ...await enterCp(page, net, 'Görsel değişti (Koleksiyon) → CP'), returnCase: true };
    const after = await page.evaluate(id => { const i = document.querySelector(`#cpTable tbody img.cpThumb[data-id="${id}"]`); return { src: i.dataset.src, ok: i.complete && i.naturalWidth === 120 && (i.currentSrc || i.src).endsWith(i.dataset.src) }; }, changed.id);
    change.urlChanged = after.src !== changed.before; change.newImageShown = after.ok;
    results.push(change);
    // Sanallaştırılmış "Tümü" görünümü: kaydırılmışken başka sayfada yeniden çizim istenir.
    await page.evaluate(() => {
      const select = [...document.querySelectorAll('#view-cp select')].find(el => [...el.options].some(o => /^(Tümü|All)$/.test(o.textContent.trim())));
      const option = [...select.options].find(o => /^(Tümü|All)$/.test(o.textContent.trim()));
      select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { document.querySelector('#cpTable').closest('.tablewrap').scrollTop = 4000; });
    await page.waitForTimeout(2500); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(1200);
    await page.evaluate(() => renderCP()); await page.waitForTimeout(500);
    const scrolled = { ...await enterCp(page, net, 'Tümü + kaydırılmış (arka plan yeniden çizim) → CP'), returnCase: true };
    scrolled.scrollTop = await page.evaluate(() => document.querySelector('#cpTable').closest('.tablewrap').scrollTop);
    if (!scrolled.visible) failures.push('Tümü görünümünde dönüşte görünür satır/görsel yok (boş alan)');
    if (scrolled.scrollTop < 3900) failures.push(`Tümü görünümünde kaydırma konumu korunmadı: ${scrolled.scrollTop}`);
    results.push(scrolled);
    await ctx.close();
    ({ ctx, page, net } = await open());
    await boot(page);
    results.push(await enterCp(page, net, 'Yeniden açılış → ilk CP girişi')); await settle(page);
    await tab(page, 'koleksiyon'); await page.waitForTimeout(2000);
    results.push({ ...await enterCp(page, net, 'Yeniden açılış → Koleksiyon → CP'), returnCase: true });
    await ctx.close();
    for (const r of results.filter(item => item.returnCase)) {
      if (r.toNetwork) failures.push(`${r.name}: ${r.toNetwork} görünür görsel isteği ağa çıktı`);
      if (r.firstFrameReal !== r.visible) failures.push(`${r.name}: ilk karede ${r.firstFrameReal}/${r.visible} görsel yerinde`);
      if (r.placeholderFrames) failures.push(`${r.name}: ${r.placeholderFrames} kare yer tutucu`);
    }
    if (!change.urlChanged) failures.push('Değişen görselin URL\'si değişmedi');
    if (!change.newImageShown) failures.push('Değişen görsel ilk dönüşte görünmedi');
    console.log(`Bağlanan demo görsel: ${linked}`);
    console.table(results.map(({ returnCase, ...rest }) => rest));
    if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  } finally {
    if (server) server.kill();
    if (!KEEP) fs.rmSync(root, { recursive: true, force: true });
  }
  if (failures.length) { console.error('KABUL BAŞARISIZ:\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('KABUL: CP dönüşünde görünür görsel isteği ağa çıkmadı, görünür görseller ilk karede yerinde, yer tutucu görünmedi.');
})().catch(error => { console.error(error); if (server) server.kill(); process.exit(1); });
