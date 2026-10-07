(function(){
  'use strict';

  const STORAGE_KEY='buyerlog.syncGuide.dismissed.v1';
  const GUIDE_VERSION=1;
  /* PLM (CoreNectum) metadata, görsel, teknik föy ve numune çağrıları doğrudan
     API ile, Electron'un gizli kurumsal oturumundan alınan token'la yürür; dış
     Edge/Remote Debugging gerektirmez. Bu yüzden PLM butonları tarayıcı
     ön koşuluna kilitlenmez. ASAS/PIM görselleri hâlâ Edge oturumunu kullanır. */
  const guardedCategories=new Set(['asas']);
  const syncEndpoints=new Set([
    '/api/plm-sync/fetch',
    '/api/plm-style-links/sync-links',
    '/api/model-images/import-plm',
    '/api/model-images/import-asas',
    '/api/plm-sync/model-files',
    '/api/plm-requests/sync'
  ]);
  let bypassEntry=null;
  let statusCache=null;
  let statusCacheAt=0;
  let activeProgress=null;

  function en(){return String(window.appLang||document.documentElement.lang||'tr').toLowerCase().startsWith('en');}
  function t(tr,eng){return en()?eng:tr;}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
  function readDismissed(){
    try{
      const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
      return raw&&raw.version===GUIDE_VERSION?raw:{version:GUIDE_VERSION,plm:false,asas:false};
    }catch(_){return {version:GUIDE_VERSION,plm:false,asas:false};}
  }
  function writeDismissed(category,value){
    const state=readDismissed();state[category]=Boolean(value);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}
  }
  function isDismissed(category){return Boolean(readDismissed()[category]);}

  async function browserStatus(force=false){
    if(!force&&statusCache&&Date.now()-statusCacheAt<5000)return statusCache;
    try{
      const response=await fetch('/api/browser-debug/status',{credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||response.statusText);
      statusCache=data.status||{};
    }catch(error){
      statusCache={connectionState:'ERROR',error:(error&&error.message)||String(error)};
    }
    statusCacheAt=Date.now();return statusCache;
  }
  function stateText(state){
    const map={
      READY:t('Hazır','Ready'),
      DISABLED:t('Kapalı','Disabled'),
      REMOTE_DEBUG_DISABLED:t('Remote Debugging kapalı','Remote Debugging disabled'),
      PROFILE_REQUIRED:t('Profil seçilmeli','Profile required'),
      PROFILE_NOT_FOUND:t('Profil bulunamadı','Profile not found'),
      PORT_CONFLICT:t('Port çakışması','Port conflict'),
      ENDPOINT_UNVERIFIED:t('Bağlantı doğrulanamadı','Endpoint unverified'),
      CONTEXT_MISMATCH:t('Tarayıcı profili eşleşmiyor','Browser profile mismatch'),
      DISCOVERING:t('Tarayıcı aranıyor','Discovering browser'),
      ERROR:t('Bağlantı kontrol edilemedi','Connection check failed')
    };
    return map[state]||state||t('Hazır değil','Not ready');
  }
  function browserLabel(status){
    const resolved=status&&status.resolved||{};
    const browser=resolved.resolvedBrowser||(resolved.detected&&resolved.detected.browser)||status&&status.configuration&&status.configuration.preferredBrowser||'';
    return browser==='chrome'?'Google Chrome':browser==='edge'?'Microsoft Edge':t('Chrome / Edge','Chrome / Edge');
  }
  function inspectUrl(status){
    const resolved=status&&status.resolved||{};
    const browser=resolved.resolvedBrowser||(resolved.detected&&resolved.detected.browser)||status&&status.configuration&&status.configuration.preferredBrowser||'';
    return browser==='chrome'?'chrome://inspect/#devices':'edge://inspect/#devices';
  }
  function closeExisting(){document.getElementById('_syncGuideOverlay')?.remove();}
  function closeProgress({immediate=true}={}){
    if(!activeProgress)return;
    try{if(typeof activeProgress.close==='function')activeProgress.close({immediate});}catch(_){}
    activeProgress=null;
  }

  function visualBrowser(status){
    const url=inspectUrl(status);
    return '<div class="blSyncGuideBrowser" aria-hidden="true">'+
      '<div class="blSyncGuideBrowserTop"><i></i><i></i><i></i><span>'+esc(browserLabel(status))+'</span></div>'+
      '<div class="blSyncGuideAddress">'+esc(url)+'</div>'+
      '<div class="blSyncGuideBrowserBody"><div class="blSyncGuideToggleRow"><span>Remote Debugging</span><b><i></i></b></div>'+
      '<div class="blSyncGuideAllow"><strong>'+esc(t('Allow Remote Debugging','Allow Remote Debugging'))+'</strong><small>'+esc(t('Tarayıcı bu onayı gösterirse Allow seçin.','If the browser asks, choose Allow.'))+'</small><button type="button" tabindex="-1">Allow</button></div></div></div>';
  }

  function guideSteps(category,status){
    const isAsas=category==='asas';
    const source=isAsas?'ASAS':'PLM';
    return [
      {
        icon:'1',
        title:t(source+' işlemi tarayıcı kullanır',source+' uses your browser'),
        body:t('Buyer Log gerekli sayfayı sizin için açabilir. İşlem bitene kadar açılan Chrome/Edge penceresini kapatmayın.','Buyer Log may open the required page for you. Keep the Chrome/Edge window open until the operation finishes.'),
        visual:'<div class="blSyncGuideMiniFlow"><span>Buyer Log</span><b>→</b><span>'+esc(browserLabel(status))+'</span><b>→</b><span>'+source+'</span></div>'
      },
      {
        icon:'2',
        title:t('Tarayıcı onayını kaçırmayın','Do not miss the browser approval'),
        body:isAsas
          ?t('ASAS görselleri çekilirken tarayıcı arka planda çalışabilir. Açılan Remote Debugging onayı varsa Allow seçin.','While ASAS images are collected, the browser may work in the background. If a Remote Debugging prompt appears, choose Allow.')
          :t('Özellikle “PLM’de Seçili Olan Modelleri Al” gibi işlemlerde tarayıcı bir onay gösterebilir. Allow seçilmezse veri Buyer Log’a gelmez.','Especially for actions such as “Import PLM-selected models”, the browser may ask for approval. If Allow is not selected, data will not reach Buyer Log.'),
        visual:'<div class="blSyncGuidePrompt" aria-hidden="true"><span>'+esc(t('Tarayıcı bildirimi','Browser prompt'))+'</span><strong>Allow Remote Debugging?</strong><em>Allow</em></div>'
      },
      {
        icon:'3',
        title:t('Remote Debugging açık olmalı','Remote Debugging must be enabled'),
        body:t('Buyer Log bağlantıyı hazır görmüyorsa önce Browser ve Remote Debugging ayarını açın. Manuel kontrol gerekirse aşağıdaki inspect adresini kullanın.','If Buyer Log does not see a ready connection, open Browser & Remote Debugging settings first. If a manual check is needed, use the inspect address below.'),
        visual:visualBrowser(status)
      }
    ];
  }

  /* TEK TIKLA REMOTE DEBUGGING.
     Rehber, Browser & Remote Debugging penceresini açtırmadan aynı kurulum
     uç noktasını (kayıtlı tercih + Enable & Launch) çağırır ve sonucu hemen
     Test Connection ile teyit eder. Profil seçimi gereken durumlarda tahmin
     yapılmaz; kullanıcı ayarlar penceresine yönlendirilir. */
  const oneClickStates=new Set(['DISABLED','REMOTE_DEBUG_DISABLED','ENDPOINT_UNVERIFIED','PORT_CONFLICT','CONTEXT_MISMATCH','DISCOVERING']);
  async function postJson(url,body){
    const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    const data=await response.json().catch(()=>({}));
    return {ok:response.ok&&data.ok!==false,data,result:data.result||{}};
  }
  function setupFailureText(result,data){
    const reason=result&&result.reason;
    if(reason==='browser-running')return t('Tarayıcı şu anda açık; Remote Debugging yalnız yeniden başlatmayla açılabilir.','The browser is running; Remote Debugging can only be enabled by restarting it.');
    if(reason==='browser-profile-running-no-cdp')return t('Buyer Log tarayıcı penceresi açık fakat bağlantı vermiyor. O pencereyi kapatıp tekrar deneyin.','The Buyer Log browser window is open but not responding. Close that window and try again.');
    if(reason==='policy-blocked')return t('Remote Debugging kuruluş politikası tarafından engellenmiş.','Remote Debugging is blocked by organization policy.');
    if(reason==='browser-not-installed'||reason==='unsupported-browser')return t('Desteklenen bir Chrome/Edge bulunamadı. Browser ayarlarından tarayıcı seçin.','No supported Chrome/Edge was found. Choose a browser in browser settings.');
    if(result&&(result.connectionState==='PROFILE_REQUIRED'||result.connectionState==='PROFILE_NOT_FOUND'))return t('Önce Browser ayarlarından kullanılacak profili seçin.','Choose the profile to use in browser settings first.');
    return t('Remote Debugging açılamadı: ','Remote Debugging could not be enabled: ')+String((result&&result.status)||(data&&data.error)||t('bilinmeyen hata','unknown error'));
  }
  async function enableRemoteDebugging(){
    let attempt=await postJson('/api/browser-debug/enable',{});
    if(!attempt.ok&&attempt.result.reason==='browser-running'){
      if(!confirm(t('Seçili tarayıcı kapatılıp aynı profille Remote Debugging açık olarak yeniden açılacak. Açık sekmelerinizi kaydedin. Devam edilsin mi?','The selected browser will be closed and reopened with the same profile and Remote Debugging enabled. Save your open tabs. Continue?'))){
        return {ok:false,notice:setupFailureText(attempt.result,attempt.data)};
      }
      attempt=await postJson('/api/browser-debug/restart',{});
    }
    // Kurulumun dönüşü yeterli kanıt sayılmaz: Test Connection ile hemen teyit edilir.
    const check=await postJson('/api/browser-debug/test',{}).catch(()=>({ok:false,result:{}}));
    const status=await browserStatus(true);
    const ready=status.connectionState==='READY'||check.result.connectionState==='READY';
    if(ready&&status.connectionState!=='READY')status.connectionState='READY';
    if(ready)return {ok:true,status,notice:attempt.result.setupPage
      ?t('Remote Debugging açıldı ve doğrulandı. Açılan tarayıcı sayfası işlemin tamamlandığını gösteriyor; o sayfayı kapatabilirsiniz.','Remote Debugging is enabled and verified. The opened browser page confirms completion; you can close that page.')
      :t('Remote Debugging açıldı ve doğrulandı.','Remote Debugging is enabled and verified.')};
    return {ok:false,status,notice:attempt.ok?t('Tarayıcı açıldı fakat bağlantı doğrulanamadı. Tekrar kontrol edin veya Browser ayarlarını açın.','The browser opened but the connection could not be verified. Check again or open browser settings.'):setupFailureText(attempt.result,attempt.data)};
  }

  function renderGuide(category,status,{blocking=false,notice=null}={}){
    closeExisting();
    const state=status&&status.connectionState||'';
    const ready=state==='READY';
    const oneClick=!ready&&oneClickStates.has(state);
    const source=category==='asas'?'ASAS':'PLM';
    const overlay=document.createElement('div');
    overlay.id='_syncGuideOverlay';
    overlay.className='warnOverlay blSyncGuideOverlay';
    const steps=guideSteps(category,status).map(step=>'<article class="blSyncGuideStep"><div class="blSyncGuideStepNo">'+step.icon+'</div><div class="blSyncGuideStepCopy"><h3>'+esc(step.title)+'</h3><p>'+esc(step.body)+'</p>'+step.visual+'</div></article>').join('');
    overlay.innerHTML='<div class="modalCard blSyncGuideCard" role="dialog" aria-modal="true" aria-labelledby="_syncGuideTitle">'+
      '<div class="blSyncGuideHead"><div><span class="blSyncGuideEyebrow">'+source+' SYNC</span><h2 id="_syncGuideTitle">'+esc(blocking?t('Önce tarayıcı bağlantısını hazırlayın','Prepare the browser connection first'):t('Başlamadan önce 20 saniyelik rehber','A quick guide before you start'))+'</h2>'+
      '<p>'+esc(blocking?t('Bu işlem tarayıcı bağlantısı hazır olmadan çalışmaz.','This operation cannot run until the browser connection is ready.'):t('Aşağıdaki üç noktayı bilirseniz PLM ve ASAS senkronları kesintisiz ilerler.','These three points help PLM and ASAS syncs complete without interruption.'))+'</p></div>'+
      '<button type="button" class="pricingRuleIconBtn" data-syncguide-close aria-label="'+esc(t('Kapat','Close'))+'"><svg class="ic"><use href="#i-x"/></svg></button></div>'+
      '<div class="blSyncGuideStatus '+(ready?'isReady':'isBlocked')+'"><span></span><div><strong>'+esc(t('Tarayıcı bağlantısı: ','Browser connection: ')+stateText(state))+'</strong><small>'+esc(ready?t('Buyer Log tarayıcı bağlantısını doğruladı.','Buyer Log verified the browser connection.'):(oneClick?t('Aşağıdaki düğmeyle Remote Debugging tek tıkla açılır ve hemen doğrulanır.','Use the button below to enable Remote Debugging in one click; it is verified right away.'):t('Senkronu başlatmadan önce bu durumu düzeltin.','Fix this before starting the sync.')))+'</small>'+
      (notice?'<small class="blSyncGuideNotice '+(notice.ok?'isOk':'isError')+'" role="status">'+esc(notice.text)+'</small>':'')+
      (oneClick?'<button type="button" class="tbtn primary blSyncGuideEnable" data-syncguide-enable>'+esc(t('Remote Debugging\'i tek tıkla aç','Enable Remote Debugging in one click'))+'</button>':'')+
      '</div></div>'+
      '<div class="blSyncGuideSteps">'+steps+'</div>'+
      '<div class="blSyncGuideManual"><strong>'+esc(t('Manuel kontrol','Manual check'))+'</strong><code>'+esc(inspectUrl(status))+'</code><span>→ Remote Debugging → Allow Remote Debugging</span></div>'+
      '<div class="blSyncGuideFoot">'+
        (!blocking?'<label class="blSyncGuideNever"><input type="checkbox" data-syncguide-never> <span>'+esc(t('Bu rehberi bir daha gösterme','Do not show this guide again'))+'</span></label>':'<span></span>')+
        '<div class="blSyncGuideActions"><button type="button" class="tbtn" data-syncguide-settings>'+esc(t('Browser ayarlarını aç','Open browser settings'))+'</button>'+
        '<button type="button" class="tbtn" data-syncguide-recheck>'+esc(t('Tekrar kontrol et','Check again'))+'</button>'+
        '<button type="button" class="tbtn primary" data-syncguide-continue '+(!ready?'disabled':'')+'>'+esc(t('Anladım, devam et','Continue'))+'</button></div></div></div>';
    document.body.appendChild(overlay);

    const close=()=>overlay.remove();
    overlay.querySelector('[data-syncguide-close]')?.addEventListener('click',close);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    overlay.querySelector('[data-syncguide-settings]')?.addEventListener('click',()=>{
      try{
        if(typeof window.openBrowserDebugSettingsModal==='function')window.openBrowserDebugSettingsModal();
        else document.querySelector('[data-browser-debug-settings]')?.click();
      }catch(_){}
    });
    overlay.querySelector('[data-syncguide-enable]')?.addEventListener('click',async event=>{
      const btn=event.currentTarget;if(btn.disabled)return;
      btn.disabled=true;btn.textContent=t('Açılıyor ve doğrulanıyor…','Enabling and verifying…');
      let outcome;
      try{outcome=await enableRemoteDebugging();}
      catch(error){outcome={ok:false,notice:t('Remote Debugging açılamadı: ','Remote Debugging could not be enabled: ')+((error&&error.message)||String(error))};}
      if(!overlay.isConnected)return;
      const next=outcome.status||await browserStatus(true);
      renderGuide(category,next,{blocking:next.connectionState!=='READY',notice:{ok:outcome.ok,text:outcome.notice}});
    });
    overlay.querySelector('[data-syncguide-recheck]')?.addEventListener('click',async event=>{
      const btn=event.currentTarget;btn.disabled=true;btn.textContent=t('Kontrol ediliyor…','Checking…');
      const next=await browserStatus(true);btn.disabled=false;
      renderGuide(category,next,{blocking:next.connectionState!=='READY'});
    });
    overlay.querySelector('[data-syncguide-continue]')?.addEventListener('click',()=>{
      if((status&&status.connectionState)!=='READY')return;
      const never=overlay.querySelector('[data-syncguide-never]');
      if(never&&never.checked)writeDismissed(category,true);
      overlay.remove();
      const entry=bypassEntry;bypassEntry=null;
      if(entry&&entry.isConnected){entry.dataset.syncGuideBypass='1';entry.click();}
    });
    try{window.BLLayerSystem?.openDialog?.(overlay,{initialFocus:'[data-syncguide-continue]:not(:disabled),[data-syncguide-enable],[data-syncguide-settings]'});}catch(_){}
  }

  async function interceptEntry(event){
    const entry=event.target&&event.target.closest&&event.target.closest('[data-plm-sync-category]');
    if(!entry)return;
    const category=String(entry.dataset.plmSyncCategory||'');
    if(!guardedCategories.has(category))return;
    if(entry.dataset.syncGuideBypass==='1'){delete entry.dataset.syncGuideBypass;return;}
    const status=await browserStatus(false);
    const ready=status.connectionState==='READY';
    if(ready&&isDismissed(category))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    bypassEntry=entry;
    renderGuide(category,status,{blocking:!ready});
  }

  document.addEventListener('click',event=>{
    const entry=event.target&&event.target.closest&&event.target.closest('[data-plm-sync-category]');
    if(!entry||!guardedCategories.has(String(entry.dataset.plmSyncCategory||'')))return;
    if(entry.dataset.syncGuideBypass==='1'){delete entry.dataset.syncGuideBypass;return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    void (async()=>{
      const category=String(entry.dataset.plmSyncCategory||'');
      const status=await browserStatus(false),ready=status.connectionState==='READY';
      if(ready&&isDismissed(category)){
        entry.dataset.syncGuideBypass='1';entry.click();return;
      }
      bypassEntry=entry;renderGuide(category,status,{blocking:!ready});
    })();
  },true);

  /* Yalnız gerçekten Edge/CDP kullanan çağrılar tarayıcı uyarısı taşır:
     ASAS görselleri ve açık Style List sekmesindeki seçili modellerin aktarımı. */
  function usesBrowser(url,init){
    if(String(url).includes('import-asas'))return true;
    if(String(url)!=='/api/plm-sync/fetch')return false;
    try{const body=JSON.parse(String(init&&init.body||'{}'));return Boolean(body&&body.selectedOnly===true);}catch(_){return false;}
  }
  function progressFor(url,browser){
    const isAsas=String(url).includes('import-asas');
    const source=isAsas?'ASAS':'PLM';
    closeProgress();
    const message=source+' · '+t('Senkronizasyon devam ediyor','Synchronization in progress');
    const detail=browser?t(
      'Açılan tarayıcı penceresini kapatmayın. “Allow Remote Debugging?” görünürse Allow seçin.',
      'Keep the opened browser window open. If “Allow Remote Debugging?” appears, choose Allow.'
    ):t(
      'Arka planda çalışıyor; tarayıcı açılmaz. Sayfa değiştirmek işi durdurmaz.',
      'Running in the background; no browser opens. Changing pages does not stop it.'
    );
    let close=null;
    try{
      if(typeof window.showToast==='function'){
        close=window.showToast(message,{kind:'info',kindLabel:t('BİLGİLENDİRME','INFORMATION'),detail,duration:0});
      }else if(typeof window.BLUI?.notify==='function'){
        close=window.BLUI.notify(message,{kind:'info',kindLabel:t('BİLGİLENDİRME','INFORMATION'),detail,duration:0,placement:'edge',language:en()?'en':'tr'});
      }
    }catch(_){close=null;}
    if(typeof close!=='function')return null;
    const progress={source,browser:Boolean(browser),close,update(messageText,options){try{close.update?.(messageText,options);}catch(_){}}};
    activeProgress=progress;
    return progress;
  }

  const originalFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    const raw=typeof input==='string'?input:(input&&input.url)||'';
    let path=raw;
    try{path=new URL(raw,location.href).pathname;}catch(_){}
    const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
    const watched=method==='POST'&&syncEndpoints.has(path);
    const category=path==='/api/model-images/import-asas'?'asas':'plm';
    let panel=null;
    if(watched)panel=progressFor(path,usesBrowser(path,init));
    const promise=originalFetch(input,init);
    if(!watched)return promise;
    return promise.then(response=>{
      if(panel){
        const ok=response.ok;
        panel.update(
          panel.source+' · '+(ok?t('Senkronizasyon tamamlandı','Synchronization completed'):t('Senkronizasyon tamamlanamadı','Synchronization failed')),
          {
            kind:ok?'success':'error',
            kindLabel:ok?t('TAMAMLANDI','COMPLETED'):t('HATA','ERROR'),
            detail:ok?t('Buyer Log veriyi aldı.','Buyer Log received the data.'):panel.browser?t('Tarayıcı bağlantısını ve Allow onayını kontrol edin.','Check the browser connection and the Allow approval.'):t('Ayrıntı PLM Operasyon Merkezi’nde.','Details are in the PLM Operations Center.')
          }
        );
        setTimeout(()=>{if(panel===activeProgress)closeProgress({immediate:false});},ok?3500:9000);
      }
      return response;
    },error=>{
      if(panel){
        panel.update(
          panel.source+' · '+t('Senkronizasyon kesildi','Synchronization interrupted'),
          {
            kind:'error',
            kindLabel:t('HATA','ERROR'),
            detail:panel.browser?t('Tarayıcıyı kapatmadığınızdan ve Remote Debugging iznini verdiğinizden emin olun.','Make sure the browser stayed open and Remote Debugging permission was allowed.'):t('Bağlantı kesildi; işi PLM Operasyon Merkezi’nden yeniden deneyin.','The connection dropped; retry the job from the PLM Operations Center.')
          }
        );
      }
      throw error;
    });
  };

  window.BLSyncGuide={
    reset(){try{localStorage.removeItem(STORAGE_KEY);}catch(_){}},
    show(category='plm'){void browserStatus(true).then(status=>renderGuide(category,status,{blocking:status.connectionState!=='READY'}));}
  };
})();