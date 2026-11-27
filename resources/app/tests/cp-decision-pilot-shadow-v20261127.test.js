'use strict';
/* ADR-0003 §6F pilotu — CP karar hesaplaması gölge doğrulaması.
 *
 * Pilot (BUYER_LOG_CP_ROWPATCH_LEGACY=1) eski kayıt yollarının (PATCH /api/overrides/:kod, /batch, /batch-suppfob)
 * yamalarını mevcut satır yaması günlüğüne yazar; okuma modeli bu yamaları işçideki son veri kümesine uygular ve
 * kararları mevcut içerik tabanlı artımlı planla (kaynak özeti değişen satırlar + sipariş/opsiyon grubu) yeniden hesaplar.
 * Bu test, her senaryoda pilot sonucunu AYNI veride, AYRI (sıfır durumlu) barındırıcıda yapılan TAM hesapla karşılaştırır.
 * Tek bir satır farkı testi düşürür. Senaryolar: karar girdisi olmayan düzenleme, karar girdisini doğrudan değiştiren
 * düzenleme, dolaylı bağımlılık (aynı siparişin başka satırı), çoklu hücre, ardışık + aynı okumaya düşen eşzamanlı kayıtlar,
 * gün dönümü ve yapılandırma (transit kuralı) değişikliği. Başka kullanıcının yazımı günlük zinciri kurmaz (ayrı test). */
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
const Readiness=require('../public/cp-readiness-engine');

const TODAY=new Date();
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const TRANSIT=[{id:'t-sea',seasons:[],countries:[],delType:'',days:35,exfStart:'',exfEnd:''}];
const NOTE_COLUMNS=[{id:'nc_a',label:'A'}];
const gz=json=>Uint8Array.from(zlib.gzipSync(Buffer.from(json))).buffer;
const KEY=/^(?:__checklist__|_checklist|_cp(?:OrderKey|OptionId)$)/;
const digest=row=>crypto.createHash('sha1').update(JSON.stringify(row,(k,v)=>k&&KEY.test(k)?undefined:v)).digest('base64');

