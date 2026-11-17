#!/usr/bin/env node
'use strict';

/*
 * BUYER LOG — KAYNAK DOĞRULAMA (ASAS / IAS / EXCEL PARITY)
 *
 * Amaç: Buyer Log'un ASAS ve IAS veri çekme + eşleştirme motorlarını, BL'ın
 * KENDİ modülleri ve KENDİ ayarlarıyla çalıştırıp üç sonucu birebir
 * karşılaştırmak:
 *
 *   1) EXCEL   — kaynak klasördeki en güncel asas*.xlsx / antrepo*.xlsx
 *                kopyalanır, pivotları BL'ın RefreshExcel.ps1'iyle gerçek
 *                Excel'de yenilenir ve BL'ın Excel ayrıştırıcısıyla okunur.
 *                DOĞRULUK REFERANSI budur.
 *   2) DB MEVCUT — BL'ın bugünkü Database yenilemesi (loadFromModelConnections).
 *   3) DB ADAY   — aynı yenileme, IAS sorgusunda RELATED() aday ifadesiyle.
 *
 * Ek olarak ASAS sorgusu kumaş alanlarıyla ve kumaşsız çalıştırılıp hem süre
 * hem sipariş verisi karşılaştırılır (--kumas).
 *
 * GÜVENLİK:
 *  - Buyer Log ayarları YALNIZ OKUNUR. Hiçbir BL store'una yazılmaz, runtime
 *    snapshot yayımlanmaz, bağlantı kaydı değişmez.
 *  - Excel kaynak dosyalarının KENDİSİ değiştirilmez; rapor klasörüne alınan
 *    kopyaları yenilenir. Excel süreci ayrı PID dosyasıyla izlenir, çalışan
 *    BL'ın Excel yenilemesine dokunulmaz.
 *  - Rapor iş verisi içerir ve yalnız bu bilgisayarda (BL klasörü altında)
 *    tutulur; hiçbir yere gönderilmez.
 *
 * Kullanım (Windows'ta normalde scripts/BuyerLog-Kaynak-Dogrulama.cmd çağırır):
 *   BuyerLog.exe (ELECTRON_RUN_AS_NODE=1) resources\app\scripts\source-parity-check.js
 *     --root "<BL klasörü>" [--user moderator] [--kumas ikisi|dahil|haric]
 *     [--tekrar 1] [--excel evet|hayir] [--cikti "<klasör>"]
 *
 * Çıkış kodu: 0 = bütün kontroller GEÇTİ (uyarılar olabilir)
 *             1 = en az bir kontrol BAŞARISIZ (veri farkı)
 *             2 = test tamamlanamadı (bağlantı/Excel/ayar hatası)
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const TARGETS = Object.freeze(['cp', 'orders', 'backlog']);
const TARGET_LABELS = { cp: 'CP', orders: 'Siparişler', backlog: 'Backlog' };
const SAMPLE_LIMIT = 25;

/* ------------------------------- argümanlar ------------------------------- */

function parseArgs(argv) {
  const args = { user: 'moderator', kumas: 'ikisi', tekrar: 1, excel: true, root: '', cikti: '' };
  for (let i = 0; i < argv.length; i++) {
    const name = String(argv[i] || '').replace(/^--/, '').toLowerCase();
    const value = argv[i + 1];
    const take = () => { i += 1; return String(value == null ? '' : value).trim(); };
    if (name === 'root') args.root = take();
    else if (name === 'user') args.user = take() || 'moderator';
    else if (name === 'kumas') args.kumas = take().toLowerCase();
    else if (name === 'tekrar') args.tekrar = Number(take());
    else if (name === 'excel') args.excel = !/^(hayir|hayır|no|0|false)$/i.test(take());
    else if (name === 'cikti') args.cikti = take();
    else if (name === 'help' || name === 'h' || name === '?') args.help = true;
  }
  if (!['ikisi', 'dahil', 'haric'].includes(args.kumas)) throw usageError(`--kumas yalnız ikisi | dahil | haric olabilir (verilen: ${args.kumas}).`);
  if (!Number.isInteger(args.tekrar) || args.tekrar < 1 || args.tekrar > 5) throw usageError('--tekrar 1 ile 5 arasında bir tam sayı olmalı.');
  return args;
}
function usageError(message) { const error = new Error(message); error.exitCode = 2; return error; }

/* --------------------------------- ortam --------------------------------- */

function readJsonFile(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return JSON.parse(text);
}

/* Portable kurulumda BL backend'iyle BİREBİR aynı veri köklerini kurar
   (electron/portable-paths.js). Excel PID dosyası ayrılır. Bu fonksiyon BL
   sunucu modüllerinden ÖNCE çağrılmalıdır: modüller veri köklerini yüklenirken
   okur. */
function setupEnvironment(root, env = process.env) {
  const portable = require(path.join(APP_DIR, 'electron', 'portable-paths.js'));
  const resolvedRoot = root ? path.resolve(root) : '';
  const isPortable = resolvedRoot && fs.existsSync(path.join(resolvedRoot, 'data'));
  if (isPortable) {
    const paths = portable.desktopPaths(resolvedRoot);
    const next = portable.backendEnv(paths, env);
    for (const [key, value] of Object.entries(next)) env[key] = value;
    env.BUYER_LOG_EXCEL_PID_FILE = path.join(paths.localDataRoot, 'runtime', 'excel-source-parity.pid');
    return { mode: 'portable', root: resolvedRoot, paths };
  }
  return { mode: 'process-env', root: resolvedRoot || APP_DIR, paths: null };
}

