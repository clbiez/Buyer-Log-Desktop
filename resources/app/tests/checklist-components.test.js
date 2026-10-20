'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Components = require('../public/checklist-components-engine');
const Checklist = require('../public/cp-checklist-engine');

const analysis = {orderKey:'SET-PO',plmId:'1',modelName:'Demo',colourCode:'001',sourceRow:{Category:"3'lü Takım"}};
test('set parts use canonical product fields; size-set sample text never creates product parts',()=>{
  assert.deepEqual(Components.labels(Components.count(analysis.sourceRow,'cp')),['A','B','C']);
  assert.equal(Components.count({Category:'T-shirt','Model Name':'Size Set sample'},'cp'),0);
  assert.equal(Components.count({urunTipi:"2'li Takım (T-shirt+Şort)"},'collection'),2);
  assert.equal(Components.count({Category:'Set'},'cp'),0,'unknown count requires explicit configuration');
});
test('each part has independent status and parent PLM/legacy approval cannot approve the set',()=>{
  const answers = {'SET-PO::tests':{state:'approved'}};
  const ctx = {answers,plmEvidence:()=>({state:'approved'})};
  const a = Components.itemId('tests','A'), b = Components.itemId('tests','B'), c = Components.itemId('tests','C');
  assert.equal(Checklist.statusOf(analysis,'tests',ctx),'open');
  answers[Checklist.answerKey(analysis.orderKey,a)]={state:'approved'};
  answers[Checklist.answerKey(analysis.orderKey,b)]={state:'rejected'};
  assert.equal(Checklist.statusOf(analysis,a,ctx),'approved');
  assert.equal(Checklist.statusOf(analysis,c,ctx),'open');
  assert.equal(Checklist.statusOf(analysis,'tests',ctx),'rejected');
  answers[Checklist.answerKey(analysis.orderKey,b)]={state:'notRequired'};
  assert.equal(Checklist.statusOf(analysis,'tests',ctx),'open');
  answers[Checklist.answerKey(analysis.orderKey,c)]={state:'approved'};
  assert.equal(Checklist.statusOf(analysis,'tests',ctx),'approved');
  for(const id of [a,b,c]) answers[Checklist.answerKey(analysis.orderKey,id)]={state:'notRequired'};
  assert.equal(Checklist.statusOf(analysis,'tests',ctx),'notRequired');
});
test('saved roster survives product changes and option approvals remain part-specific',()=>{
  const a=Components.itemId('artwork','A'),b=Components.itemId('artwork','B');
  const answers={
    [Components.configKey(analysis)]:{state:'open',componentCount:3},
    [Checklist.optionAnswerKey(analysis,a)]:{state:'approved'},
    [Checklist.optionAnswerKey(analysis,'artwork')]:{state:'approved'},
  };
  const changed={...analysis,sourceRow:{Category:'T-shirt'}};
  const ctx={answers,item:{id:'artwork',approvalScope:'option'}};
  assert.equal(Checklist.componentsFor(changed,ctx).length,3);
  assert.equal(Checklist.statusOf(changed,a,ctx),'approved');
  assert.equal(Checklist.statusOf(changed,b,ctx),'open');
  assert.equal(Checklist.statusOf(changed,'artwork',ctx),'open');
});
test('collection part updates preserve siblings, snapshot and legacy status across JSON persistence',()=>{
  let value=Components.updateValue('approved',3,'A','rejected');
  value=JSON.parse(JSON.stringify(value));
  value=Components.updateValue(value,2,'B','approved');
  assert.equal(value.legacyStatus,'approved');
  assert.deepEqual(value.parts.map(p=>[p.id,p.state]),[['A','rejected'],['B','approved'],['C','open']]);
  assert.equal(Components.aggregate(value.parts.map(p=>p.state)),'rejected');
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..');
function browser(saved=new Map(),fetch=async()=>({ok:true,json:async()=>({answers:{},tombstones:{}})})){
  const listeners=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  const ctx={console,Date,JSON,Map,Set,Promise,Blob,localStorage:storage,BLStorage:storage,BL_USER_CONTEXT:{id:'buyer'},
    BLCpChecklistEngine:Checklist,BLCpRulesEngine:require('../public/cp-rules-engine'),BLChecklistComponents:Components,
    BLCpReadinessEngine:{analyzeOrder:r=>r,summarizeAnalyses:orders=>({orders}),recount:m=>m},
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),
    document:{documentElement:{lang:'en'},querySelector:()=>null,getElementById:()=>null},fetch,
    setTimeout:()=>1,clearTimeout:()=>{},showToast:()=>{},
    CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},
    addEventListener:(name,f)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(f);},
    dispatchEvent:e=>(listeners.get(e.type)||[]).forEach(f=>f(e))};
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const file of ['cp-overview-assistant.js','checklist-answer-merge-engine.js','checklist-supplier-sync.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,'public',file),'utf8'),ctx);
  return {ctx,saved,assistant:ctx.BLCpAssistant,sync:ctx.BLChecklistSupplierSync};
}
test('native part writer preserves evidence and siblings through offline restart and shared sync',async()=>{
  const posts=[],b=browser(new Map(),async(_url,options)=>{if(options?.method==='POST')posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};});
  const a=Components.itemId('tests','A'),c=Components.itemId('tests','C');
  assert.equal(b.assistant.setChecklistAnswer(analysis,'tests','approved'),false,'whole-set writer cannot bypass parts');
  b.assistant.setChecklistAnswer(analysis,a,'rejected',{note:'A evidence',reportNumber:'RA',attachments:[{id:'a'.repeat(32)}]});
  b.assistant.setChecklistAnswer(analysis,c,'notRequired',{note:'C note'});
  b.assistant.setChecklistAnswer(analysis,a,'open');
  const restarted=browser(b.saved);
  const answers=restarted.assistant._state.answers;
  assert.equal(answers[Components.configKey(analysis)].componentCount,3);
  assert.equal(answers[Checklist.answerKey(analysis.orderKey,a)].note,'A evidence');
  assert.equal(answers[Checklist.answerKey(analysis.orderKey,a)].attachments.length,1);
  assert.equal(answers[Checklist.answerKey(analysis.orderKey,c)].state,'notRequired');
  assert.equal(restarted.assistant.setChecklistComponents(analysis,2),false,'saved roster cannot shrink');
  await b.sync.syncAnswerChanges();
  assert.ok(posts.flatMap(p=>p.entries).some(e=>e.itemId===Components.CONFIG_ITEM&&e.componentCount===3));
  assert.ok(posts.flatMap(p=>p.entries).some(e=>e.itemId===c&&e.state==='notRequired'));
});
test('server persists part roster, pending evidence, audit events and independent part decisions',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-set-parts-'));
  try{
    const script=`const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))});
      const actor={id:'buyer'};store.applyEntries([
        {orderKey:'SET-PO',itemId:'@set-components',state:'open',componentCount:3},
        {orderKey:'SET-PO',itemId:'tests~part~A',state:'approved',note:'A'},
        {orderKey:'SET-PO',itemId:'tests~part~B',state:'rejected',note:'B'}],actor);
      store.applyEntries([{orderKey:'SET-PO',itemId:'tests~part~A',state:'open'}],actor);
      let code;try{store.applyEntries([{orderKey:'SET-PO',itemId:'@set-components',state:'open',componentCount:2}],actor);}catch(e){code=e.code;}
      process.stdout.write(JSON.stringify({payload:store.publicPayload(),events:store._read().events,code}));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
    assert.equal(result.payload.tombstones['SET-PO::@set-components'].componentCount,3);
    assert.equal(result.payload.tombstones['SET-PO::tests~part~A'].note,'A');
    assert.equal(result.payload.answers['SET-PO::tests~part~B'].state,'rejected');
    assert.equal(result.code,'CHECKLIST_COMPONENTS_INVALID');
    assert.ok(result.events.some(e=>e.itemId==='tests~part~B'&&e.state==='rejected'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('supplier workbook round trip addresses each part and refuses legacy whole-set updates',async()=>{
  const ExcelJS=require('../public/vendor/exceljs.min.js'),Sync=require('../public/checklist-supplier-sync');
  const row=analysis.sourceRow,item={id:'tests',tr:'Test',en:'Test',evidenceFields:{reportNumber:true}};
  const snapshot={...analysis,sourceRow:{Category:'T-shirt'}};
  const answers={
    [Components.configKey(snapshot)]:{state:'open',componentCount:3},
    [Checklist.answerKey(analysis.orderKey,Components.itemId('tests','A'))]:{state:'approved',note:'A note',reportNumber:'RA'},
    [Checklist.answerKey(analysis.orderKey,Components.itemId('tests','B'))]:{state:'rejected',note:'B note'},
  };
  const built=await Sync.buildSupplierWorkbook({ExcelJS,rows:[row],items:[item],answers,language:'en',columnIds:['order'],analysisFor:()=>snapshot,itemApplies:()=>true,answerFor:(i,a)=>answers[Checklist.answerKey(a.orderKey,i.id)],prepareImage:async()=>null});
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(built.buffer);
  const sheet=wb.getWorksheet('Checklist'),meta=wb.getWorksheet('__BL_META');
  const ids=[];for(let r=5;r<=meta.rowCount;r++)ids.push(meta.getRow(r).getCell(6).text);
  assert.deepEqual(ids,['tests~part~A','tests~part~B','tests~part~C']);
  const keyCol=sheet.getRow(1).values.indexOf('__BL_ORDER_KEY');let dataRow;
  sheet.eachRow((row,n)=>{if(n>1&&row.getCell(keyCol).text===analysis.orderKey)dataRow=row;});
  const bColumn=Number(meta.getRow(6).getCell(1).value);dataRow.getCell(bColumn).value='Approved';
  const parsed=Sync.parseSupplierWorkbook(wb,{answers,analysisFor:()=>snapshot,catalog:new Map([['tests',item]]),applies:()=>true,english:true});
  assert.equal(parsed.entries.find(e=>e.itemId==='tests~part~B').state,'approved');
  assert.equal(parsed.entries.find(e=>e.itemId==='tests~part~A').reportNumber,'RA');
  assert.equal(parsed.entries.find(e=>e.itemId==='tests~part~C').state,'open');
  // A workbook exported before component tracking may only write its legacy slot.
  meta.getRow(5).getCell(6).value='tests';
  const legacy=Sync.parseSupplierWorkbook(wb,{answers,analysisFor:()=>snapshot,catalog:new Map([['tests',item]]),applies:()=>true,english:true});
  assert.ok(!legacy.entries.some(e=>e.itemId==='tests'));
  assert.equal(legacy.counts.notApplicable,1);
});

test('Collection native setter journals separate A/B/C decisions without copying a legacy approval',()=>{
  const source=fs.readFileSync(path.join(ROOT,'public/app-main.js'),'utf8');
  const ctx={window:null,BLChecklistComponents:Components,kolRows:[{id:1,urunTipi:"3'lü Takım",check:'approved'}],KOL_CHECKLIST_STATUSES:['open','approved','rejected','notRequired'],
    kolRequireWorkspaceEdit:()=>true,kolChecklistColumns:()=>[{k:'check'}],kolCellLinkedToModel:()=>false,kolEffectiveValue:(row,k)=>row[k],
    kolPushUndo:()=>{},kolWriteGroupedStorageValue:(row,k,value)=>{row[k]=value;},
    saveKolRows:()=>{ctx.saved=JSON.parse(JSON.stringify(ctx.kolRows));return true;},kolSaveWorkspaceNow:async()=>{},renderKol:()=>{}};
  ctx.window=ctx;vm.createContext(ctx);
  for(const name of ['kolChecklistStatus','kolChecklistParts','kolSetChecklistStatus']){
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
    vm.runInContext(source.slice(start,end),ctx);
  }
  assert.equal(ctx.kolSetChecklistStatus(1,'check','approved'),false);
  assert.equal(ctx.kolSetChecklistStatus(1,'check','approved','A'),true);
  assert.equal(ctx.kolSetChecklistStatus(1,'check','rejected','B'),true);
  assert.deepEqual(ctx.saved[0].check.parts.map(p=>p.state),['approved','rejected','open']);
  assert.equal(ctx.saved[0].check.legacyStatus,'approved');
  assert.equal(ctx.kolChecklistStatus(ctx.saved[0].check),'rejected');
});

test('rule evaluation and priority facts use the part aggregate instead of legacy or whole-set automation',()=>{
  const Rules=require('../public/cp-rules-engine');
  const a={...analysis,stage:'PRODUCTION',daysToLoad:14,orderAgeDays:60};
  const rule=Rules.normalizeRule({id:'part-check',kind:'checklist',name:'Parts',conditions:[{field:'@daysToLoad',operator:'lte',value:60}]});
  const answers={
    [Checklist.answerKey(a.orderKey,'part-check')]:{state:'approved'},
    [Checklist.answerKey(a.orderKey,Components.itemId('part-check','A'))]:{state:'approved'},
  };
  const result=Rules.evaluateOrder(a,{rules:[rule],answers});
  assert.equal(result.checklistState['part-check'],'open');
  answers[Checklist.answerKey(a.orderKey,Components.itemId('part-check','B'))]={state:'rejected'};
  assert.equal(Rules.evaluateOrder(a,{rules:[rule],answers}).checklistState['part-check'],'rejected');
  const automated=Rules.normalizeRule({...rule,autoStatus:'approved',autoFormula:'=[@stage]="PRODUCTION"'});
  const single={...a,sourceRow:{Category:'T-shirt'}};
  assert.equal(Rules.evaluateOrder(single,{rules:[automated],answers:{}}).checklistState['part-check'],'approved');
  const automatic=Rules.evaluateOrder(a,{rules:[automated],answers:{}});
  assert.equal(automatic.checklistState['part-check'],'open');
  assert.equal(automatic.autoDecisions.length,0);
});

test('test report preview requires an explicit valid set part before linking evidence',()=>{
  const b=browser(),row=analysis.sourceRow;
  b.ctx.BLTestReports=require('../public/test-report-engine');
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/test-report-import.js'),'utf8'),b.ctx);
  const api=b.ctx.BLTestReportImport;
  api._ui.decision={byRow:new Map([[row,analysis]])};
  api._ui.store={links:{},reports:{}};
  const entry={report:{talepNo:'R-SET-1',kararlar:[]},candidates:[{key:analysis.orderKey,row}],chosen:analysis.orderKey,itemId:'tests',include:true};
  api._ui.entries=[entry];
  assert.equal(api._plan(entry).ready,false);
  entry.itemId=Components.itemId('tests','B');
  assert.equal(api._plan(entry).ready,true);
  entry.itemId=Components.itemId('tests','Z');
  assert.equal(api._plan(entry).ready,false);
});
test('supplier first-write roster survives a later product source change',async()=>{
  const ExcelJS=require('../public/vendor/exceljs.min.js'),Sync=require('../public/checklist-supplier-sync');
  const item={id:'tests',tr:'Test',en:'Test'};
  const built=await Sync.buildSupplierWorkbook({ExcelJS,rows:[analysis.sourceRow],items:[item],language:'en',columnIds:['order'],analysisFor:()=>analysis,itemApplies:()=>true,answerFor:()=>null,prepareImage:async()=>null});
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(built.buffer);
  const parsed=Sync.parseSupplierWorkbook(wb,{analysisFor:()=>analysis,catalog:new Map([['tests',item]]),applies:()=>true,english:true});
  const roster=parsed.entries.find(e=>e.itemId===Components.CONFIG_ITEM);
  assert.equal(roster.componentCount,3);
  const answers=Object.fromEntries(parsed.entries.map(e=>[Checklist.answerKey(e.orderKey,e.itemId),e]));
  const changed={...analysis,sourceRow:{Category:'T-shirt'}};
  assert.deepEqual(Checklist.componentsFor(changed,{answers}).map(p=>p.id),['A','B','C']);
});

test('a skipped stale roster cannot authorize a hidden extra component',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-set-stale-roster-'));
  try{
    const script=`const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))}),actor={id:'buyer'};
      store.applyEntries([{orderKey:'P',itemId:'@set-components',state:'open',componentCount:2,at:'2026-10-20T12:00:00Z'}],actor);
      let code;try{store.applyEntries([
        {orderKey:'P',itemId:'@set-components',state:'open',componentCount:3,at:'2026-10-20T11:00:00Z'},
        {orderKey:'P',itemId:'tests~part~C',state:'approved',at:'2026-10-20T13:00:00Z'}],actor);}catch(e){code=e.code;}
      process.stdout.write(JSON.stringify({code,payload:store.publicPayload()}));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
    assert.equal(result.code,'CHECKLIST_COMPONENTS_INVALID');
    assert.equal(result.payload.answers['P::tests~part~C'],undefined);
    assert.equal(result.payload.tombstones['P::@set-components'].componentCount,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
