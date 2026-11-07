'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
const context={projectionSourceRevision:()=> 'same-revision'};vm.createContext(context);vm.runInContext(extractFunction(source,'pageProjectionMatchesRuntime')+';globalThis.matches=pageProjectionMatchesRuntime;',context);
const manifest={sourceRevisionKey:'same-revision',sourceLoadedAt:'r1',modules:{cp:{},orders:{}},sourceProjectionKeys:{cp:'cp-a',orders:'orders-a',backlog:'backlog-a'}};
test('same loadedAt cannot authorize stale CP projection after source values changed',()=>{
  const runtime={loadedAt:'r1',_computeSourceDescriptor:{projectionKeys:{cp:'cp-b',orders:'orders-a',backlog:'backlog-a'}}};
  assert.equal(context.matches(manifest,runtime,'cp'),false);assert.equal(context.matches(manifest,runtime,'orders'),true);
});
test('Backlog-only source enrichment and unrelated LFL data do not invalidate unchanged CP/Orders projections',()=>{
  const runtime={loadedAt:'r1',lflRows:[{newLfl:true}],_computeSourceDescriptor:{projectionKeys:{cp:'cp-a',orders:'orders-a',backlog:'backlog-b'}}};
  assert.equal(context.matches(manifest,runtime,'cp'),true);assert.equal(context.matches(manifest,runtime,'orders'),true);assert.equal(context.matches(manifest,runtime),true);
});
test('a current live source requires a matching source fingerprint on legacy cache entries',()=>{
  const {sourceProjectionKeys,...legacy}=manifest;
  assert.equal(context.matches(legacy,{loadedAt:'r1',_computeSourceDescriptor:{projectionKeys:sourceProjectionKeys}},'cp'),false);
});