/* BL modülleri ortam kurulduktan sonra yüklenir. */
function loadBlModules() {
  const req = rel => require(path.join(APP_DIR, rel));
  return {
    userData: req('server/user-data.js'),
    db: req('server/db.js'),
    userPreferences: req('server/lib/user-preferences.js'),
    modelRefresh: req('server/lib/model-refresh.js'),
    modelHorizon: req('server/lib/modelHorizon.js'),
    modelFields: req('server/lib/model-fields.js'),
    parse: req('server/lib/parse.js'),
    findFiles: req('server/lib/findFiles.js'),
    refreshExcel: req('server/lib/refreshExcel.js'),
    sourceRefresh: req('server/lib/source-refresh.js'),
    appVersion: req('server/lib/app-version.js'),
    compare: req('scripts/lib/source-parity-compare.js'),
  };
}

/* Bu testin ihtiyaç duyduğu motor seçenekleri kurulu BL sürümünde var mı? */
function engineSupport(bl) {
  const related = /relatedLookup/.test(String(bl.modelHorizon.buildFactRowQuery));
  const fabric = Array.isArray(bl.modelFields.FABRIC_HEADERS) && /excludeFabric/.test(String(bl.modelRefresh.buildConnectionQuery));
  return { related, fabric };
}

/* BL ayarlarını YALNIZ OKUR. db.loadSettings() kullanılmaz: o yol veri klasörü
   oluşturabilir ve bozuk dosyayı yedekten geri yazabilir. Burada sadece dosya
   okunur ve BL'ın kendi normalizasyon fonksiyonları uygulanır. */
function loadBlContext(bl, args) {
  const configPath = bl.userData.CONFIG_PATH;
  let config = {};
  try { if (fs.existsSync(configPath)) config = readJsonFile(configPath) || {}; } catch (_) { config = {}; }
  const deltaMode = String(process.env.BL_DELTA_STORE_MODE || config.deltaStoreMode || 'shadow').toLowerCase();
  if (deltaMode === 'delta-only') {
    throw usageError('Bu kurulum "delta-only" veri modunda; ayarlar JSON dosyasında değil yerel veritabanında. Test yanlış ayarla çalışmasın diye durduruldu.');
  }
  const dataRoot = bl.userData.SERVER_DATA_ROOT;
  const settingsFile = path.join(dataRoot, 'settings.json');
  const overridesFile = path.join(dataRoot, 'overrides.json');
  if (!fs.existsSync(settingsFile)) throw usageError(`Buyer Log ayar dosyası bulunamadı: ${settingsFile}. CMD dosyasını Buyer Log klasöründe çalıştırdığınızdan emin olun.`);
  const settings = readJsonFile(settingsFile) || {};
  const overrides = fs.existsSync(overridesFile) ? (readJsonFile(overridesFile) || {}) : {};

  const normalized = bl.db.normalizeModelConnections(Array.isArray(settings.modelConnections) ? settings.modelConnections : []);
  const items = bl.userPreferences.applyHorizonOverrides(normalized, args.user, TARGETS.slice(), null);
  // db.loadOverrides() ile aynı kural: v3 öncesi kayıt varsayılan üçlüye yükseltilir.
  const matchRule = (Number(overrides.antrepoMatchConfigVersion) || 0) >= 3
    ? bl.parse.normalizeAntrepoMatchConfig(overrides.antrepoMatchConfig || null)
    : bl.parse.defaultAntrepoMatchConfig();
  const folders = settings.sourceFolders && typeof settings.sourceFolders === 'object' ? settings.sourceFolders : {};
  const sourceFolder = folders[args.user]
    || (args.user === 'moderator' ? (settings.sourceFolder || config.sourceFolder) : '') || '';
  const active = items.filter(item => item && item.refreshEnabled !== false && item.server && item.catalog);
  return {
    config, deltaMode, dataRoot, items, matchRule, sourceFolder,
    sourceModes: {
      asas: overrides.asasSourceMode === 'database' ? 'database' : 'excel',
      antrepo: ['database', 'dashboard'].includes(overrides.antrepoSourceMode) ? overrides.antrepoSourceMode : 'excel',
    },
    connections: active.filter(item => item.role === 'asas' || item.role === 'antrepo')
      .map(item => ({ id: item.id, name: item.name, role: item.role, server: item.server, catalog: item.catalog })),
  };
}

/* --------------------------------- adımlar --------------------------------- */

async function timed(label, log, work) {
  const started = Date.now();
  log(`→ ${label} ...`);
  try {
    const value = await work();
    const ms = Date.now() - started;
    log(`  ✓ ${label} (${seconds(ms)})`);
    return { ok: true, ms, value };
  } catch (error) {
    const ms = Date.now() - started;
    const message = String(error && (error.publicMessage || error.message) || error);
    log(`  ✗ ${label} (${seconds(ms)}): ${message}`);
    return { ok: false, ms, error: message, code: error && error.code || '' };
  }
}
function seconds(ms) { return `${(Number(ms || 0) / 1000).toFixed(1)} sn`; }

function requireXlsx(bl) {
  const XLSX = require(path.join(APP_DIR, 'node_modules', 'xlsx'));
  // excel-worker.js ile aynı kancalar: tarih saat dilimi ve parser korumaları.
  try { require(path.join(APP_DIR, 'public', 'excel-date-utils.js')).installSheetJsHooks(XLSX); } catch (_) {}
  require(path.join(APP_DIR, 'server', 'lib', 'workbook-parser-guards.js')).install(XLSX);
  return XLSX;
}

