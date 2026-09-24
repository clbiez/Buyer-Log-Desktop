(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCopilotUICommands=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  /* ===================================================================
     COPILOT — UI KOMUT YOLU (v9.23)

     Ajan sunucuda çalışır ve DOM'a erişemez. "Mart'takileri göster" gibi bir
     istek bu yüzden sunucuda DOĞRULANMIŞ bir KOMUT ZARFI üretir, uygulamayı
     istemci yapar.

     NEDEN SEÇİCİ OTOMASYONU DEĞİL: modele CSS seçici ya da tıklama adımı
     ürettirmek, arayüzün her küçük değişiminde bozulan kırılgan bir bağ kurar
     ve modelin uyduracağı bir seçici sessizce yanlış yere tıklar. Bunun yerine
     kapalı bir ANLAMSAL komut kümesi var: navigate / filter / clearFilters.
     Burada olmayan bir komut uygulanamaz.

     YETKİ: sunucu zaten kontrol etti, ama switchTab kendi kontrolünü de yapar.
     İki kapı da açık olmadan hiçbir ekran açılmaz.
     =================================================================== */

  /* v11.10 — modelImages: "ASAS'tan görselleri getir", "eksik görselleri
     tamamla", "seçili görselleri PLM'den yenile".

     Bu komut da kapalı kümenin bir üyesidir; modele DOM tıklattırmaz. Hedef
     küme GÜNCEL GÖRÜNÜM ÇÖZÜMLEYİCİSİNDEN gelir, modelin ürettiği bir
     listeden değil: yani "bu ekranda ne varsa" ne ise onu işler, veritabanının
     tamamına genişlemez. Kaynak belirsizse komut uygulanmaz ve kullanıcıya
     sorulur — sessizce ASAS ya da PLM seçilmez. */
  var COMMANDS=['navigate','filter','clearFilters','modelImages'];
  var IMAGE_SOURCES=['asas','plm'];
  var IMAGE_MODES=['missing','selected','all'];

  function clean(value){return String(value==null?'':value).trim();}

  /* Dataset alan anahtarı ile tablo sütun anahtarı AYNI olmak zorunda değil
     (dataset 'season', Koleksiyon tablosu 'Sezon'). Kanonik kayıt ikisini
     birbirine bağlayan tek kaynaktır; burada tekrar eşleme yazılmaz. */
  function resolveColumnKey(canonicalModule,command,columns,registry){
    var names=(columns||[]).map(function(col){return col&&col.k;}).filter(Boolean);
    // Kanonik kayıt ENJEKTE edilebilir: tarayıcıya bağlanmak modülü test
    // edilemez kılıyordu ve bağ gereksiz.
    var fields=registry||(typeof window!=='undefined'?window.BLCanonicalFields:null);
    var canonicalId=clean(command.canonicalId);
    if(fields&&canonicalId&&typeof fields.bindingFor==='function'){
      var binding=fields.bindingFor(canonicalModule,canonicalId);
      var keys=(binding&&binding.keys)||[];
      for(var i=0;i<keys.length;i++){
        var hit=names.find(function(name){return fields.token(name)===fields.token(keys[i]);});
        if(hit)return hit;
      }
    }
    // Kanonik eşleşme yoksa ham alan adıyla dene; o da tutmazsa null.
    var raw=clean(command.field);
    if(!raw)return null;
    if(fields&&typeof fields.token==='function'){
      var direct=names.find(function(name){return fields.token(name)===fields.token(raw);});
      if(direct)return direct;
    }
    return names.indexOf(raw)>=0?raw:null;
  }

  /* Uygulamanın kendi fonksiyonlarına bağlanır; DOM'a dokunmaz.
     deps enjekte edilebilir olduğu için bu modül tarayıcısız da sınanabilir. */
  function createRunner(deps){
    var d=deps||{};
    function app(){return d.app||(typeof window!=='undefined'?window:{});}

    function navigate(command){
      var switchTab=d.switchTab||app().switchTab;
      if(typeof switchTab!=='function')return {ok:false,reason:'navigation-unavailable'};
      // switchTab yetkisizse false döner ve kendi uyarısını gösterir.
      var moved=switchTab(command.route);
      return moved===false?{ok:false,reason:'forbidden'}:{ok:true,route:command.route};
    }

    function filter(command){
      var state=d.state||app().state;
      var colsByTable=d.colsByTable||app().COLS_BY_TABLE;
      if(!state||!colsByTable)return {ok:false,reason:'filter-unavailable'};
      var tableKey=clean(command.tableKey);
      if(!tableKey)return {ok:false,reason:'table-unknown'};
      var columns=colsByTable[tableKey];
      if(!columns)return {ok:false,reason:'table-unknown'};
      // Kanonik bağlama dataset adıyla kayıtlı ('collection'), tablo anahtarıyla değil.
      /* Eski tek sütunlu zarf da desteklenir; yeni zarf columns taşır. */
      var wanted=Array.isArray(command.columns)&&command.columns.length
        ? command.columns
        : [{field:command.field,canonicalId:command.canonicalId,label:command.label,values:command.values}];
      var canonicalModule=clean(command.source)||tableKey;
      var resolvedColumns=[];
      for(var i=0;i<wanted.length;i++){
        var key=resolveColumnKey(canonicalModule,wanted[i],columns,d.canonicalFields);
        // Biri çözülemezse HİÇBİRİ uygulanmaz: yarım filtre yanlış tablo demek.
        if(!key)return {ok:false,reason:'field-unknown',field:wanted[i]&&wanted[i].field};
        resolvedColumns.push({key:key,values:wanted[i].values||[],label:wanted[i].label});
      }
      var moved=navigate(command);
      if(!moved.ok)return moved;
      state.colFilters=state.colFilters||{};
      state.colFilters[tableKey]=state.colFilters[tableKey]||{};
      for(var j=0;j<resolvedColumns.length;j++){
        state.colFilters[tableKey][resolvedColumns[j].key]={values:new Set(resolvedColumns[j].values)};
      }
      var rerender=d.rerender||app().rerenderTable;
      if(typeof rerender==='function')rerender(tableKey);
      return {ok:true,tableKey:tableKey,column:resolvedColumns[0].key,
        columns:resolvedColumns.map(function(item){return item.key;}),
        values:resolvedColumns.reduce(function(sum,item){return sum+(item.values||[]).length;},0)};
    }

    function clearFilters(command){
      var state=d.state||app().state;
      if(!state)return {ok:false,reason:'filter-unavailable'};
      var tableKey=clean(command.tableKey);
      if(!tableKey)return {ok:false,reason:'table-unknown'};
      if(state.colFilters&&state.colFilters[tableKey])state.colFilters[tableKey]={};
      var rerender=d.rerender||app().rerenderTable;
      if(typeof rerender==='function')rerender(tableKey);
      return {ok:true,tableKey:tableKey};
    }

    /* Model görselleri. Yol: yapılandırılmış komut → güncel kapsam
       çözümleyicisi → kanonik varlık işlemi. Ne DOM tıklaması ne de ayrı bir
       indirme yolu vardır; Araçlar menüsünün çağırdığı AYNI işlem çalışır. */
    function modelImages(command){
      var assets=d.modelAssets||app().BLModelAssets;
      var scopeApi=d.modelAssetScope||app().BLModelAssetScope;
      if(!assets||typeof assets.updateModelImages!=='function')return {ok:false,reason:'model-images-unavailable'};
      var mode=clean(command.mode).toLowerCase();
      if(IMAGE_MODES.indexOf(mode)<0)mode='missing';
      var source=clean(command.source).toLowerCase();
      // Kaynak BELİRSİZSE seçilmez: ASAS ile PLM birbirinin yerine geçmez.
      if(IMAGE_SOURCES.indexOf(source)<0){
        if(typeof assets.openCurrentViewImageAction==='function'){
          assets.openCurrentViewImageAction(null);
          return {ok:true,mode:mode,source:'',pending:'source-choice'};
        }
        return {ok:false,reason:'source-required'};
      }
      var scope=scopeApi&&typeof scopeApi.currentScope==='function'?scopeApi.currentScope():null;
      if(!scope||!scope.identities.length)return {ok:false,reason:'empty-scope'};
      if(mode==='selected'&&!scope.selectedIdentities.length)return {ok:false,reason:'no-selection'};
      assets.updateModelImages({source:source,mode:mode,scope:scope});
      return {ok:true,mode:mode,source:source,
        scope:scope.contextType,
        identities:(mode==='selected'?scope.selectedIdentities:scope.identities).length};
    }

    /* Komutlar SIRAYLA uygulanır ve her birinin sonucu ayrı raporlanır:
       "uyguladım" demeden önce gerçekten uygulandığını bilmek gerekir (§26).
       Bir komut başarısız olursa kalanlar yine denenir — kısmi başarı
       sessizce tam başarı gibi görünmemeli. */
    function run(commands){
      var list=Array.isArray(commands)?commands.slice(0,10):[];
      var results=[];
      for(var i=0;i<list.length;i++){
        var command=list[i]||{};
        var name=clean(command.command);
        if(COMMANDS.indexOf(name)<0){results.push({command:name,ok:false,reason:'unsupported'});continue;}
        var outcome;
        try{
          outcome=name==='navigate'?navigate(command)
            :name==='filter'?filter(command)
              :name==='modelImages'?modelImages(command)
                :clearFilters(command);
        }catch(error){outcome={ok:false,reason:'threw',message:error&&error.message};}
        results.push(Object.assign({command:name,module:command.module},outcome));
      }
      return results;
    }

    return {run:run,navigate:navigate,filter:filter,clearFilters:clearFilters,modelImages:modelImages};
  }

  /* Kullanıcıya ne olduğunu tek satırda söyler. Teknik ayrıntı değil, sonuç. */
  function describe(results,tr){
    var applied=(results||[]).filter(function(item){return item&&item.ok;});
    var failed=(results||[]).filter(function(item){return item&&!item.ok;});
    var parts=[];
    applied.forEach(function(item){
      if(item.command==='navigate')parts.push(tr?item.module+' ekranı açıldı':'opened '+item.module);
      else if(item.command==='filter'){
        var names=(item.columns&&item.columns.length?item.columns:[item.column]).join(', ');
        parts.push(tr?names+' filtresi uygulandı':'filtered by '+names);
      }
      else if(item.command==='clearFilters')parts.push(tr?'filtreler temizlendi':'filters cleared');
      else if(item.command==='modelImages'){
        if(item.pending==='source-choice')parts.push(tr?'görsel kaynağı soruldu (ASAS/PLM)':'asked for the image source (ASAS/PLM)');
        else parts.push(tr
          ?item.source.toUpperCase()+' görselleri · '+item.identities+' model'
          :item.source.toUpperCase()+' images · '+item.identities+' model(s)');
      }
    });
    if(failed.length)parts.push(tr?failed.length+' işlem uygulanamadı':failed.length+' action(s) failed');
    return parts.join(' · ');
  }

  return {COMMANDS:COMMANDS,createRunner:createRunner,resolveColumnKey:resolveColumnKey,describe:describe};
});
