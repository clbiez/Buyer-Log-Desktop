'use strict';

/*
 * KULLANICI EXCEL'İ İÇERİ AKTARMA — YETKİLİ PLAN
 *
 * Çivilenen davranışlar:
 *   1) ÖNİZLEME = UYGULAMA. Aynı girdiler aynı planı üretir; plan dondurulmuştur.
 *   2) Boş hücre varsayılan olarak mevcut değeri SİLMEZ; açık ayar ile siler
 *      ve önizlemede "clear" olarak görünür.
 *   3) Excel seri tarihi saat dilimi kaymadan takvim gününe çevrilir.
 *   4) Geçersiz sayı/tarih satırı yazılmaz; sessizce zorlanmaz.
 *   5) Baştaki sıfır kaynaktan okunabiliyorsa korunur, okunamıyorsa TAHMİN
 *      EDİLMEZ — uyarı üretilir.
 *   6) Belirsiz eşleşme ve ters tekrar, karar verilmeden planı ENGELLER.
 *   7) Hedef revizyonu/satırı değiştiyse plan bayattır ve uygulanamaz.
 *   8) Yazılamayan (kimlik) alan güncellemede değişiklik üretmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.BLCanonicalFields = require('../public/canonical-fields.js');
require('../public/column-schema.js');
require('../public/excel-date-utils.js');
require('../public/excel-import-mapping.js');
require('../public/excel-import-match.js');
const Plan = require('../public/excel-import-plan.js');

const FIELDS = [
  { id: 'plmId', label: 'PLM ID', dataType: 'code', identity: true, writable: false },
  { id: 'colourCode', label: 'Colour Code', dataType: 'code', identity: true, writable: true },
  { id: 'targetPrice', label: 'Target Price', dataType: 'currency', writable: true },
  { id: 'exFactory', label: 'Ex-Factory', dataType: 'date', writable: true },
  { id: 'quantity', label: 'Quantity', dataType: 'quantity', writable: true },
  { id: 'not', label: 'Notes', dataType: 'text', writable: true },
];

function cell(value, extra) {
  return Object.assign({ value, type: typeof value === 'number' ? 'n' : 's', formula: '', text: '', numFmt: '', error: '', unreliable: false, filledFromMerge: false }, extra || {});
}
function sourceRow(id, excelRow, cells) { return { id, excelRow, excelRowNumber: excelRow, flags: [], cells }; }

const COLUMNS = [
  { id: 'col:0', index: 0, key: 'PLM ID', header: 'PLM ID' },
  { id: 'col:1', index: 1, key: 'TARGET PRICE', header: 'Target Price' },
  { id: 'col:2', index: 2, key: 'EX FACTORY', header: 'Ex-Factory' },
  { id: 'col:3', index: 3, key: 'NOTES', header: 'Notes' },
];
const ASSIGNMENTS = {
  'col:0': { targetId: 'plmId' }, 'col:1': { targetId: 'targetPrice' },
  'col:2': { targetId: 'exFactory' }, 'col:3': { targetId: 'not' },
};

function baseSpec(rows, targets, overrides) {
  const target = Object.assign({
    rows: targets,
    revision: 7,
    rowRevision: row => String(row._rev),
    rowLabel: row => row.plmId,
    readValue: (row, fieldId) => (row[fieldId] === undefined ? '' : row[fieldId]),
    canCreate: true,
  }, (overrides && overrides.target) || {});
  return Object.assign({
    moduleId: 'collection',
    fields: FIELDS,
    source: { fileName: 'test.xlsx', sheetName: 'Sayfa1', headerRow: 0, fingerprint: 'wb1:test', columns: COLUMNS, rows },
    mapping: { assignments: ASSIGNMENTS, newColumns: [] },
    matchRule: { fieldIds: ['plmId'] },
    options: { blankClears: false, createNew: true },
    decisions: { excludedSourceRows: [], ambiguousChoice: {}, duplicateResolution: {} },
  }, overrides || {}, { target });
}

/* ---------------- DEĞER ÇEVİRİMİ ---------------- */

test('Excel seri tarihi saat dilimi kaymadan takvim gününe çevrilir', () => {
  // 45658 = 01.01.2025
  const date = Plan.dateFromSerial(45658);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 1);
  const coerced = Plan.coerceCell(cell(45658), { dataType: 'date' });
  assert.equal(coerced.kind, 'value');
  assert.equal(coerced.value, '2025-01-01');
  // Excel'in var olmayan 29.02.1900'ü tahmin edilmez.
  assert.equal(Plan.dateFromSerial(60), null);
});

