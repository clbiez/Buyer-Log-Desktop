/* Small delegated entry points; module code registers its own handlers on load. */
(function(global){
  'use strict';
  let openingImport=false;
  document.addEventListener('click',async event=>{
    const trigger=event.target.closest?.('[data-excel-import]');
    if(!trigger||global.BLExcelImportWizard)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(openingImport)return;
    openingImport=true;trigger.setAttribute('aria-busy','true');
    try{
      await global.BLPerf.ensureFeature('excelImport');
      await global.BLExcelImportWizard.open(trigger.dataset.excelImport);
    }catch(error){global.showToast?.(error.message);}
    finally{openingImport=false;trigger.removeAttribute('aria-busy');}
  },true);
})(window);
