'use strict';

/* ===================================================================
   v7.81 — ASAS FİLTRESİNİ IAS'A EŞLEME (ÖNERİ + ONAY)

   Kullanıcı talebi: "bir modül hem ASAS hem IAS'dan besleniyorsa, ASAS için
   seçtiğim filtreleri Buyer Log IAS için de otomatik eşleyerek seçsin.
   Kullanıcı için önden çalışmış olsun. Kullanıcı kontrol edip onayladığında
   IAS filtreleri de oluşsun. Bu onay mekanizmasına ihtiyaç var çünkü Buyer
   Log ASAS'daki alanları IAS'da birebir eşleyemeyebilir, alan isimleri
   farklı olabiliyor."

   NEDEN ÖNERİ, NEDEN OTOMATİK YAZMA DEĞİL

   İki model birbirinin kopyası değil: alan adları farklı, bir alanın karşılığı
   hiç olmayabilir ve —asıl tehlikeli olan— DEĞER ALFABESİ farklı olabilir
   (ASAS'ta "W6", IAS'ta "2026W6"). Sessizce yazılan bir eşleme, kullanıcının
   filtre koyduğunu sandığı ama HİÇBİR SATIRI tutmayan bir IAS sorgusu üretir;
   bu, ekranda boş tablo olarak görünür ve sebebi görünmez. Bu yüzden modül
   yalnız ÖNERİ üretir; yazma kararı kullanıcınındır.

   BU MODÜL SAF: ağ, disk ve DAX yok. Girdi iki alan listesi + koşullar,
   çıktı önerilerdir. Böylece canlı birim testi yazılabiliyor (§2).

   EŞLEŞTİRME KADEMELERİ — her öneri hangi kademeden geldiğini taşır:

     exact  · adlar normalize edilince birebir aynı
     alias  · ortak alan kaydındaki takma adlar üzerinden aynı kavram
              (model-fields.js FIELD_CATALOGUE — MAG, MMYG, Buying Group…)
     fuzzy  · biri diğerini içeriyor (kısa adlar hariç: "FOB" her şeyi tutar)

   Eşleşmeyen koşul SESSİZCE DÜŞMEZ; `unmapped` içinde sebebiyle döner.
   =================================================================== */

const modelFields = require('./model-fields');
const horizonFields = require('./horizon-fields');
const fieldPairs = require('./horizon-field-pairs');

const fieldKey = modelFields.fieldKey;

/* Kavram sözlüğü: aynı gerçek alanı anlatan adlar tek kümede toplanır.
   Kaynak, uygulamanın zaten sahada doğrulanmış takma ad kataloğudur —
   burada ikinci bir liste uydurulmuyor (§8). */
function buildConceptIndex() {
  const index = new Map();   // normalize ad → kavram kimliği
  const register = (conceptId, names) => {
    names.filter(Boolean).forEach(name => {
      const key = fieldKey(name);
      if (key && !index.has(key)) index.set(key, conceptId);
    });
  };
  Object.keys(modelFields.FIELD_CATALOGUE).forEach(role => {
    (modelFields.FIELD_CATALOGUE[role] || []).forEach(field => {
      if (!field || !field.header) return;
      register(`cat:${fieldKey(field.header)}`, [field.header, ...(field.aliases || [])]);
    });
  });
  horizonFields.FIELDS.forEach(field => {
    register(`cat:${fieldKey(field.header)}`, [field.header, field.tr, field.en]);
  });
  return index;
}

let CONCEPTS = null;
function conceptOf(name) {
  if (!CONCEPTS) CONCEPTS = buildConceptIndex();
  return CONCEPTS.get(fieldKey(name)) || '';
}

/* Hedef alan listesini aranabilir hâle getirir. Alan listesi
   horizon-fields.fromSchema / intakeHorizonFields çıktısıdır. */
function indexTargetFields(targetFields) {
  const entries = (Array.isArray(targetFields) ? targetFields : []).filter(Boolean);
  return entries.map(field => {
    const label = String(field.header || field.name || '');
    return {
      field,
      label,
      key: fieldKey(label),
      nameKey: fieldKey(field.name || ''),
      concept: conceptOf(label) || conceptOf(field.name || ''),
      physical: Boolean(field.dynamic || (String(field.table || '').trim() && String(field.name || '').trim())),
    };
  }).filter(entry => entry.key || entry.nameKey);
}

/* Bir kaynak alan adı için en iyi hedef alanı bulur.
   `taken` aynı hedef alanın iki koşula birden verilmesini engeller —
   verse, kullanıcı iki farklı filtre kurduğunu sanırken tek alan üzerinde
   çelişen iki koşul oluşurdu. */
