'use strict';

/* v7.0.290 — Koleksiyon / CP / Orders / alt detay raporları: kopyala-yapıştır
 * uçtan uca düzeltmeleri. Testler kaynak metni değil davranışı çalıştırır.
 *
 *  1) Ctrl+C varsayılanı başlıksız "Kopyala"dır; başlıklı kopya yalnız sağ tık
 *     › "Başlıklarla kopyala" ile bilerek seçilir.
 *  2) İşaretli model varken "en son seçim kazanır": kutudan SONRA seçilen
 *     hücre kopyalanır; hücreden sonra kutu işaretlenirse modeller kazanır.
 *  3) Ctrl+tık mevcut aralığı korur (Excel: seçime EKLER).
 *  4) Kopya boyutu seçimle eşleşmiyorsa yapıştırma reddedilmez; sol üst
 *     hücreden başlayarak önizlemeyle uygulanır.
 *  5) Delete aralığın tamamını, Ctrl+D aşağı doldurmayı tek işlemde yapar;
 *     Ctrl+A ve sütun harfi tüm hücreleri/sütunu seçer.
 *  5b) Escape düzenlemeden çıkar, hücre seçili kalır (Excel).
 *  6) Kapalı detay çekmecesi (DOM'da kalan, ekran dışı, aria-hidden) açık
 *     pencere sayılmaz — Ctrl+C/Ctrl+V bir detay raporundan sonra ölmez.
 *  7) Ortak grid motoru: bağlantı/görsel taşıyan hücre de seçilir; üst katman
 *     (detay çekmecesi) arkadaki CP seçiminden önce gelir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const Engine = require('../public/collection-spreadsheet-engine.js');
const SHEET = read('public/collection-spreadsheet.js');

const KEYS = ['a', 'b'];

function harness({ rows = 3, checked = 0, editable = () => true } = {}) {
  const listeners = {}, tableListeners = {}, writes = [], copies = [], toasts = [], previews = [];
  let selected = checked;
  const data = Array.from({ length: rows }, (_, r) => ({ id: r + 1, a: `a${r + 1}`, b: `b${r + 1}` }));
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  const tds = data.map(row => KEYS.map(key => {
    const tr = { dataset: { id: String(row.id) }, querySelector() { return null; } };
    return {
      dataset: { key }, classList, id: '',
      setAttribute() {}, removeAttribute() {}, querySelector() { return null; },
      closest(selector) { return selector === 'tr' ? tr : null; },
    };
  }));
  const table = {
    addEventListener(name, cb) { (tableListeners[name] = tableListeners[name] || []).push(cb); },
    setAttribute() {}, removeAttribute() {}, focus() {}, tHead: null,
  };
  const root = { classList: { add() {}, remove() {} } };
  const makeOverlay = () => {
    const buttons = { '[data-cancel]': {}, '[data-apply]': {}, '.kolSpreadsheetPasteCard': { focus() {} } };
    return { className: '', innerHTML: '', remove() {}, addEventListener() {}, querySelector: sel => buttons[sel] || null, buttons };
  };
  const document = {
    readyState: 'complete',
    body: {
      dataset: { activeTab: 'koleksiyon' },
      appendChild(el) { previews.push(el.innerHTML); Promise.resolve().then(() => el.buttons['[data-apply]'].onclick()); },
    },
    documentElement: { lang: 'tr' },
    activeElement: null,
    addEventListener(name, cb) { listeners[name] = cb; },
    removeEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement: makeOverlay,
    getElementById(id) { return id === 'kolTable' ? table : id === 'view-koleksiyon' ? root : null; },
  };
  const window = {
    BLCollectionSpreadsheetEngine: Engine,
    showToast(message) { toasts.push(message); },
    BLCopyRichToClipboard: async (_html, plain) => { copies.push(plain); return true; },
    BLCollectionSpreadsheetBridge: {
      canEdit: () => true,
      selectedCount: () => selected,
      rows: () => data,
      rawValue: (row, key) => row?.[key],
      columnMeta: key => ({ label: key.toUpperCase(), editable: editable(key), col: {} }),
      validateValue: (_rowId, key, value) => (editable(key) ? { ok: true, value } : { ok: false, reason: 'calculated' }),
      batchEdit: ops => { writes.push(...ops); return { ok: true, changed: ops.length, updatedRows: new Set(ops.map(op => op.rowId)).size }; },
    },
  };
  new Function('window', 'document', 'setTimeout', 'getComputedStyle', SHEET)(window, document, fn => fn(), () => ({ visibility: 'visible' }));
  const api = window.BLCollectionSpreadsheet, state = api.state;
  state.cellRows = tds;
  tds.forEach((line, r) => line.forEach((td, c) => state.coordByCell.set(td, { r, c, rowId: String(data[r].id), key: KEYS[c], td })));
  const keyEvent = (key, extra = {}) => ({ target: table, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra });
  const pressTable = event => (tableListeners.keydown || []).forEach(cb => cb(event));
  const plainEvent = () => ({ target: { closest() { return null; } }, preventDefault() {}, stopImmediatePropagation() {} });
  const checkbox = isChecked => listeners.change({ target: { closest: sel => (sel.includes('rowChk') ? { checked: isChecked } : null) } });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {
    api, state, tds, table, listeners, tableListeners, writes, copies, toasts, previews,
    keyEvent, pressTable, plainEvent, checkbox, tick, setSelected: n => { selected = n; },
    selectRange(r1, c1, r2, c2) { api.setActive(tds[r1][c1]); api.setActive(tds[r2][c2], { extend: true }); },
  };
}

test('Ctrl+C varsayılanı başlıksız Kopyala; çok hücreli aralıkta da başlık yazılmaz', async () => {
  const h = harness();
  h.selectRange(0, 0, 1, 1);
  assert.equal(h.api.handleCopyShortcut(h.plainEvent()), true);
  await h.tick();
  assert.equal(h.copies[0], 'a1\tb1\na2\tb2');
  assert.doesNotMatch(h.toasts.at(-1), /başlıklarıyla/);
});

test('sağ tık "Başlıklarla kopyala" başlık satırını bilerek ekler', async () => {
  const h = harness();
  h.selectRange(0, 0, 1, 1);
  assert.equal(h.api.handleCopyShortcut(h.plainEvent(), { includeHeaders: true, forceCellCopy: true }), true);
  await h.tick();
  assert.equal(h.copies[0], 'A\tB\na1\tb1\na2\tb2');
});

test('işaretli model varken: kutudan SONRA seçilen hücre kopyalanır', async () => {
  const h = harness({ checked: 2 });
  h.checkbox(true);
  h.api.setActive(h.tds[2][1]);
  assert.equal(h.api.handleCopyShortcut(h.plainEvent()), true, 'sonradan seçilen hücre kopyalanmalı');
  await h.tick();
  assert.equal(h.copies[0], 'b3');
  assert.match(h.toasts.at(-1), /İşaretli modeller kopyalanmadı/);
});

test('işaretli model varken: hücreden SONRA kutu değişirse modeller kazanır ve bayat hücre temizlenir', () => {
  const h = harness({ checked: 2 });
  h.api.setActive(h.tds[0][0]);
  h.checkbox(false); // işaretli kümeden bir kutu kaldırıldı; kalan modeller hâlâ işaretli
  assert.equal(h.state.active, null, 'bayat hücre seçimi kalmamalı');
  assert.equal(h.api.handleCopyShortcut(h.plainEvent()), false, 'Ctrl+C işaretli modellere devretmeli');
});

test('Escape düzenlemeden çıkar ama hücre seçili kalır; Ctrl+C hemen ardından o hücreyi kopyalar', async () => {
  const h = harness({ checked: 1 });
  h.checkbox(true);
  h.api.setActive(h.tds[1][1]);
  h.api.endEdit(); // app-main Escape yolu: el.blur(); BLCollectionSpreadsheet.endEdit()
  assert.equal(h.state.active?.key, 'b', 'Escape aktif hücreyi silmemeli');
  assert.equal(h.api.handleCopyShortcut(h.plainEvent()), true);
  await h.tick();
  assert.equal(h.copies[0], 'b2');
  // İkinci Escape (ızgara modunda) seçimi temizler.
  h.pressTable(h.keyEvent('Escape'));
  assert.equal(h.state.active, null);
});

test('Ctrl+tık mevcut aralığı korur ve hücreyi seçime ekler', async () => {
  const h = harness();
  h.selectRange(0, 0, 1, 0);
  const event = { ctrlKey: true, target: { closest() { return null; } }, preventDefault() {}, stopImmediatePropagation() {} };
  h.api.kolSpreadsheetHandlePointerEdit(event, h.tds[2][1]);
  assert.equal(h.state.multiCells.size, 3, 'a1, a2 ve b3 seçili olmalı');
  assert.equal(h.api.handleCopyShortcut(h.plainEvent()), true);
  await h.tick();
  assert.equal(h.copies[0], 'a1\t\na2\t\n\tb3');
});

test('boyutu uymayan kopya sol üst hücreden yapıştırılır (reddedilmez) ve önizleme bunu söyler', async () => {
  const h = harness();
  h.selectRange(0, 0, 2, 1); // 3×2 seçim
  assert.equal(await h.api.pasteText('x\ty\nz\tw'), true); // 2×2 kopya
  assert.deepEqual(h.writes, [
    { rowId: '1', key: 'a', value: 'x' }, { rowId: '1', key: 'b', value: 'y' },
    { rowId: '2', key: 'a', value: 'z' }, { rowId: '2', key: 'b', value: 'w' },
  ]);
  assert.match(h.previews[0], /sol üst hücresinden/);
});

test('tek değer seçili aralığın her hücresine yapıştırılır (çoklu yapıştırma)', async () => {
  const h = harness();
  h.selectRange(0, 1, 2, 1);
  assert.equal(await h.api.pasteText('X'), true);
  assert.deepEqual(h.writes.map(op => `${op.rowId}${op.key}=${op.value}`), ['1b=X', '2b=X', '3b=X']);
});

test('aktif hücre salt-okunur olsa da aralıktaki düzenlenebilir hücrelere yapıştırılır', async () => {
  const h = harness({ editable: key => key === 'b' });
  h.selectRange(0, 0, 1, 1);
  assert.equal(await h.api.pasteText('V'), true);
  assert.deepEqual(h.writes.map(op => `${op.rowId}${op.key}`), ['1b', '2b']);
});

test('Delete seçili aralığın tamamını tek işlemde temizler', async () => {
  const h = harness();
  h.selectRange(0, 0, 1, 1);
  const event = h.keyEvent('Delete');
  h.pressTable(event);
  assert.equal(event.prevented, true);
  await h.tick(); await h.tick();
  assert.equal(h.writes.length, 4);
  assert.ok(h.writes.every(op => op.value === ''));
  assert.match(h.previews[0], /Temizleme Önizlemesi/);
  assert.match(h.toasts.at(-1), /temizlendi/);
});

test('Ctrl+D ilk satırı aşağı doldurur; ilk satıra yeniden yazmaz', async () => {
  const h = harness();
  h.selectRange(0, 0, 2, 1);
  h.pressTable(h.keyEvent('d', { ctrlKey: true }));
  await h.tick(); await h.tick();
  assert.deepEqual(h.writes.map(op => `${op.rowId}${op.key}=${op.value}`), ['2a=a1', '2b=b1', '3a=a1', '3b=b1']);
});

test('Ctrl+A tüm görünen hücreleri, sütun harfi o sütunun tamamını seçer', () => {
  const h = harness();
  h.api.setActive(h.tds[1][1]);
  const event = h.keyEvent('a', { ctrlKey: true });
  h.pressTable(event);
  assert.equal(event.prevented, true);
  assert.deepEqual([h.state.anchor.r, h.state.anchor.c, h.state.focus.r, h.state.focus.c], [0, 0, 2, 1]);

  const letter = { dataset: { letterIndex: '1' } };
  const pointer = { button: 0, shiftKey: false, target: { closest: sel => (sel === '.kolSpreadsheetLetter' ? letter : null) }, preventDefault() {}, stopImmediatePropagation() {} };
  h.tableListeners.pointerdown.forEach(cb => cb(pointer));
  assert.deepEqual([h.state.anchor.r, h.state.anchor.c, h.state.focus.r, h.state.focus.c], [0, 1, 2, 1]);
});

test('yerel copy olayı keydown yolunu atlasa da seçili hücreler panoya eşzamanlı yazılır', () => {
  const h = harness();
  h.api.setActive(h.tds[1][0]);
  const data = {};
  const event = { target: { closest() { return null; } }, defaultPrevented: false, clipboardData: { setData(type, value) { data[type] = value; } }, preventDefault() { this.defaultPrevented = true; } };
  h.listeners.copy(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(data['text/plain'], 'a2');
});

/* -------------------------------------------- modal görünürlüğü (kök neden) */

