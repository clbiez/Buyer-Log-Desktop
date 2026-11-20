'use strict';
/* WS5 (#1078) satır yaması: kaydedilen yamalar yeni projeksiyon nesli beklenmeden işçide uygulanır.
 * Parite kapısı: "gerçek nesil" bu testte sunucunun projeksiyon yeniden yazımının AYNI adımlarıyla
 * üretilir (diskteki ham satır → projectionPatchMatches + applyIncrementalProjectionPatch → disk biçimi →
 * işçi çözümü), sanal veri kümesi ise işçideki hazırlanmış temel veri kümesinden. Karşılaştırma:
 *  - satır düzeyi: bütün satırların kaynak özeti (hesaplanmış alanlar hariç) birebir eşit;
 *  - hesap düzeyi: sanal veri kümesindeki artımlı hesap == gerçek nesilde sıfırdan tam hesap;
 *  - yetki: kapsam dışı siparişin yaması veri kümesine satır eklemez, hiçbir satırı değiştirmez;
 *  - doğrulama: gerçek neslin yamalı satırlarıyla eşleşme 0 uyuşmazlık; bozulmuş satır yakalanır.
 * 2k iki yetki kapsamı varsayılan; 30k BUYER_LOG_PARITY_30K=1 ile. */
const test=require('node:test'),assert=require('node:assert/strict');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const parity=require('./helpers/read-model-parity.cjs');
const parse=require('../server/lib/parse'),tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const engine=require('../server/lib/read-model/query-engine');
const worker=require('../server/lib/read-model/read-model-worker');
const task=require('../server/lib/read-model/cp-computed-task');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const {applyIncrementalProjectionPatch,projectionPatchMatches}=require('../server/lib/projection-row-patch');
const {createCpRowPatchLog}=require('../server/lib/read-model/cp-row-patch-log');
const OD=require('../public/order-decision-engine'),Readiness=require('../public/cp-readiness-engine');

