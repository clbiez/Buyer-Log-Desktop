'use strict';

// v5.99 — dört düzeltme:
//   1) Ex→Retail filtresi "cfForRow is not defined" ile çöküyordu,
//   2) yüzde sütunları ham ondalık (0,8 / 0,75) listeleniyor, % girilemiyordu,
//   3) Quotations'ta drop edilen üreticinin fiyatı Best Price'ta kalıyordu,
//   4) fiyat revizeleri Best Price ve üretici bilgisine yansımıyordu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const Q = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

function blockOf(source, from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${from} bulunmalı`);
  const end = source.indexOf(to, start);
  assert.ok(end > start, `${to} bulunmalı`);
  return source.slice(start, end);
}

test('v5.99 kaldırılmış yardımcıya yapılan çağrı kalmadı', () => {
  // cfForRow projeden kaldırılmıştı; index.html içindeki filtre yükseltmesi onu
  // hâlâ çağırdığı için Ex→Retail filtresine dokunmak sayfayı çökertiyordu.
  // Yorum satırlarındaki açıklama sayılmaz; koddaki çağrı aranıyor.
  const code = HTML.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  const calls = code.match(/cfForRow\s*\(/g) || [];
  assert.deepEqual(calls, [], 'cfForRow çağrısı kalmamalı');
  const fn = blockOf(HTML, 'function numericRawValue(col,row){', '}');
  assert.match(fn, /return row\[col\.k\];/);
  // Değer CP satırı kurulurken zaten yazılıyor.
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'), /'Ex→Retail':exRetail/);
});

test('v5.99 yüzde sütunları eski sayı paneline düşmüyor', () => {
  const block = blockOf(HTML, 'openHeaderFilter=function(tableKey,key,anchorEl,rerenderOuter){', 'const base=');
  // NUM_TYPES yüzdeyi de kapsıyordu; bu yüzden v5.95'te eklenen yüzde aralığı
  // paneli hiç açılmıyor, değerler 0,8 / 0,75 ham ondalık listeleniyordu.
  assert.match(block, /if\(!NUM_TYPES\.has\(col\.type\)\|\|col\.type==='pct'\)\{originalOpen\(/);
});

test('v5.99 eski filtre geçersiz kılması aralık filtresini tanıyor', () => {
  const block = blockOf(HTML, 'passesColFilters=function(tableKey,row){', 'const originalOpen=openHeaderFilter;');
  assert.match(block, /if\(entry\.range\)\{/);
  assert.match(block, /entry\.range\.min!=null&&n<entry\.range\.min/);
  assert.match(block, /entry\.range\.max!=null&&n>entry\.range\.max/);
  // Boş hücre aralığa girmemeli (Number('') === 0 tuzağı).
  assert.match(block, /if\(raw==null\|\|raw===''\)return false;/);
});

test('v5.99 drop edilen üreticinin fiyatı Koleksiyon’dan siliniyor', () => {
  const block = blockOf(Q, 'function qWritePriceToCollection(req,line){', 'function qRefreshCollection()');
  assert.match(block, /if\(line\.dropped\)\{/);
  assert.match(block, /delete row\.pricing\[line\.manufacturer\];/);
  // Silinmiş bir teklifin üreticisi "nihai üretici" olarak kalmamalı.
  assert.match(block, /if\(qNorm\(row\.confirmedManufacturer\)===line\.manufacturer\) row\.confirmedManufacturer='';/);
  // Drop kaldırılınca fiyat aynı yoldan geri yazılmalı.
  assert.match(block, /\}else\{/);
  assert.match(block, /row\.pricing\[line\.manufacturer\]=qValidPrice\(line\.price\)/);
});

test('v5.99 drop düğmesi Koleksiyon’a yansıyor ama yayılmıyor', () => {
  const block = blockOf(Q, 'function qToggleDrop(req,line)', 'function qBindColumnResize');
  assert.match(block, /qWritePriceToCollection\(req,line\);/);
  assert.match(block, /qRefreshCollection\(\);/);
  // Drop TEK üretici satırına özel kalmalı: ne diğer satırlara ne diğer
  // tekliflere yayılmalı, ne de modeli iptal etmeli.
  assert.ok(!block.includes('req.items.forEach'));
  assert.ok(!block.includes('qLoad().requests.forEach'));
  assert.ok(!block.includes('row.dropped='));
});

test('v5.99 fiyat revizesi ve silme Best Price’a yansıyor', () => {
  const update = blockOf(Q, 'async function qhUpdatePrice(requestId,itemId,rawPrice){', 'async function qhDropItem');
  assert.match(update, /qWritePriceToCollection\(found\.request,found\.item\);/);
  assert.match(update, /qRefreshCollection\(\);/);
  // Kaydetme ÖNCE olmalı: Koleksiyon'a yazılan değer kaydedilmiş fiyat olsun.
  assert.ok(update.indexOf('qSave(found.request)') < update.indexOf('qWritePriceToCollection'));

  const drop = blockOf(Q, 'async function qhDropItem(requestId,itemId){', 'function qhPivot');
  assert.match(drop, /found\.item\.dropped=true;/);
  assert.match(drop, /qWritePriceToCollection\(found\.request,found\.item\);/);
});
