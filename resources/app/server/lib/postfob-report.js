'use strict';

/* FOB SONRASI MALİYET — saf sorgu katmanı.
 *
 * Kaynak: FiyatMaliyetKontrolRapor SSAS Tabular modeli (S41 Fiyat Maliyet
 * Kontrol Raporu pivotunun bağlı olduğu küp). INTAKE ile aynı doğrudan model
 * sorgu altyapısını (modelQuery / ModelQuery.ps1) kullanır; Excel dosyası
 * gerekmez.
 *
 * INTAKE'ten farkı: kullanıcı pivot alanı seçmez. Sorgu sabit, sipariş × renk
 * (× satış ülkesi) düzeyindedir; FOB sonrası oranlar ve ağırlıklı ortalamalar
 * tarayıcıda public/postfob-analysis.js ile hesaplanır. Görünen etiketler hiçbir
 * zaman kaynak kimliği değildir: sorgu yalnız [Tablo].[Sütun] kimliğinden üretilir.
 *
 * Boyut seçimi bilinçlidir: yalnız kaynak pivotta fiilen kullanılan (ölçülerle
 * ilişkisi kanıtlı) tablolar (Urun, AnaData, SatisUlke) gruplanır. İlişkisi
 * doğrulanmamış bir tablo SUMMARIZECOLUMNS'ta çapraz çarpım üretip satırları
 * çoğaltabilir; bu yüzden Cari (üretici adı) bu sürümde sorguya girmez.
 */

const intakeReport = require('./intake-report');
const filterValueTypes = require('./filter-value-types');

const POSTFOB_CONNECTION = Object.freeze({
  server: 'F5_S41',
  catalog: 'FiyatMaliyetKontrolRapor',
  model: 'Model',
});
const POSTFOB_CATALOG_PATTERN = /^fiyatmaliyetkontrolrapor$/i;
const POSTFOB_MAX_ROWS = 10000;
const POSTFOB_VIEW_VERSION = 1;

/* Boyutlar: key = satır verisindeki kararlı ad (tarayıcı bunu okur). */
const DIMENSIONS = Object.freeze([
  { key: 'order', source: '[Urun].[sipariskod]', tr: 'Sipariş', en: 'Order' },
  { key: 'model', source: '[Urun].[Modelkod]', tr: 'Model', en: 'Model' },
  { key: 'colour', source: '[Urun].[Renkkod]', tr: 'Renk', en: 'Colour' },
  { key: 'season', source: '[Urun].[SezonKod]', tr: 'Sezon', en: 'Season', filter: true, required: true },
  { key: 'mag', source: '[Urun].[MerchAltGrupKod]', tr: 'MAG', en: 'MAG', filter: true },
  { key: 'buyerGroup', source: '[Urun].[BuyerGrupTanim]', tr: 'Buyer grup', en: 'Buyer group', filter: true },
  { key: 'classification', source: '[Urun].[UrunKlasmanTanim]', tr: 'Ürün klasmanı', en: 'Product class', filter: true },
  { key: 'originCountry', source: '[AnaData].[Uretici Ulke Adi]', tr: 'Üretici ülke', en: 'Origin country', filter: true },
  { key: 'salesCountry', source: '[SatisUlke].[Satış Ülkesi]', tr: 'Satış ülkesi', en: 'Sales country', filter: true },
].map(Object.freeze));

/* Ölçüler. Birim ölçüler (unit) tarayıcıda adet ağırlıklı ortalanır; oranlar da
   satır düzeyinde birim değer sayılır. required: yoksa rapor üretilmez. */
const MEASURES = Object.freeze([
  { key: 'qty', source: '[Measures].[NetSipariş Miktarı]', tr: 'Net sipariş adedi', en: 'Net order quantity', kind: 'quantity', required: true },
  { key: 'fob', source: '[Measures].[FOB_USD_]', tr: 'FOB USD', en: 'FOB USD', kind: 'unit', required: true },
  { key: 'landedActual', source: '[Measures].[TR Antrepo Landed Gerceklesen USD]', tr: 'Landed gerçekleşen USD', en: 'Actual landed USD', kind: 'unit' },
  { key: 'landedForecast', source: '[Measures].[TR Antrepo Landed Ongoru USD]', tr: 'Landed öngörü USD', en: 'Forecast landed USD', kind: 'unit' },
  { key: 'integralFirst', source: '[Measures].[Integral Ilk Maliyet USD]', tr: 'Integral ilk maliyet USD', en: 'Integral initial cost USD', kind: 'unit' },
  { key: 'integralLast', source: '[Measures].[Integral Son Maliyet USD]', tr: 'Integral son maliyet USD', en: 'Integral final cost USD', kind: 'unit' },
  { key: 'financeCost', source: '[Measures].[Finans Maliyeti USD]', tr: 'Finans maliyeti USD', en: 'Finance cost USD', kind: 'unit' },
  { key: 'advanceCost', source: '[Measures].[Avans Maliyeti USD]', tr: 'Avans maliyeti USD', en: 'Advance cost USD', kind: 'unit' },
  { key: 'customsRate', source: '[Measures].[Gümrük Oran]', tr: 'Gümrük oranı', en: 'Customs rate', kind: 'rate' },
  { key: 'freightRate', source: '[Measures].[Navlun Oran]', tr: 'Navlun oranı', en: 'Freight rate', kind: 'rate' },
  { key: 'extraRate', source: '[Measures].[EkMaliyet Oran]', tr: 'Ek maliyet oranı', en: 'Extra cost rate', kind: 'rate' },
  { key: 'tpMultiplier', source: '[Measures].[TP-Carpan]', tr: 'TP çarpanı', en: 'TP multiplier', kind: 'rate' },
].map(Object.freeze));

