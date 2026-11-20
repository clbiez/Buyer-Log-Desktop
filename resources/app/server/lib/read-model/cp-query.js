'use strict';
/* CP pencereli okuma (#1078, WS5 alt PR 2): sorgu ve yüzeyler. Saf modül; HTTP'siz,
 * DOM'suz. Girdi kullanıcı kapsamına göre ÖNCEDEN süzülmüş, tarayıcı biçimine getirilmiş
 * CP satırları (cp-overview veri kümesi) ve satır başına hesaplanmış sütunlar
 * (cp-computed-task ensureComputed; `computedOf(row)`).
 *
 * Semantik kaynağı public/app-main.js'tir; parite testi gerçek istemci fonksiyonlarıyla
 * karşılaştırır (tests/read-model-cp-window-parity.test.js):
 *   cpBuildFilterContext / cpPassesBase / cpPassesGroup / cpEvaluateAll → base + 5 grup
 *     (pri / status / del / season / exf) ve çapraz kapsamlar
 *   preparedColFilterPasses → 'priority', 'cp-logistic-status', 'cp-logistic-deltype',
 *     'cp-logistic-arrival', 'exf' dalları
 *   priorityHas / actionPriorityCounts / priorityRank (sortRows 'Priority')
 *   renderCPNow → KPI çip sayaçları, sayım satırı (pageModelOptionStats), Order Qty
 * Genel filtreler, arama, görünen metin ve sıralama public/read-model-query.js'ten
 * (WS1) gelir; burada yeniden yazılmaz.
 *
 * ── FİLTRE ──────────────────────────────────────────────────────────────
 * WS1 filtre nesnesi (read-model-query.js) ya da CP işlemleri:
 *   {op:'cp-priority', flags:[kod]}            priorityHas(Priority, flag, satır) (VEYA)
 *   {op:'cp-status-eq', value}                 norm(STATUS) === value (cpFStatus)
 *   {op:'cp-deltype-eq', value}                kanonik Del. Type === value (cpFDelType)
 *   {op:'cp-status', values:[...]}             lojistik çok değerli STATUS (sütun filtresi)
 *   {op:'cp-deltype', values:[kanonik]}        lojistik çok değerli Del. Type
 *   {op:'cp-arrival', values:[...], granularity?}  lojistik Ant. Arrival
 *   {op:'cp-exf', periods:[...]}               hızlı Ex-factory dönemleri (VEYA)
 * ── SORGU (version 1) ───────────────────────────────────────────────────
 * { version:1, columns, search?, base:[f], groups:{pri,status,del,season,exf}:[f],
 *   today:'YYYY-MM-DD', sort?:{key,dir}, offset, limit, fields?:[key] }
 * Sonuç: { rows:[satır + _rowIndex], ids:[id], total, offset, limit, datasetRows }
 *   fields: yalnız bu alanlar (tümünü seç için kimlikler); verilmezse satırın tamamı.
 * ── YÜZEYLER (version 1) ────────────────────────────────────────────────
 * { version:1, columns, search?, base, groups, today, kpi?:true, sums?:[key],
 *   distinct?:[key], footer?:{sums,averages,selected} }   (alt toplam: orders-facets.js ile aynı sözleşme)
 * Sonuç: { datasetRows, total, none, sums, stats:{rowCount,modelCount,optionCount,orderCount},
 *   kpi?:{pri:{kod:n}, status:{v:n}, del:{v:n}, season:{v:n}, exf:{dönem:n}}, distinct?,
 *   footer?:{sums, averages:{key:{weighted,arithmetic}}, selectedCount} }
 */
const shared=require('../../../public/read-model-query');
const rules=require('../../../public/business-rules');
const dates=require('../../../public/date-dimension');
const optionStats=require('../../../public/model-option-stats');
const {exfBounds}=require('./orders-facets');
const {kolParseMoneyNum}=require('../../../public/collection-model-groups');

