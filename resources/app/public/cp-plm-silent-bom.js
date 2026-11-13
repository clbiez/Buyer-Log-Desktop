'use strict';
/* Buyer Log — CP / Orders sessiz arka plan PLM BOM tazelemesi (zamanlayıcı).
 *
 * CP ve Orders'taki elle düzenlenemeyen `Artwork Detail` ve `Fabric (PLM)`
 * alanları kullanıcıya hissettirmeden güncel tutulur. Koleksiyon satırlarına
 * hiçbir şey yazılmaz; model dosyası, görsel, QTX ve LCW AI kapsam dışıdır.
 *
 * ESKİ MİMARİ KURULMAZ (açılışta görsel tamamlama ve "CP açılınca PLM numune
 * tazelemesi" uygulamayı yavaşlattığı için kaldırıldı):
 *   - Render veya modül açılışı tetiklemez. Tek tetikleyici bu zamanlayıcıdır:
 *     uygulama açılışından START_DELAY_MS sonra, kullanıcı IDLE_MS boyunca
 *     etkileşmediyse (ya da pencere gizliyse), çevrimiçiyken.
 *   - Günde en fazla bir tur: sunucu model başına bugünkü okumayı kaydeder;
 *     tur bitince ertesi güne kadar yeni istek yapılmaz.
 *   - Aynı anda tek parti (en fazla 100 model); sunucu BOM'u en fazla 2
 *     eşzamanlı okur. Partiler arasında yine boşta olma beklenir.
 *   - İstek window.BLPlmSilentRequest ile gider: Operasyon Merkezi/toast/giriş
 *     penceresi açılmaz, ağ yokken PLM'e gidilmez. Kullanıcının PLM işi
 *     sürüyorsa sunucu partiyi erteler; daha sonra sessizce denenir.
 *   - Sonuç yalnız değişen hücrelere yamanır (BLCPPlmDetails.applyIds).
 *   - Ayarlardan kapatılabilir (varsayılan açık); tercih bu cihazda saklanır.
 */
