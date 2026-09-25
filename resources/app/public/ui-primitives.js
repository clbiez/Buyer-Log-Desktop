(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLUI=Object.assign(root.BLUI||{},api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const STATE_KINDS=Object.freeze(['loading','empty','info','success','warning','error']);
  const STATE_ICONS=Object.freeze({
    loading:'refresh',empty:'database-import',info:'notebook',success:'check',warning:'binary-tree-2',error:'cloud-off',
  });
  const FEEDBACK_LABELS=Object.freeze({
    loading:'İşleniyor',empty:'Sonuç yok',info:'Bilgi',success:'Tamamlandı',warning:'Dikkat',error:'Hata',
  });
  const FEEDBACK_LABELS_EN=Object.freeze({
    loading:'In progress',empty:'No results',info:'Information',success:'Completed',warning:'Attention',error:'Error',
  });
  const FEEDBACK_DURATIONS=Object.freeze({loading:0,empty:6000,info:4500,success:4500,warning:8000,error:10000});
  const MAX_FEEDBACK_ITEMS=4;

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    })[char]);
  }

  function stateView(options={}){
    const kind=STATE_KINDS.includes(options.kind)?options.kind:'info';
    const role=kind==='error'?'alert':'status';
    const icon=escapeHtml(options.icon||STATE_ICONS[kind]);
    const title=escapeHtml(options.title||'');
    const detail=escapeHtml(options.detail||'');
    const action=options.actionLabel
      ?`<button type="button" class="navActionBtn uiStateAction${options.actionPrimary?' primary':''}" data-ui-state-action>${escapeHtml(options.actionLabel)}</button>`:'';
    const visual=kind==='loading'
      ?'<span class="uiStateSpinner blOrb uiStateOrb" data-state="thinking" aria-hidden="true"></span>'
      :`<svg class="ic uiStateIcon" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
    return `<div class="uiState uiState--${kind}" role="${role}" aria-live="${kind==='error'?'assertive':'polite'}" aria-atomic="true"${kind==='loading'?' aria-busy="true"':''}>${visual}<div class="uiStateBody"><b>${title}</b>${detail?`<span>${detail}</span>`:''}${action}</div></div>`;
  }

  function renderState(target,options={}){
    const element=typeof target==='string'&&typeof document!=='undefined'?document.querySelector(target):target;
    if(!element)return null;
    element.innerHTML=stateView(options);
    element.dataset.uiState=STATE_KINDS.includes(options.kind)?options.kind:'info';
    if(element.dataset.uiState==='loading')element.setAttribute('aria-busy','true');
    else element.removeAttribute('aria-busy');
    const action=element.querySelector('[data-ui-state-action]');
    if(action&&typeof options.onAction==='function')action.addEventListener('click',options.onAction,{once:options.actionOnce!==false});
    return element.firstElementChild;
  }

  function normalizeKind(kind){
    return STATE_KINDS.includes(kind)?kind:'info';
  }

  function feedbackDuration(kind,customDuration){
    const custom=Number(customDuration);
    if(customDuration!==undefined&&customDuration!==null&&Number.isFinite(custom)&&custom>=0)return custom;
    return FEEDBACK_DURATIONS[normalizeKind(kind)];
  }

  function feedbackView(message,options={}){
    const kind=normalizeKind(options.kind);
    const role=kind==='error'?'alert':'status';
    const icon=escapeHtml(options.icon||STATE_ICONS[kind]);
    const english=options.language==='en';
    const label=escapeHtml(options.kindLabel||(english?FEEDBACK_LABELS_EN:FEEDBACK_LABELS)[kind]);
    const text=escapeHtml(message);
    const closeLabel=escapeHtml(options.closeLabel||(english?'Close':'Kapat'));
    const visual=options.icon===false
      ?''
      :(kind==='loading'
        ?'<span class="uiFeedbackSpinner" aria-hidden="true"></span>'
        :`<svg class="ic uiFeedbackIcon" aria-hidden="true"><use href="#i-${icon}"/></svg>`);
    const close=options.dismissible===false?'':`<button type="button" class="uiFeedbackClose" data-ui-feedback-close aria-label="${closeLabel}" title="${closeLabel}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`;
    const detailText=options.detail?escapeHtml(options.detail):'';
    const detail=detailText?`<span class="uiFeedbackDetail">${detailText}</span>`:'';
    const actionsList=Array.isArray(options.actions)?options.actions:[];
    const actions=actionsList.length?`<div class="uiFeedbackActions">${actionsList.map(a=>`<button type="button" class="navActionBtn uiFeedbackAction${a.primary?' primary':''}" data-ui-feedback-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`:'';
    return `<div class="uiFeedback uiFeedback--${kind}" data-ui-feedback data-kind="${kind}" role="${role}" aria-live="${kind==='error'?'assertive':'polite'}" aria-atomic="true"${kind==='loading'?' aria-busy="true"':''}>${visual}<div class="uiFeedbackCopy"><span class="uiFeedbackKind">${label}</span><span class="uiFeedbackMessage">${text}</span>${detail}${actions}</div>${close}</div>`;
  }

  function feedbackHost(placement){
    if(typeof document==='undefined'||!document.body)return null;
    let host=document.querySelector(`[data-ui-feedback-region="${placement}"]`);
    if(host)return host;
    host=document.createElement('div');
    host.className=`uiFeedbackRegion uiFeedbackRegion--${placement}`;
    host.dataset.uiFeedbackRegion=placement;
    host.setAttribute('aria-label',placement==='center'?'Önemli bildirimler':'Bildirimler');
    document.body.appendChild(host);
    return host;
  }

  function notify(message,options={}){
    if(typeof document==='undefined')return function closeFeedback(){};
    const kind=normalizeKind(options.kind);
    const placement=options.placement==='center'?'center':'edge';
    const host=feedbackHost(placement);
    if(!host)return function closeFeedback(){};
    const template=document.createElement('template');
    template.innerHTML=feedbackView(message,{...options,kind});
    const item=template.content.firstElementChild;
    if(!item)return function closeFeedback(){};

    let timer=null;
    let remaining=feedbackDuration(kind,options.duration);
    const persistent=remaining===0;
    let startedAt=0;
    let pointerPaused=false;
    let focusPaused=false;
    let closed=false;

    const remove=()=>{
      clearTimeout(timer);
      document.removeEventListener('keydown',onDocumentKeydown);
      item.remove();
      if(!host.children.length)host.remove();
    };
    const close=({immediate=false}={})=>{
      if(closed)return;
      closed=true;
      clearTimeout(timer);
      document.removeEventListener('keydown',onDocumentKeydown);
      if(immediate){remove();return;}
      item.classList.add('isLeaving');
      setTimeout(remove,160);
    };
    const schedule=()=>{
      if(closed||pointerPaused||focusPaused)return;
      if(persistent)return;
      if(remaining<=0){close();return;}
      startedAt=Date.now();
      timer=setTimeout(()=>close(),remaining);
    };
    const pause=()=>{
      if(!timer)return;
      clearTimeout(timer);
      timer=null;
      remaining=Math.max(0,remaining-(Date.now()-startedAt));
    };
    const resume=()=>{
      if(!pointerPaused&&!focusPaused)schedule();
    };
    const onDocumentKeydown=event=>{
      if(placement==='center'&&event.key==='Escape'&&host.lastElementChild===item)close();
    };

    item.querySelector('[data-ui-feedback-close]')?.addEventListener('click',()=>close());
    item.addEventListener('click',event=>{
      const btn=event.target.closest('[data-ui-feedback-action]');
      if(!btn||!item.contains(btn)||btn.disabled)return;
      if(typeof options.onAction!=='function')return;
      const id=btn.dataset.uiFeedbackAction;
      btn.disabled=true;
      Promise.resolve().then(()=>options.onAction(id,{close}))
        .catch(err=>{console.warn('uiFeedback action failed:',err);})
        .finally(()=>{btn.disabled=false;});
    });
    item.addEventListener('pointerenter',()=>{pointerPaused=true;pause();});
    item.addEventListener('pointerleave',()=>{pointerPaused=false;resume();});
    item.addEventListener('focusin',()=>{focusPaused=true;pause();});
    item.addEventListener('focusout',event=>{if(item.contains(event.relatedTarget))return;focusPaused=false;resume();});
    if(placement==='center')document.addEventListener('keydown',onDocumentKeydown);

    host.appendChild(item);
    while(host.children.length>MAX_FEEDBACK_ITEMS){
      const oldest=host.firstElementChild;
      if(oldest===item)break;
      if(typeof oldest._uiFeedbackClose==='function')oldest._uiFeedbackClose({immediate:true});
      else oldest.remove();
    }
    item._uiFeedbackClose=close;
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>item.classList.add('isIn'));
    else item.classList.add('isIn');
    schedule();
    return close;
  }

  /* Thinking Orb işaretlemesi — durum: idle | thinking | warn | done. */
  function orbHtml(state='idle',size=''){
    const kind=['idle','thinking','warn','done'].includes(state)?state:'idle';
    return `<span class="blOrb${size?` blOrb--${escapeHtml(size)}`:''}" data-state="${kind}" aria-hidden="true"></span>`;
  }

  return Object.freeze({STATE_KINDS,orbHtml,stateView,renderState,feedbackDuration,feedbackView,notify});
});
