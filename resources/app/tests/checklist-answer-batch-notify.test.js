'use strict';
// Bulk checklist actions called setChecklistAnswer once per target and every
// call announced a decision-context change, which recomputed every CP decision
// and checklist column (~7.6 s per answer on 24,982 synthetic rows). Answers are
// still saved one by one with the same return value; the announcement is
// coalesced into one at the end of the batch, also when the batch throws.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const Checklist=require('../public/cp-checklist-engine'),Rules=require('../public/cp-rules-engine');
const ANSWERS_KEY='lcw.cp.checklist.v1';

function browser(){
  const saved=new Map(),listeners=new Map(),events=[],writes=[];
  const storage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>{writes.push(k);saved.set(k,String(v));},removeItem:k=>saved.delete(k)};
  const ctx={console,Map,Set,WeakMap,Date,JSON,Blob,Promise,localStorage:storage,
    BLStorage:{...storage,actualKey:k=>'user.'+k,native:storage},BL_USER_CONTEXT:{id:'buyer'},
    BLCpChecklistEngine:Checklist,BLCpRulesEngine:Rules,
    BLCpReadinessEngine:{analyzeOrder:row=>row,summarizeAnalyses:orders=>({orders}),recount:model=>model},
    BLCpDecisionRuntime:require('../public/cp-decision-runtime'),
    document:{documentElement:{lang:'en'},querySelector:()=>null,getElementById:()=>null},
    fetch:async()=>({ok:true,json:async()=>({answers:{},tombstones:{}})}),setTimeout:()=>0,clearTimeout:()=>{},
    CustomEvent:class{constructor(type,props){this.type=type;Object.assign(this,props);}},
    addEventListener:(name,f)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(f);},
    dispatchEvent:e=>{events.push(e.detail&&e.detail.reason||'');(listeners.get(e.type)||[]).forEach(f=>f(e));},showToast:()=>{},
  };
  ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public/cp-overview-assistant.js'),'utf8'),ctx);
  return {assistant:ctx.BLCpAssistant,events,writes,saved};
}
const analysis=code=>({orderKey:'PO'+code,plannedLoadDate:21000,plmId:String(code),modelName:'Demo',colourCode:'001'});
const answerEvents=events=>events.filter(reason=>reason==='checklist-answer').length;

test('a batch saves every answer but announces one decision change', () => {
  const b=browser();b.events.length=0;b.writes.length=0;
  const results=b.assistant.batchChecklistAnswers(()=>[1,2,3,4,5].map(code=>b.assistant.setChecklistAnswer(analysis(code),'tests','approved')));
  assert.deepEqual(results,[true,true,true,true,true],'each call keeps its own saved result');
  assert.equal(answerEvents(b.events),1);
  assert.equal(b.writes.filter(key=>key===ANSWERS_KEY).length,5,'answers are still persisted one by one');
  const stored=JSON.parse(b.saved.get(ANSWERS_KEY));
  for(const code of [1,2,3,4,5])assert.equal(stored['PO'+code+'::tests'].state,'approved');
});

test('a failing batch keeps applied answers and still announces once', () => {
  const b=browser();b.events.length=0;
  assert.throws(()=>b.assistant.batchChecklistAnswers(()=>{
    b.assistant.setChecklistAnswer(analysis(1),'tests','rejected');
    b.assistant.setChecklistAnswer(analysis(2),'tests','rejected');
    throw new Error('stop');
  }),/stop/);
  assert.equal(answerEvents(b.events),1);
  assert.equal(b.assistant._state.answers['PO1::tests'].state,'rejected');
  assert.equal(b.assistant._state.answers['PO2::tests'].state,'rejected');
});

test('outside a batch every answer is announced immediately, and nested batches announce once', () => {
  const b=browser();b.events.length=0;
  b.assistant.setChecklistAnswer(analysis(1),'tests','approved');
  assert.equal(answerEvents(b.events),1);
  b.assistant.batchChecklistAnswers(()=>{
    b.assistant.batchChecklistAnswers(()=>b.assistant.setChecklistAnswer(analysis(2),'tests','approved'));
    assert.equal(answerEvents(b.events),1,'inner batch end must not announce');
    b.assistant.setChecklistAnswer(analysis(3),'tests','approved');
  });
  assert.equal(answerEvents(b.events),2);
  // A batch without answer changes announces nothing.
  b.assistant.batchChecklistAnswers(()=>{});
  assert.equal(answerEvents(b.events),2);
});
