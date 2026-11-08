'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MiB = 1024 * 1024;
const IMAGE_BYTES = 20 * MiB;
// Akış parçaları + birleştirilmiş sonuç. Content-Length eksik/yanlış olsa da
// azami boyutu ayır: parçalı rezervasyon artırımı okuyucuları kilitleyebilir.
const DOWNLOAD_BYTES = 2 * IMAGE_BYTES;
// Kanonik commit senkron çalışır ve kayıtları tek tek tüketir. İki geçici
// görseli, mevcut orijinali (user-data: 50 MiB), UTF-16 base64 kopyasını
// (ceil(20 MiB / 3) * 4 * 2) ve saveCollectionImage'ın çözdüğü kopyayı kapsar:
// toplam < 192 MiB. Bunlar uygulama bayt rezervasyonlarıdır; süreç RSS'i, GC,
// ağ tamponları, nesne metadata'sı ve ilgisiz tüketiciler için tavan değildir.
const COMMIT_BYTES = 192 * MiB;
const PROCESS_BYTES = 256 * MiB;

function cancelledError() {
  return Object.assign(new Error('PLM görsel işlemi durduruldu. / PLM image operation cancelled.'), { code: 'PLM_JOB_CANCELLED' });
}

function createByteBudget(limit = PROCESS_BYTES) {
  let used = 0;
  let peak = 0;
  const waiting = [];
  function drain() {
    while (waiting.length) {
      const next = waiting[0];
      if (next.isCancelled()) {
        waiting.shift();
        clearInterval(next.timer);
        next.reject(cancelledError());
        continue;
      }
      if (used + next.bytes > limit) break;
      waiting.shift();
      clearInterval(next.timer);
      used += next.bytes;
      peak = Math.max(peak, used);
      let released = false;
      next.resolve({ release() {
        if (released) return;
        released = true;
        used -= next.bytes;
        drain();
      } });
    }
  }
  return {
    acquire(bytes, isCancelled = () => false) {
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limit) {
        return Promise.reject(new RangeError('Geçersiz PLM görsel bayt rezervasyonu. / Invalid PLM image byte reservation.'));
      }
      return new Promise((resolve, reject) => {
        const next = { bytes, isCancelled, resolve, reject, timer: null };
        // Mevcut çağıranlar AbortSignal yerine koşul verir. Kuyrukta iptali
        // yokla; iptal başka bir işin permit bırakmasını beklemesin.
        next.timer = setInterval(() => {
          if (!isCancelled()) return;
          const index = waiting.indexOf(next);
          if (index !== -1) waiting.splice(index, 1);
          clearInterval(next.timer);
          reject(cancelledError());
          drain();
        }, 25);
        waiting.push(next);
        drain();
      });
    },
    snapshot: () => ({ limit, used, peak, waiting: waiting.length }),
  };
}

// Bu Node sürecindeki kullanıcı/işler tüm runPlmImageSync çağrılarında paylaşır.
const imageByteBudget = createByteBudget();

async function createImageStaging() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'buyerlog-plm-int03-'));
  await fs.promises.chmod(directory, 0o700);
  let sequence = 0;
  let cachedPath = '';
  let cachedBuffer = null;
  return {
    async write(image) {
      const buffer = image && image.buffer;
      if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > IMAGE_BYTES) {
        throw Object.assign(new Error('PLM görseli boş veya geçici depolama boyut sınırını aşıyor. / PLM image is empty or exceeds the staging byte limit.'), {
          code: buffer && buffer.length > IMAGE_BYTES ? 'PLM_IMAGE_TOO_LARGE' : 'PLM_IMAGE_EMPTY',
        });
      }
      const file = path.join(directory, String(sequence++));
      await fs.promises.writeFile(file, buffer, { flag: 'wx', mode: 0o600 });
      return { file, size: buffer.length, mimeType: image.mimeType };
    },
    entry(item, staged) {
      // Kanonik kayıt dizisi arayüzünü koru. Yalnız buffer tembeldir; ingest
      // bunu kayıt başına try/catch içinde okur. İki okuma aynı Buffer döndürür.
      // Önbellek birikmez, değiştirilir. Tek son commit; iş çapında hash
      // dedup, geri alma ve silme sırasını korur.
      return Object.defineProperty({ ...item, mimeType: staged.mimeType }, 'buffer', {
        enumerable: true,
        get() {
          if (cachedPath !== staged.file) {
            cachedBuffer = null;
            cachedPath = '';
            const size = fs.statSync(staged.file).size;
            if (size !== staged.size || size > IMAGE_BYTES) {
              throw Object.assign(new Error('Geçici PLM görselinin boyutu değişti. / PLM staged image size changed.'), { code: 'PLM_IMAGE_STAGING_CHANGED' });
            }
            cachedBuffer = fs.readFileSync(staged.file);
            cachedPath = staged.file;
          }
          return cachedBuffer;
        },
      });
    },
    async close() {
      cachedBuffer = null;
      cachedPath = '';
      await fs.promises.rm(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { IMAGE_BYTES, DOWNLOAD_BYTES, COMMIT_BYTES, PROCESS_BYTES, createByteBudget, imageByteBudget, createImageStaging };
