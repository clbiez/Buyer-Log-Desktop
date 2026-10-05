'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,'public',file),'utf8');
const DRAWER=read('detail-drawer.js');
const CSS=read('detail-drawer.css');
const APP=read('app-main.js');
const ANALYSIS=read('backlog-delivery-analysis.js');

test('alt detay tablosu Backlog rapor başlıkları ve alan filtrelerini kullanır',()=>{
  assert.ok(DRAWER.includes('blDetailReportHeading'));
  assert.ok(DRAWER.includes('reportColumns()'));
  assert.ok(DRAWER.includes('reportCell(col,row)'));
  assert.ok(DRAWER.includes('blDetailReportFilter'));
  assert.ok(DRAWER.includes('data-bl-detail-filter='));
  assert.ok(CSS.includes('background:var(--thead-bg)'));
  assert.ok(CSS.includes('color:var(--thead-ink)'));
  assert.ok(CSS.includes('padding:var(--table-cell-pad-y) 10px'));
  assert.ok(CSS.includes('background:var(--table-hover)'));
});

test('uzun sütun başlığı kelime sınırında alt satıra sarılır, sütunu genişletmez',()=>{
  assert.match(CSS,/\.blDetailTable thead th\{[^}]*white-space:normal/);
  assert.match(CSS,/\.blDetailTable thead th \.thLabel\{[^}]*white-space:normal[^}]*word-break:normal/);
  assert.match(CSS,/\.blDetailTable\{[^}]*table-layout:fixed/);
});

test('sütun genişliği sürüklenir, kalıcıdır ve Sütunları Sığdır ile ayarlanır',()=>{
  assert.ok(DRAWER.includes('data-bl-detail-col-resize'));
  assert.ok(DRAWER.includes('function bindColumnResize(table)'));
  assert.ok(DRAWER.includes('saveColWidths()'));
  assert.ok(DRAWER.includes('data-bl-detail-fit'));
  assert.ok(DRAWER.includes("L('Sütunları Sığdır','Fit Column Width')"));
  assert.ok(DRAWER.includes('function fitAllColumns()'));
});

test('sütun filtresi ortak değer filtresi panelini kullanır ve satırları süzer',()=>{
  assert.ok(DRAWER.includes('root.openValueFilterPanel'));
  assert.ok(DRAWER.includes('rowPassesFilters(row)'));
  assert.ok(DRAWER.includes('data-bl-detail-clear-filters'));
});

test('Backlog alt detayları Odak · Genişletilmiş · Tümü görünümünü alır',()=>{
  assert.ok(DRAWER.includes('normalizeViewPresets(input,columns)'));
  assert.ok(DRAWER.includes('active.tableSetup||active.viewPresets'));
  assert.ok(APP.includes('window.BLBacklogDetailViewPresets=backlogDetailViewPresets'));
  assert.equal((APP.match(/viewPresets:backlogDetailViewPresets\(sharedHeaders\)/g)||[]).length,2);
  assert.ok(ANALYSIS.includes('window.BLBacklogDetailViewPresets(headers)'));
});

test('kayıtlı görünüm presetleri temizlenmiş sütun anahtarlarıyla eşleşir',()=>{
  const drawer=require('../public/detail-drawer.js');
  const cols=drawer.normalizeColumns(['GÜNCEL DURUM\n(STATUS)','Adet']);
  assert.deepEqual(cols.map(c=>c.key),['GÜNCEL DURUM (STATUS)','Adet']);
});
