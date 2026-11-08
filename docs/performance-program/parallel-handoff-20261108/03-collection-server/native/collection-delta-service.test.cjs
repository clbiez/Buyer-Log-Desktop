'use strict';

// PREPARED, UNRUN. Uses byte-for-byte Main1796193f existing local-db sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('./reference/local-db.js');
const sharedPolicy = require('./reference/shared-sync-policy.js');
const { NS, keys, document, readWorkspace, adaptLegacyFullState, createCollectionDeltaService } = require('./collection-delta-service.cjs');
const S = value => ({ present: true, value });
const ABSENT = { present: false };
const copy = value => JSON.parse(JSON.stringify(value));
function workspace() {
  return {
    _revision: 10, nextId: 3,
    customColumns: ['a', 'b', 'c', 'd'].map(name => ({ k: 'cx_' + name, custom: true, type: 'text' })),
    manufacturers: [], unknownHeader: { future: [1, false, null] },
    rows: [{ id: '1', cx_a: 'base', unknownNested: { history: ['retain'] } }, { id: '2', _rev: 4, cx_a: 'peer', unknownNested: { image: 'unchanged' } }],
  };
}
// Explicit TEST-ONLY source adoption. No service API auto-imports any source.
async function fixture(t, initial = workspace(), { adopt = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'collection-native-delta-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'BuyerLogLocal.db');
  const db = createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024 });
  const ownerId = 'alice', key = keys(ownerId);
  const metadata = copy(initial); delete metadata.rows; delete metadata._revision;
  if (adopt) await db.privateRecordTransaction(() => {
    const records = {
      [key.head]: document({ schema: 1, type: 'head', ownerId, sourceGeneration: 7, structureRevision: 10, workspaceRevision: initial._revision }),
      [key.structure]: document({ schema: 1, type: 'structure', ownerId, metadata, rowIds: initial.rows.map(row => String(row.id)) }),
    };
    // The actual API accepts only private documents. Seed legacy generic state
    // separately below with the existing queuePatch API, not a fabricated WAL.
    for (const row of initial.rows) records[key.row(row.id)] = document({ schema: 1, type: 'row', ownerId, structureRevision: 10, value: copy(row), fieldRevisions: {} });
    return { records, result: null };
  });
  await db.queuePatch({ id: 'store:collection-workspaces/alice.json', entityType: 'store', patch: { ...copy(initial), unknownLegacyKey: { retained: true } }, userId: ownerId });
  const phases = [];
  let hook = null;
  const assertAuthority = async request => {
    phases.push(request.phase);
    if (hook) return hook(request);
    return { ownerId: 'alice', sourceGeneration: 7, canEdit: true, canView: true };
  };
  const service = createCollectionDeltaService({ db, actorId: 'editor', assertAuthority });
  return {
    directory, file, db, key, service, assertAuthority, phases,
    setAuthority: callback => { hook = callback; },
    request: (transactionId, patches, mode = 'field-merge-v1') => ({ version: 1, namespace: NS, ownerId, transactionId, sourceGeneration: 7, baseStructureRevision: 10, mode, patches }),
    read: async () => readWorkspace(await db.read(), ownerId),
    wal: () => fs.readFile(file + '.wal').catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error; }),
    cold: () => createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024 }),
  };
}
const patch = (rowId, field, base, incoming, extra = {}) => ({ rowId, field, base, incoming, ...extra });
function inverse(f, transactionId, inverseOf) {
  const request = f.request(transactionId, undefined, 'inverse-fields-v1');
  delete request.patches;
  return { ...request, inverseOf };
}
async function expectCode(promise, code) { await assert.rejects(promise, error => error.code === code); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test('one native private frame contains touched rows plus receipt; legacy mirror and journal survive', async t => {
  const f = await fixture(t);
  const before = await f.db.read(), snapshot = await fs.readFile(f.file), wal = await f.wal();
  const untouched = before.records[f.key.row('2')], nested = before.records[f.key.row('1')].doc.value.unknownNested;
  const legacy = copy(before.records['store:collection-workspaces/alice.json']);
  const journal = copy(before.journal);
  const result = await f.service.commit(f.request('frame', [patch('1', 'cx_a', S('base'), S('edit'))]));
  assert.equal(result.durable, true); assert.equal(result.publication, 'not-attempted');
  const addition = (await f.wal()).subarray(wal.length).toString();
  const frames = addition.trimEnd().split('\n').map(JSON.parse);
  assert.equal(frames.length, 1); assert.equal(frames[0].op, 'private-records');
  assert.deepEqual(Object.keys(frames[0].payload.records).sort(), [f.key.head, f.key.row('1'), f.key.tx('frame')].sort());
  const after = await f.db.read();
  assert.strictEqual(after.records[f.key.row('2')], untouched);
  assert.strictEqual(after.records[f.key.row('1')].doc.value.unknownNested, nested);
  assert.deepEqual(after.records['store:collection-workspaces/alice.json'], legacy);
  assert.deepEqual(after.journal, journal); assert.deepEqual(await fs.readFile(f.file), snapshot);
  const cold = await f.cold().read();
  assert.equal(readWorkspace(cold, 'alice').rows[0].cx_a, 'edit');
  assert.equal(cold.records[f.key.tx('frame')].doc.receipt.transactionId, 'frame');
});

test('actual existing peer and checkpoint policy excludes the new private owner records', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('transport_boundary', [patch('1', 'cx_a', S('base'), S('private'))]));
  const state = await f.db.read();
  const privateRecords = Object.fromEntries(Object.entries(state.records).filter(([key]) => key.startsWith(NS + ':')));
  // Include an ID that triggers the policy's broad SHARED_ASSET classifier.
  const assetOwner = keys('asset_owner');
  privateRecords[assetOwner.tx('asset_tx')] = document({ schema: 1, type: 'transaction', ownerId: 'asset_owner', receipt: { synthetic: 'private' } });
  for (const key of Object.keys(privateRecords)) assert.equal(sharedPolicy.peerChannelAllows(key), false);
  assert.deepEqual(sharedPolicy.businessRecordsFromState({ records: privateRecords }), {});
  assert.deepEqual(sharedPolicy.masterRecordsFromState({ records: privateRecords }), {});
  assert.deepEqual(sharedPolicy.scopeCheckpointRecords('business', privateRecords), {});
  assert.deepEqual(sharedPolicy.scopeCheckpointRecords('master', privateRecords), {});
  assert.deepEqual(sharedPolicy.filterDeltas(Object.keys(privateRecords).map(id => ({ id, patch: { doc: 'must not leave device' } }))), []);
});

