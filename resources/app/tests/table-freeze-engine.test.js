'use strict';

// Ortak sütun dondurma motoru (public/table-freeze.js) — üretilen stil sözleşmesi
// ve app-main entegrasyonu. Gerçek tarayıcı doğrulaması:
//   node scripts/table-freeze-ui-acceptance.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ENGINE = read('public/table-freeze.js');
const APP = read('public/app-main.js');

function engine() {
  const window = { CSS: { escape: value => String(value) }, requestAnimationFrame: fn => fn() };
  vm.runInNewContext(ENGINE, { window, document: {} });
  return window.BLTableFreeze;
}

test('her donmuş sütun cumulative ofsetle başlık, gövde ve alt bilgide sabitlenir', () => {
  const css = engine()._buildCss({ id: 'cpTable' }, [0, 46, 166.5], [46, 120.5, 80], false);
  for (const [index, left] of [[1, '0px'], [2, '46px'], [3, '166.5px']]) {
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>thead>tr.colRow>th:nth-child(${index}){position:sticky!important;left:${left}!important;z-index:var(--ui-z-sticky-column)!important}`));
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>tbody>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(${index}){position:sticky!important;left:${left}!important;z-index:var(--ui-z-frozen-cell)!important}`));
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>tfoot>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(${index}){position:sticky!important;left:${left}!important;`));
  }
  assert.doesNotMatch(css, /nth-child\(4\)\{position/, 'yalnız istenen sütunlar donar');
});

test('katman sırası: kayan gövde < donmuş gövde < kayan başlık < donmuş başlık', () => {
  const css = engine()._buildCss({ id: 'kolTable' }, [0, 72], [72, 90], false);
  assert.ok(css.includes('#kolTable[data-bl-freeze]>thead>tr>th{z-index:var(--ui-z-sticky)!important}'),
    'kimlik seçicili `#kolTable thead tr.colRow th{z-index:1}` donmuş başlığın üstüne çıkamaz');
  assert.ok(css.includes('#kolTable[data-bl-freeze]>tfoot>tr{z-index:var(--ui-z-sticky)!important}'));
  assert.ok(css.includes('#kolTable[data-bl-freeze]>thead>tr.groupRow>th.frzL{position:sticky!important;z-index:var(--ui-z-sticky-column)!important}'));
  const tokens = read('public/ui-tokens.css');
  assert.match(tokens, /--ui-z-frozen-cell:20;--ui-z-sticky:30;--ui-z-sticky-column:31;/);
});

test('donmuş zemin opaktır ama seçim/üzerine gelme zeminini ezmez', () => {
  const css = engine()._buildCss({ id: 'ordersTable' }, [0, 40, 90], [40, 50, 60], false);
  assert.ok(css.includes(':where(#ordersTable[data-bl-freeze]>tbody>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(-n+3)){background-color:var(--ui-surface)}'));
  assert.ok(css.includes(':where(#ordersTable[data-bl-freeze]>tfoot>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(-n+3)){background-color:var(--ui-surface-soft)}'));
  assert.doesNotMatch(css, /background-color:[^}]*!important/, 'zemin !important olursa seçim görünmez');
  assert.doesNotMatch(css, /box-shadow/, 'bölme sınırı hücre gölgesi değil ayrı ayırıcı öğedir');
  assert.match(ENGINE, /pane\.className = 'blFreezePane';/);
});

test('ofsetler gerçek başlık genişliğinden ölçülür ve ResizeObserver ile canlı tutulur', () => {
  assert.match(ENGINE, /return cell\.getBoundingClientRect\(\)\.width;/);
  assert.match(ENGINE, /rec\.observer = new global\.ResizeObserver\(function \(\) \{ schedule\(table\); \}\)/);
  assert.match(ENGINE, /\{ box: 'border-box' \}/);
  // Gizli sekmede ölçü 0'dır: eski ofsetler bozulmaz, görünür olunca yeniden yazılır.
  assert.match(ENGINE, /if \(!widths\.every\(function \(w\) \{ return Number\.isFinite\(w\) && w > 0; \}\)\) return;/);
});

