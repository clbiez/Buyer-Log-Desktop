'use strict';

/*
 * Kullanıcı talebi: "E-mail grupları modülünü Üreticiler olarak revize edelim
 * ve bunu direkt soldaki navigasyon bara taşıyalım. Bu kendi sayfası olması
 * gereken bir alan. Bu sayfanın analizi direkt Orders/LFL/Price And Supplier
 * Analysis alanlarının ortak verisine bağlı olsun."
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const PERF = read('public/perf-runtime.js');
const ACCESS = read('public/user-access-ui.js');
const PAGE = read('public/manufacturers.js');
const CSS = read('public/manufacturers.css');
const EG = read('public/email-groups.js');
const DM = read('public/data-management.js');

test('Manufacturers is a left-menu page with its own lazy section', () => {
  assert.match(INDEX, /<button data-tab="manufacturers"[^>]*data-i18n-title-en="Manufacturers"/);
  assert.match(INDEX, /<section id="view-manufacturers">\s*<div class="manufacturersPage" id="manufacturersPage"/);
  assert.match(INDEX, /manufacturers\.css\?v=/);
  assert.match(APP, /manufacturers:\{tr:'Üreticiler',en:'Manufacturers',group:'commercial'\}/);
  assert.match(APP, /ensureFeature\('manufacturers'\)\.then\(\(\)=>\{\s*if\(currentActiveTab\(\)==='manufacturers'\)return window\.initManufacturersPage\?\.\(\);/);
  assert.match(PERF, /manufacturers:\['manufacturer-cards-engine\.js\?rev=1','email-groups\.js\?rev=2','manufacturers\.js\?rev=1'\]/);
  // Görünmeyen modül eager yüklenmez.
  assert.doesNotMatch(INDEX, /<script[^>]+manufacturers\.js/);
  assert.doesNotMatch(INDEX, /<script[^>]+manufacturer-cards-engine\.js/);
});

test('page access follows the Orders area whose data it reads', () => {
  assert.match(APP, /const accessArea=tab==='manufacturers'\?'orders':/);
  assert.match(ACCESS, /key==='manufacturers'\?'orders':key/);
});

test('analysis reads the shared Orders projection through one bridge', () => {
  assert.match(APP, /window\.BLManufacturerDataBridge=\{\s*async rows\(\)\{await ensureOrdersLoaded\(\);return \(state\.orders&&state\.orders\.rows\)\|\|\[\];\}/);
  assert.match(PAGE, /window\.BLManufacturerDataBridge/);
  assert.match(PAGE, /E\.buildCards\(S\.rows, S\.directory\.records/);
  assert.doesNotMatch(PAGE, /<section class=|<\/section>/, 'global section{display:none} tuzağı');
});

test('cards are built from the shared directory, never a second list', () => {
  assert.match(PAGE, /api\('\/api\/email-groups'\)/);
  assert.match(PAGE, /'\/api\/email-groups\/asas-cards'/);
  assert.match(PAGE, /\/link`/);
  assert.match(EG, /bl:manufacturer-directory-changed/);
  assert.match(EG, /async function openRecord\(id, \{ edit = false \} = \{\}\)/);
  assert.match(EG, /data-eg-input="aliases"/);
  assert.match(EG, /list="egAsasNames"/);
  assert.match(DM, /window\.switchTab\('manufacturers'\)/);
});

test('page CSS uses its own prefix and does not collide with Prepare E-Mail .mfr* rules', () => {
  assert.doesNotMatch(CSS, /\.mfr[A-Z]/);
  assert.doesNotMatch(PAGE, /class="mfr[A-Z ]/);
  assert.match(CSS, /\.mfpCard\{/);
});

test('store keeps aliases, creates ASAS cards without overwriting and links with the old name kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-mfr-cards-'));
  const previous = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  for (const key of Object.keys(require.cache)) if (/server[\\/](user-data|lib[\\/]email-groups-store)\.js$/.test(key)) delete require.cache[key];
  try {
    const store = require('../server/lib/email-groups-store');
    const actor = { id: 'u1', name: 'User' };
    const created = store.createRecord({ manufacturer: 'Delta Apparel', email: 'a@b.co' }, actor);
    const first = store.createFromAsas([{ manufacturer: 'ORNEK TRIKO A.S.', countryName: 'Turkey' }, { manufacturer: 'delta apparel', countryName: 'Turkey' }], actor);
    assert.deepEqual(first.summary.added, ['ORNEK TRIKO A.S.']);
    assert.deepEqual(first.summary.unchanged, ['delta apparel']);
    const loaded = store.loadStore();
    const ornek = loaded.records.find(item => item.manufacturer === 'ORNEK TRIKO A.S.');
    assert.equal(ornek.origin, 'asas');
    assert.equal(loaded.countries.find(item => item.id === ornek.countryId).name, 'Turkey');
    const linked = store.linkRecord(created.record.id, 'DELTA APPAREL CO', actor);
    assert.equal(linked.record.manufacturer, 'DELTA APPAREL CO');
    assert.deepEqual(linked.record.aliases, ['Delta Apparel']);
    assert.equal(linked.record.email, 'a@b.co');
    assert.throws(() => store.linkRecord(ornek.id, 'Delta Apparel', actor), /zaten/);
  } finally {
    if (previous == null) delete process.env.BUYER_LOG_SERVER_DATA_ROOT; else process.env.BUYER_LOG_SERVER_DATA_ROOT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('existing ASAS connections pick up Initial Inspection Geçme Tarih once, without breaking refresh', async () => {
  const modelFields = require('../server/lib/model-fields');
  const { ensureConnectionMapping } = require('../server/lib/model-refresh');
  const required = modelFields.fieldsForRole('asas').filter(field => field.required);
  const base = () => Object.fromEntries(required.map(field => [field.header, { table: 'ASAS', name: field.header, kind: 'column' }]));
  const columns = [...required.map(field => field.header), 'Ürün Tanım', 'Initial Inspection Geçme Merch Ay', 'Initial Inspection Geçme Merch Hafta', 'Initial Inspection Geçme Tarih', 'Initial Inspection Geçme Tarih Gün Ay Yıl']
    .map(name => ({ table: 'ASAS', name, kind: 'column' }));
  const item = { role: 'asas', name: 'ASAS', server: 'db', catalog: 'c', mapping: { ...base(), 'Ürün Tanım': { table: 'ASAS', name: 'Ürün Tanım', kind: 'column' } }, mappingEnhancementScanVersion: 2, horizon: { table: 'ASAS' } };
  const result = await ensureConnectionMapping(item, { discoverSchema: async () => ({ columns, measures: [] }) });
  assert.equal(result.mapping['Initial Inspection Geçme Tarih'].name, 'Initial Inspection Geçme Tarih');
  assert.equal(result.mapping['Initial Inspection Geçme Tarih Gün Ay Yıl'].name, 'Initial Inspection Geçme Tarih Gün Ay Yıl');
  assert.equal(item.mappingEnhancementScanVersion, 4);
  // Şema okunamazsa yenileme durmaz ve tarama tekrar denenmez.
  const offline = { role: 'asas', name: 'ASAS', server: 'db', catalog: 'c', mapping: { ...base(), 'Ürün Tanım': { table: 'ASAS', name: 'Ürün Ana Tanım', kind: 'column' } }, mappingEnhancementScanVersion: 2, horizon: { table: 'ASAS' } };
  const soft = await ensureConnectionMapping(offline, { discoverSchema: async () => { throw new Error('offline'); } });
  assert.equal(soft.repaired, false);
  assert.equal(offline.mappingEnhancementScanVersion, 4);
});
