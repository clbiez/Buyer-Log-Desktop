'use strict';
// Startup fs instrumentation: --require this file. Writes JSONL summary on SIGUSR2 or exit.
const fs = require('fs');
const path = require('path');
const OUT = process.env.FS_TRACE_OUT || '/tmp/fs-trace.json';
const T0 = Date.now();
const ROOT = process.env.FS_TRACE_ROOT || '';
const stats = new Map();
const blocks = [];
function key(op, p) {
  let s = String(p || '');
  if (ROOT && s.startsWith(ROOT)) s = s.slice(ROOT.length);
  const parts = s.split(/[\\/]/).filter(Boolean).slice(0, 3);
  return op + ' ' + parts.join('/');
}
function rec(op, p, ms, bytes) {
  const k = key(op, p);
  const e = stats.get(k) || { op, prefix: k.slice(op.length + 1), calls: 0, ms: 0, bytes: 0, firstAt: Date.now() - T0 };
  e.calls++; e.ms += ms; e.bytes += bytes || 0; stats.set(k, e);
}
const SYNC = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'openSync', 'readSync', 'writeFileSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'mkdirSync', 'accessSync', 'realpathSync'];
for (const name of SYNC) {
  const orig = fs[name]; if (typeof orig !== 'function') continue;
  fs[name] = function (p, ...rest) {
    const s = process.hrtime.bigint();
    const r = orig.call(this, p, ...rest);
    const ms = Number(process.hrtime.bigint() - s) / 1e6;
    let bytes = 0; if (name === 'readFileSync' && r) bytes = r.length; if (name === 'readdirSync' && Array.isArray(r)) bytes = r.length;
    rec('sync.' + name, typeof p === 'number' ? 'fd' : p, ms, bytes);
    return r;
  };
}
const P = fs.promises;
for (const name of ['readFile', 'readdir', 'stat', 'lstat', 'open', 'writeFile', 'access', 'rename', 'unlink']) {
  const orig = P[name]; if (typeof orig !== 'function') continue;
  P[name] = async function (p, ...rest) {
    const s = process.hrtime.bigint();
    const r = await orig.call(this, p, ...rest);
    const ms = Number(process.hrtime.bigint() - s) / 1e6;
    let bytes = 0; if (name === 'readFile' && r) bytes = r.length; if (name === 'readdir' && Array.isArray(r)) bytes = r.length;
    rec('async.' + name, p && p.toString ? p.toString() : p, ms, bytes);
    return r;
  };
}
for (const name of ['readFile', 'readdir', 'stat', 'lstat']) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) {
    const cb = rest.pop(); const s = process.hrtime.bigint();
    return orig.call(this, p, ...rest, function (err, r) {
      const ms = Number(process.hrtime.bigint() - s) / 1e6;
      let bytes = 0; if (name === 'readFile' && r) bytes = r.length; if (name === 'readdir' && Array.isArray(r)) bytes = r.length;
      rec('cb.' + name, p, ms, bytes); cb(err, r);
    });
  };
}
const origCRS = fs.createReadStream;
fs.createReadStream = function (p, ...rest) { rec('stream.read', p, 0, 0); return origCRS.call(this, p, ...rest); };
// event-loop blocking monitor
let last = Date.now();
setInterval(() => { const now = Date.now(); const lag = now - last - 20; if (lag > 50) blocks.push({ at: last - T0, lagMs: lag }); last = now; }, 20).unref();
function dump() {
  const rows = [...stats.values()].sort((a, b) => b.ms - a.ms);
  try { require('fs').writeFileSync.call(fs, OUT, JSON.stringify({ elapsedMs: Date.now() - T0, blocks, rows }, null, 1)); } catch (_) {}
}
process.on('SIGUSR2', dump);
process.on('exit', dump);
