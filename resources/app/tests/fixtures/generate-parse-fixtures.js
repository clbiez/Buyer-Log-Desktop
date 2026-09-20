'use strict';

/*
 * Ayrıştırma katmanı regresyon fixture üreticisi.
 *
 * Amaç: server/lib/parse.js ve server/lib/lfl.js içindeki GERÇEK ayrıştırma yolunu
 * (sheet seçimi, çapa satırı tespiti, tekilleştirme, filtreler, bulanık başlık
 * eşleştirme) temsili .xlsx dosyalarıyla kilitlemek. Üretilen .xlsx'ler kütüphaneden
 * BAĞIMSIZ binary'lerdir; parser/kütüphane değişse bile (ör. ileride xlsx yerine başka
 * bir okuyucu) aynı beklenen çıktının üretilmesi bu dosyalarla doğrulanır.
 *
 * Bu üreticiyi yalnız fixture'ları yeniden oluşturmak gerektiğinde çalıştır:
 *   node tests/fixtures/generate-parse-fixtures.js
 * Tarihler bilinçle METİN olarak yazılır; ASAS/Antrepo/CP raw okumada (cellDates:false)
 * belirsiz seri sayıya dönüşmesinler.
 */

const XLSX = require('xlsx');
const path = require('path');

const OUT = __dirname;

function writeAoaBook(sheets, file) {
  const wb = XLSX.utils.book_new();
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  XLSX.writeFile(wb, path.join(OUT, file), { bookType: 'xlsx' });
}

// ---- ASAS: çapa (2 çöp satır önce), tekilleştirme, qty>0 ve YARDIM filtreleri,
//      bulanık kumaş başlığı eşleştirme, "Ana Kumaş Mı" mantığı ----
const asasHeader = ['Sipariş Kod', 'Renk', 'Renk Kod', 'Net Alım Sipariş Miktarı',
  'Kalan Alım Sipariş Miktarı', 'Antrepoya Giren Miktar', 'FOB Fiyatı', 'Üretici', 'Sezon',
  'Buyer Grup (TR)', 'Siparişin Üretildiği Ülke', 'Lisans', 'Model Adı',
  'Orijinal Exfactory Merch Tarih',
  'Karışım', 'İplik No.', 'Gramaj (gr/m2)', 'Kumaş Tipi',
  'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo', 'Ana Kumaş Mı']; // kumaş başlıkları bulanık eşleşir
writeAoaBook([{
  name: 'ASAS', aoa: [
    ['ASAS EXPORT — başlık öncesi çöp satır', null],
    [null, null],
    asasHeader,
    [1001, 'KIRMIZI', 'K01', 500, 100, 50, 8.5, 'ACME', 'W6', 'BASIC', 'Egypt', 'FCB', 'Model A', '2026-10-19', '%100 PAMUK', '30/1', '180', 'Süprem', 25, 1],
    [1001, 'KIRMIZI', 'K01', 999, 0, 0, 8.5, 'ACME', 'W6', 'BASIC', 'Egypt', 'FCB', 'Model A', '2026-10-19', '%100 PAMUK', '30/1', '180', 'Süprem', 0, 1], // dup key → ilk kayıt korunur
    [1002, 'MAVI', 'M01', 0, 0, 0, 7, 'ACME', 'W6', 'BASIC', 'Egypt', 'FCB', 'Model B', '2026-10-20', '', '', '', '', 0, 1], // qty 0 → elenir
    [1003, 'SIYAH', 'S01', 300, 0, 0, 9, 'BETA', 'W6', 'YARDIM', 'Romania', 'HP', 'Model C', '2026-10-21', '', '', '', '', 0, 1], // YARDIM → elenir
    [1004, 'YESIL', 'Y01', 200, 50, 0, 6.5, 'GAMMA', 'W7', 'KIDS', 'Georgia', 'MC', 'Model D', '2026-11-01', '%50 YÜN', '20/1', '200', 'Ribana', 10, 0], // Ana Kumaş Mı 0 → kumaş boş
  ],
}], 'asas-sample.xlsx');

