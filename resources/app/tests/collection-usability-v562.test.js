'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(root,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(root,'public','app.css'),'utf8');
const INDEX=fs.readFileSync(path.join(root,'public','index.html'),'utf8');

test('v5.62 Collection cells are vertically centered and use consistent typography with requested exceptions',()=>{
  assert.match(CSS,/#kolTable tbody td\{vertical-align:middle!important;font-size:var\(--kol-cell-fs\);\}/);
  assert.match(CSS,/td:not\(\.endeksmatikTd\).*font-size:var\(--kol-cell-fs\)!important/);
  assert.match(CSS,/\.kolLandedMeta[\s\S]*font-size:var\(--fs-2xs\)!important/);
});

test('v5.62 truncated Collection text gets a hover preview',()=>{
  assert.match(APP,/function kolOverflowPreviewValue\(td\)/);
  assert.match(APP,/\.scrollWidth>probe\.clientWidth/);
  assert.match(APP,/className='kolTextPreviewPopup'/);
  assert.match(CSS,/\.kolTextPreviewPopup\{/);
});

test('v5.62 Collection image right click bypasses right-drag and opens CP-style confirmation',()=>{
  assert.match(INDEX,/img\.kolThumb\[data-has-image="1"\],img\.cpThumb\[data-has-image="1"\]/);
  assert.match(APP,/img\.addEventListener\('contextmenu'/);
  assert.match(APP,/openImageDeleteConfirm\(img,\{message:appLang==='en'\?'Remove this Collection image\?'/);
});

test('v5.62 Landed cards match Endeksmatik height and Overseas advantage is plain leftmost text',()=>{
  assert.match(CSS,/\.kolLandedCard\{[\s\S]*min-height:38px/);
  assert.match(CSS,/\.kolProfit\{[\s\S]*background:transparent/);
  // v5.79: hücreye kopyalama verisi iliştirildi (${kolLandedCopyAttrs(...)}), bu yüzden
  // blok artık tam metin yerine <td class="kolLandedTd" ile başlayarak aranır.
  const ydStart=APP.indexOf("}else if(c.ydLanded)");
  const blockStart=APP.indexOf('html+=`<td class="kolLandedTd$',ydStart);
  assert.ok(blockStart>ydStart,'Overseas Landed hücresi bulunmalı');
  const block=APP.slice(blockStart, APP.indexOf('</div></td>`;',blockStart)+20);
  assert.ok(block.indexOf('kolProfit') < block.indexOf('kolLandedVal'),'profit must be before the main Overseas Landed price');
});

test('v5.62 Endeksmatik money is Excel-like rounded to exactly two decimals',()=>{
  assert.match(APP,/function endeksmatikRound2Excel\(value\)/);
  assert.match(APP,/Math\.round\(\(abs\+Number\.EPSILON\)\*100\)\/100/);
  assert.match(APP,/minimumFractionDigits:2,maximumFractionDigits:2/);
});

test('v5.62 multi-line Notes paste stays in the same textarea',()=>{
  assert.match(APP,/editor\.dataset\.k==='not'&&editor\.tagName==='TEXTAREA'&&!\/\\t\/\.test\(text\)/);
  assert.match(APP,/ALT\+ENTER/);
});

test('v5.62 transient menus are mutually exclusive and text size cycles 0..3 under Theme',()=>{
  assert.match(APP,/function closeOtherToolbarAndColumnPopups\(target\)/);
  assert.match(APP,/document\.querySelectorAll\('\.toolbarMoreMenu:not\(\[hidden\]\)'\)/);
  /* v7.81: "Kaynak veri" kenar düğmesi KALDIRILDI — açtığı çekmece boşaldı.
     Korunan karar aynı: yazı boyutu düğmesi Tema'nın ALTINDA kalmalı, ikisi
     de kenar çubuğunun alt bloğunda ve aynı sırada. */
  assert.match(INDEX,/id="railThemeBtn"[\s\S]*id="railFontSizeBtn"/);
  assert.doesNotMatch(INDEX,/id="railSourceBtn"/);
  assert.match(APP,/function cycleUiFontStep\(\)/);
  assert.match(APP,/\(cur\+1\)%4/);
  assert.match(INDEX,/lcw_font_step/);
  assert.match(CSS,/html\[data-font-step="3"\]\{--ui-font-add:3px;\}/);
});
