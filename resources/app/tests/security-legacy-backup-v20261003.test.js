'use strict';

/* Güvenlik sertleştirmesi — eski .blgbackup zinciri (/api/backup/export →
 * exportBackupToFile). Önceden SERVER_DATA_ROOT/APP_DATA_ROOT altındaki HER
 * dosya ve ham config.json (dış parola hash'i + oturum imza sırrı) pakete
 * giriyordu: kullanıcı/şifre hash deposu, audit, AI anahtarı + onu çözen
 * .agent-ai-secret, database kimlik bilgileri dahil. Bu test şunları korur:
 *  1. Export kimlik/sır materyali içermez; config sırsız yazılır.
 *  2. Restore iş verisini geri getirir ama kimlik/sır dosyalarını ne yazar
 *     ne siler; mevcut parola hash'i/oturum sırrı korunur.
 *  3. Eski (v1) ve elle hazırlanmış yedekler de user-access.json'u ezemez.
 *  4. HTTP uçları tam sistem kapsamı nedeniyle moderatöre kapalıdır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-legacy-backup-sec-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const userData = require('../server/user-data');
const { isSensitiveBackupPath } = require('../server/lib/backup-sensitivity');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const SECRET_MARKER = 'TOP-SECRET-MARKER-7f3a';
const SECRET_FILES = {
  serverData: [
    'user-access.json', 'user-access.json.bak', 'user-audit.jsonl', '.agent-ai-secret', 'agent-ai-settings.json',
    'agent-browser-settings.json', 'browser-debug-settings.json', 'sync-settings.json', '.global-flow-earth-secret',
    'corenectum-token.json', 'oab-session.json', 'certs/server.key', 'certs/client.pfx', '.env', 'sessions/s1.json',
    'browser-profiles/edge/Default/Cookies',
  ],
  appData: ['auth/user-access.json', 'auth/user-audit.jsonl', '.database-credential-key', 'database-credentials.json'],
};

function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function seed() {
  for (const [scope, list] of Object.entries(SECRET_FILES)) {
    const base = scope === 'serverData' ? userData.SERVER_DATA_ROOT : userData.APP_DATA_ROOT;
    for (const rel of list) write(path.join(base, rel), `${SECRET_MARKER}:${rel}`);
  }
  write(path.join(userData.SERVER_DATA_ROOT, 'orders-overrides.json'), JSON.stringify({ order: 1001, note: 'business' }));
  write(path.join(userData.APP_DATA_ROOT, 'user-source-data', 'u1', 'asas.json'), JSON.stringify({ rows: [1, 2, 3] }));
  write(userData.CONFIG_PATH, JSON.stringify({
    port: 6194, host: '127.0.0.1', aiModel: 'gemma4:12b',
    auth: { passwordHash: `scrypt$${SECRET_MARKER}`, sessionSecret: `${SECRET_MARKER}-session`, sessionHours: 12 },
  }));
}
function backupText(file) { return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'); }

test('backup sensitivity predicate covers auth, audit, key and credential material', () => {
  for (const list of Object.values(SECRET_FILES)) for (const rel of list) assert.equal(isSensitiveBackupPath(rel), true, rel);
  for (const rel of ['orders-overrides.json', 'user-source-data/u1/asas.json', 'collection-workspace.json', 'BuyerLogLocal.db']) {
    assert.equal(isSensitiveBackupPath(rel), false, rel);
  }
});

test('legacy v2 export carries business data but no secret/auth/AI key material; config is sanitized', async () => {
  seed();
  const backup = await userData.exportBackupToFile({
    appVersion: '7.0.225',
    browserStorage: { theme: 'dark', 'bl.user.u1.aiApiKey': SECRET_MARKER, 'bl.user.u1.view': JSON.stringify({ cols: 3, token: SECRET_MARKER }) },
  });
  try {
    const text = backupText(backup.path);
    const records = text.trimEnd().split('\n').map(line => JSON.parse(line));
    const paths = records.filter(r => r.record === 'fileStart').map(r => `${r.scope}:${r.path}`);
    assert.ok(paths.includes('serverData:orders-overrides.json'), 'business data must still be exported');
    assert.ok(paths.includes('appData:user-source-data/u1/asas.json'));
    assert.ok(paths.includes('config:config.json'));
    for (const p of paths) assert.equal(isSensitiveBackupPath(p.split(':')[1]) && !p.startsWith('config:'), false, `secret path exported: ${p}`);
    const decoded = Buffer.concat(records.filter(r => r.record === 'fileChunk' || r.record === 'browserChunk').map(r => Buffer.from(r.base64, 'base64'))).toString('utf8');
    assert.equal(decoded.includes(SECRET_MARKER), false, 'no secret content may appear in the backup payload');
    assert.equal(text.includes(SECRET_MARKER), false);
    assert.match(decoded, /"aiModel": "gemma4:12b"/, 'non-secret config is preserved');
    assert.match(decoded, /"theme":"dark"/);
  } finally { backup.cleanup(); }
});

test('legacy restore brings business data back and never overwrites or deletes current secrets', async () => {
  seed();
  const backup = await userData.exportBackupToFile({ appVersion: '7.0.225', browserStorage: { theme: 'dark', 'bl.user.u1.fob': '1.50' } });
  try {
    // State drifts after the backup: business data changes, secrets rotate.
    write(path.join(userData.SERVER_DATA_ROOT, 'orders-overrides.json'), JSON.stringify({ order: 1001, note: 'changed' }));
    write(path.join(userData.SERVER_DATA_ROOT, 'user-access.json'), 'CURRENT-USERS');
    write(path.join(userData.SERVER_DATA_ROOT, '.agent-ai-secret'), 'CURRENT-AI-SECRET');
    write(userData.CONFIG_PATH, JSON.stringify({ port: 7000, auth: { passwordHash: 'scrypt$CURRENT', sessionSecret: 'CURRENT-SESSION', sessionHours: 8 } }));
    const restored = await userData.restoreBackupFromFile(backup.path);
    assert.equal(restored.ok, true);
    assert.equal(restored.browserStorage.theme, 'dark');
    assert.equal(restored.browserStorage['bl.user.u1.fob'], '1.50', 'plain values are restored byte-for-byte');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, 'orders-overrides.json'), 'utf8')).note, 'business');
    assert.equal(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, 'user-access.json'), 'utf8'), 'CURRENT-USERS', 'restore must not delete/replace the account store');
    assert.equal(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, '.agent-ai-secret'), 'utf8'), 'CURRENT-AI-SECRET');
    assert.equal(fs.readFileSync(path.join(userData.APP_DATA_ROOT, '.database-credential-key'), 'utf8').startsWith(SECRET_MARKER), true);
    const config = JSON.parse(fs.readFileSync(userData.CONFIG_PATH, 'utf8'));
    assert.equal(config.port, 6194, 'non-secret config comes from the backup');
    assert.equal(config.auth.passwordHash, 'scrypt$CURRENT', 'current outer password hash is preserved');
    assert.equal(config.auth.sessionSecret, 'CURRENT-SESSION', 'current session signing secret is preserved');
  } finally { backup.cleanup(); }
});

test('crafted legacy v1 backup cannot inject accounts, keys or config secrets', () => {
  seed();
  write(path.join(userData.SERVER_DATA_ROOT, 'user-access.json'), 'CURRENT-USERS');
  write(userData.CONFIG_PATH, JSON.stringify({ auth: { passwordHash: 'scrypt$CURRENT' } }));
  const file = (scope, rel, text) => { const b = Buffer.from(text); return { scope, path: rel, size: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'), base64: b.toString('base64') }; };
  const manifest = {
    format: 'buyer-log-backup', schemaVersion: 1, appVersion: '2.70', createdAt: new Date().toISOString(),
    browserStorage: { theme: 'light', sessionToken: 'stolen' },
    managedScopes: ['serverData', 'config'],
    files: [
      file('serverData', 'user-access.json', '{"moderator":{"username":"attacker"}}'),
      file('serverData', '.agent-ai-secret', 'ATTACKER-KEY'),
      file('serverData', 'orders-overrides.json', '{"order":1}'),
      file('config', 'config.json', JSON.stringify({ host: '127.0.0.1', auth: { passwordHash: 'scrypt$ATTACKER', sessionSecret: 'ATTACKER' } })),
    ],
  };
  const result = userData.restoreBackup(zlib.gzipSync(Buffer.from(JSON.stringify(manifest))));
  assert.equal(result.ok, true);
  assert.equal(result.browserStorage.sessionToken, undefined);
  assert.equal(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, 'user-access.json'), 'utf8'), 'CURRENT-USERS');
  assert.equal(fs.existsSync(path.join(userData.SERVER_DATA_ROOT, '.agent-ai-secret')), true);
  assert.notEqual(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, '.agent-ai-secret'), 'utf8'), 'ATTACKER-KEY');
  const config = JSON.parse(fs.readFileSync(userData.CONFIG_PATH, 'utf8'));
  assert.equal(config.auth.passwordHash, 'scrypt$CURRENT');
  assert.equal(config.auth.sessionSecret, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData.SERVER_DATA_ROOT, 'orders-overrides.json'), 'utf8')).order, 1);
});

test('legacy v1 export is sanitized the same way', () => {
  seed();
  const text = zlib.gunzipSync(userData.exportBackup({ appVersion: '2.71', browserStorage: { apiKey: SECRET_MARKER, theme: 'x' } })).toString('utf8');
  const manifest = JSON.parse(text);
  assert.equal(manifest.files.some(f => isSensitiveBackupPath(f.path) && f.scope !== 'config'), false);
  assert.equal(Buffer.concat(manifest.files.map(f => Buffer.from(f.base64, 'base64'))).toString('utf8').includes(SECRET_MARKER), false);
  assert.equal(text.includes(SECRET_MARKER), false);
  assert.equal(manifest.browserStorage.theme, 'x');
});

test('legacy full-system backup routes are moderator-only', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  for (const route of ["app.post('/api/backup/export'", "app.post('/api/backup/restore'"]) {
    const line = server.slice(server.indexOf(route), server.indexOf('\n', server.indexOf(route)));
    assert.match(line, /requirePermission\('manageBackup'\), userAccess\.requireModerator/, route);
  }
});
