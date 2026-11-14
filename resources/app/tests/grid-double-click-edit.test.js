'use strict';

// CP/Orders: tek tık seçer, çift tık düzenler, klavye doğrudan düzenler;
// açılır pencereler hücre seçimi pointerdown'ı iptal etse de dışarı tıklamayla kapanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadGrid() {
  delete require.cache[require.resolve('../public/grid-clipboard.js')];
  const listeners = {};
  const tables = {};
  const doc = {
    activeElement: null,
    addEventListener(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    getElementById: id => tables[id] || null,
  };
  globalThis.document = doc;
  globalThis.getSelection = () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} });
  const Grid = require('../public/grid-clipboard.js');
  const fire = (name, event) => (listeners[name] || []).forEach(cb => cb(event));
  return { Grid, doc, listeners, tables, fire, cleanup() { delete globalThis.document; delete globalThis.getSelection; } };
}

// İki satır × iki sütunluk, her hücresinde .editCell input olan sahte tablo.
function makeTable(g, id = 'cpTable') {
  const cells = [];
  const table = {
    id, focused: 0,
    _blRenderedRows: [{ _id: 1 }, { _id: 2 }],
    _blRenderedColumns: [{ k: 'x' }, { k: 'y' }],
    setAttribute() {}, removeAttribute() {},
    focus() { table.focused++; g.doc.activeElement = table; },
    contains: () => true,
    querySelectorAll: sel => (sel === 'tbody td[data-key]' ? cells.map(c => c.td) : []),
  };
  for (const rowId of ['1', '2']) {
    const tr = { dataset: { id: rowId } };
    for (const key of ['x', 'y']) {
      const td = { dataset: { key }, classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {} };
      const input = {
        tagName: 'INPUT', type: 'text', value: `${rowId}${key}`, readOnly: false, disabled: false,
        dataset: { key }, selection: null,
        closest: sel => (sel.startsWith('input,') ? input : sel === 'tbody td[data-key]' ? td : sel === 'table' ? table : null),
        matches: sel => sel.startsWith('input,'),
        contains: node => node === input,
        focus() { g.doc.activeElement = input; },
        select() { input.selection = 'all'; },
        setSelectionRange(a, b) { input.selection = [a, b]; },
        classList: { contains: () => false },
      };
      td.closest = sel => (sel === 'tbody tr[data-id]' ? tr : sel === 'table' ? table : sel === 'tbody td[data-key]' ? td : null);
      td.querySelector = sel => (sel.includes('input.editCell') ? input : null);
      td.contains = node => node === input || node === td;
      cells.push({ rowId, key, td, input });
    }
  }
  g.tables[id] = table;
  return { table, cell: (rowId, key) => cells.find(c => c.rowId === rowId && c.key === key) };
}

const pointer = (target, extra = {}) => ({ button: 0, shiftKey: false, target, prevented: false, preventDefault() { this.prevented = true; }, ...extra });
const key = (k, target, extra = {}) => ({ key: k, target, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra });

test('tek tık editörü odaklamadan hücreyi seçer; çift tık düzenlemeyi açar', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g);
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k, editOnDoubleClick: true });
    const c = t.cell('1', 'x');
    const down = pointer(c.input);
    g.fire('pointerdown', down);
    assert.equal(down.prevented, true, 'editöre odak verilmemeli');
    assert.equal(g.doc.activeElement, t.table);
    assert.deepEqual(g.Grid.state('cpTable').activeCell, { rowId: '1', columnId: 'x' });

    g.fire('dblclick', { button: 0, target: c.input, defaultPrevented: false });
    assert.equal(g.doc.activeElement, c.input, 'çift tık editörü açmalı');
    assert.deepEqual(c.input.selection, [2, 2], 'imleç sona konur');

    // Düzenlenen editörün içindeki tık tarayıcıya bırakılır (imleç konumu).
    const inside = pointer(c.input);
    g.fire('pointerdown', inside);
    assert.equal(inside.prevented, false);
  } finally { g.cleanup(); }
});

test('opt-in olmayan tabloda editör tıklaması eskisi gibi doğrudan düzenler', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g, 'blDetailTable');
    g.Grid.register('blDetailTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k });
    const down = pointer(t.cell('1', 'x').input);
    g.fire('pointerdown', down);
    assert.equal(down.prevented, false);
    assert.equal(g.Grid.state('blDetailTable').activeCell, null);
  } finally { g.cleanup(); }
});

test('klavye geçişi hedef hücreyi doğrudan düzenleme modunda açar; Shift+ok aralık genişletir', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g);
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k, editOnDoubleClick: true });
    g.fire('pointerdown', pointer(t.cell('1', 'x').input));
    const down = key('ArrowDown', t.table);
    g.fire('keydown', down);
    assert.equal(down.prevented, true);
    assert.equal(g.doc.activeElement, t.cell('2', 'x').input);
    assert.equal(t.cell('2', 'x').input.selection, 'all');

    // Düzenleme modunda Shift+Yukarı: seçim moduna döner ve aralığı genişletir.
    const up = key('ArrowUp', t.cell('2', 'x').input, { shiftKey: true });
    g.fire('keydown', up);
    assert.equal(up.stopped, true);
    assert.equal(g.doc.activeElement, t.table);
    const s = g.Grid.state('cpTable');
    assert.deepEqual([s.selectionAnchor, s.selectionFocus], [{ rowId: '2', columnId: 'x' }, { rowId: '1', columnId: 'x' }]);
  } finally { g.cleanup(); }
});

