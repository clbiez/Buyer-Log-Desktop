'use strict';
/* Automated UI capture (isolated demo only).
   Capture a genuine post-change Buyer Log screen using synthetic demo data.
   NEVER connect to company data or upload production Outlook messages. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require('playwright');
const APP_ROOT = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-ros-visual-'));
const port = 6421;
const base = 'http://127.0.0.1:' + port;
const password = 'local-demo-only-visual-password';
const target = path.join(APP_ROOT,'public/release-notes/next-assets/ros-labdip-review-20261008.png');
const env = {
  ...process.env,
  BUYER_LOG_SERVER_DATA_ROOT: path.join(work,'server'),
  BUYER_LOG_DATA_ROOT: path.join(work,'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(work,'local'),
  BUYER_LOG_CONFIG_PATH: path.join(work,'config.json'),
  BUYER_LOG_TEMP_ROOT: path.join(work,'temp'),
};
let server, browser;
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function start() {
  const source = path.join(work,'demo-source');
  const seed = spawnSync(process.execPath,[path.join(__dirname,'generate-demo-data.js'),source,'--rows','40'],{cwd:APP_ROOT,encoding:'utf8'});
  if (seed.status!==0) throw Error('Demo source failed: '+seed.stderr);
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:source}));
  server = spawn(process.execPath,[path.join(APP_ROOT,'server/server.js')],{cwd:APP_ROOT,env,stdio:['ignore','ignore','inherit']});
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).status<500){ready=true;break;}}catch(_){ }await delay(250);}
  if(!ready) throw Error('Demo server failed to start');
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});
  if(!login.ok) throw Error('Demo login failed: '+login.status);
  const cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
  const api=(url,opts={})=>fetch(base+url,{...opts,headers:{cookie,'Content-Type':'application/json',...(opts.headers||{})}});
  const ref=await api('/api/refresh',{method:'POST',body:'{}'});
  if(!ref.ok)throw Error('Demo refresh failed: '+ref.status);
  for(let i=0;i<240;i++){let v=await(await api('/api/refresh-status')).json();if(!v.running)break;await delay(300);}
  const result=await(await api('/api/data/cp')).json();
  const row=(result.rows||[]).find(r=>r['Model Name']&&r['Order Code']&&r['Colour']);
  if(!row)throw Error('Demo CP did not contain an order/model/colour');
  return {row,cookie};
}
function mail(row){
  const model=String(row['Model Name']).replace(/[\r\n\t]+/g,' ');
  const code=String(row['C.Code']||'C81').replace(/[\r\n\t]+/g,' ');
  const colour=String(row.Colour||'DEMO BLUE').replace(/[\r\n\t]+/g,' ');
  const body=[
    'Submit Type\tLabdip',
    'Color Code-Name\tModel Name',
    code+' - '+colour+'\t'+model,
    'Color Resulting Date\tRound\tColor Analyst\tComment By\tResult\tSubmit No\tApproved Best Date\tRequest Type\tUrl',
    '08.10.2026\t1\tDemo Analyst\tNO DARKER / NO YELLOWER\tDigital Approved\tA\t\tLabdip\trequestId=910821',
    'Color Code-Name\tModel Name',
    'T77 - CONTRAST BLUE\t'+model,
    'Color Resulting Date\tRound\tColor Analyst\tComment By\tResult\tSubmit No\tApproved Best Date\tRequest Type\tUrl',
    '08.10.2026\t1\tDemo Analyst\tS/B LIGHTER / GREENER\tRejected\tC\t\tLabdip\trequestId=910821',
  ].join('\r\n');
  return Buffer.from('Subject: LCW- ROS - Color Evaluation Notification\r\nFrom: demo@example.invalid\r\nDate: Thu, 08 Oct 2026 12:00:00 +0300\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+body,'utf8');
}
async function capture(){
  const {row,cookie}=await start();
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:1600,height:900}});
  const [name]=cookie.split('=');
  await ctx.addCookies([{name,value:cookie.slice(name.length+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  const page=await ctx.newPage();
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.BLPerf&&document.querySelector('nav.tabs button[data-tab="cp"]'),null,{timeout:60000});
  const continueButton=page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/);
  await continueButton.waitFor({timeout:25000}).then(()=>continueButton.click()).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:40000});
  await page.locator('nav.tabs button[data-tab="cp"]').click();
  await page.evaluate(async ()=>{
    await window.BLPerf.ensureFeature('cpAssistant');
    await window.BLPerf.ensureFeature('testReportImport');
    await window.BLCpAssistant.createChecklistItem({tr:'Lab Dip onayı',en:'Lab Dip approval'});
    await window.BLTestReportImport.open();
  });
  const input=page.locator('#_blTestReportImport [data-tr-input]');
  await input.setInputFiles({name:'demo-ros.eml',mimeType:'message/rfc822',buffer:mail(row)});
  await page.waitForFunction(()=>document.querySelector('#_blTestReportImport .trLabDipDetails summary'),null,{timeout:45000});
  await page.locator('#_blTestReportImport .trLabDipDetails summary').first().click();
  await page.waitForTimeout(500);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  await page.screenshot({path:target,fullPage:false,animations:'disabled'});
  console.log('Captured genuine demo Buyer Log ROS visual: '+target+' ('+fs.statSync(target).size+' bytes)');
}
capture().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{
  try{if(browser)await browser.close();}catch(_){}
  if(server)server.kill();
  fs.rmSync(work,{recursive:true,force:true});
});
