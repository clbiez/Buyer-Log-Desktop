'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public/app.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app-main.js'), 'utf8');

function rule(selector) {
  const at = css.lastIndexOf(selector + '{');
  assert.ok(at >= 0, selector + ' CSS rule must exist');
  return css.slice(at + selector.length + 1, css.indexOf('}', at));
}

test('CP/Orders/Collection average footer labels and values wrap within their columns', () => {
  const cell = rule('tfoot .collectionWeightedAverage');
  assert.match(cell, /min-width:0/);
  const outer = css.match(/tfoot \.collectionWeightedAverage\{text-align:right;([^}]*)\}/);
  assert.ok(outer);
  assert.match(outer[1], /white-space:normal/);
  assert.match(outer[1], /overflow:hidden/);

  const line = rule('tfoot .collectionWeightedAverage .collectionAverageLine');
  assert.match(line, /display:flex/);
  assert.match(line, /flex-wrap:wrap/);
  assert.match(line, /min-width:0/);
  assert.match(line, /max-width:100%/);

  const caption = rule('tfoot .collectionWeightedAverage .collectionFooterCaption');
  assert.match(caption, /min-width:0/);
  const value = rule('tfoot .collectionWeightedAverage strong');
  assert.match(value, /max-width:100%/);
  assert.match(value, /overflow-wrap:anywhere/);
  assert.match(app, /function kolAverageFooter\(weightedValue,arithmeticValue,label\)/);
  assert.match(app, /class="collectionAverageLine"/);
});

test('numeric totals and their captions can wrap when a user narrows a column', () => {
  assert.match(rule('tfoot .quantityTotalLabel'), /white-space:normal/);
  assert.match(rule('tfoot .quantityTotalValue'), /white-space:normal/);
  assert.match(rule('tfoot .quantityTotalValue'), /overflow-wrap:anywhere/);
  assert.match(app, /cells\.push\(kolAverageFooter\(weighted,arithmetic,averageSpec\.label\)\)/);
});
