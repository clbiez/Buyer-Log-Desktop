'use strict';
/* #1079 WS6d parite kapısı: Açık Maliyet meta alanı önerileri.
 *
 * Eski yol: her tuşta buildSuggestions tüm CP ve Koleksiyon satırlarını tarar, altı
 * datalist'i yeniden yazar ve öneriler DOM'dan geri okunur. Yeni yol
 * (BL_READ_MODEL_OPEN_COSTING, varsayılan açık): havuz odakta / editör çiziminde aynı
 * kodla kurulur; yazarken aynı sıralı kalemler bellekten süzülür.
 * GERÇEK public/open-costing.js vm'de anahtar kapalı ve açık yüklenir. Aynı oturum
 * (odak → tuş tuş yazma → veri değişimi → yeniden odak) için açılan öneri listesinin
 * HTML'i ve datalist içerikleri kanonik hash ile karşılaştırılır.
 * Veri: WS0 demo → parse → buildProjections('cp') (iki yetki kapsamı) + sentetik
 * Koleksiyon satırları (erp-collection-fixture). 30k: BL_OPEN_COSTING_PARITY_ROWS=2000,30000.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parity = require('./helpers/read-model-parity.cjs');
const parse = require('../server/lib/parse');
const tasks = require('../server/lib/compute-tasks');
const access = require('../server/lib/compute-access');
const { buildCollectionRows } = require('../scripts/lib/erp-collection-fixture');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-costing.js'), 'utf8');
const TODAY = '2026-01-15';
const ROW_SIZES = String(process.env.BL_OPEN_COSTING_PARITY_ROWS || '2000').split(',').map(Number).filter(n => n >= 500);
const LOG = process.env.BL_OPEN_COSTING_PARITY_LOG === '1';
const LISTS = { modelCode: 'ocModelOptions', manufacturer: 'ocManufacturerOptions', country: 'ocCountryOptions', season: 'ocSeasonOptions', license: 'ocLicenseOptions', category: 'ocCategoryOptions' };

const unescape = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function fakeElement(id) {
  let html = '', options = [];
  const el = {
    id, dataset: {}, style: {}, hidden: false, value: '', textContent: '', writes: 0,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = String(value); el.writes++;
      options = [...html.matchAll(/<option value="([^"]*)"(?: data-label="([^"]*)")?><\/option>/g)].map(m => ({ value: unescape(m[1]), textContent: '', label: '', dataset: m[2] === undefined ? {} : { label: unescape(m[2]) } }));
    },
    querySelectorAll: selector => (selector === 'option' ? options : []),
    querySelector: () => null, addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, remove() { el.removed = true; }, focus() {}, select() {},
    closest: () => null, contains: () => false, getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 30, right: 210, width: 200, height: 20 }),
  };
  return el;
}

function loadOpenCosting({ flag, pref, cpRows, kolRows, records }) {
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); };
  const created = [];
  const storage = new Map(pref === undefined ? [] : [['buyerlog.readModel.openCosting.v1', pref]]);
  const context = {
    console, queueMicrotask, setTimeout, clearTimeout, structuredClone: global.structuredClone, innerWidth: 1600, innerHeight: 1000,
    document: { readyState: 'complete', body: { dataset: { activeTab: 'overview' }, appendChild() {} }, getElementById: get, querySelectorAll: () => [], querySelector: () => null,
      addEventListener() {}, removeEventListener() {}, createElement: tag => { const el = fakeElement(tag); created.push(el); return el; } },
    localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: async () => ({ ok: true, json: async () => ({ items: [], _revision: 0 }) }),
    addEventListener() {}, removeEventListener() {},
    BLBusinessRules: require('../public/business-rules'),
    BLCollectionModelGroups: require('../public/collection-model-groups'),
    BLOpenCostingEngine: require('../public/open-costing-engine'),
    BLFX: { store: { months: {} }, load: async () => {} },
    state: { cp: { rows: cpRows } }, kolRows, kolManufacturers: [{ name: 'MFR-01' }, { name: 'MFR-02' }], appLang: 'tr',
  };
  context.window = context;
  if (flag !== undefined) context.BL_READ_MODEL_OPEN_COSTING = flag;
  vm.createContext(context);
  vm.runInContext(SOURCE.replace('window.__openCostingTest={', 'window.__openCostingTest={showOcMetaSuggest,closeOcMetaSuggest,'), context, { filename: 'open-costing.js' });
  const api = context.__openCostingTest;
  api.setRecordsForTest(records);
  return { api, context, elements, created, get };
}

const scopeCache = new Map();
function cpScopes(rows) {
  if (scopeCache.has(rows)) return scopeCache.get(rows);
  const fx = parity.makeFixture({ rows, today: TODAY });
  const asas = parse.parseASASRows(fx.asas).orders, antrepo = parse.parseAntrepoRows(fx.antrepo);
  const src = { loadedAt: 'r1', asasOrders: asas, asasOrdersByTarget: { cp: asas, orders: asas }, antrepoMap: antrepo, lflRows: [] };
  const buyers = [...new Set(asas.map(row => row.buyer))].sort();
  const out = [{ id: 'moderator', all: true, buyers: [] }, { id: 'buyer-a', all: false, buyers: buyers.slice(0, Math.ceil(buyers.length / 2)) }].map(user => {
    const ctx = access.createAccessContext({ userId: user.id, systemRole: user.all ? 'moderator' : 'buyer', manageAll: user.all,
      viewScope: { all: user.all, mode: user.all ? 'ALL' : 'CUSTOM', buyers: user.buyers }, editScopes: { buyers: user.buyers },
      authority: Object.fromEntries(asas.map(row => [row.ocode, [row]])), profiles: [] });
    const built = tasks.buildProjections(src, { modules: ['cp'], overrides: {}, horizons: {}, access: ctx });
    return { user, rows: JSON.parse(tasks.serialize({ rows: built.cp.rows }, 'projection')).rows };
  });
  scopeCache.set(rows, out);
  return out;
}

function openDrop(env) {
  const el = env.created.filter(c => c.className === 'submfrDrop ocMetaSuggestDrop').pop();
  return el && !el.removed ? el : null;
}
function input(field) {
  return { dataset: { kind: 'oc-meta-suggest', options: LISTS[field], ocMeta: field }, value: '', setAttribute() {}, removeAttribute() {}, focus() {}, closest: () => null,
    getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 30, right: 210, width: 200, height: 20 }) };
}

/* Oturum: her alan için odak (tüm liste) → değerin ilk 1..4 karakteri tuş tuş → büyük harf
   ve boşluklu sorgu → eşleşmeyen sorgu. Sonra veri değişir ve alan yeniden odaklanır. */
