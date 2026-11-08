'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createLocalDb } = require('../../server/lib/local-db');
const { assertHeldFileLeasesAsync } = require('../../server/lib/shared-file-transaction');
const copy = value => JSON.parse(JSON.stringify(value));
const S = value => ({ present: true, value });
const absent = { present: false };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// TEST ONLY: proposed root durability adapter, inside the existing native lease.
// It syncs real files, validates both WAL generations, and appends no frame.
async function verifyDurability({ db, state }) {
  await assertHeldFileLeasesAsync();
  const file = db.getFile();
  for (const suffix of ['', '.wal', '.wal.bak']) {
    let handle;
    try {
      handle = await fs.open(file + suffix, 'r+');
      const bytes = await handle.readFile('utf8');
      if (!suffix) JSON.parse(bytes);
      else for (const line of bytes.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line);
        const hash = crypto.createHash('sha256').update(JSON.stringify({ v: entry.v, op: entry.op, payload: entry.payload })).digest('hex');
        if (entry.v !== 1 || !entry.op || hash !== entry.sha256) throw Object.assign(new Error('WAL integrity'), { code: 'DATA_INTEGRITY_ERROR' });
      }
      await handle.sync();
    } catch (error) { if (error.code !== 'ENOENT' || !suffix) throw error; }
    finally { if (handle) await handle.close(); }
  }
  const directory = await fs.open(path.dirname(file), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  await assertHeldFileLeasesAsync();
  return { verified: true, nativeRevision: state.revision };
}

function workspace() {
  return { _revision: 10, rows: [
    { id: '1', cx_a: 'base', unknown: { retain: [false, null, 0] } },
    { id: 2, _rev: 4, cx_a: 'peer' },
  ], customColumns: ['a', 'b'].map(k => ({ k: 'cx_' + k, custom: true, type: 'text' })), nextId: 3, unknown: { header: true } };
}
async function fixture(t, { initial = workspace(), adopt = true, verify = verifyDurability } = {}) {
  const lib = require('../../server/lib/collection-delta-commit');
  const { createCollectionCommittedSource } = require('../../server/lib/collection-committed-source');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-committed-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'BuyerLogLocal.db');
  const db = createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024 });
  const key = lib.keys('alice'), metadata = copy(initial);
  delete metadata.rows; delete metadata._revision;
  if (adopt) await db.privateRecordTransaction(() => ({ records: {
    [key.head]: lib.document({ schema: 1, type: 'head', ownerId: 'alice', sourceGeneration: 7, structureRevision: 10, workspaceRevision: initial._revision }),
    [key.structure]: lib.document({ schema: 1, type: 'structure', ownerId: 'alice', metadata, workspaceKeys: Object.keys(initial), rowIds: initial.rows.map(row => String(row.id)) }),
    ...Object.fromEntries(initial.rows.map(row => [key.row(row.id), lib.document({ schema: 1, type: 'row', ownerId: 'alice', structureRevision: 10, value: copy(row), fieldRevisions: {} })])),
  } }));
  await db.queuePatch({ id: 'store:collection-workspaces/alice.json', patch: copy(initial) });
  let hook;
  const phases = [];
  const assertAuthority = context => {
    phases.push(context.phase);
    return hook ? hook(context) : { ownerId: 'alice', sourceGeneration: 7, canView: true, canEdit: true };
  };
  const source = createCollectionCommittedSource({ db, actorId: 'editor', assertAuthority, verifyDurability: verify });
  const service = lib.createCollectionDeltaService({ source });
  const binding = { ownerId: 'alice', sourceGeneration: 7 };
  return { ...lib, db, source, service, directory, file, key, binding, initial, phases, assertAuthority,
    setAuthority: fn => { hook = fn; },
    request: (transactionId, incoming = 'next', extra = {}) => ({ version: 1, namespace: lib.NS, ...binding, baseStructureRevision: 10, transactionId, mode: 'row-cas-v1', patches: [{ rowId: '1', field: 'cx_a', baseRowRevision: 0, base: S('base'), incoming: S(incoming) }], ...extra }),
    cold: () => createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024 }),
    wal: () => fs.readFile(file + '.wal'),
  };
}
module.exports = { fixture, workspace, verifyDurability, S, absent, copy, deferred, createLocalDb };
