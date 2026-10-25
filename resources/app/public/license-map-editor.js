/* Buyer Log — compact approval map editor (License cards › row › Map).
   Edits one card's processAtlas in a side drawer: ordered steps with who approves,
   routes, test and supplier sharing; addresses, portal and requirements below.
   Unknown atlas fields are preserved; the server validates with BLLicenseAtlasEngine. */
(() => {
  'use strict';
  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,en)=>isEn()?en:tr;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=v=>JSON.parse(JSON.stringify(v));
  const uid=prefix=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const LOCAL=new Set(['title','supplierInstructions','note','approvalNotes','testNotes','label','requirements','notes']);
  // English edits live in i18n.en, Turkish in the base field (same model as the original atlas).
  const lx=(o,k)=>isEn()&&LOCAL.has(k)?(o?.i18n?.en?.[k]??o?.[k]??''):(o?.[k]??'');
  function setLx(o,k,v){if(isEn()&&LOCAL.has(k)){o.i18n=o.i18n||{};o.i18n.en=o.i18n.en||{};o.i18n.en[k]=v;}else o[k]=v;}
  const S={root:null,draft:null,base:'',card:null,cards:[],canEdit:false,onSave:null,saving:false,open:new Set(),error:'',
    mode:'map',templates:[],onSaveTemplate:null,onDeleteTemplate:null,tpl:null,lock:false};
  const L=()=>S.draft.license;
  const labels=kind=>window.BLLicenseSupplierAtlas.LABELS[kind];
  const optionLabel=(kind,value)=>window.BLLicenseSupplierAtlas.label(S.draft||{},kind,value,isEn());
  function options(kind,current){
    const known=Object.keys(labels(kind)),custom=(S.draft.customSelectOptions?.[kind]||[]).map(o=>o.value);
    const values=[...new Set([...known,...custom,...(current&&!known.includes(current)&&!custom.includes(current)?[current]:[])])];
    return values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(optionLabel(kind,v))}</option>`).join('');
  }
  const snapshot=()=>JSON.stringify(S.draft)+(S.tpl?'|'+S.tpl.name:'');
  const dirty=()=>snapshot()!==S.base;
  const ro=()=>!S.canEdit||S.saving;
  const dis=()=>ro()||S.lock?'disabled':'';
  function toggle(path,on,label){return `<label class="lmToggle"><input type="checkbox" data-lm="${esc(path)}" ${on?'checked':''} ${dis()}><span>${esc(label)}</span></label>`;}
  function field(path,value,labelText,{area=false,placeholder='',cls=''}={}){
    const control=area?`<textarea rows="2" data-lm="${esc(path)}" placeholder="${esc(placeholder)}" ${dis()}>${esc(value)}</textarea>`:`<input data-lm="${esc(path)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${dis()}>`;
    return `<label class="lmField ${cls}"><span>${esc(labelText)}</span>${control}</label>`;
  }
  function select(path,kind,value,labelText,{custom=false}={}){
    if(custom&&S.adding?.path===path)return newTagHtml(path,labelText,false);
    return `<label class="lmField"><span>${esc(labelText)}</span><select data-lm="${esc(path)}" ${dis()}>${options(kind,value)}${custom&&!dis()?`<option value="__new__">${esc(T('＋ Yeni etiket…','＋ New label…'))}</option>`:''}</select></label>`;
  }
  // Inline "new label" / "new address" entry that replaces the select until added or cancelled.
  function newTagHtml(path,labelText,address){
    return `<div class="lmField lmNewTag${address?' isAddress':''}"><span>${esc(labelText)}</span><span class="lmNewTagRow">
      <input data-lm-new="label" maxlength="120" placeholder="${esc(address?T('Adres adı','Address name'):T('Etiket','Label'))}" aria-label="${esc(address?T('Adres adı','Address name'):T('Yeni etiket','New label'))}">
      ${address?`<input data-lm-new="text" maxlength="1000" placeholder="${esc(T('Adres (isteğe bağlı)','Address (optional)'))}" aria-label="${esc(T('Adres','Address'))}">`:''}
      <button type="button" class="lcIconBtn isPrimary" data-lm-act="addTag" title="${esc(T('Ekle (Enter)','Add (Enter)'))}"><svg class="ic"><use href="#i-check"/></svg></button><button type="button" class="lcIconBtn" data-lm-act="cancelTag" title="${esc(T('Vazgeç (Esc)','Cancel (Esc)'))}"><svg class="ic"><use href="#i-x"/></svg></button></span></div>`;
  }
  function addTag(){
    const {path,kind}=S.adding||{};if(!path||ro())return;
    const label=(S.root.querySelector('[data-lm-new="label"]')?.value||'').trim(),text=(S.root.querySelector('[data-lm-new="text"]')?.value||'').trim();
    if(!label){S.root.querySelector('[data-lm-new="label"]')?.focus();return;}
    const [obj,key]=target(path);if(!obj)return;
    if(kind==='address'){
      const same=addresses().find(a=>String(lx(a,'label')).toLocaleLowerCase('tr')===label.toLocaleLowerCase('tr'));
      if(same)obj[key]=same.id;
      else{const id=uid('address');(L().addresses=L().addresses||[]).push({id,label,text,manufacturerVisible:true});obj[key]=id;}
    }else{
      // The value is the label itself, so a step copied or templated elsewhere still reads right.
      const all=[...Object.keys(labels(kind)),...(S.draft.customSelectOptions?.[kind]||[]).map(o=>o.value)];
      const same=all.find(v=>[v,optionLabel(kind,v)].some(x=>String(x).toLocaleLowerCase('tr')===label.toLocaleLowerCase('tr')));
      if(same)obj[key]=same;
      else{S.draft.customSelectOptions=S.draft.customSelectOptions||{};(S.draft.customSelectOptions[kind]=S.draft.customSelectOptions[kind]||[]).push({value:label,label});obj[key]=label;}
    }
    S.adding=null;S.error='';render();
  }
  function addresses(){const seen=new Map();for(const a of [...(L().addresses||[]),...(S.draft.sharedAddresses||[])])if(!seen.has(a.id))seen.set(a.id,a);return [...seen.values()];}

  function routeHtml(si,r,ri){
    const p=`s.${si}.r.${ri}`;
    return `<div class="lmRoute" data-route="${ri}">
      ${select(p+'.method','method',r.method||'email',T('Nasıl','Method'))}
      ${select(p+'.recipientType','recipientType',r.recipientType||'unknown',T('Kime','Recipient'))}
      ${field(p+'.recipient',r.recipient||'',T('Alıcı / kişi','Contact'))}
      ${field(p+'.qty',r.qty||'',T('Adet','Qty'),{placeholder:T('ör. 2','e.g. 2')})}
      ${select(p+'.timing','timing',r.timing||'approval',T('Zaman','Timing'),{custom:true})}
      ${S.adding?.path===p+'.addressId'?newTagHtml(p+'.addressId',T('Adres','Address'),true):`<label class="lmField"><span>${esc(T('Adres','Address'))}</span><select data-lm="${p}.addressId" ${dis()}><option value="">—</option>${addresses().map(a=>`<option value="${esc(a.id)}" ${a.id===r.addressId?'selected':''}>${esc(lx(a,'label')||String(a.text||'').slice(0,40))}</option>`).join('')}${dis()?'':`<option value="__new__">${esc(T('＋ Yeni adres…','＋ New address…'))}</option>`}</select></label>`}
      <button type="button" class="lcIconBtn lmDanger" data-lm-act="removeRoute" data-s="${si}" data-r="${ri}" title="${esc(T('Gönderimi sil','Remove route'))}" ${dis()}><svg class="ic"><use href="#i-trash"/></svg></button>
      ${field(p+'.supplierInstructions',lx(r,'supplierInstructions'),T('Üretici talimatı','Supplier instruction'),{area:true,cls:'lmWide'})}
      <div class="lmWide lmFlags">${toggle(p+'.manufacturerVisible',r.manufacturerVisible!==false,T('Üreticiyle paylaş','Share with supplier'))}</div>
    </div>`;
  }
  const templateOf=s=>s?.templateId?S.templates.find(t=>t.id===s.templateId)||null:null;
  // A stage linked to a template is edited only through the template (map mode).
  const lockedStage=s=>S.mode==='map'&&Boolean(templateOf(s));
  function stageHtml(s,si,count){S.lock=lockedStage(s);try{return stageInner(s,si,count,templateOf(s));}finally{S.lock=false;}}
  function stageInner(s,si,count,tpl){
    const p=`s.${si}`,open=S.open.has(s.id),guide=(S.draft.visualLibrary||[]).find(v=>v.id===s.visualGuideId),inTemplate=S.mode==='template';
    const approvers=['LCW','licensor','mixed','unknown'].concat(s.approver==='agency'?['agency']:[]);
    return `<li class="lmStage${open?' isOpen':''}${s.enabled===false?' isOff':''}" data-stage="${esc(s.id)}">
      <div class="lmStageRow">
        <span class="lmNum">${si+1}</span>
        <span class="lmTitleBox"><input class="lmTitle" data-lm="${p}.title" value="${esc(lx(s,'title'))}" placeholder="${esc(T('Adım adı','Step name'))}" aria-label="${esc(T('Adım adı','Step name'))}" ${dis()}>${tpl&&!inTemplate?`<span class="lmTpl" title="${esc(T('Bu adım taslaktan yönetilir','This step is managed by a template'))}"><svg class="ic"><use href="#i-copy"/></svg>${esc(tpl.name)}</span>`:''}</span>
        <div class="lcSeg" role="group" aria-label="${esc(T('Onaylayan','Approver'))}">${approvers.map(v=>`<button type="button" data-lm-act="approver" data-s="${si}" data-v="${v}" aria-pressed="${(s.approver||'unknown')===v}" ${dis()}>${esc(optionLabel('approver',v))}</button>`).join('')}</div>
        <button type="button" class="lcChip" data-lm-act="flag" data-s="${si}" data-k="testRequired" aria-pressed="${s.testRequired===true}" data-no-i18n ${dis()}>${esc(T('Test','Test'))}</button>
        <button type="button" class="lcChip" data-lm-act="flag" data-s="${si}" data-k="manufacturerVisible" aria-pressed="${s.manufacturerVisible!==false}" title="${esc(T('Üretici atlasında göster','Show in supplier atlas'))}" ${dis()}>${esc(T('Üretici','Supplier'))}</button>
        <span class="lmCount">${(s.submissions||[]).length} ${esc(T('gönderim','routes'))}</span>
        <span class="lmTools"${inTemplate?' hidden':''}>
          <button type="button" class="lcIconBtn" data-lm-act="move" data-s="${si}" data-d="-1" title="${esc(T('Yukarı','Up'))}" ${si===0||ro()?'disabled':''}><svg class="ic"><use href="#i-chevron-up"/></svg></button>
          <button type="button" class="lcIconBtn" data-lm-act="move" data-s="${si}" data-d="1" title="${esc(T('Aşağı','Down'))}" ${si===count-1||ro()?'disabled':''}><svg class="ic"><use href="#i-chevron-down"/></svg></button>
          <button type="button" class="lcIconBtn lmDanger" data-lm-act="removeStage" data-s="${si}" title="${esc(T('Adımı sil','Delete step'))}" ${ro()?'disabled':''}><svg class="ic"><use href="#i-trash"/></svg></button>
          <button type="button" class="lcIconBtn lmExpand" data-lm-act="expand" data-id="${esc(s.id)}" aria-expanded="${open}" title="${esc(T('Ayrıntılar','Details'))}"><svg class="ic"><use href="#i-chevron-down"/></svg></button>
        </span>
      </div>
      <div class="lmMore"><div class="lmMoreIn">
        ${S.lock?`<p class="lmLinked"><span>${esc(T(`Bu adım “${tpl.name}” taslağından gelir; taslak güncellenince bu taslağı kullanan tüm lisanslarda güncellenir.`,`This step comes from the “${tpl.name}” template; updating the template updates every license that uses it.`))}</span><button type="button" class="lcBtn sm" data-lm-act="detach" data-s="${si}" ${ro()?'disabled':''}>${esc(T('Taslaktan ayır','Detach from template'))}</button></p>`:''}
        <div class="lmGrid">
          ${field(p+'.supplierInstructions',lx(s,'supplierInstructions'),T('Üretici talimatı','Supplier instruction'),{area:true})}
          ${field(p+'.approvalNotes',lx(s,'approvalNotes'),T('Onay koşulu','Approval condition'),{area:true})}
          ${field(p+'.note',lx(s,'note'),T('İç not','Internal note'),{area:true})}
        </div>
        <div class="lmFlags">${toggle(p+'.supplierShowApprovalNotes',s.supplierShowApprovalNotes!==false,T('Onay koşulunu paylaş','Share approval condition'))}${toggle(p+'.supplierShowSourceNote',s.supplierShowSourceNote===true,T('İç notu paylaş','Share internal note'))}${inTemplate?'':(()=>{const lock=S.lock;S.lock=false;try{return toggle(p+'.enabled',s.enabled!==false,T('Adım aktif','Step active'));}finally{S.lock=lock;}})()}${!inTemplate&&!tpl&&S.canEdit&&S.onSaveTemplate&&S.naming!==s.id?`<button type="button" class="lcBtn sm" data-lm-act="nameTemplate" data-id="${esc(s.id)}" ${ro()?'disabled':''}><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Taslak olarak kaydet','Save as template'))}</button>`:''}</div>
        ${S.naming===s.id?`<div class="lmNaming"><input id="lmTemplateName" value="${esc(lx(s,'title'))}" maxlength="120" aria-label="${esc(T('Taslak adı','Template name'))}" placeholder="${esc(T('Taslak adı','Template name'))}"><button type="button" class="lcBtn sm primary" data-lm-act="saveAsTemplate" data-s="${si}" ${ro()?'disabled':''}>${esc(T('Taslağı oluştur','Create template'))}</button><button type="button" class="lcBtn sm" data-lm-act="cancelNaming">${esc(T('Vazgeç','Cancel'))}</button></div>`:''}
        ${s.testRequired?`<div class="lmGrid">${field(p+'.testQty',s.testQty||'',T('Test adedi','Test quantity'))}${field(p+'.testNotes',lx(s,'testNotes'),T('Test koşulu','Test condition'))}</div>`:''}
        <div class="lmSub"><b>${esc(T('Gönderimler','Routes'))}</b><button type="button" class="lcBtn sm" data-lm-act="addRoute" data-s="${si}" ${dis()}><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Gönderim ekle','Add route'))}</button></div>
        <div class="lmRoutes">${(s.submissions||[]).map((r,ri)=>routeHtml(si,r,ri)).join('')||`<p class="lmMuted">${esc(T('Gönderim yok.','No routes.'))}</p>`}</div>
        <div class="lmSub"><b>${esc(T('Görsel kılavuz','Visual guide'))}</b><span>${guide?`<button type="button" class="lcBtn sm" data-lm-act="removeGuide" data-s="${si}" ${dis()}>${esc(T('Kaldır','Remove'))}</button>`:''}<label class="lcBtn sm${ro()?' isDisabled':''}"><svg class="ic"><use href="#i-picture"/></svg>${esc(guide?T('Değiştir','Replace'):T('Görsel yükle','Upload image'))}<input type="file" accept="image/png,image/jpeg,image/webp" data-lm-guide="${si}" hidden ${dis()}></label></span></div>
        ${guide?`<img class="lmGuide" src="${esc(guide.data)}" alt="${esc(guide.name)}">`:''}
      </div></div>
    </li>`;
  }
  function render(){
    if(!S.root)return;
    if(S.mode==='templates')return renderTemplates();
    if(S.mode==='template')return renderTemplate();
    const l=L(),stages=l.stages||[],sources=S.cards.filter(c=>c.id!==S.card.id&&c.processAtlas?.license?.stages?.length);
    const scroll=S.root.querySelector('.lmBody')?.scrollTop||0,focus=document.activeElement?.dataset?.lm;
    S.root.innerHTML=`<aside class="lmDrawer" role="dialog" aria-modal="true" aria-label="${esc(T('Onay haritası','Approval map'))}">
      <header class="lmHead"><div><span class="lmEyebrow">${esc(T('Onay haritası','Approval map'))}</span><h2>${esc(S.card.license)}</h2><p>${esc(S.card.licensor||T('Lisansör belirtilmedi','Licensor not specified'))}</p></div>
        <div class="lmHeadTools">${toggle('license.manufacturerVisible',l.manufacturerVisible!==false,T('Üretici atlasına dahil','Include in supplier atlas'))}<button type="button" class="lcIconBtn" data-lm-act="close" title="${esc(T('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
      <div class="lmBody">
        <ol class="lmFlow" aria-label="${esc(T('Adımlar','Steps'))}">${stages.map(s=>`<li class="lmFlowStep ${esc(s.approver||'unknown')}${s.enabled===false?' isOff':''}" title="${esc(lx(s,'title'))}"><i></i><span>${esc(lx(s,'title')||'—')}</span></li>`).join('')||`<li class="lmMuted">${esc(T('Henüz adım yok','No steps yet'))}</li>`}</ol>
        <ol class="lmStages">${stages.map((s,i)=>stageHtml(s,i,stages.length)).join('')}</ol>
        <div class="lmAdd">
          <button type="button" class="lcBtn" data-lm-act="addStage" ${dis()}><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Adım ekle','Add step'))}</button>
          ${S.templates.length?`<span class="lmCopy"><select id="lmTplSource" aria-label="${esc(T('Aşama taslağı','Stage template'))}" ${dis()}><option value="">${esc(T('Taslaktan adım ekle…','Add step from template…'))}</option>${S.templates.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><button type="button" class="lcBtn" data-lm-act="addFromTemplate" ${dis()}><svg class="ic"><use href="#i-copy-plus"/></svg>${esc(T('Ekle','Add'))}</button></span>`:''}
          ${sources.length?`<span class="lmCopy"><select id="lmCopySource" aria-label="${esc(T('Kopyalanacak lisans','License to copy from'))}" ${dis()}><option value="">${esc(T('Başka lisanstan kopyala…','Copy from another license…'))}</option>${sources.map(c=>`<option value="${esc(c.id)}">${esc(c.license)} · ${esc(c.licensor||'—')} (${c.processAtlas.license.stages.length})</option>`).join('')}</select><button type="button" class="lcBtn" data-lm-act="copy" ${dis()}><svg class="ic"><use href="#i-copy"/></svg>${esc(T('Adımları ekle','Add steps'))}</button></span>`:''}
        </div>
        <details class="lmMoreBox"><summary>${esc(T('Adresler','Addresses'))} <small>${(l.addresses||[]).length}</small></summary>
          ${(l.addresses||[]).map((a,ai)=>`<div class="lmAddress">${field(`a.${ai}.label`,lx(a,'label'),T('Ad','Name'))}${field(`a.${ai}.text`,a.text||'',T('Adres','Address'),{area:true})}<div class="lmFlags">${toggle(`a.${ai}.manufacturerVisible`,a.manufacturerVisible!==false,T('Üreticiyle paylaş','Share with supplier'))}<button type="button" class="lcIconBtn lmDanger" data-lm-act="removeAddress" data-a="${ai}" title="${esc(T('Adresi sil','Delete address'))}" ${dis()}><svg class="ic"><use href="#i-trash"/></svg></button></div></div>`).join('')}
          <button type="button" class="lcBtn sm" data-lm-act="addAddress" ${dis()}><svg class="ic"><use href="#i-map-pin"/></svg>${esc(T('Adres ekle','Add address'))}</button>
        </details>
        <details class="lmMoreBox"><summary>${esc(T('Portal ve genel gereksinimler','Portal and general requirements'))}</summary>
          <div class="lmGrid">${field('portal.url',l.portal?.url||'',T('Portal adresi','Portal URL'),{placeholder:'https://'})}${field('portal.notes',lx(l.portal||{},'notes'),T('Portal notu','Portal note'),{area:true})}${field('license.requirements',lx(l,'requirements'),T('Genel gereksinimler','General requirements'),{area:true})}</div>
          <div class="lmFlags">${toggle('portal.manufacturerVisible',l.portal?.manufacturerVisible===true,T('Portalı paylaş','Share portal'))}${toggle('license.supplierShowRequirements',l.supplierShowRequirements!==false,T('Gereksinimleri paylaş','Share requirements'))}</div>
        </details>
      </div>
      <footer class="lmFoot"><span class="lmStatus" role="status">${esc(S.error||(dirty()?T('Kaydedilmemiş değişiklikler var.','Unsaved changes.'):T('Değişiklik yok.','No changes.')))}</span>
        <button type="button" class="lcBtn" data-lm-act="close">${esc(dirty()?T('Vazgeç','Cancel'):T('Kapat','Close'))}</button>
        ${S.canEdit?`<button type="button" class="lcBtn primary" data-lm-act="save" ${S.saving||!dirty()?'disabled':''}>${esc(S.saving?T('Kaydediliyor…','Saving…'):T('Kaydet','Save'))}</button>`:''}</footer>
    </aside>`;
    S.root.classList.toggle('isError',Boolean(S.error));
    const body=S.root.querySelector('.lmBody');if(body)body.scrollTop=scroll;
    if(focus){const el=S.root.querySelector(`[data-lm="${CSS.escape(focus)}"]`);el?.focus({preventScroll:true});}
  }
  function status(){const el=S.root?.querySelector('.lmStatus');if(el)el.textContent=S.error||(dirty()?T('Kaydedilmemiş değişiklikler var.','Unsaved changes.'):T('Değişiklik yok.','No changes.'));const save=S.root?.querySelector('[data-lm-act="save"],[data-lm-act="tplSave"]');if(save)save.disabled=S.saving||!dirty();}
  // data-lm path → owning object and key.
  function target(path){
    const parts=path.split('.'),l=L();
    if(parts[0]==='license')return [l,parts[1]];
    if(parts[0]==='portal'){l.portal=l.portal||{url:'',notes:''};return [l.portal,parts[1]];}
    if(parts[0]==='a')return [l.addresses[Number(parts[1])],parts[2]];
    const stage=l.stages[Number(parts[1])];
    return parts[2]==='r'?[stage.submissions[Number(parts[3])],parts[4]]:[stage,parts[2]];
  }
  function onInput(event){
    const el=event.target;
    if(el.id==='lmTemplateNameEdit'&&S.tpl&&!ro()){S.tpl.name=el.value;S.error='';return status();}
    if(!el.dataset.lm||ro())return;
    const parts=el.dataset.lm.split('.');if(parts[0]==='s'&&lockedStage(L().stages[Number(parts[1])])&&parts[2]!=='enabled')return;
    const [obj,key]=target(el.dataset.lm);if(!obj)return;
    if(el.tagName==='SELECT'&&el.value==='__new__'){S.adding={path:el.dataset.lm,kind:key==='addressId'?'address':key};render();S.root.querySelector('[data-lm-new="label"]')?.focus();return;}
    if(el.type==='checkbox')obj[key]=el.checked;else if(el.tagName==='SELECT')obj[key]=el.value;else setLx(obj,key,el.value);
    if(key==='title'){const flow=S.root.querySelectorAll('.lmFlowStep span')[Number(el.dataset.lm.split('.')[1])];if(flow)flow.textContent=el.value||'—';}
    S.error='';if(el.type==='checkbox'||el.tagName==='SELECT')render();else status();
  }
  function guideUpload(input){
    const file=input.files?.[0],si=Number(input.dataset.lmGuide),draft=S.draft;if(!file||ro())return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>12*1024*1024){S.error=T('PNG, JPEG veya WebP seçin (en fazla 12 MB).','Choose a PNG, JPEG or WebP image (max 12 MB).');render();return;}
    window.BLLicenseCardsImage.resize(file,{max:1400,quality:.84}).then(data=>{
      if(S.draft!==draft)return;
      const stage=L().stages[si],previous=stage.visualGuideId,id=uid('guide');
      S.draft.visualLibrary=(S.draft.visualLibrary||[]).filter(v=>v.id!==previous||L().stages.some(s=>s!==stage&&s.visualGuideId===previous));
      S.draft.visualLibrary.push({id,name:file.name.slice(0,180),data});stage.visualGuideId=id;S.error='';render();
    }).catch(()=>{if(S.draft===draft){S.error=T('Görsel okunamadı.','The image could not be read.');render();}});
  }
  // Steps from another license: new ids; the addresses and guides they use come along.
  function copySteps(sourceId){
    const source=S.cards.find(c=>c.id===sourceId)?.processAtlas;if(!source)return;
    const l=L(),known=new Set((l.addresses||[]).map(a=>a.id)),addressMap=new Map();
    for(const st of source.license.stages||[]){
      const stage=copy(st);stage.id=uid('stage');
      if(stage.visualGuideId){const guide=(source.visualLibrary||[]).find(v=>v.id===stage.visualGuideId);
        if(guide){if(!(S.draft.visualLibrary||[]).some(v=>v.id===guide.id))(S.draft.visualLibrary=S.draft.visualLibrary||[]).push(copy(guide));}else stage.visualGuideId='';}
      stage.submissions=(stage.submissions||[]).map(r=>{const route={...r,id:uid('route')};
        if(r.addressId&&!known.has(r.addressId)){const address=[...(source.license.addresses||[]),...(source.sharedAddresses||[])].find(a=>a.id===r.addressId);
          if(address){if(!addressMap.has(address.id)){const added={...copy(address),id:uid('address')};addressMap.set(address.id,added.id);l.addresses.push(added);}route.addressId=addressMap.get(address.id);}else route.addressId='';}
        return route;});
      l.stages.push(stage);
    }
  }
  async function save(){
    if(ro()||!dirty())return;
    const atlas=copy(S.draft);atlas.license.id=S.card.id;atlas.license.name=S.card.license;atlas.license.agency=S.card.licensor||'';
    try{window.BLLicenseAtlasEngine.normalize(atlas);}catch(_){S.error=T('Harita 2 MB sınırını aşıyor veya geçersiz bir alan içeriyor. Görselleri küçültün.','The map exceeds 2 MB or has an invalid field. Use smaller images.');render();return;}
    if(atlas.license.portal?.url){try{const u=new URL(atlas.license.portal.url);if(!['http:','https:'].includes(u.protocol))throw 0;}catch(_){S.error=T('Portal adresi http:// veya https:// ile başlamalı.','The portal URL must start with http:// or https://.');render();return;}}
    S.saving=true;S.error='';render();
    try{await S.onSave(atlas);S.saving=false;close(true);}
    catch(error){S.saving=false;S.error=error?.message||T('Harita kaydedilemedi.','The map could not be saved.');render();}
  }
  function act(el){
    const a=el.dataset.lmAct,si=Number(el.dataset.s),l=S.draft?L():null;
    if(a==='close')return close();
    if(a==='save')return save();
    if(a==='expand'){const li=el.closest('.lmStage'),open=!li.classList.contains('isOpen');li.classList.toggle('isOpen',open);el.setAttribute('aria-expanded',open);if(open)S.open.add(el.dataset.id);else S.open.delete(el.dataset.id);return;}
    if(a.startsWith('tpl'))return templateAct(a,el);
    if(a==='addTag')return addTag();
    if(a==='cancelTag'){S.adding=null;return render();}
    if(ro())return;
    if(['approver','flag','addRoute','removeRoute','removeGuide'].includes(a)&&lockedStage(l.stages[si]))return;
    if(a==='detach'){delete l.stages[si].templateId;}
    if(a==='addFromTemplate'){const t=S.templates.find(x=>x.id===S.root.querySelector('#lmTplSource')?.value);if(!t)return;const id=uid('stage');l.stages.push(applyTemplate({id,enabled:true},t));S.open.add(id);}
    if(a==='nameTemplate'){S.naming=el.dataset.id;render();S.root.querySelector('#lmTemplateName')?.select();return;}
    if(a==='cancelNaming'){S.naming='';return render();}
    if(a==='saveAsTemplate')return saveAsTemplate(si);
    if(a==='approver')l.stages[si].approver=el.dataset.v;
    if(a==='flag'){const st=l.stages[si],k=el.dataset.k;st[k]=k==='manufacturerVisible'?st[k]===false:!(st[k]===true);}
    if(a==='move'){const j=si+Number(el.dataset.d);if(j<0||j>=l.stages.length)return;[l.stages[si],l.stages[j]]=[l.stages[j],l.stages[si]];}
    if(a==='removeStage'){if(!confirm(T('Bu adım silinsin mi?','Delete this step?')))return;const [gone]=l.stages.splice(si,1);if(gone?.visualGuideId&&!l.stages.some(s=>s.visualGuideId===gone.visualGuideId))S.draft.visualLibrary=(S.draft.visualLibrary||[]).filter(v=>v.id!==gone.visualGuideId);}
    if(a==='addStage'){const id=uid('stage');l.stages.push({id,title:T('Yeni adım','New step'),enabled:true,icon:'layers',approver:'unknown',approvalNotes:'',testRequired:false,testQty:'',testNotes:'',description:'',submissions:[],manufacturerVisible:true,supplierShowApprovalNotes:true,supplierShowSourceNote:false});S.open.add(id);}
    if(a==='addRoute')(l.stages[si].submissions=l.stages[si].submissions||[]).push({id:uid('route'),method:'email',recipientType:'unknown',recipient:'',qty:'',timing:'approval',addressId:'',note:'',manufacturerVisible:true,supplierShowNotes:false});
    if(a==='removeRoute')l.stages[si].submissions.splice(Number(el.dataset.r),1);
    if(a==='removeGuide'){const id=l.stages[si].visualGuideId;l.stages[si].visualGuideId='';if(!l.stages.some(s=>s.visualGuideId===id))S.draft.visualLibrary=(S.draft.visualLibrary||[]).filter(v=>v.id!==id);}
    if(a==='addAddress')(l.addresses=l.addresses||[]).push({id:uid('address'),label:T('Gönderim adresi','Shipping address'),text:'',manufacturerVisible:true});
    if(a==='removeAddress'){const [gone]=l.addresses.splice(Number(el.dataset.a),1);for(const st of l.stages)for(const r of st.submissions||[])if(r.addressId===gone?.id)r.addressId='';}
    if(a==='copy'){const id=S.root.querySelector('#lmCopySource')?.value;if(!id)return;copySteps(id);}
    S.error='';render();
    if(a==='addStage')S.root.querySelector('.lmStage:last-child .lmTitle')?.select();
  }
  function onKey(event){
    if(!S.root)return;
    if(S.adding&&event.target?.dataset?.lmNew!=null){
      if(event.key==='Enter'){event.preventDefault();return addTag();}
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();S.adding=null;return render();}
    }
    if(event.key==='Escape'){event.preventDefault();close();}
  }
  function close(saved=false){
    if(!S.root)return;
    if(S.mode==='template'&&!saved){if(dirty()&&!confirm(T('Kaydedilmemiş taslak değişiklikleri bırakılsın mı?','Discard unsaved template changes?')))return;showTemplateList();return;}
    if(S.mode==='map'&&!saved&&dirty()&&!S.saving&&!confirm(T('Kaydedilmemiş harita değişiklikleri bırakılsın mı?','Discard unsaved map changes?')))return;
    const root=S.root;S.releaseKeyboard?.();S.releaseKeyboard=null;S.root=null;document.removeEventListener('keydown',onKey,true);
    root.classList.add('isClosing');setTimeout(()=>root.remove(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);
  }
  function blank(card){return {version:1,license:{id:card.id,name:card.license,agency:card.licensor||'',category:'',symbol:'✦',stages:[],addresses:[],portal:{url:'',notes:'',manufacturerVisible:false},manufacturerVisible:true,supplierShowRequirements:true},sharedAddresses:[],visualLibrary:[],customSelectOptions:{},processTemplates:[],stageClipboard:null};}
  function open({card,cards=[],canEdit=false,onSave,templates=[],onSaveTemplate=null}){
    if(S.root)close(true);
    Object.assign(S,{adding:null,mode:'map',card,cards,canEdit:Boolean(canEdit),onSave,templates:copy(templates),onSaveTemplate,tpl:null,naming:'',notice:'',saving:false,error:'',open:new Set()});
    S.draft=card.processAtlas?window.BLLicenseSupplierAtlas.prepare(card.processAtlas):blank(card);
    S.draft.license.stages=S.draft.license.stages||[];S.draft.license.addresses=S.draft.license.addresses||[];
    S.base=snapshot();
    mount();
  }
  function mount(){
    S.root=document.createElement('div');S.root.className='lmScrim';S.root.dataset.uiMigrated='commercial';document.body.append(S.root);
    S.root.addEventListener('input',onInput);S.root.addEventListener('change',event=>{if(event.target.dataset.lmGuide!=null)guideUpload(event.target);});
    S.root.addEventListener('click',event=>{const el=event.target.closest('[data-lm-act]');if(el&&!el.disabled)act(el);else if(event.target===S.root)close();});
    S.root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='lmTemplateName'){event.preventDefault();S.root.querySelector('[data-lm-act="saveAsTemplate"]')?.click();}});
    document.addEventListener('keydown',onKey,true);
    render();S.releaseKeyboard=window.BLUI?.bindDialogKeyboard(S.root);S.root.querySelector('.lmTitle,.lcBtn')?.focus({preventScroll:true});
  }
  /* ---- Stage templates ---- */
  // Same rules as the server (license-cards.js applyTemplate): content from the template,
  // the stage keeps its id and on/off state; addresses and the guide image come along.
  function applyTemplate(base,t){
    const l=L(),own=id=>`tpl-${t.id}-${id}`,st={...copy(t.stage),id:base.id,enabled:base.enabled!==false,templateId:t.id};
    st.submissions=(st.submissions||[]).map(r=>({...r,addressId:r.addressId?own(r.addressId):''}));
    l.addresses=l.addresses||[];
    for(const a of t.addresses||[]){const c={...copy(a),id:own(a.id)},i=l.addresses.findIndex(x=>x.id===c.id);if(i<0)l.addresses.push(c);else l.addresses[i]=c;}
    S.draft.visualLibrary=S.draft.visualLibrary||[];
    const vid='tpl-'+t.id,vi=S.draft.visualLibrary.findIndex(v=>v.id===vid);
    if(t.visual){const entry={id:vid,name:t.visual.name,data:t.visual.data};if(vi<0)S.draft.visualLibrary.push(entry);else S.draft.visualLibrary[vi]=entry;st.visualGuideId=vid;}
    else st.visualGuideId='';
    return st;
  }
  function templateFromStage(s,name,id){
    const st=copy(s),guide=(S.draft.visualLibrary||[]).find(v=>v.id===st.visualGuideId),used=new Set((st.submissions||[]).map(r=>r.addressId).filter(Boolean));
    for(const k of ['id','templateId','enabled','visualGuideId'])delete st[k];
    return {id,name,stage:st,addresses:addresses().filter(a=>used.has(a.id)).map(copy),visual:guide?{name:guide.name,data:guide.data}:null};
  }
  async function saveAsTemplate(si){
    const s=L().stages[si],name=(S.root.querySelector('#lmTemplateName')?.value||'').trim();
    if(!name){S.error=T('Taslak adı girin.','Enter a template name.');return render();}
    const template=templateFromStage(s,name,uid('stage-template'));
    S.saving=true;render();
    try{
      const result=await S.onSaveTemplate({template});S.templates=copy(result.templates||[]);
      const saved=S.templates.find(t=>t.id===template.id);if(saved)L().stages[si]=applyTemplate(s,saved);
      S.saving=false;S.naming='';S.error='';render();
    }catch(error){fresh(error);S.saving=false;S.error=error?.message||T('Taslak kaydedilemedi.','The template could not be saved.');render();}
  }
  const usage=t=>S.cards.filter(c=>(c.processAtlas?.license?.stages||[]).some(s=>s.templateId===t.id));
  function renderTemplates(){
    S.root.innerHTML=`<aside class="lmDrawer" role="dialog" aria-modal="true" aria-label="${esc(T('Aşama taslakları','Stage templates'))}">
      <header class="lmHead"><div><span class="lmEyebrow">${esc(T('Lisans kartları','License cards'))}</span><h2>${esc(T('Aşama taslakları','Stage templates'))}</h2><p>${esc(T('Bir taslağı güncellediğinizde onu kullanan tüm lisanslardaki adım da güncellenir.','Updating a template updates the step in every license that uses it.'))}</p></div>
        <div class="lmHeadTools">${S.canEdit?`<button type="button" class="lcBtn primary" data-lm-act="tplNew"><svg class="ic"><use href="#i-plus"/></svg>${esc(T('Yeni taslak','New template'))}</button>`:''}<button type="button" class="lcIconBtn" data-lm-act="close" title="${esc(T('Kapat','Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
      <div class="lmBody">${S.notice?`<p class="lmNotice" role="status">${esc(S.notice)}</p>`:''}${S.error?`<p class="lmNotice isError" role="alert">${esc(S.error)}</p>`:''}
        <ol class="lmTemplates">${S.templates.map(t=>{const used=usage(t);return `<li class="lmTemplate ap-${esc(t.stage?.approver||'unknown')}"><i></i>
          <div><b>${esc(t.name)}</b><small>${esc(optionLabel('approver',t.stage?.approver||'unknown'))} · ${(t.stage?.submissions||[]).length} ${esc(T('gönderim','routes'))}${t.stage?.testRequired?' · Test':''}</small></div>
          <span class="lmUsage" title="${esc(used.map(c=>`${c.license} · ${c.licensor||'—'}`).join('\n'))}">${used.length} ${esc(T('lisansta','licenses'))}</span>
          <span class="lmTools">${S.canEdit?`<button type="button" class="lcBtn sm" data-lm-act="tplEdit" data-id="${esc(t.id)}"><svg class="ic"><use href="#i-pencil"/></svg>${esc(T('Düzenle','Edit'))}</button><button type="button" class="lcIconBtn lmDanger" data-lm-act="tplDelete" data-id="${esc(t.id)}" title="${esc(T('Taslağı sil','Delete template'))}"><svg class="ic"><use href="#i-trash"/></svg></button>`:''}</span></li>`;}).join('')||`<li class="lmMuted">${esc(T('Henüz aşama taslağı yok. Haritada bir adımı “Taslak olarak kaydet” ile veya “Yeni taslak” ile oluşturun.','No stage templates yet. Create one with “Save as template” on a map step or with “New template”.'))}</li>`}</ol>
      </div></aside>`;
  }
  function renderTemplate(){
    const l=L(),used=S.tpl.isNew?[]:usage(S.tpl),scroll=S.root.querySelector('.lmBody')?.scrollTop||0,focus=document.activeElement?.dataset?.lm||document.activeElement?.id;
    S.root.innerHTML=`<aside class="lmDrawer" role="dialog" aria-modal="true" aria-label="${esc(T('Aşama taslağı','Stage template'))}">
      <header class="lmHead"><div class="lmGrow"><span class="lmEyebrow">${esc(T('Aşama taslağı','Stage template'))}</span><input id="lmTemplateNameEdit" class="lmNameEdit" value="${esc(S.tpl.name)}" maxlength="120" aria-label="${esc(T('Taslak adı','Template name'))}" placeholder="${esc(T('Taslak adı','Template name'))}" ${dis()}><p>${esc(used.length?T(`Kaydedince ${used.length} lisanstaki adım güncellenir.`,`Saving updates the step in ${used.length} licenses.`):T('Henüz bu taslağı kullanan lisans yok.','No license uses this template yet.'))}</p></div>
        <div class="lmHeadTools"><button type="button" class="lcIconBtn" data-lm-act="close" title="${esc(T('Taslaklara dön','Back to templates'))}"><svg class="ic"><use href="#i-x"/></svg></button></div></header>
      <div class="lmBody"><ol class="lmStages">${stageHtml(l.stages[0],0,1)}</ol>
        <details class="lmMoreBox" open><summary>${esc(T('Taslak adresleri','Template addresses'))} <small>${(l.addresses||[]).length}</small></summary>
          ${(l.addresses||[]).map((a,ai)=>`<div class="lmAddress">${field(`a.${ai}.label`,lx(a,'label'),T('Ad','Name'))}${field(`a.${ai}.text`,a.text||'',T('Adres','Address'),{area:true})}<div class="lmFlags">${toggle(`a.${ai}.manufacturerVisible`,a.manufacturerVisible!==false,T('Üreticiyle paylaş','Share with supplier'))}<button type="button" class="lcIconBtn lmDanger" data-lm-act="removeAddress" data-a="${ai}" ${dis()}><svg class="ic"><use href="#i-trash"/></svg></button></div></div>`).join('')}
          <button type="button" class="lcBtn sm" data-lm-act="addAddress" ${dis()}><svg class="ic"><use href="#i-map-pin"/></svg>${esc(T('Adres ekle','Add address'))}</button>
          <p class="lmMuted">${esc(T('Yalnız gönderimlerde seçilen adresler taslakla birlikte lisanslara taşınır.','Only addresses selected in routes travel with the template.'))}</p>
        </details></div>
      <footer class="lmFoot"><span class="lmStatus" role="status">${esc(S.error||(dirty()?T('Kaydedilmemiş değişiklikler var.','Unsaved changes.'):T('Değişiklik yok.','No changes.')))}</span>
        <button type="button" class="lcBtn" data-lm-act="close">${esc(T('Taslaklara dön','Back to templates'))}</button>
        ${S.canEdit?`<button type="button" class="lcBtn primary" data-lm-act="tplSave" ${S.saving||!dirty()?'disabled':''}>${esc(S.saving?T('Kaydediliyor…','Saving…'):used.length?T(`Kaydet ve ${used.length} lisansa uygula`,`Save and apply to ${used.length} licenses`):T('Kaydet','Save'))}</button>`:''}</footer></aside>`;
    S.root.classList.toggle('isError',Boolean(S.error));
    const body=S.root.querySelector('.lmBody');if(body)body.scrollTop=scroll;
    if(focus){const el=S.root.querySelector(`[data-lm="${CSS.escape(focus)}"]`)||document.getElementById(focus);el?.focus({preventScroll:true});}
  }
  function showTemplateList(){S.mode='templates';S.tpl=null;S.draft=null;S.base=snapshot();S.error='';render();}
  function editTemplate(t){
    const stage={...copy(t?t.stage:{title:T('Yeni adım','New step'),approver:'unknown',submissions:[],manufacturerVisible:true,supplierShowApprovalNotes:true,supplierShowSourceNote:false,testRequired:false}),id:'tpl-stage',enabled:true};
    S.draft={version:1,license:{stages:[stage],addresses:copy(t?.addresses||[])},sharedAddresses:[],visualLibrary:t?.visual?[{id:'tpl-visual',name:t.visual.name,data:t.visual.data}]:[],customSelectOptions:{}};
    if(t?.visual)stage.visualGuideId='tpl-visual';
    S.adding=null;S.tpl={id:t?.id||uid('stage-template'),name:t?.name||'',updatedAt:t?.updatedAt,isNew:!t};S.mode='template';S.open=new Set(['tpl-stage']);S.error='';S.notice='';S.base=snapshot();render();
    S.root.querySelector('#lmTemplateNameEdit')?.focus();
  }
  async function templateAct(a,el){
    if(a==='tplNew'&&S.canEdit)return editTemplate(null);
    if(a==='tplEdit'&&S.canEdit)return editTemplate(S.templates.find(t=>t.id===el.dataset.id));
    if(a==='tplDelete'&&S.canEdit){
      const t=S.templates.find(x=>x.id===el.dataset.id),used=usage(t);if(!t)return;
      if(!confirm(used.length?T(`“${t.name}” silinsin mi? ${used.length} lisanstaki adım kalır, yalnız taslak bağlantısı kaldırılır.`,`Delete “${t.name}”? The step stays in ${used.length} licenses; only the template link is removed.`):T(`“${t.name}” silinsin mi?`,`Delete “${t.name}”?`)))return;
      try{const result=await S.onDeleteTemplate(t);S.templates=copy(result.templates||[]);S.cards=result.cards||S.cards;S.notice=T('Taslak silindi.','Template deleted.');S.error='';}
      catch(error){fresh(error);S.error=error?.message||T('Taslak silinemedi.','The template could not be deleted.');}
      return render();
    }
    if(a==='tplSave'&&S.canEdit&&!S.saving){
      const name=S.tpl.name.trim();if(!name){S.error=T('Taslak adı girin.','Enter a template name.');return render();}
      const template=templateFromStage(L().stages[0],name,S.tpl.id);template.addresses=copy(L().addresses||[]).filter(a=>(template.stage.submissions||[]).some(r=>r.addressId===a.id));
      S.saving=true;render();
      try{
        const result=await S.onSave({template,expectedUpdatedAt:S.tpl.isNew?undefined:S.tpl.updatedAt});
        S.templates=copy(result.templates||[]);S.cards=result.cards||S.cards;S.saving=false;showTemplateList();
        S.notice=result.propagated?T(`Taslak kaydedildi; ${result.propagated} lisans güncellendi.`,`Template saved; ${result.propagated} licenses updated.`):T('Taslak kaydedildi.','Template saved.');render();
      }catch(error){fresh(error);S.saving=false;S.error=error?.message||T('Taslak kaydedilemedi.','The template could not be saved.');render();}
    }
  }
  // A conflict hands back the current templates; the list shows them at once.
  function fresh(error){if(Array.isArray(error?.templates)){S.templates=copy(error.templates);if(error.cards)S.cards=error.cards;}}
  function openTemplates({templates=[],cards=[],canEdit=false,onSave,onDelete}){
    if(S.root)close(true);
    Object.assign(S,{adding:null,mode:'templates',card:null,cards,canEdit:Boolean(canEdit),templates:copy(templates),onSave,onDeleteTemplate:onDelete,onSaveTemplate:null,tpl:null,draft:null,naming:'',notice:'',saving:false,error:'',open:new Set()});
    S.base=snapshot();mount();
  }
  window.BLLicenseMapEditor={open,openTemplates,close:()=>close(),isOpen:()=>Boolean(S.root)};
})();
