'use strict';

/* Live test of the desktop OAB relay client against a fake Electron relay. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const SECRET = 'relay-test-secret';
const seen = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    seen.push({ url: req.url, secret: req.headers['x-buyerlog-desktop-bridge'], body: JSON.parse(raw || '{}') });
    if (req.headers['x-buyerlog-desktop-bridge'] !== SECRET) { res.writeHead(403); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/oab/status') { res.end(JSON.stringify({ ok: true, ready: mode === 'ok' })); return; }
    const result = mode === 'ok' ? { ok: true, status: 200, json: { Data: [[{ Sezon: 'S7' }]] } }
      : mode === 'expired' ? { ok: false, status: 401, json: null }
      : { ok: false, status: 0, code: 'OAB_AUTH_REQUIRED' };
    res.end(JSON.stringify({ ok: true, result }));
  });
});

let relay;
test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.BUYER_LOG_DESKTOP_OAB_RELAY_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET = SECRET;
  relay = require('../server/lib/oab-desktop-relay');
});
test.after(() => server.close());

test('relay forwards GetReportData to the hidden PASS page and returns rows', async () => {
  mode = 'ok';
  assert.equal(relay.configured(), true);
  assert.equal(await relay.status(), true);
  const rows = await relay.fetchReportData({ seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRefs: ['1', '2'] });
  assert.deepEqual(rows, [{ Sezon: 'S7' }]);
  const last = seen[seen.length - 1];
  assert.equal(last.url, '/oab/pass-request');
  assert.equal(last.secret, SECRET);
  assert.equal(last.body.endpoint, 'Report/GetReportData');
  assert.equal(last.body.body.parameters.BuyerGroupRefs, '1,2');
});

test('relay maps missing and expired sessions to renderer auth codes', async () => {
  mode = 'required';
  assert.equal(await relay.status(), false);
  await assert.rejects(() => relay.fetchReportData({ seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: '1' }), error => error.code === 'OAB_AUTH_REQUIRED' && error.statusCode === 401);
  mode = 'expired';
  await assert.rejects(() => relay.fetchReportData({ seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: '1' }), error => error.code === 'OAB_AUTH_EXPIRED' && error.statusCode === 401);
});

test('relay is not configured without a loopback URL', () => {
  const saved = process.env.BUYER_LOG_DESKTOP_OAB_RELAY_URL;
  process.env.BUYER_LOG_DESKTOP_OAB_RELAY_URL = 'http://example.com:80';
  try { assert.equal(relay.configured(), false); }
  finally { process.env.BUYER_LOG_DESKTOP_OAB_RELAY_URL = saved; }
});
