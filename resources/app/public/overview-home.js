/* Genel Bakış · Ana ekran denetleyicisi (Android ana ekranı modeli).

   - Widget'lar 12 sütunlu hücre ızgarasında {x,y,w,h} ile konumlanır.
   - Birden çok sayfa: üstte sayfa sekmeleri, altta nokta göstergesi, trackpad
     ile yatay kaydırma.
   - Düzenleme modu: "Düzenle" düğmesi veya bir widget başlığına / boş alana
     basılı tutma. Widget sürüklenir (çakışanlar aşağı itilir), kenar ve köşe
     tutamaçlarıyla hücre adımlarında boyutlandırılır, üstteki "Kaldır" alanına
     bırakılarak kaldırılır, ızgaranın sol/sağ kenarında bekletilerek başka
     sayfaya taşınır. Klavye: oklar taşır, Shift+oklar boyutlandırır,
     Ctrl+sol/sağ sayfa değiştirir, Delete kaldırır.
   - Widget çekmecesi: gizli widget'ları ekler, yerleşik olanlara götürür.
   Yerleşim kararları saf motor overview-layout.js'tedir; burada yalnız DOM,
   işaretçi ve kalıcılık vardır. İş verisine dokunulmaz. */
(function(){
  'use strict';
  const L=window.BLOverviewLayout;if(!L||typeof document==='undefined')return;
  const STORAGE_KEY='buyerlog.overview.layout.v2';
  const LEGACY_KEY='buyerlog.overview.layout.v1';
  const LONG_PRESS_MS=520;
  const EDGE_DWELL_MS=650;
  const HEADER_SELECTOR=['.ovInboxHead','.ovPremiumHead','.ovLaunchHead','.globalFlowHead','.ovPriorityHeader','.ovCollectionSummaryHeader','.oabHeader','.intakeHeader','.ovBreakdownHead','.cpaBar','#ovAttention .cpaCard>header','#ovDataCoverage .cpaCard>header'].join(',');
  const INTERACTIVE='button,a,input,select,textarea,label,summary,[role="button"],[role="tab"],[contenteditable="true"],canvas';
  const NARROW_QUERY='(max-width: 900px)';

  let previousLayout=null;
  let state=null,editing=false,selectedKey='',session=null,longPress=null,wheelAccum=0,wheelTimer=0;
  const reducedMotion=()=>{try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_){return false;}};
  const isNarrow=()=>{try{return window.matchMedia(NARROW_QUERY).matches;}catch(_){return false;}};
  const lang=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';
  const T=(tr,en)=>lang()==='en'?en:tr;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const grid=()=>document.getElementById('ovDashboardGrid');
  const widgetEl=key=>grid()?.querySelector(`:scope > [data-overview-widget="${key}"]`)||null;
  const widgetName=key=>{const s=L.spec(key);return s?(lang()==='en'?s.en:s.tr):key;};
  const store=()=>{try{return window.BLStorage||window.localStorage;}catch(_){return null;}};

  function load(){
    let raw=null;
    try{raw=JSON.parse(store()?.getItem(STORAGE_KEY)||'null');}catch(_){raw=null;}
    if(!raw){try{raw=JSON.parse(store()?.getItem(LEGACY_KEY)||'null');}catch(_){raw=null;}}
    return L.normalize(raw);
  }
  function persist(){try{store()?.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
  function commit(next,options={}){
    state=L.normalize(next);persist();apply({animate:options.animate!==false});
    try{document.dispatchEvent(new CustomEvent('bl:overview-layout-changed',{detail:{page:state.page}}));}catch(_){}
  }

  /* ---------------------------------------------------------------- çizim */
  function metrics(){
    const g=grid();if(!g)return null;
    const rect=g.getBoundingClientRect(),style=getComputedStyle(g);
    const gap=parseFloat(style.columnGap)||14,rowGap=parseFloat(style.rowGap)||gap;
    const row=parseFloat(style.getPropertyValue('--ov-row'))||60;
    const colW=(rect.width-gap*(L.COLS-1))/L.COLS;
    return {rect,gap,rowGap,row,colW,stepX:colW+gap,stepY:row+rowGap};
  }
  function place(el,item){
    el.style.gridColumn=`${item.x+1} / span ${item.w}`;
    el.style.gridRow=`${item.y+1} / span ${item.h}`;
    el.style.setProperty('--ov-h',String(item.h));
  }
  function snapshotRects(){
    const map=new Map();
    grid()?.querySelectorAll(':scope > [data-overview-widget]').forEach(el=>{if(!el.classList.contains('ovHomeOff'))map.set(el.dataset.overviewWidget,el.getBoundingClientRect());});
    return map;
  }
  function flip(before,skipKey){
    if(!before||reducedMotion())return;
    grid()?.querySelectorAll(':scope > [data-overview-widget]').forEach(el=>{
      const key=el.dataset.overviewWidget;if(key===skipKey||el.classList.contains('ovHomeOff'))return;
      const prev=before.get(key);if(!prev)return;
      const now=el.getBoundingClientRect(),dx=prev.left-now.left,dy=prev.top-now.top;
      if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
      try{el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});}catch(_){}
    });
  }
  function apply({animate=false,preview=null,skipKey=''}={}){
    const g=grid();if(!g)return;
    const view=preview||state,pageIndex=view.page,page=view.pages[pageIndex]||{items:[]};
    const before=animate?snapshotRects():null;
    const onPage=new Map(page.items.map(item=>[item.key,item]));
    const ordered=[...page.items].sort((a,b)=>a.y-b.y||a.x-b.x).map(item=>item.key);
    g.querySelectorAll(':scope > [data-overview-widget]').forEach(el=>{
      const key=el.dataset.overviewWidget,item=onPage.get(key);
      if(key===skipKey){el.classList.remove('ovHomeOff');return;}
      if(!item){el.classList.add('ovHomeOff');el.setAttribute('aria-hidden','true');return;}
      el.classList.remove('ovHomeOff');el.removeAttribute('aria-hidden');
      place(el,item);
      const size=L.sizeClass(item);
      el.dataset.ovW=String(item.w);el.dataset.ovH=String(item.h);el.dataset.ovSizeW=size.w;el.dataset.ovSizeH=size.h;
      el.style.order=String(ordered.indexOf(key));
    });
    g.dataset.page=String(pageIndex);
    g.dataset.density=view.density||'comfortable';
    const preset=document.getElementById('ovHomePremiumBtn');
    if(preset){preset.hidden=view.density==='compact'&&!previousLayout;preset.textContent=previousLayout?T('Önceki düzen','Previous layout'):T('Premium düzen','Premium layout');}
    window.BLOverviewPremium?.onViewChanged?.();
    g.style.setProperty('--ov-rows',String(Math.max(L.rows(page.items)+(editing?3:0),editing?6:1)));
    g.classList.toggle('isEditing',editing);
    document.body.classList.toggle('ovHomeEditing',editing);
    renderEmptyPage(page);
    renderShields(view);
    renderPager(view);
    if(before)flip(before,skipKey);
  }
  function renderEmptyPage(page){
    const g=grid();let empty=g.querySelector(':scope > .ovHomeEmptyPage');
    if(page.items.length){empty?.remove();return;}
    if(!empty){empty=document.createElement('div');empty.className='ovHomeEmptyPage';g.appendChild(empty);}
    empty.innerHTML=`<svg class="ic" aria-hidden="true"><use href="#i-apps"/></svg><b>${esc(T('Bu sayfa boş','This page is empty'))}</b><span>${esc(T('Widget çekmecesinden ekleyin veya başka sayfadan bir widget sürükleyin.','Add from the widget drawer or drag a widget here from another page.'))}</span><button type="button" class="tbtn primary" data-home-open-drawer>${esc(T('Widget ekle','Add widget'))}</button>`;
  }
  function pageLabel(view,index){return L.pageName(view.pages[index],index,lang());}
  function renderPager(view){
    const pager=document.getElementById('ovHomePager'),dots=document.getElementById('ovHomeDots');
    const count=view.pages.length,show=count>1||editing;
    if(pager){
      pager.hidden=!show;
      pager.setAttribute('role','tablist');
      pager.innerHTML=show?view.pages.map((page,index)=>`<button type="button" role="tab" class="ovHomePageTab${index===view.page?' isActive':''}" data-home-page-tab="${index}" aria-selected="${index===view.page?'true':'false'}" tabindex="${index===view.page?'0':'-1'}" title="${esc(editing?T('Yeniden adlandırmak için çift tıkla','Double-click to rename'):pageLabel(view,index))}"><span>${esc(pageLabel(view,index))}</span><small>${page.items.length}</small></button>`).join(''):'';
    }
    if(dots){
      dots.hidden=count<2;
      dots.innerHTML=count<2?'':view.pages.map((_,index)=>`<button type="button" class="ovHomeDot${index===view.page?' isActive':''}" data-home-page-tab="${index}" tabindex="-1" aria-label="${esc(pageLabel(view,index))}"></button>`).join('');
    }
    const removePage=document.getElementById('ovHomeRemovePageBtn');
    if(removePage)removePage.disabled=!(view.pages.length>1&&!(view.pages[view.page]?.items.length));
    const addPage=document.getElementById('ovHomeAddPageBtn');
    if(addPage)addPage.disabled=view.pages.length>=L.MAX_PAGES;
  }
  function renderShields(view){
    const g=grid();
    g.querySelectorAll(':scope > .ovHomeShield').forEach(el=>el.remove());
    if(!editing)return;
    const page=view.pages[view.page]||{items:[]},lastPage=view.pages.length-1;
    page.items.forEach(item=>{
      if(session&&session.key===item.key&&session.kind==='move')return;
      const shield=document.createElement('div');
      shield.className='ovHomeShield'+(item.key===selectedKey?' isSelected':'');
      shield.dataset.homeShield=item.key;shield.tabIndex=0;shield.setAttribute('role','button');
      shield.setAttribute('aria-label',`${widgetName(item.key)} · ${item.w}×${item.h} · ${T('Oklarla taşı, Shift+oklarla boyutlandır, Delete ile kaldır','Arrows move, Shift+arrows resize, Delete removes')}`);
      place(shield,item);
      const icon=L.spec(item.key)?.icon||'layout-dashboard';
      shield.innerHTML=`<div class="ovHomeShieldBar"><svg class="ic" aria-hidden="true"><use href="#i-${esc(icon)}"/></svg><b>${esc(widgetName(item.key))}</b><span class="ovHomeSize">${item.w}×${item.h}</span>`
        +`<button type="button" data-home-send="-1" title="${esc(T('Önceki sayfaya gönder','Send to previous page'))}"${view.page<=0?' disabled':''}>‹</button>`
        +`<button type="button" data-home-send="1" title="${esc(T('Sonraki sayfaya gönder','Send to next page'))}"${view.page>=lastPage&&view.pages.length>=L.MAX_PAGES?' disabled':''}>›</button>`
        +`<button type="button" class="ovHomeRemoveBtn" data-home-remove title="${esc(T('Ana ekrandan kaldır','Remove from home screen'))}" aria-label="${esc(T('Kaldır','Remove'))}">×</button></div>`
        +['n','s','e','w','ne','nw','se','sw'].map(dir=>`<span class="ovHomeHandle ovHomeHandle--${dir}" data-home-resize="${dir}" aria-hidden="true"></span>`).join('');
      g.appendChild(shield);
    });
  }

  /* ---------------------------------------------------------- mod geçişi */
  function setEditing(value){
    const next=Boolean(value)&&!isNarrow();
    if(next===editing){apply();return;}
    editing=next;if(!editing){selectedKey='';endSession(true);}
    const panel=document.getElementById('ovLayoutEditPanel'),button=document.getElementById('ovLayoutEditBtn');
    if(panel)panel.hidden=!editing;
    if(button){button.hidden=editing;button.setAttribute('aria-pressed',editing?'true':'false');button.classList.toggle('active',editing);}
    apply();
  }
  function goToPage(index,direction){
    const target=Math.max(0,Math.min(state.pages.length-1,index));if(target===state.page)return;
    const dir=direction||(target>state.page?1:-1);
    state=L.setPage(state,target);persist();apply();
    const g=grid();
    if(g&&!reducedMotion()){g.classList.remove('ovHomeSlideNext','ovHomeSlidePrev');void g.offsetWidth;g.classList.add(dir>0?'ovHomeSlideNext':'ovHomeSlidePrev');setTimeout(()=>g.classList.remove('ovHomeSlideNext','ovHomeSlidePrev'),260);}
  }
  function highlight(key){
    const el=widgetEl(key);if(!el)return;
    el.scrollIntoView({block:'nearest',behavior:reducedMotion()?'auto':'smooth'});
    el.classList.remove('ovHomePulse');void el.offsetWidth;el.classList.add('ovHomePulse');setTimeout(()=>el.classList.remove('ovHomePulse'),1300);
  }

  /* ---------------------------------------------------- sürükle / boyutla */
  function cellFromPoint(m,left,top,w,h){
    const x=Math.round((left-m.rect.left)/m.stepX),y=Math.round((top-m.rect.top)/m.stepY);
    return {x:Math.max(0,Math.min(L.COLS-w,x)),y:Math.max(0,y)};
  }
  function dropZones(show){
    let remove=document.querySelector('.ovHomeDropRemove');
    if(!show){document.querySelectorAll('.ovHomeDropRemove,.ovHomeEdge').forEach(el=>el.remove());return;}
    if(!remove){
      remove=document.createElement('div');remove.className='ovHomeDropRemove';
      remove.innerHTML=`<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg><span>${esc(T('Kaldırmak için buraya bırak','Drop here to remove'))}</span>`;
      document.body.appendChild(remove);
      ['prev','next'].forEach(side=>{const edge=document.createElement('div');edge.className=`ovHomeEdge ovHomeEdge--${side}`;edge.innerHTML=`<svg class="ic" aria-hidden="true"><use href="#i-chevron-${side==='prev'?'left':'right'}"/></svg>`;document.body.appendChild(edge);});
    }
    const m=metrics();if(!m)return;
    const top=Math.max(8,m.rect.top),height=Math.max(120,Math.min(window.innerHeight,m.rect.bottom)-top);
    document.querySelectorAll('.ovHomeEdge').forEach(edge=>{
      const prev=edge.classList.contains('ovHomeEdge--prev');
      edge.style.top=`${top}px`;edge.style.height=`${Math.min(height,window.innerHeight-top-8)}px`;
      edge.style.left=prev?`${Math.max(0,m.rect.left-30)}px`:`${Math.min(window.innerWidth-28,m.rect.right+2)}px`;
      edge.hidden=prev?state.page<=0:state.page>=state.pages.length-1&&state.pages.length>=L.MAX_PAGES;
    });
  }
  function hit(el,x,y){if(!el||el.hidden)return false;const r=el.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
  function ensureGhost(){
    const g=grid();let ghost=g.querySelector(':scope > .ovHomeGhost');
    if(!ghost){ghost=document.createElement('div');ghost.className='ovHomeGhost';ghost.setAttribute('aria-hidden','true');g.appendChild(ghost);}
    return ghost;
  }
  function beginMove(key,clientX,clientY){
    const el=widgetEl(key),m=metrics();if(!el||!m)return;
    const rect=el.getBoundingClientRect(),found=L.locate(state,key);if(!found)return;
    selectedKey=key;
    session={kind:'move',key,el,originPage:state.page,lastX:clientX,lastY:clientY,startX:clientX,startY:clientY,offsetX:clientX-rect.left,offsetY:clientY-rect.top,base:L.normalize(state),preview:null,target:null,started:true,overRemove:false,edgeSide:'',edgeTimer:0};
    el.classList.add('isLifted');
    dropZones(true);
    apply({preview:session.base,skipKey:key});
    updateMove(clientX,clientY);
  }
  function updateMove(clientX,clientY){
    const s=session;if(!s||s.kind!=='move')return;
    s.lastX=clientX;s.lastY=clientY;
    s.el.style.transform=`translate(${clientX-s.startX}px,${clientY-s.startY}px) scale(1.02)`;
    const remove=document.querySelector('.ovHomeDropRemove');
    s.overRemove=hit(remove,clientX,clientY);remove?.classList.toggle('isHot',s.overRemove);
    const ghost=ensureGhost();
    if(s.overRemove){
      ghost.hidden=true;s.target=null;
      s.preview=L.removeWidget(s.base,s.key);s.preview.page=s.base.page;
      apply({preview:s.preview,skipKey:s.key});edgeDwell('');return;
    }
    let side='';
    document.querySelectorAll('.ovHomeEdge').forEach(edge=>{const on=hit(edge,clientX,clientY);edge.classList.toggle('isHot',on);if(on)side=edge.classList.contains('ovHomeEdge--prev')?'prev':'next';});
    edgeDwell(side);
    const m=metrics(),found=L.locate(s.base,s.key);if(!m||!found)return;
    const cell=cellFromPoint(m,clientX-s.offsetX,clientY-s.offsetY,found.item.w,found.item.h);
    if(s.target&&s.target.x===cell.x&&s.target.y===cell.y&&s.target.page===s.base.page&&s.preview)return;
    s.target={...cell,page:s.base.page};
    s.preview=L.moveWidget(s.base,s.key,cell.x,cell.y,s.base.page);
    const moved=L.locate(s.preview,s.key);
    ghost.hidden=false;if(moved)place(ghost,moved.item);
    apply({preview:s.preview,skipKey:s.key});
  }
  function edgeDwell(side){
    const s=session;if(!s)return;
    if(side===s.edgeSide)return;
    clearTimeout(s.edgeTimer);s.edgeSide=side;if(!side)return;
    s.edgeTimer=setTimeout(()=>{
      if(!session||session!==s)return;
      let base=s.base,target=base.page+(side==='next'?1:-1);
      if(target>=base.pages.length){
        /* Tek başına duran widget için yeni boş sayfa açılmaz (boş sayfa bırakırdı). */
        if(base.pages.length>=L.MAX_PAGES||(base.pages[base.page]?.items.length||0)<=1)return;
        base=L.addPage(base);target=base.pages.length-1;
      }
      if(target<0)return;
      base=L.sendToPage(base,s.key,target);base.page=target;
      /* Kenarda kalındıkça tekrar sayfa çevrilmez; kenardan çıkıp yeniden girmek gerekir. */
      s.base=L.normalize(base);s.target=null;s.preview=null;s.edgeSide=side;
      state=L.setPage(state,target);
      apply({preview:s.base,skipKey:s.key});dropZones(true);
      /* İşaretçi hareket etmeden bırakılırsa da yeni sayfadaki önizleme kullanılır. */
      updateMove(s.lastX,s.lastY);
    },EDGE_DWELL_MS);
  }
  function finishMove(cancel){
    const s=session;if(!s||s.kind!=='move')return;
    clearTimeout(s.edgeTimer);
    s.el.classList.remove('isLifted');s.el.style.transform='';
    grid()?.querySelector(':scope > .ovHomeGhost')?.remove();
    dropZones(false);session=null;
    if(cancel||!s.preview){state=L.setPage(state,s.originPage);apply({animate:true});return;}
    const removed=s.overRemove;
    commit(s.preview,{animate:true});
    if(removed){selectedKey='';announce(T(`${widgetName(s.key)} kaldırıldı. Widget ekle ile geri getirebilirsiniz.`,`${widgetName(s.key)} removed. Bring it back from Add widget.`));}
  }
  function beginResize(key,dir,clientX,clientY){
    const found=L.locate(state,key);if(!found)return;
    selectedKey=key;
    session={kind:'resize',key,dir,startX:clientX,startY:clientY,start:{...found.item},base:L.normalize(state),preview:null,last:''};
    document.body.classList.add('ovHomeResizing');
  }
  function updateResize(clientX,clientY){
    const s=session;if(!s||s.kind!=='resize')return;
    const m=metrics(),spec=L.spec(s.key);if(!m||!spec)return;
    const dx=Math.round((clientX-s.startX)/m.stepX),dy=Math.round((clientY-s.startY)/m.stepY);
    const r={...s.start},maxW=Math.min(spec.maxW,L.COLS);
    if(s.dir.includes('e'))r.w=Math.max(spec.minW,Math.min(maxW,s.start.w+dx,L.COLS-s.start.x));
    if(s.dir.includes('s'))r.h=Math.max(spec.minH,Math.min(spec.maxH,s.start.h+dy));
    if(s.dir.includes('w')){const right=s.start.x+s.start.w;r.w=Math.max(spec.minW,Math.min(maxW,s.start.w-dx,right));r.x=right-r.w;}
    if(s.dir.includes('n')){const bottom=s.start.y+s.start.h;r.h=Math.max(spec.minH,Math.min(spec.maxH,s.start.h-dy,bottom));r.y=bottom-r.h;}
    const sig=`${r.x},${r.y},${r.w},${r.h}`;if(sig===s.last)return;s.last=sig;
    s.preview=L.resizeWidget(s.base,s.key,r);
    apply({preview:s.preview,animate:true});
  }
  function finishResize(cancel){
    const s=session;if(!s||s.kind!=='resize')return;
    session=null;document.body.classList.remove('ovHomeResizing');
    if(cancel||!s.preview){apply({animate:true});return;}
    commit(s.preview,{animate:false});
  }
  function endSession(cancel){if(!session)return;if(session.kind==='move')finishMove(cancel);else if(session.kind==='resize')finishResize(cancel);else session=null;}

  /* Bekleyen bir "basılı tut" ya da düzen modundaki basış henüz sürüklemeye
     dönüşmemişse, 5px eşiği geçildiğinde taşıma başlar. */
  function onPointerDown(event){
    if(event.button!==0||isNarrow())return;
    const g=grid();if(!g)return;
    const handle=event.target.closest('[data-home-resize]');
    if(editing&&handle){
      event.preventDefault();const shield=handle.closest('[data-home-shield]');
      beginResize(shield.dataset.homeShield,handle.dataset.homeResize,event.clientX,event.clientY);return;
    }
    if(editing){
      const shield=event.target.closest('[data-home-shield]');
      if(shield&&!event.target.closest('button')){
        event.preventDefault();
        session={kind:'pending',key:shield.dataset.homeShield,startX:event.clientX,startY:event.clientY};
        if(selectedKey!==shield.dataset.homeShield){selectedKey=shield.dataset.homeShield;g.querySelectorAll(':scope > .ovHomeShield').forEach(el=>el.classList.toggle('isSelected',el.dataset.homeShield===selectedKey));}
        shield.focus({preventScroll:true});
      }
      return;
    }
    /* Görüntüleme modu: başlıkta veya boş ızgara alanında basılı tutma düzen
       modunu açar ve widget'ı doğrudan kaldırır (Android davranışı). */
    const onEmpty=event.target===g;
    const header=event.target.closest(HEADER_SELECTOR);
    if(!onEmpty&&(!header||event.target.closest(INTERACTIVE)))return;
    const widget=event.target.closest('[data-overview-widget]');
    const key=widget&&g.contains(widget)?widget.dataset.overviewWidget:'';
    clearTimeout(longPress?.timer);
    longPress={x:event.clientX,y:event.clientY,key,timer:setTimeout(()=>{
      const lp=longPress;longPress=null;if(!lp)return;
      try{window.getSelection()?.removeAllRanges();}catch(_){}
      setEditing(true);
      if(lp.key){selectedKey=lp.key;session={kind:'pending',key:lp.key,startX:lp.x,startY:lp.y,fromLongPress:true};apply();}
      try{navigator.vibrate?.(12);}catch(_){}
    },LONG_PRESS_MS)};
  }
  function onPointerMove(event){
    if(longPress&&Math.hypot(event.clientX-longPress.x,event.clientY-longPress.y)>8){clearTimeout(longPress.timer);longPress=null;}
    if(!session)return;
    if(session.kind==='pending'){
      if(Math.hypot(event.clientX-session.startX,event.clientY-session.startY)<5)return;
      const {key,startX,startY}=session;session=null;
      beginMove(key,startX,startY);
    }
    if(session?.kind==='move'){event.preventDefault();updateMove(event.clientX,event.clientY);}
    else if(session?.kind==='resize'){event.preventDefault();updateResize(event.clientX,event.clientY);}
  }
  /* Sürükleme/boyutlandırma bitince kalkanlar yeniden kurulur; tarayıcı
     ardından gelen tıklamayı ortak ataya (ızgaraya) gönderir ve bu "boş alana
     tıklama" gibi seçimi kaldırırdı. O tek tıklama yutulur. */
  function swallowNextClick(){
    const stop=event=>{event.stopPropagation();event.preventDefault();};
    window.addEventListener('click',stop,{capture:true,once:true});
    setTimeout(()=>window.removeEventListener('click',stop,{capture:true}),80);
  }
  function onPointerUp(){
    if(longPress){clearTimeout(longPress.timer);longPress=null;}
    if(!session)return;
    if(session.kind==='pending'){if(session.fromLongPress)swallowNextClick();session=null;return;}
    swallowNextClick();
    endSession(false);
  }

  /* --------------------------------------------------------------- klavye */
  function onShieldKey(event){
    const shield=event.target.closest?.('[data-home-shield]');if(!shield||!editing)return;
    const key=shield.dataset.homeShield,found=L.locate(state,key);if(!found)return;
    const item=found.item,arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();removeWithNotice(key);return;}
    if(!arrows[event.key])return;
    event.preventDefault();selectedKey=key;
    const [dx,dy]=arrows[event.key];
    if(event.ctrlKey||event.metaKey){if(dx)sendTo(key,state.page+dx);return;}
    if(event.shiftKey)commit(L.resizeWidget(state,key,{x:item.x,y:item.y,w:item.w+dx,h:item.h+dy}));
    else commit(L.moveWidget(state,key,item.x+dx,Math.max(0,item.y+dy)));
    requestAnimationFrame(()=>grid()?.querySelector(`[data-home-shield="${key}"]`)?.focus({preventScroll:false}));
  }
  function sendTo(key,page){
    let next=state;
    if(page>=next.pages.length){if(next.pages.length>=L.MAX_PAGES)return;next=L.addPage(next);page=next.pages.length-1;}
    if(page<0)return;
    next=L.sendToPage(next,key,page);next.page=page;commit(next);highlight(key);
  }
  function removeWithNotice(key){
    selectedKey='';commit(L.removeWidget(state,key));
    announce(T(`${widgetName(key)} kaldırıldı. Widget ekle ile geri getirebilirsiniz.`,`${widgetName(key)} removed. Bring it back from Add widget.`));
  }
  function announce(message){
    if(typeof window.showToast==='function'){try{window.showToast(message);return;}catch(_){}}
    let live=document.getElementById('ovHomeLive');
    if(!live){live=document.createElement('div');live.id='ovHomeLive';live.className='srOnly';live.setAttribute('aria-live','polite');document.body.appendChild(live);}
    live.textContent=message;
  }

  /* ------------------------------------------------------ widget çekmecesi */
  function drawerPreview(spec){
    return `<span class="ovHomeDrawerPreview" style="--pw:${spec.w};--ph:${Math.min(spec.h,8)}" aria-hidden="true"><span></span></span>`;
  }
  function openDrawer(){
    closeDrawer();
    const overlay=document.createElement('div');overlay.className='ovHomeDrawerOverlay';
    overlay.innerHTML=`<div class="ovHomeDrawer" role="dialog" aria-modal="true" aria-labelledby="ovHomeDrawerTitle">
      <header><div><b id="ovHomeDrawerTitle">${esc(T('Widget\'lar','Widgets'))}</b><small>${esc(T('Eklemek için bir widget seçin. Ekrandaki widget\'a tıklamak onu gösterir.','Pick a widget to add. Clicking a placed widget shows it.'))}</small></div>
      <input type="search" data-home-drawer-search placeholder="${esc(T('Widget ara','Search widgets'))}" aria-label="${esc(T('Widget ara','Search widgets'))}">
      <button type="button" class="ovHomeDrawerClose" data-home-drawer-close aria-label="${esc(T('Kapat','Close'))}">×</button></header>
      <div class="ovHomeDrawerBody" data-home-drawer-list></div></div>`;
    document.body.appendChild(overlay);
    window.BLLayerSystem?.openDialog(overlay,{onClose:closeDrawer});
    const draw=()=>{
      const q=String(overlay.querySelector('[data-home-drawer-search]').value||'').toLocaleLowerCase(lang()==='en'?'en':'tr');
      const groups=[['operations',T('Operasyon','Operations')],['today',T('Bugün','Today')],['commercial',T('Ticari','Commercial')]];
      overlay.querySelector('[data-home-drawer-list]').innerHTML=groups.map(([group,label])=>{
        const keys=L.widgets.filter(key=>L.REGISTRY[key].group===group).filter(key=>{
          const s=L.REGISTRY[key];return !q||[s.tr,s.en,s.descTr,s.descEn].join(' ').toLocaleLowerCase(lang()==='en'?'en':'tr').includes(q);
        });
        if(!keys.length)return '';
        return `<div class="ovHomeDrawerGroup"><h3>${esc(label)}</h3><div class="ovHomeDrawerGrid">${keys.map(key=>{
          const s=L.REGISTRY[key],where=L.locate(state,key);
          const status=where?T(`${pageLabel(state,where.page)} sayfasında`,`On ${pageLabel(state,where.page)}`):T('Ekranda değil','Not on screen');
          return `<button type="button" class="ovHomeDrawerCard${where?' isPlaced':''}" data-home-drawer-key="${key}">
            ${drawerPreview(s)}
            <span class="ovHomeDrawerText"><b><svg class="ic" aria-hidden="true"><use href="#i-${esc(s.icon)}"/></svg>${esc(lang()==='en'?s.en:s.tr)}</b><small>${esc(lang()==='en'?s.descEn:s.descTr)}</small>
            <span class="ovHomeDrawerMeta"><em>${s.w}×${s.h}</em><i>${esc(status)}</i></span></span>
            <span class="ovHomeDrawerAction">${esc(where?T('Göster','Show'):T('Ekle','Add'))}</span></button>`;
        }).join('')}</div></div>`;
      }).join('')||`<p class="ovHomeDrawerEmpty">${esc(T('Eşleşen widget yok.','No matching widget.'))}</p>`;
    };
    draw();
    overlay.addEventListener('input',event=>{if(event.target.matches('[data-home-drawer-search]'))draw();});
    overlay.addEventListener('click',event=>{
      if(event.target===overlay||event.target.closest('[data-home-drawer-close]')){closeDrawer();return;}
      const card=event.target.closest('[data-home-drawer-key]');if(!card)return;
      const key=card.dataset.homeDrawerKey,where=L.locate(state,key);
      closeDrawer();
      if(where){goToPage(where.page);selectedKey=key;apply();highlight(key);return;}
      commit(L.addWidget(state,key,state.page));selectedKey=key;apply();highlight(key);
      try{document.dispatchEvent(new CustomEvent('bl:overview-widget-added',{detail:{key}}));}catch(_){}
      window.dispatchEvent(new Event('resize'));
    });
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closeDrawer();}});
    requestAnimationFrame(()=>{overlay.classList.add('isOpen');overlay.querySelector('[data-home-drawer-search]')?.focus();});
  }
  function closeDrawer(){document.querySelectorAll('.ovHomeDrawerOverlay').forEach(el=>{window.BLLayerSystem?.closeDialog(el);el.remove();});}

  /* ------------------------------------------------------------- bağlama */
  function bind(){
    const g=grid();if(!g||g.dataset.homeBound)return;g.dataset.homeBound='1';
    g.addEventListener('pointerdown',onPointerDown);
    window.addEventListener('pointermove',onPointerMove,{passive:false});
    window.addEventListener('pointerup',onPointerUp);
    window.addEventListener('pointercancel',()=>{
      if(longPress){clearTimeout(longPress.timer);longPress=null;}
      if(session&&session.kind==='pending')session=null;
      endSession(true);
    });
    g.addEventListener('keydown',onShieldKey);
    g.addEventListener('contextmenu',event=>{if(editing&&event.target.closest('[data-home-shield]'))event.preventDefault();});
    g.addEventListener('click',event=>{
      if(event.target.closest('[data-home-open-drawer]')){openDrawer();return;}
      if(!editing)return;
      const remove=event.target.closest('[data-home-remove]');
      if(remove){removeWithNotice(remove.closest('[data-home-shield]').dataset.homeShield);return;}
      const send=event.target.closest('[data-home-send]');
      if(send){const key=send.closest('[data-home-shield]').dataset.homeShield;sendTo(key,state.page+Number(send.dataset.homeSend));return;}
      if(event.target===g){if(selectedKey){selectedKey='';apply();}else setEditing(false);}
    });
    const pagerClick=event=>{
      const tab=event.target.closest('[data-home-page-tab]');if(!tab)return;
      goToPage(Number(tab.dataset.homePageTab));
    };
    document.getElementById('ovHomePager')?.addEventListener('click',pagerClick);
    document.getElementById('ovHomeDots')?.addEventListener('click',pagerClick);
    document.getElementById('ovHomePager')?.addEventListener('dblclick',event=>{
      const tab=event.target.closest('[data-home-page-tab]');if(!tab||!editing)return;
      const index=Number(tab.dataset.homePageTab),current=pageLabel(state,index);
      const name=window.prompt(T('Sayfa adı','Page name'),current);if(name==null)return;
      commit(L.renamePage(state,index,name.trim()?{tr:name.trim(),en:name.trim()}:null));
    });
    document.getElementById('ovHomePager')?.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();
      goToPage(state.page+(event.key==='ArrowRight'?1:-1));
      document.querySelector(`#ovHomePager [data-home-page-tab="${state.page}"]`)?.focus();
    });
    document.getElementById('ovLayoutEditBtn')?.addEventListener('click',()=>setEditing(!editing));
    document.getElementById('ovLayoutDoneBtn')?.addEventListener('click',()=>setEditing(false));
    document.getElementById('ovHomeAddWidgetBtn')?.addEventListener('click',openDrawer);
    document.getElementById('ovHomeCompactBtn')?.addEventListener('click',()=>commit(L.compactPage(state,state.page)));
    document.getElementById('ovHomeAddPageBtn')?.addEventListener('click',()=>commit(L.addPage(state)));
    document.getElementById('ovHomeRemovePageBtn')?.addEventListener('click',()=>commit(L.removePage(state,state.page)));
    document.getElementById('ovLayoutResetBtn')?.addEventListener('click',()=>{
      if(!window.confirm(T('Varsayılan ana ekran düzeni geri yüklensin mi?','Restore the default home screen layout?')))return;
      selectedKey='';commit(L.defaults());
    });
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      if(session){endSession(true);event.preventDefault();return;}
      if(editing&&!document.querySelector('.ovHomeDrawerOverlay')&&document.body.dataset.activeTab==='overview'){setEditing(false);}
    });
    /* Trackpad yatay kaydırma sayfa değiştirir; yatay kayan tablo/harita
       içindeyken dokunulmaz. */
    g.addEventListener('wheel',event=>{
      if(editing||Math.abs(event.deltaX)<Math.abs(event.deltaY)*1.6||state.pages.length<2)return;
      for(let node=event.target;node&&node!==g;node=node.parentElement){
        if(node.id==='globalFlowCanvasWrap')return;
        if(node.scrollWidth>node.clientWidth+2){const ox=getComputedStyle(node).overflowX;if(ox==='auto'||ox==='scroll')return;}
      }
      wheelAccum+=event.deltaX;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelAccum=0;},180);
      if(Math.abs(wheelAccum)>140){const dir=wheelAccum>0?1:-1;wheelAccum=0;goToPage(state.page+dir,dir);}
    },{passive:true});
    try{window.matchMedia(NARROW_QUERY).addEventListener('change',()=>{if(isNarrow())setEditing(false);syncNarrow();});}catch(_){}
    document.addEventListener('bl:language-changed',()=>apply());
    new MutationObserver(()=>apply()).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    syncNarrow();
  }
  function syncNarrow(){
    const button=document.getElementById('ovLayoutEditBtn');if(!button)return;
    button.disabled=isNarrow();
    if(isNarrow())button.title=T('Düzenlemek için pencereyi genişletin.','Widen the window to edit the layout.');
  }
  /* Yükleme sırasında kaydedilmez: senkron tercihlerde yerel yazma zaman
     damgası alır ve sunucudaki (başka cihazdaki) düzenin önüne geçerdi.
     Yalnız kullanıcı eylemi kaydeder; sunucudan gelen düzen reload ile alınır. */
  function init(){
    state=load();bind();apply();
    document.getElementById('ovHomePremiumBtn')?.addEventListener('click',()=>{
      if(previousLayout){const old=previousLayout;previousLayout=null;commit(old);}
      else{previousLayout=L.normalize(state);commit(L.defaults());}
    });
  }
  function reload(){
    if(session||editing)return;
    state=load();apply();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.BLOverviewHome={
    STORAGE_KEY,LEGACY_KEY,
    state:()=>L.normalize(state),
    setEditing,isEditing:()=>editing,goToPage,openDrawer,
    reset:()=>commit(L.defaults()),
    reload,
  };
})();
