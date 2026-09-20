'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');
const gateway = require('./ai-provider-gateway');
const modelRegistry = require('./ai-model-registry');

const SETTINGS_FILE = path.join(SERVER_DATA_ROOT, 'agent-ai-settings.json');
const SECRET_FILE = path.join(SERVER_DATA_ROOT, '.agent-ai-secret');
const SCHEMA_VERSION = 2;
const DEFAULT_PROVIDER = 'ollama';
const DEFAULT_MODEL = gateway.DEFAULT_MODEL;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1';

/* Bu makine gerçek bir kullanıcının GERÇEK NVIDIA/OpenRouter ayarlarını
   taşıyor. `node --test` bunu izole ETMEDEN çalıştırılan (mock koymayan)
   bir test, bu yüzden GERÇEK ağa gerçek anahtarla istek atabiliyordu —
   canlı olarak böyle oldu: onlarca ilgisiz test suitesi (v8.32, v9.22...)
   gerçek OpenRouter/NVIDIA çağrısı yapıp başarısız oldu. `node --test`
   `NODE_TEST_CONTEXT`'i güvenilir şekilde ayarlar; test kendi izole
   BUYER_LOG_SERVER_DATA_ROOT'unu kurduysa (bkz. testlerdeki
   loadSettingsWithRoot) bu koruma devre dışı kalır — o zaten kasıtlı
   gerçek hesaplama testidir. Bir test bu fonksiyonları doğrudan
   monkeypatch'lerse (aiSettings.nvidiaCredentials=...) bu kontrolün hiç
   önemi kalmaz, çünkü orijinal gövde hiç çalışmaz. */
function isUnisolatedTestRun() {
  return Boolean(process.env.NODE_TEST_CONTEXT) && !process.env.BUYER_LOG_SERVER_DATA_ROOT;
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function validModel(value) {
  const model = clean(value || DEFAULT_MODEL);
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) throw Object.assign(new Error('Geçersiz AI model adı.'), { code: 'AI_MODEL_INVALID', statusCode: 400 });
  return model;
}
function envKey() { return clean(process.env.BUYER_LOG_AGENT_OPENAI_API_KEY || process.env.OPENAI_API_KEY); }
function envOpenrouterKey() { return clean(process.env.BUYER_LOG_OPENROUTER_API_KEY); }
function envNvidiaKey() { return clean(process.env.BUYER_LOG_NVIDIA_API_KEY || process.env.NVIDIA_API_KEY); }
function envProvider() {
  const configured = clean(process.env.BUYER_LOG_AGENT_PROVIDER);
  if (configured) return gateway.normalizeProviderId(configured);
  return envKey() ? 'openai-compatible' : '';
}
function envModel() { return clean(process.env.BUYER_LOG_AGENT_MODEL); }
function envEndpoint() { return clean(process.env.BUYER_LOG_AGENT_BASE_URL || process.env.BUYER_LOG_AGENT_ENDPOINT); }
const OPENROUTER_DEFAULT_MODEL = 'minimax/minimax-m3:free';
const NVIDIA_DEFAULT_MODEL = modelRegistry.nvidiaDefaultModel();

