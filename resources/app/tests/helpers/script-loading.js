'use strict';

/* Buyer Log açılışı v7.69'da lazy yüklemeye geçti: OAB, LFL, Automations,
 * Quotations, Outlook, formül motoru ve benzeri ağır modüller artık
 * index.html'de eager <script> etiketi DEĞİL; perf-runtime.js'teki ortak
 * yükleyicinin (ensureFeature / ensureLibrary / _loadScript) kayıt defterinde
 * duruyor ve ilgili ekrana geçilince yükleniyor.
 *
 * Testlerin çoğu "betik index.html'de mi?" diye soruyordu. O soru artık yanlış:
 * betik index.html'de OLMAMALI. Doğru soru "uygulama bu betiği yüklüyor mu?"
 * Bu yardımcı ikisini de bilir, böylece her test dosyası kendi kuralını
 * yeniden yazmaz ve bir sonraki lazy geçişinde yalnız burası güncellenir.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

function sources() {
  return { index: read('index.html'), perf: read('perf-runtime.js'), appMain: read('app-main.js') };
}

function escapeName(name) { return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Betik açılışta eager yükleniyor mu? */
function isEager(name, index = sources().index) {
  return new RegExp(`<script src="/?${escapeName(name)}[?"]`).test(index);
}

/** Betik lazy yükleyicinin kayıt defterinde mi (özellik grubu ya da doğrudan çağrı)? */
function isLazy(name, src = sources()) {
  const pattern = new RegExp(`'${escapeName(name)}(\\?[^']*)?'`);
  return pattern.test(src.perf) || pattern.test(src.appMain);
}

/**
 * Uygulamanın bu betiği bir şekilde yüklediğini doğrular ve hangi yolu
 * kullandığını döndürür ('eager' | 'lazy').
 */
function assertLoaded(name, message = '') {
  const src = sources();
  const eager = isEager(name, src.index);
  const lazy = isLazy(name, src);
  assert.ok(eager || lazy, `${name} ne eager ne de lazy yükleniyor. ${message}`.trim());
  return eager ? 'eager' : 'lazy';
}

/** Betiğin açılış kritik yolundan çıkarıldığını ve lazy yüklendiğini doğrular. */
function assertLazy(name, message = '') {
  const src = sources();
  assert.equal(isEager(name, src.index), false, `${name} açılışta eager yüklenmemeli. ${message}`.trim());
  assert.ok(isLazy(name, src), `${name} lazy yükleyicinin kaydında olmalı. ${message}`.trim());
}

module.exports = { sources, isEager, isLazy, assertLoaded, assertLazy };
