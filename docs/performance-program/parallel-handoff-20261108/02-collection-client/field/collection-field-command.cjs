'use strict';

// Hazırlık prototipi. Ürün, DOM, disk, ağ veya worker bağımlılığı yoktur.
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

function copyJson(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('INVALID_JSON_VALUE');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('INVALID_JSON_VALUE');
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_JSON_VALUE');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Object.keys(value).every((key, index) => key === String(index)))) fail('INVALID_JSON_VALUE');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) fail('INVALID_JSON_VALUE');
    // __proto__ gibi mevcut bilinmeyen JSON anahtarları da veri olarak kalır.
    Object.defineProperty(result, key, { value: copyJson(descriptor.value, seen), enumerable: true, configurable: true, writable: true });
  }
  seen.delete(value);
  return result;
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
function writeSlot(row, key, slot) { if (slot.present) row[key] = copyJson(slot.value); else delete row[key]; }
function groupGuard(row) { return GROUP_KEYS.map(key => ({ key, slot: readSlot(row, key) })); }
function schemaGuard(state, keys) {
  return keys.map(key => {
    if (key === 'quantity') return { key, definition: null };
    const column = state.customColumns.find(item => item.k === key);
    if (!/^cx_[A-Za-z0-9_]+$/.test(key) || !column || column.custom !== true || column.checklist === true) fail('FIELD_NOT_APPROVED');
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
function assertIndependent(state, row) {
  const id = row.modelGroupId;
  if ((row.modelGroupRole && row.modelGroupRole !== 'single') || (id && state.rows.filter(item => String(item.modelGroupId || '') === String(id)).length > 1)) fail('TYPED_GROUP_UNIT_REQUIRED');
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
  if (!equal(groupGuard(row), command.groupGuard) || !equal(groupGuard(base), command.groupGuard)) fail('GROUP_CHANGED');
  if (!equal(schemaGuard(state, command.slots.map(slot => slot.key)), command.schemaGuard)) fail('SCHEMA_CHANGED');
  return row;
}

function createState({ ownerId, clientGeneration, rows, baselineRows = rows, workspaceRevision = 0, nextId = 1, customColumns = [], view = 'single', canEdit = true }) {
  const baseline = new Map();
  for (const list of [rows, baselineRows]) {
    if (!Array.isArray(list)) fail('INVALID_STATE');
    const seen = new Set();
    for (const row of list) { const id = rowKey(row); if (!id || seen.has(id)) fail('INVALID_ROW_ID'); seen.add(id); rowRevision(row); }
  }
  for (const row of baselineRows) baseline.set(rowKey(row), row);
  const state = { namespace: NAMESPACE, ownerId, clientGeneration, rows, baseline, workspaceRevision: requireRevision(workspaceRevision), nextId: requireRevision(nextId), customColumns, view, canEdit, operations: new Map() };
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
  const inverse = prepareFieldCommand(state, { kind: UNIT, operationId, rowId: forward.rowId, writes: forward.slots.map(slot => ({ key: slot.key, after: slot.before })) });
  return freezeOwned({ ...inverse, inverseOf: forward.operationId });
}

function materializeLegacyRequest(state, operationIds, { requestId, atomic = false } = {}) {
  assertState(state); requireId(requestId);
  if (!Array.isArray(operationIds) || !operationIds.length || new Set(operationIds).size !== operationIds.length || typeof atomic !== 'boolean') fail('INVALID_REQUEST');
  const touched = new Map(), commands = [];
  for (const id of operationIds) {
    const entry = state.operations.get(id);
    if (!entry || entry.status !== 'pending') fail('PENDING_OPERATION_REQUIRED');
    const command = entry.command; assertRowContext(state, command);
    const row = touched.get(command.rowId) || { ...state.baseline.get(command.rowId), _rev: command.baseRowRevision };
    if (!command.slots.every(slot => sameSlot(readSlot(row, slot.key), slot.before))) fail('FIELD_CONFLICT');
    command.slots.forEach(slot => writeSlot(row, slot.key, slot.after));
    touched.set(command.rowId, row); commands.push(command);
  }
  const upserts = [...touched.values()].map(row => {
    const next = { ...row }; delete next._sharedCollectionImageUrl; delete next._serverPlmImageUrl;
    return copyJson(next);
  });
  // Row-only request'te global expectedRevision/baseRevision veya structure yok.
  const payload = { upserts, deletes: [], nextId: state.nextId, expectedExistingIds: [...touched.keys()], expectedNewIds: [] };
  if (atomic) payload.atomic = true;
  return freezeOwned({ namespace: NAMESPACE, version: 1, ownerId: state.ownerId, clientGeneration: state.clientGeneration, requestId, commands, payload });
}
function acknowledgeLegacyResponse(state, request, response) {
  assertState(state);
  if (request.namespace !== NAMESPACE || request.version !== 1) fail('INVALID_REQUEST');
  if (request.ownerId !== state.ownerId) fail('OWNER_CHANGED');
  if (request.clientGeneration !== state.clientGeneration) fail('GENERATION_CHANGED');
  if (response?.ok !== true) fail('PRIMARY_NOT_ACKNOWLEDGED');
  requireRevision(response.revision);
  if (!Array.isArray(response.applied) || !Array.isArray(response.conflicts)) fail('INVALID_RECEIPT');
  if (request.payload.atomic === true && response.applied.length && response.conflicts.length) fail('INVALID_ATOMIC_ACK');
  const sentRows = new Map(request.payload.upserts.map(row => [rowKey(row), row]));
  const applied = new Map(), conflicted = new Set(response.conflicts.map(item => String(item.id)));
  for (const item of response.applied) {
    const id = String(item.id), sent = sentRows.get(id);
    if (!sent || applied.has(id) || conflicted.has(id)) fail('ACK_UNKNOWN_ROW');
    if (item.kind !== 'changed' || !Number.isSafeInteger(item.rev) || item.rev !== rowRevision(sent) + 1 || response.revision < item.rev) fail('INVALID_RECEIPT');
    applied.set(id, item);
  }
  if ([...conflicted].some(id => !sentRows.has(id))) fail('ACK_UNKNOWN_ROW');
  const operations = new Map(state.operations), baseline = new Map(state.baseline), replacements = new Map();
  let changed = false;
  for (const command of request.commands) {
    assertBinding(state, command);
    const entry = state.operations.get(command.operationId), receipt = applied.get(command.rowId);
    if (!entry || !equal(entry.command, command)) fail('OPERATION_ID_REUSED');
    if (!receipt) continue; // HTTP 200 / replication.ok tek başına ACK değildir.
    const acknowledged = { requestId: request.requestId, rowRevision: receipt.rev, workspaceRevision: response.revision };
    if (entry.status === 'acknowledged') {
      if (!equal(entry.receipt, acknowledged)) fail('RECEIPT_MISMATCH');
      continue;
    }
    const row = currentRow(state, command.rowId), base = state.baseline.get(command.rowId);
    if (!base || rowRevision(base) !== command.baseRowRevision || rowRevision(row) !== command.baseRowRevision) fail('ACK_BASE_CHANGED');
    operations.set(command.operationId, { ...entry, status: 'acknowledged', receipt: acknowledged });
    baseline.set(command.rowId, { ...copyJson(sentRows.get(command.rowId)), _rev: receipt.rev });
    replacements.set(command.rowId, { ...row, _rev: receipt.rev });
    changed = true;
  }
  return changed ? { ...state, operations, baseline, rows: state.rows.map(row => replacements.get(rowKey(row)) || row), workspaceRevision: Math.max(state.workspaceRevision, response.revision) } : state;
}

module.exports = { NAMESPACE, UNIT, createState, readSlot, prepareFieldCommand, applyFieldCommand, prepareInverseCommand, materializeLegacyRequest, acknowledgeLegacyResponse };