test('metin, Date ve biçimli tarihler aynı kanonik biçime iner', () => {
  assert.equal(Plan.coerceCell(cell('02.03.2026'), { dataType: 'date' }).value, '2026-03-02');
  assert.equal(Plan.coerceCell(cell('2026-03-02'), { dataType: 'date' }).value, '2026-03-02');
  assert.equal(Plan.coerceCell(cell(new Date(2026, 2, 2)), { dataType: 'date' }).value, '2026-03-02');
});

test('geçersiz tarih ve sayı zorlanmaz; geçersiz işaretlenir', () => {
  assert.equal(Plan.coerceCell(cell('32.13.2026'), { dataType: 'date' }).kind, 'invalid');
  assert.equal(Plan.coerceCell(cell('abc'), { dataType: 'currency' }).kind, 'invalid');
  assert.equal(Plan.coerceCell(cell('12,5'), { dataType: 'currency' }).value, 12.5);
});

test('baştaki sıfır korunur; korunamıyorsa uyarı üretilir, tahmin edilmez', () => {
  const asText = Plan.coerceCell(cell('0123'), { dataType: 'code' });
  assert.equal(asText.value, '0123');
  // Excel hücreyi sayıya çevirmiş ama biçimli gösterim sıfırı koruyor.
  const recovered = Plan.coerceCell(cell(123, { text: '0123', numFmt: '0000' }), { dataType: 'code' });
  assert.equal(recovered.value, '0123');
  // Gösterim de yok: kayıp ONARILMAZ, uyarı verilir.
  const lost = Plan.coerceCell(cell(123, { numFmt: '0000' }), { dataType: 'code' });
  assert.equal(lost.value, '123');
  assert.ok(lost.warnings.some(warning => warning.code === 'leading-zero-uncertain'));
});

test('güvenilmez formül hücresi değer olarak kullanılmaz', () => {
  const result = Plan.coerceCell(cell(null, { formula: 'SUM(A1:A2)', unreliable: true }), { dataType: 'currency' });
  assert.equal(result.kind, 'unreliable');
  assert.equal(result.value, null);
});

/* ---------------- PLAN ---------------- */

test('boş hücre varsayılan olarak mevcut değeri silmez ve önizlemede görünür', () => {
  const rows = [sourceRow('r1', 2, {
    'col:0': cell('0123'), 'col:1': cell(''), 'col:2': cell(''), 'col:3': cell('yeni not'),
  })];
  const targets = [{ plmId: '0123', targetPrice: 13, not: 'eski', _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(plan.operations.length, 1);
  const op = plan.operations[0];
  const price = op.cells.find(item => item.fieldId === 'targetPrice');
  // Paket örneği: blank → 13.00 → 13.00
  assert.equal(price.incoming, null);
  assert.equal(price.current, 13);
  assert.equal(price.final, 13);
  assert.equal(price.kind, 'unchanged');
  assert.equal(op.changes.length, 1);
  assert.equal(op.changes[0].fieldId, 'not');
});

test('açık ayar ile boş hücre temizler ve bu önizlemede "clear" olarak görünür', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(''), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, not: 'eski', _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets, { options: { blankClears: true, createNew: true } }));
  const op = plan.operations[0];
  assert.equal(op.changes.length, 2);
  assert.ok(op.changes.every(change => change.kind === 'clear'));
  assert.equal(op.cells.find(item => item.fieldId === 'targetPrice').final, '');
});

test('yalnız boşluk içeren hücre boş hücreyle aynı sözleşmeye tabidir', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell('   '), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, not: '', _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(plan.operations.length, 0, 'değişiklik yok');
  assert.ok(plan.skipped.some(item => item.reason === 'no-change'));
});

test('yazılamayan kimlik alanı güncellemede değişiklik üretmez', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.ok(!plan.operations[0].changes.some(change => change.fieldId === 'plmId'));
  assert.equal(plan.operations[0].cells.find(item => item.fieldId === 'plmId').kind, 'identity');
});

test('eşleşmeyen satır yeni kayıt olur; oluşturma kapalıysa atlanır', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0999'), 'col:1': cell(9), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', _rev: 1 }];
  const created = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(created.summary.creates, 1);
  assert.equal(created.operations[0].op, 'create');

  const disabled = Plan.buildImportPlan(baseSpec(rows, targets, { options: { blankClears: false, createNew: false } }));
  assert.equal(disabled.summary.creates, 0);
  assert.ok(disabled.skipped.some(item => item.reason === 'create-disabled'));
});

