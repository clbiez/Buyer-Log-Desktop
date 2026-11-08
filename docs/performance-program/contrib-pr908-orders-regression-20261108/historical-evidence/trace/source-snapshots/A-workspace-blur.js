/* Shared Motion+ backdrop: survives overlay removal for the return to sharp. */
(function(){
  'use strict';
  const surfaces='.layoutControlOverlay,.ovHomeDrawerOverlay,.updateTestOverlay,.umDialogOverlay,.ocCompareOverlay,.bpaDrawerScrim,html[data-ui-system="manifest"] .warnOverlay,html[data-ui-system="manifest"] .globalSearchOverlay,html[data-ui-system="manifest"] .appBlockingOverlay,html[data-ui-system="manifest"] .accessAdminOverlay,html[data-ui-system="manifest"] .iamWizardOverlay,html[data-ui-system="manifest"] .awModalOverlay,html[data-ui-system="manifest"] .egHeadingOverlay,html[data-ui-system="manifest"] .ovCollectionScopeDrawerOverlay,html[data-ui-system="manifest"] .endeksmatikImportOverlay,html[data-ui-system="manifest"] .autoColumnsOverlay,html[data-ui-system="manifest"] .blSyncGuideOverlay,html[data-ui-system="manifest"] .sourceBackdrop,html[data-ui-system="manifest"] .kolSpreadsheetPasteOverlay,html[data-ui-system="manifest"] .lmScrim,html[data-ui-system="manifest"] .lflPortfolioModalBackdrop,html[data-ui-system="manifest"] .lflScenarioEditorBackdrop,html[data-ui-system="manifest"] .kolPeriodDrawerBackdrop,html[data-ui-system="manifest"] .blvFilterScrim,html[data-ui-system="manifest"] .blpOverlay,html[data-ui-system="manifest"] .blDetailDrawer.is-open .blDetailDrawerBackdrop,html[data-ui-system="manifest"] .cpaModalOverlay,html[data-ui-system="manifest"] .backlogDetailOverlay,html[data-ui-system="manifest"] .backlogDimAddOverlay,html[data-ui-system="manifest"] .autoModalOverlay,html[data-ui-system="manifest"] #_notesEditorModal[data-ui-migrated],html[data-ui-system="manifest"] .warnOverlay[data-ui-migrated]';
  const layer=document.createElement('div');layer.className='blWorkspaceBlur';layer.setAttribute('aria-hidden','true');document.body.append(layer);
  let queued=false;
  function sync(){
    queued=false;
    const open=[...document.querySelectorAll(surfaces+',dialog[open]')].some(el=>{
      // Closed detail drawers retain their backdrop node for reuse. Hidden
      // ancestors are not active surfaces even when geometry remains intact.
      if(el.hidden||el.closest('[hidden],[aria-hidden="true"],[inert]'))return false;
      const css=getComputedStyle(el);return css.display!=='none'&&css.visibility!=='hidden'&&el.getBoundingClientRect().width>0;
    });
    const rail=document.querySelector('.rail');
    const expanded=document.documentElement.dataset.rail==='min'&&rail&&(rail.matches(':hover')||rail.classList.contains('railKeyboardOpen'));
    const state=open?'dialog':expanded?'rail':'';
    if(state&&layer.dataset.mode!==state)layer.dataset.mode=state;
    if(layer.dataset.blur!==state)layer.dataset.blur=state;
  }
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(sync);}};
  new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','open','aria-hidden','style']});
  document.querySelector('.rail')?.addEventListener('pointerenter',schedule);
  document.querySelector('.rail')?.addEventListener('pointerleave',schedule);
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',schedule);
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-rail']});
  sync();
})();
