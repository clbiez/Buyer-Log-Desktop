'use strict';

const fs = require('fs');
const path = require('path');

const POWER_BI_IMPORT_DASHBOARD_URL = 'https://app.powerbi.com/groups/ca740242-a627-4184-8e34-019fa7a1f858/reports/e915b9dc-113f-489a-a704-fa08f1c9d084/ReportSection5b5282603c26818c0dad?experience=power-bi';
const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 500;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;
/* Tekrar denemenin ve parti bölmenin FAYDASIZ olduğu hatalar. Bunlar istek
   ne kadar küçültülürse küçültülsün aynı yanıtı verir; "geçici arıza" gibi
   davranmak yalnız kullanıcıyı dakikalarca bekletir. */
const PERMANENT_DASHBOARD_ERRORS = [
  'POWERBI_DASHBOARD_ORDER_FIELD_MISSING',
  'POWERBI_DASHBOARD_SCHEMA_INVALID',
  'POWERBI_DASHBOARD_SCHEMA_MISSING',
  'POWERBI_DASHBOARD_QUERY_REJECTED', // HTTP 4xx — istek geçersiz
  'POWERBI_AUTH_REQUIRED',            // oturum düştü; her parti aynı hatayı alır
];

class PowerBiDashboardError extends Error {
  constructor(message, code = 'POWERBI_DASHBOARD_FAILED', statusCode = 502, details = {}) {
    super(message);
    this.name = 'PowerBiDashboardError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function key(value) {
  return clean(value).toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function findDescriptor(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return null;
  if (value.descriptor && Array.isArray(value.descriptor.Select)) return value.descriptor;
  if (value.Descriptor && Array.isArray(value.Descriptor.Select)) return value.Descriptor;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findDescriptor(item, depth + 1); if (found) return found; }
    return null;
  }
  for (const item of Object.values(value)) { const found = findDescriptor(item, depth + 1); if (found) return found; }
  return null;
}

function descriptorSelectNames(descriptor) {
  return (descriptor && Array.isArray(descriptor.Select) ? descriptor.Select : []).map((column, index) => {
    if (typeof column === 'string') return column;
    const name = column && (column.Name || column.QueryName || column.DisplayName || column.Property);
    return clean(name) || `Column ${index + 1}`;
  });
}

/* Descriptor girdisinin "Value" alanı, o kolonun DSR YUVA ADIDIR (G0, M1…).
   Satır hücreleri descriptor sırasını DEĞİL yuva sırasını izler, bu yüzden
   ad çözümü bu harita üzerinden yapılmalıdır. Canlı yanıttan ÖLÇÜLDÜ:

     descriptor[20] = "Ithalat.Yükleme Toplam Adet", Value: "M1"
     → gerçek hücresi 36. sırada (S[36].N === "M1")

   Descriptor'da gruplama kolonları önce, ölçümler sonda listeleniyor; hücre
   dizisi ise G0..G34, M0..M2 sırasında geliyor. İkisini konumsal eşleştirmek
   "Yükleme Toplam Adet" alanına bir tarih/başka kolon değeri düşürüyordu. */
function descriptorSlotNames(descriptor) {
  const map = Object.create(null);
  const select = descriptor && Array.isArray(descriptor.Select) ? descriptor.Select : [];
  select.forEach((column, index) => {
    if (!column || typeof column !== 'object') return;
    const slot = clean(column.Value);
    if (!slot) return;
    map[slot] = clean(column.Name || column.QueryName || column.DisplayName || column.Property) || `Column ${index + 1}`;
  });
  return map;
}

function descriptorColumns(payload) {
  const descriptor = findDescriptor(payload);
  if (descriptor) return descriptorSelectNames(descriptor);
  return semanticQueryColumns(payload);
}