test('CP gibi satır oluşturamayan hedefte eşleşmeyen satır açıkça atlanır', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0999'), 'col:1': cell(9), 'col:2': cell(''), 'col:3': cell('') })];
  const plan = Plan.buildImportPlan(baseSpec(rows, [{ plmId: '0123', _rev: 1 }], { target: { canCreate: false } }));
  assert.equal(plan.summary.creates, 0);
  assert.ok(plan.skipped.some(item => item.reason === 'create-not-supported'));
});

test('belirsiz eşleşme karar verilmeden planı engeller; karar verilince uygulanır', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 1, _rev: 1 }, { plmId: '0123', targetPrice: 2, _rev: 1 }];
  const blocked = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(blocked.executable, false);
  assert.ok(blocked.blocking.some(item => item.code === 'ambiguous-match'));
  assert.equal(blocked.operations.length, 0, 'karar yokken hiçbir şey yazılmaz');

  const picked = Plan.buildImportPlan(baseSpec(rows, targets, {
    decisions: { excludedSourceRows: [], ambiguousChoice: { r1: 1 }, duplicateResolution: {} },
  }));
  assert.equal(picked.executable, true);
  assert.equal(picked.operations.length, 1);
  assert.equal(picked.operations[0].targetPosition, 1);

  const all = Plan.buildImportPlan(baseSpec(rows, targets, {
    decisions: { excludedSourceRows: [], ambiguousChoice: { r1: 'all' }, duplicateResolution: {} },
  }));
  assert.equal(all.operations.length, 2, 'hepsine uygulama yalnız açık kararla olur');

  const skipped = Plan.buildImportPlan(baseSpec(rows, targets, {
    decisions: { excludedSourceRows: [], ambiguousChoice: { r1: 'skip' }, duplicateResolution: {} },
  }));
  assert.equal(skipped.operations.length, 0);
  assert.equal(skipped.blocking.length, 0);
});

test('ters tekrar ve Excel içi tekrar engelleyicidir; first-wins sessizce uygulanmaz', () => {
  const rows = [
    sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(10), 'col:2': cell(''), 'col:3': cell('') }),
    sourceRow('r2', 3, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') }),
  ];
  const targets = [{ plmId: '0123', targetPrice: 1, _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(plan.executable, false);
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.conflicts.some(item => item.kind === 'incoming-duplicate'));
  assert.ok(plan.conflicts.some(item => item.kind === 'reverse-duplicate'));

  const resolved = Plan.buildImportPlan(baseSpec(rows, targets, {
    decisions: {
      excludedSourceRows: [], ambiguousChoice: {},
      duplicateResolution: { '0123': { keep: 'r2' }, 'target:0': { keep: 'r2' } },
    },
  }));
  assert.equal(resolved.executable, true);
  assert.equal(resolved.operations.length, 1);
  assert.equal(resolved.operations[0].sourceRowId, 'r2');
});

test('geçersiz hücre taşıyan satır yazılmaz', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell('abc'), 'col:2': cell(''), 'col:3': cell('x') })];
  const plan = Plan.buildImportPlan(baseSpec(rows, [{ plmId: '0123', _rev: 1 }]));
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.skipped.some(item => item.reason === 'invalid-cell'));
  assert.equal(plan.summary.invalidRows, 1);
});

test('kimliksiz satır eşleştirilemez ve yazılmaz', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell(''), 'col:1': cell(5), 'col:2': cell(''), 'col:3': cell('') })];
  const plan = Plan.buildImportPlan(baseSpec(rows, [{ plmId: '0123', _rev: 1 }]));
  assert.equal(plan.operations.length, 0);
  assert.ok(plan.skipped.some(item => item.reason === 'missing-identifier'));
});

test('plan dondurulmuştur ve aynı girdi aynı parmak izini üretir', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, _rev: 1 }];
  const a = Plan.buildImportPlan(baseSpec(rows, targets));
  const b = Plan.buildImportPlan(baseSpec(rows, targets));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.operations));
  assert.ok(Object.isFrozen(a.operations[0]));
  assert.throws(() => { 'use strict'; a.operations[0].changes.push({}); });
});

