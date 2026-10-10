'use strict';
const intakeReport = require('./intake-report');

/*
 * Uygulamanın kaynak veriden beklediği alanların kataloğu.
 *
 * Buradaki `header` değerleri UYDURMA DEĞİL: bugünkü Excel dosyalarında bulunan ve
 * parse.js / lfl.js tarafından aranan gerçek başlık adlarıdır. Model sorgusu
 * SELECTCOLUMNS ile çıktı sütunlarını tam olarak bu adlarla üretirse, mevcut
 * ayrıştırma mantığı hiç değişmeden çalışır — dosya yerine satır dizisi okur.
 *
 * ÖNEMLİ BULGU (v3.42): LFL'in ihtiyaç duyduğu alanların neredeyse tamamı zaten
 * ASAS sipariş tablosunda var. `Lisansör` ve `DTR/Non-DTR` uygulamada lisanstan
 * türetiliyor (derived: true). Gerçekten fazladan gereken tek alan
 * "Marka Müdürlükleri". Bu yüzden LFL için ayrı bir çekim yapılmaz; ASAS rolüne
 * bu sütun eklenir ve tek sorgu ilgili sayfaları besler.
 */

// turknorm benzeri sadeleştirme: eşleştirme büyük/küçük harf, Türkçe karakter,
// noktalama ve boşluk farklarına takılmasın.
const TR_MAP = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };
function fieldKey(value) {
  return String(value == null ? '' : value)
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => TR_MAP[ch])
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// role: bu alanı hangi sayfa ailesi kullanıyor.
//   asas    → CP, Genel Bakış, Backlog, Koleksiyon, Ön Maliyet
//   lfl     → LFL sayfası (asas çekimine eklenir, ayrı sorgu değil)
//   antrepo → Antrepo durumu (IASv2 modelinde)
const FIELD_CATALOGUE = {
  asas: [
    { header: 'Sipariş Kod', required: true, aliases: ['SIPARIS KODU', 'ORDER CODE'] },
    { header: 'Renk', required: true, aliases: ['RENK TANIM', 'COLOUR', 'COLOR'] },
    { header: 'Renk Kod', required: true, aliases: ['COLOUR CODE', 'COLOR CODE'] },
    { header: 'Net Alım Sipariş Miktarı', aliases: ['NET ALIM SIPARIS MIKTARI', 'ORDER QUANTITY'] },
    { header: 'Kalan Alım Sipariş Miktarı', aliases: ['REMAINING ORDER QUANTITY'] },
    { header: 'Antrepoya Giren Miktar', aliases: ['BONDED WAREHOUSE QUANTITY'] },
    { header: 'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo', aliases: ['KALAN MERKEZ SEVKE HAZIR DEPO', 'MERKEZ SEVKE HAZIR DEPO'] },
    { header: 'FOB Fiyatı', required: true, aliases: ['FOB PRICE', 'FOB'] },
    { header: 'Plm Kod', aliases: ['PLM ID', 'PLM CODE'] },
    { header: 'Teknik Resim', aliases: ['TEKNİK GÖRSEL', 'TEKNIK GORSEL', 'TEKNIK RESIM', 'TECHNICAL IMAGE', 'TECHNICAL PICTURE', 'STYLE IMAGE URL', 'IMAGE URL'] },
    { header: 'Özel Kod 1', aliases: ['SPECIAL CODE 1', 'SPECIAL CODE'] },
    { header: 'Üretici', required: true, aliases: ['MANUFACTURER', 'SUPPLIER'] },
    { header: 'Sezon', required: true, aliases: ['SEASON'] },
    { header: 'Ürün Klasman', aliases: ['KLASMAN', 'CLASSIFICATION'] },
    { header: 'Merch Alt Grup Kod', aliases: ['MAG'] },
    { header: 'Merch Marka Yaş Grup Kod', aliases: ['MMYG'] },
    { header: 'Buyer Grup (TR)', aliases: ['BUYING GROUP', 'BUYER GROUP', 'BUYER GRUP TANIM', 'BUYER GRUP TANIMI'] },
    { header: 'Siparişin Üretildiği Ülke', aliases: ['URETIM ULKESI', 'COUNTRY OF ORIGIN'] },
    { header: 'Lisans', aliases: ['LICENSE'] },
    { header: 'Lisansör', aliases: ['LICENSOR', 'LICENSE OWNER', 'LISANS VEREN'] },
    { header: 'Model Adı', required: true, aliases: ['MODEL NAME', 'STYLE NAME', 'ÜRÜN ADI', 'URUN ADI', 'PRODUCT NAME'] },
    { header: 'Ürün Tanım', aliases: ['Ürün Ana Tanım', 'ÜRÜN ANA TANIM', 'ÜRÜN TANIMI', 'URUN TANIM', 'URUN TANIMI', 'PRODUCT DESCRIPTION', 'PRODUCT DESC', 'PRODUCT DEFINITION'] },
    { header: 'Orijinal Exfactory Merch Tarih', required: true, aliases: [] },
    { header: 'Retail Depo Tarih Yıl Ay Gün', aliases: ['RETAIL DEPO TARIH'] },
    { header: 'Model Bütçe Tarih Yıl Ay Gün', aliases: ['IN STORE', 'MODEL BUDGET DATE'] },
    { header: 'Sipariş Yerleştirme MerchTarih', aliases: [] },
    { header: 'Buying Son Onay Tarihi', aliases: ['BUYING APPROVAL DATE', 'SON ONAY TARIHI'] },
    // CP/Orders Original Ex-F.: ASAS Dates tablosundaki tam gün/ay/yıl
    // tarih sütunu, revize edilen Ex-factory tarihinden bağımsızdır.
    { header: 'Initial Inspection Geçme Tarih Gün Ay Yıl', aliases: [] },
    // v7.0.229 — Üretici kartı termin performansı: PO açılırken verilen ilk
    // ex-factory sözü. İsteğe bağlıdır; eşlenmezse ASAS'ın ilk ex-factory
    // değeri temel alınır.
    // Üretici kartının ayrı ilk söz alanı. CP'deki Original Ex-F. sütunu,
    // yukarıdaki Gün Ay Yıl başlığından okunur.
    { header: 'Initial Inspection Geçme Tarih', aliases: ['INITIAL INSPECTION GECME TARIH', 'INITIAL INSPECTION DATE', 'INITIAL INSPECTION TARIHI'] },
    { header: 'Buyer', aliases: ['SATIN ALMACI'] },
    { header: 'Line', aliases: ['URUN GRUBU', 'PRODUCT LINE'] },
    // Kumaş bilgileri artık ayrı bir Fabric bağlantısından değil aynı ASAS sorgusundan
    // gelir. ASAS, bir sipariş/model/renk satırını kumaş bileşeni kadar çoğaltabilir;
    // parser yalnız Ana Kumaş Mı = 1 satırındaki ayrıntıları siparişe bağlar.
    { header: 'Ana Kumaş Mı', required: true, aliases: ['ANA KUMAS MI', 'ANA KUMAS', 'MAIN FABRIC', 'IS MAIN FABRIC'] },
    { header: 'Kumaş Kategorisi', aliases: ['KUMAS KATEGORISI', 'FABRIC CATEGORY'] },
    { header: 'Kumaşçı Ülkesi', aliases: ['KUMASCI ULKESI', 'FABRIC SUPPLIER COUNTRY', 'FABRIC MILL COUNTRY', 'MILL COUNTRY'] },
    { header: 'Kumaşçı', aliases: ['KUMASCI', 'FABRIC SUPPLIER', 'FABRIC MILL', 'MILL'] },
    { header: 'Kumaş Tipi', aliases: ['KUMAS TIPI', 'FABRIC TYPE'] },
    { header: 'İplik No', aliases: ['IPLIK NO', 'YARN COUNT', 'YARN NO'] },
    { header: 'Gramaj', aliases: ['KUMAS GRAMAJI', 'GRAMAJ', 'FABRIC WEIGHT', 'WEIGHT', 'GSM'] },
    { header: 'Karışım', aliases: ['KARISIM', 'COMPOSITION', 'BLEND'] },
  ],
  // ASAS çekimine eklenen, yalnız LFL'in kullandığı alanlar.
  lfl: [
    { header: 'Marka Müdürlükleri', usedBy: 'LFL', aliases: ['MARKA MUDURLUGU', 'BRAND DIRECTORATE', 'BRAND DIRECTORATES'] },
    { header: 'Para Birimi', usedBy: 'LFL', aliases: ['CURRENCY'] },
  ],
  antrepo: [
    // IAS sorgusu İthalat Dosya No alanının bağlı olduğu gerçek fact tablosundan
    // satır satır çalışır. Böylece aynı sipariş/renk altındaki parsiyeller
    // gruplanmaz; Konteyner ve aşağıdaki operasyon alanları da izlenebilir kalır.
    { header: 'İthalat Dosya No', required: true, usedBy: 'IAS Satır Tablosu', aliases: ['ITHALAT DOSYA NO', 'IMPORT FILE NO', 'IMPORT FILE NUMBER', 'DOSYA NO'] },
    { header: 'Konteyner No', usedBy: 'IAS Parsiyel Detayı', aliases: ['KONTEYNER NUMARASI', 'CONTAINER NO', 'CONTAINER NUMBER'] },
    { header: 'Gemi Ad', usedBy: 'IAS Parsiyel Kimliği', aliases: ['GEMI ADI', 'VESSEL NAME', 'SHIP NAME'] },
    { header: 'Supplier Portal Statü Detay', usedBy: 'IAS Parsiyel Kimliği', aliases: ['SUPPLIER PORTAL STATUS DETAIL', 'STATU DETAY', 'STATUS DETAIL'] },
    { header: 'Yükleme Talep Tarih', usedBy: 'IAS Parsiyel Kimliği', aliases: ['YUKLEME TALEP TARIHI', 'LOADING REQUEST DATE'] },
    { header: 'Yükleme İthalat Onay Tarih', usedBy: 'IAS Parsiyel Kimliği', aliases: ['YUKLEME ITHALAT ONAY TARIHI', 'IMPORT APPROVAL DATE'] },
    { header: 'ETA Tarih', usedBy: 'IAS Parsiyel Kimliği', aliases: ['ETA DATE'] },
    { header: 'Antrepo Firma', usedBy: 'IAS Parsiyel Kimliği', aliases: ['BONDED WAREHOUSE COMPANY', 'WAREHOUSE COMPANY'] },
    { header: 'Sipariş Kod', required: true, aliases: ['SIPARIS KODU', 'ORDER CODE'] },
    // Sipariş eşleşmesi Sipariş Kodu + Model Adı + Renk Kodu üçlüsüyle yapılır:
    // bir sipariş kodunun altında aynı renk koduna sahip birden fazla model olabiliyor.
    // IASv2'de bu sütunun adı 'Ürün Adı'dır; ASAS'ta 'Model Adı'. Takma ad listesi
    // olmadan otomatik eşleme bu alanı hiç bulamıyor, sorgu model adını getirmiyor
    // ve sipariş eşleşmesi üçlü anahtar yerine renk tanımına düşüyordu (v4.34).
    { header: 'Model Adı', required: true, aliases: ['ÜRÜN AD', 'URUN AD', 'ÜRÜN ADI', 'URUN ADI', 'ÜRÜN ADİ', 'MODEL NAME', 'STYLE NAME', 'PRODUCT NAME', 'MODEL'] },
    { header: 'Renk Kod', required: true, aliases: ['RENK KODU', 'COLOUR CODE', 'COLOR CODE'] },
    { header: 'Renk Tanım', aliases: ['RENK', 'COLOUR'] },
    { header: 'Supplier Portal Statü', required: true, aliases: ['SUPPLIER PORTAL STATUS', 'STATU'] },
    { header: 'Tahmini Antrepo Giriş Tarihi', required: true, aliases: ['ESTIMATED ARRIVAL', 'ANTREPO GIRIS TARIHI'] },
    { header: 'HANDOVER Tarihi', aliases: ['HANDOVER DATE', 'HANDOVER'] },
    { header: 'Vasita Tanim', aliases: ['VASITA', 'VEHICLE'] },
    { header: 'Yükleme Toplam Adet', required: true, aliases: ['YUKLEME TOPLAM ADET', 'YÜKLENEN TOPLAM ADET', 'LOADING TOTAL QUANTITY', 'LOADED QUANTITY', 'SHIPMENT QUANTITY'] },
    // Sipariş toplamı ASAS'tan alınır; IAS tarafında bu alan eşlenmez.
    // Aşağıdakiler Antrepo verisinin kendisi için gerekli değildir; IAS tarafında
    // ufuk koşulu kurabilmek için eşlenirler (sezon, MAG, MMYG, marka müdürlüğü).
    { header: 'Sezon', usedBy: 'Ufuk', aliases: ['SEASON'] },
    { header: 'Merch Alt Grup Kod', usedBy: 'Ufuk', aliases: ['MAG'] },
    { header: 'Merch Marka Yaş Grup Kod', usedBy: 'Ufuk', aliases: ['MMYG'] },
    { header: 'Marka Müdürlükleri', usedBy: 'Ufuk', aliases: ['MARKA MUDURLUGU', 'BRAND DIRECTORATE', 'BRAND DIRECTORATES'] },
    // Ufuk editörü ASAS başlığı 'Buyer Grup (TR)' ile koşul kurabiliyor. IAS'ta
    // bu ad fiziksel bir sütun değildir; eşlenmezse DAX "Column 'Buyer Grup (TR)'
    // ... cannot be found" ile düşer. Katalogda olması IAS Field Mapping'in bu
    // alanı sunmasını ve hata onarım eyleminin doğru alanı açmasını sağlar.
    { header: 'Buyer Grup (TR)', usedBy: 'Ufuk', aliases: ['BUYING GROUP', 'BUYER GROUP', 'BUYER GRUP', 'BUYER GRUP TANIM', 'BUYER GRUP TANIMI'] },
  ],
};

