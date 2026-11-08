(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./collection-delta-commands.js') : root.BLCollectionDeltaCommands);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionGroupDelta = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (delta) {
'use strict';

// Typed Collection group units. Requires the actual read-only group resolver.
const NAMESPACE = 'collection-workspaces';
const KIND = 'collection.group-field-semantic-unit';
const LOCATIONS = ['row', 'shared', 'override'];
const METADATA = ['id', 'modelGroupId', 'modelGroupRole', 'modelGroupIdentity', 'modelGroupDetached', 'variantId', 'plmId', 'modelKod', 'inStoreMonth'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const text = value => String(value == null ? '' : value).trim();
const rowId = row => row?.id == null || row.id === '' ? '' : String(row.id);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function identifier(value) { if (typeof value !== 'string' || !value || value !== value.trim()) fail('INVALID_ID'); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REVISION'); return value; }
function rowRevision(row) { return revision(Math.max(0, Number(row._rev) || 0)); }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function validateJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if ((!Array.isArray(value) && !plain(value)) || seen.has(value)) fail('NON_NORMALIZED_JSON');
  if (Object.getOwnPropertySymbols(value).length) fail('NON_NORMALIZED_JSON');
  const keys = Object.keys(value);
  const names = Object.getOwnPropertyNames(value).filter(key => !Array.isArray(value) || key !== 'length');
  if (names.length !== keys.length) fail('NON_NORMALIZED_JSON');
  if (Array.isArray(value) && (keys.length !== value.length || !keys.every((key, index) => key === String(index)))) fail('NON_NORMALIZED_JSON');
  seen.add(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) fail('NON_NORMALIZED_JSON');
    validateJson(descriptor.value, seen);
  }
  seen.delete(value);
}
function copy(value) {
  validateJson(value);
  if (value === null || typeof value !== 'object') return value;
  const next = Array.isArray(value) ? [] : {};
  for (const key of Object.keys(value)) Object.defineProperty(next, key, { value: copy(value[key]), writable: true, enumerable: true, configurable: true });
  return next;
}
function freezeOwned(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freezeOwned); Object.freeze(value); } return value; }
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}
function slot(value, key) { return own(value, key) ? { present: true, value: copy(value[key]) } : { present: false }; }
function sameSlot(a, b) { return a.present === b.present && (!a.present || equal(a.value, b.value)); }
function validateSlot(value) {
  if (!plain(value) || !own(value, 'present') || typeof value.present !== 'boolean'
    || Object.keys(value).some(key => key !== 'present' && key !== 'value')
    || (value.present ? !own(value, 'value') : own(value, 'value'))) fail('INVALID_GROUP_UNIT');
  if (value.present) validateJson(value.value);
}
const container = (row, location) => location === 'row' ? row : row[location === 'shared' ? 'modelSharedValues' : 'variantOverrides'];
const metadata = row => METADATA.map(key => ({ key, slot: slot(row, key) }));

