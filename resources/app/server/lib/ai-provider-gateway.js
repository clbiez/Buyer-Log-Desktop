'use strict';

/*
 * Buyer Log AI Provider Gateway
 *
 * The rest of the application speaks to this small contract instead of
 * knowing whether the selected model lives in Ollama, LM Studio, or another
 * OpenAI-compatible server.  Provider-specific wire formats stay here.
 */

const DEFAULT_MODEL = 'gemma4:12b';

const PROVIDERS = Object.freeze({
  ollama: Object.freeze({
    id: 'ollama', label: 'Ollama', kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434', localOnly: true,
  }),
  lmstudio: Object.freeze({
    id: 'lmstudio', label: 'LM Studio', kind: 'openai-compatible',
    endpoint: 'http://127.0.0.1:1234/v1', localOnly: true,
  }),
  'openai-compatible': Object.freeze({
    id: 'openai-compatible', label: 'Custom OpenAI-Compatible', kind: 'openai-compatible',
    endpoint: '', localOnly: false,
  }),
  openrouter: Object.freeze({
    id: 'openrouter', label: 'OpenRouter (Free)', kind: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1', localOnly: false,
  }),
  nvidia: Object.freeze({
    id: 'nvidia', label: 'NVIDIA NIM', kind: 'openai-compatible',
    endpoint: 'https://integrate.api.nvidia.com/v1', localOnly: false,
  }),
});

const MODEL_PROFILES = Object.freeze([
  Object.freeze({ id: 'qwen3:8b', name: 'Qwen3 8B', profile: 'fast', description: 'Fast · Lower hardware requirement', default: false }),
  Object.freeze({ id: 'gemma4:12b', name: 'Gemma 4 12B', profile: 'balanced', description: 'Default · Balanced', default: true }),
  Object.freeze({ id: 'gemma4:26b', name: 'Gemma 4 26B', profile: 'advanced', description: 'Slow · Higher hardware requirement', default: false }),
]);

const modelRegistry = require('./ai-model-registry');

/* OpenRouter'ın ücretsiz katalogu SIK değişiyor — v9.35'te seçilen 4 model
   (Llama 3.1 8B, Mistral 7B, Gemma 2 9B, Qwen3 8B) birkaç ay içinde
   OpenRouter tarafından kaldırıldı/ücretliye taşındı, hepsi 404/"unavailable
   for free" döndürüyordu. Bu liste gerçek API + gerçek anahtarla yeniden
   doğrulandı (2026-09). OpenRouter değiştikçe bu yine bozulabilir —
   Settings > OpenRouter > Test Connection ilk fark edilme yeridir. */
