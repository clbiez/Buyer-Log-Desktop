'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const schema=require('../public/module-projection-schema'),tasks=require('../server/lib/compute-tasks');
const input=rows=>({module:'orders',rows,modelColumns:[],modelSchemaKnown:true,canExpose:true,
 scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});
const union=rows=>[...new Set(rows.flatMap(Object.keys))];
const serialized=rows=>JSON.parse(tasks.serialize({rows},'projection')).rows;

test('explicit projection-JSON schema uses exact serialized own-key union and keeps source mode unchanged',()=>{
 const rows=[{a:undefined,b:false,c:0,d:null,e:'',n:NaN,infinity:Infinity,date:new Date(2026,0,2),fn(){},sym:Symbol('synthetic')},
  {a:null,later:false,absentEverywhere:undefined,date:new Date(2026,0,3)}];
 const rawKeys=union(rows),before=rows.map(Object.keys),raw=schema.build(input(rows));assert.deepEqual(raw.rowKeys,rawKeys,'legacy source mode remains unchanged');
 const actual=schema.build({...input(rows),keyMode:'projection-json'});assert.ok(actual);assert.deepEqual(actual.rowKeys,union(serialized(rows)));
 assert.deepEqual(rows.map(Object.keys),before);assert.equal(Object.hasOwn(rows[0],'a'),true);assert.equal(rows[0].a,undefined);
 assert.equal(actual.rowKeys.includes('absentEverywhere'),false);assert.equal(actual.rowKeys.includes('later'),true);
});
test('projection-JSON presence keeps own proto keys, constructor and nested arrays without copying row graphs',()=>{
 const first=JSON.parse('{"__proto__":{"zero":0},"constructor":false,"nested":[null,0,false]}');Object.defineProperty(first,'hiddenUndefined',{value:undefined,enumerable:true});
 const ref=first.nested,actual=schema.build({...input([first]),keyMode:'projection-json'});assert.ok(actual);assert.deepEqual(actual.rowKeys,Object.keys(serialized([first])[0]));assert.equal(first.nested,ref);
});
test('projection-JSON metadata declines custom value toJSON hooks and accessors without invoking them',()=>{
 for(const value of [{toJSON(){throw Error('must not invoke');}},Object.defineProperty({},'toJSON',{get(){throw Error('must not invoke');}}),Object.assign(new Date(2026,0,1),{toJSON(){throw Error('must not invoke');}})]){
  assert.equal(schema.build({...input([{value}]),keyMode:'projection-json'}),null);
 }
 let reads=0;const value=new Proxy({},{get(){reads++;throw Error('proxy hook');},getPrototypeOf(){reads++;throw Error('proxy prototype');}});
 assert.equal(schema.build({...input([{value}]),keyMode:'projection-json'}),null);assert.equal(reads,0);
});
test('unsupported projection key modes and BigInt are unknown; zero-row mode keeps an empty universe',()=>{
 for(const keyMode of [null,undefined,false,'json','unknown'])assert.equal(schema.build({...input([{}]),keyMode}),null);
 assert.equal(schema.build({...input([{value:1n}]),keyMode:'projection-json'}),null);
 const actual=schema.build({...input([]),keyMode:'projection-json'});assert.ok(actual);assert.deepEqual(actual.rowKeys,[]);assert.equal(actual.rowCount,0);
});
test('projection-JSON key capture rejects inherited serialization hooks without running them',()=>{
 let calls=0;const prior=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');
 try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value(){calls++;return undefined;}});assert.equal(schema.build({...input([{x:0}]),keyMode:'projection-json'}),null);assert.equal(calls,0);}
 finally{if(prior)Object.defineProperty(Object.prototype,'toJSON',prior);else delete Object.prototype.toJSON;}
});
test('actual CP and Orders producer schemas match their untouched native serialized projections',()=>{
 const rows=[0,1].map(i=>({ocode:'duplicate',model:'Synthetic '+i,ccode:'R',colour:'Red',buyer:'Synthetic',merch:'M',ageGroup:'A',buyerGrup:'G',
  season:'W7',countryRaw:'TURKIYE',qty:10,kalan:5,fob:0,ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_cpExtra:{__CPX_WIRE_KEY:i?false:0}}));
 const source={asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{}},data={modules:['cp','orders'],overrides:{},horizons:{},cpAllowed:true,
  cpModelColumns:[{id:'wire',header:'__CPX_WIRE_KEY',label:'Synthetic model'}],moduleSchemaExposureCp:true,moduleSchemaTargetKnownCp:true,moduleSchemaBindingsKnownCp:true,
  moduleSchemaExposureOrders:true,moduleSchemaTargetKnownOrders:true,moduleSchemaBindingsKnownOrders:true};
 let actual;const full=tasks.buildProjections(source,data,{onSchemas:value=>{actual=value;}}),legacy=tasks.buildProjections(source,data);
 assert.equal(tasks.serialize(full,'projection'),tasks.serialize(legacy,'projection'),'metadata must not change any full JSON byte');
 for(const module of ['cp','orders']){const wire=JSON.parse(tasks.serialize(full[module],'projection'));assert.ok(actual[module]);assert.deepEqual(actual[module].rowKeys,union(wire.rows),module+' key universe must match actual JSON, not raw undefined properties');assert.equal(actual[module].rowCount,wire.rows.length);}
});

test('default source-mode metadata remains equal to the original frozen schema implementation',()=>{
 const old=require('./fixtures/compute-module-schema/module-projection-schema-before-wire');
 for(const rows of [[],[{zero:0,flag:false,nil:null,missing:undefined}],[{when:new Date(2026,0,1),nested:{value:false}},{last:''}]]){
  assert.deepEqual(schema.build(input(rows)),old.build(input(rows)));
 }
});
