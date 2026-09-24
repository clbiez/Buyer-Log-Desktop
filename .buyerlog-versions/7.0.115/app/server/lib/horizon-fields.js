'use strict';

/* ===================================================================
   v7.26 — UFUK ALANLARI: ASAS BAŞLIĞI ⇄ SATIR ALANI

   Kullanıcı talebi: "Horizon ayarlamak excel tablosuna filtre koymak kadar
   basit bir işlem olsun. Kullanıcı istediği tablo başlıklarını ekleyip
   istediği filtrelemeyi yapabilsin." ve "Merch Alt Grup Kod = MAG, Merch
   Marka Yaş Grup Kod = MMYG, Buyer Group (EN) = Buying Group olduğu için
   kullanıcı oluşturulurken girilen bilgilere göre direkt olarak sayfalara
   horizon çizilebilir."

   NEDEN BU MODÜL VAR

   Ufuk iki ayrı yerde işletiliyor:
     1) Veri tabanı modunda DAX'a çevrilerek (modelHorizon.js) — sorgu zaten
        sunucuda sınırlanır.
     2) Excel modunda ve paylaşılan ASAS anlık görüntüsünde satır satır
        süzülerek (server.js → filterRowsByEffectiveHorizon).

   (2) yalnız SEZON ve TARİH biliyordu. Yani "MAG = CK1E" gibi bir ufuk Excel
   modunda hiçbir şeyi süzmüyordu: kullanıcı ufkunu kurup kaydediyor, ekranda
   hiçbir şey değişmiyordu. Sessiz ve fark edilmesi zor bir hataydı; bu modül
   koşul gruplarını (2) yolunda da işletir.

   SAHA DOĞRULAMASI (gerçek ASAS dosyasından okundu, uydurma değil):
     · MAG   → 'Merch Alt Grup Kod'          (örn. CK1E)
     · MMYG  → 'Merch Marka Yaş Grup Kod'    (örn. CKW1)
     · Buying Group → 'Buyer Grup (TR)'      (örn. ELBISE, DENİM)
   Kullanıcının bahsettiği "Buyer Group (EN)" sütunu ASAS çıktısında YOKTUR;
   karşılığı 'Buyer Grup (TR)'dır ve model-fields.js bu başlık için
   'BUYER GROUP' / 'BUYING GROUP' takma adlarını zaten kabul eder. İleride
   İngilizce başlıklı bir çıktı gelirse eşleme kendiliğinden tutar.
   =================================================================== */

const modelConditions = require('./model-conditions');
const filterValueTypes = require('./filter-value-types');

/* Alan listesi. `key` parser'ın ürettiği sipariş nesnesindeki alan,
   `header` ise ASAS sütun başlığı ve DAX tarafında kullanılan ad.
   `profile` dolu olanlar kullanıcı kartındaki alandan doldurulabilir. */