const VERSION=1;
const GROUP_IDS=Object.freeze(['pri','status','del','season','exf']);
const EXF_PERIODS=Object.freeze(['past','thisWeek','nextWeek','thisMonth','nextMonth']);
const CP_OPS=Object.freeze(['cp-priority','cp-status-eq','cp-deltype-eq','cp-status','cp-deltype','cp-arrival','cp-exf']);
const {norm,coerceDateLoose,fmtDate,filterPasses,search}=shared.internals;
const MAX_VALUES=shared.LIMITS.maxValues;

function invalid(detail){
  return Object.assign(new Error('Geçersiz CP okuma modeli sorgusu. / Invalid CP read model query.'),
    {code:'READ_MODEL_QUERY_INVALID',statusCode:400,error:'Geçersiz CP okuma modeli sorgusu.',errorEn:'Invalid CP read model query.',detail});
}
const isPlainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function stringList(values,where,{max=MAX_VALUES}={}){
  if(!Array.isArray(values)||values.length>max)throw invalid(where);
  return values.map((value,i)=>{if(typeof value!=='string'||value.length>shared.LIMITS.maxSearchLength)throw invalid(`${where}[${i}]`);return value;});
}
function compileCpFilter(raw,where){
  const op=raw.op;
  if(op==='cp-priority')return {op,flags:stringList(raw.flags,`${where}.flags`,{max:256})};
  if(op==='cp-status-eq'||op==='cp-deltype-eq'){if(typeof raw.value!=='string')throw invalid(`${where}.value`);return {op,value:raw.value};}
  if(op==='cp-status')return {op,set:new Set(stringList(raw.values,`${where}.values`).map(norm))};
  if(op==='cp-deltype')return {op,set:new Set(stringList(raw.values,`${where}.values`))};
  if(op==='cp-arrival'){
    const granularity=raw.granularity==null?null:raw.granularity;
    if(granularity!=null&&!['year','month','week','day'].includes(granularity))throw invalid(`${where}.granularity`);
    return {op,granularity,set:new Set(stringList(raw.values,`${where}.values`))};
  }
  if(op==='cp-exf'){
    const periods=stringList(raw.periods,`${where}.periods`,{max:EXF_PERIODS.length});
    if(periods.some(p=>!EXF_PERIODS.includes(p)))throw invalid(`${where}.periods`);
    return {op,periods};
  }
  throw invalid(`${where}.op`);
}
// Bir küme: CP işlemleri burada, diğerleri WS1 doğrulamasıyla (desteklenmeyen → 400 READ_MODEL_FILTER_UNSUPPORTED).
function compileSet(columns,filters,where){
  if(filters==null)return [];
  if(!Array.isArray(filters)||filters.length>shared.LIMITS.maxFilters)throw invalid(where);
  const ws1=[],out=new Array(filters.length);
  filters.forEach((raw,i)=>{
    if(!isPlainObject(raw))throw invalid(`${where}[${i}]`);
    if(CP_OPS.includes(raw.op))out[i]=compileCpFilter(raw,`${where}[${i}]`);
    else ws1.push([i,raw]);
  });
  if(ws1.length){
    const compiled=shared.validateQuery({version:1,columns,filters:ws1.map(([,raw])=>raw),limit:0}).filters;
    ws1.forEach(([i],j)=>{out[i]=compiled[j];});
  }
  return out;
}
function parseToday(value){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!m)throw invalid('today');
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  if(d.getFullYear()!==+m[1]||d.getMonth()!==+m[2]-1||d.getDate()!==+m[3])throw invalid('today');
  return d;
}
function validateCommon(raw,known){
  if(!isPlainObject(raw))throw invalid('request');
  if(raw.version!==VERSION)throw invalid('version');
  for(const key of Object.keys(raw))if(!known.has(key))throw invalid(`unknown: ${key}`);
  const head=shared.validateQuery({version:1,columns:raw.columns,search:raw.search,limit:0,
    ...(raw.sort&&raw.sort.key!=='Priority'?{sort:raw.sort}:{}),aggregates:{sums:Array.isArray(raw.sums)?raw.sums:[]}});
  if(raw.groups!=null&&!isPlainObject(raw.groups))throw invalid('groups');
  for(const key of Object.keys(raw.groups||{}))if(!GROUP_IDS.includes(key))throw invalid(`groups.${key}`);
  const groups={};
  for(const id of GROUP_IDS)groups[id]=compileSet(raw.columns,raw.groups&&raw.groups[id],`groups.${id}`);
  return {head,columns:head.columns,search:head.search,base:compileSet(raw.columns,raw.base,'base'),groups,today:parseToday(raw.today)};
}
function validateCpQuery(raw){
  const common=validateCommon(raw,new Set(['version','columns','search','base','groups','today','sort','offset','limit','fields']));
  let sort=null;
  if(raw.sort!=null){
    if(!isPlainObject(raw.sort)||(raw.sort.dir!==1&&raw.sort.dir!==-1)||typeof raw.sort.key!=='string')throw invalid('sort');
    sort=raw.sort.key==='Priority'?{key:'Priority',dir:raw.sort.dir,priority:true}:common.head.sort;
  }
  const offset=raw.offset==null?0:raw.offset,limit=raw.limit==null?shared.LIMITS.defaultLimit:raw.limit;
  if(!Number.isSafeInteger(offset)||offset<0)throw invalid('offset');
  if(!Number.isSafeInteger(limit)||limit<0||limit>shared.LIMITS.maxLimit)throw invalid('limit');
  let fields=null;
  if(raw.fields!=null){
    if(!Array.isArray(raw.fields)||!raw.fields.length||raw.fields.length>shared.LIMITS.maxFields)throw invalid('fields');
    fields=[...new Set(raw.fields.map((key,i)=>{if(typeof key!=='string'||!key||key.length>shared.LIMITS.maxKeyLength||key==='__proto__')throw invalid(`fields[${i}]`);return key;}))];
  }
  return {...common,sort,offset,limit,fields};
}
function validateCpFacets(raw){
  const common=validateCommon(raw,new Set(['version','columns','search','base','groups','today','kpi','sums','distinct','footer']));
  let distinct=[];
  if(raw.distinct!=null){
    if(!Array.isArray(raw.distinct)||raw.distinct.length>shared.LIMITS.maxSums)throw invalid('distinct');
    distinct=[...new Set(raw.distinct.map((key,i)=>{if(typeof key!=='string'||!key||key.length>shared.LIMITS.maxKeyLength||key.startsWith('__'))throw invalid(`distinct[${i}]`);return key;}))];
  }
  let footer=null;
  if(raw.footer!=null){
    if(!isPlainObject(raw.footer))throw invalid('footer');
    const keyOf=(key,where)=>{if(typeof key!=='string'||!key||key.length>shared.LIMITS.maxKeyLength||key==='__proto__')throw invalid(where);return key;};
    const list=(value,where,max)=>{if(value==null)return [];if(!Array.isArray(value)||value.length>max)throw invalid(where);return value;};
    const sums=[...new Set(list(raw.footer.sums,'footer.sums',shared.LIMITS.maxSums).map((key,i)=>keyOf(key,`footer.sums[${i}]`)))];
    const averages=list(raw.footer.averages,'footer.averages',8).map((item,i)=>{
      if(!isPlainObject(item))throw invalid(`footer.averages[${i}]`);
      return {key:keyOf(item.key,`footer.averages[${i}].key`),qtyKey:keyOf(item.qtyKey,`footer.averages[${i}].qtyKey`)};
    });
    let selected=null;
    if(raw.footer.selected!=null)selected=new Set(list(raw.footer.selected,'footer.selected',MAX_VALUES).map((id,i)=>{
      if(typeof id!=='string'&&typeof id!=='number')throw invalid(`footer.selected[${i}]`);return String(id);
    }));
    footer={sums,averages,selected};
  }
  return {...common,kpi:raw.kpi===true,sums:common.head.aggregates.sums,distinct,footer};
}

