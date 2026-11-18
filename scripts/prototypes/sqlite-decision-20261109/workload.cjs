'use strict';

// Synthetic local persistence workload, not a captured production distribution.
const crypto = require('node:crypto');
const DEVICE = 'prototype-device';
const CLOCK = Date.parse('2026-10-01T08:00:00Z');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function event(index, size, prefix = 'seed') {
  const orders = Math.max(20, Math.floor(size / 10));
  const row = Math.floor(index / 10) % orders;
  const at = new Date(CLOCK + index * 1000).toISOString();
  const common = { eventId: `${prefix}-${index}`, at, userId: `buyer-${row % 8}`, origin: 'prototype' };
  if (index % 10 < 3) return { ...common, id: `order:${row}`, patch: {
    kind: 'order', orderKey: `PO-${row}`, owner: `buyer-${row % 8}`,
    season: ['SS27', 'AW27'][row % 2], model: `MODEL-${row % 1200}`, quantity: 400 + row % 3600,
    price: 3.25 + (index % 150) / 10, currency: 'USD', state: ['open', 'approved', 'rejected'][index % 3],
    note: 'Synthetic local order; no customer information. '.repeat(3),
  } };
  if (index % 10 < 9) return { ...common, id: `answer:${row}:${index % 6}`, patch: {
    kind: 'answer', orderKey: `PO-${row}`, owner: `buyer-${row % 8}`, itemId: `check-${index % 6}`,
    state: ['open', 'approved', 'rejected'][index % 3], reportNumber: `SYN-${index}`,
    note: 'Synthetic checklist evidence: sample colour, measurement and packaging reviewed. '.repeat(5),
    attachments: [{ id: hash(index).slice(0, 32), filename: `synthetic-report-${row}.pdf`,
      bytes: 48000 + index % 1000, mimeType: 'application/pdf' }],
    at,
  } };
  return { ...common, id: `settings:${row % 8}`, patch: {
    kind: 'settings', owner: `buyer-${row % 8}`, state: 'open', columns: ['model', 'price', 'quantity'],
    filters: { season: 'SS27', supplier: `synthetic-${row % 40}` },
  } };
}

function query(index, size) {
  return { kind: index % 2 ? 'order' : 'answer', state: ['open', 'approved', 'rejected'][index % 3],
    owner: `buyer-${index % 8}`, limit: 50 };
}

// Ignore engine metadata; compare persisted business values in stable ID order.
function projection(records) {
  return Object.keys(records).sort().map(id => [id, Object.fromEntries(
    Object.entries(records[id]).filter(([key]) => !key.startsWith('_')).sort(([a], [b]) => a.localeCompare(b)),
  )]);
}

module.exports = { DEVICE, CLOCK, clone, hash, event, query, projection };
