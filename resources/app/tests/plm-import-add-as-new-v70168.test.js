'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const shared=require('../public/collection-model-groups');

function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start+' missing');
  assert.ok(b>a,end+' missing');
  return source.slice(a,b);
}

test('existing PLM decision offers explicit Add as a New',()=>{
  const block=between(APP,'function showKolPlmExistingDecision','function kolApplyApprovedPlmUpdate');
  assert.match(block,/data-plmdecision="add-new"/);
  assert.match(block,/Add as a New/);
  assert.match(block,/Yeni olarak ekle/);
  assert.match(block,/else if\(decision==='add-new'\)added\.push\(item\)/);
  assert.match(block,/return \{cancelled:false,approved,skipped,added\}/);
});

test('Add as a New uses the normal new-model creation path in both import flows',()=>{
  const selected=between(APP,'async function importSelectedKolPlmModels','function kolPlmSyncBuildSummary');
  assert.match(selected,/const createInputs=\[\.\.\.plan\.creates,\.\.\.decisions\.added\.map\(item=>item\.parsed\)\]/);
  assert.match(selected,/let created=createInputs\.map/);
  assert.match(selected,/kolApplyNewModelDefaults\(migrateKolRow\(row\)\)/);

  const excel=between(APP,'async function importKolPlmExcelFile','function plmLinkImportValue');
  assert.match(excel,/const createInputs=\[\.\.\.plan\.creates,\.\.\.decisions\.added\.map\(item=>item\.parsed\)\]/);
  assert.match(excel,/let created=createInputs\.map/);
  assert.match(excel,/kolApplyNewModelDefaults\(migrateKolRow\(row\)\)/);
  assert.match(excel,/const skippedCount=decisions\.skipped\.length\+plan\.ambiguous\.length\+plan\.inputDuplicates\.length/);
});

test('automatic PLM planning still never silently duplicates an existing identity',()=>{
  const plan=shared.kolBuildPlmImportPlan.toString();
  assert.match(plan,/existing\.push\(\{target,parsed,changes/);
  assert.match(plan,/else \{ambiguous\.push\(\{parsed,targets:plmTargets\}\);return;\}/);
});
