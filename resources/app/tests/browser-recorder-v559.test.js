'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const browser=require('../server/lib/agent-browser-connector');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');

function rec(){return{stopped:false,steps:[],updatedAt:''};}
function target(label='Search'){return{strategy:'role',selector:label,role:'button',name:label,targets:[{strategy:'role',selector:label,role:'button',name:label},{strategy:'text',selector:label,role:'button',name:label}],description:label,frameUrl:'https://plm.example.com/styles'};}

test('v5.59 recorder captures action buttons on pointerdown before SPA submit/rerender',()=>{
  const source=browser.recorderInstaller.toString();
  assert.match(source,/pointerdown-early/);
  assert.match(source,/document\.addEventListener\('pointerdown'/);
  assert.match(source,/button,input\[type="button"\],input\[type="submit"\]/);
  assert.match(source,/lastPointerClickEl===el/,'normal click/pointerup must suppress only the duplicate event from the same physical click');
});

test('v5.59 recorder has submit fallback for search forms that replace the DOM immediately',()=>{
  const source=browser.recorderInstaller.toString();
  assert.match(source,/document\.addEventListener\('submit'/);
  assert.match(source,/event&&event\.submitter/);
  assert.match(source,/submit-fallback/);
});

test('v5.59 recorded search flow preserves fill then Search button click as replayable steps',()=>{
  const r=rec();
  browser.appendRecordedStep(r,{action:'click',strategy:'placeholder',selector:'Search',targets:[{strategy:'placeholder',selector:'Search'}],description:'Search field'},1000);
  browser.appendRecordedStep(r,{action:'fill',strategy:'placeholder',selector:'Search',targets:[{strategy:'placeholder',selector:'Search'}],description:'Search field',value:'1171233'},1100);
  browser.appendRecordedStep(r,{action:'click',...target('Search')},1200);
  assert.deepEqual(r.steps.map(step=>step.action),['click','fill','click']);
  assert.equal(r.steps[1].value,'1171233');
  assert.equal(r.steps[2].role,'button');
  assert.equal(r.steps[2].name,'Search');
});

// Regression guard: pointerdown is early capture, not a server-side dedupe that would
// erase legitimate repeated button clicks.
test('v5.59 repeated real Search clicks remain separate recorded actions',()=>{
  const r=rec(),click={action:'click',...target('Search')};
  browser.appendRecordedStep(r,click,1000);
  browser.appendRecordedStep(r,click,1800);
  assert.equal(r.steps.length,2);
});
