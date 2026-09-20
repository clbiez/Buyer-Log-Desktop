'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fixture = require('./fixtures/priority-v269.json');

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

test(`shared operational engine preserves ${fixture.sourceVersion} facts across the saved regression matrix without legacy Priority text`, () => {
  const signalForLegacyToken = new Map([
    ['Ant. Delay', 'ANTREPO_DELAY'],
    ['Delay', 'DELIVERY_DELAY'],
    ['MB Delay', 'MODEL_BUDGET_DELAY'],
    ['Handover', 'HANDOVER_PENDING'],
    ['Discount', 'DISCOUNT_DELAY'],
    ['Shortage', 'SHORTAGE'],
  ]);
  for (const [index, item] of fixture.cases.entries()) {
    const actual = parse.computeFlags(item.input, fixture.transitRules, fixture.today);
    assert.equal(Object.prototype.hasOwnProperty.call(actual, 'priority'), false, `fixture case ${index}: legacy Priority text dönmemeli`);
    assert.deepEqual(
      { exr: actual.exr, discountWarning: actual.discountWarning, mbGap: actual.mbGap },
      { exr: item.expected.exr, discountWarning: item.expected.discountWarning, mbGap: item.expected.mbGap },
      `fixture case ${index}: sayısal/boolean iş gerçekleri değişmemeli`,
    );
    const codes = new Set((actual.signals || []).map(signal => signal && signal.code).filter(Boolean));
    const tokens = String(item.expected.priority || '').split('|').map(value => value.trim()).filter(Boolean);
    for (const token of tokens) {
      if (token === 'In Time') continue; // artık ON_TRACK karar katmanında temsil edilir.
      const code = signalForLegacyToken.get(token);
      if (code) assert.ok(codes.has(code), `fixture case ${index}: ${token} → ${code} structured signal olarak korunmalı`);
    }
  }
});