function matchField(sourceName, indexed, taken) {
  const key = fieldKey(sourceName);
  if (!key) return null;

  const free = entry => !taken.has(entry.label);
  const livePhysical = indexed.some(entry => entry.physical);

  const chooseUniquePhysical = entries => {
    const physical = entries.filter(entry => entry.physical);
    if (physical.length === 1) return physical[0];
    if (physical.length > 1) return null;
    return livePhysical ? null : (entries.length === 1 ? entries[0] : null);
  };

  const exact = chooseUniquePhysical(indexed.filter(entry => free(entry) && (entry.key === key || entry.nameKey === key)));
  if (exact) return { entry: exact, confidence: 'exact', matchedBy: exact.label };

  const concept = conceptOf(sourceName);
  if (concept) {
    const byAlias = chooseUniquePhysical(indexed.filter(entry => free(entry) && entry.concept === concept));
    if (byAlias) return { entry: byAlias, confidence: 'alias', matchedBy: byAlias.label };
  }

  if (key.length >= 5) {
    const fuzzyCandidates = indexed.filter(entry => free(entry)
      && (!livePhysical || entry.physical)
      && (entry.key.includes(key) || key.includes(entry.key)));
    if (fuzzyCandidates.length === 1) {
      const fuzzy = fuzzyCandidates[0];
      return { entry: fuzzy, confidence: 'fuzzy', matchedBy: fuzzy.label };
    }
  }

  /* AYIRT EDİCİ ORTAK KELİME. İki model aynı kavramı farklı uzunlukta
     adlandırıyor olabilir: 'Orijinal Exfactory Merch Tarih' ⇄ 'Exfactory Date'.
     İçerme bunu yakalamaz. Ortak kelime yeterince uzunsa (kısa kelimeler —
     TARIH, DATE, KOD, ID — her şeyi eşler) VE hedefte O kelimeyi taşıyan TEK
     alan varsa öneri üretilir. Tekillik şartı olmasa iki aday arasından
     rastgele birini seçmiş olurduk; kullanıcı yanlış olanı fark etmeyebilir. */
  const sourceTokens = key.split(' ').filter(token => token.length >= 6);
  for (const token of sourceTokens) {
    const hits = indexed.filter(entry => free(entry)
      && entry.key.split(' ').includes(token));
    if (hits.length === 1) return { entry: hits[0], confidence: 'fuzzy', matchedBy: `${hits[0].label} · “${token}”` };
  }
  return null;
}

/* v2026-10-30 — HATIRLANAN EŞLEME ÖNCE GELİR.

   Kullanıcının elle seçtiği eşleme (horizon-field-pairs) otomatik tahminden
   önce uygulanır. Hatırlanan hedef CANLI hedef şemada yoksa (sütun silinmiş /
   adı değişmiş) sessizce kullanılmaz: otomatik eşlemeye düşülür ve bu durum
   `rememberedStale` ile söylenir. `to: null` bilinçli "karşılığı yok"
   kararıdır; otomatik tahmin de yapılmaz. */
function matchWithMemory(condition, indexed, taken, memory = {}) {
  const sourceName = String(condition && (condition.name || condition.field) || '');
  const remembered = Array.isArray(memory.pairs) && memory.pairs.length
    ? fieldPairs.lookupPair(memory.pairs, memory.fromRole || 'asas', memory.toRole || 'antrepo', {
      table: condition && condition.table, name: condition && condition.name, field: condition && condition.field,
    })
    : null;
  if (remembered && remembered.to === null) return { hit: null, remembered: true, rememberedNone: true };
  if (remembered && remembered.to) {
    const wanted = fieldPairs.endKey(remembered.to);
    const entry = indexed.find(item => !taken.has(item.label)
      && fieldPairs.endKey({ table: item.field.table, name: item.field.name || item.field.header }) === wanted);
    if (entry) return { hit: { entry, confidence: 'remembered', matchedBy: entry.label }, remembered: true };
    const auto = matchField(sourceName, indexed, taken);
    return { hit: auto, remembered: true, rememberedStale: true };
  }
  return { hit: matchField(sourceName, indexed, taken), remembered: false };
}

/**
 * Tek tek kaynak alanlar için hedef alan önerisi (yan yana düzenleyici).
 * Koşul kurulmaz, değer taşınmaz; yalnız "bu alanın karşılığı hangisi".
 * @returns {Array<{index:number, target:object|null, confidence:string, matchedBy:string, rememberedStale:boolean}>}
 */
function matchFields({ fields, targetFields, pairs, fromRole = 'asas', toRole = 'antrepo' } = {}) {
  const indexed = indexTargetFields(targetFields);
  return (Array.isArray(fields) ? fields : []).map((field, index) => {
    const condition = field && typeof field === 'object' ? field : {};
    const result = matchWithMemory(condition, indexed, new Set(), { pairs, fromRole, toRole });
    const target = result.hit ? result.hit.entry.field : null;
    return {
      index,
      target: target ? {
        field: target.header || target.name || result.hit.entry.label,
        table: target.table || '', name: target.name || '',
        type: target.type || '', typeSource: target.typeSource || '',
      } : null,
      confidence: result.hit ? result.hit.confidence : (result.rememberedNone ? 'none' : ''),
      matchedBy: result.hit ? result.hit.matchedBy : '',
      rememberedStale: Boolean(result.rememberedStale),
    };
  });
}

