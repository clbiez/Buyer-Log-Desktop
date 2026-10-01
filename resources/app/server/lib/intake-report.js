'use strict';

/* INTAKE raporu için saf konfigürasyon ve DAX üretim katmanı.
 *
 * OAB'deki pivot ayarından farklı olarak burada görünen etiketler hiçbir zaman
 * kaynak kimliği olarak kullanılmaz. Sorgu yalnız sourceUniqueName/table/name
 * üzerinden üretilir; display.labels, display.widths ve benzeri değerler ayrı
 * tutulur. Bu ayrım rename/reorder işlemlerinin veri cache'ini bozmasını önler.
 */

const crypto = require('node:crypto');
const modelHorizon = require('./modelHorizon');
const filterValueTypes = require('./filter-value-types');

// Yeni kurulumda Bağlantı Ayarları ekranında gösterilen INTAKE varsayılanıdır.
// Çalışma zamanında server/server.js aktif modelConnections kaydını kullanır;
// bu sabit yalnız preset ve geriye dönük test/varsayılan sözleşme içindir.
const INTAKE_CONNECTION = Object.freeze({
  server: 'lcwtabular_s20',
  catalog: 'WSSI Intake Raporu4',
  model: 'Model',
});

const DEFAULT_FILTER_DEFINITIONS = Object.freeze([
  ['Merch Yil Ay', '[Dim_Tarih].[Merch Yil Ay]'],
  ['Satış Cluster', '[SalesCluster].[Satış Cluster]'],
  ['Versiyon Tanim', '[Versiyon].[Versiyon Tanim]'],
  ['SezonKod', '[Dim_Sezon].[SezonKod]'],
  ['MerchAltGrupKod', '[Dim_Urun].[MerchAltGrupKod]'],
  ['BuyerGrupTanim', '[Dim_Urun].[BuyerGrupTanim]'],
].map(([defaultLabel, sourceUniqueName]) => ({ defaultLabel, sourceUniqueName, fieldType: 'dimension' })));

/* Bu alanlar yeni görünümde varsayılan filtre değildir; yine de alan
 * kataloğunda tutulur ki kullanıcı + Filtre ekle ile istediğinde ekleyebilsin
 * ve canlı şema geçici olarak kullanılamadığında da seçenek kaybolmasın. */
const OPTIONAL_FILTER_DEFINITIONS = Object.freeze([
  ['MerchAltGrupTanim', '[Dim_Urun].[MerchAltGrupTanim]'],
  ['Son Guncelleme Tarihi', '[Dim_Tarih].[Son Guncelleme Tarihi]'],
  ['UrunKlasmanKod', '[Dim_Urun].[UrunKlasmanKod]'],
].map(([defaultLabel, sourceUniqueName]) => ({ defaultLabel, sourceUniqueName, fieldType: 'dimension' })));

const DEFAULT_ROW_DEFINITIONS = Object.freeze([
  ['Tedarik Cluster', '[SupplyBasket].[Tedarik Cluster].[Tedarik Cluster]'],
  ['Dönem Tanim', '[Phase].[Dönem Tanim].[Dönem Tanim]'],
  ['UrunKlasmanTanim', '[Dim_Urun].[UrunKlasmanTanim].[UrunKlasmanTanim]'],
].map(([defaultLabel, sourceUniqueName]) => ({ defaultLabel, sourceUniqueName, fieldType: 'dimension' })));

const DEFAULT_MEASURE_DEFINITIONS = Object.freeze([
  ['Güncel Alım Bütçe', '[Measures].[Güncel Alım Bütçe]'],
  ['Sezon Öncesi Güncel Alım Bütçe', '[Measures].[Sezon Öncesi Güncel Alım Bütçe]'],
  ['Sezon Öncesi Aylık Plan Sipariş Miktarı', '[Measures].[Sezon Öncesi Aylık Plan Sipariş Miktarı]'],
  ['FT Ayrılan Güncel Alım Bütçe', '[Measures].[FT Ayrılan Güncel Alım Bütçe]'],
  ['Kümülatif Sipariş Miktar', '[Measures].[Kümülatif Sipariş Miktar]'],
  ['Sezon Öncesi WSSI Sipariş Miktarı', '[Measures].[Sezon Öncesi WSSI Sipariş Miktarı]'],
  ['Yedek Bütçe Sipariş', '[Measures].[Yedek Bütçe Sipariş]'],
  ['Sezon Öncesi Güncel Alım Bütçe OTB Miktar', '[Measures].[Sezon Öncesi Güncel Alım Bütçe OTB Miktar]'],
  ['Sezon Öncesi Güncel Alım Bütçe OTB Miktar ( Terminal )', '[Measures].[Sezon Öncesi Güncel Alım Bütçe OTB Miktar ( Terminal )]'],
  // Oran measure'ı satırlarda toplanamaz: alt toplam, paydası olan Güncel Alım
  // Bütçe ile ağırlıklı ortalamadır (Σ oran×bütçe / Σ bütçe = Σ pay / Σ payda).
  ['SEZON OTB (REZERV DAHİL)', '[Measures].[Güncel Alım Bütçe OTB Oranı]', { agg: 'WAVG', weightSource: '[Measures].[Güncel Alım Bütçe]' }],
].map(([defaultLabel, sourceUniqueName, options]) => ({ defaultLabel, sourceUniqueName, fieldType: 'measure', ...(options || {}) })));

