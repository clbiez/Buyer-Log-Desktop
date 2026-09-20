'use strict';

/* v9.65 — Unified Priority canlı deadlock regresyonu.
 *
 * order-decision-engine.js parser ile index.html'de eager yüklenmişti; aynı
 * dosya cpAssistant lazy listesinde de bulununca perf-runtime mevcut <script>
 * etiketinin çoktan geçmiş `load` event'ini bekleyerek Promise'i sonsuza kadar
 * pending bırakıyordu. Modern HTMLScriptElement.readyState güvenilir değildir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* v10.14 — Sürüm etiketi package.json'dan türetilir. Sabit yazılırsa test
   her yayında kırılır; ölçülen şey sürüm numarası değil, lazy listedeki
   dosyanın eager yüklenmiş <script> etiketiyle EŞLEŞMESİDİR. */
const ASSET_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const RENDERED_HTML = HTML.replace(/__BL_ASSET_VERSION__/g, ASSET_VERSION);

function scriptElement(src) {
  const listeners = new Map();
  return {
    src,
    dataset: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    remove() {},
    _listeners: listeners,
  };
}

function loadPerfRuntime(existingScripts) {
  const currentScript = scriptElement('http://buyerlog/perf-runtime.js?v=' + ASSET_VERSION + '&rev=4');
  const document = {
    currentScript,
    baseURI: 'http://buyerlog/',
    readyState: 'complete',
    scripts: existingScripts,
    createElement(tag) { return scriptElement(''); },
    head: { appendChild() { throw new Error('existing eager script should not be appended again'); } },
  };
  const context = {
    document,
    URL,
    Promise,
    Map,
    Date,
    Number,
    Math,
    Object,
    String,
    Array,
    Error,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    performance: { now: () => 1, mark() {} },
    console,
  };
  context.window = context;
  vm.runInNewContext(PERF, context, { filename: 'perf-runtime.js' });
  return context;
}

test('v9.65 daha önce eager yüklenmiş static script geçmiş load eventini beklemez', async () => {
  const existing = scriptElement('http://buyerlog/order-decision-engine.js?v=' + ASSET_VERSION);
  // readyState özellikle YOK: Chrome/Firefox'ta modern script elementlerinin
  // bu legacy özelliğine güvenemeyiz.
  const runtime = loadPerfRuntime([existing]);
  const loaded = await Promise.race([
    runtime.BLPerf._loadScript('order-decision-engine.js'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('loader remained pending')), 100)),
  ]);
  assert.equal(loaded, existing);
  assert.equal(existing.dataset.blState, 'loaded');
});

test('v9.65 eager order decision lazy CP/Backlog listelerinde duplicate edilmez', () => {
  /* Regex yerine düz metin: sürüm etiketi bir regex değil, birebir eşleşmesi
     gereken bir dize. Kaçış hatası burada sessiz bir yanlış eşleşme üretirdi. */
  const eagerTag = `<script src="order-decision-engine.js?v=${ASSET_VERSION}"></script>`;
  assert.ok(RENDERED_HTML.includes(eagerTag), `index.html eager etiketi taşımalı: ${eagerTag}`);
  assert.doesNotMatch(PERF, /cpAssistant:\[[^\]]*order-decision-engine\.js/);
  assert.doesNotMatch(PERF, /backlogAnalysis:\[[^\]]*order-decision-engine\.js/);
});

test('v9.65 cpAssistant yalnız unified decision API gerçekten varsa hazır sayılır', () => {
  assert.match(PERF, /global\.BLCpAssistant&&typeof global\.BLCpAssistant\.computeDecisionsForRows==='function'/);
});
