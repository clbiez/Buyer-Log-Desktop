(function(global){
  'use strict';
  const mounted=new WeakMap();
  const defaultEscape=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  async function defaultFetch(url,options){
    const response=await global.fetch(url,options);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error((global.document.documentElement.lang==='en'&&data.errorEn?data.errorEn:data.error)||response.statusText);
    return data;
  }
  async function mount(host,options={}){
    if(mounted.has(host)){const controller=mounted.get(host);await controller.refresh();return controller;}
    const tx=options.tx||((tr,en)=>global.document.documentElement.lang==='en'?en:tr);
    const escapeHtml=options.escapeHtml||defaultEscape;
    const fetchJSON=options.fetchJSON||defaultFetch;
    const stamp=options.syncStatusTime||(value=>escapeHtml(value||'—'));
    const confirm=options.confirm||(message=>global.confirm(message));
    const state={releases:[],busy:false,note:'',message:'',error:false};
    let latest=0;
    const controller={refresh};
    mounted.set(host,controller);

    function render(){
      if(!host.isConnected)return;
      host.innerHTML=`<form class="syncConflictHead" data-master-publish-form><label class="mailTopicEditorField"><span>${tx('Yayım notu','Release note')}</span><input type="text" maxlength="2000" data-master-note value="${escapeHtml(state.note)}" placeholder="${escapeHtml(tx('Değişikliğin kısa açıklaması','Brief description of the change'))}"></label><div class="syncConflictActions"><button class="tbtn" type="submit"${state.busy?' disabled':''}>${tx('Not ekleyerek yayımla','Publish with note')}</button><button class="tbtn" type="button" data-master-refresh${state.busy?' disabled':''}>${tx('Yenile','Refresh')}</button></div></form>`+
        `<p class="syncConflictEmpty${state.error?' is-error':''}" role="status" aria-live="polite" data-master-message>${escapeHtml(state.message)}</p>`+
        (state.releases.length?`<ol class="syncConflictList">${state.releases.map(release=>`<li class="syncConflictItem"><div class="syncConflictHead"><b>${tx('Kurallar','Rules')} v${Number(release.version)||0}</b><span>${escapeHtml(release.publishedBy||'—')} · ${stamp(release.publishedAt)}</span><span>${escapeHtml(release.note||tx('Not eklenmedi.','No note supplied.'))}</span><span>${tx('Değişen alanlar','Changed entities')}: ${escapeHtml((release.changedEntities||[]).join(', ')||'—')}</span><button class="tbtn" type="button" data-master-restore="${Number(release.version)||0}"${state.busy?' disabled':''}>${tx('Bu sürüme dön','Restore this version')}</button></div></li>`).join('')}</ol>`:
          `<p class="syncConflictEmpty">${tx('Henüz arşivlenmiş kural sürümü yok.','No archived rule releases yet.')}</p>`);
      host.querySelector('[data-master-note]').oninput=event=>{state.note=event.target.value;};
      host.querySelector('[data-master-refresh]').onclick=()=>void refresh();
      host.querySelector('[data-master-publish-form]').onsubmit=event=>{event.preventDefault();void publish();};
      host.querySelectorAll('[data-master-restore]').forEach(button=>{button.onclick=()=>void restore(Number(button.dataset.masterRestore));});
    }
    async function load(){
      const generation=++latest;
      const result=await fetchJSON('/api/shared-hub/master-releases');
      if(generation!==latest||!host.isConnected)return false;
      state.releases=Array.isArray(result.releases)?result.releases:[];
      return true;
    }
    async function refresh(){
      if(state.busy)return;
      state.busy=true;state.error=false;state.message=tx('Kural sürümleri yükleniyor…','Loading rule releases…');render();
      try{await load();state.message='';}
      catch(error){state.error=true;state.message=tx('Kural sürümleri okunamadı.','Rule releases could not be read.')+' '+String(error.message||error);}
      finally{state.busy=false;render();}
    }
    async function perform(url,body,success){
      if(state.busy)return;
      state.busy=true;state.error=false;state.message=tx('Kural yayımı hazırlanıyor…','Preparing the rule release…');render();
      try{
        const result=await fetchJSON(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!host.isConnected)return;
        if(result.published===false)throw new Error(tx('Kurallar yayımlanmadı. Ortak klasör ve yerel kural verisini kontrol edin.','The rules were not published. Check the shared folder and local rule data.'));
        // A successful publication and a failed history refresh are distinct.
        state.message=result.unchanged?tx('Kurallar zaten güncel; yeni sürüm oluşturulmadı.','Rules are already current; no new release was created.'):success;state.note='';
        try{await load();}
        catch(error){state.message+=' '+tx('Sürüm listesi yenilenemedi.','The release list could not be refreshed.');}
        if(typeof options.onPublished==='function'){try{await options.onPublished(result);}catch(_){} }
      }catch(error){state.error=true;state.message=tx('Kural yayımı tamamlanamadı.','The rule release could not be completed.')+' '+String(error.message||error);}
      finally{state.busy=false;render();}
    }
    function publish(){return perform('/api/shared-hub/publish-master',{note:state.note.trim()},tx('Kurallar yayımlandı.','Rules published.'));}
    function restore(version){
      if(state.busy)return;
      const message=tx('v{0} kuralları yeni bir sürüm olarak yayımlansın mı? Eski sürümler korunacak.','Publish the v{0} rules as a new release? Existing releases will be preserved.').replace('{0}',String(version));
      if(!confirm(message))return;
      return perform('/api/shared-hub/master-releases/restore',{version,note:state.note.trim()},tx('Seçilen kurallar yeni sürüm olarak yayımlandı.','The selected rules were published as a new release.'));
    }
    await refresh();
    return controller;
  }
  global.BLMasterReleasesUI={mount};
})(window);
