'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OVERVIEW = fs.readFileSync(path.join(ROOT, 'public', 'backlog-overview.js'), 'utf8');

test('Backlog chart detail drawer shows shared model image thumbnails', () => {
  assert.match(OVERVIEW, /function drawerModelImageHtml\(it,imageIndex\)/);
  assert.match(OVERVIEW, /class="detailImgCell">\$\{drawerModelImageHtml\(it,imageIndex\)\}/);
  assert.match(OVERVIEW, /const api=window\.BLDetailImages/);
  assert.match(OVERVIEW, /api\.resolve\(imageIndex,drawerModelIdentity\(it\)\)/);
  assert.match(OVERVIEW, /identityFromRow\?\.\(row,\x27backlog\x27\)/);
  assert.match(OVERVIEW, /api\.thumbHtml\(id\.source/);
  assert.match(OVERVIEW, /allowEmpty:true/);
  assert.match(OVERVIEW, /<th class="detailImgCell">\$\{esc\(L\('Görsel','Image'\)\)\}<\/th>/);
});

test('Backlog chart detail drawer reuses contextual PLM missing-image action', () => {
  assert.match(OVERVIEW, /modelImagesButtonHtml\?\.\('blvDrawerPlmSync'\)/);
  assert.match(OVERVIEW, /bindModelImagesButton\?\.\('blvDrawerPlmSync'\)/);
  assert.match(OVERVIEW, /contextType:'backlog-overview-detail'/);
  assert.match(OVERVIEW, /registerDrawerModelImages\(aside,list,spec,imageIndex\)/);
  assert.match(OVERVIEW, /repaint:\(\)=>openDrawer\(spec\)/);
  assert.doesNotMatch(OVERVIEW, /api\/model-images\/import-plm/);
});