function fixture(rows){
  const fx=parity.makeFixture({rows,today:iso(TODAY)});
  const asas=parse.parseASASRows(fx.asas).orders,antrepo=parse.parseAntrepoRows(fx.antrepo);
  const src={loadedAt:'r1',asasOrders:asas,asasOrdersByTarget:{cp:asas,orders:asas},antrepoMap:antrepo,lflRows:[]};
  const buyers=[...new Set(asas.map(row=>row.buyer))].sort();
  const scoped=user=>{
    const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,
      viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:user.buyers},editScopes:{buyers:user.buyers},
      authority:Object.fromEntries(asas.map(row=>[row.ocode,[row]])),profiles:[]});
    const built=tasks.buildProjections(src,{modules:['cp'],overrides:{},horizons:{},access:ctx});
    built.cp.rows.forEach((row,i)=>{if(i%17===4&&row['Ex-factory'])row['Buying Son Onay Tarihi']=row['Ex-factory'];});
    return {cpJson:tasks.serialize({rows:built.cp.rows},'projection'),keys:built.cp.rows.map(row=>Readiness.analyzeOrder(row).orderKey)};
  };
  return {buyers,scoped};
}
function contextFor(userId,transitRules=TRANSIT){
  return createContextLoader({
    preferences:{load:()=>({entries:{}})},
    roleEntries:()=>({'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}}),
    managedRules:()=>({rules:[],deletedRuleIds:[],priorityCatalog:[],checklistStatuses:[],revision:0}),
    transitRules:()=>transitRules,plmPayload:()=>({models:{},updatedAt:null}),
    checklistPayload:()=>({answers:{},tombstones:{}}),revision:()=>'r1',merge:(own,shared)=>({...own,...shared})})({id:userId}).value;
}
/* server.js projeksiyon yeniden yazımıyla aynı dönüşüm (rewriteProjectionCacheForRowPatches → applyIncrementalProjectionPatch). */
function rewrite(doc,items,overrides){
  for(const row of doc.rows)for(const item of items)if(projectionPatchMatches(row,item))applyIncrementalProjectionPatch(row,item.patch,overrides,true);
  return JSON.parse(tasks.serialize(doc,'projection'));
}
/* server.js recordCpRowPatches ile aynı bağlam alt kümesi. */
function recordedContext(items,overrides){
  const notesmap={};
  for(const item of items)for(const key of [parse.orderLineKey(item.orderCode,item.patch.model,item.patch.ccode),parse.orderCodeKey(item.orderCode)])
    if(overrides.notesmap[key])notesmap[key]=overrides.notesmap[key];
  return {notesmap,noteColumnDefs:overrides.noteColumnDefs,transitRules:overrides.transitRules};
}
const lineOf=row=>({model:String(row['Model Name']||'').trim(),ccode:String(row['C.Code']||'').trim()});
const tuples=current=>new Map(current.serialized);
function diffTuples(a,b){
  const out=[];
  for(const [id,json] of b)if(a.get(id)!==json&&out.length<5)out.push({id,pilot:a.get(id)||null,full:json});
  for(const id of a.keys())if(!b.has(id)&&out.length<5)out.push({id,pilot:a.get(id),full:null});
  return out;
}

/* Bir kullanıcı kapsamında senaryo dizisi: her adım gerçek nesli (disk) yeniden yazar, pilot sanal veri kümesini kurar ve
   artımlı hesaplar; aynı gerçek nesil ayrı barındırıcıda (başka scopeKey → başka hostKey, boş durum) tam hesaplanır. */
function harness(user,fx){
  const projection=fx.scoped(user),deps={cache:worker.cache,engine};
  const state={disk:JSON.parse(projection.cpJson),base:'gen-0',n:0,context:contextFor(user.id),
    overrides:{notesmap:{},noteColumnDefs:NOTE_COLUMNS,transitRules:TRANSIT},log:[]};
  // İşçi veri kümesi önbelleği kapsam başına tek veri kümesi tutar: tam hesap ayrı kapsamda (pilotun temelini düşürmez).
  const payload=(dataset,extra={},scope='pilot')=>({dataset:{scopeKey:scope==='pilot'?'cp-overview':'cp-overview-full',...dataset},scopeKey:scope+'-'+user.id,lang:'tr',context:state.context,tasks:[],...extra});
  async function start(){
    worker.cache.clear();task.clearHosts();
    const first=await task.ensureComputed(payload({datasetKey:'gen-0',buffer:gz(projection.cpJson)}),deps);
    assert.equal(first.incremental,false);state.first=first;return first;
  }
  /* steps: [{items,notesmap?}] — aynı okumaya düşen bir ya da daha çok kayıt. */
  async function read(name,steps,{expectIncremental=true}={}){
    const virtualSteps=[],touched=new Set();
    for(const step of steps){
      Object.assign(state.overrides.notesmap,step.notesmap||{});
      virtualSteps.push({items:step.items,context:recordedContext(step.items,state.overrides)});
      for(const row of state.disk.rows)for(const item of step.items)if(projectionPatchMatches(row,item))touched.add(String(row._id));
      state.disk=rewrite(state.disk,step.items,state.overrides);
    }
    const key='virt-'+(++state.n);
    const pilot=await task.ensureComputed(payload({datasetKey:key,virtual:{baseKey:state.base,steps:virtualSteps}}),deps);
    state.base=key;
    const realJson=JSON.stringify(state.disk);
    // Satır düzeyi: sanal satırlar gerçek nesille birebir.
    const real=engine.decodeDataset(gz(realJson));require('../server/lib/read-model/overview-row-prep').prepareCpRows(real.rows);
    const realById=new Map(real.rows.map(row=>[String(row._id),row]));
    const rowDiffs=pilot.current.rows.filter(row=>digest(row)!==digest(realById.get(String(row._id))||{})).map(row=>String(row._id));
    assert.deepEqual(rowDiffs.slice(0,5),[],`${name}: sanal satırlar gerçek nesille aynı`);
    // Hesap düzeyi: ayrı barındırıcıda tam hesap.
    const full=await task.ensureComputed(payload({datasetKey:'full-'+state.n,buffer:gz(realJson)},{},'full'+state.n),deps);
    assert.equal(full.incremental,false,`${name}: karşılaştırma tam hesap`);
    const diffs=diffTuples(tuples(pilot.current),tuples(full.current));
    assert.deepEqual(diffs,[],`${name}: pilot sonucu tam hesapla aynı`);
    if(expectIncremental)assert.equal(pilot.incremental,true,`${name}: artımlı yol`);
    const info=pilot.current.phases.incremental||null;
    const changedResults=[...touched].filter(id=>state.first.current.serialized.get(id)!==full.current.serialized.get(id)).length;
    const rec={name,touched:touched.size,incremental:pilot.incremental,changed:info&&info.changed,targets:info&&info.targets,
      decisionMs:pilot.current.phases.decisionMs,sourceMs:pilot.current.phases.sourceMs,rows:pilot.current.rows.length,changedResults};
    state.log.push(rec);
    return {pilot,full,info,touched,rec};
  }
  return {state,start,read,payload,deps,projection};
}

const fx=fixture(2000);
const twoScopes=buyers=>[{id:'moderator',all:true,buyers:[]},{id:'buyer-a',all:false,buyers:buyers.slice(0,Math.max(1,Math.floor(buyers.length/3)))}];

for(const user of twoScopes(fx.buyers)){
  test(`pilot gölge: düzenleme senaryoları tam hesapla birebir (${user.id})`,{timeout:900000},async()=>{
    const h=harness(user,fx);await h.start();
    const rows=()=>h.state.disk.rows;
    const pick=(fn,limit)=>rows().filter(fn).slice(0,limit);
    // 1) Karar girdisi olmayan alan: Supp. FOB (PATCH /api/overrides/:kod ve /batch-suppfob gövdesi).
    const fob=pick((row,i)=>i%113===5,12).map((row,i)=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),suppFob:10+i,suppFobMeta:{source:'manual'}}}));
    const r1=await h.read('supp-fob',[{items:fob}]);
    assert.equal(r1.info.changed,r1.touched.size,'yalnız yamalanan satırlar değişmiş sayıldı');
    assert.ok(r1.info.targets<r1.pilot.current.rows.length/4,'yalnız etkilenen grup yeniden hesaplandı');
    // 1b) Not (karar girdisi olmayan), kural kaynaklı Supp. FOB meta.
    const noteRows=pick((row,i)=>i%127===9,8);
    const notesmap={};const notes=noteRows.map((row,i)=>{const line=lineOf(row);notesmap[parse.orderLineKey(row['Order Code'],line.model,line.ccode)]={Notes:'n'+i,NotesHtml:'',NotesBy:'u',NotesByName:'U',NotesAt:'2026-11-27T10:00:00.000Z'};
      return {orderCode:Number(row['Order Code']),patch:{...line,notes:{Notes:'n'+i},suppFob:20+i,suppFobMeta:{source:'rule',ruleId:'r-1'}}};});
    await h.read('not + kural Supp. FOB',[{items:notes,notesmap}]);
    // 2) Karar girdisini doğrudan değiştiren: Ex-factory, Retail Date, In-Store, Del. Type (eski PATCH gövdesi biçimi).
    const dated=pick((row,i)=>i%89===7,16).map((row,i)=>{const d=new Date(TODAY.getFullYear(),TODAY.getMonth()+(i%4)-1,1+(i%27));
      const kinds=[{dates:{exFactory:iso(d)}},{dates:{retailDate:iso(d)}},{dates:{inStoreDate:iso(d)}},{delType:i%2?'Uçak':'Gemi'}];
      return {orderCode:Number(row['Order Code']),patch:{...lineOf(row),...kinds[i%kinds.length]}};});
    const r2=await h.read('karar girdisi (tarih / Del. Type)',[{items:dated}]);
    assert.ok(r2.rec.changedResults>0,'karar girdisi gerçekten sonucu değiştirdi (boş parite değil)');
    // 3) Dolaylı bağımlılık: aynı opsiyonu (PLM + model + renk; checklist cevabı opsiyon kapsamlı) paylaşan satırlardan
    //    YALNIZ biri düzenlenir; diğerleri de hedeflenir ve sonuçları tam hesapla aynı kalır.
    const byOption=new Map();for(const [row,values] of h.state.first.current.out){if(!values.optionId)continue;if(!byOption.has(values.optionId))byOption.set(values.optionId,[]);byOption.get(values.optionId).push(String(row._id));}
    const byId=new Map(rows().map(row=>[String(row._id),row]));
    const multi=[...byOption.values()].filter(ids=>ids.length>=2).slice(0,4).map(ids=>ids.map(id=>byId.get(id)).filter(Boolean)).filter(list=>list.length>=2);
    assert.ok(multi.length>=1,'opsiyonu paylaşan satırlar var');
    const indirect=multi.map(list=>({orderCode:Number(list[0]['Order Code']),patch:{...lineOf(list[0]),delType:'Kamyon',dates:{exFactory:iso(new Date(TODAY.getTime()-40*864e5))}}}));
    const r3=await h.read('dolaylı (aynı opsiyonun diğer satırları)',[{items:indirect}]);
    assert.ok(r3.info.targets>r3.info.changed,`grup kapanışı: hedef ${r3.info.targets} > değişen ${r3.info.changed}`);
    // 4) Çoklu hücre: tek kayıtta 60 satır (yapıştırma / toplu Supp. FOB).
    const paste=pick((row,i)=>i%31===2,60).map((row,i)=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),...(i%3?{suppFob:5+i}:{delType:'Uçak',dates:{retailDate:iso(new Date(TODAY.getTime()+(i%40)*864e5))}})}}));
    await h.read('çoklu hücre (60 satır)',[{items:paste}]);
    // 5) Ardışık: aynı hücre A sonra B (son değer kazanır) + farklı satırlar; üç kayıt tek okumaya düşer (eşzamanlı).
    const same=pick((row,i)=>i%211===11,3);
    const seqA=same.map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),suppFob:111}}));
    const seqB=same.map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),suppFob:222,delType:'Gemi'}}));
    const seqC=pick((row,i)=>i%223===13,3).map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),dates:{exFactory:iso(TODAY)}}}));
    const r5=await h.read('eşzamanlı üç kayıt tek okuma',[{items:seqA},{items:seqB},{items:seqC}]);
    for(const row of r5.pilot.current.rows)if(same.some(s=>String(s._id)===String(row._id)))assert.equal(Number(row['Supp. FOB']),222,'son değer');
    // 5b) Ardışık okumalar (her kayıttan sonra okuma): zincir uzar, sonuç yine birebir.
    for(let k=0;k<3;k++){
      const items=pick((row,i)=>i%173===(k*29)%173,5).map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),suppFob:300+k,dates:{inStoreDate:iso(new Date(TODAY.getTime()+k*864e5))}}}));
      await h.read('ardışık okuma '+(k+1),[{items}]);
    }
    console.log(JSON.stringify({user:user.id,log:h.state.log}));
  });
}

