'use strict';

/* Sınırlı görsel indirme motoru.
 *
 * NEDEN NODE TARAFINDA: CoreNectum Attachment/GetAttachment adresleri yetkili
 * tarayıcı oturumu olmadan da açılıyor (canlı doğrulandı). Eski akış her
 * görseli tarayıcı içinde indirip base64 olarak tek bir CDP soketinden Node'a
 * taşıyordu; binlerce görselde bu soket tek darboğazdı. Artık yalnız YETKİLİ
 * metadata (GetStyleList / GetStyleImages) tarayıcıda çalışır; baytlar
 * doğrudan Node'a iner.
 *
 * YİNE DE DIŞ KAYNAK: URL doğrulanır (yalnız lcwaikiki.com Attachment yolu),
 * HTTP durumu ve Content-Type denetlenir, boyut tavanı ve zaman aşımı vardır.
 *
 * BAĞLANTI YENİDEN KULLANIMI: görsel başına yeni bir socket/TLS el sıkışması
 * 5.000 görselde tek başına dakikalar ekler. Tek paylaşılan keepAlive Agent
 * tutulur.
 *
 * BELLEK: aynı anda en çok `concurrency` kadar görsel gövdesi bellektedir.
 * Kuyruk hiçbir zaman bütün görselleri biriktirmez; her görsel tamamlanınca
 * çağıranın onWritten geri çağrısına verilir ve bırakılır.
 */

const https = require('https');
const { URL } = require('url');
const { attachmentUrl, boundedConcurrency, IMAGE_DOWNLOAD_CONCURRENCY } = require('./corenectum-style-api');

const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 400;
const DEFAULT_MAX_DELAY_MS = 8000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 509, 521, 522, 524]);
const AUTH_STATUS = new Set([401, 403]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'ERR_SOCKET_CONNECTION_TIMEOUT', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH',
  'PLM_IMAGE_TIMEOUT',
]);

const ALLOWED_MIME = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

let sharedAgent = null;
function imageAgent() {
  if (!sharedAgent) {
    sharedAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 15000,
      // Havuz eşzamanlılıktan biraz geniş: yeniden denemeler bekleyen bir
      // isteği socket kuyruğunda kilitlemesin.
      maxSockets: 24,
      maxFreeSockets: 12,
      timeout: DEFAULT_TIMEOUT_MS,
    });
  }
  return sharedAgent;
}

function destroyImageAgent() {
  if (sharedAgent) { try { sharedAgent.destroy(); } catch (_) {} sharedAgent = null; }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); }

function downloadError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

/* Dosya uzantısına GÜVENİLMEZ. Gerçek pakette .bmp ve .jfif uzantılı
   dosyaların baytları PNG çıktı; uzantıya bakan bir doğrulama bu görselleri
   ya reddeder ya da yanlış Content-Type ile depolar. */
function sniffImageMime(buffer, hint = '') {
  if (Buffer.isBuffer(buffer) && buffer.length >= 12) {
    if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    /* Baytlar okunabilecek kadar uzun ve HİÇBİR raster imzasına uymuyorsa
       bildirilen tipe GÜVENİLMEZ: CoreNectum önüne giren bir vekil/oturum
       sayfası HTML gövdesini image/png olarak da sunabilir. O gövdeyi model
       görseli diye depoya yazmak kırık görsel üretirdi. */
    return '';
  }
  // Yalnız baytlar tespit için çok kısaysa bildirilen tip son çaredir.
  const declared = String(hint || '').toLowerCase().split(';')[0].trim();
  return ALLOWED_MIME[declared] || '';
}

function contentTypeAcceptable(value) {
  const declared = String(value || '').toLowerCase().split(';')[0].trim();
  if (!declared) return true; // Sunucu tip bildirmediyse karar baytlara kalır.
  return Boolean(ALLOWED_MIME[declared]);
}

