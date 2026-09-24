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
  for (const id of ['navCopy', 'navExcelBtn', 'kolCopySelectedBtn', 'kolExportImgBtn']) {
    assert.ok(UI.includes(`'${id}'`), `icon-only target missing: ${id}`);
  }
  assert.match(CSS, /\.tableActionIconOnly\{[\s\S]*?width:var\(--ctl-h\)!important;/);
  assert.match(CSS, /\.tableActionIconOnly>span\{display:none!important;\}/);
  assert.ok(UI.includes("button.setAttribute('aria-label', label)"), 'icon buttons must keep an accessible name');
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