const TODAY=new Date();
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function fixture(rows){
  const fx=parity.makeFixture({rows,today:iso(TODAY)});
  const asas=parse.parseASASRows(fx.asas).orders,antrepo=parse.parseAntrepoRows(fx.antrepo);
  const src={loadedAt:'r1',asasOrders:asas,asasOrdersByTarget:{cp:asas,orders:asas},antrepoMap:antrepo,lflRows:[]};
  const buyers=[...new Set(asas.map(row=>row.buyer))].sort();
  const all=new Set(asas.map(row=>parse.orderCodeKey(row.ocode)));
  const scoped=user=>{
    const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,
      viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:user.buyers},editScopes:{buyers:user.buyers},
      authority:Object.fromEntries(asas.map(row=>[row.ocode,[row]])),profiles:[]});
    const built=tasks.buildProjections(src,{modules:['cp'],overrides:{},horizons:{},access:ctx});
    // Onaydan gelen Ex-factory yolunu da kapsa: bazı satırlarda yükleme onayı var.
    built.cp.rows.forEach((row,i)=>{if(i%17===4&&row['Ex-factory'])row['Buying Son Onay Tarihi']=row['Ex-factory'];});
    const keys=built.cp.rows.map(row=>Readiness.analyzeOrder(row).orderKey);
    return {cpJson:tasks.serialize({rows:built.cp.rows},'projection'),keys,rows:built.cp.rows.length};
  };
  return {buyers,scoped,all};
}
function contextFor(userId){
  return createContextLoader({
    preferences:{load:()=>({entries:{}})},
    roleEntries:()=>({'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}}),
    managedRules:()=>({rules:[],deletedRuleIds:[],priorityCatalog:[],checklistStatuses:[],revision:0}),
    transitRules:()=>TRANSIT,plmPayload:()=>({models:{},updatedAt:null}),
    checklistPayload:()=>({answers:{},tombstones:{}}),revision:()=>'r1',merge:(own,shared)=>({...own,...shared})})({id:userId}).value;
}
const TRANSIT=[{id:'t-sea',seasons:[],countries:[],delType:'',days:35,exfStart:'',exfEnd:''}];
const NOTE_COLUMNS=[{id:'nc_a',label:'A'}];
const gz=json=>Uint8Array.from(zlib.gzipSync(Buffer.from(json))).buffer;
const KEY=/^(?:__checklist__|_checklist|_cp(?:OrderKey|OptionId)$)/;
const digest=row=>crypto.createHash('sha1').update(JSON.stringify(row,(k,v)=>k&&KEY.test(k)?undefined:v)).digest('base64');

/* Sunucunun projeksiyon yeniden yazımı (server.js rewriteProjectionCacheForRowPatches dönüşümü) — aynı fonksiyonlar. */
function rewrite(doc,items,overrides){
  const touched=[];
  for(const row of doc.rows)for(const item of items)if(projectionPatchMatches(row,item)){
    applyIncrementalProjectionPatch(row,item.patch,overrides,true);if(!touched.includes(row))touched.push(row);
  }
  return {doc:JSON.parse(tasks.serialize(doc,'projection')),touchedJson:tasks.serialize(touched,'projection')};
}
/* server.js recordCpRowPatches ile aynı bağlam alt kümesi. */
function recordedContext(items,overrides){
  const notesmap={};
  for(const item of items)for(const key of [parse.orderLineKey(item.orderCode,item.patch.model,item.patch.ccode),parse.orderCodeKey(item.orderCode)])
    if(overrides.notesmap[key])notesmap[key]=overrides.notesmap[key];
  return {notesmap,noteColumnDefs:overrides.noteColumnDefs,transitRules:overrides.transitRules};
}
function editsFor(doc,step,outsideCode){
  const items=[],notesmap={};
  doc.rows.forEach((row,i)=>{
    if(i%97!==(step*13)%97)return;
    const base={model:String(row['Model Name']||'').trim(),ccode:String(row['C.Code']||'').trim()};
    const d=new Date(TODAY.getFullYear(),TODAY.getMonth()+(i%5),1+(i%27));
    const kinds=[
      {notes:{Notes:`not ${step}-${i}`,NotesHtml:`<b>not ${step}-${i}</b>`}},
      {delType:i%2?'Uçak':'Gemi'},
      {dates:{retailDate:iso(d)}},
      {dates:{inStoreDate:iso(d)}},
      {dates:{exFactory:iso(d)}},
      {noteColumns:{nc_a:`x${step}-${i}`}},
      {delType:'Kamyon',dates:{retailDate:iso(d),exFactory:iso(new Date(d.getTime()-20*864e5))},notes:{Notes:'c',NotesHtml:''}},
    ];
    const patch={...base,...kinds[(i+step)%kinds.length]};
    items.push({orderCode:Number(row['Order Code']),patch});
    if(patch.notes)notesmap[parse.orderLineKey(row['Order Code'],base.model,base.ccode)]={Notes:patch.notes.Notes,NotesHtml:patch.notes.NotesHtml,NotesBy:'u'+step,NotesByName:'U '+step,NotesAt:'2026-11-0'+(step+1)+'T10:00:00.000Z'};
  });
  // Kapsam dışı sipariş: yetkili kullanıcının kaydı (başka kullanıcının kapsamında) bu kullanıcının veri kümesine girmez.
  if(outsideCode)items.push({orderCode:Number(outsideCode),patch:{model:'M-YOK',ccode:'C-YOK',delType:'Gemi'}});
  return {items,notesmap};
}

async function rowPatchParity(rows,user,fx){
  const projection=fx.scoped(user),context=contextFor(user.id),deps={cache:worker.cache,engine};
  const inScope=new Set(JSON.parse(projection.cpJson).rows.map(row=>parse.orderCodeKey(row['Order Code'])));
  const outside=[...fx.all].find(code=>!inScope.has(code));
  const payload=(dataset,extra={})=>({dataset:{scopeKey:'cp-overview',...dataset},scopeKey:'s-'+user.id,lang:'tr',context,tasks:[],...extra});
  worker.cache.clear();task.clearHosts();
  const first=await task.ensureComputed(payload({datasetKey:'gen-0',buffer:gz(projection.cpJson)}),deps);
  assert.equal(first.incremental,false);

  // İki ardışık kayıt (zincir): gerçek nesil her adımda diskten yeniden yazılır.
  let disk=JSON.parse(projection.cpJson);
  const overrides={notesmap:{},noteColumnDefs:NOTE_COLUMNS,transitRules:TRANSIT},steps=[],touched=new Map();
  for(let step=0;step<2;step++){
    const {items,notesmap}=editsFor(disk,step,user.all?null:outside);
    Object.assign(overrides.notesmap,notesmap);
    steps.push({items,context:recordedContext(items,overrides)});
    const out=rewrite(disk,items,overrides);disk=out.doc;
    for(const row of JSON.parse(out.touchedJson))touched.set(String(row._id),row);
  }
  const realJson=JSON.stringify(disk);

  // Sanal: işçideki gen-0 + iki adım.
  const virtual=await task.ensureComputed(payload({datasetKey:'virt-2',virtual:{baseKey:'gen-0',steps}}),deps);
  assert.equal(virtual.incremental,true,'sanal veri kümesi artımlı hesaplandı');
  const info=virtual.current.phases.incremental;
  assert.equal(info.rowPatch,true,'değişen satır ipucu kullanıldı (tam özet yok)');
  assert.equal(info.changed,touched.size,'yalnız yamalanan satırlar değişmiş sayıldı');
  assert.equal(virtual.loads.rowPatch.rows,touched.size);
  assert.ok(touched.size>=4,'yeterli düzenleme');

  // Yetki: kapsam dışı yama satır eklemez; satır sayısı ve kimlikler aynı.
  const real=engine.decodeDataset(gz(realJson));
  const {prepareCpRows}=require('../server/lib/read-model/overview-row-prep');prepareCpRows(real.rows);
  assert.equal(virtual.current.rows.length,real.rows.length);
  if(outside)assert.ok(!virtual.current.rows.some(row=>parse.orderCodeKey(row['Order Code'])===outside),'kapsam dışı sipariş veri kümesine girmedi');

  // Satır düzeyi parite: bütün satırların kaynak özeti gerçek nesille aynı.
  const realById=new Map(real.rows.map(row=>[String(row._id),row]));
  const diffs=[];
  for(const row of virtual.current.rows){
    const other=realById.get(String(row._id));
    if(!other||digest(row)!==digest(other)){
      if(diffs.length<3)diffs.push({id:row._id,keys:Object.keys(row).filter(k=>!KEY.test(k)&&JSON.stringify(row[k])!==JSON.stringify(other&&other[k])).slice(0,6)});
    }
  }
  assert.deepEqual(diffs,[],'sanal satırlar gerçek nesille birebir');

  // Doğrulama: gerçek neslin yamalı satırları → 0 uyuşmazlık; bozulmuş satır yakalanır.
  const verifyOk=await task.ensureComputed(payload({datasetKey:'virt-2'},{verify:{rowsJson:JSON.stringify([...touched.values()])}}),deps);
  assert.deepEqual({checked:verifyOk.verify.checked,mismatched:verifyOk.verify.mismatched},{checked:touched.size,mismatched:0});
  const broken=[...touched.values()].map((row,i)=>i?row:{...row,Notes:'başka değer'});
  const verifyBad=await task.ensureComputed(payload({datasetKey:'virt-2'},{verify:{rowsJson:JSON.stringify(broken)}}),deps);
  assert.equal(verifyBad.verify.mismatched,1);

  // Hesap düzeyi parite: sanal artımlı == gerçek nesilde sıfırdan tam hesap.
  const virtualTuples=[...virtual.current.serialized.values()];
  worker.cache.clear();task.clearHosts();
  const full=await task.ensureComputed(payload({datasetKey:'gen-2-full',buffer:gz(realJson)}),deps);
  assert.equal(full.incremental,false);
  const result=await parity.assertParity({name:`cp satır yaması ${rows} ${user.id}`,rows:[],context:{},
    legacy:()=>[...full.current.serialized.values()].map(value=>JSON.parse(value)),candidate:()=>virtualTuples.map(value=>JSON.parse(value))});
  assert.ok(result.equal);
  assert.ok([...touched.keys()].some(id=>first.current.serialized.get(id)!==full.current.serialized.get(id)),'yamalar hesaplanmış değeri değiştirdi (boş parite değil)');
}
const twoScopes=buyers=>[{id:'moderator',all:true,buyers:[]},{id:'buyer-a',all:false,buyers:buyers.slice(0,Math.max(1,Math.floor(buyers.length/3)))}];

test('satır yaması: sanal veri kümesi gerçek nesille satır ve hesap düzeyinde eşit (2k, iki yetki kapsamı)',{timeout:600000},async()=>{
  const fx=fixture(2000);
  for(const user of twoScopes(fx.buyers))await rowPatchParity(2000,user,fx);
});
test('satır yaması: 30k (BUYER_LOG_PARITY_30K=1)',{skip:process.env.BUYER_LOG_PARITY_30K!=='1',timeout:1800000},async()=>{
  const fx=fixture(30000);
  for(const user of twoScopes(fx.buyers))await rowPatchParity(30000,user,fx);
});

test('satır yaması: temel veri kümesi işçide yoksa eksik döner (servis gerçek nesle düşer)',async()=>{
  worker.cache.clear();task.clearHosts();
  const out=await task.ensureComputed({dataset:{datasetKey:'v',scopeKey:'s',virtual:{baseKey:'yok',steps:[]}},scopeKey:'h',lang:'tr',context:contextFor('u'),tasks:[]},{cache:worker.cache,engine});
  assert.deepEqual(out.missing,['cp']);
});

test('yama günlüğü: zincir, güvensiz yama, sınırlar ve yeniden yazım sonucu',()=>{
  let now=1000;const log=createCpRowPatchLog({now:()=>now,maxEntries:3,ttlMs:10000,maxChainItems:2});
  const safe=patch=>!Object.hasOwn(patch,'licensor');
  const item=code=>({orderCode:code,patch:{model:'M',ccode:'C',delType:'Gemi'}});
  assert.equal(log.record({userId:'u',before:'a',after:'b',items:[item(1),{orderCode:2,patch:{model:'M',ccode:'C',licensor:'X'}}],safe}),null,'tek güvensiz öğe → kayıt yok');
  const ab=log.record({userId:'u',before:'a',after:'b',items:[item(1)],safe,context:{notesmap:{}}});
  const bc=log.record({userId:'u',before:'b',after:'c',items:[item(2)],safe});
  assert.deepEqual(log.chain('u','a','c').entries,[ab,bc]);
  assert.deepEqual(log.chain('u','b','c').entries,[bc]);
  assert.equal(log.chain('u','a','x'),null,'günlükte olmayan geçiş (başka yazım) → zincir yok');
  assert.equal(log.chain('v','a','c'),null,'başka kullanıcının günlüğü kullanılmaz');
  assert.equal(log.chain('u','c','a'),null,'geri yön yok');
  log.record({userId:'u',before:'c',after:'d',items:[item(3),item(4)],safe});
  assert.equal(log.chain('u','a','d'),null,'girdi sınırı (en eski düştü)');
  assert.equal(log.chain('u','b','d'),null,'zincir öğe sınırı aşıldı');
  assert.equal(log.chain('u','c','d').items,2);
  log.settle(bc,{ok:true,rowsJson:'[]'});log.settle(bc,{ok:false});
  assert.deepEqual(bc.settled,{ok:true,rowsJson:'[]'},'ilk sonuç kalır');
  now+=20000;assert.equal(log.chain('u','c','d'),null,'süresi dolan girdiler düşer');
  assert.equal(log.stats().unsafe,1);
});

/* ---------- servis: yol seçimi, doğrulama ve gerçek nesle dönüş ---------- */
const {createCpComputedService}=require('../server/lib/read-model/cp-computed-service');
const queryTask=require('../server/lib/read-model/cp-query-task');
function serviceHarness(){
  const fx=fixture(400),projection=fx.scoped({id:'moderator',all:true,buyers:[]});
  const state={contextHash:'h0',sourceToken:'s1',accessHash:'all',leases:0,mismatches:[],payloads:[]};
  const disk={doc:JSON.parse(projection.cpJson)};
  const guard={capture(req){
    const initial={userId:req.currentUser.id,contextHash:state.contextHash,accessHash:state.accessHash,sourceToken:state.sourceToken};
    const key=JSON.stringify(initial);
    return {profile:req.currentUser,key,...initial,assertResponse(){if(JSON.stringify({userId:req.currentUser.id,contextHash:state.contextHash,accessHash:state.accessHash,sourceToken:state.sourceToken})!==key)throw Object.assign(Error('stale / stale'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});}};
  }};
  const loadProjection=async()=>{
    state.leases++;
    const buffer=zlib.gzipSync(Buffer.from(JSON.stringify(disk.doc)));
    return {value:{buffer,uncompressedBytes:buffer.length*8},manifest:{activeGeneration:'g-'+state.contextHash,modules:{cp:{checksum:crypto.createHash('sha256').update(buffer).digest('hex')}}},assertResponse(){},release(){}};
  };
  const runCompute=async(name,payload,options)=>{
    state.payloads.push({name,virtual:Boolean(payload.dataset.virtual),buffer:Boolean(payload.dataset.buffer),verify:Boolean(payload.verify),datasetKey:payload.dataset.datasetKey,baseKey:payload.dataset.virtual&&payload.dataset.virtual.baseKey,
      warmOnly:Boolean(payload.warmOnly),estimated:options.estimatedBytes});
    const run=name==='read-model-cp-query'?queryTask:task;
    const value=await run.execute(structuredClone(payload),{cache:worker.cache,engine});
    if(state.onRun){const hook=state.onRun;state.onRun=null;hook();}
    return {value,release(){}};
  };
  const log=createCpRowPatchLog();
  const service=createCpComputedService({guard,loadProjection,runCompute,loadContext:()=>({key:'ctx',value:contextFor('moderator'),revision:'r1'}),
    rowPatchLog:log,onRowPatchMismatch:info=>state.mismatches.push(info)});
  const overrides={notesmap:{},noteColumnDefs:NOTE_COLUMNS,transitRules:TRANSIT};
  /* Kayıt: günlük girdisi + bağlam ilerler; gerçek nesil (disk) yeniden yazımla güncellenir. Dönen: {entry, touchedJson}. */
  function save(step){
    const {items,notesmap}=editsFor(disk.doc,step,null);Object.assign(overrides.notesmap,notesmap);
    const before=state.contextHash,after='h'+(step+1);
    const entry=log.record({userId:'moderator',before,after,items,context:recordedContext(items,overrides),safe:()=>true});
    const out=rewrite(disk.doc,items,overrides);disk.doc=out.doc;state.contextHash=after;
    return {entry,touchedJson:out.touchedJson};
  }
  return {state,service,log,save,disk};
}
const moderator={currentUser:{id:'moderator'}};
const computedBody={version:1,lang:'tr'};

test('servis: kayıttan sonra okuma projeksiyon kirası beklemeden yamalı veri kümesiyle; doğrulanınca zincir sıfırlanır',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,1);
  const first=h.save(0);
  const after=await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,1,'kira alınmadı (yeni nesil beklenmedi)');
  assert.equal(after.timing.service.rowPatch.steps,1);
  const last=h.state.payloads.at(-1);assert.equal(last.virtual,true);assert.ok(last.baseKey);
  // Pencereli okuma da aynı sanal veri kümesinden (yeniden yama yok, kira yok).
  const window=await h.service.query(moderator,{version:1,query:{version:1,columns:[{k:'Order Code',type:'ro'},{k:'Del. Type',type:'ro'}],today:iso(TODAY),limit:5}});
  assert.equal(h.state.leases,1);assert.equal(h.state.payloads.at(-1).virtual,false);assert.equal(h.state.payloads.at(-1).datasetKey,last.datasetKey);
  assert.ok(window.result.total>0);
  // Yeniden yazım bitti → sonraki okuma doğrular; eşleşir → zincir sıfırlanır, kira yine yok.
  h.log.settle(first.entry,{ok:true,rowsJson:first.touchedJson});
  const verified=await h.service.computed(moderator,{...computedBody,lang:'en'});
  assert.equal(h.state.payloads.at(-1).verify,true);
  assert.equal(verified.timing.service.rowPatch.verified,true);
  assert.equal(h.service.stats().rowPatchVerified,1);
  assert.equal(h.state.leases,1);
  // İkinci kayıt: temel artık doğrulanmış sanal veri kümesi; zincir tek adım.
  h.save(1);
  const second=await h.service.computed(moderator,computedBody);
  assert.equal(second.timing.service.rowPatch.steps,1);assert.equal(second.timing.service.rowPatch.pending,1);
  assert.equal(h.state.leases,1);assert.deepEqual(h.state.mismatches,[]);
});