const FIELDS = Object.freeze([
  { header: 'Merch Alt Grup Kod', key: 'merch', tr: 'MAG (Merch Alt Grup Kod)', en: 'MAG (Merch Sub Group Code)', type: 'text', primary: true, profile: 'mags' },
  { header: 'Merch Marka Yaş Grup Kod', key: 'ageGroup', tr: 'MMYG (Merch Marka Yaş Grup Kod)', en: 'MMYG (Brand Age Group Code)', type: 'text', primary: true, profile: 'mmygs' },
  { header: 'Buyer Grup (TR)', key: 'buyerGrup', tr: 'Buying Group', en: 'Buying Group', type: 'text', primary: true, profile: 'buyingGroups' },
  { header: 'Sezon', key: 'season', tr: 'Sezon', en: 'Season', type: 'text', primary: true },
  { header: 'Orijinal Exfactory Merch Tarih', key: 'ex', tr: 'Ex-factory tarihi', en: 'Ex-factory date', type: 'date', primary: true },
  { header: 'Buyer', key: 'buyer', tr: 'Buyer', en: 'Buyer', type: 'text' },
  { header: 'Üretici', key: 'manufacturer', tr: 'Üretici', en: 'Manufacturer', type: 'text' },
  { header: 'Lisans', key: 'license', tr: 'Lisans', en: 'License', type: 'text' },
  { header: 'Siparişin Üretildiği Ülke', key: 'countryRaw', tr: 'Üretim ülkesi', en: 'Country of origin', type: 'text' },
  { header: 'Line', key: 'line', tr: 'Line', en: 'Line', type: 'text' },
  { header: 'Ürün Klasman', key: 'category', tr: 'Ürün klasmanı', en: 'Product classification', type: 'text' },
  { header: 'Model Adı', key: 'model', tr: 'Model adı', en: 'Model name', type: 'text' },
  { header: 'Özel Kod 1', key: 'ozel', tr: 'Özel kod', en: 'Special code', type: 'text' },
  { header: 'Plm Kod', key: 'plm', tr: 'PLM kodu', en: 'PLM code', type: 'text' },
  { header: 'Renk Kod', key: 'ccode', tr: 'Renk kodu', en: 'Colour code', type: 'text' },
  { header: 'Sipariş Kod', key: 'ocode', tr: 'Sipariş kodu', en: 'Order code', type: 'number' },
  { header: 'Retail Depo Tarih Yıl Ay Gün', key: 'retail', tr: 'Retail depo tarihi', en: 'Retail warehouse date', type: 'date' },
  { header: 'Model Bütçe Tarih Yıl Ay Gün', key: 'mb', tr: 'In-store (model bütçe) tarihi', en: 'In-store (model budget) date', type: 'date' },
  { header: 'Sipariş Yerleştirme MerchTarih', key: 'opd', tr: 'Sipariş yerleştirme tarihi', en: 'Order placement date', type: 'date' },
  { header: 'Kumaş Kategorisi', key: 'fabricCategory', tr: 'Kumaş kategorisi', en: 'Fabric category', type: 'text' },
  { header: 'Kumaşçı', key: 'fabricSupplier', tr: 'Kumaşçı', en: 'Fabric supplier', type: 'text' },
]);

const BY_HEADER = new Map(FIELDS.map(field => [field.header, field]));
const BY_KEY = new Map(FIELDS.map(field => [field.key, field]));
// Kullanıcı kartındaki alan → ufuk alanı (MAG/MMYG/Buying Group otomasyonu).
const PROFILE_FIELDS = Object.freeze(FIELDS.filter(field => field.profile));

/* Tip çözümlemesi TEK OTORİTEDEN gelir (filter-value-types.js): şema
   metadata'sı varsa o, yoksa sütun adından tahmin. İkinci bir kopya tutmak,
   predicate üreticisi ile ekranın farklı tip görmesi demek olurdu. */
function schemaFieldType(entry) {
  return filterValueTypes.schemaFieldType(entry);
}
/* Tip yanında GÜVEN seviyesini de isteyen çağrı yerleri için. */
function schemaFieldTypeInfo(entry) {
  return filterValueTypes.resolveType(entry);
}

/* Model şemasındaki ASAS sütunlarını sayfa Horizon alanlarına ekler. Canonical
   alanlar önce gelir; aynı isim farklı tablolarda varsa qualified header kullanılır
   ama gerçek model sütunu `table` + `name` olarak korunur. */
