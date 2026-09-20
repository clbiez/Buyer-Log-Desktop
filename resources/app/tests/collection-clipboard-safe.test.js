'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const exporter = require('../public/table-export.js');
const APP_MAIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const COLLECTION_SPREADSHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.js'), 'utf8');

const columns = [
  { k: 'model', label: 'Model' },
  { k: 'fabric', label: 'Kumaş' },
  { k: 'quantity', label: 'Adet' },
  { k: 'note', label: 'Not' },
];

test('Collection clipboard matrix null/undefined/NaN/object placeholder üretmez', () => {
  const matrix = exporter.buildMatrix({
    records: [{ model: null, fabric: undefined, quantity: Number.NaN, note: {} }],
    columns,
  });
  assert.deepEqual(matrix.rows[0], ['', '', '', '']);
  assert.doesNotMatch(exporter.toTSV(matrix), /undefined|NaN|\[object Object\]/);
});

test('Collection safe HTML özel karakterleri escape eder ve multiline hücreyi br ile taşır', () => {
  const matrix = exporter.buildMatrix({
    records: [{
      model: 'A&B <TEST>',
      fabric: 'Single\nJersey',
      quantity: '5.000',
      note: '"test"',
    }],
    columns,
  });
  const html = exporter.toSafeHTML(matrix);
  assert.match(html, /<table[^>]*><thead><tr>/);
  assert.match(html, /A&amp;B &lt;TEST&gt;/);
  assert.match(html, /Single<br>Jersey/);
  assert.doesNotMatch(html, /<script|<style|<svg|<button|<input|<select|<textarea|<iframe|<canvas|blob:|data:image|javascript:|data-[a-z-]+=|class=|id=/i);
});

test('Collection safe HTML düz ve Word-safe table yapısını kullanır', () => {
  const matrix = exporter.buildMatrix({
    records: [{ model: 'Ç Ğ İ Ö Ş Ü ₺ €', fabric: 'Twill', quantity: 0, note: '' }],
    columns,
  });
  const html = exporter.toSafeHTML(matrix);
  const tsv = exporter.toTSV(matrix);
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.equal((html.match(/<td /g) || []).length, columns.length);
  assert.match(tsv, /Ç Ğ İ Ö Ş Ü ₺ €/);
  assert.doesNotMatch(html, /position:|sticky|overflow:|transform:|calc\(|var\(--/i);
});

test('Collection row copy kayıt matrisinden üretilir ve modeli görseliyle birlikte taşır', () => {
  /* v10.85 (Packet 10): CP zaten görseli gerçek <img> olarak gömüyordu;
     Koleksiyon'un kayıt-kaynaklı kopyası bilerek boş bırakıyordu (bkz. git
     geçmişi). Artık ikisi de aynı dönüştürücüyü (_copyImageDataUrlFor)
     kullanıyor — yalnız Koleksiyon'unki DOM'dan değil KAYITTAN (row.plmId/
     row.colourCode/row.img/row.imgRef) çözülüyor; DOM'a hâlâ dokunulmuyor. */
  const start = APP_MAIN.indexOf('async function buildCollectionStyledCopy');
  const end = APP_MAIN.indexOf('async function buildStyledCopyFromDom');
  assert.ok(start >= 0 && end > start);
  const block = APP_MAIN.slice(start, end);
  assert.match(block, /BLTableExport\.toHTML\(matrix,\{/);
  assert.match(block, /pictureCells=await Promise\.all\(records\.map\(kolRecordImageCopyCell\)\);/);
  // Hâlâ DOM taranmıyor: görsel hücresi kayıttan (kolRecordImageCopyCell),
  // ekrandaki <img> öğesinden değil çözülüyor.
  assert.doesNotMatch(block, /_copyCellFromTd|querySelector/);
  assert.match(APP_MAIN, /copyRichToClipboard\(html,plain\)/);
});

test('kolRecordImageCopyCell CP ile aynı dönüştürücüyü kullanır, DOM taramaz', () => {
  const start = APP_MAIN.indexOf('async function kolRecordImageCopyCell');
  const end = APP_MAIN.indexOf('async function buildCollectionStyledCopy');
  assert.ok(start >= 0 && end > start);
  const block = APP_MAIN.slice(start, end);
  assert.doesNotMatch(block, /document\.|querySelector/);
  assert.match(block, /_copyImageDataUrlFor\(/);
});

test('ortak clipboard yazıcısı modern yolda HTML ve TSV MIME tiplerini birlikte taşır', () => {
  const start = APP_MAIN.indexOf('async function copyRichToClipboard');
  const end = APP_MAIN.indexOf('function exportMatrix', start);
  const block = APP_MAIN.slice(start, end);
  assert.match(block, /'text\/plain': new Blob\(\[plain\]/);
  assert.match(block, /'text\/html': new Blob\(\[html\]/);
  assert.match(block, /navigator\.clipboard\.write\(\[item\]\)/);
  assert.match(block, /div\.innerHTML = html/);
});

test('Collection hücre içindeki link/action tıklamasını yapıştırma hedefi olarak da seçer', () => {
  const start = COLLECTION_SPREADSHEET.indexOf('function bind(){');
  const end = COLLECTION_SPREADSHEET.indexOf('function init(){', start);
  assert.ok(start >= 0 && end > start);
  const block = COLLECTION_SPREADSHEET.slice(start, end);
  assert.match(block, /const td=e\.target\.closest\('tbody td\[data-key\]'\)/);
  assert.match(block, /if\(e\.target\.closest\('button:not\(\.kolSpreadsheetRowNumber\),a'\)\)\{state\.pendingPointerEdit=null;setActive\(td,\{extend:e\.shiftKey,focusGrid:false\}\);return;\}/);
});

test('Collection aralığı textarea odağında da Ctrl+C ile kopyalanır', () => {
  const start = COLLECTION_SPREADSHEET.indexOf('function handleCopyShortcut');
  const end = COLLECTION_SPREADSHEET.indexOf('function selectedCoordinates', start);
  assert.ok(start >= 0 && end > start);
  const block = COLLECTION_SPREADSHEET.slice(start, end);
  assert.match(block, /selectedCellCount=state\.multiCells\.size/);
  assert.match(block, /editorNativeSelection\(gridEditor\)&&selectedCellCount<2/);
});
