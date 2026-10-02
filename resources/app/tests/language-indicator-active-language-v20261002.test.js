const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('rail language indicator shows the active UI language, not the next language', () => {
  assert.match(INDEX, /id="railLangLabel" data-no-i18n>Dil: TR<\/span>/);
  assert.match(INDEX, /function syncRailLanguageIndicator\(\)/);
  assert.match(INDEX, /const english=String\(root\.lang\|\|'tr'\)\.toLowerCase\(\)\.startsWith\('en'\);/);
  assert.match(INDEX, /const text=english\?'Language: EN':'Dil: TR';/);
  assert.match(INDEX, /label\.dataset\.activeLanguage=english\?'en':'tr';/);
});

test('rail language indicator follows html lang changes', () => {
  assert.match(INDEX, /new MutationObserver\(sync\)\.observe\(root,\{attributes:true,attributeFilter:\['lang'\]\}\);/);
  assert.match(INDEX, /new MutationObserver\(sync\)\.observe\(label,\{childList:true,characterData:true,subtree:true\}\);/);
});
