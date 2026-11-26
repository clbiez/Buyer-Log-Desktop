'use strict';
/* BUYER LOG — DAYANIKLILIK TESTİ SONU DENETİMİ
 * İki makinenin soak köklerini ve ortak test Hub'ını karşılaştırır. Salt okur.
 * Kullanım: node tools/soak/soak-audit.js --a C:\BuyerLogSoak\A --b <B kökünün kopyası> --hub <test Hub'ı> [--app <resources\app>]
 * (B'nin kökünü A makinesine kopyalayın ya da iki makinede ayrı ayrı çalıştırıp çıktıları karşılaştırın.)
 * Çıkış kodu: 0 = yakınsadı, 1 = fark var (incelenmeli). */
const fs = require('fs'), path = require('path');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1]; };
const a = arg('--a'), b = arg('--b'), hub = arg('--hub');
const app = path.resolve(arg('--app') || path.join(__dirname, '..', '..', 'resources', 'app'));
if (!a || !b || !hub) { console.error('Kullanım: --a <kök A> --b <kök B> --hub <test Hub>'); process.exit(2); }
for (const dir of [a, b]) if (!fs.existsSync(path.join(dir, 'BUYERLOG-SOAK-ROOT.txt'))) { console.error(`Soak kökü değil: ${dir}`); process.exit(2); }
if (!fs.existsSync(path.join(hub, 'BUYERLOG-SOAK-HUB.txt'))) { console.error(`Test Hub'ı değil: ${hub}`); process.exit(2); }
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const workspaces = root => {
  const dir = path.join(root, 'data', 'server', 'collection-workspaces'), out = {};
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.json')) : []) out[name] = readJson(path.join(dir, name));
  return out;
};
const canonicalRows = ws => JSON.stringify(((ws && ws.rows) || []).map(row => { const { _rev, updatedAt, updatedBy, ...rest } = row; return [row.id, rest]; }).sort((x, y) => String(x[0]).localeCompare(String(y[0]), undefined, { numeric: true })));
const report = { owners: {}, hubConflictCopies: [], machines: {} };
const wa = workspaces(a), wb = workspaces(b);
for (const name of new Set([...Object.keys(wa), ...Object.keys(wb)])) {
  const ra = wa[name], rb = wb[name];
  const same = Boolean(ra && rb) && canonicalRows(ra) === canonicalRows(rb);
  report.owners[name] = { rowsA: ra && ra.rows ? ra.rows.length : null, rowsB: rb && rb.rows ? rb.rows.length : null, converged: same };
  if (!same && ra && rb) {
    const ma = new Map(ra.rows.map(r => [String(r.id), r])), mb = new Map(rb.rows.map(r => [String(r.id), r]));
    report.owners[name].differences = [...new Set([...ma.keys(), ...mb.keys()])].filter(id => JSON.stringify(ma.get(id) || null) !== JSON.stringify(mb.get(id) || null)).slice(0, 50);
  }
}
try {
  const { findConflictCopies } = require(path.join(app, 'server', 'lib', 'onedrive-conflict-copies'));
  // Çakışma kopyası, aslıyla aynı klasörde aranır.
  const walk = dir => { const entries = fs.readdirSync(dir, { withFileTypes: true }); const here = findConflictCopies(entries.filter(e => e.isFile()).map(e => e.name)).map(item => path.relative(hub, path.join(dir, item.name))); return [...here, ...entries.filter(e => e.isDirectory()).flatMap(e => walk(path.join(dir, e.name)))]; };
  report.hubConflictCopies = walk(hub);
} catch (error) { report.hubConflictCopies = [`(okunamadı: ${error.message})`]; }
for (const [label, root] of [['A', a], ['B', b]]) {
  const state = readJson(path.join(root, 'data', 'local', 'collection-replication-state.json')) || { owners: {} };
  const owners = Object.values(state.owners || {});
  const bases = path.join(root, 'data', 'local', 'collection-replication-state.json.bases');
  const logs = fs.existsSync(bases) ? fs.readdirSync(bases).filter(n => n.endsWith('.jsonl')).map(n => ({ file: n, bytes: fs.statSync(path.join(bases, n)).size })) : [];
  report.machines[label] = {
    openMergeConflicts: owners.reduce((n, o) => n + (o.mergeConflicts || []).filter(c => !c.resolved).length, 0),
    states: owners.map(o => o.state), pendingPublication: owners.some(o => o.pendingLatest), pendingLogs: logs,
  };
}
const converged = Object.values(report.owners).every(o => o.converged);
console.log(JSON.stringify({ converged, ...report }, null, 2));
process.exit(converged ? 0 : 1);
