'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCollectionPermissionsStore } = require('../server/lib/collection-permissions-store');
const { createCollectionReplication } = require('../server/lib/collection-replication');

function eperm(message = 'simulated Windows rename lock') {
  const error = new Error(`EPERM: ${message}`);
  error.code = 'EPERM';
  return error;
}

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-eperm-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const profiles = [{ id: 'owner-a', enabled: true, displayName: 'Owner A' }];
  const permissions = createCollectionPermissionsStore({
    file: path.join(root, 'collection-permissions.json'),
    getProfiles: () => profiles,
    getSharedSyncRoot: async () => path.join(root, 'shared'),
  });
  await permissions.ensure();
  const workspace = {
    schemaVersion: 1,
    ownerId: 'owner-a',
    initialized: true,
    _revision: 1,
    rows: [{ id: 1, _rev: 1, note: 'saved locally' }],
    manufacturers: [],
    customColumns: [],
    nextId: 2,
  };
  return { root, permissions, workspace };
}

test('Collection replication state transient EPERM rename kilidini retry ederek tamamlar', async t => {
  const { root, permissions, workspace } = await fixture(t);
  const stateFile = path.join(root, 'local', 'collection-replication-state.json');
  const replication = createCollectionReplication({
    workspaces: {
      loadWorkspace: () => workspace,
      replaceWorkspaceReplica: async () => ({ applied: false }),
    },
    permissions,
    getSharedSyncRoot: async () => path.join(root, 'shared'),
    stateFile,
  });

  const originalRename = fsp.rename;
  let attempts = 0;
  fsp.rename = async (from, to) => {
    if (path.resolve(to) === path.resolve(stateFile)) {
      attempts += 1;
      if (attempts <= 2) throw eperm();
    }
    return originalRename(from, to);
  };
  try {
    const result = await replication.publishOwner('owner-a');
    assert.equal(result.published, true);
  } finally {
    fsp.rename = originalRename;
  }

  assert.equal(attempts, 3, 'iki geçici EPERM sonrası üçüncü rename başarılı olmalı');
  const status = await replication.status('owner-a');
  assert.equal(status.ok, true);
  assert.equal(status.state, 'up-to-date');

  const localDir = path.dirname(stateFile);
  const leftovers = (await fsp.readdir(localDir)).filter(name => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'başarılı retry sonrası geçici state dosyası kalmamalı');
});

test('Collection JSON yazımı Windows fsync EPERM durumunda gerçek yazmayı kaybetmez', async t => {
  const { root, permissions, workspace } = await fixture(t);
  const stateFile = path.join(root, 'local', 'collection-replication-state.json');
  const replication = createCollectionReplication({
    workspaces: {
      loadWorkspace: () => workspace,
      replaceWorkspaceReplica: async () => ({ applied: false }),
    },
    permissions,
    getSharedSyncRoot: async () => path.join(root, 'shared'),
    stateFile,
  });

  const originalOpen = fsp.open;
  let syncFailures = 0;
  fsp.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (!String(args[0]).endsWith('.tmp')) return handle;
    const originalSync = handle.sync.bind(handle);
    handle.sync = async () => {
      syncFailures += 1;
      if (syncFailures === 1) throw eperm('simulated fsync rejection');
      return originalSync();
    };
    return handle;
  };
  try {
    const result = await replication.publishOwner('owner-a');
    assert.equal(result.published, true);
  } finally {
    fsp.open = originalOpen;
  }

  assert.ok(syncFailures >= 1);
  const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  assert.equal(state.owners['owner-a'].state, 'up-to-date');
  assert.equal(state.owners['owner-a'].remoteRevision, 1);
});
