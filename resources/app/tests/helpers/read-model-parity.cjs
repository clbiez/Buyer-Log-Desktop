'use strict';

/*
 * ERP okuma modeli parite kapısı (#1071 / WS0 #1072).
 *
 * Aynı satır kümesi ve bağlam üzerinde iki hesaplamayı (ör. tarayıcıdaki mevcut
 * fonksiyon = "legacy" ve yeni arka uç modülü = "candidate") çalıştırır, sonucu
 * kanonik JSON'a çevirip SHA-256 ile karşılaştırır. Farkta ilk ayrışan yolu
 * (ör. `$.rows[12].priority`) raporlar.
 *
 * Kanonik biçim (iki taraf için aynı):
 *   - Nesne anahtarları kod birimi sırasına göre sıralanır; değeri undefined olan
 *     anahtar yazılmaz (JSON.stringify ile aynı).
 *   - Dizi sırası korunur; dizideki undefined / fonksiyon → null.
 *   - Date → ISO-8601 UTC (`toISOString`); geçersiz Date → {"$date":"Invalid"}.
 *   - Sayı: -0 → 0; NaN/±Infinity → {"$num":"NaN"|"Infinity"|"-Infinity"};
 *     `decimals` verilirse sonlu sayılar o basamağa yuvarlanır (varsayılan: tam eşitlik).
 *   - BigInt → {"$bigint":"…"}; Map → {"$map":[[k,v],…]} (anahtarın kanonik
 *     metnine göre sıralı); Set → {"$set":[…]} (sıralı).
 *   - Fonksiyon / Symbol değeri veya döngüsel referans hata verir: parite yalnız
 *     serileştirilebilir veri üzerinde yapılır.
 *
 * Fixture: `generate-demo-data.js` üretimiyle aynı katalog; sabit tohum ve sabit
 * "bugün" ile deterministik, varsayılan 2k satır (test için hızlı).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_TODAY = '2026-01-15';

function numberToken(value, decimals) {
  if (Number.isNaN(value)) return { $num: 'NaN' };
  if (value === Infinity) return { $num: 'Infinity' };
  if (value === -Infinity) return { $num: '-Infinity' };
  let out = value;
  if (Number.isInteger(decimals) && decimals >= 0) {
    const factor = 10 ** decimals;
    out = Math.round(value * factor) / factor;
  }
  return Object.is(out, -0) ? 0 : out;
}

// Değeri yalnız JSON ilkellerinden oluşan, anahtarları sıralı bir ağaca çevirir.
function normalize(value, options = {}, seen = new Set(), at = '$') {
  const decimals = options.decimals;
  if (value === null) return null;
  switch (typeof value) {
    case 'string': case 'boolean': return value;
    case 'number': return numberToken(value, decimals);
    case 'bigint': return { $bigint: value.toString() };
    case 'undefined': return undefined;
    case 'function': case 'symbol':
      throw new TypeError(`read-model-parity: ${at} serileştirilemez (${typeof value})`);
    default: break;
  }
  // vm.createContext ile yüklenen betiklerin Date/Map/Set değerleri başka bir realm'dendir;
  // instanceof yerine realm'den bağımsız etiket kullanılır.
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Date]') return Number.isNaN(Date.prototype.getTime.call(value)) ? { $date: 'Invalid' } : Date.prototype.toISOString.call(value);
  if (seen.has(value)) throw new TypeError(`read-model-parity: ${at} döngüsel referans`);
  seen.add(value);
  try {
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      return Array.from(value, (item, index) => {
        const out = typeof item === 'function' || typeof item === 'symbol' ? null : normalize(item, options, seen, `${at}[${index}]`);
        return out === undefined ? null : out;
      });
    }
    if (tag === '[object Map]') {
      const entries = [...value].map(([key, item], index) => [normalize(key, options, seen, `${at}<key ${index}>`), normalize(item, options, seen, `${at}<${String(key)}>`)]);
      entries.sort((a, b) => compareText(JSON.stringify(a[0]), JSON.stringify(b[0])));
      return { $map: entries.map(([key, item]) => [key, item === undefined ? null : item]) };
    }
    if (tag === '[object Set]') {
      const items = [...value].map((item, index) => normalize(item, options, seen, `${at}{${index}}`)).map(item => (item === undefined ? null : item));
      items.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
      return { $set: items };
    }
    if (typeof value.toJSON === 'function') return normalize(value.toJSON(), options, seen, at);
    const out = {};
    for (const key of Object.keys(value).sort(compareText)) {
      const item = normalize(value[key], options, seen, childPath(at, key));
      if (item !== undefined) out[key] = item;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function childPath(at, key) { return /^[A-Za-z_$][\w$]*$/.test(key) ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`; }

function canonicalJson(value, options = {}) {
  const tree = normalize(value, options);
  return tree === undefined ? 'null' : JSON.stringify(tree);
}

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function canonicalHash(value, options = {}) { return sha256(canonicalJson(value, options)); }

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function preview(value) {
  if (value === undefined) return '<yok>';
  const text = JSON.stringify(value);
  return text.length > 160 ? text.slice(0, 157) + '...' : text;
}

// İki normalize ağacında derinlik öncelikli, anahtar sıralı ilk farkı bulur.
function firstDivergence(left, right, at = '$') {
  const lk = kindOf(left), rk = kindOf(right);
  if (lk !== rk) return { path: at, reason: `tür farklı: ${lk} ≠ ${rk}`, left, right };
  if (lk === 'array') {
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const found = firstDivergence(left[i], right[i], `${at}[${i}]`);
      if (found) return found;
    }
    if (left.length !== right.length) {
      return { path: `${at}[${n}]`, reason: `dizi uzunluğu farklı: ${left.length} ≠ ${right.length}`, left: left[n], right: right[n] };
    }
    return null;
  }
  if (lk === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareText);
    for (const key of keys) {
      const next = childPath(at, key);
      if (!(key in left)) return { path: next, reason: 'legacy tarafında anahtar yok', left: undefined, right: right[key] };
      if (!(key in right)) return { path: next, reason: 'candidate tarafında anahtar yok', left: left[key], right: undefined };
      const found = firstDivergence(left[key], right[key], next);
      if (found) return found;
    }
    return null;
  }
  return Object.is(left, right) ? null : { path: at, reason: 'değer farklı', left, right };
}

function diffCanonical(left, right, options = {}) {
  const a = normalize(left, options), b = normalize(right, options);
  const found = firstDivergence(a === undefined ? null : a, b === undefined ? null : b);
  return found && { ...found, leftPreview: preview(found.left), rightPreview: preview(found.right) };
}

function describe(result) {
  if (result.equal) return `${result.name}: parite OK (sha256 ${result.legacyHash.slice(0, 12)})`;
  const d = result.divergence;
  return `${result.name}: parite FAIL — ilk ayrışan yol ${d.path} (${d.reason}); legacy=${d.leftPreview} candidate=${d.rightPreview}; `
    + `sha256 legacy=${result.legacyHash.slice(0, 12)} candidate=${result.candidateHash.slice(0, 12)}`;
}

/*
 * compareParity({ name, rows, context, legacy, candidate, decimals })
 *   legacy / candidate: (rows, context) => sonuç | Promise<sonuç>.
 * Her iki tarafa ayrı derin kopya verilir; biri girdiyi değiştirirse diğeri etkilenmez.
 */
