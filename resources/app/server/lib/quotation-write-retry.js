'use strict';

/* FİYAT TALEBİ YAZIMLARINDA GEÇİCİ ÇEKİŞME.

   HTTP isteğinde eşzamanlı dosya kirası beklemesizdir (server.js →
   runWithNonblockingFileLeases): kira başka bir kurulumda / aynı süreçteki
   toplu fiyat aktarımında tutuluyorsa yazım anında SHARED_WRITE_BUSY ile,
   okuma ile kira arasında başka kurulum yazdıysa REVISION_CONFLICT ile döner.
   İkisi de gerçek bir iş çakışması değildir: istemci farklı satıra yazıyor
   olabilir. İstemci bu yanıtta satır değişikliğini kaybederdi.

   Rotanın yazımı saf bir "oku → uygula → yaz" işlemidir (quotations-store);
   her deneme taze durumu okur, satır revizyonu çakışmasını da yeniden
   değerlendirir. Bu yüzden aynı isteği kısa ve sınırlı geri çekilmeyle yeniden
   denemek güvenlidir. Yetki, doğrulama, bayat önizleme (expectedRevision ile
   açıkça istenen CAS) ve diğer hatalar hiç tekrarlanmaz; son hata aynen döner.
   Her deneme bütün belgeyi yeniden okur; büyük gövdeli tam kayıt (PUT/POST)
   rotaları bu yüzden daha az deneme kullanır. */

const RETRYABLE_CODES = new Set(['SHARED_WRITE_BUSY', 'REVISION_CONFLICT']);
/* Bütçe süreye bağlıdır, deneme sayısına değil. Yalnız deneme sayısıyla
   (12 deneme ≈ 2,2 sn) yük altındaki makinede kirayı tutan yazım uzadığında
   bütçe tükeniyor, eşzamanlı kullanıcının fiyat kaydı sahte 409 alıyordu
   (tam test paketinin CPU yükünde 20 kurulumlu testte yeniden üretildi).
   Süre sınırı makine hızından bağımsızdır; deneme sınırı yalnız emniyettir. */
const DEFAULT_ATTEMPTS = 60;
const DEFAULT_DEADLINE_MS = 8000;
const BASE_DELAY_MS = 15;
const MAX_DELAY_MS = 250;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withQuotationWriteRetry(work, { attempts = DEFAULT_ATTEMPTS, deadlineMs = DEFAULT_DEADLINE_MS, sleep = defaultSleep, random = Math.random, now = Date.now } = {}) {
  const limit = Math.max(1, Math.floor(Number(attempts) || 1));
  const deadline = now() + Math.max(0, Number(deadlineMs) || 0);
  for (let attempt = 1; ; attempt++) {
    try { return work(); }
    catch (error) {
      if (!error || !RETRYABLE_CODES.has(error.code) || attempt >= limit) throw error;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * (2 ** (attempt - 1))) + Math.floor(random() * BASE_DELAY_MS);
      if (now() + delay > deadline) throw error;
      await sleep(delay);
    }
  }
}

module.exports = { withQuotationWriteRetry, RETRYABLE_CODES, DEFAULT_DEADLINE_MS };
