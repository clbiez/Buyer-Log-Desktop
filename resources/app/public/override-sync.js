'use strict';

// Buyer Log v2.72 — revisioned order override mutation queue.
let overrideMutationQueue=Promise.resolve(), lastOverrideErrorToastAt=0;
function overrideRevisionKey(kind){return kind==='suppFob'?'suppFob':'orders';}
function notifyOverrideSaveError(message){
  const now=Date.now();
  if(now-lastOverrideErrorToastAt>3500){lastOverrideErrorToastAt=now;showToast(message);}
}
function enqueueOverrideMutation(kind,url,opts={}){
  const revisionKey=overrideRevisionKey(kind);
  const task=async()=>{
    try{
      const requestOpts={...opts,headers:{...(opts.headers||{})},expectedRevision:Number(state.storeRevisions[revisionKey])||0};
      // v6.44 — canlı senkron bu sekmenin kendi yazmasını ayırt edebilsin diye;
      // kendi yazdığın değişiklik için kendine yenileme tetiklemene gerek yok,
      // ekran zaten güncel.
      if(typeof window!=='undefined'&&window.BL_CLIENT_ID)requestOpts.headers['X-Client-Id']=window.BL_CLIENT_ID;
      if(kind==='orders')requestOpts.headers['X-Supp-Fob-Revision']=String(Number(state.storeRevisions.suppFob)||0);
      const data=await fetchJSON(url,requestOpts);
      if(Number.isInteger(Number(data.revision)))state.storeRevisions[revisionKey]=Number(data.revision);
      if(data.revisions&&typeof data.revisions==='object')Object.entries(data.revisions).forEach(([key,value])=>{if(Number.isInteger(Number(value)))state.storeRevisions[key]=Number(value);});
      if(data.overrides&&Number.isInteger(Number(data.overrides._revision)))state.storeRevisions.overrides=Number(data.overrides._revision);
      return data;
    }catch(err){
      if(err.code==='REVISION_CONFLICT'){
        const conflictKey=err.revisionKey||revisionKey;
        if(Number.isInteger(Number(err.currentRevision)))state.storeRevisions[conflictKey]=Number(err.currentRevision);
        notifyOverrideSaveError(appLang==='en'?'Data changed in another window. Current data is being reloaded.':'Veri başka bir pencerede değişti. Güncel veriler yeniden yükleniyor.');
        try{await loadFromServer(false);}catch(_){}
      }
      throw err;
    }
  };
  const pending=overrideMutationQueue.then(task,task);
  overrideMutationQueue=pending.catch(()=>{});
  return pending;
}
// v6.34 — kuyruktaki bütün yazmalar bitene kadar bekler. Yenileme ve sayfa
// kapanışı bu noktayı beklemeden ilerlerse, gönderilmiş ama henüz yanıtlanmamış
// bir düzenleme kaybolabilir. Hata fırlatmaz: amaç beklemek, sonucu raporlamak değil.
function overrideMutationsSettled(){
  return overrideMutationQueue.catch(()=>{});
}
if(typeof window!=='undefined'){
  window.overrideMutationsSettled=overrideMutationsSettled;
  window.enqueueOverrideMutation=enqueueOverrideMutation;
}