function fromSchema(schema) {
  const out = FIELDS.map(field => ({ ...field }));
  const used = new Set(out.map(field => String(field.header || '').toLocaleLowerCase('tr-TR')));
  for (const entry of Array.isArray(schema && schema.columns) ? schema.columns : []) {
    if (!entry || entry.kind === 'measure') continue;
    const name = clean(entry.name), table = clean(entry.table);
    if (!name) continue;
    let header = name;
    if (used.has(header.toLocaleLowerCase('tr-TR'))) header = `${table}::${name}`;
    if (used.has(header.toLocaleLowerCase('tr-TR'))) continue;
    used.add(header.toLocaleLowerCase('tr-TR'));
    const resolved = schemaFieldTypeInfo(entry);
    out.push({
      header, key: header, name, table, dynamic: true,
      tr: table ? `${table} · ${name}` : name,
      en: table ? `${table} · ${name}` : name,
      type: resolved.type,
      /* Tipin NEREDEN geldiği taşınır. Ekran ve kayıt bunu ayırt edebilmeli:
         şemadan gelen tip otoriterdir ve değeri dönüştürmeye yetkilidir,
         addan tahmin edilen tip yalnız bir öneridir. */
      typeSource: resolved.confidence,
    });
  }
  return out;
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function fold(value) { return clean(value).toLocaleLowerCase('tr-TR'); }
function booleanText(value) {
  const text = fold(value);
  if (['true', '1', 'yes', 'evet'].includes(text)) return 'true';
  if (['false', '0', 'no', 'hayır', 'hayir'].includes(text)) return 'false';
  return text;
}

/* Satırdan bir alanın değerini okur.
   Sıra: parser alanı → ham ASAS başlığı → başlığın kendisi bir alan adıysa o.
   Böylece hem işlenmiş satırlar hem de _sourceFields taşıyan satırlar çalışır. */
function rowValue(row, fieldName) {
  if (!row || !fieldName) return '';
  const raw = row._sourceFields && typeof row._sourceFields === 'object' ? row._sourceFields : {};
  const byHeader = BY_HEADER.get(fieldName);
  if (byHeader && row[byHeader.key] != null && row[byHeader.key] !== '') return row[byHeader.key];
  if (raw[fieldName] != null && raw[fieldName] !== '') return raw[fieldName];
  const byKey = BY_KEY.get(fieldName);
  if (byKey && row[byKey.key] != null) return row[byKey.key];
  if (row[fieldName] != null) return row[fieldName];
  return '';
}

function asDateText(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  // ASAS tarihleri yyyymmdd sayısı olarak da gelebilir.
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return '';
}

function matchesCondition(row, condition) {
  const field = clean(condition && condition.field);
  if (!field) return true; // Alanı seçilmemiş koşul kimseyi elemez.
  const op = clean(condition.op) || 'in';
  const valueType = clean(condition.valueType) || 'text';
  const rawValue = rowValue(row, clean(condition && condition.name) || field);
  const values = (Array.isArray(condition.values) ? condition.values : []).map(clean).filter(Boolean);

  if (op === 'empty') return !clean(rawValue);
  if (op === 'notEmpty') return Boolean(clean(rawValue));

  if (valueType === 'boolean') {
    const selected = values.map(booleanText);
    const current = booleanText(rawValue);
    if (op === 'notIn') return selected.length ? !selected.includes(current) : true;
    return selected.length ? selected.includes(current) : true;
  }

  if (valueType === 'date' || op === 'between' || op === 'gte' || op === 'lte') {
    const date = asDateText(rawValue);
    const from = valueType === 'date' ? asDateText(condition.from) : clean(condition.from);
    const to = valueType === 'date' ? asDateText(condition.to) : clean(condition.to);
    if (valueType === 'number') {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) return false;
      if (op === 'gte') return Number.isFinite(Number(from)) ? numeric >= Number(from) : true;
      if (op === 'lte') return Number.isFinite(Number(to)) ? numeric <= Number(to) : true;
      if (op === 'between') {
        if (Number.isFinite(Number(from)) && numeric < Number(from)) return false;
        if (Number.isFinite(Number(to)) && numeric > Number(to)) return false;
        return true;
      }
    }
    // Tarihi okunamayan satır, tarih koşulu OLAN bir ufukta dışarıda kalır:
    // "tarihi bilinmiyor" ile "tarihi aralıkta" aynı şey değildir.
    if (op === 'gte') return from ? Boolean(date) && date >= from : true;
    if (op === 'lte') return to ? Boolean(date) && date <= to : true;
    if (op === 'between') {
      if (!from && !to) return true;
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    }
  }

  const text = fold(rawValue);
  if (op === 'contains') return values.length ? values.some(value => text.includes(fold(value))) : true;
  if (op === 'startsWith') return values.length ? values.some(value => text.startsWith(fold(value))) : true;
  if (op === 'notIn') return values.length ? !values.some(value => fold(value) === text) : true;
  // 'in' ve tanınmayan her operatör kapsayıcı liste gibi davranır.
  return values.length ? values.some(value => fold(value) === text) : true;
}

