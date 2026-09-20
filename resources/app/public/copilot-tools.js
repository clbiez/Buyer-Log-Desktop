(function(root,factory){
  const api=factory(
    typeof require==='function'?require('./collection-analytics-engine.js'):root.BLCollectionAnalyticsEngine,
    typeof require==='function'?require('./canonical-fields.js'):root.BLCanonicalFields
  );
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCopilotTools=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(engine,canonical){
  'use strict';

  /* ===================================================================
     BUYER COPILOT — DETERMINISTIC TOOL KATMANI

     Bu katman iş gerçeğini ÜRETEN tek yerdir. LLM buradan çıkan yapılandırılmış
     sonucu yalnız doğal dile çevirir; sayı, sıralama ya da isim uyduramaz.

     Hesabın kendisi yeniden yazılmadı: sıralama, klasman ortalaması, delta ve
     kapsam sayıları zaten collection-analytics-engine'de var ve Price & Supplier
     Analysis ekranında kullanılıyor. Copilot aynı motoru çağırır — böylece
     ekranda görünen sayı ile Copilot'ın söylediği sayı ayrışamaz.

     Bu katmanın motora EKLEDİĞİ şey, cevap vermeden önce sorulması gereken
     sorulardır: kapsam içinde mi, yetki var mı, yeterli veri var mı, para birimi
     karşılaştırılabilir mi, veri ne kadar taze.
     =================================================================== */

  /* Her sorgu bu durumlardan birine düşer. "Veri yok" ile "bu kapsamda
     görünmüyor" ayrı durumlardır; kullanıcıya farklı şey söylerler. */
  const STATES=Object.freeze({
    ANSWERABLE:'ANSWERABLE',
    NO_DATA:'NO_DATA',
    INSUFFICIENT_DATA:'INSUFFICIENT_DATA',
    OUT_OF_HORIZON:'OUT_OF_HORIZON',
    AMBIGUOUS:'AMBIGUOUS',
    CONFLICTING_DATA:'CONFLICTING_DATA',
    STALE_DATA:'STALE_DATA',
    MISSING_BINDING:'MISSING_BINDING',
    SCHEMA_DRIFT:'SCHEMA_DRIFT',
    PERMISSION_DENIED:'PERMISSION_DENIED',
    TOOL_ERROR:'TOOL_ERROR',
  });

  /* Bir tedarikçiyi "en uygun" ilan etmek için gereken asgari kanıt. Tek fiyat
     kaydından genelleme yapmak §57'de açıkça yasak; motor da tek fiyatlı sınıfı
     zaten karşılaştırma tabanı saymıyor. */
  const MIN_PRICE_RECORDS=3;
  const MIN_SUPPLIERS=2;
  /* Bu yaşın üstündeki veri hâlâ kullanılır ama cevapta yaşı söylenir. */
  const STALE_AFTER_MS=12*60*60*1000;

  const text=value=>String(value==null?'':value).trim();
  const lower=value=>text(value).toLocaleLowerCase('tr-TR');

  function fail(state,message,extra={}){
    return {state,answerable:false,message,...extra};
  }

  /* ------------------------------------------------------------------ SCOPE */

  /* Kapsam canonical kimlikler üzerinden çözülür; görünen sütun başlığına göre
     DEĞİL. Binding yoksa fuzzy eşleştirmeye düşmek yerine MISSING_BINDING
     döner — yanlış sütundan üretilmiş bir fiyat, cevap vermemekten kötüdür. */
  function resolveScope(request={},registry){
    const source=registry||canonical;
    const scope={},missing=[];
    for(const [key,canonicalId] of [['season','season'],['product','productMainDefinition'],['manufacturer','manufacturer']]){
      const value=text(request[key]);
      if(!value)continue;
      const binding=source&&typeof source.field==='function'?source.field(canonicalId):null;
      if(!binding){missing.push(canonicalId);continue;}
      scope[key]={canonicalId,value};
    }
    if(missing.length)return fail(STATES.MISSING_BINDING,
      `Şu ortak alanlar için canonical tanım bulunamadı: ${missing.join(', ')}.`,{missing});
    return {state:STATES.ANSWERABLE,answerable:true,scope};
  }

  /* ------------------------------------------------------------------ HORIZON */

  /* Horizon dışındaki bir sezon için, Horizon İÇİNDEKİ verilerden tahmin
     üretmek §14'ün açıkça yasakladığı şey. Hesaplama başlamadan önce durulur ve
     kullanıcıya geçici kapsam teklif edilir. */
  function checkHorizon(scope,horizon={}){
    const season=scope&&scope.season&&text(scope.season.value);
    if(!season)return {inHorizon:true,temporary:false};
    if(horizon.bounded===false)return {inHorizon:true,temporary:false};
    const covered=(Array.isArray(horizon.seasons)?horizon.seasons:[]).map(lower);
    if(!covered.length)return {inHorizon:true,temporary:false};
    if(covered.includes(lower(season)))return {inHorizon:true,temporary:false};
    if(horizon.temporaryScope&&lower(horizon.temporaryScope)===lower(season)){
      // Kullanıcı bu sorgu için açıkça izin verdi; kalıcı Horizon değişmedi.
      return {inHorizon:true,temporary:true};
    }
    return {inHorizon:false,temporary:false,season,covered:horizon.seasons};
  }

  /* ------------------------------------------------------------------ COVERAGE */

  /* Sonucun ne kadar veriye dayandığı, sonucun kendisi kadar önemlidir (§17).
     "En düşük fiyat" tek modele dayanıyorsa bunu söylemeden vermek yanıltıcı. */
  function coverageOf(stats){
    return {
      modelCount:stats.modelCount||0,
      priceRecordCount:stats.priceCount||0,
      recordCount:stats.recordCount||0,
      manufacturerCount:stats.manufacturerCount||0,
      outlierCount:stats.outlierCount||0,
    };
  }

  /* Para birimi.

     Karışık para birimi bu veride İSTİSNA DEĞİL, norm: köprü ülkeye bakıp
     Türkiye'ye TRY, diğerlerine USD atıyor. Dolayısıyla "karışıksa reddet"
     kuralı gerçek kullanımda neredeyse her soruyu reddederdi.

     Uydurma bir çevrim de yapılmaz: Price & Supplier Analysis motorunun kendisi
     çevirmiyor, farklı para birimleri arasındaki farkı hesaplamayı engelliyor
     (sameCurrency koruması). Copilot'ın oradan ayrılması, ekranda görünmeyen
     bir sayı üretmek olurdu.

     Yapılan şey: EN ÇOK FİYAT KAYDI olan para biriminde karşılaştır, hangisinde
     karşılaştırıldığını ve neyin dışarıda kaldığını açıkça söyle. Cevap
     verilebilir hâle gelir ve hiçbir şey gizlenmez. */
  function currencyOf(observations){
    const counts=new Map();
    for(const item of observations){
      const key=text(item.currency);
      const price=Number(item.price);
      if(!key||!Number.isFinite(price)||price<=0)continue;
      counts.set(key,(counts.get(key)||0)+1);
    }
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const currencies=ranked.map(([key])=>key);
    return {
      currencies,
      mixed:currencies.length>1,
      currency:ranked.length?ranked[0][0]:null,
      counts:Object.fromEntries(ranked),
      excluded:currencies.slice(1),
      excludedRecordCount:ranked.slice(1).reduce((sum,[,count])=>sum+count,0),
    };
  }

  function freshnessOf(freshness={}){
    const at=Date.parse(freshness.lastRefreshAt||'');
    if(!Number.isFinite(at))return {known:false,stale:false};
    const ageMs=Date.now()-at;
    return {known:true,ageMs,stale:ageMs>STALE_AFTER_MS,lastRefreshAt:new Date(at).toISOString(),source:text(freshness.source)||null};
  }

  /* ------------------------------------------------------------------ KAPSAM SÜZGECİ */

  /* Kapsamın kayıtlara UYGULANMASI.

     Bu, ilk sürümde eksikti ve sessiz bir yanlış üretiyordu: "S7 T-Shirt için en
     uygun üretici" sorusunda kapsam yalnız Horizon kontrolünde ve kanıt
     panelinde kullanılıyor, hesap ise TÜM sezon ve TÜM ürünler üzerinden
     yapılıyordu. Kullanıcı "Sezon: S7 · Ürün: T-Shirt" yazan bir kanıt
     panelinin yanında, bambaşka bir kümeden gelen bir fiyat görüyordu.
     Kendinden emin ve yanlış — yani cevap vermemekten kötü.

     Eşleşme TAM eşitliktir, içerme değil: "Shirt" kapsamı "T-Shirt" kayıtlarını
     toplasaydı aynı sınıf hatası başka kılıkta geri gelirdi. */
  const SCOPE_FIELDS={season:'season',product:'classification',manufacturer:'manufacturer'};

  function applyScope(observations,scope){
    return observations.filter(item=>Object.keys(SCOPE_FIELDS).every(key=>{
      const wanted=scope[key]&&text(scope[key].value);
      return !wanted||lower(item&&item[SCOPE_FIELDS[key]])===lower(wanted);
    }));
  }

  function scopeLabel(scope){
    const parts=Object.keys(SCOPE_FIELDS).map(key=>scope[key]&&text(scope[key].value)).filter(Boolean);
    return parts.length?parts.join(' · '):'seçili kapsam';
  }

  /* ------------------------------------------------------------------ ORTAK KAPI */

  /* Her aracın cevap vermeden ÖNCE geçmesi gereken kapı: yetki, canonical
     binding, Horizon, kapsam süzgeci, para birimi ve tazelik. Tek yerde
     durduğu için yeni bir araç eklemek bu güvencelerden birini atlayamaz —
     araçlar çoğaldıkça asıl risk budur. */
  function prepare(request={},options={}){
    const {observations=[],horizon={},freshness={},permission={allowed:true}}=request;

    if(permission.allowed===false){
      return fail(STATES.PERMISSION_DENIED,
        permission.reason||'Bu veri için yetkiniz bulunmuyor.');
    }

    const resolved=resolveScope(request.scope||{});
    if(!resolved.answerable)return resolved;
    const scope=resolved.scope;

    const horizonCheck=checkHorizon(scope,horizon);
    if(!horizonCheck.inHorizon){
      return fail(STATES.OUT_OF_HORIZON,
        `${horizonCheck.season} mevcut Horizon kapsamınızda değil; bu nedenle güvenilir bir sonuç üretemiyorum.`,
        {season:horizonCheck.season,covered:horizonCheck.covered,canOfferTemporaryScope:true});
    }

    if(!observations.length){
      return fail(STATES.NO_DATA,'Bu kapsamda hiç fiyat kaydı bulunamadı.',{scope});
    }

    const scoped=applyScope(observations,scope);
    if(!scoped.length){
      /* "Hiç veri yok" ile "bu kapsamda yok" ayrı şeylerdir; kaç kayda
         bakıldığını söylemek kullanıcıya kapsamı düzeltme imkânı verir. */
      return fail(STATES.NO_DATA,
        `${scopeLabel(scope)} kapsamında hiç kayıt bulunamadı (${observations.length} kayıt tarandı).`,
        {scope,searchedRecordCount:observations.length});
    }

    const currency=currencyOf(scoped);
    if(!currency.currency){
      return fail(STATES.NO_DATA,`${scopeLabel(scope)} kapsamında geçerli fiyat kaydı bulunamadı.`,{scope});
    }
    /* Tek para birimi içinde karşılaştırılır; çevrim YAPILMAZ. Dışarıda kalan
       kayıtlar cevapta ve dayanakta açıkça söylenir. */
    const comparable=scoped.filter(item=>text(item.currency)===currency.currency);

    const records=engine.markOutliers(comparable);
    const overall=engine.stats(records);
    const coverage=coverageOf(overall);

    const minRecords=options.minPriceRecords==null?MIN_PRICE_RECORDS:options.minPriceRecords;
    const minSuppliers=options.minSuppliers==null?0:options.minSuppliers;
    if(coverage.priceRecordCount<minRecords||coverage.manufacturerCount<minSuppliers){
      return fail(STATES.INSUFFICIENT_DATA,
        `Güvenilir bir sonuç için yeterli fiyat verisi yok (${coverage.priceRecordCount} fiyat kaydı, ${coverage.manufacturerCount} üretici).`,
        {coverage,scope});
    }

    const freshnessState=freshnessOf(freshness);
    return {
      answerable:true,
      state:freshnessState.stale?STATES.STALE_DATA:STATES.ANSWERABLE,
      scope,scopeLabel:scopeLabel(scope),
      temporaryScope:horizonCheck.temporary,
      records,stats:overall,coverage,currency,freshness:freshnessState,
      provenance:{
        module:'Price & Supplier Analysis',
        engine:'collection-analytics-engine',
        canonicalFields:Object.values(scope).map(item=>item.canonicalId),
        scopedRecordCount:scoped.length,
        searchedRecordCount:observations.length,
        recordCount:coverage.recordCount,
        priceRecordCount:coverage.priceRecordCount,
        outlierCount:coverage.outlierCount,
        sourceRevision:text(request.sourceRevision)||null,
      },
    };
  }

  /* Kapıdan geçen ortak alanları cevaba taşır; her araç aynı iskeleti
     döndürsün diye. */
  function answer(base,extra){
    return {
      state:base.state,answerable:true,
      scope:base.scope,temporaryScope:base.temporaryScope,
      currency:base.currency.currency,
      /* Başka para biriminde kayıt varsa gizlenmez: kullanıcı neyin
         karşılaştırılmadığını bilmeli (§17, §23). */
      excludedCurrencies:base.currency.excluded,
      excludedRecordCount:base.currency.excludedRecordCount,
      coverage:base.coverage,
      freshness:base.freshness,
      provenance:base.provenance,
      ...extra,
    };
  }

  /* ------------------------------------------------------------------ TOOL */

  /* En uygun fiyatı veren tedarikçi. Dönen nesne kendi kendini açıklar:
     her sayı, hangi kayıt kümesinden ve hangi kapsamdan geldiğiyle birlikte
     taşınır (§25, §26). LLM'e verilecek olan da budur. */
  function bestSupplierPrice(request={}){
    const base=prepare(request,{minSuppliers:MIN_SUPPLIERS});
    if(!base.answerable)return base;

    // Sıralama, klasman ortalaması ve delta motorun kendi hesabı.
    const ranked=engine.benchmark(base.records)
      .filter(entry=>entry.stats.median!=null)
      .sort((a,b)=>a.stats.median-b.stats.median||b.stats.priceCount-a.stats.priceCount||a.name.localeCompare(b.name,'tr'))
      .map((entry,index)=>({
        rank:index+1,
        manufacturer:entry.name,
        medianPrice:entry.stats.median,
        averagePrice:entry.stats.average,
        classBenchmark:entry.classBenchmark,
        deltaPercent:entry.delta,
        status:entry.status,
        coverage:coverageOf(entry.stats),
      }));

    if(!ranked.length){
      return fail(STATES.INSUFFICIENT_DATA,'Fiyatı olan üretici bulunamadı.',
        {coverage:base.coverage,scope:base.scope});
    }

    return answer(base,{question:'bestSupplierPrice',best:ranked[0],ranking:ranked});
  }

  /* Kapsamın fiyat özeti. "Ortalama kaç?" sorusu tek bir üretici seçmediği için
     iki tedarikçi şartı aranmaz; ama tek kayıttan ortalama üretmek de yanıltıcı
     olurdu, o yüzden asgari kayıt eşiği aynen geçerli. */
  function priceSummary(request={}){
    const base=prepare(request);
    if(!base.answerable)return base;
    const stats=base.stats;
    return answer(base,{
      question:'priceSummary',
      summary:{
        median:stats.median,average:stats.average,weightedAverage:stats.weightedAverage,
        min:stats.min,max:stats.max,p25:stats.p25,p75:stats.p75,
        /* Yayılım, ortalamanın tek başına anlatmadığı şeyi anlatır: aynı
           ortalama, dar ya da çok geniş bir fiyat aralığından gelebilir. */
        spreadPercent:stats.median>0&&stats.min!=null&&stats.max!=null
          ? (stats.max-stats.min)/stats.median*100 : null,
        totalQuantity:stats.totalQuantity,
      },
    });
  }

  /* Üretim yoğunlaşması — tedarik riski. Payı model sayısına göre motor
     hesaplar; burada eklenen tek şey, tek üretici varsa bunun bir "yoğunlaşma
     bulgusu" değil kapsamın kendisi olduğunun söylenmesidir. */
  function supplierConcentration(request={}){
    const base=prepare(request,{minPriceRecords:0});
    if(!base.answerable)return base;
    const shares=engine.concentration(base.records,'manufacturer')
      .filter(entry=>entry.name&&entry.name!=='—')
      .map(entry=>({manufacturer:entry.name,sharePercent:entry.share,
        modelCount:entry.stats.modelCount,recordCount:entry.stats.recordCount,
        medianPrice:entry.stats.median}));
    if(!shares.length){
      return fail(STATES.NO_DATA,`${base.scopeLabel} kapsamında üretici bilgisi olan kayıt yok.`,{scope:base.scope});
    }
    if(shares.length<2){
      return fail(STATES.INSUFFICIENT_DATA,
        `${base.scopeLabel} kapsamında tek üretici var (${shares[0].manufacturer}); yoğunlaşma karşılaştırması yapılamaz.`,
        {scope:base.scope,shares});
    }
    return answer(base,{
      question:'supplierConcentration',
      shares,
      topShare:shares[0],
      // Herfindahl: 0–10000. Yorumu kullanıcıya bırakılır, eşik uydurulmaz.
      herfindahl:shares.reduce((sum,item)=>sum+item.sharePercent*item.sharePercent,0),
    });
  }

  /* Sapan fiyatlar. Sapmanın TANIMI motorun kendi çeyrekler-arası aralık
     hesabıdır; Copilot kendi eşiğini uydurmaz. */
  function priceOutliers(request={}){
    const base=prepare(request);
    if(!base.answerable)return base;
    const median=base.stats.median;
    const outliers=base.records.filter(item=>item.isOutlier)
      .map(item=>({
        manufacturer:text(item.manufacturer)||null,
        classification:text(item.classification)||null,
        season:text(item.season)||null,
        modelKey:text(item.modelKey||item.rowId)||null,
        price:Number(item.price),
        deviationPercent:median>0?(Number(item.price)-median)/median*100:null,
      }))
      .sort((a,b)=>Math.abs(b.deviationPercent||0)-Math.abs(a.deviationPercent||0));
    if(!outliers.length){
      /* Sapan kayıt olmaması bir cevapsızlık değil, cevabın kendisidir. */
      return answer(base,{question:'priceOutliers',outliers:[],median,clean:true});
    }
    return answer(base,{question:'priceOutliers',outliers,median,clean:false});
  }

  /* İki üreticiyi karşılaştırma. Adları KULLANICI verir; kayıtlarda yoksa
     uydurulmaz, yok denir. */
  function compareSuppliers(request={}){
    const wanted=(Array.isArray(request.manufacturers)?request.manufacturers:[]).map(text).filter(Boolean);
    if(wanted.length<2){
      return fail(STATES.AMBIGUOUS,'Karşılaştırma için iki üretici adı gerekiyor.');
    }
    const base=prepare(request,{minPriceRecords:0});
    if(!base.answerable)return base;

    const groups=engine.benchmark(base.records);
    const found=[],missing=[];
    for(const name of wanted){
      const entry=groups.find(item=>lower(item.name)===lower(name));
      if(!entry||entry.stats.median==null){missing.push(name);continue;}
      found.push({manufacturer:entry.name,medianPrice:entry.stats.median,averagePrice:entry.stats.average,
        classBenchmark:entry.classBenchmark,deltaPercent:entry.delta,status:entry.status,
        coverage:coverageOf(entry.stats)});
    }
    if(missing.length){
      return fail(STATES.NO_DATA,
        `${base.scopeLabel} kapsamında şu üretici(ler) için fiyat kaydı yok: ${missing.join(', ')}.`,
        {scope:base.scope,missing,found:found.map(item=>item.manufacturer)});
    }
    const sorted=[...found].sort((a,b)=>a.medianPrice-b.medianPrice);
    const gap=sorted[0].medianPrice>0
      ? (sorted[sorted.length-1].medianPrice-sorted[0].medianPrice)/sorted[0].medianPrice*100 : null;
    return answer(base,{question:'compareSuppliers',compared:found,cheapest:sorted[0],gapPercent:gap});
  }

  /* Sezonlar arası seyir. En az iki sezon gerekir: tek sezondan "trend"
     çıkarmak, olmayan bir şeyi söylemektir. Sezon kapsamı verilmişse süzgeç
     zaten tek sezona indirir; bu yüzden bu araç sezonu kapsamdan DÜŞÜRÜR. */
  function seasonTrend(request={}){
    const scope={...(request.scope||{})};
    delete scope.season;
    const base=prepare({...request,scope},{minPriceRecords:0});
    if(!base.answerable)return base;

    const bySeason=engine.aggregate(base.records,'season',{metric:'median'})
      .filter(entry=>entry.name&&entry.name!=='—'&&entry.stats.median!=null)
      .sort((a,b)=>a.name.localeCompare(b.name,'tr',{numeric:true,sensitivity:'base'}))
      .map(entry=>({season:entry.name,medianPrice:entry.stats.median,
        recordCount:entry.stats.recordCount,priceCount:entry.stats.priceCount,
        manufacturerCount:entry.stats.manufacturerCount}));
    if(bySeason.length<2){
      return fail(STATES.INSUFFICIENT_DATA,
        `Seyir için en az iki sezon gerekiyor; bu kapsamda ${bySeason.length} sezon var.`,
        {scope:base.scope,seasons:bySeason.map(item=>item.season)});
    }
    const first=bySeason[0],last=bySeason[bySeason.length-1];
    return answer(base,{
      question:'seasonTrend',
      seasons:bySeason,
      changePercent:first.medianPrice>0?(last.medianPrice-first.medianPrice)/first.medianPrice*100:null,
      from:first,to:last,
    });
  }

  /* ------------------------------------------------------------- CP TRACKER */

  /* CP, Price & Supplier Analysis'tan farklı bir gerçekliktir: burada soru
     fiyat değil, kullanıcının ekranda gördüğü yükleme terminleri ve adetler
     üzerindedir. Bu yüzden fiyat gözlemlerine sessizce düşülmez. */
  const CP_SCOPE_FIELDS={season:'season',manufacturer:'manufacturer',buyer:'buyer',category:'category',orderStatus:'orderStatus'};

  function resolveCpScope(request={}){
    const scope={},missing=[];
    for(const [key,canonicalId] of Object.entries(CP_SCOPE_FIELDS)){
      const value=text(request[key]);
      if(!value)continue;
      const binding=canonical&&typeof canonical.bindingFor==='function'
        ?canonical.bindingFor('cp',canonicalId):null;
      if(!binding){missing.push(canonicalId);continue;}
      scope[key]={canonicalId,value};
    }
    if(missing.length)return fail(STATES.MISSING_BINDING,
      `CP için şu ortak alanların binding tanımı bulunamadı: ${missing.join(', ')}.`,{missing});
    return {state:STATES.ANSWERABLE,answerable:true,scope};
  }

  function cpValue(row,id){
    return canonical&&typeof canonical.value==='function'
      ?canonical.value(row,'cp',id):undefined;
  }

  function cpText(row,id){return text(cpValue(row,id));}

  function cpNumber(value){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const raw=text(value).replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
    if(!raw)return null;
    const n=Number(raw);return Number.isFinite(n)?n:null;
  }

  function dateOnly(value){
    if(value instanceof Date){
      if(!Number.isFinite(value.getTime()))return null;
      return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    }
    if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<100000){
      const date=new Date(1899,11,30);date.setDate(date.getDate()+value);return dateOnly(date);
    }
    const raw=text(value);if(!raw)return null;
    let match=/^(\d{4})(\d{2})(\d{2})/.exec(raw);
    if(match)return `${match[1]}-${match[2]}-${match[3]}`;
    match=/^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if(match)return `${match[1]}-${match[2]}-${match[3]}`;
    match=/^(\d{2})[./-](\d{2})[./-](\d{4})/.exec(raw);
    if(match)return `${match[3]}-${match[2]}-${match[1]}`;
    const parsed=new Date(raw);
    return Number.isFinite(parsed.getTime())?dateOnly(parsed):null;
  }

  function dateKey(value){return dateOnly(value)||'';}

  function localDate(year,month,day){return new Date(year,month,day,12,0,0,0);}

  function periodFor(nowValue,periodKey){
    const nowDate=nowValue instanceof Date&&Number.isFinite(nowValue.getTime())
      ?new Date(nowValue.getFullYear(),nowValue.getMonth(),nowValue.getDate(),12,0,0,0)
      :(()=>{const key=dateOnly(nowValue)||dateOnly(new Date());const [y,m,d]=key.split('-').map(Number);return localDate(y,m-1,d);})();
    const day=nowDate.getDay(),mondayOffset=day===0?-6:1-day;
    let start,end,label;
    switch(String(periodKey||'')){
      case 'thisWeek':start=localDate(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate()+mondayOffset);end=localDate(start.getFullYear(),start.getMonth(),start.getDate()+6);label='Bu hafta';break;
      case 'nextWeek':start=localDate(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate()+mondayOffset+7);end=localDate(start.getFullYear(),start.getMonth(),start.getDate()+6);label='Gelecek hafta';break;
      case 'today':start=nowDate;end=nowDate;label='Bugün';break;
      case 'tomorrow':start=localDate(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate()+1);end=start;label='Yarın';break;
      case 'thisMonth':start=localDate(nowDate.getFullYear(),nowDate.getMonth(),1);end=localDate(nowDate.getFullYear(),nowDate.getMonth()+1,0);label='Bu ay';break;
      case 'nextMonth':start=localDate(nowDate.getFullYear(),nowDate.getMonth()+1,1);end=localDate(nowDate.getFullYear(),nowDate.getMonth()+2,0);label='Gelecek ay';break;
      case 'past':start=null;end=localDate(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate()-1);label='Geçmiş';break;
      default:return null;
    }
    return {key:String(periodKey),start:start?dateKey(start):null,end:dateKey(end),label};
  }

  function cpScopeMatches(row,scope){
    return Object.entries(CP_SCOPE_FIELDS).every(([key])=>{
      const wanted=scope[key]&&text(scope[key].value);if(!wanted)return true;
      return lower(cpValue(row,scope[key].canonicalId))===lower(wanted);
    });
  }

  function sumKnown(rows,id){
    return rows.reduce((sum,row)=>{const value=cpNumber(cpValue(row,id));return sum+(value==null?0:value);},0);
  }

  function cpOperations(request={}){
    const rows=Array.isArray(request.cpRows)?request.cpRows:[];
    const intent=request.intent||{};
    const countMode=intent.kind==='modelCount';
    const period=countMode&&!intent.period
      ?{key:'all',start:null,end:null,label:'Tüm CP kayıtları'}
      :periodFor(request.now||new Date(),intent.period);
    if(!period)return fail(STATES.AMBIGUOUS,'CP yükleme sorusu için geçerli bir dönem gerekiyor.');
    const resolved=resolveCpScope(request.scope||{});
    if(!resolved.answerable)return resolved;
    const scope=resolved.scope;
    if(!rows.length)return fail(STATES.NO_DATA,'CP Tracker verisi yüklenmedi; bu nedenle yükleme sonucu üretemiyorum.',{scope,needsCpLoad:true});

    const scoped=rows.filter(row=>cpScopeMatches(row,scope));
    const dated=scoped.map(row=>({row,date:dateKey(cpValue(row,'exFactory'))}));
    const datedRows=dated.filter(item=>item.date);
    const periodRows=countMode&&!intent.period?scoped:datedRows.filter(item=>
      (!period.start||item.date>=period.start)&&item.date<=period.end);
    const aggregationRows=countMode&&!intent.period?periodRows:periodRows.map(item=>item.row);
    const resultRows=countMode?[]:periodRows.sort((a,b)=>a.date.localeCompare(b.date)||
      cpText(a.row,'orderCode').localeCompare(cpText(b.row,'orderCode'),'tr',{numeric:true,sensitivity:'base'}))
      .map(({row,date})=>({
        orderCode:cpText(row,'orderCode')||null,modelName:cpText(row,'modelName')||null,
        manufacturer:cpText(row,'manufacturer')||null,season:cpText(row,'season')||null,
        exFactory:date,deliveryType:cpText(row,'deliveryType')||null,
        status:cpText(row,'orderStatus')||null,
        orderQuantity:cpNumber(cpValue(row,'orderQuantity')),
        shipmentQuantity:cpNumber(cpValue(row,'shipmentQuantity')),
        remainingUnits:cpNumber(cpValue(row,'remainingUnits')),
      }));
    const freshnessState=freshnessOf(request.freshness||{});
    const state=freshnessState.stale?STATES.STALE_DATA:STATES.ANSWERABLE;
    return {
      question:'cpOperations',operation:countMode?'modelCount':'shipments',answerable:true,state,scope,scopeLabel:scopeLabel(scope),period,
      rows:resultRows,
      summary:{orderCount:aggregationRows.length,
        modelCount:new Set(aggregationRows.map(row=>cpText(row,'modelName')).filter(Boolean)).size,
        orderQuantity:sumKnown(aggregationRows,'orderQuantity'),
        shipmentQuantity:sumKnown(aggregationRows,'shipmentQuantity'),
        remainingUnits:sumKnown(aggregationRows,'remainingUnits')},
      coverage:{recordCount:scoped.length,datedRecordCount:datedRows.length,
        undatedRecordCount:scoped.length-datedRows.length,matchedRecordCount:aggregationRows.length},
      freshness:freshnessState,
      provenance:{module:'CP Tracker',engine:'buyer-log-cp-operations',
        canonicalFields:['orderCode','modelName','manufacturer','season','exFactory','orderQuantity','shipmentQuantity','remainingUnits','deliveryType','orderStatus'],
        searchedRecordCount:rows.length,scopedRecordCount:scoped.length,
        sourceRevision:text(request.sourceRevision)||null},
    };
  }

  /* Asistanın GERÇEKTEN cevaplayabildikleri. Kullanıcıya "her şeyi bilirim"
     izlenimi vermek yerine sınırı açıkça göstermek için var: tanımadığı bir
     soruda uydurmak yerine bu listeyi sunar. Liste araçların kendisinden
     türer, elle yazılmaz — biri eklenip burada unutulamaz. */
  function capabilities(){
    return [
      {id:'cpOperations',tr:'CP model sayısı, yüklemeleri, tarihler, durum ve adet özeti',en:'CP model count, shipments, dates, status and quantity summary',
        example:{tr:"CP'de kaç model var?",en:'How many models are in CP?'}},
      {id:'bestSupplierPrice',tr:'En uygun fiyatı veren üretici',en:'Best-priced supplier',
        example:{tr:'S7 T-Shirt için en uygun üretici kim?',en:'Which supplier is cheapest for S7 T-Shirt?'}},
      {id:'priceSummary',tr:'Fiyat özeti (medyan, ortalama, aralık)',en:'Price summary (median, average, range)',
        example:{tr:'S7 T-Shirt fiyatları ne durumda?',en:'What do S7 T-Shirt prices look like?'}},
      {id:'compareSuppliers',tr:'İki üreticiyi karşılaştırma',en:'Compare two suppliers',
        example:{tr:'S7 T-Shirt için A ile B karşılaştır',en:'Compare A and B for S7 T-Shirt'}},
      {id:'supplierConcentration',tr:'Üretim yoğunlaşması (tedarik riski)',en:'Supplier concentration (sourcing risk)',
        example:{tr:'S7 T-Shirt üretimi hangi üreticide yoğunlaşmış?',en:'Where is S7 T-Shirt production concentrated?'}},
      {id:'priceOutliers',tr:'Sapan fiyatlar',en:'Price outliers',
        example:{tr:'S7 T-Shirt içinde sapan fiyat var mı?',en:'Any outlier prices in S7 T-Shirt?'}},
      {id:'seasonTrend',tr:'Sezonlar arası fiyat seyri',en:'Price trend across seasons',
        example:{tr:'T-Shirt fiyatları sezonlara göre nasıl değişmiş?',en:'How have T-Shirt prices moved across seasons?'}},
      {id:'automation.recipe.create',tr:'Otomasyon kurma',en:'Create an automation',
        example:{tr:'Her pazartesi 09:00 <grup> grubuna cpdeki geciken siparişleri hatırlat',
          en:'Every Monday 09:00 remind <group> about overdue CP orders'}},
      {id:'order.note.set',tr:'Sipariş notu güncelleme (onaylı)',en:'Update an order note (confirmed)',
        example:{tr:'12345 not: numune bekleniyor',en:'12345 note: waiting for sample'}},
      {id:'order.supplier.set',tr:'Sipariş üreticisi atama (onaylı)',en:'Assign an order supplier (confirmed)',
        example:{tr:'12345 üretici: ABC Tekstil',en:'12345 supplier: ABC Tekstil'}},
    ];
  }

  return {STATES,MIN_PRICE_RECORDS,MIN_SUPPLIERS,STALE_AFTER_MS,
    resolveScope,checkHorizon,coverageOf,currencyOf,freshnessOf,applyScope,prepare,capabilities,
    resolveCpScope,cpOperations,bestSupplierPrice,priceSummary,supplierConcentration,priceOutliers,compareSuppliers,seasonTrend};
});
