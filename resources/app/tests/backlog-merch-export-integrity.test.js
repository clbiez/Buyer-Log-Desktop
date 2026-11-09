'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dates=require('../public/excel-date-utils');
const dimension=require('../public/date-dimension');
const formulas=require('../public/backlog-excel-formulas');
const ExcelJS=require('../public/vendor/exceljs.min.js');
let XLSX;try{XLSX=require('xlsx');}catch(_){}
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const retail='Retail Depo Tarih Yıl Ay Gün',budget='Model Bütçe Tarih Yıl Ay Gün';
const calendar={weeks:[
  {year:2026,week:18,month:4,monthWeek:5,start:'2026-04-27',end:'2026-05-03'},
  {year:2027,week:1,month:1,monthWeek:1,start:'2026-12-28',end:'2027-01-03'},
  {year:2027,week:2,month:1,monthWeek:2,start:'2027-01-04',end:'2027-01-10'},
]};
function source(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert.ok(a>=0&&b>a);return app.slice(a,b);}
function browser(lang='tr'){
  const ctx={Date,Set,Map,Number,String,Object,Array,window:{BLDateDimension:dimension,BLBacklogExcel:formulas},BLBacklogExcel:formulas,XLSX,
    BLOrderImportance:{BACKLOG_HEADER:'ÖNEM ETİKETİ\n(IMPORTANCE)'},appLang:lang,_XLS_BORDERS:{},
    columnSchemaFor:()=>null,coerceDateLoose:dimension.parseDate,backlogExcelFormulaOverrides:()=>({}),
    kolExcelImageMetrics:()=>({colChars:12}),backlogFormulaWithOverride:(_h,s)=>s};
  vm.createContext(ctx);
  vm.runInContext(source('const BACKLOG_CANONICAL_DATE_HEADERS','/* Detay ekranı kompakt açılır'),ctx);
  vm.runInContext(source('function backlogExcelCellFromValue','function forceWorkbookFormulaCalculation'),ctx);
  vm.runInContext(source('function backlogChartBucketFormula','async function exportBacklogToExcel'),ctx);
  return ctx;
}

test('period suffix overrides Gün/Date in full Backlog headers in TR and EN',()=>{
  for(const base of [retail,budget,'Warehouse Arrival Date','ANTREPO GİRİŞ TARİHİ']){
    assert.equal(dates.isDateHeader(base),true,base);
    for(const suffix of ['Ay','Hafta','Month','Week']){
      const h=base+' ('+suffix+')';
      assert.equal(dates.isPeriodOnlyHeader(h),true,h);
      assert.equal(dates.isDateHeader(h),false,h);
    }
  }
});

test('SheetJS write hooks preserve LCW period text and formula caches through XLSX round trip',{skip:!XLSX},()=>{
  dates.installSheetJsHooks(XLSX);
  for(const value of ['January 2027','May 2026','Kasım 2026','Aralık 2026','Week 1 January 2027']){
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([[retail,retail+' (Ay)',retail+' (Hafta)'],['2026-12-28',value,value]]);
    ws.B2.f=formulas.dateDimensionFormula('A2','month','en');
    XLSX.utils.book_append_sheet(wb,ws,'BACKLOG');
    const out=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true});
    assert.equal(out.Sheets.BACKLOG.B2.t,'s');
    assert.equal(out.Sheets.BACKLOG.B2.v,value);
    assert.equal(out.Sheets.BACKLOG.B2.f,ws.B2.f);
    assert.equal(out.Sheets.BACKLOG.C2.v,value);
    assert.equal(out.Sheets.BACKLOG.A2.v,dates.excelSerial('2026-12-28'));
  }
});

