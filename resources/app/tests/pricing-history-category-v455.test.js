'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');

test('v4.55 Pricing History collects Category from collection/CP rows and quotation records', () => {
  assert.match(SRC, /category:qNorm\(row\?\.urunTipi\|\|row\?\.\['Category'\]\|\|row\?\.category\)/);
  assert.match(SRC, /category:qItemCategory\(req,item\)\|\|meta\.category\|\|''/);
  assert.match(SRC, /category:r\.category/);
});

test('v4.55 Pricing History shows a sortable Category column and includes it in search', () => {
  assert.ok(SRC.includes('data-qhsort="category"'), 'Category header must be sortable');
  assert.match(SRC, /if\(sortKey==='category'\)/);
  assert.match(SRC, /\$\{m\.model\} \$\{m\.category\} \$\{m\.plmId\}/);
  assert.ok(SRC.includes("qhEsc(m.category||'—')"), 'Category value must be rendered in table rows');
});

test('v4.55 both Pricing History Excel views export Category before Model Name', () => {
  const occurrences = SRC.match(/en\?'Category':'Kategori',en\?'Model Name':'Model Adı'/g) || [];
  assert.equal(occurrences.length, 2, 'matrix and ranked Excel headers must both include Category');
  assert.ok(SRC.includes('const MFR_FIRST_COL=9;'), 'manufacturer price columns must shift after Category');
  assert.ok(SRC.includes('if(fill)added.getCell(9+i).fill=fill;'), 'ranked offer fills must shift after Category');
});