/* ---------------- değerlendirme ---------------- */
const segmentsOf=row=>Array.isArray(row&&row._logisticSegments)?row._logisticSegments:[];
// app-main.js cpLogisticHasDetails: segment varsa lojistik değerler, yoksa satırın kendi alanı.
const logisticStatus=row=>segmentsOf(row).length?(row._logisticStatusValues||segmentsOf(row).map(s=>s.status)):[row.STATUS];
const logisticDelType=row=>segmentsOf(row).length?(row._logisticDelTypeValues||segmentsOf(row).map(s=>s.delType)):[row['Del. Type']];
const logisticArrival=row=>segmentsOf(row).length?(row._logisticArrivalValues||segmentsOf(row).map(s=>s.arrival)):[row['Ant. Arrival']];
// app-main.js comparableColumnFilterValue('Del. Type', v).
const delComparable=value=>rules.normalizeTransitDelType(value)||norm(value);
function exfMatches(row,period,b){
  if(!period)return true;
  if(!rules.isProductionStatus(row.STATUS))return false;
  const d=coerceDateLoose(row['Ex-factory']);if(!d)return false;
  const exf=+d;
  if(period==='past')return exf<b.today;
  if(period==='thisWeek')return exf>=b.mon&&exf<b.nextMon;
  if(period==='nextWeek')return exf>=b.nextMon&&exf<b.afterNextMon;
  if(period==='thisMonth')return exf>=b.monthStart&&exf<b.nextMonthStart;
  if(period==='nextMonth')return exf>=b.nextMonthStart&&exf<b.afterNextMonthStart;
  return true;
}
/* helpers: { computedOf(row) → {priority, priorityTags, trackingTags}, code(value) → kanonik kod,
   rank(code) → katalog sırası (yoksa +∞), codes() → katalog kodları } — karar barındırıcısının
   BLOrderDecisionEngine'i (kullanıcının kendi kataloğu). */