// Power BI'nin görsel yanıtı yalnızca o görselin dönen kolonlarını descriptor
// içinde taşır. Refresh sırasında yakalanan querydata isteği ise semantic
// Query.Select altında dashboard'un gerçekten sorguladığı alanları taşır.
// Şema keşfi her iki biçimi de okumalıdır; aksi hâlde sayfada bulunan ancak
// aktif görsel yanıtında yer almayan IAS alanları yanlışlıkla eksik sayılır.
function semanticQueryColumns(payload) {
  const columns = [], seen = new Set();
  const add = value => {
    const name = clean(value);
    if (!name || seen.has(name)) return;
    seen.add(name); columns.push(name);
  };
  const visit = (value, depth = 0) => {
    if (depth > 16 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (Array.isArray(value.Select)) {
      value.Select.forEach(column => {
        if (typeof column === 'string') return add(column);
        const nested = column && column.Column;
        [column && column.Name, column && column.QueryName, column && column.DisplayName,
          column && column.Property, nested && nested.Property, nested && nested.Name,
          nested && nested.QueryName].forEach(add);
      });
    }
    Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(payload);
  return columns;
}

/* Her veri bloğu, KENDİ descriptor'ıyla eşleştirilir.

   Neden gerekli (canlı istekten ÖLÇÜLDÜ): Antrepo'nun kullandığı büyük tablo
   sorgusunun gövdesinde ÜÇ ayrı Select düğümü var, yani tek bir querydata
   isteği ÜÇ sonuç kümesi döndürüyor ve her birinin kendi descriptor'ı oluyor.
   Eski kod findDescriptor ile yalnız İLK descriptor'ı alıp bütün veri
   bloklarına uyguluyordu; büyük tablonun satırları başka bir görselin kolon
   adlarıyla etiketleniyor, "Sipariş Kod" hiçbir satırda görünmüyordu.

   valueDicts için zaten var olan "en yakın atadan miras alma" düzeni burada
   descriptor için de uygulanır. */
function collectDataSegments(value, output = [], depth = 0, inheritedDicts = null, inheritedDescriptor = null) {
  if (depth > 14 || value == null || typeof value !== 'object') return output;
  const ownDicts = value.valueDicts || value.ValueDicts || inheritedDicts;
  const own = value.descriptor || value.Descriptor;
  const ownDescriptor = own && Array.isArray(own.Select) ? own : inheritedDescriptor;
  if (Array.isArray(value)) { value.forEach(item => collectDataSegments(item, output, depth + 1, ownDicts, ownDescriptor)); return output; }
  for (const [name, child] of Object.entries(value)) {
    if ((name === 'DM0' || name === 'DM1') && Array.isArray(child)) output.push({ rows: child, parent: value, valueDicts: ownDicts || {}, descriptor: ownDescriptor });
    else collectDataSegments(child, output, depth + 1, ownDicts, ownDescriptor);
  }
  return output;
}

function dictionaryFor(valueDicts, columnName, index) {
  if (!valueDicts || typeof valueDicts !== 'object') return null;
  const names = [String(index), columnName, key(columnName)].filter(Boolean);
  for (const name of names) {
    const dictionary = valueDicts[name] || valueDicts[name.toLowerCase()];
    if (Array.isArray(dictionary)) return dictionary;
    if (dictionary && typeof dictionary === 'object') {
      if (Array.isArray(dictionary.Values)) return dictionary.Values;
      if (Array.isArray(dictionary.values)) return dictionary.values;
    }
  }
  return null;
}

function dictionaryValue(cell, dictionary) {
  if (!dictionary) return cell;
  if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'D')) {
    const index = Number(cell.D);
    return Number.isInteger(index) && index >= 0 ? dictionary[index] : null;
  }
  if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'Value')) return cell.Value;
  if (typeof cell === 'number' && dictionary[cell] !== undefined) return dictionary[cell];
  return cell;
}

/* DSR'de null (Ø) ve tekrar (R) maskeleri bit alanıdır. JS'in bitsel &
   operatörü işlenenleri 32 BİT işaretli tamsayıya çevirir; index >= 32 için
   maske sıfırlanır ve bit HİÇ okunamaz. Eski kod "index < 53" yazarak 53 bit
   desteklediğini sanıyordu ama 32'de kesiliyordu.

   Sonucu şuydu: 38 kolonlu Antrepo tablosunda 32-37 arası kolonların null /
   tekrar bitleri görülmüyor, hücre imleci kayıyor ve sonraki değerler yanlış
   kolona yazılıyordu. Ölçümler (Net Alım Sipariş Miktarı, Yükleme Toplam
   Adet, Kap Adet) tam da son üç kolon olduğu için "Yükleme Toplam Adet"
   alanına bir TARİH hücresi (epoch ms) düşüyor ve 1000 yerine milyarlar
   görünüyordu. BigInt ile bit güvenle okunur. */
function bitmapHas(bitmap, index) {
  if (bitmap == null) return false;
  if (!Number.isInteger(index) || index < 0 || index > 63) return false;
  const number = Number(bitmap);
  if (!Number.isFinite(number) || number < 0) return false;
  try { return ((BigInt(Math.trunc(number)) >> BigInt(index)) & 1n) === 1n; }
  catch (_) { return false; }
}

/* Bir satırın "S" dizisi, o sonuç kümesinin KOLON ŞEMASIDIR (ara toplam
   işareti değil). Canlı yanıttan ÖLÇÜLEN gerçek biçim:

     "S":[ {"DN":"D0","N":"G0","T":1},      ← kolon 0, sözlük D0
           ...
           {"N":"G19","T":7},               ← DN yok → ham değer (tarih ms)
           {"N":"M0","T":4} ]               ← ölçüm, sayısal

   Yani kolonun sözlüğü S[i].DN ile bildiriliyor; ValueDicts de bu adlarla
   (D0..D20) anahtarlanıyor. Eski kod sözlüğü kolon ADI veya İNDİSİ ile
   arıyordu, hiçbiri tutmuyordu ve çözülemeyen hücrelerde ham indis kalıyordu
   — Antrepo eşleşmesinde ["0","0","0"] / ["1","1","1"] gibi anahtarların
   sebebi buydu.

   DSR şemayı yalnız ilk veri satırında gönderir, sonrakiler onu yeniden
   kullanır; bu yüzden en son görülen S saklanır. */
function slotDictionaryName(schema, index) {
  const slot = Array.isArray(schema) ? schema[index] : null;
  return slot && typeof slot === 'object' && slot.DN ? String(slot.DN) : '';
}

// Yalnız ölçüm yuvası taşıyan (hiç gruplama kolonu olmayan) satır genel
// toplamdır. "S var" demek ara toplam demek DEĞİLDİR.
function isAggregateOnlyRow(schema) {
  if (!Array.isArray(schema) || !schema.length) return false;
  return schema.every(slot => !(slot && typeof slot === 'object' && /^G/.test(String(slot.N || ''))));
}

