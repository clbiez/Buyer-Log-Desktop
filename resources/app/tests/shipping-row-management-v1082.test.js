'use strict';

/* v10.82 — NAKLİYE KIYASLAMA: SATIR YÖNETİMİ.
 *
 * Kart listesine kalıcı sıralama (sürükle-bırak), gizleme/geri getirme ve
 * sağ tık menüsü (Düzenle/Gizle/Kopyala) eklendi. Gizleme SİLME DEĞİLDİR:
 * satır sunucuda ve shipRows içinde kalır, yalnız kart tablosunda görünmez.
 * Sıra ve gizli küme _shipId ile BLStorage'da tutulur, yeniden çizim ve
 * yeniden yüklemede hayatta kalır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css']);
// Manifest appearance lives in the shared contract; module CSS retains layout.
const VISUAL=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] ).replace(/html\[data-ui-system="manifest"\] /g,'').replace(/\s*\{\s*/g,'{');
const HTML = read('public/index.html');
const ROWMENU = read('public/row-context-menu.js');

const fn = name => {
  const match = APP.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} bulunmalı`);
  return match[0];
};

test('sıra ve gizli küme kalıcı: BLStorage anahtarları tanımlı', () => {
  assert.match(APP, /const SHIP_ROW_ORDER_KEY='buyerlog\.shipCompare\.order\.v1';/);
  assert.match(APP, /const SHIP_ROW_HIDDEN_KEY='buyerlog\.shipCompare\.hidden\.v1';/);
  assert.match(APP, /BLStorage\.setItem\(SHIP_ROW_ORDER_KEY,JSON\.stringify\(shipRowOrder\)\);/);
  assert.match(APP, /BLStorage\.setItem\(SHIP_ROW_HIDDEN_KEY,JSON\.stringify\(\[\.\.\.shipRowHidden\]\)\);/);
});

test('gizleme silme değildir: shipRows değişmez, yalnız görünürlük filtrelenir', () => {
  const ordered = fn('shipOrderedRows');
  assert.match(ordered, /shipRows\.map\(row=>\[String\(row\._shipId\),row\]\)/);
  const hideFn = fn('setShipRowHidden');
  assert.ok(!hideFn.includes('shipRows.splice') && !hideFn.includes('shipRows='), 'setShipRowHidden shipRows dizisini değiştirmemeli');
  const visible = fn('shipVisibleRows');
  assert.match(visible, /shipOrderedRows\(\)\.filter\(row=>!shipRowHidden\.has/);
  const hidden = fn('shipHiddenRows');
  assert.match(hidden, /shipOrderedRows\(\)\.filter\(row=>shipRowHidden\.has/);
});

test('yeni satırlar kayıtlı sıranın sonuna eklenir, gizli satırların konumu korunur', () => {
  const ordered = fn('shipOrderedRows');
  assert.match(ordered, /byId\.forEach\(row=>ordered\.push\(row\)\);/);
  const move = fn('shipMoveRow');
  assert.match(move, /const order=shipOrderedRows\(\)\.map\(row=>String\(row\._shipId\)\);/);
  assert.match(move, /shipRowOrder=order;/);
  assert.match(move, /saveShipRowOrder\(\);/);
});

test('kartlar tablosu yalnız görünür satırları çizer', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /const visibleRows=shipVisibleRows\(\);/);
  assert.match(render, /visibleRows\.map\(row=>`<tr class="shipRowCards" data-shipid="/);
});

test('sürükleme yalnız satırın kendisinden başlar; giriş/düğme/etiket üzerinden başlamaz', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /rowEl\.addEventListener\('dragstart',event=>\{/);
  assert.match(render, /if\(event\.target\.closest\('input,button,select,textarea,label'\)\)\{ event\.preventDefault\(\); return; \}/);
  assert.match(render, /draggable="true"/);
});

test('bırakma satırı hedefin önüne/arkasına taşır ve kalıcı olarak kaydeder', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /rowEl\.addEventListener\('drop',event=>\{/);
  assert.match(render, /shipMoveRow\(draggedId,rowEl\.dataset\.shipid,after\);/);
});

