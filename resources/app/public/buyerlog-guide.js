/* Buyer Log · one source for startup tips and the searchable user guide.
 * Illustrations are synthetic UI examples. No business records or remote assets.
 * Navigation only opens a permitted screen; it never clicks a business action.
 */
(function(global){
  'use strict';
  const data=global.BLGuideData;
  if(!data)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lang=()=>{try{return typeof appLang!=='undefined'&&appLang==='en'?'en':'tr';}catch(_){return document.documentElement.lang==='en'?'en':'tr';}};
  const t=(tr,en)=>lang()==='en'?en:tr;
  const field=(item,key)=>item[key]?.[lang()]||item[key]?.tr||'';
  const normal=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ı/g,'i');
  const moduleFor=id=>data.modules.find(m=>m.id===id);
  function profile(){try{return (typeof state!=='undefined'&&state.currentUser)||global.BL_USER_CONTEXT||null;}catch(_){return global.BL_USER_CONTEXT||null;}}
  function areaAllowed(area){
    if(!area)return true;
    const areas=profile()?.accessAreas;
    if(!areas)return false;
    const mapped=['quotations','pricinghistory'].includes(area)?'koleksiyon':area;
    return Boolean(mapped==='orders'?(areas.orders??areas.cp):areas[mapped]);
  }
  function allowed(item){if(item.capability&&!profile()?.capabilities?.includes(item.capability))return false;return !item.areas.length||item.areas.some(areaAllowed);}
  function available(){return data.lessons.filter(allowed);}
  function shuffle(list){const out=list.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  // Ordered deck within a startup: no repeated tip before all available cards.
  let deck=[],tipIndex=0,tipTimer=null,bootRoot=null,paused=false,dialog=null,lastFocus=null,currentId='',moduleId='all',query='',navGeneration=0;
  function cardList(){const text=normal(query);return available().filter(c=>(moduleId==='all'||c.module===moduleId)&&(!text||normal([field(c,'title'),field(c,'summary'),field(c,'path'),field(moduleFor(c.module),'label'),...c.steps[lang()]].join(' ')).includes(text)));}
  function illustration(item){
    const title=esc(item.example||field(item,'title'));
    const active=esc(item.visual==='view'?item.example:t('İlgili işlem','Selected action'));
    let body='';
    if(item.visual==='map')body=`<svg viewBox="0 0 520 210" role="img" aria-label="${esc(t('Sevkiyat rotasının örnek görünümü','Example shipment route'))}"><ellipse cx="260" cy="100" rx="188" ry="85"/><path d="M72 100H448M260 15V185M95 55H425M95 145H425"/><path class="blGuideRoute" d="M155 125Q255 25 345 86"/><circle class="blGuideNode" cx="155" cy="125" r="9"/><circle class="blGuideNode" cx="345" cy="86" r="9"/><text x="109" y="158">${esc(t('Çıkış','Origin'))}</text><text x="325" y="117">${esc(t('Varış','Arrival'))}</text></svg>`;
    else if(item.visual==='formula')body=`<div class="blGuideRecipe"><span>${t('Kaynak sütunlar','Source columns')}</span><div class="blGuideCells"><b>[A]</b><b>[B]</b><b>→</b><b class="blGuideMarked">${t('Sonuç','Result')}</b></div><code>${title}</code><small>${t('Önizle → Denetle → Kaydet','Preview → Validate → Save')}</small></div>`;
    else if(item.visual==='partial')body=`<div class="blGuidePartial"><div class="blGuideCells"><b>Order / Model</b><b class="blGuideMarked">▾</b></div><div class="blGuideChild">1 · ${t('Ana satır / durum','Main row / status')}</div><div class="blGuideChild">2 · ${t('Alt satır / durum','Child row / status')}</div><small>${title}</small></div>`;
    else if(item.visual==='column')body=`<div class="blGuideCells"><b>Model</b><b>Status</b><b class="blGuideMarked">+ ${t('Sütun','Column')}</b></div><div class="blGuideRows"><span>01</span><span>Model A</span><span>—</span><span>02</span><span>Model B</span><span>—</span></div><div class="blGuideVisualNote">${title}</div>`;
    else if(item.visual==='menu')body=`<div class="blGuideExampleMenu"><div>${t('Menü / işlem alanı','Menu / actions')}</div><div class="blGuideMarked">${title} <span>↗</span></div><div>${t('Seçili kayıtlar / ayarlar','Selected records / settings')}</div></div>`;
    else if(item.visual==='search'||item.visual==='filter')body=`<div class="blGuideSearchExample blGuideMarked">⌕ ${title} <b>i</b></div><div class="blGuideCells"><b>Model A</b><b>Status</b><b>Season ▾</b></div><div class="blGuideVisualNote">${t('Arama + aktif filtreler → görünen kayıtlar','Search + active filters → visible records')}</div>`;
    else if(item.visual==='view')body=`<div class="blGuideCells blGuideViews">${['Focus','Extended','All'].map(v=>`<b class="${normal(item.example).startsWith(normal(v))?'blGuideMarked':''}">${v}</b>`).join('')}</div><div class="blGuideCells"><b>Model</b><b>Status</b><b>FOB</b><b>Notes</b></div><div class="blGuideVisualNote">${active} · ${t('Sütun kümesi','Column set')}</div>`;
    else body=`<div class="blGuideCells"><b>Model</b><b>Status</b><b>FOB</b></div><div class="blGuideRows ${item.visual==='grid'?'blGuideMarked':''}"><span>01</span><span>Model A</span><span>8.20</span><span>02</span><span>Model B</span><span>8.05</span></div><div class="blGuideVisualNote">${title}</div>`;
    return `<figure class="blGuideVisual"><div class="blGuideVisualTop"><span>BUYER LOG</span><span>${esc(field(moduleFor(item.module),'label'))}</span></div><div class="blGuideVisualBody">${body}</div><figcaption>${t('Örnek görünüm • aşağıdaki yol gerçek arayüz adımlarını gösterir.','Illustrative view • the path below refers to the real interface.')}</figcaption></figure>`;
  }
  function content(item,full=false){return `${illustration(item)}<div class="blGuideCopy"><div class="blGuideEyebrow">${esc(field(moduleFor(item.module),'label'))}</div><h2>${esc(field(item,'title'))}</h2><p>${esc(field(item,'summary'))}</p><div class="blGuidePath">${esc(field(item,'path'))}</div><ol class="blGuideSteps">${item.steps[lang()].map((s,i)=>`<li><span>${i+1}</span><div>${esc(s)}</div></li>`).join('')}</ol>${full&&field(item,'note')?`<p class="blGuideNote">${esc(field(item,'note'))}</p>`:''}</div>`;}
  function refreshDeck(){const current=deck[tipIndex]?.id,eligible=available(),ids=new Set(eligible.map(c=>c.id)),existing=new Set(deck.map(c=>c.id));deck=deck.filter(c=>ids.has(c.id)).concat(shuffle(eligible.filter(c=>!existing.has(c.id))));tipIndex=Math.max(0,deck.findIndex(c=>c.id===current));}
  function renderTip(){
    if(!bootRoot?.isConnected||!deck.length)return;
    const host=bootRoot.querySelector('[data-boot-tip]');if(host)host.innerHTML=content(deck[tipIndex]);
    const count=bootRoot.querySelector('[data-tip-count]');if(count)count.textContent=`${tipIndex+1} / ${deck.length}`;
    bootRoot.querySelector('[data-tip-pause]')?.setAttribute('aria-pressed',String(paused));
    const pause=bootRoot.querySelector('[data-tip-pause]');if(pause)pause.textContent=paused?t('Devam et','Resume'):t('Duraklat','Pause');
  }
  function rotate(delta){if(!deck.length)return;tipIndex=(tipIndex+delta+deck.length)%deck.length;renderTip();}
  function schedule(){if(tipTimer)clearInterval(tipTimer);tipTimer=setInterval(()=>{if(!paused&&!dialog?.open&&!document.hidden&&!bootRoot?.querySelector('[data-boot-tip]')?.matches(':hover')&&!(bootRoot?.contains(document.activeElement)&&document.activeElement!==bootRoot))rotate(1);},12000);}
  function mountStartup(root){
    if(!root||root.querySelector('[data-boot-tip]'))return;
    bootRoot=root;root.classList.add('blBootWithGuide');refreshDeck();
    const card=root.querySelector('.blBootCard');if(!card)return;
    card.insertAdjacentHTML('afterbegin',`<div class="blBootBrand">BUYER LOG <span>${t('Çalışma alanınız hazırlanıyor','Preparing your workspace')}</span></div>`);
    card.insertAdjacentHTML('beforeend',`<p class="blBootHint" data-boot-hint>${t('Kullanıcı bilgileriniz ve başlangıç ekranı tamamlandığında otomatik açılacak.','Opens automatically when your user information and initial screen are ready.')}</p><div class="blBootStages" aria-label="${esc(t('Hazırlık adımları','Startup stages'))}"><span data-boot-stage="data">${t('Başlangıç verisi','Initial data')}</span><span data-boot-stage="ui">${t('Ekran','Screen')}</span><span data-boot-stage="profile">${t('Kullanıcı bilgileri','User information')}</span></div><div class="blBootTipHeading"><span>${t('BEKLERKEN KEŞFEDİN','DISCOVER WHILE YOU WAIT')}</span><span data-tip-count></span></div><div class="blBootTip" data-boot-tip></div><div class="blBootTipFooter"><div><button type="button" data-tip-prev aria-label="${esc(t('Önceki ipucu','Previous tip'))}">←</button><button type="button" data-tip-pause aria-pressed="false">${t('Duraklat','Pause')}</button><button type="button" data-tip-next aria-label="${esc(t('Sonraki ipucu','Next tip'))}">→</button></div><button type="button" data-tip-guide>${t('Kullanım Rehberi','User Guide')} ↗</button></div>`);
    root.querySelector('[data-tip-prev]').addEventListener('click',()=>rotate(-1));
    root.querySelector('[data-tip-next]').addEventListener('click',()=>rotate(1));
    root.querySelector('[data-tip-pause]').addEventListener('click',()=>{paused=!paused;renderTip();});
    root.querySelector('[data-tip-guide]').addEventListener('click',()=>open(deck[tipIndex]?.id));
    renderTip();schedule();
  }
  function refreshStartupText(){
    if(!bootRoot)return;
    const set=(selector,value)=>{const el=bootRoot.querySelector(selector);if(el)el.textContent=value;};
    set('.blBootBrand span',t('Çalışma alanınız hazırlanıyor','Preparing your workspace'));
    if(!bootRoot.dataset.failed)set('[data-boot-message]',t('Buyer Log hazırlanıyor…','Buyer Log is preparing…'));
    set('[data-boot-stage="data"]',t('Başlangıç verisi','Initial data'));
    set('[data-boot-stage="ui"]',t('Ekran','Screen'));
    set('[data-boot-stage="profile"]',t('Kullanıcı bilgileri','User information'));
    set('.blBootTipHeading > span',t('BEKLERKEN KEŞFEDİN','DISCOVER WHILE YOU WAIT'));
    set('[data-tip-guide]',t('Kullanım Rehberi','User Guide')+' ↗');
    set('[data-boot-retry]',t('Tekrar dene','Retry'));
    if(!bootRoot.dataset.slow)set('[data-boot-hint]',t('Kullanıcı bilgileriniz ve başlangıç ekranı tamamlandığında otomatik açılacak.','Opens automatically when your user information and initial screen are ready.'));
    renderTip();
  }
  function refreshLanguage(){
    refreshStartupText();
    if(dialog?.open){const id=currentId,filter=moduleId,search=query;close();open(id);moduleId=filter;query=search;dialog.querySelector('[data-guide-search]').value=query;changed();}
  }
  function stage(name){if(bootRoot)bootRoot.querySelector(`[data-boot-stage="${name}"]`)?.setAttribute('data-done','true');}
  function stopStartup(){if(tipTimer)clearInterval(tipTimer);tipTimer=null;bootRoot=null;}
  function select(id){currentId=id;renderArticle();renderList();}
  function renderArticle(){
    const item=cardList().find(c=>c.id===currentId);const host=dialog?.querySelector('[data-guide-article]');if(!host)return;
    host.innerHTML=item?content(item,true):`<p class="blGuideEmpty">${t('Sonuç bulunamadı. Modül veya arama metnini değiştirin.','No results. Change the module or search text.')}</p>`;
    const nav=dialog.querySelector('[data-guide-go]');if(nav){nav.disabled=!item||Boolean(document.getElementById('blBootGuard'));nav.textContent=t('Ekrana Git','Go to Screen');}
    const list=cardList(),index=list.findIndex(c=>c.id===currentId);dialog.querySelector('[data-guide-count]').textContent=list.length?`${index+1} / ${list.length}`:'0 / 0';
    for(const dir of ['prev','next'])dialog.querySelector(`[data-guide-${dir}]`).disabled=list.length<2;
  }
  function renderList(){
    const list=cardList(),host=dialog.querySelector('[data-guide-list]');host.innerHTML=list.map(c=>`<button type="button" data-guide-lesson="${esc(c.id)}" aria-pressed="${c.id===currentId}"><span>${esc(field(c,'title'))}</span><small>${esc(field(moduleFor(c.module),'label'))}</small></button>`).join('');
    dialog.querySelector('[data-guide-results]').textContent=t(`${list.length} konu`,`${list.length} topics`);
  }
  function changed(){const select=dialog.querySelector('[data-guide-module]');select.innerHTML=`<option value="all">${t('Tüm modüller','All modules')}</option>${data.modules.filter(m=>available().some(c=>c.module===m.id)).map(m=>`<option value="${esc(m.id)}">${esc(field(m,'label'))}</option>`).join('')}`;if(!Array.from(select.options).some(o=>o.value===moduleId))moduleId='all';select.value=moduleId;const list=cardList();if(!list.some(c=>c.id===currentId))currentId=list[0]?.id||'';renderList();renderArticle();}
  function close(){navGeneration++;dialog?.close();}
  function open(id){
    if(dialog?.open){if(id)select(id);return;}
    lastFocus=document.activeElement;moduleId='all';query='';currentId=available().find(c=>c.id===id)?.id||available()[0]?.id||'';
    if(dialog&&!dialog.open){dialog.remove();dialog=null;}
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='buyerLogGuide';dialog.className='blGuideDialog';dialog.setAttribute('aria-labelledby','blGuideTitle');
      dialog.innerHTML=`<header class="blGuideHeader"><div><span class="blGuideEyebrow">BUYER LOG</span><h1 id="blGuideTitle">${t('Kullanım Rehberi','User Guide')}</h1></div><button type="button" class="tbtn" data-guide-close aria-label="${esc(t('Kapat','Close'))}">×</button></header><div class="blGuideLayout"><aside class="blGuideSidebar"><label>${t('Konu ara','Search topics')}<input type="search" data-guide-search placeholder="${esc(t('Örn. hesaplanan sütun, kopyala…','e.g. calculated column, copy…'))}"></label><label>${t('Modül','Module')}<select data-guide-module><option value="all">${t('Tüm modüller','All modules')}</option>${data.modules.filter(m=>available().some(c=>c.module===m.id)).map(m=>`<option value="${esc(m.id)}">${esc(field(m,'label'))}</option>`).join('')}</select></label><small data-guide-results role="status" aria-live="polite"></small><nav data-guide-list aria-label="${esc(t('Rehber konuları','Guide topics'))}"></nav></aside><section class="blGuideArticle" data-guide-article aria-live="polite"></section></div><footer class="blGuideFooter"><div><button type="button" class="tbtn" data-guide-prev>← ${t('Önceki','Previous')}</button><span data-guide-count></span><button type="button" class="tbtn" data-guide-next>${t('Sonraki','Next')} →</button></div><span data-guide-nav-status role="status"></span><button type="button" class="tbtn primary" data-guide-go>${t('Ekrana Git','Go to Screen')}</button></footer>`;
      document.body.appendChild(dialog);
      dialog.querySelector('[data-guide-close]').addEventListener('click',close);
      const createdDialog=dialog,returnFocus=lastFocus;
      dialog.addEventListener('close',()=>{if(dialog===createdDialog)dialog=null;createdDialog.remove();if(!dialog?.open){if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else document.getElementById('buyerLogGuideBtn')?.focus({preventScroll:true});}});
      dialog.querySelector('[data-guide-search]').addEventListener('input',ev=>{query=ev.target.value;changed();});
      dialog.querySelector('[data-guide-module]').addEventListener('change',ev=>{moduleId=ev.target.value;changed();});
      dialog.querySelector('[data-guide-list]').addEventListener('click',ev=>{const btn=ev.target.closest('[data-guide-lesson]');if(btn)select(btn.dataset.guideLesson);});
      for(const [dir,delta] of [['prev',-1],['next',1]])dialog.querySelector(`[data-guide-${dir}]`).addEventListener('click',()=>{const list=cardList(),index=list.findIndex(c=>c.id===currentId);if(list.length)select(list[(index+delta+list.length)%list.length].id);});
      dialog.querySelector('[data-guide-go]').addEventListener('click',()=>void navigate());
    }
    dialog.querySelector('[data-guide-search]').value='';dialog.querySelector('[data-guide-module]').value='all';dialog.querySelector('[data-guide-nav-status]').textContent='';changed();dialog.showModal();dialog.querySelector('[data-guide-search]').focus();
  }
  async function navigate(){
    const item=available().find(c=>c.id===currentId);if(!item||document.getElementById('blBootGuard'))return;
    const targetArea=(item.area&&areaAllowed(item.area)?item.area:null)||item.areas.find(areaAllowed)||null;
    const target=targetArea||document.body.dataset.activeTab||'overview';
    const status=dialog.querySelector('[data-guide-nav-status]');
    if(!areaAllowed(target)){status.textContent=t('Bu ekran için erişim yetkiniz yok.','You do not have access to this screen.');return;}
    const generation=++navGeneration;
    const sw=global.switchTab;if(typeof sw!=='function'){status.textContent=t('Ekran henüz hazır değil.','The screen is not ready.');return;}
    try{
      const result=await sw(target);if(result===false){status.textContent=t('Ekran açılamadı; erişim kapsamınızı kontrol edin.','Could not open the screen; check access.');return;}
      if(generation!==navGeneration||!dialog.open)return;
      const allowedNow=available().some(c=>c.id===item.id)&&areaAllowed(target);if(!allowedNow)return;
      // Highlight only existing, visible controls; never activate them.
      close();let node=null;try{let selector=item.selector;if(target!=='cp'&&item.module==='views'){const prefix=target==='orders'?'orders':target==='koleksiyon'?'kol':target==='shipping'?'ship':'cp';if(target==='shipping'&&selector==='#cpMoreBtn')selector='#shipColsBtn';selector=selector.replace(/data-table-key="cp"/g,`data-table-key="${target==='shipping'?'ship':target}"`).replace(/data-partial-view-toggle="cp"/g,`data-partial-view-toggle="${target}"`).replace(/#cp/g,'#'+prefix);}node=document.querySelector(selector);}catch(_){}
      if(node&&node.getClientRects().length){node.scrollIntoView({block:'center',behavior:global.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});node.classList.add('blGuideTarget');node.focus?.({preventScroll:true});setTimeout(()=>node.classList.remove('blGuideTarget'),4500);}
      else global.showToast?.(t(`İşlem yolu: ${field(item,'path')}`,`Path: ${field(item,'path')}`));
    }catch(_){status.textContent=t('Ekran açılamadı. Tekrar deneyin.','Could not open the screen. Try again.');}
  }
  document.addEventListener('click',ev=>{if(ev.target.closest?.('#buyerLogGuideBtn,[data-user-guide]')){ev.preventDefault();open();}});
  // Capture before legacy app shortcuts: native input/Tab/Escape defaults
  // remain available, but modal keys cannot mutate or close underlying UI.
  document.addEventListener('keydown',ev=>{if(dialog?.open){ev.stopImmediatePropagation();if(ev.key==='F1')ev.preventDefault();}},true);
  document.addEventListener('keydown',ev=>{if(ev.key==='F1'){ev.preventDefault();open();}});
  global.addEventListener('bl:user-access-applied',()=>{if(bootRoot){refreshDeck();refreshStartupText();}if(dialog?.open)changed();});
  global.addEventListener('bl:startup-complete',()=>{stopStartup();if(dialog?.open)renderArticle();});
  global.BLGuide={open,mountStartup,stage,stopStartup,available,illustration,refreshLanguage};
})(window);
