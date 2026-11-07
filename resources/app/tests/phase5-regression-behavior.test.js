'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-phase5-contract-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local');
process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'data');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {extractFunction}=require('./helpers/app-main-functions');
const server=require('./helpers/server-source')(),main=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8');
const parse=require('../server/lib/parse'),policy=require('../server/lib/compute-access'),tasks=require('../server/lib/compute-tasks');
const {createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service');
const {createComputeReadGuard}=require('../server/lib/compute-read-guard'),{createComputeReadService}=require('../server/lib/compute-read-service');
const pageProjectionCache=require('../server/lib/page-projection-cache'),MiB=1024*1024;
const headersAt=server.indexOf('const BACKLOG_TEMPLATE_HEADERS = [');
const headers=new Function(server.slice(headersAt,server.indexOf('];',headersAt)+2)+';return BACKLOG_TEMPLATE_HEADERS;')();
const json=value=>JSON.parse(JSON.stringify(value));
const decode=entry=>JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)).toString('utf8'));
let serial=0;
async function fixture(t){
 const id='demo-'+(++serial),profile={id,enabled:true,status:'ACTIVE',systemRole:'buyer',areas:new Set(['cp','orders','backlog','koleksiyon','overview'])};
 const row=(ocode,extra={})=>({ocode,model:'MODEL',ccode:'01',colour:'BLACK',season:'S7',countryRaw:'TURKIYE',manufacturer:'Demo',category:'KNIT',merch:'M',ageGroup:'A',buyer:'Buyer A',buyerGrup:'G',line:'LINE',qty:100,kalan:100,fob:5,opd:new Date(2026,0,1),ex:new Date(2026,1,1),retail:new Date(2026,2,1),mb:new Date(2026,1,15),_sourceFields:{Team:'A'},...extra});
 const rows=[row(1001),row(1002,{buyer:'Foreign Buyer'}),row(1003,{season:'W6'}),row(1004,{_sourceFields:{Team:'B'}})];
 const antrepo=parse.parseAntrepoRows([{'Sipariş Kod':'1001','Ürün Ad':'MODEL','Renk Kod':'01','Supplier Portal Statü':'Depoda','Yükleme Toplam Adet':30,'Net Alım Sipariş Miktarı':100,Container:'ONE'},{'Sipariş Kod':'1001','Ürün Ad':'MODEL','Renk Kod':'01','Supplier Portal Statü':'Yolda','Yükleme Toplam Adet':20,'Net Alım Sipariş Miktarı':100,Container:'TWO'}]);
 const source={loadedAt:'demo-r1',asasOrders:rows,asasOrdersByTarget:{cp:[row(9001)],orders:[row(8001)],backlog:rows},antrepoMap:{},antrepoMapByTarget:{backlog:antrepo},lflRows:[]};
 const shared={_revision:1,_revisions:{},pricingRules:[],transitRules:[],importanceSettings:{tags:require('../public/order-importance').DEFAULT_TAGS}},horizons={backlog:{seasons:['S7']}};
 let access=policy.createAccessContext({userId:id,systemRole:'buyer',viewScope:{buyers:['Buyer A']},authority:{},profiles:[]});
 const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:1536*MiB,maxPendingBytes:64*MiB}),service=createComputeService({pool,root,diskBudgetBytes:32*MiB});
 let descriptor=await service.seedSource({ownerId:id,generation:'demo-g1',source,uncompressedBytes:MiB});
 const runtime={...source,_computeSourceDescriptor:descriptor};let calls=0;
 const compute={run:async(...args)=>{calls++;return service.run(...args);}};
 const c={Object,Array,Map,Set,Buffer,crypto,APP_VERSION:'test',BACKLOG_TEMPLATE_HEADERS:headers,pageProjectionCache,createComputeReadGuard,createComputeReadService,
  require:require('node:module').createRequire(path.join(__dirname,'../server/server.js')),
  userAccess:{sessionProfile:req=>req.currentUser===profile?profile:null,profileById:key=>key===id?profile:null,hasArea:(p,area)=>p.areas.has(area),roleWorkspaceEntries:()=>[],publicProfile:p=>({id:p.id,systemRole:p.systemRole,status:p.status}),computeAccessContext:()=>access},
  userPreferences:{applyHorizonOverrides:()=>[]},sourceUserId:value=>value?.currentUser?.id||value?.id||value,sourceFolderForUser:()=>'',sourceFilterReadiness:()=>({ready:true}),
  assertSourceFilters(){},loadOverrides:()=>shared,loadModelConnections:()=>({revision:1,items:[]}),cacheForUser:()=>runtime,
  effectiveHorizonForTarget:(_p,target)=>horizons[target],computeSourceFor:async()=>descriptor,computeSourceToken:()=>descriptor.capability,
  serverCompute:()=>compute,publishedComputeSources:new Map([[id,{descriptor}]]),
  projectionRuntimeMeta:require('../server/lib/projection-runtime-meta').projectionRuntimeMeta};
 vm.createContext(c);
 const functions=['stableHashValue','pageProjectionContext','computeReadContext','computeParamsFor','projectionSourceRevision','pageProjectionMatchesRuntime','acceptComputedMetadata','pageCacheRuntimeMeta','ensureComputedProjection'];
 const guard=server.slice(server.indexOf('const computeReadGuard='),server.indexOf('function computeParamsFor('));
 const reads=server.slice(server.indexOf('const computeReads='),server.indexOf('async function prepareComputeBacklog('));
 vm.runInContext(functions.map(name=>extractFunction(server,name)).join('\n')+'\n'+guard+'\n'+reads+'\nthis.api={ensure:ensureComputedProjection,params:computeParamsFor,context:pageProjectionContext,guard:computeReadGuard,reads:computeReads};',c);
 c.PAGE_PROJECTION_AREAS={cp:'cp',orders:'orders',overview:'overview','collection-catalog':'koleksiyon'};
 c.PAGE_PROJECTION_TARGETS={cp:['cp'],orders:['orders'],overview:['cp'],'collection-catalog':['cp']};
 t.after(async()=>{c.api.reads.clear();await service.close();});
 return {c,profile,source,shared,horizons,service,get descriptor(){return descriptor;},access,req:{currentUser:profile},calls:()=>calls,
  setAccess(value){access=policy.createAccessContext({userId:id,...value});},
  async advance(){descriptor=await service.seedSource({ownerId:id,generation:'demo-g2',source:{...source,loadedAt:'demo-r2'},uncompressedBytes:MiB});}};
}

