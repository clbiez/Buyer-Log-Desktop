'use strict';

/*
 * v7.16 — Page cache aşamasının yetki maliyeti için koruma testleri.
 *
 * Saha bulgusu: ASAS yalnız 1.155 satır döndürdüğü bir yenilemede "Page cache"
 * aşaması 28.219 ms sürdü. Kök neden projection satırlarına yazılan `_canEdit`
 * alanıydı: karar HER SATIR için yeniden hesaplanıyor, her hesap alt kullanıcı
 * ağacını yürüyüp izin kümesini baştan kuruyordu.
 *
 * Üç ayrı maliyet vardı:
 *   1) iam-core descendants() ve user-access descendantProfiles() döngünün
 *      İÇİNDE bütün profil listesini yeniden kurup tarıyordu (profil sayısının
 *      karesi).
 *   2) normalizeRoles() her profil için dört rolün tam izin listesini baştan
 *      kuruyordu.
 *   3) manageAllOrders kontrolü kullanıcıya bağlı olduğu hâlde satır başına
 *      çağrılıyordu.
 *
 * Bu testler hem davranışın korunduğunu hem maliyetin geri gelmediğini çivilerler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pagecache-v716-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const iam = require('../server/lib/iam-core');
const access = require('../server/lib/user-access');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

// Moderatöre bağlı N kullanıcılı gerçekçi bir depo kurar.
function seedUsers(count) {
  for (let index = 0; index < count; index += 1) {
    const store = access.loadStore();
    if (store.users.some(user => user.id === `user-${index}`)) continue;
    store.users.push({
      id: `user-${index}`, username: `kullanici-${index}`, displayName: `Kullanıcı ${index}`,
      title: 'Buyer', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE',
      passwordHash: 'x'.repeat(140), managerId: 'moderator', supervisorId: 'moderator',
      mags: ['CK1E'], mmygs: ['CKW1'], buyingGroups: ['ELBISE'],
      permissions: {}, accessAreas: {}, collectionAccess: [],
      dataScope: { mode: 'MAG', buyers: [], mags: ['CK1E'], mmygs: [], buyingGroups: [] },
      directPermissions: [], temporaryPermissions: [],
    });
    access.saveStore(store, store._revision);
  }
}

test('v7.16 alt kullanıcı ağacı doğru ve eksiksiz gezilir', () => {
  const store = access.loadStore();
  store.users.push(
    { id: 'a', username: 'a', displayName: 'A', role: 'buyer', systemRole: 'manager', enabled: true, status: 'ACTIVE', managerId: 'moderator', supervisorId: 'moderator', mags: [], mmygs: [], buyingGroups: [], permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: [], temporaryPermissions: [] },
    { id: 'b', username: 'b', displayName: 'B', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE', managerId: 'a', supervisorId: 'a', mags: [], mmygs: [], buyingGroups: [], permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: [], temporaryPermissions: [] },
    { id: 'c', username: 'c', displayName: 'C', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE', managerId: 'b', supervisorId: 'b', mags: [], mmygs: [], buyingGroups: [], permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: [], temporaryPermissions: [] },
  );
  const saved = access.saveStore(store, store._revision);
  const ids = iam.descendants(saved, 'a').map(profile => profile.id).sort();
  assert.deepEqual(ids, ['b', 'c'], 'iki kademe aşağısı da gezilmeli');
  assert.deepEqual(iam.descendants(saved, 'c').map(p => p.id), [], 'yaprak düğümün altı boş olmalı');
  assert.ok(iam.descendants(saved, 'moderator').map(p => p.id).includes('c'), 'kök bütün ağacı görmeli');
});

test('v7.16 döngüsel yönetici zinciri sonsuz döngüye girmez', () => {
  // Bozuk veriye karşı koruma: managerId zinciri kendine dönerse gezinme durmalı.
  const store = access.loadStore();
  const cyclic = {
    ...store,
    users: [
      { id: 'x', username: 'x', displayName: 'X', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE', managerId: 'y', supervisorId: 'y', mags: [], mmygs: [], buyingGroups: [], permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: [], temporaryPermissions: [] },
      { id: 'y', username: 'y', displayName: 'Y', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE', managerId: 'x', supervisorId: 'x', mags: [], mmygs: [], buyingGroups: [], permissions: {}, accessAreas: {}, collectionAccess: [], directPermissions: [], temporaryPermissions: [] },
    ],
  };
  const ids = iam.descendants(cyclic, 'x').map(profile => profile.id);
  assert.ok(ids.length <= 2, 'döngü kendini tekrar etmemeli');
});

test('v7.16 yetki kontrolü profil sayısıyla karesel büyümez', () => {
  seedUsers(40);
  const moderator = access.loadStore().moderator;
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  runtime.hasPermission(moderator, 'manageAllOrders'); // ısınma

  const measure = calls => {
    const started = process.hrtime.bigint();
    for (let index = 0; index < calls; index += 1) runtime.hasPermission(moderator, 'manageAllOrders');
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  const perCall = measure(200) / 200;
  // Eski uygulamada bu çağrı 25 kullanıcılı bir depoda 35 ms sürüyordu.
  assert.ok(perCall < 12, `hasPermission çağrı başına ${perCall.toFixed(1)} ms sürdü; karesel davranış geri gelmiş olabilir`);
});

test('v7.16 rol tanımları aynı kaynak için yeniden kurulmaz', () => {
  const roles = { manager: { permissions: ['CP.VIEW'] } };
  const first = iam.normalizeRoles(roles);
  const second = iam.normalizeRoles(roles);
  assert.equal(first, second, 'aynı roles nesnesi aynı sonucu döndürmeli');
  const other = iam.normalizeRoles({ manager: { permissions: ['CP.EDIT'] } });
  assert.notEqual(first, other, 'farklı kaynak farklı sonuç üretmeli');
  assert.ok(other.manager.permissions.includes('CP.EDIT'));
});

test('v7.16 _canEdit kararı satır başına değil kullanıcı ve sipariş kodu başına alınır', () => {
  const block = SERVER.slice(SERVER.indexOf('async function buildAndWritePageProjectionCache'));
  const scoped = block.slice(0, block.indexOf('async function warmPageProjectionCachesFromSnapshots'));
  // manageAllOrders kullanıcı düzeyinde bir kez çözülmeli.
  assert.match(scoped, /const editContext = \{ manageAll:/);
  // Sipariş kodu başına önbellek bulunmalı.
  assert.match(scoped, /editByOrderCode/);
  // Satır başına doğrudan yetki çağrısı kalmamalı.
  assert.doesNotMatch(scoped, /forEach\(row => \{ row\._canEdit = Boolean\(pageProjectionCanEdit/);
});

test('v7.16 canUserEditOrderCode önceden hesaplanmış kullanıcı kararını kabul eder', () => {
  assert.match(SERVER, /function canUserEditOrderCode\(profile, orderCode, precomputed = null\)/);
  // Önceden hesaplanmış değer verildiğinde tekrar izin kümesi kurulmamalı.
  const block = SERVER.slice(SERVER.indexOf('function canUserEditOrderCode'));
  assert.match(block.slice(0, 900), /precomputed && typeof precomputed\.manageAll === 'boolean'/);
});
