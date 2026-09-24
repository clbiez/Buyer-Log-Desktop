'use strict';

/*
 * OAB interactive desktop auth lifecycle.
 *
 * This module deliberately owns only the state machine around the Electron
 * login window. It never persists or logs Authorization and it never knows
 * user credentials. The caller supplies the one callback that transfers a
 * captured Authorization value to the loopback backend for validation.
 */

const DEFAULT_REPORT_API_PATH = '/pass/common/report/api/';
const DEFAULT_API_PATH_PREFIX = '/pass/';
const DEFAULT_VIEWER_PATH = '/v3/report/viewer';

function clean(value) {
  return String(value == null ? '' : value).replace(/[\u0000\r\n]/g, '').trim();
}

function authorizationHeaderFromRequest(params) {
  const headers = params && (
    (params.requestHeaders && typeof params.requestHeaders === 'object' && params.requestHeaders)
    || (params.request && params.request.headers)
  );
  if (!headers || typeof headers !== 'object') return '';
  for (const [name, value] of Object.entries(headers)) {
    if (String(name).toLowerCase() !== 'authorization') continue;
    const text = clean(Array.isArray(value) ? value[0] : value);
    if (/^Bearer\s+\S{20,}$/i.test(text)) return text;
  }
  return '';
}

function isReportApiRequest(params, apiHost, reportApiPath = DEFAULT_REPORT_API_PATH) {
  const raw = clean(params && (params.url || (params.request && params.request.url)));
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === String(apiHost || '').toLowerCase()
      && url.pathname.toLowerCase().includes(String(reportApiPath || DEFAULT_REPORT_API_PATH).toLowerCase());
  } catch (_) {
    return false;
  }
}

function isOabApiRequest(params, apiHost, apiPathPrefix = DEFAULT_API_PATH_PREFIX) {
  const raw = clean(params && (params.url || (params.request && params.request.url)));
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const prefix = String(apiPathPrefix || DEFAULT_API_PATH_PREFIX).toLowerCase();
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === String(apiHost || '').toLowerCase()
      && url.pathname.toLowerCase().startsWith(prefix);
  } catch (_) {
    return false;
  }
}