test('servis: uyuşmazlık ya da başarısız yeniden yazımda istek gerçek nesille yürütülür; temel düşer',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  const first=h.save(0);
  await h.service.computed(moderator,computedBody);
  const tampered=JSON.parse(first.touchedJson);tampered[0].Notes='gerçek nesilde başka';
  h.log.settle(first.entry,{ok:true,rowsJson:JSON.stringify(tampered)});
  const out=await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,2,'gerçek nesil kirası alındı');
  assert.equal(h.state.payloads.at(-1).virtual,false);assert.deepEqual(out.timing.service.rowPatch,{miss:'mismatch'},'neden yanıtta');
  assert.equal(h.state.mismatches.length,1);assert.equal(h.state.mismatches[0].reason,'row-mismatch');assert.equal(h.state.mismatches[0].mismatched,1);
  // Başarısız yeniden yazım: doğrulanamaz → gerçek nesil.
  const second=h.save(1);
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,2,'yeni zincir yine sanal');
  h.log.settle(second.entry,{ok:false});
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,3);assert.equal(h.state.mismatches.at(-1).reason,'rewrite-failed');
});

test('servis: zincir yoksa, damga (kaynak/yetki) değiştiyse ya da temel işçiden düştüyse gerçek nesil',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  // Günlükte olmayan değişim (başka kullanıcının yazımı): zincir yok.
  h.state.contextHash='baska';
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,2);
  // Kaynak damgası değişti: yama zinciri olsa da kullanılmaz.
  h.log.record({userId:'moderator',before:'baska',after:'h9',items:[{orderCode:1,patch:{model:'M',ccode:'C',delType:'Gemi'}}],context:{},safe:()=>true});
  h.state.contextHash='h9';h.state.sourceToken='s2';
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,3);
  // Temel işçiden düştü: sanal istek eksik döner → gerçek nesil, sayaç.
  h.save(0);
  worker.cache.clear();
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,4);assert.equal(h.service.stats().rowPatchFallbacks,1);
  assert.equal(h.state.payloads.filter(p=>p.virtual).length,1);
});

