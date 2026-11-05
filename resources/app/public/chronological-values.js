/* Chronological display values shared by browser and Node. Never rewrites source data. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLChronologicalValues=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const norm=value=>String(value==null?'':value).trim();
  const turkNorm=value=>norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toUpperCase().replace(/\s+/g,' ');
  // Shared display ordering. Parse complete values only; source values and saved
  // filter identities stay untouched. Summer precedes Winter within each year.
  const MONTH_ALIASES = [
    ['OCAK','OCA','JANUARY','JAN'], ['SUBAT','SUB','FEBRUARY','FEB'],
    ['MART','MAR','MARCH'], ['NISAN','NIS','APRIL','APR'], ['MAYIS','MAY'],
    ['HAZIRAN','HAZ','JUNE','JUN'], ['TEMMUZ','TEM','JULY','JUL'],
    ['AGUSTOS','AGU','AUGUST','AUG'], ['EYLUL','EYL','SEPTEMBER','SEPT','SEP'],
    ['EKIM','EKI','OCTOBER','OCT'], ['KASIM','KAS','NOVEMBER','NOV'],
    ['ARALIK','ARA','DECEMBER','DEC'],
  ];
  function monthParts(value) {
    const raw = turkNorm(value);
    const valid = (year, month) => {
      const y = Number(year), m = Number(month);
      return Number.isInteger(y) && y >= 1900 && y <= 9999 && m >= 1 && m <= 12 ? { year: y, month: m } : null;
    };
    let match = raw.match(/^(\d{4})[-./\s]?(\d{1,2})(?:[-./\s]\d{1,2})?$/);
    if (match) return valid(match[1], match[2]);
    match = raw.match(/^(\d{1,2})[-./\s](\d{4})$/);
    if (match) return valid(match[2], match[1]);
    const number = name => MONTH_ALIASES.findIndex(aliases => aliases.includes(name.replace(/\.$/, ''))) + 1;
    match = raw.match(/^([^\d]+?)[\s,./-]+(\d{4})$/);
    if (match) return valid(match[2], number(match[1]));
    match = raw.match(/^(\d{4})[\s,./-]+([^\d]+)$/);
    return match ? valid(match[1], number(match[2])) : null;
  }
  const CHRONOLOGY_CACHE = new Map();
  function chronologyParts(value) {
    const raw = norm(value);
    if (CHRONOLOGY_CACHE.has(raw)) return CHRONOLOGY_CACHE.get(raw);
    const match = raw.toUpperCase().match(/^(?:([SW])\s*(\d+)|(\d+)\s*([SW]))$/);
    let parts = null;
    if (match) {
      const generation=Number(match[2] || match[3]);
      const year=generation>=1900?generation:2020+generation;
      if(Number.isSafeInteger(year))parts = { kind: 'season', order: year * 2 + ((match[1] || match[4]) === 'W' ? 1 : 0) };
    }
    else if (!/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(raw)) {
      // Full dates retain day precision in the existing date schema/comparators.
      const month = monthParts(raw);
      if (month) parts = { kind: 'month', order: month.year * 12 + month.month };
    }
    if (raw.length <= 160) {
      if (CHRONOLOGY_CACHE.size >= 50000) CHRONOLOGY_CACHE.clear();
      CHRONOLOGY_CACHE.set(raw, parts && Object.freeze(parts));
    }
    return parts;
  }
  function compareChronologicalValues(a, b, direction = 1) {
    const left = chronologyParts(a), right = chronologyParts(b), dir = direction < 0 ? -1 : 1;
    if (left && right) {
      if (left.kind === right.kind) return (left.order - right.order) * dir;
      return (left.kind === 'season' ? -1 : 1) * dir;
    }
    // Unknown/blank values follow recognized periods in either direction. This
    // also gives mixed dynamic columns a transitive, deterministic total order.
    if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
    return norm(a).localeCompare(norm(b), 'tr', { numeric: true, sensitivity: 'base' }) * dir;
  }
  function compareSeasonLists(a, b) {
    const list = value => (Array.isArray(value) ? value : norm(value).split(/[,;|/]+/)).filter(value => norm(value)).slice().sort(compareChronologicalValues);
    const left = list(a), right = list(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const cmp = compareChronologicalValues(left[i], right[i]);
      if (cmp) return cmp;
    }
    return 0;
  }
  function compareChronologicalPaths(left, right) {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const cmp = compareChronologicalValues(left[i], right[i]);
      if (cmp) return cmp;
    }
    return 0;
  }

  return Object.freeze({monthParts,chronologyParts,compareChronologicalValues,compareSeasonLists,compareChronologicalPaths});
});
