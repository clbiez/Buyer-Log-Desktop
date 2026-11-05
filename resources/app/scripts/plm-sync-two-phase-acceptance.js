'use strict';
// Real Buyer Log on isolated demo data with a local CoreNectum stand-in
// (scripts/fixtures/corenectum-demo-mock.cjs). No production data or network.
// Verifies the two-phase Collection PLM Sync end to end and captures the
// post-change release-note screenshots. Requires Playwright + Chromium.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const app = path.resolve(__dirname, '..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-plm-two-phase-'));
const port = Number(process.env.BUYER_LOG_PLM_PORT || 6497), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) {
  env[key] = path.join(root, dir); fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
const source = path.join(root, 'source'); fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source, updates: { enabled: false } }));
// Demo bearer: JWT shape with a far expiry; only the local stand-in ever sees it.
const jwtPart = value => Buffer.from(JSON.stringify(value)).toString('base64url');
env.BUYER_LOG_CORENECTUM_BEARER_TOKEN = `${jwtPart({ alg: 'none' })}.${jwtPart({ exp: 1893456000, sub: 'demo' })}.demo-signature`;
env.BL_DEMO_CORENECTUM_LOG = path.join(root, 'corenectum-calls.json');
env.BL_DEMO_BOM_DELAY_MS = String(process.env.BL_DEMO_BOM_DELAY_MS || 2500);
// İlk istekler bilerek 503 döner: iş durmamalı, kaldığı yerden yeniden denemeli.
env.BL_DEMO_STYLE_LIST_FAIL_FIRST = '3';
env.BL_DEMO_BOM_FAIL_FIRST = '0';
env.BL_DEMO_BOM_FAIL_PLM = '4110';
env.BL_DEMO_BOM_FAIL_PLM_TIMES = '4';
env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require ${path.join(app, 'scripts', 'fixtures', 'corenectum-demo-mock.cjs')}`.trim();
const ASSETS = path.join(app, 'public', 'release-notes', 'next-assets');
fs.mkdirSync(ASSETS, { recursive: true });
const CODES = Array.from({ length: 24 }, (_, i) => String(4100 + i));

const log = fs.openSync(path.join(root, 'server.log'), 'a');
const server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
let browser, cookie;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const calls = () => { try { return JSON.parse(fs.readFileSync(env.BL_DEMO_CORENECTUM_LOG, 'utf8')); } catch (_) { return { styleList: 0, bom: 0 }; } };
async function api(url, body) {
  const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie: cookie || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(res.ok, await res.clone().text()); return res;
}
async function bomJobs() { return (await (await api('/api/plm-jobs?scope=koleksiyon')).json()).jobs.filter(job => job.kind === 'plm-bom'); }

(async () => {
  console.log('Artifacts:', root);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { ready = (await fetch(base + '/api/health')).status < 500; if (ready) break; } catch {} await sleep(250); }
  assert.ok(ready, 'demo server did not start; see server.log');
  const login = await api('/api/user-login', { userId: 'moderator', newPassword: 'demo-plm-sync-123', password: 'demo-plm-sync-123' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  const split = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.dismiss());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 60000 });
  await page.evaluate(() => { applyLanguage('tr'); switchTab('koleksiyon'); });
  await page.waitForFunction(() => typeof window.BLPlmSync?.run === 'function', null, { timeout: 30000 });
  await page.evaluate(codes => {
    kolRows = codes.map(code => migrateKolRow({ id: kolNextId++, plmId: code, modelKod: '', durum: 'Design' }));
    saveKolRows(); renderKol();
  }, CODES);

  // Faz 1: alanlar önizlemeye BOM beklenmeden gelir.
  const started = Date.now();
  await page.evaluate(() => { window.__plmRun = window.BLPlmSync.run('all', null, { includeImages: false }); });
  // Demo veride ASAS yok: çeviri penceresinde değerler PLM'deki gibi taşınır.
  const review = page.locator('#_kolPlmTranslationReview');
  await review.waitFor({ timeout: 30000 });
  await review.locator('[data-plmreview="keepall"]').click();
  if (await review.count()) await review.locator('[data-plmreview="apply"]').click().catch(() => {});
  await page.locator('#_plmSyncColumnModal [data-plmcol="ok"]').click({ timeout: 30000 });
  console.log('step 1', Date.now() - started);
  await page.locator('#_plmSyncPreviewModal [data-plmsyncact="apply"]').waitFor({ timeout: 30000 });
  const previewMs = Date.now() - started;
  const runningAtPreview = (await bomJobs()).filter(job => job.running);
  assert.equal(runningAtPreview.length, 1, 'BOM arka plan işi önizleme açıkken sürer');
  // Her demo modelin PLM'de 3 rengi var; Koleksiyon'daki tek renksiz satır ilk renge
  // bağlanır, diğer 2 renk yeni renk satırı olarak önerilir.
  const newColours = page.locator('#_plmSyncPreviewModal [data-plmsync-newcolours]');
  assert.equal(await newColours.isChecked(), true);
  assert.match(await page.locator('#_plmSyncPreviewModal').innerText(), new RegExp(`${CODES.length * 2} renk satırını mevcut modellerine ekle`));
  await page.locator('#_plmSyncPreviewModal .plmSyncNewColours').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(ASSETS, 'plm-sync-new-colours.png') });
  await page.locator('#_plmSyncPreviewModal [data-plmsyncact="apply"]').click();
  console.log('step 2', Date.now() - started);
  const run = await page.evaluate(() => window.__plmRun);
  console.log('step 3', Date.now() - started);
  assert.equal(run.ok, true); assert.equal(run.applied, CODES.length, 'tüm modeller güncellendi');
  assert.equal(run.addedColours, CODES.length * 2, 'eksik renkler eklendi');
  const colourShape = await page.evaluate(() => {
    const byPlm = new Map();
    kolRows.forEach(row => { if (!byPlm.has(row.plmId)) byPlm.set(row.plmId, []); byPlm.get(row.plmId).push(row); });
    return [...byPlm.values()].map(rows => ({ colours: rows.map(row => row.colourCode).sort().join(','), groups: new Set(rows.map(row => row.modelGroupId)).size }));
  });
  assert.equal(colourShape.length, CODES.length);
  assert.ok(colourShape.every(item => item.colours === 'J0G,Q2K,Q6K' && item.groups === 1), JSON.stringify(colourShape.slice(0, 3)));
  const failures = calls();
  assert.equal(failures.failedStyleList, 3, 'Style List geçici hatası yeniden denenerek aşıldı');
  const fields = await page.evaluate(() => kolRows.map(row => ({ plmId: row.plmId, modelKod: row.modelKod, fabric: row.fabric })));
  assert.ok(fields.every(row => row.modelKod.startsWith('DEMO-') && /Cotton/.test(row.fabric)), JSON.stringify(fields.slice(0, 3)));
  await page.evaluate(() => window.BLPlmOps?.open?.());
  await page.waitForSelector('#plmOpsPanel', { timeout: 10000 });
  await page.waitForTimeout(1200);
  assert.ok((await bomJobs()).some(job => job.running), 'ekran görüntüsünde BOM işi hâlâ sürüyor');
  await page.screenshot({ path: path.join(ASSETS, 'plm-sync-two-phase.png') });
  console.log('step 4', Date.now() - started);

  // Faz 2 biter → Artwork Detayı yerel BOM deposundan tazelenir.
  let retryShot = false;
  for (let i = 0; i < 240 && (await bomJobs()).some(job => job.running); i++) {
    const current = (await bomJobs()).find(job => job.running);
    if (!retryShot && current && /yeniden deneniyor/.test(current.phase || '')) {
      retryShot = true;
      await page.evaluate(() => window.BLPlmOps?.open?.());
      await page.waitForFunction(() => /yeniden deneniyor/.test(document.getElementById('plmOpsPanel')?.innerText || ''), null, { timeout: 5000 });
      await page.screenshot({ path: path.join(ASSETS, 'plm-sync-retry.png') });
    }
    await sleep(250);
  }
  assert.ok(retryShot, 'BOM yeniden deneme turu panelde görüldü');
  const finished = (await bomJobs())[0];
  assert.equal(finished.status, 'succeeded', JSON.stringify(finished));
  assert.equal(finished.failureCount, 0, 'BOM geçici hatası kaldığı yerden yeniden denenerek aşıldı');
  assert.equal(calls().failedBom, 4, 'tek modelin 4 hatası: HTTP denemeleri tükendi, yeniden deneme turunda okundu');
  const bomBefore = calls().bom;
  const bomMs = Date.now() - started;
  console.log('bom finished', bomMs);
  await page.waitForFunction(() => kolRows.filter(row => String(row.artworkDetail || '').includes('Pigment')).length > 0, null, { timeout: 15000 });
  const artwork = await page.evaluate(() => kolRows.map(row => row.artworkDetail));
  assert.ok(artwork.some(value => /Ön: 1 \| Pigment/.test(value)), JSON.stringify(artwork.slice(0, 4)));
  assert.ok(artwork.some(value => /Baskı yok/.test(value)));

  // Durdur: arka plan BOM işi yeni CoreNectum isteği başlatmaz.
  await page.evaluate(() => { window.__plmRun2Done = false; window.BLPlmSync.run('all', null, { includeImages: false }).finally(() => { window.__plmRun2Done = true; }); });
  // İş görünür görünmez PLM Operasyon Merkezi'ndeki Durdur ile aynı uç çağrılır.
  let job = null, atCancel = 0;
  for (let i = 0; i < 80 && !job; i++) { job = (await bomJobs()).find(item => item.running && item.id !== finished.id); if (!job) await sleep(100); }
  assert.ok(job, 'ikinci çalıştırmada BOM işi başladı');
  await api(`/api/plm-jobs/${encodeURIComponent(job.id)}/cancel`, {});
  atCancel = calls().bom;
  // Yeniden çalıştırmada açılabilecek onay pencereleri aynı şekilde geçilir.
  for (let i = 0; i < 120 && !(await page.evaluate(() => window.__plmRun2Done)); i++) {
    const again = page.locator('#_kolPlmTranslationReview');
    if (await again.count()) { await again.locator('[data-plmreview="keepall"]').click().catch(() => {}); if (await again.count()) await again.locator('[data-plmreview="apply"]').click().catch(() => {}); }
    if (await page.locator('#_plmSyncColumnModal').count()) await page.locator('#_plmSyncColumnModal [data-plmcol="ok"]').click().catch(() => {});
    if (await page.locator('#_plmSyncPreviewModal').count()) await page.locator('#_plmSyncPreviewModal [data-plmsyncact="apply"]').click().catch(() => {});
    await sleep(250);
  }
  assert.ok(await page.evaluate(() => window.__plmRun2Done), 'ikinci çalıştırma tamamlandı');
  assert.equal(await page.evaluate(() => kolRows.length), CODES.length * 3, 'ikinci çalıştırma yeni satır üretmez');
  console.log('step 5', Date.now() - started);
  await page.evaluate(() => window.BLPlmOps?.open?.());
  for (let i = 0; i < 60 && (await bomJobs()).find(item => item.id === job.id).running; i++) await sleep(250);
  await sleep(Number(env.BL_DEMO_BOM_DELAY_MS) + 500);
  const afterCancel = calls().bom;
  const cancelled = (await bomJobs()).find(item => item.id === job.id);
  assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
  assert.equal(afterCancel, atCancel, 'iptalden sonra yeni BOM isteği atılmadı');
  assert.ok(afterCancel - bomBefore < CODES.length, 'ikinci çalıştırma bütün BOM’ları okumadan durdu');
  assert.equal(cancelled.processed, afterCancel - bomBefore, 'panel yalnız gerçekten okunan modelleri işlenmiş sayar');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ASSETS, 'plm-sync-stop.png') });
  console.log('step 6', Date.now() - started);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, previewMs, bomMs, calls: calls(), models: CODES.length, rows: CODES.length * 3 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  server.kill();
});
