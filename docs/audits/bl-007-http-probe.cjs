'use strict';
// Standalone normal-server diagnostic. Synthetic fixtures only; never uses an installation.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), net = require('node:net');
const { spawn } = require('node:child_process');
const APP = path.resolve(__dirname, '../../resources/app'), PORT = 6297;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  await new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(PORT, '127.0.0.1', () => socket.close(resolve)); });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-owned-temp-http-'));
  const env = { ...process.env }, paths = {};
  for (const key of Object.keys(env)) if (key.startsWith('BUYER_LOG_')) delete env[key];
  for (const [key, name] of Object.entries({ BUYER_LOG_DATA_ROOT: 'app', BUYER_LOG_LOCAL_DATA_ROOT: 'local', BUYER_LOG_SERVER_DATA_ROOT: 'server', BUYER_LOG_AUTH_DATA_ROOT: 'local/auth' })) {
    paths[key] = env[key] = path.join(root, name); fs.mkdirSync(env[key], { recursive: true });
  }
  const systemTemp = path.join(root, 'system-temp'); fs.mkdirSync(systemTemp);
  env.TMPDIR = env.TMP = env.TEMP = systemTemp;
  env.BUYER_LOG_CENTRAL_IAM_ENABLED = '0'; env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');
  fs.mkdirSync(path.join(root, 'empty-source'));
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH, JSON.stringify({ port: PORT, host: '127.0.0.1', centralIamEnabled: false, refreshWithExcel: false, updates: { enabled: false }, sourceFolder: path.join(root, 'empty-source') }));
  const iam = require(path.join(APP, 'server/lib/iam-core')), salt = crypto.randomBytes(16), password = 'Synthetic-owned-temp-123';
  const hash = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(password, salt, 32).toString('hex');
  fs.writeFileSync(path.join(env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(iam.migrateStore({ schemaVersion: 8, _revision: 0, users: [], orderAccess: {}, moderator: { id: 'moderator', role: 'moderator', systemRole: 'moderator', username: 'temp-audit', displayName: 'Synthetic Temp Audit', enabled: true, passwordHash: hash, pinHash: hash, permissions: {}, accessAreas: {} } })));
  const foreign = path.join(systemTemp, 'unrelated-private'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'sentinel'), 'keep');
  const ownedTemp = path.join(systemTemp, 'BuyerLog' + (typeof process.getuid === 'function' ? '-' + process.getuid() : ''));
  const logs = path.join(env.BUYER_LOG_LOCAL_DATA_ROOT, 'logs'), drafts = path.join(ownedTemp, 'BuyerLog-email-drafts');
  let child, fd;
  const base = 'http://127.0.0.1:' + PORT;
  try {
    fs.chmodSync(foreign, 0);
    fd = fs.openSync(path.join(root, 'server.log'), 'w');
    child = spawn(process.execPath, ['server/server.js'], { cwd: APP, env, stdio: ['ignore', fd, fd] });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode != null) throw new Error('Synthetic server stopped before readiness.');
      try { if ((await fetch(base + '/api/current-user')).ok) break; } catch (_) {}
      if (i === 149) throw new Error('Synthetic server readiness timed out.');
      await pause(100);
    }
    const login = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'temp-audit', password }) });
    if (login.status !== 200) throw new Error('Synthetic login failed.');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const call = (url, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const before = await call('/api/user-data/inventory'), initial = await before.json();
    const exported = await call('/api/backup/export', {}), initialBytes = (await exported.arrayBuffer()).byteLength;
    for (const dir of [logs, drafts]) fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(logs, 0); fs.chmodSync(drafts, 0); fs.chmodSync(ownedTemp, 0o300);
    const warningResponse = await call('/api/user-data/inventory'), warningInventory = await warningResponse.json();
    const warnedExport = await call('/api/backup/export', {}), warningBytes = (await warnedExport.arrayBuffer()).byteLength;
    const actualPermissionDenials = [];
    for (const dir of [foreign, logs, ownedTemp, drafts]) { try { fs.readdirSync(dir); } catch (error) { actualPermissionDenials.push(error.code); } }
    const result = { environment: { node: process.version, platform: process.platform, uid: typeof process.getuid === 'function' ? process.getuid() : null }, foreignTempInventoryStatus: before.status, defaultRootOwned: initial.roots?.find(item => item.id === 'temp')?.root === ownedTemp, initialExportStatus: exported.status, initialBytes, unavailableDiagnosticInventoryStatus: warningResponse.status, warnings: warningInventory.warnings, diagnosticRoots: warningInventory.roots?.filter(item => item.backupIncluded === false).map(({ id, available, fileCount, bytes }) => ({ id, available, fileCount, bytes })), warnedExportStatus: warnedExport.status, warningBytes, actualPermissionDenials };
    if (before.status !== 200 || exported.status !== 200 || warningResponse.status !== 200 || warnedExport.status !== 200 || warningInventory.warnings?.length !== 3) throw new Error(JSON.stringify(result));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (child && child.exitCode == null) { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(3000)]); if (child.exitCode == null) child.kill('SIGKILL'); }
    if (fd != null) fs.closeSync(fd);
    for (const dir of [foreign, logs, ownedTemp, drafts]) { try { fs.chmodSync(dir, 0o700); } catch (_) {} }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
