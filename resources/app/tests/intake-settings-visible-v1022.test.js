const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('INTAKE Settings: OAB pivot bölümleri section görünürlük tuzağına takılmaz', () => {
  assert.ok((UI.match(/<div class="oabSettingsSection">/g) || []).length >= 3,
    'Pivot Rows, Pivot Columns ve Pivot Values görünür div bölümleri olmalı');
  assert.doesNotMatch(UI, /<section class="(?:intakeConfigSection|oabSettingsSection)"/);
  assert.match(CSS, /section\{display:none;?\}/);
});
