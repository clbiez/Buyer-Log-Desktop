'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./commercial-fixture.cjs')();
 for(const theme of ['light','grey','dark']){
  await page.evaluate(t=>applyTheme(t),theme);await tab('koleksiyon');
  const copy=await page.evaluate(()=>buildCollectionStyledCopy(new Set()));
  for(const [k,v] of Object.entries(copy))if(typeof v==='string')fs.writeFileSync(path.join(out,`collection-${theme}-${k}.${k==='html'?'html':'tsv'}`),v);
  const bytes=await page.evaluate(async()=>{await BLPerf.ensureLibrary('exceljs');const old=URL.createObjectURL,blobs=[];URL.createObjectURL=function(b){blobs.push(b);return old.call(URL,b);};try{await kolExportWithImages(kolRows);return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=old;}});
  fs.writeFileSync(path.join(out,`collection-${theme}.xlsx`),Buffer.from(bytes));console.log('Collection '+theme+' saved');
 }
 await tab('opencosting');await page.locator('#ocNewBtn').click();await page.locator('#ocTitle').fill('DEMO-TRIKO-001');await page.locator('#ocTitle').blur();
 const workbook=await page.evaluate(()=>{const old=XLSX.writeFile;let value;XLSX.writeFile=wb=>{value=XLSX.write(wb,{type:'array',bookType:'xlsx',cellStyles:true});};try{document.getElementById('ocExportBtn').click();return Array.from(new Uint8Array(value));}finally{XLSX.writeFile=old;}});
 fs.writeFileSync(path.join(out,'open-costing.xlsx'),Buffer.from(workbook));await context.close();await browser.close();console.log('Commercial references complete.');
})().catch(e=>{console.error(e.stack);process.exit(1);});
