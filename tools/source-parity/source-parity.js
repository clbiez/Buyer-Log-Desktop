'use strict';

/*
 * BUYER LOG — KAYNAK DOĞRULAMA + YENİLEME HIZ GÜNLÜĞÜ (ASAS / IAS / EXCEL)
 *
 * BU ARAÇ BUYER LOG'U DEĞİŞTİRMEZ.
 *  - Buyer Log'un o an ETKİN çekirdeğindeki modüller (.buyerlog-versions\...\app
 *    ya da resources\app) yalnız bu sürecin belleğine yüklenir; hiçbir BL
 *    dosyasına yazılmaz.
 *  - BL ayarları (settings.json / overrides.json) yalnız okunur. Runtime
 *    snapshot, bağlantı kaydı, yenileme geçmişi değişmez.
 *  - Kaynak Excel dosyalarının kendisine dokunulmaz; rapor klasörüne alınan
 *    kopyaların pivotu BL'ın kendi RefreshExcel.ps1'iyle yenilenir. Excel PID
 *    dosyası ayrıdır; açık BL'ın Excel yenilemesine dokunulmaz.
 *  - Aday IAS sorgusu (RELATED) ve kumaşsız ASAS sorgusu, BL fonksiyonlarının
 *    yalnız BU SÜREÇTEKİ kopyası geçici olarak sarmalanarak üretilir; her
 *    varyanttan sonra özgün fonksiyon geri konur.
 *
 * Akış:
 *   1) Excel  — asas*.xlsx / antrepo*.xlsx kopyası → pivot yenileme → BL Excel
 *               ayrıştırıcısı. DOĞRULUK REFERANSI.
 *   2) BL     — loadFromModelConnections: BL'ın Database yenilemesinin veri
 *               katmanı (ASAS + IAS paralel, eşleştirme, bütünlük denetimi).
 *   3) Ölçüm  — IAS mevcut ⇄ aday, ASAS kumaşlı ⇄ kumaşsız; tek başına,
 *               turlar arasında sıra değiştirerek.
 *   4) Rapor  — rapor.txt (doğruluk), performans.txt (hız), olaylar.jsonl
 *               (zaman damgalı ham günlük), CSV farkları, sorgular\*.dax.
 *
 * Çıkış kodu: 0 geçti (uyarı olabilir) · 1 veri farkı · 2 tamamlanamadı.
 */

const fs = require('fs');
const path = require('path');
const cmp = require('./compare.js');

const TOOL_VERSION = '2026-11-18.2';
const MATCH_TARGETS = Object.freeze(['cp', 'orders', 'backlog']);
const ALL_TARGETS = Object.freeze(['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']);
const TARGET_LABELS = { cp: 'CP', orders: 'Siparişler', backlog: 'Backlog', lfl: 'LFL', priceanalysis: 'Price & Supplier' };
const FABRIC_HEADERS = Object.freeze(['Ana Kumaş Mı', 'Kumaş Kategorisi', 'Kumaşçı Ülkesi', 'Kumaşçı', 'Kumaş Tipi', 'İplik No', 'Gramaj', 'Karışım']);

/* ------------------------------- yardımcılar ------------------------------- */

function readJsonSafe(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch (_) { return null; }
}
function seconds(ms) { return ms == null || !Number.isFinite(Number(ms)) ? '-' : `${(Number(ms) / 1000).toFixed(1)} sn`; }
function pct(part, whole) { return whole > 0 ? `%${Math.round((part / whole) * 100)}` : '-'; }
function median(values) {
  const list = (values || []).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}
function usageError(message) { const error = new Error(message); error.exitCode = 2; return error; }

function parseArgs(argv) {
  const args = { user: 'moderator', kumas: 'ikisi', aday: true, tekrar: 1, excel: true, root: '', core: '', cikti: '' };
  for (let i = 0; i < argv.length; i++) {
    const name = String(argv[i] || '').replace(/^--/, '').toLowerCase();
    const take = () => { i += 1; return String(argv[i] == null ? '' : argv[i]).trim(); };
    const no = value => /^(hayir|hayır|no|0|false|h)$/i.test(value);
    if (name === 'root') args.root = take();
    else if (name === 'core') args.core = take();
    else if (name === 'user') args.user = take() || 'moderator';
    else if (name === 'kumas') args.kumas = take().toLowerCase();
    else if (name === 'aday') args.aday = !no(take());
    else if (name === 'tekrar') args.tekrar = Number(take());
    else if (name === 'excel') args.excel = !no(take());
    else if (name === 'cikti') args.cikti = take();
    else if (name === 'help' || name === 'h' || name === '?') args.help = true;
  }
  if (!['ikisi', 'dahil'].includes(args.kumas)) throw usageError(`--kumas yalnız ikisi | dahil olabilir (verilen: ${args.kumas}).`);
  if (!Number.isInteger(args.tekrar) || args.tekrar < 1 || args.tekrar > 5) throw usageError('--tekrar 1 ile 5 arasında bir tam sayı olmalı.');
  return args;
}

/* ------------------------- etkin BL çekirdeğini bul ------------------------- */

/* electron/update/launcher-state.js currentPointer() mantığının SALT-OKUNUR
   kopyası. BL'ın kendi modülü yüklenirken klasör oluşturduğu için kullanılmaz. */
