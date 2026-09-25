'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOabSessionTransport } = require('../electron/oab-session-transport');
const authState = require('../server/lib/oab-auth-state');

test('OAB captures report requests without a webContentsId, including service workers', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const handler = main.match(/authWebRequest\.onBeforeSendHeaders\(OAB_AUTH_CAPTURE_FILTER, \(details, callback\) => \{([\s\S]*?)\n\s*\}\);/);
  assert.ok(handler, 'OAB capture handler exists');
  assert.match(handler[1], /if \(!settled && lifecycle\) void lifecycle\.onNetworkRequest\(details\)/);
  assert.doesNotMatch(handler[1], /details\.webContentsId/);
});

test('OAB report requests use the persistent Chromium session with cookies and preserve the upstream status', async () => {
  const calls = [];
  const logs = [];
  const transport = createOabSessionTransport({
    secret:'test-secret', log:message => logs.push(message),
    authSession:{ fetch:async (url, options) => {
      calls.push({ url, options });
      return { status:502, text:async () => '{"error":"upstream"}' };
    } },
  });
  const origin = await transport.start();
  try {
    const headers = { 'Content-Type':'application/json', 'X-BuyerLog-Desktop-Bridge':'test-secret' };
    const request = { endpoint:'Report/GetReportVariablesWithData', authorization:'Bearer ' + 'x'.repeat(48), body:{ reportRef:'OrderBudget_List_Report' } };
    const blocked = await fetch(origin + '/request', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(request) });
    assert.equal(blocked.status, 403);
    const result = await fetch(origin + '/request', { method:'POST', headers, body:JSON.stringify(request) });
    assert.equal(result.status, 502);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportVariablesWithData');
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.headers['X-BuyerLog-OAB-Internal'], undefined);
    assert.equal(calls[0].options.headers.Authorization, request.authorization);
    assert.equal(logs[0], 'OAB Report/GetReportVariablesWithData HTTP 502');
    assert.ok(!logs.join(' ').includes(request.authorization));

    const forbidden = await fetch(origin + '/request', { method:'POST', headers,
      body:JSON.stringify({ ...request, endpoint:'https://other.example/' }) });
    assert.equal(forbidden.status, 400);
    assert.equal(calls.length, 1);
  } finally { await transport.stop(); }
});

test('backend report client forwards only to the loopback broker, never directly to PASS', async () => {
  const originalFetch = global.fetch;
  const oldOrigin = process.env.BUYER_LOG_OAB_TRANSPORT_ORIGIN;
  const oldSecret = process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET;
  const client = require('../server/lib/oab-api-client');
  const captured = [];
  try {
    process.env.BUYER_LOG_OAB_TRANSPORT_ORIGIN = 'http://127.0.0.1:49213';
    process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET = 'test-secret';
    authState.setAuthorization('Bearer ' + 'x'.repeat(48));
    global.fetch = async (url, options) => {
      captured.push({ url:String(url), options });
      return { status:200, ok:true, text:async () => '{"Data":[[{"id":1}]]}' };
    };
    assert.deepEqual(await client.fetchReportData({ seasonRef:1, merchSubGroupRef:2, buyerGroupRef:3 }), [{ id:1 }]);
    assert.equal(captured[0].url, 'http://127.0.0.1:49213/request');
    assert.equal(captured[0].options.headers['X-BuyerLog-Desktop-Bridge'], 'test-secret');
    assert.equal(JSON.parse(captured[0].options.body).endpoint, 'Report/GetReportData');
    global.fetch = async () => ({ status:502, ok:false });
    await assert.rejects(() => client.validateAuthorization(), error =>
      error.code === 'OAB_HTTP_ERROR' && error.details.status === 502);
  } finally {
    global.fetch = originalFetch;
    authState.clear();
    if (oldOrigin === undefined) delete process.env.BUYER_LOG_OAB_TRANSPORT_ORIGIN;
    else process.env.BUYER_LOG_OAB_TRANSPORT_ORIGIN = oldOrigin;
    if (oldSecret === undefined) delete process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET;
    else process.env.BUYER_LOG_DESKTOP_BRIDGE_SECRET = oldSecret;
  }
});
