'use strict';

// UNRUN: root acceptance pipeline owns execution/performance lock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { KIND, createGroupCommandApi } = require('./collection-group-command.cjs');
const { groups, appMutation, exportedMutation } = require('./reference-harness.cjs');
const api = createGroupCommandApi(groups), field = 'cx_design';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const error = code => err => err.code === code;
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function rowsFixture() {
  const common = { plmId: 'PLM-ONE', modelKod: 'Model one', inStoreMonth: '2027-01', modelGroupIdentity: 'persisted-authoritative-identity' };
  const row = (id, group, role) => ({ ...common, id, _rev: id + 1, modelGroupId: group, modelGroupRole: role, variantId: 'variant_' + id, modelSharedValues: {}, variantOverrides: {}, unknown: { id, nested: ['keep'] }, cx_design: 'raw-' + id });
  const rows = [row(1, 'mg_one', 'parent'), row(2, 'mg_one', 'variant'), row(3, 'mg_one', 'variant'), row(4, 'mg_detached', 'single'), row(5, 'mg_other', 'parent'), row(6, 'mg_other', 'variant')];
  rows[0].modelSharedValues = { cx_design: 'shared-old', unknownShared: { keep: true } };
  rows[1].variantOverrides = { unknownOverride: { keep: true } };
  rows[2].variantOverrides = { cx_design: false, unknownOverride: { keep: true } };
  return rows;
}
function state(rows = rowsFixture(), overrides = {}) {
  return api.createState({ ownerId: 'buyer-a', clientGeneration: 7, rows, customColumns: [{ k: field, label: 'Synthetic model field', custom: true }], ...overrides });
}
function unit(before, action, targetRowId = 1, value = 'new-shared', overrides = {}) {
  return api.prepareGroupUnit(before, { kind: KIND, operationId: 'group-' + action, action, rowId: targetRowId, key: field, value, ...overrides });
}
function compare(before, action, target, value, reference = 'export') {
  const command = unit(before, action, target, value), after = api.applyGroupUnit(before, command);
  const expected = reference === 'app' ? appMutation(before.rows, before.customColumns, action, target, field, value).rows : exportedMutation(before.rows, action, target, field, value);
  assert.deepEqual(after.rows, expected);
  return { command, after };
}

test('stable source certificate matches actual normalizer data; legacy repairs require explicit fallback', () => {
  const rows = rowsFixture(); assert.deepEqual(groups.normalizeRows(rows).rows, rows); state(rows);
  for (const change of [
    row => { delete row.modelGroupId; }, row => { delete row.variantId; }, row => { row.variantId = ' padded '; },
    row => { delete row.modelSharedValues; }, row => { row.variantOverrides = null; }, row => { delete row.modelGroupIdentity; },
    row => { row.modelGroupRole = 'variant'; },
  ]) {
    const legacy = rowsFixture(); change(legacy[0]);
    assert.notDeepEqual(groups.normalizeRows(legacy).rows, legacy);
    assert.throws(() => state(legacy), error('NORMALIZATION_REQUIRED'));
  }
  assert.throws(() => state([{ ...rows[0] }, { ...rows[1], id: '1' }]), error('INVALID_ROW_ID'));
});

test('actual app single-cell shared edit matches group unit and keeps explicit false override/raw stale value', () => {
  const before = state(), { after, command } = compare(before, 'cell-edit', 1, 'new-parent', 'app');
  assert.equal(after.rows[0].modelSharedValues[field], 'new-parent'); assert.equal(after.rows[0][field], 'new-parent'); assert.equal(after.rows[1][field], 'new-parent');
  assert.equal(after.rows[2].variantOverrides[field], false); assert.equal(after.rows[2][field], 'raw-3');
  assert.deepEqual(command.patches.map(row => row.rowId), ['1', '2']);
  assert.strictEqual(after.rows[2], before.rows[2]); assert.strictEqual(after.rows[3], before.rows[3]);
});

test('affected closure rejects pending normalization on unrelated rows too', () => {
  const rows = rowsFixture(); rows[3].variantId = '  ';
  const actual = exportedMutation(rows, 'shared-value', 1, field, 'new');
  assert.notEqual(actual[3].variantId, rows[3].variantId);
  assert.throws(() => state(rows), error('NORMALIZATION_REQUIRED'));
});

