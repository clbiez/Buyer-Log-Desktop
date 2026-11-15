'use strict';
/* Yakalanmamış JS / Promise hataları ekranın sol altında kalıcı kırmızı kutu
   (#blErrBox) olarak birikiyordu ("PROMISE HATA: Cannot read properties of
   null (reading 'keys')"). Artık ortak bildirim sistemine (showToast →
   Bildirim Geçmişi) kısa ömürlü hata olarak gider; aynı mesaj tekrarlanmaz,
   #blErrBox yalnız gizli tanılama günlüğüdür. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'public/ui-startup.css'), 'utf8');

function extractHandlers() {
  const start = INDEX.indexOf('var errSeen=');
  const end = INDEX.indexOf('// Background module preparation', start);
  assert.ok(start > 0 && end > start, 'runtime error handler block not found');
  return INDEX.slice(start, end);
}

function harness({ withToast = true } = {}) {
  const listeners = {};
  const elements = {};
  const toasts = [];
  const timers = [];
  const documentElement = {
    lang: 'tr',
    appendChild(el) { elements[el.id] = el; },
  };
  const ctx = {
    Date, String, Object,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    english: () => false,
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    document: {
      documentElement,
      getElementById: id => elements[id] || null,
      createElement: () => ({ id: '', hidden: false, textContent: '', setAttribute() {} }),
    },
  };
  if (withToast) ctx.showToast = (msg, opts) => toasts.push({ msg, opts });
  vm.createContext(ctx);
  vm.runInContext(extractHandlers(), ctx);
  return { ctx, listeners, elements, toasts, timers };
}

test('unhandled rejection is routed to an error notification, not a persistent red box', () => {
  const h = harness();
  h.listeners.unhandledrejection({ reason: new TypeError("Cannot read properties of null (reading 'keys')") });
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].opts.kind, 'error');
  assert.match(h.toasts[0].msg, /reading 'keys'/);
  assert.doesNotMatch(h.toasts[0].msg, /PROMISE HATA/);
  const box = h.elements.blErrBox;
  assert.ok(box && box.hidden === true, 'diagnostic log must stay hidden');
});

test('repeated identical errors are shown once (no stacked duplicates)', () => {
  const h = harness();
  const ev = { reason: { message: 'boom' } };
  h.listeners.unhandledrejection(ev);
  h.listeners.unhandledrejection(ev);
  h.listeners.error({ message: 'x is not defined', filename: 'http://h/app-main.js', lineno: 7 });
  h.listeners.error({ message: 'x is not defined', filename: 'http://h/app-main.js', lineno: 7 });
  assert.equal(h.toasts.length, 2);
  assert.match(h.toasts[1].msg, /app-main\.js:7/);
});

test('errors before the notification layer loads are queued and flushed later', () => {
  const h = harness({ withToast: false });
  h.listeners.unhandledrejection({ reason: 'early' });
  assert.equal(h.timers.length, 1);
  const toasts = [];
  h.ctx.showToast = (msg, opts) => toasts.push({ msg, opts });
  h.timers.shift()();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].opts.kind, 'error');
});

test('legacy visible red error box styling is removed', () => {
  assert.match(CSS, /#blErrBox\{display:none!important;\}/);
  assert.doesNotMatch(INDEX, /box\.className='uiBootError'/);
});
