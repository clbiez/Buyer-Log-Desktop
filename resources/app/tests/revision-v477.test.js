'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rules = require(path.join(ROOT, 'public', 'business-rules.js'));
const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const css = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v4.77 delivery-delay fact survives as a structured signal after legacy CP Priority removal', () => {
  const result = rules.computePriorityFlags({
    status: 'Üretimde',
    exFactory: '2026-01-05',
    retailDate: '2026-01-20',
    inStoreDate: '2026-01-25',
    delType: 'Gemi',
    today: '2026-01-01',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'priority'), false);
  assert.equal(result.signals.some(item => item.code === 'DELIVERY_DELAY'), true);
});

test('v4.77 discount remains a canonical operational signal, not a Priority label', () => {
  const result = rules.computePriorityFlags({
    status: 'Üretimde',
    exFactory: '2026-01-01',
    retailDate: '2026-02-01',
    inStoreDate: '2026-02-10',
    delType: 'Gemi',
    today: '2026-01-20',
  });
  assert.equal(result.discountWarning, true);
  assert.equal(result.signals.some(item => item.code === 'DISCOUNT_DELAY'), true);
});

test('v4.77 explicit CP shortage remains a structured operational signal', () => {
  const result = rules.computePriorityFlags({
    status: 'Yol Operasyonları',
    shortage: true,
    shortageQty: 200,
    exFactory: '2026-01-01',
    retailDate: '2026-04-01',
    inStoreDate: '2026-04-20',
    delType: 'Gemi',
    today: '2026-02-01',
  });
  assert.equal(result.shortageNote, true);
  assert.equal(result.signals.some(item => item.code === 'SHORTAGE'), true);
});

test('v4.77 CP image click gives temporary feedback and never remains selected', () => {
  assert.match(html, /cpThumbFlash/);
  assert.match(html, /setTimeout\(\(\)=>img\.classList\.remove\('cpThumbFlash'\),320\)/);
  assert.doesNotMatch(html, /cpThumbActive/);
  assert.match(css, /\.cpThumbFlash\{opacity:\.65/);
  require('./helpers/manifest-css').assertStaticMotion();
});

test('v4.77 filter and selection popups center on their trigger and ignore internal scrolling', () => {
  assert.match(html, /ar\.left\+\(ar\.width-pw\)\/2/);
  assert.match(html, /popupOwnsScrollTarget\(event\.target\)/);
  assert.match(html, /window\.positionBuyerLogPopup=positionFloating/);
  assert.match(css, /overscroll-behavior:contain/);
});

test('v4.77 Data Model Connection uses large non-blurred workspaces', () => {
  // v7.26: Field Mapping EKRANI kullanıcı talebiyle arayüzden kaldırıldı
  // ("gerek yok gibi görünüyor, gerek yoksa kaldır"); eşleme artık model
  // şemasından kendiliğinden kurulup onarılıyor. Testin pencere düzenine
  // ilişkin AMACI korunur, kaldırılan ekrana ait beklentiler düşürülür.
  assert.match(css, /\.modelConnCard\{width:min\(1500px/);
  assert.doesNotMatch(require("./helpers/manifest-css").rules(/warnOverlay/), /backdrop-filter:(?!none)/);
  assert.doesNotMatch(require("./helpers/manifest-css").rules(/sourceBackdrop/), /backdrop-filter:(?!none)/);
  assert.doesNotMatch(html, /id="_mcPreviewBox"/);
  assert.doesNotMatch(html, /data-scope-preview=/);
});

test('v4.77 zorunlu alan eşlemesi eksikse Yenile bunu belli eder', () => {
  // Uyarı ŞERİDİ kaldırıldı ama sessizlik doğru cevap değil: Yenile düğmesi
  // eksik eşlemede hâlâ işaretlenir ve LFL Para Birimi istisnası korunur.
  assert.match(html, /fieldMappingError/);
  assert.match(html, /PARA BIRIMI.*LFL/s);
  assert.match(css, /#topRefreshBtn\.fieldMappingError/);
});