function decodeSegmentRows(segment, columns, valueDicts, previousRows, slotNames) {
  const output = [];
  let previous = previousRows.length ? previousRows[previousRows.length - 1] : null;
  let schema = null;
  for (const encoded of segment.rows || []) {
    if (Array.isArray(encoded)) {
      const row = Object.fromEntries(columns.map((name, index) => [name, encoded[index] === undefined ? null : encoded[index]]));
      output.push(row); previous = row; continue;
    }
    if (!encoded || typeof encoded !== 'object') continue;
    const ownSchema = Array.isArray(encoded.S) ? encoded.S : null;
    // Genel toplam satırının şeması kolon şeması değildir; saklanmaz.
    if (ownSchema && !isAggregateOnlyRow(ownSchema)) schema = ownSchema;
    const cells = Array.isArray(encoded.C) ? encoded.C : [];
    const repeat = Number(encoded.R) || 0;
    let cursor = 0;
    const row = {};
    /* Hücre sırası yuva (S) sırasıdır; kolon adı yuva adından çözülür.
       Şema ya da yuva haritası yoksa eski konumsal davranışa düşülür — basit
       payload'lar ve mevcut sınamalar böyle çalışmaya devam eder. */
    const effective = (schema && slotNames)
      ? schema.map((slot, position) => slotNames[clean(slot && slot.N)] || columns[position])
      : columns;
    effective.forEach((name, index) => {
      if (bitmapHas(encoded['Ø'], index)) { row[name] = null; return; }
      // Tekrar maskesi de aynı 32 bit tuzağına düşüyordu; aynı güvenli okuma.
      if (repeat && bitmapHas(repeat, index) && previous) { row[name] = previous[name]; return; }
      const cell = cells[cursor++];
      const dictName = slotDictionaryName(schema, index);
      const dictionary = dictName
        ? (valueDicts && valueDicts[dictName]) || null
        : dictionaryFor(valueDicts, name, index);
      row[name] = dictionaryValue(cell === undefined ? null : cell, dictionary);
    });
    if (isAggregateOnlyRow(ownSchema)) row.__isSubtotal = true;
    output.push(row); previous = row;
  }
  return output;
}

/** Decode the compressed table payload returned by Power BI querydata. */
function decodePowerBiResponse(payload) {
  const fallbackColumns = descriptorColumns(payload);
  if (!fallbackColumns.length) throw new PowerBiDashboardError('Power BI yanıtında sütun tanımı bulunamadı.', 'POWERBI_DASHBOARD_DESCRIPTOR_MISSING', 502);
  const segments = collectDataSegments(payload);
  if (!segments.length) return [];
  /* Aynı descriptor'a ait bloklar bir arada çözülür: R (repeat) bit maskesi
     "önceki satır"a atıf yapar ve bu atıf yalnız AYNI şekle sahip bloklar
     arasında anlamlıdır. Farklı sonuç kümelerinin satırlarını tek bir
     "önceki" zincirine bağlamak değerleri birbirine karıştırırdı. */
  const groups = new Map();
  for (const segment of segments) {
    const descriptor = segment.descriptor || null;
    if (!groups.has(descriptor)) groups.set(descriptor, []);
    groups.get(descriptor).push(segment);
  }
  const output = [];
  for (const [descriptor, groupSegments] of groups) {
    const columns = descriptor ? descriptorSelectNames(descriptor) : fallbackColumns;
    if (!columns.length) continue;
    // Yuva adı -> kolon adı haritası (bkz. descriptorSlotNames).
    const slotNames = descriptor ? descriptorSlotNames(descriptor) : null;
    const groupRows = [];
    for (const segment of groupSegments) {
      const valueDicts = segment.valueDicts || segment.parent.valueDicts || segment.parent.ValueDicts || {};
      groupRows.push(...decodeSegmentRows(segment, columns, valueDicts, groupRows, slotNames));
    }
    output.push(...groupRows);
  }
  return output;
}

const FIELD_ALIASES = {
  orderCode: ['Sipariş Kod', 'Sipariş Kodu', 'Siparis Bilgileri.Sipariş Kod', 'Siparis Bilgileri.Siparis Kod', 'Order Code', 'OrderCode', 'PO'],
  modelName: ['Model Adı', 'Model Adı / Ürün Adı', 'Ürün Adı', 'Ürün Ad', 'Ithalat.Model Adı', 'Product Name', 'Model Name', 'Style Name', 'Model'],
  colourCode: ['Renk Kod', 'Renk Kodu', 'Ithalat.Renk Kod', 'Colour Code', 'Color Code', 'ColourCode', 'ColorCode'],
  colour: ['Renk Tanım', 'Renk Tanımı', 'Renk', 'Colour', 'Color', 'Colour Description', 'Color Description'],
  importFileNo: ['İthalat Dosya No', 'Ithalat Dosya No', 'Dim_Ithalat.İthalat Dosya No', 'Import File No', 'Import File Number', 'Dosya No'],
  containerNo: ['Konteyner No', 'Ithalat.Konteyner No', 'Container No', 'Container Number'],
  supplierPortalStatus: ['Supplier Portal Statü', 'Ithalat.Supplier Portal Statü', 'Supplier Portal Status', 'Status'],
  supplierPortalStatusDetail: ['Supplier Portal Statü Detay', 'Ithalat.Supplier Portal Statü Detay', 'Supplier Portal Status Detail', 'Status Detail'],
  warehouseStatus: ['Antrepo / Depo Statü', 'Antrepo Depo Statü', 'Ithalat.Antrepo / Depo Statü', 'Warehouse Status', 'Depot Status'],
  warehouseCompany: ['Antrepo Firma', 'Dim_Ithalat.Antrepo Firma', 'Warehouse Company', 'Bonded Warehouse Company'],
  etd: ['Yükleme Talep Tarih', 'Ithalat.Yükleme Talep Tarih', 'Loading Request Date', 'ETD'],
  eta: ['ETA Tarih', 'Ithalat.ETA Tarih', 'ETA Date', 'ETA'],
  estimatedWarehouseEntry: ['Tahmini Antrepo Giriş Tarihi', 'Ithalat.Tahmini Antrepo Giriş Tarihi', 'Estimated Warehouse Entry', 'Estimated Arrival'],
  estimatedDepotEntry: ['Tahmini Depo Giriş Tarihi', 'Ithalat.Tahmini Depo Giriş Tarihi', 'Estimated Depot Entry'],
  handover: ['HANDOVER Tarihi', 'Handover Date', 'HANDOVER'],
  vehicle: ['Vasita Tanim', 'Vasıta Tanım', 'Vehicle', 'Delivery Type'],
  loadedQuantity: ['Yükleme Toplam Adet', 'Ithalat.Yükleme Toplam Adet', 'Loaded Quantity', 'Loading Total Quantity', 'Shipment Quantity'],
  season: ['Sezon', 'Season'],
  mag: ['Merch Alt Grup Kod', 'MAG'],
  mmyg: ['Merch Marka Yaş Grup Kod', 'MMYG'],
  directorate: ['Marka Müdürlükleri', 'Brand Directorate', 'Brand Directorates'],
};

