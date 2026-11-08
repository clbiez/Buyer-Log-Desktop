'use strict';

// Test reference only. Pinned modules/functions are evaluated only when tests run.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const packetRoot = path.resolve(__dirname, '../../../../../docs/performance-program/parallel-handoff-20261108/02-collection-client/group');
const manifest = require(path.join(packetRoot, 'source-pins.json'));
const referenceRoot = path.join(packetRoot, 'reference');
for (const [name, expected] of Object.entries(manifest.referenceBlobs)) {
  const bytes = fs.readFileSync(path.join(referenceRoot, name));
  const actual = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  if (actual !== expected) throw new Error('Pinned reference blob changed: ' + name);
}
const groups = require(path.join(referenceRoot, 'collection-model-groups.js'));
const appSource = fs.readFileSync(path.join(referenceRoot, 'app-main.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function extracted(name, endToken) {
  const startToken = 'function ' + name + '(';
  const start = appSource.indexOf(startToken), end = appSource.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || appSource.indexOf(startToken, start + 1) >= 0) throw new Error('Pinned function boundary changed: ' + name);
  return appSource.slice(start, end);
}
const functions = [
  ['editableValuesEqual', '// Açılır pencere'],
  ['kolNormalizeModelGroups', 'function kolLinkImportedColourVariants('],
  ['kolFieldMetadata', 'function kolIsColorSpecific('],
  ['kolIsColorSpecific', '/* Collection colour inheritance'],
  ['kolColourOverrideSpec', 'function kolColourOverrideStorageKeys('],
  ['kolColourOverrideStorageKeys', '/* v7.81 — Bu hücre'],
  ['kolCellLinkedToModel', 'function kolHasVariantOverride('],
  ['kolHasVariantOverride', 'function kolEffectiveValue('],
  ['kolEffectiveValue', 'function kolEffectiveEndeksmatikRow('],
  ['kolWriteGroupedStorageValue', 'function kolEffectivePricing('],
  ['commitKolEditor', 'function commitKolPriceEditor('],
  ['kolSpreadsheetMakeEditor', '/* Koleksiyon satırında üreticiyi onaylar'],
  ['kolApplyCollectionCellChange', 'const KOL_VARIANT_FIELDS='],
  ['kolReplaceGroupedRows', 'function kolMakeFieldColorSpecific('],
  ['kolMakeFieldColorSpecific', 'function kolMakePricingColorSpecific('],
  ['kolRelinkField', 'function kolRelinkAllFields('],
  ['groupedFieldOverride', 'function groupedFieldHasAnyOverride('],
].map(([name, end]) => extracted(name, end)).join('\n');

function inputElement() {
  let value = '';
  const classes = new Set(), input = { dataset: {}, className: '', isConnected: false };
  input.classList = { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name) || input.className.split(/\s+/).includes(name) };
  Object.defineProperty(input, 'value', { get: () => value, set: next => { value = String(next); } });
  return input;
}
function appMutation(rows, customColumns, action, rowId, key, value) {
  const columns = clone(customColumns), notices = [];
  const context = {
    kolRows: clone(rows), kolWorkspaceCanEdit: true, kolWorkspaceRevision: 10, kolBulkPreparing: false, appLang: 'en',
    window: { BLCollectionModelGroups: groups }, document: { createElement: () => inputElement() },
    KOL_FALLBACK_COLOR_FIELDS: new Set(['quantity', 'img', 'imgRef', 'colour', 'colourCode', 'durum', 'status']),
    KOL_LANDED_INPUT_COLS: {}, KOL_COLOUR_OVERRIDE_PROJECTION_KEYS: {},
    kolFieldDescriptorByKey: field => { const column = columns.find(item => item.k === field); return column ? { kind: 'base', col: column } : null; },
    kolSpreadsheetColumnMeta: field => ({ col: columns.find(item => item.k === field), type: 'text' }),
    isAreaFrozen: () => false, norm: value => String(value == null ? '' : value).trim(),
    releaseKolTransientTopRow: () => {}, kolPushUndo: () => {}, saveKolRows: () => true,
    renderKol: () => {}, refreshKolSummaryFooter: () => {}, showToast: value => notices.push(value),
  };
  vm.createContext(context);
  vm.runInContext(functions, context, { timeout: 1000, filename: 'pinned-app-group-functions.js' });
  let result;
  if (action === 'cell-edit') result = context.kolApplyCollectionCellChange({ rowId, key, value, source: 'manual' }, { save: false, pushUndo: false, rerender: false, syncQuotations: false });
  else if (action === 'make-override') result = context.kolMakeFieldColorSpecific(context.kolRows.find(row => String(row.id) === String(rowId)), key);
  else if (action === 'clear-override') result = context.kolRelinkField(context.kolRows.find(row => String(row.id) === String(rowId)), key);
  else throw new Error('Unsupported reference app action');
  // Both real grouped write/context-menu paths already call normalizeRows.
  // save:false excludes persistence/DOM/quotation side effects intentionally.
  return { rows: clone(context.kolRows), result, notices };
}
function exportedMutation(rows, action, rowId, key, value) {
  let next;
  if (action === 'shared-value') next = groups.setSharedValue(rows, rows.find(row => String(row.id) === String(rowId)).modelGroupId, key, value);
  else if (action === 'set-override') next = groups.setVariantOverride(rows, rowId, key, value);
  else if (action === 'clear-override') next = groups.clearVariantOverride(rows, rowId, key);
  else throw new Error('Unsupported reference exported action');
  return groups.normalizeRows(next).rows;
}

module.exports = { groups, appMutation, exportedMutation };
