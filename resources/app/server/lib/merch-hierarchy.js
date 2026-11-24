'use strict';

/*
 * Merch hiyerarşisi: Marka Müdürlüğü › MMYG (Merch Marka Yaş Grup) › MAG (Merch Alt Grup).
 *
 * Kaynak elle tutulan bir tablo DEĞİLDİR. Her ASAS ayrıştırması (Data Model veya
 * Excel) satırlardaki kod/ad/müdürlük üçlüsünü gözlemler; yenileme yayınlanırken
 * yeni gözlem bir önceki hiyerarşiyle birleştirilir. Böylece ASAS'ta bir MAG başka
 * bir MMYG'ye taşınırsa ya da bir ad değişirse sonraki yenilemede kendiliğinden
 * düzelir; kimse tablo güncellemez.
 *
 * Kurallar:
 *  - Aynı yenilemede bir kod birden çok üst değerle görülürse satır sayısı en
 *    yüksek olan kazanır, durum `conflicts` listesine yazılır (sessiz seçim yok).
 *  - Son yenilemede görülen değer her zaman öncekinin yerine geçer.
 *  - Son yenilemede görülmeyen kodlar (eski sezon, dar ufuk) RETAIN_DAYS boyunca
 *    son bilinen değerleriyle tutulur; böylece kayıtlı filtre/katalog kodları
 *    açıklamasız kalmaz. Süre dolunca düşer.
 *  - Bu yenilemede ad sütunu hiç gelmediyse (model sütunu eşlenmemiş) önceki ad
 *    korunur; ad sütunu geldiyse ve kod için boşsa ad temizlenir.
 */

const SCHEMA_VERSION = 1;
const RETAIN_DAYS = 400;
const DAY_MS = 86400000;

function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function codeOf(value) { return clean(value).toUpperCase(); }

function add(map, key, weight) { if (key) map.set(key, (map.get(key) || 0) + weight); }
function pick(counter) {
  let best = '', bestN = 0;
  for (const [value, n] of counter) if (n > bestN || (n === bestN && value < best)) { best = value; bestN = n; }
  return best;
}
function variants(counter) {
  return [...counter].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([value, rows]) => ({ value, rows }));
}

/**
 * Bir ayrıştırma turunda satır satır gözlem toplar.
 * columns: { name: bool, directorate: bool } — kaynakta ilgili sütunun var olup olmadığı.
 */
function createCollector(columns = {}) {
  const mags = new Map();   // code → { rows, mmyg: Map, directorate: Map }
  const mmygs = new Map();  // code → { rows, name: Map, directorate: Map }
  const has = { name: Boolean(columns.name), directorate: Boolean(columns.directorate) };
  // Sıcak yol (30k+ satır): satır başına yalnız ham dörtlü sayılır; normalleştirme
  // result() içinde tekil dörtlüler üzerinde bir kez yapılır.
  const tuples = new Map();
  const SEP = '\u0001';
  function apply(magValue, mmygValue, nameValue, directorateValue, weight) {
    const mag = codeOf(magValue), mmyg = codeOf(mmygValue);
    const name = clean(nameValue), directorate = clean(directorateValue);
    if (mmyg) {
      let e = mmygs.get(mmyg);
      if (!e) mmygs.set(mmyg, e = { rows: 0, name: new Map(), directorate: new Map() });
      e.rows += weight; add(e.name, name, weight); add(e.directorate, directorate, weight);
    }
    if (mag) {
      let e = mags.get(mag);
      if (!e) mags.set(mag, e = { rows: 0, mmyg: new Map(), directorate: new Map() });
      e.rows += weight; add(e.mmyg, mmyg, weight); add(e.directorate, directorate, weight);
    }
  }
  return {
    observe(magValue, mmygValue, nameValue, directorateValue) {
      if ((magValue == null || magValue === '') && (mmygValue == null || mmygValue === '')) return;
      const key = String(magValue == null ? '' : magValue) + SEP + String(mmygValue == null ? '' : mmygValue) + SEP
        + String(nameValue == null ? '' : nameValue) + SEP + String(directorateValue == null ? '' : directorateValue);
      tuples.set(key, (tuples.get(key) || 0) + 1);
    },
    result(meta = {}) {
      for (const [key, weight] of tuples) { const p = key.split(SEP); apply(p[0], p[1], p[2], p[3], weight); }
      tuples.clear();
      // Ayrıştırma deterministik kalır (senkron/işbirlikçi çıktı birebir aynı olmalı);
      // zaman damgası yayın anında merge() tarafından basılır.
      const at = meta.at || null;
      const out = { version: SCHEMA_VERSION, builtAt: at, columns: { ...has }, mag: {}, mmyg: {}, conflicts: [] };
      for (const [code, e] of mmygs) {
        out.mmyg[code] = { name: pick(e.name), directorate: pick(e.directorate), rows: e.rows, lastSeenAt: at };
        if (e.name.size > 1) out.conflicts.push({ kind: 'mmyg-name', code, values: variants(e.name) });
        if (e.directorate.size > 1) out.conflicts.push({ kind: 'mmyg-directorate', code, values: variants(e.directorate) });
      }
      for (const [code, e] of mags) {
        out.mag[code] = { mmyg: pick(e.mmyg), directorate: pick(e.directorate), rows: e.rows, lastSeenAt: at };
        if (e.mmyg.size > 1) out.conflicts.push({ kind: 'mag-mmyg', code, values: variants(e.mmyg) });
      }
      // Aynı adı taşıyan birden çok MMYG kodu: kullanıcı yalnız adı görürse karışır.
      const byName = new Map();
      for (const [code, e] of Object.entries(out.mmyg)) if (e.name) {
        const key = e.name.toLocaleUpperCase('tr-TR');
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(code);
      }
      for (const [, codes] of byName) if (codes.length > 1) out.conflicts.push({ kind: 'shared-name', name: out.mmyg[codes[0]].name, codes: codes.sort() });
      return out;
    },
  };
}

