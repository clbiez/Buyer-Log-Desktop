'use strict';
// PREPARED ONLY. Exact app-main patch recipe; no filesystem effects.
const assert=require('node:assert/strict');
function once(source,before,after){const at=source.indexOf(before);assert.ok(at>=0,'switchTab seam missing');assert.equal(source.indexOf(before,at+before.length),-1,'ambiguous switchTab seam');return source.slice(0,at)+after+source.slice(at+before.length);}
function patch(source){
 const ready='  const profileReady=profileFirstVisit?applyProfilesForCurrentPage(true):Promise.resolve();';
 source=once(source,ready,ready+"\n  let profileFailureReported=false;\n  const reportProfileFailure=error=>{\n    if(profileFailureReported)return;\n    profileFailureReported=true;\n    showToast(error?.message||ordersFullActionError('ORDERS_FULL_STALE').message,{kind:'error'});\n  };");
 const marker='  if(profileFirstVisit)void profileReady.then(()=>{if(currentActiveTab()!==tab)_favoritesAppliedPages.delete(tab);});';
 source=once(source,marker,marker.slice(0,-1)+'.catch(reportProfileFailure);');
 for(const [tab,render] of [['cp','renderCP'],['orders','renderOrders']]){
  const branch="    void (profileFirstVisit||warmedUnrendered?Promise.all([dataReady,profileReady]).then(()=>{\n      if(currentActiveTab()!=='"+tab+"'||!state."+tab+")return;\n      if(profileFirstVisit)applyStoredProfilesForCurrentPage(true);\n      "+render+"();\n    }):dataReady);";
  source=once(source,branch,branch.replace('    }):dataReady);','    }).catch(reportProfileFailure):dataReady);'));
 }
 const collection="    void Promise.all([dataReady,profileReady]).then(()=>{if(currentActiveTab()==='koleksiyon'&&typeof renderKol==='function'){applyStoredProfilesForCurrentPage(true);renderKol();}});";
 source=once(source,collection,collection.slice(0,-1)+'.catch(reportProfileFailure);');
 const shipping="    void profileReady.then(()=>{if(currentActiveTab()==='shipping'&&typeof renderShipTable==='function'){\n      applyStoredProfilesForCurrentPage(true);\n      renderShipTable();\n    }});";
 source=once(source,shipping,shipping.slice(0,-1)+'.catch(reportProfileFailure);');
 return source;
}
module.exports={patch};
