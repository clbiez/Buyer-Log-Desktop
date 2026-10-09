'use strict';
const { compare } = require('./hlc');
const META = '_listOrders';
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function hasClock(order) { return order && order.hlc; }
function ordered(a, b) { return hasClock(a) && hasClock(b) ? compare(a.hlc, b.hlc) : null; }
function validateListClocks(clocks) {
  if (clocks == null) return;
  if (typeof clocks !== 'object' || Array.isArray(clocks)) throw new TypeError('Invalid email list clocks');
  for (const [field, entries] of Object.entries(clocks)) {
    if (!['records', 'deletedRecords'].includes(field) || !entries || typeof entries !== 'object' || Array.isArray(entries)) throw new TypeError('Invalid email list clock map');
    for (const order of Object.values(entries)) {
      if (!order || typeof order !== 'object' || !order.hlc) throw new TypeError('Invalid email item clock');
      compare(order.hlc, order.hlc);
    }
  }
}
function mergeListClocks(a, b) {
  validateListClocks(a); validateListClocks(b);
  const result = {};
  for (const field of ['records', 'deletedRecords']) {
    if (!(a && a[field]) && !(b && b[field])) continue;
    const map = Object.assign(Object.create(null), a && a[field] || {});
    for (const [id, order] of Object.entries(b && b[field] || {})) {
      const relative = Object.hasOwn(map, id) ? ordered(order, map[id]) : 1;
      if (relative > 0 || relative === 0 && JSON.stringify(order) >= JSON.stringify(map[id])) map[id] = copy(order);
    }
    result[field] = map;
  }
  return result;
}

function prepareEmailPatch(base = {}, patch = {}, order) {
  const orders = copy(base[META] || {});
  if (Array.isArray(patch.records)) {
    const existing = new Map((base.records || []).map(row => [String(row.id || ''), row]));
    orders.records = Object.assign(Object.create(null), orders.records || {});
    for (const row of patch.records) if (row && row.id && !same(existing.get(String(row.id)), row)) orders.records[String(row.id)] = copy(order);
  }
  if (patch.deletedRecords && typeof patch.deletedRecords === 'object') {
    orders.deletedRecords = Object.assign(Object.create(null), orders.deletedRecords || {});
    for (const [id, value] of Object.entries(patch.deletedRecords)) if (!same((base.deletedRecords || {})[id], value)) orders.deletedRecords[id] = copy(order);
  }
  return { ...patch, [META]: orders };
}

function mergeEmailLists(base = {}, patch = {}) {
  const localOrders = base[META] || {}, incomingOrders = patch[META] || {};
  const result = {}, orders = copy(localOrders);
  const tombstones = Object.assign(Object.create(null), base.deletedRecords || {});
  const tombOrders = Object.assign(Object.create(null), localOrders.deletedRecords || {});
  for (const [id, at] of Object.entries(patch.deletedRecords || {})) {
    const relative = ordered(incomingOrders.deletedRecords && incomingOrders.deletedRecords[id], tombOrders[id]);
    if (!Object.hasOwn(tombstones, id) || (relative === null ? String(at) > String(tombstones[id]) : relative > 0 || relative === 0 && String(at) > String(tombstones[id]))) {
      tombstones[id] = at;
      if (incomingOrders.deletedRecords && incomingOrders.deletedRecords[id]) tombOrders[id] = copy(incomingOrders.deletedRecords[id]); else delete tombOrders[id];
    }
  }
  if (Object.hasOwn(patch, 'deletedRecords')) result.deletedRecords = { ...tombstones };
  orders.deletedRecords = tombOrders;
  if (Array.isArray(patch.records)) {
    const rows = new Map(), extras = [], rowOrders = Object.create(null);
    for (const [list, sourceOrders] of [[base.records, localOrders.records || {}], [patch.records, incomingOrders.records || {}]]) {
      for (const row of Array.isArray(list) ? list : []) {
        const id = row && typeof row === 'object' ? String(row.id || '') : '';
        if (!id) { extras.push(row); continue; }
        const previous = rows.get(id), relative = ordered(sourceOrders[id], rowOrders[id]);
        const legacyWins = previous && (String(row.updatedAt || '') > String(previous.updatedAt || '') || (String(row.updatedAt || '') === String(previous.updatedAt || '') && JSON.stringify(row) >= JSON.stringify(previous)));
        if (!previous || (relative === null ? legacyWins : relative > 0 || relative === 0 && JSON.stringify(row) >= JSON.stringify(previous))) {
          rows.set(id, row);
          if (sourceOrders[id]) rowOrders[id] = copy(sourceOrders[id]); else delete rowOrders[id];
        }
      }
    }
    result.records = [...rows].filter(([id, row]) => {
      if (!Object.hasOwn(tombstones, id)) return true;
      const relative = ordered(tombOrders[id], rowOrders[id]);
      return relative === null ? String(tombstones[id]) < String(row.updatedAt || '') : relative < 0;
    }).map(([, row]) => row).concat(extras);
    orders.records = rowOrders;
  } else if (Object.hasOwn(patch, 'deletedRecords') && Array.isArray(base.records)) {
    result.records = base.records.filter(row => {
      const id = String(row && row.id || '');
      if (!Object.hasOwn(tombstones, id)) return true;
      const relative = ordered(tombOrders[id], localOrders.records && localOrders.records[id]);
      return relative === null ? String(tombstones[id]) < String(row.updatedAt || '') : relative < 0;
    });
  }
  result[META] = orders;
  return result;
}
module.exports = { prepareEmailPatch, mergeEmailLists, validateListClocks, mergeListClocks };
