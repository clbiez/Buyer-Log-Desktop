'use strict';
/* Backlog V3 Genel Bakış okuma modeli — okuma modeli işçisi görevi (#1079 WS6c).
 *
 * Girdi: hesap işçisinin ürettiği sütunlu V3 kayıtları (backlog-v3-items.js; gzip
 * JSON). İlk istekte çözülür ve bu işçide küçük bir LRU'da tutulur; görünüm
 * değişimi (gruplama, zaman alanı, önem kapsamı, öncelik etiketleri, dil) ve
 * drill-down aynı kayıtlar üzerinde yeniden hesaplanır, export yeniden üretilmez.
 * Toplulaştırma tarayıcıdaki AYNI modülle (BLBacklogV3Report.panelModel /
 * selectItems / drawerPayload) yapılır.
 *
 * Öncelik: CP öncelik dizini yalnız tarayıcıda vardır. İstemci, kayıtların öncelik
 * anahtarları (lineId sözlüğü) için dizin isabetini priorityAnnotation ile
 * hesaplayıp sözlük + anahtar başına indeks olarak gönderir; burada her kayda
 * applyPriorityAnnotation ile işlenir. Anahtarlar eşleşmezse (veri kümesi değişti)
 * yanıt `needKeys` ile anahtar listesini döner ve model öncelik bekliyor durumunda kalır.
 *
 * Yetki: kayıtlar kullanıcının kapsamıyla süzülmüş export satırlarından gelir;
 * burada satır eklenmez. Drill-down yalnız aynı kümeden seçer.
 */
const zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
globalThis.BLCanonicalFields=globalThis.BLCanonicalFields||require('../canonical-fields');
const V3=require('../../../public/backlog-v3-report.js');
const dates=require('../../../public/date-dimension');
const codec=require('./backlog-v3-items');
const Delivery=require('../../../public/backlog-delivery-engine.js');
const Insights=require('../../../public/backlog-delivery-insights.js');
const OD=require('../../../public/order-decision-engine.js');

const ROW_LIMIT=500;
const MAX_DATASETS=2;
const datasets=new Map();
function remember(key,dataset){
  datasets.delete(key);datasets.set(key,dataset);
  while(datasets.size>MAX_DATASETS)datasets.delete(datasets.keys().next().value);
}
function decode(buffer){
  const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer instanceof ArrayBuffer?new Uint8Array(buffer):buffer);
  const value=JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
  return {...codec.decodeItems(value),kind:value.kind==='delivery'?'delivery':'v3',calendar:value.calendar||null,today:value.today||null,sourceRevision:value.sourceRevision||null,deliveryCache:null};
}
function invalid(detail){return Object.assign(new Error('Geçersiz Backlog V3 isteği. / Invalid Backlog V3 request.'),{code:'READ_MODEL_QUERY_INVALID',statusCode:400,detail});}

/* İstemcinin gönderdiği öncelik tablosu: table = farklı açıklamalar, index = anahtar başına
   tablo indeksi (anahtar sırası = lineId sözlüğü). empty = isabetsiz satırın açıklaması. */
