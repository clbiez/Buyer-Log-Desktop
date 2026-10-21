'use strict';

(function (root, factory) {
  const canonical=typeof module==='object'&&module.exports?require('../server/lib/canonical-fields'):root&&root.BLCanonicalFields;
  const api = factory(canonical);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLLayoutControlEngine = api;
})(typeof window !== 'undefined' ? window : null, function (canonical) {
  const STATUS = Object.freeze({ MATCH:'MATCH', MISMATCH:'MISMATCH', REVIEW:'REVIEW', NOT_CHECKED:'NOT_CHECKED' });
  const DOC = Object.freeze({ CARE_LABEL:'CARE_LABEL', PRICE_TAG:'PRICE_TAG', UNKNOWN:'UNKNOWN' });
  const T=(tr,en)=>{try{const lang=typeof window!=='undefined'?String(window.appLang||document.documentElement.lang||'tr'):String(process&&process.env&&process.env.BUYER_LOG_LANG||'tr');return lang.toLowerCase().startsWith('en')?en:tr;}catch(_){return tr;}};

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
  function mainComposition(value){
    const text=fold(value),rx=/ANA\s*KUMAS|MAIN\s*FABRIC/g;let match;
    while((match=rx.exec(text))){
      const rest=text.slice(match.index+match[0].length),end=rest.search(/\b(?:ANA\s*KUMAS|MAIN\s*FABRIC|ASTAR|LINING|DOLGU|FILLING|AKSESUAR|ACCESSOR(?:Y|IES)|POCKET|CEP\s*KUMAS|MADE\s*IN)\b/);
      const parsed=parseComposition(end>=0?rest.slice(0,end):rest);if(parsed.length)return parsed;
    }
    return /\bASTAR|\bLINING|\bFILLING/.test(text)?[]:parseComposition(text);
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
  const ORIGIN_MARKERS = [
    'MADE IN','URETILMISTIR','URETILDI','FABRICAT IN','WYPRODUKOWANO W','ISTEHSAL EDILMISDIR',
    'FABRIQUE EN','DIBUAT DI','PRODHUAR NE','PROIZVEDENO U','FABRICADO EN','FABRICADO EM',
    'SZARMAZASI ORSZAG','ISHLAB CHIQARILGAN','HERGESTELLT IN','PRODOTTO IN',
    'СДЕЛАНО В','ВИРОБЛЕНО В','ПРОИЗВЕДЕНО','ΚΑΤΑΣΚΕΥΑΣΤΗΚΕ ΣΤΗΝ'
  ].map(fold);
  function extractOriginCountries(value) {
    const text=fold(Array.isArray(value)?value.join(' '):value), out=[];
    const segments=text.split(/\s*\/+\s*|\[\[PAGE\s+\d+\]\]/).map(item=>item.trim()).filter(Boolean);
    for(const [canonical,aliases] of Object.entries(COUNTRY_ALIASES)) {
      const accepted=segments.some(segment=>{
        if(!ORIGIN_MARKERS.some(marker=>segment.includes(marker))) return false;
        return aliases.some(alias=>segment.includes(fold(alias)));
      });
      if(accepted) out.push(canonical);
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
  const CP_FIELDS={'Model Name':'modelName','C.Code':'colourCode','Colour':'colour','Order Code':'orderCode','Special Code':'specialCode','Country':'country','Karışım':'fabricComposition','Season':'season','Merch Alt Grup Kod':'mag','Merch Marka Yaş Grup Kod':'mmyg','Line':'line','Ürün Tanım':'productDescription','Category':'category'};
  function cpValue(row,field){const id=CP_FIELDS[field]||field;return canonical&&canonical.field(id)?canonical.value(row,'cp',id):row&&row[field];}
  function cpCatalog(rows, field) { return uniq((Array.isArray(rows)?rows:[]).map(row=>cpValue(row,field)).filter(v=>v!=null&&v!=='')); }

  function printedFields(value){
    const raw=clean(value).replace(/\[\[PAGE\s+\d+\]\]/gi,' '),f=fold(raw);
    const captures=rx=>uniq([...raw.matchAll(rx)].map(m=>m[1]));
    const orderNumbers=uniq([...f.matchAll(/(?:SIP(?:ARIS)?[.\s]*(?:NO|NUMARASI|KODU)|ORD(?:ER)?[.\s]*(?:NO\.?|CODE))\s*[:#.\-]?\s*(\d{5,10})\b/g)].map(m=>m[1]));
    const modelCodes=captures(/(?:KK\s*[.,]\s*BDY\s*[.,]|(?:MODEL|STYLE)\s*(?:ADI|NAME|CODE)?\s*[:=])\s*([A-Z0-9]+(?:[\-][A-Z0-9]+)+)/gi);
    const specialCodes=uniq([...f.matchAll(/\b([A-Z0-9]{6}Z[148])\b/g),...f.matchAll(/\b([A-Z0-9]{6})\s*[-/]\s*KK[.,]\s*BDY/g)].map(m=>m[1]));
    const colourBlock=/\(([A-Z0-9]{3})\s*[-–]\s*([^)]{1,80})\)/i.exec(raw);
    const colourBand=/\b[A-Z0-9]{6}Z[148]\s*\/\s*([A-Z0-9]{3})\b/i.exec(raw);
    const price=(label)=>{const rx=new RegExp(label+'\\s*[:\\-]?\\s*((?:₺|TL|TRY|€|EUR|USD|\\$)?\\s*\\d+(?:[.,]\\d{3})*[.,]\\d{2}(?:\\s*(?:TL|TRY|EUR|USD|₺))?)','gi');return captures(rx);};
    const cashPrices=price('(?:Pe[şs][ıiİI]n\\s*(?:Sat[ıiİI][şs]\\s*)?F[ıiİI]yat(?:[ıi])?|Cash\\s*(?:Retail\\s*)?Price)'); // i18n-ignore — printed label parsing pattern, not UI text
    const instalmentPrices=price('(?:Taks[ıiİI]tl[ıiİI]\\s*F[ıiİI]yat(?:[ıi])?|Instalments?\\s*Price)'); // i18n-ignore — printed label parsing pattern, not UI text
    const origin=uniq(extractOriginCountries(raw).concat([...f.matchAll(/(?:URETIM\s*YERI|COUNTRY\s*OF\s*ORIGIN)\s*[:\-]?\s*([^/]{1,100})/g)].flatMap(m=>extractCountries(m[1]))));
    return {modelCodes,orderNumbers,specialCodes,cashPrices,instalmentPrices,countries:origin,colourCodes:colourBlock?[colourBlock[1]]:colourBand?[colourBand[1]]:[],colours:colourBlock?[colourBlock[2]]:[]};
  }

  function deriveLocalExtraction(text, cpRows) {
    const raw=clean(text), rows=Array.isArray(cpRows)?cpRows:[];
    const printed=printedFields(raw);
    const modelCodes=printed.modelCodes.length?printed.modelCodes:scanKnown(raw,cpCatalog(rows,'Model Name'),true);
    const colourCodes=printed.colourCodes.length?printed.colourCodes:scanKnown(raw,cpCatalog(rows,'C.Code'),true);
    const colours=printed.colours.length?printed.colours:scanKnown(raw,cpCatalog(rows,'Colour'),false);
    const orderNumbers=printed.orderNumbers.length?printed.orderNumbers:scanKnown(raw,cpCatalog(rows,'Order Code').map(String),true);
    const specialCodes=printed.specialCodes.length?printed.specialCodes:scanKnown(raw,cpCatalog(rows,'Special Code'),true);
    const seasonCodes=scanKnown(raw,cpCatalog(rows,'Season'),true);
    const magCodes=scanKnown(raw,cpCatalog(rows,'Merch Alt Grup Kod'),true);
    const mmygCodes=scanKnown(raw,cpCatalog(rows,'Merch Marka Yaş Grup Kod'),true);
    const lineCodes=scanKnown(raw,cpCatalog(rows,'Line'),false);
    const productMainDefinitions=scanKnown(raw,cpCatalog(rows,'Ürün Tanım'),false);
    return {
      documentType: classifyDocument(raw),
      modelCodes,
      colourCodes,
      colours,
      orderNumbers,
      specialCodes,
      seasonCodes,
      magCodes,
      mmygCodes,
      lineCodes,
      productMainDefinitions,
      countries: printed.countries,
      composition: mainComposition(raw).map(item=>String(item.percent)+'% '+item.material),
      careInstructions: [],
      warnings: /KEEP\s+AWAY\s+FROM\s+FIRE|ATES.*UZAK/i.test(fold(raw))?['KEEP AWAY FROM FIRE']:[],
      sizes: [],
      barcodes: [],
      qrCodes: [],
      pageVariants: [],
      productClass:'',
      fit:'',
      identityText:raw.replace(/\[\[PAGE\s+\d+\]\]/gi,' ').trim(),
      prices:printed.cashPrices,cashPrices:printed.cashPrices,instalmentPrices:printed.instalmentPrices,
      visualFindings:[],
      confidence: raw ? (modelCodes.length?'EXACT':'HIGH') : 'LOW',
      explanation: raw ? 'PDF native text layer analysed locally.' : 'No native PDF text was available.',
      _nativeText: raw
    };
  }

  const ARRAY_FIELDS=['modelCodes','colourCodes','colours','orderNumbers','specialCodes','seasonCodes','magCodes','mmygCodes','lineCodes','productMainDefinitions','countries','composition','careInstructions','warnings','sizes','barcodes','qrCodes','pageVariants','prices','cashPrices','instalmentPrices','visualFindings','standardFindings','languageCodes','languageTexts','companyAddresses','websites','fieldEvidence','jobNumbers'];
  function mergeExtraction(localData, aiData) {
    const local=localData&&typeof localData==='object'?localData:{};
    const ai=aiData&&typeof aiData==='object'?aiData:{};
    const out={_sources:{},_localValues:{}};
    out.documentType=local.documentType&&local.documentType!==DOC.UNKNOWN?local.documentType:(clean(ai.documentType)||DOC.UNKNOWN);
    out._sources.documentType=local.documentType&&local.documentType!==DOC.UNKNOWN?'local':'ai';
    ARRAY_FIELDS.forEach(field => {
      const a=list(local[field]), b=list(ai[field]);
      out[field]=uniq(a.concat(b));
      out._localValues[field]=a;
      out._sources[field]=a.length?'local':'ai';
    });
    ['productClass','fit','identityText'].forEach(field=>{
      out[field]=clean(local[field])||clean(ai[field]);
      out._sources[field]=clean(local[field])?'local':'ai';
    });
    out.identityText=[clean(local.identityText),clean(ai.identityText)].filter(Boolean).join('\n');
    out.modelCodes=list(out.modelCodes).map(v=>v.replace(/^KK\s*[.,]\s*BDY\s*[,\.\s]+/i,'').replace(/-?\([^)]*\)$/,''));
    out.fireWarning=clean(ai.fireWarning)||(/KEEP AWAY FROM FIRE|ATES.*UZAK/.test(fold(out._nativeText||local._nativeText))?'PRESENT':'UNKNOWN');
    out.confidence=clean(local.confidence)==='EXACT'?'EXACT':(clean(ai.confidence)||clean(local.confidence)||'LOW').toUpperCase();
    out.explanation=clean(ai.explanation)||clean(local.explanation);
    out._nativeText=clean(local._nativeText);
    return out;
  }

  function enrichExtractionFromCp(extraction, cpRows) {
    const ex=extraction&&typeof extraction==='object'?{...extraction}:{};
    ex._sources={...(ex._sources||{})};
    const nativeText=clean(ex._nativeText), aiText=clean(ex.identityText);
    const specs=[
      ['modelCodes','Model Name',false],
      ['orderNumbers','Order Code',true],
      ['specialCodes','Special Code',true],
      ['colourCodes','C.Code',true],
      ['colours','Colour',false],
      ['seasonCodes','Season',true],
      ['magCodes','Merch Alt Grup Kod',true],
      ['mmygCodes','Merch Marka Yaş Grup Kod',true],
      ['lineCodes','Line',false],
      ['productMainDefinitions','Ürün Tanım',false]
    ];
    specs.forEach(([field,cpField,exactToken])=>{
      if(list(ex[field]).length)return;
      const candidates=cpCatalog(cpRows,cpField);
      if(!candidates.length) return;
      const localHits=nativeText?scanKnown(nativeText,candidates,exactToken):[];
      const aiHits=aiText?scanKnown(aiText,candidates,exactToken):[];
      if(localHits.length){ex[field]=localHits;ex._sources[field]='local';}
      else if(aiHits.length){ex[field]=aiHits;ex._sources[field]='ai';}
    });
    return ex;
  }

  function exactMatchRows(cpRows, extraction) {
    const rows=Array.isArray(cpRows)?cpRows:[];
    const models=list(extraction&&extraction.modelCodes).map(compactIdentifier).filter(Boolean);
    const orders=list(extraction&&extraction.orderNumbers).map(compactIdentifier).filter(Boolean);
    const specials=list(extraction&&extraction.specialCodes).map(compactIdentifier).filter(Boolean);
    let matched=[];
    if(orders.length)return rows.filter(row=>orders.includes(compactIdentifier(cpValue(row,'orderCode'))));
    if(models.length) matched=rows.filter(row=>models.includes(compactIdentifier(cpValue(row,'modelName'))));
    if(!matched.length && specials.length) matched=rows.filter(row=>specials.includes(compactIdentifier(cpValue(row,'specialCode'))));
    if(!matched.length) return [];

    if(models.length) {
      const narrowed=matched.filter(row=>models.includes(compactIdentifier(cpValue(row,'modelName'))));
      if(narrowed.length) matched=narrowed;
    }
    const colours=list(extraction&&extraction.colourCodes).map(compactIdentifier).filter(Boolean);
    if(colours.length) {
      const narrowed=matched.filter(row=>colours.includes(compactIdentifier(cpValue(row,'colourCode'))));
      if(narrowed.length) matched=narrowed;
    }
    if(specials.length) {
      const narrowed=matched.filter(row=>specials.includes(compactIdentifier(cpValue(row,'specialCode'))));
      if(narrowed.length) matched=narrowed;
    }
    return matched;
  }

  function statusForMismatch(extraction, field, expected, normalizer, equivalent) {
    const source=extraction&&extraction._sources&&extraction._sources[field];
    if(expected&&normalizer&&extraction._localValues){
      const known=list(expected).map(normalizer).filter(Boolean);
      const conflict=equivalent?list(extraction._localValues[field]).some(v=>!list(expected).some(e=>equivalent(v,e))):list(extraction._localValues[field]).map(normalizer).filter(Boolean).some(v=>!known.includes(v));
      return conflict?STATUS.MISMATCH:STATUS.REVIEW;
    }
    // ERROR yalnız deterministik/yerel extraction + CP çatışmasından doğar.
    // LCW AI'dan okunan değer CP ile çelişse bile kullanıcı doğrulaması gerekir.
    return source==='local' ? STATUS.MISMATCH : STATUS.REVIEW;
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
    const ex=enrichExtractionFromCp(extraction,cpRows);
    const rows=exactMatchRows(cpRows,ex);
    const checks=[];
    const add=(...args)=>checks.push(makeCheck(...args));
    const doc=clean(ex.documentType)||DOC.UNKNOWN, isCare=doc===DOC.CARE_LABEL, isPrice=doc===DOC.PRICE_TAG;
    const has=field=>list(ex[field]).length>0 || Boolean(clean(ex[field]));
    const skip=(rule,category,actual,detail)=>add(rule,category,STATUS.NOT_CHECKED,[],actual||[],detail||T('Bu layout türünde uygulanmıyor.','Not applicable to this layout type.'));

    const models=list(ex.modelCodes), cpModels=cpCatalog(rows,'Model Name');
    if(!models.length) add('MODEL_MATCH','IDENTITY',STATUS.REVIEW,[],[], T('Layout içinden güvenilir model kodu çıkarılamadı.','A reliable model code could not be extracted from the layout.'));
    else if(!rows.length) add('MODEL_MATCH','IDENTITY',STATUS.REVIEW,[],models,T('PDF modeli CP içinde kesin olarak eşleştirilemedi.','The PDF model could not be matched to CP with certainty.'));
    else add('MODEL_MATCH','IDENTITY',intersects(models,cpModels,compactIdentifier)?STATUS.MATCH:statusForMismatch(ex,'modelCodes'),cpModels,models,'');

    const compareField=(rule,category,field,expected,normalizer,missingDetail,missingActualStatus) => {
      const actual=list(ex[field]);
      if(!expected.length) return add(rule,category,STATUS.NOT_CHECKED,[],actual,missingDetail||T('CP referansı bulunamadı.','CP reference was not found.'));
      if(!actual.length) return add(rule,category,missingActualStatus||STATUS.REVIEW,expected,[], missingActualStatus===STATUS.NOT_CHECKED?T('Layout kapsamı gereği bu alan zorunlu kontrol edilmedi.','This field was not required for this layout scope.'):T('Layout alanı güvenilir biçimde okunamadı.','The layout field could not be read reliably.'));
      add(rule,category,intersects(actual,expected,normalizer)?STATUS.MATCH:statusForMismatch(ex,field),expected,actual,'');
    };

    compareField('COLOR_CODE_MATCH','IDENTITY','colourCodes',cpCatalog(rows,'C.Code'),compactIdentifier,T('CP renk kodu referansı yok.','CP colour-code reference is unavailable.'));
    compareField('COLOR_NAME_MATCH','IDENTITY','colours',cpCatalog(rows,'Colour'),key,T('CP renk adı referansı yok.','CP colour-name reference is unavailable.'));

    if(isPrice || has('orderNumbers')) compareField('ORDER_MATCH','IDENTITY','orderNumbers',cpCatalog(rows,'Order Code').map(String),compactIdentifier,T('CP sipariş referansı yok.','CP order reference is unavailable.'));
    else skip('ORDER_MATCH','IDENTITY',[], T('Care Label için sipariş numarası zorunlu kontrol alanı değildir.','Order number is not a mandatory check for Care Label.'));

    if(isPrice || has('specialCodes')) compareField('SPECIAL_CODE_MATCH','IDENTITY','specialCodes',cpCatalog(rows,'Special Code'),compactIdentifier,T('CP Special Code referansı yok.','CP Special Code reference is unavailable.'));
    if(isPrice || has('seasonCodes')) compareField('SEASON_MATCH','IDENTITY','seasonCodes',cpCatalog(rows,'Season'),compactIdentifier,T('CP sezon referansı yok.','CP season reference is unavailable.'));
    if(isPrice || has('magCodes')) compareField('MAG_MATCH','IDENTITY','magCodes',cpCatalog(rows,'Merch Alt Grup Kod'),compactIdentifier,T('CP MAG referansı yok.','CP MAG reference is unavailable.'));
    if(isPrice || has('mmygCodes')) compareField('MMYG_MATCH','IDENTITY','mmygCodes',cpCatalog(rows,'Merch Marka Yaş Grup Kod'),compactIdentifier,T('CP MMYG referansı yok.','CP MMYG reference is unavailable.'));
    if(isPrice || has('lineCodes')) compareField('LINE_MATCH','IDENTITY','lineCodes',cpCatalog(rows,'Line'),key,T('CP Line referansı yok.','CP Line reference is unavailable.'));
    if(isPrice || has('productMainDefinitions')) compareField('PRODUCT_MAIN_DEFINITION_MATCH','IDENTITY','productMainDefinitions',cpCatalog(rows,'Ürün Tanım'),key,T('CP Product Main Definition referansı yok.','CP Product Main Definition reference is unavailable.'));

    compareField('COUNTRY_MATCH','COUNTRY','countries',cpCatalog(rows,'Country'),normalizeCountry,T('CP üretim ülkesi referansı yok.','CP country-of-origin reference is unavailable.'));

    const cpComposition=cpCatalog(rows,'Karışım');
    const actualComposition=list(ex.composition);
    if(!(isCare || actualComposition.length)) {
      skip('COMPOSITION_MATCH','COMPOSITION',actualComposition,T('Price Tag için kompozisyon kontrolü uygulanmaz.','Composition check does not apply to Price Tag.'));
    } else if(!cpComposition.length) add('COMPOSITION_MATCH','COMPOSITION',STATUS.NOT_CHECKED,[],actualComposition,T('CP ana kumaş Karışım referansı yok.','CP main-fabric composition reference is unavailable.'));
    else if(!actualComposition.length) add('COMPOSITION_MATCH','COMPOSITION',STATUS.REVIEW,cpComposition,[],T('Layout kompozisyonu güvenilir biçimde okunamadı.','Layout composition could not be read reliably.'));
    else {
      const expectedKey=compositionKey(cpComposition), actualKey=compositionKey(actualComposition);
      if(!expectedKey || !actualKey) add('COMPOSITION_MATCH','COMPOSITION',STATUS.REVIEW,cpComposition,actualComposition,T('Kompozisyon oranları normalize edilemedi; manuel doğrulama gerekli.','Composition percentages could not be normalized; manual verification is required.'));
      else add('COMPOSITION_MATCH','COMPOSITION',expectedKey===actualKey?STATUS.MATCH:statusForMismatch(ex,'composition'),cpComposition,actualComposition,'');
    }

    const cpCare=valuesForAliases(rows,FIELD_ALIASES.care);
    if(isCare || has('careInstructions')) compareField('CARE_INSTRUCTION_MATCH','CARE','careInstructions',cpCare,key,T('CP projeksiyonunda resmi yıkama talimatı alanı yok; AI yalnız semantik REVIEW yapabilir.','The CP projection has no official care-instruction field; AI can only provide semantic REVIEW.'),cpCare.length?STATUS.REVIEW:STATUS.NOT_CHECKED);
    else skip('CARE_INSTRUCTION_MATCH','CARE',[], T('Price Tag için yıkama talimatı kontrolü uygulanmaz.','Care-instruction check does not apply to Price Tag.'));

    const cpWarnings=valuesForAliases(rows,FIELD_ALIASES.warning);
    if(isCare || has('warnings')) compareField('WARNING_MATCH','CARE','warnings',cpWarnings,key,T('CP projeksiyonunda resmi uyarı zorunluluğu alanı yok.','The CP projection has no official warning-requirement field.'),cpWarnings.length?STATUS.REVIEW:STATUS.NOT_CHECKED);
    else skip('WARNING_MATCH','CARE',[], T('Price Tag için care-label uyarı kontrolü uygulanmaz.','Care-label warning check does not apply to Price Tag.'));

    const cpSizes=valuesForAliases(rows,FIELD_ALIASES.size);
    if(isPrice || has('sizes')) {
      if(cpSizes.length) {
        const actual=list(ex.sizes);
        if(!actual.length) add('SIZE_RANGE_MATCH','SIZE',STATUS.REVIEW,cpSizes,[],T('Layout bedenleri okunamadı.','Layout sizes could not be read.'));
        else add('SIZE_RANGE_MATCH','SIZE',setEquals(actual,cpSizes,normalizeSize)?STATUS.MATCH:statusForMismatch(ex,'sizes'),cpSizes,actual,'');
      } else add('SIZE_RANGE_MATCH','SIZE',STATUS.NOT_CHECKED,[],list(ex.sizes),T('CP projeksiyonunda beden aralığı referansı yok.','The CP projection has no size-range reference.'));
    } else skip('SIZE_RANGE_MATCH','SIZE',[], T('Care Label için beden aralığı kontrolü uygulanmaz.','Size-range check does not apply to Care Label.'));

    const cpBarcodes=valuesForAliases(rows,FIELD_ALIASES.barcode);
    if(isPrice || has('barcodes')) {
      compareField('BARCODE_MATCH','BARCODE','barcodes',cpBarcodes,normalizeBarcode,T('CP projeksiyonunda barkod referansı yok.','The CP projection has no barcode reference.'),STATUS.NOT_CHECKED);
      if(list(ex.barcodes).length) {
        const direct=ex._sources&&ex._sources.barcodes==='local';
        add('BARCODE_READABLE','BARCODE',direct?STATUS.MATCH:STATUS.REVIEW,[],list(ex.barcodes),direct?T('PDF sayfasındaki barkod BarcodeDetector ile doğrudan okunabildi.','The barcode on the PDF page was decoded directly with BarcodeDetector.'):T('Barkod yalnız LCW AI görsel okumasından geldi; doğrudan decoder kanıtı olmadığı için REVIEW.','The barcode was read only by LCW AI; REVIEW is required because there is no direct decoder evidence.'),''+(direct?'PDF BarcodeDetector':'LCW AI'));
      } else add('BARCODE_READABLE','BARCODE',STATUS.NOT_CHECKED,[],[],T('Tarayıcı barkod dekoderi değer okuyamadı; bu durum tek başına hata sayılmaz.','The browser barcode decoder could not read a value; this alone is not an error.'),'PDF BarcodeDetector');
      if(cpBarcodes.length && cpSizes.length) add('BARCODE_SIZE_MATCH','BARCODE',STATUS.REVIEW,[],list(ex.pageVariants),T('Barkod ↔ beden eşleşmesi için CP tarafında çiftli mapping yapısı bulunamadı.','No paired barcode-to-size mapping was found in CP.'));
      else add('BARCODE_SIZE_MATCH','BARCODE',STATUS.NOT_CHECKED,[],list(ex.pageVariants),T('CP tarafında barkod ↔ beden mapping referansı yok.','CP has no barcode-to-size mapping reference.'));
    } else {
      skip('BARCODE_MATCH','BARCODE',[], T('Care Label için karton etiket barkod kontrolü uygulanmaz.','Price-tag barcode check does not apply to Care Label.'));
      skip('BARCODE_READABLE','BARCODE',[], T('Care Label için karton etiket barkod kontrolü uygulanmaz.','Price-tag barcode check does not apply to Care Label.'));
      skip('BARCODE_SIZE_MATCH','BARCODE',[], T('Care Label için barkod ↔ beden kontrolü uygulanmaz.','Barcode-to-size check does not apply to Care Label.'));
    }

    const cpQr=valuesForAliases(rows,FIELD_ALIASES.qr);
    if(isPrice || has('qrCodes')) {
      if(cpQr.length) compareField('QR_MATCH','BARCODE','qrCodes',cpQr,normalizeBarcode,T('CP QR referansı yok.','CP QR reference is unavailable.'),STATUS.NOT_CHECKED);
      else if(list(ex.qrCodes).length) {
        const direct=ex._sources&&ex._sources.qrCodes==='local';
        add('QR_READABLE','BARCODE',direct?STATUS.MATCH:STATUS.REVIEW,[],list(ex.qrCodes),direct?T('QR kodu tarayıcı dekoderi ile doğrudan okunabildi.','The QR code was decoded directly with the browser decoder.'):T('QR içeriği yalnız LCW AI görsel okumasından geldi; doğrudan decoder kanıtı olmadığı için REVIEW.','The QR content was read only by LCW AI; REVIEW is required because there is no direct decoder evidence.'),direct?'PDF BarcodeDetector':'LCW AI');
      } else add('QR_READABLE','BARCODE',STATUS.NOT_CHECKED,[],[],T('QR için doğrulanabilir CP referansı/decode değeri yok.','No verifiable CP reference or decoded value is available for QR.'));
    } else skip('QR_READABLE','BARCODE',[], T('Care Label için QR kontrolü uygulanmaz.','QR check does not apply to Care Label.'));

    const cpPrices=valuesForAliases(rows,FIELD_ALIASES.price);
    if(isPrice || has('prices')) compareField('PRICE_MATCH','PRICE','prices',cpPrices,normalizePrice,T('CP projeksiyonunda doğrulanabilir fiyat referansı yok.','The CP projection has no verifiable price reference.'),STATUS.NOT_CHECKED);
    else skip('PRICE_MATCH','PRICE',[], T('Care Label için fiyat kontrolü uygulanmaz.','Price check does not apply to Care Label.'));

    const cpProduct=uniq(cpCatalog(rows,'Category').concat(cpCatalog(rows,'Ürün Tanım')));
    if(isPrice || clean(ex.productClass)) {
      if(clean(ex.productClass) && cpProduct.length && cpProduct.some(v=>key(v)===key(ex.productClass))) add('PRODUCT_CLASS_MATCH','IDENTITY',STATUS.MATCH,cpProduct,[ex.productClass],'');
      else add('PRODUCT_CLASS_MATCH','IDENTITY',STATUS.NOT_CHECKED,cpProduct,clean(ex.productClass)?[ex.productClass]:[],T('Karton etiketteki ürün sınıfının CP Category/Ürün Tanım ile aynı iş anlamına geldiği garanti edilmedi.','The product class on the price tag cannot be guaranteed to have the same business meaning as CP Category/Product Description.'));
      const cpFit=valuesForAliases(rows,['Fit','Kalıp','Kalip','Fit Tanım','Fit Tanimi']);
      compareField('FIT_MATCH','IDENTITY','fit',cpFit,key,T('CP projeksiyonunda doğrulanabilir fit/kalıp referansı yok.','The CP projection has no verifiable fit reference.'),STATUS.NOT_CHECKED);
    } else {
      skip('PRODUCT_CLASS_MATCH','IDENTITY',[], T('Care Label için ürün sınıfı kontrolü uygulanmaz.','Product-class check does not apply to Care Label.'));
      skip('FIT_MATCH','IDENTITY',[], T('Care Label için fit/kalıp kontrolü uygulanmaz.','Fit check does not apply to Care Label.'));
    }

    const findings=list(ex.visualFindings);
    findings.forEach((finding,index)=>add('AI_VISUAL_'+String(index+1),'VISUAL',STATUS.REVIEW,[],[finding],T('LCW AI görsel/semantik bulgusu; deterministik ERROR üretmez.','LCW AI visual/semantic finding; it does not create a deterministic ERROR.'),'LCW AI'));

    const opt=options&&typeof options==='object'?options:{};
    if(opt.aiUnavailable) add('AI_VISUAL_REVIEW','VISUAL',STATUS.REVIEW,[],[],T('LCW AI görsel incelemesi tamamlanamadı; deterministik kontroller korunmuştur.','LCW AI visual review could not be completed; deterministic checks were preserved.'),'LCW AI');
    if(doc===DOC.UNKNOWN) add('DOCUMENT_TYPE','IDENTITY',STATUS.REVIEW,[DOC.CARE_LABEL,DOC.PRICE_TAG],[DOC.UNKNOWN],T('Layout türü kesin belirlenemedi.','The layout type could not be determined with certainty.'));

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
    summary.status=summary.errors?'ERROR':(summary.review||summary.notChecked?'REVIEW':'APPROVED');
    return summary;
  }

  function assess(extraction,cpRows,options={}){
    const merged=extraction&&extraction._sources?extraction:extraction&&Object.prototype.hasOwnProperty.call(extraction,'_nativeText')?mergeExtraction(extraction,{}):mergeExtraction({},extraction);
    const ex=enrichExtractionFromCp(merged,cpRows),doc=ex.documentType||DOC.UNKNOWN,checks=[];
    const readable=['modelCodes','orderNumbers','specialCodes','countries','composition','cashPrices'].some(f=>list(ex[f]).length);
    const rows=readable?exactMatchRows(cpRows,ex):[],orders=cpCatalog(rows,'orderCode');
    const reference={status:!rows.length?'NONE':orders.length>1?'AMBIGUOUS':'MATCH',orderCodes:orders,modelNames:cpCatalog(rows,'modelName'),colourCodes:cpCatalog(rows,'colourCode')};
    const add=(rule,category,status,expected,actual,detail,source)=>checks.push(makeCheck(rule,category,status,expected,actual,detail,source));
    if(!readable||doc===DOC.UNKNOWN){
      add('DOCUMENT_READING','READING',STATUS.REVIEW,[],[],T('Belge okunamadı; alan doğruluğu kontrol edilemedi. Yeniden deneyin.','Document could not be read; field accuracy could not be checked. Retry.'),'PDF / LCW AI');
      return {documentType:doc,extraction:ex,referenceRows:rows,reference,checks,summary:summarize(checks),reading:options.reading||{}};
    }
    if(reference.status!=='MATCH')add('CP_ORDER_LINK','REFERENCE',STATUS.REVIEW,[],orders.length?orders:list(ex.orderNumbers),reference.status==='AMBIGUOUS'?T('Model/renk birden fazla CP siparişiyle eşleşiyor; sipariş kesinleşmedi.','Model/colour matches multiple CP orders; the order is ambiguous.'):T('Okunan kimlikle erişilebilir CP siparişi bulunamadı.','No accessible CP order matches the extracted identity.'),'CP');
    const field=(rule,id,exField,normalizer=compactIdentifier)=>{
      const actual=list(ex[exField]),expected=cpCatalog(rows,id);
      if(!expected.length)return add(rule,'IDENTITY',STATUS.NOT_CHECKED,[],actual,T('Layout değeri gösteriliyor; CP referansı yok.','Layout value shown; no CP reference is available.'));
      if(!actual.length)return add(rule,'IDENTITY',STATUS.REVIEW,expected,[],T('Bu alan okunamadı.','This field could not be read.'));
      const normalized=uniq(expected.map(normalizer)),values=actual.map(normalizer).filter(Boolean);
      if(reference.status==='AMBIGUOUS'&&normalized.length>1)return add(rule,'IDENTITY',STATUS.REVIEW,expected,actual,T('CP adaylarının bu alanı farklı; kesin sipariş gerekli.','CP candidates disagree on this field; an exact order is required.'));
      add(rule,'IDENTITY',values.length&&values.every(v=>normalized.includes(v))?STATUS.MATCH:statusForMismatch(ex,exField,expected,normalizer),expected,actual,T('Okunan layout değeri CP alanıyla karşılaştırıldı.','Extracted layout value compared with the CP field.'));
    };
    field('MODEL_MATCH','modelName','modelCodes');
    if(doc===DOC.PRICE_TAG||list(ex.orderNumbers).length)field('ORDER_MATCH','orderCode','orderNumbers');
    field('SPECIAL_CODE_MATCH','specialCode','specialCodes',v=>doc===DOC.CARE_LABEL?compactIdentifier(v).replace(/Z[148]$/,''):compactIdentifier(v));field('COLOR_CODE_MATCH','colourCode','colourCodes');
    if(doc===DOC.CARE_LABEL||list(ex.colours).length)field('COLOR_NAME_MATCH','colour','colours',key);
    field('COUNTRY_MATCH','country','countries',normalizeCountry);
    if(doc===DOC.CARE_LABEL)field('COMPOSITION_MATCH','fabricComposition','composition',v=>compositionKey(v));
    if(doc===DOC.PRICE_TAG){
      const actual=list(ex.cashPrices),expected=cpCatalog(rows,'cashRetailPrice');
      const amount=v=>{const n=normalizePrice(v);return n.includes(':')?n.split(':').pop():n;};
      const equal=(a,b)=>{const x=normalizePrice(a),y=normalizePrice(b);return Boolean(x&&y)&&amount(a)===amount(b)&&(!x.includes(':')||!y.includes(':')||x.split(':')[0]===y.split(':')[0]);};
      add('PRICE_MATCH','PRICE',!actual.length||actual.some(v=>!normalizePrice(v))?STATUS.REVIEW:!expected.length?STATUS.NOT_CHECKED:expected.some(v=>!normalizePrice(v))?STATUS.REVIEW:reference.status==='AMBIGUOUS'&&new Set(expected.map(amount)).size>1?STATUS.REVIEW:actual.every(a=>expected.some(b=>equal(a,b)))?STATUS.MATCH:statusForMismatch(ex,'cashPrices',expected,normalizePrice,equal),expected,actual,!actual.length||actual.some(v=>!normalizePrice(v))?T('Peşin satış fiyatı okunamadı.','Cash selling price could not be read.'):!expected.length?T('Peşin fiyat okundu. CP’de peşin satış fiyatı referansı yok; FOB veya taksitli fiyatla karşılaştırılmaz.','Cash price read. CP has no cash retail price reference; FOB and instalment prices are not comparable.'):T('Yalnız geçerli peşin satış fiyatları karşılaştırılır.','Only valid cash retail prices are compared.'));
    }
    const reading=options.reading||{};
    if(options.aiUnavailable||arrFailed(reading).length)add('LAYOUT_PAGE_COVERAGE','READING',STATUS.REVIEW,[],arrFailed(reading).map(String),T('Bazı sayfaların görsel incelemesi tamamlanamadı. Okunan alanlar korundu.','Visual review of some pages was incomplete. Extracted fields were retained.'),'LCW AI');
    const evidenceFields={MODEL_MATCH:'modelCodes',ORDER_MATCH:'orderNumbers',SPECIAL_CODE_MATCH:'specialCodes',COLOR_CODE_MATCH:'colourCodes',COLOR_NAME_MATCH:'colours',COUNTRY_MATCH:'countries',COMPOSITION_MATCH:'composition',PRICE_MATCH:'cashPrices'};
    const evidence=(ex.fieldEvidence||[]).flatMap(line=>{try{const f=JSON.parse(line),b=f.bbox;return Number.isInteger(f.page)&&f.page>=1&&f.page<=Math.min(80,Number(reading.totalPages)||80)&&Array.isArray(b)&&b.length===4&&b.every(n=>typeof n==='number'&&Number.isFinite(n))&&b[0]>=0&&b[1]>=0&&b[2]>0&&b[3]>0&&b[0]+b[2]<=1.001&&b[1]+b[3]<=1.001&&clean(f.text)?[f]:[];}catch(_){return [];}});
    checks.forEach(check=>{const field=evidenceFields[check.rule],f=evidence.find(f=>f.field===field);if(f){check.page=f.page;check.bbox=f.bbox;}});
    return {documentType:doc,extraction:ex,referenceRows:rows,reference,reading,checks,summary:summarize(checks)};
  }
  function arrFailed(reading){return Array.isArray(reading.failedPages)?reading.failedPages:[];}
  function fireRequirement(rows){
    if(!rows||!rows.length)return null;
    const results=rows.map(row=>{
      const special=fold(cpValue(row,'specialCode')),category=fold(cpValue(row,'category')||cpValue(row,'productDescription'));
      const nightwear=/PYJAMA|PIJAMA|NIGHT(?:WEAR|DRESS)|GECELIK|BATHROBE|BORNOZ/.test(category);
      const groups=fold([cpValue(row,'mmyg'),cpValue(row,'mag'),cpValue(row,'buyingGroup')].join(' '));
      if(nightwear&&/\b(?:BU|BG)(?:\b|\d)/.test(groups))return true;
      const wearable=nightwear||/T.?SHIRT|SHIRT|KAZAK|SWEATER|PANT|TROUSER|ELBISE|DRESS|HIRKA|CARDIGAN|SWEAT|YELEK|VEST|SORT|SHORT|ETEK|SKIRT|CEKET|JACKET|BLOUSE|BLUZ|COAT|MONT|LEGGING|TAYT|SOCK|CORAP|UNDERWEAR|IC GIYIM/.test(category);
      if(/Z[14]$/.test(special)&&wearable)return true;
      if(nightwear&&!groups)return null;
      if(/Z[148]$/.test(special)&&category)return false;
      return null;
    });return results.every(v=>v===true)?true:results.every(v=>v===false)?false:null;
  }

  return {
    STATUS,DOC,FIELD_ALIASES,clean,fold,key,uniq,list,normalizeCountry,normalizeSize,normalizeBarcode,normalizePrice,
    parseComposition,compositionKey,classifyDocument,extractCountries,extractOriginCountries,deriveLocalExtraction,mergeExtraction,enrichExtractionFromCp,exactMatchRows,compare,summarize,printedFields,assess,cpValue,cpCatalog,fireRequirement
  };
});
