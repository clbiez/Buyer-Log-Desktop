'use strict';
/* Projeksiyon yeniden yazım işçisi istemcisi (#1078 takip / WS7b, okuma beklemesi: WS7b-2).
   En çok `workers` işçi (BL_PROJECTION_REWRITE_WORKERS, varsayılan min(3, çekirdek−1)); her iş bir
   işçide çalışır, fazlası sırada bekler. page-projection-cache bir yeniden yazımın modüllerini
   boyuta göre bu işçilere böler: modüller birbirinden bağımsızdır, sonuç aynıdır, duvar süresi en
   büyük modülün süresine iner. İşçiler ilk işte kurulur, boşta BL_PROJECTION_REWRITE_IDLE_MS
   (varsayılan 5 sn) sonra kapanır: boşta bellek tutmaz (kayıt akışında yazımlar 2–3 sn arayla gelir, işçiler canlı kalır). Zaman aşımı veya işçi hatası işi
   reddeder; çağıran aynı isteği ana iş parçacığında eski yolla tamamlar (page-projection-cache).
   Geri dönüş anahtarları: BL_PROJECTION_REWRITE_WORKER=0 (işçi yok), BL_PROJECTION_REWRITE_WORKERS=1
   (paralel bölme yok). */
const path = require('node:path'), os = require('node:os');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, '..', 'workers', 'projection-rewrite-worker.js');
function workerEnabled(env = process.env) { return String(env.BL_PROJECTION_REWRITE_WORKER ?? '') !== '0'; }
function poolOptions(env = process.env) {
  const idle = Number(env.BL_PROJECTION_REWRITE_IDLE_MS), timeout = Number(env.BL_PROJECTION_REWRITE_TIMEOUT_MS), count = Number(env.BL_PROJECTION_REWRITE_WORKERS);
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return {
    idleMs: Number.isFinite(idle) && idle >= 0 ? idle : 5000,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 180000,
    workers: Number.isSafeInteger(count) && count >= 1 && count <= 8 ? count : Math.max(1, Math.min(3, cores - 1)),
    // En büyük modül (30k satırda ~75 MB JSON) tek başına ayrıştırılır; makine belleğinin yarısını aşmaz.
    maxOldGenerationSizeMb: Math.max(512, Math.min(4096, Math.floor(os.totalmem() / 1024 / 1024 / 2))),
  };
}

function createProjectionRewritePool(options = {}) {
  const opts = { ...poolOptions(), ...options }, WorkerClass = opts.WorkerClass || Worker;
  const queue = [], slots = [];
  let nextId = 1, closed = false;
  const counters = { started: 0, completed: 0, failed: 0, workersCreated: 0 };
  const failed = (message, code = 'PROJECTION_REWRITE_WORKER_FAILED') => Object.assign(new Error(message), { code });
  function stopWorker(slot) {
    clearTimeout(slot.idleTimer); slot.idleTimer = null;
    const current = slot.worker; slot.worker = null;
    if (current) { current.removeAllListeners('message'); current.terminate().catch(() => {}); }
    const index = slots.indexOf(slot);
    if (index >= 0 && !slot.job) slots.splice(index, 1);
  }
  function settle(slot, job, error, value) {
    clearTimeout(job.timer);
    if (slot.job === job) slot.job = null;
    if (error) { counters.failed += 1; job.reject(error); } else { counters.completed += 1; job.resolve(value); }
    if (!slot.worker) { const index = slots.indexOf(slot); if (index >= 0) slots.splice(index, 1); }
    pump();
  }
  function fail(slot, error) {
    const job = slot.job;
    slot.job = null;
    stopWorker(slot);
    if (job) settle(slot, job, error);
  }
  function ensureWorker(slot) {
    if (slot.worker) return slot.worker;
    counters.workersCreated += 1;
    const self = new WorkerClass(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: opts.maxOldGenerationSizeMb } });
    slot.worker = self;
    self.on('message', message => {
      const job = slot.job;
      if (slot.worker !== self || !job || !message || message.type !== 'result' || message.id !== job.id) return;
      if (message.ok) settle(slot, job, null, message.value);
      else settle(slot, job, failed('Projeksiyon yeniden yazım işçisi hata verdi / Projection rewrite worker failed: ' + (message.error && message.error.message)));
    });
    self.on('error', error => { if (slot.worker === self) fail(slot, failed('Projeksiyon yeniden yazım işçisi durdu / Projection rewrite worker stopped: ' + (error && error.message))); });
    self.on('exit', () => { if (slot.worker === self) fail(slot, failed('Projeksiyon yeniden yazım işçisi kapandı / Projection rewrite worker exited')); });
    return self;
  }
  function idle(slot) {
    clearTimeout(slot.idleTimer);
    if (!slot.worker) return;
    slot.worker.unref?.();
    slot.idleTimer = setTimeout(() => stopWorker(slot), opts.idleMs);
    slot.idleTimer.unref?.();
  }
  function pump() {
    if (closed) return;
    while (queue.length) {
      let slot = slots.find(item => !item.job && item.worker) || slots.find(item => !item.job);
      if (!slot && slots.length < opts.workers) { slot = { worker: null, job: null, idleTimer: null }; slots.push(slot); }
      if (!slot) return;
      const job = queue.shift();
      clearTimeout(slot.idleTimer); slot.idleTimer = null;
      slot.job = job; counters.started += 1;
      try {
        const current = ensureWorker(slot);
        current.ref?.();
        job.timer = setTimeout(() => fail(slot, failed('Projeksiyon yeniden yazımı zaman aşımına uğradı / Projection rewrite timed out', 'PROJECTION_REWRITE_TIMEOUT')), opts.timeoutMs);
        job.timer.unref?.();
        current.postMessage({ type: 'run', id: job.id, payload: job.payload }, job.transfer);
        job.payload = null; job.transfer = null;
      } catch (error) { fail(slot, Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'PROJECTION_REWRITE_WORKER_FAILED' })); }
    }
    for (const slot of slots) if (!slot.job) idle(slot);
  }
  /* modules: [{ module, buffer(Buffer) }] — buffer kopyalanıp aktarılır (çağıranın LRU tamponu korunur). */
  function run({ modules, steps }) {
    if (closed) return Promise.reject(failed('Projection rewrite pool closed', 'PROJECTION_REWRITE_CLOSED'));
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
    for (const job of queue.splice(0)) job.reject(failed('Projection rewrite pool closed', 'PROJECTION_REWRITE_CLOSED'));
    for (const slot of slots.slice()) { if (slot.job) fail(slot, failed('Projection rewrite pool closed', 'PROJECTION_REWRITE_CLOSED')); else stopWorker(slot); }
  }
  function stats() { return { ...counters, pending: queue.length, active: slots.filter(slot => slot.job).length, workersAlive: slots.filter(slot => slot.worker).length, workers: opts.workers }; }
  return { run, close, stats, parallelism: opts.workers };
}

let shared = null;
function getProjectionRewritePool() { return shared || (shared = createProjectionRewritePool()); }
async function closeProjectionRewritePool() { const current = shared; shared = null; if (current) await current.close(); }

module.exports = { createProjectionRewritePool, getProjectionRewritePool, closeProjectionRewritePool, workerEnabled, poolOptions, WORKER_FILE };
