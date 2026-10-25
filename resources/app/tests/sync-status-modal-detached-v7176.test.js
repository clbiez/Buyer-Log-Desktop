'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v7.176 Sync durum penceresi DOM dışına alındıysa canlı olay kaybolan elemana yazmaz', () => {
  const start = APP.indexOf('const render=q=>{if(!modal.isConnected');
  assert.ok(start > 0, 'render koruması bulunmalı');
  const guard = APP.slice(start, start + 140);
  assert.match(guard, /if\(!modal\.isConnected\|\|!modal\.querySelector\('\[data-sync-status\]'\)\)\{close\(\);return;\}/);
  // close() dinleyiciyi ve zamanlayıcıyı birlikte bırakır.
  assert.match(APP, /const close=\(\)=>\{releaseKeyboard\(\);syncStatusModalRenderer=null;if\(syncStatusPollTimer\)\{clearInterval\(syncStatusPollTimer\);syncStatusPollTimer=0;\}modal\.remove\(\);\};/);
});
