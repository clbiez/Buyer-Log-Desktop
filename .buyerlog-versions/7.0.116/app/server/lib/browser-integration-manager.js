'use strict';

const DEFAULT_BACKOFF_MS = Object.freeze([250, 500, 1000, 2000]);
const RECOVERABLE_CODES = new Set([
  'BROWSER_CONTEXT_MISSING',
  'BROWSER_CDP_TIMEOUT',
  'BROWSER_DISCONNECTED',
  'BROWSER_CONNECTION_FAILED',
  'ECONNREFUSED',
  'ECONNRESET',
]);
const SETUP_REQUIRED_CODES = new Set([
  'EDGE_EXISTING_PROFILE_DEBUG_DISABLED',
  'BROWSER_INTEGRATION_NOT_READY',
]);

function waitingForUserError(cause) {
  const error = new Error('Buyer Log Edge bağlantısı için kullanıcı onayı bekleniyor. Açılan Edge bağlantı ekranında uzaktan hata ayıklamaya izin verin ve yenilemeyi tekrar başlatın.');
  error.code = 'BROWSER_INTEGRATION_WAITING_FOR_USER';
  error.statusCode = 409;
  error.waitingForUser = true;
  error.cause = cause;
  return error;
}

function createBrowserIntegrationManager(options = {}) {
  const connector = options.connector;
  if (!connector) throw new TypeError('Browser connector is required.');
  const pause = typeof options.sleep === 'function'
    ? options.sleep
    : ms => new Promise(resolve => setTimeout(resolve, ms));
  const backoffMs = Array.isArray(options.backoffMs) && options.backoffMs.length
    ? options.backoffMs.slice()
    : DEFAULT_BACKOFF_MS.slice();
  const dashboardInFlight = new Map();
  const approvalTimeoutMs = Math.max(0, Number(options.userApprovalTimeoutMs == null ? 10 * 60 * 1000 : options.userApprovalTimeoutMs) || 0);
  const approvalPollMs = Math.max(250, Number(options.userApprovalPollMs) || 1000);
  const logger = typeof options.logger === 'function' ? options.logger : (event => { try { console.info(`[BROWSER] ${event}`); } catch (_) {} });

  async function waitForUserApproval(ownerId, cause, requestOptions) {
    if (typeof connector.openExistingEdgeDebugSetup === 'function') connector.openExistingEdgeDebugSetup();
    logger('BROWSER_WAITING_FOR_USER');
    if (requestOptions && typeof requestOptions.onState === 'function') requestOptions.onState('WAITING_FOR_USER');
    if (!approvalTimeoutMs || typeof connector.status !== 'function') throw waitingForUserError(cause);
    const polls = Math.max(1, Math.ceil(approvalTimeoutMs / approvalPollMs));
    for (let index = 0; index < polls; index += 1) {
      await pause(approvalPollMs);
      const current = await connector.status(ownerId).catch(() => null);
      if (current && current.existingProfileReady) return;
    }
    throw waitingForUserError(cause);
  }

  async function openDashboard(ownerId, requestOptions = {}) {
    let lastError = null;
    let setupAttempted = false;
    const preferred = requestOptions.session;
    if (preferred) {
      try { await preferred.getSchema(); return preferred; }
      catch (error) {
        if (String(error && error.code || '') === 'POWERBI_AUTH_REQUIRED') throw error;
      }
    }
    logger('BROWSER_PRECHECK');
    for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
      try {
        const session = await connector.openPowerBiImportDashboardSession(ownerId);
        await session.getSchema();
        logger('BROWSER_READY');
        return session;
      } catch (error) {
        lastError = error;
        const code = String(error && error.code || '');
        if (SETUP_REQUIRED_CODES.has(code)) {
          if (setupAttempted) throw waitingForUserError(error);
          setupAttempted = true;
          await waitForUserApproval(ownerId, error, requestOptions);
          // User approval has its own timeout and must always be followed by
          // one real connection attempt, even if transient retries were used.
          attempt = Math.min(attempt, Math.max(0, backoffMs.length - 1));
          continue;
        }
        if (!RECOVERABLE_CODES.has(code) || attempt >= backoffMs.length) throw error;
        logger('BROWSER_RECONNECT');
        if (typeof connector.forgetEndpoint === 'function') connector.forgetEndpoint();
        await pause(backoffMs[attempt]);
      }
    }
    throw lastError;
  }

  function ensureDashboardSession(ownerId, requestOptions = {}) {
    const key = String(ownerId || 'moderator');
    const pending = dashboardInFlight.get(key);
    if (pending) return pending;
    const request = openDashboard(key, requestOptions).finally(() => {
      if (dashboardInFlight.get(key) === request) dashboardInFlight.delete(key);
    });
    dashboardInFlight.set(key, request);
    return request;
  }

  async function status(ownerId) {
    const current = await connector.status(ownerId);
    const operationState = current && current.operation && current.operation.state;
    return {
      ...current,
      integrationState: operationState === 'WAITING_FOR_USER' ? 'WAITING_FOR_USER'
        : current.existingProfileReady ? 'READY'
        : (!current.browserFound ? 'EDGE_NOT_FOUND' : (current.edgeRunning === false ? 'EDGE_NOT_RUNNING' : 'CONNECTION_REQUIRED')),
      managedFallbackEnabled:false,
    };
  }

  async function prepare(ownerId) {
    const result = connector.openExistingEdgeDebugSetup();
    return { result, status:await status(ownerId) };
  }

  return { ensureDashboardSession, status, prepare };
}

module.exports = { createBrowserIntegrationManager, DEFAULT_BACKOFF_MS, RECOVERABLE_CODES, SETUP_REQUIRED_CODES };
