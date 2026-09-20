'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Collection loads the model-group compatibility layer before the app', () => {
  const html = read('public/index.html');
  assert.ok(html.indexOf('collection-model-groups.js') >= 0);
  assert.ok(html.indexOf('collection-model-groups.js') < html.indexOf('app-main.js'));
});

test('Collection keeps grouping metadata in the flat table and persistence path', () => {
  const app = read('public/app-main.js');
  assert.match(app, /function kolNormalizeModelGroups\(rows\)/);
  assert.match(app, /kolRows=kolNormalizeModelGroups\(kolRows\);/);
  assert.match(app, /tr\.dataset\.modelGroupId/);
  assert.match(app, /modelGroupActions:kolModelGroupActions/);
  assert.match(app, /function kolRelinkColor\(row\)/);
});

test('Spreadsheet context menu reuses the existing bridge for model actions', () => {
  const spreadsheet = read('public/collection-spreadsheet.js');
  assert.match(spreadsheet, /modelGroupActions/);
  assert.match(read('public/collection-spreadsheet.css'), /kolModelGroupVariant/);
});
