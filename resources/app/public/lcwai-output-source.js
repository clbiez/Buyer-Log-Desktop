/* Canonical source adapter. Geometry belongs exclusively to BLOutputLayout. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./canonical-fields') : root.BLCanonicalFields);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLOutputSource = api;
})(typeof window !== 'undefined' ? window : globalThis, function (C) {
  'use strict';
  const MAX_ROWS = 30000;
  const scalar = value => typeof value === 'number' ? (Number.isFinite(value) ? value : null) : typeof value === 'boolean' ? value : value == null ? null : typeof value === 'string' ? value.slice(0, 32000) : null;
  function build({ module: moduleId, rows, rowId, lang = 'tr', scope = 'selected', readRow = row => row } = {}) {
    if (!['collection', 'cp', 'orders'].includes(moduleId) || !Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw Error('Invalid source scope (1–30000 rows).');
    const fields = C.moduleFields(moduleId), records = {}, available = new Set(), items = [];
    rows.forEach((raw, index) => {
      const row = readRow(raw), values = {}, keys = {}, labels = {};
      for (const id of fields) {
        const value = C.canonicalValue(row, moduleId, id);
        if (value === undefined) continue;
        available.add(id); values[id] = scalar(value); labels[id] = C.label(id, lang);
        const binding = C.bindingFor(moduleId, id);
        keys[id] = C.normalizedValue({ [binding.keys[0]]: values[id] }, moduleId, id);
      }
      const image = `${moduleId === 'collection' ? 'KOL' : moduleId === 'cp' ? 'CP' : 'ORD'}-${index + 1}`;
      const id = String(rowId ? rowId(raw) : raw._id || raw.id || `${moduleId}:${index}`).slice(0, 160);
      records[image] = { id, module: moduleId, values, keys, labels };
      items.push({ image, title: String(values.modelName || values.plmId || values.orderCode || id).slice(0, 60), fields: [] });
    });
    const cardFields = ['plmId', 'colourCode', 'orderQuantity', 'fob', 'targetFob'].filter(id => available.has(id)).slice(0, 4);
    return { records, items, fields: [...available], source: { module: moduleId, scope, count: rows.length, grain: moduleId === 'collection' ? 'model-colour' : 'order-row', capturedAt: new Date().toISOString() },
      data: { title: lang === 'en' ? 'Model catalogue' : 'Model kataloğu', slides: [{ layout: 'gallery', title: lang === 'en' ? 'Models' : 'Modeller', items }], layout: { cardFields, columns: 3, rows: 3, studio: { version: 1, sizing: 'sets', reflow: 'balanced', preset: 'catalog' } } } };
  }
  function normalizeRecords(raw, tokens, lang = 'tr') {
    const out = {};
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
  return { build, normalizeRecords, bindLegacyRecords, columnType, MAX_ROWS };
});
