'use strict';

/*
 * Ufuk (horizon) → DAX sorgusu.
 *
 * Kaynak modelde sipariş tablosu tamamıyla çok büyük. Pivottaki iş filtrelerini
 * uygulamaya taşıdık; burada kalan tek şey HACİM sınırı: hangi sezonlar ve hangi
 * tarih aralığı çekilsin.
 *
 * ÖNEMLİ TASARIM KARARI — sezon ve tarih VEYA ile bağlanır, VE ile değil.
 * Sebebi: iki kriter farklı ihtiyaçlara hizmet eder. Sezon listesi "şu koleksiyonun
 * tamamı gelsin" der (tarihi ne olursa olsun), tarih aralığı ise "şu dönemde hareketi
 * olanlar gelsin" der (sezonu ne olursa olsun). Kesişim alınırsa iki taraf da eksik
 * kalır; birleşim ikisini de karşılar.
 *
 * Bu modül saf tutulmuştur: hiçbir yan etkisi yoktur, sorgu metnini üretir ve
 * doğrulama uyarılarını döndürür. Böylece gerçek bir modele bağlanmadan test edilir.
 */

const MAX_SEASONS = 60;

class HorizonError extends Error {
  constructor(message, code = 'HORIZON_INVALID') {
    super(message);
    this.name = 'HorizonError';
    this.code = code;
    this.statusCode = 400;
  }
}

// DAX'ta tablo adı tek tırnak içinde yazılır ve içindeki tek tırnak ikilenir.
function quoteTable(name) {
  const text = String(name == null ? '' : name).trim();
  if (!text) throw new HorizonError('Tablo adı boş olamaz.');
  return `'${text.replace(/'/g, "''")}'`;
}
// Sütun adı köşeli parantez içinde yazılır; içindeki kapanış parantezi ikilenir.
function quoteColumn(table, column) {
  // Bir eşleme girdisi {table,name,kind} nesnesidir. Bu nesne yanlışlıkla doğrudan
  // buraya gelirse String(object) => "[object Object]" olur ve model tarafında
  // anlaşılması zor bir "Column '[object Object]' cannot be found" hatası çıkar.
  // Sessizce bozuk DAX üretmek yerine hatayı sorgu gönderilmeden yakala.
  if (column && typeof column === 'object') {
    throw new HorizonError('Alan eşlemesindeki sütun çözümlenemedi. Data Model Connection alan eşlemesini yeniden seçin.', 'MAPPING_INVALID');
  }
  const text = String(column == null ? '' : column).trim();
  if (!text) throw new HorizonError('Sütun adı boş olamaz.');
  return `${quoteTable(table)}[${text.replace(/]/g, ']]')}]`;
}
function quoteString(value) {
  return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
}
// 'YYYY-MM-DD' → DAX DATE(...). Geçersiz biçim null döner.
function daxDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y); const month = Number(m); const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `DATE(${year}, ${month}, ${day})`;
}

function normalizeSeasons(list) {
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(list) ? list : String(list == null ? '' : list).split(/[,;\s]+/))) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) continue;
    const key = value.toLocaleUpperCase('tr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_SEASONS) break;
  }
  return out;
}

function normalizeHorizon(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
  const table = text(item.table, 200);
  return {
    table,
    // Sezon ve tarih alanları ana sorgu tablosundan farklı boyut tablolarında
    // bulunabilir. Eski kayıtlarda bu iki tablo alanı yoktur; geriye dönük
    // uyumluluk için ana tabloya düşülür.
    seasonTable: text(item.seasonTable, 200) || table,
    seasonField: text(item.seasonField, 200) || 'Sezon',
    seasons: normalizeSeasons(item.seasons),
    dateTable: text(item.dateTable, 200) || table,
    dateField: text(item.dateField, 200) || 'Orijinal Exfactory Merch Tarih',
    dateStart: text(item.dateStart, 10),
    dateEnd: text(item.dateEnd, 10),
    groups: modelConditions.normalizeGroups(item.groups, text(item.table, 200)),
    extraExpression: String(item.extraExpression == null ? '' : item.extraExpression),
  };
}

const modelConditions = require('./model-conditions');
const filterValueTypes = require('./filter-value-types');

// Uygulamanın kendi ürettiği ek bir DAX koşulunu (kullanıcı girdisi değil) mevcut
// ufkun ÜSTÜNE VE ile ekler. Antrepo'yu ASAS sipariş kodlarıyla sınırlamak için.
function withExtra(expression, extra) {
  const addition = String(extra || '').trim();
  if (!addition) return expression || null;
  if (!expression) return addition;
  return `( ${expression} )\n        && ( ${addition} )`;
}

// --- Tek bir koşulun DAX karşılığı ------------------------------------------
function daxNumber(value) {
  const text = String(value == null ? '' : value).trim().replace(',', '.');
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return text;
}

/* v7.83 — TİP ŞEMADAN ÇÖZÜLÜR, ARAYÜZ GÖSTERİMİNDEN DEĞİL.

   Koşul kaydında `valueType` var; ama bu, koşul KURULDUĞU ANDAKİ arayüz
   tahminidir. Model sütunu sayıysa ve kayıtta 'text' yazıyorsa
   `IN { "123" }` üretiliyor ve sorgu tip hatasıyla düşüyordu — kaydedilip
   yeniden yüklenen filtrelerde ve iki model arasında taşınan koşullarda.

   Bu yüzden ÖNCE kaynağın kendi şeması sorulur (`options.columnType`).
   Şema bir tip veriyorsa o tip otoriterdir. Şema yoksa ya da sütunun tip
   metadata'sı okunamadıysa çözücü boş döner ve kayıtlı `valueType`
   kullanılır — yani bugünkü davranış. Tahmine dayalı bir tiple çalışan bir
   filtreyi sessizce değiştirmeyiz. */
