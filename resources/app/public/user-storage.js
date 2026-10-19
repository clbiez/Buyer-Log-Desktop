(function(global){
  'use strict';
  var native=global.localStorage;
  var ctx=global.BL_USER_CONTEXT||{};
  var uid=String(ctx.id||'anonymous').replace(/[^A-Za-z0-9_-]/g,'_');
  var prefixes=[
    'bl.excelTemplates.',
    'lcw_theme','lcw_rail','lcw_sidebar_collapsed','lcw.lang.','lcw.font.','lcw_font_step',
    'lcw.corePageFilters.','lcw.table.columnState.','lcw.tableViewFocus.','lcw.tableGroupOverrides.','lcw.freeze.','lcw.cp.assistant.','lcw.cp.checklist.','lcw.cp.rules.','lcw.cp.dimFilters.','lcw.cp.imageSize.',
    'lcw.orders.dimFilters.','lcw.overview.dimFilters.','lcw.overview.bgDimFilters.','lcw.backlog.autoState.','lcw.backlog.dateRange.','lcw.backlog.columnWidths.','lcw.backlog.analysis.','lcw.backlog.planactual.','lcw.backlog.overview.',
    'lcw.koleksiyon.rows.','lcw.koleksiyon.manufacturers.','lcw.koleksiyon.pricingExcelColumns.','lcw.koleksiyon.colState.','lcw.koleksiyon.scope.','lcw.koleksiyon.analytics.','lcw.prodstatus.mails.','lcw.mailTemplates.',
    'lcw.todo.','lcw.notifications.','lcw.masterReleaseNotice.','lcw.lfl.filters.','lcw.lfl.readyFilters.','lcw.lfl.customCompare.','lcw.lfl.analysisSplit.','lcw.quotations.columnWidths.','lcw.oab.','lcw.intake.',
    'lcw_view_favorite_','lcw_filter_favorite_','buyerlog.fx.persist.v1','buyerlog.workspace.','buyerlog.dashboard.','buyerlog.favorites.','buyerlog.presetCache.v2.',
    'bl.backlog.excelColumns.','bl.detailTables.showImages.','bl.modelImages.','bl.tableRange.','bl.refreshHistory.','bl.autoRefresh.','bl.lcwai.history.','buyerlog.overview.notesReminderCollapsed','buyerlog.overview.collectionSummary.','buyerlog.overview.layout.','buyerlog.overview.breakdown.','buyerlog.overview.globalFlow.'
  ];
  /* AYNI BİLGİSAYARDA BİRDEN FAZLA KULLANICI.
     Aşağıdaki kişisel filtre/görünüm anahtarları eskiden kullanıcı önekine
     alınmıyordu; cihazdaki bütün profiller aynı değeri okuyup yazıyor ve
     filtreler birbirine karışıyordu. Artık her profil kendi kopyasını tutar.
     Eşitlenen (SYNCED) önekler sunucuda zaten kullanıcıya bağlıdır; yerel
     aynaları da mutlaka burada kapsanmalıdır. */
  var formerlyDeviceWide=[
    'bl.quickFilterGroups.','lcw.collection.quickDims.','bl.formulaColumns.','bl.excelImport.profiles.','lcw.dashboard.','lcw.favorites.',
    'lcw.tableColWidth.','lcw.priceSupplierAnalysis.','lcw.manufacturersPage.','lcw.pricingHistory.columns.','lcw.priceHistory.mfrOrder.',
    'lcw.orders.imageSize.','lcw.koleksiyon.imageSize.','lcw.koleksiyon.modelGroups.view.','lcw.lfl.analysisHeights.',
    'lcw.backlog.radar.layout.','lcw.backlog.chart.','bl.backlog.excelFormulas.','buyerlog.shipCompare.','buyerlog.overview.worldClocks.',
    'buyerlog.detailDrawer.','buyerlog.backlog.detail.compact.','buyerlog.endeksmatikClipboard.',
    'buyerlog.fx.pending.','buyerlog.syncGuide.','blPlmSyncColumnChoice','lcw.koleksiyon.plmPending.','lcw.koleksiyon.plmListOptions.','lcw.transitAnalysis.view.','bl.releaseNotes.'
  ];
  prefixes=prefixes.concat(formerlyDeviceWide);
  function scoped(key){key=String(key);return prefixes.some(function(p){return key.indexOf(p)===0})}
  function actual(key){key=String(key);return scoped(key)?'bl.user.'+uid+'.'+key:key}
  // v4.73: Approvals page and its client-side preferences were removed.
  // Clear both legacy unscoped keys and per-user scoped copies; keep unrelated
  // quotation/collection approval data because those are separate workflows.
  try{
    var removedApprovalSuffixes=['lcw.appr.dimFilters.v1','lcw_view_favorite_appr','lcw_filter_favorite_appr'];
    var jsonStateSuffixes=['lcw.corePageFilters.auto.v1','lcw.table.columnState.v1','lcw.freeze.v1'];
    var keys=[];for(var rk=0;rk<native.length;rk++){var storedKey=native.key(rk);if(storedKey)keys.push(storedKey);}
    keys.forEach(function(storedKey){
      var suffix=storedKey.indexOf('bl.user.')===0?storedKey.split('.').slice(3).join('.'):storedKey;
      if(removedApprovalSuffixes.indexOf(suffix)>=0){native.removeItem(storedKey);return;}
      if(jsonStateSuffixes.indexOf(suffix)<0)return;
      try{
        var parsed=JSON.parse(native.getItem(storedKey)||'null');
        if(!parsed||typeof parsed!=='object'||!Object.prototype.hasOwnProperty.call(parsed,'appr'))return;
        delete parsed.appr;native.setItem(storedKey,JSON.stringify(parsed));
      }catch(_){ }
    });
  }catch(_){ }
  // Existing single-user preferences belong to the stable Moderator identity.
  // The visible name is now Gökberk, but the ID intentionally remains `moderator`
  // so themes, filters, views and column settings keep the same storage keys.
  // Migration is idempotent and copies only missing values; shared business data
  // is deliberately not copied or renamed.
  if(uid==='moderator'){
    var migrationKey='bl.user.moderator.preferencesMigrated.v2.93';
    try{
      var legacy=[];
      var nameAliases=['bl.user.gokberk.','bl.user.Gokberk.','bl.user.g_kberk.','bl.user.G_kberk.'];
      for(var i=0;i<native.length;i++){
        var k=native.key(i);if(!k)continue;
        if(k.indexOf('bl.user.')!==0&&scoped(k))legacy.push({source:k,key:k});
        for(var a=0;a<nameAliases.length;a++){
          if(k.indexOf(nameAliases[a])===0){var suffix=k.slice(nameAliases[a].length);if(scoped(suffix))legacy.push({source:k,key:suffix});}
        }
      }
      legacy.forEach(function(item){var destination=actual(item.key);if(native.getItem(destination)==null){var value=native.getItem(item.source);if(value!=null)native.setItem(destination,value)}});
      native.setItem(migrationKey,'1');
    }catch(_){ }
  }
  // Eski ortak (cihaz geneli) kayıt yalnız İLK açan profile taşınır ve ortak
  // kopya silinir; böylece sonraki profiller başkasının filtresini devralmaz.
  // Kullanıcı kimliği yoksa hiçbir şey sahiplenilmez.
  if(uid!=='anonymous'){
    try{
      var deviceWide=[];
      for(var dw=0;dw<native.length;dw++){
        var deviceKey=native.key(dw);
        if(deviceKey&&deviceKey.indexOf('bl.user.')!==0&&formerlyDeviceWide.some(function(p){return deviceKey.indexOf(p)===0}))deviceWide.push(deviceKey);
      }
      deviceWide.forEach(function(deviceKey){
        var personalKey=actual(deviceKey);
        if(native.getItem(personalKey)==null){var deviceValue=native.getItem(deviceKey);if(deviceValue!=null)native.setItem(personalKey,deviceValue);}
        native.removeItem(deviceKey);
      });
    }catch(_){ }
  }
  // Focus / Extended presetleri v10.68'den beri BLStorage ile yazılıyor ancak
  // eski sürümlerde kullanıcı kapsamına alınmadığı için global localStorage'da
  // kalabiliyordu. İlk açılışta bu eski kaydı kullanıcının kişisel alanına taşı.
  try{
    var tableViewPresetLegacyKey='lcw.tableViewFocus.v1';
    var tableViewPresetPersonalKey=actual(tableViewPresetLegacyKey);
    if(native.getItem(tableViewPresetPersonalKey)==null){
      var tableViewPresetLegacyValue=native.getItem(tableViewPresetLegacyKey);
      if(tableViewPresetLegacyValue!=null)native.setItem(tableViewPresetPersonalKey,tableViewPresetLegacyValue);
    }
  }catch(_){ }

  /* SUNUCU EŞİTLEMESİ (v7.02)
     localStorage TARAYICIYA özeldir: Edge'de yazılan not Chrome'da görünmez,
     tarayıcı verisi temizlenince kaybolur. Aşağıdaki önekler kullanıcı hesabına
     bağlı olarak sunucuda da tutulur ve açılışta birleştirilir.
     Filtre, kolon, görünüm ve Horizon ayarları hesapla birlikte taşınır.
     Collection satırları/notları gibi ortak iş verileri bu listede değildir. */
  var SYNCED=[
    'bl.excelTemplates.','lcw.todo.','lcw.notifications.','lcw.mailTemplates.','lcw.prodstatus.mails.',
    'lcw.corePageFilters.','lcw.table.columnState.','lcw.tableViewFocus.','lcw.tableGroupOverrides.','lcw.freeze.','lcw.cp.assistant.','lcw.cp.checklist.','lcw.cp.rules.','lcw.cp.dimFilters.','lcw.orders.dimFilters.',
    'lcw.overview.dimFilters.','lcw.overview.bgDimFilters.','lcw.backlog.autoState.','lcw.backlog.columnWidths.','lcw.backlog.analysis.','lcw.backlog.planactual.','lcw.backlog.overview.',
    'lcw.lfl.filters.','lcw.lfl.readyFilters.','lcw.lfl.customCompare.','lcw.lfl.analysisSplit.',
    'lcw.koleksiyon.scope.','lcw.koleksiyon.analytics.','lcw.koleksiyon.colState.','lcw.koleksiyon.pricingExcelColumns.',
    'lcw.quotations.columnWidths.','lcw.oab.','lcw.intake.','lcw_view_favorite_','lcw_filter_favorite_',
    'buyerlog.workspace.horizon.','buyerlog.workspace.applied-horizon.','buyerlog.dashboard.','lcw.dashboard.','buyerlog.favorites.','lcw.favorites.','bl.backlog.excelColumns.','bl.detailTables.showImages.',
    'bl.formulaColumns.', // v7.28 — hesaplanan sütun tanımları kullanıcıyla birlikte taşınır
    'bl.excelImport.profiles.', // Excel içe aktarma eşleme profilleri: kullanıcıya ve modüle ait YAPILANDIRMA (çalışma kitabı verisi değil)
    'lcw.cp.imageSize.','lcw_theme','lcw_rail','lcw_sidebar_collapsed','lcw.lang.','lcw.font.','lcw_font_step','bl.refreshHistory.','bl.autoRefresh.','buyerlog.overview.notesReminderCollapsed','buyerlog.overview.collectionSummary.','buyerlog.overview.layout.','buyerlog.overview.breakdown.','buyerlog.overview.globalFlow.'
  ];
  function synced(key){key=String(key);return SYNCED.some(function(p){return key.indexOf(p)===0})}
  var META_KEY='bl.user.'+uid+'.__syncMeta.v1';
  var ROLE_DEFAULTS_KEY='bl.user.'+uid+'.__roleWorkspaceDefaults.v1';
  var roleDefaults={};
  try{roleDefaults=JSON.parse(native.getItem(ROLE_DEFAULTS_KEY)||'{}')||{};}catch(_){roleDefaults={};}
  function readMeta(){try{return JSON.parse(native.getItem(META_KEY)||'{}')||{}}catch(_){return{}}}
  function writeMeta(meta){try{native.setItem(META_KEY,JSON.stringify(meta))}catch(_){}}
  var pending={},pushTimer=null;
  // Sunucuda başka bir akışla (Ön Ayar Paylaşımı) yazılmış ve sayfa yenilenene
  // kadar yerelde KİLİTLİ tutulan anahtarlar. Kapanış sırasındaki otomatik
  // kaydetmeler bellekteki eski değeri yeni damgayla geri itemez.
  var adopted={};
  function schedulePush(){
    if(pushTimer&&typeof global.clearTimeout==='function')global.clearTimeout(pushTimer);
    // Yazma sırasında değil, kısa bir duraklamadan sonra gönderilir: not yazarken
    // her tuşta istek atmak gereksiz yük olurdu.
    if(typeof global.setTimeout==='function')pushTimer=global.setTimeout(flushPush,1200);
    else{pushTimer='immediate';flushPush();}
  }
  function flushPush(){
    pushTimer=null;
    var entries=pending;pending={};
    if(!Object.keys(entries).length)return;
    try{
      fetch('/api/user-preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:entries})})
        .catch(function(){/* çevrimdışı olabilir: yerel kopya zaten yazıldı */});
    }catch(_){ }
  }
  // Sekme kapanırken bekleyen yazma kaybolmasın. (Tarayıcı dışı ortamlarda —
  // testler gibi — addEventListener bulunmayabilir; bu dosyanın yüklenmesi
  // oraya da bağlı olduğu için korumalı çağrılır.)
  if(typeof global.addEventListener==='function'){
    global.addEventListener('pagehide',function(){ if(pushTimer){if(typeof global.clearTimeout==='function')global.clearTimeout(pushTimer);flushPush();} });
  }

  var api={
    getItem:function(key){var personal=native.getItem(actual(key));if(personal!=null)return personal;var inherited=roleDefaults[String(key)];return inherited&&inherited.value!=null?String(inherited.value):null;},
    setItem:function(key,value){
      if(adopted[String(key)])return;
      var result=native.setItem(actual(key),String(value));
      if(synced(key)){
        var stamp=new Date().toISOString();
        var meta=readMeta();meta[key]=stamp;writeMeta(meta);
        pending[key]={value:String(value),updatedAt:stamp};
        schedulePush();
      }
      return result;
    },
    removeItem:function(key){
      if(adopted[String(key)])return;
      var result=native.removeItem(actual(key));
      if(synced(key)){
        try{fetch('/api/user-preferences/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys:[String(key)]})}).catch(function(){});}catch(_){}
      }
      return result;
    },
    clear:function(){return native.clear()},
    key:function(index){return native.key(index)},
    actualKey:actual,
    native:native,
    isSynced:synced,
    isUserScoped:scoped,
    syncedPrefixes:SYNCED.slice(),
    /* Sunucunun yazdığı değerleri kendi zaman damgasıyla yerel kopyaya işler ve
       bu anahtarları sayfa yenilenene kadar kilitler. `removed` anahtarları
       yerelden kaldırılır. Çağıran ardından sayfayı yeniler. */
    adoptRemote:function(entries,removed){
      var meta=readMeta();
      Object.keys(entries||{}).forEach(function(key){
        var item=entries[key]||{};if(!synced(key)||item.value==null)return;
        native.setItem(actual(key),String(item.value));
        meta[key]=String(item.updatedAt||new Date().toISOString());
        delete pending[key];adopted[key]=true;
      });
      (Array.isArray(removed)?removed:[]).forEach(function(key){
        key=String(key);if(!synced(key))return;
        native.removeItem(actual(key));delete meta[key];delete pending[key];adopted[key]=true;
      });
      writeMeta(meta);
    },
    /* Açılışta sunucudaki kopyayla birleştirir. Kural: hangi taraf daha YENİYSE
       o kazanır. Yerel taraf daha yeniyse sunucuya gönderilir, böylece bu
       tarayıcıda yazılmış notlar diğerlerine de geçer. */
    hydrate:function(){
      return fetch('/api/user-preferences',{headers:{'Accept':'application/json'}})
        .then(function(res){return res.ok?res.json():null})
        .then(function(data){
          if(!data||!data.entries)return {applied:0,pushed:0};
          roleDefaults=data.roleDefaults&&typeof data.roleDefaults==='object'?data.roleDefaults:{};
          try{native.setItem(ROLE_DEFAULTS_KEY,JSON.stringify(roleDefaults));}catch(_){}
          var meta=readMeta(),applied=0,push={};
          /* AÇIKÇA SİLİNMİŞ ANAHTARLAR ÖNCE İŞLENİR.
             Sunucuda olmayan her yerel anahtar aşağıda yukarı taşınıyor; bu,
             kullanıcının SİLDİĞİ kaydı (ör. kişisel Horizon katmanı) her
             açılışta geri getiriyordu. Silme zaman damgalıdır: yerel kopya
             silmeden SONRA yazılmışsa korunur, öncesindeyse temizlenir. */
          var deletions=data.deletions&&typeof data.deletions==='object'?data.deletions:{};
          Object.keys(deletions).forEach(function(key){
            if(!synced(key)||data.entries[key])return;
            var stamp=String(deletions[key]||''),localStamp=meta[key]||'';
            if(localStamp&&stamp&&localStamp>stamp)return;
            native.removeItem(actual(key));
            delete meta[key];
            delete pending[key];
          });
          Object.keys(data.entries).forEach(function(key){
            if(!synced(key))return;
            var remote=data.entries[key]||{},localStamp=meta[key]||'';
            var localValue=native.getItem(actual(key));
            if(localValue==null||!localStamp||String(remote.updatedAt||'')>localStamp){
              if(remote.value!=null&&remote.value!==localValue){
                native.setItem(actual(key),String(remote.value));
                meta[key]=String(remote.updatedAt||new Date().toISOString());
                applied++;
              }
            }else if(localStamp>String(remote.updatedAt||'')){
              push[key]={value:localValue,updatedAt:localStamp};
            }
          });
          // Sunucuda hiç olmayan yerel anahtarlar da yukarı taşınır.
          Object.keys(meta).forEach(function(key){
            if(!synced(key)||data.entries[key])return;
            // Silinmiş anahtar yalnız silmeden sonra yazıldıysa geri gider.
            var tombstone=String(deletions[key]||'');
            if(tombstone&&!(String(meta[key]||'')>tombstone))return;
            var value=native.getItem(actual(key));
            if(value!=null)push[key]={value:value,updatedAt:meta[key]};
          });
          writeMeta(meta);
          var pushed=Object.keys(push).length;
          if(pushed){pending=Object.assign(pending,push);flushPush();}
          return {applied:applied,pushed:pushed};
        })
        .catch(function(){return {applied:0,pushed:0}});
    }
  };
  Object.defineProperty(api,'length',{get:function(){return native.length}});
  global.BLStorage=api;

  // Canonical data registry is loaded before module bindings and UI labels.
  // Cross-module joins use BLCanonicalFields; labels render only visible names.
  function loadLabels(){
    if(!global.document||global.BLColumnLabels||global.document.querySelector('script[data-bl-canonical-column-labels]'))return;
    var labelScript=global.document.createElement('script');
    labelScript.src='canonical-column-labels.js?rev=7.66'+(global.BL_ASSET_VERSION?'&v='+encodeURIComponent(global.BL_ASSET_VERSION):'');labelScript.async=false;labelScript.setAttribute('data-bl-canonical-column-labels','1');
    (global.document.head||global.document.documentElement).appendChild(labelScript);
  }
  function loadModuleBindings(){
    if(!global.document)return;
    if(global.BLCanonicalModuleBindings){loadLabels();return;}
    var bindingScript=global.document.querySelector('script[data-bl-canonical-module-bindings]');
    if(!bindingScript){
      bindingScript=global.document.createElement('script');bindingScript.src='canonical-module-bindings.js?rev=7.66'+(global.BL_ASSET_VERSION?'&v='+encodeURIComponent(global.BL_ASSET_VERSION):'');bindingScript.async=false;bindingScript.setAttribute('data-bl-canonical-module-bindings','1');
      (global.document.head||global.document.documentElement).appendChild(bindingScript);
    }
    bindingScript.addEventListener('load',loadLabels,{once:true});
    bindingScript.addEventListener('error',loadLabels,{once:true});
  }
  if(global.document){
    if(global.BLCanonicalFields)loadModuleBindings();
    else{
      var fieldScript=global.document.querySelector('script[data-bl-canonical-fields]');
      if(!fieldScript){fieldScript=global.document.createElement('script');fieldScript.src='canonical-fields.js?rev=7.67'+(global.BL_ASSET_VERSION?'&v='+encodeURIComponent(global.BL_ASSET_VERSION):'');fieldScript.async=false;fieldScript.setAttribute('data-bl-canonical-fields','1');(global.document.head||global.document.documentElement).appendChild(fieldScript);}
      fieldScript.addEventListener('load',loadModuleBindings,{once:true});
      fieldScript.addEventListener('error',loadLabels,{once:true});
    }
  }
})(window);
