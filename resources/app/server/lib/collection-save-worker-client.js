'use strict';

/* ===================================================================
   v7.21 — KOLEKSİYON KAYDETME WORKER İSTEMCİSİ (KALICI İŞ PARÇACIĞI)

   Kaydetme başına yeni bir iş parçacığı açmak ölçümde ~100 ms başlangıç
   maliyeti getiriyordu; 350 ms'lik yazma aralığında bu kabul edilemez.
   Tek bir kalıcı worker açılır, görevler mesajla gönderilir.

   KUYRUKLAMA SAYFA BAZINDADIR. Aynı Koleksiyon sayfasına iki eşzamanlı
   yazma dosya kilidi üzerinde birbirini bekler ve ikincisi 3 saniyede
   SHARED_WRITE_BUSY ile düşebilir; aynı sayfa için işleri sıraya koymak bu
   yarışı baştan önler. FARKLI sayfalar sıraya girmez — kullanıcının asıl
   istediği buydu: bir buyer'ın kaydı başka bir buyer'ı beklemesin.

   Worker çökerse bir sonraki istekte yeniden açılır; bekleyen görevler
   hatayla sonlanır, sessizce kaybolmaz.
   =================================================================== */

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, '..', 'collection-save-worker.js');
const DEFAULT_TIMEOUT_MS = 120000;

let worker = null;
let workerEnvKey = '';
const pending = new Map();      // görev id → { resolve, reject, timer }
const queueByOwner = new Map(); // ownerId → kuyruk kuyruğu
let nextTaskId = 1;

function failAllPending(error,sourceWorker) {
  for (const [id, entry] of pending) {
    if(sourceWorker && entry.worker!==sourceWorker)continue;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.reject(error);
  }
}
function envKeyOf(env) { return JSON.stringify(env || {}); }
function ensureWorker(env) {
  // Depo kökleri değişirse (testler farklı kök kullanır) worker yenilenir;
  // aksi halde eski köke yazmaya devam ederdi.
  if (worker && workerEnvKey === envKeyOf(env)) return worker;
  if (worker) { const old = worker; worker = null; old.terminate().catch(() => {}); }
  workerEnvKey = envKeyOf(env);
  const created = new Worker(WORKER_FILE, { workerData: { env } });
  created.on('message', message => {
    if (!message || message.ready) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) { entry.resolve(message); return; }
    const error = new Error(message.error || 'Koleksiyon sayfası kaydedilemedi.');
    // Worker içindeki hata HTTP anlamını (409 revizyon çakışması gibi)
    // KAYBETMEDEN taşınır; aksi halde her hata 500 olurdu.
    error.code = message.code || 'COLLECTION_SAVE_FAILED';
    error.statusCode = Number(message.statusCode) || 500;
    if (message.currentRevision != null) error.currentRevision = message.currentRevision;
    if (Array.isArray(message.conflicts)) error.conflicts = message.conflicts;
    entry.reject(error);
  });
  const onDead = reason => {
    if (worker === created) { worker = null; workerEnvKey = ''; }
    const error = new Error(`Koleksiyon kaydetme iş parçacığı durdu: ${reason}`);
    error.code = 'COLLECTION_SAVE_WORKER_DOWN';
    failAllPending(error,created);
  };
  created.on('error', error => onDead(String(error && error.message || error)));
  created.on('exit', code => { if (code !== 0) onDead(`çıkış kodu ${code}`); });
  // Worker açık kalsa da süreç kapanışını engellememeli.
  created.unref();
  worker = created;
  return worker;
}

function send(task, timeoutMs) {
  return new Promise((resolve, reject) => {
    let active;
    try { active = ensureWorker(task.env); }
    catch (error) { reject(error); return; }
    const id = nextTaskId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = new Error('Koleksiyon kaydetme iş parçacığı zaman aşımına uğradı.');
      error.code = 'COLLECTION_SAVE_TIMEOUT';
      error.statusCode = 504;
      reject(error);
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, worker:active });
    try {
      // Gövde TAŞINIR, kopyalanmaz. postMessage varsayılan olarak yapısal
      // klonlama yapar; 8-18 MB'lık bir gövdede bu, kaçmaya çalıştığımız
      // ana-iş-parçacığı bloğunu geri getirirdi. Buffer'ın kendi
      // ArrayBuffer'ı transfer listesine konarak kopya tamamen önlenir.
      const body = task.body;
      const slice = body.byteOffset === 0 && body.byteLength === body.buffer.byteLength
        ? body.buffer
        : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      active.postMessage({ ...task, body: slice, id }, [slice]);
    }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}

function runCollectionSave(payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = String(payload && payload.ownerId || '');
  const previous = queueByOwner.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => send(payload, timeoutMs));
  const tail = task.catch(() => {});
  queueByOwner.set(key, tail);
  // Kuyruk zinciri sonsuza kadar büyümesin: bu iş kuyruğun sonuysa kaydı sil.
  tail.then(() => { if (queueByOwner.get(key) === tail) queueByOwner.delete(key); });
  return task;
}

function shutdown() {
  if (!worker) return Promise.resolve();
  const old = worker; worker = null; workerEnvKey = '';
  return old.terminate().catch(() => {});
}

module.exports = { runCollectionSave, shutdown, WORKER_FILE };
