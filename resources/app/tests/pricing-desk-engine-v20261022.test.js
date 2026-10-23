'use strict';

/* Fiyat Masası saf motoru (v2026-10-22): matris, en iyi teklif, olağan dışı
   fiyat uyarısı, toplu onay adayı, pazarlık turları, geçmiş serileri ve
   klasman × üretici analizi. Motor kayıtları değiştirmez; yalnız okur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'public', 'pricing-desk-engine.js'));

const offer = (id, price, at, round = 1, by = 'u') => ({ id, type: 'offer', price, at, round, by, byName: by });
const request = () => ({
  id: 'q1', createdAt: '2026-10-12T08:00:00.000Z', updatedAt: '2026-10-19T08:00:00.000Z', ownerId: 'o', ownerName: 'Owner', round: 3,
  rounds: [{ n: 2, at: '2026-10-16T08:00:00.000Z', byName: 'Owner', note: 'Karşı teklif' }, { n: 3, at: '2026-10-19T08:00:00.000Z', byName: 'Owner', note: '' }],
  manufacturers: [{ name: 'Üretici A' }, { name: 'Üretici B' }, { name: 'Üretici C' }],
  items: [
    { id: 'a1', modelKey: 'kol:1', manufacturer: 'Üretici A', price: '9,45', history: [offer('e1', '9,80', '2026-10-12T09:00:00.000Z'), offer('e2', '9,45', '2026-10-16T09:00:00.000Z', 2)] },
    { id: 'b1', modelKey: 'kol:1', manufacturer: 'Üretici B', price: '8,90', approved: true, history: [offer('e3', '9,40', '2026-10-12T09:01:00.000Z'), offer('e4', '9,05', '2026-10-16T09:01:00.000Z', 2), offer('e5', '8,90', '2026-10-19T09:00:00.000Z', 3)] },
    { id: 'c1', modelKey: 'kol:1', manufacturer: 'Üretici C', price: '9,10', history: [] },
    { id: 'a2', modelKey: 'kol:2', manufacturer: 'Üretici A', price: '95', history: [] },
    { id: 'b2', modelKey: 'kol:2', manufacturer: 'Üretici B', price: '9,60', history: [] },
    { id: 'c2', modelKey: 'kol:2', manufacturer: 'Üretici C', price: '9,40', history: [] },
    { id: 'a3', modelKey: 'kol:3', manufacturer: 'Üretici A', price: '', history: [] },
  ],
});

test('para metinleri tek kurala göre okunur', () => {
  assert.equal(E.price('9,45'), 9.45);
  assert.equal(E.price('$1.234,50'), 1234.5);
  assert.equal(E.price('1,234.50'), 1234.5);
  assert.equal(E.price(''), null);
  assert.equal(E.price('0'), null);
});

test('matris modelleri ve üreticileri talep sırasıyla kurar', () => {
  const matrix = E.requestMatrix(request());
  assert.deepEqual(matrix.manufacturers, ['Üretici A', 'Üretici B', 'Üretici C']);
  assert.deepEqual(matrix.models.map(model => model.modelKey), ['kol:1', 'kol:2', 'kol:3']);
  assert.equal(matrix.models[0].cell('üretici b').id, 'b1', 'üretici adı büyük/küçük harf duyarsız eşleşir');
  assert.equal(matrix.models[2].cell('Üretici B'), null);
});

test('satır istatistiği en iyiyi, onaylıyı ve medyanın 3 katı dışındaki fiyatı bulur', () => {
  const matrix = E.requestMatrix(request());
  const first = E.rowStats(matrix.models[0].lines);
  assert.equal(first.best.manufacturer, 'Üretici B');
  assert.equal(first.best.price, 8.9);
  assert.equal(first.approved.lineId, 'b1');
  assert.equal(first.outliers.size, 0);
  const second = E.rowStats(matrix.models[1].lines);
  assert.ok(second.outliers.has('a2'), '95, 9,60/9,40 yanında olağan dışıdır');
  assert.equal(second.best.price, 9.4, 'olağan dışı değer en iyi seçimini bozmaz çünkü en düşük değil');
  assert.ok(E.outlierRatio('94', matrix.models[1].lines) >= 3);
  assert.equal(E.outlierRatio('9,50', matrix.models[1].lines), null);
});

test('drop edilen satır en iyi teklif hesabına girmez', () => {
  const lines = [{ id: 'x', manufacturer: 'A', price: '5' , dropped: true }, { id: 'y', manufacturer: 'B', price: '6' }];
  assert.equal(E.rowStats(lines).best.lineId, 'y');
});

test('toplu onay yalnız onaysız ve hedefin altındaki en iyi teklifi önerir', () => {
  const req = request();
  const targets = { 'kol:1': 9.2, 'kol:2': 9.5, 'kol:3': 7 };
  const candidates = E.bulkApproveCandidates(req, item => targets[item.modelKey]);
  assert.deepEqual(candidates.map(item => [item.modelKey, item.manufacturer, item.price]), [['kol:2', 'Üretici C', 9.4]]);
  assert.ok(candidates[0].deltaPct < 0);
});

test('turlar defter olaylarından kurulur; eski satır legacy teklif olarak 1. tura düşer', () => {
  const list = E.rounds(request());
  assert.deepEqual(list.map(round => round.n), [1, 2, 3]);
  assert.equal(list[1].note, 'Karşı teklif');
  const round2 = list[1].offers.find(item => item.lineId === 'b1');
  assert.equal(round2.price, 9.05);
  assert.equal(round2.previous, 9.4, 'önceki tur fiyatı korunur (üstü çizili gösterilir)');
  assert.ok(list[0].offers.some(item => item.lineId === 'c1' && item.source === 'legacy'));
});

test('pazarlık özeti ve talep kazancı ilk tur → güncel fiyatı ölçer', () => {
  const req = request();
  const summary = E.negotiation(req.items[1], req);
  assert.equal(summary.first, 9.4);
  assert.equal(summary.last, 8.9);
  assert.equal(summary.rounds, 3);
  const gain = E.requestGain(req);
  assert.ok(gain.gainPct < 0, 'pazarlık fiyatı düşürdü');
});

test('durum şeridi ve cevap oranları talepten türetilir', () => {
  const req = request();
  assert.equal(E.lane(req), 'compare');
  assert.equal(E.lane({ status: 'closed', items: [] }), 'closed');
  assert.equal(E.lane({ items: [{ modelKey: 'm', manufacturer: 'A', price: '' }] }), 'waiting');
  assert.equal(E.lane({ items: [{ modelKey: 'm', manufacturer: 'A', price: '5', approved: true }] }), 'approved');
  const rates = E.responseRates(req);
  assert.deepEqual(rates.find(item => item.name === 'Üretici A'), { name: 'Üretici A', total: 3, priced: 2, approved: 0, rate: 2 / 3 });
});

test('geçmiş serileri model ve üretici başına zamana göre sıralanır', () => {
  const events = [
    { identityKey: 'm1', model: 'KOL-1', manufacturer: 'A', value: 10, at: '2026-02-01' },
    { identityKey: 'm1', model: 'KOL-1', manufacturer: 'A', value: 9, at: '2026-03-01' },
    { identityKey: 'm1', model: 'KOL-1', manufacturer: 'B', value: 9.5, at: '2026-02-02' },
    { identityKey: 'm2', model: 'KOL-2', manufacturer: 'A', value: 5, at: '2026-02-01' },
  ];
  const series = E.historySeries(events);
  assert.equal(series[0].identityKey, 'm1');
  assert.equal(series[0].series.length, 2);
  assert.deepEqual(series[0].series[0].points.map(point => point.value), [10, 9]);
  assert.equal(series[0].latestBest, 9);
  assert.equal(series[0].firstBest, 9.5);
});

test('klasman × üretici analizi grup ortalamasına göre endeks ve en iyi üreticiyi verir', () => {
  const obs = [
    { identityKey: 'm1', modelKey: 'm1', manufacturer: 'A', value: 10, classification: 'Kazak', buyer: 'Buyer 1' },
    { identityKey: 'm1', modelKey: 'm1', manufacturer: 'B', value: 8, classification: 'Kazak', buyer: 'Buyer 1', approved: true },
    { identityKey: 'm2', modelKey: 'm2', manufacturer: 'A', value: 12, classification: 'Kazak', buyer: 'Buyer 2' },
    { identityKey: 'm2', modelKey: 'm2', manufacturer: 'B', value: 10, classification: 'Kazak', buyer: 'Buyer 2' },
    { identityKey: 'm3', modelKey: 'm3', manufacturer: 'A', value: 7, classification: 'Hırka', buyer: 'Buyer 2' },
  ];
  const result = E.analyze(obs, { groupBy: 'classification' });
  const kazak = result.groups.find(group => group.label === 'Kazak');
  assert.equal(kazak.avg, 10);
  assert.equal(kazak.best.name, 'B');
  assert.equal(kazak.cell('a').index, 10);
  assert.equal(kazak.cell('B').index, -10);
  const b = result.suppliers.find(item => item.name === 'B');
  assert.equal(b.wins, 1);
  assert.ok(b.modelIndex < 0, 'aynı modelde B ortalamanın altında');
  assert.equal(b.approved, 1);
  const filtered = E.analyze(obs, { groupBy: 'classification', filters: { buyer: ['Buyer 2'] } });
  assert.equal(filtered.count, 3);
  const buyers = E.buyerComparison(obs, { groupBy: 'classification' });
  assert.deepEqual(buyers.map(item => item.name).sort(), ['Buyer 1', 'Buyer 2']);
  assert.deepEqual(E.dimensionValues(obs, 'classification').map(item => item.label), ['Hırka', 'Kazak']);
});

test('geri alınan yazım hatası teklif geçmişini ve pazarlık hesabını bozmaz', () => {
  const req = { createdAt: '2026-10-12T08:00:00.000Z', items: [] };
  const line = { id: 'x', price: '7,70', history: [
    { id: 'e1', type: 'offer', price: '7,70', at: '2026-10-12T09:00:00.000Z', round: 1 },
    { id: 'e2', type: 'offer', price: '95', at: '2026-10-19T09:00:00.000Z', round: 3, source: 'matrix' },
    { id: 'e3', type: 'offer', price: '7,70', at: '2026-10-19T09:00:05.000Z', round: 3, source: 'undo' },
  ] };
  assert.deepEqual(E.offers(line, req).map(event => event.value), [7.7]);
  assert.equal(E.negotiation(line, req).previous, null);
});
