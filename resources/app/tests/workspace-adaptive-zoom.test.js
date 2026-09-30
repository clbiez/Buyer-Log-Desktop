'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adaptiveZoomFactor } = require('../electron/workspace-manager');

const MANAGER = fs.readFileSync(path.join(__dirname, '..', 'electron', 'workspace-manager.js'), 'utf8');
const display = (width, height, scaleFactor) => ({ scaleFactor, workArea: { x: 0, y: 0, width, height } });

test('büyük/100% ekranlarda zoom 1 kalır', () => {
  assert.equal(adaptiveZoomFactor(display(1920, 1040, 1)), 1);
  assert.equal(adaptiveZoomFactor(display(2560, 1400, 1)), 1);
  assert.equal(adaptiveZoomFactor(display(1707, 920, 1.5)), 1); // 2560x1440 @150%
});

test('1920x1080 @%150 dizüstünde içerik sığacak şekilde küçülür', () => {
  const factor = adaptiveZoomFactor(display(1280, 672, 1.5));
  assert.ok(factor < 1 && factor >= 0.75, String(factor));
});

test('1920x1080 @%125 ekranda hafif küçülür', () => {
  const factor = adaptiveZoomFactor(display(1536, 824, 1.25));
  assert.ok(factor < 1 && factor >= 0.8, String(factor));
});

test('fiziksel yazı %100 ölçekteki halinden küçülmez (1366x768 @%100)', () => {
  assert.equal(adaptiveZoomFactor(display(1366, 728, 1)), 1);
});

test('geçersiz ekran bilgisinde zoom 1', () => {
  assert.equal(adaptiveZoomFactor(null), 1);
  assert.equal(adaptiveZoomFactor({ workArea: { width: 0, height: 0 } }), 1);
});

test('sekme görünümü yerleşimde, taşımada ve ekran değişiminde otomatik zoom uygular', () => {
  assert.match(MANAGER, /applyAutoZoom\(state, active\)/);
  assert.match(MANAGER, /window\.on\('moved', \(\) => layout\(state\)\)/);
  assert.match(MANAGER, /display-metrics-changed/);
  assert.match(MANAGER, /setZoomFactor\(factor\)/);
});
