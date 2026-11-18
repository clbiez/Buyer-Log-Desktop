'use strict';

/* Saha olayı (kaynak doğrulama aracı, 2026-11-18): kumaş satırları ASAS
   sonucunu 139.271 satıra çıkardığında LFL ayrıştırması
   "Maximum call stack size exceeded" ile düşüyor, BL son başarılı (eski) LFL
   verisini koruyup yalnız uyarı veriyordu. Neden: allRows.push(...rows) tek
   çağrıya 139 bin argüman veriyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const lfl = require(path.join(__dirname, '..', 'server', 'lib', 'lfl.js'));

test('LFL 150 bin satırlık model sonucunu yığın taşması olmadan ayrıştırır', () => {
  const base = {
    'Model Adı': 'MODEL A', 'Renk Kod': 'C01', 'FOB Fiyatı': 5.5, 'Net Alım Sipariş Miktarı': 1000, Sezon: 'S7',
    'Model Bütçe Tarih Yıl Ay Gün': '2027-02-01', 'Sipariş Yerleştirme MerchTarih': '2026-08-01',
    'Orijinal Exfactory Merch Tarih': '2027-01-01', 'Merch Alt Grup Kod': 'MAG1', 'Merch Marka Yaş Grup Kod': 'MMYG1',
    'Ürün Klasman': 'ÜST GİYİM', Üretici: 'ÜRETİCİ A', 'Siparişin Üretildiği Ülke': 'INDIA',
    'Buyer Grup (TR)': 'GRUP A', Buyer: 'BUYER A', 'Ana Kumaş Mı': 1,
  };
  const records = Array.from({ length: 150000 }, (_, i) => ({ ...base, 'Sipariş Kod': String(1000000 + i) }));
  const parsed = lfl.parseLFLRows(records, 'ASAS');
  assert.equal(parsed.rows.length, 150000);
});
