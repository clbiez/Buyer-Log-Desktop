'use strict';
/* WS6a (#1079) parite kapısı: Koleksiyon statü araması ve filtre değeri.
 *
 * Kök neden (CDP profili, 2k Koleksiyon satırı): satır başına statü etiketi/rengi
 * kolStatusEntries() ile tüm satırları yeniden tarıyordu (O(N²)); kolFilterValue her
 * çağrıda sütun şemasını tüm satırlardan çıkarıyordu (O(N²)). Anahtar
 * (BL_READ_MODEL_COLLECTION) açıkken aynı sonuç tek turluk anlık görüntüyle üretilir.
 *
 * Burada app-main.js'teki GERÇEK fonksiyonlar vm'de, anahtar kapalı (eski yol) ve açık
 * (yeni yol) çalıştırılır; çıktılar read-model-parity ile hash olarak karşılaştırılır.
 * İki kapsam: (1) kendi düzenlenebilir sayfası (özel katalog), (2) çoklu sahip salt
 * okunur görünüm (iki sahibin satırları, varsayılan katalog). 2k ve 30k satır.
 * Ayrıca collection-status-catalog.normalize satır tekrar atlamasının eski algoritmayla
 * birebir aynı çıktıyı verdiği doğrulanır.
 * Varsayılan 2k satır ve satır başına örneklem (eski yol O(N²) olduğu için). Tam kanıt:
 *   BL_COLLECTION_PARITY_ROWS=2000,30000 BL_COLLECTION_PARITY_FULL=1 npm test -- read-model-collection
 * (FULL: ≤5k satırda her satır; 30k'da her 97. satır iki tarafta da aynı kolRows bağlamında.)
 */
const test = require('node:test'), assert = require('node:assert/strict');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');
const parity = require('./helpers/read-model-parity.cjs');
const Catalog = require('../public/collection-status-catalog.js');
const ColumnSchema = require('../public/column-schema.js');
const { buildCollectionRows } = require('../scripts/lib/erp-collection-fixture');
const COUNTS = String(process.env.BL_COLLECTION_PARITY_ROWS || '2000').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
const FULL = process.env.BL_COLLECTION_PARITY_FULL === '1';
// Kanıt koşusunda hash satırları yazılır (issue raporu için).
const check = async spec => { const result = await parity.assertParity(spec); if (FULL) console.log(result.message, `rows=${spec.rows.length}`); return result; };
// Eski yolun satır başına maliyeti O(N) olduğundan her iki taraf aynı örneklem satırlarını okur.
const sampleRows = rows => (rows.length > 5000 ? rows.filter((_, index) => index % 97 === 0) : FULL ? rows : rows.filter((_, index) => index % 5 === 0));

// Eski normalize (tekrar atlaması olmadan) — kütüphanenin kendi yardımcılarıyla.
function legacyNormalize(value, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const source = Array.isArray(value) && value.length ? value : Catalog.SEED;
  const out = [], seen = new Set();
  const seedFor = lookup => Catalog.SEED.find(entry => Catalog.key(entry.name) === lookup);
  source.forEach(item => {
    const raw = typeof item === 'string' ? { name: item } : item;
    const name = Catalog.canonicalName(String(raw && raw.name || '').trim()), lookup = Catalog.key(name);
    if (!name || seen.has(lookup)) return;
    seen.add(lookup);
    const seeded = seedFor(lookup);
    out.push({ name: seeded ? seeded.name : name, color: Catalog.normalizeColor(raw && raw.color, seeded && seeded.color || Catalog.DEFAULT_COLOR), builtin: seeded ? true : (raw && Object.prototype.hasOwnProperty.call(raw, 'builtin') ? Boolean(raw.builtin) : false) });
  });
  (Array.isArray(opts.rowStatuses) ? opts.rowStatuses : []).forEach(value => {
    const name = Catalog.canonicalName(String(value == null ? '' : value).trim()), lookup = Catalog.key(name);
    if (!name || seen.has(lookup)) return;
    seen.add(lookup);
    const seeded = seedFor(lookup);
    out.push({ name: seeded ? seeded.name : name, color: seeded ? seeded.color : Catalog.DEFAULT_COLOR, builtin: Boolean(seeded) });
  });
  return out.length ? out : Catalog.seed();
}

