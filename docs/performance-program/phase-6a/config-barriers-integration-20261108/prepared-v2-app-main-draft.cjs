'use strict';
// PREPARATION ONLY. App-main patch recipe, applied only in memory by later tests.
// v1 pins/drafts and user-storage.js are deliberately untouched.
const assert=require('node:assert/strict');
function once(source,before,after){const at=source.indexOf(before);assert.ok(at>=0,'exact draft seam missing');assert.equal(source.indexOf(before,at+before.length),-1,'ambiguous seam');return source.slice(0,at)+after+source.slice(at+before.length);}
function handler(source,id,event){const start="document.getElementById('"+id+"').addEventListener('"+event+"',";const at=source.indexOf(start);assert.ok(at>=0,id);const end=source.indexOf('\n});',at);assert.ok(end>at,id);return source.slice(at,end+4);}
function selectionGate(kind,reason,indent='  '){return [
 indent+'if(ordersProjectionIsThin()){',
 indent+"  await ensureOrdersFullForAction('"+reason+"');",
 indent+"  if(ordersProjectionIsThin()||activeProfilePage()!==page||document.getElementById('"+kind+"Select')!==target||target.isConnected===false||target.value!==id)throw ordersFullActionError('ORDERS_FULL_STALE');",
 indent+'}',
 ].join('\n');}
function deletionGate(kind,reason,indent='  ',catchHere=true){const body=[
 indent+'if(ordersProjectionIsThin()){',
 ...(catchHere?[indent+'  try{']:[]),
 indent+(catchHere?'    ':'  ')+"await ensureOrdersFullForAction('"+reason+"');",
 indent+(catchHere?'    ':'  ')+"if(ordersProjectionIsThin()||activeProfilePage()!==page||document.getElementById('"+kind+"Select')!==target||target.isConnected===false||target.value!==id)throw ordersFullActionError('ORDERS_FULL_STALE');",
 ...(catchHere?[indent+'  }catch(error){showToast(error.message,{kind:\'error\'});return;}']:[]),
 indent+'}',
 ];return body.join('\n');}
function patch(source){
 for(const kind of ['view','filter']){
  const id=kind+'Select',old=handler(source,id,'change');let next=old;
  next=once(next,".addEventListener('change', e=>{",".addEventListener('change', async e=>{");
  next=once(next,'  const page=activeProfilePage();',
   "  const page=activeProfilePage(),target=e.target,id=target.value;\n"+selectionGate(kind,'orders.profiles.'+kind+'.select'));
  next=once(next,"profileItem('"+kind+"',e.target.value,page)","profileItem('"+kind+"',id,page)");
  next=once(next,".addEventListener('change', async e=>{", ".addEventListener('change', async e=>{\n  try{");
  next=once(next,'\n});',"\n  }catch(error){showToast(error?.message||ordersFullActionError('ORDERS_FULL_STALE').message,{kind:'error'});}\n});");
  source=once(source,old,next);
 }
 for(const kind of ['view','filter']){
  const old=handler(source,kind+'DeleteBtn','click');let next=old;
  next=once(next,'  const page=activeProfilePage();',
   "  const page=activeProfilePage(),target=document.getElementById('"+kind+"Select');\n"+deletionGate(kind,'orders.profiles.'+kind+'.delete'));
  // A queued mutation can start later than the outer click handler. Its own
  // current revision/request capture must also occur after a thin-only gate.
  next=once(next,"const saved=await enqueueProfileMutation('"+kind+"',()=>fetchJSON(",
   "const saved=await enqueueProfileMutation('"+kind+"',async()=>{\n"+deletionGate(kind,'orders.profiles.'+kind+'.delete-queued','      ',false)+"\n      return fetchJSON(");
  next=once(next,'expectedRevision:'+kind+'Store._revision}));',
   'expectedRevision:'+kind+'Store._revision});\n    });');
  // The server await can admit a replacement thin snapshot. Gate before the
  // first local cache/favorite mutation, not merely before its final render.
  next=once(next,"    "+kind+"Store=setProfileStore('"+kind+"',saved,page);",
   deletionGate(kind,'orders.profiles.'+kind+'.delete-result','    ',false)+"\n    "+kind+"Store=setProfileStore('"+kind+"',saved,page);");
  source=once(source,old,next);
 }
 for(const [kind,reset] of [['view','resetViewToSystemDefault'],['filter','resetFiltersToSystemDefault']]){
  const old="document.getElementById('"+kind+"ResetBtn')?.addEventListener('click',"+reset+');';
  const next="document.getElementById('"+kind+"ResetBtn')?.addEventListener('click',async event=>{\n"+
   "  try{\n    if(ordersProjectionIsThin()){\n      const page=activeProfilePage(),target=event.currentTarget;\n"+
   "      await ensureOrdersFullForAction('orders.profiles."+kind+".reset');\n"+
   "      if(ordersProjectionIsThin()||activeProfilePage()!==page||document.getElementById('"+kind+"ResetBtn')!==target||target.isConnected===false)throw ordersFullActionError('ORDERS_FULL_STALE');\n"+
   "    }\n    "+reset+"();\n  }catch(error){showToast(error?.message||ordersFullActionError('ORDERS_FULL_STALE').message,{kind:'error'});}\n});";
  source=once(source,old,next);
 }
 source=once(source,'  applyCachedProfilesForCurrentPage(applyFavorites);\n  await refreshViewSelect();await refreshFilterSelect();',
  "  if(ordersProjectionIsThin()){\n    await ensureOrdersFullForAction('orders.profiles.cached');\n    if(ordersProjectionIsThin())throw ordersFullActionError('ORDERS_FULL_STALE');\n  }\n  if(generation!==profileApplyGeneration||activeProfilePage()!==page)return;\n  applyCachedProfilesForCurrentPage(applyFavorites);\n  await refreshViewSelect();await refreshFilterSelect();");
 source=once(source,'  if(applyFavorites){\n    applyStoredProfilesForCurrentPage(true);\n  }\n}',
  "  if(applyFavorites){\n    if(ordersProjectionIsThin()){\n      await ensureOrdersFullForAction('orders.profiles.remote');\n      if(ordersProjectionIsThin())throw ordersFullActionError('ORDERS_FULL_STALE');\n    }\n    if(generation!==profileApplyGeneration||activeProfilePage()!==page)return;\n    applyStoredProfilesForCurrentPage(true);\n  }\n}");
 source=once(source,'    applyCachedProfilesForCurrentPage(initialScreenLoad);',
  "    if(ordersProjectionIsThin()){\n      const profilePage=activeProfilePage();\n      await ensureOrdersFullForAction('orders.profiles.bootstrap');\n      if(ordersProjectionIsThin()||activeProfilePage()!==profilePage)throw ordersFullActionError('ORDERS_FULL_STALE');\n    }\n    applyCachedProfilesForCurrentPage(initialScreenLoad);");
 return source;
}
module.exports={patch,handler};
