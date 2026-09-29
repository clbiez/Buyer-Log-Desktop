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
    rules: Rules.mergeWithDefaults(null),
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
  const store = {
    get(key) {
      try { return (window.BLStorage ? window.BLStorage.getItem(key) : localStorage.getItem(key)); }
      catch (_) { return null; }
    },
    set(key, value) {
      try { if (window.BLStorage) window.BLStorage.setItem(key, value); else localStorage.setItem(key, value); }
      catch (_) { /* kota dolduysa ekran çalışmaya devam eder */ }
    },
  };

  /* Kullanıcı tercihleri. Bozuk/eski kayıt okunamazsa varsayılana düşülür —
     tercih kaydı yüzünden ekran açılmaması kabul edilemez. */
  function loadPrefs() {
    try {
      const raw = JSON.parse(store.get(PREF_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        // Üretim Öncelikleri artık tek, sabit Buyer görünümünde çalışır.
        // Eski kullanıcı tercihlerindeki merchandiser/manager perspektiflerini bilinçli olarak yok say.
        state.perspective = 'buyer';
        if (raw.settings && raw.settings.targetType === 'inStore') state.settings.targetType = 'inStore';
        state.checklistSettings = Checklist.normalizeSettings(raw.checklistSettings);
        state.hidden = raw.hidden && typeof raw.hidden === 'object' ? raw.hidden : {};
        state.rules = Rules.mergeWithDefaults(raw.rules);
        state.attentionColumns = normalizeAttentionColumns(raw.attentionColumns);
        state.attentionExclusions = normalizeAttentionExclusions(raw.attentionExclusions || raw.attentionExceptions);
        state.moduleLayout = normalizeModuleLayouts(raw.moduleLayout);
      }
    } catch (_) { /* varsayılanlarla devam */ }
    try {
      const raw = JSON.parse(store.get(ANSWER_KEY) || 'null');
      if (raw && typeof raw === 'object') state.answers = raw;
    } catch (_) { state.answers = {}; }
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
    store.set(PREF_KEY, JSON.stringify({
        perspective: state.perspective, settings: state.settings,
        checklistSettings: state.checklistSettings, hidden: state.hidden, rules: state.rules,
        attentionColumns: state.attentionColumns, attentionExclusions: state.attentionExclusions,
        moduleLayout: state.moduleLayout,
    }));
    notifyDecisionContextChanged('preferences');
  }
  function saveAnswers() {
    store.set(ANSWER_KEY, JSON.stringify(state.answers));
    notifyDecisionContextChanged('checklist-answer');
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
      <td class="num">${int(item.rows)}</td>
      <td class="num">${item.reopened ? `<span class="cpaFlag" title="${esc(L('Yükleme tarihi değiştiği için yeniden soruldu', 'Re-asked because the load date changed'))}">${int(item.reopened)}</span>` : ''}</td>
      <td class="act"><button type="button" class="cpaBtn sm" data-cpa-open-checklist="${esc(item.id)}">${esc(L('Aç', 'Open'))}</button></td>
    </tr>`).join('');
    const disabled = summary.disabled.length
      ? `<p class="cpaNote">${esc(L('Takip edilmeyen kontroller', 'Not tracked'))}: ${summary.disabled.map(item => esc(itemLabel(item))).join(', ')}</p>` : '';
    return card('checklist', L('Kontrol Listesi', 'Checklist'), `
      <p class="cpaNote">${esc(L('Bu bilgiler Buyer Log\'da sütun olarak tutulmuyor; soru olarak sorulur. İşaretlediğiniz soru tekrar sorulmaz.', 'These are not stored as columns in Buyer Log; they are asked as questions. A question you mark is not asked again.'))}</p>
      ${items ? `<table class="cpaTable"><thead><tr><th>${esc(L('Kontrol', 'Check'))}</th><th class="num">${esc(L('Açık', 'Open'))}</th><th class="num">${esc(L('Yeniden', 'Re-asked'))}</th><th></th></tr></thead><tbody>${items}</tbody></table>`
    : `<p class="cpaEmpty">${esc(L('Şu an açık kontrol yok.', 'No open checks right now.'))}</p>`}
      ${summary.answeredTotal ? `<p class="cpaNote">${esc(L('Tamamlanan kontrol', 'Completed checks'))}: <b>${int(summary.answeredTotal)}</b></p>` : ''}
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
  function openChecklist(itemId) {
    const bucket = state.checklist.items.find(item => item.id === itemId);
    if (!bucket) return;
    const orders = bucket.allOrders || bucket.orders;
    const rows = orders.slice(0, 300).map(analysis => `<tr data-cpa-answer-row="${esc(analysis.orderKey)}">
      <td>${esc(analysis.orderCode)}</td>
      <td>${esc(analysis.modelName)} <small>${esc(analysis.colourCode)}</small></td>
      <td>${esc(analysis.dims.manufacturer)}</td>
      <td class="num">${analysis.daysToLoad == null ? '—' : int(analysis.daysToLoad)}</td>
      <td class="act">
        <button type="button" class="cpaBtn sm" data-cpa-answer="done" data-cpa-key="${esc(analysis.orderKey)}">${esc(Checklist.ANSWER_LABELS[lang()].done)}</button>
        <button type="button" class="cpaBtn sm ghost" data-cpa-answer="notRequired" data-cpa-key="${esc(analysis.orderKey)}">${esc(Checklist.ANSWER_LABELS[lang()].notRequired)}</button>
      </td></tr>`).join('');
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    modal.innerHTML = `<div class="cpaModal"><header>
        <div><b>${esc(itemLabel(bucket))}</b><small>${esc(questionOf(bucket))}</small></div>
        <button type="button" data-cpa-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody">
        <p class="cpaNote">${esc(L('İşaretlediğiniz sipariş için bu soru bir daha sorulmaz. Yükleme tarihi değişirse soru yeniden gelir.', 'The question is not asked again for an order you mark. If the load date changes, it comes back.'))}</p>
        <div class="cpaScroll"><table class="cpaTable"><thead><tr>
          <th>${esc(L('Sipariş', 'Order'))}</th><th>${esc(L('Model', 'Style'))}</th><th>${esc(L('Üretici', 'Supplier'))}</th>
          <th class="num">${esc(L('Yükleme', 'To load'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <footer><button type="button" class="cpaBtn" data-cpa-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); recompute(); render(); };
    modal.querySelectorAll('[data-cpa-close]').forEach(el => el.onclick = close);
    modal.onclick = event => { if (event.target === modal) close(); };
    modal.querySelectorAll('[data-cpa-answer]').forEach(el => el.onclick = () => {
      const analysis = orders.find(item => item.orderKey === el.dataset.cpaKey);
      if (!analysis) return;
      state.answers[Checklist.answerKey(analysis.orderKey, itemId)] = Checklist.makeAnswer(el.dataset.cpaAnswer, analysis, { by: (window.BL_USER_CONTEXT || {}).id || '' });
      saveAnswers();
      const row = modal.querySelector(`[data-cpa-answer-row="${CSS.escape(analysis.orderKey)}"]`);
      if (row) row.classList.add('is-answered');
    });
  }

  function openSettings() {
    const items = Checklist.ITEMS.map(item => {
      const config = state.checklistSettings.items[item.id];
      return `<div class="cpaSettingRow">
        <label class="cpaCheck"><input type="checkbox" data-cpa-item="${esc(item.id)}" ${config.enabled ? 'checked' : ''}>
          <span><b>${esc(itemLabel(item))}</b><small>${esc(questionOf(item))}</small></span></label>
        <label class="cpaDays"><span>${esc(L('Yüklemeye kalan gün', 'Days to load'))}</span>
          <input type="number" min="0" max="365" data-cpa-days="${esc(item.id)}" value="${Number(config.maxDaysToLoad) || 0}"></label>
      </div>`;
    }).join('');
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    modal.innerHTML = `<div class="cpaModal"><header>
        <div><b>${esc(L('Kontrol Ayarları', 'Checklist Settings'))}</b><small>${esc(L('Takip etmek istemediğiniz kontrolleri kapatın.', 'Turn off the checks you do not want to track.'))}</small></div>
        <button type="button" data-cpa-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody">
        <label class="cpaCheck cpaMaster"><input type="checkbox" data-cpa-master ${state.checklistSettings.enabled ? 'checked' : ''}>
          <span><b>${esc(L('Kontrol listesi açık', 'Checklist enabled'))}</b></span></label>
        <div class="cpaSettingRow">
          <span><b>${esc(L('Gecikmiş sipariş toleransı', 'Overdue grace window'))}</b>
            <small>${esc(L('Yükleme tarihi bu kadar günden fazla geçmişse kontrol sorulmaz; o siparişler zaten Kritik olarak görünür.', 'Checks are not asked for orders overdue by more than this; those already appear as Critical.'))}</small></span>
          <label class="cpaDays"><span>${esc(L('gün', 'days'))}</span>
            <input type="number" min="0" max="365" data-cpa-grace value="${Number(state.checklistSettings.overdueGraceDays) || 0}"></label>
        </div>
        <div class="cpaSettingGroup">${items}</div>
        <p class="cpaNote">${esc(L('Bu ayarlar yalnız sizin hesabınız içindir; diğer kullanıcıları etkilemez.', 'These settings apply only to your account and do not affect other users.'))}</p>
      </div>
      <footer><button type="button" class="cpaBtn" data-cpa-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); recompute(); render(); };
    modal.querySelectorAll('[data-cpa-close]').forEach(el => el.onclick = close);
    modal.onclick = event => { if (event.target === modal) close(); };
    const master = modal.querySelector('[data-cpa-master]');
    master.onchange = () => { state.checklistSettings.enabled = master.checked; savePrefs(); };
    modal.querySelectorAll('[data-cpa-item]').forEach(el => el.onchange = () => {
      state.checklistSettings.items[el.dataset.cpaItem].enabled = el.checked; savePrefs();
    });
    const grace = modal.querySelector('[data-cpa-grace]');
    if (grace) grace.onchange = () => {
      const next = Checklist.normalizeSettings({ ...state.checklistSettings, overdueGraceDays: Number(grace.value) });
      state.checklistSettings = next;
      grace.value = next.overdueGraceDays;
      savePrefs();
    };
    modal.querySelectorAll('[data-cpa-days]').forEach(el => el.onchange = () => {
      const next = Checklist.normalizeSettings({
        ...state.checklistSettings,
        items: { ...state.checklistSettings.items, [el.dataset.cpaDays]: { ...state.checklistSettings.items[el.dataset.cpaDays], maxDaysToLoad: Number(el.value) } },
      });
      state.checklistSettings = next;
      el.value = next.items[el.dataset.cpaDays].maxDaysToLoad;
      savePrefs();
    });
  }

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
     Yerleşik kurallar da burada görünür ve düzenlenebilir: gizli kural
     kalırsa kullanıcı bir siparişin neden Kritik olduğunu göremez. */
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

  function fieldOptions(selected) {
    const catalog = state.fieldCatalog || { derived: [], checklist: [], columns: [] };
    const group = (label, items) => (items.length
      ? `<optgroup label="${esc(label)}">${items.map(item =>
        `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(fieldDisplayLabel(item))}</option>`).join('')}</optgroup>`
      : '');
    return `<option value="">${esc(L('Alan seçin', 'Select a field'))}</option>`
      + group(L('Hesaplanan', 'Calculated'), catalog.derived)
      + group(L('Kontrol listesi', 'Checklist'), catalog.checklist)
      + group(L('CP sütunları', 'CP columns'), catalog.columns);
  }

  function fieldMeta(fieldId) {
    const catalog = state.fieldCatalog || { derived: [], checklist: [], columns: [] };
    return [...(catalog.derived || []), ...(catalog.checklist || []), ...(catalog.columns || [])]
      .find(entry => entry.id === fieldId) || null;
  }

  function fieldLabel(fieldId) {
    const item = fieldMeta(fieldId);
    return item ? fieldDisplayLabel(item) : (fieldId || L('Alan seçilmedi', 'No field selected'));
  }

  function ruleFieldItems() {
    const catalog = state.fieldCatalog || { derived: [], checklist: [], columns: [] };
    return [...(catalog.derived || []), ...(catalog.checklist || []), ...(catalog.columns || [])];
  }

  function formulaFieldIds() {
    return ruleFieldItems().map(item => String(item && item.id || '').trim()).filter(Boolean);
  }

  function formulaFieldCatalog() {
    return ruleFieldItems().slice(0, 120).map(item => {
      const id = String(item && item.id || '').trim().slice(0, 160);
      const rawType = String(item && (item.type || item.fieldType || '') || '').trim().toLowerCase();
      const type = ['text', 'number', 'date', 'boolean'].includes(rawType) ? rawType : 'value';
      return { id, label: String(fieldDisplayLabel(item) || id).trim().slice(0, 160) || id, type };
    }).filter(item => item.id);
  }

  function operatorLabel(operatorId) {
    const item = Rules.OPERATORS.find(entry => entry.id === operatorId);
    return item ? (isEn() ? item.en : item.tr) : operatorId;
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
    if (!fieldId || fieldId.startsWith('@') || !Array.isArray(lastRows)) return [];
    if (ruleValueCacheRows !== lastRows) {
      ruleValueCacheRows = lastRows;
      ruleValueCache.clear();
    }
    if (ruleValueCache.has(fieldId)) return ruleValueCache.get(fieldId);
    const byValue = new Map();
    const api = window.BLCpAttentionColumns;
    for (const row of lastRows) {
      const raw = rawRuleValue(row && row[fieldId]);
      if (!raw) continue;
      const dedupeKey = raw.toLocaleLowerCase('tr-TR');
      if (byValue.has(dedupeKey)) continue;
      let display = raw;
      try {
        const formatted = api && typeof api.format === 'function' ? String(api.format(fieldId, row) || '').trim() : '';
        if (formatted && formatted !== '—') display = formatted;
      } catch (_) { /* ham değer yeterli */ }
      byValue.set(dedupeKey, { raw, display });
      if (byValue.size >= 5000) break;
    }
    const values = [...byValue.values()].sort((a, b) => a.display.localeCompare(b.display, locale(), { numeric: true, sensitivity: 'base' }));
    ruleValueCache.set(fieldId, values);
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

  function valueControl(condition) {
    const operator = Rules.OPERATORS.find(item => item.id === condition.operator) || {};
    const right = condition.right || { type: 'value', value: condition.value };
    const meta = fieldMeta(condition.field) || {};
    const value = Array.isArray(right.value) ? right.value.join(', ') : right.value;
    if (!operator.value) return '<span class="cpaCondValueSpacer"></span>';
    if (right.type === 'today') return `<span class="cpaCondToday">TODAY()</span>`;
    if (right.type === 'field') return `<select data-cpa-cond-right-field aria-label="${esc(L('Sağ alan', 'Right field'))}">${fieldOptions(right.field)}</select>${offsetControl(right, 'right')}`;
    const multi = ['in', 'notIn'].includes(condition.operator);
    if (operator.numeric || (meta.numeric && !multi && condition.operator !== 'contains')) {
      return `<input type="number" step="any" data-cpa-cond-value value="${esc(value)}" placeholder="${esc(L('değer', 'value'))}" aria-label="${esc(L('Koşul değeri', 'Condition value'))}">`;
    }
    const cpSelectable = meta.source === 'column' || meta.source === 'formula';
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
      ['field', L('Alan', 'Field')],
      ['value', L('Değer', 'Value')],
      ['today', 'TODAY()'],
    ].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }

  function offsetControl(operand, side) {
    const offset = operand && operand.offset;
    const offsetValue = offset ? Number(offset.value) : 0;
    const offsetField = operand && operand.offsetField || '';
    return `<div class="cpaCondOffset" data-cpa-cond-${side}-offset-wrap>
      <input type="number" step="1" data-cpa-cond-${side}-offset value="${esc(offsetValue || '')}" placeholder="${esc(L('+ gün', '+ days'))}" aria-label="${esc(L('Tarih gün farkı', 'Date day offset'))}">
      <select data-cpa-cond-${side}-offset-unit aria-label="${esc(L('Tarih fark birimi', 'Date offset unit'))}"><option value="days"${!offset || offset.unit !== 'weeks' ? ' selected' : ''}>${esc(L('gün', 'days'))}</option><option value="weeks"${offset && offset.unit === 'weeks' ? ' selected' : ''}>${esc(L('hafta', 'weeks'))}</option></select>
      <select data-cpa-cond-${side}-offset-field aria-label="${esc(L('Gün farkı alanı', 'Day offset field'))}"><option value="">${esc(L('sabit fark', 'static offset'))}</option>${fieldOptions(offsetField)}</select>
    </div>`;
  }

  function operandControl(condition, side) {
    const operand = condition[side] || { type: side === 'left' ? 'field' : 'value' };
    const type = operand.type || (side === 'left' ? 'field' : 'value');
    let control = '';
    if (type === 'field') control = `<select data-cpa-cond-${side}-field aria-label="${esc(side === 'left' ? L('Sol alan', 'Left field') : L('Sağ alan', 'Right field'))}">${fieldOptions(operand.field)}</select>${offsetControl(operand, side)}`;
    else if (type === 'today') control = '<span class="cpaCondToday">TODAY()</span>';
    else {
      const raw = Array.isArray(operand.value) ? operand.value.join(', ') : operand.value;
      const isNumber = (fieldMeta(condition.field) || {}).numeric && !['in', 'notIn'].includes(condition.operator);
      const cpSelectable = side === 'right' && (fieldMeta(condition.field) || {}).source === 'column';
      control = cpSelectable
        ? valueControl(condition)
        : `<input ${isNumber ? 'type="number" step="any"' : ''} data-cpa-cond-${side}-value${side === 'right' ? ' data-cpa-cond-value' : ''} value="${esc(raw == null ? '' : raw)}" placeholder="${esc(L('değer', 'value'))}" aria-label="${esc(side === 'left' ? L('Sol değer', 'Left value') : L('Koşul değeri', 'Condition value'))}">`;
    }
    return `<div class="cpaCondOperand"><select data-cpa-cond-${side}-type aria-label="${esc(side === 'left' ? L('Sol operand tipi', 'Left operand type') : L('Sağ operand tipi', 'Right operand type'))}">${operandTypeOptions(type)}</select>${control}</div>`;
  }

  function conditionSummary(condition) {
    const item = Rules.normalizeCondition(condition);
    const operandLabel = operand => operand.type === 'field' ? fieldLabel(operand.field)
      : operand.type === 'today' ? 'TODAY()' : (Array.isArray(operand.value) ? operand.value.join(', ') : operand.value);
    const needsValue = !['empty', 'notEmpty'].includes(item.operator);
    return [operandLabel(item.left), operatorLabel(item.operator), needsValue ? operandLabel(item.right) : '']
      .filter(Boolean).join(' · ');
  }

  function ruleSummary(rule) {
    if (rule.mode === 'formula') return L('Formula kuralı', 'Formula rule');
    if (!rule.conditions.length) return L('Koşul yok', 'No conditions');
    const first = conditionSummary(rule.conditions[0]);
    const extra = rule.conditions.length - 1;
    return extra > 0 ? `${first} · +${extra} ${L('koşul', 'more')}` : first;
  }

  function ruleTone(rule) {
    if (rule.kind !== 'priority') return 'blue';
    return ({ CRITICAL: 'red', ACTION_TODAY: 'orange', ACTION_THIS_WEEK: 'yellow', WATCH: 'blue' })[rule.target] || 'gray';
  }

  function ruleBadge(rule) {
    return rule.kind === 'priority' ? priorityLabel(rule.target) : L('Kontrol', 'Checklist');
  }

  function conditionRow(rule, condition, index) {
    const operators = Rules.OPERATORS.map(item =>
      `<option value="${item.id}"${item.id === condition.operator ? ' selected' : ''}>${esc(isEn() ? item.en : item.tr)}</option>`).join('');
    return `<div class="cpaCondRow" data-cpa-cond="${esc(rule.id)}:${index}">
      ${operandControl(condition, 'left')}
      <select data-cpa-cond-op aria-label="${esc(L('Koşul operatörü', 'Condition operator'))}">${operators}</select>
      ${operandControl(condition, 'right')}
      <button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-cond-remove title="${esc(L('Koşulu sil', 'Remove condition'))}" aria-label="${esc(L('Koşulu sil', 'Remove condition'))}"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>`;
  }

  function ruleBlock(rule, expandedRuleId) {
    const isOpen = expandedRuleId === rule.id;
    const targets = Rules.SEVERITY.filter(key => key !== 'ON_TRACK' && key !== 'UNKNOWN');
    const conditionCount = rule.conditions.length;
    const countText = rule.mode === 'formula'
      ? L('Formula', 'Formula')
      : conditionCount === 1 ? L('1 koşul', '1 condition') : L(`${conditionCount} koşul`, `${conditionCount} conditions`);
    const matchText = rule.match === 'any' ? L('Biri yeterli', 'Any') : L('Hepsi', 'All');
    const editorFields = rule.kind === 'priority'
      ? `<label class="cpaRuleTarget cpaRuleNameField"><span>${esc(L('Kural adı', 'Rule name'))}</span>
          <input class="cpaRuleName" data-cpa-rule-name value="${esc(rule.name)}" placeholder="${esc(L('Kural adı', 'Rule name'))}"></label>
        <label class="cpaRuleTarget"><span>${esc(L('Önceliğe taşı', 'Escalate to'))}</span>
          <select data-cpa-rule-target>${targets.map(key =>
        `<option value="${key}"${rule.target === key ? ' selected' : ''}>${esc(priorityLabel(key))}</option>`).join('')}</select></label>`
      : `<label class="cpaRuleTarget cpaRuleNameField"><span>${esc(L('Kural adı', 'Rule name'))}</span>
          <input class="cpaRuleName" data-cpa-rule-name value="${esc(rule.name)}" placeholder="${esc(L('Kural adı', 'Rule name'))}"></label>
        <label class="cpaRuleTarget cpaRuleQuestionField"><span>${esc(L('Soru', 'Question'))}</span>
          <input data-cpa-rule-question value="${esc(isEn() ? rule.questionEn : rule.questionTr)}" placeholder="${esc(L('Hologram siparişi verildi mi?', 'Has the hologram been ordered?'))}"></label>`;
    const reasonFields = rule.kind === 'priority'
      ? `<div class="cpaRuleReasons">
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Sebep (TR)', 'Reason (TR)'))}</span>
            <input data-cpa-rule-reason-tr value="${esc(rule.reasonTr || '')}" placeholder="${esc('Örn. Sipariş retail aktarımı bekliyor')}"${rule.builtIn ? '' : ' required'} class="${!rule.builtIn && !String(rule.reasonTr || '').trim() ? 'is-invalid' : ''}">
            <small class="cpaRuleFieldError"${!rule.builtIn && !String(rule.reasonTr || '').trim() ? '' : ' hidden'}>${esc(L('Türkçe sebep zorunludur.', 'Turkish reason is required.'))}</small>
          </label>
          <label class="cpaRuleTarget cpaRuleReasonField"><span>${esc(L('Sebep (EN)', 'Reason (EN)'))}</span>
            <input data-cpa-rule-reason-en value="${esc(rule.reasonEn || '')}" placeholder="${esc('e.g. Order is awaiting retail transfer')}"${rule.builtIn ? '' : ' required'} class="${!rule.builtIn && !String(rule.reasonEn || '').trim() ? 'is-invalid' : ''}">
            <small class="cpaRuleFieldError"${!rule.builtIn && !String(rule.reasonEn || '').trim() ? '' : ' hidden'}>${esc(L('İngilizce sebep zorunludur.', 'English reason is required.'))}</small>
          </label>
        </div>`
      : '';
    const formulaFields = ruleFieldItems().slice(0, 80).map(item => `<button type="button" class="cpaFormulaField" data-cpa-formula-field="${esc(item.id)}">[${esc(fieldDisplayLabel(item))}]</button>`).join('');
    const modeEditor = `<div class="cpaRuleModeTabs" data-bl-tabs="segment" role="tablist" aria-label="${esc(L('Kural modu', 'Rule mode'))}">
          <button type="button" id="cpa-rule-mode-basic-${esc(rule.id)}" role="tab" data-cpa-rule-mode="basic" aria-controls="cpa-rule-mode-panel-${esc(rule.id)}" aria-selected="${rule.mode !== 'formula' ? 'true' : 'false'}" tabindex="${rule.mode !== 'formula' ? '0' : '-1'}" class="${rule.mode !== 'formula' ? 'is-on' : ''}">${esc(L('Temel kural', 'Basic Rule'))}</button>
          <button type="button" id="cpa-rule-mode-formula-${esc(rule.id)}" role="tab" data-cpa-rule-mode="formula" aria-controls="cpa-rule-mode-panel-${esc(rule.id)}" aria-selected="${rule.mode === 'formula' ? 'true' : 'false'}" tabindex="${rule.mode === 'formula' ? '0' : '-1'}" class="${rule.mode === 'formula' ? 'is-on' : ''}">${esc(L('Formula (Advanced)', 'Formula (Advanced)'))}</button>
        </div>`;
    const formulaEditor = `<div class="cpaFormulaEditor">
          <label class="cpaRuleTarget"><span>${esc(L('Formula', 'Formula'))}</span>
            <textarea data-cpa-rule-formula rows="6" spellcheck="false" placeholder="=AND([Status]<>\"In Production\",[Ex-Factory]+[Ex->Retail]<TODAY())">${esc(rule.formula || '')}</textarea>
          </label>
          <div class="cpaFormulaActions"><button type="button" class="cpaBtn sm" data-cpa-formula-test>${esc(L('Formülü test et', 'Test formula'))}</button><button type="button" class="cpaBtn sm cpaFormulaAiButton" data-cpa-formula-ai>${esc(L('✦ AI ile Formül oluştur', '✦ Recruit AI for Formula Writing'))}</button><span data-cpa-formula-status class="cpaFormulaStatus"></span></div>
          <div data-cpa-formula-error class="cpaRuleFieldError" hidden></div>
          <div data-cpa-formula-diagnostics class="cpaFormulaDiagnostics" hidden></div>
          <div class="cpaFormulaFields"><span>${esc(L('Alan ekle', 'Insert field'))}</span>${formulaFields || `<small>${esc(L('Henüz alan bulunamadı.', 'No fields available yet.'))}</small>`}</div>
        </div>`;
    const basicEditor = `<div class="cpaConditions">
          ${rule.conditions.length ? `<div class="cpaCondLabels" aria-hidden="true"><span>${esc(L('Sol operand', 'Left operand'))}</span><span>${esc(L('Operatör', 'Operator'))}</span><span>${esc(L('Sağ operand', 'Right operand'))}</span><span></span></div>` : ''}
          ${rule.conditions.map((condition, index) => conditionRow(rule, condition, index)).join('')
      || `<p class="cpaNote cpaRuleEmptyNote">${esc(L('Koşul yok — bu kural hiçbir siparişe uygulanmaz.', 'No conditions — this rule matches nothing.'))}</p>`}
        </div>
        <div class="cpaRuleBodyActions"><button type="button" class="cpaBtn sm" data-cpa-cond-add>+ ${esc(L('Koşul ekle', 'Add condition'))}</button></div>`;
    const body = isOpen ? `<div class="cpaRuleBody" id="cpa-rule-body-${esc(rule.id)}">
        <div class="cpaRuleHead">
          ${editorFields}
          <label class="cpaRuleTarget"><span>${esc(L('Koşullar', 'Conditions'))}</span>
            <select data-cpa-rule-match>
              <option value="all"${rule.match !== 'any' ? ' selected' : ''}>${esc(L('hepsi sağlanmalı', 'all must match'))}</option>
              <option value="any"${rule.match === 'any' ? ' selected' : ''}>${esc(L('biri yeterli', 'any may match'))}</option>
            </select></label>
        </div>
        ${reasonFields}
        ${modeEditor}
        <div class="cpaRuleModePanel" id="cpa-rule-mode-panel-${esc(rule.id)}" role="tabpanel" aria-labelledby="cpa-rule-mode-${rule.mode === 'formula' ? 'formula' : 'basic'}-${esc(rule.id)}" tabindex="0">${rule.mode === 'formula' ? formulaEditor : basicEditor}</div>
      </div>` : '';
    return `<div class="cpaRule${isOpen ? ' is-open' : ''}${rule.enabled ? '' : ' is-disabled'}" data-cpa-rule="${esc(rule.id)}">
      <header class="cpaRuleBar">
        <label class="cpaSwitch" title="${esc(L('Kuralı aç / kapat', 'Enable / disable rule'))}">
          <input type="checkbox" data-cpa-rule-enabled ${rule.enabled ? 'checked' : ''} aria-label="${esc(L('Kuralı etkinleştir', 'Enable rule'))}">
          <span class="cpaSwitchTrack" aria-hidden="true"><span></span></span>
        </label>
        <button type="button" class="cpaRuleSummary" data-cpa-rule-toggle aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="cpa-rule-body-${esc(rule.id)}">
          <span class="cpaPill tone-${ruleTone(rule)}">${esc(ruleBadge(rule))}</span>
          <span class="cpaRuleSummaryMain"><b>${esc(rule.name || L('Adsız kural', 'Unnamed rule'))}</b><small>${esc(ruleSummary(rule))}</small></span>
          <span class="cpaRuleSummaryMeta">${esc(countText)} · ${esc(matchText)}</span>
        </button>
        <div class="cpaRuleActions">
          ${rule.builtIn ? `<span class="cpaBuiltIn">${esc(L('Yerleşik', 'Built-in'))}</span>` : `<button type="button" class="cpaIconBtn cpaDangerIcon" data-cpa-rule-delete title="${esc(L('Kuralı sil', 'Delete rule'))}" aria-label="${esc(L('Kuralı sil', 'Delete rule'))}"><svg class="ic"><use href="#i-trash"/></svg></button>`}
          <button type="button" class="cpaRuleChevron" data-cpa-rule-toggle aria-label="${esc(isOpen ? L('Kuralı daralt', 'Collapse rule') : L('Kuralı genişlet', 'Expand rule'))}" aria-expanded="${isOpen ? 'true' : 'false'}"><svg class="ic"><use href="#i-chevron-down"/></svg></button>
        </div>
      </header>
      ${body}
    </div>`;
  }

  function openRules() {
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    let activeTab = 'priority';
    let expandedRuleId = null;
    let activeValuePicker = null;
    let activeValueMenu = null;
    let valuePositionRaf = 0;
    const newPriorityRuleIds = new Set();
    const valueMenuSafeMargin = 12;
    const valueMenuGap = 4;

    const setValuePickerExpanded = (picker, expanded, menu) => {
      if (!picker) return;
      const id = menu && menu.id;
      picker.querySelectorAll('[data-cpa-value-toggle], [data-cpa-cond-value]').forEach(el => {
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
      const toggle = activeValuePicker && activeValuePicker.querySelector('[data-cpa-value-toggle]');
      closeValueMenu();
      if (toggle) toggle.focus();
    };

    const rulesFor = kind => state.rules.filter(rule => rule.kind === kind);
    const scrollToRule = id => requestAnimationFrame(() => {
      const row = modal.querySelector(`[data-cpa-rule="${id}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest' });
      const focus = row.querySelector('[data-cpa-rule-name], [data-cpa-rule-question]');
      if (focus) focus.focus();
    });

    const draw = () => {
      closeValueMenu();
      const priority = rulesFor('priority');
      const checklist = rulesFor('checklist');
      const visible = activeTab === 'checklist' ? checklist : priority;
      const note = activeTab === 'checklist'
        ? L('Koşul, sorunun hangi siparişlerde sorulacağını belirler. Örnek: Lisans şunlardan biri → yalnız o lisansın siparişlerinde sorulur.', 'The condition decides which orders are asked. Example: License is one of → asked only for those orders.')
        : L('Kurallar önceliği yalnız YÜKSELTİR; hiçbir kural bir siparişi listeden düşüremez. Teslimat riski ve ETA kurallardan etkilenmez.', 'Rules only escalate priority; no rule can drop an order from the list. Delivery risk and ETA are unaffected.');
      const empty = activeTab === 'checklist'
        ? `<div class="cpaRulesEmpty"><b>${esc(L('Henüz özel kontrol sorusu yok', 'No custom checklist questions'))}</b><span>${esc(L('Belirli sipariş koşullarında sorulacak özel kontroller ekleyebilirsin.', 'Add questions that should be asked only when specific order conditions are met.'))}</span><button type="button" class="cpaBtn" data-cpa-add-checklist>+ ${esc(L('Kontrol sorusu ekle', 'Add checklist question'))}</button></div>`
        : `<div class="cpaRulesEmpty"><b>${esc(L('Öncelik kuralı yok', 'No priority rules'))}</b><span>${esc(L('Siparişleri aksiyon önceliğine taşıyan bir kural ekleyebilirsin.', 'Add a rule that escalates orders to an action priority.'))}</span><button type="button" class="cpaBtn" data-cpa-add-priority>+ ${esc(L('Öncelik kuralı ekle', 'Add priority rule'))}</button></div>`;
      modal.innerHTML = `<div class="cpaModal cpaRulesModal" role="dialog" aria-modal="true" aria-labelledby="cpaRulesTitle"><header>
          <div><b id="cpaRulesTitle">${esc(L('Öncelik ve Kontrol Kuralları', 'Priority and Checklist Rules'))}</b>
            <small>${esc(L('Bir siparişin neden Kritik ya da aksiyonluk olduğunu belirleyen koşulları tek yerden yönet.', 'Manage the conditions that decide why an order is critical or needs action.'))}</small></div>
          <button type="button" data-cpa-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>
        <div class="cpaModalBody cpaRulesBody">
          <div class="cpaRulesToolbar">
            <div class="cpaRulesTabs" data-bl-tabs="line" role="tablist" aria-label="${esc(L('Kural türü', 'Rule type'))}">
              <button type="button" id="cpaRulesTab-priority" role="tab" data-cpa-rules-tab="priority" aria-controls="cpaRulesPanel" aria-selected="${activeTab === 'priority' ? 'true' : 'false'}" tabindex="${activeTab === 'priority' ? '0' : '-1'}" class="${activeTab === 'priority' ? 'is-on' : ''}">${esc(L('Öncelik Kuralları', 'Priority Rules'))}<span>${priority.length}</span></button>
              <button type="button" id="cpaRulesTab-checklist" role="tab" data-cpa-rules-tab="checklist" aria-controls="cpaRulesPanel" aria-selected="${activeTab === 'checklist' ? 'true' : 'false'}" tabindex="${activeTab === 'checklist' ? '0' : '-1'}" class="${activeTab === 'checklist' ? 'is-on' : ''}">${esc(L('Kontrol Soruları', 'Checklist Questions'))}<span>${checklist.length}</span></button>
            </div>
            <button type="button" class="cpaBtn cpaRulesAdd" ${activeTab === 'checklist' ? 'data-cpa-add-checklist' : 'data-cpa-add-priority'}>+ ${esc(activeTab === 'checklist' ? L('Kontrol sorusu', 'Checklist question') : L('Öncelik kuralı', 'Priority rule'))}</button>
          </div>
          <p class="cpaNote cpaRulesNote">${esc(note)}</p>
          <div class="cpaRuleList" id="cpaRulesPanel" role="tabpanel" aria-labelledby="cpaRulesTab-${activeTab}" tabindex="0">${visible.length ? visible.map(rule => ruleBlock(rule, expandedRuleId)).join('') : empty}</div>
        </div>
        <footer><span class="cpaRulesCount">${esc(L(`${priority.length} öncelik kuralı · ${checklist.length} kontrol sorusu`, `${priority.length} priority rules · ${checklist.length} checklist questions`))}</span><button type="button" class="cpaBtn" data-cpa-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
      bindRules();
    };
    const findRule = id => state.rules.find(rule => rule.id === id);
    const ruleIdOf = el => el.closest('[data-cpa-rule]').dataset.cpaRule;
    const syncBasicFormula = rule => {
      if (!rule || rule.mode === 'formula') return;
      rule.formula = Rules.conditionsToFormula(rule.conditions, rule.match) || '=FALSE';
    };
    const commit = () => {
      state.rules.forEach(syncBasicFormula);
      savePrefs(); recompute();
    };
    function addPriority() {
      const rule = Rules.normalizeRule({ kind: 'priority', name: L('Yeni kural', 'New rule'), target: 'ACTION_THIS_WEEK', reasonTr: '', reasonEn: '', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] });
      state.rules.push(rule); newPriorityRuleIds.add(rule.id); activeTab = 'priority'; expandedRuleId = rule.id;
      commit(); draw(); scrollToRule(rule.id);
    }
    function addChecklist() {
      const rule = Rules.normalizeRule({ kind: 'checklist', name: L('Yeni kontrol', 'New check'), questionTr: '', questionEn: '', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }] });
      state.rules.push(rule); activeTab = 'checklist'; expandedRuleId = rule.id;
      commit(); draw(); scrollToRule(rule.id);
    }

    function notifyFormulaAi(message) {
      if (typeof showToast === 'function') showToast(message);
      else if (typeof toast === 'function') toast(message);
      else if (typeof window.alert === 'function') window.alert(message);
    }

    function openFormulaAiDialog(rule) {
      if (!rule) return;
      document.getElementById('_cpaFormulaAi')?.remove();
      const aiModal = document.createElement('div');
      aiModal.id = '_cpaFormulaAi';
      aiModal.className = 'cpaModalOverlay cpaFormulaAiOverlay';
      aiModal.innerHTML = `<div class="cpaModal cpaFormulaAiModal" role="dialog" aria-modal="true" aria-labelledby="cpaFormulaAiTitle">
        <header><div><b id="cpaFormulaAiTitle">${esc(L('AI ile Formül oluştur', 'Recruit AI for Formula Writing'))}</b>
          <small>${esc(L('Buyer Log alan kataloğu hazırlandı. AI yalnızca incelenebilir bir formül önerisi üretir.', 'The Buyer Log field catalog is prepared. AI produces a reviewable formula suggestion only.'))}</small></div>
          <button type="button" data-cpa-formula-ai-close aria-label="${esc(L('Kapat', 'Close'))}"><svg class="ic"><use href="#i-x"/></svg></button></header>
        <div class="cpaModalBody cpaFormulaAiBody">
          <div class="cpaFormulaAiTrainingNote">${esc(L('Recruit adımı gerçek model eğitimi yapmaz; Buyer Log formül sözdizimini ve bu kuralın alan kataloğunu kontrollü bağlam olarak kullanır.', 'Recruit prepares controlled Buyer Log formula context; it does not retrain the model.'))}</div>
          <label class="cpaRuleTarget"><span>${esc(L('Derdini anlat', 'Describe the problem'))}</span>
            <textarea data-cpa-formula-ai-request rows="6" maxlength="3000" placeholder="${esc(L('Örn. Üretimde olmayan ve yükleme tarihi 7 günden yakın siparişleri bu kurala al.', 'Example: include orders that are not in production and have a load date within 7 days.'))}"></textarea></label>
          <div class="cpaFormulaAiActions"><button type="button" class="cpaBtn" data-cpa-formula-ai-generate>${esc(L('Formül öner', 'Generate formula'))}</button><span data-cpa-formula-ai-status class="cpaFormulaStatus"></span></div>
          <label class="cpaRuleTarget"><span>${esc(L('Önerilen formül', 'Suggested formula'))}</span>
            <textarea data-cpa-formula-ai-result rows="5" readonly spellcheck="false"></textarea></label>
          <p data-cpa-formula-ai-explanation class="cpaNote"></p>
        </div>
        <footer><button type="button" class="cpaBtn" data-cpa-formula-ai-cancel>${esc(L('Vazgeç', 'Cancel'))}</button><button type="button" class="cpaBtn primary" data-cpa-formula-ai-apply disabled>${esc(L('Formülü uygula', 'Apply formula'))}</button></footer>
      </div>`;
      document.body.appendChild(aiModal);
      const requestInput = aiModal.querySelector('[data-cpa-formula-ai-request]');
      const resultInput = aiModal.querySelector('[data-cpa-formula-ai-result]');
      const explanation = aiModal.querySelector('[data-cpa-formula-ai-explanation]');
      const status = aiModal.querySelector('[data-cpa-formula-ai-status]');
      const generate = aiModal.querySelector('[data-cpa-formula-ai-generate]');
      const apply = aiModal.querySelector('[data-cpa-formula-ai-apply]');
      let suggestion = '';
      let controller = null;
      const closeAi = () => {
        if (controller) controller.abort();
        aiModal.remove();
      };
      aiModal.querySelectorAll('[data-cpa-formula-ai-close], [data-cpa-formula-ai-cancel]').forEach(button => button.onclick = closeAi);
      aiModal.onclick = event => { if (event.target === aiModal) closeAi(); };
      aiModal.addEventListener('keydown', event => { if (event.key === 'Escape') closeAi(); });
      generate.onclick = async () => {
        const request = String(requestInput.value || '').trim();
        if (!request) {
          status.textContent = L('Önce ihtiyacı açıklayın.', 'Describe the problem first.');
          status.className = 'cpaFormulaStatus is-invalid';
          requestInput.focus();
          return;
        }
        generate.disabled = true;
        apply.disabled = true;
        suggestion = '';
        resultInput.value = '';
        explanation.textContent = '';
        status.textContent = L('AI önerisi hazırlanıyor…', 'Preparing AI suggestion…');
        status.className = 'cpaFormulaStatus';
        controller = new AbortController();
        try {
          const response = await fetch('/api/copilot/formula', {
            method: 'POST', credentials: 'same-origin', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request, fields: formulaFieldCatalog(), language: isEn() ? 'en' : 'tr' }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.ok) throw new Error(data.error || L('AI önerisi alınamadı.', 'AI suggestion could not be generated.'));
          const formula = String(data.formula || '').trim();
          const validation = Rules.validateExpression(formula, { fields: formulaFieldIds() });
          if (!validation.valid) throw new Error((validation.errors || [L('Üretilen formül geçersiz.', 'Generated formula is invalid.')]).join(' · '));
          suggestion = formula;
          resultInput.value = formula;
          explanation.textContent = String(data.explanation || '').trim();
          apply.disabled = false;
          status.textContent = L('✓ Güvenli öneri hazır', '✓ Safe suggestion ready');
          status.className = 'cpaFormulaStatus is-valid';
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          status.textContent = error && error.message ? error.message : L('AI önerisi alınamadı.', 'AI suggestion could not be generated.');
          status.className = 'cpaFormulaStatus is-invalid';
        } finally {
          controller = null;
          if (aiModal.isConnected) generate.disabled = false;
        }
      };
      apply.onclick = () => {
        if (!suggestion) return;
        const validation = Rules.validateExpression(suggestion, { fields: formulaFieldIds() });
        if (!validation.valid) {
          notifyFormulaAi((validation.errors || [L('Formül geçersiz.', 'Formula is invalid.')]).join(' · '));
          apply.disabled = true;
          return;
        }
        rule.formula = suggestion;
        rule.mode = 'formula';
        const synced = Rules.formulaToConditions(suggestion);
        if (synced) {
          rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
          rule.match = synced.match;
        }
        closeAi();
        commit(); draw(); scrollToRule(rule.id);
      };
      requestAnimationFrame(() => requestInput.focus());
    }

    function bindRules() {
      modal.querySelectorAll('[data-cpa-close]').forEach(el => el.onclick = close);
      modal.querySelectorAll('[data-cpa-rules-tab]').forEach(el => el.onclick = () => {
        activeTab = el.dataset.cpaRulesTab;
        expandedRuleId = null;
        draw();
      });
      modal.querySelectorAll('[data-cpa-add-priority]').forEach(el => el.onclick = addPriority);
      modal.querySelectorAll('[data-cpa-add-checklist]').forEach(el => el.onclick = addChecklist);
      modal.querySelectorAll('[data-cpa-rule-toggle]').forEach(el => el.onclick = () => {
        const id = ruleIdOf(el);
        expandedRuleId = expandedRuleId === id ? null : id;
        draw();
        if (expandedRuleId) scrollToRule(id);
      });
      modal.querySelectorAll('[data-cpa-rule-enabled]').forEach(el => el.onchange = () => { findRule(ruleIdOf(el)).enabled = el.checked; commit(); });
      modal.querySelectorAll('[data-cpa-rule-name]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el)); rule.name = el.value;
        if (rule.kind === 'checklist') { rule.tr = el.value; rule.en = el.value; }
        commit();
      });
      modal.querySelectorAll('[data-cpa-rule-target]').forEach(el => el.onchange = () => { findRule(ruleIdOf(el)).target = el.value; commit(); });
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
      modal.querySelectorAll('[data-cpa-rule-delete]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule || rule.builtIn) return;
        if (!confirm(L(`"${rule.name}" kuralı silinsin mi?`, `Delete the rule "${rule.name}"?`))) return;
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
      /* Legacy markup compatibility: saved/browser-restored editor nodes from
         the old single-field condition row still normalize into the new left
         operand model. */
      modal.querySelectorAll('[data-cpa-cond-field]').forEach(el => {
        el.onchange = () => {
          const condition = condOf(el);
          condition.field = el.value; condition.value = '';
          const operand = operandOf(condition, 'left');
          operand.type = 'field'; operand.field = el.value; operand.value = '';
          redrawCondition(el);
        };
      });
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
      const setOperandType = (condition, side, type) => {
        const operand = operandOf(condition, side);
        operand.type = ['field', 'value', 'today'].includes(type) ? type : 'value';
        if (operand.type === 'field' && !operand.field) operand.field = side === 'left' ? condition.field || '@daysToLoad' : '@daysToLoad';
        if (operand.type !== 'field') { operand.field = ''; operand.offset = null; operand.offsetField = ''; }
        if (operand.type !== 'value' && side === 'right') operand.value = '';
        if (side === 'left') condition.field = operand.type === 'field' ? operand.field : '';
      };
      modal.querySelectorAll('[data-cpa-cond-left-type]').forEach(el => el.onchange = () => {
        const condition = condOf(el); setOperandType(condition, 'left', el.value); redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-right-type]').forEach(el => el.onchange = () => {
        const condition = condOf(el); setOperandType(condition, 'right', el.value); redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-left-field]').forEach(el => el.onchange = () => {
        const condition = condOf(el); const operand = operandOf(condition, 'left');
        operand.type = 'field'; operand.field = el.value; condition.field = el.value; operand.offset = null; operand.offsetField = '';
        redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-right-field]').forEach(el => el.onchange = () => {
        const condition = condOf(el); const operand = operandOf(condition, 'right');
        operand.type = 'field'; operand.field = el.value; operand.offset = null; operand.offsetField = '';
        redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-left-value]').forEach(el => el.onchange = () => { operandOf(condOf(el), 'left').value = el.value; commit(); });
      modal.querySelectorAll('[data-cpa-cond-op]').forEach(el => el.onchange = () => {
        const condition = condOf(el);
        condition.operator = el.value;
        redrawCondition(el);
      });
      modal.querySelectorAll('[data-cpa-cond-value]').forEach(el => el.onchange = () => {
        const condition = condOf(el); operandOf(condition, 'right').value = el.value; condition.value = el.value; commit();
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
        modal.querySelectorAll(`[data-cpa-cond-${side}-offset-field]`).forEach(el => el.onchange = () => {
          operandOf(condOf(el), side).offsetField = el.value || ''; commit();
        });
      });

      const renderFormulaFeedback = (row, rule, result) => {
        if (!row) return;
        const status = row.querySelector('[data-cpa-formula-status]');
        const error = row.querySelector('[data-cpa-formula-error]');
        const diagnostics = row.querySelector('[data-cpa-formula-diagnostics]');
        if (result && result.valid) {
          if (status) { status.textContent = L('✓ Formula geçerli', '✓ Formula valid'); status.className = 'cpaFormulaStatus is-valid'; }
          if (error) { error.hidden = true; error.textContent = ''; }
        } else if (result) {
          if (status) { status.textContent = L('Formula geçersiz', 'Formula invalid'); status.className = 'cpaFormulaStatus is-invalid'; }
          if (error) { error.hidden = false; error.textContent = (result.errors || [result.error || '']).join(' · '); }
        }
        if (diagnostics && result && result.diagnostics && result.diagnostics.length) {
          diagnostics.hidden = false;
          diagnostics.innerHTML = result.diagnostics.map(item => `<span>${esc(fieldLabel(item.field))} = <b>${esc(item.value == null || item.value === '' ? '—' : item.value)}</b></span>`).join('');
        }
      };
      modal.querySelectorAll('[data-cpa-rule-mode]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        const nextMode = el.dataset.cpaRuleMode === 'formula' ? 'formula' : 'basic';
        if (nextMode === 'formula') {
          const generated = Rules.conditionsToFormula(rule.conditions, rule.match);
          if (rule.mode !== 'formula' || !String(rule.formula || '').trim()) rule.formula = generated || '=FALSE';
          rule.mode = 'formula';
        } else {
          const synced = Rules.formulaToConditions(rule.formula);
          if (String(rule.formula || '').trim() && !synced) {
            if (typeof showToast === 'function') showToast(L('Bu formula temel koşullara otomatik çevrilemiyor; Formula modu korunuyor.', 'This formula cannot be converted to basic conditions; Formula mode is kept.'));
            return;
          }
          if (synced) {
            rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
            rule.match = synced.match;
          }
          rule.mode = 'basic';
        }
        commit(); draw(); scrollToRule(rule.id);
      });
      modal.querySelectorAll('[data-cpa-rule-formula]').forEach(el => el.oninput = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.formula = el.value;
        const synced = Rules.formulaToConditions(rule.formula);
        if (synced) {
          rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
          rule.match = synced.match;
        }
        renderFormulaFeedback(el.closest('[data-cpa-rule]'), rule, Rules.validateExpression(rule.formula, { fields: formulaFieldIds() }));
      });
      modal.querySelectorAll('[data-cpa-rule-formula]').forEach(el => el.onchange = () => {
        const rule = findRule(ruleIdOf(el));
        if (!rule) return;
        rule.formula = el.value;
        const synced = Rules.formulaToConditions(rule.formula);
        if (synced) {
          rule.conditions = synced.conditions.map(condition => Rules.normalizeCondition(condition));
          rule.match = synced.match;
        }
        commit();
      });
      modal.querySelectorAll('[data-cpa-formula-ai]').forEach(el => el.onclick = () => {
        const rule = findRule(ruleIdOf(el));
        if (rule) openFormulaAiDialog(rule);
      });
      modal.querySelectorAll('[data-cpa-formula-test]').forEach(el => el.onclick = () => {
        const row = el.closest('[data-cpa-rule]'); const rule = findRule(ruleIdOf(el));
        const validation = Rules.validateExpression(rule.formula, { fields: formulaFieldIds() });
        if (!validation.valid) { renderFormulaFeedback(row, rule, validation); return; }
        const analysis = state.model && state.model.orders && state.model.orders[0];
        const sampleFacts = analysis ? Rules.factsFor(analysis, {}) : { row: (lastRows && lastRows[0]) || {}, derived: {}, checklist: {} };
        const result = Rules.evaluateExpression(rule.formula, sampleFacts);
        renderFormulaFeedback(row, rule, { valid: !result.error, errors: result.error ? [result.error] : [], diagnostics: result.diagnostics || [] });
        if (result.error) return;
        const status = row.querySelector('[data-cpa-formula-status]');
        if (status) status.textContent = `${L('Sonuç', 'Result')}: ${String(result.value).toUpperCase()}`;
      });
      modal.querySelectorAll('[data-cpa-formula-field]').forEach(el => el.onclick = () => {
        const row = el.closest('[data-cpa-rule]'); const textarea = row && row.querySelector('[data-cpa-rule-formula]');
        if (!textarea) return;
        const fieldId = el.dataset.cpaFormulaField;
        const start = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
        const end = textarea.selectionEnd == null ? start : textarea.selectionEnd;
        textarea.value = `${textarea.value.slice(0, start)}[${fieldId}]${textarea.value.slice(end)}`;
        textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.focus();
      });

      const openValueMenu = (picker, menu) => {
        if (!picker || !menu) return;
        if (activeValueMenu && activeValueMenu !== menu) closeValueMenu();
        const search = menu.querySelector('[data-cpa-value-search]');
        const host = menu.querySelector('[data-cpa-value-options]');
        const condition = condOf(picker);
        if (search) search.value = '';
        if (host) host.innerHTML = valueOptionRows(condition, '');
        const condKey = picker.closest('[data-cpa-cond]')?.dataset.cpaCond || String(Date.now());
        menu.id = `cpa-value-menu-${condKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        activeValuePicker = picker;
        activeValueMenu = menu;
        setValuePickerExpanded(picker, true, menu);
        document.body.appendChild(menu);
        menu.hidden = false;
        positionValueMenu();
        setTimeout(() => search && activeValueMenu === menu && search.focus(), 0);
      };
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
        if (menu) menu.onkeydown = event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeValueMenu();
            if (toggle) toggle.focus();
            return;
          }
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          const options = [...menu.querySelectorAll('button[data-cpa-value-option], input[type="checkbox"][data-cpa-value-option]')]
            .filter(el => !el.disabled && el.offsetParent !== null);
          if (!options.length) return;
          const current = options.indexOf(document.activeElement);
          let next;
          if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(options.length - 1, current + 1);
          else next = current < 0 ? options.length - 1 : Math.max(0, current - 1);
          event.preventDefault();
          options[next].focus();
        };
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
        commit(); draw(); scrollToRule(id);
      });
    }
    function validateNewPriorityReasons() {
      const invalid = [...newPriorityRuleIds]
        .map(id => findRule(id))
        .find(rule => rule && (!String(rule.reasonTr || '').trim() || !String(rule.reasonEn || '').trim()));
      if (!invalid) return true;
      activeTab = 'priority';
      expandedRuleId = invalid.id;
      draw();
      scrollToRule(invalid.id);
      requestAnimationFrame(() => {
        const row = modal.querySelector(`[data-cpa-rule="${invalid.id}"]`);
        const field = row && row.querySelector(!String(invalid.reasonTr || '').trim() ? '[data-cpa-rule-reason-tr]' : '[data-cpa-rule-reason-en]');
        if (field) field.focus();
      });
      return false;
    }

    function validateFormulaRules() {
      const invalid = state.rules.find(rule => rule.mode === 'formula'
        && !Rules.validateExpression(rule.formula, { fields: formulaFieldIds() }).valid);
      if (!invalid) return true;
      expandedRuleId = invalid.id;
      activeTab = invalid.kind === 'checklist' ? 'checklist' : 'priority';
      draw();
      scrollToRule(invalid.id);
      return false;
    }

    function close() {
      if (!validateNewPriorityReasons()) return;
      if (!validateFormulaRules()) return;
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
    modal.onclick = event => { if (event.target === modal) close(); };
  }

  /* ------------------------------------------------------------- hesaplama */
  let lastRows = null;
  function analyzeRowsWithPersonalRules(rows, options) {
    const list = Array.isArray(rows) ? rows : [];
    const opts = options || {};
    const transitRules = (window.state && window.state.overrides && window.state.overrides.transitRules) || [];
    let model = Engine.analyze(list, { settings: { targetType: state.settings.targetType }, transitRules });

    /* Tek kişisel karar katmanı. CP tablosu, Overview ve Attention aynı
       rule/checklist state'ini buradan tüketir; ikinci bir Priority motoru yoktur. */
    const checklistState = new Map();
    const customItems = new Map();
    for (const analysis of model.orders) {
      const custom = Rules.customChecklistItems(analysis, state.rules, {});
      customItems.set(analysis.orderKey, custom);
      checklistState.set(analysis.orderKey, Checklist.stateFor(analysis, {
        settings: state.checklistSettings, answers: state.answers, customItems: custom,
      }));
    }
    for (const analysis of model.orders) {
      const applied = Rules.applyPriorityRules(analysis, state.rules, checklistState.get(analysis.orderKey));
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
    }
    model = Engine.recount(model);

    if (opts.commit === true) {
      state.model = model;
      state.checklist = Checklist.summarize(model.orders, {
        settings: state.checklistSettings, answers: state.answers, limit: 5000,
        customItemsFor: analysis => customItems.get(analysis.orderKey) || [],
      });
      const liveColumnCatalog = liveRuleColumnCatalog();
      state.fieldCatalog = Rules.fieldCatalog(list, {
        formulaColumns: (window.BLFormulaColumns && window.BLFormulaColumns.definitions) ? window.BLFormulaColumns.definitions('cp') : [],
        checklistItems: Checklist.ITEMS,
        columnCatalog: liveColumnCatalog,
      });
    }
    return model;
  }

  function recompute() {
    if (!lastRows) return;
    analyzeRowsWithPersonalRules(lastRows, { commit: true });
  }

  /* CP / Orders Priority hücreleri de Overview ile AYNI kişisel decision
     context'ini kullanır. byRow WeakMap'i aynı row objesi üzerinden O(1)
     eşleşme sağlar; display text hiçbir zaman identity olarak kullanılmaz. */
  function computeDecisionsForRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const model = analyzeRowsWithPersonalRules(list, { commit: false });
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
    const signature = `${datasetSignature}|filter:${filterRevision}|target:${state.settings.targetType}|decision:${decisionContextRevision}|${columnSignature}`;
    if (signature === state.rowsSignature && state.model) { render(); return; }
    state.rowsSignature = signature;
    try { window.BLPerf?.mark?.('PRODUCTION_FOCUS_RECOMPUTE', { dataRevision, rows: list.length }); } catch (_) {}
    recompute();
    render();
  }

  loadPrefs();
  state.moduleLayout = normalizeModuleLayouts(state.moduleLayout);
  window.BLCpAssistant = { onOverviewRendered, render, computeDecisionsForRows, decisionContextRevision: () => decisionContextRevision, _state: state };
})();
