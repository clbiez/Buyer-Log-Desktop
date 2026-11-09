(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLLflCalculationEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DEFAULT_BREAKDOWN=Object.freeze(['mag','mmyg','classification']);
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
  function aiKnowledge(lang){
    return [lang==='en'
      ? 'LFL = Like-for-Like. Buyer Log compares quantity-weighted FOB between a current and reference period, only for breakdown/currency pairs present in both periods. This is a price comparison, not retail sales growth. Use the deterministic LFL query; do not ask the user to define LFL.'
      : 'LFL = Like-for-Like. Buyer Log güncel ve kıyas dönemlerinin adet ağırlıklı FOB fiyatını, yalnız her iki dönemde de bulunan kırılım/para birimi çiftlerinde karşılaştırır. Satış büyümesi analizi değildir. Deterministik LFL sorgusunu kullan; kullanıcıdan LFL tanımı isteme.',
      'Default breakdown: '+DEFAULT_BREAKDOWN.join(' + '),
      lang==='en'?'Valid rows: FOB > 0 and quantity > 0. Turkey uses TRY, other countries USD; currencies are never averaged together. Change = (current/reference - 1)*100; improvement has the opposite sign. Overall change weights currency changes by current comparable quantity. Default periods: latest season versus previous season with the same prefix, using Buyer Log season rules. Missing comparison season requires clarification; never compare the same season to itself.'
        :'Geçerli kayıt: FOB > 0 ve adet > 0. Türkiye TRY, diğer ülkeler USD; para birimleri birlikte ortalanmaz. Değişim = (güncel/kıyas - 1)*100; iyileşme ters işaretlidir. Genel değişim para birimi değişimlerini güncel karşılaştırılabilir adetle ağırlıklandırır. Varsayılan dönem: Buyer Log sezon kurallarına göre son sezon ve aynı önekli önceki sezon. Kıyas sezonu yoksa dönem sorulur; aynı sezon kendisiyle karşılaştırılmaz.'
    ].join('\n');
  }
  return {DEFAULT_BREAKDOWN,countryKey,isTurkeyCountry,currencyForRow,summary,metricBetween,comparablePeriodRows,aiKnowledge};
});
