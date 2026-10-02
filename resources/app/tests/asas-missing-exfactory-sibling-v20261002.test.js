'use strict';
// Kullanıcı raporu: 1384787 / KK.BDY,WONS — tek PO altında iki renk; 68Y
// renginde ASAS "Orijinal Exfactory Merch Tarih" boş, VJK'de 14.12.2026.
// Buyer Log boş rengin Ex-Factory'sini aynı Sipariş Kodundaki tarihli renkten
// alır ve durumu veri kalitesi uyarısında göstermeye devam eder.
process.env.TZ = 'Europe/Istanbul';

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');
const V3 = require('../public/backlog-v3-report.js');

const config = parse.defaultAntrepoMatchConfig();
function asas(ccode, ex, extra = {}) {
  return {
    'Sezon':'S7', 'Buyer':'X', 'Sipariş Kod':1384787, 'Özel Kod 1':'S7K322Z4', 'Model Adı':'KK.BDY,WONS', 'Renk Kod':ccode, 'Renk':ccode === '68Y' ? 'BLUE' : 'DULL YELLOW',
    'Orijinal Exfactory Merch Tarih':ex, 'Retail Depo Tarih Yıl Ay Gün':'20270315', 'Model Bütçe Tarih Yıl Ay Gün':'20270329',
    'Plm Kod':'1202973', 'Net Alım Sipariş Miktarı':1000, 'Kalan Alım Sipariş Miktarı':1000, ...extra,
  };
}
const day = d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d);

test('Ex-Factory boş renk aynı PO\'nun tarihli renginden tarihi alır ve işaret taşır', () => {
  const parsed = parse.parseASASRows([asas('68Y', ''), asas('VJK', '20261214')], config);
  const blue = parsed.orders.find(o => o.ccode === '68Y'), yellow = parsed.orders.find(o => o.ccode === 'VJK');
  assert.equal(day(blue.ex), '2026-12-14');
  assert.deepEqual(blue._exInheritedFrom, { ccode:'VJK', colour:'DULL YELLOW' });
  assert.equal(yellow._exInheritedFrom, undefined, 'tarihi olan renge dokunulmaz');
  assert.equal(parsed.exFactoryInherited.length, 1);

  const rows = parse.buildBacklogTemplateRows(parsed.orders, {}, { antrepoMatchConfig:config }, {});
  const blueRow = rows.find(r => r['Renk Kod'] === '68Y');
  assert.equal(day(blueRow['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']), '2026-12-14');
  assert.equal(blueRow._backlogExcel.exFactoryInheritedFrom, 'VJK');
  const quality = V3.dataQuality(V3.normalizeRows(rows, { today:'2026-10-02' }));
  const issue = quality.find(i => i.key === 'exInherited');
  assert.ok(issue, 'Buyer Log uyarmaya devam eder');
  assert.equal(issue.count, 1);
  assert.equal(issue.items[0].colourCode, '68Y');
});

test('birden çok tarihli renk varsa en erken tarih alınır; hiç tarih yoksa boş kalır', () => {
  const a = parse.parseASASRows([asas('68Y', ''), asas('VJK', '20261214'), asas('ABC', '20261201')], config).orders;
  assert.equal(day(a.find(o => o.ccode === '68Y').ex), '2026-12-01');
  const b = parse.parseASASRows([asas('68Y', ''), asas('VJK', '')], config);
  assert.ok(b.orders.every(o => !o.ex));
  assert.equal(b.exFactoryInherited.length, 0);
});
