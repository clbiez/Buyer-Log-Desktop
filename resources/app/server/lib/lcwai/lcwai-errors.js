'use strict';

/*
 * LCW AI hata sözlüğü. Kullanıcı HİÇBİR ZAMAN ham exception, HTTP gövdesi,
 * stack ya da başlık görmez: her hata bir koda indirgenir, metin TR/EN
 * sözlükten gelir. Teknik ayrıntı yalnız `details` içinde, sırlardan
 * arındırılmış ve kısa tutulur.
 */
const { redactSecrets } = require('../../../shared/secret-redaction');

const CODES = Object.freeze({
  AUTH_REQUIRED: { status: 409, tr: 'LCW AI oturumu açık değil. Kullanıcı menüsünden LCW AI girişini yapın.', en: 'You are not signed in to LCW AI. Sign in from the user menu.', action: 'login' },
  SESSION_EXPIRED: { status: 409, tr: 'LCW AI oturumunuz yenilenmeli.', en: 'Your LCW AI session needs to be renewed.', action: 'login' },
  BROWSER_UNAVAILABLE: { status: 409, tr: 'LCW AI oturumuna ulaşılamadı. Tarayıcı bağlantısını kontrol edin.', en: 'The LCW AI session could not be reached. Check the browser connection.', action: 'login' },
  LOGIN_IN_PROGRESS: { status: 409, tr: 'LCW AI girişi zaten sürüyor. Açılan tarayıcı sekmesinde girişi tamamlayın.', en: 'LCW AI sign-in is already in progress. Complete it in the opened browser tab.' },
  LOGIN_TIMEOUT: { status: 408, tr: 'LCW AI girişi tamamlanmadı. Tarayıcıdaki girişi bitirip tekrar deneyin.', en: 'LCW AI sign-in was not completed. Finish signing in in the browser and try again.', action: 'login' },
  FORBIDDEN: { status: 403, tr: 'LCW AI bu işlem için yetki vermedi. Hesabınızın LCW AI erişimini kontrol edin.', en: 'LCW AI did not authorise this request. Check your account’s LCW AI access.' },
  RATE_LIMITED: { status: 429, tr: 'LCW AI şu an çok fazla istek alıyor. Biraz bekleyip tekrar deneyin.', en: 'LCW AI is receiving too many requests. Wait a moment and try again.', retryable: true },
  TIMEOUT: { status: 504, tr: 'LCW AI zamanında yanıt vermedi. Tekrar deneyin.', en: 'LCW AI did not respond in time. Try again.', retryable: true },
  NETWORK: { status: 502, tr: 'LCW AI’a ulaşılamıyor. Kurumsal ağ/VPN bağlantınızı kontrol edin.', en: 'LCW AI cannot be reached. Check your corporate network/VPN connection.', retryable: true },
  UNAVAILABLE: { status: 503, tr: 'LCW AI şu an hizmet veremiyor. Biraz sonra tekrar deneyin.', en: 'LCW AI is currently unavailable. Try again later.', retryable: true },
  STREAM_INTERRUPTED: { status: 502, tr: 'LCW AI yanıtı yarıda kesildi. Tekrar deneyin.', en: 'The LCW AI response was interrupted. Try again.', retryable: true },
  UPLOAD_FAILED: { status: 502, tr: 'Dosya LCW AI’a yüklenemedi.', en: 'The file could not be uploaded to LCW AI.', retryable: true },
  FILE_TOO_LARGE: { status: 413, tr: 'Dosya LCW AI için çok büyük.', en: 'The file is too large for LCW AI.' },
  FILE_TYPE_NOT_ALLOWED: { status: 415, tr: 'Bu dosya türü LCW AI’a gönderilemez.', en: 'This file type cannot be sent to LCW AI.' },
  QUOTA_EXCEEDED: { status: 429, tr: 'LCW AI dosya kotanız doldu. Eski sohbet dosyalarını silip tekrar deneyin.', en: 'Your LCW AI file quota is full. Delete old chat files and try again.' },
  INVALID_RESPONSE: { status: 502, tr: 'LCW AI’ın cevabı anlaşılamadı. Tekrar deneyin ya da isteği sadeleştirin.', en: 'The LCW AI answer could not be understood. Try again or simplify the request.', retryable: true },
  OUTPUT_INVALID: { status: 422, tr: 'LCW AI istenen dosya için geçerli bir içerik üretmedi (düzeltme denemeleri de sonuç vermedi). İsteği sadeleştirip tekrar deneyin.', en: 'LCW AI did not produce valid content for the requested file (repair attempts failed too). Simplify the request and try again.', retryable: true },
  OUTPUT_RENDER_FAILED: { status: 500, tr: 'Dosya oluşturulamadı.', en: 'The file could not be created.', retryable: true },
  OUTPUT_NOT_FOUND: { status: 404, tr: 'Dosya bulunamadı; silinmiş ya da taşınmış olabilir.', en: 'The file was not found; it may have been deleted or moved.' },
  SCHEMA_MISMATCH: { status: 422, tr: 'LCW AI beklenen biçimde bir öneri üretmedi. Tekrar deneyin ya da isteği netleştirin.', en: 'LCW AI did not produce a suggestion in the expected format. Try again or clarify the request.', retryable: true },
  CANCELLED: { status: 499, tr: 'LCW AI isteği iptal edildi.', en: 'The LCW AI request was cancelled.' },
  BUSY: { status: 429, tr: 'Aynı anda çok fazla LCW AI isteği var. Öncekinin bitmesini bekleyin.', en: 'Too many LCW AI requests at once. Wait for the previous one to finish.', retryable: true },
  BAD_REQUEST: { status: 400, tr: 'LCW AI isteği geçersiz.', en: 'The LCW AI request is invalid.' },
  INTERNAL: { status: 500, tr: 'LCW AI isteği tamamlanamadı.', en: 'The LCW AI request could not be completed.' },
});