/* Gruplar arası VEYA, grup içi VE — model-conditions.js'teki DAX üretimiyle
   BİREBİR aynı model. İki yol ayrışırsa aynı ufuk Excel'de başka, veri
   tabanında başka sonuç verirdi. */
function matchesGroups(row, groups) {
  const list = Array.isArray(groups) ? groups.filter(group => group && Array.isArray(group.conditions) && group.conditions.length) : [];
  if (!list.length) return true;
  return list.some(group => group.conditions.every(condition => matchesCondition(row, condition)));
}

/* Aktif koşul grubu var mı? (Alanı seçilmiş en az bir koşul.) */
function hasActiveGroups(horizon) {
  const item = horizon && typeof horizon === 'object' ? horizon : {};
  return (Array.isArray(item.groups) ? item.groups : [])
    .some(group => group && Array.isArray(group.conditions) && group.conditions.some(condition => clean(condition && condition.field)));
}

/* Bir satır bu ufkun içinde mi?

   ÖNCELİK KURALI — DAX tarafıyla BİREBİR aynı olmak zorunda:
   modelHorizon.buildHorizonFilter, aktif koşul grubu varsa eski sezon/tarih
   alanlarını YOK SAYAR ("Serbest koşul grupları tanımlıysa eski sezon/tarih
   alanları yerine onlar geçerlidir"). Burada iki kriteri VE ile birleştirmek,
   aynı ufkun Excel modunda daha az satır getirmesi demekti — kullanıcının
   göremeyeceği, sessiz bir tutarsızlık. */
function matchesHorizon(row, horizon) {
  const item = horizon && typeof horizon === 'object' ? horizon : {};
  if (hasActiveGroups(item)) return matchesGroups(row, item.groups);
  const seasons = new Set((Array.isArray(item.seasons) ? item.seasons : []).map(value => clean(value).toLocaleUpperCase('tr-TR')).filter(Boolean));
  const start = clean(item.dateStart), end = clean(item.dateEnd);
  // Eski ufukta sezon ve tarih VEYA ile birleşir (modelHorizon ile aynı):
  // "şu koleksiyonun tamamı" VEYA "şu dönemde hareketi olanlar".
  if (!seasons.size && !start && !end) return true;
  const clauses = [];
  if (seasons.size) {
    const season = clean(rowValue(row, 'Sezon')).toLocaleUpperCase('tr-TR');
    clauses.push(seasons.has(season));
  }
  if (start || end) {
    const date = asDateText(rowValue(row, 'Orijinal Exfactory Merch Tarih'));
    clauses.push(Boolean(date) && (!start || date >= start) && (!end || date <= end));
  }
  return clauses.some(Boolean);
}

/* Ufku bir kez DERLE, sonra satır başına yalnız karşılaştır.

   Ölçüm (gerçek ASAS, 29.923 satır): derlenmemiş yolda 202 ms. Bu süre her
   sayfa isteğinde ödeniyordu; 100 kullanıcılı bir günde boşa giden zamanın
   tamamı burada. Derlemede değerler bir kez küçük harfe indirilip Set'e
   konur, satır başına yalnız Map/Set bakışı kalır. */