// Dashboard görselinde fiziksel renk kodu yoktur. Bu alias listesi yalnız
// Dashboard şema doğrulaması ve adapter'ı içindir; Database/Excel tarafındaki
// mevcut "Renk Kod" sözleşmesini değiştirmez.
const DASHBOARD_COLOUR_ALIASES = [
  'Siparis Bilgileri.Renk Tanım', 'Siparis Bilgileri.Renk Tanımı',
  'Renk Tanım', 'Renk Tanımı', 'Colour Description', 'Color Description',
];
const DASHBOARD_REQUIRED_FIELDS = new Set([
  'orderCode', 'modelName', 'colour', 'importFileNo', 'supplierPortalStatus',
  'estimatedWarehouseEntry', 'loadedQuantity',
]);

const CANONICAL_FIELDS = {
  orderCode: 'Sipariş Kod', modelName: 'Model Adı', colourCode: 'Renk Kod', colour: 'Renk Tanım',
  importFileNo: 'İthalat Dosya No', containerNo: 'Konteyner No', supplierPortalStatus: 'Supplier Portal Statü',
  supplierPortalStatusDetail: 'Supplier Portal Statü Detay', warehouseStatus: 'Antrepo / Depo Statü',
  warehouseCompany: 'Antrepo Firma', etd: 'Yükleme Talep Tarih', eta: 'ETA Tarih',
  estimatedWarehouseEntry: 'Tahmini Antrepo Giriş Tarihi', estimatedDepotEntry: 'Tahmini Depo Giriş Tarihi',
  handover: 'HANDOVER Tarihi', vehicle: 'Vasita Tanim', loadedQuantity: 'Yükleme Toplam Adet',
  season: 'Sezon', mag: 'Merch Alt Grup Kod', mmyg: 'Merch Marka Yaş Grup Kod', directorate: 'Marka Müdürlükleri',
};

const DASHBOARD_FIELD_MAPPING = Object.entries(CANONICAL_FIELDS).map(([field, buyerLogField]) => ({
  buyerLogField,
  existingSourceField: buyerLogField,
  dashboardFields: (field === 'colour' ? DASHBOARD_COLOUR_ALIASES : FIELD_ALIASES[field]).slice(),
  required: DASHBOARD_REQUIRED_FIELDS.has(field),
}));

/* Power BI bazı projeksiyonları toplama fonksiyonuyla SÜSLEYEREK adlandırır.
   Canlı yanıt descriptor'ından ÖLÇÜLEN gerçek örnek:

     { "Name": "Sum(Siparis Bilgileri.Sipariş Kod)" }

   Bu girdide Property ya da iç içe Column YOKTUR; descriptorColumns yalnız
   Name'i görebildiği için satır anahtarı da bu süslü metin oluyordu. Sonuçta
   "Sipariş Kod" alias'ı ne birebir eşleşiyor ne de ".Sipariş Kod" son ekiyle
   yakalanıyordu (sonda kapanan parantez var) ve Antrepo bütünlük kontrolü
   "Sipariş Kod, Ürün Adı ve Renk Tanım birlikte bulunamadı" diyordu.
   Diğer iki alan ("Siparis Bilgileri.Ürün Ad", "Siparis Bilgileri.Renk Tanım")
   süslü olmadığı için sorunsuz eşleşiyordu; eksik olan yalnız sipariş koduydu. */
function unwrapAggregatedName(value) {
  const text = clean(value);
  const match = /^[A-Za-z][A-Za-z0-9_]*\((.+)\)$/.exec(text);
  return match ? clean(match[1]) : text;
}

// Bir kolon adının eşleştirmede denenecek biçimleri: ham hâli ve süslemesi
// soyulmuş hâli.
function columnNameForms(value) {
  const raw = key(value);
  const bare = key(unwrapAggregatedName(value));
  return bare && bare !== raw ? [raw, bare] : [raw];
}

function nameMatchesAlias(name, normalizedAlias) {
  return columnNameForms(name).some(form => form === normalizedAlias || form.endsWith(`.${normalizedAlias}`));
}

function sourceValue(row, aliases) {
  const entries = Object.entries(row || {});
  const normalized = aliases.map(key);
  // Önce birebir, sonra "Tablo.Alan" son eki — her ikisinde de süslü ad soyulur.
  for (const wanted of normalized) {
    const exact = entries.find(([name]) => columnNameForms(name).includes(wanted));
    if (exact) return exact[1];
  }
  for (const wanted of normalized) {
    const suffix = entries.find(([name]) => columnNameForms(name).some(form => form.endsWith(`.${wanted}`)));
    if (suffix) return suffix[1];
  }
  return undefined;
}