function effectiveValueType(condition, ref, options) {
  const resolver = options && typeof options.columnType === 'function' ? options.columnType : null;
  if (resolver) {
    try {
      const fromSchema = resolver(ref && ref.table, ref && ref.name);
      if (fromSchema) return fromSchema;
    } catch (_) { /* çözücü patlarsa kayıtlı tipe düşülür */ }
  }
  return condition && condition.valueType ? condition.valueType : 'text';
}
function conditionLiteral(condition, value, valueType) {
  const wanted = valueType || (condition && condition.valueType) || 'text';
  const canonical = filterValueTypes.toCanonical(value, wanted);
  const literal = filterValueTypes.daxLiteral(canonical);
  if (literal != null) return literal;
  if (wanted === 'date') throw new HorizonError(`Geçersiz tarih: ${value} (YYYY-AA-GG bekleniyor).`);
  if (wanted === 'number') throw new HorizonError(`Geçersiz sayı: ${value}`);
  if (wanted === 'boolean') throw new HorizonError(`Geçersiz boolean değer: ${value}`);
  throw new HorizonError(`Geçersiz değer: ${value}`);
}

/* v7.26 — KOŞUL SÜTUNU ALAN EŞLEMESİNDEN ÇÖZÜLÜR.

   Ufuk koşulları eskiden model şemasından seçiliyordu; koşuldaki `field`
   doğrudan modeldeki sütun adıydı ve DAX'a olduğu gibi yazılabiliyordu.
   v7.26'daki yeni Sayfa Ufku ekranı ise alanları ASAS BAŞLIĞIYLA sunuyor
   (MAG = 'Merch Alt Grup Kod'). Modeldeki sütun başka adla duruyorsa
   (ör. 'MAG Kodu') başlığı olduğu gibi yazmak, var olmayan bir sütuna
   filtre koymak demekti — sorgu ya hata verir ya sessizce boş döner.

   Eşleme, SELECT tarafında zaten kullanılıyordu (buildProjectionQuery /
   buildSummarizeQuery). Artık WHERE tarafında da kullanılıyor: başlık
   eşlemede varsa modeldeki gerçek {tablo, sütun} yazılır, yoksa alan adı
   eskisi gibi doğrudan kullanılır (şemadan seçilmiş eski ufuklar bozulmaz). */
function conditionColumnRef(condition, mapping, fallbackTable) {
  const field = String(condition && condition.field || '').trim();
  const entry = mapping && typeof mapping === 'object' ? mapping[field] : null;
  if (entry) {
    const raw = typeof entry === 'object' ? entry : { name: entry };
    const name = String(raw.name == null ? '' : raw.name).trim();
    // Ölçüler (measure) satır bağlamında filtrelenemez; eşleme bir ölçüyü
    // gösteriyorsa alan adına düşülür ve yanlış DAX üretilmez.
    if (name && raw.kind !== 'measure') {
      return { table: String(raw.table || condition.table || fallbackTable || '').trim(), name };
    }
  }
  return {
    table: String(condition && condition.table || fallbackTable || '').trim(),
    name: String(condition && condition.name || field).trim(),
  };
}
function buildConditionExpression(condition, mapping, fallbackTable, options = {}) {
  if (!condition.field) throw new HorizonError('Koşul için sütun seçilmedi.', 'CONDITION_NO_FIELD');
  const ref = conditionColumnRef(condition, mapping, fallbackTable);
  if (!ref.table) throw new HorizonError(`"${condition.field}" koşulu için tablo bilinmiyor.`, 'CONDITION_NO_TABLE');
  const column = quoteColumn(ref.table, ref.name);
  const op = condition.op;
  const valueType = effectiveValueType(condition, ref, options);

  /* Boşluk sınaması metin karşılaştırması içerir; sayısal ve tarih sütununda
     `= ""` tip hatası verir. ISBLANK her tipte çalışır. */
  const textish = filterValueTypes.supportsTextOperators(valueType);
  if (op === 'empty') return textish ? `( ISBLANK(${column}) || ${column} = "" )` : `ISBLANK(${column})`;
  if (op === 'notEmpty') return textish ? `NOT ( ISBLANK(${column}) || ${column} = "" )` : `NOT ( ISBLANK(${column}) )`;

  if (op === 'in' || op === 'notIn') {
    if (!condition.values.length) throw new HorizonError(`"${condition.field}" koşulu için değer girilmedi.`, 'CONDITION_NO_VALUES');
    const list = condition.values.map(value => conditionLiteral(condition, value, valueType)).join(', ');
    const expression = `${column} IN { ${list} }`;
    return op === 'notIn' ? `NOT ( ${expression} )` : expression;
  }

  if (op === 'contains') {
    const needle = condition.values[0] || '';
    if (!needle) throw new HorizonError(`"${condition.field}" koşulu için aranacak metin girilmedi.`, 'CONDITION_NO_VALUES');
    /* SEARCH/LEFT metin işlevleridir. Sayısal veya tarih bir sütunda bunları
       üretmek sorguyu tip hatasıyla düşürürdü; sebep de görünmezdi. Hata
       burada, alanın ADIYLA verilir — kullanıcı hangi koşulu düzelteceğini bilir. */
    if (!textish) throw new HorizonError(`"${condition.field}" sayısal/tarih bir alan; "içerir" koşulu yalnız metin alanlarında kullanılabilir.`, 'CONDITION_TYPE_UNSUPPORTED');
    return `SEARCH(${quoteString(needle)}, ${column}, 1, 0) > 0`;
  }
  if (op === 'startsWith') {
    const prefix = condition.values[0] || '';
    if (!prefix) throw new HorizonError(`"${condition.field}" koşulu için önek girilmedi.`, 'CONDITION_NO_VALUES');
    if (!textish) throw new HorizonError(`"${condition.field}" sayısal/tarih bir alan; "ile başlar" koşulu yalnız metin alanlarında kullanılabilir.`, 'CONDITION_TYPE_UNSUPPORTED');
    return `LEFT(${column}, ${prefix.length}) = ${quoteString(prefix)}`;
  }

  const from = condition.from ? conditionLiteral(condition, condition.from, valueType) : null;
  const to = condition.to ? conditionLiteral(condition, condition.to, valueType) : null;
  if (op === 'gte') {
    if (!from) throw new HorizonError(`"${condition.field}" koşulu için alt sınır girilmedi.`, 'CONDITION_NO_VALUES');
    return `${column} >= ${from}`;
  }
  if (op === 'lte') {
    if (!to) throw new HorizonError(`"${condition.field}" koşulu için üst sınır girilmedi.`, 'CONDITION_NO_VALUES');
    return `${column} <= ${to}`;
  }
  if (op === 'between') {
    if (!from || !to) throw new HorizonError(`"${condition.field}" aralığı için iki sınır da gerekli.`, 'CONDITION_NO_VALUES');
    if (valueType !== 'number' && condition.from > condition.to) {
      throw new HorizonError(`"${condition.field}" aralığında başlangıç bitişten sonra olamaz.`);
    }
    return `( ${column} >= ${from} && ${column} <= ${to} )`;
  }
  throw new HorizonError(`Bilinmeyen koşul işleci: ${op}`, 'CONDITION_BAD_OP');
}

