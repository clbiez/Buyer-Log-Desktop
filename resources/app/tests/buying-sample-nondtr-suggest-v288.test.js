'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Uygulama çekirdeği index.html'den public/app-main.js'e taşındı; sınanan
// özellik (buyingSampleManufacturer sütunu) yaşıyor, test yanlış dosyaya bakıyordu.
const html = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');

test('Collection defines one Buying Sample column with manufacturer input and approval tick', () => {
  // v7.0.229 — Buying Numunesi sütunu kullanıcı talebiyle Koleksiyon tablosundan
  // kaldırıldı (Checklist'e bağlanacak). Satırdaki değer silinmez; üretici
  // geri dönüşleri (manufacturerFor) aynı alanı okumaya devam eder.
  const kolCols = html.slice(html.indexOf('const KOL_COLS = ['), html.indexOf('function kolColDefs'));
  assert.doesNotMatch(kolCols, /k:'buyingSampleManufacturer'/);
  assert.match(html, /manufacturerFor\(row\)\{ return norm\(row&&row\.confirmedManufacturer\)\|\|norm\(row&&row\.buyingSampleManufacturer\)/);
  assert.match(html, /'Buying Sample':'Buying Numunesi'/);
  const renderStart = html.indexOf("}else if(c.buyingSample){");
  const renderEnd = html.indexOf("}else if(c.suggest){", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const block = html.slice(renderStart, renderEnd);
  assert.match(block, /class="kolBuyingSampleApprove"/);
  assert.match(block, /class="editCell kolSuggestCell kolBuyingSampleInput"/);
  assert.match(block, /data-kind="submfr"/);
  assert.match(css, /#kolTable \.kolBuyingSampleCell/);
  assert.match(css, /#kolTable \.kolBuyingSampleApprove\[aria-pressed="true"\]/);
});

test('Buying Sample approval is row-scoped and manufacturer changes clear stale approval', () => {
  assert.match(html, /if\(r\.buyingSampleApproved===undefined \|\| r\.buyingSampleApproved===null\) r\.buyingSampleApproved=false/);
  const commitStart = html.indexOf("if(k==='buyingSampleManufacturer'){");
  const commitEnd = html.indexOf("if(['season','country','licensor','lisans'].includes(k))", commitStart);
  const commit = html.slice(commitStart, commitEnd);
  assert.match(commit, /row\.buyingSampleApproved=false/);
  assert.match(commit, /refreshSubmfrList\(\)/);
  const handlerStart = html.indexOf("tbody.querySelectorAll('.kolBuyingSampleApprove')");
  const handlerEnd = html.indexOf("tbody.querySelectorAll('.editCell:not(.kolPriceCell)", handlerStart);
  const handler = html.slice(handlerStart, handlerEnd);
  assert.match(handler, /row\.buyingSampleManufacturer=manufacturer/);
  assert.match(handler, /row\.buyingSampleApproved=!row\.buyingSampleApproved/);
  assert.doesNotMatch(handler, /kolRows\.forEach|state\.cp\.rows\.forEach|quotation/i);
});

test('Buying Sample approval requires a manufacturer and stays inside the active editor cell', () => {
  assert.match(html, /Enter a manufacturer before approving the Buying Sample/);
  assert.match(html, /Buying Numunesini onaylamadan önce üretici girin/);
  assert.match(html, /target\.closest\('\.kolBuyingSampleApprove'\).*visible\.closest.*target\.closest\('td'\)/s);
});

test('Non-DTR manufacturer input uses the shared CP Sub-Mfr suggestion popup', () => {
  const start = html.indexOf('function openNonDtrManufacturersModal(){');
  /* v7.81: eski menü dinleyicisi silindi; sınır fonksiyonun kendi sonundan
     alınır. indexOf(-1) boş bir dilime bakıp testi SESSİZCE geçirirdi. */
  const end = html.indexOf('\nfunction ', start + 10);
  assert.ok(start >= 0 && end > start);
  const block = html.slice(start, end);
  assert.match(block, /id="_nonDtrMfrInput" class="kolSuggestCell" data-kind="submfr"/);
  assert.doesNotMatch(block, /_nonDtrMfrOptions|<datalist/);
  assert.match(block, /input\.addEventListener\('input',openManufacturerSuggestions\)/);
  assert.match(block, /input\.addEventListener\('focus',openManufacturerSuggestions\)/);
  assert.match(block, /showSubmfrDrop\(input\)/);
  assert.match(block, /closeSubmfrDrop\(\)/);
});

test('shared manufacturer suggestions include CP, Non-DTR, quotation and Buying Sample values', () => {
  const start = html.indexOf('function refreshSubmfrList(){');
  const end = html.indexOf('// Sistemdeki tüm lisanslar', start);
  const block = html.slice(start, end);
  assert.match(block, /r\['Sub-Manufacturer'\]/);
  assert.match(block, /state\.overrides\.nonDtrManufacturers/);
  assert.match(block, /kolManufacturers\.forEach/);
  assert.match(block, /r\.buyingSampleManufacturer/);
});