const DEFAULT_FIELD_DEFINITIONS = Object.freeze([
  ...DEFAULT_FILTER_DEFINITIONS,
  ...OPTIONAL_FILTER_DEFINITIONS,
  ...DEFAULT_ROW_DEFINITIONS,
  ...DEFAULT_MEASURE_DEFINITIONS,
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function keyOf(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');
}

const INTAKE_VIEW_VERSION = 3;
const INTAKE_ZERO_BUDGET_SOURCE = '[Measures].[Güncel Alım Bütçe]';
const INTAKE_LEGACY_DEFAULT_FILTERS_TO_REMOVE = new Set([
  '[Dim_Urun].[MerchAltGrupTanim]',
  '[Dim_Tarih].[Son Guncelleme Tarihi]',
  '[Dim_Urun].[UrunKlasmanKod]',
].map(keyOf));

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
const INTAKE_AGGREGATES = Object.freeze(['SUM', 'AVG', 'WAVG', 'COUNT', 'MIN', 'MAX', 'FIRST']);
const INTAKE_RATIO_SOURCE = '[Measures].[Güncel Alım Bütçe OTB Oranı]';
function normalizeAggregate(value, fallback = 'SUM') {
  const agg = clean(value).toUpperCase();
  return INTAKE_AGGREGATES.includes(agg) ? agg : fallback;
}

function stableFieldId(sourceUniqueName) {
  const digest = crypto.createHash('sha256').update(clean(sourceUniqueName), 'utf8').digest('hex');
  return `intake-${digest.slice(0, 20)}`;
}

function sourceParts(sourceUniqueName) {
  const parts = [...clean(sourceUniqueName).matchAll(/\[([^\]]*)\]/g)].map(match => match[1]);
  if (parts[0] && keyOf(parts[0]) === 'measures') return { table: 'Measures', name: parts[parts.length - 1] || '' };
  return { table: parts[0] || '', name: parts[parts.length - 1] || '' };
}

/* Kaynak karşılaştırma anahtarı. Canlı şema sütunu [Tablo].[Sütun], varsayılan
   tanım ve eski kayıtlar ise hiyerarşi seviyesi [Tablo].[Sütun].[Sütun]
   biçiminde gelir; ikisi aynı sütundur ve aynı anahtara iner. */
function sourceKey(sourceUniqueName) {
  const parts = [...clean(sourceUniqueName).matchAll(/\[([^\]]*)\]/g)].map(match => keyOf(match[1]));
  if (parts.length === 3 && parts[1] === parts[2]) parts.pop();
  return parts.length ? parts.join('\u0000') : keyOf(sourceUniqueName);
}

function createField(definition = {}) {
  const suppliedTable = clean(definition.table);
  const suppliedName = clean(definition.name);
  const suppliedType = definition.fieldType === 'measure' || definition.kind === 'measure' ? 'measure' : 'dimension';
  const sourceUniqueName = clean(definition.sourceUniqueName || definition.sourceField)
    || (suppliedTable && suppliedName
      ? `[${suppliedType === 'measure' ? 'Measures' : suppliedTable}].[${suppliedName}]`
      : '');
  const parsed = sourceParts(sourceUniqueName);
  const fieldType = suppliedType;
  const name = clean(definition.name || parsed.name);
  const table = clean(definition.table || parsed.table);
  if (!sourceUniqueName || !name || !table) return null;
  const defaultLabel = clean(definition.defaultLabel || definition.label || definition.displayName || name);
  return {
    id: clean(definition.id) || stableFieldId(sourceUniqueName),
    sourceUniqueName,
    fieldType,
    defaultLabel,
    sourceLabel: clean(definition.sourceLabel || name),
    table,
    name,
    folder: clean(definition.folder),
    dataType: clean(definition.dataType || definition.data_type || definition.DATA_TYPE || definition.type),
    ...(fieldType === 'measure' ? measureSummary(definition.agg || definition.aggregate, definition.weightSource) : {}),
  };
}