async function compareParity({ name = 'parity', rows = [], context = {}, legacy, candidate, decimals } = {}) {
  if (typeof legacy !== 'function' || typeof candidate !== 'function') throw new TypeError('read-model-parity: legacy ve candidate fonksiyon olmalı');
  const options = { decimals };
  const inputHash = canonicalHash({ rows, context });
  const legacyOut = await legacy(structuredClone(rows), structuredClone(context));
  const candidateOut = await candidate(structuredClone(rows), structuredClone(context));
  if (canonicalHash({ rows, context }) !== inputHash) throw new Error(`${name}: girdi hesaplama sırasında değişti`);
  const legacyJson = canonicalJson(legacyOut, options), candidateJson = canonicalJson(candidateOut, options);
  const result = {
    name, equal: legacyJson === candidateJson, inputHash,
    legacyHash: sha256(legacyJson), candidateHash: sha256(candidateJson),
    legacyBytes: Buffer.byteLength(legacyJson), candidateBytes: Buffer.byteLength(candidateJson),
    divergence: null,
  };
  if (!result.equal) result.divergence = diffCanonical(legacyOut, candidateOut, options);
  result.message = describe(result);
  return result;
}

async function assertParity(spec) {
  const result = await compareParity(spec);
  if (!result.equal) {
    const error = new Error(result.message);
    error.name = 'ReadModelParityError';
    error.parity = result;
    throw error;
  }
  return result;
}

/*
 * Deterministik sentetik satırlar. `generate-demo-data.js` build() çıktısını sabit
 * "bugün" ile kullanır ve ASAS/Antrepo/LFL satırlarını başlık→değer nesnelerine
 * çevirir. Başlıklar kaynak rapor sütunlarıdır (uygulama alan eşlemesi değil);
 * tüketici kendi canonical alan bağlamasını uygular.
 */
const fixtureCache = new Map();
function makeFixture({ rows = 2000, seed = 7, today = DEFAULT_TODAY } = {}) {
  const key = `${rows}|${seed}|${today}`;
  if (!fixtureCache.has(key)) {
    const { build } = require(path.join(APP_ROOT, 'scripts', 'generate-demo-data.js'));
    const data = build({ rows, seed, today: new Date(`${today}T00:00:00Z`) });
    const objects = (aoa, headerIndex) => {
      const header = aoa[headerIndex];
      return aoa.slice(headerIndex + 1).map(line => Object.fromEntries(header.map((column, index) => [column, line[index] === undefined ? '' : line[index]])));
    };
    const fixture = { rows, seed, today, asas: objects(data.asas, 2), antrepo: objects(data.antrepo, 0), lfl: objects(data.lfl, 1) };
    fixture.hash = canonicalHash(fixture);
    fixtureCache.set(key, Object.freeze(fixture));
  }
  return structuredClone(fixtureCache.get(key));
}

/*
 * DOM'suz bir tarayıcı betiğini (public/*.js) yalıtılmış vm bağlamında yükler ve
 * `globalName` ile yayınladığı nesneyi döndürür. `module.exports` sunan betikler
 * için doğrudan require tercih edilmelidir; bu yol yalnız window global'i
 * yayınlayan betikler içindir.
 */
function loadBrowserGlobal(relPath, globalName, { globals = {} } = {}) {
  const file = path.resolve(APP_ROOT, relPath);
  if (!file.startsWith(APP_ROOT + path.sep)) throw new Error('read-model-parity: betik uygulama kökü dışında');
  const sandbox = { console, setTimeout, clearTimeout, queueMicrotask, structuredClone, Intl, ...globals };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (!(globalName in sandbox)) throw new Error(`read-model-parity: ${relPath} ${globalName} yayınlamadı`);
  return sandbox[globalName];
}

module.exports = {
  canonicalJson, canonicalHash, normalize, diffCanonical, firstDivergence,
  compareParity, assertParity, makeFixture, loadBrowserGlobal, DEFAULT_TODAY,
};
