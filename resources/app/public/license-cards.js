/* Lazy license cards. ASAS discovery lives on the server; statistics only use loaded rows. */
(() => {
  'use strict';
  const E=window.BLLicenseCardsEngine;
  if(!E)return;
  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,en)=>isEn()?en:tr;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=(n,d=2)=>new Intl.NumberFormat(isEn()?'en-US':'tr-TR',{maximumFractionDigits:d}).format(n);
  const percent=v=>v==null||v===''?'—':`${nf(Number(v))}%`;
  const cost=v=>v==null||v===''?'—':`$${nf(Number(v),4)}`;
  const S={host:null,data:null,pending:null,stale:false,loading:false,error:'',query:'',limit:48,selected:'',draft:null,editing:false,saving:false,conflict:false,stats:null,statsKey:'',statsOpen:false};
  const profileFields=['workingNotes','contactName','contactEmail','portalUrl','portalUsername','accessReference','symbolDataUrl','artworkBrief'];
  const visible=()=>S.host&&S.host.getClientRects().length>0;
  const card=()=>S.editing&&S.draft?S.draft.baseCard:S.data?.cards?.find(c=>c.id===S.selected);
  const disabled=()=>!S.editing||S.saving;
  function failMessage(error){
    if(error.status===409)return T('Bu kartın bilgileri veya sözleşmeleri siz açtıktan sonra değişti. Düzenlemeleriniz korunuyor. Güncel kaydı açıp değişikliklerinizi yeniden uygulayın.','This card’s details or contracts changed since you opened it. Your edits are preserved. Open the current record and reapply your changes.');
    if(error.status===403)return T('Bu kartı değiştirme yetkiniz yok.','You do not have permission to edit this card.');
    if(error.code==='LICENSE_RULE_OVERLAP')return T('Sözleşmeler aynı OPD tarih aralığı ve sezonda çakışıyor. Yeni dönemin başlangıcından önce eski dönemi kapatın.','Contracts overlap for the same OPD date range and season. End the previous period before the next one starts.');
    if(error.code==='LICENSE_RULE_DATE'||error.code==='LICENSE_RULES_INVALID')return T('Sözleşme tarihlerini ve oranlarını kontrol edin. Royalty ile komisyon toplamı %100’ü aşamaz.','Check contract dates and rates. Royalty plus commission cannot exceed 100%.');
    if(error.code==='LICENSE_PORTAL_INVALID')return T('Portal adresi http:// veya https:// ile başlamalı ve parola içermemeli.','The portal URL must start with http:// or https:// and contain no credentials.');
    if(error.code==='LICENSE_ATLAS_INVALID')return T('Atlas verisini, bağlantıları ve 2 MB sınırını kontrol edin.','Check atlas data, links and the 2 MB limit.');
    if(error.code==='LICENSE_PROFILE_INVALID')return T('Bir kart alanı çok uzun veya geçersiz. Alan sınırlarını kontrol edin.','A card field is too long or invalid. Check the field limits.');
    if(error.code==='LICENSE_SYMBOL_INVALID')return T('Geçerli PNG, JPEG veya WebP sembol yükleyin (en fazla 2048 × 2048 piksel).','Upload a valid PNG, JPEG or WebP symbol (maximum 2048 × 2048 pixels).');
    return T('İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.','The operation could not be completed. Check your connection and retry.');
  }
  async function api(url,options={}){
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(window.BL_CLIENT_ID?{'X-Client-Id':window.BL_CLIENT_ID}:{}),...(options.headers||{})}});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(data.error||r.statusText);e.status=r.status;e.code=data.code;throw e;}
    return data;
  }
  function makeDraft(c){return {baseCard:c,editToken:c.editToken,revision:S.data.revision,pricingRevision:S.data.pricingRevision,profile:{...Object.fromEntries(profileFields.map(k=>[k,c[k]||''])),processAtlas:c.processAtlas?JSON.parse(JSON.stringify(c.processAtlas)):null},rules:JSON.parse(JSON.stringify(c.rules||[]))};}
  async function load(refresh=false){
    if(S.pending)return S.pending;
    S.loading=true;if(!S.editing){S.error='';render();}
    S.pending=(async()=>{
      let redraw=!S.editing;
      try{
        do{
          S.stale=false;
          const data=await api(refresh?'/api/license-cards/refresh':'/api/license-cards',refresh?{method:'POST'}:{});refresh=false;
          if(S.editing&&S.draft){
            const current=data.cards?.find(c=>c.id===S.selected);
            // Notifications (including polling/reconnect/our own echo) are hints.
            // Only the opened card's verified token may invalidate its draft.
            const changed=!current||!S.draft.editToken||current.editToken!==S.draft.editToken;
            if(changed&&!S.conflict){S.conflict=true;redraw=true;}
            if(!changed){S.draft.revision=data.revision;S.draft.pricingRevision=data.pricingRevision;}
          }
          S.data=data;S.statsKey='';
          await window.BLLicenseDataBridge?.rulesChanged?.(data);
          if(!S.editing){S.conflict=false;if(S.selected&&!card())S.selected='';if(S.selected)S.draft=makeDraft(card());}
        }while(S.stale&&!S.saving);
      }catch(e){S.stale=true;if(!S.editing){S.error=failMessage(e);redraw=true;}}
      finally{S.loading=false;S.pending=null;if(redraw||!S.editing)render();}
    })();return S.pending;
  }
  function scope(rule){const seasons=Array.isArray(rule.seasons)?rule.seasons:(rule.season?[rule.season]:[]);return `${seasons.length?seasons.join(', '):T('Tüm sezonlar','All seasons')}${rule.countryGroup?` · ${rule.countryGroup}`:''}`;}
  const range=rule=>`${rule.opdStart||'−∞'} → ${rule.opdEnd||'+∞'}`;
  function statusLabel(status){return ({active:T('Güncel','Current'),expired:T('Geçmiş','Past'),future:T('Planlanan','Upcoming'),invalid:T('Geçersiz tarih','Invalid date')})[status];}
  function rates(rule){return `<div class="lcRates"><div><span>Royalty</span><b>${esc(percent(rule.royalty))}</b></div><div><span>${esc(T('TR komisyon','TR commission'))}</span><b>${esc(percent(rule.trCommission))}</b></div><div><span>${esc(T('YD komisyon','International commission'))}</span><b>${esc(percent(rule.ydCommission))}</b></div><div><span>${esc(T('Hologram','Hologram'))}</span><b>${esc(cost(rule.hologramCost))}</b></div></div>`;}
  function cardHtml(c){
    const current=E.contracts(c.rules).active;
    const symbol=E.symbolUrl(c.symbolDataUrl);
    return `<button class="lcCard cardBox${S.selected===c.id?' isSelected':''}" type="button" data-lc-open="${esc(c.id)}" aria-expanded="${S.selected===c.id}" ${S.editing||S.saving?'disabled':''}><div class="lcCardHead"><div class="lcSymbol" data-no-i18n>${symbol?`<img src="${esc(symbol)}" alt="">`:esc(String(c.license||'?').slice(0,2).toUpperCase())}</div><div><h3>${esc(c.license)}</h3><span>${esc(c.licensor||'—')}</span></div><span class="lcOpenMark" aria-hidden="true"><svg class="ic"><use href="#i-chevron-right"/></svg></span></div><div class="lcCardCurrent"><span class="lcEyebrow">${esc(T('Güncel sözleşme','Current contract'))}</span>${current.length?current.map(r=>`<div class="lcActiveScope"><div class="lcScope">${esc(scope(r))}</div>${rates(r)}</div>`).join(''):`<p class="lcMuted">${esc(T('Bugün geçerli bir sözleşme yok.','No contract is valid today.'))}</p>`}</div><div class="lcAtlasCardStatus"><span class="lcBadge">${esc(c.processAtlas?T('Süreç atlası bağlı','Process atlas linked'):T('Atlas eklenebilir','Atlas available'))}</span>${c.processAtlas?`<span class="lcMuted">${c.processAtlas.license.stages.filter(s=>s.enabled!==false).length} ${esc(T('aktif adım','active steps'))}</span>`:''}</div><div class="lcCardFoot"><span>${esc(T('Detaylar ve geçmiş','Details and history'))}</span><span>${nf((c.rules||[]).length,0)} ${esc(T('sözleşme','contracts'))}</span></div></button>`;
  }
  function input(name,label,type='text',extra=''){
    const value=S.draft.profile[name]||'';
    return `<label class="lcField"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${disabled()?'disabled':''} ${extra}></label>`;
  }
  function textarea(name,label){return `<label class="lcField lcFull"><span>${esc(label)}</span><textarea name="${name}" rows="4" maxlength="${name==='artworkBrief'?6000:12000}" ${disabled()?'disabled':''}>${esc(S.draft.profile[name]||'')}</textarea></label>`;}
  function contractHtml(rule,index){
    const state=E.ruleStatus(rule,E.today());
    if(!S.editing)return `<div class="lcContract"><div class="lcContractHead"><span class="lcBadge ${state==='active'?'isCurrent':''}">${esc(statusLabel(state))}</span><span class="lcMuted">${esc(range(rule))} · ${esc(scope(rule))}</span></div>${rates(rule)}</div>`;
    const numeric=(key,label,step='0.01',max='100')=>`<label class="lcField"><span>${esc(label)}</span><input type="number" min="0" max="${max}" step="${step}" data-lc-rule="${index}" data-lc-key="${key}" value="${esc(rule[key]??'')}" ${disabled()?'disabled':''} ${['royalty','hologramCost'].includes(key)?'required':''}></label>`;
    const seasons=Array.isArray(rule.seasons)?rule.seasons:(rule.season?[rule.season]:[]);
    return `<div class="lcContract"><div class="lcContractHead"><span class="lcBadge ${state==='active'?'isCurrent':''}">${esc(statusLabel(state))}</span><span class="lcMuted">${esc(range(rule))} · ${esc(scope(rule))}</span></div><div class="lcFormGrid"><label class="lcField"><span>${esc(T('OPD başlangıç','OPD start'))}</span><input type="date" data-lc-rule="${index}" data-lc-key="opdStart" value="${esc(rule.opdStart||'')}" ${disabled()?'disabled':''}></label><label class="lcField"><span>${esc(T('OPD bitiş','OPD end'))}</span><input type="date" data-lc-rule="${index}" data-lc-key="opdEnd" value="${esc(rule.opdEnd||'')}" ${disabled()?'disabled':''}></label><label class="lcField lcFull"><span>${esc(T('Sezonlar (virgülle ayırın; boş = tümü)','Seasons (comma-separated; empty = all)'))}</span><input type="text" data-lc-rule="${index}" data-lc-key="seasons" value="${esc(seasons.join(', '))}" ${disabled()?'disabled':''} maxlength="200"></label>${numeric('royalty','Royalty %')}${numeric('trCommission',T('TR komisyon %','TR commission %'))}${numeric('ydCommission',T('YD komisyon %','International commission %'))}${numeric('hologramCost',T('Hologram ($ / adet)','Hologram ($ / unit)'),'0.0001','1000000')}${rule.legacyTrHologramCost!=null?numeric('legacyTrHologramCost',T('TR hologram ($ / adet)','TR hologram ($ / unit)'),'0.0001','1000000'):''}${rule.legacyYdHologramCost!=null?numeric('legacyYdHologramCost',T('YD hologram ($ / adet)','International hologram ($ / unit)'),'0.0001','1000000'):''}</div></div>`;
  }
  function statsHtml(c){
    if(!S.statsOpen)return '';
    const loaded=window.BLLicenseDataBridge?.loadedRows?.()||{rows:[],module:'orders',version:''};
    const statKey=`${c.id}|${loaded.module}|${loaded.version}`;
    if(S.statsKey!==statKey){S.stats=E.statistics(loaded.rows,c,loaded.module,window.BLCanonicalFields);S.statsKey=statKey;}
    const st=S.stats;
    return `<div class="lcStats"><div><b>${nf(st.orders,0)}</b><span>${esc(T('sipariş','orders'))}</span></div><div><b>${nf(st.quantity,0)}</b><span>${esc(T('adet','units'))}</span></div><div><b>${nf(st.lines,0)}</b><span>${esc(T('model / renk satırı','model / colour lines'))}</span></div></div><p class="lcMuted">${esc(st.module==='cp'?T('Yalnız yüklenmiş CP verisi. Tam lisans toplamı değildir.','Loaded CP data only. This is not the full license total.'):T('Yalnız yüklenmiş Orders verisi. Tam lisans toplamı değildir.','Loaded Orders data only. This is not the full license total.'))}${st.unknownQuantities?` ${esc(T('Adedi eksik satırlar:','Lines with missing quantity:'))} ${nf(st.unknownQuantities,0)}`:''}</p>`;
  }
  function detailHtml(c){
    if(!S.draft)S.draft=makeDraft(c);
    const symbol=E.symbolUrl(S.draft.profile.symbolDataUrl),portal=E.portalHref(S.draft.profile.portalUrl);
    return `<div class="lcDetail panel" aria-label="${esc(T('Lisans detayları','License details'))}"><div class="lcDetailHead"><div><span class="lcEyebrow">${esc(T('Lisans kartı','License card'))}</span><h2>${esc(c.license)}</h2><p>${esc(c.licensor||'—')}</p></div><div class="lcActions"><button class="tbtn" type="button" data-lc-action="exportSelectedAtlas" ${S.editing||S.saving?'disabled':''}>${esc(T('Üretici atlası','Supplier atlas'))}</button>${window.BLLicenseAtlasShell&&S.editing?`<button class="tbtn" type="button" data-lc-action="importAtlas" ${S.saving?'disabled':''}>${esc(T('Atlas bağla','Link atlas'))}</button>`:''}${S.data.canEdit&&!S.editing&&!S.loading?`<button class="tbtn" type="button" data-lc-action="edit">${esc(T('Düzenle','Edit'))}</button>`:''}<button class="tbtn" type="button" data-lc-action="close" ${S.saving?'disabled':''}>${esc(T('Kapat','Close'))}</button></div></div>
    ${S.conflict?`<div class="lcNotice" role="alert">${esc(T('Kaydın daha güncel bir sürümü var. Düzenlemeleriniz korunuyor.','A newer version of this record exists. Your edits are preserved.'))}<button class="tbtn" type="button" data-lc-action="reload" ${S.saving?'disabled':''}>${esc(T('Düzenlemeyi bırak ve güncel kaydı aç','Discard edits and open current record'))}</button></div>`:''}
    <form id="lcCardForm"><details open><summary>${esc(T('Sözleşmeler ve oran geçmişi','Contracts and rate history'))} <span class="lcMuted">(${S.draft.rules.length})</span></summary><p class="lcMuted">${esc(T('Oranlar siparişin OPD tarihi ve sezonuna göre uygulanır. Yeni dönem eklerken eski sözleşmenin bitiş tarihini koruyun.','Rates apply by the order’s OPD date and season. When adding a period, retain the previous contract’s end date.'))}</p>${S.draft.rules.map(contractHtml).join('')}<p class="lcMuted">${esc(T('Boş komisyon alanı o ülke grubu için sözleşme tanımlı olmadığını belirtir.','An empty commission field means no contract is configured for that country group.'))}</p>${!c.licensor?`<p class="lcMuted">${esc(T('Royalty sözleşmesi eklemek için ASAS kaydında lisansör tanımlı olmalı.','The ASAS record must have a licensor before adding a royalty contract.'))}</p>`:''}${S.editing?`<button class="tbtn" type="button" data-lc-action="add" ${S.saving||!c.licensor?'disabled':''}>+ ${esc(T('Yeni dönem ekle','Add contract period'))}</button>`:''}</details>
    ${!window.BLLicenseAtlasShell?(window.BLLicenseAtlas?.html(c,S.draft.profile.processAtlas,S.editing&&!S.saving)||''):''}
    <details open><summary>${esc(T('Lisansör ve portal','Licensor and portal'))}</summary><div class="lcFormGrid">${textarea('workingNotes',T('Çalışma şekli ve notlar','Working process and notes'))}${input('contactName',T('İlgili kişi','Contact person'),'text','maxlength="200"')}${input('contactEmail',T('E-posta','Email'),'email','maxlength="320"')}${input('portalUrl',T('Portal web sitesi','Portal website'),'url','maxlength="2048"')}${input('portalUsername',T('Portal kullanıcı adı','Portal username'),'text','autocomplete="off" maxlength="200"')}${input('accessReference',T('Şifre yöneticisi kayıt referansı','Password manager record reference'),'text','autocomplete="off" maxlength="1000"')}</div>${portal?`<p><a href="${esc(portal)}" target="_blank" rel="noopener noreferrer">${esc(T('Portalı aç','Open portal'))} ↗</a></p>`:''}<p class="lcMuted">${esc(T('Parolayı burada saklamayın; şifre yöneticisindeki kayıt adını kullanın.','Use the password manager record name here to keep passwords in your password manager.'))}</p></details>
    <details><summary>${esc(T('Lisans sembolü ve Artwork','License symbol and Artwork'))}</summary><div class="lcSymbolPreview">${symbol?`<img src="${esc(symbol)}" alt="${esc(T('Lisans sembolü önizleme','License symbol preview'))}">`:esc(T('Henüz sembol yüklenmedi.','No symbol uploaded yet.'))}</div>${S.editing?`<label class="lcField"><span>${esc(T('Sembol yükle (PNG / JPEG / WebP, en fazla 256 KB)','Upload symbol (PNG / JPEG / WebP, max 256 KB)'))}</span><input type="file" id="lcSymbolFile" accept="image/png,image/jpeg,image/webp" ${S.saving?'disabled':''}></label>`:''}${textarea('artworkBrief',T('Buyer Log için Artwork fikri / brief','Artwork idea / brief for Buyer Log'))}<p class="lcMuted">${esc(T('Artwork isteğe bağlıdır. Burada briefinizi saklayabilirsiniz; görsel üretimi ve uygulaması son seçiminizden sonra yapılır.','Artwork is optional. Save your brief here; image generation and application follow your final choice.'))}</p></details>
    <details id="lcStatsDetail" ${S.statsOpen?'open':''}><summary>${esc(T('Sipariş özeti','Order summary'))}</summary><div id="lcStatsContent">${statsHtml(c)}</div></details>
    ${S.editing?`<div class="lcSaveBar"><span class="lcMuted">${esc(T('Değişiklikler tüm yetkili kullanıcılarla paylaşılır.','Changes are shared with all authorized users.'))}</span><button class="tbtn" type="button" data-lc-action="cancel" ${S.saving?'disabled':''}>${esc(T('Vazgeç','Cancel'))}</button><button class="tbtn primary" type="submit" ${S.saving||S.conflict?'disabled':''}>${esc(S.saving?T('Kaydediliyor…','Saving…'):T('Kaydet','Save'))}</button></div>`:''}</form></div>`;
  }
  // The Atlas details drawer renders these controls; the parent owns the draft.
  function businessHtml(){
    if(!S.draft)return '';
    return `<section class="bl-business"><p class="muted">${esc(T('Royalty Calculations ile aynı sözleşmeler. Tarih ve sezon kapsamlarını burada düzenleyebilirsiniz.','These contracts are shared with Royalty Calculations. Edit dates and season scopes here.'))}</p><div id="blBusinessRules">${S.draft.rules.map(contractHtml).join('')}</div><button class="btn" data-action="blAddPeriod" ${!card()?.licensor?'disabled':''}>+ ${esc(T('Yeni dönem ekle','Add contract period'))}</button><details><summary>${esc(T('İlgili kişi ve çalışma notları','Contact and working notes'))}</summary><div class="lcFormGrid">${input('contactName',T('İlgili kişi','Contact person'))}${input('contactEmail',T('E-posta','Email'),'email')}${textarea('workingNotes',T('Çalışma notları','Working notes'))}${input('portalUrl',T('Portal web sitesi','Portal website'),'url')}${input('portalUsername',T('Portal kullanıcı adı','Portal username'))}${input('accessReference',T('Şifre yöneticisi kayıt referansı','Password manager record reference'))}${textarea('artworkBrief',T('Artwork brief','Artwork brief'))}</div><p class="muted">${esc(T('Parolalar için şifre yöneticisindeki kayıt referansını kullanın.','Use a password manager record reference for passwords.'))}</p></details></section>`;
  }
  function businessBegin(id){const c=S.data?.cards.find(x=>x.id===id);if(!c)return '';S.selected=id;S.draft=makeDraft(c);S.editing=S.data.canEdit;S.conflict=false;return businessHtml();}
  function businessInput(m){if(!S.editing||!S.draft||S.saving)return;const k=m.key;
    if(profileFields.includes(m.name))S.draft.profile[m.name]=String(m.value||'');
    const r=S.draft.rules[Number(m.index)];
    if(r&&['opdStart','opdEnd','seasons','royalty','trCommission','ydCommission','hologramCost','legacyTrHologramCost','legacyYdHologramCost'].includes(k))r[k]=k==='seasons'?String(m.value).split(',').map(x=>x.trim()).filter(Boolean):['opdStart','opdEnd'].includes(k)?String(m.value):m.value===''?null:Number(m.value);
  }
  function businessAdd(){if(!S.draft||!card()?.licensor)return businessHtml();const c=card();S.draft.rules.push({id:`license-rule-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,license:c.license,licensor:c.licensor,opdStart:E.today(),opdEnd:'',seasons:[],royalty:0,trCommission:0,ydCommission:0,hologramCost:0});return businessHtml();}
  function render(){
    if(!visible())return;
    if(window.BLLicenseAtlasShell){
      const c=card();
      window.BLLicenseAtlasShell.render(S.host,{data:S.data,selected:S.selected,detail:c?detailHtml(c):'',locale:isEn()?'en':'tr',error:S.error,api,failMessage,action,reload:()=>load(),
        businessBegin,businessInput,businessAdd,businessView:businessHtml,businessDraft:()=>S.draft,businessCancel:()=>{S.editing=false;S.draft=null;S.conflict=false;},
        select:id=>{S.selected=id;S.draft=null;S.statsOpen=false;render();},selectOnly:id=>{if(!S.editing){S.selected=id;S.draft=null;}},
        accept:result=>{S.data=result;S.draft=null;S.editing=false;S.conflict=false;S.error='';window.BLLicenseDataBridge?.rulesChanged?.(result);},
        showError:message=>{S.error=message;render();},setLocale:locale=>{if(typeof applyLanguage==='function')applyLanguage(locale);},
      });
      bind();return;
    }
    const focus=document.activeElement,searchFocus=focus?.id==='lcSearch',selection=searchFocus?focus.selectionStart:null;
    const cards=(S.data?.cards||[]).filter(c=>`${c.license} ${c.licensor}`.toLocaleLowerCase(isEn()?'en':'tr').includes(S.query.toLocaleLowerCase(isEn()?'en':'tr')));
    const c=card();
    S.host.innerHTML=`<div class="lcPage"><div class="lcPageHead"><div><p>${esc(T('Sözleşmeler, lisansörler ve çalışma notları tek yerde.','Contracts, licensors and working notes in one place.'))}</p></div><div class="lcActions"><span class="lcMuted">${nf(S.data?.cards?.length||0,0)} ${esc(T('lisans kartı','license cards'))}</span><button type="button" class="tbtn" data-lc-action="exportAtlas" ${S.editing||S.saving?'disabled':''}>${esc(T('Üretici atlası oluştur','Create supplier atlas'))}</button>${S.data?.canEdit?`<button type="button" class="tbtn" data-lc-action="refresh" ${S.loading||S.editing?'disabled':''}>${esc(T('ASAS’tan yenile','Refresh from ASAS'))}</button>`:''}</div></div><div class="lcToolbar"><label class="lcSearch"><span class="lcSrOnly">${esc(T('Lisans veya lisansör ara','Search license or licensor'))}</span><input id="lcSearch" type="search" value="${esc(S.query)}" placeholder="${esc(T('Lisans veya lisansör ara…','Search license or licensor…'))}"></label><span class="lcMuted">${S.data?.lastImportedAt?`${esc(T('Son ASAS aktarımı:','Last ASAS import:'))} ${esc(new Date(S.data.lastImportedAt).toLocaleDateString(isEn()?'en-US':'tr-TR'))}`:esc(T('ASAS’tan bir kez alınır; yenileme isteğe bağlıdır.','Imported from ASAS once; refresh is optional.'))}</span></div>${S.data?.syncPending?`<div class="lcNotice" role="status">${esc(T('Kaydedildi; diğer kullanıcılara aktarım bekliyor. Yeniden gönderim otomatik denenir.','Saved; sharing with other users is pending. Sending is retried automatically.'))}</div>`:''}${S.error?`<div class="lcNotice" role="alert">${esc(S.error)}${!S.data?` <button class="tbtn" type="button" data-lc-action="retry">${esc(T('Yeniden dene','Retry'))}</button>`:''}</div>`:''}${S.loading?`<p role="status" class="lcMuted">${esc(T('Lisanslar yükleniyor…','Loading licenses…'))}</p>`:''}<div class="lcLayout${c?' hasDetail':''}"><div><div class="lcGrid">${cards.slice(0,S.limit).map(cardHtml).join('')}</div>${!cards.length&&!S.loading?`<div class="lcEmpty cardBox">${esc(S.query?T('Aramanızla eşleşen lisans yok.','No licenses match your search.'):T('Henüz lisans kartı bulunamadı. ASAS kaynağını kontrol edip yenileyin.','No license cards were found. Check the ASAS source and refresh.'))}</div>`:''}${cards.length>S.limit?`<button type="button" class="tbtn lcMore" data-lc-action="more">${esc(T('Daha fazla göster','Show more'))}</button>`:''}</div>${c?detailHtml(c):''}</div></div>`;
    bind();if(searchFocus){const input=document.getElementById('lcSearch');input.focus();input.setSelectionRange(selection,selection);}
  }
  function close(){if(S.saving)return;S.error='';S.selected='';S.draft=null;S.editing=false;S.conflict=false;S.statsOpen=false;render();}
  function bind(){
    S.host.querySelector('#lcSearch')?.addEventListener('input',e=>{S.query=e.target.value;S.limit=48;render();});
    S.host.querySelectorAll('[data-lc-open]').forEach(el=>el.addEventListener('click',()=>{
      if(S.saving||S.editing)return;
      S.selected=el.dataset.lcOpen;S.draft=null;S.statsOpen=false;S.statsKey='';render();
      S.host.querySelector('.lcDetail h2')?.scrollIntoView({block:'nearest'});
    }));
    S.host.querySelectorAll('[data-lc-action]').forEach(el=>el.addEventListener('click',()=>action(el.dataset.lcAction)));
    if(!window.BLLicenseAtlasShell&&card()&&S.draft)window.BLLicenseAtlas?.bind(S.host,{card:card(),get:()=>S.draft.profile.processAtlas,set:value=>{S.draft.profile.processAtlas=value;},editing:S.editing&&!S.saving,render,api,error:message=>{S.error=message;render();}});
    const form=S.host.querySelector('#lcCardForm');
    form?.addEventListener('input',e=>{
      if(!S.editing||S.saving)return;
      const target=e.target;
      if(profileFields.includes(target.name))S.draft.profile[target.name]=target.value;
      if(target.dataset.lcRule!=null){const r=S.draft.rules[Number(target.dataset.lcRule)],k=target.dataset.lcKey;if(r)r[k]=k==='seasons'?target.value.split(',').map(x=>x.trim()).filter(Boolean):['royalty','trCommission','ydCommission','hologramCost'].includes(k)?(target.value===''?null:Number(target.value)):target.value;}
    });
    form?.addEventListener('submit',e=>{e.preventDefault();save();});
    S.host.querySelector('#lcSymbolFile')?.addEventListener('change',uploadSymbol);
    S.host.querySelector('#lcStatsDetail')?.addEventListener('toggle',e=>{
      S.statsOpen=e.target.open;if(!S.statsOpen)return;
      const content=S.host.querySelector('#lcStatsContent');if(content&&card())content.innerHTML=statsHtml(card());
    });
  }
  function action(name){
    if(name==='importAtlas'&&S.editing&&!S.saving&&window.BLLicenseAtlas?.importDialog)return window.BLLicenseAtlas.importDialog({card:card(),api,get:()=>S.draft.profile.processAtlas,set:value=>{S.draft.profile.processAtlas=value;},render});
    if(name==='close'&&S.editing&&!S.saving&&!confirm(T('Kaydedilmemiş ticari değişiklikler bırakılsın mı?','Discard unsaved commercial changes?')))return;

    if((name==='exportAtlas'||name==='exportSelectedAtlas')&&!S.editing&&!S.saving&&window.BLLicenseAtlasShell)return window.BLLicenseAtlasShell.exportSupplier(name==='exportSelectedAtlas'?S.selected:'');
    if((name==='exportAtlas'||name==='exportSelectedAtlas')&&!S.editing&&!S.saving)return window.BLLicenseAtlas?.exportDialog(S.data?.cards||[],name==='exportSelectedAtlas'?S.selected:'');
    if(name==='refresh'&&!S.editing&&S.data?.canEdit)return load(true);
    if(name==='retry')return load();
    if(name==='more'){S.limit+=48;return render();}
    if(name==='close')return close();
    if(name==='edit'&&S.data?.canEdit&&!S.saving&&!S.loading&&card()){S.draft=makeDraft(card());S.editing=true;S.conflict=false;S.error='';return render();}
    if(name==='cancel'&&!S.saving){S.editing=false;S.conflict=false;S.draft=card()?makeDraft(card()):null;S.error='';if(S.stale)return load();return render();}
    if(name==='reload'&&!S.saving){S.editing=false;S.draft=null;S.error='';return load();}
    if(name==='add'&&S.editing&&!S.saving&&card()?.licensor){const c=card();S.draft.rules.push({id:`license-rule-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,license:c.license,licensor:c.licensor,opdStart:E.today(),opdEnd:'',seasons:[],royalty:0,trCommission:0,ydCommission:0,hologramCost:0});render();}
  }
  async function uploadSymbol(e){
    const draft=S.draft,f=e.target.files?.[0];if(!f||!S.editing||S.saving||!draft)return;
    if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>256*1024){S.error=T('Sembol PNG, JPEG veya WebP olmalı ve 256 KB’ı aşmamalı.','The symbol must be PNG, JPEG or WebP and no larger than 256 KB.');render();return;}
    try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});if(S.draft!==draft||!S.editing||S.saving)return;if(!E.symbolUrl(data))throw new Error();S.draft.profile.symbolDataUrl=data;S.error='';render();}
    catch(_){if(S.draft!==draft||!S.editing||S.saving)return;S.error=T('Sembol dosyası okunamadı.','The symbol file could not be read.');render();}
  }
  async function save(){
    if(!S.editing||S.saving||S.conflict||!S.data?.canEdit)return;
    S.saving=true;S.error='';render();
    try{
      if(S.pending)await S.pending;
      if(S.conflict)return;
      const body={editToken:S.draft.editToken,revision:S.draft.revision,pricingRevision:S.draft.pricingRevision,profile:S.draft.profile};
      if(JSON.stringify(S.draft.rules)!==JSON.stringify(S.draft.baseCard.rules||[]))body.rules=S.draft.rules;
      const result=await api(`/api/license-cards/${encodeURIComponent(S.selected)}`,{method:'PUT',body:JSON.stringify(body)});
      if(result.cards)S.data=result;else S.stale=true;
      S.editing=false;S.draft=null;S.conflict=false;
      await window.BLLicenseDataBridge?.rulesChanged?.(result);
    }catch(e){S.error=failMessage(e);if(e.status===409)S.conflict=true;}
    finally{S.saving=false;if(S.stale&&!S.conflict)await load();render();}
  }
  window.initLicenseCardsPage=()=>{
    S.host=document.getElementById('licenseCardsPage');if(!visible())return;
    if(!S.data||S.stale&&!S.editing)return load();render();
  };
  window.BLLicenseCardsPage={
    invalidate(){S.stale=true;S.statsKey='';if(!S.saving&&visible())return load();},
    renderLanguage(){render();},
  };
})();