// Statü çeşitliliği: kanonik, İngilizce takma ad, büyük/küçük harf, boşluk, özel, boş.
const STATUS_POOL = ['Pending File', 'Siparişe Hazır', 'Ready for Order', '  sipariş geçildi ', 'İPTAL', 'Dropped', 'Konsept Onaylı', 'Custom Review', 'custom review', '', null, 'Fiyatlamada', 'Depoda'];
function scopedRows(count, scope) {
  const rows = buildCollectionRows(count, scope === 'own' ? 7 : 11);
  rows.forEach((row, index) => { row.durum = STATUS_POOL[(index * 7 + (scope === 'own' ? 0 : 3)) % STATUS_POOL.length]; });
  if (scope === 'multi') rows.forEach((row, index) => { row._ownerId = index % 2 ? 'owner-b' : 'owner-a'; });
  return rows;
}
const CATALOGS = {
  // Kendi sayfası: özel statü + yeniden renklendirilmiş yerleşik, bazı yerleşikler katalogda yok.
  own: [{ name: 'Pending File', color: '#123456', builtin: true }, { name: 'Custom Review', color: '#abc' }, { name: 'Siparişe Hazır' }],
  // Çoklu sahip görünümü: kayıtlı katalog yok → yerleşik tohum + satır statüleri.
  multi: [],
};
const PROBES = [...STATUS_POOL, 'Unknown Status', 'Capacity Request', 'Awaiting Concept Approval', '  '];

function loadStatusFns(flag) {
  const store = new Map();
  return loadAppMainFunctions([
    'kolNormalizeStatusCatalog', 'kolStatusEntries', 'kolStatusSnapshotEnabled', 'kolStatusLookup', 'kolStatusLookupEntry',
    'kolStatusCanonicalName', 'kolStatusEntry', 'kolStatusColor', 'kolStatusDisplayLabel', 'kolStatusDefaultName',
    'kolStatusExcelArgb', 'kolStatusExcelTextArgb',
  ], {
    window: { BL_READ_MODEL_COLLECTION: flag },
    localStorage: { getItem: key => store.get(key) ?? null },
    KOL_STATUS_API: Catalog, KOL_STATUS_SNAPSHOT_STORAGE_KEY: 'buyerlog.readModel.collection.v1',
    kolStatusSnapshotEnabledCache: null, kolStatusLookupCache: null,
    kolStatusCatalog: [], kolRows: [], appLang: 'tr', L: value => 'L:' + value, queueMicrotask,
  });
}
function statusView(fns, rows, catalog, lang) {
  const ctx = fns.context;
  ctx.kolRows = rows; ctx.kolStatusCatalog = catalog; ctx.appLang = lang;
  return {
    entries: fns.kolStatusEntries(), defaultName: fns.kolStatusDefaultName(),
    probes: PROBES.map(name => ({ name, entry: fns.kolStatusEntry(name), color: fns.kolStatusColor(name), label: fns.kolStatusDisplayLabel(name), argb: fns.kolStatusExcelArgb(name), text: fns.kolStatusExcelTextArgb(name) })),
    // Satır başına (Genel Bakış özeti / grup özeti / Excel deseni). Eski yol O(N²) olduğundan
    // 30k'da her iki tarafta aynı örneklem satırları (her 97. satır) aynı kolRows bağlamında okunur.
    perRow: sampleRows(rows).map(row => [fns.kolStatusDisplayLabel(row.durum), fns.kolStatusColor(row.durum)]),
  };
}

for (const count of COUNTS) {
  test(`collection-status-catalog.normalize: satır tekrar atlaması eski çıktıyla aynı (${count} satır)`, async () => {
    for (const scope of ['own', 'multi']) {
      const rows = scopedRows(count, scope), statuses = rows.map(row => row.durum);
      await check({
        name: `normalize ${scope} ${count}`, rows: statuses, context: { catalog: CATALOGS[scope] },
        legacy: (input, context) => legacyNormalize(context.catalog, { rowStatuses: input }),
        candidate: (input, context) => Catalog.normalize(context.catalog, { rowStatuses: input }),
      });
    }
  });
}

for (const count of COUNTS) {
  for (const scope of ['own', 'multi']) {
    test(`Koleksiyon statü araması parite: anahtar kapalı = açık (${scope}, ${count} satır, TR+EN)`, async () => {
      const legacyFns = loadStatusFns(false), candidateFns = loadStatusFns(true);
      for (const lang of ['tr', 'en']) {
        const result = await check({
          name: `status ${scope} ${count} ${lang}`, rows: scopedRows(count, scope), context: { catalog: CATALOGS[scope], lang },
          legacy: (rows, context) => statusView(legacyFns, rows, context.catalog, context.lang),
          candidate: (rows, context) => statusView(candidateFns, rows, context.catalog, context.lang),
        });
        assert.equal(result.equal, true);
        await Promise.resolve();
      }
    });
  }
}

