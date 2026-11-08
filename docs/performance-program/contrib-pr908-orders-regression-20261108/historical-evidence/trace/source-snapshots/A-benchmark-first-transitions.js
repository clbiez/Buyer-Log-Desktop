'use strict';

// Tam Faz 0 koşusunun sentetik cache'ini izole bir köke kopyalar. Refresh POST'u yok.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {installProbe,requestJson,parseStalls}=require('./lib/startup-benchmark');
const {installFirstTransitionProbe,validateFirstTransition}=require('./lib/first-transition-probe');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const app=path.resolve(arg('--app-root',path.join(__dirname,'..'))),input=path.resolve(arg('--measurement',''));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-first-transition-'));
const output=path.resolve(arg('--out',path.join(root,'measurement.json'))),logFile=path.join(root,'server.log');
const report={schemaVersion:1,synthetic:true,scenario:'first-intent-after-startup',startedAt:new Date().toISOString(),app,input,fixtureRoot:root,status:'running',transitions:[],rendererErrors:[]};
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local/BuyerLogLocal.db'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,base,cookie='';
function persist(){
  report.stalls=fs.existsSync(logFile)?parseStalls(fs.readFileSync(logFile,'utf8')):[];
  report.serverLog=logFile;
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.partial',JSON.stringify(report,null,2)+'\n');
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
  await Promise.race([done,delay(10000)]);if(server.exitCode===null){server.kill('SIGKILL');await done;}
}
(async()=>{
  const original=JSON.parse(fs.readFileSync(input,'utf8'));
  assert.equal(original.synthetic,true);assert.equal(original.status,'passed');
  assert.equal(original.schemaVersion,3);assert.equal(original.measurements.length,4,'a complete Phase 0 measurement is required');
  const sourceRoot=path.resolve(original.fixtureRoot);
  assert.equal(path.dirname(sourceRoot),path.resolve(os.tmpdir()));assert.ok(path.basename(sourceRoot).startsWith('buyerlog-startup-'));
  assert.equal(fs.realpathSync(sourceRoot),sourceRoot);
  const marker=JSON.parse(fs.readFileSync(path.join(sourceRoot,'source/benchmark-fixture.json'),'utf8'));
  assert.equal(marker.synthetic,true);assert.equal(marker.rows,original.requestedRows);
  assert.deepEqual(marker.hashes,original.fixture.hashes);
  for(const [file,hash] of Object.entries(marker.hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,'source',file))).digest('hex'),hash);
  fs.cpSync(sourceRoot,root,{recursive:true,filter:src=>{
    const relative=path.relative(sourceRoot,src);
    return relative!=='server.log'&&!relative.startsWith('local'+path.sep+'logs')&&!(path.dirname(src)===sourceRoot&&src.endsWith('.png'));
  }});
  const config=JSON.parse(fs.readFileSync(env.BUYER_LOG_CONFIG_PATH,'utf8'));
  const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  config.port=port;config.host='127.0.0.1';config.updates={enabled:false};fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify(config));base='http://127.0.0.1:'+port;
  report.expected=original.expected;report.fixtureHashes=marker.hashes;report.sourceRows=marker.rows;persist();
  const log=fs.openSync(logFile,'a');server=spawn(process.execPath,[path.join(app,'server/server.js')],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
  let ready=false;
  for(let i=0;i<120;i++){
    if(server.exitCode!==null)throw Error('Synthetic server exited: '+server.exitCode);
    try{await requestJson(base+'/api/status');ready=true;break;}catch(_){}await delay(250);
  }
  assert.ok(ready,'Synthetic server did not start');
  const login=await fetch(base+'/api/user-login',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'synthetic-startup-only-123'})});
  assert.ok(login.ok,'Synthetic login failed: '+login.status);cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  for(const module of ['cp','orders']){
    const context=await browser.newContext({viewport:{width:1440,height:900}}),split=cookie.indexOf('=');
    try{
      await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
      const page=await context.newPage(),generations=[],errors=[];
      page.on('console',message=>{if(/^BENCHMARK_(LIFECYCLE|FIRST_PROGRESS) /.test(message.text()))console.log(module+' '+message.text());});
      page.on('pageerror',error=>{errors.push(error.message);report.rendererErrors.push({module,message:error.message});});
      page.on('response',response=>{
        if(new URL(response.url()).pathname.startsWith('/api/page-projection/')&&response.status()===200){const generation=response.headers()['x-page-cache-generation'];if(generation)generations.push(generation);}
      });
      await page.route('https://**',route=>route.abort());
      await page.addInitScript(()=>{
        for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');
        window.__firstTransitionGeneration=null;
        const json=Response.prototype.json;Response.prototype.json=async function(...args){const value=await json.apply(this,args);if(new URL(this.url,location.href).pathname==='/api/data'&&value.pageCache)window.__firstTransitionGeneration=value.pageCache.generation;return value;};
      });
      await page.addInitScript(installProbe,{sampleWindowMs:10000,logEvents:true});
      await page.addInitScript(installFirstTransitionProbe,{module,expectedRows:original.expected.rows[module],logEvents:true});
      await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupReadyMs),null,{timeout:900000,polling:100});
      await page.evaluate(()=>{const p=window.__startupProbe;p.continueIntentAtMs=p.startupReadyMs;p.continueAtMs=performance.now();window.BLBootGuard.continue({intentAtMs:p.continueIntentAtMs});});
      await page.waitForFunction(()=>['passed','failed'].includes(window.__benchmarkFirstTransition?.status),null,{timeout:960000,polling:100});
      const result=await page.evaluate(()=>({...window.__benchmarkFirstTransition,startup:window.__startupProbe,initialGeneration:window.__firstTransitionGeneration,
        revisions:{orders:Number(state.storeRevisions.orders)||0,suppFob:Number(state.storeRevisions.suppFob)||0}}));
      result.projectionGenerations=generations;result.errors=errors;report.transitions.push(result);persist();
      validateFirstTransition(result,original.expected,original.measurements.find(item=>item.module==='overview').initialGeneration);
      const manifest=JSON.parse(fs.readFileSync(path.join(root,'local/page-cache/moderator/manifest.json'),'utf8'));
      assert.equal(manifest.activeGeneration,original.expected.generation);assert.equal(manifest.sourceRevisionKey,original.expected.sourceRevision);
      await page.screenshot({path:path.join(root,module+'.png'),timeout:900000});
      console.log(module+' first intent: '+Math.round(result.elapsedMs)+' ms; system to paint '+Math.round(result.paintedAtMs-result.startup.userWaitMs)+' ms');
    }finally{await context.close();}
  }
  report.status='passed';
})().catch(error=>{report.status='failed';report.error={message:error.message,stack:error.stack};console.error(error);process.exitCode=1;}).finally(async()=>{
  try{await browser?.close();}finally{await stop();report.finishedAt=new Date().toISOString();persist();fs.renameSync(output+'.partial',output);console.log('Report: '+output+'; retained diagnostics: '+root);}
});
