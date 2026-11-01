'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Engine=require('../public/collection-lfl-engine');
const order=(patch={})=>({orderCode:'OLD-1',season:'S6',mag:'CU4E',classification:'K',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA',...patch});

test('detail rows reproduce each cached reference exactly, including cumulative MB boundaries and source exclusions',()=>{
 const rows=[order(),order({orderCode:'OLD-2',inStoreMonth:'2026-03',quantity:300,fob:20}),order({orderCode:'UNDATED',inStoreMonth:'',fob:30}),
  order({orderCode:'CURRENT',season:'S7',inStoreMonth:'2027-01'}),order({orderCode:'SAME-MONTH',season:'S7',inStoreMonth:'2027-02',fob:70}),order({orderCode:'FUTURE',season:'S7',inStoreMonth:'2027-04',fob:99}),
  order({orderCode:'TRY',country:'TÜRKİYE'}),order({orderCode:'OTHER-MAG',mag:'OTHER'}),order({orderCode:'OTHER-CATEGORY',classification:'OTHER'}),order({orderCode:'ZERO',quantity:0}),order({orderCode:'BAD-PRICE',fob:''})];
 const refs=Engine.buildReferences(rows),index=new Map(refs.map(ref=>[ref.key,ref])),candidate={season:'S7',mag:'CU4E',urunTipi:'K',inStoreMonth:'FEBRUARY 2027',quantity:200};
 const seasonal=Engine.reference(index,candidate,'season'),monthly=Engine.reference(index,candidate,'month'),impact=Engine.seasonImpact(Engine.createSeasonTimelines(refs),candidate,15).reference;
 for(const ref of [seasonal,monthly,impact]){
  const details=Engine.referenceDetails(rows,ref);
  assert.equal(details.length,ref.count);
  assert.equal(details.reduce((sum,row)=>sum+row._referenceQuantity,0),ref.quantity);
  assert.ok(Math.abs(details.reduce((sum,row)=>sum+row._referenceValue,0)/ref.quantity-ref.average)<1e-9);
  assert.ok(Math.abs(details.reduce((sum,row)=>sum+row._referenceWeight,0)-100)<1e-9);
 }
 assert.deepEqual(Engine.referenceDetails(rows,seasonal).map(row=>row.orderCode),['OLD-1','OLD-2','UNDATED']);
 assert.deepEqual(Engine.referenceDetails(rows,monthly).map(row=>row.orderCode),['OLD-1']);
 assert.deepEqual(Engine.referenceDetails(rows,impact).map(row=>row.orderCode),['CURRENT']);
 assert.ok(!Object.hasOwn(rows[0],'_referenceValue'),'report projection never mutates source rows');
 const canonical={'Order Code':'ALIAS','Season':'s6','MAG':' cu4e ','Classification':'K','FOB':12,'Order Quantity':100,'Country':'CHINA',inStoreMonth:'2026-02'};
 assert.equal(Engine.referenceDetails([canonical],monthly).length,1);
});

test('detail endpoint requires both areas, source readiness, the current version and a scoped reference key',async()=>{
 const routes=new Map(),guards=new Map();let ready=true,loads=0;
 const app={get(){},post:(url,...handlers)=>routes.set(url,handlers)};
 const runtime={lflLoadedAt:'source-v1',lflRows:[order(),order({orderCode:'PRIVATE',buyer:'private',fob:999}),order({orderCode:'PRIVATE-GROUP',mag:'SECRET',buyer:'private'})]};
 require('../server/routes/lfl-routes')(app,{
  userAccess:{requireArea:area=>{const guard=()=>{};guards.set(guard,area);return guard;},publicProfile:user=>user,localIamRevision:()=>1,filterRowsByScope:(_user,rows)=>rows.filter(row=>row.buyer!=='private')},
  sourceUserId:()=> 'owner',sourceFilterReadiness:()=>({ready}),cacheForUser:()=>runtime,ensureDataLoaded:async()=>{loads++;},
  collectionLflCache:{get:async args=>({version:args.version,references:Engine.buildReferences(await args.loadRows())})},
  attachModelImageIdentities:rows=>rows,modelImageIdentityOrders:()=>[],sendDateSafeJson:(res,data)=>res.json(data),apiError:(_res,error)=>{throw error;}
 });
 const handlers=routes.get('/api/collection-lfl-detail');assert.ok(handlers,'detail endpoint registered');
 assert.deepEqual(handlers.slice(0,-1).map(guard=>guards.get(guard)),['koleksiyon','lfl']);
 const handler=handlers.at(-1),key=Engine.buildReferences([order()])[0].key;
 const invoke=async body=>{const res={code:200,set(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler({currentUser:{id:'buyer'},body},res);return res;};
 let res=await invoke({key,version:'source-v1'});assert.equal(res.code,200);assert.equal(res.data.rows.length,1);assert.equal(res.data.rows[0].orderCode,'OLD-1');assert.equal(res.data.reference.average,10);
 assert.ok(!JSON.stringify(res.data).includes('PRIVATE'));
 res=await invoke({key,version:'old-source'});assert.equal(res.code,409);assert.equal(res.data.code,'LFL_REFERENCE_STALE');
 res=await invoke({key:Engine.buildReferences([order({mag:'SECRET'})])[0].key,version:'source-v1'});assert.equal(res.code,404);
 res=await invoke({key});assert.equal(res.code,400);
 ready=false;res=await invoke({key,version:'source-v1'});assert.equal(res.code,409);assert.equal(res.data.code,'SOURCE_FILTER_REQUIRED');
 ready=true;runtime.lflLoadedAt=null;res=await invoke({key,version:'source-v1'});assert.equal(res.code,409);
 assert.equal(loads,1,'only a missing source snapshot can invoke the initial local load');
});

function uiHarness(){
 const source=[order(),order({orderCode:'OLD-2',quantity:300,fob:20}),order({orderCode:'CURRENT',season:'S7',inStoreMonth:'2027-01'})];
 const state={version:'v1',referenceRequests:0,detailRequests:0,fail:false,gate:null};
 const context={window:null,appLang:'tr',state:{currentUser:{id:'buyer'}},document:{body:{dataset:{activeTab:'overview'}}},
  BLCollectionLflEngine:Engine,BLCanonicalFields:require('../public/canonical-fields'),escapeHtml:value=>String(value).replace(/[&<>"']/g,'_'),kolFormatMoneyDisplay:value=>Number(value).toFixed(2),
  kolEffectiveValue:(row,key)=>row.effective?.[key]??row[key],kolSuppFob:row=>({price:Number(row.targetPrice),source:'target'}),
  fetch:async(url,options)=>{
   const references=Engine.buildReferences(source);
   if(url.startsWith('/api/collection-lfl-reference')){state.referenceRequests++;return {ok:true,json:async()=>({version:state.version,references})};}
   assert.equal(url,'/api/collection-lfl-detail');assert.equal(options.method,'POST');state.detailRequests++;
   if(state.gate)await state.gate;
   if(state.fail)throw new Error('network failure');
   const body=JSON.parse(options.body);
   if(body.version!==state.version)return {ok:false,status:409,json:async()=>({code:'LFL_REFERENCE_STALE'})};
   const reference=references.find(ref=>ref.key===body.key);assert.ok(reference);
   return {ok:true,json:async()=>({version:state.version,reference,rows:Engine.referenceDetails(source,reference)})};
  }};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/collection-lfl.js'),'utf8'),context);
 return {ui:context.BLCollectionLfl,context,state};
}
const candidate={id:1,season:'S7',mag:'CU4E',urunTipi:'K',inStoreMonth:'FEBRUARY 2027',quantity:200,targetPrice:15};

test('detail reports load on click, coalesce by reference and reuse the shared report UI with numeric contribution columns',async()=>{
 const {ui,context,state}=uiHarness();await ui.ensure();
 assert.equal(state.detailRequests,0);assert.match(ui.drawer(candidate),/data-cpd-lfl-details="month"/);
 const [first,second]=await Promise.all([ui.detailReport(candidate,'month'),ui.detailReport({...candidate,id:2},'month')]);
 assert.equal(state.detailRequests,1);assert.equal(first.rows.length,2);assert.strictEqual(first.rows,second.rows);
 assert.equal(first.moduleId,'lfl');assert.equal(first.pageScope,'koleksiyon');assert.equal(first.rows.reduce((sum,row)=>sum+row._referenceValue,0),7000);
 for(const key of ['_referenceQuantity','_referenceFob','_referenceValue','_referenceWeight'])assert.equal(first.columns.find(col=>col.key===key).type,'number');
 assert.equal(first.columns.find(col=>col.key==='opd').canonicalId,'orderPlacementDate');
 const impact=await ui.detailReport(candidate,'impact');assert.equal(impact.rows.length,1);assert.equal(impact.rows[0].orderCode,'CURRENT');assert.match(impact.note,/simülasyondur/);
 assert.ok(!impact.rows.some(row=>row.id===candidate.id),'a candidate model is never represented as a placed source order');
 await assert.rejects(ui.detailReport({...candidate,mag:'MISSING'},'month'));
 assert.equal(state.detailRequests,2,'missing comparisons do not fetch details');
 assert.match(ui.drawer({...candidate,mag:'MISSING'}),/data-cpd-lfl-details="month"[^>]* disabled/);
 context.appLang='en';const english=await ui.detailReport(candidate,'month');assert.match(english.title,/Order details/);assert.equal(english.columns.find(col=>col.key==='_referenceWeight').label,'Weight Share (%)');
 assert.equal(state.detailRequests,2,'language and model changes reuse the source group');
 context.state.currentUser={id:'different-buyer'};await ui.detailReport(candidate,'month');
 assert.equal(state.referenceRequests,2);assert.equal(state.detailRequests,3,'detail rows are never reused across users');
});

test('source revisions refresh once on stale details, explicit refresh invalidates cached rows and failed requests remain retryable',async()=>{
 const {ui,state}=uiHarness();await ui.ensure();state.version='v2';
 const report=await ui.detailReport(candidate,'month');assert.equal(report.rows.length,2);assert.equal(state.referenceRequests,2);assert.equal(state.detailRequests,2);
 await ui.ensure({rebuild:true});await ui.detailReport(candidate,'month');assert.equal(state.detailRequests,3);
 await ui.ensure({rebuild:true});state.fail=true;
 await assert.rejects(ui.detailReport(candidate,'month'),/Sipariş detayları yüklenemedi/);
 state.fail=false;await ui.detailReport(candidate,'month');assert.equal(state.detailRequests,5);
});

test('an in-flight detail response cannot cross a user change or a reference refresh',async()=>{
 const {ui,context,state}=uiHarness();await ui.ensure();let release;
 state.gate=new Promise(resolve=>{release=resolve;});
 const pending=ui.detailReport(candidate,'month');await new Promise(resolve=>setImmediate(resolve));
 context.state.currentUser={id:'new-buyer'};await ui.ensure();release();
 await assert.rejects(pending,error=>error.code==='LFL_DETAIL_CANCELLED');
 state.gate=null;
 let releaseAgain;state.gate=new Promise(resolve=>{releaseAgain=resolve;});
 const outdated=ui.detailReport(candidate,'month');await new Promise(resolve=>setImmediate(resolve));await ui.ensure({rebuild:true});releaseAgain();
 await assert.rejects(outdated,error=>error.code==='LFL_DETAIL_CANCELLED');
});
