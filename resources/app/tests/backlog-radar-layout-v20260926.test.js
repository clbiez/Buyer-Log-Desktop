'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const RADAR=read('public/backlog-radar-layout.js');
const ANALYSIS=read('public/backlog-delivery-analysis.js');
const CSS=read('public/backlog-delivery-analysis.css');
const HTML=read('public/index.html');

test('Backlog chart layout module parses as JavaScript and is loaded by the page',()=>{
  assert.doesNotThrow(()=>new Function(RADAR));
  assert.match(HTML,/src="backlog-radar-layout\.js\?v=__BL_ASSET_VERSION__/);
});

test('Pivot chart reads only top-level groups and canonical visible quantity column',()=>{
  assert.match(RADAR,/tr\[data-depth="0"\]/);
  assert.match(RADAR,/getElementById\('backlogThQty'\)/);
  assert.match(RADAR,/qtyHead\?qtyHead\.cellIndex/);
  assert.match(RADAR,/\.backlogTreeLabel/);
  assert.match(RADAR,/MutationObserver\(schedulePivotRadar\)/);
});

test('Delivery Risk chart is no longer injected into Teslimat Riski Analizi',()=>{
  assert.doesNotMatch(RADAR,/Teslimat Risk Grafiği|Delivery Risk Chart/);
  assert.doesNotMatch(RADAR,/data-risk-radar-card|renderRiskRadar|scheduleRiskRadar/);
  assert.doesNotMatch(RADAR,/refreshRisk/);
});

test('Pivot workspace defaults to half width and supports resize, swap and collapse',()=>{
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

test('Pivot chart keeps filter controls and readable labels',()=>{
  assert.match(RADAR,/pivotHidden:\[\]/);
  assert.match(RADAR,/data-radar-filter-panel="pivot"/);
  assert.match(RADAR,/const width=620,height=390/);
  assert.match(CSS,/\.backlogRadarCard\{[^}]*overflow:visible/);
  assert.match(CSS,/\.backlogRadarBody\{[^}]*overflow:visible/);
  assert.match(CSS,/\.blRadarSvg\{[^}]*overflow:visible/);
  assert.match(CSS,/\.backlogRadarFilterList/);
});

test('Teslimat Riski Analizi KPI etiketleri tek yatay sırada kalır',()=>{
  assert.match(CSS,/\.bdaKpiRow \{[^}]*grid-template-columns: repeat\(6, minmax\(132px, 1fr\)\)[^}]*overflow-x: auto/);
  assert.doesNotMatch(CSS,/\.bdaRiskOverview \.bdaKpiRow\{grid-template-columns:repeat\(3/);
});

test('Teslimat Riski Analizi gövdesi kullanıcı tarafından gizlenip gösterilebilir ve tercih saklanır',()=>{
  assert.match(ANALYSIS,/collapsed: false/);
  assert.match(ANALYSIS,/saved\.collapsed/);
  assert.match(ANALYSIS,/collapsed: state\.collapsed/);
  assert.match(ANALYSIS,/data-action="toggleAnalysis"/);
  assert.match(ANALYSIS,/state\.collapsed = !state\.collapsed; save\(\); render\(\)/);
  assert.match(ANALYSIS,/if \(state\.collapsed\) \{ host\.innerHTML = renderHeader\(\); bind\(host\); return; \}/);
});

test('Requested legacy sections are absent from the Delivery Risk Analysis UI source',()=>{
  assert.doesNotMatch(ANALYSIS,/Otomatik Yorumlar|Automatic Insights/);
  assert.doesNotMatch(ANALYSIS,/Yükleme & Transit Başarımı|Loading & Transit Performance/);
  assert.doesNotMatch(ANALYSIS,/En Riskli Siparişler|Top Risk Orders/);
});

test('Backlog pivot chart persists radar, bar or line chart type',()=>{
  assert.match(RADAR,/pivotChartType:'radar'/);
  assert.match(RADAR,/data-bl-chart-type/);
  assert.match(RADAR,/chartTypeSwitch\('pivot'\)/);
  assert.match(RADAR,/chartSvg\(shown/);
  assert.match(CSS,/\.backlogChartTypeSwitch/);
  assert.match(CSS,/\.blChartBar/);
  assert.match(CSS,/\.blChartLine/);
});
