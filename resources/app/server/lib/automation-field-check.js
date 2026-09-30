'use strict';

/* v7.175 — OTOMASYON KOŞULLARINDAKİ ALANLARIN DENETİMİ

   Kullanıcı talebi: "Aynı mantıkla bir de otomasyonları uçtan uca ele al ve
   revize et." Hesaplanan sütunda bulunan kusurun otomasyondaki karşılığı:

   Basit arayüzde kurulan koşul alanı ADIYLA saklanır ([Üretici] eşittir …).
   Kaynak başlık değişirse (ASAS/IAS kolonu yeniden adlandırılır, alan başka
   bir takma adla gelir) alan satırda bulunamaz ve:
     · "eşittir / içerir" koşulu HİÇBİR satırı eşleştirmez → kullanıcı yalnız
       "Filtrelere uyan kayıt bulunamadı" görür; asıl sebep saklı kalır;
     · "Boş" koşulu ise TÜM satırları eşleştirir → planlı bir e-posta, bütün
       siparişleri yanlış kişilere taslak olarak üretebilir.
   İkisi de sessiz bir yanlıştır (§152).

   Çözüm:
     1) Alan satırda birebir (ya da büyük/küçük harf farkıyla) varsa dokunulmaz.
     2) Yoksa kanonik alan kaydından (public/canonical-fields.js) aynı anlamı
        taşıyan GERÇEK başlık aranır ("Sipariş Kodu" → "Order Code"). Bulunursa
        koşul o başlıkla çalışır ve önizleme bunu açıkça söyler. Ham başlık
        eşleştirmesi eklenmez; eşleşme kaydın kendi bağlamalarından gelir.
     3) O da yoksa alan EKSİK sayılır: en yakın başlık önerilir ve çalıştırma
        durdurulur — sessizce sıfır ya da tüm satır üretilmez.

   Veri yoksa (henüz yüklenmemiş kaynak) denetim yapılmaz: alanın var olup
   olmadığı bilinemez; mevcut davranış korunur. */

const canonicalFields = require('../../public/canonical-fields');

const TR_MAP = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c' };
function clean(value) { return String(value == null ? '' : value).trim(); }
function token(value) {
  return clean(value).replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => TR_MAP[ch] || ch)
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();
}
function distance(a, b) {
  const s = String(a), t = String(b);
  if (s === t) return 0;
  const row = Array.from({ length: t.length + 1 }, (_, index) => index);
  for (let i = 1; i <= s.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (s[i - 1] === t[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[t.length];
}

// Satırlarda gerçekten bulunan başlıklar (ilk 400 satır yeter; başlıklar sabittir).
function presentKeys(rows) {
  const keys = new Set();
  (Array.isArray(rows) ? rows : []).slice(0, 400).forEach(row => {
    if (row && typeof row === 'object') Object.keys(row).forEach(key => keys.add(key));
  });
  return [...keys];
}

function closest(field, keys) {
  const wanted = token(field);
  if (!wanted) return '';
  let best = '', bestScore = Infinity;
  for (const key of keys) {
    if (String(key).startsWith('_')) continue;
    const value = token(key);
    if (!value) continue;
    let score = distance(wanted, value);
    if (value.includes(wanted) || wanted.includes(value)) score = Math.min(score, Math.abs(value.length - wanted.length) * 0.5 + 0.5);
    if (score < bestScore) { bestScore = score; best = key; }
  }
  return best && bestScore <= Math.max(2, Math.floor(wanted.length / 3)) ? best : '';
}

/* Bir alan adını satırdaki gerçek başlığa çözer.
   Döner: { key, how: 'exact' | 'case' | 'canonical' } ya da null. */
function resolveKey(field, keys, source) {
  const wanted = clean(field);
  if (!wanted) return null;
  if (keys.includes(wanted)) return { key: wanted, how: 'exact' };
  const lower = wanted.toLocaleLowerCase('tr-TR');
  const caseHit = keys.find(key => String(key).toLocaleLowerCase('tr-TR') === lower);
  if (caseHit) return { key: caseHit, how: 'case' };
  const id = canonicalFields && typeof canonicalFields.canonicalId === 'function' ? canonicalFields.canonicalId(source, wanted) : null;
  if (!id) return null;
  const def = canonicalFields.field(id) || {};
  const binding = canonicalFields.bindingFor(source, id);
  const candidates = [...((binding && binding.keys) || []), id, def.label && def.label.en, def.label && def.label.tr, ...(def.aliases || [])]
    .filter(Boolean).map(token);
  for (const candidate of candidates) {
    const hit = keys.find(key => token(key) === candidate);
    if (hit) return { key: hit, how: 'canonical', canonicalId: id };
  }
  return null;
}

/* Tarifin başvurduğu alanları denetler.
   Döner: { checked, filters, remapped:[{from,to,where}], missing:[{field,where,suggestion}] }
   `filters` onarılmış koşul listesidir (eksik alanlar olduğu gibi kalır). */
function inspect(rows, recipe, options = {}) {
  const source = clean(options.source || (recipe && recipe.source)).toLowerCase();
  const keys = presentKeys(rows);
  const filters = Array.isArray(recipe && recipe.filters) ? recipe.filters : [];
  const result = { checked: keys.length > 0, filters, remapped: [], missing: [] };
  if (!keys.length) return result;
  const check = (field, where) => {
    const name = clean(field);
    if (!name) return name;
    const hit = resolveKey(name, keys, source);
    if (hit) {
      if (hit.how === 'canonical') result.remapped.push({ from: name, to: hit.key, where });
      return hit.key;
    }
    if (!result.missing.some(item => item.field === name && item.where === where)) {
      result.missing.push({ field: name, where, suggestion: closest(name, keys) });
    }
    return name;
  };
  result.filters = filters.map(rule => {
    if (!rule || !clean(rule.field)) return rule;
    const key = check(rule.field, 'filter');
    return key === rule.field ? rule : { ...rule, field: key };
  });
  const email = (recipe && recipe.email) || {};
  if (['email', 'mixed'].includes(recipe && recipe.purpose) && email.recipientMode === 'field') check(email.recipientField, 'recipient');
  const analysis = (recipe && recipe.analysis) || {};
  if (analysis.groupBy) check(analysis.groupBy, 'groupBy');
  if (analysis.valueField) check(analysis.valueField, 'valueField');
  return result;
}

// Çalıştırmayı durduracak hata: koşul ve alıcı alanı eksikse sonuç yanlış olur.
function blockingError(check) {
  const blocking = (check && check.missing || []).filter(item => item.where === 'filter' || item.where === 'recipient');
  if (!blocking.length) return null;
  const list = blocking.map(item => `“${item.field}”${item.suggestion ? ` (belki “${item.suggestion}”?)` : ''}`).join(', ');
  const error = new Error(`Bu otomasyonun kullandığı alan veride bulunamadı: ${list}. Başlık değişmiş olabilir; otomasyonu açıp koşulu yeni alanla düzeltin. Yanlış kayıtlara işlem yapılmaması için çalıştırma durduruldu.`);
  error.code = 'AUTOMATION_FIELD_MISSING';
  error.statusCode = 409;
  error.details = { missing: blocking, remapped: check.remapped };
  return error;
}

module.exports = { inspect, blockingError, resolveKey, closest, presentKeys };