function versionKey(version) { return String(version || '').replace(/[^0-9A-Za-z._-]/g, '_'); }
function semverParts(version) { return String(version || '').split(/[.+-]/).slice(0, 3).map(part => Number(part) || 0); }
function isNewerVersion(a, b) {
  const x = semverParts(a), y = semverParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function coreVersion(core) { const pkg = readJsonSafe(path.join(core, 'package.json')); return pkg && String(pkg.version || '').trim() || ''; }
function validCore(core) {
  return Boolean(core) && fs.existsSync(path.join(core, 'electron', 'main.js'))
    && fs.existsSync(path.join(core, 'server', 'lib', 'model-refresh.js'));
}
function samePath(a, b) {
  const norm = value => { const p = path.resolve(value); return process.platform === 'win32' ? p.toLowerCase() : p; };
  return norm(a) === norm(b);
}
function insideDir(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}
function resolveActiveCore(root) {
  const bootstrap = path.join(root, 'resources', 'app');
  const versionsRoot = path.join(root, '.buyerlog-versions');
  const pointer = readJsonSafe(path.join(root, 'data', 'local', 'updater', 'current.json'));
  let managed = '';
  if (pointer && pointer.schemaVersion === 1) {
    const candidates = [pointer.appCoreRoot];
    const parts = String(pointer.appCoreRoot || '').split(/[\\/]+/).filter(Boolean);
    const index = parts.lastIndexOf('.buyerlog-versions');
    if (index >= 0 && parts[index + 1] && parts[index + 1] !== '.' && parts[index + 1] !== '..') candidates.push(path.join(versionsRoot, parts[index + 1], 'app'));
    if (pointer.version) candidates.push(path.join(versionsRoot, versionKey(pointer.version), 'app'));
    for (const candidate of candidates) {
      if (!candidate || !validCore(candidate)) continue;
      if (!samePath(candidate, bootstrap) && !insideDir(candidate, versionsRoot)) continue;
      if (pointer.version && coreVersion(candidate) !== pointer.version) continue;
      managed = path.resolve(candidate);
      break;
    }
  }
  // Eski yönetilen sürüm, üstüne konmuş daha yeni tam paketi gölgelemez.
  if (managed && !samePath(managed, bootstrap) && validCore(bootstrap) && isNewerVersion(coreVersion(bootstrap), coreVersion(managed))) managed = '';
  const core = managed || bootstrap;
  if (!validCore(core)) throw usageError(`Buyer Log uygulama çekirdeği bulunamadı (${core}). CMD dosyasını BuyerLog.exe'nin yanında çalıştırın.`);
  return { core, version: coreVersion(core), source: managed && !samePath(managed, bootstrap) ? 'güncelleme klasörü (.buyerlog-versions)' : 'temel kurulum (resources\\app)' };
}

/* ------------------------------ ortam ve modüller ------------------------------ */

function setupEnvironment(root, core, env = process.env) {
  const portable = require(path.join(core, 'electron', 'portable-paths.js'));
  const paths = portable.desktopPaths(root);
  const next = portable.backendEnv(paths, env);
  for (const [key, value] of Object.entries(next)) env[key] = value;
  env.BUYER_LOG_EXCEL_PID_FILE = path.join(paths.localDataRoot, 'runtime', 'excel-kaynak-dogrulama.pid');
  return paths;
}

function loadBl(core) {
  const req = rel => require(path.join(core, rel));
  const bl = {
    userData: req('server/user-data.js'),
    db: req('server/db.js'),
    userPreferences: req('server/lib/user-preferences.js'),
    modelRefresh: req('server/lib/model-refresh.js'),
    modelHorizon: req('server/lib/modelHorizon.js'),
    modelFields: req('server/lib/model-fields.js'),
    modelQuery: req('server/lib/modelQuery.js'),
    parse: req('server/lib/parse.js'),
    findFiles: req('server/lib/findFiles.js'),
    refreshExcel: req('server/lib/refreshExcel.js'),
    sourceRefresh: req('server/lib/source-refresh.js'),
    appVersion: req('server/lib/app-version.js'),
  };
  const required = [
    ['modelRefresh', 'loadFromModelConnections'], ['modelHorizon', 'buildFactRowQuery'], ['modelFields', 'missingRequired'],
    ['modelQuery', 'runModelRows'], ['modelQuery', 'discoverSchema'], ['db', 'normalizeModelConnections'],
    ['userPreferences', 'applyHorizonOverrides'], ['parse', 'parseASASWorkbook'], ['parse', 'parseAntrepoWorkbook'],
    ['parse', 'parseASASRows'], ['parse', 'parseAntrepoRows'], ['parse', 'findAntrepoHits'], ['parse', 'antrepoMatchKey'],
    ['parse', 'dynamicAntrepoMatchKey'], ['parse', 'normalizeAntrepoMatchConfig'], ['parse', 'defaultAntrepoMatchConfig'],
    ['parse', 'antrepoParseMeta'], ['parse', 'parseDateOnly'], ['findFiles', 'findLatestSourceFiles'],
    ['refreshExcel', 'refreshExcelFile'], ['sourceRefresh', 'computeRefreshTimeoutMs'],
  ];
  const missing = required.filter(([mod, fn]) => typeof (bl[mod] && bl[mod][fn]) !== 'function').map(([mod, fn]) => `${mod}.${fn}`);
  if (missing.length) throw usageError(`Bu Buyer Log sürümü araçla uyumlu değil; eksik: ${missing.join(', ')}`);
  return bl;
}

/* BL ayarlarını YALNIZ OKUR. db.loadSettings() kullanılmaz (klasör oluşturabilir,
   bozuk dosyayı yedekten geri yazabilir). */
function loadContext(bl, args) {
  const configPath = bl.userData.CONFIG_PATH;
  const config = (configPath && readJsonSafe(configPath)) || {};
  const deltaMode = String(process.env.BL_DELTA_STORE_MODE || config.deltaStoreMode || 'shadow').toLowerCase();
  if (deltaMode === 'delta-only') throw usageError('Kurulum "delta-only" veri modunda; ayarlar JSON dosyasında değil. Yanlış ayarla test yapılmasın diye durduruldu.');
  const dataRoot = bl.userData.SERVER_DATA_ROOT;
  const settings = readJsonSafe(path.join(dataRoot, 'settings.json'));
  if (!settings) throw usageError(`Buyer Log ayar dosyası okunamadı: ${path.join(dataRoot, 'settings.json')}`);
  const overrides = readJsonSafe(path.join(dataRoot, 'overrides.json')) || {};
  const normalized = bl.db.normalizeModelConnections(Array.isArray(settings.modelConnections) ? settings.modelConnections : []);
  const items = bl.userPreferences.applyHorizonOverrides(normalized, args.user, ALL_TARGETS.slice(), null);
  const matchRule = (Number(overrides.antrepoMatchConfigVersion) || 0) >= 3
    ? bl.parse.normalizeAntrepoMatchConfig(overrides.antrepoMatchConfig || null)
    : bl.parse.defaultAntrepoMatchConfig();
  const folders = settings.sourceFolders && typeof settings.sourceFolders === 'object' ? settings.sourceFolders : {};
  const sourceFolder = folders[args.user] || (args.user === 'moderator' ? (settings.sourceFolder || config.sourceFolder) : '') || '';
  const active = items.filter(item => item && item.refreshEnabled !== false && item.server && item.catalog && (item.role === 'asas' || item.role === 'antrepo'));
  return {
    config, items, matchRule, sourceFolder,
    sourceModes: {
      asas: overrides.asasSourceMode === 'database' ? 'database' : 'excel',
      antrepo: ['database', 'dashboard'].includes(overrides.antrepoSourceMode) ? overrides.antrepoSourceMode : 'excel',
      lfl: overrides.lflSourceMode === 'database' ? 'database' : 'excel',
    },
    connections: active.map(item => ({ id: item.id, name: item.name, role: item.role, server: item.server, catalog: item.catalog })),
  };
}

/* BL'ın kendi kaydettiği son gerçek yenileme süreleri (yalnız toplam). */
function readBlRefreshHistory(localDataRoot, limit = 15) {
  const dir = path.join(localDataRoot || '', 'refresh-performance', 'history');
  let files = [];
  try { files = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort().slice(-3); } catch (_) { return []; }
  const events = [];
  for (const name of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch (_) { continue; }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const event = JSON.parse(line); if (event && event.status === 'done') events.push(event); } catch (_) {}
    }
  }
  return events.slice(-limit).map(event => ({
    at: event.finishedAt || event.at || '', durationMs: Number(event.durationMs) || 0,
    targets: event.profile && event.profile.targets || [], sourceModes: event.profile && event.profile.sourceModes || {},
  }));
}

/* ---------------------------- ölçüm (olay günlüğü) ---------------------------- */

function createTracer() {
  const t0 = Date.now();
  const events = [];
  const state = { run: 'hazırlık' };
  return {
    events, state,
    add(event) { events.push({ t: Date.now() - t0, at: new Date().toISOString(), run: state.run, ...event }); },
    async phase(run, log, work) {
      const previous = state.run;
      state.run = run;
      const started = Date.now();
      log(`→ ${run} ...`);
      this.add({ type: 'phase-start' });
      try {
        const value = await work();
        const ms = Date.now() - started;
        this.add({ type: 'phase-end', ms, heapMb: Math.round(process.memoryUsage().heapUsed / 1048576) });
        log(`  ✓ ${run} (${seconds(ms)})`);
        return { ok: true, ms, value, run };
      } catch (error) {
        const ms = Date.now() - started;
        const message = String(error && (error.publicMessage || error.message) || error);
        this.add({ type: 'phase-error', ms, error: message });
        log(`  ✗ ${run} (${seconds(ms)}): ${message}`);
        return { ok: false, ms, error: message, run };
      } finally { state.run = previous; }
    },
  };
}

/* runModelRows / discoverSchema sarmalayıcıları: BL bunları options üzerinden
   kabul eder (model-refresh.js queryConnectionRows / ensureConnectionMapping);
   davranış aynen korunur, yalnız süre ve hacim kaydedilir. */
