'use strict';

/* Kullanıcı kararı: Koleksiyona/siparişe yetkisi olmayan kullanıcı başkalarının
   fiyat taleplerini ve üretici tekliflerini (Quotations + Fiyat Geçmişi)
   GÖRMEZ. Önceden her QUOTATIONS.VIEW sahibi tüm kayıtları görüyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.BUYER_LOG_SERVER_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-quotation-visibility-'));
const store = require('../server/lib/quotations-store');
const { createQuotationVisibility } = require('../server/lib/quotation-visibility');

const users = {
  owner: { id: 'owner', role: 'buyer' },
  editor: { id: 'editor', role: 'buyer' },
  viewer: { id: 'viewer', role: 'buyer' },
  outsider: { id: 'outsider', role: 'buyer' },
  scoped: { id: 'scoped', role: 'buyer', buyers: ['Ece B.'] },
  moderator: { id: 'moderator', role: 'moderator' },
};
const grants = { viewer: { owner: 'view' } };
const orders = { 4100002: [{ buyer: 'Ece B.' }], 4100000: [{ buyer: 'Mert Y.' }] };
const visibility = createQuotationVisibility({
  canEdit: store.canEdit,
  collectionAccessLevel: (profile, ownerId) => (profile.id === ownerId ? 'edit' : (grants[profile.id] || {})[ownerId] || null),
  hasPermission: () => false,
  authoritativeOrderRows: code => orders[code] || [],
  canEditOrder: (profile, order) => (profile.buyers || []).includes(order.buyer),
});

test.after(() => fs.rmSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true, force: true }));

test('Koleksiyon ve CP fiyat talepleri yalnız yetkili kullanıcılara listelenir', () => {
  const item = (extra = {}) => ({ modelKey: 'm1', manufacturer: 'Üretici A', price: '4,85', ...extra });
  const collection = store.createRequest(users.owner, { source: 'collection', items: [item()] });
  store.setEditors(users.owner, collection.id, ['editor'], Object.keys(users));
  const cpOwn = store.createRequest(users.owner, { source: 'cp', items: [item({ orderCode: '4100002' })] });
  const cpOther = store.createRequest(users.owner, { source: 'cp', items: [item({ orderCode: '4100000' })] });
  const visibleIds = profile => store.requestsForUser(profile, { canView: request => visibility.visibleTo(profile, request) }).requests.map(request => request.id).sort();

  assert.deepEqual(visibleIds(users.owner), [collection.id, cpOwn.id, cpOther.id].sort(), 'sahip hepsini görür');
  assert.deepEqual(visibleIds(users.moderator), [collection.id, cpOwn.id, cpOther.id].sort(), 'Moderatör hepsini görür');
  assert.deepEqual(visibleIds(users.editor), [collection.id], 'editör yalnız editörü olduğu kaydı görür');
  assert.deepEqual(visibleIds(users.viewer), [collection.id], 'Koleksiyon yetkilisi o koleksiyonun talebini görür');
  assert.deepEqual(visibleIds(users.scoped), [cpOwn.id], 'CP talebi yalnız kapsamındaki siparişi taşıyorsa görünür');
  assert.deepEqual(visibleIds(users.outsider), [], 'yetkisiz kullanıcı hiçbir teklifi görmez');
});
