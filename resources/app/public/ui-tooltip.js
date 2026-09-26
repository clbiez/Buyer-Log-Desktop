/* Buyer Log · hızlı ipucu
   İkon-only araç çubuğu düğmeleri için: eylemin ADI (düğmenin gizli etiketi)
   kalın, açıklaması (title) altında. Tarayıcının ~1 sn gecikmeli yerel
   ipucu çift görünmesin diye title hover süresince data-tip-title'a alınır ve
   ayrılınca geri yazılır; i18n title'ı bu arada değiştirdiyse yenisi korunur.
   Klavye odağında da görünür; Escape kapatır. */
(function(){
  'use strict';
  if(typeof document==='undefined')return;
  const SELECTOR='.tableActionToolbar button:not(.primary):not(.tableSearchHelpButton):not(.toolbarMoreMenu *),#shipSecondaryToolbar button,.vfBar button:not(.toolbarMoreMenu *),[data-tip]';
  let tip=null,active=null,timer=0;

  function ensureTip(){
    if(tip)return tip;
    tip=document.createElement('div');
    tip.className='blTip';tip.setAttribute('role','tooltip');tip.hidden=true;
    document.body.appendChild(tip);
    return tip;
  }
  function labelOf(el){
    const explicit=el.getAttribute('data-tip');
    if(explicit)return explicit;
    const span=el.querySelector(':scope > span:not(.toolbarBadge)');
    const text=(span?span.textContent:el.textContent||'').replace(/\s+/g,' ').trim();
    return text.length>1?text:'';
  }
  function iconOnly(el){
    if(el.hasAttribute('data-tip'))return true;
    const style=getComputedStyle(el);
    return parseFloat(style.fontSize)===0||el.matches('[data-toolbar-compact] [data-tb-compact="icon"]');
  }
  function show(el){
    if(!iconOnly(el))return;
    const label=labelOf(el),title=el.getAttribute('title')||el.dataset.tipTitle||'';
    if(!label&&!title)return;
    if(el.hasAttribute('title')){el.dataset.tipTitle=title;el.removeAttribute('title');}
    const node=ensureTip();
    const detail=title&&title!==label?title:'';
    node.innerHTML='';
    if(label){const b=document.createElement('b');b.textContent=label;node.appendChild(b);}
    if(detail){const s=document.createElement('span');s.textContent=detail;node.appendChild(s);}
    node.hidden=false;
    const r=el.getBoundingClientRect(),w=node.offsetWidth,h=node.offsetHeight;
    let left=Math.round(r.left+r.width/2-w/2);
    left=Math.max(8,Math.min(left,window.innerWidth-w-8));
    let top=Math.round(r.bottom+8);
    if(top+h>window.innerHeight-8)top=Math.round(r.top-h-8);
    node.style.left=left+'px';node.style.top=top+'px';
    node.classList.add('isVisible');
    active=el;
  }
  function hide(){
    clearTimeout(timer);
    if(active){
      if(!active.hasAttribute('title')&&active.dataset.tipTitle)active.setAttribute('title',active.dataset.tipTitle);
      delete active.dataset.tipTitle;
    }
    active=null;
    if(tip){tip.classList.remove('isVisible');tip.hidden=true;}
  }
  function schedule(el,delay){
    clearTimeout(timer);
    if(active&&active!==el)hide();
    timer=setTimeout(()=>{if(el.isConnected)show(el);},delay);
  }
  document.addEventListener('pointerover',event=>{
    const el=event.target.closest&&event.target.closest(SELECTOR);
    if(!el||el===active)return;
    schedule(el,active?0:280);
  });
  document.addEventListener('pointerout',event=>{
    const el=event.target.closest&&event.target.closest(SELECTOR);
    if(!el||el.contains(event.relatedTarget))return;
    hide();
  });
  document.addEventListener('focusin',event=>{
    const el=event.target.closest&&event.target.closest(SELECTOR);
    if(el&&el.matches(':focus-visible'))schedule(el,120);
  });
  document.addEventListener('focusout',hide);
  document.addEventListener('pointerdown',hide,true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
  window.addEventListener('scroll',hide,true);
  window.addEventListener('resize',hide);
})();
