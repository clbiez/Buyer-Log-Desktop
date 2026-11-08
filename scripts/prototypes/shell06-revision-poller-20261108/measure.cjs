'use strict';
// Loopback only. The app poll, SSE coordinator and revision consumer are read
// from the pinned source; only their surrounding data/UI dependencies are fake.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const tag=process.env.SHELL06_RUN_TAG||'verified';
const { chromium } = require('playwright');
const { root, poll, live, tail } = require('./source.cjs');
const out = path.join(root, 'docs/performance-program/contrib-shell06-revision-poller-20261108/evidence');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const setup = `
window.BL_CLIENT_ID='demo-'+location.search;
window.BL_USER_CONTEXT={id:'synthetic-actor'};
window.BLSharedRevisionContext={read:()=>({actor:'synthetic-actor',source:'loopback-v1',authority:'grant-v1',valid:true}),subscribe:()=>()=>{}};
window.events=[];window.eventTimes=[];window.outputs=[];window.gets=[];window.lastRevision=0;
let liveSyncConnected=false;
const state={};let kolWorkspaceOwnerId=null;let appLang='en';
function loadFromServer(){outputs.push('load');return Promise.resolve();}
function refreshSharedMasterClient(area){outputs.push(area);return Promise.resolve();}
function refreshPricingRulesFromServer(){outputs.push('pricing');return Promise.resolve();}
function kolHandleRemoteChange(){return Promise.resolve();}
function initKolWorkspaces(){return Promise.resolve();}
function renderSyncStatusBadge(){};const syncStatusModalRenderer=null;
function applyRemoteRowPatches(){};function showToast(){};
window.BL_QUOTATIONS={refresh:()=>outputs.push('quotation')};
window.BLLicenseCardsPage={invalidate:()=>outputs.push('licenseCards')};
window.addEventListener('bl-shared-revision',e=>{events.push(JSON.parse(JSON.stringify(e.detail)));eventTimes.push({at:Date.now()-measureEpoch,revision:e.detail.revisions.revision});window.lastRevision=e.detail.revisions.revision;});
window.addEventListener('bl:iam-revision-available',()=>outputs.push('iam'));
const nativeFetch=window.fetch.bind(window);
window.fetch=async (url,options)=>{
 const r={at:performance.now()-measureStart,status:'started'};gets.push(r);
 try{const response=await nativeFetch(url,{...options,headers:{...options?.headers,'X-Synthetic-Tab':location.search}});const json=response.json.bind(response);
 response.json=async()=>{try{const value=await json();r.status='completed';r.end=performance.now()-measureStart;window.fetchedRevision=value.revision;return value;}catch(e){r.status=e.name==='AbortError'?'aborted':'failed';throw e;}};return response;}
 catch(e){r.status=e.name==='AbortError'?'aborted':'failed';r.end=performance.now()-measureStart;throw e;}
};
`;
async function run(browser, mode, count, label) {
  const context = await browser.newContext();
  const requests=[], changes=[], sockets=new Set(),ordinals=new Map(); let zero=0, revision=0, active=0, maxOverlap=0;
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/shared-revisions')){
      const entry={at:Date.now()-zero,id:requests.length+1};requests.push(entry);active++;maxOverlap=Math.max(maxOverlap,active);
      let ended=false;const finish=status=>{if(ended)return;ended=true;entry.status=status;entry.end=Date.now()-zero;active--;};
      res.on('close',()=>finish('aborted'));
      // The second cadence crosses a seven-second period: reveal original overlap.
      const tab=req.headers['x-synthetic-tab'];const ordinal=(ordinals.get(tab)||0)+1;ordinals.set(tab,ordinal);entry.tab=tab;entry.ordinal=ordinal;
      const delay=ordinal===2?8000:25;
      setTimeout(()=>{if(ended)return;const value={schemaVersion:1,revision,entities:{quotation:{revision},pricingRules:{revision}}};
        entry.revision=revision;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));finish('completed');},delay);
    }else if(req.url.startsWith('/api/live-events')){
      sockets.add(res);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': open\n\n');res.on('close',()=>sockets.delete(res));
    }else{
      let code=poll+live+tail;
      if(mode==='B') code=require('./recipe.cjs').adaptBlocks().join('\n');
      const helper=mode==='B'?fs.readFileSync(path.join(root,'resources/app/public/shared-revision-poller.js'),'utf8'):'';
      res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>SHELL-06 synthetic</title><script>'+helper+'\n'+setup+'\nwindow.arm=()=>{'+code+'};</script>');
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const pages=[];const errors=[];
  try{
    for(let i=0;i<count;i++){const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);await page.goto(url+'/?tab='+i);}
    
    // Arm all pages against a common epoch; no time scaling of 2500/7000.
    zero=Date.now();
    for(const page of pages)await page.evaluate(epoch=>{window.measureStart=performance.now();window.measureEpoch=epoch;window.armOffset=Date.now()-epoch;window.arm();},zero);
    const timers=[setTimeout(()=>{revision=1;changes.push({revision,at:Date.now()-zero});},4000),setTimeout(()=>{for(const s of sockets)s.write('data: {"area":"iam"}\n\n');},6000),setTimeout(()=>{revision=2;changes.push({revision,at:Date.now()-zero});},20000)];
    await wait(31500);
    timers.forEach(clearTimeout);
    const snapshots=[];
    for(const page of pages)snapshots.push(await page.evaluate(()=>({events,eventTimes,outputs,gets,lastRevision,armOffset,context:{webLocks:!!navigator.locks,channel:typeof BroadcastChannel==='function'},elapsed:performance.now()-measureStart})));
    const hashes=Object.fromEntries(['resources/app/public/app-main.js','resources/app/public/shared-revision-poller.js','scripts/prototypes/shell06-revision-poller-20261108/recipe.cjs','scripts/prototypes/shell06-revision-poller-20261108/measure.cjs'].filter(p=>fs.existsSync(path.join(root,p))).map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
    const result={label,mode,count,hashes,windowMs:31500,changes,requests,maxOverlap,errors,snapshots,sseConnections:sockets.size,browser:browser.version()};
    fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    assert.deepEqual(errors,[]);
    for(const s of snapshots){assert.deepEqual(s.context,{webLocks:true,channel:true});assert.equal(s.lastRevision,2);assert.deepEqual(s.events.map(e=>[e.changed,e.revisions.revision]),[[['quotation','pricingRules'],1],[['quotation','pricingRules'],2]]);assert.deepEqual(s.outputs,['iam','quotation','licenseCards','quotation','licenseCards']);}
    assert.equal(sockets.size,1);
    console.log(JSON.stringify({label,mode,count,requests:requests.length,maxOverlap,completed:requests.filter(r=>r.status==='completed').length,aborted:requests.filter(r=>r.status==='aborted').length}));
    return result;
  }catch(error){fs.writeFileSync(path.join(out,label+'-failure.json'),JSON.stringify({label,mode,count,changes,requests,maxOverlap,errors,error:error.stack},null,2)+'\n',{flag:'wx'});throw error;}finally{await context.close();for(const s of sockets)s.end();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    if(process.argv[2]==='baseline'){for(const n of [1,3,5])await run(browser,'A',n,tag+'-cost-A-'+n);}
    else{for(let pair=0;pair<3;pair++){const order=pair===1?['B','A']:['A','B'];for(const n of [1,3,5]){const results=[];for(const mode of order)results.push(await run(browser,mode,n,`${tag}-pair-${pair+1}-${n}-${mode}`));assert.deepEqual(results[0].snapshots.map(s=>({events:s.events,outputs:s.outputs,lastRevision:s.lastRevision})),results[1].snapshots.map(s=>({events:s.events,outputs:s.outputs,lastRevision:s.lastRevision})),'A/B output equivalence');}}}
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
