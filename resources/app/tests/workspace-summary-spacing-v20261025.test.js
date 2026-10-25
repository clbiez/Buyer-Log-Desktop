'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'app.css'), 'utf8');

test('CP ve Orders tablo özetleri aynı iç boşlukla panelin sol kenarından ayrılır', () => {
  for (const [section, meta] of [
    ['cp', 'cpWorkspaceMeta'],
    ['orders', 'ordersWorkspaceMeta'],
  ]) {
    const start = HTML.indexOf('<section id="view-' + section + '"');
    assert.ok(start >= 0, section + ' bölümü bulunmalı');
    const end = HTML.indexOf('</section>', start);
    const metaPos = HTML.indexOf('class="workspaceContextMeta" id="' + meta + '"', start);
    assert.ok(metaPos > start && metaPos < end, section + ' özeti kendi panelinde olmalı');
  }

  const gutter = CSS.match(
    /#view-cp \.workspaceContextBar,\s*#view-orders \.workspaceContextBar\s*\{([^}]+)\}/,
  );
  assert.ok(gutter, 'Her iki tablo için ortak iç boşluk kuralı bulunmalı');
  assert.match(
    gutter[1],
    /padding-inline:\s*calc\(var\(--ui-space-3\)\s*\+\s*var\(--ui-space-2\)\)/,
    'Özet metni için temaya uyumlu yatay iç boşluk kullanılmalı',
  );
});

test('Dar ekranda CP ve Orders panel iç boşlukları küçülür', () => {
  assert.match(
    CSS,
    /@media\(max-width:760px\)\s*\{\s*#view-cp \.workspaceContextBar,\s*#view-orders \.workspaceContextBar\s*\{padding-inline:var\(--ui-space-2\);\}/,
  );
});
