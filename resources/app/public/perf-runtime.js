(function(global){
  'use strict';

  // Hata mesajları aktif arayüz dilinde üretilir (app-main appLang).
  const uiEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const pending=new Map();
  const scriptStates=new Map();
  const documentBootAt=Number(global.__BL_DOCUMENT_BOOT_AT);
  const runtimeOrigin=Number.isFinite(documentBootAt)?documentBootAt:((global.performance&&typeof global.performance.now==='function')?global.performance.now():Date.now());
  const runtimeMetrics=new Map();
  const runtimeMarks=[];
  const specs={
    xlsx:{global:'XLSX',files:['vendor/xlsx-style.js'],after(){if(global.BLExcelDates&&global.XLSX)global.BLExcelDates.installSheetJsHooks(global.XLSX);}},
    jszip:{global:'JSZip',files:['vendor/jszip.min.js']},
    exceljs:{global:'ExcelJS',files:['vendor/exceljs-shim.js','vendor/exceljs.min.js']},
    // Global Flow · Earth 3D: yalnız Earth görünümü açıldığında yüklenir (CESIUM_BASE_URL çağıran tarafından ayarlanır).
    cesium:{global:'Cesium',files:['vendor/cesium/Cesium.js']},
    pdf:{global:'pdfjsLib',files:['vendor/pdf.min.js','vendor/jspdf.umd.min.js'],after(){if(global.pdfjsLib)global.pdfjsLib.GlobalWorkerOptions.workerSrc=withVersion('vendor/pdf.worker.min.js');}},
  };

  // Surum, bu betigin kendi <script src="...?v=X"> etiketinden okunur. Boylece surum
  // numarasi burada ikinci kez elle tutulmaz; set-version.js tek basina yeterlidir.
  const VER=(function(){try{const src=(document.currentScript&&document.currentScript.src)||'';const m=src.match(/[?&]v=([^&]+)/);return m?decodeURIComponent(m[1]):'';}catch(e){return '';}})();
  function withVersion(src){if(!VER||/[?&]v=/.test(src))return src;return src+(src.includes('?')?'&':'?')+'v='+encodeURIComponent(VER);}

  function scriptKey(src){
    try{return new URL(src,document.baseURI).href;}catch(_){return src;}
  }
  function markLoaded(el,key){
    el.dataset.blState='loaded';
    scriptStates.set(key,{state:'loaded',element:el});
  }
  function markFailed(el,key,error){
    el.dataset.blState='error';
    scriptStates.set(key,{state:'error',element:el,error:error});
  }
  function existingStaticScriptIsReady(el){
    if(!el||el.dataset.blLazy)return false;
    if(el.readyState==='loaded'||el.readyState==='complete')return true;
    // Parser ile eager yüklenmiş bir <script> için `load` olayı, lazy loader
    // aynı etiketi daha sonra bulduğunda çoktan geçmiş olabilir. Modern
    // HTMLScriptElement'te readyState güvenilir/standart değildir; document
    // interactive/complete ise parser-script'in yürütmesi kesinlikle bitmiştir.
    return document.readyState==='interactive'||document.readyState==='complete';
  }
  function loadScript(rawSrc){
    const src=withVersion(rawSrc);
    const key=scriptKey(src);
    const known=scriptStates.get(key);
    if(known?.state==='loaded')return Promise.resolve(known.element);
    if(known?.state==='loading')return known.promise;
    // Removing a pending script cannot guarantee it will never execute. Keep
    // a timeout latched until document reload so retry cannot execute it twice.
    if(known?.error?.code==='BL_SCRIPT_TIMEOUT')return Promise.reject(known.error);
    if(known?.state==='error')scriptStates.delete(key);

    let existing=[...document.scripts].find(el=>scriptKey(el.src||'')===key || el.dataset.blLazy===rawSrc || el.dataset.blLazy===src);
    if(existing?.dataset.blState==='loaded'){
      markLoaded(existing,key);
      return Promise.resolve(existing);
    }
    if(existing?.dataset.blState==='error'){
      try{existing.remove();}catch(_){}
      existing=null;
    }

    const el=existing||document.createElement('script');
    const promise=new Promise((resolve,reject)=>{
      let settled=false,timer;
      const cleanup=()=>{clearTimeout(timer);el.removeEventListener('load',onLoad);el.removeEventListener('error',onError);};
      const onLoad=()=>{if(settled)return;settled=true;cleanup();markLoaded(el,key);resolve(el);};
      const onError=()=>fail(false);
      const fail=timedOut=>{if(settled)return;settled=true;cleanup();const error=new Error(rawSrc+(uiEn()?' could not be loaded.':' yüklenemedi.'));if(timedOut)error.code='BL_SCRIPT_TIMEOUT';markFailed(el,key,error);reject(error);};
      el.addEventListener('load',onLoad,{once:true});
      el.addEventListener('error',onError,{once:true});
      timer=setTimeout(()=>{fail(true);try{el.remove();}catch(_){}},30000);
      if(!existing){
        el.src=src;
        el.async=true;
        el.dataset.blLazy=rawSrc;
        el.dataset.blState='loading';
        document.head.appendChild(el);
      }else{
        el.dataset.blState=el.dataset.blState||'loading';
        // Daha önce DOM'a eklenmiş ve artık yüklenmiş bir betiğin load olayı geçmiş
        // olabilir. Eager parser-script'leri document hazırsa yüklenmiş kabul et;
        // aksi halde geçmiş bir `load` event'ini sonsuza kadar bekleriz.
        if(existingStaticScriptIsReady(el))queueMicrotask(onLoad);
      }
    });
    scriptStates.set(key,{state:'loading',element:el,promise});
    return promise;
  }

  /* Geçici yükleme hatası (sunucu kısa süre meşgul/yeniden başlıyor) bütün
     modülü kullanılamaz bırakmasın: başarısız betik bir kez, kısa bir
     beklemeyle yeniden istenir. loadScript hatalı kaydı zaten temizler. */
  async function loadScriptWithRetry(rawSrc){
    try{return await loadScript(rawSrc);}
    catch(error){if(error?.code==='BL_SCRIPT_TIMEOUT')throw error;await new Promise(resolve=>setTimeout(resolve,600));return loadScript(rawSrc);}
  }

  async function ensureLibrary(name){
    const spec=specs[name];if(!spec)throw new Error((uiEn()?'Unknown performance module: ':'Bilinmeyen performans modülü: ')+name);
    if(global[spec.global] && (name!=='pdf'||global.jspdf?.jsPDF)){spec.after?.();return global[spec.global];}
    if(!pending.has(name))pending.set(name,(async()=>{
      for(const file of spec.files)await loadScriptWithRetry(file);
      spec.after?.();
      if(!global[spec.global] || (name==='pdf'&&!global.jspdf?.jsPDF))throw new Error(name+(uiEn()?' library could not be started.':' kütüphanesi başlatılamadı.'));
      return global[spec.global];
    })().finally(()=>pending.delete(name)));
    return pending.get(name);
  }

  const features={
    versionHistory:['version-history.js'],
    openCosting:['fx-calculation-engine.js','open-costing-engine.js','open-costing.js'],
    // v7.175 — otomasyon asistanı (şablonlar, "Hazır mı?", AI yönergesi) saf
    // yardımcıdır; iki görünüm dosyası da onu window'dan okur, bu yüzden önce.
    automations:['automation-assistant.js','automations.js','ai-automation-import.js'],
    // Genel LCW AI çalışma alanı: ortak istemci + güvenli Markdown + görünüm.
    lcwaiChat:['lcwai-assistant.js?rev=1','lcwai-markdown.js?rev=1','lcwai-chat.js?rev=1'],
    agentOffice:['lcwai-assistant.js?rev=1','lcwai-markdown.js?rev=1','agent-office-scene.js?rev=1','agent-office.js?rev=2'],
    layoutDocument:['lcwai-assistant.js?rev=1','layout-control-template.js?rev=3','layout-control-engine.js?rev=4','layout-document-reader.js?rev=2'],
    layoutControl:['lcwai-assistant.js?rev=1','layout-control-template.js?rev=3','layout-control-engine.js?rev=4','layout-document-reader.js?rev=2','layout-ai-review.js?rev=1','layout-control.js?rev=4'],
    // LCW AI Çıktı Düzenleyici + çıktı şablonları: yalnız "Düzenle"/"Şablonlar" ile yüklenir.
    lcwaiOutputEditor:['lcwai-output-layout.js?rev=1','lcwai-output-editor.js?rev=3'],
    lfl:['lfl-calculation-engine.js','lfl.js?rev=2'],
    // v7.0.229 — Üreticiler sayfası: saf motor ve ortak rehber görünümden ÖNCE.
    // email-groups.js deferredUi ile AYNI adla listelenir; loadScript tek kez yükler.
    manufacturers:['manufacturer-cards-engine.js?rev=1','email-groups.js?rev=2','manufacturers.js?rev=1'],
    licensecards:['license-cards-engine.js?rev=1','license-atlas-engine.js?rev=2','license-atlas.js?rev=2','license-atlas-workspace.js?rev=1','license-atlas-shell.js?rev=1','license-cards.js?rev=3'],
    collectionTools:['pricing-workspace-engine.js?rev=2','quotations.js?rev=4','collection-analytics-engine.js','price-supplier-insights-engine.js','price-supplier-analysis.js'],
    // v9.46 — Backlog teslimat riski analizi. Sıra önemli: iki saf motor
    // görünüm katmanından ÖNCE yüklenir (görünüm ikisini de window'dan okur).
    // order-decision-engine.js index.html'de eager yüklenir; burada yeniden
    // listelemek geçmiş `load` event'ine takılabilen duplicate-script beklemesi
    // yaratıyordu. Lazy grup yalnız gerçekten lazy bağımlılıkları içerir.
    backlogAnalysis:['backlog-delivery-engine.js','backlog-delivery-insights.js','backlog-delivery-analysis.js'],
    // Yol Süreleri › İthalat Yol Süresi Analizi: saf motor görünümden ÖNCE yüklenir.
    transitAnalysis:['transit-analysis.js','transit-analysis-ui.js'],
    /* v9.48 — CP üretim öncelikleri. Sıra önemli: iki saf motor görünümden
       ÖNCE yüklenir; görünüm ikisini de window'dan okur. */
    /* backlog-delivery-engine.js BURADA ZORUNLU: CP hazırlık motoru teslimat
       sonucunu ondan okur (tek kanonik kaynak). Listede olmadığı sürüm canlıda
       her siparişi sessizce "Hesaplanamıyor" gösteriyordu. */
    globalFlowEarth:['overview-global-flow-earth.js?rev=20261018'],
    // Kullanıcı menüsü → Ön Ayar Paylaşımı; yalnız ilk açılışta yüklenir.
    presetShare:['preset-share.js?rev=1'],
    syncHealth:['sync-health-ui.js'],
    masterReleases:['master-releases-ui.js'],
    /* PLM numune talepleri (CoreNectum Requests) kontrol listesine kanıt verir;
       iki dosya görünümden ÖNCE yüklenir. deferredUi'de de listelidir (sağ tık
       penceresi); loadScript aynı dosyayı tek kez yükler. */
    cpAssistant:['backlog-delivery-engine.js','cp-readiness-engine.js','cp-checklist-engine.js','cp-rules-engine.js','plm-sample-requests-engine.js','plm-sample-requests.js','cp-decision-runtime.js','cp-overview-assistant.js?rev=20261019'],
    /* Test Raporu Aktarımı: yalnız menüden açılınca ya da CP'ye dosya
       bırakılınca yüklenir. Saf motor görünümden ÖNCE gelir. */
    testReportImport:['lcwai-assistant.js?rev=1','test-report-engine.js?rev=2','test-report-import.js?rev=2'],
    // Overview'un ilk çizimine gerekmeyen yardımcılar UI_READY sonrasında
    // ortak lazy-loader ile yüklenir. Sekmeye geçiş bunları aynı promise ile
    // bekler; böylece işlevler kaybolmaz, yalnız açılış kritik yolundan çıkar.
    /* lcwai-assistant.js — LCW AI ortak istemcisi (window.BuyerLogAI). AI paneli
       açan modüller (Otomasyon, CP Kuralları) onu ayrıca _loadScript ile
       ister; aynı dize tek kez yüklenir. */
    /* user-access-ui.js LCW AI istemcisi ve güncelleme testinin hemen ardından gelir: açılış
       perdesinin "profil" kapısı ona bağlıdır ve diğer ertelenmiş modüllerin
       yüklenmesini beklemez. */
    deferredUi:[
      'lcwai-assistant.js?rev=1','update-test-ui.js?rev=5','user-access-ui.js?rev=APP-UPDATE-V3','formula-engine.js','formula-columns.js','plm-sample-requests-engine.js','plm-sample-requests.js','plm-bom.js','row-context-menu.js','plm-operations.js','plm-image-package-import.js?rev=2','email-groups.js?rev=2',
      'quick-filter-groups.js','kpi-groups.js','user-management.js',
      /* v7.81 — horizon-editor.js kaldırıldı: kişisel ufuk düzenleyicisi
         artık yok, ufuk Veri Yönetimi'nden yönetiliyor. */'override-sync.js','backup-manager.js','fx-calculation-engine.js','fx.js',
    ],
    /* v7.81 — Veri Yönetimi ekranı açılış kritik yolunda DEĞİLDİR: günlük
       kullanımda hiç açılmayan bir kurulum ekranıdır. Sekmeye ilk geçişte
       yüklenir (§11). */
    dataManagement:['data-management-picker.js?rev=1','data-management-filter.js?rev=2','data-management-source.js?rev=2','data-management-mapping.js?rev=1','data-management-cpcolumns.js?rev=1','data-management-matchrule.js?rev=1','data-management-query.js?rev=1','data-management-connection.js?rev=1','data-cleanup.js?rev=2','data-management.js?rev=11'],
  };
  // Yüklenmesi TAMAMLANMIŞ özellikler: çağıran "ilk kez mi yüklendi" ayrımını
  // yapabilsin (ör. sekmeye her girişte tabloyu yeniden çizmemek için).
  const loadedFeatures=new Set();
  function isFeatureLoaded(name){return loadedFeatures.has(String(name));}
  async function ensureFeature(name){
    const files=features[name];if(!files)throw new Error((uiEn()?'Unknown feature module: ':'Bilinmeyen özellik modülü: ')+name);
    if(name==='versionHistory'&&Array.isArray(global.BL_VERSION_HISTORY))return;
    if(name==='openCosting'&&typeof global.initOpenCosting==='function')return;
    if(name==='automations'&&typeof global.initAutomationStudio==='function'&&typeof global.initAiAutomationImport==='function')return;
    if(name==='lfl'&&typeof global.initLFL==='function')return;
    if(name==='lcwaiChat'&&typeof global.initLcwAiChat==='function'&&global.BLMarkdown)return;
    if(name==='layoutControl'&&global.BLLayoutControl&&global.BLLayoutControlEngine)return;
    if(name==='lcwaiOutputEditor'&&global.BLOutputEditor&&global.BLOutputLayout)return;
    if(name==='manufacturers'&&typeof global.initManufacturersPage==='function'&&global.BLEmailGroups)return;
    if(name==='collectionTools'&&typeof global.initPriceSupplierAnalysis==='function')return;
    if(name==='backlogAnalysis'&&global.BLBacklogAnalysis)return;
    if(name==='transitAnalysis'&&global.BLTransitAnalysis&&global.BLTransitAnalysisUI)return;
    // Eski/yarım bir BLCpAssistant objesi cache'ten kalmış olabilir. Unified
    // Priority tablosu ancak computeDecisionsForRows API'si gerçekten varsa
    // hazır sayılır; yalnız objenin varlığı lazy yüklemeyi kısa devre etmemeli.
    if(name==='cpAssistant'&&global.BLCpAssistant&&typeof global.BLCpAssistant.computeDecisionsForRows==='function')return;
    const key='feature:'+name;
    if(loadedFeatures.has(name))return;
    if(!pending.has(key)){
      // Dosyalar paralel indirilir, yürütme sırası korunur (sıralı loadScript).
      // Eskiden her dosya bir öncekinin bitmesini bekleyip ancak sonra
      // indiriliyordu; 18 dosyalık grup açılış perdesini ~1 sn uzatıyordu.
      preloadScripts(files);
      pending.set(key,(async()=>{for(const file of files)await loadScriptWithRetry(file);})().then(()=>{loadedFeatures.add(name);}).finally(()=>pending.delete(key)));
    }
    return pending.get(key);
  }
  const preloaded=new Set();
  function preloadScripts(files){
    if(!document.head)return;
    for(const file of files){
      const src=withVersion(file),key=scriptKey(src);
      if(preloaded.has(key)||scriptStates.has(key)||[...document.scripts].some(el=>scriptKey(el.src||'')===key))continue;
      preloaded.add(key);
      try{const link=document.createElement('link');link.rel='preload';link.as='script';link.fetchPriority='low';link.href=src;document.head.appendChild(link);}catch(_){}
    }
  }

  function clock(){return global.performance&&typeof global.performance.now==='function'?global.performance.now():Date.now();}
  function begin(name){return {name:String(name||'metric'),startedAt:clock()};}
  function record(name,value){
    const numeric=Math.max(0,Number(value)||0),key=String(name||'metric');
    const current=runtimeMetrics.get(key)||{count:0,totalMs:0,maxMs:0,lastMs:0};
    current.count++;current.totalMs+=numeric;current.lastMs=numeric;current.maxMs=Math.max(current.maxMs,numeric);runtimeMetrics.set(key,current);
    return numeric;
  }
  function mark(name,detail=null){
    const key=String(name||'MARK'),atMs=Math.max(0,clock()-runtimeOrigin);
    const entry={name:key,atMs,detail:detail&&typeof detail==='object'?{...detail}:detail};
    runtimeMarks.push(entry);while(runtimeMarks.length>80)runtimeMarks.shift();
    try{global.performance?.mark?.(key);}catch(_){/* optional browser timeline */}
    return entry;
  }
  function timeline(){return runtimeMarks.map(entry=>({...entry,detail:entry.detail&&typeof entry.detail==='object'?{...entry.detail}:entry.detail}));}
  function end(token){return token?record(token.name,clock()-token.startedAt):0;}
  function snapshot(){return Object.fromEntries([...runtimeMetrics].map(([key,value])=>[key,{...value,avgMs:value.count?value.totalMs/value.count:0}]));}
  function createBoundedCache(maxEntries=32){
    if(global.BLAnalysisCache?.create)return global.BLAnalysisCache.create(maxEntries);
    const entries=new Map(),limit=Math.max(1,Number(maxEntries)||32);
    const api={get(key){if(!entries.has(key))return undefined;const value=entries.get(key);entries.delete(key);entries.set(key,value);return value;},has:key=>entries.has(key),set(key,value){entries.delete(key);entries.set(key,value);while(entries.size>limit)entries.delete(entries.keys().next().value);return api;},delete:key=>entries.delete(key),clear:()=>entries.clear(),get size(){return entries.size;}};
    return api;
  }
  function throttle(fn, wait=100){
    let timer=0,last=0,pending=null;
    const run=()=>{timer=0;last=Date.now();const args=pending;pending=null;if(args)fn(...args);};
    return (...args)=>{pending=args;const remaining=Math.max(0,(Number(wait)||0)-(Date.now()-last));if(!timer)timer=setTimeout(run,remaining);};
  }
  function debounce(fn, wait=150){
    let timer=0;
    const wrapped=(...args)=>{clearTimeout(timer);timer=setTimeout(()=>{timer=0;fn(...args);},Math.max(0,Number(wait)||0));};
    wrapped.cancel=()=>{clearTimeout(timer);timer=0;};
    return wrapped;
  }
  // Development tanısı için 50 ms üzerindeki browser long task'ları sayılır.
  // Production konsoluna hiçbir şey yazılmaz; değerler yalnız istenirse snapshot()
  // üzerinden okunur.
  try{
    if('PerformanceObserver' in global){
      const observer=new PerformanceObserver(list=>list.getEntries().forEach(entry=>record('longTaskMs',entry.duration)));
      observer.observe({entryTypes:['longtask']});
    }
  }catch(_){/* unsupported browser */}

  mark('APP_BOOT_START');
  mark('FRONTEND_BOOT_START');
  mark('FRONTEND_BOOTSTRAP_START');
  global.BLPerf={ensureLibrary,ensureFeature,isFeatureLoaded,begin,end,record,mark,timeline,snapshot,origin:()=>runtimeOrigin,createBoundedCache,throttle,debounce,_loadScript:loadScript};
})(window);