function normalizeDashboardRows(input) {
  const source = Array.isArray(input) ? input : decodePowerBiResponse(input);
  return source.map(row => {
    const next = { ...(row || {}) };
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      const value = sourceValue(row, aliases);
      if (value !== undefined) next[CANONICAL_FIELDS[field]] = value;
    }
    next._sourceFields = { ...(row || {}), ...Object.fromEntries(Object.entries(CANONICAL_FIELDS).map(([field, canonical]) => [canonical, next[canonical]]).filter(([, value]) => value !== undefined)) };
    next.orderCode = next['Sipariş Kod'] === undefined ? null : next['Sipariş Kod'];
    next.modelName = next['Model Adı'] === undefined ? null : next['Model Adı'];
    next.colourCode = next['Renk Kod'] === undefined ? null : next['Renk Kod'];
    return next;
  });
}

// Dashboard adapter'ının IAS/Antrepo eşleme sözleşmesi. Dashboard'daki renk
// alanı açıklamadır; fiziksel "Renk Kod" kolonu olmadığı için genel Database /
// Excel kuralı burada kullanılmaz. Ortak eşleyici yalnız bu adapter'ın istediği
// renk normalizasyonunu uygular.
function dashboardAntrepoMatchRule() {
  return {
    version: 1,
    conditions: [
      { id: 'ocode', asas: { header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod' } },
      { id: 'model', asas: { header: 'Model Adı', canonicalHeader: 'Model Adı' }, ias: { header: 'Ürün Ad', canonicalHeader: 'Ürün Ad' } },
      { id: 'colour', normalization: 'colour', asas: { header: 'Renk', canonicalHeader: 'Renk' }, ias: { header: 'Renk Tanım', canonicalHeader: 'Renk Tanım' } },
    ],
  };
}

function schemaNames(schema) {
  if (Array.isArray(schema)) return schema.map(item => typeof item === 'string' ? item : clean(item && (item.Name || item.QueryName || item.Property))).filter(Boolean);
  return descriptorColumns(schema);
}

/* Eksik alanları FIRLATMADAN döndürür. Ayrı bir fonksiyon olmasının sebebi:
   Power BI şeması tek seferde değil, her görselin querydata yanıtından
   BİRİKTİREREK oluşur; toplayan taraf (agent-browser-connector) "yeterince
   topladım mı?" diye sorabilmek için bunu hata almadan çağırmalıdır.
   validateDashboardSchema da aynı listeyi kullanır — tek doğruluk kaynağı. */
function dashboardSchemaMissingFields(schema, options = {}) {
  const columns = schemaNames(schema);
  const normalized = columns.map(key);
  const missing = [];
  const sourceMode = clean(options.sourceMode || 'dashboard').toLocaleLowerCase('tr-TR');
  const colourAliases = sourceMode === 'dashboard' ? DASHBOARD_COLOUR_ALIASES : FIELD_ALIASES.colourCode;
  const colourLabel = sourceMode === 'dashboard' ? 'Renk Tanım' : 'Renk Kod';
  // Süslü adlar (ör. "Sum(Tablo.Sipariş Kod)") burada da soyulur — üç eşleştirme
  // noktası (şema, şablon, satır okuma) aynı kuralı paylaşmalı.
  const has = aliases => aliases.some(alias => normalized.some(name => nameMatchesAlias(name, key(alias))));
  const required = [
    [colourLabel, colourAliases],
    ['Supplier Portal Statü', FIELD_ALIASES.supplierPortalStatus],
    ['Tahmini Antrepo Giriş Tarihi', FIELD_ALIASES.estimatedWarehouseEntry],
    ['Yükleme Toplam Adet', FIELD_ALIASES.loadedQuantity],
    ['İthalat Dosya No', FIELD_ALIASES.importFileNo],
  ];
  for (const [label, aliases] of required) if (!has(aliases)) missing.push(label);
  if (!has(FIELD_ALIASES.orderCode)) missing.unshift('Sipariş Kod');
  if (!has(FIELD_ALIASES.modelName)) missing.splice(1, 0, 'Model Adı');
  return { missing, columns };
}

function validateDashboardSchema(schema, options = {}) {
  const { missing, columns } = dashboardSchemaMissingFields(schema, options);
  if (missing.length) throw new PowerBiDashboardError(
    `Dashboard IAS/Antrepo yenilemesi başlatılamadı. Eksik alanlar: ${missing.join(', ')}.`,
    'POWERBI_DASHBOARD_SCHEMA_INVALID', 422, { missing, columns });
  return { ok: true, columns };
}

function orderIdentity(value) {
  return key(value).replace(/[.,\s]/g, '');
}

function uniqueOrderCodes(values) {
  const output = [], seen = new Set();
  for (const value of values || []) {
    const raw = clean(value);
    const identity = orderIdentity(raw);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity); output.push(raw);
  }
  return output;
}

function buildDashboardBatches(orderCodes, batchSize = DEFAULT_BATCH_SIZE) {
  const size = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.round(Number(batchSize) || DEFAULT_BATCH_SIZE)));
  const codes = uniqueOrderCodes(orderCodes), batches = [];
  for (let index = 0; index < codes.length; index += size) batches.push(codes.slice(index, index + size));
  return batches;
}

