'use strict';

/* PLM iş kaydı — jobId bazlı, sayfa kapsamına göre izole ilerleme takibi.

   NEDEN VAR: Eskiden ilerleme kullanıcı başına TEK bir slotta tutuluyordu
   (modelOperationProgress). Hangi sayfa iş başlatırsa başlatsın hepsi aynı
   slota yazıyor, /api/model-operation-status hepsine aynı metni döndürüyordu.
   Buna istemcideki tek modül düzeyi zamanlayıcı da eklenince (ikinci işlem
   birincinin tutamacını eziyor, birincisi hiç durmuyordu) ilerleme bilgisi
   sayfalar arasında karışıyordu.

   Burada her işin kendi kimliği, kendi sayaçları ve kendi KAPSAMI (hangi
   ekrana ait olduğu) var. Böylece bir sayfanın işi başka sayfada görünmez,
   ama sayfa değişince iş durmaz — arka planda çalışmaya devam eder.

   Modül SAF tutulmuştur: zamanı dışarıdan alır (now), Express/HTTP bilmez.
   Bu sayede oran/ETA hesapları belirlenimci olarak sınanabilir. */

const DEFAULT_HISTORY_LIMIT = 40;
const DEFAULT_FAILURE_LIMIT = 200;

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function count(value) { const n = Math.trunc(Number(value)); return Number.isFinite(n) && n > 0 ? n : 0; }

/* Türetilmiş ölçüler tek yerde hesaplanır: istemci bunları kendi başına
   hesaplarsa iki taraf kaçınılmaz olarak birbirinden ayrışır. */
function describeJob(job, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const processed = count(job.processed);
  const total = count(job.total);
  const remaining = Math.max(0, total - processed);
  const endedAt = job.finishedAt || at;
  const elapsedMs = Math.max(0, endedAt - job.startedAt);
  // Hız yalnız gerçekten iş yapıldıysa anlamlı; ilk saniyede sonsuz ETA üretmemek için.
  const rate = elapsedMs > 0 && processed > 0 ? (processed / (elapsedMs / 1000)) : 0;
  const etaMs = rate > 0 && remaining > 0 ? Math.round((remaining / rate) * 1000) : null;
  return {
    id: job.id,
    kind: job.kind,
    scope: job.scope,
    label: job.label,
    status: job.status,
    phase: job.phase,
    total,
    processed,
    succeeded: count(job.succeeded),
    failed: count(job.failed),
    remaining,
    percent: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0,
    activeModel: job.activeModel,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    elapsedMs,
    ratePerMinute: rate > 0 ? Math.round(rate * 60 * 10) / 10 : 0,
    etaMs,
    cancelRequested: !!job.cancelRequested,
    failureCount: job.failures.length,
    error: job.error || null,
    running: !TERMINAL.has(job.status),
  };
}

