'use strict';

/* Oturum açma/yenileme mevcut Electron köprüsünden istenir. Token yanıtla
 * dönmez; Electron onu mevcut lcwai-token köprüsüyle sunucu belleğine verir. */
const { lcwAiError, isLcwAiError } = require('./lcwai-errors');

function createDesktopAuthRelay({ env = process.env, fetch: fetchImpl = (...args) => fetch(...args) } = {}) {
  let inFlight = null;
  function url() {
    const value = String(env.BUYER_LOG_DESKTOP_AUTH_RELAY_URL || '');
    return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value) ? value : '';
  }
  function configured() { return Boolean(url() && env.BUYER_LOG_DESKTOP_BRIDGE_SECRET); }
  function desktopMode() { return Boolean(env.BUYER_LOG_DESKTOP_BRIDGE_SECRET); }

  async function request({ interactive = false, avoidFingerprint = '' } = {}) {
    if (!configured()) throw lcwAiError('BROWSER_UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), interactive ? 305000 : 15000);
    try {
      const response = await fetchImpl(url() + '/lcwai/auth', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-BuyerLog-Desktop-Bridge': env.BUYER_LOG_DESKTOP_BRIDGE_SECRET },
        body: JSON.stringify({ interactive: interactive === true, avoidFingerprint }),
      });
      const data = await response.json();
      if (!response.ok) throw lcwAiError('BROWSER_UNAVAILABLE');
      if (data && data.ok === true) return { ok: true };
      const codes = { LCWAI_SIGNIN_REQUIRED: 'AUTH_REQUIRED', LCWAI_AUTH_CANCELLED: 'CANCELLED', LCWAI_LOGIN_TIMEOUT: 'LOGIN_TIMEOUT', LCWAI_NETWORK: 'NETWORK' };
      throw lcwAiError(codes[data && data.code] || 'SESSION_EXPIRED');
    } catch (error) {
      if (isLcwAiError(error)) throw error;
      throw lcwAiError('BROWSER_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  function ensureAuth(options = {}) {
    // Tek Electron oturumu: eşzamanlı işler ikinci bir giriş başlatmaz.
    // Etkileşimli istek sessiz denemeyi beklediyse gerekirse kendisi yükseltir.
    if (inFlight) return inFlight.then(() => ({ ok: true }), error => {
      if (options.interactive && error.code === 'LCWAI_AUTH_REQUIRED') return ensureAuth(options);
      throw error;
    });
    const pending = request(options).finally(() => { if (inFlight === pending) inFlight = null; });
    inFlight = pending;
    return pending;
  }
  return { configured, desktopMode, ensureAuth };
}

module.exports = { createDesktopAuthRelay };
