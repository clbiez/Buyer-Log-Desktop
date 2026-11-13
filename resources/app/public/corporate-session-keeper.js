'use strict';
/* Buyer Log — kurumsal oturum koruyucu (PLM/CoreNectum + LCW AI; OAB HARİÇ).
 *
 * SORUN. Oturum düştüğünde (token süresi doldu, CoreNectum 401 verdi, ağ
 * gidip geldi) kullanıcı üst çubuktan "Bağlan" komutu vermek ya da bir PLM
 * işinin giriş penceresine takılmak zorundaydı; kalıcı SSO çerezleri dururken
 * bile.
 *
 * ÇÖZÜM. Koruyucu durumu yerel backend'den okur; oturum düşmüş, reddedilmiş ya
 * da bitmek üzereyse Electron'un GİZLİ, kalıcı SSO bölümüyle (interactive:false)
 * yeniden bağlanır. Pencere, toast veya giriş ekranı AÇILMAZ; sessiz deneme
 * başarısızsa geri çekilerek (backoff) sonra yeniden denenir. Ağ yokken hiç
 * denenmez; ağ geri gelince hemen denenir. Kullanıcı oturumu bilerek
 * kapattıysa o anahtar, kullanıcı yeniden bağlanana kadar durdurulur.
 *
 * Token/kimlik bilgisi bu dosyaya hiç girmez: Electron ana süreci token'ı
 * doğrudan backend belleğine yazar; renderer yalnız ok/başarısız görür.
 */
