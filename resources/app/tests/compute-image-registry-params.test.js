'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {extractFunction}=require('./helpers/app-main-functions'),source=fs.readFileSync(require.resolve('../server/server'),'utf8');
test('image registry sends only the verified cached CP, access context and image map without preparing unrelated projections',()=>{
 const imagemap={'plm:123':'ci_demo'},access={userId:'demo',accessHash:'current'},cachedCp=Buffer.from('synthetic verified cached gzip'),profile={id:'demo'};
 const c={userAccess:{computeAccessContext:p=>{assert.equal(p,profile);return access;}},loadOverrides:()=>({imagemap,unrelated:{credential:'must not cross'}}),loadModelConnections:()=>assert.fail('image registry must not prepare model columns'),effectiveHorizonForTarget:()=>assert.fail('image registry must not resolve unrelated horizons')};vm.createContext(c);vm.runInContext(extractFunction(source,'computeParamsFor')+';globalThis.params=computeParamsFor;',c);
 const actual=c.params(profile,{generation:'g1'},'cp-image-registry',{cachedGeneration:'g1',cachedCp});assert.deepEqual(Object.keys(actual).sort(),['access','cachedCp','cachedGeneration','overrides']);assert.deepEqual(Object.keys(actual.overrides),['imagemap']);assert.equal(actual.cachedCp,cachedCp);assert.equal(actual.overrides.imagemap,imagemap);assert.equal(actual.access,access);
});
