'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),{inspectSourceFilterReadiness}=require('../server/lib/source-filter-readiness');
const source=fs.readFileSync(require.resolve('../server/server'),'utf8');
function gate(mode,items=[]){const calls=[],c={loadOverrides:()=>({asasSourceMode:mode}),inspectSourceFilterReadiness,sourceUserId:v=>v.id,userAccess:{roleWorkspaceEntries:v=>{calls.push('roles');return {role:v.id};}},loadModelConnections:()=>{calls.push('connections');return {items};},userPreferences:{applyHorizonOverrides:(raw,id,targets,roles)=>{calls.push({id,targets,roles});return raw;}}};vm.createContext(c);vm.runInContext(extractFunction(source,'sourceFilterReadiness')+';globalThis.read=sourceFilterReadiness;',c);return {c,calls};}
test('Excel filter readiness equals the canonical result without reading database connections or personal preferences',()=>{
 for(const mode of ['excel',undefined,'unknown'])for(const targets of [null,['cp','orders','backlog'],['lfl']]){const f=gate(mode);assert.deepEqual(f.c.read(targets,{id:'demo'}),inspectSourceFilterReadiness([],targets,{asasSourceMode:'excel'}));assert.deepEqual(f.calls,[]);}
});
test('database filter readiness still resolves current personal and role horizons and fails closed without a filter',()=>{
 const targets=['cp','orders'],items=[{id:'source',role:'asas',scopes:[{targets,enabled:true,horizon:{}}]}],f=gate('database',items),actual=f.c.read(targets,{id:'demo'});
 assert.deepEqual(actual,inspectSourceFilterReadiness(items,targets,{asasSourceMode:'database'}));assert.equal(actual.ready,false);assert.deepEqual(f.calls,['connections','roles',{id:'demo',targets,roles:{role:'demo'}}]);
});
