'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../public/vendor/exceljs.min.js');
const Supplier = require('../public/checklist-supplier-sync.js');

const item = {
  id: 'supplier-fabric', tr: 'Kumaş Testi', en: 'Fabric Test',
  questionTr: 'Kumaş testi tamamlandı mı?', questionEn: 'Is the fabric test completed?',
  evidenceFields: { reportNumber: true, actualDate: true, attachments: false },
};
const internal = {
  id: 'internal-review', tr: 'İç Onay', en: 'Internal Review',
  questionTr: 'İç onay?', questionEn: 'Internal approval?',
};
const order = { 'Order Code': 'DEMO-001', 'Sub-Manufacturer': 'Demo Supplier', 'Model Name': 'DEMO' };
const analysis = { orderKey: 'DEMO-001::C1', plannedLoadDate: '2026-11-01', sourceRow: order };

test('supplier question presets persist per supplier, remain independent, and use general fallback', () => {
  const previous = globalThis.BLStorage;
  const data = new Map();
  globalThis.BLStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  try {
    assert.deepEqual(Supplier.supplierQuestionIdsFor('Demo Supplier'), []);
    Supplier.saveSupplierQuestionIdsFor('Mixed', ['supplier-fabric']);
    assert.deepEqual(Supplier.supplierQuestionIdsFor('New Supplier'), ['supplier-fabric']);
    Supplier.saveSupplierQuestionIdsFor('DEMO SUPPLIER', ['supplier-fabric', 'supplier-fabric']);
    Supplier.saveSupplierQuestionIdsFor('Another Supplier', ['internal-review']);
    assert.deepEqual(Supplier.supplierQuestionIdsFor('demo supplier'), ['supplier-fabric']);
    assert.deepEqual(Supplier.supplierQuestionIdsFor('Another Supplier'), ['internal-review']);
    assert.deepEqual(Supplier.supplierQuestionIdsFor('Third Supplier'), ['supplier-fabric']);
    assert.equal(JSON.parse(data.get('lcw.cp.checklist.supplier.questions.v1')).version, 1);
  } finally {
    if (previous === undefined) delete globalThis.BLStorage;
    else globalThis.BLStorage = previous;
  }
});

test('supplier workbook starts data at row 2 and uses a hidden named status list', async () => {
  const statuses = Array.from({ length: 15 }, (_, i) => ({ id: 'custom:step-' + i, name: 'Custom ' + i }));
  const created = await Supplier.buildSupplierWorkbook({
    ExcelJS, rows: [order], items: [item], language: 'en', customStatuses: statuses,
    columnIds: ['order', 'supplier'],
    analysisFor: () => analysis, itemApplies: () => true,
    answerFor: () => ({ state: 'open', note: 'DEMO' }),
    prepareImage: async () => null,
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(created.buffer);
  const sheet = book.getWorksheet('Checklist'), meta = book.getWorksheet('__BL_META');
  const headers = sheet.getRow(1).values;
  const keyColumn = headers.indexOf('__BL_ORDER_KEY');
  const statusColumn = headers.indexOf('Fabric Test');
  assert.ok(statusColumn > 0);
  assert.equal(sheet.rowCount, 2, 'hidden status dropdown must not create blank order rows');
  assert.equal(sheet.getRow(2).getCell(keyColumn).text, analysis.orderKey);
  assert.equal(sheet.getRow(2).getCell(statusColumn).text, 'Pending');
  assert.equal(sheet.getRow(2).getCell(statusColumn).dataValidation.formulae[0], 'BL_CHECKLIST_STATUSES');
  assert.equal(meta.state, 'veryHidden');
  assert.equal(meta.getCell('L2').text, 'Pending');
  assert.equal(meta.getCell('L21').text, 'Custom 14');
  assert.equal(Boolean(sheet.sheetProtection && sheet.sheetProtection.sheet), true);
  sheet.getRow(2).getCell(statusColumn).value = 'Approved';
  const parsed = Supplier.parseSupplierWorkbook(book, {
    english: true, analysisFor: () => analysis, catalog: new Map([[item.id, item]]),
    applies: () => true, answers: {}, customStatuses: statuses,
  });
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].itemId, item.id);
  assert.equal(parsed.entries[0].state, 'approved');
});

test('selection passed to the workbook builder omits internal questions without changing supplier identity', async () => {
  const created = await Supplier.buildSupplierWorkbook({
    ExcelJS, rows: [order], items: [item], language: 'tr', columnIds: ['order', 'supplier'],
    analysisFor: () => analysis, itemApplies: () => true, prepareImage: async () => null,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(created.buffer);
  const sheet = workbook.getWorksheet('Checklist');
  const headings = sheet.getRow(1).values;
  assert.ok(headings.includes(item.tr));
  assert.ok(!headings.includes(internal.tr));
  assert.equal(sheet.rowCount, 2);
  assert.ok(headings.includes('__BL_ORDER_KEY'));
  assert.ok(headings.includes('__BL_LOAD_DATE'));
});
