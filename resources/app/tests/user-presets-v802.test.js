'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const {
  PROFILE_SCHEMA_VERSION,
  normalizeProfileStore,
  resolveFavoriteId,
  setFavorite,
  markUsed,
  removeProfile,
} = require('../server/lib/profile-store');

function item(id, page, extra = {}) {
  return {
    id,
    name: `${page}-${id}`,
    createdAt: `2026-08-${id === 'one' ? '01' : '02'}T00:00:00.000Z`,
    data: { __page: page, ...extra },
  };
}

test('preset store migrates legacy records to user and table scoped metadata', () => {
  const store = normalizeProfileStore({
    favoriteId: 'cp-one',
    items: [
      { ...item('cp-one', 'cp'), data: { __page: 'cp', search: 'MINE' } },
      { ...item('orders-one', 'orders'), data: { __page: 'orders', search: 'KARO' } },
    ],
    _revision: 4,
  }, { userId: 'alice', kind: 'view' });

  assert.equal(store.schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(store.items[0].userId, 'alice');
  assert.equal(store.items[0].moduleId, 'cp');
  assert.equal(store.items[0].tableId, 'cp');
  assert.equal(store.items[0].schemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(resolveFavoriteId(store, 'cp'), 'cp-one');
  assert.equal(resolveFavoriteId(store, 'orders'), 'orders-one');
  assert.equal(store.items[0].data.search, 'MINE');
});

test('favorite is unique per table and never changes another table', () => {
  const initial = normalizeProfileStore({
    items: [item('cp-one', 'cp'), item('cp-two', 'cp'), item('orders-one', 'orders')],
  }, { userId: 'alice', kind: 'filter' });
  const cpFavorite = setFavorite(initial, 'cp-two');

  assert.equal(resolveFavoriteId(cpFavorite, 'cp'), 'cp-two');
  assert.equal(resolveFavoriteId(cpFavorite, 'orders'), 'orders-one');
  assert.equal(cpFavorite.items.find(it => it.id === 'cp-two').isFavorite, true);
  assert.equal(cpFavorite.items.find(it => it.id === 'cp-one').isFavorite, false);
  assert.equal(cpFavorite.items.find(it => it.id === 'orders-one').isFavorite, true);
  assert.equal(Object.keys(cpFavorite.favoriteByPage).length, 2);
});

test('last used preset is retained and deletion resolves a safe fallback', () => {
  const initial = normalizeProfileStore({
    favoriteByPage: { cp: 'cp-one' },
    items: [
      item('cp-one', 'cp'),
      item('cp-two', 'cp'),
      item('cp-three', 'cp'),
    ],
  }, { userId: 'alice', kind: 'view' });
  const used = markUsed(initial, 'cp-two');
  const deleted = removeProfile(used, 'cp-one');

  assert.equal(deleted.items.some(it => it.id === 'cp-one'), false);
  assert.equal(resolveFavoriteId(deleted, 'cp'), 'cp-two');
  assert.equal(deleted.favoriteByPage.cp, 'cp-two');
  assert.equal(deleted.lastUsedByPage.cp, 'cp-two');
  assert.equal(deleted.items.filter(it => it.isFavorite).map(it => it.id).join(','), 'cp-two');
});

test('deleting the only favorite leaves the table on its system default', () => {
  const initial = normalizeProfileStore({
    favoriteByPage: { cp: 'cp-one' },
    items: [item('cp-one', 'cp'), item('cp-two', 'cp')],
  }, { userId: 'alice', kind: 'view' });
  const deleted = removeProfile(initial, 'cp-one');

  assert.deepEqual(deleted.favoriteByPage, {});
  assert.equal(resolveFavoriteId(deleted, 'cp'), null);
  assert.equal(deleted.items.some(it => it.isFavorite || it.isDefault), false);
});

test('same-named records remain isolated by user and module metadata', () => {
  const alice = normalizeProfileStore({ items: [{ ...item('same', 'cp'), name: 'Default' }] }, { userId: 'alice', kind: 'view' });
  const bob = normalizeProfileStore({ items: [{ ...item('same', 'orders'), name: 'Default' }] }, { userId: 'bob', kind: 'view' });

  assert.equal(alice.items[0].name, bob.items[0].name);
  assert.equal(alice.items[0].userId, 'alice');
  assert.equal(bob.items[0].userId, 'bob');
  assert.equal(alice.items[0].tableId, 'cp');
  assert.equal(bob.items[0].tableId, 'orders');
});

test('browser preset cache is user and table scoped and resolves the active item', () => {
  const source = fs.readFileSync(require.resolve('../public/preset-store.js'), 'utf8');
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const userKey = () => String(context.BL_USER_CONTEXT.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const context = {
    localStorage: storage,
    BL_USER_CONTEXT: { id: 'alice' },
    BLStorage: { native: storage, actualKey: key => `bl.user.${userKey()}.${key}` },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const store = context.BLPresetStore.normalize('view', {
    userId: 'alice', items: [
      { id: 'cp-1', name: 'Default', tableId: 'cp', isFavorite: true, data: { __page: 'cp' } },
      { id: 'orders-1', name: 'Default', tableId: 'orders', isFavorite: true, data: { __page: 'orders' } },
    ], favoriteByPage: { cp: 'cp-1', orders: 'orders-1' },
  });
  context.BLPresetStore.write('view', 'cp', store);
  assert.equal(context.BLPresetStore.read('view', 'cp').userId, 'alice');
  assert.equal(context.BLPresetStore.favoriteId(store, 'cp'), 'cp-1');
  assert.equal(context.BLPresetStore.favoriteId(store, 'orders'), 'orders-1');
  assert.equal(values.has('bl.user.alice.buyerlog.presetCache.v2.view.cp'), true);

  context.BL_USER_CONTEXT.id = 'bob';
  assert.equal(context.BLPresetStore.read('view', 'cp'), null, 'kullanıcı değişince eski memory cache dönmemeli');
});
