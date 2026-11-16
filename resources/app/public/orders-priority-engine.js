/* Siparişler (Orders) öncelik motoru — SAF: DOM, ağ, depolama yok.
 *
 * CP ile aynı kanonik motorlar kullanılır: taban analiz cp-readiness-engine,
 * kurallar cp-rules-engine. Fark: Siparişler'de kontrol listesi (checklist)
 * YOKTUR; kurallar checklistEnabled:false ve boş cevaplarla değerlendirilir.
 * Checklist'e bağlı koşullar bu yüzden "notApplicable" sayılır ve tetiklenmez.
 *
 * Bu modül worker'da (orders-priority-worker.js), worker yoksa ana iş
 * parçacığında parça parça ve Node testlerinde aynı kodla çalışır.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(
    isNode ? require('./order-decision-engine') : root.BLOrderDecisionEngine,
    isNode ? require('./cp-readiness-engine') : root.BLCpReadinessEngine,
    isNode ? require('./cp-rules-engine') : root.BLCpRulesEngine
  );
  if (isNode) module.exports = api;
  if (root) root.BLOrdersPriorityEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OD, CP, Rules) {
  'use strict';

  /* Bir hesap oturumu: bağlam bir kez hazırlanır, satırlar parça parça
     değerlendirilir. Sonuç satır başına yalnız öncelik kodu + takip etiketleridir;
     CP'ye özgü özet model (yükleme planı, gruplar) üretilmez. */
  function createSession(input) {
    const spec = input || {};
    const context = spec.context || {};
    const priorityCatalog = Array.isArray(spec.priorityCatalog) ? spec.priorityCatalog : null;
    if (OD && typeof OD.setPriorityCatalog === 'function') OD.setPriorityCatalog(priorityCatalog);
    const rules = (Array.isArray(spec.rules) ? spec.rules : [])
      .map(rule => Rules.normalizeRule(rule, { kind: rule && rule.kind, priorityCatalog: priorityCatalog || undefined }))
      .filter(rule => rule && rule.kind === 'priority');
    const preparedRules = typeof Rules.prepareEvaluation === 'function' ? Rules.prepareEvaluation(rules) : null;
    const options = { rules, preparedRules, answers: {}, checklistEnabled: false, priorityCatalog: priorityCatalog || undefined };
    if (spec.today != null) options.today = spec.today;
    function evaluateRow(row) {
      if (!row || typeof row !== 'object') return { priority: '', trackingTags: [], priorityTags: [] };
      const analysis = CP.analyzeOrder(row, context);
      const evaluated = Rules.evaluateOrder(analysis, options);
      return {
        priority: String(evaluated && evaluated.priority || analysis.priority || ''),
        priorityTags: evaluated.priorityTags || [],
        trackingTags: Array.isArray(evaluated && evaluated.trackingTags) ? evaluated.trackingTags.slice() : [],
      };
    }
    function evaluateBatch(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const codes = new Array(list.length), tags = new Array(list.length), priorityTags = new Array(list.length);
      for (let i = 0; i < list.length; i += 1) {
        const result = evaluateRow(list[i]);
        codes[i] = result.priority;
        tags[i] = result.trackingTags.length ? result.trackingTags : null;
        priorityTags[i] = result.priorityTags.length ? result.priorityTags : null;
      }
      return { codes, tags, priorityTags };
    }
    return { evaluateRow, evaluateBatch, ruleCount: rules.length };
  }

  /* Worker'a gönderilecek alanlar: CP motorunun okuduğu kanonik CP alanları
     (cp-readiness-engine FIELDS; analiz, tarih senkronu, teslimat ve operasyon
     bayrakları yalnız bunları okur) + kuralların başvurduğu satır alanları.
     30–50k satırın tamamını kopyalamak ana iş parçacığında ~1,3 sn CPU ve
     büyük bellek baskısı yaratıyordu. Eşdeğerlik testlerle doğrulanır. */
  function collectRuleFields(value, out) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => collectRuleFields(item, out)); return; }
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'field' || key === 'offsetField') && typeof item === 'string' && item && item[0] !== '@') out.add(item);
      else if (item && typeof item === 'object') collectRuleFields(item, out);
    }
  }
  function requiredFields(input) {
    const spec = input || {};
    const out = new Set(Object.values((CP && CP.FIELDS) || {}).filter(Boolean));
    for (const rule of Array.isArray(spec.rules) ? spec.rules : []) {
      if (!rule || rule.kind !== 'priority') continue;
      collectRuleFields(rule.conditions, out);
      for (const source of [rule.formula, rule.autoFormula]) {
        String(source || '').replace(/\[([^\]]+)\]/g, (_, name) => { const field = String(name).trim(); if (field && field[0] !== '@') out.add(field); return ''; });
      }
    }
    return [...out];
  }
  function projectRow(row, fields) {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const key of fields) if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
    return out;
  }

  return Object.freeze({ createSession, requiredFields, projectRow });
});
