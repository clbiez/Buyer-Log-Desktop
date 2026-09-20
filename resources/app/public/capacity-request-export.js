(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCapacityRequest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  /* ===================================================================
     CAPACITY REQUEST EXCEL — ORTAK ALAN COZUMLEME MOTORU

     Koleksiyon ve CP ayni is kuralini paylasir; kural yalniz BURADA yazilir.
     Iki modul arasindaki tek fark, satirin hangi canonical modul baglamasi
     ile okunacagi ('collection' / 'cp') ve adet alaninin hangi canonical
     olcu oldugudur. Ham baslik eslestirmesi yapilmaz: her alan
     BLCanonicalFields uzerinden okunur.

     Granularity sozlesmesi: 1 secili satir = 1 export satiri. Bu modul
     hicbir kosulda PLM/model/siparis bazinda gruplama veya tekillestirme
     yapmaz; ayni PLM altindaki farkli renkler ayri satir olarak kalir.
     =================================================================== */

  const HEADERS=Object.freeze([
    'Supplier Name',
    'Season',
    'PLM Code',
    'Style',
    'Color',
    'units',
    'Garment Qty',
    'Merch Brand Age Group',
    'Merch Alt Group',
    'Buyer group',
    'Capacity Request sending Date',
    'PO Issuing Date',
    'garment ex-factory date: (shipment date)',
    'Fabric Country Origin',
    'Fabric Mill Name',
    "Supplier's delivery confirmation mail",
    'Retail Stock Date',
    'FOB PRICE',
    'PO Issue to Ex-Factory',
    'Ex-Factory to Retail Stock Date'
  ]);

  const COLUMN_WIDTHS=Object.freeze([26,10,14,28,18,12,13,22,18,16,26,16,30,20,22,30,18,12,20,26]);

  /* Sablonun her zaman bos birakilacagi sutunlar. Buyer Log'da karsiligi
     olabilecek alanlardan TURETILMEZ: tedarikci bunlari kendisi doldurur. */
  const ALWAYS_BLANK=Object.freeze(['fabricCountryOrigin','fabricMillName','supplierConfirmationMail']);

  const DATE_KEYS=Object.freeze(['capacityRequestSendingDate','poIssuingDate','exFactoryDate','retailStockDate']);
  const NUMBER_KEYS=Object.freeze(['units','garmentQty','fobPrice','poIssueToExFactory','exFactoryToRetail']);

  const MODULES=Object.freeze({
    collection:{moduleId:'collection',quantityField:'collectionQuantity'},
    cp:{moduleId:'cp',quantityField:'orderQuantity'}
  });

  function fields(){
    const api=(root&&root.BLCanonicalFields)||(typeof globalThis!=='undefined'&&globalThis.BLCanonicalFields)||null;
    if(api&&typeof api.value==='function')return api;
    if(typeof require==='function'){try{return require('./canonical-fields.js');}catch(_){}}
    throw new Error('BLCanonicalFields yuklenmedi; Capacity Request alanlari cozulemez.');
  }

  function excelDates(){
    const api=(root&&root.BLExcelDates)||(typeof globalThis!=='undefined'&&globalThis.BLExcelDates)||null;
    if(api)return api;
    if(typeof require==='function'){try{return require('./excel-date-utils.js');}catch(_){}}
    return null;
  }

  function text(value){
    if(value==null)return '';
    if(value instanceof Date)return '';
    const out=String(value).replace(/\s+/g,' ').trim();
    return /^(undefined|null|NaN|\[object Object\])$/i.test(out)?'':out;
  }

  /* Adet/fiyat metinleri Excel/ASAS'tan binlik ayiraci veya virgullu ondalik
     ile gelebilir. "1.234,50" ve "1,234.50" ikisi de ayni sayidir. */
  /* "1.234" / "1,234" gibi tek ayiracli degerler binlik gruplamadir:
     ayiractan sonra tam 3 hane vardir ve tamsayi kismi bostan uzundur.
     "8,5" ve "8.5" bu testi gecemez, ondalik kalir. */
  function isThousandGroup(body,separator){
    const parts=body.split(separator);
    if(parts.length<2)return false;
    const head=parts[0].replace(/^-/,'');
    if(!head.length||head.length>3)return false;
    return parts.slice(1).every(function(part){return part.length===3;});
  }

  function toNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const raw=text(value);
    if(!raw)return null;
    let body=raw.replace(/[^0-9.,\-]/g,'');
    if(!body||!/[0-9]/.test(body))return null;
    const lastComma=body.lastIndexOf(','),lastDot=body.lastIndexOf('.');
    if(lastComma>=0&&lastDot>=0){
      if(lastComma>lastDot)body=body.replace(/\./g,'').replace(',','.');
      else body=body.replace(/,/g,'');
    }else if(lastComma>=0){
      /* Tek ayirac: 3 haneli gruplama mi ondalik mi? "1,234" binliktir,
         "8,5" ondaliktir. Ayni belirsizlik nokta icin de gecerlidir. */
      body=isThousandGroup(body,',')?body.replace(/,/g,''):body.replace(',','.');
    }else if(lastDot>=0&&isThousandGroup(body,'.')){
      body=body.replace(/\./g,'');
    }
    const n=Number(body);
    return Number.isFinite(n)?n:null;
  }

  /* Yerel gun; saat bileseni tasinmaz. */
  function toDate(value){
    if(value instanceof Date)return isNaN(value.getTime())?null:new Date(value.getFullYear(),value.getMonth(),value.getDate());
    const raw=text(value);
    if(!raw)return null;
    const dates=excelDates();
    if(dates&&typeof dates.parseDate==='function'){
      const parsed=dates.parseDate(raw);
      if(parsed instanceof Date&&!isNaN(parsed.getTime()))return new Date(parsed.getFullYear(),parsed.getMonth(),parsed.getDate());
    }
    let m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
    if(m)return validParts(+m[1],+m[2],+m[3]);
    m=/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(raw);
    if(m)return validParts(+m[3],+m[2],+m[1]);
    m=/^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if(m)return validParts(+m[1],+m[2],+m[3]);
    return null;
  }
  function validParts(y,mo,d){
    const date=new Date(y,mo-1,d);
    return date.getFullYear()===y&&date.getMonth()===mo-1&&date.getDate()===d?date:null;
  }
  function dayDiff(from,to){
    if(!(from instanceof Date)||!(to instanceof Date))return null;
    return Math.round((to.getTime()-from.getTime())/86400000);
  }
  function startOfDay(date){
    const d=(date instanceof Date&&!isNaN(date.getTime()))?date:new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate());
  }

  /* Turkce karakter ve buyuk/kucuk harf farkini eriten sozcuk listesi.
     "2'li Takim (T-shirt+Sort)" -> ["2","LI","TAKIM","T","SHIRT","SORT"] */
  const TR_MAP={'ı':'I','İ':'I','ş':'S','Ş':'S','ğ':'G','Ğ':'G','ü':'U','Ü':'U','ö':'O','Ö':'O','ç':'C','Ç':'C'};
  function words(value){
    return String(value==null?'':value)
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g,function(ch){return TR_MAP[ch]||ch;})
      .toLocaleUpperCase('en-US')
      .replace(/[^A-Z0-9]+/g,' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  /* Takim/Set tespiti TEK alandan yapilir: canonical `category`
     (Koleksiyon `urunTipi`, CP `Category` -- ikisi de ASAS urun klasmanidir).
     Model/style adindan substring cikarilmaz: "SET" bir stil adinda
     tesaduefen gecebilir, klasmanda gecmez. */
  const SET_WORDS=Object.freeze(['TAKIM','SET']);
  function isSetProduct(row,source){
    const cfg=MODULES[source];
    if(!cfg)return false;
    const category=fields().value(row,cfg.moduleId,'category');
    return words(category).some(function(word){return SET_WORDS.indexOf(word)>=0;});
  }
  function garmentMultiplier(row,source){return isSetProduct(row,source)?2:1;}

  /* Manufacturer + Sub Manufacturer birlesimi. Koleksiyon tarafinda alt
     uretici baglamasi yoktur; o durumda uretici tek basina yazilir. */
  function supplierName(manufacturer,subManufacturer){
    const a=text(manufacturer),b=text(subManufacturer);
    if(a&&b)return a+' / '+b;
    return a||b||'';
  }

  function rowIdentity(row,moduleId,index){
    const api=fields();
    const parts=['plmId','modelName','colour'].map(function(id){return text(api.value(row,moduleId,id));}).filter(Boolean);
    return parts.length?parts.join(' · '):'#'+(index+1);
  }

  /* Tek bir secili satiri export satirina cevirir. Eksik opsiyonel alanlar
     hata degildir; yalniz adet cozulemezse satir reddedilir. */
  function mapRow(row,source,options){
    const cfg=MODULES[source];
    if(!cfg)throw new Error('Bilinmeyen Capacity Request kaynagi: '+source);
    const api=fields(),moduleId=cfg.moduleId;
    const today=startOfDay(options&&options.today);
    const units=toNumber(api.value(row,moduleId,cfg.quantityField));
    const exFactoryDate=toDate(api.value(row,moduleId,'exFactory'));
    const retailStockDate=toDate(api.value(row,moduleId,'retailDate'));
    return {
      supplierName:supplierName(api.value(row,moduleId,'manufacturer'),api.value(row,moduleId,'subManufacturer')),
      season:text(api.value(row,moduleId,'season')),
      plmCode:text(api.value(row,moduleId,'plmId')),
      style:text(api.value(row,moduleId,'modelName')),
      color:text(api.value(row,moduleId,'colour')),
      units:units,
      garmentQty:units==null?null:units*garmentMultiplier(row,source),
      merchBrandAgeGroup:text(api.value(row,moduleId,'mmyg')),
      merchAltGroup:text(api.value(row,moduleId,'mag')),
      buyerGroup:text(api.value(row,moduleId,'buyingGroup')),
      capacityRequestSendingDate:today,
      poIssuingDate:today,
      exFactoryDate:exFactoryDate,
      fabricCountryOrigin:'',
      fabricMillName:'',
      supplierConfirmationMail:'',
      retailStockDate:retailStockDate,
      fobPrice:toNumber(api.value(row,moduleId,'fob')),
      poIssueToExFactory:dayDiff(today,exFactoryDate),
      exFactoryToRetail:dayDiff(exFactoryDate,retailStockDate)
    };
  }

  const ORDER=Object.freeze([
    'supplierName','season','plmCode','style','color','units','garmentQty',
    'merchBrandAgeGroup','merchAltGroup','buyerGroup',
    'capacityRequestSendingDate','poIssuingDate','exFactoryDate',
    'fabricCountryOrigin','fabricMillName','supplierConfirmationMail',
    'retailStockDate','fobPrice','poIssueToExFactory','exFactoryToRetail'
  ]);

  function toArray(mapped){
    return ORDER.map(function(key){
      const value=mapped[key];
      return value==null?'':value;
    });
  }

  /* Secili satir kumesini export modeline cevirir.

     Geri donen `rejected`, SESSIZ kayip degildir: cagiran yol bu listeyi
     kullaniciya gostermek zorundadir. Bir satirin reddedilmesi diger
     satirlarin export edilmesini engellemez. */
  function buildExport(rows,source,options){
    const list=Array.isArray(rows)?rows:[];
    const cfg=MODULES[source];
    if(!cfg)throw new Error('Bilinmeyen Capacity Request kaynagi: '+source);
    const today=startOfDay(options&&options.today);
    const mapped=[],rejected=[];
    list.forEach(function(row,index){
      if(!row||typeof row!=='object'){
        rejected.push({index:index,identity:'#'+(index+1),reason:'row'});
        return;
      }
      const item=mapRow(row,source,{today:today});
      if(item.units==null){
        rejected.push({index:index,identity:rowIdentity(row,cfg.moduleId,index),reason:'quantity'});
        return;
      }
      mapped.push(item);
    });
    if(mapped.length+rejected.length!==list.length){
      throw new Error('Capacity Request satir sayisi secimle eslesmiyor: '+(mapped.length+rejected.length)+' != '+list.length);
    }
    return {headers:HEADERS.slice(),rows:mapped,matrix:mapped.map(toArray),rejected:rejected,today:today,source:source};
  }

  /* buildExport modelini referans Jersey sayfa duzenine yazar.

     Sablon workbook'u bu kurulumda fiziksel olarak paketlenmedigi icin sayfa
     sozlesmeden uretilir: sabit sutun sirasi, sabit genislikler, donmus baslik
     satiri ve autofilter. Boylece sablona ait ornek is verisinin yanlislikla
     dosyada kalmasi imkansizdir -- sayfa her zaman sifirdan yazilir. */
  function buildWorkbook(result,ExcelJSCtor,dateFormat){
    if(!ExcelJSCtor||typeof ExcelJSCtor.Workbook!=='function')throw new Error('ExcelJS yuklenmedi.');
    const dates=excelDates();
    const format=dateFormat||(dates&&dates.DATE_FORMAT)||'dd.mm.yyyy';
    const wb=new ExcelJSCtor.Workbook();
    wb.creator='Buyer Log';wb.created=new Date();
    const ws=wb.addWorksheet('Jersey',{views:[{state:'frozen',ySplit:1}]});
    ws.columns=HEADERS.map(function(header,i){return {header:header,width:COLUMN_WIDTHS[i]||18};});
    ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,result.rows.length+1),column:HEADERS.length}};
    const head=ws.getRow(1);head.height=42;
    head.eachCell(function(cell){
      cell.font={bold:true,size:10};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDEBF7'}};
      cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
      cell.border={bottom:{style:'thin',color:{argb:'FFB7B7B7'}}};
    });
    result.rows.forEach(function(item,rowIndex){
      const row=ws.getRow(rowIndex+2);
      ORDER.forEach(function(key,colIndex){
        const value=item[key],cell=row.getCell(colIndex+1);
        cell.value=(value==null||value==='')?null:value;
        cell.alignment={vertical:'middle'};
        /* Tarih hucreleri ham JS Date olarak birakilamaz: ExcelJS bunlari UTC
           uzerinden serilestirir ve UTC+N saat diliminde gun bir geri kayar.
           Proje bu tuzagi excel-date-utils'teki serial yaziciyla cozer. */
        if(DATE_KEYS.indexOf(key)>=0&&value instanceof Date){
          cell.numFmt=format;
          if(!(dates&&dates.writeExcelJsSerial&&dates.writeExcelJsSerial(cell,value)))cell.numFmt=format;
        }
        else if(key==='fobPrice'&&typeof value==='number')cell.numFmt='#,##0.00';
        else if(typeof value==='number')cell.numFmt='#,##0';
      });
    });
    return wb;
  }

  function fileName(date){
    const d=startOfDay(date),p=function(n){return String(n).padStart(2,'0');};
    return 'Capacity Request - '+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'.xlsx';
  }

  return Object.freeze({
    HEADERS:HEADERS,COLUMN_WIDTHS:COLUMN_WIDTHS,ALWAYS_BLANK:ALWAYS_BLANK,
    DATE_KEYS:DATE_KEYS,NUMBER_KEYS:NUMBER_KEYS,ORDER:ORDER,SET_WORDS:SET_WORDS,
    SHEET_NAME:'Jersey',
    toNumber:toNumber,toDate:toDate,dayDiff:dayDiff,startOfDay:startOfDay,words:words,
    isSetProduct:isSetProduct,garmentMultiplier:garmentMultiplier,supplierName:supplierName,
    mapRow:mapRow,toArray:toArray,buildExport:buildExport,buildWorkbook:buildWorkbook,fileName:fileName
  });
});
