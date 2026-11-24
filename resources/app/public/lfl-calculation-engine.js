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
    const dims=Array.isArray(groupBy)?groupBy.filter(Boolean):[],cells=new Map();
    // Anahtar satır başına bir kez hesaplanır; aynı geçişte kırılım/para birimi toplamları
    // (ağırlıklı ortalama ve Fisher için) biriktirilir, ek satır taraması gerekmez.
    const keyed=(rows,side)=>(rows||[]).map(row=>{
      const meta=rowMeta(row);if(!meta.valid)return '';
      const group=dims.length?groupValue(row,dims):'__all__';if(!group)return '';
      const key=`${group}\u0001${meta.currency}`;let cell=cells.get(key);
      if(!cell)cells.set(key,cell={currency:meta.currency,cq:0,cw:0,rq:0,rw:0});
      if(side==='current'){cell.cq+=meta.quantity;cell.cw+=meta.quantity*meta.fob;}else{cell.rq+=meta.quantity;cell.rw+=meta.quantity*meta.fob;}
      return key;
    });
    const currentKeys=keyed(currentRows,'current'),referenceKeys=keyed(referenceRows,'reference');
    const referenceSet=new Set(referenceKeys.filter(Boolean)),sharedKeys=new Set(currentKeys.filter(key=>key&&referenceSet.has(key)));
    return {
      currentRows:(currentRows||[]).filter((row,index)=>sharedKeys.has(currentKeys[index])),
      referenceRows:(referenceRows||[]).filter((row,index)=>sharedKeys.has(referenceKeys[index])),
      sharedKeys,
      cells:[...sharedKeys].map(key=>cells.get(key)),
    };
  }
  /* Ortak çiftlerin toplamlarından iki LFL yöntemini birlikte üretir.
     weighted: metricBetween(summary(ortak güncel), summary(ortak kıyas)) ile aynı sonuç.
     fisher: fisherDetail ile aynı sonuç. */
  function comparableChanges(comparable){
    const buckets=new Map(),totals={};
    for(const cell of (comparable&&comparable.cells)||[]){
      let list=buckets.get(cell.currency);if(!list)buckets.set(cell.currency,list=[]);list.push(cell);
      const t=totals[cell.currency]||(totals[cell.currency]={cq:0,cw:0,rq:0,rw:0});t.cq+=cell.cq;t.cw+=cell.cw;t.rq+=cell.rq;t.rw+=cell.rw;
    }
    let weightedSum=0,weightedQty=0;
    for(const currency of ['TRY','USD']){
      const t=totals[currency];if(!t||!(t.cq>0)||!(t.rq>0))continue;const c=t.cw/t.cq,r=t.rw/t.rq;if(!(c>0)||!(r>0))continue;
      weightedSum+=(c-r)/r*100*t.cq;weightedQty+=t.cq;
    }
    return {weighted:weightedQty?weightedSum/weightedQty:null,fisher:fisherFinalize(buckets).change};
  }
  /* Fisher LFL: ortak kırılım/para birimi çiftlerinde karma etkisinden arındırılmış
     fiyat değişimi. Paasche (güncel adet karması) ve Laspeyres (kıyas adet karması)
     endekslerinin geometrik ortalamasıdır. Para birimleri, ağırlıklı yöntemdeki gibi
     güncel karşılaştırılabilir adetle birleştirilir. */
  function fisherFinalize(buckets){
    const byCurrency={};let weighted=0,totalQty=0;
    for(const currency of ['TRY','USD']){
      const cells=buckets.get(currency);if(!cells)continue;
      let p1q1=0,p0q1=0,p1q0=0,p0q0=0,qty=0;
      cells.forEach(cell=>{
        if(!(cell.cq>0)||!(cell.rq>0))return;const p1=cell.cw/cell.cq,p0=cell.rw/cell.rq;if(!(p1>0)||!(p0>0))return;
        p1q1+=p1*cell.cq;p0q1+=p0*cell.cq;p1q0+=p1*cell.rq;p0q0+=p0*cell.rq;qty+=cell.cq;
      });
      if(!(qty>0)||!(p0q1>0)||!(p0q0>0))continue;
      const paasche=p1q1/p0q1,laspeyres=p1q0/p0q0,fisher=Math.sqrt(paasche*laspeyres);
      byCurrency[currency]={paasche:(paasche-1)*100,laspeyres:(laspeyres-1)*100,change:(fisher-1)*100,qty};
      weighted+=byCurrency[currency].change*qty;totalQty+=qty;
    }
    return {change:totalQty?weighted/totalQty:null,byCurrency};
  }
  function fisherDetail(currentRows,referenceRows,groupBy=[],helpers){
    const {rowMeta,groupValue}=helpers;
    const dims=Array.isArray(groupBy)?groupBy.filter(Boolean):[],buckets=new Map();
    const collect=(rows,side)=>{for(const row of rows||[]){
      const meta=rowMeta(row);if(!meta.valid)continue;
      const group=dims.length?groupValue(row,dims):'__all__';if(!group)continue;
      let byGroup=buckets.get(meta.currency);if(!byGroup)buckets.set(meta.currency,byGroup=new Map());
      let cell=byGroup.get(group);if(!cell)byGroup.set(group,cell={cq:0,cw:0,rq:0,rw:0});
      if(side==='current'){cell.cq+=meta.quantity;cell.cw+=meta.quantity*meta.fob;}else{cell.rq+=meta.quantity;cell.rw+=meta.quantity*meta.fob;}
    }};
    collect(currentRows,'current');collect(referenceRows,'reference');
    return fisherFinalize(buckets);
  }
  /* Satırlara yeniden dokunmadan, kırılım başına hazır summary() çiftlerinden
     (ör. LFL grup tablosu) aynı Fisher sonucunu üretir. */
  function fisherDetailFromSummaries(pairs){
    const buckets=new Map();
    for(const pair of pairs||[]){
      const current=pair&&pair.current,reference=pair&&pair.reference;if(!current||!reference)continue;
      for(const currency of ['TRY','USD']){
        const c=current.byCurrency&&current.byCurrency[currency],r=reference.byCurrency&&reference.byCurrency[currency];if(!c||!r)continue;
        let cells=buckets.get(currency);if(!cells)buckets.set(currency,cells=[]);
        cells.push({cq:c.qty,cw:c.weighted,rq:r.qty,rw:r.weighted});
      }
    }
    return fisherFinalize(buckets);
  }
  function fisherChange(currentRows,referenceRows,groupBy=[],helpers,type='change'){
    const change=fisherDetail(currentRows,referenceRows,groupBy,helpers).change;
    return change==null?null:type==='improvement'?-change:change;
  }
  function aiKnowledge(lang){
    return [lang==='en'
      ? 'LFL = Like-for-Like. Buyer Log compares quantity-weighted FOB between a current and reference period, only for breakdown/currency pairs present in both periods. This is a price comparison, not retail sales growth. Use the deterministic LFL query; do not ask the user to define LFL.'
      : 'LFL = Like-for-Like. Buyer Log güncel ve kıyas dönemlerinin adet ağırlıklı FOB fiyatını, yalnız her iki dönemde de bulunan kırılım/para birimi çiftlerinde karşılaştırır. Satış büyümesi analizi değildir. Deterministik LFL sorgusunu kullan; kullanıcıdan LFL tanımı isteme.',
      'Default breakdown: '+DEFAULT_BREAKDOWN.join(' + '),
      lang==='en'?'Valid rows: FOB > 0 and quantity > 0. Turkey uses TRY, other countries USD; currencies are never averaged together. Change = (current/reference - 1)*100; improvement has the opposite sign. The overall change is Fisher LFL by default (geometric mean of current-mix and reference-mix price indices over shared pairs, so product-mix shifts do not flip the sign); the weighted average (each period with its own quantity mix) is reported as well. Currency changes are combined by current comparable quantity. Default periods: latest season versus previous season with the same prefix, using Buyer Log season rules. Missing comparison season requires clarification; never compare the same season to itself.'
        :'Geçerli kayıt: FOB > 0 ve adet > 0. Türkiye TRY, diğer ülkeler USD; para birimleri birlikte ortalanmaz. Değişim = (güncel/kıyas - 1)*100; iyileşme ters işaretlidir. Genel değişim varsayılan olarak Fisher LFL ile hesaplanır (ortak çiftlerde güncel ve kıyas adet karmalı fiyat endekslerinin geometrik ortalaması; ürün karması kayması işareti çeviremez); her dönemin kendi adet karmasıyla ağırlıklı ortalama da raporlanır. Para birimi değişimleri güncel karşılaştırılabilir adetle birleştirilir. Varsayılan dönem: Buyer Log sezon kurallarına göre son sezon ve aynı önekli önceki sezon. Kıyas sezonu yoksa dönem sorulur; aynı sezon kendisiyle karşılaştırılmaz.'
    ].join('\n');
  }
  return {DEFAULT_BREAKDOWN,countryKey,isTurkeyCountry,currencyForRow,summary,metricBetween,comparablePeriodRows,comparableChanges,fisherDetail,fisherDetailFromSummaries,fisherChange,aiKnowledge};
});