// ---- Antrepo: /antrepo/i sheet seçimi (decoy ilk sheet), üçlü anahtar
//      (Sipariş Kod + Model Adı + Renk Kod, v4.17) zorunlu; aynı sipariş+model+renk
//      için BİRDEN FAZLA parsiyel satırı BİRLEŞTİRİLMEDEN, __ias_row_N ile AYRI AYRI korunur ----
writeAoaBook([
  { name: 'Kapak', aoa: [['Bu bir kapak sayfası', null]] },
  {
    name: 'Antrepo Raporu', aoa: [
      ['Sipariş Kod', 'Model Adı', 'Renk Kod', 'Renk Tanım', 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi', 'Vasita Tanim', 'HANDOVER Tarihi'],
      [2001, 'Model A', 'K01', 'KIRMIZI', 'Depoda', '2026-05-01', 'GEMI', '2026-06-10'], // erken parsiyel; handover dolu
      [2001, 'Model A', 'K01', 'KIRMIZI', 'Yolda', '2026-05-15', 'GEMI', ''],            // geç parsiyel; handover boş — İKİSİ DE AYRI satır olarak korunur
    ],
  },
], 'antrepo-sample.xlsx');

// ---- CP-Update: çapa (Supplier + PO, ilk 10 satır), PO ve PO2 aynı supplier/fob'a eşlenir,
//      Manufacturer FOB half-up 2 ondalığa yuvarlanır ----
writeAoaBook([{
  name: 'CP Update', aoa: [
    ['Supplier', 'PO', 'PO2', 'Manufacturer FOB'],
    ['ACME', 3001, 3002, 9.876], // roundHalfUp(9.876,2) = 9.88; hem 3001 hem 3002 eşlenir
  ],
}], 'cpupdate-sample.xlsx');

// ---- LFL: skorla en iyi başlık satırı (junk row 0, header row 1); fob<=0, qty<=0,
//      boş satır ve eksik-boyutlu satırlar elenir ----
const lflHeader = ['Sipariş Kod', 'Model Adı', 'MAG', 'MMYG', 'Klasman', 'Sezon',
  'IN-STORE (MODEL BUDGET)', 'FOB Fiyatı', 'Net Alım Sipariş Miktarı', 'Üretici', 'Country',
  'Buyer Grup (TR)', 'Buyer'];
writeAoaBook([{
  name: 'LFL', aoa: [
    ['LFL Raporu — başlık öncesi çöp satır'],
    lflHeader,
    [5001, 'Model A', 'CE', 'A1', 'KAZAK', 'W6', '2026-09-01', 8.5, 1200, 'ACME', 'Egypt', 'BASIC', 'Ali'], // geçerli
    [5002, 'Model B', 'CE', 'A1', 'KAZAK', 'W6', '2026-09-01', 0, 500, 'ACME', 'Egypt', 'BASIC', 'Ali'],   // fob 0 → fiyat yok
    [5003, 'Model C', 'CE', 'A1', 'KAZAK', 'W6', '2026-09-01', 7, 0, 'ACME', 'Egypt', 'BASIC', 'Ali'],     // qty 0 → miktar yok
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],                                                   // boş satır
    [5004, 'Model D', 'KD', 'B2', 'SWEAT', 'W7', '2026-10-15', 9.25, 800, 'BETA', 'Romania', 'KIDS', 'Veli'], // geçerli
    [5005, 'Model E', '', 'A1', 'KAZAK', 'W6', '2026-09-01', 7, 300, 'ACME', 'Egypt', 'BASIC', 'Ali'],     // MAG boş → eksik boyut
  ],
}], 'lfl-sample.xlsx');

console.log('Fixture üretimi tamamlandı: asas-sample.xlsx, antrepo-sample.xlsx, cpupdate-sample.xlsx, lfl-sample.xlsx');