/** Birden çok ayrıştırma sonucunu (ör. CP ve Backlog kapsamı) tek gözleme indirger. */
function combine(list) {
  const parts = [...new Set((Array.isArray(list) ? list : []).filter(isHierarchy))];
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const at = parts.map(p => p.builtAt).filter(Boolean).sort().pop() || null;
  const out = { version: SCHEMA_VERSION, builtAt: at, columns: { name: parts.some(p => p.columns && p.columns.name), directorate: parts.some(p => p.columns && p.columns.directorate) }, mag: {}, mmyg: {}, conflicts: [] };
  for (const kind of ['mag', 'mmyg']) {
    for (const p of parts) for (const [code, e] of Object.entries(p[kind])) {
      const prev = out[kind][code];
      out[kind][code] = !prev || e.rows > prev.rows ? { ...e, rows: e.rows + (prev ? prev.rows : 0) } : { ...prev, rows: prev.rows + e.rows };
    }
  }
  const seen = new Set();
  for (const p of parts) for (const c of p.conflicts || []) {
    const key = JSON.stringify(c);
    if (!seen.has(key)) { seen.add(key); out.conflicts.push(c); }
  }
  return out;
}

function isHierarchy(value) {
  return Boolean(value && typeof value === 'object' && value.mag && value.mmyg && typeof value.mag === 'object' && typeof value.mmyg === 'object');
}

/**
 * Önceki yayınlanmış hiyerarşiyi yeni gözlemle birleştirir.
 * fresh yoksa (bu yenileme ASAS ayrıştırmadı) önceki aynen döner.
 */
function merge(previous, fresh, options = {}) {
  const prev = isHierarchy(previous) ? previous : null;
  if (!isHierarchy(fresh)) return prev;
  const at = options.now || fresh.builtAt || new Date().toISOString();
  const nowMs = Date.parse(at) || Date.now();
  const retainMs = (Number(options.retainDays) || RETAIN_DAYS) * DAY_MS;
  const alive = e => (nowMs - (Date.parse(e && e.lastSeenAt) || 0)) <= retainMs;
  const out = { version: SCHEMA_VERSION, builtAt: at, columns: { ...fresh.columns }, mag: {}, mmyg: {}, conflicts: (fresh.conflicts || []).slice() };
  for (const kind of ['mag', 'mmyg']) {
    if (prev) for (const [code, e] of Object.entries(prev[kind])) if (alive(e)) out[kind][code] = { ...e, stale: true };
    for (const [code, e] of Object.entries(fresh[kind])) {
      const old = prev && prev[kind][code];
      const next = { ...e, lastSeenAt: at };
      delete next.stale;
      // Ad / müdürlük sütunu bu kaynakta yoksa son bilinen değer korunur.
      if (kind === 'mmyg' && !fresh.columns.name && !next.name && old && old.name) next.name = old.name;
      if (!fresh.columns.directorate && !next.directorate && old && old.directorate) next.directorate = old.directorate;
      out[kind][code] = next;
    }
  }
  return out;
}

/**
 * Hiyerarşisi olmayan eski snapshot'lar için yedek: yüklü sipariş satırlarındaki
 * MAG/MMYG kodlarından ve LFL satırlarındaki müdürlükten kurulur. MMYG adı bu
 * satırlarda bulunmadığı için boş kalır; sonraki ASAS yenilemesi tamamlar.
 */
function fromRuntimeRows(orders, lflRows, meta = {}) {
  const lfl = Array.isArray(lflRows) ? lflRows : [];
  const collector = createCollector({ name: false, directorate: lfl.some(r => r && r.brandDirectorate) });
  for (const o of Array.isArray(orders) ? orders : []) if (o) collector.observe(o.merch, o.ageGroup, '', '');
  for (const r of lfl) if (r) collector.observe(r.mag, r.mmyg, '', r.brandDirectorate);
  return collector.result(meta);
}

/** İstemciye giden yalın görünüm. */
function publicView(h) {
  if (!isHierarchy(h)) return { version: SCHEMA_VERSION, builtAt: null, columns: { name: false, directorate: false }, mag: {}, mmyg: {}, conflicts: [] };
  return { version: h.version, builtAt: h.builtAt, columns: h.columns, mag: h.mag, mmyg: h.mmyg, conflicts: h.conflicts || [] };
}

/** MAG/MMYG/müdürlük için açıklama (sunucu tarafı rapor ve testler için). */
function describe(h, field, value) {
  const code = codeOf(value);
  if (!isHierarchy(h) || !code) return null;
  if (field === 'mag') {
    const m = h.mag[code]; if (!m) return null;
    const p = h.mmyg[m.mmyg] || {};
    return { code, mmyg: m.mmyg, mmygName: p.name || '', directorate: m.directorate || p.directorate || '', stale: Boolean(m.stale) };
  }
  if (field === 'mmyg') {
    const p = h.mmyg[code]; if (!p) return null;
    const mags = Object.keys(h.mag).filter(k => h.mag[k].mmyg === code).sort();
    return { code, mmygName: p.name || '', directorate: p.directorate || '', mags, stale: Boolean(p.stale) };
  }
  return null;
}

module.exports = { SCHEMA_VERSION, RETAIN_DAYS, createCollector, combine, merge, fromRuntimeRows, publicView, describe, isHierarchy };
