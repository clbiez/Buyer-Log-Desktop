'use strict';
/* 7.0.184 — Yeni sürümün açılış doğrulaması tek atış değildir.
 * İlk sekme yüklendiği an yerel veritabanı veya backend henüz hazır değilse
 * launcher onayı reddeder; eskiden yeniden denenmediği için 60 sn sonra sürüm
 * sessizce geri alınıyor, kullanıcı eski özelliklerle kalıyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

test('renderer-ready hook delegates to a retrying launcher health confirmation', () => {
  const hookStart = MAIN.indexOf('onFirstRendererReady: () => {');
  assert.ok(hookStart > 0);
  const hook = MAIN.slice(hookStart, MAIN.indexOf('},\n  });', hookStart));
  assert.match(hook, /confirmLauncherHealth\(\)/);
});

test('health confirmation retries only during an update trial and is bounded', () => {
  const start = MAIN.indexOf('function confirmLauncherHealth(');
  assert.ok(start > 0, 'confirmLauncherHealth tanımlı olmalı');
  const body = MAIN.slice(start, MAIN.indexOf('\n}\n', start));
  assert.match(body, /process\.env\.BUYER_LOG_UPDATE_HEALTH_TOKEN/);
  assert.match(body, /global\.__buyerLogLauncherHealthReady\(/);
  assert.match(body, /localDbReady:/);
  assert.match(body, /attempt < HEALTH_CONFIRM_MAX_ATTEMPTS/);
  assert.match(body, /setTimeout\(\(\) => confirmLauncherHealth\(attempt \+ 1\), HEALTH_CONFIRM_RETRY_MS\)/);
  const max = Number(/const HEALTH_CONFIRM_MAX_ATTEMPTS = (\d+);/.exec(MAIN)?.[1]);
  const delay = Number(/const HEALTH_CONFIRM_RETRY_MS = (\d+);/.exec(MAIN)?.[1]);
  // Launcher 60 sn'de geri alır; yeniden denemeler bu pencerenin içinde kalmalı.
  assert.ok(max > 1 && delay > 0 && max * delay < 60000);
});
