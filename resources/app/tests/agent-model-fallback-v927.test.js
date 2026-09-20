'use strict';

/* v9.27 — "KURULU" ile "ÇALIŞAN" AYNI ŞEY DEĞİL.
 *
 * v9.22'de model çözümlemesini düzeltmiştim: yapılandırılan gemma4:12b kurulu
 * değildi, aynı aileden gemma4:26b seçiliyordu. Gerçek sunucuda ölçünce
 * düzeltmenin BAŞKA BİR YERDE aynı sonucu doğurduğu görüldü: 26B bu
 * bilgisayarda yüklenemiyor (CUDA/bellek) ve Copilot her istekte 502 veriyordu.
 *
 * Yükleyip denemeden bilmenin yolu yok — ama BAŞARISIZLIKTAN öğrenilebilir.
 * Model yükleme hatası verirse o model bu oturum için elenir ve sıradaki
 * adayla bir kez daha denenir. Kullanıcıya hangi modelin neden elendiği
 * söylenir; sessizce başka bir modele geçmek, yavaşlığın sebebini gizler.
 *
 * CANLI ÖLÇÜM: gemma4:26b istendi → yüklenemedi → qwen3:8b ile cevap üretildi
 * ve bildirim döndü. 26B'nin BAZEN yüklendiği de görüldü (62,8 sn) — yani
 * hata aralıklı; eleme kalıcı olmalı ki her istekte 40 sn yükleme denemesi
 * tekrarlanmasın.
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

/* ------------------------------------------- 1) YÜKLEME HATASI TANINIYOR */

test('v9.27 model yükleme hatası araç hatasından ayırt ediliyor', () => {
  /* Desen listesi DAR: gerçek bir çalışma hatası yanlışlıkla "model bozuk"
     sayılıp gereksiz model değişimi tetiklememeli. */
  const loadFailures = [
    new Error('llama-server process has terminated: exit status 0xc0000409'),
    new Error('llama_init_from_model: failed to initialize the context'),
    new Error('CUDA error: shared object initialization failed'),
    new Error('model requires more system memory than is available'),
  ];
  loadFailures.forEach(error => assert.equal(gateway.isModelLoadFailure(error), true, error.message));

  const notLoadFailures = [
    new Error('Dataset alanı bulunamadı: producer_id'),
    new Error('AI sağlayıcı zaman aşımına uğradı.'),
    new Error('Bu değer o alanda yok'),
    new Error(''),
    null,
  ];
  notLoadFailures.forEach(error => assert.equal(gateway.isModelLoadFailure(error), false, String(error && error.message)));
});

/* ------------------------------------------------- 2) ELEME VE SEÇİM */

test('v9.27 elenen model bir daha seçilmiyor', () => {
  const first = gateway.chooseInstalledModel('gemma4:12b', INSTALLED);
  assert.equal(first.model.name, 'gemma4:26b', 'önce aynı aile');
  // 26B elendikten sonra sıradaki aday gelmeli.
  const second = gateway.chooseInstalledModel('gemma4:12b', INSTALLED, { exclude: ['gemma4:26b'] });
  assert.equal(second.model.name, 'qwen3:8b');
  // Hepsi elenirse çağıran net bir hata üretebilsin diye null döner.
  assert.equal(gateway.chooseInstalledModel('gemma4:12b', INSTALLED, { exclude: ['gemma4:26b', 'qwen3:8b'] }), null);
});

test('v9.27 eleme oturum boyunca hatırlanıyor', () => {
  /* Aralıklı bir hata: 26B bazen yükleniyor. Eleme kalıcı olmazsa her
     istekte 40 saniyelik yükleme denemesi tekrarlanır. */
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(source, /const unusableModels = new Set\(\);/);
  assert.match(source, /function markModelUnusable\(name\)/);
  // Önbellek anahtarı elenen listeyi içermeli, yoksa bayat çözümleme döner.
  assert.match(source, /const key = `\$\{base\.config && base\.config\.model\}\|\$\{\[\.\.\.unusableModels\]\.sort\(\)\.join\(','\)\}`;/);
  assert.match(source, /resetModelResolutionCache\(\) \{ modelResolutionCache = null; unusableModels\.clear\(\); \}/);
});

/* --------------------------------------------- 3) DÖNGÜDE GERİ DÜŞME */

