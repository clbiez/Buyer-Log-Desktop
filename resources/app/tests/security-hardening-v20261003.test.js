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

/* ------------------------------------------------------------ AI uç noktaları */

test('local AI providers keep working over loopback HTTP; remote endpoints require HTTPS', () => {
  const gateway = require('../server/lib/ai-provider-gateway');
  assert.equal(gateway.normalizeEndpoint('ollama', 'http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(gateway.normalizeEndpoint('lmstudio', 'http://localhost:1234/v1'), 'http://localhost:1234/v1');
  assert.equal(gateway.normalizeEndpoint('openai-compatible', 'http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1');
  assert.equal(gateway.normalizeEndpoint('openai-compatible', 'https://llm.example.com/v1'), 'https://llm.example.com/v1');
  for (const url of ['http://10.0.0.5:8000/v1', 'http://llm.corp.local/v1', 'http://api.openai.com/v1', 'http://127.example.com/v1']) {
    assert.throws(() => gateway.normalizeEndpoint('openai-compatible', url), err => err.code === 'AI_ENDPOINT_INSECURE', url);
    assert.throws(() => gateway.createProvider({ provider: 'openai-compatible', endpoint: url, model: 'm' }, { fetch: async () => { throw new Error('must not be called'); } }), err => err.code === 'AI_ENDPOINT_INSECURE', url);
  }
  assert.throws(() => gateway.normalizeEndpoint('ollama', 'https://10.0.0.5:11434'), err => err.code === 'AI_ENDPOINT_NOT_LOCAL');
  assert.equal(gateway.isRemoteEndpoint('openai-compatible', 'https://llm.example.com/v1'), true);
  assert.equal(gateway.isRemoteEndpoint('openai-compatible', 'http://127.0.0.1:8000/v1'), false);
  assert.equal(gateway.isRemoteEndpoint('openrouter', ''), true);
  assert.throws(() => gateway.createProvider({ provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', model: 'm', remoteDataPolicy: 'blocked' }), err => err.code === 'AI_REMOTE_DATA_POLICY_REQUIRED');
});

function isolatedAi(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-ai-policy-'));
  const saved = {};
  for (const key of ['BUYER_LOG_SERVER_DATA_ROOT', 'OPENAI_API_KEY', 'BUYER_LOG_AGENT_OPENAI_API_KEY', 'BUYER_LOG_AGENT_PROVIDER', 'BUYER_LOG_AGENT_BASE_URL', 'BUYER_LOG_AGENT_ENDPOINT', 'BUYER_LOG_AGENT_REMOTE_DATA_POLICY', 'BUYER_LOG_OPENROUTER_API_KEY', 'BUYER_LOG_NVIDIA_API_KEY', 'NVIDIA_API_KEY']) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  const modules = ['../server/user-data', '../server/lib/agent-ai-settings', '../server/lib/copilot-agent'].map(id => require.resolve(id));
  const clear = () => modules.forEach(id => { delete require.cache[id]; });
  clear();
  t.after(() => {
    clear();
    for (const [key, value] of Object.entries(saved)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, aiSettings: require('../server/lib/agent-ai-settings') };
}

test('custom OpenAI-compatible remote endpoint needs explicit data-policy consent; local endpoint does not', t => {
  const { aiSettings } = isolatedAi(t);
  const gateway = require('../server/lib/ai-provider-gateway');
  aiSettings.saveSettings({ provider: 'ollama', model: 'gemma4:12b' });
  assert.equal(aiSettings.credentials().remoteDataPolicy, 'local');
  assert.doesNotThrow(() => gateway.createProvider(aiSettings.credentials()), 'local Ollama is unaffected');

  assert.throws(() => aiSettings.saveSettings({ provider: 'openai-compatible', endpoint: 'http://10.1.2.3:8000/v1', model: 'gpt-x' }), err => err.code === 'AI_ENDPOINT_INSECURE');
  const saved = aiSettings.saveSettings({ provider: 'openai-compatible', endpoint: 'https://llm.example.com/v1', model: 'gpt-x', apiKey: 'sk-test-1234567890' });
  assert.equal(saved.customRemoteDataPolicy, 'off', 'default OFF');
  assert.equal(saved.remoteDataPolicy, 'blocked');
  assert.throws(() => gateway.createProvider(aiSettings.credentials()), err => err.code === 'AI_REMOTE_DATA_POLICY_REQUIRED');

  const allowed = aiSettings.saveSettings({ customRemoteDataPolicy: 'allowed' });
  assert.equal(allowed.remoteDataPolicy, 'allowed');
  assert.doesNotThrow(() => gateway.createProvider(aiSettings.credentials()));

  aiSettings.saveSettings({ provider: 'openai-compatible', endpoint: 'http://127.0.0.1:8000/v1', customRemoteDataPolicy: 'off' });
  assert.equal(aiSettings.credentials().remoteDataPolicy, 'local', 'loopback custom server is local');
});

test('a stored legacy plain-HTTP remote endpoint is blocked without breaking the settings screen', t => {
  const { root, aiSettings } = isolatedAi(t);
  const gateway = require('../server/lib/ai-provider-gateway');
  fs.writeFileSync(path.join(root, 'agent-ai-settings.json'), JSON.stringify({ provider: 'openai-compatible', endpoint: 'http://10.9.8.7:8000/v1', model: 'gpt-x', customRemoteDataPolicy: 'allowed' }));
  const pub = aiSettings.publicSettings();
  assert.equal(pub.endpointError, 'AI_ENDPOINT_INSECURE');
  assert.throws(() => gateway.createProvider(aiSettings.credentials()), err => err.code === 'AI_ENDPOINT_INSECURE');
});

test('a generic OPENAI_API_KEY in the environment no longer silently switches Buyer Log to a cloud provider', t => {
  const { aiSettings } = isolatedAi(t);
  process.env.OPENAI_API_KEY = 'sk-env-abcdef123456';
  assert.equal(aiSettings.credentials().provider, 'ollama');
  process.env.BUYER_LOG_AGENT_OPENAI_API_KEY = 'sk-buyerlog-123456';
  const creds = aiSettings.credentials();
  assert.equal(creds.provider, 'openai-compatible');
  assert.equal(creds.remoteDataPolicy, 'blocked', 'even the app-specific key needs explicit consent for api.openai.com');
});

/* ------------------------------------------------------------ bulut fallback */

function failingLocalAssistant(copilot, counters) {
  return copilot.createCopilotAssistant({
    providerFactory: overrides => ({
      config: { provider: 'ollama', model: (overrides && overrides.model) || 'gemma4:12b' },
      async resolveModel() { return { model: null, matched: false, supportsTools: false, capabilities: [], notice: 'none' }; },
      async chat() { counters.local += 1; throw Object.assign(new Error('offline'), { code: 'AI_PROVIDER_OFFLINE' }); },
      async listModels() { throw Object.assign(new Error('offline'), { code: 'AI_PROVIDER_OFFLINE' }); },
    }),
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() { counters.cloud += 1; return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'cloud' }), model: creds.model }; },
    }),
    recordNvidiaHealth: () => {},
  });
}
async function ask(assistant) {
  const { createToolRegistry } = require('../server/lib/agent-tool-registry');
  const { createPolicyEngine } = require('../server/lib/agent-policy-engine');
  const userAccess = { hasArea: () => true, appendAudit() {} };
  return assistant.respond({ question: 'Tedarikçi X siparişleri?', language: 'tr', profile: { id: 'u1', areas: ['orders'] }, ownerId: 'u1', toolRegistry: createToolRegistry({ userAccess, getDataset: async () => [] }), policyEngine: createPolicyEngine({ userAccess }) });
}

test('cloud fallback never happens while the OpenRouter data policy is OFF, even with key + enabled', async t => {
  const { aiSettings } = isolatedAi(t);
  aiSettings.saveSettings({ openrouterEnabled: true, openrouterApiKey: 'sk-or-v1-testkey-123456', openrouterDataPolicy: 'off' });
  assert.equal(aiSettings.openrouterCredentials(), null);
  const copilot = require('../server/lib/copilot-agent');
  copilot.resetModelResolutionCache();
  const counters = { local: 0, cloud: 0 };
  await assert.rejects(() => ask(failingLocalAssistant(copilot, counters)));
  assert.equal(counters.cloud, 0, 'no business data may reach the cloud');
});

test('with explicit OpenRouter data policy the existing cloud fallback still works', async t => {
  const { aiSettings } = isolatedAi(t);
  aiSettings.saveSettings({ openrouterEnabled: true, openrouterApiKey: 'sk-or-v1-testkey-123456', openrouterDataPolicy: 'allowed' });
  assert.equal(aiSettings.openrouterCredentials().provider, 'openrouter');
  const copilot = require('../server/lib/copilot-agent');
  copilot.resetModelResolutionCache();
  const counters = { local: 0, cloud: 0 };
  const result = await ask(failingLocalAssistant(copilot, counters));
  assert.equal(result.ok, true);
  assert.equal(counters.cloud >= 1, true);
  assert.equal(result.cloudFallback && result.cloudFallback.provider, 'openrouter');
});

test('Copilot settings expose the remote data-policy consent in TR and EN', () => {
  const copilot = read('public/copilot.js');
  assert.match(copilot, /name="customRemoteDataPolicy"/);
  assert.match(copilot, /customRemoteDataPolicy:settingsForm\.querySelector\('\[name=customRemoteDataPolicy\]'\)/);
  assert.match(copilot, /I confirm that business data may be sent to the Custom OpenAI-compatible provider/);
  assert.match(read('server/routes/copilot-routes.js'), /customRemoteDataPolicy: aiPub\.customRemoteDataPolicy/);
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
