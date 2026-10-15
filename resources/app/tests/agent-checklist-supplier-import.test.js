'use strict';
/* Office supplier checklist workbook import: the uploaded Buyer Log supplier
   workbook is read with the CP import parser, applicability comes from the CP
   decision engines, rows the owner may not edit are skipped and counted, the
   native supplier_excel write keeps newer Buyer Log answers, and the inverse
   restores the exact prior answers. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-agent-supplier-xlsx-'));
for(const key of ['BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const ExcelJS=require('../public/vendor/exceljs.min.js'),CP=require('../public/cp-readiness-engine');
const native=require('../server/lib/checklist-supplier-store'),artifacts=require('../server/lib/agent-artifact-store');
const {createToolRegistry}=require('../server/lib/agent-tool-registry'),{registerChecklistSupplierTools,TOOL_ID}=require('../server/lib/agent-checklist-supplier-tools');
const Sync=require('../public/checklist-supplier-sync');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

const iso=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const row=(order,days=60)=>({'Order Code':order,'Model Name':'DEMO MODEL','Colour Code':'C1','Ex-factory':iso(days),'Order Quantity':100});
const rows=[row('DEMO-1'),row('DEMO-2'),row('DEMO-3'),row('DEMO-4'),row('DEMO-5')];
const keyOf=r=>CP.analyzeOrder(r,{settings:CP.DEFAULT_SETTINGS}).orderKey,loadOf=r=>String(CP.analyzeOrder(r,{settings:CP.DEFAULT_SETTINGS}).plannedLoadDate);
const rule=(id,days)=>({id,kind:'checklist',name:id,nameEn:id,tr:'TR '+id,en:'EN '+id,enabled:true,mode:'basic',match:'all',conditions:[{field:'@daysToLoad',operator:'lte',value:days}]});
const profile={id:'supplier-owner',displayName:'DEMO Owner'};
let allowed,revision;
function tools(){
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  registerChecklistSupplierTools(registry,{authorizedOrders:async()=>allowed,sourceRevision:()=>String(revision),withAgentMutation:(_c,work)=>work(),
    data:async()=>({cpRows:rows,personalRules:[rule('demo-check',400),rule('demo-late',-100)],deletedRuleIds:[],settings:CP.DEFAULT_SETTINGS,checklistEnabled:true,checklist:{answers:{}},customStatuses:[{id:'custom:wait',name:'DEMO Bekleme'}]})});
  return registry;
}
const ctx={ownerId:profile.id,profile,input:{officeJobId:'job-s',officeStepId:'step-s',officeAgentId:'agent-s'},approvalGranted:true,assertAuthority:()=>{}};
async function workbook(exportedAt,lines){
  const wb=new ExcelJS.Workbook(),meta=wb.addWorksheet('__BL_META'),sheet=wb.addWorksheet('Checklist');
  meta.getCell('A1').value='BUYER_LOG_CHECKLIST_SUPPLIER';meta.getCell('B1').value=2;meta.getCell('B2').value=exportedAt;
  meta.getRow(5).values=[3,4,0,0,0,'demo-check','TR demo-check','EN demo-check'];
  meta.getRow(6).values=[5,0,0,0,0,'demo-late','TR demo-late','EN demo-late'];
  sheet.getRow(1).values=['Order','Supplier','DEMO check','Note','DEMO late','__BL_ORDER_KEY','__BL_LOAD_DATE'];
  lines.forEach((line,i)=>{sheet.getRow(i+2).values=[line.order||'',line.supplier||'DEMO SUPPLIER',line.check,line.note||'',line.late||'',line.key,line.load||''];});
  return artifacts.put(profile,Buffer.from(await wb.xlsx.writeBuffer()),'demo-supplier.xlsx','workbook');
}
function resetStore(answers={}){fs.mkdirSync(path.dirname(native.FILE),{recursive:true});fs.writeFileSync(native.FILE,JSON.stringify({revision:3,definitions:[],answers,tombstones:{},events:[]}));}

test('preview counts every skip reason; apply writes supplier_excel answers; inverse restores exactly',async()=>{
  const [r1,r2,r3,r4,r5]=rows,k1=keyOf(r1);
  resetStore({[native.answerKey(k1,'demo-check')]:{key:native.answerKey(k1,'demo-check'),orderKey:k1,itemId:'demo-check',state:'rejected',at:'2026-01-01T00:00:00.000Z',note:'DEMO eski'}});
  allowed=new Map([[k1,{}],[keyOf(r3),{}],[keyOf(r4),{}],[keyOf(r5),{}]]);revision=1;
  const file=await workbook('2026-02-01T00:00:00.000Z',[
    {key:k1,load:loadOf(r1),check:'Onaylandı',note:'DEMO not',late:'approved'},
    {key:keyOf(r2),load:loadOf(r2),check:'approved'},
    {key:'DEMO-UNKNOWN|X|—',check:'approved'},
    {key:keyOf(r3),load:'1',check:'approved'},
    {key:keyOf(r4),load:loadOf(r4),check:{formula:'1+1'}},
    {key:keyOf(r5),load:loadOf(r5),check:'DEMO Bekleme'},
  ]);
  const registry=tools(),before=native._read();
  const dry=await registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true});
  assert.deepEqual(dry.preview.counts,{entries:2,updates:2,pending:0,expectedConflicts:0,blank:3,invalid:2,notApplicable:1,formulaCells:1,staleRows:1,forbidden:1});
  assert.equal(dry.preview.artifact.sha256,file.sha256);
  assert.deepEqual(dry.preview.changes.map(c=>[c.itemId,c.state,c.beforeState]),[['demo-check','approved','rejected'],['demo-check','custom:wait',null]]);
  assert.deepEqual(native._read(),before,'preview writes nothing');
  const done=await registry.execute(TOOL_ID,{artifactId:file.id,fingerprint:dry.fingerprint},ctx);
  assert.equal(done.verified,true);assert.equal(done.outcome,'partial');assert.equal(done.data.updated,2);
  const stored=native._read().answers[native.answerKey(k1,'demo-check')];
  assert.equal(stored.state,'approved');assert.equal(stored.source,'supplier_excel');assert.equal(stored.note,'DEMO not');assert.equal(stored.supplier,'DEMO SUPPLIER');
  assert.equal(native._read().answers[native.answerKey(keyOf(r2),'demo-check')],undefined,'a row the owner may not edit is never written');
  await assert.rejects(registry.rollback(TOOL_ID,done.rollbackToken,{...ctx,input:{...ctx.input,officeStepId:'other'}}),{code:'OFFICE_ROLLBACK_INVALID'});
  const undone=await registry.rollback(TOOL_ID,done.rollbackToken,ctx);
  assert.equal(undone.verified,true);
  assert.deepEqual(native._read().answers,before.answers);
});

test('a newer Buyer Log answer than the export is predicted and kept by the native gate',async()=>{
  const k1=keyOf(rows[0]),key=native.answerKey(k1,'demo-check');
  resetStore({[key]:{key,orderKey:k1,itemId:'demo-check',state:'rejected',at:'2026-03-01T00:00:00.000Z'}});
  allowed=new Map([[k1,{}],[keyOf(rows[2]),{}]]);revision=1;
  const file=await workbook('2026-02-01T00:00:00.000Z',[{key:k1,load:loadOf(rows[0]),check:'approved'},{key:keyOf(rows[2]),load:loadOf(rows[2]),check:'Bekliyor'}]);
  const registry=tools(),dry=await registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true});
  assert.equal(dry.preview.counts.expectedConflicts,1);assert.equal(dry.preview.counts.pending,1);
  const done=await registry.execute(TOOL_ID,{artifactId:file.id,fingerprint:dry.fingerprint},ctx);
  assert.equal(done.data.conflicts,1);assert.equal(done.outcome,'partial');
  assert.equal(native._read().answers[key].state,'rejected','the newer Buyer Log answer is kept');
});

test('source change after preview, foreign or empty workbooks are refused before any write',async()=>{
  const k1=keyOf(rows[0]);resetStore();allowed=new Map([[k1,{}]]);revision=1;
  const file=await workbook('2026-02-01T00:00:00.000Z',[{key:k1,load:loadOf(rows[0]),check:'approved'}]);
  const registry=tools(),dry=await registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true});
  revision=2;
  await assert.rejects(registry.execute(TOOL_ID,{artifactId:file.id,fingerprint:dry.fingerprint},ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.deepEqual(native._read().answers,{});
  const plain=new ExcelJS.Workbook();plain.addWorksheet('Sheet1').getCell('A1').value='DEMO';
  const foreign=await artifacts.put(profile,Buffer.from(await plain.xlsx.writeBuffer()),'other.xlsx','workbook');
  await assert.rejects(registry.execute(TOOL_ID,{artifactId:foreign.id},{...ctx,dryRun:true}),{code:'OFFICE_SUPPLIER_WORKBOOK_INVALID'});
  const garbage=await artifacts.put(profile,Buffer.from('not a zip'),'broken.xlsx','workbook');
  await assert.rejects(registry.execute(TOOL_ID,{artifactId:garbage.id},{...ctx,dryRun:true}),{code:'OFFICE_SUPPLIER_WORKBOOK_INVALID'});
  allowed=new Map();
  await assert.rejects(registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true}),{code:'OFFICE_SUPPLIER_IMPORT_EMPTY'});
});

test('evidence longer than the native store accepts is counted invalid instead of failing the approved batch',async()=>{
  const k1=keyOf(rows[0]),k3=keyOf(rows[2]);resetStore();allowed=new Map([[k1,{}],[k3,{}]]);revision=1;
  const file=await workbook('2026-02-01T00:00:00.000Z',[{key:k1,load:loadOf(rows[0]),check:'approved',note:'x'.repeat(2001)},{key:k3,load:loadOf(rows[2]),check:'approved',note:'DEMO'}]);
  const registry=tools(),dry=await registry.execute(TOOL_ID,{artifactId:file.id},{...ctx,dryRun:true});
  assert.equal(dry.preview.counts.invalid,1);assert.equal(dry.preview.counts.entries,1);
  const done=await registry.execute(TOOL_ID,{artifactId:file.id,fingerprint:dry.fingerprint},ctx);
  assert.equal(done.data.updated,1);assert.equal(done.outcome,'partial');
});

test('the CP import button and the Office capability share one workbook parser',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../public/checklist-supplier-sync.js'),'utf8');
  assert.match(src,/async function importWorkbook\(file\)[\s\S]*?parseSupplierWorkbook\(workbook,/);
  assert.equal(typeof Sync.parseSupplierWorkbook,'function');
  assert.equal(Sync.normalizeState('DEMO Bekleme',[{id:'custom:wait',name:'DEMO Bekleme'}]),'custom:wait');
  assert.equal(Sync.normalizeState('Onaylandı'),'approved');
  const plain=new ExcelJS.Workbook();plain.addWorksheet('Sheet1');
  assert.throws(()=>Sync.parseSupplierWorkbook(plain,{english:true}),/not a Buyer Log supplier checklist workbook/,'explicit language holds for the parse');
  assert.throws(()=>Sync.parseSupplierWorkbook(plain,{english:false}),/üretici checklist şablonu değil/);
});
