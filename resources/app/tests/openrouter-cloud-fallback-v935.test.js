'use strict';

/* v9.35 — OPENROUTER BULUT YEDEK
 *
 * Yerel model erişilemez olduğunda (Ollama kapalı, model yüklenemiyor, tüm
 * yerel adaylar tükeniyor) OpenRouter Free devreye girebilmeli. Bu test
 * şunu doğrular:
 *
 * 1. CLOUD_FALLBACK_CODES doğru hata kodlarını kapsıyor.
 * 2. openrouterCredentials() üç koşul birlikte sağlanmazsa null döndürüyor:
 *    açık, veri politikası 'allowed', API anahtarı mevcut.
 * 3. Yerel model yüklenemeyip yerel adaylar tükenince cloud tetikleniyor.
 * 4. Doğrudan CLOUD_FALLBACK_CODES hatasında cloud tetikleniyor.
 * 5. Cloud devre dışı, politika 'off' veya anahtar yoksa hata fırlatıyor.
 * 6. Cloud fallback response'da cloudFallback bilgisi taşınıyor.
 * 7. Yerel model fallback'i (v9.27) hâlâ çalışıyor — regresyon yok.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = require('../server/lib/ai-provider-gateway');
const copilot = require('../server/lib/copilot-agent');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');

const INSTALLED = [
  { name: 'gemma4:26b', capabilities: ['completion', 'tools', 'thinking'] },
  { name: 'qwen3:8b', capabilities: ['completion', 'tools'] },
];

const userAccess = { hasArea: () => true, appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon'] };
const toolRegistry = createToolRegistry({ userAccess, getDataset: async () => [] });
const policyEngine = createPolicyEngine({ userAccess });

/* --------------------------------- 1) CLOUD_FALLBACK_CODES'un kapsamı */

test('v9.35 CLOUD_FALLBACK_CODES doğru hata kodlarını içeriyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(source, /CLOUD_FALLBACK_CODES\s*=\s*new Set\(/);
  /* Sağlayıcı sorunlarını kapsamalı */
  ['AI_PROVIDER_OFFLINE', 'AI_NO_MODELS', 'AI_MODEL_MISSING', 'AI_MODEL_UNUSABLE', 'AI_TIMEOUT'].forEach(code => {
    assert.match(source, new RegExp(`'${code}'`), `${code} CLOUD_FALLBACK_CODES'ta eksik`);
  });
  /* Araç ve politika hatalarını KAPSAMAMALI */
  ['COPILOT_TOOL_BLOCKED', 'COPILOT_GROUNDING_FAILED', 'AREA_FORBIDDEN'].forEach(code => {
    const pattern = new RegExp(`CLOUD_FALLBACK_CODES[^}]+${code}`);
    assert.ok(!pattern.test(source), `${code} CLOUD_FALLBACK_CODES'ta olmamalı`);
  });
});

/* --------------------------------- 2) openrouterCredentials üç kilit */

test('v9.35 openrouterCredentials tüm koşullar sağlanmazsa null döner', () => {
  const aiSettings = require('../server/lib/agent-ai-settings');
  /* Bu test gerçek settings dosyasını değiştirmez; fonksiyonun kaynak
     metninde üç guard bulunduğunu doğrular. */
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-ai-settings.js'), 'utf8');
  assert.match(source, /openrouterCredentials/);
  /* Üç null guard: enabled, dataPolicy, apiKey */
  assert.match(source, /if\s*\(!settings\.openrouterEnabled\)/);
  assert.match(source, /openrouterDataPolicy\s*!==\s*'allowed'/);
  assert.match(source, /if\s*\(!apiKey\)/);
});

test('v9.35 openrouterCredentials doğru alanları döndürüyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-ai-settings.js'), 'utf8');
  /* provider, apiKey, model, endpoint, temperature, contextLimit alanları */
  assert.match(source, /provider:\s*'openrouter'/);
  assert.match(source, /endpoint:\s*gateway\.PROVIDERS\.openrouter\.endpoint/);
  assert.match(source, /OPENROUTER_DEFAULT_MODEL/);
});

/* --------------------------------- 3) Yerel model tükenince cloud */