function createDashboardRefreshManifest(orderCodes, options = {}) {
  const codes = uniqueOrderCodes(orderCodes);
  return {
    schemaVersion: 1,
    refreshId: clean(options.refreshId) || `dashboard-${Date.now().toString(36)}`,
    source: 'dashboard',
    startedAt: options.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalOrders: codes.length,
    allOrderCodes: codes.slice(),
    processedOrders: 0,
    successfulOrders: 0,
    notFoundOrders: 0,
    failedOrders: 0,
    retryPending: 0,
    remainingOrders: codes.slice(),
    failedOrderCodes: [],
    orderStates: Object.create(null),
    lastBatch: null,
  };
}

function refreshManifestCounts(manifest) {
  const states = Object.values(manifest.orderStates || {});
  manifest.processedOrders = states.filter(state => state === 'SUCCESS' || state === 'NOT_FOUND' || state === 'FAILED').length;
  manifest.successfulOrders = states.filter(state => state === 'SUCCESS').length;
  manifest.notFoundOrders = states.filter(state => state === 'NOT_FOUND').length;
  manifest.failedOrders = states.filter(state => state === 'FAILED').length;
  manifest.failedOrderCodes = Object.entries(manifest.orderStates || {}).filter(([, state]) => state === 'FAILED').map(([code]) => code);
  manifest.remainingOrders = (manifest._allOrderCodes || []).filter(code => !manifest.orderStates[orderIdentity(code)]);
  manifest.updatedAt = new Date().toISOString();
  return manifest;
}

function applyDashboardBatchResult(manifest, batchCodes, rows, error = null) {
  const returned = new Set();
  if (!error) for (const row of normalizeDashboardRows(rows || [])) {
    const code = sourceValue(row, FIELD_ALIASES.orderCode);
    if (code !== undefined && code !== null && orderIdentity(code)) returned.add(orderIdentity(code));
  }
  for (const code of uniqueOrderCodes(batchCodes)) {
    const identity = orderIdentity(code);
    manifest.orderStates[identity] = error ? 'FAILED' : (returned.has(identity) ? 'SUCCESS' : 'NOT_FOUND');
  }
  manifest.lastBatch = { orderCodes: uniqueOrderCodes(batchCodes), error: error ? clean(error.message || error) : null };
  return refreshManifestCounts(manifest);
}

function assertDashboardManifestComplete(manifest) {
  refreshManifestCounts(manifest);
  if (manifest.processedOrders !== manifest.totalOrders || manifest.successfulOrders + manifest.notFoundOrders + manifest.failedOrders !== manifest.totalOrders) {
    throw new PowerBiDashboardError('Dashboard yenilemesi tüm siparişler için nihai durum üretmeden tamamlandı.', 'POWERBI_DASHBOARD_MANIFEST_INCOMPLETE', 500, { manifest });
  }
  return manifest;
}

function abortError() { return new PowerBiDashboardError('Dashboard yenilemesi kullanıcı tarafından durduruldu.', 'POWERBI_DASHBOARD_CANCELLED', 409); }
function throwIfAborted(signal) { if (signal && signal.aborted) throw abortError(); }
function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

class PowerBiImportDashboardConnector {
  constructor(options = {}) {
    this.transport = options.transport || {};
    this.batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.round(Number(options.batchSize) || DEFAULT_BATCH_SIZE)));
    this.maxRetries = Math.max(0, Math.round(Number(options.maxRetries) || DEFAULT_MAX_RETRIES));
    this.backoffMs = Math.max(0, Number(options.backoffMs) || DEFAULT_BACKOFF_MS);
    this.splitOnFailure = options.splitOnFailure !== false;
  }

  async schema() {
    if (typeof this.transport.getSchema !== 'function') throw new PowerBiDashboardError('Power BI Dashboard bağlantısı şema sağlayamıyor.', 'POWERBI_DASHBOARD_SCHEMA_UNAVAILABLE', 503);
    const schema = await this.transport.getSchema();
    return validateDashboardSchema(schema, { sourceMode: 'dashboard' });
  }

  async refresh(options = {}) {
    const orderCodes = uniqueOrderCodes(options.orderCodes || []);
    const manifest = options.manifest || createDashboardRefreshManifest(orderCodes, { refreshId: options.refreshId });
    manifest._allOrderCodes = orderCodes.slice();
    refreshManifestCounts(manifest);
    await this.schema();
    const checkpoint = typeof options.checkpoint === 'function' ? options.checkpoint : async () => {};
    const signal = options.signal;
    const batches = buildDashboardBatches(manifest.remainingOrders, this.batchSize);
    const allRows = Array.isArray(manifest.rows) ? manifest.rows.slice() : [];
    const saveCheckpoint = async () => checkpoint({
      ...manifest,
      orderStates: { ...manifest.orderStates },
      remainingOrders: manifest.remainingOrders.slice(),
      rows: allRows.slice(),
    });
    const processBatch = async batch => {
      throwIfAborted(signal);
      let lastError = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        throwIfAborted(signal);
        manifest.retryPending = attempt ? 1 : 0;
        try {
          const response = await this.transport.queryBatch(batch, { signal, attempt });
          const rows = Array.isArray(response) ? response : normalizeDashboardRows(response);
          allRows.push(...rows);
          applyDashboardBatchResult(manifest, batch, rows);
          manifest.retryPending = 0;
          await saveCheckpoint();
          if (typeof options.onProgress === 'function') options.onProgress({ ...manifest, orderStates: { ...manifest.orderStates } });
          return;
        } catch (error) {
          if (error && error.code === 'POWERBI_DASHBOARD_CANCELLED') throw error;
          if (error && PERMANENT_DASHBOARD_ERRORS.includes(error.code)) throw error;
          lastError = error;
          if (attempt < this.maxRetries) await sleep(this.backoffMs * (2 ** attempt), signal);
        }
      }
      /* Bölme 1'e kadar inebilir ve bu KASITLIDIR: "istek gövdesi çok büyük"
         gibi hatalar yalnız parti küçülünce düzelir (bkz. power-bi-import-
         dashboard testindeki "adaptively splits" senaryosu).

         Kullanıcının gördüğü "tek tek arıyor" davranışının sebebi bu bölme
         DEĞİL, kalıcı bir hatanın (HTTP 400) geçici sanılmasıydı; o artık
         PERMANENT_DASHBOARD_ERRORS ile bölmeye hiç girmiyor. */
      if (this.splitOnFailure && batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await processBatch(batch.slice(0, middle));
        await processBatch(batch.slice(middle));
        return;
      }
      applyDashboardBatchResult(manifest, batch, null, lastError || new Error('Dashboard batch başarısız oldu.'));
      manifest.retryPending = 0;
      await saveCheckpoint();
      if (typeof options.onProgress === 'function') options.onProgress({ ...manifest, orderStates: { ...manifest.orderStates } });
    };
    try {
      for (const batch of batches) await processBatch(batch);
    } catch (error) {
      if (error && error.code === 'POWERBI_DASHBOARD_CANCELLED') {
        manifest.retryPending = 0;
        await saveCheckpoint();
        return { ok: false, stopped: true, manifest };
      }
      throw error;
    }
    assertDashboardManifestComplete(manifest);
    return { ok: true, stopped: false, manifest, rows: allRows, rowsProcessed: manifest.successfulOrders };
  }
}

