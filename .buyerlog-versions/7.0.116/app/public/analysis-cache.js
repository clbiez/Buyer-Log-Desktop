(function(root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BLAnalysisCache = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  function normalize(value, seen = new WeakSet()) {
    if (value instanceof Set) return [...value].map(item => normalize(item, seen)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value instanceof Map) return [...value.entries()].map(entry => normalize(entry, seen)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) { const result=value.map(item => normalize(item, seen));seen.delete(value);return result; }
    const result=Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key], seen)]));seen.delete(value);return result;
  }
  function key(value) { return JSON.stringify(normalize(value)); }
  function create(maxEntries = 32) {
    const limit = Math.max(1, Number(maxEntries) || 32), entries = new Map();
    const api = {
      get(cacheKey) {
        if (!entries.has(cacheKey)) return undefined;
        const value = entries.get(cacheKey);
        entries.delete(cacheKey); entries.set(cacheKey, value);
        return value;
      },
      has(cacheKey) { return entries.has(cacheKey); },
      set(cacheKey, value) {
        entries.delete(cacheKey); entries.set(cacheKey, value);
        while (entries.size > limit) entries.delete(entries.keys().next().value);
        return api;
      },
      delete(cacheKey) { return entries.delete(cacheKey); },
      clear() { entries.clear(); },
      get size() { return entries.size; },
    };
    return api;
  }
  return { create, key };
});
