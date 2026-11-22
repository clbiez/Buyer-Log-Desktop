'use strict';

/* OAB (KÜP) — saf sorgu katmanı.
 *
 * Kaynak: OAB_Cube SSAS Tabular modeli (lcwtabular_s20, perspektif "Model";
 * kullanıcının LCW OAB Excel pivotunun bağlı olduğu küp). PASS'li OAB
 * widget'ıyla aynı Order-Assortment-Budget verisini doğrudan küpten okur;
 * PASS (pass.prod.lcwaikiki.com) çağrısı yapılmaz. INTAKE / FOB Sonrası
 * Maliyet ile aynı doğrudan model sorgu altyapısını (modelQuery /
 * ModelQuery.ps1, kullanıcının Windows kimliği) kullanır; yeni sorgu motoru
 * yoktur.
 *
 * Boyut seçimi bilinçlidir: yalnız ölçülerle ilişkisi kaynak Excel pivotunda
 * kanıtlı tablolar (Data, DummyUrun, Sezon) gruplanır ve filtrelenir. Ürün
 * boyutu için kanıtlı tablo DummyUrun'dur; Urun tablosunun ölçülerle ilişkisi
 * doğrulanmadı ve SUMMARIZECOLUMNS'ta çapraz çarpım üretip adetleri
 * çoğaltabilir. Bu yüzden Urun ve PlanLine / Phase / Dim_Supply /
 * HizliSiparisStatu boyutları ANA sorguya girmez; pivot düzenleyicisi de bu
 * tablolardan serbest alan eklemeyi reddeder. Model ölçüleri (Measures) satır
 * düzeyini değiştirmediği için serbestçe eklenebilir.
 *
 * Ürün özellikleri (Urun[FİT], Urun[SİLÜET], Urun[KUMAŞ-MALZEME TİPİ]) bu
 * kuralı bozmadan gelir: ayrı ve ÖLÇÜSÜZ bir sorgu, ana sonuçtaki ModelKod
 * listesiyle (TREATAS) Urun'un kendi ModelKod/RenkKod/özellik kombinasyonlarını
 * okur; sunucu bunları ModelKod + RenkKod anahtarıyla ana satırlara metin
 * olarak ekler. Ölçüler yalnız ana sorgudan gelir, satır sayısı değişmez.
 * MAG / buyer grup Urun sütunlarına uygulanmaz (kodlamanın DummyUrun ile aynı
 * olduğu doğrulanmadı). Bu alanlar pivotta yerel boyut/filtredir.
 *
 * Kod alanları (ModelKod, RenkKod, MerchAltGrupKod …) her zaman metindir;
 * "3E8" gibi değerler sayıya/bilimsel gösterime çevrilmez.
 */

const crypto = require('node:crypto');
const intakeReport = require('./intake-report');
const filterValueTypes = require('./filter-value-types');
const PivotCalculated = require('../../public/pivot-calculated-values');
const modelHorizon = require('./modelHorizon');

const OAB_CUBE_CONNECTION = Object.freeze({
  server: 'lcwtabular_s20',
  catalog: 'OAB_Cube',
  model: 'Model',
});
const OAB_CUBE_CATALOG_PATTERN = /^oab_?cube$/i;
const OAB_CUBE_MAX_ROWS = 20000;
const OAB_CUBE_VIEW_VERSION = 1;

/* İlişkisi kaynak pivotta kanıtlı tablolar. Yalnız bunlardan boyut gruplanır. */
const PROVEN_TABLES = Object.freeze(['Data', 'DummyUrun', 'Sezon']);

/* Boyutlar: key = satır verisindeki kararlı ad (tarayıcı bunu okur).
   optionalGrain: yalnız pivot satır/sütununa eklenince sorgu düzeyine girer;
   filtre olarak her zaman TREATAS ile uygulanır. */
const DIMENSIONS = Object.freeze([
  { key: 'season', source: '[Sezon].[SezonKod]', tr: 'Sezon', en: 'Season', filter: true, required: true, code: true },
  { key: 'mag', source: '[DummyUrun].[MerchAltGrupKod]', tr: 'MAG', en: 'MAG', filter: true, code: true },
  { key: 'buyerGroup', source: '[DummyUrun].[BuyerGrupTanim]', tr: 'Buyer grup', en: 'Buyer group', filter: true },
  { key: 'classGroup', source: '[DummyUrun].[KlasmanGrupTanim]', tr: 'Klasman grup', en: 'Class group', filter: true },
  { key: 'classification', source: '[DummyUrun].[UrunKlasmanTanim]', tr: 'Ürün klasmanı', en: 'Product class', filter: true },
  { key: 'modelCode', source: '[DummyUrun].[ModelKod]', tr: 'Model kodu', en: 'Model code', code: true, identity: true },
  { key: 'modelName', source: '[DummyUrun].[ModelTanim]', tr: 'Model adı', en: 'Model name', identity: true },
  { key: 'colourCode', source: '[DummyUrun].[RenkKod]', tr: 'Renk kodu', en: 'Colour code', code: true, identity: true },
  { key: 'colourName', source: '[DummyUrun].[RenkAd]', tr: 'Renk adı', en: 'Colour name' },
  { key: 'brandAgeGroup', source: '[DummyUrun].[MerchMarkaYasGrupKod]', tr: 'Marka yaş grubu', en: 'Brand age group', filter: true, code: true, optionalGrain: true },
  { key: 'brandDirectorate', source: '[DummyUrun].[MarkaMudurlukleri]', tr: 'Marka müdürlüğü', en: 'Brand directorate', filter: true, optionalGrain: true },
  { key: 'supplyBasket', source: '[Data].[Tedarik Sepeti]', tr: 'Tedarik sepeti', en: 'Supply basket', filter: true, optionalGrain: true },
  { key: 'carryOver', source: '[Data].[Devir Option Mu]', tr: 'Devir option', en: 'Carry-over option', filter: true, optionalGrain: true },
  { key: 'planStartMonth', source: '[Data].[Plan Başlangıç Ay]', tr: 'Plan başlangıç ayı', en: 'Plan start month', filter: true, optionalGrain: true, nameTyped: true, display: 'monthNumber' },
  { key: 'buyingPeriod', source: '[Data].[Alım Dönem]', tr: 'Alım dönemi', en: 'Buying period', filter: true, optionalGrain: true },
  { key: 'budgetType', source: '[Data].[ButceTipTanım]', tr: 'Bütçe tipi', en: 'Budget type', filter: true, optionalGrain: true },
].map(Object.freeze));

