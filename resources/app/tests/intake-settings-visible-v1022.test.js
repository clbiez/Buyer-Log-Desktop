const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('INTAKE Settings: satır, sütun, ölçü ve filtre panelleri section görünürlük tuzağına takılmaz', () => {
  assert.match(UI, /<div class="intakeConfigSection"/);
  assert.doesNotMatch(UI, /<section class="intakeConfigSection"/);
  assert.match(CSS, /section\{display:none\}/);
});
