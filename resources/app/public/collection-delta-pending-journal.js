(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./collection-delta-commands.js'));
  else root.BLCollectionDeltaPendingJournal = factory(root.BLCollectionDeltaCommands);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (delta) {
'use strict';

// Inactive candidate. Synchronous Storage API completion is not fsync.
// Storage, current view/source, and the certified command API belong to the host.
const FORMAT_VERSION = 1;
const FORMAT = 'collection-pending-journal-candidate';
const DEFAULT_LIMITS = Object.freeze({ checkpointEvery: 32, maxOperations: 256, maxRequests: 256,
  maxOverlayRows: 1024, maxRecordBytes: 256 * 1024, maxCheckpointBytes: 2 * 1024 * 1024,
  maxRetainedBytes: 4 * 1024 * 1024, maxEvents: 1024, maxCheckpoints: 32, maxBindingBytes: 16 * 1024 * 1024 });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const rowId = row => String(row.id);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function identifier(value) { if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail('INVALID_ID'); return value; }
function token(value) { identifier(value); if (!/^[A-Za-z0-9_-]{1,96}$/.test(value)) fail('INVALID_STORAGE_ID'); return value; }
function bytes(value) { return new TextEncoder().encode(value).byteLength; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Accidental corruption detector only. No authenticity or server authority claim.
function checksum(text) {
  let result = 2166136261;
  for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
  return (result >>> 0).toString(16).padStart(8, '0');
}
function encode(data) {
  const content = JSON.stringify(data);
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, checksum: checksum(content), data });
}
function decode(raw) {
  if (typeof raw !== 'string') fail('MISSING_RECORD');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { fail('CORRUPT_RECORD'); }
  if (parsed?.format !== FORMAT) fail('UNRECOGNIZED_FORMAT');
  if (parsed.version !== FORMAT_VERSION) fail('UNSUPPORTED_JOURNAL_VERSION');
  if (!own(parsed, 'data') || checksum(JSON.stringify(parsed.data)) !== parsed.checksum) fail('CORRUPT_RECORD');
  return parsed.data;
}
function createWebStorage(storage) {
  for (const name of ['getItem', 'setItem']) if (typeof storage?.[name] !== 'function') fail('STORAGE_REQUIRED');
  const sync = result => { if (result && typeof result.then === 'function') fail('SYNCHRONOUS_STORAGE_REQUIRED'); return result; };
  return { getItem: key => sync(storage.getItem(key)), setItem: (key, value) => sync(storage.setItem(key, value)) };
}
function currentBinding(getCurrent) {
  const value = getCurrent();
  if (!value || value.canEdit !== true || value.view !== 'single' || value.ownerId === '__multi__') fail('CURRENT_BINDING_CHANGED');
  identifier(value.ownerId); identifier(value.sourceId);
  if (!Number.isSafeInteger(value.clientGeneration) || value.clientGeneration < 0) fail('INVALID_GENERATION');
  return { ownerId: value.ownerId, clientGeneration: value.clientGeneration, sourceId: value.sourceId, view: 'single', canEdit: true };
}
function touched(command, closure = false) {
  if (command.kind === delta.UNIT) return [command.rowId];
  if (command.kind !== 'collection.group-field-semantic-unit') fail('UNSUPPORTED_SEMANTIC_UNIT');
  return (closure ? command.closure.members : command.patches).map(item => item.rowId);
}

function createPendingJournal({ storage, api = delta, getCurrent, keyPrefix = 'bl.collection.pending-journal.candidate.v1.', legacyKey, limits = {} }) {
  if (!delta || typeof getCurrent !== 'function') fail('DEPENDENCIES_REQUIRED');
  for (const name of ['createState', 'materializeLegacyRequest', 'acknowledgeLegacyResponse']) if (typeof api?.[name] !== 'function') fail('COMMAND_API_REQUIRED');
  if (!keyPrefix.startsWith('bl.collection.pending-journal.candidate.')) fail('CANDIDATE_NAMESPACE_REQUIRED');
  identifier(legacyKey);
  const store = createWebStorage(storage), caps = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, value] of Object.entries(caps)) if (!own(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1) fail('INVALID_LIMIT');
  const current = currentBinding(getCurrent), slot = keyPrefix + encodeURIComponent(current.ownerId), headKey = slot + '/head';
  const deliveries = new WeakSet();
  let state, base, head, headRaw = null;
  let rowOverlay = new Map(), baselineOverlay = new Map(), pendingBases = new Map(), requests = new Map();
  const path = (kind, id) => slot + '/' + kind + '/' + base.bindingId + '/' + id;
  function guard() { if (!same(currentBinding(getCurrent), current)) fail('CURRENT_BINDING_CHANGED'); }
  function writer() { guard(); if (store.getItem(headKey) !== headRaw) fail('WRITER_CHANGED'); }
  function opened() { guard(); if (!state) fail('NOT_OPEN'); }
  function apiSpec(rows, baselineRows = rows) {
    return { ownerId: base.origin.ownerId, clientGeneration: base.origin.clientGeneration, rows, baselineRows,
      customColumns: base.customColumns, workspaceRevision: base.workspaceRevision, nextId: base.nextId,
      historyLimits: base.historyLimits, view: 'single', canEdit: true };
  }
  function apply(before, command) { return api.applyCommand ? api.applyCommand(before, command) : api.applyFieldCommand(before, command); }
  function setHead(next) {
    const raw = encode(next);
    store.setItem(headKey, raw);
    head = next; headRaw = raw;
  }
  function assertBudget(extra) { if (head.retainedBytes + extra > caps.maxRetainedBytes) fail('RETENTION_LIMIT'); }
  function captureRows(before, ids, baseline = false) {
    const wanted = new Set(ids);
    return baseline ? ids.map(id => before.baseline.get(id)) : before.rows.filter(row => wanted.has(rowId(row)));
  }
  function updateOverlay(before, after, ids) {
    const wanted = new Set(ids);
    for (const row of after.rows) if (wanted.has(rowId(row))) rowOverlay.set(rowId(row), row);
    for (const id of ids) baselineOverlay.set(id, after.baseline.get(id));
  }
  function captureDelivery(entry) {
    const delivery = Object.freeze({ request: entry.request, context: Object.freeze({ ...current }) });
    deliveries.add(delivery); return delivery;
  }
  function deliveryEntry(delivery) {
    opened();
    if (!deliveries.has(delivery) || !same(delivery.context, current)) fail('DELIVERY_CAPTURE_REQUIRED');
    const entry = requests.get(delivery.request.requestId);
    if (!entry || entry.request !== delivery.request) fail('DELIVERY_CAPTURE_REQUIRED');
    return entry;
  }
  function reify(saved) {
    const source = api.createState(apiSpec(saved.source.rows, saved.source.baseRows));
    source.operations = new Map(saved.request.commands.map(command => [command.operationId, { command, status: 'pending' }]));
    const request = api.materializeLegacyRequest(source, saved.request.commands.map(command => command.operationId),
      { requestId: saved.request.requestId, atomic: saved.request.payload.atomic === true });
    if (!same(request, saved.request)) fail('CORRUPT_REQUEST_CAPTURE');
    return { request, source: saved.source };
  }
  function checkpointData() {
    return { sequence: head.sequence, rowOverlay: [...rowOverlay], baselineOverlay: [...baselineOverlay],
      operations: [...state.operations], history: state.history, workspaceRevision: state.workspaceRevision,
      pendingBases: [...pendingBases], requests: [...requests.values()] };
  }
  function compact() {
    opened(); writer();
    if (head.checkpoints >= caps.maxCheckpoints) fail('RETENTION_LIMIT');
    const raw = encode(checkpointData());
    if (bytes(raw) > caps.maxCheckpointBytes) fail('CHECKPOINT_TOO_LARGE');
    assertBudget(bytes(raw));
    const key = path('checkpoint', head.checkpoints + 1);
    store.setItem(key, raw); // Old base/events/head are retained on either failure.
    writer();
    setHead({ ...head, checkpoint: { key, sequence: head.sequence, hash: checksum(raw) }, checkpoints: head.checkpoints + 1,
      retainedBytes: head.retainedBytes + bytes(raw) });
    guard();
    return { localRecorded: true, storageGuarantee: 'storage-api-success', sequence: head.sequence };
  }
  function append(event, publish) {
    opened(); writer();
    if (head.sequence >= caps.maxEvents) fail('RETENTION_LIMIT');
    if (head.sequence - (head.checkpoint?.sequence || 0) >= caps.checkpointEvery) compact();
    const data = { sequence: head.sequence + 1, previous: head.hash, event }, raw = encode(data);
    if (bytes(raw) > caps.maxRecordBytes) fail('RECORD_TOO_LARGE');
    assertBudget(bytes(raw));
    store.setItem(path('event', data.sequence), raw);
    writer();
    setHead({ ...head, sequence: data.sequence, hash: checksum(raw), retainedBytes: head.retainedBytes + bytes(raw) });
    publish();
    // If the view changed during a write, retain the old owner's committed data
    // but do not emit a secured result into the newly selected view.
    guard();
    return { localRecorded: true, storageGuarantee: 'storage-api-success', sequence: head.sequence };
  }
  function record(command) {
    opened(); writer();
    const next = apply(state, command);
    if (next === state) return { localRecorded: true, duplicate: true, storageGuarantee: 'storage-api-success' };
    if (next.operations.size > caps.maxOperations) fail('RETENTION_LIMIT');
    const ids = touched(command), union = new Set([...rowOverlay.keys(), ...ids]);
    if (union.size > caps.maxOverlayRows) fail('RETENTION_LIMIT');
    const bases = clone(captureRows(state, ids, true)), before = state;
    return append({ type: 'edit', command, bases }, () => {
      state = next; pendingBases.set(command.operationId, bases); updateOverlay(before, next, ids);
    });
  }
  function prepareRequest(operationIds, options) {
    opened(); writer();
    const requestId = identifier(options?.requestId), previous = requests.get(requestId);
    if (previous) {
      if (!same(previous.request.commands.map(command => command.operationId), operationIds) || (previous.request.payload.atomic === true) !== (options.atomic === true)) fail('REQUEST_ID_REUSED');
      return captureDelivery(previous);
    }
    if (requests.size >= caps.maxRequests) fail('RETENTION_LIMIT');
    const request = api.materializeLegacyRequest(state, operationIds, options);
    const ids = [...new Set(request.commands.flatMap(command => touched(command, true)))];
    const entry = { request, source: clone({ rows: captureRows(state, ids), baseRows: captureRows(state, ids, true) }) };
    append({ type: 'request', entry }, () => requests.set(requestId, entry));
    return captureDelivery(entry);
  }
  function acknowledgePrimary(delivery, response) {
    const entry = deliveryEntry(delivery); writer();
    const next = api.acknowledgeLegacyResponse(state, entry.request, response);
    const primaryAcknowledged = entry.request.commands.some(command => next.operations.get(command.operationId)?.status === 'acknowledged');
    if (next === state) return { primaryAcknowledged, localRecorded: true, duplicate: primaryAcknowledged, replication: response.replication ?? null };
    const receipt = clone(response), before = state, sequenceBefore = head.sequence, ids = [...new Set(entry.request.commands.flatMap(command => touched(command)))];
    try {
      const recorded = append({ type: 'ack', requestId: entry.request.requestId, response: receipt }, () => {
        state = next; updateOverlay(before, next, ids);
      });
      return { ...recorded, primaryAcknowledged, replication: response.replication ?? null };
    } catch (error) {
      error.primaryAcknowledged = primaryAcknowledged; error.localRecorded = head.sequence > sequenceBefore; throw error;
    }
  }
  function bindAccepted(spec) {
    writer(); if (state || headRaw !== null) fail('ALREADY_BOUND');
    if (store.getItem(legacyKey) !== null) fail('LEGACY_PENDING_REQUIRES_IMPORT');
    token(spec.bindingId);
    if (own(spec, 'pendingIntent') || own(spec, 'baselineRows')) fail('ACCEPTED_SOURCE_ONLY');
    // Certified API validates lossless JSON before any serialization/storage.
    const checked = api.createState({ ...spec, ownerId: current.ownerId, clientGeneration: current.clientGeneration });
    const candidate = { bindingId: spec.bindingId, origin: current, rows: checked.rows,
      customColumns: checked.customColumns, workspaceRevision: checked.workspaceRevision, nextId: checked.nextId,
      historyLimits: { maxEntries: checked.history.maxEntries, maxBytes: checked.history.maxBytes },
      baseStructure: spec.baseStructure, metadata: spec.metadata || {} };
    // capturePendingIntent verifies metadata/structure JSON without 30k quadratic
    // legacy row classification; accepted rows were validated by createState.
    delta.capturePendingIntent({ schemaVersion: 2, ownerId: current.ownerId, rows: [], baseRows: [],
      baseStructure: spec.baseStructure, metadata: candidate.metadata }, current);
    const raw = encode(candidate);
    if (bytes(raw) > caps.maxBindingBytes) fail('BINDING_TOO_LARGE');
    const baseKey = slot + '/base/' + spec.bindingId;
    if (store.getItem(baseKey) !== null) fail('ORPHAN_BINDING_EXISTS');
    store.setItem(baseKey, raw); writer();
    setHead({ ownerId: current.ownerId, bindingId: spec.bindingId, baseKey, baseHash: checksum(raw), sequence: 0, hash: checksum(raw),
      checkpoint: null, checkpoints: 0, retainedBytes: 0 });
    base = JSON.parse(raw).data;
    state = api.createState(apiSpec(base.rows));
    guard();
    return { localRecorded: true, storageGuarantee: 'storage-api-success' };
  }
  function replay(event) {
    if (event.type === 'edit') {
      const next = apply(state, event.command), ids = touched(event.command);
      pendingBases.set(event.command.operationId, event.bases); updateOverlay(state, next, ids); state = next;
    } else if (event.type === 'request') {
      const entry = reify(event.entry); requests.set(entry.request.requestId, entry);
    } else if (event.type === 'ack') {
      const entry = requests.get(event.requestId); if (!entry) fail('MISSING_REQUEST');
      const next = api.acknowledgeLegacyResponse(state, entry.request, event.response);
      updateOverlay(state, next, [...new Set(entry.request.commands.flatMap(command => touched(command)))]); state = next;
    } else fail('UNSUPPORTED_EVENT');
  }
  function open() {
    guard(); if (state) fail('ALREADY_BOUND');
    headRaw = store.getItem(headKey); head = decode(headRaw);
    if (head.ownerId !== current.ownerId) fail('OWNER_CHANGED');
    const baseRaw = store.getItem(head.baseKey);
    base = decode(baseRaw);
    if (checksum(baseRaw) !== head.baseHash) fail('CORRUPT_BINDING');
    if (base.origin.ownerId !== current.ownerId || base.bindingId !== head.bindingId) fail('OWNER_CHANGED');
    if (head.sequence > caps.maxEvents || head.retainedBytes > caps.maxRetainedBytes || head.checkpoints > caps.maxCheckpoints) fail('RETENTION_LIMIT');
    state = api.createState(apiSpec(base.rows));
    let start = 1, previous = checksum(store.getItem(head.baseKey));
    try {
      if (head.checkpoint) {
        const checkpointRaw = store.getItem(head.checkpoint.key), checkpoint = decode(checkpointRaw);
        if (checksum(checkpointRaw) !== head.checkpoint.hash) fail('CORRUPT_CHECKPOINT');
        if (checkpoint.sequence !== head.checkpoint.sequence || checkpoint.sequence > head.sequence) fail('CORRUPT_CHECKPOINT');
        rowOverlay = new Map(checkpoint.rowOverlay); baselineOverlay = new Map(checkpoint.baselineOverlay);
        const rows = base.rows.map(row => rowOverlay.get(rowId(row)) || row), bases = base.rows.map(row => baselineOverlay.get(rowId(row)) || row);
        state = api.createState(apiSpec(rows, bases));
        state.operations = new Map(checkpoint.operations); state.history = checkpoint.history; state.workspaceRevision = checkpoint.workspaceRevision;
        pendingBases = new Map(checkpoint.pendingBases); requests = new Map(checkpoint.requests.map(saved => { const entry = reify(saved); return [entry.request.requestId, entry]; }));
        start = checkpoint.sequence + 1;
        // Retained prefix also binds the checkpoint to the same append chain.
        previous = start === 1 ? previous : checksum(store.getItem(path('event', start - 1)) || '');
      }
      for (let sequence = start; sequence <= head.sequence; sequence++) {
        const raw = store.getItem(path('event', sequence)), record = decode(raw);
        if (record.sequence !== sequence || record.previous !== previous) fail('CORRUPT_CHAIN');
        replay(record.event); previous = checksum(raw);
      }
      if (previous !== head.hash) fail('CORRUPT_CHAIN');
      if (state.operations.size > caps.maxOperations || requests.size > caps.maxRequests || rowOverlay.size > caps.maxOverlayRows) fail('RETENTION_LIMIT');
      writer();
      return { localRecorded: true, route: 'candidate-original-source', origin: clone(base.origin), current: clone(current) };
    } catch (error) { state = undefined; throw error; }
  }
  function archiveLegacy(raw, { archiveId }) {
    guard(); token(archiveId);
    if (typeof raw !== 'string') fail('CORRUPT_LEGACY_PENDING');
    let pending; try { pending = JSON.parse(raw); } catch (_) { fail('CORRUPT_LEGACY_PENDING'); }
    if (![1, 2].includes(pending?.schemaVersion)) fail('UNSUPPORTED_LEGACY_VERSION');
    if (own(pending, 'candidateJournal') && (pending.candidateJournal?.format !== FORMAT || pending.candidateJournal.version !== FORMAT_VERSION)) fail('UNSUPPORTED_JOURNAL_VERSION');
    const capture = delta.capturePendingIntent(pending, current);
    // One immutable legacy archive per owner slot; no growing import ledger.
    const key = slot + '/legacy', encoded = encode({ archiveId, raw, capture });
    if (store.getItem(key) !== null) fail('ARCHIVE_EXISTS');
    if (bytes(encoded) > caps.maxBindingBytes) fail('BINDING_TOO_LARGE');
    store.setItem(key, encoded); guard();
    return { route: 'legacy-only', localRecorded: true, capture, raw };
  }
  function exportLegacy({ schemaVersion = 2 } = {}) {
    opened(); if (![1, 2].includes(schemaVersion)) fail('UNSUPPORTED_LEGACY_VERSION');
    const bases = new Map(state.baseline), original = new Map();
    for (const [id, entry] of state.operations) if (entry.status === 'pending') {
      for (const row of pendingBases.get(id)) if (!original.has(rowId(row))) original.set(rowId(row), row);
    }
    for (const [id, row] of original) bases.set(id, row);
    const rows = state.rows.map(row => {
      const source = original.get(rowId(row)); if (!source) return row;
      const next = { ...row }; if (own(source, '_rev')) next._rev = source._rev; else delete next._rev; return next;
    });
    return clone({ ...base.metadata, schemaVersion, ownerId: base.origin.ownerId, baseRevision: base.workspaceRevision,
      baseStructure: base.baseStructure, ...(schemaVersion === 2 ? { baseRows: [...bases.values()] } : {}),
      expectedExistingIds: [...bases.keys()], expectedNewIds: [], rows, customColumns: base.customColumns, nextId: state.nextId,
      status: 'pending', candidateJournal: { format: FORMAT, version: FORMAT_VERSION, origin: base.origin,
        operations: [...state.operations], pendingBases: [...pendingBases], requests: [...requests.values()], history: state.history } });
  }
  return { bindAccepted, open, record, prepareRequest, acknowledgePrimary, compact, archiveLegacy, exportLegacy,
    getState() { opened(); return state; },
    retry(requestId) { opened(); writer(); const entry = requests.get(requestId); if (!entry) fail('MISSING_REQUEST'); return captureDelivery(entry); },
    noteReplication(delivery, replication) { deliveryEntry(delivery); return { primaryAcknowledged: false, replication, historyAdvanced: false }; },
    exportArchivedLegacy(archiveId) { guard(); token(archiveId); const archive = decode(store.getItem(slot + '/legacy')); if (archive.archiveId !== archiveId) fail('MISSING_ARCHIVE'); return archive.raw; },
    status() { opened(); return { origin: clone(base.origin), current: clone(current), sequence: head.sequence, checkpoints: head.checkpoints,
      operations: state.operations.size, requests: requests.size, overlayRows: rowOverlay.size, retainedBytes: head.retainedBytes, limits: { ...caps } }; },
  };
}
return { FORMAT_VERSION, DEFAULT_LIMITS, createWebStorage, createPendingJournal };
});
