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
  // Global Lojistik raporunun Yol/Gümrük sınırı (Özet Beyan Onay Tarihi).
  summaryDeclaration: ['Özet Beyan Onay Tarih', 'Özet Beyan Onay Tarihi', 'Özet Beyan Tarih', 'Özet Beyan Tarihi', 'Summary Declaration Date'],
  // Rapor yalnız "Final Destination = Antrepo" sevkiyatlarını kapsar.
  finalDestination: ['Final Destination', 'Final Destinasyon', 'Nihai Varış Yeri'],
  // Rapor alt süreç adımlarının (1.2, 2, 3, 4.1, 6, 7, 8) gerçekleşen tarihleri.
  importApproval: ['Yükleme İthalat Onay Tarih', 'Yükleme İthalat Onay Tarihi', 'İthalat Yükleme Onay Tarihi'],
  cutOff: ['Cut Off Tarih', 'Cut Off Tarihi', 'CutOff Tarih', 'CutOff Tarihi'],
  documentDelivery: ['Evrak Teslim Tarih', 'Evrak Teslim Tarihi', 'Gümrük Müşavirine Evrak Teslim Tarihi'],
  warehouseApproval: ['Ambar Onay Tarih', 'Ambar Onay Tarihi'],
  transitDeclaration: ['Transit Beyanname Tarih', 'Transit Beyanname Tarihi', 'Transit Beyanname Tescil Tarihi'],
});
const SOURCE_KEYS = Object.fromEntries(Object.entries(SOURCE_FIELDS).map(([k, list]) => [k, new Set(list.map(headerKey))]));
/* Şirket sorgusunda IAS projeksiyonuna ek olarak istenen sütunlar. Kalıcı alan
   eşlemesinde yoksa modelin şemasında aynı adla aranır; bulunamazsa sorguya
   eklenmez (sorgu bozulmaz, yalnız o bilgi eksik kalır). */
