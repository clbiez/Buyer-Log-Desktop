'use strict';

/* Kullanıcı kararı (2026-11-18): ASAS-IAS ufku uyuşmazsa eşleşmeyen siparişler
   sessizce "Üretimde" görünüyordu. IAS'ta eşleşmeyen sipariş IAS ufkunun
   DIŞINDAYSA uyarı verilir; ufkun İÇİNDEYSE (IAS'ta verisi yok) bugünkü
   "Üretimde" davranışı aynen sürer. Alanı ASAS siparişinde okunamayan koşul
   uyarıya dayanak yapılmaz (yanlış alarm yok). */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));

const M = 'Model Özellikleri', T = 'Siparis Bilgileri';
function asas() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: M, name: field.header, kind: 'column' };
  return { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['S6', 'W6'], groups: [] }, mapping };
}
function ias(conditions) {
  return { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'IASv2', refreshEnabled: true,
    horizon: { table: T, groups: [{ id: 'g1', conditions }] },
    mapping: {
      'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
      'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
      'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
      'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
      'Sezon': { table: T, name: 'Sezon', kind: 'column' },
      'Merch Alt Grup Kod': { table: T, name: 'Merch Alt Grup Kod', kind: 'column' },
      'Lisans Karakter': { table: T, name: 'Lisans Karakter', kind: 'column' },
    } };
}
const order = (code, season) => ({ 'Sipariş Kod': code, 'Model Adı': `M${code}`, 'Renk Kod': 'C', 'Renk': 'X', 'Net Alım Sipariş Miktarı': 100, 'FOB Fiyatı': 2, 'Üretici': 'U', 'Sezon': season, 'Merch Alt Grup Kod': 'CU4E', 'Orijinal Exfactory Merch Tarih': '2026-09-01' });
const iasRow = code => ({ 'İthalat Dosya No': `D${code}`, 'Sipariş Kod': code, 'Model Adı': `M${code}`, 'Renk Kod': 'C', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20', 'Yükleme Toplam Adet': 100 });

async function run(conditions, { orders = [order(1, 'W6'), order(2, 'S6'), order(3, 'W6')], iasRows = [iasRow(1)], targets = ['cp'] } = {}) {
  return modelRefresh.loadFromModelConnections([asas(), ias(conditions)], {
    targets, includeLfl: false, columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }),
    runModelRows: async plan => {
      const rows = /'Ithalat'/.test(plan.query) ? iasRows.map(r => ({ ...r })) : orders.map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    },
  });
}
const horizonWarnings = result => result.warnings.filter(w => /IAS ufkunun/.test(w));

test('IAS ufkunun dışında kalan eşleşmeyen sipariş için uyarı ve ayrıntı tablosu', async () => {
  const result = await run([{ field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['W6'] }]);
  const warnings = horizonWarnings(result);
  assert.equal(warnings.length, 1, result.warnings.join('\n'));
  assert.match(warnings[0], /1 ASAS siparişi IAS ufkunun/);
  assert.match(warnings[0], /1 ASAS orders fell outside the IAS horizon/);
  const detail = result.warningDetails.find(d => d.id === 'ias-horizon-excluded');
  assert.ok(detail, 'ayrıntı tablosu');
  assert.equal(detail.message, warnings[0]);
  assert.deepEqual(detail.rows.map(r => r.orderCode), ['2']);
  assert.equal(detail.rows[0]['field:Sezon'], 'S6');
});

test('ufkun içinde ama IAS verisi olmayan sipariş uyarı üretmez (Üretimde sürer)', async () => {
  const result = await run([{ field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['S6', 'W6'] }]);
  assert.equal(horizonWarnings(result).length, 0, result.warnings.join('\n'));
});

test('ASAS siparişinde okunamayan IAS ufuk alanı yanlış alarm üretmez', async () => {
  const result = await run([{ field: 'Lisans Karakter', table: T, name: 'Lisans Karakter', op: 'in', values: ['MARVEL'] }]);
  assert.equal(horizonWarnings(result).length, 0, result.warnings.join('\n'));
});

test('grup içi okunamayan koşul atlanır, okunabilen koşul değerlendirilir', async () => {
  const result = await run([
    { field: 'Lisans Karakter', table: T, name: 'Lisans Karakter', op: 'in', values: ['MARVEL'] },
    { field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['W6'] },
  ]);
  assert.equal(horizonWarnings(result).length, 1);
});

test('aynı sonucu veren hedefler tek uyarıda birleşir', async () => {
  const result = await run([{ field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['W6'] }], { targets: ['cp', 'orders', 'backlog'] });
  const warnings = horizonWarnings(result);
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /Antrepo \(CP, ORDERS, BACKLOG\)/);
});

test('id taşımayan ve koşulsuz gruplar doğru işlenir', async () => {
  const result = await modelRefresh.loadFromModelConnections([asas(), { ...ias([]), horizon: { table: T, groups: [
    { conditions: [{ field: 'Sezon', table: T, name: 'Sezon', op: 'in', values: ['W6'] }] },
    { conditions: [] },
  ] } }], {
    targets: ['cp'], includeLfl: false, columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }),
    runModelRows: async plan => {
      const rows = /'Ithalat'/.test(plan.query) ? [iasRow(1)] : [order(1, 'W6'), order(2, 'S6')];
      return { rows, rowCount: rows.length };
    },
  });
  assert.equal(horizonWarnings(result).length, 1, result.warnings.join('\n'));
});
