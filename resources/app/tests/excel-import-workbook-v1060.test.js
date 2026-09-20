'use strict';

/*
 * KULLANICI EXCEL'İ İÇERİ AKTARMA — ÇALIŞMA KİTABI İNCELEMESİ
 *
 * Bu testlerin çivilediği davranışlar:
 *   1) Başlık satırı rapor başlığının ALTINDA bulunur ve belirsizlik
 *      gizlenmez (confidence).
 *   2) Tekrar eden başlıklar görünür olur; sessizce birbirini ezmez.
 *   3) Başlık birleştirmesi ile VERİ birleştirmesi ayrılır; aşağı doldurma
 *      yalnız kullanıcı istediğinde yapılır.
 *   4) Gizli satır/sütun varsayılan olarak İÇERİ GİRMEZ.
 *   5) Tekrarlanan başlık ve toplam satırları iş kaydı sayılmaz.
 *   6) Formül hücresi ÇALIŞTIRILMAZ: önbellekli değer varsa kullanılır,
 *      yoksa hücre güvenilmez işaretlenir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const Workbook = require('../public/excel-import-workbook.js');

function sheetFrom(rows) { return XLSX.utils.aoa_to_sheet(rows); }
function gridOf(worksheet, name) { return Workbook.gridFromWorksheet(XLSX, worksheet, name || 'Sayfa1'); }

test('başlık satırı rapor başlığının altında bulunur ve güven derecesi taşır', () => {
  const worksheet = sheetFrom([
    ['LCW Sipariş Raporu', '', ''],
    [],
    ['PLM ID', 'Order Code', 'Notes'],
    ['0123', 1001, 'a'],
    ['0124', 1002, 'b'],
    ['0125', 1003, 'c'],
  ]);
  const analysis = Workbook.analyzeSheet(gridOf(worksheet), {});
  assert.equal(analysis.headerRow, 2);
  assert.ok(['high', 'medium'].includes(analysis.headerConfidence), analysis.headerConfidence);
  assert.equal(analysis.headers.filter(item => item.label).length, 3);
});

test('kullanıcı başlık satırını ezebilir ve güven "user" olur', () => {
  const worksheet = sheetFrom([['PLM ID', 'Order Code'], ['A', 1], ['B', 2]]);
  const analysis = Workbook.analyzeSheet(gridOf(worksheet), { headerRow: 1 });
  assert.equal(analysis.headerRow, 1);
  assert.equal(analysis.headerConfidence, 'user');
});

test('tekrar eden başlıklar raporlanır ve sütunlar ayrı kimliklerini korur', () => {
  const worksheet = sheetFrom([
    ['PLM ID', 'Notes', 'Notes'],
    ['A', 'x', 'y'],
    ['B', 'z', 'w'],
  ]);
  const analysis = Workbook.analyzeSheet(gridOf(worksheet), {});
  assert.equal(analysis.duplicateHeaders.length, 1);
  assert.deepEqual(analysis.duplicateHeaders[0].columns, [1, 2]);
  const table = Workbook.extractTable(gridOf(worksheet), analysis, {});
  assert.equal(table.columns.length, 3);
  assert.equal(new Set(table.columns.map(column => column.id)).size, 3);
  assert.ok(table.columns.filter(column => column.duplicate).length >= 2);
});

test('başlık birleştirmesi veri birleştirmesinden ayrılır; aşağı doldurma yalnız istenirse yapılır', () => {
  const worksheet = sheetFrom([
    ['Sipariş', '', 'Notes'],
    ['PLM ID', 'Order Code', 'Notes'],
    ['A', 1001, 'n1'],
    [null, 1002, 'n2'],
  ]);
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },  // başlık üstü birleşme
    { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },  // veri birleşmesi
  ];
  const grid = gridOf(worksheet);
  const analysis = Workbook.analyzeSheet(grid, { headerRow: 1 });
  assert.equal(analysis.merges.header.length, 1);
  assert.equal(analysis.merges.data.length, 1);

  const without = Workbook.extractTable(grid, analysis, {});
  const secondRow = without.rows.find(row => row.excelRow === 3);
  assert.equal(secondRow.cells['col:0'].value, null, 'onay yokken üst hücre aşağı kopyalanmaz');

  const withFill = Workbook.extractTable(grid, analysis, { fillMergedCells: true });
  const filled = withFill.rows.find(row => row.excelRow === 3);
  assert.equal(filled.cells['col:0'].value, 'A');
  assert.equal(filled.cells['col:0'].filledFromMerge, true);
});

test('gizli satır ve sütunlar varsayılan olarak içeri girmez', () => {
  const worksheet = sheetFrom([
    ['PLM ID', 'Gizli Sütun', 'Notes'],
    ['A', 'g1', 'n1'],
    ['B', 'g2', 'n2'],
    ['C', 'g3', 'n3'],
  ]);
  worksheet['!rows'] = [null, null, { hidden: true }];
  worksheet['!cols'] = [null, { hidden: true }];
  const grid = gridOf(worksheet);
  const analysis = Workbook.analyzeSheet(grid, {});
  assert.deepEqual(analysis.hiddenRows, [2]);
  assert.deepEqual(analysis.hiddenColumns, [1]);

  const hidden = Workbook.extractTable(grid, analysis, {});
  assert.equal(hidden.rows.length, 2);
  assert.ok(!hidden.columns.some(column => column.index === 1));
  assert.ok(hidden.skipped.some(item => item.reason === 'hidden-row'));

  const shown = Workbook.extractTable(grid, analysis, { includeHiddenRows: true, includeHiddenColumns: true });
  assert.equal(shown.rows.length, 3);
  assert.ok(shown.columns.some(column => column.index === 1));
  assert.ok(shown.rows.some(row => row.flags.includes('hidden')));
});

test('tekrarlanan başlık ve toplam satırları iş kaydı sayılmaz', () => {
  const worksheet = sheetFrom([
    ['PLM ID', 'Order Code', 'Quantity'],
    ['A', 1001, 5],
    ['B', 1002, 7],
    ['PLM ID', 'Order Code', 'Quantity'],
    ['C', 1003, 9],
    ['TOPLAM', '', 21],
  ]);
  const grid = gridOf(worksheet);
  const analysis = Workbook.analyzeSheet(grid, {});
  const kinds = analysis.suspiciousRows.map(item => item.kind);
  assert.ok(kinds.includes('repeated-header'));
  assert.ok(kinds.includes('total'));

  const table = Workbook.extractTable(grid, analysis, {});
  assert.equal(table.rows.length, 3, 'yalnız gerçek iş satırları kalır');
  assert.ok(table.skipped.some(item => item.reason === 'repeated-header'));
  assert.ok(table.skipped.some(item => item.reason === 'total'));
});

test('formül hücresi çalıştırılmaz: önbellekli değer kullanılır, yoksa güvenilmez işaretlenir', () => {
  const worksheet = {
    '!ref': 'A1:C3',
    A1: { t: 's', v: 'PLM ID' }, B1: { t: 's', v: 'Hesap' }, C1: { t: 's', v: 'Kırık' },
    A2: { t: 's', v: 'A' }, B2: { t: 'n', v: 12.5, f: 'SUM(D2:E2)' }, C2: { t: 'n', f: 'SUM(D2:E2)' },
    A3: { t: 's', v: 'B' }, B3: { t: 'n', v: 3, f: 'SUM(D3:E3)' }, C3: { t: 'e', v: '#REF!' },
  };
  const grid = gridOf(worksheet);
  const analysis = Workbook.analyzeSheet(grid, {});
  assert.equal(analysis.formulas.total, 3);
  assert.equal(analysis.formulas.withCachedValue, 2);
  assert.equal(analysis.formulas.withoutCachedValue, 1);

  const table = Workbook.extractTable(grid, analysis, {});
  const first = table.rows[0];
  assert.equal(first.cells['col:1'].value, 12.5);
  assert.equal(first.cells['col:1'].unreliable, false);
  assert.equal(first.cells['col:2'].unreliable, true, 'değeri olmayan formül güvenilmezdir');
  assert.equal(table.rows[1].cells['col:2'].unreliable, true, 'Excel hata değeri de güvenilmezdir');
  // Formül METNİ taşınır ama ASLA çalıştırılmaz.
  assert.equal(first.cells['col:1'].formula, 'SUM(D2:E2)');
});

test('şema parmak izi dosya adına değil sayfa yapısına bağlıdır', () => {
  const columns = [{ key: 'PLM ID' }, { key: 'ORDER CODE' }];
  const a = Workbook.schemaFingerprint({ sheet: 'Sayfa1', headerRow: 0, columns });
  const b = Workbook.schemaFingerprint({ sheet: 'Sayfa1', headerRow: 0, columns: columns.slice() });
  const c = Workbook.schemaFingerprint({ sheet: 'Sayfa1', headerRow: 1, columns });
  const d = Workbook.schemaFingerprint({ sheet: 'Sayfa1', headerRow: 0, columns: [{ key: 'PLM ID' }] });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('çalışma kitabı özeti gizli sayfaları işaretler', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetFrom([['A'], [1]]), 'Veri');
  XLSX.utils.book_append_sheet(workbook, sheetFrom([['B'], [2]]), 'Arka');
  workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
  const overview = Workbook.workbookOverview(XLSX, workbook);
  assert.equal(overview.length, 2);
  assert.equal(overview[0].hidden, false);
  assert.equal(overview[1].hidden, true);
});
