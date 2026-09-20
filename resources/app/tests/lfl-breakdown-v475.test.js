'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'lfl.js'), 'utf8');

test('v4.75 LFL Analysis Breakdown supports six nested levels', () => {
  assert.match(source, /const MAX_BREAKDOWN_LEVELS=6;/);
  assert.match(source, /Array\.from\(\{length:MAX_BREAKDOWN_LEVELS\}/);
  assert.match(source, /Choose up to six nested levels(?: and reorder them)?\./);
  assert.match(source, /En fazla altı alt kırılım seç(?: ve sıralamasını düzenle)?\./);

  const cappedUses = source.match(/slice\(0,MAX_BREAKDOWN_LEVELS\)/g) || [];
  assert.ok(cappedUses.length >= 3, 'saved, restored, edited and dynamic ASAS breakdowns must all use the six-level limit');
  assert.match(source, /Add From ASAS/);
  assert.match(source, /ASAS’tan Ekle/);
  assert.doesNotMatch(source, /slice\(0,4\)/);
  assert.doesNotMatch(source, /Array\.from\(\{length:4\}/);
});
