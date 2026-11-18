'use strict';

/* CP / Orders ortak grid motoru: Koleksiyon ile aynı hücre işlemleri.
 *  - Delete seçili aralığı tek işlemde temizler.
 *  - Ctrl+D seçimin ilk satırını alttaki satırlara doldurur; ilk satıra yazmaz.
 *  Üçü de (yapıştır/temizle/doldur) tablonun applyPaste yolundan geçer: aynı
 *  hedef, doğrulama, önizleme ve tek adımlı geri alma. applyPaste tanımlamayan
 *  tablolarda tuşlar hiçbir şey yazmaz.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

function loadGrid() {
  delete require.cache[require.resolve('../public/grid-clipboard.js')];
  const listeners = {}, tables = {};
  globalThis.document = {
    addEventListener(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    getElementById: id => tables[id] || null,
  };
  globalThis.getSelection = () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} });
  const Grid = require('../public/grid-clipboard.js');
  const rows = [1, 2, 3].map(id => ({ _id: id, x: `x${id}`, y: `y${id}` }));
  const table = { id: 'ordersTable', _blRenderedRows: rows, _blRenderedColumns: [{ k: 'x' }, { k: 'y' }], setAttribute() {}, removeAttribute() {}, focus() {}, querySelectorAll: () => [], contains: () => true };
  tables.ordersTable = table;
  const press = (key, extra = {}) => {
    const event = { key, target: table, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
    listeners.keydown.forEach(cb => cb(event));
    return event;
  };
  return { Grid, table, press, cleanup() { delete globalThis.document; delete globalThis.getSelection; } };
}

function register(g, plans, extra = {}) {
  g.Grid.register('ordersTable', {
    isActive: () => true, rowId: r => r._id, columnId: c => c.k, value: (row, column) => row[column.k],
    pasteTarget: () => 'text', pasteValue: raw => ({ ok: true, value: raw }),
    applyPaste: async (plan, range) => { plans.push({ plan, range }); return { ok: true }; },
    ...extra,
  });
  const s = g.Grid.state('ordersTable');
  s.selectionAnchor = s.activeCell = { rowId: '1', columnId: 'x' };
  s.selectionFocus = { rowId: '3', columnId: 'y' };
  return s;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Delete seçili aralığın her düzenlenebilir hücresini tek işlemde boşaltır', async () => {
  const g = loadGrid();
  try {
    const plans = [];
    register(g, plans);
    assert.equal(g.press('Delete').prevented, true);
    await tick();
    assert.equal(plans.length, 1);
    assert.equal(plans[0].plan.kind, 'clear');
    assert.equal(plans[0].plan.ops.length, 6);
    assert.ok(plans[0].plan.ops.every(op => op.value === ''));
  } finally { g.cleanup(); }
});

test('Ctrl+D ilk satırı aşağı doldurur, ilk satıra yazmaz ve seçimi korur', async () => {
  const g = loadGrid();
  try {
    const plans = [];
    const s = register(g, plans);
    assert.equal(g.press('d', { ctrlKey: true }).prevented, true);
    await tick();
    assert.equal(plans[0].plan.kind, 'fill');
    assert.deepEqual(plans[0].plan.ops.map(op => `${op.row._id}${op.column.k}=${op.value}`), ['2x=x1', '2y=y1', '3x=x1', '3y=y1']);
    assert.deepEqual([s.selectionAnchor, s.selectionFocus], [{ rowId: '1', columnId: 'x' }, { rowId: '3', columnId: 'y' }]);
  } finally { g.cleanup(); }
});

test('Ctrl+D sekme/satır sonu içeren değeri hücreye bölmeden taşır', async () => {
  const g = loadGrid();
  try {
    const plans = [];
    g.table._blRenderedRows[0].x = 'satır 1\nsatır\t2';
    register(g, plans);
    g.press('d', { ctrlKey: true });
    await tick();
    assert.equal(plans[0].plan.ops.filter(op => op.column.k === 'x').every(op => op.value === 'satır 1\nsatır\t2'), true);
  } finally { g.cleanup(); }
});

test('yapıştırma kabul etmeyen tabloda Delete/Ctrl+D yazmaz; tek satırda Ctrl+D işlem yapmaz', async () => {
  const g = loadGrid();
  try {
    const plans = [];
    register(g, plans, { applyPaste: undefined });
    assert.equal(g.press('Delete').prevented, false);
    const s = register(g, plans);
    s.selectionFocus = { rowId: '1', columnId: 'y' };
    g.press('d', { ctrlKey: true });
    await tick();
    assert.equal(plans.length, 0);
  } finally { g.cleanup(); }
});
