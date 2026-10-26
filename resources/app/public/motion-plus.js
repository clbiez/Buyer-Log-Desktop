/* Buyer Log Motion+ · shared motion language (DESIGN_SYSTEM.md §6).
   Geometry, DOM ownership, tab state and business data never change here.
   All effects are finite and viewport-bounded; no animation loops/observers of table cells. */
(function(root){
  'use strict';
  const doc=root.document;if(!doc)return;
  const html=doc.documentElement;
  const reduce=()=>Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const enabled=()=>!reduce()&&doc.visibilityState!=='hidden'&&html.dataset.blMotion!=='off'&&!(doc.body?.dataset?.activeTab==='overview'&&html.dataset.overviewMotion==='paused');
  const SPEED=Object.freeze({page:340,card:360,table:390,overlay:240,bar:440});
  const EASE='cubic-bezier(.2,.75,.25,1)';
  const duration=name=>{
    const css=root.getComputedStyle?.(html).getPropertyValue('--ui-motion-'+name);
    const parsed=css?Number.parseFloat(css):NaN;
    return Number.isFinite(parsed)&&parsed>0?parsed:SPEED[name];
  };
  const TAB='main > section.active';
  const CARDS='.bpaTile,.pricingMetric,.ovPulseKpi,.ovMetricRow,.ovCollectionCard,.kolModelCard,.kolCard,.lcCard,.mfrCard,.psaKpi,.cpaCard,.ovWidget';
  const BARS='.ovMetricBars em,.bpaBarFill,.bpaProgressFill,.ovPulseMini i';
  const OVERLAYS='dialog[open],[role="dialog"][aria-hidden="false"],.colPanel.show,.vfMenu.show,.toolbarMoreMenu:not([hidden]),.userMenu:not([hidden])';
  // Short, state-driven control motion replaces the removed 7.0.294 refresh
  // rotation / SYNC pulse without introducing perpetual animation loops.
  const REFRESH_CONTROLS='#topRefreshBtn,#serverRefreshBtn,#cpRefreshBtn,#ordersRefreshBtn,#lflRefreshBtn,#intakeRefreshBtn,#backlogOverviewRefresh';
  const SYNC_CONTROLS='#syncStatusBtn,#cpPlmSyncBtn,#ordersPlmSyncBtn,#kolPlmSyncBtn,[data-plm-sync-category]';
  const activityAnimations=new Map();
  let generation=0,activeTab='',lastWave=-1,overlays=new WeakMap();
  const pending=new Set(),animations=new Set();
  const visible=el=>{
    if(!el||!el.isConnected||el.hidden||el.closest('[hidden],[aria-hidden="true"]'))return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&r.bottom>0&&r.top<root.innerHeight&&r.right>0&&r.left<root.innerWidth;
  };
  function animate(el,frames,options){
    if(!enabled()||!visible(el)||typeof el.animate!=='function')return null;
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
    for(const id of pending)root.clearTimeout(id);
    pending.clear();
    for(const a of animations){try{a.cancel();}catch(_){}}
    animations.clear();
    activityAnimations.clear();
  }
  function later(fn,ms){
    const id=root.setTimeout(()=>{pending.delete(id);fn();},ms);
    pending.add(id);
  }
  function waveTable(view,token){
    if(!enabled()||token!==generation||lastWave===token)return 0;
    const tables=Array.from(view.querySelectorAll('table')).slice(0,12).filter(visible).slice(0,2);
    let count=0;
    for(const table of tables){
      const tbody=table.tBodies?.[0]||table.querySelector('tbody');
      if(!tbody)continue;
      const rows=Array.from(tbody.rows||tbody.children).slice(0,9);
      for(let rowIndex=0;rowIndex<rows.length;rowIndex++){
        const cells=Array.from(rows[rowIndex].cells||rows[rowIndex].children).slice(0,12);
        for(let col=0;col<cells.length;col++){
          const cell=cells[col];
          if(cell.tagName!=='TD'||!visible(cell)||
             cell.matches('.blGridActiveCell,.blGridSelectedCell,.kolSpreadsheetActiveCell,.kolActiveGridCell,[aria-selected="true"],[contenteditable="true"]')||
             cell.querySelector('input:focus,textarea:focus,select:focus,[contenteditable="true"]:focus')||cell.style?.backgroundColor||cell.style?.background)continue;
          // A brief tint travels from the top-left; no cell values or selection classes change.
          if(animate(cell,[
            {opacity:.72,backgroundColor:'var(--ui-selected)',transform:'translate3d(-2px,-1px,0)'},
            {opacity:1,backgroundColor:'transparent',transform:'translate3d(0,0,0)'}
          ],{duration:duration('table'),delay:Math.min(200,rowIndex*23+col*12)}))count++;
        }
      }
    }
    if(count)lastWave=token;
    return count;
  }
  function enterCards(view){
    const cards=Array.from(view.querySelectorAll(CARDS)).slice(0,64).filter(visible).slice(0,16);
    if(!cards.length)return 0;
    const origin=cards.reduce((p,el)=>{const b=el.getBoundingClientRect();return {x:Math.min(p.x,b.left),y:Math.min(p.y,b.top)};},{x:Infinity,y:Infinity});
    for(const el of cards){
      const rect=el.getBoundingClientRect();
      const delay=Math.min(210,(rect.left-origin.x)*.075+(rect.top-origin.y)*.10);
      animate(el,[{opacity:.58,transform:'translate3d(-5px,-3px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('card'),delay});
    }
    return cards.length;
  }
  function enterCharts(view){
    const bars=Array.from(view.querySelectorAll(BARS)).slice(0,56).filter(visible).slice(0,14);
    for(let i=0;i<bars.length;i++)animate(bars[i],[{opacity:.4,transform:'scaleX(.4)'},{opacity:1,transform:'scaleX(1)'}],{duration:duration('bar'),delay:i*19});
  }
  function enterPage(view){
    // The workspace stays still; animate only visible, lightweight page chrome.
    const header=view.querySelector('.ovDashboardToolbar,.workspaceContextBar,.bpaHero,.pricingWorkspaceHeader,.kolHeader,.psaHeader');
    if(visible(header))animate(header,[{opacity:.62,transform:'translate3d(0,5px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('page')});
    enterCards(view);enterCharts(view);
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
    later(()=>{if(token===generation&&visible(view))enterPage(view);},85);
    later(()=>{if(token===generation&&visible(view))waveTable(view,token);},185);
    // Initial async render can deliver the table after the first paint.
    later(()=>{if(token===generation&&visible(view))waveTable(view,token);},840);
  }
  function enterOverlay(){
    if(!enabled())return;
    const candidates=Array.from(doc.querySelectorAll(OVERLAYS)).filter(visible).slice(-4);
    const time=Date.now();
    for(const el of candidates){
      if(time-(overlays.get(el)||0)<700)continue;
      overlays.set(el,time);
      animate(el,[{opacity:.55,transform:'translate3d(0,7px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('overlay')});
    }
  }
  function play(kind,element){
    if(!element||!enabled())return null;
    if(kind==='card')return animate(element,[{opacity:.6,transform:'translate3d(-5px,-3px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('card')});
    if(kind==='overlay')return animate(element,[{opacity:.55,transform:'translate3d(0,7px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:duration('overlay')});
    if(kind==='refresh'||kind==='refresh-active')return animate(element,
      [{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],
      {duration:duration('card')*2,iterations:kind==='refresh-active'?8:2});
    if(kind==='sync'||kind==='sync-active')return animate(element,
      [{opacity:1,transform:'scale(1)'},{opacity:.48,transform:'scale(1.08)'},{opacity:1,transform:'scale(1)'}],
      {duration:duration('card')*2,iterations:kind==='sync-active'?8:2});
    return null;
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
    for(const [id,activeClass,kind] of [
      ['topRefreshBtn','spinning','refresh'],['serverRefreshBtn','spinning','refresh'],
      ['syncStatusBadge','is-syncing','sync']
    ]){
      const control=doc.getElementById?.(id);
      if(!control)continue;
      const update=()=>updateActivity(control,activeClass,kind);
      if(typeof root.MutationObserver==='function'){
        new root.MutationObserver(update).observe(control,{attributes:true,attributeFilter:['class']});
      }
      update();
    }
  }
  function setEnabled(value){
    html.dataset.blMotion=value?'on':'off';
    if(!value)cancelPending();
    else {
      activate(true);
      for(const [id,state,kind] of [
        ['topRefreshBtn','spinning','refresh'],['serverRefreshBtn','spinning','refresh'],
        ['syncStatusBadge','is-syncing','sync']
      ]){
        const el=doc.getElementById?.(id);
        if(el)updateActivity(el,state,kind);
      }
    }
  }
  function mount(){
    bindActivityControls();
    doc.addEventListener('click',ev=>{
      if(ev.target.closest?.('nav.tabs button[data-tab]'))later(()=>activate(true),45);
      else if(ev.target.closest?.('button,[role="button"]'))later(enterOverlay,65);
      const refresh=ev.target.closest?.(REFRESH_CONTROLS);
      const sync=ev.target.closest?.(SYNC_CONTROLS);
      const button=refresh||sync;
      if(button&&!button.disabled){
        const icon=button.querySelector?.('.ic')||button;
        play(refresh?'refresh':'sync',icon);
      }
    },true);
    if(typeof root.MutationObserver==='function'&&doc.body){
      new root.MutationObserver(()=>activate(false)).observe(doc.body,{attributes:true,attributeFilter:['data-active-tab']});
    }
    root.addEventListener?.('bl:startup-complete',()=>activate(true));
    root.addEventListener?.('bl:overview-motion-changed',()=>{if(enabled())activate(true);else cancelPending();});
    doc.addEventListener('visibilitychange',()=>{
      if(doc.visibilityState==='hidden')cancelPending();
      else for(const [id,state,kind] of [
        ['topRefreshBtn','spinning','refresh'],['serverRefreshBtn','spinning','refresh'],
        ['syncStatusBadge','is-syncing','sync']
      ]){
        const el=doc.getElementById?.(id);
        if(el)updateActivity(el,state,kind);
      }
    });
    const media=root.matchMedia?.('(prefers-reduced-motion: reduce)');
    media?.addEventListener?.('change',()=>{if(reduce())cancelPending();});
    activate(true);
  }
  root.BLMotionPlus=Object.freeze({enabled,play,activate,setEnabled,speeds:SPEED});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})(typeof window!=='undefined'?window:globalThis);
