'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Mapping = require('../public/excel-import-mapping.js');
require('../public/excel-import-match.js');
const Plan = require('../public/excel-import-plan.js');
const WIZARD = fs.readFileSync(path.join(ROOT, 'public', 'excel-import-wizard.js'), 'utf8');

const fields = [
  { id:'plmId', label:'PLM ID', dataType:'code', writable:true, identity:true, aliases:['PLM ID'] },
  { id:'modelKod', label:'Model Adı', dataType:'text', writable:true, identity:true, aliases:['Model Adı','Model Name'] },
  { id:'colourCode', label:'Renk Kodu', dataType:'code', writable:true, identity:true, aliases:['Colour Code','Renk Kodu'] },
  { id:'not', label:'Notlar', dataType:'text', writable:true, identity:false, aliases:['Notlar','Notes'] },
  { id:'storeMonth', label:'Mağaza Ayı', dataType:'text', writable:true, identity:false, aliases:['Mağaza Ayı'] },
];
const columns = [
  { id:'c1', header:'PLM ID', rawHeader:'PLM ID' },
  { id:'c2', header:'Model Adı', rawHeader:'Model Adı' },
  { id:'c3', header:'Colour Code', rawHeader:'Colour Code' },
  { id:'c4', header:'Notlar', rawHeader:'Notlar' },
  { id:'c5', header:'Mağaza Ayı', rawHeader:'Mağaza Ayı' },
];
const assignments = {
  c1:{ action:'match', targetId:'plmId' },
  c2:{ action:'match', targetId:'modelKod' },
  c3:{ action:'match', targetId:'colourCode' },
  c4:{ action:'update', targetId:'not' },
  c5:{ action:'ignore', targetId:'__ignore__' },
};
const targetRows = ['BLK','NAV','WHT','GRY','KHA'].map((colourCode,index)=>({
  id:index+1, plmId:'100', modelKod:'X', colourCode, not:'old-'+colourCode, storeMonth:'Sep', _rev:1,
}));
const cell = value => ({ value, text:String(value ?? '') });
const sourceRow = (id, excelRowNumber, colourCode, note, month='Oct') => ({
  id, excelRowNumber,
  cells:{ c1:cell('100'), c2:cell('X'), c3:cell(colourCode), c4:cell(note), c5:cell(month) },
});
function spec(rows, extraTarget={}) {
  return {
    moduleId:'collection', fields,
    source:{ fingerprint:'f', sheetName:'Koleksiyon', headerRow:0, columns, rows },
    mapping:{ assignments, newColumns:[] },
    matchRule:{ fieldIds:['plmId','modelKod','colourCode'] },
    options:{ blankClears:false, createNew:true },
    decisions:{ excludedSourceRows:[], ambiguousChoice:{}, duplicateResolution:{} },
    target:{
      rows:targetRows, revision:1, rowRevision:r=>r._rev, rowLabel:r=>r.colourCode,
      readValue:(r,id)=>r[id], canCreate:true, ...extraTarget,
    },
  };
}

test('Collection Sütunlar adımı dört aksiyonlu ve varsayılanı yalnız canonical identity sütunlarında Match', () => {
  assert.match(WIZARD, /var defaultMatchTargets = new Set\(\['plmId', 'modelKod', 'colourCode'\]\)/);
  assert.match(WIZARD, /action: shouldMatch \? 'match' : 'ignore'/);
  assert.match(WIZARD, /data-xim="column-action"/);
  for (const action of ['create','update','match','ignore']) assert.match(WIZARD, new RegExp(`actionRadio\\(column\\.id, '${action}'`));
  assert.match(WIZARD, /Mevcut Collection satırlarını bulabilmek için en az bir sütunu/);
});

test('Match yalnız identity bulur; Update yalnız seçili hedefi yazar; Ignore hiçbir alana yazılmaz', () => {
  const validation = Mapping.validateMapping({ assignments, fields, columns, matchFields:['plmId','modelKod','colourCode'] });
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  const rows = [
    sourceRow('r1',2,'BLK','A'), sourceRow('r2',3,'NAV','B'), sourceRow('r3',4,'WHT','C'),
    sourceRow('r4',5,'GRY','D'), sourceRow('r5',6,'KHA','E'),
  ];
  const plan = Plan.buildImportPlan(spec(rows));
  assert.equal(plan.executable, true, JSON.stringify(plan.blocking));
  assert.equal(plan.operations.length, 5);
  assert.deepEqual(plan.operations.map(op=>op.changes.map(change=>change.fieldId)), Array(5).fill(['not']));
  assert.deepEqual(plan.operations.map(op=>op.changes[0].to), ['A','B','C','D','E']);
  assert.ok(plan.operations.every(op=>op.changes.every(change=>!['plmId','modelKod','colourCode','storeMonth'].includes(change.fieldId))));
});

test('Explicit colour-level aynı değer bile override niyeti olarak plana girebilir; blank hücre mevcut semantiği korur', () => {
  const same = sourceRow('same',2,'NAV','old-NAV','Sep');
  const forced = Plan.buildImportPlan(spec([same], { forceExplicitSet:(row,fieldId)=>row.colourCode==='NAV' && fieldId==='not' }));
  assert.equal(forced.operations.length, 1);
  assert.equal(forced.operations[0].changes[0].fieldId, 'not');
  assert.equal(forced.operations[0].changes[0].to, 'old-NAV');

  const blank = Plan.buildImportPlan(spec([sourceRow('blank',2,'NAV','','Sep')]));
  assert.equal(blank.operations.length, 0, 'blankClears=false iken boş hücre update/override üretmemeli');
});

test('Eşleşme alanı yoksa ve duplicate update target varsa import validation açıkça bloklar', () => {
  const noMatch = {
    ...assignments,
    c1:{ action:'ignore', targetId:'__ignore__' },
    c2:{ action:'ignore', targetId:'__ignore__' },
    c3:{ action:'ignore', targetId:'__ignore__' },
  };
  const noMatchResult = Mapping.validateMapping({ assignments:noMatch, fields, columns, matchFields:[] });
  assert.equal(noMatchResult.ok, false);
  assert.ok(noMatchResult.issues.some(issue=>issue.code==='match-rule-required'));

  const duplicate = { ...assignments, c5:{ action:'update', targetId:'not' } };
  const duplicateResult = Mapping.validateMapping({ assignments:duplicate, fields, columns, matchFields:['plmId','modelKod','colourCode'] });
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.issues.some(issue=>issue.code==='duplicate-target-mapping'));
});

test('Create + Update + Match aynı planda çalışır; eşleşmeyen yeni row identity alanlarını Match kaynaklarından alır', () => {
  const createAssignments = { ...assignments, c5:{ action:'create', targetId:'__new__', newColumnLabel:'Fit Note', newColumnType:'text' } };
  const unmatched = {
    id:'new1', excelRowNumber:10,
    cells:{ c1:cell('200'), c2:cell('Y'), c3:cell('RED'), c4:cell('new note'), c5:cell('fit ok') },
  };
  const plan = Plan.buildImportPlan({
    ...spec([unmatched]),
    mapping:{ assignments:createAssignments, newColumns:[{ id:'new:c5', columnId:'c5', label:'Fit Note', dataType:'text' }] },
  });
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].op, 'create');
  assert.equal(plan.operations[0].values.plmId, '200');
  assert.equal(plan.operations[0].values.modelKod, 'Y');
  assert.equal(plan.operations[0].values.colourCode, 'RED');
  assert.equal(plan.operations[0].values.not, 'new note');
  assert.equal(plan.operations[0].values['new:c5'], 'fit ok');
});
