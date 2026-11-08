'use strict';
// Diagnosis only. Exact source blocks run in VM; DOM/report work is stubbed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const http=require('node:http'),crypto=require('node:crypto'),inspector=require('node:inspector');
const zlib=require('node:zlib'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../../../../../..'),APP=path.join(ROOT,'resources/app');
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
module.exports={extractBlock,createClient,summarize,validateCampaign};
