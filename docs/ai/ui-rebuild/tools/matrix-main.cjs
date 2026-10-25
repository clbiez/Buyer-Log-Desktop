'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.env.BL_MATRIX_OUT||'docs/ai/ui-rebuild/phase-3/matrix/main');fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();const file=path.join(out,'capture.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{screens:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());
 const shot=require('./matrix-shot.cjs')({page,out,report});
 await tab('cp');await page.locator('#cpTable tbody tr[data-id]').first().waitFor();await tab('koleksiyon');await page.evaluate(()=>{kolNextId=100001;kolRows=state.cp.rows.slice(0,12).map(cpRowToKolRow);kolPictureHidden=true;renderKol();shipRows=state.cp.rows.slice(0,3).map(mapCPRowToShip).map((r,i)=>({...r,_shipId:'demo-'+i,kur:34,trFiyatTl:340,gemiUcak:11,ucak:12}));shipRows.forEach(computeShipFormulas);});
 await tab('quotations');await page.evaluate(async()=>{await BL_QUOTATIONS.desk.ready();if(!BL_QUOTATIONS.desk.requests().length)await BL_QUOTATIONS.recordRequest('collection',kolRows.slice(0,6),[{name:kolRows[0].confirmedManufacturer,email:''},{name:'DEMO TRIKO',email:''}]);BL_QUOTATIONS.desk.selectRequest(BL_QUOTATIONS.desk.requests()[0]?.id);BLPricingDesk.renderLanguage();});
 for(const key of ['overview','cp','orders','backlog','shipping','koleksiyon','quotations','pricinghistory','priceanalysis','manufacturers','licensecards','lfl','opencosting','source','automations','lcwai']){
  if(key==='pricinghistory'){await page.evaluate(()=>switchTab('pricinghistory'));await page.waitForTimeout(700);}else await tab(key);
  if(key==='opencosting'&&!await page.locator('#ocEditor').isVisible()){await page.locator('#ocNewBtn').click();await page.locator('#ocTitle').fill('DEMO-TRIKO-001');await page.locator('#ocTitle').blur();}
  await shot(key);
 }
 await tab('cp');await page.evaluate(()=>openNotesEditor(state.cp.rows[0]._id,'Notes'));await page.locator('.noteEditorArea').fill('DEMO · Sevkiyat kontrolü');await shot('notes');await page.keyboard.press('Escape');
 await tab('koleksiyon');await page.evaluate(()=>document.getElementById('view-koleksiyon').classList.add('blPlmDragOver'));await shot('collection-plm-drag');await page.evaluate(()=>document.getElementById('view-koleksiyon').classList.remove('blPlmDragOver'));
 fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');await context.close();await browser.close();console.log('MATRIX MAIN COMPLETE',report.screens.length);
})().catch(e=>{console.error(e.stack);process.exit(1);});