/* Ölçüler. quantity: adet (toplanır); unit/rate/count: toplanmaz, varsayılan
   özetleme ortalama/en büyüktür. required: yoksa rapor üretilmez (sessizce
   boş sütun göstermek yerine şema uyuşmazlığı söylenir). pass: PASS OAB
   satırındaki karşılık başlığı (parity karşılaştırması için). */
const MEASURES = Object.freeze([
  { key: 'wssi', source: '[Measures].[WSSI Sipariş Miktarı]', tr: 'WSSI sipariş', en: 'WSSI order', kind: 'quantity', agg: 'SUM', required: true, pass: 'WSSI Sipariş Miktarı' },
  { key: 'approved', source: '[Measures].[Onaylı Sipariş Miktarı]', tr: 'Onaylı sipariş', en: 'Approved order', kind: 'quantity', agg: 'SUM', required: true, pass: 'Onaylı Sipariş Miktarı' },
  { key: 'plan', source: '[Measures].[Plan Sipariş Miktarı]', tr: 'Plan sipariş', en: 'Planned order', kind: 'quantity', agg: 'SUM', required: true, pass: 'Plan Sipariş Miktarı' },
  { key: 'unapproved', source: '[Measures].[Onaysız Sipariş Miktarı]', tr: 'Onaysız sipariş', en: 'Unapproved order', kind: 'quantity', agg: 'SUM', pass: 'Onaysız Sipariş Miktarı' },
  { key: 'buyingPeriodQty', source: '[Measures].[Alım Dönem Sipariş Miktarı]', tr: 'Alım dönem sipariş', en: 'Buying period order', kind: 'quantity', agg: 'SUM', pass: 'Alım Dönem Sipariş Miktarı' },
  { key: 'reserveApproved', source: '[Measures].[Onaylı Yedek Bütçe Sipariş Miktarı]', tr: 'Onaylı yedek bütçe', en: 'Approved reserve budget', kind: 'quantity', agg: 'SUM', pass: 'Onaylı Yedek Bütçe Sipariş Miktarı' },
  { key: 'fastApproved', source: '[Measures].[Onaylı Hızlı Option Sipariş Miktarı]', tr: 'Onaylı hızlı option', en: 'Approved fast option', kind: 'quantity', agg: 'SUM', pass: 'Onaylı Hizli Siparis Adet' },
  { key: 'poQty', source: '[Measures].[PO Adet]', tr: 'PO adet', en: 'PO quantity', kind: 'quantity', agg: 'SUM', pass: 'PO Miktarı' },
  { key: 'warehouseIn', source: '[Measures].[Depo Giren Miktar]', tr: 'Depo giren', en: 'Warehouse received', kind: 'quantity', agg: 'SUM', pass: 'Depo Giren Miktar' },
  { key: 'eligibleBuy', source: '[Measures].[Uygun Alım Miktar]', tr: 'Uygun alım', en: 'Eligible buy', kind: 'quantity', agg: 'SUM' },
  { key: 'plannedStores', source: '[Measures].[Planlanan Mağaza Sayısı]', tr: 'Planlanan mağaza', en: 'Planned stores', kind: 'count', agg: 'MAX' },
  { key: 'landedPrice', source: '[Measures].[Landed Fiyat]', tr: 'Landed fiyat', en: 'Landed price', kind: 'unit', agg: 'AVG' },
  { key: 'markupYd', source: '[Measures].[Yurtdışı Markup]', tr: 'Yurtdışı markup', en: 'International markup', kind: 'rate', agg: 'AVG' },
  { key: 'markupYi', source: '[Measures].[Yurtiçi Markup]', tr: 'Yurtiçi markup', en: 'Domestic markup', kind: 'rate', agg: 'AVG' },
].map(Object.freeze));

/* PASS OAB raporunda olup küpte görünmeyen alanlar. Uydurulmaz; UI ve Excel
   bunları açıkça "bu kaynakta yok" diye listeler. */
const PASS_ONLY_FIELDS = Object.freeze([
  { pass: 'Özel Kod', tr: 'Özel Kod', en: 'Special code' }, // i18n-ignore: PASS kaynak başlığı
  { pass: 'Persona', tr: 'Persona', en: 'Persona' },
  { pass: 'Optionın Eşlendiği Diğer Linelar', tr: 'Optionın Eşlendiği Diğer Linelar', en: 'Other lines the option is mapped to' }, // i18n-ignore: PASS kaynak başlığı
  { pass: 'Özel Onaylı Temiz Devir', tr: 'Özel Onaylı Temiz Devir', en: 'Special-approved clean carry-over' }, // i18n-ignore: PASS kaynak başlığı
  { pass: 'Düşük Adetli FT WSSI', tr: 'Düşük Adetli FT WSSI', en: 'Low-quantity FT WSSI' }, // i18n-ignore: PASS kaynak başlığı
].map(Object.freeze));

/* Veri tarihi: küp ETL ile dolar, canlı değildir. */
const FRESHNESS = Object.freeze([
  { key: 'dataDate', source: '[GuncellemeTarihi].[GuncellemeTarih]' },
  { key: 'etlTime', source: '[DummyUrun].[etl_time]' },
]);

/* Ürün özellikleri (Urun tablosu). Ana sorgunun boyutu DEĞİLDİR; ayrı
   özellik sorgusuyla model + renk satırlarına eklenir (productAttributeQueries
   + mergeProductAttributes). Pivotta yerel metin boyutu ve yerel filtredir. */
const PRODUCT_ATTRIBUTES = Object.freeze([
  { key: 'fit', source: '[Urun].[FİT]', tr: 'FİT', en: 'Fit' }, // i18n-ignore: küp alan adı (TR etiketi)
  { key: 'silhouette', source: '[Urun].[SİLÜET]', tr: 'Silüet', en: 'Silhouette' },
  { key: 'fabricType', source: '[Urun].[KUMAŞ-MALZEME TİPİ]', tr: 'Kumaş-malzeme tipi', en: 'Fabric-material type' },
].map(Object.freeze));
const PRODUCT_ATTRIBUTE_JOIN = Object.freeze([
  Object.freeze({ key: 'modelCode', source: '[Urun].[ModelKod]' }),
  Object.freeze({ key: 'colourCode', source: '[Urun].[RenkKod]' }),
]);
const PRODUCT_ATTRIBUTE_KEYS = Object.freeze(PRODUCT_ATTRIBUTES.map(item => item.key));
/* Bir model + renk için birden çok değer: dile bağımsız işaret; istemci
   "Çoklu" / "Multiple" yazar, değerler satırın attrMulti alanındadır. */
