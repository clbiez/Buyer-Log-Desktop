'use strict';
const R=require('../../../resources/app/scripts/sync-e2e/runtime.cjs'),B=require('../../../resources/app/scripts/sync-e2e/browser.cjs');
const root=process.argv[2]||'/workspace/scratch/bl-filter-probe';let rt,browser;
(async()=>{try{
 rt=await R.setup(root,{users:50,backends:1,port:6660});browser=await B.launch();
 const s=await B.open(browser,rt.servers[0],rt.manifest.accounts[4],rt.manifest.owner);
 await B.edit(s,5,'FILTER-SINGLE-USER');await s.page.locator('#kolTable').focus();await B.settle(s);
 const paint=await s.page.evaluate(()=>{const api=window.BLCollectionStatusCatalog,original=api.normalize;let calls=0;api.normalize=(...args)=>{calls++;return original(...args)};const t=performance.now();try{renderKol();return {elapsedMs:performance.now()-t,normalizations:calls,rows:document.querySelectorAll('#kolTable tbody tr[data-id]').length}}finally{api.normalize=original}});
 R.fs.writeFileSync(R.path.join(root,'paint.json'),JSON.stringify(paint,null,2));
 const p=s.page,t=Date.now();await p.locator('#kolSearch').fill('SYNTHETIC-');await p.waitForFunction(()=>document.querySelectorAll('#kolTable tbody tr[data-id]').length===49);const filterRenderedMs=Date.now()-t;
 const t2=Date.now();await p.locator('#kolSearch').fill('');await p.waitForFunction(()=>document.querySelectorAll('#kolTable tbody tr[data-id]').length===50);const clearRenderedMs=Date.now()-t2;
 await p.locator('#kolTable').focus();await B.settle(s);await p.screenshot({path:R.path.join(root,'cleared-filter.png')});
 R.fs.writeFileSync(R.path.join(root,'result.json'),JSON.stringify({status:'passed',source:rt.manifest.source,sourceDirty:rt.manifest.sourceDirty,contexts:1,backends:1,rows:50,paint,filterRenderedMs,clearRenderedMs,note:'Actual DOM row counts awaited after debounce; normalize instrumentation delegates to the unchanged real API and is restored synchronously.'},null,2));console.log('PASS 1 real UI session/50 rows full native render/filter',paint,filterRenderedMs,clearRenderedMs);
}finally{await browser?.close();if(rt)for(const s of rt.servers)await R.stopServer(s)}})().catch(e=>{console.error(e);process.exitCode=1});
