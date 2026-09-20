'use strict';

/* v10.86 — CP/ORDERS: FİLTRE FARKINDA AĞIRLIKLI/ARİTMETİK ORTALAMA (Packet 11).
 *
 * Koleksiyon'un özet satırındaki kolWeightedAverage/kolArithmeticAverage/
 * kolAverageFooter AYNEN yeniden kullanılır — DOM'dan yeniden hesaplama veya
 * ayrı bir filtreleme yolu KURULMAZ. Tek eklenen şey: adedin CP/Orders'ta
 * farklı bir alanda olması ('Order Quantity', Koleksiyon'daki row.quantity
 * değil) — bu yüzden kolWeightedAverage'a isteğe bağlı bir getQty eklendi.
 * Ekrana giren `rows` zaten filteredCP()/filteredOrders() çıktısı olduğu
 * için "filtrelenmiş satırlar dahil, filtre dışı satırlar hariç" garantisi
 * ayrıca kodlanmaz — üst çağıran zaten filtrelenmiş listeyi veriyor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  // Parametre listesindeki varsayılan değerler ({} gibi) ilk '{'yi yanlış
  // yere düşürebilir; gövde önce parametre parantezinin KAPANIŞINDAN aranır.
  const parenStart = source.indexOf('(', start);
  let pdepth = 0, parenEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') pdepth += 1;
    else if (source[i] === ')') { pdepth -= 1; if (pdepth === 0) { parenEnd = i; break; } }
  }
  assert.ok(parenEnd >= 0, `${name} parametre listesi kapanmıyor`);
  const open = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

function loadAverages() {
  const block = [
    extractFunction(APP, 'kolParseMoneyNum'),
    'function tableNumericValue(v){ const n=Number(String(v==null?\'\':v).replace(/[^0-9.,-]/g,\'\').replace(\',\',\'.\')); return Number.isFinite(n)?n:0; }',
    extractFunction(APP, 'kolWeightedAverage'),
    extractFunction(APP, 'kolArithmeticAverage'),
  ].join('\n');
  return new Function(`${block}; return {kolWeightedAverage,kolArithmeticAverage};`)();
}

test('kolWeightedAverage: getQty verilmezse Koleksiyon davranışı (row.quantity) değişmez', () => {
  const { kolWeightedAverage } = loadAverages();
  const rows = [{ quantity: 10, price: 5 }, { quantity: 30, price: 15 }];
  // (5*10 + 15*30) / 40 = (50+450)/40 = 12.5
  assert.equal(kolWeightedAverage(rows, r => r.price), 12.5);
});

test('kolWeightedAverage: CP/Orders getQty ile "Order Quantity" alanını okuyabilir', () => {
  const { kolWeightedAverage } = loadAverages();
  const rows = [
    { 'Order Quantity': 1000, 'FOB ($)': 10 },
    { 'Order Quantity': 500, 'FOB ($)': 20 },
    { 'Order Quantity': 0, 'FOB ($)': 999 }, // sıfır adet: hariç
    { 'Order Quantity': 200, 'FOB ($)': '' }, // boş fiyat: hariç
  ];
  const getQty = row => row['Order Quantity'];
  const weighted = kolWeightedAverage(rows, r => r['FOB ($)'], getQty);
  // (10*1000 + 20*500) / 1500 = 20000/1500 = 13.333...
  assert.ok(Math.abs(weighted - 13.3333) < 0.001);
});

test('kolArithmeticAverage: adetten bağımsız, blank/0 fiyat hariç tutulur', () => {
  const { kolArithmeticAverage } = loadAverages();
  const rows = [{ p: 10 }, { p: 20 }, { p: 0 }, { p: '' }, { p: null }];
  assert.equal(kolArithmeticAverage(rows, r => r.p), 15);
});

/* ------------------------------------------------------- KAYNAK SÖZLEŞMESİ */

test('cpOrdersAverageFooterCols: yalnız cp/orders için FOB + Supp. FOB tanımlar, Order Quantity kullanır', () => {
  const fn = extractFunction(APP, 'cpOrdersAverageFooterCols');
  assert.match(fn, /if\(tableKey!=='cp'&&tableKey!=='orders'\)return null;/);
  assert.match(fn, /const getQty=row=>row&&row\['Order Quantity'\];/);
  assert.match(fn, /\['FOB \(\$\)',\{label:'FOB',getQty\}\]/);
  assert.match(fn, /\['Supp\. FOB',\{label:L\('Supp\. FOB'\),getQty\}\]/);
});

test('renderQuantityTotalsFooter: averageCols verilen sütunda kolAverageFooter üretir, toplamı EZMEZ', () => {
  const fn = extractFunction(APP, 'renderQuantityTotalsFooter');
  assert.match(fn, /options\.averageCols instanceof Map/);
  assert.match(fn, /kolWeightedAverage\(rows,price,averageSpec\.getQty\)/);
  assert.match(fn, /kolArithmeticAverage\(rows,price\)/);
  assert.match(fn, /cells\.push\(kolAverageFooter\(weighted,arithmetic,averageSpec\.label\)\);/);
  // averageCols yoksa (ship, backlog, vb.) eski davranış birebir korunur.
  assert.match(fn, /const averageSpec=averageCols&&averageCols\.get\(c\.k\);/);
});

test("CP/Orders satır çizimi averageCols'u tableKey üzerinden geçirir; DOM'dan yeniden hesaplama yok", () => {
  const fn = extractFunction(APP, 'renderFullTable');
  assert.match(fn, /renderQuantityTotalsFooter\(table,rows,cols,\{[^}]*averageCols:cpOrdersAverageFooterCols\(tableKey\)\}\)/);
});

test('ship tablosu (Nakliye Kıyaslama) averageCols göndermiyor — kapsam yalnız CP/Orders', () => {
  const start = APP.indexOf("renderQuantityTotalsFooter(table,shipRows,cols,{withCheck:true,selectedSet:shipSelected");
  assert.ok(start >= 0, 'shipTable çağrısı bulunmalı');
  const line = APP.slice(start, APP.indexOf('\n', start));
  assert.ok(!line.includes('averageCols'), 'Nakliye tablosu kendi kart görünümünü kullanıyor, footer ortalaması istenmedi');
});
