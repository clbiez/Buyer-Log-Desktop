// ?safe=1 ile bu katman tamamen devre dışı kalır (sorun ayıklama için).
if(!/[?&]safe=1/.test(location.search)){
try{
/* KPI grupları: grup başlığı her zaman görünür; alt çipler fareyle üzerine
   gelince (veya başlığa tıklayınca) yana doğru açılır. Seçili (active) çipler
   grup kapalıyken de görünür kalır. Hiç seçim yoksa yalnız başlık görünür.
   Excel/veri katmanına dokunmaz — yalnız DOM'da görsel gruplama yapar. */
(function(){
  let kpiGroupSeq=0;
  function setKpiGroupOpen(group,open){
    const isOpen=!!open;
    group.classList.toggle('open',isOpen);
    group.querySelector(':scope > .kpiGroupLabel')?.setAttribute('aria-expanded',String(isOpen));
  }
  function closeKpiGroups(except=null){
    document.querySelectorAll('.kpiGroup.open').forEach(group=>{ if(group!==except) setKpiGroupOpen(group,false); });
  }
  function apply(row){
    if(row.__kpiGrouping) return;
    row.__kpiGrouping = true;
    try{
      row.querySelectorAll(':scope > .kpiGroupLabel').forEach(label=>{
        const grp=document.createElement('div');
        grp.className='kpiGroup';
        const trigger=document.createElement('button');
        const menuId=`kpiGroupMenu-${++kpiGroupSeq}`;
        trigger.type='button'; trigger.className='kpiGroupLabel'; trigger.id=`kpiGroupTrigger-${kpiGroupSeq}`;
        trigger.textContent=label.textContent; trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls',menuId);
        row.insertBefore(grp,label);
        label.replaceWith(trigger); grp.appendChild(trigger);
        // Çipleri önce topla, sonra dağıt: dolaşırken taşımak kardeş zincirini bozar.
        const chips=[];
        let n=grp.nextSibling;
        while(n){
          const next=n.nextSibling;
          if(n.nodeType===3){ if(n.textContent.trim())break; n.remove(); }
          else if(n.nodeType===1 && n.classList.contains('kpi')){ chips.push(n); }
          else break;
          n=next;
        }
        // Seçili (active) çipler başlığın SAĞINDA her zaman görünür kalır; geri
        // kalanlar başlığın ALTINA açılan panele girer. Böylece grup açıldığında
        // yanındaki diğer filtre gruplarını sağa doğru itmez.
        const menu=document.createElement('div');
        menu.className='kpiGroupMenu'; menu.id=menuId; menu.setAttribute('role','group'); menu.setAttribute('aria-labelledby',trigger.id);
        chips.forEach(chip=>{ (chip.classList.contains('active')?grp:menu).appendChild(chip); });
        grp.appendChild(menu);
      });
    } finally { row.__kpiGrouping=false; }
  }
  let kpiQueued=false;
  const obs=new MutationObserver(list=>{
    const rows=new Set();
    list.forEach(m=>{
      const t=m.target;
      if(t && t.classList && t.classList.contains('kpirow') && !t.__kpiGrouping) rows.add(t);
    });
    if(!rows.size||kpiQueued) return;
    kpiQueued=true;
    requestAnimationFrame(()=>{ kpiQueued=false; document.querySelectorAll('.kpirow').forEach(r=>{ if(!r.__kpiGrouping) apply(r); }); });
  });
  function init(){
    document.querySelectorAll('.kpirow').forEach(r=>{ apply(r); obs.observe(r,{childList:true}); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  // Tıklama ve klavye ile aç-kapa; kapalı paneldeki filtreler sekme sırasına girmez.
  document.addEventListener('click',e=>{
    const trigger=e.target.closest('.kpiGroup > .kpiGroupLabel');
    if(!trigger) return;
    const grp=trigger.parentElement;
    const open=!grp.classList.contains('open');
    closeKpiGroups(grp); setKpiGroupOpen(grp,open);
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeKpiGroups(); });
})();

/* --- Araç çubuğu grupları: "Filtreler" ve "Seçilenler" ---
   Uygulama sekme geçişinde bazı düğmeleri DOM'da taşır (restoreSharedTableActions,
   placeCpDimensionFilters). Bu bölüm gruplarını her vfBar değişiminde yeniden
   kurar: yalnız üye düğmeleri gruba alır, gruba yanlışlıkla giren yabancı
   düğümleri dışarı çıkarır. */
(function(){
  function mkLabel(tr,en){
    const s=document.createElement('button');
    s.type='button';
    s.className='vfGroupLabel tbGroupHead';
    s.setAttribute('aria-expanded','false');
    s.setAttribute('data-i18n-tr',tr); s.setAttribute('data-i18n-en',en);
    s.textContent=(typeof appLang!=='undefined'&&appLang==='en')?en:tr;
    return s;
  }
  let syncing=false;
  function syncAll(){
    if(syncing) return; syncing=true;
    try{
      // Eski "Seçilenler" satır içi grupları (vfSelGroup / kolSelGroup) kaldırıldı:
      // bu düğmeler artık her sayfanın araç çubuğundaki "Araçlar" açılır menüsünde.
      // Temel filtre grupları: yalnız etiket + aktiflik sınıfı; taşımayı app-main.js
      // (placeCpDimensionFilters) yapar — sayfa başlığının yanına yerleşirler.
      ['cpDimFilterGroup','ordersDimFilterGroup'].forEach(id=>{
        const g=document.getElementById(id); if(!g) return;
        g.classList.add('fltGroup');
        // v7.26 — ad değişikliği: "Temel Filtreler" → "Sayfa Filtreleri".
        // Eskiden kurulmuş etiketler de güncellenir; aksi halde açık bir
        // oturumda iki farklı ad yan yana görünürdü.
        let head=g.querySelector(':scope > .tbGroupHead');
        if(!head){ head=mkLabel('Sayfa Filtreleri','Page Filters'); g.insertBefore(head,g.firstChild); }
        else if(head.tagName!=='BUTTON'){
          const trigger=mkLabel(head.getAttribute('data-i18n-tr')||'Sayfa Filtreleri',head.getAttribute('data-i18n-en')||'Page Filters');
          head.replaceWith(trigger); head=trigger;
        }
        else if(head.getAttribute('data-i18n-tr')!=='Sayfa Filtreleri'){
          head.setAttribute('data-i18n-tr','Sayfa Filtreleri'); head.setAttribute('data-i18n-en','Page Filters');
          head.textContent=(typeof appLang!=='undefined'&&appLang==='en')?'Page Filters':'Sayfa Filtreleri';
        }
        // Hızlı filtrelerdeki (.kpiGroup) aynı mantık:
        // - SEÇİLİ filtreler grubun doğrudan çocuğudur → etiketin sağında hep görünür.
        // - Seçilmemiş olanlar .fltGroupMenu içindedir → başlığın ALTINA açılır.
        // Panel mutlak konumlandığı için açıldığında arama kutusunu itelemez.
        let menu=g.querySelector(':scope > .fltGroupMenu');
        if(!menu){ menu=document.createElement('div'); menu.className='fltGroupMenu'; g.appendChild(menu); }
        menu.id=`${id}Menu`; menu.setAttribute('role','group');
        head.id=`${id}Trigger`; head.setAttribute('aria-controls',menu.id); menu.setAttribute('aria-labelledby',head.id);
        g.querySelectorAll('.colPanelWrap').forEach(w=>{
          const t=w.querySelector('.dimBtnText');
          const txt=t?t.textContent.trim():'';
          const active = txt.includes(':') && !/:\s*(hepsi|all)\s*▾?$/i.test(txt);
          w.classList.toggle('flt-active', active);
          // Yalnız gerçekten yer değiştirmesi gerekiyorsa taşı: aksi halde her
          // MutationObserver turunda DOM değişir ve sonsuz döngü oluşur.
          const target = active ? g : menu;
          if(w.parentElement!==target){
            if(target===g) g.insertBefore(w, menu); else menu.appendChild(w);
          }
        });
        if(g.lastElementChild!==menu) g.appendChild(menu);
      });
    } finally { syncing=false; }
  }
  let queued=false;
  function queueSync(){
    if(syncing||queued) return;
    queued=true;
    requestAnimationFrame(()=>{ queued=false; syncAll(); });
  }
  function init(){
    syncAll();
    const vfBar=document.querySelector('.vfBar');
    if(vfBar) new MutationObserver(queueSync).observe(vfBar,{subtree:true,childList:true,characterData:true});
    // Temel filtre grupları vfBar'dan çıkıp sayfa başlığının yanına taşındığı için
    // düğme etiketi değişimleri (ör. "Buyer: 2 seçili") yukarıdaki gözlemciye
    // düşmüyor; slot da ayrıca izlenmeli, yoksa aktif/pasif ayrımı tazelenmez.
    const titleSlot=document.getElementById('pageTitleFilters');
    if(titleSlot) new MutationObserver(queueSync).observe(titleSlot,{subtree:true,childList:true,characterData:true});
    new MutationObserver(queueSync).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
    // Koleksiyon: görünüm seçici sayfa başlığının yanına (bir kez).
    // Ayrı secondary toolbar kaldırıldı; seçici artık bölümün doğrudan çocuğu.
    const wp=document.querySelector('#view-koleksiyon .kolWorkspacePicker');
    const h1=document.getElementById('pageTitle');
    if(wp&&h1) h1.insertAdjacentElement('afterend',wp);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
  /* ================================================================
     v7.26 — SAYFA FİLTRELERİ PANELİ ARTIK TABLONUN ARKASINDA AÇILMIYOR

     Saha bulgusu (kullanıcı): "bu filtreleme alanı tablonun arkasında
     açıldığı için filtreleme yapamıyorum, şu an Orders ve CP ekranlarında
     basic filters kullanamıyorum."

     Ölçüm: panel açılıyordu (display:flex, 137×172 px) ama panelin tam
     ortasındaki noktada elementFromPoint MAIN döndürüyordu — yani panel en
     üstteki öğe değildi. İki sebep vardı:
       1) .pageTitleFilters'ta overflow:hidden var (başlık şeridi taşmasın
          diye). Mutlak konumlu panel bu kutunun İÇİNDE olduğu için kırpılıyor.
       2) Şeridin yığınlama bağlamı, panelin sayfa içeriğinin altında
          kalmasına yol açıyordu.

     Çözüm, uygulamanın başka yerlerinde zaten kullanılan desen: panel açılınca
     GÖRÜNTÜ PENCERESİNE sabitlenir (position:fixed) ve etiketin altına
     konumlandırılır. Böylece hiçbir kırpma kutusuna bağlı kalmaz.
     ================================================================ */
  const FLT_MENU_Z='260';
  function positionFltMenu(group){
    const menu=group.querySelector(':scope > .fltGroupMenu'), head=group.querySelector(':scope > .tbGroupHead');
    if(!menu||!head) return;
    menu.style.position='fixed'; menu.style.zIndex=FLT_MENU_Z; menu.style.visibility='hidden'; menu.style.display='flex';
    const rect=head.getBoundingClientRect();
    const width=Math.min(Math.max(menu.offsetWidth||220,220),Math.max(220,window.innerWidth-16));
    const height=Math.min(menu.offsetHeight||320,Math.max(160,window.innerHeight-16));
    let left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8));
    let top=rect.bottom+6;
    if(top+height>window.innerHeight-8) top=Math.max(8,rect.top-height-6);
    menu.style.left=left+'px'; menu.style.top=top+'px'; menu.style.right='auto'; menu.style.bottom='auto';
    menu.style.width=width+'px'; menu.style.visibility='';
  }
  function closeFltMenus(except=null){
    document.querySelectorAll('.tbGroup.open,.fltGroup.open').forEach(g=>{
      if(g===except) return;
      g.classList.remove('open');
      const menu=g.querySelector(':scope > .fltGroupMenu');
      g.querySelector(':scope > .tbGroupHead')?.setAttribute('aria-expanded','false');
      if(menu) menu.style.cssText='';
    });
  }
  document.addEventListener('click',e=>{
    const lbl=e.target.closest('.tbGroup > .tbGroupHead, .fltGroup > .tbGroupHead');
    if(!lbl){
      /* Panelin İÇİNE tıklamak paneli kapatmaz; dışına tıklamak kapatır.
         Boyut filtresi panelleri (.cpDimPanel/.ordersDimPanel) görüntü
         penceresine sabitlendiği için menünün DOM alt ağacında değildir;
         onların içine tıklamak da "dışarı" sayılmamalıdır — aksi halde bir
         değer seçmek üstteki filtre menüsünü kapatırdı. */
      if(!e.target.closest('.fltGroupMenu,.cpDimPanel,.ordersDimPanel,.colPanel,.colFilterPanel')) closeFltMenus();
      return;
    }
    const grp=lbl.parentElement;
    const willOpen=!grp.classList.contains('open');
    closeFltMenus(grp);
    grp.classList.toggle('open',willOpen);
    lbl.setAttribute('aria-expanded',String(willOpen));
    const menu=grp.querySelector(':scope > .fltGroupMenu');
    if(!menu) return;
    if(willOpen) positionFltMenu(grp); else menu.style.cssText='';
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeFltMenus(); });
  // Sayfa kaydırılır veya boyut değişirse sabit panel etiketten kopmasın.
  window.addEventListener('resize',()=>document.querySelectorAll('.fltGroup.open').forEach(positionFltMenu));
  window.addEventListener('scroll',()=>document.querySelectorAll('.fltGroup.open').forEach(positionFltMenu),true);
})();

}catch(e){ console.error('kpi-groups devre dışı:',e); }
}
