'use strict';
/*
 * Buyer Log — Windows/Electron otomatik kapı (CI-only; ürün paketine girmez).
 *
 * Gerçek paketlenmiş çalışma zamanı: bu betik BuyerLog.exe ile ELECTRON_RUN_AS_NODE=1
 * altında çalışır (Electron'un gömülü Node'u). Backend, KURULU uygulamanın kendi
 * electron/backend.js BackendProcess sınıfıyla başlatılır: üretimdeki gibi
 * BuyerLog.exe → (ELECTRON_RUN_AS_NODE) → server/watchdog.js → server/server.js,
 * aynı portable veri kökleri, aynı ortam ve aynı heap politikası (BUYER_LOG_MAX_HEAP_MB
 * ile <~15 GB RAM makinenin 3686 MB bütçesi zorlanır).
 *
 * Veri: sentetik 30k demo fixture (generate-demo-data.js, seed 7); her 4. ASAS satırında
 * yükleme onayı boşaltılır → Ex-factory elle düzenlenebilir satırlar
 * (tests/cp-rowpatch-default-exfactory-v20261127.test.js deseni). Gerçek iş verisi yok.
 *
 * Kullanım:
 *   set ELECTRON_RUN_AS_NODE=1
 *   BuyerLog.exe gate.js --app <kurulu>\resources\app --fixture-app <kaynak>\resources\app --out <klasör> [--rows 30000] [--soak-min 15] [--heap-mb 3686]
 * Çıkış kodu: FAIL/BLOCKED yoksa 0 (PASS/WARN/KNOWN/XPASS engellemez); aksi 1. Rapor: <out>/gate-report.json + gate-summary.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = { rows: 30000, soakMin: 15, heapMb: 3686, gapMs: 8000, strictKnown: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--app') out.app = path.resolve(next), i += 1;
    else if (key === '--fixture-app') out.fixtureApp = path.resolve(next), i += 1;
    else if (key === '--out') out.out = path.resolve(next), i += 1;
    else if (key === '--rows') out.rows = Number(next), i += 1;
    else if (key === '--soak-min') out.soakMin = Number(next), i += 1;
    else if (key === '--heap-mb') out.heapMb = Number(next), i += 1;
    else if (key === '--gap-ms') out.gapMs = Number(next), i += 1;
    else if (key === '--strict-known') out.strictKnown = true;
    else throw new Error('Bilinmeyen argüman: ' + key);
  }
  if (!out.app || !out.out) throw new Error('--app ve --out zorunlu');
  // Paketlenmiş uygulama demo üreticisini taşımaz (doğru: üretim paketi). Fixture kaynak ağacından üretilir.
  if (!out.fixtureApp) out.fixtureApp = out.app;
  return out;
}

const opt = parseArgs(process.argv.slice(2));
const APP = opt.app;
const OUT = opt.out;
fs.mkdirSync(OUT, { recursive: true });
const HOOK_LOG = path.join(OUT, 'server-hook.jsonl');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = iso(new Date());
const SHIP_CONF = 'Buying Son Onay Tarihi'; // i18n-ignore — ASAS kaynak başlığı
const PASSWORD = 'synthetic-electron-gate-123';
const PASSWORD_B = 'synthetic-electron-gate-456';

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  env: {
    execPath: process.execPath, node: process.versions.node, electron: process.versions.electron || null,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpus: `${os.cpus().length}× ${(os.cpus()[0] || {}).model || '?'}`,
    totalMemMb: Math.round(os.totalmem() / 1048576), NODE_OPTIONS: process.env.NODE_OPTIONS || '', commit: process.env.GITHUB_SHA || process.env.BUYER_LOG_GATE_COMMIT || null,
    appVersion: null, strictKnown: opt.strictKnown, app: opt.app, fixtureApp: opt.fixtureApp, rows: opt.rows, soakMin: opt.soakMin, heapMb: opt.heapMb,
  },
  timings: {}, gates: [], http: { requests: 0, n503: 0, exhausted: 0, byPath: {} }, edits: [], soak: null, memory: null, stops: [], errors: [],
};
const save = () => fs.writeFileSync(path.join(OUT, 'gate-report.json'), JSON.stringify(report, null, 1));
function gate(id, title, status, detail) {
  // Nihai (birleşik main) doğrulamada bilinen bulgular normal kapıdır: KNOWN → FAIL.
  if (opt.strictKnown && status === 'KNOWN') status = 'FAIL';
  report.gates.push({ id, title, status, detail });
  save();
  console.log(`[gate] ${status.padEnd(7)} ${id} ${title}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`);
}
const pass = cond => (cond ? 'PASS' : 'FAIL');

// ---- Fixture ----
function buildFixture() {
  const dir = path.join(OUT, 'source');
  fs.rmSync(dir, { recursive: true, force: true });
  const t = Date.now();
  const FIX = opt.fixtureApp;
  const g = spawnSync(process.execPath, [path.join(FIX, 'scripts', 'generate-demo-data.js'), dir, '--rows', String(opt.rows), '--seed', '7'], { cwd: FIX, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  if (g.status !== 0) throw new Error('fixture üretilemedi: ' + (g.stderr || g.stdout).slice(-2000));
  const XLSX = require(path.join(FIX, 'node_modules', 'xlsx'));
  const file = fs.readdirSync(dir).map(f => path.join(dir, f)).find(f => /^ASAS/i.test(path.basename(f)));
  const wb = XLSX.readFile(file);
  const name = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  const h = aoa.findIndex(row => Array.isArray(row) && row.includes(SHIP_CONF));
  if (h < 0) throw new Error('ASAS yükleme onayı sütunu yok');
  const col = aoa[h].indexOf(SHIP_CONF);
  let cleared = 0;
  for (let i = h + 1; i < aoa.length; i += 1) if ((i - h) % 4 === 1 && aoa[i] && aoa[i][col] != null) { aoa[i][col] = null; cleared += 1; }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), name);
  XLSX.writeFile(book, file, { bookType: 'xlsx' });
  report.timings.fixtureMs = Date.now() - t;
  report.fixture = { dir, asasRows: aoa.length - h - 1, loadingApprovalCleared: cleared };
  return dir;
}

async function freePort() {
  const s = net.createServer();
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address();
  await new Promise(resolve => s.close(resolve));
  return port;
}

// ---- Backend (üretim BackendProcess) ----
const { BackendProcess } = require(path.join(APP, 'electron', 'backend.js'));
const { desktopPaths } = require(path.join(APP, 'electron', 'portable-paths.js'));
const portableRoot = path.join(OUT, 'install');
fs.rmSync(portableRoot, { recursive: true, force: true });
const paths = desktopPaths(portableRoot);
let backend = null;
let base = '';
const desktopLog = path.join(OUT, 'desktop.log');
const logDesktop = line => { try { fs.appendFileSync(desktopLog, `[${new Date().toISOString()}] ${line}\n`); } catch (_) {} };
let unexpectedExits = 0;

function serverPid() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(paths.portableLocalAppData, 'BuyerLog', 'runtime', 'watchdog.json'), 'utf8')).serverPid) || 0; } catch (_) { return 0; }
}
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (_) { return false; } }

async function startBackend(label) {
  const t = Date.now();
  // Ölçüm kancası yalnız backend ortamına; heap bütçesi politika girdisiyle (BUYER_LOG_MAX_HEAP_MB) verilir,
  // NODE_OPTIONS'a heap bayrağı eklenmez (eklenirse politika 'inherited' olur ve işçi sınırını ezer).
  // NODE_OPTIONS çift tırnak içinde ters bölüyü kaçış sayar; Windows yolu ileri bölüyle verilir.
  const hookPath = path.join(__dirname, 'server-hook.js').replace(/\\/g, '/');
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, BUYER_LOG_MAX_HEAP_MB: process.env.BUYER_LOG_MAX_HEAP_MB, BUYER_LOG_GATE_HOOK_LOG: process.env.BUYER_LOG_GATE_HOOK_LOG };
  // Üretimde NODE_OPTIONS'ta heap bayrağı yoktur; ölçüm ortamından gelen bayrak backend'e taşınmaz.
  const hostOptions = String(process.env.NODE_OPTIONS || '').split(/\s+/).filter(part => part && !/^--max-old-space-size(=|$)/.test(part));
  process.env.NODE_OPTIONS = [...hostOptions, `--require "${hookPath}"`].join(' ');
  process.env.BUYER_LOG_MAX_HEAP_MB = String(opt.heapMb);
  process.env.BUYER_LOG_GATE_HOOK_LOG = HOOK_LOG;
  process.env.BUYER_LOG_CENTRAL_IAM_ENABLED = '0';
  backend = new BackendProcess({ paths, appCoreRoot: APP, log: logDesktop, onUnexpectedExit: info => { unexpectedExits += 1; logDesktop('UNEXPECTED ' + JSON.stringify(info)); } });
  const started = backend.start();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  base = started.origin;
  const ready = await backend.waitUntilReady();
  if (!ready.ready) throw new Error(`${label}: backend hazır olmadı (${ready.reason})`);
  for (let i = 0; i < 240; i += 1) { try { const r = await fetch(base + '/api/status'); if (r.status < 500) break; } catch (_) {} await delay(250); }
  const ms = Date.now() - t;
  report.timings[`start:${label}`] = ms;
  return ms;
}

async function stopBackend(label) {
  const pid = serverPid();
  const t = Date.now();
  const result = await backend.stop();
  // Sunucu (watchdog'un çocuğu) gerçekten kapandı mı? Windows'ta child.kill = TerminateProcess;
  // gözetmenin SIGTERM işleyicisi çalışmayabilir. Öksüz süreç kalırsa bulgu olarak kaydedilir.
  let orphanMs = 0;
  while (alive(pid) && Date.now() - t < 20000) await delay(250);
  const orphan = alive(pid);
  if (orphan) { orphanMs = Date.now() - t; try { process.kill(pid); } catch (_) {} await delay(1500); }
  const entry = { label, ms: Date.now() - t, forced: result.forced, serverPid: pid, orphan, orphanMs };
  report.stops.push(entry);
  save();
  return entry;
}

// ---- HTTP ----
async function call(method, url, body, cookie, { retry503 = /read-model/.test(url), headers = {} } = {}) {
  const t = performance.now();
  let n503 = 0;
  for (let attempt = 0; ; attempt += 1) {
    report.http.requests += 1;
    const r = await fetch(base + url, { method, headers: { cookie: cookie || '', 'Content-Type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    if (r.status === 503) {
      n503 += 1; report.http.n503 += 1;
      const key = url.split('?')[0];
      report.http.byPath[key] = (report.http.byPath[key] || 0) + 1;
      if (retry503 && attempt < 20) { await delay(500); continue; }
      if (retry503) report.http.exhausted += 1;
    }
    return { status: r.status, json, text: text.slice(0, 300), ms: Math.round(performance.now() - t), n503, headers: r.headers };
  }
}

async function login(body) {
  const r = await fetch(base + '/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('login ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return String(r.headers.get('set-cookie') || '').split(';')[0];
}

async function refresh(cookie) {
  const t = Date.now();
  const r = await call('POST', '/api/refresh', {}, cookie);
  if (r.status >= 300) throw new Error('refresh ' + r.status + ' ' + r.text);
  for (let i = 0; i < 2400; i += 1) {
    const st = await call('GET', '/api/refresh-status', undefined, cookie);
    if (st.json && !st.json.running) { if (st.json.error) throw new Error('refresh: ' + JSON.stringify(st.json.error).slice(0, 400)); return Date.now() - t; }
    await delay(500);
  }
  throw new Error('refresh zaman aşımı');
}

const FIELDS = ['_id', 'Order Code', 'Model Name', 'C.Code', 'Ex-factory', 'Ant. Arrival', 'STATUS', 'Del. Type', 'Supp. FOB', 'Notes', 'Ek Not', 'Licensor', 'Sub-Manufacturer', '_exFactoryRevision', '_logisticSegments'];
async function cpRows(cookie, fields = FIELDS) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await call('POST', '/api/read-model/cp/query', { version: 1, lang: 'tr', query: { version: 1, columns: [], base: [], groups: {}, today, offset, limit: 1000, fields } }, cookie);
    if (r.status !== 200) throw new Error('cp/query ' + r.status + ' ' + r.text);
    out.push(...r.json.result.rows);
    if (r.json.result.rows.length < 1000) return out;
  }
}
async function computed(cookie, since) {
  const r = await call('POST', '/api/read-model/cp/computed', { version: 1, lang: 'tr', ...(since ? { since } : {}) }, cookie);
  if (r.status !== 200) throw new Error('cp/computed ' + r.status + ' ' + r.text);
  const t = r.json.timing || {};
  return { ms: r.ms, n503: r.n503, cols: r.json.columns, rowPatch: t.service && t.service.rowPatch || null };
}
const tupleMap = cols => new Map((cols.rows || []).map(x => [String(x[0]), JSON.stringify(x)]));
const digestOf = map => crypto.createHash('sha1').update([...map.keys()].sort().map(id => id + '\u0000' + map.get(id)).join('\n')).digest('hex');
const viaRowPatch = c => Boolean(c.rowPatch && c.rowPatch.steps > 0);
// #1260 sonrası Del. Type / Ex-factory okuma yolu: satır yaması (steps>0) VEYA güvenli tam kurulum (kira yolu, rowPatch.miss;
// yeniden kurulamayan satır rowPatchRequiresFullBuild ile buraya düşer). Başka/bilinmeyen yol kabul edilmez.
const readPath = c => (viaRowPatch(c) ? 'rowPatch' : (c.rowPatch && Object.prototype.hasOwnProperty.call(c.rowPatch, 'miss') ? 'fullBuild:' + c.rowPatch.miss : 'unknown'));
const allowedPath = c => /^(rowPatch|fullBuild:)/.test(readPath(c));
async function ordersQuery(cookie) {
  const r = await call('POST', '/api/read-model/orders/query', { version: 1, offset: 0, limit: 100 }, cookie);
  return { status: r.status, ms: r.ms, rows: r.json && r.json.result && r.json.result.rows ? r.json.result.rows.length : null, total: r.json && r.json.result ? r.json.result.datasetRows || r.json.result.totalRows || null : null };
}
const strip = row => { const o = { ...row }; delete o._rowIndex; return o; };
const line = row => ({ model: row['Model Name'], ccode: row['C.Code'] });
const notesOf = (row, text) => ({ Notes: text, NotesHtml: text });
function walk(dir, out = []) { if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
function removeProjectionCache() {
  const removed = [];
  for (const f of walk(paths.dataRoot).filter(p => /page-cache/.test(p) && /manifest\.json(\.bak)?$/.test(p))) {
    removed.push(path.relative(paths.dataRoot, path.dirname(f)));
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
  return removed;
}

// ---- Bellek özeti (kanca günlüğünden) ----
function memorySummary(fromT = 0) {
  const recs = fs.existsSync(HOOK_LOG) ? fs.readFileSync(HOOK_LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean) : [];
  const hooks = recs.filter(r => r.ev === 'hook');
  const mem = recs.filter(r => r.ev === 'mem' && r.t >= fromT);
  const results = recs.filter(r => r.ev === 'result' && r.t >= fromT);
  const pools = recs.filter(r => r.ev === 'pool' && r.t >= fromT);
  const mb = v => (v == null ? null : Math.round(v / 1048576));
  const max = (list, k) => list.reduce((m, r) => (r[k] > m ? r[k] : m), 0);
  return {
    hookLoaded: hooks.length > 0, serverStarts: hooks.length, heapLimitMb: hooks.length ? hooks[hooks.length - 1].heapLimitMb : null,
    samples: mem.length, rssMaxMb: mb(max(mem, 'rss')), peakRssMb: mb(max(mem, 'maxRss')), heapUsedMaxMb: mb(max(mem, 'heapUsed')),
    workerSpawns: recs.filter(r => r.ev === 'spawn' && r.t >= fromT).length, workerExits: recs.filter(r => r.ev === 'exit' && r.t >= fromT).length,
    workerErrors: recs.filter(r => r.ev === 'error' && r.t >= fromT).map(r => r.code).slice(0, 10),
    jobFailures: results.filter(r => r.ok === false).map(r => r.code).slice(0, 20), jobs: results.length,
    retainedMaxMb: mb(Math.max(0, ...results.map(r => Number(r.retained) || 0))),
    poolRetainedMaxMb: mb(Math.max(0, ...pools.flatMap(p => ['main', 'lane'].map(k => (p[k] && Number(p[k].retained)) || 0)))),
    mem,
  };
}
function thirds(series, key) {
  if (series.length < 9) return null;
  const n = Math.floor(series.length / 3);
  const med = list => { const s = list.map(r => r[key]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { firstMb: Math.round(med(series.slice(0, n)) / 1048576), lastMb: Math.round(med(series.slice(-n)) / 1048576) };
}

// ---- Senaryolar ----
async function main() {
  report.env.appVersion = (JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) || {}).version || null;
  save();
  console.log('[gate] ortam', JSON.stringify(report.env));
  const source = buildFixture();
  fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
  const port = await freePort();
  fs.writeFileSync(paths.configPath, JSON.stringify({ port, host: '127.0.0.1', sourceFolder: source }, null, 2));
  fs.mkdirSync(paths.localDataRoot, { recursive: true });
  fs.writeFileSync(path.join(paths.localDataRoot, 'data-cleanup-state.json'), JSON.stringify({ schemaVersion: 1, lastCheckAt: new Date().toISOString() }) + '\n');

  // G01 açılış: ilk başlatma → giriş → tam yenileme (30k) → yeniden başlatma (sıcak açılış).
  const coldMs = await startBackend('cold');
  let cookieA = await login({ userId: 'moderator', password: PASSWORD, newPassword: PASSWORD });
  report.timings.refreshMs = await refresh(cookieA);
  await stopBackend('after-refresh');
  const warmMs = await startBackend('warm');
  cookieA = await login({ userId: 'moderator', password: PASSWORD, newPassword: PASSWORD });
  const open = await computed(cookieA);
  const ordersOpen = await ordersQuery(cookieA);
  report.timings.cpOpenMs = open.ms; report.timings.ordersOpenMs = ordersOpen.ms;
  const openRows = (open.cols.rows || []).length;
  gate('G01', 'Açılış: BuyerLog.exe → watchdog → server; 30k yenileme; sıcak açılışta CP + Siparişler', pass(openRows > 0 && ordersOpen.status === 200 && warmMs < 90000),
    { coldMs, warmMs, refreshMs: report.timings.refreshMs, cpOpenMs: open.ms, cpRows: openRows, ordersStatus: ordersOpen.status, ordersMs: ordersOpen.ms });

  const created = await call('POST', '/api/users', { username: 'mod2', displayName: 'Gate B', title: 'T', password: PASSWORD_B, systemRole: 'moderator', reason: 'kapı', confirmCritical: true }, cookieA);
  const cookieU2 = await login({ username: 'mod2', password: PASSWORD_B, newPassword: PASSWORD_B });
  // Aynı sunucuya ikinci istemci: aynı kullanıcının bağımsız ikinci oturumu (masaüstü penceresi + tarayıcı
  // sekmesi). Farklı kullanıcının (mod2) kendi kaynak/önbellek kapsamı vardır; aynı veriyi görmesi beklenmez.
  let cookieB = await login({ userId: 'moderator', password: PASSWORD });
  report.users = { createStatus: created.status, secondSessionDistinct: cookieB !== cookieA };

  const rows = await cpRows(cookieA);
  gate('G02', 'CP / Siparişler okuma: CP sorgu satırı = computed satırı', pass(rows.length === openRows && rows.length > 1000), { cpQueryRows: rows.length, computedRows: openRows });

  const used = new Set();
  const take = list => { const row = list.find(r => !used.has(String(r['Order Code']))); if (!row) throw new Error('aday satır yok'); used.add(String(row['Order Code'])); return row; };
  const plain = rows.filter((_, i) => i % 7 === 3);
  const edit = async (kind, fn) => { const r = await fn(); report.edits.push({ kind, status: r.status, ms: r.ms, code: r.json && r.json.code || null }); save(); return r; };

  // G03 Supp. FOB tekli + toplu (gövdede delType yok).
  const fob1 = take(plain);
  const fobA = take(plain), fobB = take(plain);
  const s1 = await edit('suppFob PATCH', () => call('PATCH', '/api/overrides/' + fob1['Order Code'], { ...line(fob1), notes: { Notes: fob1.Notes || '', NotesHtml: '', EkNot: fob1['Ek Not'] || '', EkNotHtml: '' }, suppFob: 123.25, suppFobMeta: { source: 'manual' } }, cookieA));
  const afterFob = await computed(cookieA);
  const s2 = await edit('batch-suppfob', () => call('POST', '/api/overrides/batch-suppfob', { items: [fobA, fobB].map((r, k) => ({ orderCode: r['Order Code'], ...line(r), suppFob: 200.5 + k })) }, cookieA));
  // G04 not tekli + toplu.
  const note1 = take(plain);
  const noteBulk = [take(plain), take(plain), take(plain), take(plain), take(plain)];
  const n1 = await edit('note batch(1)', () => call('POST', '/api/overrides/batch', { items: [{ orderCode: note1['Order Code'], patch: { ...line(note1), notes: notesOf(note1, 'kapı not tekli') } }] }, cookieA));
  const n2 = await edit('note batch(5)', () => call('POST', '/api/overrides/batch', { items: noteBulk.map((r, k) => ({ orderCode: r['Order Code'], patch: { ...line(r), notes: notesOf(r, 'kapı not toplu ' + k) } })) }, cookieA));

  // G05 Del. Type (açık niyet) + aynı satıra Supp. FOB / not sonrası korunur (#1243); yol satır yaması veya güvenli tam kurulum (#1260).
  const prodOnly = rows.filter(r => Array.isArray(r._logisticSegments) && r._logisticSegments.length && r._logisticSegments.every(s => s.kind === 'production') && r['Del. Type'] && !used.has(String(r['Order Code'])));
  const delRow = take(prodOnly.length ? prodOnly : plain);
  const newDel = delRow['Del. Type'] === 'Uçak' ? 'Gemi' : 'Uçak'; // i18n-ignore — Del. Type veri değeri
  const d1 = await edit('delType PATCH', () => call('PATCH', '/api/overrides/' + delRow['Order Code'], { ...line(delRow), delType: newDel }, cookieU2));
  const afterDel = await computed(cookieA);
  // G06b: aynı oturumun Del. Type yazımı satır yaması yolunda okunmalı (#1260'ın kendisi). İkinci kullanıcının yazımı A'nın
  // satır yaması zincirinde olmayabilir (kullanıcı kapsamlı günlük) → G05'te tam kurulum yolu da geçerlidir.
  const delRowA = take(prodOnly.length ? prodOnly : plain);
  const newDelA = delRowA['Del. Type'] === 'Uçak' ? 'Gemi' : 'Uçak'; // i18n-ignore — Del. Type veri değeri
  const d2 = await edit('delType PATCH (same session)', () => call('PATCH', '/api/overrides/' + delRowA['Order Code'], { ...line(delRowA), delType: newDelA }, cookieA));
  const afterDelA = await computed(cookieA);
  await edit('suppFob on delType row', () => call('PATCH', '/api/overrides/' + delRow['Order Code'], { ...line(delRow), notes: { Notes: delRow.Notes || '', NotesHtml: '', EkNot: delRow['Ek Not'] || '', EkNotHtml: '' }, suppFob: 55.5, suppFobMeta: { source: 'manual' } }, cookieA));
  await edit('note on delType row', () => call('POST', '/api/overrides/batch', { items: [{ orderCode: delRow['Order Code'], patch: { ...line(delRow), notes: notesOf(delRow, 'kapı del not') } }] }, cookieA));

  // G06 elle düzenlenebilir Ex-factory (PATCH + /batch), G07 otomatik Ex-factory 409.
  const manual = rows.filter(r => r['Ex-factory'] && !(r._exFactoryRevision && r._exFactoryRevision.source === 'loading-approval'));
  const automatic = rows.filter(r => r._exFactoryRevision && r._exFactoryRevision.source === 'loading-approval');
  const shift = (row, days) => { const d = new Date(row['Ex-factory']); d.setDate(d.getDate() + days); return iso(d); };
  const exRow = take(manual), exBatchRow = take(manual), autoRow = take(automatic);
  const exTarget = shift(exRow, 10), exBatchTarget = shift(exBatchRow, -12);
  const e1 = await edit('exFactory PATCH', () => call('PATCH', '/api/overrides/' + exRow['Order Code'], { ...line(exRow), dates: { exFactory: exTarget } }, cookieA));
  const afterEx = await computed(cookieA);
  const e2 = await edit('exFactory batch', () => call('POST', '/api/overrides/batch', { items: [{ orderCode: exBatchRow['Order Code'], patch: { ...line(exBatchRow), dates: { exFactory: exBatchTarget } } }] }, cookieA));
  const afterExBatch = await computed(cookieA);
  const a1 = await edit('exFactory automatic', () => call('PATCH', '/api/overrides/' + autoRow['Order Code'], { ...line(autoRow), dates: { exFactory: shift(autoRow, 5) } }, cookieA));

  // G08 çoklu istemci: iki oturum aynı sunucuya eşzamanlı yazar. Farklı satırlar + aynı satırda farklı alanlar,
  // alan kapsamlı yollarla (A: toplu Supp. FOB, B: not satır kaydı /rows + base — gerçek istemcinin not yolu).
  const shared = take(plain), onlyA = take(plain), onlyB = take(plain);
  const noteRow = (r, text) => ({ items: [{ orderCode: Number(r['Order Code']), patch: { ...line(r), notes: { Notes: text } }, base: { notes: { Notes: r.Notes || '' } } }] });
  const [c1, c2, c3, c4] = await Promise.all([
    call('POST', '/api/overrides/batch-suppfob', { items: [{ orderCode: shared['Order Code'], ...line(shared), suppFob: 77.75 }] }, cookieA),
    call('POST', '/api/overrides/rows', noteRow(shared, 'kapı B aynı satır'), cookieB),
    call('PATCH', '/api/overrides/' + onlyA['Order Code'], { ...line(onlyA), notes: { Notes: onlyA.Notes || '', NotesHtml: '', EkNot: onlyA['Ek Not'] || '', EkNotHtml: '' }, suppFob: 88.5, suppFobMeta: { source: 'manual' } }, cookieA),
    call('POST', '/api/overrides/rows', noteRow(onlyB, 'kapı B tekil'), cookieB),
  ]);
  // G08b bayat istemci (bulgu): B notu kaydeder; A, notu görmeden aynı satırda tekli Supp. FOB kaydeder. Gerçek
  // istemci (syncOverrideToServer) Supp. FOB kaydını eski PATCH yoluna gönderir ve gövdeye kendi bildiği notes'u koyar.
  const stale = take(plain);
  const staleNote = await call('POST', '/api/overrides/rows', noteRow(stale, 'kapı B önce yazdı'), cookieB);
  const staleFob = await call('PATCH', '/api/overrides/' + stale['Order Code'], { ...line(stale), notes: { Notes: stale.Notes || '', NotesHtml: '', EkNot: stale['Ek Not'] || '', EkNotHtml: '' }, suppFob: 66.25, suppFobMeta: { source: 'manual' } }, cookieA);
  // Gerçek istemci gövdesi (syncOverrideToServer): DTR olmayan satırda subManufacturer da istemcinin bildiği değerle gider.
  const clientBody = (r, extra) => ({ ...line(r), notes: { Notes: r.Notes || '', NotesHtml: '', EkNot: r['Ek Not'] || '', EkNotHtml: '' }, ...(String(r.Licensor || '').toUpperCase() !== 'DTR' ? { subManufacturer: r['Sub-Manufacturer'] || '' } : {}), ...extra });
  // DTR satırında istemci subManufacturer göndermez; senaryo yalnız DTR olmayan satırda anlamlıdır (demo fixture'da yok → N/A).
  const nonDtr = rows.filter(r => r.Licensor && String(r.Licensor).toUpperCase() !== 'DTR' && !used.has(String(r['Order Code'])));
  report.licensorCounts = rows.reduce((m, r) => { const k = String(r.Licensor || '(boş)'); m[k] = (m[k] || 0) + 1; return m; }, {});
  // G08c: B Sub-Manufacturer'ı değiştirir; A (görmemiş) tekli Supp. FOB kaydeder.
  const staleSub = nonDtr.length ? take(nonDtr) : null;
  const subWrite = staleSub ? await call('PATCH', '/api/overrides/' + staleSub['Order Code'], { ...line(staleSub), subManufacturer: 'KAPI B ALT URETICI' }, cookieB) : null;
  const subFob = staleSub ? await call('PATCH', '/api/overrides/' + staleSub['Order Code'], clientBody(staleSub, { suppFob: 44.5, suppFobMeta: { source: 'manual' } }), cookieA) : null;
  // G08d: A satırda elle Supp. FOB yazar (satır manuel olur); B daha yeni Supp. FOB yazar; A (bayat) yalnız not
  // kaydeder — gerçek istemci manuel Supp. FOB'lu satırın not kaydında suppFob'u da gönderir.
  const staleNoteRow = take(plain);
  const fobA0 = await call('PATCH', '/api/overrides/' + staleNoteRow['Order Code'], clientBody(staleNoteRow, { suppFob: 10.5, suppFobMeta: { source: 'manual' } }), cookieA);
  const fobB1 = await call('POST', '/api/overrides/batch-suppfob', { items: [{ orderCode: staleNoteRow['Order Code'], ...line(staleNoteRow), suppFob: 20.75 }] }, cookieB);
  const noteA2 = await call('PATCH', '/api/overrides/' + staleNoteRow['Order Code'], clientBody(staleNoteRow, { notes: { Notes: 'kapı A bayat not', NotesHtml: 'kapı A bayat not', EkNot: '', EkNotHtml: '' }, suppFob: 10.5, suppFobMeta: { source: 'manual' } }), cookieA);
  // #1257 sonrası istemci modeli (public/app-main.js cpLegacyBodyWithoutUnchanged + override-sync.js adoptAckRevision):
  // eski yol gövdesi satırın kayıtlı değeriyle aynı not/alt üretici/lisansörü taşımaz; Supp. FOB yalnız açık niyetle gider;
  // If-Match / X-Supp-Fob-Revision = A'nın yalnız kendi onaylı yazımlarıyla ilerleyen belirteci (başka oturumun yazımı görülmemiş).
  // PASS: B'nin değeri korunur (409 REVISION_CONFLICT → yazım yok, ya da 200 → kırpılmış gövde B'nin alanına dokunmaz).
  const tokenOf = (resp, prev) => ({ orders: Number(resp && resp.json && (resp.json.revision ?? (resp.json.revisions && resp.json.revisions.orders))) || prev.orders, suppFob: Number(resp && resp.json && resp.json.revisions && resp.json.revisions.suppFob) || prev.suppFob });
  const casHeaders = tok => ({ 'If-Match': String(tok.orders || 0), 'X-Supp-Fob-Revision': String(tok.suppFob || 0) });
  const modern = {};
  {
    // G08b': A kendi yazımıyla belirteç alır → B not yazar → A (bayat) yalnız Supp. FOB gönderir (not değişmedi → gövdede yok).
    const rowB = take(plain), own = take(plain);
    const a0 = await call('PATCH', '/api/overrides/' + own['Order Code'], { ...line(own), suppFob: 12.5, suppFobMeta: { source: 'manual' } }, cookieA);
    const tok = tokenOf(a0, { orders: 0, suppFob: 0 });
    const b1 = await call('POST', '/api/overrides/rows', noteRow(rowB, 'kapı B yeni not (modern)'), cookieB);
    const a2 = await call('PATCH', '/api/overrides/' + rowB['Order Code'], { ...line(rowB), suppFob: 33.25, suppFobMeta: { source: 'manual' } }, cookieA, { headers: casHeaders(tok) });
    modern.b = { row: rowB, statuses: [a0.status, b1.status, a2.status], code: a2.json && a2.json.code, token: tok };
    // G08d': A manuel Supp. FOB yazar → B daha yeni Supp. FOB → A (bayat) yalnız not kaydeder (açık fiyat niyeti yok → gövdede suppFob yok).
    const rowD = take(plain);
    const d0 = await call('PATCH', '/api/overrides/' + rowD['Order Code'], { ...line(rowD), suppFob: 10.5, suppFobMeta: { source: 'manual' } }, cookieA);
    const tokD = tokenOf(d0, tok);
    const d1 = await call('POST', '/api/overrides/batch-suppfob', { items: [{ orderCode: rowD['Order Code'], ...line(rowD), suppFob: 20.75 }] }, cookieB);
    const d2 = await call('PATCH', '/api/overrides/' + rowD['Order Code'], { ...line(rowD), notes: { Notes: 'kapı A not (modern)', NotesHtml: 'kapı A not (modern)' } }, cookieA, { headers: casHeaders(tokD) });
    modern.d = { row: rowD, statuses: [d0.status, d1.status, d2.status], code: d2.json && d2.json.code, token: tokD };
  }
  report.edits.push({ kind: 'concurrent', statuses: [c1.status, c2.status, c3.status, c4.status] });

  await delay(1500);
  const sessionA = await computed(cookieA);
  const sessionB = await computed(cookieB);
  const live = new Map((await cpRows(cookieA)).map(r => [String(r._id), strip(r)]));
  const liveB = new Map((await cpRows(cookieB)).map(r => [String(r._id), strip(r)]));
  const v = id => live.get(String(id)) || {};
  gate('G03', 'Supp. FOB tekli + toplu kayıt görünür; tekli kayıt satır yaması yolunda', pass(s1.status === 200 && s2.status === 200 && Number(v(fob1._id)['Supp. FOB']) === 123.25 && Number(v(fobA._id)['Supp. FOB']) === 200.5 && Number(v(fobB._id)['Supp. FOB']) === 201.5 && viaRowPatch(afterFob)),
    { single: s1.status, bulk: s2.status, rowPatch: afterFob.rowPatch });
  gate('G04', 'Not tekli + toplu (5) kayıt görünür', pass(n1.status === 200 && n2.status === 200 && v(note1._id).Notes === 'kapı not tekli' && noteBulk.every((r, k) => v(r._id).Notes === 'kapı not toplu ' + k)), { single: n1.status, bulk: n2.status });
  gate('G07', 'Otomatik (yükleme onaylı) Ex-factory yazımı 409 AUTOMATIC_DATE_READ_ONLY; değer korunur', pass(a1.status === 409 && a1.json && a1.json.code === 'AUTOMATIC_DATE_READ_ONLY' && v(autoRow._id)['Ex-factory'] === autoRow['Ex-factory']),
    { status: a1.status, code: a1.json && a1.json.code, automaticCandidates: automatic.length });
  const sameDigest = digestOf(tupleMap(sessionA.cols)) === digestOf(tupleMap(sessionB.cols));
  const sameRows = [...live.keys()].every(id => JSON.stringify(live.get(id)) === JSON.stringify(liveB.get(id)));
  const mapA = tupleMap(sessionA.cols), mapB = tupleMap(sessionB.cols);
  const tupleDiffs = [...new Set([...mapA.keys(), ...mapB.keys()])].filter(id => mapA.get(id) !== mapB.get(id));
  const rowDiffs = [...live.keys()].filter(id => JSON.stringify(live.get(id)) !== JSON.stringify(liveB.get(id)));
  const fieldDiff = id => { const a = live.get(id) || {}, b = liveB.get(id) || {}; return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => `${k}: ${JSON.stringify(a[k])} ↔ ${JSON.stringify(b[k])}`).slice(0, 4); };
  report.multiClient = { tupleCounts: [mapA.size, mapB.size], tupleDiffCount: tupleDiffs.length, tupleDiffExamples: tupleDiffs.slice(0, 3).map(id => ({ id, a: (mapA.get(id) || '').slice(0, 300), b: (mapB.get(id) || '').slice(0, 300) })), rowDiffCount: rowDiffs.length, rowDiffExamples: rowDiffs.slice(0, 3).map(id => ({ id, fields: fieldDiff(id) })) };
  gate('G08', 'Çoklu istemci (aynı kullanıcının iki oturumu): eşzamanlı 4 yazım 2xx, aynı satırda iki alan da korunur, iki oturum aynı veriyi görür', pass([c1, c2, c3, c4].every(r => r.status === 200) && Number(v(shared._id)['Supp. FOB']) === 77.75 && v(shared._id).Notes === 'kapı B aynı satır' && Number(v(onlyA._id)['Supp. FOB']) === 88.5 && v(onlyB._id).Notes === 'kapı B tekil' && sameDigest && sameRows),
    { statuses: [c1.status, c2.status, c3.status, c4.status], values: { sharedFob: v(shared._id)['Supp. FOB'], sharedNote: v(shared._id).Notes, onlyAFob: v(onlyA._id)['Supp. FOB'], onlyBNote: v(onlyB._id).Notes }, sameDigest, sameRows, tupleDiffCount: tupleDiffs.length, rowDiffCount: rowDiffs.length, rowDiffExamples: report.multiClient.rowDiffExamples });

  // G09 yeniden başlatma sonrası eşitlik (önbellek korunur).
  const sessionDigest = digestOf(tupleMap(sessionA.cols));
  const memBeforeRestart = memorySummary();
  const stop1 = await stopBackend('restart');
  await startBackend('restart');
  cookieA = await login({ userId: 'moderator', password: PASSWORD });
  const afterRestart = await computed(cookieA);
  const liveRestart = new Map((await cpRows(cookieA)).map(r => [String(r._id), strip(r)]));
  const restartDiff = [...live.keys()].filter(id => JSON.stringify(live.get(id)) !== JSON.stringify(liveRestart.get(id)));
  {
    const got = v(stale._id);
    const reproduced = staleNote.status === 200 && staleFob.status === 200 && got.Notes !== 'kapı B önce yazdı';
    gate('G08b-eski', 'Bilgi: #1257 öncesi istemci gövdesi (eski notes, If-Match yok) — sunucu bayat tam gövdeyi kabul eder mi', reproduced ? 'INFO' : 'INFO',
      { finding: 'syncOverrideToServer Supp. FOB kaydını PATCH /api/overrides/:oc yoluna gönderir ve gövdeye istemcinin bildiği notes alanını koyar (cpRowSaveEligible suppFob içeren gövdeyi satır kaydından çıkarır); sunucu notes alanını koşulsuz yazar → sessiz kayıp', statuses: [staleNote.status, staleFob.status], noteAfter: got.Notes, fobAfter: got['Supp. FOB'] });
  }
  {
    if (!staleSub) gate('G08c', 'Bayat istemci: tekli Supp. FOB kaydı başka oturumun yeni Sub-Manufacturer değerini ezmemeli', 'N/A', { reason: 'fixture\'da DTR olmayan satır yok (istemci DTR satırında subManufacturer göndermez)', licensorCounts: report.licensorCounts });
    else {
      const sub = v(staleSub._id);
      const reproducedC = subWrite.status === 200 && subFob.status === 200 && sub['Sub-Manufacturer'] !== 'KAPI B ALT URETICI';
      gate('G08c', 'Bayat istemci: tekli Supp. FOB kaydı (gövdede eski subManufacturer) başka oturumun yeni Sub-Manufacturer değerini ezmemeli', reproducedC ? 'KNOWN' : 'XPASS',
        { finding: 'G08b ile aynı yol: DTR olmayan satırda Supp. FOB kaydı gövdesi istemcinin bildiği subManufacturer değerini taşır', statuses: [subWrite.status, subFob.status], subAfter: sub['Sub-Manufacturer'], before: staleSub['Sub-Manufacturer'] });
    }
    const nr = v(staleNoteRow._id);
    const reproducedD = fobA0.status === 200 && fobB1.status === 200 && noteA2.status === 200 && Number(nr['Supp. FOB']) !== 20.75;
    gate('G08d-eski', 'Bilgi: #1257 öncesi istemci gövdesi (not kaydında eski suppFob, If-Match yok)', 'INFO',
      { finding: 'syncOverrideToServer, _suppFobManual satırda not kaydına suppFob ekler; gövde suppFob içerdiği için satır kaydı yerine eski PATCH yolu kullanılır', statuses: [fobA0.status, fobB1.status, noteA2.status], fobAfter: nr['Supp. FOB'], noteAfter: nr.Notes });
  }
  {
    const b = v(modern.b.row._id), d = v(modern.d.row._id);
    const okB = modern.b.statuses[0] === 200 && modern.b.statuses[1] === 200 && b.Notes === 'kapı B yeni not (modern)' && (modern.b.statuses[2] === 409 || (modern.b.statuses[2] === 200 && Number(b['Supp. FOB']) === 33.25));
    gate('G08b', 'Bayat oturum (#1257 istemci sözleşmesi): Supp. FOB kaydı başka oturumun yeni notunu ezmez (409 ya da not korunur)', pass(okB),
      { statuses: modern.b.statuses, code: modern.b.code, noteAfter: b.Notes, fobAfter: b['Supp. FOB'], token: modern.b.token });
    const okD = modern.d.statuses[0] === 200 && modern.d.statuses[1] === 200 && Number(d['Supp. FOB']) === 20.75 && (modern.d.statuses[2] === 409 || (modern.d.statuses[2] === 200 && d.Notes === 'kapı A not (modern)'));
    gate('G08d', 'Bayat oturum (#1257 istemci sözleşmesi): not kaydı başka oturumun daha yeni Supp. FOB değerini ezmez (409 ya da Supp. FOB korunur)', pass(okD),
      { statuses: modern.d.statuses, code: modern.d.code, fobAfter: d['Supp. FOB'], noteAfter: d.Notes, token: modern.d.token });
  }
  gate('G09', 'Yeniden başlatma sonrası eşitlik (karar demeti + CP satırları)', pass(digestOf(tupleMap(afterRestart.cols)) === sessionDigest && restartDiff.length === 0 && liveRestart.size === live.size),
    { tuples: tupleMap(afterRestart.cols).size, rowDiffs: restartDiff.slice(0, 5), rowDiffCount: restartDiff.length });

  // G10 sıfırdan tam kurulum eşitliği (projeksiyon önbelleği silinir).
  await stopBackend('rebuild');
  const removed = removeProjectionCache();
  await startBackend('rebuild');
  cookieA = await login({ userId: 'moderator', password: PASSWORD });
  const rebuilt = await computed(cookieA);
  const liveRebuilt = new Map((await cpRows(cookieA)).map(r => [String(r._id), strip(r)]));
  const rebuildDiff = [...live.keys()].filter(id => JSON.stringify(live.get(id)) !== JSON.stringify(liveRebuilt.get(id)));
  gate('G10', 'Sıfırdan tam kurulum (önbellek silinip yeniden başlatma) oturum verisiyle birebir', pass(removed.length > 0 && digestOf(tupleMap(rebuilt.cols)) === sessionDigest && rebuildDiff.length === 0 && liveRebuilt.size === live.size),
    { cacheRemoved: removed, rowDiffs: rebuildDiff.slice(0, 5), rowDiffCount: rebuildDiff.length });

  // G05 / G06 / G06b (#1260 değişmezi): değer hedefle aynı + okuma yolu satır yaması VEYA güvenli tam kurulum + dokunulan
  // satır sıfırdan tam kurulumla (G10 yeniden kurulumu) alan alan eşit. G06b: en az bir Del. Type ve bir Ex-factory adımı
  // satır yaması yolunda (artımlı yolun gerçekten kullanıldığını sınar).
  const sameAsRebuild = row => JSON.stringify(live.get(String(row._id))) === JSON.stringify(liveRebuilt.get(String(row._id)));
  gate('G05', 'Del. Type (açık niyet, ikinci kullanıcı) görünür; sonraki Supp. FOB/not Del. Type\'ı değiştirmez; yol satır yaması veya güvenli tam kurulum; satır tam kurulumla eşit',
    pass(d1.status === 200 && v(delRow._id)['Del. Type'] === newDel && Number(v(delRow._id)['Supp. FOB']) === 55.5 && v(delRow._id).Notes === 'kapı del not' && allowedPath(afterDel) && sameAsRebuild(delRow)),
    { status: d1.status, before: delRow['Del. Type'], want: newDel, got: v(delRow._id)['Del. Type'], prodOnlyCandidates: prodOnly.length, path: readPath(afterDel), rowPatch: afterDel.rowPatch, equalToRebuild: sameAsRebuild(delRow) });
  gate('G06', 'Elle düzenlenebilir Ex-factory PATCH + /batch 2xx, değer görünür; yol satır yaması veya güvenli tam kurulum; satırlar tam kurulumla eşit',
    pass(e1.status < 300 && e2.status < 300 && String(v(exRow._id)['Ex-factory']).slice(0, 10) === exTarget && String(v(exBatchRow._id)['Ex-factory']).slice(0, 10) === exBatchTarget && allowedPath(afterEx) && allowedPath(afterExBatch) && sameAsRebuild(exRow) && sameAsRebuild(exBatchRow)),
    { patch: e1.status, batch: e2.status, manualCandidates: manual.length, got: [v(exRow._id)['Ex-factory'], v(exBatchRow._id)['Ex-factory']], want: [exTarget, exBatchTarget], path: [readPath(afterEx), readPath(afterExBatch)], equalToRebuild: [sameAsRebuild(exRow), sameAsRebuild(exBatchRow)] });
  gate('G06b', 'Artımlı lojistik yaması (#1260): aynı oturumun Del. Type ve Ex-factory kaydı satır yaması yolunda okunur, değer görünür, satır tam kurulumla eşit',
    pass(d2.status === 200 && v(delRowA._id)['Del. Type'] === newDelA && viaRowPatch(afterDelA) && (viaRowPatch(afterEx) || viaRowPatch(afterExBatch)) && sameAsRebuild(delRowA)),
    { delType: { status: d2.status, want: newDelA, got: v(delRowA._id)['Del. Type'], path: readPath(afterDelA), rowPatch: afterDelA.rowPatch, equalToRebuild: sameAsRebuild(delRowA) }, exFactory: { path: [readPath(afterEx), readPath(afterExBatch)] } });

  // G13 sınırlı süreli soak: Supp. FOB / not dönüşümlü → artımlı CP (since) + Siparişler; sonda tam okuma ↔ artımlı birikim.
  const soakStart = Date.now();
  const soak = { minutes: opt.soakMin, gapMs: opt.gapMs, iterations: 0, saves: { ok: 0, fail: 0 }, cpMs: [], ordersMs: [], n503: 0, valueBad: 0 };
  let tuples = tupleMap(rebuilt.cols);
  let token = rebuilt.cols.token;
  const written = new Map();
  const soakRows = rows.filter(r => !used.has(String(r['Order Code'])));
  for (let i = 0; Date.now() - soakStart < opt.soakMin * 60000; i += 1) {
    const r = soakRows[(i * 397 + 11) % soakRows.length];
    const kind = i % 2 ? 'note' : 'suppFob';
    const s = kind === 'suppFob'
      ? await call('PATCH', '/api/overrides/' + r['Order Code'], { ...line(r), notes: { Notes: r.Notes || '', NotesHtml: '', EkNot: r['Ek Not'] || '', EkNotHtml: '' }, suppFob: 100 + (i % 500) + 0.25, suppFobMeta: { source: 'manual' } }, cookieA)
      : await call('POST', '/api/overrides/batch', { items: [{ orderCode: r['Order Code'], patch: { ...line(r), notes: notesOf(r, 'soak not ' + i) } }] }, cookieA);
    if (s.status === 200) { soak.saves.ok += 1; written.set(String(r._id), kind === 'suppFob' ? { k: 'Supp. FOB', v: 100 + (i % 500) + 0.25 } : { k: 'Notes', v: 'soak not ' + i }); } else soak.saves.fail += 1;
    const c = await computed(cookieA, token);
    if (!c.cols.delta) tuples = new Map();
    for (const x of c.cols.rows || []) tuples.set(String(x[0]), JSON.stringify(x));
    for (const id of c.cols.removed || []) tuples.delete(String(id));
    token = c.cols.token;
    const o = await ordersQuery(cookieA);
    soak.cpMs.push(c.ms); soak.ordersMs.push(o.ms); soak.n503 += c.n503; soak.iterations += 1;
    if (i % 25 === 0) { console.log(`[gate] soak ${i} ${Math.round((Date.now() - soakStart) / 1000)}s cp=${c.ms}ms orders=${o.ms}ms`); save(); }
    await delay(opt.gapMs);
  }
  const full = await computed(cookieA);
  const fullMap = tupleMap(full.cols);
  const soakRowsNow = new Map((await cpRows(cookieA, ['_id', 'Notes', 'Supp. FOB'])).map(r => [String(r._id), r]));
  for (const [id, w] of written) { const got = soakRowsNow.get(id); const val = got && (w.k === 'Supp. FOB' ? Number(got['Supp. FOB']) : String(got.Notes || '')); if (val !== w.v) soak.valueBad += 1; }
  soak.incrementalEqualsFull = digestOf(tuples) === digestOf(fullMap);
  const median = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const p95 = list => { const s = list.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : null; };
  soak.cpMedianMs = median(soak.cpMs); soak.cpP95Ms = p95(soak.cpMs); soak.ordersMedianMs = median(soak.ordersMs); soak.ordersP95Ms = p95(soak.ordersMs);
  const soakMem = memorySummary(soakStart);
  soak.rssThirds = thirds(soakMem.mem, 'rss'); soak.heapThirds = thirds(soakMem.mem, 'heapUsed');
  delete soak.cpMs; delete soak.ordersMs;
  report.soak = soak;
  gate('G13', `Sınırlı süreli soak (${opt.soakMin} dk): kayıtlar 2xx, artımlı birikim = tam okuma, yazılan değerler görünür`, pass(soak.iterations > 0 && soak.saves.fail === 0 && soak.incrementalEqualsFull && soak.valueBad === 0 && unexpectedExits === 0),
    { iterations: soak.iterations, saves: soak.saves, valueBad: soak.valueBad, incrementalEqualsFull: soak.incrementalEqualsFull, cpMedianMs: soak.cpMedianMs, cpP95Ms: soak.cpP95Ms, ordersMedianMs: soak.ordersMedianMs, rssThirds: soak.rssThirds, heapThirds: soak.heapThirds });
  if (soak.rssThirds && soak.rssThirds.lastMb > soak.rssThirds.firstMb * 1.25) gate('G13b', 'Soak RSS eğimi (son üçte bir medyanı ≤ ilk × 1,25)', 'WARN', soak.rssThirds);

  // G11 503, G12 bellek / 3686 MB heap bütçesi.
  gate('G11', '503: kurtarılamayan (20×500 ms yeniden deneme sonrası) = 0; toplam 503 raporlanır', report.http.exhausted === 0 ? (report.http.n503 === 0 ? 'PASS' : 'WARN') : 'FAIL', { n503: report.http.n503, exhausted: report.http.exhausted, byPath: report.http.byPath, requests: report.http.requests });
  const mem = memorySummary();
  report.memory = { ...mem, mem: undefined, beforeRestart: { ...memBeforeRestart, mem: undefined } };
  if (!mem.hookLoaded) gate('G12', 'Bellek (RSS / tepe RSS / heap / işçi retained) ve heap bütçesi', 'BLOCKED', 'ölçüm kancası yüklenmedi (NODE_OPTIONS --require BuyerLog.exe tarafından yok sayıldı mı?)');
  else {
    const budgetOk = Math.abs(Number(mem.heapLimitMb) - opt.heapMb) <= 96;
    const headroomOk = mem.heapUsedMaxMb < opt.heapMb * 0.85;
    const oom = mem.workerErrors.concat(mem.jobFailures).filter(code => /MEMORY|OOM|ERR_WORKER_OUT_OF_MEMORY/i.test(String(code)));
    gate('G12', `Bellek: heap sınırı = ${opt.heapMb} MB politika bütçesi, ana heap tepe < %85, işçi OOM yok, beklenmedik çıkış yok`, pass(budgetOk && headroomOk && oom.length === 0 && unexpectedExits === 0),
      { heapLimitMb: mem.heapLimitMb, heapUsedMaxMb: mem.heapUsedMaxMb, rssMaxMb: mem.rssMaxMb, peakRssMb: mem.peakRssMb, retainedMaxMb: mem.retainedMaxMb, poolRetainedMaxMb: mem.poolRetainedMaxMb, workerSpawns: mem.workerSpawns, workerExits: mem.workerExits, jobFailures: mem.jobFailures, unexpectedExits });
  }
  await stopBackend('final');
  const orphans = report.stops.filter(s => s.orphan);
  gate('G14', 'Kapanış: backend.stop() sonrası sunucu süreci 20 sn içinde biter (öksüz süreç yok)', pass(orphans.length === 0), { stops: report.stops.map(s => ({ label: s.label, ms: s.ms, forced: s.forced, orphan: s.orphan })) });
  void stop1;
}

function summaryMarkdown() {
  const e = report.env;
  const lines = ['### Buyer Log Windows/Electron kapısı', '', `Çalışma ortamı: \`${path.basename(e.execPath)}\` · Electron ${e.electron || '-'} · Node ${e.node} · ${e.platform} · ${e.cpus} · RAM ${e.totalMemMb} MB · heap bütçesi ${e.heapMb} MB · commit \`${e.commit || '-'}\` · uygulama ${e.appVersion || '-'}`, '',
    '| Kapı | Durum | Ölçüt | Ayrıntı |', '|---|---|---|---|'];
  for (const g of report.gates) lines.push(`| ${g.id} | ${g.status} | ${g.title.replace(/\|/g, '/')} | ${JSON.stringify(g.detail || '').replace(/\|/g, '/').slice(0, 300)} |`);
  if (report.errors.length) lines.push('', '**Hata:** ' + report.errors.map(x => '`' + x.split('\n')[0].slice(0, 200) + '`').join(' · '));
  return lines.join('\n') + '\n';
}

main().catch(error => {
  report.errors.push(String(error && error.stack || error).slice(0, 2000));
  gate('G00', 'Kapı akışı tamamlandı', 'FAIL', String(error && error.message || error).slice(0, 400));
}).finally(async () => {
  try { if (backend && backend.running) await stopBackend('cleanup'); } catch (_) {}
  report.finishedAt = new Date().toISOString();
  save();
  const md = summaryMarkdown();
  fs.writeFileSync(path.join(OUT, 'gate-summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch (_) {} }
  console.log(md);
  // KNOWN: belgelenmiş uygulama bulgusu hâlâ üretiliyor (engellemez, tabloda görünür). XPASS: bulgu artık
  // üretilmiyor → kapı normal PASS/FAIL kapısına çevrilmeli. Yalnız FAIL ve BLOCKED işi kırmızı yapar.
  const bad = report.gates.filter(g => g.status === 'FAIL' || g.status === 'BLOCKED');
  process.exit(bad.length ? 1 : 0);
});
