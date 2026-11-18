'use strict';

/* IAS fact-row sorgusu fact dışı alanları RELATED ile okur. Model ilişkisi
   çoka-bir değilse SSAS RELATED'ı reddeder; BL aynı yenilemede bir kez eski
   CALCULATE(SELECTEDVALUE(...), CALCULATETABLE(fact)) ifadesiyle yeniden dener
   ve bunu uyarıyla bildirir. Başka hatalarda yeniden denemez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));

const T = 'Siparis Bilgileri';
function ias() {
  return {
    id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: T, seasonTable: T, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: {
      'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
      'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
      'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
      'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
      'Sezon': { table: T, name: 'Sezon', kind: 'column' },
    },
  };
}
const row = { 'İthalat Dosya No': 'D-1', 'Sipariş Kod': 1, 'Model Adı': 'M', 'Renk Kod': 'C', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-01-01', 'Yükleme Toplam Adet': 5 };
const base = { columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }) };

test('IAS varsayılan sorgusu RELATED kullanır ve tek denemede biter', async () => {
  const queries = [];
  const run = await modelRefresh.queryConnectionRows(ias(), { ...base, runModelRows: async plan => { queries.push(plan.query); return { rows: [{ ...row }], rowCount: 1 }; } });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /RELATED\('Siparis Bilgileri'\[Sipariş Kod\]\)/);
  assert.equal(run.rows.length, 1);
  assert.ok(!run.warnings.some(w => /RELATED/.test(w)));
});

test('SSAS ilişki hatası verirse eski ifadeyle bir kez yeniden denenir ve uyarı yazılır', async () => {
  const queries = [];
  const run = await modelRefresh.queryConnectionRows(ias(), { ...base, runModelRows: async plan => {
    queries.push(plan.query);
    if (/RELATED\(/.test(plan.query)) throw new Error("Query (14, 24) The column 'Siparis Bilgileri'[Sipariş Kod] either doesn't exist or doesn't have a relationship to any table available in the current context.");
    return { rows: [{ ...row }], rowCount: 1 };
  } });
  assert.equal(queries.length, 2);
  assert.match(queries[1], /CALCULATE\(SELECTEDVALUE\('Siparis Bilgileri'\[Sipariş Kod\]\), CALCULATETABLE\('Ithalat'\)\)/);
  assert.equal(run.rows.length, 1);
  assert.equal(run.query, queries[1]);
  assert.ok(run.warnings.some(w => /RELATED/.test(w) && /SELECTEDVALUE/.test(w)), run.warnings.join('\n'));
});

test('ilişkiyle ilgisiz hatada yeniden denenmez (zaman aşımı, yetki vb.)', async () => {
  let calls = 0;
  await assert.rejects(modelRefresh.queryConnectionRows(ias(), { ...base, runModelRows: async () => { calls += 1; throw new Error('Model sorgusu zaman aşımına uğradı (600 sn).'); } }), /zaman aşımı/);
  assert.equal(calls, 1);
});
