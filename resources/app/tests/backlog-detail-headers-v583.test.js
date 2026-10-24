'use strict';

// v5.83 — CP / Siparişler ekranında Status hücresine çift tıklayınca açılan
// "Sipariş Backlog Raporu" penceresinde parsiyel satırları çiziliyor ama
// hücrelerin neredeyse tamamı BOŞ geliyordu.
//
// Kök neden: pencere sütun başlıklarını BACKLOG_TEMPLATE_HEADERS'tan alıyor ve
// her hücreyi `row[başlık]` ile okuyor. buildBacklogDetailRows ise Backlog
// Excel'inden AYRI, kısaltılmış bir anahtar kümesi üretiyordu:
//
//     'GÜNCEL DURUM'        ↔ 'GÜNCEL DURUM\n(STATUS)'
//     'Sipariş Adeti'       ↔ 'Adet'
//     'Buyer Grup'          ↔ 'Buyer Grup (TR)'
//     'Special Code'        ↔ 'Özel Kod 1'
//     'Retail Depo Tarih'   ↔ 'Retail Depo Tarih Yıl Ay Gün'
//     'REVİZE YÜKLEME TARİHİ' ↔ 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)'
//
// Eşleşmeyen her anahtar boş hücre demekti; Lisans, RİSK, ANTREPO-RETAIL,
// hafta/ay sütunları ve buying note ise hiç üretilmiyordu. Artık iki taraf da
// backlogTemplateRowsFromSegments üzerinden geçtiği için ayrışamazlar.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

// server.js'teki BACKLOG_TEMPLATE_HEADERS ile birebir aynı liste; pencere
// sütunlarını buradan alıyor.
const HEADERS = [
  'Sezon','Sipariş Yerleştirme MerchTarih','Siparişin Üretildiği Ülke','Buyer','Buyer Grup (TR)','Lisans',
  'Üretici','Alt Üretici','Line','Ürün Klasman','Sipariş Kod','Özel Kod 1','Model Adı','Renk Kod','Renk',
  'Orijinal Exfactory Merch Ay','Orijinal Exfactory Merch Tarih','Retail Depo Merch Yil Ay',
  'Retail Depo Tarih Yıl Ay Gün','Model Bütçe Merch Yil Ay','Model Bütçe Tarih Yıl Ay Gün',
  'Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta','Net Alım Sipariş Miktarı','Adet',
  'Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo','Kalan Alım Sipariş Miktarı','FOB Fiyatı',
  'Net Gelen Alım Sipariş Miktarı','Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo',
  'GÜNCEL DURUM\n(STATUS)','REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)','ANTREPO GİRİŞ TARİHİ','YÜKLEME TİPİ',
  'ANTREPO-RETAIL','ÖNEM ETİKETİ\n(IMPORTANCE)','RİSK\n(PRIORITY)','buying note',
];

const d = s => new Date(s + 'T00:00:00');
const overrides = { submap: {}, delmap: {}, suppfobmap: {}, notesmap: {}, licensormap: {}, transitRules: [], pricingRules: [], nonDtrManufacturers: ['M'] };

