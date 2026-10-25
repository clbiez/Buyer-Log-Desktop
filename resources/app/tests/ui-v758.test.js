'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app-main.js');
const SERVER = read('server/server.js');
const CSS = require('./helpers/manifest-css')();
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

test('v7.60 · DB klasörü güvenli kopyalanır, aktif konum değişir ve eski veri korunur', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-localdb-test-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const oldFolder = path.join(root, 'old'), newFolder = path.join(root, 'new');
  const db = createLocalDb(path.join(oldFolder, 'BuyerLogLocal.db')); await db.ensure(); await db.queuePatch({ id: 'r1', patch: { name: 'kept' } });
  const oldFile = db.getFile(); await db.moveTo(newFolder);
  assert.equal(path.dirname(db.getFile()), path.resolve(newFolder)); assert.equal(fs.existsSync(oldFile), true);
  assert.equal((await db.read()).records.r1.name, 'kept');
});

test('v7.60 · Sync Status gerçek DB dosyasını salt okunur gösterir ve ayar kaynağı kanoniktir', () => {
  assert.match(APP, /q\.localDbPath/); assert.match(APP, /q\.sharedSyncRoot/);
  assert.doesNotMatch(APP, /data-db-folder|data-db-save|addEditableSyncDbFolder/);
  assert.match(SERVER, /localDb\.moveTo\(dbFolder\)/); assert.match(SERVER, /localDb\.setFolder\(path\.dirname\(configuredLocalDbPath\)\)/);
  assert.match(APP, /const KOL_QUICK_DIMS = KOL_COLS\.filter/); assert.match(APP, /currentKolQuickDims/); assert.match(APP, /i-settings/);
  /* v7.81 — rozet salt okunur: kapsam artık yeniden atanmıyor (const) ve
     çift tıklamayla kişisel ufuk açma yolu kaldırıldı. */
  assert.match(APP, /const scope=horizonBadgeScope/);
  assert.doesNotMatch(APP, /HORIZON_COLLAPSE_KEY|horizonBadgeLink|horizonBadgeToggle/);
  assert.doesNotMatch(CSS, /\.horizonBadge\.isCollapsed|horizonBadgeLink|horizonBadgeToggle/);
  require('./helpers/manifest-css').assertReset();
  assert.doesNotMatch(read('public/index.html'), /id="(?:cp|orders|lfl|backlog)HorizonBadge" hidden/);
  assert.match(CSS, /\.quickFilterEditorList\{[^}]*grid-template-columns:repeat\(3/);
});

test('v7.60 · yerel DB klasörü Sync klasörü olmadan da kaydedilebilir', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-settings-test-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db')), sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  const settings = await sync.save('', path.join(root, 'db')); assert.equal(settings.sharedSyncRoot, ''); assert.equal(settings.localDbPath, path.join(root, 'db', 'BuyerLogLocal.db'));
});
