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
    CRITICAL: Object.freeze({ rank: 0, tr: 'Kritik', en: 'Critical', tone: 'red', isRisk: true, builtIn: true }),
    ACTION_TODAY: Object.freeze({ rank: 1, tr: 'Bugün Aksiyon', en: 'Action Today', tone: 'orange', isRisk: true, builtIn: true }),
    ACTION_THIS_WEEK: Object.freeze({ rank: 2, tr: 'Bu Hafta Aksiyon', en: 'Action This Week', tone: 'yellow', isRisk: true, builtIn: true }),
    WATCH: Object.freeze({ rank: 3, tr: 'İzlemede', en: 'Watch', tone: 'blue', isRisk: false, builtIn: true }),
    ON_TRACK: Object.freeze({ rank: 4, tr: 'Yolunda', en: 'On Track', tone: 'green', isRisk: false, builtIn: true, base: true }),
  });
  const PRIORITY_TONES = Object.freeze(['red', 'copper', 'orange', 'yellow', 'blue', 'teal', 'green', 'gray']);
  const TONE_LABELS = Object.freeze({
    red: Object.freeze({ tr: 'Kırmızı', en: 'Red' }),
    copper: Object.freeze({ tr: 'Bakır', en: 'Copper' }),
    orange: Object.freeze({ tr: 'Turuncu', en: 'Orange' }),
    yellow: Object.freeze({ tr: 'Kehribar', en: 'Amber' }),
    blue: Object.freeze({ tr: 'Mavi', en: 'Blue' }),
    teal: Object.freeze({ tr: 'Petrol', en: 'Teal' }),
    green: Object.freeze({ tr: 'Yeşil', en: 'Green' }),
    gray: Object.freeze({ tr: 'Gri', en: 'Gray' }),
  });
  const DEFAULT_PRIORITY_CATALOG = Object.freeze(ACTION_PRIORITIES.map((id, rank) => Object.freeze({
    id,
    rank,
    tr: ACTION_PRIORITY[id].tr,
    en: ACTION_PRIORITY[id].en,
    tone: ACTION_PRIORITY[id].tone,
    isRisk: ACTION_PRIORITY[id].isRisk,
    builtIn: true,
    base: id === 'ON_TRACK',
  })));
  const CALCULATION_STATUS = Object.freeze(['KNOWN', 'UNKNOWN']);

  function normalizeTone(tone, fallback = 'orange') {
    const raw = String(tone || '').trim().toLowerCase();
    if (PRIORITY_TONES.includes(raw)) return raw;
    if (raw === 'danger') return 'red';
    if (raw === 'amber' || raw === 'warning') return 'yellow';
    if (raw === 'accent') return 'blue';
    if (raw === 'success') return 'green';
    if (raw === 'neutral' || raw === 'muted') return 'gray';
    return PRIORITY_TONES.includes(fallback) ? fallback : 'orange';
  }

  function makePriorityId(label, existingIds = []) {
    const map = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
    const slug = String(label || '')
      .replace(/[çğıİöşüÇĞÖŞÜ]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    const base = slug || `tag-${Date.now().toString(36).slice(-5)}`;
    const taken = new Set(existingIds);
    let id = `prio:${base}`, counter = 2;
    while (taken.has(id)) {
      const suffix = `-${counter++}`;
      id = `prio:${base.slice(0, 35 - suffix.length)}${suffix}`;
    }
    return id;
  }

  function isCustomPriorityCode(value) {
    return typeof value === 'string' && /^prio:[a-z0-9_-]{1,35}$/.test(value);
  }

  function normalizePriorityEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const rawId = String(raw.id || '').trim();
    const builtInMeta = ACTION_PRIORITY[rawId] || null;
    if (builtInMeta) {
      const tr = String(raw.tr || raw.name || builtInMeta.tr).trim().slice(0, 64) || builtInMeta.tr;
      const en = String(raw.en || raw.nameEn || (raw.tr || raw.name ? tr : builtInMeta.en)).trim().slice(0, 64) || builtInMeta.en;
      const isBase = rawId === 'ON_TRACK';
      return {
        id: rawId,
        tr,
        en,
        tone: isBase ? normalizeTone(raw.tone, 'green') : normalizeTone(raw.tone, builtInMeta.tone),
        isRisk: isBase ? false : (raw.isRisk !== undefined ? Boolean(raw.isRisk) : builtInMeta.isRisk),
        builtIn: true,
        base: isBase,
        ...(raw.managed === true ? { managed: true } : {}),
      };
    }
    const trInput = String(raw.tr || raw.name || raw.en || '').trim().slice(0, 64);
    const enInput = String(raw.en || raw.nameEn || trInput).trim().slice(0, 64);
    if (!trInput && !enInput && !isCustomPriorityCode(rawId)) return null;
    const tr = trInput || enInput || rawId.slice(5);
    const en = enInput || tr;
    const id = isCustomPriorityCode(rawId) ? rawId : makePriorityId(tr);
    return {
      id,
      tr,
      en,
      tone: normalizeTone(raw.tone, 'orange'),
      ...(raw.usage === 'tracking' ? { usage: 'tracking' } : {}),
      isRisk: raw.usage === 'tracking' ? false : (raw.isRisk !== undefined ? Boolean(raw.isRisk) : true),
      builtIn: false,
      base: false,
      ...(raw.managed === true ? { managed: true } : {}),
    };
  }

  function normalizePriorityCatalog(list) {
    const items = [];
    const seen = new Set();
    let onTrackEntry = null;
    for (const raw of Array.isArray(list) ? list : []) {
      const clean = normalizePriorityEntry(raw);
      if (!clean || seen.has(clean.id)) continue;
      seen.add(clean.id);
      if (clean.id === 'ON_TRACK') { onTrackEntry = clean; continue; }
      items.push(clean);
    }
    for (const def of DEFAULT_PRIORITY_CATALOG) {
      if (def.id === 'ON_TRACK' || seen.has(def.id)) continue;
      seen.add(def.id);
      items.push({ ...def });
    }
    items.push(onTrackEntry || { ...DEFAULT_PRIORITY_CATALOG[DEFAULT_PRIORITY_CATALOG.length - 1] });
    let customCount = 0;
    return items.filter(item => item.builtIn || customCount++ < 40 - DEFAULT_PRIORITY_CATALOG.length)
      .map((item, rank) => ({ ...item, rank }));
  }

  function effectivePriorityCatalog(personalList, managedList) {
    const managedItems = [];
    const managedMap = new Map();
    for (const raw of Array.isArray(managedList) ? managedList : []) {
      const clean = normalizePriorityEntry(raw);
      if (!clean) continue;
      const tagged = { ...clean, managed: true };
      if (!managedMap.has(tagged.id)) {
        managedMap.set(tagged.id, tagged);
        managedItems.push(tagged);
      }
    }
    const personalItems = [];
    for (const raw of Array.isArray(personalList) ? personalList : []) {
      if (raw && raw.managed === true) continue;
      const clean = normalizePriorityEntry(raw);
      if (!clean) continue;
      personalItems.push(clean);
    }
    if (!managedItems.length) return normalizePriorityCatalog(personalItems);
    if (!personalItems.length) return normalizePriorityCatalog(managedItems);
    const merged = [];
    const seen = new Set();
    for (const item of personalItems) {
      const chosen = managedMap.get(item.id) || item;
      if (!seen.has(chosen.id)) { seen.add(chosen.id); merged.push(chosen); }
    }
    let insertIdx = merged.findIndex(item => item.id === 'ON_TRACK');
    if (insertIdx < 0) insertIdx = merged.length;
    for (const item of managedItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.splice(insertIdx, 0, item);
      insertIdx += 1;
    }
    return normalizePriorityCatalog(merged);
  }

  let activeCatalog = DEFAULT_PRIORITY_CATALOG.map(item => ({ ...item }));
  let activeById = new Map(activeCatalog.map(item => [item.id, item]));

  function catalogIndex(catalog) {
    if (!Array.isArray(catalog) || !catalog.length) return { list: activeCatalog, map: activeById };
    const normalized = catalog[0] && typeof catalog[0].rank === 'number' && catalog[catalog.length - 1]?.id === 'ON_TRACK'
      ? catalog
      : normalizePriorityCatalog(catalog);
    return { list: normalized, map: new Map(normalized.map(item => [item.id, item])) };
  }

  function setPriorityCatalog(catalog) {
    activeCatalog = catalog ? normalizePriorityCatalog(catalog) : DEFAULT_PRIORITY_CATALOG.map(item => ({ ...item }));
    activeById = new Map(activeCatalog.map(item => [item.id, item]));
    return activeCatalog.map(item => ({ ...item }));
  }

  function getPriorityCatalog() {
    return activeCatalog.map(item => ({ ...item }));
  }

  function priorityIds(catalog) {
    return catalogIndex(catalog).list.map(item => item.id);
  }

  function priorityMeta(key, catalog) {
    if (!key) return null;
    const code = key === 'ACT_TODAY' ? 'ACTION_TODAY' : key === 'ACT_THIS_WEEK' ? 'ACTION_THIS_WEEK' : String(key);
    const { map } = catalogIndex(catalog);
    if (map.has(code)) return map.get(code);
    if (ACTION_PRIORITY[code]) return ACTION_PRIORITY[code];
    if (isCustomPriorityCode(code)) {
      const slugLabel = code.slice(5).replace(/[-_]+/g, ' ').trim() || code;
      const baseRank = (map.get('ON_TRACK') || ACTION_PRIORITY.ON_TRACK).rank;
      return { id: code, rank: Math.max(0, baseRank - 0.5), tr: slugLabel, en: slugLabel, tone: 'orange', isRisk: true, builtIn: false };
    }
    return null;
  }

  function priorityLabel(key, lang, catalog) {
    const meta = priorityMeta(key, catalog);
    if (!meta) return '';
    return lang === 'en' ? (meta.en || meta.tr || meta.id) : (meta.tr || meta.en || meta.id);
  }

  function priorityTone(key, catalog) {
    const meta = priorityMeta(key, catalog);
    return meta && meta.tone ? meta.tone : 'gray';
  }

  function isRiskPriority(key, catalog) {
    const meta = priorityMeta(key, catalog);
    if (!meta || meta.id === 'ON_TRACK') return false;
    return meta.isRisk === true;
  }

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

  function priorityRank(key, catalog) {
    const meta = priorityMeta(key, catalog);
    return meta && Number.isFinite(meta.rank) ? meta.rank : Number.POSITIVE_INFINITY;
  }

  function normalizePriority(key, fallback, catalog) {
    const cat = Array.isArray(fallback) ? fallback : catalog;
    const fb = Array.isArray(fallback) ? undefined : fallback;
    if (key === 'ACT_TODAY') return 'ACTION_TODAY';
    if (key === 'ACT_THIS_WEEK') return 'ACTION_THIS_WEEK';
    // UNKNOWN is calculation state, not action severity.
    if (key === 'UNKNOWN') return fb !== undefined ? fb : 'WATCH';
    if (typeof key === 'string' && key) {
      const { map } = catalogIndex(cat);
      if (map.has(key) || ACTION_PRIORITY[key] || isCustomPriorityCode(key)) return key;
    }
    return fb !== undefined ? fb : 'ON_TRACK';
  }

  function moreUrgent(a, b, catalog) {
    const left = normalizePriority(a, 'ON_TRACK', catalog);
    const right = normalizePriority(b, 'ON_TRACK', catalog);
    return priorityRank(left, catalog) <= priorityRank(right, catalog) ? left : right;
  }
  const maxPriority = moreUrgent;

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

  function needsAttention(decision, catalog) {
    const priority = decision && decision.action ? decision.action.priority : decision && decision.priority;
    return normalizePriority(priority, 'ON_TRACK', catalog) !== 'ON_TRACK';
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
    ACTION_PRIORITIES, ACTION_PRIORITY, PRIORITY_TONES, TONE_LABELS, DEFAULT_PRIORITY_CATALOG,
    CALCULATION_STATUS, REASON_POLICY,
    normalizeTone, makePriorityId, isCustomPriorityCode, normalizePriorityEntry, normalizePriorityCatalog,
    effectivePriorityCatalog, setPriorityCatalog, getPriorityCatalog, priorityIds, priorityMeta,
    priorityLabel, priorityTone, isRiskPriority,
    priorityRank, normalizePriority, moreUrgent, maxPriority, reasonObject, dedupeReasons,
    calculationStatusFor, resolveActionPriority, needsAttention, createDecision, traceDecision,
  };
});
