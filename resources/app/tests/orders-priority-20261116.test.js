'use strict';
/* Siparişler (Orders) önceliği: CP ile aynı kurallar, checklist HARİÇ, worker'da.
   Ölçüm gerekçesi: 50k satır + 20 kural ana iş parçacığında 4,6 sn tek uzun
   görev üretiyordu; hesap worker'a taşındı. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const OD=require('../public/order-decision-engine.js');
const Rules=require('../public/cp-rules-engine.js');
const CP=require('../public/cp-readiness-engine.js');
const Engine=require('../public/orders-priority-engine.js');
const canonical=require('../public/canonical-fields.js');
const {loadAppMainFunctions}=require('./helpers/app-main-functions');
const read=name=>fs.readFileSync(path.join(__dirname,'..','public',name),'utf8');
const day=offset=>new Date(Date.now()+offset*864e5).toISOString().slice(0,10);
const row=(over={})=>({'Order Code':'1','Model Name':'M','C.Code':'01','STATUS':'Production','Ex-factory':day(5),'Retail Date':day(60),'Del. Type':'SEA','Order Quantity':100,'Remaining Units':100,'Season':'S7',...over});
const CATALOG=[{id:'CRITICAL'},{id:'prio:yakin-yukleme',tr:'Yakın yükleme',en:'Near loading',tone:'red'},{id:'prio:s7-takip',tr:'S7 takibi',en:'S7 watch',tone:'teal',usage:'tracking'},{id:'ACTION_TODAY'},{id:'ACTION_THIS_WEEK'},{id:'WATCH'},{id:'ON_TRACK'}];
const custom=[
  Rules.normalizeRule({id:'near',kind:'priority',enabled:true,target:'prio:yakin-yukleme',name:'Yakın',conditions:[{field:'@daysToLoad',operator:'lte',value:7}]},{kind:'priority',priorityCatalog:CATALOG}),
  Rules.normalizeRule({id:'s7',kind:'priority',enabled:true,target:'prio:s7-takip',name:'S7',mode:'formula',formula:'=[Season]="S7"'},{kind:'priority',priorityCatalog:CATALOG}),
];
test.after(()=>OD.setPriorityCatalog(null));

test('checklist kuralları Siparişler’de tetiklenmez; CP’de tetiklenir',()=>{
  const r=row();
  const cp=Rules.evaluateOrder(CP.analyzeOrder(r,{}),{rules:Rules.DEFAULT_RULES,answers:{},checklistEnabled:true});
  assert.equal(cp.priority,'ACTION_THIS_WEEK','CP: cevapsız checklist aksiyon üretir');
  assert.deepEqual(Engine.createSession({rules:Rules.DEFAULT_RULES}).evaluateRow(r),{priority:'ON_TRACK',trackingTags:[]},'Siparişler: checklist yok');
});

test('checklist’ten bağımsız kurallar ve takip etiketleri Siparişler’de CP ile aynıdır',()=>{
  const session=Engine.createSession({rules:[...Rules.DEFAULT_RULES,...custom],priorityCatalog:CATALOG});
  assert.deepEqual(session.evaluateRow(row()),{priority:'prio:yakin-yukleme',trackingTags:['prio:s7-takip']});
  assert.deepEqual(session.evaluateRow(row({'Ex-factory':day(40),Season:'W7'})),{priority:'ON_TRACK',trackingTags:[]});
  const batch=session.evaluateBatch([row(),row({'Ex-factory':day(40),Season:'W7'}),null]);
  assert.deepEqual(batch.codes,['prio:yakin-yukleme','ON_TRACK','']);
  assert.deepEqual(batch.tags,[['prio:s7-takip'],null,null],'etiketsiz satır null (az veri)');
  assert.equal(session.ruleCount,Rules.DEFAULT_PRIORITY_RULES.length+2,'checklist kuralları oturuma alınmaz');
});

test('worker yoksa aynı motor zaman dilimli çalışır ve iptal edilebilir',async()=>{
  globalThis.BLOrdersPriorityEngine=Engine;
  delete require.cache[require.resolve('../public/orders-priority.js')];
  const Runner=require('../public/orders-priority.js');
  const rows=Array.from({length:50},(_,i)=>row({'Order Code':String(i),'Ex-factory':day(i%2?5:40)}));
  const spec={rules:custom,priorityCatalog:CATALOG};
  const out=await Runner.run(rows,spec,{forceFallback:true});
  assert.equal(out.mode,'fallback');
  assert.deepEqual(out.codes,rows.map((_,i)=>i%2?'prio:yakin-yukleme':'ON_TRACK'));
  await assert.rejects(Runner.run(rows,spec,{forceFallback:true,isCurrent:()=>false}),/ORDERS_PRIORITY_CANCELLED/,'eski sonuç dönmez');
  delete globalThis.BLOrdersPriorityEngine;
});

test('worker motor zincirinin tamamını yükler ve tembel özellik listesinde yer alır',()=>{
  const worker=read('orders-priority-worker.js');
  for(const file of ['canonical-fields.js','order-decision-engine.js','cp-readiness-engine.js','checklist-components-engine.js','cp-checklist-engine.js','cp-rules-engine.js','orders-priority-engine.js']){
    assert.match(worker,new RegExp(`'${file.replace('.','\\.')}'`),file);
    assert.ok(fs.existsSync(path.join(__dirname,'..','public',file)),file);
  }
  assert.doesNotMatch(worker,/fetch\(|localStorage|indexedDB|XMLHttpRequest/,'worker ağ/depolama kullanmaz');
  assert.match(read('perf-runtime.js'),/'orders-priority-engine\.js','orders-priority\.js'/);
  assert.match(read('orders-priority.js'),/new root\.Worker\('orders-priority-worker\.js'\)/);
});

test('ortak dizin önce CP, yoksa Siparişler (kaynak işaretli) kullanır',()=>{
  const dayStr=new Date().toDateString();
  const cpRows=[{'Order Code':'1001','Model Name':'M','C.Code':'01',Priority:'CRITICAL',_trackingTags:[]}];
  const orderRows=[
    {'Order Code':'1001','Model Name':'M','C.Code':'01',Priority:'ON_TRACK',_trackingTags:[]},
    {'Order Code':'2002','Model Name':'X','C.Code':'05',Priority:'prio:yakin-yukleme',_trackingTags:['prio:s7-takip']},
  ];
  const state={cp:{rows:cpRows},orders:{rows:orderRows}};
  const api=loadAppMainFunctions(['cpPriorityIdentityPart','cpPriorityIdentity','cpPriorityHeaderKey','cpPriorityIndexReady','priorityIndexFromRows','buildCpPriorityIndex','buildOrdersPriorityIndex','lookupPriorityIn','lookupCpPriority','ordersPriorityReady','ordersPriorityContextKey','ordersPriorityContext','actionPriorityCode','norm'],{
    window:{BLOrderDecisionEngine:OD,BLCanonicalFields:canonical,BLCpAssistant:{ordersPriorityContext:()=>({key:'k1',spec:{}})}},state,
    _unifiedPriorityCache:{cp:{rows:cpRows,day:dayStr}},_unifiedPriorityTableRevision:{cp:1,orders:3},
    _ordersPriority:{stamp:{rows:orderRows,dataRevision:3,day:dayStr,key:'k1'}},
    _cpPriorityIndex:null,_ordersPriorityIndex:null,_ordersPriorityContextKey:null,_cpPriorityIdentityCache:new Map(),
  });
  OD.setPriorityCatalog(CATALOG);
  assert.equal(JSON.stringify(api.lookupCpPriority('1001','M','01')),JSON.stringify({priority:'CRITICAL',trackingTags:[],source:'cp'}),'CP önceliklidir');
  assert.equal(JSON.stringify(api.lookupCpPriority('2002','X','05')),JSON.stringify({priority:'prio:yakin-yukleme',trackingTags:['prio:s7-takip'],source:'orders'}));
  api.context._ordersPriorityContextKey='k2';
  assert.equal(api.lookupCpPriority('2002','X','05'),null,'kural değişince eski Siparişler sonucu kullanılmaz');
});

test('Siparişler Priority sütununu taşır, checklist/PLM numune taşımaz; çizim hesabı beklemez',()=>{
  const src=read('app-main.js');
  assert.match(src,/filter\(c=>c\.type!=='plmSample'\)/);
  assert.match(src,/void scheduleOrdersPriorities\(\);/);
  assert.match(src,/const result=await window\.BLOrdersPriority\.run\(active,ctx\.spec,\{isCurrent,prepareBatch\}\);/);
  assert.match(src,/stamp\.key===ordersPriorityContextKey\(\)/,'checklist cevabı değil kural/katalog anahtarı');
});

test('öncelik hazır olunca tüm tablo değil görünen Priority hücreleri güncellenir',()=>{
  const src=read('app-main.js');
  assert.match(src,/if\(currentActiveTab\(\)==='orders'&&!refreshOrdersPriorityCells\(\)\)renderOrders\(\);/);
  const fnStart=src.indexOf('function refreshOrdersPriorityCells(');const body=src.slice(fnStart,src.indexOf('\n}',fnStart));
  assert.match(body,/state\.ordersSort\?\.key==='Priority'\|\|colFilterActive\('orders','Priority'\)\)return false;/,'Priority sıralama/filtre varsa tam çizim');
  assert.match(body,/td\[data-key="Priority"\]/);
  assert.doesNotMatch(body,/renderOrders\(/);
});

test('worker’a yalnız motorun ve kuralların okuduğu alanlar gider; sonuç tam satırla aynıdır',()=>{
  const extra=Rules.normalizeRule({id:'klasman',kind:'priority',enabled:true,target:'prio:yakin-yukleme',name:'Klasman',conditions:[{field:'Ürün Klasman',operator:'eq',value:'SWEAT'},{field:'@daysToLoad',operator:'gte',value:20}]},{kind:'priority',priorityCatalog:CATALOG});
  const lic=Rules.normalizeRule({id:'lisans',kind:'priority',enabled:true,target:'prio:s7-takip',name:'Lisans',mode:'formula',formula:'=[Lisans]="DISNEY"'},{kind:'priority',priorityCatalog:CATALOG});
  const spec={rules:[...Rules.DEFAULT_RULES,...custom,extra,lic],priorityCatalog:CATALOG};
  const fields=Engine.requiredFields(spec);
  for(const key of Object.values(CP.FIELDS))assert.ok(fields.includes(key),'CP alanı: '+key);
  for(const key of ['Ürün Klasman','Lisans','Season'])assert.ok(fields.includes(key),'kural alanı: '+key);
  assert.ok(!fields.some(key=>key.startsWith('@')),'türetilmiş alan satırdan istenmez');
  const rows=[];for(let i=0;i<120;i++)rows.push(row({'Order Code':String(i),'Ex-factory':day(i%45-5),'Retail Date':day(i%60),Season:['S7','W7','W6'][i%3],'Ürün Klasman':i%4?'SWEAT':'TSHIRT',Lisans:i%5?'DISNEY':'',Unused:'x'.repeat(200),_logisticSegments:[{kind:'production',quantity:5}]}));
  const full=Engine.createSession(spec).evaluateBatch(rows);
  const projected=Engine.createSession(spec).evaluateBatch(rows.map(r=>Engine.projectRow(r,fields)));
  assert.deepEqual(projected,full);
  assert.ok(new Set(full.codes).size>1,'karışık sonuç (anlamlı karşılaştırma)');
  assert.equal(Engine.projectRow(rows[0],fields).Unused,undefined,'okunmayan alan kopyalanmaz');
});

test('Siparişler Priority hücresi revizyon öncesi karşılaştırması (– → …) göstermez',()=>{
  assert.match(read('app-main.js'),/const rev = tableKey==='orders'&&c\.k==='Priority' \? null : revisionInfo\(r, c\.k, cf\);/);
});

test('kural CP formül sütununa başvurursa değer geçici kopyada hesaplanır; Siparişler satırı değişmez',async()=>{
  const formulaRule=Rules.normalizeRule({id:'calc',kind:'priority',enabled:true,target:'prio:yakin-yukleme',name:'Formül sütunu',conditions:[{field:'__f_fc_risk',operator:'eq',value:'EVET'}]},{kind:'priority',priorityCatalog:CATALOG});
  const spec={rules:[formulaRule],priorityCatalog:CATALOG};
  assert.ok(Engine.requiredFields(spec).includes('__f_fc_risk'));
  globalThis.BLOrdersPriorityEngine=Engine;
  delete require.cache[require.resolve('../public/orders-priority.js')];
  const Runner=require('../public/orders-priority.js');
  const rows=[row({'Order Code':'a',Season:'S7','Ex-factory':day(40)}),row({'Order Code':'b',Season:'W7','Ex-factory':day(40)}),row({'Order Code':'c',Season:'S7','Ex-factory':day(40),'__f_fc_risk':'ORDERS-OWN'})];
  const before=JSON.stringify(rows);
  const prepareBatch=batch=>batch.map(r=>({...r,'__f_fc_risk':r.Season==='S7'?'EVET':'HAYIR'}));
  for(const forceFallback of [true]){
    const out=await Runner.run(rows,spec,{forceFallback,prepareBatch});
    assert.deepEqual(out.codes,['prio:yakin-yukleme','ON_TRACK','prio:yakin-yukleme'],'CP formülü kopyada hesaplanır');
  }
  assert.equal(JSON.stringify(rows),before,'Siparişler satırları (kendi formül değeri dahil) değişmez');
  const noPrep=await Runner.run(rows,spec,{forceFallback:true});
  assert.deepEqual(noPrep.codes,['ON_TRACK','ON_TRACK','ON_TRACK'],'hazırlık olmadan CP formül alanı yoktur (bulgunun kendisi)');
  delete globalThis.BLOrdersPriorityEngine;
  const src=read('app-main.js');
  assert.match(src,/formulas\.applyToRows\('cp',copies\)/);
  assert.match(src,/const copies=batch\.map\(row=>\(\{\.\.\.row\}\)\)/);
});