function annotationOf(raw){
  const a=raw&&typeof raw==='object'?raw:{};
  const list=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'):[];
  return {priorityCode:typeof a.priorityCode==='string'?a.priorityCode:'',prioritySource:typeof a.prioritySource==='string'?a.prioritySource:'',trackingTags:list(a.trackingTags),priorityTags:list(a.priorityTags)};
}
function applyPriority(dataset,priority,token){
  const p=priority&&typeof priority==='object'?priority:{};
  const empty=annotationOf(p.empty);
  const ready=p.ready===true;
  const table=Array.isArray(p.table)?p.table.map(annotationOf):null;
  const index=typeof p.index==='string'?p.index.split(',').map(Number):Array.isArray(p.index)?p.index.map(Number):null;
  const valid=ready&&p.keysToken===token&&table&&index&&dataset.keyIndex&&index.length===dataset.keys.length&&index.every(i=>Number.isInteger(i)&&i>=-1&&i<table.length);
  const {items,keyIndex}=dataset;
  for(let i=0;i<items.length;i++){
    const at=valid?index[keyIndex[i]]:-1;
    V3.applyPriorityAnnotation(items[i],at>=0?table[at]:empty);
  }
  return {ready:!!valid,needKeys:ready&&!valid};
}
function viewOptions(view,priority,priorityReady){
  const v=view&&typeof view==='object'?view:{};
  const filters=Array.isArray(v.filters)?v.filters.filter(f=>f&&typeof f==='object'&&typeof f.id==='string'&&typeof f.rowKey==='string').map(f=>({
    id:f.id,rowKey:f.rowKey,header:String(f.header||''),label:String(f.label||''),values:Array.isArray(f.values)?f.values.map(String):[],from:String(f.from||''),to:String(f.to||'')})):[];
  const kinds={};
  if(v.filterKinds&&typeof v.filterKinds==='object')for(const [id,kind] of Object.entries(v.filterKinds))if(kind==='date'||kind==='values')kinds[id]=kind;
  const ranks={};
  if(priority&&priority.ranks&&typeof priority.ranks==='object')for(const [code,rank] of Object.entries(priority.ranks))if(Number.isFinite(Number(rank)))ranks[code]=Number(rank);
  return {lang:v.lang==='en'?'en':'tr',groupBy:String(v.groupBy||''),timeField:String(v.timeField||''),granularity:v.granularity==='month'?'month':'week',
    timelineDimension:String(v.timelineDimension||''),importanceScope:String(v.importanceScope||'all'),filters,filterKinds:kinds,
    priorityReady,ranks,today:typeof v.today==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v.today)?v.today:undefined};
}
// Çekmece: ilk ROW_LIMIT satır tam kayıt, bütün liste görsel kimliği için (yinelenen kimlik bir kez, ilk sırasıyla).
const IDENTITY_KEYS=Object.freeze(['orderCode','modelName','colourCode','colour','season']);
function drillPayload(list){
  const payload=V3.drawerPayload(list,ROW_LIMIT),seen=new Set(),identities=[];
  payload.list.forEach((item,index)=>{
    const identity={row:item.row};for(const key of IDENTITY_KEYS)identity[key]=item[key];
    const signature=JSON.stringify(identity);if(seen.has(signature))return;seen.add(signature);
    identities.push([index,identity]);
  });
  return {summary:payload.summary,count:payload.count,rows:payload.rows,identities};
}

/* ---------------------------------------------------- Teslimat Riski paneli
   Tarayıcıdaki akışın aynısı: tarih sırası istemcinin dateOrdinal'ından (farklı değer
   başına bir kez; anahtar Engine.dateKey), analiz varsayılan öncelik kataloğuyla
   (tarayıcıda taze Web Worker), aksiyon grupları ve yorumlar kullanıcının kataloğuyla
   (tarayıcıda ana iş parçacığı). Sipariş listeleri tarayıcıya gitmez; drill-down
   satır sırası (export sırası) olarak döner, satırlar rota tarafından yüklenir. */
function deliveryDateKeys(dataset){
  if(dataset.dateKeys)return dataset.dateKeys;
  const seen=new Set(),keys=[];
  for(const row of dataset.delivery)for(const value of Delivery.rowDateValues(row)){const key=Delivery.dateKey(value);if(!seen.has(key)){seen.add(key);keys.push(key);}}
  return dataset.dateKeys=keys;
}
function withCatalog(catalog,fn){
  const previous=OD.getPriorityCatalog();
  try{OD.setPriorityCatalog(catalog);return fn();}
  finally{OD.setPriorityCatalog(previous);}
}
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
function deliveryInputs(raw){
  const r=plainObject(raw)||{};
  const bounds=plainObject(r.bounds);
  const num=value=>value==null?null:Number.isFinite(Number(value))?Number(value):null;
  return {settings:{...(plainObject(r.settings)||{})},bounds:bounds?{from:num(bounds.from),to:num(bounds.to)}:null,today:num(r.today),
    lang:r.lang==='en'?'en':'tr',preferences:plainObject(r.preferences)||undefined,customRules:Array.isArray(r.customRules)?r.customRules:[],
    catalog:Array.isArray(r.catalog)&&r.catalog.length?r.catalog:null,ordinals:plainObject(r.ordinals)};
}
function deliveryAnalysis(dataset,key,inputs){
  const keys=deliveryDateKeys(dataset),o=inputs.ordinals;
  const values=o&&o.token===key&&Array.isArray(o.values)&&o.values.length===keys.length&&o.values.every(v=>v===null||Number.isFinite(v))?o.values:null;
  if(!values)return null;
  const cacheKey=JSON.stringify([inputs.settings,inputs.bounds,inputs.today,values]);
  if(dataset.deliveryCache&&dataset.deliveryCache.key===cacheKey)return dataset.deliveryCache;
  const map=new Map(keys.map((dateKey,index)=>[dateKey,values[index]]));
  const ordinal=value=>{const hit=map.get(Delivery.dateKey(value));return hit===undefined?null:hit;};
  // Tarayıcı işçisi kataloğu ayarlanmamış (varsayılan) bir motorla analiz eder.
  const result=withCatalog(null,()=>Delivery.analyzeDataset(dataset.delivery,{settings:inputs.settings,bounds:inputs.bounds,today:inputs.today,dateOrdinal:ordinal}));
  const orderIndex=new Map(result.model.orders.map((order,index)=>[order,result.rowIndices[index]]));
  return dataset.deliveryCache={key:cacheKey,...result,orderIndex};
}
function deliveryBody(dataset,key,request){
  const inputs=deliveryInputs(request.delivery);
  const analysis=deliveryAnalysis(dataset,key,inputs);
  if(!analysis)return {kind:'delivery',dataset:key,needDates:true,dateKeys:deliveryDateKeys(dataset)};
  if(request.drill){
    const orders=withCatalog(inputs.catalog,()=>Delivery.selectOrders(analysis.model,request.drill));
    return {kind:'deliveryDrill',dataset:key,indices:orders.map(order=>analysis.orderIndex.get(order))};
  }
  return withCatalog(inputs.catalog,()=>{
    const groups=Delivery.needsAttention(analysis.model,{limit:500});
    const insights=Insights.build(analysis.model,{lang:inputs.lang,preferences:inputs.preferences,customRules:inputs.customRules});
    const {orders,topRiskOrders,...model}=analysis.model;
    dataset.parity=dataset.parity||Delivery.parityTotals(dataset.delivery);
    return {kind:'delivery',dataset:key,model:{...model,orders:[],topRiskOrders:[],orderCount:orders.length},
      attention:{counts:groups.counts,quantities:groups.quantities},insights:insights.map(({orders:_,...insight})=>insight),
      periodRowCount:analysis.periodRowCount,totalRowCount:analysis.totalRowCount,parity:dataset.parity};
  });
}

