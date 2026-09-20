'use strict';

// v5.75 — Backlog Excel'indeki iki sarı vurgu artık hücreye gömülü dolgu değil,
// çalışma kitabının içinde yaşayan koşullu biçimlendirme kuralı.
// Gerekçe: kullanıcı dosyayı açıp elle termin revizesi yaptığında ya da Gemi
// yüklemesini Gemi+Uçak'a çevirip riski YOK'a düşürdüğünde sarı rengin kendi
// kendine kalkması gerekiyor. Gömülü dolgu, dışa aktarım anındaki fotoğrafı
// dondurduğu için bunu yapamıyordu.

const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../public/backlog-excel-formulas');
const guards = require('../public/excel-workbook-guards');

const HEADERS = [
  'Retail Depo Tarih Yıl Ay Gün',      // A
  'GÜNCEL DURUM\n(STATUS)',            // B
  'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)', // C
  'YÜKLEME TİPİ',                      // D
  'ANTREPO-RETAIL',                    // E
  'RİSK\n(PRIORITY)',                  // F
];

function formatFor(sqrefStartsWith, list) {
  return list.find(item => item.sqref.startsWith(sqrefStartsWith));
}

test('v5.75 Revize Ex-Factory kuralı rapor gününü sabit seri numarası olarak yazar', () => {
  const list = formulas.conditionalFormats(HEADERS, 120, { reportDate: '2026-08-11' });
  const revised = formatFor('C2:', list);
  assert.ok(revised, 'Revize Ex-Factory sütunu için kural üretilmeli');
  assert.equal(revised.sqref, 'C2:C120');

  const rule = revised.rules[0];
  assert.equal(rule.type, 'expression');
  assert.equal(rule.style.fillColor, formulas.SOFT_YELLOW_FILL_RGB);
  // Tarih hücrenin KENDİSİNDEN okunur; elle revize edilince kural yeniden
  // değerlendirilir. Rapor günü seri numarası olarak gömülür: TODAY() değil,
  // böylece arşivlenen dosya günler geçtikçe kaymaz.
  assert.equal(rule.formula, 'AND($C2<>"",$C2<46245,OR($B2="Üretimde",$B2="Production"))');
  assert.equal(formulas.excelSerialDate('2026-08-11'), 46245);
});

test('v5.75 Yükleme Tipi kuralı RİSK hücresine bakar, gömülü değere değil', () => {
  const list = formulas.conditionalFormats(HEADERS, 10, { reportDate: '2026-08-11' });
  const delivery = formatFor('D2:', list);
  assert.ok(delivery, 'Yükleme Tipi sütunu için kural üretilmeli');
  assert.equal(delivery.sqref, 'D2:D10');

  const rule = delivery.rules[0];
  assert.equal(rule.type, 'expression');
  // Gemi+Uçak'a geçilince ANTREPO-RETAIL yeniden hesaplanır, RİSK "YOK" olur ve
  // kural düşer. Boş ANTREPO-RETAIL'de Excel metni sayıdan büyük saydığı için
  // RİSK "VAR" okunabiliyor; ISNUMBER bu satırları dışarıda tutar.
  assert.equal(
    rule.formula,
    'AND(OR(ISNUMBER(SEARCH("Gemi",$D2)),ISNUMBER(SEARCH("Sea",$D2))),ISNUMBER($E2),$F2="VAR")'
  );
});

test('v5.75 eksik sütunlarda kural üretilmez', () => {
  assert.deepEqual(formulas.conditionalFormats(['Sezon'], 50, {}), []);
  const partial = formulas.conditionalFormats(
    ['GÜNCEL DURUM\n(STATUS)', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)'],
    50,
    { reportDate: '2026-08-11' }
  );
  assert.equal(partial.length, 1, 'Yükleme Tipi sütunu yoksa yalnız tarih kuralı kalır');
});

test('v5.75 expression kuralı geçerli cfRule XML üretir', () => {
  const list = formulas.conditionalFormats(HEADERS, 30, { reportDate: '2026-08-11' });
  const xml = guards.conditionalFormattingXml(list[0], 3);
  assert.match(xml, /<conditionalFormatting sqref="C2:C30">/);
  assert.match(xml, /<cfRule type="expression" dxfId="3" priority="1" stopIfTrue="1">/);
  assert.match(xml, /&lt;46245/);
  assert.ok(!xml.includes('operator='), 'expression kuralında operator özniteliği olmamalı');
});

test('v5.75 cellIs kuralları eskisi gibi çalışmaya devam eder', () => {
  const xml = guards.conditionalFormattingXml({
    sqref: 'I2:Q2',
    rules: [{ value: 'Onaylandı', style: { fillColor: 'C6EFCE' } }],
  }, 0);
  assert.match(xml, /<cfRule type="cellIs" dxfId="0" priority="1" operator="equal" stopIfTrue="1">/);
});
