'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

test('v5.62 secondary pointer is consumed before editors except image delete targets', () => {
  assert.match(INDEX, /window\.addEventListener\('pointerdown',event=>\{\s*if\(event\.button!==2\)return;[\s\S]*?closest\('img\.kolThumb\[data-has-image=\"1\"\],img\.cpThumb\[data-has-image=\"1\"\]'\)[\s\S]*?return;[\s\S]*?event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\)/s);
  assert.match(INDEX, /window\.addEventListener\('mousedown',event=>\{\s*if\(event\.button!==2\)return;[\s\S]*?closest\('img\.kolThumb\[data-has-image=\"1\"\],img\.cpThumb\[data-has-image=\"1\"\]'\)[\s\S]*?return;[\s\S]*?event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\)/s);
  assert.match(INDEX, /window\.addEventListener\('pointermove'/);
  assert.match(INDEX, /window\.addEventListener\('pointerup'/);
  assert.match(INDEX, /window\.addEventListener\('pointercancel'/);
});

test('v4.87 right-button pan still supports both axes and preserves context menu when not dragged', () => {
  assert.match(INDEX, /pan\.xTarget\.scrollLeft=pan\.xStart-totalDx/);
  assert.match(INDEX, /pan\.yTarget\.scrollTop=pan\.yStart-totalDy/);
  assert.match(INDEX, /if\(pan\.moved\)suppressContextMenuUntil=Date\.now\(\)\+350/);
  assert.match(INDEX, /document\.addEventListener\('contextmenu'/);
  assert.match(INDEX, /if\(\(pan&&pan\.moved\)\|\|Date\.now\(\)<suppressContextMenuUntil\)/);
});
