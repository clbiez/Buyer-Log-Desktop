/* Buyer Log — Unified Order Decision contract
 *
 * Tek source of truth for action severity semantics. Delivery/operational
 * engines facts and signals produce; this module turns them into a user action
 * decision without parsing UI labels.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLOrderDecisionEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTION_PRIORITIES = Object.freeze(['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK']);
  const ACTION_PRIORITY = Object.freeze({
    CRITICAL: Object.freeze({ rank: 0, tr: 'Kritik', en: 'Critical', tone: 'red' }),
    ACTION_TODAY: Object.freeze({ rank: 1, tr: 'Bugün Aksiyon', en: 'Action Today', tone: 'orange' }),
    ACTION_THIS_WEEK: Object.freeze({ rank: 2, tr: 'Bu Hafta Aksiyon', en: 'Action This Week', tone: 'yellow' }),
    WATCH: Object.freeze({ rank: 3, tr: 'İzlemede', en: 'Watch', tone: 'blue' }),
    ON_TRACK: Object.freeze({ rank: 4, tr: 'Yolunda', en: 'On Track', tone: 'green' }),
  });
  const CALCULATION_STATUS = Object.freeze(['KNOWN', 'UNKNOWN']);

  const REASON_POLICY = Object.freeze({
    ALREADY_LATE_FOR_TARGET: Object.freeze({ actionFloor: 'CRITICAL', tr: 'Hedef tarih için zaten gecikmiş', en: 'Already late for the target date' }),
    EXPECTED_LATE_FOR_TARGET: Object.freeze({ actionFloor: 'ACTION_TODAY', tr: 'Hedef tarihe yetişmesi beklenmiyor', en: 'Not expected to make the target date' }),
    EX_FACTORY_OVERDUE: Object.freeze({ actionFloor: null, tr: 'Ex-Factory tarihi geçmiş, sipariş hâlâ üretimde', en: 'Ex-Factory date passed, still in production' }),
    HANDOVER_PENDING: Object.freeze({ actionFloor: 'ACTION_THIS_WEEK', tr: 'Yükleme onayı verildi, Handover bekleniyor', en: 'Loading confirmed, Handover pending' }),
    STALE_ORDER_NOT_LOADED: Object.freeze({ actionFloor: 'WATCH', tr: 'Sipariş yaşlanmış, hâlâ yüklenmemiş', en: 'Order has aged and is still not loaded' }),
    LOADING_WINDOW_IMMINENT: Object.freeze({ actionFloor: 'WATCH', tr: 'Yükleme penceresi çok yakın', en: 'Loading window is imminent' }),
    MISSING_TRANSIT_RULE: Object.freeze({ actionFloor: 'WATCH', tr: 'Yol süresi kuralı tanımsız', en: 'Transit time rule is not defined' }),
    MISSING_DATE: Object.freeze({ actionFloor: 'WATCH', tr: 'Zorunlu tarih eksik', en: 'A required date is missing' }),
    DATE_SYNC_MISMATCH: Object.freeze({ actionFloor: 'WATCH', tr: 'Buyer Log ve ASAS tarihi farklı', en: 'Buyer Log and ASAS dates differ' }),

    // Backlog delivery/root-cause signals. These are operational causes, not
    // separate priority engines; they contribute floors to the same resolver.
    TARGET_DATE_PASSED: Object.freeze({ actionFloor: 'CRITICAL', tr: 'Hedef tarih geçti', en: 'Target date passed' }),
    PRODUCTION_DELAY: Object.freeze({ actionFloor: 'ACTION_TODAY', tr: 'Üretim gecikmesi', en: 'Production delay' }),
    TRANSIT_DELAY: Object.freeze({ actionFloor: 'ACTION_THIS_WEEK', tr: 'Transit gecikmesi', en: 'Transit delay' }),
    CUSTOMS_DELAY: Object.freeze({ actionFloor: 'ACTION_THIS_WEEK', tr: 'Gümrük/Liman gecikmesi', en: 'Customs delay' }),
    RETAIL_TRANSFER_DELAY: Object.freeze({ actionFloor: 'ACTION_THIS_WEEK', tr: 'Retaile aktarım gecikmesi', en: 'Retail transfer delay' }),
    INSUFFICIENT_TRANSIT_BUFFER: Object.freeze({ actionFloor: 'ACTION_THIS_WEEK', tr: 'Yetersiz transit süresi', en: 'Insufficient transit buffer' }),
    LATE_LOADING: Object.freeze({ actionFloor: 'WATCH', tr: 'Geç yükleme', en: 'Late loading' }),
    NOT_YET_LOADED: Object.freeze({ actionFloor: 'WATCH', tr: 'Henüz yüklenmedi', en: 'Not yet loaded' }),
    UNKNOWN: Object.freeze({ actionFloor: 'WATCH', tr: 'Hesaplama için veri yetersiz', en: 'Insufficient data to calculate' }),
  });

  function priorityRank(key) {
    const item = ACTION_PRIORITY[key];
    return item ? item.rank : Number.POSITIVE_INFINITY;
  }

  function normalizePriority(key, fallback) {
    if (ACTION_PRIORITY[key]) return key;
    if (key === 'ACT_TODAY') return 'ACTION_TODAY';
    if (key === 'ACT_THIS_WEEK') return 'ACTION_THIS_WEEK';
    // UNKNOWN is calculation state, not action severity.
    if (key === 'UNKNOWN') return fallback || 'WATCH';
    return fallback || 'ON_TRACK';
  }

  function moreUrgent(a, b) {
    const left = normalizePriority(a, 'ON_TRACK');
    const right = normalizePriority(b, 'ON_TRACK');
    return priorityRank(left) <= priorityRank(right) ? left : right;
  }

  function reasonObject(input) {
    if (!input) return null;
    if (typeof input === 'string') {
      const policy = REASON_POLICY[input] || {};
      return { code: input, source: 'system', actionFloor: policy.actionFloor || null, textTr: policy.tr || input, textEn: policy.en || input };
    }
    const code = String(input.code || '').trim();
    if (!code) return null;
    const policy = REASON_POLICY[code] || {};
    return {
      ...input,
      code,
      source: input.source || 'system',
      actionFloor: normalizePriority(input.actionFloor || policy.actionFloor, null),
      textTr: input.textTr || input.reasonTr || policy.tr || input.name || code,
      textEn: input.textEn || input.reasonEn || policy.en || input.name || code,
    };
  }

  function dedupeReasons(reasons) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(reasons) ? reasons : []) {
      const item = reasonObject(raw);
      if (!item || seen.has(item.code)) continue;
      seen.add(item.code);
      out.push(item);
    }
    return out;
  }

  function calculationStatusFor(deliveryOutcome) {
    return deliveryOutcome === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN';
  }

  /* Shared action policy. AT_RISK by itself intentionally does not escalate. */
  function resolveActionPriority(input) {
    const data = input || {};
    const deliveryOutcome = data.deliveryOutcome || (data.delivery && data.delivery.outcome) || 'UNKNOWN';
    const calculationStatus = data.calculationStatus || calculationStatusFor(deliveryOutcome);
    const preLoad = data.preLoad === true;
    const daysToLoad = Number.isFinite(Number(data.daysToLoad)) ? Number(data.daysToLoad) : null;
    const settings = { criticalLoadDays: 3, actionThisWeekDays: 7, ...(data.settings || {}) };
    const reasons = dedupeReasons([...(data.reasons || []), ...(data.signals || [])]);

    let priority = 'ON_TRACK';
    // If the delivery calculation itself is UNKNOWN, date-derived delivery
    // escalation is not trustworthy. Start at WATCH and let concrete
    // operational signals (Handover, missing data, custom rules...) raise it.
    if (calculationStatus === 'UNKNOWN') {
      priority = 'WATCH';
    } else if (deliveryOutcome === 'ALREADY_LATE' || (preLoad && daysToLoad != null && daysToLoad < 0)) {
      priority = 'CRITICAL';
    } else if (deliveryOutcome === 'EXPECTED_LATE' && preLoad && daysToLoad != null && daysToLoad <= Number(settings.criticalLoadDays)) {
      priority = 'CRITICAL';
    } else if (deliveryOutcome === 'EXPECTED_LATE' || (preLoad && daysToLoad != null && daysToLoad <= Number(settings.criticalLoadDays))) {
      priority = 'ACTION_TODAY';
    } else if (preLoad && daysToLoad != null && daysToLoad <= Number(settings.actionThisWeekDays)) {
      priority = 'ACTION_THIS_WEEK';
    }

    for (const reason of reasons) {
      if (reason.actionFloor) priority = moreUrgent(priority, reason.actionFloor);
    }

    return { priority, calculationStatus, reasons };
  }

  function needsAttention(decision) {
    const priority = decision && decision.action ? decision.action.priority : decision && decision.priority;
    return normalizePriority(priority, 'ON_TRACK') !== 'ON_TRACK';
  }

  function createDecision(input) {
    const data = input || {};
    const action = resolveActionPriority({
      deliveryOutcome: data.delivery && data.delivery.outcome,
      calculationStatus: data.calculationStatus,
      preLoad: data.preLoad,
      daysToLoad: data.daysToLoad,
      settings: data.settings,
      reasons: data.reasons,
      signals: data.signals,
    });
    return {
      orderKey: data.orderKey || '',
      context: data.context || {},
      stage: data.stage || 'UNKNOWN',
      signals: dedupeReasons(data.signals || []),
      delivery: data.delivery || { outcome: 'UNKNOWN' },
      calculationStatus: action.calculationStatus,
      action: { priority: action.priority, reasons: action.reasons },
      risk: data.risk || { state: 'NO_RISK', reasons: [] },
    };
  }

  function traceDecision(decision) {
    if (!decision) return [];
    return (decision.action && decision.action.reasons ? decision.action.reasons : []).map(item => ({
      code: item.code, source: item.source, actionFloor: item.actionFloor || null,
    }));
  }

  return {
    ACTION_PRIORITIES, ACTION_PRIORITY, CALCULATION_STATUS, REASON_POLICY,
    priorityRank, normalizePriority, moreUrgent, reasonObject, dedupeReasons,
    calculationStatusFor, resolveActionPriority, needsAttention, createDecision, traceDecision,
  };
});
