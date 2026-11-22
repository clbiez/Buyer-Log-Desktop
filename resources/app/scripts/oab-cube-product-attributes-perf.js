'use strict';
// L2 sunucu ölçümü (CLAUDE.md §3.2): OAB (Küp) /api/oab-cube/report rotası uçtan
// uca (görünüm kaydı, şema, sorgu kurma, satır normalize, önbellek/snapshot gzip
// yazımı). Küp (modelQuery) 0 ms gecikmeli sentetik satırlarla taklit edilir;
// ölçülen yalnız Buyer Log sunucu işidir, SSAS süresi değildir.
//   node scripts/oab-cube-product-attributes-perf.js [--app <resources/app kökü>] [--repeat 9] [--attrs]
// --app: ölçülecek uygulama kopyası (Main worktree ya da aday); varsayılan bu kopya.
// --attrs: aday davranışında FİT pivotta (bilgi amaçlı; ek özellik sorgusu dahil).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const APP = path.resolve(arg('--app', path.join(__dirname, '..')));
const REPEAT = Number(arg('--repeat', 9));
const WITH_ATTRS = process.argv.includes('--attrs');
const ROWS = 20000;

process.env.BUYER_LOG_SERVER_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'oab-cube-perf-'));
const report = require(path.join(APP, 'server/lib/oab-cube-report'));
const intakeReport = require(path.join(APP, 'server/lib/intake-report'));
const { createIntakeStore } = require(path.join(APP, 'server/lib/intake-store'));

const columns = [
  ...report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  ...['ModelKod', 'RenkKod', 'FİT', 'SİLÜET', 'KUMAŞ-MALZEME TİPİ'].map(name => ({ table: 'Urun', name, kind: 'column', dataType: 'WChar' })),
];
const measures = report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' }));
// 20.000 option satırı, 5.000 model × 4 renk (ana sorgu üst sınırı).
const mainRows = Array.from({ length: ROWS }, (_, i) => ({
  season: i % 2 ? 'W6' : 'S6', mag: `DM${i % 40}`, buyerGroup: `DEMO GRUP ${i % 6}`, classGroup: `DEMO GRUP ${i % 12}`, classification: `DEMO KLASMAN ${i % 60}`,
  modelCode: `DM${100000 + Math.floor(i / 4)}`, modelName: `DEMO MODEL ${Math.floor(i / 4)}`, colourCode: `C${i % 4}`, colourName: `DEMO RENK ${i % 4}`,
  wssi: String(i % 3 ? 600 + (i % 97) * 4 : 0), approved: String(500 + (i % 89) * 3), plan: String(700 + (i % 83) * 5), unapproved: String(i % 4 ? 80 : 0), poQty: String(450 + (i % 71) * 3),
}));
const attrRows = mainRows.map((row, i) => ({ modelCode: row.modelCode, colourCode: row.colourCode, fit: ['Slim', 'Regular', 'Oversize'][i % 3], silhouette: 'Düz', fabricType: 'Örme' }));

async function main() {
  const handlers = {}, app = {}, counts = { main: 0, attributes: 0, other: 0 };
  ['get', 'put', 'post'].forEach(method => { app[method] = (url, ...fns) => { handlers[`${method.toUpperCase()} ${url}`] = fns; }; });
  const modelQuery = {
    discoverSchema: async () => ({ columns, measures }),
    runModelRows: async input => {
      if (/'Urun'/.test(input.query)) { counts.attributes += 1; const codes = new Set((input.query.match(/"DM\d+"/g) || []).map(code => code.slice(1, -1))); return { rows: attrRows.filter(row => codes.has(row.modelCode)) }; }
      if (/SUMMARIZECOLUMNS/.test(input.query)) { counts.main += 1; return { rows: mainRows }; }
      counts.other += 1; return { rows: [] };
    },
  };
  const prefs = new Map();
  require(path.join(APP, 'server/routes/oab-cube-routes'))(app, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: () => {} },
    modelQuery,
    userPreferences: { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } },
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'oab-cube-perf-store-')) }),
  });
  const call = async body => {
    const fns = handlers['POST /api/oab-cube/report'];
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    let i = 0; const next = async () => { const fn = fns[i++]; if (fn) await fn({ currentUser: { id: 'u1' }, body }, res, next); };
    await next();
    if (res.statusCode !== 200) throw new Error(JSON.stringify(res.body).slice(0, 300));
    return res.body;
  };
  const view = { rows: WITH_ATTRS ? [{ key: 'classGroup' }, { key: 'fit' }] : [{ key: 'classGroup' }], filterValues: { season: ['S6', 'W6'] } };
  const samples = { cold: [], warm: [] };
  for (let i = 0; i < REPEAT + 2; i++) {
    // cold: Yenile (forceRefresh) — küp sorgusu + normalize + önbellek yazımı.
    let t0 = process.hrtime.bigint();
    const cold = await call({ view, forceRefresh: true });
    const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;
    // warm: aynı görünüm, 30 dk önbellek isabeti.
    t0 = process.hrtime.bigint();
    const warm = await call({ view });
    const warmMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (cold.rows.length !== ROWS || warm.rows.length !== ROWS) throw new Error('satır sayısı değişti');
    if (i >= 2) { samples.cold.push(Math.round(coldMs)); samples.warm.push(Math.round(warmMs)); }
  }
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const perRequest = value => Math.round(value / (REPEAT + 2) * 100) / 100;
  console.log(JSON.stringify({ app: APP, attrs: WITH_ATTRS, rows: ROWS, coldMedian: median(samples.cold), warmMedian: median(samples.warm), cold: samples.cold, warm: samples.warm,
    queriesPerColdWarmPair: { main: perRequest(counts.main), attributes: perRequest(counts.attributes), other: perRequest(counts.other) } }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
