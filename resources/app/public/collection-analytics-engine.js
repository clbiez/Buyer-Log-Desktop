(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./model-option-stats.js'):root.BLModelOptionStats);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCollectionAnalyticsEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(modelOptionStats){
  'use strict';
  const text=value=>String(value==null?'':value).trim();
  function observationValue(item,key){
    if(item&&Object.prototype.hasOwnProperty.call(item,key))return item[key];
    const source=item?.row||item?.raw;
    return source&&Object.prototype.hasOwnProperty.call(source,key)?source[key]:undefined;
  }
  function observationKeys(item){
    return [...new Set([...Object.keys(item||{}),...Object.keys(item?.row||{}),...Object.keys(item?.raw||{})])];
  }
  function axisValue(item,key){
    const keys=Array.isArray(key)?key:[key];
    return keys.map(field=>text(observationValue(item,field))||'—').join(' · ');
  }
  const finite=value=>{if(value==null||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
  function quantile(sorted,p){
    if(!sorted.length)return null;if(sorted.length===1)return sorted[0];
    const at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at),weight=at-lo;
    return sorted[lo]+(sorted[hi]-sorted[lo])*weight;
  }
  function bounds(observations){
    const values=observations.map(item=>item.price).filter(Number.isFinite).sort((a,b)=>a-b);
    const q1=quantile(values,.25),q3=quantile(values,.75),iqr=q1==null||q3==null?null:q3-q1;
    return {q1,q3,low:iqr==null?null:q1-1.5*iqr,high:iqr==null?null:q3+1.5*iqr};
  }
  function markOutliers(observations){
    const byCurrency=new Map();
    observations.forEach(item=>{const key=text(item.currency)||'—';if(!byCurrency.has(key))byCurrency.set(key,[]);byCurrency.get(key).push(item);});
    const result=[];
    byCurrency.forEach(items=>{const b=bounds(items);items.forEach(item=>result.push({...item,isOutlier:b.low!=null&&(item.price<b.low||item.price>b.high)}));});
    return result;
  }
  function stats(observations){
    const values=observations.map(item=>finite(item.price)).filter(value=>value!=null&&value>0).sort((a,b)=>a-b);
    const modelStats=modelOptionStats?.getModelOptionStats?.(observations,{modelKey:(item,index)=>modelOptionStats.modelKey(item?.row||item?.raw||item,index),optionMode:'unique',optionKey:(item,index)=>item?.rowId!=null?`row:${item.rowId}`:modelOptionStats.optionKey(item?.row||item,index)});
    const models=modelStats?null:new Set(observations.map(item=>text(item.modelKey||item.rowId)).filter(Boolean));
    const manufacturers=new Set(observations.map(item=>text(item.manufacturer)).filter(Boolean));
    let weighted=0,weight=0;
    observations.forEach(item=>{const price=finite(item.price),qty=finite(item.quantity);if(price>0&&qty>0){weighted+=price*qty;weight+=qty;}});
    return {
      average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
      median:quantile(values,.5),min:values.length?values[0]:null,max:values.length?values[values.length-1]:null,
      p25:quantile(values,.25),p75:quantile(values,.75),weightedAverage:weight?weighted/weight:null,
      modelCount:modelStats?modelStats.modelCount:models.size,optionCount:modelStats?modelStats.optionCount:observations.length,recordCount:observations.length,priceCount:values.length,manufacturerCount:manufacturers.size,totalQuantity:weight,
      outlierCount:observations.filter(item=>item.isOutlier).length,
    };
  }
  function group(observations,key){
    const map=new Map();
    observations.forEach(item=>{const value=text(typeof key==='function'?key(item):item[key])||'—';if(!map.has(value))map.set(value,[]);map.get(value).push(item);});
    return [...map].map(([name,items])=>({name,items,stats:stats(items)}));
  }
  function aggregate(observations,key,options={}){
    const metric=options.metric||'median';
    return group(observations,key).map(entry=>({...entry,value:entry.stats[metric]})).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)||b.stats.modelCount-a.stats.modelCount||a.name.localeCompare(b.name,'tr'));
  }
  function benchmark(observations){
    // Tek fiyatlı sınıflar karşılaştırma tabanı sayılmaz; küçük N'nin yanlış
    // "ucuz/pahalı" etiketi üretmesini engelleyen muhafazakâr güven eşiği.
    const classMedians=new Map(group(observations,'classification').filter(entry=>entry.stats.priceCount>=2).map(entry=>[entry.name,entry.stats.median]));
    return aggregate(observations,'manufacturer').map(entry=>{
      const comparable=entry.items.map(item=>classMedians.get(text(item.classification)||'—')).filter(value=>value!=null);
      const classBenchmark=comparable.length?comparable.reduce((a,b)=>a+b,0)/comparable.length:null;
      const delta=entry.stats.priceCount>=2&&classBenchmark>0&&entry.stats.median!=null?(entry.stats.median-classBenchmark)/classBenchmark*100:null;
      return {...entry,classBenchmark,delta,status:delta==null?'insufficient':Math.abs(delta)<=5?'market':delta<0?'below':'above'};
    });
  }
  function concentration(observations,key='manufacturer'){
    const groups=group(observations,key),total=groups.reduce((sum,entry)=>sum+entry.stats.modelCount,0);
    return groups.map(entry=>({...entry,share:total?entry.stats.modelCount/total*100:0})).sort((a,b)=>b.share-a.share);
  }
  function matrix(observations,rowKey,columnKey,metric='median'){
    const rows=[...new Set(observations.map(item=>axisValue(item,rowKey)))].sort((a,b)=>a.localeCompare(b,'tr'));
    const columns=[...new Set(observations.map(item=>axisValue(item,columnKey)))].sort((a,b)=>a.localeCompare(b,'tr'));
    const cells=new Map();
    observations.forEach(item=>{const key=`${axisValue(item,rowKey)}\u0000${axisValue(item,columnKey)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(item);});
    return {rows,columns,value(row,column){const items=cells.get(`${row}\u0000${column}`)||[];return metric==='models'?stats(items).modelCount:stats(items)[metric];},items(row,column){return cells.get(`${row}\u0000${column}`)||[];}};
  }
  function relationships(observations){
    const seasons=[...new Set(observations.map(item=>text(item.season)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
    if(seasons.length<2)return {available:false,seasons,newManufacturers:[],newBuyerManufacturerPairs:[]};
    const previous=seasons[seasons.length-2],current=seasons[seasons.length-1];
    const currentItems=observations.filter(item=>text(item.season)===current),previousItems=observations.filter(item=>text(item.season)===previous);
    const previousManufacturers=new Set(previousItems.map(item=>text(item.manufacturer)).filter(Boolean));
    const previousPairs=new Set(previousItems.map(item=>`${text(item.buyer)}\u0000${text(item.manufacturer)}`));
    return {available:true,previous,current,
      newManufacturers:[...new Set(currentItems.map(item=>text(item.manufacturer)).filter(name=>name&&!previousManufacturers.has(name)))].sort(),
      newBuyerManufacturerPairs:[...new Set(currentItems.map(item=>`${text(item.buyer)}\u0000${text(item.manufacturer)}`).filter(pair=>!previousPairs.has(pair)))].map(pair=>{const [buyer,manufacturer]=pair.split('\u0000');return {buyer,manufacturer};}),
    };
  }
  function analyze(input,options={}){
    const marked=markOutliers((input||[]).filter(item=>finite(item.price)>0));
    const active=options.includeOutliers===false?marked.filter(item=>!item.isOutlier):marked;
    return {all:marked,observations:active,stats:stats(active),manufacturer:aggregate(active,'manufacturer'),classification:aggregate(active,'classification'),mag:aggregate(active,'mag'),buyer:aggregate(active,'buyer'),country:aggregate(active,'country'),season:aggregate(active,'season'),benchmark:benchmark(active),concentration:concentration(active),relationships:relationships(active)};
  }
  const PRICE_METRICS=new Set(['average','median','min','max','weightedAverage','totalAmount']);
  function availableDimensions(observations,order=[]){
    const blocked=new Set(['row','raw','items','price','quantity','margin','isOutlier','currency','rowId','modelKey','orderKey','source']);
    const found=new Set();
    (observations||[]).forEach(item=>observationKeys(item).forEach(key=>{if(!blocked.has(key)&&(Object.prototype.hasOwnProperty.call(item?.row||{},key)||Object.prototype.hasOwnProperty.call(item?.raw||{},key)||text(observationValue(item,key))))found.add(key);}));
    return [...found].sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi);return a.localeCompare(b,'tr');});
  }
  function availableMetrics(observations){
    const rows=observations||[],out=['recordCount'];
    if(rows.some(item=>text(item.modelKey||item.rowId)))out.push('modelCount');
    if(rows.length&&modelOptionStats?.getModelOptionStats)out.push('optionCount');
    if(rows.some(item=>text(item.orderKey)))out.push('orderCount');
    if(rows.some(item=>text(item.manufacturer)))out.push('manufacturerCount');
    if(rows.some(item=>finite(item.quantity)>0))out.push('totalQuantity');
    if(rows.some(item=>finite(item.price)>0))out.push('average','median','min','max','weightedAverage');
    if(rows.some(item=>finite(item.price)>0&&finite(item.quantity)>0))out.push('totalAmount');
    if(rows.some(item=>finite(item.margin)!=null))out.push('averageMargin');
    return out;
  }
  function metricResult(items,key){
    const currencies=[...new Set((items||[]).filter(item=>finite(item.price)>0).map(item=>text(item.currency)||'—'))];
    const mixedCurrency=PRICE_METRICS.has(key)&&currencies.length>1;
    const s=stats(items||[]);let value=null;
    if(key==='recordCount')value=(items||[]).length;
    else if(key==='modelCount')value=s.modelCount;
    else if(key==='optionCount')value=s.optionCount;
    else if(key==='orderCount')value=new Set((items||[]).map(item=>text(item.orderKey)).filter(Boolean)).size;
    else if(key==='manufacturerCount')value=s.manufacturerCount;
    else if(key==='totalQuantity')value=(items||[]).reduce((sum,item)=>sum+(finite(item.quantity)>0?finite(item.quantity):0),0);
    else if(key==='totalAmount')value=(items||[]).reduce((sum,item)=>{const price=finite(item.price),qty=finite(item.quantity);return sum+(price>0&&qty>0?price*qty:0);},0);
    else if(key==='averageMargin'){
      const margins=(items||[]).map(item=>finite(item.margin)).filter(value=>value!=null);value=margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:null;
    }else value=s[key];
    if(mixedCurrency)value=null;
    return {value,currency:PRICE_METRICS.has(key)?(currencies.length===1?currencies[0]:currencies.length?'MIXED':''):'' ,mixedCurrency};
  }
  function filterRecords(observations,filters=[]){
    return (observations||[]).filter(item=>(filters||[]).every(filter=>{
      if(!filter||!filter.field)return true;const actual=observationValue(item,filter.field),op=filter.operator||'contains',needle=filter.value;
      if(needle==null||String(needle).trim()==='')return true;
      if(op==='in'){const values=Array.isArray(needle)?needle:String(needle).split(',').map(text);return values.map(v=>v.toLocaleUpperCase('tr-TR')).includes(text(actual).toLocaleUpperCase('tr-TR'));}
      if(['gt','gte','lt','lte','eqn','between'].includes(op)){
        const number=finite(actual),parts=String(needle).split(/\.\.|,/).map(finite);if(number==null)return false;
        if(op==='gt')return number>parts[0];if(op==='gte')return number>=parts[0];if(op==='lt')return number<parts[0];if(op==='lte')return number<=parts[0];if(op==='eqn')return number===parts[0];return parts[0]!=null&&parts[1]!=null&&number>=Math.min(parts[0],parts[1])&&number<=Math.max(parts[0],parts[1]);
      }
      const left=text(actual).toLocaleUpperCase('tr-TR'),right=text(needle).toLocaleUpperCase('tr-TR');
      if(op==='equals')return left===right;if(op==='starts')return left.startsWith(right);return left.includes(right);
    }));
  }
  function aggregateDimensions(observations,dimensions=[],metrics=[]){
    const dims=(dimensions||[]).filter(Boolean),metricKeys=(metrics||[]).filter(Boolean),buckets=new Map();
    (observations||[]).forEach(item=>{const path=dims.map(dim=>text(observationValue(item,dim))||'—'),key=JSON.stringify(path);if(!buckets.has(key))buckets.set(key,{path,items:[]});buckets.get(key).items.push(item);});
    if(!buckets.size&&!dims.length)buckets.set('[]',{path:[],items:[]});
    return [...buckets.values()].map(entry=>{const values={};metricKeys.forEach(key=>{values[key]=metricResult(entry.items,key);});return {...entry,dimensions:Object.fromEntries(dims.map((dim,index)=>[dim,entry.path[index]])),values};})
      .sort((a,b)=>a.path.join('\u0000').localeCompare(b.path.join('\u0000'),'tr',{numeric:true,sensitivity:'base'}));
  }
  function analyzeFlexible(observations,config={}){
    const filtered=filterRecords(observations,config.filters),dimensions=(config.dimensions||[]).filter(Boolean),metrics=(config.metrics||[]).filter(Boolean);
    return {records:filtered,dimensions,metrics,rows:aggregateDimensions(filtered,dimensions,metrics),stats:stats(filtered),config:{...config,dimensions,metrics}};
  }
  const SUPPLIER_METRICS=['average','min','max','median','weightedAverage','modelCount','recordCount','orderCount','totalQuantity'];
  function pathKey(path){return JSON.stringify(path||[]);}
  function hierarchySummaries(records,dimensions,metric){
    const summaries=[];
    for(let depth=1;depth<dimensions.length;depth++){
      aggregateDimensions(records,dimensions.slice(0,depth),SUPPLIER_METRICS).forEach(row=>{
        const parentPath=row.path.slice(0,-1),parentItems=parentPath.length?records.filter(item=>parentPath.every((value,index)=>(text(observationValue(item,dimensions[index]))||'—')===value)):records;
        summaries.push({...row,level:depth-1,isSummary:true,parentPath,parentBenchmark:metricResult(parentItems,metric)});
      });
    }
    return summaries;
  }
  function supplierIntelligence(observations,config={}){
    const dimensions=(config.dimensions||['classification','manufacturer']).filter(Boolean);
    const metric=PRICE_METRICS.has(config.metric)?config.metric:'average';
    const thresholds={below:Number(config.thresholds?.below??-5),above:Number(config.thresholds?.above??5)};
    const minSample=Math.max(1,Number(config.minSample)||2);
    const input=filterRecords(Array.isArray(observations)?observations:[],config.filters||[]);
    const valid=input.filter(item=>finite(item.price)>0);
    const marked=markOutliers(valid);
    const records=config.includeOutliers===false?marked.filter(item=>!item.isOutlier):marked;
    const leafRows=aggregateDimensions(records,dimensions,SUPPLIER_METRICS);
    const parentDimensions=dimensions.slice(0,-1),parentBuckets=new Map(),leafBuckets=new Map();
    records.forEach(item=>{
      const parentPath=parentDimensions.map(dim=>text(observationValue(item,dim))||'—'),parentKey=pathKey(parentPath);
      if(!parentBuckets.has(parentKey))parentBuckets.set(parentKey,[]);parentBuckets.get(parentKey).push(item);
    });
    leafRows.forEach(row=>{
      const parentKey=pathKey(row.path.slice(0,-1));
      if(!leafBuckets.has(parentKey))leafBuckets.set(parentKey,[]);leafBuckets.get(parentKey).push(row);
    });
    const rows=leafRows.map(row=>{
      const parentPath=row.path.slice(0,-1),parentKey=pathKey(parentPath),parentItems=parentBuckets.get(parentKey)||records;
      const benchmark=metricResult(parentItems,metric),current=row.values[metric]||metricResult(row.items,metric);
      const comparable=(leafBuckets.get(parentKey)||[]).map(candidate=>candidate.values[metric]).filter(value=>!value.mixedCurrency&&Number.isFinite(value.value)&&(!current.currency||!value.currency||current.currency===value.currency));
      const lowest=comparable.length?Math.min(...comparable.map(value=>value.value)):null;
      const comparableCurrency=!current.mixedCurrency&&!benchmark.mixedCurrency&&(!current.currency||!benchmark.currency||current.currency===benchmark.currency);
      const difference=comparableCurrency&&Number.isFinite(current.value)&&Number.isFinite(benchmark.value)?current.value-benchmark.value:null;
      const differencePct=difference!=null&&benchmark.value?difference/benchmark.value*100:null;
      const lowestDifferencePct=Number.isFinite(current.value)&&Number.isFinite(lowest)&&lowest>0?(current.value-lowest)/lowest*100:null;
      const pricePosition=differencePct==null?'unavailable':differencePct<thresholds.below?'below':differencePct>thresholds.above?'above':'market';
      const sampleFlag=(row.values.modelCount?.value||0)<minSample?'low-sample':'ok';
      return {...row,level:Math.max(0,dimensions.length-1),isSummary:false,parentPath,parentBenchmark:benchmark,difference,differencePct,lowestDifferencePct,pricePosition,sampleFlag};
    });
    const hierarchyRows=[...hierarchySummaries(records,dimensions,metric),...rows].sort((a,b)=>{
      const left=a.path||[],right=b.path||[],limit=Math.max(left.length,right.length);
      for(let i=0;i<limit;i++){const c=String(left[i]??'').localeCompare(String(right[i]??''),'tr',{numeric:true,sensitivity:'base'});if(c)return c;}
      return (a.isSummary?-1:1)-(b.isSummary?-1:1);
    });
    const opportunities=rows.filter(row=>row.pricePosition==='below').sort((a,b)=>(a.differencePct??0)-(b.differencePct??0)||b.values.modelCount.value-a.values.modelCount.value);
    const alerts=rows.filter(row=>row.pricePosition==='above').sort((a,b)=>(b.differencePct??0)-(a.differencePct??0)||b.values.modelCount.value-a.values.modelCount.value);
    const mixedCurrencyGroups=rows.filter(row=>row.values[metric]?.mixedCurrency||row.parentBenchmark?.mixedCurrency).length;
    return {
      records,dimensions,metric,metrics:SUPPLIER_METRICS.slice(),rows,hierarchyRows,stats:stats(records),thresholds,minSample,
      dataQuality:{inputCount:input.length,validPriceCount:valid.length,excludedMissingPrice:input.length-valid.length,excludedOutlier:marked.length-records.length,outlierCount:marked.filter(item=>item.isOutlier).length,mixedCurrencyGroups},
      insights:{lowest:rows.filter(row=>Number.isFinite(row.values[metric]?.value)).sort((a,b)=>a.values[metric].value-b.values[metric].value),belowAverage:opportunities,aboveAverage:alerts,opportunities,alerts},
      config:{...config,dimensions,metric,thresholds,minSample},
    };
  }
  function compareAnalyses(analyses,metric){
    const slots=(analyses||[]).filter(Boolean),dimensions=slots.length?slots[0].dimensions||[]:[];
    if(!slots.length||!slots.every(slot=>JSON.stringify(slot.dimensions||[])===JSON.stringify(dimensions)))return {compatible:false,dimensions,rows:[]};
    const map=new Map();slots.forEach((slot,index)=>(slot.rows||[]).forEach(row=>{const key=JSON.stringify(row.path||[]);if(!map.has(key))map.set(key,{path:row.path||[],values:[]});map.get(key).values[index]=row.values&&row.values[metric]||{value:null,currency:''};}));
    const rows=[...map.values()].map(row=>{const base=row.values[0]||{},other=row.values[1]||{},sameCurrency=!base.currency||!other.currency||base.currency===other.currency,delta=sameCurrency&&Number.isFinite(base.value)&&Number.isFinite(other.value)?other.value-base.value:null;return {...row,delta,deltaPct:delta!=null&&base.value?delta/base.value*100:null,sameCurrency};});
    return {compatible:true,dimensions,metric,rows};
  }
  function flexibleMatrix(observations,rowKey,columnKey,metric){
    const raw=matrix(observations,rowKey,columnKey,'recordCount');
    return {rows:raw.rows,columns:raw.columns,items:raw.items,value(row,column){return metricResult(raw.items(row,column),metric);}};
  }
  function buildObservations(rows,type,helpers){
    const {norm,kolParseMoneyNum,kolParseQuantityNum,kolEffectiveProjection,kolConfirmedPricing,kolBestPricing,kolLandedCalc}=helpers;
    const observations=[];
    const add=(row,manufacturer,price,currency)=>{const n=Number(price),qty=kolParseQuantityNum(row&&row.quantity);if(!Number.isFinite(n)||n<=0)return;observations.push({row,rowId:row.id,modelKey:`${norm(row.plmId)}\u0000${norm(row.modelKod)}`,manufacturer:norm(manufacturer)||'—',classification:norm(row.urunTipi)||'—',mag:norm(row.mag)||'—',mmyg:norm(row.mmyg)||'—',buyingGroup:norm(row.buyingGroup)||'—',buyer:norm(row.buyer)||norm(row._collectionOwnerName)||'—',country:norm(row.country)||'—',season:norm(row.season)||'—',price:n,currency,quantity:Number.isFinite(qty)&&qty>0?qty:null});};
    (rows||[]).forEach(sourceRow=>{
      const row=kolEffectiveProjection(sourceRow),confirmed=kolConfirmedPricing(row),best=kolBestPricing(row),manufacturer=confirmed?.name||norm(row.confirmedManufacturer)||norm(row.buyingSampleManufacturer)||best?.name||'—';
      if(type==='quotation'){Object.entries(row.pricing||{}).forEach(([name,value])=>add(row,name,kolParseMoneyNum(value),'USD'));return;}
      if(type==='confirmed'){if(confirmed)add(row,confirmed.name,confirmed.price,'USD');return;}
      if(type==='best'){if(best)add(row,best.name,best.price,'USD');return;}
      if(type==='target'){add(row,manufacturer,kolParseMoneyNum(row.targetPrice),'USD');return;}
      if(type==='fob'){add(row,manufacturer,kolParseMoneyNum(row.fob),'USD');return;}
      if(type==='ydLanded'){add(row,manufacturer,kolLandedCalc(row).ydLanded,'USD');return;}
      if(type==='trLanded'){add(row,manufacturer,kolLandedCalc(row).trLanded,'USD');return;}
      if(type==='trPrice'){add(row,manufacturer,kolParseMoneyNum(row.trPrice),'TRY');return;}
      if(type==='previousFob')add(row,manufacturer,kolParseMoneyNum(row.previousFob),'USD');
    });
    return observations;
  }
  return {buildObservations,quantile,bounds,markOutliers,stats,group,aggregate,benchmark,concentration,matrix,relationships,analyze,availableDimensions,availableMetrics,metricResult,filterRecords,aggregateDimensions,analyzeFlexible,supplierIntelligence,compareAnalyses,flexibleMatrix,PRICE_METRICS,SUPPLIER_METRICS};
});
