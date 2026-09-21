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
const DEFAULT_VIEWER_PATH = '/v3/report/viewer';

function clean(value) {
  return String(value == null ? '' : value).replace(/[\u0000\r\n]/g, '').trim();
}

function authorizationHeaderFromCdpRequest(params) {
  const headers = params && params.request && params.request.headers;
  if (!headers || typeof headers !== 'object') return '';
  for (const [name, value] of Object.entries(headers)) {
    if (String(name).toLowerCase() !== 'authorization') continue;
    const text = clean(Array.isArray(value) ? value[0] : value);
    if (/^Bearer\s+\S{20,}$/i.test(text)) return text;
  }
  return '';
}

function isReportApiRequest(params, apiHost, reportApiPath = DEFAULT_REPORT_API_PATH) {
  const raw = clean(params && params.request && params.request.url);
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

function createOabAuthLifecycle(options = {}) {
  const apiHost = String(options.apiHost || '').toLowerCase();
  const uiHost = String(options.uiHost || '').toLowerCase();
  const reportApiPath = options.reportApiPath || DEFAULT_REPORT_API_PATH;
  const viewerPath = options.viewerPath || DEFAULT_VIEWER_PATH;
  const maxViewerKicks = Math.max(1, Number(options.maxViewerKicks) || 4);
  const viewerKickIntervalMs = Math.max(250, Number(options.viewerKickIntervalMs) || 1800);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const onViewerKick = typeof options.onViewerKick === 'function' ? options.onViewerKick : async () => {};
  const onAuthorization = typeof options.onAuthorization === 'function' ? options.onAuthorization : async () => false;
  const onPhase = typeof options.onPhase === 'function' ? options.onPhase : () => {};

  let phase = 'opening';
  let sawLogin = false;
  let stopped = false;
  let candidateBusy = false;
  let viewerKicks = 0;
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
      if (viewerKicks < maxViewerKicks && (!lastViewerKickAt || currentTime - lastViewerKickAt >= viewerKickIntervalMs)) {
        viewerKicks += 1;
        lastViewerKickAt = currentTime;
        await onViewerKick({ attempt: viewerKicks, reason: sawLogin ? 'post-login' : 'pass-shell' });
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
    if (viewerKicks < maxViewerKicks && currentTime - anchor >= viewerKickIntervalMs) {
      viewerKicks += 1;
      lastViewerKickAt = currentTime;
      await onViewerKick({ attempt: viewerKicks, reason: 'viewer-no-api-request' });
    }
    return snapshot();
  }

  async function onNetworkRequest(params) {
    if (stopped || candidateBusy) return false;
    if (!isReportApiRequest(params, apiHost, reportApiPath)) return false;
    const authorization = authorizationHeaderFromCdpRequest(params);
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

  function stop() {
    stopped = true;
  }

  return { observe, onNetworkRequest, stop, snapshot };
}

module.exports = {
  DEFAULT_REPORT_API_PATH,
  DEFAULT_VIEWER_PATH,
  authorizationHeaderFromCdpRequest,
  isReportApiRequest,
  createOabAuthLifecycle,
};