test('sağ tık menüsü Düzenle/Gizle/Kopyala sunar ve mevcut menü kabuğunu yeniden kullanır', () => {
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /rowEl\.addEventListener\('contextmenu',event=>\{/);
  assert.match(render, /window\.BLRowMenu\.render\(\[/);
  assert.match(render, /run:\(\)=>shipEnterRowEditMode\(shipId\)/);
  assert.match(render, /run:\(\)=>shipHideRow\(shipId\)/);
  assert.match(render, /run:\(\)=>void shipCopyRowsForIds\(\[shipId\]\)/);
  // İkinci bir popover bileşeni kurulmadı: row-context-menu.js'in render/close'u dışa açıldı.
  assert.match(ROWMENU, /window\.BLRowMenu = \{ close, render, toolEntries, columnKeyOfCell, MODEL_COLUMN_KEYS, TABLES \};/);
});

test('sağ tık Düzenle mevcut düzenleme yolunu açar, yeni bir mekanizma kurmaz', () => {
  const editMode = fn('shipEnterRowEditMode');
  assert.match(editMode, /classList\.add\('isEditingPrice'\)/);
  assert.match(editMode, /classList\.add\('isEditingExFac'\)/);
  assert.match(editMode, /\.shipCardInput:not\(:disabled\)/);
});

test('sağ tık Kopyala mevcut kopyalama akışını (shipCopyRows → copyShipComparison) yeniden kullanır', () => {
  const copyForIds = fn('shipCopyRowsForIds');
  assert.match(copyForIds, /await copyShipComparison\(\);/);
  // Kullanıcının asıl seçimi bozulmamalı: önce/sonra geri yüklenir.
  assert.match(copyForIds, /const prevSelected=shipSelected;/);
  assert.match(copyForIds, /shipSelected=prevSelected; syncShipSelectionUi\(\);/);
});

test('gizle: seçimden de düşer ve kullanıcıya geri getirme yolu hatırlatılır', () => {
  const hide = fn('shipHideRow');
  assert.match(hide, /setShipRowHidden\(shipId,true\);/);
  assert.match(hide, /shipSelected\.delete\(String\(shipId\)\);/);
  assert.match(hide, /renderShipDecision\(\);/);
});

test('gizlenenler paneli: tek tek ve topluca geri getirme', () => {
  const panel = fn('renderShipHiddenRowsPanel');
  assert.match(panel, /data-ship-restore="/);
  assert.match(panel, /shipShowRow\(btn\.dataset\.shipRestore\);/);
  assert.match(panel, /id="shipRestoreAllBtn"/);
  assert.match(panel, /shipHiddenRows\(\)\.forEach\(row=>setShipRowHidden\(row\._shipId,false\)\);/);
  assert.ok(HTML.includes('id="shipHiddenRowsBtn"'));
  assert.ok(HTML.includes('id="shipHiddenRowsPanel"'));
  assert.match(APP, /toggleColumnPanel\(panel, \(\)=>renderShipHiddenRowsPanel\(panel\), e\.currentTarget\);/);
  // Mevcut sütun paneli dışarı-tıklama/kapatma altyapısına dahil edildi.
  assert.match(APP, /#navColPanel,#shipColPanel,#shipHiddenRowsPanel/);
  assert.match(APP, /#navColsBtn,#shipColsBtn,#shipHiddenRowsBtn/);
});

test('gizli satır sayısı rozeti güncelleniyor', () => {
  const update = fn('updateShipHiddenRowsUi');
  assert.match(update, /shipHiddenRows\(\)\.length/);
  const render = APP.slice(APP.indexOf('function renderShipDecision()'), APP.indexOf('function renderShipTable()'));
  assert.match(render, /updateShipHiddenRowsUi\(\);/);
});

test('sürükleme görsel geri bildirimi tema değişkenleriyle tanımlı', () => {
  assert.match(CSS, /\.shipRowCards\.isDragging\{opacity:\.4;\}/);
  assert.match(VISUAL, /\.shipRowCards\.isDragOver\{/);
});
