'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');
const formulas = require('../public/backlog-excel-formulas');
const Snapshot = require('../server/lib/model-snapshot');

function scenario(ex = '2090-01-01') {
  const overrides = { antrepoMatchConfig: parse.defaultAntrepoMatchConfig(), transitRules: [] };
  const orders = parse.parseASASRows([{
    'Sipariş Kod': 99001, 'Model Adı': 'DEMO MODEL', 'Renk Kod': 'C1',
    'Net Alım Sipariş Miktarı': 1000, 'Kalan Alım Sipariş Miktarı': 400,
    'Orijinal Exfactory Merch Tarih': ex, 'Retail Depo Tarih Yıl Ay Gün': '2090-03-12',
    'Buying Son Onay Tarihi': '2020-01-01',
  }], overrides.antrepoMatchConfig).orders;
  const map = parse.parseAntrepoRows([1, 2].map(n => ({
    'Sipariş Kod': 99001, 'Ürün Ad': 'DEMO MODEL', 'Renk Kod': 'C1',
    'Yükleme Toplam Adet': 300, 'Supplier Portal Statü': 'Depoda',
    'HANDOVER Tarihi': `2020-01-0${n + 1}`, 'Vasita Tanim': 'Gemi',
    'Tahmini Antrepo Giriş Tarihi': '2020-03-12',
  })), overrides.antrepoMatchConfig);
  return { orders, map, overrides };
}

for (const cold of [false, true]) {
  test(`synthetic production has no inherited approval or handover (${cold ? 'snapshot' : 'live'})`, () => {
    let { orders, map, overrides } = scenario();
    if (cold) {
      const stored = JSON.parse(JSON.stringify(Snapshot.compactSnapshotPayload({ asasOrders: orders, antrepoMap: map }).value));
      const restored = Snapshot.expandSnapshotPayload(stored);
      Snapshot.reviveSnapshotDates(restored);
      orders = restored.asasOrders;
      map = restored.antrepoMap;
    }
    const segments = parse.buildBacklogOperationalRows(orders, map, overrides);
    const production = segments.find(s => s._segmentKind === 'production');
    assert.equal(production.qty, 400);
    assert.equal(production.shipConf, null);
    assert.equal(production._iasRow, null);
    assert.ok(orders[0].shipConf, 'source order approval must be preserved');
    const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
    const row = rows.find(r => r._partial.synthetic === 'production');
    assert.equal(row._backlogExcel.shipConfirmationDate, null);
    assert.equal(row._backlogExcel.handoverDate, null);
    assert.equal(row['RİSK\n(PRIORITY)'], 'YOK');
    const plan = formulas.formulaPlan(Object.keys(row).filter(k => !k.startsWith('_')), row, 2);
    assert.equal(plan.helperCells._BL_SHIP_CONFIRMATION_DATE.value, null);
    assert.equal(plan.helperCells._BL_HANDOVER_DATE.value, null);
    const detail = parse.buildBacklogDetailRows(orders, map, overrides, [99001], { includeInternalMeta: true });
    assert.equal(detail.find(r => r._partial.synthetic === 'production')._backlogExcel.shipConfirmationDate, null);
    const partials = rows.filter(r => r._partial.kind === 'partial');
    assert.equal(partials.length, 2);
    assert.ok(partials.every(r => r._backlogExcel.shipConfirmationDate));
    assert.notDeepEqual(partials[0]._backlogExcel.handoverDate, partials[1]._backlogExcel.handoverDate);
  });
}

test('removing synthetic approval does not hide a genuine Retail delay', () => {
  const { orders, map, overrides } = scenario('2090-03-01');
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  const row = rows.find(r => r._partial.synthetic === 'production');
  assert.equal(row._backlogExcel.shipConfirmationDate, null);
  assert.equal(row['RİSK\n(PRIORITY)'], 'VAR');
});
