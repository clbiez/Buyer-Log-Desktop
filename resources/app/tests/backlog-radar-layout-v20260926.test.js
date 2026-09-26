'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const RADAR=read('public/backlog-radar-layout.js');
const CSS=read('public/backlog-delivery-analysis.css');
const HTML=read('public/index.html');

test('Backlog radar layout module parses as JavaScript and is loaded by the page',()=>{
  assert.doesNotThrow(()=>new Function(RADAR));
  assert.match(HTML,/src="backlog-radar-layout\.js\?v=__BL_ASSET_VERSION__/);
});

test('Pivot radar reads only top-level groups and canonical visible quantity column',()=>{
  assert.match(RADAR,/tr\[data-depth="0"\]/);
  assert.match(RADAR,/getElementById\('backlogThQty'\)/);
  assert.match(RADAR,/qtyHead\?qtyHead\.cellIndex/);
  assert.match(RADAR,/\.backlogTreeLabel/);
  assert.match(RADAR,/MutationObserver\(schedulePivotRadar\)/);
});

test('Delivery risk radar is derived from the visible risk KPI labels without changing engine logic',()=>{
  assert.match(RADAR,/\.bdaKpiRow \.bdaKpi:not\(\.is-total\)/);
  assert.match(RADAR,/\.bdaKpiLabel/);
  assert.match(RADAR,/\.bdaKpiValue/);
  assert.doesNotMatch(RADAR,/Engine\.analyze|deliveryOutcome\s*=/);
});

test('Pivot and radar workspace defaults to half width and supports resize, swap and collapse',()=>{
  assert.match(RADAR,/pivotShare:\.5/);
  assert.match(RADAR,/pointerdown/);
  assert.match(RADAR,/Math\.max\(\.28,Math\.min\(\.72/);
  assert.match(RADAR,/data-bl-layout="swap"/);
  assert.match(RADAR,/pivot-collapse/);
  assert.match(RADAR,/radar-collapse/);
  assert.match(CSS,/\.backlogPivotRadarWorkspace/);
  assert.match(CSS,/\.backlogWorkspaceSplitter/);
  assert.match(CSS,/grid-template-columns:minmax\(0,1fr\) 7px minmax\(0,1fr\)/);
});

test('Both radar cards can collapse and the delivery radar can move vertically',()=>{
  assert.match(RADAR,/riskCollapsed/);
  assert.match(RADAR,/riskPosition:'after-kpi'/);
  assert.match(RADAR,/risk-up/);
  assert.match(RADAR,/risk-down/);
  assert.match(CSS,/\.bdaRadarCard\.is-collapsed \.backlogRadarBody/);
});
