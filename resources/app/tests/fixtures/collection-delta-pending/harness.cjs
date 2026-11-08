'use strict';
const delta = require('../../../public/collection-delta-commands.js');
const group = require('../../../public/collection-group-delta.js');
const groups = require('../../../public/collection-model-groups.js');
const journal = () => require('../../../public/collection-delta-pending-journal.js');
function memoryStorage() {
  const map = new Map();
  return { map, writes: [], fail: null,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { if (this.fail?.(key, value)) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); this.writes.push({ key, bytes: Buffer.byteLength(value) }); map.set(key, value); },
    removeItem(key) { map.delete(key); },
  };
}
function fixture(options = {}) {
  const storage = options.storage || memoryStorage();
  const live = { ownerId: 'synthetic-owner', clientGeneration: 7, sourceId: 'accepted-4', view: 'single', canEdit: true };
  const api = options.group ? group.createGroupCommandApi(groups) : delta;
  const rows = options.group
    ? [1, 2, 3].map(id => ({ id, _rev: 4, cx_text: 'old', modelGroupId: 'g', modelGroupRole: id === 1 ? 'parent' : 'variant', variantId: 'v' + id, modelSharedValues: id === 1 ? { cx_text: 'old' } : {}, variantOverrides: id === 3 ? { cx_text: false } : {} }))
    : [1, 2, 3].map(id => ({ id, _rev: 4, quantity: '10', cx_text: 'old', unknown: { keep: false } }));
  const config = { storage, api, getCurrent: () => ({ ...live }), keyPrefix: 'bl.collection.pending-journal.candidate.test.', legacyKey: 'legacy.pending.owner', limits: options.limits };
  const adapter = journal().createPendingJournal(config);
  const spec = { bindingId: 'binding-1', rows, customColumns: [{ k: 'cx_text', custom: true, dataType: 'text' }], workspaceRevision: 4, nextId: 4, baseStructure: JSON.stringify({ columns: [], manufacturers: [], statusCatalog: [], order: ['1','2','3'] }), metadata: { manufacturers: [], statusCatalog: [], lflCountryExclusions: [], extension: { keep: true } } };
  if (options.bind !== false) adapter.bindAccepted(spec);
  return { storage, live, api, adapter, spec, reopen() { const next = journal().createPendingJournal(config); next.open(); return next; } };
}
function edit(f, id = 'edit', rowId = 1, value = '20') {
  return f.api.prepareFieldCommand(f.adapter.getState(), { kind: delta.UNIT, operationId: id, rowId, writes: [{ key: 'quantity', after: { present: true, value } }] });
}
function receipt(delivery) { return { ok: true, revision: 12, applied: delivery.request.payload.upserts.map(row => ({ id: String(row.id), kind: 'changed', rev: (row._rev || 0) + 1 })), conflicts: [] }; }
module.exports = { delta, journal, memoryStorage, fixture, edit, receipt };