function createOabAuthLifecycle(options = {}) {
  const apiHost = String(options.apiHost || '').toLowerCase();
  const uiHost = String(options.uiHost || '').toLowerCase();
  const reportApiPath = options.reportApiPath || DEFAULT_REPORT_API_PATH;
  const apiPathPrefix = options.apiPathPrefix || DEFAULT_API_PATH_PREFIX;
  const viewerPath = options.viewerPath || DEFAULT_VIEWER_PATH;
  const maxViewerKicks = Math.max(1, Number(options.maxViewerKicks) || 2);
  const viewerKickIntervalMs = Math.max(500, Number(options.viewerKickIntervalMs) || 6000);
  const viewerSettleMs = Math.max(1000, Number(options.viewerSettleMs) || 12000);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const onViewerKick = typeof options.onViewerKick === 'function' ? options.onViewerKick : async () => {};
  const onAuthorization = typeof options.onAuthorization === 'function' ? options.onAuthorization : async () => false;
  const onPhase = typeof options.onPhase === 'function' ? options.onPhase : () => {};

  let phase = 'opening';
  let sawLogin = false;
  let stopped = false;
  let candidateBusy = false;
  let viewerKicks = 0;
  let viewerKickBusy = false;
  let viewerFirstSeenAt = 0;
  let lastViewerKickAt = 0;

  function setPhase(next) {
    if (!next || phase === next) return;
    phase = next;
    try { onPhase(next, snapshot()); } catch (_) {}
  }

  function snapshot() {
    return {
      phase,
      sawLogin,
      stopped,
      candidateBusy,
      viewerKicks,
      maxViewerKicks,
    };
  }

  async function attemptViewerKick(reason, currentTime) {
    if (stopped || viewerKickBusy || viewerKicks >= maxViewerKicks) return false;
    if (lastViewerKickAt && currentTime - lastViewerKickAt < viewerKickIntervalMs) return false;
    viewerKickBusy = true;
    // Reserve the interval immediately so concurrent lifecycle pulses cannot
    // stack duplicate navigations while BrowserWindow.loadURL is still pending.
    lastViewerKickAt = currentTime;
    try {
      const nextAttempt = viewerKicks + 1;
      const started = await onViewerKick({ attempt: nextAttempt, reason });
      if (started === false) return false;
      viewerKicks = nextAttempt;
      return true;
    } finally {
      viewerKickBusy = false;
    }
  }

  async function observe({ url, signIn } = {}) {
    if (stopped) return snapshot();
    const current = clean(url);
    if (signIn === true) {
      sawLogin = true;
      setPhase('login-required');
      return snapshot();
    }

    let parsed;
    try { parsed = new URL(current); } catch (_) { return snapshot(); }
    const host = parsed.hostname.toLowerCase();
    if (host !== uiHost) {
      if (sawLogin) setPhase('login-required');
      return snapshot();
    }

    if (sawLogin && phase === 'login-required') setPhase('authenticated-opening-report');

    const onViewer = parsed.pathname.toLowerCase().includes(String(viewerPath).toLowerCase());
    const currentTime = Number(now()) || Date.now();

    if (!onViewer) {
      if (sawLogin) setPhase('authenticated-opening-report');
      else setPhase('waiting-report-request');
      if (!lastViewerKickAt || currentTime - lastViewerKickAt >= viewerKickIntervalMs) {
        await attemptViewerKick(sawLogin ? 'post-login' : 'pass-shell', currentTime);
      }
      return snapshot();
    }

    setPhase('waiting-report-request');
    if (!viewerFirstSeenAt) {
      // The caller already navigated to the viewer. Treat that initial load as
      // attempt zero and wait briefly before forcing a bounded retry.
      viewerFirstSeenAt = currentTime;
      return snapshot();
    }

    const anchor = Math.max(viewerFirstSeenAt, lastViewerKickAt);
    const requiredDelay = viewerKicks === 0 ? viewerSettleMs : viewerKickIntervalMs;
    if (currentTime - anchor >= requiredDelay) {
      await attemptViewerKick('viewer-no-api-request', currentTime);
    }
    return snapshot();
  }

  async function onNetworkRequest(params) {
    if (stopped || candidateBusy) return false;
    /* The PASS viewer may not issue a report request until its own filter
       controls are populated. Waiting specifically for Report/GetReportData
       therefore deadlocks the Buyer Log flow after a successful SSO login.
       Accept a Bearer only from the exact trusted PASS API host + /pass/
       namespace, then let the loopback backend validate that token against
       the real report API before treating authentication as complete. */
    if (!isOabApiRequest(params, apiHost, apiPathPrefix)) return false;
    const authorization = authorizationHeaderFromRequest(params);
    if (!authorization) return false;

    candidateBusy = true;
    setPhase('authorization-captured');
    try {
      const accepted = await onAuthorization(authorization);
      if (!accepted) {
        setPhase('waiting-report-request');
        return false;
      }
      setPhase('backend-validated');
      stopped = true;
      return true;
    } catch (_) {
      // Invalid/expired candidates are deliberately non-terminal. A later real
      // report request in the same login flow may carry a fresh Authorization.
      setPhase('waiting-report-request');
      return false;
    } finally {
      candidateBusy = false;
    }
  }

  function resetForFreshViewer() {
    if (stopped || candidateBusy) return false;
    sawLogin = false;
    viewerKicks = 0;
    viewerKickBusy = false;
    viewerFirstSeenAt = 0;
    lastViewerKickAt = 0;
    setPhase('opening');
    return true;
  }

  function stop() {
    stopped = true;
  }

  return { observe, onNetworkRequest, resetForFreshViewer, stop, snapshot };
}

module.exports = {
  DEFAULT_REPORT_API_PATH,
  DEFAULT_API_PATH_PREFIX,
  DEFAULT_VIEWER_PATH,
  authorizationHeaderFromRequest,
  isReportApiRequest,
  isOabApiRequest,
  createOabAuthLifecycle,
};
