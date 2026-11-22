'use strict';

/* OAB (Küp) ↔ PASS OAB parity — saf karşılaştırma yardımcısı.
 *
 * İki kaynak bir süre yan yana çalışacak. Bu yardımcı aynı Sezon / MAG /
 * Buyer Grup kapsamındaki PASS OAB snapshot satırlarını ve küp satırlarını
 * model + renk (+ sezon) anahtarında toplar, adet ölçülerini karşılaştırır ve
 * fark raporu üretir. Ağ, dosya veya DOM erişimi yoktur.
 *
 * Kurallar:
 *   - Kod alanları (Renk Kodu, Model Kodu, Sezon, MAG) asla sayıya çevrilmez;
 *     anahtarlar metin olarak karşılaştırılır (büyük harf, TR harf katlaması).
 *   - PASS "Option Adı" model adını kategori önekiyle verir
 *     ("KK.BDY,GARFIELD-1-YD"); önek atılmış ad da anahtar olarak denenir
 *     (model-image-identity-resolver ile aynı kural). Benzerlik eşleşmesi yok.
 *   - Boş adet 0 sayılmaz: bir tarafta değer hiç yoksa o ölçü "yok" kalır ve
 *     fark hesaplanmaz; uydurma sıfır üretilmez. İstisna: bir tarafta 0, diğer
 *     tarafta boş ise (SUMMARIZECOLUMNS başka ölçü dolu olduğu için satırı
 *     tutup bu ölçüyü boş döndürür) fark sayılmaz, `zeroVsBlank` olarak ayrıca
 *     raporlanır.
 *   - Model/renk anahtarı olmayan kapsam içi satırlar eşleştirilemez ama
 *     toplamlardan düşmez (`keylessTotals`); eksik adet gizlenmez.
 *
 * Alan eşlemesi varsayılanları [Hipotez]: PASS "Option Adı" ↔ küp
 * DummyUrun[ModelTanim]. Canlı küp doğrulanmadan kesin sayılmaz; çağıran
 * `passFields` / `cubeFields` ile değiştirebilir.
 */

const cubeReport = require('./oab-cube-report');

const DEFAULT_PASS_FIELDS = Object.freeze({
  season: 'Sezon', // i18n-ignore: PASS OAB başlığı
  mag: 'Merch Alt Grup', // i18n-ignore: PASS OAB başlığı
  buyerGroup: 'Buyer Grup Tanımı', // i18n-ignore: PASS OAB başlığı
  model: 'Option Adı', // i18n-ignore: PASS OAB başlığı
  colour: 'Renk Kodu', // i18n-ignore: PASS OAB başlığı
});
const DEFAULT_CUBE_FIELDS = Object.freeze({ season: 'season', mag: 'mag', buyerGroup: 'buyerGroup', model: 'modelName', colour: 'colourCode' });
const QUANTITY_MEASURES = Object.freeze(cubeReport.MEASURES.filter(item => item.kind === 'quantity' && item.pass).map(item => ({ key: item.key, pass: item.pass })));
const OPTION_PREFIX_RE = /^[^\s,]{1,16},\s*(?=\S)/;
const LIST_LIMIT = 500;

function clean(value) { return String(value == null ? '' : value).trim(); }
function textKey(value) {
  let text = clean(value).toUpperCase();
  [['İ', 'I'], ['Ş', 'S'], ['Ç', 'C'], ['Ö', 'O'], ['Ü', 'U'], ['Ğ', 'G']].forEach(([a, b]) => { text = text.split(a).join(b); });
  return text.replace(/\s+/g, ' ').trim();
}
function modelKey(value) {
  const full = textKey(value);
  return OPTION_PREFIX_RE.test(full) ? full.replace(OPTION_PREFIX_RE, '') : full;
}

/* PASS adet alanı Türkçe gösterimden "2.908" (binlik) gelebilir; OAB
   istemcisindeki toSafeNumber kuralıyla aynı yorum. Diğer biçimler küp
   normalizasyonuyla aynıdır. */
function quantity(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = clean(value);
  if (/^(null|undefined|nan|-)$/i.test(text)) return null;
  if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
  return cubeReport.toNumber(text);
}

function scopeSet(values) {
  const list = (Array.isArray(values) ? values : []).map(textKey).filter(Boolean);
  return list.length ? new Set(list) : null;
}

function inScope(row, fields, scope) {
  return ['season', 'mag', 'buyerGroup'].every(dim => !scope[dim] || scope[dim].has(textKey(row && row[fields[dim]])));
}

function aggregate(rows, fields, measures, side, scope, includeSeason) {
  const groups = new Map();
  const keylessValues = {};
  let inScopeCount = 0, keyless = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || !inScope(row, fields, scope)) continue;
    inScopeCount++;
    const model = modelKey(row[fields.model]);
    const colour = textKey(row[fields.colour]);
    if (!model || !colour) {
      keyless++;
      for (const measure of measures) {
        const value = quantity(row[side === 'pass' ? measure.pass : measure.key]);
        if (value != null) keylessValues[measure.key] = (keylessValues[measure.key] || 0) + value;
      }
      continue;
    }
    const season = includeSeason ? textKey(row[fields.season]) : '';
    const key = [season, model, colour].join('|');
    if (!groups.has(key)) groups.set(key, { key, season, model, colour, rows: 0, values: {} });
    const group = groups.get(key);
    group.rows++;
    for (const measure of measures) {
      const value = quantity(row[side === 'pass' ? measure.pass : measure.key]);
      if (value == null) continue;
      group.values[measure.key] = (group.values[measure.key] || 0) + value;
    }
  }
  return { groups, inScope: inScopeCount, keyless, keylessValues };
}

