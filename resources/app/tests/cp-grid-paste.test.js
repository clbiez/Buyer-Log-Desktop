'use strict';

/* CP hücreler arası çoklu yapıştırma (Ctrl+V).
 *  1) Ortak grid motoru kopyalanan matrisi seçime Excel gibi yerleştirir:
 *     tek değer seçimi doldurur, tam kat desen tekrarlanır, aksi hâlde sol üst
 *     hücreden kopya boyutunca yapıştırılır; salt-okunur/geçersiz hücre atlanır.
 *  2) Hücre düzenleyicisindeki (input) tek değer yerel yapıştırılır; Excel'den
 *     gelen çoklu hücre o hücreden başlayarak dağıtılır.
 *  3) CP yalnız elle girilen alanlara, tek hücre düzenlemesiyle aynı
 *     commitCpEditor yolundan yazar ve tüm yapıştırma tek geri alma adımıdır.
 *     Orders salt kopyalama kalır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
const GRID_PATH = path.join(ROOT, 'public/grid-clipboard.js');
const GridClipboard = require(GRID_PATH);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let parens=0,open=-1;
  for(let i=source.indexOf('(',start);i<source.length;i++){
    if(source[i]==='(')parens++;
    else if(source[i]===')'&&--parens===0){open=source.indexOf('{',i);break;}
  }
  assert.ok(open>start,`${name} gövdesi bulunmalı`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

const rows = [1, 2, 3, 4].map(id => ({ _id: id, a: `a${id}`, b: `b${id}`, ro: 'x' }));
const columns = [{ k: 'a' }, { k: 'b' }, { k: 'ro' }];
const target = (row, column) => (column.k === 'ro' ? null : 'text');
const range = (startRow, endRow, startColumn, endColumn) => ({ startRow, endRow, startColumn, endColumn });
const cells = plan => plan.ops.map(op => `${op.row._id}.${op.column.k}=${op.value}`);

test('tek değer seçili aralığın tamamını doldurur, salt-okunur hücre atlanır', () => {
  const plan = GridClipboard.planPaste({ text: 'X\r\n', rows, columns, range: range(0, 1, 0, 2), target });
  assert.equal(plan.mode, 'fill');
  assert.deepEqual(cells(plan), ['1.a=X', '1.b=X', '2.a=X', '2.b=X']);
  assert.equal(plan.readonly, 2);
  assert.deepEqual(plan.target, range(0, 1, 0, 2));
});

test('Excel sütunu tek hücreden aşağı yapıştırılır; tablo dışı kısım sayılır', () => {
  const plan = GridClipboard.planPaste({ text: '1\n2\n3\n4\n5\n6', rows, columns, range: range(2, 2, 1, 1), target });
  assert.equal(plan.mode, 'anchor');
  assert.deepEqual(cells(plan), ['3.b=1', '4.b=2']);
  assert.equal(plan.skipped, 4);
  assert.deepEqual(plan.target, range(2, 3, 1, 1));
});

test('seçim kopyanın tam katıysa desen tekrarlanır; uyumsuz boyut sol üstten yapıştırılır', () => {
  const tile = GridClipboard.planPaste({ text: 'p\tq', rows, columns, range: range(0, 2, 0, 1), target });
  assert.equal(tile.mode, 'tile');
  assert.deepEqual(cells(tile), ['1.a=p', '1.b=q', '2.a=p', '2.b=q', '3.a=p', '3.b=q']);
  const mismatch = GridClipboard.planPaste({ text: 'm\nn', rows, columns, range: range(0, 2, 0, 0), target });
  assert.equal(mismatch.mode, 'anchor');
  assert.deepEqual(cells(mismatch), ['1.a=m', '2.a=n']);
});

test('geçersiz değer atlanır ve değer ayrıştırıcıdan normalize edilmiş gelir', () => {
  const parse = raw => (/^\d+$/.test(raw) ? { ok: true, value: Number(raw) } : { ok: false });
  const plan = GridClipboard.planPaste({ text: '7\tabc', rows, columns, range: range(0, 0, 0, 0), target, parse });
  assert.deepEqual(cells(plan), ['1.a=7']);
  assert.equal(plan.invalid, 1);
});

test('çoklu hücre metni ayrımı: sekme/satır sonu yoksa yerel yapıştırma korunur', () => {
  assert.equal(GridClipboard.isMultiCellText('1,30'), false);
  assert.equal(GridClipboard.isMultiCellText('1,30\r\n'), false);
  assert.equal(GridClipboard.isMultiCellText('1,30\n1,40'), true);
  assert.equal(GridClipboard.isMultiCellText('a\tb'), true);
});

function loadGridWithDocument() {
  const listeners = {};
  const makeTd = (rowId, key, r, c) => {
    const tr = { dataset: { id: String(rowId) } };
    const td = {
      dataset: { key, r: String(r), c: String(c) }, id: '',
      classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
      closest(selector) {
        if (selector.includes('tr[data-id]')) return tr;
        if (selector === 'table') return table;
        if (selector.includes('td[data-key]')) return td;
        return null;
      },
    };
    return td;
  };
  const table = {
    id: 'cpTable', setAttribute() {}, removeAttribute() {}, focus() {},
    contains(node) { return node === input || node === table; },
    querySelectorAll(selector) { return selector.includes('td[data-key]') ? tds : []; },
    _blRenderedRows: rows, _blRenderedColumns: columns,
  };
  const tds = rows.flatMap((row, r) => columns.map((column, c) => makeTd(row._id, column.k, r, c)));
  const input = {
    closest(selector) {
      if (selector.includes('input')) return input;
      if (selector.includes('td[data-key]')) return tds[1 * columns.length + 1];
      return null;
    },
  };
  const document = {
    addEventListener(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    getElementById(id) { return id === 'cpTable' ? table : null; },
    body: {},
  };
  const previous = globalThis.document;
  globalThis.document = document;
  delete require.cache[require.resolve(GRID_PATH)];
  const grid = require(GRID_PATH);
  delete require.cache[require.resolve(GRID_PATH)];
  const applied = [];
  // Motor document'ı kayıt anında bağlar; ancak sonra eski global'e dön.
  grid.register('cpTable', {
    rowId: row => row._id, columnId: column => column.k,
    pasteTarget: target,
    applyPaste: plan => { applied.push(cells(plan)); return { ok: true }; },
  });
  const paste = (eventTarget, text) => {
    const event = {
      target: eventTarget, prevented: false,
      clipboardData: { getData: type => (type === 'text/plain' ? text : ''), items: [] },
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() {},
    };
    listeners.paste.forEach(cb => cb(event));
    return event;
  };
  const restore = () => { globalThis.document = previous; };
  return { paste, input, table, applied, restore };
}

test('hücre düzenleyicisinde tek değer yerel kalır, Excel çoklu hücresi o hücreden dağıtılır', async () => {
  const { paste, input, applied, restore } = loadGridWithDocument();
  const single = paste(input, '1,45');
  assert.equal(single.prevented, false);
  const multi = paste(input, '1,45\n1,50\n1,55');
  assert.equal(multi.prevented, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(applied, [['2.b=1,45', '3.b=1,50', '4.b=1,55']]);
  restore();
});

test('CP elle girilen alanlara yazar; Orders yapıştırma almaz', () => {
  const register = extractFunction(APP, 'registerManagedGridClipboard');
  assert.match(register, /applyPaste:tableKey==='cp'\?applyCpGridPaste:undefined/);
  assert.match(register, /pasteTarget:tableKey==='cp'\?cpPasteTarget:undefined/);
  const cpPasteTarget = new Function('turknorm', 'licenseLicensorStateForRow', 'norm', 'window',
    `${extractFunction(APP, 'cpPasteTarget')}; return cpPasteTarget;`)(
    value => String(value || '').toUpperCase(),
    () => ({ hasLicense: true, status: 'resolved' }),
    value => String(value || '').trim(),
    { BLOrderImportanceUI: { pasteResolve() {} } },
  );
  const row = { _id: 1, Licensor: 'WB', License: 'Batman' };
  assert.equal(cpPasteTarget(row, { k: 'Supp. FOB', type: 'moneyEdit' }), 'suppfob');
  assert.equal(cpPasteTarget(row, { k: 'Ex-factory', type: 'exfactory' }), 'exfactory');
  assert.equal(cpPasteTarget(row, { k: 'Del. Type', type: 'deltype' }), 'deltype');
  assert.equal(cpPasteTarget(row, { k: 'Sub-Manufacturer', type: 'submfr' }), 'submfr');
  assert.equal(cpPasteTarget(row, { k: 'Importance', type: 'importance' }), 'importance');
  assert.equal(cpPasteTarget(row, { k: 'Order Qty', type: 'int' }), null);
  assert.equal(cpPasteTarget(row, { k: 'Notes', type: 'text' }), null);
  assert.equal(cpPasteTarget({ ...row, Licensor: 'DTR' }, { k: 'Sub-Manufacturer', type: 'submfr' }), null);
  assert.equal(cpPasteTarget({ ...row, _canEdit: false }, { k: 'Supp. FOB', type: 'moneyEdit' }), null);
  assert.equal(cpPasteTarget({ ...row, _canEditShared: false }, { k: 'Supp. FOB', type: 'moneyEdit' }), null);
});

test('CP değerleri ekrandaki/Excel biçiminden normalize edilir, okunamayan değer reddedilir', () => {
  const DELTYPE_OPTS = ['Gemi', 'Uçak', 'Gemi+Uçak', 'Gemi+Tır']; // i18n-ignore
  const cpPasteValue = new Function('parseKeyboardDateToISO', 'DELTYPE_OPTS', 'normalizeTransitDelType', 'window',
    `${extractFunction(APP, 'cpPasteValue')}; return cpPasteValue;`)(
    text => (/^\d{2}\.\d{2}\.\d{2}$/.test(text) ? `20${text.slice(6)}-${text.slice(3, 5)}-${text.slice(0, 2)}` : ''),
    DELTYPE_OPTS,
    text => DELTYPE_OPTS.find(option => option.toLowerCase() === String(text).toLowerCase()) || '',
    { BLOrderImportanceUI: { pasteResolve: text => (text === 'BTS' ? { ok: true, value: 'bts' } : { ok: false }) } },
  );
  assert.deepEqual(cpPasteValue('1,30', 'suppfob'), { ok: true, value: '1.3' });
  assert.deepEqual(cpPasteValue('$ 1.234,50', 'suppfob'), { ok: true, value: '1234.5' });
  assert.deepEqual(cpPasteValue('abc', 'suppfob'), { ok: false });
  assert.deepEqual(cpPasteValue('10.02.27', 'exfactory'), { ok: true, value: '2027-02-10' });
  assert.deepEqual(cpPasteValue('yarın', 'retail'), { ok: false }); // i18n-ignore
  assert.deepEqual(cpPasteValue('Sea+Air', 'deltype'), { ok: true, value: 'Gemi+Uçak' }); // i18n-ignore
  assert.deepEqual(cpPasteValue('Tren', 'deltype'), { ok: false });
  assert.deepEqual(cpPasteValue('BTS', 'importance'), { ok: true, value: 'bts' });
  assert.deepEqual(cpPasteValue('  Le Shark  ', 'submfr'), { ok: true, value: 'Le Shark' });
});

test('yapıştırma tek hücre düzenleme yolundan geçer ve tek geri alma adımıdır', () => {
  const apply = extractFunction(APP, 'applyCpGridPaste');
  assert.match(apply, /commitCpEditor\(\{dataset:\{id:String\(id\),key:op\.column\.k,kind:op\.target,lineKey:lineKeyOfRow\(op\.row\),editOwner:orderLinePeerOwner\(\)\},value:op\.value\},\{refresh:false\}\)/);
  assert.match(apply,/return !current\|\|!sameOrderLine\(current,op\.row\)/);
  assert.match(apply, /_cpPasteUndoBatch=actions/);
  assert.match(apply, /pushUndo\(actions\.length===1\?actions\[0\]:\{kind:'batch',actions\}\)/);
  assert.match(extractFunction(APP, 'pushUndo'), /if\(_cpPasteUndoBatch\)\{ _cpPasteUndoBatch\.push\(action\); return; \}/);
  assert.match(extractFunction(APP, 'applyHistoryAction'), /action\.kind==='batch'[\s\S]*\.reverse\(\)/);
});