test('eşleme, eşleşme kuralı, ayar veya satır kararı değişince parmak izi değişir', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, _rev: 1 }];
  const base = Plan.planFingerprint(baseSpec(rows, targets));
  assert.notEqual(base, Plan.planFingerprint(baseSpec(rows, targets, { options: { blankClears: true, createNew: true } })));
  assert.notEqual(base, Plan.planFingerprint(baseSpec(rows, targets, { matchRule: { fieldIds: ['colourCode'] } })));
  assert.notEqual(base, Plan.planFingerprint(baseSpec(rows, targets, {
    decisions: { excludedSourceRows: ['r1'], ambiguousChoice: {}, duplicateResolution: {} },
  })));
  assert.notEqual(base, Plan.planFingerprint(baseSpec(rows, targets, {
    mapping: { assignments: Object.assign({}, ASSIGNMENTS, { 'col:1': { targetId: '__ignore__' } }), newColumns: [] },
  })));
});

test('bayat plan uygulanamaz: hedef revizyonu veya satırı değiştiyse durur', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') })];
  const targets = [{ plmId: '0123', targetPrice: 13, _rev: 1 }];
  const spec = baseSpec(rows, targets);
  const plan = Plan.buildImportPlan(spec);
  assert.equal(Plan.assertApplicable(plan, {
    fingerprintSpec: spec, revision: 7, rows: targets, rowRevision: row => String(row._rev),
  }).ok, true);

  const staleStore = Plan.assertApplicable(plan, {
    fingerprintSpec: baseSpec(rows, targets, { target: { revision: 8 } }), revision: 8,
    rows: targets, rowRevision: row => String(row._rev),
  });
  assert.equal(staleStore.ok, false);
  assert.equal(staleStore.code, 'STALE_PLAN');

  const bumped = [{ plmId: '0123', targetPrice: 13, _rev: 2 }];
  const staleRow = Plan.assertApplicable(plan, {
    fingerprintSpec: spec, revision: 7, rows: bumped, rowRevision: row => String(row._rev),
  });
  assert.equal(staleRow.ok, false);
  assert.equal(staleRow.code, 'STALE_ROW');
});

test('yeni sütun plana kendi alanıyla girer ve satır değeri olarak yazılır', () => {
  const rows = [sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(''), 'col:2': cell(''), 'col:3': cell('serbest') })];
  const targets = [{ plmId: '0123', _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets, {
    mapping: {
      assignments: { 'col:0': { targetId: 'plmId' }, 'col:3': { targetId: '__new__', newColumnLabel: 'Serbest' } },
      newColumns: [{ id: 'new:col:3', columnId: 'col:3', label: 'Serbest', dataType: 'text' }],
    },
  }));
  assert.equal(plan.newColumns.length, 1);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].changes[0].fieldId, 'new:col:3');
  assert.equal(plan.operations[0].changes[0].to, 'serbest');
});

test('hariç tutulan satır plana hiç girmez', () => {
  const rows = [
    sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') }),
    sourceRow('r2', 3, { 'col:0': cell('0124'), 'col:1': cell(30), 'col:2': cell(''), 'col:3': cell('') }),
  ];
  const targets = [{ plmId: '0123', targetPrice: 1, _rev: 1 }, { plmId: '0124', targetPrice: 2, _rev: 1 }];
  const plan = Plan.buildImportPlan(baseSpec(rows, targets, {
    decisions: { excludedSourceRows: ['r2'], ambiguousChoice: {}, duplicateResolution: {} },
  }));
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].sourceRowId, 'r1');
  assert.ok(plan.skipped.some(item => item.sourceRowId === 'r2' && item.reason === 'user-excluded'));
});

test('özet sayaçları gerçek plana karşılık gelir', () => {
  const rows = [
    sourceRow('r1', 2, { 'col:0': cell('0123'), 'col:1': cell(20), 'col:2': cell(''), 'col:3': cell('') }),
    sourceRow('r2', 3, { 'col:0': cell('0999'), 'col:1': cell(30), 'col:2': cell(''), 'col:3': cell('') }),
    sourceRow('r3', 4, { 'col:0': cell(''), 'col:1': cell(30), 'col:2': cell(''), 'col:3': cell('') }),
  ];
  const plan = Plan.buildImportPlan(baseSpec(rows, [{ plmId: '0123', targetPrice: 1, _rev: 1 }]));
  assert.equal(plan.summary.sourceRows, 3);
  assert.equal(plan.summary.exactMatches, 1);
  assert.equal(plan.summary.newRows, 1);
  assert.equal(plan.summary.updates, 1);
  assert.equal(plan.summary.creates, 1);
  assert.equal(plan.summary.changedCells, plan.operations.reduce((total, op) => total + (op.op === 'create' ? Object.keys(op.values).length : op.changes.length), 0));
});
