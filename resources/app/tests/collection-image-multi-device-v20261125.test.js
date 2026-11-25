'use strict';

/* KOLEKSİYON GÖRSELLERİ — 20 KURULUMLU DAĞITIM
 *
 * Her kurulum kendi paylaşılan görsel deposu istemcisini (gerçek
 * shared-image-store, kendi cihaz kimliği ve manifestosu) ve kendi gerçek izin
 * önbelleğini kullanır. Sunucunun yayım (publishCollectionWorkspaceImages) ve
 * alma (syncCollectionWorkspaceImagesForUser) yolunun iş kuralı burada aynı
 * kütüphane çağrılarıyla kurulur: yalnız paylaşılan sahip yayımlar, alıcı
 * önce Koleksiyon erişimini denetler, anahtar `collection:<sahip>:<model>`
 * kapsamındadır ve bayt bütünlüğü hash ile doğrulanır.
 *
 * Korunan sözleşmeler:
 *  · Yükleme/değiştirme sonrası bütün yetkili kurulumlar aynı içeriği görür.
 *  · Aynı modelin görselini iki kurulum eşzamanlı değiştirirse kazanan her
 *    kurulumda aynıdır (global revizyon + cihaz kimliği sırası).
 *  · Yetkisiz ve erişimi geri alınmış kurulum görseli alamaz; URL katmanı da
 *    sahip kapsamlı görseli reddeder.
 *  · Yarım/bozuk pack dilimi hiçbir kurulumda görsel olarak kurulmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { createCollectionSimulation, OWNER } = require('./helpers/collection-sync-sim');
const sharedImageStoreLib = require('../server/lib/shared-image-store');
const policy = require('../server/lib/collection-image-sync-policy');
const plmImageIngest = require('../server/lib/plm-image-ingest');
const imageAuthority = require('../server/lib/collection-image-authority');

const TIMEOUT_MS = process.platform === 'win32' ? 90000 : 20000;
const jpeg = seed => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), crypto.createHash('sha256').update(String(seed)).digest(), Buffer.alloc(512, seed.length % 251)]);
const hashOf = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

function attachImageClients(sim) {
  for (const device of sim.devices) {
    device.images = sharedImageStoreLib.createSharedImageStore({
      getSharedSyncRoot: async () => (device.online ? sim.hub : path.join(sim.root, 'unreachable-share', 'hub')),
      getDeviceId: () => `install-${String(device.index).padStart(2, '0')}`,
    });
  }
}
function keyFor(row) {
  const item = policy.rowSharedImageIdentity(row);
  return item && `collection:${OWNER}:${policy.sharedImageKey(item, plmImageIngest.normalizeRequest(item).key)}`;
}
// publishCollectionWorkspaceImages: yalnız dışarı paylaşılmış sahip yayımlar.
async function publishRowImages(device, rows, bytesByRow) {
  if (!policy.shouldPublishOwnerImages(device.permissions.outgoing(OWNER), OWNER)) return { published: 0, reason: 'not-shared' };
  const entries = rows.map(row => ({
    canonicalKey: keyFor(row), source: sharedImageStoreLib.SOURCE_PLM, plmId: row.plmId, colourCode: row.colourCode || '', colour: row.colour || '',
    buffer: bytesByRow.get(row.id), mimeType: 'image/jpeg', ownership: sharedImageStoreLib.OWNERSHIP_AUTOMATIC,
    status: sharedImageStoreLib.STATUS_AVAILABLE, sourceIdentity: `collection:${OWNER}:${row.id}`, sourceFetchedAt: new Date().toISOString(),
  }));
  return device.images.publish(entries);
}
// syncCollectionWorkspaceImagesForUser: erişim yoksa hiçbir paylaşılan kayıt okunmaz.
async function resolveRowImages(device, rows) {
  if (!device.permissions.accessLevel(device.userId, OWNER)) throw Object.assign(new Error('denied'), { code: 'COLLECTION_ACCESS_DENIED', statusCode: 403 });
  const records = await device.images.lookupMany(rows.map(keyFor));
  const out = new Map();
  for (const row of rows) {
    const record = records.get(keyFor(row));
    if (!record || record.status !== sharedImageStoreLib.STATUS_AVAILABLE) { out.set(row.id, null); continue; }
    const buffer = await device.images.readObject(record);
    out.set(row.id, buffer ? hashOf(buffer) : 'CORRUPT');
  }
  return out;
}
function userAccessFor(device) {
  return { collectionAccessLevel: (profile, ownerId) => device.permissions.accessLevel(profile.id, ownerId) };
}

test('görsel yükleme, değiştirme ve eşzamanlı değiştirme bütün yetkili kurulumlarda aynı içeriğe yakınsar; yetkisiz görmez', { timeout: TIMEOUT_MS }, async t => {
  const sim = await createCollectionSimulation({ seed: 25120, devices: 20, rows: 6 });
  t.after(() => sim.close());
  try {
    await sim.bootstrap();
    attachImageClients(sim);
    const rows = sim.workspaceOf(sim.devices[0]).rows.slice(0, 4).map(row => ({ ...row, imgRef: `ci_${row.id}` }));
    const [owner, laptop, editorA, editorB] = sim.devices;
    const first = new Map(rows.map(row => [row.id, jpeg(`v1-${row.id}`)]));
    assert.ok((await publishRowImages(owner, rows, first)).published >= rows.length);

    // Düzenleyici satır 2'nin görselini değiştirir (yeni bayt, yeni revizyon).
    const replacement = new Map([[rows[1].id, jpeg('v2-editor-a')]]);
    await publishRowImages(editorA, [rows[1]], replacement);
    // Sahibin diğer kurulumu ve başka bir düzenleyici satır 3'ü aynı anda değiştirir.
    const race = [new Map([[rows[2].id, jpeg('race-laptop')]]), new Map([[rows[2].id, jpeg('race-editor-b')]])];
    await Promise.all([publishRowImages(laptop, [rows[2]], race[0]), publishRowImages(editorB, [rows[2]], race[1])]);
    // Aynı bayt iki kez yayımlanırsa içerik tekrar yazılmaz (aynı hash).
    await publishRowImages(sim.devices[4], [rows[3]], first);

    const views = [];
    for (const device of sim.devices) {
      if (device.role === 'none') {
        await assert.rejects(resolveRowImages(device, rows), error => error.code === 'COLLECTION_ACCESS_DENIED', `outsider ${device.index}`);
        assert.throws(() => imageAuthority.assertAccess(userAccessFor(device), { id: device.userId }, { item: { rowId: `collection-shared:${OWNER}:${rows[0].id}` } }), error => error.code === 'COLLECTION_ACCESS_DENIED');
        continue;
      }
      views.push(await resolveRowImages(device, rows));
    }
    const signature = view => JSON.stringify([...view]);
    assert.equal(new Set(views.map(signature)).size, 1, 'every authorised installation resolves the same images');
    const view = views[0];
    assert.equal(view.get(rows[0].id), hashOf(first.get(rows[0].id)));
    assert.equal(view.get(rows[1].id), hashOf(replacement.get(rows[1].id)), 'replacement wins over the original');
    assert.ok([hashOf(race[0].get(rows[2].id)), hashOf(race[1].get(rows[2].id))].includes(view.get(rows[2].id)), 'concurrent replacement picks one of the written images');
    assert.equal(view.get(rows[3].id), hashOf(first.get(rows[3].id)));
    // İzleyici görür ama URL katmanında yazamaz.
    const viewer = sim.devices.find(item => item.role === 'view');
    assert.equal(imageAuthority.assertAccess(userAccessFor(viewer), { id: viewer.userId }, { item: { rowId: `collection-shared:${OWNER}:${rows[0].id}` } }), OWNER);
    assert.throws(() => imageAuthority.assertAccess(userAccessFor(viewer), { id: viewer.userId }, { item: { rowId: `collection-shared:${OWNER}:${rows[0].id}` } }, { write: true }), error => error.code === 'COLLECTION_ACCESS_DENIED');

    // Erişimi geri alınan izleyici, izin tazelemesinden sonra görseli alamaz.
    await sim.revoke(owner, viewer.userId);
    await viewer.permissions.sync();
    await assert.rejects(resolveRowImages(viewer, rows), error => error.code === 'COLLECTION_ACCESS_DENIED');
    assert.throws(() => imageAuthority.assertAccess(userAccessFor(viewer), { id: viewer.userId }, { item: { rowId: `collection-shared:${OWNER}:${rows[0].id}` } }), error => error.code === 'COLLECTION_ACCESS_DENIED');
  } catch (error) { await sim.writeFailureLog(error); throw error; }
});

test('yarım/bozuk pack dilimi hiçbir kurulumda görsel olarak kurulmaz; düzgün yeniden yayımdan sonra herkes aynı görseli alır', { timeout: TIMEOUT_MS }, async t => {
  const sim = await createCollectionSimulation({ seed: 25121, devices: 20, rows: 3 });
  t.after(() => sim.close());
  try {
    await sim.bootstrap();
    attachImageClients(sim);
    const rows = sim.workspaceOf(sim.devices[0]).rows.slice(0, 1).map(row => ({ ...row, imgRef: 'ci_1' }));
    const bytes = new Map([[rows[0].id, jpeg('pack-integrity')]]);
    await publishRowImages(sim.devices[0], rows, bytes);
    const packsRoot = path.join(sim.hub, sharedImageStoreLib.ROOT_FOLDER, sharedImageStoreLib.PACKS);
    const packFiles = [];
    for (const dir of await fsp.readdir(packsRoot)) for (const name of await fsp.readdir(path.join(packsRoot, dir))) if (name.endsWith('.blpack')) packFiles.push(path.join(packsRoot, dir, name));
    assert.equal(packFiles.length, 1);
    const original = await fsp.readFile(packFiles[0]);
    const damaged = Buffer.from(original); damaged[damaged.length - 10] ^= 0xFF;
    await fsp.writeFile(packFiles[0], damaged);
    for (const device of sim.devices.filter(item => item.role !== 'none')) {
      assert.equal((await resolveRowImages(device, rows)).get(rows[0].id), 'CORRUPT', `device ${device.index} must reject a damaged slice`);
    }
    await fsp.writeFile(packFiles[0], original);
    const hashes = new Set();
    for (const device of sim.devices.filter(item => item.role !== 'none')) hashes.add((await resolveRowImages(device, rows)).get(rows[0].id));
    assert.deepEqual([...hashes], [hashOf(bytes.get(rows[0].id))]);
  } catch (error) { await sim.writeFailureLog(error); throw error; }
});
