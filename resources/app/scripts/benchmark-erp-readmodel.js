'use strict';

/*
 * ERP okuma modeli ölçüm kapısı (#1071 / WS0 #1072). Yalnız sentetik yerel veri.
 *
 *   node scripts/benchmark-erp-readmodel.js                       # bu checkout, 1 koşu, 30k satır
 *   node scripts/benchmark-erp-readmodel.js --runs 3              # baseline: 3 koşu + ortanca
 *   node scripts/benchmark-erp-readmodel.js --app-root ../main --candidate-root . --pairs 3
 *                                                                 # L2: dönüşümlü main/aday çiftleri
 * Seçenekler:
 *   --rows N (30000)  --runs N  --pairs N  --app-root DIR  --candidate-root DIR
 *   --modules cp,orders,koleksiyon,backlog   --post-open-timeout-ms (180000)
 *   --settle-ms (1500)  --module-timeout-ms (300000)  --top N (15)
 *   --source-fixture DIR (aynı kaynak baytlarını yeniden kullan)  --keep-fixture  --out FILE
 *   --post-open-window-ms N (iki kol için sabit açılış sonrası pencere)  --flag NAME=JSON (window anahtarı, tekrarlanabilir)
 *   --early-module orders [--early-delay-ms N] (açılıştan hemen sonra modül ilk açılışı)
 * Ortam: CHROMIUM_PATH (Chromium yolu), PLAYWRIGHT_MODULE.
 *
 * Senaryolar: (1) açılış sonrası pencere — bl:startup-complete → BACKGROUND_WARMUP_DONE
 * ya da süre sınırı: uzun görev sayısı/toplam/maks, olay döngüsü gecikmesi (50 ms
 * örnekleme: maks, >200 ms sayısı), JS heap; (2) modül ilk açılışı — tıklama → tablo
 * satırı görünür, pencere içindeki en uzun görev; (3) CPU atfı — CDP Profiler 500 µs,
 * self time ilk N ve en dıştaki app-main.js çerçevesi; (4) /api/page-projection/* ve
 * /api/data* yük boyutları. Geçici dosyalar sistem temp altındaki buyerlog-startup-*
 * dizinlerindedir ve koşu sonunda silinir (--keep-fixture hariç).
 */

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { runOnce, prepareSource, removeTemp, tempDir, MODULES } = require('./lib/erp-readmodel-run');
const { median, round } = require('./lib/erp-readmodel-probe');

const HARNESS_ROOT = path.resolve(__dirname, '..');
function parseArgs(argv) {
  const value = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const int = (name, fallback, min) => {
    const n = Number(value(name, fallback));
    if (!Number.isSafeInteger(n) || n < min) throw Error(`Invalid ${name}: ${value(name, fallback)}`);
    return n;
  };
  const candidate = value('--candidate-root', '');
  const opts = {
    rows: int('--rows', 30000, 100),
    runs: int('--runs', 1, 1),
    pairs: argv.includes('--pairs') ? int('--pairs', 3, 1) : 0,
    appRoot: path.resolve(value('--app-root', HARNESS_ROOT)),
    candidateRoot: candidate ? path.resolve(candidate) : null,
    modules: String(value('--modules', 'cp,orders,koleksiyon,backlog')).split(',').map(s => s.trim()).filter(Boolean),
    postOpenTimeoutMs: int('--post-open-timeout-ms', 180000, 1000),
    settleMs: int('--settle-ms', 1500, 0),
    moduleTimeoutMs: int('--module-timeout-ms', 300000, 1000),
    topN: int('--top', 15, 1),
    sourceFixture: value('--source-fixture', ''),
    keepFixture: argv.includes('--keep-fixture'),
    out: value('--out', ''),
    postOpenWindowMs: argv.includes('--post-open-window-ms') ? int('--post-open-window-ms', 25000, 1000) : 0,
    earlyModule: value('--early-module', ''),
    earlyDelayMs: int('--early-delay-ms', 0, 0),
    flags: Object.fromEntries(argv.flatMap((arg, i) => (arg === '--flag' ? [argv[i + 1]] : [])).map(pair => {
      const at = String(pair || '').indexOf('=');
      if (at < 1) throw Error('Invalid --flag (NAME=JSON): ' + pair);
      return [pair.slice(0, at), JSON.parse(pair.slice(at + 1))];
    })),
  };
  if (opts.earlyModule && !MODULES[opts.earlyModule]) throw Error('Unsupported --early-module: ' + opts.earlyModule);
  for (const m of opts.modules) if (!MODULES[m]) throw Error('Unsupported module: ' + m);
  if (opts.pairs && !opts.candidateRoot) throw Error('--pairs requires --candidate-root');
  if (opts.candidateRoot && !opts.pairs) opts.pairs = 3;
  for (const dir of [opts.appRoot, opts.candidateRoot].filter(Boolean)) if (!fs.existsSync(path.join(dir, 'server', 'server.js'))) throw Error('Not a Buyer Log app root: ' + dir);
  return opts;
}

