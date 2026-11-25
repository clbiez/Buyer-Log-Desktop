'use strict';

/* İstemci yeniden temellendirmesi (kolMergeLocalRowDelta) üretici fiyat
 * haritasını bütün değer olarak taşıyordu. Başka cihazın aynı modelde başka
 * üreticiye girdiği fiyat canlı güncellemeyle ekrana geldikten sonra kullanıcı
 * kendi üreticisini kaydettiğinde, yerel haritanın tamamı uzak satırın üstüne
 * yazılıyor ve diğer fiyat sessizce siliniyordu. Harita alanları (pricing,
 * pricingSent) üretici anahtarı düzeyinde taşınır: yalnız bu ekranda değişen
 * üreticiler uzak değerin üstüne yazılır, silinen anahtar silinir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} bulunamadı`);
  return source.slice(start, end);
}
function context() {
  const ctx = vm.createContext({ migrateKolRow: row => row, JSON });
  vm.runInContext(slice('function kolValueEqual(', 'function kolRowChangedFromBase(') + slice('function kolCloneConflictValue(', 'function kolIsOwnWorkspace('), ctx);
  return ctx;
}

test('yeniden temellendirme: farklı üreticilerin fiyatı birlikte korunur', () => {
  const { kolMergeLocalRowDelta } = context();
  const base = { id: 7, _rev: 3, not: '', pricing: { 'Mfr Alfa': '1,00' }, pricingSent: {} };
  const local = { id: 7, _rev: 3, not: '', pricing: { 'Mfr Alfa': '1,00', 'Mfr Gamma': '2,40' }, pricingSent: { 'Mfr Gamma': true } };
  const remote = { id: 7, _rev: 5, not: 'uzak not', pricing: { 'Mfr Alfa': '1,00', 'Mfr Beta': '3,95' }, pricingSent: { 'Mfr Beta': true } };
  const merged = kolMergeLocalRowDelta(base, local, remote);
  assert.deepEqual({ ...merged.pricing }, { 'Mfr Alfa': '1,00', 'Mfr Beta': '3,95', 'Mfr Gamma': '2,40' });
  assert.deepEqual({ ...merged.pricingSent }, { 'Mfr Beta': true, 'Mfr Gamma': true });
  assert.equal(merged.not, 'uzak not', 'yerelde değişmeyen alan uzak değeri alır');
  assert.equal(merged._rev, 5, 'uzak satır revizyonu taşınır');
});

test('yeniden temellendirme: yerel üretici değişikliği ve silme uygulanır, aynı üreticide yerel giriş kazanır', () => {
  const { kolMergeLocalRowDelta } = context();
  const base = { id: 7, _rev: 3, pricing: { 'Mfr Alfa': '1,00', 'Mfr Beta': '2,00', 'Mfr Delta': '9,00' } };
  const local = { id: 7, _rev: 3, pricing: { 'Mfr Alfa': '1,50', 'Mfr Beta': '2,00' } };
  const remote = { id: 7, _rev: 4, pricing: { 'Mfr Alfa': '1,20', 'Mfr Beta': '2,30', 'Mfr Delta': '9,00' } };
  const merged = kolMergeLocalRowDelta(base, local, remote);
  // Kullanıcının bu ekranda girdiği değer bilinçli düzenlemedir (önceki davranış korunur).
  assert.deepEqual({ ...merged.pricing }, { 'Mfr Alfa': '1,50', 'Mfr Beta': '2,30' });
  // Değişmeyen harita uzak haritayı aynen alır; harita olmayan değer bütün alan kuralındadır.
  assert.deepEqual({ ...kolMergeLocalRowDelta(base, { ...base }, remote).pricing }, remote.pricing);
  assert.deepEqual(kolMergeLocalRowDelta({ id: 1, pricing: '' }, { id: 1, pricing: { A: '1' } }, { id: 1, pricing: '' }).pricing, { A: '1' });
  const removed = kolMergeLocalRowDelta({ id: 1, pricing: { A: '1' } }, { id: 1 }, { id: 1, pricing: { A: '1', B: '2' } });
  assert.equal(Object.prototype.hasOwnProperty.call(removed, 'pricing'), false, 'yerelde tamamen kaldırılan alan kaldırılır');
});
