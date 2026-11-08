'use strict';

// Only the three BOM read endpoints use this limiter. Different owners never
// wait on each other; nested target/child schedulers acquire at the HTTP edge.
const OWNER_LIMIT = 5;
const MAX_READ_ATTEMPTS = 4;
const TARGET_ADMISSION_MS = 240000;
const owners = new Map();
const error = (code, message) => Object.assign(new Error(message), { code });

async function acquire(ownerId, check) {
  let state = owners.get(ownerId);
  if (!state) { state = { active: 0, queue: [] }; owners.set(ownerId, state); }
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (!state.active && !state.queue.length && owners.get(ownerId) === state) owners.delete(ownerId);
    };
    const ticket = () => {
      try { check(); }
      catch (err) {
        const index = state.queue.indexOf(ticket);
        if (index >= 0) state.queue.splice(index, 1);
        clearTimeout(timer); reject(err); cleanup(); return;
      }
      if (state.active >= OWNER_LIMIT) return;
      const index = state.queue.indexOf(ticket);
      if (index >= 0) state.queue.splice(index, 1);
      clearTimeout(timer);
      state.active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        state.active--;
        while (state.active < OWNER_LIMIT && state.queue.length) state.queue.shift()();
        cleanup();
      });
    };
    // Poll the existing job cancellation predicate while queued. Active calls
    // retain their permit until the real client settles (no Promise.race leak).
    const poll = () => {
      try { check(); }
      catch (err) {
        const index = state.queue.indexOf(ticket);
        if (index >= 0) state.queue.splice(index, 1);
        reject(err); cleanup(); return;
      }
      timer = setTimeout(poll, 25);
    };
    state.queue.push(ticket);
    if (state.active < OWNER_LIMIT) ticket();
    else timer = setTimeout(poll, 25);
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
  // Preserve compatibility with injected readers that do not classify errors.
  return true;
}

function createTargetBudget(ownerId, checkStop, options = {}) {
  const now = options.now || Date.now;
  // Test/embedding callers may shorten, never extend, admission deadlines.
  const duration = Math.min(TARGET_ADMISSION_MS, Math.max(1, Number(options.bomAdmissionMs) || TARGET_ADMISSION_MS));
  const deadline = now() + duration;
  const attempts = new Map();
  const check = () => {
    checkStop();
    if (now() >= deadline) throw error('PLM_BOM_ADMISSION_DEADLINE', 'BOM okuma süresi doldu. / BOM read admission deadline exceeded.');
  };
  return async (method, url, body, reader) => {
    const key = JSON.stringify([method, url, body]);
    const verify = () => {
      check();
      if ((attempts.get(key) || 0) >= MAX_READ_ATTEMPTS) throw error('PLM_BOM_ATTEMPT_BUDGET', 'BOM deneme sınırına ulaşıldı. / BOM attempt budget exhausted.');
    };
    verify();
    const release = await acquire(ownerId, verify);
    try {
      verify();
      attempts.set(key, (attempts.get(key) || 0) + 1);
      // CoreNectum retries is an attempt count; zero falls back to three.
      // It ignores external AbortSignal and clears its timeout before body
      // decoding, so this is an ADMISSION deadline, not a hard fetch deadline.
      return await reader(url, body, { timeoutMs: Math.max(5000, Math.min(60000, deadline - now())), retries: 1, language: options.language });
    } finally { release(); }
  };
}

async function waitForRetry(ms, stopped) {
  const end = Date.now() + Math.max(0, Number(ms) || 0);
  while (!stopped() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(25, end - Date.now())));
}

module.exports = { OWNER_LIMIT, MAX_READ_ATTEMPTS, TARGET_ADMISSION_MS, createTargetBudget, isRetryableRead, waitForRetry };