test('donmuş sütunlar görünür alanı aşarsa bölme daralır ve iç kaydırma açılır', () => {
  assert.match(ENGINE, /var maxPane = available \? available - MIN_SCROLL_VIEW : acc;/);
  assert.match(ENGINE, /var paneWidth = Math\.round\(Math\.max\(Math\.min\(MIN_PANE, acc\), Math\.min\(wanted, acc, maxPane\)\) \* 100\) \/ 100;/);
  // Yalnız tablo bölme için bile dar kalırsa dondurma askıya alınır.
  assert.match(ENGINE, /rec\.suspended = Boolean\(available && maxPane < Math\.min\(MIN_PANE, acc\)\);/);
  assert.match(APP, /if\(result&&result\.suspended\)\{\s*setFreeze\(pick\.tableKey,previous\);/);
});

test('iç kaydırmada donmuş hücre bölme kaydırmasıyla kayar ve bölme sınırında kırpılır', () => {
  const css = engine()._buildCss({ id: 'cpTable' }, [0, 46, 166], [46, 120, 200], true);
  const rule = '#cpTable[data-bl-freeze]>tbody>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(3){position:sticky!important;'
    + 'left:calc(166px - var(--blfz-s))!important;clip-path:inset(0 max(0px,calc(366px - var(--blfz-s) - var(--blfz-w))) 0 max(0px,calc(var(--blfz-s) - 166px)))!important;'
    + 'z-index:var(--ui-z-frozen-cell)!important}';
  assert.ok(css.includes(rule), 'gövde hücresi');
  assert.ok(css.includes('#cpTable[data-bl-freeze]>thead>tr.colRow>th:nth-child(1){position:sticky!important;left:calc(0px - var(--blfz-s))!important;'));
  // Sağ bölmenin ilk sütunu tam bölme sınırından başlar.
  assert.match(ENGINE, /table\.style\.marginLeft = -\(Math\.round\(\(acc - rec\.paneWidth\) \* 100\) \/ 100\) \+ 'px';/);
  assert.match(ENGINE, /table\.style\.setProperty\('--blfz-s', next \+ 'px'\);/);
});

test('donmuş bölme kendi çubuğu, yatay tekerlek ve sürüklenen sınırla bağımsız kayar', () => {
  assert.match(ENGINE, /bar\.addEventListener\('scroll', function \(\) \{ setScroll\(table, registry\.get\(table\), bar\.scrollLeft, true\); \}/);
  assert.match(ENGINE, /wrap\.addEventListener\('wheel', function \(event\) \{/);
  assert.match(ENGINE, /if \(r\.scroll !== before\) event\.preventDefault\(\);/, 'sınıra gelince tablo kaydırması devralır');
  assert.match(ENGINE, /divider\.addEventListener\('pointerdown', function \(event\) \{ startPaneDrag\(table, event\); \}\);/);
  assert.match(ENGINE, /if \(typeof rec\.onPaneResize === 'function'\) rec\.onPaneResize\(rec\.pane\);/);
  // Bölme genişliği kişisel dondurma tercihidir ve görünüm profilleriyle taşınır.
  assert.match(APP, /function setFreezePane\(tableKey, px\)\{/);
  assert.match(APP, /if\(left\)state\.freeze\[key\]=pane\?\{left,pane\}:\{left\};/);
  assert.match(APP, /\.\.\.\(Number\(data\[t\]\.freeze\.pane\)>0\?\{pane:Math\.round\(Number\(data\[t\]\.freeze\.pane\)\)\}:\{\}\)/);
  // Başlık grup etiketi donmuş bölmenin görünür kısmında ortalanır.
  const tracking = read('public/table-header-tracking.js');
  assert.match(tracking, /data-bl-freeze-pane/);
  assert.match(tracking, /addEventListener\('blfreezepanescroll'/);
});

test('app-main satır satır dondurma işi yapmaz; tek giriş noktası BLTableFreeze', () => {
  for (const legacy of ['freezeColumnWidths', 'freezeLayoutFor', 'applyFreezeToRow', 'applyFreezePlanToRow', 'freezeMoveLaser', 'freezeColumnAtX', 'freezeHighlight'])
    assert.doesNotMatch(APP, new RegExp('\\b' + legacy + '\\('), legacy);
  assert.doesNotMatch(APP, /freezePlan/);
  assert.match(APP, /function setupVirtualizedBody\(tbody, table, rows, buildRow, colCount\)\{/);
  assert.match(APP, /clearFreeze\(tableId,tableKey\)\{freezeCancel\(\);setFreeze\(tableKey,0\);applyFreeze\(tableId,tableKey,true\);/);
});

test('seçim kipi sıralama/sürükleme/filtreyi yutar ve Esc ile kapanır', () => {
  for (const type of ['pointerdown', 'mousedown', 'dragstart', 'click', 'keydown'])
    assert.ok(ENGINE.includes(`document.addEventListener('${type}', `), type);
  assert.match(ENGINE, /if \(pick && event\.key === 'Escape'\) \{ event\.preventDefault\(\); cancelPick\(\); \}/);
  assert.match(ENGINE, /cell\.classList\.toggle\('freezePreview', index != null && i <= index\);/);
});

function picker(){
 const tables={cpTable:{virtual:true},ordersTable:{virtual:true}},calls=[],freeze={},trigger={classList:{toggle(){}},setAttribute(){}};
 const context={appLang:'en',CSS:{escape:x=>x},document:{getElementById:id=>id==='navFreezeBtn'?trigger:tables[id],querySelector:()=>null},
  getFreeze:key=>({left:freeze[key]||0}),setFreeze:(key,n)=>freeze[key]=n,showToast(){},
  activeTableInfo:()=>({tableKey:'cp',tableSel:'#cpTable',rerender:()=>calls.push('render:cp')}),
  flushPendingTableRenders(){calls.push('flush:all');Object.values(tables).forEach(t=>t.virtual=false);},
  window:{BLTableFreeze:{startPick:(table,handlers)=>{calls.push('pick');context.handlers=handlers;},cancelPick:()=>calls.push('cancel'),info:()=>({suspended:false})}},
  applyFreeze:(id,key)=>calls.push('apply:'+key)};
 vm.createContext(context);vm.runInContext(APP.slice(APP.indexOf('let _freezePick ='),APP.indexOf('function freezeStart(){')),context);
 return {context,tables,calls,freeze};
}
test('freeze picker preserves virtual windows and does not flush pending tables',()=>{
 const p=picker();assert.equal(p.context.freezeStartFor('cpTable','cp'),true);
 assert.equal(p.tables.cpTable.virtual,true);assert.equal(p.tables.ordersTable.virtual,true);assert.deepEqual(p.calls,['pick']);
});
test('freeze commit and removal refresh only the selected table',()=>{
 const p=picker();p.context.freezeStartFor('cpTable','cp');p.context.freezeCommitPick(2);
 assert.equal(p.freeze.cp,2);assert.deepEqual(p.calls,['pick','render:cp']);
 p.context.freezeStartFor('cpTable','cp');assert.equal(p.freeze.cp,0);assert.deepEqual(p.calls,['pick','render:cp','render:cp']);
 assert.equal(p.tables.ordersTable.virtual,true);
});
test('cancelling the picker preserves both virtual windows without rendering',()=>{
 const p=picker();p.context.freezeStartFor('cpTable','cp');p.context.freezeCancel();
 assert.deepEqual(p.calls,['pick','cancel']);assert.equal(p.tables.cpTable.virtual,true);assert.equal(p.tables.ordersTable.virtual,true);
});
