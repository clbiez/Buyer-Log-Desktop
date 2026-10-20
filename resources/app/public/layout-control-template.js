'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLLayoutTemplate=api;
})(typeof window!=='undefined'?window:null,function(){
  const VERSION='LCW-004.4-003.5-ai3';
  const SOURCES=Object.freeze({
    CARE_LABEL:{code:'LC.KSU.ST.004',revision:4,date:'2025-03-28',url:'layout-control-standards/care-v4.pdf',pages:18},
    PRICE_TAG:{code:'LC.KSU.ST.003',revision:5,date:'2025-08-14',url:'layout-control-standards/price-v5.pdf',pages:28}
  });
  const rules=[];
  function rule(id,type,page,severity,tr,en,expectedTr,expectedEn){rules.push(Object.freeze({id,type,page,severity,title:{tr,en},expected:{tr:expectedTr,en:expectedEn}}));}
  rule('CARE_ID','CARE_LABEL',2,'ERROR','Kimlik ve takım bilgisi','Identity and set details',
    'Özel kod, model, renk kodu/adı ilk sayfanın dikiş payında; takımda Child özel kod/renk. Home için sağ üstte.',
    'Special code, model, colour code/name in the first-page seam allowance; Child special/colour codes for sets. Home: upper right.');
  rule('CARE_CONTENT','CARE_LABEL',3,'CRITICAL','Kumaş yeri ve içerik','Fabric area and composition',
    'Kumaş kullanım yeri içerikten önce: Ana kumaş / %100 pamuk; astar vb. bileşenler ayrı. Menşe üretim ülkesidir; ithalatçı ülkesi değildir.',
    'Fabric area precedes composition: Main fabric / 100% cotton; lining and other components separately. Origin is the manufacturing country, not importer country.');
  rule('CARE_SYMBOLS','CARE_LABEL',4,'ERROR','Bakım sembolleri ve açıklama','Care symbols and descriptions',
    'Saten/küçük etikette bakım sembolleri bulunur; sembol açıklaması hiçbir dilde yazılmaz. Home istisnası: açıklamalar yalnız TR/EN/RU/AR (s.12).',
    'Satin/small labels carry care symbols without symbol descriptions in any language. Home exception: descriptions only in TR/EN/RU/AR (p.12).');
  rule('CARE_LANG','CARE_LABEL',4,'ERROR','23 dil ve sıra','23 languages and sequence',
    'Kumaş yeri/içerik, menşe ve gerekli uyarılar: TR EN RU UA RO BG PL KZ AZ AR FR ID AL BH SR MS MK ES HR GR PT HU UZ. Kodlar başta; saten/Home kodları kalın. Home sembol açıklamaları bu kuraldan ayrıdır.',
    'Fabric area/composition, origin and required warnings: TR EN RU UA RO BG PL KZ AZ AR FR ID AL BH SR MS MK ES HR GR PT HU UZ. Codes lead; satin/Home codes bold. Home symbol descriptions are a separate exception.');
  rule('CARE_FIRE','CARE_LABEL',3,'CRITICAL','Ateşten uzak tutunuz','Keep away from fire',
    'Giyilebilir Z1/Z4 ve BU/BG gecelik, pijama, bornoz: tüm çeviriler kırmızı BÜYÜK HARF; beş sembolün altında, diğer uyarıların üstünde. Ürün grubu belirsizse incele.',
    'Wearable Z1/Z4 and BU/BG nightwear, pyjamas, bathrobes: all translations red UPPERCASE; below five symbols and above other warnings. Review if product group is unknown.');
  rule('CARE_LEGAL','CARE_LABEL',3,'ERROR','İthalatçı ve firma bloğu','Importer and company block',
    'Ekvador, Peru, Panama, Şili, Yunanistan, Romanya, Fas bilgileri kaynak standartla aynı olmalı; ilk dört ülke sonunda FABRICADO POR bir kez. LCW firma/adres/telefon ve www.lcwaikiki.com.',
    'Ecuador, Peru, Panama, Chile, Greece, Romania and Morocco blocks must match the source standard; FABRICADO POR once after the first four. LCW company/address/phone and www.lcwaikiki.com.');
  rule('CARE_SATIN','CARE_LABEL',4,'ERROR','Katlamalı saten düzeni','Folded satin layout',
    'Yalnız katlamalı saten: 35×100 mm katlı, 35×200 mm açık, 17 mm dikiş payı. Arial 5 pt; ülke kodları kalın siyah; iştirakler son sayfada Arial 4 pt, ülke adları kalın. Metin sola / ile ayrılır; firma/web sonda ortalı; sayfa numaraları.',
    'Folded satin only: 35×100 mm folded, 35×200 mm open, 17 mm seam. Arial 5 pt; country codes bold black; final-page affiliates Arial 4 pt with bold country names. Left aligned with / separators; company/web centred last; page numbers.');
  rule('CARE_SMALL','CARE_LABEL',9,'ERROR','Küçük etiket düzeni','Small label layout',
    'Yalnız küçük etiket: 25×60 mm katlı, 25×120 mm açık, 9,5 mm dikiş payı; tüm bilgiler ortalı, Arial 3 pt; ateş uyarısı kırmızı.',
    'Small label only: 25×60 mm folded, 25×120 mm open, 9.5 mm seam; all content centred, Arial 3 pt; fire warning red.');
  rule('CARE_HOME','CARE_LABEL',13,'ERROR','Home etiket düzeni','Home label layout',
    'Yalnız Home: 25×112 mm, 20 mm dikiş payı, Arial 4 pt, ülke kodları kalın siyah, ateş uyarısı kırmızı. Metin sola / ile ayrılır, firma/web sonda ortalı.',
    'Home only: 25×112 mm, 20 mm seam, Arial 4 pt, country codes bold black, fire warning red. Left aligned with / separators; company/web centred last.');
  rule('CARE_INNER','CARE_LABEL',5,'ERROR','İç barkod düzeni','Inner barcode layout',
    'İç barkod sayfası varsa: takım tekil barkodları en üstte, beden → kalın marka → model/özel kod/renk/sipariş → DPP QR → KPN/ölçü (varsa) → çubuk barkod. Saten 35×100 mm; küçük 25×60 mm. Arial siyah; küçük marka sola, saten marka ortalı.',
    'If an inner barcode page exists: set-component barcodes at top, size → bold brand → model/special/colour/order → DPP QR → KPN/dimensions if any → barcode. Satin 35×100 mm; small 25×60 mm. Arial black; small brand left, satin brand centred.');
  rule('CARE_QR','CARE_LABEL',5,'CRITICAL','İç barkod QR ölçüsü','Inner barcode QR dimensions',
    'İç barkod varsa QR en az 18×18 mm (saten/küçük/yatay). Yalnız katlamalı saten iç barkodda QR–çubuk barkod mesafesi en az 30 mm. Ölçek bilinmiyorsa ölçü onaylama.',
    'If inner barcode is present, QR at least 18×18 mm (satin/small/horizontal). Only folded satin inner barcode requires QR–barcode distance at least 30 mm. Do not approve dimensions without known scale.');
  rule('CARE_SPECIAL','CARE_LABEL',16,'ERROR','Denim ve boya uyarıları','Denim and dye warnings',
    'Denimse son sayfada TR/EN/RU/AR denim uyarısı. Batik/degrade/parça boya uyarısı gerekiyorsa 55×89 mm, yaklaşık 10 mm dikiş payı. Uygulanabilirlik kanıtı yoksa incele.',
    'Denim: final-page warning in TR/EN/RU/AR. Required batik/degrade/garment-dye warning: 55×89 mm, approximately 10 mm seam. Review if applicability is unknown.');
  rule('CARE_PRODUCTION','CARE_LABEL',17,'COMMENT','Üretimde doğrulanacaklar','Production verification',
    'Bakım ve iç barkod ayrı hazırlanır; ayrılabilir takımın her parçası etiketlenir; loop dikilmez. Malzeme/dikim ve sticker tamir sevk kısıtları PDF’den onaylanamaz: fiziksel doğrulama gerekir (s.17–18).',
    'Care and inner barcode prepared separately; each detachable set component labelled; no loop sewing. Material/sewing and sticker-repair shipment restrictions cannot be approved from a PDF: physical verification required (pp.17–18).');
  rule('PRICE_VARIANT','PRICE_TAG',13,'ERROR','Etiket tipi ve pazar','Label type and market',
    'Karton, iade, çift sticker (KDV/KDV’siz), Home kırılgan, kozmetik/gıda, oyuncak, fiyat güncelleme veya indirim tipini ve pazarı belirle. Yurt içi TL/KDV kurallarını yurt dışına uygulama; alt tip belirsizse incele.',
    'Identify carton, return, double sticker (VAT/no VAT), Home fragile, cosmetics/food, toy, price update or discount type and market. Do not apply domestic TL/VAT rules abroad; review unknown subtype.');
  rule('PRICE_FIELDS','PRICE_TAG',14,'ERROR','Karton zorunlu alanları','Required carton fields',
    'Yurt içi karton: DPP QR, fit/kalıp, sipariş, beden/aralık, model, özel/renk/iade kodu, MAG, line kodu/adı, ekipman, barkod, ürün ana tanımı, bileşen menşei; fiyat ve yasal blok. Diğer tiplerde ilgili standart sayfasını kullan.',
    'Domestic carton: DPP QR, fit, order, size/range, model, special/colour/return codes, MAG, line code/name, equipment, barcode, product definition, component origin; price and legal block. Use the subtype page for other labels.');
  rule('PRICE_MONEY','PRICE_TAG',14,'CRITICAL','Fiyat, para birimi ve tarih','Price, currency and date',
    'Yurt içi karton: TL sembolü rakamın solunda; taksitli/peşin fiyat; peşin altında KDV Dahildir, altında Fiyat oluşturma tarihi: gg/aa/yyyy. KDV’siz stickerda tarih fiyatların altında; kozmetik/gıdada yalnız peşin, taksitli yok (s.18,21–22).',
    'Domestic carton: TL symbol left of number; instalment/cash price; VAT included below cash, then price creation date dd/mm/yyyy. No-VAT sticker: date below prices; cosmetics/food: cash only, no instalment (printed pp.18,21–22).');
  rule('PRICE_ORIGIN','PRICE_TAG',15,'CRITICAL','Yerli üretim logosu','Domestic production logo',
    'Türkiye menşeli yurt içi üründe Yerli Üretim logosu; takımın herhangi bir bileşeni yabancıysa logo bulunmaz. Kartonda fiyat yazısının sağında dikey; 1. kalite Global etiket logosu 18×6 mm/oran korunur. Menşe/bileşen bilinmiyorsa incele.',
    'Domestic Turkish-origin product: domestic production logo; absent if any set component has foreign origin. Carton: vertical to right of price caption; first-quality Global logo 18×6 mm/preserve proportions. Review unknown origin/components.');
  rule('PRICE_RECYCLE','PRICE_TAG',15,'ERROR','Geri dönüşüm sembolü','Recycling symbol',
    'Yurt içi karton etikette sol üstte; en az 5×5 mm. Ölçek kanıtı olmadan ölçü onaylama.',
    'Domestic carton: upper left; at least 5×5 mm. Do not approve dimensions without scale evidence.');
  rule('PRICE_GEOMETRY','PRICE_TAG',16,'ERROR','Ölçü, font ve yerleşim','Dimensions, font and placement',
    'Karton altlığı genel olarak 53×105 mm; baskı yerleşimi ve Arial/Arial Bold punto bilgileri kaynak s.15 görseliyle karşılaştırılır. Baskı alanı ile karton boyutu aynı değildir. Kılçık deliği genel 10 mm, 3. kalite 6 mm. Malzeme/gramaj fiziksel kontroldür.',
    'Carton stock generally 53×105 mm; compare print placement and Arial/Arial Bold sizes with printed p.15 figure. Print area differs from stock dimensions. Hole generally 10 mm from top, third quality 6 mm. Material/weight requires physical inspection.');
  rule('PRICE_BRAND','PRICE_TAG',6,'ERROR','Marka ve ön yüz','Brand and front face',
    'Ön yüz varsa marka/PLM tipine göre s.2–12 kaynak görselleriyle karşılaştır: LCW, Home, XSIDE, Southblue, Natuvera, Modest, Eco, Dream, SouLife, ONCE ve kalite ayrımları. Görünmeyen ön yüzü onaylama.',
    'If front face is supplied, compare brand/PLM type with source PDF pp.2–12: LCW, Home, XSIDE, Southblue, Natuvera, Modest, Eco, Dream, SouLife, ONCE and quality variants. Do not approve an unseen front face.');
  rule('PRICE_QR','PRICE_TAG',19,'CRITICAL','Sticker QR ve barkod','Sticker QR and barcode',
    'Çift sticker, KDV’siz, Home kırılgan, kozmetik/gıda ve oyuncak QR: en az 11×11 mm; karton ölçüleri kaynak s.15 görselinde. Barkodda silik/çizik/deformasyon olmamalı. Görsel tahmin decode değildir; gerçek okuma ayrıca doğrulanır.',
    'Double sticker, no VAT, Home fragile, cosmetics/food and toy QR: at least 11×11 mm; carton dimensions in printed p.15 figure. No faded/scratched/deformed barcode. Visual estimates are not decoding; actual reading is verified separately.');
  rule('PRICE_SPECIAL','PRICE_TAG',22,'ERROR','Özel ürün ve iade tipleri','Special product and return types',
    'Kozmetik/gıda ve 0–3 oyuncakta birim fiyat; oyuncakta gerekli uyarılar/LCW firma bilgisi; Home kırılganda içerik/varsa uyarı. İade kartonda iade klasmanı, saat-bilgisayar kodu/tarihi. Tam alan listesi ilgili kaynak sayfasında (s.15–25).',
    'Cosmetics/food and 0–3 toys: unit price; toys: required warnings/LCW company block; Home fragile: content/warnings if any. Return carton: return class, time/computer code/date. Full subtype field lists on printed pp.15–25.');
  rule('PRICE_DISCOUNT','PRICE_TAG',28,'ERROR','İndirim etiketi','Discount label',
    'Yurt içi kırmızı indirim: ilk peşin fiyat üzeri çizili, yeni fiyat ve TL rakamın solunda. Yurt dışı: özel/renk kodu, ilk/indirimli fiyat ve para birimi; ilk fiyat üzeri çizili. Fiyat güncelleme ayrı tiptir (s.26–27).',
    'Domestic red discount: initial cash price struck through, new price and TL left of number. Abroad: special/colour codes, initial/discount price and currency; initial price struck through. Price update is a separate type (printed pp.26–27).');
  rule('VISUAL_PAGES','ANY',1,'ERROR','Kesilme ve sayfa tutarlılığı','Clipping and page consistency',
    'Tüm layout sayfalarında kesilme, üst üste binme, okunaksız metin ve tutarsız model/renk/menşe/beden/barkod varyantlarını işaretle. Görünmeyen sayfa veya eksik kanıt varsa onaylama.',
    'Mark clipping, overlap, illegible text and inconsistent model/colour/origin/size/barcode variants across all layout pages. Do not approve unseen pages or missing evidence.');

  rule('CARE_TRANSLATIONS','CARE_LABEL',4,'ERROR','Diller ve çevirilerin anlamı','Languages and translation meaning',
    'Her dilde kumaş yeri, ana kumaş yüzdeleri, menşe, bakım ve gerekli ateş uyarısı TR/EN aslıyla aynı anlamda olmalı; dil atlanmamalı. Görülmeyen/okunamayan çeviri uygun sayılmaz.',
    'Fabric area, main-fabric percentages, origin, care and required fire warning must preserve the TR/EN meaning in every language; no omitted languages. Unseen/illegible translations cannot pass.');
  rule('CARE_CONTACT','CARE_LABEL',3,'ERROR','LCW adresi, telefonu ve sitesi','LCW address, phone and website',
    'LC WAIKIKI MAĞAZACILIK HİZ.TİC.A.Ş.; 15 Temmuz Mahallesi Gülbahar Caddesi No:41, 34212 Bağcılar/İSTANBUL; +90(212)6575555; www.lcwaikiki.com. İthalatçı adresi bu firma bloğunun yerine geçmez.',
    'LC WAIKIKI MAĞAZACILIK HİZ.TİC.A.Ş.; 15 Temmuz Mahallesi Gülbahar Caddesi No:41, 34212 Bağcılar/İSTANBUL; +90(212)6575555; www.lcwaikiki.com. An importer address does not replace this company block.');
  rule('PRICE_CASH','PRICE_TAG',14,'ERROR','Peşin satış fiyatı ve para birimi','Cash retail price and currency',
    'Peşin Fiyat ve basılı para birimi açıkça okunmalı; taksitli fiyatla karıştırılmamalı. Yurt içi etikette TL sembolü rakamın solunda, KDV Dahildir ve fiyat oluşturma tarihi ilgili blokta. Yurt dışı etiketinde yerel pazar bilgisi esas alınır.',
    'Read Cash Price and its printed currency separately from the instalment price. Domestic label: TL symbol left of amount, VAT included and price creation date in the relevant block. Foreign labels follow their local market.');
  const LANGUAGES='TR EN RU UA RO BG PL KZ AZ AR FR ID AL BH SR MS MK ES HR GR PT HU UZ'.split(' ');
  function focusedRules(type){const ids=type==='CARE_LABEL'?['CARE_LANG','CARE_TRANSLATIONS','CARE_CONTACT','CARE_FIRE']:type==='PRICE_TAG'?['PRICE_CASH']:[];return rules.filter(r=>ids.includes(r.id));}
  function applicable(type){return rules.filter(r=>r.type===type||r.type==='ANY');}
  function normalizeFinding(value,pageCount){
    let item;try{item=typeof value==='string'?JSON.parse(value):value;}catch(_){return null;}
    if(!item||typeof item!=='object'||!rules.some(r=>r.id===item.ruleId))return null;
    const page=Number(item.page),box=item.bbox;
    const validPage=Number.isInteger(page)&&page>=1&&page<=Math.min(80,Number(pageCount)||80);
    const validBox=validPage&&Array.isArray(box)&&box.length===4&&box.every(n=>typeof n==='number'&&Number.isFinite(n))&&box[0]>=0&&box[1]>=0&&box[2]>0&&box[3]>0&&box[0]+box[2]<=1.001&&box[1]+box[3]<=1.001;
    const clean=(v,n)=>String(v==null?'':v).trim().slice(0,n);
    return {ruleId:item.ruleId,verdict:['PASS','ISSUE','UNCERTAIN','NA'].includes(item.verdict)?item.verdict:'UNCERTAIN',page:validPage?page:null,bbox:validBox?box:null,actual:clean(item.actual,1000),comment:clean(item.comment,1200),correction:clean(item.correction,1200)};
  }
  function checks(type,findings,pageCount,language){
    const lang=language==='en'?'en':'tr';
    const parsed=(Array.isArray(findings)?findings:[]).slice(0,80).map(f=>normalizeFinding(f,pageCount)).filter(Boolean);
    return applicable(type).flatMap(r=>{
      const found=parsed.filter(f=>f.ruleId===r.id);
      return (found.length?found:[null]).map((f,i)=>({
        rule:'STD_'+r.id+(i?'_'+i:''),ruleId:r.id,category:'STANDARD',status:'REVIEW',severity:r.severity,
        expected:[r.expected[lang]],actual:f&&f.actual?[f.actual]:[],
        detail:f?f.comment:(lang==='en'?'No verified AI evidence; buyer review required.':'Doğrulanmış AI kanıtı yok; buyer incelemesi gerekli.'),
        correction:f&&f.correction||'',aiVerdict:f&&f.verdict||'UNCERTAIN',page:f&&f.page||null,bbox:f&&f.bbox||null,
        source:'LCW AI',standardType:r.type==='ANY'?type:r.type,standardPage:r.page,decision:'PENDING',comment:'',
      }));
    });
  }
  function guide(){return rules.map(r=>r.id+' ['+r.type+'] '+r.expected.en).join('\n');}
  function focusedGuide(){return ['Standards: LC.KSU.ST.004 rev.4; LC.KSU.ST.003 rev.5.',...focusedRules('CARE_LABEL'),...focusedRules('PRICE_TAG')].map(r=>typeof r==='string'?r:r.id+': '+r.expected.en).join('\n');}
  function focusedChecks(type,findings,pageCount,language,options={}){
    const lang=language==='en'?'en':'tr',ex=options.extraction||{},complete=options.complete===true;
    const parsed=(Array.isArray(findings)?findings:[]).map(f=>normalizeFinding(f,pageCount)).filter(Boolean);
    const selected=focusedRules(type).filter(r=>r.id!=='CARE_FIRE'||options.fireRequired!==false);
    const result=selected.map(r=>{
      const matches=parsed.filter(f=>f.ruleId===r.id),issue=matches.find(f=>f.verdict==='ISSUE'),uncertain=matches.find(f=>f.verdict==='UNCERTAIN'),passed=matches.filter(f=>f.verdict==='PASS'&&f.actual);
      const f=issue||uncertain||passed[0]||null;
      let status=issue?'MISMATCH':uncertain||!passed.length?'REVIEW':'MATCH';
      let actual=matches.map(f=>f.actual).filter(Boolean),detail=matches.map(f=>f.comment).filter(Boolean).join(' · ');
      if(r.id==='CARE_LANG'){
        const codes=Array.from(new Set((ex.languageCodes||[]).filter(c=>LANGUAGES.includes(c))));actual=codes;
        const missing=LANGUAGES.filter(c=>!codes.includes(c));
        status=issue?'MISMATCH':missing.length?(complete&&codes.length?'MISMATCH':'REVIEW'):'MATCH';
        detail=[detail,missing.length?(lang==='en'?'Missing/unread languages: ':'Eksik/okunamayan diller: ')+missing.join(', '):(lang==='en'?'All 23 required language sections were read.':'Zorunlu 23 dil bölümü okundu.')].filter(Boolean).join(' · ');
      }
      if(r.id==='CARE_TRANSLATIONS'&&status==='MATCH'){
        const codes=(ex.languageTexts||[]).flatMap(line=>{try{return [JSON.parse(line).code];}catch(_){return [];}});
        if(!complete||LANGUAGES.some(c=>!codes.includes(c)))status='REVIEW';
      }
      if(r.id==='CARE_TRANSLATIONS'&&options.compositionKey){
        const base=options.compositionKey(ex.composition||[]),conflicts=[];
        (ex.languageTexts||[]).forEach(line=>{try{const item=JSON.parse(line),value=options.compositionKey(item.composition||'');if(base&&value&&base!==value)conflicts.push(item.code+': '+item.composition);}catch(_){}});
        if(conflicts.length){status='MISMATCH';actual=conflicts;detail=lang==='en'?'Translated composition differs from the main fabric.':'Çevirideki kompozisyon ana kumaşla farklı.';}
      }
      if(r.id==='CARE_CONTACT'&&options.fold){
        const text=options.fold([...(ex.companyAddresses||[]),...actual].join(' '));
        const urls=(ex.websites||[]).map(v=>String(v).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,''));
        const parts=[/LC\s*WAIKIKI/,/15\s*TEMMUZ/,/GULBAHAR/,/\b41\b/,/34212/,/BAGCILAR/,/ISTANBUL/,/657\D*55\D*55/];
        if(urls.length&&urls.some(v=>v!=='lcwaikiki.com')||text&&parts.some(rx=>!rx.test(text))){status='MISMATCH';actual=[...(ex.companyAddresses||[]),...(ex.websites||[])];detail=lang==='en'?'The LCW company block/website differs from the standard.':'LCW firma bloğu/sitesi standarttan farklı.';}
      }
      if(r.id==='CARE_FIRE'){
        if(options.fireRequired===true&&ex.fireWarning==='ABSENT'&&complete){status='MISMATCH';detail=lang==='en'?'CP product group requires the fire warning; it is absent from the inspected label.':'CP ürün grubu ateş uyarısını gerektiriyor; incelenen etikette uyarı yok.';}
        else if(options.fireRequired==null&&ex.fireWarning!=='PRESENT'){status='REVIEW';detail=lang==='en'?'Fire-warning applicability could not be determined from CP product/age group.':'CP ürün/yaş grubundan ateş uyarısı gerekliliği belirlenemedi.';}
      }
      return {rule:'STD_'+r.id,ruleId:r.id,category:'STANDARD',status,assessmentStatus:status,severity:r.severity,expected:[r.expected[lang]],actual,detail:detail||(lang==='en'?'No readable evidence for this check.':'Bu kontrol için okunabilir kanıt yok.'),correction:issue&&issue.correction||'',aiVerdict:issue?'ISSUE':status==='MATCH'?'PASS':'UNCERTAIN',page:f&&f.page||null,bbox:f&&f.bbox||null,source:'LCW AI',standardType:type,standardPage:r.page,decision:'PENDING',comment:''};
    });
    parsed.filter(f=>f.ruleId==='VISUAL_PAGES'&&f.verdict==='ISSUE').forEach((f,i)=>result.push({rule:'STD_VISUAL_PAGES_'+i,ruleId:'VISUAL_PAGES',category:'STANDARD',status:'MISMATCH',assessmentStatus:'MISMATCH',expected:[],actual:[f.actual],detail:f.comment,correction:f.correction,page:f.page,bbox:f.bbox,source:'LCW AI',aiVerdict:'ISSUE',decision:'PENDING',standardType:type,standardPage:1}));
    return result;
  }
  function reviewStatus(checks){
    const ai=(Array.isArray(checks)?checks:[]).filter(c=>c.category==='AI_REVIEW');
    if(ai.length){
      const all=checks.filter(c=>['AI_REVIEW','ANNOTATION'].includes(c.category));
      if(all.some(c=>c.decision==='REJECTED'))return 'REJECTED';
      if(checks.some(c=>!['AI_REVIEW','ANNOTATION'].includes(c.category)&&c.status==='REVIEW'))return 'PENDING';
      return all.some(c=>c.decision==='APPROVED')&&all.every(c=>['APPROVED','NOT_APPLICABLE'].includes(c.decision))?'APPROVED':'PENDING';
    }
    const all=Array.isArray(checks)?checks:[],layout=all.filter(c=>['STANDARD','ANNOTATION'].includes(c.category));
    if(all.some(c=>c.status==='MISMATCH'&&c.category!=='STANDARD')||layout.some(c=>c.decision==='REJECTED'))return 'REJECTED';
    if(all.some(c=>c.status==='REVIEW'&&!['STANDARD','ANNOTATION'].includes(c.category)))return 'PENDING';
    return layout.some(c=>/^STD_(CARE|PRICE)_/.test(c.rule))&&layout.some(c=>c.decision==='APPROVED')&&layout.every(c=>['APPROVED','NOT_APPLICABLE'].includes(c.decision))?'APPROVED':'PENDING';
  }
  return {VERSION,SOURCES,LANGUAGES,rules:Object.freeze(rules),applicable,normalizeFinding,checks,guide,reviewStatus,focusedChecks,focusedGuide,focusedRules};
});