test('Esc düzenlemeyi geri alır; seçili hücrede yazmak düzenlemeyi açar', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g);
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k, editOnDoubleClick: true });
    const c = t.cell('1', 'y');
    g.fire('pointerdown', pointer(c.input));
    g.fire('keydown', key('Z', t.table));
    assert.equal(g.doc.activeElement, c.input, 'yazmak düzenlemeyi açmalı');
    g.fire('focusin', { target: c.input });
    c.input.value = 'değişti';
    const esc = key('Escape', c.input);
    g.fire('keydown', esc);
    assert.equal(c.input.value, '1y', 'Esc özgün değeri geri yükler');
    assert.equal(g.doc.activeElement, t.table);
  } finally { g.cleanup(); }
});

test('menü/tarih tetikleyicisi ilk tıkta açılmaz; çift tıklamanın ikinci tıkı ve klavye açar', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g);
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k, editOnDoubleClick: true, editTriggerSelector: '.delTypeTrigger' });
    const { td } = t.cell('1', 'x');
    const redispatched = [];
    td.dispatchEvent = event => redispatched.push(event.type);
    const trigger = { closest: sel => (sel === 'tbody td[data-key]' ? td : sel === '.delTypeTrigger' ? trigger : null) };
    td.contains = node => node === trigger;
    const click = detail => ({ detail, target: trigger, prevented: false, stopped: false, clientX: 0, clientY: 0, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
    const first = click(1), second = click(2), keyboard = click(0);
    g.fire('click', first); g.fire('click', second); g.fire('click', keyboard);
    assert.equal(first.stopped, true, 'ilk tık tetikleyiciye ulaşmamalı');
    assert.deepEqual(redispatched, ['click'], 'dışarı-tık kapanışları için hücreye yeniden gönderilir');
    assert.equal(second.stopped, false);
    assert.equal(keyboard.stopped, false);
  } finally { g.cleanup(); }
});

test('CP/Orders grid kaydı çift tıkla düzenlemeyi açar ve tetikleyicileri tanımlar', () => {
  const app = read('public/app-main.js');
  assert.match(app, /editOnDoubleClick:true,\s*\n\s*editTriggerSelector:'\.delTypeTrigger,\.impTrigger,\.clStatusTrigger,\.exfDisplay,\.noteCellTrigger'/);
});

test('açılır pencereler dışarı tıklamayı pointerdown yakalama aşamasında yakalar', () => {
  const app = read('public/app-main.js');
  // Hücre seçimi pointerdown'ı iptal edince tarayıcı mousedown göndermez.
  assert.match(app, /document\.addEventListener\('pointerdown',e=>\{\n  if\(!_dateCalendarPopup\) return;[\s\S]*?closeDateCalendarPopup\(false\);\n\},true\);/);
  assert.match(app, /document\.addEventListener\('pointerdown', e=>closeSuggestionDropsOutside\(e\.target\), true\);/);
  assert.doesNotMatch(app, /document\.addEventListener\('mousedown', e=>\{\n  if\(_submfrDrop/);
});

test('CP güvenlik ağı yalnız gerçek editörleri kaydeder (düğme/span boş değer yazamaz)', () => {
  const app = read('public/app-main.js');
  assert.match(app, /if\(tableId==='cpTable' && \/\^\(INPUT\|SELECT\|TEXTAREA\)\$\/\.test\(String\(editor\.tagName\|\|''\)\.toUpperCase\(\)\)\) return \{route:'cp', editor, display\};/);
});

test('tek hücreye tek değer yapıştırma önizlemesiz editör üzerinden kaydedilir', () => {
  const g = loadGrid();
  try {
    const t = makeTable(g);
    let bulk = 0;
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k, editOnDoubleClick: true, applyPaste: async () => { bulk++; return { ok: true }; } });
    const c = t.cell('2', 'y');
    const changes = [];
    c.input.dispatchEvent = event => changes.push(event.type);
    globalThis.Event = globalThis.Event || class { constructor(type) { this.type = type; } };
    g.fire('pointerdown', pointer(c.input));
    const paste = { defaultPrevented: false, target: t.table, clipboardData: { getData: () => 'YENİ\r\n' }, prevented: false, preventDefault() { this.prevented = true; } };
    g.fire('paste', paste);
    assert.equal(paste.prevented, true);
    assert.equal(c.input.value, 'YENİ');
    assert.deepEqual(changes, ['change']);
    assert.equal(bulk, 0, 'toplu önizleme açılmamalı');

    // Çoklu hücre metni toplu yapıştırma yoluna gider.
    const multi = { defaultPrevented: false, target: t.table, clipboardData: { getData: () => 'a\tb' }, preventDefault() {} };
    g.fire('paste', multi);
    assert.equal(c.input.value, 'YENİ');
  } finally { g.cleanup(); }
});