function compileHorizon(horizon) {
  const item = horizon && typeof horizon === 'object' ? horizon : {};
  const seasons = new Set((Array.isArray(item.seasons) ? item.seasons : []).map(value => clean(value).toLocaleUpperCase('tr-TR')).filter(Boolean));
  const start = clean(item.dateStart), end = clean(item.dateEnd);
  const groups = (Array.isArray(item.groups) ? item.groups : [])
    .map(group => (group && Array.isArray(group.conditions) ? group.conditions : [])
      .filter(condition => clean(condition && condition.field))
      .map(condition => {
        const op = clean(condition.op) || 'in';
        const valueType = clean(condition.valueType) || 'text';
        const values = (Array.isArray(condition.values) ? condition.values : []).map(clean).filter(Boolean);
        return {
          field: clean(condition.field), name: clean(condition.name), op, valueType,
          set: new Set(values.map(fold)),
          folded: values.map(fold),
          from: valueType === 'date' ? asDateText(condition.from) : clean(condition.from),
          to: valueType === 'date' ? asDateText(condition.to) : clean(condition.to),
          hasValues: values.length > 0,
        };
      }))
    .filter(conditions => conditions.length);

  const test = (row, condition) => {
    const raw = rowValue(row, condition.name || condition.field);
    switch (condition.op) {
      case 'empty': return !clean(raw);
      case 'notEmpty': return Boolean(clean(raw));
      case 'contains': { if (!condition.hasValues) return true; const text = fold(raw); return condition.folded.some(value => text.includes(value)); }
      case 'startsWith': { if (!condition.hasValues) return true; const text = fold(raw); return condition.folded.some(value => text.startsWith(value)); }
      case 'notIn': return condition.hasValues ? !condition.set.has(fold(raw)) : true;
      case 'gte': case 'lte': case 'between': {
        if (condition.valueType === 'number') {
          const numeric = Number(raw);
          if (!Number.isFinite(numeric)) return false;
          if (condition.op !== 'lte' && condition.from && numeric < Number(condition.from)) return false;
          if (condition.op !== 'gte' && condition.to && numeric > Number(condition.to)) return false;
          return true;
        }
        if (!condition.from && !condition.to) return true;
        const date = asDateText(raw);
        if (!date) return false;
        if (condition.op !== 'lte' && condition.from && date < condition.from) return false;
        if (condition.op !== 'gte' && condition.to && date > condition.to) return false;
        return true;
      }
      default: return condition.hasValues ? condition.set.has(fold(raw)) : true;
    }
  };

  // Öncelik kuralı DAX ile aynı: aktif grup varsa sezon/tarih yok sayılır.
  const useGroups = groups.length > 0;
  const useLegacy = !useGroups && (seasons.size > 0 || Boolean(start || end));
  const bounded = useGroups || useLegacy;
  return {
    bounded,
    match(row) {
      if (!bounded) return true;
      if (useGroups) return groups.some(conditions => conditions.every(condition => test(row, condition)));
      // Eski ufukta sezon ve tarih VEYA ile birleşir.
      if (seasons.size) {
        const season = clean(rowValue(row, 'Sezon')).toLocaleUpperCase('tr-TR');
        if (seasons.has(season)) return true;
        if (!start && !end) return false;
      }
      if (start || end) {
        const date = asDateText(rowValue(row, 'Orijinal Exfactory Merch Tarih'));
        if (!date) return false;
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
      }
      return false;
    },
  };
}

function filterRows(rows, horizon) {
  const source = Array.isArray(rows) ? rows : [];
  const compiled = compileHorizon(horizon);
  if (!compiled.bounded) return source;
  return source.filter(row => compiled.match(row));
}

function isBounded(horizon) {
  const item = horizon && typeof horizon === 'object' ? horizon : {};
  if (hasActiveGroups(item)) return true;
  if (Array.isArray(item.seasons) && item.seasons.length) return true;
  return Boolean(clean(item.dateStart) || clean(item.dateEnd));
}

/* Kullanıcı kartındaki MAG / MMYG / Buying Group bilgisinden ufuk kurar.
   Üst düzey yöneticilerde bu alanlar ÇOKLU olabilir; her alan kendi içinde
   "şunlardan biri" (VE ile birleşen tek bir grup) olarak yazılır. */