function isRetryable(error) {
  if (!error) return false;
  if (error.code === 'PLM_IMAGE_HTTP_ERROR') return RETRYABLE_STATUS.has(Number(error.status));
  if (error.code === 'PLM_IMAGE_AUTH') return false;
  if (error.code === 'PLM_IMAGE_TOO_LARGE') return false;
  if (error.code === 'PLM_IMAGE_INVALID_TYPE') return false;
  if (error.code === 'PLM_IMAGE_URL_INVALID') return false;
  if (error.code === 'PLM_JOB_CANCELLED') return false;
  return RETRYABLE_ERROR_CODES.has(String(error.code || ''));
}

/* Üstel geri çekilme + JITTER. Jitter olmadan aynı anda başarısız olan 8
   indirme aynı anda yeniden dener ve 429'u kendi eliyle tekrar üretir. */
function retryDelay(attempt, options = {}) {
  const base = Math.max(1, Number(options.baseDelayMs) || DEFAULT_BASE_DELAY_MS);
  const max = Math.max(base, Number(options.maxDelayMs) || DEFAULT_MAX_DELAY_MS);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const exponential = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

function retryAfterDelay(headers, fallback) {
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  const seconds = Number(String(raw == null ? '' : raw).trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(DEFAULT_MAX_DELAY_MS, Math.round(seconds * 1000));
  return fallback;
}

/* Tek bir HTTPS GET. Gövde parça parça biriktirilir ve tavanı geçerse istek
   ANINDA kesilir; bozuk/çok büyük bir yanıt belleği şişirmez.
   Bearer/erişim anahtarı GÖNDERİLMEZ: bu uçlar yetki istemiyor ve anahtarı
   Node tarafına taşımak onu günlüklere/çöküş izlerine sızdırma riski yaratır.
   x-cancel-previous-request de gönderilmez (tarayıcı arayüzü davranışıdır;
   sunucu tarafında önceki isteği iptal ettirmesi istenmez). */
function httpGetImage(url, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || MAX_IMAGE_BYTES);
  return new Promise((resolve, reject) => {
    let request = null;
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; fn(value); };
    try {
      const parsed = new URL(url);
      request = https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        agent: options.agent || imageAgent(),
        headers: { Accept: 'image/*', 'Accept-Encoding': 'identity', 'User-Agent': 'BuyerLog-PLM-Image/1' },
      }, response => {
        const status = Number(response.statusCode) || 0;
        const headers = response.headers || {};
        if (status < 200 || status >= 300) {
          response.resume();
          if (AUTH_STATUS.has(status)) return finish(reject, downloadError(`PLM görseli yetkilendirme hatası (HTTP ${status}).`, 'PLM_IMAGE_AUTH', { status, headers }));
          return finish(reject, downloadError(`PLM görseli alınamadı (HTTP ${status}).`, 'PLM_IMAGE_HTTP_ERROR', { status, headers }));
        }
        if (!contentTypeAcceptable(headers['content-type'])) {
          response.destroy();
          return finish(reject, downloadError(`PLM görseli beklenen raster görsel yerine ${String(headers['content-type'] || 'bilinmeyen tip')} döndürdü.`, 'PLM_IMAGE_INVALID_TYPE', { status, declared: String(headers['content-type'] || '') }));
        }
        const declaredLength = Number(headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          response.destroy();
          return finish(reject, downloadError(`PLM görseli boyut tavanını aştı (${declaredLength} bayt).`, 'PLM_IMAGE_TOO_LARGE', { status, size: declaredLength }));
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            finish(reject, downloadError(`PLM görseli boyut tavanını aştı (${size} bayt).`, 'PLM_IMAGE_TOO_LARGE', { status, size }));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => finish(resolve, { status, contentType: String(headers['content-type'] || ''), buffer: Buffer.concat(chunks, size), headers }));
        response.on('error', error => finish(reject, error));
      });
      request.setTimeout(timeoutMs, () => {
        request.destroy(downloadError('PLM görsel indirmesi zaman aşımına uğradı.', 'PLM_IMAGE_TIMEOUT'));
      });
      request.on('error', error => finish(reject, error && error.code ? error : downloadError(String(error && error.message || error), 'ECONNRESET')));
    } catch (error) {
      finish(reject, downloadError(String(error && error.message || error), 'PLM_IMAGE_URL_INVALID'));
    }
  });
}

