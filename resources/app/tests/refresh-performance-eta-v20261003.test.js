'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const perf=require('../server/lib/refresh-performance');

const ROOT=path.join(__dirname,'..');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

function profile(rowCount=18000){
  return perf.buildRefreshProfile({
    targets:['backlog','orders'],
    sourceModes:{asas:'database',antrepo:'database'},
    rowCounts:{backlog:rowCount,orders:rowCount},
    horizons:[{targets:['backlog','orders'],horizon:{table:'Orders',seasons:['SS27'],dateStart:'2026-01-01',dateEnd:'2026-12-31'}}],
  });
}

test('refresh ETA profili ham horizon ayrıntısını paylaşmadan kararlı imza üretir',()=>{
  const a=profile(18420);
  const b=perf.buildRefreshProfile({
    targets:['orders','backlog'],
    sourceModes:{antrepo:'database',asas:'database'},
    rowCounts:{orders:18420,backlog:18420},
    horizons:[{targets:['orders','backlog'],horizon:{dateEnd:'2026-12-31',dateStart:'2026-01-01',seasons:['SS27'],table:'Orders'}}],
  });
  assert.equal(a.horizonKey,b.horizonKey);
  assert.equal(a.rowBucket,'15k-30k');
  assert.equal(JSON.stringify(a).includes('SS27'),false);
  assert.deepEqual(a.targets,['backlog','orders']);
});

test('başarılı yenilemeler median/P80 ETA üretir ve aşırı uç örneği bastırır',()=>{
  const p=profile();let summary=null;
  [30000,32000,34000,35000,37000,39000,240000].forEach((durationMs,index)=>{
    summary=perf.updateSummary(summary,{eventId:'evt-'+index,status:'done',durationMs,profile:p,at:'2026-10-03T07:0'+index+':00.000Z'});
  });
  const eta=perf.estimateFromSummary(summary,p);
  assert.equal(eta.available,true);
  assert.equal(eta.basis,'exact');
  assert.ok(eta.sampleCount>=6);
  assert.ok(eta.highMs<60000,'uç süre P80 aralığını şişirmemeli');
  assert.ok(eta.estimateMs>=eta.lowMs&&eta.estimateMs<=eta.highMs);
});

test('başarısız ve iptal yenileme tahmin modelini eğitmez',()=>{
  const p=profile();
  let summary=perf.updateSummary(null,{eventId:'ok',status:'done',durationMs:30000,profile:p,at:'2026-10-03T07:00:00.000Z'});
  summary=perf.updateSummary(summary,{eventId:'bad',status:'error',durationMs:400000,profile:p,at:'2026-10-03T07:01:00.000Z'});
  summary=perf.updateSummary(summary,{eventId:'cancel',status:'cancelled',durationMs:250000,profile:p,at:'2026-10-03T07:02:00.000Z'});
  const eta=perf.estimateFromSummary(summary,p);
  assert.equal(eta.available,false);
  assert.equal(eta.sampleCount,1);
});

test('sunucu yenilemeleri anonim performans servisine bağlar ve job durumuna ETA ekler',()=>{
  assert.match(SERVER,/createRefreshPerformance/);
  assert.match(SERVER,/refreshPerformanceProfile/);
  assert.match(SERVER,/eta:refreshPerformance\.estimate/);
  assert.match(SERVER,/refreshPerformance\.record/);
  assert.match(SERVER,/remainingMs/);
});

test('ETA mevcut Refresh Stages ve Thinking Orb tasarım dilini kullanır',()=>{
  assert.match(APP,/function refreshEtaPanelHtml/);
  assert.match(APP,/class="refreshEtaCard/);
  assert.match(APP,/blOrb blOrb--sm/);
  assert.match(APP,/sourceRefreshTimers\[refreshTimerKey\]\.eta/);
  assert.match(CSS,/\.refreshEtaCard\{/);
  assert.match(CSS,/\.refreshEtaState/);
});
