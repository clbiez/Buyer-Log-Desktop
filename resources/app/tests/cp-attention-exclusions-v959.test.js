'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VIEW = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.css'), 'utf8');

test('v9.59 Attention exclusion tek birleşik modeldir ve kullanıcı tercihine kaydedilir', () => {
  assert.match(VIEW, /attentionExclusions:\s*\[\]/);
  assert.match(VIEW, /state\.attentionExclusions = normalizeAttentionExclusions\(raw\.attentionExclusions \|\| raw\.attentionExceptions\)/);
  assert.match(VIEW, /attentionColumns: state\.attentionColumns, attentionExclusions: state\.attentionExclusions/);
  assert.ok(!/snooze/i.test(VIEW), 'ayrı Snooze terminolojisi/akışı olmamalı');
  assert.match(VIEW, /expiresAt == null \|\| Date\.parse\(item\.expiresAt\) > now/);
});

test('v9.59 exclusion risk motorunu değiştirmez; needsAttention sonrası görünürlük filtresi uygulanır', () => {
  assert.match(VIEW, /const list = Engine\.needsAttention\(state\.model, \{ limit: 5000 \}\)/);
  assert.match(VIEW, /function attentionRowsState\(\)/);
  assert.match(VIEW, /isAttentionExcluded\(item, index\) \? excluded : visible/);
  assert.doesNotMatch(VIEW, /item\.priority\s*=\s*['"]ON_TRACK['"]/);
  assert.doesNotMatch(VIEW, /item\.riskReasons\s*=/);
});

test('v9.59 warning-scope yalnız bütün mevcut warningler excluded ise satırı gizler, yeni warning yeniden görünür', () => {
  assert.match(VIEW, /function attentionWarningKeys\(item\)/);
  assert.match(VIEW, /warnings\.length > 0 && warnings\.every\(code =>/);
  assert.match(VIEW, /attentionExclusionReasonKey\(item\.orderKey, targetType, code\)/);
  assert.match(VIEW, /ATTENTION_EXCLUSION_SCOPE\.ORDER/);
  assert.match(VIEW, /targetType === 'inStore' \? 'inStore' : 'retail'/);
});

test('v9.59 her Attention satırında Exclude aksiyonu, süre/kapsam modalı ve restore listesi vardır', () => {
  for (const hook of [
    'data-cpa-attention-exclude',
    'data-cpa-attention-excluded',
    'data-cpa-exclude-warning',
    'data-cpa-exclude-specific',
    'data-cpa-exclude-apply',
    'data-cpa-exclusion-restore',
  ]) assert.ok(VIEW.includes(hook), `${hook} eksik`);
  for (const duration of ['tomorrow', 'sevenDays', 'target', 'specific', 'permanent']) {
    assert.ok(VIEW.includes(`value="${duration}"`), `${duration} süresi eksik`);
  }
  assert.match(VIEW, /value="reason" checked/);
  assert.match(VIEW, /value="order"/);
  assert.match(VIEW, />⋮<\/button>/);
  assert.match(VIEW, /state\.attentionExclusions = normalizeAttentionExclusions\(state\.attentionExclusions\)\.filter\(item => item\.id !== id\)/);
});

test('v9.59 Excluded görünümü ve modal Buyer Log tasarım primitive/tokenlarını kullanır', () => {
  assert.match(CSS, /\.cpaAttentionExcludeModal\{/);
  assert.match(CSS, /\.cpaAttentionExcludedModal\{/);
  assert.match(CSS, /\.cpaExcludeChoice\{[^}]*border:1px solid var\(--line\)[^}]*background:var\(--card\)/);
  assert.match(CSS, /\.cpaExcludeApply\{[^}]*background:var\(--acc\)[^}]*color:var\(--on-acc\)/);
});