const COMPANY_EXTRA_FIELDS = Object.freeze({
  'Ürün Menşei': SOURCE_FIELDS.country,
  'Fiili Yükleme Tarih': SOURCE_FIELDS.actualLoading,
  // Gerçekleşen giriş: önce antrepo, yoksa Tema depo. Tahmini Antrepo Giriş
  // Tarihi'ne zaten eşlenmiş fiziksel sütun bu adaylardan dışlanır.
  'Antrepo Giriş Tarih': ['Antrepo Giriş Tarih', 'Antrepo Giriş Tarihi'],
  'Tema Depo Giriş Tarih': ['Tema Depo Giriş Tarih', 'Tema Depo Giriş Tarihi'],
  'Özet Beyan Onay Tarih': SOURCE_FIELDS.summaryDeclaration,
  'Final Destination': SOURCE_FIELDS.finalDestination,
  'Cut Off Tarih': SOURCE_FIELDS.cutOff,
  'Evrak Teslim Tarih': SOURCE_FIELDS.documentDelivery,
  'Ambar Onay Tarih': SOURCE_FIELDS.warehouseApproval,
  'Transit Beyanname Tarih': SOURCE_FIELDS.transitDeclaration,
  'Yükleme İthalat Onay Tarih': SOURCE_FIELDS.importApproval,
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

/* Yalnız GERÇEKLEŞEN veri: antrepo girişi gerçekleşen Antrepo/Tema Depo Giriş
   tarihidir. "Tahmini Antrepo Giriş Tarihi" ve statüye dayalı tahmin hiç
   kullanılmaz; gerçekleşen girişi olmayan parsiyel henüz girmemiş sayılır. */
function shipmentFromEntry(entry, country) {
  const actualEntry = isoDate(sourceValue(entry, 'actualEntry'));
  const date = field => isoDate(sourceValue(entry, field));
  return {
    country: country || '',
    vehicle: entry.vasita || '',
    qty: Number(entry.loadedQty) || 0,
    arrived: !!actualEntry,
    loadingRequest: date('loadingRequest'),
    importApproval: date('importApproval'),
    handover: isoDate(entry.handover),
    cutOff: date('cutOff'),
    actualLoading: date('actualLoading'),
    eta: date('eta'),
    documentDelivery: date('documentDelivery'),
    summaryDeclaration: date('summaryDeclaration'),
    warehouseApproval: date('warehouseApproval'),
    transitDeclaration: date('transitDeclaration'),
    finalDestination: String(sourceValue(entry, 'finalDestination') || '').trim(),
    warehouseEntry: actualEntry,
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

function findSchemaColumn(schema, aliases, preferTable, taken) {
  const keys = new Set(aliases.map(headerKey));
  const used = taken instanceof Set ? taken : new Set();
  const columns = (Array.isArray(schema && schema.columns) ? schema.columns : [])
    .filter(c => c && c.name && keys.has(headerKey(c.name)) && !used.has(`${headerKey(c.table)}|${headerKey(c.name)}`));
  if (!columns.length) return null;
  const pref = headerKey(preferTable);
  return columns.find(c => headerKey(c.table) === pref)
    || columns.find(c => /ITHALAT|ANTREPO|IAS/.test(headerKey(c.table)))
    || columns[0];
}

/* Şirket geneli IAS sorgusu. Bağlantının KOPYASI kullanılır: ufuk yerine tek
   koşul (Tahmini Antrepo Giriş Tarihi pencere içinde) ve ek sütunlar.
   deps: { discoverSchema, queryConnectionRows, normalizeMappingEntry } */
/* Normal yenilemenin IAS sorgusu kapsam (scope) ufkuyla kurulur; bağlantının
   kök horizon'u çoğu kurulumda boştur. Şirket sorgusu aynı kapsamın ufkunu
   (sorgu tablosu dahil) temel alır, yalnız filtre koşulunu tarih penceresiyle
   değiştirir. Aksi halde ufuk tablosu fact tablosu sanılıp parsiyel satır
   tablosu (grain) adaylarından dışlanıyor ve sorgu yanlış tablodan kuruluyordu. */
function baseHorizonForCompany(item) {
  const scopes = (Array.isArray(item && item.scopes) ? item.scopes : []).filter(scope => scope && scope.enabled !== false);
  for (const target of ['backlog', 'cp', 'orders']) {
    const hit = scopes.find(scope => Array.isArray(scope.targets) && scope.targets.includes(target));
    if (hit && hit.horizon) return hit.horizon;
  }
  return (scopes[0] && scopes[0].horizon) || (item && item.horizon) || {};
}

function companyQueryError(err, stage) {
  const raw = String(err && (err.publicMessage || err.message) || err || '').trim();
  const error = new Error(raw || 'IAS sorgusu başarısız.');
  error.code = (err && err.code) || 'TRANSIT_COMPANY_QUERY_FAILED';
  error.statusCode = err && err.statusCode && err.statusCode < 500 ? err.statusCode : 502;
  error.stage = stage;
  error.detail = raw;
  return error;
}

/* Şirket geneli IAS sorgusu. Bağlantının KOPYASI kullanılır: kapsam ufku +
   tek koşul (Tahmini Antrepo Giriş Tarihi pencere içinde) ve ek sütunlar.
   Ek sütunlarla sorgu başarısız olursa bir kez ek sütunsuz denenir.
   deps: { discoverSchema, queryConnectionRows, normalizeMappingEntry } */
async function queryCompanyIasRows({ item, matchRule, fromDate, toDate, deps }) {
  if (!item) throw Object.assign(new Error('Aktif bir IAS (Antrepo) veri modeli bağlantısı yok; şirket geneli veri çekilemez.'), { statusCode: 400, code: 'TRANSIT_COMPANY_NO_CONNECTION' });
  if (item.mode === 'manual') throw Object.assign(new Error('IAS bağlantısı manuel DAX sorgusuyla tanımlı; şirket geneli sorgu yalnız otomatik sorgu modunda kurulabilir.'), { statusCode: 400, code: 'TRANSIT_COMPANY_MANUAL_QUERY' });
  const baseHorizon = baseHorizonForCompany(item);
  const fallbackTable = String(baseHorizon.table || (item.horizon && item.horizon.table) || '').trim();
  const baseMapping = { ...(item.mapping || {}) };
  const dateEntry = deps.normalizeMappingEntry(baseMapping['Tahmini Antrepo Giriş Tarihi'], fallbackTable);
  if (!dateEntry || !dateEntry.name || !dateEntry.table) {
    throw Object.assign(new Error('IAS alan eşlemesinde "Tahmini Antrepo Giriş Tarihi" tablo/sütun bilgisi yok; tarih penceresi uygulanamaz.'), { statusCode: 400, code: 'TRANSIT_COMPANY_DATE_FIELD' });
  }
  const added = [];
  const warnings = [];
  const extraMapping = {};
  let schema = null;
  try { schema = await deps.discoverSchema({ server: item.server, catalog: item.catalog, timeoutMs: 120000 }); }
  catch (err) { warnings.push(`Model şeması okunamadı; ek sütunlar (Ürün Menşei vb.) eklenmedi: ${err.message}`); }
  // Zaten eşlenmiş fiziksel sütunlar (ör. Tahmini Antrepo Giriş = 'Antrepo Giriş
  // Tarihi') ek alan olarak ikinci kez seçilmez.
  const taken = new Set(Object.values(baseMapping).map(v => deps.normalizeMappingEntry(v, fallbackTable))
    .filter(e => e && e.name).map(e => `${headerKey(e.table)}|${headerKey(e.name)}`));
  for (const [header, aliases] of Object.entries(COMPANY_EXTRA_FIELDS)) {
    if (baseMapping[header]) continue;
    const hit = schema && findSchemaColumn(schema, aliases, dateEntry.table, taken);
    if (hit) {
      extraMapping[header] = { table: hit.table, name: hit.name, kind: 'column' };
      taken.add(`${headerKey(hit.table)}|${headerKey(hit.name)}`);
      added.push(header);
    }
  }
  const condition = fromDate || toDate
    ? { table: dateEntry.table, field: dateEntry.name, name: dateEntry.name, valueType: 'date',
      op: fromDate && toDate ? 'between' : (fromDate ? 'gte' : 'lte'), from: fromDate || '', to: toDate || '' }
    // "Tüm tarihler" bile sınırsız tablo çekmez: boş olmayan giriş tarihleri.
    : { table: dateEntry.table, field: dateEntry.name, name: dateEntry.name, valueType: 'date', op: 'notEmpty' };
  // Satır (parsiyel) tablosu, normal yenilemenin bu kapsamla seçeceği tablodur.
  const grainTable = deps.antrepoGrainTable
    ? deps.antrepoGrainTable(baseMapping, fallbackTable, String(baseHorizon.table || '').trim())
    : '';
  const build = withExtras => {
    const clone = {
      ...item,
      mapping: withExtras ? { ...baseMapping, ...extraMapping } : { ...baseMapping },
      // Filtre tarih sütununun tablosunda çalışır (DAX FILTER satır bağlamı);
      // kullanıcı/sezon koşulları yerine yalnız tarih penceresi uygulanır.
      horizon: { ...baseHorizon, table: dateEntry.table, seasons: [], dateStart: '', dateEnd: '', extraExpression: '', groups: [{ id: 'transit-window', conditions: [condition] }] },
      cpColumns: [],
      _scopeTargets: ['backlog'],
      _grainTable: grainTable || dateEntry.table,
    };
    delete clone.scopes;
    return clone;
  };
  /* Bu ufuktaki tarih koşulu kullanıcı filtresi değil, Buyer Log'un bu modül
     için ürettiği kanonik tarih penceresidir. Bazı IAS/SSAS modellerinde
     MDSCHEMA_LEVELS tarih hiyerarşisini WSTR (text) olarak raporlarken DAX
     sütunun gerçek tipini Date olarak görür. Genel şema çözücüsünün
     valueType:'date' değerini 'text' ile ezmesine izin verilirse DAX
     Date >= "YYYY-MM-DD" üretir ve "Date vs Text" hatasıyla düşer.
     Bu nedenle yalnız bu izole sorguda tip metadata override'ını kapatıyoruz;
     modül ufku DATE(...) literalini kullanır. Kalıcı bağlantı/Backlog ufku
     bundan etkilenmez. */
  const moduleQueryOptions = { matchRule, queryOptions: {}, columnType: false };
  let run;
  try {
    run = await deps.queryConnectionRows(build(added.length > 0), moduleQueryOptions);
  } catch (err) {
    if (!added.length) throw companyQueryError(err, 'query');
    warnings.push(`Ek sütunlarla (${added.join(', ')}) IAS sorgusu başarısız oldu, ek sütunsuz yeniden denendi: ${String(err && err.message || err)}`);
    added.length = 0;
    try { run = await deps.queryConnectionRows(build(false), moduleQueryOptions); }
    catch (retryErr) { throw companyQueryError(retryErr, 'query-retry'); }
  }
  return { rows: Array.isArray(run && run.rows) ? run.rows : [], addedFields: added, warnings };
}

/* Rapor filtresi: Final Destination sütunu varsa yalnız Antrepo rotalı
   sevkiyatlar kalır (raporun "Final Destination = Antrepo" filtresi). */
function applyReportRules(shipments) {
  const hasActualEntry = shipments.some(s => s.entryIsActual);
  const hasDestination = shipments.some(s => s.finalDestination);
  for (const s of shipments) {
    if (hasDestination && !/ANTREPO/.test(headerKey(s.finalDestination))) s.otherDestination = true;
  }
  return { hasActualEntry, hasDestination };
}

function buildLiveAnalysis({ orders, antrepoMap, overrides, today, sourceLabel, window, scope, weighting } = {}) {
  const todayIso = today || new Date().toISOString().slice(0, 10);
  const range = BLTransitAnalysis.windowRange(window || 'all', todayIso);
  const shipments = scope === 'company'
    ? collectAllShipments(antrepoMap, orders, overrides)
    : collectShipments(orders, antrepoMap, overrides);
  const rules = applyReportRules(shipments);
  const analysis = BLTransitAnalysis.buildFromShipments(shipments, {
    today: todayIso, sourceLabel: sourceLabel || 'Buyer Log IAS (Antrepo) parsiyelleri', generatedAt: new Date().toISOString(),
    fromDate: range.from, toDate: range.to, granularity: range.granularity, window: range.key,
    scope: scope === 'company' ? 'company' : 'filtered',
    weighting: weighting === 'qty' ? 'qty' : 'shipment',
  });
  analysis.columns = {
    loadingRequest: shipments.some(s => s.loadingRequest),
    eta: shipments.some(s => s.eta),
    handover: shipments.some(s => s.handover),
    actualLoading: shipments.some(s => s.actualLoading),
    actualEntry: rules.hasActualEntry,
    summaryDeclaration: shipments.some(s => s.summaryDeclaration),
    cutOff: shipments.some(s => s.cutOff),
    finalDestination: rules.hasDestination,
  };
  return analysis;
}

module.exports = {
  SOURCE_FIELDS, COMPANY_EXTRA_FIELDS, headerKey, findSchemaColumn,
  collectShipments, collectAllShipments, applyReportRules, baseHorizonForCompany, queryCompanyIasRows, buildLiveAnalysis,
};
