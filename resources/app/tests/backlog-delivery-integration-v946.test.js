'use strict';

/* v9.46 — UÇTAN UCA SÖZLEŞME: gerçek satır üreticisi → analiz motoru
 *
 * Korunan asıl kusur: motorun okuduğu alan adlarının, satırı GERÇEKTEN üreten
 * sunucu kodunun (server/lib/parse.js backlogTemplateRowsFromSegments)
 * yazdıklarıyla uyuşmaması. Birim testleri elle kurulmuş satırlarla çalışır;
 * bir anahtar sunucuda değişirse ("YÜKLEME TİPİ" → başka bir şey) birim
 * testleri geçmeye devam eder ama panel sahada boş/UNKNOWN gösterirdi.
 *
 * Bu yüzden burada satırlar elle YAZILMAZ: gerçek üretici çağrılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/backlog-delivery-engine.js');
const Insights = require('../public/backlog-delivery-insights.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');

/* ASAS sipariş nesnesinin gerçek alan adları (parse.js parseASASMatrix). */
function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 1001, _matchOcode: String(o.ocode || 1001),
    model: o.model || 'MODEL-1', ccode: o.ccode || 'C1', colour: o.colour || 'SIYAH',
    qty: o.qty == null ? 1000 : o.qty, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: 'PLM1', ozel: 'S7AB73Z4',
    manufacturer: o.manufacturer || 'MF-1', season: o.season || '26SS',
    category: 'CLASS-1', merch: o.merch || 'MAG-1', ageGroup: o.ageGroup || 'MMYG-1',
    buyerGrup: o.buyerGrup || 'BG-1', countryRaw: o.countryRaw || 'HINDISTAN',
    license: 'LIC', productDescription: 'TISORT',
    ex: o.ex || null, retail: o.retail || null, mb: o.mb || null,
    opd: o.opd || null, shipConf: o.shipConf || null,
    buyer: o.buyer || 'BUYER-1', line: 'LINE-1',
  };
}
/* Operasyon segmenti (parse.js backlogSegment çıktısının taşıdığı alanlar). */
function segment(base, spec) {
  const o = spec || {};
  return {
    ...base,
    qty: o.qty == null ? base.qty : o.qty,
    _status: o.status, _arr: o.arr || null, _delType: o.delType || 'Gemi',
    _iasRow: o.ias || null, _segmentKind: o.kind || 'ias', _segmentIndex: 0,
    _orderQty: base.qty, _asasKalan: 0, _loadedQty: o.kind === 'ias' ? (o.qty == null ? base.qty : o.qty) : 0,
    _subManufacturer: 'SUB-1',
  };
}

/* Gerçek bir Transfer Lead Time kuralı: motor, kural TANIMLI DEĞİLSE
   hesaplama yapmaz (requireTransitRule). Testler gerçek kurulumu taklit
   etmeli, yoksa her satır "Hesaplanamıyor" çıkardı. */
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];
function templateRows(segments, rules) {
  return parse.backlogTemplateRowsFromSegments(segments, { transitRules: rules === undefined ? TRANSIT_RULES : rules }, new Map(), []);
}

test('v9.46 gerçek üretici satırları motorun beklediği TÜM alanları taşıyor', () => {
  const base = order({ ex: '2026-06-01', retail: '2026-09-30', mb: '2026-10-20' });
  const rows = templateRows([segment(base, { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } })]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  // Motorun okuduğu her alan gerçekten üretiliyor mu?
  for (const key of Object.values(Engine.FIELDS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `üretici '${key}' alanını yazmıyor`);
  }
  assert.ok(row._backlogExcel, '_backlogExcel meta taşınmalı');
  for (const key of ['transitDays', 'handoverDate', 'actualAntrepoDate', 'signals', 'mag', 'mmyg']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row._backlogExcel, key), `_backlogExcel.${key} eksik`);
  }
  assert.equal(row._backlogExcel.mag, 'MAG-1');
  assert.equal(row._backlogExcel.mmyg, 'MMYG-1');
});