test('v9.27 yükleme hatasında sıradaki modelle devam ediliyor', async () => {
  let attempt = 0;
  const assistant = copilot.createCopilotAssistant({
    providerFactory: overrides => {
      const model = (overrides && overrides.model) || 'gemma4:26b';
      return {
        config: { provider: 'ollama', model },
        async resolveModel(options = {}) {
          const chosen = gateway.chooseInstalledModel('gemma4:12b', INSTALLED, { exclude: options.exclude || [] });
          return {
            model: chosen.model.name, requested: 'gemma4:12b', matched: false, reason: chosen.reason,
            supportsTools: true, capabilities: chosen.model.capabilities, installed: INSTALLED.map(m => m.name),
            notice: null, toolNotice: null,
          };
        },
        async chat() {
          attempt += 1;
          if (model === 'gemma4:26b') throw Object.assign(new Error('CUDA error: shared object initialization failed'), { code: 'AI_PROVIDER_ERROR' });
          return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'Merhaba.' }), model };
        },
      };
    },
  });
  copilot.resetModelResolutionCache();
  const userAccess = { hasArea: () => true };
  const result = await assistant.respond({
    question: 'Merhaba.', language: 'tr', profile: { areas: ['cp'] }, ownerId: 'u',
    toolRegistry: createToolRegistry({ userAccess, getDataset: async () => [] }),
    policyEngine: createPolicyEngine({ userAccess }),
  });
  assert.equal(result.ok, true, 'yükleme hatası isteği düşürmemeli');
  assert.ok(attempt >= 2, 'ikinci modelle yeniden denenmeli');
  /* Kullanıcı hangi modelin neden elendiğini görmeli: sessizce daha küçük bir
     modele geçmek, cevap kalitesindeki düşüşü açıklanamaz kılar. */
  assert.match(result.modelNotice, /gemma4:26b/);
  assert.match(result.modelNotice, /yüklenemedi/);
  assert.match(result.modelNotice, /qwen3:8b/);
});

test('v9.27 hiçbir model çalışmıyorsa sebep söyleniyor', async () => {
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'tek:1b' },
      async resolveModel() {
        return { model: 'tek:1b', requested: 'tek:1b', matched: true, reason: 'exact', supportsTools: true, capabilities: [], installed: ['tek:1b'], notice: null, toolNotice: null };
      },
      async chat() { throw new Error('llama-server process has terminated'); },
    }),
  });
  /* Bu makinede gerçekten yapılandırılmış NVIDIA/OpenRouter olabilir —
     onlar burada kasıtlı olarak KAPALI: bu test yerelin TÜKENDİĞİNİ,
     bulut yedeğinin devreye girip girmediğini değil, doğruluyor. Gerçek
     disk durumuna bağlı kalmak, ortama göre değişen kırılgan bir test
     üretirdi (bkz. v9.36 testlerindeki aynı izolasyon deseni). */
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origOrCreds = aiSettings.openrouterCredentials, origRouterState = aiSettings.nvidiaRouterState;
  aiSettings.openrouterCredentials = () => null;
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });
  copilot.resetModelResolutionCache();
  const userAccess = { hasArea: () => true };
  try {
    await assert.rejects(() => assistant.respond({
      question: 'Merhaba.', language: 'tr', profile: { areas: ['cp'] }, ownerId: 'u',
      toolRegistry: createToolRegistry({ userAccess, getDataset: async () => [] }),
      policyEngine: createPolicyEngine({ userAccess }),
    }), error => error && error.code === 'AI_MODEL_UNUSABLE' && /bellek\/GPU/.test(error.message));
  } finally {
    aiSettings.openrouterCredentials = origOrCreds;
    aiSettings.nvidiaRouterState = origRouterState;
  }
});

test('v9.27 yükleme dışı hata geri düşme tetiklemiyor', async () => {
  /* Zaman aşımı ya da ağ hatası modelin bozuk olduğu anlamına gelmez;
     model değiştirmek sorunu gizler ve kullanıcı yanlış teşhis alır. */
  let models = [];
  const assistant = copilot.createCopilotAssistant({
    providerFactory: overrides => {
      const model = (overrides && overrides.model) || 'qwen3:8b';
      models.push(model);
      return {
        config: { provider: 'ollama', model },
        async resolveModel() {
          return { model, requested: model, matched: true, reason: 'exact', supportsTools: true, capabilities: [], installed: [model], notice: null, toolNotice: null };
        },
        async chat() { throw Object.assign(new Error('AI sağlayıcı zaman aşımına uğradı.'), { code: 'AI_TIMEOUT' }); },
      };
    },
  });
  // Bkz. yukarıdaki test — gerçek disk durumundan bağımsız izolasyon.
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origOrCreds = aiSettings.openrouterCredentials, origRouterState = aiSettings.nvidiaRouterState;
  aiSettings.openrouterCredentials = () => null;
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });
  copilot.resetModelResolutionCache();
  const userAccess = { hasArea: () => true };
  try {
    await assert.rejects(() => assistant.respond({
      question: 'Merhaba.', language: 'tr', profile: { areas: ['cp'] }, ownerId: 'u',
      toolRegistry: createToolRegistry({ userAccess, getDataset: async () => [] }),
      policyEngine: createPolicyEngine({ userAccess }),
    }), error => error && error.code === 'AI_TIMEOUT');
    assert.equal(new Set(models).size, 1, 'model değiştirilmemeli');
  } finally {
    aiSettings.openrouterCredentials = origOrCreds;
    aiSettings.nvidiaRouterState = origRouterState;
  }
});
