'use strict';

(function initPlmAuthRecovery(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.BLPlmAuthRecovery = api;
    api.install(root);
  }
})(typeof window !== 'undefined' ? window : null, function createPlmAuthRecovery() {
  const AUTH_CODES = new Set([
    'CORENECTUM_API_TOKEN_INVALID',
    'CORENECTUM_API_TOKEN_REQUIRED',
    'CORENECTUM_LOGIN_REQUIRED',
    'CORENECTUM_SIGNIN_REQUIRED',
    'CORENECTUM_AUTH_REQUIRED',
  ]);

  const PROTECTED_PATHS = [
    /^\/api\/plm-sync(?:\/|$)/,
    /^\/api\/plm-style-links(?:\/|$)/,
    /^\/api\/corenectum-api(?:\/|$)/,
    /^\/api\/model-images\/import-plm(?:\/|$)/,
  ];

  let recoveryInFlight = null;

  function authCodeFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const candidates = [
      payload.code,
      payload.details && payload.details.code,
      payload.cause && payload.cause.code,
      payload.error && typeof payload.error === 'object' && payload.error.code,
    ];
    for (const value of candidates) {
      const code = String(value || '').trim().toUpperCase();
      if (AUTH_CODES.has(code)) return code;
    }
    return '';
  }

  function isProtectedPlmPath(pathname) {
    const value = String(pathname || '');
    return PROTECTED_PATHS.some(pattern => pattern.test(value));
  }

  function requestUrl(input, baseHref) {
    try {
      if (input && typeof input === 'object' && input.url) {
        return new URL(String(input.url), baseHref);
      }
      return new URL(String(input || ''), baseHref);
    } catch (_) {
      return null;
    }
  }

  function isProtectedPlmRequest(input, baseHref, origin) {
    const url = requestUrl(input, baseHref);
    if (!url) return false;
    if (origin && url.origin !== origin) return false;
    return isProtectedPlmPath(url.pathname);
  }

  async function authCodeFromResponse(response) {
    if (!response || ![401, 403, 409].includes(Number(response.status))) return '';
    try {
      return authCodeFromPayload(await response.clone().json());
    } catch (_) {
      return '';
    }
  }

  function desktopBridge(root) {
    return root && root.buyerLogDesktop && typeof root.buyerLogDesktop.ensureCoreNectumAuth === 'function'
      ? root.buyerLogDesktop
      : null;
  }

  async function renewCoreNectumSession(root) {
    if (recoveryInFlight) return recoveryInFlight;
    const bridge = desktopBridge(root);
    if (!bridge) return { ok: false, code: 'CORENECTUM_DESKTOP_BRIDGE_UNAVAILABLE' };

    const task = (async () => {
      try {
        /*
         * interactive:true already performs the required two-stage behavior
         * inside Electron main:
         *   1) dedicated persistent CoreNectum session tries silently;
         *   2) if SSO cannot recover it, the hidden window is shown as login.
         * Raw Bearer data never enters the renderer.
         */
        return await bridge.ensureCoreNectumAuth({
          interactive: true,
          reason: 'plm-session-expired',
        });
      } catch (error) {
        return {
          ok: false,
          code: error && error.code || 'CORENECTUM_AUTH_RECOVERY_FAILED',
          error: error && error.message || String(error),
        };
      }
    })();

    recoveryInFlight = task;
    try {
      return await task;
    } finally {
      if (recoveryInFlight === task) recoveryInFlight = null;
    }
  }

  function install(root) {
    if (!root || typeof root.fetch !== 'function' || root.__buyerLogPlmAuthRecoveryInstalled) return false;
    const rawFetch = root.fetch.bind(root);
    const RequestCtor = root.Request;
    if (typeof RequestCtor !== 'function') return false;

    root.__buyerLogPlmAuthRecoveryInstalled = true;
    root.fetch = async function buyerLogPlmAuthRecoveringFetch(input, init) {
      const baseHref = root.location && root.location.href || 'http://127.0.0.1/';
      const origin = root.location && root.location.origin || '';
      if (!isProtectedPlmRequest(input, baseHref, origin)) return rawFetch(input, init);

      let request;
      try {
        request = new RequestCtor(input, init);
      } catch (_) {
        return rawFetch(input, init);
      }

      const firstResponse = await rawFetch(request.clone());
      const authCode = await authCodeFromResponse(firstResponse);
      if (!authCode) return firstResponse;

      const recovered = await renewCoreNectumSession(root);
      if (!recovered || recovered.ok !== true) {
        // Electron has already exposed the login screen when silent SSO was
        // insufficient. Preserve the original API response for existing UI
        // error handling instead of inventing a second error contract.
        return firstResponse;
      }

      // Exactly one replay. rawFetch intentionally bypasses this wrapper so a
      // second 401/403/409 can never create a retry/login loop.
      return rawFetch(request.clone());
    };

    return true;
  }

  return {
    AUTH_CODES,
    authCodeFromPayload,
    authCodeFromResponse,
    isProtectedPlmPath,
    isProtectedPlmRequest,
    renewCoreNectumSession,
    install,
  };
});
