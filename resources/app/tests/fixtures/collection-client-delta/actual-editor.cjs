'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const pins = require('./actual-source-pins.json');
const publicRoot = path.resolve(__dirname, '../../../public');
for (const [name, expected] of Object.entries(pins.blobs)) {
  const bytes = fs.readFileSync(path.join(publicRoot, name));
  const actual = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  if (actual !== expected) throw new Error('Actual Collection source changed; review before updating fixture: ' + name);
}
const source = fs.readFileSync(path.join(publicRoot, 'app-main.js'), 'utf8');
const groups = require(path.join(publicRoot, 'collection-model-groups.js'));
const boundaries = [
  ['editableValuesEqual', '// Açılır pencere'],
  ['kolNormalizeModelGroups', 'function kolLinkImportedColourVariants('],
  ['kolFieldMetadata', 'function kolIsColorSpecific('],
  ['kolIsColorSpecific', '/* Collection colour inheritance'],
  ['kolCellLinkedToModel', 'function kolHasVariantOverride('],
  ['kolHasVariantOverride', 'function kolEffectiveValue('],
  ['kolEffectiveValue', 'function kolEffectiveEndeksmatikRow('],
  ['kolWriteGroupedStorageValue', 'function kolEffectivePricing('],
  ['commitKolEditor', 'function commitKolPriceEditor('],
  ['kolSpreadsheetMakeEditor', '/* Koleksiyon satırında üreticiyi onaylar'],
  ['kolApplyCollectionCellChange', 'const KOL_VARIANT_FIELDS='],
  ['kolSnapshot', 'function kolPushUndo('],
  ['kolPushUndo', 'let kolBulkHistoryBusy='],
];
function extract(text, name, endToken) {
  const startToken = 'function ' + name + '(';
  const start = text.indexOf(startToken), end = text.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || text.indexOf(startToken, start + 1) >= 0) throw new Error('Actual extraction boundary changed: ' + name);
  return text.slice(start, end);
}
const functions = boundaries.map(([name, end]) => extract(source, name, end)).join('\n');
const script = new vm.Script(functions, { filename: 'actual-collection-edit-snapshot.js' });
function input() {
  return { dataset: {}, value: '', className: '', isConnected: false,
    classList: { add() {}, contains(name) { return this.element.className.split(/\s+/).includes(name); } } };
}
function createEditor(rows, columns) {
  const context = {
    kolRows: rows, kolWorkspaceCanEdit: true, kolWorkspaceRevision: 10, kolBulkPreparing: false, appLang: 'en',
    kolUndoStack: [], kolRedoStack: [], kolUndoSummaryStack: [], kolRedoSummaryStack: [],
    window: { BLCollectionModelGroups: groups }, document: { createElement() { const el = input(); el.classList.element = el; return el; } },
    KOL_FALLBACK_COLOR_FIELDS: new Set(['quantity', 'img', 'imgRef', 'colour', 'colourCode', 'durum', 'status']),
    KOL_LANDED_INPUT_COLS: {},
    kolFieldDescriptorByKey: key => { const col = columns.find(col => col.k === key); return col ? { kind: 'base', col } : null; },
    kolSpreadsheetColumnMeta: key => ({ col: columns.find(col => col.k === key), type: 'text' }),
    isAreaFrozen: () => false, norm: value => String(value == null ? '' : value).trim(),
    releaseKolTransientTopRow() {}, updateKolUndoRedoButtons() {},
    // Side effects are excluded from this module comparison.
    saveKolRows() { throw new Error('Unexpected persistence'); }, renderKol() { throw new Error('Unexpected render'); },
    refreshKolSummaryFooter() { throw new Error('Unexpected render'); }, showToast() {},
  };
  vm.createContext(context); script.runInContext(context);
  return {
    context,
    edit(rowId, key, value) {
      return context.kolApplyCollectionCellChange({ rowId, key, value, source: 'manual' }, { save: false, pushUndo: true, rerender: false, syncQuotations: false });
    },
  };
}
module.exports = { createEditor, groups, boundaries, extract, source, pins };
