'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const ACCESS=fs.readFileSync(path.join(ROOT,'server','lib','user-access.js'),'utf8');
const connector=require('../server/lib/agent-browser-connector');
const store=require('../server/lib/automation-recipe-store');
const { assertLazy }=require('./helpers/script-loading');

/* v6.36: Agents sekmesi kaldırıldı; Automations tek otomasyon ekranı. Eski iddia
   Agents'ın VARLIĞINI çiviliyordu, bu yüzden ters çevrildi. */
test('v6.36 Automations tek otomasyon sayfası; Agents sekmesi kaldırıldı',()=>{
  assert.doesNotMatch(INDEX,/data-tab="agents"/);
  assert.doesNotMatch(INDEX,/id="view-agents"/);
  assert.match(INDEX,/data-tab="automations"/);
  assert.match(INDEX,/id="view-automations"/);
  assertLazy('automations.js');
  assert.match(APP,/tab==='automations'.*initAutomationStudio/s);
});

test('v5.55 Automations execution is deterministic and does not call AI planner endpoints',()=>{
  assert.doesNotMatch(UI,/agent-platform\/plan|ai-settings|OpenAI|Responses API/i);
  assert.match(UI,/Yaptıklarımı Kaydet/);
  assert.match(UI,/Dry Run/);
  assert.match(UI,/\{\{item\.Alan\}\}/);
});

test('v5.55 server exposes CRUD, recorder, preview and run APIs under the Automations area',()=>{
  for(const route of [
    "/api/automations'", "/api/automations/recipes'", "/api/automations/browser/open'",
    "/api/automations/browser/record/start'", "/api/automations/recipes/:id/preview'", "/api/automations/recipes/:id/run'"
  ]) assert.ok(SERVER.includes(route),route);
  assert.match(SERVER,/requireArea\('automations'\)/);
  assert.match(ACCESS,/'automations'/);
});

test('v5.55 recipe store caps batch size at 200 and normalizes deterministic filters',()=>{
  const recipe=store.normalizeRecipe({name:'Portal',source:'cp',limit:999,filters:[{field:'Sipariş Kod',operator:'contains',value:'123'}],steps:[]},'u1');
  assert.equal(recipe.ownerId,'u1');
  assert.equal(recipe.limit,200);
  assert.deepEqual(recipe.filters[0],{field:'Sipariş Kod',operator:'contains',value:'123'});
});

test('v5.55 browser connector supports page-text verification without a selector',()=>{
  const step=connector.normalizeStep({action:'assert_text',value:'Changes saved',description:'verify'},0);
  assert.equal(step.action,'assert_text');
  assert.equal(step.value,'Changes saved');
  assert.deepEqual(step.targets,[]);
  assert.match(fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8'),/continueOnError=args\.continueOnError===true/);
});

test('v5.55 Automation UI lets recorded values become row placeholders and shares browser allowlist',()=>{
  assert.match(UI,/\{\{item\.Sipariş Kod\}\}/);
  assert.match(UI,/\/api\/automations\/browser\/settings/);
  assert.match(SERVER,/agentBrowserSettings\.saveSettings/);
  assert.match(fs.readFileSync(path.join(ROOT,'server/lib/automation-execution-service.js'),'utf8'),/agentBrowserConnector\.run/);
});
