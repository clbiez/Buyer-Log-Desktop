'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDeltaStore } = require('../server/lib/delta-store');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { isClientRequestAborted } = require('../server/lib/http-errors');

function busyError() {
  return Object.assign(new Error('Shared data is being updated by another Buyer Log instance. Please retry.'), {
    code: 'SHARED_WRITE_BUSY',
    statusCode: 409,
  });
}

test('delta mirror transient shared-file contention is retried before reporting failure', async () => {
  let attempts = 0;
  const reported = [];
  const localDb = {
    queuePatches: async () => {
      attempts += 1;
      if (attempts < 3) throw busyError();
      return { count: 1 };
    },
  };
  const store = createDeltaStore({ localDb, onError: (stage, error) => reported.push({ stage, error }) });

  const result = await store.mirror('plm-style-link', { '1001': { styleId: '55501' } });

  assert.equal(result.ok, true);
  assert.equal(result.mirrored, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(reported, []);
});

test('client request abort is distinct from an application error', () => {
  assert.equal(isClientRequestAborted({ type: 'request.aborted' }), true);
  assert.equal(isClientRequestAborted({ code: 'ECONNABORTED', message: 'request aborted' }), true);
  assert.equal(isClientRequestAborted(new Error('database failed')), false);
});

test('sync worker returns controlled offline state when status persistence fails', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-status-failure-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await sync.save(path.join(root, 'shared'));

  const originalOpen = fsp.open;
  fsp.open = async (...args) => {
    if (String(args[0]).startsWith(`${sync.file}.`)) {
      throw Object.assign(new Error('settings disk unavailable'), { code: 'EACCES' });
    }
    return originalOpen(...args);
  };
  try {
    const result = await sync.syncOnce();
    assert.equal(result.online, false);
    assert.match(result.lastError, /settings disk unavailable/);
  } finally {
    fsp.open = originalOpen;
  }
});
