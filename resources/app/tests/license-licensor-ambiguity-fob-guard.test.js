'use strict';

/* DTR / NON-DTR Licensor belirsizligi ve FOB guard sozlesmesi.
 *
 * Bir License icin birden cok DISTINCT Licensor gecerliyse (ornegin DTR ve Y)
 * sonuc "DTR/Y" gibi birlesik bir degere INDIRGENMEZ. Belirsizlik cozulmeden
 * otomatik royalty/FOB hesaplanmaz; kullanicidan acik Licensor secimi beklenir.
 * Ayni Licensor'i gosteren birden cok kural belirsizlik sayilmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const rules = require(path.join(ROOT, 'public', 'business-rules.js'));
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const db = require(path.join(ROOT, 'server', 'db.js'));

function bodyOf(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' bulunmali');
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(name + ' ayristirilamadi');
}

const RANGE = { opdStart: '2026-01-01', opdEnd: '2026-12-31', countryGroup: 'TR', royalty: 0, hologramCost: 0 };
const DTR_RULE = { id: 'r-dtr', license: 'Marvel', licensor: 'DTR', ...RANGE };
const Y_RULE = { id: 'r-y', license: 'Marvel', licensor: 'Y', ...RANGE };

function orderFixture(extra) {
  return {
    ocode: 7401, model: 'MODEL A', ccode: 'C01', colour: 'BLACK', license: 'Marvel',
    manufacturer: 'Factory A', season: 'W7', countryRaw: 'TURKIYE', buyerGrup: 'LISANS',
    merch: 'CU4E', category: 'T-Shirt', qty: 10, kalan: 10, fob: 5, antrepo: 0,
    merkezSevkeHazirKalan: 0, opd: new Date(2026, 0, 1), ex: new Date(2026, 6, 1),
    retail: new Date(2026, 7, 1), mb: new Date(2026, 7, 15), plm: 201,
    ...(extra || {}),
  };
}
function cpRow(pricingRules, extraOverrides) {
  const options = { ...db.defaultOverrides(), pricingRules, ...(extraOverrides || {}) };
  return parse.buildCPRowsFromASAS([orderFixture()], {}, options)[0];
}

test('Tek gecerli Licensor otomatik cozulur, birden cok gecerli Licensor belirsizdir', () => {
  const single = rules.resolveLicenseLicensor('Marvel', [DTR_RULE]);
  assert.equal(single.status, 'resolved');
  assert.equal(single.displayValue, 'DTR');

  const ambiguous = rules.resolveLicenseLicensor('Marvel', [DTR_RULE, Y_RULE]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.licensors, ['DTR', 'Y']);
  // Birlesik deger URETILMEZ: ne 'DTR/Y', ne 'DTR', ne 'Y'.
  assert.equal(ambiguous.displayValue, '');
  assert.equal(ambiguous.licensorsLabel, 'DTR / Y');
  assert.equal(rules.isUnresolvedLicensorStatus(ambiguous.status), true);
});

test('Ayni Licensor icin birden cok kural sahte belirsizlik uretmez', () => {
  const duplicate = rules.resolveLicenseLicensor('Marvel', [
    DTR_RULE,
    { ...DTR_RULE, id: 'r-dtr-2' },
    { ...DTR_RULE, id: 'r-dtr-3', licensor: 'dtr' },
  ]);
  assert.equal(duplicate.status, 'resolved');
  assert.equal(duplicate.displayValue, 'DTR');
  assert.equal(duplicate.ambiguous, false);
});

test('NON-DTR MANUFACTURERS listesindeki uretici otomatik DTR almaz', () => {
  const clean = rules.resolveAutoLicensor('Marvel', [DTR_RULE], {
    manufacturer: 'Factory A', nonDtrManufacturers: ['Listed Factory'],
  });
  assert.equal(clean.status, 'resolved');
  assert.equal(clean.displayValue, 'DTR');

  const conflict = rules.resolveAutoLicensor('Marvel', [DTR_RULE], {
    manufacturer: 'Listed Factory', nonDtrManufacturers: ['Listed Factory'],
  });
  assert.equal(conflict.status, 'manufacturer-conflict');
  assert.equal(conflict.displayValue, '');
  assert.equal(rules.isUnresolvedLicensorStatus(conflict.status), true);
});

test('Belirsiz Licensor server projeksiyonunda DTR benzeri komisyonsuz FOB uretmez', () => {
  const resolved = cpRow([DTR_RULE]);
  assert.equal(resolved.Licensor, 'DTR');
  assert.equal(resolved['Supp. FOB'], 5);

  const ambiguous = cpRow([DTR_RULE, Y_RULE]);
  assert.equal(ambiguous.Licensor, '');
  assert.equal(ambiguous['Supp. FOB'], null);
  // DTR'ye ozgu Sub-Manufacturer otomasyonu da belirsizlikte tetiklenmez.
  assert.notEqual(ambiguous['Sub-Manufacturer'], 'Factory A');
});

test('Gecerli manuel Licensor secimi otomatik cikarimin ustundedir', () => {
  const manual = cpRow([DTR_RULE, Y_RULE], { licensormap: { 7401: 'Y' } });
  assert.equal(manual.Licensor, 'Y');
  assert.equal(manual._licensorManual, true);
});

test('Belirsizlik acik manuel Supp. FOB degerini bozmaz', () => {
  const manualFob = cpRow([DTR_RULE, Y_RULE], { suppfobmap: { 7401: 9.99 } });
  assert.equal(manualFob['Supp. FOB'], 9.99);
  assert.equal(manualFob._suppFobManual, true);
});

test('Koleksiyon tarafi belirsizlikte otomatik Licensor yazmaz ve FOB hesaplamaz', () => {
  const apply = bodyOf(APP, 'kolApplyLicensorFromLicense');
  // Manuel secim her zaman once gelir, otomatik deger yalnizca auto-state'ten uretilir.
  assert.ok(apply.includes('row._licensorManual===true)return false'), 'manuel secim korunmali');
  assert.ok(apply.includes('kolAutoLicensorState(row).displayValue'), 'otomatik deger auto-state uzerinden gelmeli');

  const pricing = bodyOf(APP, 'kolApplyRulePricing');
  assert.ok(pricing.includes('kolLicensorUnresolvedState(row)'), 'belirsizlik FOB hesabini durdurmali');

  const unresolved = bodyOf(APP, 'kolLicensorUnresolvedState');
  // Dolu Licensor (otomatik ya da manuel secim) belirsizligi bitirir.
  assert.ok(unresolved.includes("norm(row.licensor))return null"), 'secilmis Licensor belirsizligi bitirmeli');

  const ruleMissing = bodyOf(APP, 'kolLicenseRuleMissing');
  assert.ok(ruleMissing.includes('kolLicensorUnresolvedState(row)'), 'landed hesabi da belirsizlikte durmali');

  const autoState = bodyOf(APP, 'kolAutoLicensorState');
  assert.ok(autoState.includes('nonDtrManufacturers'), 'NON-DTR uretici vetosu auto-state icinde olmali');
});
