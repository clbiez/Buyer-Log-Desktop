'use strict';
// Concrete Node HTTPS adapter. Tests inject get(); no real PLM traffic is used.
const https = require('node:https');
const { URL } = require('node:url');
const { imageAgent, DEFAULT_TIMEOUT_MS } = require('../../../resources/app/server/lib/plm-image-download-queue');
const { cancelled, error } = require('./runtime');
function createNodeTransport({ get = https.get, agent = imageAgent() } = {}) {
  return { open(url, { signal, headers, highWaterMark = 65536 } = {}) {
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      let request, response, requestClosed = false, responseClosed = true, returned = false, failure;
      let resolveSettled;
      const settled = new Promise(r => { resolveSettled = r; });
      const finish = () => {
        if (!requestClosed || !responseClosed) return;
        signal?.removeEventListener('abort', abort);
        resolveSettled();
        if (!returned) reject(failure || error('ECONNRESET'));
      };
      const destroy = cause => {
        if (cause && !failure) failure = cause;
        // Retain listeners until both close events. Destroy initiates shutdown;
        // it does not itself prove that native/stream users have settled.
        response?.destroy(cause);
        request?.destroy(cause);
      };
      const abort = () => destroy(cancelled());
      try {
        const parsed = new URL(url);
        request = get({ protocol: parsed.protocol, hostname: parsed.hostname,
          port: parsed.port || 443, path: parsed.pathname + parsed.search,
          agent, highWaterMark, headers: { ...headers, 'Accept-Encoding': 'identity', 'User-Agent': 'BuyerLog-PLM-Image/1' },
        }, res => {
          response = res; responseClosed = false;
          res.on('error', e => { failure ||= e; });
          res.once('close', () => { responseClosed = true; finish(); });
          if (failure || signal?.aborted) { destroy(failure || cancelled()); return; }
          returned = true;
          resolve({ status: res.statusCode, headers: res.headers || {}, body: res, settled, destroy });
        });
        request.on('error', e => { failure ||= e; destroy(e); });
        request.once('close', () => { requestClosed = true; finish(); });
        request.setTimeout(DEFAULT_TIMEOUT_MS, () => destroy(error('PLM_IMAGE_TIMEOUT')));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch (e) {
        if (!request) { signal?.removeEventListener('abort', abort); reject(e); }
        else destroy(e);
      }
    });
  } };
}
module.exports = { createNodeTransport };
