'use strict';

// Durum rozeti ana model satırında ve renk varyantı alt satırında aynı yükseklikte
// kalmalı. Varyant satırı editör sıkıştırması (!important height) rozeti hücre
// boyuna uzatıyordu; rozet bu kuraldan muaf tutulur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.css'), 'utf8');
const APP_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('variant row editor height rule exempts the Collection Status badge', () => {
  const rules = [...CSS.matchAll(/([^{}]*tr\.kolModelGroupVariant[^{}]*\.editCell[^{}]*)\{([^}]*)\}/g)]
    .filter(m => /(^|;|\s)height\s*:/.test(m[2]))
    // Yalnız rozet <select>'ine uygulanabilen seçiciler (textarea/input kuralları hariç).
    .filter(m => m[1].split(',').some(sel => /\.editCell/.test(sel) && !/(textarea|input)\.editCell/.test(sel)));
  assert.ok(rules.length > 0, 'variant editor height rule missing');
  for (const [, selector] of rules) {
    assert.match(selector, /:not\(\.kolStatusNoArrow\)/, `status badge not exempt: ${selector.trim()}`);
  }
});

test('Collection Status badge keeps one fixed height', () => {
  assert.match(APP_CSS, /#kolTable td\.kolStatusTd select\.kolStatusNoArrow\{[^}]*height:20px;min-height:20px;/);
});