test('absence, explicit null, zero and false remain distinct through real disk replay', async t => {
  const f = await fixture(t);
  const values = [S(null), S(0), S(false), ABSENT];
  let previous = ABSENT;
  for (let index = 0; index < values.length; index++) {
    await f.service.commit(f.request('slot_' + index, [patch('1', 'cx_b', previous, values[index])]));
    const row = readWorkspace(await f.cold().read(), 'alice').rows[0];
    assert.equal(Object.hasOwn(row, 'cx_b'), values[index].present);
    if (values[index].present) assert.equal(row.cx_b, values[index].value);
    previous = values[index];
  }
});

test('batch changes row revision once; legacy missing _rev starts at zero', async t => {
  const f = await fixture(t);
  const request = f.request('batch', [patch('1', 'cx_a', S('base'), S('next'), { baseRowRevision: 0 }), patch('1', 'cx_b', ABSENT, S(false), { baseRowRevision: 0 }), patch('2', 'cx_a', S('peer'), S('peer-next'), { baseRowRevision: 4 })], 'row-cas-v1');
  const frozen = JSON.stringify(request);
  const result = await f.service.commit(request);
  assert.equal(result.receipt.applied.length, 3);
  assert.deepEqual((await f.read()).rows.map(row => row._rev), [1, 5]);
  assert.equal(JSON.stringify(request), frozen);
  const restored = await f.service.commit(inverse(f, 'batch_undo', 'batch'));
  assert.equal(restored.receipt.status, 'applied');
  assert.equal(Object.hasOwn((await f.read()).rows[0], 'cx_b'), false);
});

test('row-CAS adaptation rejects stale disjoint field; explicit field merge can accept it', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('first', [patch('1', 'cx_a', S('base'), S('remote'))]));
  const stale = patch('1', 'cx_b', ABSENT, S('local'), { baseRowRevision: 0 });
  const blocked = await f.service.commit(f.request('legacy_stale', [stale], 'row-cas-v1'));
  assert.equal(blocked.receipt.conflicts[0].reason, 'row-revision');
  assert.equal(Object.hasOwn((await f.read()).rows[0], 'cx_b'), false);
  const accepted = await f.service.commit(f.request('explicit_merge', [stale]));
  assert.equal(accepted.receipt.status, 'applied');
  assert.deepEqual([(await f.read()).rows[0].cx_a, (await f.read()).rows[0].cx_b], ['remote', 'local']);
});

