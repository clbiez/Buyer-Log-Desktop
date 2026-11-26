'use strict';

/* AŞAMA 1 PROTOTİPİ — mevcut motorla karşılaştırma (geçici).
 * Kullanım: node prototypes/collection-oplog/compare-causal-cloud.js [başlangıç seed] [adet]
 *
 * Mevcut motorun nedensellik testindeki (resources/app/tests/collection-sync-causal-cloud-*.test.js)
 * işlem karışımı ve oracle kuralları burada olay günlüğü prototipine uygulanır:
 * 3 cihaz, 10 satır, 2 alan, düzenleme / silme / kesintili yayım / yeniden başlatma.
 * Bulut modeli: dosyalar benzersiz ve değişmez; yükleme yalnız ekler, indirme
 * rastgele bir ALT KÜMEYİ getirir (kısmi, sırasız, tekrarlı teslim). Üzerine yazma
 * olmadığı için "eski tabanlı yükleme kazanır" durumu bu modelde tanım gereği yoktur.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { createDevice } = require('./oplog-device');

const FIELDS = ['not', 'buyer'];
const OWNER = 'owner-a';
function seeded(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; }; }

async function listFiles(dir) {
  const out = [];
  async function walk(d) { let entries = []; try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch (_) { return; } for (const e of entries) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.json')) out.push(p); } }
  await walk(dir);
  return out;
}

async function runScenario(seed, { steps = 70, rows: rowCount = 10, debugCell = null } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oplog-compare-'));
  try {
    const random = seeded(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const names = ['a', 'b', 'c'];
    const users = { a: OWNER, b: 'editor-b', c: 'editor-c' };
    const mirror = Object.fromEntries(names.map(name => [name, path.join(root, `mirror-${name}`)]));
    const online = Object.fromEntries(names.map(name => [name, true]));
    let clock = 1_000_000;
    const make = name => createDevice({ owner: OWNER, user: users[name], localDir: path.join(root, `local-${name}`), getSharedRoot: async () => (online[name] ? mirror[name] : ''), now: () => (clock += Math.floor(random() * 20)) });
    const device = Object.fromEntries(names.map(name => [name, make(name)]));
    const cloud = new Map(); // göreli yol -> içerik
    const upload = async name => { for (const file of await listFiles(mirror[name])) { const rel = path.relative(mirror[name], file); if (!cloud.has(rel)) cloud.set(rel, await fsp.readFile(file, 'utf8')); } };
    const download = async (name, fraction = 0.6) => {
      for (const [rel, text] of cloud) {
        if (random() > fraction) continue; // kısmi ve sırasız teslim
        const target = path.join(mirror[name], rel);
        if (fs.existsSync(target) && random() > 0.2) continue;
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, text); // tekrarlı teslim aynı içeriği yeniden yazar
      }
    };
    // Önyükleme: sahip satırları yaratır, izin verir; herkes alır.
    await device.a.load();
    await device.a.permission('grant', 'editor-b'); await device.a.permission('grant', 'editor-c');
    for (let i = 1; i <= rowCount; i++) await device.a.createRow(`r${i}`, { not: '', buyer: '' });
    await upload('a');
    for (const name of names) { await download(name, 1); await device[name].sync(); await upload(name); }
    const writes = [], deletions = new Map(), log = [];
    const visibleRows = name => [...device[name].view().rows.values()];
    const ops = {
      async edit(name, interrupted = false) {
        const rows = visibleRows(name); if (!rows.length) return null;
        const row = pick(rows), field = pick(FIELDS);
        const value = `${name}${log.length}${field[0]}`;
        // Yazım görünen TÜM başları ezer (kazanan + çakışmadaki kaybedenler): oracle hepsini bilir.
        const fold = device[name].view();
        const heads = (row.versions[field] || []).map(id => fold.versionsById.get(id)).filter(Boolean).map(v => String(v.value ?? ''));
        writes.push({ row: row.id, field, value, prev: heads.length ? heads : [String(row.fields[field] ?? '')] });
        if (interrupted) online[name] = false;
        await device[name].setField(row.id, field, value);
        online[name] = true;
        return `${interrupted ? 'edit!' : 'edit'} ${name} ${row.id}.${field}=${value}`;
      },
      interrupted: name => ops.edit(name, true),
      async remove(name) {
        const rows = visibleRows(name).filter(row => !deletions.has(row.id));
        if (rows.length < Math.ceil(rowCount / 2)) return null;
        const row = pick(rows);
        const fold = device[name].view();
        deletions.set(row.id, { observed: Object.fromEntries(FIELDS.map(field => [field, (row.versions[field] || []).map(id => fold.versionsById.get(id)).filter(Boolean).map(v => String(v.value ?? ''))])) });
        await device[name].deleteRow(row.id);
        return `delete ${name} ${row.id}`;
      },
      async sync(name) { await device[name].sync(); return `sync ${name}`; },
      async upload(name) { await upload(name); return `upload ${name}`; },
      async download(name) { await download(name); return `download ${name}`; },
      async restart(name) { device[name] = make(name); await device[name].load(); return `restart ${name}`; },
    };
    const weighted = ['edit', 'edit', 'edit', 'edit', 'interrupted', 'remove', 'sync', 'sync', 'sync', 'upload', 'upload', 'download', 'download', 'restart'];
    for (let step = 0; step < steps; step++) { const entry = await ops[pick(weighted)](pick(names)); if (entry) log.push(entry); }
    for (let round = 0; round < 4; round++) for (const name of names) { await device[name].sync(); await upload(name); await download(name, 1); await device[name].sync(); }
    // ---- Oracle (mevcut motor testiyle aynı kurallar)
    const view = device.a.view();
    const failures = [];
    const conflicts = view.conflicts;
    const byCell = new Map();
    for (const w of writes) { const key = `${w.row}|${w.field}`; if (!byCell.has(key)) byCell.set(key, []); byCell.get(key).push(w); }
    const writeOf = (key, value) => (byCell.get(key) || []).find(w => w.value === value) || null;
    const ancestors = (key, value) => {
      const out = new Set(), stack = [value];
      while (stack.length) { const w = writeOf(key, stack.pop()); if (!w) continue; for (const p of w.prev) if (!out.has(p)) { out.add(p); stack.push(p); } }
      return out;
    };
    const seenSet = (key, observed) => { const out = new Set(); for (const v of [].concat(observed || [])) { out.add(v); for (const a of ancestors(key, v)) out.add(a); } return out; };
    const reported = (key, value) => conflicts.some(item => `${item.row}|${item.field}` === key && String(item.incoming) === value);
    for (let i = 1; i <= rowCount; i++) {
      const rowId = `r${i}`, row = view.rows.get(rowId), deletion = deletions.get(rowId);
      const rowWrites = writes.filter(w => w.row === rowId);
      const unseen = deletion ? rowWrites.filter(w => !seenSet(`${rowId}|${w.field}`, deletion.observed[w.field]).has(w.value)) : [];
      if (!row) {
        if (!deletion) failures.push(`row ${rowId} wrongly deleted`);
        else { const swallowed = unseen.filter(w => !reported(`${rowId}|${w.field}`, w.value)); if (swallowed.length) failures.push(`delete swallowed ${swallowed.map(w => w.value)}`); }
        continue;
      }
      if (deletion && !unseen.length) failures.push(`deleted row ${rowId} came back without a concurrent edit`);
      for (const field of FIELDS) {
        const key = `${rowId}|${field}`, finalValue = String(row.fields[field] ?? '');
        const finalAncestors = ancestors(key, finalValue);
        const seenByDeleter = value => Boolean(deletion) && seenSet(key, deletion.observed[field]).has(value);
        for (const w of byCell.get(key) || []) {
          if (w.value === finalValue || finalAncestors.has(w.value) || seenByDeleter(w.value)) continue;
          if ((byCell.get(key) || []).some(other => other !== w && ancestors(key, other.value).has(w.value))) continue;
          if (ancestors(key, w.value).has(finalValue)) { failures.push(`${key}: newer ${w.value} lost to its ancestor ${finalValue}${reported(key, w.value) ? ' (reported)' : ''}`); continue; }
          if (!reported(key, w.value)) failures.push(`${key}: silent loss of concurrent ${w.value}`);
        }
      }
    }
    for (const item of conflicts) {
      if (!FIELDS.includes(item.field)) continue;
      const key = `${item.row}|${item.field}`;
      if (ancestors(key, String(item.current)).has(String(item.incoming))) failures.push(`false conflict ${key}`);
      if (ancestors(key, String(item.incoming)).has(String(item.current))) failures.push(`conflict demoted newer ${key}`);
    }
    if (debugCell) {
      console.log('writes', JSON.stringify(byCell.get(debugCell)));
      const [r, f] = debugCell.split('|');
      console.log('final', JSON.stringify(view.rows.get(r) && view.rows.get(r).fields), 'deletion', JSON.stringify(deletions.get(r)));
      console.log('conflicts', JSON.stringify(conflicts.filter(item => item.row === r).map(item => [item.field, item.current, item.incoming])));
      console.log('log', log.filter(entry => entry.includes(` ${r}.`) || entry.endsWith(` ${r}`)).join(' | '));
    }
    const snapshot = name => JSON.stringify([...device[name].view().rows.entries()].map(([k, v]) => [k, FIELDS.map(f => v.fields[f])]).sort());
    if (new Set(names.map(snapshot)).size !== 1) failures.push('installations did not converge');
    const pending = names.reduce((n, name) => n + device[name].view().pending.length, 0);
    if (pending) failures.push(`pending after settle: ${pending}`);
    // Bayt: kayıt dosyalarının toplamı (mevcut motor her yayımda tüm zarfı yazar).
    let bytes = 0; for (const text of cloud.values()) bytes += Buffer.byteLength(text);
    return { failures, writes: writes.length, deletions: deletions.size, conflicts: conflicts.length, files: cloud.size, bytes };
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

if (require.main === module) {
  (async () => {
    const base = Number(process.argv[2] || 30000), n = Number(process.argv[3] || 40);
    const cls = f => /silent loss/.test(f) ? 'sessizKayıp' : /\(reported\)$/.test(f) ? 'çakışmayaDüşenYeni' : /newer .* lost/.test(f) ? 'yeniDeğerSessizDüştü' : /false conflict/.test(f) ? 'yanlışÇakışma' : /demoted/.test(f) ? 'kayıttaYeniAltta' : /came back/.test(f) ? 'gereksizGeriGelme' : /swallowed/.test(f) ? 'silmeDüzenlemeyiYuttu' : /wrongly/.test(f) ? 'yanlışSilme' : /converge/.test(f) ? 'yakınsamadı' : /pending/.test(f) ? 'bekleyenKaldı' : 'diğer';
    const totals = { seeds: n, failedSeeds: 0, writes: 0, deletions: 0, conflicts: 0, files: 0, bytes: 0 }; const cat = {}; const examples = [];
    for (let s = base; s < base + n; s++) {
      const r = await runScenario(s);
      for (const k of ['writes', 'deletions', 'conflicts', 'files', 'bytes']) totals[k] += r[k];
      if (r.failures.length) { totals.failedSeeds++; if (examples.length < 5) examples.push(`${s}: ${r.failures[0]}`); }
      for (const f of r.failures) cat[cls(f)] = (cat[cls(f)] || 0) + 1;
    }
    console.log(JSON.stringify({ ...totals, ...cat }));
    examples.forEach(e => console.log('  ', e));
  })();
}

module.exports = { runScenario };
