/* Buyer Log — paylaşılan duyarlı araç çubuğu yerleşimi (v11.11)
   ----------------------------------------------------------------------------
   KÖK NEDEN: .tableActionToolbar nowrap bir flex satırıydı. Eylem düğmeleri
   varsayılan flex-shrink ile içeriklerinin altına sıkışıyor, white-space:nowrap
   metin kutunun dışına taşıp komşu düğmenin üstüne biniyordu. Sağdaki PLM Sync /
   Araçlar / ⋯ grupları bu yüzden "arkada kalmış" görünüyordu. Ekran genişliğine
   bağlı @media eşikleri ise kenar çubuğu genişliği, Electron pencere boyutu ve
   arayüz ölçeği devredeyken gerçek kullanılabilir genişliği temsil etmiyordu.

   ÇÖZÜM: modül eylemlerini BİLDİRİR (data-tb-*), ortak katman SUNUMU seçer.
   Kademeler, her zaman bu sırayla:
     1) tam yerleşim
     2) kompakt (boşluklar daralır, işaretli eylemler ikon ölçeğine iner)
     3) düşük öncelikli eylemler ⋯ taşma menüsüne TAŞINIR (klonlanmaz)
     4) hâlâ sığmıyorsa araç çubuğu temiz biçimde ikinci satıra sarar
   Hiçbir kademe üst üste binme, kırpma ya da sayfa düzeyinde yatay kaydırma
   üretmez. Eylemler gerçek DOM düğümü olarak taşındığı için olay dinleyicileri,
   disabled/permission durumu, tooltip ve i18n sözleşmesi olduğu gibi korunur.

   Saf planlayıcı (planToolbarLayout/layoutWidth) DOM'suz test edilebilir;
   tests/responsive-toolbar-primitive-v1111.test.js bu yüzeyi doğrular.
*/
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLToolbarResponsive=Object.assign(root.BLToolbarResponsive||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* Taşma sırası: sayısı BÜYÜK olan önce taşar. primary hiç taşmaz. */
  const PRIORITY_RANK=Object.freeze({primary:0,selection:1,secondary:2,utility:3});
  const PINNED='pinned';
  const ROOT='__root__';
  const DEFAULT_PRIORITY='secondary';

  function numeric(value,fallback){
    const n=Number(value);
    return Number.isFinite(n)?n:(fallback||0);
  }

  function rankOf(priority){
    const rank=PRIORITY_RANK[priority];
    return rank==null?PRIORITY_RANK[DEFAULT_PRIORITY]:rank;
  }

  /* Bir eylemin o kademede kapladığı genişlik. Esneyebilen denetimler (arama
     kutusu) taban genişliğiyle değil, gerçekten inebilecekleri ALT SINIRLA
     hesaplanır; yoksa arama kutusu tek başına bütün eylemleri dışarı iter. */
  function entryWidth(entry,compact){
    if(!entry)return 0;
    if(compact){
      if(entry.compactMinWidth!=null)return numeric(entry.compactMinWidth);
      if(entry.minWidth!=null)return numeric(entry.minWidth);
      if(entry.compactWidth!=null)return numeric(entry.compactWidth);
      return numeric(entry.width);
    }
    if(entry.minWidth!=null)return numeric(entry.minWidth);
    return numeric(entry.width);
  }

  function gapFor(gaps,key){
    if(!gaps)return 0;
    if(Object.prototype.hasOwnProperty.call(gaps,key))return numeric(gaps[key]);
    return numeric(gaps[ROOT]);
  }

  /* Araç çubuğu iki katmanlıdır: kök satır ve içindeki eylem grupları. Bir grup
     kök satırda TEK bir yuva kaplar; kendi iç boşlukları ayrı sayılır. */
  function layoutWidth(entries,options){
    const opts=options||{};
    const hidden=opts.hidden instanceof Set?opts.hidden:new Set(opts.hidden||[]);
    const gaps=opts.gaps||{};
    const compact=!!opts.compact;
    const buckets=new Map();
    for(const entry of entries||[]){
      if(!entry||hidden.has(entry.id))continue;
      const key=entry.container||ROOT;
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(entry);
    }
    let total=0,rootSlots=0;
    for(const [key,list] of buckets){
      const sum=list.reduce((acc,entry)=>acc+entryWidth(entry,compact),0);
      if(key===ROOT){total+=sum;rootSlots+=list.length;}
      else{total+=sum+Math.max(0,list.length-1)*gapFor(gaps,key);rootSlots+=1;}
    }
    total+=Math.max(0,rootSlots-1)*gapFor(gaps,ROOT);
    return total;
  }

  /* Taşma adayları: önce en düşük öncelik, eşitlikte en SAĞDAKİ. Sıra
     deterministiktir; aynı genişlik aynı planı üretir (idempotent yeniden
     yerleşim şartı). */
  function overflowCandidates(entries){
    return (entries||[])
      .map((entry,index)=>({entry,index}))
      .filter(item=>item.entry&&item.entry.overflowable&&item.entry.priority!=='primary'&&item.entry.priority!==PINNED)
      .sort((a,b)=>{
        const rankA=rankOf(a.entry.priority),rankB=rankOf(b.entry.priority);
        if(rankA!==rankB)return rankB-rankA;
        return b.index-a.index;
      })
      .map(item=>item.entry);
  }

  /* ⋯ düğmesinin kendisi ASLA taşmaz ve genişliği daha ilk ölçümde bütçelenir:
     ya görünür bir yuva olarak entries içindedir (alwaysVisible), ya da taşma
     başlar başlamaz genişliği + boşluğu hesaba eklenir. */
  function planToolbarLayout(input){
    const spec=input||{};
    const entries=Array.isArray(spec.entries)?spec.entries.filter(Boolean):[];
    const available=numeric(spec.available);
    const gaps=spec.gaps||{};
    const trigger=spec.overflowTrigger||null;
    const canOverflow=!!trigger;
    const triggerAlwaysVisible=canOverflow?trigger.alwaysVisible!==false:false;
    const triggerWidth=canOverflow?numeric(trigger.width):0;
    const reserve=count=>(!canOverflow||triggerAlwaysVisible||count===0)?0:triggerWidth+gapFor(gaps,ROOT);
    const fits=(compact,hidden)=>layoutWidth(entries,{compact,hidden,gaps})+reserve(hidden.size)<=available;
    const nothing=new Set();
    const ordered=ids=>entries.filter(entry=>ids.has(entry.id)).map(entry=>entry.id);

    if(fits(false,nothing))return {compact:false,overflow:[],wrap:false};
    if(fits(true,nothing))return {compact:true,overflow:[],wrap:false};
    const hidden=new Set();
    if(canOverflow){
      for(const entry of overflowCandidates(entries)){
        hidden.add(entry.id);
        if(fits(true,hidden))return {compact:true,overflow:ordered(hidden),wrap:false};
      }
    }
    return {compact:true,overflow:ordered(hidden),wrap:true};
  }

  function samePlan(a,b){
    if(!a||!b)return false;
    if(a.compact!==b.compact||a.wrap!==b.wrap)return false;
    if(a.overflow.length!==b.overflow.length)return false;
    return a.overflow.every((id,index)=>id===b.overflow[index]);
  }

  /* ========================= DOM katmanı ========================= */

  const HAS_DOM=typeof document!=='undefined'&&typeof window!=='undefined';
  const TOOLBAR_SELECTOR='[data-responsive-toolbar]';
  const GROUP_SELECTOR='[data-toolbar-group],.tableToolbarActions';
  /* Eski v10.42/v10.43 @media eşikleri hâlâ yürürlükte; bunları geçerken doğal
     genişlikler değişir, o yüzden yalnız eşik kovası değişince yeniden ölçeriz. */
  const VIEWPORT_BUCKETS=[900,1000,1150,1350];
  const controllers=new Map();
  let uidSeed=0;

  function readGap(element){
    if(!element||typeof getComputedStyle!=='function')return 0;
    const style=getComputedStyle(element);
    return numeric(parseFloat(style.columnGap||style.gap||'0'));
  }

  function ensureId(node){
    if(node.id)return node.id;
    if(!node.dataset.tbUid)node.dataset.tbUid='tb'+(++uidSeed);
    return node.dataset.tbUid;
  }

  function isRendered(node){
    if(!node||node.nodeType!==1)return false;
    if(node.hasAttribute('hidden'))return false;
    return node.getClientRects().length>0;
  }

  function resolveMeta(node){
    const data=node.dataset||{};
    let priority=data.tbPriority||'';
    if(!priority){
      if(node.matches('[data-action-role="primary"]'))priority='primary';
      else if(node.matches('.toolbarMoreWrap')||node.matches('input[type="search"]'))priority=PINNED;
      else priority=DEFAULT_PRIORITY;
    }
    if(priority!=='primary'&&priority!==PINNED&&PRIORITY_RANK[priority]==null)priority=DEFAULT_PRIORITY;
    const locked=priority==='primary'||priority===PINNED;
    return {
      priority,
      overflowable:!locked&&data.tbOverflow!=='never',
      flexible:node.matches('input[type="search"]'),
    };
  }

  function collect(ctrl){
    const items=[];
    let order=0;
    for(const child of Array.from(ctrl.toolbar.children)){
      if(child.matches(GROUP_SELECTOR)){
        if(!isRendered(child))continue;
        for(const leaf of Array.from(child.children)){
          if(!isRendered(leaf))continue;
          items.push({node:leaf,containerEl:child,container:child.id||ensureId(child),order:order++});
        }
        continue;
      }
      if(!isRendered(child))continue;
      items.push({node:child,containerEl:ctrl.toolbar,container:ROOT,order:order++});
    }
    return items;
  }

  function overflowSlot(ctrl){
    if(!ctrl.menu)return null;
    let slot=ctrl.menu.querySelector(':scope > [data-toolbar-overflow-slot]');
    if(!slot){
      slot=document.createElement('div');
      slot.className='toolbarOverflowSlot';
      slot.setAttribute('data-toolbar-overflow-slot','');
      slot.hidden=true;
      ctrl.menu.insertBefore(slot,ctrl.menu.firstChild);
    }
    return slot;
  }

  function focusedWithin(node){
    const active=document.activeElement;
    if(!active)return null;
    return (active===node||node.contains(active))?active:null;
  }

  function pushToOverflow(ctrl,entry){
    const slot=overflowSlot(ctrl);
    const node=entry&&entry.node;
    if(!slot||!node||!node.isConnected)return;
    const parent=node.parentElement;
    if(!parent||parent===slot)return;
    const anchor=document.createComment('bl-toolbar:'+entry.id);
    parent.insertBefore(anchor,node);
    const keepFocus=focusedWithin(node);
    node.dataset.tbOrder=String(entry.order);
    let before=null;
    for(const child of Array.from(slot.children)){
      if(numeric(child.dataset.tbOrder)>entry.order){before=child;break;}
    }
    slot.insertBefore(node,before);
    node.classList.add('toolbarOverflowItem');
    node.setAttribute('data-tb-overflowed','1');
    ctrl.overflowed.set(entry.id,{node,anchor,parent});
    if(keepFocus&&typeof keepFocus.focus==='function')keepFocus.focus({preventScroll:true});
  }

  function restoreOne(ctrl,id){
    const record=ctrl.overflowed.get(id);
    if(!record)return;
    ctrl.overflowed.delete(id);
    const {node,anchor,parent}=record;
    const slot=overflowSlot(ctrl);
    /* Sekme geçişinde paylaşılan düğümleri syncTableToolbarActions başka bir eve
       taşımış olabilir. O düğüm artık bizim değildir; ankrajı sessizce bırakırız
       ki eylem iki yerde birden belirmesin. */
    if(!node||node.parentElement!==slot){
      if(anchor&&anchor.parentNode)anchor.parentNode.removeChild(anchor);
      return;
    }
    const keepFocus=focusedWithin(node);
    node.classList.remove('toolbarOverflowItem');
    node.removeAttribute('data-tb-overflowed');
    delete node.dataset.tbOrder;
    if(anchor&&anchor.parentNode)anchor.parentNode.replaceChild(node,anchor);
    else if(parent&&parent.isConnected)parent.appendChild(node);
    else slot.removeChild(node);
    if(keepFocus&&typeof keepFocus.focus==='function')keepFocus.focus({preventScroll:true});
  }

  function syncSlot(ctrl){
    const slot=ctrl.menu?ctrl.menu.querySelector(':scope > [data-toolbar-overflow-slot]'):null;
    if(slot)slot.hidden=slot.children.length===0;
  }

  function restoreAll(ctrl){
    for(const id of Array.from(ctrl.overflowed.keys()))restoreOne(ctrl,id);
    syncSlot(ctrl);
  }

  function innerWidthOf(toolbar){
    if(typeof getComputedStyle!=='function')return toolbar.clientWidth;
    const style=getComputedStyle(toolbar);
    return toolbar.clientWidth-numeric(parseFloat(style.paddingLeft))-numeric(parseFloat(style.paddingRight));
  }

  function viewportBucket(){
    const width=window.innerWidth||0;
    let bucket=0;
    for(const edge of VIEWPORT_BUCKETS)if(width<=edge){bucket=edge;break;}
    return bucket;
  }

  function cacheKey(){
    const el=document.documentElement;
    return [el.dataset.uiScale||'',el.dataset.fontStep||'',el.lang||'',viewportBucket()].join('|');
  }

  /* İki zorunlu yeniden yerleşim (tam + kompakt) YALNIZ önbellek anahtarı
     değiştiğinde yapılır; sürükleyerek yeniden boyutlandırmada saf aritmetik
     çalışır ve plan değişmiyorsa tek bir DOM yazımı bile olmaz. */
  function measure(ctrl){
    const toolbar=ctrl.toolbar;
    restoreAll(ctrl);
    toolbar.removeAttribute('data-toolbar-compact');
    toolbar.removeAttribute('data-toolbar-wrap');
    const items=collect(ctrl);
    const gaps={};
    gaps[ROOT]=readGap(toolbar);
    const entries=items.map(item=>{
      if(gaps[item.container]==null)gaps[item.container]=readGap(item.containerEl);
      const meta=resolveMeta(item.node);
      return {
        id:ensureId(item.node),
        node:item.node,
        container:item.container,
        order:item.order,
        priority:meta.priority,
        overflowable:meta.overflowable,
        flexible:meta.flexible,
        width:Math.ceil(item.node.getBoundingClientRect().width),
        minWidth:meta.flexible?Math.ceil(numeric(parseFloat(getComputedStyle(item.node).minWidth))):null,
        compactWidth:null,
        compactMinWidth:null,
      };
    });
    toolbar.setAttribute('data-toolbar-compact','1');
    for(const entry of entries){
      entry.compactWidth=Math.ceil(entry.node.getBoundingClientRect().width);
      if(entry.flexible)entry.compactMinWidth=Math.ceil(numeric(parseFloat(getComputedStyle(entry.node).minWidth)));
    }
    toolbar.removeAttribute('data-toolbar-compact');
    ctrl.gaps=gaps;
    ctrl.applied=null;
    const triggerEl=ctrl.trigger;
    ctrl.overflowTrigger=ctrl.menu?{
      width:triggerEl?Math.ceil(triggerEl.getBoundingClientRect().width):0,
      alwaysVisible:!!(triggerEl&&entries.some(entry=>entry.node===triggerEl)),
    }:null;
    return entries;
  }

  function applyPlan(ctrl,plan){
    if(samePlan(ctrl.applied,plan))return;
    const wanted=new Set(plan.overflow);
    for(const id of Array.from(ctrl.overflowed.keys()))if(!wanted.has(id))restoreOne(ctrl,id);
    const byId=new Map((ctrl.entries||[]).map(entry=>[entry.id,entry]));
    for(const id of plan.overflow){
      if(ctrl.overflowed.has(id))continue;
      const entry=byId.get(id);
      if(entry)pushToOverflow(ctrl,entry);
    }
    ctrl.toolbar.toggleAttribute('data-toolbar-compact',plan.compact);
    ctrl.toolbar.toggleAttribute('data-toolbar-wrap',plan.wrap);
    syncSlot(ctrl);
    ctrl.applied={compact:plan.compact,wrap:plan.wrap,overflow:plan.overflow.slice()};
  }

  function layout(ctrl,options){
    const toolbar=ctrl.toolbar;
    if(!toolbar.isConnected){
      if(ctrl.observer)ctrl.observer.disconnect();
      controllers.delete(toolbar);
      return;
    }
    const available=Math.floor(innerWidthOf(toolbar));
    /* Görünmeyen sekmenin araç çubuğu ölçülmez (perf-runtime tembel davranışı);
       sekmeye geçildiğinde refresh() yeniden çağrılır. */
    if(!(available>0)){ctrl.dirty=true;return;}
    const key=cacheKey();
    if((options&&options.remeasure)||key!==ctrl.key||!ctrl.entries){
      ctrl.entries=measure(ctrl);
      ctrl.key=key;
    }
    applyPlan(ctrl,planToolbarLayout({
      available,
      entries:ctrl.entries,
      gaps:ctrl.gaps,
      overflowTrigger:ctrl.overflowTrigger,
    }));
    ctrl.dirty=false;
  }

  function schedule(ctrl,options){
    if(options&&options.remeasure)ctrl.pendingRemeasure=true;
    if(ctrl.frame)return;
    const run=()=>{
      ctrl.frame=0;
      const remeasure=ctrl.pendingRemeasure;
      ctrl.pendingRemeasure=false;
      try{layout(ctrl,{remeasure});}
      catch(err){if(typeof console!=='undefined')console.warn('[toolbar-responsive]',err);}
    };
    ctrl.frame=typeof requestAnimationFrame==='function'?requestAnimationFrame(run):setTimeout(run,16);
  }

  function register(toolbar){
    if(!HAS_DOM||!toolbar)return null;
    const existing=controllers.get(toolbar);
    if(existing)return existing;
    const ctrl={
      toolbar,
      menu:toolbar.dataset.overflowMenu?document.getElementById(toolbar.dataset.overflowMenu):null,
      trigger:toolbar.dataset.overflowTrigger?document.getElementById(toolbar.dataset.overflowTrigger):null,
      entries:null,gaps:{},overflowTrigger:null,applied:null,
      overflowed:new Map(),key:'',lastWidth:-1,dirty:true,frame:0,pendingRemeasure:false,
    };
    controllers.set(toolbar,ctrl);
    if(typeof ResizeObserver==='function'){
      /* Tek gözlemci, tek araç çubuğu. Yalnız GENİŞLİK değişimi yeniden yerleşim
         tetikler; sarma yüksekliği değiştirdiğinde geri besleme döngüsü olmaz. */
      ctrl.observer=new ResizeObserver(records=>{
        const record=records[records.length-1];
        const width=record&&record.contentRect?Math.floor(record.contentRect.width):-1;
        if(width===ctrl.lastWidth&&!ctrl.dirty)return;
        ctrl.lastWidth=width;
        schedule(ctrl);
      });
      ctrl.observer.observe(toolbar);
    }
    schedule(ctrl,{remeasure:true});
    return ctrl;
  }

  function scan(scope){
    if(!HAS_DOM)return;
    const host=scope||document;
    host.querySelectorAll(TOOLBAR_SELECTOR).forEach(register);
  }

  function refresh(target,options){
    if(!HAS_DOM)return;
    scan(document);
    const opts=options||{remeasure:true};
    if(target){
      const node=typeof target==='string'?document.getElementById(target):target;
      const ctrl=node?controllers.get(node):null;
      if(ctrl){ctrl.dirty=true;schedule(ctrl,opts);}
      return;
    }
    controllers.forEach(ctrl=>{ctrl.dirty=true;schedule(ctrl,opts);});
  }

  /* syncTableToolbarActions paylaşılan düğümleri evleri arasında taşımadan ÖNCE
     çağrılır: taşma menüsündeki her eylem gerçek yerine döner, böylece taşıma
     sistemi bizim geçici yerleşimimizi değil gerçek yerleşimi görür. */
  function reset(){
    if(!HAS_DOM)return;
    controllers.forEach(ctrl=>{
      restoreAll(ctrl);
      ctrl.applied=null;
      ctrl.toolbar.removeAttribute('data-toolbar-compact');
      ctrl.toolbar.removeAttribute('data-toolbar-wrap');
    });
  }

  /* Taşma menüsü ekranda kalır: sağ kenara yaklaşınca yatay kayar, alt kenara
     yaklaşınca kendi içinde kaydırılır. Kırpma ya da z-index ile gizleme yok. */
  function placeMenu(menu){
    if(!HAS_DOM||!menu||menu.hidden)return;
    menu.style.transform='';
    menu.style.maxHeight='';
    const margin=8;
    const rect=menu.getBoundingClientRect();
    let shift=0;
    if(rect.right>window.innerWidth-margin)shift=(window.innerWidth-margin)-rect.right;
    if(rect.left+shift<margin)shift=margin-rect.left;
    if(shift)menu.style.transform='translateX('+Math.round(shift)+'px)';
    if(rect.bottom>window.innerHeight-margin){
      menu.style.maxHeight=Math.max(160,window.innerHeight-rect.top-margin)+'px';
      menu.style.overflowY='auto';
    }
  }

  if(HAS_DOM){
    const boot=()=>scan(document);
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);
    else boot();
    /* applyUiFontStep arayüz ölçeği değişince resize yayınlar; aynı dinleyici
       hem pencere boyutunu hem ölçeği yakalar. */
    window.addEventListener('resize',()=>{
      controllers.forEach(ctrl=>{ctrl.dirty=true;schedule(ctrl);});
    });
  }

  return Object.freeze({
    PRIORITY_RANK,
    layoutWidth,
    planToolbarLayout,
    samePlan,
    overflowCandidates,
    register,
    scan,
    refresh,
    reset,
    placeMenu,
  });
});
