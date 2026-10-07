/* ===================================================================
   KOLEKSİYON — PLM ID LİSTESİNDEN EKLE (saf motor)

   Kullanıcının verdiği PLM ID listesini (yapıştırma, Excel/CSV dosyası ya da
   LCW AI'ın serbest metinden ayıkladığı aday liste) PLM SYNC'in mevcut
   ekleme hattına (/api/plm-sync/fetch → kolBuildPlmImportPlan) hazırlar.

   Bu dosya DOM'a dokunmaz; app-main.js'teki akış onu çağırır. Kurallar:
   - PLM ID normalizasyonu server/lib/plm-id.js ile BİREBİR aynıdır
     (tests/kol-plm-list-import.test.js eşliği denetler).
   - LCW AI önerisi YETKİ DEĞİLDİR: ayıklanan her ID normalize edilir ve
     kaynak metinde rakam dizisi olarak GERÇEKTEN geçmek zorundadır; aksi
     hâlde reddedilir (uydurma ID koleksiyona giremez).
   - Excel'den gelen ek değerler yalnız PLM'nin yönetmediği Buyer Log
     alanlarına ve yalnız YENİ oluşturulan modellere yazılır.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLPlmListImport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Sunucunun tek seferde kabul ettiği üst sınır (plm-sync-routes.js).
  var FETCH_CHUNK_SIZE = 2000;
  var PENDING_LIMIT = 2000;
  var PENDING_KEY_PREFIX = 'lcw.koleksiyon.plmPending.';

  function clean(value) { return String(value == null ? '' : value).trim(); }

  /* server/lib/plm-id.js normalizePlmId ile aynı davranış. */
  function normalizePlmId(value) {
    var text = clean(value).replace(/^_+/, '').replace(/\.(?=\d{3}(?:\D|$))/g, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }

  /* Yapıştırılan liste: satır, virgül, noktalı virgül, sekme, boşluk ve dikey
     çizgi ayırıcıdır. Rakam içermeyen parçalar (ör. "PLM Code" başlığı)
     sessizce atlanır; rakam içerip geçerli PLM ID olmayanlar "geçersiz"
     olarak raporlanır. Sıra korunur. */
  function parseIdText(text) {
    var tokens = String(text == null ? '' : text).split(/[\s,;|]+/);
    var ids = [], invalid = [], duplicates = [], seen = new Set(), ignored = 0;
    tokens.forEach(function (raw) {
      var token = clean(raw).replace(/^["'(\[]+|["')\].:]+$/g, '');
      if (!token) return;
      if (!/\d/.test(token)) { ignored += 1; return; }
      var id = normalizePlmId(token);
      if (!id) { if (invalid.indexOf(token) < 0) invalid.push(token); return; }
      if (seen.has(id)) { if (duplicates.indexOf(id) < 0) duplicates.push(id); return; }
      seen.add(id);
      ids.push(id);
    });
    return { ids: ids, invalid: invalid, duplicates: duplicates, ignored: ignored };
  }

  function uniqueIds(values) {
    var out = [], seen = new Set();
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var id = normalizePlmId(value);
      if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    });
    return out;
  }

  function chunk(values, size) {
    var step = Math.max(1, Math.trunc(Number(size)) || FETCH_CHUNK_SIZE), out = [];
    for (var i = 0; i < values.length; i += step) out.push(values.slice(i, i + step));
    return out;
  }

  /* Ön kontrol: hangi ID'ler Koleksiyon'da zaten var? existingIds,
     Koleksiyon satırlarının normalize PLM ID kümesidir. */
  function classify(ids, existingIds) {
    var known = existingIds instanceof Set ? existingIds : new Set(uniqueIds(existingIds));
    var fresh = [], existing = [];
    uniqueIds(ids).forEach(function (id) { (known.has(id) ? existing : fresh).push(id); });
    return { fresh: fresh, existing: existing };
  }

  /* ---------------- Excel / CSV ---------------- */

  function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    return clean(value);
  }

  /* Başlık eşleşmesi tek başına yetmez: sütundaki dolu değerlerin en az
     yarısı geçerli PLM ID olmalı (ör. "PLM Status" sütunu seçilmesin). */
  function columnLooksLikePlm(rows, headerRow, index) {
    var filled = 0, valid = 0;
    for (var r = headerRow + 1; r < rows.length && filled < 200; r += 1) {
      var value = cellText((Array.isArray(rows[r]) ? rows[r] : [])[index]);
      if (!value) continue;
      filled += 1;
      if (normalizePlmId(value)) valid += 1;
    }
    return filled > 0 && valid * 2 >= filled;
  }

  /* Başlık satırı: ilk 15 satırda PLM alanına (fieldId 'plmId') eşlenen
     sütunu olan ilk satır. Eşleme, kanonik alan kaydını kullanan ortak
     BLExcelImportMapping.suggestMapping'den gelir; burada ikinci bir başlık
     sözlüğü YOKTUR. Başlık bulunamazsa ve sayfa tek sütunsa (yalnız ID
     listesi), sütun PLM ID kabul edilir. */
  function detectSheet(matrix, fields, mapping) {
    var rows = Array.isArray(matrix) ? matrix : [];
    var suggest = mapping && typeof mapping.suggestMapping === 'function' ? mapping.suggestMapping : null;
    var ignoreId = mapping && mapping.IGNORE || '__ignore__';
    var limit = Math.min(rows.length, 15);
    for (var r = 0; r < limit && suggest; r += 1) {
      var header = (Array.isArray(rows[r]) ? rows[r] : []).map(cellText);
      if (!header.some(Boolean)) continue;
      var columns = header.map(function (title, index) { return { id: 'c' + index, index: index, header: title, rawHeader: title }; }).filter(function (column) { return column.header; });
      var assignments = suggest(columns, fields || []);
      var plmColumn = null, extras = [];
      columns.forEach(function (column) {
        var entry = assignments[column.id];
        if (!entry || entry.targetId === ignoreId || !entry.targetId) return;
        if (entry.targetId === 'plmId') { if (!plmColumn) plmColumn = column; return; }
        if (entry.confidence !== 'high' && entry.confidence !== 'medium') return;
        extras.push({ index: column.index, header: column.header, fieldId: entry.targetId, confidence: entry.confidence });
      });
      if (plmColumn && columnLooksLikePlm(rows, r, plmColumn.index)) return { headerRow: r, plmIndex: plmColumn.index, plmHeader: plmColumn.header, extras: extras };
    }
    var width = rows.reduce(function (max, row) { return Math.max(max, (Array.isArray(row) ? row : []).filter(function (value) { return cellText(value); }).length); }, 0);
    if (width === 1) {
      var first = rows.findIndex(function (row) { return (Array.isArray(row) ? row : []).some(function (value) { return cellText(value); }); });
      var firstRow = first >= 0 ? rows[first] : [];
      var index = (Array.isArray(firstRow) ? firstRow : []).findIndex(function (value) { return cellText(value); });
      var headerLike = first >= 0 && !normalizePlmId(cellText(firstRow[index]));
      if (!columnLooksLikePlm(rows, headerLike ? first : first - 1, index)) return null;
      return { headerRow: headerLike ? first : first - 1, plmIndex: index, plmHeader: headerLike ? cellText(firstRow[index]) : '', extras: [] };
    }
    return null;
  }

  /* Başlıktan sonraki satırları okur. extras yalnız seçilmiş (enabled)
     ek alanlardır. Aynı PLM ID birden çok satırdaysa ilk satırın değerleri
     kullanılır, sonrakiler "duplicates" olarak raporlanır. */
  function readSheetRows(matrix, layout, extras) {
    var rows = Array.isArray(matrix) ? matrix : [];
    var chosen = Array.isArray(extras) ? extras : [];
    var ids = [], invalid = [], duplicates = [], valuesById = {}, seen = new Set();
    if (!layout || layout.plmIndex == null || layout.plmIndex < 0) return { ids: ids, invalid: invalid, duplicates: duplicates, valuesById: valuesById };
    for (var r = layout.headerRow + 1; r < rows.length; r += 1) {
      var row = Array.isArray(rows[r]) ? rows[r] : [];
      var raw = cellText(row[layout.plmIndex]);
      if (!raw) continue;
      var id = normalizePlmId(raw);
      if (!id) { if (invalid.indexOf(raw) < 0) invalid.push(raw); continue; }
      if (seen.has(id)) { if (duplicates.indexOf(id) < 0) duplicates.push(id); continue; }
      seen.add(id);
      ids.push(id);
      var values = {};
      chosen.forEach(function (extra) {
        var value = row[extra.index];
        if (cellText(value)) values[extra.fieldId] = value instanceof Date ? cellText(value) : value;
      });
      if (Object.keys(values).length) valuesById[id] = values;
    }
    return { ids: ids, invalid: invalid, duplicates: duplicates, valuesById: valuesById };
  }

  /* ---------------- LCW AI doğrulaması ---------------- */

  /* AI'ın döndürdüğü her aday normalize edilir ve kaynak metindeki rakam
     dizilerinden birine (aynı normalizasyonla) eşit olmalıdır. Böylece AI
     yalnız metinde gerçekten yazılı bir ID'yi seçebilir; ID uyduramaz ya da
     rakamları değiştiremez. */
  function sourceNumberSet(text) {
    var out = new Set();
    var matches = String(text == null ? '' : text).match(/_*\d[\d.]*/g) || [];
    matches.forEach(function (match) {
      var id = normalizePlmId(match.replace(/\.+$/, ''));
      if (id) out.add(id);
    });
    return out;
  }
  function validateAiIds(candidates, sourceText) {
    var present = sourceNumberSet(sourceText);
    var accepted = [], rejected = [], seen = new Set();
    (Array.isArray(candidates) ? candidates : []).forEach(function (candidate) {
      var raw = clean(candidate);
      if (!raw) return;
      var id = normalizePlmId(raw);
      if (!id || !present.has(id)) { if (rejected.indexOf(raw) < 0) rejected.push(raw); return; }
      if (seen.has(id)) return;
      seen.add(id);
      accepted.push(id);
    });
    return { accepted: accepted, rejected: rejected };
  }

  /* ---------------- Renk varyantları ---------------- */

  /* 'each'  : PLM'deki her renk ayrı Koleksiyon satırı (mevcut davranış).
     'single': PLM ID başına tek satır; PLM'deki ilk renk kullanılır. */
  function applyColourMode(records, mode) {
    var list = Array.isArray(records) ? records : [];
    if (mode !== 'single') return list;
    return list.map(function (record) {
      if (!record || typeof record !== 'object') return record;
      var copy = Object.assign({}, record);
      if (Array.isArray(record.colors)) copy.colors = record.colors.slice(0, 1);
      if (Array.isArray(record.colours)) copy.colours = record.colours.slice(0, 1);
      return copy;
    });
  }

  /* ---------------- Bekleyen (PLM'de bulunamayan) liste ---------------- */

  function pendingKey(workspaceId) {
    return PENDING_KEY_PREFIX + String(workspaceId || 'default').replace(/[^A-Za-z0-9_-]/g, '_') + '.v1';
  }
  function normalizePending(value) {
    var source = value && typeof value === 'object' && Array.isArray(value.items) ? value.items : (Array.isArray(value) ? value : []);
    var out = [], seen = new Set();
    source.forEach(function (item) {
      var id = normalizePlmId(item && typeof item === 'object' ? item.plmId : item);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({
        plmId: id,
        addedAt: clean(item && item.addedAt) || '',
        lastTriedAt: clean(item && item.lastTriedAt) || '',
        attempts: Math.max(0, Math.trunc(Number(item && item.attempts)) || 0),
      });
    });
    return out.slice(-PENDING_LIMIT);
  }
  /* Bu turda PLM'de bulunamayanları ekler/günceller, bulunanları çıkarır. */
  function updatePending(list, result, now) {
    var stamp = clean(now) || new Date().toISOString();
    var notFound = new Set(uniqueIds(result && result.notFound));
    var found = new Set(uniqueIds(result && result.found));
    var byId = new Map(normalizePending(list).map(function (item) { return [item.plmId, item]; }));
    found.forEach(function (id) { byId.delete(id); });
    notFound.forEach(function (id) {
      var previous = byId.get(id);
      byId.set(id, {
        plmId: id,
        addedAt: previous && previous.addedAt || stamp,
        lastTriedAt: stamp,
        attempts: (previous ? previous.attempts : 0) + 1,
      });
    });
    return normalizePending(Array.from(byId.values()));
  }
  function removePending(list, ids) {
    var drop = new Set(uniqueIds(ids));
    return normalizePending(list).filter(function (item) { return !drop.has(item.plmId); });
  }

  return Object.freeze({
    FETCH_CHUNK_SIZE: FETCH_CHUNK_SIZE,
    PENDING_LIMIT: PENDING_LIMIT,
    PENDING_KEY_PREFIX: PENDING_KEY_PREFIX,
    normalizePlmId: normalizePlmId,
    parseIdText: parseIdText,
    uniqueIds: uniqueIds,
    chunk: chunk,
    classify: classify,
    detectSheet: detectSheet,
    readSheetRows: readSheetRows,
    validateAiIds: validateAiIds,
    applyColourMode: applyColourMode,
    pendingKey: pendingKey,
    normalizePending: normalizePending,
    updatePending: updatePending,
    removePending: removePending,
  });
}));
