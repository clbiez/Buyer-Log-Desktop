'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function loadFunction(name, deps = {}) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const next = APP.indexOf('\n\nfunction ', start);
  assert.ok(next > start, `${name} kapanışı bulunamadı`);
  const src = APP.slice(start, next).trim();
  const keys = Object.keys(deps);
  return new Function(...keys, `${src}; return ${name};`)(...keys.map(key => deps[key]));
}

const parseNum = value => {
  const n = Number(String(value == null ? '' : value).replace(',', '.').replace(/[%\s$]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

function landedCalc({ trRule, trRuleMissing = false, overseasRuleMissing = false } = {}) {
  let requestedGroup = '';
  const priceWithRule = loadFunction('kolLandedPriceWithRule', {
    kolLandedIsNonDtr: row => String(row?.licensor || '').toUpperCase() !== 'DTR',
  });
  const calc = loadFunction('kolLandedCalc', {
    kolParseMoneyNum: parseNum,
    kolDefaultLandedMultipliers: () => ({ tr: 1, overseas: 1 }),
    KOL_TR_LANDED_MULT: 1,
    KOL_YD_LANDED_MULT: 1,
    kolAutoFx: () => null,
    kolFindPricingRuleForCountryGroup: (_row, group) => {
      requestedGroup = group;
      return trRule || null;
    },
    kolTrLicenseRuleMissing: () => trRuleMissing,
    kolLandedPriceWithRule: priceWithRule,
    kolSuppFob: () => ({ price: 10, source: 'target', name: '' }),
    kolLandedPriceWithCosts: (base, row) => {
      if (overseasRuleMissing) return null;
      const royalty = parseNum(row.royalty) / 100;
      const hologram = parseNum(row.hologramCost) || 0;
      return Number(base) / (1 - royalty) + hologram;
    },
    kolLandedIsNonDtr: row => String(row?.licensor || '').toUpperCase() !== 'DTR',
    kolLicenseRuleMissing: () => overseasRuleMissing,
  });
  const row = {
    licensor: 'WARNER',
    trPrice: 100,
    trFx: 10,
    trLandedMult: 1,
    ydLandedMult: 1,
    royalty: 10,
    hologramCost: 0,
  };
  return { result: calc(row), requestedGroup };
}

test('TR Landed üretim ülkesindeki royalty yerine Country Group = TR kuralını kullanır', () => {
  const { result, requestedGroup } = landedCalc({
    trRule: { id: 'tr-rule', countryGroup: 'TR', royalty: 20, hologramCost: 0.5 },
  });

  assert.equal(requestedGroup, 'TR');
  assert.equal(result.trRoyaltyPct, 20);
  assert.equal(result.trHologramCost, 0.5);
  assert.equal(result.trCostedUsd, 13, '10 / (1 - 0.20) + 0.50');
  assert.equal(result.trLanded, 13);

  // Overseas aynı satırın mevcut NON-TR royalty alanlarıyla çalışmaya devam eder.
  assert.ok(Math.abs(result.ydLanded - (10 / 0.9)) < 1e-9);
  assert.notEqual(result.trLanded, result.ydLanded);
});

test('TR kuralı yoksa yalnız TR Landed durur, Overseas Landed bozulmaz', () => {
  const { result } = landedCalc({ trRule: null, trRuleMissing: true, overseasRuleMissing: false });

  assert.equal(result.trRuleMissing, true);
  assert.equal(result.trCostedUsd, null);
  assert.equal(result.trLanded, null);
  assert.ok(Number.isFinite(result.ydLanded), 'Overseas Landed hesaplanmaya devam etmeli');
  assert.equal(result.ruleMissing, false, 'Overseas rule missing durumu TR eksikliğinden etkilenmemeli');
});

test('TR Landed hücresi TR kuralı eksikliğini ayrı uyarı olarak gösterir', () => {
  const trBlockStart = APP.indexOf('}else if(c.trLanded){');
  const ydBlockStart = APP.indexOf('}else if(c.ydLanded){', trBlockStart);
  assert.ok(trBlockStart > -1 && ydBlockStart > trBlockStart);
  const trBlock = APP.slice(trBlockStart, ydBlockStart);
  assert.match(trBlock, /k\.trRuleMissing/);
  assert.match(trBlock, /kolTrLicenseRuleMissingText\(r\)/);
  assert.match(trBlock, /k\.trRoyaltyPct/);
  assert.match(trBlock, /k\.trHologramCost/);

  const ydBlockEnd = APP.indexOf('}else if(c.k===\'licensor\')', ydBlockStart);
  const ydBlock = APP.slice(ydBlockStart, ydBlockEnd);
  assert.match(ydBlock, /k\.ruleMissing/);
  assert.match(ydBlock, /kolLicenseRuleMissingText\(r\)/);
});

test('TR kuralı uyarısı kullanıcıyı Country Group = TR tanımına yönlendirir', () => {
  const start = APP.indexOf('function kolTrLicenseRuleMissingText(');
  const end = APP.indexOf('\n}\n', start);
  const block = APP.slice(start, end + 2);
  assert.match(block, /Country Group = TR/);
  assert.match(block, /TR Landed hesaplanmadı/);
  assert.match(block, /TR Landed is not calculated/);
});

test('mevcut Collection royalty seçimi satırın ülke grubunu kullanmaya devam eder', () => {
  const start = APP.indexOf('function kolFindPricingRule(row){');
  const end = APP.indexOf('\n}', start);
  const block = APP.slice(start, end + 2);
  assert.match(block, /kolFindPricingRuleForCountryGroup\(row,pricingCountryGroup\(ctx\.country\)\)/);
});
