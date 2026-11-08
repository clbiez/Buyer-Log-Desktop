function switchTab(tab){
  // Üreticiler sayfası Siparişler verisini okur; yetkisi Siparişler alanıdır.
  const accessArea=tab==='manufacturers'?'orders':((tab==='quotations'||tab==='pricinghistory')?'koleksiyon':tab);
  // LCW AI her oturum açmış kullanıcıya açıktır; kapısı LCW AI kurumsal girişidir.
  const licenseAccess=tab==='licensecards'&&['orders','cp','source'].some(area=>window.BLCanAccessArea?.(area));
  if(tab!=='lcwai'&&typeof window.BLCanAccessArea==='function'&&!licenseAccess&&!window.BLCanAccessArea(accessArea)){
    if(typeof showToast==='function')showToast(appLang==='en'?'You do not have access to this area.':'Bu yetki alanına erişiminiz bulunmuyor.');
    return false;
  }
  void window.buyerLogDesktop?.workspace?.setModule?.(tab);
  const previousTab=document.body.dataset.activeTab||document.querySelector('nav.tabs button.active')?.dataset.tab||'';
  if(startupReadySignaled&&previousTab!==tab)saveWorkspaceResume();
  if(startupReadySignaled&&previousTab!==tab)startupViewResume=null;
  if(tab==='lcwai'&&previousTab&&previousTab!=='lcwai')window.BL_LCWAI_LAST_TAB=previousTab;
  if(previousTab==='cp'||previousTab==='orders') saveCoreAutoFilterState();
  if(previousTab==='cp'&&tab!=='cp'){ _cpImageWarmupJob++; BLImageRuntime.cancelWarmup(); }
  if(typeof closeAllColumnPanels==='function') closeAllColumnPanels();
  document.body.dataset.activeTab = tab;
  window.BLModulePreparation?.noteOpened(tab);
  if(startupReadySignaled)workspaceResume()?.save(tab);
  if(tab==='overview'&&state.overviewDeferred)void ensureOverviewLoaded();
  // Arka planda yüklenmiş ama hiç çizilmemiş tablo, ilk girişte profil uygulandıktan
  // sonra bir kez çizilir; ertelenmiş erken çizim ikinci kez çalışmaz.
  const warmedUnrendered=backgroundWarmupUnrendered.delete(tab);
  if(warmedUnrendered)_deferredTabRenders.delete(tab);
  flushDeferredRenderForTab(tab);
  syncTableToolbarActions(tab);
  syncNavExcelButtonLabel(tab);
  syncActivePageTitle();
  document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=>{
    const active=b.dataset.tab===tab;
    const current=b.dataset.tab===tab?'page':null;
    b.classList.toggle('active',active);
    if(current)b.setAttribute('aria-current',current);else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('main section').forEach(s=>s.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  const profileAllowed=['cp','orders','shipping','koleksiyon'].includes(tab);
  const profileFirstVisit=profileAllowed&&!_favoritesAppliedPages.has(tab);
  if(profileFirstVisit)_favoritesAppliedPages.add(tab);
  const profileReady=profileFirstVisit?applyProfilesForCurrentPage(true):Promise.resolve();
  if(!startupReadySignaled)startupPageProfileReady=profileReady;
  if(profileFirstVisit)void profileReady.then(()=>{if(currentActiveTab()!==tab)_favoritesAppliedPages.delete(tab);});
  if(tab==='cp'&&(!state.cp||warmedUnrendered)){
    const dataReady=ensureCpLoaded({deferRender:profileFirstVisit||warmedUnrendered});
    void (profileFirstVisit||warmedUnrendered?Promise.all([dataReady,profileReady]).then(()=>{
      if(currentActiveTab()!=='cp'||!state.cp)return;
      if(profileFirstVisit)applyStoredProfilesForCurrentPage(true);
      renderCP();
    }):dataReady);
  }
  if(tab==='orders'&&(!state.orders||warmedUnrendered)){
    const dataReady=ensureOrdersLoaded({deferRender:profileFirstVisit||warmedUnrendered});
    void (profileFirstVisit||warmedUnrendered?Promise.all([dataReady,profileReady]).then(()=>{
      if(currentActiveTab()!=='orders'||!state.orders)return;
      if(profileFirstVisit)applyStoredProfilesForCurrentPage(true);
      renderOrders();
    }):dataReady);
  }
  if(tab==='koleksiyon'&&profileFirstVisit){
    const dataReady=ensureCollectionCatalogLoaded({deferRender:true});
    void Promise.all([dataReady,profileReady]).then(()=>{if(currentActiveTab()==='koleksiyon'&&typeof renderKol==='function'){applyStoredProfilesForCurrentPage(true);renderKol();}});
  }
  if(tab==='koleksiyon'&&kolFabricRepaintPending){kolFabricRepaintPending=false;if(typeof renderKol==='function')renderKol();}
  if(tab==='koleksiyon'||tab==='priceanalysis'||tab==='quotations'||tab==='pricinghistory'){
    void window.BLPerf.ensureFeature('collectionTools').then(()=>{
      if(tab==='priceanalysis')return window.initPriceSupplierAnalysis?.();
      // Fiyat Masası: Quotations + Fiyat Geçmişi tek çalışma alanında (Masa · Turlar · Geçmiş · Analiz).
      // Eski "pricinghistory" adresi aynı masayı Geçmiş sekmesinde açar.
      if(tab==='quotations')return window.BLPricingDesk?.mount?.(document.getElementById('quotationWorkspacePage'))||window.BL_QUOTATIONS?.mountWorkspace?.(document.getElementById('quotationWorkspacePage'),{source:'collection',preserveContext:true});
      if(tab==='pricinghistory')return window.BLPricingDesk?.mount?.(document.getElementById('pricingHistoryWorkspacePage'),{tab:'history'})||window.BL_QUOTATIONS?.mountPricingHistory?.(document.getElementById('pricingHistoryWorkspacePage'),{preserveContext:true});
      if(tab==='koleksiyon'){
        window.BL_QUOTATIONS?.syncCollectionPricingUI?.();
        // Teklif & Onay şeridindeki "bekliyor" sayısı quotation verisine bağlıdır;
        // araçlar ilk kez yüklendiğinde tablo bir kez tazelenir.
        if(!kolQuoteIndexCache&&window.BL_QUOTATIONS?.collectionQuoteIndex&&currentActiveTab()==='koleksiyon'&&typeof renderKol==='function')renderKol();
      }
    }).catch(err=>showToast(err.message));
  }
  /* v7.0.229 — Üreticiler: lazy; motor, rehber ve görünüm ilk geçişte yüklenir.
     Analiz Orders/LFL/Fiyat & Üretici Analizi'nin ortak sipariş verisini okur. */
  if(tab==='manufacturers'){
    void window.BLPerf.ensureFeature('manufacturers').then(()=>{
      if(currentActiveTab()==='manufacturers')return window.initManufacturersPage?.();
    }).catch(err=>showToast(err&&err.message||String(err)));
  }
  if(tab==='licensecards'){
    void window.BLPerf.ensureFeature('licensecards').then(()=>{
      if(currentActiveTab()==='licensecards')return window.initLicenseCardsPage?.();
    }).catch(err=>showToast(err&&err.message||String(err)));
  }
  /* Genel LCW AI çalışma alanı: lazy; ilk geçişte yüklenir. */
  if(tab==='lcwai'){
    void window.BLPerf.ensureFeature('lcwaiChat').then(()=>{
      if(currentActiveTab()==='lcwai')return window.initLcwAiChat?.();
    }).catch(err=>showToast(err&&err.message||String(err)));
  }
  if(tab==='overview')void ensureOverviewOabModule();
  if(tab==='overview')void ensureOverviewIntakeModule();
  /* v7.81 — Veri Yönetimi. Lazy: ilk geçişte yüklenir, açılışta değil.
     Sekmeden çıkılıp geri dönülürse modül zaten yüklüdür ve yalnız tazelenir. */
  if(tab==='source'){
    void window.BLPerf.ensureFeature('dataManagement').then(()=>{
      if(currentActiveTab()!=='source')return;
      window.BLDataManagement?.mount?.(document.getElementById('dataManagementRoot'));
    }).catch(err=>{
      if(currentActiveTab()!=='source')return;
      window.BLUI?.renderState(document.getElementById('dataManagementRoot'),{
        kind:'error',title:appLang==='en'?'Data Management could not be loaded.':'Veri Yönetimi yüklenemedi.',
        detail:appLang==='en'?'Check the server connection and try again.':'Sunucu bağlantısını kontrol edip yeniden deneyin.',
        actionLabel:err?.code==='BL_SCRIPT_TIMEOUT'?(appLang==='en'?'Reload':'Yeniden yükle'):(appLang==='en'?'Retry':'Yeniden dene'),
        onAction:()=>err?.code==='BL_SCRIPT_TIMEOUT'?window.location.reload():switchTab('source'),
      });
      showToast(err&&err.message||String(err));
    });
  }
  if(['cp','orders','shipping'].includes(tab)){
    // Özellik zaten yüklüyse değişmemiş tablo baştan çizilmez (30k satırda her
    // girişte ≈1,3 sn donma). Veri değiştiyse ertelenmiş çizim zaten çalışır.
    const deferredUiWasLoaded=window.BLPerf?.isFeatureLoaded?.('deferredUi')===true;
    void window.BLPerf.ensureFeature('deferredUi').then(()=>{
      if(currentActiveTab()!==tab||deferredUiWasLoaded)return;
      // İlk girişte veri ve kullanıcı profili birlikte çözümleniyor; erken
      // çizim favori görünüm/filtre uygulanmadan yanlış bir tablo göstermemeli.
      if(profileFirstVisit)return;
      if(tab==='cp'&&state.cp)renderCP();
      if(tab==='orders'&&state.orders)renderOrders();
      if(tab==='shipping'&&typeof renderShipTable==='function')renderShipTable();
    }).catch(err=>showToast(err.message));
  }
  if(tab==='koleksiyon'){
    void ensureCollectionCatalogLoaded();
    // Ana veri kataloğu (ASAS modeli, filtresiz) yalnız Koleksiyon açıldığında,
    // betik değerlendirmesi bittikten sonra bir kez çekilir.
    setTimeout(()=>void ensureCollectionMasterCatalogLoaded(),0);
    void (window.BLPerf?.ensureFeature?.('deferredUi') || Promise.resolve()).catch(()=>{});
  }
  if(tab==='backlog'&&typeof fetchCurrentBacklog==='function'&&!backlogLoadedOnce)fetchCurrentBacklog();
  // v9.46 — Teslimat riski analizi açılış kritik yolunda değil: Backlog sekmesi
  // ilk açıldığında lazy yüklenir. Panel kapalıysa hiçbir veri çekmez.
  if(tab==='backlog')void (window.BLPerf?.ensureFeature?.('backlogAnalysis')||Promise.resolve()).catch(()=>{});
  /* v9.48 — Genel Bakış'ın üretim öncelikleri paneli açılış kritik yolunda
     değil: sekmeye geçildiğinde yüklenir, yüklendiğinde mevcut satırlarla
     kendini çizer (Genel Bakış zaten çizilmiş olabilir). */
  if(tab==='overview'&&startupReadySignaled){
    // Motor zaten yüklüyse "hazır" olayı yeniden işlenmez: her girişte kararları
    // temizlemek CP/Siparişler önceliklerini ≈1 sn baştan hesaplatıyordu.
    const decisionEngineWasReady=Boolean(window.BLCpAssistant&&typeof window.BLCpAssistant.computeDecisionsForRows==='function');
    void (window.BLPerf?.ensureFeature?.('cpAssistant')||Promise.resolve())
      .then(()=>{if(decisionEngineWasReady)return;try{invalidateUnifiedPriorityDecisions('overview-decision-engine-ready',['cp']);void scheduleUnifiedPrioritiesForTable('cp');renderOverview();}catch(_){}}).catch(()=>{});
  }
  document.querySelectorAll('.vfMenu.open').forEach(x=>x.classList.remove('open'));
  const bar=document.querySelector('.vfBar');
  const allowed=['cp','orders','shipping','koleksiyon'].includes(tab);
  if(bar){
    bar.hidden=!allowed;
    bar.style.display=allowed?'flex':'none';
    bar.setAttribute('aria-hidden',allowed?'false':'true');
  }
  if(typeof updateShippingBtnVisibility==='function') updateShippingBtnVisibility();
  // Her sayfanın profili ilk girişte yukarıda veri yükleme ile birlikte çözülür;
  // aynı sayfaya dönüldüğünde kullanıcının geçici seçimi korunur.
  if(tab==='koleksiyon' && !profileFirstVisit && typeof renderKol==='function') renderKol();
  if(tab==='shipping' && profileFirstVisit){
    void profileReady.then(()=>{if(currentActiveTab()==='shipping'&&typeof renderShipTable==='function'){
      applyStoredProfilesForCurrentPage(true);
      renderShipTable();
    }});
  }
  if(tab==='lfl')void window.BLPerf.ensureFeature('lfl').then(()=>window.initLFL?.()).catch(err=>showToast(err.message));
  if(tab==='opencosting'){ window.BLPerf.ensureFeature('openCosting').then(()=>window.initOpenCosting?.()).catch(err=>showToast(err.message)); }
  if(tab==='automations')void window.BLPerf.ensureFeature('automations').then(()=>{window.initAutomationStudio?.();window.initAiAutomationImport?.();}).catch(err=>showToast(err.message));
  if(typeof fitTableHeights==='function') setTimeout(fitTableHeights, 0);
  if(typeof syncFreezeButtonState==='function')setTimeout(syncFreezeButtonState,0);
  window.BLExceptionInboxView?.sync();
}
