'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'public','collection-status-ui.js'),'utf8');
const CSS=require('./helpers/manifest-css')();

function fn(marker){
  const start=APP.indexOf(marker);
  assert.ok(start>=0,'missing '+marker);
  const next=APP.indexOf('\nfunction ',start+marker.length);
  return APP.slice(start,next>start?next:APP.length);
}

test('new status persists catalog-only and immediately re-renders Collection',()=>{
  const add=fn('function kolAddStatus(');
  const persist=fn('function kolPersistCatalogOnly(');
  assert.match(add,/KOL_STATUS_API\.normalize/);
  assert.match(add,/kolPersistCatalogOnly\(\)/);
  assert.match(persist,/kolQueueWorkspaceSave\(\)/);
  assert.match(persist,/renderKol\(\)/);
});

test('status color change is structural and does not rewrite Collection business rows',()=>{
  const color=fn('function kolSetStatusColor(');
  assert.match(color,/kolPersistCatalogOnly\(\)/);
  assert.doesNotMatch(color,/saveKolRows\(\)/);
  assert.match(APP,/statusCatalog:kolStatusEntries\(\)/);
});

test('status rename migrates existing string values before saving',()=>{
  const rename=fn('function kolRenameStatus(');
  assert.match(rename,/kolRows\.forEach\(row=>\{if\(KOL_STATUS_API\.key\(row&&row\.durum\)===oldKey\)row\.durum=clean;/,
    'rename must migrate both Turkish and English aliases of the same status');
  assert.match(rename,/saveKolRows\(\)/);
  assert.match(rename,/builtin:false/);
});

test('used status deletion requires a replacement and migrates rows; unused deletion stays catalog-only',()=>{
  const remove=fn('function kolRemoveStatus(');
  assert.match(remove,/const target=entries\.find/);
  assert.match(remove,/Choose a replacement status|Yerine geçecek statusu seç/);
  assert.match(remove,/row\.durum=target\.name/);
  assert.match(remove,/if\(usage\)saveKolRows\(\);else kolPersistCatalogOnly\(\)/);
  assert.match(UI,/runtime\.usage\(name\)/);
  assert.match(UI,/data-replacement/);
});

test('Excel status validation and colors resolve from the canonical catalog',()=>{
  const helper=fn('function kolEnsureExcelStatusList(');
  const validation=fn('function kolStyleValidationFormula(');
  assert.match(helper,/kolStatusEntries\(\)/);
  assert.match(helper,/sheet\.state='veryHidden'/);
  assert.match(helper,/\$A\$1:\$A\$/);
  assert.match(helper,/entries\.length/);
  assert.match(validation,/if\(field\.status\)return statusFormula/);
  assert.match(APP,/statusValidationFormula=kolEnsureExcelStatusList\(wb\)/);
  assert.match(APP,/kolStatusExcelArgb\(cell\.value\)/);
  assert.match(APP,/kolStatusExcelArgb\(raw\)/);
});

test('status badge is theme-token based and uses status color only as a semantic tint and border',()=>{
  assert.match(CSS,/#kolTable select\.kolStatusNoArrow/);
  assert.match(CSS,/\.ovCollectionStatusCard/);
  assert.match(CSS,/color-mix\(in srgb,var\(--ui-series-color\) 7%,var\(--ui-surface\)\)/);
  // Ürün kararı (2026-11): durum hücreyi doldurmaz; açılır liste, Artwork teknik
  // etiketiyle aynı yapıda çerçeveli bir rozettir (açık zemin + kendi renginde kenar).
  const badgeStart=CSS.indexOf('#kolTable td.kolStatusTd select.kolStatusNoArrow{border:');
  assert.ok(badgeStart>=0,'status badge rule');
  const badge=CSS.slice(badgeStart,CSS.indexOf('}',badgeStart)+1);
  assert.match(badge,/border:1px solid color-mix\(in srgb,var\(--kol-status-color\) 45%,var\(--ui-surface\)\)/);
  assert.match(badge,/background-color:color-mix\(in srgb,var\(--kol-status-color\) 12%,var\(--ui-surface\)\)/);
  assert.match(badge,/color:color-mix\(in srgb,var\(--kol-status-color\) 72%,var\(--ui-text\)\)/);
  assert.doesNotMatch(badge,/radial-gradient|background-image|box-shadow/);
  assert.doesNotMatch(CSS,/#kolTable td\.kolStatusTd\{background-color/,'status cell must not flood the whole cell');
  const layout=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
  assert.match(layout,/#kolTable td\.kolStatusTd select\.kolStatusNoArrow\{padding:0 7px;width:auto;max-width:100%;[^}]*text-overflow:ellipsis/);
  assert.match(APP,/class="editTd kolStatusTd"\$\{rc\} style="--kol-status-color:/);
});
