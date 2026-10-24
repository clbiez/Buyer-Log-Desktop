'use strict';

/*
 * Yedek paketlerinden ASLA çıkmaması gereken kimlik/sır materyali için tek
 * kaynak. Hem yeni ZIP yedek servisi (backup-service.js) hem de eski
 * .blgbackup zinciri (user-data.js) aynı tanımı kullanır; böylece bir yol
 * filtrelenirken diğerinin aynı dosyayı dışarı taşıması mümkün olmaz.
 *
 * Kapsam: kullanıcı hesap/şifre hash deposu, audit kayıtları, oturum sırları,
 * AI/database/browser kimlik bilgileri ve bunları çözen anahtar dosyaları,
 * tarayıcı profilleri, sertifika/özel anahtar dosyaları ve .env dosyaları.
 * Bu modül bağımlılıksızdır (user-data.js ile döngüsel require oluşmaz).
 */

const SENSITIVE_KEY = /(?:password|passwd|pinHash|secret|token|session|cookie|credential|clientSecret|privateKey|apiKey|api_key|loginFailures?|lockUntil)/i;
const SENSITIVE_FILE = /(?:password|secret|token|session|cookie|credential|agent-ai-settings|agent-browser-settings|browser-debug-settings|browser-profiles|sync-settings|user-audit)/i;
const SENSITIVE_DIR = /^(?:auth|sessions?)$/i;
const SENSITIVE_EXT = /\.(?:pem|key|pfx|p12)$/i;

function normalizeRel(rel) { return String(rel || '').replace(/\\/g, '/'); }

// Kurulumun etkin çekirdeği ve tekrar oynatma kaydı iş verisi değildir.
// Eski yedekler de bu makinenin güncelleme denemesini/sırasını değiştiremez.
function isUpdaterControlPath(rel) { return /^updater(?:\/|$)/i.test(normalizeRel(rel)); }

// Kimlik/sır materyali mi? (önbellek/geçici dosya ayıklaması burada YAPILMAZ.)
function isSensitiveBackupPath(rel) {
  const normalized = normalizeRel(rel);
  if (!normalized) return false;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.slice(0, -1).some(part => SENSITIVE_DIR.test(part))) return true;
  if (/(?:^|\/)\.env(?:\.|$)/i.test(normalized) || SENSITIVE_EXT.test(normalized)) return true;
  if (/(?:^|\/)user-access\.json(?:\.bak)?$/i.test(normalized)) return true;
  return SENSITIVE_FILE.test(normalized);
}

function sanitizeSensitiveValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeSensitiveValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) if (!SENSITIVE_KEY.test(key)) out[key] = sanitizeSensitiveValue(item);
  return out;
}

module.exports = { SENSITIVE_KEY, SENSITIVE_FILE, isSensitiveBackupPath, isUpdaterControlPath, sanitizeSensitiveValue };
