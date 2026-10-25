(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BLPriceLineage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Presentation snapshots only. Amounts and selected sources come from the
  // existing pricing/FX engines; this module never selects or calculates a price.
  function binding(row,{module,owner,user,fields}){
    return {module,workspace:String(owner||''),owner:String(row?._collectionOwnerId||owner||''),user:String(user||''),id:String(row?._collectionSourceId??row?.id??row?._id??''),identity:['orderCode','plmId','modelName','colourCode'].map(id=>fields.canonicalValue(row,module,id))};
  }
  function sameBinding(a,b){return Boolean(a&&b&&JSON.stringify(a)===JSON.stringify(b));}
  function offerProvenance(lines,{engine,amount,manufacturer}){
    if(!engine?.effectiveHistory||!engine?.price||!engine?.keyOf)return {origin:'',at:null};
    const offers=[];let unconfirmed=false;
    for(const {line,req}of lines||[]){
      if(engine.keyOf(line.manufacturer)!==engine.keyOf(manufacturer)||engine.price(line.price)!==amount)continue;
      const event=engine.effectiveHistory(line,req).filter(item=>item.type==='offer').at(-1);
      if(event&&engine.price(event.price)===amount&&Number.isFinite(Date.parse(event.at)))offers.push({event,line,req});else unconfirmed=true;
    }
    if(unconfirmed)return {origin:'unconfirmed',at:null};
    const latest=offers.sort((a,b)=>String(b.event.at).localeCompare(String(a.event.at))||String(b.event.id).localeCompare(String(a.event.id)))[0];
    return latest?{origin:latest.event.source||'',at:latest.event.at,requestId:latest.req.id,lineId:latest.line.id}:{origin:'',at:null};
  }
  function snapshot(input){
    const capturedAt=new Date(input.now||Date.now()).toISOString(),now=Date.parse(capturedAt);
    const age=at=>{const stamp=Date.parse(at||'');return Number.isFinite(stamp)&&stamp<=now?Math.floor((now-stamp)/86400000):null;};
    const source={...(input.source||{}),ageDays:age(input.source?.at)},manual=input.fx?.manual===true;
    const fx={...(input.fx||{}),manual,requestedMonth:manual?null:input.fx?.requestedMonth||null,resolvedMonth:manual?null:input.fx?.resolvedMonth||null,revision:manual?null:input.fx?.revision??null,ageDays:manual?null:age(input.fx?.sourceModifiedAt||input.fx?.updatedAt)};
    fx.fallback=Boolean(!manual&&fx.requestedMonth&&fx.resolvedMonth&&fx.requestedMonth!==fx.resolvedMonth);
    return {schemaVersion:1,module:input.module,record:input.record||'',capturedAt,source,values:{...(input.values||{})},rule:input.rule?{...input.rule}:null,trRule:input.trRule?{...input.trRule}:null,fx,revisions:{...(input.revisions||{})},blockers:(input.blockers||[]).slice(),precedence:input.precedence||''};
  }
  return Object.freeze({binding,sameBinding,snapshot,offerProvenance});
});
