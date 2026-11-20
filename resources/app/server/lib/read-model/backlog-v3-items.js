'use strict';
/* Backlog V3 Genel Bakış okuma modeli — hesap işçisi tarafı (#1079 WS6c).
 *
 * Girdi: compute-tasks buildBacklog('v3-items') içinde, /api/backlog-export ile
 * AYNI yoldan üretilmiş Backlog şablon satırları (Date değerleri henüz nesne).
 * Çıktı: tarayıcının /api/backlog-export?format=json satırlarını
 * BLBacklogV3Report.normalizeRows ile normalleştirince elde ettiği kayıtların
 * aynısı, sütunlu ve sözlüklü biçimde. Okuma modeli işçisi (backlog-v3-model.js)
 * bunları önbelleğe alıp panel toplulaştırmasını aynı modülle yapar.
 *
 * Neden burada: 30k ASAS fixture'ında export değerleri tek başına ~45 MB
 * (anahtarlarla ~76 MB JSON). Satırları okuma modeli işçisine JSON olarak
 * taşımak serileştirme + gzip + ayrıştırma ile ~2,3 sn ekler. Normalleştirme
 * satırların üretildiği yerde yapılır; satırın kendisinden yalnız drill-down
 * kimliği ve analiz filtresi için gereken anahtarlar taşınır.
 *
 * JSON eşdeğeri: tarayıcı satırları JSON.parse(serialize(...)) ile görür.
 * jsonValue() JSON.stringify kurallarını (toJSON, undefined/işlev düşmesi,
 * NaN → null, dizi boşlukları → null) ve sunucunun tarih biçimini (dateFn)
 * birebir uygular; eşitlik tests/read-model-backlog-v3-parity.test.js ile sabitlenir.
 */
const V3=require('../../../public/backlog-v3-report.js');
const canonical=require('../canonical-fields');

const FORMAT_VERSION=1;
// Çekmece kimliği (public/backlog-overview.js drawerModelIdentity + BLDetailImages
// identityFromRow) ve görsel eşleşmesinin okuduğu kanonik alanlar.
const IDENTITY_FIELDS=Object.freeze(['plmId','modelName','colourCode','specialCode','season','colour','orderCode']);
// drawerModelIdentity'nin satırdan birebir okuduğu anahtarlar (sözleşme testi kaynağa karşı denetler).
const DRAWER_ROW_KEYS=Object.freeze(['_modelName','Model Adı','Model Name','Style Name','_plmId','plmId','plm','PLM ID','PLM Id','Plm Kod','PLM Kod','PLM Code',
  '_colourCode','colourCode','ccode','C.Code','Renk Kod','Renk Kodu','Colour Code','Color Code','colour','color','Colour','Color','Renk','Renk Adı',
  'orderCode','ocode','Sipariş Kod','Sipariş Kodu','Order Code','__canonical']);

/* JSON.stringify → JSON.parse ile aynı değer. undefined dönerse anahtar düşer. */
function jsonValue(value,dateFn,key){
  if(value!==null&&typeof value==='object'&&typeof value.toJSON==='function')value=value instanceof Date?dateFn(value):value.toJSON(key);
  if(value===null)return null;
  switch(typeof value){
    case 'string':case 'boolean':return value;
    case 'number':return Number.isFinite(value)?value:null;
    case 'object':break;
    default:return undefined;
  }
  if(value instanceof Number||value instanceof String||value instanceof Boolean)return jsonValue(value.valueOf(),dateFn,key);
  if(Array.isArray(value)){
    const out=new Array(value.length);
    for(let i=0;i<value.length;i++){const v=jsonValue(value[i],dateFn,String(i));out[i]=v===undefined?null:v;}
    return out;
  }
  const out={};
  for(const k of Object.keys(value)){
    const v=jsonValue(value[k],dateFn,k);
    if(v===undefined)continue;
    if(k==='__proto__')Object.defineProperty(out,k,{value:v,enumerable:true,writable:true,configurable:true});else out[k]=v;
  }
  return out;
}

