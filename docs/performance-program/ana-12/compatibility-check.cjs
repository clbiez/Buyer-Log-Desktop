'use strict';
// Read-only, pinned source comparison. No source mutation or hash replacement.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {extractBlock,validateCampaign,summarize}=require('./diagnose.cjs');
const root='docs/performance-program/ana-12',out=root+'/artifacts/main-63159fb3';
const current='63159fb32ff3d5bdc5f142b4a8f16ca6a3983240',old='5a1656e98deeb573f6245f4b24a8135cc77a0d7b';
const prepared='e165be5d22bcc14fa08d696510a06f5401ac8dc2',review='69950f289a012f0bb7c61290bec9890f340f6c64';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const show=(ref,file)=>cp.execFileSync('git',['show',`${ref}:${file}`],{maxBuffer:16*1024*1024});
const text=(ref,file)=>show(ref,file).toString('utf8');
const previous=JSON.parse(text(prepared,root+'/source-evidence.json'));
const sources=previous.sources.map(s=>{
  const content=text(current,s.path),lines=content.split('\n');
  return {ref:current,path:s.path,sha256:sha(content),previousRef:s.ref,previousSha256:s.sha256,unchangedSincePreviousEvidence:sha(content)===s.sha256,
    anchors:s.anchors.map(a=>{const matches=lines.flatMap((line,i)=>line.includes(a.text)?[i+1]:[]);assert.ok(matches.length,'anchor missing: '+a.text);return {text:a.text,lines:matches};})};
});
for(const [file,anchors] of [
  ['resources/app/public/app-main.js',['async function prepareBacklogChartQuery(){','async function waitForBacklogRowsReady(){','window.BLBacklogChartContext={']],
  ['resources/app/server/server.js',["app.get('/api/backlog-export'","app.get('/api/backlog-plan-actual'",'const lease=await computeReads.run(req,\'backlog\',task,']],
  ['resources/app/server/lib/compute-read-guard.js',['function stamp(profile)','assertResponse:()=>unchanged(sessionProfile(req))']]
]){
  const content=text(current,file),lines=content.split('\n');
  sources.push({ref:current,path:file,sha256:sha(content),anchors:anchors.map(anchor=>{const matches=lines.flatMap((line,i)=>line.includes(anchor)?[i+1]:[]);assert.ok(matches.length);return {text:anchor,lines:matches};})});
}
const specs=[
  ['plan lifecycle','backlog-plan-actual.js','function openModule(value){','function hydrateFilterValidity(){'],
  ['rows loader including readiness','backlog-overview.js','const rowsCache=new Map()','\nfunction queryParams()'],
  // Exclude the entire declaration prefix at both boundaries, including async.
  ['row cache and transport','backlog-overview.js','const rowsCache=new Map()','\nfunction loadRows(','\nasync function loadRows('],
  ['overview refresh','backlog-overview.js','async function refresh(force){','\nlet pendingTimer='],
  ['overview close','backlog-overview.js','function setOpen(value){','\nfunction bind(){'],
  ['chart lifecycle','backlog-chart.js','  function cacheSignature(params) {','  function optionHtml(']
];
const blocks=specs.map(([name,file,start,end,newEnd=end])=>{
  const p='resources/app/public/'+file,before=extractBlock(text(old,p),start,end),after=extractBlock(text(current,p),start,newEnd);
  return {name,file,start,beforeEnd:end,afterEnd:newEnd,beforeSha256:sha(before),afterSha256:sha(after),changed:before!==after};
});
assert.deepEqual(blocks.filter(b=>b.changed).map(b=>b.name),['rows loader including readiness']);
const p='resources/app/public/backlog-overview.js',before=text(old,p),after=text(current,p);
const b=extractBlock(before,'function loadRows(params){','window.BLBacklogRows='),a=extractBlock(after,'async function loadRows(params){','window.BLBacklogRows=');
assert.ok(a.includes('if(window.BLBacklogChartContext?.whenRowsReady)await window.BLBacklogChartContext.whenRowsReady();'));
assert.equal(after.replace(a,b),before,'only the inspected loadRows readiness wrapper may differ');
for(const file of ['backlog-plan-actual.js','backlog-chart.js','backlog-delivery-analysis.js'])assert.equal(text(current,'resources/app/public/'+file),text(old,'resources/app/public/'+file));
for(const file of ['compute-pool.js','compute-read-service.js','compute-response.js'])assert.equal(text(current,'resources/app/server/lib/'+file),text(review,'resources/app/server/lib/'+file));
assert.ok(fs.readFileSync(root+'/diagnose.test.cjs','utf8').startsWith(text(prepared,root+'/diagnose.test.cjs')),'all original seven tests/assertions must remain verbatim');
const historical=JSON.parse(text(prepared,root+'/artifacts/manifest.json'));
for(const f of historical.files){assert.equal(sha(show(prepared,f.file)),f.sha256);if(f.file.startsWith(root+'/artifacts/'))assert.equal(sha(fs.readFileSync(f.file)),f.sha256,'old artifact mutated');}
fs.writeFileSync(out+'/source-comparison.json',JSON.stringify({currentMain:current,mergeCommit:'4ae0730103d438c049dfe1419a41eed9489ba1ad',previousPreparation:prepared,previousProductionPin:old,previousPoolReview:review,includes892:true,
  measuredExecutionPathChanged:true,reason:'Only public change: loadRows awaits whenRowsReady before loadData. Adapted harness shares one readiness-provider stub between overview/delivery/chart. Real pivot/backend is not measured.',
  originalSevenTestsVerbatim:true,historicalManifest119HashesVerifiedAt:prepared,historicalArtifactsUnmodified:true,blocks,sources},null,2)+'\n');
