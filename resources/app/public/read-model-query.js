/* Buyer Log okuma modeli sorgu çekirdeği (UMD: tarayıcı + Node).
 *
 * ERP okuma modeli (#1071 / WS1 #1073): filtre, arama, sıralama, pencere ve
 * toplamlar tek bir saf modülde tanımlanır. Yerel arka uç (compute işçisi) ve
 * istemci aynı predicate'i kullanır; mantık iki kez yazılmaz.
 *
 * Semantik kaynağı public/app-main.js'tir ve parite testiyle sabitlenir
 * (tests/read-model-query-parity.test.js):
 *   - norm / turknorm / coerceDateLoose / fmtDate / toNum / numericFilterValue
 *   - prepareColFilter + preparedColFilterPasses ('value', 'range', 'numeric-rule'
 *     ve tarih granülaritesi)
 *   - cpPassesBase / ordersPassesBase hızlı filtreleri (cpF.. / ordersF.. = norm eşitliği,
 *     boyut filtreleri ve passesOvDimFilters = norm küme üyeliği)
 *   - parseTableSearchTerms / tableSearchMatches / BLTableSearch.orderRows
 *   - sortRows (sezon kronolojisi, kolon şeması, kararlı sıralama)
 *
 * İstemciye özgü motor gerektiren filtreler (öncelik, lojistik segment, kumaş
 * kartı, kişisel not, formül, revizyon, hızlı ex-factory dönemi) v1'de AÇIKÇA
 * reddedilir (READ_MODEL_FILTER_UNSUPPORTED): sessizce yanlış sonuç dönmez.
 *
 * ── İSTEK ŞEMASI (version 1) ─────────────────────────────────────────────
 * {
 *   version: 1,
 *   columns?: [{ k: string, type?: string }],        // görüntü metni/şema için kolon tipleri
 *   filters?: [
 *     { key, op: 'eq', value: string }               // norm(row[key]) === value  (cpF.. / ordersF.. seçimleri)
 *     { key, op: 'in', values: string[] }            // values ∋ norm(row[key])   (boyut filtreleri / passesOvDimFilters)
 *     { key, op: 'display-in', values: string[], granularity?: 'year'|'month'|'week'|'day' }
 *                                                    // state.colFilters değer listesi (görünen metin / tarih kovası)
 *     { key, op: 'range', min?: number|null, max?: number|null }          // state.colFilters range
 *     { key, op: 'numeric', rule: { op, a?, b?, avg? } }                  // state.colFilters numericRule
 *     { key, op: 'blank' } | { key, op: 'not-blank' }                     // norm(row[key]) boş / dolu
 *   ],
 *   search?: { text: string, plainMode?: 'contains'|'exact' },           // CP/Siparişler arama kutusu
 *   sort?: { key: string, dir: 1|-1 },
 *   offset?: number, limit?: number,                                     // pencere (limit ≤ 1000)
 *   fields?: string[],                                                   // dönen satır sütunları
 *   aggregates?: { sums?: string[], groupBy?: [{ key, sums?: string[], limit?: number }] }
 * }
 * ── YANIT (runQuery) ─────────────────────────────────────────────────────
 * { rows: [{ _rowIndex, ...fields, _canEdit?, _canEditShared? }], total, offset, limit,
 *   aggregates: { count, sums: {key:number}, groups: [{ key, groups:[{value,count,sums}], truncated }] } }
 */