test('native Backlog export and XLSX preserve target, view Horizon, Buyer, analysis filters and importance validation',async t=>{
 const f=await fixture(t),custom=parse.backlogCustomDimensionContext(f.source.asasOrdersByTarget.backlog,f.source.antrepoMapByTarget.backlog).customDimensions;
 const ias=custom.find(c=>c.source==='antrepo'&&c.header==='Container'),asas=custom.find(c=>c.source==='asas'&&c.header==='Team');
 assert.ok(ias&&asas);
 const options={analysisFilters:JSON.stringify([{...ias,values:['ONE']},{...asas,values:['A']}]),dimFilters:{buyer:['Buyer A']}};
 const params=f.c.api.params(f.profile,f.descriptor,'backlog-export',{options,sourceColumns:[ias.id],includeSourceDetails:true});
 const lease=await f.service.run('backlog-export',f.descriptor,params);
 let body;
 try{body=decode(lease.value);assert.ok(lease.metrics.threadId>0);assert.equal(body.rows.length,1);assert.equal(body.rows[0]['Sipariş Kod'],1001);assert.equal(body.rows[0].Adet,30);assert.equal(body.rows[0][ias.label],'ONE');
  const scoped=policy.filterRows(f.access,require('../server/lib/horizon-fields').filterRows(f.source.asasOrdersByTarget.backlog,f.horizons.backlog));
  const expected=parse.buildBacklogTemplateRows(scoped,f.source.antrepoMapByTarget.backlog,f.shared,options,[ias],{includeSourceDetails:true});
  assert.equal(zlib.gunzipSync(Buffer.from(lease.value.buffer)).toString(),tasks.serialize({headers:[...headers,ias.label],rows:expected,totalRows:expected.totalRows||expected.length,sourceColumns:[ias],sourceCatalog:parse.backlogCustomDimensionContext(scoped,f.source.antrepoMapByTarget.backlog).customDimensions,rowsRevision:params.rowsRevision,merchCalendar:params.calendar},'api'));
 }finally{lease.release();}
 const importance=require('../public/order-importance');
 f.shared.importanceSettings.tags=f.shared.importanceSettings.tags.map(tag=>tag.id==='bts'?{...tag,label:'Demo BTS'}:tag);
 f.shared.importancemap={[parse.orderLineKey(1001,'MODEL','01')]:'bts'};
 const workbook=await f.service.run('backlog-workbook',f.descriptor,f.c.api.params(f.profile,f.descriptor,'backlog-workbook',{options,sourceColumns:[],includeSourceDetails:true}));
 try{const bytes=Buffer.from(workbook.value.buffer),XLSX=require('xlsx'),wb=XLSX.read(bytes,{type:'buffer'}),rows=XLSX.utils.sheet_to_json(wb.Sheets.BACKLOG||wb.Sheets[wb.SheetNames[0]]);
  assert.equal(rows.length,1);assert.equal(rows[0]['Sipariş Kod'],'1001','the existing Excel template keeps order identities as text');assert.equal(rows[0][importance.BACKLOG_HEADER],'Demo BTS');
  const zip=await require('../public/vendor/jszip.min').loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml,/<dataValidation\b[^>]*type="list"[^>]*allowBlank="0"/);assert.ok(xml.includes('Demo BTS'));assert.ok(!xml.includes('Tükleme Tipi Teyidi'));
 }finally{workbook.release();}
});

