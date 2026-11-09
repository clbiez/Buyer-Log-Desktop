// Real Buyer Log, synthetic persisted Collection/BOM only. Requires Playwright.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH for a system Chromium binary.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..'),work=path.join(repo,'work/artwork-bom');
fs.mkdirSync(work,{recursive:true});
const baseSha=process.env.BL_ARTWORK_BASE_SHA||'9e667430e3ac7ca30b321f06893d53f24d6ed5a3';
for(const file of ['app-main.js','plm-bom.js','collection-artwork-detail.js'])fs.writeFileSync(path.join(work,'base-'+file),execFileSync('git',['show',`${baseSha}:resources/app/public/${file}`],{cwd:repo,maxBuffer:16*1024*1024}));
const root=path.join(work,'runtime'),port=Number(process.env.BL_ARTWORK_PORT||6489),base=`http://127.0.0.1:${port}`;
fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'auth');
const source=path.join(root,'source');fs.mkdirSync(source,{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const placement=(placement,count=1)=>({placement,count,printType:'Pigment',componentCode:'DEMO-PRINT',description:'DEMO PRINT',graphicApprovalStatusName:'Demo approved'});
const entries=[
 {plmId:'900001',styleId:'910001',placements:[placement('front_body'),placement('back_body')]},
 {plmId:'900002',styleId:'910002',isSetStyle:true,setComponents:[{label:'A',childPlmId:'920001',childStyleId:'930001',childStyleName:'DEMO SET A',placements:[placement('front_body'),placement('back_body')]},{label:'B',childPlmId:'920002',childStyleId:'930002',childStyleName:'DEMO SET B',placements:[placement('front_body')]}]},
 {plmId:'900003',styleId:'910003',placements:[]}
];
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'plm-bom.json'),JSON.stringify({schemaVersion:2,_revision:1,models:Object.fromEntries(entries.map(e=>[e.plmId,e]))}));
const rows=Array.from({length:20},(_,i)=>({id:i+1,plmId:String(900001+i),modelKod:i===1?'DEMO SET STYLE':'DEMO ARTWORK '+(i+1),artworkDetail:'Demo manual note',artworkDetailPlm:'Old BOM',durum:'Design'}));
for(const [index,role] of [[9,'parent'],[10,'variant'],[11,'variant']])Object.assign(rows[index],{plmId:'900001',modelKod:'DEMO COLOUR GROUP',modelGroupId:'demo-artwork-group',modelGroupRole:role,variantId:'demo-variant-'+index,modelSharedValues:role==='parent'?{artworkDetail:'Demo manual note'}:{},variantOverrides:index===11?{artworkDetail:'Colour-specific note'}:{}});
const fixtureHash=crypto.createHash('sha256').update(JSON.stringify({rows,entries})).digest('hex');
const log=fs.openSync(path.join(work,'server.log'),'w'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
const results={fixtureHash,rows:rows.length,runtime:process.version,runs:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(url,options={}){const r=await fetch(base+url,{...options,headers:{cookie:cookie||'','Content-Type':'application/json'}});assert.ok(r.ok,await r.clone().text());return r;}
async function persistRows(){await api('/api/collection-workspaces/moderator',{method:'PUT',body:JSON.stringify({rows,nextId:21,manufacturers:[],customColumns:[],statusCatalog:[]})});}
async function boot(mode){
 await persistRows();
 const context=await browser.newContext({viewport:{width:1500,height:900},reducedMotion:'reduce'});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 if(mode.startsWith('base'))for(const file of ['app-main.js','plm-bom.js','collection-artwork-detail.js'])await context.route(`**/${file}*`,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(work,'base-'+file),'utf8')}));
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:6000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
 await page.evaluate(()=>{applyLanguage('tr');switchTab('koleksiyon');});
 await page.waitForFunction(()=>typeof kolRows!=='undefined'&&kolRows.length===20&&window.BLCollectionSpreadsheetBridge?.canEdit(),null,{timeout:60000});
 await page.evaluate(async()=>{await window.BLCollectionArtworkDetail.ensureFresh();await window.BLPerf._loadScript('plm-bom.js');await document.fonts.ready;});
 await page.locator('#kolTable tbody td').first().waitFor();
 // Let the same startup/module work settle in every fresh context.
 await page.waitForTimeout(1500);
 return {page,context,errors,requests};
}
async function open(page,rowId=1,moduleId='collection'){
 await page.evaluate(({rowId,moduleId})=>{
   const start=performance.now();
   window.__bomVisible=new Promise(resolve=>{const observer=new MutationObserver(()=>{
     if(document.querySelector('.cpaModalBody .cpaChips')||/No BOM record|BOM kaydı yok/.test(document.querySelector('.cpaModalBody')?.textContent||'')){observer.disconnect();requestAnimationFrame(()=>resolve(performance.now()-start));}
   });observer.observe(document.body,{childList:true,subtree:true});});
   window.BLPlmBom.openForRow(kolRows.find(r=>r.id===rowId),moduleId);
 },{rowId,moduleId});
 return page.evaluate(()=>window.__bomVisible);
}
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/user-profiles')).ok)break;}catch{}await sleep(250);}
 const password=crypto.randomBytes(20).toString('hex');const login=await api('/api/user-login',{method:'POST',body:JSON.stringify({userId:'moderator',password,newPassword:password})});cookie=login.headers.get('set-cookie').split(';')[0];await persistRows();
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
 for(let pair=0;pair<3;pair++)for(const mode of (process.env.BL_ARTWORK_ORDER||'base,base-control,candidate').split(',')){
  const {page,context,errors,requests}=await boot(mode),run={pair,mode,openMs:[],heaps:[],modalRoots:[]};
  const cdp=await context.newCDPSession(page);
  for(let i=0;i<5;i++){
   const start=requests.length;run.openMs.push(await open(page));
   assert.equal(requests.slice(start).filter(r=>/\/api\/plm-sync\/bom\/900001$/.test(r.url)).length,1);
   assert.equal(await page.evaluate(()=>kolRows[0].artworkDetail),'Demo manual note');
   await page.locator('.cpaModal footer [data-bom-close]').click();
   await cdp.send('HeapProfiler.collectGarbage');run.heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
   run.modalRoots.push(await page.locator('.cpaModalOverlay').count());
  }
  assert.deepEqual(run.modalRoots,[0,0,0,0,0]);assert.ok(Math.max(...run.heaps)-Math.min(...run.heaps)<2*1024*1024,'no growing retained modal resources');
  run.existingEditMs=await page.evaluate(()=>{const start=performance.now();window.BLCollectionSpreadsheetBridge.batchEdit([{rowId:20,key:'artworkDetail',value:'Benchmark edit'}]);return performance.now()-start;});
  assert.deepEqual(errors,[]);run.bomGets=requests.filter(r=>/\/api\/plm-sync\/bom\/900001$/.test(r.url)).length;results.runs.push(run);console.log(JSON.stringify(run));await context.close();
 }
 const {page,context,errors,requests}=await boot('candidate');
 const assets=path.join(app,'public/release-notes/next-assets');
 for(const lang of ['tr','en']){
  await page.evaluate(lang=>applyLanguage(lang),lang);await open(page,2);
  const button=page.locator('[data-bom-apply]');await button.waitFor();assert.equal(await button.isEnabled(),true);
  // The global DOM translator may translate/flatten displayed text. Compare stored
  // data with canonical BOM evidence, preserving its exact A/B newlines.
  const evidence=(await (await api('/api/plm-sync/bom/900002')).json()).entry;
  const expected=await page.evaluate(entry=>window.BLCollectionArtworkDetail.summaryFor(entry),evidence);
  assert.match(expected,/A -/);assert.match(expected,/B -/);
  if(lang==='tr')await page.screenshot({path:path.join(assets,'artwork-apply-bom.png')});
  await button.evaluate(el=>{
    el.addEventListener('click',()=>{window.__applyStart=performance.now();window.__applyPaint=new Promise(resolve=>requestAnimationFrame(()=>resolve(performance.now()-window.__applyStart)));},{capture:true,once:true});
    el.addEventListener('click',()=>{window.__applySynchronousMs=performance.now()-window.__applyStart;},{once:true});
  });
  const start=requests.length;await button.click();await page.waitForFunction(()=>!document.querySelector('[data-bom-apply]'));
  const feedbackMs=await page.evaluate(()=>window.__applyPaint),synchronousMs=await page.evaluate(()=>window.__applySynchronousMs);
  console.log('action',lang,{feedbackMs,synchronousMs});assert.ok(feedbackMs<=200,'new action visible feedback <=200 ms');assert.ok(synchronousMs<=50,'new synchronous action <=50 ms');
  assert.equal(await page.evaluate(()=>kolRows[1].artworkDetail),expected);
  await page.evaluate(async()=>{const r=await kolSaveWorkspaceNow();if(!r.ok)throw new Error('save failed');});
  const saved=await (await api('/api/collection-workspaces/moderator')).json();assert.equal(saved.workspace.rows.find(r=>r.id===2).artworkDetail,expected);
  assert.equal(requests.slice(start).filter(r=>/\/api\/plm-sync/.test(r.url)).length,0);
  await page.evaluate(()=>kolUndo());assert.equal(await page.evaluate(()=>kolRows[1].artworkDetail),'Demo manual note');
  results[lang]={feedbackMs,synchronousMs,expected};
 }
 await open(page,3);await page.locator('[data-bom-apply]').click();await page.locator('.cpaModalOverlay').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>kolRows[2].artworkDetail),'No print');
 await open(page,1,'cp');assert.equal(await page.locator('[data-bom-apply]').count(),0);await page.locator('.cpaModal footer [data-bom-close]').click();
 await open(page,4);await page.waitForFunction(()=>/No BOM record/.test(document.querySelector('.cpaModalBody')?.textContent||''));assert.equal(await page.locator('[data-bom-apply]').count(),0);await page.locator('.cpaModal footer [data-bom-close]').click();
 await page.evaluate(()=>{kolWorkspaceCanEdit=false;});await open(page,1);assert.equal(await page.locator('[data-bom-apply]').isDisabled(),true);await page.locator('.cpaModal footer [data-bom-close]').click();await page.evaluate(()=>{kolWorkspaceCanEdit=true;});
 await open(page,1);await page.evaluate(()=>{kolRows=kolRows.map(r=>({...r}));});await page.locator('[data-bom-apply]').click();assert.equal(await page.evaluate(()=>kolRows[0].artworkDetail),'Demo manual note');await page.locator('[data-bom-status]').waitFor();await page.locator('.cpaModal footer [data-bom-close]').click();
 await open(page,1);await page.locator('[data-bom-apply]').click();await page.locator('.cpaModalOverlay').waitFor({state:'detached'});const final=await page.evaluate(()=>kolRows[0].artworkDetail);await page.evaluate(()=>kolSaveWorkspaceNow());
 await open(page,10);await page.locator('[data-bom-apply]').click();await page.locator('.cpaModalOverlay').waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>kolEffectiveValue(kolRows.find(r=>r.id===10),'artworkDetail')),final);
 assert.equal(await page.evaluate(()=>kolEffectiveValue(kolRows.find(r=>r.id===11),'artworkDetail')),final);
 assert.equal(await page.evaluate(()=>kolEffectiveValue(kolRows.find(r=>r.id===12),'artworkDetail')),'Colour-specific note');
 await open(page,11);assert.equal(await page.locator('[data-bom-apply]').isDisabled(),true);await page.locator('.cpaModal footer [data-bom-close]').click();
 await open(page,12);await page.locator('[data-bom-apply]').click();await page.locator('.cpaModalOverlay').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>kolEffectiveValue(kolRows.find(r=>r.id===12),'artworkDetail')),final);await page.evaluate(()=>kolSaveWorkspaceNow());
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:6000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});await page.evaluate(()=>switchTab('koleksiyon'));await page.waitForFunction(()=>typeof kolRows!=='undefined'&&kolRows.length===20);assert.equal(await page.evaluate(()=>kolRows[0].artworkDetail),final);
 assert.deepEqual(errors,[]);await context.close();
 results.ok=true;fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(results,null,2));console.log('PASS',fixtureHash);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
