'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');

test('OAB desktop auth opens the PASS viewer with the active report selection', () => {
  assert.match(MAIN, /function oabViewerUrl\(options = \{\}\)/);
  assert.match(MAIN, /searchParams\.set\('SeasonRef', seasonRef\)/);
  assert.match(MAIN, /searchParams\.set\('MerchSubGroupRef', merchSubGroupRef\)/);
  assert.match(MAIN, /searchParams\.set\('BuyerGroupRefs', buyerGroupRef\)/);
  assert.match(MAIN, /const requestedViewerUrl = oabViewerUrl\(options\)/);
  assert.match(MAIN, /loadLoginTarget\(targetViewerUrl\(\), true\)/);
});

test('trusted OAB IPC forwards only report refs needed to trigger PASS report traffic', () => {
  const start = MAIN.indexOf("ipcMain.handle('buyerlog:oab-auth'");
  const end = MAIN.indexOf("ipcMain.handle('buyerlog:oab-auth-clear'", start);
  const body = MAIN.slice(start, end);
  assert.match(body, /seasonRef:options && options\.seasonRef/);
  assert.match(body, /merchSubGroupRef:options && options\.merchSubGroupRef/);
  assert.match(body, /buyerGroupRef:options && options\.buyerGroupRef/);
});

test('renderer derives auth context from single report and first batch combination', () => {
  assert.match(OAB, /function oabAuthContextFromRequest\(url, options\)/);
  assert.match(OAB, /body\.combinations\[0\]/);
  assert.match(OAB, /oabEnsureAuthentication\(oabAuthContextFromRequest\(url, options\)\)/);
  assert.match(OAB, /ensureOabAuth\(\{ interactive:true, \.\.\.oabLastAuthContext \}\)/);
});
