'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../public/vendor/jszip.min.js');
const backlog = require('../public/backlog-excel-formulas.js');
const guards = require('../public/excel-workbook-guards.js');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// Tarayıcı tarafı Backlog Excel dışa aktarım kodu index.html'den app-main.js'e taşındı.
const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'server/workers/excel-worker.js'), 'utf8');

const REQUESTED_VISIBLE_HEADERS = [
  'Sezon','Sipariş Yerleştirme MerchTarih','Siparişin Üretildiği Ülke','Buyer','Buyer Grup (TR)',
  'Üretici','Alt Üretici','Line','Ürün Klasman','Sipariş Kod','Özel Kod 1','Model Adı','Renk Kod','Renk',
  'Orijinal Exfactory Merch Tarih','Retail Depo Tarih Yıl Ay Gün','Model Bütçe Tarih Yıl Ay Gün',
  'Net Alım Sipariş Miktarı','Adet','Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo',
  'Kalan Alım Sipariş Miktarı','Net Gelen Alım Sipariş Miktarı',
  'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo','GÜNCEL DURUM\n(STATUS)',
  'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)','ANTREPO GİRİŞ TARİHİ','YÜKLEME TİPİ',
  'ANTREPO-RETAIL','Üretici Tükleme Tipi Teyidi','RİSK\n(PRIORITY)','buying note',
];

test('Backlog default view keeps exactly the requested columns and groups other business columns', () => {
  assert.deepEqual([...backlog.DEFAULT_VISIBLE_HEADERS], REQUESTED_VISIBLE_HEADERS);
  assert.deepEqual([...backlog.EMPHASIS_HEADERS], ['Sipariş Kod', 'Model Adı']);
  assert.equal(backlog.DEFAULT_HEADER_FILL_RGB, 'FFF2F4F7');
  assert.equal(backlog.EMPHASIS_HEADER_FILL_RGB, 'FFFFF2CC');
  // v3.18: tüm Backlog başlıkları (vurgulu ikisi dahil) kalın — v3.02'nin "yalnız veri
  // kalın" kuralı bu daha yeni değişiklikle tekrar tersine döndü (version-history.js).
  assert.deepEqual(backlog.headerStyleSpec('Sipariş Kod'), { fillRgb: 'FFFFF2CC', fontRgb: 'FF665200', bold: true });
  assert.deepEqual(backlog.headerStyleSpec('Model Adı'), { fillRgb: 'FFFFF2CC', fontRgb: 'FF665200', bold: true });
  assert.deepEqual(backlog.headerStyleSpec('Üretici'), { fillRgb: 'FFF2F4F7', fontRgb: 'FF475467', bold: true });
  assert.deepEqual(backlog.columnSpec('Sipariş Kod'), { hidden: false });
  assert.deepEqual(backlog.columnSpec('Lisans'), { hidden: true, level: 1 });
  assert.deepEqual(backlog.columnSpec('_BL_DELAY', { helper: true }), { hidden: true, wch: 2 });

  assert.match(appMain, /BLBacklogExcel\.columnSpec\(h\)/);
  assert.match(appMain, /ws\['!outline'\]=\{left:false,above:false\}/);
  assert.match(worker, /BLBacklogExcel\.columnSpec\(header\)/);
  assert.match(worker, /ws\['!outline'\] = \{ left: false, above: false \}/);
  assert.match(appMain, /BLBacklogExcel\.headerStyleSpec\(h\)/);
});

test('Backlog template carries selective header emphasis, hidden outline columns and bold data styles', async () => {
  const raw = fs.readFileSync(path.join(ROOT, 'server/templates/BACKLOG.xlsx'));
  const zip = await JSZip.loadAsync(raw);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.match(sheet, /<outlinePr\b[^>]*summaryRight="1"/);
  assert.match(sheet, /showOutlineSymbols="1"/);
  assert.match(sheet, /<col\b[^>]*hidden="1"[^>]*outlineLevel="1"/);
  assert.match(styles, /rgb="FFFFF2CC"/);
  assert.match(styles, /rgb="FF665200"/);
  assert.match(sheet, /<c\b[^>]*r="J1"[^>]*s="16"/);
  assert.match(sheet, /<c\b[^>]*r="L1"[^>]*s="16"/);
});

test('protected Backlog allows outline column toggling without unlocking formula cells', () => {
  const xml = guards.sheetProtectionXml({ allowAutoFilter: true, allowSort: true, allowFormatColumns: true });
  assert.match(xml, /formatColumns="0"/);
  assert.match(xml, /formatCells="1"/);
  assert.match(xml, /sort="0"/);
  assert.match(xml, /autoFilter="0"/);
});

test('column outline cleanup removes SheetJS non-standard level attribute', () => {
  const source='<worksheet><cols><col min="2" max="2" hidden="true" level="1" outlineLevel="1"/></cols></worksheet>';
  const out=guards.normalizeWorksheetColumnAttributes(source);
  assert.doesNotMatch(out, /\slevel="1"/);
  assert.match(out, /outlineLevel="1"/);
});
