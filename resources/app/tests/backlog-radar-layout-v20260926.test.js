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
  assert.match(RADAR,/iconButton\('swap'/);
  assert.match(RADAR,/pivot-collapse/);
  assert.match(RADAR,/radar-collapse/);
  assert.match(CSS,/\.backlogPivotRadarWorkspace/);
  assert.match(CSS,/\.backlogWorkspaceSplitter/);
  assert.match(CSS,/grid-template-columns:minmax\(0,1fr\) 7px minmax\(0,1fr\)/);
});

test('Both radars have independent filters and keep side labels readable',()=>{
  assert.match(RADAR,/pivotHidden:\[\]/);
  assert.match(RADAR,/riskHidden:\[\]/);
  assert.match(RADAR,/data-radar-filter-panel="pivot"/);
  assert.match(RADAR,/data-radar-filter-panel="risk"/);
  assert.match(RADAR,/const width=620,height=390/);
  assert.match(CSS,/\.backlogRadarBody\{[^}]*overflow:visible/);
  assert.match(CSS,/\.blRadarSvg\{[^}]*overflow:visible/);
  assert.match(CSS,/\.backlogRadarFilterList/);
});

test('Delivery Risk KPI labels and radar share a 50-50 workspace with a 3x2 KPI grid',()=>{
  assert.match(RADAR,/bdaRiskOverview/);
  assert.match(RADAR,/ensureRiskOverview/);
  assert.match(CSS,/\.bdaRiskOverview\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(CSS,/\.bdaRiskOverview \.bdaKpiRow\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(CSS,/\.bdaRadarCard\.is-collapsed \.backlogRadarBody/);
  assert.doesNotMatch(RADAR,/risk-up|risk-down/);
});
