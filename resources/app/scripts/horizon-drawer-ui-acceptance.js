'use strict';
// Real Buyer Log UI on an isolated server with demo ASAS / IAS connections.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-horizon-drawer-'));
const port = Number(process.env.BUYER_LOG_HORIZON_PORT || 6495);
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
    { id: 'sc_cp', targets: ['cp'], horizon: { table: 'Dim_Urun', groups: [{ id: 'g', conditions: [C('a1', 'Dim_Urun', 'Sezon', ['W26', 'S27']), C('a2', 'Dim_Urun', 'Buyer Grup', ['DEMO KIDS'])] }] } },
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
  mc_asas: [F('Dim_Urun', 'Sezon'), F('Dim_Urun', 'Buyer Grup'), F('Dim_Urun', 'Marka'), F('Dim_Urun', 'Ürün Tanım'), F('Fact_Siparis', 'Orijinal Exfactory Merch Tarih', 'date'), F('Fact_Siparis', 'Tedarikçi')],
  mc_ias: [F('Siparis Bilgileri', 'Sezon Kod'), F('Siparis Bilgileri', 'Buyer Grup'), F('Siparis Bilgileri', 'Marka'), F('Siparis Bilgileri', 'Ürün Tanım'), F('Siparis Bilgileri', 'Vasita'), F('Siparis Bilgileri', 'Tahmini Antrepo Giriş Tarihi', 'date')],
};
const OPERATORS = [['in', 'list'], ['notIn', 'list'], ['between', 'range'], ['gte', 'from'], ['lte', 'to'], ['contains', 'single'], ['startsWith', 'single'], ['empty', 'none'], ['notEmpty', 'none']]
  .map(([id, arity]) => ({ id, arity, label: id }));
