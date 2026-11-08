'use strict';
const { helper } = require('./pinned');
const { B, cancelled, error } = require('./runtime');
const { contentTypeAcceptable, AUTH_STATUS, DEFAULT_TIMEOUT_MS } = require('../../../resources/app/server/lib/plm-image-download-queue');
// Injected transport contract: bounded producer, destroy(), and settled promise
// including request/response close and all outstanding Buffer consumers.
async function streamRequest(url, options) {
  const { transport, signal, permit, runtime } = options;
  if (signal?.aborted) throw cancelled();
  const session = await transport.open(url, { signal, headers: { Accept: 'image/*', 'Accept-Encoding': 'identity' }, highWaterMark: 64 * 1024 });
  let chunks = [], result = null, count = 0;
  const abort = () => session.destroy(cancelled());
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  let timeout;
  function resetTimeout() {
    clearTimeout(timeout);
    timeout = setTimeout(() => session.destroy(error('PLM_IMAGE_TIMEOUT')), timeoutMs);
    timeout.unref();
  }
  resetTimeout();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const { status, headers } = session;
    if (status < 200 || status >= 300) throw Object.assign(error(AUTH_STATUS.has(status) ? 'PLM_IMAGE_AUTH' : 'PLM_IMAGE_HTTP_ERROR'), { status, headers });
    if (!contentTypeAcceptable(headers['content-type'])) throw error('PLM_IMAGE_INVALID_TYPE');
    if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') throw error('INT03_UNEXPECTED_ENCODING');
    // GET admission always used the full unknown-length envelope. Headers do
    // not shrink it. A separate plan enforces honest length for this attempt.
    const plan = helper.planImageReservation({ contentLength: headers['content-length'], maxImageBytes: B });
    const check = (size, complete = false) => {
      permit.checkBodySize(size, { complete });
      // Reuse the unchanged helper's strict declared-length guard.
      if (size > plan.bodyLimitBytes || (complete && plan.contentLength !== null && size !== plan.contentLength)) throw error('PLM_IMAGE_LENGTH_MISMATCH');
    };
    for await (const chunk of session.body) {
      if (signal?.aborted) throw cancelled();
      resetTimeout();
      check(count + chunk.length);
      chunks.push(chunk); count += chunk.length;
      runtime?.event('chunk', { bytes: count });
    }
    check(count, true);
    if (!count) throw error('PLM_IMAGE_EMPTY');
    result = { buffer: Buffer.concat(chunks, count), contentType: headers['content-type'], status, headers };
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    // Even error/retry/abort waits for actual quiescence; no Promise.race refund.
    session.destroy();
    try { await session.settled; } finally { chunks.length = 0; chunks = null; result = null; }
  }
}
module.exports = { streamRequest };
