'use strict';

function parseSemver(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = raw.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
  if (!match) return null;
  const pre = match[4] ? match[4].split('.') : [];
  return { raw, major:Number(match[1]), minor:Number(match[2]), patch:Number(match[3]), prerelease:pre, build:match[5] || '' };
}

function compareIdentifier(a, b) {
  const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) === Number(b) ? 0 : (Number(a) < Number(b) ? -1 : 1);
  if (an !== bn) return an ? -1 : 1;
  return a === b ? 0 : (a < b ? -1 : 1);
}

function compareSemver(aValue, bValue) {
  const a = parseSemver(aValue), b = parseSemver(bValue);
  if (!a || !b) throw Object.assign(new Error('Geçersiz semantic version.'), { code:'UPDATE_INVALID_SEMVER' });
  for (const key of ['major','minor','patch']) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i=0; i<len; i+=1) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const cmp = compareIdentifier(a.prerelease[i], b.prerelease[i]);
    if (cmp) return cmp;
  }
  return 0;
}

function bumpSemver(value, kind='patch') {
  const parsed = parseSemver(value);
  if (!parsed) throw Object.assign(new Error('Geçersiz semantic version: ' + value), { code:'UPDATE_INVALID_SEMVER' });
  let { major, minor, patch } = parsed;
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else if (kind === 'patch') { patch += 1; }
  else throw Object.assign(new Error('Bilinmeyen version bump türü: ' + kind), { code:'UPDATE_INVALID_BUMP' });
  return `${major}.${minor}.${patch}`;
}

module.exports = { parseSemver, compareSemver, bumpSemver };
