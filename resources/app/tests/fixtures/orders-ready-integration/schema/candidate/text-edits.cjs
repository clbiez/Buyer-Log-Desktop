'use strict';
const crypto=require('node:crypto');
const pins={app:'ee50b8b649e5c2797470d13feb919ea5befc5f03d15823b4ae34d5f08363d04b',personal:'45a69456315853e21445fe81aea02540ebf5f3bce8a4a113672d2359a25da488'};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function once(text,old,next){if(text.split(old).length!==2)throw Error('SCHEMA_ACTION_SETUP: nonunique exact anchor '+old);return text.replace(old,next);}
function patchApp(source,extractFunction,helpers){
 if(hash(source)!==pins.app)throw Error('SCHEMA_ACTION_SETUP: app source drift');
 const changed=[],replace=(name,mutate)=>{const old=extractFunction(source,name),next=mutate(old);source=once(source,old,next);changed.push({name,old,next});};
 const gate=(name,args,kind)=>`\n  if(ordersProjectionIsThin())return window.BLOrdersUiChange('orders','orders.schema.${name}','orders-schema',()=>()=>true,()=>${name}(${args}));\n  const action=captureOrdersNoteAction('${kind}');`;
 for(const [name,args,kind] of [['addPersonalOrderNoteColumn','rerenderFn','personal'],['renamePersonalOrderNoteColumn','id,rerenderFn','personal'],
  ['removePersonalOrderNoteColumn','id,rerenderFn','personal'],['addCpNoteColumn','rerenderFn','shared'],['renameCpNoteColumn','id,rerenderFn','shared'],['removeCpNoteColumn','id,rerenderFn','shared']]){
  replace(name,old=>{
   let next=once(old,old.slice(0,old.indexOf('{')+1),old.slice(0,old.indexOf('{')+1)+gate(name,args,kind));
   const anchor=kind==='personal'?(name==='removePersonalOrderNoteColumn'?'    notes.removeDefinition(id);':'    notes.setDefinitions('):'    await saveCpNoteColumnDefs(';
   next=once(next,anchor,'    assertOrdersNoteAction(action);\n'+anchor);
   if(kind==='personal'){
    const after=name==='removePersonalOrderNoteColumn'?'    forgetPersistedColumnKeys(\'cp\',[id]);':'    refreshPersonalOrderNoteColumns(rerenderFn);';
    next=once(next,after,'    assertOrdersNoteActionSource(action);\n'+after);
   }else{
    const line=next.split('\n').find(line=>line.includes('await saveCpNoteColumnDefs('));
    next=once(next,line,line.replace(/\);$/,',action);')+'\n    assertOrdersNoteAction(action);');
   }
   return next;
  });
 }
 replace('saveCpNoteColumnDefs',old=>{
  let next=once(old,'async function saveCpNoteColumnDefs(nextDefs){',`async function saveCpNoteColumnDefs(nextDefs,actionIntent=null){
  _ordersRequireFullSynchronousRead();
  const action=actionIntent||captureOrdersNoteAction('shared');
  // A finite import/rollback must provide its original action; current full
  // state alone cannot certify an externally retained definitions array.
  if(!actionIntent&&ordersConfigurationIntentInvolved(action.intent))throw ordersFullActionError('ORDERS_FULL_STALE');
  assertOrdersNoteAction(action);`);
  next=once(next,'  if(!res.ok)throw new Error(data.error||res.statusText);','  assertOrdersNoteAction(action);\n  if(!res.ok)throw new Error(data.error||res.statusText);');
  return once(next,'  syncCpNoteColumns(savedDefs);','  syncCpNoteColumns(savedDefs);\n  acknowledgeOrdersNoteAction(action);');
 });
 const block='// BEGIN private Orders note action guards\n'+helpers+'\n// END private Orders note action guards\n';
 source=once(source,'async function saveCpNoteColumnDefs(nextDefs,actionIntent=null){',block+'async function saveCpNoteColumnDefs(nextDefs,actionIntent=null){');
 let restored=source.replace(block,'');for(const item of changed.slice().reverse())restored=once(restored,item.next,item.old);
 if(hash(restored)!==pins.app)throw Error('SCHEMA_ACTION_SETUP: complete source restoration failed');
 return {source,changed,block};
}
function patchPersonal(source){
 if(hash(source)!==pins.personal)throw Error('SCHEMA_ACTION_SETUP: personal source drift');
 const helper=`  function requireFullSchemaMutation(){
    const guard=root&&root.BLOrdersRequireFullSynchronousRead;
    if(typeof guard==='function'){guard();return;}
    // Missing capability can deny an armed finite lifecycle; never authorize it.
    if(root&&root.BLOrdersFiniteLifecycleRequired===true)
      throw Object.assign(new Error('ORDERS_FULL_STALE'),{code:'ORDERS_FULL_STALE'});
  }
`;
 const edits=[['  function normalizeDefinitions(source){',helper+'  function normalizeDefinitions(source){'],
  ['    function setDefinitions(next){','    function setDefinitions(next){\n      requireFullSchemaMutation();'],
  ['    function removeDefinition(id){','    function removeDefinition(id){\n      requireFullSchemaMutation();']];
 let next=source;for(const [old,replacement] of edits)next=once(next,old,replacement);
 let restored=next;for(const [old,replacement] of edits.slice().reverse())restored=once(restored,replacement,old);
 if(hash(restored)!==pins.personal)throw Error('SCHEMA_ACTION_SETUP: personal restoration failed');return next;
}
module.exports={pins,patchApp,patchPersonal};