function createDashboardCheckpointStore(options = {}) {
  const root = path.resolve(clean(options.root) || process.cwd());
  const userKey = key(options.userId || 'moderator').replace(/[^A-Z0-9_-]+/g, '_').slice(0, 80) || 'MODERATOR';
  const file = path.join(root, `powerbi-dashboard-${userKey}.json`);
  return {
    file,
    load() { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch (_) { return null; } },
    save(value) {
      fs.mkdirSync(root, { recursive: true });
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(value), 'utf8');
      fs.renameSync(temp, file);
      return value;
    },
    clear() { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
  };
}

function powerBiQueryColumnName(value) {
  if (!value || typeof value !== 'object') return '';
  return clean(value.Name || value.QueryName || value.Property || value.Column && value.Column.Property);
}

/* Bir Select öğesinin TÜM olası adlarını döndürür.
   Neden tek ad yetmiyor — canlı Power BI trafiğinden ÖLÇÜLEN gerçek örnek:

     { "Column": { "Expression": {...}, "Property": "Sipariş Kod" },
       "Name": "Sum(Siparis Bilgileri.Sipariş Kod)",
       "NativeReferenceName": "Sipariş Kod1" }

   Alan gerçek bir Column ve Property'si tam olarak "Sipariş Kod". Ama
   powerBiQueryColumnName'deki `Name || QueryName || ...` zinciri ilk terimde
   kısa devre yapıp "Sum(...)" döndürüyordu; bu ne alias'a eşit ne de
   ".Sipariş Kod" ile bitiyor (sonunda parantez var), dolayısıyla eşleşme
   kaçıyor ve "sorgu şablonunda Sipariş Kod alanı bulunamadı" hatası
   veriliyordu. Şema çıkarımı (semanticQueryColumns) zaten tüm adları
   topladığı için şema doğrulaması geçiyordu — iki davranışın çelişmesinin
   sebebi tam olarak buydu. */
function powerBiQueryColumnNames(value) {
  if (!value || typeof value !== 'object') return [];
  const column = value.Column && typeof value.Column === 'object' ? value.Column : null;
  const measure = value.Measure && typeof value.Measure === 'object' ? value.Measure : null;
  const aggregated = value.Aggregation && value.Aggregation.Expression && value.Aggregation.Expression.Column;
  return [
    value.Name, value.QueryName, value.Property, value.NativeReferenceName,
    column && column.Property, column && column.Name, column && column.QueryName,
    measure && measure.Property,
    aggregated && aggregated.Property,
  ].map(clean).filter(Boolean);
}

// Bir Select öğesinin Where koşulunda kullanılabilecek Column ifadesi.
function powerBiSelectColumn(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.Column && typeof value.Column === 'object') return value.Column;
  const aggregated = value.Aggregation && value.Aggregation.Expression && value.Aggregation.Expression.Column;
  return aggregated && typeof aggregated === 'object' ? aggregated : null;
}

function powerBiMatchesAlias(item, aliases) {
  return powerBiQueryColumnNames(item).some(raw => aliases.some(alias => nameMatchesAlias(raw, key(alias))));
}

/* Sipariş Kod'a göre filtrelenebilecek sorgu düğümünü bulur. Ayrı bir
   fonksiyon olmasının sebebi: şablonu YAZMADAN önce "bu şablon kullanılabilir
   mi?" diye sorulabilmesi (bkz. powerBiTemplateHasOrderField). Bulunamazsa
   görülen Select adlarını da döndürür — hata mesajı tahmin yerine gerçekten
   nelerin geldiğini söyleyebilsin diye. */