async function runExcelStep(bl, ctx, outDir, log, deps) {
  const result = { enabled: true, valid: false, files: {}, refresh: {}, parse: {}, problems: [] };
  if (!ctx.sourceFolder) { result.problems.push('Kaynak klasör seçili değil (Buyer Log → Kaynak Veri).'); return result; }
  let found;
  try { found = bl.findFiles.findLatestSourceFiles(ctx.sourceFolder); }
  catch (error) { result.problems.push(String(error.message || error)); return result; }
  if (!found.asas) result.problems.push(`Klasörde asas*.xlsx bulunamadı: ${ctx.sourceFolder}`);
  if (!found.antrepo) result.problems.push(`Klasörde antrepo*.xlsx bulunamadı: ${ctx.sourceFolder}`);
  if (!found.asas || !found.antrepo) return result;

  const copyDir = path.join(outDir, 'excel-kopyalari');
  fs.mkdirSync(copyDir, { recursive: true });
  const XLSX = deps.xlsx || requireXlsx(bl);
  const refresh = deps.refreshExcelFile || bl.refreshExcel.refreshExcelFile;
  let allRefreshed = true;
  for (const [kind, file] of [['asas', found.asas], ['antrepo', found.antrepo]]) {
    const copy = path.join(copyDir, file.name);
    fs.copyFileSync(file.full, copy);
    result.files[kind] = { source: file.full, copy, modifiedAt: new Date(file.mtime).toISOString() };
    const timeoutMs = bl.sourceRefresh.computeRefreshTimeoutMs(copy, ctx.config.excelRefreshTimeoutMs);
    const step = await timed(`Excel pivot yenileme · ${file.name}`, log, () => refresh(copy, timeoutMs));
    result.refresh[kind] = { ok: step.ok, ms: step.ms, error: step.error || '' };
    if (!step.ok) allRefreshed = false;
  }
  const parseStep = await timed('Excel ayrıştırma (BL Excel motoru)', log, async () => {
    const read = full => XLSX.readFile(full, { cellDates: false, raw: true, dense: true });
    const asasStarted = Date.now();
    const parsedAsas = bl.parse.parseASASWorkbook(read(result.files.asas.copy), ctx.matchRule);
    const asasMs = Date.now() - asasStarted;
    const antrepoStarted = Date.now();
    const antrepoMap = bl.parse.parseAntrepoWorkbook(read(result.files.antrepo.copy), ctx.matchRule);
    return { parsedAsas, antrepoMap, asasMs, antrepoMs: Date.now() - antrepoStarted };
  });
  if (!parseStep.ok) { result.problems.push(`Excel okunamadı: ${parseStep.error}`); return result; }
  const { parsedAsas, antrepoMap } = parseStep.value;
  result.parse = { ms: parseStep.ms, asasMs: parseStep.value.asasMs, antrepoMs: parseStep.value.antrepoMs };
  if (!parsedAsas || !Array.isArray(parsedAsas.orders)) { result.problems.push('ASAS Excel dosyasında "Sipariş Kod" sütunu bulunamadı.'); return result; }
  const meta = bl.parse.antrepoParseMeta(antrepoMap) || {};
  if (meta.ok === false) { result.problems.push(`Antrepo Excel eşleştirme alanları çözülemedi: ${meta.reason || ''}`); return result; }
  result.orders = parsedAsas.orders;
  result.antrepoMap = antrepoMap;
  result.asasWarnings = parsedAsas.fabricHeaderInfo && Array.isArray(parsedAsas.fabricHeaderInfo.warnings) ? parsedAsas.fabricHeaderInfo.warnings : [];
  result.antrepoMeta = { dataRows: meta.dataRows, matchableRows: meta.matchableRows, blankStatus: meta.blankStatus, blankLoadedQty: meta.blankLoadedQty, columns: meta.columns };
  // Fail-closed: pivotu yenilenmemiş Excel doğruluk referansı OLAMAZ.
  if (!allRefreshed) {
    result.problems.push('Excel pivotları yenilenemedi; dosyanın eski kaydedilmiş hali referans alınamaz. Excel karşılaştırmaları GEÇERSİZ sayıldı.');
    return result;
  }
  result.valid = true;
  return result;
}

function runSummaries(result, role) {
  return (result && Array.isArray(result.runs) ? result.runs : [])
    .filter(run => run && run.item && (role === 'all' || (role === 'antrepo' ? run.item.role === 'antrepo' : run.item.role !== 'antrepo')))
    .map(run => ({
      connection: run.item.name || run.item.id || '',
      rows: Array.isArray(run.rows) ? run.rows.length : 0,
      rawRows: run.summary && run.summary.rawRowCount || 0,
      timings: run.timings || {},
      query: run.query || '',
      rowsRef: run.rows || [],
    }));
}

async function runDbSteps(bl, ctx, args, log, deps) {
  const load = deps.loadFromModelConnections || bl.modelRefresh.loadFromModelConnections;
  const base = { targets: TARGETS.slice(), matchRule: ctx.matchRule, includeLfl: false, ...(deps.loadOptions || {}) };
  const out = { full: null, iasRuns: { current: [], candidate: [] }, asasRuns: { fabric: [], noFabric: [] } };

  // 1) BL'IN BİREBİR YENİLEMESİ: ASAS + IAS aynı anda (BL'daki gibi paralel).
  const fullFabricOff = args.kumas === 'haric';
  out.full = await timed(`Database · BL yenilemesi (ASAS${fullFabricOff ? ' kumaşsız' : ''} + IAS mevcut, paralel)`, log,
    () => load(ctx.items, { ...base, includeAsas: true, includeAntrepo: true, excludeFabric: fullFabricOff }));
  if (!out.full.ok) return out;
  const preset = out.full.value.asasOrdersByTarget || {};

  // 2) IAS tek başına: mevcut ⇄ aday, sıra her turda değişir (sunucu önbelleği
  //    hep aynı varyantı kayırmasın).
  const iasOnly = lookup => () => load(ctx.items, {
    ...base, includeAsas: false, includeAntrepo: true, presetAsasOrdersByTarget: preset,
    ...(lookup ? { iasLookup: lookup } : {}),
  });
  for (let round = 0; round < args.tekrar; round++) {
    const order = round % 2 === 0 ? ['current', 'candidate'] : ['candidate', 'current'];
    for (const variant of order) {
      const label = variant === 'current' ? 'IAS mevcut sorgu' : 'IAS aday sorgu (RELATED)';
      out.iasRuns[variant].push(await timed(`Database · ${label} · tur ${round + 1}/${args.tekrar}`, log, iasOnly(variant === 'candidate' ? 'related' : '')));
    }
  }

  // 3) ASAS tek başına: kumaşlı ⇄ kumaşsız.
  if (args.kumas === 'ikisi') {
    const asasOnly = excludeFabric => () => load(ctx.items, { ...base, includeAsas: true, includeAntrepo: false, excludeFabric });
    for (let round = 0; round < args.tekrar; round++) {
      const order = round % 2 === 0 ? ['fabric', 'noFabric'] : ['noFabric', 'fabric'];
      for (const variant of order) {
        const label = variant === 'fabric' ? 'ASAS kumaşlı' : 'ASAS kumaşsız';
        out.asasRuns[variant].push(await timed(`Database · ${label} · tur ${round + 1}/${args.tekrar}`, log, asasOnly(variant === 'noFabric')));
      }
    }
  }
  return out;
}

