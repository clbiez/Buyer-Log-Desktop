'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v4.93 quotations and pricing history use nearly the full viewport', () => {
  const marker = CSS.indexOf('v4.93 — Büyük veri pencereleri');
  assert.ok(marker >= 0, 'v4.93 modal sizing rules should exist');
  const block = CSS.slice(marker);
  assert.match(block, /\.quotationCard,\s*\n\.qhCard\s*\{/);
  assert.match(block, /width:calc\(100vw - 24px\)/);
  assert.match(block, /height:calc\(100vh - 24px\)/);
  assert.match(block, /max-width:none/);
  assert.match(block, /max-height:none/);
  assert.match(block, /\.qhBody\s*\{[\s\S]*?flex:1 1 auto;[\s\S]*?min-height:0;/);
});

test('v4.93 large data modals retain safe mobile viewport margins', () => {
  const marker = CSS.indexOf('v4.93 — Büyük veri pencereleri');
  const block = CSS.slice(marker);
  assert.match(block, /@media\(max-width:760px\)[\s\S]*?width:calc\(100vw - 12px\);[\s\S]*?height:calc\(100vh - 12px\);/);
});
