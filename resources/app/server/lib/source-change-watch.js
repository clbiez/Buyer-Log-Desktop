'use strict';

/* ===================================================================
   KAYNAK DEĞİŞİKLİK SİNYALİ (v20260930)

   Kullanıcı: "Program sürekli olarak database'i tarasın, yeni veri varsa
   getirsin; buyer refresh yapmak veya refresh beklemek zorunda kalmasın."
   ASAS modeli günde birkaç kez (yaklaşık 9 / 12 / 15) işleniyor.

   Ağır ASAS sorgusunu periyodik çalıştırmak kurumsal veritabanını yorardı
   (her kullanıcı kendi filtresiyle 40–200 sn'lik sorgu atar). Bunun yerine
   modelin SON İŞLENME ZAMANI okunur: milisaniyelik bir metadata sorgusu.
   Değer, son başarılı yenilemenin başında okunan değerden farklıysa veri
   değişmiştir ve istemci mevcut yenileme akışını arka planda başlatır.
   İkinci bir yenileme motoru YOKTUR; bu modül yalnız "değişti mi?" sorusunu
   cevaplar.

   MDSCHEMA_* görünümleri okuma yetkisiyle çalışır (TMSCHEMA yönetici ister;
   bkz. modelQuery.js tablo keşfi). Kurulumlar farklı olduğu için birden çok
   görünüm sırayla denenir; hiçbiri çalışmazsa sinyal "desteklenmiyor" olur ve
   uygulama eskisi gibi elle/periyodik yenilemeyle çalışmaya devam eder.

   Temel çizgi (baseline) kullanıcı ve SAYFA başına diskte tutulur: yalnız CP
   yenilendiyse bağlı grup hâlâ eski damgadadır ve ayrıca yenilenmesi gerekir.
   Uygulama yeniden açıldığında, kapalıyken işlenmiş bir model de yakalanır.
   =================================================================== */

const fs = require('fs');
const path = require('path');

const STAMP_STRATEGIES = Object.freeze([
  {
    id: 'mdschema-cubes',
    query: 'SELECT [CUBE_NAME], [LAST_DATA_UPDATE] FROM $SYSTEM.MDSCHEMA_CUBES',
    field: 'LAST_DATA_UPDATE',
  },
  {
    id: 'dbschema-catalogs',
    query: 'SELECT [CATALOG_NAME], [DATE_MODIFIED] FROM $SYSTEM.DBSCHEMA_CATALOGS',
    field: 'DATE_MODIFIED',
  },
]);
// Aynı model için gerçek sorgu en fazla bu sıklıkta atılır (birden çok sekme
// ya da kullanıcı aynı anda sorsa bile).
const MIN_PROBE_INTERVAL_MS = 4 * 60 * 1000;
const WATCH_TARGETS = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
const PROBE_TIMEOUT_MS = 30 * 1000;

function clean(value) { return String(value == null ? '' : value).trim(); }

/** Satırlardaki en yeni zaman damgası (metin olarak; karşılaştırma eşitlikle yapılır). */
function extractStamp(rows, field) {
  const values = (Array.isArray(rows) ? rows : [])
    .map(row => clean(row && (row[field] != null ? row[field] : row[`[${field}]`])))
    .filter(Boolean);
  if (!values.length) return '';
  const parsed = values.map(value => ({ value, time: Date.parse(value) }));
  if (parsed.every(entry => Number.isFinite(entry.time))) {
    return parsed.sort((a, b) => b.time - a.time)[0].value;
  }
  // Tarih biçimi çözülemezse sıralı metin listesi damga olur: değişiklik yine yakalanır.
  return [...new Set(values)].sort().join('|');
}

/** Yenileme akışına giren (Database modundaki) ASAS bağlantısı. */
function selectAsasConnection(items) {
  return (Array.isArray(items) ? items : []).find(item => item
    && clean(item.role).toLowerCase() === 'asas'
    && item.refreshEnabled !== false
    && clean(item.server) && clean(item.catalog)) || null;
}

function connectionKey(item) { return `${clean(item && item.server)}\u0000${clean(item && item.catalog)}`; }

