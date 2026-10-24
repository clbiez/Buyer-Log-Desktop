'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLauncherState } = require('../electron/update/launcher-state');
const names = ['BuyerLogLocal.db', 'BuyerLogLocal.db.bak', 'BuyerLogLocal.db.wal'];
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-update-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bootstrap = path.join(root, 'bootstrap');
  function core(dir, version) {
    fs.mkdirSync(path.join(dir, 'electron'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(dir, 'electron/main.js'), '');
    return dir;
  }
  core(bootstrap, '1.0.0');
  const factory = extra => createLauncherState({ bootstrapCore: bootstrap, portableRoot: root, makeToken: () => 'synthetic-token', ...options, ...extra });
  const life = factory();
  const next = core(path.join(life.versionsRoot, '1.1.0/app'), '1.1.0');
  for (const name of names) if (!options.absent?.includes(name)) fs.writeFileSync(path.join(life.localDataRoot, name), 'before:' + name);
  life.writeState({ pending: { ready: true, version: '1.1.0', appCoreRoot: next, sha256: 'a'.repeat(64) } });
  return { root, life, factory, activate() { const result = life.activatePending(); assert.ok(result); for (const name of names) fs.writeFileSync(path.join(life.localDataRoot, name), 'after:' + name); return result.activation; } };
}
function contents(life) {
  return Object.fromEntries(names.map(name => [name, fs.existsSync(path.join(life.localDataRoot, name)) ? fs.readFileSync(path.join(life.localDataRoot, name), 'utf8') : null]));
}
for (const name of names.slice(1)) {
  test('missing checkpoint ' + name + ' leaves every live member and app identity unchanged', t => {
    const f = fixture(t), activation = f.activate(), before = contents(f.life), state = fs.readFileSync(f.life.stateFile, 'utf8');
    fs.unlinkSync(path.join(activation.dbSnapshot.root, name));
    assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), { code: 'UPDATE_DB_ROLLBACK_MISSING' });
    assert.deepEqual(contents(f.life), before); assert.equal(f.life.currentPointer().version, '1.1.0');
    assert.equal(fs.readFileSync(f.life.stateFile, 'utf8'), state);
  });
}
for (const mode of ['same-size-corruption', 'truncation', 'directory', 'symlink']) {
  test('complete checkpoint validation rejects ' + mode + ' before any live mutation', t => {
    const f = fixture(t), activation = f.activate(), before = contents(f.life), file = path.join(activation.dbSnapshot.root, names[1]);
    if (mode === 'same-size-corruption') fs.writeFileSync(file, 'x'.repeat(fs.statSync(file).size));
    if (mode === 'truncation') fs.writeFileSync(file, 'short');
    if (mode === 'directory') { fs.unlinkSync(file); fs.mkdirSync(file); }
    if (mode === 'symlink') {
      fs.unlinkSync(file);
      try { fs.symlinkSync(path.join(f.life.localDataRoot, names[0]), file); }
      catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') {
          t.skip('Windows file symlink privilege is unavailable; rollback symlink validation is not verified on this host.');
          return;
        }
        throw error;
      }
    }
    assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), error => error.code === 'UPDATE_DB_ROLLBACK_INVALID');
    assert.deepEqual(contents(f.life), before); assert.equal(f.life.currentPointer().version, '1.1.0');
  });
}
test('absent checkpoint members are explicit tombstones, not accidentally retained trial files', t => {
  const f = fixture(t, { absent: [names[1], names[2]] }), activation = f.activate();
  f.life.rollbackNow(activation, 'synthetic');
  assert.deepEqual(contents(f.life), { [names[0]]: 'before:' + names[0], [names[1]]: null, [names[2]]: null });
  assert.equal(f.life.currentPointer().version, '1.0.0');
});
for (const member of [...names, 'current.json', 'state.json']) {
  test('restart completes an interrupted rollback after replacing ' + member, t => {
    const f = fixture(t), activation = f.activate();
    const interrupted = f.factory({ onTransition: (event, detail) => { if (event === 'rollback-member' && detail.name === member) throw new Error('synthetic process interruption'); } });
    assert.throws(() => interrupted.rollbackNow(activation, 'synthetic'), /synthetic process interruption/);
    assert.ok(fs.existsSync(activation.dbSnapshot.root), 'checkpoint is retained until the entire set commits');
    const restarted = f.factory(), result = restarted.rollbackExistingTrial();
    assert.equal(result.restored.version, '1.0.0');
    assert.deepEqual(contents(restarted), Object.fromEntries(names.map(name => [name, 'before:' + name])));
    assert.equal(restarted.currentPointer().version, '1.0.0'); assert.equal(restarted.readState().currentVersion, '1.0.0');
    assert.equal(restarted.readState().activation, null); assert.ok(restarted.readState().failedVersions['1.1.0']);
    assert.equal(fs.existsSync(activation.dbSnapshot.root), false);
    assert.equal(restarted.rollbackExistingTrial(), null);
  });
}
test('late external database changes after interruption stop recovery instead of overwriting unrelated data', t => {
  const f = fixture(t), activation = f.activate();
  const interrupted = f.factory({ onTransition: event => { if (event === 'rollback-intent') throw new Error('synthetic interruption'); } });
  assert.throws(() => interrupted.rollbackNow(activation, 'synthetic'), /synthetic interruption/);
  fs.writeFileSync(path.join(f.life.localDataRoot, names[1]), 'unrelated acknowledged edit');
  const before = contents(f.life);
  assert.throws(() => f.factory().rollbackExistingTrial(), { code: 'UPDATE_DB_ROLLBACK_CONFLICT' });
  assert.deepEqual(contents(f.life), before); assert.ok(fs.existsSync(activation.dbSnapshot.root));
});
test('trial state is durable before activation pointer changes, and startup can recover interrupted activation', t => {
  const f = fixture(t, { onTransition: event => { if (event === 'activation-pointer') throw new Error('synthetic activation interruption'); } });
  assert.throws(() => f.life.activatePending(), /synthetic activation interruption/);
  const restarted = f.factory({ onTransition: () => {} });
  assert.equal(restarted.rollbackExistingTrial().restored.version, '1.0.0');
  assert.equal(restarted.currentPointer().version, '1.0.0');
});
test('live failure requests rollback for next launch without touching current files or app identity', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  assert.equal(f.life.requestRollback(activation, 'health-timeout'), true);
  assert.deepEqual(contents(f.life), before); assert.equal(f.life.currentPointer().version, '1.1.0');
  assert.equal(f.factory().rollbackExistingTrial().restored.version, '1.0.0');
});
test('live backend PIDs fence rollback before staging or changing any live file', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  const runtime = path.join(f.root, 'data/portable-localappdata/BuyerLog/runtime/watchdog.json');
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.writeFileSync(runtime, JSON.stringify({ serverPid: process.pid, watchdogPid: process.pid }));
  assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), { code: 'UPDATE_DB_ROLLBACK_BUSY' });
  assert.deepEqual(contents(f.life), before);
});
for (const event of ['activation-state', 'activation-pointer']) {
  test('activation interruption at ' + event + ' preserves a recoverable trial before app loading', t => {
    const f = fixture(t, { onTransition: observed => { if (observed === event) throw new Error('synthetic interruption'); } });
    assert.throws(() => f.life.activatePending(), /synthetic interruption/);
    assert.equal(f.factory({ onTransition: () => {} }).rollbackExistingTrial().restored.version, '1.0.0');
  });
}
test('legacy schema-1 snapshots are structurally validated and retain explicit unverified-digest provenance', t => {
  const f = fixture(t), activation = f.activate();
  activation.dbSnapshot.files = activation.dbSnapshot.files.map(({ name, exists }) => ({ name, exists }));
  delete activation.dbSnapshot.formatVersion;
  fs.writeFileSync(path.join(activation.dbSnapshot.root, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files: activation.dbSnapshot.files }));
  f.life.rollbackNow(activation, 'legacy migration');
  assert.equal(f.life.readState().rollbackLegacyCheckpoint, true);
  assert.deepEqual(contents(f.life), Object.fromEntries(names.map(name => [name, 'before:' + name])));
});
test('backend PIDs captured in the rollback request remain a fence even if runtime metadata disappears', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  const runtime = path.join(f.root, 'data/portable-localappdata/BuyerLog/runtime/watchdog.json');
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.writeFileSync(runtime, JSON.stringify({ serverPid: process.pid }));
  f.life.requestRollback(activation, 'synthetic'); fs.unlinkSync(runtime);
  assert.throws(() => f.factory().rollbackExistingTrial(), { code: 'UPDATE_DB_ROLLBACK_BUSY' });
  assert.deepEqual(contents(f.life), before);
});
test('late health acknowledgment cannot erase a requested rollback checkpoint', t => {
  const f = fixture(t), activation = f.activate();
  f.life.requestRollback(activation, 'health-timeout');
  assert.equal(f.life.confirmHealth(activation.token, { version: '1.1.0', backendReady: true, rendererReady: true, localDbReady: true }), false);
  assert.ok(fs.existsSync(activation.dbSnapshot.root));
  assert.equal(f.factory().rollbackExistingTrial().restored.version, '1.0.0');
});
test('real abrupt process termination after WAL replacement resumes the whole transaction on next launch', t => {
  const f = fixture(t), activation = f.activate();
  const script = `const {createLauncherState}=require(${JSON.stringify(path.join(__dirname, '../electron/update/launcher-state'))});const life=createLauncherState({bootstrapCore:${JSON.stringify(path.join(f.root, 'bootstrap'))},portableRoot:${JSON.stringify(f.root)},onTransition:(event,item)=>{if(event==='rollback-member'&&item.name==='BuyerLogLocal.db.wal')process.exit(91);}});life.rollbackExistingTrial();`;
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', script]);
  assert.equal(result.status, 91);
  assert.ok(fs.existsSync(activation.dbSnapshot.root));
  const restarted = f.factory(); assert.equal(restarted.rollbackExistingTrial().restored.version, '1.0.0');
  assert.deepEqual(contents(restarted), Object.fromEntries(names.map(name => [name, 'before:' + name])));
});
test('a staging disk-full failure changes no live member or pointer and retains the checkpoint', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life), copy = fs.copyFileSync;
  fs.copyFileSync = (source, destination, ...rest) => {
    if (destination.includes(path.sep + 'restore' + path.sep)) throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' });
    return copy(source, destination, ...rest);
  };
  try { assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), { code: 'ENOSPC' }); }
  finally { fs.copyFileSync = copy; }
  assert.deepEqual(contents(f.life), before); assert.equal(f.life.currentPointer().version, '1.1.0');
  assert.ok(fs.existsSync(activation.dbSnapshot.root));
});
test('duplicate or incomplete member metadata fails closed before restoration', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  activation.dbSnapshot.files[1] = activation.dbSnapshot.files[0];
  assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), { code: 'UPDATE_DB_ROLLBACK_INVALID' });
  assert.deepEqual(contents(f.life), before);
});
test('corrupt staged payload is rejected before further mutation and backup cleanup', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  const interrupted = f.factory({ onTransition: event => { if (event === 'rollback-intent') throw new Error('synthetic interruption'); } });
  assert.throws(() => interrupted.rollbackNow(activation, 'synthetic'), /synthetic interruption/);
  fs.writeFileSync(path.join(activation.dbSnapshot.root, 'restore', names[2]), 'corrupt staged WAL');
  assert.throws(() => f.factory().rollbackExistingTrial(), { code: 'UPDATE_DB_ROLLBACK_INVALID' });
  assert.deepEqual(contents(f.life), before); assert.ok(fs.existsSync(activation.dbSnapshot.root));
});
test('a live orphan server remains fenced after diagnostic runtime metadata is deleted', async t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); });
  const { ledgerFile } = require('../server/lib/update-trial-backend');
  const ledger = ledgerFile(f.life.localDataRoot, activation.token);
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, token: activation.token, watchdogPid: 2147483647, serverPid: child.pid }));
  const runtime = path.join(f.root, 'data/portable-localappdata/BuyerLog/runtime/watchdog.json');
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.writeFileSync(runtime, JSON.stringify({ serverPid: child.pid, watchdogPid: 2147483647 }));
  fs.unlinkSync(runtime); // Existing watchdog shutdown deletes this before the child exits.
  assert.throws(() => f.life.rollbackNow(activation, 'synthetic'), { code: 'UPDATE_DB_ROLLBACK_BUSY' });
  assert.deepEqual(contents(f.life), before);
  child.kill('SIGKILL'); await exited;
  assert.equal(f.life.rollbackNow(activation, 'synthetic').version, '1.0.0');
});
test('legacy trials without the writer-start protocol fail closed with data and checkpoint preserved', t => {
  const f = fixture(t), activation = f.activate(), before = contents(f.life);
  delete activation.backendFenceVersion;
  f.life.writeState({ activation });
  assert.throws(() => f.factory().rollbackExistingTrial(), { code: 'UPDATE_DB_ROLLBACK_LEGACY_UNVERIFIED' });
  assert.deepEqual(contents(f.life), before); assert.ok(fs.existsSync(activation.dbSnapshot.root));
});
test('real app candidates without the startup fence are rejected before activation, not silently launched', t => {
  const f = fixture(t), candidate = f.life.readState().pending.appCoreRoot;
  fs.mkdirSync(path.join(candidate, 'server'), { recursive: true });
  fs.writeFileSync(path.join(candidate, 'server/server.js'), "require('fs'); // legacy server without startup fence");
  assert.equal(f.life.activatePending(), null);
  assert.equal(f.life.readState().lastError.code, 'UPDATE_RECOVERY_PROTOCOL_REQUIRED');
  assert.equal(f.life.currentPointer().version, '1.0.0');
});
test('malformed manifest or recovery intent reports a structured integrity error without writes', t => {
  const first = fixture(t), activation = first.activate(), before = contents(first.life);
  fs.writeFileSync(path.join(activation.dbSnapshot.root, 'manifest.json'), 'null');
  assert.throws(() => first.life.rollbackNow(activation, 'synthetic'), { code: 'UPDATE_DB_ROLLBACK_INVALID' });
  assert.deepEqual(contents(first.life), before);
  const second = fixture(t), other = second.activate(), otherBefore = contents(second.life);
  const interrupted = second.factory({ onTransition: event => { if (event === 'rollback-intent') throw new Error('synthetic interruption'); } });
  assert.throws(() => interrupted.rollbackNow(other, 'synthetic'), /synthetic interruption/);
  fs.writeFileSync(path.join(second.life.localUpdaterRoot, 'rollback-intent.json'), 'null');
  assert.throws(() => second.factory().rollbackExistingTrial(), { code: 'UPDATE_DB_ROLLBACK_INVALID' });
  assert.deepEqual(contents(second.life), otherBefore);
});
