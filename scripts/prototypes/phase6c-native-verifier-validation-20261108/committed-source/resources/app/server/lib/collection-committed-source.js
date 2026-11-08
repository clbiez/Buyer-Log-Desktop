'use strict';

// Pasif kaynak modülü; mevcut local-db lease/frame sözleşmesini kullanır.
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
  return { head: prefix + 'head', structure: prefix + 'structure', retirement: prefix + 'retirement', row: value => prefix + 'row:' + encodeURIComponent(String(value)), tx: value => prefix + 'tx:' + id(value) };
}
function document(value) { return { doc: { kind: NS, ...value } }; }
function load(state, key, type, ownerId) {
  const value = state.records[key]?.doc;
  if (value && own(value, 'tombstone') && typeof value.tombstone !== 'boolean') fail('COLLECTION_SOURCE_INTEGRITY');
  if (state.tombstones?.[key] || state.records[key]?._deleted || value?.tombstone === true) fail('COLLECTION_SOURCE_INTEGRITY');
  if (!value || value.kind !== NS || value.type !== type || value.ownerId !== ownerId || value.schema !== 1) fail('SOURCE_HANDOFF_REQUIRED');
  return value;
}
function context(state, ownerId) {
  const key = keys(ownerId);
  // Emeklilik kaydı silinmez: önceki WAL replay'i eski head'i geri getirebilir.
  if (state.records[key.retirement] || state.tombstones?.[key.retirement]) fail('COLLECTION_SOURCE_RETIRED');
  const head = load(state, key.head, 'head', ownerId), structure = load(state, key.structure, 'structure', ownerId);
  if (own(head, 'retired') && typeof head.retired !== 'boolean') fail('COLLECTION_SOURCE_INTEGRITY');
  if (head.retired === true) fail('COLLECTION_SOURCE_RETIRED');
  revision(head.sourceGeneration); revision(head.structureRevision); revision(head.workspaceRevision);
  if (!structure.metadata || typeof structure.metadata !== 'object' || Array.isArray(structure.metadata) || own(structure.metadata, 'rows') || own(structure.metadata, '_revision')) fail('COLLECTION_SOURCE_INTEGRITY');
  if (!Array.isArray(structure.workspaceKeys)) fail('SOURCE_HANDOFF_REQUIRED');
  const expected = ['rows', '_revision', ...Object.keys(structure.metadata)];
  if (new Set(structure.workspaceKeys).size !== structure.workspaceKeys.length || !same([...structure.workspaceKeys].sort(), expected.sort())) fail('COLLECTION_SOURCE_INTEGRITY');
  if (!Array.isArray(structure.rowIds) || structure.rowIds.some(value => typeof value !== 'string' || !value) || new Set(structure.rowIds).size !== structure.rowIds.length) fail('COLLECTION_SOURCE_INTEGRITY');
  return { key, head, structure };
}
function assertField(structure, row, field) {
  // Current GROUP units, rich notes, pricing and checklist are not scalar fields.
  if (GROUP_KEYS.some(key => own(row, key))) fail('TYPED_GROUP_UNIT_REQUIRED');
  const column = (structure.metadata.customColumns || []).find(item => item.k === field);
  if (!/^cx_[A-Za-z0-9_]+$/.test(field) || !column || column.custom !== true || column.checklist === true || column.type !== 'text') fail('TYPED_SEMANTIC_UNIT_REQUIRED');
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
// Codec yalnızdır; yetkili committed okuma createCollectionCommittedSource ile.
function decodeWorkspace(state, ownerId) { return capture(state, ownerId).workspace; }
function capture(state, ownerId, prior, records = null, nativeRevision = state.revision) {
  const projected = records ? { ...state, records: new Proxy(state.records, { get: (target, key) => own(records, key) ? records[key] : target[key] }) } : state;
  const { key, head, structure } = context(projected, ownerId);
  // Yalnız bilinen aynı native tabandan COW. Refresh ve dış yazar yeni kopyadır.
  const reuse = prior && records && !own(records, key.structure) && prior.nativeRevision === state.revision && prior.sourceGeneration === head.sourceGeneration && prior.structureRevision === head.structureRevision;
  const rows = structure.rowIds.map((rid, index) => {
    const row = load(projected, key.row(rid), 'row', ownerId);
    if (rowId(row.value) !== rid || row.structureRevision !== head.structureRevision) fail('MEMBERSHIP_CHANGED');
    rowRevision(row.value);
    if (!row.fieldRevisions || typeof row.fieldRevisions !== 'object' || Array.isArray(row.fieldRevisions)) fail('COLLECTION_SOURCE_INTEGRITY');
    for (const token of Object.values(row.fieldRevisions)) revision(token);
    return reuse && !own(records, key.row(rid)) ? prior.workspace.rows[index] : freeze(clone(row.value));
  });
  const workspace = {};
  for (const name of structure.workspaceKeys) Object.defineProperty(workspace, name, {
    enumerable: true, value: name === 'rows' ? freeze(rows) : name === '_revision' ? head.workspaceRevision : reuse ? prior.workspace[name] : freeze(clone(structure.metadata[name])),
  });
  return freeze({ ownerId, sourceGeneration: head.sourceGeneration, structureRevision: head.structureRevision, nativeRevision: revision(nativeRevision), workspace: freeze(workspace),
    workspaceSha256: crypto.createHash('sha256').update(JSON.stringify(workspace), 'utf8').digest('hex') });
}

function createCollectionCommittedSource({ db, actorId, assertAuthority, verifyDurability }) {
  id(actorId);
  if (typeof db?.privateRecordTransaction !== 'function' || typeof assertAuthority !== 'function') fail('EXISTING_NATIVE_ADAPTER_REQUIRED');
  const views = new Map(), epochs = new Map(), highWater = new Map();
  function binding(value) {
    id(value.ownerId); revision(value.sourceGeneration);
    if (own(value, 'clientGeneration')) revision(value.clientGeneration);
    return { ownerId: value.ownerId, sourceGeneration: value.sourceGeneration, ...(own(value, 'clientGeneration') ? { clientGeneration: value.clientGeneration } : {}), ...(value.transactionId ? { transactionId: value.transactionId } : {}) };
  }
  function checkAuthority(result, request, edit) {
    if (!result || result.ownerId !== request.ownerId || result.sourceGeneration !== request.sourceGeneration || (own(request, 'clientGeneration') && result.clientGeneration !== request.clientGeneration) || result.canView !== true || (edit && result.canEdit !== true)) fail('AUTHORITY_CHANGED');
  }
  async function authority(request, phase, edit) { checkAuthority(await assertAuthority({ ...request, actorId, phase }), request, edit); }
  function invalidate(ownerId) { views.delete(ownerId); epochs.set(ownerId, (epochs.get(ownerId) || 0) + 1); }
  function get(request) {
    const view = views.get(request.ownerId);
    if (!view) fail('COLLECTION_SOURCE_UNAVAILABLE');
    if (view.sourceGeneration !== request.sourceGeneration) fail('SOURCE_GENERATION_CHANGED');
    return view;
  }
  function publish(request, candidate, epoch) {
    // Bir hata/retirement/refresh sınırından önce başlayan ACK geri dönemez.
    if ((epochs.get(request.ownerId) || 0) !== epoch) return;
    const prior = highWater.get(request.ownerId);
    if (prior && (candidate.sourceGeneration < prior.sourceGeneration || candidate.nativeRevision < prior.nativeRevision)) return;
    if (prior && candidate.nativeRevision === prior.nativeRevision && candidate.workspaceSha256 !== prior.workspaceSha256) fail('COLLECTION_SOURCE_INTEGRITY');
    highWater.set(request.ownerId, candidate); views.set(request.ownerId, candidate);
  }
  async function verify(state) {
    if (typeof verifyDurability !== 'function') fail('COMMITTED_READ_ADAPTER_REQUIRED');
    const proof = await verifyDurability({ db, state });
    if (proof?.verified !== true || proof.nativeRevision !== state.revision) fail('COMMITTED_READ_VERIFICATION_FAILED');
  }
  async function refresh(input) {
    const request = binding(clone(input));
    invalidate(request.ownerId);
    const epoch = epochs.get(request.ownerId), exitRead = new Error('PRIVATE_COMMITTED_READ');
    let candidate;
    try {
      try {
        await db.privateRecordTransaction(async state => {
          await authority(request, 'refresh', false);
          await verify(state);
          candidate = capture(state, request.ownerId);
          if (candidate.sourceGeneration !== request.sourceGeneration) fail('SOURCE_GENERATION_CHANGED');
          await authority(request, 'pre-publish', false);
          // Prepare'dan çıkış: boş private frame/revision üretme.
          throw exitRead;
        });
        fail('EXISTING_NATIVE_ADAPTER_REQUIRED');
      } catch (error) { if (error !== exitRead) throw error; }
      await authority(request, 'post-refresh', false);
      publish(request, candidate, epoch);
      return { ready: views.get(request.ownerId) === candidate, nativeRevision: candidate.nativeRevision };
    } catch (error) { invalidate(request.ownerId); throw error; }
  }
  async function transaction(input, prepare) {
    const request = binding(input), epoch = epochs.get(request.ownerId) || 0;
    const exitDuplicate = new Error('PRIVATE_COMMITTED_DUPLICATE');
    let result, duplicate = false, candidate, beforeAppend = false;
    try {
      try {
        await db.privateRecordTransaction(async state => {
          try {
            await authority(request, 'prepare', true);
            // Tüm üyeleri, key order'ı ve emekliliği prepare altında doğrula.
            const { head } = context(state, request.ownerId);
            if (head.sourceGeneration !== request.sourceGeneration) fail('SOURCE_GENERATION_CHANGED');
            const prepared = await prepare(state);
            result = clone(prepared.result); duplicate = prepared.duplicate === true;
            if (duplicate) await verify(state);
            candidate = capture(state, request.ownerId, views.get(request.ownerId), duplicate ? null : prepared.records, duplicate ? state.revision : revision(state.revision + 1));
            await authority(request, 'pre-append', true);
            if (duplicate) throw exitDuplicate;
            return prepared;
          } catch (error) { if (error !== exitDuplicate) beforeAppend = true; throw error; }
        });
      } catch (error) { if (error !== exitDuplicate) throw error; }
    } catch (error) {
      invalidate(request.ownerId);
      error.durability = beforeAppend ? 'not-appended-by-service' : 'unknown-retry-same-transaction-id';
      throw error;
    }
    try { await authority(request, 'post-durable', true); }
    catch (_) { invalidate(request.ownerId); return { durable: true, duplicate, visibility: 'withheld' }; }
    try { publish(request, candidate, epoch); }
    catch (error) { invalidate(request.ownerId); error.durability = 'committed-view-unavailable'; throw error; }
    return { durable: true, duplicate, visibility: 'allowed', result };
  }
  async function read(input) {
    const request = binding(clone(input));
    await authority(request, 'read', false);
    return get(request);
  }
  function readSync(input) {
    const request = binding(clone(input));
    const result = assertAuthority({ ...request, actorId, phase: 'read' });
    if (result && typeof result.then === 'function') { Promise.resolve(result).catch(() => {}); fail('ASYNC_AUTHORITY_REQUIRES_READ'); }
    checkAuthority(result, request, false);
    return get(request);
  }
  return Object.freeze({ actorId, refresh, read, readSync, transaction });
}

module.exports = { NS, keys, document, clone, own, fail, id, revision, rowId, rowRevision, canonical, digest, same, slot, checkSlot, context, load, assertField, decodeWorkspace, createCollectionCommittedSource };