function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
    profile: gateway.profileForModel(DEFAULT_MODEL), endpoint: '', encryptedApiKey: null,
    temperature: 0.1, contextLimit: 8192, thinking: true, toolCalling: 'auto',
    autoCheckUpdates: true, autoDownloadUpdates: false, updatedAt: null,
    // Kapatılırsa Auto/boş model seçiminde yerel sağlayıcı (Ollama/LM
    // Studio/Custom) HİÇ denenmez — doğrudan NVIDIA/OpenRouter'a gidilir.
    // "Sağlayıcı" açılır listesinde yereli kapatacak bir seçenek yoktu; bu
    // ayrı anahtar o boşluğu dolduruyor (bkz. kullanıcı geri bildirimi).
    localProviderEnabled: true,
    openrouterEnabled: false,
    openrouterModel: OPENROUTER_DEFAULT_MODEL,
    openrouterDataPolicy: 'off',
    encryptedOpenrouterKey: null,
    nvidiaEnabled: false,
    nvidiaDataPolicy: 'off',
    nvidiaDefaultModel: NVIDIA_DEFAULT_MODEL,
    nvidiaUseInAutoRouter: false,
    nvidiaReasoningEffort: '',
    // Modeli devre dışı bırakmak için: { [modelId]: false }. Yokluk =
    // registry'nin kendi `enabled` alanı geçerli (varsayılan hepsi açık).
    nvidiaModelOverrides: {},
    // Canlı sağlık: { [modelId]: { status, lastError, lastSuccessAt } }.
    // Statik kapasiteden AYRI tutulur çünkü bu, gerçek çağrı sonuçlarına
    // göre değişen çalışma zamanı bilgisidir (bkz. kullanıcı talebi §12).
    nvidiaHealth: {},
    nvidiaLastSuccessfulConnection: null,
    nvidiaLastError: null,
    encryptedNvidiaKey: null,
  };
}
function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return defaultSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    const legacyOpenAi = clean(raw.provider).toLowerCase() === 'openai';
    const provider = gateway.normalizeProviderId(raw.provider || DEFAULT_PROVIDER);
    return {
      ...defaultSettings(), ...raw, schemaVersion: SCHEMA_VERSION, provider,
      model: validModel(raw.model || DEFAULT_MODEL),
      profile: clean(raw.profile) || gateway.profileForModel(raw.model || DEFAULT_MODEL),
      endpoint: clean(raw.endpoint || raw.baseUrl) || (legacyOpenAi ? OPENAI_ENDPOINT : ''),
    };
  } catch (_) { return defaultSettings(); }
}
function secretKey() {
  fs.mkdirSync(SERVER_DATA_ROOT, { recursive: true });
  const fromEnv = clean(process.env.BUYER_LOG_AGENT_SETTINGS_KEY);
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
  if (fs.existsSync(SECRET_FILE)) {
    const buf = fs.readFileSync(SECRET_FILE);
    if (buf.length === 32) return buf;
  }
  const buf = crypto.randomBytes(32);
  atomicWriteBuffer(SECRET_FILE, buf);
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) {}
  return buf;
}
function encryptApiKey(value) {
  const text = clean(value); if (!text) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]), tag = cipher.getAuthTag();
  return { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}