// Uygulamada lisanstan türetilen, modelden çekilmesi GEREKMEYEN alanlar.
// Kullanıcı "LFL'de Lisansör kolonu var, neden listede yok?" diye sormasın diye
// burada açıkça belirtiliyor.
const DERIVED_FIELDS = [
  { header: 'Lisansör', from: 'Lisans', note: 'Lisans kodundan uygulama içinde türetilir.' },
  { header: 'DTR/Non-DTR', from: 'Lisans', note: 'Lisansör "DTR" ise DTR kabul edilir; üretici bazlı istisnalar Non-DTR listesinden gelir.' },
];

/** Bir rol için beklenen alan listesi. asas rolü LFL alanlarını da içerir. */
function intakeFieldsForMapping(fields) {
  return (Array.isArray(fields) ? fields : []).map(field=>({
    header: field.defaultLabel || field.name,
    usedBy: field.fieldType === 'measure' ? 'INTAKE Measure' : 'INTAKE Dimension',
    aliases: [field.name, field.sourceLabel, field.sourceUniqueName].filter(Boolean),
    sourceUniqueName: field.sourceUniqueName,
    kind: field.fieldType,
  }));
}
function fieldsForRole(role) {
  if (role === 'antrepo') return FIELD_CATALOGUE.antrepo.slice();
  if (role === 'asas') return FIELD_CATALOGUE.asas.concat(FIELD_CATALOGUE.lfl);
  if (role === 'intake') return intakeFieldsForMapping(intakeReport.defaultFields());
  return [];
}

