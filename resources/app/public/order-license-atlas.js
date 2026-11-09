/* CP / Orders Tools: snapshot the selected visible rows and build the shared supplier file. */
(() => {
  'use strict';
  const T=(tr,en)=>typeof appLang!=='undefined'&&appLang==='en'?en:tr;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let current=null;
  async function inlineAssets(licenses,signal){
    const cache=new Map();
    const inline=async value=>{
      if(typeof value!=='string'||!/^\/api\/license-cards\/assets\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(value))return value;
      if(!cache.has(value))cache.set(value,(async()=>{
        const response=await fetch(value,{credentials:'same-origin',signal});if(!response.ok)throw new Error('LICENSE_ASSET_NOT_FOUND');
        const blob=await response.blob();
        return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      })());
      return cache.get(value);
    };
    for(const license of licenses){
      license.cover=await inline(license.cover);
      for(const visual of license.visualLibrary||[])visual.data=await inline(visual.data);
    }
  }
  function open({rows,moduleId}){
    if(!rows?.length)return;
    current?.close();
    const d=document.createElement('dialog'),controller=new AbortController();
    d.className='lcEditor lcDetail orderLicenseAtlas';d.setAttribute('aria-labelledby','orderAtlasTitle');d.setAttribute('data-no-i18n','');
    const snapshot=rows.map(row=>({license:window.BLCanonicalFields.canonicalValue(row,moduleId,'license'),licensor:window.BLCanonicalFields.canonicalValue(row,moduleId,'licensor')}));
    let result=null,loading=true,failed=false,busy=false,language=typeof appLang!=='undefined'&&appLang==='en'?'en':'tr';
    const A=window.BLLicenseSupplierAtlas;
    const identity=c=>esc([c.license,c.licensor].filter(Boolean).join(' · '));
    const projection=()=>A.project(result?.cards||[],language);
    const draw=()=>{
      const p=projection();
      d.innerHTML=`<header class="lcEditorHead"><div><small>${esc(moduleId==='cp'?'CP Tracker':T('Siparişler','Orders'))}</small><h2 id="orderAtlasTitle">${esc(T('Lisans Atlası Oluştur','Create License Atlas'))}</h2><p>${esc(T(`${snapshot.length} seçili sipariş · ${p.licenses.length} lisans`,`${snapshot.length} selected orders · ${p.licenses.length} licenses`))}</p></div><button type="button" class="lcBtn" data-oa-close>${esc(T('Kapat','Close'))}</button></header>
        <div class="orderAtlasBody">
        <p class="lcMuted">${esc(T('Seçili ve filtrede görünen siparişlerin lisansları birer kez eklenir. Atlas, kayıtlı üretici paylaşım ayarlarını kullanır.','Licenses from selected orders visible in the current filter are included once. The atlas uses saved supplier sharing settings.'))}</p>
        ${loading?`<p role="status">${esc(T('Lisans kartları yükleniyor…','Loading license cards…'))}</p>`:failed?`<p role="alert">${esc(T('Lisans kartları yüklenemedi. Pencereyi kapatıp yeniden deneyin.','License cards could not be loaded. Close this window and retry.'))}</p>`:`
        <div class="orderAtlasList">${result.cards.map(card=>`<div class="lcNotice"><b>${identity(card)}</b><span>${esc(card.processAtlas?.license?.manufacturerVisible===false?T('Üretici paylaşımı kapalı; çıktıya eklenmez.','Supplier sharing is disabled; excluded from the file.'):!card.processAtlas?T('Süreç haritası yok; yalnız lisans bilgisi eklenir.','No process map; only license details are included.'):T('Atlas çıktısına dahil','Included in the atlas'))}</span></div>`).join('')}</div>
        ${result.issues.map(issue=>`<p class="lcMuted">${identity(issue)} — ${esc(issue.reason==='ambiguous'?T('Birden fazla lisansör var. Siparişte lisansör belirtilmeli.','Multiple licensors match. Specify the licensor on the order.'):T('Eşleşen lisans kartı bulunamadı.','No matching license card found.'))}</p>`).join('')}
        ${result.withoutLicense?`<p class="lcMuted">${esc(T(`${result.withoutLicense} siparişte lisans bilgisi yok.`,`${result.withoutLicense} orders have no license.`))}</p>`:''}
        ${!p.licenses.length?`<p role="status">${esc(T('Atlas oluşturmak için paylaşılabilir lisans bulunamadı. Lisans kartlarını ve siparişlerin lisans bilgilerini kontrol edin.','No shareable licenses found for the atlas. Check the license cards and the orders’ license details.'))}</p>`:''}`}
        <p class="lcMuted">${esc(T('Çıktı, çevrimdışı açılan salt okunur HTML dosyasıdır.','The output is a read-only HTML file that opens offline.'))}</p>
        <label class="lcField"><span>${esc(T('Çıktı dili','Export language'))}</span><select data-oa-language ${busy?'disabled':''}><option value="tr" ${language==='tr'?'selected':''}>TR</option><option value="en" ${language==='en'?'selected':''}>EN</option></select></label>
        <p role="status" data-oa-status>${esc(busy?T('Atlas hazırlanıyor…','Preparing atlas…'):'')}</p><div data-oa-preview></div></div>
        <footer class="lcDetailFoot"><button type="button" class="lcBtn" data-oa-action="preview" ${busy||loading||failed||!p.licenses.length?'disabled':''}>${esc(T('Atlası önizle','Preview atlas'))}</button><button type="button" class="lcBtn primary" data-oa-action="download" ${busy||loading||failed||!p.licenses.length?'disabled':''}>${esc(T('HTML atlası indir','Download HTML atlas'))}</button></footer>`;
      d.querySelector('[data-oa-close]').onclick=()=>d.close();
      d.querySelector('[data-oa-language]').onchange=event=>{language=event.target.value;draw();};
      d.querySelectorAll('[data-oa-action]').forEach(button=>button.onclick=()=>generate(button.dataset.oaAction));
    };
    const generate=async action=>{
      if(busy)return;busy=true;draw();
      try{
        const {licenses}=projection();await inlineAssets(licenses,controller.signal);
        const built=await A.buildEmailSafeHTML(licenses,{lang:language,fonts:await A.loadFonts()});
        if(!d.isConnected)return;
        if(built.blob.size>A.MAX_EMAIL_BYTES)throw Object.assign(new Error('ATLAS_EMAIL_SIZE_LIMIT'),{code:'ATLAS_EMAIL_SIZE_LIMIT'});
        busy=false;draw();
        if(action==='preview'){
          const frame=document.createElement('iframe');frame.title=T('Üretici atlası önizleme','Supplier atlas preview');frame.className='orderAtlasPreview';frame.setAttribute('sandbox','');frame.srcdoc=await built.blob.text();
          if(d.isConnected)d.querySelector('[data-oa-preview]').replaceChildren(frame);
        }else{
          const url=URL.createObjectURL(built.blob),link=document.createElement('a');link.href=url;link.download=`Buyer-Log-Supplier-Atlas-${new Date().toISOString().slice(0,10)}-${language}.html`;d.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
          d.querySelector('[data-oa-status]').textContent=T('Lisans atlası indirildi.','License atlas downloaded.');
        }
      }catch(error){
        if(!d.isConnected)return;busy=false;draw();
        const status=d.querySelector('[data-oa-status]');status.setAttribute('role','alert');
        status.textContent=error?.code==='ATLAS_EMAIL_SIZE_LIMIT'?T('Atlas 9 MB sınırına sığdırılamadı. Daha az sipariş seçin veya atlas görsellerini küçültün.','The atlas cannot fit under 9 MB. Select fewer orders or reduce atlas images.'):T('Atlas oluşturulamadı. Yeniden deneyin.','The atlas could not be created. Please retry.');
      }
    };
    const observer=new MutationObserver(()=>{if(d.isConnected)draw();});observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    d.addEventListener('close',()=>{controller.abort();observer.disconnect();d.remove();if(current===d)current=null;},{once:true});
    document.body.append(d);current=d;draw();d.showModal();window.BLMotionPlus?.play('overlay',d);
    fetch('/api/license-cards',{cache:'no-store',credentials:'same-origin',signal:controller.signal})
      .then(response=>{if(!response.ok)throw new Error('LICENSE_CARDS_LOAD_FAILED');return response.json();})
      .then(data=>{if(!Array.isArray(data.cards))throw new Error('INVALID_LICENSE_CARDS');result=window.BLOrderLicenseAtlasEngine.match(snapshot,moduleId,data.cards);})
      .catch(()=>{failed=true;}).finally(()=>{loading=false;if(d.isConnected)draw();});
  }
  window.BLOrderLicenseAtlas={open};
})();
