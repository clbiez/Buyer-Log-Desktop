'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});const {browser,context,page,tab}=await require('./operations-fixture.cjs')();await tab('cp');await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
for(const theme of ['light','grey','dark']){await page.evaluate(t=>applyTheme(t),theme);const copy=await page.evaluate(()=>buildManagedTableStyledCopy('cp',filteredCP().slice(0,12),new Set()));fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.html'),copy.html);fs.writeFileSync(path.join(out,'cp-copy-'+theme+'.tsv'),copy.plain);
const bytes=await page.evaluate(async()=>{const old=URL.createObjectURL,blobs=[];URL.createObjectURL=function(b){blobs.push(b);return old.call(URL,b);};try{await exportCpTableWithLightTheme();return Array.from(new Uint8Array(await blobs.at(-1).arrayBuffer()));}finally{URL.createObjectURL=old;}});fs.writeFileSync(path.join(out,'cp-export-'+theme+'.xlsx'),Buffer.from(bytes));}
await context.close();await browser.close();console.log('CP: nine exports saved');})().catch(e=>{console.error(e);process.exit(1);});
