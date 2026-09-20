'use strict';

/*
 * KOLEKSİYON DIŞA AKTARIMI — 1 MODEL = 1 SATIR
 *
 * Bildirilen kusur: Collection'dan kopyalanan bir model Excel'de ÜÇ satıra
 * yayılıyor, komşu sütunlar 5:7 / 8:10 / 11:13 gibi dikey birleşmiş geliyordu.
 *
 * Kök neden üç satırlı bir tablo üretilmesi DEĞİLDİ; üretilen tablo hep tek
 * satırlıydı. Sebep tek bir HÜCRENİN içindeki satır sonuydu:
 *
 *   · Koleksiyon'un serbest metin sütunları <textarea>'dır (renderKol'daki son
 *     else dalı) ve içine çok satırlı bir not yapıştırılabilir.
 *   · Kopyalama bu değeri DOM'dan (textarea.value) ham hâliyle okuyordu.
 *   · TSV'de ham satır sonu = yeni Excel satırı.
 *   · HTML'de Excel, mso-data-placement:same-cell yoksa hücre içi satır sonunu
 *     satıra böler ve diğer sütunları o satırlar boyunca DİKEY BİRLEŞTİRİR.
 *
 * Bu testler kuralı mekanik olarak kilitler: kayıt sayısı ile dışa aktarım
 * satır sayısı her koşulda birebir eşit, hiçbir yerde rowspan yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const exporter = require('../public/table-export.js');
const APP_MAIN = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const COLUMNS = [
  { k: 'modelKod', label: 'Model' },
  { k: 'not', label: 'Not' },
  { k: 'mfr', label: 'Üretici' },
];

function records(count, { multiline = false } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    modelKod: `CU4E-${i}`,
    not: multiline ? 'birinci satır\nikinci satır\nüçüncü satır' : `not ${i}`,
    mfr: 'GÖKBERK ÇELEBİ',
  }));
}

const matrixOf = list => exporter.buildMatrix({ records: list, columns: COLUMNS });

/* ------------------------------------------------- 1 KAYIT = 1 SATIR */

test('kayıt sayısı ile dışa aktarım satır sayısı birebir aynı', () => {
  for (const count of [1, 3, 10, 50, 100]) {
    const matrix = matrixOf(records(count));
    assert.equal(matrix.rows.length, count, `${count} kayıt`);
    assert.equal(matrix.recordCount, count);
  }
});

test('çok satırlı hücre içeren kayıtlar da tek satır kalır', () => {
  /* Bildirilen hatanın ta kendisi: üç satırlık bir not, üç Excel satırı
     üretiyordu. */
  for (const count of [1, 3, 50]) {
    const matrix = matrixOf(records(count, { multiline: true }));
    assert.equal(matrix.rows.length, count, `${count} çok satırlı kayıt`);
  }
});

test('hücre içindeki satır sonu boşluğa normalize edilir', () => {
  const matrix = matrixOf(records(1, { multiline: true }));
  assert.equal(matrix.rows[0][1], 'birinci satır ikinci satır üçüncü satır');
  assert.doesNotMatch(matrix.rows[0][1], /[\r\n]/);
});

test('CR, CRLF, dikey sekme ve satır ayırıcıları da normalize edilir', () => {
  for (const raw of ['a\r\nb', 'a\rb', 'a\u2028b', 'a\u2029b', 'a\u000Bb', 'a\u000Cb']) {
    assert.equal(exporter.normalizeCell(raw), 'a b', JSON.stringify(raw));
  }
});

test('hücre içindeki SEKME yeni sütun üretmez', () => {
  // TSV'de ham sekme sütun ayırıcıdır; hücreyi ikiye bölerdi.
  assert.equal(exporter.normalizeCell('a\tb'), 'a b');
});

/* --------------------------------------------------------------- TSV */