function instrumentedQueryFns(bl, ctx, tracer, deps, captured) {
  const baseRun = deps.runModelRows || bl.modelQuery.runModelRows;
  const baseSchema = deps.discoverSchema || bl.modelQuery.discoverSchema;
  const roleOf = input => {
    const matches = ctx.connections.filter(c => c.server === input.server && c.catalog === input.catalog);
    if (matches.length === 1) return matches[0].role;
    return /SELECTCOLUMNS\(/.test(String(input.query || '')) ? 'antrepo' : 'asas';
  };
  const runModelRows = async (input, options) => {
    const role = roleOf(input);
    const started = Date.now();
    try {
      const result = await baseRun(input, options);
      const n = key => Number(result && result[key]) || 0;
      tracer.add({
        type: 'model-query', role, catalog: input.catalog, ms: Date.now() - started,
        rows: Number(result && result.rowCount) || (result && Array.isArray(result.rows) ? result.rows.length : 0),
        providerMs: n('elapsedMs'), setupMs: n('setupMs'), connectionOpenMs: n('connectionOpenMs'), executeMs: n('executeMs'),
        writeMs: n('writeMs'), parseMs: n('parseMs'), retryMs: n('retryMs'), cleanupMs: n('cleanupMs'), overheadMs: n('overheadMs'),
        provider: String(result && result.provider || ''), queryChars: String(input.query || '').length,
      });
      captured.push({ run: tracer.state.run, role, query: String(input.query || '') });
      return result;
    } catch (error) {
      tracer.add({ type: 'model-query-error', role, catalog: input.catalog, ms: Date.now() - started, error: String(error && error.message || error) });
      throw error;
    }
  };
  const discoverSchema = async (input, options) => {
    const started = Date.now();
    try {
      const schema = await baseSchema(input, options);
      tracer.add({ type: 'schema-discovery', catalog: input && input.catalog, ms: Date.now() - started,
        columns: schema && Array.isArray(schema.columns) ? schema.columns.length : 0 });
      return schema;
    } catch (error) {
      tracer.add({ type: 'schema-discovery-error', catalog: input && input.catalog, ms: Date.now() - started, error: String(error && error.message || error) });
      throw error;
    }
  };
  const telemetry = event => { const { type, timestampMs, ...rest } = event || {}; tracer.add({ type: 'bl-telemetry', blType: type, ...rest }); };
  return { runModelRows, discoverSchema, telemetry };
}

/* ------------------------ yalnız bu süreçteki varyantlar ------------------------ */

async function withPatched(object, key, makeReplacement, work) {
  const original = object[key];
  object[key] = makeReplacement(original);
  try { return await work(); } finally { object[key] = original; }
}

/* IAS aday: fact dışı alanlar satır başına CALCULATE yerine RELATED ile okunur.
   BL'ın ürettiği sorgu metni üzerinde, yalnız tam kalıp eşleşmesinde dönüşür. */
const SELECTEDVALUE_LOOKUP = /CALCULATE\(SELECTEDVALUE\(('(?:[^']|'')+'\[(?:[^\]]|\]\])+\])\), CALCULATETABLE\('(?:[^']|'')+'\)\)/g;
function toRelatedQuery(query) { return String(query || '').replace(SELECTEDVALUE_LOOKUP, 'RELATED($1)'); }

function withoutFabric(items) {
  const fabric = new Set(FABRIC_HEADERS);
  return items.map(item => {
    if (!item || item.role !== 'asas') return item;
    const mapping = Object.fromEntries(Object.entries(item.mapping || {}).filter(([header]) => !fabric.has(header)));
    const cpColumns = Array.isArray(item.cpColumns) ? item.cpColumns.filter(col => !fabric.has(col && col.header)) : item.cpColumns;
    return { ...item, mapping, cpColumns };
  });
}
function fabricColumnRefs(items) {
  const refs = [];
  for (const item of items) {
    if (!item || item.role !== 'asas') continue;
    for (const header of FABRIC_HEADERS) {
      const entry = item.mapping && item.mapping[header];
      const name = entry && typeof entry === 'object' ? entry.name : entry;
      if (name) refs.push(`[${String(name).trim().replace(/]/g, ']]')}]`);
    }
  }
  return [...new Set(refs)];
}

/* --------------------------------- adımlar --------------------------------- */

function requireXlsx(core) {
  const XLSX = require(path.join(core, 'node_modules', 'xlsx'));
  try { require(path.join(core, 'public', 'excel-date-utils.js')).installSheetJsHooks(XLSX); } catch (_) {}
  try { require(path.join(core, 'server', 'lib', 'workbook-parser-guards.js')).install(XLSX); } catch (_) {}
  return XLSX;
}

async function excelStep(bl, ctx, outDir, log, tracer, deps, core) {
  const result = { enabled: true, valid: false, files: {}, refresh: {}, problems: [] };
  if (!ctx.sourceFolder) { result.problems.push('Kaynak klasör seçili değil (Buyer Log → Kaynak Veri).'); return result; }
  let found;
  try { found = bl.findFiles.findLatestSourceFiles(ctx.sourceFolder); }
  catch (error) { result.problems.push(String(error.message || error)); return result; }
  if (!found.asas) result.problems.push(`Klasörde asas*.xlsx yok: ${ctx.sourceFolder}`);
  if (!found.antrepo) result.problems.push(`Klasörde antrepo*.xlsx yok: ${ctx.sourceFolder}`);
  if (!found.asas || !found.antrepo) return result;
  const copyDir = path.join(outDir, 'excel-kopyalari');
  fs.mkdirSync(copyDir, { recursive: true });
  const refresh = deps.refreshExcelFile || bl.refreshExcel.refreshExcelFile;
  let refreshed = true;
  for (const [kind, file] of [['asas', found.asas], ['antrepo', found.antrepo]]) {
    const copy = path.join(copyDir, file.name);
    fs.copyFileSync(file.full, copy);
    result.files[kind] = { source: file.full, copy, modifiedAt: new Date(file.mtime).toISOString(), bytes: fs.statSync(copy).size };
    const timeoutMs = bl.sourceRefresh.computeRefreshTimeoutMs(copy, ctx.config.excelRefreshTimeoutMs);
    const step = await tracer.phase(`Excel pivot yenileme · ${kind.toUpperCase()}`, log, () => refresh(copy, timeoutMs));
    result.refresh[kind] = { ok: step.ok, ms: step.ms, error: step.error || '' };
    if (!step.ok) refreshed = false;
  }
  const XLSX = deps.xlsx || requireXlsx(core);
  const read = full => XLSX.readFile(full, { cellDates: false, raw: true, dense: true });
  const asasStep = await tracer.phase('Excel okuma · ASAS', log, () => bl.parse.parseASASWorkbook(read(result.files.asas.copy), ctx.matchRule));
  const iasStep = await tracer.phase('Excel okuma · Antrepo', log, () => bl.parse.parseAntrepoWorkbook(read(result.files.antrepo.copy), ctx.matchRule));
  result.parse = { asasMs: asasStep.ms, antrepoMs: iasStep.ms };
  if (!asasStep.ok || !iasStep.ok) { result.problems.push(`Excel okunamadı: ${asasStep.error || iasStep.error}`); return result; }
  if (!asasStep.value || !Array.isArray(asasStep.value.orders)) { result.problems.push('ASAS Excel dosyasında "Sipariş Kod" sütunu bulunamadı.'); return result; }
  const meta = bl.parse.antrepoParseMeta(iasStep.value) || {};
  if (meta.ok === false) { result.problems.push(`Antrepo Excel eşleştirme alanları çözülemedi: ${meta.reason || ''}`); return result; }
  result.orders = asasStep.value.orders;
  result.antrepoMap = iasStep.value;
  result.antrepoMeta = { dataRows: meta.dataRows, matchableRows: meta.matchableRows, blankStatus: meta.blankStatus, columns: meta.columns };
  // Fail-closed: pivotu yenilenmemiş Excel doğruluk referansı OLAMAZ.
  if (!refreshed) { result.problems.push('Excel pivotları yenilenemedi; eski kayıtlı veri referans alınamaz. Excel karşılaştırmaları GEÇERSİZ.'); return result; }
  result.valid = true;
  return result;
}

/* BELLEK: Buyer Log'un Electron çalışma zamanı V8 yığınını ~4 GB ile sınırlar
   ve bu sınır yükseltilemez. Bu yüzden her koşudan yalnız karşılaştırmada
   gerçekten kullanılan İLK başarılı sonuç tutulur; sonraki turlardan yalnız
   süre ve veri parmak izi saklanır. Node CPU ölçümleri satırlar bellekteyken
   hemen yapılır, ardından ham satırlar ve aynı içerikli hedef kopyaları
   bırakılır. (7.0.362 sahada 13 koşuyu tutup 3.7 GB'ta çöktü.) */
function runsOf(value, role) {
  return (value && Array.isArray(value.runs) ? value.runs : [])
    .filter(run => run && run.item && (role === 'all' || (role === 'antrepo' ? run.item.role === 'antrepo' : run.item.role !== 'antrepo')));
}
function stripRows(value, role = 'all') {
  for (const run of runsOf(value, role)) {
    run.rowCount = Array.isArray(run.rows) ? run.rows.length : 0;
    run.rows = [];
  }
}
/* CP / Siparişler / Backlog aynı kapsamdan geliyorsa BL her hedef için ayrı
   dizi üretir; içerik aynıysa tek diziye indirilir (karşılaştırma değişmez). */
function slimTargets(value, cctx) {
  if (!value) return;
  for (const key of ['asasOrdersByTarget', 'antrepoMapByTarget', 'fabricHeaderInfoByTarget']) {
    const byTarget = value[key];
    if (!byTarget || typeof byTarget !== 'object') continue;
    for (const target of Object.keys(byTarget)) if (!MATCH_TARGETS.includes(target)) delete byTarget[target];
    const seen = new Map();
    for (const target of MATCH_TARGETS) {
      const data = byTarget[target];
      if (!data) continue;
      const fp = key === 'asasOrdersByTarget' ? cmp.ordersFingerprint(data, cctx)
        : key === 'antrepoMapByTarget' ? cmp.iasFingerprint(data, cctx) : JSON.stringify(data);
      if (seen.has(fp)) byTarget[target] = seen.get(fp); else seen.set(fp, data);
    }
  }
  value.lflRows = null;
  value.asasOrders = null;
  value.antrepoMap = null;
}
function heapMb() { return Math.round(process.memoryUsage().heapUsed / 1048576); }

async function databaseSteps(bl, ctx, args, log, tracer, deps) {
  const captured = [];
  const probes = [];
  const cctx = { parseLib: bl.parse, rule: ctx.matchRule, canon: cmp.createCanon(bl.parse) };
  const fns = instrumentedQueryFns(bl, ctx, tracer, deps, captured);
  const load = bl.modelRefresh.loadFromModelConnections;
  const base = { matchRule: ctx.matchRule, runModelRows: fns.runModelRows, discoverSchema: fns.discoverSchema, telemetry: fns.telemetry, ...(deps.loadOptions || {}) };
  const out = { captured, probes, full: null, ias: { current: [], candidate: [] }, asas: { fabric: [], noFabric: [] }, variantProblems: [] };
  const time = (label, fn) => {
    const started = process.hrtime.bigint();
    const value = fn();
    const probe = { label, ms: Number(process.hrtime.bigint() - started) / 1e6 };
    probes.push(probe);
    tracer.add({ type: 'cpu-probe', ...probe });
    return value;
  };
  const iasPrint = value => {
    const maps = value && value.antrepoMapByTarget || {};
    return cmp.iasFingerprint(maps.backlog || maps.cp || maps.orders || {}, cctx);
  };
  /* İlk başarılı sonuç karşılaştırma için tutulur; diğerlerinde yalnız süre ve
     parmak izi kalır. */
  const settle = (step, list, prepare) => {
    if (step.ok) {
      step.fp = iasPrint(step.value);
      if (list.some(other => other.ok && other.value)) step.value = undefined;
      else prepare(step.value);
    }
    list.push(step);
    tracer.add({ type: 'heap', heapMb: heapMb() });
  };

  // 1) BL yenilemesinin veri katmanı, BL'daki gibi (ASAS + IAS paralel).
  const includeLfl = ctx.sourceModes.lfl === 'database';
  out.full = await tracer.phase('BL yenilemesi (ASAS + IAS paralel, BL ile birebir)', log,
    () => load(ctx.items, { ...base, targets: ALL_TARGETS.slice(), includeAsas: true, includeAntrepo: true, includeLfl }));
  if (!out.full.ok) return out;
  {
    const value = out.full.value;
    const asasRows = runsOf(value, 'asas').flatMap(run => run.rows || []);
    if (asasRows.length) time(`ASAS ayrıştırma (kumaşlı, ${asasRows.length} satır)`, () => { bl.parse.parseASASRows(asasRows, ctx.matchRule); });
    const iasRows = runsOf(value, 'antrepo').flatMap(run => run.rows || []);
    const orders = value.asasOrdersByTarget && (value.asasOrdersByTarget.backlog || value.asasOrdersByTarget.cp) || [];
    if (iasRows.length) {
      const map = time(`IAS ayrıştırma (${iasRows.length} satır)`, () => bl.parse.parseAntrepoRows(iasRows, ctx.matchRule));
      time(`ASAS ⇄ IAS eşleştirme (${orders.length} sipariş)`, () => { for (const order of orders) bl.parse.findAntrepoHits(map, order, { rule: ctx.matchRule }); });
    }
    stripRows(value);
    slimTargets(value, cctx);
    tracer.add({ type: 'heap', heapMb: heapMb() });
  }
  const preset = out.full.value.asasOrdersByTarget || {};
  const matchBase = { ...base, targets: MATCH_TARGETS.slice(), includeLfl: false };

  // 2) IAS tek başına: mevcut ⇄ aday. Sıra her turda değişir.
  const iasRun = () => load(ctx.items, { ...matchBase, includeAsas: false, includeAntrepo: true, presetAsasOrdersByTarget: preset });
  for (let round = 0; round < args.tekrar; round++) {
    const order = !args.aday ? ['current'] : (round % 2 === 0 ? ['current', 'candidate'] : ['candidate', 'current']);
    for (const variant of order) {
      const label = `${variant === 'current' ? 'IAS mevcut sorgu' : 'IAS aday sorgu (RELATED)'} · tur ${round + 1}/${args.tekrar}`;
      const step = variant === 'current'
        ? await tracer.phase(label, log, iasRun)
        : await withPatched(bl.modelHorizon, 'buildFactRowQuery', original => (...a) => {
          const built = original(...a);
          return { ...built, query: toRelatedQuery(built.query) };
        }, () => tracer.phase(label, log, iasRun));
      // IAS ham satırları mevcut ⇄ aday ham karşılaştırması için tutulur.
      settle(step, out.ias[variant], value => slimTargets(value, cctx));
    }
  }

  // 3) ASAS tek başına: kumaşlı ⇄ kumaşsız.
  if (args.kumas === 'ikisi') {
    const asasRun = items => () => load(items, { ...matchBase, includeAsas: true, includeAntrepo: false });
    const noFabricItems = withoutFabric(ctx.items);
    for (let round = 0; round < args.tekrar; round++) {
      const order = round % 2 === 0 ? ['fabric', 'noFabric'] : ['noFabric', 'fabric'];
      for (const variant of order) {
        const label = `${variant === 'fabric' ? 'ASAS kumaşlı' : 'ASAS kumaşsız'} · tur ${round + 1}/${args.tekrar}`;
        const step = variant === 'fabric'
          ? await tracer.phase(label, log, asasRun(ctx.items))
          : await withPatched(bl.modelFields, 'missingRequired', original => (role, mapping) => {
            const missing = original(role, mapping);
            return role === 'asas' ? missing.filter(header => !FABRIC_HEADERS.includes(header)) : missing;
          }, () => tracer.phase(label, log, asasRun(noFabricItems)));
        settle(step, out.asas[variant], value => {
          if (variant === 'noFabric') {
            const rows = runsOf(value, 'asas').flatMap(run => run.rows || []);
            if (rows.length) time(`ASAS ayrıştırma (kumaşsız, ${rows.length} satır)`, () => { bl.parse.parseASASRows(rows, ctx.matchRule); });
          }
          stripRows(value);
          slimTargets(value, cctx);
        });
      }
    }
  }

  // Varyantların gerçekten farklı sorgu ürettiğini doğrula; aynı sorguyu iki kez
  // ölçüp "fark yok" demek yanıltıcı olur.
  const queriesOf = (prefix, role) => captured.filter(q => q.run.startsWith(prefix) && q.role === role).map(q => q.query);
  if (args.aday) {
    const cand = queriesOf('IAS aday', 'antrepo'), curr = queriesOf('IAS mevcut', 'antrepo');
    if (cand.length && !cand.some(q => q.includes('RELATED('))) out.variantProblems.push({ id: 'ias-aday', message: 'Mevcut IAS sorgusunda dönüştürülecek SELECTEDVALUE ifadesi yok; aday mevcutla aynı sorgu. Ölçüm anlamsız.' });
    if (cand.length && curr.length && cand.every(q => curr.includes(q))) out.variantProblems.push({ id: 'ias-aday', message: 'Aday sorgu mevcutla birebir aynı; RELATED dönüşümü uygulanmadı.' });
  }
  if (args.kumas === 'ikisi') {
    const refs = fabricColumnRefs(ctx.items);
    const withF = queriesOf('ASAS kumaşlı', 'asas'), withoutF = queriesOf('ASAS kumaşsız', 'asas');
    if (!refs.length || !withF.some(q => refs.some(ref => q.includes(ref)))) out.variantProblems.push({ id: 'kumas', message: 'Kumaş alanları ASAS sorgusunda zaten yok; kumaş ölçümü yapılamaz.' });
    else if (withoutF.some(q => refs.some(ref => q.includes(ref)))) out.variantProblems.push({ id: 'kumas', message: 'Kumaşsız varyant sorgusunda kumaş sütunu kaldı (BL alan eşlemesini otomatik onardı). Kumaş ölçümü GEÇERSİZ.' });
  }
  return out;
}

/* ------------------------------- karşılaştırma ------------------------------- */

function verdictOf(flags) {
  if (flags.error) return 'HATA';
  if (flags.invalid) return 'GEÇERSİZ';
  if (flags.skipped) return 'ATLANDI';
  if (flags.fail) return 'BAŞARISIZ';
  if (flags.warn) return 'UYARI';
  return 'GEÇTİ';
}
function runsByRole(result, role) {
  return (result && Array.isArray(result.runs) ? result.runs : [])
    .filter(run => run && run.item && (role === 'all' || (role === 'antrepo' ? run.item.role === 'antrepo' : run.item.role !== 'antrepo')));
}
function restrictIasToOrders(map, orderSets, cctx) {
  const lineKey = entry => ['ocode', 'model', 'ccode'].map(f => cctx.canon(entry[f])).join('\u0000');
  const lines = new Set();
  for (const orders of orderSets) for (const order of orders || []) lines.add(lineKey(order));
  const out = Object.create(null);
  let dropped = 0;
  for (const [key, entry] of Object.entries(map || {})) { if (lines.has(lineKey(entry))) out[key] = entry; else dropped += 1; }
  return { map: out, dropped };
}
function targetGroups(result, cctx) {
  const groups = new Map();
  for (const target of MATCH_TARGETS) {
    const orders = result.asasOrdersByTarget && result.asasOrdersByTarget[target];
    if (!Array.isArray(orders)) continue;
    const map = result.antrepoMapByTarget && result.antrepoMapByTarget[target];
    const fp = `${cmp.ordersFingerprint(orders, cctx)}:${map ? cmp.iasFingerprint(map, cctx) : '-'}`;
    if (!groups.has(fp)) groups.set(fp, { targets: [], target });
    groups.get(fp).targets.push(target);
  }
  return [...groups.values()];
}

function buildComparisons(bl, ctx, args, excel, db) {
  const cctx = { parseLib: bl.parse, rule: ctx.matchRule, canon: cmp.createCanon(bl.parse) };
  const checks = [];
  const csv = {};
  const addCsv = (name, header, rows) => { if (rows.length) csv[name] = [header, ...rows]; };
  const full = db.full && db.full.ok ? db.full.value : null;
  const firstOk = list => (list || []).find(step => step && step.ok && step.value);
  const problemFor = id => db.variantProblems.filter(p => p.id === id).map(p => p.message);

  // A) IAS mevcut ⇄ aday (sıfır tolerans)
  if (args.aday) {
    const current = firstOk(db.ias.current), candidate = firstOk(db.ias.candidate);
    const failed = (db.ias.candidate || []).find(step => !step.ok);
    if (!full) checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu', verdict: 'HATA', lines: ['BL yenilemesi tamamlanamadı.'] });
    else if (problemFor('ias-aday').length) checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu', verdict: 'GEÇERSİZ', lines: problemFor('ias-aday') });
    else if (!current || !candidate) {
      const message = failed ? failed.error : 'IAS sorgusu çalışmadı.';
      checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu (RELATED)', verdict: 'HATA', lines: [
        `Aday sorgu çalışmadı: ${message}`,
        ...(/RELATED|relationship|ilişki/i.test(message) ? ['IAS modelindeki ilişki çoka-bir değil; RELATED bu modelde uygulanamaz.'] : []),
      ] });
    } else {
      const raw = cmp.compareRawRows(runsByRole(current.value, 'antrepo').flatMap(r => r.rows || []), runsByRole(candidate.value, 'antrepo').flatMap(r => r.rows || []), cctx);
      let fail = !raw.identical;
      const lines = [`Ham satır: mevcut ${raw.referenceRows} · aday ${raw.candidateRows} · yalnız mevcutta ${raw.onlyReference.length} · yalnız adayda ${raw.onlyCandidate.length}`];
      addCsv('ias-mevcut-aday-ham-satir.csv', ['taraf', 'adet', 'satır'], [
        ...raw.onlyReference.map(item => ['yalnız mevcut', item.count, item.row]),
        ...raw.onlyCandidate.map(item => ['yalnız aday', item.count, item.row]),
      ]);
      for (const target of MATCH_TARGETS) {
        const a = current.value.antrepoMapByTarget && current.value.antrepoMapByTarget[target];
        const b = candidate.value.antrepoMapByTarget && candidate.value.antrepoMapByTarget[target];
        if (!a && !b) continue;
        const ias = cmp.compareIas(a, b, cctx, { strict: true });
        const orders = full.asasOrdersByTarget[target] || [];
        const match = cmp.compareMatches(cmp.matchSummary(orders, a, cctx), cmp.matchSummary(orders, b, cctx), cctx);
        const n = ias.detail.missing.length + ias.detail.extra.length + ias.detail.qtyDiffs.length + ias.detail.rowDiffs.length;
        if (n || match.diffs.length) fail = true;
        lines.push(`${TARGET_LABELS[target]}: parsiyel ${ias.referenceRows} ⇄ ${ias.candidateRows}, kimlik/adet farkı ${n}, eşleştirme farkı ${match.diffs.length} (${match.compared} sipariş)`);
        addCsv(`ias-mevcut-aday-eslestirme-${target}.csv`, ['sipariş', 'alan', 'mevcut', 'aday'], match.diffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]));
      }
      const prints = (db.ias.current || []).filter(s => s.ok).map(s => s.fp);
      const unstable = new Set(prints).size > 1;
      if (unstable) lines.push('DİKKAT: Mevcut IAS sorgusu turlar arasında farklı veri döndürdü; model test sırasında güncelleniyor olabilir.');
      checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu (RELATED)', verdict: verdictOf({ fail, warn: unstable }), lines });
    }
  }

  // B) ASAS kumaşlı ⇄ kumaşsız (kumaş dışı alanlar)
  if (args.kumas === 'ikisi') {
    const a = firstOk(db.asas.fabric), b = firstOk(db.asas.noFabric);
    if (problemFor('kumas').length) checks.push({ id: 'kumas', title: 'ASAS kumaşlı ⇄ kumaşsız', verdict: 'GEÇERSİZ', lines: problemFor('kumas') });
    else if (!a || !b) {
      const error = [...db.asas.fabric, ...db.asas.noFabric].find(step => step && !step.ok);
      checks.push({ id: 'kumas', title: 'ASAS kumaşlı ⇄ kumaşsız', verdict: 'HATA', lines: [`Sorgu çalışmadı: ${error ? error.error : 'bilinmiyor'}`] });
    } else {
      let fail = false;
      const lines = [];
      for (const target of MATCH_TARGETS) {
        const x = a.value.asasOrdersByTarget[target], y = b.value.asasOrdersByTarget[target];
        if (!x && !y) continue;
        const r = cmp.compareOrders(x, y, cctx, { strict: true, ignoreFields: cmp.FABRIC_ORDER_FIELDS });
        const n = r.missing.length + r.extra.length + r.valueDiffs.length + r.multiplicity.length;
        if (n) fail = true;
        lines.push(`${TARGET_LABELS[target]}: sipariş ${r.referenceCount} ⇄ ${r.candidateCount}, kumaş dışı değer farkı ${r.valueDiffs.length}, eksik ${r.missing.length}, fazla ${r.extra.length}`);
        if (Object.keys(r.fieldDiffCounts).length) lines.push(`  Farklı alanlar: ${Object.entries(r.fieldDiffCounts).map(([f, c]) => `${f}=${c}`).join(', ')}`);
        addCsv(`kumas-etkisi-${target}.csv`, ['sipariş', 'alan', 'kumaşlı', 'kumaşsız'], [
          ...r.valueDiffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]),
          ...r.missing.map(d => [cmp.displayKey(d.key), '(sipariş)', 'var', 'YOK']),
          ...r.extra.map(d => [cmp.displayKey(d.key), '(sipariş)', 'YOK', 'var']),
        ]);
      }
      if (fail) lines.push('Kumaş alanları sipariş verisini (satır evreni / miktar) etkiliyor. Kumaşı ASAS sorgusundan çıkarmak bu haliyle GÜVENLİ DEĞİL.');
      checks.push({ id: 'kumas', title: 'ASAS kumaşlı ⇄ kumaşsız (kumaş dışı alanlar)', verdict: verdictOf({ fail }), lines });
    }
  }

  // C) Excel ⇄ Database (Excel = doğruluk referansı)
  if (!excel.enabled) checks.push({ id: 'excel', title: 'Excel ⇄ Database', verdict: 'ATLANDI', lines: ['Excel adımı kapalı.'] });
  else if (!excel.valid || !full) checks.push({ id: 'excel', title: 'Excel ⇄ Database', verdict: excel.valid ? 'HATA' : 'GEÇERSİZ', lines: [...excel.problems, ...(!full ? ['BL Database yenilemesi tamamlanamadı.'] : [])] });
  else {
    const candidate = args.aday && !problemFor('ias-aday').length ? firstOk(db.ias.candidate) : null;
    for (const group of targetGroups(full, cctx)) {
      const target = group.target;
      const label = group.targets.map(t => TARGET_LABELS[t]).join(' / ');
      const dbOrders = full.asasOrdersByTarget[target] || [];
      const asas = cmp.compareOrders(excel.orders, dbOrders, cctx, { strict: false });
      const lines = [
        `Sipariş satırı: Excel ${asas.referenceCount} · DB ${asas.candidateCount}`,
        `Excel'de olup DB'de olmayan: ${asas.missing.length} · DB'de olup Excel'de olmayan: ${asas.extra.length} · değer farkı: ${asas.valueDiffs.length}`,
        `Toplam Net Alım: Excel ${asas.totals.qty.reference} · DB ${asas.totals.qty.candidate}`,
      ];
      if (Object.keys(asas.fieldDiffCounts).length) lines.push(`Farklı alanlar: ${Object.entries(asas.fieldDiffCounts).map(([f, c]) => `${f}=${c}`).join(', ')}`);
      if (asas.coverage.length) lines.push(`Kapsam notu (alan yalnız bir kaynakta dolu): ${asas.coverage.map(c => `${c.field} (${c.onlyIn === 'reference' ? 'yalnız Excel' : 'yalnız DB'})`).join(', ')}`);
      if (asas.extra.length) lines.push('DB fazlası çoğunlukla ufuk/kapsam farkıdır (Excel raporunun filtresi ≠ BL Data Source and Filters).');
      checks.push({ id: `excel-asas-${target}`, title: `Excel ⇄ DB · ASAS siparişleri · ${label}`,
        verdict: verdictOf({ fail: asas.missing.length > 0 || asas.valueDiffs.length > 0, warn: asas.extra.length > 0 || asas.coverage.length > 0 || asas.multiplicity.length > 0 }), lines });
      addCsv(`excel-db-asas-${target}.csv`, ['tür', 'sipariş', 'alan', 'Excel', 'DB', 'sezon'], [
        ...asas.missing.map(d => ['EXCEL VAR / DB YOK', cmp.displayKey(d.key), '', '', '', d.order && d.order.season || '']),
        ...asas.valueDiffs.map(d => ['DEĞER FARKI', cmp.displayKey(d.key), d.field, d.reference, d.candidate, '']),
        ...asas.extra.map(d => ['DB VAR / EXCEL YOK', cmp.displayKey(d.key), '', '', '', d.order && d.order.season || '']),
        ...asas.multiplicity.map(d => ['SATIR SAYISI', cmp.displayKey(d.key), '', d.reference, d.candidate, '']),
      ]);

      const orderSets = [excel.orders, dbOrders];
      const excelIas = restrictIasToOrders(excel.antrepoMap, orderSets, cctx);
      const variants = [['mevcut', full.antrepoMapByTarget && full.antrepoMapByTarget[target]]];
      if (candidate) variants.push(['aday', candidate.value.antrepoMapByTarget && candidate.value.antrepoMapByTarget[target]]);
      for (const [variant, map] of variants) {
        if (!map) continue;
        const dbIas = restrictIasToOrders(map, orderSets, cctx);
        const ias = cmp.compareIas(excelIas.map, dbIas.map, cctx, { strict: false });
        checks.push({ id: `excel-ias-${variant}-${target}`, title: `Excel ⇄ DB ${variant} · IAS parsiyelleri · ${label}`,
          verdict: verdictOf({
            fail: ias.line.missing.length > 0 || ias.line.qtyDiffs.length > 0 || ias.detail.missing.length > 0 || ias.detail.qtyDiffs.length > 0,
            warn: ias.line.extra.length > 0 || ias.detail.extra.length > 0 || ias.coverage.length > 0,
          }),
          lines: [
            `İlgili parsiyel (ASAS siparişleriyle eşleşebilen): Excel ${ias.referenceRows} · DB ${ias.candidateRows} (ilgisiz: Excel ${excelIas.dropped}, DB ${dbIas.dropped})`,
            `Toplam Yükleme Adet: Excel ${ias.totals.loadedQty.reference} · DB ${ias.totals.loadedQty.candidate}`,
            `Sipariş+Model+Renk: Excel'de olup DB'de olmayan ${ias.line.missing.length} · adet farkı ${ias.line.qtyDiffs.length} · DB fazlası ${ias.line.extra.length}`,
            `Parsiyel (ortak alanlar: ${ias.identityFields.join(', ')}): eksik ${ias.detail.missing.length} · adet farkı ${ias.detail.qtyDiffs.length} · fazla ${ias.detail.extra.length}`,
            ...(ias.coverage.length ? [`Kapsam notu: ${ias.coverage.map(c => `${c.field} (${c.onlyIn === 'reference' ? 'yalnız Excel' : 'yalnız DB'})`).join(', ')}`] : []),
          ] });
        const fmt = item => item.key.split('\u0000').join(' | ');
        addCsv(`excel-db-ias-${variant}-${target}.csv`, ['düzey', 'tür', 'kimlik', 'Excel adet', 'DB adet', 'Excel satır', 'DB satır'], [
          ...ias.line.missing.map(d => ['sipariş-model-renk', 'EXCEL VAR / DB YOK', fmt(d), d.sums.loadedQty, '', d.rows, '']),
          ...ias.line.qtyDiffs.map(d => ['sipariş-model-renk', 'ADET FARKI', fmt(d), d.reference, d.candidate, '', '']),
          ...ias.line.extra.map(d => ['sipariş-model-renk', 'DB VAR / EXCEL YOK', fmt(d), '', d.sums.loadedQty, '', d.rows]),
          ...ias.detail.missing.map(d => ['parsiyel', 'EXCEL VAR / DB YOK', fmt(d), d.sums.loadedQty, '', d.rows, '']),
          ...ias.detail.qtyDiffs.map(d => ['parsiyel', 'ADET FARKI', fmt(d), d.reference, d.candidate, '', '']),
          ...ias.detail.extra.map(d => ['parsiyel', 'DB VAR / EXCEL YOK', fmt(d), '', d.sums.loadedQty, '', d.rows]),
        ]);
        const match = cmp.compareMatches(cmp.matchSummary(excel.orders, excel.antrepoMap, cctx), cmp.matchSummary(dbOrders, map, cctx), cctx);
        checks.push({ id: `excel-eslesme-${variant}-${target}`, title: `Excel ⇄ DB ${variant} · ASAS-IAS eşleştirme sonucu · ${label}`,
          verdict: verdictOf({ fail: match.diffs.length > 0 }),
          lines: [
            `Ortak sipariş: ${match.compared} · farklı sonuç: ${new Set(match.diffs.map(d => d.key)).size}`,
            `Excel: ${match.referenceStats.matched}/${match.referenceStats.orders} eşleşti (çoklu parsiyel ${match.referenceStats.ambiguous}) · DB: ${match.candidateStats.matched}/${match.candidateStats.orders} (çoklu ${match.candidateStats.ambiguous})`,
          ] });
        addCsv(`excel-db-eslesme-${variant}-${target}.csv`, ['sipariş', 'alan', 'Excel', 'DB'], match.diffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]));
      }
    }
  }
  return { checks, csv };
}

