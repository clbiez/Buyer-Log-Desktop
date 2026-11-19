'use strict';
/* Siparişler okuma modeli yüzeyleri (#1076 / WS3).
 *
 * Pencereli Siparişler tablosu tüm satırları istemciye indirmez. Hızlı filtre
 * çipleri (Sipariş Durumu / Tümü / Season / Status / Ex-Factory / Del. Type),
 * sayım satırı (model · opsiyon · sipariş · satır · Order Qty) ve sütun
 * paneli değer listesi burada, işçideki veri kümesi üzerinde TEK geçişte
 * hesaplanır.
 *
 * Semantik kaynağı public/app-main.js'tir; parite testi gerçek istemci
 * fonksiyonlarıyla karşılaştırır (tests/read-model-orders-parity.test.js):
 *   ordersEvaluateAll  → kapsamlar: all / none / activeScope / status / del / season / exf
 *   renderOrdersNow    → çip sayaçları (lojistik çok değerli STATUS, kanonik Del. Type,
 *                        matchesQuickExFactory dönemleri)
 *   uniqueColValues / uniqueDateBuckets → sütun paneli değer listesi
 *   pageModelOptionStats → BLModelOptionStats (aynı UMD modülü)
 * Filtre, arama ve görünen metin public/read-model-query.js'ten gelir; burada
 * yeniden yazılmaz.
 *
 * ── İSTEK (version 1) ───────────────────────────────────────────────────
 * {
 *   version: 1,
 *   columns?: [{k,type}],
 *   search?: {text, plainMode?},
 *   base?: [filter],                    // ordersPassesBase: aktif dışı tüm filtreler
 *   active?: [filter],                  // Active/Inactive sütun filtresi + Sipariş Durumu çipi
 *   groups?: {status?:[filter], del?:[filter], season?:[filter], exf?:[filter]},
 *   today: 'YYYY-MM-DD',                // istemcinin yerel günü (Ex-factory dönemleri)
 *   kpi?: boolean,
 *   sums?: string[],
 *   column?: {key, granularity?: 'year'|'month'|'week'|'day'},  // 'all' kapsamında değer listesi
 *   distinct?: string[]                 // filtresiz veri kümesinde dolu değerler (uniqueVals; seçim kutuları)
 * }
 * filter: read-model-query.js şemasındaki filtre nesnesi.
 * ── YANIT ───────────────────────────────────────────────────────────────
 * { datasetRows, total, none, sums, stats:{rowCount,modelCount,optionCount,orderCount},
 *   kpi?:{active:{Active,Inactive}, season:{v:n}, status:{v:n}, del:{v:n}, exf:{past,...}},
 *   column?:{key, granularity, values:[string], truncated:boolean}, distinct?:{key:[string]} }
 */
const shared=require('../../../public/read-model-query');
const rules=require('../../../public/business-rules');
const dates=require('../../../public/date-dimension');
const optionStats=require('../../../public/model-option-stats');

const VERSION=1;
const GROUP_IDS=Object.freeze(['status','del','season','exf']);
const EXF_PERIODS=Object.freeze(['past','thisWeek','nextWeek','thisMonth','nextMonth']);
const MAX_COLUMN_VALUES=shared.LIMITS.maxValues;
// Sütun paneli lojistik çok değerli alanları istemcideki gibi açar (uniqueColValues).
const LOGISTIC_FACET_KEYS=new Set(['STATUS','Del. Type']);
const {norm,coerceDateLoose,cellPlainText,filterPasses,search}=shared.internals;

function invalid(detail){
  return Object.assign(new Error('Geçersiz okuma modeli sorgusu. / Invalid read model query.'),
    {code:'READ_MODEL_QUERY_INVALID',statusCode:400,error:'Geçersiz okuma modeli sorgusu.',errorEn:'Invalid read model query.',detail});
}
const isPlainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

