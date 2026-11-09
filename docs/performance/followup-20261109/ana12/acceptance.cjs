'use strict';
// Real Buyer Log, isolated 20-row demo source. Response gates make stale UI
// completion deterministic; real HTTP -> pool cancellation is tested separately.
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../../..'),app=path.join(repo,'resources/app');
const {start}=require(path.join(app,'scripts/lib/client-performance-app'));
(async()=>{
 const f=await start();const {page}=f;const results=[];
 try{
  await page.evaluate(()=>{
   const native=window.fetch.bind(window);window.ana12={requests:[],gates:[],hold:''};
   window.fetch=async(url,options={})=>{
    const tracked=/\/api\/backlog-(export|filter-values)\?/.test(String(url)),entry=tracked?{url:String(url),signal:options.signal,aborts:0}:null;
    if(entry){window.ana12.requests.push(entry);options.signal?.addEventListener('abort',()=>entry.aborts++,{once:true});}
    const response=await native(url,options);
    if(entry&&window.ana12.hold&&String(url).includes(window.ana12.hold)){entry.gated=true;await new Promise(resolve=>window.ana12.gates.push(resolve));}
    return response;
   };
   switchTab('backlog');
  });
  await page.waitForFunction(()=>document.querySelector('#backlogOverviewBody .bpaCardBox')||document.querySelector('#backlogOverviewBody .blvHero'));
  results.push('actual demo Backlog overview loaded');
  const snapshot=async label=>{const value=await page.evaluate(()=>({overview:document.getElementById('backlogOverviewBody').innerText.slice(0,400),requests:ana12.requests.map(r=>({url:r.url,hasSignal:!!r.signal,aborted:!!r.signal?.aborted,aborts:r.aborts,gated:!!r.gated}))}));console.log(label,JSON.stringify(value));return value;};
  await snapshot('initial');
  await page.evaluate(()=>{ana12.hold='/api/backlog-export';BLBacklogOverview.refresh();});
  await page.waitForFunction(()=>ana12.requests.some(r=>r.gated));
  await page.click('#backlogOverviewToggle');
  await page.waitForFunction(()=>ana12.requests.some(r=>r.gated&&r.signal.aborted));
  await page.evaluate(()=>{ana12.hold='';ana12.gates.splice(0).forEach(resolve=>resolve());});
  await page.click('#backlogOverviewToggle');
  await page.waitForFunction(()=>!document.getElementById('backlogOverviewBody').innerText.includes('Loading')&&!document.getElementById('backlogOverviewBody').innerText.includes('yükleniyor'));
  results.push('overview collapse aborts its consumer; reopen/requery succeeds; gated late response stays obsolete');
  await page.evaluate(()=>{ana12.hold='/api/backlog-export';BLBacklogOverview.refresh();});
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).length>=2);
  await page.evaluate(()=>switchTab('orders'));
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).every(r=>r.signal.aborted));
  await page.evaluate(()=>{ana12.hold='';ana12.gates.splice(0).forEach(resolve=>resolve());switchTab('backlog');});
  results.push('module navigation aborts pending overview consumer');
  await page.evaluate(()=>{BLBacklogChart.invalidate();BLBacklogRows.invalidate();ana12.hold='/api/backlog-export';BLBacklogChart.openSettings();});
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).length>=3);
  await page.click('#_backlogChartSettingsModal [data-chart-close]');
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).at(-1).signal.aborted);
  await page.evaluate(()=>{ana12.hold='';ana12.gates.splice(0).forEach(resolve=>resolve());});
  assert.equal(await page.locator('#_backlogChartSettingsModal').count(),0);results.push('chart settings close aborts request and late response cannot reopen dialog');
  await page.click('#backlogOverviewFilter');
  await page.waitForSelector('[data-blvf-add]');
  await page.evaluate(()=>{ana12.hold='/api/backlog-filter-values';});
  await page.locator('[data-blvf-add]').first().click();
  await page.waitForFunction(()=>ana12.requests.some(r=>r.url.includes('filter-values')&&r.gated));
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.url.includes('filter-values')).at(-1).signal.aborted);
  await page.evaluate(()=>{ana12.hold='';ana12.gates.splice(0).forEach(resolve=>resolve());});
  await page.click('#backlogOverviewFilter');
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.url.includes('filter-values')).length>=2);
  await page.waitForFunction(()=>!document.querySelector('.blvFilterEditor')?.innerText.includes('yükleniyor'));
  results.push('filter drawer close aborts facet request; reopening retries and renders current values');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{ana12.hold='/api/backlog-export';BLBacklogOverview.refresh();});
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).length>=4);
  await page.evaluate(()=>{ana12.hold='';document.getElementById('backlogFrom').value='2099-01-01';fetchCurrentBacklog();});
  await page.waitForFunction(()=>ana12.requests.filter(r=>r.gated).at(-1).signal.aborted);
  await page.waitForFunction(()=>document.getElementById('backlogOverviewBody').innerText.includes('Aktif filtrede Backlog satırı yok'));
  await page.evaluate(()=>ana12.gates.splice(0).forEach(resolve=>resolve()));
  await page.waitForTimeout(40);
  assert.ok((await page.locator('#backlogOverviewBody').innerText()).includes('Aktif filtrede Backlog satırı yok'));
  await page.evaluate(()=>{document.getElementById('backlogFrom').value='';fetchCurrentBacklog();});
  await page.waitForFunction(()=>!document.getElementById('backlogOverviewBody').innerText.includes('Aktif filtrede Backlog satırı yok')&&!document.querySelector('#backlogOverviewBody .bpaLoading'));
  results.push('rapid query change aborts old request; late old response cannot replace empty result; repeat query recovers normally');
  await page.screenshot({path:path.join(app,'public/release-notes/next-assets/ana12-backlog-consumer-cancel-20261109.png')});
  await snapshot('final');console.log(JSON.stringify({results,browserErrors:f.errors,root:f.root},null,2));assert.deepEqual(f.errors,[]);
 }catch(error){await page.screenshot({path:'/tmp/ana12-acceptance-failure.png'});console.log('failure-state',await page.evaluate(()=>({body:document.getElementById('backlogOverviewBody')?.innerText,errors:window.ana12?.requests.map(r=>({url:r.url,aborted:r.signal?.aborted,gated:r.gated}))})));console.log('browser-errors',f.errors);throw error;}finally{await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
