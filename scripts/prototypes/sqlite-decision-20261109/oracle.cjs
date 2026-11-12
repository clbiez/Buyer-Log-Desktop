'use strict';
// Independent plain JS last-write-wins business-value oracle. Never reads an
// engine's records, revisions or persisted snapshots. Shared input only.
const { event, hash } = require('./workload.cjs');
function oracle(size, added) {
  const rows = new Map();
  function apply(e) { rows.set(e.id, { ...(rows.get(e.id) || {}), ...e.patch }); }
  for (let i=0;i<size;i++) apply(event(i,size));
  for (let i=size;i<size+added;i++) apply(event(i,size,'mixed'));
  return hash([...rows.keys()].sort().map(id => [id, Object.fromEntries(
    Object.entries(rows.get(id)).sort(([a],[b])=>a.localeCompare(b)))]));
}
module.exports = { oracle };