test('Koleksiyon statü araması: anahtar açıkken satır sayısıyla doğrusal (tek turda tek tarama)', () => {
  const fns = loadStatusFns(true), ctx = fns.context;
  ctx.kolRows = scopedRows(30000, 'own'); ctx.kolStatusCatalog = CATALOGS.own;
  let scans = 0;
  const original = Catalog.normalize;
  ctx.KOL_STATUS_API = { ...Catalog, normalize: (...args) => { scans++; return original(...args); } };
  for (const row of ctx.kolRows) { fns.kolStatusDisplayLabel(row.durum); fns.kolStatusColor(row.durum); }
  // İlk görüntü + mevcut olmayan anahtarlar için en fazla birer kez tam okuma.
  assert.ok(scans <= 3, `30k satırda ${scans} tam tarama (beklenen ≤ 3)`);
});

test('Koleksiyon statü araması: aynı turda yeni görünen statü ve sonraki turda değişen satır doğru okunur', async () => {
  for (const flag of [false, true]) {
    const fns = loadStatusFns(flag), ctx = fns.context;
    ctx.kolRows = scopedRows(200, 'own'); ctx.kolStatusCatalog = [{ name: 'Pending File' }];
    ctx.appLang = 'en';
    assert.equal(fns.kolStatusDisplayLabel('Depoda'), 'Depoda');
    // Aynı tur: yapıştırma/içe aktarma bir satıra katalogda olmayan yerleşik statüyü yazar;
    // ilk sorguda anlık görüntüde yok → bir kez tam okuma → doğru etiket ve renk.
    ctx.kolRows[1].durum = 'Lisans Tanım';
    assert.equal(fns.kolStatusDisplayLabel('Lisans Tanım'), 'License Definition', `flag=${flag}`);
    assert.equal(fns.kolStatusColor('Lisans Tanım'), '#6172F3', `flag=${flag}`);
    // Katalogda yok, satırlarda yok → ham metin.
    assert.equal(fns.kolStatusDisplayLabel('GTIP'), 'GTIP');
    ctx.kolRows[0].durum = 'GTIP';
    // Aynı turda 'yok' olarak sorgulanmış anahtar: eski yol hemen görür; yeni yol bir
    // sonraki turda görür (bilinen, yalnız aynı eşzamanlı tur içinde, kozmetik sınır).
    if (!flag) assert.equal(fns.kolStatusDisplayLabel('GTIP'), 'HS Code');
    await Promise.resolve();
    assert.equal(fns.kolStatusDisplayLabel('GTIP'), 'HS Code', `flag=${flag}`);
    ctx.kolRows[0].durum = 'Pending File';
    await Promise.resolve();
    assert.equal(fns.kolStatusDisplayLabel('GTIP'), 'GTIP', `flag=${flag}`);
  }
});

function loadFilterFns(flag) {
  let schemaCalls = 0;
  const schemaApi = { ...ColumnSchema, resolveColumnSchema: (...args) => { schemaCalls++; return ColumnSchema.resolveColumnSchema(...args); } };
  const custom = { k: 'custom_score', label: 'Score', custom: true, dataType: 'number' };
  const custom2 = { k: 'custom_note', label: 'Note', custom: true };
  const cols = [{ k: 'durum', status: true }, { k: 'season' }, { k: 'fabric' }, { k: 'inStoreMonth', inStorePeriod: 'month' }, { k: 'quantity', qty: true }, { k: 'checks', checklist: true }, custom, custom2];
  const fns = loadAppMainFunctions(['columnSchemaFor', 'kolStatusSnapshotEnabled', 'kolFilterSchemaFor', 'kolFilterValue'], {
    window: { BL_READ_MODEL_COLLECTION: flag, BLColumnSchema: schemaApi },
    localStorage: { getItem: () => null }, KOL_STATUS_SNAPSHOT_STORAGE_KEY: 'buyerlog.readModel.collection.v1',
    kolStatusSnapshotEnabledCache: null, kolFilterSchemaCache: null, queueMicrotask,
    KOL_CONFIRMATION_FILTER_KEY: '__confirmation', KOL_CONFIRMED_NAME_FILTER_KEY: '__confirmedName',
    kolConfirmedPricing: row => Boolean(row.buyingSampleApproved), kolConfirmedDisplay: row => (row.selectedManufacturer ? { name: ' ' + row.selectedManufacturer + ' ' } : null),
    norm: value => String(value == null ? '' : value).trim(), kolColDefs: () => cols,
    kolEffectiveValue: (row, key) => row[key], kolChecklistDisplay: (value, row) => 'C:' + row.id,
    kolFabricDisplay: value => 'F:' + value, kolMonthCode: value => (String(value || '').slice(0, 7) || ''),
    kolRows: [],
  });
  return { fns, calls: () => schemaCalls };
}
const FILTER_KEYS = ['__confirmation', '__confirmedName', 'durum', 'season', 'fabric', 'inStoreMonth', 'quantity', 'checks', 'custom_score', 'custom_note', 'missing'];
function filterView(fns, rows) {
  fns.context.kolRows = rows;
  return rows.map(row => FILTER_KEYS.map(key => fns.kolFilterValue(row, key)));
}
function filterRows(count, scope) {
  return scopedRows(count, scope).map((row, index) => ({ ...row, custom_score: index % 5 ? String(index % 17) + '.5' : '', custom_note: index % 3 ? 'n' + (index % 4) : null, inStoreMonth: row.inStore }));
}

