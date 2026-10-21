/* Adapter for the uploaded Atlas. It has no API or same-origin access. */
(() => {
 'use strict';
 const wire='buyer-log-license-atlas-v1';
 let connected=false,canEdit=false,busy=false,dirty=false,rendering=false,commerce={},baseline='',parentOrigin='',businessHTML='',detailsDirty=false,detailsSaving=false,recoveryItems=null;
 let licensorFilter='',supplierSelection=new Set();const NO_LICENSOR='__none__';
 const preferred=new Map(),licenseKey=v=>String(v||'').trim().toUpperCase().replace(/[İŞÇÖÜĞ]/g,c=>({'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'}[c])).replace(/\s+/g,' ');
 const variants=id=>{const l=all().find(x=>x.id===id);return l?all().filter(x=>licenseKey(x.name)===licenseKey(l.name)):[];};
 const send=(action,payload={})=>{if(connected)parent.postMessage({wire,action,...payload},parentOrigin);};
 const txt=(tr,en)=>locale==='en'?en:tr;
 safeUrl=function(uri){try{const u=new URL(uri);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const original={home,render,cards,doAction,renderEditor,selectLicense,notify,mapDeliveryEditor,renderProcessStudio,editorBody,normalizeShare};
 function defaultSharing(l){
  for(const k of ['manufacturerVisible','supplierShowRequirements'])if(typeof l[k]!=='boolean')l[k]=true;
  l.portal??={url:'',notes:''};if(typeof l.portal.manufacturerVisible!=='boolean')l.portal.manufacturerVisible=false;
  for(const a of l.addresses||[])if(typeof a.manufacturerVisible!=='boolean')a.manufacturerVisible=true;
  for(const st of l.stages||[]){for(const k of ['manufacturerVisible','supplierShowApprovalNotes','supplierShowSourceNote'])if(typeof st[k]!=='boolean')st[k]=k==='supplierShowSourceNote'&&typeof st.supplierShowNotes==='boolean'?st.supplierShowNotes:true;
   for(const r of st.submissions||[])for(const k of ['manufacturerVisible','supplierShowNotes'])if(typeof r[k]!=='boolean')r[k]=true;}
 }
 normalizeShare=function(l){defaultSharing(l);original.normalizeShare(l);};
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
 persist=function(){if(!canEdit||busy)return false;for(const l of all())defaultSharing(l);dirty=detailsDirty||JSON.stringify(db)!==baseline;send('dirty',{dirty});status();return true;};
 // Toasts in the reference describe local staging. Only Buyer Log confirms durable saving.
 notify=function(message,error=false){
  const replacements={'Lisans manueli kaydedildi.':txt('Değişiklikler hazır. Atlası kaydedin.','Changes are ready. Save the atlas.'),'Lisans görseli kaydedildi.':txt('Görsel eklendi. Atlası kaydedin.','Image added. Save the atlas.'),'License image saved.':txt('Görsel eklendi. Atlası kaydedin.','Image added. Save the atlas.'),'İşlem tamamlandı.':txt('Değişiklikler hazır.','Changes are ready.')};
  original.notify(replacements[message]||message,error);
 };
 mapDeliveryEditor=function(l,s,sub,index){
  const box=document.createElement('div');box.innerHTML=original.mapDeliveryEditor(l,s,sub,index);
  box.querySelector('.map-route-extras')?.insertAdjacentHTML('beforeend',`<label class="bl-route-instructions">${e(txt('Üretici gönderim talimatı','Supplier submission instructions'))}<textarea data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="supplierInstructions" rows="2">${e(lx(sub,'supplierInstructions'))}</textarea></label><label class="bl-route-instructions">${e(txt('İç gönderim notu','Internal submission note'))}<textarea data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="note" rows="2">${e(lx(sub,'note'))}</textarea><span><input type="checkbox" data-map-stage="${e(s.id)}" data-map-sub="${e(sub.id)}" data-map-sub-field="supplierShowNotes" ${sub.supplierShowNotes===true?'checked':''}> ${e(txt('Bu notu üreticiyle paylaş','Share this note with the supplier'))}</span></label>`);
  return box.innerHTML;
 };
 function ratesHTML(id,compact=false){
  const c=commerce[id];if(!c)return '';
  return c.contracts.map(r=>`<div class="bl-contract"><small>${e(r.scope)} · ${e(r.range)}</small><div class="bl-rates">${r.rates.map(x=>`<div><span title="${e(x.label)}">${e(compact&&x.short||x.label)}</span><b>${e(x.value)}</b></div>`).join('')}</div></div>`).join('')||`<p class="muted">${e(txt('Bugün geçerli sözleşme yok.','No contract is valid today.'))}</p>`;
 }
 function grouped(licenses){
  const groups=new Map();for(const l of licenses){const k=licenseKey(l.name);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(l);}
  return [...groups.entries()].map(([k,ls])=>ls.find(l=>l.id===preferred.get(k))||ls.slice().sort((a,b)=>String(commerce[b.id]?.start||'').localeCompare(String(commerce[a.id]?.start||'')))[0]);
 }
 const licensorOf=l=>licenseKey(l.agency)||NO_LICENSOR;
 const matchesLicensor=l=>!licensorFilter||licensorOf(l)===licensorFilter;
 function licensorOptions(){const map=new Map();for(const l of all()){const k=licensorOf(l);if(!map.has(k))map.set(k,k===NO_LICENSOR?txt('Lisansörü belirtilmemiş','Licensor not specified'):String(l.agency).trim());}
  return [...map.entries()].sort((a,b)=>(a[0]===NO_LICENSOR)-(b[0]===NO_LICENSOR)||a[1].localeCompare(b[1],locale==='en'?'en':'tr'));}
 cards=function(licenses){const box=document.createElement('div');box.innerHTML=original.cards(grouped(licenses.filter(matchesLicensor)));box.querySelectorAll('[data-id]').forEach(el=>{const meta=el.querySelector('.card-meta');if(!meta)return;const options=variants(el.dataset.id);meta.querySelector('.card-agency').textContent=options.map(l=>l.agency||txt('Lisansör belirtilmedi','Licensor not specified')).join(' · ');meta.querySelector('.card-bottom').insertAdjacentHTML('beforebegin',ratesHTML(el.dataset.id,true));});return box.innerHTML;};
 function licensorSelect(id,inside=false){const ls=variants(id);return `<label class="bl-licensor"><span>${e(txt('Lisansör / sözleşme tarafı','Licensor / contracting party'))}</span><select data-bl-licensor="${inside?'editor':'view'}" aria-label="${e(txt('Lisansör seç','Select licensor'))}">${ls.map(l=>`<option value="${e(l.id)}" ${l.id===id?'selected':''}>${e(l.agency||txt('Lisansör belirtilmedi','Licensor not specified'))} · ${commerce[l.id]?.count||0} ${e(txt('kapsam','scopes'))}</option>`).join('')}</select></label>`;}
 // Supplier export: the user chooses which licenses go into the file.
 let pickerQuery='',pickerLicensor='';
 function pickerLicenses(){const q=pickerQuery.toLocaleLowerCase(locale==='en'?'en':'tr');return all().filter(l=>(!pickerLicensor||licensorOf(l)===pickerLicensor)&&`${l.name} ${l.agency||''}`.toLocaleLowerCase(locale==='en'?'en':'tr').includes(q)).sort((a,b)=>String(a.name).localeCompare(String(b.name),locale==='en'?'en':'tr')||String(a.agency||'').localeCompare(String(b.agency||'')));}
 function supplierPicker(keepFocus=false){
  const focus=keepFocus&&document.activeElement?.id,list=pickerLicenses(),options=licensorOptions();
  overlay.innerHTML=`<div class="modal"><section class="modal-box bl-picker" role="dialog" aria-modal="true" aria-label="${e(txt('Üretici atlası için lisans seç','Choose licenses for the supplier atlas'))}"><div class="overline">${e(txt('ÜRETİCİ ATLASI','SUPPLIER ATLAS'))}</div><h2>${e(txt('Aktarılacak lisansları seçin','Choose licenses to export'))}</h2><p>${e(txt('Yalnız seçtiğiniz ve üreticiye açık lisanslar dosyaya girer.','Only the licenses you select that are shared with suppliers are included.'))}</p>
   <div class="bl-picker-tools"><input id="blPickSearch" type="search" value="${e(pickerQuery)}" placeholder="${e(txt('Lisans veya lisansör ara…','Search license or licensor…'))}" aria-label="${e(txt('Lisans ara','Search licenses'))}"><select id="blPickLicensor" aria-label="${e(txt('Lisansör filtresi','Licensor filter'))}"><option value="">${e(txt('Tüm lisansörler','All licensors'))}</option>${options.map(([k,label])=>`<option value="${e(k)}" ${k===pickerLicensor?'selected':''}>${e(label)}</option>`).join('')}</select><button class="btn" data-action="blPickAll">${e(txt('Listelenenleri seç','Select listed'))}</button><button class="btn" data-action="blPickNone">${e(txt('Seçimi kaldır','Clear listed'))}</button></div>
   <ul class="bl-picker-list">${list.map(l=>{const closed=l.manufacturerVisible===false;return `<li><label class="${closed?'is-closed':''}"><input type="checkbox" data-bl-pick="${e(l.id)}" ${supplierSelection.has(l.id)?'checked':''} ${closed?'disabled':''}><b>${e(l.name)}</b><span>${e(l.agency||txt('Lisansör belirtilmedi','Licensor not specified'))}</span>${closed?`<small>${e(txt('Üreticiye kapalı','Not shared with suppliers'))}</small>`:''}</label></li>`;}).join('')||`<li class="muted">${e(txt('Eşleşen lisans yok.','No matching licenses.'))}</li>`}</ul>
   <div class="modal-actions"><span class="bl-picker-count">${e(txt(`${supplierSelection.size} lisans seçildi`,`${supplierSelection.size} licenses selected`))}</span><button class="btn" data-action="blPickCancel">${e(txt('Vazgeç','Cancel'))}</button><button class="btn primary" data-action="blPickExport" ${supplierSelection.size?'':'disabled'}>${e(txt('Seçilenleri aktar','Export selected'))}</button></div></section></div>`;
  if(focus){const el=document.getElementById(focus);el?.focus();if(el?.type==='search')el.setSelectionRange(el.value.length,el.value.length);}
 }
 document.addEventListener('change',event=>{const el=event.target;
  if(el.matches?.('[data-bl-pick]')){event.stopImmediatePropagation();if(el.checked)supplierSelection.add(el.dataset.blPick);else supplierSelection.delete(el.dataset.blPick);const count=overlay.querySelector('.bl-picker-count');if(count)count.textContent=txt(`${supplierSelection.size} lisans seçildi`,`${supplierSelection.size} licenses selected`);const go=overlay.querySelector('[data-action="blPickExport"]');if(go)go.disabled=!supplierSelection.size;return;}
  if(el.id==='blPickLicensor'){event.stopImmediatePropagation();pickerLicensor=el.value;supplierPicker(true);return;}
  if(el.id==='blLicensorFilter'){event.stopImmediatePropagation();licensorFilter=el.value;const input=document.getElementById('licenseSearch'),position=input?.selectionStart;home();document.getElementById('licenseSearch')?.setSelectionRange(position||0,position||0);}
 },true);
 document.addEventListener('input',event=>{if(event.target.id!=='blPickSearch')return;event.stopImmediatePropagation();pickerQuery=event.target.value;supplierPicker(true);},true);
 function decorate(){
  document.querySelector('.footer').textContent=txt('Buyer Log · Atlas ve ticari bilgiler yetkili kullanıcılarla paylaşılır.','Buyer Log · Atlas and commercial details are shared with authorized users.');
  const note=document.querySelector('.note-band');if(!activeId&&note)note.textContent=txt('Atlası Buyer Log içinde düzenleyin. Değişiklikleri kaydedin; üreticiniz için aynı görsel arayüzle ayrı bir rehber oluşturun.','Edit the atlas inside Buyer Log. Save your changes and create a separate guide with the same visual interface for your supplier.');
  const refresh=document.querySelector('.nav-actions [data-action="new"]');if(refresh){refresh.innerHTML=ico('refresh',15)+' <span class="hide-mobile">'+e(txt('ASAS’tan yenile','Refresh from ASAS'))+'</span>';refresh.title=txt('Buyer Log lisans kayıtlarını yenile','Refresh Buyer Log license records');}
  document.querySelectorAll('[data-action="theme"],[data-action="lang"]').forEach(el=>el.hidden=true);
  const backup=document.querySelector('.nav-actions [data-action="export"]');if(backup&&!document.querySelector('[data-action="blRecovery"]'))backup.insertAdjacentHTML('afterend',`<button class="btn" data-action="blRecovery">${ico('upload',15)} <span>Recovery</span></button>`);
  const recover=document.querySelector('[data-action="blRecovery"]');if(recover)recover.hidden=!canEdit;
  const categoryFilter=document.getElementById('categoryFilter');
  if(categoryFilter&&!document.getElementById('blLicensorFilter'))categoryFilter.insertAdjacentHTML('afterend','<select class="selectbox" id="blLicensorFilter"></select>');
  const licensorSelectEl=document.getElementById('blLicensorFilter');
  if(licensorSelectEl){const options=licensorOptions();if(licensorFilter&&!options.some(([k])=>k===licensorFilter))licensorFilter='';licensorSelectEl.setAttribute('aria-label',txt('Lisansör filtresi','Licensor filter'));licensorSelectEl.innerHTML=`<option value="">${e(txt('Tüm lisansörler','All licensors'))}</option>`+options.map(([k,label])=>`<option value="${e(k)}" ${k===licensorFilter?'selected':''}>${e(label)}</option>`).join('');}
  const badge=document.getElementById('resultsBadge');if(badge)badge.textContent=txt(`${document.querySelectorAll('.license-card').length} sonuç`,`${document.querySelectorAll('.license-card').length} results`);
  document.querySelectorAll('[data-action="import"]').forEach(el=>el.hidden=true);
  document.querySelectorAll('.nav-actions [data-action="studio"],.nav-actions [data-action="new"]').forEach(el=>el.hidden=!canEdit);
  if(!canEdit){document.querySelectorAll('[data-action="studio"],[data-action="new"],[data-action="uploadLicenseCover"],[data-action="removeLicenseCover"],[data-action^="mapAdd"],[data-action^="mapRemove"],[data-action^="mapAsk"],[data-action^="mapMove"],[data-action^="mapPaste"],[data-action^="mapUpload"],[data-action^="mapClear"],[data-action^="mapChoose"],[data-action="mapSetApproval"]').forEach(el=>el.hidden=true);document.querySelectorAll('#app input,#app textarea,#app select').forEach(el=>{if(!['licenseSearch','categoryFilter'].includes(el.id))el.disabled=true;});}
  const subtitle=document.querySelector('.section-head p');if(!activeId&&subtitle)subtitle.textContent=txt(`${grouped(all()).length} lisans · Süreçler ve ticari bilgiler tek yerde`,`${grouped(all()).length} licenses · Processes and commercial details in one place`);
  status();
 }
 home=function(){const previous=rendering;rendering=true;try{original.home();decorate();}finally{rendering=previous;}};
 render=function(){const previous=rendering;rendering=true;try{original.render();if(activeId){
  const head=document.querySelector('.detail-head');
  if(head){head.insertAdjacentHTML('afterend',`<section class="bl-commerce"><div class="bl-commerce-title"><small>BUYER LOG / ${e(txt('TİCARİ BİLGİLER','COMMERCIAL DETAILS'))}</small><h3>${e(txt('Sözleşmeler ve oranlar','Contracts and rates'))}</h3><p>${e(txt('OPD ve sezona göre uygulanır.','Applied by OPD and season.'))}</p></div>${ratesHTML(activeId)}</section>`);
   head.querySelectorAll('[data-action="edit"]').forEach(el=>el.remove());
   head.insertAdjacentHTML('afterend',licensorSelect(activeId));
   head.querySelector('.head-tools').insertAdjacentHTML('afterbegin',`<button class="btn" data-action="edit">${ico('edit',15)} ${e(txt('Lisans detayları','License details'))}</button><button class="btn" data-action="blExportOne">${ico('download',15)} ${e(txt('Üretici atlası','Supplier atlas'))}</button>`);
  }
 }decorate();}finally{rendering=previous;}};
 selectLicense=function(id){const l=all().find(x=>x.id===id);if(l)preferred.set(licenseKey(l.name),id);original.selectLicense(id);send('select',{id});};
 editorBody=function(){return editTab==='contracts'?businessHTML:original.editorBody();};
 function captureBusiness(){
  const current=overlay.querySelector('.bl-business');if(!current)return;const snapshot=current.cloneNode(true);
  const values=[...current.querySelectorAll('input,textarea,select')];snapshot.querySelectorAll('input,textarea,select').forEach((el,i)=>{if(el.tagName==='TEXTAREA')el.textContent=values[i].value;else if(el.tagName==='INPUT')el.setAttribute('value',values[i].value);else [...el.options].forEach(o=>o.selected=o.value===values[i].value);});businessHTML=snapshot.outerHTML;
 }
 renderEditor=function(skipCapture=false){
  if(!skipCapture)captureBusiness();original.renderEditor();
  const tabs=overlay.querySelector('.drawer-tabs');tabs.insertAdjacentHTML('afterbegin',`<button data-action="tab" data-tab="contracts" class="${editTab==='contracts'?'active':''}">${e(txt('Sözleşmeler ve oranlar','Contracts and rates'))}</button>`);
  overlay.querySelector('.drawer-head .overline').textContent=txt('LİSANS DETAYLARI','LICENSE DETAILS');
  overlay.querySelector('.drawer-head p').textContent=txt('Süreç ve sözleşme bilgileri birlikte Buyer Log’a kaydedilir.','Process and contract details are saved together to Buyer Log.');
  overlay.querySelector('.drawer-head').insertAdjacentHTML('afterend',licensorSelect(editor.id,true));
  overlay.querySelector('.editor-language-banner')?.remove();overlay.querySelector('.share-intro')?.remove();
  for(const path of ['symbol','description','rightsHolder'])overlay.querySelector(`[data-path="${path}"]`)?.closest('.field')?.remove();
  const agency=overlay.querySelector('[data-path="agency"]');if(agency){agency.readOnly=true;agency.value=chosen()?.agency||'';}
  const name=overlay.querySelector('[data-path="name"]');if(name)name.readOnly=true;
  overlay.querySelectorAll('[data-action="deleteLicense"],[data-action="duplicate"]').forEach(el=>el.hidden=true);
  const apply=overlay.querySelector('[data-action="saveEditor"]');if(apply){apply.textContent=busy?txt('Kaydediliyor…','Saving…'):txt('Kaydet','Save');apply.disabled=busy;apply.hidden=!canEdit;}
  if(!canEdit)overlay.querySelectorAll('input,textarea,select,button[data-action="blAddPeriod"]').forEach(el=>el.disabled=true);
  if(editTab==='sharing'){
   const portal=overlay.querySelector('[data-path="portal|manufacturerVisible"]');const label=portal?.closest('.share-toggle')||portal?.closest('label');
   if(label){let prev=label.previousElementSibling;if(prev?.matches('h3'))prev.textContent='Portal';}
   const body=overlay.querySelector('#drawerBody');body.insertAdjacentHTML('beforeend',`<h3 class="form-section">${e(txt('Adres görünürlüğü','Address visibility'))}</h3>${availableAddresses(editor).map(a=>{const i=editor.addresses.findIndex(x=>x.id===a.id);return i>=0?shareSwitch(`addresses|${i}|manufacturerVisible`,a.label||txt('Gönderim adresi','Shipping address')):`<label class="share-switch"><input type="checkbox" data-bl-shared="${e(a.id)}" ${(editor.blSharedVisibility?.[a.id]??a.manufacturerVisible)!==false?'checked':''}><span>${e(a.label||txt('Paylaşılan adres','Shared address'))}</span></label>`;}).join('')}`);
   const requirements=overlay.querySelector('[data-path="supplierShowRequirements"]')?.closest('label')?.querySelector('small');if(requirements)requirements.textContent=txt('Genel gereksinimleri üretici dosyasına dahil edin.','Include general requirements in the supplier file.');
   overlay.querySelectorAll('.muted-tip').forEach(el=>{if(el.textContent.includes('adres')||el.textContent.includes('address'))el.textContent=txt('Adres görünürlüğü Portal’dan bağımsızdır. Adresler sekmesinden yönetilir.','Address visibility is independent of Portal. Manage it under Addresses.');});
  }
  if(!canEdit)overlay.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);
  for(const [i,st] of (editor?.stages||[]).entries())for(const [j,sub] of (st.submissions||[]).entries()){
   const target=overlay.querySelector(`[data-path="stages|${i}|submissions|${j}|note"]`);
   if(target)target.closest('.field')?.insertAdjacentHTML('afterend',field(txt('Üretici gönderim talimatı','Supplier submission instructions'),`stages|${i}|submissions|${j}|supplierInstructions`,'textarea')+shareSwitch(`stages|${i}|submissions|${j}|supplierShowNotes`,txt('Gönderim notunu üreticiyle paylaş','Share submission note with supplier')));
  }
 };
 showHelp=function(){overlay.innerHTML=`<div class="modal"><div class="modal-box" role="dialog" aria-modal="true" aria-label="${e(txt('Atlas kullanım rehberi','Atlas guide'))}"><h2>${e(txt('Buyer Log · Lisans Atlası','Buyer Log · License Atlas'))}</h2><ol><li>${e(txt('Lisans seçin; aşamaları aynı süreç ağacı üzerinde açıp düzenleyin. Lisans bilgileri bölümünden adres, portal ve üretici görünürlüğünü yönetin.','Choose a license; expand and edit stages in the workflow tree. Manage addresses, portal and supplier visibility in License details.'))}</li><li>${e(txt('Değişikliklerden sonra Atlası kaydet düğmesine basın. Kayıt doğrulandığında tüm yetkili kullanıcılarla paylaşılır.','After editing, press Save atlas. Confirmed changes are shared with all authorized users.'))}</li><li>${e(txt('Royalty, komisyon, hologram ve tüm sözleşme kapsamlarını Lisans Detayları’nda düzenleyin.','Edit royalty, commission, hologram costs and every contract scope in License Details.'))}</li><li>${e(txt('Toplu ağaç kopyalamada kaynak ve hedefleri seçip uygulayın. Pencereyi kapatarak Atlası kaydet ile tüm değişiklikleri birlikte kaydedin.','Select a source and targets in Copy complete tree. Apply, close the window, then use Save atlas to save all changes together.'))}</li><li>${e(txt('Üretici atlası yalnız paylaşımı açılmış süreç ve talimatlardan oluşur. Dosya aynı Atlas arayüzünde salt okunur açılır.','The supplier atlas includes only shared processes and instructions. Its file opens in the same Atlas interface in read-only mode.'))}</li></ol><div class="modal-actions"><button class="btn primary" data-action="closeEditor">${e(txt('Anladım','Got it'))}</button></div></div></div>`;};
 renderProcessStudio=function(){original.renderProcessStudio();if((db.presetTemplateIds||[]).some(id=>processStudio?.source==='tpl:'+id))overlay.querySelectorAll('[data-action="studioDeleteTemplate"]').forEach(el=>el.hidden=true);};
 const readActions=new Set(['home','choose','stage','mapCloseStage','viewGuide','closeTreeGuide','next','previous','lang','theme','copyAddress','help','export','print','closeEditor','studioClose','mapCopyStage']);
 doAction=function(action,el){
  if(['lang','theme'].includes(action))return;
  if(action==='blRecovery'){if(dirty||busy||editor)return notify(txt('Önce açık değişiklikleri kaydedin veya bırakın.','Save or discard open changes first.'),true);recoveryInput.value='';recoveryInput.click();return;}
  if(action==='blRecoveryCancel'){if(busy)return;recoveryItems=null;overlay.innerHTML='';send('recoveryCancel');return;}
  if(action==='blRecoveryApply'){if(busy||!recoveryItems)return;busy=true;overlay.querySelectorAll('button').forEach(b=>b.disabled=true);send('recoveryApply');return;}
  if(action==='blAddPeriod'){detailsDirty=true;persist();send('businessAdd');return;}
  if(action==='edit'){
   if(busy)return;businessHTML='';detailsDirty=false;send('businessBegin',{id:activeId});original.doAction(action,el);editTab='contracts';renderEditor();return;
  }
  if(action==='closeEditor'&&editor){
   if(busy)return;if(detailsDirty&&!confirm(txt('Kaydedilmemiş detay değişiklikleri bırakılsın mı?','Discard unsaved detail changes?')))return;
   detailsDirty=false;send('businessCancel');original.doAction(action,el);persist();return;
  }
  if(action==='saveEditor'&&editor){
   if(busy||!canEdit)return;const invalid=[...overlay.querySelectorAll('input,textarea')].find(el=>!el.checkValidity());if(invalid){invalid.reportValidity();return;}if(editor.portal?.url&&!safeUrl(editor.portal.url))return notify(txt('Geçerli bir portal adresi girin.','Enter a valid portal URL.'),true);
   const payload=deep(db),index=payload.licenses.findIndex(l=>l.id===editor.id);if(index<0)return;
   payload.licenses[index]=deep(editor);delete payload.licenses[index].blSharedVisibility;for(const a of payload.sharedAddresses||[])if(Object.hasOwn(editor.blSharedVisibility||{},a.id))a.manufacturerVisible=editor.blSharedVisibility[a.id];busy=true;detailsSaving=true;renderEditor();send('save',{db:payload,details:true});return;
  }
  if(action==='blSave'){if(!dirty||busy)return;if(editor||processStudio)return notify(txt('Önce açık düzenlemeyi tamamlayın.','Complete the open editor first.'),true);busy=true;status();send('save',{db});return;}
  if(action==='blDiscard'){if(busy)return;if(!confirm(txt('Kaydedilmemiş atlas değişiklikleri bırakılsın mı?','Discard unsaved atlas changes?')))return;db=JSON.parse(baseline);dirty=false;send('discarded');overlay.innerHTML='';editor=null;processStudio=null;chosen()?render():home();return;}
  if(action==='supplierAll'||action==='blExportOne'){if(dirty||busy)return notify(txt('Dışa aktarmadan önce atlası kaydedin.','Save the atlas before exporting.'),true);if(action==='blExportOne'){send('export',{ids:[activeId]});return;}supplierSelection=new Set();supplierPicker();return;}
  if(action==='blPickAll'||action==='blPickNone'){for(const l of pickerLicenses())if(l.manufacturerVisible!==false){if(action==='blPickAll')supplierSelection.add(l.id);else supplierSelection.delete(l.id);}supplierPicker(true);return;}
  if(action==='blPickCancel'){overlay.innerHTML='';return;}
  if(action==='blPickExport'){if(!supplierSelection.size)return;const ids=[...supplierSelection];overlay.innerHTML='';send('export',{ids});return;}
  if(action==='new'){if(!dirty&&!busy)send('refresh');return;}
  if(['reset','deleteLicense','duplicate','import'].includes(action))return;
  if((busy||!canEdit)&&!readActions.has(action))return;
  original.doAction(action,el);if(action==='addStage'&&editor){editor.stages.at(-1).supplierShowSourceNote=true;renderEditor();}decorate();
 };
 // Read-only users may expand the exact same tree but cannot mutate fields or drag steps.
 document.addEventListener('change',event=>{const el=event.target;if(canEdit&&!busy&&!rendering&&locale==='en'&&['supplierInstructions','note'].includes(el.dataset.mapSubField)){event.stopImmediatePropagation();mapSetStage(el.dataset.mapStage,st=>{const sub=st.submissions.find(r=>r.id===el.dataset.mapSub);if(sub){sub.i18n??={};sub.i18n.en??={};sub.i18n.en[el.dataset.mapSubField]=el.value;}},false);}},true);
 for(const type of ['input' ,'change','drop','dragstart'])document.addEventListener(type,event=>{if((rendering||!canEdit||busy)&&!['licenseSearch','categoryFilter'].includes(event.target.id)){event.preventDefault();event.stopImmediatePropagation();}},true);
 document.addEventListener('change',event=>{const el=event.target;if(!el.matches('[data-bl-shared]')||!canEdit||busy)return;const a=(db.sharedAddresses||[]).find(x=>x.id===el.dataset.blShared);if(a&&editor){(editor.blSharedVisibility??={})[a.id]=el.checked;detailsDirty=true;persist();}},true);
 document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!overlay.innerHTML)return;event.preventDefault();event.stopImmediatePropagation();if(editor)doAction('closeEditor');else if(overlay.querySelector('.bl-recovery'))doAction('blRecoveryCancel');else if(!busy){processStudio=null;overlay.innerHTML='';}},true);
 const recoveryInput=document.createElement('input');recoveryInput.type='file';recoveryInput.accept='.json,application/json';recoveryInput.hidden=true;document.body.append(recoveryInput);
 recoveryInput.addEventListener('change',async()=>{const f=recoveryInput.files?.[0];if(!f)return;try{if(f.size>35*1024*1024)throw new Error();const backup=JSON.parse(await f.text());send('recoveryPreview',{backup});}catch{notify(txt('Yedek JSON dosyası okunamadı veya 35 MB sınırını aşıyor.','The backup JSON could not be read or exceeds 35 MB.'),true);}});
 function recoveryDialog(message){recoveryItems=message.error?null:message.items;
  overlay.innerHTML=`<div class="modal"><section class="modal-box bl-recovery" role="dialog" aria-modal="true" aria-label="Recovery"><div class="overline">ATLAS RECOVERY</div><h2>${e(txt('Atlası topluca geri yükle','Restore the atlas in one go'))}</h2><p>${e(message.error||txt(`${message.items.length} lisans/lisansör kaydının süreçleri, adresleri, görselleri ve paylaşım seçimleri yedekle güncellenecek. Royalty ve sözleşmeler korunur.`,`${message.items.length} license/licensor records will receive the backup’s processes, addresses, images and sharing settings. Royalty and contracts are preserved.`))}</p>${message.items?`<ul>${message.items.map(x=>`<li><b>${e(x.license)}</b> · ${e(x.licensor||'—')}</li>`).join('')}</ul>`:''}<p class="bl-recovery-error" role="alert"></p><div class="modal-actions"><button class="btn" data-action="blRecoveryCancel">${e(txt('Vazgeç','Cancel'))}</button>${message.items?`<button class="btn primary" data-action="blRecoveryApply">${e(txt('Tümünü geri yükle','Restore all'))}</button>`:''}</div></section></div>`;
 }
 function applyEnvironment(env){if(!env)return;
  const next=env.locale==='en'?'en':'tr',changed=locale!==next;locale=next;document.documentElement.lang=next;
  document.documentElement.dataset.theme=env.theme;document.body.classList.toggle('dark',env.theme==='dark');document.documentElement.style.colorScheme=env.theme==='dark'?'dark':'light';
  const t=env.tokens||{},aliases={'--bg':'--paper','--blue-soft':'--card2','--panel':'--card','--navy':'--acc','--blue':'--acc','--shadow':'--shadow-2','--radius':'--r-lg','--bl-acc':'--acc','--bl-ink':'--acc-ink','--bl-sub':'--muted','--bl-card2':'--card2','--bl-hair':'--hair','--bl-on':'--on-acc','--line2':'--line2','--mint':'--green'};
  // Every Buyer Log token is also available verbatim as --blt-<name> for the skin layer.
  for(const [k,v] of Object.entries(t))document.documentElement.style.setProperty('--blt-'+k.slice(2),v);
  for(const k of ['--bg','--ink','--muted','--line'])if(t[k]){document.documentElement.style.setProperty(k,t[k]);document.body.style.setProperty(k,t[k]);}
  for(const [to,from] of Object.entries(aliases))if(t[from]){document.documentElement.style.setProperty(to,t[from]);document.body.style.setProperty(to,t[from]);}
  // The skin is authored at Buyer Log's standard 12.5px; follow the Arayüz size setting.
  const base=parseFloat(t['--fs-base']);if(Number.isFinite(base)&&base>0)document.documentElement.style.setProperty('--bl-density',String(Math.min(1.3,Math.max(.85,base/12.5))));
  if(changed){chosen()?render():home();if(editor){renderEditor();send('businessRefresh');}}decorate();
 }
 document.addEventListener('change',event=>{const target=event.target;if(!target.matches('[data-bl-licensor]'))return;
  event.stopImmediatePropagation();if(busy)return;const id=target.value,inside=target.dataset.blLicensor==='editor';
  if(inside&&detailsDirty&&!confirm(txt('Bu lisansörün kaydedilmemiş değişiklikleri bırakılsın mı?','Discard this licensor’s unsaved changes?'))){target.value=editor.id;return;}
  if(inside){detailsDirty=false;send('businessCancel');editor=null;overlay.innerHTML='';persist();}
  selectLicense(id);if(inside)doAction('edit');
 },true);
 document.addEventListener('input',event=>{const el=event.target;if(el.id==='licenseSearch')queueMicrotask(()=>{const badge=document.getElementById('resultsBadge');if(badge)badge.textContent=txt(`${document.querySelectorAll('.license-card').length} sonuç`,`${document.querySelectorAll('.license-card').length} results`);});if(!editor||!canEdit||busy)return;
  if(el.matches('[data-lc-rule],[name]')&&el.closest('.bl-business'))send('businessInput',{index:el.dataset.lcRule,key:el.dataset.lcKey,name:el.name,value:el.value});
  if(el.hasAttribute('data-path')||el.closest('.bl-business')){detailsDirty=true;persist();}
 },true);
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.wire!==wire)return;
  if(connected&&event.origin!==parentOrigin)return;
  const message=event.data;
  if(message.action==='init'){
   const commerceChanged=JSON.stringify(commerce)!==JSON.stringify(message.commerce||{});connected=true;parentOrigin=event.origin;canEdit=message.canEdit===true;commerce=message.commerce||{};locale=message.locale==='en'?'en':'tr';
   if(!dirty&&!editor&&(JSON.stringify(message.db)!==baseline||commerceChanged)){db=deep(message.db);baseline=JSON.stringify(db);busy=false;activeStage='';if(activeId&&!chosen())activeId='';chosen()?render():home();}
   else{decorate();}
   applyEnvironment(message.environment);updateLanguageControls();if(message.error)status(message.error,true);
  }
  if(message.action==='business'){businessHTML=message.html||'';if(editor&&editTab==='contracts'){
   // Linked contract dates re-render while editing; keep the user's field and scroll position.
   const active=document.activeElement,key=active?.dataset?.lcRule!=null?`[data-lc-rule="${CSS.escape(active.dataset.lcRule)}"][data-lc-key="${CSS.escape(active.dataset.lcKey||'')}"]`:'',top=overlay.querySelector('#drawerBody')?.scrollTop||0;
   renderEditor(true);const body=overlay.querySelector('#drawerBody');if(body)body.scrollTop=top;if(key)overlay.querySelector('.bl-business '+key)?.focus({preventScroll:true});}}
  if(message.action==='recoveryPlan')recoveryDialog(message);
  if(message.action==='environment')applyEnvironment(message.environment);
  if(message.action==='saved'){if(detailsSaving||message.recovery){editor=null;overlay.innerHTML='';detailsSaving=false;detailsDirty=false;recoveryItems=null;}busy=false;dirty=false;db=deep(message.db);baseline=JSON.stringify(db);commerce=message.commerce||commerce;send('dirty',{dirty:false});chosen()?render():home();notify(txt('Atlas Buyer Log’a kaydedildi.','Atlas saved to Buyer Log.'));}
  if(message.action==='failed'){busy=false;detailsSaving=false;if(editor)renderEditor();const target=overlay.querySelector('.bl-recovery-error');if(target){target.textContent=message.error;overlay.querySelectorAll('button').forEach(b=>b.disabled=false);}status(message.error,true);}
  if(message.action==='supplier'){
   const tpl=new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('supplierTemplate').textContent.trim()),ch=>ch.charCodeAt(0)));
   const payload=JSON.stringify(message.payload).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
   const html=supplierSkin(tpl.replace('__PUBLIC_DATA__',payload)),blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Buyer-Log-License-Atlas.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
 });
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 // Buyer Log type scale: the uploaded Atlas declares its own 14–78px sizes and
 // 750–900 weights in ~1100 rules. Rather than fork that CSS, derive one override
 // per rule at runtime so every view (tree, editors, Studio, dialogs) reads like Buyer Log.
 function buyerLogTypeScale(){
  const size=px=>px<=10?10.5:px<=11?11:px<=12.5?12:px<=14?12.5:px<=17?13.5:px<=21?15:px<=26?17:px<=40?20:24;
  const px=value=>{const all=[...String(value||'').matchAll(/(-?[\d.]+)px/g)].map(m=>+m[1]);return all.length?Math.max(...all):null;};
  const out=[];
  function walk(rules,wrap){for(const rule of rules){
   if(rule.cssRules&&rule.media){walk(rule.cssRules,`@media ${rule.media.mediaText}`);continue;}
   if(!rule.style||!rule.selectorText)continue;const st=rule.style,decl=[];
   const fs=px(st.getPropertyValue('font-size'));if(fs!=null&&fs>0)decl.push(`font-size:${size(fs)}px!important`);
   const fw=parseInt(st.getPropertyValue('font-weight'),10);if(fw>=650)decl.push('font-weight:600!important');else if(fw>=550)decl.push('font-weight:500!important');
   const ls=parseFloat(st.getPropertyValue('letter-spacing'));if(ls<0)decl.push('letter-spacing:0!important');
   if(st.getPropertyValue('font-family')&&!/mono|Cascadia|Consolas/i.test(st.getPropertyValue('font-family')))decl.push(`font-family:${/h[1-4]\b|head|title|brandname|cover-name|identity-desc/i.test(rule.selectorText)?'var(--bl-head-font)':'var(--bl-body-font)'}!important`);
   if(decl.length)out.push(wrap?`${wrap}{${rule.selectorText}{${decl.join(';')}}}`:`${rule.selectorText}{${decl.join(';')}}`);
  }}
  for(const sheet of document.styleSheets){const node=sheet.ownerNode;if(!node||['bl-fonts','bl-integration'].includes(node.id))continue;try{walk(sheet.cssRules,'');}catch(_){}}
  const style=document.createElement('style');style.id='bl-type-scale';style.textContent=out.join('\n');
  const integration=document.getElementById('bl-integration');(integration?.parentNode||document.head).insertBefore(style,integration||null);
 }
 buyerLogTypeScale();
 // The supplier file is standalone: carry the same fonts, skin, type scale and the
 // Buyer Log light/dark tokens (design.css) so its cards look like the in-app library.
 const SUPPLIER_TOKENS=':root body{--blt-paper:#f2f2f3;--blt-card:#f8f8f9;--blt-card2:#f5f5f8;--blt-ink:#1d1f20;--blt-ink2:#5d5d60;--blt-muted:#7a7a7d;--blt-line:#d4d4d7;--blt-line2:#b7b7ba;--blt-hair:rgba(29,31,32,.12);--blt-acc:#3f6488;--blt-acc-bg:#e6edf4;--blt-acc-ink:#2c455d;--blt-acc-hover:#2f4d6b;--blt-on-acc:#f2f2f3;--blt-red:#b42318;--blt-green:#177a4c}'
  +':root body.dark{--blt-paper:#23262a;--blt-card:#292d32;--blt-card2:#31353b;--blt-ink:#e9eaec;--blt-ink2:#a9adb3;--blt-muted:#82868c;--blt-line:#3a3f46;--blt-line2:#4a4f56;--blt-hair:rgba(233,234,236,.13);--blt-acc:#8fb4d8;--blt-acc-bg:#2b3f53;--blt-acc-ink:#cfe2f4;--blt-acc-hover:#a9c8e6;--blt-on-acc:#1b1e21;--blt-red:#e39b94;--blt-green:#93c7a8}'
  +':root body,:root body.dark{--bg:var(--blt-paper);--panel:var(--blt-card);--ink:var(--blt-ink);--muted:var(--blt-muted);--line:var(--blt-line);--navy:var(--blt-acc);--blue:var(--blt-acc);--blue-soft:var(--blt-card2);--radius:0px;--shadow:none;--bl-acc:var(--blt-acc);--bl-ink:var(--blt-acc-ink);--bl-sub:var(--blt-muted);--bl-card2:var(--blt-card2);--bl-hair:var(--blt-hair);--bl-on:var(--blt-on-acc)}'
  +'.license-card .cover.has-cover-image img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover!important;object-position:center}';
 function supplierSkin(html){
  const fonts=document.getElementById('bl-fonts')?.textContent||'',skin=document.getElementById('bl-integration')?.textContent||'';
  const head=`<style id="bl-fonts">${fonts}</style><style id="bl-integration">${skin}\n${SUPPLIER_TOKENS}</style>`;
  const script=`<script>(${buyerLogTypeScale.toString()})();<\/script>`;
  return html.replace('</head>',()=>head+'</head>').replace(/<\/body>(?![\s\S]*<\/body>)/,()=>script+'</body>');
 }
 // Start without business data. Only the parent can populate the sandbox.
 db={version:2,licenses:[]};home();parent.postMessage({wire,action:'ready'},'*');
})();
