'use strict';

/* deferredUi'nin ilk dosyası LCW AI istemcisidir. O tek dosya yüklenemediğinde
 * (zaman aşımı / geçici sunucu hatası) zincirin tamamı kesiliyor, kullanıcı
 * erişimi, sağ tık menüsü, kur gibi modüller hiç yüklenmiyor ve CP/Siparişler
 * sekmesinde "lcwai-assistant.js?rev=1 could not be loaded." ham uyarısı
 * çıkıyordu. İsteğe bağlı dosya düşse de zincir devam etmelidir; zorunlu bir
 * dosyanın hatası ise eskisi gibi yukarı iletilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function element() {
  const listeners = new Map();
  return {
    src: '', dataset: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    remove() {},
    _fire(type) { const fn = listeners.get(type); if (fn) fn(); },
  };
}

function runtimeFailing(shouldFail) {
  const appended = [];
  const document = {
    currentScript: { src: 'http://buyerlog/perf-runtime.js?v=1.0.0' },
    baseURI: 'http://buyerlog/',
    readyState: 'complete',
    scripts: [],
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement() { return element(); },
    head: {
      appendChild(el) {
        if (!el.src) return; // preload <link>
        appended.push(el.dataset.blLazy);
        setTimeout(() => el._fire(shouldFail(el.dataset.blLazy) ? 'error' : 'load'), 0);
      },
    },
  };
  const context = { document, URL, Promise, Map, Set, Date, Number, Math, Object, String, Array, Error, setTimeout, clearTimeout, queueMicrotask, performance: { now: () => 1, mark() {} }, console: { ...console, warn() {} } };
  context.window = context;
  vm.runInNewContext(PERF, context, { filename: 'perf-runtime.js' });
  return { perf: context.BLPerf, appended };
}

test('LCW AI istemcisi yüklenemese de deferredUi zinciri tamamlanır', async () => {
  const { perf, appended } = runtimeFailing(file => file.startsWith('lcwai-assistant.js'));
  await perf.ensureFeature('deferredUi');
  assert.equal(perf.isFeatureLoaded('deferredUi'), true);
  assert.ok(appended.includes('user-access-ui.js?rev=APP-UPDATE-V3'), 'kritik modül yine yüklenir');
  assert.ok(appended.includes('fx.js'), 'zincirin sonu da yüklenir');
});

test('zorunlu deferredUi dosyasının hatası yine iletilir', async () => {
  const { perf } = runtimeFailing(file => file === 'row-context-menu.js');
  await assert.rejects(perf.ensureFeature('deferredUi'), /row-context-menu\.js/);
  assert.equal(perf.isFeatureLoaded('deferredUi'), false);
});

test('sekme geçişindeki deferredUi hatası ham dosya adı yerine TR/EN mesaj gösterir', () => {
  assert.match(APP, /Some helper modules could not be loaded\. If a feature is missing, reload the page\./);
  assert.match(APP, /Bazı yardımcı modüller yüklenemedi\. Eksik bir özellik görürseniz sayfayı yenileyin\./);
});
