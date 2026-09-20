'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const browser=require('../server/lib/agent-browser-connector');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');
const ENGINE=fs.readFileSync(path.join(ROOT,'server','lib','portable-web-engine.js'),'utf8');
const AUTO=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');

function rec(){return{stopped:false,steps:[],updatedAt:''};}
function target(selector='input[placeholder="Search"]'){return{strategy:'css',selector,targets:[{strategy:'css',selector},{strategy:'placeholder',selector:'Search'}],description:'Search',frameUrl:'https://plm.example.com/styles'};}

test('v5.56 recorder treats editable search fields as click targets and has value fallbacks',()=>{
  const source=browser.recorderInstaller.toString();
  assert.match(source,/input\[type="search"\]/);
  assert.match(source,/role="searchbox"/);
  assert.match(source,/const field=editable\(first\); if\(field\)return field/);
  assert.match(source,/focusin/);
  assert.match(source,/beforeinput/);
  assert.match(source,/keyup-fallback/);
  assert.match(source,/value-watchdog/);
  assert.doesNotMatch(source,/if\(!first\|\|editable\(first\)\)return null/);
});

test('v5.56 search click + typed value remain separate replayable steps and field edits collapse',()=>{
  const r=rec();
  browser.appendRecordedStep(r,{action:'click',...target()},1000);
  browser.appendRecordedStep(r,{action:'fill',...target(),value:'2108315'},1100);
  browser.appendRecordedStep(r,{action:'fill',...target(),value:'21083155'},1200);
  assert.deepEqual(r.steps.map(step=>step.action),['click','fill']);
  assert.equal(r.steps[1].value,'21083155');
  assert.equal(r.steps[1].frameUrl,'https://plm.example.com/styles');
});

test('v5.56 portable locator searches open shadow roots, same-origin frames and searchbox roles',()=>{
  assert.match(ENGINE,/el\.shadowRoot/);
  assert.match(ENGINE,/el\.contentDocument/);
  assert.match(ENGINE,/wantedRole==='searchbox'/);
  assert.match(ENGINE,/input\[type="search"\]/);
});

test('v5.56 Automations UI explains enterprise search-field fallback capture',()=>{
  assert.match(AUTO,/Arama kutuları ve framework kontrollü alanlarda/);
  assert.match(AUTO,/actual-value fallbacks/);
  assert.match(CONNECTOR,/__buyerLogBrowserRecorderV3/);
});
