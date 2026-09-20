'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../public/backlog-excel-formulas');

const HEADERS = [
  'Retail Depo Tarih Yıl Ay Gün',
  'GÜNCEL DURUM\n(STATUS)',
  'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
  'YÜKLEME TİPİ',
  'ANTREPO-RETAIL',
  'RİSK\n(PRIORITY)',
];

function row(antRetail, overrides = {}) {
  return {
    'Retail Depo Tarih Yıl Ay Gün': '2026-08-20',
    'GÜNCEL DURUM\n(STATUS)': 'Üretimde',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2026-08-01',
    'YÜKLEME TİPİ': 'Gemi',
    'ANTREPO-RETAIL': antRetail,
    _backlogExcel: { transitDays: 70, originalDelType: 'Gemi' },
    ...overrides,
  };
}

test('unified risk: Excel cached value follows canonical runtime Risk, not an independent ANTREPO-RETAIL > 5 rule', () => {
  assert.equal(formulas.formulaPlan(HEADERS, row(5, {'RİSK\n(PRIORITY)':'YOK'}), 2).formulas['RİSK\n(PRIORITY)'].cached, 'YOK');
  assert.equal(formulas.formulaPlan(HEADERS, row(6, {'RİSK\n(PRIORITY)':'VAR'}), 3).formulas['RİSK\n(PRIORITY)'].cached, 'VAR');
  const formula = formulas.formulaPlan(HEADERS, row(6, {'RİSK\n(PRIORITY)':'VAR'}), 4).formulas['RİSK\n(PRIORITY)'].formula;
  assert.ok(!formula.includes('>5'));
});

// v5.75: the two highlights moved from baked-in cell fills to Excel
// conditional-formatting rules, so the row-level booleans this test used to
// assert no longer exist. The rule text is checked in
// tests/backlog-conditional-format-v575.test.js.
test('v5.75 highlights are no longer frozen into the exported cells', () => {
  const plan = formulas.formulaPlan(HEADERS, row(6), 2);
  assert.equal(plan.conditionalFormatting, undefined);
  assert.equal(typeof formulas.conditionalFormats, 'function');
});
