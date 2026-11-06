/* LCW AI proposes configuration; the existing import engine owns every value
   and match decision. No provider, persistence or executable AI code here. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BLExcelImportAI = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  function snapshot(spec) {
    return root.BLExcelImportPlan.hash({
      moduleId: spec.moduleId, source: spec.source, mapping: spec.mapping,
      matchRule: spec.matchRule, options: spec.options, decisions: spec.decisions,
      fields: spec.fields, revision: spec.target.revision,
      revisions: spec.target.rows.map(function (row) { return spec.target.rowRevision ? spec.target.rowRevision(row) : null; }),
    });
  }
  function draftOf(spec) {
    var assignments = {};
    Object.keys(spec.mapping.assignments).forEach(function (id) { assignments[id] = Object.assign({}, spec.mapping.assignments[id]); });
    return Object.assign({}, spec, {
      source: Object.assign({}, spec.source, { rows: spec.source.rows.map(function (row) {
        return Object.assign({}, row, { cells: Object.assign({}, row.cells) });
      }) }),
      mapping: Object.assign({}, spec.mapping, { assignments: assignments }),
      matchRule: { fieldIds: spec.matchRule.fieldIds.slice() },
    });
  }
  function short(value, limit) { return String(value == null ? '' : value).slice(0, limit || 120); }
  function buildContext(spec) {
    var plan = root.BLExcelImportPlan.buildImportPlan(spec);
    // Deterministic validation covers every selected row. AI sees a bounded,
    // explicitly described sample, including invalid rows where possible.
    var rows = spec.source.rows, columns = spec.source.columns.slice(0, 24);
    var invalidIds = new Set(), invalidCells = 0;
    var fieldById = new Map(spec.fields.map(function (field) { return [field.id, field]; }));
    rows.forEach(function (row) {
      Object.keys(spec.mapping.assignments).forEach(function (columnId) {
        var entry = spec.mapping.assignments[columnId], field = fieldById.get(entry.targetId);
        if (!field || entry.action === 'ignore') return;
        var value = root.BLExcelImportPlan.coerceCell(row.cells[columnId], field);
        if (value.kind === 'invalid' || value.kind === 'unreliable') { invalidIds.add(row.id); invalidCells++; }
      });
    });
    var chosen = new Set(rows.slice(0, 8).map(function (row) { return row.id; }));
    Array.from(invalidIds).slice(0, 8).forEach(function (id) { chosen.add(id); });
    rows.slice(-4).forEach(function (row) { chosen.add(row.id); });
    var sampleRows = rows.filter(function (row) { return chosen.has(row.id); }).slice(0, 20).map(function (row) {
      return { id: row.id, excelRow: row.excelRowNumber || row.excelRow,
        values: columns.map(function (column) { return short(row.cells[column.id] && row.cells[column.id].value, 60); }) };
    });
    var context = {
      moduleId: spec.moduleId, sheetName: short(spec.source.sheetName),
      coverage: { totalRows: rows.length, sampledRows: sampleRows.length, totalColumns: spec.source.columns.length, sampledColumns: columns.length, complete: false },
      localSummary: Object.assign({}, plan.summary, { invalidRows: invalidIds.size, invalidCells: invalidCells }),
      blocking: plan.blocking.slice(0, 10).map(function (item) { return { code: item.code, excelRow: item.excelRow, fieldId: item.fieldId }; }),
      operations: ['map: {columnId,targetId,action:match|update|ignore}', 'match: {fieldIds:[canonical field ids]}', 'normalize: {columnId}'],
      fields: spec.fields.slice(0, 80).map(function (field) { return { id: field.id, label: short(field.label, 50), dataType: field.dataType, currency: field.currency || '', identity: !!field.identity, writable: field.writable !== false }; }),
      columns: columns.map(function (column) { var entry = spec.mapping.assignments[column.id] || {}; return { id: column.id, header: short(column.header, 60), targetId: entry.targetId, action: entry.action }; }),
      matchFieldIds: spec.matchRule.fieldIds.slice(), sampleRows: sampleRows,
    };
    // Remain below the central prompt's 20k context budget, even with long
    // dynamic column labels/IDs. Never present a truncated sample as a full scan.
    while (JSON.stringify(context).length > 14000 && context.sampleRows.length) context.sampleRows.pop();
    while (JSON.stringify(context).length > 14000 && context.fields.length) context.fields.pop();
    while (JSON.stringify(context).length > 14000 && context.columns.length) context.columns.pop();
    context.coverage.sampledRows = context.sampleRows.length;
    context.coverage.sampledColumns = context.columns.length;
    context.sampleRows.forEach(function (row) { row.values = row.values.slice(0, context.columns.length); });
    return context;
  }
  function prepare(spec, result) {
    var Plan = root.BLExcelImportPlan, Mapping = root.BLExcelImportMapping;
    var issues = [], fixes = [], changes = [], draft = draftOf(spec), operations;
    if (!result || !result.data || !result.structured || !result.structured.ok) return { ok: false, issues: ['invalid-response'] };
    try { operations = JSON.parse(result.data.operationsJson); } catch (_) { return { ok: false, issues: ['invalid-operations'] }; }
    if (!Array.isArray(operations) || operations.length > 80) return { ok: false, issues: ['invalid-operations'] };
    var fields = new Map(spec.fields.map(function (field) { return [field.id, field]; }));
    var columns = new Map(spec.source.columns.map(function (column) { return [column.id, column]; }));
    var touched = new Set(), normalizations = new Set(), matchOperation = false, explicitMatchIds = null;
    operations.forEach(function (op) {
      if (!op || typeof op !== 'object') { issues.push('invalid-operation'); return; }
      if (op.op === 'map') {
        var field = fields.get(op.targetId);
        if (!columns.has(op.columnId) || touched.has(op.columnId) || ['match', 'update', 'ignore'].indexOf(op.action) < 0
          || (op.action !== 'ignore' && !field) || (op.action === 'update' && (field.writable === false || field.identity))) {
          issues.push('invalid-mapping'); return;
        }
        touched.add(op.columnId);
        var entry = { targetId: op.action === 'ignore' ? '__ignore__' : op.targetId, reviewed: true, needsReview: false, confidence: 'user' };
        if (spec.moduleId === 'collection') entry.action = op.action;
        draft.mapping.assignments[op.columnId] = entry;
        draft.matchRule.fieldIds = draft.matchRule.fieldIds.filter(function (id) { return id !== (spec.mapping.assignments[op.columnId] || {}).targetId; });
        if (op.action === 'match' && draft.matchRule.fieldIds.indexOf(op.targetId) < 0) draft.matchRule.fieldIds.push(op.targetId);
        changes.push({ columnId: op.columnId, header: columns.get(op.columnId).header, targetId: entry.targetId, label: field ? field.label : '', action: op.action });
      } else if (op.op === 'match') {
        if (matchOperation || !Array.isArray(op.fieldIds) || !op.fieldIds.length || op.fieldIds.some(function (id) { return !fields.has(id); }) || new Set(op.fieldIds).size !== op.fieldIds.length) issues.push('invalid-match-rule');
        else { matchOperation = true; explicitMatchIds = op.fieldIds.slice(); }
      } else if (op.op === 'normalize' && columns.has(op.columnId)) normalizations.add(op.columnId);
      else issues.push('unsupported-operation');
    });
    if (explicitMatchIds) draft.matchRule.fieldIds = explicitMatchIds;
    if (spec.moduleId === 'collection' && explicitMatchIds) {
      Object.keys(draft.mapping.assignments).forEach(function (id) {
        var entry = draft.mapping.assignments[id];
        var selected = explicitMatchIds.indexOf(entry.targetId) >= 0;
        if (selected && entry.action !== 'match') {
          draft.mapping.assignments[id] = Object.assign({}, entry, { action: 'match' });
          changes.push({ columnId: id, header: columns.get(id).header, targetId: entry.targetId, label: fields.get(entry.targetId).label, action: 'match' });
        } else if (!selected && entry.action === 'match') {
          draft.mapping.assignments[id] = { action: 'ignore', targetId: '__ignore__' };
          changes.push({ columnId: id, header: columns.get(id).header, targetId: '__ignore__', label: '', action: 'ignore' });
        }
      });
    }
    // Validate mapping with the same engine used by the wizard. Existing
    // unfinished configuration may still be reviewed without an AI operation.
    var validation = Mapping.validateMapping({ assignments: draft.mapping.assignments, fields: spec.fields, columns: spec.source.columns, matchFields: draft.matchRule.fieldIds });
    if (operations.length) validation.issues.filter(function (issue) { return issue.severity === 'error'; }).forEach(function (issue) { issues.push(issue.code); });
    normalizations.forEach(function (columnId) {
      var entry = draft.mapping.assignments[columnId] || {}, field = fields.get(entry.targetId);
      if (!field || field.identity || field.writable === false || draft.matchRule.fieldIds.indexOf(field.id) >= 0 || ['code', 'code/id'].indexOf(field.dataType) >= 0 || entry.action === 'ignore') { issues.push('protected-normalization'); return; }
      draft.source.rows.forEach(function (row) {
        var cell = row.cells[columnId];
        if (!cell || cell.formula || cell.error || cell.unreliable || typeof cell.value !== 'string' || !cell.value.trim()) return;
        var clean = cell.value.replace(/\s+/g, ' ').trim();
        // Removing a foreign currency mark would silently change the unit.
        // Only strip a mark when the adapter explicitly declares that unit.
        if (field.dataType === 'currency') {
          var marks = { USD: '(?:USD|\\$)', EUR: '(?:EUR|€)', GBP: '(?:GBP|£)', TRY: '(?:TRY|TL|₺)' };
          var mark = marks[field.currency];
          if (mark) clean = clean.replace(new RegExp('^' + mark + '\\s*|\\s*' + mark + '$', 'i'), '').trim();
        }
        var coerced = Plan.coerceCell({ value: clean }, field);
        if (coerced.kind !== 'value' || coerced.warnings.length || Plan.coerceCell(cell, field).kind === 'value' && clean === cell.value) return;
        var value = coerced.value;
        if (value === cell.value) return;
        fixes.push({ sourceRowId: row.id, excelRow: row.excelRowNumber || row.excelRow, columnId: columnId, header: columns.get(columnId).header, before: cell.value, after: value });
        row.cells[columnId] = Object.assign({}, cell, { value: value, text: String(value) });
      });
    });
    changes = Array.from(new Map(changes.map(function (item) { return [item.columnId, item]; })).values());
    return { ok: !issues.length, issues: issues, snapshot: snapshot(spec), draft: draft, fixes: fixes, changes: changes,
      matchFieldIds: draft.matchRule.fieldIds, plan: Plan.buildImportPlan(draft), explanation: short(result.data.explanation, 2000), warnings: (result.data.warnings || []).map(function (value) { return short(value, 500); }) };
  }
  function apply(spec, prepared) {
    if (!prepared.ok || snapshot(spec) !== prepared.snapshot) throw new Error('STALE_AI_SUGGESTION');
    return prepared.draft;
  }
  return { snapshot: snapshot, buildContext: buildContext, prepare: prepare, apply: apply };
}));
