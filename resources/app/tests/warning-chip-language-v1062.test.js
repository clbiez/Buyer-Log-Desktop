'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.62 kaynak uyarısı rozeti seçili dili kullanır', () => {
  const start = APP.indexOf('function refreshWarnChips()');
  const end = APP.indexOf('\nfunction ', start + 1);
  const source = APP.slice(start, end);

  assert.match(source, /const warningCountText=appLang==='en'\?`⚠ \$\{appWarnings\.length\} warnings`:`⚠ \$\{appWarnings\.length\} uyarı`;/);
  assert.match(source, /const warningDetailsTitle=appLang==='en'\?'Show warning details':'Uyarı detaylarını göster';/);
  assert.match(source, /b\.textContent = warningCountText;/);
  assert.match(source, /b\.title = warningDetailsTitle;/);
  assert.doesNotMatch(source, /b\.textContent = `⚠ \$\{appWarnings\.length\} uyarı`;/);
});
