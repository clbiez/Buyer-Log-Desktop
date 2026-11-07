'use strict';

// Yalnız tanı prototipi. Runtime import'u ve worker entegrasyonu yoktur.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { normalizeAntrepoMatchConfig } = require('../../server/lib/parse');

function cloneGraph(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const result = value instanceof Date ? new Date(value.getTime())
    : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if ('value' in descriptor) descriptor.value = cloneGraph(descriptor.value, seen);
    Object.defineProperty(result, key, descriptor);
  }
  return result;
}

function createRunCache(parse) {
  const runs = new WeakMap();
  return (kind, run, rule, parserVersion) => {
    if (!run || !Array.isArray(run.rows) || !parserVersion) throw Error('INT-01: run/rows/parser version required');
    const key = JSON.stringify([kind, parserVersion, normalizeAntrepoMatchConfig(rule)]);
    let entries = runs.get(run);
    if (!entries) { entries = new Map(); runs.set(run, entries); }
    if (!entries.has(key)) entries.set(key, parse(kind, run.rows, rule));
    // Taban closure içinde salt okunur kalır; hiçbir tüketiciye referansı verilmez.
    // Object.freeze(Date) setTime'ı engellemez. Her mutable nesne/Date ve gizli
    // metadata hedefe özel kopyalanır. İnce overlay üretim tasarımı DEĞİLDİR.
    return cloneGraph(entries.get(key));
  };
}

function createStrategy(parse) {
  const version = crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../../server/lib/parse'))).digest('hex');
  const cache = createRunCache(parse);
  return (kind, run, rule) => cache(kind, run, rule, version);
}

module.exports = { createRunCache, createStrategy };
