'use strict';

// Inactive preparation. The injected adapter is the EXISTING local-db API.
const crypto = require('node:crypto');
const NS = 'collection-workspaces';
const GROUP_KEYS = ['modelGroupId', 'modelGroupRole', 'modelGroupIdentity', 'variantId', 'modelGroupDetached', 'modelSharedValues', 'variantOverrides'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) fail('INVALID_ID'); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_REVISION'); return value; }
function rowId(row) { return row?.id == null || row.id === '' ? '' : String(row.id); }
// Same legacy absence -> zero rule as collection-workspaces.rowRev.
function rowRevision(row) { return revision(Math.max(0, Number(row?._rev) || 0)); }
function clone(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) fail('INVALID_JSON');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_JSON');
  if (Object.getOwnPropertySymbols(value).length) fail('INVALID_JSON');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Object.keys(value).every((key, index) => key === String(index)))) fail('INVALID_JSON');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) fail('INVALID_JSON');
    Object.defineProperty(result, key, { value: clone(descriptor.value, seen), writable: true, configurable: true, enumerable: true });
  }
  seen.delete(value);
  return result;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function same(a, b) { return canonical(a) === canonical(b); }
function slot(row, field) { return own(row, field) ? { present: true, value: clone(row[field]) } : { present: false }; }
function checkSlot(value) {
  if (!value || typeof value.present !== 'boolean' || !own(value, 'present') || (value.present ? !own(value, 'value') : own(value, 'value'))) fail('INVALID_SLOT');
  if (Object.keys(value).some(key => !['present', 'value'].includes(key))) fail('INVALID_SLOT');
  if (value.present && value.value !== null && !['string', 'number', 'boolean'].includes(typeof value.value)) fail('TYPED_SEMANTIC_UNIT_REQUIRED');
  if (typeof value.value === 'number' && !Number.isFinite(value.value)) fail('INVALID_SLOT');
}
function keys(ownerId) {
  const prefix = NS + ':' + id(ownerId) + ':';
  return { head: prefix + 'head', structure: prefix + 'structure', row: value => prefix + 'row:' + encodeURIComponent(String(value)), tx: value => prefix + 'tx:' + id(value) };
}
function document(value) { return { doc: { kind: NS, ...value } }; }
function load(state, key, type, ownerId) {
  const value = state.records[key]?.doc;
  if (!value || value.kind !== NS || value.type !== type || value.ownerId !== ownerId || value.schema !== 1) fail('SOURCE_HANDOFF_REQUIRED');
  return value;
}
function context(state, ownerId) {
  const key = keys(ownerId);
  return { key, head: load(state, key.head, 'head', ownerId), structure: load(state, key.structure, 'structure', ownerId) };
}
function assertField(structure, row, field) {
  // Current GROUP units, rich notes, pricing and checklist are not scalar fields.
  if (GROUP_KEYS.some(key => own(row, key))) fail('TYPED_GROUP_UNIT_REQUIRED');
  const column = (structure.metadata.customColumns || []).find(item => item.k === field);
  if (!/^cx_[A-Za-z0-9_]+$/.test(field) || !column || column.custom !== true || column.checklist === true || column.type !== 'text') fail('TYPED_SEMANTIC_UNIT_REQUIRED');
}
function readWorkspace(state, ownerId) {
  const { key, head, structure } = context(state, ownerId);
  return { ...clone(structure.metadata), rows: structure.rowIds.map(value => clone(load(state, key.row(value), 'row', ownerId).value)), _revision: head.workspaceRevision };
}
// Only a captured full-state edit with identical structure can use this adapter.
// This does not switch, import or migrate the current production source.
function adaptLegacyFullState(base, incoming, binding) {
  base = clone(base); incoming = clone(incoming);
  const metadata = workspace => Object.fromEntries(Object.entries(workspace).filter(([key]) => !['rows', '_revision'].includes(key)));
  if (!Array.isArray(base.rows) || !Array.isArray(incoming.rows) || !same(metadata(base), metadata(incoming)) || !same(base.rows.map(rowId), incoming.rows.map(rowId)) || base._revision !== incoming._revision) fail('LEGACY_STRUCTURE_CHANGE_BLOCKED');
  const seen = new Set(), patches = [];
  for (let index = 0; index < base.rows.length; index++) {
    const before = base.rows[index], after = incoming.rows[index], rid = rowId(before);
    if (!rid || seen.has(rid)) fail('INVALID_ROW_ID');
    seen.add(rid);
    if (!same(slot(before, '_rev'), slot(after, '_rev'))) fail('LEGACY_ROW_REVISION_CHANGED');
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(slot(before, field), slot(after, field))) continue;
      assertField({ metadata: metadata(base) }, before, field);
      checkSlot(slot(before, field)); checkSlot(slot(after, field));
      patches.push({ rowId: rid, field, baseRowRevision: rowRevision(before), base: slot(before, field), incoming: slot(after, field) });
    }
  }
  return { ...clone(binding), version: 1, namespace: NS, mode: 'row-cas-v1', expectedWorkspaceRevision: revision(base._revision), patches };
}

