'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function fn(name){
  const start=APP.indexOf(`function ${name}(`);
  assert.ok(start>=0, `${name} bulunamadı`);
  const next=APP.indexOf('\nfunction ', start+10);
  return APP.slice(start, next<0?APP.length:next);
}

test('v9.58 Shipping global Copy alt grid yerine üst comparison clipboard yoluna gider', () => {
  const start=APP.indexOf("getElementById('navCopy').addEventListener");
  assert.ok(start>=0, 'navCopy handler bulunamadı');
  const block=APP.slice(start, start+2400);
  assert.match(block, /if\(info\.tableKey==='ship'\)\{ void copyShipComparisonFlat\(event\.currentTarget\); return; \}/);
  const special=block.indexOf("info.tableKey==='ship'");
  const grid=block.indexOf('copyStyledTableLikeExcel');
  assert.ok(special>=0 && grid>special, 'Shipping özel yolu alt grid kopyasından önce çalışmalı');
});

test('v9.58 comparison clipboard her model için tek flat satır üretir ve görsel taşımaz', () => {
  const rows=fn('shipComparisonClipboardRows');
  assert.match(rows, /shipCopyRows\(\)\.map\(source=>\{/);
  assert.match(rows, /const state=shipDecisionState\(row\)/);
  assert.match(rows, /cheapest, earliest/);
  assert.doesNotMatch(rows, /shipRowImageRef|CP_IMAGE_API|<br>|<img/);

  const matrix=fn('shipComparisonClipboardMatrix');
  assert.match(matrix, /\.\.\.rows\.map\(row=>columns\.map/);
  const plain=fn('shipComparisonFlatPlain');
  assert.match(plain, /row\.join\('\\t'\)/);
  assert.match(plain, /\.join\('\\n'\)/);
});

test('v9.58 clipboard üst comparison kimlik, tarih ve hesaplanmış landed alanlarını ayrı kolonlara ayırır', () => {
  const cols=fn('shipComparisonClipboardColumns');
  for(const label of [
    'Order Code','Style Name','Colour Code','Supplier','Quantity','OPD','Ex-Factory','Retail Date',
    'Overseas FOB','Domestic FOB','Domestic Landed','SEA Landed','SEA Saving %','SEA ETA',
    'SEA+AIR Landed','SEA+AIR Saving %','AIR Landed','AIR Saving %','Cheapest','Earliest'
  ]) assert.ok(cols.includes(label), `${label} clipboard kolonu eksik`);
  assert.doesNotMatch(cols, /label:'Image'|label:'Görsel'/);
});

test('v9.58 Copy mevcut Shipping state ve seçim kümesini kullanır', () => {
  assert.match(fn('shipCopyRows'), /shipSelected\.has\(row\._shipId\)/);
  const flat=fn('copyShipComparisonFlat');
  assert.match(flat, /shipCopyRows\(\)\.length/);
  assert.match(flat, /copyRichToClipboard\(shipComparisonFlatHtml\(\),shipComparisonFlatPlain\(\)\)/);
});
