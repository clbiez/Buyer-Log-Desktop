/* Buyer Log Motion+ · shared motion language (DESIGN_SYSTEM.md §6).
   Geometry, DOM ownership, tab state and business data never change here.
   Page/cell effects are finite. An active Refresh indicator runs only while its
   refresh busy class is present; no animation loops/observers of table cells. */
(function(root){
  'use strict';
  const doc=root.document;if(!doc)return;
  const html=doc.documentElement;
  const reduce=()=>Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const enabled=()=>!reduce()&&doc.visibilityState!=='hidden'&&html.dataset.blMotion!=='off'&&!(doc.body?.dataset?.activeTab==='overview'&&html.dataset.overviewMotion==='paused');
  const SPEED=Object.freeze({page:340,card:360,table:390,overlay:240,bar:440,theme:560,flow:440,stagger:40,distance:14});
  const EASE='cubic-bezier(.2,.75,.25,1)';
  const duration=name=>{
    const css=root.getComputedStyle?.(html).getPropertyValue('--ui-motion-'+name);
    const parsed=css?Number.parseFloat(css):NaN;
    return Number.isFinite(parsed)&&parsed>0?parsed:SPEED[name];
  };
  const TAB='main > section.active';
  const PAGE_HEADER='.ovDashboardToolbar,.workspaceContextBar,.bpaHero,.pricingWorkspaceHeader,.kolHeader,.psaHeader,.psaHead,.mfrHeader,.mfpHead,.lcHeader,.lcHead,.dmHead,.lcwaiChatHead';
  const PAGE_SUMMARY='.kpirow,.psaKpis,.pdKpis,.bpaKpis';
  const OVERLAYS='dialog[open],[role="dialog"][aria-hidden="false"],.colPanel.show,.vfMenu.show,.vfMenu.open,.toolbarMoreMenu:not([hidden]),.userMenu:not([hidden])';
  // Controls follow their real busy states; only an active refresh keeps rotating.
  // One-shot click feedback and other Motion+ effects remain finite.
  const REFRESH_IDS=['topRefreshBtn','serverRefreshBtn','cpRefreshBtn','ordersRefreshBtn','lflRefreshBtn','intakeRefreshBtn','backlogOverviewRefresh'];
  const REFRESH_CONTROLS=REFRESH_IDS.map(id=>'#'+id).join(',');
  const ACTIVITY_CONTROLS=REFRESH_IDS.map(id=>[id,'spinning','refresh']).concat([['syncStatusBadge','is-syncing','sync']]);
  const SYNC_CONTROLS='#syncStatusBtn,#cpPlmSyncBtn,#ordersPlmSyncBtn,#kolPlmSyncBtn,[data-plm-sync-category]';
  const activityAnimations=new Map();
  let generation=0,activeTab='',lastWave=-1,overlayFrame=null,overlayBefore=null;
  const pending=new Set(),animations=new Set(),pageAnimations=new Set();
  let pageFlow=null;
  const visible=el=>{
    if(!el||!el.isConnected||el.hidden||el.closest('[hidden],[aria-hidden="true"]'))return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&r.bottom>0&&r.top<root.innerHeight&&r.right>0&&r.left<root.innerWidth;
  };
  function animate(el,frames,options){
    if(!enabled()||!visible(el))return null;
    return start(el,frames,options);
  }
  function start(el,frames,options){
    if(typeof el.animate!=='function')return null;
    let a;
    try{
      a=el.animate(frames,Object.assign({fill:'none',easing:EASE},options));
      animations.add(a);
      a.addEventListener?.('finish',()=>animations.delete(a),{once:true});
      a.addEventListener?.('cancel',()=>animations.delete(a),{once:true});
      return a;
    }catch(_){return null;}
  }
  function cancelPending(){
    if(overlayFrame!==null)root.cancelAnimationFrame(overlayFrame);
    overlayFrame=null;overlayBefore=null;
    for(const id of pending)root.clearTimeout(id);
    pending.clear();
    for(const a of animations){try{a.cancel();}catch(_){}}
    animations.clear();
    pageAnimations.clear();pageFlow=null;
    activityAnimations.clear();
  }
  function later(fn,ms){
    const id=root.setTimeout(()=>{pending.delete(id);fn();},ms);
    pending.add(id);
  }
  function waveTable(view,token){
    if(!enabled()||token!==generation||lastWave===token)return 0;
    if(pageFlow?.stopped)return 0;
    // Yazılım çiziminde (VDI/RDP) yüzlerce hücre animasyonu işlemciye düşer; sayfa ve kart hareketleri kalır.
    if(html.dataset.blRender==='software')return 0;
    const tables=Array.from(view.querySelectorAll('table')).slice(0,12).filter(visible).slice(0,2);
    // Önce yalnız ölçülür, sonra animasyonlar başlatılır. Her animate() stili
    // kirletip sonraki hücre ölçümünü zorunlu yeniden yerleşime çeviriyordu
    // (CP çiziminde 0,45–0,75 sn). Seçilen hücreler ve gecikmeler aynıdır.
    const queue=[];
    for(const table of tables){
      // A table already entering as a single block must not also animate its cells.
      if(pageFlow&&(table.closest?.('.tablewrap')||pageFlow.seen.some(block=>block===table||block.contains?.(table))))continue;
      const tbody=table.tBodies?.[0]||table.querySelector('tbody');
      if(!tbody)continue;
      const host=table.closest?.('.tablewrap')?.getBoundingClientRect();
      const rows=Array.from(tbody.rows||tbody.children).filter(row=>Array.from(row.cells||row.children).some(visible));
      for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
        const cells=Array.from(rows[rowIndex].cells||rows[rowIndex].children);
        for(let col=0;col<cells.length;col++){
          const cell=cells[col];
          const bounds=cell.getBoundingClientRect();
          if(cell.tagName!=='TD'||!visible(cell)||(host&&(bounds.right<=host.left||bounds.left>=host.right||bounds.bottom<=host.top||bounds.top>=host.bottom))||
             cell.matches('.blGridActiveCell,.blGridSelectedCell,.kolSpreadsheetActiveCell,.kolActiveGridCell,[aria-selected="true"],[contenteditable="true"]')||
             cell.querySelector('input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus')||cell.style?.backgroundColor||cell.style?.background)continue;
          queue.push([cell,Math.min(200,rowIndex*23+col*12)]);
        }
      }
    }
    const ms=duration('table');
    let count=0;
    for(const [cell,delay] of queue){
      // A brief tint travels from the top-left; no cell values or selection classes change.
      if(start(cell,[
        {opacity:.72,backgroundColor:'var(--ui-selected)',transform:'translate3d(-2px,-1px,0)'},
        {opacity:1,backgroundColor:'transparent',transform:'translate3d(0,0,0)'}
      ],{duration:ms,delay}))count++;
    }
    if(count)lastWave=token;
    return count;
  }
  function stopPageFlow(){
    if(pageFlow)pageFlow.stopped=true;
    for(const a of pageAnimations){try{a.cancel();}catch(_){}animations.delete(a);}
    pageAnimations.clear();
  }
  function pageBlocks(view){
    const header=[doc.getElementById?.('pageTitle'),...view.querySelectorAll(PAGE_HEADER)].find(visible);
    const summaries=Array.from(view.querySelectorAll(PAGE_SUMMARY)).slice(0,16).filter(visible);
    const anchors=[header,...summaries].filter(Boolean),body=[];
    let scanned=0;
    function visit(parent,depth){
      for(const el of Array.from(parent.children||[])){
        if(++scanned>64)return;
        if(anchors.includes(el)||!visible(el)||el.matches?.('script,style,dialog,.uiState--loading,[aria-busy="true"]'))continue;
        if(el.matches?.('.empty')&&!el.querySelector?.('.uiState--empty,.uiState--error'))continue;
        // A min-height lazy host can be visible before it has rendered any content.
        if(!el.textContent?.trim()&&!el.querySelector?.('svg,canvas,img,table,input,button'))continue;
        // Unwrap layout containers, never table rows/cells or individual widgets.
        const anchored=anchors.some(anchor=>el.contains?.(anchor));
        const pageHost=depth===0&&el.children?.length&&!el.matches?.('.panel,.tablewrap,.empty,table,svg,canvas,[role="toolbar"],[class*="Toolbar"],[class*="toolbar"]');
        if(depth<4&&(anchored||pageHost||el.matches?.('.ovDashboardGrid'))){visit(el,depth+1);}
        else if(!el.querySelector?.('.uiState--loading,[aria-busy="true"]'))body.push(el);
      }
    }
    visit(view,0);
    const blocks=[];
    for(const el of [...anchors,...body]){
      if(blocks.some(parent=>parent===el||parent.contains?.(el)))continue;
      if(el.querySelector?.('input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus,.blGridActiveCell,.blGridSelectedCell,.kolSpreadsheetActiveCell,.kolActiveGridCell,td[aria-selected="true"],[role="gridcell"][aria-selected="true"]'))continue;
      blocks.push(el);
    }
    return blocks.slice(0,5);
  }
  function enterPage(view){
    if(!enabled()||!pageFlow||pageFlow.stopped||pageFlow.view!==view)return;
    // Measure the small visible block set before any writes; large tables are atomic.
    const flow=pageFlow,blocks=pageBlocks(view).filter(el=>!flow.seen.some(seen=>seen===el||seen.contains?.(el)||el.contains?.(seen))).slice(0,Math.max(0,5-flow.seen.length));
    const step=duration('stagger'),distance=duration('distance');
    const ms=Math.max(1,duration('flow')-(blocks.length-1)*step);
    const easing=root.getComputedStyle?.(html).getPropertyValue('--ui-ease').trim()||EASE;
    for(let i=0;i<blocks.length;i++){
      const el=blocks[i];flow.seen.push(el);
      const a=start(el,[{opacity:0,transform:'translate3d(0,'+distance+'px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
        {duration:ms,delay:i*step,fill:'backwards',easing});
      if(a){pageAnimations.add(a);for(const event of ['finish','cancel'])a.addEventListener?.(event,()=>pageAnimations.delete(a),{once:true});}
    }
    // Legacy KPI contract still returns to its exact canonical formatted value.
    try{root.BLKpiMotion?.run?.(view);}catch(_){}
  }
  function activate(force){
    if(!enabled())return;
    const tab=doc.body?.dataset?.activeTab||'';
    const view=doc.querySelector(TAB);
    if(!view||(!force&&tab===activeTab))return;
    activeTab=tab;
    generation++;
    const token=generation;
    cancelPending();
    pageFlow={view,seen:[],stopped:false};
    restoreActivityControls(); // Tab changes must not silence a running refresh.
    enterPage(view);
    // Lazy modules may paint after navigation. Bounded retries only add unseen blocks.
    for(const delay of [120,400,840])later(()=>{if(token===generation&&visible(view))enterPage(view);},delay);
    later(()=>{if(token===generation&&visible(view))waveTable(view,token);},185);
    // Initial async render can deliver the table after the first paint.
    later(()=>{if(token===generation&&visible(view))waveTable(view,token);},840);
  }
  const openOverlays=()=>Array.from(doc.querySelectorAll(OVERLAYS)).filter(visible);
  function hasEntrance(el){
    // CSS and explicit Motion+ calls own the whole surface, including a moving
    // dialog card inside a scrim. Never add a second moving parent/child.
    for(let node=el;node;node=node.parentElement){
      const effects=node.getAnimations?.({subtree:node===el})||[];
      if(effects.some(a=>a.id==='bl-motion-entrance'||/^(blMotionEnter|blMotionOverlay|manifestEnter)$/.test(a.animationName||'')))return true;
    }
    return false;
  }
  function entrance(el,frames){
    if(hasEntrance(el))return null;
    // placeMenu may shift a menu horizontally to keep it inside the viewport.
    const base=root.getComputedStyle?.(el)?.transform;
    if(base&&base!=='none')frames=frames.map(frame=>Object.assign({},frame,{transform:base+' '+frame.transform}));
    const a=animate(el,frames,{duration:duration('overlay')});
    if(a)a.id='bl-motion-entrance';
    return a;
  }
  function cancelHiddenEntrances(){
    for(const a of animations)if(a.id==='bl-motion-entrance'&&!visible(a.effect?.target))a.cancel();
  }
  function queueOverlay(){
    if(!enabled())return;
    cancelHiddenEntrances();
    const before=new Set(openOverlays());
    if(overlayBefore){
      // Delegated .click() calls share one frame. A close/reopen in that frame
      // still counts as a new opening; an already open parent never does.
      for(const el of overlayBefore)if(!before.has(el))overlayBefore.delete(el);
    }else overlayBefore=before;
    if(overlayFrame!==null)return;
    overlayFrame=root.requestAnimationFrame(()=>{
      const previous=overlayBefore;overlayFrame=null;overlayBefore=null;
      cancelHiddenEntrances();
      if(!enabled())return;
      const opened=openOverlays().filter(el=>!previous.has(el));
      const surfaces=opened.filter(el=>!opened.some(parent=>parent!==el&&parent.contains(el))).slice(-4);
      for(const el of surfaces)play('overlay',el);
    });
  }
  function play(kind,element){
    if(!element||!enabled())return null;
    if(kind==='branch')return animate(element,[{opacity:0,transform:'scaleY(0)'},{opacity:1,transform:'scaleY(1)'}],{duration:duration('overlay')});
    // Overview page navigation: one finite slide of the existing grid, without
    // cloning widgets or moving the toolbar. Shared cancellation owns its lifetime.
    if(kind==='page-next'||kind==='page-prev')return animate(element,
      [{opacity:.5,transform:'translate3d('+(kind==='page-next'?48:-48)+'px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
      {duration:duration('page')});
    if(kind==='card')return animate(element,[{opacity:.6,transform:'translate3d(-5px,-3px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('card')});
    if(kind==='overlay')return entrance(element,[{opacity:.55,transform:'translate3d(0,7px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}]);
    // Alttan açılan çekmece: içerik aşağıdan yukarı doğru açılır ve yerine kayar.
    if(kind==='drawer')return entrance(element,[{clipPath:'inset(100% 0 0 0)',transform:'translate3d(0,12px,0)'},{clipPath:'inset(0 0 0 0)',transform:'translate3d(0,0,0)'}]);
    // Bölüm genişletme: yüksekliği sıfırdan kendi boyuna açılır (alta sabitli kapta yukarı doğru büyür).
    if(kind==='expand')return animate(element,[{height:'0px',opacity:0,overflow:'hidden'},{height:element.scrollHeight+'px',opacity:1,overflow:'hidden'}],{duration:duration('overlay')});
    if(kind==='refresh'||kind==='refresh-active')return animate(element,
      [{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],
      {duration:duration('card')*2,iterations:kind==='refresh-active'?Infinity:2});
    if(kind==='sync'||kind==='sync-active')return animate(element,
      [{opacity:1,transform:'scale(1)'},{opacity:.48,transform:'scale(1.08)'},{opacity:1,transform:'scale(1)'}],
      {duration:duration('card')*2,iterations:kind==='sync-active'?8:2});
    return null;
  }
  /* Tema geçişi: kullanıcının Görünüm menüsünde seçtiği efekt (üçgen, toz,
     taneli çözülme) motion-plus-theme.js'te çalışır. Seçim daireyse veya efekt
     bu ortamda çalışamıyorsa (ör. tarayıcı kipinde ekran yakalama yok) eski
     görünümün anlık görüntüsü üzerinde yeni tema, tetikleyen düğmeden dairesel
     olarak yayılır. Hareket kapalıysa, yazılım çizimindeyse veya View
     Transitions yoksa false döner ve çağıran anlık yolu kullanır. */
  let themeTransition=null;
  let startupTicket=0,arrivalStarted=false;
  // Startup changes content through the same triangle mesh as theme changes.
  // The login frame crosses navigation only in the desktop host's short-lived memory.
  function startup(update,shot){
    ++startupTicket;
    if(typeof update!=='function'||!enabled()||html.dataset.blRender==='software')return false;
    try{return root.BLMotionPlusTheme?.run?.(update,null,{startup:true,shot})===true;}catch(_){return false;}
  }
  async function prepareNavigation(){
    if(!enabled()||html.dataset.blRender==='software')return;
    const prepare=root.buyerLogDesktop?.prepareStartupTransition;
    if(typeof prepare!=='function')return;
    let timeout,expired=false;
    try{await Promise.race([(async()=>{
      // Let the emptied password field paint; hidden/throttled tabs have a bounded wait.
      await new Promise(resolve=>root.requestAnimationFrame(()=>root.requestAnimationFrame(resolve)));
      if(!expired&&enabled())await prepare(Math.round(root.innerWidth),Math.round(root.innerHeight));
    })(),new Promise(resolve=>{timeout=root.setTimeout(resolve,650);})]);}
    catch(_){}finally{expired=true;root.clearTimeout(timeout);}
  }
  async function arrive(){
    // Called synchronously at body mount, before trivia can paint. Only the first
    // arrival may consume the one-shot login frame, including on slow documents.
    if(arrivalStarted)return;arrivalStarted=true;
    const mine=++startupTicket,take=root.buyerLogDesktop?.takeStartupTransition;
    if(typeof take!=='function'||!enabled()||html.dataset.blRender==='software')return;
    html.dataset.blStartupArrival='pending';
    let timeout,expired=false;
    const reveal=()=>{expired=true;root.clearTimeout(timeout);delete html.dataset.blStartupArrival;};
    try{
      const shot=await Promise.race([
        take(),
        new Promise(resolve=>{timeout=root.setTimeout(()=>{reveal();resolve(null);},650);})
      ]),guard=doc.getElementById('blBootGuard');
      // startup invokes reveal only after the old frame has covered the viewport;
      // failures, motion guards and expired IPC take the immediate path instead.
      if(!expired&&shot&&mine===startupTicket&&guard&&!guard.dataset.leaving&&startup(reveal,shot))return;
    }catch(_){}
    reveal();
  }
  function theme(update,origin){
    if(typeof update!=='function'||!enabled()||html.dataset.blRender==='software')return false;
    try{if(root.BLMotionPlusTheme?.run?.(update,origin))return true;}catch(_){}
    if(typeof doc.startViewTransition!=='function')return false;
    const w=root.innerWidth||0,h=root.innerHeight||0;
    let x=w/2,y=h/2;
    const box=origin&&typeof origin.getBoundingClientRect==='function'&&origin.isConnected!==false?origin.getBoundingClientRect():null;
    if(box&&box.width>0&&box.height>0){x=box.left+box.width/2;y=box.top+box.height/2;}
    const radius=Math.ceil(Math.hypot(Math.max(x,w-x),Math.max(y,h-y)));
    let transition;
    try{
      if(themeTransition)themeTransition.skipTransition?.();
      html.classList.add('blThemeMorph');
      transition=doc.startViewTransition(update);
    }catch(_){html.classList.remove('blThemeMorph');return false;}
    themeTransition=transition;
    transition.ready.then(()=>{
      html.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+radius+'px at '+x+'px '+y+'px)']},
        {duration:duration('theme'),easing:EASE,pseudoElement:'::view-transition-new(root)'});
    }).catch(()=>{});
    transition.finished.catch(()=>{}).then(()=>{
      if(themeTransition!==transition)return;
      themeTransition=null;
      html.classList.remove('blThemeMorph');
    });
    return true;
  }
  /* Segment / sekme geçişi: seçim değişince 2px vurgu çizgisi eski seçenekten
     yenisine kayar ve söner. Yalnız transform/opacity; metnin üstünü örtmez,
     sayfa yeniden çizse de tıklanan noktadaki grup yeniden bulunur. */
  const SEGMENTS='.ovPremiumSegment,.ovInboxTabs,.ovBreakdownDims,.gfSegment,.bpaSeg2,.cpaSeg,.cpaStudioTabs,.backlogChartTypeSwitch,.sourceModeGroup,.dmViewToggle,.quotationStatusTabs,.lcChips,.ovHomePager,.pdTabs,.dmLabTabs,.psaTabs,.trFocusTabs';
  const SEGMENT_ACTIVE=':is(.isActive,.is-active,.is-on,.active,[aria-pressed="true"],[aria-selected="true"])';
  let segmentPress=null;
  function segmentActive(group){return group&&group.isConnected?Array.from(group.querySelectorAll(':scope > button'+SEGMENT_ACTIVE+',:scope > * > button'+SEGMENT_ACTIVE)).find(visible)||null:null;}
  function rememberSegment(ev){
    const button=ev.target.closest?.('button'),group=button?.closest?.(SEGMENTS);
    const from=group&&segmentActive(group);
    segmentPress=from&&from!==button?{group,from:from.getBoundingClientRect(),x:ev.clientX,y:ev.clientY}:null;
  }
  function slideSegment(){
    const press=segmentPress;segmentPress=null;
    if(!press||!enabled())return;
    root.requestAnimationFrame(()=>root.requestAnimationFrame(()=>{
      const group=press.group.isConnected?press.group:doc.elementFromPoint?.(press.x,press.y)?.closest?.(SEGMENTS);
      const to=segmentActive(group);if(!to)return;
      const end=to.getBoundingClientRect(),from=press.from;
      if(Math.abs(end.left-from.left)<1&&Math.abs(end.top-from.top)<1)return;
      const line=doc.createElement('span');line.className='blSegmentGlide';line.setAttribute('aria-hidden','true');
      line.style.left=end.left+'px';line.style.top=(end.bottom-2)+'px';line.style.width=end.width+'px';
      doc.body.appendChild(line);
      const dx=from.left-end.left,dy=from.bottom-end.bottom,scale=end.width?Math.max(.1,from.width/end.width):1;
      const a=start(line,[{opacity:1,transform:'translate3d('+dx+'px,'+dy+'px,0) scaleX('+scale+')'},{opacity:1,transform:'translate3d(0,0,0) scaleX(1)',offset:.8},{opacity:0,transform:'translate3d(0,0,0) scaleX(1)'}],{duration:duration('overlay')});
      if(a)a.addEventListener('finish',()=>line.remove(),{once:true}),a.addEventListener('cancel',()=>line.remove(),{once:true});else line.remove();
    }));
  }
  function updateActivity(control,activeClass,kind){
    const old=activityAnimations.get(control);
    if(!enabled()||!control.classList?.contains(activeClass)){
      if(old){try{old.animation.cancel();}catch(_){} activityAnimations.delete(control);}
      return;
    }
    const icon=control.querySelector?.('.ic')||control;
    if(old&&old.target===icon)return;
    if(old){try{old.animation.cancel();}catch(_){}}
    const animation=play(kind+'-active',icon);
    if(animation)activityAnimations.set(control,{animation,target:icon});
    else activityAnimations.delete(control);
  }
  function bindActivityControls(){
    for(const [id,activeClass,kind] of ACTIVITY_CONTROLS){
      const control=doc.getElementById?.(id);
      if(!control)continue;
      const update=()=>updateActivity(control,activeClass,kind);
      if(typeof root.MutationObserver==='function'){
        new root.MutationObserver(update).observe(control,{attributes:true,attributeFilter:['class']});
      }
      update();
    }
  }
  function restoreActivityControls(){
    for(const [id,state,kind] of ACTIVITY_CONTROLS){
      const control=doc.getElementById?.(id);
      if(control)updateActivity(control,state,kind);
    }
  }
  function setEnabled(value){
    html.dataset.blMotion=value?'on':'off';
    if(!value){cancelPending();root.BLMotionPlusTheme?.finish?.();}
    else activate(true); // activate restores any in-progress refresh after cancellation.
  }
  function mount(){
    bindActivityControls();
    doc.addEventListener('pointerdown',rememberSegment,true);
    doc.addEventListener('click',slideSegment);
    doc.addEventListener('click',ev=>{
      if(ev.target.closest?.('nav.tabs button[data-tab]'))later(()=>activate(false),45);
      else if(ev.target.closest?.('button,[role="button"]'))queueOverlay();
      const refresh=ev.target.closest?.(REFRESH_CONTROLS);
      const sync=ev.target.closest?.(SYNC_CONTROLS);
      const button=refresh||sync;
      if(button&&!button.disabled){
        const icon=button.querySelector?.('.ic')||button;
        play(refresh?'refresh':'sync',icon);
      }
    },true);
    // Layout/scroll restoration during lazy rendering is not user interaction.
    for(const event of ['pointerdown','focusin','wheel','touchstart','keydown'])doc.addEventListener(event,ev=>{
      if(event==='focusin'&&!['INPUT','TEXTAREA','SELECT'].includes(ev.target?.tagName)&&!ev.target?.isContentEditable)return;
      if(pageFlow?.view.contains?.(ev.target))stopPageFlow();
    },true);
    if(typeof root.MutationObserver==='function'&&doc.body){
      new root.MutationObserver(()=>activate(false)).observe(doc.body,{attributes:true,attributeFilter:['data-active-tab']});
    }
    root.addEventListener?.('bl:startup-complete',()=>activate(true));
    root.addEventListener?.('bl:overview-motion-changed',()=>{if(enabled())activate(true);else cancelPending();});
    doc.addEventListener('visibilitychange',()=>{
      if(doc.visibilityState==='hidden'){cancelPending();root.BLMotionPlusTheme?.finish?.();}
      else restoreActivityControls();
    });
    const media=root.matchMedia?.('(prefers-reduced-motion: reduce)');
    media?.addEventListener?.('change',()=>{
      if(reduce()){cancelPending();root.BLMotionPlusTheme?.finish?.();}
      else restoreActivityControls();
    });
    activate(true);
    // Masaüstünde GPU yoksa bulanıklık ve hücre dalgası hafifletilir (ui-components.css).
    Promise.resolve(root.buyerLogDesktop?.renderProfile?.()).then(profile=>{
      if(profile&&profile.softwareCompositing===true)html.dataset.blRender='software';
    }).catch(()=>{});
  }
  root.BLMotionPlus=Object.freeze({enabled,play,theme,startup,prepareNavigation,arrive,activate,setEnabled,speeds:SPEED});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:globalThis);
