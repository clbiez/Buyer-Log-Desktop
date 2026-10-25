'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(root,'public','app-main.js'),'utf8');
const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v5.69 Overseas Landed footer shows quantity-weighted percentage change versus TR Landed',()=>{
  assert.match(APP,/function kolWeightedLandedChange\(rows,landedByRow\)/);
  assert.match(APP,/ydWeighted\+=yd\*qty;trWeighted\+=tr\*qty;totalQty\+=qty/);
  assert.match(APP,/\(\(trAvg-ydAvg\)\/trAvg\)\*100/);
  assert.match(APP,/ydLandedWeightedChange=kolWeightedLandedChange\(rows,landedByRow\)/);
  assert.match(APP,/kolAverageFooter\(ydLandedAvg,ydLandedArithmetic,L\('Overseas Landed'\),\{weightedChangePct:ydLandedWeightedChange\}\)/);
  assert.match(APP,/Ağ\.% Δ/);
  assert.match(CSS,/collectionWeightedChangeLine strong\.isPositive\{color:var\(--ui-success\)\s*!important/);
  assert.match(CSS,/collectionWeightedChangeLine strong\.isNegative\{color:var\(--ui-danger\)\s*!important/);
});