const VALUES = { Sezon: ['W25', 'S26', 'W26', 'S27', 'W27'], 'Sezon Kod': ['W25', 'S26', 'W26', 'S27', 'W27'], 'Buyer Grup': ['DEMO KIDS', 'DEMO MEN', 'DEMO WOMEN'], Marka: ['DEMO A', 'DEMO B', 'DEMO C'], 'Ürün Tanım': ['Kazak', 'Hırka', 'Yelek'], Tedarikçi: ['Tedarikçi 01', 'Tedarikçi 02'], Vasita: ['Gemi', 'Uçak'] };
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
  page.on('request', request => { if (request.url().endsWith('/api/data-management/filter-pair')) saves.push(request.postDataJSON()); });

  await page.goto(base + '/?module=source', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof switchTab === 'function', null, { timeout: 60000 });
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({ timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('blBootGuard'), null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => switchTab('source'));
  await page.waitForSelector('[data-open-horizon="cp"]', { timeout: 30000 });
  await page.waitForTimeout(1200);

  const drawer = page.locator('#dmHorizonDrawer');
  const settled = () => page.waitForFunction(() => {
    const text = document.querySelector('#dmHorizonDrawer .dmfSimple')?.textContent || '';
    return text && !/karşılık aranıyor|looking for the counterpart/.test(text);
  });
  await page.locator('[data-open-horizon="cp"]').click();
  await settled();
  assert.equal(await drawer.locator('[data-dmh-tab]').count(), 3, 'CP, Diğer modüller ve INTAKE sekmeleri');
  assert.match(await drawer.locator('.dmfActive').textContent(), /IAS: Sezon Kod/, 'mevcut IAS karşılığı kartta görünür');

  // Arama kutusu her tuştan sonra aynı DOM düğümü ve klavye odağını korumalı.
  // Türkçe karakterler ve sıfır sonuç durumu da yeniden odaklama gerektirmemeli.
  const colSearch = drawer.locator('[data-dmf-col-search]');
  await colSearch.focus();
  await colSearch.evaluate(el => { window.__horizonSearchInput = el; });
  for (const char of 'Gökberk') {
    await page.keyboard.type(char);
    assert.equal(await colSearch.evaluate(el => document.activeElement === el && window.__horizonSearchInput === el), true,
      'sütun aramasında her harften sonra aynı input odakta kalmalı');
  }
  assert.equal(await colSearch.inputValue(), 'Gökberk');
  await colSearch.fill('');

  // Yeni sütun → otomatik IAS eşleme → değer seçimi IAS'a da taşınır.
  await colSearch.fill('Marka');
  await drawer.locator('[data-dmf-add-field="Marka"]').click();
  const valueSearch = drawer.locator('.dmfEditorPane > .blvFilterValueTools [data-dmf-value-search]');
  await valueSearch.focus();
  await valueSearch.evaluate(el => { window.__horizonValueSearchInput = el; });
  for (const char of 'DEMO') {
    await page.keyboard.type(char);
    assert.equal(await valueSearch.evaluate(el => document.activeElement === el && window.__horizonValueSearchInput === el), true,
      'değer aramasında her harften sonra aynı input odakta kalmalı');
  }
  await page.waitForTimeout(450); // debounce tamamlanınca da odak korunur
  assert.equal(await valueSearch.inputValue(), 'DEMO');
  assert.equal(await valueSearch.evaluate(el => document.activeElement === el), true);
  await valueSearch.fill('');
  await drawer.locator('.blvFilterValue', { hasText: 'DEMO B' }).first().click();
  await settled();
  assert.match(await drawer.locator('.dmfPairBox').textContent(), /Siparis Bilgileri · Marka/);
  // Klavye: Space ile işaretlenen onay kutusunda odak kalır; ikinci Space işareti kaldırır.
  const demoA = '.dmfEditorPane > .dmfValueList input[data-dmf-v="DEMO%20A"]';
  await drawer.locator(demoA).focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(selector => document.activeElement === document.querySelector(selector), demoA), true, 'odak onay kutusunda kalmalı');
  await page.keyboard.press('Space');
  assert.equal(await drawer.locator(demoA).isChecked(), false, 'ikinci Space seçimi kaldırmalı');
  await drawer.locator('[data-dmf-pair-custom]').click();
  const pairSearch = drawer.locator('.dmfPairBox [data-dmf-value-search]');
  await pairSearch.focus();
  await page.keyboard.type('DEMO');
  assert.equal(await pairSearch.evaluate(el => document.activeElement === el), true, 'IAS değer aramasında odak korunmalı');
  await pairSearch.fill('');
  await drawer.locator('.dmfPairBox .blvFilterValue', { hasText: 'DEMO C' }).click();
  await page.waitForTimeout(300);
  if (process.env.BUYER_LOG_HORIZON_SCREENSHOT === '1') {
    const out = path.join(app, 'public', 'release-notes', 'next-assets');
    fs.mkdirSync(out, { recursive: true });
    await drawer.locator('.dmfEditorPane').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(out, 'horizon-filter-drawer.png') });
  }

  // Gelişmiş kip aynı durumu gösterir; Basit'e dönülebilir.
  await drawer.locator('[data-dmf-mode="advanced"]').click();
  assert.ok(await drawer.locator('.dmfGroups').isVisible());
  await drawer.locator('[data-dmf-mode="simple"]').click();

  // Diğer modüller ve INTAKE kendi sekmelerinde açılır (kaydedilmemiş değişiklik onaylanır).
  await drawer.locator('[data-dmh-tab="linked"]').click();
  await settled();
  assert.match(await drawer.locator('.dmfTitle').textContent(), /ASAS ⇄ IAS/);
  await drawer.locator('[data-dmh-tab="intake"]').click();
  await page.waitForFunction(() => /INTAKE/.test(document.querySelector('#dmHorizonDrawer .dmfTitle')?.textContent || ''));

  // CP'ye dön, kaydet: ASAS ve IAS tek işlemde yazılır, çekmece kapanır.
  await drawer.locator('[data-dmh-tab="cp"]').click();
  await settled();
  await drawer.locator('[data-dmf-col-search]').fill('Marka');
  await drawer.locator('[data-dmf-add-field="Marka"]').click();
  await drawer.locator('.blvFilterValue', { hasText: 'DEMO C' }).first().click();
  await settled();
  await drawer.locator('[data-save="personal"]').click();
  await page.waitForFunction(() => document.getElementById('dmHorizonDrawer').hidden);
  assert.equal(saves.length, 1, 'tek eşli kayıt');
  const names = item => item.definition.groups.flatMap(group => group.conditions.map(condition => `${condition.name}=${condition.values.join('|')}`));
  assert.deepEqual(names(saves[0].items[0]), ['Sezon=W26|S27', 'Buyer Grup=DEMO KIDS', 'Marka=DEMO C']);
  assert.deepEqual(names(saves[0].items[1]), ['Sezon Kod=W26|S27', 'Buyer Grup=DEMO KIDS', 'Marka=DEMO C']);
  assert.deepEqual(errors, [], 'sayfa hatası olmamalı');
  console.log('Horizon drawer acceptance: OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
});
