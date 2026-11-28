'use strict';
// Windows/Electron kapısı ölçüm kancası (CI-only; ürün paketine girmez).
// Kapı, backend ortamına NODE_OPTIONS="--require <bu dosya>" ekler. Yalnız server.js ana
// iş parçacığında etkindir: 1 sn bellek (RSS, tepe RSS = process.resourceUsage().maxRSS,
// V8 heap ve heap sınırı), read-model işçi oluşturma/çıkış ve iş sonucu retainedBytes,
// 5 sn havuz/şerit stats() anlık görüntüsü. Date, zamanlayıcı veya ürün mantığı yaması yok.
const fs = require('fs');
const v8 = require('v8');
const wt = require('worker_threads');
const Module = require('module');

const LOG = process.env.BUYER_LOG_GATE_HOOK_LOG || '';
const write = record => { try { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...record }) + '\n'); } catch (_) { /* ölçüm sunucuyu durduramaz */ } };

if (wt.isMainThread && LOG && /server\.js$/i.test(process.argv[1] || '')) {
  write({ ev: 'hook', pid: process.pid, node: process.versions.node, electron: process.versions.electron || null, heapLimitMb: Math.round(v8.getHeapStatistics().heap_size_limit / 1048576), execArgv: process.execArgv });
  const RealWorker = wt.Worker;
  let seq = 0;
  wt.Worker = class GateWorker extends RealWorker {
    constructor(file, options) {
      super(file, options);
      this.__rm = /read-model-worker/.test(String(file));
      if (!this.__rm) return;
      const wid = ++seq;
      this.__wid = wid;
      write({ ev: 'spawn', wid, limit: options && options.resourceLimits || null });
      this.once('exit', code => write({ ev: 'exit', wid, code }));
      this.on('error', error => write({ ev: 'error', wid, code: error && error.code, message: String(error && error.message || '').slice(0, 200) }));
      this.on('message', message => {
        if (!message || message.type !== 'result') return;
        const m = message.metrics || {};
        write({ ev: 'result', wid, ok: message.ok, code: message.error && message.error.code, retained: m.retainedBytes, ms: Math.round(m.executionMs || 0) });
      });
    }
  };
  const pools = {};
  const originalLoad = Module._load;
  Module._load = function gateLoad(request) {
    const out = originalLoad.apply(this, arguments);
    if (/read-model-pool$/.test(request) && out && !out.__gateHooked && typeof out.getReadModelPool === 'function') {
      out.__gateHooked = true;
      for (const [key, name] of [['getReadModelPool', 'main'], ['getReadModelQueryLanePool', 'lane']]) {
        const get = out[key];
        if (typeof get !== 'function') continue;
        out[key] = (...args) => { const pool = get(...args); pools[name] = pool; return pool; };
      }
    }
    return out;
  };
  setInterval(() => {
    const m = process.memoryUsage();
    const h = v8.getHeapStatistics();
    write({ ev: 'mem', rss: m.rss, maxRss: process.resourceUsage().maxRSS * 1024, heapUsed: m.heapUsed, heapTotal: m.heapTotal, heapLimit: h.heap_size_limit, ext: m.external, ab: m.arrayBuffers });
  }, 1000).unref();
  setInterval(() => {
    const record = { ev: 'pool' };
    for (const [name, pool] of Object.entries(pools)) {
      try {
        const s = pool.stats();
        record[name] = { workers: s.workerCount, active: s.activeWorkers, pending: s.pending, retained: s.retainedWorkerBytes, reserved: s.reservedBytes, budget: s.memoryBudgetBytes, completed: s.completed, failed: s.failed, rejected: s.rejected };
      } catch (_) { /* stats yoksa atlanır */ }
    }
    write(record);
  }, 5000).unref();
}