/**
 * Model sütunlarını katalog alanlarıyla otomatik eşleştirir.
 * Önce birebir ad eşleşmesi, sonra takma adlar, sonra içerme denenir.
 * Döner: { mapping: {header: modelColumn}, unmatched: [header], unused: [modelColumn] }
 */
function autoMapColumns(role, modelColumns) {
  const columns = (Array.isArray(modelColumns) ? modelColumns : []).map(value => String(value == null ? '' : value)).filter(Boolean);
  const byKey = new Map();
  columns.forEach(column => { const key = fieldKey(column); if (!byKey.has(key)) byKey.set(key, column); });

  const mapping = {};
  const unmatched = [];
  const taken = new Set();

  const roleFields = fieldsForRole(role);
  const orderedFields = role === 'antrepo'
    ? roleFields.map((field, index) => ({ field, index }))
      .sort((a, b) => Number(Boolean(b.field.required)) - Number(Boolean(a.field.required)) || a.index - b.index)
      .map(item => item.field)
    : roleFields;
  for (const field of orderedFields) {
    const candidates = [field.header, ...(field.aliases || [])];
    let hit = null;
    // 1) tam eşleşme
    for (const candidate of candidates) {
      const found = byKey.get(fieldKey(candidate));
      if (found && !taken.has(found)) { hit = found; break; }
    }
    // 2) içerme (kısa takma adlar hariç — "FOB" her şeyi yakalar)
    if (!hit) {
      for (const candidate of candidates) {
        const key = fieldKey(candidate);
        if (key.length < 5) continue;
        const found = columns.find(column => !taken.has(column) && (fieldKey(column).includes(key) || key.includes(fieldKey(column))));
        if (found) { hit = found; break; }
      }
    }
    if (hit) { mapping[field.header] = hit; taken.add(hit); }
    else unmatched.push(field.header);
  }
  return { mapping, unmatched, unused: columns.filter(column => !taken.has(column)) };
}

