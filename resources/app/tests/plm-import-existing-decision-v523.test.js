'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const shared=require('../public/collection-model-groups');

function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}

test('v5.23 existing PLM models are asked one by one before any Collection write',()=>{
  const decisions=between(APP,'function showKolPlmExistingDecision','function kolPlmKnownColourCodes');
  assert.match(decisions,/Update this model/);
  assert.match(decisions,/Keep current \/ Skip/);
  assert.match(decisions,/for\(let index=0;index<\(existing\|\|\[\]\)\.length;index\+\+\)/);
  assert.match(decisions,/await showKolPlmExistingDecision/);
  const importer=between(APP,'async function importKolPlmExcelFile','function kolImportStyleRowId');
  assert.match(importer,/const decisions=await kolResolvePlmExistingDecisions\(plan\.existing\)/);
  assert.match(importer,/if\(decisions\.cancelled\)return/);
  assert.ok(importer.indexOf('kolResolvePlmExistingDecisions')<importer.indexOf('kolPushUndo()'),'no writes/undo snapshot before all model decisions finish');
});

test('v5.23 skipping an existing PLM model never updates fields or picture',()=>{
  const importer=between(APP,'async function importKolPlmExcelFile','function kolImportStyleRowId');
  assert.match(importer,/decisions\.approved\.forEach\(kolApplyApprovedPlmUpdate\)/);
  assert.match(importer,/\.\.\.decisions\.approved\.map\(item=>\(\{row:item\.target,parsed:item\.parsed\}\)\)/);
  assert.doesNotMatch(importer,/decisions\.skipped\.map\(item=>\(\{row:item\.target/);
});

test('v5.23 PLM update preserves Buyer Log user-entered pricing, notes and confirmations',()=>{
  const touched=shared.kolPlmImportTouchedKeys.toString();
  for(const protectedKey of ['pricing','pricingSent','confirmedManufacturer','targetPrice','not','buyingSampleManufacturer','quantity','assortment']){
    assert.doesNotMatch(touched,new RegExp(`['\"]${protectedKey}['\"]`));
  }
  const apply=shared.kolApplyApprovedPlmUpdate.toString();
  assert.match(apply,/item\.changes\.forEach\(change=>kolImportWriteField/);
  assert.doesNotMatch(apply,/target\.pricing\s*=/);
  assert.doesNotMatch(apply,/target\.not\s*=/);
  assert.doesNotMatch(apply,/target\.confirmedManufacturer\s*=/);
  assert.doesNotMatch(apply,/target\.targetPrice\s*=/);
});

test('v5.23 duplicate PLM IDs already in Collection are not silently multiplied',()=>{
  const plan=shared.kolBuildPlmImportPlan.toString();
  assert.match(plan,/else \{ambiguous\.push\(\{parsed,targets:plmTargets\}\);return;\}/);
  assert.match(plan,/if\(plm&&seenInputPlm\.has\(inputIdentity\)\)\{inputDuplicates\.push\(parsed\);return;\}/);
});
