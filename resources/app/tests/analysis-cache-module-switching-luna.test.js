'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cache = require('../public/analysis-cache.js');
const analytics = fs.readFileSync(path.join(root, 'public', 'collection-analytics.js'), 'utf8');
const lfl = fs.readFileSync(path.join(root, 'public', 'lfl.js'), 'utf8');
const oab = fs.readFileSync(path.join(root, 'public', 'oab.js'), 'utf8');
const perf = fs.readFileSync(path.join(root, 'public', 'perf-runtime.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('analysis cache is bounded LRU and produces stable keys for equivalent filter state', () => {
  const lru = cache.create(2);
  lru.set('a', 1).set('b', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 3);
  assert.equal(lru.has('b'), false);
  assert.equal(lru.has('a'), true);
  assert.equal(cache.key({ datasetVersion: 'v1', filters: new Set(['B', 'A']) }), cache.key({ filters: new Set(['A', 'B']), datasetVersion: 'v1' }));
});

test('analysis cache is shared by the analysis modules and scoped by dataset/config', () => {
  assert.match(index, /analysis-cache\.js/);
  assert.match(analytics, /BLAnalysisCache/);
  assert.match(analytics, /datasetVersion/);
  assert.match(analytics, /analysisCache\.clear\(\)/);
  assert.match(lfl, /lflAnalysisCache/);
  assert.match(lfl, /lflAnalysisCacheKey/);
  assert.match(lfl, /analysisDatasetRevision/);
  assert.doesNotMatch(lfl, /\bglobal\.BLAnalysisCache/, 'browser runtime must not depend on Node global');
  assert.match(oab, /oabPivotViewCache/);
  assert.match(oab, /oabFilterRowsCache/);
});

test('performance runtime exposes bounded cache and throttling helpers for hot paths', () => {
  assert.match(perf, /createBoundedCache/);
  assert.match(perf, /function throttle/);
  assert.match(perf, /function debounce/);
});
