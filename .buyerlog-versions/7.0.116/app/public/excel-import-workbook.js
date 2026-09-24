/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — ÇALIŞMA KİTABI İNCELEMESİ

   Bu katman DOM bilmez ve SheetJS'e bağımlı değildir. SheetJS yalnız
   `gridFromWorksheet` içinde kullanılır; geri kalan her şey "grid" adı
   verilen küçük, saf bir ara temsil üzerinde çalışır. Böylece başlık
   bulma, birleşik hücre sınıflandırma ve toplam satırı sezme davranışı
   tarayıcı olmadan test edilebilir.

   GÜVENLİK: çalışma kitabı GÜVENİLMEZ VERİDİR. Makro, formül kodu,
   köprü, dış bağlantı veya gömülü komut ÇALIŞTIRILMAZ. Formül hücresi
   için yalnız dosyada saklanan ÖNBELLEKLİ değer (`v`) okunur; önbellekli
   değer yoksa hücre "güvenilmez" işaretlenir ve kullanıcıya gösterilir —
   tahmin edilmez.

   Otomatik sezgiler ÖNERİDİR. Sayfa ve başlık satırı kullanıcı tarafından
   her zaman değiştirilebilir; belirsizlik gizlenmez, `confidence` alanıyla
   birlikte yüzeye çıkar.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelImportWorkbook = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TR_MAP = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };
  var HEADER_SCAN_ROWS = 20;
  var TOTAL_RE = /^(genel\s*toplam|ara\s*toplam|toplam|total|grand\s*total|sub\s*total|subtotal|sum|ortalama|average|count|adet\s*toplam)\b/i;

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function token(value) {
    return text(value)
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (ch) { return TR_MAP[ch] || ch; })
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function isBlank(cell) {
    if (!cell) return true;
    if (cell.value === null || cell.value === undefined) return true;
    return typeof cell.value === 'string' && cell.value.trim() === '';
  }
  function columnLetter(index) {
    var n = Number(index) + 1, out = '';
    if (!Number.isFinite(n) || n < 1) return '';
    while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }
  function columnId(index) { return 'col:' + index; }

  /* ------------------------------------------------------------------
     GRID — saf ara temsil.

     { name, hidden, firstRow, lastRow, firstColumn, lastColumn,
       cells: Map('r:c' -> cell), merges:[{s,e}], hiddenRows:[], hiddenColumns:[] }

     cell = { value, type, formula, text, numFmt }
       value   : dosyadaki DEĞER (formül hücresinde önbellekli sonuç)
       formula : formül metni — ASLA çalıştırılmaz, yalnız raporlanır
       text    : Excel'in biçimlendirilmiş gösterimi (varsa)
     ------------------------------------------------------------------ */
  function makeGrid(spec) {
    var source = spec || {};
    var cells = source.cells instanceof Map ? source.cells : new Map();
    if (!(source.cells instanceof Map) && source.cells && typeof source.cells === 'object') {
      Object.keys(source.cells).forEach(function (key) { cells.set(key, source.cells[key]); });
    }
    var rows = Array.isArray(source.rows) ? source.rows : null;
    if (rows) {
      cells = new Map();
      rows.forEach(function (line, r) {
        (Array.isArray(line) ? line : []).forEach(function (value, c) {
          if (value === null || value === undefined || value === '') return;
          cells.set(r + ':' + c, value && typeof value === 'object' && 'value' in value
            ? value
            : { value: value, type: typeof value === 'number' ? 'n' : 's' });
        });
      });
    }
    var maxRow = -1, maxColumn = -1;
    cells.forEach(function (_cell, key) {
      var parts = key.split(':'), r = Number(parts[0]), c = Number(parts[1]);
      if (r > maxRow) maxRow = r;
      if (c > maxColumn) maxColumn = c;
    });
    return {
      name: text(source.name),
      hidden: Boolean(source.hidden),
      firstRow: Number.isFinite(source.firstRow) ? source.firstRow : 0,
      lastRow: Number.isFinite(source.lastRow) ? source.lastRow : maxRow,
      firstColumn: Number.isFinite(source.firstColumn) ? source.firstColumn : 0,
      lastColumn: Number.isFinite(source.lastColumn) ? source.lastColumn : maxColumn,
      cells: cells,
      merges: Array.isArray(source.merges) ? source.merges : [],
      hiddenRows: Array.isArray(source.hiddenRows) ? source.hiddenRows.slice() : [],
      hiddenColumns: Array.isArray(source.hiddenColumns) ? source.hiddenColumns.slice() : [],
    };
  }
  function cellAt(grid, r, c) { return grid.cells.get(r + ':' + c) || null; }

  /* SheetJS çalışma sayfasını grid'e çevirir. Formül ÇALIŞTIRILMAZ. */
  function gridFromWorksheet(XLSX, worksheet, name) {
    if (!worksheet || !worksheet['!ref']) return makeGrid({ name: name, firstRow: 0, lastRow: -1, firstColumn: 0, lastColumn: -1 });
    var range = XLSX.utils.decode_range(worksheet['!ref']);
    var cells = new Map();
    for (var r = range.s.r; r <= range.e.r; r += 1) {
      for (var c = range.s.c; c <= range.e.c; c += 1) {
        var raw = worksheet[XLSX.utils.encode_cell({ r: r, c: c })];
        if (!raw) continue;
        // t==='e' → Excel'in kendi hata değeri (#REF!, #N/A…). Değer olarak
        // kullanılmaz; formülsüz bile olsa güvenilmez sayılır.
        var errored = raw.t === 'e';
        cells.set(r + ':' + c, {
          value: errored ? null : (raw.v === undefined ? null : raw.v),
          type: raw.t || '',
          formula: raw.f ? String(raw.f) : '',
          text: raw.w == null ? '' : String(raw.w),
          numFmt: raw.z == null ? '' : String(raw.z),
          error: errored ? String(raw.v == null ? '#ERROR' : raw.v) : '',
        });
      }
    }
    var rowMeta = Array.isArray(worksheet['!rows']) ? worksheet['!rows'] : [];
    var colMeta = Array.isArray(worksheet['!cols']) ? worksheet['!cols'] : [];
    var hiddenRows = [], hiddenColumns = [];
    rowMeta.forEach(function (meta, index) { if (meta && meta.hidden) hiddenRows.push(index); });
    colMeta.forEach(function (meta, index) { if (meta && meta.hidden) hiddenColumns.push(index); });
    return makeGrid({
      name: name, cells: cells,
      firstRow: range.s.r, lastRow: range.e.r, firstColumn: range.s.c, lastColumn: range.e.c,
      merges: (worksheet['!merges'] || []).map(function (m) { return { s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }; }),
      hiddenRows: hiddenRows, hiddenColumns: hiddenColumns,
    });
  }

  function workbookOverview(XLSX, workbook) {
    var names = (workbook && workbook.SheetNames) || [];
    var hiddenByName = {};
    ((workbook && workbook.Workbook && workbook.Workbook.Sheets) || []).forEach(function (entry, index) {
      if (entry && Number(entry.Hidden) > 0) hiddenByName[names[index]] = true;
    });
    return names.map(function (name) {
      var worksheet = workbook.Sheets[name];
      var ref = worksheet && worksheet['!ref'] ? String(worksheet['!ref']) : '';
      var range = ref ? XLSX.utils.decode_range(ref) : null;
      return {
        name: name,
        hidden: Boolean(hiddenByName[name]),
        ref: ref,
        rowCount: range ? (range.e.r - range.s.r + 1) : 0,
        columnCount: range ? (range.e.c - range.s.c + 1) : 0,
        empty: !range,
      };
    });
  }

  /* ---------------- BAŞLIK SATIRI SEZGİSİ ---------------- */

  function rowProfile(grid, r) {
    var filled = 0, textCells = 0, numericCells = 0, labels = [], formulas = 0;
    for (var c = grid.firstColumn; c <= grid.lastColumn; c += 1) {
      var cell = cellAt(grid, r, c);
      if (isBlank(cell)) continue;
      filled += 1;
      if (cell.formula) formulas += 1;
      if (typeof cell.value === 'number' || cell.type === 'n' || cell.type === 'd') numericCells += 1;
      else { textCells += 1; labels.push(token(cell.value)); }
    }
    return { row: r, filled: filled, textCells: textCells, numericCells: numericCells, labels: labels, formulas: formulas };
  }

  function headerCandidates(grid) {
    var width = Math.max(1, grid.lastColumn - grid.firstColumn + 1);
    var limit = Math.min(grid.lastRow, grid.firstRow + HEADER_SCAN_ROWS - 1);
    var out = [];
    for (var r = grid.firstRow; r <= limit; r += 1) {
      var profile = rowProfile(grid, r);
      if (!profile.filled) continue;
      var next = r < grid.lastRow ? rowProfile(grid, r + 1) : { filled: 0, numericCells: 0 };
      var distinct = new Set(profile.labels).size;
      var fillRatio = profile.filled / width;
      var textRatio = profile.filled ? profile.textCells / profile.filled : 0;
      var distinctRatio = profile.labels.length ? distinct / profile.labels.length : 0;
      // Başlık satırının ALTINDA veri olmalı. Tek başına metin dolu bir satır
      // (rapor başlığı, açıklama) başlık sayılmamalı.
      var followed = next.filled >= Math.max(1, Math.floor(profile.filled * 0.5)) ? 1 : 0;
      /* KONUM ÖNYARGISI. Başlık neredeyse her zaman en üsttedir. Bu bonus
         olmadan, tamamı metin olan bir tabloda ilk VERİ satırı başlıktan
         daha "temiz" göründüğü için (tekrar eden başlık, kısa etiketler)
         seçiliyordu — ölçülen davranış. Bonus hızla söner: gerçekten aşağıda
         duran bir başlık yine kazanır. */
      var score = (fillRatio * 0.4) + (textRatio * 0.3) + (distinctRatio * 0.15) + (followed * 0.15)
        + (0.15 / (1 + (r - grid.firstRow)));
      if (profile.formulas) score -= 0.1;
      out.push({ row: r, score: Math.max(0, Math.round(score * 1000) / 1000), filled: profile.filled, textRatio: Math.round(textRatio * 100) / 100, followed: Boolean(followed) });
    }
    return out.sort(function (a, b) { return b.score - a.score || a.row - b.row; });
  }

  function detectHeaderRow(grid) {
    var candidates = headerCandidates(grid);
    if (!candidates.length) return { row: grid.firstRow, confidence: 'low', candidates: [] };
    var best = candidates[0], second = candidates[1];
    var gap = second ? best.score - second.score : best.score;
    var confidence = 'low';
    if (best.score >= 0.75 && gap >= 0.12) confidence = 'high';
    else if (best.score >= 0.55) confidence = 'medium';
    return { row: best.row, confidence: confidence, candidates: candidates.slice(0, 6) };
  }

  /* ---------------- YAPISAL İNCELEME ---------------- */

  function mergeCoversRow(merge, r) { return merge.s.r <= r && merge.e.r >= r; }

  function classifyMerges(grid, headerRow) {
    var header = [], data = [];
    grid.merges.forEach(function (merge) {
      var entry = {
        s: { r: merge.s.r, c: merge.s.c }, e: { r: merge.e.r, c: merge.e.c },
        rows: merge.e.r - merge.s.r + 1, columns: merge.e.c - merge.s.c + 1,
        anchorValue: (function () { var cell = cellAt(grid, merge.s.r, merge.s.c); return cell ? cell.value : null; })(),
      };
      // Başlık satırını kesen veya onun üstünde kalan her birleştirme BAŞLIK
      // birleştirmesidir; veri birleştirmesiyle karıştırılırsa aşağı doldurma
      // başlığı iş kaydına çevirirdi.
      if (merge.e.r < headerRow || mergeCoversRow(merge, headerRow)) header.push(entry);
      else data.push(entry);
    });
    return { header: header, data: data };
  }

  function emptyRows(grid, headerRow) {
    var out = [];
    for (var r = headerRow + 1; r <= grid.lastRow; r += 1) {
      if (!rowProfile(grid, r).filled) out.push(r);
    }
    return out;
  }
  function emptyColumns(grid, headerRow) {
    var out = [];
    for (var c = grid.firstColumn; c <= grid.lastColumn; c += 1) {
      var filled = 0;
      for (var r = headerRow; r <= grid.lastRow; r += 1) { if (!isBlank(cellAt(grid, r, c))) { filled += 1; break; } }
      if (!filled) out.push(c);
    }
    return out;
  }

  function headerLabels(grid, headerRow) {
    var out = [];
    for (var c = grid.firstColumn; c <= grid.lastColumn; c += 1) {
      var cell = cellAt(grid, headerRow, c);
      out.push({ index: c, letter: columnLetter(c), raw: cell ? cell.value : null, label: text(cell ? cell.value : ''), key: token(cell ? cell.value : '') });
    }
    return out;
  }

  function duplicateHeaders(labels) {
    var byKey = new Map();
    labels.forEach(function (item) {
      if (!item.key) return;
      if (!byKey.has(item.key)) byKey.set(item.key, []);
      byKey.get(item.key).push(item.index);
    });
    var out = [];
    byKey.forEach(function (indexes, key) {
      if (indexes.length > 1) out.push({ key: key, label: labels.find(function (l) { return l.key === key; }).label, columns: indexes.slice() });
    });
    return out;
  }

  function formulaReport(grid, headerRow) {
    var total = 0, cached = 0, uncached = 0, errored = 0, columns = new Set();
    for (var r = headerRow + 1; r <= grid.lastRow; r += 1) {
      for (var c = grid.firstColumn; c <= grid.lastColumn; c += 1) {
        var cell = cellAt(grid, r, c);
        if (!cell) continue;
        if (cell.error) { errored += 1; columns.add(c); }
        if (!cell.formula) continue;
        total += 1; columns.add(c);
        if (cell.value === null || cell.value === undefined || cell.error) uncached += 1; else cached += 1;
      }
    }
    return { total: total, withCachedValue: cached, withoutCachedValue: uncached, erroredCells: errored, columns: [...columns].sort(function (a, b) { return a - b; }) };
  }

  /* Yapısal (iş kaydı olmayan) satırlar. DÜŞÜK GÜVENLİ bir sezgi sessizce
     kayıt silmez/atmaz: yalnız işaretlenir, kararı kullanıcı verir. */
  function suspiciousRows(grid, headerRow, labels) {
    var headerKeys = new Set(labels.map(function (item) { return item.key; }).filter(Boolean));
    var width = Math.max(1, grid.lastColumn - grid.firstColumn + 1);
    var out = [];
    for (var r = headerRow + 1; r <= grid.lastRow; r += 1) {
      var profile = rowProfile(grid, r);
      if (!profile.filled) continue;
      var matched = profile.labels.filter(function (key) { return key && headerKeys.has(key); }).length;
      if (headerKeys.size && matched >= Math.max(2, Math.ceil(headerKeys.size * 0.6))) {
        out.push({ row: r, kind: 'repeated-header', confidence: 'high', reason: matched + '/' + headerKeys.size });
        continue;
      }
      var firstText = '';
      for (var c = grid.firstColumn; c <= grid.lastColumn; c += 1) {
        var cell = cellAt(grid, r, c);
        if (isBlank(cell)) continue;
        if (typeof cell.value === 'string') { firstText = cell.value; }
        break;
      }
      var anyTotalText = profile.labels.some(function (key) { return TOTAL_RE.test(key); });
      if (TOTAL_RE.test(text(firstText)) || (anyTotalText && profile.numericCells >= 1)) {
        out.push({ row: r, kind: 'total', confidence: TOTAL_RE.test(text(firstText)) ? 'high' : 'medium', reason: text(firstText) || 'total-like' });
        continue;
      }
      if (width >= 3 && profile.filled === 1 && profile.textCells === 1) {
        out.push({ row: r, kind: 'separator', confidence: 'low', reason: 'single-cell-row' });
      }
    }
    return out;
  }

  function analyzeSheet(grid, options) {
    var opts = options || {};
    var detected = detectHeaderRow(grid);
    var headerRow = Number.isFinite(opts.headerRow) ? Number(opts.headerRow) : detected.row;
    var labels = headerLabels(grid, headerRow);
    var merges = classifyMerges(grid, headerRow);
    var duplicates = duplicateHeaders(labels);
    var formulas = formulaReport(grid, headerRow);
    var hiddenRows = grid.hiddenRows.filter(function (r) { return r > headerRow && r <= grid.lastRow; });
    var hiddenColumns = grid.hiddenColumns.filter(function (c) { return c >= grid.firstColumn && c <= grid.lastColumn; });
    var warnings = [];
    if (detected.confidence !== 'high') warnings.push({ code: 'header-uncertain', confidence: detected.confidence });
    if (duplicates.length) warnings.push({ code: 'duplicate-headers', count: duplicates.length });
    if (merges.data.length) warnings.push({ code: 'merged-data-cells', count: merges.data.length });
    if (hiddenRows.length) warnings.push({ code: 'hidden-rows', count: hiddenRows.length });
    if (hiddenColumns.length) warnings.push({ code: 'hidden-columns', count: hiddenColumns.length });
    if (formulas.withoutCachedValue) warnings.push({ code: 'formula-without-value', count: formulas.withoutCachedValue });
    if (labels.some(function (item) { return !item.label; })) warnings.push({ code: 'empty-header-cell' });
    return {
      sheet: grid.name,
      usedRange: { firstRow: grid.firstRow, lastRow: grid.lastRow, firstColumn: grid.firstColumn, lastColumn: grid.lastColumn },
      rowCount: Math.max(0, grid.lastRow - grid.firstRow + 1),
      columnCount: Math.max(0, grid.lastColumn - grid.firstColumn + 1),
      headerRow: headerRow,
      headerConfidence: Number.isFinite(opts.headerRow) ? 'user' : detected.confidence,
      headerCandidates: detected.candidates,
      headers: labels,
      duplicateHeaders: duplicates,
      merges: merges,
      hiddenRows: hiddenRows,
      hiddenColumns: hiddenColumns,
      emptyRows: emptyRows(grid, headerRow),
      emptyColumns: emptyColumns(grid, headerRow),
      formulas: formulas,
      suspiciousRows: suspiciousRows(grid, headerRow, labels),
      warnings: warnings,
    };
  }

  /* ---------------- TABLO ÇIKARIMI ---------------- */

  function mergeLookup(merges) {
    var map = new Map();
    merges.forEach(function (merge) {
      for (var r = merge.s.r; r <= merge.e.r; r += 1) {
        for (var c = merge.s.c; c <= merge.e.c; c += 1) {
          if (r === merge.s.r && c === merge.s.c) continue;
          map.set(r + ':' + c, merge);
        }
      }
    });
    return map;
  }

  /* options:
       includeHiddenRows / includeHiddenColumns : varsayılan false (§gizli veri sessizce girmez)
       fillMergedCells                          : varsayılan false (kullanıcı onayı gerekir)
       excludeRows                              : atlanacak Excel satır indeksleri
  */
  function extractTable(grid, analysis, options) {
    var opts = options || {};
    var headerRow = analysis.headerRow;
    var excluded = new Set((opts.excludeRows || []).map(Number));
    var hiddenRowSet = new Set(analysis.hiddenRows);
    var hiddenColumnSet = new Set(analysis.hiddenColumns);
    var emptyColumnSet = new Set(analysis.emptyColumns);
    var fill = opts.fillMergedCells ? mergeLookup(analysis.merges.data) : null;

    var seenKey = new Map();
    var columns = analysis.headers.filter(function (item) {
      if (!opts.includeHiddenColumns && hiddenColumnSet.has(item.index)) return false;
      if (!item.label && emptyColumnSet.has(item.index)) return false;
      return true;
    }).map(function (item) {
      var occurrence = (seenKey.get(item.key) || 0) + 1;
      seenKey.set(item.key, occurrence);
      return {
        id: columnId(item.index),
        index: item.index,
        letter: item.letter,
        header: item.label || ('(' + item.letter + ')'),
        rawHeader: item.label,
        key: item.key,
        occurrence: occurrence,
        duplicate: occurrence > 1 || analysis.duplicateHeaders.some(function (d) { return d.key === item.key; }),
        hidden: hiddenColumnSet.has(item.index),
        unnamed: !item.label,
      };
    });

    var rows = [], skipped = [];
    for (var r = headerRow + 1; r <= grid.lastRow; r += 1) {
      var flags = [];
      if (excluded.has(r)) { skipped.push({ excelRow: r, reason: 'user-excluded' }); continue; }
      if (hiddenRowSet.has(r)) {
        if (!opts.includeHiddenRows) { skipped.push({ excelRow: r, reason: 'hidden-row' }); continue; }
        flags.push('hidden');
      }
      var suspicious = analysis.suspiciousRows.find(function (item) { return item.row === r; });
      if (suspicious) {
        // repeated-header ve yüksek güvenli total satırları varsayılan olarak
        // ATLANIR; düşük güvenli olanlar VERİ kalır ama işaretlenir.
        if (suspicious.confidence === 'high' && !opts.includeStructuralRows) { skipped.push({ excelRow: r, reason: suspicious.kind }); continue; }
        flags.push(suspicious.kind);
      }
      var cells = {}, filled = 0;
      columns.forEach(function (column) {
        var cell = cellAt(grid, r, column.index);
        var merged = fill ? fill.get(r + ':' + column.index) : null;
        if (isBlank(cell) && merged) {
          var anchor = cellAt(grid, merged.s.r, merged.s.c);
          if (!isBlank(anchor)) { cell = { value: anchor.value, type: anchor.type, formula: '', text: anchor.text, numFmt: anchor.numFmt, filledFromMerge: true }; }
        }
        if (!isBlank(cell)) filled += 1;
        cells[column.id] = cell ? {
          value: cell.value,
          type: cell.type || '',
          formula: cell.formula || '',
          text: cell.text || '',
          numFmt: cell.numFmt || '',
          error: cell.error || '',
          filledFromMerge: Boolean(cell.filledFromMerge),
          // Formül hücresinde önbellekli değer yoksa GÜVENİLMEZ. Hesaplanmaz.
          unreliable: Boolean(cell.error) || Boolean(cell.formula && (cell.value === null || cell.value === undefined)),
        } : { value: null, type: '', formula: '', text: '', numFmt: '', error: '', filledFromMerge: false, unreliable: false };
      });
      if (!filled) { skipped.push({ excelRow: r, reason: 'empty-row' }); continue; }
      rows.push({ id: 'row:' + r, excelRow: r, excelRowNumber: r + 1, flags: flags, cells: cells });
    }
    return { columns: columns, rows: rows, skipped: skipped };
  }

  /* Kaydedilmiş eşleme profilinin doğru çalışma kitabına uygulandığını
     anlamak için dosya adına DEĞİL, sayfa yapısına bakılır. */
  function schemaFingerprint(spec) {
    var source = spec || {};
    var parts = [
      'sheet=' + token(source.sheet),
      'header=' + String(Number(source.headerRow) || 0),
      'cols=' + (Array.isArray(source.columns) ? source.columns : []).map(function (column) {
        return token(column && (column.key || column.header || column.rawHeader));
      }).join('|'),
    ];
    var text0 = parts.join('␟'), hash = 2166136261;
    for (var i = 0; i < text0.length; i += 1) { hash ^= text0.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'wb1:' + (hash >>> 0).toString(36) + ':' + (Array.isArray(source.columns) ? source.columns.length : 0);
  }

  return {
    makeGrid: makeGrid,
    gridFromWorksheet: gridFromWorksheet,
    workbookOverview: workbookOverview,
    detectHeaderRow: detectHeaderRow,
    headerCandidates: headerCandidates,
    analyzeSheet: analyzeSheet,
    extractTable: extractTable,
    schemaFingerprint: schemaFingerprint,
    columnLetter: columnLetter,
    token: token,
  };
}));