function priorityHas(helpers,row,flag){
  const computed=helpers.computedOf(row)||{};
  const left=helpers.code(computed.priority),right=helpers.code(flag);
  return !!right&&((!!left&&left===right)||(computed.priorityTags||[]).includes(right)||(computed.trackingTags||[]).includes(right));
}
function passes(f,row,helpers,bounds){
  switch(f.op){
    case 'cp-priority':for(let i=0;i<f.flags.length;i++)if(priorityHas(helpers,row,f.flags[i]))return true;return false;
    case 'cp-status-eq':return norm(row.STATUS)===f.value;
    case 'cp-deltype-eq':return delComparable(row['Del. Type'])===f.value;
    case 'cp-status':return logisticStatus(row).some(value=>f.set.has(norm(value)));
    case 'cp-deltype':return logisticDelType(row).some(value=>f.set.has(delComparable(value)));
    case 'cp-arrival':return logisticArrival(row).some(value=>f.set.has(f.granularity?dates.bucketKey(value,f.granularity):fmtDate(value)));
    case 'cp-exf':for(let i=0;i<f.periods.length;i++)if(exfMatches(row,f.periods[i],bounds))return true;return false;
    default:return filterPasses(f,row);
  }
}
function allPass(list,row,helpers,bounds){for(let i=0;i<list.length;i++)if(!passes(list[i],row,helpers,bounds))return false;return true;}
function haystackOf(dataset){
  const keys=shared.searchKeys(),cache=dataset&&dataset.haystacks;
  return row=>{
    if(!cache)return shared.searchHaystack(row,keys);
    let hay=cache.get(row);if(hay===undefined){hay=shared.searchHaystack(row,keys);cache.set(row,hay);}return hay;
  };
}
/* cpEvaluateAll: base geçen her satır için başarısız grup kimlikleri (0, 1 ya da >1). */
function evaluate(dataset,spec,helpers,visit){
  const rows=Array.isArray(dataset&&dataset.rows)?dataset.rows:[];
  const bounds=exfBounds(spec.today),hay=spec.search?haystackOf(dataset):null;
  const options=spec.search?{plainMode:spec.search.plainMode}:null;
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(!row||typeof row!=='object')continue;
    if(!allPass(spec.base,row,helpers,bounds))continue;
    if(spec.search&&!search.matches(hay(row),spec.search.terms,options))continue;
    let failed=0,failedId=null;
    for(const id of GROUP_IDS){
      if(!allPass(spec.groups[id],row,helpers,bounds)){failed++;failedId=id;if(failed>1)break;}
    }
    visit(row,i,failed,failedId);
  }
  return {rows,hay};
}

