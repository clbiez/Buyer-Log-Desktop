'use strict';

/* Yol Süreleri › İthalat Yol Süresi Analizi — doğrudan Buyer Log verisinden.
 *
 * Excel yüklemesi gerekmez. İki kapsam vardır:
 *   filtered — Backlog'un kanonik ASAS + IAS veri kümesi (kullanıcının kaynak
 *              ufku ve yetki kapsamı). Ülke eşleşen ASAS siparişinden gelir.
 *   company  — Şirket geneli: IAS (Antrepo) bağlantısı kullanıcı ufku OLMADAN,
 *              yalnız seçilen tarih penceresiyle ayrıca sorgulanır. Ülke IAS'taki
 *              "Ürün Menşei" sütunundan; sütun yoksa eşleşen ASAS siparişinden.
 * Her IAS parsiyeli bir sevkiyattır; taşıt "Vasita Tanim"dan, tarihler IAS
 * satırından gelir. Eşleştirme Backlog ile aynı yoldur (parse.findAntrepoHits).
 * Bu modül normal kaynak yenilemesine dokunmaz: şirket sorgusu bağlantının
 * kopyası üzerinde çalışır ve kalıcı bağlantı ayarı değişmez. */

const parseLib = require('./parse');
const BLTransitAnalysis = require('../../public/transit-analysis');