// Grup içi VE, gruplar arası VEYA.
function buildGroupsExpression(groups, mapping, fallbackTable, options = {}) {
  const parts = [];
  for (const group of groups) {
    const conditions = group.conditions.filter(condition => condition.field);
    if (!conditions.length) continue;
    const expressions = conditions.map(condition => buildConditionExpression(condition, mapping, fallbackTable, options));
    parts.push(expressions.length > 1 ? `( ${expressions.join('\n            && ')} )` : expressions[0]);
  }
  return parts;
}

/* v7.84 — Koşulların HANGİ SÜTUNA düştüğü de taşınır.
   INTAKE kaynak filtresi tek bir tabloya ait değildir: koşullar Dim_Urun,
   SupplyBasket, Dim_Sezon gibi ayrı tablolara dağılır ve ufkun kendi
   `table` alanı boştur. `FILTER(<tablo>, ifade)` bu durumda üretilemez;
   sütun bilgisi olmadan tek çare hata fırlatmaktı ve kullanıcının seçtiği
   kaynak filtresi Yenile'de hiç uygulanamıyordu. */
function groupConditionParts(groups, mapping, fallbackTable, options = {}) {
  return groups.map(group => group.conditions.filter(condition => condition.field).map(condition => {
    const ref = conditionColumnRef(condition, mapping, fallbackTable);
    return {
      table: String(ref.table || '').trim(),
      name: String(ref.name || '').trim(),
      expression: buildConditionExpression(condition, mapping, fallbackTable, options),
    };
  }));
}

/**
 * Ufuk ayarından DAX filtre ifadesi üretir.
 * Döner: { expression, usedSeasons, usedDates, warnings }
 * expression null ise hiçbir sınır yok demektir (tüm tablo).
 */
// Ufuk koşullarının insan okuyabilir özeti.
//
// Sayfa filtresi seçenekleri YALNIZ çekilmiş satırlardan üretildiği için, ufkun
// dışarıda bıraktığı bir sezon filtre listesinde hiç görünmez: "yok" ile
// "çekilmedi" ayırt edilemez. Bu özet, CP/Backlog/LFL sayfalarındaki ufuk
// rozetinde gösterilir ki çalışma evreninin sınırı görünür olsun.
const CONDITION_OP_TEXT = {
  in: (field, values) => `${field}: ${values}`,
  notIn: (field, values) => `${field} dışında: ${values}`,
  contains: (field, values) => `${field} içerir: ${values}`,
  startsWith: (field, values) => `${field} ile başlar: ${values}`,
  empty: field => `${field} boş`,
  notEmpty: field => `${field} dolu`,
};

