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
  assert.match(CSS,/\.blvCols\{height:300px\}/);
  assert.match(CSS,/\.blvGroupBars/);
  assert.match(CSS,/\.blvGroupBar/);
  assert.match(OVERVIEW,/blvTimelineLegend/);
});
