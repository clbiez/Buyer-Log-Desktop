/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — SİHİRBAZ (YALNIZ ARAYÜZ)

   Bu dosya karar VERMEZ. Bütün deterministik iş excel-import-workbook /
   -mapping / -match / -plan / -profiles modüllerindedir; modüle özgü
   okuma-yazma ise window.BLExcelImportBridge adaptörlerindedir.

   Akış:  Dosya → Sayfa → Sütunlar → Eşleşme → Gözden Geçir → Aktar

   Geri gitmek serbesttir. Eşleme, eşleşme kuralı, ayar veya satır kararı
   değiştiği anda plan ÇÖPE ATILIR ve gözden geçirme adımında yeniden
   kurulur. Bayat bir önizleme hiçbir koşulda uygulanmaz.
   =================================================================== */
(function (global) {
  'use strict';

  var Workbook = null, Mapping = null, Match = null, Plan = null, Profiles = null;
  function modules() {
    Workbook = global.BLExcelImportWorkbook; Mapping = global.BLExcelImportMapping;
    Match = global.BLExcelImportMatch; Plan = global.BLExcelImportPlan; Profiles = global.BLExcelImportProfiles;
    return Workbook && Mapping && Match && Plan && Profiles;
  }

  var STEPS = ['file', 'sheet', 'columns', 'match', 'review', 'import'];
  var PAGE_SIZE = 50;
  var state = null, host = null;

  function en() { return (global.appLang || document.documentElement.lang) === 'en'; }
  function T(tr, enText) { return en() ? enText : tr; }
  function esc(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function toast(message) { if (typeof global.showToast === 'function') global.showToast(message); }
  function display(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  }

  /* ---------------- DURUM ---------------- */

  function reset(moduleId, adapter) {
    state = {
      moduleId: moduleId, adapter: adapter, step: 'file', busy: false, error: '',
      fileName: '', workbook: null, sheets: [], sheetName: '',
      grid: null, analysis: null, table: null,
      assignments: {}, newColumns: [], matchFieldIds: [],
      options: { blankClears: false, createNew: adapter.canCreate !== false, includeHiddenRows: false, includeHiddenColumns: false, fillMergedCells: false, includeStructuralRows: false },
      decisions: { excludedSourceRows: [], ambiguousChoice: {}, duplicateResolution: {} },
      plan: null, page: 0, result: null, progress: null,
      profiles: [], profileMatches: [], appliedProfile: null, profileNotice: '',
    };
  }
  // Plan ancak "Gözden Geçir" adımında kurulur; aşağı akıştaki her girdi
  // değişikliği onu geçersiz kılar.
  function invalidatePlan() { if (state) { state.plan = null; state.result = null; state.page = 0; } }

  function fields() { return state.adapter.fields(); }
  function fieldById(id) { return fields().find(function (field) { return field.id === id; }) || null; }
  function collectionActionMode() { return Boolean(state && state.moduleId === 'collection'); }
  function assignmentAction(entry) {
    var action = String(entry && entry.action || '').toLowerCase();
    if (['ignore', 'create', 'update', 'match'].indexOf(action) >= 0) return action;
    var targetId = entry && entry.targetId;
    if (!targetId || targetId === '__ignore__') return 'ignore';
    if (targetId === '__new__') return 'create';
    if (state && state.matchFieldIds && state.matchFieldIds.indexOf(targetId) >= 0) return 'match';
    return 'update';
  }
  function syncCollectionActionState() {
    if (!collectionActionMode() || !state.table) return;
    var seen = new Set(), match = [];
    state.table.columns.forEach(function (column) {
      var entry = state.assignments[column.id] || {};
      if (assignmentAction(entry) !== 'match') return;
      var targetId = entry.targetId;
      if (!targetId || targetId === '__ignore__' || targetId === '__new__' || seen.has(targetId)) return;
      seen.add(targetId); match.push(targetId);
    });
    state.matchFieldIds = match;
    syncNewColumns();
  }
  function currentMappingValidation() {
    return Mapping.validateMapping({ assignments: state.assignments, fields: fields(), columns: state.table ? state.table.columns : [], matchFields: state.matchFieldIds });
  }
  function columnsDisabledReason(validation) {
    var result = validation || currentMappingValidation();
    var noMatch = result.issues.find(function (issue) { return issue.code === 'match-rule-required'; });
    if (noMatch) return T('Mevcut Collection satırlarını bulabilmek için en az bir sütunu “Eşleştirmede Kullan” olarak seçin.', 'Select at least one “Use for matching” column so existing Collection rows can be found.');
    var first = result.issues.find(function (issue) { return issue.severity === 'error'; });
    return first ? issueLabel(first) : '';
  }

  function planSpec() {
    var pending = state.newColumns.map(function (item) {
      return { id: 'new:' + item.columnId, columnId: item.columnId, label: item.label, dataType: item.dataType };
    });
    return {
      moduleId: state.moduleId,
      fields: fields(),
      source: {
        fileName: state.fileName, sheetName: state.sheetName,
        headerRow: state.analysis ? state.analysis.headerRow : 0,
        fingerprint: state.analysis ? Workbook.schemaFingerprint({ sheet: state.sheetName, headerRow: state.analysis.headerRow, columns: state.table ? state.table.columns : [] }) : '',
        columns: state.table ? state.table.columns : [],
        rows: state.table ? state.table.rows : [],
      },
      mapping: { assignments: state.assignments, newColumns: pending },
      matchRule: { fieldIds: state.matchFieldIds },
      options: state.options,
      decisions: state.decisions,
      target: {
        rows: state.adapter.rows(),
        revision: state.adapter.revision(),
        rowRevision: state.adapter.rowRevision,
        rowLabel: state.adapter.rowLabel,
        readValue: state.adapter.readValue,
        // Optional module-scoped hook. Collection uses this only to preserve
        // explicit colour-level values as variant overrides even when the
        // incoming value currently equals the inherited model value. CP does
        // not provide the hook, so generic import semantics stay unchanged.
        forceExplicitSet: state.adapter.forceExplicitSet,
        canCreate: state.adapter.canCreate !== false,
      },
    };
  }

  /* ---------------- DOSYA OKUMA ---------------- */

  async function readWorkbookFile(file) {
    if (global.BLPerf && global.BLPerf.ensureLibrary) await global.BLPerf.ensureLibrary('xlsx');
    var XLSX = global.XLSX;
    if (!XLSX) throw new Error(T('Excel kütüphanesi yüklenemedi.', 'The Excel library could not be loaded.'));
    var buffer = await file.arrayBuffer();
    /* GÜVENİLMEZ GİRDİ. Makro, formül, köprü ve dış bağlantı ÇALIŞTIRILMAZ;
       yalnız hücre değerleri, biçimli gösterim ve formül METNİ okunur. */
    var workbook = XLSX.read(new Uint8Array(buffer), {
      type: 'array', cellFormula: true, cellNF: true, cellText: true,
      cellDates: false, cellStyles: false, cellHTML: false, bookVBA: false, dense: false,
    });
    return { XLSX: XLSX, workbook: workbook };
  }

  function loadSheet(sheetName) {
    var XLSX = global.XLSX;
    state.sheetName = sheetName;
    state.grid = Workbook.gridFromWorksheet(XLSX, state.workbook.Sheets[sheetName], sheetName);
    state.analysis = Workbook.analyzeSheet(state.grid, {});
    rebuildTable();
  }
  function rebuildTable() {
    state.table = Workbook.extractTable(state.grid, state.analysis, {
      includeHiddenRows: state.options.includeHiddenRows,
      includeHiddenColumns: state.options.includeHiddenColumns,
      fillMergedCells: state.options.fillMergedCells,
      includeStructuralRows: state.options.includeStructuralRows,
    });
    invalidatePlan();
  }

  function autoMap() {
    var suggested = Mapping.suggestMapping(state.table.columns, fields());
    state.newColumns = [];

    if (collectionActionMode()) {
      // Collection action model: suggestion is only a TARGET HINT. It never
      // grants update permission. Only the three canonical identity columns
      // start as Match; every other Excel column starts as Ignore.
      var defaultMatchTargets = new Set(['plmId', 'modelKod', 'colourCode']);
      var claimedDefaults = new Set();
      state.assignments = {};
      state.table.columns.forEach(function (column) {
        var hint = suggested[column.id] || {};
        var suggestedTargetId = hint.targetId && hint.targetId !== '__ignore__' ? hint.targetId : '';
        var shouldMatch = defaultMatchTargets.has(suggestedTargetId) && !claimedDefaults.has(suggestedTargetId);
        if (shouldMatch) claimedDefaults.add(suggestedTargetId);
        state.assignments[column.id] = {
          action: shouldMatch ? 'match' : 'ignore',
          targetId: shouldMatch ? suggestedTargetId : '__ignore__',
          suggestedTargetId: suggestedTargetId,
          matchTargetId: shouldMatch ? suggestedTargetId : '',
          updateTargetId: '',
          confidence: hint.confidence || '',
          score: hint.score || 0,
          matchedOn: hint.matchedOn || '',
          alternatives: hint.alternatives || [],
          needsReview: false,
          reviewed: true,
        };
      });
      syncCollectionActionState();
      invalidatePlan();
      return;
    }

    state.assignments = suggested;
    var identity = fields().filter(function (field) { return field.identity; });
    var mappedTargets = new Set(Object.keys(state.assignments).map(function (id) { return state.assignments[id].targetId; }));
    var mappedIdentityIds = identity.filter(function (field) { return mappedTargets.has(field.id); }).map(function (field) { return field.id; });
    state.matchFieldIds = mappedIdentityIds.slice(0, 2);
    invalidatePlan();
  }

  function columnSamples(columnId, limit) {
    var out = [];
    (state.table.rows || []).slice(0, limit || 30).forEach(function (row) {
      var cell = row.cells[columnId];
      if (cell && cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') out.push(cell.text || cell.value);
    });
    return out;
  }

  /* ---------------- ÇİZİM ---------------- */

  function stepLabel(step) {
    return {
      file: T('Dosya', 'File'), sheet: T('Sayfa', 'Sheet'), columns: T('Sütunlar', 'Columns'),
      match: T('Eşleşme', 'Match'), review: T('Gözden Geçir', 'Review'), import: T('Aktar', 'Import'),
    }[step];
  }
  function stepper() {
    var current = STEPS.indexOf(state.step);
    return '<ol class="ximSteps">' + STEPS.map(function (step, index) {
      var cls = index === current ? 'isActive' : index < current ? 'isDone' : '';
      return '<li class="' + cls + '"><span>' + (index + 1) + '</span>' + esc(stepLabel(step)) + '</li>';
    }).join('') + '</ol>';
  }

  function warningLabel(code) {
    return {
      'header-uncertain': T('Başlık satırı kesin değil — doğrulayın', 'Header row is uncertain — confirm it'),
      'duplicate-headers': T('Tekrar eden başlık', 'Duplicate headers'),
      'merged-data-cells': T('Veri alanında birleşik hücre', 'Merged cells inside the data area'),
      'hidden-rows': T('Gizli satır', 'Hidden rows'),
      'hidden-columns': T('Gizli sütun', 'Hidden columns'),
      'formula-without-value': T('Güvenilir değeri olmayan formül hücresi', 'Formula cells without a reliable value'),
      'empty-header-cell': T('Boş başlık hücresi', 'Empty header cell'),
      'invalid-date': T('Geçersiz tarih', 'Invalid date'),
      'invalid-number': T('Geçersiz sayı', 'Invalid number'),
      'invalid-boolean': T('Geçersiz evet/hayır değeri', 'Invalid boolean value'),
      'cell-error': T('Excel hata değeri', 'Excel error value'),
      'leading-zero-uncertain': T('Baştaki sıfır kaybolmuş olabilir', 'A leading zero may have been lost'),
      'decimal-truncated': T('Ondalık kısım kesildi', 'Decimal part truncated'),
      'structural-row-included': T('Yapısal görünen satır dahil edildi', 'A structural-looking row was included'),
    }[code] || code;
  }
  function blockingLabel(item) {
    if (item.code === 'ambiguous-match') return T('Belirsiz eşleşme — hedef seçin veya atlayın', 'Ambiguous match — choose a target or skip') + ' (Excel ' + item.excelRow + ')';
    if (item.code === 'incoming-duplicate') return T('Excel içinde tekrar eden anahtar', 'Duplicate key inside the workbook') + ': ' + esc(item.key);
    if (item.code === 'reverse-duplicate') return T('Birden çok Excel satırı aynı Buyer Log satırına düşüyor', 'Several workbook rows land on the same Buyer Log row') + ': ' + esc(item.key);
    if (item.code === 'match-field-not-mapped') return T('Eşleşme alanı eşlenmemiş', 'Match field is not mapped') + ': ' + esc(item.fieldId);
    return item.code;
  }

  function renderFileStep() {
    var profiles = state.profiles;
    return '<div class="ximPane">'
      + '<p class="ximLead">' + esc(T(
        'Kendi Excel dosyanızdaki sütunları Buyer Log alanlarına eşleyerek içeri aktarın. Hiçbir veri, önizlemeyi onaylamadan önce değişmez.',
        'Map the columns of your own Excel workbook onto Buyer Log fields. Nothing changes until you approve the preview.')) + '</p>'
      + '<label class="ximFileDrop"><input type="file" accept=".xlsx,.xls,.xlsm" data-xim="file" hidden>'
      + '<strong>' + esc(T('Excel dosyası seç', 'Choose an Excel file')) + '</strong>'
      + '<span class="muted">.xlsx · .xls · .xlsm</span>'
      + (state.fileName ? '<span class="ximChip">' + esc(state.fileName) + '</span>' : '')
      + '</label>'
      + (profiles.length ? '<div class="ximBlock"><h4>' + esc(T('Kayıtlı eşleştirmeler', 'Saved mappings')) + '</h4>'
        + '<ul class="ximList">' + profiles.map(function (profile) {
          return '<li><span>' + esc(profile.name) + '</span><span class="muted">' + esc(profile.sheetName || '—') + ' · ' + esc(profile.updatedAt.slice(0, 10)) + '</span>'
            + '<button type="button" class="tbtn" data-xim="profile-delete" data-id="' + esc(profile.id) + '">' + esc(T('Sil', 'Delete')) + '</button></li>';
        }).join('') + '</ul>'
        + '<p class="muted">' + esc(T('Kayıtlı bir eşleştirme dosyayı seçtikten sonra otomatik önerilir; kendiliğinden ÇALIŞMAZ.', 'A saved mapping is offered after you pick a file; it never runs on its own.')) + '</p></div>' : '')
      + '</div>';
  }

  function renderSheetStep() {
    var analysis = state.analysis, sheets = state.sheets;
    if (!analysis) return '<p class="muted">' + esc(T('Önce bir dosya seçin.', 'Choose a file first.')) + '</p>';
    var candidates = analysis.headerCandidates.map(function (item) {
      return '<option value="' + item.row + '"' + (item.row === analysis.headerRow ? ' selected' : '') + '>'
        + esc(T('Satır', 'Row') + ' ' + (item.row + 1) + ' · ' + item.filled + ' ' + T('dolu hücre', 'filled cells')) + '</option>';
    }).join('');
    return '<div class="ximPane">'
      + '<div class="ximBlock"><h4>' + esc(T('Sayfa', 'Sheet')) + '</h4><div class="ximSheetList">'
      + sheets.map(function (sheet) {
        return '<button type="button" class="ximSheet' + (sheet.name === state.sheetName ? ' isActive' : '') + '" data-xim="sheet" data-name="' + esc(sheet.name) + '">'
          + '<strong>' + esc(sheet.name) + (sheet.hidden ? ' · ' + esc(T('gizli', 'hidden')) : '') + '</strong>'
          + '<span class="muted">' + sheet.rowCount + ' × ' + sheet.columnCount + '</span></button>';
      }).join('') + '</div></div>'
      + '<div class="ximBlock"><h4>' + esc(T('Başlık satırı', 'Header row')) + '</h4>'
      + '<div class="ximRow"><select data-xim="header-row">' + candidates + '</select>'
      + '<span class="ximChip is-' + esc(analysis.headerConfidence) + '">' + esc(T('güven', 'confidence')) + ': ' + esc(analysis.headerConfidence) + '</span>'
      + '<input type="number" min="1" value="' + (analysis.headerRow + 1) + '" data-xim="header-row-manual" aria-label="' + esc(T('Başlık satırı numarası', 'Header row number')) + '">'
      + '</div></div>'
      + '<div class="ximBlock"><h4>' + esc(T('Çalışma kitabı bulguları', 'Workbook findings')) + '</h4>'
      + '<dl class="ximFacts">'
      + fact(T('Kullanılan aralık', 'Used range'), (analysis.usedRange.lastRow - analysis.usedRange.firstRow + 1) + ' × ' + (analysis.usedRange.lastColumn - analysis.usedRange.firstColumn + 1))
      + fact(T('Başlık sayısı', 'Header count'), String(analysis.headers.filter(function (h) { return h.label; }).length))
      + fact(T('Tekrar eden başlık', 'Duplicate headers'), String(analysis.duplicateHeaders.length))
      + fact(T('Başlık birleştirmesi', 'Header merges'), String(analysis.merges.header.length))
      + fact(T('Veri birleştirmesi', 'Data merges'), String(analysis.merges.data.length))
      + fact(T('Gizli satır / sütun', 'Hidden rows / columns'), analysis.hiddenRows.length + ' / ' + analysis.hiddenColumns.length)
      + fact(T('Boş satır / sütun', 'Empty rows / columns'), analysis.emptyRows.length + ' / ' + analysis.emptyColumns.length)
      + fact(T('Formül hücresi', 'Formula cells'), analysis.formulas.total + ' (' + analysis.formulas.withoutCachedValue + ' ' + T('değersiz', 'without value') + ')')
      + fact(T('Toplam/başlık tekrarı satırı', 'Total / repeated-header rows'), String(analysis.suspiciousRows.length))
      + '</dl>'
      + (analysis.warnings.length ? '<ul class="ximWarnList">' + analysis.warnings.map(function (warning) {
        return '<li>' + esc(warningLabel(warning.code)) + (warning.count ? ' · ' + warning.count : '') + '</li>';
      }).join('') + '</ul>' : '')
      + '</div>'
      + '<div class="ximBlock"><h4>' + esc(T('Veri ayarları', 'Data settings')) + '</h4>'
      + toggle('includeHiddenRows', T('Gizli satırları da aktar', 'Import hidden rows too'), state.options.includeHiddenRows)
      + toggle('includeHiddenColumns', T('Gizli sütunları da aktar', 'Import hidden columns too'), state.options.includeHiddenColumns)
      + toggle('fillMergedCells', T('Üst hücre değerini merge kapsamındaki alt satırlara uygula', 'Apply the top cell value to the rows covered by the merge'), state.options.fillMergedCells)
      + toggle('includeStructuralRows', T('Toplam / tekrar eden başlık satırlarını da veri say', 'Treat total / repeated-header rows as data too'), state.options.includeStructuralRows)
      + '<p class="muted">' + esc(T('Bu ayarların hiçbiri varsayılan olarak açık değildir; gizli veya yapısal veri sessizce içeri girmez.', 'None of these are on by default; hidden or structural data never enters silently.')) + '</p>'
      + '</div>'
      + '<p class="ximLead">' + esc(T('Okunan veri satırı', 'Data rows read')) + ': <strong>' + (state.table ? state.table.rows.length : 0) + '</strong> · '
      + esc(T('atlanan', 'skipped')) + ': ' + (state.table ? state.table.skipped.length : 0) + '</p>'
      + '</div>';
  }
  function fact(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>'; }
  function toggle(key, label, checked) {
    return '<label class="ximToggle"><input type="checkbox" data-xim="option" data-key="' + esc(key) + '"' + (checked ? ' checked' : '') + '><span>' + esc(label) + '</span></label>';
  }

  function renderCollectionActionColumnsStep() {
    if (!state.table) return '';
    var list = fields();
    var writable = list.filter(function (field) { return field.writable !== false; });
    var validation = currentMappingValidation();
    var actionCounts = { create: 0, update: 0, match: 0, ignore: 0 };
    state.table.columns.forEach(function (column) { actionCounts[assignmentAction(state.assignments[column.id] || {})] += 1; });

    function targetOptions(selected, pool) {
      return '<option value="">' + esc(T('Alan seçin…', 'Select a field…')) + '</option>' + pool.map(function (field) {
        return '<option value="' + esc(field.id) + '"' + (selected === field.id ? ' selected' : '') + '>' + esc(field.label) + '</option>';
      }).join('');
    }
    function actionRadio(columnId, action, current, label, title) {
      return '<label class="ximActionChoice' + (current === action ? ' isSelected' : '') + '" title="' + esc(title) + '">'
        + '<input type="radio" name="xim-action-' + esc(columnId) + '" data-xim="column-action" data-column="' + esc(columnId) + '" value="' + action + '"' + (current === action ? ' checked' : '') + '>'
        + '<span>' + esc(label) + '</span></label>';
    }

    var rows = state.table.columns.map(function (column) {
      var entry = state.assignments[column.id] || { action: 'ignore', targetId: '__ignore__' };
      var action = assignmentAction(entry);
      var samples = columnSamples(column.id, 3).map(display).join(' · ');
      var issues = validation.issues.filter(function (issue) { return issue.columnId === column.id || (issue.columns || []).indexOf(column.id) >= 0; });
      var inferred = Mapping.inferColumnType(columnSamples(column.id, 40), column.header);
      var suggestedTargetId = entry.suggestedTargetId || '';
      var updateTarget = action === 'update' ? entry.targetId : (entry.updateTargetId || suggestedTargetId);
      if (!writable.some(function (field) { return field.id === updateTarget; })) updateTarget = '';
      var matchTarget = action === 'match' ? entry.targetId : (entry.matchTargetId || suggestedTargetId);
      if (!list.some(function (field) { return field.id === matchTarget; })) matchTarget = '';
      var chosenType = entry.newColumnType || (inferred && inferred.dataType) || 'text';

      return '<tr' + (issues.some(function (i) { return i.severity === 'error'; }) ? ' class="isBad"' : '') + '>'
        + '<td><strong>' + esc(column.header) + '</strong><div class="muted">' + esc(column.letter)
        + (column.duplicate ? ' · ' + esc(T('tekrar eden başlık', 'duplicate header')) : '')
        + (column.hidden ? ' · ' + esc(T('gizli', 'hidden')) : '') + '</div>'
        + (issues.length ? '<ul class="ximWarnList">' + issues.map(function (issue) { return '<li>' + esc(issueLabel(issue)) + '</li>'; }).join('') + '</ul>' : '') + '</td>'
        + '<td class="ximSample muted">' + esc(samples || '—') + '</td>'
        + '<td class="ximActionCell">' + actionRadio(column.id, 'create', action, T('Yeni Sütun Oluştur', 'Create new column'), T('Excel sütununu yeni bir Collection alanı olarak ekler.', 'Adds the Excel column as a new Collection field.'))
        + (action === 'create' ? '<div class="ximActionConfig"><input type="text" data-xim="new-label" data-column="' + esc(column.id) + '" value="' + esc(entry.newColumnLabel || column.header) + '" placeholder="' + esc(T('Yeni sütun adı', 'New column name')) + '">'
          + '<select data-xim="new-type" data-column="' + esc(column.id) + '">' + Mapping.TYPES.map(function (type) { return '<option value="' + type + '"' + (chosenType === type ? ' selected' : '') + '>' + esc(type) + '</option>'; }).join('') + '</select></div>' : '') + '</td>'
        + '<td class="ximActionCell">' + actionRadio(column.id, 'update', action, T('Mevcut Sütunu Güncelle', 'Update existing column'), T('Excel değerlerini seçtiğiniz mevcut Buyer Log alanına yazar.', 'Writes Excel values to the selected existing Buyer Log field.'))
        + (action === 'update' ? '<div class="ximActionConfig"><select data-xim="action-target" data-action="update" data-column="' + esc(column.id) + '">' + targetOptions(updateTarget, writable) + '</select></div>' : '') + '</td>'
        + '<td class="ximActionCell">' + actionRadio(column.id, 'match', action, T('Eşleştirmede Kullan', 'Use for matching'), T('Excel satırını mevcut Collection satırıyla eşleştirmek için kullanır.', 'Uses the Excel column to match the row to an existing Collection row.'))
        + (action === 'match' ? '<div class="ximActionConfig"><select data-xim="action-target" data-action="match" data-column="' + esc(column.id) + '">' + targetOptions(matchTarget, list) + '</select></div>' : '') + '</td>'
        + '<td class="ximActionCell">' + actionRadio(column.id, 'ignore', action, T('Dikkate Alma', 'Ignore'), T('Bu Excel sütununu içe aktarma sırasında kullanmaz.', 'Ignores this Excel column during import.')) + '</td>'
        + '</tr>';
    }).join('');

    var errorNotice = validation.ok ? '' : '<p class="ximNotice is-bad"><strong>' + esc(T('Sütun kararlarını tamamlayın.', 'Complete the column decisions.')) + '</strong><br>' + esc(columnsDisabledReason(validation)) + '</p>';
    return '<div class="ximPane">'
      + (state.profileNotice ? '<p class="ximNotice">' + esc(state.profileNotice) + '</p>' : '')
      + errorNotice
      + '<div class="ximRow">'
      + '<button type="button" class="tbtn" data-xim="automap">' + esc(T('Varsayılanları yeniden uygula', 'Reset to defaults')) + '</button>'
      + (state.profileMatches.length ? '<select data-xim="profile-apply"><option value="">' + esc(T('Kayıtlı eşleştirme uygula…', 'Apply a saved mapping…')) + '</option>'
        + state.profileMatches.map(function (item) { return '<option value="' + esc(item.profile.id) + '">' + esc(item.profile.name) + ' · ' + esc(item.quality === 'exact' ? T('birebir', 'exact') : T('kısmi', 'partial')) + '</option>'; }).join('') + '</select>' : '')
      + '<span class="muted">' + esc(T('Yeni', 'Create')) + ': ' + actionCounts.create + ' · ' + esc(T('Güncelle', 'Update')) + ': ' + actionCounts.update + ' · ' + esc(T('Eşleştir', 'Match')) + ': ' + actionCounts.match + ' · ' + esc(T('Yok say', 'Ignore')) + ': ' + actionCounts.ignore + '</span></div>'
      + '<div class="ximTableScroll"><table class="ximTable ximActionTable"><thead><tr>'
      + '<th>' + esc(T('Excel Sütunu', 'Excel column')) + '</th><th>' + esc(T('Örnek', 'Sample')) + '</th>'
      + '<th title="' + esc(T('Excel sütununu yeni bir Collection alanı olarak ekler.', 'Adds the Excel column as a new Collection field.')) + '">' + esc(T('Yeni Sütun Oluştur', 'Create new column')) + '</th>'
      + '<th title="' + esc(T('Excel değerlerini seçtiğiniz mevcut Buyer Log alanına yazar.', 'Writes Excel values to the selected existing Buyer Log field.')) + '">' + esc(T('Mevcut Sütunu Güncelle', 'Update existing column')) + '</th>'
      + '<th title="' + esc(T('Excel satırını mevcut Collection satırıyla eşleştirmek için kullanır.', 'Uses the Excel column to match an existing Collection row.')) + '">' + esc(T('Eşleştirmede Kullan', 'Use for matching')) + '</th>'
      + '<th title="' + esc(T('Bu Excel sütununu içe aktarma sırasında kullanmaz.', 'Ignores this Excel column during import.')) + '">' + esc(T('Dikkate Alma', 'Ignore')) + '</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<p class="muted">' + esc(T('Her Excel sütunu için yalnız bir işlem seçilebilir. Alan önerileri yalnız hedef seçiciyi önceden doldurur; hiçbir sütun kendiliğinden güncelleme kapsamına alınmaz.', 'Choose exactly one action per Excel column. Field suggestions only prefill the target selector; no column is automatically authorized for update.')) + '</p>'
      + '</div>';
  }

  function renderColumnsStep() {
    if (collectionActionMode()) return renderCollectionActionColumnsStep();
    if (!state.table) return '';
    var list = fields();
    var options = function (selected) {
      return '<option value="__ignore__"' + (selected === '__ignore__' ? ' selected' : '') + '>' + esc(T('İçeri aktarma', 'Do not import')) + '</option>'
        + '<option value="__new__"' + (selected === '__new__' ? ' selected' : '') + '>' + esc(T('Yeni sütun olarak ekle', 'Add as a new column')) + '</option>'
        + list.map(function (field) {
          return '<option value="' + esc(field.id) + '"' + (selected === field.id ? ' selected' : '') + '>'
            + esc(field.label) + (field.writable === false ? ' · ' + esc(T('yalnız eşleşme', 'match only')) : '') + '</option>';
        }).join('');
    };
    var validation = Mapping.validateMapping({ assignments: state.assignments, fields: list, columns: state.table.columns, matchFields: state.matchFieldIds });
    var rows = state.table.columns.map(function (column) {
      var entry = state.assignments[column.id] || { targetId: '__ignore__' };
      var confidence = entry.confidence || '';
      var samples = columnSamples(column.id, 3).map(display).join(' · ');
      var issues = validation.issues.filter(function (issue) { return issue.columnId === column.id; });
      var isNew = entry.targetId === '__new__';
      var inferred = isNew ? Mapping.inferColumnType(columnSamples(column.id, 40), column.header) : null;
      return '<tr' + (issues.some(function (i) { return i.severity === 'error'; }) ? ' class="isBad"' : '') + '>'
        + '<td><strong>' + esc(column.header) + '</strong><div class="muted">' + esc(column.letter) + (column.duplicate ? ' · ' + esc(T('tekrar eden başlık', 'duplicate header')) : '') + (column.hidden ? ' · ' + esc(T('gizli', 'hidden')) : '') + '</div></td>'
        + '<td class="ximSample muted">' + esc(samples || '—') + '</td>'
        + '<td><select data-xim="assign" data-column="' + esc(column.id) + '">' + options(entry.targetId || '__ignore__') + '</select>'
        + (isNew ? '<div class="ximRow"><input type="text" data-xim="new-label" data-column="' + esc(column.id) + '" value="' + esc(entry.newColumnLabel || column.header) + '" placeholder="' + esc(T('Sütun adı', 'Column name')) + '">'
          + '<select data-xim="new-type" data-column="' + esc(column.id) + '">' + Mapping.TYPES.map(function (type) {
            var chosen = entry.newColumnType || (inferred && inferred.dataType) || 'text';
            return '<option value="' + type + '"' + (chosen === type ? ' selected' : '') + '>' + esc(type) + '</option>';
          }).join('') + '</select></div>'
          + (inferred ? '<div class="muted">' + esc(T('Tip önerisi', 'Type suggestion') + ': ' + inferred.dataType + ' (' + inferred.confidence + ')') + '</div>' : '') : '')
        + '</td>'
        + '<td>' + (confidence ? '<span class="ximChip is-' + esc(confidence) + '">' + esc(confidence) + '</span>' : '<span class="muted">—</span>')
        + (entry.needsReview && !entry.reviewed && entry.targetId !== '__ignore__'
          ? '<label class="ximToggle"><input type="checkbox" data-xim="review" data-column="' + esc(column.id) + '"><span>' + esc(T('Onayla', 'Confirm')) + '</span></label>' : '')
        + (issues.length ? '<ul class="ximWarnList">' + issues.map(function (issue) { return '<li>' + esc(issueLabel(issue)) + '</li>'; }).join('') + '</ul>' : '')
        + '</td></tr>';
    }).join('');
    return '<div class="ximPane">'
      + (state.profileNotice ? '<p class="ximNotice">' + esc(state.profileNotice) + '</p>' : '')
      + '<div class="ximRow"><button type="button" class="tbtn" data-xim="automap">' + esc(T('Otomatik eşle', 'Auto-map')) + '</button>'
      + (state.profileMatches.length ? '<select data-xim="profile-apply"><option value="">' + esc(T('Kayıtlı eşleştirme uygula…', 'Apply a saved mapping…')) + '</option>'
        + state.profileMatches.map(function (item) {
          return '<option value="' + esc(item.profile.id) + '">' + esc(item.profile.name) + ' · ' + esc(item.quality === 'exact' ? T('birebir', 'exact') : T('kısmi', 'partial')) + '</option>';
        }).join('') + '</select>' : '')
      + '<span class="muted">' + esc(T('Eşlenen sütun', 'Mapped columns')) + ': ' + validation.mappedCount + '</span></div>'
      + '<table class="ximTable"><thead><tr><th>' + esc(T('Excel sütunu', 'Excel column')) + '</th><th>' + esc(T('Örnek', 'Sample')) + '</th><th>' + esc(T('Buyer Log alanı', 'Buyer Log field')) + '</th><th>' + esc(T('Güven / uyarı', 'Confidence / warning')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }
  function issueLabel(issue) {
    return {
      'duplicate-target-mapping': T('Aynı Buyer Log alanına birden çok sütun eşlenmiş', 'Several columns are mapped to the same Buyer Log field'),
      'new-column-label-required': T('Yeni sütun adı zorunlu', 'A name is required for the new column'),
      'new-column-label-exists': T('Bu adda bir alan zaten var', 'A field with this name already exists'),
      'new-column-label-duplicate': T('Aynı yeni sütun adı iki kez kullanılmış', 'The same new column name is used twice'),
      'suggestion-needs-review': T('Öneri kesin değil — onaylayın', 'The suggestion is not certain — confirm it'),
      'target-not-writable': T('Bu alan yazılamaz; yalnız eşleşme için kullanılabilir', 'This field is not writable; it can only be used for matching'),
      'nothing-mapped': T('Hiçbir sütun eşlenmemiş', 'No column is mapped'),
      'match-field-not-mapped': T('Eşleşme kuralındaki alan eşlenmemiş', 'A field in the match rule is not mapped'),
      'match-rule-required': T('Eşleşme kuralı seçilmedi', 'No match rule is selected'),
      'one-source-many-targets': T('Bir kaynak sütun birden çok alana sürüklenemez', 'One source column cannot drive several fields'),
      'update-target-required': T('Güncellenecek Buyer Log alanını seçin', 'Select the Buyer Log field to update'),
      'match-target-required': T('Eşleştirmede kullanılacak Buyer Log alanını seçin', 'Select the Buyer Log field to use for matching'),
      'match-action-not-active': T('Eşleşme kuralı Sütunlar adımındaki seçimlerle uyuşmuyor', 'The match rule does not match the choices on the Columns step'),
      'new-column-action-mismatch': T('Yeni sütun yapılandırması geçersiz', 'The new-column configuration is invalid'),
    }[issue.code] || issue.code;
  }

  function renderMatchStep() {
    var list = fields();
    if (collectionActionMode()) {
      var matchItems = (state.table ? state.table.columns : []).map(function (column) {
        var entry = state.assignments[column.id] || {};
        if (assignmentAction(entry) !== 'match') return null;
        var field = fieldById(entry.targetId);
        return field ? { column: column, field: field } : null;
      }).filter(Boolean);
      return '<div class="ximPane">'
        + '<div class="ximBlock"><h4>' + esc(T('Eşleşme kuralı', 'Match rule')) + '</h4>'
        + '<p class="muted">' + esc(T('Bu alanlar Sütunlar adımındaki “Eşleştirmede Kullan” seçimlerinden gelir. Değiştirmek için Sütunlar adımına geri dönün.', 'These fields come from the “Use for matching” choices on the Columns step. Go back to Columns to change them.')) + '</p>'
        + (matchItems.length ? '<div class="ximChecks">' + matchItems.map(function (item) { return '<span class="ximChip is-high">' + esc(item.column.header) + ' → ' + esc(item.field.label) + '</span>'; }).join('') + '</div>'
          : '<p class="ximNotice is-bad">' + esc(T('Mevcut Collection satırlarını bulabilmek için en az bir sütunu “Eşleştirmede Kullan” olarak seçin.', 'Select at least one “Use for matching” column so existing Collection rows can be found.')) + '</p>')
        + '</div>'
        + '<div class="ximBlock"><h4>' + esc(T('Yazma ayarları', 'Write settings')) + '</h4>'
        + toggle('createNew', T('Eşleşmeyen satırları yeni kayıt olarak oluştur', 'Create unmatched rows as new records'), state.options.createNew)
        + toggle('blankClears', T('Boş Excel hücreleri mevcut Buyer Log değerlerini temizlesin', 'Let blank Excel cells clear existing Buyer Log values'), state.options.blankClears)
        + '<p class="muted">' + esc(T('Varsayılan: boş hücre değişiklik değildir ve mevcut veriyi silmez.', 'Default: a blank cell is not a change and never erases existing data.')) + '</p>'
        + (state.options.blankClears ? '<p class="ximNotice is-bad">' + esc(T('DİKKAT: bu ayar açıkken boş hücreler mevcut değerleri siler. Önizlemede “temizlenecek” olarak görünür.', 'CAUTION: with this on, blank cells erase existing values. They appear as “will be cleared” in the preview.')) + '</p>' : '')
        + '</div></div>';
    }
    var mappedTargets = new Set(Object.keys(state.assignments).map(function (id) { return (state.assignments[id] || {}).targetId; }));
    var candidates = list.filter(function (field) { return mappedTargets.has(field.id); });
    return '<div class="ximPane">'
      + '<div class="ximBlock"><h4>' + esc(T('Eşleşme kuralı', 'Match rule')) + '</h4>'
      + '<p class="muted">' + esc(T('Bir veya birden çok alan seçin. Eşleşme birebirdir; benzerlik hiçbir zaman kesin eşleşme sayılmaz.', 'Pick one or more fields. Matching is exact; similarity is never treated as an exact match.')) + '</p>'
      + (candidates.length ? '<div class="ximChecks">' + candidates.map(function (field) {
        return '<label class="ximToggle"><input type="checkbox" data-xim="matchfield" data-id="' + esc(field.id) + '"' + (state.matchFieldIds.indexOf(field.id) >= 0 ? ' checked' : '') + '><span>' + esc(field.label) + '</span></label>';
      }).join('') + '</div>' : '<p class="ximNotice">' + esc(T('Önce sütun eşlemesi yapın.', 'Map the columns first.')) + '</p>')
      + '</div>'
      + '<div class="ximBlock"><h4>' + esc(T('Yazma ayarları', 'Write settings')) + '</h4>'
      + toggle('createNew', T('Eşleşmeyen satırları yeni kayıt olarak oluştur', 'Create unmatched rows as new records'), state.options.createNew)
      + (state.adapter.canCreate === false ? '<p class="ximNotice">' + esc(T('CP satırları kaynak veriden gelir; içe aktarma yeni CP satırı oluşturamaz. Eşleşmeyen satırlar atlanır.', 'CP rows come from the source data; an import cannot create new CP rows. Unmatched rows are skipped.')) + '</p>' : '')
      + toggle('blankClears', T('Boş Excel hücreleri mevcut Buyer Log değerlerini temizlesin', 'Let blank Excel cells clear existing Buyer Log values'), state.options.blankClears)
      + '<p class="muted">' + esc(T('Varsayılan: boş hücre değişiklik değildir ve mevcut veriyi silmez.', 'Default: a blank cell is not a change and never erases existing data.')) + '</p>'
      + (state.options.blankClears ? '<p class="ximNotice is-bad">' + esc(T('DİKKAT: bu ayar açıkken boş hücreler mevcut değerleri siler. Önizlemede "temizlenecek" olarak görünür.', 'CAUTION: with this on, blank cells erase existing values. They appear as "will be cleared" in the preview.')) + '</p>' : '')
      + '</div></div>';
  }

  function reviewDisabledReason(plan) {
    if (!plan) return T('İçe aktarma planı henüz hazır değil.', 'The import plan is not ready yet.');
    var unresolvedAmbiguous = plan.skipped.filter(function (item) { return item.reason === 'ambiguous-unresolved'; }).length;
    var unresolvedDuplicates = plan.conflicts.filter(function (item) { return !item.resolved; }).length;
    var invalid = plan.skipped.filter(function (item) { return item.reason === 'missing-identifier' || item.reason === 'invalid-cell'; }).length;
    var parts = [];
    if (unresolvedAmbiguous) parts.push(unresolvedAmbiguous + ' ' + T('belirsiz eşleşme için karar verilmeli', 'ambiguous match(es) need a decision'));
    if (unresolvedDuplicates) parts.push(unresolvedDuplicates + ' ' + T('tekrar çakışması çözülmeli', 'duplicate conflict(s) need resolution'));
    if (plan.blocking && plan.blocking.length && !unresolvedAmbiguous && !unresolvedDuplicates) parts.push(plan.blocking.length + ' ' + T('engelleyen sorun çözülmeli', 'blocking issue(s) must be resolved'));
    if (!plan.operations.length) {
      if (invalid) parts.push(invalid + ' ' + T('satır seçili eşleşme alanlarında eksik/geçersiz kimlik taşıyor', 'row(s) have missing/invalid values in the selected match fields'));
      parts.push(T('uygulanacak yeni veya değişen kayıt bulunamadı', 'no create/update operation is currently available'));
    }
    return parts.join(' · ');
  }

  function renderReviewStep() {
    var plan = state.plan;
    if (!plan) return '<p class="muted">' + esc(T('Plan kuruluyor…', 'Building the plan…')) + '</p>';
    var summary = plan.summary;
    var cards = [
      [T('Kaynak satır', 'Source rows'), summary.sourceRows], [T('Geçerli satır', 'Valid rows'), summary.validRows],
      [T('Kesin eşleşme', 'Exact matches'), summary.exactMatches], [T('Yeni satır', 'New rows'), summary.newRows],
      [T('Belirsiz', 'Ambiguous'), summary.ambiguousRows], [T('Excel tekrarı', 'Incoming duplicates'), summary.incomingDuplicates],
      [T('Ters tekrar', 'Reverse duplicates'), summary.reverseDuplicates], [T('Geçersiz', 'Invalid'), summary.invalidRows],
      [T('Atlanan', 'Skipped'), summary.skippedRows], [T('Oluşturulacak', 'Creates'), summary.creates],
      [T('Güncellenecek', 'Updates'), summary.updates], [T('Değişen hücre', 'Changed cells'), summary.changedCells],
      [T('Uyarı', 'Warnings'), summary.warnings], [T('Engelleyen çakışma', 'Blocking conflicts'), summary.blockingConflicts],
      [T('Yeni sütun', 'New columns'), summary.newColumns],
    ];
    var blocking = plan.blocking.length
      ? '<div class="ximBlock is-bad"><h4>' + esc(T('Aktarmadan önce çözülmeli', 'Resolve before importing')) + '</h4><ul class="ximWarnList">'
      + plan.blocking.slice(0, 40).map(function (item) { return '<li>' + esc(blockingLabel(item)) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var ambiguous = plan.skipped.filter(function (item) { return item.reason === 'ambiguous-unresolved'; });
    var targets = state.adapter.rows();
    var ambiguousBlock = ambiguous.length ? '<div class="ximBlock"><h4>' + esc(T('Belirsiz eşleşmeler', 'Ambiguous matches')) + '</h4>'
      + ambiguous.slice(0, 20).map(function (item) {
        var choices = (item.targets || []).map(function (position) {
          return '<option value="' + position + '">' + esc(state.adapter.rowLabel(targets[position], position)) + '</option>';
        }).join('');
        return '<div class="ximRow"><span>Excel ' + item.excelRow + '</span>'
          + '<select data-xim="ambiguous" data-row="' + esc(item.sourceRowId) + '">'
          + '<option value="">' + esc(T('Karar verilmedi', 'Undecided')) + '</option>'
          + '<option value="skip">' + esc(T('Bu satırı atla', 'Skip this row')) + '</option>'
          + choices
          + '<option value="all">' + esc(T('Tüm uygun hedeflere uygula (açık onay)', 'Apply to all eligible targets (explicit)')) + '</option>'
          + '</select></div>';
      }).join('') + '</div>' : '';
    var duplicateBlock = plan.conflicts.filter(function (item) { return !item.resolved; }).length
      ? '<div class="ximBlock"><h4>' + esc(T('Tekrar çakışmaları', 'Duplicate conflicts')) + '</h4>'
      + plan.conflicts.filter(function (item) { return !item.resolved; }).slice(0, 20).map(function (conflict) {
        var key = conflict.kind === 'reverse-duplicate' ? 'target:' + conflict.targetPosition : conflict.key;
        return '<div class="ximRow"><span>' + esc(conflict.kind === 'reverse-duplicate'
          ? T('Aynı Buyer Log satırı', 'Same Buyer Log row') + ': ' + conflict.targetLabel
          : T('Aynı anahtar', 'Same key') + ': ' + conflict.key) + '</span>'
          + '<select data-xim="duplicate" data-key="' + esc(key) + '"><option value="">' + esc(T('Karar verilmedi', 'Undecided')) + '</option>'
          + conflict.sourceRowIds.map(function (id) {
            var row = (state.table.rows || []).find(function (item) { return item.id === id; });
            return '<option value="' + esc(id) + '">' + esc(T('Yalnız Excel satırı', 'Only workbook row') + ' ' + (row ? row.excelRowNumber : id)) + '</option>';
          }).join('') + '</select></div>';
      }).join('') + '</div>' : '';

    var operations = plan.operations;
    var pages = Math.max(1, Math.ceil(operations.length / PAGE_SIZE));
    var page = Math.min(state.page, pages - 1);
    var slice = operations.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    var rows = slice.map(function (op) {
      var cells = op.cells.filter(function (cell) { return cell.kind !== 'identity'; });
      return '<tr><td><label class="ximToggle"><input type="checkbox" data-xim="include" data-row="' + esc(op.sourceRowId) + '" checked><span>Excel ' + op.excelRow + '</span></label></td>'
        + '<td>' + esc(op.op === 'create' ? T('Yeni', 'New') : op.targetLabel || '') + '</td>'
        + '<td><table class="ximDiff"><tbody>' + cells.map(function (cell) {
          return '<tr class="is-' + esc(cell.kind) + '"><th>' + esc(cell.label) + '</th>'
            + '<td>' + esc(display(cell.incoming)) + '</td><td>→</td><td>' + esc(display(cell.current)) + '</td><td>→</td><td><strong>' + esc(display(cell.final)) + '</strong></td></tr>';
        }).join('') + '</tbody></table></td>'
        + '<td>' + (op.warnings.length ? '<ul class="ximWarnList">' + op.warnings.map(function (warning) { return '<li>' + esc(warningLabel(warning.code)) + '</li>'; }).join('') + '</ul>' : '<span class="muted">—</span>') + '</td></tr>';
    }).join('');

    return '<div class="ximPane">'
      + '<div class="ximStats">' + cards.map(function (card) {
        return '<div class="ximStat"><span>' + esc(card[0]) + '</span><strong>' + card[1] + '</strong></div>';
      }).join('') + '</div>'
      + (!plan.executable ? '<div class="ximNotice is-bad"><strong>' + esc(T('Onayla ve aktar neden kapalı?', 'Why is Approve and import disabled?')) + '</strong><br>' + esc(reviewDisabledReason(plan)) + '</div>' : '')
      + blocking + ambiguousBlock + duplicateBlock
      + (plan.newColumns.length ? '<div class="ximBlock"><h4>' + esc(T('Oluşturulacak sütunlar', 'Columns to be created')) + '</h4><ul class="ximList">'
        + plan.newColumns.map(function (item) { return '<li><span>' + esc(item.label) + '</span><span class="muted">' + esc(item.dataType) + '</span></li>'; }).join('') + '</ul></div>' : '')
      + (state.options.blankClears ? '<p class="ximNotice is-bad">' + esc(T('Boş hücreler mevcut değerleri TEMİZLEYECEK.', 'Blank cells WILL clear existing values.')) + '</p>' : '')
      + '<div class="ximBlock"><h4>' + esc(T('Satır bazında değişiklikler', 'Row-level changes')) + ' <span class="muted">' + (page + 1) + ' / ' + pages + '</span></h4>'
      + '<table class="ximTable ximReviewTable"><thead><tr><th>' + esc(T('Dahil', 'Include')) + '</th><th>' + esc(T('Hedef', 'Target')) + '</th><th>' + esc(T('Gelen → Mevcut → Sonuç', 'Incoming → Current → Final')) + '</th><th>' + esc(T('Uyarı', 'Warning')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + (pages > 1 ? '<div class="ximRow"><button type="button" class="tbtn" data-xim="page" data-delta="-1"' + (page === 0 ? ' disabled' : '') + '>‹</button>'
        + '<button type="button" class="tbtn" data-xim="page" data-delta="1"' + (page >= pages - 1 ? ' disabled' : '') + '>›</button></div>' : '')
      + '</div>'
      /* Hariç bırakılan satır listeden DÜŞMEZ; yoksa kullanıcı kendi
         kararını geri alamazdı. */
      + (state.decisions.excludedSourceRows.length ? '<div class="ximBlock"><h4>' + esc(T('Hariç bırakılan satırlar', 'Excluded rows')) + '</h4>'
        + '<div class="ximChecks">' + state.decisions.excludedSourceRows.map(function (rowId) {
          var row = (state.table.rows || []).find(function (item) { return item.id === rowId; });
          return '<label class="ximToggle"><input type="checkbox" data-xim="include" data-row="' + esc(rowId) + '"><span>Excel ' + esc(row ? row.excelRowNumber : rowId) + '</span></label>';
        }).join('') + '</div></div>' : '')
      + '<div class="ximBlock"><h4>' + esc(T('Eşleştirmeyi kaydet', 'Save this mapping')) + '</h4>'
      + '<div class="ximRow"><input type="text" data-xim="profile-name" placeholder="' + esc(T('Profil adı', 'Profile name')) + '">'
      + '<button type="button" class="tbtn" data-xim="profile-save">' + esc(T('Bu eşleştirmeyi kaydet', 'Save this mapping')) + '</button></div>'
      + '<p class="muted">' + esc(T('Yalnız yapılandırma saklanır: sayfa, başlık satırı, sütun eşlemesi, eşleşme kuralı ve ayarlar. Çalışma kitabı verisi saklanmaz.', 'Only configuration is stored: sheet, header row, column mapping, match rule and settings. No workbook data is stored.')) + '</p>'
      + '</div></div>';
  }

  function renderImportStep() {
    if (state.result) {
      var result = state.result;
      return '<div class="ximPane"><div class="ximStats">'
        + [[T('Oluşturulan', 'Created'), result.created], [T('Güncellenen', 'Updated'), result.updated],
        [T('Atlanan', 'Skipped'), result.skipped], [T('Başarısız', 'Failed'), result.failed],
        [T('Uyarı', 'Warnings'), result.warnings], [T('Çözülen çakışma', 'Conflicts resolved'), result.conflictsResolved],
        [T('Oluşturulan özel alan', 'Custom fields created'), result.customFieldsCreated]].map(function (card) {
          return '<div class="ximStat"><span>' + esc(card[0]) + '</span><strong>' + card[1] + '</strong></div>';
        }).join('') + '</div>'
        + '<p class="ximNotice ' + (result.status === 'success' ? 'is-ok' : 'is-bad') + '">' + esc(result.message) + '</p></div>';
    }
    var progress = state.progress;
    var stages = [
      ['reading', T('Çalışma kitabı okunuyor', 'Reading workbook')], ['analyzing', T('Sütunlar inceleniyor', 'Analyzing columns')],
      ['matching', T('Satırlar eşleştiriliyor', 'Matching rows')], ['planning', T('Önizleme kuruluyor', 'Building preview')],
      ['importing', T('Aktarılıyor', 'Importing')], ['verifying', T('Doğrulanıyor', 'Verifying')],
    ];
    return '<div class="ximPane"><ul class="ximProgress">' + stages.map(function (stage) {
      var active = progress && progress.stage === stage[0];
      var detail = active && progress.total ? ' · ' + progress.done + ' / ' + progress.total : '';
      return '<li class="' + (active ? 'isActive' : '') + '">' + esc(stage[1]) + esc(detail) + '</li>';
    }).join('') + '</ul></div>';
  }

  function footerButtons() {
    var index = STEPS.indexOf(state.step);
    var back = index > 0 && state.step !== 'import' && !state.busy;
    var next = '';
    if (state.step === 'file') next = state.analysis ? T('Devam', 'Continue') : '';
    else if (state.step === 'sheet') next = T('Sütunlara geç', 'Go to columns');
    else if (state.step === 'columns') next = T('Eşleşme kuralı', 'Match rule');
    else if (state.step === 'match') next = T('Gözden geçir', 'Review');
    else if (state.step === 'review') next = T('Onayla ve aktar', 'Approve and import');
    var canNext = !state.busy && next;
    var disabledTitle = '';
    if (state.step === 'columns' && collectionActionMode()) {
      var mappingValidation = currentMappingValidation();
      if (!mappingValidation.ok) { canNext = false; disabledTitle = columnsDisabledReason(mappingValidation); }
    }
    if (state.step === 'review' && (!state.plan || !state.plan.executable)) {
      canNext = false; disabledTitle = state.plan ? reviewDisabledReason(state.plan) : '';
    }
    return '<button type="button" class="tbtn" data-xim="close">' + esc(state.step === 'import' && state.result ? T('Kapat', 'Close') : T('Vazgeç', 'Cancel')) + '</button>'
      + (back ? '<button type="button" class="tbtn" data-xim="back">' + esc(T('Geri', 'Back')) + '</button>' : '')
      + '<span class="ximSpacer"></span>'
      + (next ? '<button type="button" class="tbtn primary" data-xim="next"' + (canNext ? '' : ' disabled' + (disabledTitle ? ' title="' + esc(disabledTitle) + '"' : '')) + '>' + esc(next) + '</button>' : '');
  }

  function render() {
    if (!host) return;
    var body = state.step === 'file' ? renderFileStep()
      : state.step === 'sheet' ? renderSheetStep()
        : state.step === 'columns' ? renderColumnsStep()
          : state.step === 'match' ? renderMatchStep()
            : state.step === 'review' ? renderReviewStep()
              : renderImportStep();
    host.innerHTML = '<div class="modalCard ximCard" role="dialog" aria-modal="true" aria-label="' + esc(T('Kullanıcı Excelini İçeri Aktar', 'Import your Excel')) + '">'
      + '<div class="ximHead"><strong>' + esc(T('Kullanıcı Excelini İçeri Aktar', 'Import your Excel')) + ' — ' + esc(state.adapter.label) + '</strong>'
      + (state.fileName ? '<span class="muted">' + esc(state.fileName) + (state.sheetName ? ' · ' + esc(state.sheetName) : '') + '</span>' : '') + '</div>'
      + stepper()
      + (state.error ? '<p class="ximNotice is-bad">' + esc(state.error) + '</p>' : '')
      + '<div class="ximBody">' + body + '</div>'
      + '<div class="ximFoot">' + footerButtons() + '</div>'
      + '</div>';
  }

  /* ---------------- OLAYLAR ---------------- */

  function setOption(key, value) {
    state.options[key] = value;
    if (['includeHiddenRows', 'includeHiddenColumns', 'fillMergedCells', 'includeStructuralRows'].indexOf(key) >= 0 && state.grid) rebuildTable();
    invalidatePlan();
  }

  async function goNext() {
    if (state.step === 'file') { state.step = 'sheet'; render(); return; }
    if (state.step === 'sheet') {
      if (!Object.keys(state.assignments).length) autoMap();
      state.step = 'columns'; render(); return;
    }
    if (state.step === 'columns') {
      if (collectionActionMode()) {
        syncCollectionActionState();
        var mappingValidation = currentMappingValidation();
        if (!mappingValidation.ok) { state.error = columnsDisabledReason(mappingValidation); render(); return; }
      }
      state.error = ''; state.step = 'match'; render(); return;
    }
    if (state.step === 'match') {
      state.step = 'review'; state.busy = true; state.error = ''; render();
      try { state.plan = Plan.buildImportPlan(planSpec()); }
      catch (error) { state.error = String(error && error.message || error); }
      state.busy = false; render(); return;
    }
    if (state.step === 'review') { await runImport(); return; }
  }

  function goBack() {
    var index = STEPS.indexOf(state.step);
    if (index <= 0) return;
    state.step = STEPS[index - 1];
    if (state.step === 'review') state.plan = null;
    render();
  }

  async function runImport() {
    var plan = state.plan;
    if (!plan || !plan.executable) return;
    state.step = 'import'; state.busy = true; state.error = ''; state.result = null; render();
    var columnResult = null, created = 0, updated = 0;
    try {
      if (!state.adapter.canEdit()) throw new Error(T('Bu ekranı düzenleme yetkiniz yok.', 'You do not have permission to edit this screen.'));
      // SON KONTROL: kullanıcı önizlemeye bakarken hedef değiştiyse yazma başlamaz.
      var applicable = Plan.assertApplicable(plan, {
        fingerprintSpec: planSpec(), revision: state.adapter.revision(),
        rows: state.adapter.rows(), rowRevision: state.adapter.rowRevision,
      });
      if (!applicable.ok) {
        throw new Error(applicable.code === 'PLAN_NOT_EXECUTABLE'
          ? T('Plan uygulanabilir değil.', 'The plan is not executable.')
          : T('Veriler siz inceleme yaparken değişti. Import planını yenileyin.', 'The data changed while you were reviewing. Rebuild the import plan.'));
      }
      var fieldIdMap = new Map();
      if (plan.newColumns.length) {
        columnResult = await state.adapter.createCustomColumns(plan.newColumns);
        (columnResult.created || []).forEach(function (item) { fieldIdMap.set(item.planFieldId, item.id); });
      }
      var outcome = await state.adapter.execute(plan, fieldIdMap, function (progress) { state.progress = progress; render(); });
      created = outcome.created || 0; updated = outcome.updated || 0;
      state.progress = { stage: 'verifying' }; render();
      await state.adapter.refresh();
      state.result = {
        status: 'success', created: created, updated: updated,
        skipped: plan.summary.skippedRows, failed: outcome.failed || 0,
        warnings: plan.summary.warnings,
        conflictsResolved: plan.conflicts.filter(function (item) { return item.resolved; }).length,
        customFieldsCreated: columnResult ? (columnResult.created || []).length : 0,
        message: (outcome.failed ? T('Aktarım tamamlandı ancak bazı satırlar sunucu tarafından reddedildi.', 'The import finished but some rows were rejected by the server.')
          : T('Aktarım tamamlandı.', 'The import finished.')),
      };
      audit('success', state.result);
    } catch (error) {
      // BAŞARISIZ AKTARIM BAŞARILI GİBİ RAPORLANMAZ.
      if (columnResult && typeof columnResult.rollback === 'function') { try { await columnResult.rollback(); } catch (_) { /* raporlanır */ } }
      state.result = {
        status: 'failed', created: 0, updated: 0, skipped: plan.summary.skippedRows,
        failed: plan.operations.length, warnings: plan.summary.warnings, conflictsResolved: 0, customFieldsCreated: 0,
        message: T('Aktarım başarısız: ', 'The import failed: ') + String(error && error.message || error),
      };
      audit('failed', state.result);
    } finally {
      state.busy = false; state.progress = null; state.plan = null; render();
    }
  }

  function audit(status, result) {
    try {
      fetch('/api/excel-import/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId: state.moduleId, fileName: state.fileName, sheet: state.sheetName,
          profile: state.appliedProfile || '', planId: state.plan ? state.plan.planId : '',
          status: status, analyzed: state.table ? state.table.rows.length : 0,
          created: result.created, updated: result.updated, skipped: result.skipped,
          failed: result.failed, warnings: result.warnings, customFieldsCreated: result.customFieldsCreated,
        }),
      }).catch(function () { /* denetim kaydı içe aktarımı engellemez */ });
    } catch (_) { /* yok sayılır */ }
  }

  async function onFile(file) {
    if (!file) return;
    state.busy = true; state.error = ''; state.fileName = file.name; state.step = 'file'; render();
    try {
      var loaded = await readWorkbookFile(file);
      state.workbook = loaded.workbook;
      state.sheets = Workbook.workbookOverview(loaded.XLSX, loaded.workbook);
      var first = state.sheets.find(function (sheet) { return !sheet.hidden && !sheet.empty; }) || state.sheets[0];
      if (!first) throw new Error(T('Çalışma kitabında okunabilir sayfa yok.', 'The workbook has no readable sheet.'));
      loadSheet(first.name);
      autoMap();
      state.profileMatches = Profiles.match(state.moduleId, {
        fingerprint: Workbook.schemaFingerprint({ sheet: state.sheetName, headerRow: state.analysis.headerRow, columns: state.table.columns }),
        sheetName: state.sheetName,
        columnKeys: state.table.columns.map(function (column) { return column.key; }),
      });
      state.step = 'sheet';
    } catch (error) {
      state.error = String(error && error.message || error);
    } finally { state.busy = false; render(); }
  }

  function applyProfileById(id) {
    var entry = state.profileMatches.find(function (item) { return item.profile.id === id; });
    if (!entry) return;
    var applied = Profiles.applyProfile(entry.profile, state.table.columns, fields());
    state.assignments = Object.assign({}, state.assignments, applied.assignments);
    state.matchFieldIds = applied.matchFieldIds.slice();
    state.options = Object.assign({}, state.options, applied.options);
    state.appliedProfile = entry.profile.name;
    state.newColumns = [];
    if (collectionActionMode()) syncCollectionActionState();
    // Yapı değiştiyse profil OTOMATİK UYGULANMAZ; eşleme gözden geçirilmelidir.
    state.profileNotice = (entry.quality === 'exact' && !applied.requiresReview)
      ? T('Kayıtlı eşleştirme uygulandı. Aktarım yine de onayınızı bekler.', 'The saved mapping was applied. The import still waits for your approval.')
      : T('Çalışma kitabı yapısı kayıtlı profilden farklı. Yalnız güvenli alanlar dolduruldu; eşlemeyi gözden geçirin.', 'The workbook structure differs from the saved profile. Only safe fields were prefilled; review the mapping.');
    if (entry.quality !== 'exact' || applied.requiresReview) {
      Object.keys(state.assignments).forEach(function (columnId) {
        if (state.assignments[columnId].fromProfile) { state.assignments[columnId].needsReview = true; state.assignments[columnId].reviewed = false; }
      });
    }
    invalidatePlan();
  }

  function saveProfile(name) {
    var assignments = {};
    Object.keys(state.assignments).forEach(function (columnId) {
      var entry = state.assignments[columnId] || {};
      var column = state.table.columns.find(function (item) { return item.id === columnId; });
      assignments[columnId] = {
        action: collectionActionMode() ? assignmentAction(entry) : '',
        targetId: entry.targetId || '__ignore__', headerKey: column ? column.key : '',
        newColumnLabel: entry.newColumnLabel || '', newColumnType: entry.newColumnType || '',
      };
    });
    var saved = Profiles.save(state.moduleId, {
      name: name, sheetName: state.sheetName, headerRow: state.analysis.headerRow,
      fingerprint: Workbook.schemaFingerprint({ sheet: state.sheetName, headerRow: state.analysis.headerRow, columns: state.table.columns }),
      columnKeys: state.table.columns.map(function (column) { return column.key; }),
      assignments: assignments, newColumns: state.newColumns, matchFieldIds: state.matchFieldIds, options: state.options,
    });
    state.profiles = Profiles.list(state.moduleId);
    state.appliedProfile = saved.name;
    toast(T('Eşleştirme kaydedildi.', 'The mapping was saved.'));
  }

  function syncNewColumns() {
    state.newColumns = Object.keys(state.assignments).filter(function (columnId) {
      var entry = state.assignments[columnId] || {};
      return entry.targetId === '__new__' || (collectionActionMode() && assignmentAction(entry) === 'create');
    }).map(function (columnId) {
      var entry = state.assignments[columnId];
      var column = state.table.columns.find(function (item) { return item.id === columnId; });
      return { columnId: columnId, label: entry.newColumnLabel || (column ? column.header : columnId), dataType: entry.newColumnType || 'text' };
    });
  }

  function onClick(event) {
    var button = event.target.closest('[data-xim]');
    if (!button) { if (event.target === host) close(); return; }
    var action = button.dataset.xim;
    if (action === 'close') { close(); return; }
    if (action === 'back') { goBack(); return; }
    if (action === 'next') { void goNext(); return; }
    if (action === 'sheet') { loadSheet(button.dataset.name); autoMap(); render(); return; }
    if (action === 'automap') { autoMap(); render(); return; }
    if (action === 'page') { state.page = Math.max(0, state.page + Number(button.dataset.delta)); render(); return; }
    if (action === 'profile-delete') { Profiles.remove(state.moduleId, button.dataset.id); state.profiles = Profiles.list(state.moduleId); render(); return; }
    if (action === 'profile-save') {
      var input = host.querySelector('[data-xim="profile-name"]');
      var name = input && input.value ? input.value.trim() : '';
      if (!name) { toast(T('Profil adı gerekli.', 'A profile name is required.')); return; }
      saveProfile(name); render(); return;
    }
  }

  function onChange(event) {
    var element = event.target.closest('[data-xim]');
    if (!element) return;
    var action = element.dataset.xim;
    if (action === 'file') { void onFile(element.files && element.files[0]); return; }
    if (action === 'option') { setOption(element.dataset.key, element.checked); render(); return; }
    if (action === 'header-row' || action === 'header-row-manual') {
      var row = action === 'header-row' ? Number(element.value) : Number(element.value) - 1;
      if (!Number.isFinite(row) || row < 0) return;
      state.analysis = Workbook.analyzeSheet(state.grid, { headerRow: row });
      rebuildTable(); autoMap(); render(); return;
    }
    if (action === 'column-action' && collectionActionMode()) {
      var columnId = element.dataset.column;
      var nextAction = element.value;
      var entry = Object.assign({}, state.assignments[columnId] || {});
      var column = state.table.columns.find(function (item) { return item.id === columnId; });
      var suggested = entry.suggestedTargetId || '';
      entry.action = nextAction;
      entry.needsReview = false; entry.reviewed = true; entry.confidence = entry.confidence || 'manual';
      if (nextAction === 'ignore') entry.targetId = '__ignore__';
      else if (nextAction === 'create') {
        entry.targetId = '__new__';
        if (!entry.newColumnLabel) entry.newColumnLabel = column ? column.header : columnId;
        if (!entry.newColumnType) {
          var inferred = Mapping.inferColumnType(columnSamples(columnId, 40), column ? column.header : columnId);
          entry.newColumnType = inferred.dataType || 'text';
        }
      } else if (nextAction === 'update') {
        var updateTarget = entry.updateTargetId || (entry.targetId !== '__ignore__' && entry.targetId !== '__new__' ? entry.targetId : '') || suggested;
        if (!fields().some(function (field) { return field.id === updateTarget && field.writable !== false; })) updateTarget = '';
        entry.targetId = updateTarget; entry.updateTargetId = updateTarget;
      } else if (nextAction === 'match') {
        var matchTarget = entry.matchTargetId || (entry.targetId !== '__ignore__' && entry.targetId !== '__new__' ? entry.targetId : '') || suggested;
        if (!fields().some(function (field) { return field.id === matchTarget; })) matchTarget = '';
        entry.targetId = matchTarget; entry.matchTargetId = matchTarget;
      }
      state.assignments[columnId] = entry;
      syncCollectionActionState(); invalidatePlan(); render(); return;
    }
    if (action === 'action-target' && collectionActionMode()) {
      var actionEntry = Object.assign({}, state.assignments[element.dataset.column] || {});
      var actionType = element.dataset.action;
      actionEntry.action = actionType;
      actionEntry.targetId = element.value;
      actionEntry[actionType === 'match' ? 'matchTargetId' : 'updateTargetId'] = element.value;
      actionEntry.needsReview = false; actionEntry.reviewed = true;
      state.assignments[element.dataset.column] = actionEntry;
      syncCollectionActionState(); invalidatePlan(); render(); return;
    }
    if (action === 'assign') {
      var entry = state.assignments[element.dataset.column] || {};
      state.assignments[element.dataset.column] = Object.assign({}, entry, { targetId: element.value, needsReview: false, reviewed: true, confidence: entry.confidence || 'manual' });
      syncNewColumns(); invalidatePlan(); render(); return;
    }
    if (action === 'new-label' || action === 'new-type') {
      var target = state.assignments[element.dataset.column] || {};
      if (action === 'new-label') target.newColumnLabel = element.value; else target.newColumnType = element.value;
      state.assignments[element.dataset.column] = target;
      if (collectionActionMode()) syncCollectionActionState(); else syncNewColumns();
      invalidatePlan(); return;
    }
    if (action === 'review') {
      var reviewed = state.assignments[element.dataset.column] || {};
      reviewed.reviewed = element.checked;
      state.assignments[element.dataset.column] = reviewed;
      invalidatePlan(); render(); return;
    }
    if (action === 'matchfield') {
      if (collectionActionMode()) return;
      var id = element.dataset.id;
      var index = state.matchFieldIds.indexOf(id);
      if (element.checked && index < 0) state.matchFieldIds.push(id);
      if (!element.checked && index >= 0) state.matchFieldIds.splice(index, 1);
      invalidatePlan(); render(); return;
    }
    if (action === 'ambiguous') {
      var value = element.value;
      if (!value) delete state.decisions.ambiguousChoice[element.dataset.row];
      else state.decisions.ambiguousChoice[element.dataset.row] = value === 'skip' || value === 'all' ? value : Number(value);
      rebuildPlan(); return;
    }
    if (action === 'duplicate') {
      if (!element.value) delete state.decisions.duplicateResolution[element.dataset.key];
      else state.decisions.duplicateResolution[element.dataset.key] = { keep: element.value };
      rebuildPlan(); return;
    }
    if (action === 'include') {
      var rowId = element.dataset.row;
      var list = state.decisions.excludedSourceRows;
      var at = list.indexOf(rowId);
      if (!element.checked && at < 0) list.push(rowId);
      if (element.checked && at >= 0) list.splice(at, 1);
      rebuildPlan(); return;
    }
    if (action === 'profile-apply') { if (element.value) { applyProfileById(element.value); render(); } return; }
  }

  function rebuildPlan() {
    state.error = '';
    try { state.plan = Plan.buildImportPlan(planSpec()); }
    catch (error) { state.plan = null; state.error = String(error && error.message || error); }
    render();
  }

  function onKey(event) { if (event.key === 'Escape' && !state.busy) close(); }

  function close() {
    if (!host) return;
    document.removeEventListener('keydown', onKey);
    host.remove();
    host = null;
    state = null;
  }

  function open(moduleId) {
    if (!modules()) { toast(T('İçe aktarma motoru yüklenemedi.', 'The import engine could not be loaded.')); return; }
    var bridge = global.BLExcelImportBridge;
    var adapter = bridge && bridge.get ? bridge.get(moduleId) : null;
    if (!adapter) { toast(T('Bu modül için içe aktarma tanımlı değil.', 'Import is not available for this module.')); return; }
    if (!adapter.canEdit()) { toast(T('Bu ekran yalnız görüntülenebilir.', 'This screen is view-only.')); return; }
    close();
    reset(moduleId, adapter);
    state.profiles = Profiles.list(moduleId);
    host = document.createElement('div');
    host.id = 'excelImportWizard';
    host.className = 'warnOverlay ximOverlay';
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('input', function (event) {
      var element = event.target.closest('[data-xim]');
      if (element && (element.dataset.xim === 'new-label')) onChange(event);
    });
    document.body.appendChild(host);
    document.addEventListener('keydown', onKey);
    render();
  }

  /* Tetikleyici düğmeler delege edilir: araç menüleri dinamik olarak
     yeniden çizilebiliyor ve düğüme doğrudan bağlanan bir dinleyici
     sessizce kopardı. */
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('[data-excel-import]');
      if (!trigger) return;
      event.preventDefault();
      open(trigger.dataset.excelImport);
    });
  }

  global.BLExcelImportWizard = { open: open, close: close, _state: function () { return state; } };
}(typeof window !== 'undefined' ? window : globalThis));
