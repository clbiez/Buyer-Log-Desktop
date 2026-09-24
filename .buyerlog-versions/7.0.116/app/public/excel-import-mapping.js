/* ===================================================================
   KULLANICI EXCEL'İ İÇERİ AKTARMA — SÜTUN EŞLEME

   Excel sütunu → Buyer Log alanı eşlemesi. Öneriler kanonik alan
   kayıt defterinden (canonical-fields) ve modülün kendi sütun
   kataloğundan üretilir; YENİ bir alan sözlüğü uydurulmaz.

   ÖNERİ YETKİ DEĞİLDİR. Her öneri bir güven derecesiyle gelir
   (high / medium / low) ve düşük/belirsiz olanlar kullanıcı onayı
   olmadan plana giremez. Geçersiz eşlemeler (aynı hedefe iki kaynak,
   bilinmeyen hedef, kimlik alanı olmadan eşleşme) engellenir.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLExcelImportMapping = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var TR_MAP = { 'ı': 'I', 'İ': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };
  var IGNORE = '__ignore__';
  var NEW_COLUMN = '__new__';

  function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function token(value) {
    return text(value)
      .replace(/[ıİşŞğĞüÜöÖçÇ]/g, function (ch) { return TR_MAP[ch] || ch; })
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function compact(value) { return token(value).replace(/\s+/g, ''); }

  /* Dice katsayısı (bigram). Levenshtein'a göre sözcük sırası
     değişimlerine daha dayanıklı ve kısa başlıklarda daha az yanlış
     pozitif üretiyor. */
  function bigrams(value) {
    var source = compact(value), out = new Map();
    for (var i = 0; i < source.length - 1; i += 1) {
      var gram = source.slice(i, i + 2);
      out.set(gram, (out.get(gram) || 0) + 1);
    }
    return out;
  }
  function similarity(a, b) {
    var left = compact(a), right = compact(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    var gramsA = bigrams(left), gramsB = bigrams(right), shared = 0, sizeA = 0, sizeB = 0;
    gramsA.forEach(function (count) { sizeA += count; });
    gramsB.forEach(function (count, gram) {
      sizeB += count;
      shared += Math.min(count, gramsA.get(gram) || 0);
    });
    if (!sizeA || !sizeB) return 0;
    return (2 * shared) / (sizeA + sizeB);
  }

  /* Hedef alan tanımı (modül adaptöründen gelir):
       { id, label, labelEn, dataType, role:'identity'|'value', aliases:[],
         readOnly, required, canonicalId } */
  function aliasPool(field) {
    var pool = [field.id, field.label, field.labelEn].concat(field.aliases || []);
    var canonical = root && root.BLCanonicalFields;
    if (canonical && field.canonicalId) {
      var definition = canonical.field(field.canonicalId);
      if (definition) {
        pool = pool.concat(definition.aliases || []);
        if (definition.label) pool.push(definition.label.en, definition.label.tr);
      }
    }
    return pool.map(text).filter(Boolean);
  }

  function scoreField(header, field) {
    var pool = aliasPool(field), best = 0, matchedOn = '';
    for (var i = 0; i < pool.length; i += 1) {
      var score = similarity(header, pool[i]);
      if (score > best) { best = score; matchedOn = pool[i]; }
    }
    return { score: best, matchedOn: matchedOn };
  }

  function confidenceOf(score, runnerUp) {
    if (score >= 0.999) return 'high';
    if (score >= 0.86 && (score - runnerUp) >= 0.08) return 'high';
    if (score >= 0.7) return 'medium';
    if (score >= 0.5) return 'low';
    return null;
  }

  /* Bir Excel sütunu için öneri. Aday listesi de döner: kullanıcı
     "neden bu?" sorusunu ekranda cevaplayabilmeli. */
  function suggestForColumn(column, fields) {
    var header = column.rawHeader || column.header;
    // Yazılamayan alanlar da öneri havuzundadır: Order Code / PLM ID gibi
    // kimlik sütunları EŞLEŞTİRME için eşlenmek zorundadır. Yazma tarafında
    // plan bunları zaten değişiklik üretmeden geçirir.
    var scored = fields
      .map(function (field) {
        var result = scoreField(header, field);
        return { targetId: field.id, label: field.label, score: Math.round(result.score * 1000) / 1000, matchedOn: result.matchedOn };
      })
      .sort(function (a, b) { return b.score - a.score; });
    var best = scored[0], second = scored[1];
    if (!best) return { targetId: IGNORE, confidence: null, score: 0, alternatives: [] };
    var confidence = confidenceOf(best.score, second ? second.score : 0);
    return {
      targetId: confidence ? best.targetId : IGNORE,
      confidence: confidence,
      score: best.score,
      matchedOn: best.matchedOn,
      alternatives: scored.slice(0, 4).filter(function (item) { return item.score > 0.25; }),
    };
  }

  function suggestMapping(columns, fields) {
    var list = Array.isArray(columns) ? columns : [];
    var pool = Array.isArray(fields) ? fields : [];
    var assignments = {}, claimed = new Map();
    // İki geçiş: önce yüksek güvenli öneriler hedefi rezerve eder, sonra
    // kalanlar. Aksi hâlde sıradan gelen zayıf bir eşleşme güçlü olanın
    // hedefini kapatırdı.
    var suggestions = list.map(function (column) { return { column: column, suggestion: suggestForColumn(column, pool) }; });
    var order = ['high', 'medium', 'low', null];
    order.forEach(function (level) {
      suggestions.forEach(function (entry) {
        if (assignments[entry.column.id]) return;
        if (entry.suggestion.confidence !== level) return;
        var targetId = entry.suggestion.targetId;
        if (targetId !== IGNORE && claimed.has(targetId)) {
          assignments[entry.column.id] = {
            targetId: IGNORE, confidence: null, score: entry.suggestion.score,
            needsReview: true, reason: 'target-already-suggested',
            alternatives: entry.suggestion.alternatives,
          };
          return;
        }
        if (targetId !== IGNORE) claimed.set(targetId, entry.column.id);
        assignments[entry.column.id] = {
          targetId: targetId,
          confidence: entry.suggestion.confidence,
          score: entry.suggestion.score,
          matchedOn: entry.suggestion.matchedOn,
          // Düşük/orta güvenli öneri KENDİLİĞİNDEN yetkili değildir.
          needsReview: entry.suggestion.confidence !== 'high',
          alternatives: entry.suggestion.alternatives,
        };
      });
    });
    return assignments;
  }

  /* ---------------- DOĞRULAMA ---------------- */

  function validateMapping(spec) {
    var source = spec || {};
    var assignments = source.assignments || {};
    var fields = Array.isArray(source.fields) ? source.fields : [];
    var columns = Array.isArray(source.columns) ? source.columns : [];
    var matchFields = Array.isArray(source.matchFields) ? source.matchFields : [];
    var fieldById = new Map(fields.map(function (field) { return [field.id, field]; }));
    var columnById = new Map(columns.map(function (column) { return [column.id, column]; }));
    var issues = [], byTarget = new Map(), matchByTarget = new Map(), mapped = 0, newColumns = [];
    var validActions = new Set(['ignore', 'create', 'update', 'match']);
    var hasExplicitActions = false;

    Object.keys(assignments).forEach(function (columnId) {
      var entry = assignments[columnId] || {};
      var action = text(entry.action).toLowerCase();
      var explicit = validActions.has(action);
      if (explicit) hasExplicitActions = true;
      var targetId = entry.targetId || IGNORE;
      if (!columnById.has(columnId)) { issues.push({ code: 'unknown-source-column', columnId: columnId, severity: 'error' }); return; }

      // Yeni action-based Collection ekranı. Eski CP/profile kayıtlarında
      // `action` bulunmaz; onlar aşağıdaki legacy targetId davranışını korur.
      if (explicit) {
        if (action === 'ignore') return;
        if (action === 'create') targetId = NEW_COLUMN;
        if ((action === 'update' || action === 'match') && (!targetId || targetId === IGNORE || targetId === NEW_COLUMN)) {
          issues.push({ code: action === 'match' ? 'match-target-required' : 'update-target-required', columnId: columnId, severity: 'error' });
          return;
        }
      } else if (targetId === IGNORE) return;

      if (targetId === NEW_COLUMN) {
        if (explicit && action !== 'create') {
          issues.push({ code: 'new-column-action-mismatch', columnId: columnId, severity: 'error' });
          return;
        }
        var label = text(entry.newColumnLabel);
        if (!label) { issues.push({ code: 'new-column-label-required', columnId: columnId, severity: 'error' }); return; }
        if (fields.some(function (field) { return token(field.label) === token(label) || token(field.id) === token(label); })) {
          issues.push({ code: 'new-column-label-exists', columnId: columnId, label: label, severity: 'error' });
          return;
        }
        if (newColumns.some(function (item) { return token(item.label) === token(label); })) {
          issues.push({ code: 'new-column-label-duplicate', columnId: columnId, label: label, severity: 'error' });
          return;
        }
        newColumns.push({ columnId: columnId, label: label, dataType: entry.newColumnType || 'text' });
        mapped += 1;
        return;
      }

      var field = fieldById.get(targetId);
      if (!field) { issues.push({ code: 'unknown-target-field', columnId: columnId, targetId: targetId, severity: 'error' }); return; }

      if (explicit && action === 'update' && field.writable === false) {
        issues.push({ code: 'target-not-writable', columnId: columnId, targetId: targetId, severity: 'error' });
      } else if (!explicit && field.writable === false && matchFields.indexOf(targetId) < 0) {
        // Legacy mapping: yazılamayan alan yalnız eşleşmede kullanılabilir.
        issues.push({ code: 'target-not-writable', columnId: columnId, targetId: targetId, severity: 'warning' });
      }

      if (!byTarget.has(targetId)) byTarget.set(targetId, []);
      byTarget.get(targetId).push(columnId);
      if (explicit && action === 'match') {
        if (!matchByTarget.has(targetId)) matchByTarget.set(targetId, []);
        matchByTarget.get(targetId).push(columnId);
      }
      mapped += 1;
    });

    byTarget.forEach(function (columnIds, targetId) {
      // Aynı hedefe birden çok kaynak sütun sessiz last-write-wins olamaz.
      // Match + Update dahil olmak üzere ikinci kaynak açık validation alır.
      if (columnIds.length > 1) issues.push({ code: 'duplicate-target-mapping', targetId: targetId, columns: columnIds.slice(), severity: 'error' });
    });

    // Aynı Excel sütununun birden çok anlamsal alana sürüklenmesi de
    // aynı belirsizliktir; açık bir kural olmadan kabul edilmez.
    var perColumnTargets = new Map();
    Object.keys(assignments).forEach(function (columnId) {
      var entry = assignments[columnId] || {};
      var extra = Array.isArray(entry.additionalTargets) ? entry.additionalTargets : [];
      if (extra.length) perColumnTargets.set(columnId, extra);
    });
    perColumnTargets.forEach(function (targets, columnId) {
      issues.push({ code: 'one-source-many-targets', columnId: columnId, targets: targets.slice(), severity: 'error' });
    });

    Object.keys(assignments).forEach(function (columnId) {
      var entry = assignments[columnId] || {};
      var action = text(entry.action).toLowerCase();
      if (!validActions.has(action) && entry.targetId && entry.targetId !== IGNORE && entry.needsReview && !entry.reviewed) {
        issues.push({ code: 'suggestion-needs-review', columnId: columnId, targetId: entry.targetId, confidence: entry.confidence || 'low', severity: 'warning' });
      }
    });

    if (!mapped) issues.push({ code: 'nothing-mapped', severity: 'error' });

    matchFields.forEach(function (fieldId) {
      var used = hasExplicitActions ? matchByTarget.has(fieldId) : byTarget.has(fieldId);
      if (!used) issues.push({ code: 'match-field-not-mapped', targetId: fieldId, severity: 'error' });
    });
    if (hasExplicitActions) {
      matchByTarget.forEach(function (_columnIds, fieldId) {
        if (matchFields.indexOf(fieldId) < 0) issues.push({ code: 'match-action-not-active', targetId: fieldId, severity: 'error' });
      });
    }
    if (matchFields.length === 0) issues.push({ code: 'match-rule-required', severity: 'error' });

    return {
      ok: !issues.some(function (issue) { return issue.severity === 'error'; }),
      issues: issues,
      mappedCount: mapped,
      newColumns: newColumns,
      targets: [...byTarget.keys()],
    };
  }

  /* ---------------- TİP SEZGİSİ (ÖNERİ) ---------------- */

  var TYPES = ['text', 'number', 'date', 'boolean', 'code'];
  var BOOLEAN_WORDS = new Set(['TRUE', 'FALSE', 'EVET', 'HAYIR', 'YES', 'NO', 'X', '1', '0', 'VAR', 'YOK']);

  function inferColumnType(samples, header) {
    var values = (Array.isArray(samples) ? samples : []).filter(function (value) {
      return value !== null && value !== undefined && String(value).trim() !== '';
    });
    if (!values.length) return { dataType: 'text', confidence: 'low' };
    var schema = root && root.BLColumnSchema;
    var dates = 0, numbers = 0, booleans = 0, leadingZero = 0;
    values.forEach(function (value) {
      var raw = String(value).trim();
      if (/^0\d+$/.test(raw)) leadingZero += 1;
      if (BOOLEAN_WORDS.has(token(raw))) booleans += 1;
      if (value instanceof Date) { dates += 1; return; }
      if (schema && schema.parseDate && schema.parseDate(value) !== null) { dates += 1; return; }
      var numeric = schema && schema.parseNumber ? schema.parseNumber(value) : Number(raw.replace(',', '.'));
      if (numeric !== null && Number.isFinite(Number(numeric))) numbers += 1;
    });
    var total = values.length;
    var headerToken = token(header);
    var codeHint = /(KOD|CODE|ID|NO|PLM|SEASON|SEZON|MAG|MMYG|SPECIAL)/.test(headerToken);
    if (leadingZero > 0 || (codeHint && numbers === total)) return { dataType: 'code', confidence: leadingZero ? 'high' : 'medium' };
    if (dates === total && /(TARIH|DATE|OPD|RETAIL|STORE|FACTORY|HANDOVER|ARRIVAL)/.test(headerToken)) return { dataType: 'date', confidence: 'high' };
    if (dates === total && dates > 0) return { dataType: 'date', confidence: 'medium' };
    if (booleans === total) return { dataType: 'boolean', confidence: 'medium' };
    if (numbers === total) return { dataType: 'number', confidence: 'high' };
    return { dataType: 'text', confidence: numbers === 0 && dates === 0 ? 'high' : 'low' };
  }

  return {
    IGNORE: IGNORE,
    NEW_COLUMN: NEW_COLUMN,
    TYPES: TYPES,
    token: token,
    similarity: similarity,
    suggestForColumn: suggestForColumn,
    suggestMapping: suggestMapping,
    validateMapping: validateMapping,
    inferColumnType: inferColumnType,
  };
}));
