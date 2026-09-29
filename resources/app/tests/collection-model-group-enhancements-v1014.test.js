'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');
const Spreadsheet = require('../public/collection-spreadsheet-engine.js');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const spreadsheetSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.js'), 'utf8');
const spreadsheetCssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.css'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const rows = [
  { id: 1, plmId: '2105001', modelKod: 'MINECRAFT-14-YD', inStoreMonth: 'JUNE 2027', colourCode: 'WHT', colour: 'WHITE', fabric: 'Single Jersey' },
  { id: 2, plmId: '2105001', modelKod: 'MINECRAFT-14-YD', inStoreMonth: 'JUNE 2027', colourCode: 'GRY', colour: 'GREY', fabric: '' },
];

test('single clipboard value expands across the selected rectangle', () => {
  assert.deepEqual(
    Spreadsheet.expandPasteMatrix([['Approved']], { r1: 1, r2: 2, c1: 2, c2: 3 }),
    [['Approved', 'Approved'], ['Approved', 'Approved']],
  );
});

test('field metadata distinguishes color-specific and model-inherited fields', () => {
  assert.equal(Groups.fieldMetadata('colourCode').inheritance, 'color');
  assert.equal(Groups.fieldMetadata('img').inheritance, 'color');
  assert.equal(Groups.fieldMetadata('fabric').inheritance, 'model');
  assert.equal(Groups.fieldMetadata('fob').editable, false);
});

test('all color overrides can be re-linked without touching color identity', () => {
  const normalized = Groups.normalizeRows(rows).rows;
  const groupId = normalized[0].modelGroupId;
  const overridden = Groups.setVariantOverride(normalized, 2, 'fabric', 'Two Thread');
  const relinked = Groups.clearAllVariantOverrides(overridden, 2, { groupId });
  assert.equal(Groups.effectiveValue(relinked[1], 'fabric', relinked), 'Single Jersey');
  assert.equal(relinked[1].colourCode, 'GRY');
  assert.deepEqual(relinked[1].variantOverrides, {});
});

test('linked child reads the parent value even when older rows lack shared metadata', () => {
  const normalized = Groups.normalizeRows(rows).rows;
  assert.equal(Groups.effectiveValue(normalized[1], 'fabric', normalized), 'Single Jersey');
});

test('repairs legacy all-variant groups so parent edits propagate', () => {
  const normalized = Groups.normalizeRows(rows).rows;
  const legacy = normalized.map(row => ({ ...row, modelGroupRole: 'variant', modelSharedValues: {} }));
  const repaired = Groups.normalizeRows(legacy).rows;
  const groupId = repaired[0].modelGroupId;
  assert.equal(repaired[0].modelGroupRole, 'parent');
  const shared = Groups.setSharedValue(repaired, groupId, 'modelKod', 'MINECRAFT-14-YD-UPDATED');
  assert.equal(Groups.effectiveValue(shared[1], 'modelKod', shared), 'MINECRAFT-14-YD-UPDATED');
});

test('collapsed groups hide only child rows while preserving the parent', () => {
  const normalized = Groups.normalizeRows(rows).rows;
  const groupId = normalized[0].modelGroupId;
  assert.deepEqual(
    Groups.visibleRows(normalized, new Set([groupId])).map(row => row.id),
    [1],
  );
});

test('Collection exposes relink and non-emoji group controls', () => {
  assert.match(appSource, /function kolRelinkField\(row,key\)/);
  assert.match(appSource, /function kolRelinkAllFields\(row\)/);
  assert.match(appSource, /data-kol-group-toggle/);
  assert.doesNotMatch(appSource, /kolModelGroupBadge[^\n]*[●↳]/);
  assert.match(spreadsheetSource, /state\.dragging/);
  assert.match(spreadsheetSource, /state\.multiCells/);
});

test('Concept 2 keeps model-group toggle in the row gutter, not inside the model cell', () => {
  assert.match(appSource, /class="chkCell kolSpreadsheetRowGutter"[\s\S]*?\$\{groupToggle\}[\s\S]*?class="rowChk"/);
  const start = appSource.indexOf("}else if(c.k==='modelKod')");
  const end = appSource.indexOf("}else if(c.inStorePeriod)", start);
  const modelCell = appSource.slice(start, end);
  assert.doesNotMatch(modelCell, /groupBadge|plmModelLinkHtml/);
});


test('Collection View controls can show or hide all colour variants at once', () => {
  assert.match(indexSource, /id="kolAllVariantsToggle"/);
  assert.match(indexSource, /#i-arrows-down-up/);
  assert.match(appSource, /function kolSetAllVariantsVisible\(visible\)/);
  assert.match(appSource, /function kolAllVariantsVisible\(\)/);
  assert.match(appSource, /kolAllVariantsToggle[^\n]*addEventListener/);
});

test('row-gutter colour hierarchy is theme-safe and visually explicit', () => {
  assert.match(appSource, /#i-chevron-right/);
  assert.match(appSource, /#i-chevron-down/);
  assert.doesNotMatch(spreadsheetCssSource, /kolSpreadsheetRowNumber:hover[^\n]*blue-soft/);
  assert.match(spreadsheetCssSource, /border-left:2px solid color-mix/);
  assert.match(spreadsheetCssSource, /kolModelGroupGutterSpacer\.isVariant::after/);
});
