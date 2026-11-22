'use strict';

/* Aynı (bağlantı, kapsam) sorgusu CP/Orders/Backlog/Fiyat Analizi'ni birlikte
   besliyorsa sonuç hedef başına AYRI AYRI ayrıştırılıyordu. Dört bayt bayt aynı
   dizi, kimlik tabanlı snapshot sıkıştırmasından (model-snapshot.js
   compactSnapshotPayload) kaçıyor; ASAS diske dört, IAS üç kez yazılıyor ve
   bellekte de o kadar kopya tutuluyordu. Excel/Dashboard kaynakları zaten tek
   diziyi paylaşır; model kaynağı da artık her run'ı bir kez ayrıştırır.

   Sözleşme: içerik hedef başına eski yolla birebir aynıdır; yalnız aynı run'ı
   paylaşan hedefler aynı nesneyi taşır. Farklı kapsamlar ayrı kalır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const modelRefresh = require(path.join(ROOT, 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(ROOT, 'server', 'lib', 'model-fields.js'));
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

const M = 'Model Özellikleri', T = 'Siparis Bilgileri';
const ASAS_TARGETS = ['cp', 'orders', 'backlog', 'priceanalysis'];
function asas(scopes) {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) mapping[field.header] = { table: M, name: field.header, kind: 'column' };
  return { id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'ASAS', refreshEnabled: true, mappingEnhancementScanVersion: 4,
    horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['S6', 'W6'], groups: [] }, mapping, ...(scopes ? { scopes } : {}) };
}
function ias() {
  return { id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'IASv2', refreshEnabled: true,
    horizon: { table: T, groups: [] },
    mapping: {
      'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
      'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
      'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
      'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
    } };
}
const order = code => ({ 'Sipariş Kod': code, 'Model Adı': `M${code}`, 'Renk Kod': 'C', 'Renk': 'X', 'Net Alım Sipariş Miktarı': 100 + code,
  'FOB Fiyatı': 2, 'Üretici': 'U', 'Sezon': code % 2 ? 'W6' : 'S6', 'Orijinal Exfactory Merch Tarih': '2026-09-01', 'Ek Ham Sütun': `v${code}` });
const iasRow = code => ({ 'İthalat Dosya No': `D${code}`, 'Sipariş Kod': code, 'Model Adı': `M${code}`, 'Renk Kod': 'C',
  'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-20', 'Yükleme Toplam Adet': 100 });
const ORDERS = [1, 2, 3, 4].map(order), IAS_ROWS = [1, 3].map(iasRow);

async function refresh(items, targets = [...ASAS_TARGETS, 'lfl']) {
  let asasQueries = 0;
  const result = await modelRefresh.loadFromModelConnections(items, {
    targets, includeLfl: false, columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }),
    runModelRows: async plan => {
      const isIas = /'Ithalat'/.test(plan.query);
      if (!isIas) asasQueries += 1;
      const rows = (isIas ? IAS_ROWS : ORDERS).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    },
  });
  return { result, asasQueries };
}

test('tek kapsamın run\'ı tüm ASAS hedeflerine aynı dizi, tüm IAS hedeflerine aynı harita olarak verilir', async () => {
  const { result, asasQueries } = await refresh([asas(), ias()]);
  assert.equal(asasQueries, 1, 'tek kapsam tek sorgu');
  const byTarget = result.asasOrdersByTarget;
  assert.deepEqual(Object.keys(byTarget).sort(), [...ASAS_TARGETS].sort());
  for (const target of ASAS_TARGETS) assert.equal(byTarget[target], byTarget.cp, `${target} cp ile aynı diziyi paylaşmalı`);
  assert.equal(result.asasOrders, byTarget.cp);
  const maps = result.antrepoMapByTarget;
  for (const target of ['orders', 'backlog']) assert.equal(maps[target], maps.cp, `IAS ${target} cp ile aynı haritayı paylaşmalı`);
  assert.equal(result.antrepoMap, maps.cp);
});

test('paylaşılan sonuç, hedef başına eski bağımsız ayrıştırmayla bayt bayt aynıdır', async () => {
  const { result } = await refresh([asas(), ias()]);
  const legacyOrders = JSON.stringify(parse.parseASASRows(ORDERS.map(r => ({ ...r }))).orders);
  for (const target of ASAS_TARGETS) assert.equal(JSON.stringify(result.asasOrdersByTarget[target]), legacyOrders, target);
  const legacyMap = JSON.stringify(parse.parseAntrepoRows(IAS_ROWS.map(r => ({ ...r }))));
  for (const target of ['cp', 'orders', 'backlog']) assert.equal(JSON.stringify(result.antrepoMapByTarget[target]), legacyMap, `IAS ${target}`);
  assert.ok(result.asasOrdersByTarget.cp[0]._sourceFields['Ek Ham Sütun'], 'ham sütunlar korunur');
});

test('farklı kapsamlar ayrı run ve ayrı dizi olarak kalır', async () => {
  const scopes = [
    { id: 'genel', name: 'Genel', enabled: true, targets: ['cp', 'orders'], horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['W6'], groups: [] } },
    { id: 'dar', name: 'Dar', enabled: true, targets: ['backlog', 'priceanalysis'], horizon: { table: M, seasonTable: M, seasonField: 'Sezon', seasons: ['S6'], groups: [] } },
  ];
  const { result, asasQueries } = await refresh([asas(scopes)], ASAS_TARGETS);
  assert.equal(asasQueries, 2);
  const byTarget = result.asasOrdersByTarget;
  assert.equal(byTarget.orders, byTarget.cp);
  assert.equal(byTarget.priceanalysis, byTarget.backlog);
  assert.notEqual(byTarget.backlog, byTarget.cp, 'ayrı kapsam ayrı ayrıştırma');
});

test('paylaşılan run snapshot\'ta tek kopya yazılır ve eski çok kopyalı snapshot aynı içerikle açılır', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-shared-run-'));
  const previous = process.env.BUYER_LOG_LOCAL_DATA_ROOT;
  process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
  const userData = require.resolve(path.join(ROOT, 'server', 'user-data.js'));
  const snapshotModule = require.resolve(path.join(ROOT, 'server', 'lib', 'model-snapshot.js'));
  delete require.cache[userData]; delete require.cache[snapshotModule];
  try {
    const snapshot = require(snapshotModule);
    const { result } = await refresh([asas(), ias()]);
    const payload = { loadedAt: result.loadedAt, asasOrders: result.asasOrders, asasOrdersByTarget: result.asasOrdersByTarget,
      antrepoMap: result.antrepoMap, antrepoMapByTarget: result.antrepoMapByTarget, lflRows: [] };
    // Eski davranış: hedef başına bağımsız ayrıştırma (aynı içerik, ayrı nesneler).
    const legacy = { ...payload,
      asasOrdersByTarget: Object.fromEntries(ASAS_TARGETS.map(t => [t, t === 'cp' ? payload.asasOrders : parse.parseASASRows(ORDERS.map(r => ({ ...r }))).orders])),
      antrepoMapByTarget: Object.fromEntries(['cp', 'orders', 'backlog'].map(t => [t, t === 'cp' ? payload.antrepoMap : parse.parseAntrepoRows(IAS_ROWS.map(r => ({ ...r })))])) };
    const shared = snapshot.saveModelSnapshot('shared', payload);
    const old = snapshot.saveModelSnapshot('legacy', legacy);
    assert.equal(shared.aliasCount, 7, '4 ASAS + 3 IAS hedefi takma ad olarak yazılır');
    assert.equal(old.aliasCount, 2, 'eski yol yalnız cp takma adını yakalıyordu');
    assert.ok(shared.uncompressedBytes < old.uncompressedBytes * 0.5, `${shared.uncompressedBytes} < ${old.uncompressedBytes}/2`);
    const a = snapshot.loadModelSnapshot('shared'), b = snapshot.loadModelSnapshot('legacy');
    for (const t of ASAS_TARGETS) assert.equal(JSON.stringify(a.asasOrdersByTarget[t]), JSON.stringify(b.asasOrdersByTarget[t]), t);
    for (const t of ['cp', 'orders', 'backlog']) assert.equal(JSON.stringify(a.antrepoMapByTarget[t]), JSON.stringify(b.antrepoMapByTarget[t]), `IAS ${t}`);
    assert.equal(a.asasOrdersByTarget.backlog, a.asasOrders, 'yeni snapshot yüklemede tek kopya paylaşır');
    assert.ok(a.asasOrders[0].ex instanceof Date, 'tarihler yine Date olarak döner');
  } finally {
    if (previous === undefined) delete process.env.BUYER_LOG_LOCAL_DATA_ROOT; else process.env.BUYER_LOG_LOCAL_DATA_ROOT = previous;
    delete require.cache[userData]; delete require.cache[snapshotModule];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
