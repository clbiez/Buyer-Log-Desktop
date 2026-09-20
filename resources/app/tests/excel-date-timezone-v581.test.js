'use strict';

// v5.81 — Excel tarihlerinde saat dilimi kayması.
//
// SORUN: Excel tarihi 30.12.1899'dan itibaren GÜN SAYISI olarak saklar; bu bir
// takvim günüdür, bir zaman anı değil. Uygulamadaki tarihler ise yerel gece
// yarısına ayarlı Date nesneleri.
//
//   · YAZMA: ExcelJS dönüşümü tamamen UTC üzerinden yapıyordu
//     (25569 + getTime()/86400000). Türkiye UTC+3 olduğu için 2 Ocak yerel gece
//     yarısı 46023,875 seri numarası veriyor ve Excel tam sayı kısmına baktığı
//     için hücrede 01.01.2026 görünüyordu — kullanıcının bildirdiği hata.
//   · OKUMA: SheetJS cellDates:true ile seriyi Date'e çevirirken 1899 yılının
//     yerel saat farkını kullanıyor. İstanbul'da o dönem +01:56:56 olduğu için
//     46024 hücresi "01.01.2026 23:59:04" olarak geri geliyordu.
//
// ÇÖZÜM: hiçbir kütüphanenin saat dilimi matematiğine güvenilmez. Tarihler
// kendi hesapladığımız TAM SAYI seri numarası olarak yazılır, okunanlar gece
// yarısına yakınsa gün başına yuvarlanır.

const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../public/excel-date-utils');

test('v5.81 seri numarası takvim gününden üretilir, saatten değil', () => {
  // Aynı takvim günü, üç farklı Date kurgusu — hepsi aynı seriyi vermeli.
  assert.equal(dates.excelSerial(new Date(2026, 0, 2)), 46024);
  assert.equal(dates.excelSerial(new Date(Date.UTC(2026, 0, 2))), 46024);
  assert.equal(dates.excelSerial('02.01.2026'), 46024);
  assert.equal(dates.excelSerial('2026-01-02'), 46024);
  // Sonuç her zaman tam sayı: kesirli kısım Excel'de bir gün kaymaya yol açar.
  assert.equal(dates.excelSerial(new Date(2026, 0, 2)) % 1, 0);
  assert.equal(dates.excelSerial(new Date(2025, 11, 31)), 46022);
  assert.equal(dates.excelSerial(null), null);
  assert.equal(dates.excelSerial('metin'), null);
});

test('v5.81 ExcelJS hücresine Date değil hazır seri yazılır', () => {
  // ExcelJS Date'i UTC üzerinden çevirdiği için Date vermek bir gün kaydırırdı.
  const cell = {};
  assert.equal(dates.writeExcelJsSerial(cell, new Date(2026, 0, 2)), true);
  assert.equal(cell.value, 46024);
  assert.equal(typeof cell.value, 'number');
  assert.equal(cell.numFmt, dates.DATE_FORMAT);
});

test('v5.81 SheetJS hücresi sayı tipine çevrilir ve kesirli artık kalmaz', () => {
  // Eski hâlde İstanbul'un 1899 saat farkı yüzünden seriye 56 saniyelik bir
  // artık biniyordu; gün doğru görünse de hücre temiz bir gün değildi.
  const cell = { t: 'd', v: new Date(2026, 0, 2) };
  assert.equal(dates.writeSerialCell(cell, cell.v), true);
  assert.equal(cell.t, 'n');
  assert.equal(cell.v, 46024);
  assert.equal(cell.z, dates.DATE_FORMAT);
});

test('v5.81 hücrede zaten bir tarih biçimi varsa korunur', () => {
  const sheetCell = { t: 'd', v: new Date(2026, 0, 2), z: 'dd.mm.yy' };
  dates.writeSerialCell(sheetCell, sheetCell.v);
  assert.equal(sheetCell.z, 'dd.mm.yy');

  const excelCell = { numFmt: 'dd.mm.yy' };
  dates.writeExcelJsSerial(excelCell, new Date(2026, 0, 2));
  assert.equal(excelCell.numFmt, 'dd.mm.yy');

  // Sayı biçimi tarih biçimi değildir; üzerine tarih biçimi konmalı.
  assert.equal(dates.looksLikeDateFormat('#,##0.00'), false);
  assert.equal(dates.looksLikeDateFormat('General'), false);
  assert.equal(dates.looksLikeDateFormat('dd.mm.yyyy'), true);
});

