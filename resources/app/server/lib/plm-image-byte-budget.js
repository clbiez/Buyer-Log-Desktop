'use strict';

// Bağımsız reservation yardımcısı; transport, commit veya worker başlatmaz.
// Root aynı instance'ı bütün sync işlerine enjekte etmelidir. Reservation RSS
// değildir. Buffer referansları bırakılmadan permit bırakılmaz. Aktif işin
// iptali otomatik refund yapmaz; transport/commit önce durmalı veya bitmelidir.
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function budgetError(code, message) {
  return Object.assign(new Error(message), { code });
}

function byteCount(value, name, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw budgetError('PLM_IMAGE_BUDGET_INVALID', `${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  }
  return value;
}

function cancelled() {
  return Object.assign(budgetError('PLM_IMAGE_BUDGET_CANCELLED', 'Byte budget admission cancelled'), { name: 'AbortError' });
}

function validateSignal(signal) {
  if (signal != null && (typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw budgetError('PLM_IMAGE_BUDGET_INVALID', 'signal must be an AbortSignal');
  }
}

function contentLengthBytes(value) {
  if (value == null || value === '') return null;
  // Node'un normalleştirilmiş tek Content-Length alanı beklenir. Bozuk veya
  // birleşik başlık bilinmeyen uzunluk gibi sessizce kabul edilmez.
  const number = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw budgetError('PLM_IMAGE_LENGTH_INVALID', 'Invalid Content-Length');
  }
  if (number === 0) throw budgetError('PLM_IMAGE_EMPTY', 'Empty image body');
  return number;
}

/**
 * Tam envelope baştan ayrılır; elde Buffer varken büyüyen permit beklenmez.
 * Bilinen uzunluk katıdır: transport her chunk öncesi ve EOF'ta kontrol eder.
 * Bilinmeyen uzunluk maxImageBytes ayırır. chunks + concat için iki gövde;
 * doğrulama/commit kopyaları çağıranın açık headroom sözleşmesidir. Sıfır ek
 * headroom yalnız bu aşamalar ek allocation yapmıyorsa uygundur. Base64 string,
 * decode, eski dosya okuması veya diğer scratch alanı ayrıca hesaba katılmalı.
 * Toplam tüm aşamaların konservatif toplamıdır; aşama geçişinde daraltılmaz.
 */
function planImageReservation({ contentLength, maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  validationCopyBytes = 0, commitCopyBytes = 0 } = {}) {
  byteCount(maxImageBytes, 'maxImageBytes');
  byteCount(validationCopyBytes, 'validationCopyBytes', true);
  byteCount(commitCopyBytes, 'commitCopyBytes', true);
  const length = contentLengthBytes(contentLength);
  if (length !== null && length > maxImageBytes) {
    throw budgetError('PLM_IMAGE_TOO_LARGE', 'Declared image exceeds per-image cap');
  }
  const bodyLimitBytes = length === null ? maxImageBytes : length;
  const totalBytes = byteCount(bodyLimitBytes * 2 + validationCopyBytes + commitCopyBytes, 'totalBytes');
  return Object.freeze({ contentLength: length, maxImageBytes, bodyLimitBytes,
    downloadCopyBytes: bodyLimitBytes, validationCopyBytes, commitCopyBytes, totalBytes });
}

function checkBodySize(plan, size, { complete = false } = {}) {
  byteCount(size, 'body size', true);
  if (size > plan.bodyLimitBytes || (complete && plan.contentLength !== null && size !== plan.contentLength)) {
    throw budgetError(plan.contentLength === null ? 'PLM_IMAGE_TOO_LARGE' : 'PLM_IMAGE_LENGTH_MISMATCH',
      'Image body exceeds cap or disagrees with Content-Length');
  }
  if (complete && size === 0) throw budgetError('PLM_IMAGE_EMPTY', 'Empty image body');
}

/**
 * Süreç ömürlü instance root'a aittir; job başına oluşturmak toplamı sınırlamaz.
 * Sıkı FIFO: küçük istekler büyük bekleyeni geçmez. Tek başına sığmayan istek
 * kuyruğa alınmaz; yalnız başına limitsiz çalıştırma istisnası yoktur.
 * Kuyruk Buffer değil yalnız istek metadata'sı tutar; dispatch ayrıca bounded
 * kalmalıdır. Reentrant acquire yasaktır: permit tutarken ikinci permit'i
 * beklemek caller deadlock'u yaratabilir. Tam envelope ile acquireImage kullan.
 */
function createByteBudget({ limitBytes } = {}) {
  byteCount(limitBytes, 'limitBytes');
  let reservedBytes = 0;
  let peakReservedBytes = 0;
  let activePermits = 0;
  const waiting = [];

  function drain() {
    while (waiting.length && waiting[0].bytes <= limitBytes - reservedBytes) {
      const entry = waiting.shift();
      entry.signal?.removeEventListener('abort', entry.onAbort);
      reservedBytes += entry.bytes;
      peakReservedBytes = Math.max(peakReservedBytes, reservedBytes);
      activePermits += 1;
      let released = false;
      entry.resolve(Object.freeze({ bytes: entry.bytes, release() {
        if (released) return false;
        released = true;
        reservedBytes -= entry.bytes;
        activePermits -= 1;
        drain();
        return true;
      } }));
    }
  }

  async function acquire(bytes, { signal } = {}) {
    byteCount(bytes, 'bytes');
    validateSignal(signal);
    if (signal?.aborted) throw cancelled();
    if (bytes > limitBytes) throw budgetError('PLM_IMAGE_BUDGET_EXCEEDED', 'Image reservation exceeds total byte budget');
    return new Promise((resolve, reject) => {
      const entry = { bytes, signal, resolve, onAbort: null };
      entry.onAbort = () => {
        const index = waiting.indexOf(entry);
        if (index === -1) return;
        waiting.splice(index, 1);
        signal.removeEventListener('abort', entry.onAbort);
        reject(cancelled());
        drain();
      };
      waiting.push(entry);
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      drain();
    });
  }

  async function acquireImage(options = {}) {
    const plan = planImageReservation(options);
    const permit = await acquire(plan.totalBytes, { signal: options.signal });
    return Object.freeze({ ...permit, plan, checkBodySize: (size, settings) => checkBodySize(plan, size, settings) });
  }

  async function withImage(options, callback) {
    if (typeof callback !== 'function') throw budgetError('PLM_IMAGE_BUDGET_INVALID', 'callback must be a function');
    const permit = await acquireImage(options);
    try {
      if (options?.signal?.aborted) throw cancelled();
      // Callback yalnız bütün async kullanıcıları settle edip Buffer'ları
      // bıraktıktan sonra dönmeli; sonuç Buffer değil küçük metadata olmalı.
      return await callback(permit);
    } finally {
      permit.release();
    }
  }

  return Object.freeze({ acquire, acquireImage, withImage,
    snapshot: () => Object.freeze({ limitBytes, reservedBytes, peakReservedBytes, activePermits, waitingCount: waiting.length }),
  });
}

module.exports = { createByteBudget, planImageReservation };
