'use strict';

/* Global Flow · Earth 3D sağlayıcı ayarları.
 *
 * Earth görünümü yerel CesiumJS ile çalışır. Varsayılan sağlayıcı ücretsizdir:
 * NASA GIBS Blue Marble / shaded-relief görüntüleri API anahtarı ve
 * faturalandırma olmadan kullanılabilir; "Çevrimdışı küre" de her zaman
 * kullanılabilir. Google Map Tiles API (Photorealistic 3D, uydu, arazi)
 * yalnız Moderatör özellikle seçip anahtar tanımlarsa açılır.
 *
 * Anahtar diskte AES-256-GCM ile şifreli durur ve ayar yanıtlarında yalnız
 * maskeli görünür. Ancak tile istekleri Chromium'dan doğrudan Google'a gittiği
 * için anahtar Earth açıldığında istemci belleğine iner: bu bir "sır" değil,
 * kısıtlanmış bir kullanım anahtarıdır. Gerçek koruma Google Cloud tarafında
 * anahtarın yalnız Map Tiles API ile sınırlanması ve kota/bütçe sınırıdır.
 * Anahtar hiçbir zaman kullanıcı tercihlerine, loglara veya kaynağa yazılmaz. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson, atomicWriteBuffer } = require('../user-data');

const SETTINGS_FILE = path.join(SERVER_DATA_ROOT, 'global-flow-earth-settings.json');
const SECRET_FILE = path.join(SERVER_DATA_ROOT, '.global-flow-earth-secret');
const SCHEMA_VERSION = 2;
const PROVIDERS = Object.freeze(['free', 'google', 'offline']);
const VIEW_MODES = Object.freeze(['nasa-blue-marble', 'nasa-relief', 'photorealistic', 'satellite', 'terrain', 'offline']);
const KEY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

function clean(value) { return String(value == null ? '' : value).trim(); }
function envKey() { return clean(process.env.BUYER_LOG_GOOGLE_MAPS_API_KEY); }
function defaultSettings() {
  return { schemaVersion: SCHEMA_VERSION, enabled: true, provider: 'free', defaultMode: 'nasa-relief', encryptedApiKey: null, updatedAt: null, updatedBy: '' };
}
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    const base = defaultSettings();
    return {
      ...base,
      enabled: raw.enabled !== false,
      provider: PROVIDERS.includes(raw.provider) ? raw.provider : base.provider,
      defaultMode: VIEW_MODES.includes(raw.defaultMode) ? raw.defaultMode : base.defaultMode,
      encryptedApiKey: raw.encryptedApiKey && typeof raw.encryptedApiKey === 'object' ? raw.encryptedApiKey : null,
      updatedAt: raw.updatedAt || null,
      updatedBy: clean(raw.updatedBy)
    };
  } catch (_) { return defaultSettings(); }
}
function secretKey() {
  fs.mkdirSync(SERVER_DATA_ROOT, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    const buf = fs.readFileSync(SECRET_FILE);
    if (buf.length === 32) return buf;
  }
  const buf = crypto.randomBytes(32);
  atomicWriteBuffer(SECRET_FILE, buf);
  try { fs.chmodSync(SECRET_FILE, 0o600); } catch (_) {}
  return buf;
}
function encryptKey(value) {
  const text = clean(value); if (!text) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]), tag = cipher.getAuthTag();
  return { v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') };
}
function decryptKey(payload) {
  if (!payload || payload.alg !== 'aes-256-gcm') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return clean(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch (_) { return ''; }
}
function maskKey(value) {
  const key = clean(value); if (!key) return '';
  return key.length <= 8 ? '••••••••' : '••••••••' + key.slice(-4);
}
function resolvedKey(settings = loadSettings()) {
  const fromEnv = envKey();
  if (fromEnv) return { key: fromEnv, source: 'env' };
  const stored = decryptKey(settings.encryptedApiKey);
  return stored ? { key: stored, source: 'settings' } : { key: '', source: '' };
}
/* Ayar ekranı için: anahtarın kendisi asla dönmez. */
function publicStatus(options = {}) {
  const settings = loadSettings(), { key, source } = resolvedKey(settings), canConfigure = Boolean(options.canConfigure);
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    defaultMode: settings.defaultMode,
    configured: settings.provider === 'free' || (settings.provider === 'google' && Boolean(key)),
    keySource: source,
    maskedKey: canConfigure ? maskKey(key) : '',
    canConfigure,
    updatedAt: settings.updatedAt
  };
}
/* Earth renderer başlatılırken istenir; anahtar yalnız bu no-store yanıtla ve
   yalnız Google sağlayıcısı etkinken iner. */
function runtimeConfig() {
  const settings = loadSettings(), { key } = resolvedKey(settings);
  if (!settings.enabled || settings.provider === 'offline') {
    return { enabled: settings.enabled, provider: 'offline', defaultMode: 'offline', googleKey: '' };
  }
  if (settings.provider === 'google' && Boolean(key)) {
    const mode = ['photorealistic', 'satellite', 'terrain'].includes(settings.defaultMode) ? settings.defaultMode : 'photorealistic';
    return { enabled: true, provider: 'google', defaultMode: mode, googleKey: key };
  }
  /* Eski kurulumlarda provider=google kalmış ama anahtar hiç girilmemiş
     olabilir. Ücretli anahtar istemek yerine ücretsiz NASA görünümüne düş. */
  const freeMode = ['nasa-blue-marble', 'nasa-relief'].includes(settings.defaultMode) ? settings.defaultMode : 'nasa-relief';
  return { enabled: true, provider: 'free', defaultMode: freeMode, googleKey: '' };
}
function saveSettings(patch = {}, actor = '') {
  const current = loadSettings(), next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) next.enabled = patch.enabled !== false;
  if (Object.prototype.hasOwnProperty.call(patch, 'provider')) {
    if (!PROVIDERS.includes(patch.provider)) throw Object.assign(new Error('Geçersiz Earth sağlayıcısı.'), { statusCode: 400, code: 'EARTH_PROVIDER_INVALID' });
    next.provider = patch.provider;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'defaultMode')) {
    if (!VIEW_MODES.includes(patch.defaultMode)) throw Object.assign(new Error('Geçersiz Earth görünüm modu.'), { statusCode: 400, code: 'EARTH_MODE_INVALID' });
    next.defaultMode = patch.defaultMode;
  }
  if (patch.clearApiKey === true) next.encryptedApiKey = null;
  else if (Object.prototype.hasOwnProperty.call(patch, 'apiKey') && clean(patch.apiKey)) {
    const key = clean(patch.apiKey);
    if (!KEY_PATTERN.test(key)) throw Object.assign(new Error('API anahtarı biçimi geçersiz.'), { statusCode: 400, code: 'EARTH_KEY_INVALID' });
    next.encryptedApiKey = encryptKey(key);
  }
  next.schemaVersion = SCHEMA_VERSION;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = clean(actor).slice(0, 120);
  fs.mkdirSync(SERVER_DATA_ROOT, { recursive: true });
  atomicWriteJson(SETTINGS_FILE, next);
  return next;
}

module.exports = { SETTINGS_FILE, PROVIDERS, VIEW_MODES, KEY_PATTERN, loadSettings, saveSettings, publicStatus, runtimeConfig, maskKey };
