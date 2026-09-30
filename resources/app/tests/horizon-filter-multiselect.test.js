'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Horizon değer seçicisi pencereyi açık tutarak çoklu seçime izin verir', () => {
  const picker = read('public/data-management-picker.js');
  const filter = read('public/data-management-filter.js');
  const css = read('public/data-management.css');

  assert.match(picker, /const keepOpen = options\.keepOpen === true;/);
  assert.match(picker, /const selected = new Set/);
  assert.match(picker, /if \(keepOpen\) \{[\s\S]*selected\.add\(value\)[\s\S]*onPick\(value\)/);
  assert.match(filter, /keepOpen: true,[\s\S]*selectedValues: condition\.values/);
  assert.match(css, /\.dmfPickerItem\.isSelected/);
});

test('Ortak seçicinin mevcut tek-seçim davranışı varsayılan olarak korunur', () => {
  const picker = read('public/data-management-picker.js');
  assert.match(picker, /const keepOpen = options\.keepOpen === true;/);
  assert.match(picker, /if \(keepOpen\)[\s\S]*return;[\s\S]*close\(\);\s*onPick\(value\);/);
});