function findPowerBiOrderQueryNode(body) {
  let queryNode = null, column = null;
  const selectNames = [];
  const visit = value => {
    if (queryNode || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (Array.isArray(value.Select)) {
      for (const item of value.Select) {
        const names = powerBiQueryColumnNames(item);
        if (names.length) selectNames.push(powerBiSelectColumn(item) ? names.join(' | ') : `${names.join(' | ')} (Column değil)`);
      }
      const candidate = value.Select.find(item => powerBiMatchesAlias(item, FIELD_ALIASES.orderCode) && powerBiSelectColumn(item));
      if (candidate) { queryNode = value; column = powerBiSelectColumn(candidate); return; }
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return { queryNode, column, selectNames: [...new Set(selectNames)] };
}

function powerBiTemplateHasOrderField(body) {
  const found = findPowerBiOrderQueryNode(body);
  return Boolean(found.queryNode && found.column);
}

// Bir Where koşulunun, verilen kolona ait olup olmadığı. Kolon kimliği
// SourceRef kaynağı + Property üzerinden karşılaştırılır.
function columnIdentity(value) {
  const column = value && typeof value === 'object' ? (value.Column && typeof value.Column === 'object' ? value.Column : value) : null;
  if (!column || !column.Property) return '';
  const source = column.Expression && column.Expression.SourceRef && (column.Expression.SourceRef.Source || column.Expression.SourceRef.Entity);
  return `${key(source || '')}` + '\u0000' + `${key(column.Property)}`;
}

function conditionTargetsColumn(condition, column) {
  const wanted = columnIdentity(column);
  if (!wanted) return false;
  let hit = false;
  const visit = (value, depth = 0) => {
    if (hit || depth > 10 || value == null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    if (value.Property && columnIdentity(value) === wanted) { hit = true; return; }
    Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(condition);
  return hit;
}

function buildPowerBiOrderQueryPayload(templateBody, orderCodes) {
  const body = clone(templateBody);
  const { queryNode, column, selectNames } = findPowerBiOrderQueryNode(body);
  if (!queryNode || !column) throw new PowerBiDashboardError('Power BI sorgu şablonunda Sipariş Kod alanı bulunamadı.', 'POWERBI_DASHBOARD_ORDER_FIELD_MISSING', 422, { selectNames: selectNames.slice(0, 60) });
  /* Expressions ögesi { Column: {...} } ile SARILMALIDIR. Power BI'nin kendi
     slicer'ının ürettiği filtre canlı oturumdan ÖLÇÜLDÜ ve aynen şöyle:

       "Expressions":[{"Column":{"Expression":{"SourceRef":{"Source":"s"}},
                                 "Property":"Sipariş Kod"}}]

     Eski kod candidate.Column'ı sarmalamadan koyuyordu:
       "Expressions":[{"Expression":{...},"Property":"Sipariş Kod"}]
     Power BI bunu geçersiz sayıp HTTP 400 döndürüyordu. splitOnFailure da bu
     kalıcı hatayı geçici sanıp partiyi 250'den 1'e kadar bölerek her siparişi
     tek tek deniyordu; 7192 siparişte 300 saniyede ancak ~70 kayıt işlenmesinin
     sebebi buydu.

     Literal biçimi de ölçüldü: kodlar tamamen rakam olsa bile Power BI onları
     TIRNAKLI metin literali olarak gönderiyor ("'1265562'"), yani mevcut
     biçimlendirme doğru — değiştirilmedi. */
  const values = uniqueOrderCodes(orderCodes).map(code => [{ Literal: { Value: `'${code.replace(/'/g, "''")}'` } }]);
  const condition = { Condition: { In: { Expressions: [{ Column: clone(column) }], Values: values } } };
  /* Sipariş Kod üzerindeki MEVCUT filtre kaldırılır, sonra bizimki eklenir.

     Yakalanan şablon, raporun o anki filtrelerini de taşır. Kullanıcının
     Sipariş Kod slicer'ında bir seçim varsa (canlı olarak ölçüldü:
     Sipariş Kod In ('1265562')), bizim In(7192 kod) koşulumuz onun ÜSTÜNE
     eklendiğinde iki koşul VE'lenir ve kesişim boş kalır. Belirti tam olarak
     buydu: doğru şablon seçiliyor, sorgu 200 dönüyor, ama 7192 siparişin
     tamamı NOT_FOUND işaretleniyordu.

     Yalnız AYNI KOLONA ait koşullar atılır; raporun diğer filtreleri
     (ör. Hedef Sevkiyat, Dosya Tipi) kapsamı daraltan meşru kısıtlardır ve
     korunur. CoreNectum tarafındaki coreNectumUnfilteredRequestBody'nin
     Power BI karşılığı budur. */
  const existing = Array.isArray(queryNode.Where) ? queryNode.Where : [];
  queryNode.Where = [...existing.filter(item => !conditionTargetsColumn(item, column)), condition];
  return body;
}

module.exports = {
  POWER_BI_IMPORT_DASHBOARD_URL, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, PowerBiDashboardError,
  PowerBiImportDashboardConnector, decodePowerBiResponse, descriptorColumns, normalizeDashboardRows,
  dashboardAntrepoMatchRule, validateDashboardSchema, dashboardSchemaMissingFields, uniqueOrderCodes, buildDashboardBatches, createDashboardRefreshManifest,
  applyDashboardBatchResult, assertDashboardManifestComplete, createDashboardCheckpointStore,
  PERMANENT_DASHBOARD_ERRORS, unwrapAggregatedName, bitmapHas,
  buildPowerBiOrderQueryPayload, powerBiTemplateHasOrderField, powerBiQueryColumnName, powerBiQueryColumnNames, powerBiSelectColumn, DASHBOARD_FIELD_MAPPING,
};
