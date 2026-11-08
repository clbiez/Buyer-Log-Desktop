'use strict';
// PREPARATION ONLY. Exact, pinned edits in memory for root's later RED/GREEN run.
// No production file is written; all original executable bodies otherwise remain.
const assert=require('node:assert/strict');
function once(source,before,after){const at=source.indexOf(before);assert.ok(at>=0,'draft seam must exist');assert.equal(source.indexOf(before,at+before.length),-1,'draft seam must be unique');return source.slice(0,at)+after+source.slice(at+before.length);}
function storage(source){
 source=once(source,'    hydrate:function(){\n', '    hydrate:function(options){\n      var applyBarrierFailed=false;\n');
 source=once(source,"        .then(function(data){\n          if(!data||!data.entries)return {applied:0,pushed:0};\n", "        .then(async function(data){\n          if(!data||!data.entries)return {applied:0,pushed:0};\n          // Yanıt alındıktan SONRA, rol/yerel/meta mutasyonundan ÖNCE bekle.\n          if(options&&typeof options.beforeApply==='function'){\n            try{await options.beforeApply();}catch(error){applyBarrierFailed=true;throw error;}\n          }\n");
 source=once(source,'        .catch(function(){return {applied:0,pushed:0}});', '        .catch(function(error){if(applyBarrierFailed)throw error;return {applied:0,pushed:0}});');
 return source;
}
function app(source){
 source=once(source,'Promise.resolve().then(()=>BLStorage.hydrate()).then(sync=>{',
  "Promise.resolve().then(()=>BLStorage.hydrate({beforeApply:()=>ordersProjectionIsThin()?ensureOrdersFullForAction('orders.preferences.hydrate'):undefined})).then(sync=>{");
 source=once(source,'  applyCachedProfilesForCurrentPage(applyFavorites);\n  await refreshViewSelect();await refreshFilterSelect();',
  "  if(ordersProjectionIsThin())await ensureOrdersFullForAction('orders.profiles.cached');\n  if(generation!==profileApplyGeneration||activeProfilePage()!==page)return;\n  applyCachedProfilesForCurrentPage(applyFavorites);\n  await refreshViewSelect();await refreshFilterSelect();");
 source=once(source,'  if(applyFavorites){\n    applyStoredProfilesForCurrentPage(true);\n  }\n}',
  "  if(applyFavorites){\n    // Ağ yanıtları beklenirken yeni bir thin snapshot kurulmuş olabilir.\n    if(ordersProjectionIsThin())await ensureOrdersFullForAction('orders.profiles.remote');\n    if(generation!==profileApplyGeneration||activeProfilePage()!==page)return;\n    applyStoredProfilesForCurrentPage(true);\n  }\n}");
 return source;
}
module.exports={app,storage};
