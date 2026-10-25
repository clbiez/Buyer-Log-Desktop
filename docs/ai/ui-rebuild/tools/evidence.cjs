'use strict';
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/evidence/baseline');
const write=(n,v)=>fs.writeFileSync(path.join(out,n),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
(async()=>{
const {browser,page}=await require('./browser.cjs')();await page.emulateMedia({reducedMotion:'reduce'});
const report={overlays:[],export:[],a11y:[]};
const clean=async()=>{await page.keyboard.press('Escape');await page.evaluate(()=>{BLCommandPalette.close();BLUserManagement.close();document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('notificationHistoryModal')?.remove();});await page.locator('[data-rn-close]').first().click({timeout:400}).catch(()=>{});};
for(const theme of ['light','grey','dark']){
 await clean();await page.evaluate(t=>applyTheme(t),theme);await page.waitForTimeout(200);
 for(const [name,open] of [
  ['command-palette',()=>window.BLCommandPalette.open()],
  ['guide',()=>window.BLGuide.open()],
  ['release-notes',()=>window.BLReleaseNotes.open()],
  ['users',()=>window.BLUserManagement.open()],
  ['notifications',()=>window.openNotificationHistory()],
 ]){
  try{await openInPage(open);await page.waitForTimeout(650);await page.screenshot({path:path.join(out,name+'-'+theme+'.png')});const focus=[];for(let i=0;i<6;i++){await page.keyboard.press('Tab');focus.push(await page.evaluate(()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,id:e.id,cls:String(e.className),text:(e.textContent||'').trim().slice(0,55),outline:s.outline,shadow:s.boxShadow,insideDialog:!!e.closest('[role="dialog"],dialog')};}));}report.overlays.push({name,theme,focus});}catch(e){report.overlays.push({name,theme,error:e.message.slice(0,200)});}await clean();
 }
 await page.locator('nav.tabs button[data-tab="cp"]').click();await page.locator('#cpTable tbody tr').first().waitFor();
 for(const [name,selector] of [['cp-columns','#navColsBtn'],['cp-more','#cpMoreBtn']]){try{await page.locator(selector).click();await page.waitForTimeout(200);await page.screenshot({path:path.join(out,name+'-'+theme+'.png')});report.overlays.push({name,theme});await page.keyboard.press('Escape');await page.locator('#pageTitle').click();}catch(e){report.overlays.push({name,theme,error:e.message.slice(0,200)});}}
 const copy=await page.evaluate(()=>buildManagedTableStyledCopy('cp',filteredCP().slice(0,12),new Set()));write('cp-copy-'+theme+'.html',copy.html);write('cp-copy-'+theme+'.tsv',copy.plain);
 // Capture the real export Blob at the download seam. CDP has two clients;
 // Playwright download.saveAs cannot own the launcher's temporary artifact.
 const bytes=await page.evaluate(async()=>{const original=URL.createObjectURL,blobs=[];URL.createObjectURL=function(blob){blobs.push(blob);return original.call(URL,blob);};try{await exportCpTableWithLightTheme();const blob=blobs.at(-1);if(!blob)throw Error('No export Blob');return Array.from(new Uint8Array(await blob.arrayBuffer()));}finally{URL.createObjectURL=original;}});
 fs.writeFileSync(path.join(out,'cp-export-'+theme+'.xlsx'),Buffer.from(bytes));
 const visual=await page.evaluate(()=>{const cs=getComputedStyle(document.documentElement);return {thead:[cs.getPropertyValue('--thead-bg'),cs.getPropertyValue('--thead-ink')],headers:[...document.querySelectorAll('#cpTable thead th')].slice(0,6).map(e=>({text:e.textContent.trim(),bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color})),badge:[...document.querySelectorAll('#cpTable .badge')].slice(0,6).map(e=>({text:e.textContent,bg:getComputedStyle(e).backgroundColor,fg:getComputedStyle(e).color}))};});report.export.push({theme,copyCount:copy.count,visual});
 for(const tab of ['cp','overview']){await page.locator('nav.tabs button[data-tab="'+tab+'"]').click();await page.waitForTimeout(250);report.a11y.push({theme,tab,...await page.evaluate(contrastSample)});}
 write('overlay-export-a11y.json',report);
}
write('overlay-export-a11y.json',report);console.log(JSON.stringify({overlays:report.overlays.length,errors:report.overlays.filter(x=>x.error),contrast:report.a11y.map(x=>({theme:x.theme,tab:x.tab,failures:x.failures.length,checked:x.checked}))}));await browser.close();
async function openInPage(fn){return page.evaluate(fn);}
})().catch(e=>{console.error(e);process.exit(1);});

function contrastSample(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});const color=v=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
 const mix=(fg,bg)=>[0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3])).concat(1);
 const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const failures=[],seen=new Set();let checked=0;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
 while(n=walker.nextNode()){
  const text=n.textContent.trim(),el=n.parentElement;if(!text||!el||el.closest('script,style,svg,option,[disabled],[aria-hidden="true"]')||!el.checkVisibility())continue;
  const r=el.getBoundingClientRect();if(r.width===0||r.height===0||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth)continue;
  const cs=getComputedStyle(el),chain=[];let p=el;while(p){chain.unshift(getComputedStyle(p).backgroundColor);p=p.parentElement;}
  let bg=[255,255,255,1];for(const c of chain)bg=mix(color(c),bg);const fg=mix(color(cs.color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);checked++;
  const key=cs.color+'|'+bg+'|'+el.className;if(ratio<4.5&&!seen.has(key)){seen.add(key);failures.push({text:text.slice(0,80),id:el.id,cls:el.className,fg:cs.color,bg,ratio:Number(ratio.toFixed(2))});}
 }
 return {checked,failures,method:'Visible text nodes; computed colors composited through ancestors. Ignores images, overlap and opacity; findings require visual review, not a full WCAG certification.'};
}