/**
 * Modelin TÜM tablolarını ve ölçülerini tarayarak eşleştirir.
 * schema: { columns: [{table,name,kind}], measures: [{table,folder,name,kind}] }
 * Döner: { mapping: { header: {table,name,kind,folder} }, unmatched, unused }
 *
 * Ölçüler önce denenir: "FOB Fiyatı" veya "Net Alım Sipariş Miktarı" gibi alanlar
 * tabular modelde genellikle ölçüdür ve aynı adı taşıyan bir boyut sütunu varsa bile
 * doğru olan ölçüdür (pivotun kullandığı da odur).
 */
function autoMapSchema(role, schema) {
  const measures = Array.isArray(schema && schema.measures) ? schema.measures : [];
  const columns = Array.isArray(schema && schema.columns) ? schema.columns : [];
  const all = measures.concat(columns);

  // IAS gerçek parsiyel satırları üzerinden çalışır. Aynı adı taşıyan sütun ve
  // ölçü birlikte varsa gerçek sütun seçilir; sütun yoksa ölçüye düşülür. Bu,
  // özellikle Yükleme Toplam Adet değerinin satır miktarı olarak kalmasını sağlar.

  const mapping = {};
  const unmatched = [];
  const taken = new Set();
  const idOf = entry => `${entry.kind}\u0000${entry.table}\u0000${entry.name}`;
  let preferredAntrepoTable = '';
  const sameTable = (entry, table) => fieldKey(entry && entry.table) === fieldKey(table);
  const looksLikeAntrepoTable = entry => /(?:ITHALAT|ANTREPO|IAS)/.test(fieldKey(entry && entry.table));

  const roleFields = fieldsForRole(role);
  const orderedFields = role === 'antrepo'
    ? roleFields.map((field, index) => ({ field, index }))
      .sort((a, b) => Number(Boolean(b.field.required)) - Number(Boolean(a.field.required)) || a.index - b.index)
      .map(item => item.field)
    : roleFields;
  for (const field of orderedFields) {
    const candidates = [field.header, ...(field.aliases || [])];
    const ordered = role === 'antrepo'
      ? [
          ...columns.filter(entry => preferredAntrepoTable && sameTable(entry, preferredAntrepoTable)),
          ...columns.filter(entry => !preferredAntrepoTable && looksLikeAntrepoTable(entry)),
          ...columns.filter(entry => !(preferredAntrepoTable && sameTable(entry, preferredAntrepoTable))
            && !(!preferredAntrepoTable && looksLikeAntrepoTable(entry))),
          ...measures.filter(entry => preferredAntrepoTable && sameTable(entry, preferredAntrepoTable)),
          ...measures.filter(entry => !(preferredAntrepoTable && sameTable(entry, preferredAntrepoTable))),
        ]
      : field.header === 'Initial Inspection Geçme Tarih Gün Ay Yıl'
        ? [...columns.filter(entry => fieldKey(entry.table) === 'DATES'),
           ...columns.filter(entry => fieldKey(entry.table) !== 'DATES'), ...measures]
        : measures.concat(columns);
    let hit = null;
    // 1) birebir ad eşleşmesi. IAS satır alanlarında sütunlar ölçülerden önce gelir.
    for (const candidate of candidates) {
      const key = fieldKey(candidate);
      hit = ordered.find(entry => !taken.has(idOf(entry)) && fieldKey(entry.name) === key) || null;
      if (hit) break;
    }
    // 2) içerme — kısa takma adlar hariç ("FOB" tek başına her şeyi yakalar)
    if (!hit) {
      for (const candidate of candidates) {
        const key = fieldKey(candidate);
        if (key.length < 5) continue;
        hit = ordered.find(entry => {
          if (taken.has(idOf(entry))) return false;
          const name = fieldKey(entry.name);
          return name.includes(key) || key.includes(name);
        }) || null;
        if (hit) break;
      }
    }
    if (hit) {
      mapping[field.header] = { ...hit };
      taken.add(idOf(hit));
      if (role === 'antrepo' && field.header === 'İthalat Dosya No' && hit.kind !== 'measure') {
        preferredAntrepoTable = String(hit.table || '').trim();
      }
    } else unmatched.push(field.header);
  }
  return { mapping, unmatched, unused: all.filter(entry => !taken.has(idOf(entry))) };
}

