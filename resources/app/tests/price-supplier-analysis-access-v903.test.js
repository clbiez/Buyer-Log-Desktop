'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const access = require('../server/lib/user-access');
const iam = require('../server/lib/iam-core');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function profile(id, extra = {}) {
  return iam.normalizeProfileIam({
    id, username: id, displayName: id, role: 'buyer', systemRole: 'buyer',
    enabled: true, status: 'ACTIVE', accessAreas: { lfl: false },
    permissions: {}, directPermissions: [], temporaryPermissions: [],
    dataScope: { mode: 'CUSTOM', buyers: ['Buyer A'] },
    ...extra,
  });
}

function storeOf(user) {
  return iam.migrateStore({
    schemaVersion: 4,
    moderator: profile('moderator', { role: 'moderator', systemRole: 'moderator', accessAreas: {} }),
    users: [user], orderAccess: {}, _revision: 0,
  });
}

test('Price & Supplier Analysis is a public module for legacy and new buyer profiles', () => {
  assert.ok(access.ACCESS_AREA_KEYS.includes('priceanalysis'));
  const legacy = access.normalizeAccessAreas({ lfl: false }, false);
  assert.equal(legacy.priceanalysis, true);
  const explicitFalse = access.normalizeAccessAreas({ lfl: false, priceanalysis: false }, false);
  assert.equal(explicitFalse.priceanalysis, true);
});

test('public module access does not bypass the existing buyer data scope', () => {
  const user = profile('buyer-a'), store = storeOf(user);
  assert.equal(access.hasArea(user, 'priceanalysis', store), true);
  assert.equal(access.hasArea(store.moderator, 'priceanalysis', store), true);
  const visible = iam.filterRows(user, [{ Buyer: 'Buyer A' }, { Buyer: 'Other Buyer' }], store);
  assert.deepEqual(visible, [{ Buyer: 'Buyer A' }]);
});

test('Price & Supplier Analysis uses its own frontend access area while the Horizon route stays guarded', () => {
  const ui = read('public/user-access-ui.js');
  const server = read('server/server.js');
  assert.doesNotMatch(ui, /key === 'priceanalysis' \? 'lfl'/);
  // v9.53: değişken adı key -> mapped oldu (quotations/pricinghistory koleksiyon
  // alanına eşleniyor). Korunan şey isim değil, erişimin areas haritasından okunması.
  assert.match(ui, /areas && areas\[(key|mapped)\]/);
  assert.match(server, /app\.get\('\/api\/data\/price-analysis', userAccess\.requireArea\('priceanalysis'\)/);
});