test('v9.35 yerel adaylar tükenince OpenRouter devreye giriyor', async () => {
  /* Tek yerel model: yüklenemez → unusable → başka aday yok → localExhausted
     → cloud fallback devreye girer. */
  const SINGLE_MODEL_INSTALLED = [
    { name: 'gemma4:26b', capabilities: ['completion', 'tools', 'thinking'] },
  ];
  let localAttempts = 0, cloudAttempts = 0;
  const cloudModel = 'meta-llama/llama-3.1-8b-instruct:free';

  const assistant = copilot.createCopilotAssistant({
    providerFactory: overrides => {
      const model = (overrides && overrides.model) || 'gemma4:26b';
      return {
        config: { provider: 'ollama', model },
        async resolveModel(opts = {}) {
          const chosen = gateway.chooseInstalledModel('gemma4:26b', SINGLE_MODEL_INSTALLED, { exclude: opts.exclude || [] });
          /* throw etme — null model döndür ki resolveAgentModel localExhausted yoluna girebilsin */
          if (!chosen) return { model: null, matched: false, supportsTools: false, capabilities: [], notice: 'Uygun yerel model yok.' };
          return { model: chosen.model.name, matched: true, supportsTools: true, capabilities: chosen.model.capabilities, notice: null, toolNotice: null };
        },
        async chat() {
          localAttempts += 1;
          throw Object.assign(new Error('CUDA error: shared object initialization failed'), { code: 'AI_PROVIDER_ERROR' });
        },
      };
    },
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() {
        cloudAttempts += 1;
        return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'OpenRouter\'dan cevap.' }), model: creds.model };
      },
    }),
  });

  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  const origRouterState = aiSettings.nvidiaRouterState;
  aiSettings.openrouterCredentials = () => ({ provider: 'openrouter', apiKey: 'test-key', model: cloudModel, endpoint: 'https://openrouter.ai/api/v1', temperature: 0.25, contextLimit: 8192 });
  // Bu makinede gerçekten yapılandırılmış NVIDIA olabilir — bu test yalnız
  // OpenRouter yedeğini doğruluyor, NVIDIA'yı kasıtlı olarak kapatıyoruz
  // (bkz. v9.36 testlerindeki aynı izolasyon deseni).
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });

  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Test.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.openrouterCredentials = origCreds;
    aiSettings.nvidiaRouterState = origRouterState;
  }

  assert.equal(result.ok, true, 'bulut yedek başarısız olmamalı');
  assert.ok(result.cloudFallback, 'cloudFallback bilgisi taşınmalı');
  assert.equal(result.cloudFallback.provider, 'openrouter');
  assert.equal(result.cloudFallback.model, cloudModel);
  assert.ok(localAttempts >= 1, 'önce yerel model denenmeli');
  assert.ok(cloudAttempts >= 1, 'bulut da denenmeli');
});

/* --------------------------------- 4) Doğrudan AI_PROVIDER_OFFLINE → cloud */

test('v9.35 AI_PROVIDER_OFFLINE hatası doğrudan cloud tetikliyor', async () => {
  const cloudModel = 'meta-llama/llama-3.1-8b-instruct:free';
  let cloudCalled = false;

  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { throw Object.assign(new Error('AI sağlayıcıya bağlanılamadı.'), { code: 'AI_PROVIDER_OFFLINE' }); },
    }),
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() {
        cloudCalled = true;
        return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'Bulut yanıtı.' }), model: creds.model };
      },
    }),
  });

  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  aiSettings.openrouterCredentials = () => ({ provider: 'openrouter', apiKey: 'test-key', model: cloudModel, endpoint: 'https://openrouter.ai/api/v1', temperature: 0.25, contextLimit: 8192 });

  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.openrouterCredentials = origCreds;
  }

  assert.equal(result.ok, true);
  assert.ok(cloudCalled, 'cloud çağrılmalı');
  assert.equal(result.cloudFallback && result.cloudFallback.reason, 'AI_PROVIDER_OFFLINE');
});

/* --------------------------------- 5) Cloud kapalıysa hata fırlatıyor */

test('v9.35 openrouterCredentials null ise hata kullanıcıya iletiliyor', async () => {
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { throw Object.assign(new Error('bağlanamadı'), { code: 'AI_PROVIDER_OFFLINE' }); },
    }),
  });

  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  const origRouterState = aiSettings.nvidiaRouterState;
  aiSettings.openrouterCredentials = () => null; /* devre dışı */
  // Bu makinede gerçekten yapılandırılmış NVIDIA olabilir — bu test "hiçbir
  // bulut yapılandırılmamışsa hata fırlar"ı doğruluyor, NVIDIA'yı da
  // kasıtlı olarak kapatıyoruz (bkz. v9.36 testlerindeki aynı desen).
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });

  copilot.resetModelResolutionCache();
  let threw = false;
  try {
    await assistant.respond({ question: 'Test.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } catch (_) {
    threw = true;
  } finally {
    aiSettings.openrouterCredentials = origCreds;
    aiSettings.nvidiaRouterState = origRouterState;
  }

  assert.ok(threw, 'cloud kapalıysa hata fırlatılmalı');
});

