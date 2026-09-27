'use strict';

const http = require('http');

const API_ROOT = 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/';
const ENDPOINTS = new Set(['Report/GetReportData', 'Report/GetReportVariablesWithData']);
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

function safeErrorKind(error) {
  const name = /^[A-Za-z]{1,32}Error$/.test(error && error.name || '') ? error.name : 'Error';
  const rawCode = error && error.code || '';
  const code = /^(?:NET::)?ERR_[A-Z_]+$|^E[A-Z_]{2,30}$/.test(rawCode) ? rawCode
    : (String(error && error.message || '').match(/\b(?:net::)?ERR_[A-Z_]+\b/) || [])[0] || '';
  return code ? `${name}/${code}` : name;
}

function fetchWithClientRequest(netRequest, authSession, url, authorization, body) {
  return new Promise((resolve, reject) => {
    let done = false;
    let client;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      if (client) client.abort();
      finish(Object.assign(new Error('timeout'), { name:'AbortError' }));
    }, 90000);
    try {
      client = netRequest({ url, method:'POST', session:authSession, credentials:'include', redirect:'manual',
        headers:{ Accept:'application/json', 'Content-Type':'application/json',
          Origin:'https://pass.lcwaikiki.com', Referer:'https://pass.lcwaikiki.com/', Authorization:authorization } });
      client.on('error', error => finish(error));
      client.on('response', upstream => {
        const chunks = [];
        let size = 0;
        upstream.on('data', chunk => {
          if (done) return;
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            client.abort();
            finish(new Error('OAB_RESPONSE_TOO_LARGE'));
          } else chunks.push(chunk);
        });
        upstream.on('error', error => finish(error));
        upstream.on('end', () => finish(null, { status:upstream.statusCode, body:Buffer.concat(chunks).toString('utf8') }));
      });
      client.end(JSON.stringify(body));
    } catch (error) { finish(error); }
  });
}

function createOabSessionTransport({ authSession, netRequest, secret, log = () => {} }) {
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
      let status;
      let body;
      try {
        try {
          const upstream = await authSession.fetch(API_ROOT + input.endpoint, {
            method: 'POST', redirect: 'manual', cache: 'no-store', credentials: 'include', signal: controller.signal,
            headers: {
              Accept: 'application/json', 'Content-Type': 'application/json',
              Origin: 'https://pass.lcwaikiki.com', Referer: 'https://pass.lcwaikiki.com/',
              Authorization: input.authorization,
            },
            body: JSON.stringify(input.body),
          });
          status = upstream.status;
          body = await upstream.text();
        } catch (error) {
          log('OAB Chromium fetch hatası: ' + safeErrorKind(error));
          if (!netRequest || controller.signal.aborted) throw error;
          const fallback = await fetchWithClientRequest(netRequest, authSession,
            API_ROOT + input.endpoint, input.authorization, input.body);
          status = fallback.status;
          body = fallback.body;
        }
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('OAB_RESPONSE_TOO_LARGE');
        log(`OAB ${input.endpoint} HTTP ${status}`);
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
      } finally { clearTimeout(timer); }
    } catch (error) {
      // Never log a raw request, response body or Authorization value.
      log('OAB Chromium isteği başarısız: ' + (error && error.name === 'AbortError' ? 'timeout' : safeErrorKind(error)));
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