// Her filtre kümesi WS1 doğrulamasından geçer (desteklenmeyen filtre → 400 READ_MODEL_FILTER_UNSUPPORTED).
function compileSet(columns,filters,where){
  if(filters==null)return [];
  if(!Array.isArray(filters))throw invalid(where);
  return shared.validateQuery({version:1,columns,filters,limit:0}).filters;
}
function parseToday(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!m)throw invalid('today');
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  if(d.getFullYear()!==+m[1]||d.getMonth()!==+m[2]-1||d.getDate()!==+m[3])throw invalid('today');
  return d;
}
function validateFacetsRequest(raw){
  if(!isPlainObject(raw))throw invalid('request');
  if(raw.version!==VERSION)throw invalid('version');
  const known=new Set(['version','columns','search','base','active','groups','today','kpi','sums','column','distinct']);
  for(const key of Object.keys(raw))if(!known.has(key))throw invalid(`unknown: ${key}`);
  // Kolon tipleri ve arama WS1 doğrulayıcısından geçer.
  const head=shared.validateQuery({version:1,columns:raw.columns,search:raw.search,limit:0,aggregates:{sums:raw.sums||[]}});
  const columns=raw.columns;
  if(raw.groups!=null&&!isPlainObject(raw.groups))throw invalid('groups');
  const groups={};
  for(const key of Object.keys(raw.groups||{}))if(!GROUP_IDS.includes(key))throw invalid(`groups.${key}`);
  for(const id of GROUP_IDS)groups[id]=compileSet(columns,raw.groups&&raw.groups[id],`groups.${id}`);
  let column=null;
  if(raw.column!=null){
    if(!isPlainObject(raw.column))throw invalid('column');
    const key=raw.column.key,granularity=raw.column.granularity==null?null:raw.column.granularity;
    if(typeof key!=='string'||!key)throw invalid('column.key');
    if(granularity!=null&&!['year','month','week','day'].includes(granularity))throw invalid('column.granularity');
    // Görünen metin/tarih kovası WS1'in desteklediği sütunlarla sınırlı; lojistik
    // STATUS / Del. Type değer listesi burada istemci semantiğiyle açılır.
    const logistic=!granularity&&LOGISTIC_FACET_KEYS.has(key);
    if(!logistic)shared.validateQuery({version:1,columns,filters:[{key,op:'display-in',values:[],...(granularity?{granularity}:{})}],limit:0});
    const col=head.columns.get(key)||{k:key,type:'ro'};
    column={key,granularity,logistic,col};
  }
  let distinct=[];
  if(raw.distinct!=null){
    if(!Array.isArray(raw.distinct)||raw.distinct.length>shared.LIMITS.maxSums)throw invalid('distinct');
    distinct=[...new Set(raw.distinct.map((key,i)=>{if(typeof key!=='string'||!key||key.length>shared.LIMITS.maxKeyLength||key.startsWith('__'))throw invalid(`distinct[${i}]`);return key;}))];
  }
  return {
    columns:head.columns,search:head.search,sums:head.aggregates.sums,distinct,
    base:compileSet(columns,raw.base,'base'),active:compileSet(columns,raw.active,'active'),groups,
    today:parseToday(raw.today),kpi:raw.kpi===true,column,
  };
}

/* app-main.js quickExFactoryBounds / matchesQuickExFactory eşdeğeri; "bugün" istemcinin gününden. */
function exfBounds(today){
  const addDays=(d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};
  const mon=new Date(today);mon.setDate(today.getDate()-((today.getDay()+6)%7));
  return {today:+today,mon:+mon,nextMon:+addDays(mon,7),afterNextMon:+addDays(mon,14),
    monthStart:+new Date(today.getFullYear(),today.getMonth(),1),
    nextMonthStart:+new Date(today.getFullYear(),today.getMonth()+1,1),
    afterNextMonthStart:+new Date(today.getFullYear(),today.getMonth()+2,1)};
}
function exfPeriodHits(row,b,out){
  if(!rules.isProductionStatus(row.STATUS))return;
  const d=coerceDateLoose(row['Ex-factory']);if(!d)return;
  const exf=+d;
  if(exf<b.today)out.past++;
  if(exf>=b.mon&&exf<b.nextMon)out.thisWeek++;
  if(exf>=b.nextMon&&exf<b.afterNextMon)out.nextWeek++;
  if(exf>=b.monthStart&&exf<b.nextMonthStart)out.thisMonth++;
  if(exf>=b.nextMonthStart&&exf<b.afterNextMonthStart)out.nextMonth++;
}
const logisticSegments=row=>Array.isArray(row&&row._logisticSegments)?row._logisticSegments:[];
function statusValues(row){
  const segments=logisticSegments(row);
  const values=segments.length?(row._logisticStatusValues||segments.map(s=>s.status)):[row.STATUS];
  return [...new Set(values.map(value=>norm(value)||'—'))];
}
const delValue=value=>rules.normalizeTransitDelType(value)||norm(value);
function columnValues(row,column){
  if(column.granularity)return [dates.bucketKey(row[column.key],column.granularity)];
  if(column.logistic&&logisticSegments(row).length){
    if(column.key==='STATUS')return (row._logisticStatusValues||logisticSegments(row).map(s=>s.status)).map(norm);
    return (row._logisticDelTypeValues||logisticSegments(row).map(s=>s.delType)).map(delValue);
  }
  return [cellPlainText(column.col,row)];
}
const bump=(map,key)=>{map[key]=(map[key]||0)+1;};

