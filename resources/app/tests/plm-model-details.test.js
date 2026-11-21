'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const details = require('../server/lib/plm-model-details');
const bomStore = require('../server/lib/plm-bom-store');

function store(models) {
  return bomStore.normalizeStore({ _revision: 3, models });
}
const STORE = store({
  101: { plmId: '101', styleId: '9001', fabric: 'Orme,Süprem,150 gsm,100% Cotton',
    placements: [{ placement: 'front_body', placementTr: 'Ön', placementEn: 'Front', count: 1, printType: 'Pigment' }] },
  102: { plmId: '102', styleId: '9002', fabric: '3859-Jersey,30,Ne Compact Combed 150 gsm,100%Cotton Reactive Dyed', placements: [] },
  103: { plmId: '103', styleId: '9003', fabric: 'Orme,Jersey,160 gsm,100% Cotton', placements: [] },
});

test('PLM model detayı: kumaş metni, artwork (TR/EN) ve ayrıştırılmış alanlar', () => {
  const out = details.detailsForIds(['101', '0102', 'x', '999'], STORE);
  assert.deepEqual(Object.keys(out).sort(), ['101', '102']);
  assert.equal(out['101'].plmFabric, 'Orme,Süprem,150 gsm,100% Cotton');
  assert.equal(out['101'].plmArtwork, 'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(out['101'].plmArtworkEn, 'Front: 1 | Pigment | Total: 1');
  assert.equal(out['101'].fabricCategory, 'Orme');
  assert.equal(out['101'].kumasTipi, 'Süprem');
  assert.equal(out['101'].fabricWeight, '150 gsm');
  assert.equal(out['102'].plmArtwork, 'Baskı yok');
  assert.equal(out['102'].plmArtworkEn, 'No print');
  assert.equal(out['102'].iplikNo, '30 Ne Compact Combed');
});

test('LFL satırları: PLM kumaşı ASAS kumaşının yerine geçer, PLM yoksa ASAS korunur', () => {
  const rows = [
    { id: 'a', plmId: '101', kumasTipi: 'Rib', fabricWeight: '200 GR', fabricSupplier: 'ASAS Kumaşçı' },
    { id: 'b', plmId: '555', kumasTipi: 'Single Jersey', fabricWeight: '150 GR', karisim: '%100 Pamuk' },
    { id: 'c', modelName: 'no plm' },
  ];
  const before = JSON.stringify(rows);
  const out = details.attachToRows(rows, STORE);
  assert.equal(JSON.stringify(rows), before, 'girdi satırları değiştirilmez');
  assert.equal(out[0].fabricInfoSource, 'PLM');
  assert.equal(out[0].kumasTipi, 'Süprem');
  assert.equal(out[0].fabricWeight, '150 gsm');
  assert.equal(out[0].fabricSupplier, 'ASAS Kumaşçı', 'Kumaşçı PLM metninde yok; ASAS korunur');
  assert.equal(out[0].plmFabric, 'Orme,Süprem,150 gsm,100% Cotton');
  assert.equal(out[0].plmArtwork, 'Ön: 1 | Pigment | Toplam: 1');
  // PLM kaydı olmayan model: ASAS değeri, aynı kanonik değerin PLM yazımıyla birleşir.
  assert.equal(out[1].fabricInfoSource, 'ASAS');
  assert.equal(out[1].kumasTipi, 'Süprem', 'Single Jersey = Süprem (SINGLE_JERSEY)');
  assert.equal(out[1].fabricWeight, '150 gsm');
  assert.equal(out[1].karisim, '100% Cotton');
  assert.equal(out[1].plmFabric, '');
  assert.equal(out[2].fabricInfoSource, '');
});

test('Farklı PLM yazımları tek filtre değerinde birleşir (en sık yazım kazanır)', () => {
  const rows = [{ plmId: '101' }, { plmId: '103' }, { plmId: '103' }, { plmId: '102' }];
  const out = details.attachToRows(rows, STORE);
  assert.deepEqual([...new Set(out.map(row => row.kumasTipi))], ['Jersey']);
  assert.deepEqual([...new Set(out.map(row => row.karisim))].length, 1);
});

test('Compact LFL yanıtı: PLM metinleri satıra değil model sözlüğüne yazılır', () => {
  const rows = [{ plmId: '101', kumasTipi: 'Rib' }, { plmId: '555', kumasTipi: 'Single Jersey' }];
  const out = details.attachToRows(rows, STORE, { compact: true });
  assert.equal(out[0].plmFabric, undefined);
  assert.equal(out[0].fabricInfoSource, undefined);
  assert.equal(out[0].kumasTipi, 'Süprem');
  assert.equal(out[1].kumasTipi, 'Süprem');
  const dict = details.detailsForRows(out, STORE);
  assert.deepEqual(Object.keys(dict), ['101']);
  assert.equal(dict['101'].plmArtworkEn, 'Front: 1 | Pigment | Total: 1');
});