test('v5.81 okunan tarih gece yarısına yakınsa gün başına yuvarlanır', () => {
  // SheetJS'in cellDates:true ile ürettiği bozuk değer.
  const broken = new Date(2026, 0, 1, 23, 59, 4);
  assert.equal(dates.snapReadDate(broken).getTime(), new Date(2026, 0, 2).getTime());
  // Diğer yön: gün başından birkaç saniye sonra.
  assert.equal(dates.snapReadDate(new Date(2026, 0, 2, 0, 0, 56)).getTime(), new Date(2026, 0, 2).getTime());
  // Zaten gün başındaysa dokunulmaz.
  assert.equal(dates.snapReadDate(new Date(2026, 0, 2)).getTime(), new Date(2026, 0, 2).getTime());
});

test('v5.81 gerçek saat taşıyan zaman damgaları yuvarlanmaz', () => {
  // Pencere dar (5 dk): iş saatlerindeki bir zaman damgası bozulmamalı.
  const stamp = new Date(2026, 0, 2, 14, 30, 0);
  assert.equal(dates.snapReadDate(stamp).getTime(), stamp.getTime());
  const early = new Date(2026, 0, 2, 0, 30, 0);
  assert.equal(dates.snapReadDate(early).getTime(), early.getTime());
  assert.equal(dates.MIDNIGHT_SNAP_MS, 5 * 60 * 1000);
});

test('v5.81 calendarParts UTC gece yarısı ile yerel gece yarısını ayırt eder', () => {
  // ISO metinden gelen tarih UTC gece yarısıdır; negatif saat dilimlerinde yerel
  // bileşenleri okumak bir gün geri verirdi.
  assert.deepEqual(dates.calendarParts(new Date(Date.UTC(2026, 0, 2))), { year: 2026, month: 1, day: 2 });
  assert.deepEqual(dates.calendarParts(new Date(2026, 0, 2)), { year: 2026, month: 1, day: 2 });
  assert.equal(dates.calendarParts('geçersiz'), null);
});

test('v5.81 okuma ve yazma kancalarının ikisi de kurulur', () => {
  const calls = [];
  const fake = {
    utils: {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
      encode_cell: () => 'A1',
    },
    read: () => { calls.push('read'); return { SheetNames: [], Sheets: {} }; },
    readFile: () => { calls.push('readFile'); return { SheetNames: [], Sheets: {} }; },
    write: () => { calls.push('write'); return 'buf'; },
    writeFile: () => { calls.push('writeFile'); return true; },
  };
  assert.equal(dates.installSheetJsHooks(fake), true);
  // İkinci kez kurulmamalı; aksi halde sarmalayıcılar üst üste binerdi.
  assert.equal(dates.installSheetJsHooks(fake), false);

  fake.read(); fake.readFile(); fake.write({}); fake.writeFile({});
  assert.deepEqual(calls, ['read', 'readFile', 'write', 'writeFile']);
});

test('v5.81 SheetJS gidiş-dönüşü aynı takvim gününü verir', () => {
  const XLSX = require('xlsx');
  dates.installSheetJsHooks(XLSX);
  const sheet = XLSX.utils.aoa_to_sheet([['Ex-Factory Tarih'], [new Date(2026, 0, 2)]], { cellDates: true });
  const buffer = XLSX.write({ SheetNames: ['S'], Sheets: { S: sheet } }, { type: 'buffer', bookType: 'xlsx' });

  // Ham okuma: hücre tam sayı seri olmalı.
  const raw = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  assert.equal(raw.Sheets.S.A2.v, 46024);

  // Date olarak okuma: gün kaymamalı.
  const parsed = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const value = parsed.Sheets.S.A2.v;
  assert.ok(value instanceof Date);
  assert.equal(value.getFullYear(), 2026);
  assert.equal(value.getMonth(), 0);
  assert.equal(value.getDate(), 2);
});
