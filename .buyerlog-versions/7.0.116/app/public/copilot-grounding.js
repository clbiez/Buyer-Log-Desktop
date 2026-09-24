(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCopilotGrounding=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     GROUNDING VALIDATOR

     Bu, sistemin "hallucination yok" iddiasını taşıyan tek mekanizmadır.

     Prompt'a "uydurma" yazmak bir garanti değildir; modelin ona uyup uymadığını
     ölçmez. Burada yapılan şey mekanik: LLM'in ürettiği metindeki HER sayı ve
     HER özel ad, deterministic sonucun içinde gerçekten var mı diye aranır.
     Bulunamayan tek bir değer varsa metin kullanıcıya GÖSTERİLMEZ; yerine
     yapılandırılmış sonuç ham hâliyle sunulur.

     Yani en kötü durumda kullanıcı daha az akıcı bir cevap alır — yanlış bir
     cevap değil. §12'nin gereği budur.
     =================================================================== */

  /* Sayı biçimleri Türkçe ve İngilizce arasında değişiyor: 4,82 / 4.82 /
     4.820,50 / 1 234,5. Karşılaştırma biçime değil DEĞERE bakmalı, yoksa doğru
     bir cevabı yanlış diye reddederiz. */
  function parseNumber(raw){
    let value=String(raw).replace(/\s| /g,'');
    const lastComma=value.lastIndexOf(','),lastDot=value.lastIndexOf('.');
    if(lastComma>-1&&lastDot>-1){
      // Sonda hangisi varsa ondalık ayırıcıdır; diğeri binlik.
      if(lastComma>lastDot)value=value.replace(/\./g,'').replace(',','.');
      else value=value.replace(/,/g,'');
    }else if(lastComma>-1){
      // Tek virgül: üç haneli grup ise binlik, değilse ondalık.
      value=/,\d{3}(\D|$)/.test(value)?value.replace(/,/g,''):value.replace(',','.');
    }
    const number=Number(value);
    return Number.isFinite(number)?number:null;
  }

  /* Metindeki DOĞRULANMASI GEREKEN sayılar.

     Ham rakam taraması işe yaramadı: gerçek modelle yapılan ilk denemede
     "S7 sezonunda" cümlesindeki 7, miktar sanılıp sonuçta aranmış ve DOĞRU bir
     cevap reddedilmişti. Sezon kodu, model kodu, MMYG gibi tanımlayıcılar rakam
     içerir ama bir büyüklük ifade etmez.

     Bu yüzden metin sözcüklere ayrılır ve yalnız BAŞTAN SONA sayı olan
     sözcükler doğrulanır: "4,82" sayıdır, "S7" değildir. Baştaki ve sondaki
     noktalama/para/yüzde işaretleri kırpılır ki "4,82." ve "%10,2" kaçmasın. */
  /* Satır başındaki madde/sıra işareti bir büyüklük değildir. Yalnız satırın
     EN BAŞINDA ve ardından boşluk gelen "12." / "3)" / "4-" biçimleri atılır. */
  function stripOrdinalMarkers(textValue){
    return String(textValue||'').split(/\r?\n/)
      // Satır başı sıralama: "1." / "- 2)"
      .map(line=>line.replace(/^(\s*(?:[-*+]\s*)?)\d+[.)-](?=\s)/,'$1'))
      /* Satır ortası sıralama: "… tespit edildi: 1) collection boş, 2) lfl boş."
         Yalnız iki nokta / noktalı virgül / virgül SONRASINDA ve en fazla iki
         haneli olanlar atılır. Böylece "(3) adet" ve "12 model" etkilenmez. */
      .map(line=>line.replace(/([:;,]\s)\d{1,2}[).](?=\s)/g,'$1'))
      .join('\n');
  }
  function numbersIn(textValue){
    const out=[];
    for(const rawToken of stripOrdinalMarkers(textValue).split(/\s+/)){
      /* Baştan yalnız noktalama/para/yüzde kırpılır, HARF KIRPILMAZ: "%10,2"
         sayıya inmeli ama "S7"nin S'si düşerse geriye 7 kalır ve tanımlayıcı
         yeniden miktar sanılır. Sondan harf kırpmak güvenli ("4,82USD"). */
      const token=rawToken.replace(/^[^\p{L}\d+-]+/u,'').replace(/[^\d]+$/,'');
      if(!token)continue;
      // Yalnız işaret, rakam ve ayırıcılardan oluşan sözcükler sayıdır.
      // Bu koşul "2026-09-02" gibi tarihleri de eler; tarih bir büyüklük değil.
      if(!/^[+-]?[\d.,]+$/.test(token))continue;
      const value=parseNumber(token);
      if(value!=null)out.push(value);
    }
    return out;
  }

  /* Sonuçtaki doğrulanabilir bütün sayılar, iç içe yapıları da gezerek. */
  function numbersOf(value,into=new Set()){
    if(value==null)return into;
    if(typeof value==='number'&&Number.isFinite(value)){into.add(value);return into;}
    if(Array.isArray(value)){value.forEach(item=>numbersOf(item,into));return into;}
    if(typeof value==='object'){Object.values(value).forEach(item=>numbersOf(item,into));return into;}
    return into;
  }

  function namesOf(value,into=new Set()){
    if(value==null)return into;
    if(typeof value==='string'){const trimmed=value.trim();if(trimmed)into.add(trimmed.toLocaleLowerCase('tr-TR'));return into;}
    if(Array.isArray(value)){value.forEach(item=>namesOf(item,into));return into;}
    if(typeof value==='object'){Object.values(value).forEach(item=>namesOf(item,into));return into;}
    return into;
  }

  /* Yuvarlama farkı hallucination değildir: 4.8231 → "4,82" doğru bir
     gösterimdir. Tolerans, sunum yuvarlamasını kabul edecek ama farklı bir
     sayıyı kabul etmeyecek kadar dar tutulur. */
  function matchesAny(candidate,allowed){
    for(const value of allowed){
      if(candidate===value)return true;
      const scale=Math.max(1,Math.abs(value));
      if(Math.abs(candidate-value)<=scale*0.005)return true;
      // Yüzde değerleri metinde bir ondalıkla yazılabilir (10,2 ↔ 10.23).
      if(Math.abs(Math.round(candidate*10)-Math.round(value*10))===0)return true;
    }
    return false;
  }

  /* Metinde geçen ve doğrulanması gereken özel adlar. Bütün kelimeleri
     doğrulamak anlamsız olurdu ("fiyat", "ortalama" sonuçta geçmez); yalnız
     sonuçta İSİM olarak taşınan değerlere benzeyen parçalara bakılır. */
  function isHeadingLine(line){
    const text=String(line||'').trim();
    if(!text)return false;
    if(/^#{1,6}\s/.test(text))return true;                 // ## Bulgular
    if(/^\*\*[^*]+\*\*:?$/.test(text))return true;          // **Önerilen Aksiyon**
    if(text.length<=60&&/:$/.test(text)&&!/\s\d/.test(text))return true; // Kısa etiket satırı
    return false;
  }
  /* Para birimi, ölçü ve yaygın kısaltmalar iş ADI değildir. Tamamı büyük
     harf olduğu için isim sanılıyor ve her fiyat cevabını düşürüyorlardı.
     Liste KAPALI ve kısa: gerçek bir tedarikçi kodunu yanlışlıkla aklamasın. */
  /* Ticaret terimlerinin AÇILIMLARI bir iş varlığı değil, sözlüktür. Model
     "FOB" yerine "Free On Board" yazdığında bu uydurma bir tedarikçi adı
     değildir; ama denetçi bunu bilemez ve cevabı tümden düşürüyordu.
     Liste KAPALI ve yalnız bilinen terim açılımlarını içerir. */
  var GLOSSARY_PHRASES=new Set([
    // Uygulamanın ve ekranlarının kendi adları bir veri değeri değildir;
    // araç sonucunda aranmaları anlamsız ve her cevabı düşürüyorlardı.
    "buyer log","cp tracker","agent workflow studio","shipping comparison",
    "free on board","cost insurance and freight","cubic meter","chargeable weight",
    "like for like","like-for-like","ex factory","ex-factory","in store","in-store",
    "product lifecycle management","order code","model name","buying group",
    "open costing","shipping comparison","price analysis","lead time","landed cost"
  ]);
  var NON_ENTITY_TOKENS=new Set([
    "usd","eur","try","tl","gbp","cny","bdt","inr",
    "fob","cif","cbm","kg","pcs","adet","plm","cp","lfl","asas","ias","opd","mag","mmyg",
    "ok","tr","en","id","api","ai","url"
  ]);
  function suspiciousNames(textValue,allowedNames){
    const prose=String(textValue||'').split(/\r?\n/).filter(line=>!isHeadingLine(line)).join('\n');
    const candidates=prose.match(/\b[\p{Lu}][\p{L}&.'-]*(?:\s+[\p{Lu}][\p{L}&.'-]*)*/gu)||[];
    const misses=[];
    for(const candidate of candidates){
      /* Aday deseni nokta/tire/kesme içerdiği için cümle sonundaki noktalama
         kısaltmaya yapışıyor ("USD." / "FOB.") ve sözlük eşleşmesini bozuyordu.
         Sondaki noktalama atılır; ortadakiler korunur (Ltd.Şti. bozulmasın).*/
      const normalized=candidate.trim().replace(/[.'-]+$/,'').toLocaleLowerCase('tr-TR');
      if(normalized.length<3)continue;
      // Cümle başı sıradan kelimeleri elemek için: yalnız çok kelimeli ya da
      // tamamı büyük harf olan adaylar (ABC Tekstil, XYZ) isim sayılır.
      const looksLikeName=candidate.includes(' ')||candidate===candidate.toLocaleUpperCase('tr-TR');
      if(!looksLikeName)continue;
      if(NON_ENTITY_TOKENS.has(normalized))continue;
      if(GLOSSARY_PHRASES.has(normalized))continue;
      if(allowedNames.has(normalized))continue;
      if([...allowedNames].some(name=>name.includes(normalized)||normalized.includes(name)))continue;
      misses.push(candidate.trim());
    }
    return misses;
  }

  /* Cevabı gönderilmeden önce denetler.
     ok=false ise metin KULLANILMAZ; çağıran yapılandırılmış sonuca döner. */
  var PLACEHOLDER_PATTERNS=[
    /\[[^\]\n]{1,60}\]/,                 // [Üretici A], [MODEL], [X]
    /<[A-Za-z_][A-Za-z0-9_ ]{0,40}>/,      // <supplier>
    /\{\{[^}\n]{1,40}\}\}/,               // {{value}}
    /(?:^|\s)\$[XYZN](?![\p{L}\d])/u,     // $X, $Y
    /\b(?:XXX|YYY|TBD|N\/A tablo)\b/i,
  ];
  function placeholdersIn(textValue){
    const text=String(textValue||'');
    return PLACEHOLDER_PATTERNS.filter(function(pattern){return pattern.test(text);}).length>0;
  }
  function validate(answerText,result){
    // numbersIn kendi içinde sıra işaretlerini eler; başka bir ön işleme yok.
    const problems=[];
    if(!result||typeof result!=='object')return {ok:false,problems:['Doğrulanacak yapılandırılmış sonuç yok.']};
    if(result.answerable===false)return {ok:false,problems:['Sonuç cevaplanabilir değil; açıklama üretilmemeli.']};

    const allowedNumbers=numbersOf(result);
    const allowedNames=namesOf(result);
    /* Kullanıcının sorusundaki değerler de kabul edilir: onları geri söylemek
       uydurmak değil, teyit etmektir. Yalnız KULLANICI metni — araç verisi
       untrusted olduğu için buraya girmez. */
    if(result.question){
      numbersIn(result.question).forEach(function(value){allowedNumbers.add(value);});
      namesOf(String(result.question),allowedNames);
    }

    if(placeholdersIn(answerText)){
      problems.push('Cevap yer tutucu içeriyor; gerçek veri yerine şablon üretilmiş.');
    }
    for(const candidate of numbersIn(answerText)){
      if(!matchesAny(candidate,allowedNumbers))problems.push(`Sonuçta bulunmayan sayı: ${candidate}`);
    }
    for(const name of suspiciousNames(answerText,allowedNames)){
      problems.push(`Sonuçta bulunmayan ad: ${name}`);
    }
    return {ok:problems.length===0,problems};
  }

  return {validate,numbersIn,numbersOf,namesOf,parseNumber,suspiciousNames};
});