test('three-way conflict keeps current and all intent evidence; atomic peer fields do not leak', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('remote', [patch('1', 'cx_a', S('base'), S('remote'))]));
  const result = await f.service.commit(f.request('conflict', [patch('1', 'cx_a', S('base'), S(null)), patch('2', 'cx_a', S('peer'), S('must-not-leak'))]));
  assert.equal(result.receipt.status, 'conflict'); assert.deepEqual(result.receipt.applied, []);
  assert.deepEqual(result.receipt.conflicts[0].base, S('base'));
  assert.deepEqual(result.receipt.conflicts[0].current, S('remote'));
  assert.deepEqual(result.receipt.conflicts[0].incoming, S(null));
  assert.equal((await f.read()).rows[1].cx_a, 'peer');
  assert.deepEqual((await f.cold().read()).conflicts, []);
  const duplicate = await f.service.commit(f.request('conflict', [patch('1', 'cx_a', S('base'), S(null)), patch('2', 'cx_a', S('peer'), S('must-not-leak'))]));
  assert.deepEqual(duplicate.receipt, result.receipt);
});

test('converged incoming and no incoming delta preserve current row revision', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('remote', [patch('1', 'cx_a', S('base'), S('remote'))]));
  for (const [tx, incoming] of [['same_current', S('remote')], ['same_base', S('base')]]) {
    const result = await f.service.commit(f.request(tx, [patch('1', 'cx_a', S('base'), incoming)]));
    assert.equal(result.receipt.status, 'converged');
  }
  assert.equal((await f.read()).rows[0].cx_a, 'remote'); assert.equal((await f.read()).rows[0]._rev, 1);
});

test('inverse preserves a newer unrelated field', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('forward', [patch('1', 'cx_a', S('base'), S('mine'))]));
  await f.service.commit(f.request('other_field', [patch('1', 'cx_b', ABSENT, S('remote'))]));
  const result = await f.service.commit(inverse(f, 'undo', 'forward'));
  assert.equal(result.receipt.status, 'applied');
  assert.deepEqual([(await f.read()).rows[0].cx_a, (await f.read()).rows[0].cx_b], ['base', 'remote']);
});

test('inverse rejects a same-field ABA even when after value matches again', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('forward', [patch('1', 'cx_a', S('base'), S('mine'))]));
  await f.service.commit(f.request('away', [patch('1', 'cx_a', S('mine'), S('away'))]));
  await f.service.commit(f.request('back', [patch('1', 'cx_a', S('away'), S('mine'))]));
  const result = await f.service.commit(inverse(f, 'undo_aba', 'forward'));
  assert.equal(result.receipt.status, 'conflict'); assert.equal(result.receipt.conflicts[0].reason, 'field-revision');
  assert.equal((await f.read()).rows[0].cx_a, 'mine');
});

test('stale owner, source generation and structure fail before a service append', async t => {
  const f = await fixture(t), before = await f.wal();
  const request = f.request('context', [patch('1', 'cx_a', S('base'), S('next'))]);
  await expectCode(f.service.commit({ ...request, ownerId: 'bob' }), 'AUTHORITY_CHANGED');
  await expectCode(f.service.commit({ ...request, sourceGeneration: 8 }), 'AUTHORITY_CHANGED');
  await expectCode(f.service.commit({ ...request, baseStructureRevision: 9 }), 'STRUCTURE_REVISION_CHANGED');
  assert.deepEqual(await f.wal(), before);
});

test('fresh asynchronous pre-append authority denial leaves no transaction or row effects', async t => {
  const f = await fixture(t), before = await f.wal();
  f.setAuthority(async request => ({ ownerId: 'alice', sourceGeneration: 7, canEdit: request.phase !== 'pre-append', canView: true }));
  await expectCode(f.service.commit(f.request('denied', [patch('1', 'cx_a', S('base'), S('next'))])), 'AUTHORITY_CHANGED');
  assert.deepEqual(f.phases, ['prepare', 'pre-append']); assert.deepEqual(await f.wal(), before);
  assert.equal((await f.cold().read()).records[f.key.tx('denied')], undefined);
});

