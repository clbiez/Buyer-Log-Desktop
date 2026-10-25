'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createScheduledRunner}=require('../server/lib/automation-scheduled-runner'),{createAutomationExecutor}=require('../server/lib/automation-execution-service');
const source=fs.readFileSync(process.env.BL_AUTHORITY_SOURCE_FILE||path.join(__dirname,'../server/server.js'),'utf8');
function native(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);assert.ok(start>=0&&end>start,name);return source.slice(start,end+2);}
function harness(){let live={id:'a',status:'ACTIVE',enabled:true,accessAreas:{automations:true},dataScope:{mode:'SELF'}},authority={},cookie=true,stored={id:'r',enabled:true};const ctx={userAccess:{publicProfile:p=>p,profileById:()=>live,sessionProfile:()=>cookie?live:null,hasArea:p=>p.accessAreas.automations,orderAuthorityToken:()=>authority},automationRecipeStore:{recipeForOwner:()=>stored}};vm.createContext(ctx);for(const name of ['automationAuthorityStamp','createAutomationAuthority','automationScheduleOptions'])vm.runInContext(native(name),ctx);return {ctx,initial:JSON.parse(JSON.stringify(live)),setLive:p=>{live=p;},setCookie:value=>{cookie=value;},setRecipe:value=>{stored=value;},moveOrders:()=>{authority={};}};}
test('normal schedule rejects a revoked or stale profile before reserving or reading a protected source',async()=>{
 const h=harness(),calls=[];h.setLive({...h.initial,accessAreas:{automations:false}});
 const runner=createScheduledRunner({store:{markSchedule(){calls.push('reserve');}},scheduleOptions:h.ctx.automationScheduleOptions,dataset(){calls.push('protected-source');},execute(){calls.push('execute');}});
 await assert.rejects(runner(h.initial,{id:'r'},'due'),{code:'AUTOMATION_AUTHORITY_CHANGED'});assert.deepEqual(calls,[]);
});
test('live guard rejects source ownership, scope, deleted recipes and session credentials without tying work to an unrelated IAM revision',()=>{
 for(const mutate of [h=>h.moveOrders(),h=>h.setLive({...h.initial,dataScope:{mode:'CUSTOM'}}),h=>h.setRecipe(null),h=>h.setCookie(false)]){const h=harness(),guard=h.ctx.createAutomationAuthority('a',h.initial,{id:'r'},{request:{}});assert.equal(guard().id,'a');mutate(h);assert.throws(guard,{code:'AUTOMATION_AUTHORITY_CHANGED'});}
 const h=harness(),guard=h.ctx.createAutomationAuthority('a',h.initial,{id:'r'});h.setLive({...h.initial,iamRevision:99,displayName:'Cosmetic update'});assert.equal(guard().id,'a');
});
test('INTAKE authority loss during model query never publishes a cache, personal view, snapshot or fallback',async()=>{
 const calls=[],snapshot={rows:[{old:'must not fall back'}]};let allowed=true,release;const guard=()=>{if(!allowed)throw Object.assign(Error('revoked'),{code:'AUTOMATION_AUTHORITY_CHANGED',statusCode:403});};
 const ctx={intakeStore:{loadSnapshot:()=>snapshot,get:()=>null,set:()=>calls.push('cache'),saveSnapshot:()=>calls.push('snapshot')},intakeLiveFields:async()=>({fields:[],connection:{}}),intakeStoredView:()=>null,intakeReport:{reconcileViewConfig:()=>({}),buildIntakeQuery:()=>({viewConfig:{}}),normalizeRows:r=>r},intakeHorizon:()=>null,intakeQueryKey:()=>'',modelQuery:{runModelRows:()=>new Promise(resolve=>{release=resolve;})},intakeSaveView:()=>calls.push('view'),intakeSafeSourceMessage:()=>'',Date};vm.createContext(ctx);vm.runInContext('async '+native('automationIntakeRows'),ctx);
 const pending=ctx.automationIntakeRows('a',guard);await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');allowed=false;release({rows:[{private:'revoked'}]});await assert.rejects(pending,{code:'AUTOMATION_AUTHORITY_CHANGED'});assert.deepEqual(calls,[]);
});
test('executor passes its default or explicit authority into source preparation',async()=>{
 for(const explicit of [false,true]){let guards=0,received;const guard=()=>{guards++;return {id:'a'};},execute=createAutomationExecutor({createAuthorityGuard:()=>{assert.equal(explicit,false);return guard;},automationDataset:async(owner,profile,recipe,assertAuthority)=>{received=assertAuthority;return {total:1,matched:1,items:[]};},automationAnalyze:()=>({})});await execute('a',{id:'a'},{purpose:'analysis'},{...(explicit?{assertAuthority:guard}:{})});assert.equal(received,guard);assert.ok(guards>=3);}
});