test('direct actual shared export parity preserves null/zero/false/blank and owns mutable field values', () => {
  for (const value of [null, 0, false, '', { parts: [{ enabled: false }] }]) {
    const before = state(), { after } = compare(before, 'shared-value', 1, value);
    assert.deepEqual(after.rows[0].modelSharedValues[field], value); assert.deepEqual(after.rows[1][field], value);
    assert.strictEqual(after.rows[2], before.rows[2]);
    if (value && typeof value === 'object') {
      assert.notStrictEqual(after.rows[0].modelSharedValues[field], value);
      assert.notStrictEqual(after.rows[0][field], after.rows[1][field]);
      assert.notStrictEqual(after.rows[0][field], after.rows[0].modelSharedValues[field]);
    }
  }
});

test('actual app override edit updates override plus materialized row only', () => {
  const before = state(), { after, command } = compare(before, 'cell-edit', 3, 'variant-edit', 'app');
  assert.equal(after.rows[2].variantOverrides[field], 'variant-edit'); assert.equal(after.rows[2][field], 'variant-edit');
  assert.deepEqual(command.patches.map(row => row.rowId), ['3']);
  assert.strictEqual(after.rows[0], before.rows[0]); assert.strictEqual(after.rows[1], before.rows[1]);
  assert.strictEqual(after.rows[2].modelSharedValues, before.rows[2].modelSharedValues);
  assert.strictEqual(after.rows[2].variantOverrides.unknownOverride, before.rows[2].variantOverrides.unknownOverride);
});

test('actual setVariantOverride parity preserves explicit falsy values and materialized cells', () => {
  for (const value of [null, 0, false, '']) {
    const before = state(), { after } = compare(before, 'set-override', 2, value);
    assert.equal(own(after.rows[1].variantOverrides, field), true); assert.equal(after.rows[1].variantOverrides[field], value); assert.equal(after.rows[1][field], value);
    assert.strictEqual(after.rows[0], before.rows[0]); assert.strictEqual(after.rows[2], before.rows[2]);
  }
});

test('actual context-menu make-colour-specific creates exact inherited override presence', () => {
  const before = state(), { after } = compare(before, 'make-override', 2, undefined, 'app');
  assert.equal(own(before.rows[1].variantOverrides, field), false);
  assert.equal(own(after.rows[1].variantOverrides, field), true);
  assert.equal(after.rows[1].variantOverrides[field], 'shared-old'); assert.equal(after.rows[1][field], 'shared-old');
  assert.strictEqual(after.rows[0], before.rows[0]);
});

test('actual context-menu clear override parity restores model value; inverse restores false plus original stale raw', () => {
  const before = state(), { after, command } = compare(before, 'clear-override', 3, undefined, 'app');
  assert.equal(own(after.rows[2].variantOverrides, field), false); assert.equal(after.rows[2][field], 'shared-old');
  const inverse = api.prepareInverseUnit(after, command, 'undo-clear'), undone = api.applyGroupUnit(after, inverse);
  assert.deepEqual(undone.rows, before.rows); assert.equal(undone.rows[2].variantOverrides[field], false); assert.equal(undone.rows[2][field], 'raw-3');
  assert.strictEqual(undone.rows[0], after.rows[0]); assert.strictEqual(undone.rows[2].unknown, before.rows[2].unknown);
});

test('clear override matches actual explicit null/zero/false/blank shared fallback', () => {
  for (const value of [null, 0, false, '']) {
    const rows = rowsFixture(); rows[0].modelSharedValues[field] = value;
    const before = state(rows), { after, command } = compare(before, 'clear-override', 3, undefined);
    assert.equal(own(after.rows[2], field), true); assert.equal(after.rows[2][field], value);
    assert.deepEqual(api.applyGroupUnit(after, api.prepareInverseUnit(after, command, 'undo-fallback')).rows, before.rows);
  }
});