for (const count of COUNTS) {
  test(`Koleksiyon filtre değeri parite: anahtar kapalı = açık (${count} satır, iki kapsam)`, async () => {
    for (const scope of ['own', 'multi']) {
      const rows = filterRows(count, scope);
      // Eski yol O(N²): 30k'da her iki tarafta aynı örneklem satırları aynı kolRows bağlamında okunur.
      const pick = sampleRows;
      const legacy = loadFilterFns(false), candidate = loadFilterFns(true);
      await check({
        name: `filter ${scope} ${count}`, rows, context: {},
        legacy: input => { legacy.fns.context.kolRows = input; return pick(input).map(row => FILTER_KEYS.map(key => legacy.fns.kolFilterValue(row, key))); },
        candidate: input => { candidate.fns.context.kolRows = input; return pick(input).map(row => FILTER_KEYS.map(key => candidate.fns.kolFilterValue(row, key))); },
      });
      await Promise.resolve();
    }
  });
}

test('Koleksiyon filtre değeri: anahtar açıkken şema yalnız özel sütunda, turda bir kez çözülür', async () => {
  const rows = filterRows(1000, 'own');
  const off = loadFilterFns(false), on = loadFilterFns(true);
  filterView(off.fns, rows);
  filterView(on.fns, rows);
  // Eski yol: her çağrıda (8 tanımlı sütun × satır) tam tarama.
  assert.equal(off.calls(), rows.length * 8);
  // Yeni yol: iki özel sütun × bir tur.
  assert.equal(on.calls(), 2);
  await Promise.resolve();
  // Satır sayısı değişince (ekleme/silme) aynı turda bile şema yeniden çözülür.
  on.fns.kolFilterValue(rows[0], 'custom_score');
  on.fns.context.kolRows = rows.slice(0, 10);
  on.fns.kolFilterValue(rows[0], 'custom_score');
  assert.equal(on.calls(), 4);
});

// Kullanıcı kararı (#1079): anahtar varsayılan AÇIK; yalnız açık geri dönüş eski yolu çalıştırır.
test('Koleksiyon statü anahtarı varsayılan açık; window=false veya depo "0" eski yola döner', () => {
  const run = ({ flag, stored, throws } = {}) => loadAppMainFunctions(['kolStatusSnapshotEnabled'], {
    window: flag === undefined ? {} : { BL_READ_MODEL_COLLECTION: flag },
    localStorage: { getItem: () => { if (throws) throw new Error('blocked'); return stored ?? null; } },
    KOL_STATUS_SNAPSHOT_STORAGE_KEY: 'buyerlog.readModel.collection.v1', kolStatusSnapshotEnabledCache: null,
  }).kolStatusSnapshotEnabled();
  assert.equal(run(), true, 'ayar yoksa açık');
  assert.equal(run({ throws: true }), true, 'depo okunamazsa açık');
  assert.equal(run({ stored: '1' }), true);
  assert.equal(run({ stored: '0' }), false, 'cihazda kapatma');
  assert.equal(run({ flag: false, stored: '1' }), false, 'window=false her şeyi ezer');
  assert.equal(run({ flag: true, stored: '0' }), true);
});
