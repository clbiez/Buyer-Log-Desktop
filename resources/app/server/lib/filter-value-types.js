'use strict';

/* ===================================================================
   v7.83 — ŞEMA FARKINDA FİLTRE DEĞERLERİ

   ZİNCİR: şema metadata → kanonik tipli değer → sağlayıcıya özgü predicate

   NEDEN BU MODÜL VAR

   Filtre değeri üç katmandan geçiyor ve her katman onu METİN olarak taşıyor:
   distinct sorgusu `String(value)` ile okuyor, arayüz metin saklıyor, kayıt
   metin tutuyor. Sonra predicate üreticisi aynı metni DAX'a yine METİN olarak
   yazıyordu:

       'Dim_Urun'[UrunKlasmanKod] IN { "123" }

   Model tarafında o sütun SAYIYSA bu sorgu tip hatasıyla düşer. Kullanıcı
   listeden seçtiği bir değerin neden çalışmadığını göremez: değer doğrudur,
   yanlış olan TİPİDİR.

   Ters yön aynı derecede tehlikeli ve sessizdir: sütun METİNSE ve değer
   "00123" ise, "sayı gibi duruyor" diye sayıya çevirmek baştaki sıfırları
   yok eder ve filtre hiçbir satır tutmaz. Bu yüzden burada tek bir yön yok;
   ŞEMA ne diyorsa o.

   GÜVEN SEVİYESİ AYRI TUTULUR (`confidence`)

   Tip iki kaynaktan gelebilir:
     · 'schema'    — kaynağın kendi metadata'sı (DMV). Otoriterdir.
     · 'heuristic' — sütun adından tahmin ('... Tarih' → date). Tahmindir.

   Çağıran taraf bu ayrımı görmek zorunda: otoriter bir tiple değeri
   dönüştürmek doğruyu yapar, TAHMİNLE dönüştürmek çalışan bir kurulumu
   sessizce bozabilir. Bu yüzden zorlayıcı davranış (sayıya çevirme, hata
   verme) yalnız 'schema' güveninde uygulanır; tahminde bugünkü davranış
   (metin) korunur.

   BU MODÜL SAF: ağ, disk, DAX üreteci bağımlılığı yok. Girdi metadata ve
   metin, çıktı kanonik değer ve literal. Böylece canlı birim testi yazılır.
   =================================================================== */

const TYPES = Object.freeze(['text', 'number', 'date', 'boolean']);

/* OLE DB DBTYPE kodları. MDSCHEMA_LEVELS[LEVEL_DBTYPE] ve
   DBSCHEMA_COLUMNS[DATA_TYPE] bu sayıları döndürür. Liste OLE DB
   belirtimindendir; uydurma değildir ve eksik kod 'text'e düşmez —
   bilinmeyen kod için tip ÇÖZÜLMEMİŞ sayılır (aşağıda boş dönülür). */
const DBTYPE_CODES = Object.freeze({
  2: 'number',    // I2
  3: 'number',    // I4
  4: 'number',    // R4
  5: 'number',    // R8
  6: 'number',    // CY  (currency)
  7: 'date',      // DATE
  11: 'boolean',  // BOOL
  14: 'number',   // DECIMAL
  16: 'number',   // I1
  17: 'number',   // UI1
  18: 'number',   // UI2
  19: 'number',   // UI4
  20: 'number',   // I8
  21: 'number',   // UI8
  128: 'text',    // BYTES — filtrede metin gibi ele alınır
  129: 'text',    // STR
  130: 'text',    // WSTR
  131: 'number',  // NUMERIC
  133: 'date',    // DBDATE
  134: 'date',    // DBTIME
  135: 'date',    // DBTIMESTAMP
  72: 'text',     // GUID
  8: 'text',      // BSTR
});

/* Ada dayalı tip TAHMİNİ. v7.26'dan beri yürürlükte olan desenler birebir
   korunmuştur: burada yeni bir kural eklemek, bugün çalışan kurulumların
   tipini sessizce değiştirmek demek olurdu. */
const NAME_DATE = /(tarih|date|time|month|ay|year|yıl)/;
const NAME_NUMBER = /(miktar|adet|quantity|amount|fiyat|price|rate|oran|number|say[ıi])/;
const NAME_BOOLEAN = /^(is|has|aktif|active)|\b(flag|boolean|bool)\b|\bmi$/;

