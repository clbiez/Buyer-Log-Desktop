'use strict';

/* Koleksiyon tablosu CP/Excel gibi davranır: tek tık hücreyi yalnız SEÇER
 * (sürükleyerek aralık, Shift ile genişletme, Ctrl ile çoklu seçim);
 * düzenleme çift tık, F2 veya seçili hücrede yazmaya başlamakla açılır.
 * Testler collection-spreadsheet.js'i sahte DOM'da çalıştırır (kaynak metni değil davranışı). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHEET = fs.readFileSync(path.join(ROOT, 'public/collection-spreadsheet.js'), 'utf8');
const Engine = require('../public/collection-spreadsheet-engine.js');

function classes(initial = []) {
  const set = new Set(initial);
  return { set, add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: c => set.has(c) };
}

function harness({ editable = key => key !== 'calc' && key !== 'trLanded', keys = ['a', 'b', 'calc'], extraClass = {}, catalogOpen = false } = {}) {
  const tableListeners = {}, docListeners = {}, focused = [], writes = [];
  const data = [{ id: 1 }, { id: 2 }];
  const document = {
    readyState: 'complete', body: { dataset: { activeTab: 'koleksiyon' }, appendChild() {} }, documentElement: { lang: 'tr' },
    activeElement: null,
    addEventListener(name, cb) { (docListeners[name] = docListeners[name] || []).push(cb); }, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, createElement: () => ({ remove() {}, addEventListener() {}, querySelector() { return null; } }),
    getElementById(id) { return id === 'kolTable' ? table : id === 'view-koleksiyon' ? { classList: classes() } : id === 'kolCatalogDropSingleton' && catalogOpen ? { isConnected: true, getClientRects: () => [{}] } : null; },
  };
  const table = { addEventListener(name, cb) { (tableListeners[name] = tableListeners[name] || []).push(cb); }, setAttribute() {}, removeAttribute() {}, focus() { document.activeElement = table; }, tHead: null };
  const makeEditor = (k, tagName = 'TEXTAREA', rect = { left: 0, right: 100, top: 0, bottom: 20 }) => {
    const editor = {
      tagName, type: k === 'flag' ? 'checkbox' : tagName === 'INPUT' ? 'text' : '', dataset: { k }, value: 'old', selected: false,
      focus() { document.activeElement = editor; focused.push(k); (docListeners.focusin || []).forEach(cb => cb({ target: editor })); }, blur() { if(document.activeElement !== editor) return; if(editor.value !== editor.originalValue){const row = data.find(row => String(row.id) === editor.td.closest('tr').dataset.id);row[k]=editor.value;writes.push({ rowId: row.id, key: k, value: editor.value });editor.originalValue=editor.value;}document.activeElement=null;(docListeners.focusout || []).forEach(cb => cb({ target: editor })); }, select() { editor.selected = true; },
      setSelectionRange() {}, getBoundingClientRect: () => rect,
      closest(sel) { return sel.includes('td[data-key]') ? editor.td : sel.includes('.editCell') ? editor : null; },
    };
    return editor;
  };
  const tds = data.map(row => keys.map(key => {
    const tr = { dataset: { id: String(row.id) }, querySelector() { return null; } };
    const editors = key === 'trLanded'
      ? [makeEditor('trPrice', 'INPUT', { left: 0, right: 40, top: 0, bottom: 20 }), makeEditor('trFx', 'INPUT', { left: 50, right: 90, top: 0, bottom: 20 })]
      : [makeEditor(key, key === 'inStore' || key === 'flag' ? 'INPUT' : 'TEXTAREA')];
    const td = {
      dataset: { key }, classList: classes(extraClass[key] || []), id: '', setAttribute() {}, removeAttribute() {},
      editors, querySelector: sel => (sel.includes('.editCell') ? editors[0] : null), querySelectorAll: sel => (sel.includes('.editCell') ? editors : []),
      closest(sel) { return sel === 'tr' ? tr : null; }, contains: el => editors.includes(el),
    };
    editors.forEach(editor => { editor.td = td; editor.originalValue = editor.value; });
    return td;
  }));
  const window = {
    BLCollectionSpreadsheetEngine: Engine, showToast() {},
    BLCollectionSpreadsheetBridge: {
      canEdit: () => true, selectedCount: () => 0, rows: () => data, rawValue: () => '',
      columnMeta: key => ({ label: key, editable: editable(key), col: {} }),
      validateValue: () => ({ ok: true }), batchEdit: () => ({ ok: true, changed: 0 }), enterDateEdit() {},
    },
  };
  new Function('window', 'document', 'setTimeout', 'getComputedStyle', SHEET)(window, document, fn => fn(), () => ({ visibility: 'visible' }));
  const api = window.BLCollectionSpreadsheet, state = api.state;
  state.cellRows = tds;
  tds.forEach((line, r) => line.forEach((td, c) => state.coordByCell.set(td, { r, c, rowId: String(data[r].id), key: keys[c], td })));
  // Gerçek tabloda bind() init sırasında çalışır; sahte DOM'da tablo dinleyicilerini doğrudan bağlarız.
  const pointerEvent = (target, extra = {}) => ({ button: 0, target, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra });
  const cellTarget = td => ({ closest: sel => (sel.includes('td[data-key]') ? td : null) });
  const dblclick = (td, target = cellTarget(td), extra = {}) => {
    const event = { target, clientX: 10, clientY: 10, defaultPrevented: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    (tableListeners.dblclick || []).forEach(cb => cb(event));
    return event;
  };
  const keydown = (key, extra = {}) => {
    const event = { target: table, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
    (tableListeners.keydown || []).forEach(cb => cb(event));
    return event;
  };
  const editorKeydown = (editor, key, extra = {}) => {
    const event = { target: editor, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {}, ...extra };
    (docListeners.keydown || []).forEach(cb => cb(event));
    return event;
  };
  return { api, state, tds, table, document, data, writes, focused, pointerEvent, cellTarget, dblclick, keydown, editorKeydown, tableListeners };
}

test('plain single click selects the cell and starts a drag range without entering edit mode', () => {
  const h = harness();
  const td = h.tds[0][0];
  // Hedef hücredeki gerçek editör olsa bile (eski tek tık düzenleme yolu) yalnız seçim yapılır.
  const event = h.pointerEvent(td.editors[0]);
  assert.equal(h.api.kolSpreadsheetHandlePointerEdit(event, td), true);
  assert.equal(event.prevented, true, 'native mousedown focus must be cancelled');
  assert.deepEqual(h.focused, []);
  assert.equal(h.state.editingCell, null);
  assert.equal(h.state.active.key, 'a');
  assert.equal(h.state.dragging, true, 'pointer drag extends the range like CP');
  assert.equal(td.classList.contains('kolSpreadsheetEditing'), false);
});

test('double click enters edit on editable cells only', () => {
  const h = harness();
  assert.equal((h.tableListeners.dblclick || []).length, 1, 'bind() wires one table dblclick handler');
  const editableEvent = h.dblclick(h.tds[0][1]);
  assert.equal(editableEvent.defaultPrevented, true);
  assert.deepEqual(h.focused, ['b']);
  assert.equal(h.tds[0][1].classList.contains('kolSpreadsheetEditing'), true);

  const calc = harness();
  calc.dblclick(calc.tds[0][2]);
  assert.deepEqual(calc.focused, [], 'calculated cells never open an editor');
});

test('once editing, clicks inside that editor stay native (caret / text selection)', () => {
  const h = harness();
  const td = h.tds[0][0];
  h.dblclick(td);
  assert.equal(h.state.editingCell, td);
  const event = h.pointerEvent(td.editors[0]);
  assert.equal(h.api.kolSpreadsheetHandlePointerEdit(event, td), false);
  assert.equal(event.prevented, false);
});

test('double click on a compound cell focuses the editable input under the pointer', () => {
  const h = harness({ keys: ['trLanded'] });
  const td = h.tds[0][0];
  h.dblclick(td, h.cellTarget(td), { clientX: 60, clientY: 10 });
  assert.deepEqual(h.focused, ['trFx']);
});

test('double click leaves period cells to their own picker handler', () => {
  const h = harness({ extraClass: { a: ['kolPeriodTd'] } });
  const event = h.dblclick(h.tds[0][0]);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(h.focused, []);
});

test('typing on a selected single cell starts editing (Excel); calculated cells ignore it', () => {
  const h = harness();
  h.api.setActive(h.tds[1][0]);
  const event = h.keydown('x');
  assert.deepEqual(h.focused, ['a']);
  assert.equal(h.tds[1][0].editors[0].selected, true, 'existing text is selected so the typed key replaces it');
  assert.equal(event.prevented, false, 'the browser delivers the typed character to the focused editor');

  const calc = harness();
  calc.api.setActive(calc.tds[0][2]);
  calc.keydown('x');
  assert.deepEqual(calc.focused, []);
});

test('Shift and Ctrl clicks keep range / multi-cell selection without editing', () => {
  const h = harness();
  h.api.kolSpreadsheetHandlePointerEdit(h.pointerEvent(h.cellTarget(h.tds[0][0])), h.tds[0][0]);
  h.api.kolSpreadsheetHandlePointerEdit(h.pointerEvent(h.cellTarget(h.tds[1][1]), { shiftKey: true }), h.tds[1][1]);
  const bounds = Engine.rangeBounds(h.state.anchor, h.state.focus);
  assert.equal(Engine.cellsInRange(bounds).length, 4);
  h.api.kolSpreadsheetHandlePointerEdit(h.pointerEvent(h.cellTarget(h.tds[0][2]), { ctrlKey: true }), h.tds[0][2]);
  assert.equal(h.state.multiCells.size, 5);
  assert.deepEqual(h.focused, []);
});

test('keyboard arrows, Tab and Enter open selected editors, but not calculated, period or checkbox cells', () => {
  const arrow = harness();
  arrow.api.setActive(arrow.tds[0][0]);
  arrow.keydown('ArrowRight');
  assert.equal(arrow.state.active.key, 'b');
  assert.equal(arrow.state.keyboardEntry, true);
  assert.equal(arrow.document.activeElement, arrow.tds[0][1].editors[0]);
  assert.equal(arrow.tds[0][1].editors[0].selected, true);
  arrow.editorKeydown(arrow.tds[0][1].editors[0], 'ArrowRight');
  assert.equal(arrow.state.active.key, 'calc');
  assert.equal(arrow.state.keyboardEntry, false);
  assert.equal(arrow.document.activeElement, arrow.table);

  const period = harness({ keys: ['a', 'inStoreWeek', 'flag'], extraClass: { inStoreWeek: ['kolPeriodTd'] } });
  period.api.setActive(period.tds[0][0]);
  period.keydown('ArrowRight');
  assert.equal(period.state.active.key, 'inStoreWeek');
  assert.equal(period.state.editingCell, null);
  period.keydown('ArrowRight');
  assert.equal(period.state.active.key, 'flag');
  assert.equal(period.state.editingCell, null);

  const checklist = harness({ keys: ['a', 'checklist'], editable: key => key !== 'checklist' });
  checklist.api.setActive(checklist.tds[0][0]);
  checklist.keydown('ArrowRight');
  assert.equal(checklist.state.active.key, 'checklist');
  assert.equal(checklist.state.editingCell, null);
  assert.equal(checklist.document.activeElement, checklist.table);

  const tab = harness();
  tab.api.setActive(tab.tds[0][0]);
  tab.keydown('Tab');
  assert.equal(tab.state.active.key, 'b');
  assert.equal(tab.state.keyboardEntry, true);

  const enter = harness();
  enter.api.setActive(enter.tds[0][0]);
  enter.keydown('Enter');
  assert.equal(enter.state.active.rowId, '2');
  assert.equal(enter.state.keyboardEntry, true);
});
test('F2 from keyboard entry switches to full editing with native arrows; double-click does too', () => {
  const h = harness();
  h.api.setActive(h.tds[0][0]);
  h.keydown('ArrowRight');
  const editor=h.tds[0][1].editors[0];
  const f2=h.editorKeydown(editor,'F2');
  assert.equal(f2.prevented,true);
  assert.equal(h.state.keyboardEntry,false);
  const left=h.editorKeydown(editor,'ArrowLeft');
  assert.equal(left.prevented,false);
  assert.equal(h.state.active.key,'b');

  const d = harness();
  d.dblclick(d.tds[0][0]);
  assert.equal(d.state.keyboardEntry,false);
  const nativeArrow=d.editorKeydown(d.tds[0][0].editors[0],'ArrowRight');
  assert.equal(nativeArrow.prevented,false);
  assert.equal(d.state.active.key,'a');
});
test('Escape clears entry immediately and Shift+Arrow extends range without editing', () => {
  const h=harness();
  h.api.setActive(h.tds[0][0]);
  h.keydown('ArrowRight');
  const editor=h.tds[0][1].editors[0];
  const shift=h.editorKeydown(editor,'ArrowLeft',{shiftKey:true});
  assert.equal(shift.prevented,true);
  assert.equal(h.state.keyboardEntry,false);
  assert.equal(h.state.editingCell,null);
  assert.equal(Engine.cellsInRange(Engine.rangeBounds(h.state.anchor,h.state.focus)).length,2);

  const esc=harness();
  esc.api.setActive(esc.tds[0][0]);
  esc.keydown('ArrowRight');
  const edit=esc.tds[0][1].editors[0];
  esc.editorKeydown(edit,'Escape');
  assert.equal(esc.state.keyboardEntry,false,'capture clears mode even if a date editor swallows Escape');
  esc.state.keyboardEntry=true;
  esc.api.endEdit();
  assert.equal(esc.state.keyboardEntry,false,'legacy Escape/endEdit clears mode synchronously');
});
test('catalogue dropdown owns vertical arrows while open', () => {
  const h=harness({catalogOpen:true});
  h.api.setActive(h.tds[0][0]);
  h.keydown('ArrowRight');
  const editor=h.tds[0][1].editors[0];
  const down=h.editorKeydown(editor,'ArrowDown');
  assert.equal(down.prevented,false);
  assert.equal(h.state.active.key,'b');
  assert.equal(h.state.keyboardEntry,true);
});
test('blur/change commits typed text and MB Date before arrow navigation', () => {
  const h=harness();
  h.api.setActive(h.tds[0][0]);
  h.keydown('ArrowRight');
  const editor=h.tds[0][1].editors[0];
  editor.value='Sand';
  const down=h.editorKeydown(editor,'ArrowDown');
  assert.equal(down.prevented,true);
  assert.deepEqual(h.writes,[{rowId:1,key:'b',value:'Sand'}]);
  assert.equal(h.data[0].b,'Sand');
  assert.equal(h.state.active.rowId,'2');
  assert.equal(h.state.editingCell,h.tds[1][1]);

  const date=harness({keys:['a','inStore']});
  date.api.setActive(date.tds[0][0]);
  date.keydown('ArrowRight');
  const dateEditor=date.tds[0][1].editors[0];
  dateEditor.value='15.05.27';
  date.editorKeydown(dateEditor,'ArrowLeft');
  assert.equal(date.data[0].inStore,'15.05.27');
  assert.equal(date.state.active.key,'a');
});