fs.writeFileSync(out+'/public-source.diff.gz',require('node:zlib').gzipSync(cp.execFileSync('git',['diff',old,current,'--',...['backlog-plan-actual.js','backlog-chart.js','backlog-overview.js','backlog-delivery-analysis.js'].map(n=>'resources/app/public/'+n)])));
const dir=out+'/cohort';
if(fs.existsSync(dir+'/summary.json')){
  const runs=fs.readdirSync(dir).filter(n=>/^\d+-.*\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(dir+'/'+n))).sort((a,b)=>a.index-b.index);
  validateCampaign(runs,['plan','shared','chart-fallback','shared-close']);
  const summary=JSON.parse(fs.readFileSync(dir+'/summary.json')),environment=JSON.parse(fs.readFileSync(dir+'/environment.json'));
  assert.equal(summary.pin,current);assert.equal(environment.harnessSha,sha(fs.readFileSync(root+'/diagnose.cjs')));
  assert.equal(summary.fixtureSha,sha(fs.readFileSync(root+'/fixture.json')));assert.deepEqual(summarize(runs),summary.medians);
  for(const [file,hash] of Object.entries(summary.sourceHashes))assert.equal(hash,sha(show(current,'resources/app/public/'+file)));
  for(const r of runs){
    assert.equal(r.metrics.requests,10);assert.equal(r.records.length,10);assert.equal(r.metrics.aborts,0);assert.equal(r.metrics.backendJobs,null);assert.equal(r.metrics.postCancellationCpuMs,null);
    assert.equal(r.metrics.parsedBytes,r.records.reduce((s,e)=>s+e.parsedBytes,0));
    assert.equal(r.metrics.staleParsedBytes,r.records.filter(e=>e.token!=='demo-9'&&e.parsedAt>r.supersededAt).reduce((s,e)=>s+e.parsedBytes,0));
    const profile=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(`${dir}/${r.index}-${r.scenario}-${r.arm}.cpuprofile.gz`)));
    assert.ok(profile.nodes.length&&profile.samples.length&&profile.endTime>profile.startTime);
  }
}
console.log('PASS: inspected source delta, original assertions, 119 historical hashes, untouched historical artifacts; available current cohort raw sums/medians/24 profiles verified.');