/* ------------------------------- performans ------------------------------- */

function runQueryEvents(tracer, runPrefix, role) {
  return tracer.events.filter(e => e.type === 'model-query' && e.run.startsWith(runPrefix) && (!role || e.role === role));
}
function sumBy(list, key) { return list.reduce((acc, e) => acc + (Number(e[key]) || 0), 0); }

function performanceReport(report, tracer, db, excel, probes) {
  const L = [];
  const line = (text = '') => L.push(text);
  line('BUYER LOG — YENİLEME HIZ GÜNLÜĞÜ');
  line('='.repeat(76));
  line(`Ham olay günlüğü: olaylar.jsonl (her sorgu/aşama zaman damgalı). Sorgular: sorgular\\*.dax`);
  line('');

  line('1) BL\'IN KENDİ KAYDETTİĞİ SON GERÇEK YENİLEMELER (toplam süre; aşama kırılımı BL\'da tutulmuyor)');
  line('-'.repeat(76));
  if (!report.blHistory.length) line('   Kayıt bulunamadı.');
  else {
    for (const h of report.blHistory.slice(-8)) line(`   ${h.at} · ${seconds(h.durationMs)} · hedefler: ${(h.targets || []).join(',') || '-'} · kaynak: ASAS=${h.sourceModes.asas || '-'} IAS=${h.sourceModes.antrepo || '-'}`);
    line(`   Medyan: ${seconds(median(report.blHistory.map(h => h.durationMs)))}`);
  }
  line('');

  line('2) BU ARAÇTA ÖLÇÜLEN BL VERİ KATMANI (ASAS + IAS paralel; BL\'daki çağrının aynısı)');
  line('-'.repeat(76));
  const full = db.full;
  if (full) {
    line(`   Uçtan uca: ${seconds(full.ms)}${full.ok ? '' : ` (HATA: ${full.error})`}`);
    for (const role of ['asas', 'antrepo']) {
      const qs = runQueryEvents(tracer, 'BL yenilemesi', role);
      if (!qs.length) continue;
      const label = role === 'asas' ? 'ASAS' : 'IAS';
      // Pay paydası: ölçülen yol ile bileşen toplamının büyüğü (oran %100'ü aşmasın).
      const total = Math.max(sumBy(qs, 'ms'), sumBy(qs, 'setupMs') + sumBy(qs, 'connectionOpenMs') + sumBy(qs, 'executeMs') + sumBy(qs, 'writeMs') + sumBy(qs, 'parseMs') + sumBy(qs, 'retryMs'));
      line(`   ${label}: ${qs.length} sorgu · ${sumBy(qs, 'rows')} satır · sorgu yolu ${seconds(total)}`);
      line(`      sunucu (SSAS yürütme) ${seconds(sumBy(qs, 'executeMs'))} ${pct(sumBy(qs, 'executeMs'), total)} · bağlantı ${seconds(sumBy(qs, 'connectionOpenMs'))} · sonuç yazma ${seconds(sumBy(qs, 'writeMs'))} ${pct(sumBy(qs, 'writeMs'), total)} · Node ayrıştırma ${seconds(sumBy(qs, 'parseMs'))} · PowerShell hazırlık ${seconds(sumBy(qs, 'setupMs'))} · tekrar ${seconds(sumBy(qs, 'retryMs'))}`);
    }
    const schema = tracer.events.filter(e => e.type === 'schema-discovery' && e.run.startsWith('BL yenilemesi'));
    if (schema.length) line(`   Şema okuma: ${schema.length} çağrı · ${seconds(sumBy(schema, 'ms'))} (BL 10 dk önbellekler)`);
    const longest = Math.max(0, ...['asas', 'antrepo'].map(role => sumBy(runQueryEvents(tracer, 'BL yenilemesi', role), 'ms')));
    if (full.ok) line(`   Sorgu dışı (eşleştirme, bütünlük denetimi, LFL, şema) ≈ ${seconds(Math.max(0, full.ms - longest))} — paralel en uzun sorgu yolundan sonra kalan`);
  }
  const blMedian = median(report.blHistory.map(h => h.durationMs));
  if (blMedian && full && full.ok) line(`   BL gerçek yenileme medyanı ${seconds(blMedian)} − veri katmanı ${seconds(full.ms)} ≈ ${seconds(Math.max(0, blMedian - full.ms))}: BL'ın veri sonrası işleri (snapshot kaydı, fark/geçmiş, hesap yayını, ekran) için kalan pay (yaklaşık; farklı zamanlarda ölçüldü)`);
  line('');

  line('3) TEK BAŞINA ÖLÇÜMLER (medyan)');
  line('-'.repeat(76));
  const row = (label, steps, prefix, role) => {
    const ok = (steps || []).filter(s => s && s.ok);
    if (!(steps || []).length) return null;
    const runs = ok.map(s => runQueryEvents(tracer, s.run, role));
    const m = key => median(runs.map(qs => sumBy(qs, key)));
    const out = { label, n: ok.length, failed: steps.length - ok.length, wall: median(ok.map(s => s.ms)), server: m('executeMs'), write: m('writeMs'), parse: m('parseMs'), rows: runs.length ? sumBy(runs[0], 'rows') : null, samples: ok.map(s => s.ms) };
    line(`   ${label}: toplam ${seconds(out.wall)} · sunucu ${seconds(out.server)} · yazma ${seconds(out.write)} · ayrıştırma ${seconds(out.parse)} · satır ${out.rows == null ? '-' : out.rows} · koşu ${out.n}${out.failed ? ` (+${out.failed} hatalı)` : ''}${out.samples.length > 1 ? ` · örnekler ${out.samples.map(seconds).join(', ')}` : ''}`);
    return out;
  };
  const iasCur = row('IAS mevcut', db.ias.current, '', 'antrepo');
  const iasCand = row('IAS aday (RELATED)', db.ias.candidate, '', 'antrepo');
  const asasF = row('ASAS kumaşlı', db.asas.fabric, '', 'asas');
  const asasNF = row('ASAS kumaşsız', db.asas.noFabric, '', 'asas');
  if (excel && excel.enabled) {
    for (const [kind, r] of Object.entries(excel.refresh || {})) line(`   Excel pivot yenileme · ${kind.toUpperCase()}: ${r.ok ? seconds(r.ms) : `HATA (${r.error})`}`);
    if (excel.parse) line(`   Excel okuma: ASAS ${seconds(excel.parse.asasMs)} · Antrepo ${seconds(excel.parse.antrepoMs)}`);
  }
  if (report.tekrar < 3) line('   Not: Güvenilir süre farkı için --tekrar 3 önerilir (SSAS önbelleği ve anlık sunucu yükü).');
  line('');

  line('4) NODE TARAFI CPU MALİYETİ (aynı satırlar BL fonksiyonlarıyla yeniden işlendi)');
  line('-'.repeat(76));
  if (!probes.length) line('   Ölçüm yok.');
  for (const p of probes) line(`   ${p.label}: ${(p.ms / 1000).toFixed(2)} sn`);
  line('');

  line('5) KUMAŞ ETKİSİ (ASAS kumaş alanları + Ana Kumaş eşlemesi kaldırılırsa)');
  line('-'.repeat(76));
  const fabricCheck = report.checks.find(c => c.id === 'kumas');
  if (asasF && asasNF && asasF.wall && asasNF.wall) {
    const factor = asasNF.rows ? (asasF.rows / asasNF.rows) : null;
    line(`   Satır: kumaşlı ${asasF.rows} · kumaşsız ${asasNF.rows}${factor ? ` → kumaş satırları ${factor.toFixed(2)} kat çoğaltıyor` : ''}`);
    line(`   Toplam: ${seconds(asasF.wall)} → ${seconds(asasNF.wall)} · kazanç ${seconds(asasF.wall - asasNF.wall)} (${pct(asasF.wall - asasNF.wall, asasF.wall)})`);
    line(`   Sunucu: ${seconds(asasF.server)} → ${seconds(asasNF.server)} · yazma: ${seconds(asasF.write)} → ${seconds(asasNF.write)} · ayrıştırma: ${seconds(asasF.parse)} → ${seconds(asasNF.parse)}`);
    const pf = probes.find(p => p.label.startsWith('ASAS ayrıştırma (kumaşlı')), pn = probes.find(p => p.label.startsWith('ASAS ayrıştırma (kumaşsız'));
    if (pf && pn) line(`   BL sipariş ayrıştırma + Ana Kumaş eşlemesi: ${(pf.ms / 1000).toFixed(2)} sn → ${(pn.ms / 1000).toFixed(2)} sn`);
    if (full && full.ok) {
      const iasPath = sumBy(runQueryEvents(tracer, 'BL yenilemesi', 'antrepo'), 'ms');
      const asasPath = sumBy(runQueryEvents(tracer, 'BL yenilemesi', 'asas'), 'ms');
      line(`   Not: BL'da ASAS ve IAS paralel çalışır. Bu koşuda ASAS yolu ${seconds(asasPath)}, IAS yolu ${seconds(iasPath)}. Toplam yenilemeyi uzun olan belirler;`);
      line(`        ${asasPath >= iasPath ? 'ASAS kısalırsa toplam süre kısalır.' : 'IAS daha uzun olduğu için ASAS kazancı tek başına toplam süreyi kısaltmayabilir.'}`);
    }
  } else line('   Ölçülmedi (kumas=dahil ya da varyant çalışmadı).');
  if (fabricCheck) line(`   Veri eşitliği: ${fabricCheck.verdict}`);
  line('');

  line('6) IAS ADAY SORGU (RELATED)');
  line('-'.repeat(76));
  if (iasCur && iasCand && iasCur.wall && iasCand.wall) line(`   ${seconds(iasCur.wall)} → ${seconds(iasCand.wall)} · fark ${seconds(iasCur.wall - iasCand.wall)} (${pct(iasCur.wall - iasCand.wall, iasCur.wall)}) · sunucu ${seconds(iasCur.server)} → ${seconds(iasCand.server)}`);
  else line('   Ölçülmedi.');
  const iasCheck = report.checks.find(c => c.id === 'ias-aday');
  if (iasCheck) line(`   Veri eşitliği: ${iasCheck.verdict}`);
  line('');
  line('Bu dosyayı (veri içeren CSV\'ler olmadan) Claude ile birlikte inceleyin; hangi kalemin süreyi taşıdığını gösterir.');
  return L.join('\r\n');
}

