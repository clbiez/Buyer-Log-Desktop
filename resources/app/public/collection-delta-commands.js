(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionDeltaCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

// Pure Collection commands. No DOM, storage, network or activation side effects.
const NAMESPACE = 'collection-workspaces';
const UNIT = 'independent-row-fields';
const GROUP_KEYS = ['modelGroupId', 'modelGroupRole', 'modelGroupIdentity', 'variantId', 'modelGroupDetached', 'modelSharedValues', 'variantOverrides'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const rowKey = row => row?.id == null || row.id === '' ? '' : String(row.id);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function requireId(value) { if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail('INVALID_ID'); return value; }
function requireRevision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REVISION'); return value; }
// Legacy satırlar için mevcut sunucudaki rowRev ile aynı 0 normalizasyonu.
function rowRevision(row) { return requireRevision(Math.max(0, Number(row?._rev) || 0)); }

function copyJson(value, seen = new Set(), validateOnly = false) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('INVALID_JSON_VALUE');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('INVALID_JSON_VALUE');
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_JSON_VALUE');
  if (Object.getOwnPropertyNames(value).filter(key => !Array.isArray(value) || key !== 'length').length !== Object.keys(value).length) fail('INVALID_JSON_VALUE');
  seen.add(value);
  const result = validateOnly ? null : Array.isArray(value) ? [] : {};
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Object.keys(value).every((key, index) => key === String(index)))) fail('INVALID_JSON_VALUE');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) fail('INVALID_JSON_VALUE');
    // __proto__ gibi mevcut bilinmeyen JSON anahtarları da veri olarak kalır.
    const child = copyJson(descriptor.value, seen, validateOnly);
    if (!validateOnly) Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true });
  }
  seen.delete(value);
  return validateOnly ? value : result;
}
function freezeOwned(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeOwned); Object.freeze(value); }
  return value;
}
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a), other = Object.keys(b);
  return keys.length === other.length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}
function copySlot(slot) {
  if (!slot || !own(slot, 'present') || typeof slot.present !== 'boolean' || (slot.present ? !own(slot, 'value') : own(slot, 'value'))) fail('INVALID_SLOT');
  return slot.present ? { present: true, value: copyJson(slot.value) } : { present: false };
}
function readSlot(row, key) { return own(row, key) ? { present: true, value: copyJson(row[key]) } : { present: false }; }
function sameSlot(a, b) { return a.present === b.present && (!a.present || equal(a.value, b.value)); }
function writeSlot(row, key, slot) { if (slot.present) Object.defineProperty(row, key, { value: copyJson(slot.value), enumerable: true, writable: true, configurable: true }); else delete row[key]; }
function groupGuard(row) { return GROUP_KEYS.map(key => ({ key, slot: readSlot(row, key) })); }
function schemaGuard(state, keys) {
  return keys.map(key => {
    if (key === 'quantity') return { key, definition: null };
    const column = state.customColumns.find(item => item.k === key);
    if (!/^cx_[A-Za-z0-9_]+$/.test(key) || !column || column.custom !== true || column.checklist === true || !['', 'text'].includes(column.dataType || '') || ['date', 'qty', 'money', 'percent', 'hologram', 'inStorePeriod', 'ruleReadonly', 'formulaReadonly', 'exToRetail', 'richText', 'html', 'image'].some(flag => column[flag])) fail('FIELD_NOT_APPROVED');
    return { key, definition: copyJson(column) };
  });
}
function assertState(state) {
  if (state.namespace !== NAMESPACE || state.view !== 'single' || state.canEdit !== true || state.ownerId === '__multi__') fail('EDITABLE_SINGLE_OWNER_REQUIRED');
  requireId(state.ownerId); requireRevision(state.clientGeneration);
  if (!Array.isArray(state.rows) || !Array.isArray(state.customColumns) || !(state.baseline instanceof Map) || !(state.operations instanceof Map)) fail('INVALID_STATE');
}
function assertBinding(state, command) {
  assertState(state);
  if (command.namespace !== NAMESPACE || command.version !== 1 || command.kind !== UNIT) fail('UNSUPPORTED_SEMANTIC_UNIT');
  if (command.ownerId !== state.ownerId) fail('OWNER_CHANGED');
  if (command.clientGeneration !== state.clientGeneration) fail('GENERATION_CHANGED');
  requireId(command.operationId); requireId(command.rowId); requireRevision(command.baseRowRevision);
  if (!Array.isArray(command.slots) || !command.slots.length || new Set(command.slots.map(slot => slot.key)).size !== command.slots.length) fail('INVALID_COMMAND');
  for (const slot of command.slots) { requireId(slot.key); copySlot(slot.before); copySlot(slot.after); }
}
function currentRow(state, id) { const row = state.rows.find(item => rowKey(item) === id); if (!row) fail('ROW_MISSING'); return row; }
function assertIndependent(state, row, rows = state.rows) {
  const id = row.modelGroupId;
  if (row.modelGroupRole && row.modelGroupRole !== 'single') fail('TYPED_GROUP_UNIT_REQUIRED');
  if (id) {
    let members = 0;
    for (const item of rows) if (String(item.modelGroupId || '') === String(id) && ++members > 1) fail('TYPED_GROUP_UNIT_REQUIRED');
  }
  for (const key of ['modelSharedValues', 'variantOverrides']) {
    if (row[key] != null && (typeof row[key] !== 'object' || Array.isArray(row[key]) || Object.keys(row[key]).length)) fail('TYPED_GROUP_UNIT_REQUIRED');
  }
}
function assertRowContext(state, command) {
  assertBinding(state, command);
  const row = currentRow(state, command.rowId), base = state.baseline.get(command.rowId);
  if (!base) fail('EXPECTED_EXISTING_ROW_REQUIRED');
  if (rowRevision(row) !== command.baseRowRevision || rowRevision(base) !== command.baseRowRevision) fail('ROW_BASE_CHANGED');
  assertIndependent(state, row);
  assertIndependent(state, base, state.baseline.values());
  if (!equal(groupGuard(row), command.groupGuard) || !equal(groupGuard(base), command.groupGuard)) fail('GROUP_CHANGED');
  if (!equal(schemaGuard(state, command.slots.map(slot => slot.key)), command.schemaGuard)) fail('SCHEMA_CHANGED');
  return row;
}

