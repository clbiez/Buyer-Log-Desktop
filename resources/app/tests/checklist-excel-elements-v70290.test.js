'use strict';

/* v7.0.290 — "Checklist excelini de buna göre düzenle. Kumaşları yine tek ana
   başlık altında ancak varsa farklı bileşenlerini de tek tek onay durumunu
   düzenleyebilecek şekilde düzenleyebileyim." */

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../public/vendor/exceljs.min.js');
const Supplier = require('../public/checklist-supplier-sync.js');

const item = { id: 'fabric', tr: 'Kumaş Testi', en: 'Fabric Test', questionTr: 'Kumaş testi?', questionEn: 'Fabric test?' };
const rows = [
  { 'Order Code': 'DEMO-1', 'Sub-Manufacturer': 'Demo Supplier', 'Model Name': 'DEMO A' },
  { 'Order Code': 'DEMO-2', 'Sub-Manufacturer': 'Demo Supplier', 'Model Name': 'DEMO B' },
];
const analyses = new Map([
  [rows[0], { orderKey: 'K1', plannedLoadDate: '2026-11-01', sourceRow: rows[0] }],
  [rows[1], { orderKey: 'K2', plannedLoadDate: '2026-11-01', sourceRow: rows[1] }],
]);
const answers = {
  'K1::fabric': { state: 'rejected', elements: [{ id: 'e1', name: 'Main Fabric', state: 'rejected' }, { id: 'e2', name: 'Neck RIB', state: 'approved' }] },
  'K2::fabric': { state: 'open' },
};

async function build() {
  const created = await Supplier.buildSupplierWorkbook({
    ExcelJS, rows, items: [item], language: 'en', columnIds: ['order', 'supplier'],
    analysisFor: row => analyses.get(row), itemApplies: () => true,
    answerFor: (_item, analysis) => answers[analysis.orderKey + '::fabric'] || null,
    prepareImage: async () => null, answers,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(created.buffer);
  return book;
}

test('one main heading plus one editable column per component', async () => {
  const book = await build();
  const sheet = book.getWorksheet('Checklist');
  const headers = sheet.getRow(1).values;
  const main = headers.indexOf('Fabric Test');
  const mainFabric = headers.indexOf('Fabric Test › Main Fabric');
  const neck = headers.indexOf('Fabric Test › Neck RIB');
  assert.ok(main > 0 && mainFabric === main + 1 && neck === main + 2, 'components sit right under the main heading');
  assert.equal(sheet.getRow(2).getCell(mainFabric).text, 'Rejected');
  assert.equal(sheet.getRow(2).getCell(neck).text, 'Approved');
  assert.equal(sheet.getRow(2).getCell(main).text, 'Rejected');
  const locked = cell => !(cell.protection && cell.protection.locked === false);
  assert.equal(locked(sheet.getRow(2).getCell(main)), true, 'main status is derived on rows with components');
  assert.equal(locked(sheet.getRow(2).getCell(mainFabric)), false);
  assert.equal(locked(sheet.getRow(3).getCell(main)), false, 'single-component rows keep the main status editable');
  assert.equal(sheet.getRow(3).getCell(mainFabric).text, '');
});

test('import reads component cells, derives the main status and keeps other components', async () => {
  const book = await build();
  const sheet = book.getWorksheet('Checklist');
  const headers = sheet.getRow(1).values;
  sheet.getRow(2).getCell(headers.indexOf('Fabric Test › Main Fabric')).value = 'Approved';
  sheet.getRow(3).getCell(headers.indexOf('Fabric Test › Neck RIB')).value = 'Rejected';
  const parsed = Supplier.parseSupplierWorkbook(book, {
    analysisFor: key => [...analyses.values()].find(analysis => analysis.orderKey === key) || null,
    catalog: new Map([[item.id, item]]), applies: () => true, answers, english: true, at: '2026-10-21T10:00:00.000Z',
  });
  const first = parsed.entries.find(entry => entry.orderKey === 'K1');
  assert.equal(first.state, 'approved');
  assert.deepEqual(first.elements.map(entry => entry.name + ':' + entry.state), ['Main Fabric:approved', 'Neck RIB:approved']);
  const second = parsed.entries.find(entry => entry.orderKey === 'K2');
  assert.equal(second.state, 'rejected', 'a component typed on a single-component row creates that component');
  assert.deepEqual(second.elements.map(entry => entry.name + ':' + entry.state), ['Neck RIB:rejected']);
});
