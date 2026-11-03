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
 *  - Ortak LCW AI motoru tam kaynak metnini ve tüm CP kapsamını değerlendirir.
 *    Buyer Log alıntıları, kimlikleri ve güncelliği doğrular; öneriler ayrı
 *    satırlarda, seçilmeden önizlenir. Yalnız son kullanıcı onayı yazar.
 */
(function (root) {
  'use strict';

  const API = '/api/test-reports';
  const ACCEPT = /\.(msg|eml|pdf|png|jpe?g|webp)$/i;
  // One text bundle plus at most four originals per LCW AI request.
  const NEW_ITEM = '__new__';
  const MAX_ATTACHMENTS = 40;
  const ui = { operationId: '', ownerId: '', history: [], historyOpen: false, historyQuery: '', activeEntry: '', note: '', tab: 'report', draftRevision: 0, savedDraft: '', readOnly: false, phase: '', modal: null, busy: false, session: null, store: null, entries: [], files: [], typeMap: {}, newTypeMap: {}, decision: null, done: null, seq: 0, ai: { state: 'idle', message: '', progress: '', reviews: {}, model: '', read: {} }, aiRun: 0 };

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
    if (!E() || !root.BLTestReportAssessment || !root.BLTestReportFocusView || !assistant() || typeof assistant().computeDecisionsForRows !== 'function') {
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
        TEST_REPORT_SHARED_SCOPE_FORBIDDEN: T('Bu raporu güncellemek için bağlı tüm siparişlerde düzenleme yetkisi gerekir.', 'Updating this report requires edit access to every linked order.'),
        TEST_REPORT_SCOPE_CONFIRMATION_REQUIRED: T('Sipariş kapsamını doğrulayıp ilgili satırı işaretleyin.', 'Verify the order scope and tick the relevant row.'),
        TEST_REPORT_ORDER_MISMATCH: T('Seçilen sipariş rapor kapsamına ait değil.', 'The selected order is outside the report scope.'),
        TEST_REPORT_DUPLICATE_TARGET: T('Aynı rapor ve sipariş adımı iki kez seçildi.', 'The same report and order step was selected twice.'),
        TEST_REPORT_MANUAL_MATCH_REQUIRED: T('Elle eşleşme için kapsamı doğrulayın ve checklist durumunu seçin.', 'Verify the scope and choose a checklist status for the manual match.'),
        TEST_REPORT_CP_INCOMPLETE: T('CP kapsamı tam değil veya değişti. CP verilerini yenileyip yeniden analiz edin.', 'CP coverage is incomplete or changed. Refresh CP data and analyse again.'),
        TEST_REPORT_REVIEW_REQUIRED: T('Geçerli LCW AI incelemesi ve onay önizlemesi gerekli.', 'A valid LCW AI review and approval preview are required.'),
        TEST_REPORT_REVIEW_STALE: T('Sipariş kapsamı değişti; yeniden analiz edin.', 'The order scope changed; analyse again.'),
        TEST_REPORT_AI_CONTRACT_INVALID: T('LCW AI yanıtının kaynak kanıtı doğrulanamadı; yeniden analiz edin.', 'Source evidence in the LCW AI response could not be verified; analyse again.'),
        TEST_REPORT_CONTEXT_TOO_LARGE: T('Bağlam sınırı aşıldı; hiçbir kaynak veya CP satırı kesilmedi. Dosyaları daha küçük gruplarla inceleyin.', 'The context limit was exceeded; no source or CP row was cut. Review smaller document groups.'),
        TEST_REPORT_EVIDENCE_MISSING: T('Kaynak metin bulunamadı; dosyaları yeniden bırakın.', 'Source text is missing; drop the files again.'),
        TEST_REPORT_OPERATION_NOT_FOUND: T('İnceleme bulunamadı veya bu kullanıcıya ait değil.', 'The review was not found or belongs to another user.'),
        TEST_REPORT_OPERATION_CONFLICT: T('Taslak başka bir pencerede değişti. Bu penceredeki notlar korunuyor; güncel kaydı geçmişten açın.', 'The draft changed in another window. Notes in this window are preserved; open the latest record from history.'),
        TEST_REPORT_OPERATION_CAPACITY: T('İnceleme geçmişi sınırına ulaşıldı. Gereksiz eski kayıtları geçmişten silin.', 'Review history capacity was reached. Delete unneeded old records from history.'),
        TEST_REPORT_OPERATION_COMMITTED: T('Kaydedilen inceleme geçmiş görünümünde açıktır.', 'The saved review is open in history view.'),
        TEST_REPORT_OPERATION_INVALID: T('İnceleme kaydı veya kaynak dosyası doğrulanamadı.', 'The review record or source file could not be verified.'),
      };
      const reasons = {
        empty: T('CP satırları henüz yüklenmedi.', 'CP rows have not loaded yet.'),
        identity: T('Sipariş kimliği veya erişim kapsamı değişti.', 'An order identity or access scope changed.'),
        coverage: T('Ekran ve sunucudaki CP satır kapsamı farklı.', 'The page and server have different CP row coverage.'),
        fields: T('Ekrandaki bir sipariş alanı güncel değil.', 'An order field on the page is out of date.'),
        checklist: T('Checklist cevapları henüz eşitlenmedi.', 'Checklist answers are not yet synchronised.'),
      };
      const detail = code === 'TEST_REPORT_CP_INCOMPLETE' && payload.details && reasons[payload.details.reason];
      throw Object.assign(new Error((detail ? detail + ' ' : '') + (known[code] || (payload && payload.error) || (T('İstek başarısız: ', 'Request failed: ') + response.status))), { code: code });
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
    const part = Checklist().Components.parseItem(itemId);
    const item = catalog().find(function (entry) { return entry.id === (part ? part.baseId : itemId); });
    return item ? (isEn() ? item.en : item.tr) + (part ? ' · ' + part.partId : '') : itemId;
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
  // Kullanıcının eklediği özel checklist durumları (Lack of Sample, In Progress …).
  function customStatusList() {
    const engine = Checklist();
    return engine && typeof engine.customStatuses === 'function' ? engine.customStatuses() : [];
  }
  function statusIdList() {
    const engine = Checklist();
    return engine && typeof engine.statusIds === 'function' ? engine.statusIds() : ['open', 'approved', 'rejected', 'notRequired'];
  }
  function isCustom(id) { return String(id || '').indexOf('custom:') === 0; }
  // Kullanıcının yazdığı özel durum adı çeviri ağına girmez.
  function statusHtml(id) { return '<b' + (isCustom(id) ? ' data-no-i18n' : '') + '>' + html(statusText(id)) + '</b>'; }
  // Önizlemede elle seçilen hedef durum; listede olmayan (silinmiş) durum yok sayılır.
  function chosenStatus(entry) {
    return entry && entry.status && statusIdList().indexOf(entry.status) >= 0 ? entry.status : '';
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
    return reports.flatMap(function (report) {
      return E().matchReportScopes(report, rows, { keyOf: keyOf }).map(function (scoped) {
      const scope = scoped.scope;
      const match = report.talepNo ? scoped.match : { level: 'none', reason: 'talep', candidates: [] };
      const candidates = match.candidates.filter(function (c) { return c.key; });
      const link = E().reportLinks(store.links[report.talepNo]).find(function (l) { return candidates.some(function (c) { return c.key === l.orderKey; }); });
      let chosen = '';
      // Daha önce bağlanmış talep aynı satıra gider; yeniden sorulmaz.
      if (link && candidates.some(function (c) { return c.key === link.orderKey; })) chosen = link.orderKey;
      else if (candidates.length === 1 && (match.level === 'exact' || match.level === 'partial')) chosen = candidates[0].key;
      const typeKey = E().talepTipiKey(report.talepTipi);
      const labDipItem = typeKey === 'LABDIP' ? catalog().find(function (item) {
        return /LAB\s*DIP|LABDIP/i.test([item.tr, item.en].join(' '));
      }) : null;
      const mapped = (link && link.itemId) || (store.typeMap[typeKey] && store.typeMap[typeKey].itemId) || ui.newTypeMap[typeKey] || (labDipItem && labDipItem.id) || '';
      const fromAi = report.kaynak === 'ai';
      const ignored = Boolean(E().normalizeOrderCode(report.siparisKodu)) && match.level === 'none' && match.reason === 'order';
      const entry = {
        id: 'r' + (ui.seq++), report: report, scope: scope, match: match, candidates: candidates, chosen: chosen,
        typeKey: typeKey, itemId: mapped && catalog().some(function (i) { return i.id === ((Checklist().Components.parseItem(mapped) || {}).baseId || mapped); }) ? mapped : '',
        // CP dışında kalan sipariş yazılmaz; ham belge yine AI incelemesine gider.
        // LCW AI'ın okuduğu rapor da varsayılan olarak seçilmez: kullanıcı alanları kontrol edip işaretler.
        include: !ignored && Boolean(chosen) && !fromAi, override: false, linked: Boolean(link), fromAi: fromAi, ignored: ignored,
      };
      // ROS sonucu tek PO'ya aday olsa bile kullanıcı açıkça işaretlemeli.
      if ((report.labDipColors || []).length) entry.include = false;
      if (E().orderScopeNeedsReview(report)) entry.include = false;
      return entry;
      });
    });
  }
  function rowFor(entry) {
    const candidate = entry.candidates.find(function (c) { return c.key === entry.chosen; });
    return candidate ? candidate.row : cpRows().find(function (row) { const a = analysisFor(row); return a && a.orderKey === entry.chosen; }) || null;
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
      if (E().reportLinks(store.links[talepNo]).some(function (link) { return link.orderKey === orderKey && link.itemId === itemId; }) && store.reports[talepNo]) map.set(talepNo, store.reports[talepNo]);
    });
    ui.entries.forEach(function (entry) {
      if (!entry.include || entry.chosen !== orderKey || entry.itemId !== itemId || !entry.report.talepNo) return;
      map.set(entry.report.talepNo, E().mergeReports(map.get(entry.report.talepNo), entry.report));
    });
    return [...map.values()];
  }
  /* Buyer yolu: elle değiştirilen/eklenen hedef ya da AI önerisi olmayan kayıt. */
  function aiReady() { return ui.ai.state === 'done' && Boolean(ui.ai.packet) && !ui.ai.cpChanged; }
  function isBuyerEntry(entry) { return Boolean(entry && (entry.manualMatch || !aiReady() || !reviewFor(entry))); }
  function partsOf(entry) {
    const analysis = entry && analysisFor(rowFor(entry)), s = assistantState();
    return analysis ? Checklist().componentsFor(analysis, { answers: s && s.answers }) : [];
  }
  /* Takım siparişinde aynı rapor birden çok set parçasına yazılabilir: her
     ek parça ayrı bir önizleme satırıdır (kendi durumu ve doğrulaması). */
  function partPicker(entry) {
    const C = Checklist().Components, parsed = C.parseItem(entry.itemId);
    if (!parsed || entry.partOf || entry.ignored) return '';
    const parts = partsOf(entry);
    if (parts.length < 2) return '';
    const siblings = ui.entries.filter(function (e) { return e.partOf === entry.id; });
    const chosen = new Set([parsed.partId].concat(siblings.map(function (e) { return (C.parseItem(e.itemId) || {}).partId; })));
    return '<div class="trParts"><small>' + html(T('Set parçaları (birden çok seçilebilir)', 'Set parts (select several)')) + '</small>'
      + parts.map(function (part) {
        return '<label class="trInline"><input type="checkbox" data-tr-part="' + entry.id + '" value="' + html(part.id) + '"' + (chosen.has(part.id) ? ' checked' : '') + (part.id === parsed.partId ? ' disabled' : '') + '> ' + html(part.label) + '</label>';
      }).join('') + '</div>';
  }
  function togglePart(entry, partId, on) {
    const C = Checklist().Components, parsed = C.parseItem(entry.itemId);
    if (!parsed) return;
    const itemId = C.itemId(parsed.baseId, partId);
    const existing = ui.entries.find(function (e) { return e.partOf === entry.id && e.itemId === itemId; });
    if (!on) { if (existing) ui.entries = ui.entries.filter(function (e) { return e !== existing; }); return; }
    if (existing) return;
    const p = plan(entry);
    const extra = Object.assign({}, entry, {
      id: 'r' + (ui.seq++), partOf: entry.id, itemId: itemId, manualAdded: true, include: false,
      manualMatch: { buyer: true, fromOrderKey: entry.chosen, fromItemId: entry.itemId },
      originReview: entry.originReview || (aiReady() ? reviewFor(entry) : null) || null,
      reviewVerified: false, status: chosenStatus(entry) || p.next || '', override: false,
    });
    const siblings = ui.entries.filter(function (e) { return e === entry || e.partOf === entry.id; });
    ui.entries.splice(ui.entries.indexOf(siblings[siblings.length - 1]) + 1, 0, extra);
  }
  function dropParts(entry) { ui.entries = ui.entries.filter(function (e) { return e.partOf !== entry.id; }); }
  /* Bileşen (Main Fabric / Neck RIB …): boşsa sonuç tek bileşenli yazılır. */
  function elementCell(entry) {
    if (entry.ignored || !entry.itemId || !entry.chosen) return '';
    const analysis = analysisFor(rowFor(entry)), s = assistantState();
    const answer = analysis && s && s.answers ? s.answers[answerKey(analysis.orderKey, entry.itemId)] : null;
    const names = new Set();
    (answer && answer.elements || []).forEach(function (e) { names.add(e.name); });
    const review = aiReady() ? reviewFor(entry) : null;
    if (review && review.component) names.add(text(review.component).slice(0, 60));
    (Checklist().Components.ELEMENT_SUGGESTIONS || []).forEach(function (e) { names.add(isEn() ? e.en : e.tr); });
    const listId = '_trElements_' + entry.id;
    return '<label class="trInline trElementPick"><span>' + html(T('Bileşen (isteğe bağlı)', 'Component (optional)')) + '</span>'
      + '<input type="text" maxlength="60" list="' + listId + '" data-tr-element="' + entry.id + '" value="' + html(entry.element || '') + '" placeholder="' + html(T('Tek bileşen', 'Single component')) + '"></label>'
      + '<datalist id="' + listId + '">' + [...names].filter(Boolean).map(function (n) { return '<option value="' + html(n) + '"></option>'; }).join('') + '</datalist>';
  }
  function plan(entry) {
    const out = { ready: false, reason: '', current: 'open', next: '', suggested: null, manual: '', userOwned: false, notAsked: false, step: null, skippedDecisions: 0 };
    if (ui.readOnly) { out.reason = T('Kaydedilmiş inceleme · salt okunur.', 'Saved review · read only.'); return out; }
    const existing = assistantState() && assistantState().answers && assistantState().answers[answerKey(entry.chosen, entry.itemId)];
    out.current = existing ? Checklist().normalizeStatus(existing.state) || 'open' : 'open';
    /* v7.0.290 — Elle eşleşme LCW AI'dan bağımsızdır. AI incelemesi yoksa,
       tamamlanmadıysa ya da bu rapor/sipariş için öneri vermediyse buyer
       kapsamı kendisi doğrular ve durumu kendisi seçer (buyer yolu). */
    // Önceki bir AI incelemesinden sonra CP değiştiyse hiçbir yol eski bağlamla yazmaz.
    if (ui.ai.cpChanged) { out.reason = T('CP veya checklist değişti; yeniden analiz edin.', 'CP or checklist changed; analyse again.'); return out; }
    const buyer = isBuyerEntry(entry);
    const review = buyer ? (entry.originReview || null) : reviewFor(entry);
    out.buyer = buyer;
    if (buyer && !entry.reviewVerified) { out.reason = T('Kaynağı ve bu siparişin bileşen/test kapsamını doğrulayın (elle eşleşme).', 'Verify the source and this order’s component/test scope (manual match).'); return out; }
    if (!buyer && review.blocked && !entry.reviewVerified) { out.reason = T('Kaynağı ve bileşen/sipariş kapsamını doğrulayın.', 'Verify the source and component/order scope.'); return out; }
    if (!buyer && review.step && entry.itemId !== review.step && !entry.partOf) { out.reason = T('Checklist adımı incelemedeki kapsamla uyuşmuyor.', 'The checklist step differs from the reviewed scope.'); return out; }
    const store = ui.store || { reports: {} };
    const stored = entry.report.talepNo ? store.reports[entry.report.talepNo] : null;
    if (stored) {
      const known = new Set((stored.kararlar || []).map(function (d) { return E().decisionKey(d, stored.talepNo); }));
      out.skippedDecisions = (entry.report.kararlar || []).filter(function (d) { return known.has(E().decisionKey(d, stored.talepNo)); }).length;
    }
    if (!entry.report.talepNo) { out.reason = T('Talep no okunamadı.', 'No request number was read.'); return out; }
    if (entry.ignored) { out.reason = T('Sipariş kodu CP\'de olmadığı için dikkate alınmadı.', 'Ignored because the order code is not in CP.'); return out; }
    const row = rowFor(entry);
    if (!row) { out.reason = entry.candidates.length ? T('Satır seçin.', 'Choose a row.') : T('CP satırı bulunamadı.', 'No CP row was found.'); return out; }
    if (row._canEdit === false) { out.reason = T('Bu satır için düzenleme yetkiniz yok.', 'You do not have edit access to this row.'); return out; }
    if (!entry.itemId) { out.reason = T('Checklist adımı seçin.', 'Choose a checklist step.'); return out; }
    const baseItem = (Checklist().Components.parseItem(entry.itemId) || {}).baseId || entry.itemId;
    if (!catalog().some(function (item) { return item.id === baseItem; }) || (review && review.status && !statusIdList().includes(review.status))) { out.reason = T('Checklist tanımları değişti; verileri yenileyip yeniden analiz edin.', 'Checklist definitions changed; refresh data and analyse again.'); return out; }
    const analysis = analysisFor(row);
    if (!analysis) { out.reason = T('Sipariş checklist için okunamadı.', 'The order could not be read for the checklist.'); return out; }
    const s = assistantState();
    const components = Checklist().Components, parts = Checklist().componentsFor(analysis, { answers: s && s.answers });
    const part = components.parseItem(entry.itemId);
    if (part && !parts.some(p => p.id === part.partId)) { out.reason = T('Bu siparişe ait geçerli checklist adımını seçin.', 'Choose a valid checklist step for this order.'); return out; }
    if ((parts.length || components.isSet(analysis.sourceRow || analysis, 'cp')) && (!part || !parts.some(p => p.id === part.partId))) {
      out.reason = parts.length ? T('Checklist adımını ve set parçasını seçin.', 'Choose the checklist step and set part.') : T('Önce CP hücresinden set parçalarını tanımlayın.', 'Define the set parts from the CP cell first.');
      return out;
    }
    const answer = s && s.answers ? s.answers[answerKey(analysis.orderKey, entry.itemId)] : null;
    const engine = Checklist();
    const current = engine && answer ? (engine.normalizeStatus(answer.state) || 'open') : 'open';
    out.current = current;
    out.userOwned = Boolean(answer && answer.source !== 'test_report' && current !== 'open');
    const reports = groupReports(entry.chosen, entry.itemId);
    out.step = E().deriveStepStatus(reports);
    // Analiz sonucu kullanıcı tanımlı duruma eşleşebilir (ör. Lack of Sample).
    out.suggested = { status: buyer ? '' : review.status || '' };
    out.manual = chosenStatus(entry);
    if ((buyer || review.blocked) && !out.manual) { out.reason = T('Doğruladığınız kapsam için hedef durumu elle seçin.', 'Choose the target status for the scope you verified.'); out.ready = true; return out; }
    if (!out.manual && !out.suggested.status) { out.reason = T('Kanıt kesin bir durum önermiyor; hedef durumu seçin.', 'The evidence has no definite status proposal; choose a target status.'); out.ready = true; return out; }
    out.next = out.manual || (out.userOwned && !entry.override ? current : (out.suggested.status || current));
    out.notAsked = Array.isArray(analysis.checklistItemIds) && analysis.checklistItemIds.indexOf(part ? part.baseId : entry.itemId) < 0;
    out.ready = true;
    return out;
  }

  /* -------------------------------------------------------- çizim */
  function levelBadge(entry) {
    if (entry.manualMatch) return '<span class="trBadge tone-orange">' + html(T('Elle eşleşme', 'Manual match')) + '</span><small>' + html(T('LCW AI bu hedefi doğrulamadı.', 'LCW AI has not verified this target.')) + '</small>';
    const map = {
      exact: { tone: 'green', tr: 'Tam eşleşme', en: 'Exact match' },
      partial: { tone: 'orange', tr: 'Kısmi eşleşme', en: 'Partial match' },
      ambiguous: { tone: 'orange', tr: 'Belirsiz', en: 'Ambiguous' },
      none: { tone: 'red', tr: 'Eşleşmedi', en: 'Not matched' },
    };
    const level = entry.ignored
      ? { tone: 'blue', tr: 'Dikkate alınmadı', en: 'Ignored' }
      : (entry.linked && entry.chosen ? { tone: 'blue', tr: 'Önceki bağlantı', en: 'Previous link' } : map[entry.match.level] || map.none);
    const reasons = {
      order: T('Sipariş kodu CP\'de yok; checklist yazımına alınmadı.', 'Order code is not in CP; excluded from checklist writes.'),
      model: T('Model adı tutmadı.', 'Model name did not match.'),
      colour: T('Renk tanımı tutmadı.', 'Colour description did not match.'),
      multiple: T('Birden çok satır uyuyor.', 'Several rows fit.'),
      modelPartial: T('Model adı kısmi eşleşti.', 'Model name matched partially.'),
      colourCode: T('Renk, renk koduyla eşleşti.', 'Colour matched by colour code.'),
      rosNoOrder: T('ROS mesajında PO kodu yok; aday siparişin doğruluğunu onaylayın.', 'ROS message has no PO code; verify the suggested order.'),
      rosNoOrderColour: T('ROS mesajında PO kodu yok ve bileşen rengi CP varyant rengiyle eşleşmedi; siparişi elle doğrulayın.', 'ROS has no PO code and component colour differs from CP variant; verify the order manually.'),
      talep: T('Talep no yok.', 'No request number.'),
    };
    const reason = reasons[entry.match.reason] || '';
    return '<span class="trBadge tone-' + level.tone + '" title="' + html(reason) + '">' + html(isEn() ? level.en : level.tr) + '</span>' + (reason ? '<small>' + html(reason) + '</small>' : '');
  }
  function labDipResultCell(report) {
    const colours = E().resolveLabDipColors([report]);
    const passed = colours.filter(function (c) { return c.status === 'pass'; }).length;
    const failed = colours.filter(function (c) { return c.status === 'fail'; }).length;
    const pending = colours.length - passed - failed;
    const badges = [
      passed ? '<span class="trBadge tone-green">' + html(T('Onaylı ', 'Approved ') + passed) + '</span>' : '',
      failed ? '<span class="trBadge tone-red">' + html(T('Reddedilen ', 'Rejected ') + failed) + '</span>' : '',
      pending ? '<span class="trBadge tone-orange">' + html(T('Bekleyen ', 'Pending ') + pending) + '</span>' : '',
    ].join(' ');
    const details = colours.map(function (c) {
      const status = c.status === 'pass' ? T('Onaylandı', 'Approved') : c.status === 'fail' ? T('Reddedildi', 'Rejected') : T('Bekliyor', 'Pending');
      const tone = c.status === 'pass' ? 'green' : c.status === 'fail' ? 'red' : 'orange';
      return '<li class="trLabDipRow"><b>' + html(c.colour) + '</b> <span class="trBadge tone-' + tone + '">' + html(status) + '</span>'
        + (c.round ? '<small>' + html(T('Tur ', 'Round ') + c.round) + '</small>' : '')
        + (c.submitNo ? '<small>' + html('Submit ' + c.submitNo) + '</small>' : '')
        + (c.comment ? '<p>' + html(c.comment) + '</p>' : '')
        + (c.date ? '<small>' + html(c.date) + '</small>' : '') + '</li>';
    }).join('');
    return badges + '<details class="trLabDipDetails"><summary>' + html(T('Renk ayrıntıları', 'Colour details') + ' (' + colours.length + ')') + '</summary><ul>' + details + '</ul></details>';
  }
  function resultBadge(report) {
    if ((report.labDipColors || []).length) return labDipResultCell(report);
    const outcome = E().reportOutcome(report);
    const tone = outcome.code === 'pass' ? 'green' : outcome.code === 'fail' ? 'red' : 'orange';
    const raw = report.genelSonuc ? E().resultLabel(report.genelSonuc, lang()) : '';
    const decision = (report.kararlar || []).length ? E().resultLabel(report.kararlar[report.kararlar.length - 1].karar, lang()) : '';
    const label = raw || decision || T('Sonuç yok', 'No result');
    return '<span class="trBadge tone-' + tone + '">' + html(label) + '</span>' + (raw && decision ? '<small>' + html(decision) + '</small>' : '');
  }
  function testNames(report) {
    const names = [];
    (report && report.testler || []).forEach(function (t) { const name = text(t && t.ad); if (name && names.indexOf(name) < 0) names.push(name); });
    (report && report.kararlar || []).forEach(function (k) { const name = text(k && k.test); if (name && names.indexOf(name) < 0) names.push(name); });
    return names;
  }
  function rowCell(entry) {
    const row = rowFor(entry), label = row ? html(rowLabel(row)) : '<span class="trMuted">' + html(T('PO seçilmedi', 'No PO selected')) + '</span>';
    if (entry.partOf) return label + '<small>' + html(T('Ek set parçası · ', 'Extra set part · ') + itemLabel(entry.itemId)) + '</small>';
    return label + '<details' + (entry.manualMatch || !entry.chosen ? ' open' : '') + '><summary>' + html(entry.chosen ? T('Eşleşmeyi değiştir', 'Change match') : T('Elle eşleştir', 'Match manually')) + '</summary>'
      + '<label><small>' + html(T('CP’de PO / model ara', 'Search CP by PO / model')) + '</small><input type="search" data-tr-search="' + entry.id + '" value="' + html(entry.matchQuery || '') + '"></label>'
      + '<select data-tr-row="' + entry.id + '" aria-label="' + html(T('Hedef PO / CP satırı', 'Target PO / CP row')) + '">' + matchOptions(entry) + '</select></details>'
      + '<button type="button" class="cpaBtn sm" data-tr-add-po="' + entry.id + '">' + html(T('+ İlave PO', '+ Add PO')) + '</button>'
      + (entry.manualAdded ? '<button type="button" class="cpaBtn sm" data-tr-remove-po="' + entry.id + '">' + html(T('Bu PO satırını kaldır', 'Remove this PO row')) + '</button>' : '');
  }
  function matchOptions(entry) {
    const query = text(entry.matchQuery).toLocaleLowerCase(lang());
    const choices = cpRows().flatMap(function (row) { const a = analysisFor(row); return a && row._canEdit !== false ? [{ key: a.orderKey, row: row }] : []; });
    const matches = choices.filter(function (c) { return !query || rowLabel(c.row).toLocaleLowerCase(lang()).includes(query); });
    const visible = matches.slice(0, 100);
    const selected = choices.find(function (c) { return c.key === entry.chosen; });
    if (selected && !visible.some(function (c) { return c.key === selected.key; })) visible.unshift(selected);
    return '<option value="">' + html(matches.length ? T('CP satırı seçin…', 'Choose a CP row…') : T('CP’de bulunamadı', 'Not found in CP')) + '</option>'
      + visible.map(function (c) { return '<option value="' + html(c.key) + '"' + (c.key === entry.chosen ? ' selected' : '') + '>' + html(rowLabel(c.row)) + '</option>'; }).join('')
      + (matches.length > 100 ? '<option disabled>' + html(T('İlk 100 sonuç · PO yazarak daraltın', 'First 100 results · type a PO to narrow')) + '</option>' : '');
  }
  function changeMatch(entry, orderKey) {
    const origin = entry.originReview || (aiReady() ? reviewFor(entry) : null);
    entry.originReview = origin || null;
    dropParts(entry);
    const previousItem = entry.itemId;
    entry.chosen = orderKey;
    // v7.0.290 — Buyer eşleşmesi: AI incelemesi olmasa da çalışır; köken (varsa) denetim izine yazılır.
    entry.manualMatch = { buyer: true, fromOrderKey: origin ? origin.orderKey : '', fromItemId: origin ? origin.step : '' };
    // Aynı adım yeni siparişte de geçerliyse korunur; set parçası ise yeniden seçilir.
    entry.itemId = previousItem && !Checklist().Components.parseItem(previousItem) ? previousItem : '';
    entry.include = false; entry.reviewVerified = false; entry.status = ''; entry.override = false; entry.ignored = false;
  }
  function addPo(entry) {
    const origin = entry.originReview || (aiReady() ? reviewFor(entry) : null);
    const extra = Object.assign({}, entry, { id: 'r' + (ui.seq++), manualAdded: true, partOf: '', originReview: origin || null, matchQuery: '' });
    changeMatch(extra, '');
    const siblings = ui.entries.filter(function (e) { return e === entry || e.partOf === entry.id; });
    ui.entries.splice(ui.entries.indexOf(siblings[siblings.length - 1]) + 1, 0, extra);
  }
  function itemOptions(selected, entry) {
    const analysis = entry && analysisFor(rowFor(entry)), s = assistantState();
    const parts = analysis ? Checklist().componentsFor(analysis, { answers: s && s.answers }) : [];
    const items = parts.length ? catalog().flatMap(item => parts.map(part => ({ ...item, id: Checklist().Components.itemId(item.id, part.id), tr: item.tr + ' · ' + part.label, en: item.en + ' · ' + part.label }))) : catalog();
    return '<option value="">' + html(T('Adım seçin…', 'Choose a step…')) + '</option>'
      + items.map(function (item) { return '<option value="' + html(item.id) + '"' + (item.id === selected ? ' selected' : '') + '>' + html(isEn() ? item.en : item.tr) + '</option>'; }).join('')
      + '<option value="' + NEW_ITEM + '">' + html(T('+ Yeni checklist adımı oluştur…', '+ Create a new checklist step…')) + '</option>';
  }
  function buyerVerifyHtml(entry) {
    if (!isBuyerEntry(entry) || !entry.chosen || entry.ignored) return '';
    return '<label class="trInline trVerify"><input type="checkbox" data-tr-verify="' + entry.id + '"' + (entry.reviewVerified ? ' checked' : '') + '> '
      + html(T('Elle eşleşme: orijinal kaynağı ve bu siparişin bileşen/test kapsamını doğruladım', 'Manual match: I verified the original source and this order’s component/test scope')) + '</label>';
  }
  function changeCell(entry, p) {
    const extras = buyerVerifyHtml(entry) + elementCell(entry);
    if (!p.ready) return (entry.itemId && entry.chosen ? '<small>' + html(T('Mevcut durum: ', 'Current status: ')) + statusHtml(p.current) + '</small>' : '') + '<span class="trMuted">' + html(p.reason) + '</span>' + extras;
    let out = statusHtml(p.current) + ' → ' + statusHtml(p.next) + (entry.element ? '<small>' + html(T('Bileşen: ', 'Component: ') + entry.element) + '</small>' : '');
    // Hedef durum dinamik: otomatik (analiz) ya da kullanıcı tanımlı durumlar dâhil elle seçim.
    const auto = p.userOwned && !entry.override ? p.current : (p.suggested && p.suggested.status || p.current);
    out += '<label class="trInline trStatusPick"><span>' + html(T('Checklist durumu', 'Checklist status')) + '</span><select data-tr-status="' + entry.id + '">'
      + '<option value="">' + html(p.buyer ? T('Durum seçin…', 'Choose a status…') : T('Otomatik: ', 'Automatic: ') + statusText(auto)) + '</option>'
      + statusIdList().map(function (id) { return '<option value="' + html(id) + '"' + (id === p.manual ? ' selected' : '') + (isCustom(id) ? ' data-no-i18n' : '') + '>' + html(statusText(id)) + '</option>'; }).join('')
      + '</select></label>';
    if (!p.manual && p.suggested && p.suggested.custom && !(p.userOwned && !entry.override)) {
      out += '<small>' + html(T('Analiz sonucu "' + p.suggested.matched + '" durumuyla eşleşti.', 'The analysis result matched the "' + p.suggested.matched + '" status.')) + '</small>';
    }
    if (p.manual) out += '<small>' + html(T('Elle seçilen durum yazılacak.', 'The manually chosen status will be written.')) + '</small>';
    if (p.userOwned && !p.manual) {
      out += '<small>' + html(T('Kullanıcı girişi öncelikli; durum korunur.', 'The user entry has priority; the status is kept.')) + '</small>'
        + '<label class="trInline"><input type="checkbox" data-tr-override="' + entry.id + '"' + (entry.override ? ' checked' : '') + '> ' + html(T('Raporlara göre güncelle', 'Update from reports')) + '</label>';
    }
    if (p.step && p.step.outcomes.length > 1) out += '<small>' + html(T('Satırdaki ' + p.step.outcomes.length + ' rapordan türetildi.', 'Derived from ' + p.step.outcomes.length + ' reports on the row.')) + '</small>';
    if (p.step && p.step.superseded.length) out += '<small>' + html(T('Tekrar testle geçersiz: ', 'Replaced by retest: ') + p.step.superseded.join(', ')) + '</small>';
    if (p.notAsked) out += '<small>' + html(T('Bu adım bu siparişte şu an sorulmuyor; durum saklanır ve soru geldiğinde görünür.', 'This step is not asked for this order yet; the status is stored and shows once it is asked.')) + '</small>';
    return out + extras;
  }
  function warningsCell(entry, p) {
    const list = (entry.report.uyarilar || []).filter(function (w) { return !reviewFor(entry) || !['aiNote', 'aiExtracted'].includes(w.code); }).map(function (w) { return E().warningText(w, lang()); });
    if (p.skippedDecisions) list.push(E().warningText({ code: 'decisionAlreadyApplied' }, lang()) + ' (' + p.skippedDecisions + ')');
    const tasks = p.step ? p.step.tasks.filter(function (t) { return t.talepNo === entry.report.talepNo; }) : E().reportOutcome(entry.report).tasks;
    tasks.forEach(function (t) { list.push(T('Buying dönüşü bekleniyor: ', 'Awaiting buying feedback: ') + t.test + (t.aciklama ? ' — ' + t.aciklama : '')); });
    const review = aiReviewHtml(entry);
    if (!list.length) return review;
    return '<ul class="trWarnings">' + list.map(function (w) { return '<li>' + html(w) + '</li>'; }).join('') + '</ul>' + review;
  }
  /* LCW AI yönlendirmesi: özet, yapılacak işler, riskler, önerilen adım. */
  function aiReviewHtml(entry) {
    const review = entry.report.talepNo ? (entry.manualMatch ? entry.originReview : reviewFor(entry)) : null;
    if (!review) return '';
    let out = '<div class="trAi"><b>' + html(T('LCW AI değerlendirmesi', 'LCW AI assessment')) + '</b>';
    if (entry.manualMatch) out += '<small><b>' + html(T('Elle seçilen PO · kapsam kullanıcı tarafından doğrulanmalı.', 'Manually selected PO · the buyer must verify scope.')) + '</b></small><small>' + html(T('Aşağıdaki AI incelemesinin asıl PO’su: ', 'Original PO of the AI review below: ') + (review.orderCode || '—')) + '</small>';
    out += '<small>' + html(T('Bileşen: ', 'Component: ') + (review.component || '—') + ' · ' + T('Laboratuvar sonucu: ', 'Lab result: ') + (review.labResult || '—')) + '</small>';
    if (review.commercialDecision) out += '<small>' + html(T('Ticari karar: ', 'Commercial decision: ') + review.commercialDecision) + '</small>';
    if (review.summary) out += '<p>' + html(review.summary) + '</p>';
    if (review.evidence && review.evidence.length) out += '<details><summary>' + html(T('Kaynak kanıtlarını göster', 'Show source evidence')) + '</summary>' + review.evidence.map(function (ref) {
      const source = ui.ai.packet && ui.ai.packet.sources.find(function (s) { return s.id === ref.sourceId; });
      const link = source && source.fileId ? '<a target="_blank" rel="noopener" href="' + API + '/staged/' + encodeURIComponent(ui.session) + '/' + encodeURIComponent(source.fileId) + '">' + html(T('Orijinali aç', 'Open original')) + '</a>' : '';
      return '<small><b>' + html((source && source.name || ref.sourceId) + ' · ' + T('Sayfa ', 'Page ') + ref.page) + '</b> · ' + html(ref.quote) + ' ' + link + '</small>';
    }).join('') + '</details>';
    if (review.blocked && !isBuyerEntry(entry)) out += '<label class="trInline"><input type="checkbox" data-tr-verify="' + entry.id + '"' + (entry.reviewVerified ? ' checked' : '') + '> ' + html(T('Orijinal kaynağı ve bu siparişin bileşen/test kapsamını doğruladım', 'I verified the original source and this order’s component/test scope')) + '</label>';
    if (review.actions.length) out += '<small>' + html(T('Yapılacaklar', 'Next steps')) + '</small><ul class="trWarnings">' + review.actions.map(function (a) { return '<li>' + html(a) + '</li>'; }).join('') + '</ul>';
    if (review.risks.length) out += '<small>' + html(T('Riskler', 'Risks')) + '</small><ul class="trWarnings">' + review.risks.map(function (a) { return '<li>' + html(a) + '</li>'; }).join('') + '</ul>';
    if (!entry.manualMatch && review.step && review.step !== entry.itemId) {
      out += '<button type="button" class="cpaBtn sm" data-tr-ai-step="' + entry.id + '">' + html(T('Adım önerisi: ', 'Suggested step: ') + itemLabel(review.step) + T(' · Uygula', ' · Apply')) + '</button>';
    }
    if (!entry.manualMatch && review.status && chosenStatus(entry) && review.status !== chosenStatus(entry) && statusIdList().indexOf(review.status) >= 0) {
      out += '<button type="button" class="cpaBtn sm" data-tr-ai-status="' + entry.id + '">' + html(T('Durum önerisi: ', 'Suggested status: ') + statusText(review.status) + T(' · Uygula', ' · Apply')) + '</button>';
    }
    return out + '</div>';
  }
  // Aynı talep tipindeki raporlar için LCW AI'ın en sık önerdiği adım.
  function aiStepForType(typeKey) {
    const counts = {};
    ui.entries.forEach(function (e) {
      const review = !e.ignored && e.typeKey === typeKey && e.report.talepNo ? reviewFor(e) : null;
      if (review && review.step) counts[review.step] = (counts[review.step] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || '';
  }
  function aiStatusHtml() {
    const ai = ui.ai;
    if (ai.state === 'idle') return '';
    if (ai.state === 'running') return '<section class="trAiBar is-running" role="status"><b>' + html(T('LCW AI analiz ediyor…', 'LCW AI is analysing…')) + '</b><small>' + html(ai.progress) + '</small><button type="button" class="cpaBtn sm" data-tr-ai-cancel>' + html(T('Durdur', 'Stop')) + '</button></section>';
    if (ai.state === 'offline') return '<section class="trAiBar"><b>' + html(T('LCW AI bağlı değil', 'LCW AI is not connected')) + '</b><small>' + html(T('Bağlanırsanız LCW AI raporları inceleyip yapılacakları ve uygun checklist adımını önerir, okunamayan dosyaları okur. Öneriler yalnız sizin onayınızla uygulanır.', 'Once connected, LCW AI reviews the reports, suggests next steps and a fitting checklist step, and reads files Buyer Log could not. Suggestions are applied only with your approval.')) + '</small><button type="button" class="cpaBtn sm primary" data-tr-ai-connect>' + html(T('LCW AI\'a bağlan ve analiz et', 'Connect to LCW AI and analyse')) + '</button></section>';
    if (ai.state === 'error') {
      const cpError = ai.code === 'TEST_REPORT_CP_INCOMPLETE' || ai.code === 'TEST_REPORT_REVIEW_STALE' || ai.code === 'OFFICE_PREVIEW_CHANGED';
      return '<section class="trAiBar is-error"><b>' + html(cpError ? T('CP bağlamı hazırlanamadı', 'CP context could not be prepared') : T('LCW AI analizi tamamlanamadı', 'LCW AI analysis did not complete')) + '</b><small>' + html(cpError ? [ai.message, T('Dosyalar önizlemede korunuyor. Güncel CP ve checklist verilerini yükleyip yeniden analiz edin.', 'Files are preserved in the preview. Reload current CP and checklist data and analyse again.')].filter(Boolean).join(' ') : ai.message) + '</small><button type="button" class="cpaBtn sm" ' + (cpError ? 'data-tr-cp-retry' : 'data-tr-ai-retry') + '>' + html(cpError ? T('CP verilerini yükle ve yeniden dene', 'Reload CP data and try again') : T('Tekrar dene', 'Try again')) + '</button></section>';
    }
    return '<section class="trAiBar is-done"><b>' + html(T('LCW AI analizi hazır', 'LCW AI analysis ready')) + (ai.model ? ' · ' + html(ai.model) : '') + '</b><small>' + html(ai.message || T('Öneriler her raporun satırında; hiçbiri siz uygulamadan seçilmez.', 'Suggestions are shown on each report row; none is applied until you do.')) + '</small><button type="button" class="cpaBtn sm" data-tr-ai-retry>' + html(T('Yeniden analiz et', 'Analyse again')) + '</button></section>';
  }
  function filesCell(report) {
    return (report.dosyalar || []).map(function (f) { return '<div class="trFile" title="' + html(f.ad) + '">' + html(f.ad) + '</div>'; }).join('') || '<span class="trMuted">—</span>';
  }
  function typeMappingHtml() {
    const pending = new Map();
    ui.entries.forEach(function (entry) { if (!entry.ignored && !entry.itemId && entry.typeKey && !pending.has(entry.typeKey)) pending.set(entry.typeKey, entry.report.talepTipi); });
    if (!pending.size) return '';
    return '<section class="trTypes"><b>' + html(T('Buyer Log\'da karşılığı olmayan talep tipleri', 'Request types without a Buyer Log step')) + '</b>'
      + [...pending.entries()].map(function (pair) {
        const key = pair[0], label = pair[1] || key;
        const parts = String(label).split(' / ');
        const newTr = key === 'LABDIP' ? 'Lab Dip onayı' : parts[0];
        const newEn = key === 'LABDIP' ? 'Lab Dip approval' : (parts[1] || parts[0]);
        const suggested = aiStepForType(key);
        return '<div class="trTypeRow" data-tr-type="' + html(key) + '"><span>' + html(T('"' + parts[0] + '" hangi checklist adımına girilsin?', 'Which checklist step should "' + (parts[1] || parts[0]) + '" go to?')) + '</span>'
          + '<select data-tr-type-select="' + html(key) + '">' + itemOptions('') + '</select>'
          + (suggested ? '<button type="button" class="cpaBtn sm" data-tr-ai-type="' + html(key) + '">' + html(T('LCW AI önerisi: ', 'LCW AI suggests: ') + itemLabel(suggested) + T(' · Uygula', ' · Apply')) + '</button>' : '')
          + '<span class="trNewItem" hidden><input type="text" data-tr-new-tr maxlength="160" value="' + html(newTr) + '" placeholder="' + html(T('Adım adı (Türkçe)', 'Step name (Turkish)')) + '">'
          + '<input type="text" data-tr-new-en maxlength="160" value="' + html(newEn) + '" placeholder="' + html(T('Adım adı (İngilizce)', 'Step name (English)')) + '">'
          + '<button type="button" class="cpaBtn sm" data-tr-create="' + html(key) + '">' + html(T('Oluştur', 'Create')) + '</button></span></div>';
      }).join('') + '</section>';
  }
  function summaryHtml(plans) {
    const count = function (fn) { return ui.entries.filter(fn).length; };
    const warnings = ui.entries.reduce(function (n, e) { const review = reviewFor(e); return n + (review ? Math.max(review.risks.length, review.blocked ? 1 : 0) : 0) + (e.report.uyarilar || []).filter(function (w) { return !review || !['aiNote', 'aiExtracted'].includes(w.code); }).length; }, 0)
      + ui.files.reduce(function (n, f) { return n + (ui.ai.read && ui.ai.read[f.name] && ui.ai.read[f.name].ok ? 0 : (f.warnings || []).length); }, 0);
    const chips = [
      [T('Dosya', 'Files'), ui.files.length, ''],
      [T('Rapor', 'Reports'), new Set(ui.entries.map(function (e) { return e.report.talepNo || e.id; })).size, ''],
      [T('Sipariş kapsamı', 'Order scopes'), ui.entries.length, ''],
      [T('Tam eşleşme', 'Exact'), count(function (e) { return e.match.level === 'exact'; }), 'green'],
      [T('Kısmi', 'Partial'), count(function (e) { return e.match.level === 'partial'; }), 'orange'],
      [T('Belirsiz', 'Ambiguous'), count(function (e) { return e.match.level === 'ambiguous'; }), 'orange'],
      [T('Eşleşmedi', 'Not matched'), count(function (e) { return e.match.level === 'none' && !e.ignored; }), 'red'],
      [T('Dikkate alınmadı', 'Ignored'), count(function (e) { return e.ignored; }), 'blue'],
      [T('Uyarı', 'Warnings'), warnings, warnings ? 'orange' : ''],
      [T('Yazılacak', 'To write'), plans.filter(function (p, i) { return p.ready && p.next && ui.entries[i].include; }).length, 'blue'],
    ];
    return '<div class="trChips">' + chips.map(function (c) { return '<span class="cpaChip is-static' + (c[2] ? ' tone-' + c[2] : '') + '"><span class="n">' + c[1] + '</span><span class="l">' + html(c[0]) + '</span></span>'; }).join('') + '</div>';
  }
  function elementKeyOf(entry) { return Checklist().Components.elementKey(entry && entry.element || ''); }
  function selectionConflicts(plans) {
    const targets = new Map(), reports = new Set();
    let duplicate = false;
    ui.entries.forEach(function (entry, i) {
      if (!entry.include || !plans[i].ready || !plans[i].next) return;
      const partTarget = Checklist().Components.parseItem(entry.itemId) ? entry.itemId : '';
      const reportTarget = [entry.report.talepNo, entry.chosen, partTarget].join('::');
      if (reports.has(reportTarget)) duplicate = true;
      reports.add(reportTarget);
      // Aynı adımda farklı bileşenler farklı durum alabilir (Ana Kumaş / Yaka Ribanası).
      const key = answerKey(entry.chosen, entry.itemId) + '::' + elementKeyOf(entry);
      if (!targets.has(key)) targets.set(key, new Set());
      targets.get(key).add(plans[i].next);
    });
    return duplicate || [...targets.values()].some(function (states) { return states.size > 1; });
  }
  function testDetailsHtml(report) {
    const tests = report.testler || [];
    if (!tests.length) return '';
    return '<details><summary>' + html(T('Test ayrıntıları', 'Test details') + ' (' + tests.length + ')') + '</summary><ul class="trWarnings">' + tests.map(function (test) {
      const result = E().resultLabel(test.sonuc, lang()) || T('Değerlendirilmedi', 'Not assessed');
      return '<li>' + html(test.ad + ' — ' + result + (test.sourcePage ? T(' · sayfa ', ' · page ') + test.sourcePage : '')) + '</li>';
    }).join('') + '</ul></details>';
  }
  function fileReadingHtml() {
    const files = ui.files.filter(function (file) { return file.reading; });
    if (!files.length) return '';
    return '<section class="trIssues"><b>' + html(T('Belge okuma özeti', 'Document reading summary')) + '</b><ul class="trWarnings">' + files.map(function (file) {
      const read = file.reading;
      const status = read.status === 'text' ? T('Metin okundu', 'Text read') : read.status === 'partial' ? T('Kısmen okundu; eksik kaynakları inceleyin', 'Partly read; review missing sources') : read.status === 'visual' ? T('Görsel okuma gerekiyor', 'Visual reading required') : T('Desteklenmeyen tür', 'Unsupported type');
      const counts = [read.reports + T(' rapor', ' report(s)'), read.tests + T(' test', ' test(s)')];
      if (read.pdfPages) counts.push(read.textPages + '/' + read.pdfPages + T(' PDF sayfası', ' PDF pages'));
      if (read.attachments) counts.push(read.attachments + T(' ek', ' attachment(s)'));
      return '<li><b>' + html(file.name) + '</b> — ' + html(status + ' · ' + counts.join(' · ')) + '</li>';
    }).join('') + '</ul></section>';
  }
  function fileIssuesHtml() {
    const issues = ui.files.filter(function (f) { return !(ui.ai.read && ui.ai.read[f.name] && ui.ai.read[f.name].ok) && (f.status !== 'parsed' || (f.warnings || []).length); });
    if (!issues.length) return '';
    return '<section class="trIssues"><b>' + html(T('Okunamayan / tanınmayan dosyalar', 'Unread / unrecognised files')) + '</b><ul class="trWarnings">'
      + issues.map(function (f) {
        const reasons = (f.warnings || []).map(function (w) {
          if (w.code === 'unrecognized' && f.reading && f.reading.status === 'text') return T('Metin okundu; rapor şablonu tanınmadı. LCW AI incelemesi gerekiyor.', 'Text was read; the report template was not recognised. LCW AI review is required.');
          if (w.code === 'unsupported') return T('Desteklenmeyen dosya türü.', 'Unsupported file type.');
          if (w.code === 'readError') return T('Dosya okunamadı.', 'The file could not be read.');
          return E().warningText(w, lang());
        });
        const aiRead = ui.ai.read && ui.ai.read[f.name];
        if (aiRead && aiRead.ok) return '<li><b>' + html(f.name) + '</b> — ' + html(T('LCW AI okudu → talep ', 'Read by LCW AI → request ') + aiRead.talepNo) + '</li>';
        if (aiRead) reasons.push(T('LCW AI de okuyamadı.', 'LCW AI could not read it either.'));
        return '<li><b>' + html(f.name) + '</b> — ' + html(reasons.join(' ') || T('Tanınmadı.', 'Not recognised.')) + '</li>';
      }).join('') + '</ul></section>';
  }
  function currentOwner() { return String(root.BL_USER_CONTEXT && root.BL_USER_CONTEXT.id || root.state && root.state.currentUser && root.state.currentUser.id || ''); }
  function activeEntry() { return ui.entries.find(function (entry) { return entry.id === ui.activeEntry; }) || ui.entries[0] || null; }
  function draftPayload() {
    return { note: ui.note || '', tab: ui.tab || 'report', activeEntry: String(Math.max(0, ui.entries.indexOf(activeEntry()))), typeMap: ui.newTypeMap || {},
      entries: ui.entries.map(function (entry) { return { reportId: entry.report.talepNo, scope: entry.scope && entry.scope.orderCode || '', chosen: entry.chosen, itemId: entry.itemId, status: entry.status || '', element: entry.element || '', manual: Boolean(entry.manualMatch), manualAdded: Boolean(entry.manualAdded), partOf: entry.partOf ? String(ui.entries.findIndex(function (parent) { return parent.id === entry.partOf; })) : '' }; }) };
  }
  function saveIndicator() {
    const label = ui.modal && ui.modal.querySelector('[data-tr-save-state]');
    if (label) label.textContent = ui.saveError ? T('Taslak kaydedilemedi · notlar bu pencerede korunuyor', 'Draft save failed · notes are preserved in this window') : ui.draftPromise || ui.draftTimer ? T('Taslak kaydediliyor…', 'Saving draft…') : ui.operationId ? T('Taslak kaydedildi · kapatıp devam edebilirsiniz', 'Draft saved · close and resume anytime') : T('Dosyalar ve taslaklar inceleme geçmişinde korunur', 'Files and drafts are retained in review history');
  }
  async function flushDraft() {
    if (ui.draftTimer) { root.clearTimeout(ui.draftTimer); ui.draftTimer = null; }
    if (!ui.operationId || ui.restoring || ui.ownerId !== currentOwner()) return;
    if (ui.draftPromise) { await ui.draftPromise; return flushDraft(); }
    const payload = draftPayload(), serialized = JSON.stringify(payload);
    if (serialized === ui.savedDraft) return;
    const operationId = ui.operationId, owner = ui.ownerId;
    const pending = jsonFetch(API + '/operations/' + encodeURIComponent(operationId) + '/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: ui.draftRevision || 0, draft: payload }) }).then(function (saved) {
        if (ui.operationId === operationId && ui.ownerId === owner && owner === currentOwner()) { ui.draftRevision = saved.revision; ui.savedDraft = serialized; ui.saveError = ''; }
      }).catch(function (error) { if (ui.operationId === operationId && owner === currentOwner()) ui.saveError = error.message; throw error; }).finally(function () { if (ui.draftPromise === pending) ui.draftPromise = null; saveIndicator(); });
    ui.draftPromise = pending;
    saveIndicator();
    await ui.draftPromise;
  }
  function scheduleDraft() {
    if (!ui.operationId || ui.restoring || ui.busy || ui.saveError || ui.ownerId !== currentOwner()) return;
    if (JSON.stringify(draftPayload()) === ui.savedDraft) return;
    if (ui.draftTimer) root.clearTimeout(ui.draftTimer);
    ui.draftTimer = root.setTimeout(function () { ui.draftTimer = null; flushDraft().catch(function (error) { toast(error.message); }); }, 350);
  }
  function phaseLabel(phase) {
    return ({ parsed: T('Belge okundu', 'Document read'), analysing: T('Analizi sürdür', 'Resume analysis'), reviewed: T('İnceleme hazır', 'Review ready'), committed: T('Kaydedildi', 'Saved') })[phase] || T('İnceleme', 'Review');
  }
  async function refreshHistory() {
    const owner = ui.ownerId;
    const result = await jsonFetch(API + '/operations');
    if (owner === ui.ownerId && owner === currentOwner()) ui.history = result.operations || [];
  }
  function packetMatchesPage(packet) {
    if (!packet) return false;
    const current = currentCpSnapshot(false), rows = new Map(current.rows.map(function (row) { return [row.key, row]; }));
    return packet.cp.rows.length === current.rows.length && packet.cp.rows.every(function (row) {
      const client = rows.get(row.key);
      const states = function (record) { return Object.fromEntries((record.checklist || []).map(function (item) { return [item.itemId, { state: item.answer && item.answer.state, source: item.answer && item.answer.source }]; }).sort(function (a, b) { return a[0].localeCompare(b[0]); })); };
      return client && Object.entries(row.fields || {}).every(function (pair) { return pair[0] === 'Priority' || JSON.stringify(client.fields[pair[0]]) === JSON.stringify(pair[1]); }) && JSON.stringify(states(client)) === JSON.stringify(states(row));
    });
  }
  function restoreEntries(reports, assessment, draft) {
    const bases = buildEntries(reports || []), reviewed = (assessment && assessment.assessments || []).map(function (review) {
      const base = bases.find(function (entry) { return entry.report.talepNo === review.reportId && (entry.scope && entry.scope.orderCode || entry.report.siparisKodu) === review.orderCode; }) || bases.find(function (entry) { return entry.report.talepNo === review.reportId; });
      if (!base) return null;
      const entry = Object.assign({}, base, { id: 'r' + ui.seq++, chosen: review.orderKey || '', itemId: review.step || base.itemId });
      const row = cpRows().find(function (row) { const a = analysisFor(row); return a && a.orderKey === review.orderKey; });
      if (row) { entry.candidates = [{ key: review.orderKey, row: row }]; entry.ignored = false; entry.match = { level: 'partial', reason: 'ai', candidates: entry.candidates }; }
      entry.scope = { orderCode: review.orderCode, requiresReview: review.scope !== 'verified', confidence: review.scope === 'verified' ? 'labelled' : 'candidate' };
      return entry;
    }).filter(Boolean);
    bases.forEach(function (base) { if (!reviewed.some(function (entry) { return entry.report.talepNo === base.report.talepNo; })) reviewed.push(base); });
    const descriptors = draft && draft.entries || [];
    if (!descriptors.length) { ui.entries = reviewed; }
    else ui.entries = descriptors.flatMap(function (saved) {
      const base = reviewed.find(function (entry) { return entry.report.talepNo === saved.reportId && (entry.scope && entry.scope.orderCode || '') === saved.scope; }) || reviewed.find(function (entry) { return entry.report.talepNo === saved.reportId; });
      if (!base) return [];
      const entry = Object.assign({}, base, { id: 'r' + ui.seq++ });
      if (saved.manual || saved.manualAdded || saved.chosen !== entry.chosen) changeMatch(entry, saved.chosen);
      entry.manualAdded = saved.manualAdded === true;
      entry.chosen = saved.chosen || '';
      entry.itemId = saved.itemId || '';
      entry.status = statusIdList().includes(saved.status) ? saved.status : '';
      entry.element = Checklist().Components.elementName(saved.element || '');
      entry.draftIndex = descriptors.indexOf(saved);
      return [entry];
    });
    ui.entries.forEach(function (entry) {
      const saved = descriptors[entry.draftIndex];
      const parent = saved && saved.partOf !== '' && ui.entries.find(function (candidate) { return candidate.draftIndex === Number(saved.partOf); });
      entry.partOf = parent && parent !== entry && parent.report.talepNo === entry.report.talepNo ? parent.id : '';
    });
    ui.entries.forEach(function (entry) { delete entry.draftIndex; });
    // Saved choices are drafts, never restored approval or overwrite consent.
    ui.entries.forEach(function (entry) { entry.include = false; entry.reviewVerified = false; entry.override = false; });
    ui.activeEntry = (ui.entries[Number(draft && draft.activeEntry) || 0] || ui.entries[0] || {}).id || '';
  }
  async function resumeOperation(id, options) {
    if (!options && (ui.busy || ui.ai.state === 'running')) { toast(T('İşlem sürüyor; bitmesini bekleyin veya analizi durdurun.', 'An operation is running; wait for it or stop the assessment.')); return; }
    await flushDraft();
    const owner = ui.ownerId;
    ui.restoring = true; render();
    try {
      const sync = root.BLChecklistSupplierSync;
      if (sync && typeof sync.loadShared === 'function') {
        if (!await sync.loadShared()) throw new Error(T('Güncel checklist yüklenemedi; yeniden deneyin.', 'The current checklist could not be loaded; try again.'));
        if (typeof sync.syncAnswerChanges === 'function') await sync.syncAnswerChanges();
      }
      await flushPreferences();
      if (owner !== currentOwner()) return;
      const result = await jsonFetch(API + '/operations/' + encodeURIComponent(id) + '/resume', { method: 'POST' });
      if (owner !== ui.ownerId || owner !== currentOwner()) return;
      ui.operationId = result.operationId; ui.session = result.sessionId; ui.files = result.files || []; ui.readOnly = result.readOnly === true; ui.phase = result.phase;
      ui.store = await jsonFetch(API);
      if (owner !== currentOwner()) return;
      ui.note = result.draft && result.draft.note || ''; ui.tab = result.draft && result.draft.tab || 'report'; ui.newTypeMap = result.draft && result.draft.typeMap || {};
      ui.draftRevision = result.draftRevision; ui.saveError = ''; ui.done = result.readOnly ? [T('Bu inceleme daha önce kaydedildi. Rapor ve kaynaklar geçmişte korunuyor.', 'This review was saved previously. Reports and sources remain in history.')] : null;
      const assessment = result.ai && result.ai.assessment, packet = result.ai && result.ai.packet;
      ui.ai = { state: assessment ? 'done' : 'idle', message: '', progress: '', model: '', reviews: Object.fromEntries((assessment && assessment.assessments || []).map(function (review) { return [root.BLTestReportAssessment.keyOf(review), review]; })),
        packet: packet || null, unresolved: assessment && assessment.unresolvedSourceIds || [], read: {}, localSnapshot: result.reviewCurrent && packetMatchesPage(packet) ? localReviewSnapshot() : '' };
      restoreEntries(result.reports, assessment, result.draft);
      (packet && packet.sources || []).forEach(function (source) {
        const review = (assessment && assessment.assessments || []).find(function (item) { return item.evidence.some(function (ref) { return ref.sourceId === source.id; }); });
        if (review) ui.ai.read[source.name] = { ok: true, talepNo: review.reportId };
      });
      ui.historyOpen = false; ui.savedDraft = JSON.stringify(draftPayload());
      await refreshHistory();
    } finally { ui.restoring = false; render(); }
    root.BLMotionPlus && root.BLMotionPlus.play('card', ui.modal && ui.modal.querySelector('.trFocusColumns'));
  }
  function sourceFiles(entry) {
    const files = new Map();
    (ui.ai.packet && ui.ai.packet.sources || []).forEach(function (source) { if (source.fileId) files.set(source.fileId, { id: source.fileId, name: source.name, kind: source.kind }); });
    (entry ? [entry] : ui.entries).forEach(function (item) { (item.report.dosyalar || []).forEach(function (file) { if (file.stagingId) files.set(file.stagingId, { id: file.stagingId, name: file.ad, kind: file.tur }); }); });
    ui.files.forEach(function (file) { (file.sources || []).forEach(function (source) { if (source.fileId) files.set(source.fileId, { id: source.fileId, name: source.name, kind: source.kind }); }); if (file.ai && file.ai.uploadId) files.set(file.ai.uploadId, { id: file.ai.uploadId, name: file.name, kind: file.kind }); });
    return [...files.values()];
  }
  function sourceLinks(entry) {
    return sourceFiles(entry).map(function (file) { return '<a class="trFocusFile" href="' + API + '/staged/' + encodeURIComponent(ui.session) + '/' + encodeURIComponent(file.id) + '" target="_blank" rel="noopener">' + html(file.name) + '<span>' + html(T('Orijinali aç', 'Open original')) + ' ↗</span></a>'; }).join('') || '<p class="trMuted">' + html(T('Kaynak dosyalar analiz hazır olduğunda burada görünür.', 'Source files appear here when the assessment is ready.')) + '</p>';
  }
  function modelSource(entry) {
    const row = entry && rowFor(entry);
    if (!row || typeof root.tableRowImageSource !== 'function') return '';
    const source = root.tableRowImageSource(row).source || '';
    try { const url = new URL(source, root.location.origin); if (url.origin === root.location.origin && url.pathname.startsWith('/api/')) return url.href; } catch (_) {}
    return /^(?:blob:|data:image\/(?:png|jpe?g|webp);base64,)/i.test(source) ? source : '';
  }
  function focusEvidence(entry) {
    const review = entry && reviewFor(entry);
    return (review && review.evidence || []).map(function (ref, i) {
      const source = ui.ai.packet && ui.ai.packet.sources.find(function (item) { return item.id === ref.sourceId; });
      return '<blockquote class="trFocusEvidence"><b>' + html(T('Kaynak kanıtı ', 'Source evidence ') + '[' + (i + 1) + '] · ' + (source && source.name || ref.sourceId) + ' · ' + (ref.page > 0 ? T('Sayfa ', 'Page ') + ref.page : T('E-posta metni', 'Email text'))) + '</b><p>' + html(ref.quote) + '</p></blockquote>';
    }).join('');
  }
  function render() {
    scheduleDraft();
    if (!ui.modal) return;
    const View = root.BLTestReportFocusView;
    if (!View) return;
    ui.modal.querySelector('#_blTestReportTitle').textContent = T('Belge Operasyon Merkezi', 'Document Operations Center');
    ui.modal.querySelector('header small').textContent = T('Test raporu · e-posta · Lab Dip / ROS', 'Test report · email · Lab Dip / ROS');
    ui.modal.querySelector('[data-tr-history-label]').textContent = T('Geçmiş', 'History');
    ui.modal.querySelector('[data-tr-pick-label]').textContent = T('Belge ekle', 'Add document');
    ui.modal.querySelector('footer [data-tr-close]').textContent = T('Kapat', 'Close');
    ui.ai.cpChanged = Boolean(ui.ai.packet && ui.ai.localSnapshot !== localReviewSnapshot());
    const entry = activeEntry(), row = entry && rowFor(entry), p = entry && plan(entry), canonical = root.BLCanonicalFields;
    const field = function (id, fallback) { return row ? canonical ? canonical.value(row, 'cp', id) : value(row, fallback) : ''; };
    const plans = ui.entries.map(plan), conflict = selectionConflicts(plans);
    const body = ui.modal.querySelector('[data-tr-body]'), footer = ui.modal.querySelector('[data-tr-commit]');
    const query = text(ui.historyQuery).toLocaleLowerCase(lang());
    body.innerHTML = View.render({ T: T, entry: entry, session: ui.session, busy: ui.busy || ui.restoring, operationId: ui.operationId, historyOpen: ui.historyOpen, query: ui.historyQuery || '',
      history: (ui.history || []).filter(function (item) { return !query || [item.name, (item.reports || []).join(' ')].join(' ').toLocaleLowerCase(lang()).includes(query); }).map(function (item) { return Object.assign({}, item, { phaseLabel: item.id === ui.operationId && ui.ai.state === 'running' ? T('Analiz sürüyor', 'Assessment running') : phaseLabel(item.phase) }); }),
      readOnly: ui.readOnly, stale: !ui.readOnly && ui.ai.cpChanged, phaseLabel: phaseLabel(ui.phase), done: ui.done, tab: ui.tab || 'report', note: ui.note || '',
      modelName: field('modelName', ['Model Name']), orderCode: field('orderCode', ['Order Code']), colour: field('colour', ['Colour']), image: modelSource(entry),
      options: ui.entries.map(function (item) { return { id: item.id, label: [item.report.talepNo, item.scope && item.scope.orderCode || item.report.siparisKodu, item.itemId ? itemLabel(item.itemId) : ''].filter(Boolean).join(' · ') }; }), filesCount: ui.files.length, entriesCount: ui.entries.length,
      matchBadge: entry ? levelBadge(entry) : '', matchControls: entry ? ui.readOnly ? html(rowLabel(row)) : rowCell(entry) : '',
      aiBar: ui.readOnly ? '' : aiStatusHtml(), aiReview: entry ? aiReviewHtml(entry) : '',
      warnings: entry ? '<div class="trFocusWarnings">' + (entry.report.uyarilar || []).filter(function (warning) { return !['aiNote', 'aiExtracted'].includes(warning.code); }).map(function (warning) { return '<p>' + html(E().warningText(warning, lang())) + '</p>'; }).join('') + '</div>' : '',
      itemOptions: entry ? itemOptions(entry.itemId, entry) : '', partControls: entry ? partPicker(entry) : '', changeControls: entry ? changeCell(entry, p) : '',
      canSelect: !ui.busy && !ui.readOnly && p && p.ready && Boolean(p.next), included: entry && entry.include,
      sourceLinks: sourceLinks(entry), readingDetails: fileReadingHtml(), resultBadge: entry ? resultBadge(entry.report) : '', resultLabel: function (result) { return E().resultLabel(result, lang()); },
      evidence: focusEvidence(entry), descriptions: entry ? E().reportDescriptions(entry.report).map(function (description) { return '<p>' + html(description) + '</p>'; }).join('') : '',
      issues: (conflict ? '<p role="alert">' + html(T('Tekrarlanan hedefleri veya çelişen durumları düzeltin.', 'Resolve duplicate targets or conflicting statuses.')) + '</p>' : '') + fileIssuesHtml() + (entry && !entry.itemId ? typeMappingHtml() : '') });
    const ready = plans.filter(function (item, i) { return item.ready && item.next && ui.entries[i].include; }).length;
    footer.hidden = ui.readOnly; footer.disabled = ui.busy || ui.restoring || !ready || conflict; footer.textContent = T('Onayla ve yaz', 'Confirm and write') + ' (' + ready + ')';
    ui.modal.querySelector('[data-tr-pick]').disabled = ui.busy || ui.restoring || ui.ai.state === 'running';
    saveIndicator();
    const revealKey = ui.operationId + ':' + (entry && entry.chosen || '');
    if (revealKey !== ui.revealKey) { ui.revealKey = revealKey; root.BLMotionPlus && root.BLMotionPlus.play('card', body.querySelector('.trFocusModel')); }
  }


  /* -------------------------------------------------------- olaylar */
  async function handleFiles(fileList) {
    if (ui.busy || ui.restoring) return;
    if (ui.ai.state === 'running') { toast(T('Analiz sürüyor. Bitmesini bekleyin veya analizi durdurun.', 'An assessment is running. Wait for it or stop it.')); return; }
    const all = Array.from(fileList || []);
    const files = all.filter(function (f) { return ACCEPT.test(f.name || ''); });
    const skipped = all.filter(function (f) { return !ACCEPT.test(f.name || ''); });
    if (!files.length) { toast(T('Desteklenen dosya yok (.msg, .eml, .pdf, görsel).', 'No supported files (.msg, .eml, .pdf, image).')); return; }
    if (files.length > 30) { toast(T('Tek seferde en fazla 30 dosya bırakılabilir.', 'Up to 30 files can be dropped at once.')); return; }
    if (files.some(function (file) { return !file.size || file.size > 40 * 1024 * 1024; })) { toast(T('Dosya boş ya da 40 MB sınırını aşıyor.', 'The file is empty or exceeds the 40 MB limit.')); return; }
    try { await flushDraft(); } catch (error) { toast(error.message); return; }
    cancelAi();
    const owner = currentOwner();
    ui.busy = true; ui.done = null; render();
    try {
      const payload = { files: [], operation: true };
      for (const file of files) payload.files.push({ name: file.name, base64: await fileBase64(file) });
      if (owner !== currentOwner()) return;
      const responses = await Promise.all([
        jsonFetch(API + '/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        jsonFetch(API),
      ]);
      const parsed = responses[0];
      if (owner !== currentOwner()) return;
      ui.store = responses[1];
      ui.session = parsed.sessionId;
      ui.operationId = parsed.operationId || ''; ui.readOnly = false; ui.note = ''; ui.tab = 'report'; ui.draftRevision = 0; ui.savedDraft = ''; ui.saveError = ''; ui.phase = 'parsed';
      ui.files = parsed.files.concat(skipped.map(function (f) { return { name: f.name, status: 'unsupported', warnings: [{ code: 'unsupported' }] }; }));
      ui.newTypeMap = {};
      ui.entries = buildEntries(parsed.reports || []);
      ui.activeEntry = (ui.entries[0] || {}).id || '';
      ui.ai = { state: 'idle', message: '', progress: '', reviews: {}, model: '', read: {} };
      if (ui.operationId) await refreshHistory();
    } catch (error) {
      toast(T('Test raporları okunamadı: ', 'Test reports could not be read: ') + (error.message || error));
    } finally {
      if (owner === currentOwner()) { ui.busy = false; render(); }
    }
    if (ui.session) runAi({ interactive: false });
  }

  /* ----------------------------------------------------------- LCW AI */
  function aiDone() { return ui.aiRun; }
  async function stagedFile(candidate) {
    const response = await root.fetch(API + '/staged/' + encodeURIComponent(ui.session) + '/' + encodeURIComponent(candidate.ai.uploadId), { cache: 'no-store' });
    if (!response.ok) throw new Error(T('Geçici dosya alınamadı.', 'The staged file could not be read.'));
    const blob = await response.blob();
    return new File([blob], candidate.ai.uploadName || candidate.name, { type: blob.type || 'application/pdf' });
  }
  /* Okuma yedeği: brief'teki extractWithAI(file) → aynı rapor şeması.
     Cevap sunucuda motorun doğrulayıcısından geçer. */
  async function extractWithAI(candidate, run) {
    const AI = root.BuyerLogAI;
    const context = { fileName: candidate.name, mailText: candidate.ai.mailText || '', mailDate: candidate.ai.mailDate || '' };
    const task = T('Ekli test raporunu ya da test sonuç mailini oku ve alanları şemaya göre çıkar.', 'Read the attached test report or test result e-mail and extract the fields according to the schema.');
    const options = { source: 'test-report-extract', task: task, context: context, lang: lang() };
    const result = candidate.ai.uploadId
      ? await AI.askWithFiles(Object.assign(options, { files: [await stagedFile(candidate)] }))
      : await AI.ask(options);
    if (run !== ui.aiRun) return null;
    const data = result && (result.data || (result.structured && result.structured.partial));
    if (!data) throw new Error(T('LCW AI beklenen biçimde cevap vermedi.', 'LCW AI did not answer in the expected format.'));
    const payload = await jsonFetch(API + '/ai-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: ui.session, fileName: candidate.name, data: data }) });
    return payload && payload.report;
  }
  function addAiReport(report) {
    if (!report) return;
    const previous = ui.entries.filter(function (e) { return e.report.talepNo === report.talepNo; });
    const entries = buildEntries([report]);
    entries.forEach(function (entry) {
      const old = previous.find(function (e) { return (e.scope && e.scope.orderCode) === (entry.scope && entry.scope.orderCode); });
      if (old && entry.candidates.some(function (c) { return c.key === old.chosen; })) Object.assign(entry, { chosen: old.chosen, itemId: old.itemId, status: old.status, override: old.override });
      // A new AI read changes the evidence: require fresh explicit selection.
      entry.include = false;
    });
    ui.entries = ui.entries.filter(function (e) { return e.report.talepNo !== report.talepNo; }).concat(entries);
  }
  function reviewFor(entry) {
    if (!entry) return null;
    if (entry.manualMatch) return entry.originReview || null;
    return ui.ai.reviews[[entry.report.talepNo, entry.chosen, entry.itemId].join('::')]
      || Object.values(ui.ai.reviews).find(function (review) { return review.reportId === entry.report.talepNo && review.orderKey === entry.chosen; }) || null;
  }
  function currentCpSnapshot(includeDisplay) {
    const rows = cpRows(), decision = assistant().computeDecisionsForRows(rows), s = assistantState();
    const analysis = function (row) { return decision.byRow && decision.byRow.get(row); };
    const canonical = root.BLCanonicalFields;
    const cp = root.BLTestReportAssessment.cpSnapshot(rows, {
      keyOf: function (row) { const a = analysis(row); return a && a.orderKey || ''; },
      orderCodeOf: function (row) { return canonical ? canonical.value(row, 'cp', 'orderCode') : value(row, ['Order Code']); },
      checklistOf: function (row) {
        const a = analysis(row), prefix = a && a.orderKey + '::';
        return Object.entries(s && s.answers || {}).filter(function (pair) { return prefix && pair[0].startsWith(prefix); }).map(function (pair) { return { itemId: pair[0].slice(prefix.length), answer: pair[1] }; });
      },
    });
    const table = includeDisplay !== false && root.BLAIScreenData && root.BLAIScreenData.table('cp', { all: true });
    if (table) cp.displayTable = { columns: table.columns.map(function (column) { return { key: column.key, label: column.label }; }),
      rows: table.rows.map(function (row) { return table.columns.map(function (column) { return column.readValue(row); }); }), totalRows: table.rows.length };
    return cp;
  }
  function localReviewSnapshot() {
    const cp = currentCpSnapshot(false);
    // Rendering personal rules may update this display field asynchronously.
    // Match the server freshness check; the full AI packet still retains it.
    cp.rows.forEach(function (row) { delete row.fields.Priority; });
    cp.columns = cp.columns.filter(function (key) { return key !== 'Priority'; });
    return JSON.stringify({ cp: cp, steps: catalog(), statuses: customStatusList() });
  }
  async function flushPreferences() {
    if (!root.BLStorage || typeof root.BLStorage.flushPending !== 'function') return;
    let timeout;
    try { await Promise.race([root.BLStorage.flushPending(), new Promise(function (_, reject) { timeout = root.setTimeout(function () { reject(new Error('PREFERENCE_SAVE_TIMEOUT')); }, 8000); })]); }
    catch (_) { throw Object.assign(new Error(T('Bekleyen ayarlar kaydedilemedi; CP verilerini yükleyip yeniden deneyin.', 'Pending preferences could not be saved; reload CP data and try again.')), { code: 'TEST_REPORT_REVIEW_STALE' }); }
    finally { root.clearTimeout(timeout); }
  }
  async function runAi(options) {
    const AI = root.BuyerLogAI, Review = root.BLTestReportAssessment;
    if (!AI || !Review || !ui.session || ui.busy || ui.readOnly) return;
    const run = ++ui.aiRun, sessionId = ui.session, owner = currentOwner();
    if (ui.ai.controller) ui.ai.controller.abort();
    const controller = new AbortController();
    ui.entries.forEach(function (entry) { entry.include = false; entry.reviewVerified = false; entry.status = ''; });
    ui.ai = { state: 'running', message: '', progress: '', reviews: {}, read: {}, model: '', controller: controller, packet: null };
    const active = function () { return run === ui.aiRun && sessionId === ui.session && owner === currentOwner(); };
    const set = function (patch) { if (active()) { Object.assign(ui.ai, patch); render(); } };
    render();
    try {
      if (typeof root.ensureCpLoaded === 'function') {
        set({ progress: T('Güncel CP ve checklist yükleniyor…', 'Loading current CP and checklist…') });
        if (!await root.ensureCpLoaded({ force: Boolean(options && options.refreshCp) })) throw Object.assign(new Error(T('CP yüklenemedi; CP ekranını yenileyip tekrar deneyin.', 'CP could not be loaded; refresh the CP screen and try again.')), { code: 'TEST_REPORT_CP_INCOMPLETE' });
        if (!active()) return;
      }
      if (options && options.refreshCp) {
        ui.entries = buildEntries([...new Map(ui.entries.map(function (entry) { return [entry.report.talepNo, entry.report]; })).values()]);
        ui.entries.forEach(function (entry) { entry.include = false; });
      }
      let status = await AI.getStatus();
      if (status && !status.connected && options && options.interactive) status = await AI.connect();
      if (!active()) return;
      if (!status || !status.connected) { set({ state: 'offline', progress: '' }); return; }
      await flushPreferences();
      if (!active()) return;
      // Background checklist loading can still be saving promoted local
      // answers. Finish it before capturing the snapshot/server revision.
      const sync = root.BLChecklistSupplierSync;
      if (sync && typeof sync.loadShared === 'function') {
        set({ progress: T('Checklist cevapları eşitleniyor…', 'Synchronising checklist answers…') });
        if (!await sync.loadShared()) throw Object.assign(new Error(T('Güncel checklist yüklenemedi; yeniden deneyin.', 'The current checklist could not be loaded; try again.')), { code: 'TEST_REPORT_REVIEW_STALE' });
        if (typeof sync.syncAnswerChanges === 'function') await sync.syncAnswerChanges();
        await flushPreferences();
        if (!active()) return;
      }
      const localSnapshot = localReviewSnapshot();
      const steps = catalog().map(function (item) { return { id: item.id, name: isEn() ? item.en : item.tr }; });
      // Include existing set-component step IDs; no synthetic checklist IDs.
      const answers = assistantState() && assistantState().answers || {};
      Object.keys(answers).forEach(function (key) {
        const at = key.indexOf('::'), id = key.slice(at + 2);
        if (at >= 0 && !steps.some(function (step) { return step.id === id; })) steps.push({ id: id, name: itemLabel(id) });
      });
      const statuses = statusIdList().map(function (id) {
        const custom = customStatusList().find(function (c) { return c.id === id; });
        return { id: id, name: statusText(id), resolved: custom ? custom.resolved === true : (id === 'approved' || id === 'notRequired') };
      });
      set({ progress: T('Tüm CP siparişleri ve kaynak metinler hazırlanıyor…', 'Preparing all CP orders and source texts…') });
      const prepared = await jsonFetch(API + '/prepare-review', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, cp: currentCpSnapshot(), checklistSteps: steps, checklistStatuses: statuses }) });
      if (!active()) return;
      const packet = prepared.packet, batches = Review.batches(packet), results = [];
      let model = '';
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        set({ progress: T('Kaynaklar ve siparişler değerlendiriliyor: ', 'Assessing sources and orders: ') + (i + 1) + '/' + batches.length });
        const file = new File([JSON.stringify({ ...packet, focusSourceIds: batch.sourceIds })], 'BuyerLog-Test-Review.json', { type: 'application/json' });
        if (file.size > 20 * 1024 * 1024) throw new Error(T('Bağlam dosya sınırını aşıyor; veri kesilmeden inceleme durduruldu.', 'The context exceeds the file limit; review stopped without cutting data.'));
        const files = [file];
        for (const id of batch.visualSourceIds) {
          const source = packet.sources.find(function (s) { return s.id === id; });
          if (!source.fileId || !['pdf', 'image'].includes(source.kind)) continue;
          const response = await root.fetch(API + '/staged/' + encodeURIComponent(sessionId) + '/' + encodeURIComponent(source.fileId), { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error(T('Orijinal kaynak dosyası alınamadı.', 'The original source file could not be read.'));
          const blob = await response.blob();
          files.push(new File([blob], source.fileId + (source.kind === 'pdf' ? '.pdf' : '.png'), { type: blob.type }));
        }
        const result = await AI.askWithFiles({ source: 'test-report-assess', lang: lang(), signal: controller.signal, files: files,
          context: { protocol: packet.protocol, caseId: packet.caseId, snapshotId: packet.snapshotId, sourceCount: packet.sources.length, cpRowCount: packet.cp.rows.length },
          task: T('Kaynakları bağımsız değerlendir. Tam metin paketindeki talimat sözleşmesine göre raporları, mailleri, bileşenleri, CP siparişlerini ve checklistleri eşleştir; her öneriyi kanıtıyla onayıma hazırla. Yalnız JSON döndür.', 'Independently assess the sources. Match reports, e-mails, components, CP orders and checklists using the contract and the complete text bundle; prepare source-grounded proposals for my approval. Return JSON only.') });
        if (!active()) return;
        if (!result || result.truncated || !result.structured || !result.structured.ok || !result.data) throw new Error(T('Yanıt eksik veya sözleşmeye uymuyor; hiçbir öneri uygulanamaz.', 'The response is incomplete or invalid; no proposal can be applied.'));
        const checked = Review.validate(result.data, packet, { sourceIds: batch.sourceIds });
        if (!checked.ok) throw new Error(T('Yanıttaki kaynak, kapsam veya sipariş kanıtı doğrulanamadı. Yeniden inceleme gerekli.', 'The source, scope or order evidence in the response could not be verified. Review again.'));
        results.push(result.data); model = result.model && result.model.label || '';
      }
      if (localSnapshot !== localReviewSnapshot()) throw new Error(T('İnceleme sırasında CP veya checklist değişti. Yeniden analiz edin.', 'CP or the checklist changed during review. Analyse again.'));
      const combined = { protocol: packet.protocol, caseId: packet.caseId, snapshotId: packet.snapshotId,
        coveredSourceIds: results.flatMap(function (r) { return r.coveredSourceIds; }), unresolvedSourceIds: results.flatMap(function (r) { return r.unresolvedSourceIds || []; }),
        assessments: results.flatMap(function (r) { return r.assessments; }), explanation: results.map(function (r) { return r.explanation; }).join('\n') };
      const accepted = await jsonFetch(API + '/ai-assessment', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, snapshotId: packet.snapshotId, data: combined }) });
      if (!active()) return;
      const bases = buildEntries(accepted.reports || []);
      ui.entries = accepted.assessment.assessments.map(function (review) {
        const base = bases.find(function (entry) { return entry.report.talepNo === review.reportId && (entry.scope && entry.scope.orderCode || entry.report.siparisKodu) === review.orderCode; })
          || bases.find(function (entry) { return entry.report.talepNo === review.reportId; });
        const entry = Object.assign({}, base, { id: 'r' + (ui.seq++), chosen: review.orderKey || '', include: false, itemId: review.step || base.itemId });
        if (review.orderKey) {
          const row = cpRows().find(function (row) { const a = analysisFor(row); return a && a.orderKey === review.orderKey; });
          if (row) { entry.chosen = review.orderKey; entry.candidates = [{ key: review.orderKey, row: row }]; entry.ignored = false; entry.match = { level: 'partial', reason: 'ai', candidates: entry.candidates }; }
        }
        entry.scope = { orderCode: review.orderCode, requiresReview: review.scope !== 'verified', confidence: review.scope === 'verified' ? 'labelled' : 'candidate' };
        return entry;
      });
      // v7.0.290 — AI'ın öneri vermediği raporlar listeden düşmez: buyer onları
      // elle bir ya da birden çok siparişe bağlayabilir.
      bases.forEach(function (base) {
        if (!ui.entries.some(function (entry) { return entry.report.talepNo === base.report.talepNo; })) ui.entries.push(Object.assign({}, base, { include: false }));
      });
      ui.ai.reviews = Object.fromEntries(accepted.assessment.assessments.map(function (review) { return [Review.keyOf(review), review]; }));
      ui.ai.packet = packet; ui.ai.localSnapshot = localSnapshot;
      ui.phase = 'reviewed';
      packet.sources.forEach(function (source) {
        const review = accepted.assessment.assessments.find(function (item) { return item.evidence.some(function (ref) { return ref.sourceId === source.id; }); });
        if (review) ui.ai.read[source.name] = { ok: true, talepNo: review.reportId };
      });
      ui.entries.forEach(function (entry) {
        entry.include = false;
        const review = reviewFor(entry);
        if (review && review.step) entry.itemId = review.step;
      });
      const unresolved = accepted.assessment.unresolvedSourceIds.length;
      set({ state: 'done', progress: '', model: model, unresolved: accepted.assessment.unresolvedSourceIds,
        message: T(packet.sources.length + ' kaynak ve ' + packet.cp.rows.length + ' CP satırı gönderildi. ' + unresolved + ' kaynak çözümlenemedi. Öneriler seçilmedi; kanıtları inceleyip onaylayın.', packet.sources.length + ' sources and ' + packet.cp.rows.length + ' CP rows supplied. ' + unresolved + ' sources unresolved. Proposals remain unselected; review the evidence and approve.') });
      if (ui.operationId) refreshHistory().catch(function () {});
    } catch (error) {
      if (!active()) return;
      const message = typeof AI.errorText === 'function' && error.code && String(error.code).startsWith('LCWAI_') ? AI.errorText(error) : error.message || String(error);
      set({ state: 'error', progress: '', message: message, code: error.code || '' });
    }
  }
  function cancelAi() {
    ui.aiRun += 1;
    if (ui.ai.controller) ui.ai.controller.abort();
    ui.ai.state = 'error';
    ui.ai.message = T('İnceleme durduruldu. Devam etmek için yeniden analiz edin.', 'Review stopped. Analyse again to continue.');
    render();
  }

  function setTypeItem(typeKey, itemId) {
    ui.newTypeMap[typeKey] = itemId;
    ui.entries.forEach(function (entry) {
      if (!entry.ignored && entry.typeKey === typeKey && !entry.itemId) { entry.itemId = itemId; entry.include = Boolean(entry.chosen) && !entry.fromAi && !E().orderScopeNeedsReview(entry.report); if ((entry.report.labDipColors || []).length) entry.include = false; }
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
    if (ui.readOnly) return;
    ui.ai.cpChanged = Boolean(ui.ai.packet && ui.ai.localSnapshot !== localReviewSnapshot());
    const plans = ui.entries.map(plan);
    if (selectionConflicts(plans)) { toast(T('Tekrarlanan rapor/PO seçimini veya çelişen checklist durumlarını düzeltin.', 'Resolve duplicate report/PO selections or conflicting checklist statuses.')); return; }
    const chosen = ui.entries.filter(function (entry, i) { return entry.include && plans[i].ready && plans[i].next; });
    if (!chosen.length || ui.busy) return;
    ui.busy = true;
    const button = ui.modal.querySelector('[data-tr-commit]');
    button.disabled = true;
    ui.modal.querySelectorAll('[data-tr-body] input, [data-tr-body] select, [data-tr-body] button').forEach(function (control) { control.disabled = true; });
    try {
      const items = chosen.map(function (entry) {
        const row = rowFor(entry);
        return {
          talepNo: entry.report.talepNo, orderKey: entry.chosen, itemId: entry.itemId,
          confirmMatch: Boolean(entry.include),
          confirmEvidence: entry.reviewVerified === true,
          ...(isBuyerEntry(entry) ? { manualMatch: Object.assign({ fromOrderKey: entry.chosen, fromItemId: entry.itemId }, entry.manualMatch || {}, { buyer: true }), targetStatus: chosenStatus(entry) } : {}),
          context: {
            orderCode: value(row, ['Order Code']), plmId: value(row, ['PLM ID']), modelName: value(row, ['Model Name']),
            colourCode: value(row, ['C.Code']), checklistName: itemLabel(entry.itemId), checklistStatus: entry.report.talepNo,
          },
        };
      });
      const typeMap = {};
      chosen.forEach(function (entry) { if (entry.typeKey && ui.newTypeMap[entry.typeKey]) typeMap[entry.typeKey] = (Checklist().Components.parseItem(entry.itemId) || {}).baseId || entry.itemId; });
      const result = await jsonFetch(API + '/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: ui.session, snapshotId: ui.ai.packet ? ui.ai.packet.snapshotId : '', items: items, typeMap: typeMap }) });
      ui.store = await jsonFetch(API);
      // Checklist cevabı: satır + adım başına BÜTÜN raporlardan türetilir.
      const groups = new Map();
      chosen.forEach(function (entry, index) {
        const key = answerKey(entry.chosen, entry.itemId) + '::' + elementKeyOf(entry);
        if (!groups.has(key)) groups.set(key, { entry: entry, plan: plans[ui.entries.indexOf(entry)], attachments: [], manual: '', answerKey: answerKey(entry.chosen, entry.itemId) });
        if (chosenStatus(entry)) groups.get(key).manual = chosenStatus(entry);
        const res = result.results.find(function (r) { return r.talepNo === items[index].talepNo && r.orderKey === items[index].orderKey && r.itemId === items[index].itemId; });
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
          if (E().reportLinks(ui.store.links[talepNo]).some(function (link) { return link.orderKey === entry.chosen && link.itemId === entry.itemId; }) && ui.store.reports[talepNo]) reports.push(ui.store.reports[talepNo]);
        });
        const step = E().deriveStepStatus(reports);
        const previous = (s && s.answers && s.answers[group.answerKey]) || {};
        const attachments = new Map((previous.attachments || []).map(function (a) { return [a.id, a]; }));
        group.attachments.forEach(function (a) { if (attachments.size < MAX_ATTACHMENTS) attachments.set(a.id, a); });
        files += group.attachments.length;
        const numbers = new Set(String(previous.reportNumber || '').split(/[,;\s]+/).filter(Boolean));
        reports.forEach(function (r) { if (step.superseded.indexOf(r.talepNo) < 0) numbers.add(r.talepNo); });
        const meta = { attachments: [...attachments.values()], reportNumber: [...numbers].join(', ').slice(0, 300) };
        if (previous.note) meta.note = previous.note;
        const userOwned = group.plan.userOwned && !entry.override;
        // Lab Dip: bileşen/renk detaylarını ayrı kolonlar açmadan bu adımın
        // tek not hücresinde tut. Elle yazılmış kullanıcı notunu ezme.
        const labDipText = E().labDipSummary(reports, lang());
        if (labDipText && !userOwned) meta.note = labDipText;
        // Öncelik: önizlemede elle seçilen durum → kullanıcı girişi → analizden
        // türetilen durum (kullanıcı tanımlı özel durum eşleşmesi dâhil).
        const suggested = { status: group.plan.next };
        // v7.0.290 — Bileşen seçildiyse sonuç o bileşene yazılır; diğer bileşenler korunur.
        const element = Checklist().Components.elementName(entry.element || '');
        if (element) {
          const elementStatus = group.manual || (userOwned ? group.plan.current : (suggested.status || group.plan.current || 'open'));
          meta.elements = Checklist().Components.upsertElement(previous.elements, { name: element, state: elementStatus, reportNumber: entry.report.talepNo, at: new Date().toISOString() }, Checklist().normalizeStatus);
        }
        let saved;
        if (group.manual) { saved = assistant().setChecklistAnswer(analysis, entry.itemId, group.manual, Object.assign(meta, { source: 'test_report' })); }
        else if (userOwned) { saved = assistant().setChecklistAnswer(analysis, entry.itemId, group.plan.current, meta); }
        else { saved = assistant().setChecklistAnswer(analysis, entry.itemId, suggested.status || group.plan.current || 'open', Object.assign(meta, { source: 'test_report' })); }
        if (!saved) throw new Error(T('Checklist kaydedilemedi.', 'Checklist could not be saved.'));
        if (userOwned && !group.manual) kept += 1; else written += 1;
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
      if (result.operationArchiveWarning) ui.done.push(T('Rapor kaydedildi ancak geçmiş kaydı güncellenemedi. Aynı raporu yeniden onaylamadan önce kayıtlı raporu kontrol edin.', 'The report was saved, but history could not be updated. Check the saved report before approving it again.'));
      const done = ui.done;
      if (ui.operationId) { await resumeOperation(ui.operationId, { afterCommit: true }); ui.done = done; }
      else ui.session = null;
    } catch (error) {
      toast(T('Test raporları yazılamadı: ', 'Test reports could not be written: ') + (error.message || error));
    } finally {
      ui.busy = false;
      render();
    }
  }

  function bind(modal) {
    const close = function () { flushDraft().catch(function (error) { toast(error.message); }); modal.remove(); ui.modal = null; if (ui.trigger && ui.trigger.isConnected) ui.trigger.focus(); };
    modal.querySelectorAll('[data-tr-close]').forEach(function (b) { b.onclick = close; });
    modal.addEventListener('keydown', function (event) {
      if (root.document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); if (ui.historyOpen) { ui.historyOpen = false; render(); } else close(); }
      if (event.key === 'Tab') {
        const region = ui.historyOpen ? modal.querySelector('.trHistoryDrawer') : modal;
        const nodes = Array.from(region.querySelectorAll('button,a[href],input,select,textarea,summary')).filter(function (node) { return !node.disabled && node.getClientRects().length; });
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); if (last) last.focus(); }
        else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); if (first) first.focus(); }
      }
      if (['ArrowLeft', 'ArrowRight'].includes(event.key) && event.target.matches('[data-tr-tab]')) {
        event.preventDefault(); const tabs = Array.from(modal.querySelectorAll('[data-tr-tab]')); const at = tabs.indexOf(event.target); tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
      }
    });
    modal.addEventListener('input', function (event) {
      if (ui.busy) return;
      const input = event.target;
      if (input.matches('[data-tr-note]')) { ui.note = input.value; scheduleDraft(); saveIndicator(); return; }
      if (input.matches('[data-tr-history-search]')) { const at = input.selectionStart; ui.historyQuery = input.value; render(); const next = modal.querySelector('[data-tr-history-search]'); next.focus(); if (next.setSelectionRange) try { next.setSelectionRange(at, at); } catch (_) {} return; }
      if (!input.dataset.trSearch) return;
      const entry = ui.entries.find(function (e) { return e.id === input.dataset.trSearch; });
      entry.matchQuery = input.value;
      input.closest('details').querySelector('[data-tr-row]').innerHTML = matchOptions(entry);
    });
    modal.addEventListener('change', function (event) {
      if (ui.busy) return;
      const t = event.target;
      if (t.matches('[data-tr-active]')) { ui.activeEntry = t.value; render(); root.BLMotionPlus && root.BLMotionPlus.play('card', modal.querySelector('.trFocusColumns')); return; }
      if (t.matches('[data-tr-input]')) { handleFiles(t.files); t.value = ''; return; }
      const find = function (id) { return ui.entries.find(function (e) { return e.id === id; }); };
      if (t.dataset.trInclude) { find(t.dataset.trInclude).include = t.checked; render(); return; }
      if (t.dataset.trPart) { togglePart(find(t.dataset.trPart), t.value, t.checked); render(); return; }
      if (t.dataset.trElement) { const entry = find(t.dataset.trElement); entry.element = Checklist().Components.elementName(t.value); entry.include = false; render(); return; }
      if (t.dataset.trVerify) { const entry = find(t.dataset.trVerify); entry.reviewVerified = t.checked; entry.include = false; render(); return; }
      if (t.dataset.trOverride) { find(t.dataset.trOverride).override = t.checked; render(); return; }
      if (t.dataset.trStatus) { find(t.dataset.trStatus).status = t.value; render(); return; }
      if (t.dataset.trRow != null && t.dataset.trRow !== '') { changeMatch(find(t.dataset.trRow), t.value); render(); return; }
      if (t.dataset.trItem) {
        const e = find(t.dataset.trItem);
        if (e.manualMatch) { e.reviewVerified = false; e.include = false; e.status = ''; }
        dropParts(e);
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
      if (event.target.closest('[data-tr-pick]')) { modal.querySelector('[data-tr-input]').click(); return; }
      if (event.target.closest('[data-tr-history]')) { ui.historyOpen = !ui.historyOpen; if (ui.historyOpen) refreshHistory().then(function () { render(); const input = modal.querySelector('[data-tr-history-search]'); if (input) input.focus(); }).catch(function (error) { toast(error.message); }); render(); root.BLMotionPlus && root.BLMotionPlus.play('overlay', modal.querySelector('.trHistoryDrawer')); return; }
      const operation = event.target.closest('[data-tr-operation]');
      if (operation) { resumeOperation(operation.dataset.trOperation).catch(function (error) { toast(error.message); }); return; }
      const removeOperation = event.target.closest('[data-tr-delete]');
      if (removeOperation) {
        if (ui.busy || ui.ai.state === 'running') { toast(T('İşlem sürerken geçmiş kaydı silinemez.', 'History records cannot be deleted while an operation is running.')); return; }
        if (!root.confirm(T('Bu inceleme kaydı ve arşivdeki dosyaları silinsin mi? Checklist kayıtları etkilenmez.', 'Delete this review record and its archived files? Checklist records are unaffected.'))) return;
        const id = removeOperation.dataset.trDelete;
        flushDraft().then(function () { return jsonFetch(API + '/operations/' + encodeURIComponent(id), { method: 'DELETE' }); }).then(function () {
          if (id === ui.operationId) { cancelAi(); ui.operationId = ''; ui.session = null; ui.entries = []; ui.files = []; ui.note = ''; ui.readOnly = false; ui.done = null; }
          return refreshHistory();
        }).then(render).catch(function (error) { toast(error.message); }); return;
      }
      const tab = event.target.closest('[data-tr-tab]');
      if (tab) { ui.tab = tab.dataset.trTab; render(); modal.querySelector('[data-tr-tab="' + ui.tab + '"]').focus(); return; }
      if (event.target.closest('[data-tr-model-preview]')) {
        const source = modelSource(activeEntry()); if (!source) return;
        const dialog = root.document.createElement('dialog'); dialog.className = 'trModelPreview';
        dialog.innerHTML = '<button type="button" class="cpaBtn" aria-label="' + html(T('Kapat', 'Close')) + '">×</button><img src="' + html(source) + '" alt="' + html(T('Eşleşen model', 'Matched model')) + '">';
        root.document.body.appendChild(dialog); dialog.querySelector('button').onclick = function () { dialog.close(); }; dialog.addEventListener('close', function () { dialog.remove(); const button = ui.modal && ui.modal.querySelector('[data-tr-model-preview]'); if (button) button.focus(); }); dialog.showModal(); root.BLMotionPlus && root.BLMotionPlus.play('overlay', dialog); return;
      }
      if (ui.busy) return;
      const add = event.target.closest('[data-tr-add-po]');
      if (add) { addPo(ui.entries.find(function (e) { return e.id === add.dataset.trAddPo; })); render(); return; }
      const remove = event.target.closest('[data-tr-remove-po]');
      if (remove) { ui.entries = ui.entries.filter(function (e) { return e.id !== remove.dataset.trRemovePo || !e.manualAdded; }); render(); return; }
      const create = event.target.closest('[data-tr-create]');
      if (create) createItem(create.dataset.trCreate, create.closest('[data-tr-type]'));
      if (event.target.closest('[data-tr-ai-connect]')) runAi({ interactive: true });
      if (event.target.closest('[data-tr-cp-retry]')) runAi({ interactive: true, refreshCp: true });
      if (event.target.closest('[data-tr-ai-retry]')) runAi({ interactive: true });
      if (event.target.closest('[data-tr-ai-cancel]')) cancelAi();
      const applyType = event.target.closest('[data-tr-ai-type]');
      if (applyType) { const step = aiStepForType(applyType.dataset.trAiType); if (step) setTypeItem(applyType.dataset.trAiType, step); }
      const applyStatus = event.target.closest('[data-tr-ai-status]');
      if (applyStatus) {
        // AI durum önerisi de yalnız açık tıklamayla seçilir; yazma "Aktar" ile olur.
        const target = ui.entries.find(function (e) { return e.id === applyStatus.dataset.trAiStatus; });
        const suggestion = target && reviewFor(target);
        if (target && suggestion && suggestion.status && statusIdList().indexOf(suggestion.status) >= 0) { target.status = suggestion.status; render(); }
      }
      const apply = event.target.closest('[data-tr-ai-step]');
      if (apply) {
        // AI önerisi yalnız bu açık tıklamayla seçilir; talep tipi eşlemesi de önerilir.
        const entry = ui.entries.find(function (e) { return e.id === apply.dataset.trAiStep; });
        const review = entry && reviewFor(entry);
        if (entry && review && review.step) {
          entry.itemId = review.step;
          if (entry.typeKey && !(ui.store && ui.store.typeMap && ui.store.typeMap[entry.typeKey])) ui.newTypeMap[entry.typeKey] = review.step;
          render();
        }
      }
    });
    modal.addEventListener('dragover', function (event) {
      if (!event.dataTransfer || [].indexOf.call(event.dataTransfer.types || [], 'Files') < 0) return;
      event.preventDefault(); event.stopPropagation();
      modal.querySelector('.trFocusCenter').classList.add('is-file-over');
    });
    modal.addEventListener('dragleave', function (event) { if (!modal.contains(event.relatedTarget)) modal.querySelector('.trFocusCenter').classList.remove('is-file-over'); });
    modal.addEventListener('drop', function (event) {
      if (!event.dataTransfer) return;
      event.preventDefault(); event.stopPropagation();
      modal.querySelector('.trFocusCenter').classList.remove('is-file-over');
      const files = event.dataTransfer.files;
      if (!files || !files.length) { toast(T('Bırakılan öğe dosya içermiyor. Outlook\'tan maili .msg olarak kaydedip bırakın.', 'The dropped item has no file. Save the e-mail from Outlook as .msg and drop it.')); return; }
      handleFiles(files);
    });
    modal.querySelector('[data-tr-commit]').onclick = function () { commit(); };
  }

  async function open(files) {
    await ensureDeps();
    const owner = currentOwner();
    if (ui.ownerId !== owner) {
      if (ui.draftTimer) root.clearTimeout(ui.draftTimer); ui.draftTimer = null; ui.draftPromise = null;
      cancelAi(); if (ui.modal) ui.modal.remove(); ui.modal = null; ui.session = null; ui.operationId = ''; ui.entries = []; ui.files = []; ui.note = ''; ui.history = []; ui.done = null; ui.readOnly = false; ui.savedDraft = ''; ui.saveError = ''; ui.busy = false; ui.restoring = false; ui.ownerId = owner;
    }
    if (typeof root.ensureCpLoaded === 'function' && !await root.ensureCpLoaded()) throw new Error(T('CP yüklenemedi.', 'CP could not be loaded.'));
    if (!ui.modal) {
      ui.trigger = root.document.activeElement.closest('#cpToolsMenu') ? root.document.querySelector('#cpToolsBtn') : root.document.activeElement;
      const modal = root.document.createElement('div');
      modal.id = '_blTestReportImport';
      modal.className = 'cpaModalOverlay blMotionOverlay';
      modal.innerHTML = '<div class="cpaModal trModal trFocusCenter" role="dialog" aria-modal="true" aria-labelledby="_blTestReportTitle">'
        + '<header class="trCenterHeader"><div><b id="_blTestReportTitle">' + html(T('Belge Operasyon Merkezi', 'Document Operations Center')) + '</b>'
        + '<small>' + html(T('Test raporu · e-posta · Lab Dip / ROS', 'Test report · email · Lab Dip / ROS')) + '</small></div>'
        + '<div class="trCenterActions"><button type="button" class="cpaBtn" data-tr-history><span data-tr-history-label>' + html(T('Geçmiş', 'History')) + '</span></button>'
        + '<button type="button" class="cpaBtn primary" data-tr-pick><span data-tr-pick-label>' + html(T('Belge ekle', 'Add document')) + '</span></button>'
        + '<label class="sr-only" data-tr-drop><input type="file" data-tr-input multiple accept=".msg,.eml,.pdf,.png,.jpg,.jpeg,.webp" aria-label="' + html(T('İnceleme dosyaları', 'Review files')) + '"></label>'
        + '<button type="button" data-tr-close aria-label="' + html(T('Kapat', 'Close')) + '">×</button></div></header>'
        + '<div class="cpaModalBody trBody" data-tr-body></div>'
        + '<footer class="trCenterFooter"><span data-tr-save-state></span><button type="button" class="cpaBtn" data-tr-close>' + html(T('Kapat', 'Close')) + '</button>'
        + '<button type="button" class="cpaBtn primary" data-tr-commit disabled>' + html(T('Onayla ve yaz', 'Confirm and write')) + '</button></footer></div>';
      root.document.body.appendChild(modal);
      ui.modal = modal;
      bind(modal);
    }
    render();
    await refreshHistory();
    if (files && files.length) await handleFiles(files);
    else if (!ui.session && !ui.busy && ui.history.length) await resumeOperation(ui.history[0].id);
    render();
    const first = ui.modal && ui.modal.querySelector('[data-tr-history]'); if (first) first.focus();
  }

  root.BLTestReportImport = { open: open, runAi: runAi, extractWithAI: extractWithAI, resumeOperation: resumeOperation, flushDraft: flushDraft, _ui: ui, _plan: plan, _aiDone: aiDone, _changeMatch: changeMatch, _addPo: addPo, _togglePart: togglePart, _selectionConflicts: selectionConflicts };
  if (root.addEventListener) root.addEventListener('bl:user-access-applied', function () {
    if (ui.ownerId === currentOwner()) return;
    ui.aiRun += 1; if (ui.ai.controller) ui.ai.controller.abort(); if (ui.draftTimer) root.clearTimeout(ui.draftTimer);
    if (ui.modal) ui.modal.remove(); Object.assign(ui, { modal: null, busy: false, restoring: false, ownerId: currentOwner(), session: null, operationId: '', entries: [], files: [], history: [], note: '', savedDraft: '', saveError: '', draftPromise: null, readOnly: false, done: null, ai: { state: 'idle', message: '', reviews: {}, read: {} } });
  });
  if (root.MutationObserver && root.document) new root.MutationObserver(function () { if (ui.modal) render(); }).observe(root.document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})(typeof window !== 'undefined' ? window : globalThis);
