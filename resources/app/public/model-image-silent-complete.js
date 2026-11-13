/* SESSİZ EKSİK GÖRSEL TAMAMLAMA (ürün sahibi kararı, 7.0.250 kuralının
 * bilinçli güncellemesi).
 *
 * 7.0.250'de açılışta otomatik görsel tamamlama kaldırılmıştı: tetikleyici
 * RENDER/HÜCRE idi; her açılış, filtre ve kaydırma yeni bir PLM isteği
 * doğuruyordu. Bu modül o mimariyi KURMAZ:
 *
 *   - Tek zamanlayıcı. Render, hücre, gözlemci veya kaydırma istek
 *     başlatmaz; yalnız bu modülün kendi zamanlayıcısı karar verir.
 *   - Yalnız boştayken: kullanıcı `quietMs` boyunca etkileşimde değilse ve
 *     tarayıcı boşta kaldığında (requestIdleCallback; zaman aşımıyla gelen
 *     geri çağrı "meşgul" sayılır ve tur atlanır).
 *   - Aynı anda tek iş, küçük paket (`batchSize`), görünür satırlar önce.
 *   - Negatif önbellek: görseli bulunamayan kimlik `negativeTtlMs` (24 sa)
 *     boyunca yeniden istenmez; kalıcıdır, açılıştan açılışa aynı boş istek
 *     gitmez. Aynı görünümde bir kez denenen kimlik o görünümde tekrar denenmez.
 *   - Görünüm jetonu: cevap geldiğinde görünüm değiştiyse hücre yaması
 *     yapılmaz; kanonik kayıt yine uygulanır (sunucu zaten kaydetti).
 *   - Kullanıcı işi önce: sunucu 409 PLM_BACKGROUND_DEFERRED dönerse sessizce
 *     geri çekilinir. Toast, pencere, Operasyon Merkezi veya ilerleme YOK.
 *
 * Modül saftır: DOM, ağ, saat ve depolama enjekte edilir (birim testi gerçek
 * zaman kullanmaz). Uygulama bağlantısı app-main.js model varlık bölümündedir.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLSilentImageCompleteFactory = factory();
})(typeof window !== 'undefined' ? window : globalThis, function silentImageCompleteFactory() {
  'use strict';

  const NEGATIVE_KEY = 'bl.modelImages.silentNegative.v1';
  const ENABLED_KEY = 'bl.modelImages.silentComplete.v1';
  const DEFAULTS = Object.freeze({
    batchSize: 12,
    quietMs: 3000,
    intervalMs: 5000,
    deferredBackoffMs: 30000,
    errorBackoffMs: 5 * 60 * 1000,
    // Oturum yoksa sessiz iş giriş istemez; oturum koruyucu kendi geri
    // çekilmesiyle yeniler. Bu sürede aynı yetkisiz istek tekrarlanmaz.
    authBackoffMs: 30 * 60 * 1000,
    negativeTtlMs: 24 * 60 * 60 * 1000,
    negativeLimit: 5000,
    idleTimeoutMs: 2000,
  });

  const clean = value => String(value == null ? '' : value).trim();

  function readJson(storage, key, fallback) {
    try { const raw = storage && storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }
  function writeJson(storage, key, value) {
    try { if (storage) storage.setItem(key, JSON.stringify(value)); } catch (_) { /* kota/özel pencere: yalnız bellek */ }
  }

  /* Ayar: varsayılan AÇIK. Yalnız açıkça '0' yazılmışsa kapalıdır. */
  function readEnabled(storage) {
    try { return clean(storage && storage.getItem(ENABLED_KEY)) !== '0'; } catch (_) { return true; }
  }
  function writeEnabled(storage, enabled) {
    try { if (storage) storage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (_) { /* bellek */ }
  }

  function createSilentImageCompleter(deps = {}) {
    const options = { ...DEFAULTS, ...(deps.options || {}) };
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const setTimer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = deps.clearTimeout || (id => clearTimeout(id));
    const idle = typeof deps.requestIdle === 'function'
      ? deps.requestIdle
      : (cb, opts) => setTimer(() => cb({ didTimeout: false, timeRemaining: () => 8 }), Math.min(50, (opts && opts.timeout) || 50));
    const storage = deps.storage || null;
    const isEnabled = typeof deps.isEnabled === 'function' ? deps.isEnabled : () => readEnabled(storage);
    const isOnline = typeof deps.isOnline === 'function' ? deps.isOnline : () => true;
    const isHidden = typeof deps.isHidden === 'function' ? deps.isHidden : () => false;
    // Uygulama meşgul (ör. modül verisi yükleniyor): sessiz iş onunla yarışmaz.
    const isBusy = typeof deps.isBusy === 'function' ? deps.isBusy : () => false;
    const collect = typeof deps.collect === 'function' ? deps.collect : () => null;
    const request = typeof deps.request === 'function' ? deps.request : null;
    const apply = typeof deps.apply === 'function' ? deps.apply : () => {};
    const isResolved = typeof deps.isResolved === 'function' ? deps.isResolved : () => false;

    let timer = 0;
    let running = false;
    let started = false;
    let inFlight = null;
    let lastInteraction = -Infinity;
    let backoffUntil = 0;
    let viewToken = '';
    let attempted = new Set();
    const stats = { ticks: 0, requests: 0, items: 0, resolved: 0, negative: 0, deferred: 0, errors: 0, skippedBusy: 0, skippedStale: 0 };

    /* Negatif önbellek: { key: untilMs }. Süresi dolanlar okurken düşer. */
    let negative = (() => {
      const raw = readJson(storage, NEGATIVE_KEY, {});
      const out = new Map();
      const at = now();
      if (raw && typeof raw === 'object') for (const [key, until] of Object.entries(raw)) if (Number(until) > at) out.set(key, Number(until));
      return out;
    })();
    function persistNegative() {
      while (negative.size > options.negativeLimit) negative.delete(negative.keys().next().value);
      writeJson(storage, NEGATIVE_KEY, Object.fromEntries(negative));
    }
    function isNegative(key) {
      const until = negative.get(key);
      if (!until) return false;
      if (until > now()) return true;
      negative.delete(key);
      return false;
    }

    function schedule(delay) {
      if (!started) return;
      if (timer) clearTimer(timer);
      timer = setTimer(() => { timer = 0; tick(); }, Math.max(0, Number(delay) || 0));
    }

    function backOff(code) {
      if (code === 'PLM_BACKGROUND_DEFERRED' || code === 'MODEL_IMAGE_IMPORT_BUSY' || code === 'PLM_OFFLINE' || code === 'PLM_JOB_CANCELLED') {
        stats.deferred += 1; backoffUntil = now() + options.deferredBackoffMs;
      } else if (/AUTH|TOKEN|LOGIN|SESSION|UNAUTHORI[SZ]ED/i.test(code)) {
        stats.errors += 1; backoffUntil = now() + options.authBackoffMs;
      } else {
        stats.errors += 1; backoffUntil = now() + options.errorBackoffMs;
      }
    }

    function skip(identity) {
      const key = clean(identity && identity.key);
      return !key || attempted.has(key) || isNegative(key);
    }

    function tick() {
      stats.ticks += 1;
      if (running || inFlight) return;
      if (!isEnabled() || isHidden() || !isOnline()) { schedule(options.intervalMs); return; }
      if ((() => { try { return Boolean(isBusy()); } catch (_) { return true; } })()) { stats.skippedBusy += 1; schedule(options.intervalMs); return; }
      const at = now();
      if (at < backoffUntil) { schedule(backoffUntil - at); return; }
      const quietLeft = lastInteraction + options.quietMs - at;
      if (quietLeft > 0) { schedule(quietLeft); return; }
      running = true;
      idle(deadline => {
        running = false;
        // Zaman aşımıyla gelen geri çağrı: tarayıcı meşgul. Bu turu atla.
        if (deadline && deadline.didTimeout) { stats.skippedBusy += 1; schedule(options.intervalMs); return; }
        if (now() - lastInteraction < options.quietMs) { schedule(options.quietMs); return; }
        void runBatch();
      }, { timeout: options.idleTimeoutMs });
    }

    async function runBatch() {
      let scope = null;
      try { scope = collect({ limit: options.batchSize, skip }); } catch (_) { scope = null; }
      if (!scope || !Array.isArray(scope.identities)) { schedule(options.intervalMs); return; }
      const token = clean(scope.viewToken);
      if (token !== viewToken) { viewToken = token; attempted = new Set(); }
      const batch = [];
      for (const identity of scope.identities) {
        if (batch.length >= options.batchSize) break;
        if (skip(identity)) continue;
        batch.push(identity);
      }
      if (!batch.length || !request) { schedule(options.intervalMs); return; }
      batch.forEach(identity => attempted.add(identity.key));
      const isStillCurrent = typeof scope.isStillCurrent === 'function' ? scope.isStillCurrent : () => true;
      stats.requests += 1; stats.items += batch.length;
      inFlight = (async () => {
        let data = null;
        try {
          data = await request(batch.map(identity => identity.item), { contextType: clean(scope.contextType) });
        } catch (error) {
          // Deneme sayılmaz: kimlikler sonra yeniden denenebilir.
          batch.forEach(identity => attempted.delete(identity.key));
          backOff(clean(error && error.code));
          return;
        }
        const current = (() => { try { return Boolean(isStillCurrent()); } catch (_) { return false; } })();
        if (!current) stats.skippedStale += 1;
        try { apply(data, { identities: batch, current }); } catch (_) { /* yama hatası sessiz */ }
        /* Üst kaynak (PLM) bu turda hiç denenmediyse (oturum yok, kullanıcı işi
           sessiz işi durdurdu) çözülemeyen kimlik "bulunamadı" SAYILMAZ; yerel
           sonuç yine uygulanmıştır. Başka bir örnek kimliği işliyorsa da aynı. */
        const deferredCode = clean(data && data.upstreamDeferred && data.upstreamDeferred.code);
        if (deferredCode) backOff(deferredCode);
        const waiting = deferredCode ? 1 : Number(data && data.distribution && data.distribution.waitingOtherInstance) || 0;
        let changed = false;
        for (const identity of batch) {
          let ok = false;
          try { ok = Boolean(isResolved(identity)); } catch (_) { ok = false; }
          if (ok) { stats.resolved += 1; if (negative.delete(identity.key)) changed = true; continue; }
          if (waiting) { attempted.delete(identity.key); continue; }
          negative.delete(identity.key);
          negative.set(identity.key, now() + options.negativeTtlMs);
          stats.negative += 1; changed = true;
        }
        if (changed) persistNegative();
      })().finally(() => { inFlight = null; schedule(options.intervalMs); });
      await inFlight;
    }

    function start() {
      if (started) return api;
      started = true;
      schedule(options.intervalMs);
      return api;
    }
    function stop() {
      started = false;
      if (timer) clearTimer(timer);
      timer = 0;
      return api;
    }
    /* Etkileşim yalnız bir zaman damgası yazar; istek BAŞLATMAZ. */
    function notifyInteraction() { lastInteraction = now(); }
    function clearNegative() { negative = new Map(); persistNegative(); }

    const api = {
      start, stop, notifyInteraction, clearNegative,
      isNegative, tick,
      pending: () => inFlight,
      stats: () => ({ ...stats, negativeSize: negative.size, started, inFlight: Boolean(inFlight), viewToken }),
    };
    return api;
  }

  return { createSilentImageCompleter, readEnabled, writeEnabled, DEFAULTS, NEGATIVE_KEY, ENABLED_KEY };
});
