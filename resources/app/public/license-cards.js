/* Buyer Log — License cards (list view).
   One row per card (license × licensor; several licensors never merge). Royalty,
   commissions and hologram of the row's contract are edited in place; a compact
   dialog holds the selected contract, optional history, contact details and image. Rows are selected
   for the supplier atlas; the approval map opens in BLLicenseMapEditor.
   Drafts are per card and guarded by the card's editToken: background refreshes never
   discard a draft, and only a verified change to that card blocks its save. */
(() => {
  'use strict';
  const E=window.BLLicenseCardsEngine;
  if(!E)return;
  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,en)=>isEn()?en:tr;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=v=>JSON.parse(JSON.stringify(v));
  const locale=()=>isEn()?'en-US':'tr-TR';
  const nf=(n,d=2)=>new Intl.NumberFormat(locale(),{maximumFractionDigits:d}).format(n);
  const PROFILE=['contactName','contactEmail','portalUrl','portalUsername','accessReference','workingNotes','artworkBrief'];
  // BLStorage scopes this existing favorites namespace to the signed-in account
  // and synchronizes it through /api/user-preferences, never the shared card store.
  const FAVORITES_KEY='buyerlog.favorites.licenseCards.v1';
  const S={host:null,data:null,pending:null,loading:false,stale:false,error:'',loadError:null,query:'',licensor:null,status:'all',sort:{key:'license',dir:'asc'},
    selected:new Set(),favorites:new Set(),favoritesOnly:false,expanded:'',historyOpen:false,addLicensorOpen:false,drafts:new Map(),renderQueued:false,animate:true,flash:new Set(),exporting:false,stats:new Map(),writes:0,mapBase:null};
  const visible=()=>S.host&&S.host.getClientRects().length>0;
  const cardOf=id=>S.data?.cards?.find(c=>c.id===id)||null;
  const canEdit=()=>Boolean(S.data?.canEdit);

  function readFavorites(){
    try{const ids=JSON.parse(window.BLStorage?.getItem(FAVORITES_KEY)||'[]');S.favorites=new Set(Array.isArray(ids)?ids.filter(id=>typeof id==='string'):[]);}
    catch(_){S.favorites=new Set();}
  }
  const rowIds=row=>[row.id,...(row.merged||[]).map(c=>c.id)];
  const isFavorite=row=>rowIds(row).some(id=>S.favorites.has(id));
  const allRows=()=>E.rows(S.data?.cards||[],mergeOpts());
  async function toggleFavorite(id){
    // Merge with the account's hydrated list even if the first click arrives
    // before startup hydration completes on a browser with an empty cache.
    if(typeof hydrateUserPreferencesAfterUi==='function')await hydrateUserPreferencesAfterUi();
    readFavorites();
    const row=allRows().find(r=>r.id===id);if(!row)return;
    const next=new Set(S.favorites);
    if(isFavorite(row))for(const key of rowIds(row))next.delete(key);else next.add(row.id);
    try{
      if(!window.BLStorage?.setItem)throw new Error('PREFERENCE_STORAGE_UNAVAILABLE');
      window.BLStorage.setItem(FAVORITES_KEY,JSON.stringify([...next]));
    }catch(_){toast(T('Favoriler kaydedilemedi. Yeniden deneyin.','Favorites could not be saved. Please retry.'),'warning');return;}
    render();
    S.host.querySelector(`[data-lc-act="favorite"][data-id="${CSS.escape(id)}"]`)?.focus();
  }
  async function selectFavorites(){
    if(typeof hydrateUserPreferencesAfterUi==='function')await hydrateUserPreferencesAfterUi();
    readFavorites();for(const row of allRows().filter(isFavorite))S.selected.add(row.id);render();
  }

  function failMessage(error){
    if(error?.code==='REVISION_CONFLICT'&&S.templateWrite)return T('Taslak başka yerde değişti. Taslaklar yenilendi; yeniden açıp uygulayın.','The template changed elsewhere. Templates were refreshed; reopen it and reapply.');
    if(error?.status===409&&!/^LICENSE_(LICENSOR|TEMPLATE)_/.test(error?.code||''))return T('Bu kart siz düzenlerken değişti. Değişiklikleriniz korunuyor; güncel kaydı açıp yeniden uygulayın.','This card changed while you were editing. Your edits are kept; open the current record and reapply them.');
    if(error?.status===403)return T('Bu kartı değiştirme yetkiniz yok.','You do not have permission to edit this card.');
    if(error?.code==='LICENSE_RULE_OVERLAP')return T('Sözleşmeler aynı OPD aralığı ve sezonda çakışıyor. Önceki dönemi yeni dönemden önce bitirin.','Contracts overlap for the same OPD range and season. End the previous period before the next one starts.');
    if(error?.code==='LICENSE_RULE_DATE'||error?.code==='LICENSE_RULES_INVALID')return T('Sözleşme tarihlerini ve oranlarını kontrol edin. Royalty ile komisyon toplamı %100’ü aşamaz.','Check contract dates and rates. Royalty plus commission cannot exceed 100%.');
    if(error?.code==='LICENSE_SOURCE_UNAVAILABLE')return T('ASAS verisi hazır değil. Önce CP veya Orders verisini yükleyin, sonra yeniden deneyin.','ASAS data is not ready. Load CP or Orders data first, then retry.');
    if(error?.code==='OFFICE_PREVIEW_CHANGED')return T('ASAS verisi yenileme sırasında değişti; yeniden deneyin.','ASAS data changed during the refresh; retry.');
    if(error?.code==='LICENSE_CARD_EXISTS')return T('Bu lisans kartı zaten var.','This license card already exists.');
    if(error?.code==='LICENSE_CARD_INVALID')return T('Lisans adı girin; adlar en fazla 200 karakter olabilir.','Enter a license name; names may contain up to 200 characters.');
    if(error?.code==='LICENSE_LICENSOR_EXISTS')return T('Bu lisans için bu lisansörün satırı zaten var.','This license already has a row for this licensor.');
    if(error?.code==='LICENSE_LICENSOR_LOCKED')return T('Lisansörü olan satır değiştirilemez; diğer lisansör için yeni satır ekleyin.','A row that has a licensor cannot be renamed; add a row for the other licensor.');
    if(error?.code==='LICENSE_LICENSOR_INVALID')return T('Geçerli bir lisansör adı girin (en fazla 200 karakter).','Enter a valid licensor name (max 200 characters).');
    if(error?.code==='LICENSE_TEMPLATE_NAME')return T('Bu adla bir aşama taslağı zaten var.','A stage template with this name already exists.');
    if(error?.code==='LICENSE_TEMPLATE_LIMIT')return T('En fazla 60 aşama taslağı tutulabilir.','Up to 60 stage templates are kept.');
    if(error?.code==='LICENSE_TEMPLATE_INVALID')return T('Taslak geçersiz veya 2 MB sınırını aşıyor.','The template is invalid or exceeds 2 MB.');
    if(error?.code==='LICENSE_TEMPLATE_NOT_FOUND')return T('Aşama taslağı bulunamadı; liste yenilendi.','Stage template not found; the list was refreshed.');
    if(error?.code==='LICENSE_PORTAL_INVALID')return T('Portal adresi http:// veya https:// ile başlamalı ve parola içermemeli.','The portal URL must start with http:// or https:// and contain no credentials.');
    if(error?.code==='LICENSE_ATLAS_INVALID')return T('Harita veya görsel geçersiz ya da 2 MB sınırını aşıyor.','The map or image is invalid or exceeds 2 MB.');
    if(error?.code==='LICENSE_PROFILE_INVALID')return T('Bir kart alanı çok uzun veya geçersiz.','A card field is too long or invalid.');
    return T('İşlem tamamlanamadı. Bağlantıyı kontrol edip yeniden deneyin.','The operation could not be completed. Check your connection and retry.');
  }
  const RATE_ERRORS={royalty:['Royalty 0–100 arasında olmalı.','Royalty must be between 0 and 100.'],'commission-missing':['TR veya YD komisyonundan en az biri girilmeli.','Enter at least the TR or international commission.'],commission:['Komisyon 0–100 olmalı; royalty ile toplamı %100’ü aşamaz.','Commission must be 0–100 and with royalty cannot exceed 100%.'],hologram:['Hologram tutarı 0 veya daha büyük olmalı.','Hologram cost must be 0 or more.'],date:['OPD bitişi başlangıçtan önce olamaz.','OPD end cannot be before its start.']};
  async function api(url,options={}){
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(window.BL_CLIENT_ID?{'X-Client-Id':window.BL_CLIENT_ID}:{}),...(options.headers||{})}});
    const data=await r.json().catch(()=>({}));
    if(!r.ok){const e=new Error(data.error||r.statusText);e.status=r.status;e.code=data.code;throw e;}
    return data;
  }
  // A write response is newer than any list request already in flight; load() drops such a reply.
  function accept(result){if(!result?.cards)return false;S.data=result;S.writes++;return true;}
  function toast(message,kind){if(typeof showToast==='function')showToast(message,kind?{kind}:undefined);else{S.error=message;render();}}

  /* ---------- drafts ---------- */
  function profileOf(card){return Object.fromEntries(PROFILE.map(k=>[k,card[k]||'']));}
  function ensureDraft(id){
    let d=S.drafts.get(id);if(d)return d;
    const c=cardOf(id);if(!c)return null;
    d={editToken:c.editToken,snapshot:copy(c),rules:copy(c.rules||[]),profile:profileOf(c),cover:undefined,primaryId:E.primaryContract(c.rules).rule?.id||'',conflict:false,saving:false,error:'',note:'',deletedRuleIds:[],periods:{},newRuleBaselines:{}};
    S.drafts.set(id,d);return d;
  }
  function changedRules(d){
    const base=new Map((d.snapshot.rules||[]).map(r=>[r.id,JSON.stringify(r)]));
    return d.rules.filter(r=>base.get(r.id)!==JSON.stringify(r));
  }
  function changedProfile(d){return Object.fromEntries(PROFILE.filter(k=>(d.profile[k]||'')!==(d.snapshot[k]||'')).map(k=>[k,d.profile[k]]));}
  // Everything editToken covers except the map (server: license-cards.js editToken).
  const guarded=c=>JSON.stringify([c.licensor||'',c.symbolDataUrl||'',profileOf(c),c.rules||[]]);
  const isDirty=d=>Boolean(d&&(d.deletedRuleIds?.length||changedRules(d).length||Object.keys(changedProfile(d)).length||d.cover!==undefined));
  function dropDraft(id){S.drafts.delete(id);}
  function ruleOf(d,id){return d.rules.find(r=>r.id===id);}

  /* ---------- loading ---------- */
  // A refresh asked for while another load runs is queued, never dropped.
  async function load(refresh=false){
    if(refresh)S.refreshNext=true;
    if(S.pending)return S.pending;
    S.loading=true;S.loadError=null;S.refreshing=S.refreshNext;render();
    S.pending=(async()=>{
      try{
        do{
          S.stale=false;refresh=S.refreshNext;S.refreshNext=false;S.refreshing=refresh;
          let data;const writes=S.writes;
          try{data=await api(refresh?'/api/license-cards/refresh':'/api/license-cards',refresh?{method:'POST'}:{});}
          catch(e){if(refresh)toast(failMessage(e),'warning');throw e;}
          if(refresh)toast(...refreshMessage(data));
          // The list was read before one of our own saves answered: it would bring back the old card.
          if(writes!==S.writes){S.stale=true;continue;}
          for(const [id,d] of S.drafts){
            const current=data.cards?.find(c=>c.id===id);
            // Notifications (polling, reconnect, our own echo) are hints; only the card's
            // verified token decides whether its draft is stale.
            if(!current||current.editToken!==d.editToken)d.conflict=true;
          }
          S.data=data;S.error='';S.loadError=null;S.loadErrorRefresh=false;S.stats.clear();
          await window.BLLicenseDataBridge?.rulesChanged?.(data);
        }while((S.stale||S.refreshNext)&&![...S.drafts.values()].some(d=>d.saving));
      }catch(e){S.stale=true;S.loadError=e;S.loadErrorRefresh=Boolean(refresh);}
      finally{S.loading=false;S.refreshing=false;S.pending=null;render();}
    })();
    return S.pending;
  }

  function refreshMessage(data){
    const added=Number(data.added)||0,resolved=Number(data.resolved)||0,found=Number(data.discovered)||0;
    if(added||resolved)return [T(`ASAS’tan yenilendi: ${added} yeni satır, ${resolved} lisansör tamamlandı.`,`Refreshed from ASAS: ${added} new rows, ${resolved} licensors completed.`),'success'];
    if(!found)return [T('ASAS verisinde lisans bulunamadı. CP veya Orders verisini yükleyip yeniden deneyin.','No licenses were found in the ASAS data. Load CP or Orders data and retry.'),'warning'];
    return [T(`ASAS’tan yenilendi; ${found} lisans × lisansör tarandı, yeni kayıt yok.`,`Refreshed from ASAS; ${found} license × licensor pairs checked, nothing new.`),'info'];
  }

  /* ---------- rendering ---------- */
  const fmtRate=v=>v==null||v===''||!Number.isFinite(Number(v))?'':String(Number(v));
  function statusBadge(status){
    const map={active:['Güncel','Current','isOk'],future:['Planlanan','Upcoming','isInfo'],expired:['Geçmiş','Past','isMuted'],invalid:['Geçersiz','Invalid','isWarn'],none:['Sözleşme yok','No contract','isWarn']};
    const [tr,en,cls]=map[status]||map.none;return `<span class="lcBadge ${cls}">${esc(T(tr,en))}</span>`;
  }
  const range=r=>`${r?.opdStart||'−∞'} → ${r?.opdEnd||'+∞'}`;
  const seasons=r=>{const s=Array.isArray(r?.seasons)?r.seasons:(r?.season?[r.season]:[]);return s.length?s.slice().sort(window.BLBusinessRules.compareSeasonNumberThenLetter).join(', '):T('Tüm sezonlar','All seasons');};
  const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
  function thumb(row,d){
    const cover=d&&d.cover!==undefined?d.cover:row.image;
    return `<span class="lcThumb">${cover?`<img src="${esc(cover)}" alt="">`:`<span data-no-i18n>${esc(initials(row.license))}</span>`}</span>`;
  }
  const APPROVER={LCW:['LCW','LCW'],licensor:['Lisansör','Licensor'],mixed:['LCW + Lisansör','LCW + Licensor'],agency:['Acente','Agency'],unknown:['Teyit edilecek','To be confirmed']};
  function miniMap(row){
    if(!row.map.length)return `<span class="lcMapEmpty">${esc(T('Harita yok','No map'))}</span>`;
    const tip=row.map.map(s=>`${s.index}. ${s.title||'—'} · ${T(...APPROVER[s.approver])}${s.test?' · Test':''}`).join('\n');
    const dots=row.map.slice(0,8).map(s=>`<i class="lcStep ap-${esc(s.approver)}${s.test?' isTest':''}"></i>`).join('');
    return `<span class="lcMini" title="${esc(tip)}">${dots}${row.map.length>8?`<em>+${row.map.length-8}</em>`:''}<b>${row.map.length} ${esc(T('adım','steps'))}</b></span>`;
  }
  function rateCell(row,d,key,suffix){
    const rule=d?ruleOf(d,d.primaryId):row.primary.rule,value=rule?fmtRate(rule[key]):'';
    const disabled=!rule||!canEdit()||d?.saving||d?.conflict;
    return `<label class="lcRateCell"><input class="lcRate" data-lc-rate="${key}" data-id="${esc(row.id)}" inputmode="decimal" value="${esc(value)}" placeholder="${rule?'—':''}" aria-label="${esc(row.license)} ${esc(key)}" ${disabled?'disabled':''}><span>${suffix}</span></label>`;
  }
  function licensorList(){return `<datalist id="lcLicensorList">${E.licensorOptions(S.data?.cards||[]).filter(o=>o.value).map(o=>`<option value="${esc(o.label)}"></option>`).join('')}</datalist>`;}
  // An empty licensor is filled in place; a licensor that is set never changes (peers key
  // a card by license × licensor) — another licensor gets its own row from the details.
  const mergeOpts=()=>({merges:S.data?.licensorMerges||{split:[]},mergeKey:window.BLBusinessRules?.licensorMergeKey||null,groupKey:window.BLBusinessRules?.licensorGroupKey||null});
  function licensorCell(row){
    if(row.licensor&&row.merged?.length){
      const names=row.merged.map(c=>c.licensor).join(', ');
      return `<span class="lcLicensor lcMergedCell" title="${esc(T(`Birleştirildi: ${row.licensor} + ${names}`,`Merged: ${row.licensor} + ${names}`))}"><span>${esc(row.licensor)}</span><button type="button" class="lcMergeChip" data-lc-act="merges" data-key="${esc(row.mergeKey)}" aria-label="${esc(T('Lisansör birleştirmelerini göster','Show licensor merges'))}"><svg class="ic"><use href="#i-hierarchy"/></svg>+${row.merged.length}</button></span>`;
    }
    if(row.licensor)return `<span class="lcLicensor" title="${esc(row.licensor)}">${esc(row.licensor)}</span>`;
    if(!canEdit()||!row.card||S.drafts.get(row.id)?.conflict)return `<span class="lcLicensor"><span class="lcWarn">${esc(T('Lisansör yok','No licensor'))}</span></span>`;
    return `<label class="lcLicensor lcLicensorEdit${S.assigning===row.id?' isBusy':''}"><input class="lcLicensorInput" data-lc-licensor="${esc(row.id)}" list="lcLicensorList" maxlength="200" placeholder="${esc(T('Lisansör yazın…','Type licensor…'))}" aria-label="${esc(row.license)} ${esc(T('lisansör','licensor'))}" ${S.assigning?'disabled':''}></label>`;
  }
  // Copy a row's approval map and paste it onto other rows without opening the editor.
  function mapClipTools(row){
    const copyBtn=row.map.length?`<button type="button" class="lcIconBtn lcClipCopy${S.clip?.id===row.id?' isOn':''}" data-lc-act="copyMap" data-id="${esc(row.id)}" title="${esc(T('Haritayı kopyala','Copy map'))}" aria-label="${esc(T('Haritayı kopyala','Copy map'))}"><svg class="ic"><use href="#i-copy"/></svg></button>`:'';
    const pasteBtn=S.clip&&S.clip.id!==row.id&&canEdit()?`<button type="button" class="lcIconBtn lcClipPaste" data-lc-act="pasteMap" data-id="${esc(row.id)}" title="${esc(T(`“${S.clip.license}” haritasını yapıştır`,`Paste the “${S.clip.license}” map`))}" aria-label="${esc(T('Haritayı yapıştır','Paste map'))}" ${S.pasting?'disabled':''}><svg class="ic"><use href="#i-copy-plus"/></svg></button>`:'';
    return copyBtn||pasteBtn?`<span class="lcClip">${copyBtn}${pasteBtn}</span>`:'';
  }
  function rowHtml(row,i){
    const d=S.drafts.get(row.id),dirty=isDirty(d),rule=d?ruleOf(d,d.primaryId):row.primary.rule,status=rule?E.ruleStatus(rule,E.today()):'none';
    const open=S.expanded===row.id,cls=['lcRow',open?'isOpen':'',dirty?'isDirty':'',d?.conflict?'isConflict':'',S.flash.has(row.id)?'isSaved':'',S.selected.has(row.id)?'isSelected':''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-row="${esc(row.id)}" style="--i:${Math.min(i,24)}">
      <span class="lcPick"><label class="lcCheck"><input type="checkbox" data-lc-select="${esc(row.id)}" ${S.selected.has(row.id)?'checked':''} aria-label="${esc(T('Üretici atlası için seç','Select for supplier atlas'))}"></label><button type="button" class="lcIconBtn lcFavorite" data-lc-act="favorite" data-id="${esc(row.id)}" aria-pressed="${isFavorite(row)}" title="${esc(T(isFavorite(row)?'Favorilerimden çıkar':'Favorilerime ekle',isFavorite(row)?'Remove from my favorites':'Add to my favorites'))}" aria-label="${esc(row.license+' · '+(row.licensor||'—')+' — '+T(isFavorite(row)?'Favorilerimden çıkar':'Favorilerime ekle',isFavorite(row)?'Remove from my favorites':'Add to my favorites'))}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg></button></span>
      ${thumb(row,d)}
      <button type="button" class="lcName" aria-haspopup="dialog" data-lc-act="expand" data-id="${esc(row.id)}" aria-expanded="${open}"><b data-no-i18n>${esc(row.license)}</b><small data-no-i18n>${esc(seasons(rule))} · ${esc(rule?.categories?.join(', ')||T('Tüm kategoriler','All categories'))}</small></button>
      ${licensorCell(row)}
      ${rateCell(row,d,'royalty','%')}${rateCell(row,d,'trCommission','%')}${rateCell(row,d,'ydCommission','%')}${rateCell(row,d,'hologramCost','$')}
      <span class="lcPeriod">${rule?`${statusBadge(status)}<small>${esc(range(rule))}${row.primary.extraActive?` · +${row.primary.extraActive} ${esc(T('kapsam','scopes'))}`:''}</small>`:(canEdit()&&row.licensor?`<button type="button" class="lcBtn sm" data-lc-act="addContract" data-id="${esc(row.id)}"><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Sözleşme ekle','Add contract'))}</button>`:statusBadge('none'))}</span>
      <span class="lcMapWrap${S.clip?' hasClip':''}"><button type="button" class="lcMapCell" data-lc-act="map" data-id="${esc(row.id)}" title="${esc(T('Onay haritasını aç','Open approval map'))}">${miniMap(row)}</button>${mapClipTools(row)}</span>
      <span class="lcRowTools">
        <span class="lcRowSave"><button type="button" class="lcIconBtn isPrimary" data-lc-act="save" data-id="${esc(row.id)}" title="${esc(T('Kaydet (Enter)','Save (Enter)'))}" ${d?.saving||d?.conflict?'disabled':''}><svg class="ic"><use href="#i-check"/></svg></button><button type="button" class="lcIconBtn" data-lc-act="discard" data-id="${esc(row.id)}" title="${esc(T('Geri al (Esc)','Revert (Esc)'))}"><svg class="ic"><use href="#i-arrow-back-up"/></svg></button></span>
        <button type="button" class="lcIconBtn" data-lc-act="map" data-id="${esc(row.id)}" title="${esc(T('Haritayı düzenle','Edit map'))}"><svg class="ic"><use href="#i-binary-tree-2"/></svg></button>
        <button type="button" class="lcIconBtn lcExpand" aria-haspopup="dialog" data-lc-act="expand" data-id="${esc(row.id)}" aria-expanded="${open}" title="${esc(T('Kartı düzenle','Edit card'))}" aria-label="${esc(T('Kartı düzenle','Edit card'))}"><svg class="ic"><use href="#i-edit"/></svg></button>
      </span>
      ${d?.error||d?.conflict?`<div class="lcRowMsg" role="alert">${esc(d.conflict?T('Kayıt başka yerde değişti; değişiklikleriniz korunuyor.','The record changed elsewhere; your edits are kept.'):d.error)}${d.conflict?` <button type="button" class="lcLink" data-lc-act="reopen" data-id="${esc(row.id)}">${esc(T('Güncel kaydı aç','Open current record'))}</button>`:''}</div>`:''}
    </div>`;
  }
  function contractRow(card,d,r){
    const id=esc(r.id),dis=!canEdit()||d?.saving||d?.conflict?'disabled':'',status=E.ruleStatus(r,E.today());
    const num=(k,suffix)=>`<label class="lcRateCell"><input class="lcRate" data-lc-rule="${id}" data-lc-key="${k}" data-id="${esc(card.id)}" inputmode="decimal" value="${esc(fmtRate(r[k]))}" ${dis}><span>${suffix}</span></label>`;
    return `<div class="lcContract${status==='active'?' isActive':''}">${statusBadge(status)}
      <input type="date" data-lc-rule="${id}" data-lc-key="opdStart" data-id="${esc(card.id)}" value="${esc(r.opdStart||'')}" aria-label="${esc(T('OPD başlangıç','OPD start'))}" ${dis}>
      <input type="date" data-lc-rule="${id}" data-lc-key="opdEnd" data-id="${esc(card.id)}" value="${esc(r.opdEnd||'')}" aria-label="${esc(T('OPD bitiş','OPD end'))}" ${dis}>
      <input data-lc-rule="${id}" data-lc-key="seasons" data-id="${esc(card.id)}" value="${esc((Array.isArray(r.seasons)?r.seasons:[]).join(', '))}" placeholder="${esc(T('Tüm sezonlar','All seasons'))}" aria-label="${esc(T('Sezonlar','Seasons'))}" ${dis}>
      <input data-lc-rule="${id}" data-lc-key="categories" data-id="${esc(card.id)}" value="${esc((r.categories||[]).join(', '))}" placeholder="${esc(T('Tüm kategoriler','All categories'))}" aria-label="${esc(T('Kategoriler (virgülle ayırın)','Categories (comma separated)'))}" ${dis}>
      ${num('royalty','%')}${num('trCommission','%')}${num('ydCommission','%')}${num('hologramCost','$')}
      <span class="lcInline"><small title="${esc(T('Eşleşen CP satırları','Matched CP rows'))}">${window.BLLicenseDataBridge?.matches?.(r)||0}</small><button type="button" class="lcBtn sm" data-lc-act="checkRule" data-rule-id="${id}">${esc(T('Hesapla','Calculate'))}</button>${canEdit()&&!d?.conflict?`<button type="button" class="lcBtn sm" data-lc-act="applyRule" data-id="${esc(card.id)}" data-rule-id="${id}" ${dis}>${esc(T('Uygula','Apply'))}</button><button type="button" class="lcIconBtn" data-lc-act="deleteRule" data-id="${esc(card.id)}" data-rule-id="${id}" title="${esc(T('Sözleşmeyi sil','Delete contract'))}" ${dis}><svg class="ic"><use href="#i-trash"/></svg></button>`:''}</span></div>`;
  }
  function statsHtml(card){
    const loaded=window.BLLicenseDataBridge?.loadedRows?.();if(!loaded)return '';
    const key=`${card.id}|${loaded.module}|${loaded.version}`;
    if(!S.stats.has(key))S.stats.set(key,E.statistics(loaded.rows,card,loaded.module,window.BLCanonicalFields));
    const st=S.stats.get(key);
    return `<div class="lcStats"><span><b>${nf(st.orders,0)}</b>${esc(T('sipariş','orders'))}</span><span><b>${nf(st.quantity,0)}</b>${esc(T('adet','units'))}</span><span><b>${nf(st.lines,0)}</b>${esc(T('satır','lines'))}</span></div><small class="lcMuted">${esc(st.module==='cp'?T('Yüklenmiş CP verisi.','Loaded CP data.'):T('Yüklenmiş Orders verisi.','Loaded Orders data.'))}</small>`;
  }
  function editorContract(card,d,r){
    const dis=!canEdit()||d?.saving||d?.conflict?'disabled':'',id=esc(r.id),cid=esc(card.id);
    const field=(key,label,value,type='text',placeholder='')=>`<label class="lcField"><span>${esc(label)}</span><input type="${type}" data-lc-rule="${id}" data-lc-key="${key}" data-id="${cid}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${dis}></label>`;
    const rate=(key,label,suffix)=>`<div class="lcField"><span>${esc(label)}</span><label class="lcRateCell"><input class="lcRate" data-lc-rule="${id}" data-lc-key="${key}" data-id="${cid}" inputmode="decimal" value="${esc(fmtRate(r[key]))}" aria-label="${esc(label)}" ${dis}><span>${suffix}</span></label></div>`;
    return `<div class="lcContract lcEditorContract"><div class="lcContractTools">${statusBadge(E.ruleStatus(r,E.today()))}<span class="lcSpacer"></span><button type="button" class="lcBtn sm" data-lc-act="checkRule" data-rule-id="${id}">${esc(T('Hesapla','Calculate'))}</button>${canEdit()&&!d?.conflict?`<button type="button" class="lcBtn sm" data-lc-act="applyRule" data-id="${cid}" data-rule-id="${id}" ${dis}>${esc(T('Uygula','Apply'))}</button><button type="button" class="lcIconBtn" data-lc-act="deleteRule" data-id="${cid}" data-rule-id="${id}" title="${esc(T('Sözleşmeyi sil','Delete contract'))}" aria-label="${esc(T('Sözleşmeyi sil','Delete contract'))}" ${dis}><svg class="ic"><use href="#i-trash"/></svg></button>`:''}</div>
      ${field('opdStart',T('OPD başlangıç','OPD start'),r.opdStart||'','date')}${field('opdEnd',T('OPD bitiş','OPD end'),r.opdEnd||'','date')}${field('seasons',T('Sezonlar','Seasons'),(r.seasons||[]).join(', '),'text',T('Tüm sezonlar','All seasons'))}${field('categories',T('Kategoriler','Categories'),(r.categories||[]).join(', '),'text',T('Tüm kategoriler','All categories'))}
      ${rate('royalty','Royalty','%')}${rate('trCommission',T('TR kom.','TR comm.'),'%')}${rate('ydCommission',T('YD kom.','Intl comm.'),'%')}${rate('hologramCost','Hologram','$')}</div>`;
  }
  // Closing keeps pending card edits; Cancel explicitly discards them.
  function closeEditor(){
    const id=S.expanded;S.expanded='';S.historyOpen=false;S.addLicensorOpen=false;
    document.activeElement?.blur?.();render();
    S.host.querySelector(`[data-row="${CSS.escape(id)}"] .lcName`)?.focus?.({preventScroll:true});
  }
  function detailHtml(row,d){
    const card=row.card,rules=(d?d.rules:card.rules)||[],profile=d?d.profile:profileOf(card),dis=!canEdit()||d?.saving||d?.conflict?'disabled':'';
    const primary=rules.find(r=>r.id===d?.primaryId)||E.primaryContract(rules).rule;
    const sorted=[...rules].sort((a,b)=>String(b.opdStart||'').localeCompare(String(a.opdStart||'')));
    const others=sorted.filter(r=>r.id!==primary?.id),historyCount=others.length+(row.merged||[]).reduce((n,m)=>n+(m.rules||[]).length,0);
    const input=(k,label,type='text',max=200)=>`<label class="lcField"><span>${esc(label)}</span><input type="${type}" data-lc-profile="${k}" data-id="${esc(card.id)}" value="${esc(profile[k]||'')}" maxlength="${max}" ${dis}></label>`;
    const area=(k,label,max)=>`<label class="lcField lcWide"><span>${esc(label)}</span><textarea rows="2" data-lc-profile="${k}" data-id="${esc(card.id)}" maxlength="${max}" ${dis}>${esc(profile[k]||'')}</textarea></label>`;
    const cover=d&&d.cover!==undefined?d.cover:row.image,portal=E.portalHref(profile.portalUrl);
    return `<dialog class="lcEditor lcDetail" data-detail="${esc(card.id)}" aria-labelledby="lcEditorTitle">
      <header class="lcEditorHead"><div><small>${esc(T('Lisans kartı','License card'))}</small><h2 id="lcEditorTitle" data-no-i18n>${esc(card.license)}</h2><span data-no-i18n>${esc(card.licensor||T('Lisansör yok','No licensor'))}</span></div><button type="button" class="lcIconBtn" data-lc-act="closeEditor" aria-label="${esc(T('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>
      ${d?.error||d?.conflict?`<div class="lcNotice" role="alert">${esc(d.conflict?T('Kayıt başka yerde değişti; değişiklikleriniz korunuyor.','The record changed elsewhere; your edits are kept.'):d.error)}${d.conflict?`<button type="button" class="lcBtn sm" data-lc-act="reopen" data-id="${esc(card.id)}">${esc(T('Güncel kaydı aç','Open current record'))}</button>`:''}</div>`:''}
      <div class="lcDetailIn">
      <section class="lcPane lcPaneWide"><header><b>${esc(T('Seçili sözleşme','Selected contract'))}</b><span class="lcSpacer"></span>${canEdit()&&card.licensor?`<button type="button" class="lcBtn sm" data-lc-act="addPeriod" data-id="${esc(card.id)}" ${dis}><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Yeni dönem','New period'))}</button><button type="button" class="lcBtn sm" data-lc-act="addCategory" data-id="${esc(card.id)}" ${dis}>${esc(T('Kategori oranı ekle','Add category rates'))}</button>`:''}</header>
        ${d?.note?`<p class="lcNote" role="status">${esc(d.note)}</p>`:''}
        ${primary?editorContract(card,d,primary):''}
        ${historyCount?`<button type="button" class="lcBtn sm lcHistoryToggle" data-lc-act="history" aria-expanded="${S.historyOpen}" aria-controls="lcContractHistory">${esc(S.historyOpen?T('Geçmişi ve diğer sözleşmeleri gizle','Hide history and other contracts'):T('Geçmiş ve diğer sözleşmeler','History and other contracts'))} (${historyCount})</button>`:''}
        ${S.historyOpen?`<div id="lcContractHistory" class="lcHistory blMotionEnter">${others.map(r=>editorContract(card,d,r)).join('')}${(row.merged||[]).map(m=>(m.rules||[]).length?`<p class="lcMergedHead">${esc(T(`Birleşik ad “${m.licensor}” sözleşmeleri (yalnız görüntüleme; bu adla gelen siparişlerde önce bunlar uygulanır)`,`Contracts of merged name “${m.licensor}” (view only; orders with this name use these first)`))}</p><button type="button" class="lcBtn sm" data-lc-act="openContract" data-rule-id="${esc(m.rules[0].id)}">${esc(T('Bu kartı düzenle','Edit this card'))}</button>${[...m.rules].sort((a,b)=>String(b.opdStart||'').localeCompare(String(a.opdStart||''))).map(r=>editorContract(m,{conflict:true},r)).join('')}`:'').join('')}</div>`:''}${sorted.length?'':`<p class="lcMuted">${esc(card.licensor?T('Henüz sözleşme yok.','No contracts yet.'):T('Sözleşme eklemek için lisansör gerekli (CP’de seçin veya ASAS’tan yenileyin).','A licensor is required to add a contract (pick it in CP or refresh from ASAS).'))}</p>`}
      </section>
      <section class="lcPane"><header><b>${esc(T('Lisansör ve portal','Licensor and portal'))}</b>${canEdit()&&card.licensor?`<button type="button" class="lcBtn sm" data-lc-act="toggleLicensor" aria-expanded="${S.addLicensorOpen}" aria-controls="lcAddLicensor">${esc(T('Lisansör ekle','Add licensor'))}</button>`:''}</header>
        ${(row.merged||[]).length?`<div class="lcMergedInfo"><span class="lcFieldLabel">${esc(T('Bu satırda birleşen lisansör adları','Licensor names merged in this row'))}</span><span class="lcMergeNames"><span class="lcMergeName">${esc(card.licensor)}</span>${row.merged.map(m=>`<i>≡</i><span class="lcMergeName">${esc(m.licensor)}</span>`).join('')}</span>${canEdit()?`<button type="button" class="lcBtn sm" data-lc-act="mergeSplit" data-key="${esc(row.mergeKey)}" ${S.merging?'disabled':''}>${esc(T('Ayır','Split'))}</button>`:''}</div>`:''}
        ${canEdit()&&card.licensor&&S.addLicensorOpen?`<div id="lcAddLicensor" class="lcAddLicensor blMotionEnter"><span class="lcFieldLabel">${esc(T('Başka lisansör için satır ekle','Add a row for another licensor'))}</span><div class="lcInline"><input data-lc-new-licensor="${esc(card.id)}" list="lcLicensorList" maxlength="200" placeholder="${esc(T('Lisansör adı','Licensor name'))}" aria-label="${esc(T('Yeni lisansör','New licensor'))}" ${S.assigning?'disabled':''}><button type="button" class="lcBtn sm" data-lc-act="addLicensor" data-id="${esc(card.id)}" ${S.assigning?'disabled':''}><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Satır ekle','Add row'))}</button></div><label class="lcCopy"><input type="checkbox" data-lc-copy="${esc(card.id)}" checked>${esc(T('İletişim, görsel ve onay haritasını kopyala','Copy contact, image and approval map'))}</label></div>`:''}
        <div class="lcFields">
        ${input('contactName',T('İlgili kişi','Contact person'))}${input('contactEmail',T('E-posta','Email'),'email',320)}${input('portalUrl',T('Portal','Portal'),'url',2048)}${input('portalUsername',T('Portal kullanıcı adı','Portal username'))}${input('accessReference',T('Şifre yöneticisi kaydı','Password manager record'),'text',1000)}
        ${area('workingNotes',T('Çalışma notları','Working notes'),12000)}</div>
        ${portal?`<a class="lcLink" href="${esc(portal)}" target="_blank" rel="noopener noreferrer">${esc(T('Portalı aç','Open portal'))} ↗</a>`:''}<small class="lcMuted">${esc(T('Parolayı burada saklamayın; şifre yöneticisi kayıt adını yazın.','Do not store passwords here; enter the password manager record name.'))}</small></section>
      <section class="lcPane"><header><b>${esc(T('Görsel ve harita','Image and map'))}</b></header>
        <div class="lcCover lcThumb">${cover?`<img src="${esc(cover)}" alt="${esc(T('Lisans görseli','License image'))}">`:`<span data-no-i18n>${esc(initials(card.license))}</span>`}</div>
        ${canEdit()?`<div class="lcInline"><label class="lcBtn sm${dis?' isDisabled':''}"><svg class="ic"><use href="#i-picture"/></svg>${esc(cover?T('Görseli değiştir','Change image'):T('Görsel yükle','Upload image'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-lc-cover="${esc(card.id)}" hidden ${dis}></label>${cover?`<button type="button" class="lcBtn sm" data-lc-act="removeCover" data-id="${esc(card.id)}" ${dis}>${esc(T('Kaldır','Remove'))}</button>`:''}</div>`:''}
        <ol class="lcMapList">${row.map.map(s=>`<li class="ap-${esc(s.approver)}"><i></i><span>${esc(s.title||'—')}</span><small>${esc(T(...APPROVER[s.approver]))}${s.test?' · Test':''}</small></li>`).join('')||`<li class="lcMuted">${esc(T('Onay haritası tanımlanmadı.','No approval map yet.'))}</li>`}</ol>
        <button type="button" class="lcBtn sm" data-lc-act="map" data-id="${esc(card.id)}"><svg class="ic"><use href="#i-binary-tree-2"/></svg>${esc(T('Haritayı düzenle','Edit map'))}</button>
        ${statsHtml(card)}</section>

    </div>${canEdit()?`<footer class="lcDetailFoot"><span>${esc(T('Değişiklikler tüm yetkili kullanıcılarla paylaşılır.','Changes are shared with all authorized users.'))}</span><button type="button" class="lcBtn" data-lc-act="cancelEditor" data-id="${esc(card.id)}">${esc(T('Vazgeç','Cancel'))}</button><button type="button" class="lcBtn primary" data-lc-act="save" data-id="${esc(card.id)}" ${d?.saving||d?.conflict?'disabled':''}>${esc(d?.saving?T('Kaydediliyor…','Saving…'):T('Kaydet','Save'))}</button></footer>`:''}</dialog>`;
  }
  function currentRows(){
    const cards=S.data?.cards||[],rows=E.rows(cards,{query:S.query,licensor:S.licensor,status:S.status,sort:S.sort,...mergeOpts()}).filter(row=>!S.favoritesOnly||isFavorite(row));
    // A draft whose card disappeared stays visible (blocked) until the user discards it.
    for(const [id,d] of S.drafts){
      if(!cards.some(c=>c.id===id))rows.unshift({...E.rows([d.snapshot])[0],card:d.snapshot});
      // A draft on a card that is now merged into another row keeps its own row until saved/discarded.
      else if(!rows.some(r=>r.id===id)){const own=E.rows([cards.find(c=>c.id===id)])[0];if(own)rows.unshift(own);}
    }
    return rows;
  }
  function counts(){
    const cards=S.data?.cards||[],all=E.rows(cards,{query:S.query,licensor:S.licensor,...mergeOpts()});
    return {all:all.length,active:all.filter(r=>r.primary.status==='active').length,missing:all.filter(r=>r.primary.status!=='active').length,noLicensor:all.filter(r=>!r.licensor).length,noMap:all.filter(r=>!r.map.length).length};
  }
  function newCardHtml(){
    if(!S.newCard)return '';
    return `<div class="lcCreate blMotionEnter" role="group" aria-label="${esc(T('Yeni lisans kartı','New license card'))}"><label class="lcField"><span>${esc(T('Lisans','License'))}</span><input data-lc-new="license" maxlength="200" value="${esc(S.newCard.license)}" aria-label="${esc(T('Yeni lisans adı','New license name'))}" ${S.creating?'disabled':''}></label><label class="lcField"><span>${esc(T('Lisansör (isteğe bağlı)','Licensor (optional)'))}</span><input data-lc-new="licensor" maxlength="200" list="lcLicensorList" value="${esc(S.newCard.licensor)}" aria-label="${esc(T('Yeni kart lisansörü','New card licensor'))}" ${S.creating?'disabled':''}></label><button type="button" class="lcBtn primary" data-lc-act="createCard" ${S.creating?'disabled':''}>${esc(T('Kart ekle','Add card'))}</button><button type="button" class="lcBtn" data-lc-act="newCard" ${S.creating?'disabled':''}>${esc(T('Vazgeç','Cancel'))}</button>${S.createError?`<span role="alert">${esc(S.createError)}</span>`:''}</div>`;
  }
  async function createCard(){
    if(!S.newCard||S.creating)return;
    S.creating=true;S.createError='';render();
    try{
      const result=await api('/api/license-cards',{method:'POST',body:JSON.stringify(S.newCard)});
      accept(result);S.newCard=null;S.query='';S.licensor=null;S.status='all';S.favoritesOnly=false;S.expanded=result.cardId;
      toast(T('Lisans kartı eklendi.','License card added.'),'success');
    }catch(error){S.createError=failMessage(error);}
    finally{S.creating=false;render();}
  }
  function quickRules(){
    const byId=new Map((S.data?.pricingRules||[]).map(rule=>[rule.id,rule]));
    for(const d of S.drafts.values()){
      for(const id of d.deletedRuleIds||[])byId.delete(id);
      for(const rule of d.rules)byId.set(rule.id,{...rule,_draft:isDirty(d)});
    }
    return [...byId.values()];
  }
  function quickHtml(){
    const rules=quickRules(),search=window.BLTableSearch,terms=search?.parseTerms(S.query),label=r=>[r.license,r.licensor,r.categories?.join(', ')||T('Tüm kategoriler','All categories'),r._draft?T('Taslak','Draft'):'',E.ruleStatus(r,E.today())==='expired'?T('Geçmiş','Expired'):'',seasons(r),range(r),`Royalty ${r.royalty}%`].join(' · ');
    const visible=rules.filter(r=>!search||search.matches(label(r),terms,{plainMode:'contains'})).sort((a,b)=>Number(E.ruleStatus(a,E.today())==='expired')-Number(E.ruleStatus(b,E.today())==='expired'));
    S.quick=S.quick||{source:'supp',values:{}};
    if(!rules.some(r=>r.id===S.quick.ruleId))S.quick.ruleId=visible[0]?.id||'';
    const chosen=rules.find(r=>r.id===S.quick.ruleId);
    if(chosen&&!visible.includes(chosen))visible.unshift(chosen);
    const input=(key,id,tr,en)=>`<label class="lcField"><span>${esc(T(tr,en))}</span><input id="${id}" data-lc-quick="${key}" inputmode="decimal" value="${esc(S.quick.values[key]||'')}" aria-label="${esc(T(tr,en))}"></label>`;
    return `<div class="lcQuick" role="group" aria-label="${esc(T('Hızlı FOB hesabı','Quick FOB calculator'))}"><label class="lcField lcQuickRule"><span>${esc(T('Hızlı FOB · sözleşme','Quick FOB · contract'))}</span><select id="lcQuickRule" aria-label="${esc(T('Hesaplama sözleşmesi','Calculator contract'))}">${visible.map(r=>`<option value="${esc(r.id)}" ${r.id===S.quick.ruleId?'selected':''}>${esc(label(r))}</option>`).join('')||`<option value="">${esc(T('Önce sözleşme ekleyin','Add a contract first'))}</option>`}</select></label>${input('supp','lcQuickSupp','Supp. FOB (USD)','Supp. FOB (USD)')}<span>⇄</span>${input('yd','lcQuickYd','Final FOB YD','Final FOB Overseas')}${input('tr','lcQuickTr','Final FOB TR','Final FOB TR')}<button type="button" class="lcBtn sm" data-lc-act="quickClear">${esc(T('Temizle','Clear'))}</button><small id="lcQuickStatus" role="status"></small></div>`;
  }
  function runQuick(){
    const quick=S.quick,api=window.BLBusinessRules,status=document.getElementById('lcQuickStatus');if(!quick||!status||!api)return;
    const rule=quickRules().find(r=>r.id===quick.ruleId),v=E.parseRate(quick.values[quick.source]);
    const set=(key,value)=>{if(key===quick.source)return;quick.values[key]=value==null?'':new Intl.NumberFormat(locale(),{minimumFractionDigits:2,maximumFractionDigits:3}).format(value);const input=document.getElementById({supp:'lcQuickSupp',yd:'lcQuickYd',tr:'lcQuickTr'}[key]);if(input)input.value=quick.values[key];};
    if(!rule||v==null||!Number.isFinite(v)||v<0){['supp','yd','tr'].forEach(k=>set(k,null));status.textContent='';return;}
    const supp=quick.source==='supp'?v:api.calculateSuppFobWithRule(v,rule,quick.source==='tr'?'TR':'YD');
    set('supp',supp);set('yd',supp==null?null:api.calculateFinalFobWithRule(supp,rule,'YD'));set('tr',supp==null?null:api.calculateFinalFobWithRule(supp,rule,'TR'));
    status.textContent=supp==null?T('Ülke komisyonu veya toplam oran geçersiz.','Country commission or total rate is invalid.'):T('Önizleme; siparişlere kaydedilmez.','Preview; no order changes.');
  }
  async function applyRules(cardId,ruleId){
    if(!canEdit()||S.applying)return;
    S.applying=true;S.error='';
    try{
      const ids=cardId?[cardId]:[...S.drafts.keys()];
      for(const id of ids){await save(id);if(isDirty(S.drafts.get(id)))return;}
      await window.BLLicenseDataBridge?.rulesChanged?.(S.data);
      const count=cardId?await window.BLLicenseDataBridge.applyRule(ruleId):await window.BLLicenseDataBridge.applyAll();
      toast(T(`${count} sipariş güncellendi.`,`${count} orders updated.`),'success');
    }catch(error){S.error=failMessage(error);}
    finally{S.applying=false;render();}
  }

  function contractsHtml(rows){
    const F=[['license','Lisans','License'],['licensor','Lisansör','Licensor'],['opd','OPD aralığı','OPD range'],['seasons','Sezonlar','Seasons'],['categories','Kategoriler','Categories'],['royalty','Royalty %','Royalty %'],['trCommission','TR kom. %','TR comm. %'],['ydCommission','YD kom. %','Intl comm. %'],['hologramCost','Hologram','Hologram'],['matches','Eşleşen','Matched']];
    const filters=S.contractFilters||{},sort=S.contractSort||{key:'opd',dir:'asc'},all=[];
    const value=(r,c,k)=>k==='license'?c.license:k==='licensor'?c.licensor:k==='opd'?range(r)+' '+[r.opdStart,r.opdEnd].filter(Boolean).map(v=>v.slice(8,10)+'.'+v.slice(5,7)+'.'+v.slice(2,4)).join(' '):k==='seasons'?seasons(r):k==='categories'?r.categories?.join(', ')||T('Tüm kategoriler','All categories'):k==='matches'?window.BLLicenseDataBridge?.matches?.(r)||0:r[k];
    for(const row of rows)for(const card of [row.card,...row.merged||[]]){
      const d=S.drafts.get(card.id);
      for(const r of d?.rules||card.rules||[])if(F.every(([key])=>!filters[key]||window.BLTableSearch.matches(value(r,card,key),window.BLTableSearch.parseTerms(['royalty','trCommission','ydCommission','hologramCost','matches'].includes(key)?filters[key].replace(/(\d),(\d)/g,'$1.$2'):filters[key]),{plainMode:'contains'})))all.push({card,d,r});
    }
    all.sort((a,b)=>{const x=value(a.r,a.card,sort.key),y=value(b.r,b.card,sort.key);const ordinal=(value,fallback)=>{const day=Date.parse(value);return Number.isFinite(day)?day:fallback;};const cmp=sort.key==='opd'?(ordinal(a.r.opdStart,-Infinity)-ordinal(b.r.opdStart,-Infinity)||ordinal(a.r.opdEnd,Infinity)-ordinal(b.r.opdEnd,Infinity)):['royalty','trCommission','ydCommission','hologramCost','matches'].includes(sort.key)?(x==null?Infinity:Number(x))-(y==null?Infinity:Number(y)):sort.key==='seasons'?window.BLBusinessRules.compareSeasonLists(a.r.seasons||a.r.season,b.r.seasons||b.r.season):String(x||'').localeCompare(String(y||''),'tr');return (sort.dir==='desc'?-cmp:cmp)||String(a.r.id).localeCompare(String(b.r.id));});
    return `<div class="lcContractFilters" role="group" aria-label="${esc(T('Sözleşme filtreleri ve sıralama','Contract filters and sorting'))}">${F.map(([key,tr,en])=>`<label class="lcField"><button type="button" class="lcSort" data-lc-contract-sort="${key}" aria-label="${esc(T(tr+' sıralama',en+' sort'))}">${esc(T(tr,en))}${sort.key===key?(sort.dir==='asc'?' ↑':' ↓'):''}</button><input type="search" data-lc-contract-filter="${key}" value="${esc(filters[key]||'')}" aria-label="${esc(T(tr+' filtresi',en+' filter'))}"></label>`).join('')}<button type="button" class="lcBtn sm" data-lc-act="clearContractFilters">${esc(T('Filtreleri temizle','Clear filters'))}</button></div><small class="lcMuted">${all.length} ${esc(T('sözleşme','contracts'))}</small><div class="lcContractHead"><span></span><span>${esc(T('OPD başlangıç','OPD start'))}</span><span>${esc(T('OPD bitiş','OPD end'))}</span><span>${esc(T('Sezonlar','Seasons'))}</span><span>${esc(T('Kategoriler','Categories'))}</span><span lang="en">Royalty</span><span>${esc(T('TR kom.','TR comm.'))}</span><span>${esc(T('YD kom.','Intl comm.'))}</span><span lang="en">Hologram</span><span>${esc(T('İşlemler','Actions'))}</span></div>${all.map(({card,d,r})=>`<div class="lcContractRecord"><div class="lcContractIdentity"><label class="lcCheck"><input type="checkbox" data-lc-select="${esc(card.id)}" ${S.selected.has(card.id)?'checked':''} aria-label="${esc(T('Atlas için seç','Select for atlas'))}"></label><b data-no-i18n>${esc(card.license)}</b><span data-no-i18n>${esc(card.licensor)}</span><button type="button" class="lcBtn sm" data-lc-act="openContract" data-rule-id="${esc(r.id)}">${esc(T('Kartı aç','Open card'))}</button>${isDirty(d)?`<button type="button" class="lcBtn primary sm" data-lc-act="save" data-id="${esc(card.id)}" ${d.saving||d.conflict?'disabled':''}>${esc(T('Kaydet','Save'))}</button><button type="button" class="lcBtn sm" data-lc-act="discard" data-id="${esc(card.id)}">${esc(T('Vazgeç','Cancel'))}</button>`:''}${d?.error||d?.conflict?`<span role="alert">${esc(d.conflict?T('Kart değişti; taslağınız korunuyor.','Card changed; your draft is kept.'):d.error)}</span>`:''}</div>${contractRow(card,d,r)}</div>`).join('')||`<p class="lcEmpty">${esc(T('Eşleşen sözleşme yok.','No matching contracts.'))}</p>`}`;
  }
  function render(){
    if(!visible())return;
    readFavorites();
    // Never rebuild under the user's cursor; re-render once focus leaves the list.
    const active=document.activeElement;
    if(S.host.contains(active)&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)&&active.id!=='lcSearch'&&active.dataset?.lcContractFilter==null&&active.type!=='checkbox'&&S.host.querySelector('.lcPage')){S.renderQueued=true;return;}
    S.renderQueued=false;
    const oldEditor=S.host.querySelector('.lcEditor'),sameEditor=oldEditor?.dataset.detail===S.expanded;
    const editorScroll=oldEditor?.querySelector('.lcDetailIn')?.scrollTop||0;
    if(oldEditor){window.BLLayerSystem?.closeDialog(oldEditor,{restoreFocus:false});oldEditor.close();}
    const scrollTop=S.host.querySelector('.lcTable')?.scrollTop||0,scrollLeft=S.host.querySelector('.lcTable')?.scrollLeft||0;
    const searchFocus=active?.id==='lcSearch',filterFocus=active?.dataset?.lcContractFilter,caret=searchFocus||filterFocus!=null?active.selectionStart:null;
    if(!S.data){
      if(S.loading){
        S.host.innerHTML=`<div class="lcPage" role="status" aria-busy="true" aria-label="${esc(T('Lisans kartları yükleniyor…','Loading license cards…'))}"><div class="lcTable" aria-hidden="true">${Array.from({length:6},(_,i)=>`<div class="lcRow lcSkeleton" style="--i:${i}"><i></i><i></i><i></i><i></i></div>`).join('')}</div></div>`;
      }else{
        const error=S.loadError,title=error?T('Lisans kartları yüklenemedi','License cards could not be loaded'):T('Henüz lisans kartı yok','No license cards yet');
        const detail=error?failMessage(error):T('ASAS kaynağını kontrol edip yenileyin.','Check the ASAS source and refresh.'),actionLabel=T('Yeniden dene','Retry');
        const state=window.BLUI?.stateView?.({kind:error?'error':'empty',title,detail,actionLabel})||`<div class="lcEmpty" role="${error?'alert':'status'}"><b>${esc(title)}</b><span>${esc(detail)}</span><button type="button" class="lcBtn" data-lc-act="retry">${esc(actionLabel)}</button></div>`;
        S.host.innerHTML=`<div class="lcPage">${state}${window.BLHasPermission?.('manageBusinessRules')?`<button type="button" class="lcBtn primary" data-lc-act="newCard">${esc(T('Yeni lisans kartı','New license card'))}</button>${newCardHtml()}`:''}</div>`;
        const action=S.host.querySelector('[data-ui-state-action]');if(action)action.dataset.lcAct='retry';
      }
      return;
    }
    const rows=currentRows(),editorRow=rows.find(r=>r.id===S.expanded),n=counts(),opts=E.licensorOptions(S.data.cards),selectedVisible=rows.filter(r=>S.selected.has(r.id)).length,favoriteCount=allRows().filter(isFavorite).length;
    const chip=(key,tr,en,count)=>`<button type="button" class="lcChip" data-lc-status="${key}" aria-pressed="${S.status===key}">${esc(T(tr,en))}<small>${count}</small></button>`;
    const head=(key,tr,en,cls='')=>`<button type="button" class="lcSort ${cls}" data-lc-sort="${key}" ${['royalty','hologramCost'].includes(key)?'lang="en"':''} aria-sort="${S.sort.key===key?(S.sort.dir==='asc'?'ascending':'descending'):'none'}">${esc(T(tr,en))}${S.sort.key===key?`<svg class="ic"><use href="#i-chevron-${S.sort.dir==='asc'?'up':'down'}"/></svg>`:''}</button>`;
    S.host.innerHTML=`<div class="lcPage">
      <div class="lcToolbar">
        <button type="button" class="lcBtn" data-lc-act="contractView" aria-pressed="${Boolean(S.contractView)}">${esc(S.contractView?T('Kart tablosu','Card table'):T('Sözleşme tablosu','Contract table'))}</button>
        <label class="lcSearch"><svg class="ic"><use href="#i-search"/></svg><input id="lcSearch" type="search" value="${esc(S.query)}" placeholder="${esc(T('Lisans veya lisansör ara…','Search license or licensor…'))}" aria-label="${esc(T('Lisans ara','Search licenses'))}"></label>
        <select id="lcLicensor" class="lcSelect" aria-label="${esc(T('Lisansör filtresi','Licensor filter'))}"><option value="">${esc(T('Tüm lisansörler','All licensors'))}</option>${opts.map(o=>`<option value="${o.value?esc(o.value):'__none__'}" ${(S.licensor===o.value)?'selected':''}>${esc(o.value?o.label:T('Lisansörü olmayanlar','Without licensor'))}</option>`).join('')}</select>
        <div class="lcChips"><button type="button" class="lcChip" data-lc-act="favoritesOnly" aria-pressed="${S.favoritesOnly}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg>${esc(T('Favorilerim','My favorites'))}<small>${favoriteCount}</small></button></div>
        <div class="lcChips" role="group" aria-label="${esc(T('Durum','Status'))}">${chip('all','Tümü','All',n.all)}${chip('active','Güncel sözleşme','Current contract',n.active)}${chip('missing','Sözleşmesi olmayan','No current contract',n.missing)}${chip('noLicensor','Lisansörsüz','No licensor',n.noLicensor)}${chip('noMap','Haritasız','No map',n.noMap)}</div>
        <span class="lcSpacer"></span>
        ${canEdit()?`<button type="button" class="lcBtn primary" data-lc-act="newCard"><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Yeni lisans kartı','New license card'))}</button><button type="button" class="lcBtn" data-lc-act="applyAll" ${S.applying?'disabled':''}>${esc(T('Tümüne uygula','Apply to all'))}</button>`:''}
        ${S.data.lastImportedAt?`<small class="lcMuted">${esc(T('ASAS:','ASAS:'))} ${esc(new Date(S.data.lastImportedAt).toLocaleDateString(locale()))}</small>`:''}
        ${(()=>{const n=E.mergeSummary(S.data.cards,mergeOpts()).filter(m=>!m.split).length;return `<button type="button" class="lcBtn${S.mergesOpen?' isOn':''}" data-lc-act="merges" aria-expanded="${Boolean(S.mergesOpen)}"><svg class="ic"><use href="#i-hierarchy"/></svg>${esc(T('Lisansör birleştirmeleri','Licensor merges'))}<small class="lcCount">${n}</small></button>`;})()}
        <button type="button" class="lcBtn" data-lc-act="templates"><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Aşama taslakları','Stage templates'))}<small class="lcCount">${(S.data.stageTemplates||[]).length}</small></button>
        ${canEdit()?`<button type="button" class="lcBtn" data-lc-act="refresh" ${S.refreshing?'disabled aria-busy="true"':''}><svg class="ic${S.refreshing?' isSpinning':''}"><use href="#i-refresh"/></svg>${esc(S.refreshing?T('Yenileniyor…','Refreshing…'):T('ASAS’tan yenile','Refresh from ASAS'))}</button>`:''}
      </div>${newCardHtml()}${quickHtml()}${licensorList()}${S.mergesOpen?mergePanel():''}
      ${S.clip?`<div class="lcClipBar" role="status"><svg class="ic"><use href="#i-copy"/></svg><span>${esc(T(`Kopyalanan harita: ${S.clip.license} · ${S.clip.licensor||'—'} (${S.clip.steps} adım). Hedef satırda yapıştır simgesine basın veya satırları seçip toplu yapıştırın.`,`Copied map: ${S.clip.license} · ${S.clip.licensor||'—'} (${S.clip.steps} steps). Press the paste icon on a row, or select rows and paste to all.`))}</span><button type="button" class="lcBtn sm" data-lc-act="clearClip">${esc(T('Bırak','Clear'))}</button></div>`:''}
      ${S.loadError?`<div class="lcNotice" role="alert"><span>${esc(T('Önceki yüklenen kartlar gösteriliyor; güncelleme tamamlanamadı.','Showing previously loaded cards; the update did not complete.'))} ${esc(failMessage(S.loadError))}</span><button type="button" class="lcBtn sm" data-lc-act="retry">${esc(T('Yeniden dene','Retry'))}</button></div>`:''}
      ${S.error?`<div class="lcNotice" role="alert">${esc(S.error)}</div>`:''}${S.data.syncPending?`<div class="lcNotice" role="status">${esc(T('Kaydedildi; diğer kullanıcılara aktarım bekliyor ve otomatik yeniden denenir.','Saved; sharing with other users is pending and retried automatically.'))}</div>`:''}
      <div class="lcSelectionBar isOn${S.animate?' blMotionEnter':''}">
        <button type="button" class="lcBtn" data-lc-act="selectFavorites" ${!favoriteCount?'disabled':''} title="${esc(T('Filtrelerden bağımsız tüm favorilerimi mevcut seçime ekle','Add all my favorites to the current selection, regardless of filters'))}"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg>${esc(T('Favorileri seç','Select favorites'))}</button>
        <button type="button" class="lcBtn primary" data-lc-act="export" ${S.exporting||!S.selected.size?'disabled':''}><svg class="ic"><use href="#i-file-export"/></svg>${esc(S.exporting?T('Hazırlanıyor…','Preparing…'):T('Üretici atlası oluştur','Create supplier atlas'))}</button>
        ${S.clip&&canEdit()?`<button type="button" class="lcBtn" data-lc-act="pasteSelected" ${S.pasting?'disabled':''}><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Haritayı seçilenlere yapıştır','Paste map to selected'))}</button>`:''}
        <button type="button" class="lcBtn" data-lc-act="clearSelection" ${!S.selected.size?'disabled':''}>${esc(T('Seçimi temizle','Clear selection'))}</button>
        <b>${S.selected.size} ${esc(T('lisans seçildi','licenses selected'))}</b><small>${esc(T('Yıldızlar size özeldir. Seçtiğiniz satırlar üretici atlasına girer.','Stars are personal. The selected rows go into the supplier atlas.'))}</small>
      </div>
      <div class="lcTable${S.animate?' isEntering':''}" role="table" aria-label="${esc(T('Lisans kartları','License cards'))}">
        <div class="lcHead" role="row" ${S.contractView?'hidden':''}>
          <span class="lcPick"><label class="lcCheck"><input type="checkbox" data-lc-select-all ${rows.length&&selectedVisible===rows.length?'checked':''} aria-label="${esc(T('Listelenenlerin tümünü seç','Select all listed'))}"></label><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg></span>
          <span></span>${head('license','Lisans','License')}${head('licensor','Lisansör','Licensor')}${head('royalty','Royalty','Royalty','isNum')}${head('trCommission','TR kom.','TR comm.','isNum')}${head('ydCommission','YD kom.','Intl comm.','isNum')}${head('hologramCost','Hologram','Hologram','isNum')}<span>${esc(T('Geçerlilik','Validity'))}</span>${head('map','Onay haritası','Approval map')}<span></span>
        </div>
        ${S.contractView?contractsHtml(rows):rows.map(rowHtml).join('')||`<div class="lcEmpty"><svg class="ic"><use href="#i-license-cards"/></svg><b>${esc(S.query||S.licensor!=null||S.status!=='all'||S.favoritesOnly?T('Eşleşen lisans yok','No matching licenses'):T('Henüz lisans kartı yok','No license cards yet'))}</b><span>${esc(S.favoritesOnly?T('Lisans satırındaki yıldızla kendi favorilerinizi ekleyin veya filtreleri değiştirin.','Use the star on a license row to add your own favorites, or change the filters.'):S.query||S.licensor!=null||S.status!=='all'?T('Arama veya filtreleri değiştirin.','Change the search or filters.'):T('ASAS kaynağını kontrol edip yenileyin.','Check the ASAS source and refresh.'))}</span></div>`}
      </div>
      ${editorRow?detailHtml(editorRow,S.drafts.get(editorRow.id)):''}
    </div>`;
    const all=S.host.querySelector('[data-lc-select-all]');if(all)all.indeterminate=selectedVisible>0&&selectedVisible<rows.length;
    const table=S.host.querySelector('.lcTable');if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
    S.animate=false;S.flash.clear();
    runQuick();
    const editor=S.host.querySelector('.lcEditor');
    if(editor){
      editor.showModal();editor.addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
      window.BLLayerSystem?.openDialog(editor,{onClose:()=>{
        if(editor.querySelector('.dateCalendarPopup')&&typeof closeDateCalendarPopup==='function')return closeDateCalendarPopup(true);
        closeEditor();
      },initialFocus:S.editorFocus||'[data-lc-act="closeEditor"]'});S.editorFocus=null;
      editor.querySelector('.lcDetailIn').scrollTop=sameEditor?editorScroll:0;
      if(!sameEditor)window.BLMotionPlus?.play('overlay',editor);
    }
    if(filterFocus!=null){const input=S.host.querySelector(`[data-lc-contract-filter="${CSS.escape(filterFocus)}"]`);input?.focus();input?.setSelectionRange(caret,caret);}
    if(searchFocus){const input=document.getElementById('lcSearch');input.focus();input.setSelectionRange(caret,caret);}
  }
  // The row save buttons and the detail save bar follow .isDirty in CSS; no re-render needed.
  function syncRow(id){
    const row=S.host.querySelector(`[data-row="${CSS.escape(id)}"]`);if(row)row.classList.toggle('isDirty',isDirty(S.drafts.get(id)));if(S.contractView)S.renderQueued=true;
  }

  /* ---------- actions ---------- */
  async function save(id){
    if(S.pending)await S.pending;
    const d=S.drafts.get(id),c=cardOf(id);
    if(!d||d.saving||d.conflict||!canEdit())return;
    if(!c){d.conflict=true;render();return;}
    if(!isDirty(d)){dropDraft(id);render();return;}
    const rules=changedRules(d);
    for(const r of rules){const problem=E.rateError(r);if(problem){d.error=T(...RATE_ERRORS[problem])+(r.opdStart?` (${r.opdStart})`:'');render();return;}}
    const body={editToken:d.editToken,profile:changedProfile(d)};
    if(d.deletedRuleIds?.length)body.deletedRuleIds=d.deletedRuleIds;
    if(d.cover!==undefined){
      const atlas=c.processAtlas?copy(c.processAtlas):{version:1,license:{id:c.id,name:c.license,agency:c.licensor||'',stages:[],addresses:[],portal:{url:'',notes:''},manufacturerVisible:true},sharedAddresses:[],visualLibrary:[]};
      atlas.license.cover=d.cover||'';body.profile.processAtlas=atlas;
    }
    if(rules.length)body.rules=rules;
    d.saving=true;d.error='';render();
    try{
      const result=await api(`/api/license-cards/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(body)});
      dropDraft(id);S.flash.add(id);
      if(!accept(result))S.stale=true;
      await window.BLLicenseDataBridge?.rulesChanged?.(result);
    }catch(e){d.error=failMessage(e);if(e.status===409)d.conflict=true;}
    finally{d.saving=false;if(S.stale||S.refreshNext)await load();render();}
  }
  function exportName(){return `Buyer-Log-Supplier-Atlas-${new Date().toISOString().slice(0,10)}.html`;}
  // Card images are stored as /api/license-cards/assets/… URLs; the standalone supplier file
  // (img-src data: only) embeds their bytes.
  const ASSET_PREFIX='/api/license-cards/assets/';
  async function inlineAssets(licenses){
    const cache=new Map();
    const toData=url=>{
      if(!cache.has(url))cache.set(url,fetch(url,{credentials:'same-origin'}).then(r=>{if(!r.ok)throw new Error('LICENSE_ASSET_NOT_FOUND');return r.blob();})
        .then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);})));
      return cache.get(url);
    };
    const inline=async value=>typeof value==='string'&&value.startsWith(ASSET_PREFIX)?toData(value):value;
    for(const l of licenses){
      l.cover=await inline(l.cover);
      for(const v of l.visualLibrary||[])v.data=await inline(v.data);
    }
  }
  async function exportAtlas(){
    const A=window.BLLicenseSupplierAtlas;if(!A||S.exporting)return;
    const cards=(S.data?.cards||[]).filter(c=>S.selected.has(c.id));if(!cards.length)return;
    S.exporting=true;render();
    try{
      const {licenses,skipped}=A.project(cards,isEn()?'en':'tr');
      if(!licenses.length){toast(T('Seçilen lisansların hiçbiri üretici atlasına dahil değil. Haritada “Üretici atlasına dahil”i açın.','None of the selected licenses is included in the supplier atlas. Turn on “Include in supplier atlas” in the map.'));return;}
      await inlineAssets(licenses);
      const result=await A.buildEmailSafeHTML(licenses,{lang:isEn()?'en':'tr',fonts:await A.loadFonts()});
      // Defensive final guard: an oversized file must never be offered for download.
      if(result.blob.size>A.MAX_EMAIL_BYTES)throw Object.assign(new Error('Atlas oversized'),{code:'ATLAS_EMAIL_SIZE_LIMIT'});
      const url=URL.createObjectURL(result.blob),a=document.createElement('a');
      a.href=url;a.download=exportName();document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      const mb=(result.bytes/1000000).toFixed(2);
      const detail=result.optimized?T(' · E-posta boyutuna göre optimize edildi.',' · Optimized for email.'):'';
      toast(T(`${licenses.length} lisans aktarıldı (${mb} MB).`,`${licenses.length} licenses exported (${mb} MB).`)+detail+
        (skipped.length?T(` Üreticiye kapalı: ${skipped.join(', ')}`,` Not shared with suppliers: ${skipped.join(', ')}`):''),'success');
    }catch(error){
      if(error?.code==='ATLAS_EMAIL_SIZE_LIMIT')toast(T('Atlas 9 MB sınırına sığdırılamadı. İçerik eksiltilmedi; daha az lisans seçin veya büyük görselleri küçültün.','The atlas cannot fit under 9 MB without removing content. Select fewer licenses or reduce large images.'));
      else toast(T('Üretici atlası oluşturulamadı.','The supplier atlas could not be created.'));
    }
    finally{S.exporting=false;render();}
  }
  // Our own map/template writes change only processAtlas: open rate drafts on those cards
  // take the new token instead of turning into conflicts.
  function adopt(result,before){
    for(const [id,d] of S.drafts){
      const old=before.find(c=>c.id===id),fresh=result.cards?.find(c=>c.id===id);
      if(!d.conflict&&old&&fresh&&d.editToken===old.editToken&&old.editToken!==fresh.editToken&&JSON.stringify(old.rules)===JSON.stringify(fresh.rules)){d.editToken=fresh.editToken;d.snapshot.processAtlas=fresh.processAtlas;}
    }
    if(S.mapBase){const old=before.find(c=>c.id===S.mapBase.id),fresh=result.cards?.find(c=>c.id===S.mapBase.id);if(old&&fresh&&old.atlasToken===S.mapBase.atlasToken)S.mapBase.atlasToken=fresh.atlasToken;}
    accept(result);
  }
  async function saveTemplate({template,expectedUpdatedAt}){
    const before=S.data.cards;S.templateWrite=true;
    try{
      const result=await api('/api/license-cards/stage-templates',{method:'POST',body:JSON.stringify({template,expectedUpdatedAt})});
      adopt(result,before);render();
      if(result.propagated)toast(T(`“${template.name}” ${result.propagated} lisansta güncellendi.`,`“${template.name}” updated in ${result.propagated} licenses.`),'success');
      return {templates:result.stageTemplates||[],cards:S.data.cards,propagated:result.propagated||0};
    }catch(e){throw await templateError(e);}
    finally{S.templateWrite=false;}
  }
  async function templateError(e){
    const out=new Error(failMessage(e));
    if(e.status===409||e.code==='LICENSE_TEMPLATE_NOT_FOUND'){await load();out.templates=S.data?.stageTemplates||[];out.cards=S.data?.cards;}
    return out;
  }
  async function deleteTemplate(t){
    const before=S.data.cards;S.templateWrite=true;
    try{
      const result=await api(`/api/license-cards/stage-templates/${encodeURIComponent(t.id)}`,{method:'DELETE',body:JSON.stringify({expectedUpdatedAt:t.updatedAt})});
      adopt(result,before);render();return {templates:result.stageTemplates||[],cards:S.data.cards};
    }catch(e){throw await templateError(e);}
    finally{S.templateWrite=false;}
  }
  function openTemplates(){
    if(!window.BLLicenseMapEditor||!S.data)return;
    window.BLLicenseMapEditor.openTemplates({templates:S.data.stageTemplates||[],cards:S.data.cards,canEdit:canEdit(),onSave:saveTemplate,onDelete:deleteTemplate});
  }
  async function setLicensor(id,licensor,mode,copyProfile){
    const c=cardOf(id);licensor=String(licensor||'').trim();if(!c||!licensor||S.assigning||!canEdit())return;
    const known=E.licensorOptions(S.data.cards).find(o=>o.value&&o.label.toLocaleLowerCase('tr')===licensor.toLocaleLowerCase('tr'));if(known)licensor=known.label;
    S.assigning=id;render();
    try{
      const result=await api(`/api/license-cards/${encodeURIComponent(id)}/licensor`,{method:'PUT',body:JSON.stringify({editToken:c.editToken,licensor,mode,copy:Boolean(copyProfile)})});
      // Our own assign changes only the licensor: an open draft follows the new token.
      const d=S.drafts.get(id),fresh=result.cards?.find(x=>x.id===id);
      if(mode!=='add'&&d&&!d.conflict&&fresh&&d.editToken===c.editToken){d.editToken=fresh.editToken;d.snapshot.licensor=fresh.licensor;}
      accept(result);
      if(result.cardId){S.flash.add(result.cardId);if(S.expanded===id&&mode!=='add')S.expanded=result.cardId;}
      toast(mode==='add'?T(`${c.license} için ${licensor} satırı eklendi.`,`Added a ${licensor} row for ${c.license}.`):T(`${c.license} lisansörü: ${licensor}`,`${c.license} licensor: ${licensor}`),'success');
      await window.BLLicenseDataBridge?.rulesChanged?.(result);
    }catch(e){toast(failMessage(e),'warning');if(e.status===409&&e.code==='REVISION_CONFLICT')load();}
    finally{S.assigning='';render();}
  }
  function mergePanel(){
    const list=E.mergeSummary(S.data.cards,mergeOpts());
    const options=E.licensorOptions(S.data.cards).filter(o=>o.value);
    const picker=(id,selected,placeholder)=>`<select id="${id}" class="lcSelect" aria-label="${esc(placeholder)}"><option value="">${esc(placeholder)}</option>${options.map(o=>`<option value="${esc(o.label)}" ${selected===o.label?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
    return `<div class="lcMergePanel" role="region" aria-label="${esc(T('Lisansör birleştirmeleri','Licensor merges'))}">
      <header><b>${esc(T('Lisansör birleştirmeleri','Licensor merges'))}</b><small>${esc(T('Benzer lisansör adları otomatik birleşir; farklı adları aşağıdan manuel eşleştirebilirsiniz. Her lisansörün sözleşmesi korunur ve royalty önce siparişteki adın sözleşmesini kullanır. Birleştirmeleri buradan geri alabilirsiniz.','Similar names merge automatically; you can also link different names below. Each licensor keeps its contracts and royalty uses the order’s own contract first. You can undo merges here.'))}</small></header>
      ${canEdit()?`<div class="lcManualMerge"><label><span>${esc(T('Lisansör','Licensor'))}</span>${picker('lcMergeSource',S.manualSource||'',T('Lisansör seçin','Choose licensor'))}</label><span aria-hidden="true">→</span><label><span>${esc(T('Birleştirilecek lisansör','Merge with'))}</span>${picker('lcMergeTarget',S.manualTarget||'',T('Hedef lisansör','Target licensor'))}</label><button type="button" class="lcBtn primary sm" data-lc-act="mergeManualAdd" ${S.merging?'disabled':''}>${esc(T('Manuel birleştir','Merge manually'))}</button></div>`:''}
      ${list.length?`<ul>${list.map(m=>`<li class="${m.split?'isSplit':''}${S.mergeFocus===m.key?' isFocus':''}"><span class="lcMergeNames">${m.names.map(n=>`<span class="lcMergeName">${esc(n)}</span>`).join('<i>≡</i>')}${m.manual?`<small>${esc(T('Manuel','Manual'))}</small>`:''}</span><small>${m.licenses.length} ${esc(T('lisans','licenses'))}: ${esc(m.licenses.slice(0,6).join(', '))}${m.licenses.length>6?'…':''}</small>${statusBadgeMerge(m.split)}${canEdit()?`<button type="button" class="lcBtn sm" data-lc-act="${m.manual?(m.split?'mergeManualJoin':'mergeManualSplit'):(m.split?'mergeJoin':'mergeSplit')}" data-key="${esc(m.key)}" ${m.manual?`data-source="${esc(m.source)}" data-target="${esc(m.target)}"`:''} ${S.merging?'disabled':''}>${esc(m.split?T('Yeniden birleştir','Merge again'):T('Ayır','Split'))}</button>`:''}</li>`).join('')}</ul>`:`<p class="lcMuted">${esc(T('Henüz birleştirilmiş lisansör yok.','No licensor merges yet.'))}</p>`}
    </div>`;
  }
  const statusBadgeMerge=split=>`<span class="lcBadge ${split?'isMuted':'isOk'}">${esc(split?T('Ayrı','Separate'):T('Birleşik','Merged'))}</span>`;
  async function setMerge(key,split,manual=null){
    if(S.merging||!canEdit()||(!manual&&!key))return;
    if(manual&&(!manual.source||!manual.target||manual.source===manual.target)){
      toast(T('İki farklı lisansör seçin.','Choose two different licensors.'),'warning');return;
    }
    S.merging=true;render();
    try{
      const result=await api('/api/license-cards/licensor-merges',{method:'PUT',body:JSON.stringify(manual?{...manual,split}:{key,split})});
      accept(result);S.animate=true;
      if(manual&&!split){S.manualSource='';S.manualTarget='';}
      toast(split?T('Lisansörler ayrıldı; özgün sözleşmeler korundu.','Licensors split; original contracts were retained.'):T('Lisansörler birleştirildi; özgün sözleşmeler korundu.','Licensors merged; original contracts were retained.'),'success');
      await window.BLLicenseDataBridge?.rulesChanged?.(result);
    }catch(e){toast(e.code==='LICENSE_MERGE_INVALID'?T('Geçerli iki lisansör seçin ve tekrar deneyin.','Select two valid licensors and try again.'):failMessage(e),'warning');}
    finally{S.merging=false;render();}
  }
  async function pasteMaps(ids){
    const clip=S.clip;if(!clip||S.pasting||!canEdit())return;
    const targets=ids.map(cardOf).filter(c=>c&&c.id!==clip.id);if(!targets.length)return;
    const replacing=targets.filter(c=>(c.processAtlas?.license?.stages||[]).length);
    if(replacing.length&&!confirm(T(`${replacing.length} lisansın mevcut onay haritası “${clip.license}” haritasıyla değiştirilecek. Görsel, portal ve notlar korunur. Devam edilsin mi?`,`The approval map of ${replacing.length} licenses will be replaced with the “${clip.license}” map. Image, portal and notes are kept. Continue?`)))return;
    S.pasting=true;render();let done=0,failed=0;
    for(const target of targets){
      const current=cardOf(target.id);if(!current){failed++;continue;}
      try{
        const result=await api(`/api/license-cards/${encodeURIComponent(current.id)}`,{method:'PUT',body:JSON.stringify({editToken:current.editToken,profile:{processAtlas:E.pasteMap(clip.atlas,current)}})});
        const d=S.drafts.get(current.id),fresh=result.cards?.find(x=>x.id===current.id);
        if(d&&!d.conflict&&fresh&&d.editToken===current.editToken){d.editToken=fresh.editToken;d.snapshot.processAtlas=fresh.processAtlas;}
        accept(result);S.flash.add(current.id);done++;
      }catch(_){failed++;}
    }
    S.pasting=false;render();
    toast(failed?T(`${done} lisansa yapıştırıldı, ${failed} lisansta kaydedilemedi.`,`Pasted to ${done} licenses; ${failed} could not be saved.`):T(`“${clip.license}” haritası ${done} lisansa yapıştırıldı.`,`The “${clip.license}” map was pasted to ${done} licenses.`),failed?'warning':'success');
  }
  function openMap(id){
    const c=cardOf(id);if(!c||!window.BLLicenseMapEditor)return;
    // The guard is the map as it was opened, not the list's latest copy: unrelated card
    // changes never block the save, and a map changed elsewhere is never overwritten.
    const base={id,atlasToken:c.atlasToken};S.mapBase=base;
    window.BLLicenseMapEditor.open({card:c,cards:S.data.cards,canEdit:canEdit(),templates:S.data.stageTemplates||[],onSaveTemplate:canEdit()?saveTemplate:null,onSave:async atlas=>{
      const current=cardOf(id);if(!current)throw new Error(failMessage({status:409}));
      try{
        const result=await api(`/api/license-cards/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({atlasToken:base.atlasToken,profile:{processAtlas:atlas}})});
        // Our own map save must not turn a pending rate draft on this card into a conflict, but the
        // map token passes changes made elsewhere: the draft follows only if its own fields are unchanged.
        const d=S.drafts.get(id),fresh=result.cards?.find(x=>x.id===id);
        if(d&&!d.conflict&&fresh&&d.editToken===current.editToken){
          if(guarded(fresh)===guarded(d.snapshot)){d.editToken=fresh.editToken;d.snapshot.processAtlas=fresh.processAtlas;}else d.conflict=true;
        }
        if(fresh)base.atlasToken=fresh.atlasToken;
        accept(result);S.flash.add(id);render();
        toast(T('Onay haritası kaydedildi.','Approval map saved.'));
      }catch(e){if(e.status===409&&e.code==='REVISION_CONFLICT')load();throw new Error(failMessage(e));}
    }});
  }
  function act(el){
    const a=el.dataset.lcAct,id=el.dataset.id;
    if(a==='favorite')return toggleFavorite(id);
    if(a==='favoritesOnly'){S.favoritesOnly=!S.favoritesOnly;S.animate=true;return render();}
    if(a==='selectFavorites')return selectFavorites();
    if(a==='contractView'){S.contractView=!S.contractView;return render();}
    if(a==='clearContractFilters'){S.contractFilters={};return render();}
    if(a==='openContract')return window.BLLicenseCardsPage.openRule(el.dataset.ruleId);
    if(a==='newCard'){S.newCard=S.newCard?null:{license:'',licensor:''};return render();}
    if(a==='createCard')return createCard();
    if(a==='quickClear'){S.quick={source:'supp',values:{},ruleId:S.quick?.ruleId||''};return render();}
    if(a==='checkRule'){if(S.expanded)closeEditor();S.quick={source:'supp',values:{},ruleId:el.dataset.ruleId};render();document.getElementById('lcQuickSupp')?.focus();return;}
    if(a==='applyAll'||a==='applyRule')return applyRules(a==='applyRule'?id:'',el.dataset.ruleId);
    if(a==='deleteRule'){const d=ensureDraft(id);if(!d||d.saving||d.conflict)return;if(!confirm(T('Bu sözleşme silinsin mi? Kaydetmeden önce Vazgeç ile geri alabilirsiniz.','Delete this contract? You can cancel before saving.')))return;const period=d.periods?.[el.dataset.ruleId];if(period){for(const original of period.originalRules){const previous=ruleOf(d,original.id);if(previous)previous.opdEnd=original.opdEnd||'';}delete d.periods[el.dataset.ruleId];if(d.period?.id===el.dataset.ruleId)d.period=null;d.note='';}d.rules=d.rules.filter(r=>r.id!==el.dataset.ruleId);if(d.snapshot.rules.some(r=>r.id===el.dataset.ruleId))d.deletedRuleIds.push(el.dataset.ruleId);d.primaryId=E.primaryContract(d.rules).rule?.id||'';render();return;}
    if(a==='retry')return load(Boolean(S.loadErrorRefresh));
    if(a==='refresh'&&canEdit())return load(true);
    if(a==='expand'){S.expanded=id;S.historyOpen=false;S.addLicensorOpen=false;return render();}
    if(a==='closeEditor')return closeEditor();
    if(a==='cancelEditor'){dropDraft(id);return closeEditor();}
    if(a==='history'){S.historyOpen=!S.historyOpen;S.editorFocus='[data-lc-act="history"]';return render();}
    if(a==='toggleLicensor'){S.addLicensorOpen=!S.addLicensorOpen;S.editorFocus=S.addLicensorOpen?'[data-lc-new-licensor]':'[data-lc-act="toggleLicensor"]';return render();}
    if(a==='map'){if(S.expanded)closeEditor();return openMap(id);}
    if(a==='templates')return openTemplates();
    if(a==='merges'){S.mergesOpen=!S.mergesOpen||Boolean(el.dataset.key&&!el.classList.contains('lcBtn'));S.mergeFocus=el.dataset.key||'';return render();}
    if(a==='mergeSplit'||a==='mergeJoin')return setMerge(el.dataset.key,a==='mergeSplit');
    if(a==='mergeManualSplit'||a==='mergeManualJoin')return setMerge('',a==='mergeManualSplit',{source:el.dataset.source,target:el.dataset.target});
    if(a==='mergeManualAdd')return setMerge('',false,{source:S.host.querySelector('#lcMergeSource')?.value||'',target:S.host.querySelector('#lcMergeTarget')?.value||''});
    if(a==='copyMap'){const c=cardOf(id);if(!c?.processAtlas)return;S.clip={id,license:c.license,licensor:c.licensor,steps:(c.processAtlas.license?.stages||[]).length,atlas:copy(c.processAtlas)};toast(T(`${c.license} haritası kopyalandı.`,`${c.license} map copied.`),'info');return render();}
    if(a==='clearClip'){S.clip=null;return render();}
    if(a==='pasteMap')return pasteMaps([id]);
    if(a==='pasteSelected')return pasteMaps([...S.selected]);
    if(a==='addLicensor'){const input=S.host.querySelector(`[data-lc-new-licensor="${CSS.escape(id)}"]`),copyBox=S.host.querySelector(`[data-lc-copy="${CSS.escape(id)}"]`);return setLicensor(id,input?.value,'add',copyBox?.checked);}
    if(a==='save')return save(id);
    if(a==='discard'||a==='reopen'){dropDraft(id);return a==='reopen'?load():render();}
    if(a==='export')return exportAtlas();
    if(a==='clearSelection'){S.selected.clear();return render();}
    if(!canEdit())return;
    if(a==='addCategory'){
      const c=cardOf(id),d=ensureDraft(id);if(!c||!d||d.saving||d.conflict||!c.licensor)return;
      const base=ruleOf(d,d.primaryId)||E.primaryContract(d.rules).rule;
      const r={...(base?copy(base):{royalty:null,trCommission:0,ydCommission:0,hologramCost:0,seasons:[],opdStart:'',opdEnd:''}),id:`license-rule-${crypto.randomUUID()}`,license:c.license,licensor:c.licensor,categories:[]};
      d.rules.push(r);d.newRuleBaselines[r.id]=copy(r);d.primaryId=r.id;d.note=T('Yeni satırın kategorisini ve oranlarını girin. Genel sözleşme korunur.','Enter the new row’s category and rates. The general contract is kept.');S.expanded=id;S.editorFocus=`[data-lc-rule="${CSS.escape(r.id)}"][data-lc-key="categories"]`;render();
      S.host.querySelector(`[data-lc-rule="${CSS.escape(r.id)}"][data-lc-key="categories"]`)?.focus();return;
    }
    if(a==='addContract'||a==='addPeriod'){
      const c=cardOf(id),d=ensureDraft(id);if(!c||!d||d.conflict||!c.licensor)return;
      const originalRules=copy(d.rules),next=E.nextContractPeriod(d.rules,c,E.today(),undefined,d.primaryId);d.rules=next.rules;d.primaryId=next.rule.id;d.period=next.closed.length?{id:next.rule.id,closed:next.closed,originalRules:originalRules.filter(r=>next.closed.includes(r.id))}:null;if(d.period)d.periods[next.rule.id]=d.period;d.newRuleBaselines[next.rule.id]=copy(next.rule);
      d.note=next.closed.length?T(`Yeni dönem güncel oranlarla eklendi; önceki açık dönem ${E.previousDay(next.rule.opdStart)} tarihinde kapatıldı. Kaydetmeden önce kontrol edin.`,`The new period copies the current rates; the previous open period now ends on ${E.previousDay(next.rule.opdStart)}. Review before saving.`):'';
      S.expanded=id;S.editorFocus=`[data-lc-rule="${CSS.escape(next.rule.id)}"][data-lc-key="opdStart"]`;render();
      S.host.querySelector(`.lcEditor [data-lc-rule="${CSS.escape(next.rule.id)}"][data-lc-key="opdStart"]`)?.focus();return;
    }
    if(a==='removeCover'){const d=ensureDraft(id);if(d){d.cover='';render();}}
  }
  // Inline and panel edits write into the card's draft; no re-render while typing.
  function onInput(e){
    const el=e.target,id=el.dataset.id;
    if(el.dataset.lcContractFilter!=null){S.contractFilters=S.contractFilters||{};S.contractFilters[el.dataset.lcContractFilter]=el.value;return render();}
    if(el.dataset.lcNew){S.newCard[el.dataset.lcNew]=el.value;return;}
    if(el.dataset.lcQuick){S.quick=S.quick||{values:{}};S.quick.source=el.dataset.lcQuick;S.quick.values[S.quick.source]=el.value;return runQuick();}
    if(el.id==='lcQuickRule'){S.quick=S.quick||{source:'supp',values:{}};S.quick.ruleId=el.value;return runQuick();}
    if(el.id==='lcSearch'){S.query=el.value;S.animate=true;return render();}
    if(!id||!canEdit())return;
    const d=ensureDraft(id);if(!d||d.saving||d.conflict)return;
    if(el.dataset.lcRate!=null){const r=ruleOf(d,d.primaryId);if(!r)return;r[el.dataset.lcRate]=E.parseRate(el.value);el.classList.toggle('isInvalid',Number.isNaN(r[el.dataset.lcRate]));
      const twin=S.host.querySelector(`[data-lc-rule="${CSS.escape(r.id)}"][data-lc-key="${el.dataset.lcRate}"]`);if(twin&&twin!==el)twin.value=el.value;}
    else if(el.dataset.lcRule!=null){const r=ruleOf(d,el.dataset.lcRule),k=el.dataset.lcKey;if(!r)return;
      r[k]=['seasons','categories'].includes(k)?el.value.split(',').map(x=>x.trim()).filter(Boolean):['opdStart','opdEnd'].includes(k)?el.value:E.parseRate(el.value);
      if(['categories','seasons','opdStart','trCommission','ydCommission'].includes(k)&&d.periods?.[r.id]){
        for(const original of d.periods[r.id].originalRules){const previous=ruleOf(d,original.id);if(previous)previous.opdEnd=E.periodEnd(original,r);}
        d.note=T('Önceki dönem yalnız aynı kategori, sezon ve ülke kapsamında kapanır. Kaydetmeden önce kontrol edin.','The previous period closes only for the same category, season and country scope. Review before saving.');S.renderQueued=true;
      }
      if(E.RATE_FIELDS.includes(k)){el.classList.toggle('isInvalid',Number.isNaN(r[k]));if(r.id===d.primaryId){const twin=S.host.querySelector(`[data-row="${CSS.escape(id)}"] [data-lc-rate="${k}"]`);if(twin)twin.value=el.value;}}}
    else if(el.dataset.lcProfile)d.profile[el.dataset.lcProfile]=el.value;
    const changed=el.dataset.lcRate?ruleOf(d,d.primaryId):el.dataset.lcRule?ruleOf(d,el.dataset.lcRule):null;
    if(changed&&(el.dataset.lcRate==='hologramCost'||el.dataset.lcKey==='hologramCost')){
      const original=d.snapshot.rules.find(r=>r.id===changed.id)||d.newRuleBaselines[changed.id];
      for(const key of ['legacyTrHologramCost','legacyYdHologramCost']){
        if(original&&Number(changed.hologramCost)===Number(original.hologramCost)&&Object.hasOwn(original,key))changed[key]=original[key];else delete changed[key];
      }
    }
    d.error='';syncRow(id);
  }
  // Images are scaled in the browser so a cover stays well inside the 2 MB atlas limit.
  function resize(file,{max=640,quality=.86}={}){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onerror=reject;
      reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{
        let size=max,out='';
        for(let attempt=0;attempt<4;attempt++){
          const scale=Math.min(1,size/Math.max(img.naturalWidth||1,img.naturalHeight||1)),canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round((img.naturalWidth||1)*scale));canvas.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));
          canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
          out=canvas.toDataURL('image/webp',quality);if(!out.startsWith('data:image/webp'))out=canvas.toDataURL('image/jpeg',quality);
          if(out.length<600000)break;size=Math.round(size*.72);
        }
        out.length<700000?resolve(out):reject(new Error('IMAGE_TOO_LARGE'));
      };img.src=reader.result;};
      reader.readAsDataURL(file);
    });
  }
  window.BLLicenseCardsImage={resize};
  async function uploadCover(input){
    const id=input.dataset.lcCover,file=input.files?.[0],d=ensureDraft(id);if(!file||!d||d.conflict||!canEdit())return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024){d.error=T('PNG, JPEG veya WebP seçin (en fazla 12 MB).','Choose a PNG, JPEG or WebP image (max 12 MB).');return render();}
    try{const data=await window.BLLicenseCardsImage.resize(file);if(S.drafts.get(id)!==d||d.conflict||d.saving)return;d.cover=data;d.error='';}
    catch(_){if(S.drafts.get(id)!==d)return;d.error=T('Görsel okunamadı.','The image could not be read.');}
    render();
  }
  function bind(){
    if(S.host.dataset.lcBound)return;S.host.dataset.lcBound='1';
    S.host.addEventListener('click',e=>{
      const el=e.target.closest('[data-lc-act],[data-lc-sort],[data-lc-status],[data-lc-contract-sort]');if(!el||el.disabled)return;
      if(el.dataset.lcContractSort){const key=el.dataset.lcContractSort;S.contractSort={key,dir:S.contractSort?.key===key&&S.contractSort.dir==='asc'?'desc':'asc'};return render();}
      if(el.dataset.lcSort){const k=el.dataset.lcSort;S.sort={key:k,dir:S.sort.key===k&&S.sort.dir==='asc'?'desc':'asc'};S.animate=true;return render();}
      if(el.dataset.lcStatus){S.status=el.dataset.lcStatus;S.animate=true;return render();}
      act(el);
    });
    S.host.addEventListener('input',onInput);
    S.host.addEventListener('change',e=>{
      const el=e.target;
      if(el.id==='lcLicensor'){S.licensor=el.value===''?null:el.value==='__none__'?'':el.value;S.animate=true;return render();}
       if(el.id==='lcMergeSource'){S.manualSource=el.value;return;}
       if(el.id==='lcMergeTarget'){S.manualTarget=el.value;return;}
      if(el.dataset.lcSelect!=null){if(el.checked)S.selected.add(el.dataset.lcSelect);else S.selected.delete(el.dataset.lcSelect);return render();}
      if(el.dataset.lcSelectAll!=null){const rows=currentRows();for(const r of rows){if(el.checked)S.selected.add(r.id);else S.selected.delete(r.id);}return render();}
      if(el.dataset.lcCover!=null)uploadCover(el);
      if(el.dataset.lcLicensor!=null&&el.value.trim())setLicensor(el.dataset.lcLicensor,el.value,'assign');
    });
    S.host.addEventListener('keydown',e=>{
      if(e.target.closest?.('.lcEditor')&&e.key==='Escape')return;
      if(e.key==='Enter'&&e.target.dataset?.lcNewLicensor!=null){e.preventDefault();return S.host.querySelector(`[data-lc-act="addLicensor"][data-id="${CSS.escape(e.target.dataset.lcNewLicensor)}"]`)?.click();}
      if(e.key==='Enter'&&e.target.dataset?.lcLicensor!=null){e.preventDefault();return e.target.blur();}
      const el=e.target,id=el.dataset?.id;if(!id||!(el.dataset.lcRate!=null||el.dataset.lcRule!=null||el.dataset.lcProfile))return;
      if(e.key==='Enter'&&el.tagName!=='TEXTAREA'){e.preventDefault();el.blur();save(id);}
      if(e.key==='Escape'){e.preventDefault();dropDraft(id);el.blur();render();}
    });
    // A queued background render waits until focus leaves the fields and any click has landed.
    const flush=()=>{if(!S.renderQueued||S.pointer)return;if(!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')||!S.host.contains(document.activeElement))render();};
    S.host.addEventListener('pointerdown',()=>{S.pointer=true;});
    document.addEventListener('pointerup',()=>{if(!S.pointer)return;S.pointer=false;setTimeout(flush,0);},true);
    S.host.addEventListener('focusout',()=>setTimeout(flush,0));
  }
  window.initLicenseCardsPage=()=>{
    S.host=document.getElementById('licenseCardsPage');if(!visible())return;
    bind();
    // Startup hydrates preferences after the first paint. Refresh stars when that
    // finishes too, so a fast visit cannot keep an empty device cache on screen.
    if(typeof hydrateUserPreferencesAfterUi==='function')void hydrateUserPreferencesAfterUi().then(()=>render());
    if(!S.data||S.stale)return load();render();
  };
  window.addEventListener?.('storage',event=>{if(event.key===null||event.key===window.BLStorage?.actualKey?.(FAVORITES_KEY))render();});
  window.addEventListener?.('beforeunload',event=>{if([...S.drafts.values()].some(isDirty)||S.newCard&&(S.newCard.license||S.newCard.licensor)){event.preventDefault();event.returnValue='';}});
  window.BLLicenseCardsPage={
    openRule(id){S.contractView=false;const card=S.data?.cards?.find(c=>(S.drafts.get(c.id)?.rules||c.rules||[]).some(r=>r.id===id));if(!card)return;S.query='';S.licensor=null;S.status='all';S.favoritesOnly=false;S.expanded=card.id;S.historyOpen=false;S.addLicensorOpen=false;document.activeElement?.blur?.();const draft=ensureDraft(card.id);draft.primaryId=id;render();},
    invalidate(){S.stale=true;S.stats.clear();if(![...S.drafts.values()].some(d=>d.saving)&&visible())return load();},
    renderLanguage(){render();},
  };
})();