// Her koşudan özet tablo metrikleri (düz sayı).
function flatMetrics(run) {
  const out = {};
  if (run.status === 'failed') return out;
  const po = run.postOpen || {};
  Object.assign(out, {
    'postOpen.durationMs': po.durationMs, 'postOpen.longTaskCount': po.longTasks?.count, 'postOpen.longTaskTotalMs': po.longTasks?.totalMs,
    'postOpen.longTaskMaxMs': po.longTasks?.maxMs, 'postOpen.lagMaxMs': po.eventLoopLag?.maxMs, 'postOpen.lagOver200': po.eventLoopLag?.over200Count,
    'postOpen.jsHeapMB': Number.isFinite(po.jsHeapUsedBytes) ? round(po.jsHeapUsedBytes / 1048576) : null,
    'startup.completeMs': run.events?.['bl:startup-complete'], 'startup.longTaskTotalMs': run.startup?.longTasks?.totalMs,
    'final.jsHeapMB': Number.isFinite(run.heapFinal?.jsHeapUsedBytes) ? round(run.heapFinal.jsHeapUsedBytes / 1048576) : null,
    // Açılıştan (bl:startup-complete) CP özet kartının ilk görünmesine kadar.
    'cpCards.sinceStartupMs': Number.isFinite(run.events?.['dom:cpCards']) && Number.isFinite(run.events?.['bl:startup-complete']) ? round(run.events['dom:cpCards'] - run.events['bl:startup-complete']) : null,
    'cpCards.sinceNavigationMs': run.events?.['dom:cpCards'],
  });
  if (run.early) { out[`early.${run.early.module}.openMs`] = run.early.timedOut ? null : run.early.openMs; out[`early.${run.early.module}.longTaskMaxMs`] = run.early.longTasks?.maxMs; }
  for (const m of run.modules || []) {
    out[`module.${m.module}.openMs`] = m.timedOut ? null : m.openMs;
    out[`module.${m.module}.longTaskMaxMs`] = m.longTasks?.maxMs;
  }
  const bytes = (run.payloads?.byPath || []).reduce((sum, p) => sum + p.decodedBytes, 0);
  out['payload.totalMB'] = round(bytes / 1048576, 2);
  for (const p of run.payloads?.byPath || []) out[`payload.${p.path}.KB`] = round(p.decodedBytes / 1024);
  return out;
}

function aggregate(runs) {
  const keys = [...new Set(runs.flatMap(r => Object.keys(r.metrics)))];
  return Object.fromEntries(keys.map(k => {
    const values = runs.map(r => r.metrics[k]);
    return [k, { median: round(median(values.filter(Number.isFinite)), 1), samples: values.map(v => (v === undefined ? null : v)) }];
  }));
}

