'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const UI=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','automations-fields.css'),'utf8');
const store=require('../server/lib/automation-recipe-store');
const mail=require('../server/lib/automation-email');

test('Automations grouped CP-style selector script parses and is loaded with theme CSS',()=>{
  assert.doesNotThrow(()=>new Function(UI));
  assert.match(INDEX,/automations-fields\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(CSS,/var\(--card\)/);
  assert.match(CSS,/\.autoColumnsGroup/);
  assert.match(CSS,/\.autoColumnsSelectedList/);
  assert.match(UI,/function reportFieldGroups\(fields\)/);
  assert.match(UI,/function openReportColumns\(\)/);
  assert.match(UI,/data-auto-columns-open/);
  assert.match(UI,/data-columns-group-check/);
  assert.match(UI,/data-selected-column/);
  assert.match(UI,/data-columns-move/);
  assert.doesNotMatch(UI,/refreshReportFieldChoices|data-email-field-choices/);
});

test('Selected report fields retain intentional order through recipe persistence and CSV export',()=>{
  const order=['Model Name','Order Code','Manufacturer'];
  const normalized=store.normalizeRecipe({
    name:'Weekly report',purpose:'email',source:'cp',
    email:{subject:'Weekly report',reportFields:order},
  },'test-user');
  assert.deepEqual(normalized.email.reportFields,order);
  const csv=mail.csv([{ 'Order Code':'123', 'Model Name':'Jacket', 'Manufacturer':'Factory' }],normalized.email.reportFields);
  assert.equal(csv.split('\r\n')[0],'Model Name;Order Code;Manufacturer');
  assert.equal(csv.split('\r\n')[1],'Jacket;123;Factory');
});

test('Report field selection keeps 40-column limit and explicit automatic-selection fallback',()=>{
  const fields=Array.from({length:50},(_,i)=>'Column '+i);
  const recipe=store.normalizeRecipe({name:'Report',purpose:'email',source:'cp',email:{reportFields:fields}},'tester');
  assert.equal(recipe.email.reportFields.length,40);
  const defaultRecipe=store.normalizeRecipe({name:'Report',purpose:'email',source:'cp',email:{reportFields:[]}},'tester');
  assert.deepEqual(defaultRecipe.email.reportFields,[]);
  assert.match(UI,/data-columns-auto/);
});
