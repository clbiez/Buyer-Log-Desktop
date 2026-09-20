'use strict';

/*
 * Kullanıcı & Yetki Yönetimi arayüzünü Node içinde GERÇEKTEN çalıştırmak için
 * asgari DOM taklidi.
 *
 * Gerekçe (v6.36 dersinin tekrarı): `node --check` şablon dizesi içindeki
 * tanımsız değişkeni sorunsuz geçirir; çizim kodu bir kez gerçekten
 * çalıştırılmadan hata görünmez. Bu yardımcı modülün açılış → yükleme → çizim
 * yolunu koşturur, kabuğa bağlanan olay dinleyicilerini yakalar ve her
 * bölümün ürettiği HTML'i geri verir.
 */

const vm = require('node:vm');

function fakeNode(tag = 'div') {
  const cache = new Map();
  const listeners = new Map();
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '', innerHTML: '', textContent: '', value: '', checked: false, disabled: false,
    type: '', hidden: false,
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [],
    listeners,
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(child) { node.children.push(child); return child; },
    append(child) { node.children.push(child); return child; },
    before() {}, after() {}, remove() {}, focus() {}, blur() {}, setSelectionRange() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {}, dispatchEvent() { return true; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    contains() { return true; },
    closest() { return null; },
    querySelector(selector) {
      if (!cache.has(selector)) cache.set(selector, fakeNode());
      return cache.get(selector);
    },
    querySelectorAll() { return []; },
  };
  return node;
}

// Tek bir seçiciye yanıt veren sahte olay hedefi. `matchers`, seçici → düğüm
// eşlemesidir; kod hangi seçiciyi soruyorsa yalnız onu bulur.
function eventTarget(matchers) {
  return {
    closest(selector) {
      const key = Object.keys(matchers).find(item => item === selector);
      return key ? matchers[key] : null;
    },
  };
}

function loadUserManagement({ model, source, appLang = 'tr', fetchImpl } = {}) {
  const body = fakeNode('body');
  const documentListeners = new Map();
  const doc = {
    readyState: 'complete',
    body,
    createElement: tag => fakeNode(tag),
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const win = {
    innerWidth: 1600, innerHeight: 1000,
    addEventListener() {}, removeEventListener() {},
    document: doc,
  };
  const calls = [], alerts = [];
  const context = {
    window: win, document: doc, appLang, console,
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, queueMicrotask,
    Event: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    FormData: class { constructor() { this.map = new Map(); } get(key) { return this.map.get(key); } set(key, value) { this.map.set(key, value); } },
    alert: message => alerts.push(message),
    confirm: () => true,
    location: { assign() {} },
    fetch: fetchImpl || (async (url, options) => {
      calls.push({ url, options: options || {}, body: options && options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, statusText: 'OK', json: async () => model };
    }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'user-management.js' });

  const env = {
    win, doc, body, calls, alerts, context,
    api: context.window.BLUserManagement,
    get overlay() { return body.children[0] || null; },
    get shell() { return env.overlay ? env.overlay.querySelector('.umShell') : null; },
    get dialog() { return body.children[1] || null; },
    html(selector) { return env.shell ? env.shell.querySelector(selector).innerHTML : ''; },
    get main() { return env.html('[data-um-main]'); },
    get nav() { return env.html('[data-um-nav]'); },
    fire(type, target) {
      const handlers = (env.shell && env.shell.listeners.get(type)) || [];
      const event = { target, currentTarget: target, preventDefault() {}, stopPropagation() {}, key: target.key };
      for (const handler of handlers) handler(event);
    },
    click(dataset) { env.fire('click', eventTarget({ '[data-act]': { dataset } })); },
    input(selector, value, dataset = {}) { env.fire('input', eventTarget({ [selector]: { dataset, value } })); },
    change(selector, node) { env.fire('change', eventTarget({ [selector]: node })); },
    async open() {
      env.api.open();
      // reload() içindeki fetch zincirinin çözülmesini bekle.
      for (let index = 0; index < 6; index += 1) await new Promise(resolve => setImmediate(resolve));
      return env;
    },
  };
  return env;
}

module.exports = { fakeNode, eventTarget, loadUserManagement };