(function(root,factory){
  'use strict';
  const node=typeof module==='object'&&module.exports;
  const deps=node?{
    rules:require('./business-rules'),
    schema:require('./column-schema'),
    dates:require('./date-dimension'),
    rowGroups:require('./table-search-row-groups'),
    fields:()=>globalThis.BLCanonicalFields||require('../server/lib/canonical-fields'),
  }:{
    rules:root.BLBusinessRules,
    schema:root.BLColumnSchema,
    dates:root.BLDateDimension,
    rowGroups:root.BLTableSearchRowGroups,
    fields:()=>root.BLCanonicalFields,
  };
  const api=factory(deps);
  if(node)module.exports=api;
  if(root)root.BLReadModelQuery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(deps){
  'use strict';

  const QUERY_VERSION=1;
  const LIMITS=Object.freeze({maxLimit:1000,defaultLimit:200,maxFilters:64,maxValues:20000,maxFields:256,maxColumns:512,maxSums:32,maxGroupBy:4,maxGroups:500,maxSearchLength:4000,maxKeyLength:200});
  const OPS=Object.freeze(['eq','in','display-in','range','numeric','blank','not-blank']);
  const GRANULARITIES=Object.freeze(['year','month','week','day']);
  const NUMERIC_RULE_OPS=Object.freeze(['eq','neq','gt','gte','lt','lte','between','aboveAvg','belowAvg']);
  // app-main.js CP_DATE_KEYS ile aynı: istemci bu alanları normalizeCPDates ile Date'e çevirir.
  const DATE_KEYS=Object.freeze(['OPD','Original Ex-factory','Ex-factory','HANDOVER Tarihi','Retail Date','Buying Son Onay Tarihi','In-Store (Model Budget)','Ant. Arrival','_asasExFactory','_asasRetailDate','_asasInStore']); // i18n-ignore
  // Görünen metni istemciye özgü motorlara bağlı kolon tipleri/anahtarları (v1 dışı).
  const UNSUPPORTED_TYPES=new Set(['formula','cpImage','priority','importance','status','deltype','privateNote','submfr']);
  const UNSUPPORTED_KEYS=new Set(['Priority','STATUS','Del. Type','Ant. Arrival','Fabric (PLM)','Sub-Manufacturer','Ex→Retail','LT']);
  const SUPPORTED_TYPES=new Set(['','ro','text','modelLink','licensor','active','plmSample','ordercode','plm','date','exfactory','retail','retailEdit','instoreEdit','money','moneyEdit','pct','int','num']);
  // app-main.js CP_BASE_SEARCH_KEYS / CP_CANONICAL_SEARCH_FIELDS.
  const BASE_SEARCH_KEYS=Object.freeze(['PLM ID','Model Name','Ürün Tanım','License','Manufacturer','Sub-Manufacturer','Sub Manufacturer','Special Code','Order Code','Colour Code','Color Code','Colour']); // i18n-ignore
  const CANONICAL_SEARCH_FIELDS=Object.freeze(['productDescription','category','mag','buyingGroup','buyer','line']);
  const ROW_FLAGS=Object.freeze(['_canEdit','_canEditShared']);

  function queryError(code,tr,en,detail){
    return Object.assign(new Error(`${tr} / ${en}`),{code,statusCode:400,error:tr,errorEn:en,...(detail?{detail}:{})});
  }
  const invalid=(detail)=>queryError('READ_MODEL_QUERY_INVALID','Geçersiz okuma modeli sorgusu.','Invalid read model query.',detail);
  const unsupported=(detail)=>queryError('READ_MODEL_FILTER_UNSUPPORTED','Bu filtre arka uç okuma modelinde henüz desteklenmiyor.','This filter is not supported by the server read model yet.',detail);

  /* ---------------- app-main.js çekirdek biçimlendirici eşdeğerleri ---------------- */
  function norm(s){return String(s==null?'':s).trim();}
  function turknorm(s){
    let x=String(s==null?'':s).toUpperCase();
    const pairs=[['İ','I'],['I','I'],['Ş','S'],['Ç','C'],['Ö','O'],['Ü','U'],['Ğ','G']];
    pairs.forEach(([a,b])=>{x=x.split(a).join(b);});
    return x.replace(/\s+/g,' ').trim();
  }
  function toNum(v){const n=Number(v);return isNaN(n)?null:n;}
  function makeDateOnly(y,m,d){
    y=Number(y);m=Number(m);d=Number(d);
    if(!Number.isInteger(y)||!Number.isInteger(m)||!Number.isInteger(d))return null;
    const dt=new Date(y,m-1,d);
    return dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d?dt:null;
  }
  function dateOnlyFromDateObject(v){
    if(!(v instanceof Date)||isNaN(v))return null;
    const localMidnight=v.getHours()===0&&v.getMinutes()===0&&v.getSeconds()===0&&v.getMilliseconds()===0;
    const utcMidnight=v.getUTCHours()===0&&v.getUTCMinutes()===0&&v.getUTCSeconds()===0&&v.getUTCMilliseconds()===0;
    if(utcMidnight&&!localMidnight)return makeDateOnly(v.getUTCFullYear(),v.getUTCMonth()+1,v.getUTCDate());
    return makeDateOnly(v.getFullYear(),v.getMonth()+1,v.getDate());
  }
  function excelSerialToDateOnly(v){
    const n=Number(v);if(!Number.isFinite(n))return null;
    const utc=new Date(Math.round((n-25569)*86400000));
    return makeDateOnly(utc.getUTCFullYear(),utc.getUTCMonth()+1,utc.getUTCDate());
  }
  function coerceDateLoose(v){
    if(v instanceof Date)return dateOnlyFromDateObject(v);
    if(v==null||v==='')return null;
    if(typeof v==='number'&&Number.isFinite(v)){
      const whole=Math.trunc(v);
      if(whole>=10000101&&whole<=99991231)return makeDateOnly(Math.trunc(whole/10000),Math.trunc((whole%10000)/100),whole%100);
      if(v>0&&v<3000000)return excelSerialToDateOnly(v);
      return null;
    }
    const s=String(v).trim();if(!s)return null;
    if(s.length>10&&s.charCodeAt(4)===45&&/^\d{4}-\d{1,2}-\d{1,2}T/.test(s))return dateOnlyFromDateObject(new Date(s));
    let m=s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if(m)return makeDateOnly(+m[1],+m[2],+m[3]);
    m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})(?:\s|$)/);
    if(m){const y=+m[3]<100?2000+(+m[3]):+m[3];return makeDateOnly(y,+m[2],+m[1]);}
    m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(m)return makeDateOnly(+m[1],+m[2],+m[3]);
    if(/^\d{4}-\d{1,2}-\d{1,2}T/.test(s))return dateOnlyFromDateObject(new Date(s));
    const n=Number(s.replace(',','.'));return Number.isFinite(n)?coerceDateLoose(n):null;
  }
  function fmtDate(v){
    if(v==null||v==='')return '';
    const d=coerceDateLoose(v);
    if(!d)return norm(v);
    const p=x=>String(x).padStart(2,'0');
    return `${p(d.getDate())}.${p(d.getMonth()+1)}.${String(d.getFullYear()).slice(-2)}`;
  }
  let nfInt=null,nfMoney=null;
  function fmtInt(v){const n=toNum(v);return n==null?'':(nfInt||(nfInt=new Intl.NumberFormat('tr-TR'))).format(n);}
  function fmtMoneyPlain(n){return (nfMoney||(nfMoney=new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}))).format(n);}
  function fmtOC(v){const n=toNum(v);return n==null?'':String(Math.trunc(n));}
  function fmtPct(v){const n=toNum(v);if(n==null)return '';return (n*100).toFixed(0)+'%';}
  function normalizeDecimalText(text){
    const comma=text.lastIndexOf(','),dot=text.lastIndexOf('.');
    if(comma>=0&&dot>=0)return comma>dot?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');
    if(comma>=0)return text.replace(',','.');
    return text;
  }
  function numericFilterValue(value,col){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    if(value==null||value==='')return null;
    let text=String(value).trim().replace(/\s/g,'');
    if(!text||!/[0-9]/.test(text))return null;
    const type=String(col?.schema?.dataType||col?.dataType||col?.type||'').toLowerCase();
    if(['int','integer','quantity'].includes(type)&&/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)){
      text=text.replace(/\./g,'');
    }else{
      const hadComma=text.includes(',');
      text=normalizeDecimalText(text);
      if(!hadComma&&(text.match(/\./g)||[]).length>1)text=text.replace(/\./g,'');
    }
    text=text.replace(/[^0-9+\-.]/g,'');
    if(!text||!/[0-9]/.test(text))return null;
    const n=Number(text);
    return Number.isFinite(n)?n:null;
  }
  function numericFilterRulePasses(rule,value,col){
    if(!rule)return true;
    const n=numericFilterValue(value,col);
    if(n==null)return false;
    const op=String(rule.op||'');
    const a=numericFilterValue(rule.a),b=numericFilterValue(rule.b),avg=numericFilterValue(rule.avg);
    if(op==='eq')return a!=null&&n===a;
    if(op==='neq')return a!=null&&n!==a;
    if(op==='gt')return a!=null&&n>a;
    if(op==='gte')return a!=null&&n>=a;
    if(op==='lt')return a!=null&&n<a;
    if(op==='lte')return a!=null&&n<=a;
    if(op==='between')return a!=null&&b!=null&&n>=Math.min(a,b)&&n<=Math.max(a,b);
    if(op==='aboveAvg')return avg!=null&&n>avg;
    if(op==='belowAvg')return avg!=null&&n<avg;
    return false;
  }
  function comparableValue(key,value){
    if(key==='Del. Type')return deps.rules.normalizeTransitDelType(value)||norm(value);
    return norm(value);
  }
  // cellPlainText'in v1'de desteklenen alt kümesi (SUPPORTED_TYPES).
  function cellPlainText(col,row){
    const v=row[col.k],type=col.type||'';
    if(type==='plmSample')return norm(v);
    if(type==='ordercode'||type==='plm')return fmtOC(v);
    if(type==='date'||type==='exfactory'||type==='retail'||type==='retailEdit'||type==='instoreEdit')return fmtDate(v);
    if(type==='money'||type==='moneyEdit'){const n=toNum(v);return n==null?'':fmtMoneyPlain(n);}
    if(type==='pct')return fmtPct(v);
    if(type==='int')return fmtInt(v);
    if(type==='num')return v==null?'':String(v);
    return norm(v);
  }
  function dateBucketKey(v,gran){return deps.dates.bucketKey(v,gran);}

  /* ---------------- arama (app-main.js parseTableSearchTerms / tableSearchMatches) ---------------- */
  function baseParseTerms(value){
    const normalize=value=>String(value==null?'':value).trim().toLocaleUpperCase('tr-TR')
      .replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').toLowerCase();
    const parseCriterion=part=>{
      const raw=norm(part);if(!raw)return null;
      const marker=raw[0];
      const suffix=marker!=='!'&&marker!=='/'&&raw.length>1&&raw[raw.length-1]==='!';
      const mode=marker==='!'||suffix?'notContains':marker==='/'?'contains':'exact';
      const criterion=marker==='!'||marker==='/'?norm(raw.slice(1)):suffix?norm(raw.slice(0,-1)):raw;
      return criterion?{mode,value:normalize(criterion)}:null;
    };
    const splitPart=part=>String(part).split(/(?<=[^\s!]!)\s+/);
    const groups=[];
    String(value==null?'':value).split(/;\s+/).forEach(group=>{
      const terms=group.split(/,\s+/).flatMap(splitPart).map(parseCriterion).filter(Boolean);
      const positive=terms.filter(term=>term.mode!=='notContains');
      if(positive.length)groups.push(positive);
      terms.filter(term=>term.mode==='notContains').forEach(term=>groups.push([term]));
    });
    return groups.length===1?groups[0]:groups;
  }
  function baseMatches(haystack,terms,options){
    const parsed=Array.isArray(terms)?terms:baseParseTerms(terms);
    if(!parsed.length)return true;
    const plainMode=options?.plainMode||'exact';
    const normalize=value=>{
      const text=String(value==null?'':value).trim();
      if(/^[\x00-\x7FçğıöşüÇĞİÖŞÜ]*$/.test(text))return text.replace(/İ/g,'I').toLowerCase().replace(/[çğıöşü]/g,ch=>'cgiosu'['çğıöşü'.indexOf(ch)]); // i18n-ignore
      return text.toLocaleUpperCase('tr-TR')
        .replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').toLowerCase();
    };
    const text=normalize(haystack);
    const exactMatch=(source,needle)=>{
      if(!needle)return false;
      const isWordChar=char=>/[a-z0-9]/.test(char||'');
      let offset=source.indexOf(needle);
      while(offset!==-1){
        const before=offset?source[offset-1]:'';
        const after=source[offset+needle.length]||'';
        if(!isWordChar(before)&&!isWordChar(after))return true;
        offset=source.indexOf(needle,offset+1);
      }
      return false;
    };
    const criterionMatches=criterion=>{
      const item=criterion&&typeof criterion==='object'?criterion:{mode:'exact',value:criterion};
      const value=normalize(item.value);
      if(!value)return false;
      if(item.mode==='contains')return text.includes(value);
      if(item.mode==='notContains')return !text.includes(value);
      return plainMode==='contains'?text.includes(value):exactMatch(text,value);
    };
    const groups=Array.isArray(parsed[0])?parsed:[parsed];
    return groups.every(group=>group.some(criterionMatches));
  }
  // İstemcideki gibi satır grubu (Excel yapıştırma) genişletmesi aynı UMD modülden kurulur.
  const search=(()=>{
    const host={BLTableSearch:{parseTerms:baseParseTerms,matches:baseMatches}};
    if(deps.rowGroups&&typeof deps.rowGroups.install==='function')deps.rowGroups.install(host);
    return host.BLTableSearch;
  })();
  let searchKeysCache=null;
  function searchKeys(){
    if(searchKeysCache)return searchKeysCache;
    const fields=deps.fields(),keys=[];
    CANONICAL_SEARCH_FIELDS.forEach(id=>['cp','orders'].forEach(mod=>{(fields?.bindingFor?.(mod,id)?.keys||[]).forEach(k=>keys.push(k));}));
    searchKeysCache=Object.freeze(Array.from(new Set([...BASE_SEARCH_KEYS,...keys])));
    return searchKeysCache;
  }
  function searchHaystack(row,keys){
    let hay='';
    for(let i=0;i<keys.length;i++){
      const v=row[keys[i]];
      if(v==null||v==='')continue;
      const s=norm(v).toLowerCase();
      if(s)hay=hay?hay+' '+s:s;
    }
    return hay;
  }

  /* ---------------- doğrulama ---------------- */
  const isPlainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function cleanKey(value,where){
    if(typeof value!=='string'||!value||value.length>LIMITS.maxKeyLength||value==='__proto__'||value==='constructor'||value==='prototype')throw invalid(`${where}: key`);
    return value;
  }
  function cleanValues(values,where){
    if(!Array.isArray(values)||values.length>LIMITS.maxValues)throw invalid(`${where}: values`);
    return values.map(value=>{
      if(value==null)return '';
      if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw invalid(`${where}: value type`);
      return String(value);
    });
  }
  function optionalNumber(value,where){
    if(value==null)return null;
    if(typeof value!=='number'||!Number.isFinite(value))throw invalid(where);
    return value;
  }
  function ruleValue(value,where){
    if(value==null)return value;
    if(typeof value==='number'||typeof value==='string')return value;
    throw invalid(where);
  }
  function columnFor(columns,key){return columns.get(key)||{k:key,type:'ro'};}
  function assertSupportedColumn(col,where){
    if(UNSUPPORTED_KEYS.has(col.k))throw unsupported(`${where}: ${col.k}`);
    if(UNSUPPORTED_TYPES.has(col.type)||col.personalNote||col.modelCustom)throw unsupported(`${where}: type ${col.type}`);
    if(!SUPPORTED_TYPES.has(col.type||''))throw unsupported(`${where}: type ${col.type}`);
  }
  const validated=new WeakSet();
  function validateQuery(raw){
    if(!isPlainObject(raw))throw invalid('query');
    if(raw.version!==QUERY_VERSION)throw invalid('version');
    const known=new Set(['version','columns','filters','search','sort','offset','limit','fields','aggregates']);
    for(const key of Object.keys(raw))if(!known.has(key))throw invalid(`unknown: ${key}`);
    const columns=new Map();
    if(raw.columns!=null){
      if(!Array.isArray(raw.columns)||raw.columns.length>LIMITS.maxColumns)throw invalid('columns');
      raw.columns.forEach((col,i)=>{
        if(!isPlainObject(col))throw invalid(`columns[${i}]`);
        const k=cleanKey(col.k,`columns[${i}]`),type=col.type==null?'ro':col.type;
        if(typeof type!=='string'||type.length>40)throw invalid(`columns[${i}].type`);
        columns.set(k,{k,type,...(col.personalNote?{personalNote:true}:{}),...(col.modelCustom?{modelCustom:true}:{})});
      });
    }
    const filters=[];
    if(raw.filters!=null){
      if(!Array.isArray(raw.filters)||raw.filters.length>LIMITS.maxFilters)throw invalid('filters');
      raw.filters.forEach((f,i)=>{
        const where=`filters[${i}]`;
        if(!isPlainObject(f))throw invalid(where);
        const key=cleanKey(f.key,where),op=f.op;
        if(!OPS.includes(op))throw invalid(`${where}.op`);
        if(key==='Priority')throw unsupported(`${where}: Priority`);
        if(op==='eq'){
          if(typeof f.value!=='string'&&typeof f.value!=='number')throw invalid(`${where}.value`);
          filters.push({key,op,value:String(f.value)});
        }else if(op==='in'){
          filters.push({key,op,set:new Set(cleanValues(f.values,where).map(value=>comparableValue(key,value)))});
        }else if(op==='display-in'){
          const col=columnFor(columns,key);
          const granularity=f.granularity==null?null:f.granularity;
          if(granularity!=null&&!GRANULARITIES.includes(granularity))throw invalid(`${where}.granularity`);
          if(!granularity)assertSupportedColumn(col,where);
          else if(UNSUPPORTED_KEYS.has(key))throw unsupported(`${where}: ${key}`);
          const values=cleanValues(f.values,where);
          filters.push({key,op,col,granularity,set:new Set(values)});
        }else if(op==='range'){
          if(UNSUPPORTED_KEYS.has(key))throw unsupported(`${where}: ${key}`);
          filters.push({key,op,min:optionalNumber(f.min,`${where}.min`),max:optionalNumber(f.max,`${where}.max`)});
        }else if(op==='numeric'){
          if(UNSUPPORTED_KEYS.has(key))throw unsupported(`${where}: ${key}`);
          if(!isPlainObject(f.rule)||!NUMERIC_RULE_OPS.includes(f.rule.op))throw invalid(`${where}.rule`);
          filters.push({key,op,col:columnFor(columns,key),rule:{op:f.rule.op,a:ruleValue(f.rule.a,`${where}.rule.a`),b:ruleValue(f.rule.b,`${where}.rule.b`),avg:ruleValue(f.rule.avg,`${where}.rule.avg`)}});
        }else{
          filters.push({key,op});
        }
      });
    }
    let searchSpec=null;
    if(raw.search!=null){
      if(!isPlainObject(raw.search)||typeof raw.search.text!=='string'||raw.search.text.length>LIMITS.maxSearchLength)throw invalid('search');
      const plainMode=raw.search.plainMode==null?'contains':raw.search.plainMode;
      if(!['contains','exact'].includes(plainMode))throw invalid('search.plainMode');
      const terms=search.parseTerms(raw.search.text);
      if(terms.length)searchSpec={text:raw.search.text,terms,plainMode};
    }
    let sort=null;
    if(raw.sort!=null){
      if(!isPlainObject(raw.sort))throw invalid('sort');
      const key=cleanKey(raw.sort.key,'sort'),dir=raw.sort.dir==null?1:raw.sort.dir;
      if(dir!==1&&dir!==-1)throw invalid('sort.dir');
      const col=columns.get(key);
      if(key==='Priority'||(col&&col.personalNote))throw unsupported(`sort: ${key}`);
      sort={key,dir,column:col||null};
    }
    const offset=raw.offset==null?0:raw.offset,limit=raw.limit==null?LIMITS.defaultLimit:raw.limit;
    if(!Number.isSafeInteger(offset)||offset<0)throw invalid('offset');
    if(!Number.isSafeInteger(limit)||limit<0||limit>LIMITS.maxLimit)throw invalid('limit');
    let fields=null;
    if(raw.fields!=null){
      if(!Array.isArray(raw.fields)||raw.fields.length>LIMITS.maxFields)throw invalid('fields');
      fields=Array.from(new Set(raw.fields.map((key,i)=>cleanKey(key,`fields[${i}]`))));
    }
    const aggregates={sums:[],groupBy:[]};
    if(raw.aggregates!=null){
      const a=raw.aggregates;
      if(!isPlainObject(a))throw invalid('aggregates');
      const sums=(list,where)=>{
        if(list==null)return [];
        if(!Array.isArray(list)||list.length>LIMITS.maxSums)throw invalid(where);
        return Array.from(new Set(list.map((key,i)=>cleanKey(key,`${where}[${i}]`))));
      };
      aggregates.sums=sums(a.sums,'aggregates.sums');
      if(a.groupBy!=null){
        if(!Array.isArray(a.groupBy)||a.groupBy.length>LIMITS.maxGroupBy)throw invalid('aggregates.groupBy');
        aggregates.groupBy=a.groupBy.map((g,i)=>{
          const where=`aggregates.groupBy[${i}]`;
          if(!isPlainObject(g))throw invalid(where);
          const glimit=g.limit==null?LIMITS.maxGroups:g.limit;
          if(!Number.isSafeInteger(glimit)||glimit<1||glimit>LIMITS.maxGroups)throw invalid(`${where}.limit`);
          return {key:cleanKey(g.key,where),sums:sums(g.sums,`${where}.sums`),limit:glimit};
        });
      }
    }
    const query={version:QUERY_VERSION,columns,filters,search:searchSpec,sort,offset,limit,fields,aggregates};
    validated.add(query);return query;
  }

  /* ---------------- imza (önbellek anahtarı) ---------------- */
  function signature(raw){
    const stable=value=>{
      if(Array.isArray(value))return value.map(stable);
      if(isPlainObject(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
      return value;
    };
    return JSON.stringify(stable(raw));
  }

  /* ---------------- değerlendirme ---------------- */
  function filterPasses(f,row){
    if(f.op==='eq')return norm(row[f.key])===f.value;
    if(f.op==='in')return f.set.has(comparableValue(f.key,row[f.key]));
    if(f.op==='blank')return norm(row[f.key])==='';
    if(f.op==='not-blank')return norm(row[f.key])!=='';
    if(f.op==='range'){
      const raw=row?row[f.key]:null;
      if(raw==null||raw==='')return false;
      const value=toNum(raw);
      if(value==null)return false;
      if(f.min!=null&&value<f.min)return false;
      if(f.max!=null&&value>f.max)return false;
      return true;
    }
    if(f.op==='numeric')return numericFilterRulePasses(f.rule,row?row[f.key]:null,f.col);
    // display-in: preparedColFilterPasses 'value' dalı.
    const val=f.granularity?dateBucketKey(row[f.key],f.granularity):cellPlainText(f.col,row);
    if(typeof val==='string'){
      const wanted=f.set;
      if(wanted&&wanted.size){
        if(wanted.has(val))return true;
        const canon=norm(val);
        for(const item of wanted){if(norm(item)===canon)return true;}
      }
      return false;
    }
    return f.set.has(val);
  }
  // haystacks: isteğe bağlı WeakMap(row → arama metni). Yalnız satırların değişmediği
  // yerde (işçideki nesil sabit veri kümesi) verilir; istemci satırları düzenlenebilir.
  function haystackReader(haystacks){
    const keys=searchKeys();
    if(!haystacks)return row=>searchHaystack(row,keys);
    return row=>{let hay=haystacks.get(row);if(hay===undefined){hay=searchHaystack(row,keys);haystacks.set(row,hay);}return hay;};
  }
  function compileFilter(query,haystackOf){
    const filters=query.filters,spec=query.search;
    const options=spec?{plainMode:spec.plainMode}:null;
    return row=>{
      for(let i=0;i<filters.length;i++)if(!filterPasses(filters[i],row))return false;
      if(spec&&!search.matches(haystackOf(row),spec.terms,options))return false;
      return true;
    };
  }
  // app-main.js sortRows eşdeğeri (Priority ve kişisel not v1 dışı).
  function sortRows(rows,sort){
    const key=sort.key,dir=sort.dir,rules=deps.rules;
    const seasonKey=String(key).toLocaleLowerCase('tr-TR')==='season';
    const column=sort.column;
    const schema=seasonKey?null:deps.schema.resolveColumnSchema(column||{k:key},rows,column&&(column.sourceMetadata||column.metadata));
    return [...rows].sort((a,b)=>{
      const x=a[key],y=b[key];
      if(seasonKey)return rules.compareChronologicalValues(x,y,dir);
      const sx=schema&&schema.sortValue(x),sy=schema&&schema.sortValue(y);
      if(schema&&(schema.sortType==='number'||schema.sortType==='date')){
        if(sx!=null&&sy!=null)return (sx-sy)*dir;
        if((sx==null)!==(sy==null))return sx==null?1:-1;
      }
      return rules.compareChronologicalValues(x,y,dir);
    });
  }
  function aggregate(rows,spec){
    const sums={};
    for(const key of spec.sums)sums[key]=0;
    const groups=spec.groupBy.map(g=>({key:g.key,sums:g.sums,limit:g.limit,map:new Map()}));
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      for(const key of spec.sums)sums[key]+=toNum(row[key])||0;
      for(const g of groups){
        const value=norm(row[g.key])||'—';
        let bucket=g.map.get(value);
        if(!bucket){bucket={value,count:0,sums:Object.fromEntries(g.sums.map(key=>[key,0]))};g.map.set(value,bucket);}
        bucket.count++;
        for(const key of g.sums)bucket.sums[key]+=toNum(row[key])||0;
      }
    }
    return {count:rows.length,sums,groups:groups.map(g=>{
      const list=[...g.map.values()].sort((a,b)=>b.count-a.count||(a.value<b.value?-1:a.value>b.value?1:0));
      return {key:g.key,groups:list.slice(0,g.limit),truncated:list.length>g.limit};
    })};
  }
  function projectRow(row,index,fields){
    const out={_rowIndex:index};
    if(fields){for(const key of fields)if(Object.prototype.hasOwnProperty.call(row,key))out[key]=row[key];}
    else Object.assign(out,row);
    for(const flag of ROW_FLAGS)if(Object.prototype.hasOwnProperty.call(row,flag))out[flag]=row[flag];
    return out;
  }
  /* İstemcideki normalizeCPDates'in tarih kısmı: sunucu projeksiyonu tarihleri
     'YYYY-MM-DD' metni olarak taşır; istemci bunları yerel gün başlangıcı Date'ine
     çevirir. Şema çıkarımı/sıralama/biçim aynı tipte çalışsın diye aynı dönüşüm. */
  function normalizeRows(rows){
    const list=Array.isArray(rows)?rows:[];
    for(let i=0;i<list.length;i++){
      const row=list[i];if(!row||typeof row!=='object')continue;
      for(const key of DATE_KEYS)if(key in row)row[key]=coerceDateLoose(row[key]);
    }
    return list;
  }
  // rows: kullanıcı kapsamına göre ÖNCEDEN süzülmüş projeksiyon satırları.
  function runQuery(rows,rawQuery,options={}){
    const query=rawQuery&&validated.has(rawQuery)?rawQuery:validateQuery(rawQuery);
    const source=Array.isArray(rows)?rows:[];
    const haystackOf=query.search?haystackReader(options.haystacks):null;
    const passes=compileFilter(query,haystackOf),indexes=new Map();
    let matched=[];
    for(let i=0;i<source.length;i++){const row=source[i];if(row&&typeof row==='object'&&passes(row)){matched.push(row);indexes.set(row,i);}}
    if(query.sort)matched=sortRows(matched,query.sort);
    if(query.search)matched=search.orderRows?search.orderRows(matched,query.search.terms,haystackOf,{plainMode:query.search.plainMode}):matched;
    const windowRows=matched.slice(query.offset,query.offset+query.limit).map(row=>projectRow(row,indexes.get(row),query.fields));
    const result={rows:windowRows,total:matched.length,offset:query.offset,limit:query.limit,aggregates:aggregate(matched,query.aggregates)};
    if(options.includeOrder)result.order=matched.map(row=>indexes.get(row));
    return result;
  }

  return {
    QUERY_VERSION,LIMITS,OPS,DATE_KEYS,
    validateQuery,signature,runQuery,normalizeRows,sortRows,searchKeys,searchHaystack,
    // Parite testleri ve istemci entegrasyonu için düşük seviye yardımcılar.
    internals:{norm,turknorm,toNum,coerceDateLoose,fmtDate,numericFilterValue,numericFilterRulePasses,cellPlainText,filterPasses,search},
  };
});
