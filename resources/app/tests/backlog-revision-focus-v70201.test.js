'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const PARSE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8');

function constArrayBlock(source, name) {
  const start = source.indexOf(`const ${name}=[`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('[', start);
  const close = source.indexOf('];', open);
  assert.ok(close > open, `${name} kapanışı bulunmalı`);
  return source.slice(open, close + 1);
}

test('v7.0.201 Backlog Focus görünümünde Ex-Factory revizyonunun eski ve yeni tarihi birlikte görünür', () => {
  const block = constArrayBlock(APP, 'BACKLOG_DETAIL_FOCUS_HEADERS');
  const original = 'Orijinal Exfactory Merch Tarih';
  const revised = 'REVİZE YÜKLEME TARİHİ\\n(EX-FACTORY)';
  assert.ok(block.includes(original), 'orijinal Ex-Factory Focus görünümünde olmalı');
  assert.ok(block.includes(revised), 'revize Ex-Factory Focus görünümünde olmalı');
  assert.ok(block.indexOf(original) < block.indexOf(revised), 'orijinal tarih revize tarihten önce görünmeli');
});

test('v7.0.201 Backlog veri katmanı orijinal ve revize Ex-Factory kaynaklarını ayrı tutar', () => {
  assert.match(PARSE, /'Orijinal Exfactory Merch Tarih': asasExDate/);
  assert.match(PARSE, /const revisedExFactoryDate = toDateOnly\(order\.ex\) \|\| asasExDate \|\| null/);\n  assert.match(PARSE, /'REVİZE YÜKLEME TARİHİ\\n\(EX-FACTORY\)': revisedExFactoryDate/);\n  assert.match(PARSE, /actualLoadDate: isPartial \? \(actualLoadDate \|\| null\) : null/);
});
