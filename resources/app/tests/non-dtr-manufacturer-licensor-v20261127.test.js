'use strict';
// Non-DTR üretici, lisansörün kendi (TR) carisidir: siparişteki üretici Licensor'ı belirler
// ve Lisans Kartları'nda lisansörle birleştirilebilir (TR/YD cari farkı).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../public/business-rules');
const E = require('../public/license-cards-engine');
const cards = require('../server/lib/license-cards');
const parse = require('../server/lib/parse');
const db = require('../server/db');

const FAN_TR = 'FAN MANİA DIŞ TİCARET LİMİTED ŞİRKETİ', FAN_YD = 'Fan Mania General Trading L.L.C';
const ERMODA_TR = 'ERMODA TEKSTİL KONFEKSİYON SAN. TİC. LTD. ŞTİ.';
const netflix = [
  { id: 'n1', license: 'Netflix', licensor: 'FAN MANIA', opdStart: '2026-01-01', royalty: 21 },
  { id: 'n2', license: 'Netflix', licensor: FAN_YD, opdStart: '2026-01-01', royalty: 21 },
];
const realMadrid = [
  { id: 'r1', license: 'Real Madrid', licensor: 'ERMODA', opdStart: '2026-01-01', royalty: 18 },
  { id: 'r2', license: 'Real Madrid', licensor: 'DTR', opdStart: '2026-01-01', royalty: 0 },
];
const manual = (source, target, split = false) => ({ entries: { 'm:x': { source, target, split, at: '2026-11-27T10:00:00Z' } } });

test('Non-DTR manufacturer resolves an ambiguous license to its own licensor', () => {
  const opts = { manufacturer: FAN_TR, nonDtrManufacturers: [FAN_TR] };
  // Before: two licensor accounts in the latest contract group → ambiguous, Licensor blank.
  assert.equal(B.resolveAutoLicensor('Netflix', netflix, opts).status, 'ambiguous');
  const own = B.resolveOrderLicensor('Netflix', netflix, opts);
  assert.equal(own.status, 'resolved');
  assert.equal(own.displayValue, 'FAN MANIA');
  // A manual TR↔YD link keeps one company: the chosen name stays deterministic.
  assert.equal(B.resolveOrderLicensor('Netflix', [...netflix].reverse(), { ...opts, licensorMerges: manual(FAN_YD, 'FAN MANIA') }).displayValue, 'FAN MANIA');
  // DTR in the latest group and a Non-DTR manufacturer of the other licensor.
  const ermoda = B.resolveOrderLicensor('Real Madrid', realMadrid, { manufacturer: ERMODA_TR, nonDtrManufacturers: [ERMODA_TR] });
  assert.equal(ermoda.displayValue, 'ERMODA');
  assert.equal(ermoda.status, 'resolved');
  // Latest contract is DTR only (manufacturer conflict) but the manufacturer has its own older contract.
  const moved = [{ ...realMadrid[0], opdStart: '2025-01-01', opdEnd: '2025-12-31' }, { ...realMadrid[1], opdStart: '2026-01-01' }];
  assert.equal(B.resolveAutoLicensor('Real Madrid', moved, { manufacturer: ERMODA_TR, nonDtrManufacturers: [ERMODA_TR] }).status, 'manufacturer-conflict');
  assert.equal(B.resolveOrderLicensor('Real Madrid', moved, { manufacturer: ERMODA_TR, nonDtrManufacturers: [ERMODA_TR] }).displayValue, 'ERMODA');
  // Only the YD account has a contract for this license: ERMODA ≡ ERMODA UK LTD (automatic group)
  // and ERMODA matches the manufacturer, so the YD account is the same company.
  const naruto = [...realMadrid, { license: 'Naruto', licensor: 'ERMODA UK LTD', opdStart: '2026-01-01' }, { license: 'Naruto', licensor: 'ULUPINAR', opdStart: '2026-01-01' }];
  assert.equal(B.resolveOrderLicensor('Naruto', naruto, { manufacturer: ERMODA_TR, nonDtrManufacturers: [ERMODA_TR] }).displayValue, 'ERMODA UK LTD');
  assert.equal(B.resolveOrderLicensor('Naruto', naruto, { manufacturer: ERMODA_TR, nonDtrManufacturers: [ERMODA_TR], licensorMerges: { entries: { ERMODA: { split: true } } } }).status, 'ambiguous', 'a split automatic group is respected');
});

