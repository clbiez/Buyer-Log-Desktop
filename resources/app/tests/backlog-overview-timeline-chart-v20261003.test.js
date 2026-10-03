'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const OVERVIEW=fs.readFileSync(path.join(ROOT,'public','backlog-overview.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','backlog-overview.css'),'utf8');

test('Backlog Overview timeline chart script remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(OVERVIEW));
});

test('timeline chart offers persistent stacked and side-by-side modes',()=>{
  assert.match(OVERVIEW,/timelineChart:'stacked'/);
  assert.match(OVERVIEW,/data-blv-chart="stacked"/);
  assert.match(OVERVIEW,/data-blv-chart="grouped"/);
  assert.match(OVERVIEW,/state\.timelineChart=t\.dataset\.blvChart/);
  assert.match(OVERVIEW,/saveState\(\);return render\(\);/);
});

test('side-by-side mode scales each operational status against stage maximum',()=>{
  assert.match(OVERVIEW,/const stageMax=series\.reduce/);
  assert.match(OVERVIEW,/class="blvGroupBar"/);
  assert.match(OVERVIEW,/qty\/stageMax\*100/);
  assert.match(OVERVIEW,/data-blv-tip/);
  assert.match(OVERVIEW,/data-blv-open/);
});

test('timeline receives more vertical room and a local status legend',()=>{
  // Zaman çizelgesi en az 300px alır; #302 kalıcı toplam etiketleri için
  // üst boşlukla birlikte yüksekliği artırdı (sabit değere değil alt sınıra bakılır).
  const colsHeight=Number((CSS.match(/\.blvCols\{height:(\d+)px/)||[])[1]);
  assert.ok(colsHeight>=300,`.blvCols yüksekliği en az 300px olmalı (bulunan: ${colsHeight})`);
  assert.match(CSS,/\.blvGroupBars/);
  assert.match(CSS,/\.blvGroupBar/);
  assert.match(OVERVIEW,/blvTimelineLegend/);
});


test('timeline combines logistics and Buyer breakdown on one shared period axis',()=>{
  assert.match(OVERVIEW,/timelineDimension:'buyingGroup'/);
  assert.match(OVERVIEW,/data-blv-timeline-dim="buyingGroup"/);
  assert.match(OVERVIEW,/data-blv-timeline-dim="buyer"/);
  assert.match(OVERVIEW,/blvUnifiedCols/);
  assert.match(OVERVIEW,/blvLogisticsTrack/);
  assert.match(OVERVIEW,/blvBuyerTrack/);
  assert.match(OVERVIEW,/blvBuyerBar/);
  assert.match(OVERVIEW,/timelineDimensionLegend/);
  assert.match(OVERVIEW,/state\.timelineDimension=t\.dataset\.blvTimelineDim/);
  assert.match(CSS,/\.blvBuyerTrack/);
  assert.match(CSS,/\.blvBuyerBar/);
  const colsHeight=Number((CSS.match(/\.blvCols\{height:(\d+)px/)||[])[1]);
  assert.ok(colsHeight>=500,`birleşik timeline yüksekliği en az 500px olmalı (bulunan: ${colsHeight})`);
});


test('overdue subtotal note cannot change timeline column geometry',()=>{
  assert.match(CSS,/\.blvCols \.bpaColValue\{[^}]*flex:0 0 28px[^}]*min-height:28px[^}]*max-height:28px/);
  assert.match(OVERVIEW,/class="blvColOverdue"/);
});

test('lower Buyer breakdown follows grouped and stacked chart mode',()=>{
  assert.match(OVERVIEW,/class="blvBuyerBars is-grouped"/);
  assert.match(OVERVIEW,/class="blvBuyerBars is-stacked"/);
  assert.match(OVERVIEW,/class="blvBuyerStack"/);
  assert.match(OVERVIEW,/class="blvBuyerStackSeg"/);
  assert.match(CSS,/\.blvBuyerStack\{/);
  assert.match(CSS,/\.blvBuyerStackSeg\{/);
});

test('timeline automatically centers the current period after render',()=>{
  assert.match(OVERVIEW,/requestAnimationFrame\(\(\)=>scrollTimelineToToday\('auto'\)\)/);
  assert.match(OVERVIEW,/const scrollBehavior=behavior==='auto'\?'auto':'smooth'/);
  assert.match(OVERVIEW,/t\.dataset\.blvAction==='today'\)\{scrollTimelineToToday\(\)/);
});


test('timeline keeps the bottom period labels inside the scrollable chart',()=>{
  const colsHeight=Number((CSS.match(/\.blvCols\{height:(\d+)px/)||[])[1]);
  assert.ok(colsHeight>=580,`timeline label alanı için yükseklik en az 580px olmalı (bulunan: ${colsHeight})`);
  assert.match(CSS,/\.blvCols \.bpaColLabel\{[^}]*flex:0 0 26px[^}]*min-height:26px[^}]*max-height:26px[^}]*overflow:visible/);
  assert.match(CSS,/@media\(max-width:900px\)\{\.blvCols\{height:536px/);
});
