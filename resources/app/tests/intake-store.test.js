'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createIntakeStore } = require('../server/lib/intake-store');

test('INTAKE cache anahtarı display label ve kolon genişliğini içermez', () => {
  const store = createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-intake-test-')) });
  const query = {
    connection: { server: 'lcwtabular_s20', catalog: 'WSSI Intake Raporu4', model: 'Model' },
    rows: [{ id: 'r1', sourceUniqueName: '[SupplyBasket].[Tedarik Cluster]' }],
    measures: [{ id: 'm1', sourceUniqueName: '[Measures].[Kümülatif Sipariş Miktar]' }],
    filters: [],
  };
  const first = store.queryKey({ ...query, display: { labels: { m1: 'Toplam Sipariş' }, widths: { m1: 180 } } });
  const second = store.queryKey({ ...query, display: { labels: { m1: 'Başka Başlık' }, widths: { m1: 420 } } });
  assert.equal(first, second);
});

test('INTAKE cache ve kullanıcı snapshotı yeniden başlatma sonrasında okunabilir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-intake-test-'));
  const store = createIntakeStore({ root });
  const key = store.queryKey({ rows: ['r1'], measures: ['m1'], filters: { f1: ['A'] } });
  store.set(key, { rows: [{ r1: 'A', m1: 4 }], fields: ['r1', 'm1'], fetchedAt: '2026-09-11T10:00:00.000Z' });
  store.saveSnapshot('user-1', { queryKey: key, rows: [{ r1: 'A', m1: 4 }], fields: ['r1', 'm1'], fetchedAt: '2026-09-11T10:00:00.000Z' });

  const restarted = createIntakeStore({ root });
  assert.equal(restarted.get(key).rows[0].m1, 4);
  assert.equal(restarted.loadSnapshot('user-1').rows[0].r1, 'A');
});

test('INTAKE Reset only removes the current user snapshot; it cannot alter connection configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-intake-test-'));
  const store = createIntakeStore({ root });
  store.saveSnapshot('user-1', { queryKey: 'a', rows: [{ value: 1 }], fields: ['value'] });
  store.saveSnapshot('user-2', { queryKey: 'b', rows: [{ value: 2 }], fields: ['value'] });

  assert.equal(store.clearSnapshot('user-1').cleared, true);
  assert.equal(store.loadSnapshot('user-1'), null);
  assert.equal(store.loadSnapshot('user-2').rows[0].value, 2);
});
