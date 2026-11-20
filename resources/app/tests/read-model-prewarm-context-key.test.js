'use strict';
// #1077 entegrasyon — açılışta Genel Bakış tam modeli (~8 sn) tekrar hesaplanıyordu: bağlam
// anahtarı kullanıcının TÜM tercihlerini özetliyordu; CP tablosu açılınca yazılan
// 'lcw.table.columnState.v1' anahtarı değiştiriyordu [sunucu günlüğüyle doğrulandı].
// Anahtar artık karar barındırıcısına giden girdilerin içeriğinden + revision(profile)'dan üretilir.
const test=require('node:test'),assert=require('node:assert/strict');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const Merge=require('../public/checklist-answer-merge-engine');

function harness(){
  const state={personal:{},roles:{},rules:{rules:[],revision:1},plm:{rows:[]},answers:{},transit:[],revision:['cal-1',2026,10,20]};
  const load=createContextLoader({
    preferences:{load:()=>({entries:state.personal})},roleEntries:()=>state.roles,managedRules:()=>state.rules,
    transitRules:()=>state.transit,plmPayload:()=>state.plm,checklistPayload:()=>({answers:state.answers,tombstones:{}}),
    revision:()=>state.revision,merge:(own,shared)=>Merge.merge(own,shared),
  });
  return {state,key:()=>load({id:'u1'}).key,value:()=>load({id:'u1'}).value};
}

test('preferences outside the CP decision do not change the context key',()=>{
  const h=harness();h.state.personal['lcw.cp.rules.v1']={value:'{"a":1}'};
  const before=h.key();
  for(const [name,value] of [['lcw.table.columnState.v1','{"cp":{"hidden":["X"]}}'],['lcw_theme','dark'],['lcw.lang.v1','en'],['buyerlog.overview.layout.v1','[1,2]']])h.state.personal[name]={value};
  h.state.roles['lcw.freeze.v1']={value:'{}'};
  assert.equal(h.key(),before,'unrelated preference writes keep the Overview model and decision host cached');
  assert.equal(typeof before,'string');assert.match(before,/^[0-9a-f]{64}$/);
});

test('every decision input still changes the key',()=>{
  const h=harness(),seen=new Set([h.key()]);
  const changes=[
    ()=>{h.state.personal['lcw.cp.assistant.v1']={value:'{"x":1}'};},
    ()=>{h.state.roles['lcw.cp.rules.v1']={value:'{"role":1}'};},
    ()=>{h.state.personal['lcw.cp.checklist.v1']={value:JSON.stringify({'O1::q':{state:'approved',at:'2026-11-20T00:00:00.000Z'}})};},
    ()=>{h.state.answers={'O2::q':{state:'rejected',at:'2026-11-20T00:00:00.000Z'}};},
    ()=>{h.state.rules={rules:[{id:'r'}],revision:2};},
    ()=>{h.state.plm={rows:[{id:1}]};},
    ()=>{h.state.transit=[{id:'t'}];},
    ()=>{h.state.revision=['cal-2',2026,10,20];},
    ()=>{h.state.revision=['cal-2',2026,10,21];},
  ];
  for(const [index,change] of changes.entries()){change();const key=h.key();assert.ok(!seen.has(key),`change ${index} must produce a new key`);seen.add(key);}
  // Değer, barındırıcıya giden girdinin aynısıdır (anahtarla birlikte üretilir).
  assert.deepEqual(Object.keys(h.value()).sort(),['answers','entries','managedRules','plm','transitRules','userId']);
});
