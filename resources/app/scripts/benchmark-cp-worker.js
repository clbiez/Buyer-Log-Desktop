'use strict';
// Real Chromium, synthetic rows, canonical engines; localhost only. Each
// measurement uses a fresh browser context so parity hashing cannot contaminate
// the next measurement with a previous model's garbage collection.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=new Set(['business-rules.js','order-decision-engine.js','backlog-delivery-engine.js','cp-readiness-engine.js','cp-decision-runtime.js','cp-decision-worker.js']);
const server=http.createServer((req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!file){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>CP local benchmark</title>');return;}
  if(!files.has(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../public',file)));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
    const base='http://127.0.0.1:'+server.address().port,measurements=[];let previousDigest;
    for(const kind of ['worker','cooperative','worker','cooperative','worker','cooperative']){
      const context=await browser.newContext(),page=await context.newPage();await page.goto(base);
      for(const file of files)if(file!=='cp-decision-worker.js')await page.addScriptTag({url:base+'/'+file});
      const result=await page.evaluate(async({kind,count})=>{
        const E=globalThis.BLCpReadinessEngine,R=globalThis.BLCpDecisionRuntime;
        const rows=Array.from({length:count},(_,i)=>({'Order Code':String(i),'Order Quantity':100,'STATUS':i%2?'Production':'In Transit','Ex-factory':'2026-10-05','Retail Date':'2026-12-01','In-Store (Model Budget)':'2026-12-10','Country':'TR','Del. Type':'Gemi','Model Name':'DEMO','C.Code':'RED'}));
        const ctx={today:E.defaultOrdinal(new Date())};let lag=0,previous=performance.now(),raf=0,previousFrame=null,maxFrameGapMs=0;
        const sampler=setInterval(()=>{const tick=performance.now();lag=Math.max(lag,tick-previous-5);previous=tick;},5);
        function frame(tick){if(previousFrame!==null)maxFrameGapMs=Math.max(maxFrameGapMs,tick-previousFrame);previousFrame=tick;raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
        // The baseline explicitly keeps the original cooperative timer yield.
        const runtime=R.create({contextKey:()=>1,analyzeRow:E.analyzeOrder,summarize:E.summarizeAnalyses,workerFactory:kind==='worker'?()=>new Worker('/cp-decision-worker.js'):null});
        const start=performance.now(),model=await runtime.computeAsync(rows,ctx),durationMs=performance.now()-start;
        await new Promise(resolve=>setTimeout(resolve,20));clearInterval(sampler);cancelAnimationFrame(raf);
        const value=JSON.stringify([model,model.orders,model.priorityGroups,Object.fromEntries(Object.entries(model.loadingPlan).map(([key,bucket])=>[key,bucket.items]))]);
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
        const out={kind,rows:count,durationMs,maxTimerLagMs:lag,maxFrameGapMs,stats:runtime.getStats(),digest};runtime.dispose();return out;
      },{kind,count:Math.max(128,Number(process.argv[2])||10000)});
      const {digest,...measurement}=result;measurement.canonicalParity=!previousDigest||digest===previousDigest;previousDigest=digest;measurements.push(measurement);await context.close();
    }
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const summary=Object.fromEntries(['cooperative','worker'].map(kind=>{const values=measurements.filter(value=>value.kind===kind);return[kind,{medianDurationMs:median(values.map(value=>value.durationMs)),medianMaxTimerLagMs:median(values.map(value=>value.maxTimerLagMs)),medianMaxFrameGapMs:median(values.map(value=>value.maxFrameGapMs))}];}));
    console.log(JSON.stringify({synthetic:true,summary,measurements},null,2));
    if(measurements.some(value=>!value.canonicalParity))throw new Error('CP_CANONICAL_PARITY_FAILED');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