test('clear override preserves actual missing-raw/undefined fallback and original raw when parent raw is blank', () => {
  for (const rawPresent of [false, true]) {
    const rows = rowsFixture(); delete rows[0].modelSharedValues[field]; rows[0][field] = '';
    if (rawPresent) rows[2][field] = 'keep-old-raw'; else delete rows[2][field];
    const before = state(rows), { after, command } = compare(before, 'clear-override', 3, undefined);
    assert.equal(own(after.rows[2], field), rawPresent);
    if (rawPresent) assert.equal(after.rows[2][field], 'keep-old-raw');
    assert.deepEqual(api.applyGroupUnit(after, api.prepareInverseUnit(after, command, 'undo-absence')).rows, before.rows);
  }
});

test('same-model peers inside group follow inheritance; separately persisted/detached same-PLM groups stay unchanged', () => {
  const before = state(), { after } = compare(before, 'shared-value', 1, 'within-group');
  assert.equal(after.rows[1][field], 'within-group');
  assert.equal(groups.identityOf(before.rows[0]), groups.identityOf(before.rows[3]));
  assert.equal(groups.identityOf(before.rows[0]), groups.identityOf(before.rows[4]));
  for (const index of [2, 3, 4, 5]) { assert.strictEqual(after.rows[index], before.rows[index]); assert.strictEqual(after.rows[index].unknown, before.rows[index].unknown); }
});

test('actual whole-row clones and normalizer copies are replaced only by scoped COW, with value parity', () => {
  const before = state(); freeze(before.rows); freeze(before.customColumns);
  const actual = exportedMutation(before.rows, 'shared-value', 1, field, 'scoped'), command = unit(before, 'shared-value', 1, 'scoped'), after = api.applyGroupUnit(before, command);
  assert.deepEqual(after.rows, actual);
  assert.notStrictEqual(actual[3], before.rows[3]); assert.notStrictEqual(actual[3].unknown, before.rows[3].unknown);
  assert.strictEqual(after.rows[3], before.rows[3]); assert.strictEqual(after.rows[3].unknown, before.rows[3].unknown);
  assert.notStrictEqual(after.rows[0], before.rows[0]); assert.notStrictEqual(after.rows[0].modelSharedValues, before.rows[0].modelSharedValues);
  assert.strictEqual(after.rows[0].modelSharedValues.unknownShared, before.rows[0].modelSharedValues.unknownShared);
  assert.strictEqual(after.rows[0].variantOverrides, before.rows[0].variantOverrides);
  assert.strictEqual(after.rows[1].modelSharedValues, before.rows[1].modelSharedValues); assert.strictEqual(after.rows[1].variantOverrides, before.rows[1].variantOverrides);
});

test('shared edit plus inverse restores exact raw/shared presence without replacing unknown nested fields', () => {
  const rows = rowsFixture(); delete rows[0].modelSharedValues[field]; delete rows[1][field];
  const before = state(rows), { after, command } = compare(before, 'shared-value', 1, 'temporary');
  const inverse = api.prepareInverseUnit(after, command, 'undo-shared'), undone = api.applyGroupUnit(after, inverse);
  assert.deepEqual(undone.rows, before.rows); assert.equal(own(undone.rows[0].modelSharedValues, field), false); assert.equal(own(undone.rows[1], field), false);
  for (const index of [0, 1]) assert.strictEqual(undone.rows[index].unknown, before.rows[index].unknown);
  for (const index of [2, 3, 4, 5]) assert.strictEqual(undone.rows[index], before.rows[index]);
});

test('stale group add/remove/reorder/role changes reject the entire prepared unit', () => {
  const before = state(), command = unit(before, 'shared-value');
  const variants = [];
  const added = clone(before.rows); added.push({ ...clone(added[1]), id: 7, variantId: 'variant_7' }); variants.push(added);
  variants.push(clone(before.rows).filter(row => row.id !== 2));
  const reordered = clone(before.rows); [reordered[0], reordered[1]] = [reordered[1], reordered[0]]; variants.push(reordered);
  const roles = clone(before.rows); roles[0].modelGroupRole = 'variant'; roles[1].modelGroupRole = 'parent'; variants.push(roles);
  for (const rows of variants) { const current = state(rows); assert.throws(() => api.applyGroupUnit(current, command), error('MEMBERSHIP_CHANGED')); assert.deepEqual(current.rows, rows); }
});

