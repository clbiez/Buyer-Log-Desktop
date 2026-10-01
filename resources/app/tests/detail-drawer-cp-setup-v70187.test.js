'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const DRAWER=fs.readFileSync(path.join(ROOT,'public','detail-drawer.js'),'utf8');
const FLOW=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','detail-drawer.css'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('CP tablo setupi alt detaylar icin read-only snapshot olarak paylasilir',()=>{
  assert.match(APP,/window\.BLTableViewSetup=Object\.freeze/);
  assert.match(APP,/function tableViewReadonlySnapshot\(tableKey='cp'\)/);
  assert.match(APP,/presets:\{focus:presetKeys\('focus'\),extended:presetKeys\('extended'\),all:presetKeys\('all'\)\}/);
  assert.match(APP,/widthPx=colWidthPx\(tableKey,meta\)/);
  assert.match(APP,/return cellPlainText\(meta,row,null\)/);
});

test('ortak alt detay Focus Extended All ve CP sutun sirasini tuketir',()=>{
  assert.match(DRAWER,/function referenceSetupFor\(input\)/);
  assert.match(DRAWER,/function applyReferencePreset\(preset\)/);
  assert.match(DRAWER,/data-bl-detail-preset=/);
  assert.match(DRAWER,/referencePresetHtml\(\)/);
  assert.match(DRAWER,/snapshot\?\.\(active\.referenceTable\)/);
  assert.match(DRAWER,/referenceColgroup\(table,columns,showImages\)/);
  assert.match(DRAWER,/blDetailGroupRow groupRow/);
});

test('Global Flow alt detayi CP setupiyle acilir ve parsiyel lojistik bilgisini korur',()=>{
  assert.match(FLOW,/function cpDetailRow\(rec\)/);
  assert.match(FLOW,/referenceTable:'cp',referenceRow:cpDetailRow/);
  assert.match(FLOW,/put\('STATUS',rec&&rec\.status,\{force:true\}\)/);
  assert.match(FLOW,/row\['Shipment Quantity'\]=Number\(rec\.qty\)/);
});

test('CP referansli detay tablosu grup basligi ve preset stillerini tasir',()=>{
  assert.match(CSS,/\.blDetailPresetGroup\{/);
  assert.match(CSS,/\.blDetailTable\.hasReferenceSetup \.blDetailGroupRow th\{/);
  assert.match(CSS,/\.blDetailTable\.hasReferenceSetup \.blDetailColumnHead th\{top:24px/);
});

test('degisen detay varliklarinin cache revleri arttirilmistir',()=>{
  assert.match(INDEX,/detail-drawer\.css\?v=__BL_ASSET_VERSION__&rev=4/);
  assert.match(INDEX,/detail-drawer\.js\?v=__BL_ASSET_VERSION__&rev=5/);
  assert.match(INDEX,/overview-global-flow\.js\?v=__BL_ASSET_VERSION__&rev=6/);
});