const PRODUCT_ATTRIBUTE_MULTI = '__MULTI__';
/* Parça başına ModelKod literal sınırı. Gerekçe: (1) widget filtrelerinin
   değer sınırı 500'dür, sipariş kodu filtreleri binlerce literal taşır; 1.000
   SSAS TREATAS için alışılmış aralıktadır; (2) ~1.000 × ~12 karakter ≈ 15 KB
   sorgu metni, üretilen sorgu sınırının (4 MB) çok altında; (3) model başına
   birkaç renk × özellik kombinasyonuyla parça sonucu TOPN sınırının (20.000)
   rahatça altında kalır, sınıra ulaşılırsa kesilme bildirilir. Ana sorgu en
   fazla 20.000 satırdır: 20 parça bütün model kümesini kapsar. */
const PRODUCT_ATTRIBUTE_CHUNK = 1000;
const PRODUCT_ATTRIBUTE_MAX_CHUNKS = 20;
const isAttributeKey = key => PRODUCT_ATTRIBUTE_KEYS.includes(key);

const FILTER_KEYS = Object.freeze(DIMENSIONS.filter(item => item.filter).map(item => item.key));
const DEFAULT_FILTERS = Object.freeze(['season', 'mag', 'buyerGroup', 'brandAgeGroup', 'supplyBasket', 'carryOver']);
const DEFAULT_ROWS = Object.freeze(['classGroup', 'classification']);
const DEFAULT_VALUES = Object.freeze(['wssi', 'approved', 'approvedNotOrdered', 'plan', 'unapproved', 'poQty']);
const AGGREGATES = Object.freeze(['SUM', 'AVG', 'MIN', 'MAX']);
const EXTRA_PREFIX = 'x_';
const MAX_AXIS_FIELDS = 12;
const SOURCE_PATTERN = /^\[[^\[\]]{1,200}\](?:\.\[[^\[\]]{1,200}\]){1,2}$/;

function clean(value) { return String(value == null ? '' : value).trim(); }
function error(message, code, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
/* Türetilmiş ölçüler küpte yoktur; küpten gelen satırlar üzerinde PASS OAB'nin
   satır formülüyle (public/oab.js deriveBuyerMetrics) birebir hesaplanır ve
   pivotta toplanır. Küp satırı model × renk (option) düzeyindedir; PASS OAB
   satırı da option düzeyindedir. Boş WSSI/Onaylı 0 sayılır (PASS ile aynı).
     Onaylanmış - sipariş geçilmemiş = WSSI 0 ise Onaylı, değilse 0
     Klasman analizine konu adet     = WSSI + Onaylanmış - sipariş geçilmemiş */
const DERIVED_MEASURES = Object.freeze([
  {
    key: 'approvedNotOrdered', tr: 'Onaylanmış - sipariş geçilmemiş', en: 'Approved - not yet ordered', kind: 'quantity', agg: 'SUM', derived: true,
    pass: 'Toplam Onaylanmış - Sipariş Geçilmemiş Adet', // i18n-ignore: PASS kaynak başlığı
    hintTr: 'Option satırında WSSI sipariş 0 ise onaylı sipariş adedi, değilse 0; sonra toplanır (PASS OAB ile aynı formül).',
    hintEn: 'Per option row: the approved order quantity when the WSSI order is 0, otherwise 0; then summed (same formula as PASS OAB).',
  },
  {
    key: 'classAnalysisQty', tr: 'Klasman analizine konu adet', en: 'Class analysis quantity', kind: 'quantity', agg: 'SUM', derived: true,
    pass: 'Toplam Klasman Analize Konu Olan Toplam Adet', // i18n-ignore: PASS kaynak başlığı
    hintTr: 'Option satırında WSSI sipariş + onaylanmış ama sipariş geçilmemiş adet; sonra toplanır (PASS OAB ile aynı formül).',
    hintEn: 'Per option row: the WSSI order plus the approved but not yet ordered quantity; then summed (same formula as PASS OAB).',
  },
].map(Object.freeze));

function deriveRow(row) {
  const wssi = row.wssi == null ? 0 : row.wssi;
  const approved = row.approved == null ? 0 : row.approved;
  const approvedNotOrdered = wssi === 0 ? approved : 0;
  row.approvedNotOrdered = approvedNotOrdered;
  row.classAnalysisQty = wssi + approvedNotOrdered;
  return row;
}

const measureByKey = key => MEASURES.find(item => item.key === key) || DERIVED_MEASURES.find(item => item.key === key);

/* Bağlantı: Veri Yönetimi'ndeki 'oabcube' rolü (INTAKE / FOB gibi kendi
   veritabanı kaydı) önce gelir. Yedek sıra (rol kaydı yoksa, ör. liste
   sınırdaysa) değişmedi: bu kataloğa (OAB_Cube) tanımlanmış bir bağlantı;
   yoksa INTAKE rolünün sunucusu (aynı SSAS sunucusu) + OAB_Cube; o da yoksa
   kaynak Excel'deki bağlantı. */
function connectionList(items) {
  return (Array.isArray(items) ? items : []).filter(item => item && clean(item.server) && clean(item.catalog));
}
function roleItem(list) {
  const byRole = list.filter(item => item.role === 'oabcube');
  return byRole.find(item => item.refreshEnabled !== false) || byRole[0] || null;
}
function resolveConnection(items) {
  const list = connectionList(items);
  const found = roleItem(list)
    || list.find(item => OAB_CUBE_CATALOG_PATTERN.test(clean(item.catalog)) && item.refreshEnabled !== false)
    || list.find(item => OAB_CUBE_CATALOG_PATTERN.test(clean(item.catalog)));
  if (found) return { id: clean(found.id), name: clean(found.name) || OAB_CUBE_CONNECTION.catalog, server: clean(found.server), catalog: clean(found.catalog), model: OAB_CUBE_CONNECTION.model, source: 'settings' };
  const intake = list.find(item => item.role === 'intake');
  if (intake) return { id: '', name: OAB_CUBE_CONNECTION.catalog, server: clean(intake.server), catalog: OAB_CUBE_CONNECTION.catalog, model: OAB_CUBE_CONNECTION.model, source: 'intake-server' };
  return { id: '', name: OAB_CUBE_CONNECTION.catalog, server: OAB_CUBE_CONNECTION.server, catalog: OAB_CUBE_CONNECTION.catalog, model: OAB_CUBE_CONNECTION.model, source: 'default' };
}

/* Ufuk: Veri Yönetimi'nde 'oabcube' rol kaydının kapsamına yazılan ortak
   filtre (FOB Sonrası Maliyet / INTAKE ile aynı kural; kişisel katman yoktur).
   Özel Database kaydının kapsamı ufuk sayılmaz. */
function resolveHorizon(items) {
  const item = roleItem(connectionList(items));
  if (!item || !Array.isArray(item.scopes)) return null;
  const scope = item.scopes.find(entry => entry && entry.enabled !== false && Array.isArray(entry.targets) && entry.targets.includes('oabcube'));
  const horizon = scope && scope.horizon;
  return isBoundedHorizon(horizon) ? horizon : null;
}

/* Kayıtlarda ufuk nesnesi her zaman dolu yapıdadır (boş sezon/grup listeleri);
   yalnız gerçekten sınırlayan bir koşul varsa ufuk sayılır. */
function isBoundedHorizon(horizon) {
  if (!horizon || typeof horizon !== 'object') return false;
  const groups = Array.isArray(horizon.groups) ? horizon.groups : [];
  return (Array.isArray(horizon.seasons) && horizon.seasons.length > 0)
    || Boolean(clean(horizon.dateStart) || clean(horizon.dateEnd))
    || groups.some(group => Array.isArray(group && group.conditions) && group.conditions.some(condition => condition && clean(condition.field)))
    || Boolean(clean(horizon.extraExpression));
}

/* Ufuk SUMMARIZECOLUMNS filtre argümanlarına çevrilir (FOB Sonrası Maliyet ile
   aynı modelHorizon yolu). Ufuk sezon zorunluluğunun yerine geçtiği için
   yalnız ölçülerle ilişkisi kanıtlı tablolara (Data, DummyUrun, Sezon) başvuran
   ufuk kabul edilir: ilişkisiz bir tablodaki filtre ölçüleri daraltmaz ve
   sorgu sessizce bütün küpü tarardı. Her iki hata da kullanıcının Veri
   Yönetimi'nde düzeltebileceği ufuk hatasıdır, kaynak kesintisi değil. */
function horizonArgs(horizon, liveFields) {
  if (!isBoundedHorizon(horizon)) return [];
  let args;
  try {
    const filter = modelHorizon.buildHorizonFilter(horizon, null, { columnType: intakeReport.intakeColumnTypeIndex(liveFields) });
    args = modelHorizon.summarizeFilterArgs(filter, '');
  } catch (cause) {
    throw error(`OAB küp ufku uygulanamadı: ${cause && cause.message || cause}`, 'OAB_CUBE_HORIZON_INVALID', 400);
  }
  const tables = new Set();
  // Metin sabitleri atılır; tablo başvurusu tırnaklı ('Tablo'[Sütun]) veya tırnaksız (Tablo[Sütun]) olabilir.
  args.forEach(arg => {
    const code = String(arg).replace(/"(?:[^"]|"")*"/g, '""');
    for (const match of code.matchAll(/'((?:[^']|'')+)'\s*\[|([A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F]*)\s*\[/g)) tables.add((match[1] || match[2]).replace(/''/g, "'"));
  });
  const unproven = [...tables].filter(table => !PROVEN_TABLES.some(name => name.toLocaleLowerCase('tr-TR') === table.toLocaleLowerCase('tr-TR')));
  if (args.length && (!tables.size || unproven.length)) {
    throw error(`OAB küp ufku yalnız ${PROVEN_TABLES.join(', ')} tablolarındaki alanlarla tanımlanabilir${unproven.length ? ` (${unproven.join(', ')})` : ''}.`, 'OAB_CUBE_HORIZON_INVALID', 400);
  }
  return args;
}