const FILTER_KEYS = Object.freeze(DIMENSIONS.filter(item => item.filter).map(item => item.key));
const GROUP_KEYS = Object.freeze(['originCountry', 'mag', 'buyerGroup', 'season', 'classification', 'salesCountry', 'model', 'order']);
const SEGMENTS = Object.freeze(['all', 'import', 'domestic']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function error(message, code, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }

/* Bağlantı: kullanıcı Bağlantı Ayarları'nda bu kataloğa bir bağlantı tanımladıysa
   (rol fark etmez) o kullanılır; yoksa kaynak Excel'deki bağlantının sunucusu. */
function resolveConnection(items) {
  const found = (Array.isArray(items) ? items : []).find(item => item
    && POSTFOB_CATALOG_PATTERN.test(clean(item.catalog)) && clean(item.server));
  if (found) return { id: clean(found.id), name: clean(found.name) || POSTFOB_CONNECTION.catalog, server: clean(found.server), catalog: clean(found.catalog), model: POSTFOB_CONNECTION.model, source: 'settings' };
  return { id: '', name: POSTFOB_CONNECTION.catalog, server: POSTFOB_CONNECTION.server, catalog: POSTFOB_CONNECTION.catalog, model: POSTFOB_CONNECTION.model, source: 'default' };
}

function definitionField(definition, fieldType) {
  return intakeReport.createField({ sourceUniqueName: definition.source, fieldType });
}

/* Canlı şemadaki alanları tanımlara eşler. Şema yoksa (ör. test) tanımın kendi
   kimliği kullanılır. Zorunlu ölçü/boyut yoksa açık hata verilir; isteğe bağlı
   ölçü sessizce değil, `missing` listesinde raporlanarak düşer. */
function resolveFields(liveFields) {
  const live = Array.isArray(liveFields) ? liveFields : [];
  const bySource = new Map(live.map(field => [intakeReport.sourceKey(field.sourceUniqueName), field]));
  const pick = (definition, fieldType) => {
    if (!live.length) return definitionField(definition, fieldType);
    const found = bySource.get(intakeReport.sourceKey(definition.source));
    return found && found.fieldType === fieldType ? found : null;
  };
  const dimensions = [], measures = [], missing = [];
  for (const definition of DIMENSIONS) {
    const field = pick(definition, 'dimension');
    if (field) dimensions.push({ ...definition, field }); else missing.push(definition.key);
  }
  for (const definition of MEASURES) {
    const field = pick(definition, 'measure');
    if (field) measures.push({ ...definition, field }); else missing.push(definition.key);
  }
  const requiredMissing = [...DIMENSIONS, ...MEASURES].filter(item => item.required || ['order', 'model', 'colour'].includes(item.key))
    .map(item => item.key).filter(key => missing.includes(key));
  if (requiredMissing.length) {
    throw error(`FOB sonrası maliyet modeli beklenen alanları içermiyor: ${requiredMissing.join(', ')}.`, 'POSTFOB_SCHEMA_MISMATCH', 422);
  }
  return { dimensions, measures, missing };
}

function normalizeFilterValues(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of FILTER_KEYS) {
    const values = Array.isArray(source[key]) ? source[key] : [];
    const list = [...new Set(values.map(clean).filter(Boolean))].slice(0, 500);
    if (list.length) out[key] = list;
  }
  return out;
}

function normalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const groupBy = GROUP_KEYS.includes(clean(source.groupBy)) ? clean(source.groupBy) : 'originCountry';
  const segment = SEGMENTS.includes(clean(source.segment)) ? clean(source.segment) : 'all';
  const sort = source.sort && typeof source.sort === 'object' ? source.sort : {};
  return {
    version: POSTFOB_VIEW_VERSION,
    filterValues: normalizeFilterValues(source.filterValues),
    groupBy,
    segment,
    outliersOnly: source.outliersOnly === true,
    sort: { key: clean(sort.key).slice(0, 40), dir: Number(sort.dir) === 1 ? 1 : -1 },
  };
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

