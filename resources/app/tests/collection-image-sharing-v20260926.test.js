'use strict';

/* Çok cihazlı senaryoda bulunan iki hata:
   1) Koleksiyon görsel yayını mimeType taşımıyordu; paylaşımlı depo uzantısı
      belirlenemeyen baytı sessizce atlıyor, kuyruk ise yayını başarılı sayıp
      temizliyordu. Yetki verilen kullanıcıya HİÇBİR Koleksiyon görseli
      ulaşmıyordu (PLM ID'li olanlar dahil).
   2) PLM ID'si olmayan konsept modellerin (kullanıcının elle yüklediği)
      görselleri paylaşım kimliği üretmediği için hiç yayınlanmıyordu.
      PLM kimlikli davranış aynen korunur; PLM'siz satır sahip + satır
      kimliğiyle (row:<id>) paylaşılır. */
const test = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../server/lib/collection-image-sync-policy');
const { createModelImageDistribution, emptyState } = require('../server/lib/model-image-distribution');

test('PLM ID’si olmayan satırın görseli satır kimliğiyle paylaşılır; PLM kimliği varsa o kullanılır', () => {
  const workspace = { rows: [
    { id: 1, plmId: '123', ccode: '01', colour: 'Black', imgRef: 'ci_a' },
    { id: 7, imgRef: 'ci_manual' },
    { id: 8, imgRef: 'ci_manual' },
    { id: 9 },
  ] };
  const items = policy.workspaceSharedImageItems(workspace);
  assert.deepEqual(items.map(item => [item.recordId, item.imageRef, policy.sharedImageKey(item, item.plmId ? 'plm:123|colour:01' : '')]), [
    ['1', 'ci_a', 'plm:123|colour:01'],
    ['7', 'ci_manual', 'row:7'],
    ['8', 'ci_manual', 'row:8'],
  ], 'aynı görseli taşıyan iki PLM’siz satırın her biri kendi kimliğini alır');
  assert.equal(policy.rowSharedImageIdentity({ id: 7, imgRef: 'ci_manual' }).rowKey, 'row:7');
  assert.equal(policy.rowSharedImageIdentity({ id: 9 }), null, 'görseli olmayan satır paylaşılmaz');
  assert.equal(policy.rowSharedImageIdentity({ imgRef: 'ci_x' }), null, 'kimliksiz satır paylaşılmaz');
  // Eski PLM-yalnız sözleşme değişmedi.
  assert.equal(policy.rowImageIdentity({ id: 7, imgRef: 'ci_manual' }), null);
  assert.equal(policy.workspaceImageItems(workspace).length, 1);
});

test('Yayın kuyruğunda eksik mimeType yerel görsel kaydından tamamlanır; bayt atlanmadan yayınlanır', async () => {
  let stateValue = emptyState();
  const published = [];
  const sharedStore = {
    STATUS_AVAILABLE: 'AVAILABLE',
    available: async () => true,
    publish: async entries => { published.push(...entries); return { published: entries.length, skipped: 0, reused: 0, revision: 1 }; },
  };
  const distribution = createModelImageDistribution({
    sharedStore,
    readState: () => stateValue,
    writeState: value => { stateValue = value; return value; },
    getImage: ref => (ref === 'ci_manual' ? { item: { id: 'ci_manual', mimeType: 'image/jpeg' }, full: '/unused' } : null),
    readImageBytes: () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  });
  distribution.queuePublish([{ canonicalKey: 'collection:owner:row:7', source: 'PLM', imageRef: 'ci_manual', status: 'AVAILABLE', sourceIdentity: 'collection:owner:7' }]);
  const result = await distribution.flushPublish({ sourceIdentityPrefix: 'collection:', dropNonMatching: true });
  assert.equal(result.published, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].mimeType, 'image/jpeg');
  assert.ok(Buffer.isBuffer(published[0].buffer));
});

test('Satır bazlı Koleksiyon kaydı (PATCH) da görselleri yetkili kullanıcılara yayımlar', () => {
  // İstemci v7.22'den beri yalnız değişen satırları PATCH ile gönderir; görsel
  // yayını yalnız tam kayıtta (PUT) kalırsa yeni/değişen görsel karşı tarafa
  // ancak sahip yeniden oturum açtığında ulaşır.
  const source = require('./helpers/server-source')();
  const start = source.indexOf("app.patch('/api/collection-workspaces/:ownerId'");
  assert.ok(start > 0, 'PATCH ucu bulunamadı');
  const body = source.slice(start, source.indexOf('\n});', start));
  assert.match(body, /if \(result\.changed\) \{[\s\S]*publishCollectionWorkspaceImages\(ownerId\)/);
});