test('owner/generation/schema/row revision and same-field conflict reject before effects', () => {
  const before = state(), command = unit(before, 'shared-value');
  assert.throws(() => api.applyGroupUnit(state(before.rows, { ownerId: 'buyer-b' }), command), error('OWNER_CHANGED'));
  assert.throws(() => api.applyGroupUnit(state(before.rows, { clientGeneration: 8 }), command), error('GENERATION_CHANGED'));
  assert.throws(() => api.applyGroupUnit(state(before.rows, { customColumns: [{ ...before.customColumns[0], label: 'different' }] }), command), error('SCHEMA_CHANGED'));
  const rowRev = clone(before.rows); rowRev[2]._rev += 1; // conservative dependency fence even for preserved override peer
  assert.throws(() => api.applyGroupUnit(state(rowRev), command), error('ROW_BASE_CHANGED'));
  const fieldChange = clone(before.rows); fieldChange[1][field] = 'new-local';
  assert.throws(() => api.applyGroupUnit(state(fieldChange), command), error('GROUP_FIELD_CONFLICT'));
  const overrideChange = clone(before.rows); overrideChange[1].variantOverrides[field] = null;
  assert.throws(() => api.applyGroupUnit(state(overrideChange), command), error('GROUP_FIELD_CONFLICT'));
});

test('legacy absent/explicit-zero row bases stay zero without changing server-owned revision fields', () => {
  for (const explicit of [false, true]) {
    const rows = rowsFixture(); rows.forEach(row => { if (explicit) row._rev = 0; else delete row._rev; });
    const before = state(rows), command = unit(before, 'shared-value'), after = api.applyGroupUnit(before, command);
    assert.deepEqual(command.rowBases.map(row => row.revision), [0, 0, 0]);
    for (const row of after.rows) { assert.equal(own(row, '_rev'), explicit); if (explicit) assert.equal(row._rev, 0); }
    const inverse = api.prepareInverseUnit(after, command, 'undo-legacy');
    assert.deepEqual(api.applyGroupUnit(after, inverse).rows, before.rows);
  }
});

test('inverse uses explicit fresh row bases and preserves unrelated accepted remote fields/map keys', () => {
  const before = state(), { after, command } = compare(before, 'shared-value', 1, 'forward');
  const rows = after.rows.map(row => row.id === 1 ? { ...row, _rev: row._rev + 1, external: { approved: true }, modelSharedValues: { ...row.modelSharedValues, remoteUnknown: { keep: true } } } : row);
  const remote = state(rows), inverse = api.prepareInverseUnit(remote, command, 'undo-remote'), undone = api.applyGroupUnit(remote, inverse);
  assert.equal(inverse.rowBases[0].revision, rows[0]._rev); assert.equal(undone.rows[0]._rev, rows[0]._rev);
  assert.strictEqual(undone.rows[0].external, rows[0].external); assert.strictEqual(undone.rows[0].modelSharedValues.remoteUnknown, rows[0].modelSharedValues.remoteUnknown);
  assert.equal(undone.rows[0][field], before.rows[0][field]); assert.equal(undone.rows[1][field], before.rows[1][field]);
  const conflict = rows.map(row => row.id === 1 ? { ...row, modelSharedValues: { ...row.modelSharedValues, [field]: 'remote-same-field' } } : row);
  assert.throws(() => api.prepareInverseUnit(state(conflict), command, 'unsafe-undo'), error('GROUP_FIELD_CONFLICT'));
});

test('actual linked-variant editor guard and no-op string comparison remain explicit', () => {
  const before = state(), linked = appMutation(before.rows, before.customColumns, 'cell-edit', 2, field, 'must-not-write');
  assert.equal(linked.result, false); assert.deepEqual(linked.rows, before.rows);
  assert.throws(() => unit(before, 'cell-edit', 2, 'must-not-write'), error('LINKED_VARIANT'));
  const noOp = appMutation(before.rows, before.customColumns, 'cell-edit', 3, field, 'false');
  assert.equal(noOp.result, false); assert.deepEqual(noOp.rows, before.rows);
  assert.throws(() => unit(before, 'cell-edit', 3, 'false'), error('NO_CHANGES'));
  assert.throws(() => unit(before, 'cell-edit', 1, false), error('CELL_EDITOR_STRING_REQUIRED'));
});

