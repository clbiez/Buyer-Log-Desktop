/* Buyer Log — Checklist ↔ CP ↔ Supplier Excel bridge.
   Checklist is the source of truth for dynamic CP columns. Supplier workbooks
   carry immutable Buyer Log identity in hidden columns and explicit statuses. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.BLChecklistSupplierSync = api;
    setTimeout(function () { api.init(); }, 0);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Components = root.BLChecklistComponents || (root.BLCpChecklistEngine && root.BLCpChecklistEngine.Components) || (typeof require === 'function' ? require('./checklist-components-engine') : null);
  const API = '/api/checklist-supplier';
  const ANSWER_KEY = 'lcw.cp.checklist.v1';
  const PENDING_KEY = 'lcw.cp.checklist.pending.v1';
  const COLUMN_PREFIX = '__checklist__';
  const META_SHEET = '__BL_META';
  const DATA_SHEET = 'Checklist';
  const SCHEMA_VERSION = 2;
  const EXCEL_COLUMNS_KEY = 'lcw.cp.checklist.excel.columns.v1';
  const EXCEL_DATE_FORMAT = 'dd.mm.yyyy';
  const EXCEL_PROTECTION_PASSWORD = 'BuyerLogChecklist';
  const DEFAULT_EXCEL_COLUMNS = Object.freeze(['image', 'order', 'plm', 'model', 'colour', 'supplier', 'exfactory']);
  const state = {
    started: false,
    loading: null,
    applyingRemote: false,
    syncingDefinitions: false,
    syncingAnswers: false,
    syncQueued: false,
    syncRetryTimer: null,
    syncPromise: null,
    pendingAnswers: {},
    journalLoaded: false,
    journalError: false,
    observedAnswers: null,
    pendingUploads: 0,
    shared: { definitions: [], answers: {}, tombstones: {}, revision: 0, updatedAt: '' },
    answerBaseline: {},
    renderWrapped: false,
    testTasks: new Map(),
    reportDropBound: false,
    appliedColumns: null,
    runtimeLoadedAt: 0,
    runtimeSignature: '',
  };

  // Set only while the server builds a supplier workbook for Office: the
  // owner's language and custom statuses replace the page-level sources.
  let buildContext = null, parseLanguage = null;
  function isEn() {
    if (parseLanguage) return parseLanguage === 'en';
    if (buildContext && buildContext.language) return buildContext.language === 'en';
    return String((root.document && root.document.documentElement.lang) || root.appLang || 'tr').toLowerCase().startsWith('en');
  }
  function T(tr, en) { return isEn() ? en : tr; }
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function html(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(message) {
    if (typeof root.showToast === 'function') root.showToast(message);
    else if (root.console && root.console.info) root.console.info(message);
  }
  function safeJson(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function answerKey(orderKey, itemId) { return text(orderKey) + '::' + text(itemId); }
  function splitAnswerKey(key) {
    const raw = String(key || ''), at = raw.lastIndexOf('::');
    return at > 0 ? { orderKey: raw.slice(0, at), itemId: raw.slice(at + 2) } : { orderKey: '', itemId: '' };
  }
  function columnKey(itemId) {
    return COLUMN_PREFIX + String(itemId || '').replace(/[^A-Za-z0-9_-]/g, function (ch) {
      return '_' + ch.charCodeAt(0).toString(16) + '_';
    });
  }
  /* v7.221 — dört durum: Pending (open) · Approved · Rejected · Not Required.
     Eski Excel/kayıt değerleri (Completed, Tamamlandı, Open…) aynı kanonik
     duruma okunur; tanınmayan değer '' döner ve geçersiz sayılır. */
  const STATUS_ORDER = Object.freeze(['open', 'approved', 'rejected', 'notRequired', 'custom:ordered']);
  function availableStatuses() {
    if (buildContext) return STATUS_ORDER.concat((buildContext.customStatuses || []).map(function (item) { return item.id; }));
    const engine = root.BLCpChecklistEngine;
    return engine && typeof engine.statusIds === 'function' ? engine.statusIds() : STATUS_ORDER.slice();
  }
  function normalizeState(value, customList) {
    const raw = text(value).toLocaleLowerCase('tr-TR').replace(/[._-]+/g, ' ');
    if (!raw) return '';
    if (['ordered', 'sipariş geçildi', 'siparis gecildi'].includes(raw)) return 'custom:ordered'; // i18n-ignore — import aliases
    if (['approved', 'approve', 'onaylandı', 'onaylandi', 'onaylı', 'onayli', 'done', 'completed', 'complete', 'tamam', 'tamamlandı', 'tamamlandi', 'yes', 'evet'].includes(raw)) return 'approved'; // i18n-ignore — import aliasları, UI metni değil
    if (['rejected', 'reject', 'reddedildi', 'red', 'ret', 'failed', 'fail', 'no', 'hayır', 'hayir'].includes(raw)) return 'rejected'; // i18n-ignore — import aliasları, UI metni değil
    if (['notrequired', 'not required', 'n a', 'na', 'gerekmiyor', 'gerek yok', 'uygulanmaz'].includes(raw)) return 'notRequired';
    if (['open', 'pending', 'açık', 'acik', 'bekliyor', 'beklemede', 'yeniden aç', 'yeniden ac'].includes(raw)) return 'open'; // i18n-ignore — import aliasları, UI metni değil
    const engine = root.BLCpChecklistEngine;
    // The server import passes the owner's custom statuses explicitly.
    const custom = Array.isArray(customList) ? customList
      : buildContext ? (buildContext.customStatuses || [])
      : engine && typeof engine.customStatuses === 'function' ? engine.customStatuses() : [];
    const match = custom.find(item => item && typeof item.name === 'string' && item.name.toLocaleLowerCase('tr-TR') === raw);
    if (match) return match.id;
    const direct = String(value == null ? '' : value).trim();
    if (/^custom:[a-z0-9][a-z0-9-]{0,47}$/.test(direct)) return direct;
    return '';
  }
  function statusLabel(status) {
    const s = normalizeState(status);
    if (s === 'custom:ordered') return T('Sipariş Geçildi', 'Ordered');
    if (s === 'approved') return T('Onaylandı', 'Approved');
    if (s === 'rejected') return T('Reddedildi', 'Rejected');
    if (s === 'notRequired') return T('Gerekmiyor', 'Not Required');
    if (s === 'open') return T('Bekliyor', 'Pending');
    const engine = root.BLCpChecklistEngine;
    const named = s.startsWith('custom:') && buildContext && (buildContext.customStatuses || []).find(function (item) { return item.id === s; });
    if (named) return named.name;
    if (s.startsWith('custom:')) return engine && typeof engine.statusLabel === 'function'
      ? engine.statusLabel(s, isEn() ? 'en' : 'tr') : s.slice(7).replace(/-/g, ' ');
    return '';
  }
  function statusOptions() {
    return availableStatuses().map(statusLabel);
  }
  function isoNow() { return new Date().toISOString(); }

  async function jsonFetch(url, options) {
    const response = await root.fetch(url, options || {});
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || ('HTTP ' + response.status));
      error.code = payload.code || 'HTTP_ERROR';
      throw error;
    }
    return payload;
  }
  async function post(path, body) {
    return jsonFetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }
  async function ensureAssistant() {
    if (root.BLCpAssistant && root.BLCpChecklistEngine && root.BLCpRulesEngine) return root.BLCpAssistant;
    if (root.BLPerf && typeof root.BLPerf.ensureFeature === 'function') await root.BLPerf.ensureFeature('cpAssistant');
    return root.BLCpAssistant || null;
  }
  async function ensureExcel() {
    if (root.BLPerf && typeof root.BLPerf.ensureLibrary === 'function') await root.BLPerf.ensureLibrary('exceljs');
    if (!root.ExcelJS || typeof root.ExcelJS.Workbook !== 'function') {
      throw new Error(T('Excel motoru yüklenemedi.', 'Excel engine could not be loaded.'));
    }
    return root.ExcelJS;
  }

  function assistantState() {
    return root.BLCpAssistant && root.BLCpAssistant._state ? root.BLCpAssistant._state : null;
  }
  function snapshotAnswers() {
    const s = assistantState();
    return safeJson((s && s.answers) || {});
  }
  function sameJson(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }

  // This journal is device-local and user-scoped. Generic preference hydration
  // must not replace an unacknowledged edit with another device's snapshot.
  function journalStorage() {
    const storage = root.BLStorage;
    return { native: storage && storage.native || root.localStorage,
      key: storage && storage.actualKey ? storage.actualKey(PENDING_KEY) : 'bl.user.' + String((root.BL_USER_CONTEXT || {}).id || 'anonymous') + '.' + PENDING_KEY };
  }
  function readPendingAnswers() {
    if (state.journalLoaded) return;
    const storage = journalStorage();
    try {
      const raw = storage.native && storage.native.getItem(storage.key);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid checklist journal');
      state.pendingAnswers = parsed;
      state.journalLoaded = true;
    } catch (error) {
      state.journalError = true;
      throw new Error(T('Bekleyen checklist kayıtları okunamadı; mevcut kayıt korunuyor.', 'Pending checklist changes could not be read; existing records are preserved.'));
    }
  }
  function persistPendingAnswers() {
    const storage = journalStorage();
    try {
      if (!storage.native) throw new Error('Checklist local storage unavailable');
      if (Object.keys(state.pendingAnswers).length) storage.native.setItem(storage.key, JSON.stringify(state.pendingAnswers));
      else storage.native.removeItem(storage.key);
      state.journalError = false;
      return true;
    } catch (error) {
      if (!state.journalError) toast(T('Checklist yerel kaydı başarısız; sunucu onayı bekleniyor.', 'Checklist local save failed; waiting for server acknowledgement.'));
      state.journalError = true;
      return false;
    }
  }
  function captureAnswerChanges() {
    readPendingAnswers();
    const current = snapshotAnswers();
    const entries = diffAnswers(state.observedAnswers || state.answerBaseline, current);
    entries.forEach(function (entry) { state.pendingAnswers[answerKey(entry.orderKey, entry.itemId)] = entry; });
    state.observedAnswers = current;
    persistPendingAnswers();
    return current;
  }

  /* v7.221 — checklist başlıkları KİŞİSELDİR (Ön Ayar Paylaşımı ile
     paylaşılır). Sunucudaki eski ortak liste yalnız geçiş için bir kez
     kullanıcının kendi kaydına alınır; her açılışta üzerine yazılmaz. */
  function adoptRemoteDefinitions(definitions) {
    const assistant = root.BLCpAssistant;
    if (!assistant || typeof assistant.adoptSharedChecklistDefinitions !== 'function') return false;
    return assistant.adoptSharedChecklistDefinitions(definitions);
  }

  function mergeRemoteAnswers(payload) {
    const s = assistantState();
    if (!s) return;
    const engine = typeof module === 'object' && module.exports ? require('./checklist-answer-merge-engine') : root.BLChecklistAnswerMergeEngine;
    state.applyingRemote = true;
    try {
      s.answers = engine.merge(s.answers, payload, state.pendingAnswers);
      if (root.BLCpAssistant && typeof root.BLCpAssistant.persistChecklistAnswers === 'function') root.BLCpAssistant.persistChecklistAnswers({ recovered: true });
    } finally {
      state.applyingRemote = false;
    }
    state.observedAnswers = snapshotAnswers();
  }

  function diffAnswers(previous, current) {
    const entries = [], now = isoNow();
    const keys = new Set(Object.keys(previous || {}).concat(Object.keys(current || {})));
    keys.forEach(function (key) {
      const before = previous && previous[key], after = current && current[key];
      if (sameJson(before, after)) return;
      const parts = splitAnswerKey(key);
      if (!parts.orderKey || !parts.itemId) return;
      if (!after) {
        entries.push({
          orderKey: parts.orderKey, itemId: parts.itemId, state: 'open',
          at: now, baseAt: before && before.at || '', loadDate: before && before.loadDate || null,
          source: 'buyer_log', deleted: true,
        });
        return;
      }
      const answerState = normalizeState(after.state);
      if (!answerState) return;
      entries.push({
        orderKey: parts.orderKey, itemId: parts.itemId, state: answerState,
        at: after.at || now, baseAt: before && before.at || '',
        loadDate: after.loadDate || null, source: after.source || 'buyer_log',
        note: after.note || '',
        ...(after.componentCount ? { componentCount: after.componentCount } : {}),
        reportNumber: after.reportNumber || '',
        actualDate: after.actualDate || '',
        attachments: Array.isArray(after.attachments) ? after.attachments : [],
      });
    });
    return entries;
  }

  function syncAnswerChanges() {
    if (state.applyingRemote) return Promise.resolve(false);
    try { captureAnswerChanges(); }
    catch (error) { return Promise.reject(error); }
    if (state.syncPromise) { state.syncQueued = true; return state.syncPromise; }
    state.syncingAnswers = true;
    if (state.syncRetryTimer) { clearTimeout(state.syncRetryTimer); state.syncRetryTimer = null; }
    state.syncPromise = drainAnswerChanges().finally(function () { state.syncPromise = null; });
    return state.syncPromise;
  }
  async function drainAnswerChanges() {
    try {
      // Kullanıcı ilk kayıt devam ederken ikinci/üçüncü kez durum değiştirirse
      // eski kod bu olayları sessizce atlıyordu. Her başarılı POST'tan sonra
      // snapshot yeniden alınır; kuyruk boşalana kadar devam edilir.
      for (;;) {
        state.syncQueued = false;
        captureAnswerChanges();
        const entries = Object.values(state.pendingAnswers).filter(entry => !entry.syncBlocked).slice(0, 200);
        if (!entries.length) {
          if (Object.keys(state.pendingAnswers).length) throw Object.assign(new Error(T('Sunucuda daha yeni bir checklist kaydı var. Bekleyen değişiklik korundu; durumu kontrol edip yeniden seçin.', 'A newer checklist record exists on the server. Your pending edit was preserved; review and select the status again.')), { code: 'CHECKLIST_CONFLICT' });
          if (!state.syncQueued) break;
          continue;
        }
        const result = await post('/answers', { entries: entries, source: 'buyer_log' });
        if (result.ok === false) throw new Error(T('Checklist değişikliği onaylanmadı; bekleyen kayıt korunuyor.', 'Checklist change was not acknowledged; the pending record is preserved.'));
        const accepted = Array.isArray(result.changedKeys) ? new Set(result.changedKeys) : null;
        if (!accepted && (result.skipped || result.conflicts)) throw new Error(T('Checklist değişikliği onaylanmadı; bekleyen kayıt korunuyor.', 'Checklist change was not acknowledged; the pending record is preserved.'));
        entries.forEach(function (entry) {
          const key = answerKey(entry.orderKey, entry.itemId);
          if (accepted && !accepted.has(key)) {
            if (sameJson(state.pendingAnswers[key], entry)) state.pendingAnswers[key] = { ...entry, syncBlocked: true, remoteAt: result.rejectedAt && result.rejectedAt[key] || '' };
            return;
          }
          state.answerBaseline[key] = safeJson(entry);
          if (sameJson(state.pendingAnswers[key], entry)) delete state.pendingAnswers[key];
        });
        persistPendingAnswers();
        captureAnswerChanges();
        if (!state.syncQueued && !Object.keys(state.pendingAnswers).length) break;
      }
      return true;
    } catch (error) {
      // Baseline yalnız başarılı POST'ta ilerlediği için veri yerelde kalır ve
      // tekrar denendiğinde eksik değişiklik yeniden gönderilir.
        if (error.code !== 'CHECKLIST_CONFLICT' && !state.syncRetryTimer) {
        state.syncRetryTimer = setTimeout(function () {
          state.syncRetryTimer = null;
          syncAnswerChanges().catch(function () {});
        }, 1500);
      }
      throw error;
    } finally {
      state.syncingAnswers = false;
      if (state.syncQueued && Object.values(state.pendingAnswers).some(entry => !entry.syncBlocked) && !state.syncRetryTimer) {
        state.syncRetryTimer = setTimeout(function () {
          state.syncRetryTimer = null;
          syncAnswerChanges().catch(function () {});
        }, 0);
      }
    }
  }

  function itemCatalog() {
    const s = assistantState();
    if (!s) return [];
    const list = [];
    (Array.isArray(s.rules) ? s.rules : []).forEach(function (rule) {
      if (!rule || rule.kind !== 'checklist' || rule.enabled === false) return;
      list.push({
        id: rule.id,
        tr: rule.tr || rule.name || rule.id,
        en: rule.en || rule.name || rule.id,
        questionTr: rule.questionTr || rule.name || rule.id,
        questionEn: rule.questionEn || rule.name || rule.id,
        builtIn: rule.builtIn === true,
        approvalScope: rule.approvalScope === 'option' ? 'option' : 'order',
        evidenceFields: {
          reportNumber: Boolean(rule.evidenceFields && rule.evidenceFields.reportNumber),
          actualDate: Boolean(rule.evidenceFields && rule.evidenceFields.actualDate),
          attachments: Boolean(rule.evidenceFields && rule.evidenceFields.attachments),
        },
        raw: rule,
      });
    });
    return list;
  }

  function componentParts(analysis, answers) {
    const s = assistantState();
    return Components.partsFor(analysis, answers || (s && s.answers));
  }
  function scopedItem(item, partId) {
    return { ...item, id: Components.itemId(item.id, partId), baseId: item.id, partId,
      tr: item.tr + ' · ' + partId, en: item.en + ' · ' + partId };
  }
  function catalogItem(id) {
    const part = Components.parseItem(id);
    const item = itemCatalog().find(entry => entry.id === (part ? part.baseId : id));
    return item && part ? scopedItem(item, part.partId) : item;
  }
  function expandedItems(items, analyses, answers) {
    return items.flatMap(item => {
      if (Components.parseItem(item.id)) return [item];
      const parts = [...new Set(analyses.flatMap(analysis => componentParts(analysis, answers).map(part => part.id)))];
      const whole = analyses.some(analysis => !componentParts(analysis, answers).length && !Components.isSet(analysis && (analysis.sourceRow || analysis), 'cp'));
      return [...(whole || !parts.length ? [item] : []), ...parts.map(id => scopedItem(item, id))];
    });
  }
  function componentCellHtml(row, itemId, canEdit) {
    const info = row._checklistParts && row._checklistParts[itemId];
    if (!info) return '';
    const disabled = canEdit ? '' : ' disabled aria-disabled="true"';
    const parts = info.parts.map(part => '<button type="button" class="clStatusTrigger is-' + html(part.state) + '" data-id="' + html(row._id) + '" data-item="' + html(Components.itemId(itemId, part.id)) + '" data-status="' + html(part.state) + '" title="' + html(part.label + ' · ' + statusLabel(part.state)) + '" aria-label="' + html(part.label + ' · ' + statusLabel(part.state)) + '" aria-haspopup="listbox" aria-expanded="false"' + disabled + '><b class="clPartLabel">' + html(part.label) + '</b><span class="clStatusDot" aria-hidden="true"></span><span class="clStatusText">' + html(statusLabel(part.state)) + '</span><span class="delTypeChevron" aria-hidden="true">▾</span></button>').join('');
    const summary = info.parts.length ? info.parts.filter(part => part.state === 'approved').length + '/' + info.parts.length : T('Parça sayısını belirleyin', 'Define the part count');
    const legacyHtml = info.legacy ? '<button type="button" class="clPartsConfigure" data-cl-legacy data-id="' + html(row._id) + '" data-item="' + html(itemId) + '" title="' + T('Eski set kaydı', 'Legacy set record') + '" aria-label="' + T('Eski set kaydı', 'Legacy set record') + '">↶</button>' : '';
    return '<td class="editTd clPartsCell"><div class="clPartsStack">' + parts + '<div class="clPartsFooter"><small>' + html(summary) + '</small>' + (canEdit ? '<button type="button" class="clPartsConfigure" data-cl-config-parts data-id="' + html(row._id) + '" aria-label="' + T('Set parçalarını tanımla', 'Define set parts') + '" title="' + T('Set parçalarını tanımla', 'Define set parts') + '">' + '<span aria-hidden="true">⋯</span></button>' : '') + '</div>' + legacyHtml + '</div></td>';
  }
  function openLegacyRecord(trigger) {
    const row = cpRowById(trigger.dataset.id), legacy = row && row._checklistParts && row._checklistParts[trigger.dataset.item] && row._checklistParts[trigger.dataset.item].legacy;
    if (!legacy) return;
    const modal = root.document.createElement('div'); modal.className = 'cpaModalOverlay';
    modal.innerHTML = '<div class="cpaModal" role="dialog" aria-modal="true"><header><b>' + T('Eski set kaydı', 'Legacy set record') + '</b><button type="button" data-legacy-close aria-label="' + T('Kapat', 'Close') + '">×</button></header><div class="cpaModalBody"><b>' + html(statusLabel(legacy.state)) + '</b><p class="clPartsLegacyNote">' + html(legacy.note || '') + '</p><p>' + html(legacy.reportNumber || '') + '</p><p>' + html(legacy.actualDate || '') + '</p>'
      + (legacy.attachments || []).map(attachment => '<p><a class="cpaBtn" href="' + API + '/attachments/' + encodeURIComponent(attachment.id) + '" download="' + html(attachment.filename || 'attachment') + '">' + html(attachment.filename || attachment.originalName || T('Dosya', 'File')) + '</a></p>').join('')
      + '</div><footer><button type="button" class="cpaBtn" data-legacy-close>' + T('Kapat', 'Close') + '</button></footer></div>';
    root.document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-legacy-close]').forEach(button => {button.onclick = close;});
    modal.onclick = event => {if(event.target === modal)close();};
    modal.addEventListener('keydown', event => {if(event.key === 'Escape')close();});
    modal.querySelector('[data-legacy-close]').focus();
  }
  function openComponentCountDialog(current, minimum, onSave) {
    const modal = root.document.createElement('div'); modal.className = 'cpaModalOverlay';
    modal.innerHTML = '<div class="cpaModal" role="dialog" aria-modal="true" aria-labelledby="clPartsTitle"><header><b id="clPartsTitle">' + T('Set / Takım parçaları', 'Set components') + '</b><button type="button" data-parts-close aria-label="' + T('Kapat', 'Close') + '">×</button></header><div class="cpaModalBody"><label class="cpaSettingRow"><span>' + T('Parça sayısı (2–26)', 'Part count (2–26)') + '</span><input data-parts-count type="number" min="' + minimum + '" max="26" step="1" value="' + (current || 2) + '"></label><p class="cpaNote">' + T('Parçalar A, B, C olarak etiketlenir. Mevcut parçalar ve eski set kaydı korunur; onaylar parçalara otomatik dağıtılmaz.', 'Parts are labelled A, B, C. Existing parts and the legacy set record are preserved; approvals are not automatically copied to parts.') + '</p><p data-parts-error role="alert"></p></div><footer><button type="button" class="cpaBtn" data-parts-close>' + T('Vazgeç', 'Cancel') + '</button><button type="button" class="cpaBtn primary" data-parts-save>' + T('Kaydet', 'Save') + '</button></footer></div>';
    root.document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-parts-close]').forEach(button => {button.onclick = close;});
    modal.onclick = event => {if(event.target === modal) close();};
    modal.addEventListener('keydown', event => {if(event.key === 'Escape') close();});
    const input = modal.querySelector('[data-parts-count]'); input.focus(); input.select();
    modal.querySelector('[data-parts-save]').onclick = async function () {
      if (!input.reportValidity()) return;
      this.disabled = true;
      try {if(await onSave(Number(input.value)) === false) throw new Error(T('Parçalar kaydedilemedi.', 'Parts could not be saved.'));close();}
      catch(error) {modal.querySelector('[data-parts-error]').textContent = error.message;this.disabled = false;}
    };
    return modal;
  }
  async function configureComponents(trigger) {
    const assistant = await ensureAssistant(), row = cpRowById(trigger.dataset.id);
    if (!assistant || !row) return;
    const decision = analysesForRows([row]), analysis = decision.byRow.get(row);
    if (!analysis) return;
    const saved = assistantState().answers[Components.configKey(analysis)];
    openComponentCountDialog(componentParts(analysis).length, saved && saved.componentCount || 2, async count => {
      if (!assistant.setChecklistComponents(analysis, count)) return false;
      refreshColumns({ render: true });
      await syncAnswerChanges(); return true;
    });
  }

  function currentRows() {
    try {
      if (root.BLFormulaRows && typeof root.BLFormulaRows.cp === 'function') {
        const rows = root.BLFormulaRows.cp();
        if (Array.isArray(rows)) return rows;
      }
    } catch (_) {}
    return [];
  }

  function analysesForRows(rows) {
    const assistant = root.BLCpAssistant;
    if (!assistant || typeof assistant.computeDecisionsForRows !== 'function') return { byRow: new WeakMap(), byOrderKey: new Map(), model: null };
    try { return assistant.computeDecisionsForRows(rows); }
    catch (_) { return { byRow: new WeakMap(), byOrderKey: new Map(), model: null }; }
  }

  function itemApplies(item, analysis) {
    if (!analysis) return true;
    const part = Components.parseItem(item.id);
    const parts = componentParts(analysis);
    if (part) {
      if (!parts.some(entry => entry.id === part.partId)) return false;
      item = { ...item, id: part.baseId };
    } else if (parts.length || Components.isSet(analysis.sourceRow || analysis, 'cp')) {
      // Base item is still applicable in the UI, but workbook callers explicitly
      // expand it to part-specific columns below.
    }
    // Karar katmanı her sipariş için geçerli checklist başlıklarını zaten
    // hesapladı; aynı sonucu yeniden değerlendirmeyiz.
    if (Array.isArray(analysis.checklistItemIds)) return analysis.checklistItemIds.indexOf(item.id) >= 0;
    const s = assistantState(), Rules = root.BLCpRulesEngine;
    if (!s || !Rules) return true;
    const evaluated = typeof Rules.evaluateOrder === 'function'
      ? Rules.evaluateOrder(analysis, { rules: s.rules, answers: s.answers, checklistEnabled: !s.checklistSettings || s.checklistSettings.enabled !== false })
      : { customItems: Rules.customChecklistItems(analysis, s.rules, {}) };
    return evaluated.customItems.some(function (candidate) {
      return candidate.id === item.id;
    });
  }

  function answerFor(item, analysis) {
    if (!analysis) return null;
    const s = assistantState(), Checklist = root.BLCpChecklistEngine;
    if (!s || !Checklist) return null;
    if (!Components.parseItem(item.id) && componentParts(analysis).length) return { state: Checklist.statusOf(analysis, item.id, { answers: s.answers, item }) };
    const key = Checklist.answerKey(analysis.orderKey, item.id);
    const answer = s.answers && s.answers[key];
    if (answer) return answer;
    if (item.approvalScope === 'option' && typeof Checklist.optionAnswerKey === 'function') {
      const optionKey = Checklist.optionAnswerKey(analysis, item.id);
      const reusable = optionKey && s.answers && s.answers[optionKey];
      if (reusable && Checklist.normalizeStatus(reusable.state) === 'approved') return reusable;
    }
    if (!Components.parseItem(item.id) && item.builtIn && root.BLPlmSampleRequests && typeof root.BLPlmSampleRequests.evidenceForAnalysis === 'function') {
      try {
        const evidence = root.BLPlmSampleRequests.evidenceForAnalysis(analysis, item.id);
        if (evidence && evidence.state === 'approved') {
          return { state: 'approved', at: evidence.date || '', by: 'PLM', source: 'plm' };
        }
      } catch (_) {}
    }
    return null;
  }

  function refreshColumns(options) {
    const opts = options || {};
    const rows = currentRows(), items = itemCatalog();
    const cols = root.COLS_BY_TABLE && root.COLS_BY_TABLE.cp;
    if (!Array.isArray(cols)) return false;

    const oldKeys = cols.filter(function (col) { return col && col.checklistSupplierColumn; }).map(function (col) { return col.k; });
    const kept = cols.filter(function (col) { return !(col && col.checklistSupplierColumn); });
    const dynamic = items.map(function (item) {
      return {
        k: columnKey(item.id),
        label: isEn() ? item.en : item.tr,
        group: 'Checklist',
        // Serbest metin DEĞİL: hücre yalnız dört durumdan birini seçtirir.
        type: 'checklistStatus',
        weight: 12,
        checklistSupplierColumn: true,
        checklistItemId: item.id,
      };
    });
    cols.splice.apply(cols, [0, cols.length].concat(kept, dynamic));

    const manager = root.colmgr && root.colmgr.cp;
    if (manager && Array.isArray(manager.order)) {
      manager.order = manager.order.filter(function (key) { return !oldKeys.includes(key) && !String(key).startsWith(COLUMN_PREFIX); });
      dynamic.forEach(function (col) { if (!manager.order.includes(col.k)) manager.order.push(col.k); });
    }
    if (typeof root.invalidateColumnIndex === 'function') root.invalidateColumnIndex('cp');

    /* Her CP çiziminde (sekme dönüşü, filtre) bütün satırların checklist
       hücreleri baştan yazılıyordu (5 bin satırda ~0,7 sn). Aynı satır dizisi,
       aynı karar sonucu, aynı başlıklar/dil ve aynı test görevleri için iş
       zaten yapılmıştır; yalnız çizim yolu (reuse) bunu atlar. Olay/senkron
       yolları her zaman yeniden uygular. */
    const itemsSignature = items.map(function (item) { return item.id + '\u0001' + item.tr + '\u0001' + item.en; }).join('\u0002') + '|' + (isEn() ? 'en' : 'tr');
    const applied = state.appliedColumns;
    if (opts.reuse && opts.decision && applied && applied.rows === rows && applied.decision === opts.decision
      && applied.items === itemsSignature && applied.tasks === state.testTasks) {
      if (opts.render && typeof root.renderCP === 'function') root.renderCP();
      return true;
    }
    state.appliedColumns = null;

    if (rows.length && items.length) {
      const decision = opts.decision || analysesForRows(rows);
      rows.forEach(function (row) {
        const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
        const statuses = {}, partCells = {};
        items.forEach(function (item) {
          const key = columnKey(item.id);
          // Soru henüz sorulmuyorsa hücre boştur; ancak test raporundan
          // kullanıcıya düşen bekleyen bir iş varsa hücre görünür kalır.
          const pendingTasks = analysis && state.testTasks.get(answerKey(analysis.orderKey, item.id));
          if (!itemApplies(item, analysis) && !(pendingTasks && pendingTasks.length)) { row[key] = ''; return; }
          // Tek doğruluk kaynağı: karar katmanının hesapladığı durum.
          const computed = analysis && analysis.checklistState && analysis.checklistState[item.id];
          const answer = computed ? null : answerFor(item, analysis);
          const status = (computed && computed !== 'notApplicable' ? computed : '') || normalizeState(answer && answer.state) || 'open';
          const parts = componentParts(analysis);
          if (parts.length || Components.isSet(analysis && (analysis.sourceRow || analysis), 'cp')) {
            const Checklist = root.BLCpChecklistEngine, s = assistantState();
            const states = parts.map(part => ({ ...part, state: Checklist.statusOf(analysis, Components.itemId(item.id, part.id), { answers: s.answers, item }) }));
            partCells[item.id] = { parts: states, legacy: s.answers[Checklist.answerKey(analysis.orderKey, item.id)] || null };
            statuses[item.id] = Components.aggregate(states.map(part => part.state), Checklist.isResolved);
            row[key] = states.length ? states.map(part => part.label + ': ' + statusLabel(part.state)).join(' / ') : T('Parça sayısını belirleyin', 'Define the part count');
          } else {
            statuses[item.id] = status;
            row[key] = statusLabel(status);
          }
        });
        // Hücre çizimi ve durum menüsü için kanonik durum; görünür değer etiket.
        Object.defineProperty(row, '_checklistParts', { value: partCells, enumerable: false, configurable: true, writable: true });
        Object.defineProperty(row, '_checklistStatus', { value: statuses, enumerable: false, configurable: true, writable: true });
        const tasks = {};
        if (analysis && state.testTasks.size) items.forEach(function (item) {
          const list = state.testTasks.get(answerKey(analysis.orderKey, item.id));
          if (list && list.length) tasks[item.id] = list;
        });
        Object.defineProperty(row, '_checklistTasks', { value: tasks, enumerable: false, configurable: true, writable: true });
      });
      state.appliedColumns = { rows: rows, decision: decision, items: itemsSignature, tasks: state.testTasks };
    }
    if (opts.render && typeof root.renderCP === 'function') root.renderCP();
    return true;
  }

  let assistantRefreshGeneration = 0;
  function refreshAssistantView() {
    const assistant = root.BLCpAssistant, s = assistantState();
    if (!assistant || !s) return;
    try {
      const rows = currentRows();
      if (rows.length && typeof assistant.onOverviewRendered === 'function') {
        // Sabit veri revizyonu: Date.now() her çağrıda Üretim Önceliklerini
        // baştan hesaplatıyordu; checklist değişimi filtre revizyonundadır.
        assistant.onOverviewRendered(rows, {
          dataRevision: typeof root.BL_CP_DECISION_DATA_REVISION === 'function' ? root.BL_CP_DECISION_DATA_REVISION() : 0,
          filterRevision: 'checklist-supplier:' + String(state.shared.revision || 0),
        });
      } else if (typeof assistant.render === 'function') assistant.render();
    } catch (_) {}
    const rows = currentRows(), generation = ++assistantRefreshGeneration;
    if (typeof assistant.computeDecisionsForRowsAsync === 'function') {
      void assistant.computeDecisionsForRowsAsync(rows).then(decision=>{
        if(!decision || generation!==assistantRefreshGeneration || currentRows()!==rows)return;
        // Aynı karar zaten hücrelere işlendiyse CP'yi ikinci kez çizmeye gerek yok.
        const already=state.appliedColumns&&state.appliedColumns.rows===rows&&state.appliedColumns.decision===decision&&state.appliedColumns.tasks===state.testTasks;
        refreshColumns({render:false,decision});
        if(!already&&root.document?.body?.dataset.activeTab==='cp'&&typeof root.renderCP==='function')root.renderCP();
      }).catch(error=>toast(error.message));
    } else refreshColumns({render:false});
  }

  async function loadShared(force) {
    if (state.loading) return state.loading;
    state.loading = (async function () {
      const assistant = await ensureAssistant();
      if (!assistant) return null;
      readPendingAnswers();
      if (state.observedAnswers == null) state.observedAnswers = snapshotAnswers();
      captureAnswerChanges();
      const payload = await jsonFetch(API, { cache: 'no-store' });
      if (!payload.answers || typeof payload.answers !== 'object' || Array.isArray(payload.answers)
        || !payload.tombstones || typeof payload.tombstones !== 'object' || Array.isArray(payload.tombstones)) {
        throw new Error(T('Checklist yanıtı geçersiz; mevcut kayıtlar korundu.', 'Invalid checklist response; existing records were preserved.'));
      }
      state.shared = {
        definitions: safeJson(payload.definitions || []),
        answers: safeJson(payload.answers || {}),
        tombstones: safeJson(payload.tombstones || {}),
        revision: Number(payload.revision) || 0,
        updatedAt: payload.updatedAt || '',
      };

      // A settings-store failure must never block independent answer/evidence recovery.
      try { adoptRemoteDefinitions(state.shared.definitions); }
      catch (error) { toast(T('Checklist tanımları kaydedilemedi: ', 'Checklist definitions could not be saved: ') + error.message); }
      state.answerBaseline = safeJson({ ...state.shared.tombstones, ...state.shared.answers });
      mergeRemoteAnswers(state.shared);
      // First rollout / another device: preserve a newer local checklist answer
      // by promoting it into the shared store instead of silently leaving it local.
      const mergedLocal = snapshotAnswers();
      const promote = [];
      Object.keys(mergedLocal).forEach(function (key) {
        const localAnswer = mergedLocal[key];
        const remoteAnswer = state.shared.answers[key];
        const tomb = state.shared.tombstones[key];
        const remoteAt = remoteAnswer ? String(remoteAnswer.at || '') : tomb ? String(tomb.at || '') : '';
        const localAt = String(localAnswer && localAnswer.at || '');
        if (remoteAt && (!localAt || localAt <= remoteAt)) return;
        const parts = splitAnswerKey(key);
        const normalized = normalizeState(localAnswer && localAnswer.state);
        if (!parts.orderKey || !parts.itemId || !normalized) return;
        promote.push({
          orderKey: parts.orderKey, itemId: parts.itemId, state: normalized,
          at: localAt || isoNow(), baseAt: remoteAt,
          loadDate: localAnswer.loadDate || null, note: localAnswer.note || '',
          ...(localAnswer.componentCount ? { componentCount: localAnswer.componentCount } : {}),
          reportNumber: localAnswer.reportNumber || '',
          actualDate: localAnswer.actualDate || '',
          attachments: Array.isArray(localAnswer.attachments) ? localAnswer.attachments : [],
          source: localAnswer.source || 'buyer_log',
        });
      });
      if (promote.length) {
        promote.forEach(function (entry) { state.pendingAnswers[answerKey(entry.orderKey, entry.itemId)] = entry; });
        persistPendingAnswers();
      }
      if (Object.keys(state.pendingAnswers).length) {
        try { await syncAnswerChanges(); }
        catch (error) { toast(T('Checklist kaydı bekliyor: ', 'Checklist save is pending: ') + error.message); }
      }
      const sharedSignature = runtimeSignature();
      if (sharedSignature !== state.sharedViewSignature) {
        state.sharedViewSignature = sharedSignature;
        refreshAssistantView();
      }
      return state.shared;
    }()).catch(function (error) {
      toast(T('Checklist senkronu okunamadı: ', 'Checklist sync could not be loaded: ') + (error.message || error));
      return null;
    }).finally(function () { state.loading = null; });
    return state.loading;
  }

  function visibleValue(row, candidates) {
    for (const key of candidates) {
      const value = row && row[key];
      if (value != null && text(value)) return text(value);
    }
    return '';
  }

  function selectedRows() {
    try {
      if (typeof root.selectedCpRowsForAction === 'function') {
        const rows = root.selectedCpRowsForAction();
        return Array.isArray(rows) ? rows : [];
      }
    } catch (_) {}
    return [];
  }

  function supplierNameFor(rows) {
    const names = new Set();
    rows.forEach(function (row) {
      const value = visibleValue(row, ['Sub-Manufacturer', 'Manufacturer', 'Üretici', 'Supplier']);
      if (value) names.add(value);
    });
    return names.size === 1 ? Array.from(names)[0] : T('Karma', 'Mixed');
  }
  function safeFilePart(value) {
    return text(value).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Checklist';
  }
  function downloadBuffer(buffer, name) {
    if (typeof root.kolDownloadBuffer === 'function') {
      try { root.kolDownloadBuffer(buffer, name); return; } catch (_) {}
    }
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob), a = root.document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    root.document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function storageGet(key) {
    try {
      if (root.BLStorage && typeof root.BLStorage.getItem === 'function') return root.BLStorage.getItem(key);
      return root.localStorage ? root.localStorage.getItem(key) : null;
    } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (root.BLStorage && typeof root.BLStorage.setItem === 'function') root.BLStorage.setItem(key, value);
      else if (root.localStorage) root.localStorage.setItem(key, value);
    } catch (_) {}
  }
  function excelColumnDefinitions() {
    return [
      { id: 'image', tr: 'Model Görseli', en: 'Model Image', width: 10, defaultOn: true },
      { id: 'order', tr: 'Order Code', en: 'Order Code', width: 12, required: true, defaultOn: true, candidates: ['Order Code', 'ORDER CODE', 'OrderCode'] },
      { id: 'plm', tr: 'PLM ID', en: 'PLM ID', width: 10, defaultOn: true, candidates: ['PLM ID', 'PLM', 'PLM Id'] },
      { id: 'model', tr: 'Model Adı', en: 'Model Name', width: 18, defaultOn: true, candidates: ['Model Name', 'MODEL NAME', 'Model', 'Model Adı'] },
      { id: 'colour', tr: 'Renk Kodu', en: 'Colour Code', width: 10, defaultOn: true, candidates: ['C.Code', 'Colour Code', 'Color Code', 'Renk Kodu'] },
      { id: 'supplier', tr: 'Üretici', en: 'Supplier', width: 18, defaultOn: true, candidates: ['Sub-Manufacturer', 'Manufacturer', 'Üretici', 'Supplier'] },
      { id: 'exfactory', tr: 'Ex-Factory', en: 'Ex-Factory', width: 12, defaultOn: true, type: 'date', candidates: ['Ex-factory', 'Ex-Factory', 'EX FACTORY', 'EX-FACTORY'] },
      { id: 'season', tr: 'Sezon', en: 'Season', width: 10, candidates: ['Season', 'Sezon'] },
      { id: 'buyer', tr: 'Buyer', en: 'Buyer', width: 14, candidates: ['Buyer'] },
      { id: 'buyerGroup', tr: 'Buyer Grup', en: 'Buyer Group', width: 14, candidates: ['Buyer Grup (TR)', 'Buyer Grup', 'Buying Group', 'Buyer Group'] },
      { id: 'category', tr: 'Kategori', en: 'Category', width: 14, candidates: ['Category', 'Kategori'] },
      { id: 'license', tr: 'Lisans', en: 'License', width: 14, candidates: ['License', 'Lisans'] },
    ];
  }
  function excelColumnIds() {
    const definitions = excelColumnDefinitions(), known = new Set(definitions.map(function (item) { return item.id; }));
    let saved = null;
    try { saved = JSON.parse(storageGet(EXCEL_COLUMNS_KEY) || 'null'); } catch (_) {}
    const source = Array.isArray(saved) ? saved : DEFAULT_EXCEL_COLUMNS;
    const clean = [];
    source.forEach(function (id) {
      id = String(id || '');
      if (known.has(id) && !clean.includes(id)) clean.push(id);
    });
    definitions.filter(function (item) { return item.required; }).forEach(function (item) {
      if (!clean.includes(item.id)) clean.unshift(item.id);
    });
    return clean.length ? clean : DEFAULT_EXCEL_COLUMNS.slice();
  }
  function saveExcelColumnIds(ids) {
    const known = new Set(excelColumnDefinitions().map(function (item) { return item.id; }));
    const clean = (Array.isArray(ids) ? ids : []).map(String).filter(function (id, index, list) {
      return known.has(id) && list.indexOf(id) === index;
    });
    if (!clean.includes('order')) clean.unshift('order');
    storageSet(EXCEL_COLUMNS_KEY, JSON.stringify(clean));
    return clean;
  }
  function rawValue(row, candidates) {
    for (const key of (candidates || [])) {
      const value = row && row[key];
      if (value != null && value !== '') return value;
    }
    return null;
  }
  function excelDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 10000 && value < 30000) {
        const d = new Date(value * 86400000);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
      }
      if (value >= 30000 && value < 80000) {
        const epoch = Date.UTC(1899, 11, 30);
        const d = new Date(epoch + Math.round(value) * 86400000);
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
      }
    }
    const raw = text(value);
    if (!raw) return null;
    /* Saat dilimli zaman damgası önce Date'e çevrilir. İlk 10 karakteri almak
       UTC gününü kullanıp Türkiye'de bir gün geriye düşürebiliyordu. */
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
      const timestamp = new Date(raw);
      if (!Number.isNaN(timestamp.getTime())) {
        return new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate(), 12, 0, 0);
      }
    }
    let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!match) {
      const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (compact) match = compact;
    }
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    const local = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (local) return new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]), 12, 0, 0);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
  }

  function valueForExcelColumn(definition, row) {
    if (!definition || definition.id === 'image') return '';
    const value = rawValue(row, definition.candidates);
    return definition.type === 'date' ? excelDate(value) : text(value);
  }
  function dateValidation() {
    return {
      type: 'date', operator: 'between', allowBlank: true,
      formulae: [new Date(2000, 0, 1), new Date(2100, 11, 31)],
      showErrorMessage: true,
      errorTitle: T('Geçersiz tarih', 'Invalid date'),
      error: T('Tarihi Excel tarih seçicisiyle girin. Format: GG.AA.YYYY', 'Use the Excel date picker. Format: DD.MM.YYYY'),
    };
  }
  function preparedImageExtension(dataUrl) {
    const raw = String(dataUrl || '').toLowerCase();
    if (raw.startsWith('data:image/jpeg') || raw.startsWith('data:image/jpg')) return 'jpeg';
    if (raw.startsWith('data:image/png')) return 'png';
    return '';
  }
  async function dataUrlPreparedImage(source) {
    if (!source || typeof root.fetch !== 'function' || !root.FileReader) return null;
    try {
      const response = await root.fetch(source, { credentials: 'same-origin', cache: 'force-cache' });
      if (!response.ok) return null;
      const blob = await response.blob();
      const dataUrl = await new Promise(function (resolve, reject) {
        const reader = new root.FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (!dataUrl) return null;
      let width = 1, height = 1;
      if (root.Image) {
        try {
          const size = await new Promise(function (resolve) {
            const image = new root.Image();
            image.onload = function () { resolve({ width: image.naturalWidth || image.width || 1, height: image.naturalHeight || image.height || 1 }); };
            image.onerror = function () { resolve({ width: 1, height: 1 }); };
            image.src = dataUrl;
          });
          width = size.width; height = size.height;
        } catch (_) {}
      }
      return { dataUrl: dataUrl, width: width, height: height };
    } catch (_) { return null; }
  }
  async function prepareRowModelImage(row) {
    // CP/Orders dışa aktarımında kullanılan kanonik çözücü, viewport/lazy-load
    // durumundan bağımsız gerçek görseli data URL olarak üretir. Checklist
    // Excel'i de aynı yolu kullanır; böylece ekranda görünen model Excel'de
    // "boş" kalmaz.
    if (typeof root.cpOrdersRowImageDataUrl === 'function') {
      try {
        const dataUrl = await root.cpOrdersRowImageDataUrl(row);
        if (dataUrl) {
          if (typeof root.kolPrepareExcelImage === 'function') {
            const prepared = await root.kolPrepareExcelImage(dataUrl);
            if (prepared && prepared.dataUrl) return prepared;
          }
          const prepared = await dataUrlPreparedImage(dataUrl);
          if (prepared && prepared.dataUrl) return prepared;
        }
      } catch (_) {}
    }
    const plm = visibleValue(row, ['PLM ID', 'PLM', 'PLM Id']);
    const colourCode = visibleValue(row, ['C.Code', 'Colour Code', 'Color Code', 'Renk Kodu']);
    const colour = visibleValue(row, ['Colour', 'Color', 'Renk']);
    let source = '';
    if (typeof root.canonicalModelImageSource === 'function' && plm) {
      try { source = root.canonicalModelImageSource(plm, colourCode, colour) || ''; } catch (_) {}
    }
    if (!source) source = visibleValue(row, ['Model Image', 'Image URL', 'Image Url', 'imageUrl', 'img', 'Image']);
    if (!source) return null;
    if (typeof root.kolPrepareExcelImage === 'function') {
      try {
        const prepared = await root.kolPrepareExcelImage(source);
        if (prepared && prepared.dataUrl) return prepared;
      } catch (_) {}
    }
    return dataUrlPreparedImage(source);
  }

  function imagePlacement(prepared, rowNo, columnNo) {
    // Buyer Log'un kanonik "Hücrelerle taşı ve boyutlandır" yardımcısını kullan:
    // aynı OOXML twoCell anchor hem Koleksiyon exportunda hem Checklist Excel'de
    // aynı davranışı verir.
    if (typeof root.kolExcelImageMoveAndSizePlacement === 'function') {
      try { return root.kolExcelImageMoveAndSizePlacement(prepared, rowNo, 72, 50, columnNo, 3); } catch (_) {}
    }
    const naturalW = Math.max(1, Number(prepared && prepared.width) || 1);
    const naturalH = Math.max(1, Number(prepared && prepared.height) || 1);
    const maxW = 66, maxH = 44;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
    const width = Math.max(1, naturalW * scale), height = Math.max(1, naturalH * scale);
    const cellW = 72, cellH = 50;
    const left = columnNo - 1 + 0.05, top = rowNo - 1 + 0.06;
    return {
      tl: { col: left, row: top },
      br: {
        col: Math.min(columnNo - 0.03, left + Math.min(0.90, width / cellW)),
        row: Math.min(rowNo - 0.03, top + Math.min(0.88, height / cellH)),
      },
      editAs: 'twoCell',
    };
  }
  const CHECKLIST_EXCEL_COLORS = Object.freeze({
    navy: 'FF2A3E52', ink: 'FF101828', ink2: 'FF475467', muted: 'FF98A2B3',
    line: 'FFE4E7EC', paper: 'FFF6F7F9', band: 'FFFAFBFC', white: 'FFFFFFFF',
    acc: 'FF5980A6', accBg: 'FFE9EFF5', red: 'FFA8453A', redBg: 'FFF4E7E4',
    gold: 'FF8C6A1F', goldBg: 'FFF2EAD6', green: 'FF3F7757', greenBg: 'FFE3EDE6',
    grayBg: 'FFEDEFF1',
  });
  function excelColumnName(index) {
    let n = Number(index) || 0, out = '';
    while (n > 0) {
      const remainder = (n - 1) % 26;
      out = String.fromCharCode(65 + remainder) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }
  function excelFormulaString(value) { return String(value == null ? '' : value).replace(/"/g, '""'); }
  function checklistStatusTone(value) {
    const stateValue = normalizeState(value);
    if (stateValue === 'approved') return { fg: CHECKLIST_EXCEL_COLORS.green, bg: CHECKLIST_EXCEL_COLORS.greenBg };
    if (stateValue === 'rejected') return { fg: CHECKLIST_EXCEL_COLORS.red, bg: CHECKLIST_EXCEL_COLORS.redBg };
    if (stateValue === 'notRequired') return { fg: CHECKLIST_EXCEL_COLORS.gold, bg: CHECKLIST_EXCEL_COLORS.goldBg };
    return { fg: CHECKLIST_EXCEL_COLORS.acc, bg: CHECKLIST_EXCEL_COLORS.accBg };
  }
  function statusCountFormula(statusColumns, lastRow, label) {
    const escaped = excelFormulaString(label);
    const parts = (statusColumns || []).map(function (column) {
      const letter = excelColumnName(column);
      return 'COUNTIF(' + "'" + DATA_SHEET.replace(/'/g, "''") + "'!" + '$' + letter + '$2:$' + letter + '$' + lastRow + ',"' + escaped + '")';
    });
    return parts.length ? parts.join('+') : '0';
  }
  function identityStats(rows) {
    const orders = new Set(), models = new Set(), options = new Set();
    (rows || []).forEach(function (row) {
      const order = visibleValue(row, ['Order Code', 'ORDER CODE', 'OrderCode']);
      const plm = visibleValue(row, ['PLM ID', 'PLM', 'PLM Id']);
      const model = visibleValue(row, ['Model Name', 'MODEL NAME', 'Model', 'Model Adı']);
      const colour = visibleValue(row, ['C.Code', 'Colour Code', 'Color Code', 'Renk Kodu']);
      if (order) orders.add(order);
      if (plm || model) models.add([plm, model].join('\u001f'));
      if (plm || model || colour) options.add([plm, model, colour].join('\u001f'));
    });
    return { orders: orders.size, models: models.size, options: options.size, rows: (rows || []).length };
  }
  function styleSummaryTile(ws, c0, rowStart, label, value, accent, foot, numFmt) {
    const C = CHECKLIST_EXCEL_COLORS, c1 = c0 + 1;
    [rowStart, rowStart + 1, rowStart + 2].forEach(function (rowNo) { ws.mergeCells(rowNo, c0, rowNo, c1); });
    const labelCell = ws.getCell(rowStart, c0), valueCell = ws.getCell(rowStart + 1, c0), footCell = ws.getCell(rowStart + 2, c0);
    labelCell.value = label;
    labelCell.font = { name: 'Segoe UI', size: 8.5, bold: true, color: { argb: C.ink2 } };
    valueCell.value = value;
    if (numFmt) valueCell.numFmt = numFmt;
    valueCell.font = { name: 'Segoe UI', size: 19, bold: true, color: { argb: accent } };
    footCell.value = foot || '';
    footCell.font = { name: 'Segoe UI', size: 8, color: { argb: C.muted } };
    [labelCell, valueCell, footCell].forEach(function (cell) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.paper } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    });
    for (let c = c0; c <= c1; c += 1) {
      ws.getCell(rowStart, c).border = { top: { style: 'thick', color: { argb: accent } } };
    }
  }
  function renderChecklistInstructions(ws, rows, items, exportedAt) {
    const C = CHECKLIST_EXCEL_COLORS, stats = identityStats(rows);
    ws.views = [{ showGridLines: false, zoomScale: 100 }];
    ws.properties.tabColor = { argb: C.green };
    ws.getColumn(1).width = 2;
    for (let col = 2; col <= 9; col += 1) ws.getColumn(col).width = 13;

    ws.mergeCells(1, 2, 2, 9);
    const title = ws.getCell(1, 2);
    title.value = 'READ ME / NASIL DOLDURULUR';
    title.font = { name: 'Segoe UI', size: 20, bold: true, color: { argb: C.white } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells(3, 2, 3, 9);
    const meta = ws.getCell(3, 2);
    meta.value = T('Üretici', 'Supplier') + ': ' + supplierNameFor(rows) + '   ·   '
      + T('Sipariş', 'Orders') + ': ' + stats.orders + '   ·   '
      + T('Oluşturma', 'Created') + ': ' + new Date(exportedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR');
    meta.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink2 } };
    meta.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    ws.mergeCells(5, 2, 5, 9);
    const intro = ws.getCell(5, 2);
    intro.value = 'Bu dosyada yalnızca renkli ve kilidi açık checklist alanlarını doldurun. / Fill only the coloured, unlocked checklist fields in this workbook.';
    intro.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: C.ink } };
    intro.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.accBg } };
    intro.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    ws.getRow(5).height = 32;

    const steps = [
      ['1', 'Checklist sekmesine geçin. Her sipariş satırında ilgili kontrol alanlarını doldurun.', 'Open the Checklist sheet. Complete the relevant control fields for each order row.'],
      ['2', 'Durum hücresinde açılır listeden seçim yapın: Bekliyor / Onaylandı / Reddedildi / Gerekmiyor.', 'In each Status cell, choose from the dropdown: Pending / Approved / Rejected / Not Required.'],
      ['3', 'Reddedildi seçerseniz Not alanına sebebi ve beklenen aksiyonu yazın.', 'If you choose Rejected, explain the reason and required action in the Note field.'],
      ['4', 'Rapor No ve Gerçekleşme Tarihi alanları renkliyse ilgili bilgiyi girin. Tarihi GG.AA.YYYY biçiminde kullanın.', 'If Report No and Actual Date cells are coloured, enter the requested information. Use DD.MM.YYYY for dates.'],
      ['5', 'Gri/beyaz kilitli alanları, satırları, sütunları ve gizli teknik alanları değiştirmeyin. Ek dosya adları bilgi amaçlıdır.', 'Do not change grey/white locked cells, rows, columns or hidden technical fields. Attachment names are for reference only.'],
      ['6', 'İşiniz bittiğinde dosyayı .xlsx olarak kaydedin ve aynı Excel dosyasını e-postaya ekleyerek geri gönderin.', 'When finished, save the workbook as .xlsx and return this same Excel file as an e-mail attachment.'],
    ];
    let rowNo = 7;
    steps.forEach(function (step) {
      ws.mergeCells(rowNo, 2, rowNo + 1, 2);
      ws.mergeCells(rowNo, 3, rowNo + 1, 9);
      const number = ws.getCell(rowNo, 2), copy = ws.getCell(rowNo, 3);
      number.value = step[0];
      number.font = { name: 'Segoe UI', size: 15, bold: true, color: { argb: C.white } };
      number.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.acc } };
      number.alignment = { vertical: 'middle', horizontal: 'center' };
      copy.value = step[1] + '\n' + step[2];
      copy.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink } };
      copy.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNo % 4 === 3 ? C.white : C.band } };
      copy.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
      ws.getRow(rowNo).height = 22;
      ws.getRow(rowNo + 1).height = 22;
      rowNo += 2;
    });

    rowNo += 1;
    ws.mergeCells(rowNo, 2, rowNo, 9);
    const legendTitle = ws.getCell(rowNo, 2);
    legendTitle.value = 'STATUS / DURUM';
    legendTitle.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: C.white } };
    legendTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    legendTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    rowNo += 1;
    const legend = [
      [statusLabel('open'), C.acc, C.accBg, 'Henüz tamamlanmadı / Not completed yet'],
      [statusLabel('approved'), C.green, C.greenBg, 'Kontrol tamam ve uygun / Check completed and accepted'],
      [statusLabel('rejected'), C.red, C.redBg, 'Sorun var, aksiyon gerekli / Issue found, action required'],
      [statusLabel('notRequired'), C.gold, C.goldBg, 'Bu sipariş için uygulanmıyor / Not applicable to this order'],
    ];
    legend.forEach(function (entry) {
      ws.mergeCells(rowNo, 2, rowNo, 4);
      ws.mergeCells(rowNo, 5, rowNo, 9);
      const label = ws.getCell(rowNo, 2), detail = ws.getCell(rowNo, 5);
      label.value = entry[0];
      label.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: entry[1] } };
      label.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: entry[2] } };
      label.alignment = { vertical: 'middle', horizontal: 'center' };
      detail.value = entry[3];
      detail.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink2 } };
      detail.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      rowNo += 1;
    });

    rowNo += 1;
    ws.mergeCells(rowNo, 2, rowNo + 1, 9);
    const footer = ws.getCell(rowNo, 2);
    footer.value = items.length + ' ' + T('checklist başlığı', 'checklist item(s)')
      + ' · ' + T('Doldurma alanları Checklist sekmesinde renkli gösterilir.', 'Editable fields are highlighted on the Checklist sheet.');
    footer.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: C.ink2 } };
    footer.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.greenBg } };
    footer.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
    return ws;
  }

  function renderChecklistSummary(ws, rows, items, statusColumns, lastRow, exportedAt) {
    const C = CHECKLIST_EXCEL_COLORS, stats = identityStats(rows);
    ws.views = [{ showGridLines: false, zoomScale: 90 }];
    ws.properties.tabColor = { argb: C.navy };
    ws.getColumn(1).width = 2;
    for (let col = 2; col <= 9; col += 1) ws.getColumn(col).width = 12;
    ws.mergeCells(1, 2, 2, 9);
    const title = ws.getCell(1, 2);
    title.value = T('Buyer Log · Supplier Checklist', 'Buyer Log · Supplier Checklist');
    title.font = { name: 'Segoe UI', size: 20, bold: true, color: { argb: C.white } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.mergeCells(3, 2, 3, 9);
    const subtitle = ws.getCell(3, 2);
    subtitle.value = T('Üretici', 'Supplier') + ': ' + supplierNameFor(rows) + '   ·   '
      + T('Oluşturma', 'Created') + ': ' + new Date(exportedAt).toLocaleString(isEn() ? 'en-GB' : 'tr-TR');
    subtitle.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink2 } };
    subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    styleSummaryTile(ws, 2, 5, T('Sipariş', 'Orders'), stats.orders, C.navy, T('Tekil Order Code', 'Unique Order Code'), '#,##0');
    styleSummaryTile(ws, 4, 5, T('Model', 'Models'), stats.models, C.acc, 'PLM ID + ' + T('Model', 'Model'), '#,##0');
    styleSummaryTile(ws, 6, 5, T('Option', 'Options'), stats.options, C.gold, 'PLM ID + ' + T('Model + Renk', 'Model + Colour'), '#,##0');
    styleSummaryTile(ws, 8, 5, T('Satır', 'Rows'), stats.rows, C.green, T('Excel veri satırı', 'Workbook data rows'), '#,##0');

    const pendingFormula = statusCountFormula(statusColumns, lastRow, statusLabel('open'));
    const approvedFormula = statusCountFormula(statusColumns, lastRow, statusLabel('approved'));
    const rejectedFormula = statusCountFormula(statusColumns, lastRow, statusLabel('rejected'));
    const naFormula = statusCountFormula(statusColumns, lastRow, statusLabel('notRequired'));
    styleSummaryTile(ws, 2, 9, T('Bekliyor', 'Pending'), { formula: pendingFormula }, C.acc, T('Cevap bekleyen', 'Awaiting an answer'), '#,##0');
    styleSummaryTile(ws, 4, 9, T('Onaylandı', 'Approved'), { formula: approvedFormula }, C.green, T('Onaylanan kontroller', 'Approved checks'), '#,##0');
    styleSummaryTile(ws, 6, 9, T('Reddedildi', 'Rejected'), { formula: rejectedFormula }, C.red, T('Aksiyon isteyen kontroller', 'Checks that need action'), '#,##0');
    styleSummaryTile(ws, 8, 9, T('Gerekmiyor', 'Not Required'), { formula: naFormula }, C.gold, T('Uygulanmayan kontroller', 'Not applicable checks'), '#,##0');
    // Tamamlanma = (Onaylandı + Gerekmiyor) / tüm uygulanabilir kontroller.
    styleSummaryTile(ws, 2, 13, T('Tamamlanma', 'Completion'),
      { formula: 'IF((B10+D10+F10+H10)=0,0,(D10+H10)/(B10+D10+F10+H10))' }, C.green,
      T('Dosya düzenlendikçe yenilenir', 'Recalculates as the file is edited'), '0.0%');

    ws.mergeCells(17, 2, 17, 9);
    const section = ws.getCell(17, 2);
    section.value = T('Checklist Durum Dağılımı', 'Checklist Status Distribution');
    section.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: C.white } };
    section.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
    section.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    const header = ws.getRow(18);
    [T('Kontrol', 'Check'), T('Bekliyor', 'Pending'), T('Onaylandı', 'Approved'), T('Reddedildi', 'Rejected'), T('Gerekmiyor', 'Not Required'), T('Tamamlanma', 'Completion')].forEach(function (label, index) {
      const cell = header.getCell(2 + index);
      cell.value = label;
      cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: C.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 0 ? C.navy : C.acc } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    header.height = 28;
    items.forEach(function (item, index) {
      const rowNo = 19 + index, row = ws.getRow(rowNo), colLetter = excelColumnName(statusColumns[index]);
      const range = "'" + DATA_SHEET.replace(/'/g, "''") + "'!" + '$' + colLetter + '$2:$' + colLetter + '$' + lastRow;
      const count = function (status) { return { formula: 'COUNTIF(' + range + ',"' + excelFormulaString(statusLabel(status)) + '")' }; };
      row.height = 20;
      row.getCell(2).value = isEn() ? item.en : item.tr;
      row.getCell(3).value = count('open');
      row.getCell(4).value = count('approved');
      row.getCell(5).value = count('rejected');
      row.getCell(6).value = count('notRequired');
      row.getCell(7).value = { formula: 'IF((C' + rowNo + '+D' + rowNo + '+E' + rowNo + '+F' + rowNo + ')=0,0,(D' + rowNo + '+F' + rowNo + ')/(C' + rowNo + '+D' + rowNo + '+E' + rowNo + '+F' + rowNo + '))' };
      row.getCell(7).numFmt = '0.0%';
      for (let col = 2; col <= 7; col += 1) {
        const cell = row.getCell(col);
        cell.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink }, bold: col === 2 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? C.band : C.white } };
        cell.border = { bottom: { style: 'thin', color: { argb: C.line } } };
        cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'right' };
      }
    });
    const instructionRow = 20 + items.length;
    ws.mergeCells(instructionRow, 2, instructionRow + 1, 9);
    const instruction = ws.getCell(instructionRow, 2);
    instruction.value = T(
      'Nasıl kullanılır: Checklist sekmesinde renkli Durum, Not ve checklist için etkinleştirilmiş Rapor No / Gerçekleşme Tarihi hücreleri düzenlenebilir. Durumu açılır listeden seçin: Bekliyor, Onaylandı, Reddedildi, Gerekmiyor. Ek dosya adları ve kimlik alanları Buyer Log bütünlüğünü korumak için kilitlidir.',
      'How to use: Coloured Status, Note and enabled Report No / Actual Date cells are editable on the Checklist sheet. Choose the status from the dropdown: Pending, Approved, Rejected, Not Required. Attachment names and identity fields are locked to preserve Buyer Log integrity.'
    );
    instruction.font = { name: 'Segoe UI', size: 9, color: { argb: C.ink2 } };
    instruction.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.accBg } };
    instruction.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return ws;
  }
  function applyChecklistConditionalFormatting(sheet, statusColumns, lastRow) {
    if (!sheet || typeof sheet.addConditionalFormatting !== 'function' || lastRow < 2) return;
    const C = CHECKLIST_EXCEL_COLORS;
    const specs = [
      [statusLabel('open'), C.acc, C.accBg],
      [statusLabel('approved'), C.green, C.greenBg],
      [statusLabel('rejected'), C.red, C.redBg],
      [statusLabel('notRequired'), C.gold, C.goldBg],
    ];
    statusColumns.forEach(function (column) {
      const letter = excelColumnName(column), ref = letter + '2:' + letter + lastRow;
      const rules = specs.map(function (spec) {
        return {
          type: 'expression',
          formulae: [letter + '2="' + excelFormulaString(spec[0]) + '"'],
          style: {
            font: { bold: true, color: { argb: spec[1] } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: spec[2] } },
          },
        };
      });
      try { sheet.addConditionalFormatting({ ref: ref, rules: rules }); } catch (_) {}
    });
  }

  function openExcelColumnsDialog() {
    if (!root.document) return;
    root.document.getElementById('_blChecklistExcelColumns')?.remove();
    const selected = new Set(excelColumnIds());
    const definitions = excelColumnDefinitions();
    const modal = root.document.createElement('div');
    modal.id = '_blChecklistExcelColumns';
    modal.className = 'cpaModalOverlay';
    modal.innerHTML = `<div class="cpaModal" role="dialog" aria-modal="true">
      <header><div><b>${T('Checklist Excel Columns', 'Checklist Excel Columns')}</b>
        <small>${T('Üretici Excel’inde görünecek bilgi sütunlarını seçin. Kimlik ve teknik eşleşme alanları kullanıcı tarafından değiştirilemez.', 'Choose the information columns shown in the supplier workbook. Identity and technical match fields cannot be edited by the supplier.')}</small></div>
        <button type="button" data-cx-close aria-label="${T('Kapat', 'Close')}">×</button></header>
      <div class="cpaModalBody">
        <div class="cpaSettingGroup">${definitions.map(function (item) {
          const checked = selected.has(item.id) || item.required;
          return `<div class="cpaSettingRow"><label class="cpaCheck"><input type="checkbox" data-cx-column="${item.id}" ${checked ? 'checked' : ''} ${item.required ? 'disabled' : ''}>
            <span><b>${isEn() ? item.en : item.tr}</b><small>${item.required ? T('Zorunlu', 'Required') : (item.type === 'date' ? T('Excel tarih biçimi: GG.AA.YYYY', 'Excel date format: DD.MM.YYYY') : '')}</small></span></label></div>`;
        }).join('')}</div>
        <p class="cpaNote">${T('Excel korumalı oluşturulur. Uygulanabilir checklist Durum, Not ve etkinleştirilmiş Rapor No / Gerçekleşme Tarihi hücreleri düzenlenebilir; ek dosya listesi ve kimlik alanları kilitlidir.', 'The workbook is protected. Applicable Status, Note and enabled Report No / Actual Date cells are editable; attachment lists and identity fields are locked.')}</p>
      </div>
      <footer><button type="button" class="cpaBtn" data-cx-reset>${T('Varsayılan', 'Default')}</button>
        <button type="button" class="cpaBtn primary" data-cx-save>${T('Kaydet', 'Save')}</button></footer>
    </div>`;
    root.document.body.appendChild(modal);
    const close = function () { modal.remove(); };
    modal.querySelectorAll('[data-cx-close]').forEach(function (el) { el.onclick = close; });
    modal.onclick = function (event) { if (event.target === modal) close(); };
    modal.querySelector('[data-cx-reset]').onclick = function () {
      const defaults = new Set(DEFAULT_EXCEL_COLUMNS);
      modal.querySelectorAll('[data-cx-column]').forEach(function (el) { el.checked = defaults.has(el.dataset.cxColumn) || el.disabled; });
    };
    modal.querySelector('[data-cx-save]').onclick = function () {
      const ids = Array.from(modal.querySelectorAll('[data-cx-column]:checked')).map(function (el) { return el.dataset.cxColumn; });
      saveExcelColumnIds(ids); close();
      toast(T('Checklist Excel sütunları kaydedildi.', 'Checklist Excel columns saved.'));
    };
  }

  /* Supplier workbook builder shared by CP › Checklist › Excel and the Office
     export capability. The caller supplies the rows, their decisions and the
     checklist items; the server also supplies answers, images, language and
     custom statuses. Sheet layout, protection and meta are identical. */
  async function buildSupplierWorkbook(options) {
    const o = options || {};
    const previousContext = buildContext;
    if (o.language || o.customStatuses) buildContext = { language: o.language || null, customStatuses: o.customStatuses || [] };
    try {
    const ExcelJS = o.ExcelJS, rows = o.rows || [];
    const analysisFor = typeof o.analysisFor === 'function' ? o.analysisFor : function () { return null; };
    const items = expandedItems(o.items || [], rows.map(analysisFor), o.answers);
    const baseApplies = typeof o.itemApplies === 'function' ? o.itemApplies : itemApplies;
    const applies = (item, analysis) => {
      const part = Components.parseItem(item.id), parts = componentParts(analysis, o.answers);
      if (part) return parts.some(entry => entry.id === part.partId) && baseApplies({ ...item, id: part.baseId }, analysis);
      if (parts.length || Components.isSet(analysis && (analysis.sourceRow || analysis), 'cp')) return false;
      return baseApplies(item, analysis);
    };
    const answerOf = typeof o.answerFor === 'function' ? o.answerFor : answerFor;
    const prepareImage = typeof o.prepareImage === 'function' ? o.prepareImage : prepareRowModelImage;
    const exportedAt = o.exportedAt || isoNow();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Buyer Log';
    workbook.created = new Date();
    workbook.calcProperties = Object.assign({}, workbook.calcProperties || {}, {
      fullCalcOnLoad: true, forceFullCalc: true, calcMode: 'auto',
    });
    const instructionsSheet = workbook.addWorksheet(T('Önce Oku', 'Read Me'), {
      views: [{ showGridLines: false, zoomScale: 100 }],
      properties: { tabColor: { argb: CHECKLIST_EXCEL_COLORS.green } },
    });
    const summarySheet = workbook.addWorksheet(T('Checklist Özet', 'Checklist Summary'), {
      views: [{ showGridLines: false, zoomScale: 90 }],
      properties: { tabColor: { argb: CHECKLIST_EXCEL_COLORS.navy } },
    });
    const sheet = workbook.addWorksheet(DATA_SHEET, {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
      properties: { tabColor: { argb: CHECKLIST_EXCEL_COLORS.acc } },
    });
    sheet.properties.defaultRowHeight = 18;

    const selectedIds = Array.isArray(o.columnIds) ? o.columnIds : excelColumnIds();
    const infoDefinitions = excelColumnDefinitions().filter(function (item) { return selectedIds.includes(item.id); });
    const columns = infoDefinitions.map(function (item) {
      return { header: isEn() ? item.en : item.tr, key: item.id, width: item.width || 12, infoDefinition: item };
    });
    items.forEach(function (item, index) {
      const label = isEn() ? item.en : item.tr;
      columns.push({ header: label, key: 's' + index, width: 14, checklistStatus: true, checklistIndex: index });
      columns.push({ header: label + ' - ' + T('Not', 'Note'), key: 'n' + index, width: 22, checklistNote: true, checklistIndex: index });
      if (item.evidenceFields && item.evidenceFields.reportNumber) {
        columns.push({ header: label + ' - ' + T('Rapor No', 'Report No'), key: 'r' + index, width: 18, checklistEvidence: 'reportNumber', checklistIndex: index });
      }
      if (item.evidenceFields && item.evidenceFields.actualDate) {
        columns.push({ header: label + ' - ' + T('Gerçekleşme Tarihi', 'Actual Date'), key: 'd' + index, width: 16, checklistEvidence: 'actualDate', checklistIndex: index });
      }
      if (item.evidenceFields && item.evidenceFields.attachments) {
        columns.push({ header: label + ' - ' + T('Ekler', 'Attachments'), key: 'a' + index, width: 28, checklistEvidence: 'attachments', checklistIndex: index });
      }
    });
    columns.push({ header: '__BL_ORDER_KEY', key: '__orderKey', width: 4, hidden: true });
    columns.push({ header: '__BL_LOAD_DATE', key: '__loadDate', width: 4, hidden: true });
    sheet.columns = columns;
    const visibleColumnCount = columns.length - 2;
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: Math.min(Math.max(infoDefinitions.length, 1), 6), showGridLines: false, zoomScale: 90 }];
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(visibleColumnCount).address };

    const statusColumns = items.map(function (_item, index) {
      return columns.findIndex(function (column) { return column.key === 's' + index; }) + 1;
    });
    const noteColumns = items.map(function (_item, index) {
      return columns.findIndex(function (column) { return column.key === 'n' + index; }) + 1;
    });
    const reportColumns = items.map(function (_item, index) {
      return columns.findIndex(function (column) { return column.key === 'r' + index; }) + 1;
    });
    const actualDateColumns = items.map(function (_item, index) {
      return columns.findIndex(function (column) { return column.key === 'd' + index; }) + 1;
    });
    const attachmentColumns = items.map(function (_item, index) {
      return columns.findIndex(function (column) { return column.key === 'a' + index; }) + 1;
    });
    const imageColumn = columns.findIndex(function (column) { return column.key === 'image'; }) + 1;
    const optionValues = statusOptions();
    // Inline Excel validation lists are limited to 255 characters.
    const validationColumn = columns.length + 1;
    const choices = sheet.getColumn(validationColumn);
    choices.header = '__BL_STATUS_CHOICES';
    choices.hidden = true;
    optionValues.forEach((name, index) => { sheet.getCell(index + 2, validationColumn).value = name; });
    const validationRange = '$' + excelColumnName(validationColumn) + '$2:$'
      + excelColumnName(validationColumn) + '$' + (optionValues.length + 1);

    for (const row of rows) {
      const analysis = analysisFor(row);
      const values = {
        __orderKey: analysis && analysis.orderKey || '',
        __loadDate: analysis && analysis.plannedLoadDate || '',
      };
      infoDefinitions.forEach(function (definition) {
        if (definition.id !== 'image') values[definition.id] = valueForExcelColumn(definition, row);
      });
      items.forEach(function (item, index) {
        if (!analysis || !applies(item, analysis)) {
          values['s' + index] = '';
          values['n' + index] = '';
          return;
        }
        const answer = answerOf(item, analysis);
        values['s' + index] = answer ? statusLabel(answer.state) : statusLabel('open');
        values['n' + index] = answer && answer.note || '';
        if (reportColumns[index]) values['r' + index] = answer && answer.reportNumber || '';
        if (actualDateColumns[index]) values['d' + index] = answer && answer.actualDate ? excelDate(answer.actualDate) : '';
        if (attachmentColumns[index]) {
          values['a' + index] = answer && Array.isArray(answer.attachments)
            ? answer.attachments.map(function (entry) { return entry && entry.filename || ''; }).filter(Boolean).join('\n')
            : '';
        }
      });

      const excelRow = sheet.addRow(values);
      excelRow.height = imageColumn ? 38 : 22;

      infoDefinitions.forEach(function (definition) {
        const colNo = columns.findIndex(function (column) { return column.key === definition.id; }) + 1;
        const cell = excelRow.getCell(colNo);
        cell.protection = { locked: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F8' } };
        if (definition.type === 'date') {
          const date = valueForExcelColumn(definition, row);
          cell.value = date || '';
          cell.numFmt = EXCEL_DATE_FORMAT;
          cell.dataValidation = dateValidation();
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', wrapText: false };
        }
      });

      items.forEach(function (item, index) {
        const applicable = Boolean(analysis && applies(item, analysis));
        const statusCell = excelRow.getCell(statusColumns[index]);
        const noteCell = excelRow.getCell(noteColumns[index]);
        const evidenceCells = [
          reportColumns[index] ? { cell: excelRow.getCell(reportColumns[index]), kind: 'reportNumber' } : null,
          actualDateColumns[index] ? { cell: excelRow.getCell(actualDateColumns[index]), kind: 'actualDate' } : null,
          attachmentColumns[index] ? { cell: excelRow.getCell(attachmentColumns[index]), kind: 'attachments' } : null,
        ].filter(Boolean);
        statusCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        noteCell.alignment = { vertical: 'middle', wrapText: true };
        statusCell.protection = { locked: !applicable };
        noteCell.protection = { locked: !applicable };
        evidenceCells.forEach(function (entry) {
          entry.cell.alignment = { vertical: 'middle', horizontal: entry.kind === 'actualDate' ? 'center' : 'left', wrapText: true };
          // Ek dosya isimleri bilgi amaçlıdır; dosyanın kendisi Buyer Log'dadır.
          // Rapor No ve Gerçekleşme Tarihi ise üretici Excel'inden güncellenebilir.
          entry.cell.protection = { locked: !applicable || entry.kind === 'attachments' };
          if (entry.kind === 'actualDate') {
            entry.cell.numFmt = EXCEL_DATE_FORMAT;
            entry.cell.dataValidation = dateValidation();
          }
        });
        if (applicable) {
          const tone = checklistStatusTone(statusCell.value);
          statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.bg } };
          statusCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: tone.fg } };
          noteCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHECKLIST_EXCEL_COLORS.accBg } };
          noteCell.font = { name: 'Segoe UI', size: 9, color: { argb: CHECKLIST_EXCEL_COLORS.ink } };
          evidenceCells.forEach(function (entry) {
            const editable = entry.kind !== 'attachments';
            entry.cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: editable ? CHECKLIST_EXCEL_COLORS.accBg : CHECKLIST_EXCEL_COLORS.paper } };
            entry.cell.font = { name: 'Segoe UI', size: 9, color: { argb: editable ? CHECKLIST_EXCEL_COLORS.ink : CHECKLIST_EXCEL_COLORS.muted } };
          });
        } else {
          [statusCell, noteCell].concat(evidenceCells.map(function (entry) { return entry.cell; })).forEach(function (cell) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHECKLIST_EXCEL_COLORS.grayBg } };
            cell.font = { name: 'Segoe UI', size: 9, color: { argb: CHECKLIST_EXCEL_COLORS.muted } };
          });
        }
        if (applicable) {
          statusCell.dataValidation = {
            type: 'list', allowBlank: false,
            formulae: [validationRange],
            showErrorMessage: true,
            errorTitle: T('Geçersiz durum', 'Invalid status'),
            error: T('Listeden geçerli bir durum seçin.', 'Choose a valid status from the list.'),
            showInputMessage: true,
            promptTitle: T('Checklist Durumu', 'Checklist Status'),
            prompt: T('Listeden bir durum seçin.', 'Choose a status from the list.'),
          };
        }
      });

      if (imageColumn) {
        const prepared = await prepareImage(row);
        const extension = preparedImageExtension(prepared && prepared.dataUrl);
        if (prepared && extension) {
          try {
            const imageId = workbook.addImage({ base64: prepared.dataUrl, extension: extension });
            sheet.addImage(imageId, imagePlacement(prepared, excelRow.number, imageColumn));
          } catch (_) {}
        }
      }
    }

    const header = sheet.getRow(1);
    header.height = 30;
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    columns.forEach(function (column, index) {
      const cell = header.getCell(index + 1);
      const fill = column.checklistStatus ? CHECKLIST_EXCEL_COLORS.acc
        : column.checklistNote ? CHECKLIST_EXCEL_COLORS.gold
        : column.checklistEvidence ? (column.checklistEvidence === 'attachments' ? CHECKLIST_EXCEL_COLORS.muted : CHECKLIST_EXCEL_COLORS.green)
        : column.hidden ? CHECKLIST_EXCEL_COLORS.muted
        : CHECKLIST_EXCEL_COLORS.navy;
      cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: CHECKLIST_EXCEL_COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.border = { bottom: { style: 'medium', color: { argb: fill } } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.protection = { locked: true };
      if (column.checklistStatus) cell.note = T(
        'Doldurulacak alan: açılır listeden Bekliyor / Onaylandı / Reddedildi / Gerekmiyor seçin.',
        'Editable field: choose Pending / Approved / Rejected / Not Required from the dropdown.'
      );
      else if (column.checklistNote) cell.note = T(
        'Doldurulacak alan: özellikle Reddedildi durumunda sebep ve beklenen aksiyonu yazın.',
        'Editable field: especially for Rejected status, enter the reason and required action.'
      );
      else if (column.checklistEvidence === 'reportNumber') cell.note = T('Doldurulacak alan: ilgili rapor numarasını yazın.', 'Editable field: enter the related report number.');
      else if (column.checklistEvidence === 'actualDate') cell.note = T('Doldurulacak alan: gerçekleşme tarihini GG.AA.YYYY olarak girin.', 'Editable field: enter the actual date as DD.MM.YYYY.');
      else if (column.checklistEvidence === 'attachments') cell.note = T('Bilgi alanı: bu sütun kilitlidir; ek dosya adlarını değiştirmeyin.', 'Reference field: this column is locked; do not change attachment names.');
    });
    sheet.eachRow({ includeEmpty: false }, function (row, rowNo) {
      if (rowNo === 1) return;
      row.eachCell({ includeEmpty: true }, function (cell, colNo) {
        cell.border = {
          top: { style: 'hair', color: { argb: CHECKLIST_EXCEL_COLORS.line } },
          left: { style: 'hair', color: { argb: CHECKLIST_EXCEL_COLORS.line } },
          bottom: { style: 'hair', color: { argb: CHECKLIST_EXCEL_COLORS.line } },
          right: { style: 'hair', color: { argb: CHECKLIST_EXCEL_COLORS.line } },
        };
        const column = columns[colNo - 1];
        if (column && column.infoDefinition && column.infoDefinition.id !== 'image') {
          cell.font = { name: 'Segoe UI', size: 9, color: { argb: CHECKLIST_EXCEL_COLORS.ink } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNo % 2 ? CHECKLIST_EXCEL_COLORS.paper : CHECKLIST_EXCEL_COLORS.band } };
        }
      });
    });
    const lastDataRow = Math.max(2, sheet.rowCount);
    applyChecklistConditionalFormatting(sheet, statusColumns, lastDataRow);
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    const technicalStart = columns.length - 1;
    sheet.getColumn(technicalStart).hidden = true;
    sheet.getColumn(technicalStart + 1).hidden = true;
    await sheet.protect(EXCEL_PROTECTION_PASSWORD, {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
      sort: true,
      autoFilter: true,
    });

    renderChecklistInstructions(instructionsSheet, rows, items, exportedAt);
    await instructionsSheet.protect(EXCEL_PROTECTION_PASSWORD, {
      selectLockedCells: true,
      selectUnlockedCells: false,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
    });

    renderChecklistSummary(summarySheet, rows, items, statusColumns, lastDataRow, exportedAt);
    await summarySheet.protect(EXCEL_PROTECTION_PASSWORD, {
      selectLockedCells: true,
      selectUnlockedCells: false,
      formatCells: false,
      formatColumns: false,
      formatRows: false,
      insertColumns: false,
      insertRows: false,
      deleteColumns: false,
      deleteRows: false,
    });

    const meta = workbook.addWorksheet(META_SHEET);
    meta.state = 'veryHidden';
    instructionsSheet.orderNo = 0;
    summarySheet.orderNo = 1;
    sheet.orderNo = 2;
    meta.orderNo = 3;
    workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible' }];
    meta.addRow(['BUYER_LOG_CHECKLIST_SUPPLIER', SCHEMA_VERSION]);
    meta.addRow(['exportedAt', exportedAt]);
    meta.addRow(['supplier', supplierNameFor(rows)]);
    meta.addRow(['statusColumn', 'noteColumn', 'reportColumn', 'actualDateColumn', 'attachmentsColumn', 'itemId', 'tr', 'en', 'questionTr', 'questionEn']);
    items.forEach(function (item, index) {
      meta.addRow([
        statusColumns[index], noteColumns[index], reportColumns[index] || 0, actualDateColumns[index] || 0, attachmentColumns[index] || 0,
        item.id, item.tr, item.en, item.questionTr, item.questionEn,
      ]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = 'BuyerLog_Checklist_' + safeFilePart(supplierNameFor(rows)) + '_' + stamp + '.xlsx';
    return { buffer: buffer, filename: filename, supplier: supplierNameFor(rows), exportedAt: exportedAt };
    } finally { buildContext = previousContext; }
  }

  async function exportWorkbook(options) {
    const opts = options || {};
    await loadShared();
    const rows = Array.isArray(opts.rows) ? opts.rows : selectedRows();
    if (!rows.length) {
      toast(T('Önce CP tablosundan üreticiye göndereceğiniz sipariş satırlarını seçin.', 'Select the CP order rows you want to send to the supplier first.'));
      return false;
    }
    const items = itemCatalog();
    if (!items.length) {
      toast(T('Aktarılacak aktif checklist başlığı yok.', 'There are no active checklist headings to export.'));
      return false;
    }

    const ExcelJS = await ensureExcel();
    const decision = analysesForRows(rows);
    const built = await buildSupplierWorkbook({
      ExcelJS: ExcelJS, rows: rows, items: items,
      analysisFor: function (row) { return decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null; },
    });
    const buffer = built.buffer, filename = built.filename;
    if (opts.download !== false) {
      downloadBuffer(buffer, filename);
      toast(T('Üretici checklist Excel’i oluşturuldu.', 'Supplier checklist workbook created.'));
    }
    return { ok: true, buffer: buffer, filename: filename, rows: rows, supplier: supplierNameFor(rows) };
  }

  function readMeta(workbook) {
    const meta = workbook.getWorksheet(META_SHEET);
    if (!meta || text(meta.getCell('A1').text) !== 'BUYER_LOG_CHECKLIST_SUPPLIER') {
      throw workbookError(T('Bu dosya Buyer Log üretici checklist şablonu değil.', 'This is not a Buyer Log supplier checklist workbook.'));
    }
    const version = Number(meta.getCell('B1').value) || 0;
    if (version < 1 || version > SCHEMA_VERSION) throw workbookError(T('Checklist Excel şablon sürümü desteklenmiyor.', 'Checklist workbook schema version is not supported.'));
    const exportedAt = text(meta.getCell('B2').text || meta.getCell('B2').value);
    const items = [];
    for (let rowNo = 5; rowNo <= meta.rowCount; rowNo += 1) {
      const row = meta.getRow(rowNo);
      const itemIdColumn = version >= 2 ? 6 : 3;
      const itemId = text(row.getCell(itemIdColumn).text || row.getCell(itemIdColumn).value);
      if (!itemId) continue;
      items.push(version >= 2 ? {
        statusColumn: Number(row.getCell(1).value) || 0,
        noteColumn: Number(row.getCell(2).value) || 0,
        reportColumn: Number(row.getCell(3).value) || 0,
        actualDateColumn: Number(row.getCell(4).value) || 0,
        attachmentsColumn: Number(row.getCell(5).value) || 0,
        id: itemId,
        tr: text(row.getCell(7).text || row.getCell(7).value),
        en: text(row.getCell(8).text || row.getCell(8).value),
      } : {
        statusColumn: Number(row.getCell(1).value) || 0,
        noteColumn: Number(row.getCell(2).value) || 0,
        reportColumn: 0, actualDateColumn: 0, attachmentsColumn: 0,
        id: itemId,
        tr: text(row.getCell(4).text || row.getCell(4).value),
        en: text(row.getCell(5).text || row.getCell(5).value),
      });
    }
    return { version: version, exportedAt: exportedAt, items: items };
  }

  function headerIndex(sheet, label) {
    const target = text(label);
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      if (text(sheet.getRow(1).getCell(col).text) === target) return col;
    }
    return 0;
  }

  function workbookError(message) {
    return Object.assign(new Error(message), { code: 'CHECKLIST_WORKBOOK_INVALID' });
  }

  /* Pure supplier workbook reader shared by the CP import button and the
     Office import capability. The caller supplies the live decisions
     (analysisFor), the checklist catalog and the applicability rule, so the
     browser and the server use one parser and one set of skip rules. */
  function parseSupplierWorkbook(workbook, options) {
    const opts = options || {};
    // An explicit language holds for this synchronous parse only, so a
    // concurrent server export cannot change the import's messages.
    const previousLanguage = parseLanguage;
    if (typeof opts.english === 'boolean') parseLanguage = opts.english ? 'en' : 'tr';
    try { return parseSupplierRows(workbook, opts); } finally { parseLanguage = previousLanguage; }
  }
  function parseSupplierRows(workbook, opts) {
    const meta = readMeta(workbook);
    const sheet = workbook.getWorksheet(DATA_SHEET) || workbook.worksheets.find(function (ws) { return ws.state === 'visible'; });
    if (!sheet) throw workbookError(T('Checklist sayfası bulunamadı.', 'Checklist sheet was not found.'));

    const orderKeyCol = headerIndex(sheet, '__BL_ORDER_KEY');
    const loadDateCol = headerIndex(sheet, '__BL_LOAD_DATE');
    const supplierCol = headerIndex(sheet, T('Üretici', 'Supplier')) || headerIndex(sheet, 'Supplier') || headerIndex(sheet, 'Üretici');
    if (!orderKeyCol) throw workbookError(T('Buyer Log eşleşme anahtarı bulunamadı.', 'Buyer Log match key is missing.'));

    const analysisFor = typeof opts.analysisFor === 'function' ? opts.analysisFor : function () { return null; };
    const catalog = opts.catalog instanceof Map ? opts.catalog : new Map();
    const applies = typeof opts.applies === 'function' ? opts.applies : itemApplies;
    const english = typeof opts.english === 'boolean' ? opts.english : isEn();
    const entries = [];
    let blank = 0, invalid = 0, notApplicable = 0, formulaCells = 0, staleRows = 0;
    const importedAt = opts.at || isoNow();

    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
      const row = sheet.getRow(rowNo);
      const orderKey = text(row.getCell(orderKeyCol).text || row.getCell(orderKeyCol).value);
      if (!orderKey) continue;
      const loadDate = loadDateCol ? text(row.getCell(loadDateCol).text || row.getCell(loadDateCol).value) : '';
      const supplier = supplierCol ? text(row.getCell(supplierCol).text || row.getCell(supplierCol).value) : '';
      const analysis = analysisFor(orderKey);
      if (!analysis) { invalid += meta.items.length; continue; }
      if (loadDate && analysis.plannedLoadDate && loadDate !== String(analysis.plannedLoadDate)) {
        staleRows += 1;
        continue;
      }

      meta.items.forEach(function (metaItem) {
        const cell = row.getCell(metaItem.statusColumn);
        if (cell.value && typeof cell.value === 'object' && Object.prototype.hasOwnProperty.call(cell.value, 'formula')) {
          formulaCells += 1; return;
        }
        const raw = text(cell.text || cell.value);
        if (!raw) { blank += 1; return; }
        const nextState = normalizeState(raw, opts.customStatuses);
        if (!nextState) { invalid += 1; return; }
        const scoped = Components.parseItem(metaItem.id);
        const baseItem = catalog.get(scoped ? scoped.baseId : metaItem.id);
        const item = scoped && baseItem ? scopedItem(baseItem, scoped.partId) : baseItem;
        if (!item) { invalid += 1; return; }
        const parts = componentParts(analysis, opts.answers);
        if ((!scoped && (parts.length || Components.isSet(analysis.sourceRow || analysis, 'cp'))) || (scoped && !parts.some(part => part.id === scoped.partId))) { notApplicable += 1; return; }
        if (analysis && !applies(scoped ? { ...item, id: scoped.baseId } : item, analysis)) { notApplicable += 1; return; }
        const noteCell = metaItem.noteColumn ? row.getCell(metaItem.noteColumn) : null;
        const reportCell = metaItem.reportColumn ? row.getCell(metaItem.reportColumn) : null;
        const actualDateCell = metaItem.actualDateColumn ? row.getCell(metaItem.actualDateColumn) : null;
        const note = noteCell ? String(noteCell.text || noteCell.value || '') : '';
        const reportNumber = reportCell ? text(reportCell.text || reportCell.value) : '';
        // The native answer store refuses the whole batch for longer evidence.
        if (note.length > 2000 || reportNumber.length > 300) { invalid += 1; return; }
        let actualDate = '';
        if (actualDateCell && actualDateCell.value) {
          const date = excelDate(actualDateCell.value);
          if (date) actualDate = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
          ].join('-');
        }
        entries.push({
          orderKey: orderKey,
          itemId: metaItem.id,
          itemLabel: english ? item.en : item.tr,
          state: nextState,
          at: importedAt,
          baseAt: meta.exportedAt || '',
          loadDate: loadDate || null,
          note: note,
          ...(metaItem.reportColumn ? { reportNumber: reportNumber } : {}),
          ...(metaItem.actualDateColumn ? { actualDate: actualDate } : {}),
          // Workbook attachment names are read-only; preserve authoritative
          // server attachments even when this device has no complete mirror.
          supplier: supplier,
          source: 'supplier_excel',
        });
      });
    }
    const rosters = new Map();
    for (const entry of entries) {
      if (!Components.parseItem(entry.itemId) || rosters.has(entry.orderKey)) continue;
      const analysis = analysisFor(entry.orderKey), answers = opts.answers || (assistantState() && assistantState().answers) || {};
      if (answers[Components.configKey(analysis)]) continue;
      const count = componentParts(analysis, answers).length;
      if (count >= 2) rosters.set(entry.orderKey, { orderKey: entry.orderKey, itemId: Components.CONFIG_ITEM, state: 'open', componentCount: count, at: importedAt, baseAt: meta.exportedAt || '', source: 'supplier_excel' });
    }
    entries.push(...rosters.values());
    return {
      meta: meta, entries: entries,
      counts: { blank: blank, invalid: invalid, notApplicable: notApplicable, formulaCells: formulaCells, staleRows: staleRows },
    };
  }

  async function importWorkbook(file) {
    if (!file) return false;
    await loadShared();
    const ExcelJS = await ensureExcel();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const liveRows = currentRows(), liveDecision = analysesForRows(liveRows);
    const liveByOrder = liveDecision.byOrderKey || new Map();
    const parsed = parseSupplierWorkbook(workbook, {
      analysisFor: function (orderKey) { return liveByOrder && liveByOrder.get ? liveByOrder.get(orderKey) : null; },
      catalog: new Map(itemCatalog().map(function (item) { return [item.id, item]; })),
      applies: itemApplies,
      english: isEn(),
      at: isoNow(),
    });
    const entries = parsed.entries;
    const invalid = parsed.counts.invalid, notApplicable = parsed.counts.notApplicable;
    const formulaCells = parsed.counts.formulaCells, staleRows = parsed.counts.staleRows;

    if (!entries.length) {
      toast(T('İçe aktarılacak checklist güncellemesi bulunamadı.', 'No checklist updates were found to import.'));
      return false;
    }
    const message = T(
      entries.length + ' checklist güncellemesi Buyer Log’a aktarılacak. Devam edilsin mi?',
      entries.length + ' checklist updates will be imported into Buyer Log. Continue?'
    );
    if (typeof root.confirm === 'function' && !root.confirm(message)) return false;

    const result = await post('/answers', { entries: entries, source: 'supplier_excel' });
    await loadShared(true);
    const conflicts = Number(result.conflicts || 0);
    const skipped = Number(result.skipped || 0) + invalid + notApplicable + formulaCells;
    toast(
      T('Checklist içe aktarıldı: ', 'Checklist imported: ') + result.updated
      + T(' güncellendi, ', ' updated, ') + result.cleared
      + T(' yeniden açıldı', ' reopened')
      + (conflicts ? ', ' + conflicts + T(' daha yeni Buyer Log verisi nedeniyle korunarak atlandı', ' kept because Buyer Log had newer data') : '')
      + (staleRows ? ', ' + staleRows + T(' satır yükleme tarihi değiştiği için atlandı', ' rows skipped because the load date changed') : '')
      + (skipped ? ', ' + skipped + T(' geçersiz/uygunsuz kayıt atlandı.', ' invalid/not-applicable entries skipped.') : '.')
    );
    return true;
  }

  async function prepareSupplierChecklistEmail() {
    await loadShared();
    const rows = selectedRows();
    if (!rows.length) {
      toast(T('Önce CP tablosundan üreticiye göndereceğiniz sipariş satırlarını seçin.', 'Select the CP order rows you want to send to the supplier first.'));
      return false;
    }

    // Birden fazla üretici aynı seçimde olabilir. Her satırı kendi üreticisine
    // ayırırız; Excel ve kanıt ekleri de aynı kapsamla etiketlenir. Böylece
    // Prepare E-Mail her üretici için yalnız kendi siparişlerini ve dosyalarını
    // kullanarak ayrı taslak oluşturabilir.
    const groupMap = new Map(), missingRows = [];
    rows.forEach(function (row) {
      const supplier = visibleValue(row, ['Sub-Manufacturer', 'Manufacturer', 'Üretici', 'Supplier']);
      if (!supplier) { missingRows.push(row); return; }
      const key = supplier.toLocaleLowerCase('tr-TR');
      if (!groupMap.has(key)) groupMap.set(key, { supplier: supplier, rows: [] });
      groupMap.get(key).rows.push(row);
    });
    if (missingRows.length) {
      toast(T(
        'Checklist e-postası hazırlanamadı: seçili ' + missingRows.length + ' satırda üretici bilgisi yok. Önce üretici atamasını tamamlayın.',
        'Checklist e-mail could not be prepared: ' + missingRows.length + ' selected row(s) have no supplier. Assign a supplier first.'
      ));
      return false;
    }
    const supplierGroups = Array.from(groupMap.values());
    if (!supplierGroups.length) {
      toast(T('Seçili satırlarda üretici bilgisi bulunamadı.', 'No supplier information was found in the selected rows.'));
      return false;
    }

    const items = itemCatalog();
    const initialFiles = [];
    const tempRows = [];
    const directory = typeof root.BLPrepareEmailManufacturers === 'function' ? root.BLPrepareEmailManufacturers() : null;
    let evidenceFileCount = 0, virtualRowId = -100000;

    for (const group of supplierGroups) {
      const supplier = group.supplier, supplierRows = group.rows;
      const artifact = await exportWorkbook({ rows: supplierRows, download: false });
      if (!artifact || !artifact.buffer) {
        throw new Error(T('Checklist Excel hazırlanamadı: ', 'Checklist workbook could not be prepared: ') + supplier);
      }
      const excelBlob = new Blob([artifact.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      let excelFile;
      try { excelFile = new File([excelBlob], artifact.filename, { type: excelBlob.type, lastModified: Date.now() }); }
      catch (_) { excelBlob.name = artifact.filename; excelFile = excelBlob; }
      initialFiles.push({
        file: excelFile,
        modelLabel: supplier + ' · ' + T('Checklist Excel', 'Checklist Excel'),
        manufacturer: supplier,
        directAttachment: true,
      });

      const decision = analysesForRows(supplierRows), attachmentMap = new Map();
      supplierRows.forEach(function (row) {
        const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
        if (!analysis) return;
        expandedItems(items, [analysis]).forEach(function (item) {
          if (!itemApplies(item, analysis)) return;
          const answer = answerFor(item, analysis);
          (answer && Array.isArray(answer.attachments) ? answer.attachments : []).forEach(function (entry) {
            if (entry && entry.id && !attachmentMap.has(entry.id)) attachmentMap.set(entry.id, entry);
          });
        });
      });

      for (const meta of attachmentMap.values()) {
        const file = await checklistAttachmentAsFile(meta);
        if (!file) {
          throw new Error(
            T('Checklist eklerinden biri okunamadı: ', 'A checklist attachment could not be read: ')
            + (meta.filename || meta.id) + ' · ' + supplier
          );
        }
        initialFiles.push({
          file: file,
          modelLabel: supplier + ' · ' + T('Checklist eki', 'Checklist attachment'),
          manufacturer: supplier,
        });
        evidenceFileCount += 1;
      }

      if (Array.isArray(directory) && !directory.some(function (item) {
        return item && text(item.name).toLocaleLowerCase('tr-TR') === supplier.toLocaleLowerCase('tr-TR');
      })) directory.push({ name: supplier, email: '' });

      supplierRows.forEach(function (row) {
        tempRows.push({
          ...row,
          id: virtualRowId--,
          manufacturer: supplier,
          buyingSampleManufacturer: supplier,
          _cpSourceRow: row,
        });
      });
    }

    const supplierNames = supplierGroups.map(function (group) { return group.supplier; });
    const context = {
      rows: tempRows,
      count: tempRows.length,
      btnId: 'cpChecklistPrepareEmailVirtualBtn',
      persist: false,
      preselect: supplierNames,
      initialFiles: initialFiles,
      title: T('Üreticiye Checklist Exceli Hazırla', 'Prepare Supplier Checklist'),
      subtitle: supplierNames.length + ' ' + T('üretici', 'supplier(s)')
        + ' · ' + tempRows.length + ' ' + T('sipariş', 'orders')
        + ' · ' + T('her üretici için ayrı Checklist Excel', 'separate Checklist Excel per supplier')
        + (evidenceFileCount ? ' + ' + evidenceFileCount + ' ' + T('ek', 'attachment(s)') : '')
        + ' · ' + T('taslak oluşturmadan önce kontrol edin', 'review before creating drafts'),
      resultTitle: T('Checklist E-Posta Sonucu', 'Checklist E-Mail Result'),
    };
    if (root.BLPrepareEmail && typeof root.BLPrepareEmail.openChecklist === 'function') {
      root.BLPrepareEmail.openChecklist(context);
      return true;
    }
    if (typeof root.renderKolMfrModal === 'function') {
      root.renderKolMfrModal({ ...context, defaultTopicKind: 'general', defaultTopicId: 'general-checklist' });
      return true;
    }
    throw new Error(T('Prepaire E-Mail modülü hazır değil.', 'Prepaire E-Mail module is not ready.'));
  }

  function ensureUi() {
    const menu = root.document && root.document.getElementById('cpToolsMenu');
    if (!menu || root.document.getElementById('cpChecklistToolsWrap')) return;

    const wrap = root.document.createElement('div');
    wrap.className = 'toolbarMoreWrap';
    wrap.id = 'cpChecklistToolsWrap';
    wrap.style.position = 'relative';
    wrap.style.width = '100%';

    const trigger = root.document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tbtn';
    trigger.id = 'cpChecklistToolsBtn';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.style.width = '100%';
    trigger.style.justifyContent = 'flex-start';
    trigger.innerHTML = '<svg class="ic"><use href="#i-checklist"/></svg><span>Checklist</span>';

    const sub = root.document.createElement('div');
    sub.className = 'toolbarMoreMenu';
    sub.id = 'cpChecklistToolsMenu';
    sub.hidden = true;
    sub.style.left = 'calc(100% + 6px)';
    sub.style.right = 'auto';
    sub.style.top = '0';
    sub.style.minWidth = '240px';
    sub.innerHTML = '<div class="toolbarMoreLabel">CHECKLIST</div>'
      + '<button type="button" class="tbtn" data-checklist-excel-create><svg class="ic"><use href="#i-file-export"/></svg><span>Create Checklist Excel</span></button>'
      + '<button type="button" class="tbtn" data-checklist-supplier-prepare><svg class="ic"><use href="#i-mail-send"/></svg><span>' + T('Üreticiye Checklist Exceli Hazırla', 'Prepare Supplier Checklist') + '</span></button>'
      + '<button type="button" class="tbtn" data-checklist-excel-import><svg class="ic"><use href="#i-file-import"/></svg><span>Import Checklist Excel</span></button>'
      + '<button type="button" class="tbtn" data-checklist-excel-columns><svg class="ic"><use href="#i-columns-3"/></svg><span>Checklist Excel Columns</span></button>'
      + '<button type="button" class="tbtn" data-checklist-test-reports><svg class="ic"><use href="#i-file-import"/></svg><span>' + T('Test Raporu Aktar', 'Import Test Reports') + '</span></button>';

    const input = root.document.createElement('input');
    input.type = 'file';
    input.id = 'cpChecklistExcelImportFile';
    input.accept = '.xlsx,.xlsm';
    input.hidden = true;

    wrap.appendChild(trigger);
    wrap.appendChild(sub);
    menu.appendChild(wrap);
    menu.appendChild(input);

    const closeSub = function () {
      sub.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    };
    trigger.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      sub.hidden = !sub.hidden;
      trigger.setAttribute('aria-expanded', sub.hidden ? 'false' : 'true');
      if (!sub.hidden) {
        root.requestAnimationFrame(function () {
          const rect = sub.getBoundingClientRect();
          if (rect.right > root.innerWidth - 8) {
            sub.style.left = 'auto';
            sub.style.right = 'calc(100% + 6px)';
          } else {
            sub.style.left = 'calc(100% + 6px)';
            sub.style.right = 'auto';
          }
        });
      }
    });
    sub.addEventListener('click', function (event) { event.stopPropagation(); });
    root.document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) closeSub();
    });

    sub.querySelector('[data-checklist-excel-create]').addEventListener('click', function () {
      closeSub();
      exportWorkbook().catch(function (error) {
        toast(T('Checklist Excel oluşturulamadı: ', 'Checklist workbook could not be created: ') + (error.message || error));
      });
    });
    sub.querySelector('[data-checklist-supplier-prepare]').addEventListener('click', function () {
      closeSub();
      prepareSupplierChecklistEmail().catch(function (error) {
        toast(T('Üretici checklist e-postası hazırlanamadı: ', 'Supplier checklist e-mail could not be prepared: ') + (error.message || error));
      });
    });
    sub.querySelector('[data-checklist-excel-import]').addEventListener('click', function () {
      closeSub();
      input.value = '';
      input.click();
    });
    sub.querySelector('[data-checklist-excel-columns]').addEventListener('click', function () {
      closeSub();
      openExcelColumnsDialog();
    });
    sub.querySelector('[data-checklist-test-reports]').addEventListener('click', function () {
      closeSub();
      openTestReportImport(null);
    });
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      importWorkbook(file).catch(function (error) {
        toast(T('Checklist Excel içe aktarılamadı: ', 'Checklist workbook could not be imported: ') + (error.message || error));
      });
    });
  }

  function evidenceEnabled(item, answer) {
    const fields = evidenceFieldsFor(item, answer);
    return Boolean(fields.reportNumber || fields.actualDate || fields.attachments);
  }
  /* Test raporu aktarımı ekleri, adımda "Ekler" alanı kapalı olsa da kayda
     ekler. Kayıtta ek varsa ekler alanı her zaman görünür; aksi hâlde dosya
     Buyer Log'da durur ama hiçbir yerden açılamaz. */
  function evidenceFieldsFor(item, answer) {
    const fields = Object.assign({}, item && item.evidenceFields || {});
    if (answer && Array.isArray(answer.attachments) && answer.attachments.length) fields.attachments = true;
    return fields;
  }
  function fileBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const value = String(reader.result || '');
        resolve(value.indexOf(',') >= 0 ? value.slice(value.indexOf(',') + 1) : value);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function uploadChecklistAttachment(file, context) {
    const payload = await post('/attachments', {
      filename: file.name || 'attachment',
      mimeType: file.type || 'application/octet-stream',
      base64: await fileBase64(file),
      context: context || {},
    });
    return payload && payload.attachment;
  }
  async function deleteChecklistAttachment(id) {
    const response = await root.fetch(API + '/attachments/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!response.ok) throw new Error(T('Checklist eki silinemedi.', 'Checklist attachment could not be deleted.'));
    return true;
  }
  async function checklistAttachmentAsFile(meta) {
    if (!meta || !meta.id) return null;
    const response = await root.fetch(API + '/attachments/' + encodeURIComponent(meta.id), { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    try {
      return new File([blob], meta.filename || 'attachment', { type: meta.mimeType || blob.type || 'application/octet-stream', lastModified: Date.now() });
    } catch (_) {
      blob.name = meta.filename || 'attachment';
      return blob;
    }
  }
  function evidenceContext(row, item, status, sequence) {
    return {
      orderCode: visibleValue(row, ['Order Code', 'ORDER CODE', 'OrderCode']),
      plmId: visibleValue(row, ['PLM ID', 'PLM', 'PLM Id']),
      modelName: visibleValue(row, ['Model Name', 'MODEL NAME', 'Model', 'Model Adı']),
      colourCode: visibleValue(row, ['C.Code', 'Colour Code', 'Color Code', 'Renk Kodu']),
      checklistName: isEn() ? item.en : item.tr,
      checklistStatus: statusLabel(status),
      sequence: sequence || 1,
    };
  }
  function openChecklistEvidenceDialog(trigger) {
    const row = cpRowById(trigger && trigger.dataset.id);
    const itemId = trigger && trigger.dataset.item;
    const item = catalogItem(itemId);
    if (!row || !item) return;
    const decision = analysesForRows([row]);
    const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
    if (!analysis) return;
    const answer = answerFor(item, analysis);
    if (!evidenceEnabled(item, answer)) return;
    const status = normalizeState(answer && answer.state) || normalizeState(trigger.dataset.status) || 'open';
    root.document.getElementById('_blChecklistEvidence')?.remove();
    let kept = Array.isArray(answer && answer.attachments) ? answer.attachments.slice() : [];
    const removed = new Set();
    const pending = [];
    let uploadPromise = null;
    const modal = root.document.createElement('div');
    modal.id = '_blChecklistEvidence';
    modal.className = 'cpaModalOverlay';
    const fields = evidenceFieldsFor(item, answer);
    const attachmentRows = function () {
      const current = kept.filter(function (entry) { return !removed.has(entry.id); });
      return current.map(function (entry) {
        const href = API + '/attachments/' + encodeURIComponent(entry.id);
        return '<div class="cpaSettingRow" data-evidence-attachment="' + html(entry.id) + '"><span><b>' + html(entry.filename || entry.originalName || T('Dosya', 'File')) + '</b><small>' + Math.max(0, Number(entry.size) || 0).toLocaleString() + ' B</small></span>'
          + '<span style="display:flex;gap:6px"><a class="cpaBtn" href="' + html(href) + '" download="' + html(entry.filename || 'attachment') + '">' + T('Aç / İndir', 'Open / Download') + '</a>'
          + '<button type="button" class="cpaBtn" data-evidence-remove="' + html(entry.id) + '">' + T('Kaldır', 'Remove') + '</button></span></div>';
      }).join('');
    };
    modal.innerHTML = `<div class="cpaModal" role="dialog" aria-modal="true">
      <header><div><b>${html(T('Checklist Detayları', 'Checklist Details'))} · ${html(isEn() ? item.en : item.tr)}</b>
        <small>${html(visibleValue(row, ['Order Code', 'ORDER CODE']))} · ${html(statusLabel(status))}</small></div>
        <button type="button" data-evidence-close aria-label="${T('Kapat', 'Close')}">×</button></header>
      <div class="cpaModalBody">
        <div class="cpaSettingGroup">
          <label class="cpaSettingRow"><span><b>${html(T('Not', 'Note'))}</b></span><textarea data-evidence-note rows="3" maxlength="2000">${html(answer && answer.note || '')}</textarea></label>
          ${fields.reportNumber ? `<label class="cpaSettingRow"><span><b>${T('Rapor numarası', 'Report number')}</b></span><input type="text" maxlength="300" data-evidence-report value="${html(answer && answer.reportNumber || '')}"></label>` : ''}
          ${fields.actualDate ? `<label class="cpaSettingRow"><span><b>${T('Gerçekleşme tarihi', 'Actual date')}</b></span><input type="date" data-evidence-date value="${html(answer && answer.actualDate || '')}"></label>` : ''}
        </div>
        ${fields.attachments ? `<div class="cpaSettingGroup"><div class="cpaSettingRow"><span><b>${T('Rapor / e-mail ekleri', 'Report / e-mail attachments')}</b><small>${T('Dosyalar Buyer Log’da saklanır ve Üreticiye Checklist Exceli Hazırla akışında e-postaya otomatik eklenir.', 'Files are stored in Buyer Log and automatically attached by Prepare Supplier Checklist.')}</small></span>
          <label class="cpaBtn">${T('Dosya Ekle', 'Add File')}<input type="file" data-evidence-files multiple hidden></label></div>
          <div data-evidence-list>${attachmentRows()}</div>
          <div data-evidence-pending></div></div>` : ''}
      </div>
      <footer><span role="status" aria-live="polite" data-evidence-save-state>${T('Değişiklikler anında kaydedilir.', 'Changes are saved immediately.')}</span><button type="button" class="cpaBtn" data-evidence-close>${T('Kapat', 'Close')}</button><button type="button" class="cpaBtn primary" data-evidence-save>${T('Kaydı Doğrula', 'Verify Save')}</button></footer>
    </div>`;
    root.document.body.appendChild(modal);
    const close = function () {
      if (pending.length || uploadPromise) {
        toast(T('Dosya kaydı tamamlanmadı. Pencereyi açık tutun ve Kaydı Doğrula ile yeniden deneyin.', 'File save is incomplete. Keep this window open and use Verify Save to retry.'));
        return;
      }
      modal.remove();
    };
    modal.querySelectorAll('[data-evidence-close]').forEach(function (button) { button.onclick = close; });
    modal.onclick = function (event) { if (event.target === modal) close(); };
    const refreshAttachments = function () {
      const list = modal.querySelector('[data-evidence-list]');
      if (list) list.innerHTML = attachmentRows();
      const pendingHost = modal.querySelector('[data-evidence-pending]');
      if (pendingHost) pendingHost.innerHTML = pending.map(function (file, index) {
        return '<div class="cpaSettingRow"><span><b>' + html(file.name) + '</b><small>' + file.size.toLocaleString() + ' B · ' + T('Dosya kaydı bekleniyor', 'File save pending') + '</small></span></div>';
      }).join('');
    };
    modal.addEventListener('click', function (event) {
      const remove = event.target.closest('[data-evidence-remove]');
      if (remove) {
        removed.add(remove.dataset.evidenceRemove); refreshAttachments();
        saveEvidence().catch(showSaveError);
      }
    });
    modal.querySelector('[data-evidence-files]')?.addEventListener('change', function (event) {
      const files = Array.from(event.target.files || []);
      if (kept.filter(entry => !removed.has(entry.id)).length + pending.length + files.length > 40) {
        toast(T('Bir checklist kaydına en fazla 40 dosya eklenebilir.', 'A checklist record can contain up to 40 files.'));
        event.target.value = ''; return;
      }
      files.forEach(function (file) { pending.push(file); state.pendingUploads += 1; });
      event.target.value = '';
      refreshAttachments();
      uploadPendingFiles().catch(showSaveError);
    });
    function saveState(label) { const host = modal.querySelector('[data-evidence-save-state]'); if (host) host.textContent = label; }
    function showSaveError(error) {
      saveState(T('Kaydedilemedi; tekrar denenecek.', 'Save failed; retry pending.'));
      toast(T('Checklist detayları kaydedilemedi: ', 'Checklist details could not be saved: ') + (error.message || error));
    }
    async function saveEvidence() {
      const assistant = root.BLCpAssistant;
      if (!assistant || typeof assistant.setChecklistAnswer !== 'function') throw new Error(T('Checklist kaydı açılamadı.', 'Checklist record is unavailable.'));
      const latest = answerFor(item, analysis) || {};
      // A remote update or another cell may have changed the status while this
      // dialog was open. Evidence edits never restore the captured old status.
      const currentStatus = normalizeState(latest.state) || status;
      const attachments = new Map((latest.attachments || []).concat(kept).map(entry => [entry.id, entry]));
      removed.forEach(id => attachments.delete(id));
      if (attachments.size > 40) throw new Error(T('Bir checklist kaydına en fazla 40 dosya eklenebilir; mevcut ekler korundu.', 'A checklist record can contain up to 40 files; existing attachments were preserved.'));
      saveState(T('Kaydediliyor…', 'Saving…'));
      assistant.setChecklistAnswer(analysis, item.id, currentStatus, {
        note: String(modal.querySelector('[data-evidence-note]')?.value || ''),
        reportNumber: fields.reportNumber ? String(modal.querySelector('[data-evidence-report]')?.value || '') : (latest.reportNumber || ''),
        actualDate: fields.actualDate ? String(modal.querySelector('[data-evidence-date][type="date"]')?.value || '') : (latest.actualDate || ''),
        attachments: Array.from(attachments.values()),
      });
      await syncAnswerChanges();
      saveState(T('Kaydedildi', 'Saved'));
      refreshColumns({ render: true });
    }
    function uploadPendingFiles() {
      if (uploadPromise) return uploadPromise;
      uploadPromise = (async function () {
        while (pending.length) {
          const file = pending[0];
          const latest = answerFor(item, analysis) || {};
          const uploaded = await uploadChecklistAttachment(file, evidenceContext(row, item, normalizeState(latest.state) || status, kept.length + 1));
          if (!uploaded || !uploaded.id) throw new Error(T('Dosya kaydı onaylanmadı.', 'File save was not acknowledged.'));
          // Remember each successful upload immediately, including if a later
          // file fails. Retry cannot duplicate or orphan an earlier uploaded file.
          kept.push(uploaded); pending.shift(); state.pendingUploads -= 1;
          refreshAttachments();
          await saveEvidence();
        }
      }()).finally(function () { uploadPromise = null; });
      return uploadPromise;
    }
    modal.querySelectorAll('[data-evidence-note], [data-evidence-report], [data-evidence-date]').forEach(function (input) {
      input.addEventListener('input', function () { saveEvidence().catch(showSaveError); });
      input.addEventListener('change', function () { saveEvidence().catch(showSaveError); });
    });
    modal.querySelector('[data-evidence-save]').onclick = async function () {
      const button = modal.querySelector('[data-evidence-save]');
      button.disabled = true;
      try {
        await uploadPendingFiles();
        await saveEvidence();
        button.disabled = false;
      } catch (error) {
        showSaveError(error);
        button.disabled = false;
      }
    };
  }

  /* CP checklist hücresi durum menüsü. Hücreye yazı YAZILAMAZ; yalnız bu
     menüdeki dört durumdan biri seçilir ve Genel Bakış ile aynı cevap
     kaydına (BLCpAssistant.setChecklistAnswer) yazılır. */
  const statusMenu = { el: null, trigger: null };
  function closeStatusMenu(focusTrigger) {
    const trigger = statusMenu.trigger;
    if (statusMenu.el) statusMenu.el.remove();
    statusMenu.el = null;
    statusMenu.trigger = null;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (focusTrigger && trigger.isConnected) trigger.focus();
    }
  }
  function cpRowById(id) {
    const rows = root.state && root.state.cp && Array.isArray(root.state.cp.rows) ? root.state.cp.rows : currentRows();
    return rows.find(function (row) { return row && String(row._id) === String(id); }) || null;
  }
  async function chooseStatus(trigger, status) {
    const assistant = await ensureAssistant();
    const row = cpRowById(trigger.dataset.id);
    const itemId = trigger.dataset.item;
    if (!assistant || typeof assistant.setChecklistAnswer !== 'function' || !row || !itemId) {
      toast(T('Checklist durumu kaydedilemedi.', 'Checklist status could not be saved.'));
      return;
    }
    const decision = analysesForRows([row]);
    const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
    if (!analysis) { toast(T('Sipariş checklist için okunamadı.', 'The order could not be read for the checklist.')); return; }
    if (!assistant.setChecklistAnswer(analysis, itemId, status)) throw new Error(T('Checklist yerel kaydı başarısız.', 'Checklist local save failed.'));
    // Yerel seçim anında görünür; sunucu yazması da aynı işlem zincirinde
    // tetiklenir. syncAnswerChanges kuyruklu olduğu için hızlı ardışık seçimler
    // kaybolmaz.
    await syncAnswerChanges();
    refreshColumns({ render: true });
  }
  function openStatusMenu(trigger) {
    if (!root.document || !trigger) return;
    if (statusMenu.trigger === trigger) { closeStatusMenu(true); return; }
    closeStatusMenu(false);
    const current = normalizeState(trigger.dataset.status) || 'open';
    const menu = root.document.createElement('div');
    menu.className = 'delTypeMenu clStatusMenu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', T('Checklist durumu', 'Checklist status'));
    const statusOptions = [...new Set([...availableStatuses(), current])].map(function (status) {
      return '<button type="button" class="delTypeOption clStatusOption" role="option" data-cl-status="' + status + '" aria-selected="' + (status === current ? 'true' : 'false') + '">'
        + '<span class="clStatusDot is-' + (status.startsWith('custom:') ? 'custom' : status) + '" aria-hidden="true"></span>'
        // Kullanıcının yazdığı özel durum adı çeviri ağına girmez ("In Progress" kalır).
        + '<span' + (status.startsWith('custom:') ? ' data-no-i18n' : '') + '>' + html(statusLabel(status)) + '</span></button>';
    }).join('');
    // Ekler eylemi durum listesinin ÜSTÜNDE durur: özel durumlar eklendikçe
    // uzayan liste onu ekranın dışına itmez.
    const evidenceItem = catalogItem(trigger.dataset.item);
    const menuRow = evidenceItem ? cpRowById(trigger.dataset.id) : null;
    const menuDecision = menuRow ? analysesForRows([menuRow]) : null;
    const menuAnalysis = menuDecision && menuDecision.byRow && menuDecision.byRow.get ? menuDecision.byRow.get(menuRow) : null;
    const menuAnswer = menuAnalysis ? answerFor(evidenceItem, menuAnalysis) : null;
    menu.innerHTML = (evidenceEnabled(evidenceItem, menuAnswer)
      ? '<button type="button" class="delTypeOption clStatusOption" data-cl-evidence>'
        + '<span aria-hidden="true">📎</span><span>' + T('Checklist Detayları / Ekler', 'Checklist Details / Attachments') + '</span></button>'
        + '<div style="height:1px;background:var(--line);margin:5px 4px"></div>'
      : '') + statusOptions;
    // ROS/Lab Dip is a single CP checklist cell: on click, show all
    // colour decisions beneath the existing status actions, not new columns.
    if (evidenceItem && /LAB\s*DIP|LABDIP/i.test([evidenceItem.tr, evidenceItem.en].join(' '))) {
      const answer = menuAnswer;
      if (answer && answer.note && answer.source === 'test_report') {
        const lines = String(answer.note).split(/\n/).filter(Boolean).slice(0, 30);
        menu.innerHTML += '<section class="clRosStatusDetails"><b>' + html(T('Lab Dip renk sonuçları', 'Lab Dip colour results')) + '</b>'
          + lines.map(function (line) { return '<p>' + html(line) + '</p>'; }).join('') + '</section>';
      }
    }
    root.document.body.appendChild(menu);
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 160);
    const viewportHeight = root.innerHeight || 800;
    // Uzun menü (çok sayıda özel durum) görünür alana sığdırılır ve kendi içinde kayar.
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 12);
    const spaceAbove = Math.max(0, rect.top - 12);
    const natural = menu.getBoundingClientRect().height || 140;
    const openAbove = natural > spaceBelow && spaceAbove > spaceBelow;
    const height = Math.min(natural, Math.max(120, openAbove ? spaceAbove : spaceBelow));
    menu.style.maxHeight = height + 'px';
    menu.style.overflowY = 'auto';
    menu.style.minWidth = width + 'px';
    menu.style.left = Math.max(8, Math.min(rect.left, (root.innerWidth || 1200) - width - 8)) + 'px';
    menu.style.top = Math.max(4, openAbove ? rect.top - height - 4 : rect.bottom + 4) + 'px';
    if (openAbove) menu.classList.add('openAbove');
    statusMenu.el = menu;
    statusMenu.trigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const options = Array.from(menu.querySelectorAll('[data-cl-status]'));
    const selected = options.find(function (option) { return option.getAttribute('aria-selected') === 'true'; }) || options[0];
    if (selected) selected.focus();
    menu.addEventListener('click', function (event) {
      const details = event.target.closest('[data-cl-evidence]');
      if (details) {
        closeStatusMenu(false);
        openChecklistEvidenceDialog(trigger);
        return;
      }
      const option = event.target.closest('[data-cl-status]');
      if (!option) return;
      const status = option.dataset.clStatus;
      closeStatusMenu(true);
      chooseStatus(trigger, status).catch(function (error) {
        toast(T('Checklist durumu kaydedilemedi: ', 'Checklist status could not be saved: ') + (error.message || error));
      });
    });
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeStatusMenu(true); return; }
      if (event.key === 'Tab') { closeStatusMenu(false); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const index = options.indexOf(root.document.activeElement);
      const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
      options[next < 0 ? 0 : next].focus();
    });
  }
  function bindStatusCells() {
    if (state.statusCellsBound || !root.document) return;
    state.statusCellsBound = true;
    root.document.addEventListener('click', function (event) {
      const legacy = event.target && event.target.closest && event.target.closest('[data-cl-legacy]');
      if (legacy) {event.preventDefault();event.stopPropagation();openLegacyRecord(legacy);return;}
      const configure = event.target && event.target.closest && event.target.closest('[data-cl-config-parts]');
      if (configure) { event.preventDefault(); event.stopPropagation(); configureComponents(configure).catch(error => toast(error.message)); return; }
      const trigger = event.target && event.target.closest && event.target.closest('.clStatusTrigger[data-item]');
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        openStatusMenu(trigger);
        return;
      }
      if (statusMenu.el && !statusMenu.el.contains(event.target)) closeStatusMenu(false);
    }, true);
    root.document.addEventListener('scroll', function (event) {
      if (statusMenu.el && !statusMenu.el.contains(event.target)) closeStatusMenu(false);
    }, true);
    root.addEventListener('resize', function () { closeStatusMenu(false); });
  }

  function wrapRender() {
    if (state.renderWrapped || typeof root.renderCP !== 'function') return;
    const original = root.renderCP;
    root.renderCP = function () {
      if (root.BLCpAssistant) {
        const decision=root.BLCpAssistant.peekDecisionsForRows?.(currentRows());
        if(decision){try{refreshColumns({render:false,decision,reuse:true});}catch(_){}}
        else refreshAssistantView();
      }
      return original.apply(this, arguments);
    };
    state.renderWrapped = true;
  }

  function onDecisionChanged(event) {
    if (state.applyingRemote) return;
    const reason = event && event.detail && event.detail.reason || '';
    if (reason === 'preferences') {
      refreshAssistantView();
      return;
    }
    if (reason === 'checklist-answer') {
      // Journal first: rendering can itself invoke checklist migrations.
      try { captureAnswerChanges(); }
      catch (error) { toast(T('Checklist kaydı bekliyor: ', 'Checklist save is pending: ') + error.message); }
      // Hücre yerel cevapla hemen güncellenir; sunucu senkronu arkada çalışır.
      refreshColumns({ render: true });
      syncAnswerChanges().catch(function (error) {
        toast(T('Checklist cevabı senkronize edilemedi: ', 'Checklist answer could not be synced: ') + (error.message || error));
      });
    }
  }

  function beaconPendingAnswers() {
    try {
      if (!root.navigator || typeof root.navigator.sendBeacon !== 'function') return false;
      captureAnswerChanges();
      const entries = Object.values(state.pendingAnswers);
      if (!entries.length) return true;
      const body = JSON.stringify({ entries: entries, source: 'buyer_log' });
      return root.navigator.sendBeacon(API + '/answers', new Blob([body], { type: 'application/json' }));
    } catch (_) { return false; }
  }

  /* Test Raporu Aktarımı (tembel modül). CP açıkken sayfaya .msg/.eml/.pdf
     bırakmak önizlemeyi açar; hiçbir şey onaysız yazılmaz. */
  async function openTestReportImport(files) {
    try {
      if (root.BLPerf && typeof root.BLPerf.ensureFeature === 'function') await root.BLPerf.ensureFeature('testReportImport');
      if (!root.BLTestReportImport) throw new Error(T('Modül yüklenemedi.', 'Module could not be loaded.'));
      await root.BLTestReportImport.open(files);
    } catch (error) {
      toast(T('Test raporu aktarımı açılamadı: ', 'Test report import could not be opened: ') + (error.message || error));
    }
  }
  let documentRouting=false;
  async function routeCpDocuments(files) {
    if(documentRouting)return;
    documentRouting=true;
    const layouts=[],reports=[],unknown=[];
    try{
      if(root.BLPerf)await root.BLPerf.ensureFeature('layoutDocument');
      toast(T('Belgeler otomatik tanınıyor…','Detecting document types…'));
      for(const file of files){
        if(!/\.pdf$/i.test(file.name||'')){reports.push(file);continue;}
        try{
          const type=await root.BLLayoutReader.classify(file);
          if(type==='PRICE_TAG'||type==='CARE_LABEL')layouts.push(file);
          else {if(type==='TEST_REPORT')reports.push(file);else unknown.push(file.name);await root.BLLayoutReader.release(file);}
        }catch(_){unknown.push(file.name);await root.BLLayoutReader.release(file);}
      }
      if(unknown.length)toast(T('Belge türü okunamadı: ','Document type could not be read: ')+unknown.join(', '));
      if(layouts.length){
        if(root.BLPerf)await root.BLPerf.ensureFeature('layoutControl');
        root.BLLayoutControl.open(layouts,{onClose:reports.length?()=>openTestReportImport(reports):null});
        if(reports.length)toast(T('Layoutlar açıldı; test raporları layout penceresi kapanınca açılacak.','Layouts opened; test reports will open when the layout window closes.'));
      }else if(reports.length)await openTestReportImport(reports);
    }catch(_){toast(T('Belge incelemesi açılamadı.','Document review could not be opened.'));}
    finally{documentRouting=false;}
  }
  function activeTab() {
    const active = root.document && root.document.querySelector('nav.tabs button.active[data-tab]');
    return active && active.dataset ? String(active.dataset.tab || '') : '';
  }
  function dragHasFiles(event) {
    const types = event.dataTransfer && event.dataTransfer.types;
    return Boolean(types && Array.prototype.indexOf.call(types, 'Files') >= 0);
  }
  function bindReportDrop() {
    if (state.reportDropBound || !root.document) return;
    state.reportDropBound = true;
    let overlay = null, depth = 0, internalDrag = false;
    // Sayfa içinden başlayan sürükleme (sütun başlığı/satır taşıma vb.) dosya
    // bırakma değildir; yalnız dışarıdan (Explorer/Outlook) gelen sürükleme
    // test raporu katmanını açar.
    root.document.addEventListener('dragstart', function () { internalDrag = true; }, true);
    // Kaynak öğe yeniden çizilirse dragend belgeye ulaşmayabilir; bırakmada da sıfırla.
    const endInternal = function () { internalDrag = false; };
    root.document.addEventListener('dragend', endInternal, true);
    root.document.addEventListener('drop', endInternal, true);
    const eligible = function (event) {
      // Açık bir pencere (ek ekleme vb.) kendi bırakmasını yönetir.
      return activeTab() === 'cp' && !root.document.querySelector('.layoutControlOverlay,.trImportOverlay') && !(event.target && event.target.closest && event.target.closest('.cpaModalOverlay'));
    };
    const hide = function () { depth = 0; if (overlay) { overlay.remove(); overlay = null; } };
    root.document.addEventListener('dragenter', function (event) {
      if (internalDrag || !eligible(event) || !(dragHasFiles(event) || (event.dataTransfer && event.dataTransfer.types && event.dataTransfer.types.length))) return;
      depth += 1;
      if (overlay) return;
      overlay = root.document.createElement('div');
      overlay.className = 'trDropOverlay';
      overlay.setAttribute('role', 'status');
      overlay.innerHTML = '<div><b>' + html(T('Layout veya test raporlarını bırakın', 'Drop layouts or test reports')) + '</b><small>' + html(T('Belge türü otomatik algılanır · Layout sonuçları CP’ye yazılmaz', 'Document type is detected automatically · Layout results are not written to CP')) + '</small></div>';
      root.document.body.appendChild(overlay);
    });
    root.document.addEventListener('dragover', function (event) {
      if (!overlay || !eligible(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    root.document.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    });
    root.document.addEventListener('drop', function (event) {
      if (!overlay) return;
      hide();
      if (!eligible(event)) return;
      event.preventDefault();
      const files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) {
        // Klasik Outlook'tan sürüklenen mail çoğu zaman dosya üretmez.
        toast(T('Bırakılan öğe dosya içermiyor. Outlook\'tan maili .msg olarak kaydedip bırakın.', 'The dropped item has no file. Save the e-mail from Outlook as .msg and drop it.'));
        return;
      }
      routeCpDocuments(Array.prototype.slice.call(files));
    });
  }
  /* "Buyingden dönüş bekleniyor" gibi kullanıcıdan beklenen işler CP
     checklist hücresinde öne çıkar. Kaynak: sunucudaki test raporu deposu. */
  async function loadTestReportTasks() {
    try {
      const payload = await jsonFetch('/api/test-reports/tasks', { cache: 'no-store' });
      const map = new Map();
      (payload && payload.tasks || []).forEach(function (task) {
        const key = answerKey(task.orderKey, task.itemId);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(task);
      });
      state.testTasks = map;
    } catch (_) { /* görev listesi isteğe bağlıdır; checklist çalışmaya devam eder */ }
    return state.testTasks;
  }

  function activeNeedsRuntime() {
    const active = root.document && root.document.querySelector('nav.tabs button.active[data-tab]');
    const tab = active && active.dataset ? String(active.dataset.tab || '') : '';
    return tab === 'cp' || tab === 'overview';
  }

  /* CP / Genel Bakış sekmesine her tıklama checklist senkronunu yeniden
     indirip CP'yi iki kez daha çiziyordu. Kısa tazelik penceresi içinde ağ
     tekrarlanmaz; yükleme sonrası veri değişmediyse yeniden çizim yapılmaz.
     Cevap değişiklikleri kendi olaylarıyla (checklist-answer) anında işlenir. */
  const RUNTIME_FRESH_MS = 60 * 1000;
  function runtimeSignature() {
    let tasks = 0;
    state.testTasks.forEach(function (list) { tasks += list.length; });
    return [state.shared.revision || 0, state.shared.updatedAt || '', Object.keys(state.shared.answers || {}).length,
      Object.keys(state.shared.tombstones || {}).length, (state.shared.definitions || []).length, state.testTasks.size, tasks,
      Object.keys(state.pendingAnswers || {}).length].join('|');
  }
  async function startRuntime(options) {
    if (!activeNeedsRuntime()) { ensureUi(); wrapRender(); return; }
    ensureUi();
    wrapRender();
    bindReportDrop();
    const opts = options || {};
    if (opts.ifStale && state.runtimeLoadedAt && Date.now() - state.runtimeLoadedAt < RUNTIME_FRESH_MS
      && !Object.keys(state.pendingAnswers || {}).length) return;
    const first = !state.runtimeLoadedAt;
    await Promise.all([loadShared(), loadTestReportTasks()]);
    state.runtimeLoadedAt = Date.now();
    const signature = runtimeSignature();
    if (!first && signature === state.runtimeSignature) return;
    state.runtimeSignature = signature;
    refreshColumns({ render: true });
  }

  function init() {
    if (state.started || !root.document) return;
    state.started = true;
    ensureUi();
    bindStatusCells();
    bindReportDrop();
    wrapRender();
    root.addEventListener('bl:cp-decision-context-changed', onDecisionChanged);
    root.addEventListener('bl:plm-requests-changed', function () { refreshAssistantView(); });
    root.addEventListener('bl:startup-ready', function () {
      if (activeNeedsRuntime()) startRuntime().catch(function () {});
    });
    root.addEventListener('bl:user-access-applied', function () { ensureUi(); });
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.hidden) {
        syncAnswerChanges().catch(function () { beaconPendingAnswers(); });
      }
    });
    root.addEventListener('pagehide', beaconPendingAnswers);
    root.addEventListener('beforeunload', function (event) {
      beaconPendingAnswers();
      if (state.pendingUploads || Object.keys(state.pendingAnswers).length || (state.journalError && !state.journalLoaded)) {
        event.preventDefault(); event.returnValue = '';
      }
    });
    root.addEventListener('online', function () { syncAnswerChanges().catch(function () {}); });
    root.document.addEventListener('click', function (event) {
      const tab = event.target && event.target.closest && event.target.closest('nav.tabs button[data-tab]');
      if (tab && (tab.dataset.tab === 'cp' || tab.dataset.tab === 'overview')) {
        setTimeout(function () { startRuntime({ ifStale: true }).catch(function () {}); }, 0);
      }
    });
    if ((root.document.readyState === 'complete' || root.document.readyState === 'interactive') && activeNeedsRuntime()) {
      startRuntime().catch(function () {});
    }
  }

  if (assistantState()) state.observedAnswers = snapshotAnswers();
  function latestAnswerAt(key) {
    const remote = state.shared.answers[key] || state.shared.tombstones[key] || {};
    const pending = state.pendingAnswers[key] || {};
    return Math.max(Date.parse(remote.at || '') || 0, Date.parse(pending.remoteAt || '') || 0);
  }
  return {
    init: init,
    loadShared: loadShared,
    loadTestReportTasks: loadTestReportTasks,
    openTestReportImport: openTestReportImport,
    refreshColumns: refreshColumns,
    exportWorkbook: exportWorkbook,
    prepareSupplierChecklistEmail: prepareSupplierChecklistEmail,
    importWorkbook: importWorkbook,
    buildSupplierWorkbook: buildSupplierWorkbook,
    parseSupplierWorkbook: parseSupplierWorkbook,
    normalizeState: normalizeState,
    statusLabel: statusLabel,
    statusOptions: statusOptions,
    openStatusMenu: openStatusMenu,
    componentCellHtml, openComponentCountDialog, expandedItems,
    diffAnswers: diffAnswers,
    syncAnswerChanges: syncAnswerChanges,
    latestAnswerAt: latestAnswerAt,
    columnKey: columnKey,
    excelDate: excelDate,
    excelColumnIds: excelColumnIds,
    saveExcelColumnIds: saveExcelColumnIds,
    _state: state,
  };
}));
