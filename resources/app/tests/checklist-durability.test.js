'use strict';
const asyncChildScript=require('./helpers/async-child-script');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const Checklist = require('../public/cp-checklist-engine');
const Rules = require('../public/cp-rules-engine');
const key = 'PO1::tests';
const analysis = { orderKey: 'PO1', plannedLoadDate: 21000, plmId: '1', modelName: 'Demo', colourCode: '001' };
function browser(saved = new Map(), fetch = async () => ({ ok: true, json: async () => ({ answers: {}, tombstones: {} }) })) {
  const listeners = new Map(), timers = [];
  const storage = { getItem: k => saved.get(k) || null, setItem: (k,v) => saved.set(k,String(v)), removeItem: k => saved.delete(k) };
  const ctx = { console, Map, Set, WeakMap, Date, JSON, Blob, Promise, localStorage: storage,
    BLStorage: { ...storage, actualKey: k => 'user.' + k, native: storage }, BL_USER_CONTEXT: { id: 'buyer' },
    BLCpChecklistEngine: Checklist, BLCpRulesEngine: Rules,
    BLCpReadinessEngine:{analyzeOrder:row=>row,summarizeAnalyses:orders=>({orders}),recount:model=>model},
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),
    document: { documentElement: { lang: 'en' }, querySelector: () => null, getElementById: () => null },
    fetch, setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    CustomEvent: class { constructor(type, props) { this.type = type; Object.assign(this, props); } },
    addEventListener: (name,f) => { if (!listeners.has(name)) listeners.set(name,[]); listeners.get(name).push(f); },
    dispatchEvent: e => (listeners.get(e.type) || []).forEach(f => f(e)), showToast: () => {},
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/cp-overview-assistant.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/checklist-answer-merge-engine.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/checklist-supplier-sync.js'),'utf8'),ctx);
  return { ctx, saved, timers, assistant: ctx.BLCpAssistant, sync: ctx.BLChecklistSupplierSync };
}
test('every explicit status survives date changes, PLM approval and restart with evidence', () => {
  const b = browser();
  const evidence = { note: 'line 1\nline 2', reportNumber: 'R-1', actualDate: '2026-10-04', attachments: [{id:'a'.repeat(32),filename:'report.pdf'}] };
  for (const status of ['rejected','notRequired','approved','open','rejected']) {
    b.assistant.setChecklistAnswer(analysis,'tests',status,evidence);
    const restarted = browser(b.saved);
    const answers = restarted.assistant._state.answers;
    assert.equal(Checklist.statusOf({...analysis,plannedLoadDate:22000},'tests',{answers,plmEvidence:()=>({state:'approved'})}),status);
    assert.equal(answers[key].note,evidence.note);
    assert.equal(answers[key].attachments.length,1);
  }
});
test('shared Pending tombstone restores its evidence and survives a second offline restart', async () => {
  const tomb = { state:'open',at:'2026-10-04T10:00:00.000Z',note:'Keep me',attachments:[{id:'a'.repeat(32)}] };
  const b = browser(new Map(), async () => ({ok:true,json:async()=>({answers:{},tombstones:{[key]:tomb}})}));
  await b.sync.loadShared();
  const restart = browser(b.saved);
  assert.equal(restart.assistant._state.answers[key].state,'open');
  assert.equal(restart.assistant._state.answers[key].note,'Keep me');
});
test('failed startup promotion retries instead of acknowledging unsaved answers', async () => {
  let fail = true; const writes = [];
  const b = browser(new Map(), async (url,options) => {
    if (options && options.method === 'POST') { writes.push(JSON.parse(options.body)); if(fail) throw Error('offline'); }
    return {ok:true,json:async()=>({answers:{},tombstones:{}})};
  });
  b.assistant.setChecklistAnswer(analysis,'tests','rejected');
  await b.sync.loadShared();
  fail = false;
  await b.sync.syncAnswerChanges();
  assert.ok(writes.length >= 2);
  assert.equal(writes.at(-1).entries[0].state,'rejected');
});
test('all callers wait for the active save and rapid edits are sent before completion', async () => {
  let resolvePost; const writes=[];
  const b = browser(new Map(), async (_url,options) => {
    writes.push(JSON.parse(options.body));
    if(writes.length===1) await new Promise(r=>{resolvePost=r;});
    return {ok:true,json:async()=>({updated:1})};
  });
  b.assistant.setChecklistAnswer(analysis,'tests','rejected');
  const first=b.sync.syncAnswerChanges();
  b.assistant.setChecklistAnswer(analysis,'tests','notRequired');
  let done=false; const second=b.sync.syncAnswerChanges().then(()=>{done=true;});
  await Promise.resolve(); assert.equal(done,false);
  resolvePost(); await Promise.all([first,second]);
  assert.equal(writes.at(-1).entries[0].state,'notRequired');
});
test('idle save does not prevent the next edit from reaching the server', async () => {
  const writes=[]; const b=browser(new Map(),async (_url,options)=>{writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true})};});
  await b.sync.syncAnswerChanges();
  b.assistant.setChecklistAnswer(analysis,'tests','rejected');
  await b.sync.syncAnswerChanges();
  assert.equal(writes.length,1); assert.equal(writes[0].entries[0].state,'rejected');
});
test('unacknowledged Pending survives offline restart and remote stale approval', async () => {
  const b=browser(); b.assistant.setChecklistAnswer(analysis,'tests','open',{note:'Pending note'});
  b.ctx.fetch=async()=>{throw Error('offline');};
  await assert.rejects(b.sync.syncAnswerChanges());
  const next=browser(b.saved,async (_url,options)=>{
    if(options.method==='POST') return {ok:true,json:async()=>({ok:true})};
    return {ok:true,json:async()=>({answers:{[key]:{state:'approved',at:'2026-10-04T09:00:00Z'}},tombstones:{}})};
  });
  await next.sync.loadShared();
  assert.equal(next.assistant._state.answers[key].state,'open');
  assert.equal(next.assistant._state.answers[key].note,'Pending note');
});
test('migrated option approval is not overridden by its removed PO record after restart', async () => {
  const b=browser();
  b.assistant._state.rules.push({id:'shared',kind:'checklist',approvalScope:'option'});
  b.assistant.setChecklistAnswer(analysis,'shared','rejected',{note:'evidence'});
  await b.sync.syncAnswerChanges();
  b.assistant.setChecklistAnswer(analysis,'shared','approved');
  assert.equal(b.assistant._state.answers['PO1::shared'].note,'evidence');
  delete b.assistant._state.answers['PO1::shared'];
  const delta=b.sync.diffAnswers({[Checklist.answerKey(analysis.orderKey,'shared')]:{state:'rejected'}},b.assistant._state.answers);
  const removed=delta.find(e=>e.orderKey==='PO1'); assert.equal(removed.deleted,true);
  const optionKey=Checklist.optionAnswerKey(analysis,'shared');
  const restarted=browser(new Map(),async()=>({ok:true,json:async()=>({answers:{[optionKey]:b.assistant._state.answers[optionKey]},tombstones:{'PO1::shared':{...removed,at:new Date().toISOString()}}})}));
  await restarted.sync.loadShared();
  assert.equal(Checklist.statusOf(analysis,'shared',{answers:restarted.assistant._state.answers,item:{approvalScope:'option',id:'shared'}}),'approved');
});
function serverRun(source) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-checklist-durable-'));
  try { return JSON.parse(execFileSync(process.execPath,['-e',asyncChildScript(`const fs=require('fs');const store=require(${JSON.stringify(path.join(ROOT,'server/lib/checklist-supplier-store'))});const actor={id:'buyer'};${source}`)],{encoding:'utf8',env:{...process.env,BUYER_LOG_SERVER_DATA_ROOT:dir,BUYER_LOG_LOCAL_DATA_ROOT:path.join(dir,'local')}})); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
test('late Pending never clears a newer decision and Pending evidence carries into next status',()=>{
  const result=serverRun(`
    await store.applyEntries([{orderKey:'P',itemId:'T',state:'rejected',at:'2026-10-04T12:00:00Z',note:'line 1\\nline 2',reportNumber:'R',attachments:[{id:'a'.repeat(32)}]}],actor);
    const late=await store.applyEntries([{orderKey:'P',itemId:'T',state:'open',at:'2026-10-04T11:00:00Z'}],actor);
    const retained=store.publicPayload().answers['P::T'];
    await store.applyEntries([{orderKey:'P',itemId:'T',state:'open',at:'2026-10-04T13:00:00Z'}],actor);
    await store.applyEntries([{orderKey:'P',itemId:'T',state:'approved',at:'2026-10-04T14:00:00Z'}],actor);
    process.stdout.write(JSON.stringify({late,retained,final:store.publicPayload().answers['P::T']}));
  `);
  assert.equal(result.retained.state,'rejected');
  assert.equal(result.late.skipped,1);
  assert.equal(result.final.reportNumber,'R');
  assert.equal(result.final.note,'line 1\nline 2');
  assert.equal(result.final.attachments.length,1);
});
test('corrupt existing store is never replaced with an empty successful save',()=>{
  const result=serverRun(`fs.mkdirSync(require('path').dirname(store.FILE),{recursive:true});fs.writeFileSync(store.FILE,'BROKEN');let error;try{await store.applyEntries([{orderKey:'P',itemId:'T',state:'approved'}],actor);}catch(e){error=e.code;}process.stdout.write(JSON.stringify({error,bytes:fs.readFileSync(store.FILE,'utf8')}));`);
  assert.equal(result.error,'CHECKLIST_STORE_UNREADABLE');assert.equal(result.bytes,'BROKEN');
});
test('last-good recovery restores statuses and all evidence after file corruption',()=>{
  const result=serverRun(`await store.applyEntries([{orderKey:'P',itemId:'T',state:'rejected',note:'keep',reportNumber:'R'}],actor);fs.writeFileSync(store.FILE,'BROKEN');process.stdout.write(JSON.stringify(store.publicPayload().answers['P::T']));`);
  assert.equal(result.state,'rejected');assert.equal(result.note,'keep');assert.equal(result.reportNumber,'R');
});
test('retry of an acknowledged Pending whose response was lost remains successful',()=>{
  const result=serverRun(`const entry={orderKey:'P',itemId:'T',state:'open',at:'2026-10-04T12:00:00Z',note:'keep'};await store.applyEntries([entry],actor);const retry=await store.applyEntries([entry],actor);process.stdout.write(JSON.stringify({retry,pending:store.publicPayload().tombstones['P::T']}));`);
  assert.equal(result.retry.skipped,0);assert.equal(result.retry.cleared,1);assert.equal(result.pending.note,'keep');
});
test('one conflict does not starve subsequent batches and a new choice handles server clock skew', async()=>{
  const written=[]; const future='2099-01-01T00:00:00.000Z';
  const b=browser(new Map(),async (_url,options)=>{
    const entries=JSON.parse(options.body).entries;
    const accepted=entries.filter(e=>e.orderKey!=='PO1'||e.at>future).map(e=>e.orderKey+'::'+e.itemId);
    written.push(...accepted);
    return {ok:true,json:async()=>({ok:true,changedKeys:accepted,skipped:entries.length-accepted.length,rejectedAt:{[key]:future}})};
  });
  for(let i=1;i<=205;i++) b.assistant.setChecklistAnswer({...analysis,orderKey:'PO'+i},'tests','rejected');
  await assert.rejects(b.sync.syncAnswerChanges(),/newer checklist/);
  assert.equal(written.length,204);
  assert.equal(Object.keys(b.sync._state.pendingAnswers).length,1);
  b.assistant.setChecklistAnswer(analysis,'tests','approved');
  await b.sync.syncAnswerChanges();
  assert.equal(Object.keys(b.sync._state.pendingAnswers).length,0);
  assert.equal(written.at(-1),key);
});
test('a corrupt browser answer store is preserved until authoritative recovery',async()=>{
  const saved=new Map([['lcw.cp.checklist.v1','BROKEN']]);
  const b=browser(saved);
  b.assistant.setChecklistAnswer(analysis,'tests','rejected');
  assert.equal(saved.get('lcw.cp.checklist.v1'),'BROKEN');
  await b.sync.loadShared();
  assert.equal(saved.get('user.lcw.cp.checklist.recovery.v1'),'BROKEN');
  assert.equal(JSON.parse(saved.get('lcw.cp.checklist.v1'))[key].state,'rejected');
});
test('server refuses excess or malformed attachments without truncating existing evidence',()=>{
  const result=serverRun(`await store.applyEntries([{orderKey:'P',itemId:'T',state:'rejected',attachments:[{id:'a'.repeat(32)}]}],actor);const codes=[];for(const attachments of [Array.from({length:41},()=>({id:'b'.repeat(32)})),[{id:'bad'}]]){try{await store.applyEntries([{orderKey:'P',itemId:'T',state:'approved',attachments}],actor);}catch(e){codes.push(e.code);}}process.stdout.write(JSON.stringify({codes,answer:store.publicPayload().answers['P::T']}));`);
  assert.deepEqual(result.codes,['CHECKLIST_EVIDENCE_INVALID','CHECKLIST_EVIDENCE_INVALID']);
  assert.equal(result.answer.state,'rejected');assert.equal(result.answer.attachments[0].id,'a'.repeat(32));
});

test('supplier Excel updates preserve server PDFs and multiline notes without a local attachment mirror',()=>{
  const result=serverRun(`await store.applyEntries([{orderKey:'P',itemId:'T',state:'rejected',at:'2026-10-04T10:00:00Z',attachments:[{id:'a'.repeat(32)}]}],actor);await store.applyEntries([{orderKey:'P',itemId:'T',state:'approved',at:'2026-10-04T12:00:00Z',baseAt:'2026-10-04T11:00:00Z',note:'line 1\\nline 2'}],actor,{source:'supplier_excel'});process.stdout.write(JSON.stringify(store.publicPayload().answers['P::T']));`);
  assert.equal(result.attachments.length,1);
  assert.equal(result.note,'line 1\nline 2');
  const source=fs.readFileSync(path.join(ROOT,'public/checklist-supplier-sync.js'),'utf8');
  const importer=source.slice(source.indexOf('async function importWorkbook('),source.indexOf('function importButton',source.indexOf('async function importWorkbook(')));
  assert.doesNotMatch(importer,/attachments: existing/,'Excel must not overwrite authoritative attachments using a stale local mirror');
});
test('option migration retains each PO evidence and never overwrites a newer Pending decision',()=>{
  const b=browser(); const one={...analysis,orderKey:'PO1',daysToLoad:1,stage:'PRODUCTION'};
  const two={...one,orderKey:'PO2'};
  b.assistant._state.rules=[Rules.normalizeRule({id:'shared',kind:'checklist',approvalScope:'option',name:'Shared',conditions:[{field:'@daysToLoad',operator:'lte',value:60}],expressionVersion:Rules.EXPRESSION_VERSION})];
  const option=Checklist.optionAnswerKey(one,'shared');
  b.assistant._state.answers={
    'PO1::shared':{state:'approved',at:'2026-10-01T10:00:00Z',loadDate:19000,note:'PO1 note',attachments:[{id:'a'.repeat(32)}]},
    'PO2::shared':{state:'approved',at:'2026-10-01T11:00:00Z',loadDate:19000,note:'PO2 note',attachments:[{id:'b'.repeat(32)}]},
    [option]:{state:'open',at:'2026-10-04T12:00:00Z',note:'newer Pending'},
  };
  b.assistant.computeDecisionsForRows([one,two]);
  assert.equal(b.assistant._state.answers[option].state,'open');
  assert.equal(b.assistant._state.answers['PO1::shared'].note,'PO1 note');
  assert.equal(b.assistant._state.answers['PO2::shared'].attachments[0].id,'b'.repeat(32));
  delete b.assistant._state.answers[option];
  b.assistant.persistChecklistAnswers();
  b.assistant.computeDecisionsForRows([one,two]);
  const revision=b.assistant.decisionContextRevision();
  b.assistant.computeDecisionsForRows([one,two]);
  assert.equal(b.assistant.decisionContextRevision(),revision,'unchanged migration must not render/save recursively');
  assert.equal(b.assistant._state.answers[option].state,'approved');
  assert.equal(b.assistant._state.answers['PO1::shared'].attachments.length,1);
});

test('unreadable preferences and rules cannot be replaced by defaults or shared adoption',()=>{
  for(const damagedKey of ['lcw.cp.assistant.v1','lcw.cp.rules.checklist.v1']) {
    const saved=new Map([[damagedKey,'BROKEN']]);
    const b=browser(saved);
    assert.throws(()=>b.assistant.adoptSharedChecklistDefinitions([]),/Okunamayan|unreadable/);
    assert.equal(saved.get(damagedKey),'BROKEN');
    assert.equal(saved.has('lcw.cp.rules.priority.v1'),false,'preflight must prevent partial overwrites');
  }
  const rule=Rules.normalizeRule({id:'kept',name:'Kept',kind:'checklist',approvalScope:'order',expressionVersion:Rules.EXPRESSION_VERSION});
  const b=browser(new Map([['lcw.cp.assistant.v1','BROKEN'],['lcw.cp.rules.checklist.v1',JSON.stringify({version:2,rules:[rule]})]]));
  assert.ok(b.assistant._state.rules.some(r=>r.id==='kept'),'independent rules still load when preferences are damaged');
});

test('failed rule migration retains legacy custom Checklist definitions for restart',()=>{
  const legacy=JSON.stringify({rules:[{id:'legacy',name:'Legacy',kind:'checklist',builtIn:false}]});
  const saved=new Map([['lcw.cp.assistant.v1',legacy]]);
  const set=saved.set.bind(saved);
  saved.set=(k,v)=>{if(k==='lcw.cp.rules.checklist.v1')throw Error('storage full');return set(k,v);};
  const b=browser(saved);
  assert.ok(b.assistant._state.rules.some(r=>r.id==='legacy'));
  assert.equal(saved.get('lcw.cp.assistant.v1'),legacy,'failed migration must keep its source');
  assert.ok(browser(saved).assistant._state.rules.some(r=>r.id==='legacy'));
});

test('damaged settings cannot block authoritative status and PDF recovery',async()=>{
  for(const damagedKey of ['lcw.cp.assistant.v1','lcw.cp.rules.priority.v1','lcw.cp.rules.checklist.v1']) {
    const saved=new Map([[damagedKey,'BROKEN']]);
    const remote={state:'rejected',at:'2026-10-04T12:00:00Z',note:'Remote note',attachments:[{id:'a'.repeat(32)}]};
    const b=browser(saved,async()=>({ok:true,json:async()=>({definitions:[],answers:{[key]:remote},tombstones:{}})}));
    assert.ok(await b.sync.loadShared());
    assert.equal(b.assistant._state.answers[key].state,'rejected');
    b.assistant.setChecklistAnswer(analysis,'tests','approved');
    assert.equal(b.assistant._state.answers[key].attachments.length,1);
    assert.equal(b.assistant._state.answers[key].note,'Remote note');
    assert.equal(saved.get(damagedKey),'BROKEN');
  }
});

test('malformed rule metadata is preserved rather than replaced with defaults',()=>{
  for(const damagedKey of ['lcw.cp.assistant.v1','lcw.cp.rules.checklist.v1']) {
    const raw=JSON.stringify({rules:[{id:'custom',kind:'checklist',name:'Saved custom'}],deletedRuleIds:123});
    const saved=new Map([[damagedKey,raw]]);
    const b=browser(saved);
    assert.throws(()=>b.assistant.adoptSharedChecklistDefinitions([]),/Okunamayan|unreadable/);
    assert.equal(saved.get(damagedKey),raw);
  }
});

test('Collection Checklist selections are journalled immediately and restored after an offline restart',()=>{
  const source=fs.readFileSync(path.join(ROOT,'public/app-main.js'),'utf8');
  const fn=name=>{
    const start=source.indexOf('function '+name+'(');
    const end=source.indexOf('\nfunction ',start+1);
    return source.slice(start,end<0?source.length:end);
  };
  const saved=new Map();let started=0;
  const ctx={Date,JSON,Set,localStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)||null},
    BLStorage:{setItem:(k,v)=>saved.set(k,v)},kolRows:[{id:1}],kolCustomCols:[{k:'check',checklist:true}],
    KOL_CHECKLIST_STATUSES:['open','approved','rejected','notRequired'],KOL_STORAGE_KEY:'rows',
    kolWorkspaceCanEdit:true,kolWorkspaceOwnerId:'buyer',kolWorkspaceRevision:1,kolNextId:2,
    kolManufacturers:[],kolSelected:new Set(),kolWorkspaceSaving:false,kolHiddenCols:new Set(),appLang:'en',
    kolRequireWorkspaceEdit:()=>true,kolChecklistColumns:()=>ctx.kolCustomCols,
    kolCellLinkedToModel:()=>false,kolEffectiveValue:(r,k)=>r[k],kolPushUndo:()=>{},
    kolWriteGroupedStorageValue:(r,k,v)=>{r[k]=v;},kolNormalizeModelGroups:r=>r,kolPersistableRow:r=>({...r}),
    kolManufacturersForPersistence:()=>[],kolStatusEntries:()=>[],kolQueueWorkspaceSave:()=>{},
    kolSaveWorkspaceNow:async()=>{started++;return {ok:false,pending:true};},renderKol:()=>{},scheduleOverviewCollectionSummaryRender:()=>{},
    migrateKolRow:r=>({...r}),kolNormalizeStatusCatalog:()=>[],kolNormalizeCustomCols:c=>c,refreshSubmfrList:()=>{},loadKolColState:()=>{},
    kolHasDirtyWorkspace:()=>true,showToast:()=>{},
  };
  vm.createContext(ctx);
  for(const name of ['kolChecklistStatus','kolSetChecklistStatus','kolWorkspaceLocalKey','kolWorkspacePendingKey','kolPersistPendingWorkspace','kolReadPendingWorkspace','kolClearPendingWorkspace','kolRestorePendingWorkspace','saveKolRows'])vm.runInContext(fn(name),ctx);
  for(const status of ['rejected','approved','notRequired','open']) {
    assert.equal(ctx.kolSetChecklistStatus(1,'check',status),true);
    assert.equal(ctx.kolChecklistStatus(JSON.parse(saved.get('bl.collection.pending.buyer.v1')).rows[0].check),status);
    ctx.kolRows=[{id:1,check:'approved'}];
    assert.equal(ctx.kolRestorePendingWorkspace(),true);
    assert.equal(ctx.kolChecklistStatus(ctx.kolRows[0].check),status);
  }
  assert.equal(started,4,'each changed selection starts the server save immediately');
});