function modalOpenFor(elements, { innerWidth = 1280, innerHeight = 800 } = {}) {
  const lines = SHEET.split(/\r?\n/);
  const visible = lines.find(l => l.includes('function modalVisible('));
  const open = lines.find(l => l.includes('function modalOpen('));
  const factory = new Function('document', 'getComputedStyle', 'global', `${visible}\n${open}\nreturn modalOpen;`);
  return factory({ querySelectorAll: () => elements }, () => ({ visibility: 'visible' }), { innerWidth, innerHeight })();
}
const dialog = ({ rect = { left: 100, right: 900, top: 0, bottom: 800 }, hiddenAncestor = false } = {}) => ({
  getClientRects: () => [{}],
  getBoundingClientRect: () => rect,
  closest: () => (hiddenAncestor ? {} : null),
});

test('kapalı detay çekmecesi (aria-hidden ata) açık pencere sayılmaz', () => {
  assert.equal(modalOpenFor([dialog({ hiddenAncestor: true })]), false);
});

test('ekran dışına kaydırılmış (translateX) pencere açık sayılmaz; görünen pencere sayılır', () => {
  assert.equal(modalOpenFor([dialog({ rect: { left: 1300, right: 2280, top: 0, bottom: 800 } })]), false);
  assert.equal(modalOpenFor([dialog()]), true);
});

