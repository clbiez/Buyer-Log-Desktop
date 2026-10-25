(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.BLLayerSystem=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';

  const dialogState=new WeakMap();
  const menuState=new WeakMap();
  const openDialogs=new Set();
  const defer=typeof queueMicrotask==='function'?queueMicrotask:callback=>Promise.resolve().then(callback);
  const focusableSelector='button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function nextMenuIndex(current,length,key){
    if(!Number.isInteger(current)||length<1)return null;
    if(key==='Home')return 0;
    if(key==='End')return length-1;
    if(key==='ArrowDown')return (current+1)%length;
    if(key==='ArrowUp')return (current-1+length)%length;
    return null;
  }

  function isAvailable(item){
    if(!item||item.isConnected===false||item.disabled||item.matches?.(':disabled')||item.getAttribute?.('aria-disabled')==='true')return false;
    const view=item.ownerDocument?.defaultView;
    for(let node=item;node;node=node.parentElement||node.getRootNode?.().host){
      if(node.hidden||node.inert||node.getAttribute?.('aria-hidden')==='true')return false;
      const style=view?.getComputedStyle?.(node);
      if(style&&(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.contentVisibility==='hidden'))return false;
    }
    return !item.getClientRects||item.getClientRects().length>0;
  }

  function focusableElements(container){
    if(!container?.querySelectorAll)return [];
    return [...container.querySelectorAll(focusableSelector)].filter(item=>isAvailable(item)&&item.tabIndex>=0)
      .sort((a,b)=>(a.tabIndex||Infinity)-(b.tabIndex||Infinity));
  }

  function topDialog(doc){
    return [...openDialogs].reverse().find(overlay=>overlay.ownerDocument===doc&&isAvailable(overlay));
  }

  function isTopDialog(overlay){
    const doc=overlay.ownerDocument;
    if(topDialog(doc)!==overlay)return false;
    // Native top-layer dialogs can be opened by consumers outside this helper.
    // Their own browser focus/cancel behavior must win over a background layer.
    const native=[...doc.querySelectorAll('dialog[open]')].filter(node=>node.matches(':modal')).pop();
    return !native||native===dialogState.get(overlay)?.dialog||native.contains(overlay);
  }

  function syncBodyLock(doc){
    doc?.body?.classList?.toggle('blDialogOpen',openDialogs.size>0);
  }

  // Dialogs occupy the token-defined modal band; menus/toasts stay above it.
  function dialogCeiling(view,doc){
    const menu=Number.parseInt(view.getComputedStyle(doc.documentElement).getPropertyValue('--ui-z-modal-menu'),10);
    return Number.isFinite(menu)?menu-1:299;
  }

  function topDialogZIndex(exclude){
    const doc=exclude?.ownerDocument||(typeof document!=='undefined'?document:null);
    const view=doc?.defaultView;
    if(!doc?.body||!view?.getComputedStyle)return 0;
    let top=0;
    for(const node of [...doc.body.children]){
      if(node===exclude||!node.isConnected)continue;
      if(node.hidden||node.getAttribute?.('aria-hidden')==='true')continue;
      if(!(node.matches?.('[role="dialog"]')||node.querySelector?.('[role="dialog"]')))continue;
      const style=view.getComputedStyle(node);
      if(!style||style.display==='none'||style.visibility==='hidden')continue;
      const z=Number.parseInt(style.zIndex,10);
      if(Number.isFinite(z)&&z>top)top=z;
    }
    return top;
  }

  /* Yalnız GEREKİYORSA yükseltir: katmanın kendi z-index'i zaten üsttiyse
     satır içi stil yazılmaz, tema/CSS sahipliği bozulmaz. */
  function elevateOverlay(overlay){
    const doc=overlay?.ownerDocument,view=doc?.defaultView;
    if(!view?.getComputedStyle)return false;
    const top=topDialogZIndex(overlay);
    if(!top)return false;
    const own=Number.parseInt(view.getComputedStyle(overlay).zIndex,10);
    if(Number.isFinite(own)&&own>top)return false;
    overlay.style.zIndex=String(Math.min(dialogCeiling(view,doc),top+1));
    return true;
  }

  function resolveInitialFocus(dialog,requested){
    if(requested?.focus&&dialog.contains(requested)&&isAvailable(requested))return requested;
    if(typeof requested==='string'){
      const match=dialog.querySelector(requested);
      if(isAvailable(match))return match;
    }
    for(const selector of ['[autofocus]','input:not([type="hidden"]),select,textarea','[data-bl-dialog-fallback]']){
      const candidate=[...dialog.querySelectorAll(selector)].find(isAvailable);
      if(candidate)return candidate;
    }
    return focusableElements(dialog)[0]||dialog;
  }

  // The same Tab contract also serves older overlays at the document boundary.
  // It never closes a dialog or invokes a save/cancel action.
  function trapDialogTab(dialog,event){
    if(!dialog||event.defaultPrevented||event.key!=='Tab')return;
    const doc=dialog.ownerDocument;
    const items=focusableElements(dialog);
    if(!items.length){event.preventDefault();dialog.focus?.();return;}
    const current=items.indexOf(doc.activeElement);
    if(event.shiftKey&&current<=0){event.preventDefault();items[items.length-1].focus();}
    else if(!event.shiftKey&&(current<0||current===items.length-1)){event.preventDefault();items[0].focus();}
    else{
      // aria-hidden/aria-disabled controls remain in native Tab order.
      // Intercept only when such an excluded control lies on this step;
      // otherwise keep the browser's radio/shadow/control navigation.
      const all=[...dialog.querySelectorAll(focusableSelector)].filter(item=>item.tabIndex>=0)
        .sort((a,b)=>(a.tabIndex||Infinity)-(b.tabIndex||Infinity));
      const nativeNext=all[all.indexOf(doc.activeElement)+(event.shiftKey?-1:1)];
      if(nativeNext&&!isAvailable(nativeNext)){event.preventDefault();items[current+(event.shiftKey?-1:1)].focus();}
    }
  }

  function openDialog(overlay,options={}){
    if(!overlay?.querySelector)return null;
    if(dialogState.has(overlay))return dialogState.get(overlay).dialog;
    const dialog=overlay.matches?.('dialog,[role="dialog"]')?overlay:overlay.querySelector('dialog,[role="dialog"]');
    if(!dialog)return null;
    const doc=overlay.ownerDocument||dialog.ownerDocument;
    const active=doc?.activeElement;
    const returnTarget=options.trigger?.focus?options.trigger:(active&&active!==doc?.body?active:null);
    const state={dialog,returnTarget,onClose:typeof options.onClose==='function'?options.onClose:null,onKeydown:null};
    state.onKeydown=event=>{
      if(!isTopDialog(overlay))return;
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();
        state.onClose?.();
        return;
      }
      trapDialogTab(dialog,event);
    };
    dialog.setAttribute('aria-modal','true');
    if(!dialog.hasAttribute('tabindex'))dialog.setAttribute('tabindex','-1');
    overlay.setAttribute('data-bl-layer','dialog');
    overlay.addEventListener('keydown',state.onKeydown);
    state.elevated=options.elevate!==false&&elevateOverlay(overlay);
    dialogState.set(overlay,state);openDialogs.add(overlay);syncBodyLock(doc);
    defer(()=>{if(dialogState.get(overlay)===state&&isTopDialog(overlay))resolveInitialFocus(dialog,options.initialFocus)?.focus?.();});
    return dialog;
  }

  function closeDialog(overlay,options={}){
    const state=overlay&&dialogState.get(overlay);if(!state)return;
    overlay.removeEventListener('keydown',state.onKeydown);
    if(state.elevated)overlay.style.zIndex='';
    dialogState.delete(overlay);openDialogs.delete(overlay);syncBodyLock(overlay.ownerDocument||state.dialog.ownerDocument);
    const shouldRestore=options.restoreFocus!==false;
    defer(()=>{const top=topDialog(state.dialog.ownerDocument);if(shouldRestore&&isAvailable(state.returnTarget)&&(!top||dialogState.get(top).dialog.contains(state.returnTarget)))state.returnTarget.focus?.();});
  }

  function menuItems(menu){
    if(!menu?.querySelectorAll)return [];
    const candidates=[...menu.querySelectorAll('[role="menuitem"],button,a[href]')]
      .filter(item=>item.closest?.('[role="menu"]')===menu||!item.closest?.('[role="menu"]'));
    candidates.forEach(item=>item.setAttribute('role','menuitem'));
    return candidates.filter(isAvailable);
  }

  function setMenuTabStop(items,active){
    items.forEach(item=>item.setAttribute('tabindex',item===active?'0':'-1'));
  }

  function openMenu(menu,options={}){
    if(!menu?.addEventListener)return null;
    if(menuState.has(menu))return menu;
    const doc=menu.ownerDocument;
    const active=doc?.activeElement;
    const returnTarget=options.trigger?.focus?options.trigger:(active&&active!==doc?.body?active:null);
    menu.setAttribute('role','menu');menu.setAttribute('data-bl-layer','menu');
    if(options.label&&!menu.hasAttribute('aria-label'))menu.setAttribute('aria-label',options.label);
    const items=menuItems(menu);if(items.length)setMenuTabStop(items,items[0]);
    const state={returnTarget,onClose:typeof options.onClose==='function'?options.onClose:null,onKeydown:null};
    state.onKeydown=event=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();state.onClose?.();return;
      }
      const available=menuItems(menu);if(!available.length)return;
      const current=Math.max(0,available.indexOf(doc.activeElement));
      const index=nextMenuIndex(current,available.length,event.key);if(index==null)return;
      event.preventDefault();event.stopPropagation();setMenuTabStop(available,available[index]);available[index].focus();
    };
    menu.addEventListener('keydown',state.onKeydown);menuState.set(menu,state);
    defer(()=>{if(menu.isConnected!==false)items[0]?.focus?.();});
    return menu;
  }

  function closeMenu(menu,options={}){
    const state=menu&&menuState.get(menu);if(!state)return;
    menu.removeEventListener('keydown',state.onKeydown);menuState.delete(menu);
    const shouldRestore=options.restoreFocus!==false;
    defer(()=>{if(shouldRestore&&state.returnTarget&&state.returnTarget.isConnected!==false)state.returnTarget.focus?.();});
  }

  return {trapDialogTab,nextMenuIndex,focusableElements,menuItems,openDialog,closeDialog,openMenu,closeMenu,topDialogZIndex};
});
