'use strict';

// v5.86 — Backlog Excel'indeki sarı koşullu biçimlendirme dosyaya HİÇ girmiyordu.
//
// v5.75'te kurallar yazıldı ve doğrulandı, ama YANLIŞ YOLDA: yalnız sunucudaki
// writeBacklogWorkbook işçisine bağlanmıştı. Backlog ekranındaki "Excel'e Aktar"
// düğmesi ise satırları `/api/backlog-export?format=json` ile alıp çalışma
// kitabını TARAYICIDA üretiyor ve saveWorkbookWithValidations'a koşullu
// biçimlendirme argümanı olarak boş dizi geçiyordu. Yani kullanıcının indirdiği
// dosyada kural hiç bulunmuyordu.
//
// Bu test iki şeyi birden çiviler: kuralların üretildiğini VE her iki tarayıcı
// dışa aktarım çağrısının onları gerçekten ilettiğini.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const formulas = require('../public/backlog-excel-formulas');
const guards = require('../public/excel-workbook-guards');

const HEADERS = [
  'Sezon', 'GÜNCEL DURUM\n(STATUS)', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
  'ANTREPO GİRİŞ TARİHİ', 'YÜKLEME TİPİ', 'ANTREPO-RETAIL', 'RİSK\n(PRIORITY)',
];

test('v5.86 tarayıcı dışa aktarımı koşullu biçimlendirmeyi boş dizi olarak geçmiyor', () => {
  // Asıl hata buydu: dördüncü argüman `[]` idi.
  const calls = APP.match(/saveWorkbookWithValidations\(wb,[^)]*rules\.validations,[^,]+,rules\.protections/g) || [];
  assert.equal(calls.length, 2, 'Backlog ekranı ve Backlog detay penceresi — iki çağrı');
  calls.forEach(call => {
    assert.match(call, /rules\.validations,rules\.conditionalFormats,rules\.protections/);
    assert.doesNotMatch(call, /rules\.validations,\[\]/);
  });
});

test('v5.86 guard yapılandırması kuralları üretiyor', () => {
  const block = APP.slice(APP.indexOf('function backlogWorkbookGuardConfig'), APP.indexOf('async function exportCurrentBacklogDetail'));
  assert.match(block, /conditionalFormats:\(window\.BLBacklogExcel&&typeof BLBacklogExcel\.conditionalFormats==='function'\)/);
  assert.match(block, /BLBacklogExcel\.conditionalFormats\(list,lastExcelRow,\{reportDate:new Date\(\)\}\)/);
  // Modül yüklenmemişse dışa aktarım çökmemeli, yalnız kural taşımamalı.
  assert.match(block, /:\[\],/);
});

test('v5.86 kurallar doğru sütunlara ve doğru koşullarla üretiliyor', () => {
  const list = formulas.conditionalFormats(HEADERS, 3, { reportDate: '2026-08-12' });
  assert.equal(list.length, 2);

  const revised = list.find(item => item.sqref.startsWith('C'));
  assert.equal(revised.sqref, 'C2:C3');
  // Tarih rapor gününden ÖNCE ve sipariş Üretimde ise sarı; elle ileri bir
  // termine revize edilince koşul bozulur ve renk kalkar.
  assert.equal(revised.rules[0].formula, 'AND($C2<>"",$C2<46246,OR($B2="Üretimde",$B2="Production"))');

  const delivery = list.find(item => item.sqref.startsWith('E'));
  assert.equal(delivery.sqref, 'E2:E3');
  // Gemi+Uçak'a geçilince RİSK "YOK"a düşer ve koşul bozulur.
  assert.equal(
    delivery.rules[0].formula,
    'AND(OR(ISNUMBER(SEARCH("Gemi",$E2)),ISNUMBER(SEARCH("Sea",$E2))),ISNUMBER($F2),$G2="VAR")'
  );
});

test('v5.86 kurallar gerçekten çalışma kitabı dosyasına yazılıyor', async () => {
  // Tarayıcı yolunun birebir aynısı: SheetJS ile kitap üret → applyWorkbookGuards.
  const XLSX = require('xlsx');
  const JSZip = require('../public/vendor/jszip.min.js');
  const sheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ['26SS', 'Üretimde', 46204, 46300, 'Gemi', 9, 'VAR'],
    ['26SS', 'Depoda', 46295, 46300, 'Gemi+Uçak', '', 'YOK'],
  ]);
  const workbook = { SheetNames: ['BACKLOG'], Sheets: { BACKLOG: sheet } };
  const raw = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const out = await guards.applyWorkbookGuards(raw, {
    validations: [],
    conditionalFormats: formulas.conditionalFormats(HEADERS, 3, { reportDate: '2026-08-12' }),
    protections: [],
  }, JSZip, 'nodebuffer');

  const zip = await JSZip.loadAsync(out);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const blocks = xml.match(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g) || [];
  assert.equal(blocks.length, 2, 'iki kural da dosyaya girmeli');
  assert.match(xml, /sqref="C2:C3"/);
  assert.match(xml, /sqref="E2:E3"/);
  assert.match(xml, /type="expression"/);

  // Sarı dolgu tanımı stiller dosyasında olmalı; yoksa kural eşleşse de renk çıkmaz.
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.match(styles, /FFFFF2CC/);

  // Excel şeması sıra ister: conditionalFormatting, dataValidations'tan ÖNCE ve
  // sheetData'dan SONRA gelmeli; yanlış sıra dosyayı "onarılıyor" durumuna düşürür.
  const dataIndex = xml.indexOf('</sheetData>');
  const cfIndex = xml.indexOf('<conditionalFormatting');
  assert.ok(dataIndex > 0 && cfIndex > dataIndex, 'sheetData sonrasında olmalı');
  const dvIndex = xml.indexOf('<dataValidations');
  if (dvIndex >= 0) assert.ok(cfIndex < dvIndex, 'dataValidations öncesinde olmalı');
});