test('ExcelJS normalizer preserves period values and formulas in generated reports',async()=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('BACKLOG');
  ws.addRow([retail,retail+' (Ay)',retail+' (Hafta)']);
  ws.addRow(['2026-12-28','January 2027',{formula:formulas.dateDimensionFormula('A2','week','en'),result:'Week 1 January 2027'}]);
  ws.getCell('B2').numFmt=ws.getCell('C2').numFmt='@';
  dates.normalizeExcelJsWorkbookDateColumns(wb);
  assert.equal(ws.getCell('B2').value,'January 2027');
  assert.equal(ws.getCell('C2').numFmt,'@');
  const out=new ExcelJS.Workbook();await out.xlsx.load(await wb.xlsx.writeBuffer());
  assert.equal(out.getWorksheet('BACKLOG').getCell('B2').value,'January 2027');
  assert.equal(out.getWorksheet('BACKLOG').getCell('C2').value.result,'Week 1 January 2027');
});

test('Backlog sheet keeps each date bound to its LCW month/week after column reorder and serialization',{skip:!XLSX},()=>{
  dimension.setMerchCalendar(calendar);
  try{for(const lang of ['tr','en']){
    const ctx=browser(lang),rows=[{[retail]:'2026-12-28',[budget]:'2026-04-27','FOB Fiyatı':null},
      {[retail]:'2027-01-04',[budget]:'2026-05-03','FOB Fiyatı':0},
      {[retail]:'2028-01-01',[budget]:null,'FOB Fiyatı':null}];
    const expanded=ctx.backlogExpandDateDimensions([budget,'FOB Fiyatı',retail],rows);
    const ws=ctx.buildBacklogDetailSheet(expanded.headers,expanded.rows,null,{dateDimensionSources:expanded.derivedHeaderSources,
      chartState:{enabled:true,timeField:retail,metricField:'__records',granularity:'week'}});
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'BACKLOG');
    const out=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true}).Sheets.BACKLOG;
    const value=(h,r=2)=>out[XLSX.utils.encode_col(expanded.headers.indexOf(h))+r];
    assert.equal(value(retail+' (Ay)').v,lang==='tr'?'Ocak 2027':'January 2027');
    assert.equal(value(budget+' (Ay)').v,lang==='tr'?'Nisan 2026':'April 2026');
    assert.equal(value(retail+' (Hafta)',3).v,lang==='tr'?'2. Hafta Ocak 2027':'Week 2 January 2027');
    assert.equal(value(retail).v,dates.excelSerial(rows[0][retail]));
    assert.equal(value(retail+' (Ay)',4)?.v||'','');
    assert.equal(value('FOB Fiyatı')?.v||'','');
    assert.equal(value('FOB Fiyatı',3).v,0);
    assert.equal(rows[0][retail],'2026-12-28','source data must stay unchanged');
  }}finally{dimension.clearMerchCalendar();}
});

test('missing numeric values are blank while real zero stays numeric',{skip:!XLSX},()=>{
  const ctx=browser();
  for(const value of [null,undefined,''])assert.equal(ctx.backlogExcelCellFromValue(value,'number',{}).v,'');
  assert.equal(ctx.backlogExcelCellFromValue(0,'number',{}).v,0);
});

test('changing or removing the Merch Calendar invalidates cached Backlog rows immediately',()=>{
  const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  let fingerprint='calendar-a',computes=0;
  const ctx={Date,Map,WeakMap,JSON,crypto:require('node:crypto'),antrepoForTarget:active=>active.antrepo,
    userAccess:{localIamRevision:()=>1},require:id=>{assert.equal(id,'./lib/merch-calendar-store');return {fingerprint:()=>fingerprint};}};
  vm.createContext(ctx);
  vm.runInContext(server.slice(server.indexOf('const BACKLOG_ROWS_CACHE_MS='),server.indexOf("app.get('/api/backlog-export'")),ctx);
  const active={asasOrders:[],antrepo:{}},profile={id:'demo',accessRevision:1};
  const read=()=>ctx.cachedBacklogTemplateRows(ctx.backlogRowsCacheKey('demo',active,{},profile,[]),()=>({revision:++computes}));
  assert.equal(read().revision,1);assert.equal(read().revision,1);
  fingerprint='calendar-b';assert.equal(read().revision,2);
  fingerprint='calendar-removed';assert.equal(read().revision,3);
});