/* Şema bir sütunun tipini vermezse filtre tipi addan tahmin edilir
   (filter-value-types.typeFromName). Bu tahmin "MerchMarkaYasGrupKod"
   ("kAYas") gibi kod/ad alanlarını tarih sanıp her filtre değerini
   reddediyordu. Hazır boyutlar metindir; yalnız adı gerçekten tarih/ay olan
   alan (nameTyped) tahmine bırakılır. Şemanın verdiği tip her zaman önce gelir. */
function withTextFallback(definition, field) {
  if (!field || field.dataType || definition.nameTyped) return field;
  return { ...field, dataType: 'WChar' };
}

function liveLookup(liveFields) {
  const live = Array.isArray(liveFields) ? liveFields : [];
  const bySource = new Map(live.map(field => [intakeReport.sourceKey(field.sourceUniqueName), field]));
  return (source, fieldType) => {
    if (!live.length) return intakeReport.createField({ sourceUniqueName: source, fieldType });
    const found = bySource.get(intakeReport.sourceKey(source));
    return found && found.fieldType === fieldType ? found : null;
  };
}

/* Canlı şemadaki alanları tanımlara eşler. Şema yoksa (ör. test) tanımın kendi
   kimliği kullanılır. Zorunlu ölçü/boyut yoksa açık hata; isteğe bağlı alan
   `missing` listesinde raporlanarak düşer. */
function resolveFields(liveFields) {
  const lookup = liveLookup(liveFields);
  const dimensions = [], measures = [], missing = [];
  for (const definition of DIMENSIONS) {
    const field = withTextFallback(definition, lookup(definition.source, 'dimension'));
    if (field) dimensions.push({ ...definition, field }); else missing.push(definition.key);
  }
  for (const definition of MEASURES) {
    const field = lookup(definition.source, 'measure');
    if (field) measures.push({ ...definition, field }); else missing.push(definition.key);
  }
  const requiredMissing = [...DIMENSIONS, ...MEASURES].filter(item => item.required || ['modelCode', 'colourCode'].includes(item.key))
    .map(item => item.key).filter(key => missing.includes(key));
  if (requiredMissing.length) {
    throw error(`OAB küpü beklenen alanları içermiyor: ${requiredMissing.join(', ')}.`, 'OAB_CUBE_SCHEMA_MISMATCH', 422);
  }
  return { dimensions, measures, missing };
}

function extraKey(source) {
  return EXTRA_PREFIX + crypto.createHash('sha256').update(intakeReport.sourceKey(source), 'utf8').digest('hex').slice(0, 16);
}

function isProvenTable(source) {
  const table = intakeReport.sourceParts(source).table;
  return PROVEN_TABLES.some(name => name.toLocaleLowerCase('tr-TR') === clean(table).toLocaleLowerCase('tr-TR'));
}

/* Alan referansı: temel alan {key[, agg]} veya modelden eklenen alan
   {key:'x_…', source, label[, agg]}. Kimlik her zaman kaynak adından türetilir;
   istemcinin gönderdiği anahtar güvenilmez. Eklenen boyut yalnız ilişkisi
   kanıtlı tablodan olabilir. */
