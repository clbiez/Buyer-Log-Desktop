'use strict';
// Kaynak Veri › Kaynak modu › ASAS Kumaş Bilgileri (Açık / Kapalı) — gerçek
// Buyer Log arayüzü, izole sunucu ve demo bağlantılar. SSAS'a bağlanılmaz;
// ayar yalnız kaydedilir ve ekranda doğrulanır. Kullanıcı verisi okunmaz.
//
//   node scripts/asas-fabric-setting-ui-acceptance.js            → doğrulama
//   BUYER_LOG_FABRIC_SCREENSHOT=1 node scripts/...                → ayrıca sürüm
//     notu PNG'sini public/release-notes/next-assets/ altına yazar
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const app = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-fabric-setting-'));
const port = Number(process.env.BUYER_LOG_FABRIC_PORT || 6497);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) {
  env[key] = path.join(root, dir);
  fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', updates: { enabled: false } }));

execFileSync(process.execPath, ['-e', `
  const db = require(${JSON.stringify(path.join(app, 'server', 'db'))});
  db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 'demo-asas', catalog: 'DEMO', role: 'asas', refreshEnabled: true },
    { id: 'mc_ias', name: 'IAS', server: 'demo-ias', catalog: 'DEMO2', role: 'antrepo', refreshEnabled: true },
  ], null);`], { env });

/* Demo: IAS ufku yalnız W6; ASAS'ta S6 siparişi de var → S6 ufuk dışı. */
async function demoHorizonWarning() {
  const modelRefresh = require(path.join(app, 'server', 'lib', 'model-refresh.js'));
  const modelFields = require(path.join(app, 'server', 'lib', 'model-fields.js'));
  const M = 'Model Özellikleri', T = 'Siparis Bilgileri';
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: M, name: field.header, kind: 'column' };
  const iasMapping = {};
  for (const [header, table, name] of [['İthalat Dosya No', 'Ithalat', 'İthalat Dosya No'], ['Sipariş Kod', T, 'Sipariş Kod'], ['Model Adı', T, 'Ürün Ad'], ['Renk Kod', T, 'Renk Kod'],
    ['Supplier Portal Statü', 'Ithalat', 'Supplier Portal Statü'], ['Tahmini Antrepo Giriş Tarihi', 'Ithalat', 'Tahmini Antrepo Giriş Tarihi'], ['Yükleme Toplam Adet', 'Ithalat', 'Yükleme Toplam Adet'], ['Sezon', T, 'Sezon']]) {
    iasMapping[header] = { table, name, kind: 'column' };
  }
  const order = (code, model, colour, season) => ({ 'Sipariş Kod': code, 'Model Adı': model, 'Renk Kod': colour, 'Renk': 'DEMO', 'Net Alım Sipariş Miktarı': 1200, 'FOB Fiyatı': 3.5, 'Üretici': 'DEMO ÜRETİCİ', 'Sezon': season, 'Orijinal Exfactory Merch Tarih': '2026-09-01' });
  const orders = [order(900101, 'DEMO KAZAK-1', 'C01', 'W6'), order(900102, 'DEMO HIRKA-2', 'C02', 'S6'), order(900103, 'DEMO YELEK-3', 'C03', 'S6'), order(900104, 'DEMO TSHIRT-4', 'C04', 'W6')];
  const ias = [{ 'İthalat Dosya No': 'DEMO.0001', 'Sipariş Kod': 900101, 'Model Adı': 'DEMO KAZAK-1', 'Renk Kod': 'C01', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20', 'Yükleme Toplam Adet': 1200 }];
  const result = await modelRefresh.loadFromModelConnections([
    { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 'demo', catalog: 'DEMO', refreshEnabled: true, mappingEnhancementScanVersion: 4, horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['S6', 'W6'], groups: [] }, mapping },
    { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 'demo', catalog: 'DEMO2', refreshEnabled: true, horizon: { table: T, groups: [{ id: 'g', conditions: [{ field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['W6'] }] }] }, mapping: iasMapping },
  ], {
    targets: ['cp', 'orders', 'backlog'], includeLfl: false, columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }),
    runModelRows: async plan => { const rows = (/'Ithalat'/.test(plan.query) ? ias : orders).map(row => ({ ...row })); return { rows, rowCount: rows.length }; },
  });
  const detail = (result.warningDetails || []).find(item => item.id === 'ias-horizon-excluded');
  return { warning: detail && detail.message, detail };
}

