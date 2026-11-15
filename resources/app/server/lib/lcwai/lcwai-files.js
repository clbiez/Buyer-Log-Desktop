'use strict';

/*
 * LCW AI dosya yükleme yardımcıları (saf).
 *
 *   POST /lcw/gpt/api/chat/files/upload   multipart/form-data  file=<binary>
 *   → { sessionId, fileId, blobName, fileName, contentType, size, url }
 *
 * Mesaja eklenirken yalnız { blobName, contentType, fileName, size, url }
 * kullanılır (doğrulanmış biçim). Yanıtın geri kalanı atılır.
 */
const path = require('path');
const config = require('./lcwai-config');
const { lcwAiError } = require('./lcwai-errors');

const EXTENSION_TYPES = Object.freeze({
  '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown', '.json': 'application/json', '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
});

function clean(value) { return String(value == null ? '' : value).trim(); }

/* Dosya adı yalnız görünen addır: klasör, kontrol karakteri ve yol ayracı
   atılır; Türkçe karakterler korunur ("İşleyiş.txt"). */
function sanitizeFileName(value) {
  const base = path.basename(clean(value).replace(/\\/g, '/'));
  const name = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return name || 'dosya.txt'; // i18n-ignore — varsayılan dosya adı
}

function resolveContentType(fileName, declared) {
  const type = clean(declared).toLowerCase().split(';')[0];
  if (type && config.ALLOWED_UPLOAD_TYPES.includes(type)) return type;
  const byExtension = EXTENSION_TYPES[path.extname(fileName).toLowerCase()];
  return byExtension || type;
}

function validateUpload({ buffer, fileName, contentType } = {}) {
  if (!buffer || !(buffer instanceof Uint8Array) || !buffer.length) throw lcwAiError('BAD_REQUEST', { detail: 'empty-file' });
  if (buffer.length > config.LIMITS.maxFileBytes) throw lcwAiError('FILE_TOO_LARGE');
  const name = sanitizeFileName(fileName);
  const type = resolveContentType(name, contentType);
  if (!config.ALLOWED_UPLOAD_TYPES.includes(type)) throw lcwAiError('FILE_TYPE_NOT_ALLOWED');
  return { buffer, fileName: name, contentType: type, size: buffer.length };
}

function buildUploadForm(file) {
  const valid = validateUpload(file);
  const form = new FormData();
  form.append('file', new Blob([valid.buffer], { type: valid.contentType }), valid.fileName);
  return { form, file: valid };
}

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/* Alan adı büyük/küçük harf duyarsız okunur: .NET serileştiricisi
   camelCase (blobName) yerine PascalCase (BlobName) dönebilir. */
function field(record, name) {
  if (!isRecord(record)) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, name)) return record[name];
  const key = Object.keys(record).find(item => item.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : record[key];
}
/* Yanıt { data: {...} } / { result: [...] } gibi bir zarfla gelebilir.
   blobName taşıyan ilk kayıt (en fazla iki kat derinlikte) kullanılır. */
const ENVELOPE_KEYS = ['data', 'result', 'file', 'value', 'item', 'payload', 'attachment'];
function attachmentRecord(value, depth = 0) {
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return null;
  if (field(record, 'blobName') != null) return record;
  if (depth >= 2) return null;
  for (const key of ENVELOPE_KEYS) {
    const found = attachmentRecord(field(record, key), depth + 1);
    if (found) return found;
  }
  return null;
}
/* Teşhis için yanıtın yalnız ALAN ADLARI (değer asla): "a,b{c,d}". */
function responseShape(value) {
  const safe = key => /^[A-Za-z0-9_$-]{1,40}$/.test(key) ? key : '?';
  const keysOf = record => Object.keys(record).slice(0, 15);
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return Array.isArray(value) ? '[]' : typeof value;
  return keysOf(record).map(key => {
    const inner = Array.isArray(record[key]) ? record[key][0] : record[key];
    return isRecord(inner) ? `${safe(key)}{${keysOf(inner).map(safe).join(',')}}` : safe(key);
  }).join(',').slice(0, 200);
}

/* fileId biçimi: kimlik yalnız güvenli karakterlerden oluşur (yol/boşluk
   yok); sayı ise sayı olarak korunur. Yüklenen dosya LCW AI'da yükleme
   oturumuna (sessionId) bağlıdır; yalnız fileId ile gönderilen ek sunucuda
   sessizce yok sayıldı ("No image was attached"). Bu yüzden sessionId ekte
   taşınır (kimlik bilgisi değildir; yalnız kullanıcının kendi bearer'ıyla
   anlamlıdır). quota mesaja taşınmaz. */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