/* --------------------------------- 6) Gateway: openrouter provider kaydı */

test('v9.35 gateway openrouter provider kaydı doğru', () => {
  const or = gateway.PROVIDERS.openrouter;
  assert.ok(or, 'openrouter PROVIDERS\'da olmalı');
  assert.equal(or.kind, 'openai-compatible');
  assert.equal(or.localOnly, false);
  assert.match(or.endpoint, /openrouter\.ai/);
});

test('v9.35 OPENROUTER_FREE_MODELS en az 1 model içeriyor ve default var', () => {
  const models = gateway.openrouterFreeModels();
  assert.ok(Array.isArray(models) && models.length >= 1, 'en az bir ücretsiz model olmalı');
  assert.ok(models.some(m => m.default === true), 'varsayılan model işaretli olmalı');
  models.forEach(m => {
    assert.ok(m.id, 'her modelin id\'si olmalı');
    assert.match(m.id, /:free$/, 'free model id\'leri :free ile bitmeli');
  });
});

/* --------------------------------- 7) v9.27 yerel fallback regresyon */

test('v9.35 yerel model fallback (v9.27) hâlâ çalışıyor', async () => {
  let attempts = 0;
  const assistant = copilot.createCopilotAssistant({
    providerFactory: overrides => {
      const model = (overrides && overrides.model) || 'gemma4:26b';
      return {
        config: { provider: 'ollama', model },
        async resolveModel(options = {}) {
          const chosen = gateway.chooseInstalledModel('gemma4:12b', INSTALLED, { exclude: options.exclude || [] });
          return { model: chosen.model.name, supportsTools: true, capabilities: chosen.model.capabilities, notice: null, toolNotice: null };
        },
        async chat() {
          attempts += 1;
          if (model === 'gemma4:26b') throw Object.assign(new Error('CUDA error: shared object'), { code: 'AI_PROVIDER_ERROR' });
          return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'qwen3 ile cevap.' }), model: 'qwen3:8b' };
        },
      };
    },
  });

  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  aiSettings.openrouterCredentials = () => null; /* cloud yok — yerel fallback test ediliyor */

  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.openrouterCredentials = origCreds;
  }

  assert.equal(result.ok, true, 'yerel fallback sonuçlanmalı');
  assert.ok(attempts >= 2, 'iki model de denenmeli');
  assert.ok(!result.cloudFallback, 'cloudFallback yok');
  assert.match(result.modelNotice || '', /gemma4:26b/);
});

/* --------------------------------- 8) Model Selector'da manuel OpenRouter seçimi
   NVIDIA ile SİMETRİK: kullanıcı "openrouter:<modelId>" seçtiğinde yerel
   model hiç denenmeden doğrudan seçilen OpenRouter modeline gidilir. */

test('v9.35 manuel "openrouter:<model>" seçimi yerel modeli hiç denemeden buluta gider', async () => {
  let localCalled = false, openrouterCalled = false;
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => { localCalled = true; throw new Error('yerel hiç çağrılmamalıydı'); },
    cloudProviderFactory: creds => ({
      config: { provider: creds.provider, model: creds.model },
      async chat() { openrouterCalled = true; return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'OpenRouter cevabı.' }), model: creds.model }; },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  aiSettings.openrouterCredentials = ({ model } = {}) => ({ provider: 'openrouter', apiKey: 'k', model: model || 'default:free', endpoint: gateway.PROVIDERS.openrouter.endpoint });
  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Merhaba.', language: 'tr', model: 'openrouter:minimax/minimax-m3:free', profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally { aiSettings.openrouterCredentials = origCreds; }
  assert.equal(localCalled, false, 'yerel sağlayıcı hiç çağrılmamalı');
  assert.equal(openrouterCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'minimax/minimax-m3:free');
  assert.ok(!result.cloudFallback, 'manuel seçim bir "fallback" değildir');
});

test('v9.35 manuel OpenRouter seçimi yapılandırılmamışsa açık hata verir', async () => {
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => { throw new Error('çağrılmamalı'); },
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.openrouterCredentials;
  aiSettings.openrouterCredentials = () => null;
  copilot.resetModelResolutionCache();
  try {
    await assert.rejects(
      assistant.respond({ question: 'Merhaba.', language: 'tr', model: 'openrouter:minimax/minimax-m3:free', profile, ownerId: 'u1', toolRegistry, policyEngine }),
      err => err.code === 'AI_OPENROUTER_NOT_CONFIGURED',
    );
  } finally { aiSettings.openrouterCredentials = origCreds; }
});