(function initCpPlmSilentBom(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && !root.BLCPPlmSilentBom) root.BLCPPlmSilentBom = api.install(root);
})(typeof window !== 'undefined' ? window : null, function createCpPlmSilentBomApi() {
  const START_DELAY_MS = 4 * 60 * 1000;
  const IDLE_MS = 60 * 1000;
  const IDLE_RECHECK_MS = 60 * 1000;
  const BATCH_GAP_MS = 5 * 1000;
  const RETRY_MS = { deferred: 5 * 60 * 1000, cancelled: 5 * 60 * 1000, offline: 10 * 60 * 1000, 'no-ids': 10 * 60 * 1000, 'no-token': 30 * 60 * 1000, auth: 30 * 60 * 1000, error: 30 * 60 * 1000 };
  const BATCH_SIZE = 100;
  const STORAGE_KEY = 'bl.cpPlmSilentBom.enabled';
  const PLAN_URL = '/api/plm-sync/bom/silent/plan';
  const RUN_URL = '/api/plm-sync/bom/silent/run';

  function msUntilNextDay(nowMs, extraMs) {
    const next = new Date(nowMs);
    next.setHours(24, 0, 0, 0);
    return Math.max(60 * 1000, next.getTime() - nowMs) + extraMs;
  }

  function createScheduler({
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
    isEnabled = () => true,
    isOnline = () => true,
    isIdle = () => true,
    getIds = () => [],
    planRequest,
    runRequest,
    applyChanged = async () => 0,
    startDelayMs = START_DELAY_MS,
  } = {}) {
    const state = { timer: null, running: false, stopped: false, queue: null, lastStatus: '' };

    function schedule(ms) {
      if (state.timer) clearTimer(state.timer);
      state.timer = null;
      if (state.stopped) return;
      state.timer = setTimer(() => { state.timer = null; void tick(); }, Math.max(0, ms));
    }

    async function tick() {
      if (state.running || state.stopped) return state.lastStatus;
      if (!isEnabled()) { state.queue = null; return (state.lastStatus = 'disabled'); } // setEnabled(true) yeniden kurar
      if (!isOnline()) { schedule(RETRY_MS.offline); return (state.lastStatus = 'offline'); }
      if (!isIdle()) { schedule(IDLE_RECHECK_MS); return (state.lastStatus = 'busy'); }
      state.running = true;
      try {
        if (!state.queue || !state.queue.length) {
          const ids = getIds();
          if (!Array.isArray(ids) || !ids.length) { state.queue = null; schedule(RETRY_MS['no-ids']); return (state.lastStatus = 'no-ids'); }
          const plan = await planRequest(ids);
          if (!plan || plan.completedToday || !Array.isArray(plan.due) || !plan.due.length) {
            state.queue = null;
            // Bugünkü tur bitti: ertesi gün, açılış gecikmesi kadar sonra yeniden bakılır.
            schedule(msUntilNextDay(now(), startDelayMs));
            return (state.lastStatus = 'done-today');
          }
          state.queue = plan.due.slice();
        }
        const batch = state.queue.slice(0, BATCH_SIZE);
        const result = await runRequest(batch);
        const status = String(result && result.status || 'error');
        if (status === 'done') {
          state.queue = state.queue.slice(batch.length);
          const changed = Array.isArray(result.changedIds) ? result.changedIds : [];
          if (changed.length) { try { await applyChanged(changed); } catch (_) {} }
          schedule(BATCH_GAP_MS);
        } else {
          // Ertelenen/iptal edilen parti: kuyruk yeniden planlanır (sunucu okunanları bilir).
          state.queue = null;
          schedule(RETRY_MS[status] || RETRY_MS.error);
        }
        return (state.lastStatus = status);
      } catch (error) {
        state.queue = null;
        const status = error && error.code === 'PLM_OFFLINE' ? 'offline' : error && error.code === 'PLM_BACKGROUND_DEFERRED' ? 'deferred' : 'error';
        schedule(RETRY_MS[status] || RETRY_MS.error);
        return (state.lastStatus = status);
      } finally {
        state.running = false;
      }
    }

    return {
      start() { state.stopped = false; schedule(startDelayMs); },
      stop() { state.stopped = true; if (state.timer) clearTimer(state.timer); state.timer = null; },
      // Kullanıcı yeniden açınca açılış kadar beklemeden, boşta olunca devam eder.
      resume() { if (!state.stopped && !state.timer && !state.running) schedule(IDLE_RECHECK_MS); },
      tick,
      status: () => ({ lastStatus: state.lastStatus, queued: state.queue ? state.queue.length : 0, scheduled: Boolean(state.timer), running: state.running }),
    };
  }

  function readEnabled(storage) {
    try { return storage.getItem(STORAGE_KEY) !== '0'; } catch (_) { return true; }
  }

  function install(root) {
    let lastInput = Date.now();
    const markInput = () => { lastInput = Date.now(); };
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => {
      try { root.addEventListener(type, markInput, { capture: true, passive: true }); } catch (_) {}
    });
    // Tercih kullanıcıya ayrılır (user-storage.js 'bl.cpPlmSilentBom.' öneki); BLStorage yoksa yerel depo.
    const storage = (() => { try { return root.BLStorage || root.localStorage; } catch (_) { return null; } })();
    const silentRequest = (url, plmIds) => {
      const request = root.BLPlmSilentRequest;
      if (typeof request !== 'function') return Promise.reject(Object.assign(new Error('silent request unavailable'), { code: 'PLM_SILENT_UNAVAILABLE' }));
      return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plmIds }) });
    };
    const scheduler = createScheduler({
      isEnabled: () => readEnabled(storage),
      isOnline: () => !(root.navigator && root.navigator.onLine === false),
      isIdle: () => Boolean(root.document && root.document.hidden) || Date.now() - lastInput >= IDLE_MS,
      getIds: () => { try { return root.BLCPPlmDetails && typeof root.BLCPPlmDetails.ids === 'function' ? root.BLCPPlmDetails.ids() : []; } catch (_) { return []; } },
      planRequest: ids => silentRequest(PLAN_URL, ids),
      runRequest: ids => silentRequest(RUN_URL, ids),
      applyChanged: ids => root.BLCPPlmDetails && typeof root.BLCPPlmDetails.applyIds === 'function' ? root.BLCPPlmDetails.applyIds(ids) : 0,
    });
    scheduler.start();
    return {
      isEnabled: () => readEnabled(storage),
      setEnabled(value) {
        try { if (storage) storage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (_) {}
        if (value) scheduler.resume();
      },
      status: scheduler.status,
    };
  }

  return { createScheduler, install, readEnabled, msUntilNextDay, START_DELAY_MS, IDLE_MS, BATCH_SIZE, STORAGE_KEY, RETRY_MS };
});
