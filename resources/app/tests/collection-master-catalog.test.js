'use strict';

/* Koleksiyon "ASAS'tan seç" hücreleri gerçek ASAS veri modelinden beslenir.

   Regresyon: License/Category/Country… önerileri yalnız kullanıcının okunmuş
   ve ufuk/kapsam filtresinden geçmiş sipariş satırlarından kuruluyordu; filtre
   dışındaki gerçek ASAS değerleri (ör. Dragon Ball, One Piece) listede yoktu.
   PLM → ASAS çeviri penceresi de aynı dar listeyi "ASAS kataloğu" diye
   gösteriyordu. Elle giriş serbest kalır; ama yazım farkı formül/kural
   eşleşmesini bozmasın diye kanonik ASAS yazımına çekilir, öğrenilmiş eşanlam
   uygulanır ve ASAS'ta olmayan değer işaretlenir. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const lib = require('../server/lib/collection-master-catalog');
const parse = require('../server/lib/parse');
const canonicalFields = require('../server/lib/canonical-fields');

function extractBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `${startText} bulunamadı`);
  assert.ok(end > start, `${endText} sınırı bulunamadı`);
  return source.slice(start, end);
}

const CONNECTION = {
  role: 'asas', server: 'srv', catalog: 'ASAS',
  horizon: { table: 'Sipariş' },
  mapping: {
    'Ürün Klasman': { table: 'Ürün', name: 'Ürün Klasman' },
    'Lisans': { table: 'Ürün', name: 'Lisans' },
    'Sezon': { name: 'Sezon' },
    'Siparişin Üretildiği Ülke': { table: 'Sipariş', name: 'Üretim Ülkesi' },
    'Line': { table: 'Ürün', name: 'Line' },
    'Üretici': { table: 'Tedarikçi', name: 'Üretici' },
  },
  customFields: [{ header: 'Ürün Tanım', column: { table: 'Ürün', name: 'Ürün Ana Tanım' } }],
};

function fakeModel(valuesByColumn, failing = new Set()) {
  const queries = [];
  const run = async options => {
    queries.push(options.query);
    const match = /DISTINCT\('([^']+)'\[([^\]]+)\]\)/.exec(options.query);
    const key = match ? `${match[1]}[${match[2]}]` : '';
    if (failing.has(key)) throw new Error(`${key} okunamadı`);
    return { rows: (valuesByColumn[key] || []).map(value => ({ [`[${key}]`]: value })) };
  };
  return { run, queries };
}

test('ana katalog ASAS modelinden ufuk/kaynak filtresi OLMADAN DISTINCT okunur ve kimlikle tekilleşir', async () => {
  const model = fakeModel({
    'Ürün[Lisans]': ['DRAGON BALL', 'Dragon Ball', 'One Piece', 'Garfield', ' '],
    'Ürün[Ürün Klasman]': ['KEY ORME BODY K.KOL-LİSANS'],
    'Sipariş[Sezon]': ['S7', 'W6'],
    'Sipariş[Üretim Ülkesi]': ['ÇİN', 'TÜRKİYE'],
    'Ürün[Line]': ['KEY'],
    'Tedarikçi[Üretici]': ['ERMODA'],
    'Ürün[Ürün Ana Tanım]': ['T-SHIRT', 't-shirt'],
  });
  const snapshot = await lib.readMasterCatalog({
    connections: [CONNECTION], runModelRows: model.run,
    transforms: { country: parse.countryEN }, now: () => new Date('2026-09-29T08:00:00Z'),
  });

  assert.equal(model.queries.length, lib.MASTER_CATALOG_FIELDS.length);
  for (const query of model.queries) {
    assert.match(query, /^EVALUATE TOPN\(\d+, DISTINCT\('[^']+'\[[^\]]+\]\), /);
    assert.doesNotMatch(query, /FILTER|CALCULATETABLE|KEEPFILTERS|TREATAS/, 'katalog okuması ufuk/kaynak filtresi taşımamalı');
  }
  assert.deepEqual(snapshot.catalogs.license, ['DRAGON BALL', 'Garfield', 'One Piece']);
  assert.deepEqual(snapshot.catalogs.season, ['S7', 'W6']);
  assert.deepEqual(snapshot.catalogs.country, [parse.countryEN('ÇİN'), parse.countryEN('TÜRKİYE')].sort((a, b) => a.localeCompare(b, 'tr-TR')));
  assert.notEqual(parse.countryEN('ÇİN'), 'ÇİN', 'ülke, sipariş satırlarıyla aynı İngilizce yazıma çevrilmeli');
  assert.deepEqual(snapshot.catalogs.productMainDefinition, ['T-SHIRT']);
  assert.equal(snapshot.refreshedAt, '2026-09-29T08:00:00.000Z');
  assert.ok(snapshot.fields.every(field => !field.error));
  assert.equal(snapshot.fields.find(field => field.key === 'season').count, 2);
  // Kapsam/yetki alanları ana kataloğa girmez.
  for (const scopeKey of ['mag', 'mmyg', 'buyingGroup', 'buyer', 'licensor']) assert.equal(lib.MASTER_CATALOG_KEYS.includes(scopeKey), false);
});

test('okunamayan alan önceki listesini korur, diğer alanlar yine tazelenir; bağlantı yoksa 409', async () => {
  const model = fakeModel({ 'Ürün[Lisans]': ['Naruto'], 'Ürün[Ürün Klasman]': ['YENİ'] }, new Set(['Ürün[Ürün Klasman]']));
  const previous = { catalogs: { category: ['ESKİ KLASMAN'], license: ['Marvel'] }, fields: [{ key: 'category', readAt: '2026-09-01T00:00:00.000Z' }], refreshedAt: '2026-09-01T00:00:00.000Z' };
  const snapshot = await lib.readMasterCatalog({ connections: [CONNECTION], runModelRows: model.run, previous });
  assert.deepEqual(snapshot.catalogs.category, ['ESKİ KLASMAN']);
  assert.deepEqual(snapshot.catalogs.license, ['Naruto']);
  const category = snapshot.fields.find(field => field.key === 'category');
  assert.match(category.error, /okunamadı/);
  assert.equal(category.readAt, '2026-09-01T00:00:00.000Z');

  const unmapped = await lib.readMasterCatalog({ connections: [{ role: 'asas', server: 's', catalog: 'c', mapping: {} }], runModelRows: model.run });
  assert.ok(unmapped.fields.every(field => /eşlenmemiş/.test(field.error)));
  assert.equal(unmapped.refreshedAt, null);

  await assert.rejects(
    lib.readMasterCatalog({ connections: [{ role: 'intake', server: 's', catalog: 'c' }], runModelRows: model.run }),
    error => error.code === 'ASAS_CONNECTION_MISSING' && error.statusCode === 409,
  );
});

test('depo anlık görüntüyü yazar, eskimişse arka planda bir kez tazeler ve başarısız denemeden sonra geri çekilir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-master-catalog-'));
  const file = path.join(dir, 'collection-master-catalog.json');
  let now = Date.parse('2026-09-29T08:00:00Z'), calls = 0, fail = false;
  const store = lib.createMasterCatalogStore({
    file,
    runModelRows: async options => { calls += 1; if (fail) throw new Error('model erişimi yok'); return { rows: /Lisans/.test(options.query) ? [{ v: 'Smiley' }] : [] }; },
    loadConnections: () => [CONNECTION],
    nowMs: () => now,
  });
  assert.deepEqual(store.load().catalogs, {});
  assert.equal(store.refreshInBackgroundIfStale(), true);
  assert.equal(store.isRefreshing(), true);
  assert.equal(store.refreshInBackgroundIfStale(), false, 'uçuştaki tazeleme ikinci kez başlatılmaz');
  await store.refresh();
  assert.deepEqual(store.load().catalogs.license, ['Smiley']);
  assert.equal(store.refreshInBackgroundIfStale(store.load()), false, 'taze liste yeniden okunmaz');

  fail = true; calls = 0;
  const staleSnapshot = { ...store.load(), refreshedAt: '2026-01-01T00:00:00.000Z' };
  now += 60 * 60 * 1000;
  assert.equal(store.refreshInBackgroundIfStale(staleSnapshot), true);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(store.refreshInBackgroundIfStale(staleSnapshot), false, 'başarısız denemeden hemen sonra her GET modele gitmez');
  assert.deepEqual(store.load().catalogs.license, ['Smiley'], 'başarısız okuma kayıtlı listeyi silmez');
  now += lib.BACKGROUND_RETRY_MS + 1;
  assert.equal(store.refreshInBackgroundIfStale(staleSnapshot), true);
  await store.refresh().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sunucu ana katalog uçlarını Koleksiyon yetkisiyle açar ve ülkeyi sipariş satırlarıyla aynı dönüştürür', () => {
  assert.match(SERVER, /require\('\.\/lib\/collection-master-catalog'\)/);
  assert.match(SERVER, /app\.get\('\/api\/collection-master-catalog', userAccess\.requireArea\('koleksiyon'\)/);
  assert.match(SERVER, /app\.post\('\/api\/collection-master-catalog\/refresh', userAccess\.requireArea\('koleksiyon'\)/);
  assert.match(SERVER, /transforms: \{ country: parseLib\.countryEN \}/);
  assert.match(SERVER, /COLLECTION_MASTER_CATALOG_REFRESH/);
  assert.equal(typeof parse.countryEN, 'function');
});

function loadClientCatalog({ scoped = {}, overrides = {}, learned = {} } = {}) {
  const block = extractBetween(APP, 'const KOL_ASAS_CATALOG_KINDS', "// Excel'den gelen Category değeri");
  const turknormSrc = extractBetween(APP, 'function turknorm(s){', '\n}\n') + '\n}\n';
  const toasts = [];
  const learnedRules = { category: new Map(), line: new Map(), license: new Map() };
  for (const [field, map] of Object.entries(learned)) for (const [source, target] of Object.entries(map)) learnedRules[field].set(source, target);
  const factory = new Function('window', 'document', 'state', 'kolPlmApprovedTranslationRules', 'toasts', `
    let appLang='tr';
    const kolPlmApprovedTranslationRevision=1;
    function kolPlmLoadApprovedTranslations(){return Promise.resolve();}
    function norm(s){ return String(s==null?'':s).trim(); }
    ${turknormSrc}
    function escapeHtml(v){return String(v);}
    function fmtTsForTitle(v){return String(v||'');}
    function showToast(message){toasts.push(message);}
    function kolPlmSimilarityScore(field,a,b){a=turknorm(a).replace(/[^A-Z0-9]/g,'');b=turknorm(b).replace(/[^A-Z0-9]/g,'');return a&&b&&(a.includes(b)||b.includes(a))?90:0;}
    ${extractBetween(APP, 'function kolPlmLevenshtein(a,b){', 'function kolPlmSimilarityScore')}
    function kolMonthDisplay(v){return v;}
    let kolRows=[],kolManufacturers=[],_submfrValsCache=[];
    ${block}
    return {kolCatalogValues,kolCatalogMatch,kolSetMasterCatalog,kolCatalogValueUnknown,kolLearnedCatalogAlias,kolCatalogUnknownText,kolCatalogDropFooterHtml,KOL_MASTER_CATALOG_KINDS};
  `);
  const state = { collectionCatalogs: scoped, overrides };
  const window = { BLCanonicalFields: canonicalFields };
  const document = { activeElement: null, body: { dataset: {} } };
  return { api: factory(window, document, state, learnedRules, toasts), state, toasts };
}

test('istemci kataloğu ASAS ana kataloğunu sipariş kataloğuyla birleştirir; ana yazım önceliklidir', () => {
  const scopedLicense = ['DRAGONBALL', 'Liverpool', 'Marvel'];
  const { api } = loadClientCatalog({ scoped: { license: scopedLicense, mag: ['M1'] } });
  // Tam ana katalog henüz gelmemişse yüklü ASAS sipariş kataloğu görünür
  // doğrulama için fallback olur; hiç katalog yoksa yanlış pozitif üretilmez.
  assert.equal(api.kolCatalogValues('license'), scopedLicense);
  assert.equal(api.kolCatalogValueUnknown('license', 'Smiley'), true, 'yüklü ASAS sipariş listesinde olmayan değer hücrede işaretlenir');
  const emptyCatalog = loadClientCatalog();
  assert.equal(emptyCatalog.api.kolCatalogValueUnknown('license', 'Smiley'), false, 'hiç ASAS katalog verisi yoksa uyarı üretilmez');

  api.kolSetMasterCatalog({ catalogs: { license: ['Dragon Ball', 'Garfield', 'Liverpool', 'One Piece'], country: ['China', 'Turkey'], mag: ['X'] }, fields: [{ key: 'license', count: 4 }], refreshedAt: '2026-09-29T08:00:00Z' });
  assert.deepEqual(api.kolCatalogValues('license'), ['Dragon Ball', 'Garfield', 'Liverpool', 'Marvel', 'One Piece']);
  assert.equal(api.kolCatalogMatch('license', 'dragonball'), 'Dragon Ball');
  assert.equal(api.kolCatalogMatch('license', 'ONE-PIECE'), 'One Piece');
  assert.equal(api.kolCatalogMatch('country', 'Çin'), 'China', 'ülke kanonik ISO koduyla eşleşir');
  assert.equal(api.kolCatalogMatch('country', 'TÜRKİYE'), 'Turkey');
  // Kapsam alanları ana katalogdan beslenmez.
  assert.deepEqual(api.kolCatalogValues('mag'), ['M1']);

  assert.equal(api.kolCatalogValueUnknown('license', 'SMILEY'), true);
  assert.equal(api.kolCatalogValueUnknown('license', 'garfield'), false);
  assert.equal(api.kolCatalogValueUnknown('mag', 'ZZZ'), false);
  assert.match(api.kolCatalogUnknownText('license', 'Garfeld'), /ASAS veri tabanı listesinde yok[\s\S]*En yakın ASAS değeri: Garfield/);
  assert.doesNotMatch(api.kolCatalogUnknownText('license', 'Smiley'), /En yakın/, 'uzak değer için tahmin önerilmez');
  assert.match(api.kolCatalogDropFooterHtml('license', 'Smiley', 0), /serbest metin olarak kaydedilir/);
  assert.match(api.kolCatalogDropFooterHtml('license', '', 5), /ASAS veri tabanı · 5 değer[\s\S]*data-kol-catalog-refresh/);
  assert.equal(api.kolCatalogDropFooterHtml('mag', '', 1), '');
});

test('Licensor önerileri License Royalty kurallarını ve açık License → Licensor seçimlerini içerir', () => {
  const { api } = loadClientCatalog({
    scoped: { licensor: ['DTR'] },
    overrides: { pricingRules: [{ licensor: 'FAN MANIA', license: 'Naruto' }], licensormap: { a: 'ERMODA' } },
  });
  assert.deepEqual(api.kolCatalogValues('licensor'), ['DTR', 'ERMODA', 'FAN MANIA']);
});

test('öğrenilmiş PLM → ASAS eşanlamı elle girişte kanonik ASAS değerine çevrilir', () => {
  const { api } = loadClientCatalog({ learned: { license: { PSG: 'Paris Saint Germain' } } });
  api.kolSetMasterCatalog({ catalogs: { license: ['Paris Saint Germain'] } });
  assert.equal(api.kolLearnedCatalogAlias('license', 'psg'), 'Paris Saint Germain');
  assert.equal(api.kolLearnedCatalogAlias('license', 'Smiley'), '');
  assert.equal(api.kolLearnedCatalogAlias('season', 'psg'), '');
});

test('hücre kaydı, çizim, sekme açılışı ve içe aktarmalar ana kataloğa bağlıdır', () => {
  const editor = extractBetween(APP, 'function commitKolEditor', 'function commitKolPriceEditor');
  assert.match(editor, /const matched=kolCatalogMatch\(el\.dataset\.kind,val\)/);
  assert.match(editor, /const learned=kolLearnedCatalogAlias\(el\.dataset\.kind,val\)/);
  assert.match(editor, /el\.isConnected&&kolCatalogValueUnknown\(el\.dataset\.kind,val\)\)showToast\(kolCatalogUnknownText/);
  assert.doesNotMatch(editor, /must be selected from the ASAS|strict-catalog/i, 'elle giriş serbest kalmalı');

  assert.match(APP, /const unknown=Boolean\(cur\)&&kolCatalogValueUnknown\(c\.suggest,cur\)/);
  assert.match(APP, /kolRuleMissing kolCatalogUnknown/);
  assert.match(APP, /kolCatalogWarningMark/, 'ASAS dışı değer hücrede odak beklemeden görünür uyarı işareti taşır');
  assert.match(APP, /return entry\.masterLoaded\|\|entry\.values\.length>0;/, 'tam katalog yokken yüklü ASAS sipariş kataloğu fallback doğrulama sağlar');
  assert.match(APP, /setTimeout\(\(\)=>void ensureCollectionMasterCatalogLoaded\(\),0\)/);
  assert.equal((APP.match(/await ensureCollectionMasterCatalogLoaded\(\);\n\s*await kolPlmLoadApprovedTranslations\(\);/g) || []).length, 2, 'Excel ve Direct PLM çeviri adımları ana katalogla sıralanır');
  const importBlock = extractBetween(APP, 'async function importKolExcelFile', 'const plan=kolBuildImportPlan');
  assert.match(importBlock, /await ensureCollectionMasterCatalogLoaded\(\)/);
  assert.match(importBlock, /kolCatalogMatch\(col\.suggest,row\[col\.k\]\)\|\|kolLearnedCatalogAlias\(col\.suggest,row\[col\.k\]\)/);
  assert.match(APP, /\/api\/collection-master-catalog\/refresh/);
  assert.match(CSS, /\.kolCatalogDropFoot\{/);
  assert.match(CSS, /\.kolCatalogWarningMark\{/, 'uyarı işareti görünür hücre affordance stiline sahip olmalı');
  assert.match(CSS, /td\.kolCatalogUnknown \.kolSuggestCell\{padding-inline-end:24px!important;\}/);
});
