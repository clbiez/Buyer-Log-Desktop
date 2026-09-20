'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('i18n audit: static TR/EN pairs are complete and English text is not Turkish', () => {
  const pairs = [...html.matchAll(/data-i18n-tr="([^"]*)"\s+data-i18n-en="([^"]*)"/g)];
  assert.ok(pairs.length >= 100, `static i18n pairs unexpectedly low: ${pairs.length}`);
  for (const [, tr, en] of pairs) {
    assert.ok(tr.trim() && en.trim(), `missing translation pair: ${tr}`);
    assert.ok(!/[çğıİöşüÇĞŞÜÖ]/.test(en), `English UI contains Turkish characters: ${en}`);
  }
});

test('i18n audit: Turkish uppercase uses locale-aware examples', () => {
  const upper = value => value.toLocaleUpperCase('tr-TR');
  assert.equal(upper('işlem'), 'İŞLEM');
  assert.equal(upper('izin'), 'İZİN');
  assert.equal(upper('sipariş'), 'SİPARİŞ');
  assert.match(app, /toLocaleUpperCase\('tr-TR'\)/);
});

test('i18n audit: document language tracks active UI language for CSS casing', () => {
  assert.match(app, /document\.documentElement\.lang\s*=\s*appLang/);
});
