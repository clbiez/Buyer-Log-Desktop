'use strict';

/* Güvenlik sertleştirmesi — ağ maruziyeti, AI veri politikası, Electron
 * gezinme/IPC, log redaksiyonu ve audit saklama. Her blok neyi koruduğunu
 * kendi başlığında söyler; testler mümkün olduğunca canlı davranışı çalıştırır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');

/* ------------------------------------------------------------ ağ maruziyeti */

test('server bind is loopback by default and never plain-HTTP on the network', () => {
  const { resolveBindHost } = require('../server/lib/net-guard');
  assert.deepEqual(resolveBindHost('127.0.0.1', { hasAuth: false, tls: false }), { host: '127.0.0.1', downgraded: false });
  for (const host of ['0.0.0.0', '::', '192.168.1.20', 'buyerlog.corp.local']) {
    const bind = resolveBindHost(host, { hasAuth: true, tls: false });
    assert.equal(bind.host, '127.0.0.1', host);
    assert.equal(bind.reason, 'TLS_REQUIRED', host);
  }
  const server = read('server/server.js');
  assert.match(server, /resolveBindHost\(REQUESTED_HOST, \{ hasAuth: auth\.enabled, tls: false \}\)/, 'server must not claim TLS it does not terminate');
  assert.doesNotMatch(server, /secureUserGate/, '"every account has a password" no longer unlocks LAN binding');
  assert.match(server, /markStartup\('NETWORK_BIND_DOWNGRADED'/);
  assert.match(read('config.example.json'), /"host": "127\.0\.0\.1"/);
});

/* ------------------------------------------------------------ AI katmanı kaldırıldı */

test('the AI assistant layer is fully removed and leftover AI secrets are wiped on startup', t => {
  for (const rel of ['server/lib/ai-provider-gateway.js', 'server/lib/agent-ai-settings.js', 'server/lib/agent-ai-provider.js', 'server/lib/copilot-agent.js', 'server/lib/copilot-llm.js', 'server/routes/copilot-routes.js', 'public/copilot.js', 'public/octopus-window.js']) {
    assert.equal(fs.existsSync(path.join(APP_ROOT, rel)), false, rel);
  }
  const server = read('server/server.js');
  assert.doesNotMatch(server, /copilot|octopus|agent-ai-provider|\/api\/agent-platform\/(?:ai|plan)/i);
  assert.doesNotMatch(read('public/index.html'), /copilot|octopus/i);
  assert.doesNotMatch(read('package.json'), /groq-sdk/);
  assert.match(server, /removeRetiredAiArtifacts\(/);

  const { removeRetiredAiArtifacts } = require('../server/lib/retired-ai-cleanup');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-retired-ai-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['agent-ai-settings.json', '.agent-ai-secret', 'orders-overrides.json']) fs.writeFileSync(path.join(root, name), 'x');
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ port: 6194, aiEnabled: true, aiApiKey: 'sk-secret', aiModel: 'm' }));
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  const first = removeRetiredAiArtifacts({ serverDataRoot: root, configPath, writeJson });
  assert.deepEqual(first.removed.sort(), ['.agent-ai-secret', 'agent-ai-settings.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { port: 6194 }, 'only ai* config keys are removed');
  assert.equal(fs.existsSync(path.join(root, 'orders-overrides.json')), true, 'business data is untouched');
  const before = fs.statSync(configPath).mtimeMs;
  const second = removeRetiredAiArtifacts({ serverDataRoot: root, configPath, writeJson: () => { throw new Error('must not rewrite'); } });
  assert.deepEqual(second, { removed: [], strippedKeys: [] }, 'idempotent');
  assert.equal(fs.statSync(configPath).mtimeMs, before);
});

/* ------------------------------------------------------------ Electron */

