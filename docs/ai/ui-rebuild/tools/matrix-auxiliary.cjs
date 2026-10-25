'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const cases=[
 ['formula-builder','_formulaColumnModal',"BLFormulaColumns.open('cp')",'cp'],
 ['clipboard-diagnostics','.gridClipboardDiagnosticsOverlay','openClipboardDiagnostics()','cp'],
 ['backlog-add-dimension','.backlogDimAddOverlay','openBacklogAddDimensionDialog()','backlog'],
 ['plm-connection','_coreNectumApiSettings','void openCoreNectumApiSettings()','koleksiyon'],
 ['mail-topic','mailTopicEditorModal',"openMailTopicEditor('pricing',mailTplActive('pricing').id,'cp')",'cp'],
 ['pricing-preflight','kolPricingPreflightModal',"void kolOpenPricingPreflightDialog({items:[{modelLabel:'DEMO-TRIKO-001',plmId:'100001',targetPriceMissing:true,techPackMissing:true,techPackReason:'MISSING'}],fetchRows:[]},()=>{})",'koleksiyon'],
 ['manual-price','_kolManualPrice','void openKolManualPriceModal(kolRows[0])','koleksiyon'],
 ['status-manager','_kolStatusManagerModal','BLCollectionStatusUI.open(BLCollectionStatusRuntime)','koleksiyon'],
 ['status-delete','_kolStatusDeleteModal',"BLCollectionStatusUI.open(BLCollectionStatusRuntime);document.querySelector('#_kolStatusManagerModal [data-delete]').click()",'koleksiyon'],
];
let s=fs.readFileSync(path.join(__dirname,'matrix-rare.cjs'),'utf8'),a=s.indexOf('const cases=['),b=s.indexOf('\n(async()=>',a);s=s.slice(0,a)+'const cases='+JSON.stringify(cases)+';'+s.slice(b);s=s.replace("phase-3/matrix/rare","phase-3/matrix/auxiliary").replaceAll("'#'+id","(id.startsWith('.')?id:'#'+id)");
s=s.replace("await tab('cp');await page.evaluate(()=>showAppBlockingOperation('source'));await shot('blocking-operation');await page.evaluate(()=>hideAppBlockingOperation());",'');
const generated=new Module(path.join(__dirname,'matrix-aux-generated.cjs'),module);generated.filename=path.join(__dirname,'matrix-aux-generated.cjs');generated.paths=module.paths;generated._compile(s,generated.filename);
