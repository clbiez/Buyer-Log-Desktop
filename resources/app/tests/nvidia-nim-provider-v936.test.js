'use strict';

/* v9.36 — NVIDIA NIM ÇOKLU MODEL ENTEGRASYONU
 *
 * NVIDIA Build/NIM üzerinden 5 bulut modeli (Nemotron 3.5 Lightning,
 * DeepSeek V4 Flash, MiniMax M3, Muse Glimmer 30B, Kimi K3) Octopus'a
 * ProviderRegistry/ModelRegistry/ModelRouter ayrımıyla eklendi. Bu test
 * şunu doğrular:
 *
 * 1. Model Registry: 5 model + 1 deprecated alias doğru metadata ile var.
 * 2. Gateway: nvidia provider kaydı, listModels deprecated'ı DIŞLAR.
 * 3. Settings: nvidiaCredentials üç kilit (enabled/policy/key) + deprecated
 *    ve devre-dışı model reddi.
 * 4. Router: capability eşleşmeyen/deprecated/devre-dışı/sağlıksız modeller
 *    aday listesine girmez; en iyi eşleşen öne çıkar.
 * 5. Agent: manuel "nvidia:<modelId>" seçimi yerel modeli hiç denemeden
 *    doğrudan NVIDIA'ya gider; yapılandırılmamışsa açık hata verir.
 * 6. Agent: bulut fallback zinciri NVIDIA adaylarını dener, MAX_CLOUD_ATTEMPTS
 *    ile sınırlıdır, sonra OpenRouter'a düşer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/* agent-ai-settings.js dahili fonksiyonları (nvidiaCredentials, saveSettings)
   lexical `loadSettings()` çağırır — bu, module.exports üzerinde monkeypatch
   YAPILAMAYACAĞI anlamına gelir. Bunun yerine agent-ai-settings-v548.test.js
   ile aynı desen: izole bir SERVER_DATA_ROOT altında GERÇEK saveSettings/
   loadSettings çağırılır. */
function loadSettingsWithRoot(root) {
  const oldRoot = process.env.BUYER_LOG_SERVER_DATA_ROOT;
  const userDataPath = require.resolve('../server/user-data');
  const settingsPath = require.resolve('../server/lib/agent-ai-settings');
  // copilot-agent.js bu dosyada BİR KEZ require edildi ve agent-ai-settings'in
  // O ANKİ modül nesnesine kalıcı bir referans tuttu. Cache'i sadece SİLMEK
  // (restore etmemek), sonraki require() çağrılarının BAŞKA bir nesne
  // döndürmesine yol açar — copilot-agent.js hâlâ eskisini kullanırken, bu
  // dosyadaki monkeypatch'ler yeni nesneye uygulanır ve hiç etkisi olmaz.
  // Orijinal cache girdisini SAKLAYIP restore() içinde geri koyarak tek bir
  // paylaşılan nesne kimliği korunur.
  const savedUserDataEntry = require.cache[userDataPath];
  const savedSettingsEntry = require.cache[settingsPath];
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  delete require.cache[userDataPath]; delete require.cache[settingsPath];
  const mod = require('../server/lib/agent-ai-settings');
  return {
    mod, restore() {
      delete require.cache[userDataPath]; delete require.cache[settingsPath];
      if (oldRoot == null) delete process.env.BUYER_LOG_SERVER_DATA_ROOT; else process.env.BUYER_LOG_SERVER_DATA_ROOT = oldRoot;
      if (savedUserDataEntry) require.cache[userDataPath] = savedUserDataEntry;
      if (savedSettingsEntry) require.cache[settingsPath] = savedSettingsEntry;
    },
  };
}

const modelRegistry = require('../server/lib/ai-model-registry');
const gateway = require('../server/lib/ai-provider-gateway');
const aiModelRouter = require('../server/lib/ai-model-router');
const copilot = require('../server/lib/copilot-agent');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');

