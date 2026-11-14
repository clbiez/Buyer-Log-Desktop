'use strict';

/*
 * LCW AI web istemcisi istek YAPISI tanılaması (saf).
 *
 * Amaç: LCW AI web sayfasının ek içeren mesajı hangi alanlarla gönderdiğini
 * (ör. attachments[].fileId, sessionId, fileIds) DevTools olmadan görmek.
 * Yalnız alan ADLARI ve değer TÜRLERİ çıkarılır; hiçbir değer (metin, kimlik,
 * dosya içeriği, token) dönmez. Authorization başlığı hiç okunmaz.
 */

const MAX_DEPTH = 5;
const MAX_KEYS = 40;
const SAFE_KEY = /^[A-Za-z0-9_$-]{1,60}$/;

function safeKey(key) { return SAFE_KEY.test(key) ? key : '?'; }

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/* { a: 'x', b: [{ c: 1 }] } → "{a:string,b:[{c:number}]}" */
function jsonShape(value, depth = 0) {
  const type = typeOf(value);
  if (type === 'array') {
    if (!value.length) return '[]';
    if (depth >= MAX_DEPTH) return '[…]';
    return `[${jsonShape(value[0], depth + 1)}]${value.length > 1 ? `x${value.length}` : ''}`;
  }
  if (type !== 'object') return type;
  if (depth >= MAX_DEPTH) return '{…}';
  const keys = Object.keys(value);
  const parts = keys.slice(0, MAX_KEYS).map(key => `${safeKey(key)}:${jsonShape(value[key], depth + 1)}`);
  if (keys.length > MAX_KEYS) parts.push('…');
  return `{${parts.join(',')}}`;
}

/* multipart gövdesinden yalnız alan adları (+ dosya alanı olduğu işareti). */
function multipartFields(text) {
  const out = [];
  const re = /Content-Disposition:\s*form-data;\s*name="([^"]{1,60})"(;\s*filename=)?/gi;
  let match;
  while ((match = re.exec(text)) && out.length < MAX_KEYS) out.push(safeKey(match[1]) + (match[2] ? '(file)' : ''));
  return out;
}

/*
 * Electron webRequest uploadData → tek satırlık yapı özeti.
 * uploadData: [{ bytes?: Buffer, file?: string, blobUUID?: string }]
 */
function describeUpload(uploadData, contentType = '') {
  const items = Array.isArray(uploadData) ? uploadData : [];
  if (!items.length) return 'body=none';
  const bytes = items.filter(item => item && item.bytes).map(item => Buffer.from(item.bytes));
  const extra = items.length - bytes.length;
  const text = Buffer.concat(bytes).toString('utf8');
  const type = String(contentType || '').toLowerCase();
  if (/multipart\/form-data/.test(type) || /Content-Disposition:\s*form-data/i.test(text.slice(0, 4000))) {
    return `multipart=${multipartFields(text).join(',') || '?'}${extra ? ` parts+${extra}` : ''}`;
  }
  try { return `json=${jsonShape(JSON.parse(text))}`; }
  catch (_) { return `body=unparsed bytes=${text.length}${extra ? ` parts+${extra}` : ''}`; }
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find(item => item.toLowerCase() === name);
  if (!key) return '';
  const value = headers[key];
  return String(Array.isArray(value) ? value[0] : value || '');
}

/* LCW AI API yolu: yalnız /lcw/gpt/api/ altı, sorgu dizesi atılır. */
function apiPath(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.hostname.toLowerCase() !== 'mym.prod.lcwaikiki.com') return '';
    const match = /\/lcw\/gpt\/api(\/[A-Za-z0-9._~\-/]{0,200})/.exec(parsed.pathname);
    if (!match) return '';
    // Yol içindeki kimlikleri (GUID/sayı) maskele.
    return match[1].replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d{3,}/g, '/:id');
  } catch (_) { return ''; }
}

function describeRequest(details = {}) {
  const path = apiPath(details.url);
  if (!path) return '';
  const method = String(details.method || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10);
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return '';
  const contentType = headerValue(details.requestHeaders, 'content-type');
  return `LCWAI_WEB_REQUEST ${method} ${path} ${describeUpload(details.uploadData, contentType)}`;
}

module.exports = { jsonShape, multipartFields, describeUpload, describeRequest, apiPath };