/* Tek görsel: doğrula → indir → yeniden dene → baytları doğrula.
   Dönen nesne baytları taşır; diske yazma kanonik depo katmanının işidir
   (server/user-data.js saveCollectionImage atomik yazar). */
async function downloadImage(url, options = {}) {
  const safeUrl = attachmentUrl(url);
  if (!safeUrl) throw downloadError('CoreNectum Attachment adresi geçersiz.', 'PLM_IMAGE_URL_INVALID');
  const maxAttempts = Math.max(1, Math.trunc(Number(options.maxAttempts)) || DEFAULT_MAX_ATTEMPTS);
  const request = typeof options.request === 'function' ? options.request : httpGetImage;
  const wait = typeof options.sleep === 'function' ? options.sleep : sleep;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (typeof options.isCancelled === 'function' && options.isCancelled()) {
      throw downloadError('PLM görsel indirme işlemi kullanıcı tarafından durduruldu.', 'PLM_JOB_CANCELLED');
    }
    try {
      const response = await request(safeUrl, options);
      const buffer = Buffer.isBuffer(response && response.buffer) ? response.buffer : Buffer.alloc(0);
      if (!buffer.length) throw downloadError('PLM görsel yanıtı boş.', 'PLM_IMAGE_EMPTY');
      const mimeType = sniffImageMime(buffer, response && response.contentType);
      if (!mimeType) throw downloadError('PLM görsel yanıtı geçerli bir raster görsel değil.', 'PLM_IMAGE_INVALID_TYPE', { declared: String((response && response.contentType) || '') });
      return { url: safeUrl, mimeType, buffer, size: buffer.length, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error)) break;
      const base = retryDelay(attempt, options);
      await wait(error.code === 'PLM_IMAGE_HTTP_ERROR' ? retryAfterDelay(error.headers, base) : base);
    }
  }
  throw lastError || downloadError('PLM görseli alınamadı.', 'PLM_IMAGE_FAILED');
}

/* Sınırlı kuyruk. İptal bayrağı her görevin BAŞINDA okunur: yarım yazılmış
   veri kalmaz, çalışan indirmeler kendi güvenli noktasında biter. */
async function runBounded(items, worker, options = {}) {
  const queue = Array.isArray(items) ? items : [];
  const concurrency = Math.min(
    boundedConcurrency(options.concurrency, IMAGE_DOWNLOAD_CONCURRENCY),
    Math.max(1, queue.length),
  );
  let cursor = 0;
  let cancelled = false;
  const results = new Array(queue.length);

  async function run() {
    while (cursor < queue.length) {
      const index = cursor++;
      if (cancelled) { results[index] = { cancelled: true, item: queue[index] }; continue; }
      if (typeof options.isCancelled === 'function' && options.isCancelled()) {
        cancelled = true;
        results[index] = { cancelled: true, item: queue[index] };
        continue;
      }
      try { results[index] = { ok: true, item: queue[index], value: await worker(queue[index], index) }; }
      catch (error) {
        if (error && error.code === 'PLM_IMAGE_AUTH' && options.fatalOnAuth === true) { cancelled = true; results[index] = { ok: false, item: queue[index], error }; throw error; }
        results[index] = { ok: false, item: queue[index], error };
      }
      if (typeof options.onSettled === 'function') { try { options.onSettled(results[index], index, queue.length); } catch (_) {} }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return { results, cancelled };
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  RETRYABLE_STATUS,
  AUTH_STATUS,
  imageAgent,
  destroyImageAgent,
  sniffImageMime,
  contentTypeAcceptable,
  isRetryable,
  retryDelay,
  retryAfterDelay,
  httpGetImage,
  downloadImage,
  runBounded,
  downloadError,
};
