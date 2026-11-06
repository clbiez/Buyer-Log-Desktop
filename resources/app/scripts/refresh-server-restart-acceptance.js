'use strict';
// Real HTTP + Buyer Log UI with synthetic data and isolated persistence.
// The server process is killed and restarted (as the watchdog does) while a refresh
// runs. The watcher must report the lost job within seconds instead of freezing the
// elapsed counter for 25 minutes and ending with "Refresh job could not be verified.".
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'refresh-server-restart-')),port=6495,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_USER_SESSION_SECRET:'abababababababababababababababababababababababababababababababab'};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:Number(process.env.ROWS)||8000,seed:7,today:new Date('2026-11-06T00:00:00Z')});
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',demo.antrepo]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser,page;
const startServer=()=>{server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function healthy(){for(let i=0;i<300;i++){try{if((await fetch(base+'/api/health')).status<500)return;}catch{}await sleep(200);}throw Error('server did not start');}
(async()=>{
  startServer();await healthy();
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-restart-123',password:'demo-restart-123'})});
  assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
  const first=await fetch(base+'/api/refresh',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({sync:true})});assert.equal(first.status,200);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']}).catch(()=>chromium.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1600,height:760},reducedMotion:'reduce'}),separator=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:240000});
  await page.evaluate(()=>applyLanguage('en'));
  await page.evaluate(()=>{window.__refreshRun=loadFromServer(true,['cp','orders','backlog','lfl']).catch(error=>{window.__refreshError=String(error&&error.message||error);});});
  await page.waitForFunction(()=>window.BL_REFRESH_JOB_STATE&&window.BL_REFRESH_JOB_STATE.running&&window.BL_REFRESH_JOB_STATE.serverInstanceId,null,{timeout:60000});
  const before=await page.evaluate(()=>window.BL_REFRESH_JOB_STATE.serverInstanceId);
  server.kill('SIGKILL');await new Promise(resolve=>server.once('exit',resolve));
  const killedAt=Date.now();await sleep(1500);startServer();await healthy();
  const status=await (await fetch(base+'/api/refresh-status',{headers:{cookie}})).json();
  assert.equal(status.jobId,null,JSON.stringify(status).slice(0,300));assert.ok(status.serverInstanceId&&status.serverInstanceId!==before);
  const modal=page.locator('#sourceRefreshFailureModal');await modal.waitFor({state:'visible',timeout:30000});
  const seconds=Math.round((Date.now()-killedAt)/1000);assert.ok(seconds<30,`lost job reported after ${seconds}s`);
  const text=await modal.innerText();
  assert.match(text,/The server restarted during the refresh/);assert.match(text,/server-restart\.log/);assert.match(text,/REFRESH_JOB_LOST/);
  assert.equal(await page.evaluate(()=>typeof isRefreshRunning==='function'?isRefreshRunning():false),false);
  // Hide unrelated demo-source notices so the dialog is the subject of the capture.
  await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>getComputedStyle(el).position==='fixed'&&!el.closest('#sourceRefreshFailureModal')&&!el.querySelector('#sourceRefreshFailureModal')&&el.id!=='sourceRefreshFailureModal'&&/INFORMATION|BİLGİ/i.test(el.textContent||'')&&el.textContent.length<600).forEach(el=>{el.style.display='none';}));
  await page.waitForTimeout(400);
  const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'refresh-server-restart-lost-job.png')});
  assert.deepEqual(errors,[]);
  console.log(`PASS real UI: server restart during refresh is reported in ${seconds}s with a lost-job diagnosis; screenshot captured.`);
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server&&server.exitCode==null&&server.signalCode==null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await exited;clearTimeout(timer);}
  fs.closeSync(log);
});