class LcwAiError extends Error {
  constructor(code, options = {}) {
    const key = Object.prototype.hasOwnProperty.call(CODES, code) ? code : 'INTERNAL';
    const entry = CODES[key];
    super(entry.tr);
    this.name = 'LcwAiError';
    this.code = `LCWAI_${key}`;
    this.shortCode = key;
    this.statusCode = entry.status;
    this.messageEn = entry.en;
    this.action = entry.action || '';
    this.retryable = Boolean(entry.retryable);
    if (options.remoteStatus) this.remoteStatus = Number(options.remoteStatus) || 0;
    if (options.retryAfterSec) this.retryAfterSec = Number(options.retryAfterSec) || 0;
    // Ayrıntı yalnız teşhis içindir; yine de sır taşımadığından emin olunur.
    if (options.detail) this.detail = redactSecrets(String(options.detail)).slice(0, 240);
    // Yalnız kota için LCW AI'ın kendi açıklaması kullanıcıya gösterilir
    // (ör. kalan alan); sırlardan arındırılır ve kısa tutulur.
    if (options.remoteMessage) this.remoteMessage = redactSecrets(String(options.remoteMessage)).replace(/[<>]/g, '').slice(0, 200);
  }
}

function lcwAiError(code, options) { return new LcwAiError(code, options); }
function isLcwAiError(error) { return Boolean(error && error.name === 'LcwAiError' && /^LCWAI_/.test(String(error.code || ''))); }

/* LCW AI HTTP durumunu koda çevirir. Gövde metni kullanıcıya gitmez; yalnız
   kota/boyut ayrımı için okunur. */
function remoteMessageOf(body) {
  const raw = String(body || '').trim();
  try { const parsed = JSON.parse(raw); const message = parsed && (parsed.message || parsed.error || parsed.title || parsed.detail); if (typeof message === 'string') return message; } catch (_) {}
  return raw.startsWith('<') ? '' : raw;
}
function errorForHttpStatus(status, { body = '', upload = false, retryAfter = '' } = {}) {
  const code = Number(status) || 0;
  const text = String(body || '').toLowerCase();
  const quota = /quota|kota|storage/.test(text);
  if (quota && (code === 403 || code === 429 || upload)) return lcwAiError('QUOTA_EXCEEDED', { remoteStatus: code, remoteMessage: remoteMessageOf(body) });
  const retryAfterSec = Number.parseInt(String(retryAfter || ''), 10) || 0;
  if (code === 401) return lcwAiError('SESSION_EXPIRED', { remoteStatus: code });
  if (code === 403) return lcwAiError(/quota|kota|limit/.test(text) ? 'QUOTA_EXCEEDED' : 'FORBIDDEN', { remoteStatus: code });
  if (code === 413) return lcwAiError('FILE_TOO_LARGE', { remoteStatus: code });
  if (code === 415) return lcwAiError('FILE_TYPE_NOT_ALLOWED', { remoteStatus: code });
  if (code === 429) return lcwAiError(/quota|kota|storage/.test(text) ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED', { remoteStatus: code, retryAfterSec });
  if (code === 408 || code === 504) return lcwAiError('TIMEOUT', { remoteStatus: code });
  if (code >= 500) return lcwAiError('UNAVAILABLE', { remoteStatus: code });
  if (upload) return lcwAiError(/quota|kota|storage/.test(text) ? 'QUOTA_EXCEEDED' : 'UPLOAD_FAILED', { remoteStatus: code, detail: body });
  return lcwAiError('BAD_REQUEST', { remoteStatus: code });
}

/* fetch/AbortController hatalarını sınıflandırır. `reason` iptalin kimden
   geldiğini söyler: kullanıcı mı, zaman aşımı mı. */
function errorForTransport(error, { reason = '' } = {}) {
  if (isLcwAiError(error)) return error;
  if (reason === 'cancelled') return lcwAiError('CANCELLED');
  if (reason === 'timeout') return lcwAiError('TIMEOUT');
  const name = String(error && error.name || '');
  if (name === 'AbortError') return lcwAiError(reason === 'idle' ? 'STREAM_INTERRUPTED' : 'CANCELLED');
  return lcwAiError('NETWORK', { detail: error && error.message });
}

/* Renderer'a giden güvenli biçim: kod + iki dilde metin + aksiyon. */
function publicError(error) {
  const safe = isLcwAiError(error) ? error : lcwAiError('INTERNAL');
  const out = { code: safe.code, message: safe.message, messageEn: safe.messageEn, retryable: safe.retryable };
  if (safe.action) out.action = safe.action;
  if (safe.retryAfterSec) out.retryAfterSec = safe.retryAfterSec;
  if (safe.shortCode === 'QUOTA_EXCEEDED' && safe.remoteMessage) out.remoteMessage = safe.remoteMessage;
  return out;
}

module.exports = { CODES, LcwAiError, lcwAiError, isLcwAiError, errorForHttpStatus, errorForTransport, publicError };