function clean(value) { return String(value == null ? '' : value).trim(); }

/** Ham metadata değerinden (metin ya da DBTYPE kodu) kanonik tip. */
function typeFromMetadata(raw) {
  const text = clean(raw).toLowerCase();
  if (!text) return '';
  if (/^\d+$/.test(text)) return DBTYPE_CODES[Number(text)] || '';
  if (/(bool|logical)/.test(text)) return 'boolean';
  if (/(date|time)/.test(text)) return 'date';
  if (/(int|decimal|double|single|currency|numeric|number|real|float|money)/.test(text)) return 'number';
  if (/(char|string|text|wstr|str)/.test(text)) return 'text';
  return '';
}

/** Sütun adından tip TAHMİNİ. Otoriter değildir. */
function typeFromName(name) {
  const text = clean(name).toLocaleLowerCase('tr-TR');
  if (!text) return '';
  if (NAME_DATE.test(text)) return 'date';
  if (NAME_NUMBER.test(text)) return 'number';
  if (NAME_BOOLEAN.test(text)) return 'boolean';
  return '';
}

/**
 * Bir şema/alan kaydının tipini ve güven seviyesini çözer.
 * @returns {{type:string, confidence:'schema'|'heuristic'|'none'}}
 */
function resolveType(entry) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const metadata = typeFromMetadata(item.dataType)
    || typeFromMetadata(item.data_type)
    || typeFromMetadata(item.DATA_TYPE)
    || typeFromMetadata(item.LEVEL_DBTYPE)
    || typeFromMetadata(item.type);
  if (metadata) return { type: metadata, confidence: 'schema' };
  const guess = typeFromName(item.name);
  if (guess) return { type: guess, confidence: 'heuristic' };
  return { type: 'text', confidence: 'none' };
}

/** Eski çağrı yerleri yalnız tip metnini bekler (horizon-fields.schemaFieldType). */
function schemaFieldType(entry) {
  return resolveType(entry).type;
}

const typeKey = (table, name) => `${clean(table).toLocaleLowerCase('tr-TR')}\u0000${clean(name).toLocaleLowerCase('tr-TR')}`;

/**
 * Şemadan sütun tipi çözücüsü kurar.
 *
 * Dönen fonksiyon YALNIZ OTORİTER tip döndürür: metadata yoksa boş string
 * döner ve çağıran taraf bugünkü davranışına (kaydedilmiş valueType) düşer.
 * Tahmine dayalı bir tiple predicate'i zorlamak, çalışan bir filtreyi sessizce
 * bozma riskidir; bu riski almayız.
 */
function columnTypeIndex(schema) {
  const index = new Map();
  const byName = new Map();
  for (const entry of (schema && Array.isArray(schema.columns) ? schema.columns : [])) {
    if (!entry || entry.kind === 'measure') continue;
    const resolved = resolveType(entry);
    if (resolved.confidence !== 'schema') continue;
    index.set(typeKey(entry.table, entry.name), resolved.type);
    // Tablo bilinmediğinde (eski kayıtlar tablo taşımaz) ada göre tek aday
    // varsa kullanılır; birden çok aday varsa TEKİLLİK BOZULUR ve çözülmez.
    const nameOnly = clean(entry.name).toLocaleLowerCase('tr-TR');
    if (!nameOnly) continue;
    if (byName.has(nameOnly) && byName.get(nameOnly) !== resolved.type) byName.set(nameOnly, null);
    else if (!byName.has(nameOnly)) byName.set(nameOnly, resolved.type);
  }
  return function columnType(table, name) {
    const exact = index.get(typeKey(table, name));
    if (exact) return exact;
    if (clean(table)) return '';
    return byName.get(clean(name).toLocaleLowerCase('tr-TR')) || '';
  };
}

/* --- Kanonik tipli değer ---------------------------------------------- */

const NUMBER_TEXT = /^-?\d+([.,]\d+)?$/;
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TRUE_TEXT = ['true', '1', 'yes', 'evet'];
const FALSE_TEXT = ['false', '0', 'no', 'hayır', 'hayir'];