function createState({ ownerId, clientGeneration, rows, baselineRows = rows, workspaceRevision = 0, nextId = 1, customColumns = [], view = 'single', canEdit = true, pendingIntent, historyLimits }) {
  if (pendingIntent != null) fail('LEGACY_PENDING_REQUIRES_ADAPTER');
  const baseline = new Map();
  for (const list of new Set([rows, baselineRows])) {
    if (!Array.isArray(list)) fail('INVALID_STATE');
    copyJson(list, new Set(), true);
    const seen = new Set();
    for (const row of list) { const id = rowKey(row); if (!id || seen.has(id)) fail('INVALID_ROW_ID'); seen.add(id); rowRevision(row); }
  }
  for (const row of baselineRows) baseline.set(rowKey(row), row);
  copyJson(customColumns, new Set(), true);
  if (!Array.isArray(customColumns) || new Set(customColumns.map(column => column.k)).size !== customColumns.length) fail('INVALID_SCHEMA');
  const state = { namespace: NAMESPACE, ownerId, clientGeneration, rows, baseline, workspaceRevision: requireRevision(workspaceRevision), nextId: requireRevision(nextId), customColumns, view, canEdit, operations: new Map(), history: createHistory(historyLimits) };
  assertState(state);
  return state;
}
function prepareFieldCommand(state, spec) {
  assertState(state);
  if (spec.kind !== UNIT) fail('UNSUPPORTED_SEMANTIC_UNIT');
  requireId(spec.operationId);
  const id = spec.rowId == null || spec.rowId === '' ? '' : String(spec.rowId), row = currentRow(state, id), base = state.baseline.get(id);
  if (!base) fail('EXPECTED_EXISTING_ROW_REQUIRED');
  if (rowRevision(row) !== rowRevision(base)) fail('ROW_BASE_CHANGED');
  assertIndependent(state, row);
  if (!Array.isArray(spec.writes) || !spec.writes.length || new Set(spec.writes.map(item => item.key)).size !== spec.writes.length) fail('INVALID_COMMAND');
  const guards = schemaGuard(state, spec.writes.map(item => requireId(item.key)));
  const slots = spec.writes.map(item => ({ key: item.key, before: readSlot(row, item.key), after: copySlot(item.after) })).filter(item => !sameSlot(item.before, item.after));
  if (!slots.length) fail('NO_CHANGES');
  const command = { namespace: NAMESPACE, version: 1, kind: UNIT, operationId: spec.operationId, ownerId: state.ownerId, clientGeneration: state.clientGeneration, rowId: id, baseRowRevision: rowRevision(base), groupGuard: groupGuard(row), schemaGuard: guards.filter(guard => slots.some(slot => slot.key === guard.key)), slots };
  if (!equal(command.groupGuard, groupGuard(base))) fail('GROUP_CHANGED');
  return freezeOwned(command);
}
function applyFieldCommand(state, command) {
  assertBinding(state, command);
  const prior = state.operations.get(command.operationId);
  if (prior) { if (!equal(prior.command, command)) fail('OPERATION_ID_REUSED'); return state; }
  assertHistoryCommand(state, command, prepareInverseCommand);
  const row = assertRowContext(state, command);
  if (!command.slots.every(slot => sameSlot(readSlot(row, slot.key), slot.before))) fail('FIELD_CONFLICT');
  const next = { ...row };
  command.slots.forEach(slot => writeSlot(next, slot.key, slot.after));
  const operations = new Map(state.operations);
  operations.set(command.operationId, { command: freezeOwned(copyJson(command)), status: 'pending' });
  return { ...state, rows: state.rows.map(item => item === row ? next : item), operations };
}
function prepareInverseCommand(state, forward, operationId) {
  assertBinding(state, forward);
  const entry = state.operations.get(forward.operationId);
  if (!entry || !equal(entry.command, forward) || entry.status !== 'acknowledged') fail('PRIMARY_ACK_REQUIRED');
  const row = currentRow(state, forward.rowId);
  if (!equal(groupGuard(row), forward.groupGuard)) fail('GROUP_CHANGED');
  if (!equal(schemaGuard(state, forward.slots.map(slot => slot.key)), forward.schemaGuard)) fail('SCHEMA_CHANGED');
  if (!forward.slots.every(slot => sameSlot(readSlot(row, slot.key), slot.after))) fail('FIELD_CONFLICT');
  // Yeni bir undo niyeti: eşleşen after-state kontrolünden SONRA güncel row CAS.
  // Eski pending komutun base'ini yeniden benimseme/rebase işlemi değildir.
  requireNewOperation(state, operationId);
  const inverse = prepareFieldCommand(state, { kind: UNIT, operationId, rowId: forward.rowId, writes: forward.slots.map(slot => ({ key: slot.key, after: slot.before })) });
  return freezeOwned({ ...inverse, inverseOf: forward.operationId });
}

