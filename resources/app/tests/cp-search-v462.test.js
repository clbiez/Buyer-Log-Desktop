'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

function loadCanonicalFields() {
  const sandbox = { window: {} };
  Function('window', fs.readFileSync(path.join(ROOT, 'public', 'canonical-fields.js'), 'utf8'))(sandbox.window);
  return sandbox.window.BLCanonicalFields;
}

function cpSearchKeysFromSource(fields = loadCanonicalFields()) {
  const base = html.match(/const CP_BASE_SEARCH_KEYS=(\[[^\]]+\]);/);
  const ids = html.match(/const CP_CANONICAL_SEARCH_FIELDS=(\[[^\]]+\]);/);
  const helper = html.match(/\nfunction cpCanonicalSearchKeys\(fields,ids\)\{[^]*?\n\}/);
  const decl = html.match(/const CP_SEARCH_KEYS=Array\.from\(new Set\(\[\.\.\.CP_BASE_SEARCH_KEYS,\.\.\.cpCanonicalSearchKeys\(window\.BLCanonicalFields,CP_CANONICAL_SEARCH_FIELDS\)\]\)\);/);
  assert.ok(base && ids && helper && decl, 'CP_SEARCH_KEYS kanonik tanımı bulunmalı');
  return Function('window', `const CP_BASE_SEARCH_KEYS=${base[1]};const CP_CANONICAL_SEARCH_FIELDS=${ids[1]};${helper[0]}\n${decl[0]}\nreturn CP_SEARCH_KEYS;`)({ BLCanonicalFields: fields });
}

test('v4.68 CP genel araması PLM ID, üretici ve kod alanlarını kapsar', () => {
  const keys = cpSearchKeysFromSource();
  for (const key of ['PLM ID', 'Manufacturer', 'Sub-Manufacturer', 'Special Code', 'Colour Code']) {
    assert.ok(keys.includes(key), `${key} CP aramasına dahil olmalı`);
  }
});

test('v4.68 CP araması başlık varyasyonlarını ve mevcut alanları korur', () => {
  const keys = cpSearchKeysFromSource();
  for (const key of ['Sub Manufacturer', 'Color Code', 'Model Name', 'License', 'Order Code', 'Colour']) {
    assert.ok(keys.includes(key), `${key} arama kapsamından çıkmamalı`);
  }
  assert.match(
    html,
    /id="cpSearch" placeholder="[^"]*PLM ID[^"]*alt üretici[^"]*özel kod[^"]*renk kodu[^"]*"/,
    'arama kutusu açıklaması yeni kapsamı belirtmeli',
  );
});

test('v4.68 CP arama filtresi tüm tanımlı alanları tek metinde tarar', () => {
  const {cpSearchHaystack:haystack}=require('./helpers/bl-table-search-rows').createRows();
  assert.equal(haystack({ 'PLM ID': ' 2135851 ', 'Model Name': 'BOST', Buyer: '', Line: null }), '2135851 bost');
  assert.equal(haystack({ Quantity: 5 }), '', 'arama alanı olmayan sütun eşleşmeye girmez');
  // CP ve Siparişler süzgeci aynı yardımcıyı kullanır.
  assert.match(html, /if\(!tableSearchMatches\(cpSearchHaystack\(r\),ctx\.q,tableSearchOptions\(r,'cp'\)\)\) return false/);
  assert.match(html, /if\(!tableSearchMatches\(cpSearchHaystack\(row\),ctx\.q,tableSearchOptions\(row,'orders'\)\)\)return false/);
});

test('CP/Siparişler araması ürün tanımı, kategori, MAG, Buyer Grup, Buyer ve Line alanlarını kanonik bağlamayla kapsar', () => {
  const fields = loadCanonicalFields();
  const keys = cpSearchKeysFromSource(fields);
  assert.match(html, /const CP_CANONICAL_SEARCH_FIELDS=\['productDescription','category','mag','buyingGroup','buyer','line','season','country','orderStatus','deliveryType','orderActivity','inStore'\];/);
  for (const id of ['productDescription', 'category', 'mag', 'buyingGroup', 'buyer', 'line']) {
    for (const mod of ['cp', 'orders']) {
      for (const key of fields.bindingFor(mod, id).keys) assert.ok(keys.includes(key), `${mod}.${id} → ${key} aramaya dahil olmalı`);
    }
  }
  assert.equal(new Set(keys).size, keys.length, 'anahtarlar tekrarlanmaz');
  const row = { 'Ürün Ana Tanım': 'KAZAK', 'Ürün Klasman': 'TRIKO', MAG: 'M123', 'Buyer Grup (TR)': 'ERKEK GENC', Buyer: 'AYSE', Line: 'BASIC' };
  const hay = keys.map(k => String(row[k] == null ? '' : row[k]).trim().toLowerCase()).join(' ');
  for (const needle of ['kazak', 'triko', 'm123', 'erkek genc', 'ayse', 'basic']) assert.ok(hay.includes(needle), `${needle} haystack içinde olmalı`);
  // Bağlama modülü yüklenmemişse arama eski alanlarla çalışmaya devam eder.
  const fallback = cpSearchKeysFromSource(undefined);
  assert.ok(fallback.includes('PLM ID') && fallback.includes('Ürün Tanım'));
});

test('CP/Siparişler arama kutusu yeni kapsamı TR/EN olarak belirtir', () => {
  const dict = fs.readFileSync(path.join(ROOT, 'public', 'i18n-dictionary.js'), 'utf8');
  const tr = 'PLM ID, model, ürün tanımı, kategori, MAG, Buyer Grup, Buyer, Line, lisans, üretici, alt üretici, özel kod, renk kodu, sipariş kodu ara…';
  assert.ok(html.includes(`id="cpSearch" placeholder="${tr}"`));
  assert.ok(html.includes(`id="ordersSearch" placeholder="${tr}"`));
  assert.ok(dict.includes(`["${tr}","Search PLM ID, model, product description, category, MAG, buyer group, buyer, line, license, manufacturer, sub-manufacturer, special code, colour code, order code…"]`));
});
