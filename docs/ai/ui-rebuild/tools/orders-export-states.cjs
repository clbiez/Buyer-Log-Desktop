'use strict';
// Explicit column visibility makes the comparison independent of the existing
// asynchronous CP checklist/model-definition registration order. Both versions
// execute their own canonical column synchronizer, then the same UI visibility.
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();await tab('cp');await page.evaluate(async()=>{await BLChecklistSupplierSync.loadShared();BLChecklistSupplierSync.refreshColumns({render:true});});await page.waitForTimeout(1000);await tab('orders');const states=[];
for(const stateName of ['reference-51','checklist-ready']){
 const folder=path.join(out,stateName);fs.mkdirSync(folder,{recursive:true});
 await page.evaluate(name=>{syncOrdersColumnsFromCp();colmgr.orders.order=COLS_BY_TABLE.orders.map(c=>c.k);colmgr.orders.hidden=new Set(name==='reference-51'?COLS_BY_TABLE.orders.filter(c=>c.checklistSupplierColumn).map(c=>c.k):[]);renderOrders();},stateName);
 states.push({name:stateName,columns:await page.evaluate(()=>COLS_BY_TABLE.orders.filter(c=>!colmgr.orders.hidden.has(c.k)).map(c=>({key:c.k,checklist:!!c.checklistSupplierColumn})))});
 for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);const copy=await page.evaluate(()=>buildManagedTableStyledCopy('orders',filteredOrders().slice(0,12),new Set()));fs.writeFileSync(path.join(folder,'orders-'+theme+'-html.html'),copy.html);fs.writeFileSync(path.join(folder,'orders-'+theme+'-plain.tsv'),copy.plain);const bytes=await page.evaluate(async()=>{const old=URL.createObjectURL,blobs=[];URL.createObjectURL=b=>{blobs.push(b);return old.call(URL,b)};try{await exportActiveTableStyled();return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=old}});fs.writeFileSync(path.join(folder,'orders-generic-'+theme+'.xlsx'),Buffer.from(bytes));}
}
fs.writeFileSync(path.join(out,'states.json'),JSON.stringify(states,null,2)+'\n');await context.close();await browser.close();console.log(states.map(s=>[s.name,s.columns.length]));})().catch(e=>{console.error(e);process.exit(1)});
