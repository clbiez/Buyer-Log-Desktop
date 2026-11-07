'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBacklogQueryCache}=require('../server/lib/backlog-query-cache');
test('query cache separates revisions and evicts by row budget, LRU and TTL',()=>{
 let now=0,computes=0;
 const cache=createBacklogQueryCache({maxEntries:2,maxRows:6,ttlMs:100,now:()=>now});
 const read=key=>cache.get(key,()=>({query:{filtered:[1,2],windowed:[]},revision:++computes}));
 assert.equal(read('user-a:source-1').revision,1);assert.equal(read('user-a:source-1').revision,1);
 assert.equal(read('user-b:source-1').revision,2);read('user-a:source-1');read('user-a:source-2');
 assert.equal(read('user-b:source-1').revision,4,'evicted user entry must be rebuilt');
 now=101;assert.equal(read('user-a:source-2').revision,5);
 const tooLarge=()=>cache.get('large',()=>({query:{filtered:Array(7),windowed:[]},revision:++computes}));
 assert.notEqual(tooLarge(),tooLarge(),'oversized results are not retained');
});
test('panels share in-flight rows across grouping changes and invalidate on source refresh',async()=>{
 const source=fs.readFileSync(require.resolve('../public/backlog-overview.js'),'utf8');
 const cache=source.slice(source.indexOf('const rowsCache=new Map()'),source.indexOf('\nfunction queryParams()'));
 const hook=source.slice(source.indexOf('let pendingTimer='),source.indexOf('/* --------------------------------------------------------------- çizim */'));
 let fetches=0;
 const sandbox={window:{},JSON,Map,URLSearchParams,fetch:async()=>{fetches++;return {ok:true,json:async()=>({rows:[{Adet:100}],rowsRevision:'r'+fetches})};},$:()=>({classList:{add(){}}}),filterFacets:new Map(),sourceRevision:'',catalogGeneration:0,filterCatalog:null,filterCatalogPromise:null,signature:'',filterOpen:false,setTimeout:()=>0,clearTimeout(){},visible:()=>false};
 vm.createContext(sandbox);vm.runInContext(cache+'\n'+hook,sandbox);
 vm.runInContext("onBacklogRendered({rowsInputRevision:'source-a'})",sandbox);
 const api=sandbox.window.BLBacklogRows,query={format:'json',analysisFilters:'S7'};
 const [a,b]=await Promise.all([api.load({...query,groupBy:'buyer'}),api.load({...query,groupBy:'season'})]);
 assert.equal(fetches,1);assert.equal(a,b);
 vm.runInContext("onBacklogRendered({rowsInputRevision:'source-a'})",sandbox);
 assert.equal(await api.load(query),a);assert.equal(fetches,1);
 vm.runInContext("onBacklogRendered({rowsInputRevision:'source-b'})",sandbox);
 assert.notEqual(await api.load(query),a);assert.equal(fetches,2);
 const different=await api.load({...query,analysisFilters:'W6'});assert.notEqual(different,a);assert.equal(fetches,3);
});
test('returning to a cached filter prevents an older delivery request from replacing the current result',async()=>{
 const source=fs.readFileSync(require.resolve('../public/backlog-delivery-analysis.js'),'utf8');
 const start=source.indexOf('let refreshGeneration='),end=source.indexOf('/* -------------------------------------------------------------- drilldown */',start);
 let signature='W6',resolveOld,cancellations=0;
 const current=[{Sezon:'S7'}],sandbox={state:{open:true,rows:current,rowsSignature:'S7'},window:{},currentSignature:()=>signature,fetchRows:()=>new Promise(resolve=>resolveOld=resolve),cancelAnalysis(){cancellations++;},computeModel(){},render(){}};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
 const old=vm.runInContext('refresh(false)',sandbox);signature='S7';await vm.runInContext('refresh(false)',sandbox);
 resolveOld([{Sezon:'W6'}]);await old;
 assert.equal(sandbox.state.rows,current);assert.equal(sandbox.state.loading,false);
 assert.equal(cancellations,2,'both refresh generations cancel an obsolete analysis');
});
test('explicit reload reuses row identity only when the server confirms the same query revision',async()=>{
 const source=fs.readFileSync(require.resolve('../public/backlog-overview.js'),'utf8');
 const block=source.slice(source.indexOf('const rowsCache=new Map()'),source.indexOf('\nfunction queryParams()'));
 let revision='a';
 const sandbox={window:{},JSON,Map,URLSearchParams,fetch:async()=>({ok:true,json:async()=>({rows:[{Adet:100}],rowsRevision:revision})})};
 vm.createContext(sandbox);vm.runInContext(block,sandbox);
 const api=sandbox.window.BLBacklogRows,a=await api.load({format:'json',analysisFilters:'S7'});
 api.invalidate();assert.equal(await api.load({format:'json',analysisFilters:'S7'}),a);
 revision='b';api.invalidate();assert.notEqual(await api.load({format:'json',analysisFilters:'S7'}),a);
 assert.notEqual(await api.load({format:'json',analysisFilters:'W6'}),a);
});
test('persisted pivot variants expire on a new calendar day even when source data is unchanged',()=>{
 const server=fs.readFileSync(require.resolve('../server/server.js'),'utf8');
 const start=server.indexOf('function backlogCacheKey('),block=server.slice(start,server.indexOf('\n',start));
 let today='2026-11-05T08:00:00';
 class ClockDate extends Date{constructor(){super(today);}}
 const sandbox={Date:ClockDate,stableHashValue:value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex')};
 vm.createContext(sandbox);vm.runInContext(block,sandbox);
 const read=()=>sandbox.backlogCacheKey({analysisFilters:'risk'}),initial=read();
 today='2026-11-05T23:59:00';assert.equal(read(),initial);
 today='2026-11-06T00:01:00';assert.notEqual(read(),initial);
});
test('export projects the same override snapshot used to select and cache its query',async()=>{
 const server=fs.readFileSync(require.resolve('../server/server.js'),'utf8');
 const start=server.indexOf("app.get('/api/backlog-export'"),end=server.indexOf("app.get('/api/backlog-filter-values'",start);
 const selected={notesmap:{1001:{Notes:'selected snapshot'}},_revision:2};
 let handler,result;
 const sandbox={app:{get:(_path,_guard,fn)=>{handler=fn;}},userAccess:{requireArea:()=>null},assertSourceFilters(){},sourceUserId:()=> 'demo',cacheForUser:()=>({asasOrders:[]}),ensureBacklogSourceFields:async()=>{},effectiveOverridesForUser:()=>({notesmap:{1001:{Notes:'unrelated snapshot'}},_revision:1}),backlogQueryForRequest:()=>({orders:[],antrepo:{},overrides:selected,sourceRevision:'revision-2',query:{custom:{customDimensions:[]}}}),backlogRowFilterOptions:()=>({}),backlogRowsCacheKey:()=> 'legacy-key',cachedBacklogTemplateRows:(_key,compute)=>compute(),buildBacklogTemplateRows:(_orders,_antrepo,overrides)=>[{note:overrides.notesmap[1001].Notes}],BACKLOG_TEMPLATE_HEADERS:[],BACKLOG_ROWS_PROCESS_NONCE:'test',crypto:require('node:crypto'),sendDateSafeJson:(_res,body)=>{result=body;},require:()=>({publicProjection:()=>({})}),apiError:(_res,error)=>{throw error;}};
 vm.runInNewContext(server.slice(start,end),sandbox);
 await handler({query:{format:'json'},currentUser:{}},{});
 assert.equal(result.rows[0].note,'selected snapshot');
});
