'use strict';

/*
 * LCW AI masaüstü (arka plan) oturumu — PLM Sync ile aynı desen.
 *
 * Electron ana süreci LCW AI'ı kalıcı ve ayrılmış bir oturum bölümünde
 * (persist:buyerlog-lcwai-auth) GİZLİ pencerede açar; kurumsal SSO çerezleri
 * o bölümde kalıcı olduğundan token kullanıcı tarayıcı görmeden yenilenir.
 * Pencere yalnız gerçekten giriş gerekiyorsa görünür (bkz. electron/main.js
 * acquireLcwAiToken). Token masaüstü köprüsüyle (rastgele süreç sırrı) bu
 * modüle verilir ve YALNIZ süreç belleğinde tutulur: diske, log'a,
 * renderer'a gitmez.
 *
 * createDesktopAwareProvider(): önce masaüstü token'ı, yoksa mevcut Edge/CDP
 * yolu. Masaüstü kipi bir kez kullanıldıysa, reddedilen token için Edge'e
 * düşülmez (görünür sekme açmamak için); renderer sessiz yenilemeyi
 * masaüstü kabuğuna yaptırır.
 */
const { validateAccessToken } = require('./lcwai-auth');
const { lcwAiError } = require('./lcwai-errors');

function createDesktopTokenHolder({ now = () => Date.now() } = {}) {
  let token = '';
  let used = false;
  return {
    set(value) {
      const raw = String(value == null ? '' : value).replace(/^bearer\s+/i, '').trim();
      const check = validateAccessToken(raw, { now: now() });
      if (!check.ok) throw lcwAiError(check.reason === 'expired' ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED', { detail: `desktop-${check.reason}` });
      token = raw;
      used = true;
      return { ok: true, expiresAt: check.expiresAtMs ? new Date(check.expiresAtMs).toISOString() : null };
    },
    clear() { token = ''; return { ok: true }; },
    get() { return token && validateAccessToken(token, { now: now() }).ok ? token : ''; },
    get desktopMode() { return used; },
  };
}

function createDesktopAwareProvider({ holder, fallback }) {
  return {
    passiveAvailable: () => Boolean(holder.get()),
    async readToken(ownerId, options = {}) {
      const token = holder.get();
      const fingerprint = typeof options.fingerprint === 'function' ? options.fingerprint : () => '';
      if (token && (!options.avoidFingerprint || fingerprint(token) !== options.avoidFingerprint) && (!options.isUsable || options.isUsable(token))) {
        return { token, source: 'desktop-sso' };
      }
      if (holder.desktopMode) throw lcwAiError('SESSION_EXPIRED', { detail: 'desktop-refresh-required' });
      if (!fallback || typeof fallback.readToken !== 'function') throw lcwAiError('AUTH_REQUIRED');
      return fallback.readToken(ownerId, options);
    },
    async login(ownerId, options = {}) {
      const token = holder.get();
      if (token && (!options.isUsable || options.isUsable(token))) return { token, source: 'desktop-sso' };
      if (!fallback || typeof fallback.login !== 'function') throw lcwAiError('BROWSER_UNAVAILABLE');
      return fallback.login(ownerId, options);
    },
  };
}

let defaultHolder = null;
function getDesktopTokenHolder() {
  if (!defaultHolder) defaultHolder = createDesktopTokenHolder();
  return defaultHolder;
}

module.exports = { createDesktopTokenHolder, createDesktopAwareProvider, getDesktopTokenHolder };
