'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'public','collection-status-ui.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

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

test('status pill/dashboard styling is theme-token based and uses status color only as semantic accent',()=>{
  assert.match(CSS,/#kolTable select\.kolStatusNoArrow/);
  assert.match(CSS,/background-color:color-mix\(in srgb,var\(--kol-status-color\) 11%,var\(--card\)\)/);
  assert.match(CSS,/color:var\(--ink\)/);
  assert.match(CSS,/\.ovCollectionStatusCard/);
  assert.match(CSS,/color-mix\(in srgb,var\(--status-color\) 7%,var\(--card\)\)/);
  assert.match(CSS,/#kolTable td\.kolStatusTd/);
  assert.match(CSS,/background-color:color-mix\(in srgb,var\(--kol-status-color\) 18%,var\(--card\)\)/);
  const tdStart=CSS.indexOf('#kolTable td.kolStatusTd{');
  const tdBlock=CSS.slice(tdStart,CSS.indexOf('}',tdStart)+1);
  const selectStart=CSS.indexOf('#kolTable select.kolStatusNoArrow{');
  const selectBlock=CSS.slice(selectStart,CSS.indexOf('}',selectStart)+1);
  assert.doesNotMatch(tdBlock,/box-shadow/,'status cell must not draw a thick left accent line');
  assert.doesNotMatch(selectBlock,/radial-gradient|background-image/,'status select must not draw a leading status dot');
  assert.match(selectBlock,/padding:3px 9px;/,'status text uses symmetric padding after dot removal');
  assert.match(APP,/class="editTd kolStatusTd"\$\{rc\} style="--kol-status-color:/);
});
