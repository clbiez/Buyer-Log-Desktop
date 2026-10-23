'use strict';

/*
 * Üretici kartı motoru — sorumlu üretici kuralı, katı ad eşleşmesi, termin
 * performansı ve otomasyon alıcı bölmesi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/manufacturer-cards-engine.js');

const row = (extra = {}) => ({ Manufacturer: 'ABC TEKSTİL', 'Sub-Manufacturer': '', Licensor: '', License: '', 'Order Quantity': 1000, 'Order Code': 'O1', _isActive: true, ...extra });

test('non-DTR license orders are owned by the Sub-Manufacturer, never the licensor', () => {
  const nonDtr = engine.responsibleManufacturer(row({ Manufacturer: 'WARNER LICENSING', License: 'Batman', Licensor: 'WB', 'Sub-Manufacturer': 'XYZ ÖRME' }));
  assert.equal(nonDtr.name, 'XYZ ÖRME');
  assert.equal(nonDtr.source, 'subManufacturer');
  assert.equal(nonDtr.licensor, 'WARNER LICENSING');
  const missing = engine.responsibleManufacturer(row({ Manufacturer: 'WARNER LICENSING', License: 'Batman', Licensor: 'WB' }));
  assert.equal(missing.name, '');
  assert.equal(missing.issue, 'sub_manufacturer_missing');
  const dtr = engine.responsibleManufacturer(row({ License: 'Disney', Licensor: 'DTR', 'Sub-Manufacturer': 'ABC TEKSTİL' }));
  assert.equal(dtr.name, 'ABC TEKSTİL');
  assert.equal(dtr.source, 'manufacturer');
  assert.equal(engine.responsibleManufacturer(row()).name, 'ABC TEKSTİL');
  // LFL'in açık DTR/Non-DTR sınıfı lisansör türetimini geçersiz kılar.
  assert.equal(engine.responsibleManufacturer(row({ License: 'Disney', Licensor: 'DTR', 'DTR/Non-DTR': 'Non-DTR', 'Sub-Manufacturer': 'S1' })).name, 'S1');
});

test('name matching is strict apart from case, Turkish letters, punctuation and spacing', () => {
  assert.equal(engine.nameKey('ABC Tekstil San. ve Tic.'), engine.nameKey('abc tekstil san ve tic'));
  assert.equal(engine.nameKey('ELSIWA'), engine.nameKey('Elsıwa'));
  assert.notEqual(engine.nameKey('ABC TEKSTIL'), engine.nameKey('ABC TEKSTIL A.S.'));
  const suggestions = engine.suggestMatches('ABC Tekstil', ['ABC TEKSTIL SAN VE TIC AS', 'ZETA GIYIM']);
  assert.equal(suggestions[0].name, 'ABC TEKSTIL SAN VE TIC AS');
  assert.ok(!suggestions.some(item => item.name === 'ZETA GIYIM'));
});

test('cards aggregate volume, MAG, country, monthly loading and link status', () => {
  const rows = [
    row({ Country: 'Türkiye', 'Merch Alt Grup Kod': 'M1', 'FOB ($)': 5, 'Ex-factory': '2026-10-10', _asasExFactory: '2026-10-10' }),
    row({ 'Order Code': 'O2', Country: 'Türkiye', 'Merch Alt Grup Kod': 'M2', 'Order Quantity': 3000, 'Ex-factory': '2026-09-20', _asasExFactory: '2026-09-01', 'Buying Son Onay Tarihi': '2026-09-25', 'Shipment Quantity': 2900, _isActive: false }),
    row({ Manufacturer: 'LICENSOR CO', License: 'Batman', Licensor: 'WB', 'Sub-Manufacturer': 'abc tekstil', 'Order Code': 'O3', 'Order Quantity': 500 }),
    row({ Manufacturer: 'LICENSOR CO', License: 'Batman', Licensor: 'WB', 'Order Code': 'O4', 'Order Quantity': 700 }),
  ];
  const records = [
    { id: 'r1', manufacturer: 'ABC TEKSTİL', email: 'a@abc.com; b@abc.com' },
    { id: 'r2', manufacturer: 'Eski Üretici', email: '' },
  ];
  const result = engine.buildCards(rows, records, { today: '2026-10-04' });
  const card = result.cards.find(item => item.key === engine.nameKey('ABC TEKSTİL'));
  assert.equal(card.status, 'linked');
  assert.equal(card.orders, 3);
  assert.equal(card.quantity, 4500);
  assert.equal(card.licensedOrders, 1);
  assert.deepEqual(card.licensors.map(item => item.name), ['LICENSOR CO']);
  assert.deepEqual(card.mags.map(item => item.name), ['M2', 'M1']);
  assert.equal(card.countries[0].name, 'Türkiye');
  assert.equal(card.recipients.length, 2);
  assert.equal(card.monthly.find(item => item.month === '2026-09').loaded, 2900);
  assert.equal(card.monthly.find(item => item.month === '2026-10').planned, 1000);
  assert.equal(result.unassigned.rows, 1);
  assert.deepEqual(result.unassigned.orders, ['O4']);
  const manual = result.cards.find(item => item.name === 'Eski Üretici');
  assert.equal(manual.status, 'not_in_asas');
  assert.equal(result.stats.notInAsas, 1);
});

test('delivery performance separates approved revisions from real loading delay', () => {
  const base = { _isActive: false };
  const revised = engine.rowDelivery({ ...base, 'Initial Inspection': '2026-01-01', 'Ex-factory': '2026-01-15', 'Buying Son Onay Tarihi': '2026-01-20' }, Date.UTC(2026, 5, 1));
  assert.equal(revised.baseline, 'initialInspection');
  assert.equal(revised.revised, true);
  assert.equal(revised.revisionDays, 14);
  assert.equal(revised.delayDays, 19);
  assert.equal(revised.delayVsExFactory, 5);
  const fallback = engine.rowDelivery({ ...base, _asasExFactory: '2026-01-01', 'Ex-factory': '2026-01-01', 'Buying Son Onay Tarihi': '2025-12-30' }, Date.UTC(2026, 5, 1));
  assert.equal(fallback.baseline, 'asasExFactory');
  assert.equal(fallback.revised, false);
  assert.equal(fallback.delayDays, -2);
  const open = engine.rowDelivery({ _isActive: true, 'Ex-factory': '2026-05-01' }, Date.UTC(2026, 5, 1));
  assert.equal(open.openOverdueDays, 31);

  const rows = [1, 2, 3, 4].map(i => ({ Manufacturer: 'P', 'Order Code': `P${i}`, 'Order Quantity': 10, _isActive: false,
    'Initial Inspection': '2026-01-01', 'Ex-factory': i === 1 ? '2026-01-10' : '2026-01-01', 'Buying Son Onay Tarihi': i <= 2 ? '2026-01-12' : '2026-01-01' }));
  const perf = engine.buildCards(rows, [], { today: '2026-06-01' }).cards[0].performance;
  assert.equal(perf.loaded, 4);
  assert.equal(perf.onTime, 2);
  assert.equal(perf.revised, 1);
  assert.equal(perf.onTimeRate, 0.5);
  assert.equal(perf.revisionRate, 0.25);
  assert.equal(perf.avgDelayDays, 11);
  assert.ok(['C', 'D'].includes(perf.grade));
});

test('automation split routes each order to its responsible manufacturer card', () => {
  const book = [
    { id: 'g1', name: 'ABC TEKSTİL', aliases: ['ABC Old Name'], to: ['a@abc.com'] },
    { id: 'g2', name: 'NOMAIL', to: [] },
  ];
  const rows = [
    row(),
    row({ Manufacturer: 'abc old name', 'Order Code': 'O2' }),
    row({ Manufacturer: 'LIC', License: 'Batman', Licensor: 'WB', 'Sub-Manufacturer': 'ABC Tekstil', 'Order Code': 'O3' }),
    row({ Manufacturer: 'LIC', License: 'Batman', Licensor: 'WB', 'Order Code': 'O4' }),
    row({ Manufacturer: 'NOMAIL', 'Order Code': 'O5' }),
    row({ Manufacturer: 'UNKNOWN', 'Order Code': 'O6' }),
  ];
  const split = engine.splitRowsByResponsibleManufacturer(rows, book);
  assert.equal(split.resolved.length, 1);
  assert.equal(split.resolved[0].rows.length, 3);
  assert.deepEqual(split.unresolved.map(item => item.reason).sort(), ['no_card', 'no_email', 'sub_manufacturer_missing']);
  // Alternatif ad (eski yazım) aynı karta ve aynı e-postaya gider.
  const aliasSplit = engine.splitRowsByResponsibleManufacturer([row({ Manufacturer: 'ABC Old Name' })], book);
  assert.equal(aliasSplit.resolved[0].group.id, 'g1');
  assert.equal(engine.isManufacturerField('Üretici'), true);
  assert.equal(engine.isManufacturerField('Manufacturer'), true);
  assert.equal(engine.isManufacturerField('Sub-Manufacturer'), false);
});

test('a date pulled forward is not a revision and does not lower the grade', () => {
  const today = Date.UTC(2026, 5, 1);
  const forward = engine.rowDelivery({ _isActive: false, 'Initial Inspection': '2026-01-15', 'Ex-factory': '2026-01-10', 'Buying Son Onay Tarihi': '2026-01-10' }, today);
  assert.equal(forward.revised, false);
  assert.equal(forward.pulledForward, true);
  assert.equal(forward.revisionDays, -5);
  const rows = [1, 2, 3].map(i => ({ Manufacturer: 'F', 'Order Code': `F${i}`, 'Order Quantity': 10, _isActive: false,
    'Initial Inspection': '2026-01-15', 'Ex-factory': '2026-01-10', 'Buying Son Onay Tarihi': '2026-01-10' }));
  const perf = engine.buildCards(rows, [], { today: '2026-06-01' }).cards[0].performance;
  assert.equal(perf.revised, 0);
  assert.equal(perf.pulledForward, 3);
  assert.equal(perf.revisionRate, 0);
  assert.equal(perf.grade, 'A');
});


test('all Orders Manufacturer labels appear even when licensed Non-DTR rows belong to Sub-Manufacturer', () => {
  const raw = 'ŞAHİNLER TEKSTİL TİCARET A.Ş.';
  const rows = [
    row({ Manufacturer: raw, License: 'Licensed', Licensor: 'Brand', 'Sub-Manufacturer': '', 'Order Code': 'A' }),
    row({ Manufacturer: 'LICENSOR INC', License: 'Licensed', Licensor: 'Brand', 'Sub-Manufacturer': 'XYZ ÖRME', 'Order Code': 'B', 'Order Quantity': 200 }),
    row({ Manufacturer: 'licensor inc', License: 'Licensed', Licensor: 'Brand', 'Sub-Manufacturer': 'xyz örme', 'Order Code': 'C', 'Order Quantity': 300 }),
    row({ Manufacturer: 'DIRECT LTD', License: '', 'Order Code': 'D', 'Order Quantity': 400 }),
  ];
  const book = engine.buildCards(rows, [], { today: '2026-10-23' });
  const get = name => book.cards.find(item => item.key === engine.nameKey(name));
  assert.equal(book.stats.asasManufacturers, 4);
  assert.equal(get(raw).sourceOnly, true);
  assert.equal(get(raw).sourceRows, 1);
  assert.equal(get(raw).orders, 0);
  assert.ok(book.asasNames.includes(raw));
  assert.equal(get('LICENSOR INC').sourceRows, 2);
  assert.equal(get('LICENSOR INC').sourceOnly, true);
  assert.equal(get('LICENSOR INC').quantity, 0, 'source-name card cannot inherit sub-manufacturer volume');
  assert.equal(get('XYZ ÖRME').orders, 2);
  assert.equal(get('XYZ ÖRME').quantity, 500);
  assert.equal(get('DIRECT LTD').sourceOnly, false);
  assert.equal(get('DIRECT LTD').orders, 1);
  assert.equal(book.unassigned.rows, 1, 'missing sub-manufacturer remains unassigned');
  const split = engine.splitRowsByResponsibleManufacturer(rows, [
    { name: 'LICENSOR INC', to: ['wrong@example.test'] },
    { name: 'XYZ ÖRME', to: ['right@example.test'] },
  ]);
  assert.equal(split.resolved.length, 1);
  assert.equal(split.resolved[0].value, 'XYZ ÖRME');
  assert.equal(split.resolved[0].rows.length, 2);
  assert.ok(split.unresolved.some(item => item.reason === 'sub_manufacturer_missing'));
});

test('a manufacturer present in both responsible and source roles appears once with responsible-only stats', () => {
  const name = 'ŞAHİNLER TEKSTİL TİCARET A.Ş.';
  const rows = [
    row({ Manufacturer: name, License: 'License', Licensor: 'Licensor', 'Order Code': 'A', 'Sub-Manufacturer': '' }),
    row({ Manufacturer: name, License: '', 'Order Code': 'B', 'Order Quantity': 600 }),
  ];
  const book = engine.buildCards(rows, [], { today: '2026-10-23' });
  const found = book.cards.filter(item => item.key === engine.nameKey(name));
  assert.equal(found.length, 1);
  assert.equal(found[0].sourceOnly, false);
  assert.equal(found[0].sourceRows, 2);
  assert.equal(found[0].orders, 1);
  assert.equal(found[0].quantity, 600);
});
