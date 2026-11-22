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
 * çoğaltabilir. Bu yüzden Urun (FİT, SİLÜET, KUMAŞ) ve PlanLine / Phase /
 * Dim_Supply / HizliSiparisStatu boyutları bu sürümde sorguya girmez;
 * pivot düzenleyicisi de bu tablolardan alan eklemeyi reddeder. Model
 * ölçüleri (Measures) satır düzeyini değiştirmediği için serbestçe eklenebilir.
 *
 * Kod alanları (ModelKod, RenkKod, MerchAltGrupKod …) her zaman metindir;
 * "3E8" gibi değerler sayıya/bilimsel gösterime çevrilmez.
 */

const crypto = require('node:crypto');
const intakeReport = require('./intake-report');
const filterValueTypes = require('./filter-value-types');

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
  { key: 'planStartMonth', source: '[Data].[Plan Başlangıç Ay]', tr: 'Plan başlangıç ayı', en: 'Plan start month', filter: true, optionalGrain: true, nameTyped: true },
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

/* Bağlantı: bu kataloğa (OAB_Cube) Veri Yönetimi'nde tanımlanmış bir bağlantı
   varsa o; yoksa INTAKE rolünün sunucusu (aynı SSAS sunucusu) + OAB_Cube;
   o da yoksa kaynak Excel'deki bağlantı. */
function resolveConnection(items) {
  const list = (Array.isArray(items) ? items : []).filter(item => item && clean(item.server) && clean(item.catalog));
  const found = list.find(item => OAB_CUBE_CATALOG_PATTERN.test(clean(item.catalog)) && item.refreshEnabled !== false)
    || list.find(item => OAB_CUBE_CATALOG_PATTERN.test(clean(item.catalog)));
  if (found) return { id: clean(found.id), name: clean(found.name) || OAB_CUBE_CONNECTION.catalog, server: clean(found.server), catalog: clean(found.catalog), model: OAB_CUBE_CONNECTION.model, source: 'settings' };
  const intake = list.find(item => item.role === 'intake');
  if (intake) return { id: '', name: OAB_CUBE_CONNECTION.catalog, server: clean(intake.server), catalog: OAB_CUBE_CONNECTION.catalog, model: OAB_CUBE_CONNECTION.model, source: 'intake-server' };
  return { id: '', name: OAB_CUBE_CONNECTION.catalog, server: OAB_CUBE_CONNECTION.server, catalog: OAB_CUBE_CONNECTION.catalog, model: OAB_CUBE_CONNECTION.model, source: 'default' };
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
  if (kind === 'dimension' && DIMENSIONS.some(item => item.key === key)) return { key };
  if (kind === 'value' && measureByKey(key)) return { key, agg: AGGREGATES.includes(agg) ? agg : measureByKey(key).agg };
  const source = clean(entry.source);
  if (!SOURCE_PATTERN.test(source)) return null;
  const isMeasure = /^\[measures\]/i.test(source);
  if ((kind === 'value') !== isMeasure) return null;
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
  };
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
   kombinasyon batch'ine gerek yok). Sezon zorunludur: sorgu bütün küpü
   taramaz. */
function buildQuery({ liveFields = [], view = null, filterValues = {}, maxRows = OAB_CUBE_MAX_ROWS } = {}) {
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
  if (!filters.season || !filters.season.length) {
    throw error('OAB küp sorgusu için en az bir sezon seçilmelidir.', 'OAB_CUBE_SEASON_REQUIRED', 400);
  }
  const dimensionByKey = new Map(resolved.dimensions.map(item => [item.key, item.field]));
  extraFilterFields.forEach((field, key) => dimensionByKey.set(key, field));
  const filterExpressions = [];
  for (const [key, values] of Object.entries(filters)) {
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
  const queried = resolved.measures.filter(item => item.required || wantedMeasures.has(item.key));
  const measureFields = [...queried.map(item => ({ key: item.key, field: item.field })), ...extraMeasures];
  const groupExpressions = groupFields.map(item => intakeReport.daxRef(item.field));
  const measureExpressions = measureFields.map(item => `${quoteAlias(item.key)}, ${intakeReport.daxRef(item.field)}`);
  const rowLimit = Math.min(OAB_CUBE_MAX_ROWS, Math.max(1, Math.floor(Number(maxRows) || OAB_CUBE_MAX_ROWS)));
  const query = `EVALUATE\nTOPN(${rowLimit},\n  SUMMARIZECOLUMNS(\n    ${[...groupExpressions, ...filterExpressions, ...measureExpressions].join(',\n    ')}\n  )\n)`;
  const headerMap = {};
  groupFields.forEach(item => outputAliases(item.field).forEach(alias => { headerMap[alias] = item.key; }));
  measureFields.forEach(item => { headerMap[item.key] = item.key; headerMap[`[${item.key}]`] = item.key; });
  // WSSI ve Onaylı zorunlu ölçülerdir (her sorguda var); türetilmiş ölçüler
  // bunlardan satır düzeyinde hesaplanır, küp sorgusuna girmez.
  const queriedKeys = measureFields.map(item => item.key);
  const derivedKeys = ['wssi', 'approved'].every(key => queriedKeys.includes(key)) ? DERIVED_MEASURES.map(item => item.key) : [];
  return {
    query, headerMap, maxRows: rowLimit, filterValues: filters,
    dimensions: groupFields.map(item => item.key),
    measures: queriedKeys,
    derived: derivedKeys,
    missing,
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
    dimensions: DIMENSIONS.map(({ key, tr, en, filter, required, code, optionalGrain }) => ({ key, tr, en, filter: Boolean(filter), required: Boolean(required), code: Boolean(code), optionalGrain: Boolean(optionalGrain) })),
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
  resolveConnection, resolveFields, normalizeRef, normalizeFilterValues, normalizeView, buildQuery, normalizeRows, toNumber,
  freshnessQuery, normalizeFreshness, distinctQuery, resolveFilterField, metadata, extraKey, isProvenTable, catalog,
};
