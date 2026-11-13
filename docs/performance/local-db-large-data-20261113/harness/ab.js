'use strict';
// node ab.js <scale-label> <fixtureSrc> <rounds> <settleMs>
const { execFileSync } = require('child_process'); const fs = require('fs'), path = require('path');
const [label, src, roundsArg, settleArg] = process.argv.slice(2); const rounds = Number(roundsArg || 3), settle = String(settleArg || 60000);
const HERE = __dirname, MAIN = path.join(HERE, 'main-wt/resources/app'), CAND = '/home/user/Buyer-Log-Desktop/resources/app';
const steadySrc = path.join(HERE, `${label}-cand-steady-src`);
const results = [];
function copy(from, to) { fs.rmSync(to, { recursive: true, force: true }); execFileSync('cp', ['-r', from, to]); execFileSync('sync'); }
function run(variant, round) {
  const fx = path.join(HERE, `${label}-run`); const out = path.join(HERE, `ab-${label}-${variant}-${round}.json`);
  copy(variant === 'cand-steady' ? steadySrc : src, fx);
  const app = variant === 'main' ? MAIN : CAND;
  const line = execFileSync(process.execPath, [path.join(HERE, 'run-startup.js'), fx, out, app, '--notrace', '--wait', settle], { encoding: 'utf8', timeout: 900000 }).trim().split('\n').pop();
  const r = JSON.parse(fs.readFileSync(out, 'utf8')); const lag = JSON.parse(fs.readFileSync(out + '.lag.json', 'utf8'));
  const perf = name => { const l = r.perf.find(x => x.includes(' ' + name + ' ')); return l ? Number(l.match(/\+(\d+)ms/)[1]) : null; };
  const wb = Number((lag.io.match(/write_bytes: (\d+)/) || [])[1] || 0);
  const db = fs.statSync(path.join(fx, 'local/BuyerLogLocal.db')).size;
  const row = { label, variant, round, statusReadyMs: Math.round(r.statusReadyMs), loginMs: Math.round(r.loginMs), dataDoneMs: Math.round(r.dataDoneMs), localDbReadyMs: perf('LOCAL_DB_READY'), maintenanceDoneMs: perf('DELTA_STORE_HYDRATED'),
    maxStallMs: Math.max(0, ...lag.gaps.map(g => g.ms)), totalStallMs: lag.gaps.reduce((a, g) => a + g.ms, 0), diskWriteMB: Math.round(wb / 1e6), dbBytesAfter: db };
  results.push(row); console.log(JSON.stringify(row));
  if (variant === 'cand-first' && !fs.existsSync(steadySrc)) copy(fx, steadySrc);
  fs.writeFileSync(path.join(HERE, `ab-${label}-results.json`), JSON.stringify(results, null, 1));
}
const orders = [['main', 'cand-first', 'cand-steady'], ['cand-first', 'cand-steady', 'main'], ['cand-steady', 'main', 'cand-first']];
// cand-steady needs a pruned source: produce it first if absent.
if (!fs.existsSync(steadySrc)) run('cand-first', 0);
for (let i = 1; i <= rounds; i++) for (const v of orders[(i - 1) % 3]) run(v, i);