/* SUMMARIZECOLUMNS sipariş × renk × satış ülkesi düzeyinde; filtreler TREATAS ile
   aynı argüman listesine girer. Sezon filtresi zorunludur: sorgunun bütün küpü
   taramasını engeller. */
function buildQuery({ liveFields = [], filterValues = {}, maxRows = POSTFOB_MAX_ROWS } = {}) {
  const resolved = resolveFields(liveFields);
  const filters = normalizeFilterValues(filterValues);
  if (!filters.season || !filters.season.length) {
    throw error('FOB sonrası maliyet sorgusu için en az bir sezon seçilmelidir.', 'POSTFOB_SEASON_REQUIRED', 400);
  }
  const dimensionByKey = new Map(resolved.dimensions.map(item => [item.key, item]));
  const filterExpressions = [];
  for (const [key, values] of Object.entries(filters)) {
    const item = dimensionByKey.get(key);
    if (!item) throw error(`"${key}" filtresi canlı modelde bulunamadı.`, 'POSTFOB_FILTER_UNAVAILABLE', 422);
    let literals;
    try { literals = intakeReport.intakeFilterValues({ ...item.field, defaultLabel: item.tr }, values); }
    catch (cause) { throw error(cause && cause.message || 'Filtre değeri geçersiz.', 'POSTFOB_FILTER_VALUE_TYPE', 400); }
    filterExpressions.push(`TREATAS({ ${literals.join(', ')} }, ${intakeReport.daxRef(item.field)})`);
  }
  const groupExpressions = resolved.dimensions.map(item => intakeReport.daxRef(item.field));
  const measureExpressions = resolved.measures.map(item => `${quoteAlias(item.key)}, ${intakeReport.daxRef(item.field)}`);
  const rowLimit = Math.min(POSTFOB_MAX_ROWS, Math.max(1, Math.floor(Number(maxRows) || POSTFOB_MAX_ROWS)));
  const query = `EVALUATE\nTOPN(${rowLimit},\n  SUMMARIZECOLUMNS(\n    ${[...groupExpressions, ...filterExpressions, ...measureExpressions].join(',\n    ')}\n  )\n)`;
  const headerMap = {};
  resolved.dimensions.forEach(item => outputAliases(item.field).forEach(alias => { headerMap[alias] = item.key; }));
  resolved.measures.forEach(item => { headerMap[item.key] = item.key; headerMap[`[${item.key}]`] = item.key; });
  return {
    query, headerMap, maxRows: rowLimit, filterValues: filters,
    dimensions: resolved.dimensions.map(item => item.key),
    measures: resolved.measures.map(item => item.key),
    missing: resolved.missing,
  };
}

/* Model CSV'si sayıları metin olarak taşıyabilir (ondalık virgül dahil). */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = clean(value).replace(/\s/g, '');
  if (!text) return null;
  // Son ayraç virgülse ondalık virgüldür (tr-TR); değilse virgül binlik ayraçtır.
  const normalized = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeRows(rows, built) {
  const dimensions = built && Array.isArray(built.dimensions) ? built.dimensions : DIMENSIONS.map(item => item.key);
  const measures = built && Array.isArray(built.measures) ? built.measures : MEASURES.map(item => item.key);
  return (Array.isArray(rows) ? rows : []).map(row => {
    const out = {};
    for (const key of dimensions) out[key] = clean(row && row[key]);
    for (const key of measures) out[key] = toNumber(row && row[key]);
    return out;
  });
}

function distinctQuery(item, { search = '', limit = 500 } = {}) {
  const column = intakeReport.daxRef(item.field);
  const valueType = intakeReport.intakeFieldValueType(item.field);
  const text = clean(search).slice(0, 120).replace(/"/g, '""');
  const searchInDax = Boolean(text) && filterValueTypes.supportsTextOperators(valueType);
  const count = Math.min(5000, Math.max(1, Math.floor(Number(limit) || 500)));
  const table = searchInDax ? `FILTER(DISTINCT(${column}), CONTAINSSTRING(${column}, "${text}"))` : `DISTINCT(${column})`;
  return { query: `EVALUATE TOPN(${count}, ${table}, ${column}, ASC)`, limit: count, searchInDax, valueType };
}

function catalog() {
  return {
    dimensions: DIMENSIONS.map(({ key, tr, en, filter, required }) => ({ key, tr, en, filter: Boolean(filter), required: Boolean(required) })),
    measures: MEASURES.map(({ key, tr, en, kind, required }) => ({ key, tr, en, kind, required: Boolean(required) })),
    groupKeys: [...GROUP_KEYS],
    segments: [...SEGMENTS],
  };
}

module.exports = {
  POSTFOB_CONNECTION, POSTFOB_MAX_ROWS, DIMENSIONS, MEASURES, FILTER_KEYS, GROUP_KEYS, SEGMENTS,
  resolveConnection, resolveFields, normalizeFilterValues, normalizeView, buildQuery, normalizeRows, toNumber,
  distinctQuery, catalog,
};
