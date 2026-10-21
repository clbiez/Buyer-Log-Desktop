/* Shared, pure set-part identity and aggregation for CP and Collection. */
(function(root,factory){
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?require('./canonical-fields'):root.BLCanonicalFields);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLChecklistComponents=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Fields){
  'use strict';
  const CONFIG_ITEM='@set-components',SUFFIX='~part~';
  function validCount(value){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=26?n:0;}
  function description(row,moduleId){
    return ['category','productDescription','productMainDefinition'].map(id=>String(Fields.value(row||{},moduleId||'cp',id)||'')).join(' ');
  }
  function isSet(row,moduleId){return /tak[ıi]m|\bsets?\b/i.test(description(row,moduleId));}
  function count(row,moduleId){
    const explicit=validCount(Fields.value(row||{},moduleId||'cp','setPieceCount'));
    if(explicit)return explicit>1?explicit:0;
    const raw=description(row,moduleId);
    if(!isSet(row,moduleId))return 0;
    const match=raw.match(/(\d+)\s*[-'’]?\s*(?:l[ıiuü]|pieces?|pcs|par[çc]a)/i)||raw.match(/(?:sets?|tak[ıi]m)\s*(?:of\s*)?(\d+)/i);
    const n=validCount(match&&match[1]);return n>1?n:0;
  }
  function labels(n){return Array.from({length:validCount(n)>1?n:0},(_,i)=>String.fromCharCode(65+i));}
  function itemId(base,part){
    if(!/^[A-Z]$/.test(part)||!base||parseItem(base)||String(base).length>180)throw new Error('Invalid checklist part identity.');
    return base+SUFFIX+part;
  }
  function parseItem(id){const match=String(id||'').match(/^(.*)~part~([A-Z])$/);return match?{baseId:match[1],partId:match[2]}:null;}
  function configKey(analysis){return String(analysis.orderKey)+'::'+CONFIG_ITEM;}
  function partsFor(analysis,answers){
    if(!analysis)return [];
    const saved=answers&&answers[configKey(analysis)];
    const n=validCount(saved&&saved.componentCount)||count(analysis.sourceRow||analysis,'cp');
    return labels(n).map(id=>({id,label:id}));
  }
  function aggregate(states,resolved){
    const list=states||[],done=resolved||((s)=>s==='approved'||s==='notRequired');
    if(list.includes('rejected'))return 'rejected';
    if(!list.length||list.some(s=>!done(s)))return 'open';
    if(list.every(s=>s==='notRequired'))return 'notRequired';
    return 'approved';
  }
  function valueParts(value,n){
    if(value&&typeof value==='object'&&Array.isArray(value.parts))return value.parts.map(p=>({...p}));
    return labels(n).map(id=>({id,label:id,state:'open'}));
  }
  function updateValue(value,n,part,state){
    const parts=valueParts(value,n);
    if(!parts.some(p=>p.id===part))throw new Error('Unknown checklist part.');
    return {schemaVersion:1,legacyStatus:value&&typeof value==='object'?value.legacyStatus||'':String(value||''),parts:parts.map(p=>p.id===part?{...p,state}:p)};
  }
  return {CONFIG_ITEM,validCount,isSet,count,labels,itemId,parseItem,configKey,partsFor,aggregate,valueParts,updateValue};
});