/* ------------------------------ karşılaştırma ------------------------------ */

function median(values) {
  const list = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/* Hedefleri veri parmak izine göre gruplar: CP/Siparişler/Backlog aynı
   kapsamdan geliyorsa tek karşılaştırma raporlanır. */
function targetGroups(result, cmp, cctx) {
  const groups = new Map();
  for (const target of TARGETS) {
    const orders = result.asasOrdersByTarget && result.asasOrdersByTarget[target];
    if (!Array.isArray(orders)) continue;
    const map = result.antrepoMapByTarget && result.antrepoMapByTarget[target];
    const fp = `${cmp.ordersFingerprint(orders, cctx)}:${map ? cmp.iasFingerprint(map, cctx) : '-'}`;
    if (!groups.has(fp)) groups.set(fp, { targets: [], target });
    groups.get(fp).targets.push(target);
  }
  return [...groups.values()];
}

function restrictIasToOrders(map, orderSets, cmp, cctx) {
  const lines = new Set();
  const lineKey = entry => ['ocode', 'model', 'ccode'].map(f => cctx.canon(entry[f])).join('\u0000');
  for (const orders of orderSets) for (const order of orders || []) lines.add(lineKey(order));
  const out = Object.create(null);
  let dropped = 0;
  for (const [key, entry] of Object.entries(map || {})) {
    if (lines.has(lineKey(entry))) out[key] = entry; else dropped += 1;
  }
  return { map: out, dropped };
}

function verdictOf(flags) {
  if (flags.error) return 'HATA';
  if (flags.invalid) return 'GEÇERSİZ';
  if (flags.skipped) return 'ATLANDI';
  if (flags.fail) return 'BAŞARISIZ';
  if (flags.warn) return 'UYARI';
  return 'GEÇTİ';
}

function buildComparisons(bl, ctx, args, excel, db) {
  const cmp = bl.compare;
  const cctx = { parseLib: bl.parse, rule: ctx.matchRule, canon: cmp.createCanon(bl.parse) };
  const checks = [];
  const csv = {}; // dosya adı → satırlar
  const addCsv = (name, header, rows) => { if (rows.length) csv[name] = [header, ...rows]; };
  const full = db.full && db.full.ok ? db.full.value : null;
  const firstOk = list => (list || []).find(step => step.ok);

  // ---- A) IAS mevcut ⇄ aday (DB⇄DB, sıfır tolerans) ----
  const iasCurrent = firstOk(db.iasRuns.current);
  const iasCandidate = firstOk(db.iasRuns.candidate);
  const candidateError = (db.iasRuns.candidate || []).find(step => !step.ok);
  if (!full) {
    checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu', verdict: 'HATA', lines: ['BL yenilemesi tamamlanamadığı için çalıştırılmadı.'] });
  } else if (!iasCandidate || !iasCurrent) {
    const message = candidateError ? candidateError.error : 'IAS sorgusu çalışmadı.';
    const related = /RELATED|relationship|ilişki/i.test(message);
    checks.push({
      id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu', verdict: 'HATA',
      lines: [`Aday sorgu çalışmadı: ${message}`,
        related ? 'RELATED, IAS modelindeki ilişki çoka-bir olmadığı için uygulanamıyor; aday bu modelde kullanılamaz.' : ''].filter(Boolean),
    });
  } else {
    const a = iasCurrent.value, b = iasCandidate.value;
    const rawA = runSummaries(a, 'antrepo').flatMap(run => run.rowsRef);
    const rawB = runSummaries(b, 'antrepo').flatMap(run => run.rowsRef);
    const raw = cmp.compareRawRows(rawA, rawB, cctx);
    const lines = [`Ham satır: mevcut ${raw.referenceRows} · aday ${raw.candidateRows} · yalnız mevcutta ${raw.onlyReference.length} · yalnız adayda ${raw.onlyCandidate.length}`];
    let fail = !raw.identical;
    const rawRows = [...raw.onlyReference.map(item => ['yalnız mevcut', item.count, item.row]), ...raw.onlyCandidate.map(item => ['yalnız aday', item.count, item.row])];
    addCsv('ias-mevcut-aday-ham-satir-farklari.csv', ['taraf', 'adet', 'satır (kanonik)'], rawRows);
    for (const target of TARGETS) {
      const mapA = a.antrepoMapByTarget && a.antrepoMapByTarget[target];
      const mapB = b.antrepoMapByTarget && b.antrepoMapByTarget[target];
      if (!mapA && !mapB) continue;
      const ias = cmp.compareIas(mapA, mapB, cctx, { strict: true });
      const orders = full.asasOrdersByTarget[target] || [];
      const match = cmp.compareMatches(cmp.matchSummary(orders, mapA, cctx), cmp.matchSummary(orders, mapB, cctx), cctx);
      const n = ias.detail.missing.length + ias.detail.extra.length + ias.detail.qtyDiffs.length + ias.detail.rowDiffs.length;
      if (n || match.diffs.length) fail = true;
      lines.push(`${TARGET_LABELS[target]}: parsiyel ${ias.referenceRows} ⇄ ${ias.candidateRows}, kimlik/miktar farkı ${n}, eşleştirme farkı ${match.diffs.length} (${match.compared} sipariş)`);
      addCsv(`ias-mevcut-aday-eslestirme-${target}.csv`, ['sipariş anahtarı', 'alan', 'mevcut', 'aday'],
        match.diffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]));
    }
    // Determinizm: mevcut sorgu turlar arasında aynı veriyi döndürdü mü?
    const currentPrints = (db.iasRuns.current || []).filter(s => s.ok)
      .map(s => TARGETS.map(t => s.value.antrepoMapByTarget && s.value.antrepoMapByTarget[t] ? cmp.iasFingerprint(s.value.antrepoMapByTarget[t], cctx) : '-').join(','));
    const unstable = new Set(currentPrints).size > 1;
    if (unstable) lines.push('DİKKAT: Mevcut IAS sorgusu turlar arasında farklı veri döndürdü — kaynak veritabanı test sırasında güncelleniyor olabilir. Farklar bu nedenle olabilir; testi model işlenmesi bittikten sonra tekrarlayın.');
    checks.push({ id: 'ias-aday', title: 'IAS mevcut ⇄ aday sorgu (RELATED)', verdict: verdictOf({ fail, warn: unstable }), lines });
  }

  // ---- B) ASAS kumaşlı ⇄ kumaşsız ----
  if (args.kumas === 'ikisi') {
    const withFabric = firstOk(db.asasRuns.fabric);
    const withoutFabric = firstOk(db.asasRuns.noFabric);
    if (!withFabric || !withoutFabric) {
      const error = [...db.asasRuns.fabric, ...db.asasRuns.noFabric].find(step => !step.ok);
      checks.push({ id: 'kumas', title: 'ASAS kumaşlı ⇄ kumaşsız', verdict: 'HATA', lines: [`Sorgu çalışmadı: ${error ? error.error : 'bilinmiyor'}`] });
    } else {
      let fail = false;
      const lines = [];
      for (const target of TARGETS) {
        const a = withFabric.value.asasOrdersByTarget[target], b = withoutFabric.value.asasOrdersByTarget[target];
        if (!a && !b) continue;
        const r = cmp.compareOrders(a, b, cctx, { strict: true, ignoreFields: cmp.FABRIC_ORDER_FIELDS });
        const n = r.missing.length + r.extra.length + r.valueDiffs.length + r.multiplicity.length;
        if (n) fail = true;
        lines.push(`${TARGET_LABELS[target]}: sipariş ${r.referenceCount} ⇄ ${r.candidateCount}, kumaş dışı alan farkı ${r.valueDiffs.length}, eksik ${r.missing.length}, fazla ${r.extra.length}`);
        if (Object.keys(r.fieldDiffCounts).length) lines.push(`  Farklı alanlar: ${Object.entries(r.fieldDiffCounts).map(([f, c]) => `${f}=${c}`).join(', ')}`);
        addCsv(`kumas-etkisi-${target}.csv`, ['sipariş anahtarı', 'alan', 'kumaşlı', 'kumaşsız'], [
          ...r.valueDiffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]),
          ...r.missing.map(d => [cmp.displayKey(d.key), '(sipariş)', 'var', 'YOK']),
          ...r.extra.map(d => [cmp.displayKey(d.key), '(sipariş)', 'YOK', 'var']),
        ]);
      }
      if (fail) lines.push('Kumaşsız sorgu sipariş verisini değiştiriyor: kumaş alanları ASAS satır evrenini/miktarını etkiliyor. Kumaşı ASAS sorgusundan çıkarmak bu haliyle GÜVENLİ DEĞİL.');
      checks.push({ id: 'kumas', title: 'ASAS kumaşlı ⇄ kumaşsız (kumaş dışı alanlar)', verdict: verdictOf({ fail }), lines });
    }
  }

  // ---- C) Excel ⇄ Database (Excel = doğruluk referansı) ----
  if (!excel.enabled) {
    checks.push({ id: 'excel', title: 'Excel ⇄ Database', verdict: 'ATLANDI', lines: ['--excel hayir verildi.'] });
  } else if (!excel.valid || !full) {
    checks.push({ id: 'excel', title: 'Excel ⇄ Database', verdict: excel.valid ? 'HATA' : 'GEÇERSİZ', lines: [...excel.problems, ...(!full ? ['BL Database yenilemesi tamamlanamadı.'] : [])] });
  } else {
    const groups = targetGroups(full, cmp, cctx);
    const candidateResult = iasCandidate ? iasCandidate.value : null;
    for (const group of groups) {
      const target = group.target;
      const label = group.targets.map(t => TARGET_LABELS[t]).join(' / ');
      const dbOrders = full.asasOrdersByTarget[target] || [];
      const dbMap = full.antrepoMapByTarget && full.antrepoMapByTarget[target] || {};

      // C1 — ASAS siparişleri
      const asas = cmp.compareOrders(excel.orders, dbOrders, cctx, { strict: false, ignoreFields: args.kumas === 'haric' ? cmp.FABRIC_ORDER_FIELDS : [] });
      const asasLines = [
        `Sipariş satırı: Excel ${asas.referenceCount} · DB ${asas.candidateCount} (anahtar ${asas.referenceKeys} ⇄ ${asas.candidateKeys})`,
        `Excel'de olup DB'de olmayan: ${asas.missing.length} · DB'de olup Excel'de olmayan: ${asas.extra.length} · değer farkı: ${asas.valueDiffs.length}`,
        `Toplam Net Alım: Excel ${asas.totals.qty.reference} · DB ${asas.totals.qty.candidate}`,
      ];
      if (Object.keys(asas.fieldDiffCounts).length) asasLines.push(`Farklı alanlar: ${Object.entries(asas.fieldDiffCounts).map(([f, c]) => `${f}=${c}`).join(', ')}`);
      if (asas.coverage.length) asasLines.push(`Kapsam notu (alan yalnız bir kaynakta dolu): ${asas.coverage.map(c => `${c.field} (${c.onlyIn === 'reference' ? 'yalnız Excel' : 'yalnız DB'})`).join(', ')}`);
      if (asas.extra.length) asasLines.push('DB fazlası çoğunlukla ufuk/kapsam farkıdır (Excel raporunun filtresi ile Data Source and Filters farklı). Örnekler CSV dosyasında.');
      checks.push({ id: `excel-asas-${target}`, title: `Excel ⇄ DB · ASAS siparişleri · ${label}`,
        verdict: verdictOf({ fail: asas.missing.length > 0 || asas.valueDiffs.length > 0, warn: asas.extra.length > 0 || asas.coverage.length > 0 || asas.multiplicity.length > 0 }),
        lines: asasLines });
      addCsv(`excel-db-asas-${target}.csv`, ['tür', 'sipariş anahtarı', 'alan', 'Excel', 'DB', 'sezon'], [
        ...asas.missing.map(d => ['EXCEL VAR / DB YOK', cmp.displayKey(d.key), '', '', '', d.order && d.order.season || '']),
        ...asas.valueDiffs.map(d => ['DEĞER FARKI', cmp.displayKey(d.key), d.field, d.reference, d.candidate, '']),
        ...asas.extra.map(d => ['DB VAR / EXCEL YOK', cmp.displayKey(d.key), '', '', '', d.order && d.order.season || '']),
        ...asas.multiplicity.map(d => ['SATIR SAYISI', cmp.displayKey(d.key), '', d.reference, d.candidate, '']),
      ]);

      // C2 — IAS parsiyelleri (yalnız ASAS siparişleriyle ilgili satırlar)
      const orderSets = [excel.orders, dbOrders];
      const excelIas = restrictIasToOrders(excel.antrepoMap, orderSets, cmp, cctx);
      for (const [variant, map] of [['mevcut', dbMap], ['aday', candidateResult && candidateResult.antrepoMapByTarget ? candidateResult.antrepoMapByTarget[target] : null]]) {
        if (!map) continue;
        const dbIas = restrictIasToOrders(map, orderSets, cmp, cctx);
        const ias = cmp.compareIas(excelIas.map, dbIas.map, cctx, { strict: false });
        const failIas = ias.line.missing.length > 0 || ias.line.qtyDiffs.length > 0 || ias.detail.missing.length > 0 || ias.detail.qtyDiffs.length > 0;
        const warnIas = ias.line.extra.length > 0 || ias.detail.extra.length > 0 || ias.coverage.length > 0;
        checks.push({ id: `excel-ias-${variant}-${target}`, title: `Excel ⇄ DB ${variant} · IAS parsiyelleri · ${label}`,
          verdict: verdictOf({ fail: failIas, warn: warnIas }),
          lines: [
            `İlgili parsiyel (ASAS siparişleriyle eşleşebilen): Excel ${ias.referenceRows} · DB ${ias.candidateRows} (ilgisiz satır: Excel ${excelIas.dropped}, DB ${dbIas.dropped})`,
            `Toplam Yükleme Adet: Excel ${ias.totals.loadedQty.reference} · DB ${ias.totals.loadedQty.candidate}`,
            `Sipariş+Model+Renk düzeyi: Excel'de olup DB'de olmayan ${ias.line.missing.length} · adet farkı ${ias.line.qtyDiffs.length} · DB fazlası ${ias.line.extra.length}`,
            `Parsiyel düzeyi (ortak alanlar: ${ias.identityFields.join(', ')}): eksik ${ias.detail.missing.length} · adet farkı ${ias.detail.qtyDiffs.length} · fazla ${ias.detail.extra.length}`,
            ...(ias.coverage.length ? [`Kapsam notu: ${ias.coverage.map(c => `${c.field} (${c.onlyIn === 'reference' ? 'yalnız Excel' : 'yalnız DB'})`).join(', ')} karşılaştırma kimliğine alınmadı.`] : []),
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

        // C3 — Eşleştirme motoru: aynı ASAS siparişleri için Backlog sonucu
        const excelMatch = cmp.matchSummary(excel.orders, excel.antrepoMap, cctx);
        const dbMatch = cmp.matchSummary(dbOrders, map, cctx);
        const match = cmp.compareMatches(excelMatch, dbMatch, cctx);
        checks.push({ id: `excel-eslesme-${variant}-${target}`, title: `Excel ⇄ DB ${variant} · eşleştirme sonucu · ${label}`,
          verdict: verdictOf({ fail: match.diffs.length > 0 }),
          lines: [
            `Ortak sipariş: ${match.compared} · farklı sonuç: ${new Set(match.diffs.map(d => d.key)).size}`,
            `Excel: ${match.referenceStats.matched}/${match.referenceStats.orders} eşleşti (çoklu parsiyel ${match.referenceStats.ambiguous}) · DB: ${match.candidateStats.matched}/${match.candidateStats.orders} (çoklu ${match.candidateStats.ambiguous})`,
          ] });
        addCsv(`excel-db-eslesme-${variant}-${target}.csv`, ['sipariş anahtarı', 'alan', 'Excel', 'DB'],
          match.diffs.map(d => [cmp.displayKey(d.key), d.field, d.reference, d.candidate]));
      }
    }
  }
  return { checks, csv };
}

/* --------------------------------- rapor --------------------------------- */

function timingRows(db) {
  const rows = [];
  const add = (label, steps, role) => {
    const ok = (steps || []).filter(step => step && step.ok);
    if (!(steps || []).length) return;
    const wall = median(ok.map(step => step.ms));
    const runs = ok.map(step => runSummaries(step.value, role));
    const pick = key => median(runs.map(list => list.reduce((acc, run) => acc + (Number(run.timings[key]) || 0), 0)));
    const rowCount = runs.length ? runs[0].reduce((acc, run) => acc + run.rows, 0) : null;
    const rawCount = runs.length ? runs[0].reduce((acc, run) => acc + run.rawRows, 0) : null;
    rows.push({ label, n: ok.length, failed: steps.length - ok.length, wall, server: pick('executeMs'), open: pick('connectionOpenMs'), write: pick('writeMs'), parse: pick('parseMs'), rowCount, rawCount, samples: ok.map(step => step.ms) });
  };
  if (db.full) add('BL yenilemesi (ASAS+IAS paralel, uçtan uca)', [db.full], 'all');
  add('IAS mevcut sorgu (tek başına)', db.iasRuns.current, 'antrepo');
  add('IAS aday sorgu RELATED (tek başına)', db.iasRuns.candidate, 'antrepo');
  add('ASAS kumaşlı (tek başına)', db.asasRuns.fabric, 'asas');
  add('ASAS kumaşsız (tek başına)', db.asasRuns.noFabric, 'asas');
  return rows;
}

function csvText(rows) {
  const cell = value => {
    const text = value == null ? '' : String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // Türkçe Excel ; ayırıcıyı ve BOM'lu UTF-8'i doğru açar.
  return '﻿' + rows.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
}

function writeReport(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const L = [];
  const line = (text = '') => L.push(text);
  line('BUYER LOG — KAYNAK DOĞRULAMA RAPORU (ASAS / IAS / EXCEL)');
  line('='.repeat(72));
  line(`Tarih            : ${report.startedAt}`);
  line(`Buyer Log sürümü : ${report.version}`);
  line(`Kullanıcı        : ${report.user}`);
  line(`Kaynak klasör    : ${report.sourceFolder || '(seçili değil)'}`);
  line(`Kumaş seçeneği   : ${report.kumas} · tekrar: ${report.tekrar}`);
  line(`BL kaynak modları: ASAS=${report.sourceModes.asas}, Antrepo=${report.sourceModes.antrepo} (test her durumda Database'i sorgular)`);
  for (const c of report.connections) line(`Bağlantı         : ${c.role === 'antrepo' ? 'IAS' : 'ASAS'} · ${c.name || c.id} · ${c.catalog}`);
  for (const s of report.horizons) line(`Kullanılan ufuk  : ${s.target} · ${s.connection} · ${s.text || '(sınırsız — tablonun tamamı)'}`);
  line('Not: Ufuk, bağlantı + kullanıcının kişisel ufkundan çözülür. Rol/atanmış varsayılan ufuklar (Kullanıcı Yönetimi) bu araçta');
  line('     kimlik deposuna dokunmamak için okunmaz; BL ekranındaki ufuk rozetiyle yukarıdaki satırı karşılaştırın.');
  line('');
  line(`GENEL SONUÇ: ${report.overall}`);
  line('-'.repeat(72));
  for (const check of report.checks) line(`[${check.verdict.padEnd(9)}] ${check.title}`);
  line('');
  line('SÜRELER (medyan; sunucu = SSAS sorgu yürütme)');
  line('-'.repeat(72));
  for (const t of report.timings) {
    const fmt = v => v == null ? '-' : seconds(v);
    line(`${t.label}`);
    line(`   toplam ${fmt(t.wall)} · sunucu ${fmt(t.server)} · bağlantı ${fmt(t.open)} · yazma ${fmt(t.write)} · ayrıştırma ${fmt(t.parse)} · satır ${t.rowCount == null ? '-' : t.rowCount}${t.rawCount ? ` (ham ${t.rawCount})` : ''} · koşu ${t.n}${t.failed ? ` (+${t.failed} hatalı)` : ''}${t.samples.length > 1 ? ` · örnekler ${t.samples.map(seconds).join(', ')}` : ''}`);
  }
  if (report.excel && report.excel.enabled) {
    for (const [kind, r] of Object.entries(report.excel.refresh || {})) line(`Excel pivot yenileme · ${kind}: ${r.ok ? seconds(r.ms) : `HATA (${r.error})`}`);
    if (report.excel.parse && report.excel.parse.ms) line(`Excel ayrıştırma: ${seconds(report.excel.parse.ms)}`);
  }
  if (report.tekrar < 3) line('Not: Süre karşılaştırması için --tekrar 3 önerilir; tek koşuda SSAS önbelleği ve anlık yük sonucu etkileyebilir.');
  line('');
  line('AYRINTILAR');
  line('-'.repeat(72));
  for (const check of report.checks) {
    line(`[${check.verdict}] ${check.title}`);
    for (const text of check.lines || []) line(`   ${text}`);
    line('');
  }
  if (report.warnings.length) {
    line('BL MOTORU UYARILARI (yenileme sırasında üretilen)');
    line('-'.repeat(72));
    for (const warning of report.warnings.slice(0, 60)) line(` - ${warning}`);
    if (report.warnings.length > 60) line(` ... +${report.warnings.length - 60} uyarı (ozet.json)`);
    line('');
  }
  line('DOSYALAR');
  line('-'.repeat(72));
  for (const name of Object.keys(report.csvFiles)) line(` - ${name}`);
  line(' - sorgular\\*.dax (DAX Studio ile aynı sorguyu çalıştırmak için)');
  line(' - excel-kopyalari\\ (pivotu yenilenmiş Excel kopyaları)');
  line('');
  line('Bu rapor iş verisi içerir; yalnız bu bilgisayarda saklanır, hiçbir yere gönderilmez.');
  fs.writeFileSync(path.join(outDir, 'rapor.txt'), '﻿' + L.join('\r\n'), 'utf8');
  for (const [name, rows] of Object.entries(report.csvRows)) fs.writeFileSync(path.join(outDir, name), csvText(rows), 'utf8');
  const { csvRows, ...json } = report;
  fs.writeFileSync(path.join(outDir, 'ozet.json'), JSON.stringify(json, null, 2), 'utf8');
  return L.join('\n');
}

function writeQueries(outDir, db) {
  const dir = path.join(outDir, 'sorgular');
  const seen = new Set();
  const save = (name, query) => {
    if (!query || seen.has(name)) return;
    seen.add(name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), query, 'utf8');
  };
  const first = list => (list || []).find(step => step && step.ok);
  const queries = (step, role) => step ? runSummaries(step.value, role).map(run => run.query) : [];
  queries(db.full, 'asas').forEach((q, i) => save(`asas-${i + 1}.dax`, q));
  queries(first(db.iasRuns.current), 'antrepo').forEach((q, i) => save(`ias-mevcut-${i + 1}.dax`, q));
  queries(first(db.iasRuns.candidate), 'antrepo').forEach((q, i) => save(`ias-aday-related-${i + 1}.dax`, q));
  queries(first(db.asasRuns.noFabric), 'asas').forEach((q, i) => save(`asas-kumassiz-${i + 1}.dax`, q));
}

/* ---------------------------------- ana ---------------------------------- */

async function main(argv, deps = {}) {
  const log = deps.log || (text => console.log(text));
  let args;
  try { args = parseArgs(argv); }
  catch (error) { log(`[HATA] ${error.message}`); return 2; }
  if (args.help) { log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 40).join('\n')); return 0; }

  const env = deps.skipEnvironment ? { mode: 'test', root: args.root } : setupEnvironment(args.root);
  const bl = loadBlModules();
  const support = engineSupport(bl);
  if (!support.related || !support.fabric) {
    log('[HATA] Bu Buyer Log sürümü kaynak doğrulama için gereken motor seçeneklerini içermiyor (IAS RELATED adayı / kumaşsız ASAS).');
    log('       Bu testi içeren sürüme güncelleyip tekrar deneyin.');
    return 2;
  }
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = args.cikti ? path.resolve(args.cikti) : path.join(env.root || APP_DIR, 'Kaynak-Dogrulama-Raporlari', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  let ctx;
  try { ctx = loadBlContext(bl, args); }
  catch (error) { log(`[HATA] ${error.message}`); return 2; }
  log(`Buyer Log ${bl.appVersion.DISPLAY_VERSION || bl.appVersion.APP_VERSION} · kullanıcı ${args.user} · rapor: ${outDir}`);
  if (!ctx.connections.some(c => c.role !== 'antrepo')) { log('[HATA] Refresh için aktif ASAS bağlantısı yok (Data Model Connection).'); return 2; }
  if (!ctx.connections.some(c => c.role === 'antrepo')) { log('[HATA] Refresh için aktif IAS (Antrepo) bağlantısı yok (Data Model Connection).'); return 2; }

  // Sıra: önce Excel (referans) yenilenir, ardından Database hemen sorgulanır;
  // iki okuma arasındaki süre kısa tutulur ki canlı veri değişimi fark üretmesin.
  const excel = args.excel ? await runExcelStep(bl, ctx, outDir, log, deps) : { enabled: false, problems: [] };
  const db = await runDbSteps(bl, ctx, args, log, deps);

  const { checks, csv } = buildComparisons(bl, ctx, args, excel, db);
  if (db.full && !db.full.ok) checks.unshift({ id: 'bl-yenileme', title: 'BL Database yenilemesi', verdict: 'HATA', lines: [db.full.error] });
  const verdicts = checks.map(check => check.verdict);
  const overall = verdicts.includes('HATA') || verdicts.includes('GEÇERSİZ') ? 'TAMAMLANAMADI'
    : verdicts.includes('BAŞARISIZ') ? 'BAŞARISIZ — veri farkı var'
      : verdicts.includes('UYARI') ? 'GEÇTİ (uyarılarla)' : 'GEÇTİ';
  const warnings = db.full && db.full.ok ? (db.full.value.warnings || []).map(String) : [];
  writeQueries(outDir, db);
  const report = {
    startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    version: bl.appVersion.DISPLAY_VERSION || bl.appVersion.APP_VERSION,
    user: args.user, kumas: args.kumas, tekrar: args.tekrar,
    sourceFolder: ctx.sourceFolder, sourceModes: ctx.sourceModes, connections: ctx.connections,
    overall, checks, timings: timingRows(db), warnings,
    horizons: db.full && db.full.ok ? (db.full.value.scopes || []).map(scope => ({
      target: TARGET_LABELS[scope.target] || scope.target, connection: scope.connection,
      text: scope.horizon && scope.horizon.text || '', rowCount: scope.rowCount,
    })) : [],
    excel: excel.enabled ? { enabled: true, valid: excel.valid, files: excel.files, refresh: excel.refresh, parse: excel.parse, problems: excel.problems, antrepoMeta: excel.antrepoMeta } : { enabled: false },
    csvFiles: Object.fromEntries(Object.entries(csv).map(([name, rows]) => [name, rows.length - 1])),
    csvRows: csv,
  };
  const text = writeReport(outDir, report);
  log('');
  log(text.split('\nAYRINTILAR')[0]);
  log(`Rapor klasörü: ${outDir}`);
  if (overall === 'TAMAMLANAMADI') return 2;
  if (overall.startsWith('BAŞARISIZ')) return 1;
  return 0;
}

module.exports = { main, parseArgs, setupEnvironment, loadBlContext, buildComparisons, engineSupport, TARGETS };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`[HATA] Beklenmeyen hata: ${error && error.stack || error}`);
    process.exitCode = 2;
  });
}
