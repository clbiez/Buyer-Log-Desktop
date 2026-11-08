'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createEditor, groups } = require('./fixtures/collection-client-delta/actual-editor.cjs');
const delta = require('../public/collection-delta-commands.js');
const group = require('../public/collection-group-delta.js');
const groupApi = group.createGroupCommandApi(groups);
const columns = [{ k: 'cx_design', custom: true, label: 'Demo field', dataType: 'text' }];
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return [1, 2, 3, 4].map(id => ({ id, _rev: 2, cx_design: 'old', modelGroupId: id < 4 ? 'g' : 'single',
    modelGroupRole: id === 1 ? 'parent' : id < 4 ? 'variant' : 'single', variantId: 'v' + id,
    modelSharedValues: id === 1 ? { cx_design: 'old' } : {}, variantOverrides: id === 3 ? { cx_design: false } : {}, unknown: { keep: id } }));
}
for (const grouped of [false, true]) {
  test('actual editor + real snapshot parity for ' + (grouped ? 'group' : 'independent') + ' custom field', () => {
    const rows = fixture(), legacy = createEditor(clone(rows), columns), api = grouped ? groupApi : delta;
    const before = api.createState({ ownerId: 'demo', clientGeneration: 1, rows, customColumns: columns });
    const command = grouped
      ? api.prepareGroupUnit(before, { kind: group.KIND, operationId: 'edit', action: 'cell-edit', rowId: 1, key: 'cx_design', value: 'new' })
      : api.prepareFieldCommand(before, { kind: delta.UNIT, operationId: 'edit', rowId: 4, writes: [{ key: 'cx_design', after: { present: true, value: 'new' } }] });
    const after = grouped ? api.applyGroupUnit(before, command) : api.applyFieldCommand(before, command);
    assert.equal(legacy.edit(grouped ? 1 : 4, 'cx_design', 'new'), true);
    assert.deepEqual(after.rows, clone(legacy.context.kolRows));
    assert.deepEqual(clone(legacy.context.kolUndoStack), [rows]);
    assert.deepEqual(after.history.undo, []);
    assert.strictEqual(after.rows[grouped ? 3 : 0], before.rows[grouped ? 3 : 0]);
  });
}
test('standalone browser scripts expose portable APIs without CommonJS or UI/storage/network access', () => {
  const context = vm.createContext({ TextEncoder });
  for (const name of ['collection-delta-commands.js', 'collection-group-delta.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public', name), 'utf8'), context);
  }
  assert.equal(typeof context.BLCollectionDeltaCommands.prepareFieldCommand, 'function');
  assert.equal(typeof context.BLCollectionGroupDelta.createGroupCommandApi, 'function');
  const result = vm.runInContext(`(() => {
    const api = BLCollectionDeltaCommands;
    const state = api.createState({ownerId:'demo',clientGeneration:1,rows:[{id:1,quantity:'1'}]});
    const command = api.prepareFieldCommand(state,{kind:api.UNIT,operationId:'browser',rowId:1,writes:[{key:'quantity',after:{present:true,value:'2'}}]});
    const applied = api.applyFieldCommand(state,command);
    return api.materializeLegacyRequest(applied,['browser'],{requestId:'capture'}).payload.upserts[0].quantity;
  })()`, context);
  assert.equal(result, '2');
});
