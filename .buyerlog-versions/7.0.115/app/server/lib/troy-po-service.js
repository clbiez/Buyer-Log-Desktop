'use strict';

/* v9.40 — TROY PO İNDİRME SERVİSİ (§ Download PO)
 *
 * GetOrderPO'nun cevabı Node'un kendi ağ yığınına hiç girmez: gerçek istek
 * tarayıcı içinde (CDP Runtime.evaluate) çalışır, yalnız base64'e çevrilmiş
 * gövde + Content-Type/Content-Disposition Node'a döner (bkz.
 * troy-session-service.js troyFetchExpression, wantBinary:true).
 *
 * Uzantı sırası: Content-Disposition → Content-Type → dosya imzası (magic
 * bytes). HTML/hata gövdesi asla diske yazılmaz. Dosya adı deterministiktir
 * (Style Name + Order Code'dan); "(1)/(2)" ÜRETİLMEZ — yeniden indirme aynı
 * yolun üstüne yazar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const troySession = require('./troy-session-service');
const { connectorError, safeOwner } = troySession;

const TROY_API_ROOT = 'https://purchaseorder.prod.lcwaikiki.com/purchaseorder/bf/service/api/Order';
const PO_TIMEOUT_MS = 30000;

function clean(value) { return String(value == null ? '' : value).trim(); }

function poFolder() { return path.join(os.homedir(), 'Downloads', 'Buyer Log PO'); }
function ensurePoFolder() { fs.mkdirSync(poFolder(), { recursive: true }); return poFolder(); }

// İstenen kara liste: < > : " / \ | ? *  — artı Windows'un kabul etmediği
// baştaki/sondaki nokta ve boşluk kırpılır.
function sanitizeWindowsFilename(value) {
  const cleaned = clean(value).replace(/[<>:"/\\|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned || 'file';
}

function poBaseName(orderCode, styleName) {
  const code = clean(orderCode);
  const style = clean(styleName);
  const raw = style ? `${style} - PO ${code}` : `PO ${code}`;
  return sanitizeWindowsFilename(raw);
}

// Aynı temel adı (uzantısız) taşıyan bir dosya klasörde var mı? Uzantı ilk
// indirmeye kadar bilinmediği için varlık kontrolü uzantısız isim üzerinden
// yapılır.
function findExistingPoFile(orderCode, styleName) {
  const base = poBaseName(orderCode, styleName);
  const folder = poFolder();
  let entries;
  try { entries = fs.readdirSync(folder); } catch (_) { return null; }
  const match = entries.find(name => path.parse(name).name === base);
  return match ? { filePath: path.join(folder, match), fileName: match } : null;
}

const CONTENT_TYPE_EXT = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/vnd.ms-excel': 'xls',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};
function extensionFromContentDisposition(header) {
  const value = clean(header);
  if (!value) return '';
  const starMatch = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(value);
  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  const raw = starMatch ? decodeURIComponent(starMatch[1]) : (plainMatch ? plainMatch[1] : '');
  const ext = path.extname(clean(raw)).replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}
function extensionFromContentType(header) {
  const mime = clean(header).toLowerCase().split(';')[0].trim();
  return CONTENT_TYPE_EXT[mime] || '';
}
// coreNectumImageMime (agent-browser-connector.js) ile aynı "önce ipucu,
// sonra ilk baytlar" deseni — burada görsellerden çok PDF/ZIP-tabanlı
// (xlsx/docx) dosyalar için.
function sniffFileSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return '';
  if (buffer.slice(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) return 'xlsx';
  return '';
}
// GetOrderPO gövdenin dört olası biçiminden biri olabilir: ham binary, ham
// base64 metni, bir bayt-dizisi JSON'u ([37,80,68,70,...]), ya da bir JSON
// zarfının İÇİNDE base64 alanı ("JSON-Base64", ör. {"fileBase64":"..."}).
// Yalnız son ikisi burada "unwrap" edilir; ilk ikisi zaten olduğu gibi
// kullanılabilir (base64 metni ise sniffFileSignature/Content-Type zaten
// onu ham metin gibi ele alıp uzantı bulamaz, bu yüzden düz base64 metni de
// burada tanınır: gövdenin TAMAMI geçerli bir base64 alfabesiyse ve çözülünce
// bilinen bir imza veriyorsa o çözüm kullanılır).
function looksLikeBase64Text(text) {
  const trimmed = clean(text);
  return trimmed.length > 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed.replace(/\s+/g, ''));
}
function findBase64FieldDeep(value, depth = 0) {
  if (value == null || depth > 3) return '';
  if (typeof value === 'string' && looksLikeBase64Text(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findBase64FieldDeep(item, depth + 1); if (found) return found; }
    return '';
  }
  if (typeof value === 'object') {
    for (const val of Object.values(value)) { const found = findBase64FieldDeep(val, depth + 1); if (found) return found; }
  }
  return '';
}
function unwrapPoBuffer(buffer, contentType) {
  const looksJson = clean(contentType).toLowerCase().includes('json') || buffer[0] === 0x7b /* { */ || buffer[0] === 0x5b /* [ */;
  if (!looksJson) return buffer;
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch (_) { return buffer; }
  // Bayt-dizisi JSON'u: [37,80,68,70,...]
  if (Array.isArray(parsed) && parsed.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Buffer.from(parsed);
  }
  // JSON-sarmalı base64: nesnenin (ya da dizinin) içinde base64-benzeri bir alan ara.
  const field = findBase64FieldDeep(parsed);
  if (field) return Buffer.from(field.replace(/\s+/g, ''), 'base64');
  return buffer;
}
function looksLikeErrorBody(contentType, buffer) {
  const mime = clean(contentType).toLowerCase();
  if (mime.includes('text/html')) return true;
  if (mime.includes('application/json') && !mime.includes('pdf')) {
    // JSON gövdesi çoğu zaman bir hata zarfıdır; ancak PO API'sinin JSON
    // içinde base64 sarması ihtimaline karşı yalnız KÜÇÜK (olası hata
    // mesajı boyutunda) JSON gövdeleri hata sayılır — büyük bir JSON,
    // JSON-sarmalı base64 payload olabilir (bkz. downloadPO'daki ayrıştırma).
    return buffer.length < 2048;
  }
  return false;
}

