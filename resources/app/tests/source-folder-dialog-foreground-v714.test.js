const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'server/lib/ChooseFolder.ps1'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app-main.js'), 'utf8');

test('Windows source-folder dialog is owned by foreground window', () => {
  assert.match(ps, /GetForegroundWindow\(\)/);
  assert.match(ps, /BuyerLogExternalWindow/);
  assert.match(ps, /ShowDialog\(\$owner\)/);
});

test('folder dialog gets a one-shot foreground z-order promotion without permanent topmost', () => {
  assert.match(ps, /HWND_TOPMOST/);
  assert.match(ps, /HWND_NOTOPMOST/);
  assert.match(ps, /PromoteCurrentProcessDialog/);
  assert.match(ps, /SetForegroundWindow\(target\)/);
  assert.match(ps, /\$focusTimer\.Stop\(\)/);
});

test('source-folder UI no longer tells user to search behind Windows', () => {
  assert.doesNotMatch(app, /Windows arkasına bakabilir/);
  assert.match(app, /Klasör seçici açılıyor/);
});
