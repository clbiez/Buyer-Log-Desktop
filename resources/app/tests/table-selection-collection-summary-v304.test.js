'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Uygulama çekirdeği index.html'den public/app-main.js'e taşındı; sınanan
// özellik (tableVisibleSelectedCount) yaşıyor, test yanlış dosyaya bakıyordu.
const html = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');

function sourceFunction(name){
  const match = html.match(new RegExp(`function ${name}\\([^]*?\\n}`, 'm'));
  assert.ok(match, `${name} source should exist`);
  return match[0];
}

test('checkbox tables render and live-update a footer count under the selection column', () => {
  assert.match(html, /function tableVisibleSelectedCount\(rows,selectedSet,getId\)/);
  assert.match(html, /function selectionFooterCellHtml\(count\)/);
  assert.match(html, /class="selectionTotalCell"/);
  assert.match(html, /updateSelectionFooterCount\(meta\.table,meta\.rows,meta\.selSet,meta\.getId\)/);
  // Off-page checked records remain in the selection count after pagination.
  assert.match(html, /renderQuantityTotalsFooter\(table,fullRows,cols,\{withCheck:true,selectedSet:selSet/);
  assert.match(html, /tbody\._chkMeta = \{ selSet, table, tableKey, tableId, rows:fullRows/);
  assert.match(html, /renderQuantityTotalsFooter\(table,shipRows,cols,\{withCheck:true,selectedSet:shipSelected/);
  assert.match(html, /updateSelectionFooterCount\(table,logicalRows,kolSelected,row=>row\.id\)/);
  assert.match(css, /tfoot \.selectionFooterCount\{/);
});

// Özellik genişledi (ağırlıklı ortalamaya ek aritmetik ortalama + Best Price/Landed
// sütunları eklendi), niyet aynı kaldı: getter'lar artık isimli değişkenlere çıkarılmış
// (app-main.js:17546-17549) ve kolWeightedAverage bu değişkenlerle çağrılıyor (17553-17556).
test('Collection footer shows filtered model count and quantity-weighted Target, confirmed and FOB averages', () => {
  // v10.86 (Packet 11): CP/Orders'ın da aynı ortalamayı kullanabilmesi için
  // isteğe bağlı bir üçüncü parametre (getQty) eklendi; verilmezse davranış
  // birebir eskisiyle aynıdır (row.quantity).
  assert.match(html, /function kolWeightedAverage\(rows,getPrice,getQty\)/);
  assert.match(html, /const qtyOf=typeof getQty==='function'\?getQty:\(row=>row&&row\.quantity\);/);
  assert.match(html, /const qty=tableNumericValue\(qtyOf\(row\)\)/);
  assert.match(html, /weighted\+=price\*qty;totalQty\+=qty/);
  assert.match(html, /const targetGetter=row=>row\.targetPrice/);
  assert.match(html, /const confirmedGetter=row=>\{const confirmed=kolConfirmedPricing\(row\)/);
  assert.match(html, /const fobGetter=row=>row\.fob/);
  assert.match(html, /const targetAvg=kolWeightedAverage\(rows,targetGetter\)/);
  assert.match(html, /const confirmedAvg=kolWeightedAverage\(rows,confirmedGetter\)/);
  assert.match(html, /const fobAvg=kolWeightedAverage\(rows,fobGetter\)/);
  assert.match(html, /function pageModelOptionText\(rows\)/);
  assert.match(html, /const modelText=pageModelOptionText\(rows\)/);
  assert.match(html, /function renderKolSummaryFooter\(table,rows,descriptors,\{pictureVisible=false\}=\{\}\)/);
  assert.match(css, /tfoot \.collectionWeightedAverage\{/);
});


test('weighted average uses positive quantity as the denominator and ignores blank prices', () => {
  const body = sourceFunction('kolWeightedAverage');
  const factory = new Function('tableNumericValue','kolParseMoneyNum',`${body}; return kolWeightedAverage;`);
  const parse = value => {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const fn = factory(parse, parse);
  const rows = [
    {quantity:100,targetPrice:'2.00'},
    {quantity:300,targetPrice:'4.00'},
    {quantity:500,targetPrice:''},
    {quantity:0,targetPrice:'99.00'},
  ];
  assert.equal(fn(rows,row=>row.targetPrice),3.5);
});