test('parent with explicit override follows actual app override route instead of overwriting shared model state', () => {
  const rows = rowsFixture(); rows[0].variantOverrides[field] = null;
  const before = state(rows), { after, command } = compare(before, 'cell-edit', 1, 'parent-override', 'app');
  assert.equal(command.route, 'set-override'); assert.equal(after.rows[0].modelSharedValues[field], 'shared-old');
  assert.equal(after.rows[0].variantOverrides[field], 'parent-override'); assert.strictEqual(after.rows[1], before.rows[1]);
});

test('rich note/pricing/period/checklist/structure/identity operations have no generic scalar fallback', () => {
  const before = state();
  for (const key of ['not', 'notHtml', 'pricing', 'pricing:Maker', 'confirmedManufacturer', 'targetPrice', 'fob', 'inStoreMonth', 'inStore', 'retail', 'modelSharedValues', 'variantOverrides', 'plmId', 'quantity', '_rev', 'cx_unknown']) {
    assert.throws(() => unit(before, 'shared-value', 1, 'blocked', { key }), error('TYPED_COUPLED_UNIT_REQUIRED'));
  }
  for (const action of ['rich-note', 'pricing-unit', 'period-unit', 'merge', 'split', 'detach', 'row-delete', 'reorder']) {
    assert.throws(() => unit(before, action), error('TYPED_COUPLED_UNIT_REQUIRED'));
  }
  assert.throws(() => unit(state(before.rows, { customColumns: [{ ...before.customColumns[0], checklist: true }] }), 'shared-value'), error('TYPED_COUPLED_UNIT_REQUIRED'));
  for (const special of [{ dataType: 'money' }, { dataType: 'date' }, { formulaReadonly: true }, { inStorePeriod: true }]) {
    assert.throws(() => unit(state(before.rows, { customColumns: [{ ...before.customColumns[0], ...special }] }), 'cell-edit', 1, '1'), error('TYPED_COUPLED_UNIT_REQUIRED'));
  }
});

test('captured units own changed JSON, preserve unknown keys and never mutate borrowed rows', () => {
  const rows = rowsFixture(), special = JSON.parse('{"__proto__":{"data":"preserved"},"constructor":"unknown persisted key"}');
  rows[0] = { ...rows[0], ...special }; const before = state(rows); freeze(rows); freeze(before.customColumns);
  const value = { labels: ['original'] }, command = unit(before, 'shared-value', 1, value); value.labels.push('caller changed');
  assert.deepEqual(command.patches[0].slots[0].after.value, { labels: ['original'] });
  assert.throws(() => { command.patches.push({}); }, TypeError);
  const after = api.applyGroupUnit(before, command);
  assert.equal(own(after.rows[0], '__proto__'), true); assert.strictEqual(after.rows[0].__proto__, before.rows[0].__proto__); assert.equal({}.data, undefined);
  assert.equal(after.rows[0].constructor, 'unknown persisted key'); assert.equal(before.rows[0][field], 'raw-1');
  assert.notStrictEqual(after.rows[0][field], command.patches[0].slots.find(item => item.location === 'row').after.value);
});

test('malformed duplicate patch rows and unsupported slot shapes reject without partial changes', () => {
  const before = state(), prepared = unit(before, 'shared-value');
  const duplicate = clone(prepared); duplicate.patches.push(clone(duplicate.patches[0]));
  assert.throws(() => api.applyGroupUnit(before, duplicate), error('INVALID_GROUP_UNIT'));
  const malformed = clone(prepared); malformed.patches[0].slots[0].after = { present: false, value: null };
  assert.throws(() => api.applyGroupUnit(before, malformed), error('INVALID_GROUP_UNIT'));
  assert.equal(before.rows[0].modelSharedValues[field], 'shared-old'); assert.equal(before.rows[1][field], 'raw-2');
});
