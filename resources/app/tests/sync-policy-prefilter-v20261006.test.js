'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const sharedSyncPolicy = require('../server/lib/shared-sync-policy');
const { filterCollectionWorkspaceDeltas } = require('../server/lib/collection-replication');

function outgoingFilter(deltas) {
  return sharedSyncPolicy.filterDeltas(filterCollectionWorkspaceDeltas(deltas), 'outgoing');
}

test('oversized legacy Collection delta is filtered before deep clone and cannot block Shared Sync', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-prefilter-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({
    localDataRoot: path.join(root, 'settings'),
    localDb: db,
    filterOutgoingDeltas: outgoingFilter,
    filterIncomingDeltas: outgoingFilter,
  });

  await sync.save(shared);
  const legacyId = 'store:collection-workspaces/owner-a.json';
  await db.queuePatch({ id: legacyId, patch: { __simulateOversize: true, rows: [{ id: 1, plmId: 'LEGACY' }] } });
  await db.queuePatch({ id: 'cp-order:1001', patch: { notes: { Notes: 'safe' } } });

  const originalStringify = JSON.stringify;
  JSON.stringify = function patchedStringify(value, ...args) {
    if (value && value.id === legacyId && value.patch && value.patch.__simulateOversize) {
      throw new RangeError('Invalid string length');
    }
    return originalStringify.call(JSON, value, ...args);
  };

  let result;
  try {
    result = await sync.syncOnce();
  } finally {
    JSON.stringify = originalStringify;
  }

  assert.equal(result.online, true, result.lastError || 'sync should stay online');
  assert.equal(result.lastError, null);
  assert.equal(await db.pendingCount(), 0, 'filtered legacy event and safe event should both leave pending queue');

  const changesRoot = path.join(shared, 'BUYER_LOG_SYNC', 'changes');
  assert.equal(fs.existsSync(changesRoot), true);
});
