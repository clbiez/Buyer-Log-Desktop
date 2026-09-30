'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'quotations-store.js'), 'utf8');
const quotationStore = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

test('manual Collection price flow no longer opens one quotation per entry', () => {
  const modal = APP.slice(APP.indexOf('function openKolManualPriceModal'), APP.indexOf('function kolBestPricing'));
  assert.match(modal, /recordManualCollectionPrice/);
  assert.doesNotMatch(modal, /recordRequest\('collection'/);
});

test('manual prices reuse one owner-scoped manual Collection quotation', () => {
  const body = bodyOf(QUOTES, 'recordManualCollectionPrice');
  assert.match(body, /origin==='manual-collection'/);
  assert.match(body, /ownerId===qCurrentUserId\(\)/);
  assert.match(body, /bucket\.items\.push\(line\)/);
  assert.match(body, /bucket\.manufacturers\.push\(m\)/);
  assert.match(body, /findCollectionLine\(rowId,m\.name\)/);
  assert.match(body, /err\?\.status===409/);
});

test('manual quotation origin survives client and server normalization', () => {
  assert.match(QUOTES, /origin:req\?\.origin==='manual-collection'\?'manual-collection':''/);
  const normalized = quotationStore.normalizeRequest({
    id: 'manual-1',
    source: 'collection',
    origin: 'manual-collection',
    ownerId: 'buyer-1',
    manufacturers: [{ name: 'Factory A' }],
    items: [{ id: 'l1', modelKey: 'kol:1', rowId: 1, manufacturer: 'Factory A', price: '2.50' }]
  });
  assert.equal(normalized.origin, 'manual-collection');
  assert.match(STORE, /incoming\.origin = current\.origin/);
});

test('manual bucket has a stable visible title instead of model-by-model titles', () => {
  assert.match(QUOTES, /Koleksiyon · Elle Girilen Fiyatlar/);
  assert.match(QUOTES, /Elle Girilen Fiyatlar','Manual Prices/);
});