test('revocation after durable append withholds projection; it does not claim rollback', async t => {
  const f = await fixture(t);
  f.setAuthority(async request => ({ ownerId: 'alice', sourceGeneration: 7, canEdit: request.phase !== 'post-durable', canView: true }));
  const result = await f.service.commit(f.request('revoked_after', [patch('1', 'cx_a', S('base'), S('durable'))]));
  assert.equal(result.durable, true); assert.equal(result.visibility, 'withheld'); assert.equal(result.publication, 'not-attempted');
  assert.equal(Object.hasOwn(result, 'receipt'), false);
  assert.deepEqual(f.phases, ['prepare', 'pre-append', 'post-durable']);
  assert.equal(readWorkspace(await f.cold().read(), 'alice').rows[0].cx_a, 'durable');
});

test('concurrent duplicate replay appends once and returns the original durable receipt', async t => {
  const f = await fixture(t), before = await f.wal();
  const request = f.request('duplicate', [patch('1', 'cx_a', S('base'), S('next'))]);
  const results = await Promise.all([f.service.commit(request), f.service.commit(copy(request))]);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.deepEqual(results.map(result => result.duplicate).sort(), [false, true]);
  assert.equal((await f.wal()).subarray(before.length).toString().trimEnd().split('\n').length, 1);
  const bytes = await f.wal(), revision = (await f.db.read()).revision;
  await f.service.commit(Object.fromEntries(Object.entries(request).reverse()));
  assert.deepEqual(await f.wal(), bytes); assert.equal((await f.db.read()).revision, revision);
});

test('same transaction ID with different intent is rejected without rewriting history', async t => {
  const f = await fixture(t);
  await f.service.commit(f.request('collision', [patch('1', 'cx_a', S('base'), S('first'))]));
  const before = await f.wal();
  await expectCode(f.service.commit(f.request('collision', [patch('1', 'cx_a', S('base'), S('second'))])), 'TRANSACTION_ID_REUSED');
  assert.deepEqual(await f.wal(), before);
});

test('lost acknowledgment after actual native fsync retries the same transaction exactly once', async t => {
  const f = await fixture(t), request = f.request('lost_ack', [patch('1', 'cx_a', S('base'), S('saved'))]);
  const adapter = { privateRecordTransaction: async prepare => {
    await f.db.privateRecordTransaction(prepare);
    throw Object.assign(new Error('Synthetic connection lost after durable result'), { code: 'LOST_ACK' });
  } };
  const service = createCollectionDeltaService({ db: adapter, actorId: 'editor', assertAuthority: f.assertAuthority });
  await assert.rejects(service.commit(request), error => error.code === 'LOST_ACK' && error.durability === 'unknown-retry-same-transaction-id');
  const before = await f.wal();
  const retry = await f.service.commit(request);
  assert.equal(retry.duplicate, true); assert.equal(retry.receipt.status, 'applied');
  assert.deepEqual(await f.wal(), before); assert.equal((await f.read()).rows[0]._rev, 1);
});

test('service promise does not report durable success before actual WAL fsync settles', async t => {
  const f = await fixture(t), opened = deferred(), release = deferred(), original = fs.open;
  fs.open = async (file, flags, ...rest) => {
    const handle = await original(file, flags, ...rest);
    if (file !== f.file + '.wal' || flags !== 'a') return handle;
    return { writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle), sync: async () => { opened.resolve(); await release.promise; return handle.sync(); } };
  };
  let settled = false;
  const pending = f.service.commit(f.request('fsync', [patch('1', 'cx_a', S('base'), S('saved'))])).then(result => { settled = true; return result; });
  try {
    await Promise.race([opened.promise, pending.then(() => { throw new Error('Service resolved without entering the WAL fsync gate'); })]);
    assert.equal(settled, false);
    release.resolve();
    assert.equal((await pending).durable, true);
  } finally { release.resolve(); fs.open = original; await pending; }
});

