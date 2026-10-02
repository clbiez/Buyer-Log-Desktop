'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function sliceBetween(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  assert.notStrictEqual(start, -1, startNeedle + ' bulunamadı');
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.notStrictEqual(end, -1, endNeedle + ' bulunamadı');
  return APP.slice(start, end);
}

test('v7.0.200 Orders salt-okunur Ex-Factory revizyonunda orijinal → revize tarih görünür', () => {
  const cell = sliceBetween('function cellHtml(', 'function cellPlainText(');
  assert.match(cell, /const viewOnly = \(value, renderedHtml\) =>/);
  assert.match(cell, /const body = renderedHtml == null \? escapeHtml\(text\) : String\(renderedHtml\)/);

  const ex = sliceBetween("case 'exfactory': {", "case 'retailEdit': {");
  assert.match(ex, /const body = rev \? revisionHtml\(c\.k, rev\) : \(fmtDate\(v\)\|\|'—'\);/);
  assert.match(ex, /if\(!canEdit\) return viewOnly\(fmtDate\(v\), body\);/);
  assert.ok(
    ex.indexOf('const body = rev ? revisionHtml') < ex.indexOf('if(!canEdit)'),
    'revizyon içeriği salt-okunur erken dönüşten önce hazırlanmalı'
  );
});

test('v7.0.200 diğer doğrudan tarih revizyonları da salt-okunur satırda geçmişi korur', () => {
  const retail = sliceBetween("case 'retailEdit': {", "case 'instoreEdit': {");
  const instore = sliceBetween("case 'instoreEdit': {", "case 'money': {");
  assert.match(retail, /viewOnly\(fmtDate\(v\), body\)/);
  assert.match(instore, /viewOnly\(fmtDate\(v\), body\)/);
});