test('TSV: sütunlar TAB, satırlar CRLF, model başına tek satır', () => {
  const tsv = exporter.toTSV(matrixOf(records(3, { multiline: true })));
  const lines = tsv.split('\r\n');
  assert.equal(lines.length, 4, 'başlık + 3 model');
  assert.equal(lines[0], 'Model\tNot\tÜretici');
  for (const line of lines.slice(1)) {
    assert.equal(line.split('\t').length, 3, 'her satırda tam 3 sütun');
  }
});

test('TSV başlıksız da üretilebilir ve satır sayısı korunur', () => {
  const tsv = exporter.toTSV(matrixOf(records(10)), { includeHeaders: false });
  assert.equal(tsv.split('\r\n').length, 10);
});

test('Türkçe karakterler bozulmaz', () => {
  const matrix = exporter.buildMatrix({
    records: [{ a: 'İŞĞÜÖÇ ışğüöç' }], columns: [{ k: 'a', label: 'Alan' }],
  });
  assert.equal(matrix.rows[0][0], 'İŞĞÜÖÇ ışğüöç');
  assert.match(exporter.toTSV(matrix), /İŞĞÜÖÇ ışğüöç/);
});

/* -------------------------------------------------------------- HTML */

test('HTML: model başına tam bir tr, sütun başına tam bir td', () => {
  const html = exporter.toHTML(matrixOf(records(50, { multiline: true })));
  assert.equal((html.match(/<tr>/g) || []).length, 51, 'başlık satırı + 50 model');
  assert.equal((html.match(/<td /g) || []).length, 150, '50 × 3 hücre');
});

test('HTML hiçbir yerde rowspan ya da dikey birleştirme içermez', () => {
  const html = exporter.toHTML(matrixOf(records(50, { multiline: true })));
  assert.doesNotMatch(html, /rowspan/i);
  assert.doesNotMatch(html, /mso-data-placement:\s*(?!same-cell)/i);
});

test('her td mso-data-placement:same-cell taşır', () => {
  /* Eksik tek bir hücre bile Excel'de o satırı bölmeye ve komşu sütunları
     dikey birleştirmeye yeter. */
  const html = exporter.toHTML(matrixOf(records(5)));
  assert.equal((html.match(/<td /g) || []).length,
    (html.match(/mso-data-placement:same-cell/g) || []).length);
});

test('assertFlat rowspan ve satır sayısını yakalar', () => {
  const html = exporter.toHTML(matrixOf(records(3)));
  assert.equal(exporter.assertFlat(html, 3).ok, true);
  assert.equal(exporter.assertFlat(html, 4).ok, false, 'yanlış satır sayısı fark edilmeli');
  assert.equal(exporter.assertFlat('<table><tr><td rowspan="3">x</td></tr></table>').ok, false);
});

test('hücre içeriği HTML olarak kaçışlanır', () => {
  const matrix = exporter.buildMatrix({
    records: [{ a: '<b>kalın</b>' }], columns: [{ k: 'a', label: 'A' }],
  });
  const html = exporter.toHTML(matrix);
  assert.doesNotMatch(html, /<b>kalın/);
  assert.match(html, /&lt;b&gt;kalın/);
});

/* ------------------------------------------- GÖRÜNÜM VE SIRA KORUNUR */

test('yalnız verilen sütunlar aktarılır; gizli sütun sızmaz', () => {
  const matrix = exporter.buildMatrix({
    records: [{ a: 1, gizli: 'sızmamalı', b: 2 }],
    columns: [{ k: 'a', label: 'A' }, { k: 'b', label: 'B' }],
  });
  assert.deepEqual(matrix.headers, ['A', 'B']);
  assert.doesNotMatch(exporter.toTSV(matrix), /sızmamalı/);
});

test('kayıt sırası ve sütun sırası olduğu gibi korunur', () => {
  const list = [{ a: 'üç' }, { a: 'bir' }, { a: 'iki' }];
  const matrix = exporter.buildMatrix({ records: list, columns: [{ k: 'a', label: 'A' }] });
  assert.deepEqual(matrix.rows.map(row => row[0]), ['üç', 'bir', 'iki']);
});

/* ------------------------------------------------------ ÇAĞRI YOLLARI */

