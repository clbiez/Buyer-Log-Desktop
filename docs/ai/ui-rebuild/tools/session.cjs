'use strict';
// Isolated real server + Chromium. Only deterministic synthetic records are imported.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.BL_PLAYWRIGHT||'/workspace/.buyerlog-tools/node_modules/playwright');
const app=path.resolve(process.argv[2]||'resources/app'),port=Number(process.env.BL_AUDIT_PORT||6471),cdp=Number(process.env.BL_AUDIT_CDP||9231),base='http://127.0.0.1:'+port;
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-ui-audit-'));
let child,browser,output='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const XLSX=require(app+'/node_modules/xlsx'),{build}=require(app+'/scripts/generate-demo-data');
 const source=path.join(root,'source');fs.mkdirSync(source);
 const data=build({rows:220,seed:7,today:new Date('2026-10-25T12:00:00Z')});
 for(const [key,file] of [['asas','ASAS'],['antrepo','Antrepo'],['lfl','LFL']]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data[key]),file);XLSX.writeFile(wb,path.join(source,file+'.xlsx'));}
 const env={...process.env,BUYER_LOG_DATA_ROOT:root+'/app',BUYER_LOG_LOCAL_DATA_ROOT:root+'/local',BUYER_LOG_SERVER_DATA_ROOT:root+'/server',BUYER_LOG_AUTH_DATA_ROOT:root+'/server/auth',BUYER_LOG_TEMP_ROOT:root+'/temp',BUYER_LOG_CONFIG_PATH:root+'/config.json',BL_KEEP_ALIVE:'1'};
 for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
 fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
 child=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output=(output+b).slice(-6000));child.stderr.on('data',b=>output=(output+b).slice(-6000));
 let ready=false;for(let i=0;i<200;i++){try{if((await fetch(base+'/api/user-profiles')).ok){ready=true;break;}}catch{}await pause(250);}assert.ok(ready,'Server startup');
 const password=crypto.randomBytes(24).toString('hex');const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 const api=async(url,options={})=>{const r=await fetch(base+url,{...options,headers:{cookie,'Content-Type':'application/json'}});assert.ok(r.ok,url+': '+r.status);return r.json();};
 await api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<200;i++){if(!(await api('/api/refresh-status')).running)break;await pause(250);}
 // Fully received orders are intentionally absent from the active CP projection.
 const cp=await api('/api/data/cp');assert.equal(cp.rows.length,191);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--remote-debugging-port='+cdp]});
 const context=await browser.newContext({viewport:{width:1440,height:900},locale:'tr-TR',timezoneId:'UTC',permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
 const [name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:base}]);
 const page=await context.newPage();await page.goto(base+'/',{waitUntil:'domcontentloaded'});
 console.log(JSON.stringify({status:'ready',base,cdp,root,app,rows:cp.rows.length,browser:browser.version(),node:process.version}));
 // Keep the isolated session alive while read-only capture scripts connect via CDP.
 await new Promise(resolve=>{process.on('SIGTERM',resolve);process.on('SIGINT',resolve);});
}
main().catch(e=>{console.error(e.message);console.error(output.slice(-2000));process.exitCode=1;}).finally(async()=>{await browser?.close();if(child&&child.exitCode===null)child.kill('SIGTERM');fs.rmSync(root,{recursive:true,force:true});});