function session(env, cpRows, kolRows) {
  const { api, created, get } = env, out = [];
  const shot = label => { const el = openDrop(env); out.push([label, el ? el.innerHTML : null]); };
  const sample = { modelCode: cpRows[Math.floor(cpRows.length / 3)]['Model Name'], manufacturer: 'MFR-0', country: 'Tur', season: kolRows[5].season, license: 'LIC', category: 'card' };
  const typeField = (field, text) => {
    const el = input(field);
    env.api.closeOcMetaSuggest();
    api.showOcMetaSuggest(el, true); shot(field + ':focus');
    for (let i = 1; i <= Math.min(4, text.length); i++) { el.value = text.slice(0, i); api.showOcMetaSuggest(el); shot(field + ':' + el.value); }
    el.value = '  ' + String(text).toLocaleUpperCase('tr-TR') + ' '; api.showOcMetaSuggest(el); shot(field + ':upper');
    el.value = 'zz-no-such-value'; api.showOcMetaSuggest(el); shot(field + ':none');
  };
  for (const field of Object.keys(LISTS)) typeField(field, String(sample[field]));
  // Odaklar arasında veri değişir: yeni CP satırı ve Koleksiyon satırı, yeni sezon ve üretici.
  cpRows.push({ 'Model Name': 'WS6D-NEW-MODEL', Season: '27SS', 'Sub-Manufacturer': 'WS6D Yeni Üretici', Country: 'İzlanda', License: 'LIC-Z', Category: 'Şal' });
  kolRows.push({ id: 999999, modelKod: 'WS6D-KOL', season: '27AW', lisans: 'LIC-Y', urunTipi: 'Kaşkol', country: 'Iraq' });
  for (const field of Object.keys(LISTS)) typeField(field, { modelCode: 'WS6D', manufacturer: 'ws6d', country: 'İz', season: '27', license: 'LIC-', category: 'ş' }[field]);
  out.push(['lists', Object.values(LISTS).map(id => get(id).innerHTML)]);
  return out;
}