/* Tip uyuşmazlığı koşulu geçersiz kılmaz ama kullanıcıya söylenmesi gerekir:
   metin alanına tarih aralığı koşulu taşımak sessizce boş sonuç üretir. */
function typeNote(condition, field) {
  const want = String(condition && condition.valueType || 'text');
  const have = String(field && field.type || 'text');
  if (want === have) return '';
  return `${want} → ${have}`;
}

/**
 * ASAS (veya herhangi bir kaynak) koşullarını hedef modelin alanlarına eşler.
 *
 * @param {object} input
 * @param {Array}  input.groups        kaynak ufkun koşul grupları
 * @param {Array}  input.targetFields  hedef modelin alan listesi
 * @returns {{groups:Array, proposals:Array, unmapped:Array, stats:object}}
 *          `groups` doğrudan filtre düzenleyicisine yüklenebilecek hâldedir;
 *          hiçbir şey kaydedilmez.
 */
function proposeMapping({ groups, targetFields, pairs = null, fromRole = 'asas', toRole = 'antrepo' } = {}) {
  const indexed = indexTargetFields(targetFields);
  const proposals = [];
  const unmapped = [];
  const outGroups = [];

  (Array.isArray(groups) ? groups : []).forEach((group, groupIndex) => {
    /* `taken` GRUP BAŞINA sıfırlanır: gruplar arası VEYA olduğu için farklı
       grupların aynı alanı kullanması normaldir; çakışma yalnız grup içinde
       (VE) anlamsızdır. */
    const taken = new Set();
    const conditions = [];
    (group && Array.isArray(group.conditions) ? group.conditions : []).forEach(condition => {
      if (!condition) return;
      const sourceName = String(condition.name || condition.field || '');
      const matched = matchWithMemory(condition, indexed, taken, { pairs, fromRole, toRole });
      const hit = matched.hit;
      if (!hit) {
        unmapped.push({
          groupIndex,
          sourceField: sourceName,
          reason: matched.rememberedNone ? 'REMEMBERED_NONE' : 'NO_TARGET_FIELD',
          detail: matched.rememberedNone ? 'Bu alan için "karşılığı yok" kararı hatırlandı.' : 'Hedef modelde karşılığı bulunamadı.',
        });
        return;
      }
      taken.add(hit.entry.label);
      const field = hit.entry.field;
      const mapped = {
        ...condition,
        id: `hc_${Math.random().toString(36).slice(2, 9)}`,
        field: field.header || field.name || hit.entry.label,
        name: field.name || '',
        table: field.table || '',
        /* v7.83 — TİP HEDEF ALANDAN ALINIR, KAYNAKTAN DEĞİL.

           Koşul `...condition` ile kopyalanırken kaynak modelin `valueType`
           değeri de geliyordu. ASAS'ta metin olan bir alanın IAS karşılığı
           sayıysa, taşınan koşul sayısal sütuna metin literali yazdırıyor ve
           sorgu tip hatasıyla düşüyordu. Hedefin tipi ŞEMADAN geliyorsa
           (typeSource === 'schema') o tip otoriterdir; gelmiyorsa kaynağın
           tipi korunur ve kullanıcı onay ekranında `typeMismatch` notunu görür. */
        valueType: field.typeSource === 'schema' && field.type ? field.type : condition.valueType,
        valueTypeSource: field.typeSource === 'schema' ? 'schema' : (condition.valueTypeSource || ''),
      };
      conditions.push(mapped);
      proposals.push({
        groupIndex,
        sourceField: sourceName,
        targetField: mapped.field,
        table: mapped.table,
        column: field.name || '',
        physical: Boolean(hit.entry.physical),
        confidence: hit.confidence,
        matchedBy: hit.matchedBy,
        rememberedStale: Boolean(matched.rememberedStale),
        typeMismatch: typeNote(condition, field),
        /* Değerler olduğu gibi taşınır ama DOĞRULANMAMIŞTIR: iki modelin
           değer alfabesi farklı olabilir. Onay ekranı bunu gösterir. */
        values: Array.isArray(condition.values) ? condition.values.slice(0, 20) : [],
        valuesUnverified: Boolean(Array.isArray(condition.values) && condition.values.length),
      });
    });
    if (conditions.length) outGroups.push({ id: `g_${groupIndex}`, conditions });
  });

  return {
    groups: outGroups,
    proposals,
    unmapped,
    stats: {
      total: proposals.length + unmapped.length,
      mapped: proposals.length,
      unmapped: unmapped.length,
      exact: proposals.filter(item => item.confidence === 'exact').length,
      alias: proposals.filter(item => item.confidence === 'alias').length,
      fuzzy: proposals.filter(item => item.confidence === 'fuzzy').length,
      remembered: proposals.filter(item => item.confidence === 'remembered').length,
    },
  };
}

module.exports = { proposeMapping, matchFields, _conceptOf: conceptOf, _matchField: matchField, _indexTargetFields: indexTargetFields };