function measureSummary(aggValue, weightValue, fallback = 'SUM') {
  const agg = normalizeAggregate(aggValue, fallback);
  const weightSource = clean(weightValue);
  return agg === 'WAVG' && weightSource
    ? { agg, weightSource, weightId: stableFieldId(weightSource) }
    : { agg: agg === 'WAVG' ? 'AVG' : agg };
}

function defaultFields() { return DEFAULT_FIELD_DEFINITIONS.map(createField).filter(Boolean); }

function normalizeSchema(schema = {}) {
  const out = [], seen = new Set();
  const add = (entry, fieldType) => {
    const candidate = createField({ ...entry, fieldType });
    if (!candidate || /^\$system/i.test(candidate.table) || /^__/.test(candidate.name)) return;
    const key = candidate.sourceUniqueName.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) return;
    seen.add(key); out.push(candidate);
  };
  for (const entry of Array.isArray(schema.columns) ? schema.columns : []) add(entry, 'dimension');
  for (const entry of Array.isArray(schema.measures) ? schema.measures : []) add(entry, 'measure');
  return out;
}

function fieldMap(fields) {
  const byId = new Map(), bySource = new Map(), byLabel = new Map();
  for (const raw of Array.isArray(fields) ? fields : []) {
    const field = createField(raw);
    if (!field) continue;
    byId.set(field.id, field);
    bySource.set(sourceKey(field.sourceUniqueName), field);
    if (!byLabel.has(keyOf(field.defaultLabel))) byLabel.set(keyOf(field.defaultLabel), field);
  }
  return { byId, bySource, byLabel };
}

function resolveDefaultField(definition, maps) {
  const parsed = sourceParts(definition.sourceUniqueName);
  const source = maps.bySource.get(sourceKey(definition.sourceUniqueName))
    || [...maps.byId.values()].find(field => keyOf(field.table) === keyOf(parsed.table)
      && keyOf(field.name) === keyOf(parsed.name)
      && field.fieldType === definition.fieldType);
  if (!source) return null;
  // OTB oranı modelde teknik bir measure adı taşır; ilk görünüm yine Excel'deki
  // business başlığını kullanır. SourceLabel ise gerçek model adını korur.
  return {
    ...source,
    defaultLabel: definition.defaultLabel,
    ...(source.fieldType === 'measure' && definition.agg ? measureSummary(definition.agg, definition.weightSource) : {}),
  };
}

function defaultViewConfig() {
  const fields = defaultFields();
  const byLabel = new Map(fields.map(field => [field.defaultLabel, field]));
  const pick = definitions => definitions.map(definition => byLabel.get(definition.defaultLabel)).filter(Boolean).map(clone);
  return {
    version: INTAKE_VIEW_VERSION,
    query: {
      rows: pick(DEFAULT_ROW_DEFINITIONS),
      columns: [],
      measures: pick(DEFAULT_MEASURE_DEFINITIONS),
      filters: pick(DEFAULT_FILTER_DEFINITIONS),
      filterValues: {},
    },
    display: {
      labels: {}, widths: {}, sort: { id: '', dir: 1 }, collapsed: [],
      grouped: true, showSubtotals: true, collapsedGroups: [],
      hideZeroCurrentBudget: true,
    },
  };
}

function refFromInput(raw, maps, allowDefault = true) {
  if (raw && typeof raw === 'object') {
    const withSaved = live => ({
      ...live,
      defaultLabel: clean(raw.defaultLabel) || live.defaultLabel,
      ...(live.fieldType === 'measure'
        ? measureSummary(raw.agg || raw.aggregate || live.agg, raw.agg || raw.aggregate ? raw.weightSource : live.weightSource)
        : {}),
    });
    if (raw.id && maps.byId.has(clean(raw.id))) return withSaved(maps.byId.get(clean(raw.id)));
    if (raw.sourceUniqueName && maps.bySource.has(sourceKey(raw.sourceUniqueName))) return withSaved(maps.bySource.get(sourceKey(raw.sourceUniqueName)));
    if (raw.defaultLabel && maps.byLabel.has(keyOf(raw.defaultLabel))) return maps.byLabel.get(keyOf(raw.defaultLabel));
    if (!maps.byId.size && allowDefault) return createField(raw);
    return null;
  }
  const value = clean(raw);
  if (!value) return null;
  return maps.byId.get(value) || maps.bySource.get(sourceKey(value)) || (allowDefault ? maps.byLabel.get(keyOf(value)) : null) || null;
}