test('manual merge links a manufacturer whose name does not start with the licensor', () => {
  const maker = 'MİR MODA TEKSTİL İTHALAT', rules = [{ license: 'Smiley', licensor: 'OLGA', opdStart: '2026-01-01' }, { license: 'Smiley', licensor: 'ŞAHİNLER', opdStart: '2026-01-01' }];
  const opts = { manufacturer: maker, nonDtrManufacturers: [maker] };
  assert.equal(B.resolveOrderLicensor('Smiley', rules, opts).status, 'ambiguous');
  assert.equal(B.resolveOrderLicensor('Smiley', rules, { ...opts, licensorMerges: manual(maker, 'OLGA') }).displayValue, 'OLGA');
  assert.equal(B.resolveOrderLicensor('Smiley', rules, { ...opts, licensorMerges: manual(maker, 'OLGA', true) }).status, 'ambiguous', 'a split link is no longer used');
});

test('no guessing: unrelated, DTR-listed or two-company matches keep the existing result', () => {
  // Manufacturer not on the Non-DTR list → DTR classification is unchanged.
  assert.equal(B.resolveOrderLicensor('Real Madrid', realMadrid, { manufacturer: ERMODA_TR, nonDtrManufacturers: [] }).displayValue, 'DTR');
  // Unrelated Non-DTR manufacturer stays ambiguous.
  assert.equal(B.resolveOrderLicensor('Netflix', netflix, { manufacturer: 'TAHA GİYİM', nonDtrManufacturers: ['TAHA GİYİM'] }).status, 'ambiguous');
  // Two distinct companies both linked to the manufacturer → not resolved by the manufacturer.
  const two = [{ license: 'X', licensor: 'ALFA', opdStart: '2026-01-01' }, { license: 'X', licensor: 'ALFA BETA', opdStart: '2026-01-01' }];
  const maker = 'ALFA BETA TEKSTİL';
  assert.equal(B.resolveOrderLicensor('X', two, { manufacturer: maker, nonDtrManufacturers: [maker] }).status, 'ambiguous');
  // DTR is never derived from a manufacturer; a short/one-letter name never prefix-matches.
  assert.equal(B.manufacturerMatchesLicensor('DTR TEKSTİL', 'DTR'), false);
  assert.equal(B.manufacturerMatchesLicensor('AB TEKSTİL', 'AB'), false);
  assert.equal(B.manufacturerMatchesLicensor('FASHION UK TURKEY TEKSTİL', 'FASHION UK'), true);
  assert.equal(B.manufacturerMatchesLicensor('FASHION TURKEY TEKSTİL', 'FASHION UK'), false, 'country words are part of the licensor name');
});

test('server CP, Orders and Backlog use the manufacturer and the stored merges', () => {
  const order = { ocode: 1410676, model: 'Demo', ccode: 'RED', colour: 'Red', license: 'Netflix', manufacturer: FAN_TR, season: 'W6', countryRaw: 'TURKIYE', buyerGrup: 'LISANS', merch: 'CUW4', qty: 10, kalan: 10, fob: 5, opd: new Date(2026, 5, 1), ex: new Date(2026, 6, 1), retail: new Date(2026, 7, 1), mb: new Date(2026, 8, 1) };
  const overrides = { ...db.defaultOverrides(), pricingRules: netflix, nonDtrManufacturers: [FAN_TR], licensorMerges: manual(FAN_YD, 'FAN MANIA') };
  for (const build of [parse.buildCPRowsFromASAS, parse.buildOrdersRowsFromASAS, parse.buildOrderSummaryRowsFromASAS]) {
    assert.equal(build([order], {}, overrides)[0].Licensor, 'FAN MANIA');
    assert.equal(build([order], {}, { ...overrides, licensormap: { 1410676: FAN_YD } })[0].Licensor, FAN_YD, 'manual order choice wins');
  }
  // Manual-only link (no shared name prefix) is read from overrides.licensorMerges on the server.
  const maker = 'MİR MODA TEKSTİL', olga = [{ license: 'Smiley', licensor: 'OLGA', opdStart: '2026-01-01' }, { license: 'Smiley', licensor: 'ŞAHİNLER', opdStart: '2026-01-01' }];
  const linked = { ...db.defaultOverrides(), pricingRules: olga, nonDtrManufacturers: [maker], licensorMerges: manual(maker, 'OLGA') };
  assert.equal(parse.buildCPRowsFromASAS([{ ...order, license: 'Smiley', manufacturer: maker }], {}, linked)[0].Licensor, 'OLGA');
});