class AlreadyCommitted extends Error {
  constructor(receipt) { super('Already committed'); this.receipt = receipt; }
}
function createCollectionDeltaService({ db, actorId, assertAuthority }) {
  id(actorId);
  if (typeof db?.privateRecordTransaction !== 'function' || typeof assertAuthority !== 'function') fail('EXISTING_NATIVE_ADAPTER_REQUIRED');
  async function authority(request, phase) {
    // Trusted callback must freshly consult actual owner/share authority.
    const result = await assertAuthority({ ownerId: request.ownerId, actorId, sourceGeneration: request.sourceGeneration, transactionId: request.transactionId, phase });
    if (!result || result.ownerId !== request.ownerId || result.sourceGeneration !== request.sourceGeneration || result.canEdit !== true || result.canView !== true) fail('AUTHORITY_CHANGED');
  }
  async function commit(input) {
    const request = clone(input);
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('UNSUPPORTED_CONTRACT');
    if (Object.keys(request).some(key => !['version', 'namespace', 'ownerId', 'transactionId', 'sourceGeneration', 'baseStructureRevision', 'expectedWorkspaceRevision', 'mode', 'patches', 'inverseOf'].includes(key))) fail('TYPED_SEMANTIC_UNIT_REQUIRED');
    if (request.version !== 1 || request.namespace !== NS) fail('UNSUPPORTED_CONTRACT');
    id(request.ownerId); id(request.transactionId); revision(request.sourceGeneration); revision(request.baseStructureRevision);
    if (own(request, 'inverseOf')) id(request.inverseOf);
    if (request.inverseOf ? request.patches !== undefined || request.mode !== 'inverse-fields-v1' : !['row-cas-v1', 'field-merge-v1'].includes(request.mode)) fail('UNSUPPORTED_CONTRACT');
    if (!request.inverseOf && (!Array.isArray(request.patches) || !request.patches.length)) fail('EMPTY_PATCH');
    const hash = digest({ actorId, request });
    let receipt, duplicate = false;
    try {
      receipt = await db.privateRecordTransaction(async state => {
        // Throwing from prepare leaves the current native WAL unchanged.
        try {
          await authority(request, 'prepare');
          const { key, head, structure } = context(state, request.ownerId);
          if (head.sourceGeneration !== request.sourceGeneration) fail('SOURCE_GENERATION_CHANGED');
          if (head.structureRevision !== request.baseStructureRevision) fail('STRUCTURE_REVISION_CHANGED');
          const previous = state.records[key.tx(request.transactionId)]?.doc;
          if (previous) {
            if (previous.kind !== NS || previous.type !== 'transaction' || previous.ownerId !== request.ownerId || previous.digest !== hash) fail('TRANSACTION_ID_REUSED');
            throw new AlreadyCommitted(clone(previous.receipt));
          }
          // Preserve whole-workspace expectedRevision for an old full PUT.
          // Ordinary row PATCH adaptation need not carry this extra fence.
          if (own(request, 'expectedWorkspaceRevision') && head.workspaceRevision !== revision(request.expectedWorkspaceRevision)) fail('WORKSPACE_REVISION_CHANGED');
          let patches = request.patches;
          if (request.inverseOf) {
            const forward = load(state, key.tx(request.inverseOf), 'transaction', request.ownerId).receipt;
            if (forward.actorId !== actorId || forward.status !== 'applied' || !forward.applied.length) fail('DURABLE_FORWARD_REQUIRED');
            if (forward.sourceGeneration !== request.sourceGeneration || forward.structureRevision !== request.baseStructureRevision) fail('INVERSE_CONTEXT_CHANGED');
            patches = forward.applied.map(change => ({ rowId: change.rowId, field: change.field, base: change.after, incoming: change.before, expectedFieldRevision: change.fieldRevision }));
          }
          const seen = new Set(), changes = [], conflicts = [], rows = new Map();
          for (const patch of patches) {
            if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['rowId', 'field', 'base', 'incoming', 'baseRowRevision', 'expectedFieldRevision'].includes(key))) fail('UNSUPPORTED_PATCH');
            if (typeof patch.rowId !== 'string' || !patch.rowId || typeof patch.field !== 'string') fail('INVALID_PATCH');
            const identity = canonical([patch.rowId, patch.field]);
            if (seen.has(identity)) fail('DUPLICATE_FIELD');
            seen.add(identity); checkSlot(patch.base); checkSlot(patch.incoming);
            const rowDocument = state.records[key.row(patch.rowId)]?.doc;
            if (!rowDocument) { conflicts.push({ rowId: patch.rowId, field: patch.field, reason: 'row-missing', base: patch.base, incoming: patch.incoming }); continue; }
            const current = load(state, key.row(patch.rowId), 'row', request.ownerId);
            if (rowId(current.value) !== patch.rowId || current.structureRevision !== head.structureRevision) fail('MEMBERSHIP_CHANGED');
            assertField(structure, current.value, patch.field);
            const currentSlot = slot(current.value, patch.field), currentFieldRevision = current.fieldRevisions[patch.field] || 0;
            checkSlot(currentSlot);
            let reason;
            if (request.mode === 'row-cas-v1' && rowRevision(current.value) !== revision(patch.baseRowRevision)) reason = 'row-revision';
            else if (own(patch, 'expectedFieldRevision') && currentFieldRevision !== revision(patch.expectedFieldRevision)) reason = 'field-revision';
            else if (request.inverseOf && !same(currentSlot, patch.base)) reason = 'inverse-after-state';
            else if (!same(currentSlot, patch.base) && !same(currentSlot, patch.incoming) && !same(patch.incoming, patch.base)) reason = 'three-way-field';
            if (reason) { conflicts.push({ rowId: patch.rowId, field: patch.field, reason, base: patch.base, current: currentSlot, incoming: patch.incoming, currentFieldRevision }); continue; }
            // A converged incoming or unchanged incoming does not overwrite current.
            if (same(currentSlot, patch.incoming) || same(patch.incoming, patch.base)) continue;
            if (!rows.has(patch.rowId)) rows.set(patch.rowId, { ...current, value: { ...current.value }, fieldRevisions: { ...current.fieldRevisions } });
            const next = rows.get(patch.rowId);
            if (patch.incoming.present) Object.defineProperty(next.value, patch.field, { value: clone(patch.incoming.value), writable: true, configurable: true, enumerable: true });
            else delete next.value[patch.field];
            changes.push({ rowId: patch.rowId, field: patch.field, before: currentSlot, after: patch.incoming, beforeRowRevision: rowRevision(current.value), afterRowRevision: rowRevision(current.value) + 1 });
          }
          const records = {}, nativeRevision = revision(Number(state.revision || 0) + 1);
          // Prototype batches are atomic: conflict intent is durable, row effects absent.
          if (conflicts.length) { rows.clear(); changes.length = 0; }
          for (const change of changes) {
            rows.get(change.rowId).fieldRevisions[change.field] = nativeRevision;
            change.fieldRevision = nativeRevision;
          }
          for (const [rid, row] of rows) {
            row.value._rev = rowRevision(row.value) + 1;
            records[key.row(rid)] = document(row);
          }
          if (rows.size) records[key.head] = document({ ...head, workspaceRevision: revision(head.workspaceRevision + 1) });
          const result = {
            transactionId: request.transactionId, actorId, ownerId: request.ownerId,
            sourceGeneration: request.sourceGeneration, structureRevision: request.baseStructureRevision,
            status: conflicts.length ? 'conflict' : changes.length ? 'applied' : 'converged',
            applied: changes, conflicts, nativeRevision,
            workspaceRevision: head.workspaceRevision + (rows.size ? 1 : 0),
          };
          // Do not use native state.conflicts: replay of private-records appends it.
          // Evidence belongs to this idempotent transaction record instead.
          records[key.tx(request.transactionId)] = document({ schema: 1, type: 'transaction', ownerId: request.ownerId, digest: hash, receipt: clone(result) });
          await authority(request, 'pre-append');
          return { records, conflicts: [], result };
        } catch (error) { if (!(error instanceof AlreadyCommitted)) error.beforeAppend = true; throw error; }
      });
    } catch (error) {
      if (error instanceof AlreadyCommitted) { receipt = error.receipt; duplicate = true; }
      else { error.durability = error.beforeAppend ? 'not-appended-by-service' : 'unknown-retry-same-transaction-id'; throw error; }
    }
    let visibility = 'allowed';
    try { await authority(request, 'post-durable'); } catch (_) { visibility = 'withheld'; }
    if (visibility === 'withheld') return { durable: true, duplicate, visibility, publication: 'not-attempted', transactionId: request.transactionId };
    return { durable: true, duplicate, visibility, publication: 'not-attempted', receipt: clone(receipt) };
  }
  return { commit };
}

module.exports = { NS, keys, document, readWorkspace, adaptLegacyFullState, createCollectionDeltaService };