function distinctFields(list) {
  const out = [], seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const field = createField(raw);
    if (!field || seen.has(field.id)) continue;
    seen.add(field.id); out.push(field);
  }
  return out;
}

function reconcileViewConfig(input, availableFields = []) {
  const maps = fieldMap(availableFields);
  const hasLiveFields = maps.byId.size > 0;
  const source = input && typeof input === 'object' && input.version ? input : null;
  const sourceQuery = source && source.query && typeof source.query === 'object' ? source.query : null;
  const sourceDisplay = source && source.display && typeof source.display === 'object' ? source.display : {};
  const fallback = defaultFields();
  const fallbackMap = fieldMap(fallback);
  const defaultsFor = definitions => definitions.map(def => {
    const resolved = resolveDefaultField(def, maps.byId.size ? maps : fallbackMap);
    return resolved ? clone(resolved) : null;
  }).filter(Boolean);
  const idAliases = new Map();
  const byFieldId = (record, id) => {
    if (!record || typeof record !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(record, id)) return record[id];
    const alias = idAliases.get(id);
    return alias ? record[alias] : undefined;
  };
  const resolveRaw = raw => {
    // Live schema is authoritative when available. When it is unavailable,
    // retain explicit saved field objects so a VPN/network outage cannot
    // silently erase a user's custom INTAKE columns.
    if (hasLiveFields) return refFromInput(raw, maps, false);
    // Kaynak kimliği taşıyan kayıtlı alan olduğu gibi korunur. Etiketle
    // varsayılana eşlemek alan id'sini değiştiriyor; snapshot satırları,
    // filtre değerleri ve özel etiketler eski id'de kaldığı için tablo
    // boyutları "(boş)" görünüyordu.
    if (raw && typeof raw === 'object' && clean(raw.sourceUniqueName)) {
      return createField(raw);
    }
    return refFromInput(raw, fallbackMap, false) || refFromInput(raw, maps, true);
  };
  const listFor = (key, definitions) => {
    if (!sourceQuery || !Object.prototype.hasOwnProperty.call(sourceQuery, key)) return defaultsFor(definitions);
    const values = Array.isArray(sourceQuery[key]) ? sourceQuery[key] : [];
    return distinctFields(values.map(raw => {
      const resolved = resolveRaw(raw);
      // Kayıtlı id canlı id'den farklıysa (eski üç parçalı kimlik) id'ye bağlı
      // filtre değeri, etiket, genişlik ve sıralama eski id'den taşınır.
      const savedId = raw && typeof raw === 'object' ? clean(raw.id) : '';
      if (resolved && savedId && savedId !== resolved.id) idAliases.set(resolved.id, savedId);
      return resolved;
    }).filter(Boolean));
  };
  const rows = listFor('rows', DEFAULT_ROW_DEFINITIONS).filter(field => field.fieldType === 'dimension');
  const columns = listFor('columns', []).filter(field => field.fieldType === 'dimension');
  let measures = listFor('measures', DEFAULT_MEASURE_DEFINITIONS).filter(field => field.fieldType === 'measure');
  /* v3 — OTB oranı eski varsayılanında SUM ile özetleniyordu; oranların
     toplamı anlamsız olduğundan bir kez ağırlıklı ortalamaya taşınır.
     Kullanıcının bilinçli seçtiği başka özetleme (AVG, MAX…) korunur. */
  if (source && Number(source.version || 0) < 3) {
    const ratio = DEFAULT_MEASURE_DEFINITIONS.find(def => sourceKey(def.sourceUniqueName) === sourceKey(INTAKE_RATIO_SOURCE));
    measures = measures.map(field => sourceKey(field.sourceUniqueName) === sourceKey(INTAKE_RATIO_SOURCE) && field.agg === 'SUM'
      ? { ...field, ...measureSummary(ratio.agg, ratio.weightSource) }
      : field);
  }
  let filters = listFor('filters', DEFAULT_FILTER_DEFINITIONS).filter(field => field.fieldType === 'dimension');
  const rawValues = sourceQuery && sourceQuery.filterValues && typeof sourceQuery.filterValues === 'object' ? sourceQuery.filterValues : {};

  /* v2 — Eski varsayılan görünümde otomatik gelen üç alan artık başlangıç
     filtresi değildir. Kullanıcı bu alanlardan birine gerçekten değer seçmişse
     davranışı sessizce değiştirmemek için filtre korunur; boş/All durumundaki
     eski varsayılanlar bir kez temizlenir. Alanlar şemada kalır ve + Filtre
     ekle üzerinden yeniden seçilebilir. */
  if (source && Number(source.version || 0) < 2) {
    filters = filters.filter(field => {
      if (!INTAKE_LEGACY_DEFAULT_FILTERS_TO_REMOVE.has(keyOf(field.sourceUniqueName))) return true;
      const candidates = [rawValues[field.id], rawValues[field.sourceUniqueName], rawValues[field.defaultLabel]];
      const values = candidates.find(item => Array.isArray(item)) || [];
      return values.map(clean).filter(Boolean).length > 0;
    });
  }

  const active = [...rows, ...columns, ...measures, ...filters];
  const activeIds = new Set(active.map(field => field.id));
  const filterValues = {};
  for (const field of filters) {
    const candidates = [byFieldId(rawValues, field.id), rawValues[field.sourceUniqueName], rawValues[field.defaultLabel]];
    const values = candidates.find(item => Array.isArray(item)) || [];
    const cleanValues = [...new Set(values.map(clean).filter(Boolean))].slice(0, 1000);
    if (cleanValues.length) filterValues[field.id] = cleanValues;
  }
  const labels = {};
  const rawLabels = sourceDisplay.labels && typeof sourceDisplay.labels === 'object' ? sourceDisplay.labels : {};
  for (const field of active) {
    const label = clean(byFieldId(rawLabels, field.id));
    if (label && keyOf(label) !== keyOf(field.defaultLabel)) labels[field.id] = label.slice(0, 160);
  }
  const widths = {};
  const rawWidths = sourceDisplay.widths && typeof sourceDisplay.widths === 'object' ? sourceDisplay.widths : {};
  for (const field of active) {
    const width = Number(byFieldId(rawWidths, field.id));
    if (Number.isFinite(width)) widths[field.id] = Math.max(60, Math.min(1000, Math.round(width)));
  }
  const rawSort = sourceDisplay.sort && typeof sourceDisplay.sort === 'object' ? sourceDisplay.sort : {};
  const sortId = activeIds.has(clean(rawSort.id)) ? clean(rawSort.id)
    : ([...idAliases].find(([, alias]) => alias === clean(rawSort.id)) || [''])[0];
  const sort = sortId ? { id: sortId, dir: Number(rawSort.dir) === -1 ? -1 : 1 } : { id: '', dir: 1 };
  const collapsed = Array.isArray(sourceDisplay.collapsed) ? sourceDisplay.collapsed.map(clean).filter(id => activeIds.has(id)) : [];
  const grouped = sourceDisplay.grouped !== false;
  const showSubtotals = sourceDisplay.showSubtotals !== false;
  const collapsedGroups = Array.isArray(sourceDisplay.collapsedGroups) ? [...new Set(sourceDisplay.collapsedGroups.map(clean).filter(Boolean))].slice(0, 5000) : [];
  const hideZeroCurrentBudget = sourceDisplay.hideZeroCurrentBudget !== false;
  /* Genel Bakış filtrelerinden gelen değerlerin kaydı (public/intake.js
     syncOverviewFilters). Kalıcı olmazsa Genel Bakış filtresi kaldırıldığında
     INTAKE'e yazılmış değerler hangisinin senkrondan geldiği bilinmeden
     görünümde kalıyordu. */
  const rawSync = sourceDisplay.overviewSync && typeof sourceDisplay.overviewSync === 'object' ? sourceDisplay.overviewSync : null;
  let overviewSync = null;
  if (rawSync) {
    const filterIds = new Set(filters.map(field => field.id));
    const syncValues = {};
    const rawSyncValues = rawSync.values && typeof rawSync.values === 'object' ? rawSync.values : {};
    const syncIdFor = id => filterIds.has(id) ? id : ([...idAliases].find(([to, alias]) => alias === id && filterIds.has(to)) || [''])[0];
    for (const [rawId, values] of Object.entries(rawSyncValues)) {
      const id = syncIdFor(rawId);
      if (!id || !Array.isArray(values)) continue;
      const list = [...new Set(values.map(clean).filter(Boolean))].slice(0, 1000);
      if (list.length) syncValues[id] = list;
    }
    const signature = clean(rawSync.signature).slice(0, 20000);
    if (signature || Object.keys(syncValues).length) overviewSync = { signature, values: syncValues };
  }
  return {
    version: INTAKE_VIEW_VERSION,
    query: { rows, columns, measures, filters, filterValues },
    display: { labels, widths, sort, collapsed, grouped, showSubtotals, collapsedGroups, hideZeroCurrentBudget, ...(overviewSync ? { overviewSync } : {}) },
  };
}

