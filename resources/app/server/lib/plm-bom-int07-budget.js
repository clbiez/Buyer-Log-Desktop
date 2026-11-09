'use strict';

// Only BOM read endpoints use this limiter. Nested schedulers and simultaneous
// jobs share five active reads per owner; different owners remain independent.
const OWNER_LIMIT = 5;
const MAX_READ_ATTEMPTS = 4;
const TARGET_ADMISSION_MS = 240000; // Retained name for embedding compatibility; now a total read deadline.
const owners = new Map();
const error = (code, message) => Object.assign(new Error(message), { code });

async function acquire(ownerId, check, signal) {
  let state = owners.get(ownerId);
  if (!state) { state = { active: 0, queue: [] }; owners.set(ownerId, state); }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (!state.active && !state.queue.length && owners.get(ownerId) === state) owners.delete(ownerId);
    };
    const detach = () => {
      signal.removeEventListener('abort', ticket);
      const index = state.queue.indexOf(ticket);
      if (index >= 0) state.queue.splice(index, 1);
    };
    const ticket = () => {
      try { check(); } catch (err) { detach(); cleanup(); reject(err); return; }
      if (state.active >= OWNER_LIMIT) return;
      detach();
      state.active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        state.active--;
        while (state.active < OWNER_LIMIT && state.queue.length) state.queue[0]();
        cleanup();
      });
    };
    state.queue.push(ticket);
    signal.addEventListener('abort', ticket, { once: true });
    ticket();
  });
}

function isRetryableRead(error) {
  const code = String(error && error.code || '');
  if (/^PLM_(BOM|SET)_/.test(code)) return false;
  if (code === 'CORENECTUM_API_HTTP_ERROR') {
    const status = Number(error.details && error.details.remoteStatus);
    if (status) return status === 408 || status === 429 || status >= 500;
    return error.details?.retryable !== false;
  }
  if (code.startsWith('CORENECTUM_API_')) return ['CORENECTUM_API_TIMEOUT', 'CORENECTUM_API_NETWORK_ERROR'].includes(code);
  return true;
}

function createTargetBudget(ownerId, checkStop, options = {}) {
  const now = options.now || Date.now;
  // Callers may shorten the production budget, never extend it.
  const duration = Math.min(TARGET_ADMISSION_MS, Math.max(1, Number(options.bomAdmissionMs) || TARGET_ADMISSION_MS));
  const deadline = now() + duration;
  const attempts = new Map();
  const controller = new AbortController();
  const expire = () => controller.abort(error('PLM_BOM_READ_DEADLINE', 'BOM okuma süresi doldu. / BOM read deadline exceeded.'));
  const checkResult = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (now() >= deadline) { expire(); throw controller.signal.reason; }
  };
  const check = () => {
    checkResult();
    try { checkStop(); } catch (err) { controller.abort(err); throw err; }
  };
  const checkCancellation = () => { try { check(); } catch (_) { /* reason travels through signal/check */ } };
  options.signal?.addEventListener('abort', checkCancellation, { once: true });
  const timer = setTimeout(expire, duration);
  // Existing jobs expose an isCancelled predicate rather than an AbortSignal.
  const poll = setInterval(checkCancellation, 25);
  const read = async (method, url, body, reader) => {
    const key = JSON.stringify([method, url, body]);
    const verify = () => {
      check();
      if ((attempts.get(key) || 0) >= MAX_READ_ATTEMPTS) throw error('PLM_BOM_ATTEMPT_BUDGET', 'BOM deneme sınırına ulaşıldı. / BOM attempt budget exhausted.');
    };
    verify();
    const release = await acquire(ownerId, verify, controller.signal);
    try {
      verify();
      attempts.set(key, (attempts.get(key) || 0) + 1);
      // Keep the permit until the real fetch AND body have settled. Only the
      // three explicit read-only BOM endpoints opt into the client contract.
      const result = await reader(url, body, { timeoutMs: Math.min(60000, deadline - now()), retries: 1, language: options.language, bomReadControl: true, bomReadCheck: check, signal: controller.signal });
      // A completed read is safe if its signal has not been cancelled. Do not
      // retroactively cancel a synchronous success just because the legacy
      // predicate changed inside that reader; the next admission still stops.
      checkResult();
      return result;
    } finally { release(); }
  };
  read.check = check;
  read.checkResult = checkResult;
  // Auth is a shared external wait, not an HTTP read. Detach this target on
  // abort without cancelling another target's refresh or resuming stale work.
  read.wait = promise => new Promise((resolve, reject) => {
    const abort = () => { controller.signal.removeEventListener('abort', abort); reject(controller.signal.reason); };
    controller.signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => {
      controller.signal.removeEventListener('abort', abort);
      try { check(); resolve(value); } catch (err) { reject(err); }
    }, err => { controller.signal.removeEventListener('abort', abort); reject(err); });
    checkCancellation();
    if (controller.signal.aborted) abort();
  });
  read.waitForRetry = ms => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(delay); controller.signal.removeEventListener('abort', abort); reject(controller.signal.reason); };
    const delay = setTimeout(() => {
      controller.signal.removeEventListener('abort', abort);
      try { check(); resolve(); } catch (err) { reject(err); }
    }, Math.max(0, Number(ms) || 0));
    controller.signal.addEventListener('abort', abort, { once: true });
    checkCancellation();
    if (controller.signal.aborted) abort();
  });
  read.dispose = () => {
    clearTimeout(timer); clearInterval(poll);
    options.signal?.removeEventListener('abort', checkCancellation);
  };
  return read;
}

module.exports = { OWNER_LIMIT, MAX_READ_ATTEMPTS, TARGET_ADMISSION_MS, createTargetBudget, isRetryableRead };
