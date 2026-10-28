/* Buyer Log — SİPARİŞ ÖNEM ETİKETLERİ (Order Importance Tags)
 *
 * Saf modül: DOM yok, fetch yok. Sunucu (parse.js, db.js, Backlog Excel) ve
 * tarayıcı (CP/Orders hücresi, Ayarlar, Backlog Genel Bakış) aynı çözümlemeyi
 * buradan okur; ekrandaki etiket ile Excel'deki etiket ayrışamaz.
 *
 * Model:
 *  - Katalog (overrides.importanceSettings.tags): BTS, Transition, Bayram,
 *    Ekvator, New Year ön tanımlıdır; Ayarlar'dan düzenlenir, CP/Orders
 *    menüsünden yeni etiket eklenebilir. "Regular" katalogda TUTULMAZ: etiketi
 *    olmayan her sipariş Regular'dır.
 *  - Kurallar (importanceSettings.rules): Line (+ isteğe bağlı Sezon) grubunu
 *    toplu etiketler. Yeni gelen siparişler de kuralı otomatik alır.
 *  - Sipariş etiketi (overrides.importancemap): sipariş + model + renk
 *    satırına yazılır; bir modelin siparişleri farklı etiket taşıyabilir.
 *    Değer etiket KİMLİĞİDİR; 'regular' açık "Regular" seçimidir ve bir Line
 *    kuralını o sipariş için bilinçli olarak ezer.
 *
 * Öncelik: sipariş etiketi > Line/Sezon kuralı > Regular.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLOrderImportance = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REGULAR_ID = 'regular';
  const REGULAR_LABEL = 'Regular';
  // Backlog Excel / rapor penceresi sütunu ve CP/Orders satır alanı.
  const BACKLOG_HEADER = 'ÖNEM ETİKETİ\n(IMPORTANCE)';
  const ROW_KEY = 'Importance';
  const TONES = Object.freeze(['red', 'orange', 'gold', 'green', 'teal', 'blue', 'purple', 'pink']);
  const MAX_TAGS = 40;
  const MAX_RULES = 200;
  const MAX_LABEL = 40;

  const DEFAULT_TAGS = Object.freeze([
    Object.freeze({ id: 'bts', label: 'BTS', labelEn: 'BTS', tone: 'orange' }),
    Object.freeze({ id: 'transition', label: 'Transition', labelEn: 'Transition', tone: 'teal' }),
    Object.freeze({ id: 'bayram', label: 'Bayram', labelEn: 'Eid (Bayram)', tone: 'purple' }),
    Object.freeze({ id: 'ekvator', label: 'Ekvator', labelEn: 'Equator (Ekvator)', tone: 'gold' }),
    Object.freeze({ id: 'new-year', label: 'New Year', labelEn: 'New Year', tone: 'red' }),
  ]);

  const text = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  // Saf fonksiyon; satır başına her kural/etiket için çağrılıyordu ve tr-TR
  // büyük harf dönüşümü sunucu kilitlenmelerinin ~%12'siydi. Kısa metinler
  // sınırlı bir bellekte tutulur; sonuç birebir aynıdır.
  const FOLD_CACHE = new Map();
  const fold = value => {
    const raw = String(value == null ? '' : value), cacheable = raw.length <= 160;
    if (cacheable) { const hit = FOLD_CACHE.get(raw); if (hit !== undefined) return hit; }
    const folded = text(raw).toLocaleUpperCase('tr-TR')
      .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
    if (cacheable) { if (FOLD_CACHE.size >= 50000) FOLD_CACHE.clear(); FOLD_CACHE.set(raw, folded); }
    return folded;
  };
  const cleanId = value => String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

  function slugId(label, taken) {
    const base = cleanId(fold(label).toLowerCase().replace(/\s+/g, '-')) || 'tag';
    let id = base === REGULAR_ID ? 'tag' : base, n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;
    return id;
  }

  function normalizeTags(raw) {
    const ids = new Set([REGULAR_ID]), labels = new Set([fold(REGULAR_LABEL)]), out = [];
    for (const value of Array.isArray(raw) ? raw : []) {
      const item = value && typeof value === 'object' ? value : { label: value };
      const label = text(item.label).slice(0, MAX_LABEL);
      if (!label || labels.has(fold(label))) continue;
      let id = cleanId(item.id);
      if (!id || ids.has(id)) id = slugId(label, ids);
      ids.add(id); labels.add(fold(label));
      const tag = { id, label };
      const labelEn = text(item.labelEn).slice(0, MAX_LABEL);
      if (labelEn && labelEn !== label) tag.labelEn = labelEn;
      if (TONES.includes(item.tone)) tag.tone = item.tone;
      out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  function normalizeList(value) {
    const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,;\n]/);
    const seen = new Set(), out = [];
    list.forEach(item => { const t = text(item); const k = fold(t); if (t && !seen.has(k)) { seen.add(k); out.push(t); } });
    return out;
  }

  function normalizeRules(raw, tagIds) {
    const out = [], ids = new Set();
    for (const value of Array.isArray(raw) ? raw : []) {
      if (!value || typeof value !== 'object') continue;
      const tagId = cleanId(value.tagId);
      const lines = normalizeList(value.lines);
      if (!tagIds.has(tagId) || !lines.length) continue;
      let id = cleanId(value.id);
      if (!id || ids.has(id)) { let n = out.length + 1; id = `rule-${n}`; while (ids.has(id)) id = `rule-${++n}`; }
      ids.add(id);
      out.push({ id, tagId, lines, seasons: normalizeList(value.seasons) });
      if (out.length >= MAX_RULES) break;
    }
    return out;
  }

  /** Eksik/bozuk kayıt ön tanımlı kataloğa düşer; kullanıcı kataloğu korunur. */
  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    const tags = normalizeTags(source && Array.isArray(source.tags) ? source.tags : DEFAULT_TAGS);
    const rules = normalizeRules(source && source.rules, new Set(tags.map(tag => tag.id)));
    return { version: 1, tags, rules };
  }
  function defaultSettings() { return normalizeSettings(null); }

  function tagById(settings, id) {
    const key = cleanId(id);
    if (!key || key === REGULAR_ID) return null;
    return (settings && Array.isArray(settings.tags) ? settings.tags : []).find(tag => tag.id === key) || null;
  }
  /** Excel / rapor metninden (TR veya EN etiket) etiket kimliği. Regular → 'regular'. */
  function idForLabel(settings, label) {
    const key = fold(label);
    if (!key) return '';
    if (key === fold(REGULAR_LABEL)) return REGULAR_ID;
    const tag = (settings && Array.isArray(settings.tags) ? settings.tags : [])
      .find(item => fold(item.label) === key || (item.labelEn && fold(item.labelEn) === key) || item.id === cleanId(label));
    return tag ? tag.id : '';
  }
  function displayLabel(tag, lang) {
    if (!tag) return REGULAR_LABEL;
    return lang === 'en' && tag.labelEn ? tag.labelEn : tag.label;
  }

  function ruleMatches(rule, order) {
    const line = fold(order && order.line);
    if (!line || !rule.lines.some(item => fold(item) === line)) return false;
    if (!rule.seasons.length) return true;
    const season = fold(order && order.season);
    return Boolean(season) && rule.seasons.some(item => fold(item) === season);
  }

  /**
   * @param {{line?:string, season?:string}} order  Sipariş boyutları
   * @param {string|undefined} manual  importancemap değeri (etiket kimliği / 'regular')
   * @param {object} settings  normalizeSettings çıktısı (ham değer de kabul edilir)
   * @returns {{id:string,label:string,source:'manual'|'rule'|'default',special:boolean,ruleId?:string}}
   */
  function resolve(order, manual, settings) {
    const s = settings && Array.isArray(settings.tags) && Array.isArray(settings.rules) ? settings : normalizeSettings(settings);
    const manualId = cleanId(manual);
    if (manualId === REGULAR_ID) return { id: REGULAR_ID, label: REGULAR_LABEL, source: 'manual', special: false };
    const manualTag = tagById(s, manualId);
    if (manualTag) return { id: manualTag.id, label: manualTag.label, source: 'manual', special: true };
    for (const rule of s.rules) {
      if (!ruleMatches(rule, order)) continue;
      const tag = tagById(s, rule.tagId);
      if (tag) return { id: tag.id, label: tag.label, source: 'rule', special: true, ruleId: rule.id };
    }
    return { id: REGULAR_ID, label: REGULAR_LABEL, source: 'default', special: false };
  }

  function isSpecialLabel(label) {
    const key = fold(label);
    return Boolean(key) && key !== fold(REGULAR_LABEL);
  }

  /** Excel liste doğrulaması değerleri (Regular ilk). Satır içi liste 255 karakterle sınırlıdır. */
  function excelValues(settings) {
    const s = normalizeSettings(settings);
    const out = [REGULAR_LABEL];
    let length = REGULAR_LABEL.length;
    s.tags.forEach(tag => {
      const label = tag.label.replace(/[",]/g, ' ').trim();
      if (!label || length + label.length + 1 > 250) return;
      out.push(label); length += label.length + 1;
    });
    return out;
  }

  /** Bir silme/yeniden adlandırma sonrası artık geçersiz olan sipariş etiketlerini temizler. */
  function pruneAssignments(map, settings) {
    const valid = new Set([REGULAR_ID, ...normalizeSettings(settings).tags.map(tag => tag.id)]);
    let removed = 0;
    if (!map || typeof map !== 'object') return 0;
    Object.keys(map).forEach(key => { if (!valid.has(cleanId(map[key]))) { delete map[key]; removed += 1; } });
    return removed;
  }

  return Object.freeze({
    REGULAR_ID, REGULAR_LABEL, BACKLOG_HEADER, ROW_KEY, TONES, DEFAULT_TAGS, MAX_TAGS,
    normalizeSettings, defaultSettings, normalizeTags, normalizeRules, normalizeList,
    tagById, idForLabel, displayLabel, resolve, isSpecialLabel, excelValues, pruneAssignments, cleanId, fold,
  });
});
