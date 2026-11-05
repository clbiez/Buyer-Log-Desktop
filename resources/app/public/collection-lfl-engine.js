(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('../server/lib/canonical-fields'),require('./lfl-calculation-engine'),require('./collection-model-groups'),require('./overview-collection-summary'),require('./date-dimension'));
  else root.BLCollectionLflEngine=factory(root.BLCanonicalFields,root.BLLflCalculationEngine,root.BLCollectionModelGroups,root.BLOverviewCollectionSummary,root.BLDateDimension);
})(typeof globalThis!=='undefined'?globalThis:this,function(fields,lfl,groups,summary,dates){
  'use strict';
  const normalize=value=>String(value??'').trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ');
  const key=(season,mag,category,currency,month='')=>JSON.stringify([season,mag,category,currency,month].map(normalize));
  function monthKey(value){const parts=summary.monthParts(value);return parts?`${parts.year}-${String(parts.month).padStart(2,'0')}`:'';}
  function budgetMonth(row,module){
    const stored=fields.value(row,module,'inStoreMonth');
    // Stored MB month already follows the Merch Calendar; never re-derive it from a Gregorian date.
    if(String(stored??'').trim()||module==='collection')return monthKey(stored);
    const date=fields.value(row,module,'inStore'),period=dates.describe(date);
    return period.businessValid?period.monthKey:dates.hasMerchCalendar()?'':monthKey(date);
  }
  function previousMonth(value){const month=monthKey(value);return month?`${Number(month.slice(0,4))-1}${month.slice(4)}`:'';}
  function previousSeason(value){
    const match=normalize(value).match(/^([A-Z]+)(\d+)$/);
    if(!match||Number(match[2])<=0)return '';
    return match[1]+String(Number(match[2])-1).padStart(match[2].length,'0');
  }
  function sourceFacts(row){
    const read=id=>fields.value(row,'lfl',id),season=normalize(read('season')),mag=normalize(read('mag')),category=normalize(read('category'));
    const price=groups.kolParseMoneyNum(read('fob')),quantity=groups.kolParseQuantityNum(read('orderQuantity'));
    if(!season||!mag||!category||!Number.isFinite(price)||price<=0||!Number.isFinite(quantity)||quantity<=0)return null;
    // Use the existing LFL currency convention: domestic FOB is TRY, overseas FOB is USD.
    return {season,mag,category,price,quantity,currency:lfl.currencyForRow({country:read('country')}),month:budgetMonth(row,'lfl'),order:normalize(read('orderCode')),country:countryCode(fields.normalizedValue(row,'lfl','country'))};
  }
  // Production-country codes (canonical: TR, MA, EG …). Buyer rules exclude these from every reference.
  function countryCode(value){return normalize(value).replace(/\s+/g,'').slice(0,40);}
  function countryList(values){
    const list=Array.isArray(values)?values:values instanceof Set?[...values]:[];
    return [...new Set(list.map(countryCode).filter(Boolean))].sort().slice(0,60);
  }
  function addCountry(target,country,weighted,quantity,count,unidentifiedCount,orders){
    let item=target.get(country);
    if(!item){item={weighted:0,quantity:0,count:0,unidentifiedCount:0,orders:new Set()};target.set(country,item);}
    item.weighted+=weighted;item.quantity+=quantity;item.count+=count;item.unidentifiedCount+=unidentifiedCount;orders.forEach(order=>item.orders.add(order));
    return item;
  }
  const countryRows=countries=>[...countries].sort(([a],[b])=>a.localeCompare(b)).map(([country,item])=>({country,weightedTotal:item.weighted,quantity:item.quantity,count:item.count,unidentifiedCount:item.unidentifiedCount,orderCount:item.orders.size,...(item.firstMonth?{firstMonth:item.firstMonth}:{}),...(item.undatedCount!=null?{undatedCount:item.undatedCount}:{})}));
  // Recomputes a stored reference without the excluded production countries. Sums are additive;
  // distinct order counts are summed per country (an ASAS order is produced in one country).
  function excludeCountries(reference,excluded){
    const codes=countryList(excluded);
    if(!reference||!codes.length||!Array.isArray(reference.byCountry))return reference||null;
    const skip=new Set(codes),kept=reference.byCountry.filter(item=>!skip.has(item.country));
    if(kept.length===reference.byCountry.length)return reference;
    const sum=key=>kept.reduce((total,item)=>total+(Number(item[key])||0),0);
    const quantity=sum('quantity'),weightedTotal=sum('weightedTotal');
    if(!(quantity>0))return null;
    const firstMonths=kept.map(item=>item.firstMonth).filter(Boolean).sort();
    return {...reference,weightedTotal,quantity,count:sum('count'),unidentifiedCount:sum('unidentifiedCount'),orderCount:sum('orderCount'),
      ...(reference.throughMonth?{firstMonth:firstMonths[0]||reference.firstMonth,undatedCount:sum('undatedCount')}:{}),
      average:weightedTotal/quantity,byCountry:kept,excludedCountries:codes.filter(code=>reference.byCountry.some(item=>item.country===code))};
  }
  function buildReferences(rows){
    const buckets=new Map();
    for(const row of rows||[]){
      const facts=sourceFacts(row);if(!facts)continue;
      const {season,mag,category,price,quantity,currency,month,order,country}=facts;
      // Build seasonal and monthly summaries together in one pass over the source snapshot.
      for(const period of month?['',month]:['']){
        const id=key(season,mag,category,currency,period);let bucket=buckets.get(id);
        if(!bucket){bucket={key:id,season,mag,category,currency,month:period,weighted:0,quantity:0,count:0,unidentifiedCount:0,orders:new Set(),countries:new Map()};buckets.set(id,bucket);}
        bucket.weighted+=price*quantity;bucket.quantity+=quantity;bucket.count++;
        if(order)bucket.orders.add(order);else bucket.unidentifiedCount++;
        addCountry(bucket.countries,country,price*quantity,quantity,1,order?0:1,order?[order]:[]);
      }
    }
    const references=[...buckets.values()].map(({weighted,orders,countries,...bucket})=>({...bucket,orderCount:orders.size,average:weighted/bucket.quantity,byCountry:countryRows(countries)}));
    const timelines=new Map();
    for(const bucket of buckets.values()){
      if(!bucket.month)continue;
      const id=key(bucket.season,bucket.mag,bucket.category,bucket.currency);
      if(!timelines.has(id))timelines.set(id,[]);
      timelines.get(id).push(bucket);
    }
    // Persist cumulative summaries once per month; no source scan is needed per Collection row.
    for(const [id,months] of timelines){
      months.sort((a,b)=>a.month.localeCompare(b.month));
      const orders=new Set(),cumulative=new Map();let weightedTotal=0,quantity=0,count=0,unidentifiedCount=0;
      const datedCount=months.reduce((sum,item)=>sum+item.count,0),seasonBucket=buckets.get(id),undatedCount=seasonBucket.count-datedCount;
      const datedByCountry=new Map();
      for(const bucket of months)bucket.countries.forEach((item,country)=>datedByCountry.set(country,(datedByCountry.get(country)||0)+item.count));
      for(const bucket of months){
        weightedTotal+=bucket.weighted;quantity+=bucket.quantity;count+=bucket.count;unidentifiedCount+=bucket.unidentifiedCount;
        bucket.orders.forEach(order=>orders.add(order));
        bucket.countries.forEach((item,country)=>{const total=addCountry(cumulative,country,item.weighted,item.quantity,item.count,item.unidentifiedCount,item.orders);if(!total.firstMonth)total.firstMonth=bucket.month;});
        cumulative.forEach((item,country)=>{item.undatedCount=(seasonBucket.countries.get(country)?.count||0)-(datedByCountry.get(country)||0);});
        references.push({key:key(bucket.season,bucket.mag,bucket.category,bucket.currency,'through:'+bucket.month),season:bucket.season,mag:bucket.mag,category:bucket.category,currency:bucket.currency,month:'',throughMonth:bucket.month,firstMonth:months[0].month,weightedTotal,quantity,count,unidentifiedCount,undatedCount,orderCount:orders.size,average:weightedTotal/quantity,byCountry:countryRows(cumulative)});
      }
    }
    return references;
  }
  // Called only for an explicitly opened report. Summary and detail share all source eligibility rules.
  function referenceDetails(rows,stored,excluded){
    const reference=excludeCountries(stored,excluded);
    if(!reference)return [];
    const skip=new Set(countryList(excluded));
    const result=[],id=key(reference.season,reference.mag,reference.category,reference.currency);
    for(const row of rows||[]){
      const facts=sourceFacts(row);if(!facts)continue;
      if(key(facts.season,facts.mag,facts.category,facts.currency)!==id)continue;
      if(skip.has(facts.country))continue;
      if(reference.throughMonth&&(!facts.month||facts.month>reference.throughMonth))continue;
      if(reference.month&&facts.month!==reference.month)continue;
      result.push({...row,_referenceMonth:facts.month,_referenceQuantity:facts.quantity,_referenceFob:facts.price,_referenceValue:facts.price*facts.quantity,_referenceWeight:facts.quantity/reference.quantity*100});
    }
    return result;
  }
  function reference(index,row,mode='season',excluded){
    const read=id=>fields.value(row,'collection',id),season=previousSeason(read('season')),mag=normalize(read('mag')),category=normalize(read('category'));
    const month=mode==='month'?previousMonth(budgetMonth(row,'collection')):'';
    if(mode==='month'&&!month)return null;
    return season&&mag&&category?excludeCountries(index.get(key(season,mag,category,'USD',month))||null,excluded):null;
  }
  function changePercent(price,average){return Number.isFinite(price)&&price>0&&Number.isFinite(average)&&average>0?(price-average)/average*100:null;}
  function createSeasonTimelines(references){
    const timelines=new Map();
    for(const item of references||[]){
      if(!item.throughMonth)continue;
      const id=key(item.season,item.mag,item.category,item.currency);
      if(!timelines.has(id))timelines.set(id,[]);
      timelines.get(id).push(item);
    }
    timelines.forEach(months=>months.sort((a,b)=>a.throughMonth.localeCompare(b.throughMonth)));
    return timelines;
  }
  function seasonImpact(timelines,row,price,excluded){
    const read=id=>fields.value(row,'collection',id),season=normalize(read('season')),mag=normalize(read('mag')),category=normalize(read('category')),month=budgetMonth(row,'collection');
    if(!season||!mag||!category)return {status:'dimensions'};
    if(!month)return {status:'month'};
    // A linked order is already placed: never add its quantity to the season a second time.
    if(String(row._sourceOrderCode??'').trim())return {status:'linked-order'};
    const months=timelines.get(key(season,mag,category,'USD'))||[];
    let low=0,high=months.length;
    while(low<high){const mid=(low+high)>>>1;if(months[mid].throughMonth<month)low=mid+1;else high=mid;}
    // Cumulative totals only grow, so the latest earlier month stays empty after exclusion only when all earlier months do.
    const reference=excludeCountries(months[low-1],excluded);
    if(!reference)return {status:'no-prior'};
    const quantity=groups.kolParseQuantityNum(read('collectionQuantity'));
    if(!Number.isFinite(quantity)||quantity<=0)return {status:'quantity'};
    if(!Number.isFinite(price)||price<=0)return {status:'price'};
    const before=reference.average,after=(reference.weightedTotal+price*quantity)/(reference.quantity+quantity);
    return {status:'ready',reference,before,after,delta:after-before,percent:changePercent(after,before),quantity,price,sharePercent:quantity/(reference.quantity+quantity)*100};
  }
  function summarizeComparisons(items){
    let beforeValue=0,quantity=0,usedRows=0,beforeTotal=0,beforeCount=0,afterValue=0,pairedBeforeValue=0,pairedQuantity=0,pairedRows=0,afterTotal=0,afterCount=0;
    for(const item of items||[]){
      const before=item.reference,after=item.price,qty=groups.kolParseQuantityNum(item.quantity);
      if(!Number.isFinite(before)||before<=0)continue;
      beforeTotal+=before;beforeCount++;
      const hasAfter=Number.isFinite(after)&&after>0;
      if(hasAfter){afterTotal+=after;afterCount++;}
      if(!Number.isFinite(qty)||qty<=0)continue;
      beforeValue+=before*qty;quantity+=qty;usedRows++;
      if(hasAfter){pairedBeforeValue+=before*qty;afterValue+=after*qty;pairedQuantity+=qty;pairedRows++;}
    }
    const weightedBefore=quantity?beforeValue/quantity:null,weightedAfter=pairedQuantity?afterValue/pairedQuantity:null,pairedBefore=pairedQuantity?pairedBeforeValue/pairedQuantity:null;
    return {weightedBefore,weightedAfter,arithmeticBefore:beforeCount?beforeTotal/beforeCount:null,arithmeticAfter:afterCount?afterTotal/afterCount:null,percent:changePercent(weightedAfter,pairedBefore),quantity,pairedQuantity,usedRows,pairedRows,totalRows:(items||[]).length};
  }
  return {buildReferences,reference,referenceDetails,excludeCountries,countryList,previousSeason,changePercent,budgetMonth,previousMonth,createSeasonTimelines,seasonImpact,summarizeComparisons};
});