function compare(label, legacy, candidate) {
  const left = parity.canonicalHash(legacy), right = parity.canonicalHash(candidate);
  if (LOG) console.log(`[open-costing parity] ${label}: ${left === right ? 'OK' : 'FAIL'} ${left.slice(0, 12)}`);
  if (left !== right) assert.fail(`${label}: ${JSON.stringify(parity.firstDivergence(JSON.parse(parity.canonicalJson(legacy)), JSON.parse(parity.canonicalJson(candidate))))}`);
}

const RECORDS = [{ id: 'r1', title: 'Kayıt 1', meta: { manufacturer: 'Kayıt Üretici', country: 'Mısır', season: '25SS', license: 'LIC-A', category: 'Hırka' } }];

for (const rows of ROW_SIZES) {
  test(`Açık Maliyet önerileri: bellekten süzme eski her-tuşta-yeniden-kurma ile aynı (${rows} satır, iki yetki kapsamı)`, () => {
    for (const { user, rows: scopeRows } of cpScopes(rows)) {
      const kol = buildCollectionRows(Math.min(rows, 5000), 7);
      const run = flag => {
        const cpRows = structuredClone(scopeRows), kolRows = structuredClone(kol);
        const env = loadOpenCosting({ flag, cpRows, kolRows, records: RECORDS });
        const result = session(env, cpRows, kolRows);
        return { result, writes: Object.values(LISTS).reduce((sum, id) => sum + env.get(id).writes, 0) };
      };
      const legacy = run(false), candidate = run(undefined);
      compare(`${rows} ${user.id}`, legacy.result, candidate.result);
      const shown = legacy.result.filter(([label, html]) => label !== 'lists' && html);
      assert.ok(shown.length > 20, `${user.id}: öneri listesi görünmeli`);
      assert.ok(legacy.result.some(([label, html]) => label.endsWith(':WS6D') && /WS6D-NEW-MODEL/.test(html || '')), 'yeni veri yeniden odakta görünmeli');
      // Yeni yol yalnız odakta kurar ve değişmeyen listeyi yeniden yazmaz.
      assert.ok(candidate.writes < legacy.writes / 4, `datalist yazımı azalmalı (${candidate.writes} / ${legacy.writes})`);
    }
  });
}

test('anahtar ve yerel tercih geri dönüşü: kapalıyken her tuş havuzu yeniden kurar', () => {
  const cpRows = [{ 'Model Name': 'A-1', Season: '25SS' }], kolRows = [];
  for (const [opts, rebuildsOnType] of [[{}, false], [{ flag: true }, false], [{ flag: false }, true], [{ pref: '0' }, true], [{ flag: true, pref: '0' }, false]]) {
    const env = loadOpenCosting({ ...opts, cpRows, kolRows, records: [] });
    const el = input('modelCode');
    env.api.showOcMetaSuggest(el, true);
    const before = env.get('ocModelOptions').writes;
    cpRows.push({ 'Model Name': 'A-2' });
    el.value = 'a'; env.api.showOcMetaSuggest(el);
    const html = openDrop(env).innerHTML;
    assert.equal(/A-2/.test(html), rebuildsOnType, JSON.stringify(opts));
    assert.equal(env.get('ocModelOptions').writes > before, rebuildsOnType, JSON.stringify(opts));
    cpRows.pop();
  }
});

test('yeni yol: editör çizimi (buildSuggestions) ve yeniden odak güncel veriyi gösterir', () => {
  const cpRows = [{ 'Model Name': 'A-1' }], kolRows = [];
  const env = loadOpenCosting({ cpRows, kolRows, records: [] });
  const el = input('modelCode');
  env.api.showOcMetaSuggest(el, true);
  cpRows.push({ 'Model Name': 'A-2' });
  env.api.buildSuggestions();
  el.value = 'a'; env.api.showOcMetaSuggest(el);
  assert.match(openDrop(env).innerHTML, /A-2/);
  assert.deepEqual([...env.api.ocMetaSuggestionValues(el)], ['A-1', 'A-2']);
  // Dönen dizi önbelleğin kopyasıdır; çağıranın değişikliği önbelleği bozmaz.
  env.api.ocMetaSuggestionItems(el).length = 0;
  assert.deepEqual([...env.api.ocMetaSuggestionValues(el)], ['A-1', 'A-2']);
});
