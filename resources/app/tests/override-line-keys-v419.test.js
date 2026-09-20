'use strict';
/*
 * v4.19 — kullanıcı düzenlemeleri de satır bazında.
 *
 * Notlar, alt üretici, Supp. FOB, teslim tipi, lisansör ve tarih
 * revizyonları eskiden yalnız sipariş koduyla saklanıyordu; bir siparişin altındaki
 * bütün model/renk satırları aynı değeri paylaşıyordu. Supp. FOB ve FOB model ve
 * modelin rengine göre değiştiği için bu yanlıştı.
 *
 * Yazma artık üçlü anahtara (sipariş + model + renk kodu) yapılır. Okuma önce üçlü
 * anahtarı, bulamazsa ESKİ sipariş kodu anahtarını dener — böylece bugüne kadar
 * kaydedilmiş hiçbir veri (özellikle alt üretici) kaybolmaz.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));
const db = require(path.join(__dirname, '..', 'server', 'db.js'));

const LINE_A = { ocode: 1234567, model: 'KAZAK A', ccode: 'BLK' };
const LINE_B = { ocode: 1234567, model: 'KAZAK B', ccode: 'BLK' };

function asasOrder(line, extra) {
  return Object.assign({
    colour: 'SIYAH', season: 'W6', countryRaw: 'MISIR', manufacturer: 'X',
    license: 'HARRY POTTER', category: 'KAZAK', qty: 100, kalan: 100, fob: 10,
    opd: new Date(2026, 0, 1), ex: new Date(2026, 7, 1), retail: new Date(2026, 9, 7),
    mb: new Date(2026, 8, 23), merkezSevkeHazirKalan: 0,
  }, line, extra || {});
}

function overrides(extra) {
  return Object.assign({
    notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {},
    delmap: {}, licensormap: {}, datemap: {}, pricingRules: [], transitRules: [],
  }, extra || {});
}

// ---------------------------------------------------------------------------
// Okuma: üçlü anahtar öncelikli, eski anahtar yedek
// ---------------------------------------------------------------------------

test('üçlü anahtarla kaydedilen değer yalnız kendi satırına uygulanır', () => {
  const ov = overrides({ submap: { [parse.orderLineKey(1234567, 'KAZAK A', 'BLK')]: 'ALT ÜRETİCİ A' } });
  const [a, b] = parse.buildCPRowsFromASAS([asasOrder(LINE_A), asasOrder(LINE_B)], {}, ov);
  assert.strictEqual(a['Sub-Manufacturer'], 'ALT ÜRETİCİ A');
  assert.strictEqual(b['Sub-Manufacturer'], '', 'diğer model etkilenmemeli');
});

test('ESKİ sipariş bazlı kayıtlar okunmaya devam eder — veri kaybı yok', () => {
  // Kritik: alt üretici bilgisinin silinmemesi gerekiyor.
  const ov = overrides({ submap: { 1234567: 'ESKİ ALT ÜRETİCİ' } });
  const [a, b] = parse.buildCPRowsFromASAS([asasOrder(LINE_A), asasOrder(LINE_B)], {}, ov);
  assert.strictEqual(a['Sub-Manufacturer'], 'ESKİ ALT ÜRETİCİ');
  assert.strictEqual(b['Sub-Manufacturer'], 'ESKİ ALT ÜRETİCİ');
});

test('bir satır düzenlenince üçlü anahtar eski kaydı geçer, diğer satır eskisini korur', () => {
  const ov = overrides({
    submap: {
      1234567: 'ESKİ ALT ÜRETİCİ',
      [parse.orderLineKey(1234567, 'KAZAK A', 'BLK')]: 'YENİ ALT ÜRETİCİ',
    },
  });
  const [a, b] = parse.buildCPRowsFromASAS([asasOrder(LINE_A), asasOrder(LINE_B)], {}, ov);
  assert.strictEqual(a['Sub-Manufacturer'], 'YENİ ALT ÜRETİCİ');
  assert.strictEqual(b['Sub-Manufacturer'], 'ESKİ ALT ÜRETİCİ');
});

test('Supp. FOB satır bazında farklı olabilir', () => {
  const ov = overrides({
    suppfobmap: {
      [parse.orderLineKey(1234567, 'KAZAK A', 'BLK')]: 7.5,
      [parse.orderLineKey(1234567, 'KAZAK B', 'BLK')]: 9.25,
    },
  });
  const [a, b] = parse.buildCPRowsFromASAS([asasOrder(LINE_A), asasOrder(LINE_B)], {}, ov);
  assert.strictEqual(a['Supp. FOB'], 7.5);
  assert.strictEqual(b['Supp. FOB'], 9.25);
});

test('notlar satır bazında ayrışır', () => {
  const ov = overrides({
    notesmap: {
      [parse.orderLineKey(1234567, 'KAZAK A', 'BLK')]: { Notes: 'A NOTU' },
      1234567: { Notes: 'ESKİ NOT' },
    },
  });
  const [a, b] = parse.buildCPRowsFromASAS([asasOrder(LINE_A), asasOrder(LINE_B)], {}, ov);
  assert.strictEqual(a.Notes, 'A NOTU');
  assert.strictEqual(b.Notes, 'ESKİ NOT');
});

test('tarih revizyonu da satır bazında uygulanır', () => {
  const orders = parse.applyDateOverrides([asasOrder(LINE_A), asasOrder(LINE_B)], {
    datemap: { [parse.orderLineKey(1234567, 'KAZAK A', 'BLK')]: { ex: '2026-09-02' } },
  });
  assert.strictEqual(orders[0].ex.getDate(), 2);
  assert.strictEqual(orders[1].ex.getDate(), 1, 'diğer model kaymamalı');
});

// ---------------------------------------------------------------------------
// Yazma
// ---------------------------------------------------------------------------

test('model ve renk kodu gelince üçlü anahtara yazılır', () => {
  assert.strictEqual(db.overrideWriteKey(1234567, { model: 'KAZAK A', ccode: 'BLK' }), '1234567|KAZAK A|BLK');
});

test('model veya renk kodu yoksa eski sipariş bazlı anahtar kullanılır', () => {
  // Bazı eski içe aktarma akışlarında yalnız Order Code sütunu olabiliyor.
  assert.strictEqual(db.overrideWriteKey(1234567, {}), 1234567);
  assert.strictEqual(db.overrideWriteKey(1234567, { model: 'KAZAK A' }), 1234567);
});

test('satır ilk kez düzenlenince eski kayıt tohum olarak alınır', () => {
  const ov = overrides({ notesmap: { 1234567: { Notes: 'ESKİ NOT' } } });
  db.applyDatePatch(ov, '1234567|KAZAK A|BLK', { exFactory: '2026-09-02' }, 1234567);
  assert.deepStrictEqual(ov.datemap['1234567|KAZAK A|BLK'], { ex: '2026-09-02' });
});

test('anahtar normalizasyonu istemci ile sunucuda aynı sonucu verir', () => {
  // İstemci lineKeyOfRow ile aynı kural: rakamlar + turknorm.
  assert.strictEqual(parse.orderLineKey('1234567', 'kazak a', 'blk'), '1234567|KAZAK A|BLK');
  assert.strictEqual(parse.orderLineKey(1234567, 'Kazak  A', ' BLK '), '1234567|KAZAK A|BLK');
});
