'use strict';

/*
 * Model geneli merch eşlemesi (Marka Müdürlüğü › MMYG › MAG), Ufuk'tan bağımsız.
 *
 * Neden: kullanıcı hiyerarşisi yalnız kendi ASAS yenilemesindeki satırlardan kurulur.
 * Ufuk birkaç MAG ile sınırlıysa, widget'lar / Ufuk seçicisi / OAB gibi bütün modeli
 * gösteren listelerdeki diğer kodlar "eşleme yok" kalıyordu. Elle tablo tutmak yerine
 * ASAS model bağlantısının MEVCUT alan eşlemesiyle küçük bir SUMMARIZE sorgusu atılır:
 * yalnız var olan MAG/MMYG/ad/müdürlük kombinasyonları döner (yüzlerce satır).
 *
 * Kurallar (her yenilemede ÇALIŞMAZ; sonuç programın veri klasörüne kalıcı yazılır):
 *  - İlk kez (kayıt yoksa) bir kez okunur.
 *  - ASAS yenilemesinde kayıtlı eşlemede olmayan YENİ bir MAG/MMYG kodu görülürse
 *    yeniden okunur (son okumadan en az 6 saat sonra), kayıt 7 günden eskiyse de.
 *  - Elle: Kullanıcı yönetimi › "ASAS'tan Tazele" (MAG/MMYG listesi) aynı anda yeniler.
 *  - Sorgu kullanıcıyı beklemez (arka plan). Hata olursa 30 dk denenmez; tek iş yürür.
 *  - Birleştirmede kullanıcının kendi (taze) gözlemi kazanır; model katmanı eksik
 *    kodları ve boş ad/müdürlük alanlarını tamamlar.
 */

const merchHierarchy = require('./merch-hierarchy');
const modelFields = require('./model-fields');

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const NEW_CODE_MIN_INTERVAL_MS = 6 * 3600 * 1000;
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;
const MAX_ROWS = 50000;
const HEADERS = Object.freeze({
  mag: 'Merch Alt Grup Kod', // i18n-ignore — ASAS başlığı
  mmyg: 'Merch Marka Yaş Grup Kod', // i18n-ignore — ASAS başlığı
  name: modelFields.MMYG_NAME_FIELD.header,
  directorate: 'Marka Müdürlükleri', // i18n-ignore — ASAS başlığı
});

const quoteTable = table => `'${String(table).replace(/'/g, "''")}'`;
const quoteColumn = name => `[${String(name).replace(/]/g, ']]')}]`;
const ref = entry => `${quoteTable(entry.table)}${quoteColumn(entry.name)}`;

/** ASAS bağlantısının alan eşlemesinden sorgu kurar; kurulamazsa null + neden. */
function buildMasterQuery(item) {
  const fallback = String(item && item.horizon && item.horizon.table || '').trim();
  const mapping = item && item.mapping || {};
  const cols = {};
  for (const [key, header] of Object.entries(HEADERS)) {
    const entry = modelFields.normalizeMappingEntry(mapping[header], fallback);
    if (entry && entry.name && entry.table && entry.kind !== 'measure') cols[key] = entry;
  }
  if (!cols.mag || !cols.mmyg) return { query: null, reason: 'MAG/MMYG kod alanları bu bağlantıda eşlenmemiş.' };
  const key = value => modelFields.fieldKey(value);
  // Kod tablosuyla aynı tablodaki ad/müdürlük doğrudan; farklı tablodaysa sorgu fact
  // tablosu (Ufuk tablosu) üzerinden ilişkiyle özetlenir. Fact tablosu yoksa o sütun atlanır.
  const baseTable = cols.mag.table;
  const tables = new Set(Object.values(cols).map(entry => key(entry.table)));
  let summarizeOn = baseTable;
  if (tables.size > 1) {
    if (fallback) summarizeOn = fallback; // fact tablosu: çoka-bir ilişkilerle bütün sütunlara ulaşır
    else {
      if (key(cols.mmyg.table) !== key(baseTable)) return { query: null, reason: 'MAG ve MMYG farklı tablolarda ve Ufuk tablosu tanımlı değil.' };
      for (const k of ['name', 'directorate']) if (cols[k] && key(cols[k].table) !== key(baseTable)) delete cols[k];
    }
  }
  const order = ['mag', 'mmyg', 'name', 'directorate'].filter(k => cols[k]);
  const summarize = `SUMMARIZE(${quoteTable(summarizeOn)}, ${order.map(k => ref(cols[k])).join(', ')})`;
  const select = order.map(k => `"${k}", ${ref(cols[k])}`).join(', ');
  return {
    // TOPN'un sıralama ifadesi eski SSAS sürümlerinde zorunlu; sonuç küçük, sınır maxRows ile uygulanır.
    query: `EVALUATE SELECTCOLUMNS(${summarize}, ${select})`,
    columns: order,
    source: order.map(k => `${cols[k].table}[${cols[k].name}]`).join(', '),
  };
}

/** Sorgu satırları → hiyerarşi (sütun sırası SELECTCOLUMNS sırasıdır). */
function hierarchyFromRows(rows, columns, meta = {}) {
  const idx = name => columns.indexOf(name);
  const collector = merchHierarchy.createCollector({ name: idx('name') >= 0, directorate: idx('directorate') >= 0 });
  for (const row of Array.isArray(rows) ? rows : []) {
    const values = Array.isArray(row) ? row : Object.values(row || {});
    const at = name => (idx(name) >= 0 ? values[idx(name)] : '');
    collector.observe(at('mag'), at('mmyg'), at('name'), at('directorate'));
  }
  const out = collector.result({ at: meta.at || new Date().toISOString() });
  out.source = 'model';
  return out;
}

