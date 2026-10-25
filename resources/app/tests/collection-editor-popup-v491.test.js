'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0, `${start} not found`);
  assert.ok(b > a, `${end} not found`);
  return source.slice(a, b);
}

test('v4.94 quick suggestion dropdowns close when the table or page scrolls', () => {
  const block = between(INDEX, 'let _kolCatalogDrop', 'function migrateKolRow');
  assert.match(block, /_kolCatalogAnchor=input/);
  assert.match(block, /function positionKolCatalogDrop\(\)/);
  assert.match(block, /input\.getBoundingClientRect\(\)/);
  assert.match(block, /function suggestionDropContainsScrollTarget\(drop,target\)/);
  const scrollHandler = between(block, "document.addEventListener('scroll',event=>{", '},true);');
  assert.match(scrollHandler, /closeKolCatalogDrop\(\)/);
  assert.match(scrollHandler, /closeSubmfrDrop\(\)/);
  assert.match(scrollHandler, /closeLicensorDrop\(\)/);
  assert.match(scrollHandler, /closeLicenseDrop\(\)/);
  assert.doesNotMatch(scrollHandler, /scheduleKolCatalogDropPosition\(\)/);
  assert.match(block, /target===drop\|\|drop\.contains\(target\)/);
});

test('v4.91 Collection uses one Excel-like active-cell frame without a second input box', () => {
  assert.match(CSS, /#kolTable tbody \.editCell:focus\{background:transparent!important/);
  assert.match(CSS, /#kolTable tbody td\.kolActiveGridCell \.editCell,[^{]*\{[^}]*background:transparent!important;[^}]*border:0!important;[^}]*outline:0/);
  assert.match(CSS, /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody \.kolActiveGridCell,[^{]*\{outline:2px solid var\(--ui-accent\);outline-offset:-2px/);
});
