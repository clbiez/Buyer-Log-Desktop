'use strict';

/* IAS gerçekleşen kilometre taşı tarihleri normal (CP/Backlog) IAS yenilemesine.
   Gerçek talep: "Gerçekleşenleri IAS yenilemesine ekle." Depodaki parsiyelin
   gerçekleşen antrepo girişi ve ara adımlar (Cut Off, Fiili Yükleme, gümrük)
   yalnız Yol Süresi Analizi sorgusunda vardı. Yenileme bunları bir kez şemadan
   birebir adla ekler; tahmini tarih sütunu asla "gerçekleşen" sayılmaz; sütunlar
   sorguyu bozarsa yenileme bunlar olmadan tamamlanır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));
const source = require(path.join(__dirname, '..', 'server', 'lib', 'transit-analysis-source.js'));

const T = 'Siparis Bilgileri';
function ias(over = {}) {
  return {
    id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: T, seasonTable: T, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: {
      'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
      'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
      'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
      'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
      'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
      // Tahmini tarih fiziksel olarak "Antrepo Giriş Tarihi" sütununa bağlı.
      'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Antrepo Giriş Tarihi', kind: 'column' },
      'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'column' },
      'Sezon': { table: T, name: 'Sezon', kind: 'column' },
    },
    ...over,
  };
}
const schema = { measures: [], columns: [
  { table: 'Ithalat', name: 'Antrepo Giriş Tarihi', kind: 'column' },     // tahmini için eşlenmiş: alınmaz
  { table: 'Ithalat', name: 'Tema Depo Giriş Tarihi', kind: 'column' },
  { table: 'Ithalat', name: 'Cut Off Tarihi', kind: 'column' },
  { table: 'Ithalat', name: 'Fiili Yükleme Tarihi', kind: 'column' },
  { table: 'Ithalat', name: 'Fiili Yükleme Tarihi Gün Ay Yıl', kind: 'column' }, // içerme eşleşmesi yok
  { table: 'Musteri', name: 'Özet Beyan Onay Tarihi', kind: 'column' },     // IAS tablosu değil: alınmaz
] };
const row = { 'İthalat Dosya No': 'D-1', 'Sipariş Kod': 1, 'Model Adı': 'M', 'Renk Kod': 'C', 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-01-01', 'Yükleme Toplam Adet': 5 };

test('şema taraması yalnız birebir adla, IAS tablosundan ve eşlenmemiş sütunları ekler', async () => {
  const item = ias();
  const repair = await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => schema });
  assert.equal(repair.repaired, true, 'kalıcı bağlantıya yazılsın');
  assert.deepEqual(Object.keys(repair.mapping).filter(h => modelFields.IAS_MILESTONE_FIELDS.some(f => f.header === h)).sort(),
    ['Cut Off Tarih', 'Fiili Yükleme Tarih', 'Tema Depo Giriş Tarih']);
  assert.equal(item.mapping['Antrepo Giriş Tarih'], undefined, 'tahmini tarih sütunu gerçekleşen sayılmaz');
  assert.equal(item.mapping['Fiili Yükleme Tarih'].name, 'Fiili Yükleme Tarihi');
  assert.equal(item.mapping['Özet Beyan Onay Tarih'], undefined, 'IAS dışı tablodan sütun alınmaz');
  assert.equal(item.mapping['Tahmini Antrepo Giriş Tarihi'].name, 'Antrepo Giriş Tarihi', 'mevcut eşleme korunur');
  assert.equal(item.mappingEnhancementScanVersion, 5);
  // İkinci yenilemede tarama tekrarlanmaz.
  let scans = 0;
  const again = await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => { scans += 1; return schema; } });
  assert.equal(scans, 0);
  assert.equal(again.repaired, false);
  // Başlıklar aşama modelinin okuduğu adlardır.
  for (const f of modelFields.IAS_MILESTONE_FIELDS) {
    const field = Object.entries(source.SOURCE_FIELDS).find(([, names]) => names.includes(f.header));
    assert.ok(field, f.header);
  }
});

test('manuel sorgu modunda ve şema okunamazsa yenileme durmaz', async () => {
  let scans = 0;
  const manual = ias({ mode: 'manual', query: 'EVALUATE X' });
  await modelRefresh.ensureConnectionMapping(manual, { discoverSchema: async () => { scans += 1; return schema; } });
  assert.equal(scans, 0);
  const item = ias();
  const repair = await modelRefresh.ensureConnectionMapping(item, { discoverSchema: async () => { throw new Error('şema yok'); } });
  assert.equal(repair.repaired, true);
  assert.equal(item.mappingEnhancementScanVersion, 5, 'tekrar denenmez');
  assert.equal(item.mapping['Cut Off Tarih'], undefined);
});

test('yenileme sorgusu yeni sütunları getirir; bozarsa sütunlar çıkarılıp bir kez yeniden denenir', async () => {
  const queries = [];
  const ok = await modelRefresh.queryConnectionRows(ias(), { columnType: false, discoverSchema: async () => schema,
    runModelRows: async plan => { queries.push(plan.query); return { rows: [{ ...row, 'Cut Off Tarih': '2025-12-01' }], rowCount: 1 }; } });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /Cut Off Tarihi/);
  assert.equal(ok.mappingRepaired, true);

  const failing = ias();
  const seen = [];
  const run = await modelRefresh.queryConnectionRows(failing, { columnType: false, discoverSchema: async () => schema,
    runModelRows: async plan => { seen.push(plan.query); if (/Cut Off Tarihi/.test(plan.query)) throw new Error("Query (3, 1) Column 'Cut Off Tarihi' cannot be used"); return { rows: [{ ...row }], rowCount: 1 }; } });
  assert.equal(seen.length, 2);
  assert.doesNotMatch(seen[1], /Cut Off Tarihi|Fiili Yükleme Tarihi|Tema Depo/);
  assert.equal(run.rows.length, 1);
  assert.equal(failing.iasMilestonesDisabled, true);
  assert.equal(failing.mapping['Cut Off Tarih'], undefined);
  assert.equal(run.mappingRepaired, true, 'çıkarma kalıcı bağlantıya yazılır');
  assert.ok(run.warnings.some(w => /gerçekleşen tarih sütunları/.test(w)), run.warnings.join('\n'));

  // Sorun bu sütunlar değilse (yeniden deneme de başarısız) eşleme geri konur ve hata aynen yükselir.
  const outage = ias();
  await assert.rejects(modelRefresh.queryConnectionRows(outage, { columnType: false, discoverSchema: async () => schema,
    runModelRows: async () => { throw new Error('Model sorgusu zaman aşımına uğradı (600 sn).'); } }), /zaman aşımı/);
  assert.ok(outage.mapping['Cut Off Tarih'], 'geçici kesintide sütunlar kaybolmaz');
  assert.notEqual(outage.iasMilestonesDisabled, true);
});
