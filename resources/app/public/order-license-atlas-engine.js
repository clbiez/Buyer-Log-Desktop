/* Selected order rows → unique license cards. Canonical fields own source bindings. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./canonical-fields'):root.BLCanonicalFields);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLOrderLicenseAtlasEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(C){
  'use strict';
  function match(rows,moduleId,cards){
    if(!['cp','orders'].includes(moduleId))throw new Error('INVALID_ORDER_ATLAS_MODULE');
    const byLicense=new Map(),selected=new Map(),issues=new Map();let withoutLicense=0;
    for(const card of cards||[]){
      const key=C.token(card.license);if(!key)continue;
      if(!byLicense.has(key))byLicense.set(key,[]);
      byLicense.get(key).push(card);
    }
    for(const row of rows||[]){
      const license=String(C.canonicalValue(row,moduleId,'license')||'').trim();
      const licensor=String(C.canonicalValue(row,moduleId,'licensor')||'').trim();
      const key=C.token(license),owner=C.token(licensor);
      if(!key){withoutLicense++;continue;}
      const candidates=(byLicense.get(key)||[]).filter(card=>!owner||C.token(card.licensor)===owner);
      if(candidates.length===1){selected.set(candidates[0].id,candidates[0]);continue;}
      const pair=JSON.stringify([key,owner]);
      if(!issues.has(pair))issues.set(pair,{license,licensor,reason:candidates.length?'ambiguous':'missing'});
    }
    return {cards:[...selected.values()],issues:[...issues.values()],withoutLicense};
  }
  return Object.freeze({match});
});
