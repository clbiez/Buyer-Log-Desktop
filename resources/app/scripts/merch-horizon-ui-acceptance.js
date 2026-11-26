'use strict';
// Merch bağlamı · Ufuk filtreleri. Real Buyer Log UI on an isolated server with demo ASAS / IAS connections.
// Only the database-dependent horizon HTTP responses (schema fields, distinct
// values, field match) use demo fixtures: SSAS is not reachable off Windows.
// Requires Playwright + Chromium. No production source or user data is read.
//
//   node scripts/horizon-drawer-ui-acceptance.js            → assertions only
//   BUYER_LOG_HORIZON_SCREENSHOT=1 node scripts/...          → also writes the
//     release-note PNG to public/release-notes/next-assets/
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const app = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-merch-horizon-'));
const port = Number(process.env.BUYER_LOG_MERCH_HORIZON_PORT || 6496);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json') };
for (const [key, dir] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_TEMP_ROOT: 'temp' })) {
  env[key] = path.join(root, dir);
  fs.mkdirSync(env[key], { recursive: true });
}
env.BUYER_LOG_AUTH_DATA_ROOT = env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR = env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port, host: '127.0.0.1', updates: { enabled: false } }));

/* Demo connections are written through the real db module, in the isolated data root. */
const C = (id, table, name, values) => ({ id, table, field: name, name, op: 'in', valueType: 'text', values });
const scopes = {
  asas: [
    { id: 'sc_cp', targets: ['cp'], horizon: { table: 'Dim_Urun', groups: [{ id: 'g', conditions: [C('a1', 'Dim_Urun', 'Sezon', ['W26', 'S27']), C('a2', 'Dim_Urun', 'Buyer Grup', ['DEMO KIDS']), C('a3', 'Dim_Urun', 'Merch Sub-Group Code', ['CU4E', 'BGA'])] }] } },
    { id: 'sc_l', targets: ['orders', 'backlog', 'lfl', 'priceanalysis'], horizon: { table: 'Dim_Urun', groups: [{ id: 'g', conditions: [C('b1', 'Dim_Urun', 'Sezon', ['W26'])] }] } },
  ],
  ias: [
    { id: 'sc_icp', targets: ['cp'], horizon: { table: 'Siparis Bilgileri', groups: [{ id: 'h', conditions: [C('i1', 'Siparis Bilgileri', 'Sezon Kod', ['W26', 'S27']), C('i2', 'Siparis Bilgileri', 'Buyer Grup', ['DEMO KIDS'])] }] } },
    { id: 'sc_io', targets: ['orders', 'backlog'], horizon: { table: 'Siparis Bilgileri', groups: [{ id: 'h', conditions: [C('j1', 'Siparis Bilgileri', 'Sezon Kod', ['W26'])] }] } },
  ],
};
execFileSync(process.execPath, ['-e', `
  const db = require(${JSON.stringify(path.join(app, 'server', 'db'))});
  const scopes = ${JSON.stringify(scopes)};
  db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 'demo-asas', catalog: 'DEMO', role: 'asas', refreshEnabled: true, scopes: scopes.asas },
    { id: 'mc_ias', name: 'IAS', server: 'demo-ias', catalog: 'DEMO2', role: 'antrepo', refreshEnabled: true, scopes: scopes.ias },
  ], null);`], { env });

const F = (table, name, type = 'text') => ({ header: name, key: name, name, table, dynamic: true, tr: `${table} · ${name}`, en: `${table} · ${name}`, type, typeSource: 'schema' });
const FIELDS = {
  mc_asas: [F('Dim_Urun', 'Merch Sub-Group Code'), F('Dim_Urun', 'Sezon'), F('Dim_Urun', 'Buyer Grup'), F('Dim_Urun', 'Marka'), F('Dim_Urun', 'Ürün Tanım'), F('Fact_Siparis', 'Orijinal Exfactory Merch Tarih', 'date'), F('Fact_Siparis', 'Tedarikçi')],
  mc_ias: [F('Siparis Bilgileri', 'Sezon Kod'), F('Siparis Bilgileri', 'Buyer Grup'), F('Siparis Bilgileri', 'Marka'), F('Siparis Bilgileri', 'Ürün Tanım'), F('Siparis Bilgileri', 'Vasita'), F('Siparis Bilgileri', 'Tahmini Antrepo Giriş Tarihi', 'date')],
};
const OPERATORS = [['in', 'list'], ['notIn', 'list'], ['between', 'range'], ['gte', 'from'], ['lte', 'to'], ['contains', 'single'], ['startsWith', 'single'], ['empty', 'none'], ['notEmpty', 'none']]
  .map(([id, arity]) => ({ id, arity, label: id }));