test('native WAL write failure invalidates mutated cache and leaves no partial row/receipt', async t => {
  const f = await fixture(t), before = await f.wal(), original = fs.open;
  fs.open = async (file, flags, ...rest) => {
    const handle = await original(file, flags, ...rest);
    if (file !== f.file + '.wal' || flags !== 'a') return handle;
    return { writeFile: async () => { throw Object.assign(new Error('Synthetic pre-write failure'), { code: 'EIO' }); }, sync: handle.sync.bind(handle), close: handle.close.bind(handle) };
  };
  try { await expectCode(f.service.commit(f.request('failed_write', [patch('1', 'cx_a', S('base'), S('lost'))])), 'EIO'); }
  finally { fs.open = original; }
  assert.deepEqual(await f.wal(), before); assert.equal((await f.read()).rows[0].cx_a, 'base');
  assert.equal((await f.cold().read()).records[f.key.tx('failed_write')], undefined);
});

test('real replay exposes neither half of a torn private frame and accepts complete frame without newline', async t => {
  const f = await fixture(t), prefix = await f.wal();
  await f.service.commit(f.request('cut', [patch('1', 'cx_a', S('base'), S('after'))]));
  const full = await f.wal(), frame = full.subarray(prefix.length);
  for (const length of [0, 1, Math.floor(frame.length / 2), frame.length - 3, frame.length - 1, frame.length]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'collection-replay-cut-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.cp(f.directory, root, { recursive: true });
    const file = path.join(root, 'BuyerLogLocal.db');
    await fs.writeFile(file + '.wal', Buffer.concat([prefix, frame.subarray(0, length)]));
    const state = await createLocalDb(file).read(), complete = length >= frame.length - 1;
    assert.equal(readWorkspace(state, 'alice').rows[0].cx_a, complete ? 'after' : 'base');
    assert.equal(Boolean(state.records[f.key.tx('cut')]), complete);
  }
  assert.deepEqual(await f.wal(), full);
});

test('checksum corruption blocks append without replacing historical WAL bytes', async t => {
  const f = await fixture(t);
  const line = JSON.parse((await f.wal()).toString().trimEnd().split('\n').at(-1));
  line.sha256 = '0'.repeat(64);
  const corrupted = Buffer.from(JSON.stringify(line) + '\n');
  await fs.appendFile(f.file + '.wal', corrupted);
  const before = await f.wal();
  await expectCode(f.service.commit(f.request('blocked_corrupt', [patch('1', 'cx_a', S('base'), S('lost'))])), 'DATA_INTEGRITY_ERROR');
  assert.deepEqual(await f.wal(), before);
});

test('legacy full-state adapter keeps unknown structure, captures row-CAS and blocks structural edits', async t => {
  const f = await fixture(t), base = workspace(), incoming = copy(base);
  incoming.rows[0].cx_b = null;
  const command = adaptLegacyFullState(base, incoming, { ownerId: 'alice', transactionId: 'legacy', sourceGeneration: 7, baseStructureRevision: 10 });
  assert.equal(command.mode, 'row-cas-v1'); assert.equal(command.patches[0].baseRowRevision, 0);
  assert.deepEqual(command.patches[0].base, ABSENT);
  await f.service.commit(command);
  assert.deepEqual((await f.read()).unknownHeader, base.unknownHeader);
  assert.equal(Object.hasOwn(base.rows[0], 'cx_b'), false);
  assert.throws(() => adaptLegacyFullState(base, { ...incoming, rows: [...incoming.rows].reverse() }, {}), { code: 'LEGACY_STRUCTURE_CHANGE_BLOCKED' });
  const notes = copy(base); notes.rows[0].notes = 'rich-note route required';
  assert.throws(() => adaptLegacyFullState(base, notes, {}), { code: 'TYPED_SEMANTIC_UNIT_REQUIRED' });
});

test('old full-state expected workspace CAS is not weakened to disjoint-row acceptance', async t => {
  const f = await fixture(t), base = workspace(), incoming = copy(base);
  incoming.rows[0].cx_b = 'local';
  const command = adaptLegacyFullState(base, incoming, { ownerId: 'alice', transactionId: 'fullstate_cas', sourceGeneration: 7, baseStructureRevision: 10 });
  await f.service.commit(f.request('peer_other_row', [patch('2', 'cx_a', S('peer'), S('remote'))]));
  const before = await f.wal();
  await expectCode(f.service.commit(command), 'WORKSPACE_REVISION_CHANGED');
  assert.deepEqual(await f.wal(), before); assert.equal(Object.hasOwn((await f.read()).rows[0], 'cx_b'), false);
});

