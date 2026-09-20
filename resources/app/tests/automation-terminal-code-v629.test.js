'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const store=require('../server/lib/automation-recipe-store');
const connector=require('../server/lib/agent-browser-connector');
const UI=fs.readFileSync(path.join(root,'public','automations.js'),'utf8');
const SERVER=fs.readFileSync(path.join(root,'server','server.js'),'utf8');
const CONNECTOR=fs.readFileSync(path.join(root,'server','lib','agent-browser-connector.js'),'utf8');

test('v6.29 stores editable terminal code on each automation recipe',()=>{
  const code='const title=document.title;\nreturn {title};';
  const recipe=store.normalizeRecipe({name:'PLM kodu',purpose:'browser',terminalCode:code},'u1');
  assert.equal(store.SCHEMA_VERSION,4);
  assert.equal(recipe.terminalCode,code);
  assert.equal(store.normalizeRecipe({terminalCode:'x'.repeat(130000)},'u1').terminalCode.length,120000);
});

test('v6.29 UI exposes and persists a real JavaScript editor per automation',()=>{
  assert.match(UI,/Terminal Kodu \(JavaScript\)/);
  assert.match(UI,/data-auto-terminal-code/);
  assert.match(UI,/draft\.terminalCode=e\.target\.value\.slice\(0,120000\)/);
  assert.match(UI,/Ctrl\+S: Kaydet/);
  assert.match(UI,/renderTerminalCodeSection\(\)/);
});

test('v6.29 terminal code is a page-scoped browser step and can run without recorded clicks',()=>{
  const step=connector.normalizeStep({action:'script',value:'return document.title;'},0);
  assert.equal(step.action,'script');
  assert.equal(step.value,'return document.title;');
  assert.deepEqual(step.targets,[]);
  assert.match(SERVER,/action:'script', value:recipe\.terminalCode/);
  assert.match(SERVER,/web adımlarını kaydedin veya Terminal Kodu yazın/);
  assert.match(CONNECTOR,/async function\(item,index\)/);
  assert.match(CONNECTOR,/BROWSER_SCRIPT_FAILED/);
});

test('v6.29 dry-run and audit paths do not expose terminal code contents',()=>{
  assert.match(CONNECTOR,/actions:steps\.map\(step=>\(\{id:step\.id,action:step\.action,description:step\.description/);
  assert.doesNotMatch(SERVER,/appendAudit\([^\n]+terminalCode/);
});
