'use strict';

/* SEÇİLİ MODEL GÖRSELLERİNİN GERÇEK SİLİNMESİ
 *
 * Korunan regresyonlar:
 *  · CP'de çoklu seçimle görsel kaldırılabilir (tekil "Kaldır" ile sınırlı değil).
 *  · Kaldırma paylaşılan ağ klasörüne MANUEL mezar taşı yazar; eski bir kopya
 *    görseli geri getiremez.
 *  · Paylaşılan klasördeki baytlar gerçekten silinir (pack dilimi sıfırlanır,
 *    content-index kaydı düşer); aynı içeriği kullanan başka model korunur.
 *  · Yerel dosya yalnız artık hiçbir kayıt/satır kullanmıyorsa silinir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const sharedImageStore = require(path.join(ROOT, 'server/lib/shared-image-store.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(256, 7)]);
const OTHER_JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(256, 9)]);

function storeFor(sharedRoot, deviceId) {
  return sharedImageStore.createSharedImageStore({ getSharedSyncRoot: async () => sharedRoot, getDeviceId: () => deviceId });
}
function entry(plmId, colourCode, buffer) {
  return {
    canonicalKey: `collection:u1:plm:${plmId}|colour:${colourCode}`, plmId, colourCode,
    source: sharedImageStore.SOURCE_PLM, ownership: sharedImageStore.OWNERSHIP_AUTOMATIC,
    status: sharedImageStore.STATUS_AVAILABLE, buffer, mimeType: 'image/jpeg',
  };
}

test('purge tombstones the selected identities and erases their bytes from the shared folder', async () => {
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-purge-'));
  const a = storeFor(sharedRoot, 'device-a');
  const b = storeFor(sharedRoot, 'device-b');
  await a.publish([entry('100', '01', JPEG), entry('200', '02', OTHER_JPEG)]);
  await b.publish([entry('100', '01', JPEG)]);
  const before = await a.lookup('collection:u1:plm:100|colour:01');
  assert.ok(await a.readObject(before));

  const result = await a.purge({ prefix: 'collection:u1:', match: record => record.plmId === '100' && record.colourCode === '01' });
  assert.equal(result.available, true);
  assert.deepEqual(result.keys, ['collection:u1:plm:100|colour:01']);
  assert.equal(result.tombstoned, 1);
  assert.ok(result.erased >= 1);

  // Mezar taşı her cihazdan görülür ve diğer cihazın AVAILABLE kaydını yener.
  const after = await b.lookup('collection:u1:plm:100|colour:01');
  assert.equal(after.status, sharedImageStore.STATUS_DELETED);
  // Eski kaydın baytları artık okunamaz: içerik gerçekten silinmiştir.
  assert.equal(await b.readObject(before), null);
  const packBytes = fs.readFileSync(path.join(sharedRoot, 'model-images', ...before.packPath.split('/')));
  assert.equal(packBytes.subarray(before.packOffset, before.packOffset + before.packLength).equals(JPEG), false);
  // Seçilmeyen model korunur.
  const other = await a.lookup('collection:u1:plm:200|colour:02');
  assert.ok((await a.readObject(other)).equals(OTHER_JPEG));

  // Aynı görsel daha sonra yeniden yüklenebilir.
  await a.publish([{ ...entry('100', '01', JPEG), ownership: sharedImageStore.OWNERSHIP_MANUAL, source: sharedImageStore.SOURCE_MANUAL }]);
  const again = await b.lookup('collection:u1:plm:100|colour:01');
  assert.equal(again.status, sharedImageStore.STATUS_AVAILABLE);
  assert.ok((await b.readObject(again)).equals(JPEG));
});

test('purge keeps shared bytes that another model still uses', async () => {
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-purge-shared-'));
  const a = storeFor(sharedRoot, 'device-a');
  await a.publish([entry('100', '01', JPEG), entry('300', '03', JPEG)]);
  const result = await a.purge({ prefix: 'collection:u1:', match: record => record.plmId === '100' });
  assert.equal(result.tombstoned, 1);
  assert.equal(result.erased, 0);
  const kept = await a.lookup('collection:u1:plm:300|colour:03');
  assert.ok((await a.readObject(kept)).equals(JPEG));
});

test('purge without a shared folder reports unavailable and changes nothing', async () => {
  const store = sharedImageStore.createSharedImageStore({ getSharedSyncRoot: async () => '', getDeviceId: () => 'x' });
  const result = await store.purge({ match: () => true });
  assert.equal(result.available, false);
  assert.equal(result.tombstoned, 0);
});

test('server exposes a batch delete route that purges shared and local copies', () => {
  const start = SERVER.indexOf("app.post('/api/model-images/delete-selected'");
  assert.ok(start > 0, 'delete-selected route missing');
  const body = SERVER.slice(start, SERVER.indexOf('\n});', start));
  assert.match(body, /patchPlmImageLinks\(/);
  assert.match(body, /sharedModelImageStore\.purge\(/);
  assert.match(body, /STATUS_DELETED/);
  assert.match(body, /deleteCollectionImage\(ref\)/);
  // Kullanımdaki yerel dosya silinmez.
  assert.match(body, /inUse\.has\(ref\)/);
  assert.match(body, /collectionWorkspaces\.listOwnerIds\(\)/);
});

test('CP toolbar offers bilingual multi-select image removal', () => {
  assert.match(HTML, /id="cpRemoveImagesBtn"[^>]*data-i18n-title-en="[^"]+"[\s\S]*?data-i18n-en="Remove Images"/);
  assert.match(APP, /_selectionActionIds=\[[^\]]*'cpRemoveImagesBtn'/);
  assert.match(APP, /async function cpRemoveSelectedImages\(btn\)\{[\s\S]*?selectedCpRowsForAction\(\)[\s\S]*?\/api\/model-images\/delete-selected/);
  assert.match(APP, /getElementById\('cpRemoveImagesBtn'\)\?\.addEventListener\('click'/);
});
