'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const main=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8'),overview=fs.readFileSync(require.resolve('../public/backlog-overview.js'),'utf8'),chart=fs.readFileSync(require.resolve('../public/backlog-chart.js'),'utf8').replace(/^  /gm,'');
const flush=()=>new Promise(setImmediate);
function setup(){
  const grouped=[],exports=[],applied=[],requestUrls=[],query={format:'json',groupBy:'status',analysisFilters:'synthetic-filter'};let fetches=0;
  const window={BLBacklogDateRange:{requestState(){}}},c={window,root:window,JSON,Map,URLSearchParams,AbortController,Set,assertRequest(signal){if(signal?.aborted)throw new DOMException("Aborted","AbortError");},cancelOverviewRequest(){},cancelFilterValues(){},Promise,
    fetch:async url=>{requestUrls.push(url);fetches++;return {ok:true,json:()=>new Promise(resolve=>exports.push(resolve))};},
    fetchJSON:()=>new Promise(resolve=>grouped.push(resolve)),fetchBacklogSourceColumns:()=>Promise.resolve([]),backlogQueryString:()=>'',showBacklogLoadingState(){},
    backlogExportQueryParams:()=>({...query}),backlogExportSourceCatalog:()=>[],normalizeHeaders:headers=>headers,showToast(){},appLang:'tr',cache:{signature:'',headers:[],rows:[]},
    sourceRevision:'',catalogGeneration:0,filterCatalog:null,filterCatalogPromise:null,signature:'',filterOpen:false,filterFacets:new Map(),
    $:()=>({classList:{add(){}}}),setTimeout:()=>0,clearTimeout(){},visible:()=>false,backlogPrefetch:null,
    applyBacklogData:data=>{applied.push(data.rowsInputRevision);c.onBacklogRendered(data);}};
  vm.createContext(c);
  const providerStart=main.indexOf('window.BLBacklogChartContext={'),provider=main.slice(providerStart,main.indexOf('\n};',providerStart)+4);
  const cache=overview.slice(overview.indexOf('const rowsCache=new Map()'),overview.indexOf('\nfunction queryParams()'));
  const hook=overview.slice(overview.indexOf('let pendingTimer='),overview.indexOf('/* --------------------------------------------------------------- çizim */'));
  const functions=['fetchBacklog','fetchBacklogData','prepareBacklogChartQuery','waitForBacklogRowsReady'].filter(name=>main.includes('function '+name+'(')).map(name=>extractFunction(main,name));
  vm.runInContext(['let backlogFetchGeneration=0,backlogFetchPending=null;',cache,hook,...functions,provider,...['cacheSignature','queryParams','loadDetail'].map(name=>extractFunction(chart,name))].join('\n'),c);
  return {c,grouped,exports,applied,query,requestUrls,fetches:()=>fetches};
}
test('Chart and Overview share one full-row request when the first pivot response establishes its source revision',async()=>{
  const f=setup(),group=f.c.fetchBacklog({}),chartResult=f.c.loadDetail(false);
  await flush();f.grouped[0]({rowsInputRevision:'source-a'});await group;
  const overviewRows=f.c.window.BLBacklogRows.load(f.query);await flush();
  const body={headers:['Adet'],rows:[{Adet:100}],rowsRevision:'rows-a'};f.exports.forEach(resolve=>resolve(body));
  const [chartData,rows]=await Promise.all([chartResult,overviewRows]);
  assert.ok(f.requestUrls.every(url=>url.includes('analysisFilters=synthetic-filter')),'both real panel query builders retain the same filter');
  assert.equal(f.fetches(),1,'pivot preparation must finish before either panel starts the shared row query');assert.equal(chartData.rows,rows);assert.deepEqual(f.applied,['source-a']);
});
test('Chart follows the newest pivot preparation without waiting for an obsolete request to finish',async()=>{
  const f=setup(),old=f.c.fetchBacklog({filter:'old'}),chartResult=f.c.loadDetail(false);await flush();
  assert.equal(f.fetches(),0,'row queries wait for a prepared pivot');
  const current=f.c.fetchBacklog({filter:'current'});f.grouped[1]({rowsInputRevision:'source-current'});await current;await flush();
  assert.equal(f.fetches(),1);assert.equal(f.exports.length,1,'the current pivot unlocks the shared row request while the obsolete pivot is unresolved');
  f.exports[0]({headers:[],rows:[{Adet:200}],rowsRevision:'rows-current'});assert.equal((await chartResult).rows[0].Adet,200);
  f.grouped[0]({rowsInputRevision:'source-old'});await old;assert.deepEqual(f.applied,['source-current']);
});
test('lazy Delivery initialization shares the post-pivot request with Chart and Overview',async()=>{
  const f=setup(),group=f.c.fetchBacklog({}),delivery=f.c.window.BLBacklogRows.load(f.query);await flush();
  f.grouped[0]({rowsInputRevision:'source-a'});await group;
  const chart=f.c.loadDetail(false),overview=f.c.window.BLBacklogRows.load(f.query);await flush();
  const body={headers:['Adet'],rows:[{Adet:100}],rowsRevision:'rows-a'};f.exports.forEach(resolve=>resolve(body));
  const [deliveryRows,chartData,overviewRows]=await Promise.all([delivery,chart,overview]);assert.equal(f.fetches(),1);assert.equal(deliveryRows,chartData.rows);assert.equal(deliveryRows,overviewRows);
});
