'use strict';

/*
 * PLM işlerinde "önce kullanıcı" kuralı.
 *
 * Sessiz (arka plan) PLM işi kullanıcıya hissettirilmemelidir; bu yalnız
 * görünmez olmakla değil, kullanıcının işine YOL VERMEKLE sağlanır:
 *   1. Kullanıcı bir PLM işini elle başlatınca o kullanıcının çalışan sessiz
 *      işleri iptal istenir. Döngüler bir sonraki kontrol noktasında durur ve
 *      o ana kadarki sonucu kaydeder (iş kaybolmaz).
 *   2. Ortak kilidi (ör. görsel içe aktarma) sessiz bir iş tutuyorsa kullanıcı
 *      işi 409 almaz; kilidin bırakılmasını SINIRLI süre bekler. Sessiz iş
 *      bu sürede bırakmazsa eski davranış (meşgul hatası) aynen korunur.
 *   3. Kullanıcının elle başlattığı bir PLM işi sürerken sessiz iş başlamaz;
 *      PLM_BACKGROUND_DEFERRED ile reddedilir, istemci daha sonra dener.
 *   4. Sessiz iş hiçbir zaman başkasının arkasında beklemez.
 *
 * Sessiz istek, istemcinin "X-BuyerLog-Auth-Mode: silent" başlığıyla tanınır
 * (public/plm-auth-recovery.js ve plmSilentJsonRequest ile aynı sözleşme).
 * Modül saftır: kayıt, uyku ve saat enjekte edilir; testte gerçek zaman yoktur.
 */

const SILENT_HEADER = 'x-buyerlog-auth-mode';

function busyError(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function createPlmPriority({ jobs, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now(), waitMs = 20000, pollMs = 150 } = {}) {
  function isBackgroundRequest(req) {
    try { return String(req && req.headers && req.headers[SILENT_HEADER] || '').trim().toLowerCase() === 'silent'; }
    catch (_) { return false; }
  }

  function deferred() {
    return busyError('Kullanıcının PLM işi sürüyor; arka plan işi daha sonra denenecek.', 'PLM_BACKGROUND_DEFERRED');
  }

  /* İş başlamadan çağrılır. Sessiz iş: kullanıcı işi varsa reddedilir.
     Kullanıcı işi: sessiz işler durdurulur; iptal istenen iş kimlikleri döner. */
  function admit(userId, { background = false } = {}) {
    if (background) {
      if (jobs.hasForeground(userId)) throw deferred();
      return [];
    }
    return jobs.cancelBackground(userId);
  }

  async function withLock(locks, key, { background = false, busyMessage = 'Başka bir PLM işlemi devam ediyor.', busyCode = 'PLM_OPERATION_BUSY', onWait } = {}, fn) {
    const lockKey = String(key || 'moderator');
    const holder = locks.get(lockKey);
    if (holder) {
      if (background) throw deferred();
      if (!holder.background) throw busyError(busyMessage, busyCode);
      jobs.cancelBackground(lockKey);
      try { if (typeof onWait === 'function') onWait(); } catch (_) {}
      const deadline = now() + waitMs;
      while (locks.has(lockKey)) {
        // Kilit bu arada başka bir KULLANICI işine geçtiyse eski meşgul kuralı geçerlidir.
        const current = locks.get(lockKey);
        if (now() >= deadline || (current && !current.background)) throw busyError(busyMessage, busyCode);
        await sleep(pollMs);
      }
    }
    locks.set(lockKey, { background: Boolean(background) });
    try { return await fn(); }
    finally { locks.delete(lockKey); }
  }

  return { isBackgroundRequest, admit, withLock };
}

module.exports = { createPlmPriority, SILENT_HEADER };