function normalizeRef(raw, kind) {
  const entry = typeof raw === 'string' ? { key: raw } : (raw && typeof raw === 'object' ? raw : null);
  if (!entry) return null;
  const key = clean(entry.key);
  const agg = clean(entry.agg).toUpperCase();
  if (kind === 'dimension' && (DIMENSIONS.some(item => item.key === key) || isAttributeKey(key))) return { key };
  if (kind === 'value' && measureByKey(key)) return { key, agg: AGGREGATES.includes(agg) ? agg : measureByKey(key).agg };
  const source = clean(entry.source);
  if (!SOURCE_PATTERN.test(source)) return null;
  const isMeasure = /^\[measures\]/i.test(source);
  if ((kind === 'value') !== isMeasure) return null;
  // Urun'un özellik alanı hazır anahtarına iner; diğer Urun alanları reddedilir.
  const attribute = kind === 'dimension' && PRODUCT_ATTRIBUTES.find(item => intakeReport.sourceKey(item.source) === intakeReport.sourceKey(source));
  if (attribute) return { key: attribute.key };
  if (kind === 'dimension' && !isProvenTable(source)) return null;
  const known = [...DIMENSIONS, ...MEASURES].find(item => intakeReport.sourceKey(item.source) === intakeReport.sourceKey(source));
  if (known) return kind === 'value' ? { key: known.key, agg: AGGREGATES.includes(agg) ? agg : known.agg } : { key: known.key };
  const ref = { key: extraKey(source), source, label: clean(entry.label).slice(0, 120) || intakeReport.sourceParts(source).name };
  if (kind === 'value') ref.agg = AGGREGATES.includes(agg) ? agg : 'SUM';
  return ref;
}

function refList(raw, kind, fallback) {
  if (!Array.isArray(raw)) return fallback.map(key => normalizeRef({ key }, kind)).filter(Boolean);
  const out = [], seen = new Set();
  for (const item of raw) {
    const ref = normalizeRef(item, kind);
    if (!ref || seen.has(ref.key)) continue;
    seen.add(ref.key); out.push(ref);
    if (out.length >= MAX_AXIS_FIELDS * 2) break;
  }
  return out;
}

function normalizeFilterValues(raw, allowedKeys = FILTER_KEYS) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of allowedKeys) {
    const values = Array.isArray(source[key]) ? source[key] : [];
    const list = [...new Set(values.map(clean).filter(Boolean))].slice(0, 500);
    if (list.length) out[key] = list;
  }
  return out;
}

/* Görünüm: INTAKE / FOB Sonrası Maliyet pivotu gibi satır, sütun, değer ve
   filtre eksenleri. Sezon filtresi her zaman listede kalır (sorgu zorunluluğu). */
function normalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  let rows = refList(source.rows, 'dimension', DEFAULT_ROWS).slice(0, MAX_AXIS_FIELDS);
  const columns = refList(source.columns, 'dimension', []).filter(ref => !rows.some(row => row.key === ref.key)).slice(0, MAX_AXIS_FIELDS);
  if (!rows.length && !columns.length) rows = DEFAULT_ROWS.map(key => ({ key }));
  let values = refList(source.values, 'value', DEFAULT_VALUES).slice(0, MAX_AXIS_FIELDS * 2);
  if (!values.length) values = refList(null, 'value', DEFAULT_VALUES);
  let filters = refList(source.filters, 'dimension', DEFAULT_FILTERS).slice(0, MAX_AXIS_FIELDS * 2);
  if (!filters.some(ref => ref.key === 'season')) filters = [{ key: 'season' }, ...filters];
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const sort = display.sort && typeof display.sort === 'object' ? display.sort : {};
  const widths = {};
  const rawWidths = display.widths && typeof display.widths === 'object' ? display.widths : {};
  for (const [key, px] of Object.entries(rawWidths).slice(0, 200)) {
    const width = Number(px);
    if (/^[\w-]{1,40}$/.test(key) && Number.isFinite(width)) widths[key] = Math.max(60, Math.min(1000, Math.round(width)));
  }
  return {
    version: OAB_CUBE_VIEW_VERSION,
    rows, columns, values, filters,
    filterValues: normalizeFilterValues(source.filterValues, filters.map(ref => ref.key)),
    display: {
      grouped: display.grouped !== false,
      showSubtotals: display.showSubtotals !== false,
      collapsedGroups: Array.isArray(display.collapsedGroups) ? [...new Set(display.collapsedGroups.map(clean).filter(Boolean))].slice(0, 2000) : [],
      sort: { key: clean(sort.key).slice(0, 40), dir: Number(sort.dir) === 1 ? 1 : -1 },
      widths,
    },
    calculated: normalizeCalculated(source.calculated, values),
    // Alt detay çekmecesinde gösterilecek ürün özellikleri (pivotta olmasa da sorgulanır).
    detailAttributes: PRODUCT_ATTRIBUTE_KEYS.filter(key => Array.isArray(source.detailAttributes) && source.detailAttributes.includes(key)),
  };
}

/* Görünümde kullanılan ürün özellikleri: pivot satır/sütun/filtre ve alt detay.
   Boşsa özellik sorgusu atılmaz (sıcak yol değişmez). */
function usedProductAttributes(view) {
  const current = view && typeof view === 'object' ? view : {};
  const used = new Set();
  for (const axis of ['rows', 'columns', 'filters']) for (const ref of current[axis] || []) if (ref && isAttributeKey(ref.key)) used.add(ref.key);
  for (const key of current.detailAttributes || []) if (isAttributeKey(key)) used.add(key);
  return PRODUCT_ATTRIBUTE_KEYS.filter(key => used.has(key));
}

/* Kişisel hesaplanan değerler (public/pivot-calculated-values.js). Sorguya
   girmez; yalnız satır bazlı ("row") tanımın kullandığı hazır ölçü sorgulanır
   (buildQuery). Başvurular yalnız bilinen ölçü anahtarlarını tutar. */
function normalizeCalculated(raw, values) {
  const catalogKeys = [...MEASURES, ...DERIVED_MEASURES].map(item => item.key);
  const viewKeys = (values || []).map(ref => ref.key);
  return PivotCalculated.normalizeList(raw, { allowRow: true, aggregateKeys: [...catalogKeys, ...viewKeys], rowKeys: [...catalogKeys, ...viewKeys] });
}

function viewExtras(view) {
  const dims = new Map(), grouped = new Set(), measures = new Map();
  for (const axis of ['rows', 'columns', 'filters']) {
    for (const ref of view[axis] || []) {
      if (!ref.source) continue;
      dims.set(ref.key, ref);
      if (axis !== 'filters') grouped.add(ref.key);
    }
  }
  for (const ref of view.values || []) if (ref.source) measures.set(ref.key, ref);
  return { dims, grouped, measures };
}

function quoteAlias(value) { return `"${clean(value).replace(/"/g, '""')}"`; }

