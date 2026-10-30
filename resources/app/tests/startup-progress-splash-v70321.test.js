'use strict';

/*
 * GÜNCELLEME SONRASI İLK AÇILIŞ BİLGİSİ (7.0.321). Güncellemenin ilk açılışında
 * launcher iki çekirdeği doğrulayıp yerel veri checkpointi alıyor, ardından
 * kurulum onarımı ve sunucu/veritabanı açılışı dakikalar sürebiliyordu; ekran
 * ise normal bir açılış gibi yalnız "başlatılıyor" diyordu. Bu testler
 *   - launcher bildiriminin güncelleme/geri alma kipini,
 *   - açılış ekranının adım adım ilerlemesini (TR/EN),
 *   - sunucu [PERF] işaretlerinin yalnız tam satırdan adım olarak iletilmesini
 * kilitler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { BackendProcess } = require('../electron/backend');

const ELECTRON = path.resolve(__dirname, '..', 'electron');
const main = fs.readFileSync(path.join(ELECTRON, 'main.js'), 'utf8');
const splash = fs.readFileSync(path.join(ELECTRON, 'splash.html'), 'utf8');
const launcherSource = fs.readFileSync(path.join(ELECTRON, 'launcher-core.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function launcherNotice(state) {
  const notices = [];
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, setPath() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), exit() {}, quit() {}, relaunch() {},
  });
  class Notice extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); notices.push(this); }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() {}
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const lifecycle = {
    readState: () => state, rollbackExistingTrial: () => null, activatePending: () => null,
    currentPointer: () => ({ appCoreRoot: '/portable/.buyerlog-versions/current/app', version: '7.0.320' }),
  };
  const context = {
    __dirname: '/trusted/electron', module: { exports: {} }, global: {}, setTimeout, clearTimeout, setImmediate,
    process: { env: {}, execPath: '/portable/BuyerLog.exe', pid: 1 },
    require: name => {
      if (name === 'fs') return { readFileSync: () => '{"launcherVersion":"1.2.0"}', mkdirSync() {}, appendFileSync() {} };
      if (name === 'path') return path;
      if (name === 'electron') return { app, BrowserWindow: Notice, dialog: { showErrorBox() {} } };
      if (name === './portable-paths') return { resolvePortableRoot: () => '/portable', desktopPaths: () => ({ electronProfileRoot: '/profile' }) };
      if (name === './update/launcher-state') return { createLauncherState: () => lifecycle };
      if (name === './update/semver') return { compareSemver: () => 0 };
      if (name === './manual-patch/manager') return { createInstalledManager: () => ({}) };
      if (name === './manual-patch/core-verification') return { verifyPackagedCore() {} };
      if (name.endsWith('main.js')) return undefined;
      throw new Error('Unexpected require: ' + name);
    },
  };
  vm.runInNewContext(launcherSource, context);
  context.module.exports.start();
  return notices;
}

test('launcher bildirimi bekleyen güncellemede "Güncelleme uygulanıyor" ve kapatmama uyarısı gösterir', async () => {
  const notices = launcherNotice({ pending: { ready: true, appCoreRoot: '/pending', version: '7.0.321' } });
  await tick();
  const html = decodeURIComponent(notices[0].url);
  assert.match(html, /Güncelleme uygulanıyor…/);
  assert.match(html, /Applying the update…/);
  assert.match(html, /Lütfen kapatmayın/);
  assert.match(html, /Please do not close Buyer Log/);
  assert.doesNotMatch(html, /Buyer Log açılıyor…/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{i::after\{animation:none/);
});

test('launcher bildirimi onaylanmamış denemede geri alma metnini, normal açılışta eski metni gösterir', async () => {
  const rollback = launcherNotice({ activation: { status: 'trial', version: '7.0.321' }, pending: null });
  await tick();
  assert.match(decodeURIComponent(rollback[0].url), /Önceki sürüme dönülüyor…/);
  assert.match(decodeURIComponent(rollback[0].url), /Returning to the previous version…/);
  const normal = launcherNotice({ pending: null });
  await tick();
  assert.match(decodeURIComponent(normal[0].url), /Buyer Log açılıyor…/);
  assert.match(decodeURIComponent(normal[0].url), /Buyer Log is opening…/);
});

test('sunucu [PERF] işaretleri yalnız tam satırdan ve yalnız ad olarak açılış adımına iletilir', () => {
  const markers = [];
  const backend = new BackendProcess({
    paths: { logsRoot: '/unused' }, appCoreRoot: '/unused',
    onStartupProgress: name => markers.push(name),
  });
  backend.child = { pid: 1 };
  backend.exited = false;
  backend.observeStartupOutput('[PERF] APP_BOOT_START +1ms\n[PERF] LOCAL_DB_CONF');
  assert.deepEqual(markers, ['APP_BOOT_START']);
  backend.observeStartupOutput('IG_PATH +40ms\nINFO [PERF] SPOOFED +1ms\n[PERF] lower +1ms\n');
  assert.deepEqual(markers, ['APP_BOOT_START', 'LOCAL_DB_CONFIG_PATH']);
  backend.observeStartupOutput('[PERF] SERVER_READY +90ms\n[PERF] LOCAL_DB_READY +95ms\n[PERF] LATE +99ms\n');
  assert.deepEqual(markers.slice(2), ['SERVER_READY', 'LOCAL_DB_READY', 'LATE']);
  backend.observeStartupOutput('[PERF] AFTER_READY +120ms\n');
  assert.equal(markers.includes('AFTER_READY'), false, 'hazır olduktan sonra açılış adımı akışı durur');
});

function body(name) {
  const start = main.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' bulunamadı');
  const ends = [main.indexOf('\nfunction ', start + 1), main.indexOf('\nasync function ', start + 1)].filter(i => i > 0);
  return main.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('açılış adımları gerçek iş sırasına bağlıdır ve yalnız ileri gider', () => {
  const start = body('startBuyerLog');
  const at = token => { const i = start.indexOf(token); assert.ok(i >= 0, token + ' yok'); return i; };
  assert.ok(at("setSplashStep('data')") < at('runFirstRunMigration('));
  assert.ok(at("setSplashStep('server')") < at('backend.start()'));
  assert.ok(at("setSplashStep('screens')") < at('createMainWindow(bound.origin)'));
  assert.match(start, /onStartupReady: \(\) => \{[\s\S]*?confirmLauncherHealth\(\);[\s\S]*?setSplashStep\('finish'\)/);
  assert.match(start, /marker === 'LOCAL_DB_CONFIG_PATH'\) setSplashStep\('database'\)/);
  assert.match(body('setSplashStep'), /SPLASH_STEPS\.indexOf\(step\) <= SPLASH_STEPS\.indexOf\(splashState\.step\)/);
  assert.match(body('startupIsUpdate'), /BUYER_LOG_UPDATE_HEALTH_TOKEN/);
  assert.match(body('startupIsUpdate'), /readRepairReport\(/);
  // Ana süreçten yalnız JSON durum nesnesi gider; HTML/metin enjekte edilmez.
  assert.match(body('pushSplashState'), /window\.BLSplash\.update\(' \+ JSON\.stringify\(splashState\) \+ '\)/);
  assert.match(body('shutdown'), /await rememberUiLanguage\(\)/);
  // Son pencere kapatılınca sekmeler kapanıştan önce yok olur: dil çalışırken izlenir.
  assert.match(main, /onFirstRendererReady: \(\) => \{[\s\S]*?watchUiLanguage\(\)/);
  assert.match(body('watchUiLanguage'), /setInterval\(/);
});

function renderSplash(query) {
  const script = splash.slice(splash.indexOf('<script>') + 8, splash.indexOf('</script>'));
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const el = {
        id, textContent: '', className: '', style: {}, attrs: {}, children: [],
        setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
        get lastChild() { return this.children[this.children.length - 1]; },
      };
      elements.set(id, el);
    }
    return elements.get(id);
  };
  const document = {
    documentElement: {}, title: '',
    getElementById: element,
    createElement: () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } }),
  };
  const window = {};
  vm.runInNewContext(script, {
    window, document, URLSearchParams, Date, Math, Number, String,
    location: { search: '?' + new URLSearchParams(query).toString() },
    setInterval: () => 0,
  });
  return { window, document, element };
}

test('açılış ekranı güncelleme kipinde başlık, uyarı, adım listesi ve dili doğru çizer', () => {
  const { window, document, element } = renderSplash({ mode: 'update', lang: 'tr', v: '7.0.321', step: 'repair', t0: String(Date.now() - 65000) });
  assert.equal(element('title').textContent, 'Güncelleme uygulanıyor');
  assert.match(element('hint').textContent, /kapatmayın/);
  assert.equal(element('version').textContent, 'Sürüm 7.0.321');
  const steps = element('steps').children;
  assert.equal(steps.length, 7);
  assert.deepEqual(steps.map(s => s.attrs['data-state']), ['done', 'active', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.match(element('status').textContent, /^Adım 2 \/ 7 · Eski ekran önbelleği temizleniyor$/);
  assert.match(element('elapsed').textContent, /^Geçen süre 1:0[45]$/);
  window.BLSplash.update({ step: 'server', lang: 'en' });
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(element('title').textContent, 'Applying the update');
  assert.match(element('status').textContent, /^Step 4 of 7 · Starting the Buyer Log server$/);
  // Bilinmeyen adım, geçersiz sürüm metni ve gelecekteki zaman yok sayılır.
  window.BLSplash.update({ step: '<img>', version: '<b>x</b>', startedAt: Date.now() + 60000 });
  assert.match(element('status').textContent, /Starting the Buyer Log server/);
  assert.equal(element('version').textContent, 'Version 7.0.321');
});

test('normal açılış kısa adım listesi gösterir ve uyarı yalnız uzun adımda çıkar', () => {
  const { element } = renderSplash({ lang: 'tr', v: '7.0.321' });
  assert.equal(element('title').textContent, 'Buyer Log başlatılıyor');
  assert.equal(element('hint').textContent, '');
  assert.equal(element('steps').children.length, 5);
  assert.match(element('status').textContent, /^Adım 1 \/ 5 · Veri klasörü ve ayarlar hazırlanıyor$/);
});

test('her açılış adımının TR ve EN metni vardır ve ana süreçteki adım listesiyle aynıdır', () => {
  const ids = JSON.parse(main.match(/const SPLASH_STEPS = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
  for (const lang of ['tr', 'en']) {
    const block = splash.slice(splash.indexOf(lang + ': {'));
    const steps = block.slice(block.indexOf('steps: {'), block.indexOf('}', block.indexOf('steps: {')));
    for (const id of ids) assert.match(steps, new RegExp('\\b' + id + ": '[^']+'"), lang + ' ' + id);
  }
  assert.match(splash, /prefers-reduced-motion: reduce/);
});