test('actual request revisions and native read cache preserve reuse and change with filters, authority and generation',async t=>{
 const f=await fixture(t),parts={options:{},sourceColumns:[]};
 const revision=()=>f.c.api.params(f.profile,f.descriptor,'backlog-export',parts).rowsRevision;
 const original=revision();assert.equal(revision(),original);
 const a=await f.c.api.reads.run(f.req,'backlog','backlog-export',parts),b=await f.c.api.reads.run(f.req,'backlog','backlog-export',parts);
 try{assert.equal(a.value,b.value);assert.equal(f.calls(),1);assert.equal(decode(a.value).rowsRevision,original);}finally{a.release();b.release();}
 parts.options={buyerGrup:'missing'};assert.notEqual(revision(),original);
 const filtered=await f.c.api.reads.run(f.req,'backlog','backlog-export',parts);try{assert.equal(decode(filtered.value).rows.length,0);}finally{filtered.release();}
 f.setAccess({systemRole:'buyer',viewScope:{buyers:['Foreign Buyer']},authority:{},profiles:[]});assert.notEqual(revision(),original);
 f.profile.areas.delete('backlog');await assert.rejects(f.c.api.reads.run(f.req,'backlog','backlog-export',parts),{code:'AREA_FORBIDDEN'});
 f.profile.areas.add('backlog');const authorityRevision=revision();await f.advance();assert.notEqual(revision(),authorityRevision,'a new generation changes revision independently of the prior authority change');
});

test('real projection miss publishes native gzip and separate Orders summary; cache hits keep raw-source work off MAIN',async t=>{
 const f=await fixture(t),orders=await f.c.api.ensure(f.req,'orders',{legacy:true});
 try{const body=decode(orders.value);assert.ok(orders.metrics.threadId>0);assert.ok(body.orders.length>0);assert.equal(body.orderSummary,undefined);
  const cached=await pageProjectionCache.readProjection(f.profile.id,'orders',f.c.api.context(f.profile).contextHash),summary=await pageProjectionCache.readProjection(f.profile.id,'order-summary',f.c.api.context(f.profile).contextHash);
  assert.equal(cached.data.orderSummary,undefined);assert.ok(summary.data.rows.length>0);assert.equal(summary.data.rows[0]['Order Code'],9001);
 }finally{orders.release();}
 const first=await f.c.api.ensure(f.req,'cp'),calls=f.calls(),firstBytes=Buffer.from(first.value.buffer);first.release();
 f.shared._revision++;f.shared.imagemap={demo:'demo-image'};f.shared.plmStyleLinks={demo:'demo-link'};
 const second=await f.c.api.ensure(f.req,'cp');try{assert.equal(second.cacheState,'hit');assert.equal(f.calls(),calls,'visual metadata must reuse existing business gzip');assert.deepEqual(Buffer.from(second.value.buffer),firstBytes);}finally{second.release();}
 const oldContext=f.c.api.context(f.profile).contextHash;f.shared._revisions.orders=1;assert.notEqual(f.c.api.context(f.profile).contextHash,oldContext);
 f.setAccess({systemRole:'buyer',viewScope:{buyers:['Foreign Buyer']},authority:{},profiles:[]});assert.notEqual(f.c.api.context(f.profile).contextHash,oldContext);
});

