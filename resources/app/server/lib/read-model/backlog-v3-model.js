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
  return {...codec.decodeItems(value),calendar:value.calendar||null,today:value.today||null,sourceRevision:value.sourceRevision||null};
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
  const priority=applyPriority(dataset,request.priority,key);
  const opts=viewOptions(request.view,request.priority,priority.ready);
  let body;
  if(request.drill&&typeof request.drill==='object')body={kind:'drill',dataset:key,...drillPayload(V3.selectItems(dataset.items,request.drill,opts))};
  else body={kind:'model',dataset:key,priority:{ready:priority.ready,needKeys:priority.needKeys},model:V3.panelModel(dataset.items,opts),
    ...(priority.needKeys?{keys:dataset.keys}:{}),sourceRevision:dataset.sourceRevision};
  const computeMs=performance.now()-computeAt;
  const json=Buffer.from(JSON.stringify(body));
  const gzip=zlib.gzipSync(json,{level:1});
  return {buffer:new Uint8Array(gzip.buffer,gzip.byteOffset,gzip.byteLength),uncompressedBytes:json.length,
    timing:{decodeMs,computeMs,totalMs:performance.now()-started,rows:dataset.items.length}};
}
module.exports={execute,decode,applyPriority,viewOptions,drillPayload,ROW_LIMIT,_datasets:datasets};