function fileIdRecord(value, depth = 0) {
  const record = Array.isArray(value) ? value[0] : value;
  if (!isRecord(record)) return null;
  if (field(record, 'fileId') != null) return record;
  if (depth >= 2) return null;
  for (const key of ENVELOPE_KEYS) {
    const found = fileIdRecord(field(record, key), depth + 1);
    if (found) return found;
  }
  return null;
}
function fileIdAttachment(record, fallback = {}) {
  const raw = field(record, 'fileId');
  const fileId = typeof raw === 'number' ? raw : clean(raw);
  const valid = typeof fileId === 'number' ? Number.isSafeInteger(fileId) && fileId >= 0 : SAFE_ID.test(fileId) && !fileId.includes('..');
  if (!valid) throw lcwAiError('UPLOAD_FAILED', { detail: 'file-id' });
  const sessionId = clean(field(record, 'sessionId'));
  if (sessionId && (!SAFE_ID.test(sessionId) || sessionId.includes('..'))) throw lcwAiError('UPLOAD_FAILED', { detail: 'file-id' });
  const sha256 = clean(field(record, 'sha256'));
  if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) throw lcwAiError('UPLOAD_FAILED', { detail: 'file-id' });
  const size = Number(field(record, 'size'));
  const out = {
    fileId,
    contentType: clean(field(record, 'contentType')) || clean(fallback.contentType) || 'application/octet-stream',
    fileName: sanitizeFileName(field(record, 'fileName') || fallback.fileName),
    size: Number.isFinite(size) && size >= 0 ? size : Number(fallback.size) || 0,
  };
  if (sha256) out.sha256 = sha256;
  if (sessionId) out.sessionId = sessionId;
  return out;
}

/* Yükleme yanıtını mesaj ekine çevirir. Eksik/garip alan varsa ek
   gönderilmez: yanlış bir blobName başka bir dosyayı işaret edebilir. */
function toAttachment(response, fallback = {}) {
  if (!response || typeof response !== 'object') throw lcwAiError('UPLOAD_FAILED', { detail: 'upload-response' });
  // Bilinen biçim (camelCase, zarfsız) doğrudan okunur; yalnız diğer biçimler
  // tek seferde camelCase alanlara çevrilir.
  let value = response;
  if (typeof response.blobName !== 'string') {
    const record = attachmentRecord(response);
    if (!record) {
      // LCW AI 11.2026 sonrası yükleme yanıtı blobName/url taşımaz; dosya
      // fileId ile anılır: { sessionId, fileId, sha256, fileName, contentType, size, quota }.
      const byId = fileIdRecord(response);
      if (byId) return fileIdAttachment(byId, fallback);
      const error = lcwAiError('UPLOAD_FAILED', { detail: 'blob-name' }); error.responseShape = responseShape(response); throw error;
    }
    value = { blobName: field(record, 'blobName'), url: field(record, 'url'), size: field(record, 'size'), contentType: field(record, 'contentType'), fileName: field(record, 'fileName') };
  }
  const blobName = clean(value.blobName);
  const url = clean(value.url);
  if (!blobName || blobName.length > 500 || /[\u0000-\u001f]/.test(blobName)) throw lcwAiError('UPLOAD_FAILED', { detail: 'blob-name' });
  if (url && (url.length > 1000 || !/^\/?[A-Za-z0-9._~\-/%]+$/.test(url))) throw lcwAiError('UPLOAD_FAILED', { detail: 'attachment-url' });
  const size = Number(value.size);
  return {
    blobName,
    contentType: clean(value.contentType) || clean(fallback.contentType) || 'application/octet-stream',
    fileName: sanitizeFileName(value.fileName || fallback.fileName),
    size: Number.isFinite(size) && size >= 0 ? size : Number(fallback.size) || 0,
    url,
  };
}

/* İstemciden gelen (daha önce yüklenmiş) ek tanımını yeniden doğrular. */
function normalizeAttachments(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw lcwAiError('BAD_REQUEST', { detail: 'attachments' });
  if (list.length > config.LIMITS.maxFilesPerRequest) throw lcwAiError('BAD_REQUEST', { detail: 'too-many-attachments' });
  return list.map(item => toAttachment(item));
}

module.exports = { sanitizeFileName, resolveContentType, validateUpload, buildUploadForm, toAttachment, normalizeAttachments, EXTENSION_TYPES };