function outputAliases(field) {
  return [
    field.sourceUniqueName,
    `'${field.table.replace(/'/g, "''")}'[${field.name}]`,
    `${field.table}[${field.name}]`,
    `[${field.table}].[${field.name}]`,
    `[${field.table}].[${field.name}].[${field.name}]`,
    field.name,
  ];
}

/* Tek DAX sorgusu: SUMMARIZECOLUMNS model × renk düzeyinde (+ pivot
   eksenindeki isteğe bağlı boyutlar); çoklu Sezon × MAG × Buyer Grup seçimi
   TREATAS filtreleri olarak aynı argüman listesine girer (PASS'teki
   kombinasyon batch'ine gerek yok). Sezon filtresi veya Veri Yönetimi ufku
   zorunludur: sorgu bütün küpü taramaz. Ufuk ve widget filtreleri VE ile
   birleşir. */
function buildQuery({ liveFields = [], view = null, filterValues = {}, horizon = null, maxRows = OAB_CUBE_MAX_ROWS } = {}) {
  const current = normalizeView(view || { filterValues });
  const resolved = resolveFields(liveFields);
  const lookup = liveLookup(liveFields);
  const extras = viewExtras(current);
  const viewMeasureKeys = new Set(current.values.map(ref => ref.key));
  const missing = resolved.missing.filter(key => !MEASURES.some(item => item.key === key) || viewMeasureKeys.has(key));
  const extraDims = [], extraMeasures = [], extraFilterFields = new Map();
  for (const ref of extras.dims.values()) {
    const field = lookup(ref.source, 'dimension');
    if (!field) { missing.push(ref.key); continue; }
    extraFilterFields.set(ref.key, field);
    if (extras.grouped.has(ref.key)) extraDims.push({ key: ref.key, field });
  }
  for (const ref of extras.measures.values()) {
    const field = lookup(ref.source, 'measure');
    if (field) extraMeasures.push({ key: ref.key, field }); else missing.push(ref.key);
  }
  const filters = current.filterValues;
  const horizonFilterArgs = horizonArgs(horizon, liveFields);
  if ((!filters.season || !filters.season.length) && !horizonFilterArgs.length) {
    throw error('OAB küp sorgusu için en az bir sezon seçilmeli veya Veri Yönetimi\'nde ufuk tanımlanmalıdır.', 'OAB_CUBE_SEASON_REQUIRED', 400);
  }
  const dimensionByKey = new Map(resolved.dimensions.map(item => [item.key, item.field]));
  extraFilterFields.forEach((field, key) => dimensionByKey.set(key, field));
  const filterExpressions = [];
  // Ürün özelliği filtresi yereldir: ana sorguya ve önbellek anahtarına girmez.
  const mainFilters = Object.fromEntries(Object.entries(filters).filter(([key]) => !isAttributeKey(key)));
  for (const [key, values] of Object.entries(mainFilters)) {
    const field = dimensionByKey.get(key);
    if (!field) throw error(`"${key}" filtresi canlı modelde bulunamadı.`, 'OAB_CUBE_FILTER_UNAVAILABLE', 422);
    let literals;
    try { literals = intakeReport.intakeFilterValues({ ...field, defaultLabel: field.name }, values); }
    catch (cause) { throw error(cause && cause.message || 'Filtre değeri geçersiz.', 'OAB_CUBE_FILTER_VALUE_TYPE', 400); }
    filterExpressions.push(`TREATAS({ ${literals.join(', ')} }, ${intakeReport.daxRef(field)})`);
  }
  const pivotKeys = new Set([...current.rows, ...current.columns].map(ref => ref.key));
  const groupFields = [...resolved.dimensions.filter(item => !item.optionalGrain || pivotKeys.has(item.key)).map(item => ({ key: item.key, field: item.field })), ...extraDims];
  /* Yalnız görünümdeki ve zorunlu ölçüler sorgulanır. SUMMARIZECOLUMNS en az
     bir ölçüsü dolu satırı tutar; ilişkisi doğrulanmamış bir ölçü (ör. başka
     olgu tablosunda) gruplamaya kendiliğinden girmez ve satır sayısını
     şişirmez. */
  const wantedMeasures = new Set(current.values.filter(ref => !ref.source).map(ref => ref.key));
  /* Satır bazlı hesaplanan değer her kaynak satırda ölçü okur: görünümde
     olmasa da o hazır ölçü sorgulanır (önbellek anahtarı built.measures ile
     birlikte değişir). Toplam modu tanımı sorguyu değiştirmez. */
  PivotCalculated.requiredRowKeys(current.calculated).forEach(key => { if (MEASURES.some(item => item.key === key)) wantedMeasures.add(key); });
  const queried = resolved.measures.filter(item => item.required || wantedMeasures.has(item.key));
  const measureFields = [...queried.map(item => ({ key: item.key, field: item.field })), ...extraMeasures];
  const groupExpressions = groupFields.map(item => intakeReport.daxRef(item.field));
  const measureExpressions = measureFields.map(item => `${quoteAlias(item.key)}, ${intakeReport.daxRef(item.field)}`);
  const rowLimit = Math.min(OAB_CUBE_MAX_ROWS, Math.max(1, Math.floor(Number(maxRows) || OAB_CUBE_MAX_ROWS)));
  const query = `EVALUATE\nTOPN(${rowLimit},\n  SUMMARIZECOLUMNS(\n    ${[...groupExpressions, ...horizonFilterArgs, ...filterExpressions, ...measureExpressions].join(',\n    ')}\n  )\n)`;
  const headerMap = {};
  groupFields.forEach(item => outputAliases(item.field).forEach(alias => { headerMap[alias] = item.key; }));
  measureFields.forEach(item => { headerMap[item.key] = item.key; headerMap[`[${item.key}]`] = item.key; });
  // WSSI ve Onaylı zorunlu ölçülerdir (her sorguda var); türetilmiş ölçüler
  // bunlardan satır düzeyinde hesaplanır, küp sorgusuna girmez.
  const queriedKeys = measureFields.map(item => item.key);
  const derivedKeys = ['wssi', 'approved'].every(key => queriedKeys.includes(key)) ? DERIVED_MEASURES.map(item => item.key) : [];
  return {
    query, headerMap, maxRows: rowLimit, filterValues: mainFilters, horizonApplied: horizonFilterArgs.length > 0,
    dimensions: groupFields.map(item => item.key),
    measures: queriedKeys,
    derived: derivedKeys,
    missing,
    attributes: usedProductAttributes(current),
  };
}

