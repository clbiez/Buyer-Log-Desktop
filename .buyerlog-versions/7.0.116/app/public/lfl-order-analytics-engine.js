(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLLFLOrderAnalyticsEngine=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const DIMENSIONS=['manufacturer','country','mag','classification'];
  const LABELS={manufacturer:'Üretici',country:'Ülke',mag:'MAG',classification:'Klasman'};
  const EMPTY='(Boş)';
  const text=value=>String(value==null?'':value).trim();
  const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
  // toLocaleUpperCase('tr-TR') büyük veri kümelerinde pahalıdır. Türkçe i/ı
  // dönüşümünü önce açıkça yapıp hızlı yerel-olmayan uppercase kullanıyoruz.
  const key=value=>text(value).replace(/[ıİ]/g,'I').toUpperCase().replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ');
  const rowIdentity=row=>text(row&&row.orderCode)||text(row&&row.id);
  const modelIdentity=row=>key(row&&row.modelName)||rowIdentity(row);
  const ROW_CACHE=new WeakMap();
  function rowInfo(row){
    if(!row||typeof row!=='object')return {qty:0,order:'',model:'',labels:{},keys:{}};
    let info=ROW_CACHE.get(row);if(info)return info;
    const labels={},keys={};DIMENSIONS.forEach(dim=>{labels[dim]=text(row[dim])||EMPTY;keys[dim]=key(labels[dim])||EMPTY;});
    info={qty:Math.max(0,number(row.quantity)),order:rowIdentity(row),model:modelIdentity(row),labels,keys};ROW_CACHE.set(row,info);return info;
  }

  function normalizeFilters(filters={}){
    const out={};
    DIMENSIONS.forEach(dim=>{
      const source=filters[dim];
      const values=source instanceof Set?[...source]:(Array.isArray(source)?source:(text(source)?[source]:[]));
      out[dim]=new Set(values.map(key).filter(Boolean));
    });
    return out;
  }
  function matches(info,filters){
    for(const dim of DIMENSIONS){const set=filters[dim];if(set&&set.size&&!set.has(info.keys[dim]))return false;}
    return true;
  }
  function blankBucket(name,bucketKey=''){return {key:bucketKey,name,currentQty:0,previousQty:0,currentOrders:new Set(),previousOrders:new Set(),currentModels:new Set(),previousModels:new Set(),currentRows:[],previousRows:[]};}
  function addToBucket(bucket,row,side,providedInfo){
    const info=providedInfo||rowInfo(row);
    bucket[side+'Qty']+=info.qty;
    if(info.order)bucket[side+'Orders'].add(info.order);
    if(info.model)bucket[side+'Models'].add(info.model);
    bucket[side+'Rows'].push(row);
  }
  function statusFor(currentQty,previousQty,stableThreshold=5){
    if(previousQty<=0&&currentQty>0)return 'NEW';
    if(previousQty>0&&currentQty<=0)return 'EXIT';
    if(previousQty<=0&&currentQty<=0)return 'STABLE';
    const change=(currentQty-previousQty)/previousQty*100;
    if(change>stableThreshold)return 'GROWING';
    if(change<-stableThreshold)return 'DECLINING';
    return 'STABLE';
  }
  function finishBucket(bucket,currentTotal,previousTotal,stableThreshold){
    const changeQty=bucket.currentQty-bucket.previousQty;
    const changePct=bucket.previousQty>0?changeQty/bucket.previousQty*100:null;
    const currentShare=currentTotal>0?bucket.currentQty/currentTotal*100:0;
    const previousShare=previousTotal>0?bucket.previousQty/previousTotal*100:0;
    return {
      key:bucket.key||key(bucket.name),name:bucket.name,currentQty:bucket.currentQty,previousQty:bucket.previousQty,changeQty,changePct,
      currentShare,previousShare,shareChange:currentShare-previousShare,
      currentOrders:bucket.currentOrders.size,previousOrders:bucket.previousOrders.size,
      currentModels:bucket.currentModels.size,previousModels:bucket.previousModels.size,
      status:statusFor(bucket.currentQty,bucket.previousQty,stableThreshold),
      currentRows:bucket.currentRows,previousRows:bucket.previousRows,
    };
  }
  function concentration(rows,total){
    const sorted=rows.slice().sort((a,b)=>b.currentQty-a.currentQty||a.name.localeCompare(b.name,'tr-TR'));
    const share=count=>total>0?sorted.slice(0,count).reduce((sum,item)=>sum+item.currentQty,0)/total*100:0;
    return {top1:share(1),top3:share(3),top5:share(5)};
  }
  function topNWithOther(rows,n=10){
    const limit=Math.max(1,Math.min(50,Math.round(number(n)||10)));
    const sorted=rows.slice().sort((a,b)=>b.currentQty-a.currentQty||b.previousQty-a.previousQty||a.name.localeCompare(b.name,'tr-TR'));
    if(sorted.length<=limit)return sorted;
    const top=sorted.slice(0,limit),rest=sorted.slice(limit),bucket=blankBucket('Diğer','__other__');
    rest.forEach(item=>{
      bucket.currentQty+=item.currentQty;bucket.previousQty+=item.previousQty;
      item.currentRows.forEach(row=>addToBucket(bucket,row,'current'));
      item.previousRows.forEach(row=>addToBucket(bucket,row,'previous'));
    });
    // addToBucket already adds quantities, so restore exact values after collecting rows.
    bucket.currentQty=rest.reduce((sum,item)=>sum+item.currentQty,0);
    bucket.previousQty=rest.reduce((sum,item)=>sum+item.previousQty,0);
    const currentTotal=sorted.reduce((sum,item)=>sum+item.currentQty,0),previousTotal=sorted.reduce((sum,item)=>sum+item.previousQty,0);
    return [...top,finishBucket(bucket,currentTotal,previousTotal,5)];
  }
  function timeline(currentRows,previousRows){
    const map=new Map();
    const collect=(rows,side)=>rows.forEach(row=>{const month=text(row&&row.inStoreMonth)||text(row&&row.inStore).slice(0,7)||'—';if(!map.has(month))map.set(month,{month,currentQty:0,previousQty:0});map.get(month)[side+'Qty']+=Math.max(0,number(row&&row.quantity));});
    collect(currentRows,'current');collect(previousRows,'previous');
    return [...map.values()].sort((a,b)=>a.month.localeCompare(b.month));
  }
  function aggregate(currentRows=[],previousRows=[],options={}){
    const filters=normalizeFilters(options.filters),rawThreshold=Number(options.stableThreshold),stableThreshold=Math.max(0,Number.isFinite(rawThreshold)?rawThreshold:5);
    const dimensions=Object.fromEntries(DIMENSIONS.map(dim=>[dim,new Map()]));
    const filtered={current:[],previous:[]};
    const totals={currentQty:0,previousQty:0,currentOrders:new Set(),previousOrders:new Set(),currentModels:new Set(),previousModels:new Set()};
    const collect=(rows,side)=>{
      for(const row of rows||[]){
        const info=rowInfo(row);if(!matches(info,filters)||!(info.qty>0))continue;
        filtered[side].push(row);totals[side+'Qty']+=info.qty;
        if(info.order)totals[side+'Orders'].add(info.order);if(info.model)totals[side+'Models'].add(info.model);
        for(const dim of DIMENSIONS){
          const label=info.labels[dim],k=info.keys[dim];
          let bucket=dimensions[dim].get(k);if(!bucket){bucket=blankBucket(label,k);dimensions[dim].set(k,bucket);}
          addToBucket(bucket,row,side,info);
        }
      }
    };
    collect(currentRows,'current');collect(previousRows,'previous');
    const resultDimensions={};
    DIMENSIONS.forEach(dim=>{resultDimensions[dim]=[...dimensions[dim].values()].map(bucket=>finishBucket(bucket,totals.currentQty,totals.previousQty,stableThreshold)).sort((a,b)=>b.currentQty-a.currentQty||b.previousQty-a.previousQty||a.name.localeCompare(b.name,'tr-TR'));});
    const statuses={NEW:0,GROWING:0,STABLE:0,DECLINING:0,EXIT:0};resultDimensions.manufacturer.forEach(item=>statuses[item.status]++);
    const currentDelta=totals.currentQty-totals.previousQty,changePct=totals.previousQty>0?currentDelta/totals.previousQty*100:null;
    return {
      stableThreshold,filters,filtered,dimensions:resultDimensions,
      totals:{currentQty:totals.currentQty,previousQty:totals.previousQty,changeQty:currentDelta,changePct,currentOrders:totals.currentOrders.size,previousOrders:totals.previousOrders.size,currentModels:totals.currentModels.size,previousModels:totals.previousModels.size},
      statuses,concentration:{manufacturer:concentration(resultDimensions.manufacturer,totals.currentQty),country:concentration(resultDimensions.country,totals.currentQty)},
      timeline:timeline(filtered.current,filtered.previous),
    };
  }
  function matrix(model,rowDim='manufacturer',columnDim='country',metric='currentQty'){
    if(!model||!DIMENSIONS.includes(rowDim)||!DIMENSIONS.includes(columnDim)||rowDim===columnDim)return {rows:[],columns:[],cells:new Map(),totals:new Map()};
    const cells=new Map(),rowLabels=new Map(),columnLabels=new Map();
    const collect=(rows,side)=>rows.forEach(row=>{
      const info=rowInfo(row),rowLabel=info.labels[rowDim],columnLabel=info.labels[columnDim],rowKey=info.keys[rowDim],columnKey=info.keys[columnDim],cellKey=rowKey+'\u0001'+columnKey;
      rowLabels.set(rowKey,rowLabel);columnLabels.set(columnKey,columnLabel);
      let cell=cells.get(cellKey);if(!cell){cell={rowKey,columnKey,rowLabel,columnLabel,currentQty:0,previousQty:0,currentRows:[],previousRows:[]};cells.set(cellKey,cell);}
      cell[side+'Qty']+=info.qty;cell[side+'Rows'].push(row);
    });
    collect(model.filtered.current,'current');collect(model.filtered.previous,'previous');
    cells.forEach(cell=>{cell.changeQty=cell.currentQty-cell.previousQty;cell.changePct=cell.previousQty>0?cell.changeQty/cell.previousQty*100:null;cell.share=model.totals.currentQty>0?cell.currentQty/model.totals.currentQty*100:0;});
    const metricValue=cell=>metric==='share'?cell.share:metric==='changeQty'?cell.changeQty:metric==='changePct'?cell.changePct:cell.currentQty;
    const rows=[...rowLabels].map(([k,label])=>({key:k,label,total:0})),columns=[...columnLabels].map(([k,label])=>({key:k,label,total:0}));
    rows.forEach(item=>{for(const cell of cells.values())if(cell.rowKey===item.key)item.total+=number(metricValue(cell));});
    columns.forEach(item=>{for(const cell of cells.values())if(cell.columnKey===item.key)item.total+=number(metricValue(cell));});
    rows.sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'tr-TR'));columns.sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'tr-TR'));
    return {rows,columns,cells,metric,metricValue};
  }
  function insights(model,currentSeason='',previousSeason='',lang='tr'){
    if(!model)return [];
    const en=String(lang).toLowerCase().startsWith('en'),locale=en?'en-GB':'tr-TR';
    const i=value=>Math.round(value||0).toLocaleString(locale),p=value=>Math.abs(Number(value)||0).toLocaleString(locale,{maximumFractionDigits:1});
    const out=[],t=model.totals,m=model.dimensions.manufacturer,c=model.dimensions.country;
    if(!(t.previousQty>0))out.push(en?'Not enough historical data is available for comparison.':'Karşılaştırma için yeterli geçmiş veri bulunamadı.');
    else if(en)out.push(`${currentSeason||'Current period'} order volume ${t.changePct>=0?'increased':'decreased'} by ${p(t.changePct)}% versus ${previousSeason||'the previous period'}.`);
    else out.push(`${currentSeason||'Güncel dönem'} sipariş hacmi ${previousSeason||'önceki dönem'} dönemine göre ${p(t.changePct)}% ${t.changePct>=0?'arttı':'azaldı'}.`);
    const leader=m[0];if(leader)out.push(en?`Highest current manufacturer volume: ${leader.name}, ${i(leader.currentQty)} units with ${p(leader.currentShare)}% share.`:`En yüksek güncel üretici hacmi ${leader.name}: ${i(leader.currentQty)} adet ve %${p(leader.currentShare)} pay.`);
    const gain=m.filter(item=>item.changeQty>0).sort((a,b)=>b.changeQty-a.changeQty)[0],loss=m.filter(item=>item.changeQty<0).sort((a,b)=>a.changeQty-b.changeQty)[0];
    if(gain)out.push(en?`Largest volume gain: ${gain.name}, +${i(gain.changeQty)} units.`:`En yüksek hacim kazanımı ${gain.name}: +${i(gain.changeQty)} adet.`);
    if(loss)out.push(en?`Largest volume loss: ${loss.name}, ${i(loss.changeQty)} units.`:`En yüksek hacim kaybı ${loss.name}: ${i(loss.changeQty)} adet.`);
    if(c[0])out.push(en?`Leading production country is ${c[0].name} with ${p(c[0].currentShare)}% current share.`:`Lider üretim ülkesi ${c[0].name}; güncel payı %${p(c[0].currentShare)}.`);
    out.push(en?`Top 3 manufacturers account for ${p(model.concentration.manufacturer.top3)}% of current volume; top 3 countries account for ${p(model.concentration.country.top3)}%.`:`İlk 3 üreticinin güncel payı %${p(model.concentration.manufacturer.top3)}; ilk 3 ülkenin payı %${p(model.concentration.country.top3)}.`);
    if(model.statuses.NEW)out.push(en?`${model.statuses.NEW} new manufacturers started receiving orders in the current period.`:`${model.statuses.NEW} yeni üretici güncel dönemde sipariş almaya başladı.`);
    if(model.statuses.EXIT)out.push(en?`${model.statuses.EXIT} manufacturers dropped to zero current-period volume.`:`${model.statuses.EXIT} üreticinin güncel dönem hacmi sıfıra indi.`);
    return out.slice(0,7);
  }

  return {DIMENSIONS,LABELS,aggregate,matrix,topNWithOther,statusFor,insights,normalizeFilters};
});