const TR = { 'İ': 'I', 'I': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S', 'Ç': 'C', 'ç': 'C', 'Ö': 'O', 'ö': 'O', 'Ü': 'U', 'ü': 'U', 'Ğ': 'G', 'ğ': 'G' };
function headerKey(value) {
  const text = String(value == null ? '' : value);
  // Dashboard/Data Model başlıkları "Ithalat.ETA Tarih" gibi tablo önekiyle gelebilir.
  const last = text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text;
  return last.replace(/[İIıŞşÇçÖöÜüĞğ]/g, c => TR[c] || c).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
/* Birebir (normalize) başlık eşleşmesi: "Tahmini Antrepo Giriş Tarihi" asla
   gerçekleşen antrepo girişi sayılmaz. */
const SOURCE_FIELDS = Object.freeze({
  loadingRequest: ['Yükleme Talep Tarih', 'Yükleme Talep Tarihi', 'Loading Request Date'],
  eta: ['ETA Tarih', 'ETA Tarihi', 'ETA Date', 'ETA'],
  actualLoading: ['Fiili Yükleme Tarih', 'Fiili Yükleme Tarihi', 'Actual Loading Date'],
  actualEntry: ['Antrepo Giriş Tarih', 'Antrepo Giriş Tarihi', 'Tema Depo Giriş Tarih', 'Tema Depo Giriş Tarihi', 'Warehouse Entry Date'],
  country: ['Ürün Menşei', 'Urun Mensei', 'Menşei', 'Siparişin Üretildiği Ülke', 'Üretim Ülkesi', 'Country of Origin'],
});
const SOURCE_KEYS = Object.fromEntries(Object.entries(SOURCE_FIELDS).map(([k, list]) => [k, new Set(list.map(headerKey))]));
const ARRIVED_STATUSES = new Set(['DEPODA', 'RETAILE AKTARIM BEKLENIYOR']);
/* Şirket sorgusunda IAS projeksiyonuna ek olarak istenen sütunlar. Kalıcı alan
   eşlemesinde yoksa modelin şemasında aynı adla aranır; bulunamazsa sorguya
   eklenmez (sorgu bozulmaz, yalnız o bilgi eksik kalır). */
const COMPANY_EXTRA_FIELDS = Object.freeze({
  'Ürün Menşei': SOURCE_FIELDS.country,
  'Fiili Yükleme Tarih': SOURCE_FIELDS.actualLoading,
  'Tema Depo Giriş Tarih': ['Tema Depo Giriş Tarih', 'Tema Depo Giriş Tarihi'],
});

function isoDate(value) {
  const d = parseLib.parseDateOnly(value);
  if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function sourceValue(entry, field) {
  const fields = entry && entry._sourceFields;
  if (!fields || typeof fields !== 'object') return null;
  const wanted = SOURCE_KEYS[field];
  for (const [name, value] of Object.entries(fields)) {
    if (value != null && value !== '' && wanted.has(headerKey(name))) return value;
  }
  return null;
}

function shipmentFromEntry(entry, country) {
  const actualEntry = isoDate(sourceValue(entry, 'actualEntry'));
  const arrived = !!actualEntry || ARRIVED_STATUSES.has(parseLib.antrepoStatusKey(entry.statu));
  return {
    country: country || '',
    vehicle: entry.vasita || '',
    qty: Number(entry.loadedQty) || 0,
    arrived,
    loadingRequest: isoDate(sourceValue(entry, 'loadingRequest')),
    handover: isoDate(entry.handover),
    actualLoading: isoDate(sourceValue(entry, 'actualLoading')),
    eta: isoDate(sourceValue(entry, 'eta')),
    // Gerçekleşen giriş sütunu yoksa, antrepoya girmiş parsiyelde IAS'ın
    // "Tahmini Antrepo Giriş Tarihi" son bilinen giriş tarihidir.
    warehouseEntry: actualEntry || (arrived ? isoDate(entry.arr) : ''),
    entryIsActual: !!actualEntry,
  };
}
function entryId(entry) { return entry && entry._sourceRow != null ? `row:${entry._sourceRow}` : null; }

/* filtered: yalnız kapsamdaki ASAS siparişlerine bağlanan parsiyeller. */
function collectShipments(orders, antrepoMap, overrides) {
  const seen = new Set();
  const out = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    for (const entry of parseLib.findAntrepoHits(antrepoMap, order, { rule: overrides })) {
      const id = entryId(entry);
      if (id && seen.has(id)) continue; // aynı IAS satırı birden çok ASAS satırına bağlanırsa bir kez sayılır
      if (id) seen.add(id);
      out.push(shipmentFromEntry(entry, order.countryRaw || sourceValue(entry, 'country') || ''));
    }
  }
  return out;
}

/* company: haritadaki BÜTÜN IAS parsiyelleri. Ülke önce IAS sütunundan; yoksa
   (varsa) eşleşen ASAS siparişinden. */
function collectAllShipments(antrepoMap, orders, overrides) {
  const countryByRow = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || !order.countryRaw) continue;
    for (const entry of parseLib.findAntrepoHits(antrepoMap, order, { rule: overrides })) {
      const id = entryId(entry);
      if (id && !countryByRow.has(id)) countryByRow.set(id, order.countryRaw);
    }
  }
  const out = [];
  for (const entry of Object.values(antrepoMap && typeof antrepoMap === 'object' ? antrepoMap : {})) {
    if (!entry || typeof entry !== 'object' || entry._sourceRow == null) continue;
    const country = sourceValue(entry, 'country') || countryByRow.get(entryId(entry)) || '';
    out.push(shipmentFromEntry(entry, country));
  }
  return out;
}

function findSchemaColumn(schema, aliases, preferTable) {
  const keys = new Set(aliases.map(headerKey));
  const columns = (Array.isArray(schema && schema.columns) ? schema.columns : []).filter(c => c && c.name && keys.has(headerKey(c.name)));
  if (!columns.length) return null;
  const pref = headerKey(preferTable);
  return columns.find(c => headerKey(c.table) === pref)
    || columns.find(c => /ITHALAT|ANTREPO|IAS/.test(headerKey(c.table)))
    || columns[0];
}

/* Şirket geneli IAS sorgusu. Bağlantının KOPYASI kullanılır: ufuk yerine tek
   koşul (Tahmini Antrepo Giriş Tarihi pencere içinde) ve ek sütunlar.
   deps: { discoverSchema, queryConnectionRows, normalizeMappingEntry } */