/* Veri tarihi sorgusu: GuncellemeTarihi[GuncellemeTarih] ve DummyUrun[etl_time]
   en büyük değerleri. Canlı şemada olmayan sütun sorguya girmez; ikisi de
   yoksa sorgu üretilmez (null). */
function freshnessQuery(liveFields) {
  const lookup = liveLookup(liveFields);
  const parts = FRESHNESS.map(item => ({ ...item, field: lookup(item.source, 'dimension') })).filter(item => item.field);
  if (!parts.length) return null;
  const headerMap = {};
  parts.forEach(item => { headerMap[item.key] = item.key; headerMap[`[${item.key}]`] = item.key; });
  return {
    query: `EVALUATE ROW(${parts.map(item => `${quoteAlias(item.key)}, MAX(${intakeReport.daxRef(item.field)})`).join(', ')})`,
    headerMap,
    keys: parts.map(item => item.key),
  };
}
function normalizeFreshness(rows) {
  const row = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
  const pick = key => clean(row[key] ?? row[`[${key}]`]).slice(0, 40);
  const dataDate = pick('dataDate'), etlTime = pick('etlTime');
  return { dataDate: dataDate || etlTime || '', dataDateSource: dataDate ? 'GuncellemeTarih' : (etlTime ? 'etl_time' : ''), etlTime };
}

/* Pivot düzenleyicinin alan havuzu: kanıtlı tabloların boyutları ve bütün ölçüler. */
function metadata(liveFields) {
  const base = new Map([...DIMENSIONS, ...MEASURES].map(item => [intakeReport.sourceKey(item.source), item.key]));
  const shape = field => ({ source: field.sourceUniqueName, table: field.table, name: field.name, label: field.defaultLabel || field.name, baseKey: base.get(intakeReport.sourceKey(field.sourceUniqueName)) || '' });
  const live = Array.isArray(liveFields) ? liveFields : [];
  return {
    dimensions: live.filter(field => field.fieldType === 'dimension' && isProvenTable(field.sourceUniqueName)).map(shape).slice(0, 1000),
    measures: live.filter(field => field.fieldType === 'measure').map(shape).slice(0, 1000),
    provenTables: [...PROVEN_TABLES],
  };
}

function resolveFilterField(liveFields, { key = '', source = '' } = {}) {
  const wanted = clean(key);
  const base = DIMENSIONS.find(item => item.key === wanted);
  const lookup = liveLookup(liveFields);
  if (base) return withTextFallback(base, lookup(base.source, 'dimension'));
  const ref = normalizeRef({ key: wanted, source }, 'dimension');
  return ref && ref.key === wanted && ref.source ? lookup(ref.source, 'dimension') : null;
}

/* Model CSV'si sayıları metin olarak taşıyabilir (ondalık virgül dahil). */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = clean(value).replace(/\s/g, '');
  if (!text) return null;
  const normalized = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/* Boyutlar (kod alanları dahil) HER ZAMAN metin kalır; yalnız ölçüler sayıya
   çevrilir. */
function normalizeRows(rows, built) {
  const dimensions = built && Array.isArray(built.dimensions) ? built.dimensions : DIMENSIONS.map(item => item.key);
  const measures = built && Array.isArray(built.measures) ? built.measures : MEASURES.map(item => item.key);
  const derive = Boolean(built && Array.isArray(built.derived) && built.derived.length);
  return (Array.isArray(rows) ? rows : []).map(row => {
    const out = {};
    for (const key of dimensions) out[key] = clean(row && row[key]);
    for (const key of measures) out[key] = toNumber(row && row[key]);
    return derive ? deriveRow(out) : out;
  });
}

/* Ürün özellikleri sorgusu (ana sorgudan ayrı, ölçüsüz). Urun'un ModelKod,
   RenkKod ve istenen özellik sütunları ana sonuçtaki ModelKod listesiyle
   (TREATAS) gruplanır; aynı tablonun sütunları olduğu için yalnız Urun'da var
   olan kombinasyonlar döner. Liste PRODUCT_ATTRIBUTE_CHUNK literal parçalara
   bölünür. Birleştirme anahtarı (ModelKod/RenkKod) yoksa ya da istenen
   özelliklerin hiçbiri canlı şemada yoksa açık şema hatası verilir. */
function productAttributeQueries({ liveFields = [], rows = [], attributes = [], chunkSize = PRODUCT_ATTRIBUTE_CHUNK, maxRows = OAB_CUBE_MAX_ROWS } = {}) {
  const wanted = PRODUCT_ATTRIBUTE_KEYS.filter(key => Array.isArray(attributes) && attributes.includes(key));
  const modelCodes = [...new Set((Array.isArray(rows) ? rows : []).map(row => clean(row && row.modelCode)).filter(Boolean))].sort();
  const modelSetHash = crypto.createHash('sha256').update(modelCodes.join('\n'), 'utf8').digest('hex');
  const empty = { queries: [], modelCodes, fetched: [], missing: [], modelSetHash, truncatedModels: false };
  if (!wanted.length || !modelCodes.length) return { ...empty, fetched: wanted.length ? wanted : [] };
  const lookup = liveLookup(liveFields);
  const asText = field => (field && !field.dataType ? { ...field, dataType: 'WChar' } : field);
  const join = PRODUCT_ATTRIBUTE_JOIN.map(item => ({ ...item, field: asText(lookup(item.source, 'dimension')) }));
  const present = PRODUCT_ATTRIBUTES.filter(item => wanted.includes(item.key)).map(item => ({ ...item, field: asText(lookup(item.source, 'dimension')) }));
  const fetched = present.filter(item => item.field);
  const missing = present.filter(item => !item.field).map(item => item.key);
  if (join.some(item => !item.field) || !fetched.length) {
    const absent = [...join.filter(item => !item.field).map(item => item.source), ...present.filter(item => !item.field).map(item => item.source)];
    throw error(`OAB küpünde ürün özellik alanları bulunamadı: ${absent.join(', ')}.`, 'OAB_CUBE_ATTRIBUTES_SCHEMA', 422);
  }
  const size = Math.max(1, Math.min(PRODUCT_ATTRIBUTE_CHUNK, Math.floor(Number(chunkSize) || PRODUCT_ATTRIBUTE_CHUNK)));
  const limit = Math.min(OAB_CUBE_MAX_ROWS, Math.max(1, Math.floor(Number(maxRows) || OAB_CUBE_MAX_ROWS)));
  const columns = [...join, ...fetched];
  const headerMap = {};
  columns.forEach(item => outputAliases(item.field).forEach(alias => { headerMap[alias] = item.key; }));
  const groupExpressions = columns.map(item => intakeReport.daxRef(item.field));
  const modelRef = intakeReport.daxRef(join[0].field);
  const usable = modelCodes.slice(0, size * PRODUCT_ATTRIBUTE_MAX_CHUNKS);
  const queries = [];
  for (let start = 0; start < usable.length; start += size) {
    const codes = usable.slice(start, start + size);
    let literals;
    try { literals = intakeReport.intakeFilterValues({ ...join[0].field, defaultLabel: 'ModelKod' }, codes); }
    catch (cause) { throw error(cause && cause.message || 'ModelKod değeri geçersiz.', 'OAB_CUBE_ATTRIBUTES_SCHEMA', 422); }
    queries.push({
      query: `EVALUATE\nTOPN(${limit},\n  SUMMARIZECOLUMNS(\n    ${[...groupExpressions, `TREATAS({ ${literals.join(', ')} }, ${modelRef})`].join(',\n    ')}\n  )\n)`,
      headerMap, maxRows: limit, modelCodes: codes,
    });
  }
  return { queries, modelCodes, fetched: fetched.map(item => item.key), missing, modelSetHash, truncatedModels: usable.length < modelCodes.length };
}

