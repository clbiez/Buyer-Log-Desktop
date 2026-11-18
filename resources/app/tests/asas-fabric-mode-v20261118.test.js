'use strict';

/* ASAS kumaş modu (Kaynak Veri › ASAS Kumaş Bilgileri).
   Saha (kaynak doğrulama aracı, 2026-11-18): kumaş alanları ana ASAS
   sorgusunda satırları 2,07 kat çoğaltıyor, satır koruması COUNTROWS('Kumaş')
   kumaş kaydı olmayan 58 siparişi düşürüyor ve 139 bin satır LFL'yi bozuyordu.
     separate — ana sorgu kumaşsız; kumaş ayrı küçük sorgudan (yalnız Ana Kumaş
                Mı = 1) sipariş+model+renk anahtarıyla satırlara eklenir.
     off      — kumaş hiç çekilmez.
   Seçenek verilmezse bugünkü tek sorgu (inline) aynen çalışır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));

const M = 'Model Özellikleri', K = 'Kumaş';
function asasItem() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: M, name: field.header, kind: 'column' };
  for (const header of ['Ana Kumaş Mı', 'Kumaş Tipi', 'İplik No', 'Gramaj', 'Karışım']) mapping[header] = { table: K, name: header, kind: 'column' };
  mapping['Net Alım Sipariş Miktarı'] = { table: M, name: 'Net Alım Sipariş Miktarı', kind: 'measure' };
  return {
    id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['W6'], groups: [] }, mapping,
  };
}
const order = (code, over = {}) => ({ 'Sipariş Kod': code, 'Model Adı': `MODEL ${code}`, 'Renk Kod': 'C1', 'Renk': 'SIYAH', 'Net Alım Sipariş Miktarı': 100, 'FOB Fiyatı': 2, 'Üretici': 'U', 'Sezon': 'W6', 'Orijinal Exfactory Merch Tarih': '2026-09-01', ...over });
const fabricRow = (code, over = {}) => ({ 'Sipariş Kod': code, 'Model Adı': `MODEL ${code}`, 'Renk Kod': 'C1', 'Ana Kumaş Mı': 1, 'Kumaşçı': `MILL ${code}`, 'Kumaş Tipi': 'SÜPREM', 'İplik No': '', 'Gramaj': '160', 'Karışım': '%100 PAMUK', ...over });

function fakeDb({ main = [order(1), order(2), order(3)], fabric = [fabricRow(1), fabricRow(2)] } = {}) {
  const queries = [];
  return {
    queries,
    runModelRows: async plan => {
      queries.push(plan.query);
      const isFabric = /'Kumaş'\[Ana Kumaş Mı\]/.test(plan.query) && !/'Model Özellikleri'\[FOB Fiyatı\]/.test(plan.query);
      const rows = (isFabric ? fabric : main).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    },
  };
}
const base = { targets: ['cp'], includeAntrepo: false, includeLfl: false, columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }) };

test('separate: ana sorgu kumaşsız, kumaş ayrı sorgudan siparişe eklenir, kumaşsız sipariş düşmez', async () => {
  const db = fakeDb();
  const result = await modelRefresh.loadFromModelConnections([asasItem()], { ...base, runModelRows: db.runModelRows, asasFabricMode: 'separate' });
  assert.equal(db.queries.length, 2, 'ana + kumaş sorgusu');
  const main = db.queries.find(q => /\[FOB Fiyatı\]/.test(q));
  const fabric = db.queries.find(q => q !== main);
  assert.doesNotMatch(main, /'Kumaş'\[/);
  assert.doesNotMatch(main, /COUNTROWS\('Kumaş'\)/);
  assert.match(fabric, /'Model Özellikleri'\[Sipariş Kod\]/);
  assert.match(fabric, /'Kumaş'\[Karışım\]/);
  assert.match(fabric, /FILTER\(ALL\('Kumaş'\[Ana Kumaş Mı\]\), 'Kumaş'\[Ana Kumaş Mı\] & "" IN \{/);
  assert.match(fabric, /NOT ISBLANK\(COUNTROWS\('Kumaş'\)\)/);
  const orders = result.asasOrdersByTarget.cp;
  assert.equal(orders.length, 3, 'kumaş kaydı olmayan sipariş korunur');
  const by = Object.fromEntries(orders.map(o => [o.ocode, o]));
  assert.equal(by[1].fabricSupplier, 'MILL 1');
  assert.equal(by[2].karisim, '%100 PAMUK');
  assert.equal(by[3].fabricSupplier, '');
  assert.equal(by[1].qty, 100);
  assert.ok(!result.warnings.some(w => /Ana Kumaş Mı" alanı bulunamadı/.test(w)), result.warnings.join('\n'));
});

test('separate: aynı siparişte birden çok ana kumaş satırı → son dolu değer (bugünkü davranış) + uyarı', async () => {
  const db = fakeDb({ fabric: [fabricRow(1, { 'Kumaşçı': 'İLK', 'Gramaj': '150' }), fabricRow(1, { 'Kumaşçı': 'SON', 'Gramaj': '' })] });
  const result = await modelRefresh.loadFromModelConnections([asasItem()], { ...base, runModelRows: db.runModelRows, asasFabricMode: 'separate' });
  const o = result.asasOrdersByTarget.cp.find(x => x.ocode === 1);
  assert.equal(o.fabricSupplier, 'SON');
  assert.equal(o.fabricWeight, '150');
  assert.ok(result.warnings.some(w => /1 sipariş kimliğinde birden fazla Ana Kumaş Mı = 1/.test(w)), result.warnings.join('\n'));
});

test('off: kumaş hiç sorgulanmaz, alanlar boş, yanıltıcı uyarı yok', async () => {
  const db = fakeDb();
  const result = await modelRefresh.loadFromModelConnections([asasItem()], { ...base, runModelRows: db.runModelRows, asasFabricMode: 'off' });
  assert.equal(db.queries.length, 1);
  assert.doesNotMatch(db.queries[0], /'Kumaş'\[/);
  assert.equal(result.asasOrdersByTarget.cp.length, 3);
  assert.ok(result.asasOrdersByTarget.cp.every(o => o.fabricSupplier === '' && o.karisim === ''));
  assert.ok(!result.warnings.some(w => /kumaş/i.test(w) && /bulunamadı/.test(w)), result.warnings.join('\n'));
});

test('off: Ana Kumaş Mı eşlenmemiş bağlantı zorunlu alan hatası vermez', async () => {
  const item = asasItem();
  delete item.mapping['Ana Kumaş Mı'];
  const db = fakeDb();
  const result = await modelRefresh.loadFromModelConnections([item], { ...base, runModelRows: db.runModelRows, asasFabricMode: 'off' });
  assert.equal(result.asasOrdersByTarget.cp.length, 3);
});

test('separate: Ana Kumaş Mı eşlenmemişse kumaş sorgusu atlanır, yenileme durmaz, uyarı yazılır', async () => {
  const item = asasItem();
  delete item.mapping['Ana Kumaş Mı'];
  const db = fakeDb();
  const result = await modelRefresh.loadFromModelConnections([item], { ...base, runModelRows: db.runModelRows, asasFabricMode: 'separate' });
  assert.equal(db.queries.length, 1);
  assert.equal(result.asasOrdersByTarget.cp.length, 3);
  assert.ok(result.warnings.some(w => /Ana Kumaş Mı/.test(w) && /Field Mapping/.test(w)), result.warnings.join('\n'));
});

test('seçenek verilmezse bugünkü tek sorgu (inline) aynen çalışır', async () => {
  const db = fakeDb({ main: [{ ...order(1), ...fabricRow(1) }, { ...order(1), ...fabricRow(1, { 'Ana Kumaş Mı': 0, 'Kumaşçı': 'ASTAR' }) }] });
  const result = await modelRefresh.loadFromModelConnections([asasItem()], { ...base, runModelRows: db.runModelRows });
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0], /'Kumaş'\[Ana Kumaş Mı\]/);
  assert.match(db.queries[0], /COUNTROWS\('Kumaş'\)/);
  assert.equal(result.asasOrdersByTarget.cp[0].fabricSupplier, 'MILL 1');
});

test('separate: LFL satırları da kumaş alanlarını alır', async () => {
  const db = fakeDb({ main: [order(1, {
    'Marka Müdürlükleri': 'X', 'Para Birimi': 'USD', 'Model Bütçe Tarih Yıl Ay Gün': '2027-02-01', 'Sipariş Yerleştirme MerchTarih': '2026-08-01',
    'Merch Alt Grup Kod': 'MAG1', 'Merch Marka Yaş Grup Kod': 'MMYG1', 'Ürün Klasman': 'ÜST', 'Siparişin Üretildiği Ülke': 'INDIA',
    'Buyer Grup (TR)': 'GRUP A', Buyer: 'BUYER A',
  })] });
  const result = await modelRefresh.loadFromModelConnections([asasItem()], { ...base, targets: ['lfl'], includeLfl: true, runModelRows: db.runModelRows, asasFabricMode: 'separate' });
  assert.ok(Array.isArray(result.lflRows) && result.lflRows.length === 1, JSON.stringify(result.warnings));
  assert.equal(result.lflRows[0].fabricSupplier, 'MILL 1');
});
