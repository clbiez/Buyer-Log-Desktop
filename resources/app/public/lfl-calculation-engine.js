(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLLflCalculationEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const countryKey=value=>String(value==null?'':value).trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ');
  const isTurkeyCountry=value=>['TURKIYE','TURKEY','TR'].includes(countryKey(value));
  const currencyForRow=row=>isTurkeyCountry(row&&row.country)?'TRY':'USD';
  function summary(rows,helpers){
    const {rowMeta,dtrTypeForRow}=helpers;
    const byCurrency={},orders=new Set(),models=new Set(),orderTypes=new Map();let validRows=0,totalQty=0;
    for(const row of rows||[]){
      const meta=rowMeta(row);if(!meta.valid)continue;validRows++;totalQty+=meta.quantity;
      let bucket=byCurrency[meta.currency];if(!bucket)bucket=byCurrency[meta.currency]={currency:meta.currency,avg:null,qty:0,weighted:0,orders:0,_orders:new Set()};
      bucket.qty+=meta.quantity;bucket.weighted+=meta.quantity*meta.fob;if(meta.order)bucket._orders.add(meta.order);
      if(meta.order){orders.add(meta.order);const type=dtrTypeForRow(row),previous=orderTypes.get(meta.order);orderTypes.set(meta.order,previous==='NON-DTR'||type==='NON-DTR'?'NON-DTR':'DTR');}
      if(meta.model)models.add(meta.model);
    }
    Object.values(byCurrency).forEach(bucket=>{bucket.avg=bucket.qty>0?bucket.weighted/bucket.qty:null;bucket.orders=bucket._orders.size;delete bucket._orders;});
    const currencies=Object.keys(byCurrency);let dtr=0,nonDtr=0;orderTypes.forEach(type=>{if(type==='NON-DTR')nonDtr++;else dtr++;});
    return {avg:currencies.length===1?byCurrency[currencies[0]].avg:null,qty:totalQty,orders:orders.size,models:models.size,rows:validRows,byCurrency,currencies,dtrOrders:{dtr,nonDtr,unknown:0},hasDtrBreakdown:orders.size>0};
  }
  function metricBetween(current,reference,type='change'){
    if(!current||!reference)return null;let weighted=0,totalQty=0;
    for(const currency of ['TRY','USD']){
      const c=current.byCurrency[currency],r=reference.byCurrency[currency];if(!c||!r||!(c.avg>0)||!(r.avg>0)||!(c.qty>0))continue;
      const value=type==='improvement'?(r.avg-c.avg)/r.avg*100:(c.avg-r.avg)/r.avg*100;weighted+=value*c.qty;totalQty+=c.qty;
    }
    return totalQty?weighted/totalQty:null;
  }
  function comparablePeriodRows(currentRows,referenceRows,groupBy=[],helpers){
    const {rowMeta,groupValue}=helpers;
    const dims=Array.isArray(groupBy)?groupBy.filter(Boolean):[],pairKey=row=>{
      const meta=rowMeta(row);if(!meta.valid)return '';
      const group=dims.length?groupValue(row,dims):'__all__';
      return group?`${group}\u0001${meta.currency}`:'';
    };
    const currentKeys=new Set((currentRows||[]).map(pairKey).filter(Boolean)),referenceKeys=new Set((referenceRows||[]).map(pairKey).filter(Boolean));
    const sharedKeys=new Set([...currentKeys].filter(key=>referenceKeys.has(key)));
    return {
      currentRows:(currentRows||[]).filter(row=>sharedKeys.has(pairKey(row))),
      referenceRows:(referenceRows||[]).filter(row=>sharedKeys.has(pairKey(row))),
      sharedKeys,
    };
  }
  return {countryKey,isTurkeyCountry,currencyForRow,summary,metricBetween,comparablePeriodRows};
});
