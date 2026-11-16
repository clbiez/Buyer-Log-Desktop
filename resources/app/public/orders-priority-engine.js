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
      if (!row || typeof row !== 'object') return { priority: '', trackingTags: [] };
      const analysis = CP.analyzeOrder(row, context);
      const evaluated = Rules.evaluateOrder(analysis, options);
      return {
        priority: String(evaluated && evaluated.priority || analysis.priority || ''),
        trackingTags: Array.isArray(evaluated && evaluated.trackingTags) ? evaluated.trackingTags.slice() : [],
      };
    }
    function evaluateBatch(rows) {
      const list = Array.isArray(rows) ? rows : [];
      const codes = new Array(list.length), tags = new Array(list.length);
      for (let i = 0; i < list.length; i += 1) {
        const result = evaluateRow(list[i]);
        codes[i] = result.priority;
        tags[i] = result.trackingTags.length ? result.trackingTags : null;
      }
      return { codes, tags };
    }
    return { evaluateRow, evaluateBatch, ruleCount: rules.length };
  }

  return Object.freeze({ createSession });
});