test('browser order rows receive manual merge entries and pass them to the resolver', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const context = { window: { BLBusinessRules: B }, state: { licensorMerges: { split: [] }, overrides: { pricingRules: netflix, nonDtrManufacturers: [FAN_TR] } }, norm: v => String(v ?? '').trim(), editableValuesEqual: (a, b) => a === b };
  vm.createContext(context);
  vm.runInContext(block('function applyLicensorMerges(', 'function applyIncomingPricingRules('), context);
  vm.runInContext(block('function licenseLicensorStateForRow(', 'function licenseLicensorWarningText('), context);
  const merges = manual('MİR MODA', 'OLGA');
  assert.equal(context.applyLicensorMerges({ split: [], entries: merges.entries }), true);
  assert.deepEqual(context.state.licensorMerges.entries, merges.entries, 'manual links are kept, not reduced to split');
  assert.equal(context.applyLicensorMerges({ split: [], entries: merges.entries }), false);
  context.state.overrides.pricingRules = [{ license: 'Smiley', licensor: 'OLGA', opdStart: '2026-01-01' }, { license: 'Smiley', licensor: 'ŞAHİNLER', opdStart: '2026-01-01' }];
  context.state.overrides.nonDtrManufacturers = ['MİR MODA'];
  assert.equal(context.licenseLicensorStateForRow({ License: 'Smiley', Manufacturer: 'MİR MODA' }).displayValue, 'OLGA');
  // Server payloads carry entries, not just split.
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.equal(/licensorMerges: \{ split: require\('\.\/lib\/license-cards'\)\.licensorMergesOf\([a-z]+\)\.split \}/.test(server), false);
});

test('License Cards offers Non-DTR manufacturers as merge partners and accepts them', () => {
  const base = { _revisions: { licenseCards: 1, pricingRules: 1 }, licenseCards: { initialized: true, items: [
    { id: cards.cardId('Real Madrid', 'ERMODA'), license: 'Real Madrid', licensor: 'ERMODA' },
    { id: cards.cardId('Naruto', 'ERMODA UK LTD'), license: 'Naruto', licensor: 'ERMODA UK LTD' },
  ] }, pricingRules: [] };
  assert.throws(() => cards.setLicensorMerge(base, { source: ERMODA_TR, target: 'ERMODA', split: false }), { code: 'LICENSE_MERGE_INVALID' });
  const joined = cards.setLicensorMerge(base, { source: ERMODA_TR, target: 'ERMODA', split: false }, '2026-11-27T10:00:00Z', { manufacturers: [ERMODA_TR] });
  // ERMODA TEKSTİL ≡ ERMODA ≡ ERMODA UK LTD (automatic suffix group).
  assert.equal(B.licensorsMerged(ERMODA_TR, 'ERMODA UK LTD', joined.overrides.licensorMerges), true);
  const response = cards.responseOf(joined.overrides, true, { manufacturers: [ERMODA_TR, 'ERMODA'] });
  assert.deepEqual([...response.nonDtrManufacturers].sort(), ['ERMODA', ERMODA_TR].sort());
  const licensors = E.licensorOptions(response.cards);
  assert.deepEqual(E.manufacturerOptions(response.nonDtrManufacturers, licensors).map(o => o.label), [ERMODA_TR], 'a name that is already a licensor is listed once');
  assert.deepEqual(cards.responseOf(base, false).nonDtrManufacturers, []);
  const ui = fs.readFileSync(path.join(__dirname, '../public/license-cards.js'), 'utf8');
  assert.match(ui, /T\('Non-DTR üreticiler','Non-DTR manufacturers'\)/);
});
