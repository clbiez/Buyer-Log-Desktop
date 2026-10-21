'use strict';

/*
 * LCW AI — TEK MERKEZİ AYAR NOKTASI.
 *
 * Model, reasoning seviyesi, uç noktalar, dosya sınırları ve zaman aşımları
 * yalnız burada durur; modüller (Hesaplanan Sütun, Kurallar, Otomasyon ve
 * ileride eklenecekler) bu değerleri ASLA kendi içinde yazmaz.
 *
 * Güvenlik notu: bu dosya sır içermez. Access/refresh token, parola veya
 * çerez burada (ya da config.json'da) tutulmaz. Token yalnız süreç belleğinde
 * yaşar (lcwai-auth.js).
 *
 * Ad alanı bilinçli olarak "lcwai"dir: retired-ai-cleanup.js kaldırılan eski
 * AI katmanının config.json'daki ai* anahtarlarını açılışta siler.
 */

const WEB_ORIGIN = 'https://lcwai.lcwaikiki.com';
const WEB_HOST = 'lcwai.lcwaikiki.com';
const API_ORIGIN = 'https://mym.prod.lcwaikiki.com';
const API_HOST = 'mym.prod.lcwaikiki.com';
const API_BASE = `${API_ORIGIN}/lcw/gpt/api`;

const ENDPOINTS = Object.freeze({
  messages: `${API_BASE}/chat/messages`,
  upload: `${API_BASE}/chat/files/upload`,
});

/* Keycloak kimliği. Buyer Log Keycloak'a İSTEK ATMAZ (login akışını taklit
   etmez); bu değerler yalnız tarayıcıdan okunan access token'ın gerçekten
   LCW AI istemcisine ait olduğunu doğrulamak için kullanılır. */
const KEYCLOAK = Object.freeze({
  issuer: 'https://keycloak.lcwaikiki.com/auth/realms/prod',
  clientId: 'lcwai-prod',
});

/* Model kataloğu. İlk kayıt varsayılandır. İleride LCW AI'ın model listesi
   uç noktası doğrulandığında `modelsEndpoint` doldurulup liste dinamik
   okunabilir; doğrulanmamış bir uç noktaya istek atılmaz. */
const MODELS = Object.freeze([
  Object.freeze({ key: 'gpt-6-sol', label: 'GPT-6 Sol', vision: true }),
]);
const DEFAULT_MODEL = MODELS[0].key;
const REASONING_LEVELS = Object.freeze(['Low', 'Medium', 'High']);
const DEFAULT_REASONING_LEVEL = 'Medium';
const SOURCE_DEFAULTS = Object.freeze({
  'test-report-assess': Object.freeze({ reasoningLevel: 'High' }),
});

const DEFAULTS = Object.freeze({
  modelKey: DEFAULT_MODEL,
  reasoningEnabled: true,
  reasoningLevel: DEFAULT_REASONING_LEVEL,
  webSearchEnabled: false,
  imageGenerationEnabled: false,
  /* Her Buyer Log çağrısı LCW AI geçmişinde bir sohbet oluşturur; başlık
     üretimi kapalıdır ki kullanıcının geçmişi ek başlık çağrılarıyla dolmasın. */
  generateTitle: false,
});

const LIMITS = Object.freeze({
  maxTaskChars: 4000,
  maxPromptChars: 60000,
  maxContextStringChars: 2000,
  maxContextArrayItems: 400,
  maxContextDepth: 5,
  maxResponseChars: 200000,
  maxFileBytes: 20 * 1024 * 1024,
  maxFilesPerRequest: 5,
  maxConcurrentPerOwner: 2,
});

const ALLOWED_UPLOAD_TYPES = Object.freeze([
  'text/plain', 'text/csv', 'text/markdown', 'application/json', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

const TIMEOUTS = Object.freeze({
  // İlk bayt/ilk chunk gelene kadar (reasoning süresi dahil).
  firstChunkMs: 120000,
  // İki chunk arası sessizlik: akış yarıda kaldıysa bu kadar beklenir.
  idleMs: 90000,
  // Tek isteğin üst sınırı.
  totalMs: 300000,
  uploadMs: 120000,
  // Token bitimine bu kadar kala yenilenmiş sayılmaz (saat kayması + ağ).
  tokenSkewMs: 30000,
  // Giriş ekranında kullanıcının kurumsal girişi tamamlaması için süre.
  loginMs: 5 * 60 * 1000,
  // Sessiz yenilemede sekmenin yeni token üretmesi için beklenen süre.
  silentRefreshMs: 15000,
});

function modelInfo(key) {
  const wanted = String(key || '').trim();
  return MODELS.find(item => item.key === wanted) || null;
}
function resolveModelKey(key) {
  return modelInfo(key) ? String(key).trim() : DEFAULT_MODEL;
}
function resolveReasoningLevel(level) {
  const wanted = String(level || '').trim().toLowerCase();
  return REASONING_LEVELS.find(item => item.toLowerCase() === wanted) || DEFAULT_REASONING_LEVEL;
}
function publicConfig() {
  return {
    defaultModel: DEFAULT_MODEL,
    defaultModelLabel: modelInfo(DEFAULT_MODEL).label,
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    models: MODELS.map(item => ({ key: item.key, label: item.label })),
    limits: { maxFileBytes: LIMITS.maxFileBytes, maxFilesPerRequest: LIMITS.maxFilesPerRequest, maxTaskChars: LIMITS.maxTaskChars },
    allowedUploadTypes: ALLOWED_UPLOAD_TYPES.slice(),
    webOrigin: WEB_ORIGIN,
  };
}

module.exports = {
  WEB_ORIGIN, WEB_HOST, API_ORIGIN, API_HOST, API_BASE, ENDPOINTS, KEYCLOAK,
  MODELS, DEFAULT_MODEL, REASONING_LEVELS, DEFAULT_REASONING_LEVEL, SOURCE_DEFAULTS, DEFAULTS,
  LIMITS, ALLOWED_UPLOAD_TYPES, TIMEOUTS,
  modelInfo, resolveModelKey, resolveReasoningLevel, publicConfig,
};
