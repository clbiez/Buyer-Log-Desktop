'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { SERVER_DATA_ROOT, atomicWriteBuffer } = require('../user-data');
const { createDocumentApi, toDocumentRecord } = require('./delta-store');

const SCHEMA_VERSION = 1;
const PERSISTED_FILE = path.join(SERVER_DATA_ROOT, 'endeksmatik-snapshot.json.gz');
const DEFAULT_FILE = path.join(__dirname, '..', 'templates', 'endeksmatik-default.json.gz');
const COLLECTION = 'endeksmatik';
const DOCUMENT_ID = 'snapshot';
const COMPONENTS = Object.freeze(['fabric', 'cmt', 'accessory', 'extra']);
let cached = null;
let cachedFile = '';
let _xlsx = null;
let documents = createDocumentApi(null, COLLECTION);
function attachDeltaStore(store) { documents = createDocumentApi(store, COLLECTION); }
// Delta motoru alan bazlı merge eder. Snapshot'ın kısmi alanlarının farklı
// cihazlardan karışmaması için bütün içerik tek belge alanında taşınır.
function toSharedDocument(snapshot){ return {snapshot}; }
function fromSharedDocument(document){ return document&&document.snapshot&&typeof document.snapshot==='object'?document.snapshot:document; }
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }

function text(value){ return String(value == null ? '' : value).trim().replace(/\s+/g,' '); }
function stripTotal(value){ const v=text(value); return /^toplam\s+/i.test(v) ? v.replace(/^toplam\s+/i,'').trim() : v; }
function norm(value){
  return stripTotal(value).toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function keyOf(values){ return (values||[]).map(norm).join('\u001f'); }
function numberValue(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const raw=text(value); if(!raw)return null;
  let v=raw.replace(/\s+/g,'');
  if(v.includes(',')&&v.includes('.'))v=v.lastIndexOf(',')>v.lastIndexOf('.')?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,'');
  else if(v.includes(','))v=v.replace(',','.');
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function monthCode(value){ const v=text(value); const m=/^(\d{4})(\d{2})$/.exec(v); if(!m)return ''; const mo=Number(m[2]); return mo>=1&&mo<=12?v:''; }
function excelDate(value){
  const n=numberValue(value); if(!Number.isFinite(n))return '';
  const d=new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000); return d.toISOString().slice(0,10);
}
function recordKey(record){ return keyOf(record.slice(0,5)); }
function recordNoSupplyKey(record){ return keyOf([record[0],record[1],record[3],record[4]]); }
function buildRuntime(snapshot){
  if(!snapshot||Number(snapshot.schemaVersion)!==SCHEMA_VERSION||!Array.isArray(snapshot.months)||!Array.isArray(snapshot.records))throw new Error('Endeksmatik snapshot formatı geçersiz.');
  const monthIndex=new Map(snapshot.months.map((m,i)=>[String(m),i]));
  const byKey=new Map(), byNoSupply=new Map();
  snapshot.records.forEach(record=>{
    if(!Array.isArray(record)||record.length<13)return;
    const key=recordKey(record); if(!key||byKey.has(key))return;
    byKey.set(key,record);
    const short=recordNoSupplyKey(record); if(!byNoSupply.has(short))byNoSupply.set(short,[]); byNoSupply.get(short).push(record);
  });
  return {snapshot,monthIndex,byKey,byNoSupply};
}
function readSnapshotFile(file){ return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
function loadSnapshot({force=false}={}){
  const shared=fromSharedDocument(documents.read(DOCUMENT_ID));
  if(shared){
    const source=`delta:${shared.generatedAt||shared.sourceUpdatedAt||shared._updatedAt||''}`;
    if(!force&&cached&&cachedFile===source)return cached;
    cached=buildRuntime(shared); cachedFile=source; return cached;
  }
  const file=fs.existsSync(PERSISTED_FILE)?PERSISTED_FILE:DEFAULT_FILE;
  if(!force&&cached&&cachedFile===file)return cached;
  if(!fs.existsSync(file))throw new Error('Endeksmatik veri snapshotı bulunamadı.');
  cached=buildRuntime(readSnapshotFile(file)); cachedFile=file; return cached;
}
/* Hedef düzeltme yüzdesinin varsayılanı YALNIZ yüklenen dosyadan gelir.
   Eski anlık görüntülerde bu alan yok; onlarda 0 kabul edilir çünkü mevcut
   referans hesabı (tests/endeksmatik-v547) düzeltmesiz doğrulanmıştı ve
   varsayılanı elle 3'e çekmek o kaydın sonuçlarını geriye dönük değiştirirdi.
   Yeni ENDEKSMATİK dosyası yüklendiğinde B22 okunur ve varsayılan onunla gelir. */
function defaultAdjustmentPct(snapshot){
  const value=Number(snapshot&&snapshot.targetAdjustmentPct);
  return Number.isFinite(value)&&value>=-100&&value<=100?value:0;
}
function publicStatusForSnapshot(snapshot,usingDefault=false){
  return {ok:true,schemaVersion:snapshot.schemaVersion,sourceFile:snapshot.sourceFile||'',season:snapshot.season||'',sourceUpdatedAt:snapshot.sourceUpdatedAt||'',targetAdjustmentPct:defaultAdjustmentPct(snapshot),generatedAt:snapshot.generatedAt||'',recordCount:snapshot.records.length,firstMonth:snapshot.months[0]||'',lastMonth:snapshot.months[snapshot.months.length-1]||'',fxFirst:Object.keys(snapshot.fx||{}).sort()[0]||'',fxLast:Object.keys(snapshot.fx||{}).sort().slice(-1)[0]||'',usingDefault};
}
function publicStatus(){
  const {snapshot}=loadSnapshot();
  return publicStatusForSnapshot(snapshot,cachedFile===DEFAULT_FILE);
}
function resolveRecord(input,runtime=loadSnapshot()){
  const dims=[input.mmyg,input.mag,input.supplyGroup,input.buyingGroup,input.category];
  if(text(input.supplyGroup)){
    const record=runtime.byKey.get(keyOf(dims));
    if(!record)throw Object.assign(new Error('Bu MMYG + MAG + Tedarik Grup + Buying Group + Klasman kombinasyonu Endeksmatik verisinde bulunamadı.'),{code:'CLASS_NOT_FOUND',statusCode:422});
    return record;
  }
  const short=keyOf([input.mmyg,input.mag,input.buyingGroup,input.category]);
  const candidates=runtime.byNoSupply.get(short)||[];
  if(candidates.length===1)return candidates[0];
  if(!candidates.length)throw Object.assign(new Error('Bu MMYG + MAG + Buying Group + Klasman kombinasyonu Endeksmatik verisinde bulunamadı.'),{code:'CLASS_NOT_FOUND',statusCode:422});
  const supplyGroups=[...new Set(candidates.map(r=>r[2]).filter(Boolean))];
  throw Object.assign(new Error('Tedarik Grup otomatik belirlenemedi. Lütfen Tedarik Grup seçin.'),{code:'SUPPLY_GROUP_AMBIGUOUS',statusCode:422,details:{supplyGroups}});
}
function requireMonth(value,label,runtime){
  const code=monthCode(value); if(!code)throw Object.assign(new Error(`${label} YYYYAA formatında geçerli bir ay olmalıdır.`),{code:'MONTH_INVALID',statusCode:400});
  if(!runtime.monthIndex.has(code))throw Object.assign(new Error(`${label} (${code}) Endeksmatik component veri aralığında yok.`),{code:'MONTH_OUT_OF_RANGE',statusCode:422});
  return code;
}
function seriesValue(record,seriesOffset,month,runtime,label){
  const arr=record[seriesOffset],idx=runtime.monthIndex.get(month),value=Array.isArray(arr)?numberValue(arr[idx]):null;
  if(!Number.isFinite(value)||value<=0)throw Object.assign(new Error(`${label} için ${month} Endeksmatik değeri bulunamadı.`),{code:'COMPONENT_VALUE_MISSING',statusCode:422,details:{component:label,month}});
  return value;
}
function requireMonthOrder(later,earlier,laterLabel,earlierLabel){
  if(String(later)<String(earlier))throw Object.assign(new Error(`${laterLabel}, ${earlierLabel} tarihinden eski olamaz.`),{code:'MONTH_ORDER_INVALID',statusCode:422,details:{later,earlier,laterLabel,earlierLabel}});
}
function calculate(input,runtime=loadSnapshot()){
  const record=resolveRecord(input,runtime);
  const previousOrderMonth=requireMonth(input.previousOrderMonth,'Geçen sipariş ayı',runtime);
  const previousInStoreMonth=requireMonth(input.previousInStoreMonth,'Geçen In Store ayı',runtime);
  const newOrderMonth=requireMonth(input.newOrderMonth,'Yeni sipariş ayı',runtime);
  const newInStoreMonth=requireMonth(input.newInStoreMonth,'Yeni In Store ayı',runtime);
  const separateTryPeriods=Boolean(input.separateTryPeriods);
  const previousTryOrderMonth=separateTryPeriods?requireMonth(input.previousTryOrderMonth,'TR geçen sipariş ayı',runtime):previousOrderMonth;
  const previousTryInStoreMonth=separateTryPeriods?requireMonth(input.previousTryInStoreMonth,'TR geçen In Store ayı',runtime):previousInStoreMonth;

  // Tarih güvenliği hem UI'da hem sunucuda deterministic olarak uygulanır.
  requireMonthOrder(previousInStoreMonth,previousOrderMonth,'Geçen In Store ayı','Geçen sipariş ayı');
  requireMonthOrder(newInStoreMonth,newOrderMonth,'Yeni In Store ayı','Yeni sipariş ayı');
  requireMonthOrder(newInStoreMonth,previousInStoreMonth,'Yeni In Store ayı','Geçen In Store ayı');
  if(separateTryPeriods){
    requireMonthOrder(previousTryInStoreMonth,previousTryOrderMonth,'TR geçen In Store ayı','TR geçen sipariş ayı');
    requireMonthOrder(newInStoreMonth,previousTryInStoreMonth,'Yeni In Store ayı','TR geçen In Store ayı');
  }

  const weights=record.slice(5,9).map(numberValue);
  if(weights.some(v=>!Number.isFinite(v)))throw Object.assign(new Error('Klasman maliyet ağırlıkları eksik.'),{code:'WEIGHTS_MISSING',statusCode:422});
  const weightTotal=weights.reduce((a,b)=>a+b,0);
  if(Math.abs(weightTotal-1)>0.03)throw Object.assign(new Error(`Klasman maliyet ağırlıkları %100'e yakın değil (${(weightTotal*100).toFixed(2)}%).`),{code:'WEIGHTS_INVALID',statusCode:422});
  const labels=['Kumaş','CMT','Aksesuar','Ek İşlem'];
  /* HEDEF DÜZELTME YÜZDESİ (v6.02 — v5.94'te kaldırılmıştı, geri getirildi)
     Kaynak Excel hedef fiyatı (1+endeks)×(1−düzeltme) ile hesaplıyor; düzeltme
     ENDEKSMATİK!B22'de duruyor (%3). v5.94'te Royalty/Hologram eklenirken bu
     alan kaldırılmıştı, ancak yeni Excel'de hâlâ hesabın parçası.
     Artık AYARLANABİLİR: istek gövdesinde bir değer varsa o kullanılır, yoksa
     kaynak dosyadan okunan orijinal değere düşülür. */
  const adjustmentRaw=numberValue(input.adjustmentPct);
  const adjustmentPct=Number.isFinite(adjustmentRaw)?adjustmentRaw:defaultAdjustmentPct(runtime.snapshot);
  const a=adjustmentPct/100;
  /* ROYALTY + HOLOGRAM (v5.94)
     Endeksleme aradaki farkı YÜZDE olarak uygular. Royalty payı ve sabit hologram
     bedeli endekslenmemeli: ikisi de fiyatın üzerine sonradan binen masraflardır.
     Bu yüzden:
       · royaltyIncluded=false → fiyat zaten masrafsızdır; endeksle, sonra ekle.
       · royaltyIncluded=true  → fiyattan önce masrafları ÇIKAR, endeksle, sonra ekle.
     Formüller License Royalty Rules ile aynı:
       masrafsız = (fiyat − hologram) × (1 − royalty%)
       masraflı  = fiyat ÷ (1 − royalty%) + hologram
     Hologram USD cinsinden sabit bir birim maliyettir; TL fiyatta kullanılırken
     ilgili dönemin kuruyla çevrilir — eski fiyattan çıkarırken ESKİ dönem kuru,
     yeni fiyata eklerken YENİ dönem kuru. Aksi halde iki farklı dönemin TL'si
     aynı kurla karıştırılmış olurdu. */
  const royaltyRaw=numberValue(input.royaltyPct);
  const royaltyPct=Number.isFinite(royaltyRaw)&&royaltyRaw>=0&&royaltyRaw<100?royaltyRaw:0;
  const hologramRaw=numberValue(input.hologramCost);
  const hologramUsd=Number.isFinite(hologramRaw)&&hologramRaw>=0?hologramRaw:0;
  const royaltyIncluded=Boolean(input.royaltyIncluded);
  const royaltyActive=royaltyPct>0||hologramUsd>0;
  const stripCosts=(price,hologram)=>{
    if(!Number.isFinite(price)||!royaltyActive)return price;
    return (price-hologram)*(1-royaltyPct/100);
  };
  const addCosts=(price,hologram)=>{
    if(!Number.isFinite(price)||!royaltyActive)return price;
    return price/(1-royaltyPct/100)+hologram;
  };
  const buildIndex=(oldOrder,oldStore)=>{
    const monthPairs=[[oldOrder,newOrderMonth],[oldStore,newInStoreMonth],[oldOrder,newOrderMonth],[oldStore,newInStoreMonth]];
    const items=COMPONENTS.map((component,i)=>{
      const [oldMonth,newMonth]=monthPairs[i],offset=9+i;
      const oldValue=seriesValue(record,offset,oldMonth,runtime,labels[i]),newValue=seriesValue(record,offset,newMonth,runtime,labels[i]);
      const index=newValue/oldValue-1;
      return {component,label:labels[i],weight:weights[i],oldMonth,newMonth,oldValue,newValue,index};
    });
    const tlIndex=items.reduce((sum,item)=>sum+item.index*item.weight,0);
    const adjustedItems=items.map((item,i)=>({...item,targetIndex:(i<2?((1+item.index)*(1-a)-1):item.index)}));
    const targetTlIndex=adjustedItems.reduce((sum,item)=>sum+item.targetIndex*item.weight,0);
    return {items,adjustedItems,tlIndex,targetTlIndex};
  };

  // Overseas USD benchmark ortak/ana eski dönemleri kullanır. Domestic TRY benchmark
  // kullanıcı isterse ayrı eski sipariş/In Store dönemlerinden hesaplanabilir.
  const overseas=buildIndex(previousOrderMonth,previousInStoreMonth);
  const domestic=separateTryPeriods?buildIndex(previousTryOrderMonth,previousTryInStoreMonth):overseas;
  const fx=runtime.snapshot.fx||{},oldFx=numberValue(fx[previousInStoreMonth]),newFx=numberValue(fx[newInStoreMonth]);
  if(!Number.isFinite(oldFx)||oldFx<=0||!Number.isFinite(newFx)||newFx<=0)throw Object.assign(new Error('Seçilen Overseas In Store aylarından biri için USD/TL kuru bulunamadı.'),{code:'FX_MISSING',statusCode:422,details:{previousInStoreMonth,newInStoreMonth}});
  const usdIndex=(1+overseas.tlIndex)/(newFx/oldFx)-1;
  const targetUsdIndex=(1+usdIndex)*(1-a)-1;
  const previousTryPrice=numberValue(input.previousTryPrice),previousUsdPrice=numberValue(input.previousUsdPrice);
  const hologramTryOld=hologramUsd*oldFx, hologramTryNew=hologramUsd*newFx;
  // Endekslenecek taban: kullanıcı masraf dahil girdiyse önce masraflar çıkarılır.
  const baseTry=Number.isFinite(previousTryPrice)&&previousTryPrice>0
    ?(royaltyIncluded?stripCosts(previousTryPrice,hologramTryOld):previousTryPrice):null;
  const baseUsd=Number.isFinite(previousUsdPrice)&&previousUsdPrice>0
    ?(royaltyIncluded?stripCosts(previousUsdPrice,hologramUsd):previousUsdPrice):null;
  const indexedTryPrice=baseTry!=null?baseTry*(1+domestic.targetTlIndex):null;
  const indexedUsdPrice=baseUsd!=null?baseUsd*(1+targetUsdIndex):null;
  // Sonuç her iki durumda da masraflar DAHİL verilir.
  const newTryPrice=indexedTryPrice!=null?addCosts(indexedTryPrice,hologramTryNew):null;
  const newUsdPrice=indexedUsdPrice!=null?addCosts(indexedUsdPrice,hologramUsd):null;
  const {snapshot}=runtime;
  return {
    ok:true,
    class:{mmyg:record[0],mag:record[1],supplyGroup:record[2],buyingGroup:record[3],category:record[4]},
    months:{previousOrderMonth,previousInStoreMonth,newOrderMonth,newInStoreMonth,previousTryOrderMonth,previousTryInStoreMonth,separateTryPeriods},
    previousPrices:{try:Number.isFinite(previousTryPrice)?previousTryPrice:null,usd:Number.isFinite(previousUsdPrice)?previousUsdPrice:null},
    indexes:{tl:domestic.tlIndex,usd:usdIndex,targetTl:domestic.targetTlIndex,targetUsd:targetUsdIndex,overseasTl:overseas.tlIndex,targetOverseasTl:overseas.targetTlIndex,adjustmentPct},
    // Masrafların hesaba nasıl girdiği şeffaf olsun diye ayrıca bildirilir.
    costs:{royaltyPct,hologramUsd,royaltyIncluded,active:royaltyActive,
      hologramTry:{previous:hologramTryOld,new:hologramTryNew},
      indexedBase:{usd:baseUsd,try:baseTry},
      indexedBeforeCosts:{usd:indexedUsdPrice,try:indexedTryPrice}},
    fx:{previous:oldFx,new:newFx,change:newFx/oldFx-1},
    // Geriye uyumluluk için components Domestic/TR hesabını taşır. Ayrı dönem
    // seçildiyse iki hesap ayrıca componentsUsd / componentsTry olarak verilir.
    components:domestic.adjustedItems,
    componentsTry:domestic.adjustedItems,
    componentsUsd:overseas.adjustedItems,
    prices:{try:newTryPrice,usd:newUsdPrice},
    source:{sourceFile:snapshot.sourceFile||'',season:snapshot.season||'',sourceUpdatedAt:snapshot.sourceUpdatedAt||'',targetAdjustmentPct:defaultAdjustmentPct(snapshot)},
  };
}
function findHeaderRow(rows){
  for(let r=0;r<Math.min(rows.length,12);r++){
    const row=rows[r]||[]; if(row.some(v=>norm(v)==='MERCH MARKA YAS GRUP')&&row.some(v=>norm(v)==='KLASMAN'))return r;
  }
  return -1;
}
function parsePivotSheet(ws){
  const XLSX=getXLSX(),rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null}); const hr=findHeaderRow(rows); if(hr<0)throw new Error('Endeksmatik pivot başlığı bulunamadı.');
  const headers=rows[hr]||[]; const monthCols=[];
  headers.forEach((value,col)=>{const m=/^Toplam\s+(\d{6})$/i.exec(text(value));if(m)monthCols.push({col,month:m[1]});});
  if(!monthCols.length)throw new Error('Endeksmatik pivot ay sütunları bulunamadı.');
  const data=new Map();
  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]||[],dims=[row[1],row[2],row[3],row[4],row[5]].map(stripTotal); if(!dims.every(Boolean))continue;
    const key=keyOf(dims); if(data.has(key))continue;
    data.set(key,{dims,values:monthCols.map(({col})=>numberValue(row[col]))});
  }
  return {months:monthCols.map(x=>x.month),data};
}
function parseSummarySheet(ws){
  const XLSX=getXLSX(),rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null}); const hr=findHeaderRow(rows); if(hr<0)throw new Error('Endeksmatik klasman özet başlığı bulunamadı.');
  const data=new Map();
  for(let r=hr+1;r<rows.length;r++){
    const row=rows[r]||[],dims=[row[1],row[2],row[3],row[4],row[5]].map(stripTotal); if(!dims.every(Boolean))continue;
    const weights=[row[6],row[7],row[8],row[9]].map(numberValue); if(weights.some(v=>!Number.isFinite(v)))continue;
    const key=keyOf(dims); if(!data.has(key))data.set(key,{dims,weights});
  }
  return data;
}
function parseFxSheet(ws){
  const XLSX=getXLSX(),rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null}),out={};
  rows.forEach(row=>{const month=monthCode(row&&row[21]),rate=numberValue(row&&row[22]);if(month&&Number.isFinite(rate)&&rate>0&&!out[month])out[month]=rate;});
  return out;
}
function parseWorkbookBuffer(buffer,sourceFile='ENDEKSMATİK.xlsx'){
  const XLSX=getXLSX(),workbook=XLSX.read(buffer,{type:'buffer',cellDates:false,cellFormula:false});
  const required=['ENDEKSMATİK','KLASMAN LİSTESİ ÖZET','KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT','Değişimler'];
  required.forEach(name=>{if(!workbook.Sheets[name])throw Object.assign(new Error(`Endeksmatik Excel'de gerekli sayfa yok: ${name}`),{code:'SHEET_MISSING',statusCode:422});});
  const summary=parseSummarySheet(workbook.Sheets['KLASMAN LİSTESİ ÖZET']);
  const parsed={}; let months=null;
  [['fabric','KLASMAN KUMAŞ PİVOT'],['cmt','KLASMAN CMT PİVOT'],['accessory','KLASMAN AKSESUAR PİVOT'],['extra','KLASMAN EK İŞLEM PİVOT']].forEach(([key,name])=>{
    const p=parsePivotSheet(workbook.Sheets[name]); if(!months)months=p.months; else if(JSON.stringify(months)!==JSON.stringify(p.months))throw new Error(`${name} ay kolonları diğer Endeksmatik pivotlarıyla aynı değil.`); parsed[key]=p.data;
  });
  const records=[];
  for(const [key,item] of summary.entries()){
    const series=COMPONENTS.map(component=>parsed[component].get(key)?.values||Array(months.length).fill(null)); records.push([...item.dims,...item.weights,...series]);
  }
  if(!records.length)throw Object.assign(new Error('Endeksmatik klasman kaydı bulunamadı.'),{code:'NO_RECORDS',statusCode:422});
  const screen=workbook.Sheets['ENDEKSMATİK'];
  const season=text(screen.C1&&screen.C1.v); const sourceUpdatedAt=excelDate(screen.C2&&screen.C2.v); const fx=parseFxSheet(workbook.Sheets['Değişimler']);
  /* Hedef düzeltme yüzdesi (v6.02): kaynak Excel'de ENDEKSMATİK!B22'de ondalık
     kesir olarak durur (0,03 = %3). Programa GÖMMEK yerine dosyadan okunur;
     böylece Excel güncellendiğinde varsayılan da güncellenir. Hücre yoksa ya da
     makul aralığın dışındaysa 0 kabul edilir; geçerli B22 değeri ise yüzdeye
     çevrilerek snapshot içinde saklanır. */
  const adjustmentRaw=Number(screen.B22&&screen.B22.v);
  const targetAdjustmentPct=Number.isFinite(adjustmentRaw)&&adjustmentRaw>-1&&adjustmentRaw<1
    ? Math.round(adjustmentRaw*10000)/100
    : (Number.isFinite(adjustmentRaw)&&adjustmentRaw>=1&&adjustmentRaw<=100 ? adjustmentRaw : 0);
  if(!Object.keys(fx).length)throw Object.assign(new Error('Endeksmatik USD/TL kur tablosu bulunamadı.'),{code:'FX_TABLE_MISSING',statusCode:422});
  return {schemaVersion:SCHEMA_VERSION,sourceFile:path.basename(sourceFile||'ENDEKSMATİK.xlsx'),season,sourceUpdatedAt,targetAdjustmentPct,generatedAt:new Date().toISOString(),months,fx,records};
}
async function saveSnapshot(snapshot){
  // Validation/build first: an invalid upload can never replace the last working snapshot.
  buildRuntime(snapshot);
  const payload=zlib.gzipSync(Buffer.from(JSON.stringify(snapshot),'utf8'),{level:9});
  if(documents.writesLegacy)atomicWriteBuffer(PERSISTED_FILE,payload);
  const mirrored=await documents.mirror(DOCUMENT_ID, toSharedDocument(snapshot));
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik verisi ortak senkron günlüğüne yazılamadı.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  cached=buildRuntime(snapshot);cachedFile=`delta:${snapshot.generatedAt||snapshot.sourceUpdatedAt||''}`; return publicStatusForSnapshot(snapshot,false);
}
async function seedMissing(deltaStore){
  // Varsayılan şablonu değil, yalnız gerçekten var olan kullanıcı verisini
  // tohumla. Böylece boş/yeni cihaz paylaşımdaki dolu snapshot'ı gölgelemez.
  if(!deltaStore||!fs.existsSync(PERSISTED_FILE))return {seeded:0,ids:[]};
  const snapshot=readSnapshotFile(PERSISTED_FILE); buildRuntime(snapshot);
  return deltaStore.seedMissing(COLLECTION,{[DOCUMENT_ID]:toDocumentRecord(toSharedDocument(snapshot))});
}
async function importWorkbookBuffer(buffer,sourceFile){ return saveSnapshot(parseWorkbookBuffer(buffer,sourceFile)); }

module.exports={SCHEMA_VERSION,DEFAULT_FILE,PERSISTED_FILE,COLLECTION,DOCUMENT_ID,COMPONENTS,attachDeltaStore,seedMissing,text,norm,keyOf,numberValue,monthCode,loadSnapshot,publicStatus,resolveRecord,calculate,parseWorkbookBuffer,saveSnapshot,importWorkbookBuffer};