test('servis: eşzamanlı okumalar tek sanal kurulumu paylaşır; okuma sırasında kayıt gelirse sonraki okuma yine kira beklemez',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  h.save(0);
  const spec={version:1,query:{version:1,columns:[{k:'Order Code',type:'ro'}],today:iso(TODAY),limit:5}};
  await Promise.all([h.service.computed(moderator,computedBody),h.service.query(moderator,spec),h.service.facets(moderator,{version:1,facets:{version:1,columns:[{k:'Order Code',type:'ro'}],today:iso(TODAY)}})]);
  assert.equal(h.state.leases,1,'hiçbiri kira beklemedi');
  assert.equal(h.state.payloads.filter(p=>p.virtual).length,1,'tek sanal kurulum');
  assert.equal(h.service.stats().rowPatchFallbacks,0);
  // Okuma işçide sürerken yalnız bu kullanıcının satır kaydı: yanıt yakalanan bağlamın anlık görüntüsü olarak döner (409 yok).
  h.state.onRun=()=>h.save(1);
  const during=await h.service.computed(moderator,{...computedBody,lang:'en'});
  assert.ok(during.body);assert.equal(h.service.stats().rowPatchStaleAccepted,1);
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,1,'sonraki okuma da kira beklemedi');
  assert.equal(h.service.stats().rowPatchFallbacks,0);
});

