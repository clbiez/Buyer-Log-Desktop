(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLBulkOperations=api.browser(root);
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const KEY='buyerlog.workspace.bulkReceipts.v1',TERMINAL=new Set(['accepted','rejected','unknown']);
  const fail=code=>Object.assign(new Error(code),{code});
  const clone=value=>JSON.parse(JSON.stringify(value));
  function createController({storage,scope,nonce=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2)}){
    const flights=new WeakMap();
    function history(){
      let rows=[];try{rows=JSON.parse(storage.getItem(KEY)||'[]');}catch(_){}
      return (Array.isArray(rows)?rows:[]).filter(row=>row?.schema===1&&row.scope===scope()&&Array.isArray(row.outcomes)&&row.outcomes.length<=100000).slice(0,20).map(row=>row.status==='pending'?{...row,status:'unknown',outcomes:row.outcomes.map(item=>({...item,status:'unknown'}))}:row);
    }
    function persist(receipt){
      if(receipt.scope!==scope())throw fail('BULK_STALE');
      try{storage.setItem(KEY,JSON.stringify([receipt,...history().filter(row=>row.id!==receipt.id)].slice(0,20)));}
      catch(_){throw fail('BULK_RECEIPT_STORAGE');}
    }
    function execute(spec){
      if(flights.has(spec))return flights.get(spec);
      const run=(async()=>{
        if(spec.scope!=null&&spec.scope!==scope()||!spec.guard())throw fail('BULK_STALE');
        const keys=spec.items.map(item=>String(item.key)),labels=new Map(spec.items.map(item=>[String(item.key),String(item.label||item.key).slice(0,240)]));
        if(!keys.length||keys.length>100000||new Set(keys).size!==keys.length||keys.some(key=>!key||key.length>1000))throw fail('BULK_ITEMS');
        const receipt={schema:1,id:nonce(),scope:scope(),module:String(spec.module),owner:String(spec.owner),at:new Date().toISOString(),expected:clone(spec.expected||{}),status:'pending',outcomes:keys.map(key=>({key,label:labels.get(key),status:'unknown'}))};
        persist(receipt); // A restart after this point must never trigger a replay.
        let result;
        try{
          if(receipt.scope!==scope()||!spec.guard())throw Object.assign(fail('BULK_STALE'),{status:409});
          result=await spec.send();
          const rows=Array.isArray(result?.outcomes)?result.outcomes:[],byKey=new Map(),duplicates=new Set();
          rows.forEach(row=>{if(byKey.has(String(row.key)))duplicates.add(String(row.key));byKey.set(String(row.key),row);});
          receipt.outcomes=keys.map(key=>{const row=byKey.get(key);return {key,label:labels.get(key),status:!duplicates.has(key)&&TERMINAL.has(row?.status)?row.status:'unknown',...(row?.code?{code:String(row.code).slice(0,100)}:{})};});
          receipt.revision=clone(result?.revisions||result?.revision||null);
          receipt.related=clone(Array.isArray(result?.related)?result.related.slice(0,10):[]);
        }catch(error){
          const status=Number(error.status||error.statusCode),rejected=status>=400&&status<500;
          receipt.outcomes=keys.map(key=>({key,label:labels.get(key),status:rejected?'rejected':'unknown',code:String(error.code||'BULK_RESPONSE_UNKNOWN').slice(0,100)}));
        }
        const statuses=new Set(receipt.outcomes.map(item=>item.status));
        receipt.status=statuses.size===1?[...statuses][0]:statuses.has('unknown')?'unknown':'partial';
        receipt.finishedAt=new Date().toISOString();
        // A lost local receipt write after ACK cannot turn the server result into
        // a safe retry. Leave the pre-send pending receipt for restart recovery.
        try{persist(receipt);}catch(error){receipt.receiptError=error.code;}
        return receipt;
      })();
      flights.set(spec,run);return run;
    }
    return {execute,history,captureScope:()=>scope(),rejected:receipt=>receipt.outcomes.filter(item=>item.status==='rejected')};
  }
  function browser(root){
    const en=()=>typeof appLang!=='undefined'&&appLang==='en',T=(tr,english)=>en()?english:tr;
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const controller=createController({storage:root.BLStorage,scope:()=>String(root.BL_USER_CONTEXT?.id||'anonymous')});
    let active=null;
    const labels={accepted:()=>T('Sunucu kaydı onaylandı','Server save acknowledged'),rejected:()=>T('Uygulanmadı','Rejected'),partial:()=>T('Kısmen kaydedildi','Partially saved'),unknown:()=>T('Sonuç doğrulanamadı','Result unconfirmed')};
    function dialog(title,body,buttons){
      if(active)active(false);
      const overlay=document.createElement('div');overlay.className='warnOverlay blBulkOverlay';
      overlay.innerHTML=`<div class="modalCard blBulkCard" role="dialog" aria-modal="true" aria-labelledby="blBulkTitle"><div class="modalTitle" id="blBulkTitle">${esc(title)}</div><div class="blBulkBody">${body}</div><div class="modalFoot">${buttons}</div></div>`;
      document.body.appendChild(overlay);
      return new Promise(resolve=>{
        let closed=false;
        const close=value=>{if(closed)return;closed=true;root.BLLayerSystem?.closeDialog?.(overlay);overlay.remove();if(active===close)active=null;resolve(value);};active=close;
        overlay.querySelectorAll('[data-bulk-action]').forEach(button=>button.onclick=()=>{button.disabled=true;close(button.dataset.bulkAction);});
        overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(false);}});
        root.BLLayerSystem?.openDialog?.(overlay,{onClose:()=>close(false),initialFocus:overlay.querySelector('[data-bulk-action]')});
      });
    }
    function counts(receipt){return ['accepted','rejected','unknown'].map(status=>`${receipt.outcomes.filter(item=>item.status===status).length} ${status==='accepted'?T('onaylandı','acknowledged'):status==='rejected'?T('reddedildi','rejected'):T('belirsiz','unconfirmed')}`).join(' · ');}
    const moduleLabel=value=>value==='cp'?'CP Tracker':value==='collection'?T('Koleksiyon','Collection'):value==='supplier-prices'?T('Üretici fiyatları','Supplier prices'):value==='checklist'?'Checklist':value;
    function outcomeList(receipt){return receipt.outcomes.filter(item=>item.status!=='accepted').slice(0,100).map(item=>`<p><b>${esc(item.label||item.key)}</b> · ${esc(labels[item.status]?.()||item.status)}${item.code==='NEWER_ANSWER'?' · '+esc(T('Daha güncel yanıt korundu','Newer answer preserved')):''}</p>`).join('');}
    function relatedList(receipt){return (receipt.related||[]).map(item=>`<p>${esc(item.module==='quotations'?T('Fiyat talepleri','Quotation records'):T('Model görselleri','Model images'))}: ${esc(item.status==='accepted'?T('kayıt onaylandı','save acknowledged'):T('kontrol gerekiyor','review required'))}</p>`).join('');}
    async function result(receipt,spec){
      const rejected=controller.rejected(receipt),canRetry=Boolean(rejected.length&&spec?.retry);
      const action=await dialog(labels[receipt.status]?.()||receipt.status,`<p role="status">${esc(counts(receipt))}</p><p>${esc(T('İşlem kimliği','Operation ID'))}: ${esc(receipt.id)}</p>${receipt.status==='unknown'?`<p>${esc(T('Yanıt doğrulanamadı. Veriyi yenileyip kontrol edin; bu işlem otomatik tekrarlanmaz.','The response could not be confirmed. Refresh and review the data; this operation will not be replayed automatically.'))}</p>`:''}${outcomeList(receipt)}${relatedList(receipt)}${receipt.receiptError?`<p>${esc(T('Sonuç bu cihazda güncellenemedi; önceki bekleyen kayıt korundu.','The result could not be updated on this device; the earlier pending receipt was preserved.'))}</p>`:''}`,`${canRetry?`<button class="tbtn" data-bulk-action="retry">${esc(T('Yalnız reddedilenleri yeniden önizle','Preview only rejected items again'))}</button>`:''}<button class="tbtn primary" data-bulk-action="close">${esc(T('Kapat','Close'))}</button>`);
      if(action==='retry'){const next=await spec.retry(rejected.map(item=>item.key));if(next)return run(next);}
      return receipt;
    }
    async function run(spec){
      spec.scope=controller.captureScope();
      const rows=spec.items.slice(0,100),metrics=spec.counts||{};
      const accepted=await dialog(spec.title||T('Toplu işlem önizlemesi','Bulk change preview'),`<p>${esc(T(`${spec.items.length} değişiklik · ${Number(metrics.readonly)||0} salt okunur · ${Number(metrics.invalid)||0} geçersiz · ${Number(metrics.skipped)||0} atlanan`,`${spec.items.length} changes · ${Number(metrics.readonly)||0} read-only · ${Number(metrics.invalid)||0} invalid · ${Number(metrics.skipped)||0} skipped`))}</p>${spec.hint?`<p>${esc(spec.hint)}</p>`:''}<div class="blBulkTableWrap"><table><thead><tr><th>${esc(T('Kayıt / alan','Record / field'))}</th><th>${esc(T('Önce','Before'))}</th><th>${esc(T('Sonra','After'))}</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.label||row.key)}</td><td>${esc(row.before)}</td><td>${esc(row.after)}</td></tr>`).join('')}</tbody></table></div>${spec.items.length>100?`<p>${esc(T('İlk 100 değişiklik gösteriliyor; tüm değişiklikler birlikte gönderilir.','Showing the first 100 changes; all changes are submitted together.'))}</p>`:''}`,`<button class="tbtn" data-bulk-action="cancel">${esc(T('Vazgeç','Cancel'))}</button><button class="tbtn primary" data-bulk-action="apply">${esc(T('Uygula ve kaydet','Apply and save'))}</button>`);
      if(accepted!=='apply')return null;
      try{void dialog(T('Toplu işlem kaydediliyor','Saving bulk changes'),`<p role="status" aria-busy="true">${esc(T('Sunucu kayıt yanıtı bekleniyor. İşlem kayıtları bu cihazda korunur.','Waiting for the server save response. Operation receipts are kept on this device.'))}</p>`,'');const receipt=await controller.execute(spec);void result(receipt,spec);return receipt;}
      catch(error){if(active)active(false);root.showToast?.(error.code==='BULK_RECEIPT_STORAGE'?T('İşlem kaydı bu cihaza yazılamadı; hiçbir değişiklik gönderilmedi.','The receipt could not be stored on this device; no changes were sent.'):T('Önizleme sırasında kayıt, yetki veya oturum değişti. Güncel veriden yeniden önizleyin.','The record, permission or session changed during preview. Preview again from current data.'));return null;}
    }
    async function history(){const rows=controller.history();await dialog(T('Toplu işlem kayıtları','Bulk operation receipts'),rows.length?rows.map(receipt=>`<section><b>${esc(moduleLabel(receipt.module))} · ${esc(labels[receipt.status]?.()||receipt.status)}</b><p>${esc(receipt.at)} · ${esc(receipt.owner)}</p><p>${esc(counts(receipt))}</p><small>${esc(receipt.id)}</small>${outcomeList(receipt)}${relatedList(receipt)}</section>`).join(''):`<p>${esc(T('Bu kullanıcı için bu cihazda işlem kaydı yok.','No operation receipts for this user on this device.'))}</p>`,`<button class="tbtn" data-bulk-action="close">${esc(T('Kapat','Close'))}</button>`);}
    document.addEventListener('click',event=>{if(event.target.closest('[data-bulk-receipts]'))void history();});
    return {run,history,controller};
  }
  return {createController,browser};
});
