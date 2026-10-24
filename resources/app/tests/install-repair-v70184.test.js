'use strict';
/* 7.0.184 — tek seferlik kurulum onarımı ve çekirdek bütünlük doğrulaması. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { writeIntegrityManifest, verifyIntegrity, MANIFEST_REL } = require('../electron/update/integrity');
const { runInstallRepair, cleanUpdaterState, readRepairReport } = require('../electron/install-repair');
const { BuyerLogUpdater } = require('../electron/update/updater');
const { createZipFromDirectory } = require('../electron/update/zip');

const APP = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl-repair-'));
function core(root, version) {
  for (const [rel, body] of Object.entries({
    'package.json': JSON.stringify({ version }),
    'electron/main.js': '// main',
    'server/server.js': '// server',
    'public/index.html': '<!doctype html>',
    'public/buyerlog-guide.js': '// F1 guide ' + version,
  })) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); }
  return root;
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('integrity manifest detects missing and stale files', async t => {
  const root = tmp(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  core(root, '7.0.184');
  writeIntegrityManifest(root, { version: '7.0.184' });
  assert.equal((await verifyIntegrity(root, { version: '7.0.184' })).status, 'ok');
  fs.writeFileSync(path.join(root, 'public/buyerlog-guide.js'), '// old');
  fs.rmSync(path.join(root, 'server/server.js'));
  const result = await verifyIntegrity(root, { version: '7.0.184' });
  assert.equal(result.status, 'damaged');
  assert.deepEqual(result.changed, ['public/buyerlog-guide.js']);
  assert.deepEqual(result.missing, ['server/server.js']);
  assert.equal((await verifyIntegrity(tmp(), {})).status, 'no-manifest');
});

test('updater state cleanup unblocks updates without touching newer records', () => {
  const { state, actions } = cleanUpdaterState({
    state: 'ROLLBACK', latestVersion: '7.0.184', lastKnownGoodVersion: '7.0.185',
    lastError: { code: 'UPDATE_HEALTH_FAILED' },
    failedVersions: { '7.0.183': { sha256: 'a' }, '7.0.184': { sha256: 'b' }, '7.0.190': { sha256: 'c' } },
    pending: { version: '7.0.183', ready: true },
  }, '7.0.184');
  assert.deepEqual(Object.keys(state.failedVersions), ['7.0.190']);
  assert.equal(state.pending, null);
  assert.equal(state.state, 'IDLE');
  assert.equal(state.lastError, null);
  assert.equal(state.lastKnownGoodVersion, '7.0.184');
  assert.ok(actions.includes('failed-record-cleared:7.0.183'));
  const keep = cleanUpdaterState({ state: 'FAILED', latestVersion: '7.0.190', failedVersions: {}, lastError: { code: 'X' } }, '7.0.184');
  assert.equal(keep.state.state, 'FAILED', 'newer failing release stays visible');
});

test('repair runs once per version, clears renderer cache and records the report', async t => {
  const portable = tmp(); t.after(() => fs.rmSync(portable, { recursive: true, force: true }));
  const appCore = core(path.join(portable, 'resources', 'app'), '7.0.184');
  writeIntegrityManifest(appCore, { version: '7.0.184' });
  const localDataRoot = path.join(portable, 'data', 'local');
  const updater = new BuyerLogUpdater({ currentVersion: '7.0.184', appCoreRoot: appCore, portableRoot: portable, localDataRoot, packaged: true });
  updater.saveState({ state: 'ROLLBACK', failedVersions: { '7.0.183': { sha256: 'x' } }, lastError: { code: 'UPDATE_HEALTH_FAILED' } });
  const cleared = [];
  const session = { defaultSession: { clearCache: async () => cleared.push('cache'), clearStorageData: async o => cleared.push(o.storages.join(',')) } };
  const first = await runInstallRepair({ localDataRoot, appCoreRoot: appCore, currentVersion: '7.0.184', updater, session, packaged: true });
  await first.integrity;
  assert.equal(first.skipped, false);
  assert.deepEqual(cleared, ['cache', 'serviceworkers,cachestorage,shadercache']);
  assert.equal(updater.state().state, 'IDLE');
  assert.deepEqual(updater.state().failedVersions, {});
  const report = readRepairReport(localDataRoot);
  assert.equal(report.steps.integrity.status, 'ok');
  assert.ok(report.finishedAt);
  const second = await runInstallRepair({ localDataRoot, appCoreRoot: appCore, currentVersion: '7.0.184', updater, session, packaged: true });
  assert.equal(second.skipped, true);
  assert.equal(cleared.length, 2, 'cache is cleared only once per version');
});

test('damaged managed core is restaged from the verified cached package', async t => {
  const portable = tmp(); t.after(() => fs.rmSync(portable, { recursive: true, force: true }));
  const localDataRoot = path.join(portable, 'data', 'local');
  const bootstrap = core(path.join(portable, 'resources', 'app'), '7.0.183');
  const updater = new BuyerLogUpdater({ currentVersion: '7.0.184', appCoreRoot: bootstrap, portableRoot: portable, localDataRoot, packaged: true });
  // Doğrulanmış release paketi (önbellek) ve ondan açılmış yönetilen çekirdek.
  const src = path.join(tmp(), 'app'); core(src, '7.0.184'); writeIntegrityManifest(src, { version: '7.0.184' });
  const zip = path.join(portable, 'pkg.zip'); createZipFromDirectory(src, zip, { rootPrefix: 'app' });
  const hash = sha(zip);
  fs.copyFileSync(zip, path.join(updater.cacheRoot, `7.0.184-${hash.slice(0, 12)}.zip`));
  const versionRoot = path.join(updater.versionsRoot, '7.0.184');
  fs.cpSync(src, path.join(versionRoot, 'app'), { recursive: true });
  fs.writeFileSync(path.join(versionRoot, 'release.json'), JSON.stringify({ version: '7.0.184', sha256: hash, channel: 'stable' }));
  const managed = path.join(versionRoot, 'app');
  fs.writeFileSync(path.join(managed, 'public/buyerlog-guide.js'), '// stale');
  updater.saveState({ lastKnownGoodVersion: '7.0.184' });

  const run = await runInstallRepair({ localDataRoot, appCoreRoot: managed, currentVersion: '7.0.184', updater, packaged: true });
  const report = await run.integrity;
  assert.equal(report.steps.integrity.status, 'damaged');
  assert.equal(report.steps.integrity.restage.restaged, true);
  const pending = updater.state().pending;
  assert.equal(pending.version, '7.0.184');
  assert.equal(pending.ready, true);
  assert.match(pending.appCoreRoot, /7\.0\.184-repair-\d+[\\/]app$/);
  assert.equal(fs.readFileSync(path.join(pending.appCoreRoot, 'public/buyerlog-guide.js'), 'utf8'), '// F1 guide 7.0.184');
  assert.equal((await verifyIntegrity(pending.appCoreRoot, { version: '7.0.184' })).status, 'ok');
});

test('release build embeds the integrity manifest and startup runs the repair before windows', () => {
  const common = fs.readFileSync(path.join(APP, 'scripts', 'release-common.js'), 'utf8');
  assert.match(common, /writeIntegrityManifest\(APP_ROOT,\{version,exclude:excludeRuntime\}\);createZipFromDirectory/);
  assert.match(common, /'public\/index\.html',MANIFEST_REL\]/);
  assert.equal(MANIFEST_REL, 'electron/app-integrity.json');
  const main = fs.readFileSync(path.join(APP, 'electron', 'main.js'), 'utf8');
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'));
  assert.ok(ready.indexOf('await runInstallRepair(') > 0);
  assert.ok(ready.indexOf('await runInstallRepair(') < ready.indexOf('await startBuyerLog();'));
  assert.match(main, /repair:repairSummary\(\)/);
  const ui = fs.readFileSync(path.join(APP, 'public', 'app-main.js'), 'utf8');
  assert.match(ui, /\$\{buyerLogRepairLine\(status\.repair\)\}/);
});

test('same-version signed patch trial, pending identity and rollback failure are preserved by startup repair',()=>{
 const {cleanUpdaterState}=require('../electron/install-repair'),manualPatch={sequence:2};
 for(const state of [
  {schemaVersion:1,state:'INSTALLING',activation:{status:'trial',manualPatch},pending:{version:'7.0.294',manualPatch}},
  {schemaVersion:1,state:'READY_TO_INSTALL',pending:{version:'7.0.294',manualPatch}},
  {schemaVersion:1,state:'ROLLBACK',failedVersions:{'7.0.294':{manualPatch}},lastError:{code:'UPDATE_HEALTH_FAILED',manualPatch}},
 ])assert.deepEqual(cleanUpdaterState(state,'7.0.294').actions,[]);
});
