'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function pricingHelpers() {
  const start = APP.indexOf('function pricingRuleIsExpired(');
  const end = APP.indexOf('function normalizePricingCountryGroup', start);
  return new Function('normalizePricingRuleDate', 'dateOrdinal', `${APP.slice(start, end)}; return { pricingRuleIsExpired, pricingRuleIsCurrent, prioritizePricingRuleCheckCandidates };`)(
    value => String(value || '').slice(0, 10),
    value => {
      if (value instanceof Date) return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;
      const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 : null;
    },
  );
}

test('Fiyat Kontrolü güncel tarih aralığındaki sözleşmeleri önce listeler', () => {
  const helpers = pricingHelpers();
  const now = new Date(2026, 8, 1);
  assert.equal(helpers.pricingRuleIsCurrent({ opdStart: '2026-01-01', opdEnd: '2026-09-30' }, now), true);
  assert.equal(helpers.pricingRuleIsCurrent({ opdStart: '2026-10-01', opdEnd: '2026-12-31' }, now), false);
  assert.equal(helpers.pricingRuleIsCurrent({ opdStart: '2026-01-01', opdEnd: '2026-08-31' }, now), false);

  const ordered = helpers.prioritizePricingRuleCheckCandidates([
    { id: 'expired', opdStart: '2026-01-01', opdEnd: '2026-08-31' },
    { id: 'future', opdStart: '2026-10-01', opdEnd: '2026-12-31' },
    { id: 'current', opdStart: '2026-01-01', opdEnd: '2026-09-30' },
  ], now);
  assert.deepEqual(ordered.map(rule => rule.id), ['current', 'future', 'expired']);
});

test('Fiyat Kontrolü süresi geçmiş seçenekleri tabloyla aynı kırmızı durum sınıfını taşır', () => {
  assert.match(APP, /prioritizePricingRuleCheckCandidates\(candidates/);
  assert.match(APP, /option[^>]+pricingRuleExpired/);
  assert.match(APP, /pricingRuleCheckSelectionState/);
  assert.match(CSS, /\.pricingRuleCheckRuleField select option\.pricingRuleExpired/);
  assert.match(CSS, /\.pricingRuleCheckRuleField select\.pricingRuleExpired/);
});
