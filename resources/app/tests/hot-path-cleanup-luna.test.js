'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const oab = fs.readFileSync(path.join(root, 'public', 'oab.js'), 'utf8');
const lfl = fs.readFileSync(path.join(root, 'public', 'lfl.js'), 'utf8');

test('analysis and module switching use cache invalidation instead of rebuilding unchanged data', () => {
  assert.match(app, /BLPerf\.throttle|BLPerf\.debounce/);
  assert.match(oab, /oabFilterRowsCache\.clear\(\)/);
  assert.match(oab, /oabPivotViewCache\.clear\(\)/);
  assert.match(lfl, /lflAnalysisCache\.clear\(\)/);
});
