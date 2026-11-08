'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {root}=require('./source.cjs');
const {adaptBlocks}=require('./recipe.cjs');
const tag=process.env.SHELL06_LIFECYCLE_TAG||'attempt3';
const evidence=path.join(root,'docs/performance-program/contrib-shell06-revision-poller-20261108/evidence');
const helper=fs.readFileSync(path.join(root,'resources/app/public/shared-revision-poller.js'),'utf8');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const setup=`
window.BL_CLIENT_ID='synthetic-'+new URL(location).searchParams.get('tab');
window.events=[];window.outputs=[];window.errors=[];
window.nativeActivity=()=>{};
window.buyerLogDesktop={workspace:{onTabActivity:fn=>{window.nativeActivity=fn;return()=>{window.nativeActivity=()=>{};};}}};
window.BLSharedRevisionContext={value:{actor:'synthetic',source:'loopback',authority:'grant-1',valid:true},listeners:new Set(),read(){return this.value;},subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);},change(delta){this.value={...this.value,...delta};for(const fn of this.listeners)fn();}};
let liveSyncConnected=false;let kolWorkspaceOwnerId=null;const state={};let appLang='en';
function renderSyncStatusBadge(){};const syncStatusModalRenderer=null;
function refreshSharedMasterClient(area){outputs.push(area);return Promise.resolve();}
function refreshPricingRulesFromServer(){outputs.push('pricing');return Promise.resolve();}
function loadFromServer(){outputs.push('load');return Promise.resolve();}
function kolHandleRemoteChange(){return Promise.resolve();}function initKolWorkspaces(){return Promise.resolve();}
function applyRemoteRowPatches(){}function showToast(){}
window.BL_QUOTATIONS={refresh:()=>outputs.push('quotation')};window.BLLicenseCardsPage={invalidate:()=>outputs.push('licenseCards')};
window.addEventListener('bl-shared-revision',e=>events.push(JSON.parse(JSON.stringify(e.detail))));
`;
async function main(){
 const log={browser:null,requests:[],steps:[],errors:[]};let revision=0,nextHold=false,nextError=false,lastLeaderId=null;const held=[],streams=new Map();
 const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/api/shared-revisions')){
   const entry={id:log.requests.length+1,at:Date.now(),status:'started'};log.requests.push(entry);
   res.on('close',()=>{if(entry.status==='started'){entry.status='aborted';entry.end=Date.now();}});
   if(nextError){nextError=false;res.writeHead(503);res.end();entry.status='http-503';entry.end=Date.now();return;}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   const value={schemaVersion:1,revision,entities:{quotation:{revision},pricingRules:{revision}}};
   if(nextHold){nextHold=false;res.write('{');held.push(()=>{res.end(JSON.stringify({...value,revision:99}).slice(1));if(entry.status==='started'){entry.status='completed-late';entry.end=Date.now();}});return;}
   res.end(JSON.stringify(value));entry.status='completed';entry.revision=revision;entry.end=Date.now();
  }else if(req.url.startsWith('/api/live-events')){
   const id=new URL(req.url,'http://127.0.0.1').searchParams.get('clientId');streams.set(id,res);lastLeaderId=id;
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': open\n\n');res.on('close',()=>{if(streams.get(id)===res)streams.delete(id);});
  }else{
   const code=adaptBlocks().join('\n');res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>SHELL-06 lifecycle synthetic</title><script>'+helper+'\n'+setup+'\n'+code+'\nwindow.fixtureCatchUp=()=>sharedRevisionPoller.catchUp();</script>');
  }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});log.browser=browser.version();
 const context=await browser.newContext();const pages=[];
 async function until(check,label){const end=Date.now()+8000;while(Date.now()<end){if(await check())return;await wait(25);}throw Error('deadline: '+label);}
 async function leader(){const id=[...streams.keys()][0]||lastLeaderId;return pages.find(p=>!p.isClosed()&&p.url().endsWith('tab='+id?.split('-').at(-1)));}
 async function catchUp(){await (await leader()).evaluate(()=>fixtureCatchUp());}
 async function hasRevision(value){for(const p of pages.filter(p=>!p.isClosed()))if(!await p.evaluate(v=>events.some(e=>e.revisions.revision===v),value))return false;return true;}
 try{
  for(let i=0;i<3;i++){const p=await context.newPage();p.on('pageerror',e=>log.errors.push(e.message));pages.push(p);await p.goto('http://127.0.0.1:'+server.address().port+'/?tab='+i);}
  await until(()=>streams.size===1&&log.requests.some(r=>r.status==='completed'),'initial leader');
  for(const p of pages){const support=await p.evaluate(async()=>({locks:!!navigator.locks,channel:typeof BroadcastChannel==='function',held:(await navigator.locks.query()).held.map(l=>l.name)}));assert.deepEqual(support,{locks:true,channel:true,held:['buyerlog-live-sync-leader']});}
  log.steps.push('three Chromium pages: existing Web Lock, one SSE source');
  // Read headers first, then hold JSON across actor/source/authority invalidation.
  for(const field of ['actor','source','authority']){
   nextHold=true;const before=log.requests.length;await catchUp();await until(()=>log.requests.length>before,'held JSON');await wait(50);
   for(const p of pages)await p.evaluate(f=>BLSharedRevisionContext.change({[f]:'new-'+f}),field);
   await until(()=>log.requests[before].status==='aborted','context abort');held.shift()();
   await until(()=>log.requests.length>before+1&&log.requests.at(-1).status==='completed','context catch-up');
   for(const p of pages)assert.equal(await p.evaluate(()=>events.some(e=>e.revisions.revision===99)),false);
   log.steps.push(field+' change aborts pending JSON and catches up');
  }
  revision=1;await catchUp();await until(()=>hasRevision(1),'revision 1');
  nextHold=true;let before=log.requests.length;await catchUp();await until(()=>log.requests.length>before,'leader pending GET');
  const old=await leader();await old.close();await until(()=>streams.size===1&&log.requests.length>before+1,'successor catch-up');held.shift()();
  await until(()=>log.requests[before].status==='aborted','leader close abort');log.steps.push('closing real leader releases the existing Web Lock; successor catches up');
  nextHold=true;before=log.requests.length;await catchUp();await until(()=>log.requests.length>before,'offline pending GET');
  await context.setOffline(true);await until(()=>log.requests[before].status==='aborted','offline abort');held.shift()();revision=2;
  await context.setOffline(false);await until(()=>hasRevision(2),'online catch-up');log.steps.push('Chromium offline/online abort and revision 2 recovery');
  nextError=true;before=log.requests.length;await catchUp();await until(()=>log.requests.length>before&&log.requests.at(-1).status==='http-503','503 response');revision=3;
  await until(()=>hasRevision(3),'error recovery');log.steps.push('HTTP 503 backoff recovers without a refresh POST');
  revision=4;for(const s of streams.values())s.end();await until(()=>hasRevision(4),'SSE reconnect gap catch-up');log.steps.push('real EventSource reconnect catches up revision 4');
  const livePages=pages.filter(p=>!p.isClosed());
  for(const p of livePages)await p.evaluate(()=>nativeActivity({active:false}));revision=5;
  for(const p of livePages)await p.evaluate(()=>nativeActivity({active:true}));await until(()=>hasRevision(5),'native activity catch-up');log.steps.push('synthetic native activity callback requests catch-up');
  // Expiry is independent of an unchanged revision. All receivers fail closed.
  for(const p of livePages)await p.evaluate(()=>BLSharedRevisionContext.change({valid:false}));
  const expiryCount=log.requests.length;
  await livePages[0].evaluate(()=>{const c=new BroadcastChannel('buyerlog-live-sync');c.postMessage({type:'shared-revisions',generation:'forged',sequence:1,revisions:{schemaVersion:1,revision:99,entities:{quotation:{revision:99,profile:'secret'}}}});c.close();});
  await wait(100);assert.equal(log.requests.length,expiryCount);
  for(const p of livePages)assert.equal(await p.evaluate(()=>events.some(e=>e.revisions.revision===99)),false);
  for(const p of livePages)await p.evaluate(()=>BLSharedRevisionContext.change({valid:true,authority:'renewed-grant'}));
  await until(()=>log.requests.length>expiryCount,'grant renewal catch-up');log.steps.push('grant expiry rejects channel hints with unchanged store revision; renewal catches up');
  log.snapshots=[];for(const p of livePages)log.snapshots.push(await p.evaluate(()=>({events,outputs})));
  for(const s of log.snapshots)assert.deepEqual(s.events.map(e=>e.revisions.revision),[1,2,3,4,5]);
  assert.deepEqual(log.snapshots[0],log.snapshots[1]);assert.deepEqual(log.errors,[]);
  const finalLeader=await leader();const stopOrder=[...livePages.filter(p=>p!==finalLeader),finalLeader];before=log.requests.length;for(const p of stopOrder)await p.evaluate(()=>__shell06StopLiveSync());await wait(1200);assert.equal(log.requests.length,before);assert.equal(streams.size,0);
  log.steps.push('explicit teardown leaves no SSE, timer GET or queued lock holder');log.ok=true;
 }finally{
  log.counts={started:log.requests.length,completed:log.requests.filter(r=>r.status==='completed'||r.status==='completed-late').length,aborted:log.requests.filter(r=>r.status==='aborted').length,http503:log.requests.filter(r=>r.status==='http-503').length};
  if(!log.snapshots){log.snapshots=[];for(const p of pages.filter(p=>!p.isClosed())){try{log.snapshots.push(await p.evaluate(()=>({events,outputs})));}catch(e){log.snapshots.push({error:e.message});}}}
  fs.writeFileSync(path.join(evidence,'chromium-lifecycle-'+tag+'-'+(log.ok?'green':'failed')+'.json'),JSON.stringify(log,null,2)+'\n',{flag:'wx'});
  await context.close();await browser.close();for(const s of streams.values())s.end();await new Promise(resolve=>server.close(resolve));
 }
 console.log(JSON.stringify({ok:log.ok,steps:log.steps,counts:log.counts}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
