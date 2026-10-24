'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const server=path.join(__dirname,'../server/server.js'),source=fs.readFileSync(server,'utf8'),serverRequire=createRequire(server);
function fn(name){const at=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(at>=0);return source.slice(at,source.indexOf('\n}',at)+2);}
const profile={id:'demo'};
const order=(ocode,extra={})=>({ocode,model:'DEMO',ccode:'01',colour:'BLUE',qty:100,kalan:100,...extra});
test('review uses active page CP with Horizon and user scope; closed orders remain in authority',async()=>{
  const parse=require('../server/lib/parse'),canonicalFields=require('../public/canonical-fields');
  const rows=[order('4100001'),order('4100002',{kalan:0}),order('4100003',{outsideHorizon:true}),order('4100004',{outsideScope:true}),order('4100005',{readOnly:true})];
  const c={require:serverRequire,Map,Set,canonicalFields,
    ensureDataLoaded:async()=>{},cacheForUser:()=>({asasOrders:rows}),effectiveOverridesForUser:()=>({}),
    ordersForTarget:(cache,target)=>{assert.equal(target,'cp');return cache.asasOrders;},antrepoForTarget:()=>({}),
    filterRowsByEffectiveHorizon:(_p,target,input)=>{assert.equal(target,'cp');return input.filter(r=>!r.outsideHorizon);},
    userAccess:{hasArea:()=>true,hasPermission:()=>false,authoritativeOrderRows:code=>[{ocode:code,outsideScope:String(code)==='4100005'}],filterRowsByScope:(_p,input)=>input.filter(r=>!r.outsideScope)},
    canUserEditOrderCode:(_p,code)=>String(code)!=='4100005',
    buildCPRowsFromASAS:parse.buildCPRowsFromASAS,buildOrdersRowsFromASAS:parse.buildOrdersRowsFromASAS,
    cpAgentData:async(p,{loadCpRows})=>({cpRows:await loadCpRows(p),checklist:{answers:{}},personalRules:[],settings:{},checklistEnabled:{},customStatuses:[]})};
  vm.createContext(c);vm.runInContext([fn('agentQualityOrderRowsNow'),fn('agentQualityOrderRows'),fn('checklistAuthorizedOrdersNow'),fn('agentQualityAuthorizedOrders'),fn('agentQualityReviewContext')].join('\n'),c);
  const context=await c.agentQualityReviewContext(profile),allowed=await c.agentQualityAuthorizedOrders(profile),write=await c.agentQualityAuthorizedOrders(profile,{write:true});
  assert.deepEqual(Array.from(context.cp.rows,r=>r.orderCode),['4100001','4100005']);
  assert.deepEqual(Array.from(allowed.values(),r=>r.orderCode),['4100001','4100002','4100005']);
  assert.deepEqual(Array.from(write.values(),r=>r.orderCode),['4100001','4100002']);
  assert.deepEqual(Array.from(c.checklistAuthorizedOrdersNow(profile,{write:true}).values(),r=>r.orderCode),['4100001','4100002']);
  assert.deepEqual(Array.from(c.checklistAuthorizedOrdersNow(profile).values(),r=>r.orderCode),['4100001','4100002'], 'a self-scoped source row cannot grant visibility over official foreign ownership');
});
test('page CP injection preserves read-only checklist answers in the canonical review',async()=>{
  const CP=require('../public/cp-readiness-engine'),row={'Order Code':'4100005','Model Name':'DEMO','Colour Code':'01'},key=CP.analyzeOrder(row).orderKey;
  const answer={state:'rejected',source:'manual'},answers={[key+'::fabric']:answer};
  const c={Map,Set,userAccess:{profileById:()=>profile,hasArea:()=>true},cpAgentRevision:()=> 'same',
    agentPlatformDataset:async()=>{throw Error('generic agent edit scope must not replace page scope');},
    cpAgentPreferences:{ruleSnapshot:()=>({rules:[],payload:{}}),context:()=>({settings:{},checklistEnabled:{},answers,customStatuses:[]})},
    require:name=>name==='./lib/checklist-supplier-store'?{publicPayload:()=>({answers:{},tombstones:{}})}:serverRequire(name)};
  vm.createContext(c);vm.runInContext(fn('cpAgentData'),c);
  const data=await c.cpAgentData(profile,{loadCpRows:async()=>[row]});
  assert.equal(data.cpRows[0],row);
  assert.deepEqual(data.checklist.answers[key+'::fabric'],answer);
  let revision='before';c.cpAgentRevision=()=>revision;
  await assert.rejects(c.cpAgentData(profile,{loadCpRows:async()=>{queueMicrotask(()=>{revision='after';});return [row];}}),{code:'OFFICE_PREVIEW_CHANGED'});
});
