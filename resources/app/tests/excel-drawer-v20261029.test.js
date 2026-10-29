'use strict';
// CP ve Koleksiyon'da Excel üreten/alan işlemler Araçlar'dan tek "Excel" çekmecesine taşındı.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
const HTML=read('index.html'),APP=read('app-main.js'),CHECKLIST=read('checklist-supplier-sync.js'),ROWMENU=read('row-context-menu.js'),CLEANUP=read('table-toolbar-action-cleanup.js');
const block=(id,next)=>HTML.slice(HTML.indexOf(`id="${id}"`),HTML.indexOf(`id="${next}"`));

test('CP Excel çekmecesi oluşturma ve içe aktarma işlemlerini iki bölümde toplar',()=>{
  const excel=block('cpExcelMenu','cpPlmSyncWrap');
  for(const id of ['cpCapacityRequestBtn','cpHologramRequestBtn','cpExcelImportBtn','cpExcelTemplatesBtn'])assert.match(excel,new RegExp(`id="${id}"`));
  assert.match(excel,/data-excel-table-slot[\s\S]*blExcelManageDivider[\s\S]*cpExcelImportBtn/);
  const tools=block('cpToolsMenu','cpMoreWrap');
  for(const id of ['cpCapacityRequestBtn','cpHologramRequestBtn','cpExcelImportBtn','cpExcelTemplatesBtn'])assert.doesNotMatch(tools,new RegExp(`id="${id}"`));
  assert.match(tools,/id="cpEndeksmatikBtn"/);
});

test('Koleksiyon Excel çekmecesi tablo, Capacity Request ve MB Listesi Excel işlemlerini içerir',()=>{
  const excel=block('kolExcelMenu','kolPlmSyncWrap');
  for(const id of ['kolExportImgBtn','kolCapacityRequestBtn','kolMbExportBtn','kolExcelImportBtn','kolExcelTemplatesBtn'])assert.match(excel,new RegExp(`id="${id}"`));
  for(const id of ['kolExportImgBtn','kolCapacityRequestBtn','kolMbExportBtn','kolExcelImportBtn','kolExcelTemplatesBtn'])assert.equal((HTML.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id+' tek olmalı');
  assert.doesNotMatch(block('kolTableActions','kolExcelWrap'),/id="kolExportImgBtn"/);
});

test('Çekmece tetikleyicisi TR/EN etiketli, erişilebilir ve ortak menü açma akışına bağlı',()=>{
  for(const p of ['cp','kol']){
    assert.match(HTML,new RegExp(`id="${p}ExcelBtn"[^>]*data-i18n-title-en="Create, import and template Excel workbooks"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"[^>]*aria-controls="${p}ExcelMenu"`));
    assert.match(APP,new RegExp(`\\['${p}ExcelBtn','${p}ExcelMenu'\\]`));
  }
  assert.match(HTML,/data-i18n-tr="Excel oluştur" data-i18n-en="Create Excel"/);
  assert.match(HTML,/data-i18n-tr="İçe aktar ve şablonlar" data-i18n-en="Import and templates"/);
  assert.match(APP,/item\.getAttribute\('aria-haspopup'\)==='true'\)return;/);
});

test('CP tablo dışa aktarımı çekmecenin ilk işlemi; diğer sekmelerde evine döner',()=>{
  assert.match(APP,/appendSharedTableActions\('cpTableActions',\['undoBtn','redoBtn','navCopy','navCopyMenuBtn','gridSelectionStatus'\]\)/);
  assert.match(APP,/#cpExcelMenu \[data-excel-table-slot\]/);
  assert.match(APP,/\['navExcelBtn'\]\.forEach\(id=>\{const node=document\.getElementById\(id\);if\(node\)homeEnd\.before\(node\);\}\)/);
  assert.match(CLEANUP,/if \(button\.closest\('\.toolbarMoreMenu'\)\) \{\s*button\.classList\.remove\('tableActionIconOnly'\);/);
});

test('Checklist alt menüsü Excel oluştur bölümüne, sağ tık menüsü Excel işlemlerine erişir',()=>{
  assert.match(CHECKLIST,/getElementById\('cpExcelMenu'\) \|\| root\.document\.getElementById\('cpToolsMenu'\)/);
  assert.match(CHECKLIST,/menu\.insertBefore\(wrap, menu\.querySelector\('\.blExcelManageDivider'\)\)/);
  assert.match(ROWMENU,/tools: 'cpToolsMenu', excel: 'cpExcelMenu'/);
  assert.match(ROWMENU,/tools: 'kolToolsMenu', excel: 'kolExcelMenu'/);
  assert.match(ROWMENU,/\[\.\.\.toolEntries\(config\.tools\), \.\.\.toolEntries\(config\.excel\)\]/);
});
