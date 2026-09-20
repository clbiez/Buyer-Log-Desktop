'use strict';

// v5.93 — License Royalty Rules ekranına iki yönlü fiyat kontrolü.
//
// Ekran şimdiye kadar yalnız TEK yön hesaplıyordu: Final FOB → Supp. FOB.
// Kullanıcının ihtiyacı ters yön de: "X lisansı için 1 USD Supp FOB ise Final
// FOB kaç?" Bu, mevcut formülün tersidir ve Koleksiyon'daki Landed hesabı
// yıllardır aynı tersi kullanıyordu; artık tek yerden çağrılabiliyor.
//
//   İleri: Supp  = (Final − Hologram) × (1 − Royalty%)
//   Ters:  Final = Supp ÷ (1 − Royalty%) + Hologram

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const rules = require('../public/business-rules');

test('v5.93 kullanıcının verdiği örnek birebir çıkıyor', () => {
  // "1 dolar supp FOB ise 1,26 dolar final FOB" — %20 royalty + 0,01 hologram.
  const rule = { royalty: 20, hologramCost: 0.01 };
  assert.equal(rules.calculateFinalFobWithRule(1, rule), 1.26);
  // Ters yön aynı kuralla başlangıca dönmeli.
  assert.equal(rules.calculateSuppFobWithRule(1.26, rule), 1);
});

test('v5.93 iki yön birbirinin tersi', () => {
  const rule = { royalty: 25, hologramCost: 0.05 };
  const final = rules.calculateFinalFobWithRule(1, rule);
  assert.equal(final, 1.38);
  assert.equal(rules.calculateSuppFobWithRule(final, rule), 1);

  // Ondalıklı royalty de bozulmamalı.
  const fractional = { royalty: 12.5, hologramCost: 0.057 };
  const out = rules.calculateFinalFobWithRule(2, fractional);
  assert.equal(rules.calculateSuppFobWithRule(out, fractional), 2);
});

test('v5.93 royalty %100 iken hesap yapılmaz', () => {
  // Bölme geçersiz; sonsuz bir fiyat üretmek yerine null dönmeli.
  assert.equal(rules.calculateFinalFobWithRule(1, { royalty: 100, hologramCost: 0 }), null);
  assert.equal(rules.calculateFinalFobWithRule(1, { royalty: 101, hologramCost: 0 }), null);
  assert.equal(rules.calculateFinalFobWithRule(1, { royalty: -1, hologramCost: 0 }), null);
  // İleri yön %100'de tanımlıdır (sonuç 0 olur), bu davranış değişmemeli.
  assert.equal(rules.calculateSuppFobWithRule(1, { royalty: 100, hologramCost: 0 }), 0);
});

test('v5.93 geçersiz girdi null döner', () => {
  assert.equal(rules.calculateFinalFobWithRule('abc', { royalty: 20, hologramCost: 0 }), null);
  assert.equal(rules.calculateFinalFobWithRule(1, null), null);
  assert.equal(rules.calculateFinalFobWithRule(1, { royalty: 20 }), null);
});

test('v5.93 sıfır royalty ve sıfır hologram kimlik gibi davranır', () => {
  const rule = { royalty: 0, hologramCost: 0 };
  assert.equal(rules.calculateFinalFobWithRule(1.23, rule), 1.23);
  assert.equal(rules.calculateSuppFobWithRule(1.23, rule), 1.23);
});

test('v5.93 ekranda iki yönlü kontrol alanı var', () => {
  assert.match(APP, /id="_ruleCheckRule"/);
  assert.match(APP, /id="_ruleCheckSupp"/);
  assert.match(APP, /id="_ruleCheckFinal"/);
  assert.match(CSS, /\.pricingRuleCheck\{/);
});

test('v5.93 hangi alana yazıldığı takip ediliyor', () => {
  const block = APP.slice(APP.indexOf("let checkSource='supp';"), APP.indexOf("modal.querySelector('#_ruleCheckClear')"));
  // İki alan birbirini tetiklerse sonsuz döngü ve yuvarlama birikmesi olurdu;
  // bu yüzden kaynak alan takip edilip yalnız hedef yazılıyor.
  assert.match(block, /checkSupp\?\.addEventListener\('input',\(\)=>\{checkSource='supp';runRuleCheck\(\);\}\)/);
  assert.match(block, /checkFinal\?\.addEventListener\('input',\(\)=>\{checkSource='final';runRuleCheck\(\);\}\)/);
  // Yön doğru fonksiyona bağlanmalı.
  assert.match(block, /checkSource==='final'\s*\?BLBusinessRules\.calculateSuppFobWithRule\(value,rule\)\s*:BLBusinessRules\.calculateFinalFobWithRule\(value,rule\)/);
  // Hesaplanamayan durum sessiz kalmamalı.
  assert.match(block, /Royalty %100 veya değerler geçersiz/);
  // Kural seçimi değişince sonuç tazelenmeli.
  assert.match(block, /checkRuleSel\?\.addEventListener\('change',runRuleCheck\)/);
});

test('v5.93 kural listesi tablo değiştikçe tazeleniyor', () => {
  const block = APP.slice(APP.indexOf('function renderRules(){'), APP.indexOf('function renderRules(){') + 120);
  assert.match(block, /renderRuleCheckOptions\(\);/);
  // Seçili kural liste yeniden çizilince kaybolmamalı.
  assert.match(APP, /if\(previous&&candidates\.some\(rule=>rule\.id===previous\)\)checkRuleSel\.value=previous;/);
});

test('v5.93 virgüllü ondalık girişi kabul ediliyor', () => {
  // Kaynaktaki ok fonksiyonunu olduğu gibi değerlendiriyoruz.
  const src = APP.slice(APP.indexOf('const checkParse=value=>'), APP.indexOf('const checkFormat=value=>')).trim().replace(/;$/, '');
  const parse = new Function(`${src}; return checkParse;`)();
  assert.equal(parse('1,26'), 1.26);
  assert.equal(parse('1.26'), 1.26);
  assert.equal(parse(' 2 '), 2);
  assert.equal(parse(''), null);
  assert.equal(parse('abc'), null);
});
