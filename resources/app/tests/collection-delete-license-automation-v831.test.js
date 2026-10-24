'use strict';

/* v8.31 — Collection delete/duplicate confirmation and License Royalty
 * Calculations → Collection Licensor propagation.  The tests deliberately
 * keep the UI checks source-directed because app-main.js is browser-loaded;
 * the shared resolver is exercised as a real Node module.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PARSE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const db = require(path.join(ROOT, 'server', 'db.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0;
  let i = source.indexOf('(', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '(') paren += 1;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.ok(start >= 0, `${startText} bulunmalı`);
  const end = source.indexOf(endText, start);
  assert.ok(end >= 0, `${endText} bulunmalı`);
  return source.slice(start, end);
}

test('License Royalty resolver latest valid date group içindeki distinct licensor değerlerini exact eşleşmeyle döndürür', () => {
  const rules = require(path.join(ROOT, 'public', 'business-rules.js'));
  assert.equal(typeof rules.resolveLatestLicensorsForLicense, 'function');

  const result = rules.resolveLatestLicensorsForLicense('  marvel  ', [
    { id: 'old', license: 'Marvel', licensor: 'Old Owner', opdStart: '2025-01-01', opdEnd: '2025-12-31' },
    { id: 'new-a', license: 'MARVEL', licensor: ' Disney ', opdStart: '2026-08-20', opdEnd: '2026-12-31' },
    { id: 'new-b', license: 'Marvel', licensor: 'Hasbro', opdStart: '2026-08-20', opdEnd: '2026-12-31' },
    { id: 'new-c', license: 'Marvel', licensor: 'disney', opdStart: '2026-08-20', opdEnd: '2026-12-31' },
    { id: 'blank', license: 'Marvel', licensor: '   ', opdStart: '2026-08-20', opdEnd: '2026-12-31' },
    { id: 'fuzzy', license: 'Marvel Classic', licensor: 'Wrong Owner', opdStart: '2030-01-01', opdEnd: '2030-12-31' },
    { id: 'invalid', license: 'Marvel', licensor: 'Invalid Date', opdStart: 'not-a-date', opdEnd: 'also-not-a-date' },
  ]);

  assert.deepEqual(result.licensors, ['Disney', 'Hasbro']);
  // Birden cok distinct Licensor belirsizliktir: 'Disney/Hasbro' gibi birlesik bir
  // deger uretilmez, otomatik atama durur (license-licensor-ambiguity-fob-guard).
  assert.equal(result.ambiguous, true);
  assert.equal(result.displayValue, '');
  assert.equal(result.licensorsLabel, 'Disney / Hasbro');
  assert.equal(result.latestDate, '2026-08-20');
});

test('Collection action confirmation stable ID snapshot ve ortak modal/table primitive kullanır', () => {
  const duplicate = bodyOf(APP, 'duplicateKolSelectedRows');
  const deleteBlock = bodyOf(APP, 'deleteKolSelectedRows');
  const confirmation = bodyOf(APP, 'openKolSelectedActionConfirmation');

  for (const body of [duplicate, deleteBlock]) {
    assert.match(body, /kolSelectedRowsSnapshot/);
    assert.match(body, /openKolSelectedActionConfirmation/);
    assert.match(body, /kolSelectedActionState/);
  }
  assert.match(confirmation, /modalCard verHistCard/);
  assert.match(confirmation, /plmImportTable/);
  for (const field of ['Model Name', 'PLM ID', 'Colour', 'Product Main Definition', 'Category', 'Buying Sample', 'Season']) {
    assert.match(confirmation, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(APP, /kolRows\.filter\(row=>snapshot\.has\(row\.id\)\)/);
  assert.match(APP, /kolSelectedActionState='confirming'/);
  assert.match(APP, /kolSelectedActionState='processing'/);
});

test('Collection selection button state geçerli ID ve operation lifecycle üzerinden delete/duplicate durumunu türetir', () => {
  const stateBody = bodyOf(APP, 'updateKolSendBtnState');
  assert.match(stateBody, /kolValidSelectedRows/);
  assert.match(stateBody, /kolDelRowBtn/);
  assert.match(stateBody, /kolSelectedActionState==='idle'/);
  assert.match(stateBody, /validSelectionCount/);
  assert.match(APP, /kolSelected\.delete\(id\)/);
  assert.match(APP, /finally\{[\s\S]*kolSelectedActionState='idle'/);
});

test('License edit exact resolver ile auto Licensor üretir; manual override korunur', () => {
  const commit = bodyOf(APP, 'commitKolEditor');
  assert.match(commit, /k==='lisans'/);
  assert.match(commit, /kolApplyLicensorFromLicense\(row\)/);
  assert.match(commit, /row\._licensorManual=true/);
  assert.match(APP, /_licensorAuto/);
  assert.match(APP, /resolveLatestLicensorsForLicense/);
  assert.match(APP, /kolSyncLicensorsFromRules/);
});

test('Collection auto Licensor license değişiminde güncellenir, clear ile temizlenir, manual değer ezilmez', () => {
  const body = bodyOf(APP, 'kolApplyLicensorFromLicense');
  const apply = new Function('norm', 'turknorm', 'editableValuesEqual', 'kolAutoLicensorState', `return function kolApplyLicensorFromLicense(row){${body}};`)(
    value => String(value == null ? '' : value).trim(),
    value => String(value == null ? '' : value).toUpperCase().replace(/\s+/g, ' ').trim(),
    (left, right) => String(left == null ? '' : left) === String(right == null ? '' : right),
    row => ({displayValue: row && row.lisans === 'Marvel' ? 'Disney' : ''}),
  );
  const auto = {lisans: 'Marvel', licensor: 'Old', _licensorAuto: true};
  assert.equal(apply(auto), true);
  assert.equal(auto.licensor, 'Disney');
  auto.lisans = '';
  assert.equal(apply(auto), true);
  assert.equal(auto.licensor, '');
  const manual = {lisans: 'Marvel', licensor: 'Manual Owner', _licensorManual: true};
  assert.equal(apply(manual), false);
  assert.equal(manual.licensor, 'Manual Owner');
});

test('Pricing rules değişikliği canlı istemcilere revision sinyali gönderir ve loaded consumer tablolarını günceller', () => {
  const pricingPut = between(SERVER, "app.put('/api/pricing-rules'", "const normalizeTransitDelType");
  assert.match(pricingPut, /publishSharedMasterChange\('pricingRules', req, \{ revision: saved\.revision, changedLicenses \}\)/);
  assert.match(APP, /payload\.area==='pricingRules'/);
  assert.match(APP, /refreshPricingRulesFromServer/);
  const loadedRows = bodyOf(APP, 'applyPricingRulesToLoadedRows');
  assert.match(loadedRows, /state\.cp&&state\.cp\.rows/);
  assert.match(loadedRows, /state\.orders&&state\.orders\.rows/);
  assert.match(loadedRows, /state\.orderSummary&&state\.orderSummary\.rows/);
});

test('Server pricing calculation row Licensor alanını kullanır; Manufacturer ile yanlış join yapılmaz', () => {
  assert.match(PARSE, /calculateSuppFobByRule\(fobRounded, o\.opd, o\.countryRaw, o\.season, licensor, o\.license, ov\.pricingRules, ov\.licensorMerges\)/);
  assert.doesNotMatch(PARSE, /calculateSuppFobByRule\(fobRounded, o\.opd, o\.countryRaw, o\.season, o\.manufacturer, o\.license, ov\.pricingRules(?:, ov\.licensorMerges)?\)/);
});

test('Pricing source update CP projectionındaki auto Licensor değerini latest grup ile değiştirir', () => {
  const order = {
    ocode: 7301, model: 'MODEL A', ccode: 'C01', colour: 'BLACK', license: 'Marvel',
    manufacturer: 'Factory A', season: 'W7', countryRaw: 'TURKIYE', buyerGrup: 'LISANS',
    merch: 'CU4E', category: 'T-Shirt', qty: 10, kalan: 10, fob: 5, antrepo: 0,
    merkezSevkeHazirKalan: 0, opd: new Date(2026, 0, 1), ex: new Date(2026, 6, 1),
    retail: new Date(2026, 7, 1), mb: new Date(2026, 7, 15), plm: 101,
  };
  const base = [
    { id: 'disney-old', license: 'Marvel', licensor: 'Disney', opdStart: '2026-08-20', opdEnd: '2026-12-31', countryGroup: 'TR', royalty: 10, hologramCost: 0 },
    { id: 'disney-old-2', license: 'Marvel', licensor: 'Disney', opdStart: '2026-08-20', opdEnd: '2026-12-31', countryGroup: 'NON-TR', royalty: 10, hologramCost: 0 },
  ];
  const options = {...db.defaultOverrides(), nonDtrManufacturers: ['Factory A'], pricingRules: base};
  // Ayni Licensor icin birden cok kural tek gecerli degeri bozmaz.
  assert.equal(parse.buildCPRowsFromASAS([order], {}, options)[0].Licensor, 'Disney');
  assert.equal(parse.buildOrdersRowsFromASAS([order], {}, options)[0].Licensor, 'Disney');
  assert.equal(parse.buildOrderSummaryRowsFromASAS([order], {}, options)[0].Licensor, 'Disney');
  assert.equal(parse.buildOverviewSummaryRowsFromASAS([order], options)[0].Licensor, 'Disney');
  // Daha yeni tarih grubu latest secimini degistirir.
  const sonyRule = { id: 'sony-new', license: 'Marvel', licensor: 'Sony', opdStart: '2026-09-01', opdEnd: '2026-12-31', countryGroup: 'TR', royalty: 10, hologramCost: 0 };
  const updated = [...base, sonyRule];
  assert.equal(parse.buildCPRowsFromASAS([order], {}, {...options, pricingRules: updated})[0].Licensor, 'Sony');
  assert.equal(parse.buildOrderSummaryRowsFromASAS([order], {}, {...options, pricingRules: updated})[0].Licensor, 'Sony');
  // Latest grupta birden cok distinct Licensor varsa projeksiyon BOS kalir.
  const ambiguous = [...updated, { id: 'hasbro-new', license: 'Marvel', licensor: 'Hasbro', opdStart: '2026-09-01', opdEnd: '2026-12-31', countryGroup: 'TR', royalty: 10, hologramCost: 0 }];
  assert.equal(parse.buildCPRowsFromASAS([order], {}, {...options, pricingRules: ambiguous})[0].Licensor, '');
  assert.equal(parse.buildOrderSummaryRowsFromASAS([order], {}, {...options, pricingRules: ambiguous})[0].Licensor, '');
});
