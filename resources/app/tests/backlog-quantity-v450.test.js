'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const excel = require('../public/backlog-excel-formulas');

test('v4.50 Backlog Excel Adet sütunu Net Alım Sipariş Miktarının hemen sağındadır', () => {
  const visible = excel.DEFAULT_VISIBLE_HEADERS;
  const netAt = visible.indexOf('Net Alım Sipariş Miktarı');
  assert.ok(netAt >= 0);
  assert.strictEqual(visible[netAt + 1], 'Adet');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(serverSource, /'Net Alım Sipariş Miktarı','Adet'/);
});

test('v4.50 Net Gelen formülü parsiyel miktarını Adet sütunundan alır', () => {
  const headers = [...excel.DEFAULT_VISIBLE_HEADERS];
  const plan = excel.formulaPlan(headers, {
    'GÜNCEL DURUM\n(STATUS)': 'Yol Operasyonları',
    'Adet': 700,
    'Net Gelen Alım Sipariş Miktarı': 700,
  }, 2);
  const formula = plan.formulas['Net Gelen Alım Sipariş Miktarı'].formula;
  const adetColumn = excel.columnName(headers.indexOf('Adet'));
  assert.match(formula, new RegExp(`${adetColumn}2`));
});


test('v4.51 Backlog Excel Eksik Yükleme satırını sentetik kabul eder ve Ex-Factory öncelik formüllerini kullanır', () => {
  const headers=[...excel.DEFAULT_VISIBLE_HEADERS];
  const plan=excel.formulaPlan(headers,{
    'GÜNCEL DURUM\n(STATUS)':'Eksik Yükleme',
    'Adet':100,
    'Net Gelen Alım Sipariş Miktarı':0,
  },2);
  assert.ok(excel.STATUS_OPTIONS.includes('Eksik Yükleme'));
  assert.match(plan.formulas['Net Gelen Alım Sipariş Miktarı'].formula,/Eksik Yükleme/);
  assert.match(plan.formulas['ANTREPO GİRİŞ TARİHİ'].formula,/Eksik Yükleme/);
  assert.match(plan.helperCells['_BL_DELAY'].formula,/Eksik Yükleme/);
  assert.match(plan.helperCells['_BL_HANDOVER'].formula,/Eksik Yükleme/);
});

test('v4.64 Backlog Excel Shortage Priority geçmiş Ex-Factoryyi TODAY ile değiştirmez ve Discount üretmez', () => {
  const headers = [...excel.DEFAULT_VISIBLE_HEADERS];
  const plan = excel.formulaPlan(headers, {
    'GÜNCEL DURUM\n(STATUS)': 'Eksik Yükleme',
    'Adet': 100,
  }, 2);
  const delay = plan.helperCells['_BL_DELAY'].formula;
  const discount = plan.helperCells['_BL_DISCOUNT'].formula;
  assert.match(delay, /Eksik Yükleme/);
  assert.match(delay, /TODAY\(\)/);
  assert.match(delay, /\+.*>.*Retail|\+.*>/);
  assert.match(discount, /Üretimde/);
  assert.doesNotMatch(discount, /Eksik Yükleme/);
});

test('v4.64 Backlog Excel Depoda - Eksik Yükleme durumunu Shortage olarak tanır', () => {
  const headers = [...excel.DEFAULT_VISIBLE_HEADERS];
  const plan = excel.formulaPlan(headers, {
    'GÜNCEL DURUM\n(STATUS)': 'Depoda - Eksik Yükleme',
    'Adet': 100,
  }, 2);
  assert.ok(excel.STATUS_OPTIONS.includes('Depoda - Eksik Yükleme'));
  assert.match(plan.formulas['Net Gelen Alım Sipariş Miktarı'].formula, /Depoda - Eksik Yükleme/);
  assert.match(plan.formulas['ANTREPO GİRİŞ TARİHİ'].formula, /Depoda - Eksik Yükleme/);
});

