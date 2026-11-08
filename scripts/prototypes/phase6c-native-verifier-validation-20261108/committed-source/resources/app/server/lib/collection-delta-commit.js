'use strict';

// native27 planlayıcısı: yalnız bildirilmiş scalar cx_* alanları.
const sourceLib = require('./collection-committed-source');
const { NS, keys, document, clone, own, fail, id, revision, rowId, rowRevision, same, slot, checkSlot, canonical, digest, context, load, assertField, decodeWorkspace, createCollectionCommittedSource } = sourceLib;

// Only a captured full-state edit with identical structure can use this adapter.
// This does not switch, import or migrate the current production source.
function adaptLegacyFullState(base, incoming, binding) {
  base = clone(base); incoming = clone(incoming);
  const metadata = workspace => Object.fromEntries(Object.entries(workspace).filter(([key]) => !['rows', '_revision'].includes(key)));
  if (!Array.isArray(base.rows) || !Array.isArray(incoming.rows) || JSON.stringify(Object.keys(base)) !== JSON.stringify(Object.keys(incoming)) || JSON.stringify(metadata(base)) !== JSON.stringify(metadata(incoming)) || !same(base.rows.map(rowId), incoming.rows.map(rowId)) || base._revision !== incoming._revision) fail('LEGACY_STRUCTURE_CHANGE_BLOCKED');
  const seen = new Set(), patches = [];
  for (let index = 0; index < base.rows.length; index++) {
    const before = base.rows[index], after = incoming.rows[index], rid = rowId(before);
    if (!rid || seen.has(rid)) fail('INVALID_ROW_ID');
    seen.add(rid);
    if (!same(slot(before, '_rev'), slot(after, '_rev'))) fail('LEGACY_ROW_REVISION_CHANGED');
    const materialized = clone(before);
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (same(slot(before, field), slot(after, field))) continue;
      assertField({ metadata: metadata(base) }, before, field);
      checkSlot(slot(before, field)); checkSlot(slot(after, field));
      patches.push({ rowId: rid, field, baseRowRevision: rowRevision(before), base: slot(before, field), incoming: slot(after, field) });
      if (own(after, field)) Object.defineProperty(materialized, field, { value: clone(after[field]), enumerable: true, writable: true, configurable: true });
      else delete materialized[field];
    }
    if (JSON.stringify(materialized) !== JSON.stringify(after)) fail('LEGACY_STRUCTURE_CHANGE_BLOCKED');
  }
  return { ...clone(binding), version: 1, namespace: NS, mode: 'row-cas-v1', expectedWorkspaceRevision: revision(base._revision), patches };
}

function createCollectionDeltaService(options) {
  const source = options.source || createCollectionCommittedSource(options);
  const actorId = source.actorId;
  async function commit(input) {
    const request = clone(input);
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('UNSUPPORTED_CONTRACT');
    if (Object.keys(request).some(key => !['version', 'namespace', 'ownerId', 'transactionId', 'sourceGeneration', 'clientGeneration', 'baseStructureRevision', 'expectedWorkspaceRevision', 'mode', 'patches', 'inverseOf'].includes(key))) fail('TYPED_SEMANTIC_UNIT_REQUIRED');
    if (request.version !== 1 || request.namespace !== NS) fail('UNSUPPORTED_CONTRACT');
    id(request.ownerId); id(request.transactionId); revision(request.sourceGeneration); revision(request.baseStructureRevision);
    if (own(request, 'clientGeneration')) revision(request.clientGeneration);
    if (own(request, 'inverseOf')) id(request.inverseOf);
    if (request.inverseOf ? request.patches !== undefined || request.mode !== 'inverse-fields-v1' : !['row-cas-v1', 'field-merge-v1'].includes(request.mode)) fail('UNSUPPORTED_CONTRACT');
    if (!request.inverseOf && (!Array.isArray(request.patches) || !request.patches.length)) fail('EMPTY_PATCH');
    const hash = digest({ actorId, request });
    const outcome = await source.transaction(request, async state => {
      const { key, head, structure } = context(state, request.ownerId);
      if (head.sourceGeneration !== request.sourceGeneration) fail('SOURCE_GENERATION_CHANGED');
      if (head.structureRevision !== request.baseStructureRevision) fail('STRUCTURE_REVISION_CHANGED');
      const previous = state.records[key.tx(request.transactionId)]?.doc;
      if (state.tombstones?.[key.tx(request.transactionId)]) fail('COLLECTION_SOURCE_INTEGRITY');
      if (previous) {
        load(state, key.tx(request.transactionId), 'transaction', request.ownerId);
        if (previous.digest !== hash) fail('TRANSACTION_ID_REUSED');
        if (previous.receipt?.transactionId !== request.transactionId || previous.receipt.ownerId !== request.ownerId || previous.receipt.actorId !== actorId || previous.receipt.sourceGeneration !== request.sourceGeneration) fail('COLLECTION_SOURCE_INTEGRITY');
        const saved = previous.receipt;
        if (saved.structureRevision !== request.baseStructureRevision || !['applied', 'conflict', 'converged'].includes(saved.status) || !Array.isArray(saved.applied) || !Array.isArray(saved.conflicts) || !Number.isSafeInteger(saved.nativeRevision) || saved.nativeRevision < 0 || saved.nativeRevision > state.revision || !Number.isSafeInteger(saved.workspaceRevision) || saved.workspaceRevision < 0) fail('COLLECTION_SOURCE_INTEGRITY');
        return { duplicate: true, result: clone(previous.receipt) };
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
        if (!rowDocument || rowDocument.tombstone === true || !structure.rowIds.includes(patch.rowId)) { conflicts.push({ rowId: patch.rowId, field: patch.field, reason: 'row-missing', base: patch.base, incoming: patch.incoming }); continue; }
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
      return { records, conflicts: [], result };
    });
    if (outcome.visibility === 'withheld') return { durable: true, duplicate: outcome.duplicate, visibility: 'withheld', publication: 'not-attempted', transactionId: request.transactionId };
    return { durable: true, duplicate: outcome.duplicate, visibility: 'allowed', publication: 'not-attempted', receipt: clone(outcome.result) };
  }
  return { commit, source };
}
module.exports = { NS, keys, document, decodeWorkspace, adaptLegacyFullState, createCollectionDeltaService };
