'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const browser=require('../server/lib/agent-browser-connector');
const browserSettings=require('../server/lib/agent-browser-settings');
const {createPolicyEngine}=require('../server/lib/agent-policy-engine');
const {createToolRegistry}=require('../server/lib/agent-tool-registry');
const SERVER=fs.readFileSync(path.join(root,'server','server.js'),'utf8');
/* v6.36: Agent Workflow Studio kaldırıldı, public/agent-workflows.js artık yok.
   Bu dosyanın asıl konusu TARAYICI MOTORU (portable-web-engine + connector) —
   o katman duruyor ve testleri korunuyor. Kaydedici arayüzüne ait iddialar
   Automations arayüzüne taşındı. */
const AUTO=fs.readFileSync(path.join(root,'public','automations.js'),'utf8');

function registry(){return createToolRegistry({
  getDataset:async()=>[],refresh:async()=>({ok:true}),snapshotOrder:async()=>({}),updateOrder:async()=>({}),restoreOrder:async()=>({}),httpRequest:async()=>({}),browserRun:async(args)=>({ok:true,args})
});}
function rec(){return{stopped:false,steps:[],updatedAt:''};}
function target(selector='#save'){return{strategy:'css',selector,targets:[{strategy:'css',selector},{strategy:'role',selector:'Save',role:'button',name:'Save'}],description:'Save'};}

test('v5.54 Browser Automation is a controlled external tool that always requires approval',()=>{
  const tool=registry().get('connector.browser.run');
  assert.ok(tool);assert.equal(tool.kind,'browser');assert.equal(tool.risk,'external');assert.equal(tool.approval,true);assert.equal(tool.rollbackable,false);
  assert.match(JSON.stringify(tool.inputSchema),/items/);
});

test('v5.54 browser policy allows only allowlisted HTTPS hosts and their subdomains',()=>{
  const policy=createPolicyEngine({userAccess:{hasArea:()=>true},getAllowedBrowserHosts:()=>['portal.example.com']});
  const tool=registry().get('connector.browser.run');
  assert.equal(policy.evaluate({},tool,{url:'http://portal.example.com'},{approvalGranted:true}).allowed,false);
  assert.equal(policy.evaluate({},tool,{url:'https://evil.example.com'},{approvalGranted:true}).allowed,false);
  assert.equal(policy.evaluate({},tool,{url:'https://portal.example.com/app'},{approvalGranted:true}).allowed,true);
  assert.equal(policy.evaluate({},tool,{url:'https://sub.portal.example.com/app'},{approvalGranted:true}).allowed,true);
});

test('v5.54 browser allowlist settings normalize URLs, casing and duplicates',()=>{
  assert.deepEqual(browserSettings.normalizeHosts(['HTTPS://Portal.Example.com/login','portal.example.com','https://erp.example.com/path']),['portal.example.com','erp.example.com']);
  assert.equal(browserSettings.normalizeHost('not a host'),'');
});

test('v5.54 recorder preserves repeated clicks, collapses field edits, and converts double-click correctly',()=>{
  const r=rec(),click={action:'click',...target('#row')};
  assert.equal(browser.appendRecordedStep(r,click,1000),true);
  assert.equal(browser.appendRecordedStep(r,click,1100),true);
  assert.equal(r.steps.length,2,'repeated real clicks must not be silently lost');
  assert.equal(browser.appendRecordedStep(r,{action:'dblclick',...target('#row')},1200),true);
  assert.deepEqual(r.steps.map(x=>x.action),['dblclick']);
  assert.ok(r.steps[0].targets.length>=2,'selector alternatives must be preserved');
  const f=rec();browser.appendRecordedStep(f,{action:'fill',...target('#name'),value:'A'},2000);browser.appendRecordedStep(f,{action:'fill',...target('#name'),value:'AB'},2100);
  assert.equal(f.steps.length,1);assert.equal(f.steps[0].value,'AB');
});

test('v5.54 recorder refuses sensitive password/OTP/token/PIN/CVV fields',()=>{
  for(const fieldType of ['password','otp','token','pin','cvv']){const r=rec();assert.equal(browser.appendRecordedStep(r,{action:'fill',...target('#secret'),fieldType,value:'1234',description:fieldType},1000),false);assert.equal(r.steps.length,0);}
});

test('v5.54 batch browser replay supports item fields with spaces and index placeholders',()=>{
  const item={'Order Code':'12345','Revised Ex-factory':'2026-09-10',nested:{value:'X'}};
  assert.equal(browser.interpolateItem('{{item.Order Code}}',item,7),'12345');
  assert.equal(browser.interpolateItem('EX={{item.Revised Ex-factory}} / {{index}}',item,7),'EX=2026-09-10 / 7');
  assert.equal(browser.interpolateItem('{{item.nested.value}}',item,7),'X');
});

test('v5.54 server and the automation UI expose allowlist, recorder and same-window browser routes',()=>{
  for(const route of ['/api/automations/browser/status','/api/automations/browser/settings','/api/automations/browser/open','/api/automations/browser/record/start'])assert.ok(SERVER.includes(route),route);
  assert.match(AUTO,/Yaptıklarımı Kaydet/i);
});

test('v5.54 old Agent Center stays removed while the new connector uses only the generic portable engine',()=>{
  for(const file of ['public/agents.js','server/lib/agent-store.js','server/lib/web-agent-runner.js'])assert.equal(fs.existsSync(path.join(root,file)),false,file);
  assert.equal(fs.existsSync(path.join(root,'server/lib/portable-web-engine.js')),true);
  assert.equal(fs.existsSync(path.join(root,'server/lib/agent-browser-connector.js')),true);
  assert.doesNotMatch(SERVER,/\/api\/agents\b|initAgentCenter|agentCenterRoot|web-agent-profiles/);
});
