/* Adapter for the uploaded Atlas. It has no API or same-origin access. */
(() => {
 'use strict';
 const wire='buyer-log-license-atlas-v1';
 let connected=false,canEdit=false,busy=false,dirty=false,rendering=false,commerce={},baseline='',parentOrigin='';
 const send=(action,payload={})=>{if(connected)parent.postMessage({wire,action,...payload},parentOrigin);};
 const txt=(tr,en)=>locale==='en'?en:tr;
 safeUrl=function(uri){try{const u=new URL(uri);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const original={home,render,cards,doAction,renderEditor,selectLicense,notify,mapDeliveryEditor,renderProcessStudio};
 function status(message='',error=false){
  const bar=document.getElementById('blAtlasSave');bar.hidden=!dirty&&!message;
  bar.querySelector('p').textContent=message||txt('Atlas değişiklikleri henüz kaydedilmedi.','Atlas changes have not been saved yet.');
  bar.querySelector('p').setAttribute('role',error?'alert':'status');
  document.querySelectorAll('#app [data-map-field],#app [data-map-sub-field]').forEach(el=>el.disabled=busy||!canEdit);
  const buttons=bar.querySelectorAll('button');buttons.forEach(b=>b.disabled=busy);buttons[0].textContent=txt('Vazgeç','Discard');buttons[1].textContent=busy?txt('Kaydediliyor…','Saving…'):txt('Atlası kaydet','Save atlas');
 }
 const savebar=document.createElement('div');savebar.id='blAtlasSave';savebar.className='bl-savebar';savebar.hidden=true;
 savebar.innerHTML='<p></p><div class="bl-save-actions"><button class="btn" data-action="blDiscard"></button><button class="btn primary" data-action="blSave"></button></div>';
 document.querySelector('.topbar').after(savebar);
 persist=function(){if(!canEdit||busy)return false;dirty=JSON.stringify(db)!==baseline;send('dirty',{dirty});status();return true;};
 // Toasts in the reference describe local staging. Only Buyer Log confirms durable saving.
 notify=function(message,error=false){
  const replacements={'Lisans manueli kaydedildi.':txt('Değişiklikler hazır. Atlası kaydedin.','Changes are ready. Save the atlas.'),'İşlem tamamlandı.':txt('Değişiklikler hazır.','Changes are ready.')};
  original.notify(replacements[message]||message,error);
 };
 mapDeliveryEditor=function(l,s,sub,index){
  const box=document.createElement('div');box.innerHTML=original.mapDeliveryEditor(l,s,sub,index);
  box.querySelector('.map-route-extras')?.insertAdjacentHTML('beforeend',`<label class="bl-route-instructions">${e(txt('Üretici gönderim talimatı','Supplier submission instructions'))}<textarea data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="supplierInstructions" rows="2">${e(lx(sub,'supplierInstructions'))}</textarea></label><label class="bl-route-instructions">${e(txt('İç gönderim notu','Internal submission note'))}<textarea data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="note" rows="2">${e(lx(sub,'note'))}</textarea><span><input type="checkbox" data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="supplierShowNotes" ${sub.supplierShowNotes===true?'checked':''}> ${e(txt('Bu notu üreticiyle paylaş','Share this note with the supplier'))}</span></label>`);
  return box.innerHTML;
 };
 function ratesHTML(id){
  const c=commerce[id];if(!c)return '';
  return c.contracts.map(r=>`<div class="bl-contract"><small>${e(r.scope)} · ${e(r.range)}</small><div class="bl-rates">${r.rates.map(x=>`<div><span>${e(x.label)}</span><b>${e(x.value)}</b></div>`).join('')}</div></div>`).join('')||`<p class="muted">${e(txt('Bugün geçerli sözleşme yok.','No contract is valid today.'))}</p>`;
 }
 cards=function(licenses){const box=document.createElement('div');box.innerHTML=original.cards(licenses);box.querySelectorAll('[data-id]').forEach(el=>{const meta=el.querySelector('.card-meta');if(meta)meta.querySelector('.card-bottom').insertAdjacentHTML('beforebegin',ratesHTML(el.dataset.id));});return box.innerHTML;};
 function decorate(){
  document.querySelector('.footer').textContent=txt('Buyer Log · Atlas ve ticari bilgiler yetkili kullanıcılarla paylaşılır.','Buyer Log · Atlas and commercial details are shared with authorized users.');
  const note=document.querySelector('.note-band');if(!activeId&&note)note.textContent=txt('Atlası Buyer Log içinde düzenleyin. Değişiklikleri kaydedin; üreticiniz için aynı görsel arayüzle ayrı bir rehber oluşturun.','Edit the atlas inside Buyer Log. Save your changes and create a separate guide with the same visual interface for your supplier.');
  const refresh=document.querySelector('.nav-actions [data-action="new"]');if(refresh){refresh.innerHTML=ico('refresh',15)+' <span class="hide-mobile">'+e(txt('ASAS’tan yenile','Refresh from ASAS'))+'</span>';refresh.title=txt('Buyer Log lisans kayıtlarını yenile','Refresh Buyer Log license records');}
  document.querySelectorAll('[data-action="import"]').forEach(el=>el.hidden=true);
  document.querySelectorAll('.nav-actions [data-action="studio"],.nav-actions [data-action="new"]').forEach(el=>el.hidden=!canEdit);
  if(!canEdit){document.querySelectorAll('[data-action="studio"],[data-action="new"],[data-action="uploadLicenseCover"],[data-action="removeLicenseCover"],[data-action^="mapAdd"],[data-action^="mapRemove"],[data-action^="mapAsk"],[data-action^="mapMove"],[data-action^="mapPaste"],[data-action^="mapUpload"],[data-action^="mapClear"],[data-action^="mapChoose"],[data-action="mapSetApproval"]').forEach(el=>el.hidden=true);document.querySelectorAll('#app input,#app textarea,#app select').forEach(el=>{if(!['licenseSearch','categoryFilter'].includes(el.id))el.disabled=true;});}
  const subtitle=document.querySelector('.section-head p');if(!activeId&&subtitle)subtitle.textContent=txt(`${all().length} lisans · Süreçler ve ticari bilgiler tek yerde`,`${all().length} licenses · Processes and commercial details in one place`);
  status();
 }
 home=function(){const previous=rendering;rendering=true;try{original.home();decorate();}finally{rendering=previous;}};
 render=function(){const previous=rendering;rendering=true;try{original.render();if(activeId){
  const head=document.querySelector('.detail-head');
  if(head){head.insertAdjacentHTML('afterend',`<section class="bl-commerce"><div class="bl-commerce-title"><small>BUYER LOG / ${e(txt('TİCARİ BİLGİLER','COMMERCIAL DETAILS'))}</small><h3>${e(txt('Sözleşmeler ve oranlar','Contracts and rates'))}</h3><p>${e(txt('OPD ve sezona göre uygulanır.','Applied by OPD and season.'))}</p></div>${ratesHTML(activeId)}<button class="btn" data-action="blCommerce">${e(txt('Detaylar ve sözleşme geçmişi','Details and contract history'))}</button></section>`);
   head.querySelector('.head-tools').insertAdjacentHTML('afterbegin',`${canEdit?`<button class="btn" data-action="edit">${ico('edit',15)} ${e(txt('Lisans bilgileri','License details'))}</button>`:''}<button class="btn" data-action="blExportOne">${ico('download',15)} ${e(txt('Üretici atlası','Supplier atlas'))}</button>`);
  }
 }decorate();}finally{rendering=previous;}};
 selectLicense=function(id){original.selectLicense(id);send('select',{id});};
 renderEditor=function(){original.renderEditor();for(const [i,st] of (editor?.stages||[]).entries())for(const [j,sub] of (st.submissions||[]).entries()){const path=`stages|${i}|submissions|${j}|note`,target=overlay.querySelector(`[data-path="${path}"]`);if(target)target.closest('.field')?.insertAdjacentHTML('afterend',field(txt('Üretici gönderim talimatı','Supplier submission instructions'),`stages|${i}|submissions|${j}|supplierInstructions`,'textarea')+shareSwitch(`stages|${i}|submissions|${j}|supplierShowNotes`,txt('Gönderim notunu üreticiyle paylaş','Share submission note with supplier')));}const apply=overlay.querySelector('[data-action="saveEditor"]');if(apply)apply.textContent=txt('Değişiklikleri uygula','Apply changes');const description=overlay.querySelector('.drawer-head p');if(description)description.textContent=txt('Alanları uygulayın; ardından Atlası kaydet ile Buyer Log’a kaydedin.','Apply your edits, then use Save atlas to save them to Buyer Log.');const name=overlay.querySelector('[data-path="name"]');if(name)name.readOnly=true;overlay.querySelectorAll('[data-action="deleteLicense"],[data-action="duplicate"]').forEach(el=>el.hidden=true);};
 showHelp=function(){overlay.innerHTML=`<div class="modal"><div class="modal-box" role="dialog" aria-modal="true" aria-label="${e(txt('Atlas kullanım rehberi','Atlas guide'))}"><h2>${e(txt('Buyer Log · Lisans Atlası','Buyer Log · License Atlas'))}</h2><ol><li>${e(txt('Lisans seçin; aşamaları aynı süreç ağacı üzerinde açıp düzenleyin. Lisans bilgileri bölümünden adres, portal ve üretici görünürlüğünü yönetin.','Choose a license; expand and edit stages in the workflow tree. Manage addresses, portal and supplier visibility in License details.'))}</li><li>${e(txt('Değişikliklerden sonra Atlası kaydet düğmesine basın. Kayıt doğrulandığında tüm yetkili kullanıcılarla paylaşılır.','After editing, press Save atlas. Confirmed changes are shared with all authorized users.'))}</li><li>${e(txt('Royalty, komisyon, hologram ve sözleşme geçmişine Detaylar ve sözleşme geçmişi düğmesinden ulaşın.','Open Details and contract history for royalty, commission, hologram and past contracts.'))}</li><li>${e(txt('Toplu ağaç kopyalamada kaynak ve hedefleri seçip uygulayın. Pencereyi kapatarak Atlası kaydet ile tüm değişiklikleri birlikte kaydedin.','Select a source and targets in Copy complete tree. Apply, close the window, then use Save atlas to save all changes together.'))}</li><li>${e(txt('Üretici atlası yalnız paylaşımı açılmış süreç ve talimatlardan oluşur. Dosya aynı Atlas arayüzünde salt okunur açılır.','The supplier atlas includes only shared processes and instructions. Its file opens in the same Atlas interface in read-only mode.'))}</li></ol><div class="modal-actions"><button class="btn primary" data-action="closeEditor">${e(txt('Anladım','Got it'))}</button></div></div></div>`;};
 renderProcessStudio=function(){original.renderProcessStudio();if((db.presetTemplateIds||[]).some(id=>processStudio?.source==='tpl:'+id))overlay.querySelectorAll('[data-action="studioDeleteTemplate"]').forEach(el=>el.hidden=true);};
 const readActions=new Set(['home','choose','stage','mapCloseStage','viewGuide','closeTreeGuide','next','previous','lang','theme','copyAddress','help','export','print','closeEditor','studioClose','mapCopyStage']);
 doAction=function(action,el){
  if(action==='blSave'){if(!dirty||busy)return;if(editor||processStudio)return notify(txt('Önce açık düzenlemeyi tamamlayın.','Complete the open editor first.'),true);busy=true;status();send('save',{db});return;}
  if(action==='blDiscard'){if(busy)return;if(!confirm(txt('Kaydedilmemiş atlas değişiklikleri bırakılsın mı?','Discard unsaved atlas changes?')))return;db=JSON.parse(baseline);dirty=false;send('discarded');overlay.innerHTML='';editor=null;processStudio=null;chosen()?render():home();return;}
  if(action==='blCommerce'){if(dirty)return notify(txt('Ticari bilgileri açmadan önce atlası kaydedin veya değişiklikleri bırakın.','Save or discard atlas changes before opening commercial details.'),true);send('commerce',{id:activeId});return;}
  if(action==='supplierAll'||action==='blExportOne'){if(dirty||busy)return notify(txt('Dışa aktarmadan önce atlası kaydedin.','Save the atlas before exporting.'),true);send('export',{id:action==='blExportOne'?activeId:''});return;}
  if(action==='new'){if(!dirty&&!busy)send('refresh');return;}
  if(['reset','deleteLicense','duplicate','import'].includes(action))return;
  if((busy||!canEdit)&&!readActions.has(action))return;
  original.doAction(action,el);decorate();
  if(action==='lang'){send('locale',{locale});}
 };
 // Read-only users may expand the exact same tree but cannot mutate fields or drag steps.
 document.addEventListener('change',event=>{const el=event.target;if(canEdit&&!busy&&!rendering&&locale==='en'&&['supplierInstructions','note'].includes(el.dataset.mapSubField)){event.stopImmediatePropagation();mapSetStage(el.dataset.mapStage,st=>{const sub=st.submissions.find(r=>r.id===el.dataset.mapSub);if(sub){sub.i18n??={};sub.i18n.en??={};sub.i18n.en[el.dataset.mapSubField]=el.value;}},false);}},true);
 for(const type of ['input' ,'change','drop','dragstart'])document.addEventListener(type,event=>{if((rendering||!canEdit||busy)&&!['licenseSearch','categoryFilter'].includes(event.target.id)){event.preventDefault();event.stopImmediatePropagation();}},true);
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.wire!==wire)return;
  if(connected&&event.origin!==parentOrigin)return;
  const message=event.data;
  if(message.action==='init'){
   connected=true;parentOrigin=event.origin;canEdit=message.canEdit===true;commerce=message.commerce||{};locale=message.locale==='en'?'en':'tr';
   if(!dirty){db=deep(message.db);baseline=JSON.stringify(db);busy=false;activeStage='';if(activeId&&!chosen())activeId='';chosen()?render():home();}
   else{decorate();}
   updateLanguageControls();if(message.error)status(message.error,true);
  }
  if(message.action==='saved'){busy=false;dirty=false;db=deep(message.db);baseline=JSON.stringify(db);commerce=message.commerce||commerce;send('dirty',{dirty:false});chosen()?render():home();notify(txt('Atlas Buyer Log’a kaydedildi.','Atlas saved to Buyer Log.'));}
  if(message.action==='failed'){busy=false;status(message.error,true);}
  if(message.action==='supplier'){
   const tpl=new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('supplierTemplate').textContent.trim()),ch=>ch.charCodeAt(0)));
   const payload=JSON.stringify(message.payload).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
   const html=tpl.replace('__PUBLIC_DATA__',payload),blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Buyer-Log-License-Atlas.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
 });
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 // Start without business data. Only the parent can populate the sandbox.
 db={version:2,licenses:[]};home();parent.postMessage({wire,action:'ready'},'*');
})();