test('Electron navigation uses real URL.origin equality and shell IPC is sender-checked', () => {
  const main = read('electron/main.js');
  const policy = main.slice(main.indexOf('function sameOrigin('), main.indexOf('function uniqueDownloadPath'));
  assert.doesNotMatch(policy, /url\.startsWith\(origin\)/);
  assert.match(policy, /new URL\(String\(url\)\)\.origin === new URL\(String\(origin\)\)\.origin/);
  assert.match(policy, /'will-redirect'/);
  // Re-evaluate the extracted helper to prove the classic bypasses are refused.
  const sameOrigin = new Function(`${policy.slice(0, policy.indexOf('function applyNavigationPolicy'))}; return sameOrigin;`)();
  const origin = 'http://127.0.0.1:6194';
  assert.equal(sameOrigin('http://127.0.0.1:6194/index.html#orders', origin), true);
  for (const url of ['http://127.0.0.1:6194@evil.example/', 'http://127.0.0.1:61940/', 'https://127.0.0.1:6194/', 'http://localhost:6194/', 'javascript:alert(1)', 'file:///C:/x']) {
    assert.equal(sameOrigin(url, origin), false, url);
  }
  for (const channel of ['buyerlog:diagnostics', 'buyerlog:startup-failure', 'buyerlog:open-logs', 'buyerlog:inspect-port', 'buyerlog:close-other', 'buyerlog:retry', 'buyerlog:quit']) {
    const start = main.indexOf(`ipcMain.handle('${channel}'`);
    assert.ok(start > 0, channel);
    assert.match(main.slice(start, start + 260), /trustedDesktopShellSender\(event\)/, `${channel} must verify its sender`);
  }
  assert.match(main, /errorWindow\.webContents\.on\('will-navigate'/);
});

/* ------------------------------------------------------------ redaksiyon */

test('secret redaction covers passwords, connection strings, URL credentials and private keys', () => {
  const { redactSecrets } = require('../shared/secret-redaction');
  const cases = [
    'Server=sql01;User ID=sa;Password=Hunter2!;Database=Buyer',
    'Driver={SQL Server};UID=svc;PWD={p@ss;word};',
    '{"user":"a","password":"Hunter2!"}',
    'passwd: Hunter2!',
    'login failed pwd=Hunter2!',
    'sqlserver://svc:Hunter2!@db.corp.local/buyer',
    'https://api.example.com/x?api_key=Hunter2!&page=2',
    'config {"auth":{"sessionSecret":"Hunter2!","passwordHash":"scrypt$Hunter2!"}}',
    '-----BEGIN PRIVATE KEY-----\nHunter2!\n-----END PRIVATE KEY-----',
    'Authorization: Bearer Hunter2!Hunter2!',
    'x-api-key: Hunter2!',
  ];
  for (const text of cases) assert.equal(redactSecrets(text).includes('Hunter2!'), false, text);
  assert.deepEqual(JSON.parse(redactSecrets(JSON.stringify({ password: 'x', supplier: 'ACME' }))), { password: '[REDACTED]', supplier: 'ACME' }, 'JSON stays parseable');
  for (const text of ['Order 1001 shipped to ACME', 'session expired', 'prompt_tokens: 120', 'compassion']) assert.equal(redactSecrets(text), text);
});

/* ------------------------------------------------------------ audit saklama */

test('audit log rotates into archives instead of growing forever; retention is configurable', t => {
  const access = require('../server/lib/user-access');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-audit-rotation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(access.auditRetention({}), { maxBytes: 20 * 1024 * 1024, maxArchives: 24 });
  assert.deepEqual(access.auditRetention({ BUYER_LOG_AUDIT_MAX_BYTES: '1048576', BUYER_LOG_AUDIT_MAX_ARCHIVES: '0' }), { maxBytes: 1048576, maxArchives: 0 });
  const file = path.join(dir, 'user-audit.jsonl');
  fs.writeFileSync(file, 'x'.repeat(100));
  assert.equal(access.rotateAuditIfNeeded(file, { maxBytes: 1000, maxArchives: 2 }), false, 'small file is not rotated');
  const archived = [];
  for (let i = 0; i < 4; i += 1) {
    fs.writeFileSync(file, `{"id":"r${i}"}\n`.repeat(200));
    const target = access.rotateAuditIfNeeded(file, { maxBytes: 1000, maxArchives: 2 });
    assert.ok(target && fs.existsSync(target), 'forensic records are moved, not deleted');
    archived.push(target);
    assert.equal(fs.existsSync(file), false);
  }
  const archives = access.listAuditArchives(dir);
  assert.equal(archives.length, 2, 'only the newest N archives are retained');
  assert.match(fs.readFileSync(path.join(dir, archives.at(-1)), 'utf8'), /"r3"/);
  const source = read('server/lib/user-access.js');
  assert.match(source, /try \{ rotateAuditIfNeeded\(\); \} catch/, 'rotation failure never blocks audit writes');
});
