'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server/lib/agent-browser-connector.js'), 'utf8');

test('seçili PLM aktarımı sayfa yenilendikten sonra seçimleri geri yükler', () => {
  assert.match(source, /coreNectumRestoreSelectedStyleRows\(page,candidates\)/);
  assert.match(source, /input\[type=["']checkbox["']\]/);
  assert.match(source, /checkbox\.click\(\)/);
  assert.match(source, /selectedOnly\)await coreNectumRestoreSelectedStyleRows/);
});
