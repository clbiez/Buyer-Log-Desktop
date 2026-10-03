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

  const API = '/api/checklist-supplier';
  const ANSWER_KEY = 'lcw.cp.checklist.v1';
  const COLUMN_PREFIX = '__checklist__';
  const META_SHEET = '__BL_META';
  const DATA_SHEET = 'Checklist';
  const SCHEMA_VERSION = 1;
  const state = {
    started: false,
    loading: null,
    applyingRemote: false,
    syncingDefinitions: false,
    syncingAnswers: false,
    shared: { definitions: [], answers: {}, tombstones: {}, revision: 0, updatedAt: '' },
    answerBaseline: {},
    renderWrapped: false,
  };

  function isEn() {
    return String((root.document && root.document.documentElement.lang) || root.appLang || 'tr').toLowerCase().startsWith('en');
  }
  function T(tr, en) { return isEn() ? en : tr; }
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
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
  function normalizeState(value) {
    const raw = text(value).toLocaleLowerCase('tr-TR').replace(/[._-]+/g, ' ');
    if (!raw) return '';
    if (['done', 'completed', 'complete', 'tamam', 'tamamlandı', 'tamamlandi', 'yes', 'evet'].includes(raw)) return 'done';
    if (['notrequired', 'not required', 'n a', 'na', 'gerekmiyor', 'gerek yok', 'uygulanmaz'].includes(raw)) return 'notRequired';
    if (['open', 'pending', 'açık', 'acik', 'bekliyor', 'yeniden aç', 'yeniden ac'].includes(raw)) return 'open';
    return '';
  }
  function statusLabel(status) {
    const s = normalizeState(status);
    if (s === 'done') return T('Tamamlandı', 'Completed');
    if (s === 'notRequired') return T('Gerekmiyor', 'Not required');
    if (s === 'open') return T('Açık', 'Open');
    return '';
  }
  function statusOptions() {
    return isEn() ? ['Open', 'Completed', 'Not required'] : ['Açık', 'Tamamlandı', 'Gerekmiyor'];
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
  function customDefinitions() {
    const s = assistantState();
    return ((s && Array.isArray(s.rules)) ? s.rules : [])
      .filter(function (rule) { return rule && rule.kind === 'checklist' && rule.builtIn !== true; })
      .map(function (rule) {
        return {
          id: rule.id, kind: 'checklist', builtIn: false, enabled: rule.enabled !== false,
          name: rule.name || rule.tr || rule.en || rule.id,
          tr: rule.tr || rule.name || rule.id, en: rule.en || rule.name || rule.id,
          questionTr: rule.questionTr || rule.name || rule.id,
          questionEn: rule.questionEn || rule.name || rule.id,
          mode: rule.mode === 'formula' ? 'formula' : 'basic',
          formula: rule.formula || '', expressionVersion: Number(rule.expressionVersion) || 1,
          conditions: Array.isArray(rule.conditions) ? safeJson(rule.conditions) : [],
          match: rule.match === 'any' ? 'any' : 'all',
        };
      });
  }
  function sameJson(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }
  function definitionSignature(list) {
    const source = (Array.isArray(list) ? list : []).map(function (item) {
      return {
        id: text(item && item.id), enabled: item && item.enabled !== false,
        name: text(item && item.name), tr: text(item && item.tr), en: text(item && item.en),
        questionTr: text(item && item.questionTr), questionEn: text(item && item.questionEn),
        mode: item && item.mode === 'formula' ? 'formula' : 'basic',
        formula: text(item && item.formula),
        match: item && item.match === 'any' ? 'any' : 'all',
        conditions: Array.isArray(item && item.conditions) ? item.conditions : [],
      };
    }).sort(function (a, b) { return a.id.localeCompare(b.id); });
    try { return JSON.stringify(source); } catch (_) { return ''; }
  }

  function mergeRemoteDefinitions(definitions) {
    const s = assistantState(), Rules = root.BLCpRulesEngine;
    if (!s || !Rules) return;
    const remote = (Array.isArray(definitions) ? definitions : []).map(function (item) {
      return Rules.normalizeRule(item, 'checklist');
    }).filter(Boolean);
    const preserved = (Array.isArray(s.rules) ? s.rules : []).filter(function (rule) {
      return !(rule && rule.kind === 'checklist' && rule.builtIn !== true);
    });
    s.rules = Rules.mergeWithDefaults(preserved.concat(remote));
  }

  function mergeRemoteAnswers(payload) {
    const s = assistantState();
    if (!s) return;
    const local = s.answers && typeof s.answers === 'object' ? s.answers : {};
    const answers = payload && payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
    const tombstones = payload && payload.tombstones && typeof payload.tombstones === 'object' ? payload.tombstones : {};
    state.applyingRemote = true;
    try {
      Object.keys(tombstones).forEach(function (key) {
        const tomb = tombstones[key] || {};
        const current = local[key];
        const currentAt = current && String(current.at || '');
        const tombAt = String(tomb.at || '');
        if (!currentAt || currentAt <= tombAt) delete local[key];
      });
      Object.keys(answers).forEach(function (key) {
        const incoming = answers[key] || {};
        const current = local[key];
        if (!current || String(current.at || '') <= String(incoming.at || '')) {
          local[key] = safeJson(incoming);
        }
      });
      s.answers = local;
    } finally {
      state.applyingRemote = false;
    }
    state.answerBaseline = snapshotAnswers();
  }

  async function syncDefinitions() {
    if (state.syncingDefinitions || state.applyingRemote) return;
    const definitions = customDefinitions();
    if (definitionSignature(definitions) === definitionSignature(state.shared.definitions)) return;
    state.syncingDefinitions = true;
    try {
      const result = await post('/definitions', { definitions: definitions });
      state.shared.definitions = safeJson(result.definitions || definitions);
      state.shared.revision = Number(result.revision) || state.shared.revision;
      state.shared.updatedAt = result.updatedAt || state.shared.updatedAt;
    } finally {
      state.syncingDefinitions = false;
    }
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
          source: 'buyer_log',
        });
        return;
      }
      const answerState = normalizeState(after.state);
      if (!answerState || answerState === 'open') return;
      entries.push({
        orderKey: parts.orderKey, itemId: parts.itemId, state: answerState,
        at: after.at || now, baseAt: before && before.at || '',
        loadDate: after.loadDate || null, source: after.source || 'buyer_log',
        note: after.note || '',
      });
    });
    return entries;
  }

  async function syncAnswerChanges() {
    if (state.syncingAnswers || state.applyingRemote) return;
    const current = snapshotAnswers();
    const entries = diffAnswers(state.answerBaseline, current);
    if (!entries.length) { state.answerBaseline = current; return; }
    state.syncingAnswers = true;
    try {
      await post('/answers', { entries: entries, source: 'buyer_log' });
      state.answerBaseline = current;
    } finally {
      state.syncingAnswers = false;
    }
  }

  function itemCatalog() {
    const s = assistantState(), Checklist = root.BLCpChecklistEngine;
    if (!s || !Checklist) return [];
    const list = [];
    (Checklist.ITEMS || []).forEach(function (item) {
      const config = s.checklistSettings && s.checklistSettings.items && s.checklistSettings.items[item.id];
      if (!config || config.enabled !== false) {
        list.push({
          id: item.id, tr: item.tr, en: item.en, questionTr: item.questionTr, questionEn: item.questionEn,
          builtIn: true, raw: item,
        });
      }
    });
    (Array.isArray(s.rules) ? s.rules : []).forEach(function (rule) {
      if (!rule || rule.kind !== 'checklist' || rule.builtIn === true || rule.enabled === false) return;
      if (list.some(function (item) { return item.id === rule.id; })) return;
      list.push({
        id: rule.id, tr: rule.tr || rule.name || rule.id, en: rule.en || rule.name || rule.id,
        questionTr: rule.questionTr || rule.name || rule.id,
        questionEn: rule.questionEn || rule.name || rule.id,
        builtIn: false, raw: rule,
      });
    });
    return list;
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
    const s = assistantState(), Checklist = root.BLCpChecklistEngine, Rules = root.BLCpRulesEngine;
    if (!s || !Checklist || !Rules) return true;
    if (item.builtIn) {
      const config = s.checklistSettings && s.checklistSettings.items && s.checklistSettings.items[item.id];
      return Boolean(config && Checklist.itemApplies(item.raw, config, analysis, s.checklistSettings));
    }
    return Rules.customChecklistItems(analysis, s.rules, {}).some(function (candidate) { return candidate.id === item.id; });
  }

  function answerFor(item, analysis) {
    if (!analysis) return null;
    const s = assistantState(), Checklist = root.BLCpChecklistEngine;
    if (!s || !Checklist) return null;
    const key = Checklist.answerKey(analysis.orderKey, item.id);
    const answer = s.answers && s.answers[key];
    if (answer && !Checklist.answerIsStale(answer, analysis)) return answer;
    if (item.builtIn && root.BLPlmSampleRequests && typeof root.BLPlmSampleRequests.evidenceForAnalysis === 'function') {
      try {
        const evidence = root.BLPlmSampleRequests.evidenceForAnalysis(analysis, item.id);
        if (evidence && evidence.state === 'approved') {
          return { state: 'done', at: evidence.date || '', by: 'PLM', source: 'plm' };
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
        type: 'text',
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

    if (rows.length && items.length) {
      const decision = analysesForRows(rows);
      rows.forEach(function (row) {
        const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
        items.forEach(function (item) {
          const key = columnKey(item.id);
          if (!itemApplies(item, analysis)) { row[key] = ''; return; }
          const answer = answerFor(item, analysis);
          row[key] = answer ? statusLabel(answer.state) : statusLabel('open');
        });
      });
    }
    if (opts.render && typeof root.renderCP === 'function') root.renderCP();
    return true;
  }

  function refreshAssistantView() {
    const assistant = root.BLCpAssistant, s = assistantState();
    if (!assistant || !s) return;
    try {
      const rows = currentRows();
      if (rows.length && typeof assistant.onOverviewRendered === 'function') {
        assistant.onOverviewRendered(rows, {
          dataRevision: Date.now(),
          filterRevision: 'checklist-supplier:' + String(state.shared.revision || 0),
        });
      } else if (typeof assistant.render === 'function') assistant.render();
    } catch (_) {}
    refreshColumns({ render: false });
  }

  async function loadShared(force) {
    if (state.loading && !force) return state.loading;
    state.loading = (async function () {
      const assistant = await ensureAssistant();
      if (!assistant) return null;
      const payload = await jsonFetch(API, { cache: 'no-store' });
      state.shared = {
        definitions: safeJson(payload.definitions || []),
        answers: safeJson(payload.answers || {}),
        tombstones: safeJson(payload.tombstones || {}),
        revision: Number(payload.revision) || 0,
        updatedAt: payload.updatedAt || '',
      };

      const localDefs = customDefinitions();
      if (!state.shared.definitions.length && localDefs.length) {
        await syncDefinitions();
      } else {
        mergeRemoteDefinitions(state.shared.definitions);
      }
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
        if (!parts.orderKey || !parts.itemId || !normalized || normalized === 'open') return;
        promote.push({
          orderKey: parts.orderKey, itemId: parts.itemId, state: normalized,
          at: localAt || isoNow(), baseAt: remoteAt,
          loadDate: localAnswer.loadDate || null, note: localAnswer.note || '',
          source: localAnswer.source || 'buyer_log',
        });
      });
      if (promote.length) {
        try { await post('/answers', { entries: promote, source: 'buyer_log' }); }
        catch (_) { /* local answer remains intact; next explicit change retries */ }
      }
      state.answerBaseline = snapshotAnswers();
      refreshAssistantView();
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
      const value = visibleValue(row, ['Manufacturer', 'Üretici', 'Sub-Manufacturer', 'Supplier']);
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

  async function exportWorkbook() {
    await loadShared();
    const rows = selectedRows();
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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Buyer Log';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(DATA_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
    const decision = analysesForRows(rows);
    const exportedAt = isoNow();

    const columns = [
      { header: 'Order Code', key: 'order', width: 16 },
      { header: 'PLM ID', key: 'plm', width: 14 },
      { header: T('Model Adı', 'Model Name'), key: 'model', width: 24 },
      { header: T('Renk Kodu', 'Colour Code'), key: 'colour', width: 14 },
      { header: T('Üretici', 'Supplier'), key: 'supplier', width: 24 },
      { header: 'Ex-Factory', key: 'exfactory', width: 14 },
    ];
    items.forEach(function (item, index) {
      columns.push({ header: isEn() ? item.en : item.tr, key: 's' + index, width: 20 });
      columns.push({ header: (isEn() ? item.en : item.tr) + ' - ' + T('Not', 'Note'), key: 'n' + index, width: 30 });
    });
    columns.push({ header: '__BL_ORDER_KEY', key: '__orderKey', width: 4, hidden: true });
    columns.push({ header: '__BL_LOAD_DATE', key: '__loadDate', width: 4, hidden: true });
    sheet.columns = columns;
    sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(columns.length).address };

    const optionValues = statusOptions();
    rows.forEach(function (row) {
      const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
      const values = {
        order: visibleValue(row, ['Order Code', 'ORDER CODE', 'OrderCode']),
        plm: visibleValue(row, ['PLM ID', 'PLM', 'PLM Id']),
        model: visibleValue(row, ['Model Name', 'MODEL NAME', 'Model']),
        colour: visibleValue(row, ['C.Code', 'Colour Code', 'Color Code', 'Renk Kodu']),
        supplier: visibleValue(row, ['Manufacturer', 'Üretici', 'Sub-Manufacturer', 'Supplier']),
        exfactory: visibleValue(row, ['Ex-factory', 'Ex-Factory', 'EX FACTORY']),
        __orderKey: analysis && analysis.orderKey || '',
        __loadDate: analysis && analysis.plannedLoadDate || '',
      };
      items.forEach(function (item, index) {
        if (!analysis || !itemApplies(item, analysis)) {
          values['s' + index] = '';
          values['n' + index] = '';
          return;
        }
        const answer = answerFor(item, analysis);
        values['s' + index] = answer ? statusLabel(answer.state) : statusLabel('open');
        values['n' + index] = answer && answer.note || '';
      });
      const excelRow = sheet.addRow(values);
      items.forEach(function (_item, index) {
        const statusColumn = 7 + (index * 2);
        excelRow.getCell(statusColumn).dataValidation = {
          type: 'list', allowBlank: true,
          formulae: ['"' + optionValues.join(',') + '"'],
          showErrorMessage: true,
          errorTitle: T('Geçersiz durum', 'Invalid status'),
          error: optionValues.join(' / '),
        };
      });
    });
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    sheet.eachRow({ includeEmpty: false }, function (row, rowNo) {
      if (rowNo > 1) row.alignment = { vertical: 'middle', wrapText: true };
    });
    const technicalStart = columns.length - 1;
    sheet.getColumn(technicalStart).hidden = true;
    sheet.getColumn(technicalStart + 1).hidden = true;

    const meta = workbook.addWorksheet(META_SHEET);
    meta.state = 'veryHidden';
    meta.addRow(['BUYER_LOG_CHECKLIST_SUPPLIER', SCHEMA_VERSION]);
    meta.addRow(['exportedAt', exportedAt]);
    meta.addRow(['supplier', supplierNameFor(rows)]);
    meta.addRow(['statusColumn', 'noteColumn', 'itemId', 'tr', 'en', 'questionTr', 'questionEn']);
    items.forEach(function (item, index) {
      meta.addRow([7 + index * 2, 8 + index * 2, item.id, item.tr, item.en, item.questionTr, item.questionEn]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBuffer(buffer, 'BuyerLog_Checklist_' + safeFilePart(supplierNameFor(rows)) + '_' + stamp + '.xlsx');
    toast(T('Üretici checklist Excel’i oluşturuldu.', 'Supplier checklist workbook created.'));
    return true;
  }

  function readMeta(workbook) {
    const meta = workbook.getWorksheet(META_SHEET);
    if (!meta || text(meta.getCell('A1').text) !== 'BUYER_LOG_CHECKLIST_SUPPLIER') {
      throw new Error(T('Bu dosya Buyer Log üretici checklist şablonu değil.', 'This is not a Buyer Log supplier checklist workbook.'));
    }
    const version = Number(meta.getCell('B1').value) || 0;
    if (version !== SCHEMA_VERSION) throw new Error(T('Checklist Excel şablon sürümü desteklenmiyor.', 'Checklist workbook schema version is not supported.'));
    const exportedAt = text(meta.getCell('B2').text || meta.getCell('B2').value);
    const items = [];
    for (let rowNo = 5; rowNo <= meta.rowCount; rowNo += 1) {
      const row = meta.getRow(rowNo);
      const itemId = text(row.getCell(3).text || row.getCell(3).value);
      if (!itemId) continue;
      items.push({
        statusColumn: Number(row.getCell(1).value) || 0,
        noteColumn: Number(row.getCell(2).value) || 0,
        id: itemId,
        tr: text(row.getCell(4).text || row.getCell(4).value),
        en: text(row.getCell(5).text || row.getCell(5).value),
      });
    }
    return { exportedAt: exportedAt, items: items };
  }

  function headerIndex(sheet, label) {
    const target = text(label);
    for (let col = 1; col <= sheet.columnCount; col += 1) {
      if (text(sheet.getRow(1).getCell(col).text) === target) return col;
    }
    return 0;
  }

  async function importWorkbook(file) {
    if (!file) return false;
    await loadShared();
    const ExcelJS = await ensureExcel();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const meta = readMeta(workbook);
    const sheet = workbook.getWorksheet(DATA_SHEET) || workbook.worksheets.find(function (ws) { return ws.state === 'visible'; });
    if (!sheet) throw new Error(T('Checklist sayfası bulunamadı.', 'Checklist sheet was not found.'));

    const orderKeyCol = headerIndex(sheet, '__BL_ORDER_KEY');
    const loadDateCol = headerIndex(sheet, '__BL_LOAD_DATE');
    const supplierCol = headerIndex(sheet, T('Üretici', 'Supplier')) || headerIndex(sheet, 'Supplier') || headerIndex(sheet, 'Üretici');
    if (!orderKeyCol) throw new Error(T('Buyer Log eşleşme anahtarı bulunamadı.', 'Buyer Log match key is missing.'));

    const liveRows = currentRows(), liveDecision = analysesForRows(liveRows);
    const liveByOrder = liveDecision.byOrderKey || new Map();
    const catalog = new Map(itemCatalog().map(function (item) { return [item.id, item]; }));
    const entries = [];
    let blank = 0, invalid = 0, notApplicable = 0, formulaCells = 0;
    const importedAt = isoNow();

    for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
      const row = sheet.getRow(rowNo);
      const orderKey = text(row.getCell(orderKeyCol).text || row.getCell(orderKeyCol).value);
      if (!orderKey) continue;
      const loadDate = loadDateCol ? text(row.getCell(loadDateCol).text || row.getCell(loadDateCol).value) : '';
      const supplier = supplierCol ? text(row.getCell(supplierCol).text || row.getCell(supplierCol).value) : '';
      const analysis = liveByOrder && liveByOrder.get ? liveByOrder.get(orderKey) : null;

      meta.items.forEach(function (metaItem) {
        const cell = row.getCell(metaItem.statusColumn);
        if (cell.value && typeof cell.value === 'object' && Object.prototype.hasOwnProperty.call(cell.value, 'formula')) {
          formulaCells += 1; return;
        }
        const raw = text(cell.text || cell.value);
        if (!raw) { blank += 1; return; }
        const nextState = normalizeState(raw);
        if (!nextState) { invalid += 1; return; }
        const item = catalog.get(metaItem.id);
        if (!item) { invalid += 1; return; }
        if (analysis && !itemApplies(item, analysis)) { notApplicable += 1; return; }
        const noteCell = metaItem.noteColumn ? row.getCell(metaItem.noteColumn) : null;
        entries.push({
          orderKey: orderKey,
          itemId: metaItem.id,
          itemLabel: isEn() ? item.en : item.tr,
          state: nextState,
          at: importedAt,
          baseAt: meta.exportedAt || '',
          loadDate: loadDate || null,
          note: noteCell ? text(noteCell.text || noteCell.value) : '',
          supplier: supplier,
          source: 'supplier_excel',
        });
      });
    }

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
    toast(T(
      'Checklist içe aktarıldı: ' + result.updated + ' güncellendi, ' + result.cleared + ' yeniden açıldı' + (conflicts ? ', ' + conflicts + ' daha yeni Buyer Log verisi nedeniyle korunarak atlandı' : '') + (skipped ? ', ' + skipped + ' geçersiz/uygunsuz kayıt atlandı.' : '.'),
      'Checklist imported: ' + result.updated + ' updated, ' + result.cleared + ' reopened' + (conflicts ? ', ' + conflicts + ' kept because Buyer Log had newer data' : '') + (skipped ? ', ' + skipped + ' invalid/not-applicable entries skipped.' : '.')
    ));
    return true;
  }

  function ensureUi() {
    const menu = root.document && root.document.getElementById('cpToolsMenu');
    if (!menu || root.document.getElementById('cpSupplierChecklistExportBtn')) return;
    const exportBtn = root.document.createElement('button');
    exportBtn.type = 'button'; exportBtn.className = 'tbtn'; exportBtn.id = 'cpSupplierChecklistExportBtn';
    exportBtn.innerHTML = '<svg class="ic"><use href="#i-file-export"/></svg><span>' + T('Üretici Checklist Excel’i Oluştur', 'Create Supplier Checklist Excel') + '</span>';
    exportBtn.title = T('Seçili CP siparişlerini aktif checklist başlıklarıyla üretici Excel’ine aktar', 'Export selected CP orders with active checklist headings to a supplier workbook');

    const importBtn = root.document.createElement('button');
    importBtn.type = 'button'; importBtn.className = 'tbtn'; importBtn.id = 'cpSupplierChecklistImportBtn';
    importBtn.innerHTML = '<svg class="ic"><use href="#i-file-import"/></svg><span>' + T('Üretici Checklist Excel’ini İçeri Aktar', 'Import Supplier Checklist Excel') + '</span>';
    importBtn.title = T('Üreticinin doldurduğu Buyer Log checklist Excel’ini içeri aktar', 'Import a Buyer Log checklist workbook completed by the supplier');

    const input = root.document.createElement('input');
    input.type = 'file'; input.id = 'cpSupplierChecklistImportFile'; input.accept = '.xlsx,.xlsm'; input.hidden = true;
    menu.appendChild(exportBtn); menu.appendChild(importBtn); menu.appendChild(input);

    exportBtn.addEventListener('click', function () {
      exportWorkbook().catch(function (error) { toast(T('Checklist Excel oluşturulamadı: ', 'Checklist workbook could not be created: ') + (error.message || error)); });
    });
    importBtn.addEventListener('click', function () { input.value = ''; input.click(); });
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      importWorkbook(file).catch(function (error) { toast(T('Checklist Excel içe aktarılamadı: ', 'Checklist workbook could not be imported: ') + (error.message || error)); });
    });
  }

  function wrapRender() {
    if (state.renderWrapped || typeof root.renderCP !== 'function') return;
    const original = root.renderCP;
    root.renderCP = function () {
      if (root.BLCpAssistant) {
        try { refreshColumns({ render: false }); } catch (_) {}
      }
      return original.apply(this, arguments);
    };
    state.renderWrapped = true;
  }

  function onDecisionChanged(event) {
    if (state.applyingRemote) return;
    const reason = event && event.detail && event.detail.reason || '';
    if (reason === 'preferences') {
      syncDefinitions().then(function () { refreshColumns({ render: true }); }).catch(function (error) {
        toast(T('Checklist başlıkları senkronize edilemedi: ', 'Checklist headings could not be synced: ') + (error.message || error));
      });
      return;
    }
    if (reason === 'checklist-answer') {
      syncAnswerChanges().then(function () { refreshColumns({ render: true }); }).catch(function (error) {
        toast(T('Checklist cevabı senkronize edilemedi: ', 'Checklist answer could not be synced: ') + (error.message || error));
      });
    }
  }

  function activeNeedsRuntime() {
    const active = root.document && root.document.querySelector('nav.tabs button.active[data-tab]');
    const tab = active && active.dataset ? String(active.dataset.tab || '') : '';
    return tab === 'cp' || tab === 'overview';
  }

  async function startRuntime() {
    if (!activeNeedsRuntime()) { ensureUi(); wrapRender(); return; }
    ensureUi();
    wrapRender();
    await loadShared();
    refreshColumns({ render: true });
  }

  function init() {
    if (state.started || !root.document) return;
    state.started = true;
    ensureUi();
    wrapRender();
    root.addEventListener('bl:cp-decision-context-changed', onDecisionChanged);
    root.addEventListener('bl:plm-requests-changed', function () { refreshColumns({ render: true }); });
    root.addEventListener('bl:startup-ready', function () {
      if (activeNeedsRuntime()) startRuntime().catch(function () {});
    });
    root.addEventListener('bl:user-access-applied', function () { ensureUi(); });
    root.document.addEventListener('click', function (event) {
      const tab = event.target && event.target.closest && event.target.closest('nav.tabs button[data-tab]');
      if (tab && (tab.dataset.tab === 'cp' || tab.dataset.tab === 'overview')) {
        setTimeout(function () { startRuntime().catch(function () {}); }, 0);
      }
    });
    if ((root.document.readyState === 'complete' || root.document.readyState === 'interactive') && activeNeedsRuntime()) {
      startRuntime().catch(function () {});
    }
  }

  return {
    init: init,
    loadShared: loadShared,
    refreshColumns: refreshColumns,
    exportWorkbook: exportWorkbook,
    importWorkbook: importWorkbook,
    normalizeState: normalizeState,
    diffAnswers: diffAnswers,
    columnKey: columnKey,
    _state: state,
  };
}));
