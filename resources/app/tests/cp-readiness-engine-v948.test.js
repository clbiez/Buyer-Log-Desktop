'use strict';

/* v9.48 — CP ÜRETİM HAZIRLIK / ÖNCELİK MOTORU
 *
 * Korunan asıl kusurlar:
 * 1) CP Overview'un Backlog Teslimat Analizi'nden FARKLI bir teslimat sonucu
 *    göstermesi. Aynı sipariş iki ekranda iki farklı cevap verirse rapor
 *    güvenilirliği biter; bu yüzden motor teslimat sınıflandırmasını kendisi
 *    yapmaz ve test bunu birebir ölçer.
 * 2) CP'de KARŞILIĞI OLMAYAN veriden (PPS, test, kumaş hazırlığı, aksesuar,
 *    üretim aşaması, üretici teyidi) uyarı üretmek. Var olmayan
 *    alan "eksik" değildir; motor bunu UNAVAILABLE_DIMENSIONS olarak
 *    raporlamak zorundadır.
 *
 * Satırlar elle yazılmaz: gerçek CP satır üreticisi (parse.buildCPRowsFromASAS)
 * çağrılır — bir anahtar sunucuda değişirse test kırılsın.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/cp-readiness-engine.js');
const Delivery = require('../public/backlog-delivery-engine.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

/* ASAS sipariş nesnesinin gerçek alan adları (parse.js parseASASMatrix). */
function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 9001, _matchOcode: String(o.ocode || 9001),
    model: o.model || 'MODEL-1', ccode: o.ccode || 'C1', colour: 'SIYAH',
    qty: o.qty == null ? 1000 : o.qty, kalan: o.kalan == null ? 1000 : o.kalan,
    antrepo: o.antrepo || 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: 'PLM1', ozel: 'S7AB73Z4',
    manufacturer: o.manufacturer || 'MF-1', season: o.season || '26SS',
    category: 'CLASS-1', merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1',
    countryRaw: o.countryRaw || 'HINDISTAN', license: 'LIC', productDescription: 'TISORT',
    opd: o.opd || null, ex: o.ex || null, retail: o.retail || null, mb: o.mb || null,
    shipConf: null, buyer: o.buyer || 'BUYER-1', line: 'LINE-1',
  };
}
function cpRows(orders, antrepo) {
  return parse.buildCPRowsFromASAS(orders, antrepo || new Map(), { transitRules: TRANSIT_RULES });
}
function analyze(orders, ctx) {
  return Engine.analyze(cpRows(orders), { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES, ...(ctx || {}) });
}

test('v9.48 gerçek CP satırları motorun beklediği TÜM alanları taşıyor', () => {
  const rows = cpRows([order({ opd: '2026-07-01', ex: '2026-10-01', retail: '2027-01-15', mb: '2027-02-01' })]);
  assert.equal(rows.length, 1);
  for (const key of Object.values(Engine.FIELDS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(rows[0], key), `CP üreticisi '${key}' alanını yazmıyor`);
  }
});

test('v9.48 teslimat sonucu KANONİK motordan gelir, CP kendi sınıflandırmasını yapmaz', () => {
  const orders = [
    order({ ocode: 9101, opd: '2026-07-01', ex: '2026-10-01', retail: '2027-02-01' }),
    order({ ocode: 9102, opd: '2026-01-10', ex: '2026-08-01', retail: '2026-09-20' }),
    order({ ocode: 9103, opd: '2026-03-01', ex: '2026-09-20', retail: '2026-10-05' }),
  ];
  const rows = cpRows(orders);
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES });
  assert.equal(model.totals.rows, 3);
  rows.forEach((row, index) => {
    const analysis = model.orders[index];
    // Aynı satır teslimat motoruna doğrudan verildiğinde AYNI sonucu vermeli.
    const direct = Delivery.analyzeOrder(
      Engine.toDeliveryRow(row, analysis.transitDays, analysis.transitRuleDefined ? { id: 'x' } : null, analysis.stage),
      { today: TODAY, dateOrdinal: ord, settings: { targetType: 'retail', requireTransitRule: true } });
    assert.equal(analysis.deliveryOutcome, direct.deliveryOutcome,
      `CP ve Backlog aynı sipariş için farklı teslimat sonucu veremez (${analysis.orderCode})`);
    assert.equal(analysis.eta, direct.eta);
    assert.equal(analysis.scheduleBufferDays, direct.scheduleBufferDays);
  });
});

