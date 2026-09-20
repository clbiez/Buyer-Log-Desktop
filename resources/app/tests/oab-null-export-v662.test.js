'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

test('v6.62 OAB Excel export kaynak null/boş hücreleri gerçek boş olarak korur', () => {
  const preserve = new Function(`return function(value){${bodyOf(APP, 'oabExcelPreserveBlank')}}`)();
  assert.equal(preserve(null), null);
  assert.equal(preserve(undefined), null);
  assert.equal(preserve(''), null);
  assert.equal(preserve(0), 0);
  assert.equal(preserve('3E8'), '3E8');
  assert.equal(preserve('   '), '   ', 'kaynakta gerçek boşluk karakteri varsa veri değiştirilmemeli');
});

test('v6.62 OAB Raw Data export null/boş için empty-string üretmez', () => {
  const preserve = new Function(`return function(value){${bodyOf(APP, 'oabExcelPreserveBlank')}}`)();
  const isLikelyCodeField = name => /kod|code|\bref\b/i.test(String(name || ''));
  const S = { fields: ['Fit', 'Persona', 'Renk Kodu', 'Landed Fiyat'] };
  const OABDataUtils = { deriveFieldList: () => S.fields.slice() };
  const rawExport = new Function('S', 'OABDataUtils', 'isLikelyCodeField', 'oabExcelPreserveBlank',
    `return function(rows){${bodyOf(APP, 'oabRawExportMatrix')}}`
  )(S, OABDataUtils, isLikelyCodeField, preserve);

  const out = rawExport([{ Fit: null, Persona: '', 'Renk Kodu': '3E8', 'Landed Fiyat': 12.5 }]);
  assert.deepEqual(out.headers, S.fields);
  assert.deepEqual(out.dataRows[0], [null, null, '3E8', 12.5]);
  assert.ok(!out.dataRows[0].some((value, index) => index < 2 && value === ''), 'boş hücre shared-string olarak yazılmamalı');
});

test('v6.62 drill-down ve pivot Excel yolları da boş string yerine null kullanır', () => {
  const drill = bodyOf(APP, 'oabDrillExportCell');
  const pivot = bodyOf(APP, 'oabPivotExportMatrix');
  assert.match(drill, /oabExcelPreserveBlank\(value\)/);
  assert.match(drill, /if \(preserved == null\) return null/);
  assert.match(pivot, /oabExcelPreserveBlank\(row\[d\.key\]\)/);
  assert.doesNotMatch(pivot, /== null \? ''/);
});