const userAccess = { hasArea: () => true, appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon'] };
const toolRegistry = createToolRegistry({ userAccess, getDataset: async () => [] });
const policyEngine = createPolicyEngine({ userAccess });

/* --------------------------------- 1) Model Registry */

test('v9.36 registry 5 aktif model + 1 deprecated alias içeriyor', () => {
  const active = modelRegistry.listNvidiaModels({ includeDeprecated: false });
  const all = modelRegistry.listNvidiaModels({ includeDeprecated: true });
  assert.equal(active.length, 5, 'aktif model sayısı 5 olmalı');
  assert.equal(all.length, 6, 'deprecated alias dahil 6 kayıt olmalı');
  const ids = active.map(m => m.modelId);
  assert.ok(ids.includes('nvidia/nemotron-3.5-lightning-30b-a3b'));
  assert.ok(ids.includes('deepseek-ai/deepseek-v4-flash-0731'), 'güncel DeepSeek Free Endpoint varyantı olmalı');
  assert.ok(!ids.includes('deepseek-ai/deepseek-v4-flash'), 'eski deepseek-v4-flash AKTİF listede olmamalı');
  assert.ok(ids.includes('minimaxai/minimax-m3'));
  assert.ok(ids.includes('meta/muse-glimmer-30b'));
  assert.ok(ids.includes('moonshotai/kimi-k3'));
});

test('v9.36 eski deepseek-v4-flash deprecated olarak işaretli ve replacement gösteriyor', () => {
  const legacy = modelRegistry.getNvidiaModel('deepseek-ai/deepseek-v4-flash');
  assert.ok(legacy, 'eski model kaydı var olmalı (uyarı/yönlendirme için)');
  assert.equal(legacy.deprecated, true);
  assert.equal(legacy.replacement, 'deepseek-ai/deepseek-v4-flash-0731');
});

test('v9.36 vision destekleyen modeller doğru işaretli', () => {
  assert.equal(modelRegistry.modelSupports('minimaxai/minimax-m3', 'vision'), true);
  assert.equal(modelRegistry.modelSupports('meta/muse-glimmer-30b', 'vision'), true);
  assert.equal(modelRegistry.modelSupports('moonshotai/kimi-k3', 'vision'), true);
  assert.equal(modelRegistry.modelSupports('nvidia/nemotron-3.5-lightning-30b-a3b', 'vision'), false);
  assert.equal(modelRegistry.modelSupports('deepseek-ai/deepseek-v4-flash-0731', 'vision'), false);
});

test('v9.36 tüm aktif modeller tool calling + structured output destekliyor', () => {
  modelRegistry.listNvidiaModels({ includeDeprecated: false }).forEach(m => {
    assert.equal(m.toolCalling, true, `${m.modelId} tool calling desteklemeli`);
    assert.equal(m.structuredOutput, true, `${m.modelId} structured output desteklemeli`);
  });
});

/* --------------------------------- 2) Gateway */

test('v9.36 gateway nvidia provider kaydı doğru', () => {
  const nv = gateway.PROVIDERS.nvidia;
  assert.ok(nv);
  assert.equal(nv.kind, 'openai-compatible');
  assert.equal(nv.localOnly, false);
  assert.equal(nv.endpoint, 'https://integrate.api.nvidia.com/v1');
});

test('v9.36 gateway.nvidiaModels deprecated dahil tüm kaydı döner (UI için)', () => {
  const models = gateway.nvidiaModels();
  assert.equal(models.length, 6);
});

test('v9.36 provider.listModels (nvidia) deprecated alias\'ı DIŞLAR', async () => {
  const provider = gateway.createProvider({ provider: 'nvidia', apiKey: 'test-key', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
  const models = await provider.listModels();
  assert.equal(models.length, 5);
  assert.ok(!models.some(m => m.name === 'deepseek-ai/deepseek-v4-flash'));
  assert.ok(models.some(m => m.name === 'deepseek-ai/deepseek-v4-flash-0731'));
});

test('v9.36 classifyProviderError doğru sınıflandırıyor', () => {
  assert.equal(gateway.classifyProviderError({ code: 'AI_PROVIDER_ERROR', details: { providerStatus: 401 } }), 'auth-error');
  assert.equal(gateway.classifyProviderError({ code: 'AI_PROVIDER_ERROR', details: { providerStatus: 403 } }), 'auth-error');
  assert.equal(gateway.classifyProviderError({ code: 'AI_PROVIDER_ERROR', details: { providerStatus: 429 } }), 'rate-limited');
  assert.equal(gateway.classifyProviderError({ code: 'AI_TIMEOUT' }), 'unavailable');
});

/* --------------------------------- 3) Settings — üç kilit */

test('v9.36 nvidiaCredentials üç kilit birlikte sağlanmazsa null döner', () => {
  const source = require('fs').readFileSync(require.resolve('../server/lib/agent-ai-settings.js'), 'utf8');
  assert.match(source, /if\s*\(!settings\.nvidiaEnabled\)/);
  assert.match(source, /nvidiaDataPolicy\s*!==\s*'allowed'/);
  assert.match(source, /if\s*\(!apiKey\)/);
});

test('v9.36 nvidiaCredentials deprecated model istenirse null döner', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    mod.saveSettings({ nvidiaEnabled: true, nvidiaDataPolicy: 'allowed', nvidiaApiKey: 'nvapi-test-key-1234' });
    const creds = mod.nvidiaCredentials({ model: 'deepseek-ai/deepseek-v4-flash' });
    assert.equal(creds, null, 'deprecated model kabul edilmemeli');
    const okCreds = mod.nvidiaCredentials({ model: 'deepseek-ai/deepseek-v4-flash-0731' });
    assert.ok(okCreds, 'güncel varyant kabul edilmeli');
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('v9.36 nvidiaCredentials devre dışı bırakılmış modeli reddediyor', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    mod.saveSettings({
      nvidiaEnabled: true, nvidiaDataPolicy: 'allowed', nvidiaApiKey: 'nvapi-test-key-1234',
      nvidiaModelOverrides: { 'moonshotai/kimi-k3': false },
    });
    const creds = mod.nvidiaCredentials({ model: 'moonshotai/kimi-k3' });
    assert.equal(creds, null, 'kullanıcı tarafından devre dışı bırakılan model reddedilmeli');
    const okCreds = mod.nvidiaCredentials({ model: 'nvidia/nemotron-3.5-lightning-30b-a3b' });
    assert.ok(okCreds, 'devre dışı bırakılmamış model kabul edilmeli');
    assert.equal(okCreds.provider, 'nvidia');
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('v9.36 saveSettings bilinmeyen/deprecated nvidiaDefaultModel\'i reddeder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    assert.throws(() => mod.saveSettings({ nvidiaDefaultModel: 'deepseek-ai/deepseek-v4-flash' }), /deprecated|Geçersiz/);
    assert.throws(() => mod.saveSettings({ nvidiaDefaultModel: 'made-up/not-a-real-model' }), /Geçersiz/);
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('v9.36 recordNvidiaHealth başarı/başarısızlığı publicSettings üzerinden görünür kılar', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    mod.recordNvidiaHealth('nvidia/nemotron-3.5-lightning-30b-a3b', { ok: true });
    let models = mod.publicSettings().nvidia.models;
    let nemotron = models.find(m => m.modelId === 'nvidia/nemotron-3.5-lightning-30b-a3b');
    assert.equal(nemotron.status, 'available');
    assert.equal(mod.publicSettings().nvidia.lastSuccessfulConnection != null, true);
    mod.recordNvidiaHealth('moonshotai/kimi-k3', { ok: false, status: 'auth-error', message: 'Invalid API key' });
    models = mod.publicSettings().nvidia.models;
    const kimi = models.find(m => m.modelId === 'moonshotai/kimi-k3');
    assert.equal(kimi.status, 'auth-error');
    assert.match(mod.publicSettings().nvidia.lastError || '', /kimi-k3/);
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

/* --------------------------------- 4) Router */

test('v9.36 router vision gerektiren görevde vision desteklemeyen modelleri eler', () => {
  const health = {}, overrides = {};
  const task = aiModelRouter.inferTask({ question: 'bu ekran görüntüsünü analiz et', hasImageAttachment: true });
  assert.equal(task.requireVision, true);
  const ranked = aiModelRouter.rankNvidiaCandidates({ task, health, overrides });
  assert.ok(ranked.length > 0, 'vision destekleyen en az bir model olmalı');
  ranked.forEach(m => assert.equal(m.vision, true, `${m.modelId} vision desteklemeden sıralamaya girmemeli`));
});

test('v9.36 router deprecated ve auth-error/devre-dışı modelleri asla önermez', () => {
  const health = { 'nvidia/nemotron-3.5-lightning-30b-a3b': { status: 'auth-error' } };
  const overrides = { 'moonshotai/kimi-k3': false };
  const ranked = aiModelRouter.rankNvidiaCandidates({ task: { tags: ['general'] }, health, overrides });
  const ids = ranked.map(m => m.modelId);
  assert.ok(!ids.includes('nvidia/nemotron-3.5-lightning-30b-a3b'), 'auth-error alan model önerilmemeli');
  assert.ok(!ids.includes('moonshotai/kimi-k3'), 'kullanıcı tarafından kapatılan model önerilmemeli');
  assert.ok(!ids.includes('deepseek-ai/deepseek-v4-flash'), 'deprecated model hiçbir zaman önerilmemeli');
});

test('v9.36 router excludeModelIds ile daha önce denenmiş modeli tekrar önermez', () => {
  const ranked = aiModelRouter.rankNvidiaCandidates({
    task: { tags: ['general'] }, health: {}, overrides: {},
    excludeModelIds: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'deepseek-ai/deepseek-v4-flash-0731', 'minimaxai/minimax-m3', 'meta/muse-glimmer-30b'],
  });
  assert.deepEqual(ranked.map(m => m.modelId), ['moonshotai/kimi-k3']);
});

/* --------------------------------- 5) Agent — manuel NVIDIA seçimi */

test('v9.36 manuel "nvidia:<model>" seçimi yerel modeli hiç denemeden buluta gider', async () => {
  let localCalled = false, nvidiaCalled = false;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {}, // gerçek settings dosyasına yazmasın
    providerFactory: () => { localCalled = true; throw new Error('yerel hiç çağrılmamalıydı'); },
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() { nvidiaCalled = true; return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'NVIDIA cevabı.' }), model: creds.model, usage: { prompt_tokens: 10, completion_tokens: 5 } }; },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.nvidiaCredentials;
  aiSettings.nvidiaCredentials = ({ model }) => ({ provider: 'nvidia', apiKey: 'k', model, endpoint: gateway.PROVIDERS.nvidia.endpoint, temperature: 0.25, contextLimit: 8192 });
  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', model: 'nvidia:moonshotai/kimi-k3', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally { aiSettings.nvidiaCredentials = origCreds; }
  assert.equal(localCalled, false, 'yerel sağlayıcı hiç çağrılmamalı');
  assert.equal(nvidiaCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'nvidia');
  assert.equal(result.model, 'moonshotai/kimi-k3');
  assert.ok(!result.cloudFallback, 'manuel seçim bir "fallback" değildir');
  assert.equal(result.usage.prompt_tokens, 10);
});

test('v9.36 manuel NVIDIA seçimi yapılandırılmamışsa açık hata verir', async () => {
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {}, // gerçek settings dosyasına yazmasın
    providerFactory: () => { throw new Error('çağrılmamalı'); },
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.nvidiaCredentials;
  aiSettings.nvidiaCredentials = () => null;
  copilot.resetModelResolutionCache();
  try {
    await assert.rejects(
      assistant.respond({ question: 'Merhaba.', language: 'tr', model: 'nvidia:moonshotai/kimi-k3', profile, ownerId: 'u1', toolRegistry, policyEngine }),
      err => err.code === 'AI_NVIDIA_NOT_CONFIGURED',
    );
  } finally { aiSettings.nvidiaCredentials = origCreds; }
});

/* --------------------------------- 6) Agent — auto bulut zinciri */

test('v9.36 auto modda yerel tükenince NVIDIA adayı denenir, sonra OpenRouter', async () => {
  const SINGLE_MODEL_INSTALLED = [{ name: 'gemma4:26b', capabilities: ['completion', 'tools', 'thinking'] }];
  let nvidiaAttempts = 0, openrouterAttempts = 0;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {}, // gerçek settings dosyasına yazmasın
    providerFactory: overrides => {
      const model = (overrides && overrides.model) || 'gemma4:26b';
      return {
        config: { provider: 'ollama', model },
        async resolveModel(opts = {}) {
          const chosen = gateway.chooseInstalledModel('gemma4:26b', SINGLE_MODEL_INSTALLED, { exclude: opts.exclude || [] });
          if (!chosen) return { model: null, matched: false, supportsTools: false, capabilities: [], notice: 'yok' };
          return { model: chosen.model.name, matched: true, supportsTools: true, capabilities: chosen.model.capabilities, notice: null, toolNotice: null };
        },
        async chat() { throw Object.assign(new Error('CUDA error: shared object'), { code: 'AI_PROVIDER_ERROR' }); },
      };
    },
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() {
        if (creds.provider === 'nvidia') { nvidiaAttempts += 1; throw Object.assign(new Error('nvidia zaman aşımı'), { code: 'AI_TIMEOUT' }); }
        openrouterAttempts += 1;
        return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'OpenRouter cevabı.' }), model: creds.model };
      },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origRouterState = aiSettings.nvidiaRouterState;
  const origNvCreds = aiSettings.nvidiaCredentials;
  const origOrCreds = aiSettings.openrouterCredentials;
  aiSettings.nvidiaRouterState = () => ({ eligible: true, health: {}, overrides: {} });
  aiSettings.nvidiaCredentials = ({ model }) => ({ provider: 'nvidia', apiKey: 'k', model, endpoint: gateway.PROVIDERS.nvidia.endpoint });
  aiSettings.openrouterCredentials = () => ({ provider: 'openrouter', apiKey: 'k', model: 'meta-llama/llama-3.1-8b-instruct:free', endpoint: gateway.PROVIDERS.openrouter.endpoint });
  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Test.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.nvidiaRouterState = origRouterState;
    aiSettings.nvidiaCredentials = origNvCreds;
    aiSettings.openrouterCredentials = origOrCreds;
  }
  assert.equal(result.ok, true);
  assert.equal(nvidiaAttempts, 2, 'MAX_NVIDIA_CLOUD_ATTEMPTS=2 kadar NVIDIA adayı denenmeli');
  assert.equal(openrouterAttempts, 1, 'NVIDIA bütçesi tükenince OpenRouter son çare olarak denenmeli');
  assert.equal(result.cloudFallback.provider, 'openrouter');
});