function runCpQuery(dataset,rawQuery,helpers){
  const query=validateCpQuery(rawQuery);
  const matched=[],indexes=new Map();
  const {rows,hay}=evaluate(dataset,query,helpers,(row,i,failed)=>{if(!failed){matched.push(row);indexes.set(row,i);}});
  let ordered=matched;
  if(query.sort&&query.sort.priority){
    // app-main.js sortRows: (priorityRank(x)-priorityRank(y))*dir; kod yoksa +∞ (NaN karşılaştırması korunur).
    const rank=row=>helpers.rank(helpers.code((helpers.computedOf(row)||{}).priority));
    ordered=[...matched].sort((a,b)=>(rank(a)-rank(b))*query.sort.dir);
  }else if(query.sort)ordered=shared.sortRows(matched,query.sort);
  if(query.search&&search.orderRows)ordered=search.orderRows(ordered,query.search.terms,hay,{plainMode:query.search.plainMode});
  const window=ordered.slice(query.offset,query.offset+query.limit);
  return {
    rows:window.map(row=>{
      const out={_rowIndex:indexes.get(row)};
      if(query.fields){for(const key of query.fields)if(Object.prototype.hasOwnProperty.call(row,key))out[key]=row[key];return out;}
      for(const key of Object.keys(row))if(!key.startsWith('__checklist__'))out[key]=row[key];
      return out;
    }),
    ids:window.map(row=>String(row._id)),total:ordered.length,offset:query.offset,limit:query.limit,datasetRows:rows.length,
  };
}

const bump=(map,key)=>{map[key]=(map[key]||0)+1;};
/* Alt toplam satırı: orders-facets.js createFooterAccumulator / tableNumericValue'nun kopyası
   (o dosya WS3'ündür ve bunları dışa açmaz). Eşitlik testi: read-model-cp-window-route.test.js
   aynı satırlarda iki uygulamayı karşılaştırır. */
