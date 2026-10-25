'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = require('./helpers/manifest-css')();
const code = fs.readFileSync(path.join(__dirname, '../public/corporate-connections-toolbar.js'), 'utf8');

function mount(states = {}, bridge = {}) {
  const buttons = {};
  for (const name of ['lcwai', 'plm', 'oab']) {
    buttons[name] = {
      dataset: {}, attributes: {}, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      click() { return this.listeners.click && this.listeners.click(); },
    };
  }
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    let status = {};
    if (url.startsWith('/api/lcwai/status')) status = { connected: Boolean(states.lcwai) };
    if (url === '/api/corenectum-api/status') status = { configured: Boolean(states.plm) };
    if (url === '/api/oab/auth/status') status = { authenticated: Boolean(states.oab) };
    if (url === '/api/oab/auth/connect') status = { connected: true };
    return { ok: true, json: async () => ({ ok: true, status }) };
  };
  const events = {};
  const document = {
    hidden: false, documentElement: { lang: 'tr' },
    getElementById: id => id === 'corporateConnections'
      ? { querySelector: selector => { const key = selector.match(/="([^"]+)"/)[1]; return buttons[key]; } }
      : null,
    addEventListener: (name, callback) => { events[name] = callback; },
  };
  const messages = [];
  const window = {
    document, appLang: 'tr', fetch, buyerLogDesktop: bridge,
    BLPerf: { _loadScript: async () => {} }, showToast: message => messages.push(message),
    setInterval: () => 1, addEventListener: (name, callback) => { events[name] = callback; },
  };
  vm.runInNewContext(code, { window, Date, Promise, Boolean });
  return { window, buttons, states, calls, messages, events };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('top bar has exactly three icon-free session buttons and retains F1 guide', () => {
  assert.match(html, /id="corporateConnections"[^>]*>/);
  for (const name of ['lcwai', 'plm', 'oab']) assert.match(html, new RegExp('data-corporate-connection="' + name + '"'));
  assert.doesNotMatch(html, /id="lcwaiTopBtn"|id="buyerLogGuideBtn"/);
  assert.match(html, /corporate-connections-toolbar\.js/);
  assert.match(html, /if\(ev\.key==='F1'\)/);
  assert.match(css, /\.corporateConnection\[data-state="connected"\]/);
  assert.match(css, /border-radius:var\(--ui-radius\)/);
});

test('independent statuses: only connected sessions are green; disconnected are grey', async () => {
  const mounted = mount({ lcwai: true, plm: false, oab: true });
  await tick();
  assert.equal(mounted.buttons.lcwai.dataset.state, 'connected');
  assert.equal(mounted.buttons.plm.dataset.state, 'disconnected');
  assert.equal(mounted.buttons.oab.dataset.state, 'connected');
  assert.ok(mounted.calls.some(c => c.url === '/api/oab/auth/status' && c.options.headers['X-BuyerLog-OAB-Transport'] === 'desktop') === false);
});

test('single click activates PLM desktop auth and verifies server-side status', async () => {
  const states = { plm: false };
  const mounted = mount(states, { ensureCoreNectumAuth: async () => { states.plm = true; return { ok: true }; } });
  await tick();
  await mounted.window.BLTopCorporateConnections.connect('plm');
  assert.equal(mounted.buttons.plm.dataset.state, 'connected');
  assert.match(mounted.messages.at(-1), /Bağlantı aktif/);
});

test('OAB Electron status selects desktop transport and cancelled sign-in remains grey', async () => {
  const mounted = mount({ oab: false }, {
    ensureOabAuth: async () => ({ ok: false, authenticated: false, code: 'OAB_AUTH_CANCELLED' }),
  });
  await tick();
  assert.ok(mounted.calls.some(c => c.url === '/api/oab/auth/status' && c.options.headers['X-BuyerLog-OAB-Transport'] === 'desktop'));
  await mounted.window.BLTopCorporateConnections.connect('oab');
  assert.equal(mounted.buttons.oab.dataset.state, 'disconnected');
  assert.match(mounted.messages.at(-1), /Bağlantı kurulamadı/);
});

test('LCW AI click uses the shared engine without exposing an auth token', async () => {
  const states = { lcwai: false };
  const mounted = mount(states);
  mounted.window.BuyerLogAI = { connect: async () => { states.lcwai = true; return { connected: true }; } };
  await tick();
  await mounted.window.BLTopCorporateConnections.connect('lcwai');
  assert.equal(mounted.buttons.lcwai.dataset.state, 'connected');
  assert.doesNotMatch(code, /Authorization|accessToken|password/);
});
