/* Shared native checklist answer ordering, extracted from Supplier Sync. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else if(root)root.BLChecklistAnswerMergeEngine=api;}(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const copy=value=>value==null?value:JSON.parse(JSON.stringify(value)),safeKey=key=>!['__proto__','prototype','constructor'].includes(key);
 function merge(localAnswers,payload,pendingAnswers){
  const local={};for(const key of Object.keys(localAnswers||{}))if(safeKey(key))local[key]=copy(localAnswers[key]);
  const answers=payload&&payload.answers&&typeof payload.answers==='object'?payload.answers:{},tombstones=payload&&payload.tombstones&&typeof payload.tombstones==='object'?payload.tombstones:{},pending=pendingAnswers||{};
  Object.keys(tombstones).forEach(function(key){if(!safeKey(key)||pending[key])return;const tomb=tombstones[key]||{},current=local[key],currentAt=current&&String(current.at||''),tombAt=String(tomb.at||'');if(!currentAt||currentAt<=tombAt){if(tomb.deleted===true)delete local[key];else local[key]=copy({...tomb,state:'open'});}});
  Object.keys(answers).forEach(function(key){if(!safeKey(key)||pending[key])return;const incoming=answers[key]||{},current=local[key];if(!current||String(current.at||'')<=String(incoming.at||''))local[key]=copy(incoming);});
  // Preserve exact unacknowledged local decisions before displaying shared data.
  Object.keys(pending).forEach(function(key){if(!safeKey(key))return;const entry=pending[key];if(entry.deleted===true)delete local[key];else local[key]=copy(entry);});
  return local;
 }
 return {merge};
}));
