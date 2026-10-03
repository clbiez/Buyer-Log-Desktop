(function(global){
  'use strict';

  /* ===================================================================
     BUYER COPILOT — SAĞ ÇEKMECE

     Çizim sırası bilinçlidir: ÖNCE deterministic sonuç, SONRA (varsa) LLM
     açıklaması. Model yoksa, kapalıysa ya da ürettiği metin grounding'den
     geçemezse kullanıcı yine tam sonucu görür — yalnız düz cümle olmadan.
     Bu, §44'ün "LLM açıklaması bir zenginleştirmedir, iş sonucunun bağımlılığı
     değildir" kuralının UI'daki karşılığı.

     Panel lazy yüklenir ve hiçbir açılış işi üstlenmez (§46).
     =================================================================== */

  const tools=global.BLCopilotTools;
  const grounding=global.BLCopilotGrounding;
  const esc=value=>(typeof global.escapeHtml==='function'
    ? global.escapeHtml(String(value==null?'':value))
    : String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const lang=()=>(typeof global.appLang!=='undefined'&&global.appLang==='en')?'en':'tr';
  const t=(tr,en)=>lang()==='en'?en:tr;

  const num=(value,digits=2)=>Number(value).toLocaleString(lang()==='en'?'en-US':'tr-TR',
    {minimumFractionDigits:digits,maximumFractionDigits:digits});

  let root=null,aiState={status:'AI_NOT_INSTALLED',ok:false},busy=false,lastResult=null,pendingProposal=null;
  /* Gönderilmeyi bekleyen görsel ekler (§7). Yalnız BELLEKTE tutulur —
     konuşma geçmişine ya da localStorage'a hiç yazılmaz (bkz. kullanıcı
     talebi §14: iş verisi/ek gereksiz yere kalıcı hâle gelmemeli). Soru
     gönderilince ya da panel kapanınca temizlenir. */
  let pendingAttachments=[];
  const MAX_ATTACHMENTS=3;
  const ATTACHMENT_MAX_BYTES=6*1024*1024;
  const ATTACHMENT_ALLOWED_MIME=new Set(['image/png','image/jpeg','image/webp','image/gif']);

  /* KONUŞMA VE YERLEŞİM DEPOLARI
     Tembel kurulur: bu betik kullanıcı bağlamı hazır olmadan yüklenebiliyor
     ve kimliksiz kurulan bir depo kalıcı olmaz. İlk kullanımda kimlik artık
     bellidir. */
  let conversationStore=null,geometryStore=null,activeConversationId=null,jobQueue=null;
  /* Son sorulan soru. Giriş kutusu gönderince boşaldığı için "geçici kapsam"
     düğmesi soruyu artık kutudan okuyamaz. */
  let lastQuestion='';
  /* Zengin biçimde çizilen cevabın dizini. Geçmiş dökümü BU DİZİNE KADAR
     metin olarak çizilir; son cevap ise bugünkü zengin hâliyle kalır.
     Böylece kalıcılık, bugün çalışan gösterimden bir şey EKSİLTMEZ. */
  let richIndex=-1;

  function currentUserId(){
    const profile=(global.state&&global.state.currentUser)||global.BL_USER_CONTEXT||null;
    return profile&&profile.id!=null?String(profile.id).trim():'';
  }
  function safeLocalStorage(){
    /* Erişimin KENDİSİ fırlatabilir (site verisi kapalı, gizli sekme).
        Deneme burada yapılır ki depolar null ile kurulup bellek moduna
        düşsün, panel açılmayı denerken çökmesin. */
    try{ return global.localStorage||null; }catch(_){ return null; }
  }
  function conversations(){
    const api=global.BLOctopusConversations;
    if(!conversationStore&&api){
      conversationStore=api.createConversationStore({storage:safeLocalStorage(),userId:currentUserId()});
    }
    return conversationStore;
  }
  function geometry(){
    const api=global.BLOctopusWindow;
    if(!geometryStore&&api){
      geometryStore=api.createGeometryStore({
        storage:safeLocalStorage(),userId:currentUserId(),
        viewport:()=>({width:global.innerWidth||1280,height:global.innerHeight||800}),
      });
    }
    return geometryStore;
  }
  /* Aktif konuşma. Depo yoksa (modül yüklenmediyse) panel eski davranışına
     düşer: bellekte tek oturumluk bağlam. */
  function activeConversation(){
    const store=conversations();
    if(!store)return null;
    if(!activeConversationId||!store.get(activeConversationId)) activeConversationId=store.active().id;
    return store.get(activeConversationId);
  }
  /* Hedef konuşma AÇIKÇA verilebilir: arka planda koşan bir işin cevabı,
     kullanıcı o sırada başka bir konuşmaya geçmiş olsa bile SORULDUĞU
     konuşmaya yazılmalı. Aktif konuşmaya yazmak, cevabı yanlış yere
     koymak olurdu. */
  function recordMessage(role,content,conversationId){
    const store=conversations();
    const target=conversationId||(activeConversation()||{}).id;
    if(!store||!target||!store.get(target))return;
    store.append(target,{role,content});
  }

  /* Bir işin çizimi. İş BAŞKA bir konuşmaya aitse canlı alan yazılmaz —
     kullanıcı o an baktığı konuşmada başkasının cevabını görürdü. Döküm,
     liste ve rozet yine tazelenir, çünkü onlar depodan okuyor ve doğru
     konuşmayı gösteriyor. */
  function paintInto(conversationId,html){
    if(conversationId&&activeConversationId&&conversationId!==activeConversationId){
      renderThread();renderConversationList();renderJobs();return;
    }
    paint(html);
  }

  /* Kuyruk. Eşzamanlılık 1: model yerel çalışıyor ve tek GPU paylaşıyor;
     iki isteği aynı anda koşturmak ikisini de yavaşlatır, büyük modelde
     yükleme hatası verir (v9.27). Kuyruk paralellik için değil,
     KAYBETMEMEK için. */
  function jobs(){
    const api=global.BLOctopusJobs;
    if(!jobQueue&&api){
      jobQueue=api.createJobQueue({concurrency:1,run:runAsk,onChange:()=>renderJobs()});
    }
    return jobQueue;
  }
  let conversationHistory=[];

  /* Örnek sorular kalabalık değil: dört tane, hepsi bu dilimin gerçekten
     cevaplayabildiği sorular. Cevaplayamayacağı soruyu önermek güveni bozar. */
  /* Örnekler kullanıcının KENDİ verisinden kurulur. Sabit bir "T-Shirt"
     önermek, o klasmanı taşımayan bir kurulumda kullanıcıyı doğrudan
     "veri yok"a götürürdü — cevaplayamayacağın soruyu önermek güveni bozar. */
  function suggestionsFor(known){
    const product=known&&known[0];
    const season=(()=>{
      const seasons=horizon().seasons;
      return seasons&&seasons.length?seasons[seasons.length-1]:null;
    })();
    if(!product||!season)return [];
    /* Her örnek FARKLI bir aracı gösterir: kullanıcı asistanın yalnız tek bir
       soruyu cevapladığını sanmasın diye. Hepsi kullanıcının kendi sezonu ve
       kendi klasmanı üzerinden kurulur. */
    return [
      {tr:`${season}’de ${product} için en uygun fiyatı hangi üretici veriyor?`,
       en:`Which supplier has the best price for ${product} in ${season}?`},
      {tr:`${season} ${product} fiyatları ne durumda, ortalama kaç?`,
       en:`What do ${product} prices look like in ${season} — what is the average?`},
      {tr:`${season} ${product} üretimi hangi üreticide yoğunlaşmış?`,
       en:`Where is ${product} production concentrated in ${season}?`},
      {tr:`${product} fiyatları sezonlara göre nasıl değişmiş?`,
       en:`How have ${product} prices moved across seasons?`},
    ];
  }

  /* --------------------------------------------------------------- VERİ */

  /* Copilot'ın gördüğü veri, sunucunun bu kullanıcı için zaten süzüp
     gönderdiği veridir. Ayrı bir yetki katmanı yok; kullanıcının göremediği
     satır burada da yok (§11, ADR-001).

     Veri, Price & Supplier Analysis ekranının kullandığı KÖPRÜNÜN AYNISINDAN
     alınır. Kendi okuma yolunu kurmak, ekranda görünen fiyatla Copilot'ın
     söylediği fiyatın ayrışabilmesi demekti; canonicalPriceObservation
     normalizasyonu da atlanırdı. */
  async function observations(){
    const bridge=global.BLPriceSupplierAnalysisBridge;
    if(!bridge||typeof bridge.get!=='function')return [];
    const data=await bridge.get('collection','all','finalFob');
    return Array.isArray(data&&data.observations)?data.observations:[];
  }

  /* CP sorusu geldiğinde CP ekranının mevcut, yetkili önbelleği kullanılır.
     CP görünür değilse yalnız bu soru için lazy yüklenir; fiyat köprüsünden
     CP sonucu tahmin edilmez. */
  async function cpRows(){
    if(!Array.isArray(global.state&&global.state.cp&&global.state.cp.rows)
      &&typeof global.BLEnsureCpLoaded==='function'){
      await global.BLEnsureCpLoaded({deferRender:true});
    }
    return Array.isArray(global.state&&global.state.cp&&global.state.cp.rows)
      ?global.state.cp.rows:[];
  }

  function horizon(){
    const scopes=Array.isArray(global.state&&global.state.modelScopes)?global.state.modelScopes:[];
    const seasons=[...new Set(scopes.flatMap(item=>Array.isArray(item&&item.seasons)?item.seasons:[]).filter(Boolean))];
    return {seasons,bounded:seasons.length>0,temporaryScope:root&&root.dataset.temporaryScope||null};
  }

  function freshness(source='ASAS'){
    const status=global.sourceStatus&&global.sourceStatus.asas;
    return {lastRefreshAt:status&&status.at||null,source};
  }

  /* Sorudan kapsam çıkarımı. Belirsizse TAHMİN EDİLMEZ: sezon ya da ürün
     bulunamazsa kullanıcıya sorulur (§22). */
  function parseQuestion(question,known=[]){
    const value=String(question||'');
    /* Türkçede ek doğrudan yapışır: "S7'de", "S7de", "S7’nin". Kelime sonu
       araması bunları kaçırıyordu; sezon kodundan sonra RAKAM gelmemesi
       yeterli koşul. */
    const season=(/(?<![\p{L}\d])([SW]\d{1,2})(?!\d)/iu.exec(value)||[])[1];
    /* Ürün adı veriden gelir, sabit listeden değil: klasman adları kuruluşa
       göre değişir ve uydurma bir liste yanlış eşleşme üretirdi. En uzun
       eşleşme kazanır ki "T-Shirt" varken "Shirt" seçilmesin. */
    const lowered=value.toLocaleLowerCase('tr-TR');
    const product=[...known].sort((a,b)=>b.length-a.length)
      .find(name=>lowered.includes(String(name).toLocaleLowerCase('tr-TR')));
    return {season:season?season.toUpperCase():'',product:product||''};
  }

  /* Türkçe karakterlerde JS \b sınırı güvenilir olmadığı için model sayısı
     intent'i sözcük sınırını açıkça boşluk/son ile kontrol eder. */
  const CP_MODEL_COUNT_RE=/(?:kaç|kac)\s+(?:tane\s+)?model(?:ler)?(?:\s|$)|model(?:ler)?\s+(?:sayısı|sayisi|count)(?:\s|$)|how many models?\b/i;

  function parseCpQuestion(question,rows=[]){
    const value=String(question||'');
    const lowered=value.toLocaleLowerCase('tr-TR');
    const cpMention=/(?:\bcp\b|\bcp['’]?(?:de|da|daki|deki)\b)/i.test(value);
    const modelCount=CP_MODEL_COUNT_RE.test(lowered);
    const periods=[
      ['thisWeek',/bu hafta|this week/i],['nextWeek',/gelecek hafta|önümüzdeki hafta|next week/i],
      ['today',/bugün|bugun|today/i],['tomorrow',/yarın|yarin|tomorrow/i],
      ['thisMonth',/bu ay|this month/i],['nextMonth',/gelecek ay|önümüzdeki ay|next month/i],
      ['past',/geçmiş|gecmis|geciken|gecikmiş|gecikmis|tarihi geçen|tarihi gecen|overdue|past/i],
    ];
    const period=(periods.find(([,pattern])=>pattern.test(lowered))||[])[0]||'';
    const seasonMatch=/(?<![\p{L}\d])([SW]\d{1,2})(?!\d)/iu.exec(value);
    if(cpMention&&modelCount)return {kind:'modelCount',period,
      scope:seasonMatch?{season:seasonMatch[1].toUpperCase()}: {},
      rowCount:Array.isArray(rows)?rows.length:0};
    const operation=/(?:yükle|yukle|sevk|ex[- ]?factory|shipment|loading|dispatch)/i.test(lowered);
    if(!cpMention||!operation)return {state:tools.STATES.AMBIGUOUS,
      message:t('CP yükleme sorusunu anlayamadım.','I could not identify a CP shipment question.')};
    if(!period)return {state:tools.STATES.AMBIGUOUS,
      message:t('Hangi dönemi incelememi istersiniz? Örneğin “CP’de bu hafta hangi yüklemeler var?”.',
        'Which period should I inspect? For example, “Which shipments are scheduled in CP this week?”.')};
    return {kind:'loads',period,scope:seasonMatch?{season:seasonMatch[1].toUpperCase()}: {},
      rowCount:Array.isArray(rows)?rows.length:0};
  }

  function classificationsOf(rows){
    return [...new Set(rows.map(item=>String(item&&item.classification||'').trim()).filter(Boolean))];
  }

  /* --------------------------------------------------------------- YAZMA */

  /* Copilot'a KENDİ yazma yolu verilmez. Aşağıdaki yazıcılar, kullanıcının
     elle düzenleme yaparken kullandığı fonksiyonun ta kendisini çağırır:
     satır değiştirilir, syncOverridesFromRow yerel durumu günceller ve
     /api/overrides/:orderCode'a gönderir. Böylece yetki kontrolü, revizyon
     çakışması (409), audit kaydı ve canlı bildirim olduğu gibi işler.

     İkinci bir yazma yolu açmak, bu güvencelerin hepsini atlamak olurdu. */
  function findOrderRow(orderCode){
    const code=String(orderCode||'').trim();
    if(!code)return null;
    for(const table of [global.state&&global.state.cp,global.state&&global.state.orders]){
      const rows=table&&Array.isArray(table.rows)?table.rows:null;
      if(!rows)continue;
      const found=rows.find(row=>String(row&&row['Order Code']||'').trim()===code);
      if(found)return found;
    }
    return null;
  }

  function currentValueOf(type,payload){
    const row=findOrderRow(payload&&payload.orderCode);
    if(!row)return null;
    if(type==='order.note.set')return {note:String(row.Notes==null?'':row.Notes)};
    if(type==='order.supplier.set')return {manufacturer:String(row['Sub-Manufacturer']==null?'':row['Sub-Manufacturer'])};
    return null;
  }

  /* Uygulanmakta olan önerinin kimliği yazma gövdesine kadar taşınır ki
     sunucu ORDER_UPDATE kaydını "Copilot" diye etiketleyebilsin. */
  function markCopilotOrigin(row,type){
    if(!row||!pendingProposal)return;
    row._copilotOrigin={source:'copilot',proposalId:pendingProposal.proposalId,type:type};
  }
  const writers={
    async 'order.note.set'(payload){
      const row=findOrderRow(payload.orderCode);
      if(!row)throw new Error(t(`${payload.orderCode} siparişi yüklü verilerde bulunamadı.`,`Order ${payload.orderCode} is not in the loaded data.`));
      markCopilotOrigin(row,'order.note.set');
      row.Notes=payload.note;
      global.syncOverridesFromRow(row);
      return {orderCode:payload.orderCode,note:payload.note};
    },
    async 'order.supplier.set'(payload){
      const row=findOrderRow(payload.orderCode);
      if(!row)throw new Error(t(`${payload.orderCode} siparişi yüklü verilerde bulunamadı.`,`Order ${payload.orderCode} is not in the loaded data.`));
      markCopilotOrigin(row,'order.supplier.set');
      row['Sub-Manufacturer']=payload.manufacturer;
      global.syncOverridesFromRow(row);
      return {orderCode:payload.orderCode,manufacturer:payload.manufacturer};
    },
    /* Mevcut tarif ucuna kaydeder. Otomasyon motoru, zamanlayıcı, gecikmiş
       tetik koruması ve audit hepsi orada — burada ikinci bir kopya yok. */
    async 'automation.recipe.create'(payload){
      const response=await fetch('/api/automations/recipes',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:payload.name,purpose:'email',enabled:true,
          source:payload.source,filters:payload.filters||[],
          email:{groupId:payload.emailGroupId,subject:payload.name,body:'',
            includeReport:true,reportFields:[],deliveryMode:payload.deliveryMode,openDraftOnManual:true},
          schedule:{enabled:true,mode:'weekly',time:payload.time,weekdays:[Number(payload.weekday)],intervalHours:24},
        }),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        const error=new Error(data.error||t('Otomasyon kaydedilemedi.','The automation could not be saved.'));
        error.code=data.code;throw error;
      }
      automationState=null; // yeni tarif listeye girdi
      return {recipeId:data.recipe&&data.recipe.id,name:payload.name};
    },
  };

  /* ------------------------------------------------------------ OTOMASYON */

  const WEEKDAYS=[
    {index:1,tr:['pazartesi'],en:['monday']},{index:2,tr:['salı','sali'],en:['tuesday']},
    {index:3,tr:['çarşamba','carsamba'],en:['wednesday']},{index:4,tr:['perşembe','persembe'],en:['thursday']},
    {index:5,tr:['cuma'],en:['friday']},{index:6,tr:['cumartesi'],en:['saturday']},{index:0,tr:['pazar'],en:['sunday']},
  ];
  /* Kaynak yalnız EKRAN ADINDAN tanınır. Önceki hâlinde "sipariş" kelimesi
     orders ekranını seçiyordu; "cpdeki tarihi geçmiş siparişler" cümlesi hem
     cp hem orders'a uyuyor ve sıralamada önce gelen kazanıyordu. Yani asistan,
     kullanıcının söylemediği bir ekranı sessizce seçiyordu — otomasyon haftalarca
     yanlış tablodan rapor üretirdi. Genel isimler ("sipariş", "bekleyen") ekran
     adı değildir; ekran açıkça söylenmediyse SORULUR.
     Türkçe ek alan adlar için: cp, cpdeki, cp'den … hepsi aynı ekrandır. */
  const SUFFIX="(?:['’]?(?:d[ae]ki|d[ae]n|[dt][ae]|y[ae]|n[iı]n|[iı]n|ler|lar))?"; // i18n-ignore — Türkçe komut tanıma regex kaynağı
  const SOURCES=[
    {key:'lfl',pattern:`lfl${SUFFIX}`},
    {key:'backlog',pattern:`backlog${SUFFIX}`},
    {key:'collection',pattern:`(?:koleksiyon|collection)${SUFFIX}`},
    // "ekranından" iki ek üst üste alır; çapa kelime zaten "ekran" olduğu için
    // sonrasındaki harfleri serbest bırakmak yanlış eşleşme üretmez.
    {key:'orders',pattern:'orders|sipari[sş](?:ler)?\\s+ekran\\p{L}*'}, // i18n-ignore — Türkçe komut tanıma regex kaynağı
    {key:'cp',pattern:`cp${SUFFIX}`},
  ].map(item=>({key:item.key,re:new RegExp(`(?<![\\p{L}\\d])(?:${item.pattern})(?![\\p{L}\\d])`,'iu')}));

  /* Tek bir kapı: hem ask() hem parseAutomationIntent aynı ifadeyi kullanır.
     İkisi ayrışsaydı, ask()'in yakalayıp parse'ın reddettiği bir cümle sessizce
     fiyat sorusu sanılırdı. */
  const AUTOMATION_HINT=/(otomasyon|automation|her (pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)|hatırlat|hatirlat|periyodik|haftalık|haftalik)/i;

  let automationState=null;
  async function loadAutomationState(){
    if(automationState)return automationState;
    const response=await fetch('/api/automations',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error(t('Otomasyon ayarları okunamadı.','Automation settings could not be read.'));
    automationState=await response.json();
    return automationState;
  }

  /* Cümleyi tarife çevirir. Belirsiz kalan hiçbir alan TAHMİN EDİLMEZ; eksikse
     kullanıcıya sorulur. Yanlış gruba giden bir hatırlatma e-postası, hiç
     gitmeyenden kötüdür. */
  function parseAutomationIntent(question,groups){
    const value=String(question||'');
    const lowered=value.toLocaleLowerCase('tr-TR');
    if(!AUTOMATION_HINT.test(lowered))return null;

    const day=WEEKDAYS.find(item=>[...item.tr,...item.en].some(word=>lowered.includes(word)));
    // Saat 00–23 ile sınırlı: "29:00" gibi bir değer sunucuda sessizce 09:00'a
    // düşer ve önizleme kullanıcıya yalan söylemiş olurdu.
    const time=(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(value)||[]);
    /* Birden fazla ekran adı geçiyorsa hiçbiri seçilmez: ikisinden birini
       tutmak, kullanıcının hangisini kastettiğini bilmeden karar vermektir. */
    const matched=SOURCES.filter(item=>item.re.test(value));
    const source=matched.length===1?matched[0].key:'';
    // Grup adı KAYITLI gruplarla eşleştirilir; uydurulmaz. En uzun eşleşme kazanır.
    const group=[...(groups||[])]
      .sort((a,b)=>String(b.name||'').length-String(a.name||'').length)
      .find(item=>item.name&&lowered.includes(String(item.name).toLocaleLowerCase('tr-TR')));
    const overdue=/(tarihi geçmiş|tarihi gecmis|geciken|gecikmiş|gecikmis|teslim tarihi geç|overdue|geçmiş teslim)/i.test(lowered);

    return {
      day,source,group,overdue,
      time:time.length?`${String(time[1]).padStart(2,'0')}:${time[2]}`:'',
      /* Teslimat varsayılanı TASLAK. Bir otomasyonun kendiliğinden e-posta
         göndermesi, kullanıcının açıkça istemesi gereken bir şeydir.
         Değer sunucunun tanıdığı sabittir ('send' olsaydı sessizce 'draft'a
         düşer, önizleme "gönderilir" derken taslak üretilirdi). */
      /* "taslağı" — Türkçede k→ğ yumuşaması. Yalnız "taslak" arasaydı,
         "taslağı gönder" diyen kullanıcıya OTOMATİK GÖNDERİM kurulurdu. */
      deliveryMode:'draft',
      raw:value,
    };
  }

  function automationRecipePayload(intent){
    const filters=intent.overdue?[{field:'Retail Date',operator:'lt',value:'@today'}]:[];
    return {
      name:`${intent.group.name} — ${intent.overdue?t('geciken siparişler','overdue orders'):t('rapor','report')}`.slice(0,180),
      source:intent.source,
      filters,
      emailGroupId:intent.group.id,
      emailGroupName:intent.group.name,
      weekday:String(intent.day.index),
      time:intent.time||'09:00',
      deliveryMode:intent.deliveryMode,
    };
  }

  /* Yazma niyeti DETERMINISTIC olarak çıkarılır, modele sorulmaz. Sipariş kodu
     ve değer kullanıcının kendi cümlesinden gelir; model bir sipariş kodu
     uyduramaz çünkü bu yola hiç dokunmuyor. */
  function parseWriteIntent(question){
    const value=String(question||'').trim();
    const order=(/(?<![\p{L}\d])(\d{4,12})(?!\d)/u.exec(value)||[])[1];
    if(!order)return null;
    const note=/(?:not|note)\s*[:：]\s*(.+)$/i.exec(value);
    if(note)return {type:'order.note.set',payload:{orderCode:order,note:note[1].trim()},reason:value};
    const supplier=/(?:üretici|uretici|supplier|sub[- ]?manufacturer)\s*[:：]\s*(.+?)(?:\s+ata\b|$)/i.exec(value);
    if(supplier)return {type:'order.supplier.set',payload:{orderCode:order,manufacturer:supplier[1].trim()},reason:value};
    return null;
  }

  /* ------------------------------------------------------------ YÖNLENDİRME */

  /* Soruyu bir araca bağlar. Sıra bilinçlidir: özel niyetler ("karşılaştır",
     "yoğunlaşma") genel fiyat sorusundan ÖNCE denenir, yoksa hepsi
     "en uygun üretici" sanılırdı.

     Eşleşme yoksa TAHMİN EDİLMEZ. Bilinmeyen bir soruyu en yakın araca
     zorlamak, kullanıcının sormadığı soruya kendinden emin bir cevap vermektir;
     bunun yerine asistan ne cevaplayabildiğini söyler. */
  const ROUTES=[
    {id:'cpOperations',re:/(?=.*(?:\bcp\b|\bcp['’]?(?:de|da|daki|deki)\b))(?=.*(?:yükle|yukle|sevk|ex[- ]?factory|shipment|loading|dispatch|(?:kaç|kac)\s+(?:tane\s+)?model(?:ler)?(?:\s|$)|model(?:ler)?\s+(?:sayısı|sayisi|count)(?:\s|$)|how many models?\b))/i,needsSeason:false},
    {id:'compareSuppliers',re:/karşılaştır|karsilastir|kıyasla|kiyasla|\bcompare\b|\bvs\b/i,needsSeason:true},
    {id:'supplierConcentration',re:/yoğunlaş|yogunlas|konsantr|dağılım|dagilim|bağımlı|bagimli|tedarik risk|concentration/i,needsSeason:true},
    {id:'priceOutliers',re:/sapan|sapma|aykırı|aykiri|uç fiyat|uc fiyat|anormal|outlier/i,needsSeason:true},
    {id:'seasonTrend',re:/sezonlara göre|sezonlara gore|trend|seyir|geçen sezon|gecen sezon|nasıl değiş|nasil degis|artmış mı|artmis mi|düşmüş mü|dusmus mu/i,needsSeason:false},
    {id:'priceSummary',re:/ortalama|medyan|fiyat aralığı|fiyat araligi|ne durumda|özet|ozet|kaça|kaca|average|median|summary/i,needsSeason:true},
    {id:'bestSupplierPrice',re:/en uygun|en ucuz|en düşük|en dusuk|hangi üretici|hangi uretici|best|cheapest/i,needsSeason:true},
  ];

  function routeFor(question){
    const value=String(question||'');
    return ROUTES.find(route=>route.re.test(value))||null;
  }

  /* Üretici adları VERİDEN gelir, cümleden çıkarılmaz: "ABC ile DEF'i
     karşılaştır" cümlesinden ad uydurmak, kayıtlarda olmayan bir üreticiyi
     varmış gibi göstermek olurdu. En uzun eşleşme kazanır. */
  function manufacturersIn(question,rows){
    const lowered=String(question||'').toLocaleLowerCase('tr-TR');
    const names=[...new Set(rows.map(item=>String(item&&item.manufacturer||'').trim()).filter(Boolean))];
    return names.sort((a,b)=>b.length-a.length)
      .filter(name=>lowered.includes(name.toLocaleLowerCase('tr-TR')));
  }

  /* Kapsamdaki üretici adları — kullanıcı adı tanıyamadığımızda ne
     yazabileceğini göstermek için. Süzgeç araç katmanının kendisinden
     çağrılır; buraya ikinci bir kopya yazmak, iki yerin ayrışması demekti. */
  function scopeNames(rows,parsed){
    const resolved=tools.resolveScope(parsed);
    if(!resolved.answerable)return [];
    return [...new Set(tools.applyScope(rows,resolved.scope)
      .map(item=>String(item&&item.manufacturer||'').trim()).filter(Boolean))].sort();
  }

  /* --------------------------------------------------------------- ÇİZİM */

  function renderEvidence(result){
    const rows=[
      [t('Sezon','Season'),result.scope.season&&result.scope.season.value],
      [t('Ürün','Product'),result.scope.product&&result.scope.product.value],
      [t('Model','Models'),result.coverage.modelCount],
      [t('Üretici','Suppliers'),result.coverage.manufacturerCount],
      [t('Fiyat kaydı','Price records'),result.coverage.priceRecordCount],
      [t('Para birimi','Currency'),result.currency],
      [t('Kaynak','Source'),result.provenance.module],
    ].filter(([,value])=>value!=null&&value!=='');
    if(result.temporaryScope)rows.push([t('Kapsam','Scope'),t('Geçici','Temporary')]);
    /* Çevrim yapılmadığı için başka para birimindeki kayıtlar karşılaştırmaya
       girmedi. Bunu söylemeden vermek, kapsamı olduğundan geniş göstermek olur. */
    if(result.excludedRecordCount)rows.push([t('Karşılaştırma dışı','Not compared'),
      `${result.excludedRecordCount} ${t('kayıt','records')} (${result.excludedCurrencies.join(', ')})`]);
    if(result.freshness&&result.freshness.known){
      const hours=Math.round(result.freshness.ageMs/3600000);
      rows.push([t('Veri yaşı','Data age'),t(`${hours} saat önce`,`${hours}h ago`)]);
    }
    return `<div class="bCpEvidence"><b>${t('DAYANAK','EVIDENCE')}</b><dl>${
      rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></div>`;
  }

  function renderCpEvidence(result){
    const rows=[
      [t('Dönem','Period'),`${result.period.label} · ${result.period.start||'…'} – ${result.period.end||'…'}`],
      [t('CP kaydı','CP records'),result.coverage.recordCount],
      [t('Tarih bulunan','With ex-factory date'),result.coverage.datedRecordCount],
      [t('Sonuç kaydı','Matched records'),result.coverage.matchedRecordCount],
      [t('Kaynak','Source'),result.provenance.module],
    ];
    if(result.coverage.undatedRecordCount)rows.push([t('Tarihsiz','Undated'),result.coverage.undatedRecordCount]);
    if(result.freshness&&result.freshness.known){
      const hours=Math.round(result.freshness.ageMs/3600000);
      rows.push([t('Veri yaşı','Data age'),t(`${hours} saat önce`,`${hours}h ago`)]);
    }
    return `<div class="bCpEvidence"><b>${t('DAYANAK','EVIDENCE')}</b><dl>${
      rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></div>`;
  }

  function renderAnswer(result,prose){
    const best=result.best;
    const deltaClass=best.status==='below'?'isBelow':best.status==='above'?'isAbove':'';
    const meta=[
      best.deltaPercent!=null
        ? `<span class="${deltaClass}">${t('Klasman ortalamasının','Class average')} %${num(Math.abs(best.deltaPercent),1)} ${best.deltaPercent<0?t('altında','below'):t('üstünde','above')}</span>`
        : `<span>${t('Klasman karşılaştırması için yeterli veri yok','Not enough data to benchmark')}</span>`,
      `<span>${best.coverage.modelCount} ${t('model','models')}</span>`,
      `<span>#${best.rank}</span>`,
    ].join('');

    const others=result.ranking.slice(1,4).map(item=>
      `<li><b>${esc(item.manufacturer)}</b><span>${num(item.medianPrice)} ${esc(result.currency)}</span></li>`).join('');

    return `<div class="bCpAnswer">
      <div class="bCpFact"><b>${esc(best.manufacturer)}</b><span class="bCpPrice">${num(best.medianPrice)} ${esc(result.currency)}</span></div>
      <div class="bCpMeta">${meta}</div>
      ${prose?`<p class="bCpProse">${esc(prose)}</p>`:''}
      ${others?`<ul class="bCpRank">${others}</ul>`:''}
      <div class="bCpActions">
        <button type="button" class="tbtn" data-bcp-show>${t('Sonuçları Göster','Show results')}</button>
      </div>
    </div>${renderEvidence(result)}`;
  }

  /* Her araç kendi cevabını çizer ama iskelet ortaktır: önce SAYI, sonra
     bağlam, sonra (varsa) LLM cümlesi, en sonda dayanak. Sıra bilinçli —
     kullanıcı sayıyı model konuşmadan önce görür. */
  function renderFact(headline,value,meta,prose,extra){
    return `<div class="bCpAnswer">
      <div class="bCpFact"><b>${headline}</b>${value?`<span class="bCpPrice">${value}</span>`:''}</div>
      ${meta?`<div class="bCpMeta">${meta}</div>`:''}
      ${prose?`<p class="bCpProse">${esc(prose)}</p>`:''}
      ${extra||''}
      <div class="bCpActions">
        <button type="button" class="tbtn" data-bcp-show>${t('Sonuçları Göster','Show results')}</button>
      </div>
    </div>`;
  }

  function renderSummary(result,prose){
    const s=result.summary;
    const meta=[
      `${t('Aralık','Range')}: ${num(s.min)} – ${num(s.max)} ${esc(result.currency)}`,
      s.spreadPercent!=null?`${t('Yayılım','Spread')}: %${num(s.spreadPercent,0)}`:'',
      s.weightedAverage!=null?`${t('Miktar ağırlıklı','Qty-weighted')}: ${num(s.weightedAverage)}`:'',
    ].filter(Boolean).join(' · ');
    const rows=[[t('Ortalama','Average'),num(s.average)],[t('Alt çeyrek','25th pct'),num(s.p25)],
      [t('Üst çeyrek','75th pct'),num(s.p75)]];
    return renderFact(t('Medyan','Median'),`${num(s.median)} ${esc(result.currency)}`,meta,prose,
      `<ul class="bCpRank">${rows.map(([key,value])=>
        `<li><b>${esc(key)}</b><span>${value}</span></li>`).join('')}</ul>`)+renderEvidence(result);
  }

  function renderConcentration(result,prose){
    const top=result.topShare;
    const meta=`${t('Üretici sayısı','Suppliers')}: ${result.shares.length} · HHI: ${num(result.herfindahl,0)}`;
    return renderFact(esc(top.manufacturer),`%${num(top.sharePercent,1)}`,meta,prose,
      `<ul class="bCpRank">${result.shares.slice(0,8).map(item=>
        `<li><b>${esc(item.manufacturer)}</b><span>%${num(item.sharePercent,1)} · ${item.modelCount} ${t('model','models')}</span></li>`).join('')}</ul>`)
      +renderEvidence(result);
  }

  function renderOutliers(result,prose){
    if(result.clean){
      return renderFact(t('Sapan fiyat yok','No outlier prices'),'',
        `${t('Medyan','Median')}: ${num(result.median)} ${esc(result.currency)}`,prose,'')+renderEvidence(result);
    }
    return renderFact(t('Sapan kayıt','Outlier records'),String(result.outliers.length),
      `${t('Medyan','Median')}: ${num(result.median)} ${esc(result.currency)}`,prose,
      `<ul class="bCpRank">${result.outliers.slice(0,8).map(item=>
        `<li><b>${esc(item.manufacturer||'—')}${item.modelKey?` · ${esc(item.modelKey)}`:''}</b><span>${
          num(item.price)} ${esc(result.currency)}${item.deviationPercent!=null
            ?` (${item.deviationPercent>0?'+':''}%${num(item.deviationPercent,0)})`:''}</span></li>`).join('')}</ul>`)
      +renderEvidence(result);
  }

  function renderComparison(result,prose){
    const meta=result.gapPercent!=null
      ? `${t('Aradaki fark','Gap')}: %${num(result.gapPercent,1)}` : '';
    return renderFact(esc(result.cheapest.manufacturer),`${num(result.cheapest.medianPrice)} ${esc(result.currency)}`,meta,prose,
      `<ul class="bCpRank">${result.compared.map(item=>
        `<li><b>${esc(item.manufacturer)}</b><span>${num(item.medianPrice)} ${esc(result.currency)} · ${
          item.coverage.priceRecordCount} ${t('kayıt','records')}</span></li>`).join('')}</ul>`)
      +renderEvidence(result);
  }

  function renderTrend(result,prose){
    const up=result.changePercent!=null&&result.changePercent>0;
    const meta=result.changePercent!=null
      ? `${esc(result.from.season)} → ${esc(result.to.season)}: <span class="${up?'isAbove':'isBelow'}">${
          up?'+':''}%${num(result.changePercent,1)}</span>` : '';
    return renderFact(esc(result.to.season),`${num(result.to.medianPrice)} ${esc(result.currency)}`,meta,prose,
      `<ul class="bCpRank">${result.seasons.map(item=>
        `<li><b>${esc(item.season)}</b><span>${num(item.medianPrice)} ${esc(result.currency)} · ${
          item.priceCount} ${t('kayıt','records')}</span></li>`).join('')}</ul>`)
      +renderEvidence(result);
  }

  function displayDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
    return match?(lang()==='en'?`${match[2]}/${match[3]}/${match[1]}`:`${match[3]}.${match[2]}.${match[1]}`):String(value||'—');
  }

  function renderCpOperations(result,prose){
    const s=result.summary;
    if(result.operation==='modelCount'){
      const meta=[
        `${s.orderCount.toLocaleString(lang()==='en'?'en-US':'tr-TR')} ${t('CP kaydı','CP records')}`,
        `${result.coverage.scopedRecordCount||result.coverage.recordCount} ${t('kapsamdaki kayıt','records in scope')}`,
      ].join(' · ');
      return `<div class="bCpAnswer">
        <div class="bCpFact"><b>${t('CP model sayısı','CP model count')}</b><span class="bCpPrice">${s.modelCount}</span></div>
        <div class="bCpMeta">${esc(meta)}</div>
        ${prose?`<p class="bCpProse">${esc(prose)}</p>`:''}
        <div class="bCpActions">
          <button type="button" class="tbtn" data-bcp-show="cp">${t('CP sonuçlarını Göster','Show CP results')}</button>
        </div>
      </div>${renderCpEvidence(result)}`;
    }
    const meta=[
      `${s.orderQuantity.toLocaleString(lang()==='en'?'en-US':'tr-TR')} ${t('sipariş adedi','ordered')}`,
      `${s.shipmentQuantity.toLocaleString(lang()==='en'?'en-US':'tr-TR')} ${t('yüklenen','shipped')}`,
      `${s.remainingUnits.toLocaleString(lang()==='en'?'en-US':'tr-TR')} ${t('kalan','remaining')}`,
    ].join(' · ');
    const rows=result.rows.slice(0,20).map(item=>{
      const title=[item.orderCode,item.modelName].filter(Boolean).join(' · ')||t('Sipariş kodu yok','No order code');
      const details=[displayDate(item.exFactory),item.manufacturer,item.deliveryType,
        item.shipmentQuantity==null?'':`${item.shipmentQuantity} / ${item.remainingUnits==null?'—':item.remainingUnits}`]
        .filter(Boolean).join(' · ');
      return `<li><b>${esc(title)}</b><span>${esc(details)}</span></li>`;
    }).join('');
    const more=result.rows.length>20
      ?`<div class="bCpMeta">+${result.rows.length-20} ${t('kayıt daha','more records')}</div>`:'';
    return `<div class="bCpAnswer">
      <div class="bCpFact"><b>${esc(result.period.label)} ${t('yüklemeleri','shipments')}</b><span class="bCpPrice">${s.orderCount}</span></div>
      <div class="bCpMeta">${esc(meta)}</div>
      ${prose?`<p class="bCpProse">${esc(prose)}</p>`:''}
      ${rows?`<ul class="bCpRank">${rows}</ul>`:`<p class="bCpMeta">${t('Bu dönemde yükleme kaydı yok.','No shipment records in this period.')}</p>`}
      ${more}
      <div class="bCpActions">
        <button type="button" class="tbtn" data-bcp-show="cp">${t('CP sonuçlarını Göster','Show CP results')}</button>
      </div>
    </div>${renderCpEvidence(result)}`;
  }

  /* Sonuç tipine göre çizim. Tanımadığı bir tipi çizmeye ÇALIŞMAZ — yarım
     çizilmiş bir cevap, cevapsızlıktan daha yanıltıcıdır. */
  const RENDERERS={bestSupplierPrice:renderAnswer,priceSummary:renderSummary,
    supplierConcentration:renderConcentration,priceOutliers:renderOutliers,
    compareSuppliers:renderComparison,seasonTrend:renderTrend,cpOperations:renderCpOperations};

  /* Cevaplayamadığı soruda ne yapabildiğini söyler. "Anlamadım" demek
     kullanıcıyı çıkmaza sokar; sınırı göstermek yol açar. */
  function renderCapabilities(){
    const items=tools.capabilities();
    return `<div class="bCpNotice isWarn"><b>${t('Bu soruyu cevaplayamıyorum','I cannot answer that')}</b>${
      esc(t('Uydurmak yerine ne yapabildiğimi söyleyeyim:','Rather than guess, here is what I can do:'))}
      <ul class="bCpRank">${items.map(item=>
        `<li><b>${esc(lang()==='en'?item.en:item.tr)}</b></li>`).join('')}</ul>
      <div class="bCpSuggest">${items.slice(0,4).map(item=>
        `<button type="button" data-bcp-ask="${esc(item.example[lang()])}">${esc(item.example[lang()])}</button>`).join('')}</div>
    </div>`;
  }

  function renderAssistantResponse(result){
    const answer=esc(result&&result.answer||'').replace(/\r?\n/g,'<br>');
    const evidence=Array.isArray(result&&result.evidence)?result.evidence:[];
    const sources=[...new Set(evidence.map(item=>String(item&&item.source||'').trim()).filter(Boolean))];
    const matched=evidence.reduce((sum,item)=>sum+(Number(item&&item.matched)||0),0);
    const refreshed=evidence.map(item=>item&&item.refreshedAt).filter(Boolean).sort().at(-1)||'';
    const outside=evidence.some(item=>item&&item.scope&&item.scope.outsideHorizon);
    const rows=[
      [t('Kaynak','Source'),sources.join(', ')],
      [t('İncelenen kayıt','Analysed records'),matched||''],
      [t('Güncelleme','Updated'),refreshed?new Date(refreshed).toLocaleString(lang()==='en'?'en-US':'tr-TR'):''],
      [t('Kapsam','Scope'),outside?t('Horizon dışı veriler dahil','Includes data outside Horizon'):''],
    ].filter(([,value])=>value!==''&&value!=null);
    const target=sources[0]||'';
    /* ÇIKTI yalnız SUNUCU verdiyse gösterilir. Ortada araçtan gelmiş bir
       tablo yoksa sunucu `export` göndermiyor; burada kendi başımıza bir
       indirme düğmesi çizmek, olmayan bir dayanağı varmış gibi göstermek
       olurdu. Bağlantı düz bir <a download>: dosyayı sunucu üretiyor ve
       aracı bir JS adımına gerek yok. */
    const exportInfo=result&&result.export;
    const exportBtn=exportInfo&&exportInfo.id
      ? `<a class="tbtn" href="/api/copilot/export/${encodeURIComponent(exportInfo.id)}" download
           title="${esc(exportInfo.fileName||'')}">${t('Excel’e aktar','Export to Excel')}${
             exportInfo.rowCount?` <span class="bCpExportMeta">${esc(String(exportInfo.rowCount))} ${t('satır','rows')}</span>`:''}</a>`
      : '';
    const showBtn=target?`<button type="button" class="tbtn" data-bcp-show="${esc(target)}">${t('Sonuçları Göster','Show results')}</button>`:'';
    const cf=result&&result.cloudFallback;
    const cloudLabel=cf&&cf.provider==='nvidia'?'NVIDIA NIM':'OpenRouter Free';
    const cloudBadge=cf?`<div class="bCpCloudBadge" title="${esc(t(`Yerel model ${cf.reason||''} nedeniyle kullanılamadı; ${cloudLabel} (${cf.model||''}) devreye girdi.`,`Local model unavailable (${cf.reason||''}); ${cloudLabel} (${cf.model||''}) was used.`))}">☁ ${esc(cloudLabel)} · ${esc(cf.model||'')}</div>`:'';
    const devMode=isDeveloperMode();
    const devBlock=devMode?`<div class="bCpDevInfo">
      <b>${t('Geliştirici','Developer')}</b>
      <dl>
        <dt>${t('Sağlayıcı','Provider')}</dt><dd>${esc(providerLabelFor(result&&result.provider))}</dd>
        <dt>${t('Model','Model')}</dt><dd>${esc(result&&result.model||'')}</dd>
        <dt>${t('Gecikme','Latency')}</dt><dd>${result&&result.latencyMs!=null?`${result.latencyMs} ms`:'—'}</dd>
        <dt>${t('Giriş/Çıkış token','Input/Output tokens')}</dt><dd>${devUsage(result&&result.usage)}</dd>
        <dt>${t('Araç çağrısı','Tool calls')}</dt><dd>${Array.isArray(result&&result.toolCalls)?result.toolCalls.length:0}</dd>
        <dt>${t('Bulut yedek','Fallback used')}</dt><dd>${cf?`${esc(cloudLabel)} (${esc(cf.reason||'')})`:t('Hayır','No')}</dd>
      </dl>
    </div>`:'';
    return `<div class="bCpAnswer">${cloudBadge}
      <p class="bCpProse">${answer}</p>
      ${showBtn||exportBtn?`<div class="bCpActions">${showBtn}${exportBtn}</div>`:''}
      ${devBlock}
    </div>${rows.length?`<div class="bCpEvidence"><b>${t('DAYANAK','EVIDENCE')}</b><dl>${
      rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></div>`:''}`;
  }
  function providerLabelFor(id){
    return ({ollama:'Ollama',lmstudio:'LM Studio','openai-compatible':'Custom OpenAI','openrouter':'OpenRouter (Free)',nvidia:'NVIDIA NIM'})[String(id||'')]||String(id||'—');
  }
  function devUsage(usage){
    if(!usage)return '—';
    const inTok=usage.prompt_tokens??usage.input_tokens??null;
    const outTok=usage.completion_tokens??usage.output_tokens??null;
    if(inTok==null&&outTok==null)return '—';
    return `${inTok??'—'} / ${outTok??'—'}`;
  }
  /* Developer Mode salt istemci tercihidir — sunucuya hiçbir şey göndermez,
     yalnız zaten cevapla birlikte gelen teknik alanları gösterir/gizler
     (bkz. kullanıcı talebi §13: "Normal kullanıcıya teknik detaylarla UI'ı
     kirletme"). */
  function isDeveloperMode(){
    try{return localStorage.getItem('bcpDeveloperMode')==='1';}catch(_){return false;}
  }
  function setDeveloperMode(on){
    try{localStorage.setItem('bcpDeveloperMode',on?'1':'0');}catch(_){}
  }

  /* ---------------------------------------------------------- GÖRSEL EK */

  function renderAttachments(){
    const holder=root&&root.querySelector('[data-bcp-attachments]');if(!holder)return;
    if(!pendingAttachments.length){holder.hidden=true;holder.innerHTML='';return;}
    holder.hidden=false;
    holder.innerHTML=pendingAttachments.map((att,index)=>
      `<div class="bCpAttachment"><img src="data:${esc(att.mimeType)};base64,${att.dataBase64}" alt=""><button type="button" class="iconbtn" data-bcp-remove-attachment="${index}" title="${t('Kaldır','Remove')}" aria-label="${t('Kaldır','Remove')}">×</button></div>`
    ).join('');
  }
  function fileToBase64(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>{
        const result=String(reader.result||'');
        const comma=result.indexOf(',');
        resolve(comma>=0?result.slice(comma+1):'');
      };
      reader.onerror=()=>reject(reader.error||new Error('Dosya okunamadı.'));
      reader.readAsDataURL(file);
    });
  }
  async function addAttachmentFile(file,progressEl){
    if(!file)return;
    if(!ATTACHMENT_ALLOWED_MIME.has(file.type)){
      if(progressEl)progressEl.textContent=t('Yalnızca PNG/JPEG/WEBP/GIF görsel eklenebilir.','Only PNG/JPEG/WEBP/GIF images can be attached.');
      return;
    }
    if(file.size>ATTACHMENT_MAX_BYTES){
      if(progressEl)progressEl.textContent=t('Görsel çok büyük (en fazla 6 MB).','Image is too large (max 6 MB).');
      return;
    }
    if(pendingAttachments.length>=MAX_ATTACHMENTS){
      if(progressEl)progressEl.textContent=t(`En fazla ${MAX_ATTACHMENTS} görsel eklenebilir.`,`Up to ${MAX_ATTACHMENTS} images can be attached.`);
      return;
    }
    try{
      const dataBase64=await fileToBase64(file);
      if(!dataBase64)return;
      pendingAttachments.push({mimeType:file.type,dataBase64});
      renderAttachments();
    }catch(_){
      if(progressEl)progressEl.textContent=t('Görsel okunamadı.','Could not read image.');
    }
  }
  function removeAttachment(index){
    pendingAttachments.splice(index,1);
    renderAttachments();
  }
  function clearAttachments(){
    if(!pendingAttachments.length)return;
    pendingAttachments=[];
    renderAttachments();
  }

  /* Sunucunun ürettiği komut zarflarını uygular. Zarf kapalı bir kümedir
     (navigate/filter/clearFilters/modelImages); model kırılgan seçici
     üretemez ve DOM'a tıklayamaz. modelImages hedef kümeyi güncel görünüm
     çözümleyicisinden alır, modelin ürettiği bir listeden değil. */
  function applyUiCommands(result){
    const commands=Array.isArray(result&&result.uiCommands)?result.uiCommands:[];
    if(!commands.length)return [];
    const bus=global.BLCopilotUICommands;
    if(!bus||typeof bus.createRunner!=='function')return [];
    const results=bus.createRunner({app:global}).run(commands);
    const summary=bus.describe(results,lang()!=='en');
    /* paint() gövdeyi DEĞİŞTİRİR; özet cevabın altına EKLENMELİ, yoksa
       ajanın asıl cevabı silinir. */
    if(summary){
      const body=root&&root.querySelector('.bCpBody');
      if(body){
        const note=document.createElement('div');
        note.className='bCpUiApplied';
        note.textContent=summary;
        body.appendChild(note);
      }
    }
    return results;
  }
  /* Ajanın ürettiği öneriyi onay kartına dönüştürür. Öneri atıldır: kullanıcı
     Onayla'ya basana kadar Buyer Log'da hiçbir şey değişmez. */
  /* Öneri de İŞE bağlı çizilir: başka bir konuşma için üretilmiş bir onay
     kartını kullanıcının baktığı konuşmada göstermek, yanlış kayda
     yazmasına davetiye olurdu. */
  function showAgentProposal(result,ctx){
    const show=ctx&&ctx.show||paint;
    const list=Array.isArray(result&&result.proposals)?result.proposals:[];
    if(!list.length)return false;
    const proposal=list[0];
    // Önizlemeyi ESKİ DEĞERLE tamamla; sunucu yüklü tabloyu görmüyor.
    const before=currentValueOf(proposal.type,proposal.payload||{});
    pendingProposal={...proposal,preview:{...(proposal.preview||{}),before}};
    show(renderProposal(pendingProposal));
    return true;
  }
  /* Akan cevap için minimal bir kabuk: yalnız metin büyür, evidence/badge/
     dev-mode gibi zengin kısımlar 'done' gelince TAM render ile değişir
     (bkz. renderAssistantResponse). Ayrı tutulmasının sebebi performans —
     her delta'da tüm zengin HTML'i yeniden kurmak gereksiz iş olurdu. */
  function renderStreamingPlaceholder(){
    return `<div class="bCpAnswer bCpStreaming"><p class="bCpProse" data-bcp-stream-text></p></div>`;
  }
  /* SSE'yi (event:/data: satırları) düz fetch + ReadableStream ile tüketir.
     EventSource kullanılmaz çünkü yalnız GET destekler; burada gövde POST
     ile JSON taşıyor (bkz. server.js'teki aynı yorum). handlers: {delta,
     reset, done, error} — yalnız gerçekten gönderilenler çağrılır. */
  async function consumeSSE(response,handlers){
    if(!response.body||typeof response.body.getReader!=='function'){
      throw new Error(t('Sunucu akış yanıtı döndürmedi.','Server did not return a stream response.'));
    }
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let buffer='';
    function handleBlock(block){
      const lines=block.split(/\r?\n/);
      let event='message',data='';
      for(const line of lines){
        if(line.startsWith('event:'))event=line.slice(6).trim();
        else if(line.startsWith('data:'))data+=(data?'\n':'')+line.slice(5).trim();
      }
      if(!data)return;
      let payload;try{payload=JSON.parse(data);}catch(_){return;}
      const handler=handlers[event];
      if(typeof handler==='function')handler(payload);
    }
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      const blocks=buffer.split(/\n\n/);buffer=blocks.pop()||'';
      for(const block of blocks)if(block.trim())handleBlock(block);
    }
    buffer+=decoder.decode();
    if(buffer.trim())handleBlock(buffer);
  }
  async function askGeneralAssistant(question,ctx){
    const show=ctx&&ctx.show||paint;
    const conversationId=ctx&&ctx.conversationId||null;
    const attachments=Array.isArray(ctx&&ctx.attachments)?ctx.attachments:[];
    const scope=horizon();
    const requestBody=JSON.stringify({
      question,history:modelHistory(),language:lang(),model:aiState.model,
      attachments:attachments.map(a=>({mimeType:a.mimeType,dataBase64:a.dataBase64})),
      horizon:{seasons:scope.seasons,outsideHorizon:'allow'},
    });
    /* Akış denenir; sağlanamazsa (eski istemci/uzantı, ara katman) sessizce
       normal isteğe düşülür — kullanıcı YALNIZCA yazarken görme hızını
       kaybeder, cevabın kendisi etkilenmez. */
    let result=null,streamFailed=false;
    try{
      const streamResponse=await fetch('/api/copilot/ask/stream',{method:'POST',credentials:'same-origin',
        signal:ctx&&ctx.signal,headers:{'Content-Type':'application/json','Accept':'text/event-stream'},body:requestBody});
      if(!streamResponse.ok||!/text\/event-stream/i.test(streamResponse.headers.get('content-type')||'')){
        streamFailed=true;
      }else{
        show(renderStreamingPlaceholder());
        const textNode=()=>root&&root.querySelector('[data-bcp-stream-text]');
        let acc='';
        // "error" olayı AKIŞIN KENDİSİNİN değil, AJANIN başarısız olduğunu
        // bildirir (ör. grounding hatası) — burada fırlatmak "akış koptu,
        // düz isteğe düş" sanılmasına yol açardı ve AYNI hatayı boşuna
        // ikinci kez tetiklerdi. Yalnız KAYDEDİLİR, akış sonunda kontrol
        // edilir; düz isteğe düşme yolunu HİÇ tetiklemez.
        let agentErrorPayload=null;
        await consumeSSE(streamResponse,{
          delta:payload=>{acc+=String(payload&&payload.text||'');const node=textNode();if(node)node.innerHTML=esc(acc).replace(/\r?\n/g,'<br>');},
          reset:()=>{acc='';const node=textNode();if(node)node.innerHTML='';},
          done:payload=>{result=payload;},
          error:payload=>{agentErrorPayload=payload;},
        });
        if(agentErrorPayload){
          const error=new Error(agentErrorPayload.error||t('Gemma yanıt üretemedi.','Gemma could not produce an answer.'));
          error.code=agentErrorPayload.code;throw error;
        }
      }
    }catch(streamError){
      if(streamError&&streamError.name==='AbortError')throw streamError;
      if(streamError&&streamError.code){throw streamError;} // gerçek ajan hatası — düz isteğe DÜŞME
      streamFailed=true;
    }
    if(streamFailed){
      const response=await fetch('/api/copilot/ask',{method:'POST',credentials:'same-origin',
        signal:ctx&&ctx.signal,headers:{'Content-Type':'application/json'},body:requestBody});
      result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok){
        const error=new Error(result.error||t('Gemma yanıt üretemedi.','Gemma could not produce an answer.'));
        error.code=result.code;throw error;
      }
    }
    if(!result||result.ok!==true){
      const error=new Error((result&&result.error)||t('Gemma yanıt üretemedi.','Gemma could not produce an answer.'));
      error.code=result&&result.code;throw error;
    }
    /* Cevap KAYDA GEÇER, sonra çizilir. Ters sırada olsaydı, çizim sırasında
       bir hata olması cevabın hiç kaydedilmemesi demekti. */
    recordMessage('assistant',String(result.answer||''),conversationId);
    conversationHistory=modelHistory();
    lastResult=result;
    markRichTurn();
    show(renderAssistantResponse(result));
    applyUiCommands(result);
    // Öneri varsa onay kartı cevabın yerine geçer: kullanıcının bir sonraki
    // adımı okumak değil, karar vermek.
    showAgentProposal(result,{show});
    return result;
  }

  const DAY_LABELS={0:['Pazar','Sunday'],1:['Pazartesi','Monday'],2:['Salı','Tuesday'],3:['Çarşamba','Wednesday'],
    4:['Perşembe','Thursday'],5:['Cuma','Friday'],6:['Cumartesi','Saturday']};

  /* Yazma önizlemesi. Değişiklikte eski değer YENİNİN YANINDA, otomasyonda ise
     kurulacak tarifin tamamı gösterilir; onay ancak kullanıcı ne olacağını
     gördükten sonra istenir. */
  function renderProposal(proposal){
    const before=proposal.preview.before||{};
    const after=proposal.preview.after||{};
    let rows;
    if(proposal.type==='automation.recipe.create'){
      const day=DAY_LABELS[Number(after.weekday)]||['',''];
      rows=[
        [t('Kaynak','Source'),String(after.source||'').toUpperCase()],
        [t('Filtre','Filter'),after.filters&&after.filters.length
          ? t('Teslim tarihi geçmiş (her koşuda o günün tarihine göre)','Retail date in the past (evaluated on each run)')
          : t('(filtre yok)','(no filter)')],
        [t('Grup','Group'),after.emailGroupName],
        [t('Zamanlama','Schedule'),`${t('Haftalık','Weekly')} · ${day[lang()==='en'?1:0]} · ${after.time}`],
        [t('Teslimat','Delivery'),t('Taslak oluşturulur, gönderilmez','A draft is created, nothing is sent')],
      ];
    }else{
      const field=proposal.type==='order.note.set'?'note':'manufacturer';
      const label=proposal.type==='order.note.set'?t('Not','Note'):t('Üretici','Supplier');
      rows=[
        [t('Sipariş','Order'),after.orderCode],
        [`${label} — ${t('şimdi','now')}`,before[field]||t('(boş)','(empty)')],
        [`${label} — ${t('sonra','after')}`,after[field]],
      ];
    }
    return `<div class="bCpNotice">
      <b>${esc(proposal.label)}</b>
      <dl class="bCpDiff">${rows.map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
      <div class="bCpActions">
        <button type="button" class="tbtn primary" data-bcp-confirm="${esc(proposal.proposalId)}">${t('Onayla ve oluştur','Confirm and create')}</button>
        <button type="button" class="tbtn" data-bcp-cancel>${t('Vazgeç','Cancel')}</button>
      </div>
    </div>`;
  }

  /* Cevaplanamaz durumlar. Her biri FARKLI bir şey söyler: "veri yok" ile
     "bu kapsamda görünmüyor" aynı cümleyle geçiştirilemez (§12, §13). */
  function renderNotice(result){
    const offer=result.canOfferTemporaryScope
      ? `<div class="bCpActions"><button type="button" class="tbtn primary" data-bcp-temp="${esc(result.season)}">${
          t('Horizon dışında geçici analiz et','Analyse outside Horizon')}</button></div>`
      : '';
    const titles={
      OUT_OF_HORIZON:t('Kapsam dışında','Outside your Horizon'),
      NO_DATA:t('Veri yok','No data'),
      INSUFFICIENT_DATA:t('Yeterli veri yok','Not enough data'),
      CONFLICTING_DATA:t('Karşılaştırılamıyor','Cannot be compared'),
      PERMISSION_DENIED:t('Yetki yok','Not permitted'),
      MISSING_BINDING:t('Alan tanımı eksik','Missing field binding'),
      SCHEMA_DRIFT:t('Kaynak yapısı değişmiş','Source structure changed'),
      AMBIGUOUS:t('Netleştirmem gerekiyor','I need a clarification'),
      TOOL_ERROR:t('Asistan yanıt üretemedi','Assistant could not answer'),
    };
    const level=result.state==='PERMISSION_DENIED'||result.state==='SCHEMA_DRIFT'?'isError':'isWarn';
    return `<div class="bCpNotice ${level}"><b>${esc(titles[result.state]||result.state)}</b>${esc(result.message)}${offer}</div>`;
  }

  function renderSuggestions(known){
    const items=suggestionsFor(known);
    if(!items.length)return '';
    return `<div class="bCpHero"><svg class="octoMark isHero" aria-hidden="true"><use href="#i-octopus-mark"/></svg>
      <p>${t('Buyer Log’un merkezî AI ajanı. Koleksiyon, sipariş, fiyat ve nakliye verisine aynı anda uzanır.',
        'Buyer Log’s central AI agent. It reaches into collection, order, price and shipping data at once.')}</p></div>
      <div class="bCpSuggest"><span>${t('Örnek sorular','Try asking')}</span>${
      items.map(item=>`<button type="button" data-bcp-ask="${esc(item[lang()])}">${esc(item[lang()])}</button>`).join('')}</div>`;
  }

  function aiLabel(){
    return ({AI_READY:t('AI hazır','AI ready'),AI_SERVICE_OFFLINE:t('AI kapalı','AI offline'),
      AI_NOT_INSTALLED:t('AI kurulu değil','AI not installed'),MODEL_MISSING:t('Model yok','Model missing'),
      AI_DISABLED:t('AI devre dışı','AI disabled'),
      // Ollama'ya BAĞLANILDI ama model listesi okunamadı — bu "AI kapalı"
      // değildir, ayrı bir durumdur (bkz. copilot-llm.js status()).
      AI_DISCOVERY_ERROR:t('Modeller okunamadı','Unable to read models'),
    })[aiState.status]||aiState.status;
  }

  /* AI Modelleri panelinin başlığı: "bağlantı" ile "model keşfi" AYRI
     satırlar. Kullanıcı Ollama'nın gerçekte çalıştığını (connected:true)
     model listesi boş/okunamaz olsa BİLE görebilmeli — aksi hâlde tek bir
     "AI kapalı" cümlesi, sağlıklı bir Ollama kurulumunu "kapalı" gibi
     gösterir (bu, bildirilen hatanın ta kendisiydi). */
  function aiConnectionSummary(){
    const provider=aiState.provider?({ollama:'Ollama',lmstudio:'LM Studio'}[aiState.provider]||aiState.provider):'Ollama';
    const server=aiState.endpoint?String(aiState.endpoint).replace(/^https?:\/\//,''):'';
    const count=Array.isArray(aiState.models)?aiState.models.length:null;
    let detail;
    if(aiState.status==='AI_DISABLED')detail=t('Devre dışı','Disabled');
    else if(aiState.connected===false)detail=t('Bağlanılamadı','Not reachable');
    else if(aiState.status==='AI_DISCOVERY_ERROR')detail=t('Modeller okunamadı','Unable to read models');
    else if(count==null)detail=t('Durum bilinmiyor','Status unknown');
    else if(count===0)detail=t('Model bulunamadı','No models returned');
    else detail=t(`${count} model bulundu`,`${count} model${count===1?'':'s'} found`);
    return {provider,server,count,connected:aiState.connected===true,detail,
      reason:aiState.reason||''};
  }

  function modelChoices(){
    const installed=(Array.isArray(aiState.models)?aiState.models:[]).map(name=>({id:String(name||''),name:String(name||''),profile:'custom'}));
    const recommended=Array.isArray(aiState.recommendedModels)?aiState.recommendedModels:[];
    const choices=[...installed,...recommended].filter(item=>item.id);
    const unique=[];const seen=new Set();
    choices.forEach(item=>{if(seen.has(item.id))return;seen.add(item.id);unique.push(item);});
    const installedIds=new Set(installed.map(item=>item.id));
    // "Auto" (boş değer) ve "nvidia:<modelId>"/"openrouter:<modelId>"
    // seçimleri kullanıcı bilerek yaptıysa AYNEN korunur — yalnız hiç
    // seçim yoksa ya da artık kurulu olmayan bir yerel model kaldıysa
    // varsayılana düşülür.
    const modelStr=String(aiState.model||'');
    const isSentinel=aiState.model===''||aiState.model==null||aiState.model==='auto'||modelStr.startsWith('nvidia:')||modelStr.startsWith('openrouter:');
    const selected=isSentinel?(aiState.model||''):(installedIds.has(aiState.model)?aiState.model:gatewayDefaultModel(installed.length?installed:unique));
    return {choices,selected};
  }

  function gatewayDefaultModel(choices){
    const balanced=(choices||[]).find(item=>item.profile==='balanced'||item.id==='gemma4:12b');
    return balanced&&balanced.id||(choices&&choices[0]&&choices[0].id)||'';
  }

  /* NVIDIA NIM yalnız üç kilit birlikte sağlandığında Model Selector'da
     görünür: açık, veri politikası onaylı, anahtar var (bkz. kullanıcı
     talebi §14 — cloud gönderimi sessizce açık olamaz). */
  function nvidiaSelectorUsable(){
    const nv=aiState.nvidia||{};
    return nv.enabled===true&&nv.dataPolicy==='allowed'&&nv.hasKey===true;
  }
  function nvidiaSelectableModels(){
    const nv=aiState.nvidia||{};
    return (Array.isArray(nv.models)?nv.models:[]).filter(item=>item&&item.enabled&&!item.deprecated&&item.status!=='auth-error');
  }
  /* OpenRouter, NVIDIA ile SİMETRİK olarak Model Selector'da manuel
     seçilebilir — aynı üç kilit: açık, veri politikası onaylı, anahtar
     var. Daha önce yalnız otomatik fallback'te kullanılıyordu; kullanıcı
     geri bildirimiyle eklendi. */
  function openrouterSelectorUsable(){
    const or=aiState.openrouter||{};
    return or.enabled===true&&or.dataPolicy==='allowed'&&or.hasKey===true;
  }
  function openrouterSelectableModels(){
    const or=aiState.openrouter||{};
    return Array.isArray(or.freeModels)?or.freeModels:[];
  }

  function renderModelSelector(){
    const slot=root&&root.querySelector('[data-bcp-model-slot]');if(!slot)return;
    const {choices,selected}=modelChoices();
    aiState.model=selected;
    if(!choices.length&&!nvidiaSelectorUsable()&&!openrouterSelectorUsable()){slot.innerHTML='';return;}
    const localOptions=choices.map(item=>{
      const known=(aiState.recommendedModels||[]).find(profile=>profile.id===item.id);
      const label=known?`${known.name} · ${known.profile}`:item.name;
      return `<option value="${esc(item.id)}"${item.id===selected?' selected':''}>${esc(label)}</option>`;
    }).join('');
    const nvidiaOptions=nvidiaSelectorUsable()?nvidiaSelectableModels().map(item=>{
      const value=`nvidia:${item.modelId}`;
      return `<option value="${esc(value)}"${value===selected?' selected':''}>${esc(item.displayName||item.modelId)}</option>`;
    }).join(''):'';
    const openrouterOptions=openrouterSelectorUsable()?openrouterSelectableModels().map(item=>{
      const value=`openrouter:${item.id}`;
      return `<option value="${esc(value)}"${value===selected?' selected':''}>${esc(item.name||item.id)}</option>`;
    }).join(''):'';
    const autoOption=`<option value=""${selected===''||selected==='auto'?' selected':''}>${t('Auto (yerel öncelikli)','Auto (local-first)')}</option>`;
    slot.innerHTML=`<label class="bCpModel"><span>${t('Model','Model')}</span><select data-bcp-model aria-label="${t('AI modeli','AI model')}">${autoOption}${
      localOptions?`<optgroup label="${esc(t('Yerel','Local'))}">${localOptions}</optgroup>`:''}${
      nvidiaOptions?`<optgroup label="NVIDIA NIM">${nvidiaOptions}</optgroup>`:''}${
      openrouterOptions?`<optgroup label="OpenRouter">${openrouterOptions}</optgroup>`:''}</select></label><button type="button" class="tbtn" data-bcp-manage>${t('Modeller','Models')}</button>`;
  }

  function managerRows(modal){
    const installed=new Set(Array.isArray(aiState.models)?aiState.models:[]);
    const rows=(Array.isArray(aiState.recommendedModels)?aiState.recommendedModels:[]).map(item=>({
      ...item,installed:installed.has(item.id),
    }));
    installed.forEach(name=>{if(!rows.some(item=>item.id===name))rows.push({id:name,name,profile:'custom',description:t('Kurulu model','Installed model'),installed:true});});
    const list=modal.querySelector('[data-bcp-model-list]');if(!list)return;
    list.innerHTML=rows.length?rows.map(item=>`<div class="bCpManagerRow"><div><b>${esc(item.name||item.id)}</b><small>${esc(item.description||item.profile||'custom')}${item.installed?` · ${esc(t('Kurulu','Installed'))}`:''}</small></div><div class="bCpActions"><button type="button" class="tbtn" data-bcp-use-model="${esc(item.id)}"${item.installed?'':' disabled'}>${item.installed?t('Kullan','Use'):t('Kurulu değil','Not installed')}</button>${item.installed&&aiState.canConfigure?`<button type="button" class="tbtn" data-bcp-update-model="${esc(item.id)}">${t('Güncelle','Update')}</button><button type="button" class="tbtn" data-bcp-remove-model="${esc(item.id)}">${t('Kaldır','Remove')}</button>`:''}</div></div>`).join(''):`<div class="bCpNotice">${t('Kurulu model bulunamadı.','No installed model was found.')}</div>`;
  }

  /* Bağlantı ile model keşfini AYRI göstermenin işlevsel karşılığı: Sunucu /
     Kurulu Model Sayısı / durum cümlesi, ve iki AYRI eylem — Refresh Models
     (herkes, yalnız yeniden yoklar) ile Test Connection (moderatör, gerçek
     bir çıkarım çağrısı da yapar). İkisi karıştırılamaz: biri ucuz ve sık
     tıklanabilir, diğeri ağırdır ve seçili modelin GERÇEKTEN çalıştığını
     kanıtlar (bkz. ai-provider-gateway.js testConnection). */
  function renderConnectionSummary(){
    const info=aiConnectionSummary();
    const dotClass=info.connected?'isReady':(aiState.status==='AI_DISABLED'?'':'isOff');
    return `<div class="bCpConnection" data-bcp-connection>
      <div class="bCpConnectionRow"><b>${esc(info.provider)}</b><span class="bCpDot ${dotClass}"></span><span>${esc(info.detail)}</span></div>
      <div class="bCpConnectionMeta">
        <span>${t('Sunucu','Server')}: <code>${esc(info.server||'—')}</code></span>
        <span>${t('Kurulu model','Installed models')}: <b>${info.count==null?'—':info.count}</b></span>
      </div>
      <div class="bCpActions">
        <button type="button" class="tbtn" data-bcp-refresh-models>${t('Modelleri Yenile','Refresh Models')}</button>
        ${aiState.canConfigure?`<button type="button" class="tbtn" data-bcp-test-connection>${t('Bağlantıyı Test Et','Test Connection')}</button>`:''}
      </div>
      <small data-bcp-connection-progress></small>
    </div>`;
  }

  function openModelManager(){
    document.getElementById('_bcpModelManager')?.remove();
    const modal=document.createElement('div');modal.id='_bcpModelManager';modal.className='bCpManagerOverlay';
    const canConfigure=aiState.canConfigure===true;
    const or=aiState.openrouter||{};
    const orEnabled=or.enabled===true;
    const orPolicy=or.dataPolicy==='allowed';
    const orModels=(or.freeModels||[]);
    const orModelOpts=orModels.map(m=>`<option value="${esc(m.id)}"${m.id===(or.model||'')?' selected':''}>${esc(m.name)} — ${esc(m.description||'')}</option>`).join('');
    const orSection=canConfigure?`<div class="bCpOrSection"><div class="bCpOrHeader"><label class="bCpOrToggle"><input type="checkbox" name="openrouterEnabled"${orEnabled?' checked':''}> <b>${t('OpenRouter Free yedek','OpenRouter Free fallback')}</b></label><small>${t('Yerel model erişilemez olduğunda ücretsiz bulut modeli kullanılır.','Uses a free cloud model when the local model is unavailable.')}</small></div><div class="bCpOrBody"${orEnabled?'':' hidden'}><label><span>${t('OpenRouter API anahtarı','OpenRouter API key')}</span><input name="openrouterApiKey" type="password" autocomplete="off" maxlength="500" placeholder="${or.hasKey?t('Değiştirmek istemiyorsanız boş bırakın','Leave blank to keep the current key'):'sk-or-...'}">${or.environmentConfigured?`<small>${t('Ortam değişkeninden okunuyor','Read from environment variable')}</small>`:or.hasKey?`<small>${t('Kaydedilmiş anahtar var','Stored key exists')}: ${esc(or.maskedKey||'')}</small>`:''}</label><label><span>${t('Model','Model')}</span><select name="openrouterModel">${orModelOpts||`<option value="${esc(or.model||'')}">meta-llama/llama-3.1-8b-instruct:free</option>`}</select></label><div class="bCpOrPolicy"><label class="bCpOrPolicyLabel"><input type="checkbox" name="openrouterDataPolicy"${orPolicy?' checked':''}>  <span>${t('İş verilerinin OpenRouter\'a gönderilebileceğini onaylıyorum','I confirm that business data may be sent to OpenRouter')}</span></label><p class="bCpOrPolicyNote">${t('Yerel model yetersiz kaldığında soru ve araç sonuçları OpenRouter\'a iletilir. Tedarikçi adları, sipariş bilgileri ve filtre içerikleri dahildir. Gönderilmesini istemediğiniz veriler varsa bu seçeneği kapatın.','When the local model is unavailable, the question and tool results are sent to OpenRouter. This includes supplier names, order data, and filter contents. Disable if you do not want this data sent.')}</p><button type="button" class="tbtn" data-bcp-test-openrouter>${t('OpenRouter\'ı Test Et','Test OpenRouter')}</button><small data-bcp-or-progress></small></div></div></div>`:'';
    const nv=aiState.nvidia||{};
    const nvEnabled=nv.enabled===true;
    const nvPolicy=nv.dataPolicy==='allowed';
    const nvModels=(nv.models||[]).filter(m=>m&&!m.deprecated);
    const nvStatusLabel=status=>({available:t('Kullanılabilir','Available'),unavailable:t('Kullanılamıyor','Unavailable'),'rate-limited':t('Oran Sınırlı','Rate Limited'),'auth-error':t('Kimlik Hatası','Auth Error'),deprecated:t('Deprecated','Deprecated')}[status]||status);
    const nvModelOpts=nvModels.map(m=>`<option value="${esc(m.modelId)}"${m.modelId===(nv.defaultModel||'')?' selected':''}>${esc(m.displayName)}</option>`).join('');
    const nvModelRows=nvModels.map(m=>`<label class="bCpNvModelRow"><input type="checkbox" name="nvModel_${esc(m.modelId)}"${m.enabled?' checked':''}> <span>${esc(m.displayName)}</span><small class="bCpNvStatus bCpNvStatus-${esc(m.status||'')}">${esc(nvStatusLabel(m.status))}</small></label>`).join('');
    const reasoningModel=nvModels.find(m=>m.reasoningParam);
    const reasoningSelect=reasoningModel?`<label><span>${t('Reasoning Effort (DeepSeek)','Reasoning effort (DeepSeek)')}</span><select name="nvidiaReasoningEffort"><option value=""${!nv.reasoningEffort?' selected':''}>${t('Varsayılan','Default')}</option>${(reasoningModel.reasoningLevels||[]).map(level=>`<option value="${esc(level)}"${nv.reasoningEffort===level?' selected':''}>${esc(level)}</option>`).join('')}</select></label>`:'';
    // Anahtar VARSA ama politika onaylı DEĞİLSE: model seçicide hiçbir şey
    // görünmez ve "Varsayılan model" seçimi etkisiz kalır — kullanıcı bunu
    // "kaydetmiyor" sanır. Kalıcı, göz ardı edilemeyecek bir uyarı (yalnız
    // geçici bir "kaydedildi" mesajı değil) bu karışıklığı önler.
    const nvPolicyMissingWarning=(nvEnabled&&nv.hasKey&&!nvPolicy)
      ?`<div class="bCpNvWarning">${t('Anahtar kayıtlı ama modeller KULLANILAMIYOR — aşağıdaki veri politikasını onaylamadan ne model seçicide görünür ne de varsayılan model olarak çalışır.','Key is stored but models are UNUSABLE — until you confirm the data policy below, nothing appears in the model picker and the default model has no effect.')}</div>`:'';
    const nvSection=canConfigure?`<div class="bCpOrSection bCpNvSection"><div class="bCpOrHeader"><label class="bCpOrToggle"><input type="checkbox" name="nvidiaEnabled"${nvEnabled?' checked':''}> <b>NVIDIA NIM</b></label><small>${t('Nemotron, DeepSeek, MiniMax, Muse Glimmer, Kimi K3 — manuel seçim ya da Auto Router.','Nemotron, DeepSeek, MiniMax, Muse Glimmer, Kimi K3 — manual pick or Auto Router.')}</small></div><div class="bCpOrBody bCpNvBody"${nvEnabled?'':' hidden'}>${nvPolicyMissingWarning}<div class="bCpOrPolicy"><label class="bCpOrPolicyLabel"><input type="checkbox" name="nvidiaDataPolicy"${nvPolicy?' checked':''}> <span><b>${t('1. adım — zorunlu:','Step 1 — required:')}</b> ${t('İş verilerinin NVIDIA NIM\'e gönderilebileceğini onaylıyorum','I confirm that business data may be sent to NVIDIA NIM')}</span></label><p class="bCpOrPolicyNote">${t('Bu kutu işaretlenmeden NVIDIA modelleri ne model seçicide görünür ne de kullanılabilir — anahtar kaydedilse bile. Seçili model kullanıldığında soru ve araç sonuçları NVIDIA\'ya iletilir. Bazı modeller (MiniMax M3) ticari olmayan kullanım lisansıyla sunulur — kullanmadan önce lisansı gözden geçirin.','Until this box is checked, NVIDIA models neither appear in the model picker nor work — even if the key is saved. When a selected model is used, the question and tool results are sent to NVIDIA. Some models (MiniMax M3) ship under a non-commercial-use license — review it before use.')}</p></div><label><span>${t('NVIDIA API anahtarı','NVIDIA API key')}</span><input name="nvidiaApiKey" data-bcp-nv-key-input type="password" autocomplete="off" maxlength="500" placeholder="${nv.hasKey?t('Değiştirmek istemiyorsanız boş bırakın','Leave blank to keep the current key'):'nvapi-...'}">${nv.environmentConfigured?`<small>${t('Ortam değişkeninden okunuyor','Read from environment variable')}</small>`:nv.hasKey?`<small>${t('Kaydedilmiş anahtar var','Stored key exists')}: ${esc(nv.maskedKey||'')}</small>`:''}<small data-bcp-nv-key-warning class="bCpNvError" hidden>${t('Bu, NVIDIA anahtarı gibi görünmüyor (nvapi- ile başlamalı) — başka bir sağlayıcının anahtarını yapıştırmış olabilirsiniz.','This doesn\'t look like an NVIDIA key (should start with nvapi-) — you may have pasted a different provider\'s key.')}</small></label><label><span>${t('Varsayılan model','Default model')}</span><select name="nvidiaDefaultModel">${nvModelOpts}</select></label>${reasoningSelect}<label class="bCpOrToggle"><input type="checkbox" name="nvidiaUseInAutoRouter"${nv.useInAutoRouter?' checked':''}> <span>${t('Auto Router\'da kullan','Use in Auto Router')}</span></label><div class="bCpNvModelList">${nvModelRows}</div><div class="bCpActions"><button type="button" class="tbtn" data-bcp-test-nvidia>${t('NVIDIA\'yı Test Et','Test NVIDIA')}</button></div><small data-bcp-nv-progress></small>${nv.lastSuccessfulConnection||nv.lastError?`<div class="bCpNvHealth">${nv.lastSuccessfulConnection?`<small>${t('Son bağlantı','Last connection')}: ${esc(new Date(nv.lastSuccessfulConnection).toLocaleString(lang()==='en'?'en-US':'tr-TR'))}</small>`:''}${nv.lastError?`<small class="bCpNvError">${t('Son hata','Last error')}: ${esc(nv.lastError)}</small>`:''}</div>`:''}</div></div>`:'';
    const settingsMarkup=canConfigure
      ? `<form data-bcp-ai-settings class="bCpManagerSettings"><div class="bCpManagerSettingsGrid"><label><span>${t('Sağlayıcı','Provider')}</span><select name="provider" data-bcp-provider><option value="ollama"${aiState.provider==='ollama'?' selected':''}>Ollama</option><option value="lmstudio"${aiState.provider==='lmstudio'?' selected':''}>LM Studio</option><option value="openai-compatible"${aiState.provider==='openai-compatible'?' selected':''}>Custom OpenAI-compatible</option></select></label><label><span>Endpoint</span><input name="endpoint" data-bcp-endpoint value="${esc(aiState.endpoint||'')}" maxlength="500" placeholder="http://127.0.0.1:11434"></label></div><label><span>${t('API anahtarı (isteğe bağlı)','API key (optional)')}</span><input name="apiKey" type="password" autocomplete="off" maxlength="500" placeholder="${t('Değiştirmek istemiyorsanız boş bırakın','Leave blank to keep the current key')}"></label><label class="bCpOrToggle"><input type="checkbox" name="localProviderEnabled"${aiState.localProviderEnabled!==false?' checked':''}> <span>${t('Yerel sağlayıcıyı Auto modda kullan','Use local provider in Auto mode')}</span></label><small class="bCpOrPolicyNote">${t('Kapatılırsa Auto/boş model seçiminde Ollama/LM Studio hiç denenmez, doğrudan NVIDIA/OpenRouter\'a gidilir. Model seçicide belirli bir yerel modeli elle seçmek bundan etkilenmez.','When off, Auto/empty model selection never tries Ollama/LM Studio — it goes straight to NVIDIA/OpenRouter. Manually picking a specific local model in the selector is unaffected.')}</small><div class="bCpActions"><button type="submit" class="tbtn primary">${t('Ayarları kaydet','Save settings')}</button></div><small data-bcp-settings-progress></small>${orSection}${nvSection}</form>`
      : `<div class="bCpNotice">${t('Sağlayıcı ve model ayarlarını yalnızca moderatör değiştirebilir.','Only moderators can change provider and model settings.')}</div>`;
    modal.innerHTML=`<div class="bCpManager" role="dialog" aria-modal="true" aria-label="${t('AI modelleri','AI models')}"><header><div><h3>${t('AI Modelleri','AI Models')}</h3><p>${t('Kurulu modelleri kullanın; indirme ve sağlayıcı ayarları moderatör yetkisindedir.','Use installed models; downloads and provider settings require moderator access.')}</p></div><button type="button" class="iconbtn" data-bcp-manager-close aria-label="${t('Kapat','Close')}">×</button></header><div class="bCpManagerBody">${renderConnectionSummary()}<label class="bCpOrToggle bCpDevModeToggle"><input type="checkbox" data-bcp-dev-mode${isDeveloperMode()?' checked':''}> <span>${t('Geliştirici Modu (bu tarayıcıda)','Developer Mode (this browser)')}</span></label><div data-bcp-model-list></div>${settingsMarkup}<form data-bcp-model-add class="bCpManagerAdd"${canConfigure?'':' aria-disabled="true"'}><label><span>${t('Model adı','Model name')}</span><input name="model" required maxlength="160" pattern="[A-Za-z0-9._:/-]{1,160}" placeholder="new-model:tag"${canConfigure?'':' disabled'}></label><button type="submit" class="tbtn primary"${canConfigure?'':' disabled'}>${t('İndir','Download')}</button></form><div class="bCpManagerProgress" data-bcp-model-progress hidden></div></div></div>`;
    document.body.appendChild(modal);managerRows(modal);
    const close=()=>modal.remove();modal.querySelector('[data-bcp-manager-close]').onclick=close;
    /* Uygulama YENİDEN BAŞLATILMADAN model listesinin tazelenmesi: Refresh
       Models yalnız /api/copilot/status'u yeniden çağırır (ucuz, herkese
       açık), Test Connection modeli seçip GERÇEK bir çıkarım dener (ağır,
       moderatöre özel). İkisi de modalı KAPATMADAN sonucu yerinde günceller.
       Blok outerHTML ile yeniden çizildiği için düğmelerin dinleyicisi
       KENDİ üzerlerine değil, modal'a (delegasyon) bağlanır — yoksa ilk
       yenilemeden sonra düğme sessizce ölü bir DOM düğümünde kalırdı. */
    const refreshConnectionBlock=message=>{
      const holder=modal.querySelector('[data-bcp-connection]');
      if(holder)holder.outerHTML=renderConnectionSummary();
      if(message){const progress=modal.querySelector('[data-bcp-connection-progress]');if(progress)progress.textContent=message;}
    };
    const settingsForm=modal.querySelector('[data-bcp-ai-settings]');
    if(settingsForm){
      const providerInput=settingsForm.querySelector('[data-bcp-provider]'),endpointInput=settingsForm.querySelector('[data-bcp-endpoint]');
      endpointInput.dataset.auto='1';
      providerInput.onchange=()=>{
        const defaults={ollama:'http://127.0.0.1:11434',lmstudio:'http://127.0.0.1:1234/v1','openai-compatible':''};
        if(endpointInput.dataset.auto==='1')endpointInput.value=defaults[providerInput.value]||'';
      };
      endpointInput.oninput=()=>{endpointInput.dataset.auto='0';};
      /* OpenRouter/NVIDIA toggle: toggle gösterir/gizler, bağımsız kaydetmeye gerek yok */
      const orToggle=settingsForm.querySelector('[name=openrouterEnabled]');
      const orBody=settingsForm.querySelector('.bCpOrBody:not(.bCpNvBody)');
      if(orToggle&&orBody){orToggle.onchange=()=>{orBody.hidden=!orToggle.checked;};}
      const nvToggle=settingsForm.querySelector('[name=nvidiaEnabled]');
      const nvBody=settingsForm.querySelector('.bCpNvBody');
      if(nvToggle&&nvBody){nvToggle.onchange=()=>{nvBody.hidden=!nvToggle.checked;};}
      // Gerçek bir kullanım vakası: kullanıcı bu alana yanlışlıkla başka bir
      // sağlayıcının anahtarını yapıştırdı (ör. OpenRouter'ın sk-or-v1-...
      // anahtarı) ve NVIDIA 401 döndürdü. Format bariz yanlışsa erken uyar.
      const nvKeyInput=settingsForm.querySelector('[data-bcp-nv-key-input]');
      const nvKeyWarning=settingsForm.querySelector('[data-bcp-nv-key-warning]');
      if(nvKeyInput&&nvKeyWarning){
        nvKeyInput.oninput=()=>{
          const value=nvKeyInput.value.trim();
          nvKeyWarning.hidden=!value||value.startsWith('nvapi-');
        };
      }
      settingsForm.onsubmit=async event=>{
        event.preventDefault();
        const progress=settingsForm.querySelector('[data-bcp-settings-progress]');
        progress.textContent=t('Kaydediliyor…','Saving…');
        try{
          const form=new FormData(settingsForm),apiKey=String(form.get('apiKey')||'').trim();
          const localProviderEnabled2=settingsForm.querySelector('[name=localProviderEnabled]')?.checked===true;
          const orApiKey=String(form.get('openrouterApiKey')||'').trim();
          const orEnabled2=settingsForm.querySelector('[name=openrouterEnabled]')?.checked===true;
          const orPolicy2=settingsForm.querySelector('[name=openrouterDataPolicy]')?.checked===true;
          const orModel2=String(form.get('openrouterModel')||'').trim();
          const nvApiKey=String(form.get('nvidiaApiKey')||'').trim();
          const nvEnabled2=settingsForm.querySelector('[name=nvidiaEnabled]')?.checked===true;
          const nvPolicy2=settingsForm.querySelector('[name=nvidiaDataPolicy]')?.checked===true;
          const nvDefaultModel2=String(form.get('nvidiaDefaultModel')||'').trim();
          const nvAutoRouter2=settingsForm.querySelector('[name=nvidiaUseInAutoRouter]')?.checked===true;
          const nvReasoningEffort2=String(form.get('nvidiaReasoningEffort')||'');
          // Her model checkbox'ı "nvModel_<modelId>" adıyla gönderilir; burada
          // { [modelId]: boolean } haritasına dönüştürülür (bkz. §10).
          const nvModelOverrides={};
          settingsForm.querySelectorAll('[name^=nvModel_]').forEach(cb=>{nvModelOverrides[cb.name.slice('nvModel_'.length)]=cb.checked===true;});
          const response=await fetch('/api/agent-platform/ai-settings',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            provider:String(form.get('provider')||''),endpoint:String(form.get('endpoint')||''),model:aiState.model,apiKey:apiKey||undefined,
            localProviderEnabled:localProviderEnabled2,
            openrouterEnabled:orEnabled2,openrouterApiKey:orApiKey||undefined,openrouterModel:orModel2||undefined,openrouterDataPolicy:orPolicy2?'allowed':'off',
            nvidiaEnabled:nvEnabled2,nvidiaApiKey:nvApiKey||undefined,nvidiaDefaultModel:nvDefaultModel2||undefined,
            nvidiaDataPolicy:nvPolicy2?'allowed':'off',nvidiaUseInAutoRouter:nvAutoRouter2,nvidiaReasoningEffort:nvReasoningEffort2,
            nvidiaModelOverrides:Object.keys(nvModelOverrides).length?nvModelOverrides:undefined,
          })});
          const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||t('Ayarlar kaydedilemedi.','Settings could not be saved.'));
          const saved=data.ai||{};await refreshStatus();aiState={...aiState,...saved};renderModelSelector();managerRows(modal);
          // Anahtar/etkinleştirme kaydedilmiş olabilir ama veri politikası
          // onaylanmadıkça NVIDIA hiçbir yerde (model seçici, varsayılan
          // model) KULLANILMAZ — bu, "kaydetmiyor" hissi veren en sık
          // karışıklık kaynağı, o yüzden burada AÇIKÇA söylenir.
          const nv2=saved.nvidia||{};
          if(nv2.enabled&&nv2.hasKey&&nv2.dataPolicy!=='allowed'){
            progress.textContent=t('Anahtar kaydedildi, ancak NVIDIA modelleri kullanılamıyor: aşağıdaki veri politikasını da onaylamanız gerekiyor.','Key saved, but NVIDIA models are unusable: you must also confirm the data policy below.');
          }else{
            progress.textContent=t('Ayarlar kaydedildi.','Settings saved.');
          }
        }catch(error){progress.textContent=error.message;}
      };
    }
    const devModeInput=modal.querySelector('[data-bcp-dev-mode]');
    if(devModeInput)devModeInput.onchange=()=>{setDeveloperMode(devModeInput.checked===true);};
    modal.addEventListener('click',async event=>{
      if(event.target===modal)return close();
      if(event.target.closest('[data-bcp-refresh-models]')){
        refreshConnectionBlock(t('Yenileniyor…','Refreshing…'));
        await refreshStatus();
        refreshConnectionBlock();managerRows(modal);renderModelSelector();
        return;
      }
      if(event.target.closest('[data-bcp-test-openrouter]')){
        const sf=modal.querySelector('[data-bcp-ai-settings]');
        const orProg=modal.querySelector('[data-bcp-or-progress]');
        if(orProg)orProg.textContent=t('Test ediliyor…','Testing…');
        try{
          const orKey=sf?String(sf.querySelector('[name=openrouterApiKey]')?.value||'').trim():'';
          const orMdl=sf?String(sf.querySelector('[name=openrouterModel]')?.value||'').trim():'';
          const rsp=await fetch('/api/agent-platform/ai-settings/test',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'openrouter',apiKey:orKey||undefined,model:orMdl||undefined})});
          const data=await rsp.json().catch(()=>({}));
          if(!rsp.ok)throw new Error(data.error||t('Bağlantı testi başarısız.','Connection test failed.'));
          const result=data.result||{};
          if(orProg)orProg.textContent=result.inference?t(`OpenRouter çalışıyor: ${result.model}`,`OpenRouter working: ${result.model}`):t('Bağlantı tamam, çıkarım doğrulanamadı.','Connection OK, inference unverified.');
        }catch(error){if(orProg)orProg.textContent=error.message;}
        return;
      }
      if(event.target.closest('[data-bcp-test-nvidia]')){
        const sf=modal.querySelector('[data-bcp-ai-settings]');
        const nvProg=modal.querySelector('[data-bcp-nv-progress]');
        if(nvProg)nvProg.textContent=t('Test ediliyor…','Testing…');
        try{
          const nvKey=sf?String(sf.querySelector('[name=nvidiaApiKey]')?.value||'').trim():'';
          const nvMdl=sf?String(sf.querySelector('[name=nvidiaDefaultModel]')?.value||'').trim():'';
          const rsp=await fetch('/api/agent-platform/ai-settings/test',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'nvidia',apiKey:nvKey||undefined,model:nvMdl||undefined})});
          const data=await rsp.json().catch(()=>({}));
          if(!rsp.ok)throw new Error(data.error||t('Bağlantı testi başarısız.','Connection test failed.'));
          const result=data.result||{};
          if(nvProg)nvProg.textContent=result.inference
            ?t(`Bağlandı · ${result.latencyMs||'—'} ms · ${result.model}`,`Connected · ${result.latencyMs||'—'} ms · ${result.model}`)
            :t('Bağlantı tamam, çıkarım doğrulanamadı.','Connection OK, inference unverified.');
        }catch(error){if(nvProg)nvProg.textContent=error.message;}
        return;
      }
      if(event.target.closest('[data-bcp-test-connection]')){
        refreshConnectionBlock(t('Test ediliyor…','Testing…'));
        let message;
        try{
          const response=await fetch('/api/agent-platform/ai-settings/test',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
          const data=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(data.error||t('Bağlantı testi başarısız.','Connection test failed.'));
          const result=data.result||{};
          message=result.inference
            ?t(`Bağlantı ve model çalışıyor: ${result.model}`,`Connection and model working: ${result.model}`)
            :t(`Bağlantı çalışıyor, model doğrulanamadı: ${result.model||''}`,`Connection working, model unverified: ${result.model||''}`);
        }catch(error){message=error.message;}
        await refreshStatus();
        refreshConnectionBlock(message);managerRows(modal);renderModelSelector();
        return;
      }
      const use=event.target.closest('[data-bcp-use-model]');
      if(use){aiState.model=use.dataset.bcpUseModel;renderModelSelector();close();return;}
      const update=event.target.closest('[data-bcp-update-model]');
      const remove=event.target.closest('[data-bcp-remove-model]');
      const model=(update||remove)?.dataset[(update?'bcpUpdateModel':'bcpRemoveModel')];
      if(!model)return;
      const action=update?'update':'remove';
      try{
        const response=await fetch(`/api/agent-platform/ai/models/${action}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||t('Model işlemi başarısız.','Model operation failed.'));
        if(action==='remove')aiState.models=(aiState.models||[]).filter(name=>name!==model);
        else if(!(aiState.models||[]).includes(model))aiState.models=[...(aiState.models||[]),model];
        managerRows(modal);renderModelSelector();
      }catch(error){const progress=modal.querySelector('[data-bcp-model-progress]');progress.hidden=false;progress.textContent=error.message;}
    });
    modal.querySelector('[data-bcp-model-add]').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,model=form.model.value.trim(),progress=modal.querySelector('[data-bcp-model-progress]');
      progress.hidden=false;progress.textContent=t('İndiriliyor…','Downloading…');
      try{
        const response=await fetch('/api/agent-platform/ai/models/pull?stream=1',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({model})});
        if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||t('Model indirilemedi.','Model could not be downloaded.'));}
        const reader=response.body&&response.body.getReader?response.body.getReader():null,decoder=new TextDecoder();let buffer='';
        while(reader){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';for(const line of lines){try{const item=JSON.parse(line);if(item.progress)progress.textContent=`${item.progress.status||t('İndiriliyor','Downloading')} · ${item.progress.percent==null?'':item.progress.percent+'%'}`;}catch(_){}}}
        aiState.models=[...(aiState.models||[]),model].filter((value,index,array)=>array.indexOf(value)===index);aiState.model=model;managerRows(modal);renderModelSelector();progress.textContent=t('Model hazır.','Model ready.');
      }catch(error){progress.textContent=error.message;}
    };
  }

  /* ------------------------------------------------- KONUŞMA GÖSTERİMİ */

  /* Modele giden pencere (son 12) kalıcılıktan ÖNCEKİYLE aynı. Aynı soru,
     kalıcılık öncesi ve sonrası aynı bağlamı görmeli. */
  function modelHistory(){
    const store=conversations(),conversation=activeConversation();
    if(!store||!conversation)return conversationHistory;
    return store.history(conversation.id);
  }

  /* Son cevap zengin biçimde çizilir; döküm o mesaja KADAR metin gösterir.
     İki gösterimin sınırı burada tutulur ki aynı mesaj iki kez görünmesin. */
  function markRichTurn(){
    const conversation=activeConversation();
    richIndex=conversation?conversation.messages.length-1:-1;
  }

  function threadCut(conversation){
    return richIndex>=0&&richIndex<=conversation.messages.length-1?richIndex:conversation.messages.length;
  }

  function renderThread(){
    const thread=root&&root.querySelector('.bCpThread');
    if(!thread)return;
    const conversation=activeConversation();
    const messages=conversation?conversation.messages.slice(0,threadCut(conversation)):[];
    thread.innerHTML=messages.map(message=>
      `<div class="bCpTurn is${message.role==='user'?'Me':'Ai'}">${esc(message.content)}</div>`).join('');
    thread.hidden=!messages.length;
    /* En sona kaydır: uzun bir konuşmada döküm başa sabit kalıyor ve
       kullanıcı kendi sorusunu göremiyordu. Bir sonraki çerçevede yapılır,
       çünkü yükseklik ancak yerleşim hesaplandıktan sonra belli olur. */
    /* requestAnimationFrame her ortamda YOK. Sona kaydırma bir iyileştirme;
       yokluğu paneli çalışmaz yapmamalı. */
    const body=root.querySelector('.bCpBody');
    const raf=global.requestAnimationFrame;
    if(body&&typeof raf==='function')raf(()=>{body.scrollTop=body.scrollHeight;});
  }

  function renderConversationList(){
    const list=root&&root.querySelector('.bCpConvList');
    const store=conversations();
    if(!list)return;
    if(!store){list.innerHTML='';return;}
    const items=store.list();
    const current=activeConversationId;
    list.innerHTML=items.map(item=>{
      const title=item.title||t('Yeni konuşma','New conversation');
      const meta=item.messageCount
        ? `${item.messageCount} ${t('mesaj','messages')}`
        : t('boş','empty');
      return `<li><button type="button" class="bCpConvItem${item.id===current?' isActive':''}" data-bcp-conv="${esc(item.id)}">
        <b>${esc(title)}</b><small>${esc(meta)}</small></button>
        <button type="button" class="bCpConvDrop" data-bcp-conv-remove="${esc(item.id)}"
          aria-label="${t('Konuşmayı sil','Delete conversation')}" title="${t('Konuşmayı sil','Delete conversation')}">×</button></li>`;
    }).join('');
    /* Kalıcı olmayan oturumda bunu SÖYLEMEK gerekir: kullanıcı konuşmasının
       saklandığını sanıp kapatırsa kaybeder. */
    const notice=root.querySelector('[data-bcp-persist-notice]');
    if(notice){
      const ephemeral=!store.persistent||store.degraded;
      notice.hidden=!ephemeral;
      notice.textContent=ephemeral
        ? t('Bu oturum kaydedilmiyor.','This session is not being saved.')
        : '';
    }
  }

  /* Arka planda gerçekten çalışan iş SAYISI. Bugün bu yalnız uçuştaki
     istektir; uydurma bir sayaç göstermek, kullanıcıya olmayan bir yetenek
     vaat etmek olurdu. */
  function renderJobs(){
    const badge=root&&root.querySelector('[data-bcp-jobs]');
    if(!badge)return;
    const queue=jobs();
    const stats=queue?queue.stats():{running:busy?1:0,queued:0,active:busy?1:0};
    badge.hidden=!stats.active;
    /* Bekleyen iş SAYILIR ama ayrı söylenir: "3 iş çalışıyor" demek,
       ikisinin sıra beklediğini gizleyip modeli üç kat hızlı sanmaya yol
       açardı. */
    badge.textContent=!stats.active?''
      :stats.queued
        ? t(`${stats.running} çalışıyor · ${stats.queued} sırada`,`${stats.running} running · ${stats.queued} queued`)
        : t(`${stats.running} iş çalışıyor`,`${stats.running} job running`);
    renderJobList(queue,stats);
  }

  const JOB_STATUS_LABEL={
    queued:['Sırada','Queued'],running:['Çalışıyor','Running'],
    done:['Bitti','Done'],failed:['Başarısız','Failed'],cancelled:['İptal edildi','Cancelled'],
  };

  /* Kuyruğu GÖRÜNÜR yapar. Rozet kaç iş olduğunu söylüyordu ama hangileri
     olduğunu ve iptal etmenin yolunu söylemiyordu — kuyruk iptali destekliyor
     olmasına rağmen kullanıcının ona ulaşacağı hiçbir yol yoktu. */
  function renderJobList(queue,stats){
    const list=root&&root.querySelector('[data-bcp-job-list]');
    const badge=root&&root.querySelector('[data-bcp-jobs]');
    if(!list||!badge)return;
    /* Rozet kaybolunca liste de kapanır: açık kalan boş bir kutu, işlerin
       hâlâ sürdüğü izlenimi verirdi. */
    if(!stats.active&&list.hidden===false){list.hidden=true;badge.setAttribute('aria-expanded','false');}
    if(list.hidden)return;
    const jobs=queue?queue.list():[];
    list.innerHTML=jobs.length?jobs.map(job=>{
      const active=job.status==='queued'||job.status==='running';
      return `<div class="bCpJobRow is${job.status}">
        <span class="bCpJobDot" aria-hidden="true"></span>
        <div class="bCpJobText"><b>${esc(job.question)}</b>
          <small>${esc(t(...JOB_STATUS_LABEL[job.status]||[job.status,job.status]))}${
            job.error?` · ${esc(job.error)}`:''}</small></div>
        ${active?`<button type="button" class="bCpJobCancel" data-bcp-job-cancel="${esc(job.id)}"
          aria-label="${t('İptal et','Cancel')}" title="${t('İptal et','Cancel')}">×</button>`:''}
      </div>`;
    }).join(''):`<div class="bCpJobEmpty">${t('İş yok.','No jobs.')}</div>`;
  }

  function paint(html){
    const live=root&&root.querySelector('.bCpLive');
    if(live)live.innerHTML=html;
    renderThread();
    renderConversationList();
    renderJobs();
    const state=root&&root.querySelector('.bCpState');
    if(state){state.textContent=aiLabel();state.className=`bCpState ${aiState.ok?'isReady':'isOff'}`;}
  }

  /* --------------------------------------------------------------- AKIŞ */

  /* SORU ARTIK DÜŞMÜYOR. Eskiden `if(busy)return;` vardı: bir cevap
     beklenirken sorulan ikinci soru sessizce kayboluyordu — kullanıcı
     yazıyor, gönderiyor, hiçbir şey olmuyor ve neden olmadığını da
     öğrenemiyordu. Artık kuyruğa giriyor. */
  async function ask(question){
    const text=String(question==null?'':question).trim();
    if(!text)return;
    lastQuestion=text;
    /* Sormak göstermeyi gerektirir. Panel kapalıyken paint() sessizce hiçbir
       şey yapıyordu; cevap üretilip hiçbir yere yazılmıyordu. */
    if(!root||root.hidden)open();
    const conversation=activeConversation();
    const conversationId=conversation?conversation.id:null;
    /* Soru CEVAPTAN ÖNCE kaydedilir ve hemen döküme girer. Cevabı bekleyip
       ikisini birlikte yazmak, istek yarıda kalırsa sorunun da kaybolması
       demekti — kullanıcı ne sorduğunu göremezdi. */
    recordMessage('user',text,conversationId);
    richIndex=-1;
    /* Ekler SORU GÖNDERİLİRKEN anlık görüntüsü alınır — kuyruk bu işi
       SONRA çalıştırabilir, o ana kadar kullanıcı yeni bir görsel ekleyip
       değiştirebilirdi. Kutu gibi (input.value='') ekler de hemen
       temizlenir: gönderildiği görülsün. */
    const attachments=pendingAttachments.slice();
    clearAttachments();
    const queue=jobs();
    /* Kuyruk modülü yüklenmediyse eski davranışa düşülür: tek uçuş, ama
       yine de koşar. Kalıcılıkta olduğu gibi, kuyruk bir ÖN KOŞUL değil. */
    if(!queue){ if(busy)return; await runAsk({question:text,conversationId,attachments}); return; }
    queue.enqueue({question:text,conversationId,attachments});
    paint(queue.stats().queued
      ? `<div class="bCpBusy"><span class="blOrb" data-state="thinking" aria-hidden="true"></span>${t('Sırada bekliyor…','Queued…')}</div>`
      : `<div class="bCpBusy"><span class="blOrb" data-state="thinking" aria-hidden="true"></span>${t('Analiz ediliyor…','Analysing…')}</div>`);
  }

  /* İşin gövdesi. `paint` yerine `show` kullanır: hangi konuşmaya
     çizileceği İŞE bağlıdır, o anda hangi konuşmaya bakıldığına değil. */
  async function runAsk(job,ctx){
    const question=job.question;
    const conversationId=job.conversationId||null;
    const attachments=Array.isArray(job.attachments)?job.attachments:[];
    const show=html=>paintInto(conversationId,html);
    /* İptalde istek GERÇEKTEN bırakılsın diye sinyal aşağı taşınır.
       Yalnız sonucu yok saymak, modeli boşuna çalıştırmaya devam
       etmek olurdu. */
    const signal=ctx&&ctx.signal;
    busy=true;
    show(`<div class="bCpBusy"><span class="blOrb" data-state="thinking" aria-hidden="true"></span>${t('Analiz ediliyor…','Analysing…')}</div>`);
    try{
      /* ÖNCE AJAN. Kullanıcının cümlesi hiçbir desene çarpmadan modele gider;
         model ne yapılacağına kendi karar verir, gerekirse çok adımlı plan
         kurar, ekranda iş yapar (ui.*) ya da onaya öneri üretir
         (action.propose). Aşağıdaki deterministic yollar yalnız AI kapalıyken
         veya ajan cevap üretemediğinde devreye girer. */
      if(aiState.ok){
        try{await askGeneralAssistant(question,{conversationId,show,signal,attachments});return;}
        catch(error){
          const recoverable=AUTOMATION_HINT.test(question.toLocaleLowerCase('tr-TR'))||parseWriteIntent(question)||routeFor(question);
          if(!recoverable){
            show(renderNotice({state:error&&error.code==='AREA_FORBIDDEN'?'PERMISSION_DENIED':'TOOL_ERROR',
              message:error&&error.message||t('Gemma yanıt üretemedi.','Gemma could not produce an answer.')}));
            return;
          }
        }
      }

      /* Otomasyon talebi. Eksik kalan her alan SORULUR: yanlış gruba giden bir
         hatırlatma e-postası, hiç gitmeyenden kötüdür. */
      if(AUTOMATION_HINT.test(question.toLocaleLowerCase('tr-TR'))){
        let groups=[];
        try{groups=(await loadAutomationState()).emailGroups||[];}
        catch(error){show(renderNotice({state:'PERMISSION_DENIED',
          message:t('Otomasyon ayarlarına erişilemedi; bu alan için yetkiniz olmayabilir.',
            'Automation settings are unavailable; you may not have access to this area.')}));return;}

        const intent=parseAutomationIntent(question,groups)||{};
        const missing=[];
        if(!intent.day)missing.push(t('hangi gün','which day'));
        if(!intent.source)missing.push(t('hangi ekran (CP, Siparişler, Backlog…)','which screen (CP, Orders, Backlog…)'));
        if(!intent.group)missing.push(t('hangi e-posta grubu','which email group'));
        if(missing.length){
          const names=groups.map(item=>item.name).filter(Boolean);
          show(renderNotice({state:'AMBIGUOUS',
            message:t(`Otomasyonu kurmak için şunu netleştirmem gerekiyor: ${missing.join(', ')}.`,
              `To set this up I need to know: ${missing.join(', ')}.`)
              +(names.length?t(`\n\nKayıtlı gruplar: ${names.join(', ')}`,`\n\nSaved groups: ${names.join(', ')}`):'')}));
          return;
        }

        const actions=global.BLCopilotActions;
        const payload=automationRecipePayload(intent);
        const proposal=actions.propose({type:'automation.recipe.create',payload,reason:question},{
          hasArea:area=>typeof global.hasArea==='function'?global.hasArea(area):true,
        });
        if(!proposal.ok){show(renderNotice({state:'AMBIGUOUS',message:proposal.reason}));return;}
        pendingProposal=proposal;
        show(renderProposal(proposal));
        return;
      }

      /* Yazma niyeti ÖNCE bakılır: "ORD siparişine not: ..." bir analiz sorusu
         değil, bir değişiklik talebidir. Öneri üretilir, HİÇBİR ŞEY YAZILMAZ. */
      const write=parseWriteIntent(question);
      if(write){
        const actions=global.BLCopilotActions;
        if(!actions){show(renderNotice({state:'TOOL_ERROR',
          message:t('Değişiklik katmanı yüklenemedi.','The change layer could not be loaded.')}));return;}
        const proposal=actions.propose(write,{
          hasArea:area=>typeof global.hasArea==='function'?global.hasArea(area):true,
          readCurrent:currentValueOf,
        });
        if(!proposal.ok){show(renderNotice({state:'AMBIGUOUS',message:proposal.reason}));return;}
        pendingProposal=proposal;
        show(renderProposal(proposal));
        return;
      }

      /* Soruyu bir araca bağla. Bağlanamıyorsa en yakın araca ZORLAMA —
         asistan ne yapabildiğini söyler. */
      const route=routeFor(question);
      if(!route){show(renderCapabilities());return;}

      if(route.id==='cpOperations'){
        const rows=await cpRows();
        const intent=parseCpQuestion(question,rows);
        if(intent.state){show(renderNotice(intent));return;}
        const result=tools.cpOperations({
          cpRows:rows,scope:intent.scope,intent,now:new Date(),freshness:freshness('CP'),
          sourceRevision:global.state&&global.state.storeRevisions&&global.state.storeRevisions.overrides||null,
        });
        lastResult=result;
        if(!result.answerable){show(renderNotice(result));return;}

        // CP'nin deterministic sonucu, model açıklamasından bağımsız görünür.
        const render=RENDERERS[result.question]||RENDERERS[route.id];
        show(render(result,null));
        if(!aiState.ok)return;
        let prose='';
        try{
          const response=await fetch('/api/copilot/explain',{method:'POST',signal,
            headers:{'Content-Type':'application/json'},credentials:'same-origin',
            body:JSON.stringify({question,result,model:aiState.model})});
          prose=(await response.json()).text||'';
        }catch(_){return;}
        if(prose&&grounding.validate(prose,result).ok)show(render(result,prose));
        return;
      }

      const rows=await observations();
      const known=classificationsOf(rows);
      const parsed=parseQuestion(question,known);
      if(!parsed.product||(route.needsSeason&&!parsed.season)){
        /* Belirsiz soruda tahmin yerine netleştirme istenir (§22). Örnek,
           kullanıcının verisinden verilir — olmayan bir ürün önermek yeni bir
           çıkmaz yaratırdı. */
        const example=known[0]||'T-Shirt';
        show(renderNotice({state:'AMBIGUOUS',
          message:route.needsSeason
            ? t(`Hangi sezon ve ürün için baktığımı netleştirir misiniz? Örneğin “S7 ${example}”.`,
                `Which season and product should I look at? For example “S7 ${example}”.`)
            : t(`Hangi ürün için baktığımı netleştirir misiniz? Örneğin “${example}”.`,
                `Which product should I look at? For example “${example}”.`)})+renderSuggestions(known));
        return;
      }

      const request={
        scope:parsed,horizon:horizon(),observations:rows,freshness:freshness(),
        sourceRevision:global.state&&global.state.storeRevisions&&global.state.storeRevisions.overrides||null,
      };

      /* Karşılaştırma iki üretici adı ister ve bu adlar VERİDEN gelir.
         Bulunamazsa kimin kastedildiği uydurulmaz, sorulur. */
      if(route.id==='compareSuppliers'){
        const names=manufacturersIn(question,rows);
        if(names.length<2){
          const candidates=scopeNames(rows,parsed).slice(0,12);
          show(renderNotice({state:'AMBIGUOUS',
            message:t(`Karşılaştırmak için iki üretici adı gerekiyor; cümlede ${names.length} tanesini tanıdım.`,
              `I need two supplier names to compare; I recognised ${names.length} in your question.`)
              +(candidates.length?t(`\n\nBu kapsamdaki üreticiler: ${candidates.join(', ')}`,
                `\n\nSuppliers in this scope: ${candidates.join(', ')}`):'')}));
          return;
        }
        request.manufacturers=names.slice(0,2);
      }

      const result=tools[route.id](request);
      lastResult=result;

      if(!result.answerable){show(renderNotice(result));return;}

      // Deterministic sonuç ÖNCE çizilir; LLM beklenmez.
      const render=RENDERERS[result.question]||RENDERERS[route.id];
      show(render(result,null));

      if(!aiState.ok)return;
      let prose='';
      try{
        const response=await fetch('/api/copilot/explain',{method:'POST',signal,
          headers:{'Content-Type':'application/json'},credentials:'same-origin',
           body:JSON.stringify({question,result,model:aiState.model})});
        prose=(await response.json()).text||'';
      }catch(_){return;}

      // Grounding geçmezse metin ATILIR; kullanıcı yapılandırılmış sonuçla kalır.
      if(prose&&grounding.validate(prose,result).ok)show(render(result,prose));
    }catch(error){
      show(`<div class="bCpNotice isError"><b>${t('Analiz tamamlanamadı','Analysis failed')}</b>${
        esc(error&&error.message||String(error))}</div>`);
    }finally{busy=false;renderJobs();}
  }

  /* ------------------------------------------------------------ PENCERE

     Çekmece MODALDI: arkasında bir örtü vardı ve uygulama tıklanamıyordu.
     Octopus'un işi tabloya bakarken soru sormak olduğu için bu yanlıştı —
     pencere artık arkadaki uygulamayı engellemiyor. Kök öğe bütün ekranı
     kaplamaya devam ediyor (pencere içinde konumlanıyor) ama tıklamayı
     GEÇİRİYOR; yalnız pencerenin kendisi yakalıyor. */

  function applyGeometry(geo){
    const shell=root&&root.querySelector('.bCpWindow');
    if(!shell)return;
    shell.style.left=geo.x+'px';
    shell.style.top=geo.y+'px';
    shell.style.width=geo.width+'px';
    shell.style.height=geo.height+'px';
    shell.dataset.minimized=geo.minimized?'1':'';
  }
  function readGeometry(){
    const store=geometry();
    const api=global.BLOctopusWindow;
    if(store)return store.read();
    return api?api.defaultGeometry({width:global.innerWidth,height:global.innerHeight}):{x:40,y:40,width:880,height:620,minimized:false};
  }
  function saveGeometry(patch){
    const store=geometry();
    const shell=root&&root.querySelector('.bCpWindow');
    if(!shell)return null;
    /* GİZLİYKEN KAYDETME. Kapatmak root'u hidden yapıyor, bu da ölçüleri
       sıfıra düşürüyor; ResizeObserver bunu bir "boyutlandırma" sanıp
       kullanıcının 880 piksellik penceresini en küçük ölçüye kalıcı olarak
       düşürüyordu. Kapatmak, boyutu unutmak demek değildir. */
    if(root.hidden||!shell.offsetWidth||!shell.offsetHeight)return null;
    const current={
      x:parseFloat(shell.style.left)||0,y:parseFloat(shell.style.top)||0,
      width:shell.offsetWidth,height:shell.offsetHeight,
      minimized:shell.dataset.minimized==='1',
      ...(patch||{}),
    };
    const next=store?store.write(current):current;
    applyGeometry(next);
    return next;
  }

  function mountWindowControls(){
    const shell=root.querySelector('.bCpWindow');
    const bar=root.querySelector('[data-bcp-drag]');
    if(!shell||!bar)return;

    /* SÜRÜKLEME. Pointer capture kullanılır: fare pencerenin dışına çıktığında
       da olaylar gelmeye devam eder. Bunsuz, hızlı bir hareket penceyi
       "yapışık" bırakıyordu. */
    let drag=null;
    bar.addEventListener('pointerdown',event=>{
      if(event.button!==0||event.target.closest('button'))return;
      drag={id:event.pointerId,dx:event.clientX-(parseFloat(shell.style.left)||0),
        dy:event.clientY-(parseFloat(shell.style.top)||0)};
      bar.setPointerCapture(event.pointerId);
      shell.dataset.dragging='1';
    });
    bar.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const api=global.BLOctopusWindow;
      const wanted={x:event.clientX-drag.dx,y:event.clientY-drag.dy,
        width:shell.offsetWidth,height:shell.offsetHeight,minimized:shell.dataset.minimized==='1'};
      /* Kırpma SÜRÜKLERKEN de uygulanır. Yalnız bırakırken uygulamak,
         kullanıcının pencereyi ekran dışına götürüp geri zıplamasını
         izlemesi demekti. */
      const view={width:global.innerWidth,height:global.innerHeight};
      applyGeometry(api?api.clampGeometry(wanted,view):wanted);
    });
    const endDrag=event=>{
      if(!drag||(event&&event.pointerId!==drag.id))return;
      drag=null;delete shell.dataset.dragging;saveGeometry();
    };
    bar.addEventListener('pointerup',endDrag);
    bar.addEventListener('pointercancel',endDrag);

    /* BOYUTLANDIRMA yerel `resize:both` ile yapılır; tarayıcı tutamağı,
       pointer yakalamayı ve en küçük ölçüyü kendisi halleder. Bize kalan
       yalnız sonucu kaydetmek. */
    if(global.ResizeObserver){
      let timer=null;
      new global.ResizeObserver(()=>{
        if(shell.dataset.minimized==='1')return;
        clearTimeout(timer);
        timer=setTimeout(()=>saveGeometry(),250);
      }).observe(shell);
    }

    /* Ekran küçüldüğünde pencere görünmez bir yerde kalabilir; her yeniden
       boyutlandırmada geometri yeniden kırpılır. */
    if(typeof global.addEventListener==='function'){
      global.addEventListener('resize',()=>{ if(root&&!root.hidden)saveGeometry(); });
    }
  }

  function toggleMinimized(force){
    const shell=root&&root.querySelector('.bCpWindow');
    if(!shell)return;
    const next=force==null?shell.dataset.minimized!=='1':Boolean(force);
    saveGeometry({minimized:next});
    if(!next){const input=root.querySelector('input[name=q]');if(input)input.focus();}
  }

  function open(){
    if(!root){
      root=document.createElement('div');
      root.className='bCpRoot';
      root.innerHTML=`<aside class="bCpWindow" role="dialog" aria-label="Octopus">
          <header class="bCpBar" data-bcp-drag>
            <div class="bCpTitle"><svg class="octoGlyph" aria-hidden="true"><use href="#i-octopus"/></svg>
              <h2>Octopus</h2><span class="bCpState"></span><span data-bcp-model-slot></span></div>
            <div class="bCpJobsWrap">
              <button type="button" class="bCpJobs" data-bcp-jobs hidden aria-expanded="false"></button>
              <div class="bCpJobList" data-bcp-job-list hidden></div>
            </div>
            <div class="bCpWinBtns">
              <button type="button" class="bCpWinBtn" data-bcp-minimize aria-label="${t('Küçült','Minimise')}" title="${t('Küçült','Minimise')}">–</button>
              <button type="button" class="bCpWinBtn" data-bcp-close aria-label="${t('Kapat','Close')}" title="${t('Kapat','Close')}">×</button>
            </div>
          </header>
          <div class="bCpMain">
            <nav class="bCpSide" aria-label="${t('Konuşmalar','Conversations')}">
              <button type="button" class="bCpNewConv" data-bcp-conv-new>+ ${t('Yeni konuşma','New conversation')}</button>
              <ul class="bCpConvList"></ul>
              <small class="bCpPersistNotice" data-bcp-persist-notice hidden></small>
              <button type="button" class="bCpConvClear" data-bcp-conv-clear>${t('Konuşmaları temizle','Clear conversations')}</button>
            </nav>
            <section class="bCpPane">
              <div class="bCpBody">
                <div class="bCpThread" hidden></div>
                <div class="bCpLive"></div>
              </div>
              <div class="bCpAttachments" data-bcp-attachments hidden></div>
              <form class="bCpAsk"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-bcp-attach-input hidden>
                <button type="button" class="iconbtn" data-bcp-attach-btn title="${t('Görsel ekle','Attach image')}" aria-label="${t('Görsel ekle','Attach image')}">📎</button>
                <input type="text" name="q" autocomplete="off"
                placeholder="${t('Octopus’a sorun…','Ask Octopus…')}">
                <button type="submit" class="tbtn primary">${t('Sor','Ask')}</button></form>
            </section>
          </div>
        </aside>`;
      document.body.appendChild(root);
      applyGeometry(readGeometry());
      mountWindowControls();

      root.addEventListener('click',event=>{
        if(event.target.closest('[data-bcp-close]')){close();return;}
        if(event.target.closest('[data-bcp-minimize]')){toggleMinimized();return;}
        const jobsToggle=event.target.closest('[data-bcp-jobs]');
        if(jobsToggle){
          const list=root.querySelector('[data-bcp-job-list]');
          list.hidden=!list.hidden;
          jobsToggle.setAttribute('aria-expanded',String(!list.hidden));
          renderJobs();
          return;
        }
        const jobCancel=event.target.closest('[data-bcp-job-cancel]');
        if(jobCancel){
          const queue=jobs();
          if(queue)queue.cancel(jobCancel.dataset.bcpJobCancel);
          renderJobs();
          return;
        }
        /* Küçültülmüş pencereye tıklamak onu geri açar: başka bir kontrol
           görünmediği için tek makul davranış bu. */
        const bar=event.target.closest('.bCpBar');
        if(bar&&root.querySelector('.bCpWindow').dataset.minimized==='1'){toggleMinimized(false);return;}
        if(event.target.closest('[data-bcp-conv-new]')){
          const store=conversations();
          if(store){activeConversationId=store.create().id;richIndex=-1;lastResult=null;pendingProposal=null;paint('');}
          return;
        }
        const pick=event.target.closest('[data-bcp-conv]');
        if(pick){
          const store=conversations();
          if(store&&store.setActive(pick.dataset.bcpConv)){
            activeConversationId=pick.dataset.bcpConv;
            /* Geçmiş bir konuşmaya dönerken zengin cevap ve bekleyen öneri
               TAŞINMAZ: onlar başka bir konuşmaya aitti ve burada onaylanmaları
               yanlış kayda yazmak olurdu. */
            richIndex=-1;lastResult=null;pendingProposal=null;
            paint('');
          }
          return;
        }
        const drop=event.target.closest('[data-bcp-conv-remove]');
        if(drop){
          const store=conversations();
          if(store){
            const id=drop.dataset.bcpConvRemove;
            store.remove(id);
            if(activeConversationId===id){activeConversationId=null;richIndex=-1;lastResult=null;pendingProposal=null;}
            paint('');
          }
          return;
        }
        if(event.target.closest('[data-bcp-conv-clear]')){
          const store=conversations();
          /* Geri alınamaz: onay sorulur. Bir tıklamayla bütün geçmişi silmek,
             yanlışlıkla yapılabilecek en pahalı hareket olurdu. */
          if(store&&global.confirm&&!global.confirm(t('Bütün konuşmalar silinsin mi?','Delete all conversations?')))return;
          if(store){store.clear();activeConversationId=null;richIndex=-1;lastResult=null;pendingProposal=null;paint('');}
          return;
        }
        const suggestion=event.target.closest('[data-bcp-ask]');
        /* Örnek soru kutuya YAZILMAZ: soru zaten döküme giriyor ve kutuda
           kalan metin bir sonraki soruya karışıyordu. */
        if(suggestion){void ask(suggestion.dataset.bcpAsk);return;}
        const temp=event.target.closest('[data-bcp-temp]');
        if(temp){
          /* Geçici kapsam yalnız bu sorgu için; kullanıcının kalıcı Horizon'u
             ve kayıtlı ayarları DEĞİŞMEZ (§15, §40). */
          root.dataset.temporaryScope=temp.dataset.bcpTemp;
          /* Soru KUTUDAN DEĞİL hafızadan okunur: kutu gönderince boşalıyor ve
             kutudan okumak boş bir sorgu gönderip sessizce hiçbir şey
             yapmamak olurdu. */
          void ask(lastQuestion);
          return;
        }
        const cancel=event.target.closest('[data-bcp-cancel]');
        if(cancel){pendingProposal=null;paint('');return;}
        const removeAttachmentBtn=event.target.closest('[data-bcp-remove-attachment]');
        if(removeAttachmentBtn){removeAttachment(Number(removeAttachmentBtn.dataset.bcpRemoveAttachment));return;}
        const confirm=event.target.closest('[data-bcp-confirm]');
        if(confirm){void applyPending(confirm.dataset.bcpConfirm);return;}
         const goto=event.target.closest('[data-bcp-goto]');
         if(goto){close();if(typeof global.switchTab==='function')global.switchTab(goto.dataset.bcpGoto);return;}
         const manage=event.target.closest('[data-bcp-manage]');
         if(manage){openModelManager();return;}
         const show=event.target.closest('[data-bcp-show]');
         if(show)showResults(show.dataset.bcpShow||'priceanalysis');
         const model=event.target.closest('[data-bcp-model]');
         if(model){
           aiState.model=model.value;
           // "Auto" ve NVIDIA/OpenRouter seçimleri yerel kurulum durumu
           // sorgusuna (refreshStatus) İHTİYAÇ DUYMAZ — o sorgu yalnız
           // yerel Ollama modelinin kurulu olup olmadığını doğrular.
           if(model.value&&!model.value.startsWith('nvidia:')&&!model.value.startsWith('openrouter:'))void refreshStatus(model.value);
           else renderModelSelector();
         }
      });
      root.querySelector('.bCpAsk').addEventListener('submit',event=>{
        event.preventDefault();
        const input=root.querySelector('input[name=q]');
        const value=input.value.trim();
        if(!value)return;
        /* KUTU GÖNDERİNCE BOŞALIR. Metin kalınca kullanıcı gönderilip
           gönderilmediğini bilemiyor ve ikinci kez basınca aynı soruyu tekrar
           soruyordu. Temizlik ask()'ten ÖNCE: ask() kuyruğa koymayı senkron
           yapıyor, sonrasına bırakmak kutuyu bir an dolu bırakırdı. */
        input.value='';
        void ask(value);
      });
      /* Görsel ekleme: buton → gizli file input; seçilen/yapıştırılan her
         dosya sırayla addAttachmentFile'a gider (o zaten tür/boyut/say
         sınırını uyguluyor). */
      const attachBtn=root.querySelector('[data-bcp-attach-btn]');
      const attachInput=root.querySelector('[data-bcp-attach-input]');
      if(attachBtn&&attachInput){
        attachBtn.onclick=()=>attachInput.click();
        attachInput.onchange=async()=>{
          const files=[...attachInput.files||[]];
          for(const file of files)await addAttachmentFile(file);
          attachInput.value='';
        };
      }
      const askInput=root.querySelector('input[name=q]');
      if(askInput&&typeof askInput.addEventListener==='function'){
        // Panoya kopyalanmış bir görsel (ör. ekran görüntüsü) doğrudan
        // soru kutusuna yapıştırılabilir — ayrı bir "dosya seç" adımı
        // gerekmez, sohbet uygulamalarındaki alışılmış davranış budur.
        askInput.addEventListener('paste',async event=>{
          const items=[...(event.clipboardData&&event.clipboardData.items||[])];
          const imageItems=items.filter(item=>item.kind==='file'&&/^image\//.test(item.type));
          if(!imageItems.length)return;
          event.preventDefault();
          for(const item of imageItems){const file=item.getAsFile();if(file)await addAttachmentFile(file);}
        });
      }
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&root&&!root.hidden)close();});
    }
    root.hidden=false;
    /* Küçültülmüş kapatılmış bir pencere AÇILIRKEN geri açılır: kullanıcı
       düğmeye "bana Octopus'u göster" diye basıyor, "küçük bir çubuk göster"
       diye değil. Konum ve boyut korunur. */
    toggleMinimized(false);
    root.querySelector('input[name=q]').focus();
    void refreshStatus();
    /* Örnekleri kurmak için veriyi okumak gerekiyor; panel bunu beklemez.
       Veri gelmezse öneri gösterilmez — uydurma bir örnek göstermekten iyidir. */
    void observations().then(rows=>{
      if(!root||root.hidden)return;
      /* Öneriler yalnız BOŞ bir konuşmada gösterilir. Eskiden .bCpBody'nin
         boşluğuna bakıyordu; artık orada döküm kabı da var ve hiçbir zaman
         boş olmuyor — kontrol canlı alana ve konuşmanın kendisine bakar. */
      const live=root.querySelector('.bCpLive');
      const conversation=activeConversation();
      const empty=live&&!live.innerHTML.trim()&&(!conversation||!conversation.messages.length);
      if(empty)paint(renderSuggestions(classificationsOf(rows)));
    }).catch(()=>{});
    paint('');
  }

  /* Onaydan sonra. Yazmayı Buyer Log'un kendi kayıt yolu yapar; buradan geçen
     tek şey onaydır. Hata — revizyon çakışması dâhil — gizlenmez, çünkü
     "kaydedildi" demek ile kaydedilmiş olmak aynı şey değildir. */
  async function applyPending(proposalId){
    const proposal=pendingProposal;
    if(!proposal){paint(renderNotice({state:'TOOL_ERROR',
      message:t('Uygulanacak öneri kalmadı.','There is no proposal left to apply.')}));return;}
    const actions=global.BLCopilotActions;
    paint(`<div class="bCpBusy"><span class="blOrb" data-state="thinking" aria-hidden="true"></span>${t('Uygulanıyor…','Applying…')}</div>`);
    const result=await actions.apply(proposal,{proposalId,confirmed:true},{
      writers,
      /* Provenance sunucuya YAZILIR: konsol satırı sayfa yenilenince kaybolur
         ve "bu değişikliği ajan mı önerdi" sorusu cevapsız kalırdı.
         Audit iş taahhüdü sınırı değildir — cevabı beklemeyiz ve bir hata
         uygulanmış değişikliği geri almaz. */
      audit:entry=>{
        try{global.console&&console.info('[Octopus] uygulandı',entry);}catch(_){}
        try{
          fetch('/api/copilot/audit',{method:'POST',credentials:'same-origin',
            headers:{'Content-Type':'application/json'},keepalive:true,
            body:JSON.stringify({proposalId:entry.proposalId,type:entry.type,payload:entry.payload,
              status:'APPLIED',reason:proposal.preview&&proposal.preview.reason||''}),
          }).catch(()=>{});
        }catch(_){}
      },
    });
    pendingProposal=null;
    if(result.ok){
      const subject=proposal.payload.orderCode
        ? t(`sipariş ${proposal.payload.orderCode}`,`order ${proposal.payload.orderCode}`)
        : proposal.payload.name||'';
      paint(`<div class="bCpNotice"><b>${t('Uygulandı','Applied')}</b>${
        esc(`${proposal.label}${subject?` — ${subject}`:''}.`)}${
        proposal.type==='automation.recipe.create'
          ? `<div class="bCpActions"><button type="button" class="tbtn" data-bcp-goto="automations">${
              t('Otomasyonlar ekranını aç','Open Automations')}</button></div>`
          : ''}</div>`);
      return;
    }
    paint(renderNotice({state:result.code==='REVISION_CONFLICT'?'CONFLICTING_DATA':'TOOL_ERROR',
      message:result.reason||t('Değişiklik uygulanamadı.','The change could not be applied.')}));
  }

  function close(){if(root){root.hidden=true;pendingProposal=null;delete root.dataset.temporaryScope;}}

  /* Cevabın dayandığı gerçek satırlara götürür (§27). Yeni bir tablo çizilmez;
     mevcut Price & Supplier Analysis ekranı açılır. */
  function showResults(target='priceanalysis'){
    close();
    const mapped=({cp:'cp',orders:'orders',backlog:'backlog',lfl:'lfl',collection:'koleksiyon',asas:'cp',ias:'overview'})[target]||'priceanalysis';
    if(typeof global.switchTab==='function')global.switchTab(mapped);
    else if(mapped==='priceanalysis'&&typeof global.initPriceSupplierAnalysis==='function')global.initPriceSupplierAnalysis();
  }

  async function refreshStatus(model=''){
    try{
      const response=await fetch(`/api/copilot/status${model?`?model=${encodeURIComponent(model)}`:''}`,{credentials:'same-origin',cache:'no-store'});
      const next=await response.json();
      const reportedModel=next.model;
      aiState=next;
      renderModelSelector();
      if(!model&&reportedModel&&aiState.model!==reportedModel&&Array.isArray(next.models)&&next.models.includes(aiState.model)){
        return refreshStatus(aiState.model);
      }
    }catch(_){aiState={...aiState,status:'AI_SERVICE_OFFLINE',ok:false};}
    const state=root&&root.querySelector('.bCpState');
    if(state){state.textContent=aiLabel();state.className=`bCpState ${aiState.ok?'isReady':'isOff'}`;}
  }

  global.BLCopilot={open,close,ask,_test:{parseQuestion,parseCpQuestion,renderAnswer,renderNotice,parseWriteIntent,
    parseAutomationIntent,automationRecipePayload,renderProposal,applyPending,
    routeFor,manufacturersIn,scopeNames,renderCapabilities,renderAssistantResponse,askGeneralAssistant,RENDERERS,ROUTES,
    automationWriter:writers['automation.recipe.create'],
    cancelPending:()=>{pendingProposal=null;},
    /* Test dikişi: kullanıcının konuşma değiştirmesini taklit eder. Arka
       planda koşan bir işin cevabının SORULDUĞU konuşmaya yazıldığını başka
       türlü doğrulamak mümkün değil. */
    setActiveConversation:id=>{const store=conversations();if(store&&store.setActive(id))activeConversationId=id;},
    /* "Yeni konuşma" düğmesinin yaptığının aynısı. Test dışarıdan ikinci bir
       depo örneği kurup oradan yaratamaz: o örnek kendi anlık görüntüsünü
       tutuyor ve boş sanıp AYNI konuşmayı geri veriyor. */
    newConversation:()=>{const store=conversations();if(!store)return null;
      activeConversationId=store.create().id;richIndex=-1;lastResult=null;pendingProposal=null;return activeConversationId;},
    activeConversationId:()=>activeConversationId,
    jobStats:()=>{const queue=jobs();return queue?queue.stats():null;},
    /* Kuyruğun kendisi: test iptali arayüzle AYNI yoldan (kimlikle) yapabilsin. */
    jobs:()=>jobs()}};
  /* Marka adı Octopus; TANIMLAYICI eski hâlinde kalır. BLCopilot'ı silmek
     app-main.js'teki çağrıyı, testleri ve kullanıcıların açık sekmelerindeki
     önbellekli betikleri kırardı — bir isim değişikliğinin bedeli bu olamaz.
     Yeni ad aynı nesneye takma addır; ikisi de aynı şeyi işaret eder. */
  global.BLOctopus=global.BLCopilot;
})(window);