/* Şema başına derlenmiş klon: aynı anahtar listesi tek nesne literal'iyle kurulur (V8 hızlı
   nesne şekli; normalizeRows JSON.parse çıktısındaki hızda çalışır). Değer düşmesi gereken
   (undefined/işlev/simge) satır ya da '__proto__' anahtarı genel yola (jsonValue) düşer. */
function createRowCloner(dateFn){
  const compiled=new Map();let dropped=false;
  const convert=(value,key)=>{
    if(value===null)return null;
    switch(typeof value){
      case 'string':case 'boolean':return value;
      case 'number':return Number.isFinite(value)?value:null;
      case 'object':{const out=jsonValue(value,dateFn,key);if(out===undefined)dropped=true;return out;}
      default:dropped=true;return undefined;
    }
  };
  return row=>{
    if(row===null||typeof row!=='object'||Array.isArray(row)||typeof row.toJSON==='function')return jsonValue(row,dateFn,'');
    const keys=Object.keys(row),signature=keys.join('\u0001');
    let build=compiled.get(signature);
    if(build===undefined){
      // Anahtarlar JSON dizgesi olarak gömülür (enjeksiyon yok); '__proto__' literal'de prototip atar.
      build=keys.includes('__proto__')?null:new Function('r','c','return {'+keys.map(key=>{const k=JSON.stringify(key);return k+':c(r['+k+'],'+k+')';}).join(',')+'};');
      compiled.set(signature,build);
    }
    if(!build)return jsonValue(row,dateFn,'');
    dropped=false;
    const out=build(row,convert);
    return dropped?jsonValue(row,dateFn,''):out;
  };
}

function identityTokens(){
  const tokens=new Set(DRAWER_ROW_KEYS.map(key=>canonical.token(key)));
  for(const id of IDENTITY_FIELDS){
    const binding=canonical.bindingFor('backlog',id);
    for(const key of binding&&Array.isArray(binding.keys)?binding.keys:[])tokens.add(canonical.token(key));
  }
  tokens.delete('');
  return tokens;
}
/* Satırın taşınacak anahtarları: kimlik alanlarının bağlama anahtarlarıyla token'ı eşit
   olanlar (canonical value() yalnız birebir/token eşleşmesi kullanır; sıra korunur),
   çekmecenin birebir okuduğu anahtarlar ve aktif analiz filtrelerinin rowKey'leri. */
function createRowProjector(filterKeys){
  const tokens=identityTokens(),exact=new Set([...DRAWER_ROW_KEYS,...(filterKeys||[])]);
  let shape=null,keep=null;
  return row=>{
    if(!row||typeof row!=='object')return row;
    const keys=Object.keys(row),signature=keys.join('\u0001');
    if(signature!==shape){shape=signature;keep=keys.filter(key=>exact.has(key)||tokens.has(canonical.token(key)));}
    const out={};
    for(const key of keep)if(Object.prototype.hasOwnProperty.call(row,key))out[key]=row[key];
    return out;
  };
}
// Analiz filtrelerinin satır anahtarları (istemcinin BLBacklogOverview.queryFilters biçimi).
function filterRowKeys(analysisFilters){
  let list=[];
  try{list=typeof analysisFilters==='string'?JSON.parse(analysisFilters||'[]'):analysisFilters;}catch(_){list=[];}
  return (Array.isArray(list)?list:[]).map(filter=>filter&&filter.rowKey).filter(key=>typeof key==='string'&&key);
}

/* Kayıtlar → sütunlu yük. Metin sütunları sözlüklüdür (lineId sözlüğü aynı zamanda
   öncelik anahtarı listesidir); satır projeksiyonu şema + değer dizisi olarak taşınır. */
