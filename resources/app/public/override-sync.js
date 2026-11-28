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
/* P1 (2026-11-28) · Revizyon belirteci = "bu istemci depoyu bu sürüme kadar gördü". Eski kayıt yollarının (PATCH,
   /batch, /batch-suppfob) tek koruması bu belirteçle yapılan global CAS'tır. Onay belirteci ancak sunucu bu istekte o
   anahtarı doğruladıysa (verified: CAS) ya da yeni değer yalnız bu yazmanın kendi artışıysa (ownBump) ilerletir. Aksi
   hâlde araya görülmemiş bir yazma girmiştir; belirteç bayat kalır ve sıradaki eski yol yazması mevcut çakışma yoluna
   (409 → uyarı + yeniden yükleme) düşer. Eskiden her onay belirteci sunucu değerine taşıyor, satır kaydı ya da başka
   satırın onayı görülmemiş değişikliği "görülmüş" sayıyordu: bayat gövde sessizce kazanıyordu. */
function adoptAckRevision(key,value,{verified=false,ownBump=0}={}){
  const next=Number(value);if(!Number.isInteger(next))return;
  const current=Number(state.storeRevisions[key])||0;
  if(verified?next>=current:next===current+ownBump)state.storeRevisions[key]=next;
}
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
      // İsteğin CAS ile doğrulattığı anahtarlar: kendi revizyon anahtarı ve (orders yazması Supp. FOB taşıyorsa) suppFob.
      const touchesSuppFob=kind==='orders'&&typeof opts.body==='string'&&/"suppFob":/.test(opts.body);
      const verifiedKey=key=>key===revisionKey||(key==='suppFob'&&touchesSuppFob);
      if(data.revision!=null)adoptAckRevision(revisionKey,data.revision,{verified:true});
      if(data.revisions&&typeof data.revisions==='object')Object.entries(data.revisions).forEach(([key,value])=>adoptAckRevision(key,value,{verified:verifiedKey(key)}));
      if(data.overrides&&Number.isInteger(Number(data.overrides._revision)))state.storeRevisions.overrides=Number(data.overrides._revision);
      // CP satır kaydı base'i (`_cpStored`): yamanın yazdığı alanların kayıtlı değeri yanıttaki belgeden alınır.
      try{if(kind==='orders'&&typeof window!=='undefined')window.BLCpRowSave?.legacyAcked?.(url,opts.body,data);}catch(_){}
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
  window.adoptAckRevision=adoptAckRevision;
  window.isCapturingOverrideBatch=()=>Boolean(overrideBatchCapture);
}
