/* Buyer Log — Kontrol & Kurallar Merkezi (Checklist & Rules Studio + Genel Bakış Kartı)
 *
 * İş mantığı saf motorlardadır:
 *   · order-decision-engine.js  — Dinamik Öncelik Kataloğu ve aciliyet sıralaması
 *   · cp-readiness-engine.js    — Sipariş analizi ve özet sayımlar
 *   · cp-checklist-engine.js    — Checklist durumları, bileşenler ve özetleme
 *   · cp-rules-engine.js        — Öncelik kuralları, checklist kapsamı ve otomatik durum
 *
 * Bu dosya görünüm katmanıdır: Genel Bakış özetini, 3 sekmeli Kontrol & Kurallar
 * Merkezi'ni (İş Listesi · Öncelik Kuralları & Etiketler · Kontrol Soruları & Durumlar)
 * ve kullanıcı tercihlerini (BLStorage + Moderatör yayını) bağlar.
 */
(function () {
  'use strict';
  const OD = window.BLOrderDecisionEngine || null;
  const Engine = window.BLCpReadinessEngine;
  const Checklist = window.BLCpChecklistEngine;
  const Rules = window.BLCpRulesEngine;
  if (!Engine || !Checklist || !Rules) return;

  const PREF_KEY = 'lcw.cp.assistant.v1';
  const ANSWER_KEY = 'lcw.cp.checklist.v1';
  const QUEUE_VIEW_KEY = 'lcw.cp.assistant.queue-view.v1';
  /* Öncelik kuralları (+ öncelik etiketleri) ve checklist soruları (+ özel durumlar)
     kendi anahtarlarında durur; Ön Ayar Paylaşımı bu iki alanı bağımsız aktarır. */
  const RULE_KEYS = Object.freeze({
    priority: 'lcw.cp.rules.priority.v1',
    checklist: 'lcw.cp.rules.checklist.v1',
  });
  const CHECKLIST_RULE_STORE_VERSION = 2;
  const ATTENTION_DEFAULT_COLUMNS = Object.freeze([
    'sys:priority', 'sys:order', 'sys:style', 'sys:supplier',
    'sys:age', 'sys:toLoad', 'sys:target', 'sys:reason',
  ]);
  const ATTENTION_EXCLUSION_SCOPE = Object.freeze({ REASON: 'reason', ORDER: 'order' });
  const TONE_IDS = Object.freeze(['red', 'copper', 'orange', 'yellow', 'blue', 'teal', 'green', 'gray']);

  function normalizeAttentionExclusions(value) {
    const source = Array.isArray(value) ? value : [];
    const clean = [];
    const seen = new Set();
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') continue;
      const orderKey = String(raw.orderKey || '').trim();
      const targetType = raw.targetType === 'inStore' ? 'inStore' : raw.targetType === 'retail' ? 'retail' : '';
      const scope = raw.scope === ATTENTION_EXCLUSION_SCOPE.ORDER ? ATTENTION_EXCLUSION_SCOPE.ORDER
        : raw.scope === ATTENTION_EXCLUSION_SCOPE.REASON ? ATTENTION_EXCLUSION_SCOPE.REASON : '';
      const reasonCode = scope === ATTENTION_EXCLUSION_SCOPE.REASON ? String(raw.reasonCode || '').trim() : '';
      if (!orderKey || !targetType || !scope || (scope === ATTENTION_EXCLUSION_SCOPE.REASON && !reasonCode)) continue;
      const expiresAt = raw.expiresAt == null || raw.expiresAt === '' ? null : String(raw.expiresAt);
      if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) continue;
      const id = String(raw.id || `${orderKey}|${targetType}|${scope}|${reasonCode}`);
      if (seen.has(id)) continue;
      seen.add(id);
      clean.push({
        id, orderKey,
        orderCode: String(raw.orderCode || ''),
        modelName: String(raw.modelName || ''),
        colourCode: String(raw.colourCode || ''),
        targetType, scope, reasonCode,
        createdAt: String(raw.createdAt || ''),
        expiresAt,
        createdBy: String(raw.createdBy || ''),
        note: String(raw.note || ''),
      });
    }
    return clean;
  }

  function normalizeAttentionColumns(value) {
    const source = Array.isArray(value) ? value : ATTENTION_DEFAULT_COLUMNS;
    const seen = new Set();
    const clean = [];
    for (const id of source) {
      const key = String(id || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key); clean.push(key);
    }
    return clean.length ? clean : ATTENTION_DEFAULT_COLUMNS.slice();
  }

  const defaultCatalog = () => (OD && Array.isArray(OD.DEFAULT_PRIORITY_CATALOG)
    ? OD.DEFAULT_PRIORITY_CATALOG.map(item => ({ ...item }))
    : [
      { id: 'CRITICAL', tr: 'Kritik', en: 'Critical', tone: 'red', isRisk: true, builtIn: true },
      { id: 'ACTION_TODAY', tr: 'Bugün Aksiyon', en: 'Action Today', tone: 'orange', isRisk: true, builtIn: true },
      { id: 'ACTION_THIS_WEEK', tr: 'Bu Hafta Aksiyon', en: 'Action This Week', tone: 'yellow', isRisk: true, builtIn: true },
      { id: 'WATCH', tr: 'İzlemede', en: 'Watch', tone: 'blue', isRisk: false, builtIn: true },
      { id: 'ON_TRACK', tr: 'Yolunda', en: 'On Track', tone: 'green', isRisk: false, builtIn: true },
    ]);

  const state = {
    model: null,
    checklist: null,
    rowsSignature: '',
    perspective: 'buyer',
    settings: { targetType: 'retail' },
    checklistSettings: Checklist.normalizeSettings(null),
    answers: {},
    hidden: {},
    deletedRuleIds: [],
    rules: Rules.mergeWithDefaults(null),
    personalPriorityCatalog: defaultCatalog(),
    priorityCatalog: defaultCatalog(),
    managed: Rules.normalizeManagedRules(null),
    shadowedPersonal: [],
    sharedChecklistAdopted: false,
    fieldCatalog: null,
    attentionLimit: 25,
    attentionColumns: ATTENTION_DEFAULT_COLUMNS.slice(),
    attentionExclusions: [],
    moduleLayout: {},
    activePriority: 'ALL',
  };

  /* ------------------------------------------------------------ yardımcılar */
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const lang = () => (isEn() ? 'en' : 'tr');
  const locale = () => (isEn() ? 'en-GB' : 'tr-TR');
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const int = value => Math.round(Number(value) || 0).toLocaleString(locale());
  const priorityLabel = key => {
    if (key === 'UNKNOWN') return Engine.PRIORITY_LABELS[lang()].UNKNOWN || key;
    if (OD && typeof OD.priorityLabel === 'function') return OD.priorityLabel(key, lang(), state.priorityCatalog);
    return Engine.PRIORITY_LABELS[lang()][key] || key;
  };
  const priorityToneOf = key => {
    if (key === 'UNKNOWN') return 'gray';
    if (OD && typeof OD.priorityTone === 'function') return OD.priorityTone(key, state.priorityCatalog);
    return ({ CRITICAL: 'red', ACTION_TODAY: 'orange', ACTION_THIS_WEEK: 'yellow', WATCH: 'blue', ON_TRACK: 'green' })[key] || 'gray';
  };
  const statusToneOf = status => {
    if (Checklist && typeof Checklist.statusTone === 'function') return Checklist.statusTone(status);
    return ({ open: 'blue', approved: 'green', rejected: 'red', notRequired: 'gray' })[status] || 'blue';
  };
  const toneLabel = tone => {
    if (OD && OD.TONE_LABELS && OD.TONE_LABELS[lang()] && OD.TONE_LABELS[lang()][tone]) return OD.TONE_LABELS[lang()][tone];
    const mapTr = { red: 'Kırmızı', copper: 'Bakır', orange: 'Turuncu', yellow: 'Kehribar', blue: 'Mavi', teal: 'Petrol', green: 'Yeşil', gray: 'Gri' };
    const mapEn = { red: 'Red', copper: 'Copper', orange: 'Amber', yellow: 'Gold', blue: 'Blue', teal: 'Teal', green: 'Green', gray: 'Neutral' };
    return (isEn() ? mapEn : mapTr)[tone] || tone;
  };
  const reasonLabel = key => Engine.RISK_REASON_LABELS[lang()][key] || key;
  const itemLabel = item => (isEn() ? (item.en || item.nameEn || item.name || item.tr) : (item.tr || item.name || item.en));
  const questionOf = item => (isEn() ? (item.questionEn || item.questionTr || '') : (item.questionTr || item.questionEn || ''));

  function dateText(ordinal) {
    if (ordinal == null) return '—';
    const date = new Date(Number(ordinal) * 86400000);
    return isNaN(date) ? '—' : date.toISOString().slice(0, 10);
  }

  /* KULLANICI BAZLI SAKLAMA: BLStorage ZORUNLU. */
  const unreadablePreferenceStores = new Set();
  const store = {
    get(key) {
      return window.BLStorage ? window.BLStorage.getItem(key) : localStorage.getItem(key);
    },
    set(key, value) {
      if (unreadablePreferenceStores.has(key)) throw new Error(L('Okunamayan ayar/kural kaydı korundu. Kaydı kurtarmadan üzerine yazılamaz.', 'The unreadable settings/rules record was preserved. Recover it before overwriting it.'));
      if (window.BLStorage) window.BLStorage.setItem(key, value); else localStorage.setItem(key, value);
      if (store.get(key) !== value) throw new Error(L('Kayıt depoya yazılamadı.', 'The record could not be written to storage.'));
    },
  };

  function hydrateSharedCustomStatuses(list) {
    if (!Array.isArray(list) || !list.length || typeof Checklist.addCustomStatus !== 'function') return;
    const known = new Set((Checklist.personalCustomStatuses ? Checklist.personalCustomStatuses() : Checklist.customStatuses()).map(item => item.id));
    for (const entry of list) {
      if (!entry || !entry.id || known.has(entry.id)) continue;
      try {
        Checklist.addCustomStatus({
          id: entry.id,
          tr: entry.tr || entry.name || '',
          en: entry.en || entry.tr || entry.name || '',
          tone: entry.tone || 'blue',
          resolved: Boolean(entry.resolved),
        });
        known.add(entry.id);
      } catch (_) { /* kapasite veya geçersiz kayıt: mevcutlar korunur */ }
    }
  }

  let migrateRuleStores = false;
  function loadPrefs() {
    let parsed = null;
    try {
      parsed = JSON.parse(store.get(PREF_KEY) || 'null');
      if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Invalid preference store');
      if (parsed && ((parsed.rules != null && !Array.isArray(parsed.rules)) || (parsed.deletedRuleIds != null && !Array.isArray(parsed.deletedRuleIds)))) throw new Error('Invalid legacy rule store');
    } catch (_) { parsed = null; unreadablePreferenceStores.add(PREF_KEY); }
    try {
      const raw = parsed && typeof parsed === 'object' ? parsed : {};
      {
        state.perspective = 'buyer';
        if (raw.settings && raw.settings.targetType === 'inStore') state.settings.targetType = 'inStore';
        state.checklistSettings = Checklist.normalizeSettings(raw.checklistSettings);
        state.hidden = raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {};
        const stored = loadRuleStores(raw);
        state.deletedRuleIds = stored.deletedRuleIds;
        state.sharedChecklistAdopted = stored.sharedChecklistAdopted;
        if (stored.priorityCatalog && OD && typeof OD.normalizePriorityCatalog === 'function') {
          state.personalPriorityCatalog = OD.normalizePriorityCatalog(stored.priorityCatalog);
        }
        if (stored.customStatuses) hydrateSharedCustomStatuses(stored.customStatuses);
        applyRuleLayers(stored.rules);
        raw.rules = stored.rules;
        if (stored.needsMigration) migrateRuleStores = true;

        const savedRuleIds = new Set((Array.isArray(raw.rules) ? raw.rules : [])
          .map(rule => String(rule && rule.id || '')).filter(Boolean));
        for (const id of (Rules.DEFAULT_CHECKLIST_RULE_IDS || [])) {
          if (savedRuleIds.has(id) || state.deletedRuleIds.includes(id)) continue;
          const rule = state.rules.find(item => item.id === id && item.kind === 'checklist');
          const config = state.checklistSettings.items && state.checklistSettings.items[id];
          if (!rule || !config) continue;
          rule.enabled = config.enabled !== false;
          const limit = Number(config.maxDaysToLoad);
          const grace = Number(state.checklistSettings.overdueGraceDays);
          if (Number.isFinite(limit)) {
            const daysCondition = (rule.conditions || []).find(condition =>
              condition.field === '@daysToLoad' && condition.operator === 'lte');
            if (daysCondition) {
              daysCondition.value = limit;
              if (daysCondition.right) daysCondition.right.value = limit;
            }
            if (rule.mode === 'formula' && rule.formula) {
              rule.formula = rule.formula.replace(/(\[@daysToLoad\]<=)-?\d+(?:\.\d+)?/, `$1${limit}`);
            }
          }
          if (Number.isFinite(grace)) {
            const overdueCondition = (rule.conditions || []).find(condition =>
              condition.field === '@daysToLoad' && condition.operator === 'gte');
            if (overdueCondition) {
              overdueCondition.value = -grace;
              if (overdueCondition.right) overdueCondition.right.value = -grace;
            }
            if (rule.mode === 'formula' && rule.formula) {
              rule.formula = rule.formula.replace(/(\[@daysToLoad\]>=)-?\d+(?:\.\d+)?/, `$1${-grace}`);
            }
          }
        }
        state.attentionColumns = normalizeAttentionColumns(raw.attentionColumns);
        state.attentionExclusions = normalizeAttentionExclusions(raw.attentionExclusions || raw.attentionExceptions);
        state.moduleLayout = normalizeModuleLayouts(raw.moduleLayout);
      }
    } catch (_) { unreadablePreferenceStores.add(PREF_KEY); unreadablePreferenceStores.add(RULE_KEYS.priority); unreadablePreferenceStores.add(RULE_KEYS.checklist); }
    try {
      const raw = JSON.parse(store.get(ANSWER_KEY) || 'null');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) state.answers = raw;
      else if (raw != null) throw new Error('Invalid checklist answer store');
    } catch (_) { state.answers = {}; state.answerStoreError = true; }
  }

  function readRuleStore(kind) {
    try {
      const parsed = JSON.parse(store.get(RULE_KEYS[kind]) || 'null');
      if (parsed == null) return null;
      if (typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.rules)
        || (parsed.deletedRuleIds != null && !Array.isArray(parsed.deletedRuleIds))) throw new Error('Invalid rule store');
      return parsed;
    } catch (_) { unreadablePreferenceStores.add(RULE_KEYS[kind]); return null; }
  }

  function loadRuleStores(legacy) {
    const priority = readRuleStore('priority');
    const checklist = readRuleStore('checklist');
    const legacyRules = legacy && Array.isArray(legacy.rules) ? legacy.rules : [];
    const legacyDeleted = legacy && Array.isArray(legacy.deletedRuleIds) ? legacy.deletedRuleIds : [];
    const ofKind = (list, kind) => list.filter(rule => rule && (rule.kind === kind || (kind === 'priority' && !rule.kind)));
    const withLegacy = (stored, kind) => {
      const legacyOfKind = ofKind(legacyRules, kind);
      if (!stored) return legacyOfKind;
      const ids = new Set(stored.rules.map(rule => rule && rule.id));
      return [...stored.rules, ...legacyOfKind.filter(rule => !ids.has(rule.id))];
    };
    const rawChecklistRules = withLegacy(checklist, 'checklist');
    const checklistStoreVersion = checklist ? Math.max(1, Number(checklist.version) || 1) : 0;
    const legacyHasCustomChecklist = !checklist && rawChecklistRules.some(rule => rule && rule.builtIn !== true);
    const checklistScopeMigration = Boolean(
      (checklist && checklistStoreVersion < CHECKLIST_RULE_STORE_VERSION) || legacyHasCustomChecklist
    );
    const checklistRules = rawChecklistRules.map(rule => {
      if (!checklistScopeMigration || !rule || rule.builtIn === true || rule.approvalScope === 'option') return rule;
      return { ...rule, approvalScope: 'option' };
    });
    const rules = [...withLegacy(priority, 'priority'), ...checklistRules];
    const deleted = [
      ...(priority ? priority.deletedRuleIds || [] : []),
      ...(checklist ? checklist.deletedRuleIds || [] : []),
      ...(legacyDeleted || []),
    ];
    return {
      rules,
      deletedRuleIds: [...new Set(deleted.map(String).filter(Boolean))],
      sharedChecklistAdopted: Boolean(checklist && checklist.sharedChecklistAdopted),
      priorityCatalog: priority && Array.isArray(priority.priorityCatalog) ? priority.priorityCatalog : null,
      customStatuses: checklist && Array.isArray(checklist.customStatuses) ? checklist.customStatuses : null,
      needsMigration: legacyRules.length > 0 || legacyDeleted.length > 0 || checklistScopeMigration,
    };
  }

  const managedChannel = () => window.BLCpManagedRules || null;
  state.managed = Rules.normalizeManagedRules(managedChannel()?.cached?.());
  function personalRuleList() {
    return [...state.rules.filter(rule => rule && rule.managed !== true), ...state.shadowedPersonal];
  }
  function applyRuleLayers(personalRules) {
    if (typeof OD !== 'undefined' && OD && typeof OD.effectivePriorityCatalog === 'function') {
      state.priorityCatalog = OD.effectivePriorityCatalog(state.personalPriorityCatalog, state.managed && state.managed.priorityCatalog);
      OD.setPriorityCatalog(state.priorityCatalog);
      if (typeof window !== 'undefined' && typeof window.fillPrioritySelect === 'function') {
        try { window.fillPrioritySelect('cpFPriority'); } catch (_) { /* filtre hazır değilse ilk çizimde dolar */ }
      }
    }
    if (typeof Checklist !== 'undefined' && Checklist && typeof Checklist.setManagedStatuses === 'function') {
      Checklist.setManagedStatuses((state.managed && state.managed.checklistStatuses) || []);
    }
    const managedIds = new Set([...state.managed.rules.map(rule => rule.id), ...state.managed.deletedRuleIds]);
    state.shadowedPersonal = (Array.isArray(personalRules) ? personalRules : [])
      .filter(rule => rule && rule.managed !== true && managedIds.has(rule.id));
    state.rules = Rules.effectiveRules(personalRules, state.deletedRuleIds, state.managed);
  }
  const isModerator = () => Boolean(window.BLIsModerator && window.BLIsModerator());
  function ruleStorePayload(kind) {
    const defaults = new Set(Rules.DEFAULT_RULES.filter(rule => rule.kind === kind).map(rule => rule.id));
    const extra = kind === 'priority'
      ? (Array.isArray(state.personalPriorityCatalog) ? { priorityCatalog: state.personalPriorityCatalog } : {})
      : {
        sharedChecklistAdopted: state.sharedChecklistAdopted === true,
        ...(typeof Checklist !== 'undefined' && Checklist && typeof Checklist.personalCustomStatuses === 'function'
          ? { customStatuses: Checklist.personalCustomStatuses() } : {}),
      };
    return {
      version: kind === 'checklist' ? CHECKLIST_RULE_STORE_VERSION : 2,
      rules: personalRuleList().filter(rule => rule.kind === kind),
      deletedRuleIds: state.deletedRuleIds.filter(id => defaults.has(id)),
      ...extra,
    };
  }
  function saveRules() {
    store.set(RULE_KEYS.priority, JSON.stringify(ruleStorePayload('priority')));
    store.set(RULE_KEYS.checklist, JSON.stringify(ruleStorePayload('checklist')));
  }

  let decisionContextRevision = 0;
  // Cevap dışındaki karar girdileri (kurallar, ayarlar, katalog…) için revizyon:
  // kişisel katman deltası yalnız bu revizyon sabitken kullanılır.
  let nonAnswerContextRevision = 0;
  let answerNotifyBatchDepth = 0, answerNotifyPending = false;
  function notifyDecisionContextChanged(reason) {
    decisionContextRevision += 1;
    if (reason !== 'checklist-answer') nonAnswerContextRevision += 1;
    try {
      window.dispatchEvent(new CustomEvent('bl:cp-decision-context-changed', {
        detail: { reason: reason || 'preferences', revision: decisionContextRevision },
      }));
    } catch (_) { /* eski browser: persistence yine çalışır */ }
  }
  function savePrefs() {
    try {
      if (unreadablePreferenceStores.size) throw new Error(L('Okunamayan ayar/kural kaydı korundu. Kaydı kurtarmadan değişiklik kaydedilemez.', 'The unreadable settings/rules record was preserved. Recover it before saving changes.'));
      saveRules();
      store.set(PREF_KEY, JSON.stringify({
        perspective: state.perspective, settings: state.settings,
        checklistSettings: state.checklistSettings, hidden: state.hidden,
        attentionColumns: state.attentionColumns, attentionExclusions: state.attentionExclusions,
        moduleLayout: state.moduleLayout,
      }));
      notifyDecisionContextChanged('preferences');
    } catch (error) {
      if (typeof showToast === 'function') showToast(L('Checklist ayarları kaydedilemedi: ', 'Checklist settings could not be saved: ') + error.message);
      throw error;
    }
  }
  function saveAnswers(options) {
    let saved = true;
    try {
      if (state.answerStoreError && options && options.recovered === true) {
        const storage = window.BLStorage;
        const native = storage && storage.native || localStorage;
        const recoveryKey = storage && storage.actualKey ? storage.actualKey('lcw.cp.checklist.recovery.v1') : 'lcw.cp.checklist.recovery.v1';
        native.setItem(recoveryKey, store.get(ANSWER_KEY) || '');
        state.answerStoreError = false;
      }
      if (state.answerStoreError) throw new Error(L('Önceki checklist kaydı okunamıyor; üzerine yazılmadı.', 'The previous checklist record cannot be read; it was not overwritten.'));
      store.set(ANSWER_KEY, JSON.stringify(state.answers));
    }
    catch (error) {
      saved = false;
      if (typeof window.showToast === 'function') window.showToast(L('Checklist yerel kaydı başarısız; sunucu kaydı bekleniyor: ', 'Checklist local save failed; waiting for server save: ') + error.message);
    }
    if (!options || options.silent !== true) {
      if (answerNotifyBatchDepth) answerNotifyPending = true;
      else notifyDecisionContextChanged('checklist-answer');
    }
    return saved;
  }
  /* Toplu checklist güncellemesi: her cevap yerel depoya yine hemen yazılır ve
     dönüş değeri korunur; yalnız karar bağlamı bildirimi sonda BİR KEZ yayılır.
     Bildirim başına bütün CP kararları ve kontrol listesi sütunları yeniden
     hesaplanıyordu (25 bin satırda cevap başına ~7,6 sn). Hata ortada kesse de
     o ana kadar uygulanan cevaplar için bildirim yayılır. */
  function batchChecklistAnswers(fn) {
    answerNotifyBatchDepth += 1;
    try { return fn(); }
    finally {
      answerNotifyBatchDepth -= 1;
      if (!answerNotifyBatchDepth && answerNotifyPending) {
        answerNotifyPending = false;
        notifyDecisionContextChanged('checklist-answer');
      }
    }
  }

  function setChecklistAnswer(analysis, itemId, status, meta) {
    if (!analysis || !analysis.orderKey || !itemId) return false;
    const Components = Checklist.Components;
    const scoped = Components.parseItem(itemId);
    const parts = Checklist.componentsFor(analysis, { answers: state.answers });
    if (scoped && !parts.some(part => part.id === scoped.partId)) return false;
    if (!scoped && itemId !== Components.CONFIG_ITEM && (parts.length || Components.isSet(analysis.sourceRow || analysis, 'cp'))) return false;
    const key = Checklist.answerKey(analysis.orderKey, itemId);
    const next = Checklist.normalizeStatus(status) || 'open';
    const rule = state.rules.find(item => item && item.kind === 'checklist' && item.id === (scoped ? scoped.baseId : itemId));
    const reusable = Boolean(rule && rule.approvalScope === 'option' && typeof Checklist.optionAnswerKey === 'function');
    const optionKey = reusable ? Checklist.optionAnswerKey(analysis, itemId) : '';
    const by = (window.BL_USER_CONTEXT || {}).id || '';
    const previous = state.answers[key] || (optionKey ? state.answers[optionKey] : null) || {};
    const preserved = {};
    ['note', 'reportNumber', 'actualDate', 'attachments', 'componentCount', 'elements'].forEach(field => {
      if (Object.prototype.hasOwnProperty.call(previous, field)) preserved[field] = previous[field];
    });
    if (!(meta && Object.prototype.hasOwnProperty.call(meta, 'elements')) && Array.isArray(preserved.elements) && preserved.elements.length
      && Checklist.Components.elementsState(preserved.elements, Checklist.isResolved) !== next) {
      preserved.elements = preserved.elements.map(item => ({ ...item, state: next }));
    }
    const answerMeta = { ...preserved, ...(meta || {}), by };
    const remoteAt = window.BLChecklistSupplierSync && typeof window.BLChecklistSupplierSync.latestAnswerAt === 'function'
      ? Math.max(window.BLChecklistSupplierSync.latestAnswerAt(key), optionKey ? window.BLChecklistSupplierSync.latestAnswerAt(optionKey) : 0) : 0;
    const lastAt = Math.max(Date.parse(previous.at || '') || 0, state.lastAnswerAt || 0, remoteAt);
    answerMeta.at = new Date(Math.max(Date.now(), lastAt + 1)).toISOString();
    state.lastAnswerAt = Date.parse(answerMeta.at);

    if (next === 'open') {
      state.answers[key] = Checklist.makeAnswer('open', analysis, answerMeta);
      if (optionKey && state.answers[optionKey]) {
        state.answers[optionKey] = Checklist.makeAnswer('open', analysis, { ...state.answers[optionKey], at: answerMeta.at, by, loadDate: null });
      }
    } else if (next === 'approved' && optionKey) {
      state.answers[key] = Checklist.makeAnswer(next, analysis, answerMeta);
      state.answers[optionKey] = Checklist.makeAnswer(next, analysis, { ...answerMeta, loadDate: null });
    } else {
      state.answers[key] = Checklist.makeAnswer(next, analysis, answerMeta);
    }
    if (scoped && !state.answers[Components.configKey(analysis)]) {
      state.answers[Components.configKey(analysis)] = Checklist.makeAnswer('open', analysis, { componentCount: parts.length, at: answerMeta.at, by });
    }
    if (scoped && optionKey && state.answers[optionKey]) {
      const rosterKey = Checklist.optionAnswerKey(analysis, Components.CONFIG_ITEM);
      const count = Math.max(parts.length, state.answers[rosterKey]?.componentCount || 0);
      if (count !== state.answers[rosterKey]?.componentCount) {
        state.answers[rosterKey] = Checklist.makeAnswer('open', analysis, { componentCount: count, at: answerMeta.at, by, loadDate: null });
      }
    }
    return saveAnswers();
  }
  function setChecklistComponents(analysis, count) {
    const Components = Checklist.Components, n = Components.validCount(count);
    if (!analysis || !analysis.orderKey || n < 2) return false;
    const previous = state.answers[Components.configKey(analysis)];
    if (previous && previous.componentCount > n) return false;
    return setChecklistAnswer(analysis, Components.CONFIG_ITEM, 'open', { componentCount: n });
  }

  function validateHologramOrders(rows) {
    if (state.answerStoreError) throw new Error(L('Checklist kaydı okunamıyor.', 'Checklist record cannot be read.'));
    const decision = computeDecisionsForRows(rows);
    if (rows.some(row => !String(window.BLCanonicalFields.value(row, 'cp', 'orderCode') || '').trim() || !decision.byRow.get(row)?.orderKey)) throw new Error(L('Sipariş kimliği çözülemedi.', 'Order identity could not be resolved.'));
    if (rows.some(row => { const analysis = decision.byRow.get(row); return Checklist.Components.isSet(analysis.sourceRow || analysis, 'cp') && !Checklist.componentsFor(analysis, { answers: state.answers }).length; })) throw new Error(L('Önce CP hücresinden set parçalarını tanımlayın.', 'Define the set parts from the CP cell first.'));
    return decision;
  }
  function markHologramOrdered(rows) {
    const decision = validateHologramOrders(rows), token = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
    let item = state.rules.find(rule => rule.kind === 'checklist' && [rule.id, rule.name, rule.nameEn, rule.tr, rule.en].some(value => ['hologramcheck', 'hologramkontrol', 'hologramkontrolu'].includes(token(value))));
    if (!item) item = createChecklistItem({ tr: 'Hologram Check', en: 'Hologram Check' });
    batchChecklistAnswers(() => {
      for (const row of rows) {
        const analysis = decision.byRow.get(row), parts = Checklist.componentsFor(analysis, { answers: state.answers });
        const targets = parts.length ? parts.map(part => Checklist.Components.itemId(item.id, part.id)) : [item.id];
        for (const target of targets) if (!setChecklistAnswer(analysis, target, 'custom:ordered')) throw new Error(L('Checklist kaydedilemedi.', 'Checklist could not be saved.'));
      }
    });
    if (state.answerStoreError) throw new Error(L('Checklist kaydı okunamıyor.', 'Checklist record cannot be read.'));
    return item.id;
  }

  function createChecklistItem(spec) {
    const tr = String(spec && spec.tr || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const en = String(spec && spec.en || '').replace(/\s+/g, ' ').trim().slice(0, 160) || tr;
    if (!tr) return null;
    const question = { tr: ' tamamlandı mı?', en: ' complete?' };
    const rule = Rules.normalizeRule({
      kind: 'checklist', name: tr, nameEn: en, tr, en,
      questionTr: tr + question.tr, questionEn: 'Is ' + en + question.en,
      conditions: [{ field: '@daysToLoad', operator: 'lte', value: 365 }],
      expressionVersion: Rules.EXPRESSION_VERSION, approvalScope: 'order',
      evidenceFields: { reportNumber: true, actualDate: false, attachments: true },
    });
    const previousRules = state.rules;
    state.rules = [...state.rules, rule];
    try { savePrefs(); }
    catch (error) { state.rules = previousRules; throw error; }
    recompute();
    return rule;
  }

  function adoptSharedChecklistDefinitions(definitions) {
    if (state.sharedChecklistAdopted) return false;
    const known = new Set(state.rules.map(rule => rule.id));
    const deleted = new Set(state.deletedRuleIds);
    const incoming = (Array.isArray(definitions) ? definitions : [])
      .map(item => Rules.normalizeRule(item, 'checklist'))
      .filter(rule => rule && !rule.builtIn && !known.has(rule.id) && !deleted.has(rule.id));
    const previousRules = state.rules;
    state.rules = [...state.rules, ...incoming];
    state.sharedChecklistAdopted = true;
    try { savePrefs(); }
    catch (error) { state.rules = previousRules; state.sharedChecklistAdopted = false; throw error; }
    if (lastRows) { state.rowsSignature = ''; onOverviewRendered(lastRows, { dataRevision: window.BL_CP_DECISION_DATA_REVISION?.() || 0, filterRevision: 'adopted-checklist' }); }
    return incoming.length > 0;
  }

  /* Moderatör yayını: kurallar + öncelik etiketleri + özel checklist durumları. */
  let managedRulesRedraw = null;
  function applyManagedRules(payload) {
    const next = Rules.normalizeManagedRules(payload);
    const signature = value => JSON.stringify([value.rules, value.deletedRuleIds, value.priorityCatalog || [], value.checklistStatuses || []]);
    const changed = signature(next) !== signature(state.managed);
    const personal = personalRuleList();
    state.managed = next;
    if (!changed) return false;
    applyRuleLayers(personal);
    notifyDecisionContextChanged('preferences');
    if (lastRows) { state.rowsSignature = ''; onOverviewRendered(lastRows, { dataRevision: typeof window !== 'undefined' && window.BL_CP_DECISION_DATA_REVISION?.() || 0, filterRevision: 'managed-rules' }); }
    if (typeof managedRulesRedraw === 'function') managedRulesRedraw();
    return true;
  }
  function loadManagedRules() {
    const channel = managedChannel();
    if (!channel) return Promise.resolve(false);
    return channel.load().then(payload => (payload ? applyManagedRules(payload) : false)).catch(() => false);
  }
  async function saveManagedRules(next, message) {
    if (!isModerator()) throw new Error(L('Bu işlem yalnız Moderatör tarafından yapılabilir.', 'Only the Moderator can do this.'));
    const channel = managedChannel();
    if (!channel) throw new Error(L('Moderatör kural kanalı yüklenemedi.', 'The Moderator rule channel could not be loaded.'));
    const mergedPayload = {
      priorityCatalog: state.managed && Array.isArray(state.managed.priorityCatalog) ? state.managed.priorityCatalog : [],
      checklistStatuses: state.managed && Array.isArray(state.managed.checklistStatuses) ? state.managed.checklistStatuses : [],
      ...(next || {}),
    };
    const clean = Rules.normalizeManagedRules(mergedPayload);
    let payload;
    try { payload = await channel.save(clean, state.managed.revision); }
    catch (error) { if (error && error.status === 409) void loadManagedRules(); throw error; }
    applyManagedRules(payload);
    if (message && typeof showToast === 'function') showToast(message);
    return payload;
  }
  const managedCopy = rule => {
    const clean = Rules.normalizeRule({ ...JSON.parse(JSON.stringify(rule)), managed: true }, { kind: rule.kind, priorityCatalog: state.priorityCatalog });
    return JSON.parse(JSON.stringify(clean));
  };
  function publishRuleToAll(rule) {
    const rules = state.managed.rules.filter(item => item.id !== rule.id).concat(managedCopy(rule));
    return saveManagedRules({ rules, deletedRuleIds: state.managed.deletedRuleIds.filter(id => id !== rule.id) },
      L('Tüm kullanıcılara uygulandı. Master kural yayınıyla dağıtılıyor.', 'Applied to all users. It is distributed with the Master rule release.'));
  }
  function unpublishRule(ruleId) {
    return saveManagedRules({ rules: state.managed.rules.filter(item => item.id !== ruleId), deletedRuleIds: state.managed.deletedRuleIds },
      L('Yayından kaldırıldı; kullanıcıların kendi kopyaları korunur.', 'Unpublished; users keep their own copies.'));
  }
  function deleteRuleForAll(ruleId) {
    return saveManagedRules({ rules: state.managed.rules.filter(item => item.id !== ruleId), deletedRuleIds: [...new Set([...state.managed.deletedRuleIds, ruleId])] },
      L('Tüm kullanıcılardan silindi.', 'Deleted for all users.'));
  }
  function restoreRuleForAll(ruleId) {
    return saveManagedRules({ rules: state.managed.rules, deletedRuleIds: state.managed.deletedRuleIds.filter(id => id !== ruleId) },
      L('Silme geri alındı; kural kullanıcılara yeniden açıldı.', 'Deletion undone; the rule is available to users again.'));
  }
  /* Moderatörün yayımlanmış bir kuralda yaptığı düzenleme yayına yazılır. */
  let managedSyncTimer = 0;
  function scheduleManagedSync() {
    if (!isModerator()) return;
    const edited = state.rules.filter(rule => rule.managed === true).map(managedCopy);
    if (JSON.stringify(edited) === JSON.stringify(state.managed.rules.map(managedCopy))) return;
    clearTimeout(managedSyncTimer);
    managedSyncTimer = setTimeout(() => {
      const current = state.rules.filter(rule => rule.managed === true).map(managedCopy);
      saveManagedRules({ rules: current, deletedRuleIds: state.managed.deletedRuleIds })
        .catch(error => { if (typeof showToast === 'function') showToast(error.message); });
    }, 700);
  }
  window.addEventListener('bl:cp-managed-rules-changed', () => { void loadManagedRules(); });

  function publishPriorityTagToAll(tagId) {
    const tag = (state.personalPriorityCatalog || []).find(item => item.id === tagId && !item.builtIn)
      || (state.priorityCatalog || []).find(item => item.id === tagId && !item.builtIn);
    if (!tag) return Promise.resolve(null);
    const priorityCatalog = (state.managed.priorityCatalog || []).filter(item => item.id !== tagId)
      .concat([{ id: tag.id, tr: tag.tr, en: tag.en || tag.tr, tone: tag.tone, isRisk: tag.isRisk !== false, usage: tag.usage, managed: true }]);
    return saveManagedRules({ rules: state.managed.rules, deletedRuleIds: state.managed.deletedRuleIds, priorityCatalog },
      L('Öncelik etiketi tüm kullanıcılara yayımlandı.', 'Priority tag published to all users.'));
  }
  function unpublishPriorityTag(tagId) {
    const priorityCatalog = (state.managed.priorityCatalog || []).filter(item => item.id !== tagId);
    return saveManagedRules({ rules: state.managed.rules, deletedRuleIds: state.managed.deletedRuleIds, priorityCatalog },
      L('Öncelik etiketi yayından kaldırıldı.', 'Priority tag unpublished.'));
  }
  function publishChecklistStatusToAll(statusId) {
    const entry = Checklist.customStatuses().find(item => item.id === statusId);
    if (!entry) return Promise.resolve(null);
    const checklistStatuses = (state.managed.checklistStatuses || []).filter(item => item.id !== statusId)
      .concat([{ id: entry.id, name: entry.tr || entry.name, tr: entry.tr || entry.name, en: entry.en || entry.tr || entry.name, tone: entry.tone || 'blue', resolved: Boolean(entry.resolved), managed: true }]);
    return saveManagedRules({ rules: state.managed.rules, deletedRuleIds: state.managed.deletedRuleIds, checklistStatuses },
      L('Checklist durumu tüm kullanıcılara yayımlandı.', 'Checklist status published to all users.'));
  }
  function unpublishChecklistStatus(statusId) {
    const checklistStatuses = (state.managed.checklistStatuses || []).filter(item => item.id !== statusId);
    return saveManagedRules({ rules: state.managed.rules, deletedRuleIds: state.managed.deletedRuleIds, checklistStatuses },
      L('Checklist durumu yayından kaldırıldı.', 'Checklist status unpublished.'));
  }

  /* ------------------------------------------------------------- yerleşim */
  const CARD_ORDER = {
    buyer: ['priorities', 'checklist'],
    merchandiser: ['checklist', 'priorities'],
    manager: ['priorities', 'dimensions', 'checklist'],
  };
  const MODULE_META = Object.freeze({
    priorities: { label: () => L('Öncelikler', 'Priorities') },
    checklist: { label: () => L('Kontrol Listesi', 'Checklist') },
    dimensions: { label: () => L('Kırılımlar', 'Breakdowns') },
  });

  function normalizeLayoutEntry(value, perspective) {
    const defaults = (CARD_ORDER[perspective] || CARD_ORDER.buyer).slice();
    const allowed = new Set(defaults);
    const rawOrder = value && Array.isArray(value.order) ? value.order : [];
    const seen = new Set();
    const order = [];
    for (const rawId of rawOrder) {
      const id = String(rawId || '').trim();
      if (!allowed.has(id) || seen.has(id)) continue;
      seen.add(id); order.push(id);
    }
    for (const id of defaults) {
      if (!seen.has(id)) { seen.add(id); order.push(id); }
    }
    const hidden = [];
    const hiddenSource = value && Array.isArray(value.hidden) ? value.hidden : [];
    for (const rawId of hiddenSource) {
      const id = String(rawId || '').trim();
      if (allowed.has(id) && !hidden.includes(id)) hidden.push(id);
    }
    return { order, hidden };
  }

  function normalizeModuleLayouts(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      buyer: normalizeLayoutEntry(source.buyer, 'buyer'),
      merchandiser: normalizeLayoutEntry(source.merchandiser, 'merchandiser'),
      manager: normalizeLayoutEntry(source.manager, 'manager'),
    };
  }

  /* ------------------------------------------------------------------ çizim */
  function host() { return document.getElementById('cpAssistant'); }
  function attentionHost() { return document.getElementById('cpAssistantAttention'); }
  function coverageHost() { return document.getElementById('cpAssistantCoverage'); }

  function openQueueCount() {
    if (!state.checklistSettings.enabled || !state.checklist) return 0;
    return state.checklist.items.reduce((sum, item) => sum + Math.max(0, Number(item.rows) || 0), 0);
  }

  function toolbarHtml() {
    const queueTotal = openQueueCount();
    return `<div class="cpaBar">
      <div class="cpaTitle"><b>${esc(L('Kontrol Listesi ve Kurallar', 'Checklist & Rules'))}</b>
        <small>${esc(L('Açık kontrolleri yönet, öncelik etiketleri ve kuralları düzenle.', 'Manage open checks, priority tags and rules.'))}</small></div>
      <div class="cpaBarActions">
        <div class="cpaSeg" role="group" aria-label="${esc(L('Hedef tarih', 'Target date'))}">
          <button type="button" data-cpa-target="retail" class="${state.settings.targetType !== 'inStore' ? 'is-on' : ''}">${esc(L('Retail Depo', 'Retail'))}</button>
          <button type="button" data-cpa-target="inStore" class="${state.settings.targetType === 'inStore' ? 'is-on' : ''}">${esc(L('In Store', 'In Store'))}</button>
        </div>
        <button type="button" class="cpaBtn primary" data-cpa-queue>${esc(L('İş Listesi', 'Work Queue'))}${queueTotal ? `<span class="cpaBtnBadge">${int(queueTotal)}</span>` : ''}</button>
        <button type="button" class="cpaBtn" data-cpa-rules>${esc(L('Kurallar & Etiketler', 'Rules & Tags'))}</button>
        <button type="button" class="cpaBtn" data-cpa-settings>${esc(L('Kontrol Soruları', 'Checklist Questions'))}</button>
      </div>
    </div>`;
  }

  function prioritiesOverviewBlock() {
    const model = state.model;
    if (!model) return '';
    const catalogIds = (state.priorityCatalog || defaultCatalog()).map(entry => entry.id);
    const order = [...catalogIds, 'UNKNOWN'];
    const byKey = new Map((model.priorities || []).map(item => [item.name, item]));
    const visibleKeys = order.filter(key => {
      const rows = (byKey.get(key) || { rows: 0 }).rows || 0;
      return rows > 0 || ['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'ON_TRACK'].includes(key);
    });
    const chips = visibleKeys.map(key => {
      const measure = byKey.get(key) || { rows: 0, qty: 0 };
      const tone = priorityToneOf(key);
      return `<button type="button" class="cpaChip tone-${esc(tone)} ${state.activePriority === key ? 'is-on' : ''}" data-cpa-priority="${esc(key)}" ${measure.rows ? '' : 'disabled'}>
        <span class="n">${int(measure.rows)}</span><span class="l">${esc(priorityLabel(key))}</span><span class="q">${int(measure.qty)} ${esc(L('adet', 'units'))}</span></button>`;
    }).join('');
    const totalRows = catalogIds.reduce((sum, key) => sum + ((byKey.get(key) || { rows: 0 }).rows || 0), 0);
    const mix = totalRows ? `<div class="cpaMix" role="img" aria-label="${esc(L('Öncelik dağılımı', 'Priority mix'))}">${catalogIds.map(key => {
      const rows = (byKey.get(key) || { rows: 0 }).rows || 0;
      if (!rows) return '';
      const share = Math.round(rows / totalRows * 1000) / 10;
      const tone = priorityToneOf(key);
      return `<button type="button" class="cpaMixSeg tone-${esc(tone)}" style="flex:${rows} 0 0" data-cpa-priority="${esc(key)}" title="${esc(`${priorityLabel(key)} · ${int(rows)} · %${share}`)}" aria-label="${esc(`${priorityLabel(key)} ${int(rows)}`)}"></button>`;
    }).join('')}</div>` : '';
    const reasons = ruleReasonCounts(model).slice(0, 5).map(item => {
      const label = item.label;
      const automateLabel = L('Bu konu için e-mail otomasyonu oluştur', 'Create an email automation for this issue');
      return `<li class="cpaReasonRow">
        <button type="button" class="cpaIconBtn cpaReasonEmailAction" data-cpa-automate-reason="${esc(item.name)}" title="${esc(automateLabel)}" aria-label="${esc(automateLabel)}">✉</button>
        <button type="button" class="cpaReasonMain" data-cpa-reason="${esc(item.name)}" title="${esc(label)}"><span class="cpaReasonTitle">${esc(label)}</span><b class="cpaReasonCount">${int(item.count)}</b></button>
      </li>`;
    }).join('');
    const active = state.activePriority;
    const canAutomate = active !== 'ALL' && !active.startsWith('REASON:');
    const customTagCount = (state.priorityCatalog || []).filter(item => !item.builtIn).length;
    return `<section class="cpaOverviewPriorities" aria-label="${esc(L('Öncelik dağılımı ve aktif kurallar', 'Priority distribution and active rules'))}">
      <div class="cpaOverviewPrioHead">
        <b>${esc(L('Canlı Öncelik Dağılımı', 'Live Priority Distribution'))}${customTagCount ? ` <small class="cpaNote">· ${int(customTagCount)} ${esc(L('özel etiket', 'custom tags'))}</small>` : ''}</b>
        <button type="button" class="cpaBtn sm ghost" data-cpa-rules>+ ${esc(L('Etiket veya kural ekle', 'Add tag or rule'))}</button>
      </div>
      ${mix}
      <div class="cpaChips">${chips}</div>
      ${canAutomate ? `<div class="cpaRowBetween"><span class="cpaNote">${esc(priorityLabel(active))} · ${int((byKey.get(active) || { rows: 0 }).rows)} ${esc(L('sipariş satırı', 'order rows'))}</span>
        <button type="button" class="cpaBtn sm" data-cpa-automate-priority="${esc(active)}">✉ ${esc(L('Otomasyon oluştur', 'Create automation'))}</button></div>` : ''}
      ${reasons ? `<ul class="cpaReasons">${reasons}</ul>` : ''}
    </section>`;
  }

  function overviewWidgetHtml() {
    const items = state.checklist?.items || [];
    const rejected = items.reduce((total, item) => total + (item.rejected || 0), 0);
    const attention = Engine.needsAttention(state.model, { limit: 1, priorityCatalog: state.priorityCatalog }).total;
    return `<div class="cpaOverviewCompact">
      <div class="cpaOverviewMetrics" role="group" aria-label="${esc(L('Takip özeti', 'Follow-up summary'))}">
        <button type="button" class="cpaOverviewMetric" data-cpa-queue-scope="openRejected"><b>${int(openQueueCount())}</b><span>${esc(L('Açık kontrol', 'Open checks'))}</span></button>
        <button type="button" class="cpaOverviewMetric" data-cpa-queue-scope="rejected"><b>${int(rejected)}</b><span>${esc(L('Reddedilen', 'Rejected'))}</span></button>
        <button type="button" class="cpaOverviewMetric" data-cpa-summary-attention><b>${int(attention)}</b><span>${esc(L('Aksiyon gereken sipariş', 'Orders needing action'))}</span></button>
      </div>
      <div class="cpaOverviewActions"><button type="button" class="cpaBtn primary" data-cpa-queue>${esc(L('İş Listesini Aç', 'Open Work Queue'))}</button><button type="button" class="cpaBtn" data-cpa-rules>${esc(L('Kurallar ve Etiketler', 'Rules and Tags'))}</button></div>
      <details class="cpaOverviewDetails"><summary>${esc(L('Dağılım ve kontrol ayrıntıları', 'Distribution and check details'))}</summary>${prioritiesOverviewBlock()}<div class="cpaChecklistOverview">${checklistCard()}</div></details>
    </div>`;
  }

  function checklistCard() {
    const summary = state.checklist;
    if (!state.checklistSettings.enabled) {
      return card('checklist', L('Kontrol Listesi', 'Checklist'),
        `<p class="cpaNote">${esc(L('Kontrol listesi kapalı. Kontrol Soruları sekmesinden açabilirsiniz.', 'The checklist is off. You can turn it on from Checklist Questions.'))}</p>`);
    }
    const pending = summary.items.reduce((sum, item) => sum + Math.max(0, item.rows - (item.rejected || 0)), 0);
    const rejected = summary.items.reduce((sum, item) => sum + (item.rejected || 0), 0);
    const approved = summary.answeredTotal || 0, total = pending + rejected + approved;
    const progress = total ? Math.round(100 * approved / total) : 100;
    const overview = `<div class="cpaCheckSummary"><div class="cpaCheckRing" style="--check-progress:${progress}%" role="img" aria-label="${esc(L('Tamamlanan kontrol', 'Completed checks'))}: ${progress}%"><b>${progress}%</b></div><div><b>${esc(L('Kontrol durumun', 'Your check status'))}</b><span>${int(approved)} ${esc(L('tamamlandı', 'completed'))} · ${int(pending)} ${esc(L('bekliyor', 'pending'))} · ${int(rejected)} ${esc(L('reddedildi', 'rejected'))}</span><small>${esc(L('Toplu yanıt, not ve ekler için bir kontrol seçin ya da İş Listesi’ni açın.', 'Pick a check or open Work Queue for bulk status, notes and attachments.'))}</small></div></div>`;
    const items = summary.items.map((item, index) => {
      const waiting = Math.max(0, item.rows - (item.rejected || 0));
      return `<button type="button" class="cpaCheckTile${item.rejected ? ' hasRejected' : ''}" data-cpa-open-checklist="${esc(item.id)}" style="--check-delay:${index * 30}ms">
        <span class="cpaCheckTileHead"><svg class="ic" aria-hidden="true"><use href="#i-checklist"/></svg><b>${esc(itemLabel(item))}</b><svg class="ic" aria-hidden="true"><use href="#i-chevron-right"/></svg></span>
        <small>${esc(questionOf(item))}</small><span class="cpaCheckTileCounts"><span><b>${int(waiting)}</b> ${esc(L('Bekliyor', 'Pending'))}</span>${item.rejected ? `<span class="cpaCheckRejected"><b>${int(item.rejected)}</b> ${esc(L('Reddedildi', 'Rejected'))}</span>` : ''}${item.reopened ? `<span><b>${int(item.reopened)}</b> ${esc(L('Yeniden', 'Re-asked'))}</span>` : ''}</span>
        ${item.plmOpen || item.plmRejected ? `<span class="cpaNote">PLM · ${int(item.plmOpen || 0)} ${esc(L('açık', 'open'))} · ${int(item.plmRejected || 0)} ${esc(L('reddedildi', 'rejected'))}</span>` : ''}
      </button>`;
    }).join('');
    const disabled = summary.disabled.length
      ? `<p class="cpaNote">${esc(L('Takip edilmeyen kontroller', 'Not tracked'))}: ${summary.disabled.map(item => esc(itemLabel(item))).join(', ')}</p>` : '';
    return card('checklist', L('Kontrol Listesi', 'Checklist'), `
      ${overview}
      ${items ? `<div class="cpaCheckTiles">${items}</div>` : `<p class="cpaEmpty">${esc(L('Şu an açık kontrol yok.', 'No open checks right now.'))}</p>`}
      ${summary.answeredTotal ? `<p class="cpaNote">${esc(L('Onaylanan / gerekmeyen kontrol', 'Approved / not required checks'))}: <b>${int(summary.answeredTotal)}</b>${summary.plmAnsweredTotal ? ` · ${esc(L('PLM onayı / üretim sonrası ile', 'via PLM approval / post-production'))}: <b>${int(summary.plmAnsweredTotal)}</b>` : ''}</p>` : ''}
      ${sampleRequests() ? `<div class="cpaRowBetween"><span class="cpaNote">${esc(L('PLM numune senkronu', 'PLM sample sync'))}: ${esc(sampleRequests().updatedAt ? new Date(sampleRequests().updatedAt).toLocaleString(locale()) : L('henüz yapılmadı', 'not run yet'))}</span>
        <button type="button" class="cpaBtn sm" data-cpa-plm-requests-sync>${esc(L('PLM numune durumunu güncelle', 'Update PLM sample status'))}</button></div>` : ''}
      ${disabled}`);
  }

  function attentionCandidateRows() {
    const list = Engine.needsAttention(state.model, { limit: 5000, priorityCatalog: state.priorityCatalog });
    if (state.activePriority === 'ALL') return list;
    if (state.activePriority.startsWith('REASON:')) {
      const reason = state.activePriority.slice(7);
      return list.filter(item => attentionReasonEntries(item).some(entry => entry.code === reason));
    }
    if (state.activePriority === 'UNKNOWN') return list.filter(item => item.calculationStatus === 'UNKNOWN');
    return list.filter(item => item.priority === state.activePriority);
  }

  function customRuleReasonCode(ruleId) {
    const id = String(ruleId || '').trim();
    return id ? `CUSTOM_RULE:${id}` : '';
  }

  function customRuleReasonText(ruleLike) {
    if (!ruleLike || typeof ruleLike !== 'object') return '';
    const primary = String((isEn() ? ruleLike.reasonEn : ruleLike.reasonTr) || '').trim();
    const secondary = String((isEn() ? ruleLike.reasonTr : ruleLike.reasonEn) || '').trim();
    if (!primary && !secondary && isEn() && ruleLike.nameEn) return String(ruleLike.nameEn || '').trim();
    return primary || secondary || String(ruleLike.name || '').trim();
  }

  function attentionReasonEntries(item) {
    const entries = [];
    const seenCodes = new Set();
    const seenText = new Set();
    const push = (code, textValue, source) => {
      const key = String(code || '').trim();
      const textValueClean = String(textValue || '').trim();
      if (!key || !textValueClean || seenCodes.has(key)) return;
      const textKey = textValueClean.toLocaleLowerCase(isEn() ? 'en-GB' : 'tr-TR');
      if (seenText.has(textKey)) return;
      seenCodes.add(key);
      seenText.add(textKey);
      entries.push({ code: key, text: textValueClean, source });
    };
    for (const rule of (Array.isArray(item && item.matchedRules) ? item.matchedRules : [])) {
      if (!rule || OD?.priorityMeta?.(rule.target, state.priorityCatalog)?.usage === 'tracking') continue;
      const code = String(rule.reasonCode || customRuleReasonCode(rule.id)).trim();
      const textValue = customRuleReasonText(rule);
      if (code && textValue) push(code, textValue, 'customRule');
    }
    return entries;
  }

  function ruleReasonCounts(model) {
    const counts = new Map();
    for (const item of (model && model.orders) || []) {
      for (const entry of attentionReasonEntries(item)) {
        const current = counts.get(entry.code) || { name: entry.code, label: entry.text, count: 0 };
        current.count += 1;
        counts.set(entry.code, current);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  function attentionWarningKeys(item) {
    const reasons = attentionReasonEntries(item).map(entry => entry.code);
    if (reasons.length) return reasons;
    const priority = String(item && item.priority || '').trim();
    return priority && priority !== 'ON_TRACK' ? [`PRIORITY:${priority}`] : [];
  }

  function attentionWarningLabel(code) {
    const key = String(code || '');
    if (key.startsWith('PRIORITY:')) return `${L('Öncelik', 'Priority')}: ${priorityLabel(key.slice(9))}`;
    if (key.startsWith('CUSTOM_RULE:')) {
      const id = key.slice('CUSTOM_RULE:'.length);
      const rule = state.rules.find(item => item && item.id === id);
      return customRuleReasonText(rule) || rule?.name || key;
    }
    return reasonLabel(key);
  }

  function attentionExclusionOrderKey(orderKey, targetType) {
    return `${String(orderKey || '')}\u001f${targetType === 'inStore' ? 'inStore' : 'retail'}`;
  }

  function attentionExclusionReasonKey(orderKey, targetType, reasonCode) {
    return `${attentionExclusionOrderKey(orderKey, targetType)}\u001f${String(reasonCode || '')}`;
  }

  function attentionActiveExclusions(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return normalizeAttentionExclusions(state.attentionExclusions).filter(item =>
      item.expiresAt == null || Date.parse(item.expiresAt) > now);
  }

  function attentionExclusionIndex(nowMs) {
    const order = new Map();
    const reason = new Map();
    for (const exclusion of attentionActiveExclusions(nowMs)) {
      if (exclusion.scope === ATTENTION_EXCLUSION_SCOPE.ORDER) {
        order.set(attentionExclusionOrderKey(exclusion.orderKey, exclusion.targetType), exclusion);
      } else {
        reason.set(attentionExclusionReasonKey(exclusion.orderKey, exclusion.targetType, exclusion.reasonCode), exclusion);
      }
    }
    return { order, reason };
  }

  function isAttentionExcluded(item, index) {
    if (!item || !index) return false;
    const targetType = state.settings.targetType === 'inStore' ? 'inStore' : 'retail';
    if (index.order.has(attentionExclusionOrderKey(item.orderKey, targetType))) return true;
    const warnings = attentionWarningKeys(item);
    return warnings.length > 0 && warnings.every(code =>
      index.reason.has(attentionExclusionReasonKey(item.orderKey, targetType, code)));
  }

  function attentionRowsState() {
    const candidates = attentionCandidateRows();
    const index = attentionExclusionIndex();
    const visible = [];
    const excluded = [];
    for (const item of candidates) (isAttentionExcluded(item, index) ? excluded : visible).push(item);
    return { candidates, visible, excluded };
  }

  function attentionSystemColumns() {
    return [
      { id: 'sys:priority', source: 'system', label: L('Öncelik', 'Priority'), type: 'priority' },
      { id: 'sys:order', source: 'system', label: L('Sipariş', 'Order'), type: 'text' },
      { id: 'sys:style', source: 'system', label: L('Model', 'Style'), type: 'style' },
      { id: 'sys:supplier', source: 'system', label: L('Üretici', 'Supplier'), type: 'text' },
      { id: 'sys:age', source: 'system', label: L('Yaş', 'Age'), type: 'number' },
      { id: 'sys:toLoad', source: 'system', label: L('Yükleme', 'To load'), type: 'number' },
      { id: 'sys:target', source: 'system', label: L('Hedef', 'Target'), type: 'date' },
      { id: 'sys:reason', source: 'system', label: L('Sebep', 'Reason'), type: 'reason' },
    ];
  }

  function attentionCpColumns() {
    const api = window.BLCpAttentionColumns;
    let catalog = [];
    try { catalog = api && typeof api.catalog === 'function' ? api.catalog() : []; }
    catch (_) { catalog = []; }
    if ((!Array.isArray(catalog) || !catalog.length) && state.model && state.model.orders && state.model.orders[0]?.sourceRow) {
      catalog = Object.keys(state.model.orders[0].sourceRow).map(key => ({ key, label: key, group: '', type: 'ro' }));
    }
    return (Array.isArray(catalog) ? catalog : [])
      .filter(col => col && col.key)
      .map(col => ({
        id: `cp:${col.key}`,
        key: col.key,
        source: 'cp',
        label: col.label || col.key,
        group: col.group || '',
        type: col.type || 'ro',
      }));
  }

  function attentionColumnCatalog() {
    return [...attentionSystemColumns(), ...attentionCpColumns()];
  }

  function attentionVisibleColumns() {
    const catalog = attentionColumnCatalog();
    const byId = new Map(catalog.map(col => [col.id, col]));
    const selected = normalizeAttentionColumns(state.attentionColumns).filter(id => byId.has(id));
    if (!selected.length) return ATTENTION_DEFAULT_COLUMNS.map(id => byId.get(id)).filter(Boolean);
    return selected.map(id => byId.get(id)).filter(Boolean);
  }

  function attentionCpValue(item, column) {
    const row = item && item.sourceRow;
    if (!row) return '—';
    const api = window.BLCpAttentionColumns;
    let value = '';
    try { value = api && typeof api.format === 'function' ? api.format(column.key, row) : row[column.key]; }
    catch (_) { value = row[column.key]; }
    if (value == null || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }

  function attentionCellHtml(item, column) {
    if (column.source === 'cp') {
      const text = attentionCpValue(item, column);
      const numeric = ['int', 'num', 'money', 'moneyEdit', 'pct', 'plm'].includes(column.type);
      return `<td class="${numeric ? 'num ' : ''}cpaAttentionCell" title="${esc(text)}">${esc(text)}</td>`;
    }
    switch (column.id) {
      case 'sys:priority': return `<td><span class="cpaPill tone-${esc(priorityToneOf(item.priority))}">${esc(priorityLabel(item.priority))}</span></td>`;
      case 'sys:order': return `<td class="cpaAttentionCell" title="${esc(item.orderCode || '—')}">${esc(item.orderCode || '—')}</td>`;
      case 'sys:style': return `<td class="cpaAttentionCell" title="${esc([item.modelName, item.colourCode].filter(Boolean).join(' · ') || '—')}">${esc(item.modelName || '—')}${item.colourCode ? `<small>${esc(item.colourCode)}</small>` : ''}</td>`;
      case 'sys:supplier': return `<td class="cpaAttentionCell" title="${esc(item.dims.manufacturer || '—')}">${esc(item.dims.manufacturer || '—')}</td>`;
      case 'sys:age': return `<td class="num">${item.orderAgeDays == null ? '—' : int(item.orderAgeDays)}</td>`;
      case 'sys:toLoad': return `<td class="num">${item.daysToLoad == null ? '—' : int(item.daysToLoad)}</td>`;
      case 'sys:target': return `<td>${esc(dateText(item.targetDate))}</td>`;
      case 'sys:reason': {
        const text = attentionReasonEntries(item).slice(0, 2).map(entry => entry.text).join(', ') || '—';
        return `<td class="cpaAttentionCell cpaAttentionReason" title="${esc(text)}">${esc(text)}</td>`;
      }
      default: return '<td>—</td>';
    }
  }

  let attentionVisual = true;
  function attentionVisualRows(rows) {
    return `<div class="cpaVisualAttention">${rows.slice(0, 3).map(item => {
      const image = typeof tableRowImageSource === 'function' ? tableRowImageSource(item.sourceRow || {}).source : '';
      const reason = attentionReasonEntries(item)[0]?.text || priorityLabel(item.priority);
      const days = item.scheduleBufferDays, known = days !== null && days !== undefined && Number.isFinite(Number(days));
      const tone = priorityToneOf(item.priority) === 'red' ? 'red' : 'blue';
      return `<article class="cpaVisualRow tone-${tone}"><button type="button" class="cpaVisualOpen" data-cpa-open-attention="${esc(item.orderKey)}"><span class="cpaVisualThumb">${image ? `<img src="${esc(image)}" alt="${esc(item.modelName)}" loading="lazy" decoding="async">` : '<svg class="ic" aria-hidden="true"><use href="#i-photo-size"/></svg>'}</span><span class="cpaVisualText"><b>${esc(reason)}</b><small>${esc([item.orderCode, item.modelName].filter(Boolean).join(' · '))}</small><em>${esc(priorityLabel(item.priority))}${item.calculationStatus === 'UNKNOWN' ? ` · ${esc(L('Hesaplanamıyor', 'Uncalculable'))}` : ''}</em></span><span class="cpaVisualBuffer${known && days < 0 ? ' isLate' : ''}"><b>${known ? `${days > 0 ? '+' : ''}${int(days)}` : '—'}</b><small>${esc(L('gün tampon', 'days buffer'))}</small></span></button><button type="button" class="cpaIconBtn cpaVisualExclude" data-cpa-attention-exclude="${esc(item.orderKey)}" aria-label="${esc(L('Hariç tutma seçenekleri', 'Exclusion options'))}">⋮</button></article>`;
    }).join('')}</div>`;
  }
  function attentionCard() {
    const rowState = attentionRowsState();
    const all = rowState.visible;
    const shown = all.slice(0, state.attentionLimit);
    const columns = attentionVisibleColumns();
    const head = columns.map(column => `<th class="${column.type === 'number' ? 'num' : ''}" title="${esc(column.source === 'cp' && column.group ? `${column.label} · ${column.group}` : column.label)}">${esc(column.label)}</th>`).join('');
    const body = shown.map(item => `<tr data-cpa-order="${esc(item.orderCode)}" data-cpa-order-key="${esc(item.orderKey)}">${columns.map(column => attentionCellHtml(item, column)).join('')}<td class="cpaAttentionActionCell"><button type="button" class="cpaIconBtn cpaAttentionExcludeBtn" data-cpa-attention-exclude="${esc(item.orderKey)}" title="${esc(L("Attention'dan hariç tut", 'Exclude from Attention'))}" aria-label="${esc(L("Attention'dan hariç tut", 'Exclude from Attention'))}">⋮</button></td></tr>`).join('');
    const filterNote = state.activePriority === 'ALL' ? ''
      : `<button type="button" class="cpaBtn sm" data-cpa-priority="ALL">${esc(L('Filtreyi kaldır', 'Clear filter'))}</button>`;
    const currentTarget = state.settings.targetType === 'inStore' ? 'inStore' : 'retail';
    const exclusionCount = attentionActiveExclusions().filter(item => item.targetType === currentTarget).length;
    const excludedNote = rowState.excluded.length
      ? ` · ${int(rowState.excluded.length)} ${esc(L('hariç', 'excluded'))}` : '';
    return card('attention', L('Aksiyon Gerekenler', 'Orders Requiring Attention'), `
      <div class="cpaAttentionMode"><button type="button" class="cpaBtn sm" data-cpa-attention-view aria-pressed="${!attentionVisual}">${esc(attentionVisual ? L('Tablo', 'Table') : L('Görsel özet', 'Visual summary'))}</button><span>${int(all.length)} ${esc(L('satır', 'rows'))}</span></div>
      <div class="cpaRowBetween cpaAttentionToolbar"><span class="cpaNote">${int(all.length)} ${esc(L('görünür sipariş satırı', 'visible order rows'))}${excludedNote}${all.length > shown.length ? ` · ${esc(L('ilk', 'first'))} ${int(shown.length)}` : ''}</span><div class="cpaAttentionActions">${filterNote}<button type="button" class="cpaBtn sm ghost" data-cpa-attention-excluded>${esc(L('Hariç Tutulanlar', 'Excluded'))} (${int(exclusionCount)})</button><button type="button" class="cpaBtn sm" data-cpa-attention-columns>${esc(L('Sütunlar', 'Columns'))}</button></div></div>
      ${shown.length && attentionVisual ? attentionVisualRows(all) : ''}
      ${shown.length ? `<div class="cpaScroll cpaAttentionScroll${attentionVisual ? ' isVisualHidden' : ''}"><table class="cpaTable cpaAttentionTable"><thead><tr>${head}<th class="cpaAttentionActionHead" aria-label="${esc(L('Aksiyon', 'Action'))}"></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="cpaEmpty">${esc(L('Bu filtrede görünür aksiyon gereken sipariş yok.', 'No visible orders need action in this filter.'))}</p>`}
      ${!attentionVisual && all.length > shown.length ? `<button type="button" class="cpaBtn" data-cpa-more>${esc(L('Daha fazla göster', 'Show more'))}</button>` : ''}`);
  }

  function coverageCard() {
    const quality = state.model.dataQuality;
    const coverage = window.BLOverviewPremium?.buildCoverage(state.model.orders);
    const engineWarning = quality.deliveryEngineMissing
      ? `<p class="cpaWarn">${esc(L('Teslimat motoru yüklenemedi; risk ve ETA hesaplanamıyor. Sayfayı yenileyin, sürerse bildirin.', 'The delivery engine could not be loaded; risk and ETA cannot be calculated. Reload the page and report it if it persists.'))}</p>`
      : '';
    const missing = [
      ['exFactory', L('Ex-Factory tarihi', 'Ex-Factory date')],
      ['retail', L('Retail Depo tarihi', 'Retail date')],
      ['inStore', L('In Store tarihi', 'In Store date')],
      ['orderDate', L('Sipariş tarihi', 'Order date')],
      ['transitRule', L('Yol süresi kuralı', 'Transit rule')],
    ].filter(([key]) => quality.missing[key]).map(([key, label]) =>
      `<li><span>${esc(label)}</span><b>${int(quality.missing[key])}</b></li>`).join('');
    const unavailable = quality.unavailableDimensions.map(item =>
      `<li><span>${esc(isEn() ? item.en : item.tr)}</span></li>`).join('');
    return card('coverage', L('Veri Kapsamı', 'Data Coverage'), `
      ${coverage ? `<div class="cpaCoverageVisual"><div><b>${coverage.percent == null ? '—' : coverage.percent + '%'}</b><span>${esc(L('Yükleme + hedef tarihi', 'Loading + target dates'))}</span></div><div><b>${int(coverage.unknown)}</b><span>${esc(L('Hesaplanamıyor', 'Uncalculable'))}</span></div><span class="cpaCoverageTrack"><i style="width:${coverage.percent || 0}%"></i></span></div>` : ''}
      ${engineWarning}
      <details class="cpaCoverageDetails"><summary>${esc(L('Eksik alanlar ve kapsam', 'Missing fields and coverage'))}</summary>
      ${missing ? `<b class="cpaSub">${esc(L('Eksik veri', 'Missing data'))}</b><ul class="cpaMiniList">${missing}</ul>` : ''}
      <b class="cpaSub">${esc(L('Buyer Log\'da bu veri tutulmuyor', 'Not stored in Buyer Log'))}</b>
      <p class="cpaNote">${esc(L('Aşağıdakiler sütun olarak yok; kontrol listesi soruları ve takip e-postaları üzerinden yürütülüyor. Bunlar için otomatik uyarı üretilmez.', 'The items below are not columns; they are handled through checklist questions and follow-up emails. No automatic warning is produced for them.'))}</p>
      <ul class="cpaMiniList is-plain">${unavailable}</ul></details>`);
  }

  function card(key, title, body) {
    const collapsed = key !== 'checklist' && state.hidden[key] === true;
    return `<section class="cpaCard" data-cpa-card="${key}">
      <header><b>${esc(title)}</b><button type="button" class="cpaToggle" data-cpa-collapse="${key}" aria-expanded="${collapsed ? 'false' : 'true'}">${collapsed ? '+' : '−'}</button></header>
      <div class="cpaCardBody" ${collapsed ? 'hidden' : ''}>${body}</div>
    </section>`;
  }

  function render() {
    const container = host();
    const attention = attentionHost();
    const coverage = coverageHost();
    if (!container) return;
    if (!state.model) {
      container.innerHTML = '';
      if (attention) attention.innerHTML = '';
      if (coverage) coverage.innerHTML = '';
      window.BLOverviewPremium?.update?.({ model: null });
      return;
    }
    container.innerHTML = overviewWidgetHtml();
    if (attention) attention.innerHTML = '';
    if (coverage) coverage.innerHTML = coverageCard();
    window.BLOverviewPremium?.update?.({
      model: state.model,
      checklist: state.checklist,
      priorityRules: state.rules.filter(rule => rule.kind === 'priority' && rule.enabled !== false).length,
      priorityCatalog: state.priorityCatalog,
    });
    bind(container);
    if (attention) bind(attention);
    if (coverage) bind(coverage);
  }

  function bind(container) {
    container.querySelector('[data-cpa-attention-view]')?.addEventListener('click', () => { attentionVisual = !attentionVisual; render(); });
    container.querySelectorAll('[data-cpa-open-attention]').forEach(el => el.onclick = () => openAttentionDetail(el.dataset.cpaOpenAttention));
    container.querySelectorAll('[data-cpa-target]').forEach(el => el.onclick = () => {
      state.settings.targetType = el.dataset.cpaTarget === 'inStore' ? 'inStore' : 'retail';
      savePrefs(); recompute(); render();
    });
    container.querySelectorAll('[data-cpa-collapse]').forEach(el => el.onclick = () => {
      const key = el.dataset.cpaCollapse; state.hidden[key] = !state.hidden[key]; savePrefs();
      const open = !state.hidden[key], body = el.closest('[data-cpa-card]')?.querySelector('.cpaCardBody');
      el.setAttribute('aria-expanded', String(open)); el.textContent = open ? '−' : '+';
      if (window.BLMotionPlus?.disclosure) window.BLMotionPlus.disclosure(body, open, { trigger: el });
      else if (body) body.hidden = !open;
    });
    container.querySelectorAll('[data-cpa-priority]').forEach(el => el.onclick = () => {
      const key = el.dataset.cpaPriority;
      state.activePriority = state.activePriority === key ? 'ALL' : key;
      state.attentionLimit = 25; render();
    });
    container.querySelectorAll('[data-cpa-reason]').forEach(el => el.onclick = () => {
      const key = `REASON:${el.dataset.cpaReason}`;
      state.activePriority = state.activePriority === key ? 'ALL' : key;
      state.attentionLimit = 25; render();
    });
    const more = container.querySelector('[data-cpa-more]');
    if (more) more.onclick = () => { state.attentionLimit += 50; render(); };
    container.querySelectorAll('[data-cpa-attention-exclude]').forEach(el => el.onclick = event => {
      event.stopPropagation();
      const orderKey = el.dataset.cpaAttentionExclude;
      const item = state.model && state.model.orders ? state.model.orders.find(row => row.orderKey === orderKey) : null;
      if (item) openAttentionExclusion(item);
    });
    const excludedBtn = container.querySelector('[data-cpa-attention-excluded]');
    if (excludedBtn) excludedBtn.onclick = event => { event.stopPropagation(); openAttentionExcluded(); };
    container.querySelectorAll('[data-cpa-order]').forEach(el => el.onclick = event => {
      if (event.target.closest('button,input,select,textarea,a')) return;
      openAttentionDetail(el.dataset.cpaOrderKey);
    });
    container.querySelectorAll('[data-cpa-open-checklist]').forEach(el => el.onclick = () => openChecklist(el.dataset.cpaOpenChecklist));
    const plmSyncBtn = container.querySelector('[data-cpa-plm-requests-sync]');
    if (plmSyncBtn) plmSyncBtn.onclick = () => syncPlmSampleRequests(plmSyncBtn);
    container.querySelectorAll('[data-cpa-queue]').forEach(el => el.onclick = () => openStudio('queue'));
    container.querySelectorAll('[data-cpa-queue-scope]').forEach(el => el.onclick = () => openStudio('queue', { scope: el.dataset.cpaQueueScope, itemId: 'ALL', supplier: 'ALL', search: '' }));
    container.querySelectorAll('[data-cpa-summary-attention]').forEach(el => el.onclick = () => openOverviewRows(Engine.needsAttention(state.model, { limit: 5000, priorityCatalog: state.priorityCatalog }).map(item => item.sourceRow).filter(Boolean), L('Aksiyon gereken siparişler', 'Orders needing action')));
    container.querySelectorAll('[data-cpa-settings]').forEach(el => el.onclick = openSettings);
    container.querySelectorAll('[data-cpa-rules]').forEach(el => el.onclick = openRules);
    const attentionColumnsBtn = container.querySelector('[data-cpa-attention-columns]');
    if (attentionColumnsBtn) attentionColumnsBtn.onclick = openAttentionColumns;
    container.querySelectorAll('[data-cpa-automate-priority]').forEach(el => el.onclick = () => automateFromPriority(el.dataset.cpaAutomatePriority));
    container.querySelectorAll('[data-cpa-automate-reason]').forEach(el => el.onclick = event => { event.preventDefault(); event.stopPropagation(); automateFromReason(el.dataset.cpaAutomateReason); });
  }

  /* ------------------------------------------------ Attention hariç tutma */
  function attentionCurrentUser() {
    const profile = window.BL_USER_CONTEXT || {};
    return String(profile.displayName || profile.name || profile.id || '').trim();
  }
  function attentionExclusionId() {
    try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID(); }
    catch (_) { /* deterministic fallback below */ }
    return `attn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
  function attentionDateStartIso(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
    const date = new Date(`${text}T00:00:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  function attentionTomorrowDateText() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function attentionExclusionExpiry(mode, item, specificDate) {
    if (mode === 'permanent') return null;
    if (mode === 'tomorrow') return attentionDateStartIso(attentionTomorrowDateText());
    if (mode === 'sevenDays') return new Date(Date.now() + 7 * 86400000).toISOString();
    if (mode === 'target') {
      const target = dateText(item && item.targetDate);
      if (!target || target === '—') return undefined;
      const expiry = attentionDateStartIso(target);
      return expiry && Date.parse(expiry) > Date.now() ? expiry : undefined;
    }
    if (mode === 'specific') {
      const expiry = attentionDateStartIso(specificDate);
      return expiry && Date.parse(expiry) > Date.now() ? expiry : undefined;
    }
    return undefined;
  }
  function attentionExclusionUntilText(exclusion) {
    if (!exclusion || exclusion.expiresAt == null) return L('Kalıcı', 'Permanent');
    const date = new Date(exclusion.expiresAt);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale()) : '—';
  }

  function openAttentionExclusion(item) {
    if (!item) return;
    document.querySelector('.cpaAttentionExcludeOverlay')?.remove();
    const warnings = attentionWarningKeys(item);
    if (!warnings.length) return;
    const targetType = state.settings.targetType === 'inStore' ? 'inStore' : 'retail';
    const targetLabel = targetType === 'inStore' ? 'In Store' : L('Retail Depo', 'Retail');
    const targetExpiry = attentionExclusionExpiry('target', item);
    const tomorrow = attentionTomorrowDateText();
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaAttentionExcludeOverlay'; modal.dataset.uiMigrated = 'cp-assistant';
    modal.innerHTML = `<div class="cpaModal cpaAttentionExcludeModal" role="dialog" aria-modal="true" aria-labelledby="cpaAttentionExcludeTitle">
      <header><div><b id="cpaAttentionExcludeTitle">${esc(L("Attention'dan Hariç Tut", 'Exclude from Attention'))}</b>
        <small>${esc(L('Gerçek risk ve öncelik değişmez; yalnız bu liste görünürlüğü etkilenir.', 'Risk and priority stay unchanged; only this list visibility is affected.'))}</small></div>
        <button type="button" data-cpa-exclude-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody cpaAttentionExcludeBody">
        <div class="cpaExcludeOrderFacts">
          <div><span>${esc(L('Sipariş', 'Order'))}</span><b>${esc(item.orderCode || '—')}</b></div>
          <div><span>${esc(L('Model', 'Style'))}</span><b>${esc([item.modelName, item.colourCode].filter(Boolean).join(' · ') || '—')}</b></div>
          <div><span>${esc(L('Öncelik', 'Priority'))}</span><b>${esc(priorityLabel(item.priority))}</b></div>
          <div><span>${esc(L('Hedef', 'Target'))}</span><b>${esc(targetLabel)}</b></div>
        </div>
        <fieldset class="cpaExcludeGroup">
          <legend>${esc(L('Kapsam', 'Scope'))}</legend>
          <label class="cpaExcludeChoice"><input type="radio" name="cpaExcludeScope" value="reason" checked><span><b>${esc(L('Yalnız bu uyarı', 'This warning only'))}</b><small>${esc(L('Yeni veya farklı bir uyarı oluşursa sipariş yeniden görünür.', 'The order appears again if a new or different warning occurs.'))}</small></span></label>
          <label class="cpaExcludeChoice"><input type="radio" name="cpaExcludeScope" value="order"><span><b>${esc(L("Bu siparişi Attention'dan hariç tut", 'This order from Attention'))}</b><small>${esc(L('Seçilen süre boyunca bu siparişin tüm Attention uyarılarını gizler.', 'Hides all Attention warnings for this order for the selected duration.'))}</small></span></label>
        </fieldset>
        <label class="cpaExcludeField" data-cpa-exclude-warning-wrap><span>${esc(L('Uyarı', 'Warning'))}</span>
          <select data-cpa-exclude-warning>${warnings.map(code => `<option value="${esc(code)}">${esc(attentionWarningLabel(code))}</option>`).join('')}</select>
        </label>
        <p class="cpaWarn cpaExcludeOrderWarning" data-cpa-exclude-order-warning hidden>${esc(L("Bu seçenek, seçilen süre boyunca siparişin tüm mevcut ve yeni Attention uyarılarını gizler.", 'This option hides all current and new Attention warnings for the order during the selected duration.'))}</p>
        <fieldset class="cpaExcludeGroup">
          <legend>${esc(L('Süre', 'Duration'))}</legend>
          <div class="cpaExcludeDurationGrid">
            <label class="cpaExcludeChoice compact"><input type="radio" name="cpaExcludeDuration" value="tomorrow"><span><b>${esc(L('Yarına kadar', 'Until tomorrow'))}</b></span></label>
            <label class="cpaExcludeChoice compact"><input type="radio" name="cpaExcludeDuration" value="sevenDays" checked><span><b>${esc(L('7 gün', '7 days'))}</b></span></label>
            <label class="cpaExcludeChoice compact${targetExpiry ? '' : ' is-disabled'}"><input type="radio" name="cpaExcludeDuration" value="target"${targetExpiry ? '' : ' disabled'}><span><b>${esc(L('Hedef tarihe kadar', 'Until target date'))}</b><small>${esc(targetExpiry ? dateText(item.targetDate) : L('Gelecekte hedef tarih yok', 'No future target date'))}</small></span></label>
            <label class="cpaExcludeChoice compact"><input type="radio" name="cpaExcludeDuration" value="specific"><span><b>${esc(L('Belirli tarihe kadar', 'Until a specific date'))}</b></span></label>
            <label class="cpaExcludeChoice compact"><input type="radio" name="cpaExcludeDuration" value="permanent"><span><b>${esc(L('Kalıcı', 'Permanent'))}</b><small>${esc(L('Varsayılan değildir', 'Not the default'))}</small></span></label>
          </div>
          <label class="cpaExcludeSpecific" data-cpa-exclude-specific-wrap hidden><span>${esc(L('Bitiş tarihi', 'End date'))}</span><input type="date" min="${esc(tomorrow)}" value="${esc(tomorrow)}" data-cpa-exclude-specific></label>
        </fieldset>
        <label class="cpaExcludeField"><span>${esc(L('Not', 'Note'))} <small>${esc(L('(opsiyonel)', '(optional)'))}</small></span>
          <textarea rows="3" data-cpa-exclude-note placeholder="${esc(L('Bu uyarı neden hariç tutuluyor?', 'Why is this warning being excluded?'))}"></textarea>
        </label>
        <p class="cpaColumnsStatus" data-cpa-exclude-status></p>
      </div>
      <footer><button type="button" class="cpaBtn ghost" data-cpa-exclude-close>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="cpaBtn cpaExcludeApply" data-cpa-exclude-apply>${esc(L("Attention'dan Hariç Tut", 'Exclude from Attention'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);
    const warningWrap = modal.querySelector('[data-cpa-exclude-warning-wrap]');
    const warningSelect = modal.querySelector('[data-cpa-exclude-warning]');
    const orderWarning = modal.querySelector('[data-cpa-exclude-order-warning]');
    const specificWrap = modal.querySelector('[data-cpa-exclude-specific-wrap]');
    const specificInput = modal.querySelector('[data-cpa-exclude-specific]');
    const status = modal.querySelector('[data-cpa-exclude-status]');
    function syncScope() {
      const scope = modal.querySelector('input[name="cpaExcludeScope"]:checked')?.value || 'reason';
      const orderScope = scope === 'order';
      warningWrap.hidden = orderScope;
      warningSelect.disabled = orderScope;
      orderWarning.hidden = !orderScope;
    }
    function syncDuration() {
      const mode = modal.querySelector('input[name="cpaExcludeDuration"]:checked')?.value || 'sevenDays';
      const specific = mode === 'specific';
      specificWrap.hidden = !specific;
      specificInput.disabled = !specific;
    }
    modal.querySelectorAll('input[name="cpaExcludeScope"]').forEach(input => input.onchange = syncScope);
    modal.querySelectorAll('input[name="cpaExcludeDuration"]').forEach(input => input.onchange = syncDuration);
    syncScope(); syncDuration();
    const close = () => modal.remove();
    modal.querySelectorAll('[data-cpa-exclude-close]').forEach(button => button.onclick = close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    modal.querySelector('[data-cpa-exclude-apply]').onclick = () => {
      const scope = modal.querySelector('input[name="cpaExcludeScope"]:checked')?.value === 'order'
        ? ATTENTION_EXCLUSION_SCOPE.ORDER : ATTENTION_EXCLUSION_SCOPE.REASON;
      const reasonCode = scope === ATTENTION_EXCLUSION_SCOPE.REASON ? String(warningSelect.value || '') : '';
      const duration = modal.querySelector('input[name="cpaExcludeDuration"]:checked')?.value || 'sevenDays';
      const expiresAt = attentionExclusionExpiry(duration, item, specificInput.value);
      if (expiresAt === undefined) {
        status.textContent = L('Geçerli bir gelecek bitiş tarihi seçin.', 'Choose a valid future end date.');
        return;
      }
      if (scope === ATTENTION_EXCLUSION_SCOPE.REASON && !reasonCode) {
        status.textContent = L('Hariç tutulacak uyarıyı seçin.', 'Choose the warning to exclude.');
        return;
      }
      const normalized = normalizeAttentionExclusions(state.attentionExclusions);
      state.attentionExclusions = normalized.filter(existing =>
        !(existing.orderKey === item.orderKey
          && existing.targetType === targetType
          && existing.scope === scope
          && (scope === ATTENTION_EXCLUSION_SCOPE.ORDER || existing.reasonCode === reasonCode)));
      state.attentionExclusions.push({
        id: attentionExclusionId(),
        orderKey: item.orderKey,
        orderCode: String(item.orderCode || ''),
        modelName: String(item.modelName || ''),
        colourCode: String(item.colourCode || ''),
        targetType,
        scope,
        reasonCode,
        createdAt: new Date().toISOString(),
        expiresAt,
        createdBy: attentionCurrentUser(),
        note: String(modal.querySelector('[data-cpa-exclude-note]')?.value || '').trim(),
      });
      savePrefs(); close(); render();
    };
    modal.querySelector('[data-cpa-exclude-close]')?.focus();
  }

  function openAttentionExcluded() {
    document.querySelector('.cpaAttentionExcludedOverlay')?.remove();
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaAttentionExcludedOverlay'; modal.dataset.uiMigrated = 'cp-assistant';
    modal.innerHTML = `<div class="cpaModal cpaAttentionExcludedModal" role="dialog" aria-modal="true" aria-labelledby="cpaAttentionExcludedTitle">
      <header><div><b id="cpaAttentionExcludedTitle">${esc(L("Attention'dan Hariç Tutulanlar", 'Excluded from Attention'))}</b>
        <small>${esc(L('Yalnız aktif kullanıcı hariç tutmaları gösterilir. Risk ve öncelik kayıtları değişmez.', 'Only active user exclusions are shown. Risk and priority records stay unchanged.'))}</small></div>
        <button type="button" data-cpa-excluded-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody cpaAttentionExcludedBody"><div data-cpa-excluded-list></div></div>
      <footer><button type="button" class="cpaBtn" data-cpa-excluded-close>${esc(L('Kapat', 'Close'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector('[data-cpa-excluded-list]');
    function draw() {
      const rows = attentionActiveExclusions().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!rows.length) {
        list.innerHTML = `<p class="cpaEmpty">${esc(L('Aktif hariç tutma yok.', 'No active exclusions.'))}</p>`;
        return;
      }
      list.innerHTML = `<div class="cpaScroll cpaExcludedScroll"><table class="cpaTable cpaExcludedTable"><thead><tr>
        <th>${esc(L('Sipariş', 'Order'))}</th><th>${esc(L('Hedef', 'Target'))}</th><th>${esc(L('Kapsam', 'Scope'))}</th>
        <th>${esc(L('Uyarı', 'Warning'))}</th><th>${esc(L('Bitiş', 'Until'))}</th><th>${esc(L('Not', 'Note'))}</th><th></th>
      </tr></thead><tbody>${rows.map(exclusion => `<tr>
        <td><b>${esc(exclusion.orderCode || '—')}</b><small>${esc([exclusion.modelName, exclusion.colourCode].filter(Boolean).join(' · '))}</small></td>
        <td>${esc(exclusion.targetType === 'inStore' ? 'In Store' : L('Retail Depo', 'Retail'))}</td>
        <td><span class="cpaPill">${esc(exclusion.scope === ATTENTION_EXCLUSION_SCOPE.ORDER ? L('Sipariş', 'Order') : L('Uyarı', 'Warning'))}</span></td>
        <td>${esc(exclusion.scope === ATTENTION_EXCLUSION_SCOPE.ORDER ? L('Tüm uyarılar', 'All warnings') : attentionWarningLabel(exclusion.reasonCode))}</td>
        <td>${esc(attentionExclusionUntilText(exclusion))}${exclusion.createdBy ? `<small>${esc(L('Hariç tutan', 'Excluded by'))}: ${esc(exclusion.createdBy)}</small>` : ''}</td>
        <td class="cpaAttentionCell" title="${esc(exclusion.note || '')}">${esc(exclusion.note || '—')}</td>
        <td class="act"><button type="button" class="cpaBtn sm" data-cpa-exclusion-restore="${esc(exclusion.id)}">${esc(L('Geri Al', 'Restore'))}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
      list.querySelectorAll('[data-cpa-exclusion-restore]').forEach(button => button.onclick = () => {
        const id = button.dataset.cpaExclusionRestore;
        state.attentionExclusions = normalizeAttentionExclusions(state.attentionExclusions).filter(item => item.id !== id);
        savePrefs(); render(); draw();
      });
    }
    const close = () => modal.remove();
    modal.querySelectorAll('[data-cpa-excluded-close]').forEach(button => button.onclick = close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    draw();
    modal.querySelector('[data-cpa-excluded-close]')?.focus();
  }

  function openOverviewRows(rows, title, options = {}) {
    if (!window.BLDetailDrawer?.open) return;
    const columns = attentionCpColumns().map(column => ({ key: column.key, label: column.label || column.key }));
    window.BLDetailDrawer.open({ storageKey: 'cp.overview.summary', source: 'cp', title, rows, columns, images: true, fileName: 'Overview_CP', ...(options.notes === true ? { storageKey: 'cp.overview.notes', note: options.note || '', rowActions: [{ label: L('Notu sil', 'Delete note'), disabled: row => row._canEdit === false, run: options.deleteNote }] } : {}) });
  }
  function selectPriority(key) { state.activePriority = key; state.attentionLimit = 25; render(); }
  function openAttentionDetail(orderKey) {
    const item = state.model && state.model.orders ? state.model.orders.find(row => row.orderKey === orderKey) : null;
    if (!item || !item.sourceRow || !window.BLDetailDrawer?.open) {
      if (item && item.orderCode) openInCp(item.orderCode);
      return;
    }
    const columns = attentionCpColumns().map(column => ({ key: column.key, label: column.label || column.key }));
    window.BLDetailDrawer.open({
      storageKey: 'cp.attention.detail', source: 'cp',
      title: `CP · ${item.orderCode || L('Sipariş Detayı', 'Order Detail')}`,
      subtitle: [item.modelName, item.colourCode, item.dims && item.dims.manufacturer].filter(Boolean).join(' · '),
      rows: [item.sourceRow], columns, images: true, fileName: `CP_${item.orderCode || 'Detail'}`,
      actions: [{ label: L('CP’de Aç', 'Open in CP'), run: () => openInCp(item.orderCode) }],
    });
  }

  function openInCp(orderCode) {
    if (!orderCode) return;
    try {
      if (typeof clearCpQuickFilters === 'function') clearCpQuickFilters();
      const input = document.getElementById('cpSearch');
      if (input) { input.value = orderCode; input.dispatchEvent(new Event('input', { bubbles: true })); }
      if (typeof switchTab === 'function') switchTab('cp');
      if (typeof renderCP === 'function') renderCP();
    } catch (_) { /* gezinme başarısızsa ekran bozulmasın */ }
  }

  function openAttentionColumns() {
    document.querySelector('.cpaAttentionColumnsOverlay')?.remove();
    const catalog = attentionColumnCatalog();
    const byId = new Map(catalog.map(col => [col.id, col]));
    let selectedOrder = normalizeAttentionColumns(state.attentionColumns).filter(id => byId.has(id));
    if (!selectedOrder.length) selectedOrder = ATTENTION_DEFAULT_COLUMNS.filter(id => byId.has(id));
    let selected = new Set(selectedOrder);
    let dragId = '';
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaAttentionColumnsOverlay'; modal.dataset.uiMigrated = 'cp-assistant';
    modal.innerHTML = `<div class="cpaModal cpaColumnsModal" role="dialog" aria-modal="true" aria-labelledby="cpaColumnsTitle">
      <header><div><b id="cpaColumnsTitle">${esc(L('Attention Sütunlarını Özelleştir', 'Customize Attention Columns'))}</b>
        <small>${esc(L('CP tablosundaki alanları ekleyin, kaldırın ve görünüm sırasını değiştirin.', 'Add or remove CP table fields and change their display order.'))}</small></div>
        <button type="button" data-cpa-columns-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody cpaColumnsBody">
        <div class="cpaColumnsTopbar">
          <label class="cpaColumnSearch"><span>${esc(L('Sütun ara', 'Search columns'))}</span><input type="search" data-cpa-column-search placeholder="${esc(L('Başlık veya alan adı…', 'Header or field name…'))}" autocomplete="off"></label>
          <div class="cpaColumnsQuick">
            <button type="button" class="cpaBtn sm" data-cpa-columns-select-all>${esc(L('Tümünü seç', 'Select all'))}</button>
            <button type="button" class="cpaBtn sm" data-cpa-columns-clear-optional>${esc(L('Opsiyonelleri temizle', 'Clear optional'))}</button>
            <button type="button" class="cpaBtn sm ghost" data-cpa-columns-reset>${esc(L('Varsayılana dön', 'Reset to default'))}</button>
          </div>
        </div>
        <div class="cpaColumnsGrid">
          <section class="cpaColumnPane"><div class="cpaColumnPaneHead"><b>${esc(L('Kullanılabilir Sütunlar', 'Available Columns'))}</b><span data-cpa-available-count></span></div><div class="cpaColumnOptions" data-cpa-column-options></div></section>
          <section class="cpaColumnPane"><div class="cpaColumnPaneHead"><b>${esc(L('Seçili Sütunlar', 'Selected Columns'))}</b><span data-cpa-selected-count></span></div><p class="cpaNote">${esc(L('Sürükleyerek tablo sırasını değiştirin.', 'Drag to change the table order.'))}</p><div class="cpaSelectedColumns" data-cpa-selected-columns></div></section>
        </div>
      </div>
      <footer><span class="cpaColumnsStatus" data-cpa-columns-status></span><button type="button" class="cpaBtn ghost" data-cpa-columns-close>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="cpaBtn cpaColumnsApply" data-cpa-columns-apply>${esc(L('Uygula', 'Apply'))}</button></footer>
    </div>`;
    const optionsHost = modal.querySelector('[data-cpa-column-options]');
    const selectedHost = modal.querySelector('[data-cpa-selected-columns]');
    const search = modal.querySelector('[data-cpa-column-search]');
    const selectedCount = modal.querySelector('[data-cpa-selected-count]');
    const availableCount = modal.querySelector('[data-cpa-available-count]');
    const status = modal.querySelector('[data-cpa-columns-status]');
    const sourceLabel = column => column.source === 'system' ? L('Sistem', 'System') : 'CP';
    const searchable = column => `${column.label} ${column.key || ''} ${column.group || ''}`.toLocaleLowerCase(isEn() ? 'en-GB' : 'tr-TR');
    function drawOptions() {
      const q = String(search.value || '').trim().toLocaleLowerCase(isEn() ? 'en-GB' : 'tr-TR');
      const filtered = catalog.filter(column => !q || searchable(column).includes(q));
      const renderGroup = (columns, title) => columns.length ? `<div class="cpaColumnGroup"><b>${esc(title)}</b>${columns.map(column => `<label class="cpaColumnOption"><input type="checkbox" data-cpa-column-id="${esc(column.id)}" ${selected.has(column.id) ? 'checked' : ''}><span><strong>${esc(column.label)}</strong><small>${esc(column.source === 'cp' && column.group ? `${sourceLabel(column)} · ${column.group}` : sourceLabel(column))}</small></span></label>`).join('')}</div>` : '';
      const system = filtered.filter(column => column.source === 'system');
      const cp = filtered.filter(column => column.source === 'cp');
      optionsHost.innerHTML = renderGroup(system, L('Sistem Sütunları', 'System Columns')) + renderGroup(cp, L('CP Sütunları', 'CP Columns')) || `<p class="cpaEmpty">${esc(L('Eşleşen sütun bulunamadı.', 'No matching columns.'))}</p>`;
      availableCount.textContent = `${filtered.length}/${catalog.length}`;
    }
    function drawSelected() {
      selectedOrder = selectedOrder.filter(id => selected.has(id) && byId.has(id));
      selectedHost.innerHTML = selectedOrder.length ? selectedOrder.map(id => {
        const column = byId.get(id);
        return `<div class="cpaSelectedColumn" draggable="true" data-cpa-selected-id="${esc(id)}"><span class="cpaColumnDrag" aria-hidden="true">≡</span><span class="cpaSelectedColumnText"><strong>${esc(column.label)}</strong><small>${esc(column.source === 'cp' && column.group ? `${sourceLabel(column)} · ${column.group}` : sourceLabel(column))}</small></span><button type="button" class="cpaIconBtn" data-cpa-selected-remove="${esc(id)}" aria-label="${esc(L('Sütunu kaldır', 'Remove column'))}">×</button></div>`;
      }).join('') : `<p class="cpaEmpty">${esc(L('En az bir sütun seçin.', 'Select at least one column.'))}</p>`;
      selectedCount.textContent = String(selectedOrder.length);
    }
    function draw() { drawOptions(); drawSelected(); }
    function setSelected(id, checked) {
      if (!byId.has(id)) return;
      if (checked) { if (!selected.has(id)) selectedOrder.push(id); selected.add(id); }
      else { selected.delete(id); selectedOrder = selectedOrder.filter(key => key !== id); }
      status.textContent = ''; draw();
    }
    optionsHost.addEventListener('change', event => { const input = event.target.closest('input[data-cpa-column-id]'); if (input) setSelected(input.dataset.cpaColumnId, input.checked); });
    search.addEventListener('input', drawOptions);
    selectedHost.addEventListener('click', event => { const button = event.target.closest('[data-cpa-selected-remove]'); if (button) setSelected(button.dataset.cpaSelectedRemove, false); });
    selectedHost.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-cpa-selected-id]'); if (!row) return;
      dragId = row.dataset.cpaSelectedId; row.classList.add('is-dragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragId); }
    });
    selectedHost.addEventListener('dragover', event => {
      if (!dragId) return;
      const row = event.target.closest('[data-cpa-selected-id]');
      if (!row || row.dataset.cpaSelectedId === dragId) return;
      event.preventDefault();
      selectedHost.querySelectorAll('.is-drop-before,.is-drop-after').forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY < rect.top + rect.height / 2 ? 'is-drop-before' : 'is-drop-after');
    });
    selectedHost.addEventListener('drop', event => {
      const target = event.target.closest('[data-cpa-selected-id]');
      if (!dragId || !target || target.dataset.cpaSelectedId === dragId) return;
      event.preventDefault();
      const targetId = target.dataset.cpaSelectedId;
      const before = target.classList.contains('is-drop-before');
      selectedOrder = selectedOrder.filter(id => id !== dragId);
      let index = selectedOrder.indexOf(targetId);
      if (!before) index += 1;
      selectedOrder.splice(Math.max(0, index), 0, dragId);
      dragId = ''; drawSelected();
    });
    selectedHost.addEventListener('dragend', () => {
      dragId = '';
      selectedHost.querySelectorAll('.is-dragging,.is-drop-before,.is-drop-after').forEach(el => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
    });
    modal.querySelector('[data-cpa-columns-select-all]').onclick = () => { selected = new Set(catalog.map(c => c.id)); selectedOrder = catalog.map(c => c.id); status.textContent = ''; draw(); };
    modal.querySelector('[data-cpa-columns-clear-optional]').onclick = () => { selectedOrder = attentionSystemColumns().map(c => c.id).filter(id => byId.has(id)); selected = new Set(selectedOrder); status.textContent = ''; draw(); };
    modal.querySelector('[data-cpa-columns-reset]').onclick = () => { selectedOrder = ATTENTION_DEFAULT_COLUMNS.filter(id => byId.has(id)); selected = new Set(selectedOrder); status.textContent = ''; draw(); };
    modal.querySelector('[data-cpa-columns-apply]').onclick = () => {
      if (!selectedOrder.length) { status.textContent = L('En az bir sütun seçin.', 'Select at least one column.'); return; }
      state.attentionColumns = selectedOrder.slice(); savePrefs(); modal.remove(); render();
    };
    const close = () => modal.remove();
    modal.querySelectorAll('[data-cpa-columns-close]').forEach(button => button.onclick = close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.appendChild(modal); draw();
    setTimeout(() => search.focus(), 0);
  }

  /* --------------------------------------------------- PLM numune + otomasyon */
  function plmCell(analysis, itemId) {
    const api = sampleRequests();
    if (!api) return '';
    const plmId = api.plmIdOfRow(analysis.sourceRow, 'cp');
    if (!plmId) return '';
    const badge = api.evidenceBadge(api.evidenceForAnalysis(analysis, itemId));
    return `<button type="button" class="cpaBtn sm ghost" data-cpa-plm-open="${esc(plmId)}" data-cpa-plm-title="${esc(analysis.modelName)}" title="${esc(L('PLM numune taleplerini göster', 'Show PLM sample requests'))}">${badge || esc(L('Talep yok', 'No request'))}</button>`;
  }

  const PLM_SAMPLE_ITEMS = ['pps', 'soff', 'criticalSample', 'artwork'];
  async function syncPlmSampleRequests(button) {
    const api = sampleRequests();
    if (!api || !state.checklist) return;
    const ids = new Set();
    for (const bucket of state.checklist.items) {
      if (!PLM_SAMPLE_ITEMS.includes(bucket.id)) continue;
      for (const analysis of (bucket.allOrders || bucket.orders)) {
        const plmId = api.plmIdOfRow(analysis.sourceRow, 'cp');
        if (plmId) ids.add(plmId);
      }
    }
    if (!ids.size) {
      if (typeof showToast === 'function') showToast(L('PLM numune sorusu açık, PLM ID\'si olan sipariş yok.', 'No orders with a PLM ID have open sample questions.'), { icon: false });
      return;
    }
    const old = button.textContent;
    button.disabled = true;
    button.textContent = L(`${ids.size} model PLM'den alınıyor…`, `Fetching ${ids.size} styles from PLM…`);
    try {
      const result = await api.sync([...ids], { scope: 'cp' });
      if (result.ok && typeof showToast === 'function') showToast(api.summaryText(result), { icon: false, duration: 9000 });
    } catch (err) {
      if (typeof showToast === 'function') showToast(L('PLM numune talepleri alınamadı: ', 'PLM sample requests could not be retrieved: ') + (typeof plmSyncErrorMessage === 'function' ? plmSyncErrorMessage(err) : String(err && err.message || err)), { icon: false, duration: 12000 });
    } finally {
      if (button.isConnected) { button.disabled = false; button.textContent = old; }
    }
  }

  const AUTOMATION_FIELDS = Object.freeze({
    priority: 'Aksiyon Önceliği Kodu',
    calculationStatus: 'Hesaplama Durumu Kodu',
    riskReasons: 'Risk Sebepleri',
    daysToLoad: 'Yüklemeye Kalan Gün',
  });

  async function openAutomation(spec) {
    try {
      await (window.BLPerf && window.BLPerf.ensureFeature ? window.BLPerf.ensureFeature('automations') : Promise.resolve());
      if (!window.BLAutomations || typeof window.BLAutomations.createFromAnalysis !== 'function') {
        throw new Error(L('Otomasyon modülü yüklenemedi.', 'The automation module could not be loaded.'));
      }
      await window.BLAutomations.createFromAnalysis(spec);
    } catch (error) {
      const message = (error && error.message) || L('Otomasyon oluşturulamadı.', 'Could not create the automation.');
      if (typeof showToast === 'function') showToast(message); else alert(message);
    }
  }

  function automateFromPriority(priority) {
    if (!priority || priority === 'ALL') return;
    openAutomation({
      source: 'cp',
      name: `CP · ${priorityLabel(priority)}`,
      description: L(`CP Overview'daki "${priorityLabel(priority)}" kırılımından oluşturuldu.`,
        `Created from the "${priorityLabel(priority)}" breakdown on the CP Overview.`),
      filters: [priority === 'UNKNOWN'
        ? { field: AUTOMATION_FIELDS.calculationStatus, operator: 'eq', value: 'UNKNOWN' }
        : { field: AUTOMATION_FIELDS.priority, operator: 'eq', value: priority }],
      recipientField: 'Manufacturer',
      subject: `${priorityLabel(priority)}`,
      reportFields: ['Order Code', 'Model Name', 'Ex-factory', 'Order Quantity', AUTOMATION_FIELDS.daysToLoad, AUTOMATION_FIELDS.riskReasons],
      backlog: { targetType: state.settings.targetType },
    });
  }

  function automateFromReason(reason) {
    if (!reason) return;
    const label = attentionWarningLabel(reason);
    const rule = reason.startsWith('CUSTOM_RULE:') ? state.rules.find(item => item && item.id === reason.slice('CUSTOM_RULE:'.length)) : null;
    const value = rule ? (String(rule.reasonTr || '').trim() || String(rule.name || '').trim() || label) : (Engine.RISK_REASON_LABELS.tr[reason] || reason);
    openAutomation({
      source: 'cp',
      name: `CP · ${label}`,
      description: L(`CP Overview'daki "${label}" sebebinden oluşturuldu.`,
        `Created from the "${label}" reason on the CP Overview.`),
      filters: [{ field: AUTOMATION_FIELDS.riskReasons, operator: 'contains', value }],
      recipientField: 'Manufacturer',
      subject: label,
      reportFields: ['Order Code', 'Model Name', 'Ex-factory', 'Order Quantity', AUTOMATION_FIELDS.daysToLoad, AUTOMATION_FIELDS.riskReasons],
      backlog: { targetType: state.settings.targetType },
    });
  }

  /* -------------------------------------------- alan kataloğu ve kural satırı */
  function liveRuleColumnCatalog() {
    try {
      const api = window.BLCpAttentionColumns;
      const list = api && typeof api.catalog === 'function' ? api.catalog() : [];
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }

  function fieldDisplayLabel(item) {
    if (!item) return '';
    const direct = String((isEn() ? item.en : item.tr) || item.label || item.displayName || item.id || '').trim();
    if (direct) return direct;
    return String(item.id || '').replace(/^__f_/, '').replace(/[_-]+/g, ' ').trim() || L('Adsız alan', 'Unnamed field');
  }

  function checklistRuleItems() {
    return state.rules.filter(rule => rule.kind === 'checklist').map(rule => ({
      id: rule.id, name: rule.name, tr: rule.tr || rule.name, en: rule.en || rule.name, enabled: rule.enabled,
    }));
  }
  function priorityRuleItems() { return state.rules.filter(rule => rule.kind === 'priority'); }

  function refreshFieldCatalog() {
    state.fieldCatalog = Rules.fieldCatalog(Array.isArray(lastRows) ? lastRows : [], {
      formulaColumns: (window.BLFormulaColumns && window.BLFormulaColumns.definitions) ? window.BLFormulaColumns.definitions('cp') : [],
      checklistItems: checklistRuleItems(),
      priorityRules: priorityRuleItems(),
      columnCatalog: liveRuleColumnCatalog(),
    });
    return state.fieldCatalog;
  }

  function catalogFor(rule) {
    const catalog = state.fieldCatalog || refreshFieldCatalog();
    const self = rule ? Rules.referenceFieldOf(rule) : '';
    return {
      derived: catalog.derived || [],
      checklist: (catalog.checklist || []).filter(item => item.id !== self),
      rules: (catalog.rules || []).filter(item => item.id !== self),
      columns: catalog.columns || [],
    };
  }

  function ruleFieldItems(rule) {
    const catalog = catalogFor(rule);
    return [...catalog.derived, ...catalog.checklist, ...catalog.rules, ...catalog.columns];
  }

  function fieldMeta(fieldId, rule) {
    return ruleFieldItems(rule).find(entry => entry.id === fieldId) || null;
  }

  function fieldLabel(fieldId, rule) {
    const item = fieldMeta(fieldId, rule);
    if (item) return fieldDisplayLabel(item);
    if (!fieldId) return L('Alan seçin', 'Select a field');
    if (String(fieldId).indexOf(Rules.CHECKLIST_PREFIX) === 0 || String(fieldId).indexOf(Rules.RULE_PREFIX) === 0) {
      return L('⚠ Silinmiş başlık', '⚠ Deleted item');
    }
    return fieldId;
  }

  function formulaFieldIds(rule) {
    return ruleFieldItems(rule).map(item => String(item && item.id || '').trim()).filter(Boolean);
  }

  function formulaFieldCatalog(rule) {
    return ruleFieldItems(rule).slice(0, 120).map(item => {
      const id = String(item && item.id || '').trim().slice(0, 160);
      const rawType = String(item && (item.type || item.fieldType || '') || '').trim().toLowerCase();
      const type = ['text', 'number', 'date', 'boolean'].includes(rawType) ? rawType : item.numeric ? 'number' : 'value';
      return { id, label: String(fieldDisplayLabel(item) || id).trim().slice(0, 160) || id, type };
    }).filter(item => item.id);
  }

  function operatorLabel(operatorId) {
    const item = Rules.OPERATORS.find(entry => entry.id === operatorId);
    return item ? (isEn() ? item.en : item.tr) : operatorId;
  }

  function fieldKind(fieldId, rule) {
    const meta = fieldMeta(fieldId, rule) || {};
    const id = String(fieldId || '');
    if (id.indexOf(Rules.CHECKLIST_PREFIX) === 0) return 'checklist';
    if (id.indexOf(Rules.RULE_PREFIX) === 0) return 'rule';
    if (Array.isArray(meta.values) && meta.values.length) return 'enum';
    if (meta.numeric) return 'number';
    if (meta.date) return 'date';
    if (meta.source === 'column' || meta.source === 'formula') return 'column';
    return 'text';
  }

  const OPERATORS_BY_KIND = Object.freeze({
    checklist: ['in', 'notIn', 'eq', 'ne'],
    rule: ['eq', 'ne'],
    enum: ['in', 'notIn', 'eq', 'ne'],
    number: ['lte', 'gte', 'lt', 'gt', 'eq', 'ne', 'empty', 'notEmpty'],
    date: ['lte', 'gte', 'lt', 'gt', 'eq', 'ne', 'empty', 'notEmpty'],
    column: ['eq', 'ne', 'in', 'notIn', 'contains', 'lte', 'gte', 'lt', 'gt', 'empty', 'notEmpty'],
    text: ['eq', 'ne', 'in', 'notIn', 'contains', 'empty', 'notEmpty'],
  });

  function enumValuesFor(fieldId, rule) {
    const kind = fieldKind(fieldId, rule);
    if (kind === 'checklist') {
      const labels = Rules.CHECKLIST_STATE_LABELS[lang()];
      return [...Checklist.statusIds(), 'notApplicable'].map(value => ({
        value, label: labels[value] || Checklist.statusLabel(value, lang()) || value,
      }));
    }
    if (kind === 'rule') {
      const labels = Rules.RULE_STATE_LABELS[lang()];
      return Rules.RULE_STATES.map(value => ({ value, label: labels[value] || value }));
    }
    const meta = fieldMeta(fieldId, rule) || {};
    const values = Array.isArray(meta.values) ? meta.values : [];
    if (fieldId === '@basePriority') {
      const ids = (state.priorityCatalog || defaultCatalog()).map(item => item.id);
      return ids.map(value => ({ value, label: priorityLabel(value) }));
    }
    if (fieldId === '@transitRuleMissing') return values.map(value => ({ value, label: value === 'true' ? L('Evet', 'Yes') : L('Hayır', 'No') }));
    const delivery = window.BLBacklogDeliveryEngine;
    const labels = fieldId === '@stage' ? delivery?.STAGE_LABELS : fieldId === '@deliveryOutcome' ? delivery?.OUTCOME_LABELS : null;
    if (labels) return values.map(value => ({ value, label: labels[lang()]?.[value] || value }));
    return values.map(value => ({ value, label: String(value).replace(/_/g, ' ') }));
  }

  const ruleValueCache = new Map();
  let ruleValueCacheRows = null;

  function conditionValueList(value) {
    if (Array.isArray(value)) return value.map(item => String(item == null ? '' : item).trim()).filter(Boolean);
    return String(value == null ? '' : value).split(/[;,]/).map(item => item.trim()).filter(Boolean);
  }

  function rawRuleValue(value) {
    if (value == null) return '';
    if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') return '';
    return String(value).trim();
  }

  function ruleValueOptions(fieldId) {
    const sourceField = fieldId === '@loadingType' ? 'Del. Type' : fieldId;
    if (!sourceField || sourceField.startsWith('@') || !Array.isArray(lastRows)) return [];
    if (ruleValueCacheRows !== lastRows) {
      ruleValueCacheRows = lastRows;
      ruleValueCache.clear();
    }
    if (ruleValueCache.has(sourceField)) return ruleValueCache.get(sourceField);
    const byValue = new Map();
    const api = window.BLCpAttentionColumns;
    for (const row of lastRows) {
      const raw = rawRuleValue(row && row[sourceField]);
      if (!raw) continue;
      const dedupeKey = raw.toLocaleLowerCase('tr-TR');
      if (byValue.has(dedupeKey)) continue;
      let display = raw;
      try {
        const formatted = api && typeof api.format === 'function' ? String(api.format(sourceField, row) || '').trim() : '';
        if (formatted && formatted !== '—') display = formatted;
      } catch (_) { /* ham değer yeterli */ }
      byValue.set(dedupeKey, { raw, display });
      if (byValue.size >= 5000) break;
    }
    const values = [...byValue.values()].sort((a, b) => a.display.localeCompare(b.display, locale(), { numeric: true, sensitivity: 'base' }));
    ruleValueCache.set(sourceField, values);
    return values;
  }

  function valueOptionRows(condition, query) {
    const multi = ['in', 'notIn'].includes(condition.operator);
    const selected = new Set(conditionValueList(condition.value).map(item => item.toLocaleLowerCase('tr-TR')));
    const needle = String(query || '').trim().toLocaleLowerCase(locale());
    const matches = ruleValueOptions(condition.field).filter(item => !needle
      || item.display.toLocaleLowerCase(locale()).includes(needle)
      || item.raw.toLocaleLowerCase(locale()).includes(needle));
    const limited = matches.slice(0, 200);
    const rows = limited.map(item => {
      const checked = selected.has(item.raw.toLocaleLowerCase('tr-TR'));
      if (multi) return `<label class="cpaValueOption${checked ? ' is-selected' : ''}" data-cpa-value-row role="option" aria-selected="${checked ? 'true' : 'false'}" title="${esc(item.display)}"><input type="checkbox" data-cpa-value-option value="${esc(item.raw)}" ${checked ? 'checked' : ''}><span>${esc(item.display)}</span></label>`;
      return `<button type="button" class="cpaValueOption${checked ? ' is-selected' : ''}" data-cpa-value-option="${esc(item.raw)}" role="option" aria-selected="${checked ? 'true' : 'false'}" title="${esc(item.display)}"><span>${esc(item.display)}</span></button>`;
    }).join('');
    if (!rows) return `<p class="cpaValueEmpty">${esc(needle ? L('Eşleşen CP değeri yok.', 'No matching CP value.') : L('Bu sütunda seçilebilir CP değeri yok.', 'No selectable CP values in this column.'))}</p>`;
    const more = matches.length > limited.length ? `<p class="cpaValueMore">${esc(L(`İlk ${limited.length} sonuç gösteriliyor; arayarak daraltın.`, `Showing the first ${limited.length} results; narrow with search.`))}</p>` : '';
    return rows + more;
  }

  function fieldOptionRows(rule, selected, query) {
    const catalog = catalogFor(rule);
    const needle = String(query || '').trim().toLocaleLowerCase(locale());
    const match = item => !needle || fieldDisplayLabel(item).toLocaleLowerCase(locale()).includes(needle)
      || String(item.id).toLocaleLowerCase(locale()).includes(needle);
    const group = (title, items) => {
      const list = items.filter(match).slice(0, 300);
      if (!list.length) return '';
      return `<div class="cpaFieldGroup" role="presentation">${esc(title)}</div>${list.map(item => {
        const off = item.enabled === false ? ` <small>${esc(L('(kapalı)', '(off)'))}</small>` : '';
        return `<button type="button" class="cpaValueOption${item.id === selected ? ' is-selected' : ''}" data-cpa-field-option="${esc(item.id)}" role="option" aria-selected="${item.id === selected ? 'true' : 'false'}" title="${esc(fieldDisplayLabel(item))}"><span>${esc(fieldDisplayLabel(item))}${off}</span></button>`;
      }).join('')}`;
    };
    const html = group(L('Hesaplanan', 'Calculated'), catalog.derived)
      + group(L('Checklist soruları', 'Checklist questions'), catalog.checklist)
      + group(L('Öncelik kuralları', 'Priority rules'), catalog.rules)
      + group(L('CP sütunları', 'CP columns'), catalog.columns);
    return html || `<p class="cpaValueEmpty">${esc(L('Eşleşen alan yok.', 'No matching field.'))}</p>`;
  }

  function fieldPicker(rule, selected, role, extraAttr) {
    const label = selected ? fieldLabel(selected, rule) : L('Alan seçin', 'Select a field');
    return `<div class="cpaFieldPicker" data-cpa-field-picker="${esc(role)}" ${extraAttr || ''}>
      <button type="button" class="cpaFieldPickerBtn${selected ? '' : ' is-empty'}" data-cpa-field-toggle aria-haspopup="listbox" aria-expanded="false" title="${esc(label)}"><span>${esc(label)}</span><span class="cpaFieldChevron" aria-hidden="true">⌄</span></button>
      <div class="cpaValueMenu cpaFieldMenu" data-cpa-value-menu hidden>
        <input type="search" data-cpa-value-search autocomplete="off" aria-label="${esc(L('Alanlarda ara', 'Search fields'))}" placeholder="${esc(L('Alan ara… (ör. yükleme, kumaş)', 'Search fields… (e.g. load, fabric)'))}">
        <div class="cpaValueOptions" data-cpa-field-options role="listbox"></div>
      </div>
    </div>`;
  }

  function enumChoiceControl(condition, rule) {
    const multi = ['in', 'notIn'].includes(condition.operator);
    const selected = new Set(conditionValueList(condition.right && condition.right.type === 'value' ? condition.right.value : condition.value));
    const options = enumValuesFor(condition.field, rule);
    if (multi) {
      return `<div class="cpaChoiceGroup" role="group" aria-label="${esc(L('Değerler', 'Values'))}">${options.map(option =>
        `<label class="cpaChoice${selected.has(option.value) ? ' is-on' : ''}"><input type="checkbox" data-cpa-cond-choice value="${esc(option.value)}" ${selected.has(option.value) ? 'checked' : ''}><span>${esc(option.label)}</span></label>`).join('')}</div>`;
    }
    const current = [...selected][0] || '';
    return `<select data-cpa-cond-value aria-label="${esc(L('Koşul değeri', 'Condition value'))}">${current ? '' : `<option value="">${esc(L('Değer seçin', 'Select a value'))}</option>`}${options.map(option =>
      `<option value="${esc(option.value)}"${option.value === current ? ' selected' : ''}>${esc(option.label)}</option>`).join('')}</select>`;
  }

  function valueControl(condition, rule) {
    const operator = Rules.OPERATORS.find(item => item.id === condition.operator) || {};
    const right = condition.right || { type: 'value', value: condition.value };
    const kind = fieldKind(condition.field, rule);
    const value = Array.isArray(right.value) ? right.value.join(', ') : right.value;
    if (!operator.value) return '<span class="cpaCondValueSpacer"></span>';
    if (right.type === 'today') return `<span class="cpaCondToday">TODAY()</span>`;
    if (right.type === 'field') return fieldPicker(rule, right.field, 'right', 'data-cpa-cond-right-field');
    if (['checklist', 'rule', 'enum'].includes(kind)) return enumChoiceControl(condition, rule);
    const multi = ['in', 'notIn'].includes(condition.operator);
    if (operator.numeric || (kind === 'number' && !multi && condition.operator !== 'contains')) {
      return `<input type="number" step="any" data-cpa-cond-value value="${esc(value)}" placeholder="${esc(L('sayı', 'number'))}" aria-label="${esc(L('Koşul değeri', 'Condition value'))}">`;
    }
    const cpSelectable = kind === 'column' || condition.field === '@loadingType';
    if (!cpSelectable) {
      return `<input data-cpa-cond-value value="${esc(value)}" placeholder="${esc(multi ? L('değerler (virgülle çoklu)', 'values (comma separated)') : L('değer', 'value'))}" aria-label="${esc(L('Koşul değeri', 'Condition value'))}">`;
    }
    return `<div class="cpaValuePicker" data-cpa-value-picker data-multi="${multi ? '1' : '0'}">
      <input data-cpa-cond-value value="${esc(value)}" autocomplete="off" placeholder="${esc(multi ? L('değerler (virgülle çoklu)', 'values (comma separated)') : L('değer seçin veya yazın', 'select or type a value'))}" aria-label="${esc(L('Koşul değeri', 'Condition value'))}" aria-expanded="false">
      <button type="button" class="cpaValueToggle" data-cpa-value-toggle aria-expanded="false" aria-label="${esc(L('CP değerlerini göster', 'Show CP values'))}" title="${esc(L('CP değerlerini göster', 'Show CP values'))}">⌄</button>
      <div class="cpaValueMenu" data-cpa-value-menu hidden>
        <input type="search" data-cpa-value-search autocomplete="off" aria-label="${esc(L('CP değerlerinde ara', 'Search CP values'))}" placeholder="${esc(L('CP değerlerinde ara…', 'Search CP values…'))}">
        <div class="cpaValueOptions" data-cpa-value-options role="listbox" aria-multiselectable="${multi ? 'true' : 'false'}">${valueOptionRows(condition, '')}</div>
      </div>
    </div>`;
  }

  function operandTypeOptions(selected) {
    return [
      ['value', L('Değer', 'Value')],
      ['field', L('Başka alan', 'Another field')],
      ['today', L('Bugün — TODAY()', 'Today — TODAY()')],
    ].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function offsetControl(operand, side, rule) {
    const offset = operand && operand.offset;
    const offsetValue = offset ? Number(offset.value) : 0;
    const offsetField = operand && operand.offsetField || '';
    return `<div class="cpaCondOffset" data-cpa-cond-${side}-offset-wrap>
      <input type="number" step="1" data-cpa-cond-${side}-offset value="${esc(offsetValue || '')}" placeholder="${esc(L('± gün', '± days'))}" aria-label="${esc(L('Tarih gün farkı', 'Date day offset'))}">
      <select data-cpa-cond-${side}-offset-unit aria-label="${esc(L('Tarih fark birimi', 'Date offset unit'))}"><option value="days"${!offset || offset.unit !== 'weeks' ? ' selected' : ''}>${esc(L('gün', 'days'))}</option><option value="weeks"${offset && offset.unit === 'weeks' ? ' selected' : ''}>${esc(L('hafta', 'weeks'))}</option></select>
      ${fieldPicker(rule, offsetField, `${side}-offset`, `data-cpa-cond-${side}-offset-field`)}
    </div>`;
  }

  function conditionSummary(condition, rule) {
    const item = Rules.normalizeCondition(condition);
    const kind = fieldKind(item.left.field, rule);
    const enumLabel = value => {
      const option = enumValuesFor(item.left.field, rule).find(entry => entry.value === String(value));
      return option ? option.label : value;
    };
    const operandLabel = operand => {
      let label;
      if (operand.type === 'field') label = fieldLabel(operand.field, rule);
      else if (operand.type === 'today') label = L('bugün', 'today');
      else {
        const list = Array.isArray(operand.value) ? operand.value : [operand.value];
        label = ['checklist', 'rule', 'enum'].includes(kind) ? list.map(enumLabel).join(', ') : list.join(', ');
      }
      const offset = Number(operand.offset?.value) || 0;
      if (offset) label += ` ${offset > 0 ? '+' : '−'} ${Math.abs(offset)} ${operand.offset.unit === 'weeks' ? L('hafta', 'weeks') : L('gün', 'days')}`;
      if (operand.offsetField) label += ` + ${fieldLabel(operand.offsetField, rule)}`;
      return label;
    };
    const needsValue = !['empty', 'notEmpty'].includes(item.operator);
    return [operandLabel(item.left), operatorLabel(item.operator), needsValue ? operandLabel(item.right) : '']
      .filter(Boolean).join(' · ');
  }

  function ruleSummary(rule) {
    if (rule.kind === 'checklist' && typeof Rules.checklistScopePreset === 'function') {
      const preset = Rules.checklistScopePreset(rule);
      if (preset.preset === 'all') return L('Tüm aktif siparişlere sorulur', 'Asked for all active orders');
      if (preset.preset === 'window') {
        const ageText = preset.minOrderAgeDays != null ? ` · ${L(`sipariş yaşı ≥ ${preset.minOrderAgeDays}g`, `order age ≥ ${preset.minOrderAgeDays}d`)}` : '';
        return L(`Yüklemeye ≤ ${preset.maxDaysToLoad} gün kala`, `≤ ${preset.maxDaysToLoad} days before loading`) + ageText;
      }
    }
    if (rule.mode === 'formula') {
      const display = Rules.formulaToDisplay(rule.formula || '', catalogFor(rule), lang());
      return display ? display.replace(/^=/, '') : L('Formül kuralı', 'Formula rule');
    }
    if (!rule.conditions.length) return L('Koşul yok', 'No conditions');
    const first = conditionSummary(rule.conditions[0], rule);
    const extra = rule.conditions.length - 1;
    return extra > 0 ? `${first} · +${extra} ${L('koşul', 'more')}` : first;
  }

  function ruleTone(rule) {
    if (rule.kind !== 'priority') return 'blue';
    return priorityToneOf(rule.target);
  }

  function ruleBadge(rule) {
    return rule.kind === 'priority' ? (OD?.priorityMeta?.(rule.target, state.priorityCatalog)?.usage === 'tracking' ? L('Takip: ', 'Tracking: ') : '') + priorityLabel(rule.target) : L('Checklist', 'Checklist');
  }

  function ruleName(rule) {
    if (!rule) return '';
    const value = isEn() ? (rule.nameEn || (rule.kind === 'checklist' ? rule.en : '') || rule.name) : rule.name;
    return String(value || '').trim() || L('Adsız kural', 'Unnamed rule');
  }
  function ruleNames(list) {
    return list.map(item => `"${ruleName(item)}"`).join(', ');
  }

  function rulePreview(rule) {
    const orders = state.model && Array.isArray(state.model.orders) ? state.model.orders : null;
    if (!orders) return null;
    return Rules.previewRuleImpact(orders, rule, { rules: state.rules, answers: state.answers,
      plmEvidence, checklistEnabled: state.checklistSettings.enabled, priorityCatalog: state.priorityCatalog });
  }

  function previewHtml(rule) {
    const preview = rulePreview(rule);
    if (!preview) return `<span class="cpaNote">${esc(L('Önizleme CP verisi yüklendiğinde görünür.', 'Preview appears when CP data is loaded.'))}</span>`;
    return `<b>${esc(L(`${int(preview.count)} sipariş eşleşiyor · ${int(preview.changed)} siparişin sonucu değişecek`, `${int(preview.count)} orders match · ${int(preview.changed)} order results will change`))}</b>
      <span>${esc(L(`${int(preview.total)} sipariş içinde · ${int(preview.qty)} adet`, `out of ${int(preview.total)} orders · ${int(preview.qty)} units`))}</span>
      ${preview.automaticAnswers ? `<small>${esc(L(`${int(preview.automaticAnswers)} otomatik checklist yanıtı yazılacak. Geri alma yalnız kural tanımını geri getirir.`, `${int(preview.automaticAnswers)} automatic checklist answers will be written. Undo restores the rule definition only.`))}</small>` : ''}
      ${preview.sample.length ? `<small>${esc(L('Örnek', 'Example'))}: ${esc(preview.sample.join(' · '))}</small>` : ''}`;
  }

  function conditionRow(rule, condition, index, advanced, attrPrefix) {
    const prefix = attrPrefix || 'cond';
    const kind = fieldKind(condition.field, rule);
    const allowed = OPERATORS_BY_KIND[kind] || OPERATORS_BY_KIND.text;
    const operatorIds = allowed.includes(condition.operator) ? allowed : [condition.operator, ...allowed];
    const operators = operatorIds.map(id => Rules.OPERATORS.find(item => item.id === id)).filter(Boolean).map(item =>
      `<option value="${item.id}"${item.id === condition.operator ? ' selected' : ''}>${esc(isEn() ? item.en : item.tr)}</option>`).join('');
    const left = condition.left || { type: 'field', field: condition.field };
    const right = condition.right || { type: 'value', value: condition.value };
    const canCompare = prefix === 'cond' && !['checklist', 'rule', 'enum'].includes(kind);
    const rightTypeSelect = advanced && canCompare
      ? `<select class="cpaCondRightType" data-cpa-cond-right-type aria-label="${esc(L('Neyle karşılaştırılsın', 'Compare with'))}">${operandTypeOptions(right.type || 'value')}</select>`
      : '';
    const leftOffset = advanced && canCompare ? offsetControl(left, 'left', rule) : '';
    const rightOffset = advanced && canCompare && right.type !== 'value' ? offsetControl(right, 'right', rule) : '';
    return `<div class="cpaCondRow${advanced ? ' is-advanced' : ''}" data-cpa-${prefix}="${esc(rule.id)}:${index}">
      <div class="cpaCondOperand" data-cpa-cond-left>${fieldPicker(rule, condition.field, prefix === 'auto-cond' ? 'auto-left' : 'left', 'data-cpa-cond-left-field')}${leftOffset}</div>
      <select data-cpa-${prefix}-op aria-label="${esc(L('Koşul işlemi', 'Condition operator'))}">${operators}</select>
      <div class="cpaCondOperand">${rightTypeSelect}${valueControl(condition, rule)}${rightOffset}</div>
      ${canCompare ? `<button type="button" class="cpaIconBtn cpaCondAdvanced${advanced ? ' is-on' : ''}" data-cpa-cond-advanced aria-pressed="${advanced ? 'true' : 'false'}" title="${esc(L('Başka alanla veya bugünle karşılaştır, gün ekle', 'Compare with another field or today, add days'))}" aria-label="${esc(L('Gelişmiş karşılaştırma', 'Advanced comparison'))}">⇄</button>` : '<span></span>'}
      <button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-${prefix}-remove title="${esc(L('Koşulu sil', 'Remove condition'))}" aria-label="${esc(L('Koşulu sil', 'Remove condition'))}"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>`;
  }

  const FORMULA_FUNCTIONS = Object.freeze([
    ['AND()', 'AND('], ['OR()', 'OR('], ['NOT()', 'NOT('], ['IN()', 'IN('], ['CONTAINS()', 'CONTAINS('],
    ['ISBLANK()', 'ISBLANK('], ['BETWEEN()', 'BETWEEN('], ['TODAY()', 'TODAY()'], ['IF()', 'IF('],
  ]);

  function ruleTemplates(kind) {
    const firstChecklistRule = state.rules.find(rule => rule.kind === 'checklist');
    const firstPriorityRule = state.rules.find(rule => rule.kind === 'priority');
    const firstChecklist = firstChecklistRule && { ...firstChecklistRule, name: ruleName(firstChecklistRule) };
    const firstPriority = firstPriorityRule && { ...firstPriorityRule, name: ruleName(firstPriorityRule) };
    if (kind === 'checklist') {
      return [
        { id: 'beforeLoad', title: L('Yüklemeden önce sor', 'Ask before loading'), hint: L('Üretimdeki siparişe, yüklemeye 28 gün kala sorulur.', 'Asked for orders in production, 28 days before loading.'),
          rule: { name: L('Yeni kontrol', 'New check'), conditions: [
            { field: '@stage', operator: 'in', value: ['PRODUCTION', 'LOADING', 'SHORTAGE'] },
            { field: '@daysToLoad', operator: 'gte', value: -30 },
            { field: '@daysToLoad', operator: 'lte', value: 28 }] } },
        { id: 'allActive', title: L('Tüm aktif siparişler', 'All active orders'), hint: L('Üretimdeki ve hazırlıktaki her siparişe sorulur.', 'Asked for every order in preparation or production.'),
          rule: { name: L('Genel kontrol', 'General check'), conditions: [
            { field: '@stage', operator: 'in', value: ['PRE_PRODUCTION', 'PRODUCTION', 'SHORTAGE', 'LOADING'] }] } },
        { id: 'license', title: L('Yalnız belirli lisanslar', 'Only certain licenses'), hint: L('Seçtiğiniz lisansların siparişlerine sorulur.', 'Asked only for orders of the licenses you pick.'),
          rule: { name: L('Lisans kontrolü', 'License check'), conditions: [
            { field: 'License', operator: 'in', value: [] },
            { field: '@daysToLoad', operator: 'lte', value: 60 }] } },
        ...(firstPriority ? [{ id: 'whenRule', title: L('Bir kural eşleşince sor', 'Ask when a rule matches'), hint: L(`"${firstPriority.name}" kuralına takılan siparişlere sorulur.`, `Asked for orders matched by "${firstPriority.name}".`),
          rule: { name: L('Kural takibi', 'Rule follow-up'), conditions: [{ field: `${Rules.RULE_PREFIX}${firstPriority.id}`, operator: 'eq', value: 'matched' }] } }] : []),
        { id: 'blank', title: L('Boş soru', 'Blank question'), hint: L('Koşulları kendiniz seçin.', 'Choose the conditions yourself.'),
          rule: { name: L('Yeni kontrol', 'New check'), conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] } },
      ];
    }
    return [
      ...(firstChecklist ? [{ id: 'checkOpen', title: L('Yükleme yakın, kontrol onaysız', 'Loading soon, check not approved'), hint: L(`14 gün içinde yüklenecek ve "${firstChecklist.name}" onaylanmamış.`, `Loads within 14 days and "${firstChecklist.name}" is not approved.`),
        rule: { name: L(`${firstChecklist.name} onaysız`, `${firstChecklist.name} not approved`), target: 'ACTION_THIS_WEEK',
          reasonTr: `Yükleme yakın, ${firstChecklist.tr || firstChecklist.name} onaylanmadı`, reasonEn: `Loading soon, ${firstChecklist.en || firstChecklist.name} not approved`, conditions: [
            { field: '@daysToLoad', operator: 'gte', value: 0 },
            { field: '@daysToLoad', operator: 'lte', value: 14 },
            { field: `${Rules.CHECKLIST_PREFIX}${firstChecklist.id}`, operator: 'in', value: ['open', 'rejected'] }] } }] : []),
      ...(firstChecklist ? [{ id: 'checkRejected', title: L('Kontrol reddedildi', 'Check rejected'), hint: L(`"${firstChecklist.name}" reddedilen siparişi Bugün Aksiyon'a taşır.`, `Moves orders with a rejected "${firstChecklist.name}" to Action Today.`),
        rule: { name: L(`${firstChecklist.name} reddedildi`, `${firstChecklist.name} rejected`), target: 'ACTION_TODAY',
          reasonTr: `${firstChecklist.tr || firstChecklist.name} reddedildi`, reasonEn: `${firstChecklist.en || firstChecklist.name} rejected`, conditions: [
            { field: `${Rules.CHECKLIST_PREFIX}${firstChecklist.id}`, operator: 'eq', value: 'rejected' }] } }] : []),
      { id: 'loadPassed', title: L('Yükleme tarihi geçti', 'Load date passed'), hint: L('Yükleme tarihi geçmiş ve hâlâ üretimdeki siparişler.', 'Load date has passed and the order is still in production.'),
        rule: { name: L('Yükleme tarihi geçti', 'Load date passed'), target: 'CRITICAL',
          reasonTr: 'Yükleme tarihi geçti, sipariş hâlâ üretimde', reasonEn: 'Load date passed, the order is still in production', conditions: [
            { field: '@daysToLoad', operator: 'lt', value: 0 },
            { field: '@stage', operator: 'in', value: ['PRODUCTION', 'SHORTAGE'] }] } },
      { id: 'blank', title: L('Boş kural', 'Blank rule'), hint: L('Öncelik etiketini ve koşulları kendiniz seçin.', 'Pick the priority tag and conditions yourself.'),
        rule: { name: L('Yeni kural', 'New rule'), target: 'ACTION_THIS_WEEK', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] } },
    ];
  }

  function aiGuideFor(kind, rule, request, autoStatus) {
    return Rules.buildAiGuide({ lang: lang(), kind, fields: catalogFor(rule),
      request: request || '', autoStatus: autoStatus || '' });
  }

  function selectablePriorityTargets() {
    return (state.priorityCatalog || defaultCatalog()).filter(entry => entry.id !== 'ON_TRACK');
  }

  function rulePlainSummary(rule) {
    // A formula may not be representable as basic conditions. Never describe
    // an old basic-condition cache as the currently evaluated formula.
    const synced = rule.mode === 'formula' ? Rules.formulaToConditions(rule.formula || '') : null;
    const conditions = rule.mode === 'formula' ? synced?.conditions : rule.conditions;
    const match = synced ? synced.match : rule.match;
    const when = conditions
      ? (conditions.length ? `<ul>${conditions.map(condition => `<li>${esc(conditionSummary(condition, rule).replace(/ · /g, ' '))}</li>`).join('')}</ul>`
        : `<p>${esc(L('Koşul yok; hiçbir siparişe uygulanmaz.', 'No conditions; no orders will match.'))}</p>`)
      : `<p>${esc(L('Özel bir formül kullanılıyor. Ayrıntıları elle düzenleme bölümünde inceleyebilirsiniz.', 'A custom formula is in use. Review it in the manual editing section.'))}</p>`;
    const outcome = rule.kind === 'priority' ? ruleBadge(rule) : questionOf(rule) || ruleName(rule);
    return `<div class="cpaPlainSummary" data-cpa-plain-summary>
      <h3>${esc(L('Kuralın sade özeti', 'Your rule in plain language'))}</h3>
      <div class="cpaPlainColumns"><section><h4>${esc(L('01 / Ne zaman?', '01 / When?'))}</h4>${when}
        ${conditions?.length ? `<small>${esc(match === 'any' ? L('Koşullardan biri yeterli.', 'Any one condition is enough.') : L('Koşulların tümü sağlandığında çalışır.', 'Runs when all conditions match.'))}</small>` : ''}</section>
      <section><h4>${esc(L('02 / Ne olsun?', '02 / Then?'))}</h4><span class="cpaPill tone-${esc(ruleTone(rule))}">${esc(outcome)}</span>
        <p>${esc(rule.kind === 'priority' ? L('Siparişe bu etiket verilir.', 'The order receives this tag.') : L('CP tablosunda ve İş Listesi’nde bu kontrol açılır.', 'This check opens in CP and the Work Queue.'))}</p>
        ${rule.kind === 'checklist' && rule.autoStatus ? `<p>${esc(L('Otomatik durum ataması açık:', 'Automatic status assignment enabled:'))} ${esc(Checklist.statusLabel(rule.autoStatus, lang()))}</p>` : ''}</section></div></div>`;
  }

  function ruleBlock(rule, view) {
    const isOpen = view.expandedRuleId === rule.id;
    const targets = selectablePriorityTargets();
    const conditionCount = rule.conditions.length;
    const countText = rule.mode === 'formula'
      ? L('Formül', 'Formula')
      : conditionCount === 1 ? L('1 koşul', '1 condition') : L(`${conditionCount} koşul`, `${conditionCount} conditions`);
    const matchText = rule.match === 'any' ? L('Biri yeterli', 'Any') : L('Hepsi', 'All');
    const dangling = Rules.danglingReferences(rule, state.rules);
    const dependents = Rules.dependentsOf(rule, state.rules);
    const cycle = isOpen ? Rules.findCycle(rule, state.rules) : [];
    const uiMode = view.modeOf(rule);
    const editorFields = rule.kind === 'priority'
      ? `<label class="cpaRuleTarget cpaRuleNameField"><span>${esc(L('Kural adı', 'Rule name'))}</span>
          <input class="cpaRuleName" data-cpa-rule-name value="${esc(ruleName(rule))}" placeholder="${esc(L('Örn. Kumaş testi onaysız', 'e.g. Fabric test not approved'))}"></label>
        <label class="cpaRuleTarget"><span>${esc(L('Eşleşen siparişi şu öncelik etiketine taşı', 'Escalate matching orders to tag'))}</span>
          <select data-cpa-rule-target>${targets.map(entry =>
        `<option value="${esc(entry.id)}"${rule.target === entry.id ? ' selected' : ''}>${esc(priorityLabel(entry.id))}</option>`).join('')}
            <option value="__new__">+ ${esc(L('Yeni Öncelik Etiketi Ekle…', 'Add New Priority Tag…'))}</option>
          </select></label>`
      : `<label class="cpaRuleTarget cpaRuleNameField"><span>${esc(L('Başlık (CP sütunu)', 'Heading (CP column)'))}</span>
          <input class="cpaRuleName" data-cpa-rule-name value="${esc(ruleName(rule))}" placeholder="${esc(L('Örn. Fabric Test', 'e.g. Fabric Test'))}"></label>
        <label class="cpaRuleTarget cpaRuleQuestionField"><span>${esc(L('Açıklayıcı soru (opsiyonel)', 'Helper question (optional)'))}</span>
          <input data-cpa-rule-question value="${esc(isEn() ? rule.questionEn : rule.questionTr)}" placeholder="${esc(L('Hologram siparişi verildi mi?', 'Has the hologram been ordered?'))}"></label>
        <label class="cpaRuleTarget cpaRuleApprovalScopeField"><span>${esc(L('Onay geçerliliği', 'Approval scope'))}</span>
          <select data-cpa-rule-approval-scope>
            <option value="order"${rule.approvalScope !== 'option' ? ' selected' : ''}>${esc(L('Her PO’da tekrar kontrol et', 'Repeat for every PO'))}</option>
            <option value="option"${rule.approvalScope === 'option' ? ' selected' : ''}>${esc(L('Aynı model/renkte diğer PO’lara taşı', 'Carry to other POs of the same model/colour'))}</option>
          </select>
          <small>${esc(L('Aynı PLM + Model + Renk için Onaylandı diğer PO’lara taşınır; Reddedildi PO’ya özel kalır.', 'Approved carries across POs of the same PLM + Model + Colour; Rejected stays PO-specific.'))}</small>
        </label>
        <div class="cpaRuleTarget cpaRuleEvidenceFields"><span>${esc(L('Ek bilgi alanları', 'Evidence fields'))}</span>
          <div class="cpaRuleEvidenceChecks">
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="reportNumber"${rule.evidenceFields?.reportNumber ? ' checked' : ''}><span>${esc(L('Rapor numarası', 'Report number'))}</span></label>
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="actualDate"${rule.evidenceFields?.actualDate ? ' checked' : ''}><span>${esc(L('Gerçekleşme tarihi', 'Actual date'))}</span></label>
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="attachments"${rule.evidenceFields?.attachments ? ' checked' : ''}><span>${esc(L('Rapor / e-mail eki', 'Report / e-mail attachment'))}</span></label>
          </div>
          <small>${esc(L('Seçilen alanlar İş Listesi’nde ve CP Checklist Detayları penceresinde açılır.', 'Selected fields open in Work Queue and CP Checklist Details.'))}</small>
        </div>`;

    const autoMode = rule.autoMode === 'basic' ? 'basic' : 'formula';
    const autoConditions = Array.isArray(rule.autoConditions) ? rule.autoConditions : [];
    const automaticStatusFields = rule.kind === 'checklist' ? `<div class="cpaRuleTarget cpaRuleAutoStatus">
      <div class="cpaRowBetween"><b>${esc(L('Koşula bağlı otomatik durum', 'Automatic status when a condition matches'))}</b>
        ${rule.autoStatus ? `<div class="cpaAutoModeSwitch" role="group" aria-label="${esc(L('Otomatik durum koşul tipi', 'Auto-status condition mode'))}">
          <button type="button" class="${autoMode === 'basic' ? 'is-on' : ''}" data-cpa-auto-mode="basic">${esc(L('Basit Koşul', 'Simple Condition'))}</button>
          <button type="button" class="${autoMode === 'formula' ? 'is-on' : ''}" data-cpa-auto-mode="formula">${esc(L('Formül', 'Formula'))}</button>
        </div>` : ''}
      </div>
      <small>${esc(L('Manuel kararlar her zaman önceliklidir; koşul sağlandığında yalnız açık kalan siparişlere seçtiğiniz durum yazılır.', 'Manual decisions always win; when matched, the chosen status is written only to unanswered orders.'))}</small>
      <label><span>${esc(L('Otomatik yazılacak durum', 'Status to assign'))}</span>
        <select data-cpa-auto-status><option value="">${esc(L('Kapalı (otomatik yazma)', 'Disabled (do not auto-assign)'))}</option>
          ${Checklist.statusIds().map(id => `<option value="${esc(id)}"${rule.autoStatus === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('')}
        </select></label>
      ${rule.autoStatus ? (autoMode === 'basic'
        ? `<div class="cpaConditions">
            <div class="cpaMatchLine"><span>${esc(L('Durumu yaz, eğer', 'Set status if'))}</span>
              <select data-cpa-auto-match aria-label="${esc(L('Otomatik durum eşleşmesi', 'Auto-status match'))}">
                <option value="all"${rule.autoMatch !== 'any' ? ' selected' : ''}>${esc(L('koşulların hepsi', 'all conditions'))}</option>
                <option value="any"${rule.autoMatch === 'any' ? ' selected' : ''}>${esc(L('koşullardan biri', 'any condition'))}</option>
              </select><span>${esc(L('sağlanıyorsa:', 'match:'))}</span></div>
            ${autoConditions.map((condition, index) => conditionRow(rule, condition, index, false, 'auto-cond')).join('')
              || `<p class="cpaNote cpaRuleEmptyNote">${esc(L('Henüz otomatik durum koşulu eklenmedi.', 'No auto-status conditions added yet.'))}</p>`}
            <div class="cpaRuleBodyActions"><button type="button" class="cpaBtn sm" data-cpa-auto-cond-add>+ ${esc(L('Otomatik koşul ekle', 'Add auto condition'))}</button></div>
          </div>`
        : `<label><span>${esc(L('Otomatik atama formülü (TRUE / FALSE)', 'Auto-assignment formula (TRUE / FALSE)'))}</span>
            <textarea rows="2" data-cpa-auto-formula spellcheck="false" placeholder="${esc(L('=IN([Aşama],"LOADING","IN_WAREHOUSE")', '=IN([Stage],"LOADING","IN_WAREHOUSE")'))}">${esc(Rules.formulaToDisplay(rule.autoFormula || '', catalogFor(rule), lang()))}</textarea></label>
          <small data-cpa-auto-feedback aria-live="polite">${esc(L('Örnek: Üretim bittiyse Onaylandı yaz.', 'Example: Set Approved when production is finished.'))}</small>`) : ''}
    </div>` : '';

    const reasonFields = rule.kind === 'priority'
      ? `<div class="cpaRuleReasons">
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Siparişte görünecek açıklama — TR (opsiyonel)', 'Order reason text — TR (optional)'))}</span>
            <input data-cpa-rule-reason-tr value="${esc(rule.reasonTr || '')}" placeholder="${esc(L('Boş bırakılırsa kural adı kullanılır', 'Uses rule name if left blank'))}">
          </label>
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Siparişte görünecek açıklama — EN (opsiyonel)', 'Order reason text — EN (optional)'))}</span>
            <input data-cpa-rule-reason-en value="${esc(rule.reasonEn || '')}" placeholder="${esc(L('Boş bırakılırsa Türkçe açıklama / kural adı kullanılır', 'Falls back to TR text / rule name if blank'))}">
          </label>
        </div>`
      : '';

    const scopeInfo = rule.kind === 'checklist' && typeof Rules.checklistScopePreset === 'function'
      ? Rules.checklistScopePreset(rule)
      : { preset: 'custom', maxDaysToLoad: 28, minOrderAgeDays: null };
    const scopePresetSelect = rule.kind === 'checklist' ? `<div class="cpaScopePresets">
      <b>${esc(L('Bu kontrol hangi siparişlere sorulsun?', 'Which orders should be asked?'))}</b>
      <div class="cpaScopePresetTabs" role="group" aria-label="${esc(L('Soru kapsamı', 'Question scope'))}">
        <button type="button" class="cpaScopePresetBtn${scopeInfo.preset === 'all' && uiMode === 'basic' ? ' is-on' : ''}" data-cpa-scope-preset="all">${esc(L('Tüm aktif siparişlere sor', 'Ask all active orders'))}</button>
        <button type="button" class="cpaScopePresetBtn${scopeInfo.preset === 'window' && uiMode === 'basic' ? ' is-on' : ''}" data-cpa-scope-preset="window">${esc(L('Yüklemeye X gün kala sor', 'Ask X days before loading'))}</button>
        <button type="button" class="cpaScopePresetBtn${scopeInfo.preset === 'custom' || uiMode !== 'basic' ? ' is-on' : ''}" data-cpa-scope-preset="custom">${esc(L('Özel koşul / Formül / LCW AI', 'Custom conditions / Formula / LCW AI'))}</button>
      </div>
      ${scopeInfo.preset === 'window' && uiMode === 'basic' ? `<div class="cpaScopeInlineRow">
        <span>${esc(L('Yüklemeye en fazla', 'At most'))}</span>
        <input type="number" step="1" data-cpa-scope-days value="${esc(scopeInfo.maxDaysToLoad ?? 28)}" aria-label="${esc(L('Yüklemeye kalan gün sınırı', 'Days to load limit'))}">
        <span>${esc(L('gün varken sor · Sipariş yaşı en az (opsiyonel):', 'days before load · Min order age (optional):'))}</span>
        <input type="number" step="1" min="0" data-cpa-scope-age value="${esc(scopeInfo.minOrderAgeDays ?? '')}" placeholder="—" aria-label="${esc(L('Minimum sipariş yaşı (gün)', 'Minimum order age (days)'))}">
        <span>${esc(L('gün', 'days'))}</span>
      </div>` : ''}
    </div>` : '';

    const showConditionBuilder = rule.kind !== 'checklist' || scopeInfo.preset === 'custom' || uiMode !== 'basic';
    const modeTab = (mode, label) => `<button type="button" id="cpa-rule-mode-${mode}-${esc(rule.id)}" role="tab" data-cpa-rule-mode="${mode}" aria-controls="cpa-rule-mode-panel-${esc(rule.id)}" aria-selected="${uiMode === mode ? 'true' : 'false'}" tabindex="${uiMode === mode ? '0' : '-1'}" class="${uiMode === mode ? 'is-on' : ''}">${esc(label)}</button>`;
    const modeEditor = `<div class="cpaRuleModeTabs" data-bl-tabs="segment" role="tablist" aria-label="${esc(L('Koşul yazma biçimi', 'How to write the condition'))}">
          ${modeTab('basic', L('Basit', 'Simple'))}${modeTab('formula', L('Formül', 'Formula'))}
        </div>`;
    const displayFormula = Rules.formulaToDisplay(rule.formula || '', catalogFor(rule), lang());
    const formulaEditor = `<div class="cpaFormulaEditor">
          <label class="cpaRuleTarget"><span>${esc(L('Formül — sonuç TRUE ise kural uygulanır', 'Formula — the rule applies when the result is TRUE'))}</span>
            <textarea data-cpa-rule-formula rows="4" spellcheck="false" placeholder="${esc(L('=AND([Yüklemeye kalan gün]<=14,IN([Kontrol: PPS onayı],"open","rejected"))', '=AND([Days to load]<=14,IN([Check: PPS approval],"open","rejected"))'))}">${esc(displayFormula)}</textarea>
          </label>
          <div class="cpaFormulaActions"><button type="button" class="cpaBtn sm" data-cpa-formula-test>${esc(L('Formülü test et', 'Test formula'))}</button><span data-cpa-formula-status class="cpaFormulaStatus"></span></div>
          <div data-cpa-formula-error class="cpaRuleFieldError" hidden></div>
          <div data-cpa-formula-diagnostics class="cpaFormulaDiagnostics" hidden></div>
          <div class="cpaFormulaFields"><span>${esc(L('Ekle', 'Insert'))}</span>${fieldPicker(rule, '', 'formula', 'data-cpa-formula-insert')}
            ${FORMULA_FUNCTIONS.map(([labelText, snippet]) => `<button type="button" class="cpaFormulaField" data-cpa-formula-fn="${esc(snippet)}">${esc(labelText)}</button>`).join('')}</div>
          <p class="cpaNote">${esc(L('Alan adlarını köşeli parantezle yazın: [Yüklemeye kalan gün]. Checklist alanı "open", "approved", "rejected", "notRequired" ya da özel durum kimliğini alır.', 'Write field names in square brackets: [Days to load]. A checklist field takes "open", "approved", "rejected", "notRequired" or a custom status ID.'))}</p>
        </div>`;
    const aiDraft = view.aiDraftOf(rule);
    const aiPurposeEditor = rule.kind === 'checklist' ? `<div class="cpaRuleTarget cpaRuleAutoStatus">
        <b>${esc(L('LCW AI önerisinin hedefi', 'Target for LCW AI suggestion'))}</b>
        <select data-cpa-ai-purpose aria-label="${esc(L('LCW AI koşul hedefi', 'LCW AI condition target'))}">
          <option value="question"${aiDraft.purpose !== 'auto' ? ' selected' : ''}>${esc(L('Sorunun hangi siparişlere sorulacağı', 'Which orders are asked'))}</option>
          <option value="auto"${aiDraft.purpose === 'auto' ? ' selected' : ''}>${esc(L('Koşul gerçekleşince durum yaz', 'Assign a status when the condition matches'))}</option>
        </select>
        ${aiDraft.purpose === 'auto' ? `<label><span>${esc(L('Yazılacak durum', 'Status to write'))}</span><select data-cpa-ai-auto-status>
          ${Checklist.statusIds().map(id => `<option value="${esc(id)}"${(aiDraft.autoStatus || rule.autoStatus || 'approved') === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('')}
        </select></label>` : ''}
      </div>` : '';
    const aiEditor = `${aiPurposeEditor}<div class="cpaLcwAi" data-cpa-lcwai-host></div><div class="cpaAiResult" data-cpa-ai-result aria-live="polite"></div>`;
    const basicEditor = `<div class="cpaConditions">
          <div class="cpaMatchLine"><span>${esc(rule.kind === 'checklist' ? L('Siparişe sor, eğer', 'Ask the order if') : L('Siparişi yükselt, eğer', 'Escalate the order if'))}</span>
            <select data-cpa-rule-match aria-label="${esc(L('Koşul birleşimi', 'Condition match'))}">
              <option value="all"${rule.match !== 'any' ? ' selected' : ''}>${esc(L('koşulların hepsi', 'all conditions'))}</option>
              <option value="any"${rule.match === 'any' ? ' selected' : ''}>${esc(L('koşullardan biri', 'any condition'))}</option>
            </select><span>${esc(L('sağlanıyorsa:', 'match:'))}</span></div>
          ${rule.conditions.length ? `<div class="cpaCondLabels" aria-hidden="true"><span>${esc(L('Alan', 'Field'))}</span><span>${esc(L('İşlem', 'Operator'))}</span><span>${esc(L('Değer', 'Value'))}</span><span></span><span></span></div>` : ''}
          ${rule.conditions.map((condition, index) => conditionRow(rule, condition, index, view.isAdvanced(rule, index, condition))).join('')
      || `<p class="cpaNote cpaRuleEmptyNote">${esc(L('Koşul yok — bu kural hiçbir siparişe uygulanmaz.', 'No conditions — this rule matches nothing.'))}</p>`}
        </div>
        <div class="cpaRuleBodyActions"><button type="button" class="cpaBtn sm" data-cpa-cond-add>+ ${esc(L('Koşul ekle', 'Add condition'))}</button></div>`;
    const panel = uiMode === 'formula' ? formulaEditor : basicEditor;
    const warnings = [
      dangling.length ? `<p class="cpaRuleWarn">${esc(L('Bu kural silinmiş bir başlığa bağlı; o koşul hiçbir siparişte sağlanmaz. Koşulu güncelleyin.', 'This rule refers to a deleted item; that condition never matches. Update the condition.'))}</p>` : '',
      cycle.length ? `<p class="cpaRuleWarn">${esc(L(`Döngüsel bağlantı: ${ruleNames(cycle)} bu kurala geri bağlı. Döngüdeki koşul sağlanmaz sayılır.`, `Circular link: ${ruleNames(cycle)} points back to this rule. The looped condition is treated as not matching.`))}</p>` : '',
      dependents.length ? `<p class="cpaNote cpaRuleUsedBy">${esc(L(`Şu kuralların koşulunda kullanılıyor: ${ruleNames(dependents)}`, `Used as a condition in: ${ruleNames(dependents)}`))}</p>` : '',
    ].join('');
    const readOnly = rule.managed === true && !isModerator();
    const body = isOpen ? `<div class="cpaRuleBody" id="cpa-rule-body-${esc(rule.id)}">
        ${readOnly ? `<p class="cpaNote cpaRuleManagedNote">${esc(L('Bu kural Moderatör tarafından tüm kullanıcılara uygulanır; yalnız Moderatör değiştirebilir.', 'The Moderator applies this rule to all users; only the Moderator can change it.'))}</p>` : ''}
        <fieldset class="cpaRuleFieldset"${readOnly ? ' disabled' : ''}>
        <section class="cpaAiFirst cpaFrame" aria-label="${esc(L('LCW AI’dan Destek Al', 'Get help from LCW AI'))}">
          <p class="cpaNote">${esc(L('Ne istediğinizi kendi cümlenizle yazın. Formül bilmenize gerek yok.', 'Describe what you need in your own words. No formula knowledge needed.'))}</p>
          ${aiEditor}
        </section>
        ${rulePlainSummary(rule)}
        <details class="cpaAdvancedModes" data-cpa-manual-editor${view.isManualOpen(rule) ? ' open' : ''}><summary>${esc(L('Koşulları kendim düzenlemek istiyorum', 'I want to edit the conditions myself'))}</summary>
        <div class="cpaManualFields">
        <div class="cpaRuleHead">${editorFields}</div>
        ${reasonFields}
        ${scopePresetSelect}
        <p class="cpaRuleSentence">${esc((rule.conditions || []).map(condition => conditionSummary(condition, rule)).join(rule.match === 'any' ? L(' veya ', ' or ') : L(' ve ', ' and ')))} → ${esc(rule.kind === 'priority' ? ruleBadge(rule) : ruleName(rule))}</p>
        ${showConditionBuilder ? `${modeEditor}<div class="cpaRuleModePanel" id="cpa-rule-mode-panel-${esc(rule.id)}" role="tabpanel" aria-labelledby="cpa-rule-mode-${uiMode}-${esc(rule.id)}" tabindex="0">${panel}</div>` : ''}
        ${automaticStatusFields}
        </div></details>
        </fieldset>
        <div class="cpaRulePreview" data-cpa-rule-preview aria-live="polite">${previewHtml(rule)}</div>
        ${warnings}
      </div>` : '';
    const moderator = isModerator();
    const managedBadge = rule.managed === true
      ? `<span class="cpaBuiltIn cpaManagedBadge" title="${esc(L('Moderatör tüm kullanıcılara uyguluyor', 'Applied to all users by the Moderator'))}">${esc(L('Tüm kullanıcılar', 'All users'))}</span>` : '';
    const moderatorActions = moderator
      ? (rule.managed === true
        ? `<button type="button" class="cpaBtn sm" data-cpa-rule-unpublish ${view.isDirty?.(rule) ? 'disabled' : ''} title="${esc(L('Yayını durdur; kullanıcıların kendi kopyaları korunur', 'Stop publishing; users keep their own copies'))}">${esc(L('Yayından kaldır', 'Unpublish'))}</button>`
        : `<button type="button" class="cpaBtn sm" data-cpa-rule-publish ${view.isDirty?.(rule) ? 'disabled' : ''} title="${esc(L('Bu kuralı tüm kullanıcılara uygula', 'Apply this rule to all users'))}">${esc(L('Tüm kullanıcılara uygula', 'Apply to all users'))}</button>`)
        + `<button type="button" class="cpaBtn sm" data-cpa-rule-delete-all title="${esc(L('Bu kuralın aynı kimlikli kopyalarını tüm kullanıcılardan sil', 'Delete copies of this rule with the same ID for all users'))}">${esc(L('Tüm kullanıcılardan sil', 'Delete for all users'))}</button>`
      : '';
    return `<div class="cpaRule cpaFrame${isOpen ? ' is-open' : ''}${rule.enabled ? '' : ' is-disabled'}" data-cpa-rule="${esc(rule.id)}">
      <header class="cpaRuleBar">
        <label class="cpaSwitch" title="${esc(L('Kuralı aç / kapat', 'Enable / disable rule'))}">
          <input type="checkbox" data-cpa-rule-enabled ${rule.enabled ? 'checked' : ''}${readOnly ? ' disabled' : ''} aria-label="${esc(L('Kuralı etkinleştir', 'Enable rule'))}">
          <span class="cpaSwitchTrack" aria-hidden="true"><span></span></span>
          <span>${esc(rule.enabled ? L('Etkin', 'Active') : L('Kapalı', 'Disabled'))}</span>
        </label>
        <div class="cpaRuleSummary">
          <span class="cpaPill tone-${esc(ruleTone(rule))}">${esc(ruleBadge(rule))}</span>
          <span class="cpaRuleSummaryMain"><b>${esc(ruleName(rule))}</b><small>${esc(ruleSummary(rule))}</small></span>
          <span class="cpaRuleSummaryMeta">${esc(countText)} · ${esc(matchText)}</span>
        </div>
        <div class="cpaRuleActions">
          ${dangling.length ? `<span class="cpaPill tone-red" title="${esc(L('Silinmiş bir başlığa bağlı koşul var', 'A condition refers to a deleted item'))}">⚠ ${esc(L('Eksik bağlantı', 'Missing link'))}</span>` : ''}
          ${dependents.length ? `<span class="cpaUsedBy" title="${esc(L(`Kullanan: ${ruleNames(dependents)}`, `Used by: ${ruleNames(dependents)}`))}">${esc(L(`${dependents.length} kuralda kullanılıyor`, `Used in ${dependents.length}`))}</span>` : ''}
          ${rule.builtIn ? `<span class="cpaBuiltIn">${esc(L('Yerleşik', 'Built-in'))}</span>` : ''}
          <span class="cpaBuiltIn cpaScopeBadge">${esc(rule.managed ? L('Ekip', 'Team') : L('Kişisel', 'Personal'))}</span>
          ${view.isDirty?.(rule) ? `<span class="cpaBuiltIn cpaDraftBadge">${esc(L('Taslak', 'Draft'))}</span>` : ''}
          ${moderatorActions ? `<details class="cpaRuleMenu"><summary class="cpaBtn sm" aria-label="${esc(L('Ekip işlemleri', 'Team actions'))}">⋯</summary><div class="cpaRuleMenuItems">${moderatorActions}</div></details>` : ''}
          ${readOnly ? '' : `<button type="button" class="cpaIconBtn" data-cpa-rule-edit title="${esc(L('Kuralı düzenle', 'Edit rule'))}" aria-label="${esc(L('Kuralı düzenle', 'Edit rule'))}"><svg class="ic"><use href="#i-pencil"/></svg></button>
          ${rule.managed === true ? '' : `<button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-rule-delete title="${esc(L('Yalnız benden sil', 'Delete only for me'))}" aria-label="${esc(L('Yalnız benden sil', 'Delete only for me'))}"><svg class="ic"><use href="#i-trash"/></svg></button>`}`}
        </div>
      </header>
      ${body}
    </div>`;
  }

  /* ------------------------------------- 3 sekmeli Kontrol & Kurallar Merkezi */
  function openRules() { openRuleManager('priority'); }
  function openSettings() { openRuleManager('checklist'); }
  function openChecklist(itemId) { openStudio('queue', { itemId: String(itemId || '') }); }
  function openRuleManager(kind, options) {
    const tab = kind === 'checklist' ? 'checklist' : kind === 'queue' ? 'queue' : 'priority';
    openStudio(tab, options);
  }

  /* ------------------------------------ Öncelik Etiket Kataloğu CRUD (Kişisel + Yayın) */
  function addPriorityTag(spec) {
    if ((state.priorityCatalog || []).filter(item => !item.builtIn).length >= 35) throw new Error(L('En fazla 35 özel öncelik etiketi eklenebilir.', 'You can add up to 35 custom priority tags.'));
    const rawTr = String(spec && (spec.tr || spec.name) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!rawTr) throw new Error(L('Öncelik etiketi adı boş olamaz.', 'Priority tag label cannot be empty.'));
    const rawEn = String(spec && spec.en || '').replace(/\s+/g, ' ').trim().slice(0, 80) || rawTr;
    const tone = OD && typeof OD.normalizePriorityTone === 'function'
      ? OD.normalizePriorityTone(spec && spec.tone, 'copper')
      : (TONE_IDS.includes(spec && spec.tone) ? spec.tone : 'copper');
    const usage = spec?.usage === 'tracking' ? 'tracking' : 'priority';
    const isRisk = usage === 'tracking' ? false : (!spec || spec.isRisk !== false);
    const existingIds = [
      ...(state.personalPriorityCatalog || []).map(item => item.id),
      ...(state.priorityCatalog || []).map(item => item.id),
    ];
    const desiredId = spec && spec.id && String(spec.id).startsWith('prio:') ? String(spec.id) : '';
    const id = desiredId && !existingIds.includes(desiredId)
      ? desiredId
      : (OD && typeof OD.makePriorityId === 'function'
        ? OD.makePriorityId(rawEn || rawTr, existingIds)
        : `prio:${rawTr.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom'}`);
    const entry = { id, tr: rawTr, en: rawEn, tone, isRisk, ...(usage === 'tracking' ? { usage } : {}), builtIn: false };
    const nextList = (state.personalPriorityCatalog || defaultCatalog()).slice();
    const watchIdx = nextList.findIndex(item => item.id === 'WATCH' || item.id === 'ON_TRACK');
    if (watchIdx >= 0) nextList.splice(watchIdx, 0, entry);
    else nextList.push(entry);
    state.personalPriorityCatalog = OD && typeof OD.normalizePriorityCatalog === 'function'
      ? OD.normalizePriorityCatalog(nextList)
      : nextList;
    applyRuleLayers(personalRuleList());
    savePrefs();
    recompute();
    render();
    return (state.priorityCatalog || []).find(item => item.id === id) || entry;
  }

  function updatePriorityTag(id, patch) {
    const tagId = String(id || '').trim();
    if (!tagId) return null;
    const tr = String(patch && (patch.tr ?? patch.name) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!tr) throw new Error(L('Öncelik etiketi adı boş olamaz.', 'Priority tag label cannot be empty.'));
    const en = String(patch && patch.en || '').replace(/\s+/g, ' ').trim().slice(0, 80) || tr;
    const tone = OD && typeof OD.normalizePriorityTone === 'function'
      ? OD.normalizePriorityTone(patch && patch.tone, 'copper')
      : (TONE_IDS.includes(patch && patch.tone) ? patch.tone : 'copper');
    const usage = patch?.usage === 'tracking' ? 'tracking' : 'priority';
    const isRisk = usage === 'tracking' ? false : (!patch || patch.isRisk !== false);
    const currentList = (state.personalPriorityCatalog || defaultCatalog()).slice();
    let found = false;
    const updated = currentList.map(item => {
      if (item.id !== tagId || item.builtIn) return item;
      found = true;
      return { ...item, tr, en, tone, isRisk, usage };
    });
    if (!found) {
      const managedExisting = (state.priorityCatalog || []).find(item => item.id === tagId && !item.builtIn);
      if (!managedExisting) return null;
      updated.push({ id: tagId, tr, en, tone, isRisk, usage, builtIn: false });
    }
    state.personalPriorityCatalog = OD && typeof OD.normalizePriorityCatalog === 'function'
      ? OD.normalizePriorityCatalog(updated)
      : updated;
    applyRuleLayers(personalRuleList());
    savePrefs();
    recompute();
    render();
    return (state.priorityCatalog || []).find(item => item.id === tagId) || null;
  }

  function movePriorityTag(id, direction) {
    const tagId = String(id || '').trim();
    if (!tagId || tagId === 'ON_TRACK') return false;
    const tracking = (state.priorityCatalog || []).filter(item => item.usage === 'tracking');
    const base = (state.priorityCatalog || defaultCatalog()).filter(item => item.usage !== 'tracking').map(item => ({ ...item }));
    const idx = base.findIndex(item => item.id === tagId);
    if (idx < 0) return false;
    const delta = direction === 'up' ? -1 : 1;
    const targetIdx = idx + delta;
    const maxMovableIdx = Math.max(0, base.findIndex(item => item.id === 'ON_TRACK') - 1);
    if (targetIdx < 0 || targetIdx > (maxMovableIdx >= 0 ? maxMovableIdx : base.length - 1)) return false;
    const [moved] = base.splice(idx, 1);
    base.splice(targetIdx, 0, moved);
    state.personalPriorityCatalog = OD && typeof OD.normalizePriorityCatalog === 'function'
      ? OD.normalizePriorityCatalog([...base.slice(0, -1), ...tracking, base.at(-1)].map(({ managed, ...rest }) => rest))
      : base;
    applyRuleLayers(personalRuleList());
    savePrefs();
    recompute();
    render();
    return true;
  }

  function deletePriorityTag(id, fallbackTarget) {
    const tagId = String(id || '').trim();
    const targetEntry = (state.priorityCatalog || []).find(item => item.id === tagId);
    if (!targetEntry || targetEntry.builtIn) return false;
    const safeFallback = String(fallbackTarget || 'ACTION_THIS_WEEK').trim() || 'ACTION_THIS_WEEK';
    state.personalPriorityCatalog = (state.personalPriorityCatalog || defaultCatalog()).filter(item => item.id !== tagId);
    const nextPersonalRules = personalRuleList().map(rule => (rule.kind === 'priority' && rule.target === tagId
      ? (targetEntry.usage === 'tracking' ? { ...rule, enabled: false } : { ...rule, target: safeFallback })
      : rule));
    if (state.activePriority === tagId) state.activePriority = 'ALL';
    applyRuleLayers(nextPersonalRules);
    savePrefs();
    recompute();
    render();
    return true;
  }

  let closeActiveStudio = null;
  function openStudio(initialTab, studioOptions) {
    if (closeActiveStudio && closeActiveStudio() === false) return;
    const opts = studioOptions && typeof studioOptions === 'object' ? studioOptions : {};
    if (Array.isArray(opts.rows) && opts.rows !== lastRows) {
      lastRows = opts.rows;
      recompute();
    } else if (!state.model && lastRows) {
      recompute();
    }
    refreshFieldCatalog();
    document.querySelectorAll('.cpaRulesOverlay,.cpaStudioOverlay,.cpaChecklistModalOverlay').forEach(el => el.remove());

    let remembered = {};
    try { remembered = JSON.parse(store.get(QUEUE_VIEW_KEY) || '{}') || {}; } catch (_) {}
    let activeTab = ['queue', 'priority', 'checklist'].includes(initialTab) ? initialTab : 'queue';
    let qItemId = String(opts.itemId ?? remembered.itemId ?? 'ALL') || 'ALL';
    let qScope = ['openRejected', 'overdue', 'rejected', 'all'].includes(opts.scope ?? remembered.scope) ? (opts.scope ?? remembered.scope) : 'openRejected';
    let qSupplier = String(opts.supplier ?? remembered.supplier ?? 'ALL').slice(0, 160);
    let qSearch = String(opts.search ?? remembered.search ?? '').slice(0, 200);
    let qLimit = 120;
    const selectedQueueKeys = new Set();
    let bulkStatus = 'approved';
    let bulkNote = '';

    let prioEditor = opts.openPriorityCreator
      ? { mode: 'create', id: '', tr: '', en: '', tone: 'copper', isRisk: true, pendingRuleId: '' }
      : null;
    let statusEditor = null;
    let catalogOpen = false;

    let expandedRuleId = String(opts.ruleId || '');
    const ruleSearch = { priority: '', checklist: '' };
    const ruleFilter = { priority: 'all', checklist: 'all' };
    const selectedRules = { priority: '', checklist: '' };
    const manualEditors = new Set();
    let ruleAssistant = null;
    let statusTimer = 0;
    let debounceTimer = 0;
    const uiModes = new Map();
    const aiDrafts = new Map();
    const advancedConditions = new Set();

    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaRulesOverlay cpaStudioOverlay';
    modal.dataset.uiMigrated = 'cp-assistant';
    document.body.appendChild(modal);

    let activeValuePicker = null;
    let activeValueMenu = null;
    let valuePositionRaf = 0;
    let backdropPointerStarted = false;
    let releaseKeyboard = () => {};
    const valueMenuSafeMargin = 12;
    const valueMenuGap = 4;
    const setValuePickerExpanded = (picker, expanded, menu) => {
      if (!picker) return;
      const id = menu && menu.id;
      picker.querySelectorAll('[data-cpa-value-toggle], [data-cpa-cond-value], [data-cpa-field-toggle]').forEach(el => {
        el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (id) el.setAttribute('aria-controls', id);
        else el.removeAttribute('aria-controls');
      });
    };

    const positionValueMenu = () => {
      valuePositionRaf = 0;
      const picker = activeValuePicker;
      const menu = activeValueMenu;
      if (!picker || !menu || !picker.isConnected || !menu.isConnected) {
        closeValueMenu();
        return;
      }
      const rect = picker.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        closeValueMenu();
        return;
      }
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
      const maxViewportWidth = Math.max(120, viewportWidth - valueMenuSafeMargin * 2);
      const width = Math.min(Math.max(rect.width, Math.min(320, maxViewportWidth)), 620, maxViewportWidth);
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - valueMenuSafeMargin - valueMenuGap);
      const spaceAbove = Math.max(0, rect.top - valueMenuSafeMargin - valueMenuGap);
      const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(72, openAbove ? spaceAbove : spaceBelow);
      const menuMaxHeight = Math.min(360, availableHeight);
      const optionMaxHeight = Math.max(48, menuMaxHeight - 50);

      menu.hidden = false;
      menu.style.visibility = 'hidden';
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${menuMaxHeight}px`;
      menu.style.setProperty('--cpa-value-options-max-height', `${optionMaxHeight}px`);
      menu.style.left = '0px';
      menu.style.top = '0px';

      const measuredHeight = Math.min(menu.getBoundingClientRect().height || menuMaxHeight, menuMaxHeight);
      const maxLeft = Math.max(valueMenuSafeMargin, viewportWidth - width - valueMenuSafeMargin);
      const left = Math.max(valueMenuSafeMargin, Math.min(rect.left, maxLeft));
      let top = openAbove
        ? rect.top - valueMenuGap - measuredHeight
        : rect.bottom + valueMenuGap;
      top = Math.max(valueMenuSafeMargin, Math.min(top, viewportHeight - measuredHeight - valueMenuSafeMargin));

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.visibility = '';
      menu.dataset.placement = openAbove ? 'top' : 'bottom';
    };

    const scheduleValueMenuPosition = () => {
      if (!activeValueMenu || valuePositionRaf) return;
      valuePositionRaf = requestAnimationFrame(positionValueMenu);
    };

    function closeValueMenu(options = {}) {
      const picker = activeValuePicker;
      const menu = activeValueMenu;
      if (valuePositionRaf) {
        cancelAnimationFrame(valuePositionRaf);
        valuePositionRaf = 0;
      }
      activeValuePicker = null;
      activeValueMenu = null;
      if (!menu) return;
      setValuePickerExpanded(picker, false, menu);
      menu.hidden = true;
      menu.style.cssText = '';
      menu.removeAttribute('data-placement');
      if (options.remove || !picker || !picker.isConnected) menu.remove();
      else picker.appendChild(menu);
    }

    const onValueViewportChange = () => scheduleValueMenuPosition();
    const onValueOutsidePointer = event => {
      if (!activeValueMenu) return;
      if (activeValueMenu.contains(event.target) || (activeValuePicker && activeValuePicker.contains(event.target))) return;
      closeValueMenu();
    };
    const onValueEscape = event => {
      if (event.key !== 'Escape'||[...document.querySelectorAll('.cpaModalOverlay')].at(-1)!==modal) return;
      if(!activeValueMenu){event.preventDefault();closeStudio();return;}
      event.preventDefault();
      event.stopPropagation();
      const toggle = activeValuePicker && activeValuePicker.querySelector('[data-cpa-value-toggle], [data-cpa-field-toggle]');
      closeValueMenu();
      if (toggle) toggle.focus();
    };

    const scrollToRule = id => requestAnimationFrame(() => {
      const row = modal.querySelector(`[data-cpa-rule="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
      row?.querySelector('[data-lcwai-request]')?.focus();
    });
    function openValueMenu(picker, menu) {
      closeValueMenu();
      activeValuePicker = picker;
      activeValueMenu = menu;
      menu.id = `cpa-value-menu-${Date.now()}`;
      menu.dataset.uiMigrated = 'cp-assistant';
      setValuePickerExpanded(picker, true, menu);
      document.body.appendChild(menu);
      positionValueMenu();
      setTimeout(() => { if (activeValueMenu === menu) menu.querySelector('[data-cpa-value-search]')?.focus(); }, 0);
    }
    function menuKeyboard(event) {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const options = [...activeValueMenu.querySelectorAll('button[data-cpa-value-option],input[data-cpa-value-option],button[data-cpa-field-option]')].filter(el => !el.disabled);
      if (!options.length) return;
      const current = options.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, current + 1) : Math.max(0, current < 0 ? options.length - 1 : current - 1);
      event.preventDefault(); options[next].focus();
    }
    const ruleDrafts = new Map(), draftBases = new Map(), invalidRuleDrafts = new Map();
    let lastRuleApply = null, applyingRules = false;
    const cloneRule = rule => JSON.parse(JSON.stringify(rule));
    const ruleSignature = rule => rule ? JSON.stringify(Rules.normalizeRule(rule, { kind: rule.kind, priorityCatalog: state.priorityCatalog })) : '';
    const isDirtyRule = rule => ruleSignature(rule) !== ruleSignature(state.rules.find(item => item.id === rule.id));
    const dirtyRules = () => [...ruleDrafts.values()].filter(isDirtyRule);
    const allDraftRules = () => [...state.rules.map(rule => ruleDrafts.get(rule.id) || rule), ...[...ruleDrafts.values()].filter(rule => !state.rules.some(item => item.id === rule.id))];
    const rulesFor = kind => allDraftRules().filter(rule => rule.kind === kind);
    function rememberQueueView() {
      try { const value = JSON.stringify({ itemId: qItemId, scope: qScope, supplier: qSupplier, search: qSearch }); if (store.get(QUEUE_VIEW_KEY) !== value) store.set(QUEUE_VIEW_KEY, value); }
      catch (error) { setStatus(error.message, 'warn'); }
    }
    function stageRuleChange(rule) {
      const dirty = dirtyRules().length;
      setStatus(dirty ? L(`${dirty} kural taslağı · Kaydetmeyi bekliyor`, `${dirty} rule drafts · Awaiting save`) : '', '');
      syncRuleSummaryDom(modal.querySelector(`[data-cpa-rule="${CSS.escape(rule.id)}"]`), rule);
      const apply = modal.querySelector('[data-cpa-apply-drafts]'); if (apply) apply.disabled = applyingRules || !dirty;
      const discard = modal.querySelector('[data-cpa-discard-drafts]'); if (discard) { discard.disabled = applyingRules || !dirty; discard.hidden = !dirty; }
      const undo = modal.querySelector('[data-cpa-undo-rules]'); if (undo) undo.disabled = applyingRules || !!dirty;
    }
    async function applyDrafts() {
      if (applyingRules) return;
      clearTimeout(debounceTimer); debounceTimer = 0;
      const changes = dirtyRules().map(cloneRule);
      if (!changes.length) return;
      if (invalidRuleDrafts.size) { setStatus(L('Geçersiz formül düzeltilmeden taslaklar uygulanamaz.', 'Correct the invalid formula before applying drafts.'), 'warn'); return; }
      for (const rule of changes) {
        const current = state.rules.find(item => item.id === rule.id);
        if (ruleSignature(current) !== draftBases.get(rule.id)) { setStatus(L('Kural başka bir işlemde değişti; taslağı iptal edip güncel kuralı açın.', 'The rule changed elsewhere; discard this draft and reopen the current rule.'), 'warn'); return; }
        if (rule.managed && !isModerator()) return;
        const check = Rules.validateRule(rule, { fields: formulaFieldIds(rule) });
        if (!check.valid) { expandedRuleId = rule.id; draw(); setStatus(L('Kural uygulanamadı: ', 'Cannot apply rule: ') + check.errors.join(' · '), 'warn'); return; }
      }
      const before = changes.map(rule => ({ id: rule.id, rule: state.rules.find(item => item.id === rule.id) ? cloneRule(state.rules.find(item => item.id === rule.id)) : null }));
      let failure;
      applyingRules = true; draw();
      try {
        const published = new Map(changes.filter(rule => rule.managed).map(rule => [rule.id, rule]));
        if (published.size) {
          clearTimeout(managedSyncTimer);
          await saveManagedRules({ rules: state.managed.rules.map(rule => published.get(rule.id) || rule), deletedRuleIds: state.managed.deletedRuleIds });
        }
        const previous = state.rules;
        const byId = new Map(changes.map(rule => [rule.id, rule]));
        state.rules = [...previous.map(rule => byId.get(rule.id) || rule), ...changes.filter(rule => !previous.some(item => item.id === rule.id))].map(rule => Rules.normalizeRule(rule, { kind: rule.kind, priorityCatalog: state.priorityCatalog }));
        try { commit({ refreshColumns: changes.some(rule => rule.kind === 'checklist'), message: L('Kural değişiklikleri uygulandı', 'Rule changes applied') }); }
        catch (error) { state.rules = previous; throw error; }
        lastRuleApply = { before, after: new Map(changes.map(rule => [rule.id, ruleSignature(state.rules.find(item => item.id === rule.id))])) };
        for (const submitted of changes) {
          if (ruleSignature(ruleDrafts.get(submitted.id)) === ruleSignature(submitted)) { ruleDrafts.delete(submitted.id); draftBases.delete(submitted.id); }
          else draftBases.set(submitted.id, ruleSignature(state.rules.find(rule => rule.id === submitted.id)));
        }
      } catch (error) { failure = error; }
      finally {
        applyingRules = false;
        if (modal.isConnected) { draw(); setStatus(failure ? failure.message : L('Kural değişiklikleri uygulandı', 'Rule changes applied'), failure ? 'warn' : 'ok'); }
      }
    }
    async function undoRuleApply() {
      if (applyingRules || !lastRuleApply || dirtyRules().length) return;
      for (const [id, signature] of lastRuleApply.after) if (ruleSignature(state.rules.find(rule => rule.id === id)) !== signature) { setStatus(L('Daha yeni kural değişikliği var; geri alma uygulanmadı.', 'A newer rule change exists; undo was not applied.'), 'warn'); return; }
      const undo = lastRuleApply;
      let failure;
      applyingRules = true; draw();
      try {
        const published = new Map(undo.before.filter(item => item.rule?.managed).map(item => [item.id, item.rule]));
        if (published.size) {
          clearTimeout(managedSyncTimer);
          await saveManagedRules({ rules: state.managed.rules.map(rule => published.get(rule.id) || rule), deletedRuleIds: state.managed.deletedRuleIds });
        }
        const previous = state.rules;
        const ids = new Set(undo.before.map(item => item.id));
        state.rules = [...state.rules.filter(rule => !ids.has(rule.id)), ...undo.before.map(item => item.rule).filter(Boolean)];
        try { commit({ refreshColumns: true, message: L('Son kural değişikliği geri alındı', 'Last rule change undone') }); }
        catch (error) { state.rules = previous; throw error; }
        lastRuleApply = null; ruleDrafts.clear(); draftBases.clear(); invalidRuleDrafts.clear();
      } catch (error) { failure = error; }
      finally {
        applyingRules = false;
        if (modal.isConnected) { draw(); setStatus(failure ? failure.message : L('Son kural değişikliği geri alındı', 'Last rule change undone'), failure ? 'warn' : 'ok'); }
      }
    }
    function modeOf(rule) {
      return uiModes.get(rule.id) || (rule.mode === 'formula' ? 'formula' : 'basic');
    }
    function aiDraftOf(rule) {
      if (!aiDrafts.has(rule.id)) {
        aiDrafts.set(rule.id, {
          request: '', answer: '', error: '', applied: '',
          purpose: rule.kind === 'checklist' && rule.autoStatus ? 'auto' : 'question',
          autoStatus: rule.autoStatus || 'approved',
        });
      }
      return aiDrafts.get(rule.id);
    }
    const conditionHasAdvancedData = condition => {
      if (!condition) return false;
      const leftOffset = condition.left && condition.left.offset;
      const right = condition.right || {};
      return Boolean((leftOffset && (Number(leftOffset.value) || leftOffset.field))
        || (condition.left && condition.left.offsetField)
        || (right.type && right.type !== 'value')
        || (right.offset && (Number(right.offset.value) || right.offset.field))
        || right.offsetField);
    };
    const isAdvanced = (rule, index, condition) =>
      advancedConditions.has(`${rule.id}:${index}`) || conditionHasAdvancedData(condition);
    const view = { get expandedRuleId() { return expandedRuleId; }, modeOf, aiDraftOf, isAdvanced, isDirty: isDirtyRule, isManualOpen: rule => manualEditors.has(rule.id) };

    function setStatus(message, tone) {
      const node = modal.querySelector('[data-cpa-rules-status]');
      if (!node) return;
      clearTimeout(statusTimer);
      node.textContent = message || '';
      node.dataset.tone = tone || '';
      if (message) statusTimer = setTimeout(() => {
        if (node.isConnected) { node.textContent = ''; node.dataset.tone = ''; }
      }, 2800);
    }

    function commit(options) {
      const o = options || {};
      savePrefs();
      scheduleManagedSync();
      refreshFieldCatalog();
      recompute();
      render();
      if (o.refreshColumns) {
        try { window.BLChecklistSupplierSync?.refreshColumns?.({ render: true }); } catch (_) {}
      }
      setStatus(o.message || L('Kaydedildi', 'Saved'), o.tone || 'ok');
    }

    function queueBuckets() {
      if (!state.checklistSettings.enabled || !state.checklist) return [];
      return state.checklist.items || [];
    }

    function buildQueueEntries() {
      const buckets = queueBuckets();
      if (qItemId !== 'ALL' && !buckets.some(b => b.id === qItemId)) qItemId = 'ALL';
      const activeBuckets = qItemId === 'ALL' ? buckets : buckets.filter(b => b.id === qItemId);
      const suppliers = new Set();
      const entries = [];
      const needle = qSearch.trim().toLocaleLowerCase(locale());
      const answerContext = { answers: state.answers, plmEvidence, itemScopes: Object.fromEntries(state.rules.filter(rule => rule.kind === 'checklist').map(rule => [rule.id, rule.approvalScope])) };
      for (const bucket of activeBuckets) {
        const pool = bucket.allOrders || bucket.orders || [];
        const bLabel = itemLabel(bucket);
        for (const analysis of pool) {
          if (!analysis || !analysis.orderKey) continue;
          const supplier = String(analysis.dims && analysis.dims.manufacturer || '—');
          suppliers.add(supplier);
          const parts = Checklist.componentsFor(analysis, { answers: state.answers });
          const stateCode = analysis.checklistState?.[bucket.id] || Checklist.statusOf(analysis, bucket.id, answerContext);
          const resolved = Checklist.isResolved(stateCode);
          const overdue = !resolved && analysis.daysToLoad != null && Number(analysis.daysToLoad) <= 7;
          if (qScope === 'openRejected' && resolved) continue;
          if (qScope === 'overdue' && !overdue) continue;
          if (qScope === 'rejected' && stateCode !== 'rejected') continue;
          if (qSupplier !== 'ALL' && supplier !== qSupplier) continue;
          if (needle) {
            const hay = `${analysis.orderCode || ''} ${analysis.modelName || ''} ${analysis.colourCode || ''} ${supplier} ${bLabel}`.toLocaleLowerCase(locale());
            if (!hay.includes(needle)) continue;
          }
          const rowKey = `${analysis.orderKey}::${bucket.id}`;
          entries.push({ rowKey, analysis, bucket, itemId: bucket.id, bucketLabel: bLabel, supplier, parts, stateCode, resolved, overdue });
        }
      }
      if (qSupplier !== 'ALL' && !suppliers.has(qSupplier)) { qSupplier = 'ALL'; return buildQueueEntries(); }
      entries.sort((a, b) => {
        if (a.stateCode === 'rejected' && b.stateCode !== 'rejected') return -1;
        if (b.stateCode === 'rejected' && a.stateCode !== 'rejected') return 1;
        const da = a.analysis.daysToLoad == null ? 9999 : Number(a.analysis.daysToLoad);
        const db = b.analysis.daysToLoad == null ? 9999 : Number(b.analysis.daysToLoad);
        if (da !== db) return da - db;
        return String(a.analysis.orderCode || '').localeCompare(String(b.analysis.orderCode || ''), locale());
      });
      return { buckets, suppliers: [...suppliers].sort((a, b) => a.localeCompare(b, locale())), entries, answerContext };
    }

    function queueTabHtml() {
      if (!state.checklistSettings.enabled) {
        return `<div class="cpaStudioEmptyBox">
          <b>${esc(L('Kontrol listesi şu an kapalı', 'Checklist is currently turned off'))}</b>
          <p class="cpaNote">${esc(L('Sipariş kontrollerini ve tedarikçi takibini açmak için Kontrol Soruları sekmesinden etkinleştirin.', 'Enable it in Checklist Questions to track order checks and supplier responses.'))}</p>
          <button type="button" class="cpaBtn primary" data-cpa-studio-tab="checklist">${esc(L('Kontrol Sorularına Git', 'Go to Checklist Questions'))}</button>
        </div>`;
      }
      if (!state.model || !state.checklist) {
        return `<div class="cpaStudioEmptyBox">
          <b>${esc(L('Henüz CP sipariş verisi yüklenmedi', 'CP order data is not loaded yet'))}</b>
          <p class="cpaNote">${esc(L('Kritik Yol (CP) veya Genel Bakış verisi yüklendiğinde açık kontroller burada listelenir. Öncelik etiketlerini ve kuralları şimdiden düzenleyebilirsiniz.', 'Open checks appear here once Critical Path (CP) or Overview data is loaded. You can configure priority tags and rules right away.'))}</p>
        </div>`;
      }
      const { buckets, suppliers, entries, answerContext } = buildQueueEntries();
      for (const key of [...selectedQueueKeys]) {
        if (!entries.some(item => item.rowKey === key)) selectedQueueKeys.delete(key);
      }
      const shown = entries.slice(0, qLimit);
      const allShownSelected = shown.length > 0 && shown.every(item => selectedQueueKeys.has(item.rowKey));
      const statusOpts = Checklist.statusIds().map(id =>
        `<option value="${esc(id)}"${bulkStatus === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('');
      const questionPills = `<button type="button" class="cpaQuestionPill${qItemId === 'ALL' ? ' is-on' : ''}" data-cpa-q-item="ALL">${esc(L('Tümü', 'All'))} <b>${int(buckets.reduce((s, b) => s + (b.rows || 0), 0))}</b></button>`
        + buckets.map(bucket => `<button type="button" class="cpaQuestionPill${qItemId === bucket.id ? ' is-on' : ''}" data-cpa-q-item="${esc(bucket.id)}">${esc(itemLabel(bucket))} <b>${int(bucket.rows || 0)}</b></button>`).join('');

      const rowsHtml = shown.map(entry => {
        const { analysis, itemId, bucketLabel, supplier, parts, stateCode } = entry;
        const isSetUnconfigured = Checklist.Components.isSet(analysis.sourceRow || analysis, 'cp') && !parts.length;
        let statusControl = '';
        if (isSetUnconfigured) {
          statusControl = `<div class="cpaSetPartsInline"><span>${esc(L('Set parça sayısı:', 'Set parts:'))}</span>${[2, 3, 4].map(n =>
            `<button type="button" class="cpaBtn sm" data-cpa-set-parts="${esc(analysis.orderKey)}:${n}">${n}</button>`).join('')}</div>`;
        } else if (parts.length) {
          statusControl = `<div class="cpaPartSelectList">${parts.map(part => {
            const scopedId = Checklist.Components.itemId(itemId, part.id);
            const partState = Checklist.statusOf(analysis, scopedId, answerContext);
            return `<label class="cpaPartSelectItem"><span>${esc(isEn() ? part.en : part.tr)}</span>
              <select class="cpaQueueStatusSelect tone-${esc(statusToneOf(partState))}" data-cpa-queue-status="${esc(entry.rowKey)}" data-cpa-order-key="${esc(analysis.orderKey)}" data-cpa-item-id="${esc(scopedId)}">
                ${Checklist.statusIds().map(id => `<option value="${esc(id)}"${partState === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('')}
              </select></label>`;
          }).join('')}</div>`;
        } else {
          statusControl = `<select class="cpaQueueStatusSelect tone-${esc(statusToneOf(stateCode))}" data-cpa-queue-status="${esc(entry.rowKey)}" data-cpa-order-key="${esc(analysis.orderKey)}" data-cpa-item-id="${esc(itemId)}">
            ${Checklist.statusIds().map(id => `<option value="${esc(id)}"${stateCode === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('')}
          </select>`;
        }
        const ans = state.answers[Checklist.answerKey(analysis.orderKey, itemId)] || {};
        const hasEvidence = Boolean(ans.note || ans.reportNumber || ans.actualDate || (Array.isArray(ans.attachments) && ans.attachments.length));
        const prioTone = priorityToneOf(analysis.priority);
        const days = analysis.daysToLoad;
        return `<tr data-cpa-queue-row="${esc(entry.rowKey)}">
          <td class="chk"><input type="checkbox" data-cpa-queue-check="${esc(entry.rowKey)}" ${selectedQueueKeys.has(entry.rowKey) ? 'checked' : ''} aria-label="${esc(analysis.orderCode || '')}"></td>
          <td><b>${esc(analysis.orderCode || '—')}</b><small>${esc([analysis.modelName, analysis.colourCode].filter(Boolean).join(' · ') || '—')}</small></td>
          <td>${esc(supplier)}</td>
          <td><span class="cpaPill tone-blue">${esc(bucketLabel)}</span></td>
          <td class="num${days != null && days <= 7 ? ' is-urgent' : ''}">${days == null ? '—' : int(days)}</td>
          <td><span class="cpaPill tone-${esc(prioTone)}">${esc(priorityLabel(analysis.priority))}</span>${(analysis.trackingTags || []).map(id => `<span class="cpaPill tone-${esc(priorityToneOf(id))}">${esc(priorityLabel(id))}</span>`).join('')}</td>
          <td>${plmCell(analysis, itemId) || '<span class="cpaNote">—</span>'}</td>
          <td>${statusControl}</td>
          <td class="act">
            <button type="button" class="cpaBtn sm${hasEvidence ? '' : ' ghost'}" data-cpa-queue-evidence="${esc(entry.rowKey)}" title="${esc(ans.note || L('Not, rapor no ve ek dosya', 'Note, report no and attachments'))}">${hasEvidence ? '📎 ' : ''}${esc(L('Not / Ek', 'Note / File'))}</button>
            <button type="button" class="cpaBtn sm ghost" data-cpa-queue-open-cp="${esc(analysis.orderCode || '')}">${esc(L('CP’de Aç', 'Open in CP'))}</button>
          </td>
        </tr>`;
      }).join('');

      return `<div class="cpaStudioQueue">
        <div class="cpaQueueSyncBar">
          <div class="cpaQueueSyncGroup">
            <button type="button" class="cpaBtn sm" data-cpa-sync-excel-export>⇩ ${esc(L('Tedarikçi Excel İndir', 'Export Supplier Excel'))}</button>
            <button type="button" class="cpaBtn sm" data-cpa-sync-excel-import>⇧ ${esc(L('Tedarikçi Excel İçe Aktar', 'Import Supplier Excel'))}</button>
            <button type="button" class="cpaBtn sm" data-cpa-sync-test-report>${esc(L('Test Raporu İçe Aktar', 'Import Test Report'))}</button>
            <button type="button" class="cpaBtn sm ghost" data-cpa-sync-email>✉ ${esc(L('Tedarikçi E-postası', 'Supplier Email'))}</button>
            ${sampleRequests() ? `<button type="button" class="cpaBtn sm ghost" data-cpa-sync-plm>${esc(L('PLM Numune Güncelle', 'Sync PLM Samples'))}</button>` : ''}
          </div>
          <span class="cpaNote">${int(entries.length)} ${esc(L('kontrol satırı', 'check rows'))}</span>
        </div>
        <div class="cpaQuestionPills" role="group" aria-label="${esc(L('Kontrol sorusu filtresi', 'Checklist question filter'))}">${questionPills}</div>
        <div class="cpaQueueFilterBar">
          <input type="search" data-cpa-q-search value="${esc(qSearch)}" placeholder="${esc(L('Sipariş, model, renk veya üretici ara…', 'Search order, style, colour or supplier…'))}" autocomplete="off">
          <select data-cpa-q-scope aria-label="${esc(L('Durum kapsamı', 'Status scope'))}">
            <option value="openRejected"${qScope === 'openRejected' ? ' selected' : ''}>${esc(L('Açık ve Reddedilenler', 'Open & Rejected'))}</option>
            <option value="overdue"${qScope === 'overdue' ? ' selected' : ''}>${esc(L('Geciken / ≤ 7 Gün Kalan', 'Overdue / ≤ 7 Days Left'))}</option>
            <option value="rejected"${qScope === 'rejected' ? ' selected' : ''}>${esc(L('Yalnız Reddedilenler', 'Rejected Only'))}</option>
            <option value="all"${qScope === 'all' ? ' selected' : ''}>${esc(L('Tüm Yanıtlar (Onaylılar dahil)', 'All Answers (incl. Approved)'))}</option>
          </select>
          <select data-cpa-q-supplier aria-label="${esc(L('Üretici filtresi', 'Supplier filter'))}">
            <option value="ALL">${esc(L('Tüm üreticiler', 'All suppliers'))}</option>
            ${suppliers.map(sup => `<option value="${esc(sup)}"${qSupplier === sup ? ' selected' : ''}>${esc(sup)}</option>`).join('')}
          </select>
        </div>
        <div class="cpaBulkBar${selectedQueueKeys.size ? ' is-active' : ''}">
          <label class="cpaCheck"><input type="checkbox" data-cpa-queue-select-all ${allShownSelected ? 'checked' : ''}><span><b>${int(selectedQueueKeys.size)}</b> ${esc(L('seçili', 'selected'))}</span></label>
          <select data-cpa-bulk-status aria-label="${esc(L('Toplu durum', 'Bulk status'))}">${statusOpts}</select>
          <input type="text" data-cpa-bulk-note value="${esc(bulkNote)}" placeholder="${esc(L('Toplu not (opsiyonel)…', 'Bulk note (optional)…'))}">
          <button type="button" class="cpaBtn sm primary" data-cpa-bulk-apply ${selectedQueueKeys.size ? '' : 'disabled'}>${esc(L('Seçililere Uygula', 'Apply to Selected'))}</button>
          ${selectedQueueKeys.size ? `<button type="button" class="cpaBtn sm ghost" data-cpa-bulk-clear>${esc(L('Seçimi temizle', 'Clear'))}</button>` : ''}
        </div>
        ${shown.length ? `<div class="cpaScroll cpaQueueScroll"><table class="cpaTable cpaQueueTable">
          <thead><tr>
            <th class="chk"></th>
            <th>${esc(L('Sipariş / Model', 'Order / Style'))}</th>
            <th>${esc(L('Üretici', 'Supplier'))}</th>
            <th>${esc(L('Kontrol', 'Check'))}</th>
            <th class="num">${esc(L('Yüklemeye Gün', 'Days to Load'))}</th>
            <th>${esc(L('Öncelik / Takip', 'Urgency / Tracking'))}</th>
            <th>PLM</th>
            <th>${esc(L('Durum', 'Status'))}</th>
            <th></th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table></div>` : `<p class="cpaEmpty">${esc(L('Bu filtrede açık kontrol kaydı yok.', 'No check items match this filter.'))}</p>`}
        ${entries.length > shown.length ? `<button type="button" class="cpaBtn" data-cpa-q-more>${esc(L(`Daha fazla göster (${int(entries.length - shown.length)} kaldı)`, `Show more (${int(entries.length - shown.length)} remaining)`))}</button>` : ''}
      </div>`;
    }

    function toneSwatchPicker(selectedTone, attrName) {
      return `<div class="cpaToneSwatches" role="radiogroup" aria-label="${esc(L('Renk tonu', 'Color tone'))}">${TONE_IDS.map(tone => {
        const on = (selectedTone || 'blue') === tone;
        return `<button type="button" class="cpaToneSwatch tone-${esc(tone)}${on ? ' is-on' : ''}" ${attrName}="${esc(tone)}" role="radio" aria-checked="${on ? 'true' : 'false'}" title="${esc(toneLabel(tone))}"><span class="cpaTagDot tone-${esc(tone)}" aria-hidden="true"></span><span>${esc(toneLabel(tone))}</span></button>`;
      }).join('')}</div>`;
    }

    function priorityCatalogHtml() {
      const catalog = state.priorityCatalog || defaultCatalog();
      const byPrio = new Map(((state.model && state.model.priorities) || []).map(item => [item.name, item]));
      const nonTrackMax = Math.max(0, catalog.filter(item => item.usage !== 'tracking').findIndex(item => item.id === 'ON_TRACK') - 1);
      const moderator = isModerator();
      const renderTag = (entry, idx) => {
        const count = entry.usage === 'tracking' ? (state.model?.orders || []).filter(order => order.trackingTags?.includes(entry.id)).length : (byPrio.get(entry.id) || { rows: 0 }).rows || 0;
        const canMove = entry.id !== 'ON_TRACK' && entry.usage !== 'tracking';
        const canUp = canMove && idx > 0;
        const canDown = canMove && idx < nonTrackMax;
        const isManaged = entry.managed === true || (state.managed.priorityCatalog || []).some(m => m.id === entry.id);
        const modBtn = moderator && !entry.builtIn
          ? (isManaged
            ? `<button type="button" class="cpaBtn sm ghost" data-cpa-priority-unpublish="${esc(entry.id)}" title="${esc(L('Yayından kaldır', 'Unpublish'))}">${esc(L('Yayından kaldır', 'Unpublish'))}</button>`
            : `<button type="button" class="cpaBtn sm ghost" data-cpa-priority-publish="${esc(entry.id)}" title="${esc(L('Tüm kullanıcılara yayımla', 'Publish to all users'))}">${esc(L('Yayımla', 'Publish'))}</button>`)
          : '';
        return `<div class="cpaCatalogTagRow" data-cpa-priority-tag="${esc(entry.id)}">
          <span class="cpaTagRank" title="${esc(L('Aciliyet sırası (#1 en acil)', 'Urgency rank (#1 most urgent)'))}">${entry.usage === 'tracking' ? '—' : '#' + (catalog.filter(item => item.usage !== 'tracking').findIndex(item => item.id === entry.id) + 1)}</span>
          <span class="cpaTagDot tone-${esc(entry.tone || 'blue')}" aria-hidden="true"></span>
          <span class="cpaCatalogTagMain" data-no-i18n>
            <b>${esc(isEn() ? (entry.en || entry.tr) : entry.tr)}</b>
            ${entry.en && entry.en !== entry.tr ? `<small>${esc(isEn() ? entry.tr : entry.en)}</small>` : ''}
          </span>
          <span class="cpaCatalogTagBadges">
            ${entry.usage === 'tracking' ? `<span class="cpaBuiltIn">${esc(L('Takip etiketi', 'Tracking tag'))}</span>` : entry.isRisk ? `<span class="cpaBuiltIn">${esc(L('Aksiyon / Risk', 'Action / Risk'))}</span>` : `<span class="cpaBuiltIn">${esc(L('Bilgi / Normal', 'Info / Normal'))}</span>`}
            ${entry.builtIn ? `<span class="cpaBuiltIn">${esc(L('Yerleşik', 'Built-in'))}</span>` : ''}
            ${isManaged ? `<span class="cpaBuiltIn cpaManagedBadge">${esc(L('Tüm kullanıcılar', 'All users'))}</span>` : ''}
            <span class="cpaPill tone-${esc(entry.tone || 'blue')}">${int(count)} ${esc(L('sipariş', 'orders'))}</span>
          </span>
          <div class="cpaCatalogTagActions">
            ${canMove ? `<button type="button" class="cpaIconBtn" data-cpa-priority-move="${esc(entry.id)}:up" ${canUp ? '' : 'disabled'} title="${esc(L('Daha acil yap (yukarı taşı)', 'Make more urgent (move up)'))}" aria-label="${esc(L('Yukarı taşı', 'Move up'))}">↑</button>
              <button type="button" class="cpaIconBtn" data-cpa-priority-move="${esc(entry.id)}:down" ${canDown ? '' : 'disabled'} title="${esc(L('Daha az acil yap (aşağı taşı)', 'Make less urgent (move down)'))}" aria-label="${esc(L('Aşağı taşı', 'Move down'))}">↓</button>` : ''}
            ${!entry.builtIn && (!isManaged || moderator) ? `<button type="button" class="cpaIconBtn" data-cpa-priority-edit="${esc(entry.id)}" title="${esc(L('Etiketi düzenle', 'Edit tag'))}" aria-label="${esc(L('Etiketi düzenle', 'Edit tag'))}"><svg class="ic"><use href="#i-pencil"/></svg></button>` : ''}
            ${modBtn}
            ${!entry.builtIn && !isManaged ? `<button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-priority-delete="${esc(entry.id)}" title="${esc(L('Etiketi sil', 'Delete tag'))}" aria-label="${esc(L('Etiketi sil', 'Delete tag'))}"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
          </div>
        </div>`;
      };
      const rows = catalog.filter(entry => entry.usage !== 'tracking').map(renderTag).join('');
      const trackingRows = catalog.filter(entry => entry.usage === 'tracking').map(renderTag).join('');

      const form = prioEditor ? `<div class="cpaCatalogInlineForm cpaFrame" data-cpa-priority-form>
        <div class="cpaRowBetween">
          <b>${esc(prioEditor.mode === 'edit' ? L('Öncelik Etiketini Düzenle', 'Edit Priority Tag') : L('Yeni Öncelik Durumu Etiketi', 'New Priority Status Tag'))}</b>
          ${prioEditor.pendingRuleId ? `<small class="cpaNote">${esc(L('Kaydedildiğinde kural hedefi olarak otomatik seçilecek.', 'Will be selected automatically as the rule target on save.'))}</small>` : ''}
        </div>
        <div class="cpaCatalogFormGrid">
          <label><span>${esc(L('Etiket adı (Türkçe)', 'Tag label (Turkish)'))}</span>
            <input data-cpa-priority-tr value="${esc(prioEditor.tr)}" placeholder="${esc(L('Örn. Kumaş Bekliyor, Numune Eskalasyon', 'e.g. Waiting Fabric, Sample Escalation'))}" maxlength="80"></label>
          <label><span>${esc(L('İngilizce ad (opsiyonel — boşsa Türkçe kullanılır)', 'English label (optional — falls back to Turkish)'))}</span>
            <input data-cpa-priority-en value="${esc(prioEditor.en)}" placeholder="${esc(L('Örn. Waiting Fabric', 'e.g. Waiting Fabric'))}" maxlength="80"></label>
        </div>
        <label class="cpaRuleTarget"><span>${esc(L('Etiket kullanımı', 'Tag purpose'))}</span><select data-cpa-priority-usage><option value="priority"${prioEditor.usage !== 'tracking' ? ' selected' : ''}>${esc(L('Aciliyet önceliği', 'Urgency priority'))}</option><option value="tracking"${prioEditor.usage === 'tracking' ? ' selected' : ''}>${esc(L('Takip etiketi — aciliyeti değiştirmez', 'Tracking tag — keeps urgency unchanged'))}</option></select></label>
        <div class="cpaCatalogFormToneRow">
          <span>${esc(L('Renk tonu', 'Color tone'))}</span>
          ${toneSwatchPicker(prioEditor.tone, 'data-cpa-priority-tone')}
        </div>
        <div class="cpaRowBetween">
          <label class="cpaCheck"><input type="checkbox" data-cpa-priority-risk ${prioEditor.isRisk !== false ? 'checked' : ''} ${prioEditor.usage === 'tracking' ? 'disabled' : ''}>
            <span>${esc(L('Aksiyon / Risk kapsamında say (Genel Bakış Nabız ve Aksiyon Gerekenler listesine girer)', 'Count as Action / Risk (included in Overview Pulse and Orders Requiring Attention)'))}</span></label>
          <div class="cpaCatalogFormBtns">
            <button type="button" class="cpaBtn sm ghost" data-cpa-priority-cancel>${esc(L('Vazgeç', 'Cancel'))}</button>
            <button type="button" class="cpaBtn sm primary" data-cpa-priority-save>${esc(prioEditor.mode === 'edit' ? L('Güncelle', 'Update') : L('Etiketi Ekle', 'Add Tag'))}</button>
          </div>
        </div>
      </div>` : '';

      return `<section class="cpaCatalogCard cpaFrame" aria-label="${esc(L('Öncelik Durumu Etiketleri', 'Priority Status Tags'))}">
        <div class="cpaRowBetween cpaCatalogHead">
          <div>
            <b>${esc(L('Öncelik Durumu Etiketleri ve Aciliyet Sırası', 'Priority Status Tags & Urgency Order'))}</b>
            <small>${esc(L('Birden fazla kural eşleşirse daha üstteki (#1 en acil) etiket kazanır. En fazla 35 özel etiket ekleyebilirsiniz.', 'When multiple rules match, the higher-ranked tag (#1 most urgent) wins. Add up to 35 custom tags.'))}</small>
          </div>
          <button type="button" class="cpaBtn sm primary" data-cpa-priority-add>+ ${esc(L('Yeni Öncelik Etiketi', 'New Priority Tag'))}</button>
        </div>
        ${form}
        <div class="cpaCatalogList">${rows}</div>${trackingRows ? `<b>${esc(L('Takip etiketleri · aciliyetten bağımsız', 'Tracking tags · separate from urgency'))}</b><div class="cpaCatalogList">${trackingRows}</div>` : ''}
      </section>`;
    }

    function checklistStatusCatalogHtml() {
      const builtInIds = Checklist.BUILTIN_STATUS_IDS || ['open', 'approved', 'rejected', 'notRequired'];
      const customs = Checklist.customStatuses();
      const moderator = isModerator();
      const builtInChips = builtInIds.map(id => `<span class="cpaStatusBadgeChip">
        <span class="cpaTagDot tone-${esc(statusToneOf(id))}" aria-hidden="true"></span>
        <b>${esc(Checklist.statusLabel(id, lang()))}</b>
        ${Checklist.isResolved(id) ? `<small>✓ ${esc(L('Kapatır', 'Resolves'))}</small>` : ''}
      </span>`).join('');
      const customRows = customs.map(entry => {
        const isManaged = entry.managed === true || (state.managed.checklistStatuses || []).some(m => m.id === entry.id);
        const modBtn = moderator
          ? (isManaged
            ? `<button type="button" class="cpaBtn sm ghost" data-cpa-status-unpublish="${esc(entry.id)}">${esc(L('Yayından kaldır', 'Unpublish'))}</button>`
            : `<button type="button" class="cpaBtn sm ghost" data-cpa-status-publish="${esc(entry.id)}">${esc(L('Yayımla', 'Publish'))}</button>`)
          : '';
        return `<div class="cpaCatalogTagRow" data-cpa-custom-status="${esc(entry.id)}">
          <span class="cpaTagDot tone-${esc(entry.tone || 'blue')}" aria-hidden="true"></span>
          <span class="cpaCatalogTagMain" data-no-i18n>
            <b>${esc(isEn() ? (entry.en || entry.tr || entry.name) : (entry.tr || entry.name))}</b>
            ${entry.en && entry.en !== (entry.tr || entry.name) ? `<small>${esc(isEn() ? (entry.tr || entry.name) : entry.en)}</small>` : ''}
          </span>
          <span class="cpaCatalogTagBadges">
            ${entry.resolved ? `<span class="cpaBuiltIn">✓ ${esc(L('Kontrolü kapatır', 'Resolves check'))}</span>` : `<span class="cpaBuiltIn">${esc(L('Açık tutar', 'Keeps open'))}</span>`}
            ${isManaged ? `<span class="cpaBuiltIn cpaManagedBadge">${esc(L('Tüm kullanıcılar', 'All users'))}</span>` : ''}
          </span>
          <div class="cpaCatalogTagActions">
            ${(!isManaged || moderator) ? `<button type="button" class="cpaIconBtn" data-cpa-status-edit="${esc(entry.id)}" title="${esc(L('Durumu düzenle', 'Edit status'))}" aria-label="${esc(L('Durumu düzenle', 'Edit status'))}"><svg class="ic"><use href="#i-pencil"/></svg></button>` : ''}
            ${modBtn}
            ${!isManaged ? `<button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-status-delete="${esc(entry.id)}" title="${esc(L('Durumu sil', 'Delete status'))}" aria-label="${esc(L('Durumu sil', 'Delete status'))}"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}
          </div>
        </div>`;
      }).join('');

      const form = statusEditor ? `<div class="cpaCatalogInlineForm cpaFrame" data-cpa-status-form>
        <b>${esc(statusEditor.mode === 'edit' ? L('Özel Checklist Durumunu Düzenle', 'Edit Custom Checklist Status') : L('Yeni Özel Checklist Durumu', 'New Custom Checklist Status'))}</b>
        <div class="cpaCatalogFormGrid">
          <label><span>${esc(L('Durum adı (Türkçe)', 'Status label (Turkish)'))}</span>
            <input data-cpa-status-tr value="${esc(statusEditor.tr)}" placeholder="${esc(L('Örn. Kargoda, Şartlı Onay, Revize İsteniyor', 'e.g. In Courier, Conditional Pass'))}" maxlength="48"></label>
          <label><span>${esc(L('İngilizce ad (opsiyonel — boşsa Türkçe kullanılır)', 'English label (optional — falls back to Turkish)'))}</span>
            <input data-cpa-status-en value="${esc(statusEditor.en)}" placeholder="${esc(L('Örn. In Courier', 'e.g. In Courier'))}" maxlength="48"></label>
        </div>
        <div class="cpaCatalogFormToneRow">
          <span>${esc(L('Renk tonu', 'Color tone'))}</span>
          ${toneSwatchPicker(statusEditor.tone, 'data-cpa-status-tone')}
        </div>
        <div class="cpaRowBetween">
          <label class="cpaCheck"><input type="checkbox" data-cpa-status-resolved ${statusEditor.resolved ? 'checked' : ''}>
            <span>${esc(L('Bu durum seçildiğinde kontrolü tamamlanmış say (İş Listesi’nden düşür)', 'Treat check as completed when this status is selected'))}</span></label>
          <div class="cpaCatalogFormBtns">
            <button type="button" class="cpaBtn sm ghost" data-cpa-status-cancel>${esc(L('Vazgeç', 'Cancel'))}</button>
            <button type="button" class="cpaBtn sm primary" data-cpa-status-save>${esc(statusEditor.mode === 'edit' ? L('Güncelle', 'Update') : L('Durumu Ekle', 'Add Status'))}</button>
          </div>
        </div>
      </div>` : '';

      return `<section class="cpaCatalogCard cpaFrame" aria-label="${esc(L('Checklist Durum Seçenekleri', 'Checklist Status Options'))}">
        <div class="cpaRowBetween cpaCatalogHead">
          <label class="cpaSwitchRow"><input type="checkbox" data-cpa-checklist-enabled ${state.checklistSettings.enabled ? 'checked' : ''}>
            <span><b>${esc(L('Kontrol Listesi Açık', 'Checklist Enabled'))}</b>
              <small>${esc(L('CP tablosu sütunları, Tedarikçi Excel şablonu ve İş Listesi aktif çalışır.', 'CP table columns, Supplier Excel workbook and Work Queue stay active.'))}</small></span></label>
          <button type="button" class="cpaBtn sm" data-cpa-status-add>+ ${esc(L('Yeni Durum Ekle', 'Add Custom Status'))}</button>
        </div>
        <div class="cpaBuiltInStatusesRow"><span class="cpaNote">${esc(L('Sabit durumlar:', 'Built-in:'))}</span>${builtInChips}</div>
        ${form}
        ${customRows ? `<div class="cpaCatalogList">${customRows}</div>` : `<p class="cpaNote">${esc(L('Henüz özel checklist durumu eklenmedi. Örneğin "Şartlı Onay" veya "Kargoda" ekleyebilirsiniz.', 'No custom checklist statuses yet. For example, add "Conditional Pass" or "In Courier".'))}</p>`}
      </section>`;
    }

    function matchingLibraryRules(kind) {
      const query = ruleSearch[kind].trim().toLocaleLowerCase(locale());
      return rulesFor(kind).filter(rule => (ruleFilter[kind] === 'all'
        || (ruleFilter[kind] === 'enabled' ? rule.enabled : !rule.enabled))
        && (!query || `${ruleName(rule)} ${ruleBadge(rule)}`.toLocaleLowerCase(locale()).includes(query)));
    }

    function ruleLibraryItems(kind) {
      const visible = matchingLibraryRules(kind);
      return visible.map(rule => `<button type="button" class="cpaFrame cpaLibraryItem${expandedRuleId === rule.id ? ' is-on' : ''}" data-cpa-rule-select="${esc(rule.id)}" aria-pressed="${expandedRuleId === rule.id}">
          <span class="cpaLibraryMeta"><span>${esc(rule.enabled ? L('Etkin', 'Active') : L('Kapalı', 'Disabled'))}</span><span class="cpaPill tone-${esc(ruleTone(rule))}">${esc(ruleBadge(rule))}</span></span>
          <b data-cpa-library-name>${esc(ruleName(rule))}</b>
          <small>${esc(rule.mode === 'formula' ? L('Özel koşul', 'Custom condition') : ruleSummary(rule))}</small>
          <span class="cpaLibraryMeta"><span>${esc(rule.managed ? L('Ekip', 'Team') : L('Kişisel', 'Personal'))}</span>${isDirtyRule(rule) ? `<span class="cpaDraftBadge">${esc(L('Taslak', 'Draft'))}</span>` : ''}</span>
        </button>`).join('') || `<p class="cpaEmpty">${esc(L('Sonuç bulunamadı. Aramayı veya filtreyi değiştirin.', 'No results. Change your search or filter.'))}</p>`;
    }

    function refreshRuleLibrary() {
      const list = modal.querySelector('[data-cpa-rule-library]');
      if (!list) return;
      list.innerHTML = ruleLibraryItems(activeTab);
      const count = modal.querySelector('[data-cpa-rule-visible-count]');
      if (count) count.textContent = int(matchingLibraryRules(activeTab).length);
      modal.querySelectorAll('[data-cpa-rule-filter]').forEach(button => {
        const on = button.dataset.cpaRuleFilter === ruleFilter[activeTab];
        button.classList.toggle('is-on', on); button.setAttribute('aria-pressed', String(on));
      });
      bindRuleLibrary();
    }

    function bindRuleLibrary() {
      modal.querySelectorAll('[data-cpa-rule-select]').forEach(button => button.onclick = () => {
        expandedRuleId = button.dataset.cpaRuleSelect;
        selectedRules[activeTab] = expandedRuleId;
        draw();
        modal.querySelector(`[data-cpa-rule-select="${CSS.escape(expandedRuleId)}"]`)?.focus();
        window.BLMotionPlus?.play('card', modal.querySelector('.cpaRuleDetail'));
      });
    }

    function rulesTabHtml(kind) {
      const all = rulesFor(kind);
      const selectedRule = all.find(rule => rule.id === expandedRuleId)
        || all.find(rule => rule.id === selectedRules[kind]) || all[0];
      expandedRuleId = selectedRule?.id || '';
      selectedRules[kind] = expandedRuleId;
      const templates = ruleTemplates(kind);
      const deletedBuiltIns = Rules.DEFAULT_RULES.filter(rule => rule.kind === kind && state.deletedRuleIds.includes(rule.id));
      const deletedGlobal = isModerator() ? (state.managed.deletedRuleIds || []).filter(Boolean) : [];
      const topCatalog = kind === 'priority' ? priorityCatalogHtml() : checklistStatusCatalogHtml();
      const addLabel = kind === 'priority' ? L('LCW AI ile Yeni Kural', 'New Rule with LCW AI') : L('LCW AI ile Yeni Soru', 'New Question with LCW AI');
      return `<div class="cpaStudioRulesPane">
        <div class="cpaRulesTopBar">
          <div><b>${esc(kind === 'priority' ? L('Kurallarınız, tek bir çalışma alanında', 'Your rules, in one workspace') : L('Doğru soruyu, doğru zamanda sorun', 'Ask the right question at the right time'))}</b>
            <small>${esc(L('Soldan bir kayıt seçin veya ne istediğinizi yazarak yeni bir taslak hazırlayın.', 'Select an item on the left or describe what you need to prepare a new draft.'))}</small></div>
          <div class="cpaRulesTopActions">
            <details class="cpaTemplatesMenu"><summary class="cpaBtn sm">${esc(L('Hazır örnekler', 'Ready-made examples'))} ▾</summary>
              <div class="cpaTemplatesPopover">${templates.map(tpl => `<button type="button" class="cpaTemplateChoice" data-cpa-template="${esc(tpl.id)}"><b>${esc(tpl.title)}</b><small>${esc(tpl.hint)}</small></button>`).join('')}</div></details>
            <button type="button" class="cpaBtn primary" data-cpa-new-rule>+ ${esc(addLabel)}</button>
          </div>
        </div>
        <details class="cpaCatalogDisclosure"${catalogOpen || prioEditor || statusEditor ? ' open' : ''}><summary class="cpaBtn cpaCatalogDisclosureSummary">${esc(kind === 'priority' ? L('Etiket ayarları', 'Tag settings') : L('Yanıt durumu ayarları', 'Response status settings'))}<span aria-hidden="true">▾</span></summary>${topCatalog}</details>
        <div class="cpaRuleWorkspace cpaFrame">
          <aside class="cpaRuleLibrary" aria-label="${esc(L('Kayıtlı kurallar', 'Saved rules'))}">
            <div class="cpaLibraryHead"><div class="cpaRowBetween"><b>${esc(kind === 'priority' ? L('Kurallarım', 'My rules') : L('Kontrol sorularım', 'My checklist questions'))}</b><span data-cpa-rule-visible-count>${int(matchingLibraryRules(kind).length)}</span></div>
              <label class="cpaLibrarySearch"><span>${esc(L('Listede ara', 'Search the list'))}</span><input type="search" data-cpa-rule-search value="${esc(ruleSearch[kind])}" placeholder="${esc(L('Kural adı veya etiket…', 'Rule name or tag…'))}"></label>
              <div class="cpaLibraryFilters" role="group" aria-label="${esc(L('Kural durumu', 'Rule status'))}">${[['all', L('Tümü', 'All')], ['enabled', L('Etkin', 'Active')], ['disabled', L('Kapalı', 'Disabled')]].map(([id, label]) => `<button type="button" class="cpaBtn sm${ruleFilter[kind] === id ? ' is-on' : ''}" data-cpa-rule-filter="${id}" aria-pressed="${ruleFilter[kind] === id}">${esc(label)}</button>`).join('')}</div>
            </div>
            <div class="cpaRuleList cpaLibraryList" data-cpa-rule-library>${ruleLibraryItems(kind)}</div>
            <small class="cpaLibraryFoot">${esc(L(`${int(all.length)} kayıt · ${int(all.filter(rule => rule.enabled).length)} etkin`, `${int(all.length)} items · ${int(all.filter(rule => rule.enabled).length)} active`))}</small>
          </aside>
          <section class="cpaRuleDetail" aria-label="${esc(L('Seçilen kuralın ayarları', 'Selected rule settings'))}">${selectedRule ? ruleBlock(selectedRule, view) : `<div class="cpaStudioEmptyBox"><h3>${esc(L('İlk kuralınızı LCW AI ile hazırlayın', 'Prepare your first rule with LCW AI'))}</h3><p class="cpaNote">${esc(L('Yeni Kural düğmesine basın ve ne istediğinizi kendi cümlenizle yazın.', 'Choose New Rule and describe what you need in your own words.'))}</p><button type="button" class="cpaBtn" data-cpa-new-rule>${esc(addLabel)}</button></div>`}</section>
        </div>
        ${deletedBuiltIns.length ? `<div class="cpaRestoreBar"><span class="cpaNote">${esc(L('Gizlenen yerleşik başlıklar:', 'Hidden built-in items:'))}</span>${deletedBuiltIns.map(item => `<button type="button" class="cpaBtn sm ghost" data-cpa-restore-builtin="${esc(item.id)}">↺ ${esc(ruleName(item))}</button>`).join('')}</div>` : ''}
        ${deletedGlobal.length ? `<div class="cpaRestoreBar"><span class="cpaNote">${esc(L('Tüm kullanıcılardan silinen kimlikler:', 'Deleted for all users:'))}</span>${deletedGlobal.map(id => `<button type="button" class="cpaBtn sm ghost" data-cpa-restore-all="${esc(id)}">↺ ${esc(id)}</button>`).join('')}</div>` : ''}
      </div>`;
    }

    const findRule = id => {
      if (ruleDrafts.has(id)) return ruleDrafts.get(id);
      const current = state.rules.find(rule => rule.id === id);
      if (!current) return null;
      const draft = cloneRule(current); ruleDrafts.set(id, draft); draftBases.set(id, ruleSignature(current)); return draft;
    };
    const ruleIdOf = el => el.closest('[data-cpa-rule]')?.dataset.cpaRule || '';

    function syncRuleSummaryDom(row, rule) {
      if (!row || !rule) return;
      const summaryBtn = row.querySelector('.cpaRuleSummary');
      if (summaryBtn) {
        const pill = summaryBtn.querySelector('.cpaPill');
        if (pill) {
          pill.className = `cpaPill tone-${ruleTone(rule)}`;
          pill.textContent = ruleBadge(rule);
        }
        const b = summaryBtn.querySelector('.cpaRuleSummaryMain b');
        if (b) b.textContent = ruleName(rule);
        const sm = summaryBtn.querySelector('.cpaRuleSummaryMain small');
        if (sm) sm.textContent = ruleSummary(rule);
      }
      const plain = row.querySelector('[data-cpa-plain-summary]');
      if (plain) plain.outerHTML = rulePlainSummary(rule);
      refreshRuleLibrary();
      const sentence = row.querySelector('.cpaRuleSentence');
      if (sentence) sentence.textContent = (rule.conditions || []).map(condition => conditionSummary(condition, rule)).join(rule.match === 'any' ? L(' veya ', ' or ') : L(' ve ', ' and ')) + ' → ' + (rule.kind === 'priority' ? ruleBadge(rule) : ruleName(rule));
      const previewNode = row.querySelector('[data-cpa-rule-preview]');
      if (previewNode) previewNode.innerHTML = previewHtml(rule);
    }

    function applyBasicConditions(rule) {
      rule.mode = 'basic';
      rule.expressionVersion = Rules.EXPRESSION_VERSION;
      rule.formula = Rules.conditionsToFormula(rule.conditions, rule.match);
      uiModes.set(rule.id, 'basic');
    }

    function applyFormula(rule, rawFormula) {
      const formula = Rules.formulaFromDisplay(rawFormula, catalogFor(rule));
      rule.mode = 'formula';
      rule.formula = formula;
      rule.expressionVersion = Rules.EXPRESSION_VERSION;
      const synced = Rules.formulaToConditions(formula);
      if (synced) {
        rule.conditions = synced.conditions;
        rule.match = synced.match;
      }
      uiModes.set(rule.id, 'formula');
    }

    function testFormulaInRow(row, rule, silent) {
      const textarea = row.querySelector('[data-cpa-rule-formula]');
      const errorEl = row.querySelector('[data-cpa-formula-error]');
      const statusEl = row.querySelector('[data-cpa-formula-status]');
      const diagEl = row.querySelector('[data-cpa-formula-diagnostics]');
      if (!textarea) return false;
      const raw = Rules.extractFormula(textarea.value);
      const internal = Rules.formulaFromDisplay(raw, catalogFor(rule));
      const check = Rules.validateExpression(internal, { fields: formulaFieldIds(rule) });
      if (!check.valid) {
        invalidRuleDrafts.set(`${rule.id}:formula`, check.errors.join(' · '));
        textarea.setAttribute('aria-invalid', 'true');
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = L('Geçersiz formül: ', 'Invalid formula: ') + check.errors.join(' · '); }
        if (statusEl) statusEl.textContent = '';
        if (diagEl) diagEl.hidden = true;
        return false;
      }
      invalidRuleDrafts.delete(`${rule.id}:formula`); textarea.removeAttribute('aria-invalid');
      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
      const sampleOrder = state.model && Array.isArray(state.model.orders) && state.model.orders[0];
      if (sampleOrder) {
        const sampleEval = Rules.evaluateOrder(sampleOrder, {
          rules: [...state.rules.filter(item => item.id !== rule.id), { ...rule, enabled: true, mode: 'formula', formula: internal }],
          answers: state.answers, plmEvidence, checklistEnabled: state.checklistSettings.enabled,
          priorityCatalog: state.priorityCatalog,
        });
        const sampleMatched = rule.kind === 'checklist'
          ? sampleEval.customItems.some(item => item.id === rule.id)
          : sampleEval.ruleState[rule.id] === 'matched';
        if (diagEl) {
          diagEl.hidden = false;
          diagEl.textContent = L(`Örnek sipariş (${sampleOrder.orderCode || '—'}): ${sampleMatched ? 'EŞLEŞTİ (TRUE)' : 'Eşleşmedi (FALSE)'}`,
            `Sample order (${sampleOrder.orderCode || '—'}): ${sampleMatched ? 'MATCHED (TRUE)' : 'Did not match (FALSE)'}`);
        }
      }
      applyFormula(rule, internal);
      stageRuleChange(rule);
      if (statusEl) statusEl.textContent = L('✓ Geçerli formül', '✓ Valid formula');
      syncRuleSummaryDom(row, rule);
      return true;
    }

    const DERIVED_MEANINGS = Object.fromEntries((Rules.DERIVED_FIELDS || []).filter(item => item.meaning).map(item => [item.id, L(item.meaning.tr, item.meaning.en)]));

    function lcwaiRuleContext(rule) {
      const fields = formulaFieldCatalog(rule).map(item => {
        const entry = { ...item };
        if (DERIVED_MEANINGS[item.id]) entry.meaning = DERIVED_MEANINGS[item.id];
        const values = enumValuesFor(item.id, rule);
        if (values && values.length) entry.allowedValues = values;
        return entry;
      });
      return {
        ruleKind: rule.kind,
        ruleName: ruleName(rule),
        deliveryTarget: state.settings.targetType === 'inStore' ? 'inStore' : 'retail',
        availableFields: fields,
        availablePriorities: selectablePriorityTargets().map(item => ({
          id: item.id,
          label: priorityLabel(item.id),
          usage: item.usage || 'priority',
          isRisk: item.isRisk !== false,
        })),
      };
    }

    function applyAiFormula(rule, formula, draft) {
      if (rule.kind === 'checklist' && draft.purpose === 'auto') {
        rule.autoStatus = Checklist.normalizeStatus(draft.autoStatus || rule.autoStatus || 'approved') || 'approved';
        rule.autoMode = 'formula';
        rule.autoFormula = formula;
      } else applyFormula(rule, formula);
    }

    function renderAiResult(row, rule) {
      const box = row && row.querySelector('[data-cpa-ai-result]');
      if (!box || !rule) return;
      const draft = aiDraftOf(rule);
      if (draft.error) {
        box.innerHTML = `<p class="cpaRuleFieldError">${esc(draft.error)}</p>`;
      } else if (draft.applied) {
        box.innerHTML = `<p class="cpaNote">${esc(draft.applied)}</p>`;
      } else {
        box.innerHTML = '';
      }
    }

    function mountRuleLcwAi(row, rule) {
      const host = row && row.querySelector('[data-cpa-lcwai-host]');
      const AI = window.BuyerLogAI;
      if (!host || !rule) return;
      if (!AI || typeof AI.mountAssistant !== 'function') {
        host.innerHTML = `<p class="cpaNote">${esc(L('LCW AI bileşeni yükleniyor…', 'Loading LCW AI assistant…'))}</p>`;
        if (window.BLPerf && typeof window.BLPerf.ensureFeature === 'function') {
          window.BLPerf.ensureFeature('lcwai').then(() => {
            if (host.isConnected && window.BuyerLogAI) mountRuleLcwAi(row, rule);
          }).catch(() => {});
        }
        return;
      }
      const draft = aiDraftOf(rule);
      ruleAssistant = AI.mountAssistant(host, {
        source: 'rules',
        initialRequest: draft.request,
        onRequestChange: text => { draft.request = text; },
        title: L('LCW AI ile Kural Oluştur', 'Build Rule with LCW AI'),
        placeholder: rule.kind === 'checklist'
          ? L('Örn. Lisanslı modellerde yüklemeye 21 gün kala sorulsun…', 'e.g. Ask for licensed styles when 21 days remain before loading…')
          : L('Örn. Yüklemeye 10 günden az kalan ve PPS onaylanmamış siparişler…', 'e.g. Orders with less than 10 days to load and PPS not approved…'),
        applyLabel: L('Taslağa Ekle', 'Add to Draft'),
        // Shared panel contract: buildRequest(text) → { task, context, guide }.
        // A misnamed hook threw before any request and surfaced only as
        // "The LCW AI request could not be completed"; task is mandatory.
        buildRequest: text => ({
          task: text,
          guide: aiGuideFor(rule.kind, rule, text, draft.purpose === 'auto' ? draft.autoStatus : ''),
          context: {
            ...lcwaiRuleContext(rule),
            ...(rule.kind === 'checklist' ? {
              taskPurpose: draft.purpose === 'auto' ? 'auto_status_assignment' : 'checklist_question',
              autoStatus: draft.purpose === 'auto' ? (draft.autoStatus || rule.autoStatus || 'approved') : '',
            } : {}),
          },
        }),
        interpret: result => {
          const picked = AI.pickField(result, 'formula', Rules.extractFormula);
          if (!picked.value) {
            return { ok: false, explanation: picked.explanation || L('LCW AI geçerli bir formül döndürmedi.', 'LCW AI did not return a valid formula.') };
          }
          const formula = Rules.formulaFromDisplay(Rules.extractFormula(picked.value), catalogFor(rule));
          const check = Rules.validateExpression(formula, { fields: formulaFieldIds(rule) });
          if (!check.valid) {
            return { ok: false, error: L('Geçersiz formül: ', 'Invalid formula: ') + check.errors.join(' · '), code: picked.value };
          }
          const rawPriority = result && result.data && result.data.priority ? String(result.data.priority).trim() : '';
          const validPrio = selectablePriorityTargets().some(item => item.id === rawPriority) ? rawPriority : '';
          const probe = Object.assign(Object.create(Object.getPrototypeOf(rule)), rule, {
            enabled: true,
            ...(rule.kind === 'checklist' && draft.purpose === 'auto'
              ? { autoStatus: draft.autoStatus || 'approved', autoMode: 'formula', autoFormula: formula }
              : { mode: 'formula', formula }),
            ...(validPrio && rule.kind === 'priority' ? { target: validPrio } : {}),
          });
          const preview = rulePreview(probe);
          const display = Rules.formulaToDisplay(formula, catalogFor(rule), lang());
          return {
            ok: true,
            code: display,
            html: rulePlainSummary(probe) + `<div class="cpaRulePreview">${previewHtml(probe)}</div>`,
            explanation: picked.explanation || '',
            summary: preview ? L(`Canlı önizleme: ${int(preview.count)} / ${int(preview.total)} sipariş eşleşiyor.`, `Live preview: matches ${int(preview.count)} / ${int(preview.total)} orders.`) : '',
            value: { formula, priority: validPrio },
          };
        },
        onApply: ({ formula, priority }) => {
          applyAiFormula(rule, formula, draft);
          if (priority && rule.kind === 'priority') rule.target = priority;
          draft.applied = L('LCW AI önerisi taslağa eklendi. Önizlemeyi kontrol edip kaydedin.', 'LCW AI suggestion added to draft. Review the preview and save.');
          draft.error = '';
          stageRuleChange(rule);
          draw();
        },
      });
    }

    function confirmDelete(rule, forAll = false) {
      const dependents = Rules.dependentsOf(rule, state.rules);
      const depNames = dependents.map(item => `"${ruleName(item)}"`).join(', ');
      const scope = forAll
        ? L(`"${ruleName(rule)}" kaydı tüm kullanıcılardan silinsin mi?`, `Delete "${ruleName(rule)}" for all users?`)
        : L(`"${ruleName(rule)}" yalnız sizden silinsin mi?`, `Delete "${ruleName(rule)}" only for you?`);
      const depWarning = dependents.length
        ? `\n\n${L(`Uyarı: Bu başlık şu kuralların koşulunda kullanılıyor (${depNames}); silerseniz o koşullar hiçbir zaman sağlanmaz.`, `Warning: Used in ${depNames}; if deleted, those conditions will never match.`)}`
        : '';
      return typeof confirm === 'function' ? confirm(scope + depWarning) : true;
    }

    function bindRules() {
      bindRuleLibrary();
      modal.querySelector('[data-cpa-rule-search]')?.addEventListener('input', event => {
        ruleSearch[activeTab] = event.target.value.slice(0, 200); refreshRuleLibrary();
      });
      modal.querySelectorAll('[data-cpa-rule-filter]').forEach(button => button.onclick = () => {
        ruleFilter[activeTab] = button.dataset.cpaRuleFilter; refreshRuleLibrary();
      });
      const manual = modal.querySelector('[data-cpa-manual-editor]');
      if (manual) manual.ontoggle = () => {
        if (!manual.isConnected) return;
        if (manual.open) manualEditors.add(ruleIdOf(manual)); else manualEditors.delete(ruleIdOf(manual));
      };
      modal.querySelectorAll('[data-cpa-rule-delete-all]').forEach(el => el.onclick = async () => {
        if (!isModerator()) return;
        const rule = findRule(ruleIdOf(el));
        if (!rule || !confirmDelete(rule, true)) return;
        el.disabled = true;
        try {
          await deleteRuleForAll(rule.id);
          if (typeof expandedRuleId !== 'undefined' && expandedRuleId === rule.id) expandedRuleId = '';
          if (typeof draw === 'function') draw();
        } catch (error) {
          if (typeof showToast === 'function') showToast(error.message);
        } finally {
          el.disabled = false;
        }
      });
      modal.querySelectorAll('[data-cpa-rule-delete]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        if (!confirmDelete(rule)) return;
        ruleDrafts.delete(rule.id); draftBases.delete(rule.id); invalidRuleDrafts.delete(`${rule.id}:formula`); invalidRuleDrafts.delete(`${rule.id}:auto`);
        if (rule.builtIn && !state.deletedRuleIds.includes(rule.id)) state.deletedRuleIds.push(rule.id);
        state.rules = state.rules.filter(item => item.id !== rule.id);
        if (expandedRuleId === rule.id) expandedRuleId = '';
        commit({ message: L('Kural silindi', 'Rule deleted'), refreshColumns: rule.kind === 'checklist' });
        draw();
      });
      modal.querySelectorAll('[data-cpa-cond-add]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.conditions.push(Rules.normalizeCondition({ field: '@daysToLoad', operator: 'lte', value: 14 }));
        applyBasicConditions(rule);
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-rule-toggle],[data-cpa-rule-edit]').forEach(el => el.onclick = () => {
        const id = ruleIdOf(el);
        expandedRuleId = id;
        manualEditors.add(id);
        draw();
        modal.querySelector('[data-cpa-rule-name]')?.focus();
      });

      modal.querySelectorAll('[data-cpa-rule-enabled]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.enabled = Boolean(el.checked);
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-rule-publish]').forEach(el => el.onclick = async () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule || isDirtyRule(rule)) return;
        el.disabled = true;
        try { await publishRuleToAll(rule); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      modal.querySelectorAll('[data-cpa-rule-unpublish]').forEach(el => el.onclick = async () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule || isDirtyRule(rule)) return;
        el.disabled = true;
        try { await unpublishRule(rule.id); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      modal.querySelectorAll('[data-cpa-new-rule]').forEach(el => el.onclick = () => {
        const kind = activeTab === 'checklist' ? 'checklist' : 'priority';
        const fallbackTarget = (selectablePriorityTargets()[0] || { id: 'ACTION_THIS_WEEK' }).id;
        const created = Rules.normalizeRule(kind === 'checklist'
          ? {
            kind: 'checklist',
            name: L('Yeni kontrol sorusu', 'New check question'),
            nameEn: 'New check question',
            tr: L('Yeni kontrol sorusu', 'New check question'),
            en: 'New check question',
            conditions: [
              { field: '@stage', operator: 'in', value: ['PRODUCTION', 'LOADING', 'SHORTAGE'] },
              { field: '@daysToLoad', operator: 'gte', value: -30 },
              { field: '@daysToLoad', operator: 'lte', value: 28 },
            ],
            approvalScope: 'option',
            evidenceFields: { reportNumber: true, actualDate: false, attachments: true },
          }
          : {
            kind: 'priority',
            name: L('Yeni öncelik kuralı', 'New priority rule'),
            nameEn: 'New priority rule',
            target: fallbackTarget,
            conditions: [{ field: '@daysToLoad', operator: 'lte', value: 14 }],
          }, { kind, priorityCatalog: state.priorityCatalog });
        ruleDrafts.set(created.id, created); draftBases.set(created.id, '');
        expandedRuleId = created.id;
        ruleSearch[kind] = ''; ruleFilter[kind] = 'all'; catalogOpen = false; prioEditor = null; statusEditor = null;
        stageRuleChange(created);
        draw();
        scrollToRule(created.id);
      });

      modal.querySelectorAll('[data-cpa-template]').forEach(el => el.onclick = () => {
        const kind = activeTab === 'checklist' ? 'checklist' : 'priority';
        const tpl = ruleTemplates(kind).find(item => item.id === el.dataset.cpaTemplate);
        if (!tpl) return;
        const created = Rules.normalizeRule({ ...tpl.rule, kind }, { kind, priorityCatalog: state.priorityCatalog });
        ruleDrafts.set(created.id, created); draftBases.set(created.id, '');
        expandedRuleId = created.id;
        ruleSearch[kind] = ''; ruleFilter[kind] = 'all'; catalogOpen = false; prioEditor = null; statusEditor = null;
        stageRuleChange(created);
        draw();
        scrollToRule(created.id);
      });

      modal.querySelectorAll('[data-cpa-restore-builtin]').forEach(el => el.onclick = () => {
        const id = el.dataset.cpaRestoreBuiltin;
        state.deletedRuleIds = state.deletedRuleIds.filter(item => item !== id);
        applyRuleLayers(personalRuleList());
        commit({ message: L('Yerleşik başlık geri yüklendi', 'Built-in item restored'), refreshColumns: activeTab === 'checklist' });
        draw();
      });

      modal.querySelectorAll('[data-cpa-restore-all]').forEach(el => el.onclick = async () => {
        const id = el.dataset.cpaRestoreAll;
        el.disabled = true;
        try { await restoreRuleForAll(id); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      const scheduleDebouncedSave = (row, rule) => {
        syncRuleSummaryDom(row, rule);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = 0;
          stageRuleChange(rule);
        }, 320);
      };

      modal.querySelectorAll('[data-cpa-rule-name]').forEach(el => el.oninput = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const val = el.value.slice(0, 160);
        if (isEn()) {
          rule.nameEn = val;
          if (rule.kind === 'checklist') rule.en = val;
          if (!rule.name) rule.name = val;
        } else {
          rule.name = val;
          if (rule.kind === 'checklist') rule.tr = val;
          if (!rule.nameEn) rule.nameEn = val;
          if (rule.kind === 'checklist' && !rule.en) rule.en = val;
        }
        scheduleDebouncedSave(row, rule);
      });

      modal.querySelectorAll('[data-cpa-rule-reason-tr]').forEach(el => el.oninput = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.reasonTr = el.value.slice(0, 200);
        scheduleDebouncedSave(row, rule);
      });

      modal.querySelectorAll('[data-cpa-rule-reason-en]').forEach(el => el.oninput = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.reasonEn = el.value.slice(0, 200);
        scheduleDebouncedSave(row, rule);
      });

      modal.querySelectorAll('[data-cpa-rule-question]').forEach(el => el.oninput = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        if (isEn()) rule.questionEn = el.value.slice(0, 240);
        else rule.questionTr = el.value.slice(0, 240);
        scheduleDebouncedSave(row, rule);
      });

      modal.querySelectorAll('[data-cpa-rule-target]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        if (el.value === '__new__') {
          el.value = rule.target;
          prioEditor = { mode: 'create', id: '', tr: '', en: '', tone: 'copper', isRisk: true, pendingRuleId: rule.id };
          draw();
          modal.querySelector('[data-cpa-priority-tr]')?.focus();
          return;
        }
        rule.target = OD ? OD.normalizePriority(el.value, 'ACTION_THIS_WEEK', state.priorityCatalog) : el.value;
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-rule-approval-scope]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.approvalScope = el.value === 'option' ? 'option' : 'order';
        stageRuleChange(rule);
      });

      modal.querySelectorAll('[data-cpa-rule-evidence]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const field = el.dataset.cpaRuleEvidence;
        rule.evidenceFields = { ...(rule.evidenceFields || {}), [field]: Boolean(el.checked) };
        stageRuleChange(rule);
      });

      modal.querySelectorAll('[data-cpa-scope-preset]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule || typeof Rules.applyChecklistScopePreset !== 'function') return;
        const preset = el.dataset.cpaScopePreset;
        if (preset === 'custom') {
          if (Rules.checklistScopePreset(rule).preset !== 'custom') {
            rule.conditions = [...rule.conditions, Rules.normalizeCondition({ field: 'License', operator: 'notEmpty', value: '' })];
            applyBasicConditions(rule);
            stageRuleChange(rule);
          }
          draw();
          return;
        }
        Rules.applyChecklistScopePreset(rule, { preset, maxDaysToLoad: 28 });
        uiModes.set(rule.id, 'basic');
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-scope-days],[data-cpa-scope-age]').forEach(el => el.onchange = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule || !row || typeof Rules.applyChecklistScopePreset !== 'function') return;
        const daysInput = row.querySelector('[data-cpa-scope-days]');
        const ageInput = row.querySelector('[data-cpa-scope-age]');
        const maxDaysToLoad = Number(daysInput && daysInput.value);
        const ageRaw = String(ageInput && ageInput.value || '').trim();
        Rules.applyChecklistScopePreset(rule, { preset: 'window',
          maxDaysToLoad: Number.isFinite(maxDaysToLoad) ? maxDaysToLoad : 28,
          minOrderAgeDays: ageRaw === '' ? null : Number(ageRaw),
        });
        stageRuleChange(rule);
        syncRuleSummaryDom(row, rule);
      });

      modal.querySelectorAll('[data-cpa-rule-mode]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const nextMode = el.dataset.cpaRuleMode;
        if (nextMode !== 'formula') invalidRuleDrafts.delete(`${rule.id}:formula`);
        if (nextMode === 'formula' && rule.mode !== 'formula' && !rule.formula) {
          rule.formula = Rules.conditionsToFormula(rule.conditions, rule.match);
        }
        uiModes.set(rule.id, nextMode);
        draw();
      });

      modal.querySelectorAll('[data-cpa-rule-match]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.match = el.value === 'any' ? 'any' : 'all';
        applyBasicConditions(rule);
        stageRuleChange(rule);
        draw();
      });

      const bindConditionCollection = (prefix, getList, onMutated) => {
        modal.querySelectorAll(`[data-cpa-${prefix}-op]`).forEach(el => el.onchange = () => {
          const holder = el.closest(`[data-cpa-${prefix}]`);
          const [ruleId, idxStr] = String(holder?.dataset[`cpa${prefix === 'auto-cond' ? 'AutoCond' : 'Cond'}`] || '').split(':');
          const rule = findRule(ruleId);
          const list = rule && getList(rule);
          const idx = Number(idxStr);
          if (!list || !list[idx]) return;
          list[idx] = Rules.normalizeCondition({ ...list[idx], operator: el.value });
          onMutated(rule);
          draw();
        });
        modal.querySelectorAll(`[data-cpa-${prefix}-remove]`).forEach(el => el.onclick = () => {
          const holder = el.closest(`[data-cpa-${prefix}]`);
          const [ruleId, idxStr] = String(holder?.dataset[`cpa${prefix === 'auto-cond' ? 'AutoCond' : 'Cond'}`] || '').split(':');
          const rule = findRule(ruleId);
          const list = rule && getList(rule);
          const idx = Number(idxStr);
          if (!list) return;
          list.splice(idx, 1);
          onMutated(rule);
          draw();
        });
        modal.querySelectorAll(`[data-cpa-${prefix}] [data-cpa-cond-value]`).forEach(el => el.onchange = () => {
          const holder = el.closest(`[data-cpa-${prefix}]`);
          const [ruleId, idxStr] = String(holder?.dataset[`cpa${prefix === 'auto-cond' ? 'AutoCond' : 'Cond'}`] || '').split(':');
          const rule = findRule(ruleId);
          const list = rule && getList(rule);
          const idx = Number(idxStr);
          if (!list || !list[idx]) return;
          const cond = list[idx];
          const val = ['in', 'notIn'].includes(cond.operator) ? conditionValueList(el.value) : el.value;
          list[idx] = Rules.normalizeCondition({ ...cond, value: val, right: { ...(cond.right || {}), type: 'value', value: val } });
          onMutated(rule);
          syncRuleSummaryDom(el.closest('[data-cpa-rule]'), rule);
        });
        modal.querySelectorAll(`[data-cpa-${prefix}] [data-cpa-cond-choice]`).forEach(el => el.onchange = () => {
          const holder = el.closest(`[data-cpa-${prefix}]`);
          const [ruleId, idxStr] = String(holder?.dataset[`cpa${prefix === 'auto-cond' ? 'AutoCond' : 'Cond'}`] || '').split(':');
          const rule = findRule(ruleId);
          const list = rule && getList(rule);
          const idx = Number(idxStr);
          if (!list || !list[idx]) return;
          const values = [...holder.querySelectorAll('[data-cpa-cond-choice]:checked')].map(c => c.value);
          list[idx] = Rules.normalizeCondition({ ...list[idx], value: values, right: { type: 'value', value: values } });
          onMutated(rule);
          draw();
        });
      };

      bindConditionCollection('cond', r => r.conditions, r => {
        applyBasicConditions(r);
        stageRuleChange(r);
      });
      bindConditionCollection('auto-cond', r => {
        if (!Array.isArray(r.autoConditions)) r.autoConditions = [];
        return r.autoConditions;
      }, r => {
        r.autoMode = 'basic';
        r.autoFormula = Rules.conditionsToFormula(r.autoConditions, r.autoMatch || 'all');
        stageRuleChange(rule);
      });

      modal.querySelectorAll('[data-cpa-cond-advanced]').forEach(el => el.onclick = () => {
        const holder = el.closest('[data-cpa-cond]');
        const key = holder?.dataset.cpaCond || '';
        if (!key) return;
        if (advancedConditions.has(key)) advancedConditions.delete(key);
        else advancedConditions.add(key);
        draw();
      });

      modal.querySelectorAll('[data-cpa-cond-right-type]').forEach(el => el.onchange = () => {
        const holder = el.closest('[data-cpa-cond]');
        const [ruleId, idxStr] = String(holder?.dataset.cpaCond || '').split(':');
        const rule = findRule(ruleId);
        const idx = Number(idxStr);
        if (!rule || !rule.conditions[idx]) return;
        const type = el.value;
        const right = type === 'today' ? { type: 'today' } : type === 'field' ? { type: 'field', field: '@daysToLoad' } : { type: 'value', value: '' };
        rule.conditions[idx] = Rules.normalizeCondition({ ...rule.conditions[idx], right });
        applyBasicConditions(rule);
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-cond-left-offset],[data-cpa-cond-left-offset-unit],[data-cpa-cond-right-offset],[data-cpa-cond-right-offset-unit]').forEach(el => el.onchange = () => {
        const holder = el.closest('[data-cpa-cond]');
        const [ruleId, idxStr] = String(holder?.dataset.cpaCond || '').split(':');
        const rule = findRule(ruleId);
        const idx = Number(idxStr);
        if (!rule || !rule.conditions[idx]) return;
        const cond = rule.conditions[idx];
        const applySide = side => {
          const valInput = holder.querySelector(`[data-cpa-cond-${side}-offset]`);
          const unitInput = holder.querySelector(`[data-cpa-cond-${side}-offset-unit]`);
          if (!valInput) return cond[side];
          const num = Number(valInput.value) || 0;
          const unit = unitInput && unitInput.value === 'weeks' ? 'weeks' : 'days';
          return { ...(cond[side] || {}), offset: num ? { value: num, unit } : undefined };
        };
        rule.conditions[idx] = Rules.normalizeCondition({ ...cond, left: applySide('left'), right: applySide('right') });
        applyBasicConditions(rule);
        stageRuleChange(rule);
        syncRuleSummaryDom(el.closest('[data-cpa-rule]'), rule);
      });

      modal.querySelectorAll('[data-cpa-auto-status]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.autoStatus = Checklist.normalizeStatus(el.value) || '';
        if (!rule.autoStatus) invalidRuleDrafts.delete(`${rule.id}:auto`);
        if (rule.autoStatus && !rule.autoMode) rule.autoMode = 'basic';
        if (rule.autoStatus && rule.autoMode === 'basic' && (!Array.isArray(rule.autoConditions) || !rule.autoConditions.length)) {
          rule.autoConditions = [Rules.normalizeCondition({ field: '@stage', operator: 'in', value: ['LOADING', 'IN_WAREHOUSE'] })];
          rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
        }
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-auto-mode]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const next = el.dataset.cpaAutoMode === 'formula' ? 'formula' : 'basic';
        if (next === 'basic') invalidRuleDrafts.delete(`${rule.id}:auto`);
        rule.autoMode = next;
        if (next === 'formula' && !rule.autoFormula && Array.isArray(rule.autoConditions) && rule.autoConditions.length) {
          rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
        } else if (next === 'basic' && (!Array.isArray(rule.autoConditions) || !rule.autoConditions.length) && rule.autoFormula) {
          const synced = Rules.formulaToConditions(rule.autoFormula);
          if (synced) { rule.autoConditions = synced.conditions; rule.autoMatch = synced.match; }
        }
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-auto-match]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.autoMatch = el.value === 'any' ? 'any' : 'all';
        rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions || [], rule.autoMatch);
        stageRuleChange(rule);
      });

      modal.querySelectorAll('[data-cpa-auto-cond-add]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        if (!Array.isArray(rule.autoConditions)) rule.autoConditions = [];
        rule.autoConditions.push(Rules.normalizeCondition({ field: '@stage', operator: 'in', value: ['LOADING', 'IN_WAREHOUSE'] }));
        rule.autoMode = 'basic';
        rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
        stageRuleChange(rule);
        draw();
      });

      modal.querySelectorAll('[data-cpa-auto-formula]').forEach(el => el.onchange = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const fb = row.querySelector('[data-cpa-auto-feedback]');
        const raw = Rules.extractFormula(el.value);
        const internal = Rules.formulaFromDisplay(raw, catalogFor(rule));
        if (!internal) {
          rule.autoFormula = '';
          stageRuleChange(rule);
          return;
        }
        const check = Rules.validateExpression(internal, { fields: formulaFieldIds(rule) });
        if (!check.valid) {
          invalidRuleDrafts.set(`${rule.id}:auto`, check.errors.join(' · ')); el.setAttribute('aria-invalid', 'true');
          if (fb) fb.textContent = L('Geçersiz formül: ', 'Invalid formula: ') + check.errors.join(' · ');
          return;
        }
        invalidRuleDrafts.delete(`${rule.id}:auto`); el.removeAttribute('aria-invalid');
        rule.autoMode = 'formula';
        rule.autoFormula = internal;
        if (fb) fb.textContent = L('✓ Otomatik durum formülü kaydedildi.', '✓ Auto-status formula saved.');
        stageRuleChange(rule);
      });

      modal.querySelectorAll('[data-cpa-formula-test]').forEach(el => el.onclick = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (row && rule) testFormulaInRow(row, rule, false);
      });

      modal.querySelectorAll('[data-cpa-rule-formula]').forEach(el => el.onchange = () => {
        const row = el.closest('[data-cpa-rule]');
        const rule = findRule(ruleIdOf(el));
        if (row && rule) testFormulaInRow(row, rule, true);
      });

      modal.querySelectorAll('[data-cpa-formula-fn]').forEach(el => el.onclick = () => {
        const row = el.closest('[data-cpa-rule]');
        const textarea = row && row.querySelector('[data-cpa-rule-formula]');
        if (!textarea) return;
        const snippet = el.dataset.cpaFormulaFn || '';
        const start = textarea.selectionStart || textarea.value.length;
        const end = textarea.selectionEnd || start;
        const prefix = !textarea.value.trim() ? '=' : '';
        textarea.value = prefix + textarea.value.slice(0, start) + snippet + textarea.value.slice(end);
        textarea.focus();
      });

      modal.querySelectorAll('[data-cpa-ai-purpose]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        aiDraftOf(rule).purpose = el.value === 'auto' ? 'auto' : 'question';
        draw();
      });

      modal.querySelectorAll('[data-cpa-ai-auto-status]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        aiDraftOf(rule).autoStatus = el.value;
      });

      modal.querySelectorAll('[data-cpa-field-picker]').forEach(picker => {
        const toggle = picker.querySelector('[data-cpa-field-toggle]');
        const menu = picker.querySelector('[data-cpa-value-menu]');
        const search = picker.querySelector('[data-cpa-value-search]');
        const optionsBox = picker.querySelector('[data-cpa-field-options]');
        const rule = findRule(ruleIdOf(picker));
        if (!toggle || !menu || !optionsBox || !rule) return;
        const role = picker.dataset.cpaFieldPicker;
        menu.onkeydown = menuKeyboard;
        const renderOptions = q => { optionsBox.innerHTML = fieldOptionRows(rule, '', q); };
        toggle.onclick = event => {
          event.stopPropagation();
          const wasHidden = menu.hidden;
          if (!wasHidden) { closeValueMenu(); return; }
          openValueMenu(picker, menu);
          toggle.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
          if (!menu.hidden) { renderOptions(search ? search.value : ''); search?.focus(); }
        };
        if (search) search.oninput = () => renderOptions(search.value);
        optionsBox.onclick = event => {
          const btn = event.target.closest('[data-cpa-field-option]');
          if (!btn) return;
          const fieldId = btn.dataset.cpaFieldOption;
          closeValueMenu();
          if (role === 'formula') {
            const row = picker.closest('[data-cpa-rule]');
            const textarea = row && row.querySelector('[data-cpa-rule-formula]');
            if (textarea) {
              const token = `[${fieldLabel(fieldId, rule)}]`;
              const start = textarea.selectionStart || textarea.value.length;
              textarea.value = (!textarea.value.trim() ? '=' : '') + textarea.value.slice(0, start) + token + textarea.value.slice(start);
              textarea.focus();
            }
            return;
          }
          if (role === 'auto-left') {
            const holder = picker.closest('[data-cpa-auto-cond]');
            const [, idxStr] = String(holder?.dataset.cpaAutoCond || '').split(':');
            const idx = Number(idxStr);
            if (Array.isArray(rule.autoConditions) && rule.autoConditions[idx]) {
              const kind = fieldKind(fieldId, rule);
              const defOp = (OPERATORS_BY_KIND[kind] || OPERATORS_BY_KIND.text)[0];
              rule.autoConditions[idx] = Rules.normalizeCondition({ field: fieldId, operator: defOp, value: '' });
              rule.autoMode = 'basic';
              rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
              stageRuleChange(rule);
              draw();
            }
            return;
          }
          const holder = picker.closest('[data-cpa-cond]');
          const [, idxStr] = String(holder?.dataset.cpaCond || '').split(':');
          const idx = Number(idxStr);
          if (!rule.conditions[idx]) return;
          const cond = rule.conditions[idx];
          if (role === 'left') {
            const kind = fieldKind(fieldId, rule);
            const defOp = (OPERATORS_BY_KIND[kind] || OPERATORS_BY_KIND.text)[0];
            rule.conditions[idx] = Rules.normalizeCondition({ field: fieldId, operator: defOp, value: '' });
          } else if (role === 'right') {
            rule.conditions[idx] = Rules.normalizeCondition({ ...cond, right: { ...(cond.right || {}), type: 'field', field: fieldId } });
          } else if (role === 'left-offset') {
            rule.conditions[idx] = Rules.normalizeCondition({ ...cond, left: { ...(cond.left || {}), offsetField: fieldId } });
          } else if (role === 'right-offset') {
            rule.conditions[idx] = Rules.normalizeCondition({ ...cond, right: { ...(cond.right || {}), offsetField: fieldId } });
          }
          applyBasicConditions(rule);
          stageRuleChange(rule);
          draw();
        };
      });

      modal.querySelectorAll('[data-cpa-value-picker]').forEach(picker => {
        const toggle = picker.querySelector('[data-cpa-value-toggle]');
        const input = picker.querySelector('[data-cpa-cond-value]');
        const menu = picker.querySelector('[data-cpa-value-menu]');
        const search = picker.querySelector('[data-cpa-value-search]');
        const optionsBox = picker.querySelector('[data-cpa-value-options]');
        const autoHolder = picker.closest('[data-cpa-auto-cond]');
        const stdHolder = picker.closest('[data-cpa-cond]');
        const rawKey = autoHolder ? autoHolder.dataset.cpaAutoCond : stdHolder?.dataset.cpaCond;
        const [ruleId, idxStr] = String(rawKey || '').split(':');
        const rule = findRule(ruleId);
        const list = rule ? (autoHolder ? rule.autoConditions : rule.conditions) : null;
        const idx = Number(idxStr);
        if (!toggle || !menu || !optionsBox || !list || !list[idx]) return;
        const multi = picker.dataset.multi === '1';
        menu.onkeydown = menuKeyboard;
        toggle.onclick = event => {
          event.stopPropagation();
          const wasHidden = menu.hidden;
          if (!wasHidden) { closeValueMenu(); return; }
          openValueMenu(picker, menu);
          if (!menu.hidden) { optionsBox.innerHTML = valueOptionRows(list[idx], search ? search.value : ''); search?.focus(); }
        };
        if (search) search.oninput = () => { optionsBox.innerHTML = valueOptionRows(list[idx], search.value); };
        optionsBox.onclick = event => {
          if (multi) return;
          const btn = event.target.closest('[data-cpa-value-option]');
          if (!btn) return;
          const val = btn.dataset.cpaValueOption;
          if (input) input.value = val;
          list[idx] = Rules.normalizeCondition({ ...list[idx], value: val, right: { type: 'value', value: val } });
          if (autoHolder) {
            rule.autoMode = 'basic';
            rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
          } else applyBasicConditions(rule);
          stageRuleChange(rule);
          closeValueMenu();
          syncRuleSummaryDom(picker.closest('[data-cpa-rule]'), rule);
        };
        optionsBox.onchange = () => {
          if (!multi) return;
          const vals = [...optionsBox.querySelectorAll('input[data-cpa-value-option]:checked')].map(c => c.value);
          if (input) input.value = vals.join(', ');
          list[idx] = Rules.normalizeCondition({ ...list[idx], value: vals, right: { type: 'value', value: vals } });
          if (autoHolder) {
            rule.autoMode = 'basic';
            rule.autoFormula = Rules.conditionsToFormula(rule.autoConditions, rule.autoMatch || 'all');
          } else applyBasicConditions(rule);
          stageRuleChange(rule);
          syncRuleSummaryDom(picker.closest('[data-cpa-rule]'), rule);
        };
      });
    }

    function bindCatalogs() {
      modal.querySelectorAll('[data-cpa-priority-add]').forEach(el => el.onclick = () => {
        prioEditor = prioEditor && prioEditor.mode === 'create'
          ? null
          : { mode: 'create', id: '', tr: '', en: '', tone: 'copper', isRisk: true, pendingRuleId: '' };
        draw();
        modal.querySelector('[data-cpa-priority-tr]')?.focus();
      });

      modal.querySelectorAll('[data-cpa-priority-edit]').forEach(el => el.onclick = () => {
        const entry = (state.priorityCatalog || []).find(item => item.id === el.dataset.cpaPriorityEdit);
        if (!entry || entry.builtIn) return;
        prioEditor = {
          mode: 'edit', id: entry.id, tr: entry.tr || '', en: entry.en || '',
          tone: entry.tone || 'copper', isRisk: entry.isRisk !== false, usage: entry.usage || 'priority', pendingRuleId: '',
        };
        draw();
        modal.querySelector('[data-cpa-priority-tr]')?.focus();
      });

      modal.querySelector('[data-cpa-priority-usage]')?.addEventListener('change', el => {
        prioEditor.tr = modal.querySelector('[data-cpa-priority-tr]').value; prioEditor.en = modal.querySelector('[data-cpa-priority-en]').value;
        prioEditor.usage = el.target.value; if (prioEditor.usage === 'tracking') prioEditor.isRisk = false; draw();
      });
      modal.querySelectorAll('[data-cpa-priority-tone]').forEach(el => el.onclick = () => {
        if (!prioEditor) return;
        prioEditor.tr = modal.querySelector('[data-cpa-priority-tr]')?.value || prioEditor.tr;
        prioEditor.en = modal.querySelector('[data-cpa-priority-en]')?.value || prioEditor.en;
        prioEditor.isRisk = Boolean(modal.querySelector('[data-cpa-priority-risk]')?.checked);
        prioEditor.tone = el.dataset.cpaPriorityTone || 'copper';
        draw();
      });

      const prioCancel = modal.querySelector('[data-cpa-priority-cancel]');
      if (prioCancel) prioCancel.onclick = () => { prioEditor = null; draw(); };

      const prioSave = modal.querySelector('[data-cpa-priority-save]');
      if (prioSave) prioSave.onclick = async () => {
        if (!prioEditor) return;
        const tr = String(modal.querySelector('[data-cpa-priority-tr]')?.value || '').trim();
        const en = String(modal.querySelector('[data-cpa-priority-en]')?.value || '').trim();
        const isRisk = Boolean(modal.querySelector('[data-cpa-priority-risk]')?.checked);
        if (!tr) {
          setStatus(L('Öncelik etiketi adı boş olamaz.', 'Priority tag label cannot be empty.'), 'warn');
          modal.querySelector('[data-cpa-priority-tr]')?.focus();
          return;
        }
        try {
          if (prioEditor.mode === 'edit' && prioEditor.id) {
            const tagId = prioEditor.id;
            updatePriorityTag(tagId, { tr, en: en || tr, tone: prioEditor.tone, isRisk, usage: prioEditor.usage });
            if (isModerator() && state.managed.priorityCatalog.some(item => item.id === tagId)) await publishPriorityTagToAll(tagId);
            setStatus(L('Öncelik etiketi güncellendi', 'Priority tag updated'), 'ok');
          } else {
            const created = addPriorityTag({ tr, en: en || tr, tone: prioEditor.tone, isRisk, usage: prioEditor.usage });
            if (prioEditor.pendingRuleId) {
              const targetRule = findRule(prioEditor.pendingRuleId);
              if (targetRule && targetRule.kind === 'priority') {
                targetRule.target = created.id;
                expandedRuleId = targetRule.id;
                stageRuleChange(targetRule);
              }
            } else {
              setStatus(L('Yeni öncelik etiketi eklendi', 'New priority tag added'), 'ok');
            }
          }
          prioEditor = null;
          draw();
        } catch (error) {
          setStatus(error.message, 'warn');
        }
      };

      modal.querySelectorAll('[data-cpa-priority-move]').forEach(el => el.onclick = () => {
        const value = String(el.dataset.cpaPriorityMove || '');
        const separator = value.lastIndexOf(':');
        const id = value.slice(0, separator), dir = value.slice(separator + 1);
        if (movePriorityTag(id, dir)) {
          setStatus(L('Aciliyet sırası güncellendi', 'Urgency order updated'), 'ok');
          draw();
        }
      });

      modal.querySelectorAll('[data-cpa-priority-delete]').forEach(el => el.onclick = () => {
        const id = el.dataset.cpaPriorityDelete;
        const entry = (state.priorityCatalog || []).find(item => item.id === id);
        if (!entry || entry.builtIn) return;
        const usedCount = state.rules.filter(rule => rule.kind === 'priority' && rule.target === id).length;
        const msg = usedCount && entry.usage === 'tracking'
          ? L(`Bu takip etiketi silinsin mi? Etiketi kullanan ${usedCount} kural devre dışı bırakılacak.`, `Delete this tracking tag? Its ${usedCount} rule(s) will be disabled.`)
          : usedCount ? L(`"${priorityLabel(id)}" etiketi silinsin mi? Bu etiketi kullanan ${usedCount} kural "Bu Hafta Aksiyon" hedefine taşınacak.`,
            `Delete tag "${priorityLabel(id)}"? ${usedCount} rule(s) using it will switch to "Action This Week".`)
          : L(`"${priorityLabel(id)}" etiketi silinsin mi?`, `Delete tag "${priorityLabel(id)}"?`);
        if (typeof confirm === 'function' && !confirm(msg)) return;
        deletePriorityTag(id, 'ACTION_THIS_WEEK');
        setStatus(L('Öncelik etiketi silindi', 'Priority tag deleted'), 'ok');
        draw();
      });

      modal.querySelectorAll('[data-cpa-priority-publish]').forEach(el => el.onclick = async () => {
        el.disabled = true;
        try { await publishPriorityTagToAll(el.dataset.cpaPriorityPublish); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      modal.querySelectorAll('[data-cpa-priority-unpublish]').forEach(el => el.onclick = async () => {
        el.disabled = true;
        try { await unpublishPriorityTag(el.dataset.cpaPriorityUnpublish); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      const checklistSwitch = modal.querySelector('[data-cpa-checklist-enabled]');
      if (checklistSwitch) checklistSwitch.onchange = () => {
        state.checklistSettings.enabled = Boolean(checklistSwitch.checked);
        commit({
          message: state.checklistSettings.enabled ? L('Kontrol listesi açıldı', 'Checklist enabled') : L('Kontrol listesi kapatıldı', 'Checklist disabled'),
          refreshColumns: true,
        });
        draw();
      };

      modal.querySelectorAll('[data-cpa-status-add]').forEach(el => el.onclick = () => {
        statusEditor = statusEditor && statusEditor.mode === 'create'
          ? null
          : { mode: 'create', id: '', tr: '', en: '', tone: 'teal', resolved: false };
        draw();
        modal.querySelector('[data-cpa-status-tr]')?.focus();
      });

      modal.querySelectorAll('[data-cpa-status-edit]').forEach(el => el.onclick = () => {
        const entry = Checklist.customStatuses().find(item => item.id === el.dataset.cpaStatusEdit);
        if (!entry) return;
        statusEditor = {
          mode: 'edit', id: entry.id, tr: entry.tr || entry.name || '',
          en: entry.en || entry.tr || entry.name || '', tone: entry.tone || 'teal', resolved: Boolean(entry.resolved),
        };
        draw();
        modal.querySelector('[data-cpa-status-tr]')?.focus();
      });

      modal.querySelectorAll('[data-cpa-status-tone]').forEach(el => el.onclick = () => {
        if (!statusEditor) return;
        statusEditor.tr = modal.querySelector('[data-cpa-status-tr]')?.value || statusEditor.tr;
        statusEditor.en = modal.querySelector('[data-cpa-status-en]')?.value || statusEditor.en;
        statusEditor.resolved = Boolean(modal.querySelector('[data-cpa-status-resolved]')?.checked);
        statusEditor.tone = el.dataset.cpaStatusTone || 'teal';
        draw();
      });

      const statusCancel = modal.querySelector('[data-cpa-status-cancel]');
      if (statusCancel) statusCancel.onclick = () => { statusEditor = null; draw(); };

      const statusSave = modal.querySelector('[data-cpa-status-save]');
      if (statusSave) statusSave.onclick = async () => {
        if (!statusEditor) return;
        const tr = String(modal.querySelector('[data-cpa-status-tr]')?.value || '').trim();
        const en = String(modal.querySelector('[data-cpa-status-en]')?.value || '').trim();
        const resolved = Boolean(modal.querySelector('[data-cpa-status-resolved]')?.checked);
        if (!tr) {
          setStatus(L('Durum adı boş olamaz.', 'Status label cannot be empty.'), 'warn');
          modal.querySelector('[data-cpa-status-tr]')?.focus();
          return;
        }
        try {
          if (statusEditor.mode === 'edit' && statusEditor.id && typeof Checklist.updateCustomStatus === 'function') {
            const id = statusEditor.id;
            const patch = { tr, name: tr, en: en || tr, tone: statusEditor.tone, resolved };
            Checklist.updateCustomStatus(id, patch);
            if (isModerator() && state.managed.checklistStatuses.some(item => item.id === id)) {
              await saveManagedRules({ checklistStatuses: state.managed.checklistStatuses.map(item => item.id === id ? { ...item, ...patch } : item) });
            }
            if (isModerator() && (state.managed.checklistStatuses || []).some(item => item.id === statusEditor.id)) {
              void publishChecklistStatusToAll(statusEditor.id).catch(() => {});
            }
          } else {
            Checklist.addCustomStatus({ tr, en: en || tr, tone: statusEditor.tone, resolved });
          }
          statusEditor = null;
          commit({ message: L('Checklist durumu kaydedildi', 'Checklist status saved'), refreshColumns: true });
          draw();
        } catch (error) {
          setStatus(error.message, 'warn');
        }
      };

      modal.querySelectorAll('[data-cpa-status-delete]').forEach(el => el.onclick = () => {
        const id = el.dataset.cpaStatusDelete;
        const label = Checklist.statusLabel(id, lang());
        if (typeof confirm === 'function' && !confirm(L(`"${label}" özel durumu silinsin mi?`, `Delete custom status "${label}"?`))) return;
        Checklist.deleteCustomStatus(id);
        commit({ message: L('Özel durum silindi', 'Custom status deleted'), refreshColumns: true });
        draw();
      });

      modal.querySelectorAll('[data-cpa-status-publish]').forEach(el => el.onclick = async () => {
        el.disabled = true;
        try { await publishChecklistStatusToAll(el.dataset.cpaStatusPublish); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });

      modal.querySelectorAll('[data-cpa-status-unpublish]').forEach(el => el.onclick = async () => {
        el.disabled = true;
        try { await unpublishChecklistStatus(el.dataset.cpaStatusUnpublish); draw(); }
        catch (error) { if (typeof showToast === 'function') showToast(error.message); }
        finally { el.disabled = false; }
      });
    }

    function bindQueue() {
      modal.querySelectorAll('[data-cpa-q-item]').forEach(el => el.onclick = () => {
        qItemId = el.dataset.cpaQItem || 'ALL';
        qLimit = 120;
        draw();
      });

      const qScopeSelect = modal.querySelector('[data-cpa-q-scope]');
      if (qScopeSelect) qScopeSelect.onchange = () => { qScope = qScopeSelect.value; qLimit = 120; draw(); };

      const qSupSelect = modal.querySelector('[data-cpa-q-supplier]');
      if (qSupSelect) qSupSelect.onchange = () => { qSupplier = qSupSelect.value; qLimit = 120; draw(); };

      const qSearchInput = modal.querySelector('[data-cpa-q-search]');
      if (qSearchInput) qSearchInput.oninput = () => {
        qSearch = qSearchInput.value;
        const pos = qSearchInput.selectionStart || qSearch.length;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = 0;
          draw();
          const nextInput = modal.querySelector('[data-cpa-q-search]');
          if (nextInput) { nextInput.focus(); try { nextInput.setSelectionRange(pos, pos); } catch (_) {} }
        }, 160);
      };

      modal.querySelectorAll('[data-cpa-queue-check]').forEach(el => el.onchange = () => {
        const key = el.dataset.cpaQueueCheck;
        if (el.checked) selectedQueueKeys.add(key); else selectedQueueKeys.delete(key);
        draw();
      });

      const selectAll = modal.querySelector('[data-cpa-queue-select-all]');
      if (selectAll) selectAll.onchange = () => {
        const { entries } = buildQueueEntries();
        const shown = entries.slice(0, qLimit);
        if (selectAll.checked) shown.forEach(item => selectedQueueKeys.add(item.rowKey));
        else shown.forEach(item => selectedQueueKeys.delete(item.rowKey));
        draw();
      };

      const bulkClear = modal.querySelector('[data-cpa-bulk-clear]');
      if (bulkClear) bulkClear.onclick = () => { selectedQueueKeys.clear(); draw(); };

      const bulkStatusEl = modal.querySelector('[data-cpa-bulk-status]');
      if (bulkStatusEl) bulkStatusEl.onchange = () => { bulkStatus = bulkStatusEl.value; };

      const bulkNoteEl = modal.querySelector('[data-cpa-bulk-note]');
      if (bulkNoteEl) bulkNoteEl.oninput = () => { bulkNote = bulkNoteEl.value; };

      const bulkApply = modal.querySelector('[data-cpa-bulk-apply]');
      if (bulkApply) bulkApply.onclick = () => {
        const { entries } = buildQueueEntries();
        const targets = entries.filter(item => selectedQueueKeys.has(item.rowKey));
        if (!targets.length) return;
        const noteTrimmed = String(bulkNote || '').trim();
        let appliedCount = 0;
        batchChecklistAnswers(() => {
          for (const entry of targets) {
            const itemIds = entry.parts.length
              ? entry.parts.map(part => Checklist.Components.itemId(entry.itemId, part.id))
              : [entry.itemId];
            for (const id of itemIds) {
              if (setChecklistAnswer(entry.analysis, id, bulkStatus, noteTrimmed ? { note: noteTrimmed } : undefined)) {
                appliedCount += 1;
              }
            }
          }
        });
        selectedQueueKeys.clear();
        bulkNote = '';
        recompute();
        render();
        try {
          window.BLChecklistSupplierSync?.syncAnswerChanges?.();
          window.BLChecklistSupplierSync?.refreshColumns?.({ render: true });
        } catch (_) {}
        setStatus(L(`${int(appliedCount)} kontrol yanıtı güncellendi`, `${int(appliedCount)} check answers updated`), 'ok');
        draw();
      };

      modal.querySelectorAll('[data-cpa-set-parts]').forEach(el => el.onclick = () => {
        const value = String(el.dataset.cpaSetParts || '');
        const separator = value.lastIndexOf(':');
        const orderKey = value.slice(0, separator), countStr = value.slice(separator + 1);
        const analysis = state.model && state.model.orders ? state.model.orders.find(o => o.orderKey === orderKey) : null;
        if (analysis && setChecklistComponents(analysis, Number(countStr))) {
          recompute(); render();
          try { window.BLChecklistSupplierSync?.syncAnswerChanges?.(); window.BLChecklistSupplierSync?.refreshColumns?.({ render: true }); } catch (_) {}
          draw();
        }
      });

      modal.querySelectorAll('[data-cpa-queue-status]').forEach(el => el.onchange = () => {
        const orderKey = el.dataset.cpaOrderKey;
        const itemId = el.dataset.cpaItemId;
        const analysis = state.model && state.model.orders ? state.model.orders.find(o => o.orderKey === orderKey) : null;
        if (!analysis || !itemId) return;
        if (!setChecklistAnswer(analysis, itemId, el.value)) return;
        recompute();
        render();
        try {
          window.BLChecklistSupplierSync?.syncAnswerChanges?.();
          window.BLChecklistSupplierSync?.refreshColumns?.({ render: true });
        } catch (_) {}
        setStatus(L('Durum kaydedildi', 'Status saved'), 'ok');
        draw();
      });

      modal.querySelectorAll('[data-cpa-queue-evidence]').forEach(el => el.onclick = () => {
        const { entries } = buildQueueEntries();
        const entry = entries.find(item => item.rowKey === el.dataset.cpaQueueEvidence);
        if (!entry || !entry.analysis.sourceRow) return;
        window.BLChecklistSupplierSync?.openEvidenceForRow?.(entry.analysis.sourceRow, entry.itemId, entry.stateCode);
      });

      modal.querySelectorAll('[data-cpa-queue-open-cp]').forEach(el => el.onclick = () => {
        const code = el.dataset.cpaQueueOpenCp;
        closeStudio();
        openInCp(code);
      });

      const moreBtn = modal.querySelector('[data-cpa-q-more]');
      if (moreBtn) moreBtn.onclick = () => { qLimit += 150; draw(); };

      const exportBtn = modal.querySelector('[data-cpa-sync-excel-export]');
      if (exportBtn) exportBtn.onclick = () => {
        const { entries } = buildQueueEntries();
        const chosenEntries = selectedQueueKeys.size
          ? entries.filter(item => selectedQueueKeys.has(item.rowKey))
          : entries;
        const uniqueRows = [...new Set(chosenEntries.map(item => item.analysis && item.analysis.sourceRow).filter(Boolean))];
        window.BLChecklistSupplierSync?.exportWorkbook?.(uniqueRows.length ? { rows: uniqueRows } : undefined);
      };

      const importBtn = modal.querySelector('[data-cpa-sync-excel-import]');
      if (importBtn) importBtn.onclick = () => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        picker.onchange = async () => {
          const file = picker.files && picker.files[0];
          if (!file) return;
          const ok = await window.BLChecklistSupplierSync?.importWorkbook?.(file);
          if (ok) { recompute(); render(); draw(); }
        };
        picker.click();
      };

      const testReportBtn = modal.querySelector('[data-cpa-sync-test-report]');
      if (testReportBtn) testReportBtn.onclick = () => {
        window.BLChecklistSupplierSync?.openTestReportImport?.();
      };

      const emailBtn = modal.querySelector('[data-cpa-sync-email]');
      if (emailBtn) emailBtn.onclick = () => {
        window.BLChecklistSupplierSync?.prepareSupplierChecklistEmail?.();
      };

      const plmBtn = modal.querySelector('[data-cpa-sync-plm]');
      if (plmBtn) plmBtn.onclick = async () => {
        await syncPlmSampleRequests(plmBtn);
        recompute(); render(); draw();
      };

      modal.querySelectorAll('[data-cpa-plm-open]').forEach(el => el.onclick = () => {
        const api = sampleRequests();
        if (api && typeof api.openForPlmId === 'function') api.openForPlmId(el.dataset.cpaPlmOpen, el.dataset.cpaPlmTitle || '');
      });
    }

    function closeStudio() {
      if (applyingRules) { setStatus(L('Kural kaydı sürüyor; tamamlanmasını bekleyin.', 'Saving rule changes; please wait.'), ''); return false; }
      if ((dirtyRules().length || invalidRuleDrafts.size) && typeof confirm === 'function' && !confirm(L('Kaydedilmemiş kural taslakları var. Kaydetmeden kapatılsın mı?', 'There are unsaved rule drafts. Close without saving them?'))) return false;
      rememberQueueView();
      ruleAssistant?.destroy(); ruleAssistant = null;
      closeValueMenu({ remove: true });
      document.removeEventListener('pointerdown', onValueOutsidePointer, true);
      document.removeEventListener('scroll', onValueViewportChange, true);
      document.removeEventListener('keydown', onValueEscape, true);
      window.removeEventListener('resize', onValueViewportChange);
      closeActiveStudio = null;
      if (managedRulesRedraw === draw) managedRulesRedraw = null;
      clearTimeout(debounceTimer);
      clearTimeout(statusTimer);
      modal.remove();
      releaseKeyboard();
    }

    function draw() {
      ruleAssistant?.destroy(); ruleAssistant = null;
      for (const [id, draft] of ruleDrafts) if (ruleSignature(draft) === draftBases.get(id) && ruleSignature(state.rules.find(rule => rule.id === id)) !== draftBases.get(id)) { ruleDrafts.delete(id); draftBases.delete(id); }
      rememberQueueView();
      closeValueMenu({ remove: true });
      const queueTotal = openQueueCount();
      const prioRuleCount = rulesFor('priority').filter(r => r.enabled).length;
      const checkRuleCount = rulesFor('checklist').filter(r => r.enabled).length;
      const studioTab = (id, label, count) => `<button type="button" id="cpa-studio-tab-${id}" role="tab" data-cpa-studio-tab="${id}" aria-controls="cpa-studio-panel" aria-selected="${activeTab === id ? 'true' : 'false'}" tabindex="${activeTab === id ? '0' : '-1'}" class="cpaStudioTab${activeTab === id ? ' is-on' : ''}"><span>${esc(label)}</span><b class="cpaStudioTabCount">${int(count)}</b></button>`;
      const panelHtml = activeTab === 'queue'
        ? queueTabHtml()
        : activeTab === 'priority'
          ? rulesTabHtml('priority')
          : rulesTabHtml('checklist');

      modal.innerHTML = `<div class="cpaModal cpaRulesModal cpaStudioModal cpaFrame" role="dialog" aria-modal="true" aria-labelledby="cpaStudioTitle">
        <header>
          <div>
            <b id="cpaStudioTitle">${esc(L('Kontrol & Kurallar Merkezi', 'Checklist & Rules Studio'))}</b>
            <small>${esc(L('Açık tedarikçi kontrolleri, özel öncelik etiketleri ve dinamik kurallar tek merkezde.', 'Open supplier checks, custom priority tags and dynamic rules in one studio.'))}</small>
          </div>
          <div class="cpaStudioHeaderRight">
            <div class="cpaSeg" role="group" aria-label="${esc(L('Hedef tarih', 'Target date'))}">
              <button type="button" data-cpa-studio-target="retail" class="${state.settings.targetType !== 'inStore' ? 'is-on' : ''}">${esc(L('Retail Depo', 'Retail'))}</button>
              <button type="button" data-cpa-studio-target="inStore" class="${state.settings.targetType === 'inStore' ? 'is-on' : ''}">${esc(L('In Store', 'In Store'))}</button>
            </div>
            <button type="button" class="cpaIconBtn" data-cpa-studio-close aria-label="${esc(L('Kapat', 'Close'))}">×</button>
          </div>
        </header>
        <div class="cpaStudioNavBar">
          <div class="cpaStudioTabs" data-bl-tabs="line" role="tablist" aria-label="${esc(L('Kontrol ve Kurallar sekmeleri', 'Checklist and Rules tabs'))}">
            ${studioTab('queue', L('İş Listesi', 'Work Queue'), queueTotal)}
            ${studioTab('priority', L('Öncelik Kuralları & Etiketler', 'Priority Rules & Tags'), prioRuleCount)}
            ${studioTab('checklist', L('Kontrol Soruları & Durumlar', 'Checklist Questions & Statuses'), checkRuleCount)}
          </div>
          <span class="cpaRulesStatus" data-cpa-rules-status aria-live="polite"></span>
        </div>
        <div class="cpaModalBody cpaStudioBody" id="cpa-studio-panel" role="tabpanel" aria-labelledby="cpa-studio-tab-${activeTab}" ${applyingRules ? 'inert' : ''}>
          ${panelHtml}
        </div>
        <footer>
          <span class="cpaNote">${esc(L('Kural taslakları siz kaydedene kadar uygulanmaz. Kontrol yanıtları anında kaydedilir.', 'Rule drafts take effect when you save. Checklist responses save immediately.'))}</span>
          <div class="cpaDraftActions">
          ${lastRuleApply ? `<button type="button" class="cpaBtn" data-cpa-undo-rules ${dirtyRules().length || applyingRules ? 'disabled' : ''} title="${esc(L('Kural tanımını geri alır; kaydedilmiş checklist yanıtlarını değiştirmez.', 'Restores rule definitions; saved checklist answers are preserved.'))}">${esc(L('Son Kural Değişikliğini Geri Al', 'Undo Last Rule Change'))}</button>` : ''}
          <button type="button" class="cpaBtn" data-cpa-discard-drafts ${dirtyRules().length && !applyingRules ? '' : 'disabled hidden'}>${esc(L('Taslakları İptal Et', 'Discard Drafts'))}</button>
          <button type="button" class="cpaBtn primary" data-cpa-apply-drafts ${dirtyRules().length && !applyingRules ? '' : 'disabled'} ${activeTab === 'queue' && !dirtyRules().length ? 'hidden' : ''}>${esc(applyingRules ? L('Kaydediliyor…', 'Saving…') : L('Kontrol Ettim, Kaydet', 'Reviewed, Save'))}</button>
          <button type="button" class="cpaBtn" data-cpa-studio-close>${esc(L('Kapat', 'Close'))}</button></div>
        </footer>
      </div>`;

      modal.querySelector('[data-cpa-apply-drafts]').onclick = applyDrafts;
      modal.querySelector('[data-cpa-undo-rules]')?.addEventListener('click', undoRuleApply);
      modal.querySelector('[data-cpa-discard-drafts]').onclick = () => { ruleDrafts.clear(); draftBases.clear(); invalidRuleDrafts.clear(); draw(); };
      modal.querySelectorAll('[data-cpa-studio-close]').forEach(btn => btn.onclick = closeStudio);
      modal.querySelectorAll('[data-cpa-studio-tab]').forEach(btn => btn.onclick = () => {
        activeTab = btn.dataset.cpaStudioTab || 'queue';
        draw();
        modal.querySelector(`[data-cpa-studio-tab="${activeTab}"]`)?.focus();
      });
      modal.querySelectorAll('[data-cpa-studio-target]').forEach(btn => btn.onclick = () => {
        state.settings.targetType = btn.dataset.cpaStudioTarget === 'inStore' ? 'inStore' : 'retail';
        commit({ message: L('Hedef tarih güncellendi', 'Target date updated') });
        draw();
      });

      const catalog = modal.querySelector('.cpaCatalogDisclosure');
      if (catalog) catalog.ontoggle = () => { if (catalog.isConnected) catalogOpen = catalog.open; };
      if (activeTab === 'queue') bindQueue();
      else {
        bindCatalogs();
        bindRules();
        if (expandedRuleId) {
          const openRule = findRule(expandedRuleId);
          const openRow = modal.querySelector(`[data-cpa-rule="${CSS.escape ? CSS.escape(expandedRuleId) : expandedRuleId}"]`);
          if (openRow && openRule) {
            renderAiResult(openRow, openRule); mountRuleLcwAi(openRow, openRule);
          }
        }
      }
    }

    managedRulesRedraw = draw;
    closeActiveStudio = closeStudio;
    document.addEventListener('pointerdown', onValueOutsidePointer, true);
    document.addEventListener('scroll', onValueViewportChange, true);
    document.addEventListener('keydown', onValueEscape, true);
    window.addEventListener('resize', onValueViewportChange);
    modal.addEventListener('pointerdown', event => {
      backdropPointerStarted = event.target === modal;
    });
    modal.addEventListener('pointercancel', () => { backdropPointerStarted = false; });
    modal.addEventListener('click', event => {
      const shouldClose = event.target === modal && backdropPointerStarted;
      backdropPointerStarted = false;
      if (shouldClose) closeStudio();
    });
    draw();
    releaseKeyboard = window.BLUI?.bindDialogKeyboard(modal) || (() => {});
    window.BLMotionPlus?.play?.('overlay', modal.querySelector('.cpaStudioModal'));
  }

  /* -------------------------------------- karar çalışma zamanı ve yeniden hesap */
  function sampleRequests() { return window.BLPlmSampleRequests || null; }
  function plmEvidence(analysis, itemId) {
    const api = sampleRequests();
    if (!api || typeof api.evidenceForAnalysis !== 'function') return null;
    return api.evidenceForAnalysis(analysis, itemId);
  }

  let lastRows = null;
  const personalDecisionCache = new WeakMap();

  function transitRulesList() {
    try {
      const appState = typeof window !== 'undefined' && window.state;
      const list = appState && appState.overrides && Array.isArray(appState.overrides.transitRules)
        ? appState.overrides.transitRules : [];
      return list;
    } catch (_) { return []; }
  }

  function baseDecisionKey() {
    const userId = String((window.BL_USER_CONTEXT && window.BL_USER_CONTEXT.id) || '');
    const dataRev = typeof window.BL_CP_DECISION_DATA_REVISION === 'function' ? Number(window.BL_CP_DECISION_DATA_REVISION()) || 0 : 0;
    const catSig = (state.priorityCatalog || []).map(item => `${item.id}:${item.isRisk ? 1 : 0}:${item.usage || 'priority'}`).join(',');
    return `d:${new Date().toLocaleDateString('en-CA')}|u:${userId}|r:${dataRev}|t:${state.settings.targetType}|c:${catSig}|tr:${transitRulesList().length}`;
  }

  function fullDecisionKey() {
    const api = sampleRequests();
    const plmStamp = api && api.updatedAt ? String(api.updatedAt) : '';
    const rulesSig = state.rules.map(r => `${r.id}:${r.enabled ? 1 : 0}:${r.mode}:${r.target || ''}:${r.formula || ''}:${(r.conditions || []).length}:${r.autoStatus || ''}:${r.autoFormula || ''}`).join('|');
    const statusesSig = Checklist.customStatuses().map(s => `${s.id}:${s.resolved ? 1 : 0}`).join(',');
    const answersCount = Object.keys(state.answers || {}).length;
    return `${baseDecisionKey()}|dc:${decisionContextRevision}|cl:${state.checklistSettings.enabled ? 1 : 0}|st:${statusesSig}|an:${answersCount}:${state.lastAnswerAt || 0}|plm:${plmStamp}|ru:${rulesSig}`;
  }

  function baseDecisionContext() {
    return {
      targetType: state.settings.targetType,
      transitRules: transitRulesList(),
      priorityCatalog: (state.priorityCatalog || defaultCatalog()).map(item => ({ ...item })),
    };
  }

  const decisionRuntime = window.BLCpDecisionRuntime && typeof window.BLCpDecisionRuntime.create === 'function'
    ? window.BLCpDecisionRuntime.create({
      contextKey: baseDecisionKey,
      analyzeRow: Engine.analyzeOrder,
      summarize: Engine.summarizeAnalyses,
      workerFactory: typeof Worker === 'function' ? () => new Worker('cp-decision-worker.js') : null,
    })
    : null;

  function cloneAnalysis(base) {
    const copy = {
      ...base,
      dims: base.dims ? { ...base.dims } : {},
      riskReasons: Array.isArray(base.riskReasons) ? base.riskReasons.slice() : [],
      signals: Array.isArray(base.signals) ? base.signals.slice() : [],
    };
    Object.defineProperty(copy, 'sourceRow', { value: base.sourceRow, enumerable: false, configurable: true });
    return copy;
  }

  let reusableAnswerPromotionPending = false;
  function promoteReusableChecklistAnswers(orders) {
    if (typeof Checklist.optionAnswerKey !== 'function') return false;
    const reusableRules = state.rules.filter(rule =>
      rule && rule.kind === 'checklist' && rule.approvalScope === 'option');
    if (!reusableRules.length) return false;
    let changed = false;
    for (const analysis of (Array.isArray(orders) ? orders : [])) {
      if (!analysis || !analysis.orderKey) continue;
      for (const rule of reusableRules) {
        const directKey = Checklist.answerKey(analysis.orderKey, rule.id);
        const direct = state.answers[directKey];
        if (!direct || direct.source === 'auto_rule' || Checklist.normalizeStatus(direct.state) !== 'approved') continue;
        const optionKey = Checklist.optionAnswerKey(analysis, rule.id);
        if (!optionKey) continue;
        const reusable = state.answers[optionKey];
        const directAt = Date.parse(String(direct.at || '')) || 0;
        const reusableAt = reusable ? (Date.parse(String(reusable.at || '')) || 0) : 0;
        if (!reusable || directAt > reusableAt) {
          state.answers[optionKey] = Checklist.makeAnswer('approved', analysis, { ...direct, loadDate: null });
          changed = true;
        }
        // Each PO keeps its own evidence. Only the reusable approval is copied;
        // migrating multiple POs must never discard their different notes/files.
      }
    }
    return changed;
  }

  /* KİŞİSEL KATMAN DELTASI (CPR-09). Tek bir kontrol listesi cevabı yalnız aynı
     siparişin ve aynı ürün opsiyonunun kararlarını değiştirebilir: kurallar
     checklist durumunu kendi siparişinden, opsiyon kapsamlı onayı opsiyon
     anahtarından okur. Cevap dışındaki bütün girdiler aynıyken, değişen
     cevapların siparişleri/opsiyonları yeniden değerlendirilir; diğerlerinin
     önceki kopya + değerlendirmesi aynen kullanılır. Değişiklikler hesap
     dönemiyle (epoch) izlenir: farklı satır listeleri (CP, Genel Bakış alt
     kümesi) sırayla hesaplansa da bayat sonuç kullanılmaz. Anahtarı tanınmayan
     bir cevap değişikliği veya cevap dışı girdi değişikliği tam hesaba döner. */
  let personalDelta = null;
  function personalDeltaSignature() {
    const api = sampleRequests();
    return JSON.stringify([
      baseDecisionKey(), nonAnswerContextRevision,
      Checklist.customStatuses().map(s => `${s.id}:${s.resolved ? 1 : 0}`).join(','),
      api && api.updatedAt ? String(api.updatedAt) : '',
      state.checklistSettings, state.priorityCatalog || [],
    ]);
  }
  function resetPersonalDelta(signature) {
    personalDelta = {
      signature, rules: state.rules, epoch: 0, snapshot: null,
      orderEpochs: new Map(), optionEpochs: new Map(), entries: new WeakMap(), contributions: new WeakMap(),
    };
  }
  // Son hesaptan beri değişen cevap anahtarlarını sipariş/opsiyon dönemine işler.
  // Kapsamı çözülemeyen bir anahtar false döner (tam hesap).
  function recordAnswerChanges(delta) {
    const answers = state.answers || {}, previous = delta.snapshot;
    if (!previous) return false;
    let known = true;
    const mark = key => {
      const cut = key.lastIndexOf('::');
      if (cut <= 0) { known = false; return; }
      const head = key.slice(0, cut);
      if (head.startsWith('@option:')) delta.optionEpochs.set(head.slice(8), delta.epoch);
      else delta.orderEpochs.set(head, delta.epoch);
    };
    for (const key of Object.keys(answers)) if (previous.get(key) !== answers[key]) mark(key);
    for (const key of previous.keys()) if (!Object.prototype.hasOwnProperty.call(answers, key)) mark(key);
    return known;
  }
  function reusablePersonalEntry(delta, base) {
    const entry = delta.entries.get(base);
    if (!entry || (delta.orderEpochs.get(base.orderKey) || 0) > entry.epoch) return null;
    if (delta.optionEpochs.size) {
      if (entry.optionId === undefined) entry.optionId = Checklist.optionIdentity(base) || '';
      if (entry.optionId && (delta.optionEpochs.get(entry.optionId) || 0) > entry.epoch) return null;
    }
    return entry;
  }

  // Bir geçiş boyunca satır set kimliği bir kez okunur (checklist-components-engine).
  function applyPersonalLayer(baseModel, rows, options) {
    return Checklist.Components.withRowCache(() => applyPersonalLayerNow(baseModel, rows, options));
  }
  function applyPersonalLayerNow(baseModel, rows, options) {
    const opts = options || {};
    if (OD && typeof OD.setPriorityCatalog === 'function') OD.setPriorityCatalog(state.priorityCatalog);
    const baseOrders = baseModel && Array.isArray(baseModel.orders) ? baseModel.orders : [];
    const signature = personalDeltaSignature();
    if (!personalDelta || personalDelta.signature !== signature || personalDelta.rules !== state.rules) resetPersonalDelta(signature);
    const delta = personalDelta;
    // Yükseltme yalnız sipariş/opsiyon kimlik alanlarını okur; temel analizle aynı sonucu verir.
    if (promoteReusableChecklistAnswers(baseOrders)) reusableAnswerPromotionPending = true;
    if (opts.commit && reusableAnswerPromotionPending && saveAnswers({ silent: true })) reusableAnswerPromotionPending = false;
    delta.epoch += 1;
    const incremental = recordAnswerChanges(delta);
    if (!incremental) { delta.entries = new WeakMap(); delta.contributions = new WeakMap(); delta.orderEpochs.clear(); delta.optionEpochs.clear(); }
    delta.snapshot = new Map(Object.entries(state.answers || {}));
    const preparedRules = typeof Rules.prepareEvaluation === 'function' ? Rules.prepareEvaluation(state.rules) : null;
    const evaluations = new Map();
    const customItems = new Map();
    const autoUpdates = [];
    const orders = new Array(baseOrders.length);
    const evaluateFresh = base => {
      const analysis = cloneAnalysis(base);
      const evaluated = Rules.evaluateOrder(analysis, {
        rules: state.rules,
        preparedRules,
        answers: state.answers,
        plmEvidence,
        checklistEnabled: state.checklistSettings.enabled,
        priorityCatalog: state.priorityCatalog,
      });
      const entry = { clone: analysis, evaluated, epoch: delta.epoch, optionId: undefined };
      delta.entries.set(base, entry);
      return entry;
    };

    for (let index = 0; index < baseOrders.length; index += 1) {
      const base = baseOrders[index];
      const entry = (incremental && reusablePersonalEntry(delta, base)) || evaluateFresh(base);
      const analysis = entry.clone, evaluated = entry.evaluated;
      orders[index] = analysis;
      evaluations.set(analysis, evaluated);
      customItems.set(analysis.orderKey, evaluated.customItems);
      if (opts.commit && Array.isArray(evaluated.autoDecisions) && evaluated.autoDecisions.length) {
        for (const auto of evaluated.autoDecisions) autoUpdates.push({ analysis, itemId: auto.itemId, state: auto.state });
      }
    }

    if (autoUpdates.length) {
      let dirty = false;
      const nowIso = new Date().toISOString();
      for (const item of autoUpdates) {
        const key = Checklist.answerKey(item.analysis.orderKey, item.itemId);
        const existing = state.answers[key];
        if (existing && existing.source !== 'auto_rule') continue;
        if (!existing || existing.state !== item.state) {
          state.answers[key] = Checklist.makeAnswer(item.state, item.analysis, { source: 'auto_rule', at: nowIso });
          // Özet bu analizi güncel cevapla yeniden saymalı.
          delta.contributions.delete(item.analysis);
          dirty = true;
        }
      }
      if (dirty) saveAnswers({ silent: true });
    }

    const byRow = new Map();
    const byOrderKey = new Map();
    for (let i = 0; i < orders.length; i += 1) {
      const analysis = orders[i];
      const applied = evaluations.get(analysis);
      analysis.basePriority = analysis.basePriority || analysis.priority;
      analysis.priority = applied.priority;
      analysis.trackingTags = applied.trackingTags || [];
      analysis.checklistState = applied.checklistState;
      analysis.ruleState = applied.ruleState;
      analysis.matchedRules = (applied.matched || []).map(rule => ({
        id: rule.id,
        name: rule.name,
        nameEn: String(rule.nameEn || ''),
        target: rule.target,
        reasonCode: customRuleReasonCode(rule.id),
        reasonTr: String(rule.reasonTr || ''),
        reasonEn: String(rule.reasonEn || ''),
        custom: rule.builtIn !== true,
      }));
      if (analysis.sourceRow) byRow.set(analysis.sourceRow, analysis);
      else if (rows && rows[i]) byRow.set(rows[i], analysis);
      if (analysis.orderKey) byOrderKey.set(analysis.orderKey, analysis);
    }

    const rawModel = {
      ...baseModel,
      loadingPlan: Object.fromEntries(Object.entries(baseModel.loadingPlan || {}).map(([bucketKey, bucket]) => {
        const copyBucket = { ...bucket };
        const baseItems = Array.isArray(bucket.items) ? bucket.items : [];
        const mappedItems = baseItems.map(oldItem => byRow.get(oldItem.sourceRow) || byOrderKey.get(oldItem.orderKey) || oldItem);
        Object.defineProperty(copyBucket, 'items', { value: mappedItems, enumerable: false, configurable: true });
        return [bucketKey, copyBucket];
      })),
    };
    Object.defineProperty(rawModel, 'orders', { value: orders, enumerable: false, configurable: true });
    const model = Engine.recount(rawModel, undefined, { priorityCatalog: state.priorityCatalog });

    const checklist = Checklist.summarize(orders, {
      settings: state.checklistSettings,
      answers: state.answers,
      plmEvidence,
      managedItemIds: Rules.DEFAULT_CHECKLIST_RULE_IDS,
      customItemsFor: analysis => customItems.get(analysis.orderKey) || [],
      contributionCache: delta.contributions,
    });

    if (opts.commit) {
      state.model = model;
      state.checklist = checklist;
    }
    return { model, checklist, byRow, byOrderKey };
  }

  function analyzeRowsWithPersonalRules(rows, options) {
    const list = Array.isArray(rows) ? rows : [];
    const opts = options || {};
    const key = fullDecisionKey();
    if (!opts.commit && Array.isArray(rows)) {
      const cached = personalDecisionCache.get(rows);
      if (cached && cached.key === key) return cached.result;
    }
    const ctx = baseDecisionContext();
    const baseModel = decisionRuntime
      ? decisionRuntime.compute(list, ctx)
      : Engine.analyze(list, ctx);
    const result = applyPersonalLayer(baseModel, list, opts);
    if (Array.isArray(rows)) personalDecisionCache.set(rows, { key: fullDecisionKey(), result });
    return result;
  }

  async function analyzeRowsWithPersonalRulesAsync(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const expectedKey = fullDecisionKey();
    if (Array.isArray(rows)) {
      const cached = personalDecisionCache.get(rows);
      if (cached && cached.key === expectedKey) return cached.result;
    }
    const ctx = baseDecisionContext();
    const baseModel = decisionRuntime
      ? await decisionRuntime.computeAsync(list, ctx)
      : Engine.analyze(list, ctx);
    if (!baseModel || fullDecisionKey() !== expectedKey) return null;
    const result = applyPersonalLayer(baseModel, list, { commit: false });
    if (fullDecisionKey() !== expectedKey) return null;
    if (Array.isArray(rows)) personalDecisionCache.set(rows, { key: expectedKey, result });
    return result;
  }

  function computeDecisionsForRows(rows) {
    return analyzeRowsWithPersonalRules(rows, { commit: false });
  }
  function computeDecisionsForRowsAsync(rows) {
    return analyzeRowsWithPersonalRulesAsync(rows);
  }
  function peekDecisionsForRows(rows) {
    if (!Array.isArray(rows)) return null;
    const cached = personalDecisionCache.get(rows);
    return cached && cached.key === fullDecisionKey() ? cached.result : null;
  }
  function decisionRuntimeStats() {
    return decisionRuntime ? decisionRuntime.getStats() : { completed: 0, failed: 0, cancelled: 0, workerJobs: 0, fallbackJobs: 0 };
  }

  function recompute() {
    if (!lastRows) { state.model = null; state.checklist = null; return; }
    analyzeRowsWithPersonalRules(lastRows, { commit: true });
  }

  function invalidateOverview() {
    state.rowsSignature = '';
  }

  function onOverviewRendered(rows, context = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const dataRevision = Number(context && context.dataRevision) || 0;
    const filterRevision = String(context && context.filterRevision || '');
    const firstKey = list[0] ? String(list[0]['Order Code'] || list[0]._id || '') : '';
    const datasetSignature = dataRevision > 0
      ? `rev:${dataRevision}|f:${filterRevision}`
      : `fallback:${list.length}:${firstKey}|f:${filterRevision}`;
    const signature = `${datasetSignature}|decision:${decisionContextRevision}|target:${state.settings.targetType}|lang:${lang()}`;
    const sameRows = lastRows === list && state.rowsSignature === signature && state.model;
    lastRows = list;
    if (!sameRows) {
      window.BLPerf?.mark?.('PRODUCTION_FOCUS_RECOMPUTE');
      state.rowsSignature = signature;
      recompute();
    }
    render();
  }

  loadPrefs();
  if (migrateRuleStores && !unreadablePreferenceStores.size) {
    try { savePrefs(); } catch (_) {}
  }
  void loadManagedRules();
  function onPlmSampleRequestsChanged() {
    notifyDecisionContextChanged('plm-sample-requests');
    if (lastRows) { state.rowsSignature = ''; onOverviewRendered(lastRows, { dataRevision: window.BL_CP_DECISION_DATA_REVISION?.() || 0, filterRevision: 'plm-evidence' }); }
    if (managedRulesRedraw) managedRulesRedraw();
  }
  window.addEventListener('bl:plm-requests-changed', onPlmSampleRequestsChanged);
  const plmApi = sampleRequests();
  if (typeof plmApi?.load === 'function') void plmApi.load().then(data => {
    if (data?.loaded && Object.keys(data.models || {}).length) onPlmSampleRequestsChanged();
  }).catch(() => {});

  window.BLCpAssistant = {
    onOverviewRendered,
    invalidateOverview,
    openStudio,
    refreshLanguage: () => { render(); if (managedRulesRedraw) managedRulesRedraw(); },
    openChecklist,
    openRules,
    openSettings,
    openRuleManager,
    openOverviewRows,
    selectPriority,
    addPriorityTag,
    updatePriorityTag,
    movePriorityTag,
    deletePriorityTag,
    setChecklistAnswer,
    setChecklistComponents,
    persistChecklistAnswers: saveAnswers,
    batchChecklistAnswers,
    // Test/kabul: bir sonraki kişisel katman hesabını tam hesaba zorlar.
    _resetDecisionDelta: () => { personalDelta = null; },
    adoptSharedChecklistDefinitions,
    validateHologramOrders,
    markHologramOrdered,
    computeDecisionsForRows,
    computeDecisionsForRowsAsync,
    peekDecisionsForRows,
    decisionRuntimeStats,
    decisionContextRevision: () => decisionContextRevision,
    _state: state,
  };
})();
