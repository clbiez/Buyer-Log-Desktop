'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(root,'public','app.css'),'utf8');

test('v7.78 Collection Summary KPI rozetleri filtre çipleriyle aynı satırdadır',()=>{
  assert.match(INDEX,/id="ovCollectionSummaryFilters"[\s\S]*id="ovCollectionSummaryKpi"/);
  assert.match(CSS,/\.ovCollectionSummaryFilters>\.ovCollectionSummaryKpi\{[^}]*display:contents/);
});