test('detay çekmecesi paneli kapalıyken visibility:hidden olur', () => {
  const css = read('public/detail-drawer.css');
  assert.match(css, /\.blDetailDrawerPanel\{[^}]*visibility:hidden/);
  assert.match(css, /\.blDetailDrawer\.is-open \.blDetailDrawerPanel\{[^}]*visibility:visible/);
});

/* ------------------------------------------------ ortak grid motoru (CP/Orders) */

function loadGrid() {
  delete require.cache[require.resolve('../public/grid-clipboard.js')];
  const listeners = {};
  const tables = {};
  globalThis.document = {
    addEventListener(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    getElementById: id => tables[id] || null,
  };
  globalThis.getSelection = () => ({ rangeCount: 0, isCollapsed: true, removeAllRanges() {} });
  const Grid = require('../public/grid-clipboard.js');
  const makeTable = id => {
    const table = { id, _blRenderedRows: [{ _id: 1 }, { _id: 2 }], _blRenderedColumns: [{ k: 'x' }, { k: 'y' }], setAttribute() {}, removeAttribute() {}, focus() {}, querySelectorAll: () => [], contains: () => true };
    tables[id] = table;
    return table;
  };
  return { Grid, listeners, makeTable, cleanup() { delete globalThis.document; delete globalThis.getSelection; } };
}

test('grid: bağlantı/görsel içeren hücre de seçilir ve iç öğenin tıklaması korunur', () => {
  const g = loadGrid();
  try {
    const table = g.makeTable('cpTable');
    g.Grid.register('cpTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k });
    const tr = { dataset: { id: '2' } };
    const td = { dataset: { key: 'y' }, closest: sel => (sel === 'tbody tr[data-id]' ? tr : sel === 'table' ? table : null) };
    const link = { closest: sel => (sel === 'tbody td[data-key]' ? td : sel === 'button,a,img,label' ? link : null) };
    let prevented = false;
    g.listeners.pointerdown.forEach(cb => cb({ button: 0, shiftKey: false, target: link, preventDefault() { prevented = true; } }));
    assert.deepEqual(g.Grid.state('cpTable').activeCell, { rowId: '2', columnId: 'y' });
    assert.equal(prevented, false, 'bağlantının kendi tıklaması engellenmemeli');
  } finally { g.cleanup(); }
});

test('grid: Ctrl+C başlıksız kopyalar; üst katman (detay çekmecesi) arkadaki CP seçiminden önce gelir', async () => {
  const g = loadGrid();
  try {
    g.makeTable('cpTable'); g.makeTable('blDetailTable');
    const calls = [];
    const exporter = { buildMatrix: ({ records, columns }) => ({ headers: columns.map(c => c.k), rows: records.map(r => columns.map(c => `${r._id}${c.k}`)) }) };
    const config = id => ({ isActive: () => true, rowId: r => r._id, columnId: c => c.k, exporter, copy: async (_m, _r, _s, options) => { calls.push({ id, options }); return true; } });
    g.Grid.register('cpTable', config('cpTable'));
    g.Grid.register('blDetailTable', { ...config('blDetailTable'), priority: 10 });
    g.Grid.state('cpTable').activeCell = g.Grid.state('cpTable').selectionAnchor = g.Grid.state('cpTable').selectionFocus = { rowId: '1', columnId: 'x' };
    g.Grid.state('blDetailTable').activeCell = g.Grid.state('blDetailTable').selectionAnchor = g.Grid.state('blDetailTable').selectionFocus = { rowId: '2', columnId: 'y' };
    g.listeners.keydown.forEach(cb => cb({ key: 'c', ctrlKey: true, target: { closest: () => null }, preventDefault() {}, stopImmediatePropagation() {} }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ id: 'blDetailTable', options: { includeHeaders: false } }]);
  } finally { g.cleanup(); }
});

test('grid: Ctrl+A tablonun görünen tüm hücrelerini seçer', () => {
  const g = loadGrid();
  try {
    g.makeTable('ordersTable');
    g.Grid.register('ordersTable', { isActive: () => true, rowId: r => r._id, columnId: c => c.k });
    assert.equal(g.Grid.selectAll('ordersTable'), true);
    const s = g.Grid.state('ordersTable');
    assert.deepEqual([s.selectionAnchor, s.selectionFocus], [{ rowId: '1', columnId: 'x' }, { rowId: '2', columnId: 'y' }]);
  } finally { g.cleanup(); }
});

/* --------------------------------------------- bağlantılar (kaynak sözleşmesi) */

test('alt detay raporu çekmecesi ortak grid motoruna bağlı', () => {
  const drawer = read('public/detail-drawer.js');
  assert.match(drawer, /<table class="blDetailTable" id="blDetailTable"/);
  assert.match(drawer, /'<tr data-id="'\+escapeHtml\(rowKey\(row\)\)\+'">'/);
  assert.match(drawer, /data-key="'\+escapeHtml\(col\.key\)\+'" data-r="'\+index\+'" data-c="'\+colIndex\+'"/);
  assert.match(drawer, /priority:10/);
  assert.match(drawer, /root\.BLGridClipboard\?\.clear\?\.\(CLIPBOARD_TABLE_ID\);\n  render\(\);/);
  const app = read('public/app-main.js');
  assert.match(app, /!blOverlayOpen\(\)&&!window\.BLDetailDrawer\?\.isOpen\?\.\(\)/,
    'detay çekmecesi açıkken arkadaki CP/Orders Ctrl+C\'yi almamalı');
});

test('sağ tık menüleri: Kopyala (Ctrl+C) önce, başlıklı kopya ikinci, işaretli satırlar ayrıca', () => {
  const menu = read('public/row-context-menu.js');
  const start = menu.indexOf('function managedClipboardEntries(');
  const block = menu.slice(start, menu.indexOf('function openManagedGridCopyMenu', start));
  assert.ok(block.indexOf("T('Kopyala', 'Copy'), key: 'Ctrl+C'") < block.indexOf("T('Başlıklarla kopyala', 'Copy with headers')"));
  assert.doesNotMatch(block, /'Copy with headers'\), key: 'Ctrl\+C'/);
  assert.match(block, /İşaretli \$\{checked\.size\} satırı kopyala/);
  assert.match(menu, /\{ sel: '#blDetailTable', module: 'detail', tools: '' \}/);

  const ctx = SHEET.slice(SHEET.indexOf('function cellContext('), SHEET.indexOf('\n  function bind('));
  assert.ok(ctx.indexOf("'Copy':'Kopyala',key:'Ctrl+C'") < ctx.indexOf("'Copy with headers':'Başlıklarla kopyala'"));
  assert.match(ctx, /İşaretli \$\{checkedModels\} modeli kopyala/);
  assert.match(ctx, /'Fill Down':'Aşağı Doldur',key:'Ctrl\+D'/);
});
