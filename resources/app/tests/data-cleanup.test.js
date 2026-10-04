'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDataCleanup, resolveInstallRoot, REMINDER_MIN_BYTES } = require('../server/lib/data-cleanup');

const DAY = 86400000;
async function write(file, body = 'x', ageMs = 0) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body);
  if (ageMs) { const t = new Date(Date.now() - ageMs); await fsp.utimes(file, t, t); }
  return file;
}
async function age(target, ageMs) { const t = new Date(Date.now() - ageMs); await fsp.utimes(target, t, t); }

async function installBox(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-cleanup-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const install = path.join(root, 'Buyer Log');
  const data = path.join(install, 'data');
  const roots = {
    projectRoot: path.join(install, 'resources', 'app'),
    serverDataRoot: path.join(data, 'server'), appDataRoot: path.join(data, 'app'), localDataRoot: path.join(data, 'local'),
    localDbPath: path.join(data, 'local', 'BuyerLogLocal.db'),
  };
  await write(path.join(install, 'BuyerLog.exe'));
  await write(path.join(install, 'ffmpeg.dll'));
  await write(path.join(install, 'resources.pak'));
  await write(path.join(install, 'version'), '35.0.0');
  await write(path.join(install, 'config.json'), '{}');
  await write(path.join(install, 'locales', 'tr.pak'));
  await write(path.join(roots.projectRoot, 'package.json'), '{"version":"7.0.230"}');
  await write(roots.localDbPath, '{}');
  await write(path.join(roots.serverDataRoot, 'business.json'), '{}');
  return { root, install, data, roots };
}

test('local scan flags setup leftovers, keeps runtime files and never offers active data', async t => {
  const x = await installBox(t);
  const zip = await write(path.join(x.install, 'BuyerLog-Desktop-7.0.200.zip'), 'zip');
  const setup = await write(path.join(x.install, 'BuyerLog-Setup.exe'), 'exe');
  const notes = await write(path.join(x.install, 'my-notes.xlsx'), 'user');
  const tool = await write(path.join(x.install, 'helper-tool.exe'), 'exe');
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data, execPath: path.join(x.install, 'BuyerLog.exe'), appVersion: '7.0.230' });
  const plan = await cleanup.scan('local', { moderator: false });
  const byPath = new Map(plan.items.map(item => [item.path, item]));
  assert.equal(byPath.get(path.resolve(zip)).kind, 'archive');
  assert.equal(byPath.get(path.resolve(zip)).selected, true);
  assert.equal(byPath.get(path.resolve(setup)).kind, 'installer');
  assert.equal(byPath.get(path.resolve(setup)).selected, true);
  assert.equal(byPath.get(path.resolve(tool)).selected, false, 'an exe that does not look like a setup package is never pre-selected');
  // Tanınmayan öğe listelenir ama kullanıcı seçmeden silinmez.
  assert.equal(byPath.get(path.resolve(notes)).kind, 'unknown');
  assert.equal(byPath.get(path.resolve(notes)).selected, false);
  for (const keep of ['BuyerLog.exe', 'ffmpeg.dll', 'resources.pak', 'version', 'config.json', 'locales', 'data', 'resources']) {
    assert.equal(byPath.has(path.resolve(x.install, keep)), false, keep);
  }
  assert.ok(plan.kept.some(k => k.label === 'program-files'));
  assert.equal(plan.items.some(item => 'paths' in item), false, 'individual paths must not leak to the client');
});

test('local apply deletes only server-planned ids and keeps the newest data backup', async t => {
  const x = await installBox(t);
  const zip = await write(path.join(x.install, 'old.zip'), 'zip');
  const oldBackup = path.join(x.install, 'data-backup-2024');
  const newBackup = path.join(x.install, 'data-backup-2026');
  await write(path.join(oldBackup, 'local', 'BuyerLogLocal.db'), '{}');
  await write(path.join(newBackup, 'local', 'BuyerLogLocal.db'), '{}');
  await age(oldBackup, 300 * DAY);
  const tempOld = await write(path.join(x.data, 'temp', 'job-1.xlsx'), 'tmp', 3 * DAY);
  const tempNew = await write(path.join(x.data, 'temp', 'job-2.xlsx'), 'tmp');
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data, execPath: path.join(x.install, 'BuyerLog.exe'), appVersion: '7.0.230' });
  const plan = await cleanup.scan('local');
  assert.ok(plan.items.some(item => item.path === path.resolve(oldBackup) && item.kind === 'stale-backup'));
  assert.equal(plan.items.some(item => item.path === path.resolve(newBackup)), false);
  const ids = plan.items.filter(item => item.selected).map(item => item.id);
  const result = await cleanup.apply('local', [...ids, 'forged-id-not-in-plan']);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(fs.existsSync(zip), false);
  assert.equal(fs.existsSync(oldBackup), false);
  assert.equal(fs.existsSync(newBackup), true);
  assert.equal(fs.existsSync(tempOld), false);
  assert.equal(fs.existsSync(tempNew), true, 'recent temp may still be in use');
  assert.equal(fs.existsSync(x.roots.localDbPath), true);
  assert.equal(fs.existsSync(path.join(x.roots.serverDataRoot, 'business.json')), true);
  assert.equal(fs.existsSync(path.join(x.install, 'BuyerLog.exe')), true);
});