test('servis: gerçek nesil okuması sırasında kayıt gelirse temel yine kaydedilir; sonraki okuma zincirle (kira yok)',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  h.state.onRun=()=>h.save(0);
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,1);
  await h.service.computed(moderator,computedBody);
  assert.equal(h.state.leases,1,'işçideki veri kümesi temel olarak kullanıldı');
  assert.equal(h.state.payloads.at(-1).virtual,true);
});

/* Havuz, boştaki işçinin yerleşik belleği + işin tahmini bütçeyi aşınca işçiyi emekli eder (bütün veri kümeleri ve
   barındırıcılar düşer). Sıcak barındırıcıdaki artımlı iş soğuk tahmin istemez; soğuksa işçi hesaplamadan söyler. */
test('servis: sıcak barındırıcıda yama okuması sıcak tahminle tek işte; soğuksa hesapsız `cold` ve soğuk tahminle yeniden',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  h.save(0);
  const n0=h.state.payloads.length;
  await h.service.computed(moderator,computedBody);
  const warm=h.state.payloads.slice(n0);
  assert.equal(warm.length,1,'tek iş');assert.equal(warm[0].warmOnly,true);
  assert.equal(warm[0].estimated,96*1024*1024,'sıcak tahmin (soğuk karar payı istenmez)');
  // Barındırıcı yok (ör. dil/tercih değişti): işçi hesap yapmadan `cold` döner, servis soğuk tahminle yeniden gönderir.
  task.clearHosts();h.save(1);
  const n1=h.state.payloads.length;
  const out=await h.service.computed(moderator,computedBody);
  const cold=h.state.payloads.slice(n1);
  assert.equal(cold.length,2);assert.equal(cold[0].warmOnly,true);assert.equal(cold[1].warmOnly,false);
  assert.ok(cold[1].estimated>cold[0].estimated,'soğuk tahmin');
  assert.equal(h.state.leases,1,'kira yok');assert.equal(h.service.stats().coldRetries,1);
  assert.ok(out.timing.service.rowPatch.steps>=1);
});

test('servis: okuma sırasında günlükte olmayan değişim (başka yazım / kaynak) yine 409; satır kaydı zinciri yalnız aynı damgada kabul',{timeout:120000},async()=>{
  worker.cache.clear();task.clearHosts();
  const h=serviceHarness();
  await h.service.computed(moderator,computedBody);
  h.state.onRun=()=>{h.state.contextHash='baskasi';};
  await assert.rejects(h.service.computed(moderator,{...computedBody,lang:'en'}),error=>error.code==='COMPUTE_STALE_GENERATION');
  h.save(0);h.state.onRun=()=>{h.save(1);h.state.sourceToken='s9';};
  await assert.rejects(h.service.computed(moderator,computedBody),error=>error.code==='COMPUTE_STALE_GENERATION','zincir var ama kaynak damgası değişti');
  assert.equal(h.service.stats().rowPatchStaleAccepted,0);
});
