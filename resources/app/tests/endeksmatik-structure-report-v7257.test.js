'use strict';

// v7.0.257 — Endeksmatik yapı raporu.
// Ülke dosyaları büyük ve şirket verisi; ne buraya ne bir yapay zekâ aracına
// yüklenebiliyor. Rapor dosyayı yerelde okur ve paylaşılabilir, MASKELİ bir
// yapı özeti üretir. Korunanlar: iş değerleri sızmaz, başlık/formüller görünür,
// eşleşmeyi bozan alan örtüşme tablosunda okunur.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = require('./helpers/endeksmatik-fixture');
const { structureReport, shape } = require('../server/lib/endeksmatik-report');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('maske değeri gizler, biçimi ve boşluk sorunlarını gösterir', () => {
  assert.equal(shape('CUW4'), 'A×3 9');
  assert.equal(shape('KEY ORME BODY'), 'A×3 _ A×4 _ A×4');
  assert.equal(shape('Toplam CUW4'), '«Toplam» A×3 9');
  assert.equal(shape('CUW4 Toplam'), 'A×3 9 «Toplam»');
  assert.match(shape(' ÖRME '), /\[kenarda boşluk\]/);
  assert.match(shape('KEY  ORME'), /\[çift boşluk\]/);
  assert.equal(shape(''), '∅');
  assert.equal(shape(1.5), 'sayı');
});

test('rapor iş değerlerini (klasman, marka, pay, endeks) içermez', () => {
  const report = structureReport(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  for (const cls of fixture.CLASSES) for (const value of cls.dims) {
    // Formüllerdeki alan adları dışında hiçbir boyut değeri görünmemeli.
    assert.equal(report.includes(value), false, `sızan değer: ${value}`);
  }
  // Başlıktaki üretim zamanı (ör. 04:35:50.123Z) iş verisi değildir; saniyesi 0
  // ile bittiğinde "0.123" gibi okunup testi rastgele düşürüyordu.
  const withoutTimestamp = report.replace(/üretildi: \S+/, 'üretildi: <zaman>');
  assert.equal(/0\.\d{3,}/.test(withoutTimestamp), false, 'sayısal pay/endeks değeri sızmamalı');
  assert.ok(Buffer.byteLength(report) < 40 * 1024, 'rapor küçük kalmalı');
});

test('rapor başlıkları, ENDEKSMATİK formüllerini ve ayları açık yazar', () => {
  const report = structureReport(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  assert.match(report, /boyut sütunları: MERCH MARKA YAS GRUP → B "Merch Marka Yaş Grup"/);
  assert.match(report, /ay sütunları: 6 \(202411 → 202702\)/);
  assert.match(report, /C15 +sayı +=GETPIVOTDATA/);
  assert.match(report, /C11 +202607/);
  assert.match(report, /✔ kabul edilir: 4 klasman/);
});

test('örtüşme tablosu eşleşmeyi bozan alanı gösterir', () => {
  const report = structureReport(fixture.buildEndeksmatikWorkbook({ summaryMismatch: true }), 'x.xlsx');
  assert.match(report, /KLASMAN +özet=3 +pivot=3 +ortak=0/);
  assert.match(report, /TEDARIK GRUP +özet=2 +pivot=2 +ortak=2/);
  assert.match(report, /✘ NO_RECORDS/);
  // NO_RECORDS mesajı örnek anahtar içerir; rapora yalnız kod yazılır.
  assert.equal(report.includes('KEY ORME BODY X'), false);
});

test('rota yükleme yetkisine bağlı; arayüz Endeksmatik Setleri\'nden açar', () => {
  assert.match(SERVER, /app\.post\('\/api\/endeksmatik\/structure-report', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(APP, /data-em-structure-report/);
  assert.match(APP, /fetch\('\/api\/endeksmatik\/structure-report'/);
  assert.match(APP, /Yapı raporu ile paylaşılabilir, maskeli bir rapor/);
});