test('updater leftovers: only versions outside current/last-good/pending are offered', async t => {
  const x = await installBox(t);
  const versions = path.join(x.install, '.buyerlog-versions');
  await write(path.join(versions, '7.0.230', 'app', 'package.json'), '{}');
  await write(path.join(versions, '7.0.229', 'app', 'package.json'), '{}');
  await write(path.join(versions, '7.0.100', 'app', 'package.json'), '{}');
  await write(path.join(x.install, '.buyerlog-updater', 'cache', '7.0.100-abcdef012345.zip'), 'z');
  await write(path.join(x.install, '.buyerlog-updater', 'cache', '7.0.230-abcdef012345.zip'), 'z');
  await write(path.join(x.roots.localDataRoot, 'updater', 'state.json'), JSON.stringify({ schemaVersion: 1, currentVersion: '7.0.230', lastKnownGoodVersion: '7.0.229', pending: null }));
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data, appVersion: '7.0.230' });
  const paths = (await cleanup.scan('local')).items.map(item => item.path);
  assert.ok(paths.includes(path.resolve(versions, '7.0.100')));
  assert.ok(paths.includes(path.resolve(x.install, '.buyerlog-updater', 'cache', '7.0.100-abcdef012345.zip')));
  assert.equal(paths.includes(path.resolve(versions, '7.0.230')), false);
  assert.equal(paths.includes(path.resolve(versions, '7.0.229')), false);
  assert.equal(paths.includes(path.resolve(x.install, '.buyerlog-updater', 'cache', '7.0.230-abcdef012345.zip')), false);
});

test('a running core inside the install root is never a candidate', async t => {
  const x = await installBox(t);
  const runningCore = path.join(x.install, 'BuyerLog-copy', 'resources', 'app');
  await write(path.join(runningCore, 'package.json'), '{}');
  const cleanup = createDataCleanup({ roots: { ...x.roots, projectRoot: runningCore }, installRoot: x.install, portableDataRoot: x.data });
  const plan = await cleanup.scan('local');
  assert.equal(plan.items.some(item => item.path === path.resolve(x.install, 'BuyerLog-copy')), false);
});

async function hubBox(t) {
  const x = await installBox(t);
  const hub = path.join(x.root, 'hub');
  await write(path.join(hub, 'buyerlog-hub.json'), '{}');
  const syncSettings = { read: async () => ({ sharedSyncRoot: hub, progress: null }) };
  const sharedHub = { validate: async root => ({ ok: true, root, manifest: { layout: { iam: 'iam', sync: 'BUYER_LOG_SYNC', master: 'master', business: 'business', images: 'model-images', personalBackups: 'personal-backups' } } }) };
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data, syncSettings, sharedHub });
  return { ...x, hub, cleanup };
}

test('sync scope is moderator only', async t => {
  const x = await hubBox(t);
  await assert.rejects(() => x.cleanup.scan('sync', { moderator: false }), e => e.code === 'MODERATOR_REQUIRED' && e.statusCode === 403);
  await assert.rejects(() => x.cleanup.apply('sync', ['a'], { moderator: false }), e => e.code === 'MODERATOR_REQUIRED');
});