test('Koleksiyon kopyalaması DOM üzerinden serialize EDİLMEZ', () => {
  assert.match(APP_MAIN, /if\(tableSel==='#kolTable'\) return buildCollectionStyledCopy\(selSet\);/,
    'Koleksiyon DOM yoluna girmemeli');
  assert.match(APP_MAIN, /async function buildCollectionStyledCopy/);
});

test('Koleksiyon dışa aktarım değeri kayıttan üretilir', () => {
  const block = APP_MAIN.slice(APP_MAIN.indexOf('async function buildCollectionStyledCopy'),
    APP_MAIN.indexOf('async function buildStyledCopyFromDom'));
  assert.match(block, /cellText:\(col,row\)=>meta\.cellText\(col,row\)/,
    'hücre metni TABLE_META üzerinden kayıttan gelmeli');
  assert.match(block, /BLTableExport\.buildMatrix/);
  assert.doesNotMatch(block, /textContent|innerHTML|outerHTML/,
    'değer üretiminde DOM metni okunmamalı');
});

test('TSV ve HTML üreten bütün yollar merkezî serializer üzerinden geçer', () => {
  for (const fn of ['function buildTSV', 'function buildHTMLTable']) {
    const start = APP_MAIN.indexOf(fn);
    assert.ok(start > 0, fn);
    const block = APP_MAIN.slice(start, start + 900);
    assert.match(block, /BLTableExport\./, `${fn} merkezî serializer kullanmalı`);
  }
});

test('Ctrl+C aralık kopyalaması da merkezî serializer üzerinden geçer', () => {
  const start = APP_MAIN.indexOf("document.addEventListener('copy'", APP_MAIN.indexOf('function cellOf'));
  assert.ok(start > 0);
  const block = APP_MAIN.slice(start, start + 2600);
  assert.match(block, /BLTableExport\.buildMatrix/);
  assert.match(block, /BLTableExport\.toTSV\(matrix\)/);
  assert.doesNotMatch(block, /lines\.join\('\\n'\)/, 'elle TSV birleştirmesi kalmamalı');
});

test('DOM yolundaki her hücreye same-cell eklenir', () => {
  const start = APP_MAIN.indexOf('async function buildStyledCopyFromDom');
  const block = APP_MAIN.slice(start, APP_MAIN.indexOf('async function copyStyledTableLikeExcel'));
  assert.match(block, /BLTableExport\.SAME_CELL/);
  assert.match(block, /BLTableExport\.tsvCell\(text\)/, 'DOM metni normalize edilmeli');
});

test('Excel görsel aktarımı model başına tek satır yazar', () => {
  /* rowNum = ri + 2 → başlık 1. satır, her model kendi satırı. Bir modelin
     birden çok satıra yayılması ya da satırların birleştirilmesi olamaz. */
  const block = APP_MAIN.slice(APP_MAIN.indexOf('async function kolExportWithImages'),
    APP_MAIN.indexOf('function kolStyleExportValue'));
  assert.match(block, /rowNum=ri\+2/);
  assert.doesNotMatch(block, /mergeCells|ws\.merge/i, 'Excel aktarımında hücre birleştirme olmamalı');
});

test('normal metin kopyalaması körlemesine ele geçirilmez', () => {
  /* Grid dışındaki input, textarea, modal ve not alanları normal kopyalanmaya
     devam etmeli; özel serializer yalnız veri tablosu seçimlerinde çalışır. */
  const start = APP_MAIN.indexOf("document.addEventListener('copy'", APP_MAIN.indexOf('function cellOf'));
  const block = APP_MAIN.slice(start, start + 900);
  assert.match(block, /sel\.isCollapsed\) return;/, 'seçim yoksa varsayılan kopyalama sürmeli');
  assert.match(block, /if\(!anchorTd \|\| !focusTd\) return;/, 'tablo dışı seçim devralınmamalı');
  assert.match(block, /if\(!meta\) return;/, 'tanımsız tabloda devralınmamalı');
});

test('serializer açılışta yüklenir', () => {
  assert.match(INDEX, /<script src="table-export\.js\?v=[^"]+"><\/script>/);
});