async function callGetOrderPo(ownerId, headers, orderCode) {
  return troySession.troyRequest(ownerId, headers, `${TROY_API_ROOT}/GetOrderPO`, 'POST', { OrderCode: orderCode }, { wantBinary: true });
}

const inProgress = new Set();
function lockKey(ownerId, orderCode) { return `${safeOwner(ownerId)}::downloadPO::${clean(orderCode)}`; }

async function attemptDownload(ownerId, orderCode) {
  const auth = await troySession.getFreshAuthorization(ownerId);
  if (!auth.ok) throw connectorError('Troy oturumu bulunamadı; giriş gerekiyor.', auth.code || 'TROY_LOGIN_REQUIRED', 401, { opened: auth.opened });
  return callGetOrderPo(ownerId, auth.headers, orderCode);
}

async function downloadPO(ownerId, orderCode, { styleName } = {}) {
  const code = clean(orderCode);
  if (!code) throw connectorError('Sipariş kodu eksik.', 'TROY_INVALID_ORDER_CODE', 400);
  const key = lockKey(ownerId, code);
  if (inProgress.has(key)) throw connectorError('Bu sipariş için bir PO indirme işlemi zaten sürüyor.', 'TROY_OPERATION_IN_PROGRESS', 409);
  inProgress.add(key);

  let timer;
  try {
    const withTimeout = promise => new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(connectorError('PO indirme isteği zaman aşımına uğradı.', 'TROY_TIMEOUT', 408)), PO_TIMEOUT_MS);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });

    let result;
    try {
      result = await withTimeout(attemptDownload(ownerId, code));
    } catch (error) {
      if (!error || error.code !== 'TROY_UNAUTHORIZED') throw error;
      try {
        result = await withTimeout(attemptDownload(ownerId, code));
      } catch (retryError) {
        if (retryError && retryError.code === 'TROY_UNAUTHORIZED') {
          throw connectorError('Troy oturumu sona ermiş. Lütfen Troy\'da oturum açıp tekrar deneyin.', 'TROY_LOGIN_REQUIRED', 401);
        }
        throw retryError;
      }
    }

    if (!result.ok) throw connectorError(`Troy GetOrderPO hatası: HTTP ${result.status} ${result.statusText}`.trim(), 'TROY_HTTP_ERROR', 502, { status: result.status });

    const rawBuffer = Buffer.from(clean(result.base64), 'base64');
    if (!rawBuffer.length) throw connectorError('Troy PO yanıtı boş.', 'TROY_PO_INVALID_RESPONSE', 502);
    const buffer = unwrapPoBuffer(rawBuffer, result.contentType);
    if (looksLikeErrorBody(result.contentType, buffer)) {
      throw connectorError('Troy PO isteği bir hata/HTML sayfası döndürdü; dosya kaydedilmedi.', 'TROY_PO_INVALID_RESPONSE', 502);
    }

    const ext = extensionFromContentDisposition(result.contentDisposition)
      || extensionFromContentType(result.contentType)
      || sniffFileSignature(buffer);
    if (!ext) throw connectorError('Troy PO dosya türü belirlenemedi; dosya kaydedilmedi.', 'TROY_PO_INVALID_RESPONSE', 502);

    ensurePoFolder();
    const fileName = `${poBaseName(code, styleName)}.${ext}`;
    const filePath = path.join(poFolder(), fileName);
    fs.writeFileSync(filePath, buffer);
    return { ok: true, filePath, fileName };
  } finally {
    clearTimeout(timer);
    inProgress.delete(key);
  }
}

module.exports = {
  downloadPO, findExistingPoFile, poBaseName, poFolder,
  sanitizeWindowsFilename, extensionFromContentDisposition, extensionFromContentType, sniffFileSignature,
  unwrapPoBuffer, looksLikeErrorBody,
};
