'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,connection,moduleSchemaParams,clone,tasks}=require('./fixtures/module-schema-policy/runtime-fixture.cjs');
const grantKeys=['moduleSchemaExposureCp','moduleSchemaTargetKnownCp','moduleSchemaBindingsKnownCp','moduleSchemaExposureOrders','moduleSchemaTargetKnownOrders','moduleSchemaBindingsKnownOrders'];

test('default/other-task/unknown-module does not opt in or evaluate permission/model metadata',()=>{
 for(const change of [{collect:false},{collect:'true'},{task:'projection-plan'},{modules:['overview']},{modules:['orders','unknown']},{modules:[]}]){
  const f=fixture();Object.assign(f.context,change);let reads=0;
  Object.defineProperty(f.context,'connections',{enumerable:true,get(){reads++;throw Error('metadata must not be loaded');}});
  const flags=f.flags();assert.equal(flags.collectModuleSchemas,false);assert.ok(grantKeys.every(k=>flags[k]===false));assert.equal(reads,0);assert.equal(f.calls.length,0);
 }
});

test('private optin and known normalized DB target metadata grant actual CP/Orders exposure and bindings',()=>{
 const f=fixture(),flags=f.flags();assert.equal(flags.collectModuleSchemas,true);assert.ok(grantKeys.every(k=>flags[k]===true));assert.ok(Object.isFrozen(flags));
 assert.deepEqual(f.calls.map(([,area])=>area),['cp','orders']);
});

test('public/parts booleans cannot grant schemas: policy must be spread last',()=>{
 const f=fixture();f.context.collect=false;const forged={collectModuleSchemas:true,...Object.fromEntries(grantKeys.map(k=>[k,true])),cpAllowed:true};
 const data={...forged,...f.flags()};assert.equal(data.collectModuleSchemas,false);assert.ok(grantKeys.every(k=>data[k]===false));assert.equal(data.cpAllowed,true);
});

test('CP denied Orders-only caller remains full and cannot expose CP-derived schema despite broad cpAllowed',()=>{
 const f=fixture();f.areas.delete('cp');const result=f.project();assert.equal(result.params.cpAllowed,true);assert.equal(result.output.orders.rows.length,2);
 assert.equal(result.params.moduleSchemaExposureCp,false);assert.equal(result.params.moduleSchemaExposureOrders,false);assert.deepEqual(result.schemas,{cp:null,orders:null});
});

test('Orders denial is independent; public accessAreas or cpAllowed do not override live hasArea',()=>{
 const f=fixture();f.areas.delete('orders');f.profile.accessAreas={cp:true,orders:true};const flags=f.flags();
 assert.equal(flags.moduleSchemaExposureCp,true);assert.equal(flags.moduleSchemaExposureOrders,false);assert.equal(f.project().schemas.orders,null);
});

test('missing/disabled profile and nonboolean permission result never grant exposure',()=>{
 for(const profile of [null,{id:'current-profile',enabled:false}]){const f=fixture();f.context.profile=profile;assert.equal(f.flags().moduleSchemaExposureCp,false);}
 const f=fixture();f.deps.hasArea=()=> 'true';assert.equal(f.flags().moduleSchemaExposureCp,false);
});

test('Excel/dashboard/missing source modes stay unknown rather than treat [] as authoritative model schema',()=>{
 for(const sourceModes of [{asas:'excel',antrepo:'database'},{asas:'database',antrepo:'dashboard'},{asas:'database',antrepo:'excel'},{},null]){
  const f=fixture();f.context.sourceModes=sourceModes;const flags=f.flags();assert.equal(flags.moduleSchemaTargetKnownCp,false);assert.equal(flags.moduleSchemaBindingsKnownOrders,false);
  assert.deepEqual(f.project().schemas,{cp:null,orders:null});
 }
});

test('known authoritative empty definitions remain [] while missing store/effective capture stays unknown',()=>{
 const f=fixture();for(const item of f.context.connections.items)item.cpColumns=[];f.context.effectiveConnections=clone(f.context.connections.items);
 const result=f.project();assert.equal(result.schemas.orders.status,'known');assert.deepEqual(result.schemas.orders.modelColumns,[]);
 for(const change of [g=>{g.context.connections=null;},g=>{g.context.connections.revision=undefined;},g=>{g.context.effectiveConnections=null;}]){
  const g=fixture();change(g);assert.equal(g.flags().moduleSchemaBindingsKnownCp,false);
 }
});

test('missing/parked/disabled target does not get inferred from ASAS role,labels or broad data switch',()=>{
 for(const mutate of [item=>{item.scopes=item.scopes.filter(s=>!s.targets.includes('cp'));},item=>{item.scopes.find(s=>s.targets.includes('cp')).enabled=false;},
  item=>{item.scopes=[];item.parkedBindings=[{moduleId:'cp'}];}]){
  const f=fixture();mutate(f.context.connections.items[0]);f.context.effectiveConnections=clone(f.context.connections.items);
  const flags=f.flags();assert.equal(flags.moduleSchemaTargetKnownCp,false);assert.equal(flags.moduleSchemaBindingsKnownOrders,false);
 }
});

