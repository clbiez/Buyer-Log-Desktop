'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const writer = require('../server/lib/data-domain/source-writer');

const src = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ui = src('public/data-management.js');
const editor = src('public/data-management-mapping.js');
const readModel = src('server/lib/data-domain/read-model.js');
const server = src('server/server.js');

test('healthy Field Mapping heading opens editor with manage permission', () => {
  assert.match(ui, /class="dmMappingLink" data-open-mapping=/);
  assert.match(ui, /model\.canManage && \(source\.capabilities \|\| \[\]\)\.includes\('field-mapping'\)/);
  assert.match(ui, /mappingEntries: source\.mappingEntries \|\| \{\}/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function openMappingEditor('),ui.indexOf('function openCpColumnsEditor(')), /if \(!problems\.length\)/);
});

test('overview exposes existing mappings instead of inventing them from health', () => {
  assert.match(readModel, /mappingEntries: health \? clone\(\(mappingSet && mappingSet\.entries\) \|\| \{\}\) : null/);
  assert.match(readModel, /mappingRole: source\.legacyRole/);
});

test('editor offers complete field catalogue, filter, auto-map and explicit save', () => {
  assert.match(editor, /\/api\/model-fields\?role=/);
  assert.match(editor, /data-search/);
  assert.match(editor, /data-auto/);
  assert.match(editor, /data-save/);
  assert.match(editor, /\/api\/model-connections\/automap/);
  assert.match(editor, /if \(!draft\[header\] && entry && entry\.name/);
  assert.match(editor, /mappingChanges: edits, expectedSourceRevision: context\.revision/);
  assert.match(editor, /if \(changes\(\)\.length && !window\.confirm/);
  assert.match(editor, /if \(context\.repair && header === context\.repair\.header\)/);
});

test('mapping batch updates only requested fields in a single atomic plan', () => {
  const before = [{id:'asas',mapping:{
    'Sipariş Kod':{kind:'column',table:'A',name:'OrderCode'},
    'FOB Fiyatı':{kind:'measure',table:'A',name:'Price'}
  }}];
  const result = writer.planMappingChanges(before, { sourceId:'asas', changes:[
    {header:'Sipariş Kod',entry:{kind:'column',table:'B',name:'OrderNo'}},
    {header:'Model Adı',entry:{kind:'column',table:'B',name:'StyleName'}}
  ]});
  assert.equal(result.ok,true);
  assert.equal(before[0].mapping['Sipariş Kod'].name,'OrderCode');
  assert.equal(result.items[0].mapping['FOB Fiyatı'].name,'Price');
  assert.equal(result.items[0].mapping['Sipariş Kod'].name,'OrderNo');
  assert.equal(result.items[0].mapping['Model Adı'].name,'StyleName');
  assert.equal(writer.planMappingChanges(before,{sourceId:'asas',changes:[
    {header:'Model Adı',entry:null},{header:'Model Adı',entry:{name:'other'}}
  ]}).ok,false);
  assert.equal(writer.planMappingChanges(before,{sourceId:'nope',changes:[{header:'Model Adı',entry:null}]}).ok,false);
});

test('PATCH uses existing source revision guard for atomic mapping changes', () => {
  const route = server.slice(server.indexOf("app.patch('/api/data-management/source/:id'"),server.indexOf("/* KAYNAĞI SİL (§7)",server.indexOf("app.patch('/api/data-management/source/:id'")));
  assert.match(route,/expectedSourceRevision/);
  assert.match(route,/planMappingChanges\(store\.items/);
  assert.match(route,/replaceModelConnections\(plan\.items, null\)/);
});
