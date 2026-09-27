'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('PASS viewer URL carries the active report selection', () => {
  assert.match(CONNECTOR, /function passViewerUrl\(/);
  assert.match(CONNECTOR, /searchParams\.set\('SeasonRef',seasonRef\)/);
  assert.match(CONNECTOR, /searchParams\.set\('MerchSubGroupRef',merchSubGroupRef\)/);
  assert.match(CONNECTOR, /searchParams\.set\('BuyerGroupRefs',buyerGroupRef\)/);
});

test('browser-backed OAB connect endpoint forwards selected report refs', () => {
  const start = SERVER.indexOf("app.post('/api/oab/auth/connect'");
  const end = SERVER.indexOf("app.get('/api/oab/seasons'", start);
  const body = SERVER.slice(start, end);
  assert.match(body, /seasonRef: body\.seasonRef/);
  assert.match(body, /merchSubGroupRef: body\.merchSubGroupRef/);
  assert.match(body, /buyerGroupRef: body\.buyerGroupRef/);
  assert.match(body, /ensurePassConnected\(req\.currentUser\.id, params\)/);
});

test('renderer derives auth context from single report and first batch combination', () => {
  assert.match(OAB, /function oabAuthContextFromRequest\(url, options\)/);
  assert.match(OAB, /body\.combinations\[0\]/);
  assert.match(OAB, /oabEnsureAuthentication\(oabAuthContextFromRequest\(url, options\)\)/);
  assert.match(OAB, /fetch\('\/api\/oab\/auth\/connect'/);
  assert.match(OAB, /body:JSON\.stringify\(oabLastAuthContext\)/);
});
