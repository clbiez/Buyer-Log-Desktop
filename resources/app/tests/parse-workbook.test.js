'use strict';

/*
 * Ayrıştırma katmanı (workbook → satır) regresyon testleri.
 *
 * Bu testler, mevcut testlerin aksine xlsx'i STUB'LAMAZ; gerçek .xlsx fixture'larını
 * server/workers/excel-worker.js ile AYNI okuma yolundan okuyup gerçek parse
 * fonksiyonlarına verir. Böylece şu ana dek testsiz olan davranışlar kilitlenir:
 * çapa satırı tespiti, tekilleştirme, qty>0 / YARDIM / fob<=0 / miktar<=0 / eksik-boyut
 * filtreleri, bulanık başlık eşleştirme, "Ana Kumaş Mı" mantığı ve Antrepo handover
 * korunumu. Fixture'lar kütüphaneden bağımsız binary olduğundan, ileride okuyucu
 * kütüphane değişirse (ör. xlsx → ExcelJS) bu testler kabul kapısı olur.
 *
 * Fixture'ları yeniden üretmek için: node tests/fixtures/generate-parse-fixtures.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const { parseASASWorkbook, parseFabricWorkbook, applyFabricEntries, parseAntrepoWorkbook, parseCPUpdateWorkbook } = require('../server/lib/parse');
const { parseLFLWorkbook } = require('../server/lib/lfl');

const FIX = path.join(__dirname, 'fixtures');

// excel-worker.js loadSources yolu: XLSX.readFile(path, { cellDates:false, raw:true })
function readRaw(file) {
  return XLSX.read(fs.readFileSync(path.join(FIX, file)), { type: 'buffer', cellDates: false, raw: true });
}
// excel-worker.js parseLflBuffer yolu: XLSX.read(buffer, { cellDates:true })
function readDates(file) {
  return XLSX.read(fs.readFileSync(path.join(FIX, file)), { type: 'buffer', cellDates: true });
}
function isoOf(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('ASAS: çapa tespiti, tekilleştirme, qty>0 ve YARDIM filtreleri', () => {
  const parsed = parseASASWorkbook(readRaw('asas-sample.xlsx'));
  assert.ok(parsed, 'ASAS ayrıştırması null döndürmemeli (çapa satırı bulunmalı)');
  const codes = parsed.orders.map(o => o.ocode).sort((a, b) => a - b);
  assert.deepEqual(codes, [1001, 1004], 'Yalnız qty>0 ve YARDIM-dışı benzersiz siparişler kalmalı');

  const o1001 = parsed.orders.find(o => o.ocode === 1001);
  assert.equal(o1001.qty, 500, 'Tekilleştirmede ilk kayıt korunmalı (999 değil 500)');
  assert.equal(parsed.orders.filter(o => o.ocode === 1001).length, 1, 'Aynı sipariş-renk tek kez');

  assert.ok(!parsed.orders.some(o => o.ocode === 1002), 'qty=0 sipariş elenmeli');
  assert.ok(!parsed.orders.some(o => o.ocode === 1003), 'YARDIM buying grubu elenmeli');
});

// v4.72: "Ana Kumaş Mı"=1 satırındaki kumaş bilgileri artık ana ASAS ayrıştırıcısı
// tarafından DOĞRUDAN dolduruluyor (server/lib/parse.js:846-880) — ayrı bir
// "ASAS - Fabric" birleştirmesi beklenmiyor. Bu davranış aşağıdaki teste de aynı
// fixture ile applyFabricEntries üzerinden ayrıca doğrulanıyor.
test('ASAS: ana sipariş kaynağı "Ana Kumaş Mı"=1 satırından kumaş bilgisini doğrudan taşır', () => {
  const parsed = parseASASWorkbook(readRaw('asas-sample.xlsx'));
  const o1001 = parsed.orders.find(o => o.ocode === 1001);
  assert.equal(o1001.karisim, '%100 PAMUK');
  assert.equal(o1001.iplikNo, '30/1');
  assert.equal(o1001.kumasTipi, 'Süprem');
  assert.equal(o1001.fabricWeight, '180');
  assert.equal(o1001.merkezSevkeHazirKalan, 25, 'Merkez Sevke Hazır kalan miktarı ana ASAS içinde kullanılmaya devam etmeli');
});

test('ASAS - Fabric: Sipariş Kod + Renk eşleşir ve yalnız Ana Kumaş Mı=1 satırları uygulanır', () => {
  const asas = parseASASWorkbook(readRaw('asas-sample.xlsx'));
  const fabric = parseFabricWorkbook(readRaw('asas-sample.xlsx'));
  assert.equal(fabric.meta.entryCount, 1);
  assert.equal(fabric.meta.ignoredNonMainRows, 1);
  const merged = applyFabricEntries(asas.orders, fabric.entries);
  const o1001 = merged.find(o => o.ocode === 1001);
  assert.equal(o1001.iplikNo, '30/1');
  assert.equal(o1001.fabricWeight, '180');
  assert.equal(o1001.kumasTipi, 'Süprem');
  assert.equal(o1001.karisim, '%100 PAMUK');
  const o1004 = merged.find(o => o.ocode === 1004);
  assert.equal(o1004.kumasTipi, '', 'Ana Kumaş Mı=0 satırı ayrı kumaş kaynağından uygulanmamalı');
});

test('Antrepo: /antrepo/i sheet seçimi doğru sayfayı okur, iki parsiyel BİRLEŞTİRİLMEDEN ayrı korunur', () => {
  // v6.53 — v4.31/v4.32 ve v6.35'te kayıtlı kök neden: "Sipariş+Renk" gibi
  // birleşik bir anahtar kullanmak, aynı siparişin farklı parsiyellerinin
  // birbirinin statüsünü/tarihini DEVRALMASINA yol açıyordu. Harita anahtarı bu
  // yüzden __ias_row_N (yalnız kaynak satır kimliği) oldu; "en geç giriş kazanır"
  // gibi bir BİRLEŞTİRME artık YOK — iki parsiyel her zaman ayrı kalır. Fixture
  // da v4.17'nin üçlü anahtarına (Sipariş Kod + Model Adı + Renk Kod) uyacak
  // şekilde güncellendi; eski "yalnız Renk Tanım" şeması başlık satırını hiç
  // BULDURMUYORDU (findAntrepoHeaderRow üçünü birlikte arıyor).
  const map = parseAntrepoWorkbook(readRaw('antrepo-sample.xlsx'));
  const rows = Object.keys(map).filter(k => k.startsWith('__ias_row_')).map(k => map[k]);
  assert.equal(rows.length, 2, 'decoy "Kapak" sheet değil "Antrepo Raporu" okunmalı ve iki satır da bulunmalı');
  assert.ok(rows.every(r => r.ocode === '2001' && r.model === 'Model A' && r.ccode === 'K01'),
    'her iki satır da aynı üçlü kimliğe (sipariş+model+renk kod) sahip olmalı');

  const early = rows.find(r => r.statu === 'Depoda');
  const late = rows.find(r => r.statu === 'Yolda');
  assert.ok(early && late, 'iki farklı statülü satır da bulunmalı — biri diğerini ezmemiş');
  assert.equal(isoOf(early.arr), '2026-05-01');
  assert.equal(isoOf(late.arr), '2026-05-15');
  assert.ok(early.handover, 'erken parsiyelin HANDOVER\'ı korunmalı');
  assert.equal(isoOf(early.handover), '2026-06-10');
  assert.equal(late.handover, null, 'geç parsiyelin boş HANDOVER\'ı erken parsiyelden DEVRALINMAMALI');
});

test('CP-Update: PO ve PO2 aynı supplier/fob\'a eşlenir, FOB half-up yuvarlanır', () => {
  const res = parseCPUpdateWorkbook(readRaw('cpupdate-sample.xlsx'));
  assert.equal(res.submap[3001], 'ACME');
  assert.equal(res.submap[3002], 'ACME', 'PO2 de aynı supplier\'a eşlenmeli');
  assert.equal(res.suppfobmap[3001], 9.88, 'Manufacturer FOB 9.876 → half-up 9.88');
  assert.equal(res.suppfobmap[3002], 9.88);
  assert.equal(res.sub, 2, 'İki PO sütunu da supplier saymalı');
  assert.equal(res.fob, 2, 'İki PO sütunu da FOB saymalı');
});

test('LFL: skorla başlık tespiti; fob<=0, miktar<=0, boş ve eksik-boyut satırları elenir', () => {
  const result = parseLFLWorkbook(readDates('lfl-sample.xlsx'));
  assert.equal(result.rows.length, 2, 'Yalnız iki tam-geçerli satır kalmalı (5001, 5004)');

  const seasons = result.rows.map(r => r.season).sort();
  assert.deepEqual(seasons, ['W6', 'W7']);

  assert.equal(result.meta.skippedMissingPrice, 1, 'fob<=0 satır fiyat-yok olarak elenmeli');
  assert.equal(result.meta.skippedMissingQuantity, 1, 'miktar<=0 satır miktar-yok olarak elenmeli');
  assert.equal(result.meta.skippedMissingDimensions, 1, 'MAG boş satır eksik-boyut olarak elenmeli');
  assert.ok(result.meta.skippedEmpty >= 1, 'Tamamen boş satır elenmeli');

  const r5001 = result.rows.find(r => r.orderCode === '5001');
  assert.equal(r5001.fob, 8.5);
  assert.equal(r5001.quantity, 1200);
  assert.equal(r5001.inStore, '2026-09-01');
});