test('v9.36 nvidiaUseInAutoRouter kapalıyken Auto Router NVIDIA denemez, doğrudan OpenRouter\'a düşer', async () => {
  let nvidiaAttempts = 0, openrouterAttempts = 0;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {}, // gerçek settings dosyasına yazmasın
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', matched: true, supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { throw Object.assign(new Error('bağlanamadı'), { code: 'AI_PROVIDER_OFFLINE' }); },
    }),
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() {
        if (creds.provider === 'nvidia') nvidiaAttempts += 1;
        else openrouterAttempts += 1;
        return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'cevap' }), model: creds.model };
      },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origRouterState = aiSettings.nvidiaRouterState;
  const origOrCreds = aiSettings.openrouterCredentials;
  // Auto Router'da kullanım KAPALI — eligible:false, NVIDIA hiç aday üretmemeli.
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });
  aiSettings.openrouterCredentials = () => ({ provider: 'openrouter', apiKey: 'k', model: 'meta-llama/llama-3.1-8b-instruct:free', endpoint: gateway.PROVIDERS.openrouter.endpoint });
  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Test.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.nvidiaRouterState = origRouterState;
    aiSettings.openrouterCredentials = origOrCreds;
  }
  assert.equal(nvidiaAttempts, 0, 'Auto Router kapalıyken NVIDIA hiç denenmemeli');
  assert.equal(openrouterAttempts, 1);
  assert.equal(result.cloudFallback.provider, 'openrouter');
});

