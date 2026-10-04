'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const body=APP.slice(APP.indexOf('function refreshCompactConnectionKind'),APP.indexOf('function openRefreshStagesModal'));
test('refresh progress is compact and groups the workflow into three user-facing steps',()=>{
  assert.match(body,/ASAS Verisi Çekiliyor/);
  assert.match(body,/IAS Verisi Çekiliyor/);
  assert.match(body,/Denetleme ve Kaydetme/);
  assert.match(body,/Karşılaştırma · kaydetme · önbellek · tamamlama/);
  assert.match(body,/refreshCompactStageIndex/);
  assert.doesNotMatch(body,/refreshStageTable/);
});
test('technical timing remains available behind details and keeps the user open state across live rerenders',()=>{
  assert.match(body,/<details class="refreshCompactDetails">/);
  assert.match(body,/Teknik Detayları Gör/);
  assert.match(body,/const technicalDetailsOpen=host\.querySelector\('\.refreshCompactDetails'\)\?\.open===true/);
  assert.match(body,/if\(technicalDetailsOpen\)\{[\s\S]*?details\.open=true/);
  assert.match(body,/refreshSeconds\(t\.executeMs\)/);
  assert.match(body,/refreshSeconds\(t\.connectionOpenMs\)/);
  assert.match(body,/refreshSeconds\(t\.retryMs\)/);
  assert.match(body,/refreshSeconds\(t\.overheadMs\)/);
});
test('compact refresh UI uses the Buyer Log card language and animated active state',()=>{
  assert.match(CSS,/\.refreshStagesCard\{[^}]*width:min\(440px/);
  assert.match(CSS,/\.refreshCompactStep\.is-active/);
  assert.match(CSS,/@keyframes refreshCompactDot/);
  assert.match(CSS,/@keyframes refreshCompactSweep/);
  assert.match(CSS,/\.refreshStagesOverlay\{[^}]*pointer-events:none/);
});
