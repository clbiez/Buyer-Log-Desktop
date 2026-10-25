'use strict';
const fs=require('node:fs'),path=require('node:path');
const cases=[
 ['horizon-name','_horizonTextInputModal',"void openHorizonTextInput({title:'DEMO · Ufuk',label:'Ad',initial:'Triko / 2026'})",'cp'],
 ['column-name','_columnNameModal',"void openColumnNameDialog({title:'Sütun adı',initial:{tr:'Kontrol tarihi',en:'Review date'}})",'cp'],
 ['source-required','_sourceFilterRequiredModal',"showSourceFilterRequiredNotice({missingTargets:['cp']},'DEMO · Filtre seçimi gerekli')",'cp'],
 ['landed-defaults','_landedMultipliersModal','openLandedMultipliersModal()','koleksiyon'],
 ['warning-list','warnOverlay',"appWarnings=['DEMO · Kontrol için bekleyen kayıt'];showWarnDetails()",'cp'],
 ['refresh-history','_refreshSummaryModal',"renderSourceRefreshHistoryModal([],null)",'cp'],
 ['refresh-error','sourceRefreshFailureModal',"showSourceRefreshFailureModal('DEMO · Veri kaynağına ulaşılamadı.')",'cp'],
 ['browser-settings','_browserDebugSettingsModal','void openBrowserDebugSettingsModal()','source'],
 ['sync-status','_syncStatusModal','void openSyncStatusModal()','source'],
 ['backlog-export-fields','backlogExportColumnsModal','openBacklogExportColumns()','backlog'],
 ['pricing-export-fields','kolPricingExcelColsModal','openKolPricingExcelColumnsModal()','koleksiyon'],
 ['index-model','_endeksmatikModal','void openEndeksmatikModal({row:kolRows[0]})','koleksiyon'],
 ['index-sets','_endeksmatikSetsModal','void openEndeksmatikSetManager()','koleksiyon'],
 ['collection-quick-filters','_kolQuickFiltersModal','openKolQuickFiltersEditor()','koleksiyon'],
 ['import-plan','_kolImportPlanModal',"void showKolImportPlanModal({updates:[{parsed:{plmId:'100001',modelKod:'DEMO-TRIKO-001'},changes:[{label:'Adet',from:'1200',to:'2400'}]}],creates:[{plmId:'100002',modelKod:'DEMO-TRIKO-002'}],unchanged:[]})",'koleksiyon'],
 ['plm-import','_kolPlmImportModal',"void showKolPlmImportPreview({existing:[],creates:[{}],ambiguous:[],inputDuplicates:[]},{mapped:['plmId','modelKod']},{suggestions:[],matchedPlm:1},0,'DEMO · PLM')",'koleksiyon'],
 ['fabric-card','_kolFabricCardModal',"openFabricCardDialog('DEMO-ÖRGÜ, pamuk',{collection:true,linkRowId:kolRows[0].id})",'koleksiyon'],
 ['fabric-batch','_kolFabricBatchModal',"void showKolFabricBatchPreview([{code:'FAB-001',raw:'FAB-001, cotton'}],{aiCount:0,cards:{'FAB-001':{summary:'Pamuk triko',summaryEn:'Cotton knit',summarySource:'rule',details:{}}}})",'koleksiyon'],
 ['plm-list','_kolPlmListModal',"void showKolPlmListImportDialog({initialIds:['100001','100002']})",'koleksiyon'],
 ['plm-columns','_plmSyncColumnModal',"void showPlmSyncColumnChooser('all',[{key:'fabric',label:'Fabric',models:2,changeCount:2}])",'koleksiyon'],
 ['plm-preview','_plmSyncPreviewModal',"void showPlmSyncPreview('all',{changed:[],checked:2,unchanged:[{},{}],notFound:[],errors:[]})",'koleksiyon'],
 ['image-source','_modelImageUpdateModal','openModelImageSourceChooser()','koleksiyon'],
 ['plm-language','_plmSyncLangModal','void showPlmSyncLanguageChooser()','koleksiyon'],
 ['plm-properties','_plmSyncPropertyModal','void showPlmSyncPropertyChooser()','koleksiyon'],
 ['recycle-bin','_kolBinModal','void openKolRecycleBin()','koleksiyon'],
 ['pricing-results','kolPricingResultModal',"kolShowPricingDraftResults([{ok:false,supplier:'DEMO Üretici',error:'DEMO · E-posta taslağı oluşturulamadı.'}],'DEMO · Eksik alıcı','Send to Pricing')",'koleksiyon'],
 ['model-files','kolModelFilesModal','openKolModelFilesModal()','koleksiyon'],
];
(async()=>{
 const out=path.resolve(process.env.BL_MATRIX_OUT||'docs/ai/ui-rebuild/phase-3/matrix/rare');fs.mkdirSync(out,{recursive:true});const file=path.join(out,'capture.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{screens:[],keyboard:[],errors:[],setupFailures:[]};
 const {browser,context,page,tab}=await require('./matrix-commercial-fixture.cjs')();const shot=require('./matrix-shot.cjs')({page,out,report});const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
 page.on('pageerror',e=>{report.errors.push(e.message);save();});
 const reset=async()=>{await page.reload({waitUntil:'domcontentloaded'});await page.getByText("Buyer Log'a devam et",{exact:false}).click({timeout:60000});await page.waitForFunction(()=>!document.getElementById('blBootGuard'));await page.waitForTimeout(1500);await page.locator('[data-rn-close]').first().click({timeout:500}).catch(()=>{});};
 for(const [name,id,open,key] of cases){
  if(process.env.BL_RARE_ONLY&&!new RegExp(process.env.BL_RARE_ONLY).test(name))continue;
  if(report.screens.filter(s=>s.family===name).length===24)continue;
  try{
   await tab(key);await page.evaluate(s=>{(0,eval)(s);},open);await page.locator('#'+id).waitFor({timeout:10000});await page.waitForTimeout(350);
   await shot(name);
   const controls=await page.locator('#'+id).evaluate(e=>{const a=BLLayerSystem.focusableElements(e);a.at(-1)?.focus();return a.length;});
   let forward=null,backward=null;if(controls){await page.keyboard.press('Tab');forward=await page.locator('#'+id).evaluate(e=>e.contains(document.activeElement));await page.locator('#'+id).evaluate(e=>BLLayerSystem.focusableElements(e)[0]?.focus());await page.keyboard.press('Shift+Tab');backward=await page.locator('#'+id).evaluate(e=>e.contains(document.activeElement));}
   await page.keyboard.press('Escape');await page.waitForTimeout(100);const closed=!(await page.locator('#'+id).isVisible().catch(()=>false));report.keyboard.push({name,id,controls,forward,backward,closed});save();console.log('CHECK',name,forward,backward,closed);if(!closed)await reset();
  }catch(e){report.setupFailures.push({name,error:e.message});save();console.error('SETUP',name,e.message);await reset();}
 }
 if(!process.env.BL_RARE_ONLY){await tab('cp');await page.evaluate(()=>showAppBlockingOperation('source'));await shot('blocking-operation');await page.evaluate(()=>hideAppBlockingOperation());}
 await context.close();await browser.close();save();console.log('RARE DONE');
})().catch(e=>{console.error(e.stack);process.exit(1);});
