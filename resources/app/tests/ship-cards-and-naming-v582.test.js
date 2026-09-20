'use strict';

// v5.82 — Navlun penceresindeki çarpan adı, Nakliye Kıyaslama kartlarının
// sadeleştirilmesi ve uygulama adının yalnız "Buyer Log" olması.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');
const HTML = read('public/index.html');

test('v5.82 çarpan alanı "Extra Costs Multiplier" adını taşır', () => {
  assert.match(APP, /Extra Costs Multiplier \(FOB × …\)/);
  assert.match(APP, /Ekstra Masraf Çarpanı \(FOB × …\)/);
  // Eski ad hiçbir dilde kalmamalı.
  assert.doesNotMatch(APP, /Landed multiplier \(FOB/);
  assert.doesNotMatch(APP, /Landed çarpanı \(FOB/);
  // Ayarın anahtarı DEĞİŞMEDİ: yalnız görünen etiket revize edildi, kayıtlı
  // ayarlar ve /api/freight-rates sözleşmesi olduğu gibi kalır.
  assert.match(APP, /landedMultiplier/);
});

test('v5.82 fiyatın altındaki tekrar eden etiket kaldırıldı', () => {
  // Kart başlığı zaten "SEA Landed" / "AIR Landed" yazıyordu; altındaki
  // "sea landed" / "air landed" satırı aynı bilgiyi ikinci kez veriyordu.
  assert.doesNotMatch(APP, /priceLabel/);
  assert.doesNotMatch(APP, /'kaynak fiyat'|'source price'/);
  assert.doesNotMatch(APP, /'deniz\+uçak landed'|'sea\+air landed'/);
  /* Fiyat hücresi yalnız sayıyı taşır. v9.17'de kart <td>'ye dönüştü ve
     seçenek adı ("FOB", "SEA Landed"…) hücreden tamamen çıkıp SÜTUN
     BAŞLIĞINA taşındı; yani v5.82'nin amacı (aynı bilgiyi ikinci kez
     yazmamak) korunmakla kalmadı, bir adım ileri gitti. */
  assert.match(APP, /<b class="shipCardPrice" data-ship-unit>\$\{priceText\}<\/b>/);
  // Seçenek adı artık satır hücresinde HİÇ yazılmıyor.
  assert.doesNotMatch(APP, /shipCardName/);
  // Karşılıksız kalan CSS kuralı da silindi.
  assert.doesNotMatch(CSS, /\.shipCardPrice span\{/);
});

test('v9.18 sütun kimlikleri korundu, formül notu gereksizleşti', () => {
  /* v5.82 kart başlıklarının kaybolmamasını çiviliyordu. Adlar artık SÜTUN
     BAŞLIĞINDA yazılıyor; kimlik kaybolmadı, yeri değişti. */
  // v9.20: adlar "… Landed" olarak açıldı; sütunda duran değer landed fiyattır.
  assert.match(APP, /name:'SEA Landed'/);
  assert.match(APP, /name:'SEA\+AIR Landed'/);
  assert.match(APP, /name:'AIR Landed'/);
  /* "FOB × 1,11" notu kaldırıldı: çarpan artık sabit değil, Landed Multipliers
     ayarından geliyor — hücreye sabit bir sayı yazmak YANLIŞ bilgi olurdu. */
  assert.doesNotMatch(APP, /note:tr\?'FOB × 1,11'/);
  assert.match(APP, /function shipLandedMultipliers\(\)/);
});

test('v9.17 satır yüksekliği kart öbeğinden tek satıra indi', () => {
  /* v5.82 kart öbeğinin yüksekliğini kısmaya çalışıyordu (padding/min-height
     ayarları). v9.17 sorunu kaynağından çözdü: kart öbeği yok, her model tek
     tablo satırı. Ölçülen sonuç 170px -> 59px. Bu test artık yoğunluğu
     sağlayan YAPIYI çiviler, eski kartın piksel ayarlarını değil. */
  // Kart öbeğinin kabukları kalmamalı.
  assert.doesNotMatch(CSS, /\.shipModelCard\{/);
  assert.doesNotMatch(CSS, /\.shipCards\{/);
  // Satırı uzatan iki şey: metriklerin ve giriş etiketlerinin alt alta düşmesi.
  assert.match(CSS, /\.shipCardMetrics\{[^}]*flex-wrap:nowrap/);
  assert.match(CSS, /\.shipField\{display:flex; align-items:center/);
  // Boş metrik satır yüksekliği yememeli.
  assert.match(CSS, /\.shipCardRow\.isEmpty\{display:none;\}/);
  // Hücre dolgusu tek satırlık kalmalı (v9.18: A4 okunaklılığı için 5px).
  assert.match(CSS, /\.shipCompare tbody td\{\s*padding:5px 7px/);
});

test('v5.82 uygulama adı her yerde yalnız "Buyer Log"', () => {
  assert.match(HTML, /<title>Buyer Log<\/title>/);
  assert.doesNotMatch(HTML, /Licensed Knitwear/);
  assert.doesNotMatch(read('package.json'), /Licensed Knitwear/);
  assert.doesNotMatch(read('server/server.js'), /LCW Order Control sunucusu/);
  assert.match(read('server/server.js'), /Buyer Log sunucusu çalışıyor/);
  // Üretilen Excel dosyalarının "creator" alanı da programın adını taşır.
  assert.doesNotMatch(APP, /'LCW Buyer Log'/);
  assert.match(APP, /wb\.creator='Buyer Log'/);
});