function horizonFromProfile(profile, options = {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const conditions = [];
  for (const field of PROFILE_FIELDS) {
    const values = (Array.isArray(source[field.profile]) ? source[field.profile] : []).map(clean).filter(Boolean);
    if (!values.length) continue;
    conditions.push({ table: clean(options.table), field: field.header, op: 'in', valueType: 'text', values });
  }
  if (!conditions.length) return null;
  const horizon = { groups: modelConditions.normalizeGroups([{ conditions }], clean(options.table)) };
  if (clean(options.table)) horizon.table = clean(options.table);
  const seasons = (Array.isArray(options.seasons) ? options.seasons : []).map(clean).filter(Boolean);
  if (seasons.length) horizon.seasons = seasons;
  return horizon;
}

/* Ufkun insan diliyle özeti (rozet ve önizleme metinleri için). */
function describeHorizon(horizon, lang = 'tr') {
  const en = lang === 'en';
  const item = horizon && typeof horizon === 'object' ? horizon : {};
  const parts = [];
  // Aktif grup varsa sezon/tarih alanları YOK SAYILIR; özet de bunu yansıtır,
  // yoksa ekranda geçerli olmayan bir kriter yazardı.
  if (!hasActiveGroups(item)) {
    const seasons = (Array.isArray(item.seasons) ? item.seasons : []).map(clean).filter(Boolean);
    if (seasons.length) parts.push(`${en ? 'Season' : 'Sezon'}: ${seasons.join(', ')}`);
    if (clean(item.dateStart) || clean(item.dateEnd)) {
      parts.push(`${en ? 'Ex-factory' : 'Ex-factory'}: ${clean(item.dateStart) || '…'} → ${clean(item.dateEnd) || '…'}`);
    }
  }
  for (const group of Array.isArray(item.groups) ? item.groups : []) {
    const conditions = (group && Array.isArray(group.conditions) ? group.conditions : []).filter(condition => clean(condition.field));
    if (!conditions.length) continue;
    parts.push(conditions.map(condition => {
      const field = BY_HEADER.get(clean(condition.field));
      const label = field ? (en ? field.en : field.tr) : clean(condition.field);
      const values = (Array.isArray(condition.values) ? condition.values : []).map(clean).filter(Boolean);
      if (condition.op === 'empty') return `${label} ${en ? 'is empty' : 'boş'}`;
      if (condition.op === 'notEmpty') return `${label} ${en ? 'is filled' : 'dolu'}`;
      if (condition.op === 'between') return `${label}: ${clean(condition.from) || '…'} → ${clean(condition.to) || '…'}`;
      if (condition.op === 'gte') return `${label} ≥ ${clean(condition.from)}`;
      if (condition.op === 'lte') return `${label} ≤ ${clean(condition.to)}`;
      if (condition.op === 'notIn') return `${label} ${en ? 'not' : 'değil'}: ${values.join(', ')}`;
      if (condition.op === 'contains') return `${label} ${en ? 'contains' : 'içerir'}: ${values.join(', ')}`;
      if (condition.op === 'startsWith') return `${label} ${en ? 'starts with' : 'ile başlar'}: ${values.join(', ')}`;
      return `${label}: ${values.join(', ')}`;
    }).join(en ? ' and ' : ' ve '));
  }
  if (!parts.length) return en ? 'no conditions — the whole table is pulled' : 'koşul yok — tüm tablo çekiliyor';
  return parts.join(en ? ' · or · ' : ' · veya · ');
}

module.exports = {
  FIELDS, PROFILE_FIELDS, OPERATORS: modelConditions.OPERATORS, fromSchema, schemaFieldType, schemaFieldTypeInfo,
  rowValue, matchesCondition, matchesGroups, matchesHorizon, isBounded, hasActiveGroups, compileHorizon, filterRows,
  horizonFromProfile, describeHorizon,
  _fold: fold, _asDateText: asDateText,
};