function table(summary, labels) {
  const keys = [...new Set(labels.flatMap(l => Object.keys(summary[l] || {})))];
  const head = ['metric', ...labels.flatMap(l => [`${l} median`, `${l} samples`]), ...(labels.length === 2 ? ['Δ median'] : [])];
  const lines = [head.join(' | '), head.map(() => '---').join(' | ')];
  for (const key of keys) {
    const cells = [key];
    for (const l of labels) { const s = summary[l]?.[key]; cells.push(s?.median ?? '—', s ? s.samples.map(v => v ?? '—').join(', ') : '—'); }
    if (labels.length === 2) {
      const a = summary[labels[0]]?.[key]?.median, b = summary[labels[1]]?.[key]?.median;
      cells.push(Number.isFinite(a) && Number.isFinite(b) ? round(b - a, 1) : '—');
    }
    lines.push(cells.join(' | '));
  }
  return lines.join('\n');
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const log = msg => console.log(msg);
  const report = {
    schemaVersion: 1, tool: 'benchmark-erp-readmodel', synthetic: true, startedAt: new Date().toISOString(),
    harnessSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(path.join(__dirname, 'lib', 'erp-readmodel-run.js'))).update(fs.readFileSync(path.join(__dirname, 'lib', 'erp-readmodel-probe.js'))).digest('hex'),
    environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(),
      cpuQuota: fs.existsSync('/sys/fs/cgroup/cpu.max') ? fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null, browser: 'headless Chromium (Playwright)' },
    options: { ...opts, out: undefined }, runs: [],
    limitations: [
      `${process.platform} headless Chromium; Electron/Windows, antivirus and cold OS disk cache are not measured.`,
      'Desktop bridge is emulated (renderProfile, workspace.setModule) — native tabs/IPC are not exercised.',
      'Synthetic fixture (generate-demo-data, seed 7) dates are relative to the generation day; reuse --source-fixture for cross-day comparisons.',
      'Module first-open is measured after the post-open window (warmup may already have prepared the module).',
    ],
  };
  const outFile = path.resolve(opts.out || path.join(tempDir('erp-report'), 'report.json'));
  let source = null;
  try {
    source = prepareSource({ harnessRoot: HARNESS_ROOT, rows: opts.rows, sourceFixture: opts.sourceFixture });
    report.fixture = source.meta;
    const plan = [];
    if (opts.candidateRoot) {
      for (let i = 0; i < opts.pairs; i++) {
        const pair = [['main', opts.appRoot], ['candidate', opts.candidateRoot]];
        if (i % 2) pair.reverse(); // ABBA: sıra etkisini dengeler
        for (const [label, appRoot] of pair) plan.push({ label, appRoot, pair: i + 1 });
      }
    } else for (let i = 0; i < opts.runs; i++) plan.push({ label: 'main', appRoot: opts.appRoot, run: i + 1 });
    for (const [index, step] of plan.entries()) {
      log(`[${index + 1}/${plan.length}] ${step.label} ${step.appRoot}`);
      const run = await runOnce({ appRoot: step.appRoot, label: step.label, source, chromium, options: { ...opts, log } });
      run.pair = step.pair ?? null; run.order = index + 1;
      run.metrics = flatMetrics(run);
      report.runs.push(run);
      log(`  status=${run.status}${run.error ? ' error=' + run.error.message : ''} postOpen longTaskTotal=${run.postOpen?.longTasks?.totalMs} max=${run.postOpen?.longTasks?.maxMs} lagMax=${run.postOpen?.eventLoopLag?.maxMs}`);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile + '.partial', JSON.stringify(report, null, 2));
    }
    const labels = [...new Set(report.runs.map(r => r.label))];
    report.summary = Object.fromEntries(labels.map(l => [l, aggregate(report.runs.filter(r => r.label === l && r.status !== 'failed'))]));
    report.summaryTable = table(report.summary, labels);
    report.status = report.runs.every(r => r.status === 'passed') ? 'passed' : report.runs.some(r => r.status === 'failed') ? 'failed' : 'partial';
  } catch (error) {
    report.status = 'failed';
    report.error = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (source?.owned && !opts.keepFixture) removeTemp(source.holder);
    else if (source?.owned) report.sourceFixtureDir = source.dir;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
    fs.rmSync(outFile + '.partial', { force: true });
    if (report.summaryTable) console.log('\n' + report.summaryTable + '\n');
    console.log(`Report: ${outFile} (status=${report.status})`);
  }
  if (report.status !== 'passed') process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