test('v9.48 Order Age OPD (Sipariş Yerleştirme Tarihi) üzerinden hesaplanır', () => {
  const model = analyze([order({ ocode: 9201, opd: '2026-08-06', ex: '2026-11-01', retail: '2027-02-01' })]);
  assert.equal(model.orders[0].orderAgeDays, 30);
  // OPD yoksa yaş UYDURULMAZ.
  const noDate = analyze([order({ ocode: 9202, opd: null, ex: '2026-11-01', retail: '2027-02-01' })]);
  assert.equal(noDate.orders[0].orderAgeDays, null);
  assert.equal(noDate.dataQuality.missing.orderDate, 1);
});

test('v9.48 yükleme geri sayımı ve hafta kovaları doğru', () => {
  assert.equal(Engine.loadWindowOf(-1), 'OVERDUE');
  assert.equal(Engine.loadWindowOf(0), 'W0_2');
  assert.equal(Engine.loadWindowOf(14), 'W0_2');
  assert.equal(Engine.loadWindowOf(15), 'W2_4');
  assert.equal(Engine.loadWindowOf(42), 'W4_6');
  assert.equal(Engine.loadWindowOf(43), 'W6_8');
  assert.equal(Engine.loadWindowOf(57), 'W8_PLUS');
  assert.equal(Engine.loadWindowOf(null), 'UNKNOWN');
  const model = analyze([order({ ocode: 9301, opd: '2026-06-01', ex: '2026-09-15', retail: '2027-01-01' })]);
  assert.equal(model.orders[0].daysToLoad, 10);
  assert.equal(model.orders[0].loadWindow, 'W0_2');
});

test('v9.48 Ex-Factory geçmiş ve sipariş hâlâ üretimdeyse öncelik CRITICAL', () => {
  const model = analyze([order({ ocode: 9401, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-11-01' })]);
  const analysis = model.orders[0];
  assert.equal(analysis.stage, 'PRODUCTION');
  assert.ok(analysis.daysToLoad < 0);
  assert.equal(analysis.priority, 'CRITICAL');
  assert.ok(analysis.riskReasons.includes('EX_FACTORY_OVERDUE'));
});

test('v9.48 uzak tarihli sağlıklı sipariş ON_TRACK, sebep listesi boş', () => {
  const model = analyze([order({ ocode: 9501, opd: '2026-08-20', ex: '2026-12-01', retail: '2027-06-01', mb: '2027-07-01' })]);
  const analysis = model.orders[0];
  assert.equal(analysis.deliveryOutcome, 'ON_TRACK');
  assert.equal(analysis.priority, 'ON_TRACK');
  assert.deepEqual(analysis.riskReasons, []);
});

test('v9.48 yol süresi kuralı yoksa hesap yapılmaz: UNKNOWN kalır, zorla riske sokulmaz', () => {
  const rows = parse.buildCPRowsFromASAS([order({ ocode: 9601, opd: '2026-07-01', ex: '2026-10-01', retail: '2026-11-01' })], new Map(), { transitRules: [] });
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: [] });
  const analysis = model.orders[0];
  assert.equal(analysis.transitRuleMissing, true);
  assert.equal(analysis.deliveryOutcome, 'UNKNOWN');
  assert.equal(analysis.priority, 'WATCH');
  assert.equal(analysis.calculationStatus, 'UNKNOWN');
  assert.ok(analysis.riskReasons.includes('MISSING_TRANSIT_RULE'));
  assert.equal(model.dataQuality.missing.transitRule, 1);
});

/* CANLI ÖLÇÜMDE GÖRÜLEN GERÇEK HATA (v9.48 geliştirmesi sırasında):
   CP'nin 'Ant. Arrival' sütunu sipariş HÂLÂ ÜRETİMDEYKEN boş değildir —
   applyFormulas onu varsayılan yol süresinden TÜRETİR. Bu türetilmiş tarih
   teslimat motoruna "gerçekleşen antrepo girişi" diye verilince, yol süresi
   kuralı hiç tanımlı olmasa bile etaSource='ias' ve confidence='HIGH' olan
   SAHTE ama kesin görünen bir ETA çıkıyordu. */
test('v9.48 üretimdeki siparişin türetilmiş Ant. Arrival tarihi GERÇEKLEŞEN sayılmaz', () => {
  const rows = cpRows([order({ ocode: 9702, opd: '2026-07-01', ex: '2026-10-01', retail: '2026-11-01' })]);
  assert.ok(rows[0]['Ant. Arrival'], 'CP üretimdeki sipariş için de bir Ant. Arrival türetiyor (ön koşul)');
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: [] });
  const analysis = model.orders[0];
  assert.equal(analysis.stage, 'PRODUCTION');
  assert.notEqual(analysis.etaSource, 'ias', 'türetilmiş tarih gerçekleşen veri gibi sunulamaz');
  assert.equal(analysis.deliveryOutcome, 'UNKNOWN', 'kural yokken kesin bir sonuç üretilemez');
  assert.notEqual(analysis.confidence, 'HIGH');
  // Sevk edilmiş sipariş için AYNI alan gerçekten gerçekleşen veridir.
  assert.equal(Engine.toDeliveryRow(rows[0], 70, { id: 'r' }, 'IN_WAREHOUSE')._backlogExcel.actualAntrepoDate, rows[0]['Ant. Arrival']);
  assert.equal(Engine.toDeliveryRow(rows[0], 70, { id: 'r' }, 'PRODUCTION')._backlogExcel.actualAntrepoDate, null);
});