function requireNewOperation(state, operationId) {
  requireId(operationId);
  if (state.operations.has(operationId)) fail('OPERATION_ID_REUSED');
}
function createHistory({ maxEntries = 50, maxBytes = 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('INVALID_HISTORY_LIMIT');
  return { undo: [], redo: [], bytes: 0, maxEntries, maxBytes };
}
function commandBytes(command) { return new TextEncoder().encode(JSON.stringify(command)).byteLength; }
function settleHistory(state, operations) {
  const history = { ...state.history, undo: [...state.history.undo], redo: [...state.history.redo] };
  const intentOrder = new Map([...operations.keys()].map((id, index) => [id, index]));
  for (const [id, entry] of operations) {
    if (entry.status !== 'acknowledged' || state.operations.get(id)?.status === 'acknowledged') continue;
    const command = entry.command;
    if (command.historyAction === 'undo') {
      const index = history.undo.indexOf(command.historyTarget);
      const atTail = index === history.undo.length - 1;
      if (index >= 0) history.undo.splice(index, 1);
      // A newer local edit is retained; it makes redo of this old undo ambiguous.
      const newerIntent = [...operations].some(([otherId, other]) => otherId !== id && other.status === 'pending');
      history.redo = atTail && !newerIntent ? [...history.redo, id] : [];
    } else if (command.historyAction === 'redo') {
      const index = history.redo.indexOf(command.historyTarget);
      if (index >= 0) history.redo.splice(index, 1);
      history.undo.push(id);
    } else {
      history.undo.push(id); history.redo = [];
    }
    history.undo.sort((a, b) => intentOrder.get(a) - intentOrder.get(b));
  }
  const bytes = () => [...history.undo, ...history.redo].reduce((sum, id) => sum + commandBytes(operations.get(id).command), 0);
  while (history.undo.length + history.redo.length > history.maxEntries || bytes() > history.maxBytes) {
    if (history.undo.length) history.undo.shift(); else if (history.redo.length) history.redo.shift(); else break;
  }
  history.bytes = bytes();
  return history;
}
function prepareHistoryCommand(state, operationId, direction, inverse) {
  requireNewOperation(state, operationId);
  if ([...state.operations.values()].some(entry => entry.status === 'pending' && entry.command.historyAction)) fail('HISTORY_IN_FLIGHT');
  const source = direction === 'undo' ? state.history.undo : state.history.redo;
  const target = source[source.length - 1], entry = state.operations.get(target);
  if (!entry || entry.status !== 'acknowledged') fail('PRIMARY_ACK_REQUIRED');
  return freezeOwned({ ...inverse(state, entry.command, operationId), historyAction: direction, historyTarget: target });
}
function assertHistoryCommand(state, command, inverse) {
  if (!own(command, 'historyAction') && !own(command, 'historyTarget')) return;
  const direction = command.historyAction;
  if (!['undo', 'redo'].includes(direction)) fail('INVALID_HISTORY_COMMAND');
  const source = direction === 'undo' ? state.history.undo : state.history.redo;
  if (source[source.length - 1] !== command.historyTarget) fail('INVALID_HISTORY_COMMAND');
  const expected = prepareHistoryCommand(state, command.operationId, direction, inverse);
  if (!equal(expected, command)) fail('INVALID_HISTORY_COMMAND');
}

// Shared, side-effect-free legacy transport. Group supplies its typed closure
// validator/composer; neither adapter can substitute current dirty full rows.
function createLegacyTransport(adapter) {
  const captures = new WeakSet();
  function materializeLegacyRequest(state, operationIds, { requestId, atomic = false } = {}) {
    adapter.assertState(state); requireId(requestId);
    if (!Array.isArray(operationIds) || !operationIds.length || new Set(operationIds).size !== operationIds.length || typeof atomic !== 'boolean') fail('INVALID_REQUEST');
    if (adapter.atomic && !atomic) fail('ATOMIC_GROUP_REQUIRED');
    const working = new Map(), touched = new Map(), commands = [];
    const get = id => working.get(id) || state.baseline.get(id);
    const set = (id, row) => { working.set(id, row); touched.set(id, row); };
    for (const id of operationIds) {
      const entry = state.operations.get(id);
      if (!entry || entry.status !== 'pending') fail('PENDING_OPERATION_REQUIRED');
      if (adapter.requiresAtomic?.(entry.command) && !atomic) fail('ATOMIC_GROUP_REQUIRED');
      adapter.assertContext(state, entry.command);
      adapter.compose(state, entry.command, get, set);
      commands.push(entry.command);
    }
    const upserts = [...touched.values()].map(row => {
      const next = { ...row, _rev: rowRevision(row) };
      delete next._sharedCollectionImageUrl; delete next._serverPlmImageUrl;
      return copyJson(next);
    });
    const payload = { upserts, deletes: [], nextId: state.nextId, expectedExistingIds: [...touched.keys()], expectedNewIds: [] };
    if (atomic) payload.atomic = true;
    const request = freezeOwned({ namespace: NAMESPACE, version: 1, ownerId: state.ownerId, clientGeneration: state.clientGeneration, requestId, commands, payload });
    captures.add(request);
    return request;
  }
  function acknowledgeLegacyResponse(state, request, response) {
    adapter.assertState(state);
    if (!captures.has(request)) fail('INVALID_REQUEST');
    if (request.ownerId !== state.ownerId) fail('OWNER_CHANGED');
    if (request.clientGeneration !== state.clientGeneration) fail('GENERATION_CHANGED');
    if (response?.ok !== true) fail('PRIMARY_NOT_ACKNOWLEDGED');
    requireRevision(response.revision);
    if (!Array.isArray(response.applied) || !Array.isArray(response.conflicts)) fail('INVALID_RECEIPT');
    const sentRows = new Map(request.payload.upserts.map(row => [rowKey(row), row]));
    const applied = new Map(), conflicted = new Set();
    for (const conflict of response.conflicts) {
      const id = String(conflict.id);
      if (!sentRows.has(id) || conflicted.has(id)) fail('ACK_UNKNOWN_ROW');
      conflicted.add(id);
    }
    for (const item of response.applied) {
      const id = String(item.id), sent = sentRows.get(id);
      if (!sent || applied.has(id) || conflicted.has(id)) fail('ACK_UNKNOWN_ROW');
      if (item.kind !== 'changed' || !Number.isSafeInteger(item.rev) || item.rev !== rowRevision(sent) + 1 || response.revision < item.rev) fail('INVALID_RECEIPT');
      applied.set(id, item);
    }
    if (request.payload.atomic === true && applied.size && (conflicted.size || applied.size !== sentRows.size)) fail('INVALID_ATOMIC_ACK');
    const operations = new Map(state.operations), baseline = new Map(state.baseline), replacements = new Map();
    let changed = false;
    for (const command of request.commands) {
      adapter.assertBinding(state, command);
      const entry = state.operations.get(command.operationId), ids = adapter.touched(command);
      if (!entry || !equal(entry.command, command)) fail('OPERATION_ID_REUSED');
      if (!ids.every(id => applied.has(id))) continue;
      const acknowledged = { requestId: request.requestId, rows: ids.map(id => ({ rowId: id, rowRevision: applied.get(id).rev })), workspaceRevision: response.revision };
      if (entry.status === 'acknowledged') {
        if (!equal(entry.receipt, acknowledged)) fail('RECEIPT_MISMATCH');
        continue;
      }
      for (const id of ids) {
        const row = state.rows.find(item => rowKey(item) === id), base = state.baseline.get(id), sent = sentRows.get(id);
        if (!row || !base || rowRevision(base) !== rowRevision(sent) || rowRevision(row) !== rowRevision(sent)) fail('ACK_BASE_CHANGED');
        baseline.set(id, { ...sent, _rev: applied.get(id).rev });
        replacements.set(id, { ...row, _rev: applied.get(id).rev });
      }
      operations.set(command.operationId, { ...entry, status: 'acknowledged', receipt: acknowledged });
      changed = true;
    }
    if (!changed) return state;
    const next = { ...state, operations, baseline, rows: state.rows.map(row => replacements.get(rowKey(row)) || row), workspaceRevision: Math.max(state.workspaceRevision, response.revision), history: settleHistory(state, operations) };
    return adapter.adopt ? adapter.adopt(next) : next;
  }
  return { materializeLegacyRequest, acknowledgeLegacyResponse };
}
const fieldAdapter = {
  assertState, assertBinding, assertContext: assertRowContext,
  touched: command => [command.rowId],
  compose(state, command, get, set) {
    const row = { ...get(command.rowId), _rev: command.baseRowRevision };
    if (!command.slots.every(slot => sameSlot(readSlot(row, slot.key), slot.before))) fail('FIELD_CONFLICT');
    command.slots.forEach(slot => writeSlot(row, slot.key, slot.after));
    set(command.rowId, row);
  },
};
const transport = createLegacyTransport(fieldAdapter);

// Capture only: legacy pending restoration remains with the existing adapter.
// No fresh source is accepted here, and no original base can be replaced by it.
function capturePendingIntent(pending, { ownerId, clientGeneration }) {
  requireId(ownerId); requireRevision(clientGeneration);
  if (pending?.ownerId !== ownerId) fail('OWNER_CHANGED');
  if (![1, 2].includes(pending.schemaVersion) || !Array.isArray(pending.rows)) fail('INVALID_PENDING_INTENT');
  const capture = copyJson(pending), existing = new Set((capture.expectedExistingIds || []).map(String)), added = new Set((capture.expectedNewIds || []).map(String));
  const validateIds = rows => {
    const ids = rows.map(rowKey);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) fail('INVALID_ROW_ID');
    return ids;
  };
  const local = validateIds(capture.rows), hasBase = Array.isArray(capture.baseRows);
  const bases = hasBase ? validateIds(capture.baseRows) : [];
  for (const id of bases) {
    if (added.has(id)) fail('AMBIGUOUS_EXISTENCE_INTENT');
    existing.add(id);
  }
  for (const id of local) {
    if (existing.has(id) && added.has(id)) fail('AMBIGUOUS_EXISTENCE_INTENT');
    if (!bases.includes(id) && !existing.has(id)) {
      if (hasBase) added.add(id); else if (!added.has(id)) existing.add(id);
    }
  }
  if ([...existing].some(id => !id || added.has(id)) || [...added].some(id => !id)) fail('AMBIGUOUS_EXISTENCE_INTENT');
  capture.expectedExistingIds = [...existing]; capture.expectedNewIds = [...added];
  return freezeOwned({ ...capture, clientGeneration });
}

return {
  NAMESPACE, UNIT, createState, readSlot, prepareFieldCommand, applyFieldCommand, prepareInverseCommand,
  ...transport, capturePendingIntent,
  prepareUndo: (state, id) => prepareHistoryCommand(state, id, 'undo', prepareInverseCommand),
  prepareRedo: (state, id) => prepareHistoryCommand(state, id, 'redo', prepareInverseCommand),
  createLegacyTransport, createHistory, prepareHistoryCommand, assertHistoryCommand, fieldAdapter,
};
});
