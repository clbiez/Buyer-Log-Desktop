'use strict';
/* Office supplier checklist workbook export: the CP workbook builder runs on
   the server for scoped orders, with the same decisions and answers, and the
   file is stored as an Office output. A supplier-filled copy of that file
   imports back through cp.checklist.supplier.import (full round trip). */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-agent-supplier-export-'));
for(const key of ['BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const ExcelJS=require('../public/vendor/exceljs.min.js'),CP=require('../public/cp-readiness-engine');
const native=require('../server/lib/checklist-supplier-store'),artifacts=require('../server/lib/agent-artifact-store');
const {createToolRegistry}=require('../server/lib/agent-tool-registry');
const {registerChecklistSupplierTools,registerChecklistSupplierExport,TOOL_ID,EXPORT_ID}=require('../server/lib/agent-checklist-supplier-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

const iso=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const row=order=>({'Order Code':order,'Model Name':'DEMO MODEL','C.Code':'C1','Colour Code':'C1','Sub-Manufacturer':'DEMO SUPPLIER','Ex-factory':iso(60),'Order Quantity':100});
const rows=[row('DEMO-1'),row('DEMO-2'),row('DEMO-3')],keyOf=r=>CP.analyzeOrder(r,{settings:CP.DEFAULT_SETTINGS}).orderKey;
const rule=(id,days,extra={})=>({id,kind:'checklist',name:id,nameEn:id,tr:'TR '+id,en:'EN '+id,enabled:true,mode:'basic',match:'all',conditions:[{field:'@daysToLoad',operator:'lte',value:days}],...extra});
const profile={id:'export-owner',displayName:'DEMO Owner'};
const outputs=new Map();
const outputService=()=>({store:{save:(owner,input)=>{const id=crypto.randomBytes(12).toString('hex'),record={id,owner,fileName:input.title+'.xlsx',format:input.format,bytes:input.buffer.length,requestId:input.requestId,buffer:input.buffer};outputs.set(id,record);return record;}},get:(owner,id)=>{const r=outputs.get(id);return r&&r.owner===owner?r:null;}});
let allowed,answers;
function tools(){
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  const deps={authorizedOrders:async()=>allowed,sourceRevision:()=>'1',withAgentMutation:(_c,work)=>work(),outputService,rowImage:()=>null,
    data:async()=>({cpRows:rows,personalRules:[rule('demo-check',400,{evidenceFields:{reportNumber:true}}),rule('demo-late',-100)],deletedRuleIds:[],settings:CP.DEFAULT_SETTINGS,checklistEnabled:true,checklist:{answers},customStatuses:[{id:'custom:wait',name:'DEMO Bekleme'}]})};
  registerChecklistSupplierExport(registry,deps);registerChecklistSupplierTools(registry,deps);
  return registry;
}
const ctx={ownerId:profile.id,profile,input:{officeJobId:'job-x',officeStepId:'step-x',officeAgentId:'agent-x'},approvalGranted:true,assertAuthority:()=>{}};

test('export builds the CP workbook for scoped orders only, with current answers, and stores it as an Office output',async()=>{
  const [k1,k2,k3]=rows.map(keyOf);allowed=new Map([[k1,{}],[k2,{}]]);
  answers={[k1+'::demo-check']:{state:'rejected',note:'DEMO eski not',at:'2026-01-01T00:00:00.000Z'},[k2+'::demo-check']:{state:'custom:wait',at:'2026-01-01T00:00:00.000Z'}};
  const registry=tools(),args={orderKeys:[k1,k2,k3,'DEMO-UNKNOWN'],language:'en',columns:['model','supplier']};
  const dry=await registry.execute(EXPORT_ID,args,{...ctx,dryRun:true});
  assert.deepEqual([dry.preview.orders,dry.preview.missing,dry.preview.supplier],[2,2,'DEMO SUPPLIER']);
  assert.ok(dry.preview.items>=2,'built-in and personal checklist headings, as in the CP export');
  assert.equal(dry.preview.binding,undefined);
  const done=await registry.execute(EXPORT_ID,{...args,fingerprint:dry.fingerprint},ctx);
  assert.equal(done.output.format,'xlsx');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(outputs.get(done.output.id).buffer);
  const sheet=wb.getWorksheet('Checklist'),header=sheet.getRow(1).values.filter(Boolean);
  assert.deepEqual(header.slice(0,3),['Order Code','Model Name','Supplier']);
  const col=sheet.getRow(1).values.indexOf('EN demo-check');
  assert.ok(col>0);assert.equal(sheet.getRow(1).getCell(col+1).text,'EN demo-check - Note');assert.equal(sheet.getRow(1).getCell(col+2).text,'EN demo-check - Report No');
  assert.equal(Boolean(sheet.sheetProtection&&sheet.sheetProtection.sheet),true,'the sheet is protected like the CP export');
  // Status dropdown values reside on the hidden meta sheet; orders begin directly at row 2.
  const keyCol=sheet.getRow(1).values.indexOf('__BL_ORDER_KEY'),dataRows=[];sheet.eachRow((r,n)=>{if(n>1&&r.getCell(keyCol).text)dataRows.push(r);});
  const statuses=dataRows.map(r=>r.getCell(col).text);
  assert.deepEqual(statuses,['Rejected','DEMO Bekleme'],'current answers, custom status names in the owner language');
  assert.equal(dataRows.length,2,'the order the owner may not read is not exported');
  assert.deepEqual(dataRows.map(r=>r.number),[2,3], 'supplier data starts immediately beneath the headers');
});

test('a supplier-filled copy of the exported workbook imports back through Office',async()=>{
  const [k1,k2]=rows.map(keyOf);allowed=new Map([[k1,{}],[k2,{}]]);answers={};
  fs.mkdirSync(path.dirname(native.FILE),{recursive:true});fs.writeFileSync(native.FILE,JSON.stringify({revision:1,definitions:[],answers:{},tombstones:{},events:[]}));
  const registry=tools();
  const dry=await registry.execute(EXPORT_ID,{orderKeys:[k1,k2],language:'tr'},{...ctx,dryRun:true});
  const done=await registry.execute(EXPORT_ID,{orderKeys:[k1,k2],language:'tr',fingerprint:dry.fingerprint},ctx);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(outputs.get(done.output.id).buffer);
  const meta=wb.getWorksheet('__BL_META'),sheet=wb.getWorksheet('Checklist');
  let statusColumn=0;for(let r=5;r<=meta.rowCount;r++)if(meta.getRow(r).getCell(6).text==='demo-check')statusColumn=Number(meta.getRow(r).getCell(1).value);
  const keyCol=sheet.getRow(1).values.indexOf('__BL_ORDER_KEY'),dataRows=[];sheet.eachRow((r,n)=>{if(n>1&&r.getCell(keyCol).text)dataRows.push(r);});
  dataRows[0].getCell(statusColumn).value='Onaylandı';dataRows[1].getCell(statusColumn).value='Reddedildi';
  const file=await artifacts.put(profile,Buffer.from(await wb.xlsx.writeBuffer()),'supplier.xlsx','workbook');
  const preview=await registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true});
  assert.equal(preview.preview.counts.updates,2);
  const imported=await registry.execute(TOOL_ID,{artifactId:file.id,fingerprint:preview.fingerprint},ctx);
  assert.equal(imported.data.updated,2);
  const store=native._read().answers;
  assert.deepEqual([store[k1+'::demo-check'].state,store[k2+'::demo-check'].state],['approved','rejected']);
});

test('export without a readable order is refused',async()=>{
  allowed=new Map();answers={};
  await assert.rejects(tools().execute(EXPORT_ID,{orderKeys:[keyOf(rows[0])]},{...ctx,dryRun:true}),{code:'OFFICE_SUPPLIER_EXPORT_EMPTY'});
});