test('v9.48 CP\'de KARŞILIĞI OLMAYAN boyutlar açıkça raporlanır, uyarıya dönüşmez', () => {
  const model = analyze([order({ ocode: 9701, opd: '2026-07-01', ex: '2026-10-01', retail: '2027-01-01' })]);
  const keys = model.dataQuality.unavailableDimensions.map(item => item.key);
  for (const expected of ['samples', 'tests', 'fabricReadiness', 'accessories', 'productionStage', 'supplierConfirmation', 'merchandiser', 'revisionHistory']) {
    assert.ok(keys.includes(expected), `${expected} veri yok olarak raporlanmalı`);
  }
  // Tarih senkronu ASAS DB'den GELİYOR: "veri yok" listesinde olmamalı.
  assert.ok(!keys.includes('troyDate'));
  assert.ok(!keys.some(key => /dateSync/i.test(key)));
  // Bu boyutlardan HİÇBİRİ risk sebebi üretmemeli.
  const reasons = model.riskReasons.map(item => item.name);
  for (const forbidden of ['PPS_PENDING', 'TEST_PENDING', 'FABRIC_NOT_READY', 'ACCESSORY_NOT_READY', 'SUPPLIER_CONFIRMATION_MISSING']) {
    assert.ok(!reasons.includes(forbidden), `${forbidden} veri olmadan üretilemez`);
  }
  assert.ok(!Engine.RISK_REASONS.includes('SUPPLIER_CONFIRMATION_MISSING'));
});

/* Tarih senkronu kaynağı ASAS DB'dir: parse.js her satıra ASAS'ın kendi
   tarihlerini (_asasExFactory / _asasRetailDate / _asasInStore) yazar. Buyer
   Log'da bir tarih revize edilince görünen sütun değişir, bu alanlar ASAS'ın
   hâlâ ne dediğini taşır. Fark = senkron sorunu. */
test('v9.48 Buyer Log revizyonu ASAS tarihinden ayrıldığında senkron sorunu raporlanır', () => {
  const base = order({ ocode: 9970, opd: '2026-06-01', ex: '2026-10-01', retail: '2027-01-01', mb: '2027-02-01' });
  // Gerçek akış: sunucu önce applyDateOverrides'ı çalıştırır (server.js:5876),
  // sonra satırları kurar. Anahtar sipariş+model+renk üçlüsüdür.
  const overrides = { transitRules: TRANSIT_RULES, datemap: { [`${base.ocode}|${base.model}|${base.ccode}`]: { ex: '2026-11-15' } } };
  const patched = parse.applyDateOverrides([base], overrides);
  const revised = parse.buildCPRowsFromASAS(patched, new Map(), overrides);
  const row = revised[0];
  assert.ok(row._asasExFactory, 'ASAS baseline satırda taşınmalı (ön koşul)');
  assert.notEqual(ord(row['Ex-factory']), ord(row._asasExFactory), 'revizyon uygulanmış olmalı (ön koşul)');

  const model = Engine.analyze(revised, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES });
  const analysis = model.orders[0];
  assert.equal(analysis.dateSync.status, 'REVISED_IN_BUYER_LOG');
  const diff = analysis.dateSync.differences.find(item => item.key === 'exFactory');
  assert.ok(diff, 'ayrışan alan tek tek gösterilmeli');
  assert.equal(diff.deltaDays, ord('2026-11-15') - ord('2026-10-01'));
  assert.ok(analysis.riskReasons.includes('DATE_SYNC_MISMATCH'));
  assert.equal(model.dateSync.byField.find(item => item.key === 'exFactory').rows, 1);
});