test('v9.46 gerçek satırlar analiz edilince UNKNOWN\'a düşmüyor (alan eşleşmesi doğru)', () => {
  const base = order({ ex: '2026-06-01', retail: '2026-09-30', mb: '2026-10-20' });
  const rows = templateRows([
    segment(base, { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } }),
    segment(order({ ocode: 1002, ex: '2026-08-01', retail: '2026-10-01' }), { status: 'Üretimde', kind: 'production' }),
  ]);
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  assert.equal(model.totals.rows, 2);
  assert.equal(model.dataQuality.unknown.rows, 0, 'gerçek satırlar hesaplanabilir olmalı');
  const stages = model.stages.map(item => item.key).sort();
  assert.deepEqual(stages, ['IN_TRANSIT', 'PRODUCTION']);
  // Yükleme tipi kanonik değere normalize edilmiş olmalı.
  assert.ok(model.dimensions.loadingType.every(bucket => ['Gemi', 'Uçak', 'Gemi+Uçak', 'Gemi+Tır'].includes(bucket.name)));
});

test('v9.46 adet toplamı sunucunun kendi sumQty tanımıyla aynı alandan gelir', () => {
  const base = order({ ocode: 2001, qty: 1000, ex: '2026-06-01', retail: '2026-09-30' });
  const segments = [
    segment(base, { status: 'Depoda', arr: '2026-08-10', kind: 'ias', qty: 400, ias: { handover: '2026-06-01' } }),
    segment(base, { status: 'Üretimde', kind: 'production', qty: 600 }),
  ];
  const rows = templateRows(segments);
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  // Backlog pivotu sumQty ile segment qty'lerini toplar; şablonda karşılığı 'Adet'.
  const serverTotal = segments.reduce((total, item) => total + item.qty, 0);
  assert.equal(model.totals.qty, serverTotal, 'analiz toplamı sunucunun segment toplamıyla aynı olmalı');
  assert.equal(model.totals.orders, 1, 'aynı sipariş+model+renk tek sipariş sayılmalı');
});

test('v9.46 sunucunun structured operational signals çıktısı analizde risk sebebine dönüşüyor', () => {
  const base = order({ ocode: 3001, ex: '2026-05-01', retail: '2026-08-01' });
  const rows = templateRows([segment(base, { status: 'Yol Operasyonları', arr: '2026-08-20', kind: 'ias', ias: { handover: '2026-05-01' } })]);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0]._backlogExcel,'priority'), false);
  assert.ok(rows[0]._backlogExcel.signals.some(item=>item.code==='ANTREPO_DELAY'));
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  const analysis = model.orders[0];
  assert.ok(analysis.riskReasons.includes('RETAIL_TRANSFER_DELAY'),
    `kanonik ANTREPO_DELAY sinyali sebebe dönüşmeli: ${analysis.riskReasons.join(',')}`);
});

test('v9.46 uçtan uca: gerçek satırlardan yorum üretiliyor ve listesi tıklanabilir', () => {
  const rows = templateRows([
    segment(order({ ocode: 4001, ex: '2026-08-01', retail: '2026-08-20' }), { status: 'Üretimde', kind: 'production' }),
    segment(order({ ocode: 4002, ex: '2026-06-01', retail: '2026-12-30' }), { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } }),
  ]);
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  const list = Insights.build(model, { lang: 'tr' });
  assert.ok(list.length, 'gerçek veriden yorum üretilmeli');
  const withOrders = list.find(insight => insight.orders.length);
  assert.ok(withOrders, 'en az bir yorum sipariş listesi taşımalı');
  // Drill-down için ham satır referansı korunmuş olmalı.
  assert.ok(withOrders.orders[0].sourceRow, 'yorumdaki sipariş ham satıra bağlı olmalı');
  assert.ok(withOrders.orders[0].sourceRow['Sipariş Kod'], 'ham satır gerçek şablon satırı olmalı');
});
