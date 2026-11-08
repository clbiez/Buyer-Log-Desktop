'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const policyFixture=require('./fixtures/module-schema-policy/runtime-fixture.cjs');
const app=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(app,'server/server.js'),'utf8');
const keys=['collectModuleSchemas','moduleSchemaExposureCp','moduleSchemaTargetKnownCp','moduleSchemaBindingsKnownCp','moduleSchemaExposureOrders','moduleSchemaTargetKnownOrders','moduleSchemaBindingsKnownOrders'];
function actual(){
 const f=policyFixture.fixture(),counts={connections:0,effective:0};
 const globals={sourceUserId:p=>p.id,loadOverrides:()=>({asasSourceMode:'database',antrepoSourceMode:'database'}),
  loadModelConnections:()=>{counts.connections++;return f.context.connections;},effectiveHorizonForTarget:()=>null,
  userPreferences:{applyHorizonOverrides:(items,id,targets,roles)=>{counts.effective++;assert.equal(items,f.context.connections.items);assert.equal(id,f.profile.id);assert.deepEqual(Array.from(targets),['cp','orders']);return f.context.effectiveConnections;}},
  userAccess:{computeAccessContext:p=>({userId:p.id}),hasArea:f.deps.hasArea,roleWorkspaceEntries:p=>{assert.equal(p,f.profile);return[];}},
  require:name=>name==='./lib/merch-calendar-store'?{publicProjection:()=>({synthetic:true})}:require(path.join(app,'server',name))};
 // Production and its strict metadata helper share one Node realm. Compile the
 // untouched function in that same realm with explicit lexical dependencies.
 const invoke=vm.compileFunction(extractFunction(source,'computeParamsFor')+'\nreturn computeParamsFor;',Object.keys(globals))(...Object.values(globals));
 return{...f,counts,globals,invoke,run:(parts={},internal,task='projections')=>invoke(f.profile,{},task,{modules:['orders'],...parts},internal)};
}
test('actual server default overrides all forged public schema flags and keeps broad data switch',()=>{
 const f=actual(),p=f.run(Object.fromEntries(keys.map(k=>[k,true])));for(const key of keys)assert.equal(p[key],false,key);assert.equal(p.cpAllowed,true);assert.equal(f.counts.effective,0);
});
test('actual private caller derives known grants from the same one connections capture',()=>{
 const f=actual(),p=f.run({}, {collectModuleSchemas:true});for(const key of keys)assert.equal(p[key],true,key);assert.equal(f.counts.connections,1);assert.equal(f.counts.effective,1);assert.equal(p.cpModelColumns.length,f.columns().length);
 assert.equal(JSON.stringify(p.cpModelColumns),JSON.stringify(f.columns()),'legacy raw column registration/order/metadata unchanged');
});
test('actual private caller cannot grant CP schema to an Orders-only profile',()=>{
 const f=actual();f.areas.delete('cp');const p=f.run(Object.fromEntries(keys.map(k=>[k,true])),{collectModuleSchemas:true});assert.equal(p.cpAllowed,true);assert.equal(p.collectModuleSchemas,true);assert.equal(p.moduleSchemaExposureCp,false);assert.equal(p.moduleSchemaExposureOrders,false);
});
test('private optin is exact boolean and projections-only; normal shared service path stays off',()=>{
 for(const [internal,task]of [[{collectModuleSchemas:'true'},'projections'],[{collectModuleSchemas:true},'projection-plan'],[{},'projections']]){const f=actual(),p=f.run({},internal,task);for(const key of keys)assert.equal(p[key],false,key);assert.equal(f.counts.effective,0);}
});
test('actual private caller rejects ambiguous live target definitions without changing full data params',()=>{
 const f=actual();f.context.effectiveConnections[0]._configVersion++;const p=f.run({}, {collectModuleSchemas:true});assert.equal(p.collectModuleSchemas,true);assert.equal(p.moduleSchemaBindingsKnownCp,false);assert.equal(p.moduleSchemaBindingsKnownOrders,false);assert.equal(p.cpAllowed,true);assert.equal(JSON.stringify(p.cpModelColumns),JSON.stringify(f.columns()));
});

test('actual shared-read configuration makes schema mode server-owned and deterministic by task',async()=>{
 const {createComputeReadService}=require('../server/lib/compute-read-service');
 const {createComputeReadGuard}=require('../server/lib/compute-read-guard');
 const start=source.indexOf('const computeReads=createComputeReadService('),end=source.indexOf('\nasync function prepareComputeBacklog',start);assert.ok(start>=0&&end>start);
 const before=fs.readFileSync(path.join(__dirname,'fixtures/module-schema-policy/compute-read-config-before.js.txt'),'utf8');
 for(const [statement,expected]of [[before,false],[source.slice(start,end),true]]){
  const f=actual(),guard=createComputeReadGuard({sessionProfile:req=>req.profile,profileById:()=>f.profile,
   hasArea:(profile,area)=>f.deps.hasArea(profile,area),contextFor:()=>({contextHash:'synthetic-context'}),
   accessFor:()=>({accessHash:'synthetic-access'}),sourceTokenFor:()=> 'synthetic-source'});
  const dependencies={createComputeReadService,computeParamsFor:f.invoke,computeReadGuard:guard,computeSourceFor:async()=>({ownerId:f.profile.id,generation:'synthetic'}),
   serverCompute:()=>({run:async(_task,_descriptor,params)=>({value:params,metrics:{outputBytes:1},release(){}})})};
  const reader=vm.compileFunction(statement+'\nreturn computeReads;',Object.keys(dependencies))(...Object.values(dependencies));
  const projection=await reader.run({profile:f.profile},'orders','projections',{modules:['orders']},{cache:false});
  try{assert.equal(projection.value.collectModuleSchemas,expected);assert.equal(projection.value.moduleSchemaBindingsKnownOrders,expected);}finally{projection.release();}
  const plan=await reader.run({profile:f.profile},'orders','projection-plan',{collectModuleSchemas:true,moduleSchemaExposureCp:true},{cache:false});
  try{assert.equal(plan.value.collectModuleSchemas,false);assert.equal(plan.value.moduleSchemaExposureCp,false);}finally{plan.release();}
  f.areas.delete('orders');await assert.rejects(reader.run({profile:f.profile},'orders','projections',{modules:['orders']},{cache:false}),error=>error.code==='AREA_FORBIDDEN');
 }
});
