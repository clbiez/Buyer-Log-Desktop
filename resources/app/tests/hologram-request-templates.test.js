'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ExcelJS=require('../public/vendor/exceljs.min.js'),JSZip=require('../public/vendor/jszip.min.js'),XLSX=require('xlsx');
const fields=require('../public/canonical-fields.js'),dates=require('../public/excel-date-utils.js'),H=require('../public/hologram-request-export.js'),templates=require('../public/excel-template-engine.js');
const file=fs.readFileSync(path.join(__dirname,'../public/excel-templates/hologram-request.xlsx'));
const today=new Date(2026,9,19);
const row={_id:'one','Order Code':'000123','PLM ID':'123','Model Name':'DEMO < Tee','C.Code':'01','Order Quantity':4000,Category:'wrong category','Product Main Definition':'KNIT','Buyer':'Demo Buyer',License:'Demo license',MMYG:'Demo MMYG','Buying Group':'Demo Group','Special Code':'0007','Ex-factory':'2026-11-20'};
test('hologram quantity includes the full order plus 3%, rounded up to a multiple of 50',()=>{
  for(const [q,expected] of [[1,50],[1000,1050],[4000,4150],[5000,5150],[10000,10300],[10001,10350],['5.000',5150],['4,000',4150]])assert.equal(H.quantity(q),expected);
  for(const q of ['',null,undefined,'bad',0,-10,4.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>H.quantity(q),/INVALID_ORDER_QUANTITY/);
  assert.throws(()=>H.buildExport([row,{'Order Quantity':''}]),/INVALID_ORDER_QUANTITY/);
});
test('template quantity rules can change both multiplier and upward rounding',()=>{
  assert.deepEqual(H.normalizeQuantityRule(),{multiplier:1.03,roundTo:50});
  assert.deepEqual(H.template().quantityRule,{multiplier:1.03,roundTo:50});
  assert.equal(H.quantity(1000,{multiplier:1.03,roundTo:1}),1030);
  assert.equal(H.quantity(4000,{multiplier:1.01,roundTo:25}),4050);
  assert.equal(H.quantity(1000,{multiplier:1.1,roundTo:25}),1100);
  assert.equal(H.buildExport([row],{today,quantityRule:{multiplier:1.01,roundTo:25}}).rows[0].hologramQuantity,4050);
  for(const rule of [{multiplier:0,roundTo:50},{multiplier:-1,roundTo:50},{multiplier:101,roundTo:50},{multiplier:1.03,roundTo:0},{multiplier:1.03,roundTo:2.5},{multiplier:'bad',roundTo:50}])
    assert.throws(()=>H.quantity(1000,rule),/INVALID_HOLOGRAM_RULE/);
});
test('canonical mapping uses Product Main Definition, not Category, and creation day',()=>{
  const mapped=H.buildExport([row],{today}).rows[0];
  assert.equal(mapped.productMainDefinition,'KNIT');assert.equal(mapped.orderCode,'000123');assert.equal(mapped.specialCode,'0007');assert.equal(mapped.hologramQuantity,4150);
  assert.equal(mapped.today.getTime(),today.getTime());assert.equal(mapped.exFactory.getFullYear(),2026);assert.equal(mapped.exFactory.getMonth(),10);assert.equal(mapped.buyer,'Demo Buyer');
  assert.equal(fields.value({'Ürün Ana Tanım':'JERSEY'},'cp','productMainDefinition'),'JERSEY');
});
test('real uploaded workbook preserves title, merges, widths, page settings and every unrelated ZIP part',async()=>{
  const data=H.buildExport([row,{...row,'Order Code':'000124','Order Quantity':5000}],{today});
  const output=await templates.fill(file,H.template(),data.rows,JSZip,dates);
  const before=await JSZip.loadAsync(file),after=await JSZip.loadAsync(output);
  for(const name of Object.keys(before.files))if(!before.files[name].dir&&name!=='xl/worksheets/sheet1.xml'&&name!=='xl/styles.xml')assert.deepEqual(await after.file(name).async('uint8array'),await before.file(name).async('uint8array'),name);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(output);const ws=wb.getWorksheet('Hologram Talep');
  assert.equal(ws.getCell('C2').text,'HOLOGRAM TALEBİ');assert.deepEqual(ws.getRow(4).values.slice(1),H.HEADERS);assert.equal(ws.getRow(4).height,38.45);
  assert.equal(ws.getCell('G5').value,4150);assert.equal(ws.getCell('G6').value,5150);assert.equal(ws.getCell('E5').text,'KNIT');assert.equal(ws.getCell('H5').text,'000123');assert.equal(ws.getCell('I5').text,'DEMO < Tee');assert.equal(ws.getCell('J5').text,'0007');
  assert.ok(ws.model.merges.includes('C2:I2'));assert.equal(ws.getColumn(1).width,17);assert.equal(ws.getColumn(11).width,22.28515625);
  const original=new ExcelJS.Workbook();await original.xlsx.load(file);assert.deepEqual(ws.pageSetup,original.worksheets[0].pageSetup);assert.deepEqual(ws.getCell('A5').style,original.worksheets[0].getCell('A5').style);
  const read=XLSX.read(output,{type:'array'}).Sheets['Hologram Talep'];assert.equal(read.A5.v,dates.excelSerial(today));assert.equal(read.K5.v,dates.excelSerial(new Date(2026,10,20)));
});
test('revisions move/add/remove columns, clear stale examples and preserve other sheets',async()=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Revised');ws.addRow(['Requester','Extra code','Date']);ws.addRow(['STALE','STALE','STALE']);ws.addRow(['OLD','OLD','OLD']);wb.addWorksheet('Instructions').getCell('A1').value='KEEP';ws.getCell('A2').font={bold:true};
  const config={sheetName:'Revised',headerRow:1,dataRow:2,columns:[{column:1,header:'Requester',field:'buyer'},{column:2,header:'Extra code',field:'specialCode'},{column:3,header:'Date',field:'today'}]};
  const output=await templates.fill(await wb.xlsx.writeBuffer(),config,[{buyer:'=SUM(A1)',specialCode:'001',today}],JSZip,dates),read=new ExcelJS.Workbook();await read.xlsx.load(output);
  const s=read.getWorksheet('Revised');assert.equal(s.getCell('A2').value,'=SUM(A1)');assert.equal(s.getCell('B2').value,'001');assert.equal(s.getCell('A3').text,'');assert.equal(s.getCell('A2').font.bold,true);assert.equal(read.getWorksheet('Instructions').getCell('A1').text,'KEEP');assert.notEqual(s.getCell('C2').numFmt,'General');
  assert.throws(()=>templates.validate({...config,dataRow:1}),/INVALID_TEMPLATE/);assert.throws(()=>templates.validate({...config,columns:[{column:1,field:''}]}),/EMPTY_MAPPING/);
});
test('successful creation downloads before changing checklist; failed serialization never changes answers',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');const code=source.slice(source.indexOf('async function createHologramRequestExcel('),source.indexOf("document.getElementById('cpHologramRequestBtn')?.addEventListener"));
  const events=[],root={BLHologramRequest:H,BLPerf:{ensureFeature:async()=>{}},BLChecklistSupplierSync:{loadShared:async()=>{},syncAnswerChanges:async()=>events.push('sync')},BLCpAssistant:{validateHologramOrders:()=>{},markHologramOrdered:()=>events.push('ordered')},BLExcelTemplates:{records:()=>[],build:async()=>new Uint8Array(),error:()=>new Error('invalid')}};
  const ctx=vm.createContext({window:root,appLang:'en',showToast:()=>{},kolDownloadBuffer:()=>events.push('download')});vm.runInContext(code,ctx);
  await ctx.createHologramRequestExcel([row]);assert.deepEqual(events,['download','ordered','sync']);events.length=0;
  root.BLExcelTemplates.build=async()=>{throw new Error('write failed');};await assert.rejects(()=>ctx.createHologramRequestExcel([row]),/write failed/);assert.deepEqual(events,[]);
});
test('Ordered status stays distinct from Approved and is recognized by browser and server',()=>{
  const c=require('../public/cp-checklist-engine.js'),sync=require('../public/checklist-supplier-sync.js'),server=require('../server/lib/checklist-supplier-store.js');
  assert.ok(c.statusIds().includes('custom:ordered'));assert.equal(c.statusLabel('custom:ordered','en'),'Ordered');assert.equal(c.statusLabel('custom:ordered','tr'),'Sipariş Geçildi');
  for(const status of ['Ordered','Sipariş Geçildi','custom:ordered']){assert.equal(c.normalizeStatus(status),'custom:ordered');assert.equal(sync.normalizeState(status),'custom:ordered');assert.equal(server.normalizeState(status),'custom:ordered');}
});
test('saved hologram calculation is applied to exports, including legacy templates',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/excel-templates.js'),'utf8');
  const entryKey='bl.excelTemplates.hologram.v1',captured=[],defaultConfig=H.template();
  const preference={version:1,name:'hologram.xlsx',config:{...defaultConfig,quantityRule:{multiplier:1.1,roundTo:25}},bytes:Buffer.from('template').toString('base64')};
  const root={
    BLHologramRequest:H,BLPerf:{ensureLibrary:async()=>{}},
    BLExcelTemplateEngine:{fill:async(_bytes,config,records)=>{captured.push({config,records});return 'output';}},
    BLExcelDates:{},JSZip:{}
  };
  const context=vm.createContext({
    window:root,appLang:'tr',Uint8Array,Date,
    atob:s=>Buffer.from(s,'base64').toString('binary'),
    fetch:async()=>({ok:true,json:async()=>({entries:{[entryKey]:{value:JSON.stringify(preference)}}})})
  });
  vm.runInContext(source,context);
  const record={orderQuantity:1000,hologramQuantity:50};
  assert.equal(await root.BLExcelTemplates.build('hologram',[record]),'output');
  assert.equal(captured.pop().records[0].hologramQuantity,1100);
  assert.equal(record.hologramQuantity,50,'input records are not mutated');
  delete preference.config.quantityRule;
  assert.equal(await root.BLExcelTemplates.build('hologram',[record]),'output');
  assert.equal(captured.pop().records[0].hologramQuantity,1050,'legacy template uses the corrected default');
  assert.equal(root.BLExcelTemplates.catalog('hologram').find(x=>x.id==='hologramQuantity').label.includes('%3'),false);
});
test('templates use the authenticated personal preference store',()=>{
  assert.equal(require('../server/lib/user-preferences.js').isSyncedKey('bl.excelTemplates.hologram.v1'),true);
});
test('1904-date-system revisions keep the requested calendar dates',async()=>{
  const wb=new ExcelJS.Workbook();wb.properties.date1904=true;const ws=wb.addWorksheet('Dates');ws.addRow(['Date']);ws.getCell('A2').numFmt='dd.mm.yyyy';
  const config={sheetName:'Dates',headerRow:1,dataRow:2,columns:[{column:1,field:'today'}]};
  const output=await templates.fill(await wb.xlsx.writeBuffer(),config,[{today}],JSZip,dates),read=new ExcelJS.Workbook();await read.xlsx.load(output);
  assert.equal(read.properties.date1904,true);assert.equal(read.worksheets[0].getCell('A2').value.getTime(),Date.UTC(2026,9,19));
});
test('MB downloadable defaults use the actual writer including all display formats',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),a=source.indexOf('function mbBuildWorkbook('),b=source.indexOf('async function mbExportExcel(',a);
  const headers=Array.from({length:41},(_,i)=>'Column '+i),ctx=vm.createContext({ExcelJS,MB_LIST_HEADERS:headers,mbHeaderFill:()=> 'FFDDEBF7',mbValue:(_r,i)=>[12,13,14].includes(i)?today:i>=20?0.15:''});
  vm.runInContext(source.slice(a,b),ctx);const wb=ctx.mbBuildWorkbook([{}]),ws=wb.worksheets[0];assert.equal(ws.getColumn(1).width,14);assert.equal(ws.getColumn(34).width,30);assert.equal(ws.getCell('X2').numFmt,'0.00%');assert.equal(ws.getCell('U2').numFmt,'$#,##0.00');assert.equal(ws.views[0].ySplit,1);
  const config={sheetName:ws.name,headerRow:1,dataRow:2,columns:[{column:24,field:'lfl'}]},out=await templates.fill(await wb.xlsx.writeBuffer(),config,[{lfl:0.15}],JSZip,dates),read=new ExcelJS.Workbook();await read.xlsx.load(out);assert.equal(read.worksheets[0].getCell('X2').value,0.15);assert.equal(read.worksheets[0].getCell('X2').numFmt,'0.00%');
});