function createJobRegistry(options = {}) {
  const historyLimit = count(options.historyLimit) || DEFAULT_HISTORY_LIMIT;
  const failureLimit = count(options.failureLimit) || DEFAULT_FAILURE_LIMIT;
  const clock = typeof options.now === 'function' ? options.now : () => Date.now();
  // userId -> Map(jobId -> job)
  const byUser = new Map();
  let sequence = 0;

  function bucket(userId) {
    const key = clean(userId) || 'moderator';
    if (!byUser.has(key)) byUser.set(key, new Map());
    return byUser.get(key);
  }

  function nextId() {
    sequence += 1;
    return `job_${Date.now().toString(36)}_${sequence.toString(36)}`;
  }

  /* Biten işler geçmişte tutulur ama sınırsız büyümez. Çalışan işler ASLA
     budanmaz — aksi hâlde uzun süren bir tarama kendi kaydını kaybedebilirdi. */
  function prune(jobs) {
    const finished = [...jobs.values()]
      .filter(job => TERMINAL.has(job.status))
      .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));
    while (finished.length > historyLimit) {
      const oldest = finished.shift();
      jobs.delete(oldest.id);
    }
  }

  function create(userId, input = {}) {
    const jobs = bucket(userId);
    const now = clock();
    const job = {
      id: nextId(),
      userId: clean(userId) || 'moderator',
      kind: clean(input.kind) || 'plm',
      scope: clean(input.scope) || 'genel',
      label: clean(input.label) || clean(input.kind) || 'PLM işlemi',
      status: 'running',
      phase: clean(input.phase),
      total: count(input.total),
      processed: 0,
      succeeded: 0,
      failed: 0,
      activeModel: '',
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      failures: [],
      cancelRequested: false,
      error: null,
      // Yalnızca başarısızları yeniden denemek için gereken girdi.
      retryPayload: input.retryPayload || null,
    };
    jobs.set(job.id, job);
    prune(jobs);
    return job;
  }

  function get(userId, jobId) {
    return bucket(userId).get(clean(jobId)) || null;
  }

  function update(userId, jobId, patch = {}) {
    const job = get(userId, jobId);
    if (!job) return null;
    if (patch.phase !== undefined) job.phase = clean(patch.phase);
    if (patch.total !== undefined) job.total = count(patch.total);
    if (patch.processed !== undefined) job.processed = count(patch.processed);
    if (patch.succeeded !== undefined) job.succeeded = count(patch.succeeded);
    if (patch.failed !== undefined) job.failed = count(patch.failed);
    if (patch.activeModel !== undefined) job.activeModel = clean(patch.activeModel);
    job.updatedAt = clock();
    return job;
  }

  // Başarısız model, kullanıcı "yalnız başarısızları yeniden dene" diyebilsin
  // diye ayrıntısıyla saklanır.
  function addFailure(userId, jobId, failure = {}) {
    const job = get(userId, jobId);
    if (!job) return null;
    if (job.failures.length < failureLimit) {
      job.failures.push({
        plmId: clean(failure.plmId),
        model: clean(failure.model || failure.modelKod || failure.styleName),
        error: clean(failure.error).slice(0, 400),
        code: clean(failure.code),
        at: clock(),
      });
    }
    job.failed = job.failures.length;
    job.updatedAt = clock();
    return job;
  }

  function finish(userId, jobId, outcome = {}) {
    const job = get(userId, jobId);
    if (!job) return null;
    const status = clean(outcome.status);
    job.status = TERMINAL.has(status) ? status : (job.cancelRequested ? 'cancelled' : 'succeeded');
    job.error = outcome.error ? clean(outcome.error).slice(0, 400) : null;
    if (outcome.phase !== undefined) job.phase = clean(outcome.phase);
    job.activeModel = '';
    job.finishedAt = clock();
    job.updatedAt = job.finishedAt;
    prune(bucket(userId));
    return job;
  }

  /* İptal ANINDA sonlandırmaz: çalışan iş bayrağı görüp kendi güvenli
     noktasında durmalıdır. Aksi hâlde yarım yazılmış veri kalabilirdi. */
  function requestCancel(userId, jobId) {
    const job = get(userId, jobId);
    if (!job || TERMINAL.has(job.status)) return null;
    job.cancelRequested = true;
    job.updatedAt = clock();
    return job;
  }

  function isCancelled(userId, jobId) {
    const job = get(userId, jobId);
    return !!(job && job.cancelRequested);
  }

  /* Kapsam süzgeci sayfalar arası karışmayı bitiren yerdir: bir ekran yalnız
     kendi işlerini ister. scope verilmezse hepsi döner (operasyon merkezi). */
  function list(userId, filter = {}) {
    const scope = clean(filter.scope);
    const now = clock();
    const jobs = [...bucket(userId).values()]
      .filter(job => !scope || job.scope === scope)
      .filter(job => (filter.running === undefined ? true : (!TERMINAL.has(job.status)) === !!filter.running))
      .sort((a, b) => b.startedAt - a.startedAt);
    return jobs.map(job => describeJob(job, now));
  }

  function describe(userId, jobId) {
    const job = get(userId, jobId);
    return job ? describeJob(job, clock()) : null;
  }

  function failures(userId, jobId) {
    const job = get(userId, jobId);
    return job ? job.failures.slice() : [];
  }

  // Yalnız başarısız modelleri yeniden denemek için gereken kimlikler.
  function failedIds(userId, jobId) {
    return failures(userId, jobId).map(item => item.plmId).filter(Boolean);
  }

  function clearFinished(userId) {
    const jobs = bucket(userId);
    let removed = 0;
    for (const [id, job] of jobs) if (TERMINAL.has(job.status)) { jobs.delete(id); removed += 1; }
    return removed;
  }

  return {
    create, get, update, addFailure, finish, requestCancel, isCancelled,
    list, describe, failures, failedIds, clearFinished,
    TERMINAL,
  };
}

module.exports = { createJobRegistry, describeJob, TERMINAL };
