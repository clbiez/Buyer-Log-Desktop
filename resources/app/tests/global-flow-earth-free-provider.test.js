'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const settings = require('../server/lib/global-flow-earth-settings');
const settingsSource = fs.readFileSync(path.join(APP_ROOT, 'server/lib/global-flow-earth-settings.js'), 'utf8');
const earthSource = fs.readFileSync(path.join(APP_ROOT, 'public/overview-global-flow-earth.js'), 'utf8');

test('Earth ücretsiz sağlayıcı ve NASA modlarını destekler', () => {
  assert.ok(settings.PROVIDERS.includes('free'));
  assert.ok(settings.PROVIDERS.includes('offline'));
  assert.ok(settings.VIEW_MODES.includes('nasa-blue-marble'));
  assert.ok(settings.VIEW_MODES.includes('nasa-relief'));
});

test('yeni kurulum Earth için ücretsiz NASA görünümünü varsayılan yapar', () => {
  assert.match(settingsSource, /provider:\s*'free'/);
  assert.match(settingsSource, /defaultMode:\s*'nasa-relief'/);
  assert.match(earthSource, /provider:'free',defaultMode:'nasa-relief'/);
});

test('NASA GIBS anahtarsız WMTS katmanları Cesium renderer içinde tanımlıdır', () => {
  assert.match(earthSource, /gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best/);
  assert.match(earthSource, /BlueMarble_NextGeneration/);
  assert.match(earthSource, /BlueMarble_ShadedRelief/);
  assert.match(earthSource, /GoogleMapsCompatible_Level8/);
  assert.match(earthSource, /maximumLevel:8/);
});

test('Google anahtarı yoksa ücretli mod ücretsiz NASA relief görünümüne düşer', () => {
  assert.match(earthSource, /GOOGLE_MODES\.includes\(wanted\).*nasa-relief/);
  assert.match(settingsSource, /provider:\s*'free',\s*defaultMode:\s*freeMode/);
});