test('sync scan keeps each user latest backup and other users live sync data', async t => {
  const x = await hubBox(t);
  const area = path.join(x.hub, 'personal-backups', 'ayse');
  const oldZip = await write(path.join(area, 'BuyerLog_Personal_ayse_20250101T000000Z.zip'), 'old', 200 * DAY);
  const midZip = await write(path.join(area, 'BuyerLog_Personal_ayse_20250601T000000Z.zip'), 'mid', 100 * DAY);
  const latestZip = await write(path.join(area, 'BuyerLog_Personal_ayse_20260101T000000Z.zip'), 'new', 1 * DAY);
  await write(path.join(area, 'latest.json'), JSON.stringify({ filename: path.basename(latestZip) }));
  const soloZip = await write(path.join(x.hub, 'personal-backups', 'mehmet', 'BuyerLog_Personal_mehmet_20240101T000000Z.zip'), 'only', 500 * DAY);
  const bundle = await write(path.join(x.hub, 'BUYER_LOG_SYNC', 'changes', 'dev-a', 'bundles', '000001.sync.gz'), 'gz', 400 * DAY);
  const staleTmp = await write(path.join(x.hub, 'BUYER_LOG_SYNC', 'changes', 'dev-a', 'head.json.1234.tmp'), 't', 3 * DAY);
  const liveTmp = await write(path.join(x.hub, 'BUYER_LOG_SYNC', 'changes', 'dev-b', 'head.json.9999.tmp'), 't');
  const stray = await write(path.join(x.hub, 'export-copy.zip'), 'zip');
  const cps = path.join(x.hub, 'master', 'checkpoints');
  const cpNames = [1, 2, 3, 4, 5].map(n => `${String(n).padStart(16, '0')}-aaaaaaaaaaaaaaaa.json.gz`);
  for (const name of cpNames) await write(path.join(cps, name), 'cp');
  await write(path.join(x.hub, 'master', 'current.json'), JSON.stringify({ file: `checkpoints/${cpNames[4]}`, previous: { file: `checkpoints/${cpNames[0]}` } }));

  const plan = await x.cleanup.scan('sync', { moderator: true });
  const paths = new Set(plan.items.map(item => item.path));
  assert.ok(paths.has(path.resolve(oldZip)));
  assert.ok(paths.has(path.resolve(midZip)));
  assert.equal(paths.has(path.resolve(latestZip)), false);
  assert.equal(paths.has(path.resolve(soloZip)), false, 'a user latest backup is kept no matter how old');
  assert.equal(paths.has(path.resolve(bundle)), false, 'peer sync packages stay');
  assert.ok(paths.has(path.resolve(stray)));
  assert.ok(paths.has(path.resolve(cps, cpNames[1])));
  assert.equal(paths.has(path.resolve(cps, cpNames[0])), false, 'referenced previous checkpoint stays');
  assert.equal(paths.has(path.resolve(cps, cpNames[4])), false);

  const result = await x.cleanup.apply('sync', plan.items.filter(i => i.selected).map(i => i.id), { moderator: true });
  assert.equal(result.failed, 0);
  assert.equal(fs.existsSync(oldZip), false);
  assert.equal(fs.existsSync(staleTmp), false);
  assert.equal(fs.existsSync(liveTmp), true, 'fresh temp may belong to a peer writing right now');
  assert.equal(fs.existsSync(latestZip), true);
  assert.equal(fs.existsSync(soloZip), true);
  assert.equal(fs.existsSync(bundle), true);
  assert.equal(fs.existsSync(path.join(x.hub, 'buyerlog-hub.json')), true);
});

test('sync apply is refused while a sync transfer is running', async t => {
  const x = await hubBox(t);
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, syncSettings: { read: async () => ({ sharedSyncRoot: x.hub, progress: { phase: 'upload' } }) }, sharedHub: { validate: async root => ({ root, manifest: {} }) } });
  await assert.rejects(() => cleanup.apply('sync', ['x'], { moderator: true }), e => e.code === 'SYNC_ACTIVE_BLOCKS_CLEANUP');
});

test('install root resolves from the desktop host environment', () => {
  assert.equal(resolveInstallRoot({ env: { BUYER_LOG_PORTABLE_DATA_ROOT: path.join('C:', 'BL', 'data') } }), path.resolve(path.join('C:', 'BL')));
  assert.equal(resolveInstallRoot({ env: {}, projectRoot: path.join(os.tmpdir(), 'no-such-bl', 'resources', 'app') }), '');
});

