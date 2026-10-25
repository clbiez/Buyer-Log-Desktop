/* Buyer Log Automations — v6.29
 * No-code deterministic automations. The user chooses the job goal first;
 * browser recording, scheduled e-mail/reporting, data analysis and Buyer Log
 * actions are purpose-specific views. Agent Workflow Studio remains separate.
 */
(() => {
  'use strict';
  const root=()=>document.getElementById('automationStudio');
  const tr=(a,b)=>(window.appLang||document.documentElement.lang||'tr').toLowerCase().startsWith('en')?b:a;
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clone=v=>JSON.parse(JSON.stringify(v));
  const toast=msg=>typeof window.showToast==='function'?window.showToast(msg):null;
  const SOURCES=['cp','orders','backlog','lfl','collection','asas','ias'];
  SOURCES.push('intake');
  // Backward compatibility examples only: the v5.57 UI never asks users to type
  // these expressions. Internally a field binding becomes {{item.Alan}} or
  // {{item.Sipariş Kod}} when the deterministic browser runner executes it.
  // Arama kutuları ve framework kontrollü alanlarda recorder keeps focus/click and
  // actual-value fallbacks so enterprise search widgets remain replayable.
  const PURPOSES={
    browser:{icon:'🌐',tr:'Dış web işlemi',en:'External web task',descTr:'Bir web sitesinde yaptığınız adımları kaydet ve Buyer Log verileriyle tekrar uygula.',descEn:'Record a process on a website and replay it with Buyer Log data.'},
    email:{icon:'✉',tr:'E-posta / periyodik rapor',en:'Email / scheduled report',descTr:'Kayıtlı e-posta gruplarına filtreli rapor veya sorgu e-postası oluştur; istersen düzenli çalıştır.',descEn:'Create filtered reports or query emails for saved groups and optionally schedule them.'},
    analysis:{icon:'▥',tr:'Veri sorgulama / analiz',en:'Data query / analysis',descTr:'CP, Orders, Backlog, LFL, Koleksiyon veya INTAKE verisini koşullarla sorgula ve özetle.',descEn:'Query and summarize CP, Orders, Backlog, LFL, Collection or INTAKE data.'},
    app:{icon:'◫',tr:'Buyer Log içi işlem',en:'Buyer Log task',descTr:'Buyer Log sayfalarını açma, veri yenileme ve rapor gösterme gibi uygulama içi adımları sırala.',descEn:'Sequence in-app actions such as opening pages, refreshing data and showing reports.'},
    mixed:{icon:'⌘',tr:'Karma otomasyon',en:'Mixed automation',descTr:'Veri sorgusu, Buyer Log işlemi, web adımları ve e-postayı tek otomasyonda birleştir.',descEn:'Combine data queries, Buyer Log actions, web steps and email in one automation.'},
  };
  /* v7.175 — Otomasyon asistanı (public/automation-assistant.js): şablonlar,
     düz dille özet, "Hazır mı?" denetimi. Saf yardımcıdır; yüklenmemişse ekran
     eski hâliyle çalışmaya devam eder. */
  const assistant=()=>window.BLAutomationAssistant||null;
  let state=null,draft=null,dirty=false,recording=null,recordTimer=null,fieldCache=new Map(),fieldValueCache=new Map(),fieldValuePending=new Map();

  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let data=null;try{data=await r.json();}catch(_){}if(!r.ok){const e=new Error(data&&data.error||`${tr('İstek başarısız','Request failed')} (${r.status})`);e.code=data&&data.code;e.details=data&&data.details;throw e;}return data;}
  function emptyRecipe(purpose='browser'){return{id:'',name:tr('Yeni otomasyon','New automation'),description:'',enabled:true,purpose,url:'',source:purpose==='browser'?'manual':'cp',filters:[],limit:50,timeoutMs:12000,continueOnError:false,successText:'',terminalCode:'',steps:[],email:{groupId:'',subject:'Buyer Log Raporu',body:'',includeReport:true,reportFields:[],deliveryMode:'draft',openDraftOnManual:true,languageMode:'tr',subjectEn:'',bodyEn:''},backlog:{targetType:'retail',requireTransitRule:true,routing:{}},schedule:{enabled:false,mode:'manual',time:'09:00',weekdays:[1],intervalHours:24},analysis:{groupBy:'',valueField:'',operation:'count',topN:15},appActions:[]};}
  function markDirty(v=true){dirty=Boolean(v);renderSaveState();renderGuide();}
  function recipeList(){return state&&Array.isArray(state.recipes)?state.recipes:[];}
  function runList(){return state&&Array.isArray(state.runs)?state.runs:[];}
  function groups(){return state&&Array.isArray(state.emailGroups)?state.emailGroups:[];}
  function purposeMeta(key){return PURPOSES[key]||PURPOSES.browser;}
  function purposeLabel(key){const m=purposeMeta(key);return tr(m.tr,m.en);}
  function hasBrowser(){return['browser','mixed'].includes(draft&&draft.purpose);}
  function hasEmail(){return['email','mixed'].includes(draft&&draft.purpose);}
  function hasAnalysis(){return['analysis','email','app','mixed'].includes(draft&&draft.purpose);}
  function hasApp(){return['app','mixed'].includes(draft&&draft.purpose);}
  function actionLabel(action){return({goto:tr('Siteyi aç','Open site'),click:tr('Tıkla','Click'),dblclick:tr('Çift tıkla','Double click'),fill:tr('Yaz','Fill'),select:tr('Seç','Select'),press:tr('Tuş','Key'),check:tr('İşaretle','Check'),uncheck:tr('İşareti kaldır','Uncheck'),wait:tr('Bekle','Wait'),assert:tr('Doğrula','Verify'),assert_text:tr('Metni doğrula','Verify text')})[action]||action;}
  function targetSummary(step){const t=(step.targets||[])[0];if(!t)return step.url||'—';if(t.strategy==='role')return `${t.role||'element'} · ${t.name||t.selector}`;return `${t.strategy}: ${t.selector}`;}
  function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):new Intl.DateTimeFormat(tr('tr-TR','en-GB'),{dateStyle:'short',timeStyle:'short'}).format(d);}
  function sourceLabel(v){const key=String(v||'').toLowerCase();return({manual:tr('Manuel · tek kayıt','Manual · one item'),cp:'CP',orders:tr('Siparişler','Orders'),backlog:'Backlog',lfl:'LFL',collection:tr('Koleksiyon','Collection'),asas:'ASAS · Database',ias:'IAS · Database',intake:'INTAKE · Database'})[key]||String(v||'').toUpperCase();}

  function renderShell(){const host=root();if(!host)return;host.innerHTML=`<div class="autoShell">
    <header class="autoHeader"><div><span class="autoEyebrow">BUYER LOG · NO-CODE AUTOMATION</span><h2>${esc(tr('Otomasyonlar','Automations'))}</h2><p>${esc(tr('Tekrarlayan işleri Buyer Log’a bırakın: gecikme bildirimleri, düzenli rapor e-postaları, veri özetleri ve web işlemleri — kod yazmadan. “Yeni Otomasyon” ile hazır bir senaryo seçerek başlayın.','Hand repeated work to Buyer Log: delay notices, regular report emails, data summaries and web tasks — without code. Start with “New Automation” and pick a ready-made scenario.'))}</p></div><div class="autoHeaderActions"><span id="autoBrowserBadge" class="autoBadge"></span><button class="tbtn" data-auto-settings><svg class="ic" aria-hidden="true"><use href="#i-settings"/></svg> ${esc(tr('Ayarlar','Settings'))}</button><button class="tbtn primary" data-auto-new>＋ ${esc(tr('Yeni Otomasyon','New Automation'))}</button></div></header>
    <div id="autoStatChips" class="autoStatChips"></div>
    <div id="autoPendingBanner" class="autoPendingBanner" hidden></div>
    <div class="autoWorkspace"><aside class="autoSidebar"><div class="autoSideHead"><b>${esc(tr('Kayıtlı Otomasyonlar','Saved Automations'))}</b><span id="autoRecipeCount"></span></div><div id="autoRecipeList" class="autoRecipeList"></div><div class="autoRuns"><div class="autoSideHead"><b>${esc(tr('Son Çalışmalar','Recent Runs'))}</b></div><div id="autoRunList" class="autoRunList"></div></div></aside><main class="autoEditor" id="autoEditor"></main></div>
  </div>`;
    host.querySelector('[data-auto-new]').onclick=showCreatePicker;host.querySelector('[data-auto-settings]').onclick=openSettings;renderAll();loadPendingTriggers();}

  /* ===================================================================
     v6.37 — OTOMASYON PANOSU ve İKİ YOLLU OLUŞTURMA
     Ekran artık doğrudan editöre düşmüyor. Önce mevcut otomasyonların DURUMU
     görünüyor (kaç tanesi aktif, son 7 günde ne oldu, sıradaki çalışma ne
     zaman), sonra "Otomasyon Oluştur" iki yola ayrılıyor: kod bilmeyen için
     Basit Arayüz, moderatör için Terminal.
     =================================================================== */
  const WEEKDAY_LABELS_TR=['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  const WEEKDAY_LABELS_EN=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  // Tarifin ne yaptığını DÜZ CÜMLEYLE anlatır. Kullanıcı soyut yapıyı değil
  // cümleyi okur; bu yüzden özet kartın merkezinde durur.
  function describeRecipe(item){
    const parts=[];
    const sch=item.schedule||{};
    if(sch.enabled&&sch.mode==='weekly'){
      const days=(sch.weekdays||[]).map(d=>tr(WEEKDAY_LABELS_TR[d]||'',WEEKDAY_LABELS_EN[d]||'')).filter(Boolean);
      if(days.length)parts.push(tr(`Her ${days.join(', ')} ${sch.time||'09:00'}`,`Every ${days.join(', ')} at ${sch.time||'09:00'}`));
    }else if(sch.enabled&&sch.mode==='daily'){
      parts.push(tr(`Her gün ${sch.time||'09:00'}`,`Every day at ${sch.time||'09:00'}`));
    }else if(sch.enabled&&sch.mode==='interval'){
      parts.push(tr(`Her ${sch.everyMinutes||60} dakikada`,`Every ${sch.everyMinutes||60} minutes`));
    }else{
      parts.push(tr('Elle çalıştırıldığında','When run manually'));
    }
    if(item.source&&item.source!=='manual'){
      const count=(item.filters||[]).length;
      parts.push(count
        ? tr(`${sourceLabel(item.source)} verisinde ${count} koşula uyan kayıtlar`,`records in ${sourceLabel(item.source)} matching ${count} condition(s)`)
        : tr(`${sourceLabel(item.source)} verisindeki kayıtlar`,`records in ${sourceLabel(item.source)}`));
    }
    const email=item.email||{};
    if(['email','mixed'].includes(item.purpose)){
      if(email.recipientMode==='field'&&email.recipientField){
        parts.push(tr(`${email.recipientField} alanına göre gruplanıp her birine ayrı e-posta gönderilir`,`grouped by ${email.recipientField}, one email each`));
      }else{
        const group=groups().find(g=>g.id===email.groupId);
        parts.push(group?tr(`${group.name} grubuna e-posta gönderilir`,`emailed to ${group.name}`):tr('bir e-posta grubuna gönderilir','emailed to a group'));
      }
    }
    return parts.join(' · ');
  }
  // Bir sonraki çalışma zamanı. Kaçırılan tetik mantığıyla aynı takvimi kullanır,
  // ama ileriye bakar.
  function nextRunAt(item){
    const sch=item.schedule||{};
    if(item.enabled===false||!sch.enabled||!['daily','weekly'].includes(sch.mode))return null;
    const [hh,mm]=String(sch.time||'09:00').split(':').map(Number);
    if(!Number.isFinite(hh)||!Number.isFinite(mm))return null;
    const now=new Date();
    for(let ahead=0;ahead<=14;ahead++){
      const day=new Date(now.getFullYear(),now.getMonth(),now.getDate()+ahead,hh,mm,0,0);
      if(day<=now)continue;
      if(sch.mode==='weekly'&&!(sch.weekdays||[]).includes(day.getDay()))continue;
      return day;
    }
    return null;
  }
  function lastRunFor(item){
    return runList().find(run=>run.recipeId===item.id)||null;
  }
  // Pano üstündeki üç sayı. "Son 7 gün" penceresi bilinçli: daha uzun bir
  // pencere hata olup olmadığını gizler.
  function dashboardStats(){
    const since=Date.now()-7*24*60*60*1000;
    const recent=runList().filter(run=>Date.parse(run.createdAt||'')>=since);
    const emails=recent.reduce((n,run)=>{
      const email=run.result&&run.result.email;
      if(!email)return n;
      return n+(Number(email.messageCount)||1);
    },0);
    return {
      active:recipeList().filter(item=>item.enabled!==false&&item.schedule&&item.schedule.enabled).length,
      emails,
      failed:recent.filter(run=>['failed','partial','interrupted'].includes(run.status)).length,
    };
  }
  /* v6.37 — Oluşturma yolu seçimi. Kullanıcının iki farklı senaryosu var:
     kod yazabilen ve dış sitelere giden Terminal, ve hiç kod bilmeyen için
     yönlendirmeli Basit Arayüz. Terminal yalnız moderatörde: dış siteye gidip
     veri çeken kod yazılabildiği için yetki sınırı burada. */
  /* v7.175 — "NE YAPMAK İSTİYORSUNUZ?"
     Kullanıcı talebi: "Otomasyon alanı da buna benzer kolaylıkta olsun,
     acemiler bile kolaylıkla kullanabilsin." Pencere artık soyut bir iş türü
     değil, gerçek işlere benzeyen hazır senaryolar sunar; seçilen senaryo DOLU
     bir otomasyonla açılır ve eksik kalan birkaç seçimi "Hazır mı?" listesi
     gösterir. Sıfırdan kurmak (Basit Arayüz), AI ile yazmak ve moderatör için
     Terminal aynı pencerede ikincil yollar olarak durur. Hiçbir şablon gerçek
     gönderim kurmaz; kayıt ve çalıştırma yine kullanıcının onayıyla olur. */
  function closeAutomationModal(modal){
    if(!modal)return;
    window.BLLayerSystem?.closeDialog(modal);
    modal.remove();
  }
  function mountAutomationModal(modal){
    const card=modal.querySelector('.autoModal');
    if(card){card.setAttribute('role','dialog');const title=card.querySelector('h3,h2');if(title){title.id=modal.id+'Title';card.setAttribute('aria-labelledby',title.id);}}
    modal.querySelectorAll('[data-close]').forEach(button=>button.setAttribute('aria-label',tr('Kapat','Close')));
    window.BLLayerSystem?.openDialog(modal,{onClose:()=>closeAutomationModal(modal)});
  }
  function showCreatePicker(){
    closeAutomationModal(document.getElementById('_autoCreate'));
    const canTerminal=Boolean(state&&state.canConfigure);
    const A=assistant(),templates=A?A.TEMPLATES:[];
    const modal=document.createElement('div');
    modal.id='_autoCreate';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';
    modal.innerHTML=`<div class="autoModal purpose autoTemplateModal"><header><div><span class="autoEyebrow">${esc(tr('OTOMASYON OLUŞTUR','CREATE AUTOMATION'))}</span><h3>${esc(tr('Ne yapmak istiyorsunuz?','What do you want to do?'))}</h3><p>${esc(tr('Size en yakın işi seçin; otomasyon dolu bir örnekle açılır. Eksik kalan birkaç seçimi “Hazır mı?” listesi gösterir. Siz kaydedip çalıştırmadan hiçbir şey gönderilmez.','Pick the job closest to yours; the automation opens pre-filled. The “Ready?” list shows the few choices left. Nothing is sent until you save and run it.'))}</p></div><button data-close>×</button></header>
      <div class="autoTemplateBody"><div class="autoTemplateGrid">${templates.map((t,index)=>`<button type="button" class="autoTemplateCard" data-create-template="${esc(t.id)}"><span class="autoTemplateIcon" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><strong>${esc(tr(t.tr,t.en))}</strong><span>${esc(tr(t.descTr,t.descEn))}</span></button>`).join('')}</div>
      <div class="autoTemplateMore"><div class="autoTemplateMoreHead">${esc(tr('Listede yok mu? Başka bir yol seçin:','Not listed? Pick another way:'))}</div><div class="autoPurposeGrid">
      <button type="button" data-create-path="ai" class="autoPurposeCard"><strong>${esc(tr('LCW AI’dan Destek Al','Get help from LCW AI'))}</strong><span>${esc(tr('Ne istediğinizi kendi cümlenizle yazın; LCW AI (GPT-6 Sol) otomasyonu yazsın. Buyer Log denetler ve kapalı bir taslak oluşturur.','Describe what you want in your own words; LCW AI (GPT-6 Sol) writes the automation. Buyer Log checks it and creates a disabled draft.'))}</span></button>
      <button type="button" data-create-path="simple" class="autoPurposeCard"><strong>${esc(tr('Sıfırdan kur (Basit Arayüz)','Start from scratch (Simple builder)'))}</strong><span>${esc(tr('Boş bir otomasyonla başlayın; iş türünü seçin, adım adım doldurun. Kod yazılmaz.','Start with an empty automation; pick the job type and fill it in step by step. No code.'))}</span></button>
      <button type="button" data-create-path="terminal" class="autoPurposeCard${canTerminal?'':' isLocked'}"${canTerminal?'':' disabled'}><strong>${esc(tr('Terminal','Terminal'))}</strong><span>${esc(canTerminal?tr('Kod yazarak kurulur. PLM gibi dış sitelere gidip işlem yapabilir, tarayıcı adımları kaydedilebilir.','Built by writing code. Can visit external sites such as PLM and record browser steps.'):tr('Kod yazarak dış sitelere giden otomasyonlar yalnız moderatör yetkisiyle kurulabilir.','Automations that visit external sites with code can only be created by a moderator.'))}</span></button>
    </div></div></div><footer><button class="tbtn" data-close>${esc(tr('Vazgeç','Cancel'))}</button></footer></div>`;
    document.body.appendChild(modal);mountAutomationModal(modal);
    modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());
    modal.onclick=e=>{if(e.target===modal)closeAutomationModal(modal);};
    modal.querySelectorAll('[data-create-template]').forEach(b=>b.onclick=()=>{closeAutomationModal(modal);applyTemplate(b.dataset.createTemplate);});
    modal.querySelector('[data-create-path="ai"]').onclick=()=>{closeAutomationModal(modal);if(window.BLAiAutomationImport&&typeof window.BLAiAutomationImport.open==='function')window.BLAiAutomationImport.open();else toast(tr('LCW AI yardımcısı henüz yükleniyor; birazdan tekrar deneyin.','The LCW AI helper is still loading; try again in a moment.'));};
    modal.querySelector('[data-create-path="simple"]').onclick=()=>{closeAutomationModal(modal);showPurposeChooser();};
    const terminalBtn=modal.querySelector('[data-create-path="terminal"]');
    if(canTerminal)terminalBtn.onclick=()=>{
      closeAutomationModal(modal);abandonRecording();
      // Terminal yolu doğrudan web işi olarak açılır; kod alanı zaten bu türde görünür.
      draft=emptyRecipe('browser');dirty=false;renderAll();
      toast(tr('Terminal otomasyonu oluşturuldu. Kod alanına yazabilirsiniz.','Terminal automation created. You can write code in the code area.'));
    };
  }
  // Şablonun kısmi tarifini boş tarifin üstüne yazar (alt nesneler birleştirilir).
  function mergeRecipe(base,patch){const out={...base};for(const [key,value] of Object.entries(patch||{})){out[key]=value&&typeof value==='object'&&!Array.isArray(value)&&base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key])?{...base[key],...clone(value)}:clone(value);}return out;}
  async function applyTemplate(id){
    const A=assistant(),template=A&&A.TEMPLATES.find(item=>item.id===id);
    if(!template)return;
    if(dirty&&!confirm(tr('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?','Unsaved changes will be lost. Continue?')))return;
    abandonRecording();
    draft=mergeRecipe(emptyRecipe(template.purpose),template.patch);
    draft.name=tr(template.tr,template.en);
    draft.description=tr(template.descTr,template.descEn);
    dirty=true;
    if(draft.source!=='manual')await loadFields(draft.source).catch(e=>toast(e.message));
    renderAll();
    toast(tr('Şablon hazır. Üstteki “Hazır mı?” listesindeki eksikleri tamamlayın, “Dene” ile sonucu görün ve kaydedin.','Template ready. Complete the items in the “Ready?” list above, “Try” to see the result, then save.'));
  }
  function showPurposeChooser(){closeAutomationModal(document.getElementById('_autoPurpose'));const modal=document.createElement('div');modal.id='_autoPurpose';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';modal.innerHTML=`<div class="autoModal purpose"><header><div><span class="autoEyebrow">${esc(tr('1. ADIM','STEP 1'))}</span><h3>${esc(tr('Bu otomasyonun temel işi nedir?','What is the main job of this automation?'))}</h3><p>${esc(tr('Seçiminize göre yalnız gerekli alanları göstereceğiz. Daha sonra otomasyonu kopyalayabilir veya karma türe çevirebilirsiniz.','We will show only the fields needed for that job. You can duplicate it or switch to mixed later.'))}</p></div><button data-close>×</button></header><div class="autoPurposeGrid">${Object.entries(PURPOSES).map(([key,m])=>`<button type="button" data-purpose="${key}" class="autoPurposeCard"><strong>${esc(tr(m.tr,m.en))}</strong><span>${esc(tr(m.descTr,m.descEn))}</span></button>`).join('')}</div><footer><button class="tbtn" data-close>${esc(tr('Vazgeç','Cancel'))}</button></footer></div>`;document.body.appendChild(modal);mountAutomationModal(modal);modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());modal.querySelectorAll('[data-purpose]').forEach(b=>b.onclick=()=>{abandonRecording();draft=emptyRecipe(b.dataset.purpose);dirty=false;closeAutomationModal(modal);renderAll();});}

  /* v6.36 — KAÇIRILAN TETİK UYARISI.
     Sunucu son pencere kapanınca kapandığı için planlı bir otomasyon saatinde
     çalışamamış olabilir. Tolerans penceresi geçmiş tetikler artık sessizce geç
     çalıştırılmıyor; burada kullanıcıya gösterilip kararı soruluyor. */
  let pendingTriggers=[];
  async function loadPendingTriggers(){
    try{const data=await api('/api/automations/pending-triggers');pendingTriggers=Array.isArray(data.pending)?data.pending:[];}
    catch(_){pendingTriggers=[];}
    renderPendingTriggers();
  }
  function renderPendingTriggers(){
    const host=document.getElementById('autoPendingBanner');
    if(!host)return;
    if(!pendingTriggers.length){host.hidden=true;host.innerHTML='';return;}
    const lateText=item=>{
      const h=Math.floor(item.lateMinutes/60);
      return h<24?tr(`${h} saat gecikti`,`${h}h late`):tr(`${Math.floor(h/24)} gün gecikti`,`${Math.floor(h/24)}d late`);
    };
    host.hidden=false;
    host.innerHTML=`<div class="autoPendingCard"><div><b>${esc(tr('Zamanı geçmiş otomasyon var','Missed automation triggers'))}</b><small>${esc(tr('Bu otomasyonların planlanan saatinde Buyer Log kapalıydı. Sizin onayınız olmadan gönderim yapılmadı.','Buyer Log was closed at the scheduled time for these automations. Nothing was sent without your approval.'))}</small><ul>${pendingTriggers.map(item=>`<li><b>${esc(item.name)}</b> · ${esc(fmtDate(item.dueAt))} · ${esc(lateText(item))}</li>`).join('')}</ul></div><div class="autoPendingActions"><button class="tbtn primary" data-pending-run>${esc(tr('Şimdi çalıştır','Run now'))}</button><button class="tbtn" data-pending-skip>${esc(tr('Atla','Skip'))}</button></div></div>`;
    host.querySelector('[data-pending-run]').onclick=async()=>{
      try{const data=await api('/api/automations/pending-triggers/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
        pendingTriggers=data.pending||[];if(data.state)state=data.state;renderAll();renderPendingTriggers();
        const failed=(data.results||[]).filter(r=>r.status==='failed').length;
        toast(failed?tr(`${failed} otomasyon hata verdi.`,`${failed} automation(s) failed.`):tr('Kaçırılan otomasyonlar çalıştırıldı.','Missed automations were run.'));
      }catch(e){toast(e.message);}
    };
    host.querySelector('[data-pending-skip]').onclick=async()=>{
      try{const data=await api('/api/automations/pending-triggers/skip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
        pendingTriggers=data.pending||[];renderPendingTriggers();toast(tr('Kaçırılan tetikler atlandı.','Missed triggers skipped.'));
      }catch(e){toast(e.message);}
    };
  }
  function renderTop(){const badge=document.getElementById('autoBrowserBadge');if(!badge||!state)return;const count=(state.browser&&state.browser.allowedHosts||[]).length;badge.className=`autoBadge ${count?'isOn':'isWarn'}`;badge.textContent=count?`${tr('Web motoru hazır','Web engine ready')} · ${count} host`:tr('Web allowlist boş','Web allowlist empty');}
  function renderRecipes(){
    const host=document.getElementById('autoRecipeList'),count=document.getElementById('autoRecipeCount');
    if(!host)return;
    const items=recipeList();
    if(count)count.textContent=String(items.length);
    // v6.37 — kart artık yalnız ad değil DURUM taşıyor: ne yaptığı düz cümleyle,
    // son çalışma sonucu ve sıradaki çalışma. Kullanıcı otomasyonu açmadan
    // çalışıp çalışmadığını görebilmeli.
    const runBadge=item=>{
      const run=lastRunFor(item);
      if(!run)return `<em class="autoRecipeRun none">${esc(tr('Henüz çalışmadı','Never run'))}</em>`;
      const label=runStatus(run.status);
      return `<em class="autoRecipeRun ${esc(run.status)}">${esc(label)} · ${esc(fmtDate(run.createdAt))}</em>`;
    };
    const nextBadge=item=>{
      const next=nextRunAt(item);
      return next?`<em class="autoRecipeNext">${esc(tr('sıradaki','next'))}: ${esc(fmtDate(next.toISOString()))}</em>`:'';
    };
    host.innerHTML=items.length?items.map(item=>`<button type="button" class="autoRecipe${draft&&draft.id===item.id?' active':''}" data-auto-recipe="${esc(item.id)}"><span><b>${esc(item.name)}</b><small>${esc(purposeLabel(item.purpose))} · ${esc(sourceLabel(item.source))}</small><u class="autoRecipeSummary">${esc(describeRecipe(item))}</u><span class="autoRecipeMeta">${runBadge(item)}${nextBadge(item)}</span></span><i class="${item.enabled===false?'off':'on'}"></i></button>`).join(''):`<div class="autoEmpty">${esc(tr('Henüz otomasyon yok. Otomasyon Oluştur ile başlayın.','No automations yet. Start with Create Automation.'))}</div>`;
    host.querySelectorAll('[data-auto-recipe]').forEach(btn=>btn.onclick=()=>selectRecipe(btn.dataset.autoRecipe));
  }
  // Pano üstündeki üç sayı.
  function renderDashboardStats(){
    const host=document.getElementById('autoStatChips');
    if(!host)return;
    const stats=dashboardStats();
    host.innerHTML=`<span class="autoStatChip"><b>${stats.active}</b>${esc(tr('planlı otomasyon','scheduled'))}</span><span class="autoStatChip"><b>${stats.emails}</b>${esc(tr('son 7 günde e-posta','emails last 7d'))}</span><span class="autoStatChip${stats.failed?' isWarn':''}"><b>${stats.failed}</b>${esc(tr('hata','failed'))}</span>`;
  }
  function runStatus(status){return ({reserved:tr('Bekliyor','Pending'),running:tr('Çalışıyor','Running'),completed:tr('Tamamlandı','Completed'),partial:tr('Kısmen tamamlandı','Partially completed'),interrupted:tr('Yarım kaldı; kontrol gerekli','Interrupted; review required'),skipped:tr('Atlandı','Skipped'),failed:tr('Başarısız','Failed'),dry_run:tr('Deneme','Dry run')})[status]||status;}
  function renderRuns(){const host=document.getElementById('autoRunList');if(!host)return;const runs=runList().slice(0,14);host.innerHTML=runs.length?runs.map(run=>`<div class="autoRun"><span class="autoRunDot ${esc(run.status)}"></span><div><b>${esc(run.recipeName||tr('Otomasyon','Automation'))}</b><small>${esc((run.trigger==='schedule'?tr('planlı','scheduled')+' · ':'')+runStatus(run.status))} · ${fmtDate(run.createdAt)}</small>${run.message?`<em>${esc(run.message==='AUTOMATION_RECONCILE_REQUIRED'?tr('Uygulama çalışma sırasında kapandı veya işlem süresi doldu. Gerçek sonucu kontrol edin; otomatik tekrar yapılmadı.','The app closed during execution or the reservation expired. Verify the actual result; it was not automatically replayed.'):run.message==='AUTOMATION_NO_MATCH'?tr('Filtrelere uyan kayıt yok.','No matching records.'):run.message)}</em>`:''}${run.result&&run.result.email&&run.result.email.draftUrl?`<a class="autoRunLink" href="${esc(run.result.email.draftUrl)}">${esc(tr('E-posta taslağı','Email draft'))}</a>`:''}</div><strong>${Number(run.processed)||0}${run.failed?` / <u>${Number(run.failed)}</u>`:''}</strong></div>`).join(''):`<div class="autoEmpty small">${esc(tr('Çalışma geçmişi yok.','No run history.'))}</div>`;}
  function filterOperatorOptions(selected){const opts=[['eq',tr('eşittir','equals')],['neq',tr('eşit değil','is not')],['contains',tr('içerir','contains')],['starts_with',tr('ile başlar','starts with')],['in',tr('şunlardan biri (virgülle)','is one of (comma list)')],['empty',tr('boş','is empty')],['not_empty',tr('dolu','is not empty')],['changed',tr('Değiştiğinde','When changed')],['gt',tr('> büyük / sonra','> greater / after')],['gte',tr('≥ en az / o gün ya da sonra','≥ at least / on or after')],['lt',tr('< küçük / önce','< less / before')],['lte',tr('≤ en fazla / o gün ya da önce','≤ at most / on or before')]];return opts.map(([v,l])=>`<option value="${v}"${selected===v?' selected':''}>${esc(l)}</option>`).join('');}
  function fieldOptions(source,selected,blank=tr('Alan seç','Choose field')){const fields=fieldCache.get(source)||[];return `<option value="">${esc(blank)}</option>${fields.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(v)}</option>`).join('')}`;}
  function fieldListHtml(source,id){const fields=fieldCache.get(source)||[];return `<datalist id="${esc(id)}">${fields.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`;}
  function valueCacheKey(source,field){return`${source}\u001f${field}`;}
  async function loadFieldValues(source,field){const f=String(field||'').trim();if(!f)return[];const key=valueCacheKey(source,f);if(fieldValueCache.has(key))return fieldValueCache.get(key);if(fieldValuePending.has(key))return fieldValuePending.get(key);const job=api(`/api/automations/dataset-values?source=${encodeURIComponent(source)}&field=${encodeURIComponent(f)}`).then(data=>{const values=data.values||[];fieldValueCache.set(key,values);fieldValuePending.delete(key);return values;}).catch(err=>{fieldValuePending.delete(key);throw err;});fieldValuePending.set(key,job);return job;}
  function fieldValues(source,field){return fieldValueCache.get(valueCacheKey(source,String(field||'').trim()))||[];}
  function renderFilters(){const host=document.getElementById('autoFilters');if(!host||!draft)return;const manual=draft.source==='manual';host.closest('.autoSection')?.classList.toggle('isDisabled',manual);if(manual){host.innerHTML=`<div class="autoInfo">${esc(tr('Manuel kaynak seçildi. Dataset filtresi kullanılmaz.','Manual source selected. Dataset filters are not used.'))}</div>`;return;}const listId=`autoFieldList_${draft.source}`,fieldKey=fieldCacheKey(draft.source,draftJoinSource()),knownFields=fieldCache.get(fieldKey)||[],A=assistant(),lowerTr=v=>String(v||'').toLocaleLowerCase('tr-TR');const rows=(draft.filters||[]).map((f,i)=>{const values=fieldValues(draft.source,f.field),valueId=`autoValueList_${i}_${Math.abs(String(f.field||'').split('').reduce((a,c)=>((a*31)+c.charCodeAt(0))|0,7))}`,noValue=['empty','not_empty','changed'].includes(f.operator);return`<div class="autoFilterRow" data-auto-filter="${i}"><div class="autoSearchSelect"><input type="search" data-filter-field list="${esc(listId)}" value="${esc(f.field||'')}" placeholder="${esc(tr('Alan ara veya seç…','Search or choose field…'))}" autocomplete="off"></div><select data-filter-op>${filterOperatorOptions(f.operator||'eq')}</select><div class="autoValueSelect"><input data-filter-value list="${esc(valueId)}" value="${esc(f.value||'')}" placeholder="${esc(noValue?(f.operator==='changed'?tr('Önceki çalışmaya göre','Compared with previous run'):tr('Değer gerekmiyor','No value required')):tr('Listeden seç veya yaz…','Choose from list or type…'))}" ${noValue?'disabled':''}><datalist id="${esc(valueId)}">${values.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist></div><button type="button" class="autoIconBtn" data-filter-delete title="${esc(tr('Koşulu kaldır','Remove condition'))}">×</button>${f.field&&knownFields.length&&!knownFields.some(v=>lowerTr(v)===lowerTr(f.field))?(()=>{const suggestion=A?A.closest(f.field,knownFields):'';return `<small class="autoChangeHint autoFieldWarn">${esc(tr('Bu alan bu veride yok — başlık değişmiş olabilir.','This field is not in this data — the heading may have changed.'))}${suggestion?` <button type="button" class="autoMiniBtn" data-filter-fix="${esc(suggestion)}">${esc(tr(`“${suggestion}” kullan`,`Use “${suggestion}”`))}</button>`:''}</small>`;})():''}${['gt','gte','lt','lte'].includes(f.operator)?`<span class="autoDateChips"><span>${esc(tr('Tarihse, bugüne göre:','If a date, relative to today:'))}</span>${[['@today-7d',tr('7 gün önce','7 days ago')],['@today',tr('bugün','today')],['@today+7d',tr('7 gün sonra','in 7 days')],['@today+30d',tr('30 gün sonra','in 30 days')]].map(([token,label])=>`<button type="button" class="autoMiniBtn${String(f.value||'').trim()===token?' active':''}" data-filter-date="${token}">${esc(label)}</button>`).join('')}${A&&/^@today/i.test(String(f.value||'').trim())?`<em>${esc(tr(`= ${A.valueLabel(f.value,'tr')} (her çalışmada yeniden hesaplanır)`,`= ${A.valueLabel(f.value,'en')} (recalculated on every run)`))}</em>`:''}</span>`:''}${f.operator==='changed'?`<small class="autoChangeHint">${esc(tr('İlk gerçek çalıştırma mevcut değeri başlangıç kabul eder; sonraki çalışmalarda bu alan değişirse koşul eşleşir.','The first real run stores the current value as the baseline; later runs match when this field changes.'))}</small>`:''}</div>`;}).join('');host.innerHTML=fieldListHtml(fieldKey,listId)+rows+`<button type="button" class="tbtn autoAddFilter" data-filter-add>＋ ${esc(tr('Koşul ekle','Add condition'))}</button>${(draft.filters||[]).length>1?`<small class="autoFilterNote">${esc(tr('Kayıt, koşulların HEPSİNE uyarsa işlenir.','A record is processed only if it matches ALL conditions.'))}</small>`:''}`;host.querySelectorAll('[data-auto-filter]').forEach(row=>{const i=Number(row.dataset.autoFilter),fieldInput=row.querySelector('[data-filter-field]');fieldInput.onchange=async e=>{const previous=draft.filters[i].field;draft.filters[i].field=e.target.value.trim();/* v7.175 — alan değişince eski DEĞER temizlenir; ama şablonun boş alanı ilk kez seçiliyorsa ya da değer "bugün" gibi göreli bir tarihse korunur. */if(previous&&previous!==draft.filters[i].field&&!/^@today/i.test(String(draft.filters[i].value||'').trim()))draft.filters[i].value='';markDirty();if(draft.filters[i].field)try{await loadFieldValues(draft.source,draft.filters[i].field);}catch(err){toast(err.message);}renderFilters();};row.querySelector('[data-filter-op]').onchange=e=>{draft.filters[i].operator=e.target.value;if(['empty','not_empty','changed'].includes(e.target.value))draft.filters[i].value='';markDirty();renderFilters();};row.querySelector('[data-filter-value]').oninput=e=>{draft.filters[i].value=e.target.value;markDirty();};row.querySelector('[data-filter-delete]').onclick=()=>{draft.filters.splice(i,1);markDirty();renderFilters();};row.querySelectorAll('[data-filter-date]').forEach(btn=>btn.onclick=()=>{draft.filters[i].value=btn.dataset.filterDate;markDirty();renderFilters();});row.querySelector('[data-filter-fix]')?.addEventListener('click',e=>{draft.filters[i].field=e.currentTarget.dataset.filterFix;draft.filters[i].value=draft.filters[i].operator==='changed'?'':draft.filters[i].value;markDirty();renderFilters();});});host.querySelector('[data-filter-add]')?.addEventListener('click',()=>{draft.filters.push({field:'',operator:'eq',value:''});markDirty();renderFilters();});for(const f of draft.filters||[]){if(f.field&&!fieldValueCache.has(valueCacheKey(draft.source,f.field))&&!fieldValuePending.has(valueCacheKey(draft.source,f.field)))loadFieldValues(draft.source,f.field).then(()=>renderFilters()).catch(()=>{});}}


  function renderSteps(){const host=document.getElementById('autoSteps');if(!host||!draft)return;const steps=draft.steps||[],fields=fieldCache.get(fieldCacheKey(draft.source,draftJoinSource()))||[];host.innerHTML=steps.length?steps.map((step,i)=>{const editable=['fill','select'].includes(step.action),binding=step.binding||{mode:'fixed',field:''};return`<div class="autoStep" data-auto-step="${i}"><div class="autoStepNo">${i+1}</div><div class="autoStepMain"><div><b>${esc(actionLabel(step.action))}</b><span>${esc(targetSummary(step))}</span></div>${editable?`<div class="autoValueBuilder"><label><span>${esc(tr('Bu alana ne yazılsın?','What should be entered here?'))}</span><select data-step-mode><option value="fixed"${binding.mode!=='field'?' selected':''}>${esc(tr('Kaydettiğim sabit değer','Recorded fixed value'))}</option><option value="field"${binding.mode==='field'?' selected':''}>${esc(tr('Buyer Log alanından al','Use a Buyer Log field'))}</option></select></label>${binding.mode==='field'?`<label><span>${esc(tr('Hangi alan?','Which field?'))}</span><select data-step-field><option value="">${esc(tr('Alan seçin','Choose a field'))}</option>${fields.map(v=>`<option value="${esc(v)}"${v===binding.field?' selected':''}>${esc(v)}</option>`).join('')}</select></label><div class="autoBindingPreview">${binding.field?`${esc(tr('Her kayıt için','For each row'))}: <b>${esc(binding.field)}</b>`:esc(tr('Bir Buyer Log alanı seçin.','Choose a Buyer Log field.'))}</div>`:`<label class="autoFixedValue"><span>${esc(tr('Sabit değer','Fixed value'))}</span><input data-step-value value="${esc(step.value||'')}"></label>`}</div>`:`<small>${esc(step.description||'')}</small>`}</div><div class="autoStepActions"><button type="button" data-step-up ${i===0?'disabled':''}>↑</button><button type="button" data-step-down ${i===steps.length-1?'disabled':''}>↓</button><button type="button" data-step-delete>×</button></div></div>`;}).join(''):`<div class="autoEmpty steps">${esc(tr('Henüz web adımı yok. “Yaptıklarımı Kaydet” ile işlemi bir kez gösterin.','No web steps yet. Use “Record My Actions” to demonstrate the process once.'))}</div>`;
    host.querySelectorAll('[data-auto-step]').forEach(row=>{const i=Number(row.dataset.autoStep),step=draft.steps[i];row.querySelector('[data-step-value]')?.addEventListener('input',e=>{step.value=e.target.value;markDirty();});row.querySelector('[data-step-mode]')?.addEventListener('change',e=>{step.binding={mode:e.target.value,field:''};markDirty();renderSteps();});row.querySelector('[data-step-field]')?.addEventListener('change',e=>{step.binding={mode:'field',field:e.target.value};markDirty();renderSteps();});row.querySelector('[data-step-up]').onclick=()=>{[draft.steps[i-1],draft.steps[i]]=[draft.steps[i],draft.steps[i-1]];markDirty();renderSteps();};row.querySelector('[data-step-down]').onclick=()=>{[draft.steps[i+1],draft.steps[i]]=[draft.steps[i],draft.steps[i+1]];markDirty();renderSteps();};row.querySelector('[data-step-delete]').onclick=()=>{draft.steps.splice(i,1);markDirty();renderSteps();};});}

  function groupOptions(selected){return `<option value="">${esc(tr('E-posta grubu seçin','Choose email group'))}</option>${groups().map(g=>`<option value="${esc(g.id)}"${g.id===selected?' selected':''}>${esc(g.name)} · ${(g.to||[]).length}${g.source==='prepare_email'?` · ${esc(tr('Prepare E-Mail','Prepare E-Mail'))}`:''}</option>`).join('')}`;}
  function renderEmailSection(){const e=draft.email||emptyRecipe('email').email,fields=fieldCache.get(fieldCacheKey(draft.source,draftJoinSource()))||[],selected=new Set(e.reportFields||[]),picked=(e.reportFields||[]).filter(v=>fields.includes(v)),ordered=[...picked,...fields.filter(v=>!selected.has(v))];return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('E-posta / Rapor','Email / Report'))}</b><small>${esc(tr('Alıcılar Otomasyon gruplarından veya Üreticiler sayfasındaki üretici kartlarının e-postalarından seçilebilir.','Recipients can be selected from Automation groups or the e-mails on the manufacturer cards of the Manufacturers page.'))}</small></div></div><div class="autoGrid two"><label><span>${esc(tr('Alıcı belirleme','Recipient mode'))}</span><select data-email-recipient-mode><option value="group"${e.recipientMode!=='field'?' selected':''}>${esc(tr('Tek sabit grup','Single fixed group'))}</option><option value="field"${e.recipientMode==='field'?' selected':''}>${esc(tr('Alana göre böl — her değere ayrı e-posta','Split by field — one email per value'))}</option></select></label>${e.recipientMode==='field'?`<label><span>${esc(tr('Alıcıyı belirleyen alan','Field that decides the recipient'))}</span><select data-email-recipient-field><option value="">${esc(tr('Alan seçin','Select a field'))}</option>${fields.map(f=>`<option value="${esc(f)}"${e.recipientField===f?' selected':''}>${esc(f)}</option>`).join('')}</select></label>`:`<label><span>${esc(tr('E-posta grubu','Email group'))}</span><select data-email-group>${groupOptions(e.groupId)}</select></label>`}</div>${e.recipientMode==='field'?`<div class="autoPreviewNote">${esc(tr('Satırlar bu alanın değerine göre gruplanır ve her değer adres defterinde AYNI ADLA aranır. Alan Üretici ise her sipariş kendi Üretici kartına eşlenir ve her üreticiye kendi siparişlerinin listesi gider: lisanslı Non-DTR siparişlerde sorumlu Alt Üreticidir (Sub-Manufacturer), kartın alternatif adları da eşleşir. Karşılığı bulunamayan değerler için e-posta gönderilmez, ayrıca listelenir.','Rows are grouped by this field and each value is looked up in the address book BY THE SAME NAME. If the field is Manufacturer, every order is matched to its Manufacturer card and each manufacturer receives its own orders: on licensed non-DTR orders the Sub-Manufacturer is responsible, and the card aliases match too. Values without a match are not emailed and are listed separately.'))}</div>`:''}<div class="autoGrid two"><label><span>${esc(tr('Teslim şekli','Delivery'))}</span><select data-email-delivery><option value="draft" selected>${esc(tr('Taslak oluştur','Create draft'))}</option></select></label></div><label class="autoField"><span>${esc(tr('Konu','Subject'))}</span><input data-email-subject value="${esc(e.subject||'')}"></label><label class="autoField"><span>${esc(tr('E-posta metni','Email body'))}</span><textarea rows="4" data-email-body>${esc(e.body||'')}</textarea></label><div class="autoGrid two"><label><span>${esc(tr('Yazışma dili','Correspondence language'))}</span><select data-email-language><option value="tr"${e.languageMode!=='auto'&&e.languageMode!=='en'?' selected':''}>${esc(tr('Her zaman Türkçe','Always Turkish'))}</option><option value="en"${e.languageMode==='en'?' selected':''}>${esc(tr('Her zaman İngilizce','Always English'))}</option><option value="auto"${e.languageMode==='auto'?' selected':''}>${esc(tr('Otomatik — üretim ülkesi Türkiye ise TR, değilse EN','Automatic — TR when produced in Turkey, otherwise EN'))}</option></select></label></div>${e.languageMode==='auto'||e.languageMode==='en'?`<label class="autoField"><span>${esc(tr('İngilizce konu','English subject'))}</span><input data-email-subject-en value="${esc(e.subjectEn||'')}"></label><label class="autoField"><span>${esc(tr('İngilizce e-posta metni','English email body'))}</span><textarea rows="4" data-email-body-en>${esc(e.bodyEn||'')}</textarea></label><div class="autoPreviewNote">${esc(tr('İngilizce metin boş bırakılırsa Türkçesi kullanılır; boş e-posta gönderilmez. Otomatik kipte bir üreticinin tek maili olur, dil o grubun siparişlerinin çoğunluğuna göre belirlenir.','If the English text is empty the Turkish one is used; no empty email is sent. In automatic mode each supplier gets one email and its language follows the majority of that group\'s orders.'))}</div>`:''}<label class="autoToggleLine"><input type="checkbox" data-email-report ${e.includeReport!==false?'checked':''}><span>${esc(tr('Filtreye uyan kayıtları rapor olarak e-postaya ekle','Include matching rows as an email report'))}</span></label>${draft.source!=='manual'?`<div class="autoField autoReportFields"><div class="autoReportPicker"><div><b>${esc(tr('Rapor sütunları','Report columns'))}</b><small>${esc(picked.length?tr(`${picked.length} sütun seçili · sıralama özelleştirilebilir`,`${picked.length} columns selected · custom order`):tr('Otomatik sütun seçimi etkin','Automatic column selection is active'))}</small></div><button type="button" class="tbtn" data-auto-columns-open>${esc(tr('Sütunları düzenle','Edit columns'))} <span aria-hidden="true">›</span></button></div><div class="autoReportChips">${picked.length?picked.slice(0,8).map(v=>`<span title="${esc(v)}">${esc(v)}</span>`).join('')+(picked.length>8?`<span>+${picked.length-8}</span>`:''): `<span class="autoReportAuto">${esc(tr('Buyer Log uygun alanları otomatik ekler','Buyer Log selects suitable fields automatically'))}</span>`}</div></div>`:''}<label class="autoToggleLine"><input type="checkbox" data-email-open ${e.openDraftOnManual!==false?'checked':''}><span>${esc(tr('Manuel çalıştırmada oluşturulan taslağı e-posta uygulamasında aç','Open created draft in the email app for manual runs'))}</span></label></section>`;}

  /* The CP Fields drawer is the visual contract: grouped headings, nested fields,
     bulk selection and deliberate column ordering. Only field names are persisted. */
  const REPORT_GROUPS=[
    {key:'priority',tr:'Öncelik',en:'Priority',test:/^(%|aksiyon|action priority|priority|risk|öncelik)/i},
    {key:'plm',tr:'PLM Numune',en:'PLM Sample',test:/^(plm sample|numune|sample|lab dip|fit approval)/i},
    {key:'brand',tr:'Marka Detayları',en:'Brand Details',test:/^(mmyg|mag|buying group|buyer|marka|brand|license holder)/i},
    {key:'model',tr:'Model Detayları',en:'Model Details',test:/^(model|style|plm id|product main|product definition|product class|category|c\.code|c code|season|sezon|gender|cinsiyet|color|colour|renk|size|beden|design)/i},
    {key:'order',tr:'Sipariş Detayları',en:'Order Details',test:/^(order|sipariş|po |po$|manufacturer|üretici|supplier|vendor|quantity|qty|amount|amount|fiyat|price|currency|döviz|cost|buyer po|unit|pcs|active\/inactive)/i},
    {key:'license',tr:'Lisans Detayları',en:'License Details',test:/^(licen[sc]e|lisans|royalty|royalti)/i},
    {key:'dates',tr:'Tarihler',en:'Dates',test:/(date|tarih|termin|week|hafta|month|ay$|eta|etd|ex.f|ex-f|delivery|loading|yükleme|arrival|inspection|dispatch|shipment|sevkiyat)/i},
    {key:'fabric',tr:'Kumaş Detayları',en:'Fabric Details',test:/(fabric|kumaş|yarn|iplik|composition|karışım|fiber|fibre|elyaf|knit|weave|örme|dokuma)/i},
    {key:'logistics',tr:'Lojistik',en:'Logistics',test:/(logistic|lojistik|container|konteyner|warehouse|depo|customs|gümrük|transit|antrepo|shipping|nakliye|freight)/i},
    {key:'notes',tr:'Notlar',en:'Notes',test:/(note|notlar|not sütunu|comment|açıklama|description|remark)/i},
    {key:'database',tr:'Veritabanı',en:'Database',test:/(database|veritabanı|source|kaynak|record id|created at|updated at|sync|mapping)/i},
    {key:'checklist',tr:'Checklist',en:'Checklist',test:/(checklist|approved|rejected|pending|not required|test report|care label|price tag|ros|lab dip)/i}
  ];
  function reportFieldGroups(fields){
    const groups=REPORT_GROUPS.map(g=>({...g,fields:[]}));
    const remainder={key:'other',tr:'Diğer Alanlar',en:'Other Fields',fields:[]};
    (fields||[]).forEach(name=>{
      const v=String(name).replace(/^(CP|Orders|Backlog|LFL|Collection)\s*[:.·]\s*/i,'').trim();
      const g=groups.find(g=>g.test.test(v));
      (g||remainder).fields.push(name);
    });
    return [...groups,remainder].filter(g=>g.fields.length);
  }
  function openReportColumns(){
    if(!draft||!draft.email)return;
    const fields=fieldCache.get(fieldCacheKey(draft.source,draftJoinSource()))||[];
    if(!fields.length){toast(tr('Sütun listesi henüz yüklenmedi. Lütfen tekrar deneyin.','Fields are still loading. Please try again.'));return;}
    closeAutomationModal(document.getElementById('_autoReportColumns'));
    const current=(draft.email.reportFields||[]).filter((v,i,a)=>fields.includes(v)&&a.indexOf(v)===i);
    let selected=current.slice(0,40),query='',filter='all';
    const groups=reportFieldGroups(fields),opened=new Set(groups.filter((g,i)=>i<2).map(g=>g.key));
    const overlay=document.createElement('div');overlay.id='_autoReportColumns';overlay.className='autoColumnsOverlay';overlay.dataset.uiMigrated='operations';
    overlay.innerHTML=`<div class="autoColumnsDrawer" role="dialog" aria-modal="true" aria-labelledby="autoColumnsTitle">
      <header class="autoColumnsHead"><div><b id="autoColumnsTitle">${esc(tr('Rapor Sütunları','Report Columns'))}</b><span>${esc(tr('CP görünümündeki gibi başlıkları açarak sütunları seçin; sıralamak için sağdaki listeyi kullanın.','Open headings as in CP Fields; arrange the selected columns on the right.'))}</span></div><button type="button" class="autoColumnsClose" data-columns-close aria-label="${esc(tr('Kapat','Close'))}">×</button></header>
      <div class="autoColumnsToolbar"><input type="search" data-columns-search placeholder="${esc(tr('Sütun ara…','Search columns…'))}" aria-label="${esc(tr('Sütun ara','Search columns'))}"><select data-columns-filter aria-label="${esc(tr('Sütun filtresi','Column filter'))}"><option value="all">${esc(tr('Tüm alanlar','All fields'))}</option><option value="selected">${esc(tr('Seçili alanlar','Selected fields'))}</option><option value="unselected">${esc(tr('Seçili olmayanlar','Unselected fields'))}</option></select></div>
      <div class="autoColumnsContent" data-columns-content></div>
      <footer class="autoColumnsFoot"><span data-columns-count></span><div><button type="button" class="tbtn" data-columns-auto>${esc(tr('Otomatik seçime dön','Use automatic'))}</button><button type="button" class="tbtn" data-columns-cancel>${esc(tr('Vazgeç','Cancel'))}</button><button type="button" class="tbtn primary" data-columns-apply>${esc(tr('Uygula','Apply'))}</button></div></footer>
    </div>`;
    document.body.appendChild(overlay);
    const render=()=>{
      const content=overlay.querySelector('[data-columns-content]');
      const scroll=content.scrollTop,selectedSet=new Set(selected);
      const visible=name=>(!query||name.toLocaleLowerCase('tr-TR').includes(query))&&(filter==='all'||(filter==='selected')===selectedSet.has(name));
      const rows=groups.map(g=>{
        const matching=g.fields.filter(visible);if(!matching.length)return'';
        const count=g.fields.filter(v=>selectedSet.has(v)).length,all=count===g.fields.length;
        const expanded=opened.has(g.key)||Boolean(query);
        return `<section class="autoColumnsGroup" data-columns-group="${esc(g.key)}"><div class="autoColumnsGroupHead">
          <button type="button" data-columns-toggle="${esc(g.key)}" aria-expanded="${expanded}"><span aria-hidden="true">${expanded?'⌄':'›'}</span><b>${esc(tr(g.tr,g.en))}</b><small>${count}/${g.fields.length}</small></button>
          <label title="${esc(tr('Başlıktaki tüm alanları seç/kaldır','Select/deselect all fields in this heading'))}"><input type="checkbox" data-columns-group-check="${esc(g.key)}" ${all?'checked':''} aria-label="${esc(tr(g.tr,g.en))}"></label>
        </div>${expanded?`<div class="autoColumnsGroupItems">${matching.map(name=>`<label class="autoColumnsField"><input type="checkbox" data-columns-field="${esc(name)}" ${selectedSet.has(name)?'checked':''}><span>${esc(name)}</span></label>`).join('')}</div>`:''}</section>`;
      }).join('');
      const selectedRows=selected.map((name,i)=>`<div class="autoSelectedColumn" draggable="true" data-selected-column="${esc(name)}"><span class="autoColumnsGrip" title="${esc(tr('Sürükleyerek sırala','Drag to reorder'))}">⋮⋮</span><span title="${esc(name)}">${esc(name)}</span><button type="button" data-columns-move="-1" data-field="${esc(name)}" ${!i?'disabled':''} title="${esc(tr('Yukarı','Move up'))}">↑</button><button type="button" data-columns-move="1" data-field="${esc(name)}" ${i===selected.length-1?'disabled':''} title="${esc(tr('Aşağı','Move down'))}">↓</button><button type="button" data-columns-remove="${esc(name)}" title="${esc(tr('Çıkar','Remove'))}">×</button></div>`).join('');
      content.innerHTML=`<div class="autoColumnsGroups"><div class="autoColumnsTableHead"><span>${esc(tr('BAŞLIK / SÜTUN','HEADING / COLUMN'))}</span><span>${esc(tr('SEÇ','SELECT'))}</span></div><div class="autoColumnsGroupList">${rows||`<p class="autoColumnsEmpty">${esc(tr('Eşleşen sütun yok.','No matching columns.'))}</p>`}</div></div><aside class="autoColumnsSelected"><div class="autoColumnsSelectedHead"><b>${esc(tr('Sütun sırası','Column order'))}</b><small>${selected.length}/40</small></div><p>${esc(tr('Sürükleyerek veya oklarla sıralayın. Bu sıra rapor tablosuna ve dışa aktarıma yansır.','Drag or use arrows. This order is used by the report table and export.'))}</p><div class="autoColumnsSelectedList">${selectedRows||`<div class="autoColumnsEmpty">${esc(tr('Henüz alan seçilmedi.','No columns selected.'))}</div>`}</div></aside>`;
      content.scrollTop=scroll;
      overlay.querySelector('[data-columns-count]').textContent=selected.length?tr(`${selected.length} sütun seçildi`,`${selected.length} columns selected`):tr('Otomatik sütun seçimi','Automatic column selection');
      content.querySelectorAll('[data-columns-toggle]').forEach(button=>button.onclick=()=>{const k=button.dataset.columnsToggle;opened.has(k)?opened.delete(k):opened.add(k);render();});
      content.querySelectorAll('[data-columns-group-check]').forEach(check=>check.onchange=()=>{
        const g=groups.find(g=>g.key===check.dataset.columnsGroupCheck);if(!g)return;
        if(check.checked){const more=g.fields.filter(v=>!selected.includes(v));if(selected.length+more.length>40){toast(tr('Rapor için en fazla 40 sütun seçilebilir.','You can select up to 40 report columns.'));render();return;}selected.push(...more);}
        else selected=selected.filter(v=>!g.fields.includes(v));
        opened.add(g.key);render();
      });
      content.querySelectorAll('[data-columns-field]').forEach(check=>check.onchange=()=>{
        const name=check.dataset.columnsField;
        if(check.checked){if(selected.length>=40){toast(tr('Rapor için en fazla 40 sütun seçilebilir.','You can select up to 40 report columns.'));render();return;}if(!selected.includes(name))selected.push(name);}
        else selected=selected.filter(v=>v!==name);
        render();
      });
      content.querySelectorAll('[data-columns-move]').forEach(button=>button.onclick=()=>{
        const i=selected.indexOf(button.dataset.field),j=i+Number(button.dataset.columnsMove);
        if(i<0||j<0||j>=selected.length)return;
        [selected[i],selected[j]]=[selected[j],selected[i]];render();
      });
      content.querySelectorAll('[data-columns-remove]').forEach(button=>button.onclick=()=>{selected=selected.filter(v=>v!==button.dataset.columnsRemove);render();});
      let dragFrom='';
      content.querySelectorAll('[data-selected-column]').forEach(row=>{
        row.addEventListener('dragstart',e=>{dragFrom=row.dataset.selectedColumn;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',dragFrom);row.classList.add('isDragging');});
        row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
        row.addEventListener('drop',e=>{e.preventDefault();const from=selected.indexOf(dragFrom),to=selected.indexOf(row.dataset.selectedColumn);if(from<0||to<0||from===to)return;const [v]=selected.splice(from,1);selected.splice(to,0,v);render();});
        row.addEventListener('dragend',()=>{dragFrom='';row.classList.remove('isDragging');});
      });
    };
    const close=()=>{window.BLLayerSystem?.closeDialog(overlay);overlay.remove();};
    window.BLLayerSystem?.openDialog(overlay,{onClose:close});
    overlay.querySelector('[data-columns-close]').onclick=close;
    overlay.querySelector('[data-columns-cancel]').onclick=close;
    overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    overlay.querySelector('[data-columns-search]').oninput=e=>{query=e.target.value.trim().toLocaleLowerCase('tr-TR');render();};
    overlay.querySelector('[data-columns-filter]').onchange=e=>{filter=e.target.value;render();};
    overlay.querySelector('[data-columns-auto]').onclick=()=>{selected=[];render();};
    overlay.querySelector('[data-columns-apply]').onclick=()=>{
      draft.email.reportFields=selected.slice();markDirty();close();renderEditorPreserveScroll();
    };
    render();overlay.querySelector('[data-columns-search]').focus();
  }


  /* v9.47 — BACKLOG TESLİMAT RİSKİ AYARLARI.
     Otomasyon risk hesabı YAPMAZ; buradaki ayarlar yalnız Backlog Intelligence
     motorunun hangi hedefe göre çalışacağını ve kök sebebin hangi sorumluya
     yönleneceğini söyler. Risk alanları (Teslimat Sonucu, Risk Sebebi, Tampon
     Gün…) koşullarda ve raporda normal alan gibi kullanılır. */
  const BACKLOG_CAUSES=[['LATE_LOADING','Geç Yükleme','Late Loading'],['NOT_YET_LOADED','Henüz Yüklenmedi','Not Yet Loaded'],['PRODUCTION_DELAY','Üretim Gecikmesi','Production Delay'],['TRANSIT_DELAY','Yol Gecikmesi','Transit Delay'],['CUSTOMS_DELAY','Gümrük Gecikmesi','Customs Delay'],['RETAIL_TRANSFER_DELAY','Retaile Aktarım Gecikmesi','Retail Transfer Delay'],['INSUFFICIENT_TRANSIT_BUFFER','Yetersiz Yol Tamponu','Insufficient Transit Buffer'],['TARGET_DATE_PASSED','Hedef Tarih Geçti','Target Date Passed'],['MISSING_DATE','Tarih Eksik','Missing Date'],['MISSING_TRANSIT_RULE','Yol Süresi Kuralı Eksik','Missing Transit Rule']];
  const BACKLOG_OWNERS=[['supplier','Üretici','Supplier'],['merchandiser','Merchandiser','Merchandiser'],['buyer','Buyer','Buyer'],['import','İthalat','Import'],['none','Yönlendirme yok','No routing']];
  const BACKLOG_DEFAULT_ROUTING={LATE_LOADING:'supplier',NOT_YET_LOADED:'supplier',PRODUCTION_DELAY:'supplier',TRANSIT_DELAY:'import',CUSTOMS_DELAY:'import',RETAIL_TRANSFER_DELAY:'import',INSUFFICIENT_TRANSIT_BUFFER:'merchandiser',TARGET_DATE_PASSED:'merchandiser',MISSING_DATE:'merchandiser',MISSING_TRANSIT_RULE:'buyer',UNKNOWN:'merchandiser'};
  function renderBacklogSection(){const b=draft.backlog||{},routing=b.routing||{};return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Teslimat riski','Delivery risk'))}</b><small>${esc(tr('Risk, ETA ve gecikme hesabı Backlog Teslimat Analizi ekranıyla AYNI motordan gelir; burada yalnız hedef tarih ve sorumlu yönlendirmesi seçilir.','Risk, ETA and delay come from the SAME engine as the Backlog Delivery Analysis screen; here you only choose the target date and owner routing.'))}</small></div></div><div class="autoGrid two"><label><span>${esc(tr('Hedef tarih','Target date'))}</span><select data-backlog-target><option value="retail"${b.targetType!=='inStore'?' selected':''}>${esc(tr('Retail Depo Tarihi','Retail Warehouse Date'))}</option><option value="inStore"${b.targetType==='inStore'?' selected':''}>${esc(tr('In Store (Model Bütçe) Tarihi','In Store (Model Budget) Date'))}</option></select></label><label class="autoCheck"><input type="checkbox" data-backlog-require-rule ${b.requireTransitRule!==false?'checked':''}><span>${esc(tr('Yol süresi kuralı tanımlı değilse hesaplama yapma','Do not calculate when no transit time rule is defined'))}</span></label></div><div class="autoPreviewNote">${esc(tr('Yol süresi kuralı eksikse sipariş "Hesaplanamıyor" kalır ve zorla bir risk kategorisine sokulmaz. Kuralları Nakliye Tipine Göre Ülke Bazlı Yol Süreleri ekranından tanımlayın.','Without a transit time rule an order stays "Unknown" and is never forced into a risk category. Define rules on the transit-time-by-country screen.'))}</div><div class="autoField"><span>${esc(tr('Kök sebep → sorumlu','Root cause → owner'))}</span><div class="autoGrid two">${BACKLOG_CAUSES.map(([code,trLabel,enLabel])=>`<label><span>${esc(tr(trLabel,enLabel))}</span><select data-backlog-route="${code}">${BACKLOG_OWNERS.map(([value,ownerTr,ownerEn])=>`<option value="${value}"${(routing[code]||BACKLOG_DEFAULT_ROUTING[code])===value?' selected':''}>${esc(tr(ownerTr,ownerEn))}</option>`).join('')}</select></label>`).join('')}</div><small>${esc(tr('Sorumlu, "Sorumlu Taraf" alanı olarak satıra yazılır; koşullarda ve alıcı bölmede kullanabilirsiniz.','The owner is written to the row as the "Sorumlu Taraf" field for use in conditions and recipient splitting.'))}</small></div></section>`;}
  function renderAnalysisSection(){const a=draft.analysis||{};return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Analiz / Özet','Analysis / Summary'))}</b><small>${esc(tr('İstersen sorgu sonucunu bir alana göre gruplayıp adet, toplam veya ortalama hesaplatın.','Optionally group query results and calculate count, total or average.'))}</small></div></div><div class="autoGrid four"><label><span>${esc(tr('Grupla','Group by'))}</span><select data-analysis-group>${fieldOptions(draft.source,a.groupBy,tr('Gruplama yok','No grouping'))}</select></label><label><span>${esc(tr('İşlem','Operation'))}</span><select data-analysis-op>${[['count',tr('Adet','Count')],['sum',tr('Toplam','Sum')],['avg',tr('Ortalama','Average')],['min','Min'],['max','Max']].map(([v,l])=>`<option value="${v}"${a.operation===v?' selected':''}>${esc(l)}</option>`).join('')}</select></label><label><span>${esc(tr('Sayısal alan','Numeric field'))}</span><select data-analysis-value>${fieldOptions(draft.source,a.valueField,tr('Alan seç','Choose field'))}</select></label><label><span>${esc(tr('İlk sonuç','Top results'))}</span><input type="number" min="1" max="50" data-analysis-top value="${Number(a.topN)||15}"></label></div></section>`;}

  function renderAppSection(){const actions=draft.appActions||[];return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Buyer Log içi adımlar','Buyer Log actions'))}</b><small>${esc(tr('Kod yazmadan uygulama sayfası açma, veri yenileme veya sonuç raporunu gösterme adımları ekleyin.','Add steps to open a page, refresh data or show the result report without code.'))}</small></div></div><div id="autoAppActions" class="autoAppActions">${actions.map((a,i)=>`<div class="autoAppAction" data-app-action="${i}"><span>${i+1}</span><select data-app-kind><option value="open_page"${a.action==='open_page'?' selected':''}>${esc(tr('Sayfayı aç','Open page'))}</option><option value="refresh_source"${a.action==='refresh_source'?' selected':''}>${esc(tr('Veriyi yenile','Refresh data'))}</option><option value="show_report"${a.action==='show_report'?' selected':''}>${esc(tr('Sonuç raporunu göster','Show result report'))}</option></select>${a.action==='open_page'?`<select data-app-page>${['overview','cp','orders','koleksiyon','lfl','backlog'].map(v=>`<option value="${v}"${a.page===v?' selected':''}>${v}</option>`).join('')}</select>`:a.action==='refresh_source'?`<select data-app-source>${['cp','orders','backlog','lfl'].map(v=>`<option value="${v}"${a.source===v?' selected':''}>${v.toUpperCase()}</option>`).join('')}</select>`:`<div class="autoBindingPreview">${esc(tr('Filtreli veri ve analiz sonucu gösterilir.','Filtered data and analysis result will be shown.'))}</div>`}<button data-app-delete>×</button></div>`).join('')}</div><button type="button" class="tbtn" data-app-add>＋ ${esc(tr('Uygulama adımı ekle','Add app action'))}</button></section>`;}

  function renderScheduleSection(){const s=draft.schedule||{};return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Çalışma zamanı','Schedule'))}</b><small>${esc(tr('Planlı otomasyonlar Buyer Log sunucusu açık olduğu sürece çalışır.','Scheduled automations run while the Buyer Log server is running.'))}</small></div></div><label class="autoToggleLine"><input type="checkbox" data-schedule-enabled ${s.enabled?'checked':''}><span>${esc(tr('Bu otomasyonu düzenli çalıştır','Run this automation on a schedule'))}</span></label><div class="autoScheduleBox${s.enabled?'':' isDisabled'}"><div class="autoGrid four"><label><span>${esc(tr('Periyot','Frequency'))}</span><select data-schedule-mode><option value="daily"${s.mode==='daily'?' selected':''}>${esc(tr('Her gün','Daily'))}</option><option value="weekly"${s.mode==='weekly'?' selected':''}>${esc(tr('Haftalık','Weekly'))}</option><option value="interval"${s.mode==='interval'?' selected':''}>${esc(tr('Saat aralığı','Every N hours'))}</option></select></label>${s.mode==='interval'?`<label><span>${esc(tr('Her kaç saat','Every N hours'))}</span><input type="number" min="1" max="168" data-schedule-hours value="${Number(s.intervalHours)||24}"></label>`:`<label><span>${esc(tr('Saat','Time'))}</span><input type="time" data-schedule-time value="${esc(s.time||'09:00')}"></label>`}<div class="autoWeekdays" ${s.mode==='weekly'?'':'hidden'}>${[['1',tr('Pzt','Mon')],['2',tr('Sal','Tue')],['3',tr('Çar','Wed')],['4',tr('Per','Thu')],['5',tr('Cum','Fri')],['6',tr('Cmt','Sat')],['0',tr('Paz','Sun')]].map(([v,l])=>`<label><input type="checkbox" data-weekday="${v}" ${(s.weekdays||[]).includes(Number(v))?'checked':''}><span>${esc(l)}</span></label>`).join('')}</div></div></div></section>`;}

  function renderBrowserSection(){return `<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Web işlemini öğret','Teach web process'))}</b><small>${esc(tr('Hedef siteyi açın, kaydı başlatın ve işlemi bir kez kendiniz yapın.','Open the target site, start recording and perform the process once.'))}</small></div><span>${stepsCount()} ${esc(tr('adım','steps'))}</span></div><label class="autoField"><span>${esc(tr('Hedef HTTPS URL','Target HTTPS URL'))}</span><input data-auto-url value="${esc(draft.url||'')}" placeholder="https://portal.company.com/"></label><div class="autoBrowserActions"><button class="tbtn" data-auto-open>${esc(tr('Yeni sekmede aç','Open in new tab'))}</button><button class="tbtn primary" data-auto-record-start>${esc(tr('Yaptıklarımı Kaydet','Record My Actions'))}</button><button class="tbtn" data-auto-record-stop ${recording?'':'disabled'}>${esc(tr('Kaydı Bitir','Stop Recording'))}</button><span id="autoRecordStatus">${recording?esc(tr('Kayıt devam ediyor…','Recording…')):`${stepsCount()} ${esc(tr('adım','steps'))}`}</span></div><div class="autoHelp">${esc(tr('Kaydı bitirdikten sonra Yaz/Seç adımlarında “Buyer Log alanından al” seçeneğini kullanın. Örneğin Search kutusu için Order Code veya PLM ID alanını listeden seçebilirsiniz; {{...}} gibi kod yazmanız gerekmez.','After recording, use “Use a Buyer Log field” on Fill/Select steps. For example, choose Order Code or PLM ID for a Search box from the list; no {{...}} syntax is required.'))}</div><div id="autoSteps" class="autoSteps"></div></section>`;}

  function renderTerminalCodeSection(){const code=String(draft.terminalCode||''),lines=code?code.split(/\r?\n/).length:0;return `<section class="autoSection autoTerminalSection"><div class="autoSectionTitle"><div><b>${esc(tr('Terminal Kodu (JavaScript)','Terminal Code (JavaScript)'))}</b><small>${esc(tr('Bu otomasyona ait kodu görüntüleyin ve doğrudan düzenleyin. Kayıtlı web adımlarından sonra hedef Edge sayfasında çalışır.','View and directly edit this automation’s code. It runs in the target Edge page after the recorded web steps.'))}</small></div><span data-auto-terminal-count>${lines} ${esc(tr('satır','lines'))}</span></div><div class="autoTerminalToolbar"><span>${esc(tr('Kullanılabilir: document, window, fetch, item, index','Available: document, window, fetch, item, index'))}</span><span>${esc(tr('Ctrl+S: Kaydet','Ctrl+S: Save'))}</span>${state&&state.canConfigure?`<button type="button" class="tbtn autoWebScriptsBtn" data-auto-web-scripts>${esc(tr('Yerleşik web betikleri','Built-in web scripts'))}</button>`:''}</div><textarea class="autoTerminalCode" data-auto-terminal-code rows="14" maxlength="120000" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="// Örnek / Example\nconst title = document.title;\nconsole.log(title);\nreturn { title };">${esc(code)}</textarea><div class="autoDangerNote">${esc(tr('Kod yalnız hedef web sayfasının içinde çalışır; Buyer Log sunucusuna, dosya sistemine veya işletim sistemi terminaline erişmez. Parola, token ve gizli anahtarları koda yazmayın.','Code runs only inside the target web page; it cannot access the Buyer Log server, file system, or operating-system terminal. Do not put passwords, tokens, or secret keys in code.'))}</div></section>`;}

  function renderEditor(){const host=document.getElementById('autoEditor');if(!host)return;if(!draft){host.innerHTML=`<div class="autoEditorEmpty"><b>${esc(tr('Bir otomasyon seçin','Select an automation'))}</b></div>`;return;}const source=draft.source||'manual',m=purposeMeta(draft.purpose);host.innerHTML=`<div class="autoEditorHead"><div><span>${esc(draft.id?tr('Kayıtlı otomasyon','Saved automation'):tr('Yeni otomasyon','New automation'))}</span><h3>${esc(draft.name||tr('Yeni otomasyon','New automation'))}</h3><em>${esc(`${tr(m.tr,m.en)}`)}</em></div><div class="autoEditorHeadActions"><label class="autoToggle"><input type="checkbox" data-auto-enabled ${draft.enabled!==false?'checked':''}><span>${esc(tr('Aktif','Enabled'))}</span></label><button class="tbtn" data-auto-purpose>${esc(tr('İş türü','Job type'))}</button>${draft.id?`<button class="tbtn" data-auto-copy>${esc(tr('Kopyala','Duplicate'))}</button><button class="tbtn danger" data-auto-delete>${esc(tr('Sil','Delete'))}</button>`:''}</div></div><div class="autoEditorScroll">
    <div id="autoGuide" class="autoGuide" aria-live="polite" hidden></div>
    <section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Otomasyon tanımı','Automation definition'))}</b><small>${esc(tr('İşin adını ve ne yapmasını istediğinizi anlaşılır şekilde yazın.','Give the job a clear name and description.'))}</small></div></div><div class="autoGrid two"><label><span>${esc(tr('Ad','Name'))}</span><input data-auto-name value="${esc(draft.name||'')}"></label><label><span>${esc(tr('İş türü','Job type'))}</span><div class="autoPurposeInline"><b>${esc(tr(m.tr,m.en))}</b></div></label></div><label class="autoField"><span>${esc(tr('Açıklama','Description'))}</span><textarea rows="2" data-auto-desc>${esc(draft.description||'')}</textarea></label></section>
    <section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Veri kaynağı ve koşullar','Data source and conditions'))}</b><small>${esc(tr('Otomasyon hangi kayıtlar üzerinde çalışsın? Koşul eklemezseniz kaynaktaki tüm kayıtlar alınır. Alanı yazarak arayın, değeri listeden seçin.','Which records should the automation use? Without conditions all records are taken. Type to search a field, pick the value from the list.'))}</small></div></div><div class="autoGrid four"><label><span>${esc(tr('Kaynak','Source'))}</span><select data-auto-source><option value="manual"${source==='manual'?' selected':''}>${esc(tr('Manuel · veri yok','Manual · no dataset'))}</option>${SOURCES.map(v=>`<option value="${v}"${source===v?' selected':''}>${esc(sourceLabel(v))}</option>`).join('')}</select></label></div><div class="autoFilters" id="autoFilters"></div><details class="autoAdvanced"${(draft.join&&draft.join.source)||Number(draft.limit)!==50?' open':''}><summary>${esc(tr('Gelişmiş ayarlar (isteğe bağlı): ikinci kaynak, kayıt sınırı','Advanced settings (optional): second source, row limit'))}</summary><div class="autoGrid four">${source!=='manual'?`<label><span>${esc(tr('İkinci kaynak (zincir)','Second source (chain)'))}</span><select data-auto-join-source><option value="">${esc(tr('Yok','None'))}</option>${SOURCES.filter(v=>v!==source).map(v=>`<option value="${v}"${(draft.join&&draft.join.source)===v?' selected':''}>${esc(sourceLabel(v))}</option>`).join('')}</select></label>`:''}${source!=='manual'&&draft.join&&draft.join.source?`<label><span>${esc(tr('Eşleşme','Matching'))}</span><select data-auto-join-mode><option value="match"${draft.join.mode!=='optional'&&draft.join.mode!=='missing'?' selected':''}>${esc(tr('Yalnız eşleşenler','Matched only'))}</option><option value="optional"${draft.join.mode==='optional'?' selected':''}>${esc(tr('Eşleşmeyenler de kalsın','Keep unmatched too'))}</option><option value="missing"${draft.join.mode==='missing'?' selected':''}>${esc(tr('Yalnız eşleşmeyenler','Unmatched only'))}</option></select></label>`:''}<label><span>${esc(tr('Maks. kayıt','Max rows'))}</span><input type="number" min="1" max="200" data-auto-limit value="${Number(draft.limit)||50}"></label>${hasBrowser()?`<label><span>${esc(tr('Web adımı zaman aşımı','Web step timeout'))}</span><input type="number" min="1000" max="30000" step="1000" data-auto-timeout value="${Number(draft.timeoutMs)||12000}"></label><label class="autoCheck"><input type="checkbox" data-auto-continue ${draft.continueOnError?'checked':''}><span>${esc(tr('Bir kayıt hata verirse sonrakine devam et','Continue after a row fails'))}</span></label>`:''}</div><small class="autoChangeHint">${esc(tr('İkinci bir kaynak bağlarsanız iki tablonun satırları sipariş kodundan eşleştirilir ve koşulları iki tablonun başlıklarıyla birlikte kurabilirsiniz.','If you chain a second source, rows are matched on order code and conditions can use headers from both tables.'))}</small></details></section>
    ${source==='backlog'?renderBacklogSection():''}${hasAnalysis()?renderAnalysisSection():''}${hasApp()?renderAppSection():''}${hasBrowser()?renderBrowserSection():''}${hasBrowser()?renderTerminalCodeSection():''}${hasBrowser()?`<section class="autoSection"><div class="autoSectionTitle"><div><b>${esc(tr('Web doğrulaması','Web verification'))}</b><small>${esc(tr('İşlem sonunda sayfada görünmesi gereken başarı metnini isteğe bağlı girin.','Optionally enter text that must appear after the web process.'))}</small></div></div><label class="autoField"><span>${esc(tr('Başarı metni','Success text'))}</span><input data-auto-success value="${esc(draft.successText||'')}"></label></section>`:''}${hasEmail()?renderEmailSection():''}${draft.purpose==='email'?renderScheduleSection():''}
  </div><footer class="autoEditorFoot"><div id="autoSaveState"></div><button class="tbtn" data-auto-preview title="Dry Run">🧪 ${esc(tr('Dene (hiçbir şey göndermez)','Try it (sends nothing)'))}</button><button class="tbtn" data-auto-save>${esc(tr('Kaydet','Save'))}</button><button class="tbtn primary" data-auto-run>▶ ${esc(tr('Çalıştır','Run'))}</button></footer>`;
    bindEditor();renderFilters();if(hasBrowser())renderSteps();renderSaveState();renderGuide();if(source!=='manual'&&!fieldCache.has(fieldCacheKey(source,draftJoinSource())))loadFields(source,draftJoinSource()).then(()=>renderEditorPreserveScroll()).catch(e=>toast(e.message));}
  function renderEditorPreserveScroll(){const el=document.querySelector('.autoEditorScroll'),top=el?el.scrollTop:0;renderEditor();requestAnimationFrame(()=>{const next=document.querySelector('.autoEditorScroll');if(next)next.scrollTop=top;});}
  function stepsCount(){return draft&&Array.isArray(draft.steps)?draft.steps.length:0;}

  function bindEditor(){const host=document.getElementById('autoEditor');if(!host||!draft)return;const on=(sel,event,fn)=>host.querySelector(sel)?.addEventListener(event,fn);on('[data-auto-name]','input',e=>{draft.name=e.target.value;markDirty();});on('[data-auto-desc]','input',e=>{draft.description=e.target.value;markDirty();});on('[data-auto-enabled]','change',e=>{draft.enabled=e.target.checked;markDirty();});on('[data-auto-limit]','input',e=>{draft.limit=Math.max(1,Math.min(200,Number(e.target.value)||50));markDirty();});on('[data-auto-timeout]','input',e=>{draft.timeoutMs=Math.max(1000,Math.min(30000,Number(e.target.value)||12000));markDirty();});on('[data-auto-continue]','change',e=>{draft.continueOnError=e.target.checked;markDirty();});on('[data-auto-success]','input',e=>{draft.successText=e.target.value;markDirty();});on('[data-auto-url]','input',e=>{draft.url=e.target.value;markDirty();});on('[data-auto-terminal-code]','input',e=>{draft.terminalCode=e.target.value.slice(0,120000);const count=host.querySelector('[data-auto-terminal-count]');if(count)count.textContent=`${draft.terminalCode?draft.terminalCode.split(/\r?\n/).length:0} ${tr('satır','lines')}`;markDirty();});on('[data-auto-terminal-code]','keydown',e=>{if(e.key==='Tab'){e.preventDefault();const el=e.target,start=el.selectionStart,end=el.selectionEnd;el.setRangeText('  ',start,end,'end');el.dispatchEvent(new Event('input',{bubbles:true}));}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveDraft();}});on('[data-auto-source]','change',async e=>{draft.source=e.target.value;draft.filters=[];draft.join={source:'',mode:'match',prefix:''};if(draft.source==='manual'){draft.analysis={...draft.analysis,groupBy:'',valueField:''};}markDirty();if(draft.source!=='manual')await loadFields(draft.source);renderEditor();});on('[data-auto-join-source]','change',async e=>{draft.join={...(draft.join||{}),source:e.target.value,mode:(draft.join&&draft.join.mode)||'match'};draft.filters=[];markDirty();if(draft.source!=='manual')await loadFields(draft.source,draft.join.source);renderEditor();});on('[data-auto-join-mode]','change',e=>{draft.join={...(draft.join||{}),mode:e.target.value};markDirty();renderEditor();});on('[data-auto-web-scripts]','click',openWebScripts);on('[data-auto-open]','click',openTarget);on('[data-auto-record-start]','click',startRecording);on('[data-auto-record-stop]','click',stopRecording);on('[data-auto-save]','click',saveDraft);on('[data-auto-preview]','click',previewDraft);on('[data-auto-run]','click',runDraft);on('[data-auto-delete]','click',deleteDraft);on('[data-auto-copy]','click',()=>{const copy=clone(draft);copy.id='';copy.name=`${copy.name} · ${tr('Kopya','Copy')}`;copy.schedule={...(copy.schedule||{}),enabled:false,lastKey:'',lastRunAt:''};draft=copy;markDirty(true);renderAll();});on('[data-auto-purpose]','click',showChangePurpose);
    /* Kaynak backlog'a geçtiğinde alanlar kaybolmasın diye ayarlar tembel kurulur. */
    const backlog=()=>(draft.backlog=draft.backlog||{targetType:'retail',requireTransitRule:true,routing:{}});
    on('[data-backlog-target]','change',e=>{backlog().targetType=e.target.value==='inStore'?'inStore':'retail';markDirty();});
    on('[data-backlog-require-rule]','change',e=>{backlog().requireTransitRule=e.target.checked;markDirty();});
    host.querySelectorAll('[data-backlog-route]').forEach(el=>el.onchange=()=>{const b=backlog();b.routing={...(b.routing||{}),[el.dataset.backlogRoute]:el.value};markDirty();});
    on('[data-analysis-group]','change',e=>{draft.analysis.groupBy=e.target.value;markDirty();});on('[data-analysis-op]','change',e=>{draft.analysis.operation=e.target.value;markDirty();});on('[data-analysis-value]','change',e=>{draft.analysis.valueField=e.target.value;markDirty();});on('[data-analysis-top]','input',e=>{draft.analysis.topN=Math.max(1,Math.min(50,Number(e.target.value)||15));markDirty();});
    on('[data-email-group]','change',e=>{draft.email.groupId=e.target.value;markDirty();});on('[data-email-recipient-mode]','change',e=>{draft.email.recipientMode=e.target.value==='field'?'field':'group';markDirty();renderEditorPreserveScroll();});on('[data-email-recipient-field]','change',e=>{draft.email.recipientField=e.target.value;markDirty();});on('[data-email-delivery]','change',e=>{draft.email.deliveryMode=e.target.value;markDirty();renderEditorPreserveScroll();});on('[data-email-subject]','input',e=>{draft.email.subject=e.target.value;markDirty();});on('[data-email-body]','input',e=>{draft.email.body=e.target.value;markDirty();});on('[data-email-language]','change',e=>{draft.email.languageMode=['auto','tr','en'].includes(e.target.value)?e.target.value:'tr';markDirty();renderEditorPreserveScroll();});on('[data-email-subject-en]','input',e=>{draft.email.subjectEn=e.target.value;markDirty();});on('[data-email-body-en]','input',e=>{draft.email.bodyEn=e.target.value;markDirty();});on('[data-email-report]','change',e=>{draft.email.includeReport=e.target.checked;markDirty();});on('[data-email-open]','change',e=>{draft.email.openDraftOnManual=e.target.checked;markDirty();});on('[data-auto-columns-open]','click',openReportColumns);
    on('[data-schedule-enabled]','change',e=>{draft.schedule.enabled=e.target.checked;if(e.target.checked&&draft.schedule.mode==='manual')draft.schedule.mode='weekly';markDirty();renderEditorPreserveScroll();});on('[data-schedule-mode]','change',e=>{draft.schedule.mode=e.target.value;markDirty();renderEditorPreserveScroll();});on('[data-schedule-time]','change',e=>{draft.schedule.time=e.target.value;markDirty();});on('[data-schedule-hours]','input',e=>{draft.schedule.intervalHours=Math.max(1,Math.min(168,Number(e.target.value)||24));markDirty();});host.querySelectorAll('[data-weekday]').forEach(el=>el.onchange=()=>{draft.schedule.weekdays=[...host.querySelectorAll('[data-weekday]:checked')].map(x=>Number(x.dataset.weekday));markDirty();});
    host.querySelector('[data-app-add]')?.addEventListener('click',()=>{draft.appActions.push({action:'open_page',page:'cp',source:'cp'});markDirty();renderEditorPreserveScroll();});host.querySelectorAll('[data-app-action]').forEach(row=>{const i=Number(row.dataset.appAction);row.querySelector('[data-app-kind]').onchange=e=>{draft.appActions[i].action=e.target.value;markDirty();renderEditorPreserveScroll();};row.querySelector('[data-app-page]')?.addEventListener('change',e=>{draft.appActions[i].page=e.target.value;markDirty();});row.querySelector('[data-app-source]')?.addEventListener('change',e=>{draft.appActions[i].source=e.target.value;markDirty();});row.querySelector('[data-app-delete]').onclick=()=>{draft.appActions.splice(i,1);markDirty();renderEditorPreserveScroll();};});}

  function showChangePurpose(){closeAutomationModal(document.getElementById('_autoPurposeChange'));const modal=document.createElement('div');modal.id='_autoPurposeChange';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';modal.innerHTML=`<div class="autoModal narrow"><header><div><span class="autoEyebrow">JOB TYPE</span><h3>${esc(tr('İş türünü değiştir','Change job type'))}</h3></div><button data-close>×</button></header><div class="autoModalBody"><label class="autoField"><span>${esc(tr('Yeni iş türü','New job type'))}</span><select data-purpose-select>${Object.entries(PURPOSES).map(([k,m])=>`<option value="${k}"${draft.purpose===k?' selected':''}>${esc(tr(m.tr,m.en))}</option>`).join('')}</select></label><div class="autoInfo">${esc(tr('Mevcut veri koşulları korunur. Yeni türde kullanılmayan ayarlar silinmez; tekrar geri dönebilirsiniz.','Existing data conditions are preserved. Settings unused by the new type are kept so you can switch back.'))}</div></div><footer><button class="tbtn" data-close>${esc(tr('Vazgeç','Cancel'))}</button><button class="tbtn primary" data-apply>${esc(tr('Uygula','Apply'))}</button></footer></div>`;document.body.appendChild(modal);mountAutomationModal(modal);modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());modal.querySelector('[data-apply]').onclick=()=>{draft.purpose=modal.querySelector('[data-purpose-select]').value;if(draft.purpose==='browser'&&draft.source!=='manual'&&!SOURCES.includes(draft.source))draft.source='manual';markDirty();closeAutomationModal(modal);renderEditor();};}
  /* v7.175 — "BU OTOMASYON NE YAPACAK?" ve "HAZIR MI?"
     Editör artık boş alanlar yığını değil: en üstte otomasyonun ne yapacağı düz
     cümlelerle okunur ve eksik/yanlış olan her şey (olmayan alan için en yakın
     alan önerisiyle) tıklanabilir bir liste olarak durur. Her değişiklikte
     tazelenir; Çalıştır, bu listede HATA varken başlamaz. */
  function guideContext(){const key=draft?fieldCacheKey(draft.source,draftJoinSource()):'';return{lang:tr('tr','en'),fields:fieldCache.get(key)||[],fieldsLoaded:fieldCache.has(key),groups:groups(),sourceLabel,groupName:id=>{const group=groups().find(item=>item.id===id);return group?group.name:'';}};}
  const GUIDE_TARGETS={name:'[data-auto-name]',filter:'#autoFilters',email:'[data-email-recipient-mode]',schedule:'[data-schedule-enabled]',browser:'[data-auto-url]',analysis:'[data-analysis-group]',enabled:'[data-auto-enabled]'};
  function readinessIssues(){const A=assistant();return A&&draft?A.readiness(draft,guideContext()):[];}
  function renderGuide(){
    const host=document.getElementById('autoGuide'),A=assistant();
    if(!host)return;
    if(!A||!draft){host.hidden=true;host.innerHTML='';return;}
    const ctx=guideContext(),lines=A.summarize(draft,ctx),issues=A.readiness(draft,ctx),errors=issues.filter(item=>item.level==='error');
    host.hidden=false;
    host.innerHTML=`<div class="autoGuideSummary"><b>${esc(tr('Bu otomasyon ne yapacak?','What will this automation do?'))}</b><ol>${lines.map(line=>`<li>${esc(line.text)}</li>`).join('')}</ol></div><div class="autoGuideReady ${errors.length?'isTodo':'isReady'}"><b>${esc(errors.length?tr(`Hazır mı? ${errors.length} eksik var`,`Ready? ${errors.length} item(s) to fix`):tr('Hazır ✓','Ready ✓'))}</b>${issues.length?`<ul>${issues.map((item,index)=>`<li class="is-${esc(item.level)}"><button type="button" class="autoGuideJump" data-guide-jump="${index}">${esc(tr(item.tr,item.en))}</button>${item.suggestion?` <button type="button" class="autoMiniBtn" data-guide-fix="${index}">${esc(tr(`“${item.suggestion}” kullan`,`Use “${item.suggestion}”`))}</button>`:''}</li>`).join('')}</ul>`:''}${errors.length?'':`<p>${esc(tr('Önce “Dene” ile hangi kayıtların seçildiğini görün, sonra kaydedip çalıştırın.','First “Try it” to see which records are picked, then save and run.'))}</p>`}</div>`;
    host.querySelectorAll('[data-guide-jump]').forEach(btn=>btn.onclick=()=>{const item=issues[Number(btn.dataset.guideJump)],selector=GUIDE_TARGETS[item&&item.target];const el=selector&&document.querySelector(`#autoEditor ${selector}`);if(!el)return;(el.closest('.autoSection')||el).scrollIntoView({behavior:'smooth',block:'start'});const focusable=item.target==='filter'&&Number.isInteger(item.index)?document.querySelector(`#autoEditor [data-auto-filter="${item.index}"] [data-filter-field]`):el;setTimeout(()=>focusable&&focusable.focus&&focusable.focus(),250);});
    host.querySelectorAll('[data-guide-fix]').forEach(btn=>btn.onclick=()=>{const item=issues[Number(btn.dataset.guideFix)];if(!item||!item.suggestion)return;if(item.target==='filter'&&draft.filters[item.index])draft.filters[item.index].field=item.suggestion;else if(item.target==='email')draft.email.recipientField=item.suggestion;else if(item.target==='analysis')draft.analysis.groupBy=item.suggestion;markDirty();renderEditorPreserveScroll();});
  }
  function renderSaveState(){const el=document.getElementById('autoSaveState');if(el)el.textContent=dirty?tr('Kaydedilmemiş değişiklikler','Unsaved changes'):draft&&draft.id?tr('Kaydedildi','Saved'):tr('Henüz kaydedilmedi','Not saved yet');}
  /* v6.39 — Alan listesi artık ZİNCİRE bağlı. Bir tarif ikinci kaynak bağladıysa
     o kaynağın başlıkları da (önekli olarak) listede görünmeli; yoksa kullanıcı
     koşulu kurabileceği alanı hiç göremez. Önbellek anahtarına zincir de
     giriyor, aksi halde zincir değişince eski liste gösterilirdi. */
  function fieldCacheKey(source,joinSource){return joinSource?`${source}+${joinSource}`:source;}
  function draftJoinSource(){return (draft&&draft.join&&draft.join.source)||'';}
  async function loadFields(source,joinSource=draftJoinSource()){
    const key=fieldCacheKey(source,joinSource);
    if(fieldCache.has(key))return fieldCache.get(key);
    const query=`/api/automations/dataset-fields?source=${encodeURIComponent(source)}${joinSource?`&join=${encodeURIComponent(joinSource)}`:''}`;
    const data=await api(query);
    const fields=(data.fields||[]).filter(v=>v&&!String(v).startsWith('_'));
    fieldCache.set(key,fields);
    return fields;
  }
  function selectRecipe(id){if(dirty&&!confirm(tr('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?','Unsaved changes will be lost. Continue?')))return;abandonRecording();const found=recipeList().find(r=>r.id===id);draft=found?clone(found):emptyRecipe();dirty=false;if(draft.source!=='manual')loadFields(draft.source).finally(renderAll);else renderAll();}
  async function reload(keepId=''){const data=await api('/api/automations');state=data;const id=keepId||(draft&&draft.id);if(id){const found=recipeList().find(r=>r.id===id);if(found)draft=clone(found);}renderAll();}
  async function saveDraft(){if(!draft)return null;if(!(draft.name||'').trim()){toast(tr('Otomasyon adı zorunlu.','Automation name is required.'));return null;}if(draft.schedule&&draft.schedule.enabled&&draft.purpose!=='email'){toast(tr('Planlı çalışma yalnız E-posta otomasyonlarında kullanılabilir.','Scheduling is available only for Email automations.'));return null;}const payload=clone(draft),isNew=!draft.id;try{const data=await api(isNew?'/api/automations/recipes':`/api/automations/recipes/${encodeURIComponent(draft.id)}`,{method:isNew?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});state=data.state;draft=clone(data.recipe);markDirty(false);renderAll();toast(tr('Otomasyon kaydedildi.','Automation saved.'));return draft;}catch(e){toast(e.message);return null;}}
  async function ensureSaved(){if(!draft)return null;if(!draft.id||dirty)return saveDraft();return draft;}
  function monitorBrowserApproval(){let notified=false;const timer=setInterval(()=>{api('/api/automations/browser/status').then(data=>{const operation=data&&data.status&&data.status.operation;if(operation&&operation.state==='WAITING_FOR_USER'&&!notified){notified=true;toast(tr('Tarayıcı onayı bekleniyor… Edge ekranındaki Allow onayını verin.','Waiting for browser approval… confirm Allow in the Edge window.'));const status=document.getElementById('autoRecordStatus');if(status)status.textContent=tr('Tarayıcı onayı bekleniyor…','Waiting for browser approval…');}}).catch(()=>{});},700);timer.unref?.();return()=>clearInterval(timer);}
  async function openTarget(){const url=(draft&&draft.url||'').trim();if(!url){toast(tr('Önce hedef URL girin.','Enter the target URL first.'));return;}const stopApprovalMonitor=monitorBrowserApproval();try{await api('/api/automations/browser/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});toast(tr('Web sitesi mevcut Edge profilinizde yeni sekmede açıldı.','Website opened in a new tab of your current Edge profile.'));}catch(e){toast(e.message);}finally{stopApprovalMonitor();}}
  function stopPoll(){if(recordTimer)clearInterval(recordTimer);recordTimer=null;}
  function abandonRecording(){if(!recording)return;const id=recording.id;stopPoll();recording=null;api(`/api/automations/browser/record/${encodeURIComponent(id)}/stop`,{method:'POST'}).catch(()=>{});}
  function attachDefaultBindings(steps){return(steps||[]).map(step=>({...step,binding:step.binding||{mode:'fixed',field:''}}));}
  async function startRecording(){const url=(draft&&draft.url||'').trim();if(!url){toast(tr('Önce hedef URL girin.','Enter the target URL first.'));return;}if(recording&&!confirm(tr('Devam eden kayıt durdurulup yeni kayıt başlatılsın mı?','Stop the active recording and start a new one?')))return;stopPoll();const stopApprovalMonitor=monitorBrowserApproval();try{const data=await api('/api/automations/browser/record/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});recording={id:data.recording.id};draft.url=data.recording.url;draft.steps=attachDefaultBindings(data.recording.steps);markDirty();renderEditor();recordTimer=setInterval(async()=>{if(!recording)return;try{const current=await api(`/api/automations/browser/record/${encodeURIComponent(recording.id)}`);const old=draft.steps||[];draft.steps=attachDefaultBindings(current.recording.steps).map((s,i)=>({...s,binding:old[i]&&old[i].binding||s.binding}));markDirty();renderSteps();const status=document.getElementById('autoRecordStatus');if(status)status.textContent=`${tr('Kayıt açık','Recording')} · ${draft.steps.length} ${tr('adım','steps')}`;}catch(_){stopPoll();}},900);toast(tr('Kayıt başladı. Edge sekmesinde işlemi bir kez gösterin.','Recording started. Demonstrate the process once in the Edge tab.'));}catch(e){toast(e.message);}finally{stopApprovalMonitor();}}
  async function stopRecording(){if(!recording)return;const id=recording.id;try{const old=draft.steps||[],data=await api(`/api/automations/browser/record/${encodeURIComponent(id)}/stop`,{method:'POST'});stopPoll();recording=null;draft.url=data.recording.url||draft.url;draft.steps=attachDefaultBindings(data.recording.steps).map((s,i)=>({...s,binding:old[i]&&old[i].binding||s.binding}));markDirty();renderEditor();toast(`${draft.steps.length} ${tr('web adımı kaydedildi. Şimdi yazılan değerleri Buyer Log alanlarıyla bağlayabilirsiniz.','web steps recorded. You can now bind typed values to Buyer Log fields.')}`);}catch(e){toast(e.message);}}
  async function deleteDraft(){if(!draft||!draft.id)return;if(!confirm(tr(`“${draft.name}” otomasyonu silinsin mi?`,`Delete automation “${draft.name}”?`)))return;try{const data=await api(`/api/automations/recipes/${encodeURIComponent(draft.id)}`,{method:'DELETE'});state=data.state;draft=recipeList()[0]?clone(recipeList()[0]):null;dirty=false;renderAll();toast(tr('Otomasyon silindi.','Automation deleted.'));}catch(e){toast(e.message);}}

  function analysisHtml(a){if(!a)return'';if(!(a.groups||[]).length)return`<div class="autoPreviewNote">${esc(tr(`Eşleşen kayıt: ${a.total||0}`,`Matching rows: ${a.total||0}`))}</div>`;return`<h4>${esc(tr('Analiz sonucu','Analysis result'))}</h4><table class="autoPreviewTable"><thead><tr><th>${esc(a.groupBy||tr('Grup','Group'))}</th><th>${esc(tr('Adet','Count'))}</th><th>${esc(a.operation||'')}</th></tr></thead><tbody>${a.groups.map(g=>`<tr><td>${esc(g.key)}</td><td>${g.count}</td><td>${typeof g.value==='number'?g.value.toLocaleString(tr('tr-TR','en-GB'),{maximumFractionDigits:2}):esc(g.value)}</td></tr>`).join('')}</tbody></table>`;}
  /* v7.175 — önizleme ham JSON değil, okunur bir tablo gösterir. Sütunlar
     raporda seçili alanlardır; seçilmemişse ilk altı alan. */
  function sampleTableHtml(sample){
    if(!sample.length)return'';
    const keys=[...new Set(sample.flatMap(row=>Object.keys(row||{})))].filter(key=>key&&!String(key).startsWith('_'));
    const picked=(draft&&draft.email&&draft.email.reportFields||[]).filter(key=>keys.includes(key));
    const columns=(picked.length?picked:keys).slice(0,8);
    const cell=value=>value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
    return `<h4>${esc(tr(`İlk eşleşmeler (${sample.length})`,`First matches (${sample.length})`))}</h4><div class="autoPreviewTableWrap"><table class="autoPreviewTable"><thead><tr>${columns.map(key=>`<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${sample.map(row=>`<tr>${columns.map(key=>`<td>${esc(cell(row&&row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  // Kanonik kayıttan onarılan alanlar açıkça söylenir; sessiz eşleme yok.
  function fieldCheckHtml(check){
    const remapped=check&&Array.isArray(check.remapped)?check.remapped:[];
    const missing=check&&Array.isArray(check.missing)?check.missing:[];
    const notes=[];
    if(remapped.length)notes.push(tr(`Başlığı değişmiş alan otomatik eşlendi: ${remapped.map(item=>`“${item.from}” → “${item.to}”`).join(', ')}. Otomasyonu açıp alanı yeni adıyla kaydederseniz bu not kaybolur.`,`A renamed field was matched automatically: ${remapped.map(item=>`“${item.from}” → “${item.to}”`).join(', ')}. Save the automation with the new name to clear this note.`));
    if(missing.length)notes.push(tr(`Veride bulunamayan alan: ${missing.map(item=>`“${item.field}”${item.suggestion?` (belki “${item.suggestion}”)`:''}`).join(', ')}.`,`Field(s) not found in the data: ${missing.map(item=>`“${item.field}”${item.suggestion?` (maybe “${item.suggestion}”)`:''}`).join(', ')}.`));
    return notes.map(text=>`<div class="autoPreviewNote isWarn">${esc(text)}</div>`).join('');
  }
  function showPreview(preview){closeAutomationModal(document.getElementById('_autoPreview'));const modal=document.createElement('div');modal.id='_autoPreview';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';const sample=preview.sample||[],email=preview.email;modal.innerHTML=`<div class="autoModal"><header><div><span class="autoEyebrow">DRY RUN</span><h3>${esc(tr('Otomasyon Ön İzleme','Automation Preview'))}</h3></div><button data-close>×</button></header><div class="autoModalBody">${preview.join?`<div class="autoPreviewNote">${esc(tr(`Zincir: ${sourceLabel(preview.join.source)} · ${preview.join.matched} satır eşleşti, ${preview.join.unmatched} satır eşleşmedi${preview.join.duplicates?`, ikinci kaynakta ${preview.join.duplicates} satır aynı sipariş koduna sahip olduğu için ilki bağlandı`:''}${preview.join.keyless?`, ${preview.join.keyless} satırda sipariş kodu okunamadı`:''}.`,`Chain: ${sourceLabel(preview.join.source)} · ${preview.join.matched} matched, ${preview.join.unmatched} unmatched${preview.join.duplicates?`, ${preview.join.duplicates} rows in the second source shared an order code so the first was linked`:''}${preview.join.keyless?`, ${preview.join.keyless} rows had no readable order code`:''}.`))}</div>`:''}<div class="autoStats"><div><span>${esc(tr('Toplam kaynak','Source rows'))}</span><b>${Number(preview.total)||0}</b></div><div><span>${esc(tr('Eşleşen','Matched'))}</span><b>${Number(preview.matched)||0}</b></div><div><span>${esc(tr('İşlenecek','Will process'))}</span><b>${Number(preview.willProcess)||0}</b></div><div><span>${esc(tr('İş türü','Job type'))}</span><b class="autoStatText">${esc(tr(purposeMeta(preview.purpose).tr,purposeMeta(preview.purpose).en))}</b></div></div><div class="autoPreviewNote">${esc(tr('Dry Run gerçek web tıklaması, e-posta gönderimi veya veri değişikliği yapmaz. Veri koşullarını ve işlem planını doğrular.','Dry Run performs no real web clicks, email sends or data changes. It validates data conditions and the execution plan.'))}</div>${preview.change&&preview.change.configured?`<div class="autoChangePreview">${esc(preview.change.baselineReady?tr(`Değişim takibi aktif. ${preview.matched||0} kayıt seçili alanda önceki çalışmaya göre değişti.`,`Change tracking is active. ${preview.matched||0} row(s) changed in the selected field since the previous run.`):tr('Değişim takibi henüz başlangıç verisine sahip değil. İlk gerçek çalıştırma mevcut değerleri başlangıç kabul edecek ve e-posta/web işlemi çalıştırmayacak.','Change tracking has no baseline yet. The first real run will store current values as the baseline and will not run email/web actions.'))}</div>`:''}${email?`<div class="autoEmailPreview"><b>${esc(tr('E-posta','Email'))}: ${esc(email.groupName||'')}</b><span>To: ${esc((email.to||[]).join('; '))}</span><span>${esc(email.subject||'')}</span><span>${email.rows||0} ${esc(tr('rapor satırı','report rows'))} · ${esc(tr('Taslak','Draft'))}</span></div>`:''}${analysisHtml(preview.analysis)}${fieldCheckHtml(preview.fieldCheck)}${sampleTableHtml(sample)}</div><footer><button class="tbtn primary" data-close>${esc(tr('Kapat','Close'))}</button></footer></div>`;document.body.appendChild(modal);mountAutomationModal(modal);modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());modal.onclick=e=>{if(e.target===modal)closeAutomationModal(modal);};}
  async function previewDraft(){const saved=await ensureSaved();if(!saved)return;try{const data=await api(`/api/automations/recipes/${encodeURIComponent(saved.id)}/preview`,{method:'POST'});state=data.state;renderRuns();showPreview(data.preview);}catch(e){toast(e.message);}}
  function applyUiActions(result){for(const action of result&&result.uiActions||[]){if(action.action==='open_page'&&action.page){document.querySelector(`[data-tab="${CSS.escape(action.page)}"]`)?.click();}}}
  async function runDraft(){const blocking=readinessIssues().filter(item=>item.level==='error');if(blocking.length){toast(tr(`Çalıştırmadan önce düzeltin: ${blocking[0].tr}`,`Fix before running: ${blocking[0].en}`));document.getElementById('autoGuide')?.scrollIntoView({behavior:'smooth',block:'start'});return;}const saved=await ensureSaved();if(!saved)return;try{const pre=await api(`/api/automations/recipes/${encodeURIComponent(saved.id)}/preview`,{method:'POST'});state=pre.state;renderRuns();const p=pre.preview;let warning=p.change&&p.change.configured&&!p.change.baselineReady?tr('Bu ilk çalıştırma yalnız değişim takibi için başlangıç değerlerini kaydedecek; e-posta veya web işlemi yapılmayacak. Devam edilsin mi?','This first run will only store baseline values for change tracking; no email or web action will run. Continue?'):p.change&&p.change.configured&&!p.matched?tr('Seçilen alanda önceki çalışmaya göre değişiklik yok. Başlangıç değerleri güncellensin mi?','No changes were found in the selected field since the previous run. Update the baseline values?'):tr(`Bu otomasyon ${p.willProcess} kayıt üzerinde çalışacak. Devam edilsin mi?`,`This automation will run on ${p.willProcess} row(s). Continue?`);if(hasBrowser()&&p.willProcess)warning+=tr(`\nWeb sitesinde ${(p.steps||[]).length} kayıtlı adım uygulanacak.`,`\n${(p.steps||[]).length} recorded web step(s) will run.`);if(!confirm(warning))return;toast(tr('Otomasyon çalışıyor…','Automation is running…'));const stopApprovalMonitor=hasBrowser()?monitorBrowserApproval():()=>{};let data;try{data=await api(`/api/automations/recipes/${encodeURIComponent(saved.id)}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewToken:pre.previewToken||''})});}finally{stopApprovalMonitor();}state=data.state;renderRuns();const result=data.result||{};applyUiActions(result);const unresolved=Array.isArray(result.unresolvedRecipients)?result.unresolvedRecipients:[];if(unresolved.length)setTimeout(()=>toast(tr(`${unresolved.length} alıcı çözülemedi, e-posta oluşturulmadı: ${unresolved.slice(0,3).map(item=>item.value).join(', ')}. Üreticiler sayfasında kartı ve e-postası olmayanları tamamlayın; Non-DTR lisans siparişlerinde Alt Üretici dolu olmalı.`,`${unresolved.length} recipient(s) could not be resolved, no email created: ${unresolved.slice(0,3).map(item=>item.value).join(', ')}. Complete missing cards and e-mails on the Manufacturers page; non-DTR license orders need a Sub-Manufacturer.`)),2600);if(result.email&&result.email.draftUrl&&!result.email.opened){window.open(result.email.draftUrl,'_blank');}toast(result.skipped==='baseline_created'?tr('Başlangıç değerleri kaydedildi. Bir sonraki değişiklikte otomasyon tetiklenecek.','Baseline values saved. The automation will trigger on the next change.'):result.skipped==='no_change'?tr('Değişiklik bulunmadı; işlem çalıştırılmadı.','No change found; no action was run.'):result.failed?tr(`${result.processed} başarılı · ${result.failed} başarısız.`,`${result.processed} succeeded · ${result.failed} failed.`):tr('Otomasyon başarıyla tamamlandı.','Automation completed successfully.'));}catch(e){toast(e.message);await reload(saved.id).catch(()=>{});}}

  /* ===================================================================
     v6.41 — YERLEŞİK WEB BETİKLERİ DÜZENLEYİCİSİ
     Buyer Log'un dış sitelerle konuşan gömülü akışları (PLM görsel indirme /
     küçültme, QTX indirme) burada düzenlenir. Dış sitenin yapısı değiştiğinde
     yeni sürüm beklemeden buradan düzeltilebilir.
     Fabrika kodu koddaki yerinde durur; buradaki düzenleme yalnız üst katmandır,
     bu yüzden "Varsayılana dön" her zaman çalışır.
     =================================================================== */
  let webScriptsCache=[];
  async function openWebScripts(){
    closeAutomationModal(document.getElementById('_autoWebScripts'));
    let data;
    try{ data=await api('/api/web-scripts'); }
    catch(e){ toast(e.message); return; }
    webScriptsCache=Array.isArray(data.scripts)?data.scripts:[];
    const modal=document.createElement('div');
    modal.id='_autoWebScripts';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';
    const listHtml=webScriptsCache.map(item=>`<button type="button" class="autoWebScriptItem" data-web-script="${esc(item.id)}"><b>${esc(item.label)}</b><small>${esc(item.source==='override'?tr('Düzenlenmiş','Edited'):tr('Varsayılan','Factory'))}${item.updatedAt?` · ${esc(fmtDate(item.updatedAt))}`:''}</small></button>`).join('');
    modal.innerHTML=`<div class="autoModal settings"><header><div><span class="autoEyebrow">${esc(tr('YERLEŞİK WEB BETİKLERİ','BUILT-IN WEB SCRIPTS'))}</span><h3>${esc(tr('Dış site akışlarını düzenle','Edit external site flows'))}</h3><p>${esc(tr('Bu betikler Buyer Log içindeki hazır dış web akışlarıdır. Dış sitenin yapısı değişirse burada güncelleyebilirsiniz; her zaman varsayılana dönebilirsiniz.','These are Buyer Log\'s built-in external web flows. If the external site changes you can update them here, and you can always restore the factory version.'))}</p></div><button data-close>×</button></header><div class="autoWebScriptLayout"><aside class="autoWebScriptList">${listHtml}</aside><div class="autoWebScriptEditor" data-web-script-editor><div class="autoEmpty">${esc(tr('Soldan bir betik seçin.','Select a script on the left.'))}</div></div></div><footer><button class="tbtn" data-close>${esc(tr('Kapat','Close'))}</button></footer></div>`;
    document.body.appendChild(modal);mountAutomationModal(modal);
    modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());
    modal.querySelectorAll('[data-web-script]').forEach(btn=>btn.onclick=()=>selectWebScript(modal,btn.dataset.webScript));
    if(webScriptsCache.length)selectWebScript(modal,webScriptsCache[0].id);
  }
  function selectWebScript(modal,id){
    const item=webScriptsCache.find(entry=>entry.id===id);
    const host=modal.querySelector('[data-web-script-editor]');
    if(!item||!host)return;
    modal.querySelectorAll('[data-web-script]').forEach(btn=>btn.classList.toggle('active',btn.dataset.webScript===id));
    const isOverride=item.source==='override';
    host.innerHTML=`<div class="autoWebScriptHead"><b>${esc(item.label)}</b><small>${esc(item.description)}</small></div>
      <div class="autoPreviewNote">${esc(tr(`Kod tarayıcıda çalışır. Elinizdeki değerler: params.${item.params.join(', params.')}. Döndürmesi beklenen: ${item.returns}`,`The code runs in the browser. Available values: params.${item.params.join(', params.')}. Expected return: ${item.returns}`))}</div>
      ${isOverride?'':`<div class="autoPreviewNote">${esc(tr('Bu betik şu an varsayılan sürümüyle çalışıyor. Aşağıya kod yazıp kaydettiğinizde kendi sürümünüz devreye girer.','This script currently runs its factory version. Writing and saving code below activates your own version.'))}</div>`}
      <textarea class="autoTerminalCode" data-web-script-code rows="16" spellcheck="false" autocomplete="off" placeholder="// params.${item.params[0]||'x'} ...\nreturn { ok: true };">${esc(item.code||'')}</textarea>
      <div class="autoWebScriptStatus" data-web-script-status></div>
      <div class="autoWebScriptActions">
        <button type="button" class="tbtn" data-web-script-validate>${esc(tr('Sözdizimini denetle','Check syntax'))}</button>
        <button type="button" class="tbtn" data-web-script-reset${isOverride?'':' disabled'}>${esc(tr('Varsayılana dön','Restore factory'))}</button>
        <button type="button" class="tbtn primary" data-web-script-save>${esc(tr('Kaydet','Save'))}</button>
      </div>`;
    const codeEl=host.querySelector('[data-web-script-code]');
    const statusEl=host.querySelector('[data-web-script-status]');
    const setStatus=(text,kind)=>{statusEl.textContent=text||'';statusEl.className=`autoWebScriptStatus${kind?' is'+kind:''}`;};
    host.querySelector('[data-web-script-validate]').onclick=async()=>{
      try{const result=await api(`/api/web-scripts/${encodeURIComponent(id)}/validate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:codeEl.value})});
        setStatus(result.valid?tr('Sözdizimi geçerli.','Syntax is valid.'):result.error,result.valid?'Ok':'Error');
      }catch(e){setStatus(e.message,'Error');}
    };
    host.querySelector('[data-web-script-save]').onclick=async()=>{
      try{const result=await api(`/api/web-scripts/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:codeEl.value})});
        webScriptsCache=result.scripts||webScriptsCache;
        setStatus(tr('Kaydedildi. Bu betik artık sizin sürümünüzle çalışıyor.','Saved. This script now runs your version.'),'Ok');
        refreshWebScriptList(modal);selectWebScript(modal,id);
      }catch(e){setStatus(e.message,'Error');}
    };
    host.querySelector('[data-web-script-reset]').onclick=async()=>{
      if(!confirm(tr('Bu betik varsayılan sürümüne dönecek. Yazdığınız kod silinecek. Devam edilsin mi?','This script will return to its factory version and your code will be deleted. Continue?')))return;
      try{const result=await api(`/api/web-scripts/${encodeURIComponent(id)}/reset`,{method:'POST'});
        webScriptsCache=result.scripts||webScriptsCache;
        refreshWebScriptList(modal);selectWebScript(modal,id);
        toast(tr('Varsayılan sürüme dönüldü.','Restored to the factory version.'));
      }catch(e){setStatus(e.message,'Error');}
    };
  }
  function refreshWebScriptList(modal){
    const host=modal.querySelector('.autoWebScriptList');
    if(!host)return;
    host.innerHTML=webScriptsCache.map(item=>`<button type="button" class="autoWebScriptItem" data-web-script="${esc(item.id)}"><b>${esc(item.label)}</b><small>${esc(item.source==='override'?tr('Düzenlenmiş','Edited'):tr('Varsayılan','Factory'))}${item.updatedAt?` · ${esc(fmtDate(item.updatedAt))}`:''}</small></button>`).join('');
    host.querySelectorAll('[data-web-script]').forEach(btn=>btn.onclick=()=>selectWebScript(modal,btn.dataset.webScript));
  }
  async function openSettings(){if(!state)return;closeAutomationModal(document.getElementById('_autoSettings'));const can=Boolean(state.canConfigure);let browserStatus={};try{const data=await api('/api/automations/browser/status');browserStatus=data.status||{};}catch(_){browserStatus={};}const modal=document.createElement('div');modal.id='_autoSettings';modal.className='autoModalOverlay';modal.dataset.uiMigrated='operations';const editableGroups=groups().filter(g=>g.source!=='prepare_email'),prepareGroups=groups().filter(g=>g.source==='prepare_email');const groupRows=editableGroups.map(g=>`<div class="autoGroupRow" data-group-id="${esc(g.id||'')}"><input data-g-name value="${esc(g.name)}" placeholder="${esc(tr('Grup adı','Group name'))}" ${can?'':'disabled'}><textarea data-g-to rows="2" placeholder="To" ${can?'':'disabled'}>${esc((g.to||[]).join('\n'))}</textarea><textarea data-g-cc rows="2" placeholder="CC" ${can?'':'disabled'}>${esc((g.cc||[]).join('\n'))}</textarea><button data-g-delete ${can?'':'disabled'}>×</button></div>`).join('');const prepareRows=prepareGroups.length?`<div class="autoImportedGroups"><div class="autoImportedHead"><b>${esc(tr('Prepare E-Mail grupları','Prepare E-Mail groups'))}</b><small>${esc(tr('Bu kayıtlar Prepare E-Mail ekranından gelir; burada yalnız seçim için gösterilir ve oradan düzenlenir.','These entries come from Prepare E-Mail; they are shown here for selection and are edited there.'))}</small></div>${prepareGroups.map(g=>`<div class="autoImportedGroup"><b>${esc(g.name)}</b><span title="${esc((g.to||[]).join('; '))}">${esc((g.to||[]).join('; '))}</span></div>`).join('')}</div>`:'';const edgeState=()=>browserStatus.existingProfileReady?tr('Bağlı · mevcut Edge profili','Connected · current Edge profile'):tr('Bağlantı gerekli','Connection required');modal.innerHTML=`<div class="autoModal settings"><header><div><span class="autoEyebrow">AUTOMATION SETTINGS</span><h3>${esc(tr('Otomasyon Ayarları','Automation Settings'))}</h3></div><button data-close>×</button></header><div class="autoSettingsTabs"><button class="active" data-settings-tab="browser">${esc(tr('Web bağlantıları','Web connections'))}</button><button data-settings-tab="mail">${esc(tr('E-posta grupları','Email groups'))}</button></div><div class="autoModalBody" data-settings-panel="browser"><div class="autoPreviewNote">${esc(tr('Web otomasyonu ayrı/boş bir Edge profili açmaz. Mevcut Edge profilinize bağlanır; böylece şirket oturumlarınız ve kayıtlı girişleriniz kullanılabilir.','Web automation does not open a separate/empty Edge profile. It connects to your current Edge profile so company sessions and saved sign-ins remain available.'))}</div><div class="autoStats"><div><span>${esc(tr('Edge profili','Edge profile'))}</span><b data-auto-edge-state>${esc(edgeState())}</b></div></div><div class="autoBrowserActions"><button class="tbtn" data-auto-edge-prepare>${esc(tr('Mevcut Edge profilini bağla','Connect current Edge profile'))}</button><button class="tbtn" data-auto-edge-check>${esc(tr('Bağlantıyı kontrol et','Check connection'))}</button><button class=\"tbtn\" data-auto-edge-diagnose>${esc(tr('Neden bağlanmıyor?','Why not connecting?'))}</button></div><div class="autoPreviewNote" data-auto-edge-help>${esc(browserStatus.existingProfileReady?tr('Hazır. Kayıt ve çalıştırma sırasında dış siteler bu profilin yeni sekmesinde açılır.','Ready. During recording and replay, external sites open in a new tab of this profile.'):tr('Edge bağlantısı kapalıysa “Mevcut Edge profilini bağla”ya basın. Açılan edge://inspect/#remote-debugging sayfasında “Allow remote debugging for this browser instance” kutusunu işaretleyip Bağlantıyı kontrol et’e basın.','When the Edge connection is disabled, click “Connect current Edge profile”. On the edge://inspect/#remote-debugging page that opens, tick “Allow remote debugging for this browser instance”, then click Check connection.'))}</div><div class="autoPreviewNote">${esc(tr('Güvenlik: bu bağlantı giriş yapılmış oturumları kullanabildiği için yalnız güvenilen Buyer Log otomasyonlarında kullanılmalıdır. Şifre/OTP alanları kaydedilmez ve HTTPS allowlist kuralı devam eder.','Security: because this connection can use signed-in sessions, use it only with trusted Buyer Log automations. Password/OTP fields are not recorded and the HTTPS allowlist remains enforced.'))}</div><label class="autoField"><span>${esc(tr('İzinli hostlar','Allowed hosts'))}</span><textarea id="autoHosts" rows="9" ${can?'':'disabled'}>${esc((state.browser.allowedHosts||[]).join('\n'))}</textarea></label></div><div class="autoModalBody" data-settings-panel="mail" hidden><div class="autoPreviewNote">${esc(tr('E-posta otomasyonlarında kullanıcı tek tek adres yazmaz; burada kayıtlı grubu seçer. Prepare E-Mail ekranındaki kayıtlı e-posta grupları da otomatik olarak seçim listesine eklenir.','Email automations use saved groups instead of asking users to type addresses each time. Saved groups from Prepare E-Mail are also added automatically to the selection list.'))}</div><div id="autoGroupRows" class="autoGroupRows">${groupRows}</div>${can?`<button class="tbtn" data-group-add>＋ ${esc(tr('Grup ekle','Add group'))}</button>`:''}${prepareRows}</div><footer><button class="tbtn" data-close>${esc(tr('Kapat','Close'))}</button>${can?`<button class="tbtn primary" data-settings-save>${esc(tr('Kaydet','Save'))}</button>`:''}</footer></div>`;document.body.appendChild(modal);mountAutomationModal(modal);const switchTab=tab=>{modal.querySelectorAll('[data-settings-tab]').forEach(b=>b.classList.toggle('active',b.dataset.settingsTab===tab));modal.querySelectorAll('[data-settings-panel]').forEach(p=>p.hidden=p.dataset.settingsPanel!==tab);};modal.querySelectorAll('[data-settings-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.settingsTab));modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.remove());const refreshEdge=async()=>{const data=await api('/api/automations/browser/status');browserStatus=data.status||{};const badge=modal.querySelector('[data-auto-edge-state]'),help=modal.querySelector('[data-auto-edge-help]');if(badge)badge.textContent=edgeState();if(help)help.textContent=browserStatus.existingProfileReady?tr('Hazır. Kayıt ve çalıştırma sırasında dış siteler bu profilin yeni sekmesinde açılır.','Ready. During recording and replay, external sites open in a new tab of this profile.'):tr('Edge bağlantısı henüz hazır değil. Remote debugging iznini açtıktan sonra tekrar kontrol edin.','The Edge connection is not ready yet. Enable Remote debugging and check again.');return browserStatus.existingProfileReady;};modal.querySelector('[data-auto-edge-prepare]')?.addEventListener('click',async()=>{try{await api('/api/automations/browser/prepare-existing-edge',{method:'POST'});const help=modal.querySelector('[data-auto-edge-help]');if(help)help.textContent=tr('Edge ayar sayfası açıldı. “Allow remote debugging for this browser instance” kutusunu işaretleyin. Kutu görünmüyorsa adres çubuğuna edge://inspect/#remote-debugging yazın; hâlâ yoksa Edge’i güncelleyip yeniden başlatın. Sonra Bağlantıyı kontrol et’e basın.','The Edge setup page opened. Tick “Allow remote debugging for this browser instance”. If the checkbox is missing, type edge://inspect/#remote-debugging in the address bar; if it is still missing, update Edge and restart it. Then click Check connection.');}catch(e){toast(e.message);}});modal.querySelector('[data-auto-edge-diagnose]')?.addEventListener('click',async()=>{const help=modal.querySelector('[data-auto-edge-help]');try{const data=await api('/api/automations/browser/diagnose');const lines=(data.report&&data.report.checks||[]).map(c=>`${c.ok?'✓':'✗'} ${c.detail}`);if(help)help.textContent=lines.join('  |  ')||tr('Tanılama sonucu boş döndü.','The diagnostic returned nothing.');}catch(e){if(help)help.textContent=e.message;}});modal.querySelector('[data-auto-edge-check]')?.addEventListener('click',async()=>{try{const ok=await refreshEdge();toast(ok?tr('Mevcut Edge profili bağlandı.','Current Edge profile connected.'):tr('Edge bağlantısı henüz hazır değil.','Edge connection is not ready yet.'));}catch(e){toast(e.message);}});modal.querySelector('[data-group-add]')?.addEventListener('click',()=>{const wrap=modal.querySelector('#autoGroupRows'),div=document.createElement('div');div.className='autoGroupRow';div.dataset.groupId='';div.innerHTML=`<input data-g-name placeholder="${esc(tr('Grup adı','Group name'))}"><textarea data-g-to rows="2" placeholder="To"></textarea><textarea data-g-cc rows="2" placeholder="CC"></textarea><button data-g-delete>×</button>`;wrap.appendChild(div);div.querySelector('[data-g-delete]').onclick=()=>div.remove();});modal.querySelectorAll('[data-g-delete]').forEach(b=>b.onclick=()=>b.closest('.autoGroupRow').remove());modal.querySelector('[data-settings-save]')?.addEventListener('click',async()=>{try{const allowedHosts=modal.querySelector('#autoHosts').value.split(/\n|,|;/).map(v=>v.trim()).filter(Boolean);await api('/api/automations/browser/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allowedHosts})});const emailGroups=[...modal.querySelectorAll('#autoGroupRows .autoGroupRow')].map(row=>({id:row.dataset.groupId||'',name:row.querySelector('[data-g-name]').value,to:row.querySelector('[data-g-to]').value.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean),cc:row.querySelector('[data-g-cc]').value.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean),bcc:[]})).filter(g=>g.name.trim());const data=await api('/api/automations/email-groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groups:emailGroups})});state=data.state;renderAll();closeAutomationModal(modal);toast(tr('Otomasyon ayarları kaydedildi.','Automation settings saved.'));}catch(e){toast(e.message);}});}

  function renderAll(){renderTop();renderDashboardStats();renderRecipes();renderRuns();renderEditor();}
  async function init(){const host=root();if(!host)return;if(host.dataset.ready==='1'){renderAll();return;}host.dataset.ready='1';host.innerHTML=`<div class="autoLoading">${esc(tr('Otomasyonlar yükleniyor…','Loading automations…'))}</div>`;try{state=await api('/api/automations');draft=recipeList()[0]?clone(recipeList()[0]):null;dirty=false;if(draft&&draft.source!=='manual')await loadFields(draft.source);renderShell();}catch(e){host.innerHTML=`<div class="autoError">${esc(e.message)}</div>`;}}
  /* v9.51 — ANALİZ EKRANLARINDAN OTOMASYON OLUŞTURMA.
     Kullanıcı isteği: CP ve Backlog analiz ekranlarından doğrudan otomasyon
     hazırlayabilmek. Filtreyi otomasyon ekranında elle kurmak, ekranda görülen
     kırılımın koşula yanlış çevrilmesi riskini taşıyordu.

     İKİ GÜVENCE:
     · Yeni tarif KAPALI (enabled:false) ve zamanlamasız oluşturulur. Bir
       düğmeye basmak, gözden geçirilmemiş bir otomasyonun Pazartesi 09:00'da
       e-posta üretmeye başlaması anlamına GELMEMELİ.
     · Teslim şekli her zaman taslak. Buradan otomatik gönderim kurulamaz.
     Oluşturulan tarif Otomasyonlar ekranında açılır; kullanıcı gözden geçirip
     kendisi etkinleştirir. */
  async function createFromAnalysis(spec){
    const input=spec&&typeof spec==='object'?spec:{};
    const source=['cp','backlog','orders','lfl','collection','asas','ias'].includes(input.source)?input.source:'cp';
    const recipe=emptyRecipe('email');
    recipe.name=(input.name||tr('Analizden otomasyon','Automation from analysis')).slice(0,180);
    recipe.description=(input.description||'').slice(0,4000);
    recipe.source=source;
    recipe.enabled=false;
    recipe.filters=(Array.isArray(input.filters)?input.filters:[]).slice(0,20)
      .map(f=>({field:String(f&&f.field||''),operator:String(f&&f.operator||'eq'),value:f&&f.value==null?'':String(f.value)}))
      .filter(f=>f.field);
    recipe.email={...recipe.email,
      recipientMode:'field',
      recipientField:input.recipientField||(source==='backlog'?'Üretici':'Manufacturer'),
      subject:input.subject||recipe.name,
      deliveryMode:'draft',
      languageMode:input.languageMode||'auto',
      reportFields:(Array.isArray(input.reportFields)?input.reportFields:[]).slice(0,40)};
    recipe.schedule={...recipe.schedule,enabled:false,mode:'manual'};
    if(input.backlog&&typeof input.backlog==='object')recipe.backlog={...recipe.backlog,...input.backlog};
    const saved=await api('/api/automations/recipes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recipe)});
    state=saved.state;dirty=false;
    if(typeof switchTab==='function')switchTab('automations');
    renderAll();
    selectRecipe(saved.recipe.id);
    toast(tr('Otomasyon taslağı oluşturuldu. Gözden geçirip etkinleştirin.','Automation draft created. Review it and enable it.'));
    return saved.recipe;
  }

  window.addEventListener('pagehide',()=>abandonRecording(),{once:false});
  /* v7.175 — AI ile oluşturulan taslak listede hemen görünür ve açılır. Olay
     yayımlanıyordu ama dinleyen yoktu: taslak ancak sayfa yeniden açılınca
     görünüyordu. */
  window.addEventListener('buyerlog:automation-ai-imported',event=>{const id=event&&event.detail&&event.detail.id;reload('').then(()=>{if(id)selectRecipe(id);}).catch(e=>toast(e.message));});window.initAutomationStudio=init;
  window.BLAutomations={createFromAnalysis};
})();