function encodeItems(items,project){
  const fields=items.length?Object.keys(items[0]).filter(key=>key!=='row'):[];
  const cols={};
  for(const field of fields){
    let allText=true;
    for(const item of items){const v=item[field];if(typeof v!=='string'){allText=false;break;}}
    if(allText){
      const dict=[],index=new Map(),values=new Array(items.length);
      for(let i=0;i<items.length;i++){const v=items[i][field];let at=index.get(v);if(at===undefined){at=dict.length;dict.push(v);index.set(v,at);}values[i]=at;}
      cols[field]={d:dict,v:values};
    }else cols[field]={v:items.map(item=>item[field]===undefined?null:item[field])};
  }
  const schemas=[],schemaIndex=new Map(),rowSchema=new Array(items.length),rowValues=new Array(items.length);
  for(let i=0;i<items.length;i++){
    const row=project(items[i].row);
    if(!row||typeof row!=='object'){rowSchema[i]=-1;rowValues[i]=row===undefined?null:row;continue;}
    const keys=Object.keys(row),signature=keys.join('\u0001');
    let at=schemaIndex.get(signature);if(at===undefined){at=schemas.length;schemas.push(keys);schemaIndex.set(signature,at);}
    rowSchema[i]=at;rowValues[i]=keys.map(key=>row[key]);
  }
  return {fields,cols,rows:{schemas,schema:rowSchema,values:rowValues}};
}

/* rows: buildBacklogTemplateRows çıktısı; data: compute parametreleri (options.analysisFilters, today, calendar). */
function build(rows,data,dateFn){
  const list=Array.isArray(rows)?rows:[];
  const clone=createRowCloner(dateFn),json=new Array(list.length);
  for(let i=0;i<list.length;i++)json[i]=clone(list[i]);
  const today=typeof data?.today==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(data.today)?data.today:undefined;
  const items=V3.normalizeRows(json,today?{today}:{});
  const encoded=encodeItems(items,createRowProjector(filterRowKeys(data?.options?.analysisFilters)));
  return {version:FORMAT_VERSION,count:items.length,today:today||null,calendar:data?.calendar||null,sourceRevision:data?.sourceRevision||null,rowsRevision:data?.rowsRevision||null,...encoded};
}

/* Okuma modeli işçisinde: sütunlu yük → kayıt dizisi (normalizeRows çıktısının aynısı). */
function decodeItems(payload){
  const value=payload&&typeof payload==='object'?payload:{};
  if(value.version!==FORMAT_VERSION)throw Object.assign(new Error('Backlog V3 kayıt biçimi desteklenmiyor. / Unsupported Backlog V3 item format.'),{code:'COMPUTE_WORKER_FAILED',statusCode:500});
  const count=Number(value.count)||0,fields=Array.isArray(value.fields)?value.fields:[],items=new Array(count);
  const schemas=value.rows?.schemas||[],schemaOf=value.rows?.schema||[],rowValues=value.rows?.values||[];
  for(let i=0;i<count;i++){
    const at=schemaOf[i];let row;
    if(at>=0){const keys=schemas[at],vals=rowValues[i];row={};for(let k=0;k<keys.length;k++){if(keys[k]==='__proto__')Object.defineProperty(row,keys[k],{value:vals[k],enumerable:true,writable:true,configurable:true});else row[keys[k]]=vals[k];}}
    else row=rowValues[i];
    items[i]={row};
  }
  for(const field of fields){
    const col=value.cols[field];
    if(col.d){const dict=col.d,v=col.v;for(let i=0;i<count;i++)items[i][field]=dict[v[i]];}
    else{const v=col.v;for(let i=0;i<count;i++)items[i][field]=v[i];}
  }
  const lineCol=value.cols&&value.cols.lineId;
  return {items,keys:lineCol&&lineCol.d?lineCol.d:[],keyIndex:lineCol&&lineCol.d?lineCol.v:null};
}

module.exports={build,decodeItems,jsonValue,createRowCloner,createRowProjector,filterRowKeys,encodeItems,IDENTITY_FIELDS,DRAWER_ROW_KEYS,FORMAT_VERSION};