test('UI contract: Data Cleanup is a lazy Data Management tool and the sync scope is Moderator-gated', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const dm = read('public/data-management.js'), perf = read('public/perf-runtime.js'), ui = read('public/data-cleanup.js'), server = read('server/server.js');
  assert.match(dm, /id: 'cleanup', icon: 'i-eraser', inline: true/);
  assert.match(dm, /tool\.id === 'cleanup' && window\.BLDataCleanup/);
  assert.match(perf, /'data-cleanup\.js\?rev=\d+','data-management\.js\?rev=\d+'/);
  assert.match(ui, /moderator \? scopeBtn\('sync'/);
  // İstemci yalnız kimlik gönderir; yol göndermez.
  assert.match(ui, /JSON\.stringify\(\{ scope: state\.scope, ids: \[\.\.\.state\.selected\] \}\)/);
  assert.match(server, /dataCleanup\.apply\(scope, ids, \{ moderator:dataCleanupIsModerator\(req\) \}\)/);
});

test('weekly check auto-cleans only Buyer Log own stale data and reminds when the rest is significant', async t => {
  const x = await installBox(t);
  const ownTemp = await write(path.join(x.data, 'temp', 'job-old.xlsx'), 'tmp', 3 * DAY);
  const freshTemp = await write(path.join(x.data, 'temp', 'job-new.xlsx'), 'tmp');
  const partial = await write(path.join(x.install, '.buyerlog-updater', 'staging', '7.0.100.partial-1-1', 'x'), 'p');
  await age(path.join(x.install, '.buyerlog-updater', 'staging', '7.0.100.partial-1-1'), 3 * DAY);
  const bigZip = path.join(x.install, 'BuyerLog-Desktop-7.0.100.zip');
  await fsp.writeFile(bigZip, '');
  await fsp.truncate(bigZip, REMINDER_MIN_BYTES + 1);
  const userFile = await write(path.join(x.install, 'my-notes.xlsx'), 'user');
  const oldBackup = path.join(x.install, 'data-backup-old');
  await write(path.join(oldBackup, 'a'), 'a');
  await age(oldBackup, 100 * DAY);
  await write(path.join(x.install, 'data-backup-new', 'a'), 'a');
  let clock = Date.now();
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data, now: () => clock });

  const state = await cleanup.weeklyCheck();
  assert.equal(fs.existsSync(ownTemp), false, 'own stale temp is removed without asking');
  assert.equal(fs.existsSync(partial), false, 'abandoned update extraction is removed without asking');
  assert.equal(fs.existsSync(freshTemp), true);
  assert.equal(fs.existsSync(bigZip), true, 'setup archives need confirmation');
  assert.equal(fs.existsSync(userFile), true);
  assert.equal(fs.existsSync(oldBackup), true, 'backups are never auto-deleted');
  assert.ok(state.autoClean.removed >= 2);

  let reminder = await cleanup.reminder({ moderator: false });
  assert.equal(reminder.due, true);
  assert.equal(reminder.localDue, true);
  assert.ok(reminder.local.size > REMINDER_MIN_BYTES);
  assert.equal(reminder.sync, null, 'non-moderators never see sync totals');

  reminder = await cleanup.dismissReminder();
  assert.equal(reminder.due, false, 'dismissed until the next weekly check');
  clock += 2 * DAY;
  await cleanup.weeklyCheck();
  assert.equal((await cleanup.reminder()).due, false, 'no re-check inside the week');
  clock += 6 * DAY;
  await cleanup.weeklyCheck();
  assert.equal((await cleanup.reminder()).due, true, 'next week reminds again while data is still there');
});

test('no reminder when the remaining cleanup is not significant', async t => {
  const x = await installBox(t);
  await write(path.join(x.install, 'small.zip'), 'tiny');
  const cleanup = createDataCleanup({ roots: x.roots, installRoot: x.install, portableDataRoot: x.data });
  await cleanup.weeklyCheck();
  const reminder = await cleanup.reminder();
  assert.equal(reminder.due, false);
  assert.equal(reminder.local.count, 1);
});

test('UI contract: weekly reminder offers review or snooze and opens the Data Cleanup tool', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const app = read('public/app-main.js'), dm = read('public/data-management.js'), server = read('server/server.js');
  assert.match(app, /fetch\('\/api\/data-cleanup\/reminder'/);
  assert.match(app, /if\(!data\|\|!data\.due\)return;/);
  assert.match(app, /fetch\('\/api\/data-cleanup\/reminder\/dismiss',\{method:'POST'\}\)/);
  assert.match(app, /screen\?\.openTool\?\.\('cleanup'\)/);
  assert.match(dm, /openTool: openToolById/);
  assert.match(server, /setInterval\(runDataCleanupWeeklyCheck, 6 \* 60 \* 60 \* 1000\)/);
});