/** Kullanıcı hiyerarşisi + model katmanı: taze kullanıcı gözlemi kazanır. */
function overlay(runtime, master) {
  const r = merchHierarchy.isHierarchy(runtime) ? runtime : null;
  const m = merchHierarchy.isHierarchy(master) ? master : null;
  if (!m) return r;
  if (!r) return { ...m, mag: { ...m.mag }, mmyg: { ...m.mmyg } };
  const out = {
    version: r.version, builtAt: r.builtAt, masterBuiltAt: m.builtAt,
    columns: { name: Boolean(r.columns && r.columns.name) || Boolean(m.columns && m.columns.name), directorate: Boolean(r.columns && r.columns.directorate) || Boolean(m.columns && m.columns.directorate) },
    mag: {}, mmyg: {}, conflicts: [...(r.conflicts || [])],
  };
  for (const kind of ['mag', 'mmyg']) {
    for (const [code, e] of Object.entries(m[kind])) out[kind][code] = { ...e, source: 'model' };
    for (const [code, e] of Object.entries(r[kind])) {
      const base = out[kind][code];
      if (e.stale && base) continue; // eski kullanıcı kaydı, güncel model kaydını ezmez
      const next = { ...e };
      if (base) {
        if (kind === 'mmyg' && !next.name && base.name) next.name = base.name;
        if (!next.directorate && base.directorate) next.directorate = base.directorate;
      }
      out[kind][code] = next;
    }
  }
  const seen = new Set(out.conflicts.map(c => JSON.stringify(c)));
  for (const c of m.conflicts || []) if (c.kind === 'shared-name' && !seen.has(JSON.stringify(c))) out.conflicts.push(c);
  return out;
}

/**
 * Arka plan yenileyici. deps: { loadConnections, runModelRows, readFile, writeFile, now }.
 * ensure() hiçbir zaman çağıranı bekletmek zorunda değildir; dönen söz takip içindir.
 */
function createMasterRefresher(deps) {
  let inflight = null, lastFailureAt = 0, lastError = '';
  const now = () => (typeof deps.now === 'function' ? deps.now() : Date.now());
  function read() { try { const v = deps.readFile(); return v && merchHierarchy.isHierarchy(v.hierarchy) ? v : null; } catch (_) { return null; } }
  function status() {
    const v = read();
    const age = v ? now() - (Date.parse(v.builtAt) || 0) : Infinity;
    return { builtAt: v ? v.builtAt : null, fresh: age < MAX_AGE_MS, pending: Boolean(inflight), error: lastError || '', source: v ? v.source : '' };
  }
  async function run() {
    const items = (deps.loadConnections() || []).filter(item => item && item.role === 'asas' && item.server && item.catalog && item.refreshEnabled !== false);
    let reason = 'ASAS Data Model bağlantısı yok.';
    for (const item of items) {
      const built = buildMasterQuery(item);
      if (!built.query) { reason = built.reason; continue; }
      const result = await deps.runModelRows({ server: item.server, catalog: item.catalog, query: built.query, generated: true, maxRows: MAX_ROWS, timeoutMs: 120000 });
      const at = new Date(now()).toISOString();
      const hierarchy = hierarchyFromRows(result && result.rows, built.columns, { at });
      const payload = { builtAt: at, connectionId: item.id || '', source: built.source, rows: (result && result.rows || []).length, hierarchy };
      deps.writeFile(payload);
      lastError = ''; lastFailureAt = 0;
      return payload;
    }
    throw new Error(reason);
  }
  /* Yeniden okuma gerekiyor mu? '' = hayır. runtime: kullanıcının yayınlanan hiyerarşisi. */
  function needsRefresh(runtime) {
    const v = read();
    if (!v) return 'missing';
    const age = now() - (Date.parse(v.builtAt) || 0);
    if (age >= MAX_AGE_MS) return 'aged';
    if (age < NEW_CODE_MIN_INTERVAL_MS || !merchHierarchy.isHierarchy(runtime)) return '';
    const known = v.hierarchy;
    for (const kind of ['mag', 'mmyg']) for (const [code, e] of Object.entries(runtime[kind])) if (!e.stale && !known[kind][code]) return 'new-codes';
    return '';
  }
  /* options.reason: 'manual' yalnız eşzamanlı işi bekler; diğerleri hata sonrası 30 dk bekler. */
  function ensure(options = {}) {
    if (inflight) return inflight;
    const manual = options.reason === 'manual';
    if (!manual && !options.reason && status().fresh) return Promise.resolve(read());
    if (!manual && lastFailureAt && now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(read());
    inflight = run()
      .catch(err => { lastFailureAt = now(); lastError = String(err && err.message || err); return read(); })
      .finally(() => { inflight = null; });
    return inflight;
  }
  return { ensure, status, read, needsRefresh };
}

module.exports = { MAX_AGE_MS, NEW_CODE_MIN_INTERVAL_MS, RETRY_AFTER_FAILURE_MS, HEADERS, buildMasterQuery, hierarchyFromRows, overlay, createMasterRefresher };
