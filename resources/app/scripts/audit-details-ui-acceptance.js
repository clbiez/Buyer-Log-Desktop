'use strict';
// Real Buyer Log session and PNG, entirely on generated demo data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-audit-ui-'));
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,base,cookie='';
async function api(url,body){
  const response=await fetch(base+url,{method:body?'POST':'GET',signal:AbortSignal.timeout(60000),headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(response.ok,url+': '+response.status);return response;
}
(async()=>{
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
  const source=path.join(root,'source'),generated=spawnSync(process.execPath,[path.join(__dirname,'generate-demo-data.js'),source,'--rows','20','--seed','7'],{cwd:app,encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
  const log=fs.openSync(path.join(root,'server.log'),'a');server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
  let ready=false;for(let i=0;i<120;i++){try{await api('/api/status');ready=true;break;}catch(_){}await delay(250);}assert.ok(ready,'Synthetic server did not start');
  const login=await api('/api/user-login',{userId:'moderator',password:'synthetic-audit-only-123',newPassword:'synthetic-audit-only-123'});cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});let refreshed=false;
  for(let i=0;i<240;i++){const status=await (await api('/api/refresh-status')).json();if(!status.running){assert.equal(status.error,null);refreshed=true;break;}await delay(250);}assert.ok(refreshed);
  const auditFile=path.join(root,'data','user-audit.jsonl'),lines=fs.readFileSync(auditFile,'utf8').trim().split('\n');
  const sessions=lines.map(line=>({line,record:JSON.parse(line)})).filter(({record})=>['LOGIN','PASSWORD_SETUP','LOGOUT'].includes(record.action));
  assert.ok(sessions.some(({record})=>record.action==='LOGIN'));
  for(const {line,record} of sessions){assert.equal(record.details,null);assert.equal(line.includes('orderAccess'),false);assert.ok(Buffer.byteLength(line)<1024);}
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),split=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
  await context.addInitScript(()=>{
    for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');
  });
  const page=await context.newPage();await page.route('https://**',route=>route.abort());
  await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('[data-boot-continue]',{timeout:180000});await page.click('[data-boot-continue]');
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:30000});
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
  await page.evaluate(()=>window.openUserAccessAdmin());
  await page.waitForSelector('.umOverlay .umMain .umSection',{timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('.umOverlay .umLoading'),null,{timeout:30000});
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
  assert.equal(await page.locator('.blRnDialog[open]').count(),0,'release notes must not cover the admin session');
  const screenshot=path.join(app,'public/release-notes/next-assets/audit-session-details.png');
  await page.screenshot({path:screenshot});
  fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify({synthetic:true,screenshot,sessionRecords:sessions.map(({line,record})=>({action:record.action,bytes:Buffer.byteLength(line+'\n'),details:record.details})),note:'PNG shows the actual authorized admin session. Null details/size are verified from this session audit file, not visually inferred.'},null,2));
  console.log('Screenshot: '+screenshot+'; runtime evidence: '+root);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  try{await browser?.close();}finally{if(server&&server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([done,delay(10000)]);if(server.exitCode===null){server.kill('SIGKILL');await done;}}}
});
