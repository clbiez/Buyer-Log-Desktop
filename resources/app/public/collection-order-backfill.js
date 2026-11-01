(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./canonical-fields') : root.BLCanonicalFields);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLCollectionOrderBackfill = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(fields) {
  'use strict';
  const text = value => String(value ?? '').trim();
  const clone = value => JSON.parse(JSON.stringify(value));
  function number(value) {
    let raw = text(value).replace(/\s/g, '');
    if (!raw) return null;
    if (raw.includes(',') && raw.includes('.')) {
      raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else raw = raw.replace(',', '.');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const normalized = (row, field) => fields.normalizedValue(row, 'collection', field);
  function groupKey(row, fallback) {
    const plm = normalized(row, 'plmId'), model = plm || normalized(row, 'modelName');
    // Collection FOB is a live royalty calculation. Source FOB defines the
    // historical commercial group even when that calculated cell changes.
    const month = text(row.inStoreMonth), price = number(row._sourceOrderDetails?.sourceFob ?? row.fob), quantity = number(row.quantity);
    if (row._collectionBackfillKey && row.confirmedManufacturer && number(row.pricing?.[row.confirmedManufacturer]) !== price) {
      return JSON.stringify(['edited-quote', fallback]);
    }
    // Unknown LCW periods and prices cannot establish a shared commercial row.
    if (!model || !/^\d{6}$/.test(month) || !(price > 0) || quantity == null || quantity < 0) return JSON.stringify(['source', fallback]);
    return JSON.stringify([plm?'plm':'name', model, month, normalized(row, 'season'), price, number(row.targetPrice),
      normalized(row, 'country'), normalized(row, 'manufacturer')]);
  }
  function sourceOrder(key, row) {
    return {key, orderCode:row._sourceOrderCode || '', quantity:row.quantity, opd:row.opd,
      exFactory:row.exFactory, retail:row.retail, inStore:row.inStore, inStoreWeek:row.inStoreWeek,
      colourCode:row.colourCode, colour:row.colour, notes:row.not || '', details:clone(row._sourceOrderDetails || {})};
  }
  function bound(a, b, latest) {
    const dates = [a,b].map(text).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
    return dates.length ? dates[latest ? dates.length - 1 : 0] : '';
  }
  function joined(values) { return [...new Set(values.map(text).filter(Boolean))].join(' · '); }
  function append(row, incoming, key) {
    row.quantity = String((number(row.quantity) || 0) + (number(incoming.quantity) || 0));
    row.opd = bound(row.opd, incoming.opd, false);
    row.exFactory = bound(row.exFactory, incoming.exFactory, true);
    row.retail = bound(row.retail, incoming.retail, true);
    if (incoming.inStore && (!row.inStore || incoming.inStore < row.inStore)) {
      row.inStore = incoming.inStore; row.inStoreWeek = incoming.inStoreWeek;
    }
    row._sourceOrders.push(sourceOrder(key, incoming));
    row.colourCode = joined(row._sourceOrders.map(order => order.colourCode));
    row.colour = joined(row._sourceOrders.map(order => order.colour));
    row.not = joined([row.not, incoming.not]);
    return row;
  }
  function plan(entries, existing = [], existingKeys = []) {
    const seen = new Set(existingKeys.filter(Boolean)), targets = new Map(), changes = new Map();
    existing.forEach(row => {
      (row._sourceOrders || []).forEach(order => { if (order.key) seen.add(order.key); });
      if (row._sourceOrderIdentity) seen.add(row._sourceOrderIdentity);
      // Only rows made by this tool, with unchanged commercial dimensions, can
      // receive new orders. Manual rows and previous one-order imports stay intact.
      if (row._collectionBackfillKey && groupKey(row, row._sourceOrders?.[0]?.key) === row._collectionBackfillKey && !targets.has(row._collectionBackfillKey)) {
        targets.set(row._collectionBackfillKey, {existingId:row.id, row});
      }
    });
    let duplicates = 0;
    entries.forEach((entry, index) => {
      const key = text(entry.key);
      if (key && seen.has(key)) { duplicates++; return; }
      if (key) seen.add(key);
      const identity = groupKey(entry.row, key || `unkeyed-${index}`);
      let change = changes.get(identity);
      if (!change) {
        const target = targets.get(identity);
        if (target) change = {existingId:target.existingId, row:clone(target.row)};
        else {
          const row = clone(entry.row);
          // Independent commercial rows must not inherit another row's price,
          // supplier or dates through automatic colour grouping on persistence.
          row.modelGroupId = 'order-backfill:' + (key || identity); row.modelGroupRole = 'single';
          row._collectionBackfillKey = identity;
          row._sourceOrders = [sourceOrder(key, row)];
          change = {existingId:null, row};
          changes.set(identity, change);
          return;
        }
        changes.set(identity, change);
      }
      append(change.row, entry.row, key);
    });
    return {changes:[...changes.values()], duplicates};
  }
  return {plan, groupKey};
});
