'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadParseWithoutInstalledXlsx() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'xlsx') return { SSF: {}, utils: {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const path = require.resolve('../server/lib/parse');
    delete require.cache[path];
    return require('../server/lib/parse');
  } finally {
    Module._load = originalLoad;
  }
}

const parse = loadParseWithoutInstalledXlsx();
const TODAY = new Date(2026, 6, 25);

function row(values = {}) {
  return {
    'Ex-factory': '',
    'Retail Date': '',
    'In-Store (Model Budget)': '',
    'Ant. Arrival': '',
    'HANDOVER Tarihi': '',
    'Buying Son Onay Tarihi': '',
    'Del. Type': 'Gemi',
    STATUS: 'Üretimde',
    Season: 'W5',
    Country: 'Turkey',
    ...values,
  };
}

test('Discount starts only after 9 full calendar days and only in production', () => {
  const atNine = parse.computeFlags(row({ 'Ex-factory': '2026-07-16' }), [], TODAY);
  const atTen = parse.computeFlags(row({ 'Ex-factory': '2026-07-15' }), [], TODAY);
  const notProduction = parse.computeFlags(row({ 'Ex-factory': '2026-07-01', STATUS: 'Yolda' }), [], TODAY);
  assert.equal(atNine.discountWarning, false);
  assert.equal(atNine.signals.some(item=>item.code==='DISCOUNT_DELAY'), false);
  assert.equal(atTen.discountWarning, true);
  assert.equal(atTen.signals.some(item=>item.code==='DISCOUNT_DELAY'), true);
  assert.equal(notProduction.discountWarning, false);
  assert.equal(Object.prototype.hasOwnProperty.call(atTen,'priority'), false);
});

test('Antrepo delay and Handover survive as structured signals', () => {
  const flags = parse.computeFlags(row({
    STATUS: 'Yolda',
    'Ant. Arrival': '2026-07-24',
    'Buying Son Onay Tarihi': '2026-07-20',
  }), [], TODAY);
  assert.deepEqual(flags.signals.map(item=>item.code), ['ANTREPO_DELAY','HANDOVER_PENDING']);
});

test('MB Delay boundary remains strictly below 14 days', () => {
  const fourteen = parse.computeFlags(row({ STATUS: 'Yolda', 'Ant. Arrival': '2026-07-26', 'In-Store (Model Budget)': '2026-08-09' }), [], TODAY);
  const thirteen = parse.computeFlags(row({ STATUS: 'Yolda', 'Ant. Arrival': '2026-07-26', 'In-Store (Model Budget)': '2026-08-08' }), [], TODAY);
  assert.equal(fourteen.mbGap, 14);
  assert.equal(fourteen.signals.some(item=>item.code==='MODEL_BUDGET_DELAY'), false);
  assert.equal(thirteen.mbGap, 13);
  assert.equal(thirteen.signals.some(item=>item.code==='MODEL_BUDGET_DELAY'), true);
});

test('dynamic transit rule and default transit duration produce expected Delay result', () => {
  const transitRules = [{ id: 'tr-w5', delType: 'Gemi', days: 20, countries: ['Turkey'], seasons: ['W5'] }];
  const dynamic = parse.computeFlags(row({
    'Ex-factory': '2026-07-25',
    'Retail Date': '2026-08-20',
  }), transitRules, TODAY);
  const fallback = parse.computeFlags(row({
    'Ex-factory': '2026-07-25',
    'Retail Date': '2026-08-20',
    Country: 'India',
  }), transitRules, TODAY);
  assert.equal(dynamic.signals.some(item=>item.code==='DELIVERY_DELAY'), false);
  assert.equal(fallback.signals.some(item=>item.code==='DELIVERY_DELAY'), true);
});

test('FOB rounding exported by parse uses shared half-up behavior', () => {
  assert.equal(parse.roundHalfUp(2.675, 2), 2.68);
  assert.equal(parse.roundHalfUp(-1.005, 2), -1.01);
});
