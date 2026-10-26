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

  function persistenceView(status,options={}){
    const en=options.language==='en';
    const labels={draft:en?'Draft secured locally · not saved to server':'Yerel taslak korundu · sunucuya kaydedilmedi',local:en?'Saved on this device':'Bu cihazda kaydedildi',sending:en?'Local edit secured · saving':'Yerel giriş korundu · kaydediliyor',pending:en?'Saved on this device · Sharing pending':'Bu cihazda kaydedildi · Paylaşım bekliyor',conflict:en?'Conflict · local edit preserved':'Çakışma · yerel giriş korundu',failed:en?'Save failed · retry required':'Kayıt başarısız · yeniden deneyin'};
    const kind=status==='failed'?'error':status==='conflict'?'warning':'info';
    return `<span class="uiPersistence uiPersistence--${kind}" role="${kind==='error'?'alert':'status'}" aria-live="${kind==='error'?'assertive':'polite'}" data-persistence-state="${escapeHtml(status)}"><b>${escapeHtml(labels[status]||labels.pending)}</b>${options.detail?`<span>${escapeHtml(options.detail)}</span>`:''}</span>`;
  }

  function progressView(options={}){
    const total=Math.max(1,Number(options.total)||1),completed=Math.max(0,Math.min(total,Number(options.completed)||0)),label=escapeHtml(options.label||'');
    return `<div class="uiProgress" role="status" aria-live="polite" aria-atomic="true"><span data-ui-progress-label>${label}</span><progress max="${total}"${options.indeterminate?'':` value="${completed}"`} aria-label="${label}"></progress><small data-ui-progress-units${options.indeterminate?' hidden':''}>${completed} / ${total}</small><button type="button" class="navActionBtn" data-ui-progress-cancel${options.cancellable?'':' hidden'}>${options.language==='en'?'Cancel':'İptal'}</button></div>`;
  }

  function renderProgress(target,options={}){
    if(!target)return;
    if(!target.querySelector('.uiProgress'))target.innerHTML=progressView(options);
    const total=Math.max(1,Number(options.total)||1),completed=Math.max(0,Math.min(total,Number(options.completed)||0)),progress=target.querySelector('progress');
    target.querySelector('[data-ui-progress-label]').textContent=options.label||'';
    progress.max=total;progress.setAttribute('aria-label',options.label||'');
    if(options.indeterminate)progress.removeAttribute('value');else progress.value=completed;
    const units=target.querySelector('[data-ui-progress-units]');units.hidden=!!options.indeterminate;units.textContent=completed+' / '+total;
    target.hidden=false;
    const cancel=target.querySelector('[data-ui-progress-cancel]');
    cancel.hidden=!options.cancellable;cancel.textContent=options.language==='en'?'Cancel':'İptal';cancel.onclick=options.onCancel||null;
  }

  function createProgress({total=1,onProgress=()=>{},yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
    const controller=new AbortController();let completed=0;
    total=Math.max(1,Math.floor(Number(total)||1));
    const check=()=>{if(controller.signal.aborted){const error=new Error('Export cancelled');error.name='AbortError';throw error;}};
    return {signal:controller.signal,cancel:()=>controller.abort(),check,
      checkpoint(value,label,options={}){check();completed=Math.max(completed,Math.min(total,Math.max(0,Math.floor(Number(value)||0))));onProgress({completed,total,label,...options});},
      async yield(){check();await yieldTask();check();}
    };
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
    let liveOptions={...options,kind};
    let liveMessage=message;
    const template=document.createElement('template');
    template.innerHTML=feedbackView(liveMessage,liveOptions);
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

    item.addEventListener('click',event=>{
      const closer=event.target.closest('[data-ui-feedback-close]');
      if(closer&&item.contains(closer)){close();return;}
      const btn=event.target.closest('[data-ui-feedback-action]');
      if(!btn||!item.contains(btn)||btn.disabled)return;
      if(typeof liveOptions.onAction!=='function')return;
      const id=btn.dataset.uiFeedbackAction;
      btn.disabled=true;
      Promise.resolve().then(()=>liveOptions.onAction(id,{close}))
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
    const update=(nextMessage,nextOptions={})=>{
      if(closed)return close;
      liveMessage=nextMessage;
      liveOptions={...liveOptions,...nextOptions};
      liveOptions.kind=normalizeKind(liveOptions.kind);
      const nextTemplate=document.createElement('template');
      nextTemplate.innerHTML=feedbackView(liveMessage,liveOptions);
      const fresh=nextTemplate.content.firstElementChild;
      if(!fresh)return close;
      const wasIn=item.classList.contains('isIn');
      item.className=fresh.className;
      if(wasIn)item.classList.add('isIn');
      ['data-kind','role','aria-live','aria-atomic','aria-busy'].forEach(name=>{
        if(fresh.hasAttribute(name))item.setAttribute(name,fresh.getAttribute(name));
        else item.removeAttribute(name);
      });
      item.innerHTML=fresh.innerHTML;
      return close;
    };
    close.update=update;
    close.element=item;
    item._uiFeedbackClose=close;
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>item.classList.add('isIn'));
    else item.classList.add('isIn');
    schedule();
    return close;
  }

  /* Ortak durum işareti — eski orbHtml kancası korunur. */
  function orbHtml(state='idle',size=''){
    const kind=['idle','thinking','warn','done'].includes(state)?state:'idle';
    return `<span class="blOrb${size?` blOrb--${escapeHtml(size)}`:''}" data-state="${kind}" aria-hidden="true"></span>`;
  }

  // Shared modal keyboard behavior; close callbacks retain their validation/save rules.
  function bindDialogKeyboard(dialog,options={}){
    if(!dialog||typeof document==='undefined')return()=>{};
    const previous=document.activeElement;
    const controls=()=>[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility());
    const keydown=event=>{
      if(event.defaultPrevented)return;
      if(event.key==='Escape'&&options.onEscape){event.preventDefault();options.onEscape();return;}
      if(event.key!=='Tab')return;
      const list=controls(),first=list[0],last=list.at(-1);if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    dialog.addEventListener('keydown',keydown);
    controls()[0]?.focus();
    return()=>{dialog.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus();};
  }

  return Object.freeze({STATE_KINDS,bindDialogKeyboard,orbHtml,stateView,renderState,persistenceView,progressView,renderProgress,createProgress,feedbackDuration,feedbackView,notify});
});
