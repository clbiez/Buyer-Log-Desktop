'use strict';
// Real HTTP and Buyer Log UI; a real 112 MiB pool rejects both source-copy
// and page-read admission. All source workbooks and persistence are synthetic.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {start}=require('./lib/client-performance-app'),XLSX=require('xlsx');
const appRoot=path.resolve(__dirname,'..'),injectionRoot=fs.mkdtempSync(path.join(os.tmpdir(),'bl-capacity-ui-'));
const preload=path.join(injectionRoot,'capacity.cjs'),evidence=path.join(injectionRoot,'capacity.jsonl');
fs.writeFileSync(preload,`
if (process.argv[1] && /server[\\\\/]server\\.js$/.test(process.argv[1])) {
  const fs=require('node:fs'),mod=require(${JSON.stringify(path.join(appRoot,'server/lib/compute-service'))});
  const {createComputePool}=require(${JSON.stringify(path.join(appRoot,'server/lib/compute-pool'))}),create=mod.createComputeService;
  mod.createComputeService=options=>{
    const service=create({...options,pool:createComputePool({memoryBudgetBytes:112*1024*1024,maxWorkers:1,maxPendingBytes:64*1024*1024})});
    for(const name of ['seedSource','run']) {
      const original=service[name];service[name]=async(...args)=>{
        const result=await original(...args);
        fs.appendFileSync(${JSON.stringify(evidence)},JSON.stringify({operation:name,inlineSource:result.inlineSource||false,fallbackReason:result.metrics?.fallbackReason||null,budget:service.stats().memoryBudgetBytes})+'\\n');
        return result;
      };
    }
    return service;
  };
}
`);
let app;
(async()=>{
  const oldOptions=process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS=[oldOptions,'--require='+preload].filter(Boolean).join(' ');
  try{app=await start();}finally{if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;}
  const before=await (await app.api('/api/data/cp')).json(),beforeBacklog=await (await app.api('/api/backlog')).json();
  const previousJob=await (await app.api('/api/refresh-status')).json();
  assert.ok(before.rows.length>0);
  const demo=require('./generate-demo-data').build({rows:24,seed:7,today:new Date('2026-11-08T00:00:00Z')});
  for(const [prefix,sheet,rows] of [['ASAS','ASAS',demo.asas],['Antrepo','Antrepo',demo.antrepo]]){
    const folder=path.join(app.root,'source'),file=fs.readdirSync(folder).find(name=>name.startsWith(prefix)&&name.endsWith('.xlsx'));
    assert.ok(file,prefix);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(folder,file));
  }
  assert.equal(await app.page.evaluate(()=>loadFromServer(true,['cp','orders','backlog','lfl','priceanalysis'])),true);
  const status=await (await app.api('/api/refresh-status')).json();assert.equal(status.phase,'done');assert.equal(status.error,null);
  assert.equal(status.serverInstanceId,previousJob.serverInstanceId,'refresh must not restart the server or lose its job');
  assert.notEqual(status.jobId,previousJob.jobId,'the new refresh finishes its own job');
  const cp=await (await app.api('/api/data/cp')).json(),orders=await (await app.api('/api/data/orders')).json(),backlog=await (await app.api('/api/backlog')).json();
  assert.ok(cp.rows.length>before.rows.length,'new active CP orders are visible');
  assert.ok(cp.rows.some(row=>Number(row['Order Code'])>=4100020),'CP includes orders added by this refresh');
  assert.equal(new Set(orders.orders.map(row=>row['Order Code'])).size,24);
  assert.ok(backlog.totalOrders>beforeBacklog.totalOrders,'new Backlog orders are visible');
  await app.page.evaluate(()=>switchTab('orders'));
  await app.page.waitForFunction(()=>state.orders&&!state.orders.deferred&&state.orders.rows?.length>=24&&document.querySelector('#ordersTable tbody tr'),null,{timeout:60000});
  await app.page.evaluate(()=>document.querySelectorAll('[data-ui-feedback-close]').forEach(button=>button.click()));
  const assets=path.join(appRoot,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await app.page.screenshot({path:path.join(assets,'compute-capacity-refresh-recovery.png')});
  assert.deepEqual(app.errors,[]);
  const events=fs.readFileSync(evidence,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(events.some(event=>event.operation==='seedSource'&&event.inlineSource));
  assert.ok(events.some(event=>event.fallbackReason==='COMPUTE_JOB_TOO_LARGE'));
  assert.ok(events.every(event=>event.budget===112*1024*1024));
  console.log('PASS real UI: refresh publishes the new 24-order dataset to CP/Orders/Backlog with an unchanged 112 MiB pool; source-copy and read capacity fallback exercised.');
  console.log('Evidence: '+app.root+'; '+evidence);
})().catch(error=>{console.error(error);if(app)console.error('Evidence: '+app.root);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