const BROKEN_OBJECT_TEXT = /^\[object Object\]$/i;

function cleanMappingText(value, max = 300) {
  const text = String(value == null ? '' : value).trim().slice(0, max);
  return !text || BROKEN_OBJECT_TEXT.test(text) ? '' : text;
}

/**
 * Eşleme girdisini tek biçime getirir.
 *
 * Eski sürümlerde eşlemeler düz metin, yeni sürümlerde {table,name,kind,folder}
 * nesnesi olarak saklandı. v3.46'daki depolama katmanı nesneyi yanlışlıkla
 * String(object) ile "[object Object]" metnine çevirebildi. Bu yardımcı hem eski
 * metinleri hem yapılandırılmış nesneleri okur; bozuk nesne metnini geçerli bir
 * sütun adı kabul etmez.
 */
function normalizeMappingEntry(value, fallbackTable, depth = 0) {
  if (depth > 4 || value == null) return null;

  if (typeof value === 'string') {
    const source = value.trim();
    if (!source || BROKEN_OBJECT_TEXT.test(source)) return null;

    // Bazı ara sürümler eşleme nesnesini JSON metni olarak saklamış olabilir.
    if (/^\s*\{/.test(source)) {
      try { return normalizeMappingEntry(JSON.parse(source), fallbackTable, depth + 1); }
      catch (_) { /* düz sütun adı olarak değerlendirmeye devam et */ }
    }

    // Arayüz seçim kimliği: kind|table|name
    const parts = source.split('|');
    if (parts.length >= 3 && /^(column|measure)$/i.test(parts[0])) {
      const kind = parts.shift().toLowerCase() === 'measure' ? 'measure' : 'column';
      const table = cleanMappingText(parts.shift() || fallbackTable);
      const name = cleanMappingText(parts.join('|'));
      return name ? { table, name, kind, folder: '' } : null;
    }

    const name = cleanMappingText(source);
    return name ? { table: cleanMappingText(fallbackTable), name, kind: 'column', folder: '' } : null;
  }

  if (typeof value !== 'object') return null;

  // Bazı UI/backup biçimleri girdiyi value/entry/field altında sarmalayabilir.
  const directName = value.name ?? value.columnName ?? value.column ?? value.fieldName ?? value.field;
  if (directName && typeof directName === 'object') {
    const nested = normalizeMappingEntry(directName, value.table || fallbackTable, depth + 1);
    if (nested) return {
      ...nested,
      table: cleanMappingText(value.table || nested.table || fallbackTable),
      kind: value.kind === 'measure' || value.type === 'measure' ? 'measure' : nested.kind,
      folder: cleanMappingText(value.folder || nested.folder),
    };
  }
  if (directName == null) {
    for (const key of ['entry', 'value', 'mapping', 'selected']) {
      if (value[key] && typeof value[key] === 'object') {
        const nested = normalizeMappingEntry(value[key], value.table || fallbackTable, depth + 1);
        if (nested) return nested;
      }
    }
  }

  const name = cleanMappingText(directName);
  if (!name) return null;
  return {
    table: cleanMappingText(value.table ?? value.tableName ?? value.sourceTable ?? fallbackTable),
    name,
    kind: value.kind === 'measure' || value.type === 'measure' || value.isMeasure === true ? 'measure' : 'column',
    folder: cleanMappingText(value.folder ?? value.displayFolder),
  };
}

function mappingHasInvalidEntries(mapping) {
  const source = mapping && typeof mapping === 'object' ? mapping : {};
  return Object.values(source).some(value => !normalizeMappingEntry(value));
}

const PRODUCT_DESCRIPTION_HEADER = 'Ürün Tanım';
const LEGACY_PRODUCT_DESCRIPTION_SOURCES = new Set([
  'URUN TANIM', 'URUN TANIMI', 'PRODUCT DESCRIPTION', 'PRODUCT DESC', 'PRODUCT DEFINITION',
].map(fieldKey));

function productDescriptionNeedsRepair(mapping) {
  const entry = normalizeMappingEntry(mapping && mapping[PRODUCT_DESCRIPTION_HEADER]);
  return Boolean(entry && entry.kind === 'column' && LEGACY_PRODUCT_DESCRIPTION_SOURCES.has(fieldKey(entry.name)));
}

/**
 * ASAS'ın gerçek source başlığı Ürün Ana Tanım'dır. Eski kayıtlar çıktı alanını
 * Ürün Tanım adına bağlamış olabilir; yalnız bu bilinen legacy binding'i,
 * şemada gerçek kolon bulunuyorsa yükselt. Özel kullanıcı eşlemelerine dokunma.
 */
function repairAsasProductDescriptionMapping(mapping, schema) {
  const source = mapping && typeof mapping === 'object' ? mapping : {};
  const columns = Array.isArray(schema && schema.columns) ? schema.columns : [];
  const preferred = columns.find(entry => entry && entry.kind === 'column' && fieldKey(entry.name) === fieldKey('Ürün Ana Tanım'));
  if (!preferred || !productDescriptionNeedsRepair(source)) return source;
  return { ...source, [PRODUCT_DESCRIPTION_HEADER]: { ...preferred } };
}

/** Zorunlu alanlardan eşleşmeyenler. Sorgu çalıştırmadan önce engelleyici kontrol. */
function missingRequired(role, mapping) {
  const map = mapping && typeof mapping === 'object' ? mapping : {};
  return fieldsForRole(role)
    .filter(field => {
      const entry = normalizeMappingEntry(map[field.header]);
      return field.required && !(entry && entry.name);
    })
    .map(field => field.header);
}

/**
 * KİMLİK ALANLARI YANLIŞ SÜTUNA BAĞLANMIŞ MI?
 *
 * Sipariş eşleşmesi Sipariş Kodu + Model Adı + Renk Kodu üçlüsüyle ve BİREBİR
 * yapılır. Bu üç alandan biri yanlış sütuna bağlanırsa hiçbir hata oluşmaz; sorgu
 * çalışır, satırlar gelir, yalnız hiçbir satır eşleşmez ya da yanlış satır eşleşir.
 *
 * Bu yüzden bağlı sütun adı, alanın tanıdığı adlardan hiçbirine benzemiyorsa
 * uyarı üretilir. Eşleme yine de kullanıcının seçimidir — burada engelleme yok,
 * yalnız görünürlük var. (IAS'ta model sütununun adı 'Ürün Adı'dır; bu ad artık
 * takma ad listesinde olduğu için doğru eşleme uyarı üretmez.)
 */
const IDENTITY_HEADERS = ['Sipariş Kod', 'Model Adı', 'Renk Kod'];
function suspectIdentityMappings(role, mapping) {
  const map = mapping && typeof mapping === 'object' ? mapping : {};
  const out = [];
  for (const field of fieldsForRole(role)) {
    if (!IDENTITY_HEADERS.includes(field.header)) continue;
    const entry = normalizeMappingEntry(map[field.header]);
    if (!entry || !entry.name) continue;
    const bound = fieldKey(entry.name);
    const candidates = [field.header, ...(field.aliases || [])].map(fieldKey);
    const ok = candidates.some(candidate => candidate === bound
      || (candidate.length >= 5 && (bound.includes(candidate) || candidate.includes(bound))));
    if (!ok) out.push({ header: field.header, column: entry.name, expected: [field.header, ...(field.aliases || [])] });
  }
  return out;
}

/* ===================================================================
   v7.81 — EŞLEME SAĞLIĞI: HANGİ ALANA GÜVENİLİR?

   Kullanıcı bugüne kadar 37–50 satırlık tam eşleme listesini görüyordu ve
   hangi satırın gerçekten bakılması gerektiğini ayırt edemiyordu. Oysa
   alanların büyük çoğunluğu birebir adla eşleşiyor ve hiç bakılması
   gerekmiyor; bakılması gereken bir avuç alan listenin içinde kayboluyordu.

   GÜVEN SKORU SAKLANMIYOR, HESAPLANIYOR. autoMapSchema'nın eşleştirme
   kuralları deterministik (birebir ad → takma ad → ≥5 karakter içerme).
   Aynı kuralları saklanmış eşlemeye geriye dönük uygulayınca her alanın
   hangi güçle bağlandığı çıkar. Böylece BUGÜNKÜ bağlantılar için de
   çalışır — yeniden eşleme yapmak, şema okumak veya veri taşımak gerekmez.

   Durumlar:
     exact    sütun adı, alanın kendi başlığıyla birebir  → bakma
     alias    bilinen bir takma adla birebir              → bakma
     weak     yalnız içerme eşleşmesi                     → GÖZDEN GEÇİR
     foreign  hiçbir adayla örtüşmüyor                    → GÖZDEN GEÇİR
     unmapped eşlenmemiş                                  → zorunluysa ENGELLEYİCİ
   =================================================================== */
const MAPPING_STATUSES = Object.freeze(['exact', 'alias', 'weak', 'foreign', 'unmapped']);

function mappingFieldStatus(field, entry) {
  if (!entry || !entry.name) return 'unmapped';
  const bound = fieldKey(entry.name);
  if (bound === fieldKey(field.header)) return 'exact';
  for (const alias of field.aliases || []) {
    if (bound === fieldKey(alias)) return 'alias';
  }
  // autoMapSchema'nın içerme kuralıyla AYNI eşik: 5 karakterden kısa adaylar
  // her şeyi yakaladığı için sayılmaz.
  for (const candidate of [field.header, ...(field.aliases || [])]) {
    const key = fieldKey(candidate);
    if (key.length < 5) continue;
    if (bound.includes(key) || key.includes(bound)) return 'weak';
  }
  return 'foreign';
}

/**
 * Saklanmış bir eşlemenin sağlık raporu.
 * Şema okumaz, ağa çıkmaz: yalnız katalog + saklanmış eşleme.
 */
function mappingHealth(role, mapping) {
  const map = mapping && typeof mapping === 'object' ? mapping : {};
  const suspects = new Set(suspectIdentityMappings(role, map).map(item => item.header));

  const fields = fieldsForRole(role).map(field => {
    const entry = normalizeMappingEntry(map[field.header]);
    let status = mappingFieldStatus(field, entry);
    /* Kimlik alanları (Sipariş Kod / Model Adı / Renk Kod) birebir
       karşılaştırmayla sipariş eşleştirmesinde kullanılır. Buradaki bir hata
       sessizdir: sorgu çalışır, eşleşme tutmaz. Bu yüzden şüpheli bir kimlik
       alanı, adı ne kadar benzerse benzesin gözden geçirmeye düşer. */
    if (suspects.has(field.header) && status !== 'unmapped') status = 'foreign';
    return {
      header: field.header,
      required: Boolean(field.required),
      usedBy: field.usedBy || '',
      status,
      identity: suspects.has(field.header),
      table: entry ? entry.table || '' : '',
      column: entry ? entry.name : '',
      kind: entry ? entry.kind || 'column' : '',
      // Kullanıcıya "ne bekliyordum" diyebilmek için.
      expected: [field.header, ...(field.aliases || [])],
    };
  });

  const is = (...statuses) => field => statuses.includes(field.status);
  const ok = fields.filter(is('exact', 'alias'));
  const review = fields.filter(is('weak', 'foreign'));
  const unmapped = fields.filter(is('unmapped'));
  const blocking = unmapped.filter(field => field.required);

  return {
    fields,
    summary: {
      total: fields.length,
      ok: ok.length,
      review: review.length,
      unmapped: unmapped.length,
      blocking: blocking.length,
      // Kullanıcının gerçekten bakması gereken satır sayısı. Ekranda öne çıkan
      // sayı budur; 37 değil.
      needsAttention: review.length + blocking.length,
    },
    reviewHeaders: review.map(field => field.header),
    blockingHeaders: blocking.map(field => field.header),
  };
}

module.exports = {
  FIELD_CATALOGUE, DERIVED_FIELDS, MAPPING_STATUSES,
  fieldKey, fieldsForRole, intakeFieldsForMapping, autoMapColumns, autoMapSchema,
  normalizeMappingEntry, mappingHasInvalidEntries, missingRequired, suspectIdentityMappings,
  productDescriptionNeedsRepair, repairAsasProductDescriptionMapping,
  mappingFieldStatus, mappingHealth,
};
