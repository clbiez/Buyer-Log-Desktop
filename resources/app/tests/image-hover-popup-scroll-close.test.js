'use strict';
// Model görseli önizlemesi: kaydırma / sanal tablo yeniden çizimi sonrasında
// mouseleave gelmese de önizleme açık kalmamalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appMain = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function block(start, end) {
  const from = appMain.indexOf(start);
  assert.notEqual(from, -1, `Başlangıç bulunamadı: ${start}`);
  const to = appMain.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Bitiş bulunamadı: ${end}`);
  return appMain.slice(from, to);
}

class Node { constructor(parent = null) { this.parent = parent; this.isConnected = true; }
  contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; } }
class Element extends Node { closest() { return this; } }

function loadHelpers() {
  const listeners = {};
  const document = { documentElement: new Element(), body: new Element(),
    addEventListener(type, fn, opts) { listeners[type] = { fn, opts }; } };
  let hidden = 0;
  const ctx = { Node, Element, document, kolHideImgPopup() { hidden++; ctx.__reset(); } };
  vm.createContext(ctx);
  const src = block('let _kolImgPopupAnchor=null;', 'function kolImageHoverAccessibleLabel');
  vm.runInContext(`${src}\n__reset=()=>{_kolImgPopupAnchor=null;};__set=kolSetImgPopupAnchor;__get=()=>_kolImgPopupAnchor;`, ctx);
  return { ctx, listeners, document, hidden: () => hidden };
}

test('kaydırma, önizlemeyi açan görseli içeren alanda önizlemeyi kapatır', () => {
  const h = loadHelpers();
  assert.equal(h.listeners.scroll.opts.capture, true);
  assert.equal(h.listeners.scroll.opts.passive, true);
  const scroller = new Element(), img = new Element(scroller), other = new Element();
  h.ctx.__set(img);
  h.listeners.scroll.fn({ target: other });
  assert.equal(h.hidden(), 0, 'ilgisiz alan kaydırması önizlemeyi kapatmaz');
  h.listeners.scroll.fn({ target: scroller });
  assert.equal(h.hidden(), 1);
  h.ctx.__set(img);
  h.listeners.scroll.fn({ target: h.document });
  assert.equal(h.hidden(), 2, 'sayfa kaydırması da kapatır');
});

test('imleç görselden çıkınca veya görsel DOMdan düşünce önizleme kapanır', () => {
  const h = loadHelpers();
  const row = new Element(), img = new Element(row), inner = new Element(img);
  h.ctx.__set(img);
  h.listeners.pointermove.fn({ target: inner });
  h.listeners.pointermove.fn({ target: img });
  assert.equal(h.hidden(), 0, 'görselin üzerindeyken açık kalır');
  h.listeners.pointermove.fn({ target: row });
  assert.equal(h.hidden(), 1);
  h.ctx.__set(img); img.isConnected = false;
  h.listeners.pointermove.fn({ target: img });
  assert.equal(h.hidden(), 2, 'yeniden çizimle silinen görsel önizlemeyi kapatır');
  h.listeners.pointermove.fn({ target: row });
  assert.equal(h.hidden(), 2, 'anchor yokken hiçbir şey yapılmaz');
});

test('önizleme anchor yaşam döngüsüne bağlı', () => {
  assert.match(block('const scheduleHover=', 'const invalidate='), /kolSetImgPopupAnchor\(img\)/);
  assert.match(block('function kolShowImgPopup', 'function kolPositionPopup'), /kolImgPopupAnchorFrom\(evt\)/);
  assert.match(block('function kolHideImgPopup', 'function bindDetailModelThumb'), /_kolImgPopupAnchor=null/);
  assert.match(block('new MutationObserver(mutations=>{\n  mutations.forEach(mutation=>mutation.addedNodes', '.observe(document.documentElement'),
    /!_kolImgPopupAnchor\.isConnected\)kolHideImgPopup\(\)/);
});
