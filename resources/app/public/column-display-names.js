(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLColumnNames=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  /*
   * SÜTUN GÖRÜNEN ADLARI (EN/TR) + VERİ KAYNAĞI KATALOĞU
   * ----------------------------------------------------
   * CP / Orders / Koleksiyon tablolarında kullanıcı, sistemden gelen bir
   * sütunu kendi ekranında başka bir adla görebilir (ör. "Model Budget Month" →
   * "MB Month"). Bu katman YALNIZ GÖRÜNEN ETİKETİ değiştirir: veri anahtarı,
   * filtre, sıralama, override, formül referansı ve içe aktarma eşlemesi
   * olduğu gibi kalır.
   *
   *  · Kişiseldir: kullanıcı kapsamlı ve hesapla senkron "lcw.table.columnState."
   *    önekinde tutulur; başka kullanıcıların başlıkları değişmez.
   *  · İki dillidir: her ad EN ve TR olarak ayrı saklanır; boş bırakılan dil
   *    sistem varsayılanını gösterir.
   *  · Sonradan eklenen (özel/DB/not/hesaplanan) sütunların ortak tanımı
   *    labelEn/labelTr alanlarını taşır; `label` geriye dönük kimlik olarak kalır.
   */

  var STORAGE_KEY='lcw.table.columnState.labels.v1';
  var MAX_LABEL=80;
  var TABLES=['cp','orders','koleksiyon'];

  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim().slice(0,MAX_LABEL);}
  function normalizePair(raw){
    var src=raw&&typeof raw==='object'?raw:{};
    return {en:clean(src.en),tr:clean(src.tr)};
  }
  function isEmptyPair(pair){return !pair||(!pair.en&&!pair.tr);}
  function normalizeStore(raw){
    var out={};
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
    Object.keys(raw).forEach(function(table){
      if(TABLES.indexOf(table)<0)return;
      var bucket=raw[table];if(!bucket||typeof bucket!=='object'||Array.isArray(bucket))return;
      Object.keys(bucket).forEach(function(key){
        if(!key)return;
        var pair=normalizePair(bucket[key]);
        if(isEmptyPair(pair))return;
        (out[table]=out[table]||{})[key]=pair;
      });
    });
    return out;
  }

  // Tarayıcıda BLStorage (kullanıcı kapsamlı), testlerde enjekte edilen depo.
  function defaultStorage(){
    var g=typeof window!=='undefined'?window:globalThis;
    return g.BLStorage||null;
  }
  function createStore(storageArg){
    // Ham metin değişmedikçe yeniden ayrıştırılmaz; hesap eşitlemesi değeri
    // arka planda yazarsa bir sonraki okuma yeni metni görür.
    var cache=null,cacheRaw=null;
    function storage(){return storageArg||defaultStorage();}
    function read(){
      var raw=null;
      try{var s=storage();raw=s?s.getItem(STORAGE_KEY):null;}catch(_){raw=null;}
      if(cache&&raw===cacheRaw)return cache;
      var parsed=null;
      try{parsed=JSON.parse(raw||'null');}catch(_){parsed=null;}
      cache=normalizeStore(parsed);cacheRaw=raw;
      return cache;
    }
    function write(next){
      cache=normalizeStore(next);
      var raw=JSON.stringify(cache);
      try{var s=storage();if(s)s.setItem(STORAGE_KEY,raw);}catch(_){}
      cacheRaw=raw;
      return cache;
    }
    return {
      invalidate:function(){cache=null;cacheRaw=null;},
      all:function(){return JSON.parse(JSON.stringify(read()));},
      get:function(table,key){var bucket=read()[table];var pair=bucket&&bucket[key];return pair?{en:pair.en,tr:pair.tr}:null;},
      has:function(table,key){return !!this.get(table,key);},
      /* Varsayılanla aynı yazılan dil saklanmaz: sistem adı ileride değişirse
         kullanıcı eski metne kilitli kalmasın. */
      set:function(table,key,pair,defaults){
        if(TABLES.indexOf(table)<0||!key)return null;
        var next=read(),p=normalizePair(pair),d=normalizePair(defaults);
        if(p.en&&p.en===d.en)p.en='';
        if(p.tr&&p.tr===d.tr)p.tr='';
        var copy=JSON.parse(JSON.stringify(next));
        if(isEmptyPair(p)){if(copy[table])delete copy[table][key];}
        else (copy[table]=copy[table]||{})[key]=p;
        write(copy);
        return isEmptyPair(p)?null:p;
      },
      clear:function(table,key){
        var copy=JSON.parse(JSON.stringify(read()));
        if(copy[table])delete copy[table][key];
        write(copy);
      },
      resolve:function(table,key,lang,fallback){
        var pair=this.get(table,key);
        var value=pair?(lang==='en'?pair.en:pair.tr):'';
        return value||fallback;
      },
    };
  }

  /* ---- Sonradan eklenen sütun tanımları (ortak kayıt) ---- */
  function definitionLabels(def){
    var d=def||{},base=clean(d.label);
    return {en:clean(d.labelEn)||base,tr:clean(d.labelTr)||base};
  }
  function definitionLabel(def,lang){
    var pair=definitionLabels(def);
    return lang==='en'?pair.en:pair.tr;
  }
  /* `label` geriye dönük kimliktir (formül referansı, tekillik kontrolü);
     TR boşsa EN'e düşer. */
  function withDefinitionLabels(def,pair){
    var p=normalizePair(pair),out={};
    Object.keys(def||{}).forEach(function(k){out[k]=def[k];});
    out.label=p.tr||p.en||clean(out.label);
    out.labelTr=p.tr;out.labelEn=p.en;
    return out;
  }

  /* ---- Veri kaynağı kataloğu ----
     CP/Orders satırları sunucuda server/lib/parse.js parseASASMatrix →
     buildCpRows ile üretilir. Aşağıdaki alan adları oradaki ASAS başlıklarıdır;
     Veri Yönetimi eşlemesi bu başlığı fiziksel tablo/sütuna bağlar. */
  function asas(field,note){return {kind:'asas',field:field,note:note||null};}
  function ias(note){return {kind:'ias',note:note};}
  function computed(note){return {kind:'computed',note:note};}
  function buyerlog(note){return {kind:'buyerlog',note:note};}
  var CP_SOURCES={
    'Active/Inactive':computed({tr:'ASAS "Kalan Alım Sipariş Miktarı" > 0 ise Active',en:'Active when ASAS "Kalan Alım Sipariş Miktarı" > 0'}),
    '__picture':buyerlog({tr:'Buyer Log görsel kütüphanesi (PLM + renk kodu); yoksa ASAS "Teknik Görsel"',en:'Buyer Log image library (PLM + colour code); falls back to ASAS "Teknik Görsel"'}),
    'PLM Numune':computed({tr:'PLM numune talepleri (PLM ID + renk); her okumada yeniden hesaplanır, kaydedilmez',en:'PLM sample requests (PLM ID + colour); recomputed on every read, never stored'}),
    'Priority':buyerlog({tr:'Buyer Log içinde kullanıcı tarafından girilir',en:'Entered by users in Buyer Log'}),
    'Season':asas('Sezon'),
    'Country':asas('Siparişin Üretildiği Ülke',{tr:'İngilizce ülke adına çevrilir',en:'Converted to the English country name'}),
    'Merch Marka Yaş Grup Kod':asas('Merch Marka Yaş Grup Kod'),
    'Merch Alt Grup Kod':asas('Merch Alt Grup Kod'),
    'Buyer Grup (TR)':asas('Buyer Grup (TR)'),
    'Buyer':asas('Buyer'),
    'Line':asas('Line'),
    'Manufacturer':asas('Üretici'),
    'Sub-Manufacturer':buyerlog({tr:'Buyer Log alt üretici eşlemesi; Licensor DTR ise ASAS "Üretici"',en:'Buyer Log sub-manufacturer mapping; ASAS "Üretici" when Licensor is DTR'}),
    'Licensor':buyerlog({tr:'Fiyat kurallarındaki License → Licensor eşlemesi veya elle giriş',en:'License → Licensor mapping in pricing rules, or manual entry'}),
    'License':asas('Lisans'),
    'Category':asas('Ürün Klasman'),
    'Special Code':asas('Özel Kod 1'),
    'PLM ID':asas('Plm Kod'),
    'Model Name':asas('Model Adı'),
    'Ürün Tanım':asas('Ürün Ana Tanım',{tr:'Yoksa "Ürün Tanım" / "Ürün Tanımı"',en:'Falls back to "Ürün Tanım" / "Ürün Tanımı"'}),
    'C.Code':asas('Renk Kod'),
    'Colour':asas('Renk'),
    'Order Code':asas('Sipariş Kod'),
    'FOB ($)':asas('FOB Fiyatı'),
    'Supp. FOB':buyerlog({tr:'Fiyat kuralı (OPD + ülke grubu + Licensor + License) veya elle giriş',en:'Pricing rule (OPD + country group + Licensor + License) or manual entry'}),
    'Original Ex-factory':asas('Orijinal Exfactory Merch Tarih',{tr:'Buyer Log revizyonundan etkilenmez',en:'Not affected by a Buyer Log revision'}),
    'OPD':asas('Sipariş Yerleştirme MerchTarih'),
    'Ex-factory':asas('Orijinal Exfactory Merch Tarih',{tr:'Buyer Log revizyonu varsa o gösterilir',en:'A Buyer Log revision is shown when present'}),
    'LT':computed({tr:'OPD ile Ex-factory arasındaki gün farkı',en:'Days between OPD and Ex-factory'}),
    'HANDOVER Tarihi':ias({tr:'IAS / Antrepo parsiyelinin teslim tarihi',en:'Handover date of the IAS / bonded-warehouse partial'}),
    'Retail Date':asas('Retail Depo Tarih Yıl Ay Gün'),
    'Ex→Retail':computed({tr:'Ex-factory ile Retail Date arasındaki gün farkı',en:'Days between Ex-factory and Retail Date'}),
    'Buying Son Onay Tarihi':asas('Buying Son Onay Tarihi'),
    'In-Store (Model Budget)':asas('Model Bütçe Tarih Yıl Ay Gün'),
    'Order Quantity':asas('Net Alım Sipariş Miktarı'),
    'Shipment Quantity':ias({tr:'IAS parsiyellerinde yüklenen miktar toplamı',en:'Sum of loaded quantities in IAS partials'}),
    'Remaining Units':computed({tr:'Sipariş adedi − IAS yüklenen miktar',en:'Order quantity − IAS loaded quantity'}),
    '%':computed({tr:'(Sipariş adedi − Kalan) / Sipariş adedi',en:'(Order quantity − Remaining) / Order quantity'}),
    'Kumaş Kategorisi':asas('Kumaş Kategorisi',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'Kumaşçı Ülkesi':asas('Kumaşçı Ülkesi',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'Kumaşçı':asas('Kumaşçı',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'Kumaş Tipi':asas('Kumaş Tipi',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'İplik No':asas('İplik No',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'Gramaj':asas('Gramaj',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'Karışım':asas('Karışım',{tr:'Yalnız "Ana Kumaş Mı" = 1 satırından',en:'Only from the "Ana Kumaş Mı" = 1 row'}),
    'STATUS':ias({tr:'IAS / Antrepo parsiyel durumu; kayıt yoksa Üretimde / Pasif',en:'IAS / bonded-warehouse partial status; In Production / Inactive when missing'}),
    'Ant. Arrival':ias({tr:'IAS / Antrepo varış tarihi',en:'IAS / bonded-warehouse arrival date'}),
    'Del. Type':ias({tr:'IAS parsiyelinin teslim tipi; yoksa Buyer Log kuralı',en:'Delivery type of the IAS partial; otherwise the Buyer Log rule'}),
    'Notes':buyerlog({tr:'Buyer Log not alanı',en:'Buyer Log note field'}),
    'Ek Not':buyerlog({tr:'Buyer Log ek not alanı',en:'Buyer Log additional note field'}),
    'PLM Numune':buyerlog({tr:'PLM numune talepleri (PLM ID ile eşlenir)',en:'PLM sample requests (matched by PLM ID)'}),
  };

  // Koleksiyon verisi Buyer Log'un kendi Koleksiyon çalışma alanında tutulur.
  var COLLECTION_NOTES={
    exToRetail:computed({tr:'Ex-Factory ile Retail arasındaki gün farkı',en:'Days between Ex-Factory and Retail'}),
    royalty:computed({tr:'License / Licensor fiyat kuralından',en:'From the License / Licensor pricing rule'}),
    hologramCost:computed({tr:'Hologram fiyat kuralından',en:'From the hologram pricing rule'}),
    fob:computed({tr:'Fiyat formülünden hesaplanır',en:'Calculated by the pricing formula'}),
    endeksmatik:computed({tr:'Endeksmatik benchmark hesabı',en:'Endeksmatik benchmark calculation'}),
    ydLanded:computed({tr:'FOB × Overseas Landed çarpanı',en:'FOB × Overseas Landed multiplier'}),
    trLanded:computed({tr:'TR fiyatı, kur ve TR Landed çarpanından',en:'From TR price, FX and TR Landed multiplier'}),
  };

  function sourceFor(table,column){
    var c=column||{};
    if(c.modelCustom)return {kind:'database',table:c.sourceTable||'',field:c.sourceName||'',role:c.role||'',connection:c.connectionName||'',header:c.k};
    if(c.noteCustom)return buyerlog({tr:'Buyer Log not sütunu (ortak, kullanıcılar girer)',en:'Buyer Log note column (shared, entered by users)'});
    if(c.formulaCustom)return {kind:'formula',formula:(c.formulaDef&&c.formulaDef.formula)||''};
    if(table==='koleksiyon'){
      if(c.custom)return {kind:'collection',field:c.k,custom:true};
      var calc=COLLECTION_NOTES[c.k];
      if(calc)return {kind:'computed',note:calc.note,field:c.k};
      return {kind:'collection',field:c.k};
    }
    if(Object.prototype.hasOwnProperty.call(CP_SOURCES,c.k)){
      var entry=CP_SOURCES[c.k];
      return {kind:entry.kind,field:entry.field||'',note:entry.note};
    }
    return {kind:'unknown',field:c.k||''};
  }

  /* Veri Yönetimi eşlemesinden fiziksel tablo/sütun. Eşleme değeri eski düz
     metin ya da {table,name,kind} olabilir. */
  function physicalColumn(mapping,field){
    if(!mapping||!field)return null;
    var raw=mapping[field];
    if(raw==null||raw==='')return null;
    if(typeof raw==='string')return {table:'',name:raw,kind:'column'};
    if(typeof raw==='object'&&raw.name)return {table:String(raw.table||''),name:String(raw.name),kind:raw.kind==='measure'?'measure':'column'};
    return null;
  }
  function physicalText(physical){
    if(!physical)return '';
    if(physical.kind==='measure')return '['+physical.name+']';
    return (physical.table?"'"+physical.table+"'":'')+'['+physical.name+']';
  }

  var KIND_LABELS={
    asas:{tr:'ASAS (Data Model)',en:'ASAS (Data Model)'},
    ias:{tr:'IAS / Antrepo',en:'IAS / Bonded warehouse'},
    computed:{tr:'Buyer Log hesaplaması',en:'Buyer Log calculation'},
    buyerlog:{tr:'Buyer Log',en:'Buyer Log'},
    database:{tr:'Veri tabanı sütunu',en:'Database column'},
    formula:{tr:'Hesaplanan sütun (formül)',en:'Calculated column (formula)'},
    collection:{tr:'Koleksiyon veri tabanı',en:'Collection database'},
    unknown:{tr:'Tanımsız',en:'Unknown'},
  };

  /* Diyalogda gösterilen satırlar: [{label,value,code}] — code=true değerin
     monospace gösterileceğini söyler. */
  function describeSource(info,lang,options){
    var en=lang==='en',opts=options||{},rows=[];
    var t=function(tr,e){return en?e:tr;};
    var src=info||{kind:'unknown'};
    var kind=KIND_LABELS[src.kind]||KIND_LABELS.unknown;
    rows.push({label:t('Kaynak','Source'),value:en?kind.en:kind.tr});
    if(src.kind==='asas'){
      rows.push({label:t('ASAS alanı','ASAS field'),value:src.field,code:true});
      var physical=physicalColumn(opts.mapping,src.field);
      if(physical)rows.push({label:t('Veri tabanı sütunu','Database column'),value:physicalText(physical),code:true});
    }else if(src.kind==='database'){
      rows.push({label:t('Veri tabanı sütunu','Database column'),value:physicalText({table:src.table,name:src.field,kind:'column'}),code:true});
      if(src.connection||src.role)rows.push({label:t('Bağlantı','Connection'),value:(src.role==='antrepo'?'IAS · ':src.role?'ASAS · ':'')+(src.connection||'')});
    }else if(src.kind==='collection'){
      rows.push({label:t('Alan anahtarı','Field key'),value:src.field,code:true});
      if(src.custom)rows.push({label:t('Tür','Type'),value:t('Sonradan eklenen serbest metin sütunu','User-added free-text column')});
    }else if(src.kind==='formula'){
      if(src.formula)rows.push({label:t('Formül','Formula'),value:src.formula,code:true});
    }else if(src.kind==='unknown'&&src.field){
      rows.push({label:t('Alan anahtarı','Field key'),value:src.field,code:true});
    }
    if(src.kind==='computed'&&src.field)rows.push({label:t('Alan anahtarı','Field key'),value:src.field,code:true});
    if(src.note)rows.push({label:t('Not','Note'),value:en?src.note.en:src.note.tr});
    return rows;
  }
  function sourceSummary(info,lang,options){
    return describeSource(info,lang,options).map(function(row){return row.label+': '+row.value;}).join('\n');
  }

  var store=createStore(null);
  return {
    VERSION:'1',STORAGE_KEY:STORAGE_KEY,MAX_LABEL:MAX_LABEL,TABLES:TABLES.slice(),
    clean:clean,normalizePair:normalizePair,normalizeStore:normalizeStore,createStore:createStore,
    get:function(t,k){return store.get(t,k);},has:function(t,k){return store.has(t,k);},
    set:function(t,k,p,d){return store.set(t,k,p,d);},clear:function(t,k){return store.clear(t,k);},
    resolve:function(t,k,l,f){return store.resolve(t,k,l,f);},invalidate:function(){store.invalidate();},
    definitionLabels:definitionLabels,definitionLabel:definitionLabel,withDefinitionLabels:withDefinitionLabels,
    CP_SOURCES:CP_SOURCES,sourceFor:sourceFor,physicalColumn:physicalColumn,physicalText:physicalText,
    describeSource:describeSource,sourceSummary:sourceSummary,
  };
});