test('pilot gölge: gün dönümü önceki sonucu yeniden kullandırmaz; tam hesapla birebir',{timeout:600000},async()=>{
  const user={id:'moderator',all:true,buyers:[]};
  /* Saat, barındırıcılar kurulmadan ÖNCE kaydırılabilir Date ile değiştirilir: barındırıcı Date başvurusunu kurulumda
     alır; ikisi de aynı yapıcıyı görür, gün dönümü gerçek hayattaki gibi aynı yapıcıda ilerler. */
  const RealDate=Date,shift={offset:0};
  class Shifted extends RealDate{constructor(...a){if(a.length)super(...a);else super(RealDate.now()+shift.offset);} static now(){return RealDate.now()+shift.offset;}}
  global.Date=Shifted;
  const h=harness(user,fx);await h.start();
  const items=h.state.disk.rows.filter((row,i)=>i%97===3).slice(0,6).map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),suppFob:42}}));
  try{
    shift.offset=864e5;
    const r=await h.read('gün dönümü',[{items}],{expectIncremental:false});
    assert.equal(r.pilot.incremental,false,'imza (yerel gün) değişti: artımlı plan yok, tam hesap');
  }finally{global.Date=RealDate;}
});

test('pilot gölge: yapılandırma (transit kuralı) değişince yeni barındırıcı + tam hesap; tam hesapla birebir',{timeout:600000},async()=>{
  const user={id:'moderator',all:true,buyers:[]};
  const h=harness(user,fx);await h.start();
  const before=task.hostCount();
  const rules=[{id:'t-air',seasons:[],countries:[],delType:'',days:7,exfStart:'',exfEnd:''}];
  h.state.context=contextFor(user.id,rules);h.state.overrides.transitRules=rules;
  const items=h.state.disk.rows.filter((row,i)=>i%101===4).slice(0,6).map(row=>({orderCode:Number(row['Order Code']),patch:{...lineOf(row),delType:'Uçak'}}));
  const r=await h.read('transit kuralı değişti',[{items}],{expectIncremental:false});
  assert.equal(r.pilot.incremental,false,'barındırıcı anahtarı değişti: önceki sonuç kullanılmadı');
  assert.ok(r.pilot.hostMs>0||task.hostCount()>=before,'yeni barındırıcı kuruldu');
});

