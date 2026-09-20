'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

function asasRowMissingQty() {
  // "Net Alım Sipariş Miktarı" anahtarı BİLEREK yok — sütun ASAS kaynağında yeniden
  // adlandırılmış/kaldırılmış senaryosunu simüle eder. objectRowsToMatrix yalnız
  // OBJENİN GERÇEKTEN taşıdığı anahtarları başlığa çevirir (Object.keys), bu yüzden
  // anahtarı `undefined` değerle eklemek yetmez — hiç bulunmaması gerekir.
  return {
    'Sipariş Kod': 'A-1',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'BLACK',
    'Kalan Alım Sipariş Miktarı': 3000,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Buyer Grup (TR)': 'BG',
    'Siparişin Üretildiği Ülke': 'CIN',
  };
}

test('ASAS "Net Alım Sipariş Miktarı" sütunu bulunamazsa siparişler sessizce elenmez, uyarı üretilir', () => {
  const result = parse.parseASASRows([asasRowMissingQty()]);
  // Kök sorun: sütun bulunamayınca qty=0 olur ve qty>0 filtresi TÜM siparişleri eler.
  // Bu test o eleme davranışını DEĞİL, kullanıcının bunu görebilmesini sınıyor.
  assert.equal(result.orders.length, 0, 'kayıt önceki davranış gereği hâlâ elenir (kapsam dışı)');
  const warnings = result.fabricHeaderInfo.warnings;
  assert.ok(
    warnings.some(w => /Net Alım Sipariş Miktarı/.test(w)),
    `qty sütunu bulunamadığına dair bir uyarı bekleniyordu, gelenler: ${JSON.stringify(warnings)}`
  );
});

test('ASAS "Net Alım Sipariş Miktarı" sütunu bulununca uyarı üretilmez', () => {
  const result = parse.parseASASRows([{ ...asasRowMissingQty(), 'Net Alım Sipariş Miktarı': 10000 }]);
  assert.equal(result.orders.length, 1);
  assert.ok(
    !result.fabricHeaderInfo.warnings.some(w => /Net Alım Sipariş Miktarı/.test(w)),
    'sütun mevcutken yanlış pozitif uyarı üretilmemeli'
  );
});
