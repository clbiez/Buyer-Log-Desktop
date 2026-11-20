'use strict';
/* Projeksiyon yeniden yazım işçisi istemcisi (#1078 takip / WS7b).
   Tek işçi, sıralı iş (yeniden yazımlar kullanıcı başına zaten sıralıdır; kullanıcılar arası
   işler de bellek tepe değerini sınırlamak için sırayla çalışır). İşçi ilk işte kurulur, boşta
   BL_PROJECTION_REWRITE_IDLE_MS (varsayılan 20 sn) sonra kapanır: boşta bellek tutmaz.
   Zaman aşımı veya işçi hatası işi reddeder; çağıran aynı isteği ana iş parçacığında eski
   yolla tamamlar (page-projection-cache). Geri dönüş anahtarı: BL_PROJECTION_REWRITE_WORKER=0. */
const path = require('node:path'), os = require('node:os');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, '..', 'workers', 'projection-rewrite-worker.js');
function workerEnabled(env = process.env) { return String(env.BL_PROJECTION_REWRITE_WORKER ?? '') !== '0'; }
function poolOptions(env = process.env) {
  const idle = Number(env.BL_PROJECTION_REWRITE_IDLE_MS), timeout = Number(env.BL_PROJECTION_REWRITE_TIMEOUT_MS);
  return {
    idleMs: Number.isFinite(idle) && idle >= 0 ? idle : 20000,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 180000,
    // En büyük modül (30k satırda ~75 MB JSON) tek başına ayrıştırılır; makine belleğinin yarısını aşmaz.
    maxOldGenerationSizeMb: Math.max(512, Math.min(4096, Math.floor(os.totalmem() / 1024 / 1024 / 2))),
  };
}

function createProjectionRewritePool(options = {}) {
  const opts = { ...poolOptions(), ...options }, WorkerClass = opts.WorkerClass || Worker;
  const queue = [];
  let worker = null, active = null, idleTimer = null, nextId = 1, closed = false;
  const counters = { started: 0, completed: 0, failed: 0, workersCreated: 0 };
  function stopWorker() {
    clearTimeout(idleTimer); idleTimer = null;
    const current = worker; worker = null;
    if (current) { current.removeAllListeners('message'); current.terminate().catch(() => {}); }
  }
  function settle(job, error, value) {
    clearTimeout(job.timer);
    if (active === job) active = null;
    if (error) { counters.failed += 1; job.reject(error); } else { counters.completed += 1; job.resolve(value); }
    pump();
  }
  function fail(error) {
    const job = active;
    stopWorker();
    if (job) settle(job, error);
  }
  function ensureWorker() {
    if (worker) return worker;
    counters.workersCreated += 1;
    const self = new WorkerClass(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb } });
    worker = self;
    const failed = message => Object.assign(new Error(message), { code: 'PROJECTION_REWRITE_WORKER_FAILED' });
    self.on('message', message => {
      const job = active;
      if (worker !== self || !job || !message || message.type !== 'result' || message.id !== job.id) return;
      if (message.ok) settle(job, null, message.value);
      else settle(job, failed('Projeksiyon yeniden yazım işçisi hata verdi / Projection rewrite worker failed: ' + (message.error && message.error.message)));
    });
    self.on('error', error => { if (worker === self) fail(failed('Projeksiyon yeniden yazım işçisi durdu / Projection rewrite worker stopped: ' + (error && error.message))); });
    self.on('exit', () => { if (worker === self) fail(failed('Projeksiyon yeniden yazım işçisi kapandı / Projection rewrite worker exited')); });
    return worker;
  }
  function pump() {
    if (active || closed) return;
    const job = queue.shift();
    if (!job) {
      clearTimeout(idleTimer);
      if (worker) { worker.unref?.(); idleTimer = setTimeout(stopWorker, opts.idleMs); idleTimer.unref?.(); }
      return;
    }
    clearTimeout(idleTimer); idleTimer = null;
    active = job; counters.started += 1;
    try {
      const current = ensureWorker();
      current.ref?.();
      job.timer = setTimeout(() => fail(Object.assign(new Error('Projeksiyon yeniden yazımı zaman aşımına uğradı / Projection rewrite timed out'), { code: 'PROJECTION_REWRITE_TIMEOUT' })), opts.timeoutMs);
      job.timer.unref?.();
      current.postMessage({ type: 'run', id: job.id, payload: job.payload }, job.transfer);
      job.payload = null; job.transfer = null;
    } catch (error) { fail(Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'PROJECTION_REWRITE_WORKER_FAILED' })); }
  }
  /* modules: [{ module, buffer(Buffer) }] — buffer kopyalanıp aktarılır (çağıranın LRU tamponu korunur). */
  function run({ modules, steps }) {
    if (closed) return Promise.reject(Object.assign(new Error('Projection rewrite pool closed'), { code: 'PROJECTION_REWRITE_CLOSED' }));
    const transfer = [];
    const payload = {
      steps,
      modules: modules.map(({ module, buffer }) => {
        const owned = new Uint8Array(buffer.length);
        owned.set(buffer);
        transfer.push(owned.buffer);
        return { module, buffer: owned };
      }),
    };
    return new Promise((resolve, reject) => {
      queue.push({ id: nextId++, payload, transfer, resolve, reject, timer: null });
      pump();
    });
  }
  async function close() {
    closed = true;
    for (const job of queue.splice(0)) job.reject(Object.assign(new Error('Projection rewrite pool closed'), { code: 'PROJECTION_REWRITE_CLOSED' }));
    if (active) fail(Object.assign(new Error('Projection rewrite pool closed'), { code: 'PROJECTION_REWRITE_CLOSED' }));
    stopWorker();
  }
  function stats() { return { ...counters, pending: queue.length, active: Boolean(active), workerAlive: Boolean(worker) }; }
  return { run, close, stats };
}

let shared = null;
function getProjectionRewritePool() { return shared || (shared = createProjectionRewritePool()); }
async function closeProjectionRewritePool() { const current = shared; shared = null; if (current) await current.close(); }

module.exports = { createProjectionRewritePool, getProjectionRewritePool, closeProjectionRewritePool, workerEnabled, poolOptions, WORKER_FILE };
