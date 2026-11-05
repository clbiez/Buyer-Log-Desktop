'use strict';
// LCW AI belge incelemesi (prepare-review) sayfadaki CP satırlarını sunucunun canlı
// CP projeksiyonuyla alan alan karşılaştırır. Sayfa açılışında normalizeCPDates →
// rebuildCpLogisticCaches skaler lojistik özetini (STATUS, Ant. Arrival, Del. Type,
// HANDOVER Tarihi) kendi ana-segment kuralıyla yeniden yazar. Bu alanlar ortak
// PAGE_DERIVED_FIELDS listesine alınmadan önce IAS parsiyeli olan HER siparişte
// inceleme "Ekrandaki bir sipariş alanı güncel değil" hatasıyla düşüyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-cp-parity-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = dataRoot;
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const Assessment = require(path.join(ROOT, 'public', 'test-report-assessment.js'));
const BLBusinessRules = require(path.join(ROOT, 'public', 'business-rules.js'));
const { createService } = require(path.join(ROOT, 'server', 'lib', 'test-reports', 'service.js'));
const { loadAppMainFunctions } = require('./helpers/app-main-functions');
test.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));

const page = loadAppMainFunctions(
  ['norm', 'toNum', 'turknorm', 'normalizeTransitDelType', 'cpLogisticSegments', 'cpLogisticHasDetails', 'rebuildCpLogisticCaches'],
  { BLBusinessRules, coerceDateLoose: value => { if (value == null || value === '') return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; } },
);

function asas(extra = {}) {
  return {
    'Sipariş Kod': 4100001, 'Model Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 3000, 'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER', 'Sezon': 'W6', 'Buyer Grup (TR)': 'BG', 'Siparişin Üretildiği Ülke': 'CIN',
    'Orijinal Exfactory Merch Tarih': '2026-01-01', 'Retail Depo Tarih Yıl Ay Gün': '2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15', ...extra,
  };
}
function ias(extra = {}) {
  return {
    'Sipariş Kod': 4100001, 'Ürün Ad': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
    'HANDOVER Tarihi': '2026-02-20', 'Vasita Tanim': 'GEMI', 'Yükleme Toplam Adet': 3000,
    'Net Alım Sipariş Miktarı': 10000, ...extra,
  };
}
const overrides = () => ({
  antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
  submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {}, pricingRules: [], transitRules: [],
});
const keyOf = row => String(row['Order Code']);
const snapshot = rows => Assessment.cpSnapshot(rows, { keyOf, orderCodeOf: keyOf, checklistOf: () => [] });

function serverRows(asasRows, iasRows) {
  const ov = overrides();
  const rows = parse.buildCPRowsFromASAS(parse.parseASASRows(asasRows, ov.antrepoMatchConfig).orders, parse.parseAntrepoRows(iasRows, ov.antrepoMatchConfig), ov);
  assert.ok(rows.length && rows.every(row => row._logisticSegments.some(segment => segment.kind === 'partial')), 'fixture must exercise IAS partials');
  return rows;
}
function pageRows(rows) {
  // Page transport is JSON; the page revives dates and rebuilds logistic caches (normalizeCPDates).
  return JSON.parse(JSON.stringify(rows)).map(row => {
    page.cpLogisticSegments(row).forEach(segment => {
      segment.arrival = segment.arrival ? new Date(segment.arrival) : null;
      segment.handover = segment.handover ? new Date(segment.handover) : null;
    });
    for (const key of ['OPD', 'Original Ex-factory', 'Ex-factory', 'HANDOVER Tarihi', 'Retail Date', 'Buying Son Onay Tarihi', 'In-Store (Model Budget)', 'Ant. Arrival']) {
      if (row[key] != null && row[key] !== '') row[key] = new Date(row[key]);
    }
    if (page.cpLogisticHasDetails(row)) page.rebuildCpLogisticCaches(row);
    return row;
  });
}
function differing(server, client) {
  const byKey = new Map(client.rows.map(row => [row.key, row]));
  return [...new Set(server.rows.flatMap(row => Object.entries(row.fields)
    .filter(([key, value]) => JSON.stringify(byKey.get(row.key).fields[key]) !== JSON.stringify(value)).map(([key]) => key)))].sort();
}
async function prepare(rows) {
  const canonical = snapshot(rows);
  const authorized = new Map(canonical.rows.map(row => [row.key, { orderCode: row.orderCode }]));
  const service = createService({ authorizedOrders: async () => authorized, sourceRevision: () => 'v1',
    reviewContext: async () => ({ cp: canonical, checklistSteps: [{ id: 'tests' }], checklistStatuses: [{ id: 'approved', resolved: true }], rules: null }) });
  const profile = { id: 'demo', displayName: 'Demo' };
  const mail = 'From: lab@example.test\r\nSubject: Result\r\n\r\nReport DEMO-1 Order 4100001 FABRIC Pass';
  const parsed = await service.parse(profile, [{ name: 'result.eml', base64: Buffer.from(mail).toString('base64') }]);
  return body => service.prepareAssessment(profile, { sessionId: parsed.sessionId, ...body });
}

const scenarios = {
  'production remainder + IAS partials': () => serverRows([asas()], [
    ias({ 'Supplier Portal Statü': 'Depoda', 'Yükleme Toplam Adet': 3000 }),
    ias({ 'Supplier Portal Statü': 'Yol Operasyonları', 'Yükleme Toplam Adet': 4000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-20', 'Vasita Tanim': 'Tır', 'HANDOVER Tarihi': '' }),
  ]),
  'fully loaded order (partial is the main segment)': () => serverRows([asas({ 'Kalan Alım Sipariş Miktarı': 500 })], [
    ias({ 'Supplier Portal Statü': 'Yolda', 'Yükleme Toplam Adet': 6000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-20' }),
    ias({ 'Supplier Portal Statü': 'Depoda', 'Yükleme Toplam Adet': 4000 }),
  ]),
};

for (const [name, build] of Object.entries(scenarios)) {
  test(`${name}: page drift is limited to page-derived fields and LCW AI review is prepared`, async () => {
    const rows = build(), server = snapshot(rows), client = snapshot(pageRows(rows));
    const drift = differing(server, client);
    assert.ok(drift.length > 0, 'fixture reproduces the real page/server logistic divergence');
    assert.deepEqual(drift.filter(key => !Assessment.pageDerived(key)), [], 'only page-derived display fields may differ');
    const ready = await (await prepare(rows))({ cp: client });
    assert.equal(ready.ok, true);
    assert.deepEqual(ready.packet.cp.rows.map(row => row.fields.STATUS), server.rows.map(row => row.fields.STATUS), 'AI packet keeps canonical server values');
  });
}

test('business field drift is still rejected and names the column', async () => {
  const rows = scenarios['production remainder + IAS partials'](), client = snapshot(pageRows(rows));
  client.rows[0].fields['Order Quantity'] = 1;
  await assert.rejects((await prepare(rows))({ cp: client }), error => error.code === 'TEST_REPORT_CP_INCOMPLETE' && error.details.reason === 'fields' && error.details.field === 'Order Quantity');
});