test('export and analysis consumers apply the server calendar snapshot before deriving periods',()=>{
  const full=source('async function exportBacklogToExcel','let backlogLoadedOnce');
  assert.ok(full.indexOf('BLMerchCalendarRuntime?.apply?.(data.merchCalendar)')<full.indexOf('backlogExpandDateDimensions(exportHeaders'));
  for(const [file,variable] of [['backlog-overview.js','body'],['backlog-chart.js','data']]){
    const text=fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
    assert.ok(text.includes(`BLMerchCalendarRuntime?.apply?.(${variable}.merchCalendar)`),file);
  }
});

test('server XLSX writer preserves blank numeric caches without losing actual zeros',()=>{
  const worker=fs.readFileSync(path.join(__dirname,'../server/workers/excel-worker.js'),'utf8');
  const ctx={BLBacklogExcel:formulas,Date,Number,String,Boolean};vm.createContext(ctx);
  vm.runInContext(worker.slice(worker.indexOf('function backlogCellFromValue'),worker.indexOf('function forceWorkbookFormulaCalculation')),ctx);
  for(const value of [null,undefined,''])assert.equal(ctx.backlogCellFromValue(value,'number').v,'');
  assert.equal(ctx.backlogCellFromValue(0,'number').v,0);
});

test('date header heuristics preserve boolean formula helpers in SheetJS and ExcelJS',{skip:!XLSX},async()=>{
  for(const result of [true,false]){
    const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([['_BL_HANDOVER','HANDOVER Tarihi'],[result,'2026-12-28']]);
    ws.A2.f='1=1';XLSX.utils.book_append_sheet(wb,ws,'BACKLOG');
    const out=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellNF:true});
    assert.equal(out.Sheets.BACKLOG.A2.t,'b');assert.equal(out.Sheets.BACKLOG.A2.v,result);
    assert.notEqual(out.Sheets.BACKLOG.A2.z,dates.DATE_FORMAT);
    assert.equal(out.Sheets.BACKLOG.B2.v,dates.excelSerial('2026-12-28'));
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('BACKLOG');
    sheet.addRow(['_BL_HANDOVER','HANDOVER Tarihi']);sheet.addRow([{formula:'1=1',result},'2026-12-28']);
    dates.normalizeExcelJsWorkbookDateColumns(book);
    assert.notEqual(sheet.getCell('A2').numFmt,dates.DATE_FORMAT);
    const reread=new ExcelJS.Workbook();await reread.xlsx.load(await book.xlsx.writeBuffer());
    assert.equal(reread.getWorksheet('BACKLOG').getCell('A2').result,result);
  }
});

test('explicitly selected Backlog columns stay visible while formula helpers remain hidden',{skip:!XLSX},()=>{
  const ctx=browser(),headers=['Lisans','FOB Fiyatı','ASAS · Demo Extra Column','Sipariş Kod'];
  const rows=[{'Lisans':'DEMO','FOB Fiyatı':4,'ASAS · Demo Extra Column':'EXTRA','Sipariş Kod':'1001'}];
  const selected=ctx.buildBacklogDetailSheet(headers,rows,null,{showSelectedColumns:true});
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,selected,'BACKLOG');
  const out=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',cellStyles:true}).Sheets.BACKLOG;
  headers.forEach((header,index)=>{
    assert.equal(out[XLSX.utils.encode_col(index)+'1'].v,header);
    assert.equal(Boolean(out['!cols'][index].hidden),false,header+' must be visible');
    assert.equal(out['!cols'][index].level||0,0,'selected columns are not collapsed groups');
  });
  assert.ok(out['!cols'].slice(headers.length).every(col=>col.hidden),'formula helpers remain hidden');
  const detail=ctx.buildBacklogDetailSheet(headers,rows,null);
  assert.equal(detail['!cols'][0].hidden,true,'existing detail export keeps its default view');
});
