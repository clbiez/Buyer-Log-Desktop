'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const graph=require('../server/lib/agent-graph');
const {createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createToolRegistry}=require('../server/lib/agent-tool-registry');
const {resolveTemplates,classifyFailure}=require('../server/lib/agent-runtime');
const INDEX=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const SERVER=fs.readFileSync(path.join(root,'server','server.js'),'utf8');

function registry(){return createToolRegistry({
  getDataset:async()=>[{OrderCode:1,Status:'PRODUCTION',Qty:10},{OrderCode:2,Status:'OPEN',Qty:20}],
  refresh:async()=>({ok:true}), snapshotOrder:async()=>({}), updateOrder:async()=>({updated:1}), restoreOrder:async()=>({restored:true}), httpRequest:async()=>({ok:true,status:200})
});}

test('v5.46 legacy Agent Center/browser-recorder implementation is removed',()=>{
  for(const file of ['public/agents.js','server/lib/agent-store.js','server/lib/web-agent-runner.js']) assert.equal(fs.existsSync(path.join(root,file)),false,file);
  for(const source of [INDEX,SERVER]){
    assert.doesNotMatch(source,/\/api\/agents\b/);
    assert.doesNotMatch(source,/initAgentCenter|agentCenterRoot|web-agent-profiles/);
  }
});

test('v5.46 architecture template represents think-plan-act-verify-recover-audit and validates',()=>{
  const tools=registry(), wf=graph.architectureTemplate(), types=new Set(wf.nodes.map(n=>n.type));
  for(const type of ['trigger.manual','agent.intent','agent.planner','policy.guard','tool.call','verify.result','recovery.safe','audit.log','output.result']) assert.ok(types.has(type),type);
  const validation=graph.validateWorkflow(wf,tools);assert.equal(validation.valid,true,validation.errors.join(' | '));
  assert.equal(wf.nodes.find(n=>n.label==='Connectors').config.disabled,true,'sample connector must be opt-in');
});

test('v5.46 workflow validation rejects cycles, duplicate starts and unknown tools',()=>{
  const tools=registry(), wf=graph.taskTemplate({source:'cp'});
  wf.nodes.find(n=>n.type==='tool.call').config.toolId='not.registered';
  assert.equal(graph.validateWorkflow(wf,tools).valid,false);
  const ok=graph.taskTemplate({source:'cp'});ok.edges.push({id:'cycle',from:ok.nodes.at(-1).id,to:ok.nodes[0].id,channel:'success'});
  assert.equal(graph.validateWorkflow(ok,tools).valid,false);
});

test('v5.46 policy blocks arbitrary connector destinations and requires approval for risky tools',()=>{
  const tools=registry();
  const policy=createPolicyEngine({userAccess:{hasArea:()=>true},allowedConnectorHosts:['api.example.com']});
  assert.equal(policy.evaluate({},tools.get('connector.http'),{url:'http://api.example.com/a'},{approvalGranted:true}).allowed,false);
  assert.equal(policy.evaluate({},tools.get('connector.http'),{url:'https://evil.example/a'},{approvalGranted:true}).allowed,false);
  const pending=policy.evaluate({},tools.get('connector.http'),{url:'https://api.example.com/a'},{approvalGranted:false});assert.equal(pending.approvalRequired,true);assert.equal(pending.allowed,false);
  assert.equal(policy.evaluate({},tools.get('connector.http'),{url:'https://api.example.com/a'},{approvalGranted:true}).allowed,true);
  assert.equal(policy.evaluate({},tools.get('app.order.update'),{orderCode:1},{dryRun:true}).allowed,true,'dry-run must not require write approval');
});

test('v5.46 data mapping expressions resolve typed previous-node/run values without eval',()=>{
  const value=resolveTemplates({orderCode:'{{input.rows.0.OrderCode}}',note:'Task={{run.task}}',vars:'{{variables.codes}}'},{input:{rows:[{OrderCode:42}]},run:{task:'Kontrol et',variables:{codes:[1,2]}},nodes:{}});
  assert.equal(value.orderCode,42);assert.equal(value.note,'Task=Kontrol et');assert.deepEqual(value.vars,[1,2]);
  assert.doesNotMatch(require('node:fs').readFileSync(path.join(root,'server','lib','agent-runtime.js'),'utf8'),/\beval\s*\(|new Function/);
});

test('v5.46 recovery classifies common root-cause families without unsafe automatic escalation',()=>{
  assert.equal(classifyFailure({code:'AREA_FORBIDDEN',error:'yetki yok'}).category,'permission');
  assert.equal(classifyFailure({code:'VERIFICATION_FAILED',error:'doğrulama başarısız'}).category,'verification');
  assert.match(classifyFailure({code:'ETIMEDOUT'}).safeAction,/write\/external/i);
});

test('v5.46 Describe Dataset is a registered read-only discovery tool',()=>{
  const tools=registry(),meta=tools.get('dataset.describe');assert.ok(meta);assert.equal(meta.risk,'read');assert.equal(meta.category,'query');
});

/* v6.36: Agent Workflow Studio ARAYÜZÜ kaldırıldı (kullanıcı kararı). Bu dosyanın
   geri kalanı sunucu tarafındaki iş akışı motorunu (graph doğrulama, politika,
   veri eşleme, kurtarma sınıflandırması) sınar ve o katman duruyor; yalnız
   arayüzü çivileyen iddia düştü. Yerine arayüzün GERÇEKTEN gittiği doğrulanır. */
test('v6.36 Agent Workflow Studio arayüzü uygulamadan kaldırıldı',()=>{
  assert.doesNotMatch(INDEX,/id="agentWorkflowStudio"/);
  assert.doesNotMatch(INDEX,/agent-workflows\.js/);
  assert.doesNotMatch(INDEX,/data-tab="agents"/);
  assert.equal(fs.existsSync(path.join(root,'public','agent-workflows.js')),false);
});

test('v5.46 server exposes only controlled workflow platform endpoints',()=>{
  for(const endpoint of ['/api/agent-platform','/api/agent-platform/plan','/api/agent-platform/workflows']) assert.ok(SERVER.includes(endpoint),endpoint);
  assert.match(SERVER,/createPolicyEngine/);assert.match(SERVER,/createToolRegistry/);assert.match(SERVER,/createAgentRuntime/);
});
