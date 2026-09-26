'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan veri bütünlüğü hatası:
   tarayıcıda yerel Koleksiyon kopyası yoksa istemci, bir PDF'ten çıkarılmış
   24 ÖRNEK modeli (görselleriyle) yüklüyordu. Kullanıcının sunucu çalışma
   alanı henüz başlatılmamışsa bu örnekler "eski yerel veri taşıması" yolundan
   GERÇEK koleksiyona kaydediliyor ve hub üzerinden yetkili herkese
   dağılıyordu (yeni kullanıcı / yeni PC / temizlenmiş tarayıcı). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

test('Yerel Koleksiyon kopyası yoksa örnek modeller yüklenmez; koleksiyon boş başlar', () => {
  const calls = [];
  const fn = loadAppMainFunctions(['loadKolRows'], {
    BLStorage: { getItem: () => null },
    KOL_STORAGE_KEY: 'lcw.koleksiyon.rows',
    KOLEKSIYON_SEED_ROWS: [{ id: 1, modelKod: 'ARDA/BARCHA-7' }, { id: 2, modelKod: 'ARDA/BARCHA-8' }],
    kolNormalizeModelGroups: rows => rows,
    migrateKolRow: row => row,
    loadKolManufacturers: () => calls.push('manufacturers'),
    loadKolColState: () => calls.push('columns'),
    kolMigrateInlineImagesToServer: () => {},
    setTimeout: () => 0,
  });
  fn.loadKolRows();
  assert.deepEqual(Array.from(fn.context.kolRows), [], 'örnek satır kullanıcı verisine karışmaz');
  assert.equal(fn.context.kolNextId, 1);
  assert.deepEqual(calls, ['manufacturers', 'columns']);
});

test('Yerel kopya varsa aynen yüklenir (eski tarayıcı verisinin taşınması korunur)', () => {
  const fn = loadAppMainFunctions(['loadKolRows'], {
    BLStorage: { getItem: () => JSON.stringify([{ id: 7, modelKod: 'GERÇEK' }]) },
    KOL_STORAGE_KEY: 'lcw.koleksiyon.rows',
    KOLEKSIYON_SEED_ROWS: [{ id: 1, modelKod: 'ARDA/BARCHA-7' }],
    kolNormalizeModelGroups: rows => rows,
    migrateKolRow: row => row,
    loadKolManufacturers: () => {}, loadKolColState: () => {}, kolMigrateInlineImagesToServer: () => {}, setTimeout: () => 0,
  });
  fn.loadKolRows();
  assert.deepEqual(Array.from(fn.context.kolRows, row => row.modelKod), ['GERÇEK']);
  assert.equal(fn.context.kolNextId, 8);
});
