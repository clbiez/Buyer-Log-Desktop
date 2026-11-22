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
const modelHorizon = require('./modelHorizon');

const POSTFOB_CONNECTION = Object.freeze({
  server: 'F5_S41',
  catalog: 'FiyatMaliyetKontrolRapor',
  model: 'Model',
});
const POSTFOB_CATALOG_PATTERN = /^fiyatmaliyetkontrolrapor$/i;
const POSTFOB_MAX_ROWS = 10000;
const POSTFOB_VIEW_VERSION = 2;

/* Boyutlar: key = satır verisindeki kararlı ad (tarayıcı bunu okur). */
const DIMENSIONS = Object.freeze([
  { key: 'order', source: '[Urun].[sipariskod]', tr: 'Sipariş', en: 'Order' },
  { key: 'model', source: '[Urun].[Modelkod]', tr: 'Model', en: 'Model' },
  { key: 'colour', source: '[Urun].[Renkkod]', tr: 'Renk', en: 'Colour' },
  { key: 'productName', source: '[Urun].[UrunAd]', tr: 'Ürün adı', en: 'Product name' },
  { key: 'season', source: '[Urun].[SezonKod]', tr: 'Sezon', en: 'Season', filter: true, required: true },
  { key: 'mag', source: '[Urun].[MerchAltGrupKod]', tr: 'MAG', en: 'MAG', filter: true },
  { key: 'buyerGroup', source: '[Urun].[BuyerGrupTanim]', tr: 'Buyer grup', en: 'Buyer group', filter: true },
  { key: 'classification', source: '[Urun].[UrunKlasmanTanim]', tr: 'Ürün klasmanı', en: 'Product class', filter: true },
  { key: 'originCountry', source: '[AnaData].[Uretici Ulke Adi]', tr: 'Üretici ülke', en: 'Origin country', filter: true },
  // Kaynak pivotta satış ülkesi yalnız sayfa filtresidir (All); sorgu düzeyine yalnız
  // pivot satır/sütununa eklenince girer. Aksi hâlde satır sayısı ülke sayısıyla
  // katlanır ve ülkeye bölünmeyen bir ölçü varsa adet çoğalırdı.
  { key: 'salesCountry', source: '[SatisUlke].[Satış Ülkesi]', tr: 'Satış ülkesi', en: 'Sales country', filter: true, optionalGrain: true },
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
const SEGMENTS = Object.freeze(['all', 'import', 'domestic']);

/* Pivot değer sütunları. Birim değerler adet ağırlıklı; oranlar aynı satır
   kümesinde Σ(adet×pay)/Σ(adet×payda) (public/postfob-analysis.js). */
const VALUES = Object.freeze([
  { key: 'qty', tr: 'Adet', en: 'Qty', format: 'qty' },
  { key: 'orders', tr: 'Sipariş', en: 'Orders', format: 'qty' },
  { key: 'fob', tr: 'FOB USD', en: 'FOB USD', format: 'usd' },
  { key: 'landedActual', tr: 'Landed USD', en: 'Landed USD', format: 'usd' },
  { key: 'landedForecast', tr: 'Landed öngörü USD', en: 'Forecast landed USD', format: 'usd' },
  { key: 'postFob', tr: 'FOB sonrası USD', en: 'Post-FOB USD', format: 'usd' },
  { key: 'landedToFob', tr: 'Landed/FOB', en: 'Landed/FOB', format: 'ratio' },
  { key: 'integralFirst', tr: 'Integral ilk USD', en: 'Integral initial USD', format: 'usd' },
  { key: 'integralLast', tr: 'Integral son USD', en: 'Integral final USD', format: 'usd' },
  { key: 'integralToFob', tr: 'Integral/FOB', en: 'Integral/FOB', format: 'ratio' },
  { key: 'forecastGap', tr: 'Öngörü sapması', en: 'Forecast gap', format: 'pct' },
  { key: 'financeCost', tr: 'Finans USD', en: 'Finance USD', format: 'usd' },
  { key: 'advanceCost', tr: 'Avans USD', en: 'Advance USD', format: 'usd' },
  { key: 'customsRate', tr: 'Gümrük', en: 'Customs', format: 'rate' },
  { key: 'freightRate', tr: 'Navlun', en: 'Freight', format: 'rate' },
  { key: 'extraRate', tr: 'Ek maliyet', en: 'Extra cost', format: 'rate' },
  { key: 'tpMultiplier', tr: 'TP çarpanı', en: 'TP multiplier', format: 'rate' },
  { key: 'outliers', tr: 'Aykırı', en: 'Outliers', format: 'count' },
].map(Object.freeze));
const VALUE_KEYS = Object.freeze(VALUES.map(item => item.key));
const DEFAULT_VALUES = Object.freeze(['qty', 'orders', 'fob', 'landedActual', 'postFob', 'landedToFob', 'integralLast', 'integralToFob', 'forecastGap', 'customsRate', 'freightRate', 'extraRate', 'outliers']);
const EXTRA_AGGREGATES = Object.freeze(['SUM', 'WAVG', 'AVG', 'MIN', 'MAX']);
const EXTRA_PREFIX = 'x_';
const MAX_AXIS_FIELDS = 12;
const SOURCE_PATTERN = /^\[[^\[\]]{1,200}\](?:\.\[[^\[\]]{1,200}\]){1,2}$/;

function clean(value) { return String(value == null ? '' : value).trim(); }
function error(message, code, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }

/* Bağlantı: Veri Yönetimi'ndeki 'postfob' rolü (INTAKE gibi kendi veritabanı
   kaydı) önce gelir; eski kurulumda bu kataloğa elle eklenmiş bir bağlantı
   varsa o; hiçbiri yoksa kaynak Excel'deki bağlantının sunucusu. */
function postfobItem(items) {
  const list = (Array.isArray(items) ? items : []).filter(item => item && clean(item.server) && clean(item.catalog));
  const byRole = list.filter(item => item.role === 'postfob');
  return byRole.find(item => item.refreshEnabled !== false) || byRole[0]
    || list.find(item => POSTFOB_CATALOG_PATTERN.test(clean(item.catalog))) || null;
}
function resolveConnection(items) {
  const found = postfobItem(items);
  if (found) return { id: clean(found.id), name: clean(found.name) || POSTFOB_CONNECTION.catalog, server: clean(found.server), catalog: clean(found.catalog), model: POSTFOB_CONNECTION.model, source: 'settings' };
  return { id: '', name: POSTFOB_CONNECTION.catalog, server: POSTFOB_CONNECTION.server, catalog: POSTFOB_CONNECTION.catalog, model: POSTFOB_CONNECTION.model, source: 'default' };
}

/* Ufuk: Veri Yönetimi'nde bu kaynağın 'postfob' kapsamına yazılan ortak
   filtre. INTAKE ile aynı kural: kişisel katman yoktur. */
function resolveHorizon(items) {
  const item = postfobItem(items);
  if (!item || item.role !== 'postfob' || !Array.isArray(item.scopes)) return null;
  const scope = item.scopes.find(entry => entry && entry.enabled !== false && Array.isArray(entry.targets) && entry.targets.includes('postfob'));
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

function horizonArgs(horizon, liveFields) {
  if (!isBoundedHorizon(horizon)) return [];
  // Ufuk argümanı iki adımda üretilir; ikisi de (ör. çok tablolu VEYA grupları)
  // kullanıcının düzeltebileceği bir ufuk hatasıdır, kaynak kesintisi değil.
  try {
    const filter = modelHorizon.buildHorizonFilter(horizon, null, { columnType: intakeReport.intakeColumnTypeIndex(liveFields) });
    return modelHorizon.summarizeFilterArgs(filter, '');
  } catch (cause) {
    throw error(`FOB sonrası maliyet ufku uygulanamadı: ${cause && cause.message || cause}`, 'POSTFOB_HORIZON_INVALID', 400);
  }
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

function extraKey(source) {
  return EXTRA_PREFIX + require('node:crypto').createHash('sha256').update(intakeReport.sourceKey(source), 'utf8').digest('hex').slice(0, 16);
}

/* Alan referansı: temel alan {key} veya modelden eklenen alan {key:'x_…', source, label[, agg]}.
   Kimlik her zaman kaynak adından türetilir; istemcinin gönderdiği anahtar güvenilmez. */
function normalizeRef(raw, kind) {
  const entry = typeof raw === 'string' ? { key: raw } : (raw && typeof raw === 'object' ? raw : null);
  if (!entry) return null;
  const key = clean(entry.key);
  if (kind === 'dimension' && DIMENSIONS.some(item => item.key === key)) return { key };
  if (kind === 'value' && VALUE_KEYS.includes(key)) return { key };
  const source = clean(entry.source);
  if (!SOURCE_PATTERN.test(source)) return null;
  const isMeasure = /^\[measures\]/i.test(source);
  if ((kind === 'value') !== isMeasure) return null;
  const ref = { key: extraKey(source), source, label: clean(entry.label).slice(0, 120) || intakeReport.sourceParts(source).name };
  if (kind === 'value') ref.agg = EXTRA_AGGREGATES.includes(clean(entry.agg).toUpperCase()) ? clean(entry.agg).toUpperCase() : 'SUM';
  return ref;
}

function refList(raw, kind, fallback) {
  if (!Array.isArray(raw)) return fallback.map(key => ({ key }));
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

/* Görünüm v2: INTAKE pivotu gibi satır, sütun, değer ve filtre eksenleri.
   v1 kaydı (tek groupBy) satır eksenine taşınır. */
function normalizeView(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const legacyRows = !Array.isArray(source.rows) && clean(source.groupBy) ? [clean(source.groupBy)] : null;
  let rows = refList(legacyRows || source.rows, 'dimension', ['originCountry']).slice(0, MAX_AXIS_FIELDS);
  const columns = refList(source.columns, 'dimension', []).filter(ref => !rows.some(row => row.key === ref.key)).slice(0, MAX_AXIS_FIELDS);
  if (!rows.length && !columns.length) rows = [{ key: 'originCountry' }];
  let values = refList(source.values, 'value', DEFAULT_VALUES).slice(0, MAX_AXIS_FIELDS * 2);
  if (!values.length) values = DEFAULT_VALUES.map(key => ({ key }));
  const filters = refList(source.filters, 'dimension', FILTER_KEYS).slice(0, MAX_AXIS_FIELDS * 2);
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const sort = display.sort && typeof display.sort === 'object' ? display.sort : (source.sort && typeof source.sort === 'object' ? source.sort : {});
  const widths = {};
  const rawWidths = display.widths && typeof display.widths === 'object' ? display.widths : {};
  for (const [key, px] of Object.entries(rawWidths).slice(0, 200)) {
    const width = Number(px);
    if (/^[\w-]{1,40}$/.test(key) && Number.isFinite(width)) widths[key] = Math.max(60, Math.min(1000, Math.round(width)));
  }
  return {
    version: POSTFOB_VIEW_VERSION,
    rows, columns, values, filters,
    filterValues: normalizeFilterValues(source.filterValues, filters.map(ref => ref.key)),
    display: {
      grouped: display.grouped !== false,
      showSubtotals: display.showSubtotals !== false,
      collapsedGroups: Array.isArray(display.collapsedGroups) ? [...new Set(display.collapsedGroups.map(clean).filter(Boolean))].slice(0, 2000) : [],
      sort: { key: clean(sort.key).slice(0, 40), dir: Number(sort.dir) === 1 ? 1 : -1 },
      widths,
    },
    segment: SEGMENTS.includes(clean(source.segment)) ? clean(source.segment) : 'all',
    outliersOnly: source.outliersOnly === true,
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

function liveLookup(liveFields) {
  const live = Array.isArray(liveFields) ? liveFields : [];
  const bySource = new Map(live.map(field => [intakeReport.sourceKey(field.sourceUniqueName), field]));
  return (source, fieldType) => {
    if (!live.length) return intakeReport.createField({ sourceUniqueName: source, fieldType });
    const found = bySource.get(intakeReport.sourceKey(source));
    return found && found.fieldType === fieldType ? found : null;
  };
}

/* SUMMARIZECOLUMNS sipariş × renk × satış ülkesi (+ eklenen satır/sütun alanları)
   düzeyinde; filtreler TREATAS ile aynı argüman listesine girer. Sezon filtresi
   veya Veri Yönetimi ufku zorunludur: sorgunun bütün küpü taramasını engeller. */
function buildQuery({ liveFields = [], view = null, filterValues = {}, horizon = null, maxRows = POSTFOB_MAX_ROWS } = {}) {
  const current = normalizeView(view || { filterValues });
  const resolved = resolveFields(liveFields);
  const lookup = liveLookup(liveFields);
  const extras = viewExtras(current);
  const missing = [...resolved.missing];
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
    throw error('FOB sonrası maliyet sorgusu için en az bir sezon seçilmeli veya Veri Yönetimi\'nde ufuk tanımlanmalıdır.', 'POSTFOB_SEASON_REQUIRED', 400);
  }
  const dimensionByKey = new Map(resolved.dimensions.map(item => [item.key, item.field]));
  extraFilterFields.forEach((field, key) => dimensionByKey.set(key, field));
  const filterExpressions = [];
  for (const [key, values] of Object.entries(filters)) {
    const field = dimensionByKey.get(key);
    if (!field) throw error(`"${key}" filtresi canlı modelde bulunamadı.`, 'POSTFOB_FILTER_UNAVAILABLE', 422);
    let literals;
    try { literals = intakeReport.intakeFilterValues({ ...field, defaultLabel: field.name }, values); }
    catch (cause) { throw error(cause && cause.message || 'Filtre değeri geçersiz.', 'POSTFOB_FILTER_VALUE_TYPE', 400); }
    filterExpressions.push(`TREATAS({ ${literals.join(', ')} }, ${intakeReport.daxRef(field)})`);
  }
  const pivotKeys = new Set([...current.rows, ...current.columns].map(ref => ref.key));
  const groupFields = [...resolved.dimensions.filter(item => !item.optionalGrain || pivotKeys.has(item.key)).map(item => ({ key: item.key, field: item.field })), ...extraDims];
  const measureFields = [...resolved.measures.map(item => ({ key: item.key, field: item.field })), ...extraMeasures];
  const groupExpressions = groupFields.map(item => intakeReport.daxRef(item.field));
  const measureExpressions = measureFields.map(item => `${quoteAlias(item.key)}, ${intakeReport.daxRef(item.field)}`);
  const rowLimit = Math.min(POSTFOB_MAX_ROWS, Math.max(1, Math.floor(Number(maxRows) || POSTFOB_MAX_ROWS)));
  const query = `EVALUATE\nTOPN(${rowLimit},\n  SUMMARIZECOLUMNS(\n    ${[...groupExpressions, ...horizonFilterArgs, ...filterExpressions, ...measureExpressions].join(',\n    ')}\n  )\n)`;
  const headerMap = {};
  groupFields.forEach(item => outputAliases(item.field).forEach(alias => { headerMap[alias] = item.key; }));
  measureFields.forEach(item => { headerMap[item.key] = item.key; headerMap[`[${item.key}]`] = item.key; });
  return {
    query, headerMap, maxRows: rowLimit, filterValues: filters, horizonApplied: horizonFilterArgs.length > 0,
    dimensions: groupFields.map(item => item.key),
    measures: measureFields.map(item => item.key),
    missing,
  };
}

/* Pivot düzenleyicinin alan havuzu: canlı modelin bütün boyut ve ölçüleri. */
function metadata(liveFields) {
  const base = new Map([...DIMENSIONS, ...MEASURES].map(item => [intakeReport.sourceKey(item.source), item.key]));
  const shape = field => ({ source: field.sourceUniqueName, table: field.table, name: field.name, label: field.defaultLabel || field.name, baseKey: base.get(intakeReport.sourceKey(field.sourceUniqueName)) || '' });
  const live = Array.isArray(liveFields) ? liveFields : [];
  return {
    dimensions: live.filter(field => field.fieldType === 'dimension').map(shape).slice(0, 1000),
    measures: live.filter(field => field.fieldType === 'measure').map(shape).slice(0, 1000),
  };
}

/* Dağıtık değer sorgusu için filtre alanı: temel anahtar veya canlı modelde
   bulunan eklenmiş boyut. */
function resolveFilterField(liveFields, { key = '', source = '' } = {}) {
  const wanted = clean(key);
  const base = DIMENSIONS.find(item => item.key === wanted);
  const lookup = liveLookup(liveFields);
  if (base) return lookup(base.source, 'dimension');
  const ref = normalizeRef({ key: wanted, source }, 'dimension');
  return ref && ref.key === wanted ? lookup(ref.source, 'dimension') : null;
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
    dimensions: DIMENSIONS.map(({ key, tr, en, filter, required }) => ({ key, tr, en, filter: Boolean(filter), required: Boolean(required) })),
    measures: MEASURES.map(({ key, tr, en, kind, required }) => ({ key, tr, en, kind, required: Boolean(required) })),
    values: VALUES.map(item => ({ ...item })),
    defaults: normalizeView(null),
    aggregates: [...EXTRA_AGGREGATES],
    segments: [...SEGMENTS],
  };
}

module.exports = {
  POSTFOB_CONNECTION, POSTFOB_MAX_ROWS, DIMENSIONS, MEASURES, FILTER_KEYS, SEGMENTS, VALUES, DEFAULT_VALUES,
  resolveConnection, resolveHorizon, resolveFields, normalizeRef, normalizeFilterValues, normalizeView, buildQuery, normalizeRows, toNumber,
  distinctQuery, resolveFilterField, metadata, extraKey, catalog,
};
