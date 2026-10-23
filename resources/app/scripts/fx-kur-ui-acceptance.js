'use strict';
/* Real Buyer Log UI on isolated synthetic workbooks. Only /api/lcwai/ask is
 * intercepted in Playwright. A synthetic desktop session is seeded only in
 * the child server's memory; no token is written, logged or sent to the UI.
 * Run with NODE_PATH pointing to Playwright and optionally
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, BUYER_LOG_FX_ACCEPTANCE_ROOT. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),app=path.resolve(__dirname,'..'),XLSX=require('xlsx');
const prompt=require('../server/lib/lcwai/lcwai-prompt');
const root=process.env.BUYER_LOG_FX_ACCEPTANCE_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-fx-ui-'));
const captureRoot=process.env.BUYER_LOG_FX_SCREENSHOT_ROOT||path.join(app,'public/release-notes/next-assets');fs.mkdirSync(captureRoot,{recursive:true});
const port=Number(process.env.BUYER_LOG_FX_ACCEPTANCE_PORT||6458),base=`http://127.0.0.1:${port}`,env={...process.env};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');fs.mkdirSync(path.join(root,'source'),{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
function book(rows,sheetName,file){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheetName);XLSX.writeFile(wb,file);}
const demo=(month,rate)=>[['Demo FX forecast'],[null,null,month],[null,'TRY',rate],[null,'EUR',.9],[null,'GBP',.8]];
book(demo('2026-10',40),'Demo',path.join(root,'source/KUR.xlsx'));book(demo('2026-11',50),'Demo',path.join(root,'November.xlsx'));
const shiftedRows=[['Demo shifted FX forecast — 1 USD = X units'],[null,null,null,'Currency',null,'Nov 2026','Dec 2026'],[null,null,null,'TRY',null,70,71],[null,null,null,'EUR',null,.89,.88],[null,null,null,'GBP',null,.79,.78],[null,null,null,'CHF',null,.85,.84],[null,null,null,'CNY',null,7.1,7.2]];
book(shiftedRows,'Shifted demo',path.join(root,'Shifted.xlsx'));
let server,browser,page,context;const log=fs.openSync(path.join(root,'server.log'),'a'),errors=[];
// Exercise the production in-memory desktop holder and auth, with fake claims.
// The fake token can never authorize a remote request; only ask is intercepted.
const bootstrap=`const ai=require('./server/lib/lcwai');const cfg=ai.config;const b=v=>Buffer.from(JSON.stringify(v)).toString('base64url');ai.getDesktopTokenHolder().set(b({alg:'none'})+'.'+b({iss:cfg.KEYCLOAK.issuer,azp:cfg.KEYCLOAK.clientId,exp:Math.floor(Date.now()/1000)+3600})+'.demo');ai.getDefaultEngine().getStatus('moderator').then(()=>require('./server/server.js'));`;
async function start(){server=spawn(process.execPath,['-e',bootstrap],{cwd:app,env,stdio:['ignore',log,log]});for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Server startup timeout');}
async function stop(){if(server){const stopped=new Promise(r=>server.once('exit',r));server.kill();await stopped;server=null;}}
async function login(){const r=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-fx-test-123',password:'demo-fx-test-123'})});assert.equal(r.status,200,await r.text());const cookie=r.headers.get('set-cookie').split(';')[0],i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),domain:'127.0.0.1',path:'/'}]);}
async function open(){await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',null,{timeout:60000});await page.waitForFunction(()=>!document.getElementById('blBootGuard')||document.querySelector('[data-boot-continue]'),null,{timeout:60000});if(await page.locator('[data-boot-continue]').count())await page.locator('[data-boot-continue]').click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());switchTab('source');});await page.locator('[data-tool="fx"]').waitFor();await page.evaluate(()=>BLPerf.ensureFeature('fx'));}
const store=()=>page.evaluate(async()=>await(await fetch('/api/fx',{cache:'no-store'})).json());
(async()=>{
 await start();browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 context=await browser.newContext({viewport:{width:1440,height:920},reducedMotion:'reduce'});await login();
 await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');setInterval(()=>document.querySelectorAll('.blRnDialog[open]').forEach(d=>d.close()),100);});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let asks=0,invalidDirection=false;
 const layout={sheetName:'Shifted demo',headerRow:2,monthColumns:[{col:'F',month:'2026-11'},{col:'G',month:'2026-12'}],codeColumn:'D',firstDataRow:3,lastDataRow:7,direction:'per_usd',scale:1,confidence:.94,warnings:[]};
 await page.route('**/api/lcwai/ask',async route=>{
  asks++;const input=route.request().postDataJSON();assert.equal(input.source,'fx-kur-layout');assert.equal(input.attachments.length,0);assert.ok(input.context.sheetPreviews[0].previewLines[1].includes('F2=Nov 2026'));assert.ok(!JSON.stringify(input.context).includes(root));
  const raw={...layout,direction:invalidDirection?'usd_per_unit':'per_usd',rates:{TRY:999}};
  const parsed=prompt.parseStructured(JSON.stringify(raw),'fx-kur-layout');assert.equal(parsed.ok,true);assert.equal(parsed.data.rates,undefined);
  await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{data:{...parsed.data,rates:{TRY:999}},structured:{expected:true,ok:true},text:JSON.stringify(raw)}})+'\n'});
 });
 await open();assert.equal(asks,0);
 await page.locator('#sourceFxFile').setInputFiles(path.join(root,'November.xlsx'));await page.waitForFunction(()=>BLFX.store.reportMonth==='2026-11');assert.equal((await store()).months['2026-11'].TRY,50);console.log('PASS November UI upload');
 await stop();await start();await login();await open();
 await page.evaluate(()=>fetch('/api/startup/ready',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 await page.waitForFunction(async()=>((await(await fetch('/api/fx')).json()).folderSync?.reason==='older-report'),null,{timeout:20000});
 await page.evaluate(async()=>{await BLFX.load(true);renderSourceFxFreshness(BLFX.store);});assert.equal((await store()).months['2026-11'].TRY,50);
 await page.locator('[data-fx-folder-sync]').waitFor();await page.locator('[data-fx-folder-sync]').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(captureRoot,'fx-folder-newer-report-guard.png')});console.log('PASS restart preserves November and shows older-folder warning');
 // Explicit folder override needs confirmation; cancel leaves the master intact.
 page.once('dialog',d=>d.dismiss());await page.locator('[data-fx-folder-sync] button').click();assert.equal((await store()).months['2026-11'].TRY,50);
 // A failed source upload opens recovery without an automatic AI request.
 const before=await store();await page.locator('#sourceFxFile').setInputFiles(path.join(root,'Shifted.xlsx'));await page.locator('#fxImportRecovery').waitFor();assert.equal(asks,0);assert.equal(await page.locator('[data-fx-recovery-save]').isDisabled(),true);
 invalidDirection=true;await page.locator('[data-fx-read-ai]').click();await page.locator('[data-fx-differences]').waitFor();assert.equal(await page.locator('[data-fx-recovery-save]').isDisabled(),true);assert.match(await page.locator('#fxImportRecovery').innerText(),/TRY/);assert.equal((await store())._revision,before._revision);console.log('PASS reversed TRY blocks saving');
 invalidDirection=false;await page.locator('[data-fx-read-ai]').click();await page.waitForFunction(()=>!document.querySelector('[data-fx-recovery-save]').disabled);assert.ok(await page.locator('.ocFxDiffFlag').count());assert.match(await page.locator('[data-fx-differences]').innerText(),/50 → 70/);assert.equal((await store())._revision,before._revision);
 await page.screenshot({path:path.join(captureRoot,'fx-lcwai-layout-preview.png')});
 page.once('dialog',d=>d.dismiss());await page.locator('[data-fx-recovery-save]').click();assert.equal((await store())._revision,before._revision);
 page.once('dialog',d=>d.accept());await page.locator('[data-fx-recovery-save]').click();await page.locator('#fxImportRecovery').waitFor({state:'detached'});
 const saved=await store();assert.equal(saved.parser,'lcwai-layout');assert.equal(saved.sourceType,'LCWAI');assert.equal(saved.months['2026-11'].TRY,70);assert.ok(/^[a-f0-9]{64}$/.test(saved.sourceFingerprint));console.log('PASS source recovery previews differences and saves original cells only after confirmation');
 // Failed folder parsing is visible and retrieves the original grid via the worker.
 await stop();fs.copyFileSync(path.join(root,'Shifted.xlsx'),path.join(root,'source/KUR.xlsx'));await start();await login();await open();
 await page.waitForFunction(async()=>((await(await fetch('/api/fx')).json()).folderSync?.reason==='parse-failed'),null,{timeout:20000});
 await page.evaluate(async()=>{await BLFX.load(true);renderSourceFxFreshness(BLFX.store);});
 await page.locator('[data-fx-folder-sync] button').click();await page.locator('#fxImportRecovery').waitFor();assert.equal(asks,2);
 await page.locator('[data-fx-read-ai]').click();await page.locator('[data-fx-differences]').waitFor();assert.equal(asks,3);await page.locator('[data-fx-recovery-close]').first().click();console.log('PASS failed folder sync offers user initiated layout recovery from the original grid');
 // Open Costing uses the same recovery surface and makes no request on open.
 await page.evaluate(()=>switchTab('opencosting'));await page.locator('#ocFxBtn').click();assert.equal(asks,3);
 await page.locator('#ocFxFile').setInputFiles(path.join(root,'Shifted.xlsx'));await page.locator('#fxImportRecovery').waitFor();assert.equal(asks,3);await page.locator('[data-fx-read-ai]').click();await page.locator('[data-fx-differences]').waitFor();assert.equal(asks,4);await page.locator('[data-fx-recovery-close]').first().click();console.log('PASS costing recovery is user initiated');
 // Disconnected status is real; no status route is intercepted.
 await page.evaluate(()=>fetch('/api/lcwai/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 await page.locator('#ocFxFile').setInputFiles(path.join(root,'Shifted.xlsx'));await page.locator('[data-fx-read-ai]').click();await page.locator('#_lcwaiConnection').waitFor();assert.equal(asks,4);console.log('PASS disconnected LCW AI opens connection flow without ask');
 assert.deepEqual(errors,[]);console.log('PASS browser acceptance complete');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await stop();});