test('pilot: başka kullanıcının kaydı bu kullanıcının zincirini kurmaz (okuma gerçek nesle düşer)',()=>{
  const log=createCpRowPatchLog();const safe=()=>true;
  const items=[{orderCode:1,patch:{suppFob:1}}];
  assert.ok(log.record({userId:'a',before:'h1',after:'h2',items,context:{},safe}));
  // b'nin kaydı a'nın bağlamını h2 → h3 kaydırır ama a'nın günlüğüne girmez.
  assert.ok(log.record({userId:'b',before:'h2',after:'h3',items,context:{},safe}));
  assert.ok(log.chain('a','h1','h2'));
  assert.equal(log.chain('a','h1','h3'),null,'zincir yok → servis projeksiyon kirasıyla gerçek nesli okur');
});

/* Kaynak sözleşmesi (server.js tek parça; rota testi tam sunucu ister): pilot üç eski rotada yazımın hemen ardından
   kaydeder, rowPatch'i yeniden yazıma (settle → doğrulama) geçirir, varsayılan kapalıdır ve 'importance' yamasını almaz. */
test('pilot kaynak sözleşmesi: eski rotalar günlüğe bayrakla yazar; damga yazımdan önce; importance kaydedilmez',()=>{
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','server','server.js'),'utf8');
  const fn=src.slice(src.indexOf('function legacyCpReadBefore'),src.indexOf('function assertAutomaticDatesReadOnly'));
  assert.match(fn,/process\.env\.BUYER_LOG_CP_ROWPATCH_LEGACY!=='1'/,'varsayılan kapalı');
  assert.match(fn,/computeReadContext\(null,beforeContext\)\.contextHash/,'satır kaydıyla aynı okuma bağlamı damgası');
  assert.match(fn,/'importance'/,'importance yaması kaydedilmez');
  assert.match(fn,/recordCpRowPatches\(\{user:currentUser,before:readBefore,items\}\)/,'satır kaydıyla aynı kayıt');
  /* Her rota: bağlam → damga (yazımdan önce) → yazım → kayıt → yeniden yazım (aynı yama + rowPatch). Arada await yok:
     başka bir yazım araya giremez (damga ile kayıt aynı geçişi tanımlar). */
  const re=/const beforeContext=writeProjectionContext\(req\.currentUser\);\n\s*const readBefore=legacyCpReadBefore\(beforeContext\);([\s\S]*?)const rowPatch=recordLegacyCpRowPatches\(req\.currentUser,readBefore,([^\n]*?)\);\n([\s\S]*?)queueProjectionCacheRowPatches\(req\.currentUser,beforeContext,([^\n]*?),'(\w+)',rowPatch\);/g;
  const calls=[...src.matchAll(re)];
  assert.equal(calls.length,3,'PATCH /:kod, /batch, /batch-suppfob');
  for(const m of calls){
    assert.match(m[1],/const saved = patch\w+\(/,'damga yazımdan önce, kayıt yazımdan sonra');
    assert.doesNotMatch(m[1]+m[3],/\bawait\b/,'damga ile kayıt arasında await yok');
    assert.equal(m[2],m[4],'günlüğe yazılan yama ile projeksiyona uygulanan yama aynı');
  }
});
test('pilot: importance yaması kayıtlı bağlamla gerçek nesilden farklı sonuç verir (dışlamanın gerekçesi)',()=>{
  const row={'Order Code':4100001,'Model Name':'M','C.Code':'C1',Line:'KADIN',Season:'25Y'};
  const item={orderCode:4100001,patch:{model:'M',ccode:'C1',importance:'regular'}};
  const full={notesmap:{},noteColumnDefs:[],transitRules:TRANSIT,importancemap:{[parse.orderLineKey(4100001,'M','C1')]:'regular'}};
  const real={...row},virtual={...row};
  applyIncrementalProjectionPatch(real,item.patch,full,true);
  applyIncrementalProjectionPatch(virtual,item.patch,recordedContext([item],full),true);
  assert.notEqual(JSON.stringify(real),JSON.stringify(virtual),'kayıtlı bağlam önem haritasını taşımıyor');
});
