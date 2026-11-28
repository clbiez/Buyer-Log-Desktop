'use strict';
// Ölçüm çekişme göstergesi (repo dışı, Linux). Her ölçüm koşusunun yanında çalıştırılır; koşu sonrası özetlenir.
//   node contention.js record <out.jsonl> [aralıkMs=5000]     → SIGTERM/SIGINT ile durur
//   node contention.js summary <out.jsonl> [başISO bitişISO]   → pencere özeti (JSON)
// Kaynaklar: /proc/pressure/{cpu,io,memory} (PSI some/full avg10 + total µs farkı), /proc/stat (steal, iowait, toplam jiffy farkı),
// /proc/loadavg, nproc. Okunamayan kaynak null yazılır (ör. Windows runner: PSI yok → çekişme göstergesi BLOCKED).
// Yorum: cpu.some = CPU bekleyen görev zaman oranı; steal = hipervizörün aldığı CPU; ikisi de kalıcı olarak > ~%5 ise
// süre ölçümleri (L2, soak bekleme süreleri) aynı makinedeki başka yükten etkilenmiş sayılır ve sonuç ÖN SONUÇ'tur.
const fs = require('fs'), os = require('os');
const [mode, file, a3, a4] = process.argv.slice(2);
const psi = name => { try { const o = {}; for (const line of fs.readFileSync(`/proc/pressure/${name}`, 'utf8').trim().split('\n')) { const [kind, ...kv] = line.split(' '); o[kind] = Object.fromEntries(kv.map(x => x.split('=')).map(([k, v]) => [k, Number(v)])); } return o; } catch (_) { return null; } };
const stat = () => { try { const f = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number); return { user: f[0], nice: f[1], system: f[2], idle: f[3], iowait: f[4], irq: f[5], softirq: f[6], steal: f[7], total: f.slice(0, 8).reduce((s, x) => s + x, 0) }; } catch (_) { return null; } };
if (mode === 'record') {
  const every = Number(a3) || 5000; let prev = { t: Date.now(), stat: stat(), cpu: psi('cpu'), io: psi('io'), memory: psi('memory') };
  const tick = () => {
    const cur = { t: Date.now(), stat: stat(), cpu: psi('cpu'), io: psi('io'), memory: psi('memory') }; const dt = (cur.t - prev.t) * 1000; // µs
    const pct = (p, q, kind) => (p && q && p[kind] && q[kind] ? Math.round(((q[kind].total - p[kind].total) / dt) * 10000) / 100 : null);
    const d = (k) => (prev.stat && cur.stat ? cur.stat[k] - prev.stat[k] : null); const tot = d('total');
    fs.appendFileSync(file, JSON.stringify({ t: cur.t, cpuSome: pct(prev.cpu, cur.cpu, 'some'), ioSome: pct(prev.io, cur.io, 'some'), ioFull: pct(prev.io, cur.io, 'full'), memSome: pct(prev.memory, cur.memory, 'some'),
      stealPct: tot ? Math.round((d('steal') / tot) * 10000) / 100 : null, iowaitPct: tot ? Math.round((d('iowait') / tot) * 10000) / 100 : null, busyPct: tot ? Math.round((1 - (d('idle') + d('iowait')) / tot) * 10000) / 100 : null,
      load1: os.loadavg()[0], cpus: os.cpus().length }) + '\n');
    prev = cur;
  };
  const timer = setInterval(tick, every); const stop = () => { clearInterval(timer); tick(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
} else if (mode === 'summary') {
  const from = a3 ? Date.parse(a3) : 0, to = a4 ? Date.parse(a4) : Infinity;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.t >= from && r.t < to);
  const stats = k => { const v = rows.map(r => r[k]).filter(x => x != null).sort((x, y) => x - y); if (!v.length) return null; const q = p => v[Math.min(v.length - 1, Math.floor(v.length * p))]; return { med: q(0.5), p90: q(0.9), max: v[v.length - 1] }; };
  const out = { samples: rows.length, from: rows[0] && new Date(rows[0].t).toISOString(), to: rows.length ? new Date(rows[rows.length - 1].t).toISOString() : null };
  for (const k of ['cpuSome', 'ioSome', 'ioFull', 'memSome', 'stealPct', 'iowaitPct', 'busyPct', 'load1']) out[k] = stats(k);
  const c = out.cpuSome && out.cpuSome.med, s = out.stealPct && out.stealPct.med;
  out.verdict = c == null ? 'BLOCKED (PSI yok)' : (c > 5 || (s || 0) > 5) ? 'ÇEKİŞMELİ (ön sonuç)' : 'SAKİN';
  console.log(JSON.stringify(out, null, 1));
} else { console.error('kullanım: record <out.jsonl> [ms] | summary <out.jsonl> [başISO bitişISO]'); process.exit(2); }
