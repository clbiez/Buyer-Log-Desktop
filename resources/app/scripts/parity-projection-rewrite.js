'use strict';
/*
 * Projeksiyon satır yaması yeniden yazımı: eski yol ↔ yeni yol parite ve ana iş parçacığı ölçümü
 * (#1078 takip / WS7b). Gerçek bir sayfa önbelleği nesli (ör. benchmark-cp-save-flow --keep-fixture
 * ile üretilmiş 2k/30k sentetik fixture) iki kopyaya alınır; aynı kayıt dizisi eski yolla
 * (rewriteGeneration + server.js transform'u, tam override nesnesi) ve yeni yolla (rewriteRowPatches)
 * uygulanır. Her modülün açılmış içeriği sha256 ile karşılaştırılır; her kaydın CP satırları da.
 *
 *   node scripts/parity-projection-rewrite.js --page-cache <root>/local/page-cache/moderator \
 *     --overrides <root>/data/overrides.json --steps 16 [--two-tabs] [--interval-ms 2500] [--out FILE]
 *
 * --interval-ms 0: bütün kayıtlar aynı anda kuyruğa girer. >0: açık döngü (kayıt hızı sabit).
 * Ölçülenler (kol başına): toplam süre, son kaydın tamamlanması, ana iş parçacığı CPU
 * (/proc/self/task/<pid>/stat), olay döngüsü gecikmesi (monitorEventLoopDelay p50/p95/max).
 */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

function args(argv) {
  const value = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
  const opts = { pageCache: value('--page-cache', ''), overrides: value('--overrides', ''), steps: Number(value('--steps', 16)), twoTabs: argv.includes('--two-tabs'),
    intervalMs: Number(value('--interval-ms', 0)), out: value('--out', ''), only: value('--only', '') };
  if (!opts.pageCache || !fs.existsSync(path.join(opts.pageCache, 'manifest.json'))) throw Error('--page-cache <user page-cache dir> required');
  return opts;
}
const opts = args(process.argv.slice(2));
const work = fs.mkdtempSync(path.join(process.env.BL_PARITY_WORK_DIR || os.tmpdir(), 'bl-rewrite-parity-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = work;
const pageCache = require('../server/lib/page-projection-cache');
const { applyIncrementalProjectionPatch, projectionPatchMatches } = require('../server/lib/projection-row-patch');
const { rowPatchContext } = require('../server/lib/projection-rewrite');
const parseLib = require('../server/lib/parse');
const { serialize } = require('../server/lib/compute-tasks');
const { closeProjectionRewritePool } = require('../server/lib/projection-rewrite-pool');

const TICK_MS = 1000 / (Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout) || 100);
function mainCpuMs() { const stat = fs.readFileSync(`/proc/self/task/${process.pid}/stat`, 'utf8'), f = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return (Number(f[11]) + Number(f[12])) * TICK_MS; }
const round = v => Number.isFinite(v) ? Math.round(v) : null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// server.js rewriteProjectionCacheForRowPatches transform'u (eski yol) — birebir.
function legacyTransform(clean, overrides, cpRows) {
  // server.js: legacyContext={...overrides,cpRowStored:shared} (CP satır kaydı base'i; burada paylaşılan belge = overrides).
  const legacyContext = { ...overrides, cpRowStored: overrides };
  return (_module, payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    const lists = [];
    if (Array.isArray(payload.rows)) lists.push(payload.rows);
    if (Array.isArray(payload.orderSummary)) lists.push(payload.orderSummary);
    for (const rows of lists) for (const row of rows) for (const item of clean) {
      if (projectionPatchMatches(row, item)) {
        applyIncrementalProjectionPatch(row, item.patch, legacyContext, _module !== 'orders', { cpStored: _module === 'cp' && rows === payload.rows, orderSummary: rows === payload.orderSummary });
        if (cpRows && _module === 'cp' && rows === payload.rows && !cpRows.includes(row)) cpRows.push(row);
      }
    }
    if (cpRows && _module === 'cp') cpRows.json = serialize(cpRows, 'projection');
    return payload;
  };
}

function copyUser(userId) {
  const dest = path.join(pageCache.ROOT, userId);
  fs.cpSync(opts.pageCache, dest, { recursive: true });
  return pageCache.loadManifest(userId);
}
function hashes(userId) {
  const manifest = pageCache.loadManifest(userId), modules = {};
  for (const module of Object.keys(manifest.modules)) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(pageCache.ROOT, userId, manifest.activeGeneration, module + '.json.gz')));
    modules[module] = crypto.createHash('sha256').update(raw).digest('hex');
  }
  return { contextHash: manifest.contextHash, sourceLoadedAt: manifest.sourceLoadedAt, sourceRevisionKey: manifest.sourceRevisionKey, runtimeMeta: manifest.runtimeMeta, modules };
}

