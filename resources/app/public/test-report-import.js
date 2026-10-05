/* Buyer Log — TEST RAPORU AKTARIMI (sürükle-bırak → önizleme → onay)
 *
 * Test sonuç maillerini (.msg/.eml) ve rapor PDF'lerini okur (sunucu),
 * CP satırıyla eşler (BLTestReports, deterministik), checklist adımında ne
 * değişeceğini gösterir ve YALNIZ kullanıcı onayıyla yazar.
 *
 *  - Hiçbir şey sessizce yazılmaz: eşleşme düzeyi, eşleşmeyen dosyalar ve
 *    uyarı sayıları önizlemede görünür.
 *  - Talep tipinin karşılığı yoksa kullanıcı adımı seçer ya da yeni adım
 *    açar; seçim sonraki aktarımlar için saklanır.
 *  - Öncelik kullanıcının girişindedir: elle verilmiş bir durum raporla
 *    ezilmez (önizlemede açıkça "Raporla güncelle" seçilmedikçe).
 *  - Yazma, satır düzenleme yetkisinden geçer (row._canEdit).
 */
(function (root) {
  'use strict';

  const API = '/api/test-reports';
  const ACCEPT = /\.(msg|eml|pdf)$/i;
  const NEW_ITEM = '__new__';
  const MAX_ATTACHMENTS = 40;
  const ui = { modal: null, busy: false, session: null, store: null, entries: [], files: [], typeMap: {}, newTypeMap: {}, decision: null, done: null };

  function isEn() { return String((root.document && root.document.documentElement.lang) || root.appLang || 'tr').toLowerCase().startsWith('en'); }
  function T(tr, en) { return isEn() ? en : tr; }
  function lang() { return isEn() ? 'en' : 'tr'; }
  function html(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function toast(message) { if (typeof root.showToast === 'function') root.showToast(message); }
  function E() { return root.BLTestReports; }
  function Checklist() { return root.BLCpChecklistEngine; }
  function assistant() { return root.BLCpAssistant; }
  function assistantState() { const a = assistant(); return a && a._state ? a._state : null; }
  function answerKey(orderKey, itemId) { return text(orderKey) + '::' + text(itemId); }

  async function ensureDeps() {
    if (root.BLPerf && typeof root.BLPerf.ensureFeature === 'function') await root.BLPerf.ensureFeature('cpAssistant');
    if (!E() || !assistant() || typeof assistant().computeDecisionsForRows !== 'function') {
      throw new Error(T('Test raporu motoru yüklenemedi.', 'The test report engine could not be loaded.'));
    }
  }

  function fileBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { const v = String(reader.result || ''); resolve(v.indexOf(',') >= 0 ? v.slice(v.indexOf(',') + 1) : v); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  async function jsonFetch(url, options) {
    const response = await root.fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
    let payload = null;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      const code = payload && payload.code;
      const known = {
        TEST_REPORT_SESSION_EXPIRED: T('Önizleme süresi doldu; dosyaları yeniden bırakın.', 'The preview expired; drop the files again.'),
        TEST_REPORT_TOO_MANY_FILES: T('Tek seferde en fazla 30 dosya bırakılabilir.', 'Up to 30 files can be dropped at once.'),
        TEST_REPORT_FILE_SIZE: T('Dosya boş ya da 40 MB sınırını aşıyor.', 'The file is empty or exceeds the 40 MB limit.'),
      };
      throw new Error(known[code] || (payload && payload.error) || (T('İstek başarısız: ', 'Request failed: ') + response.status));
    }
    return payload;
  }

  /* ---------------------------------------------------- CP bağlamı */
  function cpRows() {
    const rows = root.state && root.state.cp && Array.isArray(root.state.cp.rows) ? root.state.cp.rows : null;
    if (rows && rows.length) return rows;
    try { if (root.BLFormulaRows && typeof root.BLFormulaRows.cp === 'function') return root.BLFormulaRows.cp() || []; } catch (_) {}
    return [];
  }
  function catalog() {
    const s = assistantState();
    return (s && Array.isArray(s.rules) ? s.rules : [])
      .filter(function (rule) { return rule && rule.kind === 'checklist' && rule.enabled !== false; })
      .map(function (rule) { return { id: rule.id, tr: rule.tr || rule.name || rule.id, en: rule.en || rule.nameEn || rule.name || rule.id }; });
  }
  function itemLabel(itemId) {
    const item = catalog().find(function (entry) { return entry.id === itemId; });
    return item ? (isEn() ? item.en : item.tr) : itemId;
  }
  function value(row, keys) {
    for (const key of keys) if (row && row[key] != null && text(row[key])) return text(row[key]);
    return '';
  }
  function rowLabel(row) {
    return [value(row, ['Order Code']), value(row, ['Model Name']), value(row, ['Colour']) || value(row, ['C.Code'])].filter(Boolean).join(' · ');
  }
  function statusText(state) {
    const engine = Checklist();
    return engine ? engine.statusLabel(state || 'open', lang()) : state;
  }

  /* ------------------------------------------------------- önizleme */
  function buildEntries(reports) {
    const rows = cpRows();
    const decision = assistant().computeDecisionsForRows(rows);
    ui.decision = decision;
    const keyOf = function (row) {
      const analysis = decision.byRow && decision.byRow.get ? decision.byRow.get(row) : null;
      return analysis ? analysis.orderKey : '';
    };
    const store = ui.store || { reports: {}, links: {}, typeMap: {} };
    return reports.map(function (report, index) {
      const match = report.talepNo ? E().matchReport(report, rows, { keyOf: keyOf }) : { level: 'none', reason: 'talep', candidates: [] };
      const candidates = match.candidates.filter(function (c) { return c.key; });
      const link = report.talepNo ? store.links[report.talepNo] : null;
      let chosen = '';
      // Daha önce bağlanmış talep aynı satıra gider; yeniden sorulmaz.
      if (link && candidates.some(function (c) { return c.key === link.orderKey; })) chosen = link.orderKey;
      else if (candidates.length === 1 && (match.level === 'exact' || match.level === 'partial')) chosen = candidates[0].key;
      const typeKey = E().talepTipiKey(report.talepTipi);
      const mapped = (link && link.itemId) || (store.typeMap[typeKey] && store.typeMap[typeKey].itemId) || ui.newTypeMap[typeKey] || '';
      return {
        id: 'r' + index, report: report, match: match, candidates: candidates, chosen: chosen,
        typeKey: typeKey, itemId: mapped && catalog().some(function (i) { return i.id === mapped; }) ? mapped : '',
        include: Boolean(chosen), override: false, linked: Boolean(link),
      };
    });
  }
  function rowFor(entry) {
    const candidate = entry.candidates.find(function (c) { return c.key === entry.chosen; });
    return candidate ? candidate.row : null;
  }
  function analysisFor(row) {
    const d = ui.decision;
    return row && d && d.byRow && d.byRow.get ? d.byRow.get(row) : null;
  }
  // Satır + adım için bütün raporlar: depodakiler + bu önizlemede seçilenler.
  function groupReports(orderKey, itemId) {
    const store = ui.store || { reports: {}, links: {} };
    const map = new Map();
    Object.keys(store.links).forEach(function (talepNo) {
      const link = store.links[talepNo];
      if (link && link.orderKey === orderKey && link.itemId === itemId && store.reports[talepNo]) map.set(talepNo, store.reports[talepNo]);
    });
    ui.entries.forEach(function (entry) {
      if (!entry.include || entry.chosen !== orderKey || entry.itemId !== itemId || !entry.report.talepNo) return;
      map.set(entry.report.talepNo, E().mergeReports(map.get(entry.report.talepNo), entry.report));
    });
    return [...map.values()];
  }
  function plan(entry) {
    const out = { ready: false, reason: '', current: 'open', next: '', userOwned: false, notAsked: false, step: null, skippedDecisions: 0 };
    const store = ui.store || { reports: {} };
    const stored = entry.report.talepNo ? store.reports[entry.report.talepNo] : null;
    if (stored) {
      const known = new Set((stored.kararlar || []).map(function (d) { return E().decisionKey(d, stored.talepNo); }));
      out.skippedDecisions = (entry.report.kararlar || []).filter(function (d) { return known.has(E().decisionKey(d, stored.talepNo)); }).length;
    }
    if (!entry.report.talepNo) { out.reason = T('Talep no okunamadı.', 'No request number was read.'); return out; }
    const row = rowFor(entry);
    if (!row) { out.reason = entry.candidates.length ? T('Satır seçin.', 'Choose a row.') : T('CP satırı bulunamadı.', 'No CP row was found.'); return out; }
    if (row._canEdit === false) { out.reason = T('Bu satır için düzenleme yetkiniz yok.', 'You do not have edit access to this row.'); return out; }
    if (!entry.itemId) { out.reason = T('Checklist adımı seçin.', 'Choose a checklist step.'); return out; }
    const analysis = analysisFor(row);
    if (!analysis) { out.reason = T('Sipariş checklist için okunamadı.', 'The order could not be read for the checklist.'); return out; }
    const s = assistantState();
    const answer = s && s.answers ? s.answers[answerKey(analysis.orderKey, entry.itemId)] : null;
    const engine = Checklist();
    const current = engine && answer ? (engine.normalizeStatus(answer.state) || 'open') : 'open';
    out.current = current;
    out.userOwned = Boolean(answer && answer.source !== 'test_report' && current !== 'open');
    out.step = E().deriveStepStatus(groupReports(entry.chosen, entry.itemId));
    out.next = out.userOwned && !entry.override ? current : (out.step.state || current);
    out.notAsked = Array.isArray(analysis.checklistItemIds) && analysis.checklistItemIds.indexOf(entry.itemId) < 0;
    out.ready = true;
    return out;
  }

  /* -------------------------------------------------------- çizim */
  function levelBadge(entry) {
    const map = {
      exact: { tone: 'green', tr: 'Tam eşleşme', en: 'Exact match' },
      partial: { tone: 'orange', tr: 'Kısmi eşleşme', en: 'Partial match' },
      ambiguous: { tone: 'orange', tr: 'Belirsiz', en: 'Ambiguous' },
      none: { tone: 'red', tr: 'Eşleşmedi', en: 'Not matched' },
    };
    const level = entry.linked && entry.chosen ? { tone: 'blue', tr: 'Önceki bağlantı', en: 'Previous link' } : map[entry.match.level] || map.none;
    const reasons = {
      order: T('Sipariş kodu CP\'de yok.', 'Order code is not in CP.'),
      model: T('Model adı tutmadı.', 'Model name did not match.'),
      colour: T('Renk tanımı tutmadı.', 'Colour description did not match.'),
      multiple: T('Birden çok satır uyuyor.', 'Several rows fit.'),
      modelPartial: T('Model adı kısmi eşleşti.', 'Model name matched partially.'),
      colourCode: T('Renk, renk koduyla eşleşti.', 'Colour matched by colour code.'),
      talep: T('Talep no yok.', 'No request number.'),
    };
    const reason = reasons[entry.match.reason] || '';
    return '<span class="trBadge tone-' + level.tone + '" title="' + html(reason) + '">' + html(isEn() ? level.en : level.tr) + '</span>' + (reason ? '<small>' + html(reason) + '</small>' : '');
  }
  function resultBadge(report) {
    const outcome = E().reportOutcome(report);
    const tone = outcome.code === 'pass' ? 'green' : outcome.code === 'fail' ? 'red' : 'orange';
    const raw = report.genelSonuc ? E().resultLabel(report.genelSonuc, lang()) : '';
    const decision = (report.kararlar || []).length ? E().resultLabel(report.kararlar[report.kararlar.length - 1].karar, lang()) : '';
    const label = raw || decision || T('Sonuç yok', 'No result');
    return '<span class="trBadge tone-' + tone + '">' + html(label) + '</span>' + (raw && decision ? '<small>' + html(decision) + '</small>' : '');
  }
  function rowCell(entry) {
    if (!entry.candidates.length) return '<span class="trMuted">—</span>';
    if (entry.candidates.length === 1 && entry.chosen) return html(rowLabel(entry.candidates[0].row));
    return '<select data-tr-row="' + entry.id + '"><option value="">' + html(T('Satır seçin…', 'Choose a row…')) + '</option>'
      + entry.candidates.map(function (c) { return '<option value="' + html(c.key) + '"' + (c.key === entry.chosen ? ' selected' : '') + '>' + html(rowLabel(c.row)) + '</option>'; }).join('') + '</select>';
  }
  function itemOptions(selected) {
    return '<option value="">' + html(T('Adım seçin…', 'Choose a step…')) + '</option>'
      + catalog().map(function (item) { return '<option value="' + html(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' + html(isEn() ? item.en : item.tr) + '</option>'; }).join('')
      + '<option value="' + NEW_ITEM + '">' + html(T('+ Yeni checklist adımı oluştur…', '+ Create a new checklist step…')) + '</option>';
  }
  function changeCell(entry, p) {
    if (!p.ready) return '<span class="trMuted">' + html(p.reason) + '</span>';
    let out = '<b>' + html(statusText(p.current)) + '</b> → <b>' + html(statusText(p.next)) + '</b>';
    if (p.userOwned) {
      out += '<small>' + html(T('Kullanıcı girişi öncelikli; durum korunur.', 'The user entry has priority; the status is kept.')) + '</small>'
        + '<label class="trInline"><input type="checkbox" data-tr-override="' + entry.id + '"' + (entry.override ? ' checked' : '') + '> ' + html(T('Raporlara göre güncelle', 'Update from reports')) + '</label>';
    }
    if (p.step && p.step.outcomes.length > 1) out += '<small>' + html(T('Satırdaki ' + p.step.outcomes.length + ' rapordan türetildi.', 'Derived from ' + p.step.outcomes.length + ' reports on the row.')) + '</small>';
    if (p.step && p.step.superseded.length) out += '<small>' + html(T('Tekrar testle geçersiz: ', 'Replaced by retest: ') + p.step.superseded.join(', ')) + '</small>';
    if (p.notAsked) out += '<small>' + html(T('Bu adım bu siparişte şu an sorulmuyor; durum saklanır ve soru geldiğinde görünür.', 'This step is not asked for this order yet; the status is stored and shows once it is asked.')) + '</small>';
    return out;
  }
  function warningsCell(entry, p) {
    const list = (entry.report.uyarilar || []).map(function (w) { return E().warningText(w, lang()); });
    if (p.skippedDecisions) list.push(E().warningText({ code: 'decisionAlreadyApplied' }, lang()) + ' (' + p.skippedDecisions + ')');
    const tasks = p.step ? p.step.tasks.filter(function (t) { return t.talepNo === entry.report.talepNo; }) : E().reportOutcome(entry.report).tasks;
    tasks.forEach(function (t) { list.push(T('Buying dönüşü bekleniyor: ', 'Awaiting buying feedback: ') + t.test + (t.aciklama ? ' — ' + t.aciklama : '')); });
    if (!list.length) return '<span class="trMuted">—</span>';
    return '<ul class="trWarnings">' + list.map(function (w) { return '<li>' + html(w) + '</li>'; }).join('') + '</ul>';
  }
  function filesCell(report) {
    return (report.dosyalar || []).map(function (f) { return '<div class="trFile" title="' + html(f.ad) + '">' + html(f.ad) + '</div>'; }).join('') || '<span class="trMuted">—</span>';
  }
  function typeMappingHtml() {
    const pending = new Map();
    ui.entries.forEach(function (entry) { if (!entry.itemId && entry.typeKey && !pending.has(entry.typeKey)) pending.set(entry.typeKey, entry.report.talepTipi); });
    if (!pending.size) return '';
    return '<section class="trTypes"><b>' + html(T('Buyer Log\'da karşılığı olmayan talep tipleri', 'Request types without a Buyer Log step')) + '</b>'
      + [...pending.entries()].map(function (pair) {
        const key = pair[0], label = pair[1] || key;
        const parts = String(label).split(' / ');
        return '<div class="trTypeRow" data-tr-type="' + html(key) + '"><span>' + html(T('"' + parts[0] + '" hangi checklist adımına girilsin?', 'Which checklist step should "' + (parts[1] || parts[0]) + '" go to?')) + '</span>'
          + '<select data-tr-type-select="' + html(key) + '">' + itemOptions('') + '</select>'
          + '<span class="trNewItem" hidden><input type="text" data-tr-new-tr maxlength="160" value="' + html(parts[0]) + '" placeholder="' + html(T('Adım adı (Türkçe)', 'Step name (Turkish)')) + '">'
          + '<input type="text" data-tr-new-en maxlength="160" value="' + html(parts[1] || parts[0]) + '" placeholder="' + html(T('Adım adı (İngilizce)', 'Step name (English)')) + '">'
          + '<button type="button" class="cpaBtn sm" data-tr-create="' + html(key) + '">' + html(T('Oluştur', 'Create')) + '</button></span></div>';
      }).join('') + '</section>';
  }
  function summaryHtml(plans) {
    const count = function (fn) { return ui.entries.filter(fn).length; };
    const warnings = ui.entries.reduce(function (n, e) { return n + (e.report.uyarilar || []).length; }, 0)
      + ui.files.reduce(function (n, f) { return n + (f.warnings || []).length; }, 0);
    const chips = [
      [T('Dosya', 'Files'), ui.files.length, ''],
      [T('Rapor', 'Reports'), ui.entries.length, ''],
      [T('Tam eşleşme', 'Exact'), count(function (e) { return e.match.level === 'exact'; }), 'green'],
      [T('Kısmi', 'Partial'), count(function (e) { return e.match.level === 'partial'; }), 'orange'],
      [T('Belirsiz', 'Ambiguous'), count(function (e) { return e.match.level === 'ambiguous'; }), 'orange'],
      [T('Eşleşmedi', 'Not matched'), count(function (e) { return e.match.level === 'none'; }), 'red'],
      [T('Uyarı', 'Warnings'), warnings, warnings ? 'orange' : ''],
      [T('Yazılacak', 'To write'), plans.filter(function (p, i) { return p.ready && ui.entries[i].include; }).length, 'blue'],
    ];
    return '<div class="trChips">' + chips.map(function (c) { return '<span class="cpaChip is-static' + (c[2] ? ' tone-' + c[2] : '') + '"><span class="n">' + c[1] + '</span><span class="l">' + html(c[0]) + '</span></span>'; }).join('') + '</div>';
  }
  function fileIssuesHtml() {
    const issues = ui.files.filter(function (f) { return f.status !== 'parsed' || (f.warnings || []).length; });
    if (!issues.length) return '';
    return '<section class="trIssues"><b>' + html(T('Okunamayan / tanınmayan dosyalar', 'Unread / unrecognised files')) + '</b><ul class="trWarnings">'
      + issues.map(function (f) {
        const reasons = (f.warnings || []).map(function (w) {
          if (w.code === 'unsupported') return T('Desteklenmeyen dosya türü.', 'Unsupported file type.');
          if (w.code === 'readError') return T('Dosya okunamadı.', 'The file could not be read.');
          return E().warningText(w, lang());
        });
        return '<li><b>' + html(f.name) + '</b> — ' + html(reasons.join(' ') || T('Tanınmadı.', 'Not recognised.')) + '</li>';
      }).join('') + '</ul></section>';
  }
  function render() {
    if (!ui.modal) return;
    const body = ui.modal.querySelector('[data-tr-body]');
    const footer = ui.modal.querySelector('[data-tr-commit]');
    if (ui.done) {
      body.innerHTML = '<div class="trDone"><b>' + html(T('Aktarım tamamlandı', 'Import complete')) + '</b><ul class="trWarnings">' + ui.done.map(function (line) { return '<li>' + html(line) + '</li>'; }).join('') + '</ul></div>';
      footer.hidden = true;
      return;
    }
    const drop = '<label class="trDrop" data-tr-drop><input type="file" data-tr-input multiple accept=".msg,.eml,.pdf" hidden>'
      + '<b>' + html(T('Test sonuç maillerini ve rapor PDF\'lerini buraya bırakın', 'Drop test result e-mails and report PDFs here')) + '</b>'
      + '<small>' + html(T('.msg, .eml ve .pdf · Outlook\'tan sürükleme dosya üretmezse maili .msg olarak kaydedip bırakın · ya da dosya seçmek için tıklayın', '.msg, .eml and .pdf · If dragging from Outlook gives no file, save the mail as .msg and drop it · or click to choose files')) + '</small></label>';
    if (ui.busy) {
      body.innerHTML = drop + '<p class="trMuted" role="status">' + html(T('Dosyalar okunuyor…', 'Reading files…')) + '</p>';
      footer.disabled = true;
      return;
    }
    if (!ui.session) { body.innerHTML = drop; footer.disabled = true; return; }
    const plans = ui.entries.map(plan);
    const rowsHtml = ui.entries.map(function (entry, index) {
      const p = plans[index], r = entry.report;
      return '<tr class="' + (p.ready ? '' : 'is-blocked') + '">'
        + '<td><input type="checkbox" data-tr-include="' + entry.id + '"' + (entry.include && p.ready ? ' checked' : '') + (p.ready ? '' : ' disabled') + ' aria-label="' + html(T('Bu raporu yaz', 'Write this report')) + '"></td>'
        + '<td><b>' + html(r.talepNo || '—') + '</b><small>' + html(r.talepTipi || '') + '</small><small>' + html([r.siparisKodu, r.modelAdi, r.renk].filter(Boolean).join(' · ')) + '</small></td>'
        + '<td>' + resultBadge(r) + '</td>'
        + '<td>' + levelBadge(entry) + '</td>'
        + '<td>' + rowCell(entry) + '</td>'
        + '<td><select data-tr-item="' + entry.id + '">' + itemOptions(entry.itemId) + '</select></td>'
        + '<td>' + changeCell(entry, p) + '</td>'
        + '<td>' + filesCell(r) + '</td>'
        + '<td>' + warningsCell(entry, p) + '</td></tr>';
    }).join('');
    body.innerHTML = drop + summaryHtml(plans) + fileIssuesHtml() + typeMappingHtml()
      + (ui.entries.length ? '<div class="trTableWrap"><table class="cpaTable trTable"><thead><tr><th></th><th>' + html(T('Talep', 'Request')) + '</th><th>' + html(T('Sonuç', 'Result')) + '</th><th>' + html(T('Eşleşme', 'Match')) + '</th><th>' + html(T('Satır', 'Row')) + '</th><th>' + html(T('Checklist adımı', 'Checklist step')) + '</th><th>' + html(T('Değişiklik', 'Change')) + '</th><th>' + html(T('Eklenecek dosyalar', 'Files to attach')) + '</th><th>' + html(T('Uyarılar', 'Warnings')) + '</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' : '');
    const ready = plans.filter(function (p, i) { return p.ready && ui.entries[i].include; }).length;
    footer.disabled = !ready;
    footer.textContent = T('Onayla ve yaz', 'Confirm and write') + ' (' + ready + ')';
  }

  /* -------------------------------------------------------- olaylar */
  async function handleFiles(fileList) {
    const all = Array.from(fileList || []);
    const files = all.filter(function (f) { return ACCEPT.test(f.name || ''); });
    const skipped = all.filter(function (f) { return !ACCEPT.test(f.name || ''); });
    if (!files.length) { toast(T('Desteklenen dosya yok (.msg, .eml, .pdf).', 'No supported files (.msg, .eml, .pdf).')); return; }
    ui.busy = true; ui.done = null; render();
    try {
      const payload = { files: [] };
      for (const file of files) payload.files.push({ name: file.name, base64: await fileBase64(file) });
      const responses = await Promise.all([
        jsonFetch(API + '/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        jsonFetch(API),
      ]);
      const parsed = responses[0];
      ui.store = responses[1];
      ui.session = parsed.sessionId;
      ui.files = parsed.files.concat(skipped.map(function (f) { return { name: f.name, status: 'unsupported', warnings: [{ code: 'unsupported' }] }; }));
      ui.newTypeMap = {};
      ui.entries = buildEntries(parsed.reports || []);
    } catch (error) {
      toast(T('Test raporları okunamadı: ', 'Test reports could not be read: ') + (error.message || error));
    } finally {
      ui.busy = false;
      render();
    }
  }

  function setTypeItem(typeKey, itemId) {
    ui.newTypeMap[typeKey] = itemId;
    ui.entries.forEach(function (entry) {
      if (entry.typeKey === typeKey && !entry.itemId) { entry.itemId = itemId; entry.include = Boolean(entry.chosen); }
    });
    render();
  }
  function createItem(typeKey, row) {
    const tr = text(row.querySelector('[data-tr-new-tr]').value);
    const en = text(row.querySelector('[data-tr-new-en]').value) || tr;
    if (!tr) { toast(T('Adım adı boş olamaz.', 'The step name cannot be empty.')); return; }
    try {
      const rule = assistant().createChecklistItem({ tr: tr, en: en });
      if (!rule) throw new Error(T('Adım oluşturulamadı.', 'The step could not be created.'));
      if (root.BLChecklistSupplierSync && typeof root.BLChecklistSupplierSync.refreshColumns === 'function') root.BLChecklistSupplierSync.refreshColumns({ render: false });
      toast(T('Yeni checklist adımı oluşturuldu: ', 'New checklist step created: ') + (isEn() ? en : tr));
      setTypeItem(typeKey, rule.id);
    } catch (error) {
      toast(T('Checklist adımı oluşturulamadı: ', 'Checklist step could not be created: ') + (error.message || error));
    }
  }

  function attachmentMeta(a) {
    return { id: a.id, filename: a.filename, originalName: a.originalName, mimeType: a.mimeType, size: a.size, addedAt: a.addedAt };
  }
  async function commit() {
    const plans = ui.entries.map(plan);
    const chosen = ui.entries.filter(function (entry, i) { return entry.include && plans[i].ready; });
    if (!chosen.length || ui.busy) return;
    ui.busy = true;
    const button = ui.modal.querySelector('[data-tr-commit]');
    button.disabled = true;
    try {
      const items = chosen.map(function (entry) {
        const row = rowFor(entry);
        return {
          talepNo: entry.report.talepNo, orderKey: entry.chosen, itemId: entry.itemId,
          context: {
            orderCode: value(row, ['Order Code']), plmId: value(row, ['PLM ID']), modelName: value(row, ['Model Name']),
            colourCode: value(row, ['C.Code']), checklistName: itemLabel(entry.itemId), checklistStatus: entry.report.talepNo,
          },
        };
      });
      const typeMap = {};
      chosen.forEach(function (entry) { if (entry.typeKey && ui.newTypeMap[entry.typeKey]) typeMap[entry.typeKey] = entry.itemId; });
      const result = await jsonFetch(API + '/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: ui.session, items: items, typeMap: typeMap }) });
      ui.store = await jsonFetch(API);
      // Checklist cevabı: satır + adım başına BÜTÜN raporlardan türetilir.
      const groups = new Map();
      chosen.forEach(function (entry, index) {
        const key = answerKey(entry.chosen, entry.itemId);
        if (!groups.has(key)) groups.set(key, { entry: entry, plan: plans[ui.entries.indexOf(entry)], attachments: [] });
        const res = result.results.find(function (r) { return r.talepNo === items[index].talepNo; });
        if (res) groups.get(key).attachments.push.apply(groups.get(key).attachments, res.attachments.map(attachmentMeta));
      });
      const s = assistantState();
      let written = 0, kept = 0, files = 0;
      groups.forEach(function (group, key) {
        const entry = group.entry;
        const row = rowFor(entry), analysis = analysisFor(row);
        if (!analysis) return;
        const reports = [];
        Object.keys(ui.store.links).forEach(function (talepNo) {
          const link = ui.store.links[talepNo];
          if (link.orderKey === entry.chosen && link.itemId === entry.itemId && ui.store.reports[talepNo]) reports.push(ui.store.reports[talepNo]);
        });
        const step = E().deriveStepStatus(reports);
        const previous = (s && s.answers && s.answers[key]) || {};
        const attachments = new Map((previous.attachments || []).map(function (a) { return [a.id, a]; }));
        group.attachments.forEach(function (a) { if (attachments.size < MAX_ATTACHMENTS) attachments.set(a.id, a); });
        files += group.attachments.length;
        const numbers = new Set(String(previous.reportNumber || '').split(/[,;\s]+/).filter(Boolean));
        reports.forEach(function (r) { if (step.superseded.indexOf(r.talepNo) < 0) numbers.add(r.talepNo); });
        const meta = { attachments: [...attachments.values()], reportNumber: [...numbers].join(', ').slice(0, 300) };
        const userOwned = group.plan.userOwned && !entry.override;
        if (userOwned) { assistant().setChecklistAnswer(analysis, entry.itemId, group.plan.current, meta); kept += 1; }
        else { assistant().setChecklistAnswer(analysis, entry.itemId, step.state || group.plan.current || 'open', Object.assign(meta, { source: 'test_report' })); written += 1; }
      });
      const sync = root.BLChecklistSupplierSync;
      if (sync && typeof sync.syncAnswerChanges === 'function') await sync.syncAnswerChanges();
      if (sync && typeof sync.loadTestReportTasks === 'function') await sync.loadTestReportTasks();
      if (sync && typeof sync.refreshColumns === 'function') sync.refreshColumns({ render: true });
      const skippedDecisions = result.results.reduce(function (n, r) { return n + (r.decisionsSkipped || 0); }, 0);
      ui.done = [
        T(result.results.length + ' rapor kaydedildi.', result.results.length + ' reports saved.'),
        T(written + ' checklist adımı güncellendi.', written + ' checklist steps updated.'),
        T(files + ' dosya satıra eklendi.', files + ' files attached to rows.'),
      ];
      if (kept) ui.done.push(T(kept + ' adımda kullanıcı girişi korundu.', 'User entry kept on ' + kept + ' steps.'));
      if (skippedDecisions) ui.done.push(T(skippedDecisions + ' karar daha önce işlendiği için tekrar işlenmedi.', skippedDecisions + ' decisions were already imported and were not applied again.'));
      ui.session = null;
    } catch (error) {
      toast(T('Test raporları yazılamadı: ', 'Test reports could not be written: ') + (error.message || error));
    } finally {
      ui.busy = false;
      render();
    }
  }

  function bind(modal) {
    const close = function () { if (ui.busy) return; modal.remove(); ui.modal = null; };
    modal.querySelectorAll('[data-tr-close]').forEach(function (b) { b.onclick = close; });
    modal.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    modal.addEventListener('change', function (event) {
      const t = event.target;
      if (t.matches('[data-tr-input]')) { handleFiles(t.files); t.value = ''; return; }
      const find = function (id) { return ui.entries.find(function (e) { return e.id === id; }); };
      if (t.dataset.trInclude) { find(t.dataset.trInclude).include = t.checked; render(); return; }
      if (t.dataset.trOverride) { find(t.dataset.trOverride).override = t.checked; render(); return; }
      if (t.dataset.trRow != null && t.dataset.trRow !== '') { const e = find(t.dataset.trRow); e.chosen = t.value; e.include = Boolean(t.value); render(); return; }
      if (t.dataset.trItem) {
        const e = find(t.dataset.trItem);
        if (t.value === NEW_ITEM) { e.itemId = ''; render(); const row = modal.querySelector('[data-tr-type="' + root.CSS.escape(e.typeKey) + '"]'); if (row) { row.querySelector('select').value = NEW_ITEM; row.querySelector('.trNewItem').hidden = false; } return; }
        e.itemId = t.value; render(); return;
      }
      if (t.dataset.trTypeSelect != null) {
        const row = t.closest('[data-tr-type]');
        if (t.value === NEW_ITEM) { row.querySelector('.trNewItem').hidden = false; return; }
        if (t.value) setTypeItem(t.dataset.trTypeSelect, t.value);
      }
    });
    modal.addEventListener('click', function (event) {
      const create = event.target.closest('[data-tr-create]');
      if (create) createItem(create.dataset.trCreate, create.closest('[data-tr-type]'));
    });
    modal.addEventListener('dragover', function (event) {
      if (!event.dataTransfer || [].indexOf.call(event.dataTransfer.types || [], 'Files') < 0) return;
      event.preventDefault(); event.stopPropagation();
      const zone = modal.querySelector('[data-tr-drop]'); if (zone) zone.classList.add('is-over');
    });
    modal.addEventListener('dragleave', function () { const zone = modal.querySelector('[data-tr-drop]'); if (zone) zone.classList.remove('is-over'); });
    modal.addEventListener('drop', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault(); event.stopPropagation();
      const files = event.dataTransfer.files;
      if (!files || !files.length) { toast(T('Bırakılan öğe dosya içermiyor. Outlook\'tan maili .msg olarak kaydedip bırakın.', 'The dropped item has no file. Save the e-mail from Outlook as .msg and drop it.')); return; }
      handleFiles(files);
    });
    modal.querySelector('[data-tr-commit]').onclick = function () { commit(); };
  }

  async function open(files) {
    await ensureDeps();
    if (!ui.modal) {
      ui.session = null; ui.entries = []; ui.files = []; ui.done = null;
      const modal = root.document.createElement('div');
      modal.id = '_blTestReportImport';
      modal.className = 'cpaModalOverlay';
      modal.innerHTML = '<div class="cpaModal trModal" role="dialog" aria-modal="true" aria-labelledby="_blTestReportTitle">'
        + '<header><div><b id="_blTestReportTitle">' + html(T('Test raporu aktarımı', 'Test report import')) + '</b>'
        + '<small>' + html(T('Önizleme · onaylamadan hiçbir şey yazılmaz', 'Preview · nothing is written until you confirm')) + '</small></div>'
        + '<button type="button" data-tr-close aria-label="' + html(T('Kapat', 'Close')) + '">×</button></header>'
        + '<div class="cpaModalBody trBody" data-tr-body></div>'
        + '<footer><button type="button" class="cpaBtn" data-tr-close>' + html(T('Kapat', 'Close')) + '</button>'
        + '<button type="button" class="cpaBtn primary" data-tr-commit disabled>' + html(T('Onayla ve yaz', 'Confirm and write')) + '</button></footer></div>';
      root.document.body.appendChild(modal);
      ui.modal = modal;
      bind(modal);
    }
    render();
    if (files && files.length) await handleFiles(files);
  }

  root.BLTestReportImport = { open: open, _ui: ui, _plan: plan };
})(typeof window !== 'undefined' ? window : globalThis);