/* Özellik sorgusu satırları: bütün alanlar metin (kod alanları sayıya çevrilmez). */
function normalizeProductAttributeRows(rows, keys) {
  const wanted = PRODUCT_ATTRIBUTE_KEYS.filter(key => Array.isArray(keys) && keys.includes(key));
  return (Array.isArray(rows) ? rows : []).map(row => {
    const out = { modelCode: clean(row && row.modelCode), colourCode: clean(row && row.colourCode) };
    for (const key of wanted) out[key] = clean(row && row[key]);
    return out;
  });
}

/* Ana satırlara ModelKod + RenkKod anahtarıyla özellik ekler. Her ana satır
   tek çıktı satırıdır (satır sayısı ve ölçüler değişmez). Bir anahtar için
   boş olmayan tek değer yazılır; birden çok değer PRODUCT_ATTRIBUTE_MULTI ve
   attrMulti listesiyle işaretlenir (sessizce biri seçilmez); eşleşmeyen boş. */
function mergeProductAttributes(rows, attrRows, keys) {
  const wanted = PRODUCT_ATTRIBUTE_KEYS.filter(key => Array.isArray(keys) && keys.includes(key));
  const index = new Map();
  for (const row of Array.isArray(attrRows) ? attrRows : []) {
    const id = `${clean(row && row.modelCode)}\u0001${clean(row && row.colourCode)}`;
    if (!index.has(id)) index.set(id, Object.fromEntries(wanted.map(key => [key, new Set()])));
    const sets = index.get(id);
    for (const key of wanted) { const value = clean(row[key]); if (value) sets[key].add(value); }
  }
  let matchedRows = 0, multiRows = 0;
  const out = (Array.isArray(rows) ? rows : []).map(row => {
    const next = { ...row };
    const sets = index.get(`${clean(row && row.modelCode)}\u0001${clean(row && row.colourCode)}`);
    let multi = null;
    for (const key of wanted) {
      const values = sets ? [...sets[key]].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true })) : [];
      if (values.length > 1) { next[key] = PRODUCT_ATTRIBUTE_MULTI; (multi = multi || {})[key] = values; }
      else next[key] = values[0] || '';
    }
    if (multi) { next.attrMulti = multi; multiRows += 1; } else delete next.attrMulti;
    if (sets) matchedRows += 1;
    return next;
  });
  return { rows: out, matchedRows, multiRows };
}

function distinctQuery(item, { search = '', limit = 500 } = {}) {
  const field = item && item.field ? item.field : item;
  const column = intakeReport.daxRef(field);
  const valueType = intakeReport.intakeFieldValueType(field);
  const text = clean(search).slice(0, 120).replace(/"/g, '""');
  const searchInDax = Boolean(text) && filterValueTypes.supportsTextOperators(valueType);
  const count = Math.min(5000, Math.max(1, Math.floor(Number(limit) || 500)));
  const table = searchInDax ? `FILTER(DISTINCT(${column}), CONTAINSSTRING(${column}, "${text}"))` : `DISTINCT(${column})`;
  return { query: `EVALUATE TOPN(${count}, ${table}, ${column}, ASC)`, limit: count, searchInDax, valueType };
}

function catalog() {
  return {
    dimensions: [
      // display: 'monthNumber' → küp 1–12 döndürür; istemci YALNIZ görüntüde ay adı yazar (ham değer sorgu/filtrede kalır).
      ...DIMENSIONS.map(({ key, tr, en, filter, required, code, optionalGrain, display }) => ({ key, tr, en, filter: Boolean(filter), required: Boolean(required), code: Boolean(code), optionalGrain: Boolean(optionalGrain), ...(display ? { display } : {}) })),
      // Ürün özellikleri: ayrı sorguyla gelen yerel metin boyutları.
      ...PRODUCT_ATTRIBUTES.map(({ key, tr, en }) => ({ key, tr, en, filter: true, required: false, code: false, optionalGrain: false, attribute: true })),
    ],
    productAttributeMulti: PRODUCT_ATTRIBUTE_MULTI,
    measures: [
      ...MEASURES.map(({ key, tr, en, kind, agg, required }) => ({ key, tr, en, kind, agg, required: Boolean(required) })),
      ...DERIVED_MEASURES.map(({ key, tr, en, kind, agg, hintTr, hintEn }) => ({ key, tr, en, kind, agg, required: false, derived: true, hintTr, hintEn })),
    ],
    passOnlyFields: PASS_ONLY_FIELDS.map(item => ({ ...item })),
    defaults: normalizeView(null),
    aggregates: [...AGGREGATES],
    provenTables: [...PROVEN_TABLES],
  };
}

module.exports = {
  OAB_CUBE_CONNECTION, OAB_CUBE_MAX_ROWS, DIMENSIONS, MEASURES, DERIVED_MEASURES, PASS_ONLY_FIELDS, PROVEN_TABLES, FILTER_KEYS, DEFAULT_VALUES, DEFAULT_ROWS,
  PRODUCT_ATTRIBUTES, PRODUCT_ATTRIBUTE_MULTI, PRODUCT_ATTRIBUTE_CHUNK, PRODUCT_ATTRIBUTE_MAX_CHUNKS,
  usedProductAttributes, productAttributeQueries, normalizeProductAttributeRows, mergeProductAttributes,
  resolveConnection, resolveHorizon, isBoundedHorizon, resolveFields, normalizeRef, normalizeFilterValues, normalizeView, buildQuery, normalizeRows, toNumber,
  freshnessQuery, normalizeFreshness, distinctQuery, resolveFilterField, metadata, extraKey, isProvenTable, catalog,
};