(function initCorporateSessionKeeper(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.BLCorporateSessionKeeper = api.install(root);
})(typeof window !== 'undefined' ? window : null, function createCorporateSessionKeeperApi() {
  const KEYS = ['plm', 'lcwai'];
  // Bitişe bu kadar kala sessiz yenileme yapılır (iş ortasında düşmesin).
  const REFRESH_BEFORE_MS = 10 * 60 * 1000;
  // Başarısız sessiz denemeler arasında artan bekleme; en fazla 30 dk.
  const BACKOFF_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
  const TICK_MS = 60 * 1000;
  const MIN_CHECK_GAP_MS = 15 * 1000;
  const STARTUP_FALLBACK_MS = 20 * 1000;

  function needsRenewal(status, now) {
    if (!status || typeof status !== 'object') return false;
    if (!status.connected || status.rejected || status.expired) return true;
    const expiresAt = status.expiresAt ? Date.parse(status.expiresAt) : NaN;
    return Number.isFinite(expiresAt) && expiresAt - now <= REFRESH_BEFORE_MS;
  }

  function createKeeper({ keys = KEYS, now = () => Date.now(), isOnline = () => true, readStatus, reconnect, onChange = () => {} } = {}) {
    const state = new Map(keys.map(key => [key, { failures: 0, nextAt: 0, inFlight: null, paused: false, authFailed: false }]));

    async function attempt(key, entry) {
      let ok = false;
      try { ok = Boolean(await reconnect(key)); } catch (_) { ok = false; }
      if (ok) {
        entry.failures = 0; entry.nextAt = 0; entry.authFailed = false;
        try { onChange(key, 'reconnected'); } catch (_) {}
        return 'reconnected';
      }
      entry.failures += 1;
      entry.nextAt = now() + BACKOFF_MS[Math.min(entry.failures - 1, BACKOFF_MS.length - 1)];
      return 'failed';
    }

    async function check(key, { force = false } = {}) {
      const entry = state.get(key);
      if (!entry) return 'unsupported';
      if (entry.paused) return 'paused';
      if (entry.inFlight) return 'busy';
      if (!isOnline()) return 'offline';
      let status = null;
      try { status = await readStatus(key); } catch (_) { status = null; }
      if (!status) return 'unknown';
      if (entry.paused) return 'paused';
      if (entry.inFlight) return 'busy';
      if (!entry.authFailed && !needsRenewal(status, now())) {
        entry.failures = 0; entry.nextAt = 0;
        return 'healthy';
      }
      if (!force && now() < entry.nextAt) return 'waiting';
      const task = attempt(key, entry);
      entry.inFlight = task;
      try { return await task; } finally { if (entry.inFlight === task) entry.inFlight = null; }
    }

    async function checkAll(options) {
      const results = {};
      // Sırayla: iki gizli SSO penceresi aynı anda açılmasın.
      for (const key of keys) results[key] = await check(key, options);
      return results;
    }

    return {
      check,
      checkAll,
      /* Ağ geri geldi: bekleme süreleri beklenmeden hemen denenir. */
      networkRestored() {
        for (const entry of state.values()) entry.nextAt = 0;
        return checkAll({ force: true });
      },
      /* Bir istek yetki reddi gördü: durum sağlıklı görünse de yenile. */
      reportAuthFailure(key) { const entry = state.get(key); if (entry) entry.authFailed = true; },
      pause(key) { const entry = state.get(key); if (entry) entry.paused = true; },
      resume(key) { const entry = state.get(key); if (entry) { entry.paused = false; entry.failures = 0; entry.nextAt = 0; } },
      settle(key) { const entry = state.get(key); return Promise.resolve(entry && entry.inFlight).then(() => undefined, () => undefined); },
      canAttempt(key) { const entry = state.get(key); return Boolean(entry && !entry.paused && now() >= entry.nextAt); },
    };
  }

  function install(root) {
    const desktop = root.buyerLogDesktop || null;
    const keys = KEYS.filter(key => key === 'plm'
      ? Boolean(desktop && typeof desktop.ensureCoreNectumAuth === 'function')
      : Boolean(desktop && typeof desktop.ensureLcwAiAuth === 'function'));

    async function getJson(url) {
      const response = await root.fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      return data && data.ok !== false ? data : null;
    }
    async function readStatus(key) {
      if (key === 'plm') {
        const data = await getJson('/api/corenectum-api/status');
        const status = data && data.status;
        if (!status) return null;
        // Ortam değişkeniyle verilen token Buyer Log'un yenileyebileceği bir oturum değildir.
        if (status.source === 'environment') return { connected: true };
        return { connected: Boolean(status.configured), expired: Boolean(status.expired), rejected: Boolean(status.rejected), expiresAt: status.expiresAt || '' };
      }
      // refresh=0: durum okuması tarayıcıya/sekmeye dokunmaz.
      const data = await getJson('/api/lcwai/status?refresh=0');
      const status = data && data.status;
      if (!status) return null;
      if (status.loginInProgress) return { connected: true };
      return { connected: Boolean(status.connected), expiresAt: status.expiresAt || '' };
    }
    async function reconnect(key) {
      const result = key === 'plm'
        ? await desktop.ensureCoreNectumAuth({ interactive: false, reason: 'session-keeper' })
        : await desktop.ensureLcwAiAuth({ interactive: false });
      return Boolean(result && result.ok);
    }
    const isOnline = () => !(root.navigator && root.navigator.onLine === false);
    const keeper = createKeeper({
      keys, isOnline, readStatus, reconnect,
      onChange: (key, kind) => {
        try { root.dispatchEvent(new root.CustomEvent('bl:corporate-session-' + kind, { detail: { key } })); } catch (_) {}
      },
    });
    if (!keys.length) return keeper;

    let started = false;
    let lastCheckAt = 0;
    const hidden = () => Boolean(root.document && root.document.hidden);
    const run = (force = false) => {
      if (!started) return;
      const at = Date.now();
      if (!force && at - lastCheckAt < MIN_CHECK_GAP_MS) return;
      lastCheckAt = at;
      void keeper.checkAll().catch(() => {});
    };
    const start = () => {
      if (started) return;
      started = true;
      run(true);
    };
    // Açılış ağır işlerini beklemek için ilk kontrol startup sonrasıdır.
    if (root.BL_STARTUP_COMPLETE) root.setTimeout(start, 0);
    else root.addEventListener('bl:startup-complete', start, { once: true });
    root.setTimeout(start, STARTUP_FALLBACK_MS);
    // Simge durumundayken arka planda gizli giriş penceresi açılmaz; görünür olunca hemen kontrol.
    root.setInterval(() => { if (!hidden()) run(false); }, TICK_MS);
    if (root.document) root.document.addEventListener('visibilitychange', () => { if (!hidden()) run(false); });
    root.addEventListener('focus', () => run(false));
    root.addEventListener('online', () => { if (started) { lastCheckAt = Date.now(); void keeper.networkRestored().catch(() => {}); } });
    return keeper;
  }

  return { createKeeper, install, needsRenewal, KEYS, REFRESH_BEFORE_MS, BACKOFF_MS };
});