function createGroupCommandApi(referenceGroups) {
  for (const name of ['effectiveValue', 'fieldMetadata']) if (typeof referenceGroups?.[name] !== 'function') fail('REFERENCE_API_REQUIRED');
  const certified = new WeakSet();

  function createState({ ownerId, clientGeneration, rows, customColumns, view = 'single', canEdit = true, baselineRows = rows, workspaceRevision = 0, nextId = 1, historyLimits, pendingIntent }) {
    if (pendingIntent != null) fail('LEGACY_PENDING_REQUIRES_ADAPTER');
    identifier(ownerId); revision(clientGeneration);
    if (ownerId === '__multi__' || view !== 'single' || canEdit !== true) fail('EDITABLE_SINGLE_OWNER_REQUIRED');
    if (!Array.isArray(rows) || !Array.isArray(customColumns)) fail('INVALID_STATE');
    // Bir kez, source rebinding sırasında: clone/serialize değil, muhafazakâr doğrulama.
    validateJson(rows); validateJson(customColumns);
    const byId = new Map(), groups = new Map();
    for (const row of rows) {
      const id = rowId(row);
      if (!plain(row) || !id || byId.has(id)) fail('INVALID_ROW_ID');
      if (typeof row.modelGroupId !== 'string' || !text(row.modelGroupId) || row.modelGroupId !== text(row.modelGroupId)
        || typeof row.variantId !== 'string' || !text(row.variantId) || row.variantId !== text(row.variantId)
        || !['single', 'parent', 'variant'].includes(row.modelGroupRole)
        || !own(row, 'modelSharedValues') || !plain(row.modelSharedValues)
        || !own(row, 'variantOverrides') || !plain(row.variantOverrides)) fail('NORMALIZATION_REQUIRED');
      if (text(row.plmId) && text(row.modelKod) && text(row.inStoreMonth) && !row.modelGroupIdentity) fail('NORMALIZATION_REQUIRED');
      rowRevision(row); byId.set(id, row);
      if (!groups.has(row.modelGroupId)) groups.set(row.modelGroupId, []);
      groups.get(row.modelGroupId).push(id);
    }
    for (const ids of groups.values()) {
      if (ids.length > 1 && (ids.filter(id => byId.get(id).modelGroupRole === 'parent').length !== 1
        || ids.some(id => !['parent', 'variant'].includes(byId.get(id).modelGroupRole)))) fail('NORMALIZATION_REQUIRED');
    }
    const keys = customColumns.map(column => column.k);
    if (new Set(keys).size !== keys.length) fail('INVALID_SCHEMA');
    const state = { namespace: NAMESPACE, ownerId, clientGeneration, rows, byId, groups, customColumns, view, canEdit };
    const baselineState = baselineRows === rows ? state : createState({ ownerId, clientGeneration, rows: baselineRows, customColumns, view, canEdit });
    state.baseline = new Map(baselineState.byId);
    state.baselineGroups = baselineState.groups;
    state.workspaceRevision = revision(workspaceRevision); state.nextId = revision(nextId);
    state.operations = new Map(); state.history = delta.createHistory(historyLimits);
    certified.add(state); return state;
  }
  function assertState(state) {
    if (!certified.has(state)) fail('CERTIFIED_SOURCE_REQUIRED');
    if (state.namespace !== NAMESPACE || state.view !== 'single' || state.canEdit !== true || state.ownerId === '__multi__') fail('EDITABLE_SINGLE_OWNER_REQUIRED');
  }
  function schema(state, key) {
    identifier(key);
    const column = state.customColumns.find(item => item.k === key), info = referenceGroups.fieldMetadata(key);
    if (!/^cx_[A-Za-z0-9_]+$/.test(key) || !column || column.custom !== true || column.checklist === true || info.inheritance !== 'model' || info.calculated || !info.editable) fail('TYPED_COUPLED_UNIT_REQUIRED');
    if (!['', 'text'].includes(column.dataType || '') || ['date', 'qty', 'money', 'percent', 'hologram', 'inStorePeriod', 'ruleReadonly', 'formulaReadonly', 'exToRetail', 'richText', 'html', 'image'].some(flag => column[flag])) fail('TYPED_COUPLED_UNIT_REQUIRED');
    return copy(column);
  }
  function scope(state, id) {
    const target = state.byId.get(String(id));
    if (!target) fail('ROW_MISSING');
    const ids = state.groups.get(target.modelGroupId);
    if (!ids || ids.length < 2) fail('GROUP_REQUIRED');
    return { target, ids, groupId: target.modelGroupId, parent: ids.map(key => state.byId.get(key)).find(row => row.modelGroupRole === 'parent') };
  }
  function values(state, ids, key) {
    return ids.map(id => ({ rowId: id, slots: LOCATIONS.map(location => ({ location, slot: slot(container(state.byId.get(id), location), key) })) }));
  }
  function closure(state, ids, groupId) { return { groupId, members: ids.map(id => ({ rowId: id, metadata: metadata(state.byId.get(id)) })) }; }
  function bases(state, ids) { return ids.map(id => ({ rowId: id, revision: rowRevision(state.byId.get(id)) })); }
  function project(before, patches) {
    return before.map(row => ({ rowId: row.rowId, slots: row.slots.map(entry => {
      const patch = patches.find(item => item.rowId === row.rowId)?.slots.find(item => item.location === entry.location);
      return { location: entry.location, slot: patch ? patch.after : entry.slot };
    }) }));
  }
  function prepareGroupUnit(state, spec) {
    assertState(state);
    if (spec.kind !== KIND || !['cell-edit', 'shared-value', 'set-override', 'make-override', 'clear-override'].includes(spec.action)) fail('TYPED_COUPLED_UNIT_REQUIRED');
    identifier(spec.operationId);
    const definition = schema(state, spec.key), group = scope(state, spec.rowId), target = group.target, key = spec.key;
    const before = values(state, group.ids, key), pending = new Map();
    function set(id, location, after) {
      const prior = slot(container(state.byId.get(id), location), key);
      if (sameSlot(prior, after)) return;
      if (!pending.has(id)) pending.set(id, []);
      pending.get(id).push({ location, before: prior, after });
    }
    const present = value => ({ present: true, value: copy(value) });
    let route = spec.action, value;
    if (route === 'cell-edit') {
      if (typeof spec.value !== 'string') fail('CELL_EDITOR_STRING_REQUIRED');
      if (target.modelGroupRole === 'variant' && !own(target.variantOverrides, key)) fail('LINKED_VARIANT');
      const effective = referenceGroups.effectiveValue(target, key, group.ids.map(id => state.byId.get(id)));
      if (String(effective == null ? '' : effective) === spec.value) fail('NO_CHANGES');
      route = own(target.variantOverrides, key) ? 'set-override' : target === group.parent ? 'shared-value' : 'unsupported';
      value = copy(spec.value);
    } else if (route === 'make-override') {
      if (target.modelGroupRole !== 'variant') fail('VARIANT_REQUIRED');
      value = copy(referenceGroups.effectiveValue(target, key, group.ids.map(id => state.byId.get(id))));
      route = 'set-override';
    } else if (route !== 'clear-override') value = copy(spec.value);
    if (route === 'shared-value') {
      if (target !== group.parent) fail('PARENT_REQUIRED');
      set(rowId(target), 'shared', present(value));
      for (const id of group.ids) if (!own(state.byId.get(id).variantOverrides, key)) set(id, 'row', present(value));
    } else if (route === 'set-override') {
      if (spec.action === 'set-override' && target.modelGroupRole !== 'variant') fail('VARIANT_REQUIRED');
      set(rowId(target), 'override', present(value)); set(rowId(target), 'row', present(value));
    } else if (route === 'clear-override') {
      if (target.modelGroupRole !== 'variant') fail('VARIANT_REQUIRED');
      if (!own(target.variantOverrides, key)) fail('NO_OVERRIDE');
      set(rowId(target), 'override', { present: false });
      // Mevcut clearVariantOverride fallback'i: raw alanı undefined ise hiç yazma.
      const afterRemoval = { ...target, variantOverrides: { ...target.variantOverrides } }; delete afterRemoval.variantOverrides[key];
      const inherited = referenceGroups.effectiveValue(afterRemoval, key, group.ids.map(id => id === rowId(target) ? afterRemoval : state.byId.get(id)));
      if (inherited !== undefined) set(rowId(target), 'row', present(inherited));
    } else fail('TYPED_COUPLED_UNIT_REQUIRED');
    const patches = group.ids.filter(id => pending.has(id)).map(id => ({ rowId: id, slots: pending.get(id) }));
    if (!patches.length) fail('NO_CHANGES');
    return freezeOwned({ namespace: NAMESPACE, version: 1, kind: KIND, operationId: spec.operationId, ownerId: state.ownerId, clientGeneration: state.clientGeneration, action: spec.action, route, targetRowId: rowId(target), field: key, schema: definition, closure: closure(state, group.ids, group.groupId), rowBases: bases(state, group.ids), before, after: project(before, patches), patches });
  }
  function assertUnit(state, unit, expected, checkBases) {
    assertState(state);
    if (unit.namespace !== NAMESPACE || unit.version !== 1 || unit.kind !== KIND) fail('INVALID_GROUP_UNIT');
    identifier(unit.operationId);
    if (unit.ownerId !== state.ownerId) fail('OWNER_CHANGED');
    if (unit.clientGeneration !== state.clientGeneration) fail('GENERATION_CHANGED');
    const definition = schema(state, unit.field), group = scope(state, unit.targetRowId);
    if (!equal(definition, unit.schema)) fail('SCHEMA_CHANGED');
    if (!equal(closure(state, group.ids, group.groupId), unit.closure)) fail('MEMBERSHIP_CHANGED');
    if (checkBases && !equal(bases(state, group.ids), unit.rowBases)) fail('ROW_BASE_CHANGED');
    if (!equal(values(state, group.ids, unit.field), expected)) fail('GROUP_FIELD_CONFLICT');
    if (!Array.isArray(unit.patches) || !unit.patches.length || new Set(unit.patches.map(row => row.rowId)).size !== unit.patches.length || !equal(project(unit.before, unit.patches), unit.after)) fail('INVALID_GROUP_UNIT');
    for (const row of unit.patches) {
      if (!group.ids.includes(row.rowId) || !row.slots.length || new Set(row.slots.map(item => item.location)).size !== row.slots.length) fail('INVALID_GROUP_UNIT');
      for (const patch of row.slots) {
        validateSlot(patch.before); validateSlot(patch.after);
        const before = unit.before.find(item => item.rowId === row.rowId)?.slots.find(item => item.location === patch.location)?.slot;
        if (!LOCATIONS.includes(patch.location) || !equal(before, patch.before)) fail('INVALID_GROUP_UNIT');
      }
    }
    return group;
  }
  function applyGroupUnit(state, unit) {
    assertBinding(state, unit);
    const prior = state.operations.get(unit.operationId);
    if (prior) { if (!equal(prior.command, unit)) fail('OPERATION_ID_REUSED'); return state; }
    delta.assertHistoryCommand(state, unit, acknowledgedInverse);
    assertUnit(state, unit, unit.before, true);
    assertContext(state, unit);
    const replacements = new Map();
    for (const patchRow of unit.patches) {
      const source = state.byId.get(patchRow.rowId), row = { ...source };
      for (const patch of patchRow.slots) {
        if (patch.location !== 'row') {
          const key = patch.location === 'shared' ? 'modelSharedValues' : 'variantOverrides';
          row[key] = { ...source[key] };
        }
        const destination = container(row, patch.location);
        if (patch.after.present) destination[unit.field] = copy(patch.after.value); else delete destination[unit.field];
      }
      replacements.set(patchRow.rowId, row);
    }
    const byId = new Map(state.byId); replacements.forEach((row, id) => byId.set(id, row));
    const operations = new Map(state.operations);
    operations.set(unit.operationId, { command: freezeOwned(copy(unit)), status: 'pending' });
    const next = { ...state, byId, operations, rows: state.rows.map(row => replacements.get(rowId(row)) || row) };
    certified.add(next); return next;
  }
  function prepareInverseUnit(state, forward, operationId) {
    assertUnit(state, forward, forward.after, false); identifier(operationId);
    if (operationId === forward.operationId) fail('NEW_OPERATION_ID_REQUIRED');
    if (state.operations.has(operationId)) fail('OPERATION_ID_REUSED');
    const ids = forward.closure.members.map(member => member.rowId);
    return freezeOwned({ ...copy(forward), operationId, action: 'inverse', route: 'inverse', inverseOf: forward.operationId, rowBases: bases(state, ids), before: copy(forward.after), after: copy(forward.before), patches: forward.patches.map(row => ({ rowId: row.rowId, slots: row.slots.map(patch => ({ location: patch.location, before: copy(patch.after), after: copy(patch.before) })) })) });
  }
  function assertBinding(state, unit) {
    assertState(state);
    if (unit.namespace !== NAMESPACE || unit.version !== 1 || unit.kind !== KIND) fail('INVALID_GROUP_UNIT');
    identifier(unit.operationId);
    if (unit.ownerId !== state.ownerId) fail('OWNER_CHANGED');
    if (unit.clientGeneration !== state.clientGeneration) fail('GENERATION_CHANGED');
  }
  function assertContext(state, unit) {
    assertBinding(state, unit);
    const group = scope(state, unit.targetRowId);
    if (!equal(schema(state, unit.field), unit.schema)) fail('SCHEMA_CHANGED');
    if (!equal(closure(state, group.ids, group.groupId), unit.closure)) fail('MEMBERSHIP_CHANGED');
    if (!equal(bases(state, group.ids), unit.rowBases)) fail('ROW_BASE_CHANGED');
    const acceptedIds = state.baselineGroups.get(group.groupId) || [];
    const acceptedClosure = { groupId: group.groupId, members: acceptedIds.map(id => ({ rowId: id, metadata: metadata(state.baseline.get(id)) })) };
    if (!equal(acceptedClosure, unit.closure)) fail('MEMBERSHIP_CHANGED');
    for (const base of unit.rowBases) {
      const accepted = state.baseline.get(base.rowId), local = state.byId.get(base.rowId);
      if (!accepted || rowRevision(accepted) !== base.revision) fail('ROW_BASE_CHANGED');
      if (!equal(metadata(accepted), metadata(local))) fail('MEMBERSHIP_CHANGED');
    }
  }
  function compose(state, unit, get, set) {
    const ids = unit.closure.members.map(member => member.rowId);
    const before = ids.map(id => ({ rowId: id, slots: LOCATIONS.map(location => ({ location, slot: slot(container(get(id), location), unit.field) })) }));
    if (!equal(before, unit.before)) fail('GROUP_FIELD_CONFLICT');
    for (const patchRow of unit.patches) {
      const source = get(patchRow.rowId), row = { ...source };
      for (const patch of patchRow.slots) {
        if (patch.location !== 'row') {
          const key = patch.location === 'shared' ? 'modelSharedValues' : 'variantOverrides';
          row[key] = { ...source[key] };
        }
        const destination = container(row, patch.location);
        if (patch.after.present) destination[unit.field] = copy(patch.after.value); else delete destination[unit.field];
      }
      set(patchRow.rowId, row);
    }
  }
  function adopt(state) {
    const next = { ...state, byId: new Map(state.rows.map(row => [rowId(row), row])) };
    certified.add(next); return next;
  }
  const isField = command => command.kind === delta.UNIT;
  const transport = delta.createLegacyTransport({
    assertState, requiresAtomic: unit => !isField(unit),
    assertBinding: (state, unit) => isField(unit) ? delta.fieldAdapter.assertBinding(state, unit) : assertBinding(state, unit),
    assertContext: (state, unit) => isField(unit) ? delta.fieldAdapter.assertContext(state, unit) : assertContext(state, unit),
    compose: (state, unit, get, set) => isField(unit) ? delta.fieldAdapter.compose(state, unit, get, set) : compose(state, unit, get, set),
    touched: unit => isField(unit) ? delta.fieldAdapter.touched(unit) : unit.patches.map(row => row.rowId),
    adopt,
  });
  function acknowledgedInverse(state, forward, operationId) {
    if (isField(forward)) return delta.prepareInverseCommand(state, forward, operationId);
    const entry = state.operations.get(forward.operationId);
    if (!entry || entry.status !== 'acknowledged' || !equal(entry.command, forward)) fail('PRIMARY_ACK_REQUIRED');
    return prepareInverseUnit(state, forward, operationId);
  }
  return {
    createState, prepareGroupUnit, applyGroupUnit,
    prepareFieldCommand(state, spec) { assertState(state); return delta.prepareFieldCommand(state, spec); },
    applyCommand(state, command) {
      assertState(state);
      if (!isField(command)) return applyGroupUnit(state, command);
      const next = delta.applyFieldCommand(state, command);
      return next === state ? state : adopt(next);
    },
    // Low-level inverse preparation retains group22's pure applicability API.
    // Only prepareUndo/Redo + primary ACK move the history stacks.
    prepareInverseUnit, ...transport,
    prepareUndo: (state, id) => delta.prepareHistoryCommand(state, id, 'undo', acknowledgedInverse),
    prepareRedo: (state, id) => delta.prepareHistoryCommand(state, id, 'redo', acknowledgedInverse),
  };
}

return { NAMESPACE, KIND, createGroupCommandApi };
});
