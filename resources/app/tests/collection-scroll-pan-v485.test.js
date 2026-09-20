'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v4.85 Collection suspends expensive hover hit-testing while wheel or drag scrolling', () => {
  assert.match(INDEX, /const collectionWrap=document\.querySelector\('#view-koleksiyon \.tablewrap'\)/);
  assert.match(INDEX, /function beginCollectionFastScroll\(delay=150\)/);
  assert.match(INDEX, /collectionWrap\.addEventListener\('wheel',[\s\S]*?\{passive:true\}/);
  assert.match(INDEX, /collectionWrap\.addEventListener\('scroll',[\s\S]*?\{passive:true\}/);
  assert.match(CSS, /#view-koleksiyon \.tablewrap\.kolScrollPerfMode #kolTable tbody\{[\s\S]*?pointer-events:none/);
  assert.match(CSS, /#kolTable tbody tr\{contain:style;\}/);
});

test('v4.85 right-button hand pan binds table surfaces and applies both axes from the drag origin', () => {
  assert.match(INDEX, /const PAN_SURFACE_SELECTOR='\.tablewrap/);
  assert.match(INDEX, /function preferredPanTarget\(start,axis\)/);
  assert.match(INDEX, /const preferred=element\?\.closest\?\.\(PAN_SURFACE_SELECTOR\)/);
  assert.match(INDEX, /xStart:xTarget\?xTarget\.scrollLeft:0/);
  assert.match(INDEX, /yStart:yTarget\?yTarget\.scrollTop:0/);
  assert.match(INDEX, /pan\.xTarget\.scrollLeft=pan\.xStart-totalDx/);
  assert.match(INDEX, /pan\.yTarget\.scrollTop=pan\.yStart-totalDy/);
  assert.match(INDEX, /Math\.hypot\(totalDx,totalDy\)<4/);
});
