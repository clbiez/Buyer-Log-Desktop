'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const stats = require('../public/model-option-stats.js');
const analyticsEngine = require('../public/collection-analytics-engine.js');
const pricingEngine = require('../public/pricing-workspace-engine.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SUMMARY = fs.readFileSync(path.join(ROOT, 'public', 'overview-collection-summary.js'), 'utf8');
const ANALYTICS = fs.readFileSync(path.join(ROOT, 'public', 'collection-analytics-engine.js'), 'utf8');
const PRICING = fs.readFileSync(path.join(ROOT, 'public', 'pricing-workspace-engine.js'), 'utf8');
const QUOTATIONS = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

test('model-option stats counts one PLM/model across four colour options', () => {
  const result = stats.getModelOptionStats([
    { plmId: '12345', modelKod: 'ABC SWEAT', colour: 'Black' },
    { plmId: '12345', modelKod: 'ABC SWEAT', colour: 'White' },
    { plmId: '12345', modelKod: 'ABC SWEAT', colour: 'Navy' },
    { plmId: '12345', modelKod: 'ABC SWEAT', colour: 'Red' },
  ]);
  assert.deepEqual(result, { rowCount: 4, modelCount: 1, optionCount: 4 });
});

test('model-option stats covers 20 models/30 options and all rows distinct', () => {
  const twentyModels = Array.from({ length: 20 }, (_, model) =>
    Array.from({ length: model < 10 ? 2 : 1 }, (_, colour) => ({
      plmId: String(1000 + model), modelKod: `MODEL ${model}`, colour: `C${colour}`,
    }))
  ).flat();
  assert.deepEqual(stats.getModelOptionStats(twentyModels), { rowCount: 30, modelCount: 20, optionCount: 30 });
  assert.deepEqual(stats.getModelOptionStats(Array.from({ length: 30 }, (_, index) => ({
    plmId: `unique-${index}`, modelKod: `UNIQUE ${index}`, colour: 'C0',
  }))), { rowCount: 30, modelCount: 30, optionCount: 30 });
});

test('model-option stats keeps 10 models with three colours as 10/30', () => {
  const rows = Array.from({ length: 10 }, (_, model) => Array.from({ length: 3 }, (_, colour) => ({
    plmId: `P-${model}`, modelKod: 'Shared model label', colour: `C-${colour}`,
  }))).flat();
  assert.deepEqual(stats.getModelOptionStats(rows), { rowCount: 30, modelCount: 10, optionCount: 30 });
});

test('model-option stats prefers PLM plus model name, normalizes text, and has safe missing-ID fallback', () => {
  const result = stats.getModelOptionStats([
    { plmId: '1001', modelKod: ' ABC MODEL ' },
    { plmId: '1001', modelKod: 'abc model' },
    { plmId: '1002', modelKod: 'ABC MODEL' },
    { plmId: '', modelKod: 'NO PLM', id: 'row-1' },
    { plmId: '', modelKod: 'NO PLM', id: 'row-2' },
    { plmId: '', modelKod: '', id: 'blank-1' },
    { plmId: '', modelKod: '', id: 'blank-2' },
  ]);
  assert.equal(result.modelCount, 5);
  assert.equal(stats.modelKey({ plmId: '1001', modelKod: 'ABC MODEL' }), stats.modelKey({ plmId: '1001', modelKod: ' abc model ' }));
  assert.notEqual(stats.modelKey({ plmId: '1001', modelKod: 'ABC MODEL' }), stats.modelKey({ plmId: '1002', modelKod: 'ABC MODEL' }));
});

test('collection analytics exposes distinct model and visible option counts', () => {
  const result = analyticsEngine.analyze([
    { plmId: 'P-1', modelKod: 'CORE TEE', colour: 'Black', price: 10, quantity: 1 },
    { plmId: 'P-1', modelKod: 'CORE TEE', colour: 'White', price: 12, quantity: 1 },
    { plmId: 'P-2', modelKod: 'SECOND TEE', colour: 'Black', price: 14, quantity: 1 },
  ], { includeOutliers: true });
  assert.equal(result.stats.modelCount, 2);
  assert.equal(result.stats.optionCount, 3);
  assert.equal(result.stats.recordCount, 3);
});

test('pricing history collapses repeated model identity while keeping options distinct', () => {
  const result = pricingEngine.historySummary([
    { plmId: 'P-1', model: 'CORE TEE', identityKey: 'P-1|BLACK', price: 10, manufacturer: 'A' },
    { plmId: 'P-1', model: 'CORE TEE', identityKey: 'P-1|WHITE', price: 12, manufacturer: 'B' },
    { plmId: 'P-1', model: 'CORE TEE', identityKey: 'P-1|BLACK', price: 11, manufacturer: 'C' },
  ]);
  assert.equal(result.modelCount, 1);
  assert.equal(result.optionCount, 2);
});

test('all visible-row summaries use the shared model/option counter', () => {
  assert.match(INDEX, /model-option-stats\.js/);
  assert.match(APP, /function pageModelOptionStats\(rows/);
  assert.match(APP, /getModelOptionStats\(rows/);
  assert.match(APP, /Model.*Opsiyon|Models.*Options/);
  assert.match(SUMMARY, /BLModelOptionStats|modelKey/);
  assert.match(ANALYTICS, /BLModelOptionStats|modelKey/);
  assert.match(PRICING, /BLModelOptionStats|modelCount/);
  assert.match(QUOTATIONS, /BLModelOptionStats|modelCount/);
});