function execute(payload){
  const started=performance.now(),p=payload&&typeof payload==='object'?payload:{};
  const key=String(p.datasetKey||'');if(!key)throw invalid('datasetKey');
  let dataset=datasets.get(key),decodeMs=0;
  if(!dataset){
    if(!p.buffer)return {missing:true};
    const at=performance.now();dataset=decode(p.buffer);p.buffer=null;decodeMs=performance.now()-at;
  }
  remember(key,dataset);
  // Zaman çizelgesi kovaları iş takvimine bağlıdır; veri kümesiyle gelen takvim kurulur.
  if(dataset.calendar&&dataset.calendar.configured)dates.setMerchCalendar(dataset.calendar.calendar);else dates.clearMerchCalendar();
  const request=p.request&&typeof p.request==='object'?p.request:{};
  const computeAt=performance.now();
  let body;
  // Veri kümesi türü panelle eşleşmeli (anahtarlar yükten üretilir; yine de savunma).
  if((request.panel==='delivery')!==(dataset.kind==='delivery'))throw invalid('panel');
  if(request.panel==='delivery')body=deliveryBody(dataset,key,request);
  else{
  const priority=applyPriority(dataset,request.priority,key);
  const opts=viewOptions(request.view,request.priority,priority.ready);
  // Öncelik tablosu bu veri kümesine ait değilse (hesap önbelleği yenilendi) etiketli seçim boş kalırdı:
  // anahtarlar döner, istemci tabloyu yeniden kurup drill-down'ı tekrarlar.
  if(request.drill&&typeof request.drill==='object')body=priority.needKeys?{kind:'drill',dataset:key,needKeys:true,keys:dataset.keys}
    :{kind:'drill',dataset:key,...drillPayload(V3.selectItems(dataset.items,request.drill,opts))};
  else body={kind:'model',dataset:key,priority:{ready:priority.ready,needKeys:priority.needKeys},model:V3.panelModel(dataset.items,opts),
    ...(priority.needKeys?{keys:dataset.keys}:{}),sourceRevision:dataset.sourceRevision};
  }
  const computeMs=performance.now()-computeAt;
  const json=Buffer.from(JSON.stringify(body));
  const gzip=zlib.gzipSync(json,{level:1});
  return {buffer:new Uint8Array(gzip.buffer,gzip.byteOffset,gzip.byteLength),uncompressedBytes:json.length,
    timing:{decodeMs,computeMs,totalMs:performance.now()-started,rows:(dataset.items||dataset.delivery).length}};
}
module.exports={execute,decode,applyPriority,viewOptions,drillPayload,deliveryDateKeys,deliveryBody,ROW_LIMIT,_datasets:datasets};
