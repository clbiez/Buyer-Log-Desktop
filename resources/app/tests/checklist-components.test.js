'use strict';
const asyncChildScript=require('./helpers/async-child-script');
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
      const actor={id:'buyer'};await store.applyEntries([
        {orderKey:'SET-PO',itemId:'@set-components',state:'open',componentCount:3},
        {orderKey:'SET-PO',itemId:'tests~part~A',state:'approved',note:'A'},
        {orderKey:'SET-PO',itemId:'tests~part~B',state:'rejected',note:'B'}],actor);
      await store.applyEntries([{orderKey:'SET-PO',itemId:'tests~part~A',state:'open'}],actor);
      let code;try{await store.applyEntries([{orderKey:'SET-PO',itemId:'@set-components',state:'open',componentCount:2}],actor);}catch(e){code=e.code;}
      process.stdout.write(JSON.stringify({payload:store.publicPayload(),events:store._read().events,code}));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',asyncChildScript(script)],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
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
  ctx.kolRows[0].setPieceCount=1;
  assert.equal(ctx.kolSetChecklistStatus(1,'check','approved'),true);
  assert.equal(ctx.kolChecklistStatus(ctx.saved[0].check),'approved');
  assert.equal(ctx.saved[0].check.parts[1].state,'rejected','single status retains archived B evidence');
  ctx.kolRows[0].setPieceCount=3;
  assert.equal(ctx.kolChecklistParts(ctx.kolRows[0],ctx.kolRows[0].check)[1].state,'rejected');
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
  const step=Components.itemId('tests','B');
  api._ui.ai={state:'done',packet:{},reviews:{['R-SET-1::'+analysis.orderKey+'::'+step]:{reportId:'R-SET-1',orderKey:analysis.orderKey,step,status:'rejected',blocked:false}}};
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
      await store.applyEntries([{orderKey:'P',itemId:'@set-components',state:'open',componentCount:2,at:'2026-10-20T12:00:00Z'}],actor);
      let code;try{await store.applyEntries([
        {orderKey:'P',itemId:'@set-components',state:'open',componentCount:3,at:'2026-10-20T11:00:00Z'},
        {orderKey:'P',itemId:'tests~part~C',state:'approved',at:'2026-10-20T13:00:00Z'}],actor);}catch(e){code=e.code;}
      process.stdout.write(JSON.stringify({code,payload:store.publicPayload()}));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',asyncChildScript(script)],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
    assert.equal(result.code,'CHECKLIST_COMPONENTS_INVALID');
    assert.equal(result.payload.answers['P::tests~part~C'],undefined);
    assert.equal(result.payload.tombstones['P::@set-components'].componentCount,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('component validation identifies the failing entry in a multi-order batch without writing it',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-notification-component-'));
  try{
    const script=`const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))});
      let failure;try{await store.applyEntries([
        {orderKey:'100|DEMO|001',itemId:'tests',state:'approved'},
        {orderKey:'200|SET|002',itemId:'tests~part~B',state:'approved'}
      ],{id:'buyer'});}catch(error){failure={code:error.code,orderKey:error.orderKey,itemId:error.itemId};}
      process.stdout.write(JSON.stringify({failure,answers:store.publicPayload().answers}));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',asyncChildScript(script)],{cwd:ROOT,env:{...process.env,BUYER_LOG_DATA_ROOT:dir,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')},encoding:'utf8'}));
    assert.deepEqual(result.failure,{code:'CHECKLIST_COMPONENTS_INVALID',orderKey:'200|SET|002',itemId:'tests~part~B'});
    assert.deepEqual(result.answers,{});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('sync forwards only the rejected in-flight entry as a durable notification target',async()=>{
 const fail={error:'Define the set roster before updating a component.',code:'CHECKLIST_COMPONENTS_INVALID',orderKey:'200|SET|002',itemId:'tests~part~B'};
 const b=browser(new Map(),async()=>({ok:false,status:400,json:async()=>fail}));
 const first={orderKey:'100|DEMO|001',sourceRow:{Category:"2'li Takım"}},second={orderKey:'200|SET|002',sourceRow:{Category:"2'li Takım"}};
 b.assistant.setChecklistAnswer(first,'tests~part~A','approved');b.assistant.setChecklistAnswer(second,'tests~part~B','approved');
 await assert.rejects(b.sync.syncAnswerChanges(),error=>{assert.equal(error.notificationTarget.lineKey,'200|SET|002');assert.equal(error.notificationTarget.itemId,'tests~part~B');assert.equal(error.notificationTarget.module,'cp');return true;});
 b.assistant.setChecklistAnswer(first,'tests~part~A','rejected');b.assistant.setChecklistAnswer(second,'tests~part~B','rejected');
 fail.orderKey='999|UNRELATED|003';
 await assert.rejects(b.sync.syncAnswerChanges(),error=>{assert.equal(error.notificationTarget.lineKey,undefined,'unknown batch error never guesses a record');return true;});
});

test('option-scoped approval includes its own roster and the server accepts the full transaction',async()=>{
  const posts=[],b=browser(new Map(),async(_url,options)=>{posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};});
  b.assistant._state.rules.push({id:'shared-set',kind:'checklist',approvalScope:'option'});
  b.assistant.setChecklistAnswer(analysis,Components.itemId('shared-set','B'),'approved',{note:'Keep option evidence'});
  await b.sync.syncAnswerChanges();
  const entries=posts.flatMap(p=>p.entries),option=Checklist.optionAnswerKey(analysis,'').split('::')[0];
  assert.equal(entries.find(e=>e.orderKey===option&&e.itemId===Components.CONFIG_ITEM)?.componentCount,3);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-option-roster-'));
  try{
    const script=`const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))});await store.applyEntries(${JSON.stringify(entries)},{id:'buyer'});process.stdout.write(JSON.stringify(store.publicPayload()));`;
    const result=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',asyncChildScript(script)],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
    assert.equal(result.answers[Checklist.optionAnswerKey(analysis,'shared-set~part~B')].note,'Keep option evidence');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a batch boundary never sends a first part before its roster',async()=>{
  const known=new Set(),posts=[],b=browser(new Map(),async(_url,options)=>{
    const entries=JSON.parse(options.body).entries;posts.push(entries);
    for(const entry of entries.filter(e=>e.itemId===Components.CONFIG_ITEM))known.add(entry.orderKey);
    for(const entry of entries.filter(e=>Components.parseItem(e.itemId)))assert.ok(known.has(entry.orderKey),'part needs a roster in this or an earlier request');
    return {ok:true,json:async()=>({ok:true})};
  });
  for(let i=0;i<199;i++)b.assistant.setChecklistAnswer({orderKey:'normal-'+i},'tests','rejected');
  b.assistant.setChecklistAnswer(analysis,'tests~part~B','rejected');
  await b.sync.syncAnswerChanges();
  assert.ok(posts.length>1);assert.ok(posts.every(entries=>entries.length<=200));
});

test('legacy pending option parts recover a rejected transaction after restart',async()=>{
  const b=browser(new Map(),async()=>({ok:false,status:400,json:async()=>({code:'CHECKLIST_COMPONENTS_INVALID'})}));
  b.assistant._state.rules.push({id:'shared-set',kind:'checklist',approvalScope:'option'});
  b.assistant.setChecklistAnswer(analysis,'shared-set~part~B','approved',{note:'Legacy evidence'});
  delete b.assistant._state.answers[Checklist.optionAnswerKey(analysis,Components.CONFIG_ITEM)];
  b.assistant.persistChecklistAnswers({silent:true});
  await assert.rejects(b.sync.syncAnswerChanges());
  const posts=[],restarted=browser(b.saved,async(_url,options)=>{posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};});
  restarted.ctx.BLFormulaRows={cp:()=>[analysis]};
  restarted.assistant.computeDecisionsForRows=()=>({byRow:new Map([[analysis,analysis]])});
  await restarted.sync.syncAnswerChanges();
  const entries=posts.flatMap(p=>p.entries),option=Checklist.optionAnswerKey(analysis,'').split('::')[0];
  assert.equal(entries.find(e=>e.orderKey===option&&e.itemId===Components.CONFIG_ITEM)?.componentCount,3);
  assert.equal(entries.find(e=>e.orderKey===option&&e.itemId==='shared-set~part~B')?.note,'Legacy evidence');
  assert.ok(entries.some(e=>e.orderKey===analysis.orderKey&&e.itemId==='shared-set~part~B'),'the rejected companion PO edit is recovered too');
});

test('count 1 switches to a single status and restoring the roster restores part evidence',()=>{
  const b=browser();
  b.assistant.setChecklistAnswer(analysis,'tests~part~B','rejected',{note:'B retained'});
  assert.equal(b.assistant.setChecklistComponents(analysis,1),true);
  assert.deepEqual(Checklist.componentsFor(analysis,{answers:b.assistant._state.answers}),[]);
  assert.equal(b.assistant.setChecklistAnswer(analysis,'tests','approved'),true);
  assert.equal(Checklist.statusOf(analysis,'tests',{answers:b.assistant._state.answers}),'approved');
  assert.equal(b.assistant.setChecklistAnswer(analysis,'tests~part~A','approved'),false);
  const restarted=browser(b.saved);
  assert.equal(Checklist.componentsFor(analysis,{answers:restarted.assistant._state.answers}).length,0);
  assert.equal(restarted.assistant.setChecklistComponents(analysis,3),true);
  assert.equal(Checklist.statusOf(analysis,'tests',{answers:restarted.assistant._state.answers}),'rejected');
  assert.equal(restarted.assistant._state.answers['SET-PO::tests~part~B'].note,'B retained');
});
test('each checklist controls set tracking independently, including rule facts and native writes',()=>{
  const Rules=require('../public/cp-rules-engine');
  const make=(id,separateSetParts)=>Rules.normalizeRule({id,kind:'checklist',separateSetParts,conditions:[{field:'@daysToLoad',operator:'lte',value:60}]});
  const single=make('single',false),parts=make('parts',true),a={...analysis,daysToLoad:10};
  assert.equal(Rules.normalizeRule(JSON.parse(JSON.stringify(single))).separateSetParts,false);
  assert.equal(make('legacy').separateSetParts,true);
  const b=browser();b.assistant._state.rules.push(single,parts);
  assert.equal(b.assistant.setChecklistAnswer(a,'single','approved'),true);
  assert.equal(b.assistant.setChecklistAnswer(a,'single~part~A','approved'),false);
  assert.equal(b.assistant.setChecklistAnswer(a,'parts','approved'),false);
  const result=Rules.evaluateOrder(a,{rules:[single,parts],answers:b.assistant._state.answers});
  assert.equal(result.checklistState.single,'approved');assert.equal(result.checklistState.parts,'open');
  const prepared=Rules.prepareEvaluation([single,parts]);
  assert.equal(Rules.evaluateOrder(a,{rules:prepared.rules,preparedRules:prepared,answers:b.assistant._state.answers}).checklistState.single,'approved');
});
test('supplier workbook mixes whole-model and part checklists and round trips both',async()=>{
  const ExcelJS=require('../public/vendor/exceljs.min.js'),Sync=require('../public/checklist-supplier-sync');
  const items=[{id:'single',tr:'Tek',en:'Single',separateSetParts:false},{id:'parts',tr:'Parçalar',en:'Parts'}];
  const built=await Sync.buildSupplierWorkbook({ExcelJS,rows:[analysis.sourceRow],items,language:'en',columnIds:['order'],analysisFor:()=>analysis,itemApplies:()=>true,answerFor:()=>({state:'approved'}),prepareImage:async()=>null});
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(built.buffer);
  const meta=wb.getWorksheet('__BL_META'),ids=[];for(let r=5;r<=meta.rowCount;r++)ids.push(meta.getRow(r).getCell(6).text);
  assert.deepEqual(ids,['single','parts~part~A','parts~part~B','parts~part~C']);
  const parsed=Sync.parseSupplierWorkbook(wb,{analysisFor:()=>analysis,catalog:new Map(items.map(i=>[i.id,i])),applies:()=>true,english:true});
  assert.ok(parsed.entries.some(e=>e.itemId==='single'&&e.state==='approved'));
  assert.ok(parsed.entries.some(e=>e.itemId==='parts~part~B'&&e.state==='approved'));
});
test('server persists count 1 without deleting evidence and accepts restoration',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-single-set-'));
  try{
    const script=`const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))}),actor={id:'buyer'};
      await store.applyEntries([{orderKey:'P',itemId:'@set-components',state:'open',componentCount:3},{orderKey:'P',itemId:'tests~part~B',state:'rejected',note:'Retained'}],actor);
      await store.applyEntries([{orderKey:'P',itemId:'@set-components',state:'open',componentCount:1},{orderKey:'P',itemId:'tests',state:'approved'}],actor);
      await store.replaceDefinitions([{id:'single',kind:'checklist',name:'Single',separateSetParts:false}],actor);
      const single=store.publicPayload();let code;try{await store.applyEntries([{orderKey:'P',itemId:'tests~part~B',state:'approved'}],actor);}catch(e){code=e.code;}
      await store.applyEntries([{orderKey:'P',itemId:'@set-components',state:'open',componentCount:3}],actor);
      process.stdout.write(JSON.stringify({single,code,restored:store.publicPayload()}));`;
    const r=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',asyncChildScript(script)],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}}));
    assert.equal(r.single.tombstones['P::@set-components'].componentCount,1);
    assert.equal(r.single.definitions[0].separateSetParts,false);
    assert.equal(r.single.answers['P::tests'].state,'approved');assert.equal(r.code,'CHECKLIST_COMPONENTS_INVALID');
    assert.equal(r.restored.answers['P::tests~part~B'].note,'Retained');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
