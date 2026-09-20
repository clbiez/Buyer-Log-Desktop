'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dates = require('../public/excel-date-utils');
const backlog = require('../public/backlog-excel-formulas');

const ROOT = path.join(__dirname, '..');

function colName(index) {
  let n = index + 1, out = '';
  while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
function colIndex(label) {
  let n = 0; for (const ch of label) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1;
}
const XLSX = { utils: {
  encode_cell({ r, c }) { return `${colName(c)}${r + 1}`; },
  decode_range(ref) {
    const [a, b = a] = String(ref).split(':');
    const parse = item => { const m = item.match(/^([A-Z]+)(\d+)$/); return { c: colIndex(m[1]), r: Number(m[2]) - 1 }; };
    return { s: parse(a), e: parse(b) };
  },
} };

test('date header classifier excludes month/week fields and recognises operational date columns', () => {
  for (const header of ['Ex-factory', 'Retail Date', 'Retail', 'OPD', 'Yükleme Onayı', 'In-Store (Model Budget)', 'Sipariş Yerleştirme MerchTarih', 'ANTREPO GİRİŞ TARİHİ', 'Created At']) {
    assert.equal(dates.isDateHeader(header), true, header);
  }
  for (const header of ['Retail Depo Merch Yil Ay', 'Model Bütçe Yil Hafta', 'Current In-Store Months', 'Ex-Factory Month', 'ANTREPO-RETAIL']) {
    assert.equal(dates.isDateHeader(header), false, header);
  }
});

test('SheetJS workbook date normalisation turns textual dates into real date cells without changing month/week text', () => {
  const ws = {
    '!ref': 'A1:E3',
    A1: { v: 'Ex-factory', t: 's' }, B1: { v: 'Retail Depo Merch Yil Ay', t: 's' },
    C1: { v: 'Model Bütçe Yil Hafta', t: 's' }, D1: { v: 'Created At', t: 's' }, E1: { v: 'Retail Date', t: 's' },
    A2: { v: '26.07.2026', t: 's', s: { font: { bold: true } } }, B2: { v: '2026-08', t: 's' },
    C2: { v: '2026-32', t: 's' }, D2: { v: '2026-07-26T09:30:00', t: 's' }, E2: { v: 46229, t: 'n' },
    A3: { v: '', t: 's' }, D3: { v: 'not a date', t: 's' },
  };
  const wb = { SheetNames: ['Data'], Sheets: { Data: ws } };
  assert.equal(dates.normalizeWorkbookDateColumns(wb, XLSX), 3);
  // v5.81: tarih hücreleri artık Date değil TAM SAYI seri numarası olarak yazılır.
  // Date verildiğinde kütüphaneler dönüşümü saat dilimine göre yapıyor ve UTC+X
  // saat dilimlerinde gün bir geriye kayıyordu; seri numarası takvim günüdür ve
  // hiçbir saat dilimi dönüşümünden geçmez. Amaç aynı: metin tarihler gerçek
  // tarih hücresine dönüşür, ay/hafta metinleri dokunulmadan kalır.
  assert.equal(ws.A2.t, 'n'); assert.equal(ws.A2.v, 46229); assert.equal(ws.A2.z, 'dd.mm.yyyy');
  assert.equal(ws.A2.s.numFmt, 'dd.mm.yyyy');
  assert.equal(ws.A2.v % 1, 0, 'kesirli seri Excel’de bir gün kaymaya yol açar');
  assert.equal(dates.excelSerial(new Date(2026, 6, 26)), ws.A2.v, 'seri 26.07.2026 takvim gününe karşılık gelmeli');
  assert.equal(ws.B2.t, 's'); assert.equal(ws.B2.v, '2026-08');
  assert.equal(ws.C2.t, 's'); assert.equal(ws.C2.v, '2026-32');
  assert.equal(ws.D2.t, 'n'); assert.equal(ws.D2.v, 46229);
  assert.equal(ws.E2.t, 'n'); assert.equal(ws.E2.z, 'dd.mm.yyyy');
  assert.equal(ws.D3.v, 'not a date');
});

test('SheetJS write hooks enforce date typing for every browser workbook write path', () => {
  let written = null;
  const fake = { ...XLSX, writeFile(wb) { written = wb; return 'ok'; }, write(wb) { written = wb; return new Uint8Array(); } };
  assert.equal(dates.installSheetJsHooks(fake), true);
  const wb = { SheetNames: ['S'], Sheets: { S: { '!ref': 'A1:A2', A1: { v: 'Handover Tarihi', t: 's' }, A2: { v: '27.07.2026', t: 's' } } } };
  fake.writeFile(wb, 'x.xlsx');
  // Yazma kancası metin tarihi tam sayı seri numarasına çevirir (bkz. v5.81).
  assert.equal(written.Sheets.S.A2.t, 'n');
  assert.equal(written.Sheets.S.A2.v, 46230);
  assert.equal(written.Sheets.S.A2.z, 'dd.mm.yyyy');
  assert.equal(dates.installSheetJsHooks(fake), false, 'hook is idempotent');
});

test('Backlog current-status validation options contain canonical and source-specific values', () => {
  const options = backlog.statusOptions([
    { 'GÜNCEL DURUM\n(STATUS)': 'Üretimde - Dikimde' },
    { 'GÜNCEL DURUM\n(STATUS)': 'Depoda' },
  ]);
  for (const expected of ['Üretimde', 'Yükleme Operasyonları', 'Yol Operasyonları', 'Gümrük-Liman Operasyonları', 'Yolda', 'Retaile Aktarım Bekleniyor', 'Depoda', 'Üretimde - Dikimde']) {
    assert.ok(options.includes(expected), expected);
  }
  assert.equal(new Set(options).size, options.length);
});

// Backlog dışa aktarım JS'i index.html'den app-main.js'e taşındı; boot script (XLSX hook
// kurulumu) index.html'de kaldı. normalizeExcelJsWorkbookDateColumns çağrı sayısı 2'den
// 4'e çıktı (Backlog'un genişleyen dışa aktarım yollarıyla); statusOptions parametre adı
// backlogRows'tan dataRows'a değişti.
test('browser, ExcelJS and worker export paths share date typing and strict Backlog status validation', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const appMain = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'server/workers/excel-worker.js'), 'utf8');
  assert.match(html, /excel-date-utils\.js\?v=__BL_ASSET_VERSION__/);
  // Kanca kurulumu index.html'deki satır içi betikten perf-runtime.js'e taşındı:
  // XLSX artık lazy yüklendiği için kancalar kütüphane hazır olduğu AN kuruluyor
  // (spec.after). Bu, açılışta boşa kurulum yapmadan aynı garantiyi verir.
  const perf = fs.readFileSync(path.join(ROOT, 'public/perf-runtime.js'), 'utf8');
  assert.match(perf, /xlsx:\{[^}]*after\(\)\{[^}]*BLExcelDates\.installSheetJsHooks\(global\.XLSX\)/);
  assert.equal((appMain.match(/BLExcelDates\.normalizeExcelJsWorkbookDateColumns\(wb\)/g) || []).length, 4);
  assert.match(appMain, /values:BLBacklogExcel\.statusOptions\(dataRows\)/);
  assert.match(appMain, /Geçersiz Güncel Durum/);
  assert.match(worker, /require\('\.\.\/\.\.\/public\/excel-date-utils'\)/);
  assert.match(worker, /BLExcelDates\.normalizeWorkbookDateColumns\(wb, XLSX\)/);
  assert.match(worker, /values: BLBacklogExcel\.statusOptions\(detailRows\)/);
  assert.match(worker, /Geçersiz Güncel Durum/);
});
