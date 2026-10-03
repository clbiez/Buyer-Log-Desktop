'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.css'), 'utf8');
const VIEW = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('checklist evidence checkboxes are not stretched by generic rule input styles', () => {
  assert.match(VIEW, /class="cpaRuleTarget cpaRuleEvidenceFields"/);
  assert.match(VIEW, /class="cpaRuleEvidenceChecks"/);
  assert.match(VIEW, /data-cpa-rule-evidence="reportNumber"/);
  assert.match(VIEW, /data-cpa-rule-evidence="actualDate"/);
  assert.match(VIEW, /data-cpa-rule-evidence="attachments"/);

  assert.match(CSS, /\.cpaRuleTarget select,\.cpaRuleTarget>input\{/);
  assert.doesNotMatch(CSS, /\.cpaRuleTarget select,\.cpaRuleTarget input\{/);
  assert.match(CSS, /\.cpaRuleEvidenceChecks\{[^}]*display:flex;[^}]*align-items:center;[^}]*flex-wrap:wrap/);
  assert.match(CSS, /\.cpaRuleEvidenceChecks \.cpaCheck input\{[^}]*width:16px;[^}]*height:16px;[^}]*min-width:16px/);
  assert.match(CSS, /\.cpaRuleEvidenceChecks \.cpaCheck span\{[^}]*white-space:nowrap/);
});

test('checklist assistant stylesheet cache revision is bumped', () => {
  assert.match(INDEX, /cp-overview-assistant\.css\?v=__BL_ASSET_VERSION__&rev=7144/);
});