const OPENROUTER_FREE_MODELS = Object.freeze([
  Object.freeze({ id: 'minimax/minimax-m3:free', name: 'MiniMax M3', description: 'Free · Genel amaçlı · JSON modu', default: true }),
  Object.freeze({ id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning', description: 'Free · NVIDIA · Hızlı' }),
  Object.freeze({ id: 'cohere/north-mini-code:free', name: 'North Mini Code', description: 'Free · Cohere · Kodlama' }),
  Object.freeze({ id: 'dots-studio/dots-3-note-preview:free', name: 'Dots 3 Note Preview', description: 'Free · Genel amaçlı' }),
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function providerIds() { return Object.keys(PROVIDERS); }
function defaultModel() { return DEFAULT_MODEL; }
function recommendedModels() { return MODEL_PROFILES.map(clone); }
function openrouterFreeModels() { return OPENROUTER_FREE_MODELS.map(clone); }
function nvidiaModels() { return modelRegistry.listNvidiaModels(); }

function normalizeProviderId(value) {
  const key = clean(value).toLowerCase();
  if (key === 'openai' || key === 'custom' || key === 'custom-openai-compatible') return 'openai-compatible';
  return providerIds().includes(key) ? key : 'ollama';
}

function profileForModel(model) {
  const known = MODEL_PROFILES.find(item => item.id.toLowerCase() === clean(model).toLowerCase());
  return known ? known.profile : 'custom';
}

function modelProfile(model) {
  const known = MODEL_PROFILES.find(item => item.id.toLowerCase() === clean(model).toLowerCase());
  return known ? clone(known) : {
    id: clean(model), name: clean(model), profile: 'custom',
    description: 'Custom model', default: false,
  };
}

function assertUrl(value, providerId) {
  const source = clean(value);
  if (!source) throw Object.assign(new Error('AI sağlayıcı adresi zorunludur.'), { code: 'AI_ENDPOINT_REQUIRED', statusCode: 400 });
  let parsed;
  try { parsed = new URL(source); } catch (_) {
    throw Object.assign(new Error('AI sağlayıcı adresi geçerli değil.'), { code: 'AI_ENDPOINT_INVALID', statusCode: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw Object.assign(new Error('AI sağlayıcı adresi yalnızca http/https ve kimlik bilgisi içermeyen bir URL olabilir.'), { code: 'AI_ENDPOINT_INVALID', statusCode: 400 });
  }
  if (PROVIDERS[providerId].localOnly && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw Object.assign(new Error('Yerel AI sağlayıcıları yalnızca bu bilgisayardaki bir adrese bağlanabilir.'), { code: 'AI_ENDPOINT_NOT_LOCAL', statusCode: 400 });
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeEndpoint(provider, value) {
  const providerId = normalizeProviderId(provider);
  const configured = clean(value);
  if (!configured) {
    const fallback = PROVIDERS[providerId].endpoint;
    if (!fallback) throw Object.assign(new Error('Custom OpenAI-compatible sağlayıcı için Base URL zorunludur.'), { code: 'AI_ENDPOINT_REQUIRED', statusCode: 400 });
    return fallback;
  }
  return assertUrl(configured, providerId);
}

function normalizeConfig(input = {}) {
  const provider = normalizeProviderId(input.provider);
  const model = clean(input.model) || DEFAULT_MODEL;
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(model)) {
    throw Object.assign(new Error('Geçersiz AI model adı.'), { code: 'AI_MODEL_INVALID', statusCode: 400 });
  }
  return {
    provider,
    model,
    endpoint: normalizeEndpoint(provider, input.endpoint || input.baseUrl),
    apiKey: clean(input.apiKey),
    profile: clean(input.profile) || profileForModel(model),
    temperature: input.temperature == null ? 0.1 : Math.max(0, Math.min(2, Number(input.temperature) || 0)),
    contextLimit: input.contextLimit == null ? 8192 : Math.max(512, Math.min(131072, Math.round(Number(input.contextLimit) || 8192))),
  };
}

function joinUrl(base, path) { return `${String(base).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`; }

function modelNameFrom(item) {
  return clean(item && (item.name || item.id || item.model));
}

function normalizeModel(item, provider) {
  const value = item && typeof item === 'object' ? item : {};
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.map(clean).filter(Boolean).slice(0, 20)
    : [];
  return {
    name: modelNameFrom(value),
    size: Number.isFinite(Number(value.size)) ? Number(value.size) : null,
    modifiedAt: clean(value.modified_at || value.modifiedAt || value.created_at || value.createdAt) || null,
    provider,
    capabilities,
    details: value.details && typeof value.details === 'object' ? clone(value.details) : null,
  };
}

/* Model adı "aile:etiket" biçimindedir (gemma4:12b). Aile, aynı modelin
   başka boyutuna düşebilmek için ayrılır. */
function modelFamily(name) { return clean(name).split(':')[0].toLowerCase(); }
function hasCapability(model, capability) {
  return Array.isArray(model && model.capabilities) && model.capabilities.includes(capability);
}
/* Kurulu modeller arasından en uygununu seçer. Sıra bilinçli:
   1) tam eşleşme — kullanıcının seçimi her zaman önce gelir
   2) aynı aile — gemma4:12b yoksa gemma4:26b en yakın davranış
   3) önerilen profillerden kurulu olan — bilinen iyi bir varsayılan
   4) araç yeteneği olan ilk model — ajan döngüsü için asgari koşul
   5) kurulu ilk model — hiç değilse bir şey çalışsın
   Hiçbiri yoksa çağıran taraf net bir hata üretebilsin diye null döner. */
/* Modelin yüklenememesi (VRAM/CUDA/bozuk dosya) bir ARAÇ hatası değil,
   o modelin bu makinede kullanılamaz olmasıdır. Mesajlar sağlayıcıdan
   geldiği için desen eşleşmesi zorunlu; liste dar tutulur ki gerçek bir
   çalışma hatası yanlışlıkla "model bozuk" sayılmasın. */
function isModelLoadFailure(error) {
  const message = clean(error && error.message).toLowerCase();
  if (!message) return false;
  return /llama-server process has terminated|failed to initialize the context|cuda error|out of memory|model requires more system memory|unable to load model/.test(message);
}
/* Bir sağlayıcı hatasını Model Health durumuna eşler (bkz. kullanıcı talebi
   §12). Yalnız SINIFLANDIRIR — burada hiçbir yeniden deneme kararı verilmez;
   o karar copilot-agent.js'in fallback zincirine ait. */
function classifyProviderError(error) {
  const status = error && error.details && Number(error.details.providerStatus);
  if (status === 401 || status === 403) return 'auth-error';
  if (status === 429) return 'rate-limited';
  const code = clean(error && error.code);
  if (code === 'AI_TIMEOUT' || code === 'AI_PROVIDER_OFFLINE' || code === 'AI_NO_MODELS' || code === 'AI_MODEL_MISSING') return 'unavailable';
  return 'unavailable';
}
function chooseInstalledModel(wanted, installed, { requireTools = false, exclude = [] } = {}) {
  const blocked = new Set((Array.isArray(exclude) ? exclude : []).map(name => clean(name)));
  const list = (Array.isArray(installed) ? installed : []).filter(item => item && item.name && !blocked.has(item.name));
  if (!list.length) return null;
  const usable = requireTools ? list.filter(item => hasCapability(item, 'tools')) : list;
  const pool = usable.length ? usable : list;
  const target = clean(wanted);
  const exact = pool.find(item => item.name === target || item.name.startsWith(`${target}:`));
  if (exact) return { model: exact, reason: 'exact' };
  const family = modelFamily(target);
  const sameFamily = family && pool.find(item => modelFamily(item.name) === family);
  if (sameFamily) return { model: sameFamily, reason: 'same-family' };
  const recommended = MODEL_PROFILES.map(profile => pool.find(item => item.name === profile.id)).find(Boolean);
  if (recommended) return { model: recommended, reason: 'recommended' };
  const toolCapable = pool.find(item => hasCapability(item, 'tools'));
  if (toolCapable) return { model: toolCapable, reason: 'tool-capable' };
  return { model: pool[0], reason: 'first-installed' };
}
function readErrorMessage(data, fallback) {
  const message = clean(data && data.error && (data.error.message || data.error)) || clean(data && data.message);
  return message || fallback;
}

function createProvider(input = {}, dependencies = {}) {
  const config = normalizeConfig(input);
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('AI sağlayıcı için fetch kullanılamıyor.');
  const definition = PROVIDERS[config.provider];
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey && definition.kind === 'openai-compatible') headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://buyerlog.app';
    headers['X-Title'] = 'Buyer Log Octopus';
  }

  async function request(path, options = {}, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(joinUrl(config.endpoint, path), {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        signal: options.signal || controller.signal,
      });
      return response;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw Object.assign(new Error('AI sağlayıcı zaman aşımına uğradı.'), { code: 'AI_TIMEOUT', statusCode: 504 });
      }
      throw Object.assign(new Error('AI sağlayıcıya bağlanılamadı.'), { code: 'AI_PROVIDER_OFFLINE', statusCode: 503, cause: error });
    } finally { if (timer) clearTimeout(timer); }
  }

  async function jsonRequest(path, body, options = {}) {
    const { timeoutMs, ...requestOptions } = options;
    const response = await request(path, {
      ...requestOptions,
      method: requestOptions.method || (body == null ? 'GET' : 'POST'),
      body: body == null ? undefined : JSON.stringify(body),
    }, timeoutMs == null ? 45000 : Math.max(1, Math.min(300000, Number(timeoutMs) || 45000)));
    // Bir 200 yanıtın gövdesi bozuk JSON olabilir (ör. kesik bir yanıt, ara
    // katman bir hata sayfası döndürdüyse). Bunu sessizce {}'e düşürmek, model
    // listesinin "0 model" olarak yorumlanmasına yol açıyordu — oysa gerçek
    // durum "yanıt okunamadı"ydı. İkisi kullanıcıya FARKLI şey söylemeli.
    let data, parseError = null;
    try { data = await response.json(); }
    catch (error) { parseError = error; data = {}; }
    if (!response.ok) throw Object.assign(new Error(readErrorMessage(data, `AI sağlayıcı HTTP ${response.status}`)), { code: 'AI_PROVIDER_ERROR', statusCode: response.status >= 500 ? 502 : 400, details: { providerStatus: response.status } });
    if (parseError) throw Object.assign(new Error('AI sağlayıcı yanıtı okunamadı (geçersiz JSON).'), { code: 'AI_RESPONSE_UNREADABLE', statusCode: 502, cause: parseError });
    return data;
  }

  /* options.timeoutMs, çağıranın ne kadar sabırlı olduğunu belirtmesine izin
     verir: açılışta otomatik yapılan kısa bir "yaşıyor mu" yoklaması ile
     kullanıcının bilerek tetiklediği "Refresh Models" farklı toleranslar
     ister. Belirtilmezse request()'in kendi varsayılanı (45s) geçerli olur. */
  async function listModels(options = {}) {
    /* OpenRouter'ın /models uç noktası binlerce modeli döndürür; ajan döngüsü
       için kurulu model keşfine gerek yok — bilinen ücretsiz listesi yeterli. */
    if (config.provider === 'openrouter') {
      return OPENROUTER_FREE_MODELS.map(item => ({
        name: item.id, provider: 'openrouter', capabilities: ['completion'],
        size: null, modifiedAt: null, details: null,
      }));
    }
    /* NVIDIA NIM: sabit 5 modelli katalog, gerçek zamanlı keşfe gerek yok.
       Deprecated alias (eski deepseek-v4-flash) BİLEREK dışlanır — burası
       "kurulu/seçilebilir" listesidir, seçilemeyen bir modelin burada
       görünmesi chooseInstalledModel'i yanlışlıkla onu seçebilir hâle
       getirirdi (bkz. ai-model-registry.js). */
    if (config.provider === 'nvidia') {
      return modelRegistry.listNvidiaModels({ includeDeprecated: false }).map(item => ({
        name: item.modelId, provider: 'nvidia',
        capabilities: ['completion',
          ...(item.toolCalling ? ['tools'] : []),
          ...(item.vision ? ['vision'] : []),
          ...(item.reasoning ? ['thinking'] : [])],
        size: null, modifiedAt: null, details: null,
      }));
    }
    const data = definition.kind === 'ollama'
      ? await jsonRequest('/api/tags', undefined, options)
      : await jsonRequest('/models', undefined, options);
    // Kaynak, colon/tag içeren model adlarını (ör. "gemma4:12b", "qwen3:8b")
    // OLDUĞU GİBİ taşır — burada hiçbir isim ayrıştırması/filtrelemesi yok.
    const rawList = definition.kind === 'ollama' ? (data && data.models) : (data && (data.data || data.models));
    // Dizi BEKLENİR ama gelmeyebilir (Ollama sürümü/uç nokta değişmiş, ara
    // katman farklı bir gövde döndürmüş). Bunu sessizce [] saymak "bağlandım
    // ama hiç model yok" ile "yanıtı hiç anlayamadım" durumlarını
    // birbirinden ayırt edilemez kılıyordu. Gerçekten boş bir dizi ([])
    // GEÇERLİ bir "kurulu model yok" cevabıdır ve burada hata SAYILMAZ.
    if (!Array.isArray(rawList)) {
      throw Object.assign(new Error('AI sağlayıcı model listesi beklenmeyen bir biçimde döndü.'),
        { code: 'AI_RESPONSE_UNREADABLE', statusCode: 502, details: { shapeKeys: data && typeof data === 'object' ? Object.keys(data) : [] } });
    }
    return rawList.map(item => normalizeModel(item, config.provider)).filter(item => item.name);
  }

  async function showModel(model = config.model) {
    const wanted = clean(model);
    if (!wanted) throw Object.assign(new Error('Model adı zorunludur.'), { code: 'AI_MODEL_REQUIRED', statusCode: 400 });
    if (definition.kind !== 'ollama') {
      const models = await listModels();
      return models.find(item => item.name === wanted) || modelProfile(wanted);
    }
    const data = await jsonRequest('/api/show', { model: wanted });
    const mapped = normalizeModel({ ...data, name: wanted, details: data.details, capabilities: data.capabilities }, config.provider);
    return { ...mapped, details: data.details || null, capabilities: Array.isArray(data.capabilities) ? data.capabilities : mapped.capabilities };
  }

  /* NVIDIA modelleri arasında reasoning/structured-output desteği farklıdır
     (bkz. ai-model-registry.js). Sabit tek bir parametre setini TÜM
     modellere göndermek, desteklemeyen modelde isteği kırar (kullanıcı
     talebi §6) — bu yüzden ek gövde alanları yalnız o modelin registry
     kaydına göre eklenir/çıkarılır. */
  function nvidiaChatExtras(chatOptions) {
    if (config.provider !== 'nvidia') return { extra: {}, dropResponseFormat: false };
    const model = modelRegistry.getNvidiaModel(config.model);
    if (!model) return { extra: {}, dropResponseFormat: false };
    const extra = { ...(model.requestOptions || {}) };
    const requestedEffort = clean(chatOptions && chatOptions.reasoningEffort);
    if (requestedEffort && model.reasoningParam && Array.isArray(model.reasoningLevels) && model.reasoningLevels.includes(requestedEffort)) {
      extra[model.reasoningParam] = requestedEffort;
    }
    return { extra, dropResponseFormat: model.structuredOutput === false };
  }

  /* chat() ve chatStream() AYNI gövdeyi kurar, yalnız `stream` bayrağı
     farklıdır — akış desteği eklerken tek bir yerde büttükçe iki yol
     ayrışıp biri bozulmadan diğeri güncellenebilirdi (bkz. num_predict
     hatası: iki ayrı gövde kurma yeri aynı hatayı iki kez taşıyordu).
     `tools` verildiğinde (native tool-calling — bkz. §5) format/
     response_format GÖNDERİLMEZ: ikisi birlikte bazı sağlayıcılarda
     çakışıyor ve zaten native modda JSON zarfına gerek yok — model
     ya düz metin ya da tool_calls döner. */
  function buildChatBody(messages, options, stream) {
    const list = Array.isArray(messages) ? messages.slice(0, 80) : [];
    const { extra: nvidiaExtra, dropResponseFormat } = nvidiaChatExtras(options);
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    const responseFormat = (dropResponseFormat || hasTools) ? undefined : options.responseFormat;
    const toolsField = hasTools ? { tools: options.tools } : {};
    return definition.kind === 'ollama'
      ? { model: config.model, stream, messages: list, options: { temperature: config.temperature, num_ctx: config.contextLimit, ...(options.options || {}) }, ...(hasTools ? {} : (options.format ? { format: options.format } : {})), ...(options.think === false ? { think: false } : {}), ...toolsField }
      : { model: config.model, stream, messages: list, temperature: config.temperature, ...(options.options || {}), ...(responseFormat ? { response_format: responseFormat } : {}), ...nvidiaExtra, ...toolsField };
  }

  /* OpenAI-uyumlu `function.arguments` her zaman bir JSON STRING'dir;
     Ollama'nınki zaten ayrıştırılmış bir NESNEdir. Çağıran (copilot-agent.js)
     ikisini de aynı şekilde (nesne) almalı — sağlayıcı farkı burada biter. */
  function parseToolArgs(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
    return {};
  }
  function normalizeToolCalls(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(tc => ({
      id: clean(tc && tc.id) || undefined,
      name: clean(tc && tc.function && tc.function.name),
      args: parseToolArgs(tc && tc.function && tc.function.arguments),
    })).filter(tc => tc.name);
  }

  async function chat(messages, options = {}) {
    const body = buildChatBody(messages, options, false);
    const data = await jsonRequest(definition.kind === 'ollama' ? '/api/chat' : '/chat/completions', body, { timeoutMs: options.timeoutMs });
    const message = definition.kind === 'ollama' ? (data && data.message) : (data && data.choices && data.choices[0] && data.choices[0].message);
    const content = clean(message && message.content);
    const toolCalls = normalizeToolCalls(message && message.tool_calls);
    return { content, toolCalls, model: clean(data && data.model) || config.model, usage: data && data.usage ? clone(data.usage) : null };
  }

  /* Ollama'nın akış gövdesi NDJSON'dur (satır başına bir JSON nesnesi,
     `message.content` bir sonraki PARÇAdır — birikmiş tam metin değil).
     OpenAI-uyumlu (LM Studio/Custom/OpenRouter/NVIDIA) SSE kullanır:
     `data: {...}\n\n` satırları, delta `choices[0].delta.content`, akış
     `data: [DONE]\n\n` ile biter. onDelta yalnız YENİ parçayı alır; çağıran
     kendi birikimini tutar (bkz. copilot-agent.js'teki kademeli JSON
     ayrıştırıcı — o da yalnız yeni karakterleri işler). */
  async function chatStream(messages, options = {}, onDelta) {
    const body = buildChatBody(messages, options, true);
    const path = definition.kind === 'ollama' ? '/api/chat' : '/chat/completions';
    const timeoutMs = options.timeoutMs == null ? 45000 : Math.max(1, Math.min(300000, Number(options.timeoutMs) || 45000));
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(joinUrl(config.endpoint, path), {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (error && error.name === 'AbortError') throw Object.assign(new Error('AI sağlayıcı zaman aşımına uğradı.'), { code: 'AI_TIMEOUT', statusCode: 504 });
      throw Object.assign(new Error('AI sağlayıcıya bağlanılamadı.'), { code: 'AI_PROVIDER_OFFLINE', statusCode: 503, cause: error });
    }
    if (!response.ok) {
      if (timer) clearTimeout(timer);
      let data = {};
      try { data = await response.json(); } catch (_) { /* gövde JSON değilse genel mesaj kullanılır */ }
      throw Object.assign(new Error(readErrorMessage(data, `AI sağlayıcı HTTP ${response.status}`)), { code: 'AI_PROVIDER_ERROR', statusCode: response.status >= 500 ? 502 : 400, details: { providerStatus: response.status } });
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      if (timer) clearTimeout(timer);
      // Sağlayıcı akışı desteklemiyor gibi davrandıysa (gövde yok): çağıran
      // sessizce boş bir cevaba düşmesin, açık bir hata alsın.
      throw Object.assign(new Error('AI sağlayıcı akış gövdesi döndürmedi.'), { code: 'AI_STREAM_UNSUPPORTED', statusCode: 502 });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', full = '', model = config.model, usage = null;
    /* tool_calls parça parça gelir: her delta yalnız bir alanı (id, isim
       parçası, argüman parçası) taşıyabilir, `index`e göre birleştirilir.
       Görünür metin (delta.content) genelde BOŞTUR bir tool_calls turunda —
       onDelta bu yüzden zaten "güvenle sessiz" kalır, ayrı bir ayrım
       gerekmez (bkz. copilot-agent.js: content yoksa hiçbir şey akmaz). */
    const toolCallAcc = [];
    function mergeStreamedToolCalls(deltaCalls) {
      if (!Array.isArray(deltaCalls)) return;
      for (const part of deltaCalls) {
        const idx = Number.isInteger(part && part.index) ? part.index : toolCallAcc.length;
        if (!toolCallAcc[idx]) toolCallAcc[idx] = { id: '', name: '', args: '' };
        const slot = toolCallAcc[idx];
        if (part && part.id) slot.id = part.id;
        if (part && part.function) {
          if (part.function.name) slot.name += part.function.name;
          if (part.function.arguments) slot.args += part.function.arguments;
        }
      }
    }
    function handleLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (definition.kind === 'ollama') {
        let obj; try { obj = JSON.parse(trimmed); } catch (_) { return; }
        const piece = clean(obj && obj.message && obj.message.content);
        if (piece) { full += piece; if (typeof onDelta === 'function') onDelta(piece); }
        /* Ollama tool_calls'ı parça parça değil, TEK seferde (grammar-
           kısıtlı üretim) döndürür — delta birleştirmeye gerek yok. */
        if (obj && obj.message && Array.isArray(obj.message.tool_calls)) {
          obj.message.tool_calls.forEach((tc, i) => { toolCallAcc[i] = { id: clean(tc.id), name: clean(tc.function && tc.function.name), args: JSON.stringify(parseToolArgs(tc.function && tc.function.arguments)) }; });
        }
        if (obj && obj.model) model = clean(obj.model) || model;
        if (obj && obj.done && obj.eval_count != null) usage = { completion_tokens: obj.eval_count, prompt_tokens: obj.prompt_eval_count || 0, total_tokens: (obj.eval_count || 0) + (obj.prompt_eval_count || 0) };
        return;
      }
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      let obj; try { obj = JSON.parse(payload); } catch (_) { return; }
      const delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
      const piece = clean(delta && delta.content);
      if (piece) { full += piece; if (typeof onDelta === 'function') onDelta(piece); }
      if (delta && delta.tool_calls) mergeStreamedToolCalls(delta.tool_calls);
      if (obj && obj.model) model = clean(obj.model) || model;
      if (obj && obj.usage) usage = clone(obj.usage);
    }
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) handleLine(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer);
    } catch (error) {
      if (error && error.name === 'AbortError') throw Object.assign(new Error('AI sağlayıcı zaman aşımına uğradı.'), { code: 'AI_TIMEOUT', statusCode: 504 });
      throw Object.assign(new Error('AI sağlayıcı akışı okunamadı.'), { code: 'AI_STREAM_READ_FAILED', statusCode: 502, cause: error });
    } finally { if (timer) clearTimeout(timer); }
    const toolCalls = toolCallAcc.filter(Boolean).map(slot => ({ id: slot.id || undefined, name: slot.name, args: parseToolArgs(slot.args) })).filter(tc => tc.name);
    return { content: clean(full), toolCalls, model, usage };
  }

  let resolvedCache = null;
  /* Yapılandırılan modeli kurulu olanlara göre çözer.
     requireTools: ajan döngüsü native tool calling kullandığı için, araç
     yeteneği olmayan bir model seçilirse bunu SÖYLEMELİ — sessizce
     çalışmayan bir ajan en kötü sonuçtur. */
  async function resolveModel(options = {}) {
    const { requireTools = false, refresh = false, exclude = [], ...requestOptions } = options;
    if (resolvedCache && !refresh && !(exclude && exclude.length)) return clone(resolvedCache);
    const installed = await listModels(requestOptions);
    if (!installed.length) {
      throw Object.assign(new Error(`${definition.label} çalışıyor ama hiç model kurulu değil. Önce bir model indirin (ör. ${DEFAULT_MODEL}).`),
        { code: 'AI_NO_MODELS', statusCode: 503, details: { provider: config.provider } });
    }
    const chosen = chooseInstalledModel(config.model, installed, { requireTools, exclude });
    if (!chosen) {
      throw Object.assign(new Error(`Seçili model kurulu değil: ${config.model}. Kurulu modeller: ${installed.map(item => item.name).join(', ')}.`),
        { code: 'AI_MODEL_MISSING', statusCode: 404, details: { model: config.model, installed: installed.map(item => item.name) } });
    }
    const supportsTools = hasCapability(chosen.model, 'tools');
    resolvedCache = {
      model: chosen.model.name,
      requested: config.model,
      matched: chosen.reason === 'exact',
      reason: chosen.reason,
      supportsTools,
      capabilities: chosen.model.capabilities || [],
      installed: installed.map(item => item.name),
      // Kullanıcı neden başka bir model çalıştığını görebilmeli.
      notice: chosen.reason === 'exact' ? null
        : `Seçili model "${config.model}" kurulu değil; "${chosen.model.name}" kullanılıyor.`,
      toolNotice: supportsTools ? null
        : `"${chosen.model.name}" araç çağrısını (tools) desteklemiyor; ajan yalnız metin üretebilir.`,
    };
    return clone(resolvedCache);
  }
  async function testConnection(options = {}) {
    /* OpenRouter için model listesi yerine doğrudan çıkarım testi:
       listeyi çekmek binlerce satır döndürür ve seçili modelin erişilebilir
       olduğunu garantilemez — küçük bir çıkarım isteği ikisini de doğrular. */
    if (config.provider === 'openrouter') {
      const inference = await chat([{ role: 'user', content: 'Reply with: OK' }],
        { options: { max_tokens: 8, num_predict: 8 } });
      return { ok: true, provider: config.provider, model: config.model,
        inference: Boolean(inference.content), models: [] };
    }
    /* NVIDIA NIM: sabit katalog karşısında model doğrulaması ucuz; asıl
       maliyet çıkarım isteğinde. Gecikme burada ölçülür ki Settings'teki
       "Test Connection" sonucu kullanıcıya gerçek bir sayı gösterebilsin
       (bkz. kullanıcı talebi §11). */
    if (config.provider === 'nvidia') {
      const known = modelRegistry.getNvidiaModel(config.model);
      if (!known) throw Object.assign(new Error(`NVIDIA NIM için bilinmeyen model: ${config.model}`), { code: 'AI_MODEL_MISSING', statusCode: 404, details: { model: config.model } });
      const startedAt = Date.now();
      /* Reasoning modelleri (DeepSeek V4 Flash, Kimi K3) küçük bir
         max_tokens bütçesini TAMAMEN görünmeyen "reasoning" içeriğine
         harcayıp gözle görülür cevap için hiç pay bırakmayabiliyor —
         gerçek ölçümde bu durum content:"" + 20-70 saniyelik gecikme olarak
         görüldü. Bütçe biraz büyütülür ki reasoning'den arta kalan bir şey
         olsun; ayrıca bu modeller 45 sn'lik genel varsayılanı aşabiliyor. */
      const reasoningModel = known.reasoning === true;
      const inference = await chat([{ role: 'user', content: 'Reply with: OK' }],
        { options: { max_tokens: reasoningModel ? 64 : 8 }, timeoutMs: reasoningModel ? 90000 : undefined });
      return { ok: true, provider: config.provider, model: config.model,
        inference: Boolean(inference.content), latencyMs: Date.now() - startedAt, models: [] };
    }
    const models = await listModels();
    const selected = models.find(item => item.name === config.model || item.name.startsWith(`${config.model}:`));
    if (!selected) throw Object.assign(new Error(`Seçili model bulunamadı: ${config.model}`), { code: 'AI_MODEL_MISSING', statusCode: 404, details: { model: config.model, models: models.map(item => item.name) } });
    let inference = null;
    if (options.inference !== false) inference = await chat([{ role: 'user', content: 'Reply with OK.' }], { options: { max_tokens: 8, num_predict: 8 } });
    return { ok: true, provider: config.provider, model: selected.name, models, inference: inference ? Boolean(inference.content) : null };
  }

  async function pullModel(model = config.model, onProgress = null) {
    const wanted = clean(model);
    if (!wanted) throw Object.assign(new Error('İndirilecek model adı zorunludur.'), { code: 'AI_MODEL_REQUIRED', statusCode: 400 });
    if (definition.kind !== 'ollama') throw Object.assign(new Error('Bu sağlayıcı model indirme işlemini Buyer Log üzerinden desteklemiyor.'), { code: 'AI_PULL_UNSUPPORTED', statusCode: 400 });
    const response = await request('/api/pull', { method: 'POST', body: JSON.stringify({ model: wanted, stream: true }) }, 0);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(readErrorMessage(data, `Model indirme başarısız (${response.status}).`)), { code: 'AI_PULL_FAILED', statusCode: 502 });
    }
    let last = { model: wanted, status: 'starting', completed: 0, total: 0, percent: 0 };
    const emit = item => {
      const completed = Number(item.completed) || 0, total = Number(item.total) || 0;
      last = { model: wanted, status: clean(item.status) || 'downloading', completed, total, percent: total > 0 ? Math.max(0, Math.min(100, Math.round(completed / total * 100))) : null, digest: clean(item.digest) || null };
      if (typeof onProgress === 'function') onProgress(clone(last));
    };
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) { if (!line.trim()) continue; try { emit(JSON.parse(line)); } catch (_) {} }
      }
      buffer += decoder.decode();
      if (buffer.trim()) { try { emit(JSON.parse(buffer)); } catch (_) {} }
    } else {
      const data = await response.json().catch(() => ({}));
      if (data && typeof data === 'object') emit(data);
    }
    if (last.status !== 'success') last.status = 'success';
    return { ok: true, provider: config.provider, ...last };
  }

  async function removeModel(model = config.model) {
    const wanted = clean(model);
    if (!wanted) throw Object.assign(new Error('Silinecek model adı zorunludur.'), { code: 'AI_MODEL_REQUIRED', statusCode: 400 });
    if (definition.kind !== 'ollama') throw Object.assign(new Error('Bu sağlayıcı model silme işlemini Buyer Log üzerinden desteklemiyor.'), { code: 'AI_DELETE_UNSUPPORTED', statusCode: 400 });
    await jsonRequest('/api/delete', { model: wanted }, { method: 'DELETE' });
    return { ok: true, provider: config.provider, model: wanted };
  }

  return Object.freeze({
    config: Object.freeze(clone(config)),
    definition,
    listModels,
    showModel,
    resolveModel,
    isModelLoadFailure,
    chat,
    chatStream,
    testConnection,
    pullModel,
    updateModel: pullModel,
    removeModel,
  });
}

module.exports = {
  DEFAULT_MODEL,
  PROVIDERS,
  MODEL_PROFILES,
  OPENROUTER_FREE_MODELS,
  providerIds,
  defaultModel,
  recommendedModels,
  openrouterFreeModels,
  nvidiaModels,
  normalizeProviderId,
  normalizeEndpoint,
  normalizeConfig,
  chooseInstalledModel,
  isModelLoadFailure,
  classifyProviderError,
  modelFamily,
  profileForModel,
  modelProfile,
  createProvider,
};
