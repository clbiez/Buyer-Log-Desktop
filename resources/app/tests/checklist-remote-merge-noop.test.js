'use strict';
// Loading the shared checklist store merged identical remote answers and still
// rewrote them, which raised a decision-context change and recomputed every CP
// decision (~6 s on 24,982 synthetic rows at each CP start). Identical content
// cannot change a decision, so it is neither rewritten nor announced. A changed
// merge and the recovery of an unreadable local record still persist.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const Checklist=require('../public/cp-checklist-engine'),Rules=require('../public/cp-rules-engine');
const ANSWERS_KEY='lcw.cp.checklist.v1';

function browser(saved,remote){
  const listeners=new Map(),events=[],writes=[];
  const storage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>{writes.push(k);saved.set(k,String(v));},removeItem:k=>saved.delete(k)};
  const ctx={console,Map,Set,WeakMap,Date,JSON,Blob,Promise,localStorage:storage,
    BLStorage:{...storage,actualKey:k=>'user.'+k,native:storage},BL_USER_CONTEXT:{id:'buyer'},
    BLCpChecklistEngine:Checklist,BLCpRulesEngine:Rules,
    BLCpReadinessEngine:{analyzeOrder:row=>row,summarizeAnalyses:orders=>({orders}),recount:model=>model},
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),
    document:{documentElement:{lang:'en'},querySelector:()=>null,getElementById:()=>null},
    fetch:async(url,options)=>({ok:true,json:async()=>options&&options.method==='POST'?{ok:true}:remote()}),
    setTimeout:()=>0,clearTimeout:()=>{},
    CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},
    addEventListener:(name,f)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(f);},
    dispatchEvent:e=>{events.push(e.type+':'+(e.detail&&e.detail.reason||''));(listeners.get(e.type)||[]).forEach(f=>f(e));},showToast:()=>{},
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  for(const file of ['cp-overview-assistant.js','checklist-answer-merge-engine.js','checklist-supplier-sync.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT,'public',file),'utf8'),ctx);
  return {assistant:ctx.BLCpAssistant,sync:ctx.BLChecklistSupplierSync,events,writes};
}
const answer={state:'approved',at:'2026-10-04T10:00:00.000Z',by:'buyer'};
const answerEvents=events=>events.filter(name=>name==='bl:cp-decision-context-changed:checklist-answer');

test('identical shared answers are not rewritten and do not recompute CP decisions',async()=>{
  const saved=new Map([[ANSWERS_KEY,JSON.stringify({'PO1::tests':answer})]]);
  const b=browser(saved,()=>({definitions:[],answers:{'PO1::tests':answer},tombstones:{}}));
  assert.deepEqual(b.assistant._state.answers,{'PO1::tests':answer});
  b.events.length=0;b.writes.length=0;
  await b.sync.loadShared(true);
  assert.deepEqual(answerEvents(b.events),[],'unchanged answers must not announce a decision change');
  assert.ok(!b.writes.includes(ANSWERS_KEY),'unchanged answers must not be rewritten');
  assert.deepEqual(b.assistant._state.answers,{'PO1::tests':answer});
});

test('a newer shared answer is still merged, persisted and announced',async()=>{
  const saved=new Map([[ANSWERS_KEY,JSON.stringify({'PO1::tests':answer})]]);
  const newer={state:'rejected',at:'2026-10-05T10:00:00.000Z',by:'other'};
  const b=browser(saved,()=>({definitions:[],answers:{'PO1::tests':newer},tombstones:{}}));
  b.events.length=0;b.writes.length=0;
  await b.sync.loadShared(true);
  assert.equal(b.assistant._state.answers['PO1::tests'].state,'rejected');
  assert.equal(answerEvents(b.events).length,1);
  assert.equal(JSON.parse(saved.get(ANSWERS_KEY))['PO1::tests'].state,'rejected');
});

test('an unreadable local record is still recovered even when shared content matches',async()=>{
  const saved=new Map([[ANSWERS_KEY,'BROKEN']]);
  const b=browser(saved,()=>({definitions:[],answers:{},tombstones:{}}));
  assert.equal(b.assistant._state.answerStoreError,true);
  await b.sync.loadShared(true);
  assert.equal(b.assistant._state.answerStoreError,false,'recovery path must still run');
  assert.equal(saved.get('user.lcw.cp.checklist.recovery.v1'),'BROKEN','the unreadable record is preserved for recovery');
  assert.equal(saved.get(ANSWERS_KEY),'{}');
});