function tableNumericValue(value){
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  let text=String(value==null?'':value).trim().replace(/\s/g,'');
  if(!text)return 0;
  const hadComma=text.includes(',');
  text=normalizeDecimalText(text);
  if(!hadComma&&(text.match(/\./g)||[]).length>1)text=text.replace(/\./g,'');
  const n=Number(text.replace(/[^0-9+\-.]/g,''));return Number.isFinite(n)?n:0;
}
function normalizeDecimalText(text){
  const comma=text.lastIndexOf(','),dot=text.lastIndexOf('.');
  if(comma>=0&&dot>=0)return comma>dot?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');
  if(comma>=0)return text.replace(',','.');
  return text;
}
function createFooterAccumulator(spec){
  if(!spec)return null;
  const sums=Object.fromEntries(spec.sums.map(key=>[key,0]));
  const avg=spec.averages.map(item=>({...item,weighted:0,qty:0,total:0,count:0}));
  const seen=new Set();let selectedCount=0;
  return {
    add(row){
      for(const key of spec.sums)sums[key]+=tableNumericValue(row[key]);
      for(const a of avg){
        const price=kolParseMoneyNum(row[a.key]);
        if(!Number.isFinite(price)||price<=0)continue;
        a.total+=price;a.count++;
        const qty=tableNumericValue(row[a.qtyKey]);
        if(qty>0){a.weighted+=price*qty;a.qty+=qty;}
      }
      if(spec.selected){const id=String(row._id);if(!seen.has(id)){seen.add(id);if(spec.selected.has(id))selectedCount++;}}
    },
    result(){
      return {sums,averages:Object.fromEntries(avg.map(a=>[a.key,{weighted:a.qty>0?a.weighted/a.qty:null,arithmetic:a.count?a.total/a.count:null}])),
        selectedCount:spec.selected?selectedCount:null};
    },
  };
}
function runCpFacets(dataset,rawRequest,helpers){
  const spec=validateCpFacets(rawRequest);
  const bounds=exfBounds(spec.today);
  const codes=helpers.codes();
  const kpi=spec.kpi?{pri:Object.fromEntries(codes.map(code=>[code,0])),status:{},del:{},season:{},exf:Object.fromEntries(EXF_PERIODS.map(key=>[key,0]))}:null;
  const sums=Object.fromEntries(spec.sums.map(key=>[key,0]));
  const all=[];let none=0;
  const distinct=spec.distinct.map(key=>[key,new Set()]);
  const footer=createFooterAccumulator(spec.footer);
  if(distinct.length)for(const row of Array.isArray(dataset&&dataset.rows)?dataset.rows:[])for(const [key,set] of distinct){const value=norm(row&&row[key]);if(value)set.add(value);}
  const {rows}=evaluate(dataset,spec,helpers,(row,i,failed,failedId)=>{
    none++;
    if(failed>1)return;
    if(!failed){
      all.push(row);
      for(const key of spec.sums)sums[key]+=shared.internals.toNum(row[key])||0;
      if(footer)footer.add(row);
    }
    if(!kpi)return;
    const scope=id=>!failed||failedId===id;
    if(scope('pri')){
      // actionPriorityCounts: satırın kodu + öncelik/izleme etiketleri (tekil).
      const computed=helpers.computedOf(row)||{};
      const ids=new Set([helpers.code(computed.priority),...(computed.priorityTags||[]),...(computed.trackingTags||[])]);
      for(const code of ids)if(code&&Object.prototype.hasOwnProperty.call(kpi.pri,code))kpi.pri[code]++;
    }
    if(scope('status'))[...new Set(logisticStatus(row).map(v=>norm(v)||'—'))].forEach(v=>bump(kpi.status,v));
    if(scope('del'))[...new Set(logisticDelType(row).map(raw=>rules.normalizeTransitDelType(raw)||norm(raw)||'—'))].forEach(v=>bump(kpi.del,v));
    if(scope('season'))bump(kpi.season,norm(row.Season)||'—');
    if(scope('exf'))for(const period of EXF_PERIODS)if(exfMatches(row,period,bounds))kpi.exf[period]++;
  });
  const stats=optionStats.getModelOptionStats(all,{optionMode:'unique'});
  const out={datasetRows:rows.length,total:all.length,none,sums,
    stats:{rowCount:stats.rowCount,modelCount:stats.modelCount,optionCount:stats.optionCount,orderCount:optionStats.getOrderCount(all)}};
  if(kpi)out.kpi=kpi;
  if(footer)out.footer=footer.result();
  if(distinct.length)out.distinct=Object.fromEntries(distinct.map(([key,set])=>[key,[...set].sort(rules.compareChronologicalValues)]));
  return out;
}

module.exports={VERSION,GROUP_IDS,EXF_PERIODS,CP_OPS,validateCpQuery,validateCpFacets,runCpQuery,runCpFacets};
