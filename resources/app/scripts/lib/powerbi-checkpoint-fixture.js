'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const SCHEMA = ['Order Code', 'Product Name', 'Colour Description', 'Supplier Portal Status',
  'Estimated Warehouse Entry', 'Loaded Quantity', 'Import File No'];
const identity = value => String(value).trim().toLocaleUpperCase('tr-TR').replace(/[.,\s]/g, '');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createFixture({ orders = 12, scenario = 'steady', batchSize = 250 } = {}) {
  assert.ok(Number.isSafeInteger(orders) && orders > 0);
  assert.ok(Number.isSafeInteger(batchSize) && batchSize > 0 && batchSize <= 500);
  assert.ok(['steady', 'split-retry'].includes(scenario));
  const orderCodes = Array.from({ length: orders }, (_, index) => `SYN-${String(index + 1).padStart(7, '0')}`);
  const ordinal = code => Number(code.slice(4)) - 1;
  const state = code => scenario === 'steady' ? 'SUCCESS'
    : ordinal(code) % 11 === 10 ? 'FAILED' : ordinal(code) % 5 === 4 ? 'NOT_FOUND' : 'SUCCESS';
  // Independent oracle: no production normalize/apply/count helper is used.
  const rowsFor = code => state(code) !== 'SUCCESS' ? []
    : Array.from({ length: ordinal(code) % 7 === 0 ? 2 : 1 }, (_, line) => ({
      'Sipariş Kod': code, 'Model Adı': `DEMO-${ordinal(code) % 37}`, 'Renk Tanım': line ? 'İnci' : 'Mavi',
      'Supplier Portal Statü': 'DEMO', 'Tahmini Antrepo Giriş Tarihi': null,
      'Yükleme Toplam Adet': ordinal(code) + line, 'İthalat Dosya No': `DEMO-${code}-${line}`,
    }));
  let expected;
  return {
    orderCodes,
    get expected() {
      if (!expected) {
        const orderStates = Object.fromEntries(orderCodes.map(code => [identity(code), state(code)]));
        const states = Object.values(orderStates);
        expected = { rows: orderCodes.flatMap(rowsFor), orderStates,
          failedOrderCodes: orderCodes.filter(code => state(code) === 'FAILED').map(identity),
          counts: { totalOrders: orders, processedOrders: orders,
            successfulOrders: states.filter(value => value === 'SUCCESS').length,
            notFoundOrders: states.filter(value => value === 'NOT_FOUND').length,
            failedOrders: states.filter(value => value === 'FAILED').length } };
      }
      return expected;
    },
    transport({ trace = true } = {}) {
      const stats = { queries: 0, splitRejections: 0, transientFailures: 0, terminalFailures: 0 };
      const queriedCodes = [];
      return { stats, queriedCodes, getSchema: async () => SCHEMA.slice(),
        queryBatch: async (codes, { attempt = 0 } = {}) => {
          stats.queries += 1;
          if (trace) queriedCodes.push(...codes);
          if (scenario === 'split-retry') {
            if (codes.length > Math.max(1, Math.floor(batchSize / 2))) {
              stats.splitRejections += 1; throw Error('synthetic payload limit');
            }
            if (codes.some(code => state(code) === 'FAILED')) {
              stats.terminalFailures += 1; throw Error('synthetic terminal failure');
            }
            if (attempt === 0 && ordinal(codes[0]) % 4 === 0) {
              stats.transientFailures += 1; throw Error('synthetic transient failure');
            }
          }
          return codes.flatMap(rowsFor);
        } };
    },
  };
}

function assertEquivalent(result, expected) {
  assert.equal(result.ok, true);
  assert.equal(result.stopped, false);
  for (const [name, value] of Object.entries(expected.counts)) assert.equal(result.manifest[name], value, name);
  assert.deepEqual({ ...result.manifest.orderStates }, expected.orderStates);
  assert.deepEqual(result.manifest.remainingOrders, []);
  assert.deepEqual(result.manifest.failedOrderCodes, expected.failedOrderCodes);
  assert.deepEqual(result.rows, expected.rows, 'row order, multiplicity, values and nulls');
}

module.exports = { SCHEMA, identity, digest, createFixture, assertEquivalent };
