/* Buyer Log v9.48 — BUGÜNÜN ÜRETİM ÖNCELİKLERİ (görünüm katmanı)
 *
 * İş mantığı BURADA DEĞİL: hesap cp-readiness-engine.js'te, kontrol listesi
 * cp-checklist-engine.js'te. Bu dosya yalnız çizer, tıklamayı bağlar ve
 * kullanıcı tercihlerini saklar.
 *
 * TEK VERİ KAYNAĞI: kendi filtresini KURMAZ. Genel Bakış ekranındaki aktif
 * CP kümesi (ovFilteredCpRows) neyse analiz de onu okur — yetki ve filtre
 * zaten o kümeye uygulanmıştır.
 *
 * KULLANICIYA ÖZEL: açık kartlar, kontrol listesi ayarları ve verilen
 * cevaplar BLStorage üzerinden kullanıcı bazında saklanır; bir
 * kullanıcının ayarı diğerini etkilemez.
 */
(function () {
  'use strict';
  const Engine = window.BLCpReadinessEngine;
  const Checklist = window.BLCpChecklistEngine;
  const Rules = window.BLCpRulesEngine;
  if (!Engine || !Checklist || !Rules) return;

  const PREF_KEY = 'lcw.cp.assistant.v1';
  const ANSWER_KEY = 'lcw.cp.checklist.v1';
  /* v7.221 — Öncelik kuralları ve checklist soruları KİŞİYE ÖZELDİR ve kendi
     anahtarlarında durur. Ayrı anahtar, Ön Ayar Paylaşımı'nın bu iki alanı
     ayrı ayrı (ve diğer görünüm tercihlerinden bağımsız) aktarabilmesi içindir. */
  const RULE_KEYS = Object.freeze({
    priority: 'lcw.cp.rules.priority.v1',
    checklist: 'lcw.cp.rules.checklist.v1',
  });
  // v2: kullanıcı tarafından oluşturulan checklistlerde Onaylandı aynı
  // PLM + Model + Renk seçeneğinin diğer PO'larına varsayılan olarak taşınır.
  const CHECKLIST_RULE_STORE_VERSION = 2;
  const ATTENTION_DEFAULT_COLUMNS = Object.freeze([
    'sys:priority', 'sys:order', 'sys:style', 'sys:supplier',
    'sys:age', 'sys:toLoad', 'sys:target', 'sys:reason',
  ]);
  const ATTENTION_EXCLUSION_SCOPE = Object.freeze({ REASON: 'reason', ORDER: 'order' });

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
    // Eski ortak (sunucu) checklist başlıkları bir kez kişisel kayda alındı mı?
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
  const priorityLabel = key => Engine.PRIORITY_LABELS[lang()][key] || key;
  const reasonLabel = key => Engine.RISK_REASON_LABELS[lang()][key] || key;
  const itemLabel = item => (isEn() ? item.en : item.tr);
  const questionOf = item => (isEn() ? item.questionEn : item.questionTr);

  function dateText(ordinal) {
    if (ordinal == null) return '—';
    const date = new Date(Number(ordinal) * 86400000);
    return isNaN(date) ? '—' : date.toISOString().slice(0, 10);
  }

  /* KULLANICI BAZLI SAKLAMA: BLStorage ZORUNLU.
     Ham localStorage kullanmak bu anahtarları kullanıcı önekinden kaçırır —
     aynı makinedeki iki kullanıcı aynı kontrol ayarlarını ve aynı "tamamlandı"
     cevaplarını paylaşırdı. Önekler user-storage.js'in İKİ listesine de
     kayıtlı; okuma/yazma o sarmalayıcıdan geçmeli. */
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

  /* Ekran okunamayan tercihlerde de açılır; hasarlı kayıt korunur ve
     varsayılanlar onun üzerine kaydedilmez. Kural anahtarları ayrıca okunur. */
  let migrateRuleStores = false;
  function loadPrefs() {
    let parsed = null;
    try {
      parsed = JSON.parse(store.get(PREF_KEY) || 'null');
      if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Invalid preference store');
      if (parsed && ((parsed.rules != null && !Array.isArray(parsed.rules)) || (parsed.deletedRuleIds != null && !Array.isArray(parsed.deletedRuleIds)))) throw new Error('Invalid legacy rule store');
    } catch (_) { parsed = null; unreadablePreferenceStores.add(PREF_KEY); }
    try {
      // Görünüm tercihi hiç kaydedilmemiş olsa da (ör. kurallar Ön Ayar
      // Paylaşımı ile alındı) kişisel kural anahtarları okunmalı.
      const raw = parsed && typeof parsed === 'object' ? parsed : {};
      {
        // Üretim Öncelikleri artık tek, sabit Buyer görünümünde çalışır.
        // Eski kullanıcı tercihlerindeki merchandiser/manager perspektiflerini bilinçli olarak yok say.
        state.perspective = 'buyer';
        if (raw.settings && raw.settings.targetType === 'inStore') state.settings.targetType = 'inStore';
        state.checklistSettings = Checklist.normalizeSettings(raw.checklistSettings);
        state.hidden = raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {};
        const stored = loadRuleStores(raw);
        state.deletedRuleIds = stored.deletedRuleIds;
        state.sharedChecklistAdopted = stored.sharedChecklistAdopted;
        state.rules = Rules.mergeWithDefaults(stored.rules, state.deletedRuleIds);
        raw.rules = stored.rules;
        if (stored.needsMigration) migrateRuleStores = true;

        /* v9.49 ve öncesinde ön tanımlı checklist ayarları rules içinde değil,
           checklistSettings.items altında tutuluyordu. İlk geçişte kullanıcının
           aç/kapat ve gün eşiği tercihlerini kaybetmeden yeni rule kayıtlarına
           taşırız. Rule daha önce yeni editörden kaydedildiyse ona dokunmayız. */
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
  /* Kural kayıtları. Yeni anahtar yoksa (ilk açılış) eski PREF_KEY içindeki
     rules/deletedRuleIds okunur; ilk kayıtta yeni anahtarlara taşınır. */
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
    const defaultKind = id => (Rules.DEFAULT_RULES.find(rule => rule.id === id) || {}).kind;
    // Yeni anahtar (ör. Ön Ayar Paylaşımı ile) gelmiş ama eski kayıt henüz
    // taşınmamışsa eski kurallar KAYBOLMAZ: yeni anahtarda olmayanlar eklenir.
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
    // v1'de yeni checklistlerin varsayılanı yanlışlıkla PO bazlıydı. Kullanıcı
    // checklistleri v2'de aynı ürün seçeneğine taşınır; yerleşik kontroller
    // bilinçli olarak PO bazlı kalır. Kullanıcı isterse editörden tekrar
    // "Her PO'da tekrar kontrol et" seçebilir ve v2'de bu tercih korunur.
    const checklistRules = rawChecklistRules.map(rule => {
      if (!checklistScopeMigration || !rule || rule.builtIn === true || rule.approvalScope === 'option') return rule;
      return { ...rule, approvalScope: 'option' };
    });
    const rules = [...withLegacy(priority, 'priority'), ...checklistRules];
    const deleted = [
      ...(priority ? priority.deletedRuleIds || [] : []),
      ...(checklist ? checklist.deletedRuleIds || [] : []),
      ...legacyDeleted,
    ];
    return {
      rules,
      deletedRuleIds: [...new Set(deleted.map(String).filter(Boolean))],
      sharedChecklistAdopted: Boolean(checklist && checklist.sharedChecklistAdopted),
      // Eski kayıttaki kurallar yeni (hesaba bağlı) anahtarlara bir kez yazılır;
      // ayrıca v1 checklist scope'u v2'ye bir kez yükseltilir.
      needsMigration: legacyRules.length > 0 || legacyDeleted.length > 0 || checklistScopeMigration,
    };
  }
  function ruleStorePayload(kind) {
    const defaults = new Set(Rules.DEFAULT_RULES.filter(rule => rule.kind === kind).map(rule => rule.id));
    return {
      version: kind === 'checklist' ? CHECKLIST_RULE_STORE_VERSION : 1,
      rules: state.rules.filter(rule => rule.kind === kind),
      deletedRuleIds: state.deletedRuleIds.filter(id => defaults.has(id)),
      ...(kind === 'checklist' ? { sharedChecklistAdopted: state.sharedChecklistAdopted === true } : {}),
    };
  }
  function saveRules() {
    store.set(RULE_KEYS.priority, JSON.stringify(ruleStorePayload('priority')));
    store.set(RULE_KEYS.checklist, JSON.stringify(ruleStorePayload('checklist')));
  }

  let decisionContextRevision = 0;
  function notifyDecisionContextChanged(reason) {
    decisionContextRevision += 1;
    try {
      window.dispatchEvent(new CustomEvent('bl:cp-decision-context-changed', {
        detail: { reason: reason || 'preferences', revision: decisionContextRevision },
      }));
    } catch (_) { /* eski browser: persistence yine çalışır */ }
  }
  function savePrefs() {
    try {
      if (unreadablePreferenceStores.size) throw new Error(L('Okunamayan ayar/kural kaydı korundu. Kaydı kurtarmadan değişiklik kaydedilemez.', 'The unreadable settings/rules record was preserved. Recover it before saving changes.'));
      // Legacy kurallar PREF_KEY'den ancak iki yeni kayıt da yazıldıktan sonra çıkar.
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
    if (!options || options.silent !== true) notifyDecisionContextChanged('checklist-answer');
    return saved;
  }

  /* Tek cevap yazma yolu: Genel Bakış listesi ve CP hücresi aynı kanonik
     durumu yazar. Pending dahil tüm seçimler ek bilgileriyle saklanır. */
  function setChecklistAnswer(analysis, itemId, status, meta) {
    if (!analysis || !analysis.orderKey || !itemId) return false;
    const key = Checklist.answerKey(analysis.orderKey, itemId);
    const next = Checklist.normalizeStatus(status) || 'open';
    const rule = state.rules.find(item => item && item.kind === 'checklist' && item.id === itemId);
    const reusable = Boolean(rule && rule.approvalScope === 'option' && typeof Checklist.optionAnswerKey === 'function');
    const optionKey = reusable ? Checklist.optionAnswerKey(analysis, itemId) : '';
    const by = (window.BL_USER_CONTEXT || {}).id || '';
    const previous = state.answers[key] || (optionKey ? state.answers[optionKey] : null) || {};
    // Durum değişikliği rapor numarası / gerçekleşme tarihi / ekleri SİLMEZ.
    // Kullanıcı ayrıntı penceresinde alanı açıkça boşaltırsa meta içindeki boş
    // değer eski değerin üzerine yazar.
    const preserved = {};
    ['note', 'reportNumber', 'actualDate', 'attachments'].forEach(field => {
      if (Object.prototype.hasOwnProperty.call(previous, field)) preserved[field] = previous[field];
    });
    const answerMeta = { ...preserved, ...(meta || {}), by };
    // Millisecond-equal rapid edits must still have a strictly ordered identity.
    const remoteAt = window.BLChecklistSupplierSync && typeof window.BLChecklistSupplierSync.latestAnswerAt === 'function'
      ? Math.max(window.BLChecklistSupplierSync.latestAnswerAt(key), optionKey ? window.BLChecklistSupplierSync.latestAnswerAt(optionKey) : 0) : 0;
    const lastAt = Math.max(Date.parse(previous.at || '') || 0, state.lastAnswerAt || 0, remoteAt);
    answerMeta.at = new Date(Math.max(Date.now(), lastAt + 1)).toISOString();
    state.lastAnswerAt = Date.parse(answerMeta.at);

    if (next === 'open') {
      state.answers[key] = Checklist.makeAnswer('open', analysis, answerMeta);
      // "Bekliyor" seçimi paylaşılan onayı da geri alır; aksi hâlde hücre
      // anında yeniden Approved görünürdü.
      if (optionKey && state.answers[optionKey]) {
        state.answers[optionKey] = Checklist.makeAnswer('open', analysis, { ...state.answers[optionKey], at: answerMeta.at, by, loadDate: null });
      }
    } else if (next === 'approved' && optionKey) {
      // Aynı PLM ID + Model Name + Colour Code için kalıcı seçenek onayı.
      // Yükleme tarihi PO'ya özgü olduğundan bu cevap tarihe bağlanmaz.
      state.answers[key] = Checklist.makeAnswer(next, analysis, answerMeta);
      state.answers[optionKey] = Checklist.makeAnswer(next, analysis, { ...answerMeta, loadDate: null });
    } else {
      // Rejected / Not Required PO'ya özeldir ve paylaştırılmaz. PO cevabı,
      // varsa seçenek onayının üzerinde istisna olarak önceliklidir.
      state.answers[key] = Checklist.makeAnswer(next, analysis, answerMeta);
    }
    saveAnswers();
    return true;
  }

  /* Test Raporu Aktarımı: talep tipi Buyer Log'da karşılığı olmayan bir
     adımsa kullanıcı önizlemede yeni adım açabilir. Kural editöründeki
     "Yeni kontrol" ile aynı yoldan kaydedilir; rapor numarası ve ek kanıt
     alanları açık gelir. Kapsam geniştir (yüklemeye 365 gün), kullanıcı
     Kurallar ekranında daraltabilir. */
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

  /* Eski sürümde checklist başlıkları sunucuda TÜM kullanıcılar için ortaktı.
     Artık kişiseldir: ortak listede olup kullanıcıda olmayan başlıklar YALNIZ
     BİR KEZ kişisel kayda alınır (kimse mevcut sorusunu kaybetmez); sonrasında
     başka kullanıcının değişikliği bu kullanıcıyı etkilemez. Paylaşım Ön Ayar
     Paylaşımı ile yapılır. */
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
    if(lastRows){state.rowsSignature='';onOverviewRendered(lastRows,{dataRevision:window.BL_CP_DECISION_DATA_REVISION?.()||0,filterRevision:'adopted-checklist'});}
    return incoming.length > 0;
  }

  /* ------------------------------------------------------------- perspektif
     Perspektif YETKİYİ DEĞİŞTİRMEZ; yalnız varsayılan kart kapsamını/sırasını belirler. */
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

  function activeModuleLayout() {
    // Üretim Öncelikleri artık perspektif seçmez; tek canonical görünüm Buyer'dır.
    const perspective = 'buyer';
    state.perspective = perspective;
    state.moduleLayout[perspective] = normalizeLayoutEntry(state.moduleLayout[perspective], perspective);
    return state.moduleLayout[perspective];
  }

  /* ------------------------------------------------------------------ çizim */
  function host() { return document.getElementById('cpAssistant'); }
  function attentionHost() { return document.getElementById('cpAssistantAttention'); }
  function coverageHost() { return document.getElementById('cpAssistantCoverage'); }

  function toolbarHtml() {
    return `<div class="cpaBar">
      <div class="cpaTitle"><b>${esc(L('Bugünün Üretim Öncelikleri', "Today's Production Focus"))}</b>
        <small>${esc(L('Yükleme, tarih ve teslimat risklerini tek yerde takip et.', 'Track loading, date and delivery risks in one place.'))}</small></div>
      <div class="cpaBarActions">
        <div class="cpaSeg" role="group" aria-label="${esc(L('Hedef tarih', 'Target date'))}">
          <button type="button" data-cpa-target="retail" class="${state.settings.targetType !== 'inStore' ? 'is-on' : ''}">${esc(L('Retail Depo', 'Retail'))}</button>
          <button type="button" data-cpa-target="inStore" class="${state.settings.targetType === 'inStore' ? 'is-on' : ''}">${esc(L('In Store', 'In Store'))}</button>
        </div>
        <button type="button" class="cpaBtn" data-cpa-rules>${esc(L('Kurallar', 'Rules'))}</button>
        <button type="button" class="cpaBtn" data-cpa-settings>${esc(L('Kontrol Ayarları', 'Checklist Settings'))}</button>
        <button type="button" class="cpaBtn" data-cpa-layout>${esc(L('Düzen', 'Customize Layout'))}</button>
      </div>
    </div>`;
  }

  function prioritiesCard() {
    const model = state.model;
    const order = ['CRITICAL', 'ACTION_TODAY', 'ACTION_THIS_WEEK', 'WATCH', 'ON_TRACK', 'UNKNOWN'];
    const tone = { CRITICAL: 'red', ACTION_TODAY: 'orange', ACTION_THIS_WEEK: 'yellow', WATCH: 'blue', ON_TRACK: 'green', UNKNOWN: 'gray' };
    const byKey = new Map(model.priorities.map(item => [item.name, item]));
    const chips = order.map(key => {
      const measure = byKey.get(key) || { rows: 0, qty: 0 };
      return `<button type="button" class="cpaChip tone-${tone[key]} ${state.activePriority === key ? 'is-on' : ''}" data-cpa-priority="${key}" ${measure.rows ? '' : 'disabled'}>
        <span class="n">${int(measure.rows)}</span><span class="l">${esc(priorityLabel(key))}</span><span class="q">${int(measure.qty)} ${esc(L('adet', 'units'))}</span></button>`;
    }).join('');
    /* Öncelik dağılım çubuğu: eski CP Öncelik Radarı'nın yerini alır. Aynı
       sipariş sayılarını tek eksende, pay olarak gösterir; renk yanında her
       parçanın başlığı ve çiplerdeki metin etiketi vardır. */
    const totalRows = order.reduce((sum, key) => sum + ((byKey.get(key) || { rows: 0 }).rows || 0), 0);
    const mix = totalRows ? `<div class="cpaMix" role="img" aria-label="${esc(L('Öncelik dağılımı', 'Priority mix'))}">${order.map(key => {
      const rows = (byKey.get(key) || { rows: 0 }).rows || 0;
      if (!rows) return '';
      const share = Math.round(rows / totalRows * 1000) / 10;
      return `<button type="button" class="cpaMixSeg tone-${tone[key]}" style="flex:${rows} 0 0" data-cpa-priority="${key}" title="${esc(`${priorityLabel(key)} · ${int(rows)} · %${share}`)}" aria-label="${esc(`${priorityLabel(key)} ${int(rows)}`)}"></button>`;
    }).join('')}</div>` : '';
    const reasons = model.riskReasons.slice(0, 6).map(item => {
      const label = reasonLabel(item.name);
      const automateLabel = L('Bu konu için e-mail otomasyonu oluştur', 'Create an email automation for this issue');
      return `<li class="cpaReasonRow">
        <button type="button" class="cpaIconBtn cpaReasonEmailAction" data-cpa-automate-reason="${esc(item.name)}" title="${esc(automateLabel)}" aria-label="${esc(automateLabel)}">✉</button>
        <button type="button" class="cpaReasonMain" data-cpa-reason="${esc(item.name)}" title="${esc(label)}"><span class="cpaReasonTitle">${esc(label)}</span><b class="cpaReasonCount">${int(item.count)}</b></button>
      </li>`;
    }).join('');
    /* Seçili öncelik için otomasyon: ekranda görünen kırılım koşula BİREBİR
       taşınır, kullanıcı filtreyi otomasyon ekranında yeniden kurmaz. */
    const active = state.activePriority;
    const canAutomate = active !== 'ALL' && !active.startsWith('REASON:');
    return card('priorities', L('Öncelikler', 'Priorities'), `
      ${mix}
      <div class="cpaChips">${chips}</div>
      ${canAutomate ? `<div class="cpaRowBetween"><span class="cpaNote">${esc(priorityLabel(active))} · ${int((byKey.get(active) || { rows: 0 }).rows)} ${esc(L('sipariş satırı', 'order rows'))}</span>
        <button type="button" class="cpaBtn sm" data-cpa-automate-priority="${esc(active)}">✉ ${esc(L('Otomasyon oluştur', 'Create automation'))}</button></div>` : ''}
      ${reasons ? `<ul class="cpaReasons">${reasons}</ul>` : ''}`);
  }

/* Tarih Senkronu KARTI kaldırıldı (kullanıcı: "bu alan gereksiz").
   Hesap motorda duruyor: ASAS ile Buyer Log tarihi ayrışırsa bu, sebep
   listesinde DATE_SYNC_MISMATCH olarak yine görünür — kart, ayrışma
   olmadığında sürekli üç sıfır göstermek dışında bir iş yapmıyordu. */

  function checklistCard() {
    const summary = state.checklist;
    if (!state.checklistSettings.enabled) {
      return card('checklist', L('Kontrol Listesi', 'Checklist'),
        `<p class="cpaNote">${esc(L('Kontrol listesi kapalı. Ayarlardan açabilirsiniz.', 'The checklist is off. You can turn it on in settings.'))}</p>`);
    }
    const items = summary.items.map(item => `<tr>
      <td><b>${esc(itemLabel(item))}</b><small>${esc(questionOf(item))}</small></td>
      <td class="num">${int(item.rows - (item.rejected || 0))}${item.plmOpen ? ` <span class="cpaPlm tone-wait" title="${esc(L('PLM\'de açık numune talebi olan sipariş', 'Orders with an open sample request in PLM'))}">PLM ${int(item.plmOpen)}</span>` : ''}${item.plmRejected ? ` <span class="cpaPlm tone-bad" title="${esc(L('PLM\'de reddedilmiş numune talebi olan sipariş', 'Orders with a rejected sample request in PLM'))}">PLM ${int(item.plmRejected)}</span>` : ''}</td>
      <td class="num">${item.rejected ? `<span class="cpaFlag tone-bad" title="${esc(L('Reddedildi olarak işaretlenen sipariş', 'Orders marked as rejected'))}">${int(item.rejected)}</span>` : ''}</td>
      <td class="num">${item.reopened ? `<span class="cpaFlag" title="${esc(L('Yükleme tarihi değişti; kayıtlı seçim korundu', 'Load date changed; the saved decision was kept'))}">${int(item.reopened)}</span>` : ''}</td>
      <td class="act"><button type="button" class="cpaBtn sm" data-cpa-open-checklist="${esc(item.id)}">${esc(L('Aç', 'Open'))}</button></td>
    </tr>`).join('');
    const disabled = summary.disabled.length
      ? `<p class="cpaNote">${esc(L('Takip edilmeyen kontroller', 'Not tracked'))}: ${summary.disabled.map(item => esc(itemLabel(item))).join(', ')}</p>` : '';
    return card('checklist', L('Kontrol Listesi', 'Checklist'), `
      <p class="cpaNote">${esc(L('Her soru CP\'de bir checklist sütunudur. Durumlar: Bekliyor · Onaylandı · Reddedildi · Gerekmiyor. Onaylandı ya da Gerekmiyor seçilen soru tekrar sorulmaz; Reddedildi açık kalır. PPS, S/Off, kritik numune ve Artwork soruları PLM\'de onaylı numune talebi varsa (PPS onayı Fit, S/Off ve Artwork\'ü de kapsar; S/Off onayı Artwork\'ü kapsar) ya da sipariş üretimi bitirdiyse kendiliğinden Onaylandı olur.', 'Every question is a checklist column in CP. Statuses: Pending · Approved · Rejected · Not Required. Approved or Not Required stops the question; Rejected stays open. PPS, S/Off, critical sample and artwork questions become Approved automatically when PLM has an approved sample request (PPS approval also covers Fit, S/Off and artwork; S/Off approval covers artwork) or when the order has finished production.'))}</p>
      ${items ? `<table class="cpaTable"><thead><tr><th>${esc(L('Kontrol', 'Check'))}</th><th class="num">${esc(L('Bekliyor', 'Pending'))}</th><th class="num">${esc(L('Reddedildi', 'Rejected'))}</th><th class="num">${esc(L('Yeniden', 'Re-asked'))}</th><th></th></tr></thead><tbody>${items}</tbody></table>`
    : `<p class="cpaEmpty">${esc(L('Şu an açık kontrol yok.', 'No open checks right now.'))}</p>`}
      ${summary.answeredTotal ? `<p class="cpaNote">${esc(L('Onaylanan / gerekmeyen kontrol', 'Approved / not required checks'))}: <b>${int(summary.answeredTotal)}</b>${summary.plmAnsweredTotal ? ` · ${esc(L('PLM onayı / üretim sonrası ile', 'via PLM approval / post-production'))}: <b>${int(summary.plmAnsweredTotal)}</b>` : ''}</p>` : ''}
      ${sampleRequests() ? `<div class="cpaRowBetween"><span class="cpaNote">${esc(L('PLM numune senkronu', 'PLM sample sync'))}: ${esc(sampleRequests().updatedAt ? new Date(sampleRequests().updatedAt).toLocaleString(locale()) : L('henüz yapılmadı', 'not run yet'))}</span>
        <button type="button" class="cpaBtn sm" data-cpa-plm-requests-sync>${esc(L('PLM numune durumunu güncelle', 'Update PLM sample status'))}</button></div>` : ''}
      ${disabled}`);
  }

  function attentionCandidateRows() {
    const list = Engine.needsAttention(state.model, { limit: 5000 });
    if (state.activePriority === 'ALL') return list;
    if (state.activePriority.startsWith('REASON:')) {
      const reason = state.activePriority.slice(7);
      return list.filter(item => item.riskReasons.includes(reason));
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
    for (const reason of (Array.isArray(item && item.riskReasons) ? item.riskReasons : [])) {
      const code = String(reason || '').trim();
      if (code) push(code, reasonLabel(code), 'canonical');
    }
    for (const rule of (Array.isArray(item && item.matchedRules) ? item.matchedRules : [])) {
      if (!rule || rule.builtIn === true || rule.custom === false) continue;
      const code = String(rule.reasonCode || customRuleReasonCode(rule.id)).trim();
      const textValue = customRuleReasonText(rule);
      if (code && textValue) push(code, textValue, 'customRule');
    }
    return entries;
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

  /* Reason kapsamlı exclusion yalnız kayıtlı warning'i susturur. Aynı satırda
     yeni/farklı bir warning oluşursa o warning için eşleşme olmadığından sipariş
     yeniden görünür. Bütün mevcut warning'ler ayrı ayrı excluded ise satır gizlenir. */
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

  function attentionRows() {
    return attentionRowsState().visible;
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
    const tone = { CRITICAL: 'red', ACTION_TODAY: 'orange', ACTION_THIS_WEEK: 'yellow', WATCH: 'blue', UNKNOWN: 'gray' };
    if (column.source === 'cp') {
      const text = attentionCpValue(item, column);
      const numeric = ['int', 'num', 'money', 'moneyEdit', 'pct', 'plm'].includes(column.type);
      return `<td class="${numeric ? 'num ' : ''}cpaAttentionCell" title="${esc(text)}">${esc(text)}</td>`;
    }
    switch (column.id) {
      case 'sys:priority': return `<td><span class="cpaPill tone-${tone[item.priority] || 'gray'}">${esc(priorityLabel(item.priority))}</span></td>`;
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
      <div class="cpaRowBetween cpaAttentionToolbar"><span class="cpaNote">${int(all.length)} ${esc(L('görünür sipariş satırı', 'visible order rows'))}${excludedNote}${all.length > shown.length ? ` · ${esc(L('ilk', 'first'))} ${int(shown.length)}` : ''}</span><div class="cpaAttentionActions">${filterNote}<button type="button" class="cpaBtn sm ghost" data-cpa-attention-excluded>${esc(L('Hariç Tutulanlar', 'Excluded'))} (${int(exclusionCount)})</button><button type="button" class="cpaBtn sm" data-cpa-attention-columns>${esc(L('Sütunlar', 'Columns'))}</button></div></div>
      ${shown.length ? `<div class="cpaScroll cpaAttentionScroll"><table class="cpaTable cpaAttentionTable"><thead><tr>${head}<th class="cpaAttentionActionHead" aria-label="${esc(L('Aksiyon', 'Action'))}"></th></tr></thead><tbody>${body}</tbody></table></div>`
    : `<p class="cpaEmpty">${esc(L('Bu filtrede görünür aksiyon gereken sipariş yok.', 'No visible orders need action in this filter.'))}</p>`}
      ${all.length > shown.length ? `<button type="button" class="cpaBtn" data-cpa-more>${esc(L('Daha fazla göster', 'Show more'))}</button>` : ''}`);
  }

  function dimensionsCard() {
    const dims = [['manufacturer', L('Üretici', 'Supplier')], ['buyer', 'Buyer'], ['country', L('Ülke', 'Country')]];
    const blocks = dims.map(([key, label]) => {
      const rows = (state.model.dimensions[key] || []).slice(0, 6).map(item =>
        `<tr><td>${esc(item.name)}</td><td class="num">${int(item.rows)}</td><td class="num">${int(item.qty)}</td></tr>`).join('');
      return `<div class="cpaDim"><b>${esc(label)}</b><table class="cpaTable">${rows}</table></div>`;
    }).join('');
    return card('dimensions', L('Kırılımlar', 'Breakdowns'), `<div class="cpaDims">${blocks}</div>`);
  }

  function coverageCard() {
    const quality = state.model.dataQuality;
    // Kurulum hatasını veri sorunu gibi göstermek yanlış teşhise yol açar.
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
      ${engineWarning}
      ${missing ? `<b class="cpaSub">${esc(L('Eksik veri', 'Missing data'))}</b><ul class="cpaMiniList">${missing}</ul>` : ''}
      <b class="cpaSub">${esc(L('Buyer Log\'da bu veri tutulmuyor', 'Not stored in Buyer Log'))}</b>
      <p class="cpaNote">${esc(L('Aşağıdakiler sütun olarak yok; kontrol listesi soruları ve takip e-postaları üzerinden yürütülüyor. Bunlar için otomatik uyarı üretilmez.', 'The items below are not columns; they are handled through checklist questions and follow-up emails. No automatic warning is produced for them.'))}</p>
      <ul class="cpaMiniList is-plain">${unavailable}</ul>`);
  }

  function card(key, title, body) {
    const collapsed = state.hidden[key] === true;
    return `<section class="cpaCard" data-cpa-card="${key}">
      <header><b>${esc(title)}</b><button type="button" class="cpaToggle" data-cpa-collapse="${key}" aria-expanded="${collapsed ? 'false' : 'true'}">${collapsed ? '+' : '−'}</button></header>
      ${collapsed ? '' : `<div class="cpaCardBody">${body}</div>`}
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
      return;
    }
    const builders = { priorities: prioritiesCard, checklist: checklistCard, dimensions: dimensionsCard };
    const layout = activeModuleLayout();
    const hidden = new Set(layout.hidden);
    const visible = layout.order.filter(key => !hidden.has(key) && builders[key]);
    const cards = visible.map(key => builders[key]()).join('');
    container.innerHTML = toolbarHtml() + `<div class="cpaGrid${visible.length === 1 ? ' is-single' : ''}">${cards || `<div class="cpaLayoutEmpty">${esc(L('Bu görünümde tüm modüller gizli. Düzen ayarlarından tekrar gösterebilirsiniz.', 'All modules are hidden in this view. Use Customize Layout to show them again.'))}</div>`}</div>`;
    if (attention) attention.innerHTML = attentionCard();
    if (coverage) coverage.innerHTML = coverageCard();
    bind(container);
    if (attention) bind(attention);
    if (coverage) bind(coverage);
  }

  /* ------------------------------------------------------------ etkileşim */
  function bind(container) {
    container.querySelectorAll('[data-cpa-target]').forEach(el => el.onclick = () => {
      state.settings.targetType = el.dataset.cpaTarget === 'inStore' ? 'inStore' : 'retail';
      savePrefs(); recompute(); render();
    });
    container.querySelectorAll('[data-cpa-collapse]').forEach(el => el.onclick = () => {
      const key = el.dataset.cpaCollapse; state.hidden[key] = !state.hidden[key]; savePrefs(); render();
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
    const settings = container.querySelector('[data-cpa-settings]');
    if (settings) settings.onclick = openSettings;
    const rulesBtn = container.querySelector('[data-cpa-rules]');
    if (rulesBtn) rulesBtn.onclick = openRules;
    const attentionColumnsBtn = container.querySelector('[data-cpa-attention-columns]');
    if (attentionColumnsBtn) attentionColumnsBtn.onclick = openAttentionColumns;
    const layoutBtn = container.querySelector('[data-cpa-layout]');
    if (layoutBtn) layoutBtn.onclick = openModuleLayout;
    container.querySelectorAll('[data-cpa-automate-priority]').forEach(el => el.onclick = () => automateFromPriority(el.dataset.cpaAutomatePriority));
    container.querySelectorAll('[data-cpa-automate-reason]').forEach(el => el.onclick = event => { event.preventDefault(); event.stopPropagation(); automateFromReason(el.dataset.cpaAutomateReason); });
  }

  /* ------------------------------------------------------- modül yerleşimi
     Görünürlük ve sıra yalnız PRESENTATION tercihidir. Perspektifin mevcut
     modül kapsamını genişletmez; böylece layout ayarı yetki/veri semantiğine
     dönüşmez. Loading Plan bu registry'de bilinçli olarak yoktur. */
  function openModuleLayout() {
    document.querySelector('.cpaLayoutOverlay')?.remove();
    const perspective = 'buyer';
    state.perspective = perspective;
    const current = normalizeLayoutEntry(state.moduleLayout[perspective], perspective);
    let order = current.order.slice();
    let hidden = new Set(current.hidden);
    let dragId = '';

    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaLayoutOverlay';
    modal.innerHTML = `<div class="cpaModal cpaLayoutModal" role="dialog" aria-modal="true" aria-labelledby="cpaLayoutTitle">
      <header><div><b id="cpaLayoutTitle">${esc(L('Üretim Odağı Düzenini Özelleştir', 'Customize Production Focus'))}</b>
        <small>${esc(L('Modülleri gizleyin veya sürükleyerek sıralarını değiştirin.', 'Hide modules or drag them to change their order.'))}</small></div>
        <button type="button" data-cpa-layout-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody cpaLayoutBody">
        <div class="cpaLayoutSummary"><span>${esc(L('Görünür modüller', 'Visible modules'))}</span><b data-cpa-layout-count></b></div>
        <div class="cpaLayoutList" data-cpa-layout-list></div>
        <p class="cpaNote">${esc(L('Kartın sağ üstündeki −/+ düğmesi yalnız daraltır; burada kapattığınız modül ise ekrandan tamamen gizlenir.', 'The −/+ button on a card only collapses it; a module turned off here is removed from the layout.'))}</p>
      </div>
      <footer><button type="button" class="cpaBtn ghost" data-cpa-layout-reset>${esc(L('Varsayılana dön', 'Reset to default'))}</button><span class="cpaLayoutFooterSpacer"></span><button type="button" class="cpaBtn ghost" data-cpa-layout-cancel>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="cpaBtn cpaLayoutApply" data-cpa-layout-apply>${esc(L('Uygula', 'Apply'))}</button></footer>
    </div>`;
    document.body.appendChild(modal);

    const list = modal.querySelector('[data-cpa-layout-list]');
    const count = modal.querySelector('[data-cpa-layout-count]');
    function move(id, delta) {
      const index = order.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= order.length) return;
      [order[index], order[next]] = [order[next], order[index]];
      draw();
    }
    function draw() {
      count.textContent = `${order.filter(id => !hidden.has(id)).length}/${order.length}`;
      list.innerHTML = order.map((id, index) => {
        const meta = MODULE_META[id];
        if (!meta) return '';
        const visible = !hidden.has(id);
        return `<div class="cpaLayoutItem${visible ? '' : ' is-hidden'}" draggable="true" data-cpa-layout-item="${esc(id)}">
          <span class="cpaLayoutDrag" aria-hidden="true">≡</span>
          <label class="cpaCheck cpaLayoutCheck"><input type="checkbox" data-cpa-layout-visible="${esc(id)}"${visible ? ' checked' : ''}><span><b>${esc(meta.label())}</b><small>${esc(visible ? L('Görünür', 'Visible') : L('Gizli', 'Hidden'))}</small></span></label>
          <div class="cpaLayoutMove"><button type="button" class="cpaIconBtn" data-cpa-layout-up="${esc(id)}"${index === 0 ? ' disabled' : ''} title="${esc(L('Yukarı taşı', 'Move up'))}" aria-label="${esc(L('Yukarı taşı', 'Move up'))}">↑</button><button type="button" class="cpaIconBtn" data-cpa-layout-down="${esc(id)}"${index === order.length - 1 ? ' disabled' : ''} title="${esc(L('Aşağı taşı', 'Move down'))}" aria-label="${esc(L('Aşağı taşı', 'Move down'))}">↓</button></div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-cpa-layout-visible]').forEach(el => el.onchange = () => {
        const id = el.dataset.cpaLayoutVisible;
        if (el.checked) hidden.delete(id); else hidden.add(id);
        draw();
      });
      list.querySelectorAll('[data-cpa-layout-up]').forEach(el => el.onclick = () => move(el.dataset.cpaLayoutUp, -1));
      list.querySelectorAll('[data-cpa-layout-down]').forEach(el => el.onclick = () => move(el.dataset.cpaLayoutDown, 1));
      list.querySelectorAll('[data-cpa-layout-item]').forEach(el => {
        el.ondragstart = event => {
          dragId = el.dataset.cpaLayoutItem;
          el.classList.add('is-dragging');
          if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragId); }
        };
        el.ondragend = () => {
          dragId = '';
          list.querySelectorAll('.cpaLayoutItem').forEach(item => item.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
        };
        el.ondragover = event => {
          if (!dragId || dragId === el.dataset.cpaLayoutItem) return;
          event.preventDefault();
          const rect = el.getBoundingClientRect();
          const after = event.clientY > rect.top + rect.height / 2;
          el.classList.toggle('is-drop-before', !after);
          el.classList.toggle('is-drop-after', after);
        };
        el.ondragleave = () => el.classList.remove('is-drop-before', 'is-drop-after');
        el.ondrop = event => {
          event.preventDefault();
          const targetId = el.dataset.cpaLayoutItem;
          if (!dragId || dragId === targetId) return;
          const rect = el.getBoundingClientRect();
          const after = event.clientY > rect.top + rect.height / 2;
          order = order.filter(id => id !== dragId);
          let targetIndex = order.indexOf(targetId);
          if (after) targetIndex += 1;
          order.splice(Math.max(0, targetIndex), 0, dragId);
          dragId = '';
          draw();
        };
      });
    }

    const close = () => modal.remove();
    modal.querySelector('[data-cpa-layout-close]').onclick = close;
    modal.querySelector('[data-cpa-layout-cancel]').onclick = close;
    modal.querySelector('[data-cpa-layout-reset]').onclick = () => {
      order = (CARD_ORDER[perspective] || CARD_ORDER.buyer).slice();
      hidden = new Set();
      draw();
    };
    modal.querySelector('[data-cpa-layout-apply]').onclick = () => {
      state.moduleLayout[perspective] = normalizeLayoutEntry({ order, hidden: [...hidden] }, perspective);
      savePrefs();
      close();
      render();
    };
    modal.onclick = event => { if (event.target === modal) close(); };
    modal.onkeydown = event => { if (event.key === 'Escape') close(); };
    draw();
    modal.querySelector('[data-cpa-layout-close]')?.focus();
  }

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
    modal.className = 'cpaModalOverlay cpaAttentionExcludeOverlay';
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
          ${warnings.length > 1 ? `<small>${esc(L('Bu siparişte birden fazla aktif uyarı var. Yalnız seçtiğiniz uyarı hariç tutulur; diğerleri siparişi görünür tutabilir.', 'This order has multiple active warnings. Only the selected warning is excluded; others may keep the order visible.'))}</small>` : ''}
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
      savePrefs();
      close();
      render();
    };
    modal.querySelector('[data-cpa-exclude-close]')?.focus();
  }

  function openAttentionExcluded() {
    document.querySelector('.cpaAttentionExcludedOverlay')?.remove();
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaAttentionExcludedOverlay';
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
        savePrefs();
        render();
        draw();
      });
    }

    const close = () => modal.remove();
    modal.querySelectorAll('[data-cpa-excluded-close]').forEach(button => button.onclick = close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    draw();
    modal.querySelector('[data-cpa-excluded-close]')?.focus();
  }

  /* Drill-down mevcut CP ekranını kullanır; ikinci bir liste kurulmaz. */
  function openAttentionDetail(orderKey) {
    const item = state.model && state.model.orders ? state.model.orders.find(row => row.orderKey === orderKey) : null;
    if (!item || !item.sourceRow || !window.BLDetailDrawer?.open) {
      if (item && item.orderCode) openInCp(item.orderCode);
      return;
    }
    const columns = attentionCpColumns().map(column => ({ key: column.key, label: column.label || column.key }));
    window.BLDetailDrawer.open({
      storageKey:'cp.attention.detail',source:'cp',
      title:`CP · ${item.orderCode || L('Sipariş Detayı','Order Detail')}`,
      subtitle:[item.modelName,item.colourCode,item.dims && item.dims.manufacturer].filter(Boolean).join(' · '),
      rows:[item.sourceRow],columns,images:true,fileName:`CP_${item.orderCode || 'Detail'}`,
      actions:[{label:L('CP’de Aç','Open in CP'),run:()=>openInCp(item.orderCode)}]
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

  /* ------------------------------------------------ attention sütunları */
  function openAttentionColumns() {
    document.querySelector('.cpaAttentionColumnsOverlay')?.remove();
    const catalog = attentionColumnCatalog();
    const byId = new Map(catalog.map(col => [col.id, col]));
    let selectedOrder = normalizeAttentionColumns(state.attentionColumns).filter(id => byId.has(id));
    if (!selectedOrder.length) selectedOrder = ATTENTION_DEFAULT_COLUMNS.filter(id => byId.has(id));
    let selected = new Set(selectedOrder);
    let dragId = '';

    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay cpaAttentionColumnsOverlay';
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
      if (checked) {
        if (!selected.has(id)) selectedOrder.push(id);
        selected.add(id);
      } else {
        selected.delete(id);
        selectedOrder = selectedOrder.filter(key => key !== id);
      }
      status.textContent = '';
      draw();
    }

    optionsHost.addEventListener('change', event => {
      const input = event.target.closest('input[data-cpa-column-id]');
      if (input) setSelected(input.dataset.cpaColumnId, input.checked);
    });
    search.addEventListener('input', drawOptions);
    selectedHost.addEventListener('click', event => {
      const button = event.target.closest('[data-cpa-selected-remove]');
      if (button) setSelected(button.dataset.cpaSelectedRemove, false);
    });
    selectedHost.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-cpa-selected-id]');
      if (!row) return;
      dragId = row.dataset.cpaSelectedId;
      row.classList.add('is-dragging');
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
      dragId = '';
      drawSelected();
    });
    selectedHost.addEventListener('dragend', () => {
      dragId = '';
      selectedHost.querySelectorAll('.is-dragging,.is-drop-before,.is-drop-after').forEach(el => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
    });

    modal.querySelector('[data-cpa-columns-select-all]').onclick = () => {
      selected = new Set(catalog.map(column => column.id));
      selectedOrder = catalog.map(column => column.id);
      status.textContent = ''; draw();
    };
    modal.querySelector('[data-cpa-columns-clear-optional]').onclick = () => {
      selectedOrder = attentionSystemColumns().map(column => column.id).filter(id => byId.has(id));
      selected = new Set(selectedOrder); status.textContent = ''; draw();
    };
    modal.querySelector('[data-cpa-columns-reset]').onclick = () => {
      selectedOrder = ATTENTION_DEFAULT_COLUMNS.filter(id => byId.has(id));
      selected = new Set(selectedOrder); status.textContent = ''; draw();
    };
    modal.querySelector('[data-cpa-columns-apply]').onclick = () => {
      if (!selectedOrder.length) {
        status.textContent = L('En az bir sütun seçin.', 'Select at least one column.');
        return;
      }
      state.attentionColumns = selectedOrder.slice();
      savePrefs(); modal.remove(); render();
    };
    const close = () => modal.remove();
    modal.querySelectorAll('[data-cpa-columns-close]').forEach(button => button.onclick = close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.appendChild(modal);
    draw();
    setTimeout(() => search.focus(), 0);
  }

  /* --------------------------------------------------------- kontrol listesi */
  function plmCell(analysis, itemId) {
    const api = sampleRequests();
    if (!api) return '';
    const plmId = api.plmIdOfRow(analysis.sourceRow, 'cp');
    if (!plmId) return '';
    const badge = api.evidenceBadge(api.evidenceForAnalysis(analysis, itemId));
    return `<button type="button" class="cpaBtn sm ghost" data-cpa-plm-open="${esc(plmId)}" data-cpa-plm-title="${esc(analysis.modelName)}" title="${esc(L('PLM numune taleplerini göster', 'Show PLM sample requests'))}">${badge || esc(L('Talep yok', 'No request'))}</button>`;
  }

  /* Açık numune sorusu olan siparişlerin PLM ID'leri PLM'den tazelenir.
     Onaylı olanlar zaten listeden düşer; tekrar sormaya gerek yok. */
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

  const STATUS_TONE = Object.freeze({ open: 'blue', approved: 'green', rejected: 'red', notRequired: 'gray' });
  const statusText = status => Checklist.statusLabel(status, lang());
  function statusButtons(orderKey, current) {
    return Checklist.statusIds().map(status => `<button type="button" class="cpaStatusBtn tone-${STATUS_TONE[status] || 'gray'}${current === status ? ' is-on' : ''}" data-cpa-answer="${status}" data-cpa-key="${esc(orderKey)}" aria-pressed="${current === status ? 'true' : 'false'}">${esc(statusText(status))}</button>`).join('');
  }

  function openChecklist(itemId) {
    const bucket = state.checklist.items.find(item => item.id === itemId);
    if (!bucket) return;
    const orders = bucket.allOrders || bucket.orders;
    const currentStatus = analysis => {
      const byOrder = state.checklistStateByOrder && state.checklistStateByOrder.get(analysis.orderKey);
      return (byOrder && byOrder[itemId]) || 'open';
    };
    const rows = orders.slice(0, 300).map(analysis => `<tr data-cpa-answer-row="${esc(analysis.orderKey)}">
      <td>${esc(analysis.orderCode)}</td>
      <td>${esc(analysis.modelName)} <small>${esc(analysis.colourCode)}</small></td>
      <td>${esc(analysis.dims.manufacturer)}</td>
      <td class="num">${analysis.daysToLoad == null ? '—' : int(analysis.daysToLoad)}</td>
      <td>${plmCell(analysis, itemId)}</td>
      <td class="act"><div class="cpaStatusGroup" role="group" aria-label="${esc(L('Durum', 'Status'))}">${statusButtons(analysis.orderKey, currentStatus(analysis))}</div></td></tr>`).join('');
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    modal.innerHTML = `<div class="cpaModal cpaChecklistAnswerModal"><header>
        <div><b>${esc(itemLabel(bucket))}</b><small>${esc(questionOf(bucket))}</small></div>
        <button type="button" data-cpa-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody">
        <p class="cpaNote">${esc(L('Seçimler anında kaydedilir. Yükleme tarihi değişse de durum, not ve ekler korunur. Reddedildi aksiyon ister; Bekliyor seçimi ek bilgileri silmez.', 'Selections are saved immediately. Status, notes and attachments survive load date changes. Rejected needs action; Pending keeps the evidence.'))}</p>
        <div class="cpaScroll"><table class="cpaTable"><thead><tr>
          <th>${esc(L('Sipariş', 'Order'))}</th><th>${esc(L('Model', 'Style'))}</th><th>${esc(L('Üretici', 'Supplier'))}</th>
          <th class="num">${esc(L('Yükleme', 'To load'))}</th><th>PLM</th><th class="num">${esc(L('Durum', 'Status'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <footer><button type="button" class="cpaBtn" data-cpa-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); recompute(); render(); };
    modal.querySelectorAll('[data-cpa-close]').forEach(el => el.onclick = close);
    modal.onclick = event => { if (event.target === modal) close(); };
    modal.querySelectorAll('[data-cpa-plm-open]').forEach(el => el.onclick = () => {
      const api = sampleRequests();
      if (api) api.openForPlm(el.dataset.cpaPlmOpen, el.dataset.cpaPlmTitle || '');
    });
    modal.querySelectorAll('[data-cpa-answer]').forEach(el => el.onclick = () => {
      const analysis = orders.find(item => item.orderKey === el.dataset.cpaKey);
      if (!analysis) return;
      const status = el.dataset.cpaAnswer;
      setChecklistAnswer(analysis, itemId, status);
      const row = modal.querySelector(`[data-cpa-answer-row="${CSS.escape(analysis.orderKey)}"]`);
      if (row) {
        row.classList.toggle('is-answered', Checklist.isResolved(status));
        row.querySelectorAll('[data-cpa-answer]').forEach(button => {
          const on = button.dataset.cpaAnswer === status;
          button.classList.toggle('is-on', on);
          button.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    });
  }

  /* Checklist Settings = checklist soruları + checklist aç/kapat. Öncelik
     kuralları yalnız Rules penceresinde durur. */
  function openSettings() { openRuleManager('checklist'); }

  /* -------------------------------------------------- analizden otomasyon
     Ekrandaki kırılım, otomasyon koşuluna BİREBİR aynı alan adıyla taşınır.
     Alan adları sunucudaki zenginleştirme katmanıyla (server/lib/cp-automation.js)
     aynı olmak ZORUNDA: ayrışırsa kullanıcı kurduğu otomasyonun hiçbir şey
     eşleştirmediğini ancak Pazartesi sabahı fark ederdi. */
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
    openAutomation({
      source: 'cp',
      name: `CP · ${reasonLabel(reason)}`,
      description: L(`CP Overview'daki "${reasonLabel(reason)}" risk sebebinden oluşturuldu.`,
        `Created from the "${reasonLabel(reason)}" risk reason on the CP Overview.`),
      // Sebepler tek alanda " · " ile birleştiriliyor; bu yüzden "içerir".
      filters: [{ field: AUTOMATION_FIELDS.riskReasons, operator: 'contains', value: Engine.RISK_REASON_LABELS.tr[reason] || reason }],
      recipientField: 'Manufacturer',
      subject: reasonLabel(reason),
      reportFields: ['Order Code', 'Model Name', 'Ex-factory', 'Order Quantity', AUTOMATION_FIELDS.daysToLoad, AUTOMATION_FIELDS.riskReasons],
      backlog: { targetType: state.settings.targetType },
    });
  }

  /* ------------------------------------------------------- kural düzenleyici
     v7.221 — Kullanıcı talebi: "Rules'da sadece Rules ayarları olsun,
     checklist questions'u checklist settings'e taşı. Kural oluşturmak aşırı
     basit olsun (Calculated Columns gibi pratik)."

     TEK düzenleyici iki yerden açılır:
       · Rules              → yalnız öncelik kuralları
       · Checklist Settings → yalnız checklist soruları (+ checklist aç/kapat)
     Yerleşik kurallar da burada görünür ve düzenlenebilir: gizli kural kalırsa
     kullanıcı bir siparişin neden Kritik olduğunu göremez.

     Sadeleştirme ilkeleri:
       · Koşul satırı düz bir cümledir: [Alan] [işlem] [değer]. Alan aranabilir
         listeden seçilir; işlem ve değer alanın türüne göre daralır (checklist
         alanı için yalnız Pending/Approved/Rejected/Not Required seçilir).
       · Alan-alan / TODAY() karşılaştırması ve gün farkı "⇄" ile açılan
         gelişmiş satırda durur; çoğu kullanıcı onu hiç görmez.
       · Her kural canlı önizleme gösterir: "şu an N sipariş eşleşiyor".
       · Karmaşık iş için Formül ve AI yardımı (Markdown rehber + yapıştır,
         doğrula, uygula). AI cevabı asla çalıştırılmaz; Buyer Log'un kendi
         ayrıştırıcısıyla doğrulanır. */
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

  /* Checklist ve öncelik başlıkları canlı kural listesinden okunur: yeni
     eklenen başlık anında koşul olarak seçilebilir, silinen görünmez. */
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

  // Düzenlenen kural kendi koşulunda seçilemez (kendine bağlı kural anlamsız).
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

  /* Alanın türü: seçilebilir değer listesi olan (durum / aşama / öncelik),
     sayısal, CP sütunu ya da serbest metin. İşlem ve değer kontrolü buna göre
     daralır; kullanıcıya anlamsız seçenek gösterilmez. */
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
    if (fieldId === '@basePriority') return values.map(value => ({ value, label: priorityLabel(value) }));
    if (fieldId === '@transitRuleMissing') return values.map(value => ({ value, label: value === 'true' ? L('Evet', 'Yes') : L('Hayır', 'No') }));
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

  /* Aranabilir alan seçici: uzun native <select> yerine gruplu, aramalı
     liste. Menü, değer seçicisiyle AYNI body portalını ve konumlandırmayı
     kullanır (modal kaydırılınca kırpılmaz). */
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
      if (operand.type === 'field') return fieldLabel(operand.field, rule);
      if (operand.type === 'today') return L('bugün', 'today');
      const list = Array.isArray(operand.value) ? operand.value : [operand.value];
      return ['checklist', 'rule', 'enum'].includes(kind) ? list.map(enumLabel).join(', ') : list.join(', ');
    };
    const needsValue = !['empty', 'notEmpty'].includes(item.operator);
    return [operandLabel(item.left), operatorLabel(item.operator), needsValue ? operandLabel(item.right) : '']
      .filter(Boolean).join(' · ');
  }

  function ruleSummary(rule) {
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
    return ({ CRITICAL: 'red', ACTION_TODAY: 'orange', ACTION_THIS_WEEK: 'yellow', WATCH: 'blue' })[rule.target] || 'gray';
  }

  function ruleBadge(rule) {
    return rule.kind === 'priority' ? priorityLabel(rule.target) : L('Checklist', 'Checklist');
  }

  // Arayüz dilindeki kural adı; kullanıcı adı değiştirdiyse onun yazdığı ad.
  function ruleName(rule) {
    if (!rule) return '';
    const value = isEn() ? (rule.nameEn || (rule.kind === 'checklist' ? rule.en : '') || rule.name) : rule.name;
    return String(value || '').trim() || L('Adsız kural', 'Unnamed rule');
  }
  function ruleNames(list) {
    return list.map(item => `"${ruleName(item)}"`).join(', ');
  }

  /* Kuralın canlı etkisi: bugünkü Genel Bakış kümesinde kaç sipariş eşleşiyor.
     Kapalı kural için "açılırsa" sonucu gösterilir. Kayıt değiştirmez. */
  function rulePreview(rule) {
    const orders = state.model && Array.isArray(state.model.orders) ? state.model.orders : null;
    if (!orders) return null;
    const probe = rule.enabled ? rule : Object.assign(Object.create(Object.getPrototypeOf(rule)), rule, { enabled: true });
    const rules = state.rules.map(item => (item.id === rule.id ? probe : item));
    let count = 0;
    let qty = 0;
    const sample = [];
    for (const analysis of orders) {
      const result = Rules.evaluateOrder(analysis, {
        rules, answers: state.answers, plmEvidence, checklistEnabled: state.checklistSettings.enabled,
      });
      const hit = rule.kind === 'checklist'
        ? result.customItems.some(item => item.id === rule.id)
        : result.ruleState[rule.id] === 'matched';
      if (!hit) continue;
      count += 1;
      qty += Number(analysis.qty) || 0;
      if (sample.length < 4) sample.push(`${analysis.orderCode || ''} ${analysis.modelName || ''}`.trim());
    }
    return { count, qty, total: orders.length, sample };
  }

  function previewHtml(rule) {
    const preview = rulePreview(rule);
    if (!preview) return `<span class="cpaNote">${esc(L('Önizleme Genel Bakış verisi yüklenince görünür.', 'The preview appears once Overview data is loaded.'))}</span>`;
    const head = rule.kind === 'checklist'
      ? L(`Bu soru şu an ${int(preview.count)} siparişe soruluyor`, `This question is asked for ${int(preview.count)} orders right now`)
      : L(`Bu kural şu an ${int(preview.count)} siparişi yükseltiyor`, `This rule escalates ${int(preview.count)} orders right now`);
    return `<b>${esc(head)}</b><span>${esc(L(`${int(preview.total)} siparişin içinde · ${int(preview.qty)} adet`, `out of ${int(preview.total)} orders · ${int(preview.qty)} units`))}${!rule.enabled ? ` · ${esc(L('kural kapalı; açılırsa', 'rule is off; if enabled'))}` : ''}</span>${preview.sample.length ? `<small>${esc(L('Örnek', 'e.g.'))}: ${esc(preview.sample.join(' · '))}</small>` : ''}`;
  }

  function conditionRow(rule, condition, index, advanced) {
    const kind = fieldKind(condition.field, rule);
    const allowed = OPERATORS_BY_KIND[kind] || OPERATORS_BY_KIND.text;
    const operatorIds = allowed.includes(condition.operator) ? allowed : [condition.operator, ...allowed];
    const operators = operatorIds.map(id => Rules.OPERATORS.find(item => item.id === id)).filter(Boolean).map(item =>
      `<option value="${item.id}"${item.id === condition.operator ? ' selected' : ''}>${esc(isEn() ? item.en : item.tr)}</option>`).join('');
    const left = condition.left || { type: 'field', field: condition.field };
    const right = condition.right || { type: 'value', value: condition.value };
    const canCompare = !['checklist', 'rule', 'enum'].includes(kind);
    const rightTypeSelect = advanced && canCompare
      ? `<select class="cpaCondRightType" data-cpa-cond-right-type aria-label="${esc(L('Neyle karşılaştırılsın', 'Compare with'))}">${operandTypeOptions(right.type || 'value')}</select>`
      : '';
    const leftOffset = advanced && canCompare ? offsetControl(left, 'left', rule) : '';
    const rightOffset = advanced && canCompare && right.type !== 'value' ? offsetControl(right, 'right', rule) : '';
    return `<div class="cpaCondRow${advanced ? ' is-advanced' : ''}" data-cpa-cond="${esc(rule.id)}:${index}">
      <div class="cpaCondOperand" data-cpa-cond-left>${fieldPicker(rule, condition.field, 'left', 'data-cpa-cond-left-field')}${leftOffset}</div>
      <select data-cpa-cond-op aria-label="${esc(L('Koşul işlemi', 'Condition operator'))}">${operators}</select>
      <div class="cpaCondOperand">${rightTypeSelect}${valueControl(condition, rule)}${rightOffset}</div>
      ${canCompare ? `<button type="button" class="cpaIconBtn cpaCondAdvanced${advanced ? ' is-on' : ''}" data-cpa-cond-advanced aria-pressed="${advanced ? 'true' : 'false'}" title="${esc(L('Başka alanla veya bugünle karşılaştır, gün ekle', 'Compare with another field or today, add days'))}" aria-label="${esc(L('Gelişmiş karşılaştırma', 'Advanced comparison'))}">⇄</button>` : '<span></span>'}
      <button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-cond-remove title="${esc(L('Koşulu sil', 'Remove condition'))}" aria-label="${esc(L('Koşulu sil', 'Remove condition'))}"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>`;
  }

  const FORMULA_FUNCTIONS = Object.freeze([
    ['AND()', 'AND('], ['OR()', 'OR('], ['NOT()', 'NOT('], ['IN()', 'IN('], ['CONTAINS()', 'CONTAINS('],
    ['ISBLANK()', 'ISBLANK('], ['BETWEEN()', 'BETWEEN('], ['TODAY()', 'TODAY()'], ['IF()', 'IF('],
  ]);

  /* Kural şablonları: boş sayfa yerine en sık kurulan kalıptan başlanır.
     Şablon yalnız başlangıç koşulu üretir; sonuç her zaman düzenlenebilir. */
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
      { id: 'blank', title: L('Boş kural', 'Blank rule'), hint: L('Koşulları kendiniz seçin.', 'Choose the conditions yourself.'),
        rule: { name: L('Yeni kural', 'New rule'), target: 'ACTION_THIS_WEEK', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] } },
    ];
  }

  function copyToClipboard(textValue) {
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = textValue;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      area.remove();
      return ok;
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(textValue).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }

  function downloadText(fileName, textValue) {
    const blob = new Blob([textValue], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function aiGuideFor(kind, rule, request, autoStatus) {
    return Rules.buildAiGuide({ lang: lang(), kind, fields: catalogFor(rule),
      request: request || '', autoStatus: autoStatus || '' });
  }

  function ruleBlock(rule, view) {
    const isOpen = view.expandedRuleId === rule.id;
    const targets = Rules.SEVERITY.filter(key => key !== 'ON_TRACK' && key !== 'UNKNOWN');
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
        <label class="cpaRuleTarget"><span>${esc(L('Eşleşen siparişi şu önceliğe taşı', 'Escalate matching orders to'))}</span>
          <select data-cpa-rule-target>${targets.map(key =>
        `<option value="${key}"${rule.target === key ? ' selected' : ''}>${esc(priorityLabel(key))}</option>`).join('')}</select></label>`
      : `<label class="cpaRuleTarget cpaRuleNameField"><span>${esc(L('Başlık (CP sütunu)', 'Heading (CP column)'))}</span>
          <input class="cpaRuleName" data-cpa-rule-name value="${esc(ruleName(rule))}" placeholder="${esc(L('Örn. Fabric Test', 'e.g. Fabric Test'))}"></label>
        <label class="cpaRuleTarget cpaRuleQuestionField"><span>${esc(L('Soru', 'Question'))}</span>
          <input data-cpa-rule-question value="${esc(isEn() ? rule.questionEn : rule.questionTr)}" placeholder="${esc(L('Hologram siparişi verildi mi?', 'Has the hologram been ordered?'))}"></label>
        <label class="cpaRuleTarget cpaRuleApprovalScopeField"><span>${esc(L('Onay geçerliliği', 'Approval scope'))}</span>
          <select data-cpa-rule-approval-scope>
            <option value="order"${rule.approvalScope !== 'option' ? ' selected' : ''}>${esc(L('Her PO’da tekrar kontrol et', 'Repeat for every PO'))}</option>
            <option value="option"${rule.approvalScope === 'option' ? ' selected' : ''}>${esc(L('Aynı model/renkte diğer PO’lara taşı', 'Carry to other POs of the same model/colour'))}</option>
          </select>
          <small>${esc(L('Varsayılan davranış: aynı PLM + Model + Renk için Onaylandı tüm PO’larda geçerli olur. Reddedildi ve Gerekmiyor PO’ya özeldir.', 'Default: Approved is shared across POs with the same PLM + Model + Colour. Rejected and Not Required stay PO-specific.'))}</small>
        </label>
        <div class="cpaRuleTarget cpaRuleEvidenceFields"><span>${esc(L('Ek bilgi alanları', 'Evidence fields'))}</span>
          <div class="cpaRuleEvidenceChecks">
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="reportNumber"${rule.evidenceFields?.reportNumber ? ' checked' : ''}><span>${esc(L('Rapor numarası', 'Report number'))}</span></label>
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="actualDate"${rule.evidenceFields?.actualDate ? ' checked' : ''}><span>${esc(L('Gerçekleşme tarihi', 'Actual date'))}</span></label>
            <label class="cpaCheck"><input type="checkbox" data-cpa-rule-evidence="attachments"${rule.evidenceFields?.attachments ? ' checked' : ''}><span>${esc(L('Rapor / e-mail eki', 'Report / e-mail attachment'))}</span></label>
          </div>
          <small>${esc(L('Seçilen alanlar CP durum menüsündeki Checklist Detayları ekranında açılır.', 'Selected fields appear in Checklist Details from the CP status menu.'))}</small>
        </div>`;
    const automaticStatusFields = rule.kind === 'checklist' ? `<div class="cpaRuleTarget cpaRuleAutoStatus">
      <b>${esc(L('Koşula bağlı otomatik durum', 'Automatic status when a condition matches'))}</b>
      <small>${esc(L('Soru koşulundan bağımsızdır. Aşağıdaki formül TRUE olursa durum yazılır. Manuel kararlar korunur; koşul artık sağlanmasa bile daha önce kaydedilen durum kendiliğinden silinmez.', 'This is separate from the question condition. When the formula is TRUE, the status is saved. Manual decisions win and previously assigned states are not erased when the condition stops matching.'))}</small>
      <label><span>${esc(L('Otomatik yazılacak durum', 'Status to assign'))}</span>
        <select data-cpa-auto-status><option value="">${esc(L('Kapalı (otomatik yazma)', 'Disabled (do not auto-assign)'))}</option>
          ${Checklist.statusIds().map(id => `<option value="${esc(id)}"${rule.autoStatus === id ? ' selected' : ''}>${esc(Checklist.statusLabel(id, lang()))}</option>`).join('')}
        </select></label>
      <label><span>${esc(L('Otomatik atama koşulu (TRUE / FALSE)', 'Auto-assignment condition (TRUE / FALSE)'))}</span>
        <textarea rows="3" data-cpa-auto-formula spellcheck="false" placeholder="${esc(L('=IN([Aşama],"LOADING","IN_WAREHOUSE")', '=IN([Stage],"LOADING","IN_WAREHOUSE")'))}">${esc(Rules.formulaToDisplay(rule.autoFormula || '', catalogFor(rule), lang()))}</textarea></label>
      <small data-cpa-auto-feedback aria-live="polite">${esc(L('Örnek: Üretim bittiyse Approved yaz. Yalnızca doğrulanabilen veri alanlarını kullanın.', 'Example: Set Approved when production is finished. Use verifiable data fields only.'))}</small>
    </div>` : '';
    const reasonFields = rule.kind === 'priority'
      ? `<div class="cpaRuleReasons">
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Siparişte görünecek sebep (TR)', 'Reason shown on the order (TR)'))}</span>
            <input data-cpa-rule-reason-tr value="${esc(rule.reasonTr || '')}" placeholder="${esc('Örn. Sipariş retail aktarımı bekliyor')}"${rule.builtIn ? '' : ' required'} class="${!rule.builtIn && !String(rule.reasonTr || '').trim() ? 'is-invalid' : ''}">
            <small class="cpaRuleFieldError"${!rule.builtIn && !String(rule.reasonTr || '').trim() ? '' : ' hidden'}>${esc(L('Türkçe sebep zorunludur.', 'Turkish reason is required.'))}</small>
          </label>
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Siparişte görünecek sebep (EN)', 'Reason shown on the order (EN)'))}</span>
            <input data-cpa-rule-reason-en value="${esc(rule.reasonEn || '')}" placeholder="${esc('e.g. Order is awaiting retail transfer')}"${rule.builtIn ? '' : ' required'} class="${!rule.builtIn && !String(rule.reasonEn || '').trim() ? 'is-invalid' : ''}">
            <small class="cpaRuleFieldError"${!rule.builtIn && !String(rule.reasonEn || '').trim() ? '' : ' hidden'}>${esc(L('İngilizce sebep zorunludur.', 'English reason is required.'))}</small>
          </label>
        </div>`
      : '';
    const modeTab = (mode, label) => `<button type="button" id="cpa-rule-mode-${mode}-${esc(rule.id)}" role="tab" data-cpa-rule-mode="${mode}" aria-controls="cpa-rule-mode-panel-${esc(rule.id)}" aria-selected="${uiMode === mode ? 'true' : 'false'}" tabindex="${uiMode === mode ? '0' : '-1'}" class="${uiMode === mode ? 'is-on' : ''}">${esc(label)}</button>`;
    const modeEditor = `<div class="cpaRuleModeTabs" data-bl-tabs="segment" role="tablist" aria-label="${esc(L('Koşul yazma biçimi', 'How to write the condition'))}">
          ${modeTab('basic', L('Basit', 'Simple'))}${modeTab('formula', L('Formül', 'Formula'))}${modeTab('ai', L('✦ LCW AI’dan Destek Al', '✦ Get help from LCW AI'))}
        </div>`;
    const displayFormula = Rules.formulaToDisplay(rule.formula || '', catalogFor(rule), lang());
    const formulaEditor = `<div class="cpaFormulaEditor">
          <label class="cpaRuleTarget"><span>${esc(L('Formül — sonuç TRUE ise kural uygulanır', 'Formula — the rule applies when the result is TRUE'))}</span>
            <textarea data-cpa-rule-formula rows="5" spellcheck="false" placeholder="${esc(L('=AND([Yüklemeye kalan gün]<=14,IN([Kontrol: PPS onayı],"open","rejected"))', '=AND([Days to load]<=14,IN([Check: PPS approval],"open","rejected"))'))}">${esc(displayFormula)}</textarea>
          </label>
          <div class="cpaFormulaActions"><button type="button" class="cpaBtn sm" data-cpa-formula-test>${esc(L('Formülü test et', 'Test formula'))}</button><span data-cpa-formula-status class="cpaFormulaStatus"></span></div>
          <div data-cpa-formula-error class="cpaRuleFieldError" hidden></div>
          <div data-cpa-formula-diagnostics class="cpaFormulaDiagnostics" hidden></div>
          <div class="cpaFormulaFields"><span>${esc(L('Ekle', 'Insert'))}</span>${fieldPicker(rule, '', 'formula', 'data-cpa-formula-insert')}
            ${FORMULA_FUNCTIONS.map(([labelText, snippet]) => `<button type="button" class="cpaFormulaField" data-cpa-formula-fn="${esc(snippet)}">${esc(labelText)}</button>`).join('')}</div>
          <p class="cpaNote">${esc(L('Alan adlarını köşeli parantezle yazın: [Yüklemeye kalan gün]. Checklist alanı "open" (Pending), "approved", "rejected", "notRequired" ya da "notApplicable" değerini alır.', 'Write field names in square brackets: [Days to load]. A checklist field is "open" (Pending), "approved", "rejected", "notRequired" or "notApplicable".'))}</p>
        </div>`;
    const aiDraft = view.aiDraftOf(rule);
    /* LCW AI ortak paneli (public/lcwai-assistant.js) birincil yoldur; kural
       motorunun doğrulaması ve canlı önizlemesi aynıdır. Kopyala / yapıştır
       rehberi LCW AI erişimi olmayanlar için "Manuel yol" olarak durur. */
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
    const aiEditor = `${aiPurposeEditor}<div class="cpaLcwAi" data-cpa-lcwai-host></div>
        <details class="lcwaiManual"><summary>${esc(L('Manuel yol: rehberi başka bir AI aracına verin', 'Manual route: give the guide to another AI tool'))}</summary>
        <ol class="cpaAiSteps">
          <li><b>${esc(L('Ne istediğinizi kendi cümlenizle yazın', 'Describe what you want in your own words'))}</b>
            <textarea data-cpa-ai-request rows="3" maxlength="3000" placeholder="${esc(rule.kind === 'checklist'
      ? L('Örn. Minecraft ve Roblox lisanslı, yüklemeye 30 günden az kalan siparişlere sor.', 'e.g. Ask for Minecraft and Roblox orders that load within 30 days.')
      : L('Örn. Kumaş testi reddedilen ya da yüklemeye 7 gün kalıp hâlâ bekleyen siparişler.', 'e.g. Orders whose fabric test was rejected, or still pending 7 days before loading.'))}">${esc(aiDraft.request)}</textarea></li>
          <li><b>${esc(L('Rehberi AI aracınıza verin', 'Give the guide to your AI tool'))}</b>
            <div class="cpaAiRow">
              <button type="button" class="cpaBtn sm primary" data-cpa-ai-copy>${esc(L('Rehberi kopyala', 'Copy guide'))}</button>
              <button type="button" class="cpaBtn sm" data-cpa-ai-download>${esc(L('Rehberi indir (.md)', 'Download guide (.md)'))}</button>
            </div>
            <p class="cpaNote">${esc(L('Rehber Buyer Log kural dilini, fonksiyonları ve yalnız alan ADLARINI içerir; sipariş, fiyat veya tedarikçi verisi eklenmez. Şirketinizin izin verdiği bir AI aracını (ChatGPT vb.) kullanın.', 'The guide contains the Buyer Log rule language, functions and only field NAMES; no order, price or supplier data is included. Use an AI tool your company allows (ChatGPT etc.).'))}</p></li>
          <li><b>${esc(L('AI cevabını buraya yapıştırın', 'Paste the AI answer here'))}</b>
            <textarea data-cpa-ai-answer rows="3" spellcheck="false" placeholder="${esc(L('Cevabın tamamını yapıştırabilirsiniz; formül kendiliğinden bulunur ve denetlenir.', 'You can paste the whole answer; the formula is found and checked automatically.'))}">${esc(aiDraft.answer)}</textarea>
            <div class="cpaAiResult" data-cpa-ai-result aria-live="polite"></div></li>
        </ol></details>`;
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
    const panel = uiMode === 'ai' ? aiEditor : uiMode === 'formula' ? formulaEditor : basicEditor;
    const warnings = [
      dangling.length ? `<p class="cpaRuleWarn">${esc(L('Bu kural silinmiş bir başlığa bağlı; o koşul hiçbir siparişte sağlanmaz. Koşulu güncelleyin.', 'This rule refers to a deleted item; that condition never matches. Update the condition.'))}</p>` : '',
      cycle.length ? `<p class="cpaRuleWarn">${esc(L(`Döngüsel bağlantı: ${ruleNames(cycle)} bu kurala geri bağlı. Döngüdeki koşul sağlanmaz sayılır.`, `Circular link: ${ruleNames(cycle)} points back to this rule. The looped condition is treated as not matching.`))}</p>` : '',
      dependents.length ? `<p class="cpaNote cpaRuleUsedBy">${esc(L(`Şu kuralların koşulunda kullanılıyor: ${ruleNames(dependents)}`, `Used as a condition in: ${ruleNames(dependents)}`))}</p>` : '',
    ].join('');
    const body = isOpen ? `<div class="cpaRuleBody" id="cpa-rule-body-${esc(rule.id)}">
        <div class="cpaRuleHead">${editorFields}</div>
        ${reasonFields}
        ${automaticStatusFields}
        ${modeEditor}
        <div class="cpaRuleModePanel" id="cpa-rule-mode-panel-${esc(rule.id)}" role="tabpanel" aria-labelledby="cpa-rule-mode-${uiMode}-${esc(rule.id)}" tabindex="0">${panel}</div>
        <div class="cpaRulePreview" data-cpa-rule-preview aria-live="polite">${previewHtml(rule)}</div>
        ${warnings}
      </div>` : '';
    return `<div class="cpaRule${isOpen ? ' is-open' : ''}${rule.enabled ? '' : ' is-disabled'}" data-cpa-rule="${esc(rule.id)}">
      <header class="cpaRuleBar">
        <label class="cpaSwitch" title="${esc(L('Kuralı aç / kapat', 'Enable / disable rule'))}">
          <input type="checkbox" data-cpa-rule-enabled ${rule.enabled ? 'checked' : ''} aria-label="${esc(L('Kuralı etkinleştir', 'Enable rule'))}">
          <span class="cpaSwitchTrack" aria-hidden="true"><span></span></span>
        </label>
        <button type="button" class="cpaRuleSummary" data-cpa-rule-toggle aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="cpa-rule-body-${esc(rule.id)}">
          <span class="cpaPill tone-${ruleTone(rule)}">${esc(ruleBadge(rule))}</span>
          <span class="cpaRuleSummaryMain"><b>${esc(ruleName(rule))}</b><small>${esc(ruleSummary(rule))}</small></span>
          <span class="cpaRuleSummaryMeta">${esc(countText)} · ${esc(matchText)}</span>
        </button>
        <div class="cpaRuleActions">
          ${dangling.length ? `<span class="cpaPill tone-red" title="${esc(L('Silinmiş bir başlığa bağlı koşul var', 'A condition refers to a deleted item'))}">⚠ ${esc(L('Eksik bağlantı', 'Missing link'))}</span>` : ''}
          ${dependents.length ? `<span class="cpaUsedBy" title="${esc(L(`Kullanan: ${ruleNames(dependents)}`, `Used by: ${ruleNames(dependents)}`))}">${esc(L(`${dependents.length} kuralda kullanılıyor`, `Used in ${dependents.length}`))}</span>` : ''}
          ${rule.builtIn ? `<span class="cpaBuiltIn">${esc(L('Yerleşik', 'Built-in'))}</span>` : ''}
          <button type="button" class="cpaIconBtn" data-cpa-rule-edit title="${esc(L('Kuralı düzenle', 'Edit rule'))}" aria-label="${esc(L('Kuralı düzenle', 'Edit rule'))}"><svg class="ic"><use href="#i-pencil"/></svg></button>
          <button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-rule-delete title="${esc(L('Kuralı sil', 'Delete rule'))}" aria-label="${esc(L('Kuralı sil', 'Delete rule'))}"><svg class="ic"><use href="#i-trash"/></svg></button>
          <button type="button" class="cpaRuleChevron" data-cpa-rule-toggle aria-label="${esc(isOpen ? L('Kuralı daralt', 'Collapse rule') : L('Kuralı genişlet', 'Expand rule'))}" aria-expanded="${isOpen ? 'true' : 'false'}"><svg class="ic"><use href="#i-chevron-down"/></svg></button>
        </div>
      </header>
      ${body}
    </div>`;
  }

  function openRules() { openRuleManager('priority'); }

  /* kind: 'priority' → Rules penceresi; 'checklist' → Checklist Settings. */
  function openRuleManager(kind) {
    const managerKind = kind === 'checklist' ? 'checklist' : 'priority';
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    const activeTab = managerKind;
    let expandedRuleId = null;
    let showTemplates = false;
    let activeValuePicker = null;
    let activeValueMenu = null;
    let valuePositionRaf = 0;
    let previewTimer = 0;
    let backdropPointerStarted = false;
    const newPriorityRuleIds = new Set();
    const uiModes = new Map();
    const aiDrafts = new Map();
    const advancedRows = new Set();
    const valueMenuSafeMargin = 12;
    const valueMenuGap = 4;
    const view = {
      get expandedRuleId() { return expandedRuleId; },
      modeOf: rule => uiModes.get(rule.id) || (rule.mode === 'formula' ? 'formula' : 'basic'),
      aiDraftOf: rule => {
        if (!aiDrafts.has(rule.id)) aiDrafts.set(rule.id, { request: '', answer: '', purpose: 'question', autoStatus: rule.autoStatus || 'approved' });
        return aiDrafts.get(rule.id);
      },
      isAdvanced: (rule, index, condition) => advancedRows.has(`${rule.id}:${index}`)
        || Boolean(condition && ((condition.right && condition.right.type && condition.right.type !== 'value')
          || (condition.left && (condition.left.offset || condition.left.offsetField)))),
    };

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
      if (event.key !== 'Escape' || !activeValueMenu) return;
      event.preventDefault();
      event.stopPropagation();
      const toggle = activeValuePicker && activeValuePicker.querySelector('[data-cpa-value-toggle], [data-cpa-field-toggle]');
      closeValueMenu();
      if (toggle) toggle.focus();
    };

    const rulesFor = ruleKind => state.rules.filter(rule => rule.kind === ruleKind);
    const scrollToRule = id => requestAnimationFrame(() => {
      const row = modal.querySelector(`[data-cpa-rule="${CSS.escape(id)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest' });
      const focus = row.querySelector('[data-cpa-rule-name], [data-cpa-rule-question]');
      if (focus && !focus.value) focus.focus();
    });

    const templateStrip = () => `<div class="cpaTemplateStrip" role="group" aria-label="${esc(L('Şablondan başla', 'Start from a template'))}">
        <span class="cpaTemplateTitle">${esc(L('Nereden başlayalım?', 'How do you want to start?'))}</span>
        ${ruleTemplates(activeTab).map(template => `<button type="button" class="cpaTemplate" data-cpa-template="${esc(template.id)}"><b>${esc(template.title)}</b><small>${esc(template.hint)}</small></button>`).join('')}
      </div>`;

    const draw = () => {
      closeValueMenu();
      refreshFieldCatalog();
      const visible = rulesFor(activeTab);
      const isChecklist = activeTab === 'checklist';
      const note = isChecklist
        ? L('Her checklist sorusu CP\'de bir sütun olur. Koşul, sorunun hangi siparişlerde sorulacağını; Onay geçerliliği ise onayın PO bazında mı yoksa PLM + Model + Renk bazında mı tekrar kullanılacağını belirler. Durumlar: Bekliyor · Onaylandı · Reddedildi · Gerekmiyor.', 'Every checklist question becomes a CP column. The condition decides which orders are asked; Approval scope decides whether approval is per PO or reused by PLM + Model + Colour. Statuses: Pending · Approved · Rejected · Not Required.')
        : L('Kurallar önceliği yalnız YÜKSELTİR; hiçbir kural bir siparişi listeden düşüremez. Checklist durumları ve diğer kurallar koşul olarak seçilebilir.', 'Rules only escalate priority; no rule can drop an order from the list. Checklist statuses and other rules can be used as conditions.');
      const empty = isChecklist
        ? `<div class="cpaRulesEmpty"><b>${esc(L('Henüz checklist sorusu yok', 'No checklist questions yet'))}</b><span>${esc(L('Belirli sipariş koşullarında sorulacak kontroller ekleyin; her biri CP\'de sütun olur.', 'Add checks asked only when specific order conditions are met; each one becomes a CP column.'))}</span><button type="button" class="cpaBtn" data-cpa-add-checklist>+ ${esc(L('Checklist sorusu ekle', 'Add checklist question'))}</button></div>`
        : `<div class="cpaRulesEmpty"><b>${esc(L('Öncelik kuralı yok', 'No priority rules'))}</b><span>${esc(L('Siparişleri aksiyon önceliğine taşıyan bir kural ekleyin.', 'Add a rule that escalates orders to an action priority.'))}</span><button type="button" class="cpaBtn" data-cpa-add-priority>+ ${esc(L('Öncelik kuralı ekle', 'Add priority rule'))}</button></div>`;
      const title = isChecklist ? L('Kontrol Ayarları', 'Checklist Settings') : L('Öncelik Kuralları', 'Priority Rules');
      const subtitle = isChecklist
        ? L('Checklist sorularını, kime sorulacağını ve durumlarını tek yerden yönetin.', 'Manage checklist questions, who is asked and their statuses in one place.')
        : L('Bir siparişin neden Kritik ya da aksiyonluk olduğunu belirleyen koşulları yönetin.', 'Manage the conditions that decide why an order is critical or needs action.');
      const settingsStrip = isChecklist ? `<div class="cpaChecklistSettingsStrip">
            <label class="cpaSwitch cpaSwitchLabeled"><input type="checkbox" data-cpa-master ${state.checklistSettings.enabled ? 'checked' : ''}><span class="cpaSwitchTrack" aria-hidden="true"><span></span></span><b>${esc(L('Checklist açık', 'Checklist enabled'))}</b></label>
            <span class="cpaNote">${esc(L('PPS, S/Off, kritik numune ve Artwork soruları PLM\'de onaylı numune talebi varsa kendiliğinden Onaylandı olur.', 'PPS, S/Off, critical sample and artwork questions become Approved automatically when PLM has an approved sample request.'))}</span>
          </div>` : '';
      const addButton = isChecklist
        ? `<button type="button" class="cpaBtn cpaRulesAdd" data-cpa-new-rule aria-expanded="${showTemplates ? 'true' : 'false'}">+ ${esc(L('Checklist sorusu', 'Checklist question'))}</button>`
        : `<button type="button" class="cpaBtn cpaRulesAdd" data-cpa-new-rule aria-expanded="${showTemplates ? 'true' : 'false'}">+ ${esc(L('Öncelik kuralı', 'Priority rule'))}</button>`;
      modal.innerHTML = `<div class="cpaModal cpaRulesModal" role="dialog" aria-modal="true" aria-labelledby="cpaRulesTitle"><header>
          <div><b id="cpaRulesTitle">${esc(title)}</b>
            <small>${esc(subtitle)}</small></div>
          <button type="button" data-cpa-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>
        <div class="cpaModalBody cpaRulesBody">
          ${settingsStrip}
          <div class="cpaRulesToolbar">
            <p class="cpaNote cpaRulesNote">${esc(note)}</p>
            <div class="cpaRulesToolbarActions">
              ${isChecklist ? `<button type="button" class="cpaBtn sm" data-cpa-manage-statuses>${esc(L('Durumları Yönet', 'Manage statuses'))}</button>` : ''}
              <button type="button" class="cpaBtn sm" data-cpa-ai-guide title="${esc(L('Kural dilini anlatan Markdown rehberi; ChatGPT gibi bir araca verin.', 'Markdown guide to the rule language; give it to a tool like ChatGPT.'))}">${esc(L('AI rehberi (.md)', 'AI guide (.md)'))}</button>
              ${addButton}
            </div>
          </div>
          ${showTemplates ? templateStrip() : ''}
          <div class="cpaRuleList" id="cpaRulesPanel" tabindex="0">${visible.length ? visible.map(rule => ruleBlock(rule, view)).join('') : empty}</div>
        </div>
        <footer><span class="cpaRulesCount">${esc(isChecklist
          ? L(`${visible.length} checklist sorusu · kişisel; Ön Ayar Paylaşımı ile paylaşılabilir`, `${visible.length} checklist questions · personal; shareable with Preset Sharing`)
          : L(`${visible.length} öncelik kuralı · kişisel; Ön Ayar Paylaşımı ile paylaşılabilir`, `${visible.length} priority rules · personal; shareable with Preset Sharing`))}</span><button type="button" class="cpaBtn" data-cpa-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
      bindRules();
      const openRow = expandedRuleId && modal.querySelector(`[data-cpa-rule="${CSS.escape(expandedRuleId)}"]`);
      const openRule = expandedRuleId && findRule(expandedRuleId);
      if (openRow && openRule && view.modeOf(openRule) === 'ai') { renderAiResult(openRow, openRule); mountRuleLcwAi(openRow, openRule); }
    };
    const findRule = id => state.rules.find(rule => rule.id === id);
    const ruleIdOf = el => el.closest('[data-cpa-rule]').dataset.cpaRule;
    const syncBasicFormula = rule => {
      if (!rule || rule.mode === 'formula') return;
      rule.formula = Rules.conditionsToFormula(rule.conditions, rule.match) || '=FALSE';
    };
    const refreshPreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = 0;
        const rule = expandedRuleId && findRule(expandedRuleId);
        const box = rule && modal.querySelector(`[data-cpa-rule="${CSS.escape(rule.id)}"] [data-cpa-rule-preview]`);
        if (box) box.innerHTML = previewHtml(rule);
      }, 160);
    };
    const commit = () => {
      state.rules.forEach(syncBasicFormula);
      savePrefs(); recompute(); refreshFieldCatalog();
      refreshPreview();
    };
    function createRule(template) {
      const spec = template && template.rule ? template.rule : {};
      const rule = activeTab === 'checklist'
        ? Rules.normalizeRule({ kind: 'checklist', name: spec.name || L('Yeni kontrol', 'New check'), questionTr: '', questionEn: '', conditions: spec.conditions || [{ field: '@daysToLoad', operator: 'lte', value: 60 }], expressionVersion: Rules.EXPRESSION_VERSION })
        : Rules.normalizeRule({ kind: 'priority', name: spec.name || L('Yeni kural', 'New rule'), target: spec.target || 'ACTION_THIS_WEEK', reasonTr: spec.reasonTr || '', reasonEn: spec.reasonEn || '', conditions: spec.conditions || [{ field: '@daysToLoad', operator: 'lte', value: 60 }], expressionVersion: Rules.EXPRESSION_VERSION });
      if (rule.kind === 'checklist') { rule.tr = rule.name; rule.en = rule.name; }
      state.rules.push(rule);
      if (rule.kind === 'priority') newPriorityRuleIds.add(rule.id);
      showTemplates = false;
      expandedRuleId = rule.id;
      commit(); draw(); scrollToRule(rule.id);
      return rule;
    }
    function addPriority() { showTemplates = false; createRule(null); }
    function addChecklist() { showTemplates = false; createRule(null); }

    function applyFormula(rule, formula) {
      rule.formula = formula;
      rule.mode = 'formula';
      const synced = Rules.formulaToConditions(formula);
      if (synced) {
        rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
        rule.match = synced.match;
        rule.mode = 'basic';
      }
      uiModes.set(rule.id, rule.mode);
    }

    /* AI cevabı: formül bulunur, görünen adlar kimliğe çevrilir, Buyer Log'un
       kendi ayrıştırıcısıyla doğrulanır ve canlı önizleme gösterilir.
       Uygulamak kullanıcının açık onayıdır; metin asla çalıştırılmaz. */
    function applyAiFormula(rule, formula, draft) {
      if (rule.kind === 'checklist' && draft.purpose === 'auto') {
        rule.autoStatus = Checklist.normalizeStatus(draft.autoStatus || 'approved') || 'approved';
        rule.autoFormula = formula;
      } else applyFormula(rule, formula);
    }
    function aiAnswerResult(rule) {
      const draft = view.aiDraftOf(rule);
      const answer = String(draft.answer || '').trim();
      if (!answer) return null;
      const extracted = Rules.extractFormula(answer);
      const formula = Rules.formulaFromDisplay(extracted, catalogFor(rule));
      const validation = Rules.validateExpression(formula, { fields: formulaFieldIds(rule) });
      return { extracted, formula, validation };
    }
    function renderAiResult(row, rule) {
      const box = row && row.querySelector('[data-cpa-ai-result]');
      if (!box) return;
      const result = aiAnswerResult(rule);
      if (!result) { box.innerHTML = ''; return; }
      const shown = Rules.formulaToDisplay(result.formula, catalogFor(rule), lang());
      if (!result.validation.valid) {
        box.innerHTML = `<div class="cpaAiFound is-invalid"><span>${esc(L('Bulunan formül', 'Formula found'))}</span><code>${esc(shown || result.extracted)}</code></div>
          <p class="cpaRuleFieldError">${esc((result.validation.errors || []).join(' · '))}</p>
          <p class="cpaNote">${esc(L('Hatayı AI\'a söyleyin: yukarıdaki mesajı kopyalayıp "bunu düzelt" deyin.', 'Tell the AI: copy the message above and say "fix this".'))}</p>`;
        return;
      }
      const probe = Rules.normalizeRule({ ...rule, mode: 'formula', formula: result.formula, enabled: true, expressionVersion: Rules.EXPRESSION_VERSION }, rule.kind);
      const preview = rulePreview(probe);
      box.innerHTML = `<div class="cpaAiFound"><span>${esc(L('Bulunan formül', 'Formula found'))}</span><code>${esc(shown)}</code></div>
        <p class="cpaFormulaStatus is-valid">✓ ${esc(L('Formül geçerli', 'Formula is valid'))}${preview ? ` · ${esc(L(`şu an ${int(preview.count)} sipariş eşleşiyor`, `${int(preview.count)} orders match right now`))}` : ''}</p>
        <button type="button" class="cpaBtn sm primary" data-cpa-ai-apply>${esc(L('Bu formülü kullan', 'Use this formula'))}</button>`;
      const applyButton = box.querySelector('[data-cpa-ai-apply]');
      if (applyButton) applyButton.onclick = () => {
        applyAiFormula(rule, result.formula, view.aiDraftOf(rule));
        view.aiDraftOf(rule).answer = '';
        commit(); draw(); scrollToRule(rule.id);
        if (typeof showToast === 'function') showToast(L('Formül kurala uygulandı.', 'The formula was applied to the rule.'));
      };
    }

    /* LCW AI önerisi: formül görünen adlardan kimliğe çevrilir, kural
       motoruyla doğrulanır, bugünkü eşleşme sayısı gösterilir. "Uygula"
       mevcut applyFormula yolunu kullanır; hiçbir şey kendiliğinden
       uygulanmaz. */
    /* LCW AI'a yalnız alan ADLARI değil ANLAMLARI da verilir: "Teslimat
       sonucu"nun yol süresi kuralına göre hedef tarihe yetişme tahmini
       olduğunu bilmeyen model, "In Store'a yetişmeyecek" isteğini kuramaz
       (canlıda tam olarak bu oldu). Hedef türü ekrandaki Retail Depo / In
       Store seçimidir; öncelikler kuralın taşıyacağı seviyelerdir. */
    const DERIVED_MEANINGS = Object.fromEntries((Rules.DERIVED_FIELDS || []).filter(item => item.meaning).map(item => [item.id, L(item.meaning.tr, item.meaning.en)]));
    function lcwaiRuleContext(rule) {
      const fields = formulaFieldCatalog(rule).map(item => {
        const entry = { name: item.label, type: item.type };
        if (DERIVED_MEANINGS[item.id]) entry.meaning = DERIVED_MEANINGS[item.id];
        if (String(item.id).indexOf('@') === 0) {
          const values = ruleValueOptions(item.id).slice(0, 30).map(option => option.raw === option.display ? option.raw : `${option.raw} (${option.display})`);
          if (values.length) entry.allowedValues = values;
        }
        return entry;
      });
      const targets = Rules.SEVERITY.filter(key => key !== 'ON_TRACK' && key !== 'UNKNOWN');
      return {
        ruleKind: rule.kind,
        ruleName: ruleName(rule),
        currentPriority: rule.kind === 'priority' ? { key: rule.target, label: priorityLabel(rule.target) } : null,
        availablePriorities: rule.kind === 'priority' ? targets.map(key => ({ key, label: priorityLabel(key) })) : [],
        deliveryTarget: state.settings.targetType === 'inStore'
          ? L('In Store (mağaza giriş tarihi) — Teslimat sonucu ve Hedefe tampon bu tarihe göre hesaplanır.', 'In Store (store entry date) — Delivery outcome and Buffer to target are calculated against this date.')
          : L('Retail Depo (retail depo tarihi) — Teslimat sonucu ve Hedefe tampon bu tarihe göre hesaplanır.', 'Retail warehouse (retail date) — Delivery outcome and Buffer to target are calculated against this date.'),
        howRulesWork: L('Formül TRUE ise kural siparişe uygulanır. Öncelik kuralı eşleşen siparişi seçili önceliğe YÜKSELTİR (CRITICAL = Kritik/kırmızı). Renk/öncelik formülde değil "priority" alanında verilir.', 'When the formula is TRUE the rule applies to the order. A priority rule ESCALATES a matching order to the chosen priority (CRITICAL = Critical/red). Colour/priority is given in the "priority" field, not in the formula.'),
        currentFormula: Rules.formulaToDisplay(rule.formula || '', catalogFor(rule), lang()),
        availableFields: fields,
        checklistValues: [...Checklist.statusIds(), 'notApplicable'],
      };
    }

    function mountRuleLcwAi(row, rule) {
      const host = row && row.querySelector('[data-cpa-lcwai-host]');
      if (!host) return;
      const mount = AI => {
        if (!AI || !host.isConnected) return;
        const draft = view.aiDraftOf(rule);
        AI.mountAssistant(host, {
          source: 'rules',
          initialRequest: draft.request,
          placeholder: rule.kind === 'checklist'
            ? { tr: 'Örn. Minecraft ve Roblox lisanslı, yüklemeye 30 günden az kalan siparişlere sor.', en: 'e.g. Ask for Minecraft and Roblox orders that load within 30 days.' }
            : { tr: 'Örn. MB’ye 14 günden az kalan siparişleri bu önceliğe al.', en: 'e.g. Put orders with fewer than 14 days to MB into this priority.' },
          onRequestChange: text => { draft.request = text; },
          buildRequest: text => ({
            task: text,
            guide: aiGuideFor(rule.kind, rule, text,
              rule.kind === 'checklist' && draft.purpose === 'auto'
                ? (draft.autoStatus || 'approved') : ''),
            context: {
              ...lcwaiRuleContext(rule),
              ...(rule.kind === 'checklist' ? {
                taskPurpose: draft.purpose === 'auto' ? 'auto_status_assignment' : 'checklist_question',
                targetChecklistStatus: draft.purpose === 'auto' ? (draft.autoStatus || 'approved') : '',
                howRulesWork: draft.purpose === 'auto'
                  ? L('Formül TRUE olunca seçilen checklist durumu otomatik kaydedilir. Soru kapsamı değişmez. Manuel cevaplar korunur.', 'When the formula is TRUE, the chosen checklist state is automatically recorded. The question scope is unchanged and manual choices always win.')
                  : L('Formül, hangi siparişlere checklist sorusunun sorulacağını belirler. Durumu otomatik atamak için üstteki hedefi değiştirin.', 'The formula decides which orders are asked. Change the target selector above to auto-assign a status.'),
              } : {}),
            },
          }),
          interpret: result => {
            const picked = AI.pickField(result, 'formula', Rules.extractFormula);
            if (!picked.value) return { ok: false, explanation: picked.explanation, issues: [L('LCW AI bir koşul formülü önermedi. İsteği netleştirip tekrar deneyin.', 'LCW AI did not suggest a condition formula. Clarify the request and try again.')] };
            const targets = Rules.SEVERITY.filter(key => key !== 'ON_TRACK' && key !== 'UNKNOWN');
            const suggestedPriority = rule.kind === 'priority' && result.data && targets.includes(String(result.data.priority || '').trim().toUpperCase()) ? String(result.data.priority).trim().toUpperCase() : '';
            const formula = Rules.formulaFromDisplay(Rules.extractFormula(picked.value), catalogFor(rule));
            const validation = Rules.validateExpression(formula, { fields: formulaFieldIds(rule) });
            const shown = Rules.formulaToDisplay(formula, catalogFor(rule), lang()) || picked.value;
            let matchLine = '';
            if (validation.valid) {
              const probe = Rules.normalizeRule({ ...rule, mode: 'formula', formula, enabled: true, expressionVersion: Rules.EXPRESSION_VERSION }, rule.kind);
              const preview = rulePreview(probe);
              if (preview) matchLine = `<div class="lcwaiResultLine is-ok"><span>${esc(L('Önizleme', 'Preview'))}</span>✓ ${esc(L(`Formül geçerli · şu an ${int(preview.count)} sipariş eşleşiyor`, `Formula is valid · ${int(preview.count)} orders match right now`))}</div>`;
            }
            const priorityLine = suggestedPriority ? `<div class="lcwaiResultLine"><span>${esc(L('Öncelik', 'Priority'))}</span><b>${esc(priorityLabel(suggestedPriority))}</b></div>` : '';
            const autoLine = rule.kind === 'checklist' && draft.purpose === 'auto'
              ? `<div class="lcwaiResultLine"><span>${esc(L('Otomatik yazılacak', 'Automatically set'))}</span><b>${esc(Checklist.statusLabel(draft.autoStatus || 'approved', lang()))}</b></div>`
              : '';
            return {
              ok: Boolean(validation.valid),
              value: { formula, priority: suggestedPriority },
              issues: validation.valid ? [] : (validation.errors || []),
              html: `<div class="lcwaiResultLine"><span>${esc(L('Koşul', 'Condition'))}</span></div><code>${esc(shown)}</code>${priorityLine}${autoLine}${matchLine}`,
            };
          },
          onApply: ({ formula, priority }) => {
            applyAiFormula(rule, formula, draft);
            if (priority && rule.kind === 'priority') rule.target = priority;
            draft.answer = '';
            commit(); draw(); scrollToRule(rule.id);
            if (typeof showToast === 'function') showToast(L('LCW AI önerisi kurala uygulandı.', 'The LCW AI suggestion was applied to the rule.'));
          },
        });
      };
      if (window.BuyerLogAI) mount(window.BuyerLogAI);
      else Promise.resolve(window.BLPerf?._loadScript?.('lcwai-assistant.js?rev=1')).catch(() => null).then(() => mount(window.BuyerLogAI || null));
    }

    function openStatusManager() {
      const overlay = document.createElement('div');
      overlay.className = 'cpaModalOverlay';
      overlay.innerHTML = `<div class="cpaModal cpaChecklistAnswerModal" role="dialog" aria-modal="true">
        <header><div><b>${esc(L('Checklist durumları', 'Checklist statuses'))}</b><small>${esc(L('Yeni durumlar yalnız sizin tercihlerinizde saklanır.', 'Custom states are saved in your user preferences.'))}</small></div>
          <button type="button" data-status-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
        <div class="cpaModalBody">
          <div data-status-list></div>
          <label class="cpaRuleTarget"><span>${esc(L('Yeni durum adı', 'New status name'))}</span>
            <input data-status-name maxlength="50" placeholder="${esc(L('Örn. Üreticiden Bekleniyor', 'e.g. Waiting Supplier'))}"></label>
          <label class="cpaCheck"><input type="checkbox" data-status-resolved><span>${esc(L('Bu durum seçilince soruyu tamamlanmış kabul et', 'Treat this status as resolved and close the question'))}</span></label>
          <p class="cpaNote" data-status-error role="alert"></p>
        </div><footer><button type="button" class="cpaBtn" data-status-close>${esc(L('Kapat', 'Close'))}</button>
          <button type="button" class="cpaBtn primary" data-status-add>+ ${esc(L('Durum ekle', 'Add status'))}</button></footer></div>`;
      document.body.appendChild(overlay);
      const refresh = () => {
        overlay.querySelector('[data-status-list]').innerHTML =
          Checklist.statusIds().map(id => `<div class="cpaRowBetween" style="margin:6px 0"><span>${esc(Checklist.statusLabel(id, lang()))}${Checklist.customStatuses().some(item => item.id === id && item.resolved) ? ' ✓' : ''}</span>
            ${id.startsWith('custom:') ? `<button type="button" class="cpaBtn sm" data-status-remove="${esc(id)}">${esc(L('Kaldır', 'Remove'))}</button>` : ''}</div>`).join('');
        overlay.querySelectorAll('[data-status-remove]').forEach(button => button.onclick = () => {
          if (!confirm(L('Bu durum tanımını kaldıralım mı? Eski cevaplar korunur, ancak adı artık özel görünmez.', 'Remove this status definition? Existing answers remain, but the custom label will no longer be shown.'))) return;
          Checklist.deleteCustomStatus(button.dataset.statusRemove);
          refresh(); draw(); recompute();
          window.BLChecklistSupplierSync?.refreshColumns?.({ render: true });
        });
      };
      refresh();
      overlay.querySelectorAll('[data-status-close]').forEach(button => button.onclick = () => { overlay.remove(); draw(); });
      overlay.onclick = event => { if (event.target === overlay) { overlay.remove(); draw(); } };
      overlay.querySelector('[data-status-add]').onclick = () => {
        try {
          Checklist.addCustomStatus(overlay.querySelector('[data-status-name]').value, overlay.querySelector('[data-status-resolved]').checked);
          overlay.querySelector('[data-status-name]').value = '';
          overlay.querySelector('[data-status-error]').textContent = '';
          refresh(); draw(); recompute();
          window.BLChecklistSupplierSync?.refreshColumns?.({ render: true });
        } catch (error) { overlay.querySelector('[data-status-error]').textContent = String(error.message || error); }
      };
    }

    function confirmDelete(rule) {
      const dependents = Rules.dependentsOf(rule, state.rules);
      const itemName = ruleName(rule);
      if (!dependents.length) return confirm(L(`"${itemName}" silinsin mi?`, `Delete "${itemName}"?`));
      return confirm(L(
        `"${itemName}" şu kuralların koşulunda kullanılıyor:\n\n${dependents.map(item => `• ${ruleName(item)} (${item.kind === 'checklist' ? 'Checklist' : priorityLabel(item.target)})`).join('\n')}\n\nSilerseniz bu koşullar hiçbir siparişte sağlanmaz. Yine de silinsin mi?`,
        `"${itemName}" is used as a condition in:\n\n${dependents.map(item => `• ${ruleName(item)} (${item.kind === 'checklist' ? 'Checklist' : priorityLabel(item.target)})`).join('\n')}\n\nIf you delete it, those conditions will never match. Delete anyway?`));
    }

    function bindRules() {
      modal.querySelectorAll('[data-cpa-close]').forEach(el => el.onclick = close);
      modal.querySelectorAll('[data-cpa-add-priority]').forEach(el => el.onclick = addPriority);
      modal.querySelectorAll('[data-cpa-add-checklist]').forEach(el => el.onclick = addChecklist);
      modal.querySelectorAll('[data-cpa-manage-statuses]').forEach(el => el.onclick = openStatusManager);
      modal.querySelectorAll('[data-cpa-ai-purpose]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        view.aiDraftOf(rule).purpose = el.value === 'auto' ? 'auto' : 'question';
        draw(); scrollToRule(rule.id);
      });
      modal.querySelectorAll('[data-cpa-ai-auto-status]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        view.aiDraftOf(rule).autoStatus = Checklist.normalizeStatus(el.value) || 'approved';
        draw(); scrollToRule(rule.id);
      });
      modal.querySelectorAll('[data-cpa-new-rule]').forEach(el => el.onclick = () => { showTemplates = !showTemplates; draw(); });
      modal.querySelectorAll('[data-cpa-template]').forEach(el => el.onclick = () => {
        const template = ruleTemplates(activeTab).find(item => item.id === el.dataset.cpaTemplate);
        createRule(template || null);
      });
      const master = modal.querySelector('[data-cpa-master]');
      if (master) master.onchange = () => { state.checklistSettings.enabled = master.checked; commit(); };
      modal.querySelectorAll('[data-cpa-ai-guide]').forEach(el => el.onclick = () => {
        downloadText(`BuyerLog_${activeTab === 'checklist' ? 'Checklist' : 'Rules'}_AI_Guide.md`, aiGuideFor(activeTab, null, ''));
      });
      modal.querySelectorAll('[data-cpa-rule-toggle]').forEach(el => el.onclick = () => {
        const id = ruleIdOf(el);
        expandedRuleId = expandedRuleId === id ? null : id;
        draw();
        if (expandedRuleId) scrollToRule(id);
      });
      modal.querySelectorAll('[data-cpa-rule-edit]').forEach(el => el.onclick = () => {
        const id = ruleIdOf(el);
        expandedRuleId = id;
        draw();
        scrollToRule(id);
      });
      modal.querySelectorAll('[data-cpa-rule-enabled]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        rule.enabled = el.checked;
        el.closest('[data-cpa-rule]').classList.toggle('is-disabled', !el.checked);
        commit();
      });
      modal.querySelectorAll('[data-cpa-rule-name]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el)); rule.name = el.value; rule.nameEn = el.value;
        if (rule.kind === 'checklist') { rule.tr = el.value; rule.en = el.value; }
        commit(); draw();
      });
      modal.querySelectorAll('[data-cpa-rule-target]').forEach(el => el.onchange = () => { findRule(ruleIdOf(el)).target = el.value; commit(); draw(); });
      modal.querySelectorAll('[data-cpa-auto-status]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        rule.autoStatus = Checklist.normalizeStatus(el.value) || '';
        commit(); draw(); scrollToRule(rule.id);
      });
      modal.querySelectorAll('[data-cpa-auto-formula]').forEach(el => {
        const rule = findRule(ruleIdOf(el));
        const feedback = el.closest('.cpaRuleAutoStatus').querySelector('[data-cpa-auto-feedback]');
        el.oninput = () => {
          const formula = Rules.formulaFromDisplay(el.value, catalogFor(rule));
          const result = formula ? Rules.validateExpression(formula, { fields: formulaFieldIds(rule) }) : { valid: !rule.autoStatus, errors: ['Condition required'] };
          feedback.textContent = result.valid ? L('✓ Geçerli koşul', '✓ Valid condition') : (result.errors || []).join(' · ');
          feedback.classList.toggle('is-invalid', !result.valid);
        };
        el.onchange = () => {
          const formula = Rules.formulaFromDisplay(el.value, catalogFor(rule));
          const valid = !formula || Rules.validateExpression(formula, { fields: formulaFieldIds(rule) }).valid;
          if (!valid) { el.oninput(); return; }
          rule.autoFormula = formula;
          commit();
        };
      });
      const syncReasonField = (el, rule, key) => {
        const value = String(el.value || '').trim();
        rule[key] = value;
        el.classList.toggle('is-invalid', !rule.builtIn && !value);
        const error = el.parentElement && el.parentElement.querySelector('.cpaRuleFieldError');
        if (error) error.hidden = rule.builtIn || Boolean(value);
        commit();
      };
      modal.querySelectorAll('[data-cpa-rule-reason-tr]').forEach(el => el.onchange = () => syncReasonField(el, findRule(ruleIdOf(el)), 'reasonTr'));
      modal.querySelectorAll('[data-cpa-rule-reason-en]').forEach(el => el.onchange = () => syncReasonField(el, findRule(ruleIdOf(el)), 'reasonEn'));
      modal.querySelectorAll('[data-cpa-rule-match]').forEach(el => el.onchange = () => { findRule(ruleIdOf(el)).match = el.value; commit(); });
      modal.querySelectorAll('[data-cpa-rule-question]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el)); rule.questionTr = el.value; rule.questionEn = el.value; commit();
      });
      modal.querySelectorAll('[data-cpa-rule-approval-scope]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        rule.approvalScope = el.value === 'option' ? 'option' : 'order';
        commit(); draw();
      });
      modal.querySelectorAll('[data-cpa-rule-evidence]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.evidenceFields = { ...(rule.evidenceFields || {}), [el.dataset.cpaRuleEvidence]: Boolean(el.checked) };
        commit();
      });
      modal.querySelectorAll('[data-cpa-rule-delete]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        if (!confirmDelete(rule)) return;
        if (rule.builtIn && !state.deletedRuleIds.includes(rule.id)) state.deletedRuleIds.push(rule.id);
        state.rules = state.rules.filter(item => item.id !== rule.id);
        newPriorityRuleIds.delete(rule.id);
        if (expandedRuleId === rule.id) expandedRuleId = null;
        commit(); draw();
      });
      modal.querySelectorAll('[data-cpa-cond-add]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        rule.conditions.push(Rules.normalizeCondition({ field: '@daysToLoad', operator: 'lte', value: 60 }));
        commit(); draw(); scrollToRule(rule.id);
      });
      const condOf = el => {
        const [id, index] = el.closest('[data-cpa-cond]').dataset.cpaCond.split(':');
        return findRule(id).conditions[Number(index)];
      };
      const redrawCondition = el => {
        const id = ruleIdOf(el);
        commit(); draw(); scrollToRule(id);
      };
      const operandOf = (condition, side) => {
        const current = condition[side] || { type: side === 'left' ? 'field' : 'value' };
        if (!current.type) current.type = side === 'left' ? 'field' : 'value';
        condition[side] = current;
        return current;
      };
      /* Alan değişince işlem ve değer alanın türüne göre sıfırlanır:
         checklist alanı seçen kullanıcı "Bekliyor/Reddedildi" ile başlar,
         sayısal alan "en fazla", metin "eşittir". */
      const defaultOperatorFor = (fieldId, rule) => {
        const kind = fieldKind(fieldId, rule);
        if (kind === 'checklist') return { operator: 'in', value: ['open', 'rejected'] };
        if (kind === 'rule') return { operator: 'eq', value: 'matched' };
        if (kind === 'enum') return { operator: 'in', value: [] };
        if (kind === 'number' || kind === 'date') return { operator: 'lte', value: '' };
        return { operator: 'eq', value: '' };
      };
      const setLeftField = (condition, fieldId, rule) => {
        const operand = operandOf(condition, 'left');
        operand.type = 'field'; operand.field = fieldId; operand.offset = null; operand.offsetField = '';
        condition.field = fieldId;
        const defaults = defaultOperatorFor(fieldId, rule);
        condition.operator = defaults.operator;
        condition.value = defaults.value;
        condition.right = { type: 'value', field: '', value: defaults.value, offset: null, offsetField: '' };
      };
      /* Legacy markup compatibility: eski tek alanlı koşul satırı. */
      modal.querySelectorAll('[data-cpa-cond-field]').forEach(el => {
        el.onchange = () => {
          const condition = condOf(el);
          condition.field = el.value; condition.value = '';
          const operand = operandOf(condition, 'left');
          operand.type = 'field'; operand.field = el.value; operand.value = '';
          redrawCondition(el);
        };
      });
      const setOperandType = (condition, side, type) => {
        const operand = operandOf(condition, side);
        operand.type = ['field', 'value', 'today'].includes(type) ? type : 'value';
        if (operand.type === 'field' && !operand.field) operand.field = side === 'left' ? condition.field || '@daysToLoad' : '@daysToLoad';
        if (operand.type !== 'field') { operand.field = ''; operand.offset = null; operand.offsetField = ''; }
        if (operand.type !== 'value' && side === 'right') operand.value = '';
        if (side === 'left') condition.field = operand.type === 'field' ? operand.field : '';
      };
      modal.querySelectorAll('[data-cpa-cond-right-type]').forEach(el => el.onchange = () => {
        const condition = condOf(el); setOperandType(condition, 'right', el.value); redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-advanced]').forEach(el => el.onclick = () => {
        const key = el.closest('[data-cpa-cond]').dataset.cpaCond;
        const condition = condOf(el);
        const forced = view.isAdvanced(findRule(ruleIdOf(el)), Number(key.split(':').pop()), condition) && !advancedRows.has(key);
        if (advancedRows.has(key) || forced) {
          advancedRows.delete(key);
          // Gelişmiş karşılaştırma kapatılınca koşul sade "değer" biçimine döner.
          if (forced) {
            setOperandType(condition, 'right', 'value');
            const left = operandOf(condition, 'left'); left.offset = null; left.offsetField = '';
            commit();
          }
        } else advancedRows.add(key);
        draw(); scrollToRule(ruleIdOf(el));
      });
      modal.querySelectorAll('[data-cpa-cond-op]').forEach(el => el.onchange = () => {
        const condition = condOf(el);
        const wasMulti = ['in', 'notIn'].includes(condition.operator);
        condition.operator = el.value;
        const isMulti = ['in', 'notIn'].includes(condition.operator);
        if (wasMulti && !isMulti) {
          const first = conditionValueList(condition.value)[0] || '';
          condition.value = first;
          if (condition.right && condition.right.type === 'value') condition.right.value = first;
        }
        redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-value]').forEach(el => el.onchange = () => {
        const condition = condOf(el); operandOf(condition, 'right').value = el.value; condition.value = el.value; commit();
      });
      modal.querySelectorAll('[data-cpa-cond-choice]').forEach(el => el.onchange = () => {
        const condition = condOf(el);
        const current = conditionValueList(condition.right && condition.right.type === 'value' ? condition.right.value : condition.value);
        const value = String(el.value);
        const next = el.checked ? [...new Set([...current, value])] : current.filter(item => item !== value);
        condition.value = next;
        operandOf(condition, 'right').value = next;
        el.closest('.cpaChoice')?.classList.toggle('is-on', el.checked);
        commit();
      });
      ['left', 'right'].forEach(side => {
        modal.querySelectorAll(`[data-cpa-cond-${side}-offset]`).forEach(el => el.onchange = () => {
          const operand = operandOf(condOf(el), side); const value = Number(el.value);
          operand.offset = Number.isFinite(value) && value ? { value, unit: 'days' } : null; commit();
        });
        modal.querySelectorAll(`[data-cpa-cond-${side}-offset-unit]`).forEach(el => el.onchange = () => {
          const operand = operandOf(condOf(el), side); const value = operand.offset && Number(operand.offset.value);
          operand.offset = value ? { value, unit: el.value === 'weeks' ? 'weeks' : 'days' } : null; commit();
        });
      });

      const renderFormulaFeedback = (row, rule, result) => {
        if (!row) return;
        const status = row.querySelector('[data-cpa-formula-status]');
        const error = row.querySelector('[data-cpa-formula-error]');
        const diagnostics = row.querySelector('[data-cpa-formula-diagnostics]');
        if (result && result.valid) {
          if (status) { status.textContent = L('✓ Formül geçerli', '✓ Formula valid'); status.className = 'cpaFormulaStatus is-valid'; }
          if (error) { error.hidden = true; error.textContent = ''; }
        } else if (result) {
          if (status) { status.textContent = L('Formül geçersiz', 'Formula invalid'); status.className = 'cpaFormulaStatus is-invalid'; }
          if (error) { error.hidden = false; error.textContent = (result.errors || [result.error || '']).join(' · '); }
        }
        if (diagnostics && result && result.diagnostics && result.diagnostics.length) {
          diagnostics.hidden = false;
          diagnostics.innerHTML = result.diagnostics.map(item => `<span>${esc(fieldLabel(item.field, rule))} = <b>${esc(item.value == null || item.value === '' ? '—' : (item.value && item.value.__ruleDateOrdinal != null ? dateText(item.value.__ruleDateOrdinal) : item.value))}</b></span>`).join('');
        }
      };
      modal.querySelectorAll('[data-cpa-rule-mode]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const requested = el.dataset.cpaRuleMode;
        if (requested === 'ai') {
          uiModes.set(rule.id, 'ai');
          draw(); scrollToRule(rule.id);
          return;
        }
        const nextMode = requested === 'formula' ? 'formula' : 'basic';
        if (nextMode === 'formula') {
          const generated = Rules.conditionsToFormula(rule.conditions, rule.match);
          if (rule.mode !== 'formula' || !String(rule.formula || '').trim()) rule.formula = generated || '=FALSE';
          rule.mode = 'formula';
        } else {
          const synced = Rules.formulaToConditions(rule.formula);
          if (String(rule.formula || '').trim() && !synced) {
            if (typeof showToast === 'function') showToast(L('Bu formül basit koşullara otomatik çevrilemiyor; Formül modu korunuyor.', 'This formula cannot be converted to simple conditions; Formula mode is kept.'));
            return;
          }
          if (synced) {
            rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
            rule.match = synced.match;
          }
          rule.mode = 'basic';
        }
        uiModes.set(rule.id, rule.mode);
        commit(); draw(); scrollToRule(rule.id);
      });
      const syncFormulaInput = (el, live) => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.formula = Rules.formulaFromDisplay(el.value, catalogFor(rule));
        const synced = Rules.formulaToConditions(rule.formula);
        if (synced) {
          rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
          rule.match = synced.match;
        }
        if (live) renderFormulaFeedback(el.closest('[data-cpa-rule]'), rule, Rules.validateExpression(rule.formula, { fields: formulaFieldIds(rule) }));
        else commit();
      };
      modal.querySelectorAll('[data-cpa-rule-formula]').forEach(el => {
        el.oninput = () => syncFormulaInput(el, true);
        el.onchange = () => syncFormulaInput(el, false);
      });
      modal.querySelectorAll('[data-cpa-formula-test]').forEach(el => el.onclick = () => {
        const row = el.closest('[data-cpa-rule]'); const rule = findRule(ruleIdOf(el));
        const validation = Rules.validateExpression(rule.formula, { fields: formulaFieldIds(rule) });
        if (!validation.valid) { renderFormulaFeedback(row, rule, validation); return; }
        const analysis = state.model && state.model.orders && state.model.orders[0];
        const sampleFacts = analysis ? Rules.factsFor(analysis, {}) : { row: (lastRows && lastRows[0]) || {}, derived: {}, checklist: {} };
        const result = Rules.evaluateExpression(rule.formula, sampleFacts);
        renderFormulaFeedback(row, rule, { valid: !result.error, errors: result.error ? [result.error] : [], diagnostics: result.diagnostics || [] });
        if (result.error) return;
        const status = row.querySelector('[data-cpa-formula-status]');
        if (status) status.textContent = `${L('İlk siparişte sonuç', 'Result on the first order')}: ${String(result.value).toUpperCase()}`;
        refreshPreview();
      });
      const insertIntoFormula = (row, snippet) => {
        const textarea = row && row.querySelector('[data-cpa-rule-formula]');
        if (!textarea) return;
        const start = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
        const end = textarea.selectionEnd == null ? start : textarea.selectionEnd;
        textarea.value = `${textarea.value.slice(0, start)}${snippet}${textarea.value.slice(end)}`;
        const caret = start + snippet.length;
        textarea.focus();
        try { textarea.setSelectionRange(caret, caret); } catch (_) { /* eski tarayıcı */ }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      };
      modal.querySelectorAll('[data-cpa-formula-fn]').forEach(el => el.onclick = () => insertIntoFormula(el.closest('[data-cpa-rule]'), el.dataset.cpaFormulaFn));

      // AI paneli: istek/cevap taslağı kural başına saklanır, yeniden çizimde kaybolmaz.
      modal.querySelectorAll('[data-cpa-ai-request]').forEach(el => el.oninput = () => { view.aiDraftOf(findRule(ruleIdOf(el))).request = el.value; });
      modal.querySelectorAll('[data-cpa-ai-answer]').forEach(el => el.oninput = () => {
        const rule = findRule(ruleIdOf(el));
        view.aiDraftOf(rule).answer = el.value;
        renderAiResult(el.closest('[data-cpa-rule]'), rule);
      });
      modal.querySelectorAll('[data-cpa-ai-copy]').forEach(el => el.onclick = async () => {
        const rule = findRule(ruleIdOf(el));
        const ok = await copyToClipboard(aiGuideFor(rule.kind, rule, view.aiDraftOf(rule).request));
        if (typeof showToast === 'function') showToast(ok
          ? L('AI rehberi kopyalandı. AI aracınıza yapıştırın, cevabı 3. adıma getirin.', 'AI guide copied. Paste it into your AI tool and bring the answer back to step 3.')
          : L('Kopyalanamadı; rehberi indirip kullanın.', 'Could not copy; download the guide instead.'));
      });
      modal.querySelectorAll('[data-cpa-ai-download]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        downloadText(`BuyerLog_${rule.kind === 'checklist' ? 'Checklist' : 'Rules'}_AI_Guide.md`, aiGuideFor(rule.kind, rule, view.aiDraftOf(rule).request));
      });

      const openValueMenu = (picker, menu) => {
        if (!picker || !menu) return;
        if (activeValueMenu && activeValueMenu !== menu) closeValueMenu();
        const search = menu.querySelector('[data-cpa-value-search]');
        const valueHost = menu.querySelector('[data-cpa-value-options]');
        const fieldHost = menu.querySelector('[data-cpa-field-options]');
        if (search) search.value = '';
        if (valueHost) valueHost.innerHTML = valueOptionRows(condOf(picker), '');
        if (fieldHost) fieldHost.innerHTML = fieldOptionRows(findRule(ruleIdOf(picker)), picker.dataset.cpaFieldSelected || '', '');
        const condKey = `${picker.closest('[data-cpa-cond]')?.dataset.cpaCond || ruleIdOf(picker)}-${picker.dataset.cpaFieldPicker || 'value'}`;
        menu.id = `cpa-value-menu-${condKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        activeValuePicker = picker;
        activeValueMenu = menu;
        setValuePickerExpanded(picker, true, menu);
        document.body.appendChild(menu);
        menu.hidden = false;
        positionValueMenu();
        setTimeout(() => search && activeValueMenu === menu && search.focus(), 0);
      };
      const menuKeyboard = (menu, toggle) => event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeValueMenu();
          if (toggle) toggle.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const options = [...menu.querySelectorAll('button[data-cpa-value-option], input[type="checkbox"][data-cpa-value-option], button[data-cpa-field-option]')]
          .filter(el => !el.disabled && el.offsetParent !== null);
        if (!options.length) return;
        const current = options.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(options.length - 1, current + 1);
        else next = current < 0 ? options.length - 1 : Math.max(0, current - 1);
        event.preventDefault();
        options[next].focus();
      };
      /* Alan seçici: koşulun sol alanı, sağ alan, gün farkı alanı ya da
         formüle eklenecek alan. Seçim role göre işlenir. */
      modal.querySelectorAll('[data-cpa-field-picker]').forEach(picker => {
        const toggle = picker.querySelector('[data-cpa-field-toggle]');
        const menu = picker.querySelector('[data-cpa-value-menu]');
        const search = picker.querySelector('[data-cpa-value-search]');
        const host = picker.querySelector('[data-cpa-field-options]');
        const rule = findRule(ruleIdOf(picker));
        const role = picker.dataset.cpaFieldPicker;
        const condition = picker.closest('[data-cpa-cond]') ? condOf(picker) : null;
        const current = role === 'left' ? condition && condition.field
          : role === 'right' ? condition && condition.right && condition.right.field
            : role === 'left-offset' ? condition && condition.left && condition.left.offsetField
              : role === 'right-offset' ? condition && condition.right && condition.right.offsetField : '';
        picker.dataset.cpaFieldSelected = current || '';
        if (toggle && menu) toggle.onclick = () => {
          if (activeValueMenu === menu) closeValueMenu();
          else openValueMenu(picker, menu);
        };
        if (search && host) search.oninput = () => {
          host.innerHTML = fieldOptionRows(rule, picker.dataset.cpaFieldSelected || '', search.value);
          scheduleValueMenuPosition();
        };
        if (menu) menu.onkeydown = menuKeyboard(menu, toggle);
        if (host) host.onclick = event => {
          const option = event.target.closest('button[data-cpa-field-option]');
          if (!option) return;
          const fieldId = option.dataset.cpaFieldOption;
          closeValueMenu();
          if (role === 'formula') {
            insertIntoFormula(picker.closest('[data-cpa-rule]'), `[${fieldLabel(fieldId, rule)}]`);
            return;
          }
          if (!condition) return;
          if (role === 'left') setLeftField(condition, fieldId, rule);
          else if (role === 'right') { const operand = operandOf(condition, 'right'); operand.type = 'field'; operand.field = fieldId; operand.offset = null; operand.offsetField = ''; }
          else if (role === 'left-offset') operandOf(condition, 'left').offsetField = fieldId;
          else if (role === 'right-offset') operandOf(condition, 'right').offsetField = fieldId;
          redrawCondition(picker);
        };
      });
      modal.querySelectorAll('[data-cpa-value-picker]').forEach(picker => {
        const toggle = picker.querySelector('[data-cpa-value-toggle]');
        const menu = picker.querySelector('[data-cpa-value-menu]');
        const search = picker.querySelector('[data-cpa-value-search]');
        const host = picker.querySelector('[data-cpa-value-options]');
        const mainInput = picker.querySelector('[data-cpa-cond-value]');
        const conditionForPicker = () => condOf(picker);
        if (toggle && menu) toggle.onclick = () => {
          if (activeValueMenu === menu) closeValueMenu();
          else openValueMenu(picker, menu);
        };
        if (mainInput && menu) mainInput.ondblclick = () => openValueMenu(picker, menu);
        if (search && host) search.oninput = () => {
          host.innerHTML = valueOptionRows(conditionForPicker(), search.value);
          scheduleValueMenuPosition();
        };
        if (menu) menu.onkeydown = menuKeyboard(menu, toggle);
        if (host) {
          host.onclick = event => {
            const button = event.target.closest('button[data-cpa-value-option]');
            if (!button) return;
            const condition = conditionForPicker();
            condition.value = button.dataset.cpaValueOption || '';
            if (condition.right) condition.right.value = condition.value;
            if (mainInput) mainInput.value = condition.value;
            commit();
            closeValueMenu();
          };
          host.onchange = event => {
            const checkbox = event.target.closest('input[type="checkbox"][data-cpa-value-option]');
            if (!checkbox) return;
            const condition = conditionForPicker();
            const raw = String(checkbox.value || '').trim();
            const current = conditionValueList(condition.value);
            const needle = raw.toLocaleLowerCase('tr-TR');
            const index = current.findIndex(item => item.toLocaleLowerCase('tr-TR') === needle);
            if (checkbox.checked && index < 0) current.push(raw);
            if (!checkbox.checked && index >= 0) current.splice(index, 1);
            condition.value = current.join(', ');
            if (condition.right) condition.right.value = condition.value;
            if (mainInput) mainInput.value = condition.value;
            const row = checkbox.closest('[data-cpa-value-row]');
            row?.classList.toggle('is-selected', checkbox.checked);
            row?.setAttribute('aria-selected', checkbox.checked ? 'true' : 'false');
            commit();
            scheduleValueMenuPosition();
          };
        }
      });
      modal.querySelectorAll('[data-cpa-cond-remove]').forEach(el => el.onclick = () => {
        const [id, index] = el.closest('[data-cpa-cond]').dataset.cpaCond.split(':');
        findRule(id).conditions.splice(Number(index), 1);
        [...advancedRows].filter(key => key.startsWith(`${id}:`)).forEach(key => advancedRows.delete(key));
        commit(); draw(); scrollToRule(id);
      });
    }
    function validateNewPriorityReasons() {
      const invalid = [...newPriorityRuleIds]
        .map(id => findRule(id))
        .find(rule => rule && (!String(rule.reasonTr || '').trim() || !String(rule.reasonEn || '').trim()));
      if (!invalid) return true;
      expandedRuleId = invalid.id;
      draw();
      scrollToRule(invalid.id);
      requestAnimationFrame(() => {
        const row = modal.querySelector(`[data-cpa-rule="${CSS.escape(invalid.id)}"]`);
        const field = row && row.querySelector(!String(invalid.reasonTr || '').trim() ? '[data-cpa-rule-reason-tr]' : '[data-cpa-rule-reason-en]');
        if (field) field.focus();
      });
      return false;
    }

    function validateFormulaRules() {
      const invalid = rulesFor(activeTab).find(rule => rule.mode === 'formula'
        && !Rules.validateExpression(rule.formula, { fields: formulaFieldIds(rule) }).valid);
      if (!invalid) return true;
      expandedRuleId = invalid.id;
      uiModes.set(invalid.id, 'formula');
      draw();
      scrollToRule(invalid.id);
      return false;
    }

    function close() {
      if (!validateNewPriorityReasons()) return;
      if (!validateFormulaRules()) return;
      if (previewTimer) clearTimeout(previewTimer);
      closeValueMenu({ remove: true });
      document.removeEventListener('pointerdown', onValueOutsidePointer, true);
      document.removeEventListener('scroll', onValueViewportChange, true);
      document.removeEventListener('keydown', onValueEscape, true);
      window.removeEventListener('resize', onValueViewportChange);
      modal.remove();
      recompute();
      render();
    }
    document.body.appendChild(modal);
    document.addEventListener('pointerdown', onValueOutsidePointer, true);
    document.addEventListener('scroll', onValueViewportChange, true);
    document.addEventListener('keydown', onValueEscape, true);
    window.addEventListener('resize', onValueViewportChange);
    draw();
    modal.addEventListener('pointerdown', event => {
      backdropPointerStarted = event.target === modal;
    });
    modal.addEventListener('pointercancel', () => { backdropPointerStarted = false; });
    modal.onclick = event => {
      const shouldClose = event.target === modal && backdropPointerStarted;
      backdropPointerStarted = false;
      if (shouldClose) close();
    };
  }

  /* ------------------------------------------------------------- hesaplama */
  let lastRows = null;
  /* PLM numune talepleri (CoreNectum Requests) kontrol listesine kanıt verir.
     Modül yüklenmediyse kanıt yoktur ve sorular eskisi gibi sorulur. */
  const sampleRequests = () => window.BLPlmSampleRequests || null;
  function plmEvidence(analysis, itemId) {
    const api = sampleRequests();
    return api ? api.evidenceForAnalysis(analysis, itemId) : null;
  }
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
    if (changed) saveAnswers();
    return changed;
  }

  function decisionCacheKey() {
    const user = window.BL_USER_CONTEXT || {};
    const dataRevision = window.BL_CP_DECISION_DATA_REVISION?.() || 0;
    const day = new Date();
    return JSON.stringify([user.id || '',user.accessRevision || 0,dataRevision,decisionContextRevision,
      day.getFullYear(),day.getMonth(),day.getDate(),state.settings.targetType,isEn()?'en':'tr',
      ]);
  }
  const decisionRuntime = window.BLCpDecisionRuntime.create({
    contextKey:decisionCacheKey, analyzeRow:Engine.analyzeOrder, summarize:Engine.summarizeAnalyses,
    workerFactory:typeof window.Worker==='function' ? ()=>new window.Worker('/cp-decision-worker.js?rev=worker272') : null,
  });
  const personalEvaluations = new WeakMap();
  async function analyzeRowsWithPersonalRulesAsync(rows, options = {}) {
    const key = decisionCacheKey();
    const transitRules = window.state?.overrides?.transitRules || [];
    const model = await decisionRuntime.computeAsync(rows, { today:Engine.defaultOrdinal(new Date()),settings:{targetType:state.settings.targetType},transitRules });
    if (!model || decisionCacheKey() !== key || options.isCurrent?.() === false) return null;
    const steps = personalModelSteps(model, options);
    let start = performance.now(),step;
    do {
      if (decisionCacheKey() !== key || options.isCurrent?.() === false) return null;
      step = steps.next();
      if (!step.done && performance.now()-start>=8) { await new Promise(resolve=>setTimeout(resolve,0));start=performance.now(); }
    } while (!step.done);
    return decisionCacheKey() === key && options.isCurrent?.() !== false ? step.value : null;
  }

  function analyzeRowsWithPersonalRules(rows, options) {
    const list = Array.isArray(rows) ? rows : [];
    const opts = options || {};
    const transitRules = (window.state && window.state.overrides && window.state.overrides.transitRules) || [];
    const model = decisionRuntime.compute(list, { settings: { targetType: state.settings.targetType }, transitRules });
    const steps = personalModelSteps(model, opts);
    let step;
    do { step = steps.next(); } while (!step.done);
    return step.value;
  }

  let pendingAutomaticStatusSync = false;
  function flushAutomaticStatusSync() {
    if (!pendingAutomaticStatusSync) return;
    const sync = window.BLChecklistSupplierSync;
    if (!sync || typeof sync.syncAnswerChanges !== 'function') return;
    pendingAutomaticStatusSync = false;
    void sync.syncAnswerChanges().catch(error => {
      pendingAutomaticStatusSync = true;
      if (typeof showToast === 'function') showToast(L('Otomatik Checklist cevapları senkronize edilemedi: ', 'Could not sync automatic Checklist statuses: ') + String(error.message || error));
    });
  }
  function* personalModelSteps(initialModel, opts) {
    let model = initialModel;
    // v1'den kalan PO-bazlı onayları, yeni model/renk kapsamı seçiliyse
    // değerlendirmeden önce seçenek anahtarına yükselt.
    promoteReusableChecklistAnswers(model.orders);

    /* Tek kişisel karar katmanı. CP tablosu, Overview ve Attention aynı
       rule/checklist state'ini buradan tüketir; ikinci bir Priority motoru yoktur.
       Checklist durumu ve öncelik kuralları birbirine koşul olarak bağlanabilir;
       Rules.evaluateOrder ikisini sipariş başına bağımlılık sırasıyla çözer
       (Checklist.stateFor ile aynı durum değerleri). */
    const checklistState = new Map();
    const customItems = new Map();
    const evaluations = new Map();
    const preparedRules=Rules.prepareEvaluation?.(state.rules);
    const autoWrites = [];
    for (const analysis of model.orders) {
      if (analysis.calculatedPriority == null) analysis.calculatedPriority = analysis.priority;
      let evaluated = personalEvaluations.get(analysis);
      if (!evaluated) {
        evaluated = Rules.evaluateOrder(analysis, {
          rules: state.rules, preparedRules, answers: state.answers, plmEvidence, checklistEnabled: state.checklistSettings.enabled,
        });
        personalEvaluations.set(analysis, evaluated);
      }
      evaluations.set(analysis.orderKey, evaluated);
      if (opts.commit === true && state.checklistSettings.enabled) {
        for (const decision of (evaluated.autoDecisions || [])) {
          const key = Checklist.answerKey(analysis.orderKey, decision.itemId);
          const previous = state.answers[key];
          if (previous && previous.source !== 'auto_rule') continue;
          if (previous && Checklist.normalizeStatus(previous.state) === decision.state) continue;
          autoWrites.push({ key, analysis, decision, previous });
        }
      }
      analysis.checklistItemIds = evaluated.customItems.map(item => item.id);
      analysis.checklistState = evaluated.checklistState;
      customItems.set(analysis.orderKey, evaluated.customItems);
      checklistState.set(analysis.orderKey, evaluated.checklistState);
      yield;
    }
    // Persist deterministic status assignments only for a committed data pass.
    // Never write during previews, row hover, exports or background probes.
    // A single save batches updates for the supplier-sync journal.
    if (autoWrites.length) {
      const by = (window.BL_USER_CONTEXT || {}).id || '';
      let at = Math.max(Date.now(), state.lastAnswerAt || 0);
      for (const { key, analysis, decision, previous } of autoWrites) {
        const preserved = {};
        for (const name of ['note', 'reportNumber', 'actualDate', 'attachments']) {
          if (previous && Object.prototype.hasOwnProperty.call(previous, name)) preserved[name] = previous[name];
        }
        at = Math.max(at + 1, (Date.parse(previous && previous.at || '') || 0) + 1);
        state.answers[key] = Checklist.makeAnswer(decision.state, analysis, {
          ...preserved, by, at: new Date(at).toISOString(), source: 'auto_rule',
        });
      }
      state.lastAnswerAt = at;
      // Do not invalidate the active async decision batch midway through a pass.
      // Its computed checklistState already contains these answers.
      if (saveAnswers({ silent: true })) pendingAutomaticStatusSync = true;
    }
    for (const analysis of model.orders) {
      const applied = evaluations.get(analysis.orderKey);
      analysis.priority = applied.priority;
      if (Array.isArray(applied.signals) && applied.signals.length) {
        const byCode = new Map((Array.isArray(analysis.signals) ? analysis.signals : []).map(item => [item && item.code, item]));
        applied.signals.forEach(item => { if (item && item.code) byCode.set(item.code, item); });
        analysis.signals = [...byCode.values()];
        const reasonByCode = new Map((Array.isArray(analysis.actionReasons) ? analysis.actionReasons : []).map(item => [item && item.code, item]));
        applied.signals.forEach(item => { if (item && item.code) reasonByCode.set(item.code, item); });
        analysis.actionReasons = [...reasonByCode.values()];
      }
      if (analysis.decision && analysis.decision.action) {
        analysis.decision.action.priority = analysis.priority;
        analysis.decision.action.reasons = analysis.actionReasons || analysis.decision.action.reasons || [];
        analysis.decision.signals = analysis.signals || analysis.decision.signals || [];
      }
      analysis.matchedRules = applied.matched.map(rule => ({
        id: rule.id,
        name: rule.name,
        target: rule.target,
        builtIn: rule.builtIn === true,
        custom: rule.builtIn !== true,
        reasonCode: rule.builtIn === true ? '' : customRuleReasonCode(rule.id),
        reasonTr: String(rule.reasonTr || ''),
        reasonEn: String(rule.reasonEn || ''),
        reason: customRuleReasonText(rule),
      }));
      yield;
    }
    model = Engine.recount(model);

    if (opts.commit === true) {
      state.model = model;
      state.checklistStateByOrder = checklistState;
      state.checklist = Checklist.summarize(model.orders, {
        settings: state.checklistSettings, answers: state.answers, limit: 5000, plmEvidence,
        customItemsFor: analysis => customItems.get(analysis.orderKey) || [],
        managedItemIds: Rules.DEFAULT_CHECKLIST_RULE_IDS,
      });
      refreshFieldCatalog();
    }
    return model;
  }

  function recompute() {
    if (!lastRows) return;
    analyzeRowsWithPersonalRules(lastRows, { commit: true });
    flushAutomaticStatusSync();
  }

  /* CP / Orders Priority hücreleri de Overview ile AYNI kişisel decision
     context'ini kullanır. byRow WeakMap'i aynı row objesi üzerinden O(1)
     eşleşme sağlar; display text hiçbir zaman identity olarak kullanılmaz. */
  const decisionResults = new WeakMap(), decisionJobs = new WeakMap();
  function peekDecisionsForRows(rows) {
    const cached=decisionResults.get(rows);
    return cached && cached.key===decisionCacheKey() ? cached.result : null;
  }
  function computeDecisionsForRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const cached=peekDecisionsForRows(list);if(cached)return cached;
    const model = analyzeRowsWithPersonalRules(list, { commit: false });
    const result=decisionResult(model);
    decisionResults.set(list,{key:decisionCacheKey(),result});return result;
  }
  function computeDecisionsForRowsAsync(rows) {
    const list=Array.isArray(rows)?rows:[],key=decisionCacheKey(),cached=peekDecisionsForRows(list);
    if(cached)return Promise.resolve(cached);
    const running=decisionJobs.get(list);if(running&&running.key===key)return running.promise;
    const job={key};
    job.promise=analyzeRowsWithPersonalRulesAsync(list,{commit:false}).then(model=>{
      if(!model||decisionCacheKey()!==key)return null;
      const result=decisionResult(model);decisionResults.set(list,{key,result});return result;
    }).finally(()=>{if(decisionJobs.get(list)===job)decisionJobs.delete(list);});
    decisionJobs.set(list,job);return job.promise;
  }
  function decisionResult(model) {
    const byRow = new WeakMap();
    const byOrderKey = new Map();
    for (const analysis of model.orders || []) {
      if (analysis && analysis.sourceRow && typeof analysis.sourceRow === 'object') byRow.set(analysis.sourceRow, analysis);
      if (analysis && analysis.orderKey) byOrderKey.set(analysis.orderKey, analysis);
    }
    return { model, byRow, byOrderKey, revision: decisionContextRevision };
  }

  /* Genel Bakış her çizildiğinde çağrılır. Aynı satır kümesi için yeniden
     hesap yapılmaz — açılış ve filtre akışı ağırlaşmasın (CLAUDE.md §11). */
  let overviewDecisionGeneration = 0;
  let overviewDecisionPending = false;
  function renderPreparing() {
    const host=document.getElementById('cpAssistant');
    for(const id of ['cpAssistantAttention','cpAssistantCoverage']){const node=document.getElementById(id);if(node)node.innerHTML='';}
    if(host)host.innerHTML='<section class="cpaCard"><header><b>'+L('Bugünün Üretim Öncelikleri',"Today's Production Focus")+'</b></header><div class="cpaCardBody"><p class="cpaEmpty">'+L('Üretim öncelikleri arka planda hazırlanıyor…','Production priorities are being prepared in the background…')+'</p></div></section>';
  }
  function onOverviewRendered(rows, context = {}) {
    const list = Array.isArray(rows) ? rows : [];
    lastRows = list;
    const columnSignature = liveRuleColumnCatalog().map(column => `${column.key || ''}:${column.label || ''}`).join('¦');
    const dataRevision = Number(context && context.dataRevision) || 0;
    const filterRevision = String(context && context.filterRevision || '');
    // Authoritative dataset revision prevents stale results when row count and
    // first Order Code stay unchanged but Status/Handover/dates change. The
    // old lightweight signature remains only as a compatibility fallback for
    // isolated callers that do not provide lifecycle context.
    const datasetSignature = dataRevision > 0
      ? `rev:${dataRevision}`
      : `fallback:${list.length}:${list.length ? list[0]['Order Code'] : ''}`;
    const signature = `${datasetSignature}|filter:${filterRevision}|target:${state.settings.targetType}|decision:${decisionContextRevision}|day:${new Date().toDateString()}|lang:${isEn()?'en':'tr'}|${columnSignature}`;
    if (signature === state.rowsSignature) { if (state.model && !overviewDecisionPending) render(); return; }
    state.rowsSignature = signature;
    try { window.BLPerf?.mark?.('PRODUCTION_FOCUS_RECOMPUTE', { dataRevision, rows: list.length }); } catch (_) {}
    const generation = ++overviewDecisionGeneration;
    overviewDecisionPending = true;renderPreparing();
    void analyzeRowsWithPersonalRulesAsync(list, {commit:true,isCurrent:()=>generation === overviewDecisionGeneration}).then(model=>{
      if (generation !== overviewDecisionGeneration) return;
      overviewDecisionPending=false;
      if (!model) { state.rowsSignature='';onOverviewRendered(lastRows,context);return; }
      render();
      flushAutomaticStatusSync();
    }).catch(error=>{if(generation!==overviewDecisionGeneration)return;overviewDecisionPending=false;state.rowsSignature='';if(typeof showToast==='function')showToast(error.message);});
  }

  loadPrefs();
  // Taşıma: yeni anahtarlar yazılır, eski PREF_KEY'den rules çıkarılır.
  if (migrateRuleStores && !unreadablePreferenceStores.size) {
    try { savePrefs(); } catch (_) { /* Kayıt hatası bildirildi; eski kayıt korunur. */ }
  }
  if (unreadablePreferenceStores.size && typeof showToast === 'function') showToast(L('Checklist ayar/kural kaydı okunamadı. Mevcut kayıt korundu; kurtarılana kadar ayar değişikliği kaydedilemez.', 'A Checklist settings/rules record could not be read. It was preserved; recover it before saving settings changes.'));
  state.moduleLayout = normalizeModuleLayouts(state.moduleLayout);
  /* PLM numune verisi gelince karar bağlamı değişir: kontrol listesi ve
     CP öncelik hücreleri aynı olayla yeniden hesaplanır. */
  function onPlmSampleRequestsChanged() {
    notifyDecisionContextChanged('plm-sample-requests');
    if(lastRows){state.rowsSignature='';onOverviewRendered(lastRows,{dataRevision:window.BL_CP_DECISION_DATA_REVISION?.()||0,filterRevision:'plm-evidence'});}
  }
  window.addEventListener('bl:plm-requests-changed', onPlmSampleRequestsChanged);
  if (sampleRequests()) sampleRequests().load().then(data => { if (data && data.loaded && Object.keys(data.models || {}).length) onPlmSampleRequestsChanged(); });
  /* Başka kullanıcıdan Ön Ayar Paylaşımı ile kural alınınca sayfa yenilenir;
     aynı oturumda sunucudan yeni değer gelirse (BLStorage hydrate) kurallar
     depodan yeniden okunur. */
  window.BLCpAssistant = {
    onOverviewRendered, render, computeDecisionsForRows, computeDecisionsForRowsAsync, peekDecisionsForRows, setChecklistAnswer, adoptSharedChecklistDefinitions, createChecklistItem,
    persistChecklistAnswers: saveAnswers,
    openRules, openSettings,
    decisionRuntimeStats: () => decisionRuntime.getStats(),
    decisionContextRevision: () => decisionContextRevision, _state: state,
  };
})();