test('public Backlog wrapper immediately clears prefetch, shows loading and ignores an obsolete response',async()=>{
 const pending=[],events=[],c={Promise,backlogPrefetch:{old:true},showBacklogLoadingState:()=>events.push('loading'),backlogQueryString:p=>p.id,
  fetchJSON:()=>new Promise(resolve=>pending.push(resolve)),applyBacklogData:data=>events.push(data.id),window:{BLBacklogDateRange:{requestState:state=>events.push(state)}},console};
 vm.createContext(c);vm.runInContext('let backlogFetchGeneration=0,backlogFetchPending=null;'+['fetchBacklog','fetchBacklogData','waitForBacklogRowsReady'].map(n=>extractFunction(main,n)).join('\n'),c);
 const old=c.fetchBacklog({id:'old'});assert.equal(c.backlogPrefetch,null);assert.deepEqual(events,['loading','loading']);
 const current=c.fetchBacklog({id:'current'});pending[1]({id:'current'});await current;pending[0]({id:'old'});await old;
 assert.equal(events.filter(v=>v==='current').length,1);assert.equal(events.includes('old'),false);await c.waitForBacklogRowsReady();
});

test('actual cache reader accepts split or legacy summaries and refuses a generation without either',async t=>{
 const f=await fixture(t),c=f.c,ctx=c.api.context(f.profile),projected=tasks.buildProjections(f.source,c.api.params(f.profile,f.descriptor,'projections',{}));
 vm.runInContext(['orderSummaryFromCache','cachedRuntimeFromManifest','loadCachedPageProjectionSet'].map(n=>extractFunction(server,n)).join('\n'),c);
 for(const mode of ['split','legacy','missing']){
  const projections=structuredClone(projected);
  if(mode!=='split')delete projections['order-summary'];
  if(mode==='legacy')projections.orders.orderSummary=projected['order-summary'].rows;
  await pageProjectionCache.writeGeneration(f.profile.id,{contextHash:ctx.contextHash,sourceLoadedAt:f.source.loadedAt,projections,
   extra:{runtimeMeta:{loadedAt:f.source.loadedAt},sourceRevisionKey:c.projectionSourceRevision(f.source),sourceProjectionKeys:f.descriptor.projectionKeys}});
  const read=await c.loadCachedPageProjectionSet(f.profile,false);
  assert.equal(read.hit,mode!=='missing',mode+' summary compatibility');
  if(read.hit){
   const rows=c.orderSummaryFromCache(read.byModule);
   assert.deepEqual(json(rows),JSON.parse(tasks.serialize(projected['order-summary'],'projection')).rows);
   assert.equal(rows[0]['Ex-factory'],'2026-02-01','persisted projections retain the established calendar-date format');
  }
 }
});

test('local-first scheduler waits for UI ready and the startup delay before calling the FX pool facade',async()=>{
 const timers=[],calls=[],c={BACKGROUND_SYNC_DELAY_MS:2500,uiReadySignaled:false,backgroundServicesTimer:null,markStartup:()=>{},
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return {unref(){}};},hydrateBusinessCheckpointIfNeeded:async()=>{},syncSettings:{read:async()=>({syncPeriodMinutes:'manual'})},deltaStore:{hydrate:()=>{}},syncFxFromKurWorkbook:id=>{calls.push(id);return Promise.resolve();},logRuntimeFailure:(_stage,error)=>{throw error;}};
 vm.createContext(c);vm.runInContext(extractFunction(server,'scheduleBackgroundServices'),c);c.scheduleBackgroundServices();assert.equal(timers.length,0);
 c.uiReadySignaled=true;c.scheduleBackgroundServices();c.scheduleBackgroundServices();assert.equal(timers.length,1);assert.equal(timers[0].ms,2500);assert.equal(calls.length,0);
 timers[0].fn();assert.deepEqual(calls,['moderator']);await new Promise(setImmediate);
});
