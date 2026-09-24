/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — YETKİLİ İÇE AKTARMA PLANI

   ÖNİZLEME VE UYGULAMA AYNI PLANI KULLANIR. Uygulama sırasında ikinci
   bir eşleme/güncelleme mantığı çalıştırılmaz; `execute` yalnız planın
   `operations` dizisini yazar. Plan dondurulur (Object.freeze) ve bir
   parmak izi taşır: eşleme, eşleşme kuralı, dahil/hariç kararları,
   kaynak yapısı veya hedef revizyonu değiştiğinde parmak izi değişir ve
   plan geçersizleşir. Bayat bir önizleme hiçbir zaman uygulanmaz.

   BOŞ HÜCRE GÜVENLİĞİ (varsayılan): boş gelen değer DEĞİŞİKLİK DEĞİLDİR.
   Bir Excel hücresinin boş olması mevcut Buyer Log verisini silmez.
   "Boş Excel hücreleri mevcut değerleri temizlesin" ayrı bir ayardır,
   varsayılanı KAPALI ve önizlemede görünür.

   KİMLİK ALANLARI SAYI DEĞİLDİR. Colour Code, PLM ID, Order Code, MAG,
   MMYG, Season ve Special Code kimlik olarak taşınır; baştaki sıfır
   kaynaktan okunabildiği sürece korunur, okunamıyorsa TAHMİN EDİLMEZ —
   uyarı üretilir.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelImportPlan = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var PLAN_VERSION = 1;
  var EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  var MS_PER_DAY = 86400000;
  var IDENTITY_TYPES = { code: true, 'code/id': true };

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function isBlankValue(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    return false;
  }
  function pad(value) { return String(value).padStart(2, '0'); }
  function isoDate(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }

  /* Excel seri numarası → takvim günü. Saat dilimi matematiğine
     güvenilmez: dönüşüm UTC üzerinden yapılır, sonuç YEREL gece yarısı
     bir Date olarak kurulur. Böylece UTC+X'te gün kayması olmaz. */
  function dateFromSerial(serial) {
    var value = Number(serial);
    if (!Number.isFinite(value)) return null;
    // 60 = Excel'in var olmayan 29.02.1900'ü. Tahmin edilmez.
    if (value === 60) return null;
    if (value < 1 || value > 2958465) return null;
    var whole = Math.floor(value);
    var utc = new Date(EXCEL_EPOCH_UTC + whole * MS_PER_DAY);
    if (Number.isNaN(utc.getTime())) return null;
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }

  function parseDateValue(cell) {
    var value = cell && 'value' in cell ? cell.value : cell;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number') {
      // Hücre tarih biçimliyse ya da makul bir seri aralığındaysa seri kabul edilir.
      return dateFromSerial(value);
    }
    var dates = root && root.BLExcelDates;
    if (dates && typeof dates.parseDate === 'function') return dates.parseDate(value);
    var parsed = new Date(text(value));
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function parseNumberValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    var schema = root && root.BLColumnSchema;
    if (schema && typeof schema.parseNumber === 'function') return schema.parseNumber(value);
    var raw = text(value).replace(/\s/g, '').replace(',', '.');
    var numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }

  var BOOLEAN_TRUE = new Set(['TRUE', '1', 'YES', 'EVET', 'X', 'VAR', 'OK']);
  var BOOLEAN_FALSE = new Set(['FALSE', '0', 'NO', 'HAYIR', 'YOK']);
  function parseBooleanValue(value) {
    if (typeof value === 'boolean') return value;
    var key = text(value).toLocaleUpperCase('tr-TR').replace(/[İI]/g, 'I');
    if (BOOLEAN_TRUE.has(key)) return true;
    if (BOOLEAN_FALSE.has(key)) return false;
    return null;
  }

  /* Bir Excel hücresini hedef alanın sözleşmesine çevirir.
     Döner: { kind:'blank'|'value'|'invalid'|'unreliable', value, warnings:[] } */
  function coerceCell(cell, field) {
    var warnings = [];
    if (!cell) return { kind: 'blank', value: null, warnings: warnings };
    if (cell.unreliable) {
      return { kind: 'unreliable', value: null, warnings: [{ code: cell.error ? 'cell-error' : 'formula-without-value', detail: cell.error || cell.formula }] };
    }
    var raw = cell.value;
    if (isBlankValue(raw)) return { kind: 'blank', value: null, warnings: warnings };
    var dataType = (field && field.dataType) || 'text';

    if (dataType === 'date' || dataType === 'datetime') {
      var date = parseDateValue(cell);
      if (!date) return { kind: 'invalid', value: null, warnings: [{ code: 'invalid-date', detail: text(cell.text || raw) }] };
      return { kind: 'value', value: isoDate(date), display: isoDate(date), warnings: warnings };
    }
    if (dataType === 'number' || dataType === 'decimal' || dataType === 'integer' || dataType === 'quantity' || dataType === 'currency' || dataType === 'percentage') {
      var numeric = parseNumberValue(raw);
      if (numeric === null) return { kind: 'invalid', value: null, warnings: [{ code: 'invalid-number', detail: text(cell.text || raw) }] };
      if ((dataType === 'integer' || dataType === 'quantity') && !Number.isInteger(numeric)) {
        warnings.push({ code: 'decimal-truncated', detail: String(numeric) });
        numeric = Math.trunc(numeric);
      }
      return { kind: 'value', value: numeric, display: String(numeric), warnings: warnings };
    }
    if (dataType === 'boolean') {
      var flag = parseBooleanValue(raw);
      if (flag === null) return { kind: 'invalid', value: null, warnings: [{ code: 'invalid-boolean', detail: text(cell.text || raw) }] };
      return { kind: 'value', value: flag, display: flag ? 'true' : 'false', warnings: warnings };
    }
    if (IDENTITY_TYPES[dataType]) {
      /* KİMLİK. Sayı olarak okunmuş bir kod, Excel'in hücreyi sayıya
         çevirmiş olmasından ötürü baştaki sıfırını kaybetmiş OLABİLİR.
         Biçimli gösterim (w) sıfırı koruyorsa o kullanılır; korumuyorsa
         kayıp ONARILMAZ, uyarı üretilir (§9). */
        var display = text(cell.text);
      if (typeof raw === 'number') {
        if (display && /^0\d+$/.test(display)) return { kind: 'value', value: display, display: display, warnings: warnings };
        var asText = String(raw);
        if (/^\d+$/.test(asText) && /0("|#)/.test(cell.numFmt || '')) {
          warnings.push({ code: 'leading-zero-uncertain', detail: asText });
        } else if (/^\d+$/.test(asText) && String(cell.numFmt || '').indexOf('0') === 0 && String(cell.numFmt || '').length > asText.length) {
          warnings.push({ code: 'leading-zero-uncertain', detail: asText });
        }
        return { kind: 'value', value: asText, display: asText, warnings: warnings };
      }
      var code = text(raw);
      if (/^[-+]?\d+\.0+$/.test(code)) code = code.replace(/\.0+$/, '');
      return { kind: 'value', value: code, display: code, warnings: warnings };
    }
    var plain = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : text(raw);
    return { kind: 'value', value: plain, display: plain, warnings: warnings };
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (isBlankValue(a) && isBlankValue(b)) return true;
    if (typeof a === 'number' || typeof b === 'number') {
      var left = typeof a === 'number' ? a : parseNumberValue(a);
      var right = typeof b === 'number' ? b : parseNumberValue(b);
      if (left !== null && right !== null) return left === right;
    }
    return text(a) === text(b);
  }

  /* ---------------- PARMAK İZİ ---------------- */

  function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function hash(value) {
    var source = stableStringify(value), h1 = 2166136261, h2 = 5381;
    for (var i = 0; i < source.length; i += 1) {
      var code = source.charCodeAt(i);
      h1 ^= code; h1 = Math.imul(h1, 16777619);
      h2 = ((h2 << 5) + h2 + code) | 0;
    }
    return ((h1 >>> 0).toString(36) + '-' + (h2 >>> 0).toString(36));
  }

  function fingerprintInputs(spec) {
    var source = spec.source || {}, mapping = spec.mapping || {}, options = spec.options || {}, decisions = spec.decisions || {};
    return {
      version: PLAN_VERSION,
      moduleId: spec.moduleId,
      source: { fingerprint: source.fingerprint, sheet: source.sheetName, headerRow: source.headerRow, rowCount: (source.rows || []).length },
      mapping: { assignments: mapping.assignments || {}, newColumns: mapping.newColumns || [] },
      matchRule: { fieldIds: (spec.matchRule && spec.matchRule.fieldIds) || [] },
      options: {
        blankClears: Boolean(options.blankClears), createNew: Boolean(options.createNew),
        includeHiddenRows: Boolean(options.includeHiddenRows), includeHiddenColumns: Boolean(options.includeHiddenColumns),
        fillMergedCells: Boolean(options.fillMergedCells), includeStructuralRows: Boolean(options.includeStructuralRows),
      },
      decisions: {
        excludedSourceRows: (decisions.excludedSourceRows || []).slice().sort(),
        ambiguousChoice: decisions.ambiguousChoice || {},
        duplicateResolution: decisions.duplicateResolution || {},
      },
      target: { revision: spec.target && spec.target.revision },
    };
  }

  /* ---------------- PLAN KURULUMU ---------------- */

  function buildImportPlan(spec) {
    var source = spec.source || {};
    var fields = Array.isArray(spec.fields) ? spec.fields : [];
    var fieldById = new Map(fields.map(function (field) { return [field.id, field]; }));
    var mapping = spec.mapping || {};
    var assignments = mapping.assignments || {};
    var newColumns = Array.isArray(mapping.newColumns) ? mapping.newColumns : [];
    var options = spec.options || {};
    var decisions = spec.decisions || {};
    var target = spec.target || {};
    var targetRows = Array.isArray(target.rows) ? target.rows : [];
    var readValue = typeof target.readValue === 'function' ? target.readValue : function () { return ''; };
    var rowRevision = typeof target.rowRevision === 'function' ? target.rowRevision : function () { return null; };
    var rowLabel = typeof target.rowLabel === 'function' ? target.rowLabel : function (_row, position) { return '#' + (position + 1); };
    var matchFieldIds = (spec.matchRule && spec.matchRule.fieldIds) || [];
    var blocking = [], warnings = [];

    // Yeni sütunlar plana kendi alan tanımlarıyla girer: eşleme ve yazma
    // bunları normal bir hedef alan gibi görür.
    var pendingColumns = newColumns.map(function (item) {
      return {
        id: item.id || ('new:' + item.columnId),
        columnId: item.columnId,
        label: item.label,
        dataType: item.dataType || 'text',
        isNew: true,
      };
    });
    pendingColumns.forEach(function (item) {
      if (!fieldById.has(item.id)) fieldById.set(item.id, { id: item.id, label: item.label, dataType: item.dataType, isNew: true });
    });

    var mapped = [];
    var validActions = new Set(['ignore', 'create', 'update', 'match']);
    Object.keys(assignments).forEach(function (columnId) {
      var entry = assignments[columnId] || {};
      var action = String(entry.action || '').toLowerCase();
      var explicitAction = validActions.has(action);
      var targetId = entry.targetId;
      if (explicitAction && action === 'ignore') return;
      if (explicitAction && action === 'create') targetId = '__new__';
      if (!targetId || targetId === '__ignore__') return;
      if (targetId === '__new__') {
        var created = pendingColumns.find(function (item) { return item.columnId === columnId; });
        if (created) mapped.push({ columnId: columnId, field: fieldById.get(created.id), action: explicitAction ? action : 'legacy' });
        return;
      }
      var field = fieldById.get(targetId);
      if (field) mapped.push({ columnId: columnId, field: field, action: explicitAction ? action : 'legacy' });
    });

    var matchFields = matchFieldIds.map(function (id) { return fieldById.get(id); }).filter(Boolean);
    if (matchFields.length !== matchFieldIds.length) blocking.push({ code: 'match-field-unknown', fieldIds: matchFieldIds });
    // Action-based Collection mappings make match-only columns explicit.
    // Legacy CP/profiles have no action and preserve the old targetId +
    // matchFieldIds behaviour.
    var matchColumnByField = new Map(mapped.filter(function (item) {
      return item.action === 'match' || (item.action === 'legacy' && matchFieldIds.indexOf(item.field.id) >= 0);
    }).map(function (item) { return [item.field.id, item.columnId]; }));
    matchFields.forEach(function (field) {
      if (!matchColumnByField.has(field.id)) blocking.push({ code: 'match-field-not-mapped', fieldId: field.id });
    });

    var excluded = new Set(decisions.excludedSourceRows || []);
    var sourceRows = (source.rows || []);

    // 1 · Gelen satırların anahtar değerlerini üret.
    var matchApi = root && root.BLExcelImportMatch;
    var incoming = [], invalidRows = [], coerced = new Map();
    sourceRows.forEach(function (row) {
      var values = {}, cells = [], createCells = [], rowWarnings = [], rowInvalid = [];
      mapped.forEach(function (item) {
        var cell = row.cells[item.columnId];
        var result = coerceCell(cell, item.field);
        (result.warnings || []).forEach(function (warning) { rowWarnings.push(Object.assign({ fieldId: item.field.id, columnId: item.columnId }, warning)); });
        if (result.kind === 'invalid' || result.kind === 'unreliable') {
          rowInvalid.push({ fieldId: item.field.id, columnId: item.columnId, kind: result.kind, warnings: result.warnings });
        }
        values[item.field.id] = result.kind === 'value' ? result.value : null;
        var payloadCell = { columnId: item.columnId, fieldId: item.field.id, label: item.field.label, kind: result.kind, incoming: result.kind === 'value' ? result.value : null, raw: cell ? cell.value : null, action: item.action };
        // Match-only fields locate existing rows and are never updates. When an
        // unmatched Collection row is CREATED, however, their values are part
        // of the new row identity (Model/Colour/PLM) and therefore belong in
        // createCells.
        createCells.push(payloadCell);
        if (item.action !== 'match') cells.push(payloadCell);
      });
      coerced.set(row.id, { values: values, cells: cells, createCells: createCells, warnings: rowWarnings, invalid: rowInvalid, flags: row.flags || [] });
      if (excluded.has(row.id)) return;
      incoming.push({ id: row.id, excelRow: row.excelRowNumber || row.excelRow, values: values });
    });

    // 2 · Eşleştir.
    var targetIndex = matchApi.buildTargetIndex(targetRows, matchFields, readValue);
    var matchResult = matchApi.classifyMatches({ incoming: incoming, matchFields: matchFields, targetIndex: targetIndex });
    var resultByRow = new Map(matchResult.results.map(function (item) { return [item.sourceRowId, item]; }));

    // 3 · Çakışmalar.
    var conflicts = [];
    matchResult.incomingDuplicates.forEach(function (item) {
      var resolution = (decisions.duplicateResolution || {})[item.key];
      conflicts.push({ kind: 'incoming-duplicate', key: item.key, sourceRowIds: item.sourceRowIds, resolved: Boolean(resolution), resolution: resolution || null });
    });
    matchResult.reverseDuplicates.forEach(function (item) {
      var key = 'target:' + item.targetPosition;
      var resolution = (decisions.duplicateResolution || {})[key];
      conflicts.push({
        kind: 'reverse-duplicate', targetPosition: item.targetPosition,
        targetLabel: rowLabel(targetRows[item.targetPosition], item.targetPosition),
        sourceRowIds: item.sourceRowIds, resolved: Boolean(resolution), resolution: resolution || null,
      });
    });

    var ambiguousChoice = decisions.ambiguousChoice || {};

    // 4 · İşlemler.
    var operations = [], skipped = [], changedCells = 0, createCount = 0, updateCount = 0;
    var duplicateBlockedRows = new Set();
    conflicts.forEach(function (conflict) {
      if (conflict.resolved) {
        // Çözüm yalnız seçilen satırı bırakır; diğerleri atlanır.
        var keep = conflict.resolution && conflict.resolution.keep;
        conflict.sourceRowIds.forEach(function (id) { if (id !== keep) duplicateBlockedRows.add(id); });
        return;
      }
      conflict.sourceRowIds.forEach(function (id) { duplicateBlockedRows.add(id); });
      blocking.push({ code: conflict.kind, key: conflict.key || conflict.targetLabel, sourceRowIds: conflict.sourceRowIds });
    });

    sourceRows.forEach(function (row) {
      var payload = coerced.get(row.id);
      if (excluded.has(row.id)) { skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'user-excluded' }); return; }
      var match = resultByRow.get(row.id);
      if (!match) { skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'not-classified' }); return; }
      if (match.status === 'invalid') { skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'missing-identifier' }); return; }
      if (duplicateBlockedRows.has(row.id)) { skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'duplicate-conflict' }); return; }
      if (payload.invalid.length) {
        skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'invalid-cell', detail: payload.invalid.slice() });
        return;
      }

      if (match.status === 'none') {
        if (!options.createNew || target.canCreate === false) {
          skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: target.canCreate === false ? 'create-not-supported' : 'create-disabled' });
          return;
        }
        var values = {};
        var createCells = Array.isArray(payload.createCells) ? payload.createCells : payload.cells;
        createCells.forEach(function (cell) { if (cell.kind === 'value') values[cell.fieldId] = cell.incoming; });
        operations.push(Object.freeze({
          op: 'create', sourceRowId: row.id, excelRow: row.excelRowNumber,
          values: Object.freeze(values),
          cells: Object.freeze(createCells.map(function (cell) {
            return Object.freeze({ fieldId: cell.fieldId, label: cell.label, incoming: cell.incoming, current: null, final: cell.kind === 'value' ? cell.incoming : null, kind: cell.kind === 'value' ? 'set' : 'blank' });
          })),
          warnings: Object.freeze(payload.warnings.slice()),
        }));
        createCount += 1;
        changedCells += Object.keys(values).length;
        return;
      }

      var targets = [];
      if (match.status === 'exact') targets = match.targets.slice();
      else {
        var choice = ambiguousChoice[row.id];
        if (choice === undefined || choice === null || choice === 'skip') {
          skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'ambiguous-unresolved', targets: match.targets.map(function (t) { return t.position; }) });
          if (choice !== 'skip') blocking.push({ code: 'ambiguous-match', sourceRowId: row.id, excelRow: row.excelRowNumber, targets: match.targets.length });
          return;
        }
        // "Hepsine uygula" AÇIK bir karardır; bu noktaya ancak kullanıcı
        // onayıyla gelinir.
        if (choice === 'all') targets = match.targets.slice();
        else {
          var picked = match.targets.find(function (item) { return item.position === choice; });
          if (!picked) { skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'ambiguous-choice-invalid' }); return; }
          targets = [picked];
        }
      }

      targets.forEach(function (hit) {
        var changes = [], preview = [];
        payload.cells.forEach(function (cell) {
          var field = fieldById.get(cell.fieldId);
          if (field && field.writable === false) {
            // Kimlik sütunu: eşleşme için okunur, GÜNCELLEMEDE yazılmaz.
            preview.push(Object.freeze({
              fieldId: cell.fieldId, label: cell.label, incoming: cell.kind === 'value' ? cell.incoming : null,
              current: readValue(hit.row, cell.fieldId), final: readValue(hit.row, cell.fieldId), kind: 'identity',
            }));
            return;
          }
          var current = field && field.isNew ? null : readValue(hit.row, cell.fieldId);
          var final = current;
          var kind = 'unchanged';
          if (cell.kind === 'value') {
            var forceExplicit = typeof target.forceExplicitSet === 'function'
              && target.forceExplicitSet(hit.row, cell.fieldId, cell.incoming, current) === true;
            if (!sameValue(current, cell.incoming) || forceExplicit) { final = cell.incoming; kind = 'set'; }
          } else if (cell.kind === 'blank') {
            // VARSAYILAN: boş hücre değişiklik değildir.
            if (options.blankClears && !isBlankValue(current)) { final = ''; kind = 'clear'; }
          }
          preview.push(Object.freeze({ fieldId: cell.fieldId, label: cell.label, incoming: cell.kind === 'value' ? cell.incoming : null, current: current, final: final, kind: kind }));
          if (kind !== 'unchanged') changes.push(Object.freeze({ fieldId: cell.fieldId, label: cell.label, from: current, to: final, kind: kind }));
        });
        if (!changes.length) {
          skipped.push({ sourceRowId: row.id, excelRow: row.excelRowNumber, reason: 'no-change', targetPosition: hit.position });
          return;
        }
        operations.push(Object.freeze({
          op: 'update', sourceRowId: row.id, excelRow: row.excelRowNumber,
          targetPosition: hit.position,
          targetLabel: rowLabel(hit.row, hit.position),
          targetRev: rowRevision(hit.row),
          changes: Object.freeze(changes),
          cells: Object.freeze(preview),
          warnings: Object.freeze(payload.warnings.slice()),
        }));
        updateCount += 1;
        changedCells += changes.length;
      });
    });

    payloadWarnings(coerced, warnings);

    var revisionGuard = Object.freeze({
      storeRevision: target.revision === undefined ? null : target.revision,
      rows: Object.freeze(operations.filter(function (op) { return op.op === 'update'; }).map(function (op) {
        return Object.freeze({ targetPosition: op.targetPosition, rev: op.targetRev });
      })),
    });

    var inputs = fingerprintInputs(spec);
    var summary = Object.freeze({
      sourceRows: sourceRows.length,
      excludedRows: excluded.size,
      validRows: incoming.length - matchResult.counts.invalid,
      exactMatches: matchResult.counts.exact || 0,
      newRows: matchResult.counts.none || 0,
      ambiguousRows: matchResult.counts.ambiguous || 0,
      invalidRows: (matchResult.counts.invalid || 0) + skipped.filter(function (item) { return item.reason === 'invalid-cell'; }).length,
      incomingDuplicates: matchResult.incomingDuplicates.length,
      reverseDuplicates: matchResult.reverseDuplicates.length,
      skippedRows: skipped.length,
      creates: createCount,
      updates: updateCount,
      changedCells: changedCells,
      warnings: warnings.length,
      blockingConflicts: blocking.length,
      newColumns: pendingColumns.length,
    });

    return Object.freeze({
      planVersion: PLAN_VERSION,
      planId: hash({ inputs: inputs, at: source.fingerprint, operations: operations.length }),
      fingerprint: hash(inputs),
      createdAt: new Date().toISOString(),
      moduleId: spec.moduleId,
      source: Object.freeze({ fileName: source.fileName || '', sheetName: source.sheetName || '', headerRow: source.headerRow, fingerprint: source.fingerprint || '' }),
      matchFieldIds: Object.freeze(matchFieldIds.slice()),
      options: Object.freeze(Object.assign({}, inputs.options)),
      newColumns: Object.freeze(pendingColumns.map(function (item) { return Object.freeze(Object.assign({}, item)); })),
      operations: Object.freeze(operations),
      skipped: Object.freeze(skipped),
      conflicts: Object.freeze(conflicts),
      blocking: Object.freeze(blocking),
      warnings: Object.freeze(warnings),
      revisionGuard: revisionGuard,
      summary: summary,
      executable: blocking.length === 0 && operations.length > 0,
    });
  }

  function payloadWarnings(coerced, out) {
    coerced.forEach(function (payload, rowId) {
      payload.warnings.forEach(function (warning) { out.push(Object.assign({ sourceRowId: rowId }, warning)); });
      (payload.flags || []).forEach(function (flag) {
        if (flag === 'hidden' || flag === 'total' || flag === 'separator' || flag === 'repeated-header') {
          out.push({ sourceRowId: rowId, code: 'structural-row-included', detail: flag });
        }
      });
    });
  }

  /* ---------------- BAYAT PLAN KORUMASI ---------------- */

  function planFingerprint(spec) { return hash(fingerprintInputs(spec)); }

  /* Uygulama ANINDA yeniden doğrulanır. Kullanıcı önizlemeye bakarken
     CP/Koleksiyon değiştiyse yazma başlamaz. */
  function assertApplicable(plan, current) {
    if (!plan || !plan.executable) return { ok: false, code: 'PLAN_NOT_EXECUTABLE' };
    var state = current || {};
    if (state.fingerprintSpec) {
      var now = planFingerprint(state.fingerprintSpec);
      if (now !== plan.fingerprint) return { ok: false, code: 'STALE_PLAN', expected: plan.fingerprint, actual: now };
    }
    if (plan.revisionGuard.storeRevision !== null && state.revision !== undefined
      && String(state.revision) !== String(plan.revisionGuard.storeRevision)) {
      return { ok: false, code: 'STALE_TARGET', expected: plan.revisionGuard.storeRevision, actual: state.revision };
    }
    if (typeof state.rowRevision === 'function' && Array.isArray(state.rows)) {
      for (var i = 0; i < plan.revisionGuard.rows.length; i += 1) {
        var guard = plan.revisionGuard.rows[i];
        var row = state.rows[guard.targetPosition];
        if (!row) return { ok: false, code: 'STALE_ROW', targetPosition: guard.targetPosition, reason: 'row-missing' };
        var rev = state.rowRevision(row);
        if (String(rev) !== String(guard.rev)) return { ok: false, code: 'STALE_ROW', targetPosition: guard.targetPosition, expected: guard.rev, actual: rev };
      }
    }
    return { ok: true };
  }

  return {
    PLAN_VERSION: PLAN_VERSION,
    coerceCell: coerceCell,
    dateFromSerial: dateFromSerial,
    parseDateValue: parseDateValue,
    parseNumberValue: parseNumberValue,
    parseBooleanValue: parseBooleanValue,
    sameValue: sameValue,
    buildImportPlan: buildImportPlan,
    planFingerprint: planFingerprint,
    fingerprintInputs: fingerprintInputs,
    assertApplicable: assertApplicable,
    hash: hash,
    stableStringify: stableStringify,
  };
}));