function describeConditionValues(condition) {
  const values = Array.isArray(condition.values) ? condition.values.filter(value => value !== '' && value != null) : [];
  if (values.length <= 4) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} +${values.length - 3} değer`;
}

function describeCondition(condition) {
  const field = String(condition.field || '').trim();
  if (!field) return '';
  const op = condition.op;
  if (CONDITION_OP_TEXT[op]) return CONDITION_OP_TEXT[op](field, describeConditionValues(condition));
  const from = String(condition.from || '').trim();
  const to = String(condition.to || '').trim();
  if (op === 'gte') return `${field} ≥ ${from}`;
  if (op === 'lte') return `${field} ≤ ${to}`;
  if (op === 'between') return `${field}: ${from} – ${to}`;
  return field;
}

/**
 * Döner: { bounded, groups: [[metin, ...], ...], text }
 * bounded false ise hiçbir koşul yok — tüm tablo çekiliyor demektir.
 */
function describeHorizon(horizonInput) {
  let horizon;
  try { horizon = normalizeHorizon(horizonInput); }
  catch { return { bounded: false, groups: [], text: '' }; }
  const groups = modelConditions.normalizeGroups(horizon.groups, horizon.table)
    .map(group => group.conditions.filter(condition => condition.field).map(describeCondition).filter(Boolean))
    .filter(parts => parts.length);
  if (!groups.length) return { bounded: false, groups: [], text: '' };
  // Grup içi VE, gruplar arası VEYA — buildGroupsExpression ile aynı mantık.
  const text = groups.map(parts => parts.join(' ve ')).join(' VEYA ');
  return { bounded: true, groups, text };
}

function buildHorizonFilter(horizonInput, projectionMapping = null, options = {}) {
  // Filtre koşulları projeksiyondan çıkarılmış (Ufuk) alanları da çözebilmeli:
  // çağıran taraf tam eşlemeyi options.filterMapping olarak verebilir.
  const mapping = options && options.filterMapping ? options.filterMapping : projectionMapping;
  const horizon = normalizeHorizon(horizonInput);
  const warnings = [];

  // Serbest koşul grupları tanımlıysa eski sezon/tarih alanları yerine onlar geçerlidir.
  const groups = modelConditions.normalizeGroups(horizon.groups, horizon.table);
  const activeGroups = groups.filter(group => group.conditions.some(condition => condition.field));
  if (activeGroups.length) {
    const parts = buildGroupsExpression(activeGroups, mapping, horizon.table, options);
    if (parts.length > 1) {
      warnings.push(`${parts.length} koşul grubu VEYA ile birleştirildi: gruplardan herhangi birini sağlayan satırlar gelir.`);
    }
    const totalConditions = activeGroups.reduce((sum, group) => sum + group.conditions.filter(c => c.field).length, 0);
    const conditionGroups = groupConditionParts(activeGroups, mapping, horizon.table, options);
    return {
      expression: withExtra(parts.join('\n        || '), horizon.extraExpression),
      usedSeasons: false, usedDates: false,
      usedGroups: true, groupCount: parts.length, conditionCount: totalConditions,
      conditionGroups,
      warnings, horizon,
    };
  }

  const clauses = [];

  if (horizon.seasons.length) {
    if (!horizon.seasonField) throw new HorizonError('Sezon seçildi ama sezon sütunu belirtilmedi.');
    const values = horizon.seasons.map(quoteString).join(', ');
    // Sezon sütunu da eşlemeden çözülür: ASAS başlığı 'Sezon' iken modeldeki
    // sütun başka adla durabilir.
    const seasonRef = conditionColumnRef({ field: horizon.seasonField, table: horizon.seasonTable || horizon.table }, mapping, horizon.table);
    clauses.push(`${quoteColumn(seasonRef.table, seasonRef.name)} IN { ${values} }`);
  }

  const start = horizon.dateStart ? daxDate(horizon.dateStart) : null;
  const end = horizon.dateEnd ? daxDate(horizon.dateEnd) : null;
  if (horizon.dateStart && !start) throw new HorizonError('Başlangıç tarihi geçersiz (YYYY-AA-GG bekleniyor).');
  if (horizon.dateEnd && !end) throw new HorizonError('Bitiş tarihi geçersiz (YYYY-AA-GG bekleniyor).');
  if (start && end && horizon.dateStart > horizon.dateEnd) {
    throw new HorizonError('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  }
  if (start || end) {
    if (!horizon.dateField) throw new HorizonError('Tarih aralığı verildi ama tarih sütunu belirtilmedi.');
    const dateRef = conditionColumnRef({ field: horizon.dateField, table: horizon.dateTable || horizon.table }, mapping, horizon.table);
    const column = quoteColumn(dateRef.table, dateRef.name);
    const bounds = [];
    if (start) bounds.push(`${column} >= ${start}`);
    if (end) bounds.push(`${column} <= ${end}`);
    // Tarih boş olan satırlar karşılaştırmada elenir; bu bilinçli: tarihi olmayan bir
    // sipariş zaman ufkuna yerleştirilemez. Sezon kriteri onları yine yakalayabilir.
    clauses.push(bounds.length > 1 ? `( ${bounds.join(' && ')} )` : bounds[0]);
  }

  if (!clauses.length) {
    if (horizon.extraExpression) {
      return { expression: horizon.extraExpression, usedSeasons: false, usedDates: false, warnings, horizon };
    }
    warnings.push('Sezon ve tarih aralığı boş; tablonun tamamı çekilecek.');
    return { expression: null, usedSeasons: false, usedDates: false, warnings, horizon };
  }
  if (clauses.length > 1) {
    warnings.push('Sezon ve tarih kriterleri VEYA ile birleştirildi: iki koşuldan birini sağlayan satırlar gelir.');
  }
  return {
    expression: withExtra(clauses.join('\n        || '), horizon.extraExpression),
    usedSeasons: horizon.seasons.length > 0,
    usedDates: Boolean(start || end),
    warnings, horizon,
  };
}

/**
 * Tam EVALUATE sorgusunu kurar.
 * options.topN verilirse sonuç TOPN ile sınırlanır (deneme çalıştırmaları için).
 */
function buildHorizonQuery(horizonInput, options = {}) {
  /* v7.83 — `options` FİLTREYE DE GEÇER. Eşlemesiz (ham tablo) sorgu yolunda
     options düşürülüyordu: Test/Run ve önizleme, şemadan çözülmüş tipi kaybedip
     kayıtlı tahminle DAX üretiyordu. Aynı ufuk yenilemede çalışıp denemede tip
     hatasıyla düşüyordu. */
  const filter = buildHorizonFilter(horizonInput, null, options);
  const table = quoteTable(filter.horizon.table);
  const body = filter.expression
    ? `FILTER(\n    ${table},\n    ${filter.expression}\n)`
    : table;
  const topN = Number(options.topN) > 0 ? Math.floor(Number(options.topN)) : 0;
  const query = topN
    ? `EVALUATE\nTOPN(${topN}, ${body.replace(/\n/g, '\n    ')})`
    : `EVALUATE\n${body}`;
  return { query, ...filter };
}

/**
 * Alan eşlemesinden SELECTCOLUMNS üretir: çıktı sütunları uygulamanın beklediği
 * başlık adlarını taşır, böylece mevcut ayrıştırma mantığı değişmeden çalışır.
 * mapping: { 'Sipariş Kod': 'ModeldekiSutunAdi', ... }
 */
function normalizeMappingEntries(horizonInput, mapping) {
  const fallbackTable = normalizeHorizon(horizonInput).table;
  return Object.entries(mapping && typeof mapping === 'object' ? mapping : {})
    .map(([header, value]) => {
      const raw = value && typeof value === 'object'
        ? value
        : { table: fallbackTable, name: value, kind: 'column' };
      return {
        header: String(header || '').trim(),
        table: String(raw.table || fallbackTable || '').trim(),
        name: String(raw.name == null ? '' : raw.name).trim(),
        kind: raw.kind === 'measure' ? 'measure' : 'column',
      };
    })
    .filter(entry => entry.header && entry.name);
}

function buildProjectionQuery(horizonInput, mapping, options = {}) {
  const filter = buildHorizonFilter(horizonInput, mapping, options);
  const table = quoteTable(filter.horizon.table);
  const entries = normalizeMappingEntries(filter.horizon, mapping);
  if (!entries.length) throw new HorizonError('Hiçbir alan eşleştirilmedi.', 'MAPPING_EMPTY');
  if (entries.some(entry => entry.kind === 'measure')) {
    throw new HorizonError('Ölçü içeren eşleme SELECTCOLUMNS ile oluşturulamaz.', 'MAPPING_MEASURE_REQUIRES_SUMMARIZE');
  }

  const source = filter.expression
    ? `FILTER(\n        ${table},\n        ${filter.expression.replace(/\n/g, '\n    ')}\n    )`
    : table;
  const projection = entries
    .map(entry => `        ${quoteString(entry.header)}, ${quoteColumn(entry.table || filter.horizon.table, entry.name)}`)
    .join(',\n');

  const body = `SELECTCOLUMNS(\n    ${source},\n${projection}\n)`;
  const topN = Number(options.topN) > 0 ? Math.floor(Number(options.topN)) : 0;
  const query = topN ? `EVALUATE\nTOPN(${topN}, ${body})` : `EVALUATE\n${body}`;
  return { query, fieldCount: entries.length, ...filter };
}

/**
 * Ölçü (measure) içeren eşlemeler için SUMMARIZECOLUMNS üretir.
 *
 * NEDEN AYRI BİR ŞEKİL: SELECTCOLUMNS satır bağlamında çalışır ve bir ölçüyü doğru
 * değerlendiremez. Tabular modelde FOB ve miktar alanları genellikle ölçüdür; bunları
 * boyut sütunlarıyla birlikte getirmenin doğru yolu, pivotun da yaptığı gibi
 * SUMMARIZECOLUMNS ile gruplayıp ölçüleri ad/ifade çifti olarak eklemektir.
 *
 * Alanlar farklı tablolardan gelebilir; modeldeki ilişkiler üzerinden birleşirler.
 *
 * ÇIKTI ADLARI: SUMMARIZECOLUMNS grup sütunlarını "Tablo[Sütun]" adıyla döndürür.
 * Uygulamanın beklediği başlıklara çevirmeyi DAX içinde yapmak kaçış karakteri
 * cehennemi yaratıyor; bunun yerine headerMap döndürülür ve yeniden adlandırma
 * sonucu yazarken uygulanır.
 */
// SUMMARIZECOLUMNS'ın boş-ölçü satırlarını elemesini engelleyen koruma sütununun adı.
// Uygulamanın beklediği hiçbir başlıkla çakışmaz; ayrıştırıcılar yok sayar.
const BLANK_ROW_GUARD = '__BLRowGuard';

// DAX tablo sütunları ad karşılaştırmasında büyük/küçük harfe duyarlı değildir.
// Aynı fiziksel sütun farklı Buyer Log başlıklarına veya boşluk/case farklarına
// bağlanmışsa SUMMARIZECOLUMNS'a yalnızca bir kez girmelidir.
function physicalColumnKey(entry) {
  const normalizeIdentifier = value => String(value || '')
    .trim()
    .normalize('NFC')
    .toUpperCase()
    .replace(/İ/g, 'I');
  const table = normalizeIdentifier(entry && entry.table);
  const name = normalizeIdentifier(entry && entry.name);
  return `${table}::${name}`;
}

function uniquePhysicalColumns(entries) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = physicalColumnKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* v7.81 — Ufku SUMMARIZECOLUMNS filtre argümanlarına çevirir.
   İki tüketici: model yenilemesi (buildSummarizeQuery) ve INTAKE pivot
   raporu. Seçimler performans içindir, süsleme değil:
     · yalnız sezon → TREATAS (motor sütun sözlüğüne doğrudan uygular)
     · yalnız tarih → FILTER(ALL(sütun), …) (tüm tablo yerine tek sütun)
     · karışık/gruplar → FILTER(tablo, ifade) (VEYA semantiği korunur)
   indent, çağıranın sorgu biçimine uyar; varsayılan mevcut davranıştır. */
function summarizeFilterArgs(filter, indent = '    ') {
  if (!filter || !filter.expression) return [];
  const inner = `${indent}    `;
  if (filter.usedSeasons && !filter.usedDates) {
    const values = filter.horizon.seasons.map(quoteString).join(', ');
    return [`${indent}TREATAS({ ${values} }, ${quoteColumn(filter.horizon.seasonTable || filter.horizon.table, filter.horizon.seasonField)})`];
  }
  if (filter.usedDates && !filter.usedSeasons) {
    const column = quoteColumn(filter.horizon.dateTable || filter.horizon.table, filter.horizon.dateField);
    const bounds = [];
    const start = filter.horizon.dateStart ? daxDate(filter.horizon.dateStart) : null;
    const end = filter.horizon.dateEnd ? daxDate(filter.horizon.dateEnd) : null;
    if (start) bounds.push(`${column} >= ${start}`);
    if (end) bounds.push(`${column} <= ${end}`);
    return [`${indent}FILTER(ALL(${column}), ${bounds.join(' && ')})`];
  }
  /* Ufkun kendi tablosu yoksa (INTAKE kaynak filtresi) koşulların sütun
     bilgisinden argüman üretilir. SUMMARIZECOLUMNS argümanları VE ile
     birleştiği için TEK GRUP (grup içi VE) birebir karşılanır: her koşul
     kendi sütununda FILTER(ALL(sütun), …) olur — tarih dalıyla aynı desen.
     Birden çok grup VEYA demektir; tek ifadeye tek tablo gerektiğinden
     koşulların hepsi aynı tablodaysa o tablo kullanılır. */
  const horizonTable = String(filter.horizon.table == null ? '' : filter.horizon.table).trim();
  const conditionGroups = Array.isArray(filter.conditionGroups) ? filter.conditionGroups : [];
  if (!horizonTable && conditionGroups.length) {
    const flat = conditionGroups.flat();
    const usable = flat.length && flat.every(part => part.table && part.name);
    if (conditionGroups.length === 1 && usable && !String(filter.horizon.extraExpression || '').trim()) {
      return conditionGroups[0].map(part => `${indent}FILTER(ALL(${quoteColumn(part.table, part.name)}), ${part.expression})`);
    }
    const tables = [...new Set(flat.map(part => part.table).filter(Boolean))];
    if (tables.length === 1) {
      return [`${indent}FILTER(\n${inner}${quoteTable(tables[0])},\n${inner}${filter.expression.replace(/\n/g, `\n${indent}`)}\n${indent})`];
    }
    throw new HorizonError('Kaynak filtresi birden çok tabloya yayılmış VEYA grupları içeriyor; bu filtre tek sorguya çevrilemiyor. Grupları tek gruba indirin.', 'HORIZON_MULTI_TABLE_GROUPS');
  }
  return [`${indent}FILTER(\n${inner}${quoteTable(filter.horizon.table)},\n${inner}${filter.expression.replace(/\n/g, `\n${indent}`)}\n${indent})`];
}
function buildSummarizeQuery(horizonInput, mapping, options = {}) {
  const filter = buildHorizonFilter(horizonInput, mapping, options);
  const entries = normalizeMappingEntries(filter.horizon, mapping);
  if (!entries.length) throw new HorizonError('Hiçbir alan eşleştirilmedi.', 'MAPPING_EMPTY');

  const groupBy = uniquePhysicalColumns(entries.filter(entry => entry.kind === 'column'));
  const measures = entries.filter(entry => entry.kind === 'measure');
  if (!groupBy.length) throw new HorizonError('En az bir sütun (ölçü olmayan alan) eşleştirilmeli.', 'MAPPING_NO_COLUMNS');

  const headerMap = {};
  const args = [];
  for (const entry of groupBy) {
    if (!entry.table) throw new HorizonError(`"${entry.header}" için tablo adı bilinmiyor.`, 'MAPPING_NO_TABLE');
    args.push(`    ${quoteColumn(entry.table, entry.name)}`);
    headerMap[`${entry.table}[${entry.name}]`] = entry.header;
  }
  /* v7.81 — filtre argümanı üretimi summarizeFilterArgs()a taşındı;
     INTAKE pivot raporu da aynı mantığı kullanıyor. */
  summarizeFilterArgs(filter).forEach(arg => args.push(arg));
  for (const entry of measures) {
    // Ölçü adları tabular modelde tekildir; köşeli parantezle doğrudan çağrılır.
    args.push(`    ${quoteString(entry.header)}, [${entry.name.replace(/]/g, ']]')}]`);
    headerMap[entry.header] = entry.header;
  }
  if (measures.length) {
    // BOŞ ÖLÇÜ SATIRI ELEME KORUMASI — ve neden sabit 1 OLMAZ.
    //
    // SUMMARIZECOLUMNS iki iş birden yapar:
    //   (a) genişletme (extension) sütunlarının HEPSİ BLANK olan grupları eler,
    //   (b) farklı tablolardan gelen gruplama sütunlarını bu eleme sayesinde
    //       birbirine BAĞLAR — var olmayan kombinasyonlar (a) ile düşer.
    //
    // v4.12'de (a)'yı kapatmak için sabit `1` eklendi. Bu (b)'yi de kapattı:
    // 'Siparis Bilgileri' kombinasyonları ile 'Ithalat' kombinasyonlarının TAM
    // KARTEZYEN ÇARPIMI üretilmeye başlandı (yüz binlerce × on binlerce satır) ve
    // sunucu "There's not enough memory to complete this operation" hatası verdi.
    //
    // Doğru koruma: sabit değer yerine VARLIK ölçüsü. Gruplamaya katılan her
    // tablonun geçerli filtre bağlamında satırı varsa 1, yoksa BLANK döner. Böylece
    //   · var olmayan kombinasyonlar yine elenir (kartezyen çarpım oluşmaz),
    //   · ama kullanıcının ölçüsü (ör. HANDOVER Tarihi) boş olsa bile satır KALIR —
    //     asıl düzeltmek istediğimiz durum buydu: henüz handover'ı olmayan
    //     Yükleme Operasyonları satırları artık sonuca giriyor.
    const tables = [...new Set(groupBy.map(entry => entry.table).filter(Boolean))];
    const existence = tables.map(table => `NOT ISBLANK(COUNTROWS(${quoteTable(table)}))`).join(' && ');
    args.push(`    ${quoteString(BLANK_ROW_GUARD)}, IF(${existence}, 1)`);
  }

  const body = `SUMMARIZECOLUMNS(\n${args.join(',\n')}\n)`;
  const topN = Number(options.topN) > 0 ? Math.floor(Number(options.topN)) : 0;
  const query = topN ? `EVALUATE\nTOPN(${topN}, ${body})` : `EVALUATE\n${body}`;
  return {
    query, headerMap,
    columnCount: groupBy.length, measureCount: measures.length,
    tables: [...new Set(groupBy.map(entry => entry.table))],
    ...filter,
  };
}

/**
 * IAS gibi gerçek satır granülünün korunması gereken modeller için fact-row
 * sorgusu üretir. SUMMARIZECOLUMNS grup oluşturduğu için farklı tablolardan gelen
 * alanları çapraz çoğaltabilir ve aynı parsiyelleri tek satırda toplayabilir.
 * Burada başlangıç tablosu doğrudan gerçek fact tablosudur; SELECTCOLUMNS her fact
 * satırını aynen korur. Ölçüler CALCULATE ile yalnız o satırın bağlamında
 * değerlendirilir, ilişkili tablo sütunları ise tek değer değilse BLANK döner.
 * Böylece belirsiz bir ilişki yanlış değere dönüşmez.
 */
function buildFactRowQuery(horizonInput, mapping, options = {}) {
  const filter = buildHorizonFilter(horizonInput, mapping, options);
  const grainTable = String(options.grainTable || '').trim();
  if (!grainTable) {
    throw new HorizonError('Satır bazlı sorgu için gerçek fact/grain tablosu belirtilmedi.', 'MAPPING_GRAIN_TABLE_MISSING');
  }
  const entries = normalizeMappingEntries(filter.horizon, mapping);
  if (!entries.length) throw new HorizonError('Hiçbir alan eşleştirilmedi.', 'MAPPING_EMPTY');

  const grain = quoteTable(grainTable);
  // Filtre ifadesinin tamamı kullanılır; böylece sezon/tarih dışında Data Source
  // and Filters koşulları ve ASAS sipariş kodu push-down koşulu da kaybolmaz.
  const source = filter.expression
    ? `CALCULATETABLE(\n        ${grain},\n        FILTER(\n            ${quoteTable(filter.horizon.table)},\n            ${filter.expression.replace(/\n/g, '\n            ')}\n        )\n    )`
    : grain;

  const expressionFor = (entry) => {
    if (entry.kind === 'measure') {
      return `CALCULATE([${entry.name.replace(/]/g, ']]')}])`;
    }
    const column = quoteColumn(entry.table || filter.horizon.table, entry.name);
    if (String(entry.table || '').toLocaleUpperCase('tr-TR') === grainTable.toLocaleUpperCase('tr-TR')) {
      return column;
    }
    // Fact satırının expanded-table bağlamı ilişki üzerinden tek bir değer
    // vermiyorsa SELECTEDVALUE BLANK üretir; ilk/yakın değeri seçmez.
    return `CALCULATE(SELECTEDVALUE(${column}))`;
  };

  const projection = entries
    .map(entry => `        ${quoteString(entry.header)}, ${expressionFor(entry)}`)
    .join(',\n');
  const body = `SELECTCOLUMNS(\n    ${source},\n${projection}\n)`;
  const topN = Number(options.topN) > 0 ? Math.floor(Number(options.topN)) : 0;
  const query = topN ? `EVALUATE\nTOPN(${topN}, ${body})` : `EVALUATE\n${body}`;
  return {
    query,
    headerMap: null,
    fieldCount: entries.length,
    grainTable,
    ...filter,
  };
}

/** Eşlemede ölçü var mı? Sorgu şeklini bu belirler. */
function mappingHasMeasure(mapping) {
  return Object.values(mapping && typeof mapping === 'object' ? mapping : {})
    .some(value => value && typeof value === 'object' && value.kind === 'measure');
}

/**
 * Birden fazla tablodan sütun seçildiğinde SELECTCOLUMNS'ın satır bağlamı yalnız
 * ufuk tablosuna aittir. İlişkili tablolardaki sütunları güvenli biçimde bir araya
 * getirmek için, ölçü olmasa bile SUMMARIZECOLUMNS kullanılmalıdır.
 */
function mappingNeedsSummarize(horizonInput, mapping) {
  const entries = normalizeMappingEntries(horizonInput, mapping);
  if (entries.some(entry => entry.kind === 'measure')) return true;
  const horizon = normalizeHorizon(horizonInput);
  const horizonTable = horizon.table.toLocaleUpperCase('tr-TR');
  if (entries.some(entry => entry.table && entry.table.toLocaleUpperCase('tr-TR') !== horizonTable)) return true;
  // Ufuk filtresi ilişkili bir boyut tablosundaysa SELECTCOLUMNS'ın satır bağlamı
  // içinde doğrudan kullanılamaz. SUMMARIZECOLUMNS filtre bağlamını doğru kurar.
  if (horizon.seasons.length && horizon.seasonTable && horizon.seasonTable.toLocaleUpperCase('tr-TR') !== horizonTable) return true;
  if ((horizon.dateStart || horizon.dateEnd) && horizon.dateTable && horizon.dateTable.toLocaleUpperCase('tr-TR') !== horizonTable) return true;
  return false;
}

/** Eşlemeden uygun sorgu şeklini seçer. */
function buildMappedQuery(horizonInput, mapping, options = {}) {
  return mappingNeedsSummarize(horizonInput, mapping)
    ? buildSummarizeQuery(horizonInput, mapping, options)
    : buildProjectionQuery(horizonInput, mapping, options);
}

/** Satır sayısını öğrenmek için tek satırlık sayım sorgusu. */
function buildCountQuery(horizonInput, mapping = null, options = {}) {
  // Sayım sorgusu veri sorgusuyla AYNI predicate'i üretmeli; şema tipi buraya
  // geçmezse "kaç satır gelecek" sorusu tip hatasıyla düşerdi.
  const filter = buildHorizonFilter(horizonInput, mapping, options);
  const table = quoteTable(filter.horizon.table);
  let countExpression = `COUNTROWS(${table})`;

  if (filter.usedSeasons && !filter.usedDates) {
    const values = filter.horizon.seasons.map(quoteString).join(', ');
    const seasonColumn = quoteColumn(filter.horizon.seasonTable || filter.horizon.table, filter.horizon.seasonField);
    countExpression = `CALCULATE(COUNTROWS(${table}), TREATAS({ ${values} }, ${seasonColumn}))`;
  } else if (filter.usedDates && !filter.usedSeasons) {
    const dateColumn = quoteColumn(filter.horizon.dateTable || filter.horizon.table, filter.horizon.dateField);
    const bounds = [];
    const start = filter.horizon.dateStart ? daxDate(filter.horizon.dateStart) : null;
    const end = filter.horizon.dateEnd ? daxDate(filter.horizon.dateEnd) : null;
    if (start) bounds.push(`${dateColumn} >= ${start}`);
    if (end) bounds.push(`${dateColumn} <= ${end}`);
    countExpression = `CALCULATE(COUNTROWS(${table}), FILTER(ALL(${dateColumn}), ${bounds.join(' && ')}))`;
  } else if (filter.expression) {
    // Sezon+tarih birlikteyken eski VEYA semantiği korunur. Varsayılan hızlı sezon
    // filtresi yukarıdaki TREATAS yolunu kullanır.
    countExpression = `COUNTROWS(FILTER(${table}, ${filter.expression}))`;
  }

  return {
    query: `EVALUATE
