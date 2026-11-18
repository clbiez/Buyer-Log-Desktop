'use strict';

/* Saha verisi (kaynak doğrulama aracı, 2026-11-18): IAS Database'de statüsü
   boş 7.757 satır BL siparişlerine ait. Dosya numarası OLANLARIN (7.547) hiçbiri
   Antrepo Excel'de yok; BL bunları atmaya devam eder. Dosyası OLMAYAN 210
   satırın hepsinde yükleme talep tarihi dolu (Kamyon, HANDOVER yok); Antrepo
   Excel bunları İthalat Dosya No = "Dosyası Oluşmamıştır" ile gösterir.
   Kullanıcı kararı: ayrı parsiyel olarak görünsünler. BL yeni statü metni
   üretmez: aşama "Yükleme Operasyonları", dosya etiketi Excel'deki gibi. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));
const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

const row = over => ({
  'İthalat Dosya No': '', 'Konteyner No': '', 'Sipariş Kod': 1279352, 'Model Adı': 'KK.TSH,CREW-M', 'Renk Kod': 'HFH',
  'Supplier Portal Statü': '', 'Tahmini Antrepo Giriş Tarihi': '', 'Vasita Tanim': 'Kamyon',
  'Yükleme Talep Tarih': '2026-03-12', 'Yükleme Toplam Adet': 1445, ...over,
});

test('statüsü boş, dosyası yok ama yükleme talebi olan satır Yükleme Operasyonları parsiyeli olarak kalır', () => {
  const normalized = modelRefresh.normalizeAntrepoDatabaseRows([row({})]);
  assert.equal(normalized.rows.length, 1);
  assert.equal(normalized.rows[0]['Supplier Portal Statü'], 'Yükleme Operasyonları');
  assert.equal(normalized.rows[0]['İthalat Dosya No'], 'Dosyası Oluşmamıştır');
  assert.equal(normalized.stats.loadingRequestRows, 1);
  assert.equal(normalized.stats.blankStatusRows, 0);
  // BL'ın statü sınıflandırması bu aşamayı yükleme olarak tanır.
  assert.equal(parse.antrepoStatusKey(normalized.rows[0]['Supplier Portal Statü']), 'YUKLEME OPERASYONLARI');
});

test('dosyası olan statüsüz satır (Excel\'de yok) ve talebi olmayan dosyasız satır atılmaya devam eder', () => {
  const normalized = modelRefresh.normalizeAntrepoDatabaseRows([
    row({ 'İthalat Dosya No': '2026.000646.I', 'HANDOVER Tarihi': '2026-04-08' }),
    row({ 'Yükleme Talep Tarih': '' }),
  ]);
  assert.equal(normalized.rows.length, 0);
  assert.equal(normalized.stats.blankStatusRows, 2);
  assert.equal(normalized.stats.loadingRequestRows, 0);
});

test('IAS eşlemesinde Yükleme Talep Tarih yoksa kural uygulanmaz (bugünkü davranış)', () => {
  const { ['Yükleme Talep Tarih']: _omit, ...withoutRequest } = row({});
  const normalized = modelRefresh.normalizeAntrepoDatabaseRows([withoutRequest]);
  assert.equal(normalized.rows.length, 0);
});

test('tutulan satır Backlog eşleştirmesinde ayrı parsiyel olarak görünür', () => {
  const normalized = modelRefresh.normalizeAntrepoDatabaseRows([row({}), row({ 'İthalat Dosya No': 'D-9', 'Supplier Portal Statü': 'Depoda', 'Yükleme Toplam Adet': 500 })]);
  const map = parse.parseAntrepoRows(normalized.rows);
  const order = { ocode: 1279352, _matchOcode: '1279352', model: 'KK.TSH,CREW-M', ccode: 'HFH' };
  const hits = parse.findAntrepoHits(map, order, {});
  assert.deepEqual(hits.map(h => [h.statu, h.importFile, h.loadedQty]).sort(), [['Depoda', 'D-9', 500], ['Yükleme Operasyonları', 'Dosyası Oluşmamıştır', 1445]]);
});

test('tutulan satır sayısı yenileme uyarısında TR/EN bildirilir', async () => {
  const T = 'Siparis Bilgileri';
  const item = {
    id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: T, seasonTable: T, seasonField: 'Sezon', seasons: ['S6'], groups: [] },
    mapping: {
      'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
      'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
      'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
      'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
      'Yükleme Talep Tarih': { table: 'Ithalat', name: 'Yükleme Talep Tarih', kind: 'column' },
      'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
      'Sezon': { table: T, name: 'Sezon', kind: 'column' },
    },
  };
  const run = await modelRefresh.queryConnectionRows(item, {
    columnType: false, discoverSchema: async () => ({ columns: [], measures: [] }),
    runModelRows: async () => ({ rows: [row({})], rowCount: 1 }),
  });
  assert.equal(run.rows.length, 1);
  assert.ok(run.warnings.some(w => /1 IAS satırı/.test(w) && /1 IAS rows/.test(w)), run.warnings.join('\n'));
});
