'use strict';

/*
 * NVIDIA NIM Model Registry
 *
 * Yalnız METADATA. Hiçbir business logic, provider bağlantı kodu ya da
 * UI kararı burada yaşamaz — bunlar sırasıyla ai-provider-gateway.js,
 * agent-ai-settings.js ve copilot.js'te kalır. Yarın NVIDIA Build'e yeni
 * bir model eklendiğinde tek gereken şey NVIDIA_MODELS dizisine yeni bir
 * satır eklemektir; provider/router/UI kodu değişmeden yeni modeli
 * kullanılabilir hale getirir (bkz. kullanıcı talebi §17).
 *
 * Model ID'ler ve temel kapasiteler NVIDIA'nın docs.api.nvidia.com /
 * build.nvidia.com kataloğundan doğrulanmıştır (2026-09). DeepSeek özelinde:
 * tarihsiz "deepseek-ai/deepseek-v4-flash" ESKİ bir NIM girişidir; güncel
 * Free Endpoint varyantı tarih etiketli "deepseek-ai/deepseek-v4-flash-0731"
 * sürümüdür — bu yüzden registry'de eskisi deprecated bir ALIAS olarak
 * tutulur, asıl model olarak KULLANILMAZ.
 */

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

const NVIDIA_MODELS = Object.freeze([
  Object.freeze({
    modelId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    displayName: 'Nemotron 3.5 Lightning 30B',
    enabled: true,
    text: true, vision: false, reasoning: true, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 1000000, maxOutput: 8192,
    status: 'available', deprecated: false,
    recommendedUse: ['agent', 'general', 'long-running-task', 'tool-use'],
    // Hibrit Mamba-2 + MoE; uzun süren ajan görevleri için tasarlanmış (bkz.
    // NVIDIA teknik blogu). Reasoning parametresi doğrulanana kadar boş
    // bırakılır — yanlış tahmin edilmiş bir alan isteği kırar.
    requestOptions: Object.freeze({}),
  }),
  Object.freeze({
    modelId: 'deepseek-ai/deepseek-v4-flash-0731',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    text: true, vision: false, reasoning: true, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 1000000, maxOutput: 8192,
    status: 'available', deprecated: false,
    recommendedUse: ['coding', 'reasoning', 'agentic-analysis'],
    // Doğrulanan reasoning parametresi: reasoning_effort = low|high|max.
    // Varsayılan gönderilmez (opsiyonel) — kullanıcı Settings'ten seçerse
    // agent-ai-settings.nvidiaReasoningEffort üzerinden eklenir.
    requestOptions: Object.freeze({}),
    reasoningParam: 'reasoning_effort',
    reasoningLevels: Object.freeze(['low', 'high', 'max']),
  }),
  Object.freeze({
    modelId: 'minimaxai/minimax-m3',
    displayName: 'MiniMax M3',
    enabled: true,
    text: true, vision: true, reasoning: true, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 1000000, maxOutput: 8192,
    status: 'available', deprecated: false,
    recommendedUse: ['multimodal', 'reasoning', 'tool-use', 'creative'],
    // NVIDIA katalog notu: bu model "non-commercial use" lisansıyla
    // yayınlanmış. Buyer Log ticari kullanım için bu modeli seçmeden önce
    // NVIDIA/MiniMax lisans şartlarını gözden geçirmeli.
    requestOptions: Object.freeze({}),
    licenseNote: 'non-commercial-use-license',
  }),
  Object.freeze({
    modelId: 'meta/muse-glimmer-30b',
    displayName: 'Muse Glimmer 30B',
    enabled: true,
    text: true, vision: true, reasoning: true, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 120000, maxOutput: 8192,
    status: 'available', deprecated: false,
    recommendedUse: ['image-understanding', 'document-understanding', 'multimodal-reasoning', 'tool-use'],
    // Ekran görüntüsü/grafik/doküman anlama için özel olarak yayınlanmış;
    // Buyer Log ekran görüntüsü senaryosu için birincil aday.
    requestOptions: Object.freeze({}),
  }),
  Object.freeze({
    modelId: 'moonshotai/kimi-k3',
    displayName: 'Kimi K3',
    enabled: true,
    text: true, vision: true, reasoning: true, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 1048576, maxOutput: 8192,
    status: 'available', deprecated: false,
    recommendedUse: ['long-context', 'multimodal', 'agent-tool-workflow'],
    // NVIDIA dokümantasyonu: çok turlu araç çağrısı akışlarında önceki
    // asistan mesajının reasoning içeriğiyle birlikte GERİ gönderilmesini
    // bekliyor. Octopus'un mevcut mesaj geçmişi yalnız nihai JSON zarfını
    // taşıyor; bu nedenle Kimi K3 uzun çok-turlu araç döngülerinde tam
    // performans göstermeyebilir — tek-turlu/kısa döngü kullanım için uygun.
    requestOptions: Object.freeze({}),
  }),
  // Deprecated alias — asıl model DEĞİL. Eski kayıtlı bir ayar bu ID'yi
  // taşıyorsa status/deprecated alanları üzerinden tanınır ve Auto Router
  // bunu asla seçmez (bkz. agent-ai-settings.nvidiaCredentials).
  Object.freeze({
    modelId: 'deepseek-ai/deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash (eski)',
    enabled: false,
    text: true, vision: false, reasoning: false, toolCalling: true, structuredOutput: true,
    streaming: true,
    contextLength: 1000000, maxOutput: 8192,
    status: 'deprecated', deprecated: true,
    recommendedUse: [],
    requestOptions: Object.freeze({}),
    replacement: 'deepseek-ai/deepseek-v4-flash-0731',
  }),
]);

function listNvidiaModels({ includeDeprecated = true } = {}) {
  return NVIDIA_MODELS.filter(item => includeDeprecated || !item.deprecated).map(clone);
}
function getNvidiaModel(modelId) {
  const id = clean(modelId);
  const found = NVIDIA_MODELS.find(item => item.modelId === id);
  return found ? clone(found) : null;
}
function nvidiaDefaultModel() {
  const preferred = NVIDIA_MODELS.find(item => item.modelId === 'nvidia/nemotron-3.5-lightning-30b-a3b' && !item.deprecated);
  return preferred ? preferred.modelId : NVIDIA_MODELS.find(item => !item.deprecated).modelId;
}
function modelSupports(modelId, capability) {
  const model = getNvidiaModel(modelId);
  return Boolean(model && model[capability] === true);
}
function isKnownNvidiaModel(modelId) { return Boolean(getNvidiaModel(modelId)); }

module.exports = {
  NVIDIA_MODELS,
  listNvidiaModels,
  getNvidiaModel,
  nvidiaDefaultModel,
  modelSupports,
  isKnownNvidiaModel,
};
