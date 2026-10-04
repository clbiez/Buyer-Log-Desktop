'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const APP = read('public/app-main.js');
const LFL = read('public/lfl.js');
const QUOTATIONS = read('public/quotations.js');
const INDEX = read('public/index.html');
const GUIDE = read('public/buyerlog-guide-data.js');

test('Collection Model Bütçe Ayı/Hafta terminology is canonical in both languages', () => {
  assert.match(APP, /\{k:'inStoreWeek', label:'Model Budget Week'/);
  assert.match(APP, /\{k:'inStoreMonth', label:'Model Budget Month'/);
  assert.match(APP, /Select Model Budget Week/);
  assert.match(APP, /Select Model Budget Month/);
  assert.match(APP, /Model Bütçe Hafta Seç/);
  assert.match(APP, /Model Bütçe Ayı Seç/);
  assert.match(APP, /'Model Budget Week':'Model Bütçe Hafta'/);
  assert.match(APP, /'Model Budget Month':'Model Bütçe Ayı'/);
  assert.match(INDEX, />Model Budget Month<\/span>/);
});

test('LFL and Quotations expose Model Budget period labels', () => {
  assert.match(LFL, /inStoreMonth:\{tr:'Model Bütçe Ayı',en:'Model Budget Month'/);
  assert.match(LFL, /inStoreWeek:\{tr:'Model Bütçe Hafta',en:'Model Budget Week'/);
  assert.match(QUOTATIONS, /Model Budget Month/);
  assert.match(QUOTATIONS, /Model Bütçe Ayı/);
  assert.match(APP, /MB MONTH \(Model Budget Month\)/);
});

test('old source headers remain readable only as compatibility aliases', () => {
  assert.match(QUOTATIONS, /row\['In Store Month'\]/);
  assert.match(QUOTATIONS, /row\['In-Store \(Model Budget\)'\]/);
  assert.doesNotMatch(LFL, /tr:'In-Store Ayı'|tr:'In-Store Haftası'/);
  assert.doesNotMatch(LFL, /en:'In-Store Month'|en:'In-Store Week'/);
  assert.doesNotMatch(GUIDE, /In Store month|In Store ayı/);
});