ROW("SatirSayisi", ${countExpression})`,
    ...filter,
  };
}

/**
 * Ufuk, veride mevcut olan sezonlardan bazılarını dışarıda bırakıyor mu?
 * Yalnız sezon kriteri tek başına kullanıldığında anlamlıdır: tarih aralığı da
 * varsa dışarıda kalan sezon yine tarihten girebilir, o yüzden uyarı verilmez.
 */
function seasonsLeftOut(horizonInput, knownSeasons) {
  const filter = buildHorizonFilter(horizonInput);
  if (!filter.usedSeasons || filter.usedDates) return [];
  const chosen = new Set(filter.horizon.seasons.map(value => value.toLocaleUpperCase('tr')));
  return normalizeSeasons(knownSeasons).filter(value => !chosen.has(value.toLocaleUpperCase('tr')));
}

module.exports = {
  buildConditionExpression, buildGroupsExpression, withExtra, conditions: modelConditions,
  HorizonError, MAX_SEASONS,
  quoteTable, quoteColumn, quoteString, daxDate,
  normalizeSeasons, normalizeHorizon,
  buildHorizonFilter, buildHorizonQuery, normalizeMappingEntries, buildProjectionQuery, buildSummarizeQuery,
  summarizeFilterArgs,
  buildFactRowQuery, buildMappedQuery, mappingHasMeasure, mappingNeedsSummarize, buildCountQuery, seasonsLeftOut,
  describeHorizon,
  BLANK_ROW_GUARD,
};