async function queryCompanyIasRows({ item, matchRule, fromDate, toDate, deps }) {
  if (!item) throw Object.assign(new Error('Aktif bir IAS (Antrepo) veri modeli bağlantısı yok; şirket geneli veri çekilemez.'), { statusCode: 400, code: 'TRANSIT_COMPANY_NO_CONNECTION' });
  if (item.mode === 'manual') throw Object.assign(new Error('IAS bağlantısı manuel DAX sorgusuyla tanımlı; şirket geneli sorgu yalnız otomatik sorgu modunda kurulabilir.'), { statusCode: 400, code: 'TRANSIT_COMPANY_MANUAL_QUERY' });
  const mapping = { ...(item.mapping || {}) };
  const fallbackTable = String(item.horizon && item.horizon.table || '').trim();
  const dateEntry = deps.normalizeMappingEntry(mapping['Tahmini Antrepo Giriş Tarihi'], fallbackTable);
  if (!dateEntry || !dateEntry.name || !dateEntry.table) {
    throw Object.assign(new Error('IAS alan eşlemesinde "Tahmini Antrepo Giriş Tarihi" yok; tarih penceresi uygulanamaz.'), { statusCode: 400, code: 'TRANSIT_COMPANY_DATE_FIELD' });
  }
  const added = [];
  const warnings = [];
  let schema = null;
  try { schema = await deps.discoverSchema({ server: item.server, catalog: item.catalog, timeoutMs: 120000 }); }
  catch (err) { warnings.push(`Model şeması okunamadı; ek sütunlar (Ürün Menşei vb.) eklenmedi: ${err.message}`); }
  for (const [header, aliases] of Object.entries(COMPANY_EXTRA_FIELDS)) {
    if (mapping[header]) continue;
    const hit = schema && findSchemaColumn(schema, aliases, dateEntry.table);
    if (hit) { mapping[header] = { table: hit.table, name: hit.name, kind: 'column' }; added.push(header); }
  }
  const conditions = [];
  if (fromDate || toDate) {
    conditions.push({
      table: dateEntry.table, field: dateEntry.name, name: dateEntry.name, valueType: 'date',
      op: fromDate && toDate ? 'between' : (fromDate ? 'gte' : 'lte'), from: fromDate || '', to: toDate || '',
    });
  } else {
    // "Tüm tarihler" bile sınırsız tablo çekmez: boş olmayan giriş tarihleri.
    conditions.push({ table: dateEntry.table, field: dateEntry.name, name: dateEntry.name, valueType: 'date', op: 'notEmpty' });
  }
  const clone = {
    ...item,
    mapping,
    horizon: { table: (item.horizon && item.horizon.table) || dateEntry.table, groups: [{ id: 'transit-window', conditions }] },
    cpColumns: [],
    _scopeTargets: ['backlog'],
  };
  const run = await deps.queryConnectionRows(clone, { matchRule, queryOptions: {} });
  return { rows: Array.isArray(run && run.rows) ? run.rows : [], addedFields: added, warnings };
}

function buildLiveAnalysis({ orders, antrepoMap, overrides, today, sourceLabel, window, scope } = {}) {
  const todayIso = today || new Date().toISOString().slice(0, 10);
  const range = BLTransitAnalysis.windowRange(window || 'all', todayIso);
  const shipments = scope === 'company'
    ? collectAllShipments(antrepoMap, orders, overrides)
    : collectShipments(orders, antrepoMap, overrides);
  const analysis = BLTransitAnalysis.buildFromShipments(shipments, {
    today: todayIso, sourceLabel: sourceLabel || 'Buyer Log IAS (Antrepo) parsiyelleri', generatedAt: new Date().toISOString(),
    fromDate: range.from, toDate: range.to, granularity: range.granularity, window: range.key,
    scope: scope === 'company' ? 'company' : 'filtered',
  });
  analysis.columns = {
    loadingRequest: shipments.some(s => s.loadingRequest),
    eta: shipments.some(s => s.eta),
    handover: shipments.some(s => s.handover),
    actualLoading: shipments.some(s => s.actualLoading),
    actualEntry: shipments.some(s => s.entryIsActual),
  };
  return analysis;
}

module.exports = {
  SOURCE_FIELDS, COMPANY_EXTRA_FIELDS, headerKey, findSchemaColumn,
  collectShipments, collectAllShipments, queryCompanyIasRows, buildLiveAnalysis,
};
