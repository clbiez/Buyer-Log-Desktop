'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');
const index = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const experience = fs.readFileSync(path.join(publicRoot, 'experience.css'), 'utf8');
const integrity = fs.readFileSync(path.join(publicRoot, 'design-butunluk.css'), 'utf8');

test('Ortak deneyim katmanı tüm modül stillerinden sonra yüklenir', () => {
  assert.ok(index.indexOf('experience.css?') > index.indexOf('app.css?'));
  assert.match(experience, /--bl-neutral-0:/);
  assert.match(experience, /--bl-surface-page:var\(--paper\)/);
  assert.match(experience, /--bl-radius-control:var\(--r-sm\)/);
});

test('Refined Industry kare geometrisi ve sakin aktif navigasyon durumu korunur', () => {
  assert.match(experience, /--r-xs:0px;--r-sm:0px;--r-md:0px;--r-lg:0px;--r-xl:0px;\s*--r-full:0px;/);
  assert.match(experience, /nav\.tabs button\.active\{background:var\(--acc-bg\);color:var\(--acc-ink\);box-shadow:none;\}/);
  assert.doesNotMatch(experience, /nav\.tabs button\.active\{[^}]*inset 3px 0 0 var\(--acc\)/);
});

test('Açık, kurşun ve karanlık temada uçan yüzey opaktır', () => {
  assert.match(experience, /--pop:var\(--card\)/);
  assert.match(experience, /html\[data-theme="grey"\][\s\S]*?--pop:var\(--card\)/);
  assert.match(experience, /html\[data-theme="dark"\][\s\S]*?--pop:#252e38/);
  assert.match(experience, /\.userMenu[\s\S]*?background:var\(--bl-surface-raised\)/);
});

test('Etkileşim, drawer, modal ve takvim hareketi ortak ve azaltılabilir', () => {
  for (const name of ['blViewIn', 'blPopoverIn', 'blDialogIn', 'blDrawerIn']) {
    assert.match(experience, new RegExp(`@keyframes ${name}`));
  }
  assert.match(experience, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(experience, /\.dateCalendarPopup\{width:min\(332px/);
  assert.doesNotMatch(integrity, /\*,\*::before,\*::after\{\s*animation:none\s*!important/);
  assert.doesNotMatch(integrity, /\*\{background-image:none\s*!important/);
});

test('Spreadsheet koordinatları ve dışa aktarılan tablo başlık renkleri değişmez', () => {
  assert.doesNotMatch(experience, /--(?:ctl-h|table-row-h|table-cell-pad-y|thead-bg|thead-ink)\s*:/);
  assert.match(experience, /#kolTable tbody td\.kolSpreadsheetActiveCell/);
});
