'use strict';

/* v9.38 — OCTOPUS MULTIMODAL (§7)
 *
 * Görsel yükleme UI'ı yoktu; gateway teknik olarak mesaj içeriğini array
 * olarak taşıyabiliyordu ama hiçbir çağıran bunu kurmuyordu. Bu test şunu
 * doğrular:
 *
 * 1. providerSupportsVision: yalnız NVIDIA registry'sinde vision:true olan
 *    modeller (MiniMax M3, Muse Glimmer 30B, Kimi K3) "görüyor" sayılır;
 *    Nemotron/DeepSeek ve kapasitesi izlenmeyen sağlayıcılar (OpenRouter/
 *    Ollama varsayılan) görmüyor sayılır.
 * 2. Kullanıcı BİLEREK vision desteklemeyen bir NVIDIA/OpenRouter modeli
 *    seçip görsel eklerse: sessizce başka modele kaymak YERİNE açık hata
 *    verilir (manuel tercih saygı görür).
 * 3. Auto/yerel akışta görsel eklenirse: vision destekleyen bir NVIDIA
 *    adayına otomatik geçilir; hiçbiri yapılandırılmamışsa açık hata verir.
 * 4. Görsel YOKSA hiçbir şey değişmez (mesaj içeriği düz string kalır) —
 *    regresyon yok.
 * 5. Vision'lı bir istek gerçekten OpenAI-uyumlu content-array şeklinde
 *    gönderiliyor: [{type:'text',...},{type:'image_url',...}].
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const gateway = require('../server/lib/ai-provider-gateway');
const copilot = require('../server/lib/copilot-agent');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');

const userAccess = { hasArea: () => true, appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon'] };
const toolRegistry = createToolRegistry({ userAccess, getDataset: async () => [] });
const policyEngine = createPolicyEngine({ userAccess });

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function pngAttachment() { return [{ mimeType: 'image/png', dataBase64: PNG_1PX }]; }

test('v9.38 manuel olarak vision desteklemeyen NVIDIA modeli + görsel: açık hata (sessiz geçiş yok)', async () => {
  let called = false;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {},
    cloudProviderFactory: () => ({ config: { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' }, async chat() { called = true; return { content: '{}' }; } }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origCreds = aiSettings.nvidiaCredentials;
  aiSettings.nvidiaCredentials = ({ model }) => ({ provider: 'nvidia', apiKey: 'k', model, endpoint: gateway.PROVIDERS.nvidia.endpoint });
  copilot.resetModelResolutionCache();
  try {
    await assert.rejects(
      assistant.respond({ question: 'Bu görselde ne var?', model: 'nvidia:nvidia/nemotron-3.5-lightning-30b-a3b', attachments: pngAttachment(), profile, ownerId: 'u1', toolRegistry, policyEngine }),
      err => err.code === 'AI_VISION_UNSUPPORTED',
    );
  } finally { aiSettings.nvidiaCredentials = origCreds; }
  assert.equal(called, false, 'vision desteklemeyen modele hiç istek gitmemeli');
});

test('v9.38 Auto akışta görsel eklenirse vision destekleyen NVIDIA adayına otomatik geçilir', async () => {
  let usedModel = null, sentContent = null;
  const assistant = copilot.createCopilotAssistant({
    recordNvidiaHealth: () => {},
    providerFactory: () => { throw new Error('yerel hiç çağrılmamalıydı — görsel var, yerel vision desteklemiyor'); },
    cloudProviderFactory: creds => ({
      config: { provider: 'nvidia', model: creds.model },
      async chat(messages) {
        usedModel = creds.model;
        sentContent = messages[messages.length - 1].content;
        return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'Bir kedi görüyorum.' }), model: creds.model };
      },
    }),
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origRouterState = aiSettings.nvidiaRouterState;
  const origNvCreds = aiSettings.nvidiaCredentials;
  aiSettings.nvidiaRouterState = () => ({ eligible: true, health: {}, overrides: {} });
  aiSettings.nvidiaCredentials = ({ model }) => ({ provider: 'nvidia', apiKey: 'k', model, endpoint: gateway.PROVIDERS.nvidia.endpoint });
  copilot.resetModelResolutionCache();
  let result;
  try {
    result = await assistant.respond({ question: 'Bu görselde ne var?', model: '', attachments: pngAttachment(), profile, ownerId: 'u1', toolRegistry, policyEngine });
  } finally {
    aiSettings.nvidiaRouterState = origRouterState;
    aiSettings.nvidiaCredentials = origNvCreds;
  }
  assert.equal(result.ok, true);
  // Nemotron/DeepSeek vision desteklemiyor; router yalnız vision:true olan
  // (MiniMax M3/Muse Glimmer/Kimi K3) adaylardan birini seçmeli.
  const chosen = gateway.PROVIDERS.nvidia && require('../server/lib/ai-model-registry').getNvidiaModel(usedModel);
  assert.ok(chosen && chosen.vision, `seçilen model (${usedModel}) vision desteklemeli`);
  assert.ok(Array.isArray(sentContent), 'mesaj içeriği content-array olmalı');
  assert.ok(sentContent.some(part => part.type === 'image_url'), 'image_url parçası olmalı');
  assert.ok(sentContent.some(part => part.type === 'text'), 'text parçası olmalı');
});

test('v9.38 görsel var ama hiçbir vision modeli yapılandırılmamışsa açık hata verir', async () => {
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => { throw new Error('çağrılmamalı'); },
  });
  const aiSettings = require('../server/lib/agent-ai-settings');
  const origRouterState = aiSettings.nvidiaRouterState;
  const origOrCreds = aiSettings.openrouterCredentials;
  aiSettings.nvidiaRouterState = () => ({ eligible: false, health: {}, overrides: {} });
  aiSettings.openrouterCredentials = () => null;
  copilot.resetModelResolutionCache();
  try {
    await assert.rejects(
      assistant.respond({ question: 'Bu görselde ne var?', model: '', attachments: pngAttachment(), profile, ownerId: 'u1', toolRegistry, policyEngine }),
      err => err.code === 'AI_VISION_NOT_CONFIGURED',
    );
  } finally {
    aiSettings.nvidiaRouterState = origRouterState;
    aiSettings.openrouterCredentials = origOrCreds;
  }
});

test('v9.38 görsel yoksa mesaj içeriği düz string kalır (regresyon yok)', async () => {
  let sentContent = null;
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', matched: true, supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat(messages) { sentContent = messages[messages.length - 1].content; return { content: JSON.stringify({ type: 'answer', mode: 'general', answer: 'ok' }), model: 'gemma4:12b' }; },
    }),
  });
  copilot.resetModelResolutionCache();
  const result = await assistant.respond({ question: 'Merhaba.', profile, ownerId: 'u1', toolRegistry, policyEngine });
  assert.equal(result.ok, true);
  assert.equal(typeof sentContent, 'string');
});

test('v9.38 modelRegistry vision flag\'leri beklendiği gibi (MiniMax/Muse Glimmer/Kimi K3 görüyor, Nemotron/DeepSeek görmüyor)', () => {
  const registry = require('../server/lib/ai-model-registry');
  assert.equal(registry.getNvidiaModel('minimaxai/minimax-m3').vision, true);
  assert.equal(registry.getNvidiaModel('meta/muse-glimmer-30b').vision, true);
  assert.equal(registry.getNvidiaModel('moonshotai/kimi-k3').vision, true);
  assert.equal(registry.getNvidiaModel('nvidia/nemotron-3.5-lightning-30b-a3b').vision, false);
  assert.equal(registry.getNvidiaModel('deepseek-ai/deepseek-v4-flash-0731').vision, false);
});