/**
 * Metin gösterimi + şema tipi → kanonik tipli değer.
 *
 * `text` HER ZAMAN korunur: baştaki sıfırlar, boşluklar ve alfasayısal kodlar
 * metin tarafında hiçbir dönüşüm görmez. Sayıya çevirme yalnız tip 'number'
 * olduğunda yapılır — "sayı gibi duruyor" diye ASLA.
 */
function toCanonical(raw, type) {
  const wanted = TYPES.includes(type) ? type : 'text';
  const text = raw == null ? '' : String(raw).trim();
  if (wanted === 'number') {
    if (!NUMBER_TEXT.test(text)) return { ok: false, type: wanted, text, reason: 'NOT_A_NUMBER' };
    const number = Number(text.replace(',', '.'));
    if (!Number.isFinite(number)) return { ok: false, type: wanted, text, reason: 'NOT_A_NUMBER' };
    return { ok: true, type: wanted, text, number };
  }
  if (wanted === 'date') {
    const match = DATE_TEXT.exec(text);
    if (!match) return { ok: false, type: wanted, text, reason: 'NOT_A_DATE' };
    const [, y, m, d] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, type: wanted, text, reason: 'NOT_A_DATE' };
    return { ok: true, type: wanted, text, date: { year, month, day } };
  }
  if (wanted === 'boolean') {
    const key = text.toLowerCase();
    if (TRUE_TEXT.includes(key)) return { ok: true, type: wanted, text, boolean: true };
    if (FALSE_TEXT.includes(key)) return { ok: true, type: wanted, text, boolean: false };
    return { ok: false, type: wanted, text, reason: 'NOT_A_BOOLEAN' };
  }
  // Metin: gösterim NE İSE ODUR. "00123" sayıya çevrilmez, "1.0" yuvarlanmaz.
  return { ok: true, type: 'text', text };
}

/* --- Sağlayıcıya özgü predicate parçaları ------------------------------ */

function daxString(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}

/** Kanonik değerin DAX literali. Geçersiz değer için null döner. */
function daxLiteral(canonical) {
  if (!canonical || !canonical.ok) return null;
  if (canonical.type === 'number') return String(canonical.number);
  if (canonical.type === 'date') return `DATE(${canonical.date.year}, ${canonical.date.month}, ${canonical.date.day})`;
  if (canonical.type === 'boolean') return canonical.boolean ? 'TRUE()' : 'FALSE()';
  return daxString(canonical.text);
}

/**
 * Değer listesini tipli DAX literallerine çevirir.
 * @returns {{literals:string[], invalid:Array<{value:string, reason:string}>}}
 */
function daxValueList(values, type) {
  const literals = [], invalid = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    const canonical = toCanonical(value, type);
    const literal = daxLiteral(canonical);
    if (literal == null) invalid.push({ value: canonical.text, reason: canonical.reason || 'INVALID' });
    else literals.push(literal);
  }
  return { literals, invalid };
}

/**
 * Parametreli SQL destekleyen sağlayıcılar için bağlanabilir değer.
 * Değer GÖMÜLMEZ: çağıran taraf placeholder üretir, buradan yalnız tipli
 * JavaScript değeri gelir. Böylece kaçış/enjeksiyon sorusu hiç doğmaz.
 */
function sqlParam(canonical) {
  if (!canonical || !canonical.ok) return null;
  if (canonical.type === 'number') return canonical.number;
  if (canonical.type === 'boolean') return canonical.boolean;
  if (canonical.type === 'date') {
    const { year, month, day } = canonical.date;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return canonical.text;
}

function sqlParams(values, type) {
  const params = [], invalid = [];
  for (const value of (Array.isArray(values) ? values : [])) {
    const canonical = toCanonical(value, type);
    const param = sqlParam(canonical);
    if (param == null) invalid.push({ value: canonical.text, reason: canonical.reason || 'INVALID' });
    else params.push(param);
  }
  return { params, invalid };
}

/** Metin işleçleri (contains/startsWith) yalnız metin sütununda anlamlıdır. */
function supportsTextOperators(type) {
  return type !== 'number' && type !== 'date' && type !== 'boolean';
}

module.exports = {
  TYPES, DBTYPE_CODES,
  typeFromMetadata, typeFromName, resolveType, schemaFieldType,
  columnTypeIndex,
  toCanonical,
  daxString, daxLiteral, daxValueList,
  sqlParam, sqlParams,
  supportsTextOperators,
};
