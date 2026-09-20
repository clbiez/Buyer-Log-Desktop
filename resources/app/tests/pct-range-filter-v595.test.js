'use strict';

// v5.95 — Yüzde sütunlarında aralık filtresi.
//
// Değer listesi yüzdelerde işe yaramıyordu: her satırın kendi ondalık değeri
// (0,1234…) ayrı bir seçenek olduğu için liste yüzlerce satır uzunluğunda
// çıkıyor ve kullanıcı "şu iki oran arasındakiler" diyemiyordu.
//
// İstenen biçim: ÜST % > mevcut % > ALT %. Değerler ekranda YÜZDE girilir;
// satırlarda ondalık kesir saklandığı için karşılaştırmadan önce 100'e bölünür.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function bodyOf(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = APP.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

// preparedColFilterPasses'ı gerçek bağımlılıklarıyla çalıştırır.
const passes = new Function('toNum', 'priorityHas', 'matchesQuickExFactory', 'cpLogisticHasDetails', 'cpLogisticSegments', 'norm', 'comparableColumnFilterValue',
  `return function preparedColFilterPasses(prepared,key,row){${bodyOf('preparedColFilterPasses')}};`
)(
  v => { const n = Number(v); return Number.isNaN(n) ? null : n; },
  () => false, () => false, () => false, () => [], v => String(v == null ? '' : v), v => v
);

test('v5.95 aralık her iki ucu da kapsıyor', () => {
  const filter = { kind: 'range', min: 0.05, max: 0.20 };
  // Sınırlar dahil: kullanıcı "%5 ile %20 arası" derken uçları dışlamaz.
  assert.equal(passes(filter, 'x', { x: 0.05 }), true);
  assert.equal(passes(filter, 'x', { x: 0.20 }), true);
  assert.equal(passes(filter, 'x', { x: 0.12 }), true);
  assert.equal(passes(filter, 'x', { x: 0.04 }), false);
  assert.equal(passes(filter, 'x', { x: 0.21 }), false);
});

test('v5.95 tek uç açık bırakılabiliyor', () => {
  assert.equal(passes({ kind: 'range', min: 0.10, max: null }, 'x', { x: 0.99 }), true);
  assert.equal(passes({ kind: 'range', min: 0.10, max: null }, 'x', { x: 0.09 }), false);
  assert.equal(passes({ kind: 'range', min: null, max: 0.10 }, 'x', { x: -0.5 }), true);
  assert.equal(passes({ kind: 'range', min: null, max: 0.10 }, 'x', { x: 0.11 }), false);
});

test('v5.95 negatif oranlar da karşılaştırılıyor', () => {
  // Fark/avantaj sütunları eksi değer alabiliyor; aralık bunları atlamamalı.
  const filter = { kind: 'range', min: -0.10, max: -0.02 };
  assert.equal(passes(filter, 'x', { x: -0.05 }), true);
  assert.equal(passes(filter, 'x', { x: 0.05 }), false);
});

test('v5.95 boş hücre aralığa girmiyor', () => {
  // Boş bir hücre ne "%0'ın üstünde" ne de altındadır; aralık aktifken elenir,
  // aksi halde "%0 ile %10 arası" boş satırları da getirirdi.
  const filter = { kind: 'range', min: 0, max: 0.10 };
  assert.equal(passes(filter, 'x', { x: null }), false);
  assert.equal(passes(filter, 'x', { x: '' }), false);
  assert.equal(passes(filter, 'x', {}), false);
});

test('v5.95 aralık filtresi değer kümesinden ÖNCE tanınıyor', () => {
  const block = bodyOf('prepareColFilter');
  const rangeIndex = block.indexOf("if(entry.range)");
  const valuesIndex = block.indexOf("if(!entry.values)");
  assert.ok(rangeIndex >= 0 && rangeIndex < valuesIndex,
    'range kontrolü values kontrolünden önce olmalı, yoksa aralık filtresi satırları elerdi');
});

test('v5.95 panel istenen okuma yönünü kuruyor: ÜST % > değer > ALT %', () => {
  const block = APP.slice(APP.indexOf('function pctRangeHtml()'), APP.indexOf('function wirePctRange()'));
  // Üst sınır solda, alt sınır sağda olmalı.
  assert.ok(block.indexOf('cfpRangeMax') < block.indexOf('cfpRangeMin'), 'üst sınır önce gelmeli');
  assert.match(block, /&gt;/);
  assert.match(block, /Yüzde aralığı/);
  // Mevcut filtre yüzde olarak geri yazılmalı (0,12 → 12).
  assert.match(block, /const asPct = value => value==null \? '' : String\(Number\(\(value\*100\)\.toFixed\(4\)\)\)/);
  assert.match(CSS, /\.cfpRange\{/);
});

test('v5.95 girilen yüzde ondalığa çevriliyor', () => {
  const src = APP.slice(APP.indexOf('const readPct=input=>{'), APP.indexOf("panel.querySelector('.cfpRangeApply')"));
  const readPct = new Function(`${src} return readPct;`)();
  assert.equal(readPct({ value: '12' }), 0.12);
  // Yüzde işareti ve virgüllü ondalık kabul edilmeli.
  assert.equal(readPct({ value: '12%' }), 0.12);
  assert.equal(readPct({ value: '12,5' }), 0.125);
  assert.equal(readPct({ value: '-3' }), -0.03);
  // Boş kutu "sınır yok" demektir, sıfır değil.
  assert.equal(readPct({ value: '' }), null);
  assert.equal(readPct({ value: '  ' }), null);
  assert.equal(readPct({ value: 'abc' }), null);
});

test('v5.95 ters girilen sınırlar reddedilmeyip düzeltiliyor', () => {
  const block = APP.slice(APP.indexOf("panel.querySelector('.cfpRangeApply')"), APP.indexOf("panel.querySelector('.cfpRangeClear')"));
  // Boş sonuç göstermek yerine niyeti uyguluyoruz.
  assert.match(block, /if\(min!=null&&max!=null&&min>max\)\{ const swap=min; min=max; max=swap; \}/);
  // İki kutu da boşsa filtre kaldırılmalı.
  assert.match(block, /if\(min==null&&max==null\)\{ delete state\.colFilters\[tableKey\]\[key\]; \}/);
});

test('v5.95 yalnız yüzde sütunlarında aralık paneli açılıyor', () => {
  const block = bodyOf('renderNonDate');
  assert.match(block, /if\(isPct\)\{/);
  // Diğer sütunlar eski değer listesini kullanmaya devam etmeli.
  // v6.34: araya revizyon bölümü girdi (revisionSectionHtml). İddia checklistHtml'in
  // yüzde DIŞI yolda hâlâ çizildiğini doğruluyor; aradaki ek bölümlere bakmıyor.
  assert.match(block, /panel\.innerHTML = \(tableKey==='cp'\?'':sortBarHtml\(\)\)[^;]*\+ checklistHtml\(null\);/);
  assert.match(APP, /const isPct = col\.type==='pct';/);
});
