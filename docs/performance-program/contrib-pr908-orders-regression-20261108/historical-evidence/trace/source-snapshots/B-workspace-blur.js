/* Shared Motion+ backdrop: survives overlay removal for the return to sharp. */
(function(){
  'use strict';
  const surfaces='.layoutControlOverlay,.ovHomeDrawerOverlay,.updateTestOverlay,.umDialogOverlay,.ocCompareOverlay,.bpaDrawerScrim,html[data-ui-system="manifest"] .warnOverlay,html[data-ui-system="manifest"] .globalSearchOverlay,html[data-ui-system="manifest"] .appBlockingOverlay,html[data-ui-system="manifest"] .accessAdminOverlay,html[data-ui-system="manifest"] .iamWizardOverlay,html[data-ui-system="manifest"] .awModalOverlay,html[data-ui-system="manifest"] .egHeadingOverlay,html[data-ui-system="manifest"] .ovCollectionScopeDrawerOverlay,html[data-ui-system="manifest"] .endeksmatikImportOverlay,html[data-ui-system="manifest"] .autoColumnsOverlay,html[data-ui-system="manifest"] .blSyncGuideOverlay,html[data-ui-system="manifest"] .sourceBackdrop,html[data-ui-system="manifest"] .kolSpreadsheetPasteOverlay,html[data-ui-system="manifest"] .lmScrim,html[data-ui-system="manifest"] .lflPortfolioModalBackdrop,html[data-ui-system="manifest"] .lflScenarioEditorBackdrop,html[data-ui-system="manifest"] .kolPeriodDrawerBackdrop,html[data-ui-system="manifest"] .blvFilterScrim,html[data-ui-system="manifest"] .blpOverlay,html[data-ui-system="manifest"] .blDetailDrawer.is-open .blDetailDrawerBackdrop,html[data-ui-system="manifest"] .cpaModalOverlay,html[data-ui-system="manifest"] .backlogDetailOverlay,html[data-ui-system="manifest"] .backlogDimAddOverlay,html[data-ui-system="manifest"] .autoModalOverlay,html[data-ui-system="manifest"] #_notesEditorModal[data-ui-migrated],html[data-ui-system="manifest"] .warnOverlay[data-ui-migrated]';
  const layer=document.createElement('div');layer.className='blWorkspaceBlur';layer.setAttribute('aria-hidden','true');document.body.append(layer);
  // Keep closed/hidden surfaces registered too: an ancestor can reveal them.
  const candidates=surfaces.replace(/html\[data-ui-system="manifest"\] /g,'').replace('.blDetailDrawer.is-open ','')+',dialog';
  const registered=new Set(document.querySelectorAll(candidates));
  const rail=document.querySelector('.rail');
  let queued=false;
  function sync(){
    queued=false;
    for(const el of registered)if(!el.isConnected)registered.delete(el);
    const open=[...registered].some(el=>{
      if(!el.matches(surfaces+',dialog[open]'))return false;
      // Closed detail drawers retain their backdrop node for reuse. Hidden
      // ancestors are not active surfaces even when geometry remains intact.
      if(el.hidden||el.closest('[hidden],[aria-hidden="true"],[inert]'))return false;
      const css=getComputedStyle(el);return css.display!=='none'&&css.visibility!=='hidden'&&el.getBoundingClientRect().width>0;
    });
    const expanded=document.documentElement.dataset.rail==='min'&&rail&&(rail.matches(':hover')||rail.classList.contains('railKeyboardOpen'));
    const state=open?'dialog':expanded?'rail':'';
    if(state&&layer.dataset.mode!==state)layer.dataset.mode=state;
    if(layer.dataset.blur!==state)layer.dataset.blur=state;
  }
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(sync);}};
  function affectsSurface(node){
    if(node.nodeType!==1)return false;
    if(node===rail||node.matches(candidates))return true;
    for(const el of registered)if(node.contains(el))return true;
    return false;
  }
  new MutationObserver(records=>{
    let changed=false;
    for(const record of records){
      if(affectsSurface(record.target))changed=true;
      if(record.type==='attributes'){
        if(record.target.matches(candidates))registered.add(record.target);
      }else if(record.type==='childList'){
        for(const node of record.addedNodes){
          if(node.nodeType!==1)continue;
          if(node.matches(candidates)){registered.add(node);changed=true;}
          for(const el of node.querySelectorAll(candidates)){registered.add(el);changed=true;}
        }
        for(const node of record.removedNodes)if(affectsSurface(node))changed=true;
      }
    }
    if(changed)schedule();
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','aria-hidden','style']});
  rail?.addEventListener('pointerenter',schedule);
  rail?.addEventListener('pointerleave',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-rail']});
  sync();
})();
