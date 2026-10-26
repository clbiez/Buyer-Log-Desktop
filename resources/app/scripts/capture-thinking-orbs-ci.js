'use strict';
// Temporary acceptance capture: real Buyer Log server, isolated data root and Chrome.
// Uses no corporate data; the loaded application owns the startup orb.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-thinking-orbs-'));
const port=6463,base='http://127.0.0.1:'+port;
const env={...process.env,BUYER_LOG_SERVER_DATA_ROOT:path.join(temp,'server'),BUYER_LOG_DATA_ROOT:path.join(temp,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(temp,'local'),BUYER_LOG_CONFIG_PATH:path.join(temp,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(temp,'tmp')};
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port}));
let server,browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  server=spawn(process.execPath,[path.join(root,'server','server.js')],{cwd:root,env,stdio:['ignore','ignore','pipe']});
  let stderr='';
  server.stderr.on('data',chunk=>{stderr+=(chunk.toString().slice(0,1200));});
  let online=false;
  for(let i=0;i<150;i++){
    if(server.exitCode!==null)break;
    try{const a=await fetch(base+'/api/health');if(a.status<500){online=true;break;}}catch(_){}
    await delay(250);
  }
  if(!online)throw Error('Server did not start: '+stderr.slice(-1200));
  const auth=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'acceptance-pass-123',password:'acceptance-pass-123'})});
  if(!auth.ok)throw Error('Demo moderator login failed: HTTP '+auth.status);
  const cookie=(auth.headers.get('set-cookie')||'').split(';')[0];
  if(!cookie.includes('='))throw Error('No session cookie');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'tr-TR'});
  const split=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base}]);
  const page=await context.newPage();
  // Profile can be slow on a real installation; keep it pending briefly so that
  // the startup state can be captured rather than the fully loaded dashboard.
  await page.route('**/api/current-user*',async route=>{await delay(3200);await route.continue().catch(()=>{});});
  await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:45000});
  const orb=page.locator('#blBootGuard canvas.blBootOrb');
  await orb.waitFor({state:'visible',timeout:15000});
  // Capture the first painted loading frame before fast demo startup completes.
  const rendered=await page.evaluate(()=>{
    const canvas=document.querySelector('#blBootGuard canvas.blBootOrb');
    if(!canvas)return {found:false};
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let painted=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)painted++;
    return {found:true,painted,width:canvas.width,height:canvas.height,visible:!!canvas.getBoundingClientRect().width};
  });
  if(!rendered.found||rendered.painted<5||!rendered.visible)throw Error('Orb not painted: '+JSON.stringify(rendered));
  const png=await page.screenshot({type:'png',fullPage:false,animations:'allow'});
  fs.writeFileSync(path.join(temp,'thinking-orbs-post-change.png'),png);
  console.log('BUYERLOG_VISUAL_PROOF '+JSON.stringify({browser:'chrome',server:'Buyer Log server.js',state:'startup waiting',canvas:rendered,dimensions:'1280x720',bytes:png.length}));
  console.log('BUYERLOG_PNG_BEGIN'+png.toString('base64')+'BUYERLOG_PNG_END');
}
run().catch(e=>{console.error('CAPTURE_ERROR '+e.stack);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(server){server.kill();await delay(100);}
  fs.rmSync(temp,{recursive:true,force:true});
});
