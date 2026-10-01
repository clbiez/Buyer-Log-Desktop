'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const parenStart = source.indexOf('(', start);
  let pdepth = 0, parenEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') pdepth += 1;
    else if (source[i] === ')') {
      pdepth -= 1;
      if (pdepth === 0) { parenEnd = i; break; }
    }
  }
  assert.ok(parenEnd >= 0, `${name} parametre listesi kapanmıyor`);
  const open = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

test('CP ve Orders görünümünde Partial View, All seçeneğinin sağında bağımsız toggle olarak bulunur', () => {
  for (const tableKey of ['cp', 'orders']) {
    assert.match(
      HTML,
      new RegExp(
        `data-table-view-preset="all" data-table-key="${tableKey}"[\\s\\S]*?data-partial-view-toggle="${tableKey}" aria-pressed="false"[\\s\\S]*?<span>Partial View<\\/span>`
      )
    );
  }
  assert.match(APP, /const partialViewState=\{cp:false,orders:false\};/);
  assert.match(APP, /function setPartialView\(tableKey,enabled\)/);
  assert.match(APP, /data-partial-view-toggle/);
  assert.match(APP, /setPartialView\(tableKey,!partialViewEnabled\(tableKey\)\)/);
  assert.match(CSS, /\.tablePartialViewToggle\{/);
});

test('Partial View sütun presetinden bağımsızdır; preset uygulama yolu değiştirilmez', () => {
  const toggle = extractFunction(APP, 'setPartialView');
  assert.doesNotMatch(toggle, /colmgr|kolHiddenCols|applyTableViewPreset|TABLE_VIEW_PRESETS/);
  assert.match(toggle, /partialViewState\[tableKey\]=!!enabled/);
  assert.match(APP, /root\.querySelectorAll\('\[data-table-view-preset\]'\)[\s\S]*?data-partial-view-toggle/);
});

test('Partial View tüm lojistik segmentlerini status bazında tek satıra toplar', () => {
  const block = [
    "function norm(v){return String(v==null?'':v).trim();}",
    "function turknorm(v){return norm(v).toLocaleUpperCase('tr-TR');}",
    "function toNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}",
    "function cpLogisticSegments(row){return Array.isArray(row&&row._logisticSegments)?row._logisticSegments:[];}",
    extractFunction(APP, 'partialViewStatusGroups'),
  ].join('\n');
  const { partialViewStatusGroups } = new Function(`${block}; return {partialViewStatusGroups};`)();

  const groups = partialViewStatusGroups({
    STATUS: 'Üretimde',
    'Order Quantity': 10000,
    _logisticSegments: [
      {kind:'production', status:'Üretimde', quantity:3000, priority:1},
      {kind:'partial', status:'In Transit', quantity:2000, priority:2},
      {kind:'partial', status:'In Transit', quantity:1500, priority:2},
      {kind:'partial', status:'Awaiting Retail', quantity:3500, priority:3},
    ],
  });

  assert.deepEqual(groups.map(group => [group.status, group.quantity]), [
    ['Üretimde', 3000],
    ['In Transit', 3500],
    ['Awaiting Retail', 3500],
  ]);
  assert.equal(groups.reduce((sum, group) => sum + group.quantity, 0), 10000);
});

test('CP ve Orders filtreleri Partial View açıkken çoğaltılmış satırlar üzerinde çalışır', () => {
  const cp = extractFunction(APP, 'filteredCP');
  const orders = extractFunction(APP, 'filteredOrders');
  assert.match(cp, /const source=(?:ensurePlmSampleAccessors\()?partialViewRows\('cp',(?:ensurePlmSampleAccessors\()?state\.cp\.rows\)/);
  assert.match(cp, /source\.filter\(r=>cpRowPasses/);
  assert.match(orders, /const source=(?:ensurePlmSampleAccessors\()?partialViewRows\('orders',(?:ensurePlmSampleAccessors\()?state\.orders\.rows\)/);
  assert.match(orders, /source\.filter\(row=>ordersRowPasses/);
  assert.match(APP, /key==='STATUS'&&r&&r\._partialViewActive\) vals\.add\(norm\(r\.STATUS\)\)/);
});

test('Partial View status hücresi tek etiket gösterir ve açılır çoklu lojistik özetini kullanmaz', () => {
  assert.match(APP, /case 'status': return r&&r\._partialViewActive \? partialViewStatusCellHtml\(r\)/);
  const cell = extractFunction(APP, 'partialViewStatusCellHtml');
  assert.match(cell, /_partialViewStatusQuantity/);
  assert.match(cell, /cpLogisticSummaryItem/);
  assert.doesNotMatch(cell, /cpLogisticToggle/);
  const detail = extractFunction(APP, 'cpLogisticDetailRowHtml');
  assert.match(detail, /if\(row&&row\._partialViewActive\)return '';/);
});

test('Status footer alt toplamı split status adedini kullanır; diğer sayısal toplamlar sipariş bazında tekilleştirilir', () => {
  const footer = extractFunction(APP, 'renderQuantityTotalsFooter');
  assert.match(footer, /const statusRows=Array\.isArray\(options\.statusRows\)\?options\.statusRows:rows;/);
  assert.match(footer, /if\(Array\.isArray\(options\.totalRows\)\)rows=options\.totalRows;/);
  assert.match(footer, /statusSubtotal&&c\.k===statusSubtotal\.key/);
  assert.match(footer, /partialStatusSubtotalLabel/);
  assert.match(footer, /appLang==='en'\?'Subtotal':'Alt toplam'/);
  assert.match(APP, /const footerRows=partialViewEnabled\(tableKey\)\?partialViewUniqueSourceRows\(rows\):rows;/);
  assert.match(APP, /statusSubtotal:partialViewEnabled\(tableKey\)\?\{key:'STATUS',getQty:row=>row&&row\._partialViewStatusQuantity\}:null/);
  assert.match(CSS, /\.partialStatusSubtotalLabel\{/);
});

test('Partial View üst özetleri satırları çoğaltsa da Order Qty ve model/opsiyon metriklerini iki kez saymaz', () => {
  assert.match(APP, /const metricRows=partialViewEnabled\('cp'\)\?partialViewUniqueSourceRows\(rows\):rows;/);
  assert.match(APP, /const qtySumCP = metricRows\.reduce/);
  assert.match(APP, /const cpStats=pageModelOptionStats\(metricRows\)/);
  assert.match(APP, /const metricRows=partialViewEnabled\('orders'\)\?partialViewUniqueSourceRows\(rows\):rows;/);
  assert.match(APP, /const qty=metricRows\.reduce/);
  assert.match(APP, /const ordersStats=pageModelOptionStats\(metricRows\)/);
});

test('app-main.js sözdizimi geçerlidir', () => {
  assert.doesNotThrow(() => new Function(APP));
});
