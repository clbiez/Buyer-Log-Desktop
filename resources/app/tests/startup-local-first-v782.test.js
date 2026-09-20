'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');

test('startup telemetrisi ağır frontend kaynaklarından önce başlar', () => {
  const perfRuntime = INDEX.indexOf('perf-runtime.js');
  assert.ok(perfRuntime >= 0, 'perf-runtime.js yüklenmiyor');
  assert.match(INDEX, /PRE_FRONTEND_STEP_[A-Z_]+/);
  assert.match(PERF, /mark\(['"]FRONTEND_BOOT_START['"]/);
  assert.match(SERVER, /'FRONTEND_BOOT_START'/);
  assert.match(SERVER, /'PRE_FRONTEND_STEP_APP_SCRIPTS_READY'/);
  assert.match(SERVER, /server received \+\$\{entry\.elapsedMs\}ms/);
});

test('Excel motoru ilk çizimi bloklamadan UI sonrasında yüklenir', () => {
  assert.doesNotMatch(INDEX, /<script[^>]+src=["'][^"']*vendor\/xlsx-style\.js/);
  assert.match(PERF, /xlsx:\s*\{\s*global:\s*['"]XLSX['"]/);
  assert.match(APP, /ensureExcel\(['"]xlsx['"]\)/);
  assert.match(INDEX, /ensureLibrary\(['"]xlsx['"]\)/);
});

test('sunucu hazır zamanı ile istemci startup raporu ayrı ölçülür', () => {
  assert.match(SERVER, /markStartup\('SERVER_READY'/);
  assert.match(SERVER, /markStartup\('STARTUP_CLIENT_REPORT_RECEIVED'/);
  assert.match(SERVER, /source:\s*'client'/);
});

test('emekliye ayrılmış legacy migration startup akışında çağrılmaz', () => {
  const beforeListen = SERVER.slice(0, SERVER.indexOf('const httpServer = app.listen'));
  assert.doesNotMatch(beforeListen, /migrateLegacyFiles\(localDb/);
});

test('uzak kullanıcı tercihi birleştirmesi UI_READY sonrasına bırakılır', () => {
  const start = APP.indexOf('async function loadFromServer');
  const block = APP.slice(start, start + 20000);
  const dataFetch = block.indexOf("fetch(force ? '/api/refresh'");
  assert.ok(dataFetch >= 0, 'ilk yerel veri isteği bulunamadı');
  assert.doesNotMatch(block, /BLStorage\.hydrate/);
  const postUi = APP.slice(APP.indexOf('function hydrateUserPreferencesAfterUi'), APP.indexOf('async function refreshSyncStatusBadge'));
  assert.match(postUi, /hydrateUserPreferencesAfterUi\(\)/);
  assert.match(postUi, /AUTH_USER_LOAD_START/);
  assert.match(postUi, /AUTH_USER_LOAD_READY/);
  const readyBlock = APP.slice(APP.indexOf("window.BLPerf?.mark?.('UI_READY')"), APP.indexOf('async function refreshFolderLabel'));
  assert.match(readyBlock, /schedulePostUiStartupTasks\(\)/);
});

test('startup yanıtı Overview projeksiyonunu UI öncesi gunzip/parse etmez', () => {
  const start = SERVER.indexOf('async function loadCachedPageProjectionSet');
  const end = SERVER.indexOf('function backlogCacheKey', start);
  const block = SERVER.slice(start, end);
  assert.ok(start >= 0 && end > start, 'startup cache okuyucusu bulunamadı');
  assert.match(block, /if\s*\(startup\)\s*return\s*\{\s*ctx,\s*hit:\s*false,\s*manifest\s*\}/);
  assert.doesNotMatch(block, /const wanted\s*=\s*startup\s*\?\s*\[['"]overview['"]\]/);
});

test('OAB, heartbeat ve service worker UI_READY sonrasına bırakılır', () => {
  assert.doesNotMatch(INDEX, /<script[^>]+src=["'][^"']*oab\.js/);
  assert.match(APP, /function ensureOverviewOabModule\(/);
  assert.match(APP, /schedulePostUiStartupTasks\(\)/);
  assert.match(INDEX, /window\.BL_START_HEARTBEAT\s*=/);
  assert.match(INDEX, /window\.BL_REGISTER_SERVICE_WORKER\s*=/);
  assert.doesNotMatch(INDEX, /beat\(\);\s*setInterval\(beat/);
});

test('Overview açılışında sekme-özel yardımcı modüller eager yüklenmez', () => {
  for (const file of [
    'formula-engine.js', 'formula-columns.js', 'row-context-menu.js', 'email-groups.js',
    'quick-filter-groups.js', 'kpi-groups.js', 'user-access-ui.js', 'user-management.js',
    /* v7.81: horizon-editor.js SİLİNDİ (kişisel ufuk kaldırıldı). */
    'outlook-mail.js', 'override-sync.js', 'backup-manager.js', 'fx.js',
  ]) {
    assert.doesNotMatch(INDEX, new RegExp(`<script[^>]+src=["']${file.replace('.', '\\.')}`));
  }
  assert.match(PERF, /deferredUi:\[/);
  assert.match(APP, /ensureFeature\(['"]deferredUi['"]\)/);
});
