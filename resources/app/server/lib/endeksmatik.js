'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteBuffer } = require('../user-data');
const { createDocumentApi, toDocumentRecord } = require('./delta-store');
const model = require('./endeksmatik-model');

const SCHEMA_VERSION = 1;
const PERSISTED_FILE = path.join(SERVER_DATA_ROOT, 'endeksmatik-snapshot.json.gz');
const DEFAULT_FILE = path.join(__dirname, '..', 'templates', 'endeksmatik-default.json.gz');
const COLLECTION = 'endeksmatik';
const DOCUMENT_ID = 'snapshot';
const COMPONENTS = Object.freeze(['fabric', 'cmt', 'accessory', 'extra']);
/* Her yeni USD veya TL çalışma kitabı bağımsız, dosya içeriğiyle kimliklenen
   bir set olur. Orijinal TL snapshot (DOCUMENT_ID='snapshot') 'legacy' altında
   korunur; yeni TL yüklemeleri artık onun üzerine yazılmaz. */
const LEGACY_SET_ID = 'legacy';
const SET_PREFIX = 'set:';
const ACTIVE_DOCUMENT_ID = 'sets-active';
const SETS_DIR = path.join(SERVER_DATA_ROOT, 'endeksmatik-sets');
const ACTIVE_FILE = path.join(SETS_DIR, 'active.json');
const setCache = new Map();
let cached = null;
let cachedFile = '';
let cachedTag = '';
let _xlsx = null;
let documents = createDocumentApi(null, COLLECTION);
function attachDeltaStore(store) { documents = createDocumentApi(store, COLLECTION); }
async function mirrorNativeDocuments(values,options={}){
  const result=await documents.mirrorMany(values,{guardSource:true,guardCollection:true,assertAuthority:options.assertAuthority});
  if(result.error&&['OFFICE_TOOL_FORBIDDEN','OFFICE_PREVIEW_CHANGED','OFFICE_AGENT_DISABLED'].includes(result.error.code))throw result.error;
  if(!documents.attached)options.assertAuthority?.();
  return result;
}
function activeSelectionValue(id,actor=''){return {activeSetId:id,updatedAt:new Date().toISOString(),updatedBy:String(actor||'')};}
function writeActiveLegacy(value){if(documents.writesLegacy){fs.mkdirSync(SETS_DIR,{recursive:true});atomicWriteBuffer(ACTIVE_FILE,Buffer.from(JSON.stringify(value),'utf8'));}}

