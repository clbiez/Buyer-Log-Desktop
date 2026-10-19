(function(root,factory){
  'use strict';
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCanonicalFields=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  /*
   * Buyer Log Canonical Field Registry
   * ----------------------------------
   * Source/header names, module-internal row keys and visible labels are three
   * different contracts. Cross-module filters, joins, comparisons and enrichments
   * MUST resolve through this registry instead of comparing visible header text.
   *
   * Existing source/import keys are never renamed or mutated here. The registry
   * only describes how to read them and whether two bindings are semantically safe
   * to compare/join. This keeps PLM/ASAS imports, saved views and formulas backward
   * compatible while giving current/future modules one stable data vocabulary.
   */

  var VERSION='7.67';
  var TR_MAP={'ı':'I','İ':'I','ş':'S','Ş':'S','ğ':'G','Ğ':'G','ü':'U','Ü':'U','ö':'O','Ö':'O','ç':'C','Ç':'C'};
  // Saf fonksiyon: aynı kısa başlık/değerler satır başına tekrar tekrar
  // normalleştiriliyordu. Kısa metinler sınırlı bellekte tutulur.
  var TOKEN_CACHE=new Map();
  function token(value){
    var raw=String(value==null?'':value),cacheable=raw.length<=160;
    if(cacheable){var hit=TOKEN_CACHE.get(raw);if(hit!==undefined)return hit;}
    var out=raw
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g,function(ch){return TR_MAP[ch]||ch;})
      .toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
    if(cacheable){if(TOKEN_CACHE.size>=50000)TOKEN_CACHE.clear();TOKEN_CACHE.set(raw,out);}
    return out;
  }
  function textValue(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function codeValue(value){
    var raw=textValue(value);
    if(/^[-+]?\d+\.0+$/.test(raw))raw=raw.replace(/\.0+$/,'');
    return token(raw).replace(/\s+/g,'');
  }
  var COUNTRY={
    TURKEY:'TR',TURKIYE:'TR',TR:'TR',CHINA:'CN',CIN:'CN',CN:'CN',INDIA:'IN',HINDISTAN:'IN',IN:'IN',
    EGYPT:'EG',MISIR:'EG',EG:'EG',ROMANIA:'RO',ROMANYA:'RO',RO:'RO',UKRAINE:'UA',UKRAYNA:'UA',UA:'UA',
    GEORGIA:'GE',GURCISTAN:'GE',GE:'GE',BANGLADESH:'BD',BANGLADES:'BD',BD:'BD',MOROCCO:'MA',FAS:'MA',MA:'MA',
    MYANMAR:'MM',BURMA:'MM',MM:'MM',INDONESIA:'ID',ENDONEZYA:'ID',ID:'ID',PAKISTAN:'PK',PK:'PK',
    CAMBODIA:'KH',KAMBODYA:'KH',KH:'KH',VIETNAM:'VN','VIET NAM':'VN',VN:'VN','SRI LANKA':'LK',SRILANKA:'LK',LK:'LK',
    TUNISIA:'TN',TUNUS:'TN',TN:'TN',BULGARIA:'BG',BULGARISTAN:'BG',BG:'BG'
  };
  function dateValue(value){
    var raw=textValue(value),m;
    if((m=/^(\d{4})(\d{2})(\d{2})$/.exec(raw)))return m[1]+'-'+m[2]+'-'+m[3];
    if((m=/^(\d{4})-(\d{2})-(\d{2})/.exec(raw)))return m[1]+'-'+m[2]+'-'+m[3];
    if((m=/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/.exec(raw)))return m[3]+'-'+m[2]+'-'+m[1];
    return token(raw);
  }
  function normalizeByType(type,value){
    if(value==null||value==='')return '';
    if(type==='code')return codeValue(value);
    if(type==='country'){var k=token(value);return COUNTRY[k]||k.replace(/\s+/g,'');}
    if(type==='date')return dateValue(value);
    if(type==='number'){var n=Number(String(value).replace(',','.'));return Number.isFinite(n)?String(n):textValue(value);}
    return token(value);
  }

  function binding(keys,semantic){return {keys:Array.isArray(keys)?keys.slice():[keys],semantic:semantic||''};}
  var FIELDS={
    plmId:{label:{en:'PLM ID',tr:'PLM ID'},type:'code',role:'identity',aliases:['PLM ID','PLM Code','Plm Kod'],modules:{
      collection:binding(['plmId','PLM ID'],'plmId'),cp:binding(['PLM ID','Plm Kod','plmId'],'plmId'),orders:binding(['PLM ID','Plm Kod','plmId'],'plmId'),
      backlog:binding(['PLM ID','Plm Kod','plmId'],'plmId'),overview:binding(['PLM ID','Plm Kod','plmId'],'plmId'),lfl:binding(['plmId','PLM ID','Plm Kod'],'plmId'),
      logistics:binding(['plmId','PLM ID','Plm Kod'],'plmId'),antrepo:binding(['plmId','PLM ID','Plm Kod'],'plmId'),openCosting:binding(['plmId','PLM ID'],'plmId')
    }},
    orderCode:{label:{en:'Order Code',tr:'Sipariş Kodu'},type:'code',role:'identity',aliases:['Order Code','Sipariş Kod','Sipariş Kodu'],modules:{
      cp:binding(['Order Code','Sipariş Kod','orderCode'],'asasOrder'),orders:binding(['Order Code','Sipariş Kod','orderCode'],'asasOrder'),backlog:binding(['Order Code','Sipariş Kod','orderCode'],'asasOrder'),
      overview:binding(['Order Code','Sipariş Kod','orderCode'],'asasOrder'),lfl:binding(['orderCode','Order Code','Sipariş Kod'],'asasOrder'),logistics:binding(['orderCode','Order Code','Sipariş Kod'],'asasOrder'),antrepo:binding(['orderCode','Order Code','Sipariş Kod'],'asasOrder')
    }},
    modelName:{label:{en:'Model Name',tr:'Model Adı'},type:'text',role:'identity',aliases:['Model Name','Model Adı','Style Name','Product Name','Ürün Adı','Model'],modules:{
      collection:binding(['modelKod','Style Name'],'plmStyleName'),cp:binding(['Model Name','Model Adı','modelName'],'asasModelName'),orders:binding(['Model Name','Model Adı','modelName'],'asasModelName'),
      backlog:binding(['Model Name','Model Adı','modelName'],'asasModelName'),overview:binding(['Model Name','Model Adı','modelName'],'asasModelName'),lfl:binding(['modelName','Model Name','Model Adı'],'asasModelName'),
      logistics:binding(['modelName','Model Name','Ürün Adı'],'asasModelName'),antrepo:binding(['modelName','Model Name','Ürün Adı'],'asasModelName'),openCosting:binding(['modelCode','modelName'],'mixedModelName')
    }},
    productDescription:{label:{en:'Product Description',tr:'Ürün Tanımı'},type:'text',role:'dimension',aliases:['Product Description','Product Definition','Product Desc','Ürün Tanım','Ürün Tanımı'],modules:{
      collection:binding(['productDescription','_productDescription','Ürün Tanım'],'asasProductDescription'),cp:binding(['Ürün Ana Tanım','Ürün Tanım','Ürün Tanımı','Product Description','productDescription'],'asasProductDescription'),
      orders:binding(['Ürün Ana Tanım','Ürün Tanım','Ürün Tanımı','Product Description','productDescription'],'asasProductDescription'),backlog:binding(['Ürün Ana Tanım','Ürün Tanım','Ürün Tanımı','Product Description','productDescription'],'asasProductDescription'),
      overview:binding(['Ürün Ana Tanım','Ürün Tanım','Ürün Tanımı','Product Description','productDescription'],'asasProductDescription'),lfl:binding(['productDescription','Ürün Ana Tanım','Ürün Tanım','Product Description'],'asasProductDescription')
    }},
    productMainDefinition:{label:{en:'Product Main Definition',tr:'Ürün Ana Tanım'},type:'text',role:'attribute',aliases:['Product Main Definition','Ürün Ana Tanım'],modules:{
      collection:binding(['productMainDefinition','Product Main Definition'],'plmProductMainDefinition'),
      cp:binding(['Product Main Definition','productMainDefinition','Ürün Ana Tanım'],'asasProductMainDefinition')
    }},
    category:{label:{en:'Category',tr:'Kategori'},type:'text',role:'dimension',aliases:['Category','Classification','Klasman','Ürün Klasman','Product Classification','Kategori'],modules:{
      collection:binding(['urunTipi','Category'],'productClassification'),cp:binding(['Category','Ürün Klasman','classification'],'productClassification'),orders:binding(['Category','Ürün Klasman','classification'],'productClassification'),
      backlog:binding(['Category','Ürün Klasman','classification'],'productClassification'),overview:binding(['Category','Ürün Klasman','classification'],'productClassification'),lfl:binding(['classification','Category','Ürün Klasman'],'productClassification'),openCosting:binding(['category'],'productClassification')
    }},
    colourCode:{label:{en:'Colour Code',tr:'Renk Kodu'},type:'code',role:'identity',aliases:['C.Code','Colour Code','Color Code','Renk Kod','Renk Kodu'],modules:{
      collection:binding(['colourCode','C.Code','Colour Code'],'colourCode'),cp:binding(['C.Code','Colour Code','Color Code','Renk Kod','colourCode'],'colourCode'),orders:binding(['C.Code','Colour Code','Color Code','Renk Kod','colourCode'],'colourCode'),
      backlog:binding(['C.Code','Colour Code','Color Code','Renk Kod','colourCode'],'colourCode'),overview:binding(['C.Code','Colour Code','Color Code','Renk Kod','colourCode'],'colourCode'),lfl:binding(['colourCode','C.Code','Colour Code'],'colourCode'),
      logistics:binding(['colourCode','Renk Kod','Renk Kodu','C.Code'],'colourCode'),antrepo:binding(['colourCode','Renk Kod','Renk Kodu','C.Code'],'colourCode')
    }},
    colour:{label:{en:'Colour',tr:'Renk'},type:'text',role:'dimension',aliases:['Colour','Color','Renk','Renk Tanım'],modules:{
      collection:binding(['colour','Colour'],'colour'),cp:binding(['Colour','Color','Renk','colour'],'colour'),orders:binding(['Colour','Color','Renk','colour'],'colour'),backlog:binding(['Colour','Color','Renk','colour'],'colour'),overview:binding(['Colour','Color','Renk','colour'],'colour'),lfl:binding(['colour','Colour','Renk'],'colour'),logistics:binding(['colour','Renk Tanım','Renk'],'colour'),antrepo:binding(['colour','Renk Tanım','Renk'],'colour')
    }},
    specialCode:{label:{en:'Special Code',tr:'Özel Kod'},type:'code',role:'dimension',aliases:['Special Code','Special Code 1','Sp. Code','Özel Kod','Özel Kod 1'],modules:{
      collection:binding(['specialCode','Special Code'],'specialCode'),cp:binding(['Special Code','Özel Kod 1','specialCode'],'specialCode'),orders:binding(['Special Code','Özel Kod 1','specialCode'],'specialCode'),backlog:binding(['Special Code','Özel Kod 1','specialCode'],'specialCode'),overview:binding(['Special Code','Özel Kod 1','specialCode'],'specialCode')
    }},
    mag:{label:{en:'MAG',tr:'MAG'},type:'code',role:'dimension',aliases:['MAG','Merch Alt Grup','Merch Alt Grup Kod'],modules:{
      collection:binding(['mag','MAG'],'mag'),cp:binding(['MAG','Merch Alt Grup Kod','mag'],'mag'),orders:binding(['MAG','Merch Alt Grup Kod','mag'],'mag'),backlog:binding(['MAG','Merch Alt Grup Kod','mag'],'mag'),overview:binding(['MAG','Merch Alt Grup Kod','mag'],'mag'),lfl:binding(['mag','MAG'],'mag'),logistics:binding(['mag','MAG','Merch Alt Grup Kod'],'mag'),antrepo:binding(['mag','MAG','Merch Alt Grup Kod'],'mag')
    }},
    mmyg:{label:{en:'MMYG',tr:'MMYG'},type:'code',role:'dimension',aliases:['MMYG','Yaş Grup','Merch Marka Yaş Grup Kod'],modules:{
      collection:binding(['mmyg','MMYG'],'mmyg'),cp:binding(['MMYG','Merch Marka Yaş Grup Kod','mmyg'],'mmyg'),orders:binding(['MMYG','Merch Marka Yaş Grup Kod','mmyg'],'mmyg'),backlog:binding(['MMYG','Merch Marka Yaş Grup Kod','mmyg'],'mmyg'),overview:binding(['MMYG','Merch Marka Yaş Grup Kod','mmyg'],'mmyg'),lfl:binding(['mmyg','MMYG'],'mmyg'),logistics:binding(['mmyg','MMYG','Merch Marka Yaş Grup Kod'],'mmyg'),antrepo:binding(['mmyg','MMYG','Merch Marka Yaş Grup Kod'],'mmyg')
    }},
    buyingGroup:{label:{en:'Buying Group',tr:'Buying Group'},type:'text',role:'dimension',aliases:['Buying Group','Buyer Group','Buyer Grup','Buyer Grup (TR)'],modules:{
      collection:binding(['buyingGroup','Buying Group'],'buyingGroup'),cp:binding(['Buying Group','Buyer Group','Buyer Grup (TR)','buyingGroup'],'buyingGroup'),orders:binding(['Buying Group','Buyer Group','Buyer Grup (TR)','buyingGroup'],'buyingGroup'),backlog:binding(['Buying Group','Buyer Group','Buyer Grup (TR)','buyingGroup'],'buyingGroup'),overview:binding(['Buying Group','Buyer Group','Buyer Grup (TR)','buyingGroup'],'buyingGroup'),lfl:binding(['buyingGroup','Buying Group'],'buyingGroup')
    }},
    buyer:{label:{en:'Buyer',tr:'Buyer'},type:'text',role:'dimension',aliases:['Buyer','Satın Almacı'],modules:{
      collection:binding(['buyer','Buyer'],'buyer'),cp:binding(['Buyer','buyer'],'buyer'),orders:binding(['Buyer','buyer'],'buyer'),backlog:binding(['Buyer','buyer'],'buyer'),overview:binding(['Buyer','buyer'],'buyer'),lfl:binding(['buyer','Buyer'],'buyer')
    }},
    season:{label:{en:'Season',tr:'Sezon'},type:'code',role:'dimension',aliases:['Season','Sezon'],modules:{
      collection:binding(['season','Season'],'season'),cp:binding(['Season','Sezon','season'],'season'),orders:binding(['Season','Sezon','season'],'season'),backlog:binding(['Season','Sezon','season'],'season'),overview:binding(['Season','Sezon','season'],'season'),lfl:binding(['season','Season','Sezon'],'season'),logistics:binding(['season','Season','Sezon'],'season'),antrepo:binding(['season','Season','Sezon'],'season'),openCosting:binding(['season'],'season')
    }},
    collectionName:{label:{en:'Collection',tr:'Koleksiyon'},type:'text',role:'dimension',aliases:['Collection','Koleksiyon'],modules:{
      collection:binding(['collection','Collection'],'collection'),cp:binding(['Collection','collection'],'collection'),orders:binding(['Collection','collection'],'collection'),backlog:binding(['Collection','collection'],'collection'),overview:binding(['Collection','collection'],'collection'),lfl:binding(['collection','Collection'],'collection')
    }},
    country:{label:{en:'Country',tr:'Ülke'},type:'country',role:'dimension',aliases:['Country','Country of Origin','Ülke','Siparişin Üretildiği Ülke'],modules:{
      collection:binding(['country','Country'],'productionCountry'),cp:binding(['Country','Siparişin Üretildiği Ülke','country'],'productionCountry'),orders:binding(['Country','Siparişin Üretildiği Ülke','country'],'productionCountry'),backlog:binding(['Country','Siparişin Üretildiği Ülke','country'],'productionCountry'),overview:binding(['Country','Siparişin Üretildiği Ülke','country'],'productionCountry'),lfl:binding(['country','Country'],'productionCountry'),openCosting:binding(['country'],'productionCountry')
    }},
    orderStatus:{label:{en:'Status',tr:'Durum'},type:'text',role:'dimension',aliases:['Order Status','Status','Durum'],modules:{
      collection:binding(['durum','status'],'collectionWorkflowStatus'),cp:binding(['STATUS','Status','status'],'asasOrderStatus'),orders:binding(['STATUS','Status','status'],'asasOrderStatus'),backlog:binding(['STATUS','Status','status'],'asasOrderStatus'),overview:binding(['STATUS','Status','status'],'asasOrderStatus'),lfl:binding(['status','STATUS'],'asasOrderStatus')
    }},
    license:{label:{en:'License',tr:'Lisans'},type:'text',role:'dimension',aliases:['License','Lisans'],modules:{
      collection:binding(['lisans','License'],'license'),cp:binding(['License','Lisans','license'],'license'),orders:binding(['License','Lisans','license'],'license'),backlog:binding(['License','Lisans','license'],'license'),overview:binding(['License','Lisans','license'],'license'),lfl:binding(['license','License','Lisans'],'license'),openCosting:binding(['license'],'license')
    }},
    licensor:{label:{en:'Licensor',tr:'Lisansör'},type:'text',role:'dimension',aliases:['Licensor','License Owner','Lisansör','Lisans Veren'],modules:{
      collection:binding(['licensor','Licensor'],'licensor'),cp:binding(['Licensor','licensor'],'licensor'),orders:binding(['Licensor','licensor'],'licensor'),backlog:binding(['Licensor','licensor'],'licensor'),overview:binding(['Licensor','licensor'],'licensor'),lfl:binding(['licensor','Licensor'],'licensor')
    }},
    manufacturer:{label:{en:'Manufacturer',tr:'Üretici'},type:'text',role:'dimension',aliases:['Manufacturer','Üretici','Supplier'],modules:{
      collection:binding(['confirmedManufacturer','manufacturer'],'confirmedManufacturer'),cp:binding(['Manufacturer','Üretici','manufacturer'],'manufacturer'),orders:binding(['Manufacturer','Üretici','manufacturer'],'manufacturer'),backlog:binding(['Manufacturer','Üretici','manufacturer'],'manufacturer'),overview:binding(['Manufacturer','Üretici','manufacturer'],'manufacturer'),lfl:binding(['manufacturer','Manufacturer','Üretici'],'manufacturer'),openCosting:binding(['manufacturer'],'manufacturer')
    }},
    subManufacturer:{label:{en:'Sub-Manufacturer',tr:'Alt Üretici'},type:'text',role:'dimension',aliases:['Sub-Manufacturer','Sub Manufacturer','Alt Üretici','Sub Mfr'],modules:{
      cp:binding(['Sub-Manufacturer','Sub Manufacturer','Sub Mfr','subManufacturer'],'subManufacturer'),orders:binding(['Sub-Manufacturer','Sub Manufacturer','Sub Mfr','subManufacturer'],'subManufacturer'),backlog:binding(['Sub-Manufacturer','Sub Manufacturer','Sub Mfr','subManufacturer'],'subManufacturer'),overview:binding(['Sub-Manufacturer','Sub Manufacturer','Sub Mfr','subManufacturer'],'subManufacturer')
    }},
    buyingSampleManufacturer:{label:{en:'Buying Sample',tr:'Buying Numunesi'},type:'text',role:'attribute',aliases:['Buying Sample','Buying Numunesi'],modules:{collection:binding(['buyingSampleManufacturer'],'buyingSampleManufacturer')}},
    productGroup:{label:{en:'Product Group',tr:'Ürün Grubu'},type:'text',role:'dimension',aliases:['Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],modules:{
      collection:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup'),cp:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup'),orders:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup'),backlog:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup'),overview:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup'),lfl:binding(['productGroup','Product Group','Product Group Name','Ürün Grubu','Ürün Grup'],'productGroup')
    }},
    line:{label:{en:'Line',tr:'Line'},type:'text',role:'dimension',aliases:['Line','Product Line'],modules:{
      collection:binding(['line','Line'],'plmLine'),cp:binding(['Line','Product Line','line'],'asasLine'),orders:binding(['Line','Product Line','line'],'asasLine'),backlog:binding(['Line','Product Line','line'],'asasLine'),overview:binding(['Line','Product Line','line'],'asasLine'),lfl:binding(['line','Line'],'asasLine')
    }},
    brandDirectorate:{label:{en:'Brand Directorates',tr:'Marka Müdürlükleri'},type:'text',role:'dimension',aliases:['Brand Directorate','Brand Directorates','Marka Müdürlükleri','Marka Müdürlüğü'],modules:{
      cp:binding(['Marka Müdürlükleri','Brand Directorates','brandDirectorate'],'brandDirectorate'),orders:binding(['Marka Müdürlükleri','Brand Directorates','brandDirectorate'],'brandDirectorate'),backlog:binding(['Marka Müdürlükleri','Brand Directorates','brandDirectorate'],'brandDirectorate'),overview:binding(['Marka Müdürlükleri','Brand Directorates','brandDirectorate'],'brandDirectorate'),lfl:binding(['brandDirectorate','Marka Müdürlükleri'],'brandDirectorate'),logistics:binding(['brandDirectorate','Marka Müdürlükleri'],'brandDirectorate'),antrepo:binding(['brandDirectorate','Marka Müdürlükleri'],'brandDirectorate')
    }},
    currency:{label:{en:'Currency',tr:'Para Birimi'},type:'code',role:'dimension',aliases:['Currency','Para Birimi'],modules:{lfl:binding(['currency','Para Birimi'],'currency')}},
    orderQuantity:{label:{en:'Order Quantity',tr:'Sipariş Adedi'},type:'number',role:'measure',aliases:['Order Quantity','Net Alım Sipariş Miktarı'],modules:{cp:binding(['Order Quantity','Net Alım Sipariş Miktarı','quantity'],'orderQuantity'),orders:binding(['Order Quantity','Net Alım Sipariş Miktarı','quantity'],'orderQuantity'),backlog:binding(['Order Quantity','Net Alım Sipariş Miktarı','quantity'],'orderQuantity'),overview:binding(['Order Quantity','Net Alım Sipariş Miktarı','quantity'],'orderQuantity'),lfl:binding(['quantity','Order Quantity'],'orderQuantity')}},
    shipmentQuantity:{label:{en:'Shipment Quantity',tr:'Yükleme Adedi'},type:'number',role:'measure',aliases:['Shipment Quantity','Yükleme Adedi','Sevk Adedi'],modules:{cp:binding(['Shipment Quantity','Yükleme Adedi','Sevk Adedi','shipmentQuantity'],'shipmentQuantity'),orders:binding(['Shipment Quantity','Yükleme Adedi','Sevk Adedi','shipmentQuantity'],'shipmentQuantity'),backlog:binding(['Shipment Quantity','Yükleme Adedi','Sevk Adedi','shipmentQuantity'],'shipmentQuantity'),overview:binding(['Shipment Quantity','Yükleme Adedi','Sevk Adedi','shipmentQuantity'],'shipmentQuantity')}},
    remainingUnits:{label:{en:'Remaining Units',tr:'Kalan Adet'},type:'number',role:'measure',aliases:['Remaining Units','Remaining Quantity','Kalan Adet','Kalan Miktar'],modules:{cp:binding(['Remaining Units','Remaining Quantity','Kalan Adet','Kalan Miktar','remainingUnits'],'remainingUnits'),orders:binding(['Remaining Units','Remaining Quantity','Kalan Adet','Kalan Miktar','remainingUnits'],'remainingUnits'),backlog:binding(['Remaining Units','Remaining Quantity','Kalan Adet','Kalan Miktar','remainingUnits'],'remainingUnits'),overview:binding(['Remaining Units','Remaining Quantity','Kalan Adet','Kalan Miktar','remainingUnits'],'remainingUnits')}},
    deliveryType:{label:{en:'Delivery Type',tr:'Yükleme Tipi'},type:'text',role:'attribute',aliases:['Del. Type','Delivery Type','YÜKLEME TİPİ','Yükleme Tipi'],modules:{cp:binding(['Del. Type','YÜKLEME TİPİ','Yükleme Tipi','deliveryType'],'deliveryType'),orders:binding(['Del. Type','YÜKLEME TİPİ','Yükleme Tipi','deliveryType'],'deliveryType'),backlog:binding(['Del. Type','YÜKLEME TİPİ','Yükleme Tipi','deliveryType'],'deliveryType'),overview:binding(['Del. Type','YÜKLEME TİPİ','Yükleme Tipi','deliveryType'],'deliveryType')}},
    collectionQuantity:{label:{en:'Quantity',tr:'Adet'},type:'number',role:'measure',aliases:['Collection Quantity'],modules:{collection:binding(['quantity'],'collectionQuantity')}},
    fob:{label:{en:'FOB',tr:'FOB'},type:'number',role:'measure',aliases:['FOB','FOB Price','FOB Fiyatı'],modules:{collection:binding(['fob'],'collectionCalculatedFob'),cp:binding(['FOB','FOB ($)','FOB Fiyatı','fob'],'asasFob'),orders:binding(['FOB','FOB ($)','FOB Fiyatı','fob'],'asasFob'),backlog:binding(['FOB','FOB ($)','FOB Fiyatı','fob'],'asasFob'),overview:binding(['FOB','FOB ($)','FOB Fiyatı','fob'],'asasFob'),lfl:binding(['fob','FOB'],'asasFob')}},
    supplierFob:{label:{en:'Supplier FOB',tr:'Tedarikçi FOB'},type:'number',role:'measure',aliases:['Supplier FOB','Supp. FOB'],modules:{cp:binding(['Supp. FOB','Supplier FOB','supplierFob'],'asasSupplierFob'),orders:binding(['Supp. FOB','Supplier FOB','supplierFob'],'asasSupplierFob'),backlog:binding(['Supp. FOB','Supplier FOB','supplierFob'],'asasSupplierFob'),overview:binding(['Supp. FOB','Supplier FOB','supplierFob'],'asasSupplierFob')}},
    inStore:{label:{en:'In-Store Date',tr:'In-Store Tarihi'},type:'date',role:'date',aliases:['In Store','In-Store','In-Store Date','Model Bütçe Tarih Yıl Ay Gün'],modules:{collection:binding(['inStore','inStoreMonth'],'collectionInStore'),cp:binding(['In-Store','In-Store (Model Budget)','Model Bütçe Tarih Yıl Ay Gün','inStore'],'asasInStore'),orders:binding(['In-Store','In-Store (Model Budget)','Model Bütçe Tarih Yıl Ay Gün','inStore'],'asasInStore'),backlog:binding(['In-Store','In-Store (Model Budget)','Model Bütçe Tarih Yıl Ay Gün','inStore'],'asasInStore'),overview:binding(['In-Store','In-Store (Model Budget)','Model Bütçe Tarih Yıl Ay Gün','inStore'],'asasInStore'),lfl:binding(['inStore','inStoreMonth','In-Store'],'asasInStore')}},
    exFactory:{label:{en:'Ex-Factory',tr:'Ex-Factory'},type:'date',role:'date',aliases:['Ex-Factory','Ex-factory','Orijinal Exfactory Merch Tarih'],modules:{collection:binding(['exFactory'],'collectionExFactory'),cp:binding(['Ex-factory','Orijinal Exfactory Merch Tarih','exFactory'],'asasExFactory'),orders:binding(['Ex-factory','Orijinal Exfactory Merch Tarih','exFactory'],'asasExFactory'),backlog:binding(['Ex-factory','Orijinal Exfactory Merch Tarih','exFactory'],'asasExFactory'),overview:binding(['Ex-factory','Orijinal Exfactory Merch Tarih','exFactory'],'asasExFactory')}},
    orderPlacementDate:{label:{en:'Order Placement Date',tr:'Sipariş Yerleştirme Tarihi'},type:'date',role:'date',aliases:['OPD','Order Placement Date','Sipariş Yerleştirme Tarihi'],modules:{cp:binding(['OPD','Order Placement Date','orderPlacementDate'],'asasOrderPlacementDate'),orders:binding(['OPD','Order Placement Date','orderPlacementDate'],'asasOrderPlacementDate'),backlog:binding(['OPD','Order Placement Date','orderPlacementDate'],'asasOrderPlacementDate'),overview:binding(['OPD','Order Placement Date','orderPlacementDate'],'asasOrderPlacementDate'),lfl:binding(['opd','OPD','Order Placement Date','orderPlacementDate'],'asasOrderPlacementDate')}},
    retailDate:{label:{en:'Retail Date',tr:'Retail Tarihi'},type:'date',role:'date',aliases:['Retail Date','Retail Depo Tarih Yıl Ay Gün'],modules:{collection:binding(['retail'],'collectionRetail'),cp:binding(['Retail Date','Retail Depo Tarih Yıl Ay Gün','retailDate'],'asasRetail'),orders:binding(['Retail Date','Retail Depo Tarih Yıl Ay Gün','retailDate'],'asasRetail'),backlog:binding(['Retail Date','Retail Depo Tarih Yıl Ay Gün','retailDate'],'asasRetail'),overview:binding(['Retail Date','Retail Depo Tarih Yıl Ay Gün','retailDate'],'asasRetail')}}
  };

  var JOIN_PROFILES={
    modelColour:{fields:['plmId','colourCode'],note:'Preferred cross-module model/colour identity.'},
    orderModelColour:{fields:['orderCode','modelName','colourCode'],note:'ASAS/IAS order identity; Collection modelName is intentionally incompatible.'},
    portfolio:{fields:['mag','mmyg','category','season'],note:'Portfolio dimensions verified across Collection/ASAS/LFL.'}
  };

  var moduleIndex=Object.create(null),aliasIndex=Object.create(null);
  function rebuildIndexes(){
    moduleIndex=Object.create(null);aliasIndex=Object.create(null);
    Object.keys(FIELDS).forEach(function(id){
      var def=FIELDS[id];
      [id,def.label&&def.label.en,def.label&&def.label.tr].concat(def.aliases||[]).filter(Boolean).forEach(function(name){
        var k=token(name);if(!aliasIndex[k])aliasIndex[k]=[];if(aliasIndex[k].indexOf(id)<0)aliasIndex[k].push(id);
      });
      Object.keys(def.modules||{}).forEach(function(moduleId){
        if(!moduleIndex[moduleId])moduleIndex[moduleId]=Object.create(null);
        var b=def.modules[moduleId];(b.keys||[]).forEach(function(key){moduleIndex[moduleId][token(key)]=id;});
      });
    });
  }
  rebuildIndexes();

  function field(id){return FIELDS[id]||null;}
  function label(id,language){var def=field(id);if(!def)return String(id||'');var lang=language==='en'?'en':'tr';return def.label&&def.label[lang]||def.label&&def.label.en||id;}
  function canonicalId(moduleId,fieldRef){
    var ref=token(fieldRef);if(!ref)return null;
    var mod=moduleIndex[String(moduleId||'')];if(mod&&mod[ref])return mod[ref];
    var hits=aliasIndex[ref]||[];return hits.length===1?hits[0]:null;
  }
  function bindingFor(moduleId,id){var def=field(id);return def&&def.modules&&def.modules[String(moduleId||'')]||null;}
  function rowLookup(row,key){
    if(!row||typeof row!=='object')return undefined;
    if(Object.prototype.hasOwnProperty.call(row,key))return row[key];
    var wanted=token(key),keys=Object.keys(row);for(var i=0;i<keys.length;i++)if(token(keys[i])===wanted)return row[keys[i]];
    return undefined;
  }
  function value(row,moduleId,idOrRef){
    var id=field(idOrRef)?idOrRef:canonicalId(moduleId,idOrRef);if(!id)return undefined;
    var b=bindingFor(moduleId,id);if(!b)return undefined;
    for(var i=0;i<b.keys.length;i++){var v=rowLookup(row,b.keys[i]);if(v!==undefined&&v!==null&&v!=='')return v;}
    return undefined;
  }
  function normalizedValue(row,moduleId,idOrRef){var id=field(idOrRef)?idOrRef:canonicalId(moduleId,idOrRef),v=value(row,moduleId,id);return id?normalizeByType(field(id).type,v):'';}
  function project(row,moduleId,fieldIds){
    var ids=Array.isArray(fieldIds)&&fieldIds.length?fieldIds:Object.keys(FIELDS),out={};
    ids.forEach(function(id){if(!field(id))return;var v=value(row,moduleId,id);if(v!==undefined)out[id]=v;});return out;
  }
  function sameSemantic(moduleA,id,moduleB){
    var a=bindingFor(moduleA,id),b=bindingFor(moduleB,id);return !!(a&&b&&a.semantic&&a.semantic===b.semantic);
  }
  function canJoin(moduleA,fieldA,moduleB,fieldB){
    var a=field(fieldA)?fieldA:canonicalId(moduleA,fieldA),b=field(fieldB)?fieldB:canonicalId(moduleB,fieldB);
    if(!a||!b||a!==b)return false;
    var def=field(a);if(!def||def.role==='measure'||def.role==='date')return false;
    return sameSemantic(moduleA,a,moduleB);
  }
  function compatibility(moduleA,fieldA,moduleB,fieldB){
    var a=field(fieldA)?fieldA:canonicalId(moduleA,fieldA),b=field(fieldB)?fieldB:canonicalId(moduleB,fieldB);
    if(!a||!b)return {ok:false,reason:'unregistered-field',left:a,right:b};
    if(a!==b)return {ok:false,reason:'different-canonical-field',left:a,right:b};
    var ba=bindingFor(moduleA,a),bb=bindingFor(moduleB,b);
    if(!ba||!bb)return {ok:false,reason:'module-binding-missing',field:a};
    if(field(a).role==='measure'||field(a).role==='date')return {ok:false,reason:'not-a-join-dimension',field:a};
    if(ba.semantic!==bb.semantic)return {ok:false,reason:'different-semantics',field:a,leftSemantic:ba.semantic,rightSemantic:bb.semantic};
    return {ok:true,field:a,semantic:ba.semantic};
  }
  function requireJoinFields(moduleA,moduleB,fieldIds){
    var ids=Array.isArray(fieldIds)?fieldIds:[];if(!ids.length)throw new Error('Canonical join requires at least one registered field.');
    ids.forEach(function(id){var c=compatibility(moduleA,id,moduleB,id);if(!c.ok)throw new Error('Unsafe canonical join field '+id+' ('+moduleA+' ↔ '+moduleB+'): '+c.reason);});
    return ids;
  }
  function keyFor(row,moduleId,fieldIds){
    var ids=Array.isArray(fieldIds)?fieldIds:[],parts=ids.map(function(id){return normalizedValue(row,moduleId,id);});
    return parts.some(Boolean)?parts.join('\u241f'):'';
  }
  function joinRows(leftRows,leftModule,rightRows,rightModule,options){
    var opts=options||{},fields=opts.fields||JOIN_PROFILES[opts.profile]&&JOIN_PROFILES[opts.profile].fields||[];
    requireJoinFields(leftModule,rightModule,fields);
    var index=new Map();(Array.isArray(rightRows)?rightRows:[]).forEach(function(row){var k=keyFor(row,rightModule,fields);if(!k)return;if(!index.has(k))index.set(k,[]);index.get(k).push(row);});
    var out=[];(Array.isArray(leftRows)?leftRows:[]).forEach(function(row){var k=keyFor(row,leftModule,fields),hits=k&&index.get(k)||[];if(hits.length)hits.forEach(function(hit){out.push({key:k,left:row,right:hit});});else if(opts.type!=='inner')out.push({key:k,left:row,right:null});});return out;
  }
  function enrichRow(row,moduleId,sourceRows,sourceModule,options){
    var opts=options||{},matchFields=opts.matchFields||JOIN_PROFILES[opts.profile]&&JOIN_PROFILES[opts.profile].fields||[],copyFields=opts.fields||[];
    requireJoinFields(moduleId,sourceModule,matchFields);
    var matches=joinRows([row],moduleId,sourceRows,sourceModule,{fields:matchFields,type:'inner'}),out=Object.assign({},row),canonical={};
    if(matches.length){copyFields.forEach(function(id){var v=value(matches[0].right,sourceModule,id);if(v!==undefined)canonical[id]=v;});}
    Object.defineProperty(out,'__canonical',{value:canonical,enumerable:false,configurable:true});return out;
  }
  function canonicalValue(row,moduleId,id){
    if(row&&row.__canonical&&Object.prototype.hasOwnProperty.call(row.__canonical,id))return row.__canonical[id];
    return value(row,moduleId,id);
  }
  function registerModule(moduleId,bindings){
    var id=String(moduleId||'').trim();if(!id)throw new Error('moduleId is required');
    Object.keys(bindings||{}).forEach(function(fieldId){
      if(!FIELDS[fieldId])throw new Error('Unknown canonical field: '+fieldId);
      var raw=bindings[fieldId]||{},keys=raw.keys||raw.key||[];if(!Array.isArray(keys))keys=[keys];
      if(!keys.filter(Boolean).length)throw new Error('At least one key is required for '+id+'.'+fieldId);
      FIELDS[fieldId].modules[id]=binding(keys.filter(Boolean),raw.semantic||fieldId);
    });rebuildIndexes();return true;
  }
  function registerField(id,definition){
    id=String(id||'').trim();if(!id)throw new Error('field id is required');if(FIELDS[id])throw new Error('Canonical field already exists: '+id);
    var def=definition||{};FIELDS[id]={label:def.label||{en:id,tr:id},type:def.type||'text',role:def.role||'attribute',aliases:(def.aliases||[]).slice(),modules:def.modules||{}};rebuildIndexes();return FIELDS[id];
  }
  function moduleFields(moduleId){return Object.keys(FIELDS).filter(function(id){return !!bindingFor(moduleId,id);});}
  function profile(name){var p=JOIN_PROFILES[name];return p?{fields:p.fields.slice(),note:p.note}:null;}

  return Object.freeze({
    version:VERSION,fields:FIELDS,joinProfiles:JOIN_PROFILES,token:token,label:label,field:field,canonicalId:canonicalId,bindingFor:bindingFor,
    value:value,canonicalValue:canonicalValue,normalizedValue:normalizedValue,project:project,canJoin:canJoin,compatibility:compatibility,
    requireJoinFields:requireJoinFields,keyFor:keyFor,joinRows:joinRows,enrichRow:enrichRow,registerModule:registerModule,registerField:registerField,moduleFields:moduleFields,profile:profile
  });
});
