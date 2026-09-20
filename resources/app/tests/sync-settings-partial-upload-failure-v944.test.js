'use strict';

/* v9.44 — SENKRON YÜKLEME PARTİSİ: TEK DOSYA HATASI TÜM PARTİYİ
 * "PENDING" BIRAKMAMALI
 *
 * Kullanıcı bildirimi (birebir): "ortak ağa 10.000 adet dosya sync yapıyorum
 * işlem bitince yeniden 10.000 adet dosya sync edilmeli görünüyor."
 *
 * Kök neden: server/lib/sync-settings.js runSyncOnce()'ın yükleme döngüsü,
 * TEK bir paketteki geçici bir ağ hatasında (EPERM/EBUSY — ortak SMB
 * klasöründe binlerce ardışık dosya işleminde nadir değil) tüm döngüyü
 * fırlatıyordu; bu durumda markSynced HİÇ çağrılmıyor, önceden başarıyla
 * ağa yazılmış paketler bile "uploaded" işaretlenmiyordu. Sonuç: bir sonraki
 * sync'te AYNI parti komple yeniden "pending" görünüyordu.
 *
 * Bu test: N pakette 1 tanesi kalıcı olarak başarısız olsun; geri kalan N-1
 * paket markSynced'e girmiş, pendingUpload N-1 değil YALNIZ 1 olmalı. Hata
 * giderilince bir sonraki sync'te o son paket de tamamlanıp pendingUpload
 * 0'a düşmeli.
 *
 * Ayrıca: localDb.pendingCount() varsayılan pending(limit=1000) sınırının
 * ÜSTÜNDEKİ gerçek bekleyen sayısını da doğru raporluyor (eskiden durum
 * raporu 1000'in üstünü hep 1000 gösterirdi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { SYNC_PACKAGE_DIR, isBundleFile } = require('../server/lib/sync-package');

function encode(value) { return encodeURIComponent(String(value || '')); }

test('v2 bundle hatasında tamamlanan paketler checkpoint edilir ve kalan aralık sonraki turda devam eder', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-partial-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sharedRoot = path.join(root, 'shared');
  await fsp.mkdir(sharedRoot, { recursive: true });
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await sync.save(sharedRoot);

  const COUNT = 1500; // 500/event package => 3 v2 bundle
  await db.queuePatches(Array.from({ length: COUNT }, (_, i) => ({ id: `row-${i}`, patch: { name: `v${i}` } })));
  assert.equal(await db.pendingCount(), COUNT);

  const originalRename = fsp.rename;
  const seenTargets = new Set(); let failTarget = null;
  fsp.rename = async (from, to) => {
    const target = String(to);
    if (target.includes(`${path.sep}${SYNC_PACKAGE_DIR}${path.sep}`) && isBundleFile(path.basename(target))) {
      seenTargets.add(target);
      if (!failTarget && seenTargets.size === 2) failTarget = target;
      if (target === failTarget) { const error = new Error('EBUSY: simulated shared-drive hiccup'); error.code = 'EBUSY'; throw error; }
    }
    return originalRename(from, to);
  };
  let firstRun;
  try { firstRun = await sync.syncOnce(); } finally { fsp.rename = originalRename; }

  assert.equal(firstRun.uploadFailures, 1, 'yalnız başarısız v2 bundle raporlanmalı');
  assert.equal(firstRun.uploadedPackages, 1, 'ilk bundle checkpoint edilmiş olmalı');
  assert.equal(firstRun.uploadedEvents, 500);
  assert.equal(firstRun.pendingUpload, 1000, 'başarısız bundle ve sonrasındaki henüz denenmeyen eventler pending kalmalı');
  assert.equal(await db.pendingCount(), 1000);

  // Ağ sorunu geçince sonraki sync yalnız kalan 1.000 event ile devam etmeli.
  const secondRun = await sync.syncOnce();
  assert.equal(secondRun.uploadFailures, 0);
  assert.equal(secondRun.uploadedEvents, 1000);
  assert.equal(secondRun.pendingUpload, 0, 'düzelince pending sıfıra inmeli');
  assert.equal(await db.pendingCount(), 0);
});

test('localDb.pendingCount() varsayılan pending(1000) sınırının üstündeki gerçek sayıyı raporlar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-pending-count-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));

  const TOTAL = 1200;
  await db.queuePatches(Array.from({ length: TOTAL }, (_, i) => ({ id: `row-${i}`, patch: { name: `v${i}` } })));

  assert.equal((await db.pending()).length, 1000, 'pending() varsayılan limitte kalmalı (mevcut sözleşme)');
  assert.equal(await db.pendingCount(), TOTAL, 'pendingCount() gerçek toplamı döndürmeli, 1000\'de kesmemeli');
});
