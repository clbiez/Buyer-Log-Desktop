'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLLayoutControlEngine = api;
})(typeof window !== 'undefined' ? window : null, function () {
  const STATUS = Object.freeze({ MATCH:'MATCH', MISMATCH:'MISMATCH', REVIEW:'REVIEW', NOT_CHECKED:'NOT_CHECKED' });
  const DOC = Object.freeze({ CARE_LABEL:'CARE_LABEL', PRICE_TAG:'PRICE_TAG', UNKNOWN:'UNKNOWN' });

  const MATERIAL_ALIASES = Object.freeze({
    COTTON:['PAMUK','COTTON','COTON','BAUMWOLLE','ALGODON','ALGODÃO','COTONE','PAMUT','PAMBIQ','PAMBUK','ХЛОПОК','БАВОВНА','ПАМУК','ΜΠΑΜΒΑΚΙ','PAXTA','KAPAS'],
    ELASTANE:['ELASTAN','ELASTANE','ELASTHAN','SPANDEX','LYCRA','ELASTANO','ELASTAAN'],
    POLYESTER:['POLYESTER','POLIESTER','POLYESTERE','POLYESTERİ','POLIESTERE'],
    VISCOSE:['VISCOSE','VİSKON','VISKON','VISCOSA','VISKOSE'],
    POLYAMIDE:['POLYAMIDE','POLYAMID','POLIAMID','POLIAMIDE','NYLON'],
    WOOL:['WOOL','YÜN','YUN','LAINE','WOLLE','LANA'],
    ACRYLIC:['ACRYLIC','AKRİLİK','AKRILIK','ACRYL','ACRILICO'],
    LINEN:['LINEN','KETEN','LIN','LEINEN','LINO']
  });
  const COUNTRY_ALIASES = Object.freeze({
    INDIA:['INDIA','HINDISTAN','HİNDİSTAN','HINDISTON','INDE','INDIEN','INDI','İNDİA','ИНДИЯ','ІНДІЯ','ΙΝΔΙΑ'],
    TURKEY:['TURKEY','TÜRKİYE','TURKIYE','TURKEYE','TÜRKIYE'],
    BANGLADESH:['BANGLADESH','BANGLADEŞ','BANGLADES'],
    CHINA:['CHINA','ÇİN','CIN'],
    PAKISTAN:['PAKISTAN','PAKİSTAN'],
    EGYPT:['EGYPT','MISIR'],
    MOROCCO:['MOROCCO','FAS','MAROC']
  });
  const FIELD_ALIASES = Object.freeze({
    size:['Beden','BEDEN','Size','SIZE','Beden/Size','Beden Tanım','Beden Tanimi'],
    barcode:['Barkod','BARKOD','Barcode','BARCODE','EAN','GTIN'],
    qr:['QR','QR Code','QR Kod','QRCode'],
    price:['Fiyat','FİYAT','Price','PRICE','Retail Price','Satış Fiyatı','Satis Fiyati'],
    care:['Yıkama Talimatı','Yikama Talimati','Care Instruction','Care Instructions','Washing Instruction','Washing Instructions'],
    warning:['Uyarı','Uyari','Warning','Warnings']
  });

  function clean(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
  function fold(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g,'I').replace(/İ/g,'I').toUpperCase();
  }
  function key(value) { return fold(value).replace(/[^A-Z0-9%]+/g, ' ').replace(/\s+/g,' ').trim(); }
  function uniq(values) {
    const out=[], seen=new Set();
    (Array.isArray(values)?values:[]).forEach(value => {
      const text=clean(value); if(!text) return;
      const k=key(text); if(!k || seen.has(k)) return;
      seen.add(k); out.push(text);
    });
    return out;
  }
  function list(value) {
    if (Array.isArray(value)) return uniq(value);
    if (value == null || value === '') return [];
    return uniq([value]);
  }
  function boundaryContains(haystack, needle) {
    const h=' '+key(haystack)+' ', n=key(needle);
    if(!n) return false;
    return h.includes(' '+n+' ');
  }
  function compactIdentifier(value) { return key(value).replace(/\s+/g,''); }
  function numericText(value) { return clean(value).replace(/\s+/g,'').replace(',','.'); }

  function materialOf(value) {
    const f=fold(value);
    for (const [canonical, aliases] of Object.entries(MATERIAL_ALIASES)) {
      if (aliases.some(alias => f === fold(alias))) return canonical;
    }
    return key(value);
  }
  function materialRegexSource() {
    const all=[];
    Object.values(MATERIAL_ALIASES).forEach(items => items.forEach(item => all.push(item)));
    return all.sort((a,b)=>b.length-a.length).map(item => fold(item).replace(/[.*+?^$()|[\]{}\\]/g,'\\$&')).join('|');
  }
  const MATERIAL_RX_SOURCE = materialRegexSource();

  function parseComposition(value) {
    const values=Array.isArray(value)?value:[value];
    const found=[];
    values.forEach(input => {
      const text=fold(input).replace(/,/g,'.');
      if(!text) return;
      const patterns=[
        new RegExp('(\\d+(?:\\.\\d+)?)\\s*%\\s*('+MATERIAL_RX_SOURCE+')','g'),
        new RegExp('%\\s*(\\d+(?:\\.\\d+)?)\\s*('+MATERIAL_RX_SOURCE+')','g'),
        new RegExp('('+MATERIAL_RX_SOURCE+')\\s*%?\\s*(\\d+(?:\\.\\d+)?)\\s*%','g')
      ];
      patterns.forEach((rx,index) => {
        let match;
        while((match=rx.exec(text))) {
          const material=index===2?match[1]:match[2];
          const amount=Number(index===2?match[2]:match[1]);
          if(!Number.isFinite(amount) || amount<0 || amount>100) continue;
          found.push({material:materialOf(material),percent:amount});
        }
      });
    });
    const by=new Map();
    found.forEach(item => {
      const id=item.material+':'+item.percent;
      if(!by.has(id)) by.set(id,item);
    });
    return [...by.values()].sort((a,b)=>a.material.localeCompare(b.material)||a.percent-b.percent);
  }
  function compositionKey(value) {
    const parsed=parseComposition(value);
    return parsed.map(item=>item.material+':'+String(item.percent)).join('|');
  }
  function normalizeCountry(value) {
    const f=fold(value);
    for(const [canonical,aliases] of Object.entries(COUNTRY_ALIASES)) {
      if(aliases.some(alias => f.includes(fold(alias)))) return canonical;
    }
    return key(value);
  }
  function extractCountries(value) {
    const text=fold(Array.isArray(value)?value.join(' '):value), out=[];
    for(const [canonical,aliases] of Object.entries(COUNTRY_ALIASES)) {
      if(aliases.some(alias => text.includes(fold(alias)))) out.push(canonical);
    }
    return uniq(out);
  }
  function normalizeSize(value) {
    return fold(value).replace(/YEARS?|YAS|YAŞ/g,'Y').replace(/\s+/g,'').replace(/[–—]/g,'-');
  }
  function normalizeBarcode(value) { return clean(value).replace(/[^0-9A-Za-z]/g,'').toUpperCase(); }
  function normalizePrice(value) {
    const source=clean(value).replace(/\s/g,'');
    const currency=/₺|TRY|TL/i.test(source)?'TRY':(/\$|USD/i.test(source)?'USD':(/€|EUR/i.test(source)?'EUR':''));
    const raw=source.replace(/[^0-9,.-]/g,'');
    if(!raw) return '';
    let n=raw;
    if(raw.includes(',') && raw.includes('.')) {
      if(raw.lastIndexOf(',')>raw.lastIndexOf('.')) n=raw.replace(/\./g,'').replace(',','.');
      else n=raw.replace(/,/g,'');
    } else if(raw.includes(',')) n=raw.replace(',','.');
    const number=Number(n);
    if(!Number.isFinite(number)) return '';
    return (currency?currency+':':'')+number.toFixed(2);
  }
  function valuesForAliases(rows, aliases) {
    const out=[];
    (Array.isArray(rows)?rows:[]).forEach(row => {
      if(!row || typeof row!=='object') return;
      for(const [name,value] of Object.entries(row)) {
        if(!aliases.some(alias=>key(alias)===key(name))) continue;
        if(Array.isArray(value)) value.forEach(v=>out.push(v));
        else out.push(value);
      }
    });
    return uniq(out);
  }
  function classifyDocument(text) {
    const f=fold(text);
    let care=0, price=0;
    ['ANA KUMAS','MAIN FABRIC','WASH','YIKAY','KEEP AWAY FROM FIRE','ATES TEN UZAK','MADE IN'].forEach(term=>{if(f.includes(fold(term))) care++;});
    ['BEDEN','SIZE','PESIN FIYAT','TAKSITLI FIYAT','FIYAT OLUSTURMA','BARCODE','SIP NO'].forEach(term=>{if(f.includes(fold(term))) price++;});
    if(care>=2 && care>price) return DOC.CARE_LABEL;
    if(price>=2 && price>care) return DOC.PRICE_TAG;
    return DOC.UNKNOWN;
  }
  function scanKnown(text, candidates, exactToken) {
    const out=[];
    const source=clean(text);
    uniq(candidates).forEach(candidate => {
      const hit=exactToken?boundaryContains(source,candidate):key(source).includes(key(candidate));
      if(hit) out.push(candidate);
    });
    return uniq(out);
  }
  function cpCatalog(rows, field) { return uniq((Array.isArray(rows)?rows:[]).map(row=>row&&row[field]).filter(v=>v!=null&&v!=='')); }

  function deriveLocalExtraction(text, cpRows) {
    const raw=clean(text), rows=Array.isArray(cpRows)?cpRows:[];
    const modelCodes=scanKnown(raw,cpCatalog(rows,'Model Name'),false);
    const colourCodes=scanKnown(raw,cpCatalog(rows,'C.Code'),true);
    const colours=scanKnown(raw,cpCatalog(rows,'Colour'),false);
    const orderNumbers=scanKnown(raw,cpCatalog(rows,'Order Code').map(String),true);
    return {
      documentType: classifyDocument(raw),
      modelCodes,
      colourCodes,
      colours,
      orderNumbers,
      countries: extractCountries(raw),
      composition: parseComposition(raw).map(item=>String(item.percent)+'% '+item.material),
      careInstructions: [],
      warnings: /KEEP\s+AWAY\s+FROM\s+FIRE|ATES.*UZAK/i.test(fold(raw))?['KEEP AWAY FROM FIRE']:[],
      sizes: [],
      barcodes: [],
      qrCodes: [],
      pageVariants: [],
      productClass:'',
      fit:'',
      prices:[],
      visualFindings:[],
      confidence: raw ? (modelCodes.length?'EXACT':'HIGH') : 'LOW',
      explanation: raw ? 'PDF native text layer analysed locally.' : 'No native PDF text was available.',
      _nativeText: raw
    };
  }

  const ARRAY_FIELDS=['modelCodes','colourCodes','colours','orderNumbers','countries','composition','careInstructions','warnings','sizes','barcodes','qrCodes','pageVariants','prices','visualFindings'];
  function mergeExtraction(localData, aiData) {
    const local=localData&&typeof localData==='object'?localData:{};
    const ai=aiData&&typeof aiData==='object'?aiData:{};
    const out={_sources:{}};
    out.documentType=local.documentType&&local.documentType!==DOC.UNKNOWN?local.documentType:(clean(ai.documentType)||DOC.UNKNOWN);
    out._sources.documentType=local.documentType&&local.documentType!==DOC.UNKNOWN?'local':'ai';
    ARRAY_FIELDS.forEach(field => {
      const a=list(local[field]), b=list(ai[field]);
      out[field]=a.length?a:uniq(a.concat(b));
      if(!a.length) out[field]=b;
      out._sources[field]=a.length?'local':'ai';
    });
    ['productClass','fit'].forEach(field=>{
      out[field]=clean(local[field])||clean(ai[field]);
      out._sources[field]=clean(local[field])?'local':'ai';
    });
    out.confidence=clean(local.confidence)==='EXACT'?'EXACT':(clean(ai.confidence)||clean(local.confidence)||'LOW').toUpperCase();
    out.explanation=clean(ai.explanation)||clean(local.explanation);
    out._nativeText=clean(local._nativeText);
    return out;
  }

  function exactMatchRows(cpRows, extraction) {
    const rows=Array.isArray(cpRows)?cpRows:[];
    const models=list(extraction&&extraction.modelCodes).map(compactIdentifier).filter(Boolean);
    if(!models.length) return [];
    let matched=rows.filter(row=>models.includes(compactIdentifier(row&&row['Model Name'])));
    const colours=list(extraction&&extraction.colourCodes).map(compactIdentifier).filter(Boolean);
    if(colours.length) {
      const narrowed=matched.filter(row=>colours.includes(compactIdentifier(row&&row['C.Code'])));
      if(narrowed.length) matched=narrowed;
    }
    const orders=list(extraction&&extraction.orderNumbers).map(compactIdentifier).filter(Boolean);
    if(orders.length) {
      const narrowed=matched.filter(row=>orders.includes(compactIdentifier(row&&row['Order Code'])));
      if(narrowed.length) matched=narrowed;
    }
    return matched;
  }

  function statusForMismatch(extraction, field) {
    const source=extraction&&extraction._sources&&extraction._sources[field];
    const confidence=fold(extraction&&extraction.confidence);
    if(source==='local' || confidence==='EXACT' || confidence==='HIGH') return STATUS.MISMATCH;
    return STATUS.REVIEW;
  }
  function setEquals(actual, expected, normalizer) {
    const a=new Set(list(actual).map(normalizer).filter(Boolean)), e=new Set(list(expected).map(normalizer).filter(Boolean));
    if(!a.size || !e.size) return false;
    if(a.size!==e.size) return false;
    for(const item of a) if(!e.has(item)) return false;
    return true;
  }
  function intersects(actual, expected, normalizer) {
    const e=new Set(list(expected).map(normalizer).filter(Boolean));
    return list(actual).map(normalizer).filter(Boolean).some(item=>e.has(item));
  }
  function makeCheck(rule, category, status, expected, actual, detail, source) {
    return {rule,category,status,expected:list(expected),actual:list(actual),detail:clean(detail),source:source||'CP ↔ Layout'};
  }

  function compare(extraction, cpRows, options) {
    const ex=extraction&&typeof extraction==='object'?extraction:{};
    const rows=exactMatchRows(cpRows,ex);
    const checks=[];
    const add=(...args)=>checks.push(makeCheck(...args));
    const doc=clean(ex.documentType)||DOC.UNKNOWN, isCare=doc===DOC.CARE_LABEL, isPrice=doc===DOC.PRICE_TAG;
    const has=field=>list(ex[field]).length>0 || Boolean(clean(ex[field]));
    const skip=(rule,category,actual,detail)=>add(rule,category,STATUS.NOT_CHECKED,[],actual||[],detail||'Bu layout türünde uygulanmıyor.');

    const models=list(ex.modelCodes), cpModels=cpCatalog(rows,'Model Name');
    if(!models.length) add('MODEL_MATCH','IDENTITY',STATUS.REVIEW,[],[], 'Layout içinden güvenilir model kodu çıkarılamadı.');
    else if(!rows.length) add('MODEL_MATCH','IDENTITY',STATUS.REVIEW,[],models,'PDF modeli CP içinde kesin olarak eşleştirilemedi.');
    else add('MODEL_MATCH','IDENTITY',intersects(models,cpModels,compactIdentifier)?STATUS.MATCH:statusForMismatch(ex,'modelCodes'),cpModels,models,'');

    const compareField=(rule,category,field,expected,normalizer,missingDetail,missingActualStatus) => {
      const actual=list(ex[field]);
      if(!expected.length) return add(rule,category,STATUS.NOT_CHECKED,[],actual,missingDetail||'CP referansı bulunamadı.');
      if(!actual.length) return add(rule,category,missingActualStatus||STATUS.REVIEW,expected,[], missingActualStatus===STATUS.NOT_CHECKED?'Layout kapsamı gereği bu alan zorunlu kontrol edilmedi.':'Layout alanı güvenilir biçimde okunamadı.');
      add(rule,category,intersects(actual,expected,normalizer)?STATUS.MATCH:statusForMismatch(ex,field),expected,actual,'');
    };

    compareField('COLOR_CODE_MATCH','IDENTITY','colourCodes',cpCatalog(rows,'C.Code'),compactIdentifier,'CP renk kodu referansı yok.');
    compareField('COLOR_NAME_MATCH','IDENTITY','colours',cpCatalog(rows,'Colour'),key,'CP renk adı referansı yok.');

    if(isPrice || has('orderNumbers')) compareField('ORDER_MATCH','IDENTITY','orderNumbers',cpCatalog(rows,'Order Code').map(String),compactIdentifier,'CP sipariş referansı yok.');
    else skip('ORDER_MATCH','IDENTITY',[], 'Care Label için sipariş numarası zorunlu kontrol alanı değildir.');

    compareField('COUNTRY_MATCH','COUNTRY','countries',cpCatalog(rows,'Country'),normalizeCountry,'CP üretim ülkesi referansı yok.');

    const cpComposition=cpCatalog(rows,'Karışım');
    const actualComposition=list(ex.composition);
    if(!(isCare || actualComposition.length)) {
      skip('COMPOSITION_MATCH','COMPOSITION',actualComposition,'Price Tag için kompozisyon kontrolü uygulanmaz.');
    } else if(!cpComposition.length) add('COMPOSITION_MATCH','COMPOSITION',STATUS.NOT_CHECKED,[],actualComposition,'CP ana kumaş Karışım referansı yok.');
    else if(!actualComposition.length) add('COMPOSITION_MATCH','COMPOSITION',STATUS.REVIEW,cpComposition,[],'Layout kompozisyonu güvenilir biçimde okunamadı.');
    else {
      const expectedKey=compositionKey(cpComposition), actualKey=compositionKey(actualComposition);
      if(!expectedKey || !actualKey) add('COMPOSITION_MATCH','COMPOSITION',STATUS.REVIEW,cpComposition,actualComposition,'Kompozisyon oranları normalize edilemedi; manuel doğrulama gerekli.');
      else add('COMPOSITION_MATCH','COMPOSITION',expectedKey===actualKey?STATUS.MATCH:statusForMismatch(ex,'composition'),cpComposition,actualComposition,'');
    }

    const cpCare=valuesForAliases(rows,FIELD_ALIASES.care);
    if(isCare || has('careInstructions')) compareField('CARE_INSTRUCTION_MATCH','CARE','careInstructions',cpCare,key,'CP projeksiyonunda resmi yıkama talimatı alanı yok; AI yalnız semantik REVIEW yapabilir.',cpCare.length?STATUS.REVIEW:STATUS.NOT_CHECKED);
    else skip('CARE_INSTRUCTION_MATCH','CARE',[], 'Price Tag için yıkama talimatı kontrolü uygulanmaz.');

    const cpWarnings=valuesForAliases(rows,FIELD_ALIASES.warning);
    if(isCare || has('warnings')) compareField('WARNING_MATCH','CARE','warnings',cpWarnings,key,'CP projeksiyonunda resmi uyarı zorunluluğu alanı yok.',cpWarnings.length?STATUS.REVIEW:STATUS.NOT_CHECKED);
    else skip('WARNING_MATCH','CARE',[], 'Price Tag için care-label uyarı kontrolü uygulanmaz.');

    const cpSizes=valuesForAliases(rows,FIELD_ALIASES.size);
    if(isPrice || has('sizes')) {
      if(cpSizes.length) {
        const actual=list(ex.sizes);
        if(!actual.length) add('SIZE_RANGE_MATCH','SIZE',STATUS.REVIEW,cpSizes,[],'Layout bedenleri okunamadı.');
        else add('SIZE_RANGE_MATCH','SIZE',setEquals(actual,cpSizes,normalizeSize)?STATUS.MATCH:statusForMismatch(ex,'sizes'),cpSizes,actual,'');
      } else add('SIZE_RANGE_MATCH','SIZE',STATUS.NOT_CHECKED,[],list(ex.sizes),'CP projeksiyonunda beden aralığı referansı yok.');
    } else skip('SIZE_RANGE_MATCH','SIZE',[], 'Care Label için beden aralığı kontrolü uygulanmaz.');

    const cpBarcodes=valuesForAliases(rows,FIELD_ALIASES.barcode);
    if(isPrice || has('barcodes')) {
      compareField('BARCODE_MATCH','BARCODE','barcodes',cpBarcodes,normalizeBarcode,'CP projeksiyonunda barkod referansı yok.',STATUS.NOT_CHECKED);
      if(list(ex.barcodes).length) add('BARCODE_READABLE','BARCODE',STATUS.MATCH,[],list(ex.barcodes),'PDF sayfasındaki barkod BarcodeDetector ile doğrudan okunabildi.','PDF BarcodeDetector');
      else add('BARCODE_READABLE','BARCODE',STATUS.NOT_CHECKED,[],[],'Tarayıcı barkod dekoderi değer okuyamadı; bu durum tek başına hata sayılmaz.','PDF BarcodeDetector');
      if(cpBarcodes.length && cpSizes.length) add('BARCODE_SIZE_MATCH','BARCODE',STATUS.REVIEW,[],list(ex.pageVariants),'Barkod ↔ beden eşleşmesi için CP tarafında çiftli mapping yapısı bulunamadı.');
      else add('BARCODE_SIZE_MATCH','BARCODE',STATUS.NOT_CHECKED,[],list(ex.pageVariants),'CP tarafında barkod ↔ beden mapping referansı yok.');
    } else {
      skip('BARCODE_MATCH','BARCODE',[], 'Care Label için karton etiket barkod kontrolü uygulanmaz.');
      skip('BARCODE_READABLE','BARCODE',[], 'Care Label için karton etiket barkod kontrolü uygulanmaz.');
      skip('BARCODE_SIZE_MATCH','BARCODE',[], 'Care Label için barkod ↔ beden kontrolü uygulanmaz.');
    }

    const cpQr=valuesForAliases(rows,FIELD_ALIASES.qr);
    if(isPrice || has('qrCodes')) {
      if(cpQr.length) compareField('QR_MATCH','BARCODE','qrCodes',cpQr,normalizeBarcode,'CP QR referansı yok.',STATUS.NOT_CHECKED);
      else if(list(ex.qrCodes).length) add('QR_READABLE','BARCODE',STATUS.MATCH,[],list(ex.qrCodes),'QR kodu tarayıcı dekoderi ile doğrudan okunabildi.','PDF BarcodeDetector');
      else add('QR_READABLE','BARCODE',STATUS.NOT_CHECKED,[],[],'QR için doğrulanabilir CP referansı/decode değeri yok.');
    } else skip('QR_READABLE','BARCODE',[], 'Care Label için QR kontrolü uygulanmaz.');

    const cpPrices=valuesForAliases(rows,FIELD_ALIASES.price);
    if(isPrice || has('prices')) compareField('PRICE_MATCH','PRICE','prices',cpPrices,normalizePrice,'CP projeksiyonunda doğrulanabilir fiyat referansı yok.',STATUS.NOT_CHECKED);
    else skip('PRICE_MATCH','PRICE',[], 'Care Label için fiyat kontrolü uygulanmaz.');

    const cpProduct=uniq(cpCatalog(rows,'Category').concat(cpCatalog(rows,'Ürün Tanım')));
    if(isPrice || clean(ex.productClass)) {
      if(clean(ex.productClass) && cpProduct.length && cpProduct.some(v=>key(v)===key(ex.productClass))) add('PRODUCT_CLASS_MATCH','IDENTITY',STATUS.MATCH,cpProduct,[ex.productClass],'');
      else add('PRODUCT_CLASS_MATCH','IDENTITY',STATUS.NOT_CHECKED,cpProduct,clean(ex.productClass)?[ex.productClass]:[],'Karton etiketteki ürün sınıfının CP Category/Ürün Tanım ile aynı iş anlamına geldiği garanti edilmedi.');
      const cpFit=valuesForAliases(rows,['Fit','Kalıp','Kalip','Fit Tanım','Fit Tanimi']);
      compareField('FIT_MATCH','IDENTITY','fit',cpFit,key,'CP projeksiyonunda doğrulanabilir fit/kalıp referansı yok.',STATUS.NOT_CHECKED);
    } else {
      skip('PRODUCT_CLASS_MATCH','IDENTITY',[], 'Care Label için ürün sınıfı kontrolü uygulanmaz.');
      skip('FIT_MATCH','IDENTITY',[], 'Care Label için fit/kalıp kontrolü uygulanmaz.');
    }

    const findings=list(ex.visualFindings);
    findings.forEach((finding,index)=>add('AI_VISUAL_'+String(index+1),'VISUAL',STATUS.REVIEW,[],[finding],'LCW AI görsel/semantik bulgusu; deterministik ERROR üretmez.','LCW AI'));

    const opt=options&&typeof options==='object'?options:{};
    if(opt.aiUnavailable) add('AI_VISUAL_REVIEW','VISUAL',STATUS.REVIEW,[],[],'LCW AI görsel incelemesi tamamlanamadı; deterministik kontroller korunmuştur.','LCW AI');
    if(doc===DOC.UNKNOWN) add('DOCUMENT_TYPE','IDENTITY',STATUS.REVIEW,[DOC.CARE_LABEL,DOC.PRICE_TAG],[DOC.UNKNOWN],'Layout türü kesin belirlenemedi.');

    return {referenceRows:rows,checks,summary:summarize(checks),documentType:doc,extraction:ex};
  }
  function summarize(checks) {
    const summary={passed:0,review:0,errors:0,notChecked:0,status:'APPROVED'};
    (Array.isArray(checks)?checks:[]).forEach(check=>{
      if(check.status===STATUS.MATCH) summary.passed++;
      else if(check.status===STATUS.MISMATCH) summary.errors++;
      else if(check.status===STATUS.REVIEW) summary.review++;
      else if(check.status===STATUS.NOT_CHECKED) summary.notChecked++;
    });
    summary.status=summary.errors?'ERROR':(summary.review?'REVIEW':'APPROVED');
    return summary;
  }

  return {
    STATUS,DOC,FIELD_ALIASES,clean,fold,key,uniq,list,normalizeCountry,normalizeSize,normalizeBarcode,normalizePrice,
    parseComposition,compositionKey,classifyDocument,deriveLocalExtraction,mergeExtraction,exactMatchRows,compare,summarize
  };
});
