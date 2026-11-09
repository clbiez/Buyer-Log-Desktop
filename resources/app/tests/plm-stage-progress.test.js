'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createJobRegistry} = require('../server/lib/job-registry');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const server = read('server/server.js');
const ops = read('public/plm-operations.js');

function reporter(registry, legacy) {
  const start = server.indexOf('function reportImageProgress(');
  return new Function('plmJobs', 'setModelOperationProgress', server.slice(start, server.indexOf('// İstek gövdesinden', start))+'\nreturn reportImageProgress;')(registry, (id,p) => legacy.push(p));
}
function ui(language) {
  const labels = ops.slice(ops.indexOf('  const STAGE_LABEL'), ops.indexOf('  function activeScope'));
  const functions = ops.slice(ops.indexOf('  function phaseText'), ops.indexOf('  function failureTable'));
  return new Function('appLang', 'escapeHtml', 'humanDuration', 'jobHasFailures', `const STATUS_LABEL={succeeded:{tr:'Tamamlandı',en:'Completed'},failed:{tr:'Başarısız',en:'Failed'},cancelled:{tr:'İptal edildi',en:'Cancelled'}};${labels}\n${functions}\nreturn {phaseText,stageProgress,progressLine,progressBar,jobMetrics};`)(language, s=>String(s).replaceAll('<','&lt;'), ms=>String(ms), ()=>false);
}

test('stage counters cannot replace requested totals or leak last model into local work', () => {
  let at = 0;
  const registry = createJobRegistry({now:()=>at});
  const job = registry.create('demo',{kind:'plm-images',total:952});
  const legacy = [], report = reporter(registry, legacy);
  report({currentUser:{id:'demo'}}, job, {stage:'downloading',current:473,total:474,model:'2074306'});
  at = 1000;
  const download = registry.describe('demo',job.id);
  assert.equal(download.total,952);
  assert.equal(download.processed,0);
  assert.equal(download.stageCurrent,473);
  assert.equal(download.stageTotal,474);
  assert.equal(download.stageElapsedMs,1000);
  report({currentUser:{id:'demo'}}, job, {stage:'committing'});
  at = 5000;
  const saving = registry.describe('demo',job.id);
  assert.equal(saving.activeModel,'');
  assert.equal(saving.phase,'');
  assert.equal(saving.stageTotal,0);
  assert.equal(saving.stageCurrent,0);
  assert.equal(saving.stageElapsedMs,4000);
  assert.equal(legacy.at(-1).stage,'committing');
  registry.finish('demo',job.id,{status:'failed'});
  at = 9000;
  assert.equal(registry.describe('demo',job.id).stageElapsedMs,4000);
});

test('legacy non-stage image reports keep their original counters', () => {
  const registry = createJobRegistry(), job = registry.create('demo',{total:3});
  reporter(registry,[])({currentUser:{id:'demo'}},job,{phase:'Download',current:2,total:3,model:'123'});
  const result = registry.describe('demo',job.id);
  assert.equal(result.processed,2);
  assert.equal(result.total,3);
  assert.equal(result.stage,'');
});

test('473/474 is 99 percent of the image stage, never 100 percent of the job', () => {
  for (const language of ['tr','en']) {
    const view=ui(language), job={running:true,stage:'downloading',stageCurrent:473,stageTotal:474,percent:100};
    assert.equal(view.stageProgress(job).percent,99);
    assert.match(view.progressLine(job),/473\/474.*99/);
    assert.match(view.progressBar(job),/aria-valuenow="99"/);
    assert.match(view.phaseText(job),language==='en'?/Downloading images/:/Görseller indiriliyor/);
    const saving={...job,stage:'committing',stageCurrent:0,stageTotal:0,etaMs:0,ratePerMinute:200,total:952,elapsedMs:100000,stageElapsedMs:1000};
    assert.doesNotMatch(view.progressBar(saving),/aria-valuenow/);
    assert.doesNotMatch(view.jobMetrics(saving),/ETA|Tahmini kalan|Rate|Hız/);
    assert.match(view.phaseText(saving),language==='en'?/Saving images and model links/:/kaydediliyor/);
    assert.match(view.phaseText({...saving,running:false,status:'succeeded'}),language==='en'?/Completed/:/Tamamlandı/);
  }
});

test('each post-download route action reports its actual stage before the await', () => {
  const route=server.slice(server.indexOf('async function runPlmImageImport('),server.indexOf("app.post('/api/model-images/import-asas'"));
  assert.match(route,/reportStage\('releasing'\);\s*const releaseStarted[\s\S]*?await upstreamLease.release/);
  assert.match(route,/reportStage\('local-cache'\);\s*const first = await resolveModelImagesLocalFirst/);
  assert.match(route,/reportStage\('shared-lease'\);\s*const upstreamLease = await leaseUpstreamImageIdentities/);
  assert.match(route,/reportStage\('connecting'\);\s*apiSession = await/);
});
