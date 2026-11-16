'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),os=require('node:os'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-priority-performance-')),app=path.resolve(__dirname,'../public');
const base=process.env.BUYER_LOG_PRIORITY_BASE || '08fefc06e6ac025c013fc2f89d69446b0dc395f5';
const output=process.env.BUYER_LOG_PRIORITY_PERF_JSON || path.join(dir,'performance.json');
const files=['chronological-values.js','business-rules.js','canonical-fields.js','order-decision-engine.js','backlog-delivery-engine.js','cp-readiness-engine.js','checklist-components-engine.js','cp-checklist-engine.js','cp-rules-engine.js','orders-priority-engine.js','orders-priority.js'];
fs.mkdirSync(path.join(dir,'baseline'));
for(const file of files)fs.writeFileSync(path.join(dir,'baseline',file),execFileSync('git',['show',base+':resources/app/public/'+file],{cwd:path.resolve(app,'../../..')}));
const server=http.createServer((req,res)=>{const parts=req.url.split('/'),variant=parts[1],file=parts[2];if(!file){res.statusCode=204;res.end();return;}if(file==='blank.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Buyer Log isolated calculation acceptance</title>');return;}let location=path.join(variant==='baseline'?path.join(dir,'baseline'):app,path.basename(file||''));if(!fs.existsSync(location))location=path.join(app,path.basename(file||''));if(!fs.existsSync(location)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(fs.readFileSync(location));});
let browser;
(async()=>{await new Promise(r=>server.listen(6480,'127.0.0.1',r));browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const pages={};for(const variant of ['baseline','candidate']){const page=await browser.newPage();page.on('pageerror',e=>console.error('BROWSER',variant,e.message));await page.goto(`http://127.0.0.1:6480/${variant}/blank.html`);for(const file of files)await page.addScriptTag({url:`/${variant}/${file}`});pages[variant]=page;console.log(variant,await page.evaluate(()=>({OD:typeof BLOrderDecisionEngine,Rules:typeof BLCpRulesEngine,Runner:typeof BLOrdersPriority})));}
const raw=[];
async function run(variant,multi){return pages[variant].evaluate(async(multi)=>{
const rows=Array.from({length:30000},(_,i)=>({'Order Code':'DEMO-'+i,'Model Name':'DEMO','C.Code':'01','STATUS':'Production','Ex-factory':'2026-12-01','Retail Date':'2027-02-01','Del. Type':'SEA','Order Quantity':100,'Remaining Units':100,Probe:i%100}));
const cat=BLOrderDecisionEngine.normalizePriorityCatalog([{id:'prio:a',tr:'A'},{id:'prio:b',tr:'B',hides:['prio:c']},{id:'prio:c',tr:'C'}]);
const rules=Array.from({length:20},(_,i)=>BLCpRulesEngine.normalizeRule({id:'p'+i,kind:'priority',target:multi?['prio:a','prio:b','prio:c'][i%3]:'prio:a',conditions:[{field:'Probe',operator:'gte',value:i*3}]}));
const spec={rules,priorityCatalog:cat};
const longs=[];const observer=new PerformanceObserver(list=>longs.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
const started=performance.now();const out=await BLOrdersPriority.run(rows,spec);const ms=performance.now()-started;await new Promise(r=>setTimeout(r,30));observer.disconnect();
let digest=0;for(let i=0;i<out.codes.length;i++)digest=(digest+out.codes[i].length*(i+1))%1000000007;
let renderMs=null;if(BLOrderDecisionEngine.resolvePriorityTags){const t=performance.now();for(let i=0;i<80;i++)BLOrderDecisionEngine.resolvePriorityTags(out.codes[i],out.priorityTags[i],out.tags[i]);renderMs=performance.now()-t;}
return {ms,mode:out.mode,digest,rows:out.codes.length,longTasks:longs,maxLongTask:Math.max(0,...longs),renderMs,matched:out.priorityTags?.at(-1)||null};
},multi);}
// Warm both environments; paired samples then use the same warmed state.
await run('baseline',false);await run('candidate',false);
for(let i=0;i<3;i++)for(const variant of ['baseline','candidate']){const result=await run(variant,false);raw.push({pair:i+1,variant,...result});console.log(JSON.stringify(raw.at(-1)));}
const multi=await run('candidate',true);assert.equal(multi.mode,'worker');assert.ok(multi.ms<=10000);assert.ok(multi.renderMs<=200);assert.equal(multi.matched.length,3);
const aa=[];for(let i=0;i<3;i++){const sample=await run('baseline',false);aa.push(sample.ms);console.log(JSON.stringify({aa:i+1,...sample}));}
const median=xs=>xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const baseline=raw.filter(r=>r.variant==='baseline'),candidate=raw.filter(r=>r.variant==='candidate');assert.ok(raw.every(r=>r.mode==='worker'&&r.digest===raw[0].digest&&r.rows===30000));
const result={runtime:await browser.version(),fixtureHash:crypto.createHash('sha256').update('30000 Orders, Probe=i%100, 20 gte rules Probe>=i*3').digest('hex'),base:base,raw,aa,median:{baseline:median(baseline.map(r=>r.ms)),candidate:median(candidate.map(r=>r.ms))},multi};
fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({median:result.median,multi}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