const base = {
  season: '26SS', countryRaw: 'MISIR', buyer: 'B', buyerGrup: 'BG', manufacturer: 'M', line: 'L',
  category: 'C', ozel: 'OZ1', license: 'FCB', qty: 1000, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
  fob: 5, opd: d('2025-10-01'), ex: d('2026-01-10'), retail: d('2026-04-01'), mb: d('2026-04-15'),
  ageGroup: 'MG', merch: 'MA',
};
function orders() {
  return [
    { ...base, ocode: 1234567, model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH', kalan: 0 },
    { ...base, ocode: 1234567, model: 'TSHIRT B', ccode: 'C02', colour: 'BEYAZ', ex: d('2026-02-20') },
  ];
}
function antrepoForFirstLine() {
  const map = {};
  map[parse.orderLineKey(1234567, 'TSHIRT A', 'C01')] = {
    ocode: '1234567', model: 'TSHIRT A', ccode: 'C01', colour: 'SIYAH',
    statu: 'Depoda', arr: d('2026-03-01'), handover: null, vasita: 'Gemi',
    loadedQty: 1000, _ord: 1, _sourceRow: 1, _cpExtra: {},
  };
  return map;
}
const identitySelector = { identities: [{ orderCode: 1234567, modelName: 'TSHIRT A', colourCode: 'C01' }] };

test('v5.83 çift tıklamayla açılan detay satırı Status ve kimlik alanlarını doldurur', () => {
  const rows = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, identitySelector);
  assert.equal(rows.length, 1);
  const row = rows[0];

  // Kullanıcının bildirdiği asıl boşluk.
  assert.equal(row['GÜNCEL DURUM\n(STATUS)'], 'Depoda');
  // Eski, eşleşmeyen anahtar artık üretilmemeli — üretilirse iki eşleme geri gelmiş demektir.
  assert.equal(row['GÜNCEL DURUM'], undefined);
  assert.equal(row['Sipariş Adeti'], undefined);
  assert.equal(row['Buyer Grup'], undefined);

  assert.equal(row['Model Adı'], 'TSHIRT A');
  assert.equal(row['Renk Kod'], 'C01');
  assert.equal(row['Buyer Grup (TR)'], 'BG');
  assert.equal(row['Özel Kod 1'], 'OZ1');
  assert.equal(row['Lisans'], 'FCB');
  assert.equal(row['Adet'], 1000);
  assert.equal(row['YÜKLEME TİPİ'], 'Gemi');
});

test('v5.83 detay satırının anahtarları başlık listesinin dışına taşmaz', () => {
  const rows = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, identitySelector);
  const known = new Set(HEADERS);
  const extra = Object.keys(rows[0]).filter(key => !known.has(key));
  assert.deepEqual(extra, [], 'başlıkta karşılığı olmayan anahtar çizilmez, boşuna taşınmasın');
});

test('v5.83 başlıkların ezici çoğunluğu gerçekten dolu gelir', () => {
  const rows = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, identitySelector);
  const row = rows[0];
  const blank = HEADERS.filter(header => {
    const value = row[header];
    return value == null || value === '';
  });
  // Boş kalabilecek olanlar veriye bağlıdır (not girilmemiş, alt üretici yok,
  // depodaki satırda ANTREPO-RETAIL hesaplanmaz). Bunun ötesinde boşluk,
  // eşlemenin yeniden ayrıştığının işaretidir.
  assert.deepEqual(blank.sort(), ['ANTREPO-RETAIL', 'Alt Üretici', 'buying note'].sort());
});

test('v5.83 pivot düğümü ve sipariş kodu seçicileri de aynı eşlemeyi kullanır', () => {
  const byNode = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, { groupBy: ['status'], path: '0' });
  const byOcode = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, [1234567]);
  [byNode, byOcode].forEach(list => {
    assert.ok(list.length >= 1);
    list.forEach(row => {
      assert.ok(Object.prototype.hasOwnProperty.call(row, 'GÜNCEL DURUM\n(STATUS)'));
      assert.equal(row['GÜNCEL DURUM'], undefined);
    });
  });
});

test('v5.83 detay satırı Excel yazıcısının iç alanını taşımaz', () => {
  const rows = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, identitySelector);
  assert.equal(rows[0]._backlogExcel, undefined, '_backlogExcel yalnız Excel yolunda gerekir');
  // Excel yolu ise onu taşımaya devam etmeli.
  const template = parse.buildBacklogTemplateRows(orders(), antrepoForFirstLine(), overrides, [1234567]);
  assert.ok(template[0]._backlogExcel, 'Backlog Excel satırı yardımcı alanını korumalı');
});

test('v5.83 Backlog Excel satırı ile detay satırı aynı değerleri verir', () => {
  const detail = parse.buildBacklogDetailRows(orders(), antrepoForFirstLine(), overrides, [1234567]);
  const template = parse.buildBacklogTemplateRows(orders(), antrepoForFirstLine(), overrides, [1234567]);
  assert.equal(detail.length, template.length);
  detail.forEach((row, index) => {
    HEADERS.forEach(header => {
      const a = row[header] instanceof Date ? row[header].getTime() : row[header];
      const b = template[index][header] instanceof Date ? template[index][header].getTime() : template[index][header];
      assert.deepEqual(a, b, `${header} iki yolda da aynı olmalı`);
    });
  });
});
