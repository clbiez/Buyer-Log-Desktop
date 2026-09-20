'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function renameError(code = 'EPERM') {
  const error = new Error(`${code}: simulated Windows rename lock`);
  error.code = code;
  return error;
}

async function withRenameFailures(matchesTarget, failureCount, run) {
  const original = fsp.rename;
  let attempts = 0;
  fsp.rename = async (from, to) => {
    if (matchesTarget(from, to)) {
      attempts += 1;
      if (attempts <= failureCount) throw renameError();
    }
    return original(from, to);
  };
  try { return await run(() => attempts); }
  finally { fsp.rename = original; }
}

test('sync settings geçici EPERM rename kilidini retry ederek tamamlar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-settings-eperm-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const settingsRoot = path.join(root, 'settings');
  const sync = createSyncSettings({ localDataRoot: settingsRoot, localDb: db });

  await withRenameFailures((_from, to) => to === sync.file, 2, async attempts => {
    const saved = await sync.savePeriod(10);
    assert.equal(saved.syncPeriodMinutes, 10);
    assert.equal(attempts(), 3);
  });

  assert.equal((await sync.read()).syncPeriodMinutes, 10);
  assert.deepEqual((await fsp.readdir(settingsRoot)).filter(name => name.endsWith('.tmp')), []);
});

test('kalıcı EPERM eski sync ayarını korur ve temp dosyasını temizler', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-settings-stable-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const settingsRoot = path.join(root, 'settings');
  const sync = createSyncSettings({ localDataRoot: settingsRoot, localDb: db });
  await sync.savePeriod(5);

  await withRenameFailures((_from, to) => to === sync.file, Number.MAX_SAFE_INTEGER, async () => {
    await assert.rejects(sync.savePeriod(10), error => error && error.code === 'EPERM');
  });

  assert.equal((await sync.read()).syncPeriodMinutes, 5);
  assert.deepEqual((await fsp.readdir(settingsRoot)).filter(name => name.endsWith('.tmp')), []);
});

test('Local DB transient EPERM rename kilidinde transaction verisini kaybetmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-local-db-eperm-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await db.ensure();

  /* v7.86: sıcak yol artık anlık görüntüyü yeniden yazmıyor, WAL'a bir satır
     ekliyor — yani queuePatch DB dosyasını hiç rename etmiyor. Rename yolu
     anlık görüntü yazımında (transaction / sıkıştırma) kaldı; korunması
     gereken garanti de orada. İddia o yola taşındı. */
  await db.queuePatch({ id: 'row-1', patch: { name: 'saved' } });

  await withRenameFailures((_from, to) => to === db.getFile(), 2, async attempts => {
    await db.transaction(async state => { state.migrations = { ...(state.migrations || {}), epermProbe: true }; return null; });
    assert.equal(attempts(), 3, 'geçici EPERM retry edilmeli');
  });

  // Görüntü yazımı EPERM'e takılsa bile WAL'daki yazma kaybolmaz.
  assert.equal((await db.read()).records['row-1'].name, 'saved');

  // Süreç yeniden başlasa da: veri diskte, yalnız bellekte değil.
  assert.equal((await createLocalDb(db.getFile()).read()).records['row-1'].name, 'saved');
});

test('WAL yazması EPERM ile başarısız olursa çağırana hata döner, sessiz kayıp olmaz', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-wal-eperm-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await db.ensure();

  const open = fsp.open;
  fsp.open = async (...args) => {
    if (String(args[0]).endsWith('.wal')) { const error = new Error('EPERM: simulated'); error.code = 'EPERM'; throw error; }
    return open(...args);
  };
  try {
    await assert.rejects(db.queuePatch({ id: 'row-1', patch: { name: 'yazılamadı' } }), /EPERM/,
      'yazma diske inemediyse çağıran bunu ÖĞRENMELİ');
  } finally { fsp.open = open; }

  // Başarısız yazma kalıcı iz bırakmamalı; sonraki yazma normal çalışmalı.
  await db.queuePatch({ id: 'row-2', patch: { name: 'yazıldı' } });
  const state = await createLocalDb(db.getFile()).read();
  assert.equal(state.records['row-1'], undefined, 'diske inmeyen kayıt görünmemeli');
  assert.equal(state.records['row-2'].name, 'yazıldı');
});

test('Local DB ortak ağ yoluna taşınamaz ve eski UNC ayarı açılışta yok sayılır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-local-db-path-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const localFile = path.join(root, 'local', 'BuyerLogLocal.db');
  const db = createLocalDb(localFile);
  const settingsRoot = path.join(root, 'settings');
  const sync = createSyncSettings({ localDataRoot: settingsRoot, localDb: db });
  const unc = '\\\\lcw_fileserver\\PERSONEL\\BUYER LOG BETA';
  await fsp.mkdir(settingsRoot, { recursive: true });
  await fsp.writeFile(sync.file, JSON.stringify({ localDbFolder: unc, syncPeriodMinutes: 5 }));

  assert.equal((await sync.read()).localDbFolder, path.dirname(localFile));
  await assert.rejects(sync.save('', unc), /yerel diskte/i);
  assert.throws(() => db.setFolder(unc), /yerel diskte/i);
  assert.equal(db.getFile(), localFile);
});

test('periyodik background sync hatası promise zincirinde yakalanır', () => {
  const start = SERVER.indexOf('setInterval(() => { void syncSettings.read()');
  const block = SERVER.slice(start, start + 700);
  assert.ok(start >= 0, 'periyodik sync bloğu bulunamadı');
  assert.match(block, /syncSettings\.syncOnce\(\)[\s\S]*?\.catch\(error => logRuntimeFailure\('scheduledSync', error\)\)/);
  assert.doesNotMatch(block, /void syncSettings\.syncOnce\(\)/);
});
