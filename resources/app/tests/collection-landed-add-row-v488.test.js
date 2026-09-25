'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8'));

test('v4.90 Non-DTR landed calculation divides by one minus royalty and adds hologram before multiplier', () => {
  assert.match(INDEX, /function kolLandedPriceWithCosts\(basePrice,row\)/);
  assert.match(INDEX, /const denom=1-royalty/);
  assert.match(INDEX, /return base\/denom\+hologram/);
  assert.match(INDEX, /const trRule=kolFindPricingRuleForCountryGroup\(row,'TR'\)/);
  assert.match(INDEX, /const trCostedUsd=\(trBaseUsd==null\|\|trRuleMissing\)\?null:kolLandedPriceWithRule\(trBaseUsd,row,trRule\)/);
  assert.match(INDEX, /const ydCostedFob=ydBaseFob==null\?null:kolLandedPriceWithCosts\(ydBaseFob,row\)/);
  assert.match(INDEX, /const trLanded=trCostedUsd==null\?null:trCostedUsd\*trMult/);
  assert.match(INDEX, /const ydLanded=ydCostedFob==null\?null:ydCostedFob\*ydMult/);
});

test('v4.88 Add New Model row is temporarily pinned to the first table position', () => {
  assert.match(INDEX, /let kolTransientTopRowId = null/);
  assert.match(INDEX, /kolRows\.unshift\(row\);\s*kolTransientTopRowId=row\.id/);
  assert.match(INDEX, /if\(kolTransientTopRowId!=null\)\{[\s\S]*?const present=ordered\.filter[\s\S]*?ordered=\[\.\.\.present,\.\.\.ordered\.filter/);
});

test('v4.88 new row returns to normal sort/filter flow after editing or filter changes', () => {
  assert.match(INDEX, /if\(editableValuesEqual\(kolEffectiveValue\(row,k\),val\)\) return false;\s*releaseKolTransientTopRow\(id\)/);
  assert.match(INDEX, /th\.querySelector\('\.thLabel'\)\?\.addEventListener\('click',\(\)=>\{releaseKolTransientTopRow\(\)/);
  assert.match(INDEX, /releaseKolTransientTopRow\(\);saveKolColState\(\);panel\.remove\(\);renderKol\(\)/);
  assert.match(INDEX, /const renderSearch=el\.tagName==='INPUT'\s*\?\s*renderKolDebounced\s*:\s*renderKol;\s*el\.addEventListener\(el\.tagName==='INPUT' \? 'input' : 'change', \(\)=>\{releaseKolTransientTopRow\(\);renderSearch\(\);\}\)/);
});
