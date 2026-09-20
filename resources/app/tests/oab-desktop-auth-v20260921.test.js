'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('OAB desktop auth captures bearer requests across the dedicated OAB hosts', () => {
  assert.match(MAIN, /const OAB_AUTH_CAPTURE_URLS = Object\.freeze\(\[[\s\S]*?OAB_API_HOST\}\\/\*[\s\S]*?OAB_UI_HOST\}\\/\*/);
  assert.match(MAIN, /const authCaptureFilter = \{ urls: OAB_AUTH_CAPTURE_URLS \}/);
  assert.match(MAIN, /onBeforeSendHeaders\(authCaptureFilter,/);
  assert.match(MAIN, /onBeforeSendHeaders\(authCaptureFilter, null\)/);
});

test('OAB desktop auth reopens the viewer once after sign-in so an API request is emitted', () => {
  assert.match(MAIN, /function oabWindowLooksLikeSignIn/);
  assert.match(MAIN, /const schedulePostLoginViewerKick =/);
  assert.match(MAIN, /did-finish-load[\s\S]*?schedulePostLoginViewerKick/);
  assert.match(MAIN, /postLoginViewerKickDone = true;[\s\S]*?loadLoginTarget\(OAB_VIEWER_URL, false\)/);
});

test('OAB desktop auth does not inspect or transport credential field values', () => {
  const start = MAIN.indexOf('async function oabWindowLooksLikeSignIn');
  const end = MAIN.indexOf('/* Electron loadURL()', start);
  const block = MAIN.slice(start, end);
  assert.match(block, /querySelector/);
  assert.doesNotMatch(block, /\.value\b|password\s*:/i);
});