function runOrdersFacets(dataset,rawRequest){
  const spec=validateFacetsRequest(rawRequest);
  const rows=Array.isArray(dataset&&dataset.rows)?dataset.rows:[];
  const keys=spec.search?shared.searchKeys():null,haystacks=dataset&&dataset.haystacks;
  const haystackOf=row=>{
    if(!haystacks)return shared.searchHaystack(row,keys);
    let hay=haystacks.get(row);if(hay===undefined){hay=shared.searchHaystack(row,keys);haystacks.set(row,hay);}return hay;
  };
  const searchOptions=spec.search?{plainMode:spec.search.plainMode}:null;
  const passAll=(list,row)=>{for(let i=0;i<list.length;i++)if(!filterPasses(list[i],row))return false;return true;};
  const groupPass=(id,row)=>passAll(spec.groups[id],row);
  const bounds=spec.kpi?exfBounds(spec.today):null;
  const kpi=spec.kpi?{active:{Active:0,Inactive:0},season:{},status:{},del:{},exf:Object.fromEntries(EXF_PERIODS.map(key=>[key,0]))}:null;
  const sums=Object.fromEntries(spec.sums.map(key=>[key,0]));
  const all=[];let none=0;
  const values=spec.column?new Set():null;
  const distinct=spec.distinct.map(key=>[key,new Set()]);
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(!row||typeof row!=='object')continue;
    // uniqueVals: filtresiz, dolu, norm.
    for(const [key,set] of distinct){const value=norm(row[key]);if(value)set.add(value);}
    // ordersPassesBase(row,ctx,true): seçim/aktif dışı filtreler + arama.
    if(!passAll(spec.base,row))continue;
    if(spec.search&&!search.matches(haystackOf(row),spec.search.terms,searchOptions))continue;
    const failedIds=[];
    for(const id of GROUP_IDS)if(!groupPass(id,row))failedIds.push(id);
    if(kpi&&!failedIds.length){
      const active=norm(row['Active/Inactive']);
      if(active==='Active'||active==='Inactive')kpi.active[active]++;
    }
    if(!passAll(spec.active,row))continue;
    none++;
    if(failedIds.length>1)continue;
    const failed=failedIds[0]||null;
    if(!failed){
      all.push(row);
      for(const key of spec.sums)sums[key]+=shared.internals.toNum(row[key])||0;
      if(values)for(const value of columnValues(row,spec.column))values.add(value);
    }
    if(!kpi)continue;
    if(!failed||failed==='season')bump(kpi.season,norm(row.Season)||'—');
    if(!failed||failed==='status')for(const value of statusValues(row))bump(kpi.status,value);
    if(!failed||failed==='del')bump(kpi.del,delValue(row['Del. Type'])||'—');
    if(!failed||failed==='exf')exfPeriodHits(row,bounds,kpi.exf);
  }
  const stats=optionStats.getModelOptionStats(all,{optionMode:'unique'});
  const out={datasetRows:rows.length,total:all.length,none,sums,
    stats:{rowCount:stats.rowCount,modelCount:stats.modelCount,optionCount:stats.optionCount,orderCount:optionStats.getOrderCount(all)}};
  if(kpi)out.kpi=kpi;
  if(distinct.length)out.distinct=Object.fromEntries(distinct.map(([key,set])=>[key,[...set].sort(rules.compareChronologicalValues)]));
  if(values){
    // uniqueColValues: compareChronologicalValues; uniqueDateBuckets: sözlük sırası.
    let list=[...values];
    list=spec.column.granularity?list.sort():list.sort(rules.compareChronologicalValues);
    const truncated=list.length>MAX_COLUMN_VALUES;
    out.column={key:spec.column.key,granularity:spec.column.granularity,values:truncated?list.slice(0,MAX_COLUMN_VALUES):list,truncated};
  }
  return out;
}

module.exports={VERSION,GROUP_IDS,EXF_PERIODS,validateFacetsRequest,runOrdersFacets,exfBounds};
