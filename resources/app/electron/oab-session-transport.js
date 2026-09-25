'use strict';

const http = require('http');

const API_ROOT = 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/';
const ENDPOINTS = new Set(['Report/GetReportData', 'Report/GetReportVariablesWithData']);
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

function createOabSessionTransport({ authSession, secret, log = () => {} }) {
  if (!authSession || typeof authSession.fetch !== 'function' || !secret) throw new Error('OAB transport yapılandırılamadı.');
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST' || request.url !== '/request'
        || request.headers['x-buyerlog-desktop-bridge'] !== secret
        || request.socket.remoteAddress !== '127.0.0.1') {
      response.writeHead(403).end();
      return;
    }
    try {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new Error('OAB_REQUEST_TOO_LARGE');
      }
      const input = JSON.parse(raw);
      if (!ENDPOINTS.has(input.endpoint) || !/^Bearer\s+\S{20,}$/i.test(input.authorization || '')
          || !input.body || typeof input.body !== 'object' || Array.isArray(input.body)) {
        response.writeHead(400).end();
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      let upstream;
      try {
        upstream = await authSession.fetch(API_ROOT + input.endpoint, {
          method: 'POST', redirect: 'manual', cache: 'no-store', credentials: 'include', signal: controller.signal,
          headers: {
            Accept: 'application/json', 'Content-Type': 'application/json',
            Origin: 'https://pass.lcwaikiki.com', Referer: 'https://pass.lcwaikiki.com/',
            Authorization: input.authorization,
          },
          body: JSON.stringify(input.body),
        });
        const body = await upstream.text();
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('OAB_RESPONSE_TOO_LARGE');
        log(`OAB ${input.endpoint} HTTP ${upstream.status}`);
        response.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
      } finally { clearTimeout(timer); }
    } catch (error) {
      // Never log a raw request, response body or Authorization value.
      log('OAB Chromium isteği başarısız: ' + (error && error.name === 'AbortError' ? 'timeout' : 'transport'));
      if (!response.headersSent) response.writeHead(502).end();
    }
  });
  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      return `http://127.0.0.1:${server.address().port}`;
    },
    async stop() {
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createOabSessionTransport };