const log = fs.openSync(path.join(root, 'server.log'), 'a');
const server = spawn(process.execPath, ['server/server.js'], { cwd: app, env, stdio: ['ignore', log, log] });
let browser;
(async () => {
  console.log('Artifacts:', root);
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    try { ready = (await fetch(base + '/api/health')).status < 500; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'İzole Buyer Log sunucusu açılmadı; server.log');
  const login = await fetch(base + '/api/user-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'moderator', password: 'demo-fabric-123', newPassword: 'demo-fabric-123' }),
  });
  assert.ok(login.ok, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0], split = cookie.indexOf('=');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] } : {});
  const shot = process.env.BUYER_LOG_FABRIC_SCREENSHOT === '1';
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: shot ? 2 : 1, reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));

  await page.goto(base + '/?module=source', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => switchTab('source'));
  await page.waitForSelector('#asasFabricControl [data-asas-fabric-mode="separate"]', { state: 'attached', timeout: 30000 });
  const openModes = async () => {
    if (await page.locator('[data-dm-panel="modes"].isCollapsed').count()) await page.locator('[data-dm-panel-toggle="modes"]').click();
    await page.waitForSelector('#asasFabricControl [data-asas-fabric-mode="separate"]', { state: 'visible', timeout: 15000 });
  };
  await openModes();
  await page.waitForTimeout(800);

  const control = page.locator('#asasFabricControl');
  const row = control.locator('xpath=ancestor::div[contains(@class,"dmModeRow")]');
  assert.match(await row.innerText(), /ASAS Kumaş Bilgileri/);
  assert.deepEqual(await control.locator('[data-asas-fabric-mode]').allInnerTexts(), ['Açık', 'Kapalı']);
  assert.equal(await control.locator('[data-asas-fabric-mode="separate"]').getAttribute('aria-pressed'), 'true', 'kayıt yoksa açık');
  assert.equal(await page.locator('#asasFabricState').innerText(), 'Ayrı kumaş sorgusu');

  // Kapat → kaydedilir, durum değişir
  const put = page.waitForResponse(response => response.url().endsWith('/api/asas-fabric') && response.request().method() === 'PUT');
  await control.locator('[data-asas-fabric-mode="off"]').click();
  assert.equal((await put).status(), 200);
  await page.waitForFunction(() => document.querySelector('#asasFabricControl [data-asas-fabric-mode="off"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#asasFabricState').innerText(), 'Kumaş çekilmez');
  const stored = await (await fetch(base + '/api/asas-fabric', { headers: { cookie } })).json();
  assert.equal(stored.mode, 'off');

  // İngilizce
  await page.evaluate(() => applyLanguage('en'));
  await page.evaluate(() => switchTab('source'));
  await openModes();
  await page.waitForTimeout(500);
  {
    const enRow = await page.locator('#asasFabricControl').locator('xpath=ancestor::div[contains(@class,"dmModeRow")]').innerText();
    assert.match(enRow, /ASAS Fabric Details/);
    assert.deepEqual(await page.locator('#asasFabricControl [data-asas-fabric-mode]').allInnerTexts(), ['On', 'Off']);
    assert.equal(await page.locator('#asasFabricState').innerText(), 'Fabric is not fetched');
    await page.evaluate(() => applyLanguage('tr'));
    await page.evaluate(() => switchTab('source'));
    await openModes();
    await page.waitForTimeout(500);
  }

  // Aç → ayrı sorgu
  await page.locator('#asasFabricControl [data-asas-fabric-mode="separate"]').click();
  await page.waitForFunction(() => document.querySelector('#asasFabricControl [data-asas-fabric-mode="separate"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal((await (await fetch(base + '/api/asas-fabric', { headers: { cookie } })).json()).mode, 'separate');

  if (shot) {
    await page.waitForTimeout(1500); // bildirim kaybolsun
    const panel = page.locator('[data-dm-panel="modes"]');
    await panel.scrollIntoViewIfNeeded();
    const box = await panel.boundingBox();
    const width = Math.max(980, Math.round(box.width + 48));
    const height = Math.max(Math.round(box.height + 48), Math.round(width / 2.4));
    const clip = { x: Math.max(0, Math.round(box.x - 24)), y: Math.max(0, Math.round(box.y - 24)), width, height };
    const out = path.join(app, 'public', 'release-notes', 'next-assets', 'asas-fabric-setting.png');
    await page.screenshot({ path: out, clip });
    console.log('Ekran görüntüsü:', out, clip);
  }
  // --- IAS ufku dışında kalan siparişler uyarısı -------------------------
  // Uyarı gerçek motorla (loadFromModelConnections) demo veriden üretilir ve
  // BL'ın kendi veri yanıtına (/api/data) eklenir; uyarı listesi ve ayrıntı
  // tablosu gerçek arayüz bileşenleridir.
  const horizonDemo = await demoHorizonWarning();
  assert.ok(horizonDemo.warning && horizonDemo.detail, 'motor ufuk uyarısı üretmeli');
  await page.route('**/api/data?**', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.warnings = [...(Array.isArray(body.warnings) ? body.warnings : []), horizonDemo.warning];
    body.warningDetails = [...(Array.isArray(body.warningDetails) ? body.warningDetails : []), horizonDemo.detail];
    await route.fulfill({ response, json: body });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('.warnChip', { state: 'attached', timeout: 30000 });
  await page.evaluate(() => showWarnDetails());
  const item = page.locator('.warningList li.hasDetail', { hasText: 'IAS ufkunun' });
  await item.waitFor({ timeout: 10000 });
  await item.dblclick();
  await page.getByText(/Orders Outside the IAS Horizon/i).first().waitFor({ timeout: 15000 });
  await page.getByText('900103').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  // Çekmece shadow DOM'da çizilir: body.innerText değil, locator kullanılır.
  for (const code of ['900102', '900103']) assert.ok(await page.getByText(code, { exact: true }).count(), `${code} listelenmeli`);
  for (const code of ['900101', '900104']) assert.equal(await page.getByText(code, { exact: true }).count(), 0, `${code} listelenmemeli (IAS eşleşmesi var ya da ufuk içinde)`);
  assert.ok(await page.getByText(/Sezon \(ASAS\)/i).count(), 'değerlendirilen alan sütunu');
  if (shot) {
    await page.evaluate(() => document.querySelectorAll('.toast, .blToast, [data-toast], .toastHost > *').forEach(el => el.remove()));
    await page.locator('[aria-label="Kapat"], [aria-label="Close"]').filter({ has: page.locator('xpath=ancestor::*[contains(@class,"oast")]') }).click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(800);
    const out = path.join(app, 'public', 'release-notes', 'next-assets', 'ias-horizon-warning.png');
    // Çekmecenin içerikli üst bölümü (başlık, uyarı metni, tablo); alt boşluk ve
    // durum bildirimleri kadraj dışında kalır.
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1440, height: 600 } });
    console.log('Ekran görüntüsü:', out);
  }

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('ASAS kumaş ayarı ve IAS ufuk uyarısı arayüz kabulü: GEÇTİ');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await browser?.close(); } catch {}
  server.kill();
});
