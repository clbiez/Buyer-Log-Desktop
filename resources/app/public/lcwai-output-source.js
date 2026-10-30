/* Canonical source adapter. Geometry belongs exclusively to BLOutputLayout. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./canonical-fields') : root.BLCanonicalFields);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLOutputSource = api;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';
  const MAX_ROWS = 30000;
  const scalar = value => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'boolean' ? value : value == null ? null : typeof value === 'string' ? value.slice(0, 32000) : null;
  /* Table columns: every header of the source table that has no canonical
     binding (e.g. Fabric, Target Price, custom columns) is carried as a
     display-text field "col.<key>". Canonical fields keep precedence; a column
     whose key is a binding's primary key or whose label is a canonical label is
     skipped so the same data never appears twice. */
  const COLUMN_PREFIX = 'col.', MAX_COLUMNS = 300, COLUMN_VALUE = 300, COLUMN_LABEL = 80, COLUMN_BUDGET = 12e6;
  const text = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  const labelKey = value => text(value, COLUMN_LABEL).toLocaleLowerCase('tr-TR');
  const columnKey = value => text(value, COLUMN_VALUE).toLocaleLowerCase('tr-TR');
  const isColumnId = id => typeof id === 'string' && /^col\.[\w.%-]{1,56}$/.test(id);
  function normalizeColumns(list) {
    const out = [], seen = new Set();
    for (const col of Array.isArray(list) ? list : []) {
      const id = col && col.id, label = text(col && col.label, COLUMN_LABEL);
      if (!isColumnId(id) || !label || seen.has(id)) continue;
      seen.add(id); out.push({ id, label });
      if (out.length >= MAX_COLUMNS) break;
    }
    return out;
  }
  function tableColumns(moduleId, columns) {
    const fields = C.moduleFields(moduleId);
    const keys = new Set(fields.map(id => C.bindingFor(moduleId, id).keys[0]));
    const labels = new Set(fields.flatMap(id => [labelKey(C.label(id, 'tr')), labelKey(C.label(id, 'en'))]));
    const out = [], seen = new Set();
    for (const col of Array.isArray(columns) ? columns : []) {
      if (!col || col.key == null || typeof col.readValue !== 'function') continue;
      const id = COLUMN_PREFIX + String(col.key).replace(/[^\w.%-]/g, '_').slice(0, 56), label = text(col.label || col.key, COLUMN_LABEL);
      if (keys.has(col.key) || labels.has(labelKey(label)) || seen.has(id) || !label) continue;
      seen.add(id); out.push({ id, label, read: col.readValue });
      if (out.length >= MAX_COLUMNS) break;
    }
    return out;
  }
  function readColumns(moduleId, columns, rows) {
    const list = tableColumns(moduleId, columns).map(col => {
      let size = 0;
      const values = rows.map(raw => { let value = ''; try { value = text(col.read(raw), COLUMN_VALUE); } catch (_) { value = ''; } size += value.length; return value; });
      return { ...col, values, size };
    }).filter(col => col.size);
    // Request-size guard for very large scopes: drop the heaviest columns whole
    // (never part of a column), so every card reads the same set of fields.
    let total = list.reduce((sum, col) => sum + col.size, 0);
    const omitted = [];
    for (const col of [...list].sort((a, b) => b.size - a.size)) {
      if (total <= COLUMN_BUDGET) break;
      total -= col.size; omitted.push(col.label); list.splice(list.indexOf(col), 1);
    }
    return { list, omitted };
  }
  function build({ module: moduleId, rows, rowId, lang = 'tr', scope = 'selected', readRow = row => row, columns = [] } = {}) {
    if (!['collection', 'cp', 'orders'].includes(moduleId) || !Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw Error('Invalid source scope (1–30000 rows).');
    const fields = C.moduleFields(moduleId), records = {}, available = new Set(), items = [];
    const table = readColumns(moduleId, columns, rows);
    rows.forEach((raw, index) => {
      const row = readRow(raw), values = {}, keys = {}, labels = {};
      for (const id of fields) {
        const value = C.canonicalValue(row, moduleId, id);
        if (value === undefined) continue;
        available.add(id); values[id] = scalar(value); labels[id] = C.label(id, lang);
        const binding = C.bindingFor(moduleId, id);
        keys[id] = C.normalizedValue({ [binding.keys[0]]: values[id] }, moduleId, id);
      }
      for (const col of table.list) if (col.values[index]) {
        available.add(col.id); values[col.id] = col.values[index]; labels[col.id] = col.label; keys[col.id] = columnKey(col.values[index]);
      }
      const image = `${moduleId === 'collection' ? 'KOL' : moduleId === 'cp' ? 'CP' : 'ORD'}-${index + 1}`;
      const id = String(rowId ? rowId(raw) : raw._id || raw.id || `${moduleId}:${index}`).slice(0, 160);
      records[image] = { id, module: moduleId, values, keys, labels };
      items.push({ image, title: String(values.modelName || values.plmId || values.orderCode || id).slice(0, 60), fields: [] });
    });
    // Collection default matches the editor's stated default: colour code, fit, quantity, target price.
    const preferred = moduleId === 'collection' ? ['colourCode', 'col.fit', 'collectionQuantity', 'col.targetPrice'].filter(id => available.has(id)) : [];
    const cardFields = preferred.length ? preferred : ['plmId', 'colourCode', 'orderQuantity', 'fob', 'targetFob'].filter(id => available.has(id)).slice(0, 4);
    return { records, items, fields: [...available], source: { module: moduleId, scope, count: rows.length, grain: moduleId === 'collection' ? 'model-colour' : 'order-row', capturedAt: new Date().toISOString(),
      columns: table.list.map(({ id, label }) => ({ id, label })), ...(table.omitted.length ? { omittedColumns: table.omitted } : {}) },
      data: { title: lang === 'en' ? 'Model catalogue' : 'Model kataloğu', slides: [{ layout: 'gallery', title: lang === 'en' ? 'Models' : 'Modeller', items }], layout: { cardFields, columns: 3, rows: 3, studio: { version: 1, sizing: 'sets', reflow: 'balanced', preset: 'catalog' } } } };
  }
  function normalizeRecords(raw, tokens, lang = 'tr', columns = []) {
    const out = {}, table = normalizeColumns(columns);
    for (const token of tokens) {
      const entry = raw && raw[token];
      if (!entry || !['collection', 'cp', 'orders'].includes(entry.module)) continue;
      const values = {}, keys = {}, labels = {};
      for (const id of C.moduleFields(entry.module)) if (entry.values && Object.prototype.hasOwnProperty.call(entry.values, id)) {
        values[id] = scalar(entry.values[id]); labels[id] = C.label(id, lang);
        // Group identity is independent of the active UI language.
        const binding = C.bindingFor(entry.module, id);
        keys[id] = C.normalizedValue({ [binding.keys[0]]: values[id] }, entry.module, id);
      }
      // Column labels are on every record (Excel headers read the first card); values stay sparse.
      for (const col of table) {
        labels[col.id] = col.label;
        const value = entry.values && Object.prototype.hasOwnProperty.call(entry.values, col.id) ? text(entry.values[col.id], COLUMN_VALUE) : '';
        if (value) { values[col.id] = value; keys[col.id] = columnKey(value); }
      }
      out[token] = { id: String(entry.id || token).slice(0, 160), module: entry.module, values, keys, labels };
    }
    return out;
  }
  function bindLegacyRecords(raw, lang = 'tr') {
    return Object.fromEntries(Object.entries(raw || {}).map(([token, pairs]) => {
      if (!Array.isArray(pairs)) return [token, pairs];
      const moduleId = token.startsWith('KOL-') ? 'collection' : token.startsWith('ORD-') ? 'orders' : token.startsWith('CP-') ? 'cp' : null;
      if (!moduleId) return [token, pairs];
      const values = {}, labels = {}, keys = {}, aliases = {};
      for (const [label, value] of pairs) {
        const id = C.canonicalId(moduleId, label) || label;
        // Retain unregistered fields from old templates without guessing a new binding.
        if (!(id in values)) values[id] = value;
        labels[id] = C.field(id) ? C.label(id, lang) : label;
        aliases[label] = id;
        if (C.field(id)) {
          const def = C.field(id), binding = C.bindingFor(moduleId, id);
          for (const name of [id, def.label.tr, def.label.en, ...(def.aliases || [])]) aliases[name] = id;
          keys[id] = C.normalizedValue({ [binding.keys[0]]: value }, moduleId, id);
        }
      }
      return [token, { values, labels, keys, aliases, module: moduleId }];
    }));
  }
  const columnType = id => { const def = Object.prototype.hasOwnProperty.call(C.fields, id) && C.field(id); return def && ['number', 'date'].includes(def.type) ? def.type : 'text'; };
  return { build, normalizeRecords, normalizeColumns, bindLegacyRecords, columnType, MAX_ROWS };
});
