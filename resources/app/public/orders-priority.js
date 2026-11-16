/* Siparişler (Orders) öncelik çalıştırıcısı.
 *
 * 30–50 bin satırda kural değerlendirmesi ana iş parçacığında tek seferde
 * yapılırsa ekran saniyelerce donar (ölçüm: 50k satır + 20 kural → 4,6 sn tek
 * uzun görev). Bu yüzden taban analiz + kurallar orders-priority-worker.js'te
 * çalışır; ana iş parçacığı yalnız satır partilerini gönderir ve kod/etiket
 * dizilerini alır. Worker yoksa ya da başarısızsa aynı saf motor ana iş
 * parçacığında ~8 ms'lik dilimlerle çalışır (yine tek uzun görev oluşmaz).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLOrdersPriority = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const BATCH = 1000;
  const SLICE_MS = 8;
  const stats = { runs: 0, workerRuns: 0, fallbackRuns: 0, lastMs: 0, lastRows: 0, lastMode: '' };
  const now = () => (root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now());
  const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
  const cancelled = () => Object.assign(new Error('ORDERS_PRIORITY_CANCELLED'), { code: 'ORDERS_PRIORITY_CANCELLED' });

  async function inWorker(rows, spec, isCurrent) {
    const worker = new root.Worker('orders-priority-worker.js');
    let pending = null, id = 0, failure = null;
    worker.onmessage = event => {
      const message = event.data || {};
      if (!pending || message.id !== pending.id) return;
      const next = pending; pending = null;
      message.ok ? next.resolve(message.result) : next.reject(new Error(message.error || 'ORDERS_PRIORITY_WORKER_FAILED'));
    };
    worker.onerror = event => { if (event && event.preventDefault) event.preventDefault(); failure = new Error('ORDERS_PRIORITY_WORKER_FAILED'); if (pending) { pending.reject(failure); pending = null; } };
    worker.onmessageerror = worker.onerror;
    const send = (type, payload) => new Promise((resolve, reject) => {
      if (failure) { reject(failure); return; }
      pending = { id: ++id, resolve, reject };
      try { worker.postMessage({ id, type, payload }); } catch (error) { pending = null; reject(error); }
    });
    try {
      await send('begin', spec);
      const codes = new Array(rows.length), tags = new Array(rows.length);
      for (let start = 0; start < rows.length; start += BATCH) {
        if (!isCurrent()) throw cancelled();
        const result = await send('batch', rows.slice(start, start + BATCH));
        for (let i = 0; i < result.codes.length; i += 1) { codes[start + i] = result.codes[i]; tags[start + i] = result.tags[i]; }
        // Bir sonraki partinin kopyalanmasından önce ekrana nefes aldırılır.
        await yieldTask();
      }
      await send('end', null).catch(() => null);
      return { codes, tags };
    } finally { worker.terminate(); }
  }

  async function cooperative(rows, spec, isCurrent) {
    const engine = root.BLOrdersPriorityEngine;
    if (!engine || typeof engine.createSession !== 'function') throw new Error('ORDERS_PRIORITY_ENGINE_MISSING');
    const session = engine.createSession(spec);
    const codes = new Array(rows.length), tags = new Array(rows.length);
    let sliceStart = now();
    for (let i = 0; i < rows.length; i += 1) {
      if (now() - sliceStart >= SLICE_MS) { await yieldTask(); if (!isCurrent()) throw cancelled(); sliceStart = now(); }
      const result = session.evaluateRow(rows[i]);
      codes[i] = result.priority; tags[i] = result.trackingTags.length ? result.trackingTags : null;
    }
    return { codes, tags };
  }

  /* rows: Siparişler satırları. spec: { context, rules, priorityCatalog }.
     isCurrent(): hesap sırasında veri/kural değişirse false döner, sonuç atılır. */
  async function run(rows, spec, options) {
    const list = Array.isArray(rows) ? rows : [];
    const isCurrent = options && typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    const started = now();
    let result = null, mode = 'worker';
    if (typeof root.Worker === 'function' && !(options && options.forceFallback)) {
      try { result = await inWorker(list, spec, isCurrent); }
      catch (error) { if (error && error.code === 'ORDERS_PRIORITY_CANCELLED') throw error; result = null; }
    }
    if (!result) { mode = 'fallback'; result = await cooperative(list, spec, isCurrent); }
    // Hesap sürerken veri/kural değiştiyse eski sonuç asla dönmez.
    if (!isCurrent()) throw cancelled();
    stats.runs += 1; stats[mode === 'worker' ? 'workerRuns' : 'fallbackRuns'] += 1;
    stats.lastMs = Math.round(now() - started); stats.lastRows = list.length; stats.lastMode = mode;
    return { ...result, mode, ms: stats.lastMs };
  }

  return Object.freeze({ run, stats: () => ({ ...stats }), BATCH });
});
