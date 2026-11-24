'use strict';

/* İstemci: BLMerchHierarchy filtre listelerinde kodun altına MMYG adı ve Marka
   Müdürlüğünü yazar; filtre değeri ham kod kalır. Bütün filtre yüzeyleri aynı
   modülü kullanır (paralel kopya yok). DOM'a bağlı süsleme gerçek uygulamada
   doğrulanır; burada saf fonksiyonlar ve yüzey bağlantıları sabitlenir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.BLCanonicalFields = require('../public/canonical-fields.js');
const M = require('../public/merch-hierarchy.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

const DATA = {
  version: 1, builtAt: '2026-11-24T00:00:00.000Z', columns: { name: true, directorate: true }, conflicts: [],
  mag: { CU4E: { mmyg: 'CUW4', directorate: '', rows: 3 }, CU4C: { mmyg: 'CUW4', directorate: '', rows: 1 }, OLD1: { mmyg: 'ST9', directorate: 'JOY MARKA DİREKTÖRLÜĞÜ', rows: 1, stale: true } },
  mmyg: { CUW4: { name: 'ERKEK ÇOCUK', directorate: 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ', rows: 4 }, ST9: { name: 'STANDART DIŞI AKSESUAR', directorate: 'JOY MARKA DİREKTÖRLÜĞÜ', rows: 1 } },
};

test('sütun anahtarları ve başlıklar kanonik alana çözülür', () => {
  for (const key of ['MAG', 'Merch Alt Grup Kod', 'mag', 'merch']) assert.equal(M.fieldOf(key), 'mag', key);
  for (const key of ['MMYG', 'Merch Marka Yaş Grup Kod', 'mmyg', 'ageGroup', 'Yaş Grup']) assert.equal(M.fieldOf(key), 'mmyg', key);
  for (const key of ['Marka Müdürlükleri', 'brandDirectorate']) assert.equal(M.fieldOf(key), 'brandDirectorate', key);
  for (const key of ['Sezon', 'Üretici', '', null]) assert.equal(M.fieldOf(key), '', String(key));
});

test('MAG bağlamı MMYG adını ve (MAG düzeyinde boşsa) MMYG müdürlüğünü gösterir; arama adla eşleşir', () => {
  M.setData(DATA);
  const d = M.describe('mag', 'cu4e');
  assert.equal(d.line1, 'CUW4 · ERKEK ÇOCUK');
  assert.equal(d.line2, 'ERKEK ÇOCUK (8-14 YAŞ) MARKA DİREKTÖRLÜĞÜ');
  assert.equal(M.optionText('mag', 'CU4E'), 'CU4E — CUW4 · ERKEK ÇOCUK · ERKEK ÇOCUK (8-14 YAŞ) Md.');
  assert.match(M.searchText('mag', 'CU4E'), /erkek çocuk/);
  assert.equal(M.describe('mag', 'ZZ9').missing, true);
  assert.equal(M.optionText('mag', 'ZZ9'), 'ZZ9', 'eşlemesiz kod olduğu gibi kalır');
  assert.equal(M.describe('mag', 'OLD1').stale, true);
});

test('MMYG ve Marka Müdürlüğü bağlamı', () => {
  M.setData(DATA);
  const mmyg = M.describe('mmyg', 'CUW4');
  assert.equal(mmyg.line1, 'ERKEK ÇOCUK');
  assert.match(mmyg.line2, /2 MAG$/);
  const dir = M.describe('brandDirectorate', 'JOY MARKA DİREKTÖRLÜĞÜ');
  assert.equal(dir.line1, 'MMYG: ST9');
  assert.match(dir.search, /STANDART DIŞI/);
});

test('bağlam HTML kaçışlı ve TR/EN', () => {
  M.setData({ ...DATA, mmyg: { ...DATA.mmyg, CUW4: { name: '<b>X</b>', directorate: '' } } });
  assert.doesNotMatch(M.ctxHtml('mag', 'CU4E'), /<b>X/);
  assert.match(M.ctxHtml('mag', 'NOPE'), /Eşleme yok/);
  global.document = { documentElement: { lang: 'en' } };
  try { assert.match(M.ctxHtml('mag', 'NOPE'), /No mapping/); } finally { delete global.document; }
});

test('açılışta indirme yok: veri yalnız ihtiyaçta ve sürüm değişince istenir', async () => {
  const src = read('merch-hierarchy.js');
  assert.doesNotMatch(src.replace(/function ensure\(\)[\s\S]*?\n  \}/, ''), /fetch\(/, 'fetch yalnız ensure() içinde');
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true, json: async () => DATA }; };
  try {
    M.setData(null);
    await M.ensure(); await M.ensure();
    assert.equal(calls, 1);
    M.noteVersion('v2'); await M.ensure();
    assert.equal(calls, 2, 'yeni yenileme sonrası tekrar istenir');
  } finally { delete global.fetch; }
});

test('bütün filtre yüzeyleri aynı modülü kullanır', () => {
  const surfaces = {
    'app-main.js': [/merchField = isDate \|\| !window\.BLMerchHierarchy/, /window\.BLMerchHierarchy\?\.decorate\?\.\(bodyEl, key\)/, /kolMerchField=window\.BLMerchHierarchy/, /BLMerchHierarchy\?\.noteVersion/, /columnKey: dim,/],
    'oab.js': [/columnKey: descriptor\.key/],
    'detail-drawer.js': [/columnKey:col\.key\|\|key/],
    'quotations.js': [/BLMerchHierarchy\?\.decorate/],
    'lfl.js': [/item:'\.lflDimOption'/, /item:'\.lflCustomCompareOption'/, /item:'\.lflScenarioValueOption'/],
    'pricing-desk.js': [/item:'\.pdCheck'/],
    'price-supplier-analysis.js': [/item:'\.psaMultiOption'/, /BLMerchHierarchy\.searchText/],
    'backlog-plan-actual.js': [/decorateSelect\(select,select\.dataset\.bpaFilter\)/],
    'overview-global-flow.js': [/\['mag','mmyg'\]\.forEach\(key=>window\.BLMerchHierarchy/],
    'data-management-filter.js': [/BLMerchHierarchy\.optionText\(merchField, value\)/],
    'user-management.js': [/function decorateMerch\(/, /decorateMerch\(main\)/],
    'quick-filter-groups.js': [/BLMerchHierarchy\.optionText\(merchField/],
  };
  for (const [file, patterns] of Object.entries(surfaces)) {
    const src = read(file);
    for (const pattern of patterns) assert.match(src, pattern, `${file}: ${pattern}`);
  }
  assert.match(read('index.html'), /<script src="merch-hierarchy\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(read('ui-components.css'), /\.blMerchCtx \{[^}]*var\(--ui-text-muted\)/, 'görünüm ortak bileşen dosyasında, renk token üzerinden');
});