function updateDisplayLabel(config, id, value) {
  const next = clone(config || defaultViewConfig());
  next.display = next.display && typeof next.display === 'object' ? next.display : { labels: {} };
  next.display.labels = { ...(next.display.labels || {}) };
  const fieldId = clean(id), label = clean(value);
  const field = [...(next.query && next.query.rows || []), ...(next.query && next.query.columns || []), ...(next.query && next.query.measures || []), ...(next.query && next.query.filters || [])].find(item => item && item.id === fieldId);
  if (!field || !label || keyOf(label) === keyOf(field.defaultLabel)) delete next.display.labels[fieldId];
  else next.display.labels[fieldId] = label.slice(0, 160);
  return next;
}

function resetView() { return defaultViewConfig(); }
function displayLabel(config, field) {
  const id = field && clean(field.id);
  const custom = config && config.display && config.display.labels && clean(config.display.labels[id]);
  return custom || clean(field && field.defaultLabel) || clean(field && field.name);
}

function quoteTable(value) { return `'${clean(value).replace(/'/g, "''")}'`; }
function quoteColumn(value) { return `[${clean(value).replace(/]/g, ']]')}]`; }
function quoteString(value) { return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`; }

function daxRef(field) {
  const current = createField(field);
  if (!current) throw Object.assign(new Error('INTAKE alan kimliği çözümlenemedi.'), { code: 'INTAKE_FIELD_INVALID', statusCode: 400 });
  return current.fieldType === 'measure' ? `[${current.name.replace(/]/g, ']]')}]` : `${quoteTable(current.table)}${quoteColumn(current.name)}`;
}

function outputAliases(field) {
  const current = createField(field);
  if (!current) return [];
  return [
    current.id,
    current.sourceUniqueName,
    `${quoteTable(current.table)}${quoteColumn(current.name)}`,
    `${current.table}[${current.name}]`,
    `[${current.table}].[${current.name}]`,
    `[${current.table}].[${current.name}].[${current.name}]`,
    current.name,
  ];
}

/* v7.83 — FİLTRE DEĞERİ ALANIN ŞEMA TİPİYLE YAZILIR.

   Eskiden her değer `quoteString` ile metin literali oluyordu:

       TREATAS({ "123" }, 'Dim_Urun'[UrunKlasmanKod])

   Model tarafında o sütun tam sayıysa bu ifade tip hatasıyla düşer. Kullanıcı
   listeden seçtiği değerin neden çalışmadığını göremez. Artık alanın kendi
   `dataType` metadata'sı (MDSCHEMA) kanonik tipe çevrilir ve literal ona göre
   üretilir. Şema tip vermiyorsa davranış eskisi gibi metindir.

   GEÇERSİZ DEĞER SESSİZCE DÜŞMEZ: sayısal bir alana metin bir değer kalmışsa
   (alan tipi sonradan değişmiş olabilir) sorgu üretilmez, hangi alanın hangi
   değerinin düzeltilmesi gerektiği söylenir. Değeri atmak, kullanıcının
   kurduğunu sandığı filtrenin sessizce genişlemesi demektir. */
function intakeFieldValueType(field) {
  return filterValueTypes.resolveType({ dataType: field && field.dataType, name: field && field.name }).type;
}
function intakeFilterValues(field, values) {
  const type = intakeFieldValueType(field);
  const { literals, invalid } = filterValueTypes.daxValueList(values, type);
  if (invalid.length) {
    const sample = invalid.slice(0, 5).map(entry => entry.value).join(', ');
    throw Object.assign(
      new Error(`"${field.defaultLabel || field.name}" alanı ${type} tipinde; şu değerler bu tiple kullanılamıyor: ${sample}. Filtreyi yeniden seçin.`),
      { code: 'INTAKE_FILTER_VALUE_TYPE', statusCode: 400 });
  }
  return literals;
}
/* INTAKE ufku da aynı şema tipini kullanır: alan listesi zaten elimizde,
   ikinci bir şema turu atılmaz. */
function intakeColumnTypeIndex(fields) {
  return filterValueTypes.columnTypeIndex({
    columns: (Array.isArray(fields) ? fields : [])
      .filter(field => field && field.fieldType !== 'measure')
      .map(field => ({ table: field.table, name: field.name, kind: 'column', dataType: field.dataType })),
  });
}
const INTAKE_REPORT_MAX_ROWS = 10000;

function intakeReportRowLimit(value) {
  const requested = Number(value);
  return Math.min(INTAKE_REPORT_MAX_ROWS, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : INTAKE_REPORT_MAX_ROWS));
}

function buildIntakeQuery({ fields = [], viewConfig, horizon = null, maxRows = INTAKE_REPORT_MAX_ROWS, now = Date.now() } = {}) {
  void now;
  const available = normalizeSchema({
    columns: (fields || []).filter(field => field && field.fieldType !== 'measure').map(field => ({ ...field, kind: 'column' })),
    measures: (fields || []).filter(field => field && field.fieldType === 'measure').map(field => ({ ...field, kind: 'measure' })),
  });
  const config = reconcileViewConfig(viewConfig, available);
  const rows = [...config.query.rows, ...config.query.columns];
  const measures = config.query.measures;
  if (!measures.length) throw Object.assign(new Error('INTAKE raporu için en az bir measure seçilmelidir.'), { code: 'INTAKE_MEASURES_REQUIRED', statusCode: 400 });
  if (!rows.length) throw Object.assign(new Error('INTAKE raporu için en az bir satır veya kolon alanı seçilmelidir.'), { code: 'INTAKE_GROUP_FIELDS_REQUIRED', statusCode: 400 });
  const filterExpressions = config.query.filters.flatMap(field => {
    const values = config.query.filterValues[field.id] || [];
    if (!values.length) return [];
    return [`TREATAS({ ${intakeFilterValues(field, values).join(', ')} }, ${daxRef(field)})`];
  });
  const groupExpressions = rows.map(daxRef);
  const weights = intakeWeightFields(config, available);
  const measureExpressions = [...measures, ...weights].flatMap(field => [`"${field.id}", ${daxRef(field)}`]);
  const zeroBudgetTarget = sourceParts(INTAKE_ZERO_BUDGET_SOURCE);
  const currentBudgetField = available.find(field => field && field.fieldType === 'measure' && (
    keyOf(field.sourceUniqueName) === keyOf(INTAKE_ZERO_BUDGET_SOURCE)
    || keyOf(field.name) === keyOf(zeroBudgetTarget.name)
    || (keyOf(field.table) === keyOf(zeroBudgetTarget.table) && keyOf(field.name) === keyOf(zeroBudgetTarget.name))
  ));
  const hideZeroBudget = config.display.hideZeroCurrentBudget !== false && Boolean(currentBudgetField);
  // Filtre SUMMARIZECOLUMNS satırında hesaplanan değeri doğrudan okur.
  // CALCULATE([measure]) bazı Tabular modellerde dış filtre bağlamına dönerek
  // grup satırındaki gerçek 0 değerini yeniden hesaplayabildiği için güvenilir değildi.
  const zeroBudgetExpressions = hideZeroBudget
    ? [`"__intake_current_budget", ${daxRef(currentBudgetField)}`]
    : [];
  /* v7.81 — Data Management ufku. Kullanıcının kendi pivot filtreleriyle
     AYNI SUMMARIZECOLUMNS argüman listesine girer; ikisi VE ile birleşir.
     Argüman üretimi model yenilemesiyle ortak (summarizeFilterArgs):
     sezon/tarih optimizasyonları ve grup VEYA semantiği burada da aynı. */
  const horizonArgs = [];
  if (horizon && typeof horizon === 'object' && Object.keys(horizon).length) {
    let horizonFilter;
    try {
      horizonFilter = modelHorizon.buildHorizonFilter(horizon, null, { columnType: intakeColumnTypeIndex(available) });
    } catch (error) {
      throw Object.assign(
        new Error(`INTAKE ufku uygulanamadı: ${error && error.message || error}`),
        { code: 'INTAKE_HORIZON_INVALID', statusCode: 400 },
      );
    }
    modelHorizon.summarizeFilterArgs(horizonFilter, '').forEach(arg => horizonArgs.push(arg));
  }
  const rowLimit = intakeReportRowLimit(maxRows);
  // The report is an aggregate/pivot, never a raw Intake DB dump. Put the cap
  // into DAX as well as the driver so the database does not serialize millions
  // of rows merely for the Node process to discard them afterwards.
  const summarizedTable = `SUMMARIZECOLUMNS(\n    ${[...groupExpressions, ...horizonArgs, ...filterExpressions, ...measureExpressions, ...zeroBudgetExpressions].join(',\n    ')}\n  )`;
  const reportTable = hideZeroBudget
    ? `FILTER(\n    ${summarizedTable},\n    NOT ISBLANK([__intake_current_budget]) && [__intake_current_budget] <> 0\n  )`
    : summarizedTable;
  const query = `EVALUATE\nTOPN(${rowLimit},\n  ${reportTable}\n)`;
  const headerMap = {};
  rows.forEach(field => outputAliases(field).forEach(alias => { headerMap[alias] = field.id; }));
  [...measures, ...weights].forEach(field => { headerMap[field.id] = field.id; });
  return {
    query,
    maxRows: rowLimit,
    headerMap,
    viewConfig: config,
    queryFields: {
      rows: config.query.rows.map(field => field.id),
      columns: config.query.columns.map(field => field.id),
      measures: measures.map(field => field.id),
      filters: config.query.filters.map(field => field.id),
    },
  };
}

/* WAVG özetlemesinin ağırlık measure'ları. Görünümde zaten olan measure tekrar
   istenmez; olmayan, yalnız satır verisinde taşınan gizli bir sütun olur. */
function intakeWeightFields(config, available) {
  const measures = config && config.query && Array.isArray(config.query.measures) ? config.query.measures : [];
  const present = new Set(measures.map(field => sourceKey(field.sourceUniqueName)));
  const pool = Array.isArray(available) && available.length ? available : null;
  const out = [], seen = new Set();
  for (const field of measures) {
    if (field.agg !== 'WAVG' || !field.weightSource) continue;
    const key = sourceKey(field.weightSource);
    if (present.has(key) || seen.has(key)) continue;
    const weight = pool
      ? pool.find(item => item && item.fieldType === 'measure' && sourceKey(item.sourceUniqueName) === key)
      : createField({ sourceUniqueName: field.weightSource, fieldType: 'measure' });
    if (!weight) continue;
    seen.add(key);
    out.push(createField({ ...weight, id: stableFieldId(field.weightSource), agg: 'SUM', weightSource: '' }));
  }
  return out;
}

function normalizeRows(rows, viewConfig) {
  const config = viewConfig || defaultViewConfig();
  const fields = [...config.query.rows, ...config.query.columns, ...config.query.measures, ...intakeWeightFields(config, null)];
  return (Array.isArray(rows) ? rows : []).map(row => {
    const output = {};
    for (const field of fields) {
      const aliases = outputAliases(field);
      const key = aliases.find(candidate => Object.prototype.hasOwnProperty.call(row || {}, candidate));
      output[field.id] = key ? row[key] : '';
    }
    return output;
  });
}

/* Snapshot satırları kaydedildikleri görünümün id'leriyle tutulur. Görünüm
   sonradan farklı id'lerle uzlaştırılmışsa (eski sürüm, şema biçimi değişimi)
   satırlar kaynak adıyla güncel id'lere taşınır; aksi hâlde boyutlar boş görünür. */
function remapRows(rows, fromConfig, toConfig) {
  const list = Array.isArray(rows) ? rows : [];
  if (!fromConfig || !fromConfig.query || !toConfig || !toConfig.query) return list;
  const fieldsOf = config => [
    ...(config.query.rows || []), ...(config.query.columns || []), ...(config.query.measures || []),
    ...intakeWeightFields(config, null),
  ];
  const fromByKey = new Map();
  fieldsOf(fromConfig).forEach(field => { if (field && field.id) fromByKey.set(sourceKey(field.sourceUniqueName), field.id); });
  const moves = fieldsOf(toConfig)
    .map(field => [field.id, fromByKey.get(sourceKey(field.sourceUniqueName))])
    .filter(([to, from]) => to && from && to !== from);
  if (!moves.length) return list;
  return list.map(row => {
    const output = { ...(row || {}) };
    moves.forEach(([to, from]) => {
      if (!Object.prototype.hasOwnProperty.call(output, to) && Object.prototype.hasOwnProperty.call(output, from)) output[to] = output[from];
    });
    return output;
  });
}

function allowedSchema(schema) {
  return normalizeSchema(schema).slice(0, 1000);
}

module.exports = {
  INTAKE_CONNECTION,
  DEFAULT_FILTER_DEFINITIONS,
  DEFAULT_ROW_DEFINITIONS,
  DEFAULT_MEASURE_DEFINITIONS,
  DEFAULT_FIELD_DEFINITIONS,
  INTAKE_REPORT_MAX_ROWS,
  intakeReportRowLimit,
  stableFieldId,
  sourceParts,
  sourceKey,
  createField,
  defaultFields,
  defaultViewConfig,
  normalizeSchema,
  allowedSchema,
  reconcileViewConfig,
  updateDisplayLabel,
  resetView,
  displayLabel,
  daxRef,
  intakeFieldValueType, intakeFilterValues, intakeColumnTypeIndex,
  INTAKE_AGGREGATES, normalizeAggregate,
  buildIntakeQuery,
  normalizeRows,
  remapRows,
  intakeWeightFields,
};
