'use strict';

// Buyer Log v2.72 — revisioned order override mutation queue.
let overrideMutationQueue=Promise.resolve(), lastOverrideErrorToastAt=0;
let overrideBatchCapture=null;
function captureOverrideBatch(work){
  if(overrideBatchCapture)throw new Error('Nested override capture');
  const entries=new Map(),waiters=[];let error;
  overrideBatchCapture={entries,waiters};
  try{work();}catch(err){error=err;}finally{overrideBatchCapture=null;}
  if(error){waiters.forEach(item=>item.reject(error));throw error;}
  return {items:[...entries.values()],resolve:data=>waiters.forEach(item=>item.resolve(data)),reject:err=>waiters.forEach(item=>item.reject(err))};
}
function overrideRevisionKey(kind){return kind==='suppFob'?'suppFob':'orders';}
function notifyOverrideSaveError(message){
  const now=Date.now();
  if(now-lastOverrideErrorToastAt>3500){lastOverrideErrorToastAt=now;showToast(message);}
}
function enqueueOverrideMutation(kind,url,opts={}){
  if(overrideBatchCapture){
    if(kind!=='orders'||opts.method!=='PATCH'||!url.startsWith('/api/overrides/'))throw new Error('Unsupported bulk override');
    const orderCode=url.slice('/api/overrides/'.length),patch=JSON.parse(opts.body),key=JSON.stringify([orderCode,patch.model||'',patch.ccode||'']);
    const item=overrideBatchCapture.entries.get(key)||{orderCode,patch:{}};
    for(const [field,value]of Object.entries(patch))item.patch[field]=['notes','dates','noteColumns','pricingRestore'].includes(field)?{...(item.patch[field]||{}),...value}:value;
    overrideBatchCapture.entries.set(key,item);
    return new Promise((resolve,reject)=>overrideBatchCapture.waiters.push({resolve,reject}));
  }
  const revisionKey=overrideRevisionKey(kind);
  const task=async()=>{
    try{
      const requestOpts={...opts,headers:{...(opts.headers||{})},expectedRevision:opts.expectedRevision??(Number(state.storeRevisions[revisionKey])||0)};
      // v6.44 — canlı senkron bu sekmenin kendi yazmasını ayırt edebilsin diye;
      // kendi yazdığın değişiklik için kendine yenileme tetiklemene gerek yok,
      // ekran zaten güncel.
      if(typeof window!=='undefined'&&window.BL_CLIENT_ID)requestOpts.headers['X-Client-Id']=window.BL_CLIENT_ID;
      if(kind==='orders'&&!Object.hasOwn(requestOpts.headers,'X-Supp-Fob-Revision'))requestOpts.headers['X-Supp-Fob-Revision']=String(Number(state.storeRevisions.suppFob)||0);
      const data=await fetchJSON(url,requestOpts);
      if(Number.isInteger(Number(data.revision)))state.storeRevisions[revisionKey]=Number(data.revision);
      if(data.revisions&&typeof data.revisions==='object')Object.entries(data.revisions).forEach(([key,value])=>{if(Number.isInteger(Number(value)))state.storeRevisions[key]=Number(value);});
      if(data.overrides&&Number.isInteger(Number(data.overrides._revision)))state.storeRevisions.overrides=Number(data.overrides._revision);
      try{if(kind==='orders'&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('buyerlog:cp-write-ack'));}catch(_){}
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
  window.captureOverrideBatch=captureOverrideBatch;
  window.isCapturingOverrideBatch=()=>Boolean(overrideBatchCapture);
}
