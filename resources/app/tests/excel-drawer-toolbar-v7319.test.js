'use strict';
// 7.0.319: every Excel task in CP / Orders / Collection lives in one "Excel" drawer.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
const html=read('index.html'),app=read('app-main.js');
function menuBody(id){
  const start=html.indexOf(`id="${id}"`);assert.notEqual(start,-1,`missing ${id}`);
  const open=html.lastIndexOf('<div',start),end=html.indexOf('\n          </div>',start);
  return html.slice(open,end);
}
const EXCEL={
  cp:['cpCapacityRequestBtn','cpHologramRequestBtn','cpExcelImportBtn','cpExcelTemplatesBtn','data-excel-slot="table"','data-excel-slot="checklist"'],
  orders:['ordersExcelTemplatesBtn','data-excel-slot="table"'],
  kol:['kolExportImgBtn','kolMbExportBtn','kolCapacityRequestBtn','kolExcelImportBtn','kolExcelTemplatesBtn','kolPricingExcelColsBtn'],
};
test('each table page has one labelled Excel drawer holding its Excel actions',()=>{
  for(const [pfx,items] of Object.entries(EXCEL)){
    assert.equal((html.match(new RegExp(`id="${pfx}ExcelBtn"`,'g'))||[]).length,1);
    assert.match(html,new RegExp(`id="${pfx}ExcelBtn"[^>]*aria-haspopup="true"[^>]*aria-controls="${pfx}ExcelMenu"`));
    assert.match(html,new RegExp(`id="${pfx}ExcelBtn"[^\\n]*data-i18n-en="Excel">Excel</span><svg class="ic toolbarMenuChevron"`));
    const body=menuBody(`${pfx}ExcelMenu`);
    for(const item of items)assert.ok(body.includes(item.includes('=')?item:`id="${item}"`),`${item} should be in ${pfx}ExcelMenu`);
    const tools=menuBody(`${pfx}ToolsMenu`);
    for(const item of items.filter(i=>!i.includes('=')))assert.ok(!tools.includes(`id="${item}"`),`${item} must leave ${pfx}ToolsMenu`);
  }
});
test('every moved control keeps a single id (listeners bound by id stay valid)',()=>{
  for(const id of Object.values(EXCEL).flat().filter(i=>!i.includes('=')))assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);
});
test('the shared table export moves into the active Excel drawer instead of the icon row',()=>{
  assert.doesNotMatch(app,/appendSharedTableActions\('(?:cp|orders)TableActions',\[[^\]]*'navExcelBtn'/);
  assert.match(app,/function placeExcelExportAction\(tab\)/);
  assert.match(app,/placeExcelExportAction\('cp'\)/);assert.match(app,/placeExcelExportAction\('orders'\)/);
  for(const pfx of ['cp','orders','kol'])assert.match(app,new RegExp(`\\['${pfx}ExcelBtn','${pfx}ExcelMenu'\\]`));
  assert.match(app,/\['cpExcelTemplatesBtn','ordersExcelTemplatesBtn','kolExcelTemplatesBtn'\]/);
  assert.doesNotMatch(read('table-toolbar-action-cleanup.js'),/'navExcelBtn',|'kolExportImgBtn',/);
});
test('row context menu lists Tools and Excel drawers; checklist renders inside the CP Excel drawer',()=>{
  const ctx=read('row-context-menu.js');
  for(const pfx of ['cp','orders','kol'])assert.match(ctx,new RegExp(`tools: '${pfx}ToolsMenu,${pfx}ExcelMenu'`));
  assert.match(ctx,/split\(','\)/);
  assert.match(read('checklist-supplier-sync.js'),/#cpExcelMenu \[data-excel-slot="checklist"\]/);
});
test('drawer items are flat rows; a chosen action closes the drawer; open triggers suppress tooltips',()=>{
  const css=read('ui-components.css');
  assert.match(css,/\.toolbarMoreMenu :is\(\.navActionBtn,button\.tbtn,label\.tbtn,\.vfMenuTrigger\)\{\s*box-shadow:none!important;border:0!important/);
  assert.match(app,/\['cpExcelMenu','ordersExcelMenu','kolExcelMenu','cpToolsMenu','ordersToolsMenu','kolToolsMenu'\]\.forEach/);
  assert.match(read('ui-tooltip.js'),/getAttribute\('aria-expanded'\)==='true'\)return/);
});