const VALUES = { 'Merch Sub-Group Code': ['BGA', 'BGAS', 'CU4C', 'CU4E', 'ZZ9'], Sezon: ['W25', 'S26', 'W26', 'S27', 'W27'], 'Sezon Kod': ['W25', 'S26', 'W26', 'S27', 'W27'], 'Buyer Grup': ['DEMO KIDS', 'DEMO MEN', 'DEMO WOMEN'], Marka: ['DEMO A', 'DEMO B', 'DEMO C'], 'Ürün Tanım': ['Kazak', 'Hırka', 'Yelek'], Tedarikçi: ['Tedarikçi 01', 'Tedarikçi 02'], Vasita: ['Gemi', 'Uçak'] };
const MATCH = { Sezon: 'Sezon Kod', 'Buyer Grup': 'Buyer Grup', Marka: 'Marka', 'Ürün Tanım': 'Ürün Tanım', 'Orijinal Exfactory Merch Tarih': 'Tahmini Antrepo Giriş Tarihi' };

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
  assert.ok(ready, 'Isolated Buyer Log server did not start; see server.log');
  const login = await fetch(base + '/api/user-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'moderator', password: 'demo-horizon-123', newPassword: 'demo-horizon-123' }),
  });
  assert.ok(login.ok, await login.clone().text());
  const cookie = login.headers.get('set-cookie').split(';')[0], split = cookie.indexOf('=');
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] } : {});
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('bl.releaseNotes.lastSeenStable.v1', '99.0.0'));
  const page = await context.newPage();
  const errors = [];
  const saves = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.BUYER_LOG_HORIZON_DEBUG === '1') page.on('response', response => { if (response.status() >= 400) console.log(response.status(), response.url()); });
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/horizon/fields?*', route => {
    const sourceId = new URL(route.request().url()).searchParams.get('sourceId');
    return route.fulfill({ json: { ok: true, fields: FIELDS[sourceId] || [], operators: OPERATORS, schemaError: '', sourceId } });
  });
  await page.route('**/api/horizon/values?*', route => {
    const url = new URL(route.request().url());
    const field = url.searchParams.get('column') || url.searchParams.get('field');
    const q = String(url.searchParams.get('q') || '').toLocaleLowerCase('tr-TR');
    return route.fulfill({ json: { ok: true, values: (VALUES[field] || []).filter(value => !q || value.toLocaleLowerCase('tr-TR').includes(q)), valueType: /Tarih/.test(field) ? 'date' : 'text', source: 'database' } });
  });
  await page.route('**/api/horizon/field-match', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, matches: body.fields.map((field, index) => {
      const target = MATCH[field.name] && FIELDS.mc_ias.find(entry => entry.name === MATCH[field.name]);
      return { index, target: target ? { field: target.header, table: target.table, name: target.name, type: target.type, typeSource: 'schema' } : null, confidence: target ? (target.name === field.name ? 'exact' : 'alias') : '' };
    }) } });
  });

  // Model geneli eşleme SSAS ister; uç demo hiyerarşisiyle yanıtlanır (modül ve Ufuk arayüzü gerçek).
  const DEMO_H = { version: 1, builtAt: '2026-11-26T08:00:00.000Z', columns: { name: true, directorate: true }, conflicts: [], master: { builtAt: '2026-11-26T08:00:00.000Z', pending: false, error: '' },
    mag: { CU4E: { mmyg: 'KXW4', directorate: '', rows: 9 }, CU4C: { mmyg: 'KXW4', directorate: '', rows: 4 }, BGA: { mmyg: 'KWA8', directorate: '', rows: 7, source: 'model' }, BGAS: { mmyg: 'KWA8', directorate: '', rows: 2, source: 'model' } },
    mmyg: { KXW4: { name: 'ÖRNEK ERKEK ÇOCUK', directorate: 'ÖRNEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ', rows: 13 }, KWA8: { name: 'ÖRNEK KADIN AYAKKABI', directorate: 'ÖRNEK AYAKKABI MARKA DİREKTÖRLÜĞÜ', rows: 9, source: 'model' } } };
  await page.route('**/api/merch-hierarchy', route => route.fulfill({ json: DEMO_H }));
  page.on('request', request => { if (request.url().endsWith('/api/data-management/filter-pair')) saves.push(request.postDataJSON()); });

  await page.goto(base + '/?module=source', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => switchTab('source'));
  // Not: düğme Kaynak sayfasında kapalı bölümde duruyor (horizon-drawer-ui-acceptance.js main'de de
  // bu yüzden düşüyor); çekmece aynı gerçek bileşenle DOM tıklamasıyla açılır.
  await page.waitForSelector('[data-open-horizon="cp"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1200);

  const drawer = page.locator('#dmHorizonDrawer');
  const settled = () => page.waitForFunction(() => {
    const text = document.querySelector('#dmHorizonDrawer .dmfSimple')?.textContent || '';
    return text && !/karşılık aranıyor|looking for the counterpart/.test(text);
  });
  await page.evaluate(() => document.querySelector('[data-open-horizon="cp"]').click());
  await settled();

  const shotArg = process.argv.indexOf('--screenshot'), shot = shotArg > 0 ? path.resolve(process.argv[shotArg + 1]) : '';
  // Gelişmiş kip: koşul satırı "Dim_Urun · Merch Sub-Group Code" (model adı) MAG olarak tanınır.
  await drawer.locator('[data-dmf-mode="advanced"]').click();
  await page.waitForSelector('#dmHorizonDrawer .dmfChip[data-merch-field="mag"][data-merch-value="CU4E"]');
  // Çip hover: tam zincir, "Kaldır" yerel ipucu bu sürede bastırılır.
  const chip = drawer.locator('.dmfChip[data-merch-value="BGA"]').first();
  await chip.hover();
  await page.waitForSelector('.blMerchTip.isVisible', { timeout: 5000 });
  const tip = await page.locator('.blMerchTip').textContent();
  assert.match(tip, /BGA · MAG/); assert.match(tip, /KWA8 · ÖRNEK KADIN AYAKKABI/); assert.match(tip, /ÖRNEK AYAKKABI MARKA DİREKTÖRLÜĞÜ/);
  await page.mouse.move(5, 5);
  // "+ değer" seçicisi: kod etiket, MMYG adı ve müdürlük ikinci satırda; arama adla eşleşir.
  await drawer.locator('.dmfRow:has(.dmfChip[data-merch-field]) [data-pick-value]').first().click();
  await page.waitForSelector('.dmfPickerItem .dmfPickerHint');
  const hints = await page.$$eval('.dmfPickerItem', els => els.map(el => el.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(hints.some(text => /^BGAS\s*KWA8 · ÖRNEK KADIN AYAKKABI · ÖRNEK AYAKKABI Md\.$/.test(text)), hints.join(' | '));
  assert.ok(hints.some(text => text === 'ZZ9'), 'eşlemesiz kod ek satırsız kalır');
  if (shot) {
    const pick = await page.locator('.dmfPicker').boundingBox();
    const x = Math.max(0, Math.round(pick.x - 520)), y = Math.max(0, Math.round(pick.y - 260));
    await page.screenshot({ path: shot, clip: { x, y, width: Math.min(1600 - x, 1100), height: Math.min(1000 - y, Math.max(420, Math.round(pick.height + 300))) } });
    console.log('screenshot', shot);
  }
  await page.locator('.dmfPickerSearch').fill('kadın ayakkabı');
  const filtered = await page.$$eval('.dmfPickerItem', els => els.map(el => el.dataset.value));
  assert.deepEqual(filtered.sort(), ['BGA', 'BGAS'], 'arama MMYG adıyla eşleşir (seçili BGA devre dışı görünür)');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, [], 'sayfa hatası yok');
  console.log('PASS merch horizon UI acceptance');
})().catch(error => { console.error(error); try { console.error(fs.readFileSync(path.join(root, 'server.log'), 'utf8').slice(-2500)); } catch {} process.exitCode = 1; })
  .finally(async () => { try { await browser?.close(); } catch {} server.kill(); setTimeout(() => fs.rmSync(root, { recursive: true, force: true }), 500); });
