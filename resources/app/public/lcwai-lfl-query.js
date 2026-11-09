/* LCW AI için LFL plan adaptörü. Hesap gerçek LFL motorundadır; kayıt yazmaz. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./canonical-fields'):root.BLCanonicalFields,node?require('./business-rules'):root.BLBusinessRules,node?require('./lfl-calculation-engine'):root.BLLflCalculationEngine);
  if(node)module.exports=api;if(root)root.BLLcwAiLflQuery=api;
})(typeof window!=='undefined'?window:globalThis,function(CF,BR,LFL){
  'use strict';
  const T=(lang,tr,en)=>lang==='en'?en:tr;
  const fieldFor=(ds,id)=>ds.fields.find(f=>f.canonical===id);
  function normalize(input,spec,dataset,datasets,Q,lang){
    const errors=[],notes=[];
    const ref=datasets.find(ds=>ds.id===(input.referenceDataset||dataset.id));
    if(!ref)return {errors:['lfl-reference-dataset-unavailable'],notes};
    if(spec.columns.length||spec.list.length||spec.measures.length)return {errors:['lfl-use-comparison-without-measures-list-or-pivot'],notes};
    for(const ds of [dataset,ref])for(const id of ['fob','orderQuantity','country']){
      const f=fieldFor(ds,id);if(!f||(['fob','orderQuantity'].includes(id)&&f.kind!=='number'))errors.push(`lfl-required-field:${ds.id}:${id}`);
    }
    const by=input.matchBy||(spec.rows.length?spec.rows.map(dim=>dim.field):LFL.DEFAULT_BREAKDOWN.map(id=>id==='classification'?'category':id));
    if(!Array.isArray(by)||!by.length||by.length>3)errors.push('lfl-match-by-needs-1-to-3-dimensions');
    const matchBy=[];
    for(const id of Array.isArray(by)?by.slice(0,3):[]){
      const left=Q.resolveField(dataset,id&&id.field||id),right=left&&fieldFor(ref,left.canonical);
      if(!left||!right||left.kind!=='text'||!CF.canJoin(dataset.module,left.id,ref.module,right.id))errors.push(`lfl-incompatible-dimension:${id}`);
      else matchBy.push({field:left.id,referenceField:right.id});
    }
    if(spec.rows.length&&JSON.stringify(spec.rows.map(dim=>dim.field))!==JSON.stringify(matchBy.map(dim=>dim.field)))errors.push('lfl-rows-must-match-comparison-breakdown');
    const seasons=ds=>{const f=fieldFor(ds,'season');return f?[...new Set(ds.rows.map(row=>Q.read(f,row)).filter(Boolean))].sort(BR.compareSeasonNumberThenLetter):[];};
    let currentFilters=input.currentFilters,referenceFilters=input.referenceFilters;
    if(currentFilters==null&&referenceFilters==null){
      const current=seasons(dataset).at(-1)||'',previous=BR.previousSeasonByPrefix(current,seasons(ref));
      if(!current||!previous||previous===current)return {errors,notes,clarify:{question:T(lang,'LFL kıyası için hangi güncel ve önceki sezonu veya iki dönemi kullanayım? Uygun önceki sezon veride bulunamadı.','Which current and reference seasons or two periods should I use for LFL? A suitable previous season was not found.'),options:seasons(ref).slice(-6)}};
      currentFilters=[{field:'season',values:[current]}];referenceFilters=[{field:'season',values:[previous]}];
      notes.push(T(lang,`LFL varsayılan dönemleri: ${current} / ${previous}; aynı sezon öneki kullanıldı.`,`Default LFL periods: ${current} / ${previous}; the same season prefix was used.`));
    }
    if(!Array.isArray(currentFilters)||!currentFilters.length||!Array.isArray(referenceFilters)||!referenceFilters.length)return {errors:[...errors,'lfl-two-periods-required'],notes};
    const sharedReference=spec.filters.map(filter=>{
      const left=dataset.fields.find(f=>f.id===filter.field),right=left&&fieldFor(ref,left.canonical);
      if(!right){errors.push(`lfl-reference-filter-unavailable:${filter.field}`);return filter;}
      return {...filter,field:right.id};
    });
    const current=Q.normalizeSpec({dataset:dataset.id,calendar:spec.calendar,filters:currentFilters,measures:[{agg:'count'}]},[dataset],{lang});
    const reference=Q.normalizeSpec({dataset:ref.id,calendar:spec.calendar,filters:[...sharedReference,...(referenceFilters||[])],measures:[{agg:'count'}]},[ref],{lang});
    errors.push(...current.errors,...reference.errors);notes.push(...current.notes,...reference.notes);
    if(dataset.id===ref.id&&JSON.stringify([...spec.filters,...current.spec.filters])===JSON.stringify(reference.spec.filters))errors.push('lfl-identical-periods');
    spec.comparison={type:'lfl',referenceDataset:ref.id,currentFilters:current.spec.filters,referenceFilters:reference.spec.filters,matchBy};
    return {errors,notes,clarify:current.clarify||reference.clarify,reference:ref};
  }
  function* steps(spec,dataset,reference,Q,lang){
    const c=spec.comparison,fields=ds=>Object.fromEntries(['fob','orderQuantity','country'].map(id=>[id,fieldFor(ds,id)]));
    function* project(rows,ds,side){
      const f=fields(ds),dims=c.matchBy.map(dim=>ds.fields.find(item=>item.id===(side==='current'?dim.field:dim.referenceField)));
      const out=[];let batch=0,since=Date.now();
      for(const row of rows){const country=Q.read(f.country,row),keys=dims.map(dim=>Q.read(dim,row));out.push({fob:Q.read(f.fob,row),quantity:Q.read(f.orderQuantity,row),country,keys,currency:LFL.currencyForRow({country}),key:JSON.stringify(keys.map(Q.token))});if(++batch%256===0&&Date.now()-since>=8){yield;since=Date.now();}}
      return out;
    }
    const currentMatched=yield* Q.matchSteps({...spec,filters:[...spec.filters,...c.currentFilters]},dataset);
    const referenceMatched=yield* Q.matchSteps({filters:c.referenceFilters},reference);
    const current=yield* project(currentMatched,dataset,'current'),previous=yield* project(referenceMatched,reference,'reference');
    const helpers={rowMeta:row=>({valid:row.fob>0&&row.quantity>0,fob:row.fob,quantity:row.quantity,currency:row.currency}),groupValue:row=>row.key,dtrTypeForRow:()=>''};
    const paired=LFL.comparablePeriodRows(current,previous,c.matchBy,helpers);
    yield;
    const groups=new Map();
    let batch=0,since=Date.now();
    for(const [side,rows] of [['current',paired.currentRows],['reference',paired.referenceRows]])for(const row of rows){
      const key=helpers.groupValue(row)+'\u0001'+row.currency;
      if(!groups.has(key))groups.set(key,{keys:row.keys,currency:row.currency,current:[],reference:[]});
      groups.get(key)[side].push(row);
      if(++batch%256===0&&Date.now()-since>=8){yield;since=Date.now();}
    }
    const result={kind:'lfl',columns:c.matchBy.map(dim=>({label:dataset.fields.find(f=>f.id===dim.field).label,kind:'text'})),rows:[],total:null,matched:currentMatched.length,scanned:dataset.rows.length,truncatedColumns:0,outsideCalendar:0};
    result.columns.push(...[
      [T(lang,'Para birimi','Currency'),'text'],[T(lang,'Güncel adet','Current quantity'),'number'],[T(lang,'Kıyas adet','Reference quantity'),'number'],
      [T(lang,'Güncel ağırlıklı FOB','Current weighted FOB'),'number'],[T(lang,'Kıyas ağırlıklı FOB','Reference weighted FOB'),'number'],
      [T(lang,'FOB değişimi %','FOB change %'),'number'],[T(lang,'İyileşme %','Improvement %'),'number'],
    ].map(([label,kind])=>({label,kind})));
    for(const g of groups.values()){
      yield;
      const cur=LFL.summary(g.current,helpers),prev=LFL.summary(g.reference,helpers);
      result.rows.push([...g.keys,g.currency,cur.qty,prev.qty,cur.avg,prev.avg,LFL.metricBetween(cur,prev),LFL.metricBetween(cur,prev,'improvement')]);
    }
    result.rows.sort((a,b)=>b[c.matchBy.length+1]-a[c.matchBy.length+1]);
    yield;
    const cur=LFL.summary(paired.currentRows,helpers),prev=LFL.summary(paired.referenceRows,helpers);
    result.comparisonStats={referenceMatched:referenceMatched.length,currentComparable:paired.currentRows.length,referenceComparable:paired.referenceRows.length,change:LFL.metricBetween(cur,prev),improvement:LFL.metricBetween(cur,prev,'improvement')};
    if(spec.limit)result.rows=result.rows.slice(0,spec.limit);
    return result;
  }
  return Object.freeze({normalize,steps});
});
