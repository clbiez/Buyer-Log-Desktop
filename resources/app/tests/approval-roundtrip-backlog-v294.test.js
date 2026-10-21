'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('../public/vendor/jszip.min.js');
const guards = require('../public/excel-workbook-guards');
const formulas = require('../public/backlog-excel-formulas');

const WORKSHEET_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';

test('Excel approval validation is a stop-style required dropdown, not free text', () => {
  const xml = guards.injectWorksheetListValidation(WORKSHEET_XML, {
    sqref: 'I2:Q20',
    values: ['Pending', 'Submitted', 'Approved', 'Revision', 'N/A'],
    allowBlank: false,
    promptTitle: 'Approval status',
    error: 'Free-text entry is blocked.',
  });
  assert.match(xml, /<dataValidations count="1">/);
  assert.match(xml, /type="list"/);
  assert.match(xml, /allowBlank="0"/);
  assert.match(xml, /errorStyle="stop"/);
  assert.match(xml, /sqref="I2:Q20"/);
  assert.match(xml, /<formula1>&quot;Pending,Submitted,Approved,Revision,N\/A&quot;<\/formula1>/);
  assert.ok(xml.indexOf('<dataValidations') < xml.indexOf('<pageMargins'));
});

test('validation injection preserves existing worksheet validations and corrects the count', () => {
  const source = WORKSHEET_XML.replace('<pageMargins', '<dataValidations count="1"><dataValidation type="list" sqref="A2"><formula1>&quot;A,B&quot;</formula1></dataValidation></dataValidations><pageMargins');
  const xml = guards.injectWorksheetListValidation(source, { sqref: 'B2:B4', values: ['One', 'Two'] });
  assert.match(xml, /<dataValidations count="2">/);
  assert.equal((xml.match(/<dataValidation\b/g) || []).length, 2);
});

test('workbook ZIP patch writes data validation into the requested worksheet XML', async () => {
  const zip = new JSZip();
  zip.file('xl/worksheets/sheet1.xml', WORKSHEET_XML);
  zip.file('[Content_Types].xml', '<Types/>');
  const raw = await zip.generateAsync({ type: 'nodebuffer' });
  const patched = await guards.applySheetValidations(raw, [{ sheetPath: 'xl/worksheets/sheet1.xml', sqref: 'AF2:AF12', values: ['Gemi', 'Uçak', 'Gemi+Uçak', 'Gemi+Tır'] }], JSZip, 'nodebuffer');
  const reopened = await JSZip.loadAsync(patched);
  const xml = await reopened.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /sqref="AF2:AF12"/);
  assert.match(xml, /Gemi,Uçak,Gemi\+Uçak,Gemi\+Tır/);
});

test('month/week and revised Ex-Factory remain direct while Priority follows ANTREPO-RETAIL', () => {
  const headers = [
    'Orijinal Exfactory Merch Ay','Orijinal Exfactory Merch Tarih','Retail Depo Merch Yil Ay','Retail Depo Tarih Yıl Ay Gün',
    'Model Bütçe Merch Yil Ay','Model Bütçe Tarih Yıl Ay Gün','Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta',
    'Net Alım Sipariş Miktarı','Kalan Alım Sipariş Miktarı','Net Gelen Alım Sipariş Miktarı','GÜNCEL DURUM\n(STATUS)',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)','ANTREPO GİRİŞ TARİHİ','YÜKLEME TİPİ','ANTREPO-RETAIL','RİSK\n(PRIORITY)',
  ];
  const row = {
    'Orijinal Exfactory Merch Ay': '2026-07', 'Orijinal Exfactory Merch Tarih': '2026-07-10',
    'Retail Depo Merch Yil Ay': '2026-09', 'Retail Depo Tarih Yıl Ay Gün': '2026-09-30',
    'Model Bütçe Merch Yil Ay': '2026-10', 'Model Bütçe Tarih Yıl Ay Gün': '2026-10-15',
    'Model Bütçe Yil Hafta': '2026-42', 'Retail Depo Merch Yil Hafta': '2026-40',
    'Net Alım Sipariş Miktarı': 20, 'Kalan Alım Sipariş Miktarı': 10, 'Net Gelen Alım Sipariş Miktarı': 10,
    'GÜNCEL DURUM\n(STATUS)': 'Üretimde', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2026-07-10',
    'ANTREPO GİRİŞ TARİHİ': '2026-09-18', 'YÜKLEME TİPİ': 'Gemi', 'ANTREPO-RETAIL': -12,
    'RİSK\n(PRIORITY)': 'YOK', _backlogExcel: { transitDays: 70, originalDelType: 'Gemi' },
  };
  const plan = formulas.formulaPlan(headers, row, 2);
  for (const header of ['Orijinal Exfactory Merch Ay','Retail Depo Merch Yil Ay','Model Bütçe Merch Yil Ay','Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta','REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']) {
    assert.equal(plan.formulas[header], undefined);
  }
  assert.equal(plan.formulas['RİSK\n(PRIORITY)'].cached, 'YOK');
  /* v20261021: RİSK üç bayraktan gelir — Retail'e yetişmeme (ortalama yol
     süresiyle tahmin), 3 günü aşan Handover bekleyişi, yol süresi aşımı.
     Eski ANTREPO-RETAIL riski Retail bayrağının içinde korunuyor. */
  assert.match(plan.formulas['RİSK\n(PRIORITY)'].formula, /^IF\(OR\((?:[A-Z]+2,){2}[A-Z]+2\),"VAR","YOK"\)$/);
  assert.ok(plan.formulas['Net Gelen Alım Sipariş Miktarı']);
  assert.ok(plan.formulas['ANTREPO GİRİŞ TARİHİ']);
  assert.ok(plan.formulas['ANTREPO-RETAIL']);
});
