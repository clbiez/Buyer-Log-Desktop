'use strict';
// Diagnosis only. Exact source blocks run in VM; DOM/report work is stubbed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const http=require('node:http'),crypto=require('node:crypto'),inspector=require('node:inspector');
const zlib=require('node:zlib'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../../..'),APP=path.join(ROOT,'resources/app');
const PIN='63159fb32ff3d5bdc5f142b4a8f16ca6a3983240';
const fixture=require('./fixture.json');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const read=name=>fs.readFileSync(path.join(APP,'public',name),'utf8');
function extractBlock(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a&&source.indexOf(start,a+start.length)<0,`Missing/ambiguous source block: ${start}`);
  return source.slice(a,b);
}
function context(extra){return vm.createContext({URLSearchParams,Map,Set,JSON,Intl,Date,Promise,AbortController,...extra});}
function createClient(scenario,fetch,preparation={}){
  let active={},plotted='';
  const host={style:{},classList:{toggle(){}},setAttribute(){},querySelector:()=>null};
  const window={BLMerchCalendarReady:Promise.resolve()};
  const whenRowsReady=preparation.whenRowsReady||(()=>Promise.resolve());
  window.BLBacklogChartContext={queryParams:()=>active,whenRowsReady,prepareQuery:async()=>{await whenRowsReady();}};
  let rows,overview,chart,plan;
  if(scenario==='plan'){
    plan=context({fetch,window,rangeIso:()=>({from:fixture.from,to:fixture.to}),planWindow:()=>({from:'2026-10-26',to:'2026-11-02'}),buildBacklogParams:()=>active,
      state:{open:true,to:'2026-11-02'},refreshGeneration:0,data:null,loading:false,error:'',querySignature:'',render(){},hydrateFilterValidity(){},L:(_tr,en)=>en,
      saveState(){},$:()=>null,moduleEl:()=>null,closeDrawer(){}});
    const source=read('backlog-plan-actual.js');
    vm.runInContext(extractBlock(source,'function openModule(value){','function hydrateFilterValidity(){'),plan);
  }else{
    if(scenario==='shared'){
      overview=context({fetch,window,$:()=>host,state:{open:true},refreshGeneration:0,baseItems:null,items:null,loading:false,error:'',signature:'',normalizedRows:null,
        overviewQueryParams:()=>active,applyOverviewFilters:r=>r,R:()=>({normalizeRows:r=>r}),render(){},L:(_tr,en)=>en,
        saveState(){},closeDrawer(){},closeFilterPanel(){}});
      const source=read('backlog-overview.js');
      vm.runInContext(extractBlock(source,'const rowsCache=new Map()','\nfunction queryParams()'),overview);
      vm.runInContext(extractBlock(source,'async function refresh(force){','\nlet pendingTimer='),overview);
      vm.runInContext(extractBlock(source,'function setOpen(value){','\nfunction bind(){'),overview);
      rows=window.BLBacklogRows;
    }
    const root={fetch,document:{getElementById:()=>host},BLBacklogRows:rows,BLBacklogChartContext:window.BLBacklogChartContext,BLMerchCalendarReady:Promise.resolve()};
    chart=context({root,cache:{signature:'',headers:[],rows:[]},renderGeneration:0,state:{enabled:true,timeField:'demoDate'},
      normalizeHeaders:h=>h,inferState:(_h,_r,s)=>s,saveState(s){chart.state=s;},
      buildModel:(_r,_h,s)=>({state:s,categories:['demo'],series:[{}]}),
      mountInteractiveChart:(_h,_m,detail)=>{plotted=detail.rows[0]._ana12Query;},esc:String,tr:(_tr,en)=>en,configSummary:()=>''});
    vm.runInContext(extractBlock(read('backlog-chart.js'),'  function cacheSignature(params) {','  function optionHtml('),chart);
  }
  return {
    rows,
    start(params){active={...params};return scenario==='plan'?plan.refresh():scenario==='shared'?Promise.all([overview.refresh(false),chart.render(false)]):chart.render(false);},
    closeOverview(){assert.ok(overview);overview.setOpen(false);},
    close(){if(plan)plan.openModule(false);if(overview)overview.setOpen(false);if(chart){chart.state.enabled=false;return chart.render(false);}},
    result(){return plan?plan.data?.queryToken:scenario==='shared'?{overview:overview.items?.[0]?._ana12Query,chart:plotted}:plotted;},
  };
}
function sourceHashes(){return Object.fromEntries(['backlog-plan-actual.js','backlog-overview.js','backlog-chart.js'].map(n=>[n,sha(read(n))]));}
function median(a){const b=a.slice().sort((x,y)=>x-y);return b.length%2?b[b.length>>1]:(b[b.length/2-1]+b[b.length/2])/2;}
function summarize(runs){
  const out={};
  for(const r of runs){out[r.scenario]??={};out[r.scenario][r.arm]??={};}
  for(const [scenario,arms] of Object.entries(out))for(const arm of Object.keys(arms)){
    const selected=runs.filter(r=>r.scenario===scenario&&r.arm===arm);
    arms[arm]=Object.fromEntries(Object.keys(selected[0].metrics).map(k=>[k,selected.every(r=>typeof r.metrics[k]==='number')?median(selected.map(r=>r.metrics[k])):null]));
  }
  return out;
}
function validateCampaign(runs,scenarios){
  assert.ok(runs.length);const source=JSON.stringify(runs[0].sourceHashes),fixtureSha=runs[0].fixtureSha;
  let previousEnd=-Infinity;
  for(const run of runs){
    assert.equal(JSON.stringify(run.sourceHashes),source,'production sources must match');assert.equal(run.fixtureSha,fixtureSha);
    assert.ok(run.startedAtMs>=previousEnd,'measurements overlap');assert.ok(run.endedAtMs>run.startedAtMs);previousEnd=run.endedAtMs;
    assert.equal(run.correctFinal,true,'final query mismatch');
  }
  for(const scenario of scenarios)for(const arm of ['before-preparation','after-preparation'])assert.equal(runs.filter(r=>r.scenario===scenario&&r.arm===arm).length,3);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function responseBody(token){
  // Probe rows, not business projections. No canonical/header mapping changes.
  return JSON.stringify({queryToken:token,rowsRevision:`demo-${token}`,headers:[],rows:Array.from({length:fixture.rows},(_,i)=>({
    id:`DEMO-${String(i).padStart(6,'0')}`,quantity:(i%17)+1,demoDate:'2026-11-02',description:`Synthetic ANA-12 row ${i}`,...(i===0?{_ana12Query:token}:{})
  }))});
}
async function oneRun(scenario,arm,index,out){
  const bodies=Array.from({length:fixture.changes},(_,i)=>Buffer.from(responseBody(`demo-${i}`)));
  const records=[],serverRecords=[];let active=0,peak=0,supersededAt=null,closedAt=null,cpuAtSupersession;
  const server=http.createServer((req,res)=>{
    assert.equal(req.method,'GET','refresh/login POST must never be retried or sent');
    const token=new URL(req.url,'http://localhost').searchParams.get('analysisFilters'),i=Number(token?.replace('demo-',''));
    const record={token,received:performance.now(),finished:null,disconnected:null,bytes:bodies[i]?.length};serverRecords.push(record);
    res.on('finish',()=>{record.finished=performance.now();});res.on('close',()=>{if(!res.writableFinished)record.disconnected=performance.now();});
    setTimeout(()=>{if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(bodies[i]);}},fixture.responseDelayMs+(fixture.changes-1-i)*fixture.reverseDelayStepMs);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const measuredFetch=async(url,options={})=>{
    const record={token:new URL(url,base).searchParams.get('analysisFilters'),started:performance.now(),hasSignal:!!options.signal,aborted:false,parsedBytes:0,parseMs:0};records.push(record);active++;peak=Math.max(peak,active);
    options.signal?.addEventListener('abort',()=>{record.aborted=true;record.abortedAt=performance.now();},{once:true});
    let finished=false;const finish=()=>{if(!finished){finished=true;active--;record.ended=performance.now();}};
    try{
      const response=await fetch(new URL(url,base),options);record.headersAt=performance.now();
      return {ok:response.ok,status:response.status,statusText:response.statusText,json:async()=>{
        try{const text=await response.text();record.bodyAt=performance.now();record.parsedBytes=Buffer.byteLength(text);const start=performance.now();try{return JSON.parse(text);}finally{record.parseMs=performance.now()-start;record.parsedAt=performance.now();}}finally{finish();}
      }};
    }catch(error){record.error=error.name;finish();throw error;}
  };
  const client=createClient(scenario==='shared-close'?'shared':scenario,measuredFetch);
  const session=new inspector.Session();session.connect();
  const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(e,r)=>e?reject(e):resolve(r)));
  await post('Profiler.enable');await post('Profiler.start');
  const startedAtMs=Date.now(),start=performance.now(),cpu=process.cpuUsage(),heap=process.memoryUsage().heapUsed;
  let profile;
  try{
    const pending=[];
    for(let i=0;i<fixture.changes;i++){
      pending.push(client.start({format:'json',analysisFilters:`demo-${i}`,scope:fixture.scope,generation:fixture.generation,includeSourceDetails:fixture.includeSourceDetails}));
      if(i===fixture.changes-1){supersededAt=performance.now();cpuAtSupersession=process.cpuUsage();}else await wait(fixture.intervalMs);
    }
    if(scenario==='shared-close'){closedAt=performance.now();await client.close();}
    await Promise.all(pending);
    const used=process.cpuUsage(cpu),tail=process.cpuUsage(cpuAtSupersession),wallMs=performance.now()-start,endedAtMs=Date.now(),result=client.result();
    // A closed overview currently still receives its result. Chart generation rejects the late render.
    const correctFinal=scenario==='shared-close'?result.overview==='demo-9'&&result.chart==='':typeof result==='string'?result==='demo-9':result.overview==='demo-9'&&result.chart==='demo-9';
    const after=records.filter(r=>r.token!=='demo-9'&&r.parsedAt>supersededAt);
    const report={scenario,arm,index,fixtureSha:sha(fs.readFileSync(path.join(__dirname,'fixture.json'))),sourceHashes:sourceHashes(),startedAtMs,endedAtMs,correctFinal,result,
      metrics:{requests:records.length,peakActiveRequests:peak,parsedBytes:records.reduce((s,r)=>s+r.parsedBytes,0),staleParsedBytes:after.reduce((s,r)=>s+r.parsedBytes,0),parseMs:records.reduce((s,r)=>s+r.parseMs,0),staleParseMs:after.reduce((s,r)=>s+r.parseMs,0),processCpuMs:(used.user+used.system)/1000,processCpuAfterSupersessionMs:(tail.user+tail.system)/1000,wallMs,aborts:records.filter(r=>r.aborted).length,signals:records.filter(r=>r.hasSignal).length,
        completedAfterClose:closedAt===null?null:records.filter(r=>r.ended>closedAt).length,heapDeltaUncollectedBytes:process.memoryUsage().heapUsed-heap,backendJobs:null,postCancellationCpuMs:null},
      limitations:['Synthetic loopback HTTP, delayed response, instrumented text/JSON parsing; no browser/DOM/report cost.','Process CPU includes both synthetic HTTP server and VM client. Heap is uncollected; not retained heap.','No real backend or compute pool invoked: backend jobs and CPU after cancellation are unknown. No cancellation occurred.'],
      supersededAt,closedAt,records,serverRecords};
    fs.writeFileSync(path.join(out,`${index}-${scenario}-${arm}.json`),JSON.stringify(report,null,2));
    assert.equal(correctFinal,true,'equivalence gate failed');return report;
  }catch(error){
    fs.writeFileSync(path.join(out,`${index}-${scenario}-${arm}.failed.json`),JSON.stringify({error:error.stack,records,serverRecords,supersededAt,closedAt},null,2));throw error;
  }finally{
    profile=(await post('Profiler.stop')).profile;session.disconnect();
    fs.writeFileSync(path.join(out,`${index}-${scenario}-${arm}.cpuprofile.gz`),zlib.gzipSync(JSON.stringify(profile)));
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}
async function campaign(){
  const out=path.resolve(process.argv[2]||path.join(__dirname,'artifacts/cohort'));
  fs.mkdirSync(out,{recursive:true});assert.equal(fs.readdirSync(out).length,0,'preserve old evidence: use a new output directory');
  execFileSync('git',['merge-base','--is-ancestor',PIN,'HEAD'],{cwd:ROOT});
  assert.equal(execFileSync('git',['diff',PIN,'--','resources/app'],{cwd:ROOT,encoding:'utf8'}),'','production code changed: revalidate before measuring');
  for(const [name,hash] of Object.entries(sourceHashes()))assert.equal(sha(execFileSync('git',['show',`${PIN}:resources/app/public/${name}`],{cwd:ROOT})),hash);
  const lock=path.join(__dirname,'measurement.lock');const fd=fs.openSync(lock,'wx');
  const runs=[],scenarios=['plan','shared','chart-fallback','shared-close'];
  try{
    const setting=name=>{try{return fs.readFileSync(`/sys/fs/cgroup/${name}`,'utf8').trim();}catch{return null;}};
    fs.writeFileSync(path.join(out,'environment.json'),JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpuMax:setting('cpu.max'),memoryMax:setting('memory.max'),harnessSha:sha(fs.readFileSync(__filename)),fixtureSha:sha(fs.readFileSync(path.join(__dirname,'fixture.json'))),pin:PIN,sourceHashes:sourceHashes(),sameProcess:true,forcedGc:false,concurrentMeasurements:false,delayModel:'response timer, not OS bandwidth throttling',backend:'synthetic loopback HTTP; no real compute jobs'},null,2));
    for(let pair=0;pair<3;pair++)for(const arm of pair%2?['after-preparation','before-preparation']:['before-preparation','after-preparation'])for(const scenario of scenarios){
      const run=await oneRun(scenario,arm,runs.length,out);runs.push(run);process.stdout.write(`${run.index} ${scenario} ${arm}: ${run.metrics.requests} requests, final=${run.correctFinal}\n`);
    }
    validateCampaign(runs,scenarios);
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({comparison:'A/A preparation control; unchanged production code, NOT optimization before/after acceptance',pin:PIN,includes892:true,fixtureSha:runs[0].fixtureSha,sourceHashes:runs[0].sourceHashes,node:process.version,platform:process.platform,arch:process.arch,medians:summarize(runs)},null,2));
  }catch(error){fs.writeFileSync(path.join(out,'failed.json'),JSON.stringify({error:error.stack,completed:runs},null,2));throw error;}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
module.exports={extractBlock,createClient,summarize,validateCampaign,responseBody};
if(require.main===module)campaign().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