function createSourceChangeWatch(options = {}) {
  const runModelRows = options.runModelRows;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const stateFile = options.stateFile || '';
  const probes = new Map(); // connectionKey -> { at, result, pending }

  function readState() {
    if (!stateFile) return {};
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch (_) { return {}; }
  }
  function writeState(state) {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, stateFile);
    } catch (_) { /* sinyal kaydı yazılamazsa bir sonraki yenilemede yine denenir */ }
  }

  async function probeUncached(item) {
    const attempts = [];
    for (const strategy of STAMP_STRATEGIES) {
      try {
        const result = await runModelRows({
          server: item.server, catalog: item.catalog, query: strategy.query,
          maxRows: 500, timeoutMs: PROBE_TIMEOUT_MS,
        });
        const stamp = extractStamp(result && result.rows, strategy.field);
        attempts.push({ method: strategy.id, ok: Boolean(stamp) });
        if (stamp) return { ok: true, stamp, method: strategy.id, attempts };
      } catch (error) {
        attempts.push({ method: strategy.id, ok: false, error: clean(error && error.message || error).slice(0, 300) });
        if (error && error.code === 'MODEL_QUERY_UNSUPPORTED') break;
      }
    }
    const last = [...attempts].reverse().find(entry => entry.error);
    return { ok: false, stamp: '', method: '', attempts, error: last ? last.error : 'Model son işlenme zamanını vermedi.' };
  }

  /** Modelin son işlenme damgası; MIN_PROBE_INTERVAL_MS içinde önbellekten, eşzamanlı istekler tek sorgu. */
  async function probe(item, { force = false } = {}) {
    if (!item) return { ok: false, stamp: '', error: 'ASAS Database bağlantısı yok.' };
    const key = connectionKey(item);
    const entry = probes.get(key) || {};
    if (entry.pending) return entry.pending;
    if (!force && entry.result && now() - entry.at < MIN_PROBE_INTERVAL_MS) return { ...entry.result, cached: true };
    const pending = probeUncached(item)
      .then(result => {
        const checked = { ...result, checkedAt: new Date(now()).toISOString() };
        probes.set(key, { at: now(), result: checked, pending: null });
        return checked;
      })
      .catch(error => {
        probes.set(key, { ...entry, pending: null });
        throw error;
      });
    probes.set(key, { ...entry, pending });
    return pending;
  }

  /**
   * Yenileme başarıyla bittiğinde: başında okunan damga, yenilenen sayfaların
   * temel çizgisi olur. Başta okumak bilinçlidir: model yenileme sırasında
   * işlenirse bir sonraki kontrol farkı görür (en kötü ihtimalle bir tur fazla).
   */
  function recordRefresh(userId, item, stamp, targets) {
    const value = clean(stamp);
    const list = (Array.isArray(targets) && targets.length ? targets : WATCH_TARGETS)
      .map(clean).filter(target => WATCH_TARGETS.includes(target));
    if (!userId || !item || !value || !list.length) return;
    const state = readState();
    const key = clean(userId);
    const previous = state[key] && state[key].connection === connectionKey(item) ? state[key] : null;
    const at = new Date(now()).toISOString();
    const stamps = { ...((previous && previous.targets) || {}) };
    for (const target of list) stamps[target] = { stamp: value, at };
    state[key] = { connection: connectionKey(item), targets: stamps };
    writeState(state);
  }

  /**
   * "Yeni veri var mı?" changedTargets: damgası modelin güncel damgasından
   * farklı ya da hiç kaydı olmayan sayfalar. Kullanıcının HİÇ kaydı yoksa
   * (ilk kullanım) değişiklik sayılmaz; ilk başarılı yenileme temel çizgiyi kurar.
   */
  async function status(userId, items, options = {}) {
    const item = selectAsasConnection(items);
    if (!item) return { supported: false, changed: false, changedTargets: [], reason: 'no-connection' };
    const result = await probe(item, options);
    if (!result.ok) return { supported: false, changed: false, changedTargets: [], reason: 'probe-failed', error: result.error, checkedAt: result.checkedAt || '' };
    const saved = readState()[clean(userId)] || null;
    const baseline = saved && saved.connection === connectionKey(item) && saved.targets ? saved.targets : null;
    const changedTargets = baseline
      ? WATCH_TARGETS.filter(target => !baseline[target] || baseline[target].stamp !== result.stamp)
      : [];
    return {
      supported: true,
      stamp: result.stamp,
      method: result.method,
      checkedAt: result.checkedAt || '',
      hasBaseline: Boolean(baseline),
      changed: changedTargets.length > 0,
      changedTargets,
    };
  }

  function reset() { probes.clear(); }

  return { probe, status, recordRefresh, reset, selectAsasConnection };
}

module.exports = {
  STAMP_STRATEGIES, MIN_PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS, WATCH_TARGETS,
  extractStamp, selectAsasConnection, connectionKey, createSourceChangeWatch,
};