function buildSteps(cpRows, baseOverrides) {
  const overrides = JSON.parse(JSON.stringify(baseOverrides || {}));
  overrides.notesmap = overrides.notesmap || {};
  const withApproval = cpRows.filter(row => row['Buying Son Onay Tarihi']);
  const plain = cpRows.filter(row => row['Model Name'] && row['C.Code']);
  const steps = [];
  for (let i = 0; i < opts.steps; i++) {
    const pool = i % 4 === 2 && withApproval.length ? withApproval : plain;
    const row = pool[(opts.twoTabs ? Math.floor(i / 2) : i) * 37 % pool.length];
    const orderCode = Number(row['Order Code']), model = String(row['Model Name']), ccode = String(row['C.Code']);
    const kind = opts.twoTabs ? (i % 2 ? 'delType' : 'notes') : ['notes', 'delType', 'exFactory', 'retail'][i % 4];
    const patch = { model, ccode };
    if (kind === 'notes') {
      patch.notes = { Notes: `parite ${i}` };
      overrides.notesmap[parseLib.orderLineKey(orderCode, model, ccode)] = { Notes: `parite ${i}`, NotesHtml: `<p>parite ${i}</p>`, NotesAt: `2026-11-20T12:00:${String(i).padStart(2, '0')}.000Z`, NotesBy: 'moderator', NotesByName: 'Moderator' };
    } else if (kind === 'delType') patch.delType = row['Del. Type'] === 'AIR' ? 'SEA' : 'AIR';
    else if (kind === 'exFactory') patch.dates = { exFactory: `2027-0${1 + (i % 9)}-1${i % 10}` };
    else patch.dates = { retailDate: `2027-0${1 + (i % 9)}-2${i % 8}` };
    steps.push({ items: [{ orderCode, patch }], overrides: JSON.parse(JSON.stringify(overrides)) });
  }
  return steps;
}

async function measure(label, runStep, steps, from) {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  const started = performance.now(), cpu0 = mainCpuMs();
  histogram.enable();
  const pending = [], done = [];
  for (const [index, step] of steps.entries()) {
    const at = performance.now();
    pending.push(runStep(step, index, index ? `p-${index}` : from, `p-${index + 1}`).then(result => { done[index] = performance.now() - at; return result; }));
    if (opts.intervalMs > 0 && index < steps.length - 1) await delay(opts.intervalMs);
  }
  const results = await Promise.all(pending);
  histogram.disable();
  const cpu1 = mainCpuMs();
  return { label, results, metrics: { wallMs: round(performance.now() - started), lastCompletionMs: round(done[done.length - 1]), completionMaxMs: round(Math.max(...done)),
    mainCpuMs: round(cpu1 - cpu0), mainCpuPerSaveMs: round((cpu1 - cpu0) / steps.length),
    loopDelayP50Ms: round(histogram.percentile(50) / 1e6), loopDelayP95Ms: round(histogram.percentile(95) / 1e6), loopDelayMaxMs: round(histogram.max / 1e6) } };
}

(async () => {
  const baseOverrides = opts.overrides ? JSON.parse(fs.readFileSync(opts.overrides, 'utf8')) : {};
  const legacyManifest = copyUser('legacy-user'); copyUser('new-user');
  const cp = (await pageCache.readProjection('legacy-user', 'cp', legacyManifest.contextHash)).data.rows;
  const steps = buildSteps(cp, baseOverrides), from = legacyManifest.contextHash;
  const report = { tool: 'parity-projection-rewrite', node: process.version, cpus: os.cpus().length, rows: cp.length, steps: steps.length, twoTabs: opts.twoTabs, intervalMs: opts.intervalMs,
    modules: Object.fromEntries(Object.entries(legacyManifest.modules).map(([m, meta]) => [m, meta.uncompressedBytes])) };
  const arms = [];
  if (opts.only !== 'new') arms.push(await measure('legacy', (step, index, fromHash, toHash) => {
    const cpRows = [];
    return pageCache.rewriteGeneration('legacy-user', { fromContextHash: fromHash, toContextHash: toHash, transform: legacyTransform(step.items, step.overrides, cpRows) }).then(manifest => ({ ok: Boolean(manifest), cpJson: cpRows.json }));
  }, steps, from));
  if (opts.only !== 'legacy') arms.push(await measure('incremental', (step, index, fromHash, toHash) => pageCache.rewriteRowPatches('new-user', {
    fromContextHash: fromHash, toContextHash: toHash, items: step.items, context: rowPatchContext(step.overrides, step.items), collectCpRows: true,
  }).then(result => ({ ok: Boolean(result && result.manifest), cpJson: result && serialize(result.cpRows, 'projection'), info: result && result.info })), steps, from));
  for (const arm of arms) report[arm.label] = { ...arm.metrics, allApplied: arm.results.every(r => r.ok), batches: arm.results.map(r => r.info && r.info.batchSize).filter(Boolean),
    via: [...new Set(arm.results.map(r => r.info && r.info.via).filter(Boolean))], changedModules: [...new Set(arm.results.flatMap(r => (r.info && r.info.changedModules) || []))] };
  if (arms.length === 2) {
    const a = hashes('legacy-user'), b = hashes('new-user');
    report.parity = { generation: JSON.stringify(a) === JSON.stringify(b), cpRowsPerSave: arms[0].results.every((r, i) => r.cpJson === arms[1].results[i].cpJson), legacy: a.modules, incremental: b.modules };
    report.parity.pass = report.parity.generation && report.parity.cpRowsPerSave;
  }
  await closeProjectionRewritePool();
  fs.rmSync(work, { recursive: true, force: true });
  const text = JSON.stringify(report, null, 2);
  if (opts.out) fs.writeFileSync(opts.out, text + '\n');
  console.log(text);
  if (report.parity && !report.parity.pass) process.exitCode = 1;
})().catch(error => { console.error(error); fs.rmSync(work, { recursive: true, force: true }); process.exitCode = 1; });