test('group and coupled fields fail closed; no scalar substitution into shared/override state', async t => {
  const initial = workspace();
  initial.rows[0].modelGroupId = 'group'; initial.rows[0].modelSharedValues = { cx_a: 'base' };
  const f = await fixture(t, initial), before = await f.wal();
  await expectCode(f.service.commit(f.request('group', [patch('1', 'cx_a', S('base'), S('unsafe'))])), 'TYPED_GROUP_UNIT_REQUIRED');
  await expectCode(f.service.commit(f.request('pricing', [patch('2', 'price', ABSENT, S(4))])), 'TYPED_SEMANTIC_UNIT_REQUIRED');
  await expectCode(f.service.commit(f.request('object', [patch('2', 'cx_b', ABSENT, S({ nested: 'not scalar' }))])), 'TYPED_SEMANTIC_UNIT_REQUIRED');
  assert.deepEqual(await f.wal(), before);
});

test('missing adopted source is explicit; existing generic full-state mirror is not silently imported', async t => {
  const f = await fixture(t, workspace(), { adopt: false });
  const before = await f.wal();
  await expectCode(f.service.commit(f.request('no_handoff', [patch('1', 'cx_a', S('base'), S('unsafe'))])), 'SOURCE_HANDOFF_REQUIRED');
  assert.deepEqual(await f.wal(), before);
  assert.equal((await f.db.read()).records['store:collection-workspaces/alice.json'].rows[0].cx_a, 'base');
});

test('existing snapshot/WAL rotation preserves transaction receipt and inverse field clock on cold replay', async t => {
  const f = await fixture(t), request = f.request('checkpointed', [patch('1', 'cx_a', S('base'), S('saved'))]);
  const forward = await f.service.commit(request);
  // Existing native snapshot path, no direct mutation of private records.
  await f.db.transaction(() => null);
  const cold = f.cold(), service = createCollectionDeltaService({ db: cold, actorId: 'editor', assertAuthority: f.assertAuthority });
  const result = await service.commit(request);
  assert.equal(result.duplicate, true); assert.deepEqual(result.receipt, forward.receipt);
  assert.equal((await service.commit(inverse(f, 'checkpoint_undo', 'checkpointed'))).receipt.status, 'applied');
  assert.equal(readWorkspace(await f.cold().read(), 'alice').rows[0].cx_a, 'base');
});

test('source handoff membership stamp mismatch fails before scalar field mutation', async t => {
  const f = await fixture(t);
  await f.db.privateRecordTransaction(state => ({ records: { [f.key.row('1')]: document({ ...state.records[f.key.row('1')].doc, structureRevision: 9 }) }, result: null }));
  const before = await f.wal();
  await expectCode(f.service.commit(f.request('stale_membership', [patch('1', 'cx_a', S('base'), S('unsafe'))])), 'MEMBERSHIP_CHANGED');
  assert.deepEqual(await f.wal(), before);
});

test('unsupported checklist/coupled companion payload is rejected rather than silently acknowledged', async t => {
  const f = await fixture(t), before = await f.wal();
  const request = f.request('companion', [patch('1', 'cx_a', S('base'), S('unsafe'))]);
  await expectCode(f.service.commit({ ...request, checklistAnswers: { synthetic: { state: 'set', note: 'retain pending' } } }), 'TYPED_SEMANTIC_UNIT_REQUIRED');
  assert.deepEqual(await f.wal(), before);
});

test('Collection batch does not clear separately owned checklist JSON/evidence or pending journal', async t => {
  const f = await fixture(t);
  const checklist = path.join(f.directory, 'checklist-supplier-sync.json'), pending = path.join(f.directory, 'fixture-browser-pending.json');
  const answer = { state: 'set', at: '2026-11-08T00:00:00.000Z', note: 'journal text', report: 'retained', actualDate: '2026-11-07', attachments: [{ id: 'synthetic-evidence' }], componentCount: 2, elements: ['front', 'back'] };
  await fs.writeFile(checklist, JSON.stringify({ schemaVersion: 1, revision: 3, answers: { synthetic: answer }, tombstones: {}, events: [] }));
  await fs.writeFile(pending, JSON.stringify({ synthetic: { entry: answer, ownerId: 'alice' } }));
  const before = await Promise.all([fs.readFile(checklist), fs.readFile(pending)]);
  await f.service.commit(f.request('collection_only', [patch('1', 'cx_a', S('base'), S('edit')), patch('2', 'cx_a', S('peer'), S('peer-edit'))]));
  assert.deepEqual(await Promise.all([fs.readFile(checklist), fs.readFile(pending)]), before);
});