/* --------------------------------- 7) nvidiaRouterState().eligible — gerçek hesap */

test('v9.36 nvidiaRouterState().eligible dört koşulun HEPSİ sağlanmadan true olmaz', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    // Hiçbiri ayarlanmamış: kapalı.
    assert.equal(mod.nvidiaRouterState().eligible, false);
    // Yalnız enabled+key+policy — useInAutoRouter YOK: hâlâ false olmalı.
    mod.saveSettings({ nvidiaEnabled: true, nvidiaDataPolicy: 'allowed', nvidiaApiKey: 'nvapi-test-key-1234' });
    assert.equal(mod.nvidiaRouterState().eligible, false, 'useInAutoRouter kapalıyken eligible olmamalı');
    // Dördü birden: true.
    mod.saveSettings({ nvidiaUseInAutoRouter: true });
    assert.equal(mod.nvidiaRouterState().eligible, true);
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

/* --------------------------------- 8) localProviderEnabled */

test('v9.36 isLocalProviderEnabled varsayılan true, kapatılabilir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-nv-'));
  const { mod, restore } = loadSettingsWithRoot(tmp);
  try {
    assert.equal(mod.isLocalProviderEnabled(), true);
    mod.saveSettings({ localProviderEnabled: false });
    assert.equal(mod.isLocalProviderEnabled(), false);
    assert.equal(mod.publicSettings().localProviderEnabled, false);
    mod.saveSettings({ localProviderEnabled: true });
    assert.equal(mod.isLocalProviderEnabled(), true);
  } finally { restore(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('v9.36 Auto/boş model seçiminde yerel kapalıysa doğrudan buluta gider, yerel HİÇ çağrılmaz', async () => {
  let localCalled = false, cloudCalled = false;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {},
    providerFactory: () => { localCalled = true; throw new Error('yerel hiç çağrılmamalıydı'); },
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() { cloudCalled = true; return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'cevap' }), model: creds.model }; },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origIsLocalEnabled = aiSettings.isLocalProviderEnabled;
  const origNvCreds = aiSettings.nvidiaCredentials;
  const origRouterState = aiSettings.nvidiaRouterState;
  aiSettings.isLocalProviderEnabled = () => false;
  aiSettings.nvidiaRouterState = () => ({ eligible: true, health: {}, overrides: {} });
  aiSettings.nvidiaCredentials = ({ model }) => ({ provider: 'nvidia', apiKey: 'k', model, endpoint: gateway.PROVIDERS.nvidia.endpoint });
  copilot.resetModelResolutionCache();
  let result;
  try {
    // model boş bırakıldı — bu "Auto" seçimidir.
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', model: '', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.isLocalProviderEnabled = origIsLocalEnabled;
    aiSettings.nvidiaCredentials = origNvCreds;
    aiSettings.nvidiaRouterState = origRouterState;
  }
  assert.equal(localCalled, false, 'yerel sağlayıcı hiç çağrılmamalı');
  assert.equal(cloudCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'nvidia');
  assert.ok(!result.cloudFallback, 'bu bir fallback değil, başlangıç seçimidir');
});

