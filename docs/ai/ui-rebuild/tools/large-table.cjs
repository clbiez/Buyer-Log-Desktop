'use strict';
// Repeat ONLY the invalidated large-table measurement; keep valid startup samples.
const fs=require('node:fs'),path=require('node:path');
(async()=>{const {browser,page}=await require('./browser.cjs')();const file=path.resolve(process.argv[2]||'docs/ai/ui-rebuild/evidence/baseline/performance.json');const report=JSON.parse(fs.readFileSync(file));
await page.evaluate(()=>applyTheme('light'));await page.locator('nav.tabs button[data-tab="cp"]').click();await page.locator('#cpTable tbody tr[data-id]').first().waitFor();
for(let i=0;i<5;i++){
 const result=await page.evaluate(async()=>{const original=state.cp.rows;try{
  state.cp.rows=Array.from({length:5000},(_,i)=>({...original[i%original.length],_id:9000000+i,'Order Code':9000000+i}));invalidateCoreFacetCaches();invalidateUnifiedPriorityDecisions('audit-5000',['cp']);
  const token=BLPerf.begin('auditCP5000RenderMs');renderCPNow();const deadline=performance.now()+30000;
  while(![...document.querySelectorAll('#cpTable tbody tr[data-id]')].some(e=>Number(e.dataset.id)>=9000000)){if(performance.now()>deadline)throw Error('5000-row projection did not reach DOM');await new Promise(r=>setTimeout(r,20));}
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));BLPerf.end(token);
  return {dataRows:state.cp.rows.length,domRows:document.querySelectorAll('#cpTable tbody tr[data-id]').length,firstId:document.querySelector('#cpTable tbody tr[data-id]').dataset.id,metrics:BLPerf.snapshot()};
 }finally{state.cp.rows=original;invalidateCoreFacetCaches();invalidateUnifiedPriorityDecisions('audit-restore',['cp']);renderCPNow();}});
 report.runs[i].large={...result,metrics:{...report.runs[i].large.metrics,auditCP5000RenderMs:result.metrics.auditCP5000RenderMs}};
 await page.waitForFunction(()=>Number(document.querySelector('#cpTable tbody tr[data-id]')?.dataset.id)<9000000);await page.waitForTimeout(200);
}
const values=report.runs.map(x=>x.large.metrics.auditCP5000RenderMs.lastMs).sort((a,b)=>a-b);report.summary.cp5000RenderMs=values[2];report.largeMeasurementNote='Corrected: awaits new synthetic row IDs in DOM; initial 2-frame-only measurement discarded because lazy priority calculation can return before rendering.';
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(report.summary);await browser.close();})().catch(e=>{console.error(e);process.exit(1);});
