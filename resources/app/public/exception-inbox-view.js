(function(){
 'use strict';
 const API=window.BLExceptionInbox,bridge=window.BLExceptionInboxBridge;if(!API||!bridge)return;
 const gate=API.createGate();let request=null,timer=0,dirty=true,loading=false,error='',selected='',shown=20,lastScope='';
 const root=()=>document.getElementById('ovExceptionInbox'),user=()=>String(window.BL_USER_CONTEXT?.id||''),scope=()=>bridge.scope(),en=()=>typeof appLang!=='undefined'&&appLang==='en',T=(tr,enText)=>en()?enText:tr;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const title=type=>type==='EX_FACTORY_OVERDUE'?T('Ex-Factory geçmiş','Ex-Factory overdue'):T('ASAS tarih farkı','ASAS date difference');
 function visible(){const el=root();return Boolean(el&&document.body.dataset.activeTab==='overview'&&!el.classList.contains('ovHomeOff'));}
 function cancel(){clearTimeout(timer);timer=0;request?.abort();request=null;gate.invalidate();loading=false;}
 function render(){
  const host=root();if(!host)return;const permitted=bridge.allowed(),data=permitted?gate.snapshot(user(),scope()):null;
  host.innerHTML=`<header class="ovInboxHead"><b>${T('İstisna kutusu','Exception inbox')}</b><button type="button" class="tbtn" data-inbox-refresh${loading||!permitted?' disabled':''}>${loading?T('Okunuyor…','Reading…'):T('Yenile','Refresh')}</button></header><p class="ovInboxScope">${T('Yetkili CP kapsamı ve Genel Bakış filtreleri · Sunucuda kayıtlı veriler','Authorized CP scope and Overview filters · Server-confirmed data')}</p>`;
  if(!permitted){host.insertAdjacentHTML('beforeend',`<p class="ovInboxStatus" role="status">${T('CP erişimi ve yüklenmiş kaynak kapsamı gerekli.','CP access and a loaded source scope are required.')}</p>`);return;}
  if(error)host.insertAdjacentHTML('beforeend',`<p class="ovInboxStatus" role="status">${esc(error)}</p>`);
  if(!data){host.insertAdjacentHTML('beforeend',`<p class="ovInboxStatus" role="status">${loading?T('Kayıtlı veriler kontrol ediliyor…','Checking confirmed data…'):T('Listeyi okumak için Yenile’yi kullanın.','Use Refresh to read the list.')}</p>`);return;}
  host.insertAdjacentHTML('beforeend',`<div class="ovInboxTabs" role="group" aria-label="${T('İstisna türü','Exception type')}">${['',...API.TYPES].map(type=>`<button type="button" class="tbtn" data-inbox-type="${type}" aria-pressed="${selected===type}">${type?title(type):T('Tümü','All')} <b>${type?data.counts[type]:data.total}</b></button>`).join('')}</div>`);
  const items=data.items.filter(item=>!selected||item.type===selected),total=selected?data.counts[selected]:data.total,visibleItems=items.slice(0,shown);
  host.insertAdjacentHTML('beforeend',`<div class="ovInboxList">${visibleItems.length?visibleItems.map(item=>`<button type="button" class="ovInboxRow" data-inbox-id="${esc(item.id)}"><span><b>${esc(item.orderCode)}</b> ${esc(item.modelName)} <small>${esc(item.colourCode)}</small></span><span>${title(item.type)} <span aria-hidden="true">›</span></span></button>`).join(''):`<p class="ovInboxStatus">${T('Seçilen sinyal bu kapsamda bulunmadı.','The selected signal was not found in this scope.')}</p>`}</div><footer class="ovInboxFoot"><span>${visibleItems.length} / ${total} · ${T('Okuma','Read')} ${esc(new Date(data.readAt).toLocaleTimeString(en()?'en-GB':'tr-TR',{hour:'2-digit',minute:'2-digit'}))}</span>${items.length>shown?`<button type="button" class="tbtn" data-inbox-more>${T('Daha fazla','Show more')}</button>`:items.length<total?`<span>${T('Her türden ilk 200 kayıt gösterilebilir.','Up to 200 records per type can be shown.')}</span>`:''}</footer>`);
 }
 async function refresh(){
  if(!visible()||!bridge.allowed()){cancel();gate.clear();render();return;}
  cancel();const owner=user(),signature=scope(),token=gate.begin(owner,signature),controller=new AbortController();request=controller;loading=true;error='';render();
  try{
   const rows=await bridge.read(controller.signal),data=await API.project(rows,{fields:window.BLCanonicalFields,analyze:bridge.analyze,filter:bridge.filter,allowed:()=>!controller.signal.aborted&&bridge.allowed()&&user()===owner&&scope()===signature});
   data.readAt=new Date().toISOString();
   if(gate.accept(token,data,user(),scope())){dirty=false;shown=20;}
  }catch(err){if(!controller.signal.aborted){dirty=true;if(err.status===401||err.status===403)gate.clear();error=T('Liste güncellenemedi. Yenile’yi kullanın; varsa son onaylı okuma gösteriliyor.','The list could not be updated. Use Refresh; the last confirmed read is shown when available.');}}
  finally{if(request===controller){request=null;loading=false;render();}}
 }
 function sync({invalidate=false}={}){
  const signature=user()+'|'+scope();if(signature!==lastScope){lastScope=signature;cancel();gate.clear();dirty=true;}
  if(invalidate){dirty=true;cancel();}
  if(!bridge.allowed()){cancel();gate.clear();render();return;}
  if(!visible()){cancel();return;}
  render();if(dirty&&!request&&!timer)timer=setTimeout(()=>{timer=0;void refresh();},180);
 }
 root()?.addEventListener('click',async event=>{
  if(event.target.closest('[data-inbox-refresh]')){await refresh();if(visible()&&(document.activeElement===document.body||root().contains(document.activeElement)))root().querySelector('[data-inbox-refresh]')?.focus({preventScroll:true});return;}
  const tab=event.target.closest('[data-inbox-type]');if(tab){selected=tab.dataset.inboxType;shown=20;render();root().querySelector(`[data-inbox-type="${selected}"]`)?.focus({preventScroll:true});return;}
  if(event.target.closest('[data-inbox-more]')){const previous=shown;shown+=20;render();(root().querySelector('[data-inbox-more]')||root().querySelectorAll('.ovInboxRow')[previous])?.focus({preventScroll:true});return;}
  const button=event.target.closest('[data-inbox-id]'),item=button&&gate.snapshot(user(),scope())?.items.find(item=>item.id===button.dataset.inboxId);if(!item||!bridge.allowed())return;
  button.disabled=true;try{await bridge.open(item);}catch(_){showToast(T('Kayıt açılamadı. Listeyi yenileyin.','The record could not be opened. Refresh the list.'));}finally{if(button.isConnected)button.disabled=false;}
 });
 for(const name of ['bl:user-access-applied','buyerlog:cp-write-ack','bl:global-flow-data-changed'])window.addEventListener(name,event=>{if(name==='bl:global-flow-data-changed'&&event.detail?.reason==='priority-ready')return;sync({invalidate:true});});
 document.addEventListener('bl:overview-layout-changed',()=>sync());
 window.BLExceptionInboxView={sync,refresh,render};sync();
})();
