'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const lfl = require(path.join(ROOT, 'server', 'lib', 'lfl.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const LFL_UI = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function order(extra = {}) {
  return {
    ocode: 1001, model: 'MODEL A', ccode: 'C01', colour: 'BLACK',
    season: 'W6', countryRaw: 'INDIA', manufacturer: 'MAIN FACTORY', license: 'MINECRAFT',
    category: 'KNIT', merch: '12', ageGroup: 'A1', buyer: 'BUYER', buyerGrup: 'GROUP', line: 'LINE',
    qty: 100, kalan: 100, fob: 5, opd: new Date(2026, 7, 1), ex: new Date(2026, 11, 1),
    retail: new Date(2027, 1, 1), mb: new Date(2027, 0, 15), merkezSevkeHazirKalan: 0,
    ...extra,
  };
}

function overrides(extra = {}) {
  return { notesmap:{}, submap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, licensormap:{}, datemap:{}, pricingRules:[], transitRules:[], ...extra };
}

test('v5.06 Backlog exposes Sub Mfr as a filter/group dimension', () => {
  const report = parse.buildBacklogGrouped([order()], {}, overrides({submap:{1001:'SUB FACTORY'}}), {groupBy:['subManufacturer']});
  assert.deepEqual(report.dimValues.subManufacturer, ['SUB FACTORY']);
  assert.equal(report.tree[0].label, 'SUB FACTORY');
  assert.equal(report.dimLabels.subManufacturer, 'Alt Üretici');
  assert.match(APP, /BACKLOG_DIM_ORDER\s*=\s*\[[^\]]*'subManufacturer'/);
  assert.match(APP, /subManufacturer:'Sub Mfr'/);
});

test('v5.06 Backlog Sub Mfr keeps Non-DTR blank when there is no user entry', () => {
  const report = parse.buildBacklogGrouped([order()], {}, overrides(), {groupBy:['subManufacturer']});
  assert.deepEqual(report.dimValues.subManufacturer, ['(boş)']);
});

test('v5.06 LFL parser keeps OPD and Ex-Factory from the ASAS row', () => {
  const parsed = lfl.parseLFLRows([{
    'Sipariş Kod':'1234567', 'Model Adı':'MODEL A', 'Renk Kod':'C01',
    'FOB Fiyatı':5.5, 'Net Alım Sipariş Miktarı':1000, Sezon:'S7',
    'Model Bütçe Tarih Yıl Ay Gün':'2027-02-01',
    'Sipariş Yerleştirme MerchTarih':'2026-08-01',
    'Orijinal Exfactory Merch Tarih':'2027-01-01',
    'Merch Alt Grup Kod':'MAG1', 'Merch Marka Yaş Grup Kod':'MMYG1',
    'Ürün Klasman':'ÜST GİYİM', Üretici:'ÜRETİCİ A',
    'Siparişin Üretildiği Ülke':'INDIA', 'Buyer Grup (TR)':'GRUP A', Buyer:'BUYER A',
    'Ana Kumaş Mı':1,
  }], 'ASAS');
  assert.equal(parsed.rows[0].opd, '2026-08-01');
  assert.equal(parsed.rows[0].exFactory, '2027-01-01');
});



test('v5.07 LFL OPD and Ex-F. ignore generic aliases and use only the exact ASAS columns', () => {
  const parsed = lfl.parseLFLRows([{
    'Sipariş Kod':'7654321', 'Model Adı':'MODEL STRICT', 'Renk Kod':'C09',
    'FOB Fiyatı':4.2, 'Net Alım Sipariş Miktarı':500, Sezon:'W7',
    'Model Bütçe Tarih Yıl Ay Gün':'2027-03-01',
    'Sipariş Yerleştirme MerchTarih':'2026-09-15',
    'OPD':'1999-01-01',
    'Orijinal Exfactory Merch Tarih':'2027-02-10',
    'EX-FACTORY':'1999-02-02',
    'Merch Alt Grup Kod':'MAG2', 'Merch Marka Yaş Grup Kod':'MMYG2',
    'Ürün Klasman':'ALT GİYİM', Üretici:'ÜRETİCİ B',
    'Siparişin Üretildiği Ülke':'BANGLADESH', 'Buyer Grup (TR)':'GRUP B', Buyer:'BUYER B',
    'Ana Kumaş Mı':1,
  }], 'ASAS');
  assert.equal(parsed.rows[0].opd, '2026-09-15');
  assert.equal(parsed.rows[0].exFactory, '2027-02-10');
});

test('v5.07 generic OPD / EX-FACTORY columns do not backfill LFL dates when exact ASAS columns are absent', () => {
  const parsed = lfl.parseLFLRows([{
    'Sipariş Kod':'7654322', 'Model Adı':'MODEL STRICT 2', 'Renk Kod':'C10',
    'FOB Fiyatı':4.4, 'Net Alım Sipariş Miktarı':600, Sezon:'W7',
    'Model Bütçe Tarih Yıl Ay Gün':'2027-03-15',
    'OPD':'2026-09-20', 'EX-FACTORY':'2027-02-20',
    'Merch Alt Grup Kod':'MAG2', 'Merch Marka Yaş Grup Kod':'MMYG2',
    'Ürün Klasman':'ALT GİYİM', Üretici:'ÜRETİCİ B',
    'Siparişin Üretildiği Ülke':'BANGLADESH', 'Buyer Grup (TR)':'GRUP B', Buyer:'BUYER B',
    'Ana Kumaş Mı':1,
  }], 'ASAS');
  assert.equal(parsed.rows[0].opd, '');
  assert.equal(parsed.rows[0].exFactory, '');
});
test('v5.06 LFL detail tables and exports include OPD and Ex-F.', () => {
  const detailStart = LFL_UI.indexOf('function detailColumns()');
  const detailEnd = LFL_UI.indexOf('function updateFabricDetailsButton', detailStart);
  const detail = LFL_UI.slice(detailStart, detailEnd);
  assert.match(detail, /key:'opd',label:'OPD'/);
  assert.match(detail, /key:'exFactory',label:isEn\(\)\?'Ex-F\.':'Ex-F\.'/);
  assert.match(LFL_UI, /'Sezon','OPD','Ex-F\.','In-Store'/);
  assert.match(LFL_UI, /excelDate\(r\.opd\),excelDate\(r\.exFactory\),excelDate\(r\.inStore\)/);
});
