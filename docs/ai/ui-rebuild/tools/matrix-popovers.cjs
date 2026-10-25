'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve('docs/ai/ui-rebuild/phase-3/matrix/popovers');fs.mkdirSync(out,{recursive:true});const file=path.join(out,'capture.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{screens:[],checks:[],errors:[]};
 const {browser,context,page,tab}=await require('./matrix-commercial-fixture.cjs')();const shot=require('./matrix-shot.cjs')({page,out,report}),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');page.on('pageerror',e=>report.errors.push(e.message));
 for(const [name,key,button,panel] of [
  ['table-actions','cp','#cpMoreBtn','#cpMoreMenu'],['row-tools','cp','#cpToolsBtn','#cpToolsMenu'],
  ['plm-actions','cp','#cpPlmSyncBtn','#cpPlmSyncMenu'],['clipboard-menu','cp','#navCopyMenuBtn','#gridClipboardMenu'],
  ['lfl-filter','lfl','#lflDimBtn_country','#lflDimPanel_country'],
 ]){
  await tab(key);await page.locator(button).click();await page.locator(panel).waitFor();await shot(name);await page.keyboard.press('Escape');await page.locator('#pageTitle').click();
 }
 await tab('cp');await page.evaluate(()=>openTopRefreshMenu(document.getElementById('topRefreshBtn')));await shot('refresh-menu');await page.keyboard.press('Escape');await page.locator('#pageTitle').click();
 await page.evaluate(()=>openTableFieldsMenu(document.querySelector('[data-table-fields="cp"]')));await page.locator('#_tableFieldsMenu').waitFor();await shot('table-fields');await page.keyboard.press('Escape');await page.locator('#pageTitle').click();
 for(const [key,id] of [['cp','cpTable'],['orders','ordersTable'],['koleksiyon','kolTable']]){
  await tab(key);await page.evaluate(({key,id})=>{state.freeze[key]={left:3};applyFreeze(id,key,key!=='koleksiyon');document.getElementById(id).closest('.tablewrap').scrollLeft=180;},{key,id});
  const cell=page.locator('#'+id+' tbody tr[data-id] td.frzL').first();await cell.hover();await shot('frozen-'+key);
  report.checks.push(await page.evaluate(id=>{const table=document.getElementById(id),h=table.querySelector('thead th.frzL'),normal=table.querySelector('thead th:not(.frzL)'),c=table.querySelector('tbody td.frzL');return {name:'frozen-layer-'+id,header:h?getComputedStyle(h).zIndex:null,normal:normal?getComputedStyle(normal).zIndex:null,cell:c?{z:getComputedStyle(c).zIndex,background:getComputedStyle(c).backgroundColor}:null};},id));
 }
 await tab('source');await page.evaluate(()=>void openDataMaintenanceModal());await page.locator('#_blDataMaintenance').waitFor();await shot('data-maintenance');await page.keyboard.press('Escape');
 save();await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exit(1);});