function decryptApiKey(payload) {
  if (!payload || payload.alg !== 'aes-256-gcm') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return clean(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch (_) { return ''; }
}
function storedKey(settings = loadSettings()) { return decryptApiKey(settings.encryptedApiKey); }
function storedOpenrouterKey(settings = loadSettings()) { return decryptApiKey(settings.encryptedOpenrouterKey); }
function storedNvidiaKey(settings = loadSettings()) { return decryptApiKey(settings.encryptedNvidiaKey); }
function maskKey(value) {
  const key = clean(value); if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `••••••••${key.slice(-4)}`;
}
function credentials(overrides = {}) {
  const settings = loadSettings();
  const provider = gateway.normalizeProviderId(overrides.provider || envProvider() || settings.provider || DEFAULT_PROVIDER);
  /* OpenRouter/NVIDIA kendi SABİT bulut endpoint'i ve ayrı anahtar/politika
     sistemine sahiptir (bkz. openrouterCredentials/nvidiaCredentials).
     Birincil sağlayıcının (Ollama/LM Studio/Custom OpenAI-compatible) saklı
     endpoint'i, BASE_URL ortam değişkeni ya da anahtarı bunlara SIZMAMALI —
     aksi hâlde ör. "NVIDIA'yı Test Et" isteği yanlışlıkla yerel Ollama
     sunucusuna gider (404 ile sonuçlanır) ya da yanlış anahtar kullanılır.
     Bu yol yalnız provider açıkça override edilip primary'den FARKLIYSA
     devreye girer; primary sağlayıcının normal akışı etkilenmez. */
  const isCloudFixedProvider = (provider === 'openrouter' || provider === 'nvidia') && provider !== settings.provider;
  const overrideKey = clean(overrides.apiKey);
  // Birincil sağlayıcının anahtarı sızmasın diye kapatılıyor AMA kendi
  // ayrı anahtarı (encryptedNvidiaKey/encryptedOpenrouterKey) yerine
  // konmalı — yoksa "Test Connection" apiKey alanı boş bırakıldığında
  // (kaydedilmiş anahtarı kullanmak isteyen akış) sessizce anahtarsız
  // isteğe düşer ve NVIDIA/OpenRouter 401 döner (bu tam olarak yaşandı).
  const environmentKey = isCloudFixedProvider
    ? (provider === 'nvidia' ? envNvidiaKey() : envOpenrouterKey())
    : envKey();
  const savedKey = isCloudFixedProvider
    ? (provider === 'nvidia' ? storedNvidiaKey(settings) : storedOpenrouterKey(settings))
    : storedKey(settings);
  const model = validModel(overrides.model || envModel() || settings.model || DEFAULT_MODEL);
  const configuredEndpoint = overrides.endpoint || overrides.baseUrl
    || (isCloudFixedProvider ? '' : (envEndpoint() || settings.endpoint))
    || (provider === 'openai-compatible' ? OPENAI_ENDPOINT : '');
  const endpoint = gateway.normalizeEndpoint(provider, configuredEndpoint);
  const apiKey = overrideKey || environmentKey || savedKey;
  return {
    provider, apiKey, model, endpoint, profile: clean(overrides.profile || settings.profile) || gateway.profileForModel(model),
    temperature: overrides.temperature == null ? Number(settings.temperature) : Number(overrides.temperature),
    contextLimit: overrides.contextLimit == null ? Number(settings.contextLimit) : Number(overrides.contextLimit),
    source: overrideKey ? 'temporary' : environmentKey ? 'environment' : savedKey ? 'application' : 'none',
  };
}
/* Model kartlarını Settings ekranı için birleştirir: statik kapasite
   (registry) + kullanıcının açık/kapalı tercihi + canlı sağlık durumu.
   Deprecated alias burada da görünür — kullanıcı "neden DeepSeek eski
   sürümü kullanılmıyor" diye sorarsa görebilsin (bkz. kullanıcı talebi
   §10, §12). */
function nvidiaModelStatusList(settings) {
  const overrides = settings.nvidiaModelOverrides || {};
  const health = settings.nvidiaHealth || {};
  return modelRegistry.listNvidiaModels({ includeDeprecated: true }).map(model => {
    const enabled = overrides[model.modelId] != null ? overrides[model.modelId] === true : model.enabled !== false;
    const h = health[model.modelId];
    return {
      ...model, enabled,
      status: model.deprecated ? 'deprecated' : (h && h.status) || model.status,
      lastError: h && h.lastError || null,
      lastSuccessAt: h && h.lastSuccessAt || null,
    };
  });
}
function publicSettings() {
  const settings = loadSettings(), creds = credentials(), savedKey = storedKey(settings);
  const provider = gateway.PROVIDERS[creds.provider];
  const orKey = storedOpenrouterKey(settings) || envOpenrouterKey();
  const nvKey = storedNvidiaKey(settings) || envNvidiaKey();
  return {
    provider: creds.provider, providerLabel: provider.label, model: creds.model, profile: creds.profile,
    endpoint: creds.endpoint, configured: creds.provider !== 'openai-compatible' || Boolean(creds.apiKey),
    mode: creds.provider, source: creds.source, hasStoredKey: Boolean(savedKey),
    maskedStoredKey: maskKey(savedKey), environmentConfigured: Boolean(envKey()),
    recommendedModels: gateway.recommendedModels(), autoCheckUpdates: settings.autoCheckUpdates !== false,
    autoDownloadUpdates: settings.autoDownloadUpdates === true, updatedAt: settings.updatedAt || null,
    localProviderEnabled: settings.localProviderEnabled !== false,
    openrouter: {
      enabled: settings.openrouterEnabled === true,
      hasKey: Boolean(orKey),
      maskedKey: maskKey(orKey),
      model: settings.openrouterModel || OPENROUTER_DEFAULT_MODEL,
      dataPolicy: settings.openrouterDataPolicy || 'off',
      environmentConfigured: Boolean(envOpenrouterKey()),
      freeModels: gateway.openrouterFreeModels(),
    },
    nvidia: {
      enabled: settings.nvidiaEnabled === true,
      hasKey: Boolean(nvKey),
      maskedKey: maskKey(nvKey),
      dataPolicy: settings.nvidiaDataPolicy || 'off',
      environmentConfigured: Boolean(envNvidiaKey()),
      defaultModel: settings.nvidiaDefaultModel || NVIDIA_DEFAULT_MODEL,
      useInAutoRouter: settings.nvidiaUseInAutoRouter === true,
      reasoningEffort: clean(settings.nvidiaReasoningEffort) || '',
      models: nvidiaModelStatusList(settings),
      lastSuccessfulConnection: settings.nvidiaLastSuccessfulConnection || null,
      lastError: settings.nvidiaLastError || null,
      endpoint: gateway.PROVIDERS.nvidia.endpoint,
    },
  };
}
function saveSettings(input = {}) {
  const current = loadSettings();
  const provider = gateway.normalizeProviderId(input.provider || current.provider || DEFAULT_PROVIDER);
  const model = validModel(input.model || current.model || DEFAULT_MODEL);
  const endpointValue = input.endpoint || input.baseUrl;
  const endpoint = endpointValue == null ? current.endpoint : clean(endpointValue);
  gateway.normalizeEndpoint(provider, endpoint);
  const next = {
    ...current, schemaVersion: SCHEMA_VERSION, provider, model,
    profile: clean(input.profile) || gateway.profileForModel(model), endpoint,
    temperature: input.temperature == null ? current.temperature : Math.max(0, Math.min(2, Number(input.temperature) || 0)),
    contextLimit: input.contextLimit == null ? current.contextLimit : Math.max(512, Math.min(131072, Math.round(Number(input.contextLimit) || 8192))),
    thinking: input.thinking == null ? current.thinking !== false : input.thinking === true,
    toolCalling: ['auto', 'native', 'fallback', 'off'].includes(clean(input.toolCalling)) ? clean(input.toolCalling) : current.toolCalling,
    autoCheckUpdates: input.autoCheckUpdates == null ? current.autoCheckUpdates !== false : input.autoCheckUpdates === true,
    autoDownloadUpdates: input.autoDownloadUpdates == null ? current.autoDownloadUpdates === true : input.autoDownloadUpdates === true,
    localProviderEnabled: input.localProviderEnabled == null ? current.localProviderEnabled !== false : input.localProviderEnabled === true,
    updatedAt: new Date().toISOString(),
  };
  if (input.clearKey === true) next.encryptedApiKey = null;
  else if (clean(input.apiKey)) next.encryptedApiKey = encryptApiKey(input.apiKey);
  if (input.openrouterEnabled != null) next.openrouterEnabled = input.openrouterEnabled === true;
  if (input.openrouterDataPolicy === 'allowed' || input.openrouterDataPolicy === 'off') next.openrouterDataPolicy = input.openrouterDataPolicy;
  const orModel = clean(input.openrouterModel);
  if (orModel && /^[A-Za-z0-9._:/@-]{1,200}$/.test(orModel)) next.openrouterModel = orModel;
  if (input.clearOpenrouterKey === true) next.encryptedOpenrouterKey = null;
  else if (clean(input.openrouterApiKey)) {
    const orKeyValue = clean(input.openrouterApiKey);
    // Ters yönlü aynı karışıklık: bir NVIDIA anahtarının (nvapi-...) bu
    // alana yapıştırılması da açıkça reddedilir (bkz. NVIDIA alanındaki
    // aynı kontrol).
    if (orKeyValue.startsWith('nvapi-')) {
      throw Object.assign(new Error('Bu bir OpenRouter API anahtarına benzemiyor — NVIDIA anahtarı (nvapi-...) gibi görünüyor. Doğru alana taşıyın.'),
        { code: 'AI_INVALID_KEY_FORMAT', statusCode: 400 });
    }
    next.encryptedOpenrouterKey = encryptApiKey(orKeyValue);
  }
  if (input.nvidiaEnabled != null) next.nvidiaEnabled = input.nvidiaEnabled === true;
  if (input.nvidiaDataPolicy === 'allowed' || input.nvidiaDataPolicy === 'off') next.nvidiaDataPolicy = input.nvidiaDataPolicy;
  if (input.nvidiaUseInAutoRouter != null) next.nvidiaUseInAutoRouter = input.nvidiaUseInAutoRouter === true;
  const nvModel = clean(input.nvidiaDefaultModel);
  // Bilinmeyen ya da deprecated bir modeli varsayılan yapmak, her istekte
  // sessizce başka modele düşen bir yapılandırma üretirdi — reddedilir.
  if (nvModel) {
    const known = modelRegistry.getNvidiaModel(nvModel);
    if (!known || known.deprecated) throw Object.assign(new Error(`Geçersiz ya da deprecated NVIDIA modeli: ${nvModel}`), { code: 'AI_MODEL_INVALID', statusCode: 400 });
    next.nvidiaDefaultModel = nvModel;
  }
  const nvEffort = clean(input.nvidiaReasoningEffort);
  if (input.nvidiaReasoningEffort === '' || input.nvidiaReasoningEffort === null) next.nvidiaReasoningEffort = '';
  else if (['low', 'high', 'max'].includes(nvEffort)) next.nvidiaReasoningEffort = nvEffort;
  if (input.nvidiaModelOverrides && typeof input.nvidiaModelOverrides === 'object') {
    const merged = { ...(current.nvidiaModelOverrides || {}) };
    for (const [modelId, value] of Object.entries(input.nvidiaModelOverrides)) {
      if (modelRegistry.getNvidiaModel(modelId)) merged[clean(modelId)] = value === true;
    }
    next.nvidiaModelOverrides = merged;
  }
  if (input.clearNvidiaKey === true) next.encryptedNvidiaKey = null;
  else if (clean(input.nvidiaApiKey)) {
    const nvKeyValue = clean(input.nvidiaApiKey);
    /* Canlı kullanımda İKİ KEZ yaşandı: kullanıcı yanlışlıkla OpenRouter
       anahtarını (sk-or-v1-...) bu alana yapıştırdı, kayıt sessizce kabul
       etti ve NVIDIA saatlerce 401 verdi. İstemcideki uyarı yeterli
       olmadı — burada SUNUCU TARAFINDA reddediliyor. NVIDIA anahtarları
       her zaman "nvapi-" ile başlar. */
    if (!nvKeyValue.startsWith('nvapi-')) {
      throw Object.assign(new Error('Bu bir NVIDIA API anahtarına benzemiyor (nvapi- ile başlamalı). Başka bir sağlayıcının anahtarını yapıştırmış olabilirsiniz.'),
        { code: 'AI_INVALID_KEY_FORMAT', statusCode: 400 });
    }
    next.encryptedNvidiaKey = encryptApiKey(nvKeyValue);
    /* Yeni anahtar eskisiyle ilgisizdir — eski health kayıtları (özellikle
       "auth-error") artık STALE. Temizlenmezse Auto Router bu modelleri
       KALICI olarak dışlamaya devam eder: rankNvidiaCandidates
       auth-error'ı asla seçmez, yeni doğru anahtar kaydedilse bile hiçbir
       şey onu yeniden denemez (canlı olarak böyle sıkıştı). */
    next.nvidiaHealth = {};
  }
  if (input.clearNvidiaKey === true) next.nvidiaHealth = {};
  atomicWriteJson(SETTINGS_FILE, next);
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch (_) {}
  return publicSettings();
}
/* OpenRouter bulut yedek sağlayıcısı için kimlik bilgilerini döndürür.
   null döndüğünde fallback tetiklenmez — ajan locale kalmaya devam eder.
   Üç koşul birlikte sağlanmalı: açık, veri politikası onaylı, anahtar var. */
function openrouterCredentials(overrides = {}) {
  if (isUnisolatedTestRun()) return null;
  const settings = loadSettings();
  if (!settings.openrouterEnabled) return null;
  if (settings.openrouterDataPolicy !== 'allowed') return null;
  const apiKey = storedOpenrouterKey(settings) || envOpenrouterKey();
  if (!apiKey) return null;
  // overrides.model: Model Selector'da kullanıcının BİLEREK belirli bir
  // OpenRouter modeli seçtiği manuel akış (bkz. NVIDIA'daki aynı desen).
  // Verilmezse Settings'te kayıtlı varsayılana düşülür (mevcut fallback
  // davranışı DEĞİŞMEDEN korunur).
  const requestedModel = clean(overrides.model) || settings.openrouterModel || OPENROUTER_DEFAULT_MODEL;
  return {
    provider: 'openrouter',
    apiKey,
    model: requestedModel,
    endpoint: gateway.PROVIDERS.openrouter.endpoint,
    temperature: 0.25,
    contextLimit: 8192,
    profile: 'cloud-free',
  };
}
/* NVIDIA NIM için kimlik bilgileri. Üç kilit birlikte sağlanmalı (aynı
   OpenRouter deseni — bkz. openrouterCredentials): açık, veri politikası
   onaylı, anahtar var. Ayrıca istenen model deprecated/devre dışıysa ya da
   hiç bilinmiyorsa reddedilir; sessizce başka modele düşmek burada YANLIŞ
   olur çünkü çağıran (router ya da manuel seçim) zaten hangi modeli
   istediğini biliyor — düşme kararı çağıranın işi. */
function nvidiaCredentials(overrides = {}) {
  if (isUnisolatedTestRun()) return null;
  const settings = loadSettings();
  if (!settings.nvidiaEnabled) return null;
  if (settings.nvidiaDataPolicy !== 'allowed') return null;
  const apiKey = storedNvidiaKey(settings) || envNvidiaKey();
  if (!apiKey) return null;
  const requestedModel = clean(overrides.model) || settings.nvidiaDefaultModel || NVIDIA_DEFAULT_MODEL;
  const known = modelRegistry.getNvidiaModel(requestedModel);
  if (!known || known.deprecated) return null;
  const overrideEnabled = settings.nvidiaModelOverrides && settings.nvidiaModelOverrides[requestedModel];
  if (overrideEnabled === false) return null;
  return {
    provider: 'nvidia',
    apiKey,
    model: requestedModel,
    endpoint: gateway.PROVIDERS.nvidia.endpoint,
    temperature: 0.25,
    contextLimit: Math.min(known.contextLength || 8192, 131072),
    profile: 'nvidia-nim',
    reasoningEffort: clean(settings.nvidiaReasoningEffort) || undefined,
  };
}
/* Enabled NVIDIA modelleri arasından, deprecated/devre-dışı olmayanları
   sırayla döner — Auto Router'ın (ai-model-router.js) aday listesini
   üretmek için canlı sağlık + kullanıcı ayarını buradan alır. */
function nvidiaRouterState() {
  if (isUnisolatedTestRun()) return { eligible: false, health: {}, overrides: {} };
  const settings = loadSettings();
  const apiKey = storedNvidiaKey(settings) || envNvidiaKey();
  // Üç kilit + Auto Router anahtarı: Auto modda NVIDIA'nın hiç denenmesi
  // için hepsi birlikte sağlanmalı (bkz. openrouterCredentials/
  // nvidiaCredentials'taki aynı desen). Bu alan eksikti — sonuç olarak
  // Auto Router NVIDIA'yı GERÇEKTE hiç aday olarak görmüyordu.
  const eligible = settings.nvidiaEnabled === true && settings.nvidiaDataPolicy === 'allowed'
    && settings.nvidiaUseInAutoRouter === true && Boolean(apiKey);
  return { eligible, health: settings.nvidiaHealth || {}, overrides: settings.nvidiaModelOverrides || {} };
}
/* "Sağlayıcı" açılır listesinde yereli (Ollama/LM Studio/Custom) kapatacak
   bir seçenek yok — bu ayrı anahtar o boşluğu dolduruyor. Yalnız Auto/boş
   model seçiminde etkilidir; kullanıcı belirli bir yerel model adını
   AÇIKÇA seçtiyse bu her zaman saygı görür (bkz. copilot-agent.js). */
function isLocalProviderEnabled() {
  // Testler yereli AÇIK varsayar (mevcut davranış); bu makinedeki gerçek
  // ayar kapalıysa bile izole olmayan bir test suitesi bundan etkilenmemeli.
  if (isUnisolatedTestRun()) return true;
  return loadSettings().localProviderEnabled !== false;
}
/* Gerçek bir çağrı sonucu (başarı/başarısızlık) burada kalıcı hale gelir.
   Yalnız KAYDEDER — hangi modelin bir sonraki denemede seçileceğine
   ai-model-router.js karar verir. */
function recordNvidiaHealth(modelId, outcome = {}) {
  const id = clean(modelId);
  if (!id) return;
  const settings = loadSettings();
  const health = { ...(settings.nvidiaHealth || {}) };
  const now = new Date().toISOString();
  if (outcome.ok) {
    health[id] = { status: 'available', lastError: null, lastSuccessAt: now };
    settings.nvidiaLastSuccessfulConnection = now;
    settings.nvidiaLastError = null;
  } else {
    const status = clean(outcome.status) || 'unavailable';
    health[id] = { status, lastError: clean(outcome.message).slice(0, 300) || status, lastSuccessAt: health[id] && health[id].lastSuccessAt || null };
    settings.nvidiaLastError = `${id}: ${health[id].lastError}`;
  }
  const next = { ...settings, nvidiaHealth: health, updatedAt: settings.updatedAt };
  atomicWriteJson(SETTINGS_FILE, next);
  try { fs.chmodSync(SETTINGS_FILE, 0o600); } catch (_) {}
}

async function testConnection(input = {}) {
  const creds = credentials(input);
  const provider = gateway.createProvider(creds);
  try {
    const result = await provider.testConnection({ inference: true });
    if (creds.provider === 'nvidia') recordNvidiaHealth(creds.model, { ok: true });
    return { ...result, source: creds.source, endpoint: creds.endpoint };
  } catch (error) {
    if (creds.provider === 'nvidia') recordNvidiaHealth(creds.model, { ok: false, status: gateway.classifyProviderError(error), message: error && error.message });
    throw error;
  }
}

module.exports = {
  credentials, publicSettings, saveSettings, testConnection, loadSettings, maskKey,
  openrouterCredentials,
  nvidiaCredentials, nvidiaRouterState, recordNvidiaHealth, isLocalProviderEnabled,
  DEFAULT_MODEL, DEFAULT_PROVIDER, OPENAI_ENDPOINT, SETTINGS_FILE, OPENROUTER_DEFAULT_MODEL, NVIDIA_DEFAULT_MODEL,
};