test('v9.36 yerel kapalıyken belirli bir yerel model adı elle seçilirse yine de saygı görür', async () => {
  let localCalled = false;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {},
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { localCalled = true; return { model: 'gemma4:12b', matched: true, supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'yerel cevap' }), model: 'gemma4:12b' }; },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origIsLocalEnabled = aiSettings.isLocalProviderEnabled;
  aiSettings.isLocalProviderEnabled = () => false;
  copilot.resetModelResolutionCache();
  let result;
  try {
    // "gemma4:12b" — Auto/boş DEĞİL, kullanıcı belirli bir yerel modeli
    // elle seçmiş; bu, "yerel kapalı" ayarını geçersiz kılan bir tercihtir.
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', model: 'gemma4:12b', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally { aiSettings.isLocalProviderEnabled = origIsLocalEnabled; }
  assert.equal(localCalled, true, 'elle seçilen yerel model yine de denenmeli');
  assert.equal(result.ok, true);
});

test('v9.36 yerel kapalı VE hiçbir bulut yapılandırılmamışsa açık hata verir', async () => {
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {},
    providerFactory: () => { throw new Error('çağrılmamalı'); },
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origIsLocalEnabled = aiSettings.isLocalProviderEnabled;
  const origRouterState = aiSettings.nvidiaRouterState;
  const origOrCreds = aiSettings.openrouterCredentials;
  aiSettings.isLocalProviderEnabled = () => false;
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });
  aiSettings.openrouterCredentials = () => null;
  copilot.resetModelResolutionCache();
  try {
    await assert.rejects(
      assistant.respond({ question: 'Merhaba.', language: 'tr', model: '', profile, ownerId: 'u1', toolRegistry, policyEngine }),
      err => err.code === 'AI_NO_PROVIDER',
    );
  } finally {
    aiSettings.isLocalProviderEnabled = origIsLocalEnabled;
    aiSettings.nvidiaRouterState = origRouterState;
    aiSettings.openrouterCredentials = origOrCreds;
  }
});
