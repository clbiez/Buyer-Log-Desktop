'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const VIEW = read('public/cp-overview-assistant.js');
const CSS = read('public/cp-overview-assistant.css');

test('priority reason mail action is rendered inline before the reason content', () => {
  const blockStart = VIEW.indexOf('const reasons = ruleReasonCounts(model)');
  const blockEnd = VIEW.indexOf('/* Seçili öncelik için otomasyon', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'priorities reason renderer should exist');
  const block = VIEW.slice(blockStart, blockEnd);
  assert.match(block, /<li class="cpaReasonRow">[\s\S]*data-cpa-automate-reason[\s\S]*class="cpaReasonMain"[\s\S]*cpaReasonCount/);
  assert.ok(block.indexOf('data-cpa-automate-reason') < block.indexOf('data-cpa-reason='), 'mail button must precede reason content');
  assert.doesNotMatch(block, /<br\s*\/?>/i, 'reason item must not create a second action line');
});

test('compact row uses a two-column inline layout and keeps reason text ellipsized', () => {
  assert.match(CSS, /\.cpaReasons \.cpaReasonRow\{[^}]*display:grid;[^}]*grid-template-columns:auto minmax\(0,1fr\)[^}]*min-height:34px/);
  assert.match(CSS, /\.cpaReasons \.cpaReasonEmailAction\{[^}]*width:26px;[^}]*height:26px/);
  assert.match(CSS, /\.cpaReasons \.cpaReasonMain\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(CSS, /\.cpaReasons \.cpaReasonTitle\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
  assert.match(CSS, /\.cpaReasons \.cpaReasonCount\{[^}]*text-align:right;[^}]*white-space:nowrap/);
});

test('mail action keeps the existing stable reason hook and does not bubble to reason filtering', () => {
  assert.match(VIEW, /data-cpa-automate-reason="\$\{esc\(item\.name\)\}"/);
  assert.match(VIEW, /data-cpa-reason="\$\{esc\(item\.name\)\}"/);
  assert.match(VIEW, /data-cpa-automate-reason[^\n]*aria-label=/);
  assert.match(VIEW, /el\.onclick = event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); automateFromReason\(el\.dataset\.cpaAutomateReason\); \}/);
});