test('different CP/Orders connection IDs cannot certify shared bindings even if row objects happen to match',()=>{
 const f=fixture(),first=f.context.connections.items[0];first.scopes=first.scopes.filter(s=>s.targets.includes('cp'));
 const second=connection('asas2','asas',[]);second.scopes=second.scopes.filter(s=>s.targets.includes('orders'));f.context.connections.items.push(second);f.context.effectiveConnections=clone(f.context.connections.items);
 const flags=f.flags();assert.equal(flags.moduleSchemaTargetKnownCp,true);assert.equal(flags.moduleSchemaTargetKnownOrders,true);assert.equal(flags.moduleSchemaBindingsKnownOrders,false);
 assert.equal(f.project().schemas.orders,null);
});

test('inactive/out-of-target/foreign-role definitions from legacy all-connections flattening block known bindings',()=>{
 for(const mutate of [item=>{item.refreshEnabled=false;},item=>{item.scopes=item.scopes.filter(s=>s.targets.includes('orders'));},
  item=>{item.role='intake';item.scopes=[{id:'only-intake',enabled:true,targets:['intake'],horizon:{}}];}]){
  const f=fixture(),extra=connection('extra','asas');mutate(extra);f.context.connections.items.push(extra);f.context.effectiveConnections=clone(f.context.connections.items);
  const flags=f.flags();assert.equal(flags.moduleSchemaBindingsKnownCp,false);assert.equal(flags.moduleSchemaBindingsKnownOrders,false);
 }
});

test('ambiguous target claims or duplicate definition headers fail closed,without choosing first metadata alias',()=>{
 const conflict=fixture();conflict.context.connections.items.push(connection('second','asas',[]));conflict.context.effectiveConnections=clone(conflict.context.connections.items);
 assert.equal(conflict.flags().moduleSchemaTargetKnownCp,false);
 const duplicate=fixture();duplicate.context.connections.items[1].cpColumns[0].header='__CPX_ZERO';duplicate.context.effectiveConnections=clone(duplicate.context.connections.items);
 assert.equal(duplicate.flags().moduleSchemaBindingsKnownCp,false);
});

test('effective item/config/definition/target drift rejects stale or mismatched current metadata',()=>{
 for(const mutate of [items=>{items[0]._configVersion++;},items=>{items[0].cpColumns[0].name='changed';},items=>{items.pop();},
  items=>{items[0].scopes=items[0].scopes.filter(s=>s.targets.includes('cp'));},items=>{items[0].id='unknown';}]){
  const f=fixture();mutate(f.context.effectiveConnections);assert.equal(f.flags().moduleSchemaBindingsKnownCp,false);
 }
});

test('personal horizon split is valid target metadata but actual worker row/Antrepo equality remains required',()=>{
 const f=fixture();f.context.effectiveConnections[0].scopes.find(s=>s.targets.includes('cp')).horizon={seasons:['W7']};
 assert.equal(f.flags().moduleSchemaBindingsKnownOrders,true);
 const result=f.project({horizons:{cp:{seasons:['W7']},orders:{}}});assert.equal(result.schemas.orders,null);
 const g=fixture();g.source.antrepoMapByTarget={cp:{},orders:{}};assert.equal(g.project().schemas.orders,null);
});

test('actual Orders-only projection emits own schema without CP output and retains raw legacy definitions',()=>{
 const f=fixture(),before=f.source.asasOrders.map(r=>r._cpExtra),result=f.project();assert.equal(Object.hasOwn(result.output,'cp'),false);
 assert.equal(result.schemas.cp,null);assert.equal(result.schemas.orders.status,'known');assert.equal(result.schemas.orders.rowCount,2);
 assert.deepEqual(result.schemas.orders.rowKeys,[...new Set(result.output.orders.rows.flatMap(Object.keys))]);
 assert.equal(JSON.stringify(result.schemas.orders.modelColumns),JSON.stringify(f.columns()));assert.equal(result.output.orders.rows[0].__CPX_ZERO,0);
 assert.equal(result.output.orders.rows[0].__CPX_FALSE,false);assert.strictEqual(f.source.asasOrders[0]._cpExtra,before[0]);
 const legacy=tasks.buildProjections(f.source,{modules:['orders'],overrides:{},horizons:{},cpAllowed:true,summaryAllowed:true,cpModelColumns:f.columns()});
 assert.equal(tasks.serialize(result.output,'projection'),tasks.serialize(legacy,'projection'));
});

test('malformed/accessor metadata is unknown without invoking getters or changing source records',()=>{
 const f=fixture();let reads=0;Object.defineProperty(f.context.connections.items[0],'cpColumns',{enumerable:true,get(){reads++;throw Error('must not invoke');}});
 assert.equal(f.flags().moduleSchemaBindingsKnownCp,false);assert.equal(reads,0);
});

test('inactive or missing status cannot grant optional metadata even if an area predicate returns true',()=>{
 for(const status of ['DISABLED','PENDING',undefined]){const f=fixture();f.profile.status=status;const flags=f.flags();assert.equal(flags.collectModuleSchemas,true);assert.equal(flags.moduleSchemaExposureCp,false);assert.equal(flags.moduleSchemaExposureOrders,false);assert.equal(f.calls.length,0);}
});
