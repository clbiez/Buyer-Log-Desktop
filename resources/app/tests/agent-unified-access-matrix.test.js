'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createToolRegistry}=require('../server/lib/agent-tool-registry');
const {registerQualityTools}=require('../server/lib/agent-quality-tools');
function catalog(){const registry=createToolRegistry({cp:{},getDataset:async()=>[]});registerQualityTools(registry,{mail:()=>{}});require('../server/lib/agent-analytics-tools').registerAnalyticsTools(registry,{dataset:async()=>[],outputService:()=>({})});return registry.catalog().filter(t=>t.contractVersion);}
function matrix(){return require('../server/lib/module-registry').list().map(module=>({id:module.id,area:module.area,capabilities:module.capabilities,tools:catalog().filter(t=>t.module===module.id).map(t=>({id:t.id,operation:t.operation,areas:t.areas,permissions:t.permissions||[],capabilities:t.capabilities||[],risk:t.risk,approval:t.approval,rollbackable:t.rollbackable,contractVersion:t.contractVersion}))}));}
test('every real module and migrated adapter requires an explicit unified access-matrix decision',()=>{assert.deepEqual(matrix(),require('./fixtures/agent-unified-access-matrix.json'));});
test('Office capabilities have strict input/output schemas and explicit effect contracts',()=>{
  for(const tool of catalog().filter(t=>t.contractVersion>=2)) {
    assert.equal(tool.inputSchema.type,'object');assert.equal(tool.inputSchema.additionalProperties,false);assert.equal(tool.outputSchema.type,'object');
    for(const key of ['dataScope','preview','validation','audit','idempotency','retry','rollbackContract','approvalBinding'])assert.ok(tool[key],tool.id+':'+key);
    assert.equal(tool.executionScope,'office-durable-job');assert.equal(tool.approval,tool.risk!=='read');
  }
});
test('invented IAM capabilities cannot silently hide an executable adapter',()=>{
  assert.throws(()=>createToolRegistry({}).registerCapability({id:'bad',module:'cp',risk:'read',capabilities:['AUTOMATIONS.EXECUTE'],inputSchema:{type:'object'},read:async()=>({})}),/Unknown IAM capability/);
});
module.exports={matrix};
