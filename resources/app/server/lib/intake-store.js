'use strict';

/* INTAKE DATA CACHE.
 * Kullanıcı görünümü user-preferences içinde tutulur; bu depo yalnız sorgu
 * sonucu ve son başarılı kullanıcı snapshot'ını saklar. Cache anahtarı query
 * kimliğidir, display label/width gibi görsel ayarlar içermez.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { SERVER_DATA_ROOT, atomicWriteBuffer } = require('../user-data');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  const seen = new WeakSet();
  const normalize = input => {
    if (!input || typeof input !== 'object') return input;
    if (seen.has(input)) return '[Circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}
function safeId(value, fallback = 'anonymous') { return clean(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100) || fallback; }
function digest(value) { return crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex'); }

function createIntakeStore(options = {}) {
  const root = path.resolve(options.root || path.join(SERVER_DATA_ROOT, 'intake-cache'));
  const cacheDir = path.join(root, 'queries');
  const snapshotDir = path.join(root, 'snapshots');
  const ttlMinutes = Math.max(1, Math.min(24 * 60, Math.round(Number(options.ttlMinutes) || 30)));

  function queryKey(query) {
    const source = query && typeof query === 'object' ? query : {};
    return digest({
      connection: source.connection || {},
      rows: source.rows || [],
      columns: source.columns || [],
      measures: source.measures || [],
      filters: source.filters || {},
      /* v7.81 — Data Management ufku anahtarın PARÇASI. Beyaz liste olduğu
         için eklenmezse ufuk sessizce hash dışında kalır: kullanıcı filtreyi
         değiştirir, önbellekten filtresiz eski satırlar döner ve filtre
         "yansımıyor" görünürdü — düzeltilen hatanın ta kendisi. */
      horizon: source.horizon || null,
      // Sorgu seçenekleri (ör. sıfır bütçe gizleme) de sonucu değiştirir.
      options: source.options || null,
    });
  }
  function cachePath(key) { return path.join(cacheDir, `${safeId(key, 'query')}.json.gz`); }
  function snapshotPath(userId) { return path.join(snapshotDir, `${safeId(userId)}.json.gz`); }
  function write(file, value) {
    const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(value), 'utf8'), { level: 6 });
    atomicWriteBuffer(file, buffer);
  }
  function read(file) {
    for (const candidate of [file, `${file}.bak`]) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(candidate)).toString('utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}
    }
    return null;
  }
  function get(key, now = Date.now()) {
    const parsed = read(cachePath(key));
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.fetchedAt) return null;
    const ageMs = Math.max(0, Number(now) - (Date.parse(parsed.fetchedAt) || 0));
    return { ...parsed, fresh: ageMs <= ttlMinutes * 60000, ageMs, ttlMinutes };
  }
  function set(key, entry) {
    const record = {
      schemaVersion: 1,
      queryKey: clean(key),
      rows: Array.isArray(entry && entry.rows) ? entry.rows : [],
      fields: Array.isArray(entry && entry.fields) ? entry.fields : [],
      viewConfig: entry && entry.viewConfig ? clone(entry.viewConfig) : null,
      fetchedAt: clean(entry && entry.fetchedAt) || new Date().toISOString(),
    };
    fs.mkdirSync(cacheDir, { recursive: true });
    write(cachePath(key), record);
    return clone(record);
  }
  function saveSnapshot(userId, entry) {
    const record = {
      schemaVersion: 1,
      queryKey: clean(entry && entry.queryKey),
      rows: Array.isArray(entry && entry.rows) ? entry.rows : [],
      fields: Array.isArray(entry && entry.fields) ? entry.fields : [],
      viewConfig: entry && entry.viewConfig ? clone(entry.viewConfig) : null,
      fetchedAt: clean(entry && entry.fetchedAt) || new Date().toISOString(),
      savedAt: new Date().toISOString(),
    };
    fs.mkdirSync(snapshotDir, { recursive: true });
    write(snapshotPath(userId), record);
    return clone(record);
  }
  function loadSnapshot(userId) {
    const parsed = read(snapshotPath(userId));
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.rows) || !Array.isArray(parsed.fields)) return null;
    return parsed;
  }
  function clearSnapshot(userId) {
    const file = snapshotPath(userId);
    let cleared = false;
    for (const candidate of [file, `${file}.bak`]) {
      try { if (fs.existsSync(candidate)) { fs.unlinkSync(candidate); cleared = true; } }
      catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    }
    return { cleared };
  }
  return { root, cacheDir, snapshotDir, queryKey, get, set, saveSnapshot, loadSnapshot, clearSnapshot };
}

const defaultStore = createIntakeStore();
module.exports = { createIntakeStore, ...defaultStore, stable, digest };