/* BL'ın describeHorizon'u yalnız koşul gruplarını anlatır; eski sezon / tarih
   ufku da görünsün diye uygulanan ham ufuktan tamamlanır. */
function describeAppliedHorizon(described, raw) {
  if (described && described.text) return described.text;
  const h = raw && typeof raw === 'object' ? raw : {};
  const parts = [];
  if (Array.isArray(h.seasons) && h.seasons.length) parts.push(`${h.seasonField || 'Sezon'}: ${h.seasons.join(', ')}`);
  if (h.dateStart || h.dateEnd) parts.push(`${h.dateField || 'Tarih'}: ${h.dateStart || '…'} – ${h.dateEnd || '…'}`);
  return parts.join(' VEYA ');
}

/* --------------------------------- yazım --------------------------------- */

function csvText(rows) {
  const cell = value => { const text = value == null ? '' : String(value); return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

function accuracyReport(report) {
  const L = [];
  const line = (text = '') => L.push(text);
  line('BUYER LOG — KAYNAK DOĞRULAMA RAPORU (ASAS / IAS / EXCEL)');
  line('='.repeat(76));
  line(`Tarih            : ${report.startedAt}`);
  line(`Araç sürümü      : ${TOOL_VERSION}`);
  line(`Buyer Log        : ${report.blVersion} · çekirdek: ${report.coreSource}`);
  line(`Kullanıcı        : ${report.user}`);
  line(`Kaynak klasör    : ${report.sourceFolder || '(seçili değil)'}`);
  line(`Seçenekler       : kumaş=${report.kumas} · aday=${report.aday ? 'evet' : 'hayır'} · tekrar=${report.tekrar}`);
  line(`BL kaynak modları: ASAS=${report.sourceModes.asas}, Antrepo=${report.sourceModes.antrepo}, LFL=${report.sourceModes.lfl} (araç ASAS ve IAS'ı her durumda Database'den çeker)`);
  for (const c of report.connections) line(`Bağlantı         : ${c.role === 'antrepo' ? 'IAS ' : 'ASAS'} · ${c.name || c.id} · ${c.catalog}`);
  for (const s of report.horizons) line(`Kullanılan ufuk  : ${s.target} · ${s.connection} · ${s.text || '(sınırsız)'}`);
  line('Not: Rol / atanmış varsayılan ufuklar (Kullanıcı Yönetimi) kimlik deposuna dokunmamak için okunmaz;');
  line('     yukarıdaki ufku BL ekranındaki ufuk rozetiyle karşılaştırın.');
  line('');
  line(`GENEL SONUÇ: ${report.overall}`);
  line('-'.repeat(76));
  for (const check of report.checks) line(`[${check.verdict.padEnd(9)}] ${check.title}`);
  line('');
  line('AYRINTILAR');
  line('-'.repeat(76));
  for (const check of report.checks) {
    line(`[${check.verdict}] ${check.title}`);
    for (const text of check.lines || []) line(`   ${text}`);
    line('');
  }
  if (report.warnings.length) {
    line('BL MOTORU UYARILARI');
    line('-'.repeat(76));
    for (const warning of report.warnings.slice(0, 60)) line(` - ${warning}`);
    if (report.warnings.length > 60) line(` ... +${report.warnings.length - 60} (ozet.json)`);
    line('');
  }
  line('DOSYALAR: performans.txt · olaylar.jsonl · sorgular\\*.dax · excel-kopyalari\\ · ' + (Object.keys(report.csvFiles).join(' · ') || '(fark CSV yok)'));
  line('Bu klasör iş verisi içerir; yalnız bu bilgisayarda tutulur, hiçbir yere gönderilmez.');
  return L.join('\r\n');
}

function writeOutputs(outDir, report, tracer, db, perfText) {
  fs.mkdirSync(outDir, { recursive: true });
  const text = accuracyReport(report);
  fs.writeFileSync(path.join(outDir, 'rapor.txt'), '﻿' + text, 'utf8');
  fs.writeFileSync(path.join(outDir, 'performans.txt'), '﻿' + perfText, 'utf8');
  fs.writeFileSync(path.join(outDir, 'olaylar.jsonl'), tracer.events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  for (const [name, rows] of Object.entries(report.csvRows)) fs.writeFileSync(path.join(outDir, name), csvText(rows), 'utf8');
  const qdir = path.join(outDir, 'sorgular');
  const seen = new Map();
  for (const q of db.captured) {
    const base = `${q.run.split(' · tur')[0]} ${q.role === 'antrepo' ? 'IAS' : 'ASAS'}`.replace(/[^0-9A-Za-zÇĞİÖŞÜçğıöşü]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    if ([...seen.values()].includes(q.query)) continue;
    const n = [...seen.keys()].filter(k => k.startsWith(base)).length + 1;
    seen.set(`${base}-${n}`, q.query);
    fs.mkdirSync(qdir, { recursive: true });
    fs.writeFileSync(path.join(qdir, `${base}-${n}.dax`), q.query, 'utf8');
  }
  const { csvRows, ...json } = report;
  fs.writeFileSync(path.join(outDir, 'ozet.json'), JSON.stringify(json, null, 2), 'utf8');
  return text;
}

/* ---------------------------------- ana ---------------------------------- */

async function main(argv, deps = {}) {
  const log = deps.log || (text => console.log(text));
  let args;
  try { args = parseArgs(argv); } catch (error) { log(`[HATA] ${error.message}`); return 2; }
  if (args.help) { log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 32).join('\n')); return 0; }
  const root = path.resolve(args.root || process.cwd());
  let coreInfo, bl, ctx, paths = null;
  try {
    coreInfo = args.core ? { core: path.resolve(args.core), version: coreVersion(path.resolve(args.core)), source: 'elle verilen çekirdek' } : resolveActiveCore(root);
    if (!deps.skipEnvironment) paths = setupEnvironment(root, coreInfo.core);
    bl = loadBl(coreInfo.core);
    ctx = loadContext(bl, args);
  } catch (error) { log(`[HATA] ${error.message}`); return 2; }
  if (!ctx.connections.some(c => c.role === 'asas')) { log('[HATA] Refresh için aktif ASAS bağlantısı yok (Data Model Connection).'); return 2; }
  if (!ctx.connections.some(c => c.role === 'antrepo')) { log('[HATA] Refresh için aktif IAS bağlantısı yok (Data Model Connection).'); return 2; }

  const startedAt = new Date();
  const outDir = args.cikti ? path.resolve(args.cikti) : path.join(root, 'Kaynak-Dogrulama-Raporlari', startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(outDir, { recursive: true });
  log(`Buyer Log ${coreInfo.version} (${coreInfo.source}) · kullanıcı ${args.user}`);
  log(`Rapor klasörü: ${outDir}`);
  const tracer = createTracer();
  tracer.add({ type: 'context', blVersion: coreInfo.version, core: coreInfo.core, toolVersion: TOOL_VERSION, connections: ctx.connections.map(c => ({ role: c.role, catalog: c.catalog })) });

  const excel = args.excel ? await excelStep(bl, ctx, outDir, log, tracer, deps, coreInfo.core) : { enabled: false, problems: [] };
  const db = await databaseSteps(bl, ctx, args, log, tracer, deps);
  const probes = db.probes || [];
  if (typeof deps.inspect === 'function') deps.inspect({ db });

  const { checks, csv } = buildComparisons(bl, ctx, args, excel, db);
  if (db.full && !db.full.ok) checks.unshift({ id: 'bl-yenileme', title: 'BL Database yenilemesi', verdict: 'HATA', lines: [db.full.error] });
  const verdicts = checks.map(c => c.verdict);
  const overall = verdicts.includes('HATA') || verdicts.includes('GEÇERSİZ') ? 'TAMAMLANAMADI (ayrıntılara bakın)'
    : verdicts.includes('BAŞARISIZ') ? 'BAŞARISIZ — veri farkı var'
      : verdicts.includes('UYARI') ? 'GEÇTİ (uyarılarla)' : 'GEÇTİ';
  const localDataRoot = paths ? paths.localDataRoot : (bl.userData.LOCAL_DATA_ROOT || '');
  const report = {
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), toolVersion: TOOL_VERSION,
    blVersion: coreInfo.version, coreSource: coreInfo.source, user: args.user, kumas: args.kumas, aday: args.aday, tekrar: args.tekrar,
    sourceFolder: ctx.sourceFolder, sourceModes: ctx.sourceModes, connections: ctx.connections,
    horizons: db.full && db.full.ok ? (db.full.value.scopes || []).map(s => ({
      target: TARGET_LABELS[s.target] || s.target, connection: s.connection, rowCount: s.rowCount,
      text: describeAppliedHorizon(s.horizon, db.full.value.appliedHorizons && db.full.value.appliedHorizons[s.target]),
    })) : [],
    overall, checks, warnings: db.full && db.full.ok ? (db.full.value.warnings || []).map(String) : [],
    blHistory: readBlRefreshHistory(localDataRoot),
    excel: excel.enabled ? { valid: excel.valid, files: excel.files, refresh: excel.refresh, parse: excel.parse, problems: excel.problems, antrepoMeta: excel.antrepoMeta } : { enabled: false },
    variantProblems: db.variantProblems, cpuProbes: probes,
    csvFiles: Object.fromEntries(Object.entries(csv).map(([name, rows]) => [name, rows.length - 1])),
    csvRows: csv,
  };
  const perfText = performanceReport(report, tracer, db, excel, probes);
  const text = writeOutputs(outDir, report, tracer, db, perfText);
  log('');
  log(text.split('\r\nAYRINTILAR')[0]);
  log('');
  log(perfText);
  log(`\nRapor klasörü: ${outDir}`);
  if (overall.startsWith('TAMAMLANAMADI')) return 2;
  if (overall.startsWith('BAŞARISIZ')) return 1;
  return 0;
}

module.exports = { main, parseArgs, resolveActiveCore, toRelatedQuery, withoutFabric, FABRIC_HEADERS, TOOL_VERSION };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`[HATA] Beklenmeyen hata: ${error && error.stack || error}`);
    process.exitCode = 2;
  });
}