test('v9.48 revizyon yoksa tarihler MATCH; tarih eksikse UNKNOWN, uyarı üretilmez', () => {
  const clean = analyze([order({ ocode: 9971, opd: '2026-06-01', ex: '2026-10-01', retail: '2027-01-01' })]);
  assert.equal(clean.orders[0].dateSync.status, 'MATCH');
  assert.ok(!clean.orders[0].riskReasons.includes('DATE_SYNC_MISMATCH'));

  const noDates = analyze([order({ ocode: 9972, opd: '2026-06-01', ex: null, retail: null })]);
  assert.equal(noDates.orders[0].dateSync.status, 'UNKNOWN');
  assert.ok(!noDates.orders[0].riskReasons.includes('DATE_SYNC_MISMATCH'), 'karşılaştırılamayan tarih senkron hatası sayılmaz');
});

test('v9.48 yükleme planı kovaları kesişimli değil; 2 hafta = bu hafta + gelecek hafta', () => {
  const orders = [
    order({ ocode: 9801, opd: '2026-06-01', ex: '2026-09-07', retail: '2027-01-01' }),  // 2 gün
    order({ ocode: 9802, opd: '2026-06-01', ex: '2026-09-14', retail: '2027-01-01' }),  // 9 gün
    order({ ocode: 9803, opd: '2026-06-01', ex: '2026-08-25', retail: '2027-01-01' }),  // gecikmiş
    order({ ocode: 9804, opd: '2026-06-01', ex: '2026-12-01', retail: '2027-06-01' }),  // uzak
  ];
  const plan = analyze(orders).loadingPlan;
  assert.equal(plan.thisWeek.rows, 1);
  assert.equal(plan.nextWeek.rows, 1);
  assert.equal(plan.nextTwoWeeks.rows, 2, 'iki hafta bu hafta + gelecek haftanın toplamı olmalı');
  assert.equal(plan.overdue.rows, 1);
});

test('v9.48 aksiyon listesi ON_TRACK siparişleri içermez ve sayım limitten etkilenmez', () => {
  const orders = [];
  for (let index = 0; index < 12; index += 1) {
    orders.push(order({ ocode: 9900 + index, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-11-01' }));
  }
  orders.push(order({ ocode: 9999, opd: '2026-08-20', ex: '2026-12-01', retail: '2027-06-01' }));
  const model = analyze(orders);
  const list = Engine.needsAttention(model, { limit: 3 });
  assert.equal(list.length, 3, 'limit yalnız listeyi kısaltmalı');
  assert.equal(list.total, 12, 'toplam sayı TAM kümeden gelmeli');
  assert.ok(list.every(item => item.priority !== 'ON_TRACK'));
  assert.equal(list[0].priority, 'CRITICAL', 'en acil önce sıralanmalı');
});

test('v9.48 hedef tipi In Store seçilince hedef tarih ve tampon değişir', () => {
  const rows = cpRows([order({ ocode: 9950, opd: '2026-06-01', ex: '2026-10-01', retail: '2026-12-01', mb: '2027-04-01' })]);
  const retail = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES, settings: { targetType: 'retail' } });
  const inStore = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES, settings: { targetType: 'inStore' } });
  assert.notEqual(retail.orders[0].targetDate, inStore.orders[0].targetDate);
  assert.ok(inStore.orders[0].scheduleBufferDays > retail.orders[0].scheduleBufferDays);
});

test('v9.48 motor saf: DOM, ağ ve AI çağrısı içermiyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cp-readiness-engine.js'), 'utf8');
  assert.doesNotMatch(source, /document\.|window\.|fetch\(/);
  assert.doesNotMatch(source, /\/api\/copilot|BLCopilot|octopus/i);
  // Teslimat sınıflandırması burada ÜRETİLMEMELİ.
  assert.doesNotMatch(source, /deliveryOutcome\s*=\s*['"]/, 'teslimat sonucu CP motorunda atanmamalı');
  assert.match(source, /DE\.analyzeOrder/);
});