// Delta motoru alan bazlı merge eder. Snapshot'ın kısmi alanlarının farklı
// cihazlardan karışmaması için bütün içerik tek belge alanında taşınır.
function toSharedDocument(snapshot){ return {snapshot}; }
function fromSharedDocument(document){
  if(document && Object.hasOwn(document,'snapshot')) return document.snapshot && typeof document.snapshot==='object' ? document.snapshot : null;
  return document;
}
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
  if(!fs.existsSync(file))throw new Error('Endeksmatik veri snapshotı bulunamadı.');
  const stat=fs.statSync(file),tag=stat.mtimeMs+':'+stat.size+':'+stat.ino;
  if(!force&&cached&&cachedFile===file&&cachedTag===tag)return cached;
  cached=buildRuntime(readSnapshotFile(file)); cachedFile=file;cachedTag=tag; return cached;
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
function legacyStatus(){
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
function calculateLegacy(input,runtime=loadSnapshot()){
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
  const backward=input.priceReference==='new';
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
    ?(royaltyIncluded?stripCosts(previousTryPrice,backward?hologramTryNew:hologramTryOld):previousTryPrice):null;
  const baseUsd=Number.isFinite(previousUsdPrice)&&previousUsdPrice>0
    ?(royaltyIncluded?stripCosts(previousUsdPrice,hologramUsd):previousUsdPrice):null;
  const indexedTryPrice=baseTry!=null?model.applyPriceIndex(baseTry,domestic.targetTlIndex,backward):null;
  const indexedUsdPrice=baseUsd!=null?model.applyPriceIndex(baseUsd,targetUsdIndex,backward):null;
  // Sonuç her iki durumda da masraflar DAHİL verilir.
  const newTryPrice=indexedTryPrice!=null?addCosts(indexedTryPrice,backward?hologramTryOld:hologramTryNew):null;
  const newUsdPrice=indexedUsdPrice!=null?addCosts(indexedUsdPrice,hologramUsd):null;
  const {snapshot}=runtime;
  return {
    ok:true,...(backward?{priceReference:'new'}:{}),
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
  const XLSX=getXLSX(),required=['ENDEKSMATİK','KLASMAN LİSTESİ ÖZET','KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT','Değişimler'];
  // Büyük kitaplarda yalnız gereken sayfalar ayrıştırılır.
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:false,cellFormula:false,sheets:required});
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
async function saveSnapshot(snapshot,options={}){
  // Validation/build first: an invalid upload can never replace the last working snapshot.
  buildRuntime(snapshot);
  const payload=zlib.gzipSync(Buffer.from(JSON.stringify(snapshot),'utf8'),{level:9});
  const active=options.activeSelectionId?activeSelectionValue(options.activeSelectionId,options.actor):null;
  const mirrored=await mirrorNativeDocuments({[DOCUMENT_ID]:toSharedDocument(snapshot),...(active?{[ACTIVE_DOCUMENT_ID]:active}:{})},options);
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik verisi ortak senkron günlüğüne yazılamadı.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  if(documents.writesLegacy)atomicWriteBuffer(PERSISTED_FILE,payload);
  if(active)writeActiveLegacy(active);
  cached=buildRuntime(snapshot);cachedFile=`delta:${snapshot.generatedAt||snapshot.sourceUpdatedAt||''}`; return publicStatusForSnapshot(snapshot,false);
}
async function seedMissing(deltaStore){
  // Varsayılan şablonu değil, yalnız gerçekten var olan kullanıcı verisini
  // tohumla. Böylece boş/yeni cihaz paylaşımdaki dolu snapshot'ı gölgelemez.
  if(!deltaStore)return {seeded:0,ids:[]};
  const records={};
  if(fs.existsSync(PERSISTED_FILE)){const snapshot=readSnapshotFile(PERSISTED_FILE); buildRuntime(snapshot); records[DOCUMENT_ID]=toDocumentRecord(toSharedDocument(snapshot));}
  // Yerel diskteki çoklu setler de (delta öncesi yüklenmişse) ortak günlüğe taşınır.
  try{fs.readdirSync(SETS_DIR).forEach(name=>{const m=/^(em-[0-9a-f]+)\.json\.gz$/.exec(name);if(!m)return;try{const set=readSnapshotFile(setFile(m[1]));buildSetRuntime(set);records[setDocumentId(m[1])]=toDocumentRecord({set,label:set.label||'',deleted:false,deletedAt:null});}catch(_){}});}catch(_){}
  try{if(fs.existsSync(ACTIVE_FILE))records[ACTIVE_DOCUMENT_ID]=toDocumentRecord(JSON.parse(fs.readFileSync(ACTIVE_FILE,'utf8')));}catch(_){}
  if(!Object.keys(records).length)return {seeded:0,ids:[]};
  return deltaStore.seedMissing(COLLECTION,records);
}
async function importLegacyWorkbookBuffer(buffer,sourceFile,options={}){return saveSnapshot(parseWorkbookBuffer(buffer,sourceFile),options);}

/* ------------------------------------------------------------ çoklu set deposu */
function setDocumentId(id){ return `${SET_PREFIX}${id}`; }
function safeSetId(id){ const v=String(id||'').trim(); return /^em-[0-9a-f]{8,64}$/.test(v)?v:''; }
function setFile(id){ return path.join(SETS_DIR,`${id}.json.gz`); }
// TL-format workbooks have the old 5-dimension record layout rather than the
// USD model's level-prefixed rows. Never attempt to index them as USD sets.
function buildSetRuntime(snapshot){
  return snapshot&&snapshot.model==='legacy-tl'?buildRuntime(snapshot):model.buildIndex(snapshot);
}
function publicSetMeta(snapshot){
  if(snapshot.model!=='legacy-tl')return model.publicMeta(snapshot);
  const status=publicStatusForSnapshot(snapshot);
  return {...status,id:snapshot.id,model:'legacy-tl',version:snapshot.hash,
    label:snapshot.label||'',region:snapshot.region||'',currency:'TRY',
    uploadedAt:snapshot.uploadedAt||'',uploadedBy:snapshot.uploadedBy||'',
    validation:null};
}
function versionedLegacySet(snapshot,buffer){
  const hash=crypto.createHash('sha256').update(buffer).digest('hex');
  return {...snapshot,model:'legacy-tl',id:`em-${hash.slice(0,16)}`,hash,
    label:'',region:'',currency:'TRY',uploadedAt:new Date().toISOString()};
}
function readSetDocument(id){
  const shared=documents.read(setDocumentId(id));
  if(shared)return shared.deleted||!shared.set?{deleted:true,stamp:`delta-del:${shared.deletedAt||''}`}:{set:shared.set,stamp:`delta:${shared.set.generatedAt||''}:${shared.label||''}`,label:shared.label};
  if(documents.isAuthoritative&&!documents.writesLegacy)return null;
  const file=setFile(id);if(!fs.existsSync(file))return null;
  const stat=fs.statSync(file);
  return {set:readSnapshotFile(file),stamp:`file:${stat.mtimeMs}:${stat.size}`};
}
function setIds(){
  const ids=new Set(documents.keys(SET_PREFIX).map(k=>k.slice(SET_PREFIX.length)));
  if(!documents.isAuthoritative||documents.writesLegacy){
    try{fs.readdirSync(SETS_DIR).forEach(name=>{const m=/^(em-[0-9a-f]+)\.json\.gz$/.exec(name);if(m)ids.add(m[1]);});}catch(_){}
  }
  return [...ids].filter(safeSetId);
}
function loadSet(id){
  const safe=safeSetId(id);if(!safe)return null;
  const doc=readSetDocument(safe);if(!doc||doc.deleted){setCache.delete(safe);return null;}
  const hit=setCache.get(safe);if(hit&&hit.stamp===doc.stamp)return hit;
  const snapshot=doc.label!==undefined?{...doc.set,label:doc.label}:doc.set;
  const entry={stamp:doc.stamp,snapshot,runtime:buildSetRuntime(snapshot)};setCache.set(safe,entry);return entry;
}
function readActiveSelection(){
  const shared=documents.read(ACTIVE_DOCUMENT_ID);
  if(shared)return shared;
  try{return JSON.parse(fs.readFileSync(ACTIVE_FILE,'utf8'));}catch(_){return {};}
}
function legacyMeta(){
  try{
    const s=legacyStatus();
    return {id:LEGACY_SET_ID,model:'legacy-tl',label:'Eski Endeksmatik (TL şablonu)',region:'',season:s.season,sourceFile:s.sourceFile,sourceUpdatedAt:s.sourceUpdatedAt,uploadedAt:s.generatedAt,version:`legacy:${s.sourceUpdatedAt||''}:${s.generatedAt||''}`,recordCount:s.recordCount,firstMonth:s.firstMonth,lastMonth:s.lastMonth,targetAdjustmentPct:s.targetAdjustmentPct,usingDefault:s.usingDefault};
  }catch(_){return null;}
}
function listSets(){
  const sets=setIds().map(id=>{try{const e=loadSet(id);return e?publicSetMeta(e.snapshot):null;}catch(_){return null;}}).filter(Boolean)
    .sort((a,b)=>String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  const legacy=legacyMeta();
  return legacy?[...sets,legacy]:sets;
}
function activeSetId(sets=listSets()){
  const selected=String(readActiveSelection().activeSetId||'');
  if(selected&&sets.some(s=>s.id===selected))return selected;
  // Seçim yoksa (ya da seçili set silindiyse) en son yüklenen USD seti, o da
  // yoksa eski şablon kullanılır.
  const newest=sets.find(s=>s.id!==LEGACY_SET_ID);
  return newest?newest.id:(sets.some(s=>s.id===LEGACY_SET_ID)?LEGACY_SET_ID:'');
}
function publicStatus(){
  const sets=listSets(),active=activeSetId(sets);
  if(!active||active===LEGACY_SET_ID){
    return {...legacyStatus(),model:'legacy-tl',setId:LEGACY_SET_ID,activeSetId:LEGACY_SET_ID,sets};
  }
  const meta=sets.find(s=>s.id===active);
  return {ok:true,...meta,setId:meta.id,activeSetId:active,sets,usingDefault:false};
}
function resolveSetForCalculation(setId){
  const requested=String(setId||'').trim();
  const id=requested||activeSetId();
  if(!id||id===LEGACY_SET_ID)return null;
  const entry=loadSet(id);
  if(!entry)throw Object.assign(new Error('Seçilen Endeksmatik seti bulunamadı ya da silinmiş.'),{code:'SET_NOT_FOUND',statusCode:404,details:{setId:id}});
  return entry;
}
/* Tek hesap giriş noktası. runtime verilirse (eski testler/araçlar) doğrudan
   eski TL hesabı çalışır; aksi halde istenen ya da varsayılan set kullanılır. */
function calculate(input,runtime){
  if(runtime)return calculateLegacy(input,runtime);
  const entry=resolveSetForCalculation(input&&input.setId);
  if(!entry){const out=calculateLegacy(input);out.model='legacy-tl';out.source={...out.source,setId:LEGACY_SET_ID,setVersion:legacyMeta()?.version||'',model:'legacy-tl'};return out;}
  if(entry.snapshot.model==='legacy-tl'){
    const out=calculateLegacy(input||{},entry.runtime);
    out.model='legacy-tl';
    out.source={...out.source,setId:entry.snapshot.id,setVersion:entry.snapshot.hash,model:'legacy-tl'};
    return out;
  }
  return model.calculate(entry.snapshot,input||{},entry.runtime);
}
function lookup(input){
  const entry=resolveSetForCalculation(input&&input.setId);
  if(!entry)return {ok:true,setId:LEGACY_SET_ID,levels:[],supplyGroups:[]};
  if(entry.snapshot.model==='legacy-tl')return {ok:true,setId:entry.snapshot.id,levels:[],supplyGroups:[]};
  return model.lookup(entry.snapshot,input||{},entry.runtime);
}
async function writeActiveSelection(id,actor='',options={}){
  const value=activeSelectionValue(id,actor),mirrored=await mirrorNativeDocuments({[ACTIVE_DOCUMENT_ID]:value},options);
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik set seçimi ortak senkron günlüğüne yazılamadı.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  writeActiveLegacy(value);
}
async function setActiveSet(id,actor='',options={}){
  const target=id===LEGACY_SET_ID?LEGACY_SET_ID:safeSetId(id);
  const sets=listSets();
  if(!target||!sets.some(s=>s.id===target))throw Object.assign(new Error('Endeksmatik seti bulunamadı.'),{code:'SET_NOT_FOUND',statusCode:404});
  await writeActiveSelection(target,actor,options);
  return publicStatus();
}
async function saveSet(snapshot,options={}){
  const {activate=true,actor=''}=options;
  buildSetRuntime(snapshot); // USD ve TL modelleri doğrulanmadan yazılmaz
  const id=safeSetId(snapshot.id);if(!id)throw Object.assign(new Error('Endeksmatik set kimliği geçersiz.'),{code:'SET_INVALID',statusCode:500});
  if(actor)snapshot.uploadedBy=String(actor);
  const active=options.activeSelectionId||activate?activeSelectionValue(options.activeSelectionId||id,options.selectionActor||actor):null;
  const mirrored=await mirrorNativeDocuments({[setDocumentId(id)]:{set:snapshot,label:snapshot.label||'',deleted:false,deletedAt:null},...(active?{[ACTIVE_DOCUMENT_ID]:active}:{})},options);
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik seti ortak senkron günlüğüne yazılamadı.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  if(documents.writesLegacy){fs.mkdirSync(SETS_DIR,{recursive:true});atomicWriteBuffer(setFile(id),zlib.gzipSync(Buffer.from(JSON.stringify(snapshot),'utf8'),{level:9}));}
  setCache.delete(id);
  if(active)writeActiveLegacy(active);
  return publicSetMeta(snapshot);
}
async function renameSet(id,label,options={}){
  const safe=safeSetId(id),entry=safe&&loadSet(safe);
  if(!entry)throw Object.assign(new Error('Endeksmatik seti bulunamadı.'),{code:'SET_NOT_FOUND',statusCode:404});
  const clean=normalizeLabel(label);
  const snapshot={...entry.snapshot,label:clean};
  // Yalnız etiket alanı değişir; büyük set içeriği yeniden yayınlanmaz.
  const mirrored=await mirrorNativeDocuments({[setDocumentId(safe)]:{label:clean}},options);
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik set adı ortak senkron günlüğüne yazılamadı.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  if(documents.writesLegacy)atomicWriteBuffer(setFile(safe),zlib.gzipSync(Buffer.from(JSON.stringify(snapshot),'utf8'),{level:9}));
  setCache.delete(safe);
  return publicSetMeta(snapshot);
}
async function deleteSet(id,options={}){
  const safe=safeSetId(id);
  if(!safe||!loadSet(safe))throw Object.assign(new Error('Endeksmatik seti bulunamadı.'),{code:'SET_NOT_FOUND',statusCode:404});
  const active=options.activeSelectionId?activeSelectionValue(options.activeSelectionId,options.actor):null;
  const mirrored=await mirrorNativeDocuments({[setDocumentId(safe)]:{set:null,deleted:true,deletedAt:new Date().toISOString()},...(active?{[ACTIVE_DOCUMENT_ID]:active}:{})},options);
  if(documents.attached&&!mirrored.ok)throw Object.assign(new Error('Endeksmatik seti ortak senkron günlüğünden silinemedi.'),{code:'SHARED_SYNC_WRITE_FAILED',statusCode:503});
  if(documents.writesLegacy){try{fs.unlinkSync(setFile(safe));}catch(_){}}
  if(active)writeActiveLegacy(active);
  setCache.delete(safe);
  return publicStatus();
}
/* Yükleme: önce USD modeli (imza + uzlaştırma) denenir. Kitap bu modelin sayfa
   yapısında değilse eski TL şablonu ayrıştırıcısına düşülür. USD modeli sayfa
   yapısına sahip ama imza/uzlaştırma tutmuyorsa kitap REDDEDİLİR; eski
   ayrıştırıcıyla "bir şekilde" okunmaz. */
function unambiguousLegacyLayout(buffer){
  const screen=getXLSX().read(buffer,{type:'buffer',sheets:['ENDEKSMATİK'],cellDates:false,cellFormula:true}).Sheets['ENDEKSMATİK'];
  if(!screen||typeof screen.C1?.v!=='string'||!text(screen.C1.v)||screen.C2?.t!=='n'||!Number.isFinite(screen.C2.v)||!excelDate(screen.C2.v))return false;
  // A failed USD formula signature must never become an accepted TL model
  // because another currency table happens to be readable. Ambiguous files
  // retain the original signature error; no rates/formulas are simplified.
  return [...model.SCREEN_LAYOUT.componentIndex,model.SCREEN_LAYOUT.totalIndex].every(address=>!screen[address]?.f);
}
function parseImportWorkbook(buffer,sourceFile){
  let names=[];
  try{names=getXLSX().read(buffer,{type:'buffer',bookSheets:true}).SheetNames||[];}catch(err){throw Object.assign(new Error('Excel dosyası okunamadı.'),{code:'WORKBOOK_INVALID',statusCode:422});}
  if(!model.looksLikeModel(names)){const snapshot=versionedLegacySet(parseWorkbookBuffer(buffer,sourceFile),buffer);return {snapshot,model:'legacy-tl',setId:snapshot.id};}
  let snapshot;
  try{snapshot=model.parseWorkbookBuffer(buffer,sourceFile);}
  catch(err){
    // Shared sheet names alone cannot identify a legacy workbook. Require its
    // positive metadata layout and absence of the USD formula-output surface.
    if(err&&err.code==='MODEL_SIGNATURE_MISMATCH'){try{if(unambiguousLegacyLayout(buffer)){const legacy=versionedLegacySet(parseWorkbookBuffer(buffer,sourceFile),buffer);return {snapshot:legacy,model:'legacy-tl',setId:legacy.id};}}catch(_){}}
    throw err;
  }
  return {snapshot,model:snapshot.model,setId:snapshot.id};
}
async function importWorkbookBuffer(buffer,sourceFile,options={}){
  const {label='',actor=''}=options;
  const parsed=parseImportWorkbook(buffer,sourceFile);
  const snapshot=parsed.snapshot;
  if(label)snapshot.label=normalizeLabel(label);
  // Idempotent upload: the same workbook content selects its existing set
  // without changing its original upload metadata or user-assigned label.
  const existing=loadSet(snapshot.id);
  if(existing){
    await setActiveSet(snapshot.id,actor,options);
    return {...publicStatus(),uploaded:publicSetMeta(existing.snapshot),alreadyPresent:true};
  }
  const meta=await saveSet(snapshot,{...options,activate:true,actor});
  return {...publicStatus(),uploaded:meta,alreadyPresent:false};
}

function sourceFingerprint(){try{loadSnapshot();}catch(_){}return require('./operation-utils').hash(JSON.stringify({active:readActiveSelection(),sets:listSets()}));}
function normalizeLabel(label){return String(label||'').replace(/[\x00-\x1F]/g,'').trim().slice(0,80);}
async function mutate(options,work){return require('./shared-file-transaction').withFileLeaseAsync(ACTIVE_FILE,async()=>{await documents.refresh();cached=null;setCache.clear();options.assertAuthority?.();if(options.expectedFingerprint&&sourceFingerprint()!==options.expectedFingerprint)throw Object.assign(new Error('Endeksmatik changed.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});await options.beforeMutation?.();await documents.refresh();cached=null;setCache.clear();options.assertAuthority?.();if(options.expectedFingerprint&&sourceFingerprint()!==options.expectedFingerprint)throw Object.assign(new Error('Endeksmatik changed.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});return work();});}
async function restoreSet(snapshot,active,options={}){return mutate(options,async()=>{await saveSet(snapshot,{...options,actor:'',selectionActor:options.actor,activate:false,activeSelectionId:active});return publicStatus();});}
async function restoreLegacyReceipt(snapshot,active,wasDefault,options={}){return mutate(options,async()=>{
 if(wasDefault){
  const selection=active?activeSelectionValue(active,options.actor):null,result=await mirrorNativeDocuments({[DOCUMENT_ID]:{snapshot:null},...(selection?{[ACTIVE_DOCUMENT_ID]:selection}:{})},options);
  if(documents.attached&&!result.ok)throw Object.assign(new Error('Legacy journal failed.'),{code:'SHARED_SYNC_WRITE_FAILED'});
  if(documents.writesLegacy)fs.rmSync(PERSISTED_FILE,{force:true});if(selection)writeActiveLegacy(selection);cached=null;cachedFile='';
 }else await saveSnapshot(snapshot,{...options,activeSelectionId:active});return publicStatus();
});}
module.exports={normalizeLabel,restoreLegacyReceipt,removeImportedSet:(id,active,options={})=>mutate(options,async()=>{return deleteSet(id,{...options,activeSelectionId:active});}),sourceFingerprint,parseImportWorkbook,restoreSet,readSetSnapshot:id=>{const entry=loadSet(id);return entry?entry.snapshot:null;},SCHEMA_VERSION,DEFAULT_FILE,PERSISTED_FILE,COLLECTION,DOCUMENT_ID,COMPONENTS,LEGACY_SET_ID,ACTIVE_DOCUMENT_ID,SETS_DIR,attachDeltaStore,seedMissing,text,norm,keyOf,numberValue,monthCode,loadSnapshot,publicStatus,legacyStatus,resolveRecord,calculate,calculateLegacy,lookup,listSets,activeSetId,setActiveSet:(id,actor,options={})=>mutate(options,()=>setActiveSet(id,actor,options)),saveSet:(snapshot,options={})=>mutate(options,()=>saveSet(snapshot,options)),renameSet:(id,label,options={})=>mutate(options,()=>renameSet(id,label,options)),deleteSet:(id,options={})=>mutate(options,()=>deleteSet(id,options)),parseWorkbookBuffer,saveSnapshot:(snapshot,options={})=>mutate(options,()=>saveSnapshot(snapshot,options)),importWorkbookBuffer:(buffer,name,options={})=>mutate(options,()=>importWorkbookBuffer(buffer,name,options)),importLegacyWorkbookBuffer:(buffer,name,options={})=>mutate(options,()=>importLegacyWorkbookBuffer(buffer,name,options))};