const round = value => Math.round(value * 1e6) / 1e6;

/* compare({ passRows, cubeRows, scope:{ seasons, mags, buyerGroups }, measures?, tolerance? })
   tolerance: mutlak adet farkı eşiği (varsayılan 0 — adetler birebir beklenir). */
function compare(input = {}) {
  const passFields = { ...DEFAULT_PASS_FIELDS, ...(input.passFields || {}) };
  const cubeFields = { ...DEFAULT_CUBE_FIELDS, ...(input.cubeFields || {}) };
  const wanted = Array.isArray(input.measures) && input.measures.length ? new Set(input.measures.map(clean)) : null;
  const measures = QUANTITY_MEASURES.filter(item => !wanted || wanted.has(item.key));
  const tolerance = Math.max(0, Number(input.tolerance) || 0);
  const includeSeason = input.includeSeasonInKey !== false;
  const raw = input.scope || {};
  const scope = { season: scopeSet(raw.seasons), mag: scopeSet(raw.mags), buyerGroup: scopeSet(raw.buyerGroups) };
  const pass = aggregate(input.passRows, passFields, measures, 'pass', scope, includeSeason);
  const cube = aggregate(input.cubeRows, cubeFields, measures, 'cube', scope, includeSeason);

  const totals = {};
  measures.forEach(item => { totals[item.key] = { pass: 0, cube: 0, diff: 0, passPresent: false, cubePresent: false }; });
  const mismatches = [], passOnly = [], cubeOnly = [];
  let matched = 0, equal = 0, zeroVsBlank = 0;
  const keys = new Set([...pass.groups.keys(), ...cube.groups.keys()]);
  for (const key of [...keys].sort()) {
    const left = pass.groups.get(key), right = cube.groups.get(key);
    for (const item of measures) {
      const total = totals[item.key];
      if (left && left.values[item.key] != null) { total.pass += left.values[item.key]; total.passPresent = true; }
      if (right && right.values[item.key] != null) { total.cube += right.values[item.key]; total.cubePresent = true; }
    }
    if (!left || !right) {
      const entry = left || right;
      (left ? passOnly : cubeOnly).push({ key, season: entry.season, model: entry.model, colour: entry.colour, values: { ...entry.values } });
      continue;
    }
    matched++;
    const diffs = {};
    for (const item of measures) {
      const a = left.values[item.key], b = right.values[item.key];
      if (a == null && b == null) continue;
      if (a == null || b == null) {
        if ((a == null ? b : a) === 0) { zeroVsBlank++; continue; }
        diffs[item.key] = { pass: a == null ? null : a, cube: b == null ? null : b, diff: null };
        continue;
      }
      const diff = round(b - a);
      if (Math.abs(diff) > tolerance) diffs[item.key] = { pass: a, cube: b, diff };
    }
    if (Object.keys(diffs).length) mismatches.push({ key, season: left.season, model: left.model, colour: left.colour, diffs });
    else equal++;
  }
  for (const item of measures) {
    const total = totals[item.key];
    if (pass.keylessValues[item.key] != null) { total.pass += pass.keylessValues[item.key]; total.passPresent = true; }
    if (cube.keylessValues[item.key] != null) { total.cube += cube.keylessValues[item.key]; total.cubePresent = true; }
  }
  Object.values(totals).forEach(total => { total.pass = round(total.pass); total.cube = round(total.cube); total.diff = round(total.cube - total.pass); });
  const keylessTotals = {
    pass: Object.fromEntries(Object.entries(pass.keylessValues).map(([key, value]) => [key, round(value)])),
    cube: Object.fromEntries(Object.entries(cube.keylessValues).map(([key, value]) => [key, round(value)])),
  };
  const cap = list => list.slice(0, LIST_LIMIT);
  return {
    ok: mismatches.length === 0 && passOnly.length === 0 && cubeOnly.length === 0 && pass.keyless === 0 && cube.keyless === 0,
    measures: measures.map(item => item.key),
    tolerance,
    summary: {
      passRows: Array.isArray(input.passRows) ? input.passRows.length : 0,
      cubeRows: Array.isArray(input.cubeRows) ? input.cubeRows.length : 0,
      passInScope: pass.inScope, cubeInScope: cube.inScope,
      passKeyless: pass.keyless, cubeKeyless: cube.keyless,
      passKeys: pass.groups.size, cubeKeys: cube.groups.size,
      matchedKeys: matched, equalKeys: equal, zeroVsBlank,
      mismatchedKeys: mismatches.length, passOnlyKeys: passOnly.length, cubeOnlyKeys: cubeOnly.length,
    },
    totals,
    keylessTotals,
    mismatches: cap(mismatches), passOnly: cap(passOnly), cubeOnly: cap(cubeOnly),
    truncated: mismatches.length > LIST_LIMIT || passOnly.length > LIST_LIMIT || cubeOnly.length > LIST_LIMIT,
  };
}

module.exports = { compare, DEFAULT_PASS_FIELDS, DEFAULT_CUBE_FIELDS, QUANTITY_MEASURES, modelKey, textKey, quantity };
