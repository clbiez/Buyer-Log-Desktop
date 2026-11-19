'use strict';
/* WS2b (#1075): Akış Haritası istemci yolu. DOM'a bağlı dosyanın ilgili
   fonksiyonları kaynaktan çıkarılıp stub'lı vm bağlamında çalıştırılır. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','overview-global-flow.js'),'utf8');

function fn(name){
  const start=SOURCE.search(new RegExp(`\\n(async )?function ${name}\\(`));assert.ok(start>=0,name);
  const end=SOURCE.indexOf('\n}\n',start);return SOURCE.slice(start+1,end+3);
}
function harness({flag,stored,lang='tr'}={}){
  const calls={fetch:[],hydrate:0,legacy:0,engine:0};
  let priority='r1';
  const storage=new Map(stored?[['buyerlog.readModel.globalFlow',stored]]:[]);
  const context={
    window:{BL_READ_MODEL_GLOBAL_FLOW:flag,BLBacklogRows:{loadData:async()=>{calls.legacy++;return {rows:[{a:1}],sourceRevision:'s'};},invalidate(){}}},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null},
    state:{readModelBase:null,lastBacklogRows:null,lastBacklogSignature:''},
    READ_MODEL_VERSION:1,JSON,Promise,Error,Array,String,L:(tr,en)=>lang==='en'?en:tr,isEn:()=>lang==='en',
    backlogExportQueryParams:()=>({format:'json',lazyDimensions:'1',includeSourceDetails:'1',groupBy:'season'}),
    cpPriorityIndexApi:()=>({revision:()=>priority}),
    ensureDecisionEngine:async()=>{calls.engine++;return true;},
    backlogSignature:()=> 'sig|p:'+priority,
    shipmentPartialsFromRows:rows=>rows.map(row=>({legacy:true,...row})),
    hydrateReadModelRecords:payload=>{calls.hydrate++;return payload.rows.map(row=>({row,priority}));},
    fetch:async(url,options)=>{calls.fetch.push({url,options,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({version:1,rows:[[1],[2]]})};},
  };
  vm.createContext(context);
  vm.runInContext(['READ_MODEL_FLAG_KEY','readModelEnabled','fetchReadModelRecords','readModelBacklogPartials','backlogPartials']
    .map(name=>name==='READ_MODEL_FLAG_KEY'?SOURCE.match(/const READ_MODEL_FLAG_KEY=[^\n]*\n/)[0]:fn(name)).join('\n')+'\nthis.backlogPartials=backlogPartials;',context);
  return {run:force=>context.backlogPartials(force),calls,setPriority:value=>{priority=value;},context};
}

test('anahtar açık: Backlog kayıtları arka uç modelinden gelir, istek GET ile aynı sorguyu taşır',async()=>{
  const h=harness();
  const records=await h.run(false);
  assert.equal(records.length,2);assert.equal(h.calls.legacy,0);assert.equal(h.calls.fetch.length,1);
  const call=h.calls.fetch[0];
  assert.equal(call.url,'/api/read-model/global-flow/model');assert.equal(call.options.method,'POST');assert.equal(call.options.credentials,'same-origin');
  assert.deepEqual(call.body,{version:1,source:'backlog',query:{format:'json',lazyDimensions:'1',groupBy:'season',projection:'global-flow'}});
});

test('öncelik dizini değişince veri yeniden indirilmez; yalnız hidrasyon tekrarlanır. Aynı girdide aynı dizi döner',async()=>{
  const h=harness();
  const first=await h.run(false),same=await h.run(false);
  assert.equal(same,first,'aynı sorgu + aynı öncelik revizyonu → aynı kayıt dizisi (harita modeli yeniden kurulmaz)');
  assert.equal(h.calls.fetch.length,1);assert.equal(h.calls.hydrate,1);
  h.setPriority('r2');
  const rehydrated=await h.run(false);
  assert.notEqual(rehydrated,first);assert.equal(rehydrated[0].priority,'r2');
  assert.equal(h.calls.fetch.length,1,'öncelik değişimi arka uca gitmez');assert.equal(h.calls.hydrate,2);
  await h.run(true);assert.equal(h.calls.fetch.length,2,'elle yenileme veriyi yeniden ister');
});

test('anahtar kapalı (localStorage veya window): eski istemci normalleştirmesi çalışır',async()=>{
  for(const h of [harness({stored:'off'}),harness({flag:false})]){
    const records=await h.run(false);
    assert.equal(h.calls.fetch.length,0);assert.equal(h.calls.legacy,1);assert.equal(records[0].legacy,true);
  }
});

test('arka uç hatası kullanıcıya TR/EN iletilir (sessizce boş harita çizilmez)',async()=>{
  const h=harness();
  h.context.fetch=async()=>({ok:false,status:409,json:async()=>({error:'Kaynak filtresi gerekli.',code:'SOURCE_FILTER_REQUIRED'})});
  await assert.rejects(h.run(false),/Kaynak filtresi gerekli\. \(HTTP 409 · SOURCE_FILTER_REQUIRED\)/);
  const en=harness({lang:'en'});
  en.context.fetch=async()=>({ok:false,status:500,json:async()=>({error:'Harita okuma modeli hazırlanamadı.'})});
  await assert.rejects(en.run(false),/Map data could not be prepared\. \(HTTP 500\)/);
});

test('refresh: girdiler aynıysa harita modeli yeniden kurulmaz; gün değişimi ve elle yenileme yeniden kurar',()=>{
  const refresh=fn('refresh');
  assert.match(refresh,/unchanged=!force&&Boolean\(state\.model\)&&results\[0\]===state\.records&&results\[1\]===state\.modelRules&&day===state\.modelDay/);
  assert.match(refresh,/if\(!unchanged\)applyFilters\(\);/);
  assert.match(refresh,/if\(!unchanged\)hydrateFilterValidity\(\);/);
  // Görünmeyen/daraltılmış harita veri çekmez (lazy davranış korunur).
  assert.match(refresh,/if\(!force&&!isLive\(\)\)\{state\.dirty=true;return;\}/);
});
