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
  // #1079 WS6c: çekmece içeriği yerel ya da okuma modeli drill-down yükü; kimlikler listenin tamamı (sıra korunur).
  assert.match(OVERVIEW, /registerDrawerModelImages\(aside,payload\.identities,spec,imageIndex,payload\)/);
  assert.match(OVERVIEW, /identities:identities\.map\(\(\[index,it\]\)=>\(\{\.\.\.drawerModelIdentity\(it\),rowId:String\(index\)\}\)\)/);
  assert.match(OVERVIEW, /repaint:\(\)=>showDrawer\(spec,payload\)/);
  assert.doesNotMatch(OVERVIEW, /api\/model-images\/import-plm/);
});
