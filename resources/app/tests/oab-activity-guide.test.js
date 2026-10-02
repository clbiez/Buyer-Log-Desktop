'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OAB_JS = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP_CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('OAB activity guide stays inside the OAB widget and does not use a global overlay', () => {
  const oabStart = INDEX.indexOf('id="oabSection"');
  const guide = INDEX.indexOf('id="oabActivityGuide"');
  const intake = INDEX.indexOf('id="intakeSection"');
  assert.ok(oabStart >= 0 && guide > oabStart, 'activity guide must be inside OAB markup');
  assert.ok(intake < 0 || guide < intake, 'activity guide must not spill into the next Overview widget');
  assert.match(APP_CSS, /\.oabActivityGuide\{[^}]*position:relative/);
  assert.doesNotMatch(APP_CSS, /\.oabActivityGuide\{[^}]*position:(?:fixed|absolute)/);
  assert.match(APP_CSS, /\.oabActivityGuide\{[^}]*overflow:hidden/);
});

test('OAB activity guide visualizes browser, sign-in, fetch, process and completion stages', () => {
  for (const stage of ['prepare', 'browser', 'login', 'fetch', 'process', 'done', 'error']) {
    assert.ok(OAB_JS.includes(`${stage}:`), `missing activity copy for ${stage}`);
  }
  assert.match(OAB_JS, /oabActivitySignal\('browser'\)/);
  assert.match(OAB_JS, /oabActivityFromAuthStatus\(status\)/);
  assert.match(OAB_JS, /oabSetActivity\('login'\)/);
  assert.match(OAB_JS, /oabSetActivity\('fetch'/);
  assert.match(OAB_JS, /oabSetActivity\('process'\)/);
  assert.match(OAB_JS, /oabFinishActivity\(/);
});

test('OAB browser safety warning is shown during browser-dependent stages', () => {
  assert.match(OAB_JS, /Edge\/Chrome sekmesini kapatmayın/);
  assert.match(OAB_JS, /keepBrowser:\s*true/);
  assert.match(INDEX, /id="oabActivityWarning"/);
});
