'use strict';

/* Sessiz eksik görsel tamamlama — Adım 0 kök nedeni.
 *
 * "Eksikleri Tamamla" yolunun yerel kısmı (dağıtım planı + ingest kararı)
 * her kimlik için getCollectionImage çağırır. Eskiden bu çağrı HER SEFERİNDE
 * collection-images/index.json'u diskten okuyup parse ediyordu: 20.000
 * görsellik depoda 129 model ~2,8 sn, 1.000 model ~21 sn boyunca sunucunun
 * olay döngüsünü kilitliyordu (ölçüm: R × N). Sessiz arka plan işi bunu
 * her açılışta tetikleyeceği için bu O(R·N) maliyet kabul edilemez.
 *
 * Sözleşme: index değişmedikçe tek parse; yazma/silme/dış değişiklik
 * anında görünür (eski görsel referansı dönmez). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-img-index-cache-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
process.env.BUYER_LOG_DATA_ROOT = root;
process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
const userData = require('../server/user-data');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64').toString('base64');
const INDEX = path.join(root, 'collection-images', 'index.json');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function countIndexReads(fn) {
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function patched(file, ...rest) {
    if (String(file) === INDEX || String(file) === INDEX + '.bak') reads += 1;
    return original.call(fs, file, ...rest);
  };
  try { fn(); } finally { fs.readFileSync = original; }
  return reads;
}

test('index değişmedikçe getCollectionImage indeksi yeniden parse etmez', () => {
  const saved = [];
  for (let i = 0; i < 5; i++) saved.push(userData.saveCollectionImage({ rowId: 'row-' + i, filename: 'a.png', mimeType: 'image/png', base64: PNG }));
  userData.getCollectionImage(saved[0].id);
  const reads = countIndexReads(() => {
    for (let round = 0; round < 200; round++) for (const item of saved) assert.ok(userData.getCollectionImage(item.id));
  });
  assert.ok(reads <= 1, '1.000 arama en fazla bir index okuması yapmalı, gerçek: ' + reads);
});

test('yazma ve silme önbelleği anında geçersiz kılar', () => {
  const a = userData.saveCollectionImage({ rowId: 'x', filename: 'x.png', mimeType: 'image/png', base64: PNG });
  assert.ok(userData.getCollectionImage(a.id));
  const b = userData.saveCollectionImage({ rowId: 'y', filename: 'y.png', mimeType: 'image/png', base64: PNG });
  assert.ok(userData.getCollectionImage(b.id), 'yeni kaydedilen görsel hemen bulunur');
  assert.equal(userData.deleteCollectionImage(a.id), true);
  assert.equal(userData.getCollectionImage(a.id), null, 'silinen görsel önbellekten dönmez');
});

test('index dışarıdan değişirse (yedek geri yükleme, başka yazıcı) değişiklik görülür', () => {
  const c = userData.saveCollectionImage({ rowId: 'z', filename: 'z.png', mimeType: 'image/png', base64: PNG });
  assert.ok(userData.getCollectionImage(c.id));
  const list = JSON.parse(fs.readFileSync(INDEX, 'utf8')).filter(item => item.id !== c.id);
  const tmp = INDEX + '.ext';
  fs.writeFileSync(tmp, JSON.stringify(list));
  fs.renameSync(tmp, INDEX);
  assert.equal(userData.getCollectionImage(c.id), null);
});

test('readCollectionImageIndex çağıranın değiştirebileceği bağımsız bir dizi döndürür', () => {
  const first = userData.readCollectionImageIndex();
  first.length = 0;
  assert.ok(userData.readCollectionImageIndex().length > 0, 'çağıranın mutasyonu önbelleği bozmaz');
});
