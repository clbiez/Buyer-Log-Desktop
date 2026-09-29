'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'table-toolbar-action-cleanup.js'), 'utf8');

test('CP Orders Collection ortak toolbar cleanup katmanı yüklenir', () => {
  assert.match(INDEX, /table-toolbar-action-cleanup\.js\?v=__BL_ASSET_VERSION__/);
  for (const marker of [
    "cp: { tools: 'cpToolsMenu', more: 'cpMoreMenu' }",
    "orders: { tools: 'ordersToolsMenu', more: 'ordersMoreMenu' }",
    "koleksiyon: { tools: 'kolToolsMenu', more: 'kolMoreMenu' }",
  ]) assert.ok(UI.includes(marker), `page map missing: ${marker}`);
});

test('CP ve Orders Koleksiyona Kopyala eylemini Araçlar menüsünde tutar', () => {
  assert.ok(UI.includes("el('cpCopyToKolBtn')"));
  assert.match(UI, /page !== 'cp' && page !== 'orders'/);
  assert.ok(UI.includes("PAGE_MAP[page].tools"));
  assert.ok(UI.includes("button.classList.add('toolbarMenuNativeItem')"));
});

test('Kopyala ve Excel export CP Orders Collection üzerinde ikon-only olur', () => {
  for (const id of ['navCopy', 'navExcelBtn', 'kolCopySelectedBtn', 'kolExportImgBtn', 'kolAddRowBtn']) {
    assert.ok(UI.includes(`'${id}'`), `icon-only target missing: ${id}`);
  }
  assert.match(CSS, /\.tableActionIconOnly\{[\s\S]*?width:var\(--ctl-h\)!important;/);
  assert.match(CSS, /\.tableActionIconOnly>span\{display:none!important;\}/);
  assert.ok(UI.includes("button.setAttribute('aria-label', label)"), 'icon buttons must keep an accessible name');
});

test('icon actions keep their SVG and use in-place working feedback', () => {
  assert.match(UI, /function begin\(buttonOrId, options\)/);
  assert.match(UI, /classList\.add\('isActionWorking'\)/);
  assert.match(UI, /function finish\(buttonOrId, ok = null\)/);
  assert.match(INDEX, /id="kolAddRowBtn"[^>]*aria-label="Yeni Model Ekle"[^>]*><svg/);
  assert.doesNotMatch(INDEX, /id="kolAddRowBtn"[^>]*>[\s\S]{0,160}<span[^>]*>Yeni Model Ekle/);
});

test('Sütunlar kontrolü CP Orders Collection ⋯ menüsüne taşınır', () => {
  assert.ok(UI.includes("el('navColsBtn')"));
  assert.ok(UI.includes("const menu = el(config.more)"));
  assert.ok(UI.includes("wrap.classList.add('toolbarMenuColumns')"));
  assert.match(CSS, /\.toolbarMoreMenu>\.toolbarMenuColumns>#navColsBtn\{[\s\S]*?width:100%;/);
});

test('yeniden yerleşim düğümleri klonlamaz ve mevcut action handlerları korur', () => {
  assert.doesNotMatch(UI, /cloneNode|outerHTML|innerHTML\s*=/);
  assert.ok(UI.includes('parent.insertBefore(node, before || null)'));
  assert.ok(UI.includes("new MutationObserver(queueEnforce).observe(document.body"));
});

// Regresyon: Sütunlar sarmalayıcısı ⋯ menüsünün zaten ilk çocuğuyken
// moveNode, insertBefore(node, node) ile düğümü söküp yeniden takıyordu.
// Menüdeki MutationObserver bunu görüp her karede enforce'u yeniden
// kuyruğa alıyor; basılı tutulan tıklamada düğüm DOM'dan ayrıldığı için
// click olayı hiç oluşmuyor ve Sütunlar düğmesine basılamıyordu.
function loadCleanupWithFakeDom(page) {
  const vm = require('node:vm');
  const byId = new Map();
  let inserts = 0;
  const rafQueue = [];
  const observers = [];
  function makeNode(id, className = '') {
    const node = {
      id, nodeType: 1, parentNode: null, children: [],
      classes: new Set(className.split(/\s+/).filter(Boolean)),
      attrs: {}, textContent: id,
      get firstElementChild() { return this.children[0] || null; },
      get nextSibling() {
        const siblings = this.parentNode ? this.parentNode.children : [];
        return siblings[siblings.indexOf(this) + 1] || null;
      },
      classList: null,
      getAttribute(name) { return this.attrs[name] || null; },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      closest(selector) {
        const cls = selector.replace(/^\./, '');
        for (let n = this; n; n = n.parentNode) if (n.classes && n.classes.has(cls)) return n;
        return null;
      },
      insertBefore(child, before) {
        inserts += 1;
        const removed = [];
        if (child.parentNode) {
          const list = child.parentNode.children;
          list.splice(list.indexOf(child), 1);
          removed.push(child);
        }
        let ref = before === child ? child.nextSibling : before;
        const idx = ref ? this.children.indexOf(ref) : -1;
        if (idx >= 0) this.children.splice(idx, 0, child);
        else this.children.push(child);
        child.parentNode = this;
        for (const o of observers) if (o.roots.includes(this)) o.cb([{ addedNodes: [child], removedNodes: removed }]);
        return child;
      },
      appendChild(child) { return this.insertBefore(child, null); },
    };
    node.classList = { add: c => node.classes.add(c), contains: c => node.classes.has(c) };
    if (id) byId.set(id, node);
    return node;
  }
  const body = makeNode('', '');
  body.dataset = { activeTab: page };
  const moreId = { cp: 'cpMoreMenu', orders: 'ordersMoreMenu', koleksiyon: 'kolMoreMenu' }[page];
  const toolsId = { cp: 'cpToolsMenu', orders: 'ordersToolsMenu', koleksiyon: 'kolToolsMenu' }[page];
  const more = makeNode(moreId);
  const tools = makeNode(toolsId);
  const viewId = { cp: 'cpTableViewActions', orders: 'ordersTableViewActions', koleksiyon: 'kolTableViewActions' }[page];
  const viewActions = makeNode(viewId);
  body.appendChild(more); body.appendChild(tools); body.appendChild(viewActions);
  more.appendChild(makeNode('navFitColumnsBtn'));
  const wrap = makeNode('', 'colPanelWrap navColsRight');
  const button = makeNode('navColsBtn');
  wrap.appendChild(button);
  body.appendChild(wrap);
  const copy = makeNode('cpCopyToKolBtn');
  body.appendChild(copy);
  class FakeObserver {
    constructor(cb) { this.cb = cb; this.roots = []; observers.push(this); }
    observe(root) { this.roots.push(root); }
  }
  const global = {
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
    addEventListener() {},
    MutationObserver: FakeObserver,
  };
  global.document = {
    readyState: 'complete', body,
    getElementById: id => byId.get(id) || null,
    querySelector: () => null,
    addEventListener() {},
  };
  global.window = global;
  vm.runInNewContext(UI, global);
  const flushFrames = max => {
    let frames = 0;
    while (rafQueue.length && frames < max) { frames += 1; rafQueue.splice(0).forEach(fn => fn()); }
    return frames;
  };
  return { more, tools, viewActions, wrap, copy, flushFrames, inserts: () => inserts };
}

for (const page of ['cp', 'orders', 'koleksiyon']) {
  test(`${page}: yerleşmiş Sütunlar düğmesi her karede yeniden takılmaz`, () => {
    const dom = loadCleanupWithFakeDom(page);
    // Sekme geçişi: syncTableToolbarActions Sütunlar'ı görünüm eylemlerine taşır.
    dom.viewActions.appendChild(dom.wrap);
    dom.flushFrames(3);
    assert.equal(dom.more.firstElementChild, dom.wrap, 'Sütunlar ⋯ menüsünün başında olmalı');
    if (page !== 'koleksiyon') assert.equal(dom.tools.firstElementChild, dom.copy);
    const before = dom.inserts();
    const frames = dom.flushFrames(20);
    assert.ok(frames < 20, 'enforce kendi DOM değişikliğiyle sonsuz rAF döngüsüne girmemeli');
    assert.equal(dom.more.firstElementChild, dom.wrap);
    assert.equal(dom.inserts(), before, 'zaten yerindeki düğüm yeniden takılmamalı');
  });
}
