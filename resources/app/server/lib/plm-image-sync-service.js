'use strict';

/* PLM GÖRSEL SENKRONU — AŞAMA YÖNETİCİSİ.
 *
 * Tek görev: aşamaları doğru sırada, sınırlı eşzamanlılıkla ve iptal
 * edilebilir biçimde yürütmek. Ağ ve depo BİLMEZ; hepsi enjekte edilir
 * (styleListLookup / styleImagesLookup / downloadImage / ingest / checkpoint).
 * Bu yüzden 100'lük parti sözleşmesi, parti bölme, renk seçimi, önbellek
 * isabeti ve kısmi başarı davranışı tarayıcı olmadan sınanabilir.
 *
 * AŞAMALAR
 *   1) resolving        — GetStyleList, 100'lük partiler, başarısız parti
 *                         100 -> 50 -> 20 bölünür.
 *   2) fetching-images  — GetStyleImages, TEKİL styleId başına BİR kez,
 *                         sınırlı eşzamanlılık (5).
 *   3) downloading      — seçilen Attachment görselleri, sınırlı
 *                         eşzamanlılık (8), üstel geri çekilme + jitter.
 *   4) commit           — kanonik alım yolu (plm-image-ingest).
 *
 * TEK BİR GÖRSELİN BAŞARISIZLIĞI İŞİ DÜŞÜRMEZ: iş 'partial' biter. Yalnız
 * yetki hatası (401/403) metadata aşamasını TEMİZ biçimde durdurur —
 * CoreNectum'u yeniden denemelerle dövmek yerine kullanıcıya oturum
 * tazelemesi gerektiği söylenir.
 */

const api = require('./corenectum-style-api');
const jobStore = require('./plm-image-job-store');
const { runBounded } = require('./plm-image-download-queue');
const ingestLib = require('./plm-image-ingest');

const AUTH_CODES = new Set(['CORENECTUM_LOGIN_REQUIRED', 'PLM_IMAGE_AUTH', 'CORENECTUM_AUTH_REQUIRED']);

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function syncError(message, code, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isAuthFailure(error) {
  if (!error) return false;
  if (AUTH_CODES.has(clean(error.code, 60))) return true;
  const status = Number(error.status || error.statusCode);
  return status === 401 || status === 403;
}

function isCancellation(error) {
  return Boolean(error && clean(error.code, 60) === 'PLM_JOB_CANCELLED');
}

function assertNotCancelled(isCancelled) {
  if (typeof isCancelled === 'function' && isCancelled()) {
    throw syncError('PLM görsel işlemi kullanıcı tarafından durduruldu.', 'PLM_JOB_CANCELLED', 499);
  }
}

/* ======================================================================
   1) ÇÖZÜMLEME — GetStyleList, 100'lük parti + 100/50/20 bölme.

   Başarılı bir yanıtta dönmeyen PLM "bulunamadı"dır (yeniden denenmez).
   Yalnız İSTEĞİN KENDİSİ başarısız olursa parti bölünür; böylece başarılı
   PLM'ler ikinci kez sorulmaz.
   ====================================================================== */
async function resolveStyleRows(plmIds, options = {}) {
  const lookup = options.styleListLookup;
  if (typeof lookup !== 'function') throw syncError('GetStyleList çözümleyicisi bağlanmadı.', 'PLM_STYLE_LOOKUP_MISSING', 500);
  const batchSize = Math.max(1, Math.trunc(Number(options.batchSize)) || api.STYLE_LIST_BATCH_SIZE);
  const rows = new Map();
  const errors = new Map();
  const ambiguous = new Set();
  const batchLog = [];
  const requested = api.dedupePlmCodes(plmIds);

  async function attempt(codes, size) {
    for (const chunk of api.splitBatches(codes, size)) {
      assertNotCancelled(options.isCancelled);
      // Önceki basamakta çözülmüş PLM ikinci kez sorulmaz.
      const pending = chunk.filter(code => !rows.has(code));
      if (!pending.length) continue;
      const startedAt = Date.now();
      try {
        const payload = await lookup(pending);
        const parsed = api.styleListRowsByPlm(payload);
        for (const [plmId, row] of parsed.rows) if (!rows.has(plmId)) rows.set(plmId, row);
        for (const plmId of parsed.ambiguous) ambiguous.add(plmId);
        batchLog.push({ size: pending.length, returned: parsed.rows.size, ms: Date.now() - startedAt });
        for (const code of pending) {
          if (rows.has(code) || ambiguous.has(code)) continue;
          errors.set(code, { code: 'CORENECTUM_STYLE_NOT_FOUND', error: `PLM ${code} GetStyleList yanıtında dönmedi.` });
        }
        if (typeof options.onProgress === 'function') {
          options.onProgress({ phase: 'PLM çözümleniyor', current: rows.size, total: requested.length, model: pending[pending.length - 1] || '' });
        }
      } catch (error) {
        if (isCancellation(error)) throw error;
        // Yetki hatasında parti bölmek anlamsız: hepsi aynı hatayı verir ve
        // CoreNectum boşuna dövülür.
        if (isAuthFailure(error)) throw syncError('CoreNectum PLM oturumu gerekli. Edge sekmesinde CoreNectum girişini tazeleyip tekrar deneyin.', 'CORENECTUM_LOGIN_REQUIRED', 409);
        const next = api.nextFallbackBatchSize(pending.length);
        batchLog.push({ size: pending.length, returned: 0, ms: Date.now() - startedAt, error: clean(error && error.message, 200) });
        if (next > 0 && pending.length > next) { await attempt(pending, next); continue; }
        for (const code of pending) {
          if (rows.has(code)) continue;
          errors.set(code, { code: clean(error && error.code, 60) || 'CORENECTUM_STYLE_LOOKUP_FAILED', error: clean(error && error.message, 300) || `PLM ${code} çözümlenemedi.` });
        }
      }
    }
  }

  await attempt(requested, batchSize);
  for (const plmId of ambiguous) {
    rows.delete(plmId);
    errors.set(plmId, { code: 'CORENECTUM_STYLE_AMBIGUOUS', error: `PLM ${plmId} için GetStyleList birbiriyle çelişen birden fazla satır döndürdü; keyfi satır seçilmedi.` });
  }
  return { rows, errors, ambiguous: [...ambiguous], batchLog, requested: requested.length };
}

/* ======================================================================
   2) METADATA — GetStyleImages, TEKİL styleId başına BİR çağrı.

   Aynı modelin üç rengi istendiğinde yanıt aynıdır; üç kez sormak yalnız
   CoreNectum'u meşgul eder.
   ====================================================================== */
async function fetchStyleImageMetadata(styleIds, options = {}) {
  const lookup = options.styleImagesLookup;
  if (typeof lookup !== 'function') throw syncError('GetStyleImages çözümleyicisi bağlanmadı.', 'PLM_STYLE_IMAGES_LOOKUP_MISSING', 500);
  const metadata = new Map();
  const errors = new Map();
  const ids = [...new Set((Array.isArray(styleIds) ? styleIds : []).map(api.coreId).filter(Boolean))];
  let processed = 0;
  let authError = null;

  const run = await runBounded(ids, async styleId => {
    assertNotCancelled(options.isCancelled);
    if (authError) throw authError;
    try {
      const payload = await lookup(styleId);
      const parsed = api.parseStyleImages(payload);
      metadata.set(styleId, parsed);
      return parsed;
    } catch (error) {
      if (isCancellation(error)) throw error;
      if (isAuthFailure(error)) {
        authError = syncError('CoreNectum PLM oturumu gerekli. Edge sekmesinde CoreNectum girişini tazeleyip tekrar deneyin.', 'CORENECTUM_LOGIN_REQUIRED', 409);
        throw authError;
      }
      errors.set(styleId, { code: clean(error && error.code, 60) || 'CORENECTUM_STYLE_IMAGES_FAILED', error: clean(error && error.message, 300) });
      throw error;
    } finally {
      processed += 1;
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'Renk görselleri okunuyor', current: processed, total: ids.length, model: styleId });
      }
    }
  }, {
    concurrency: api.boundedConcurrency(options.concurrency, api.STYLE_IMAGES_CONCURRENCY),
    isCancelled: options.isCancelled,
  });

  if (authError) throw authError;
  return { metadata, errors, styleIds: ids, cancelled: run.cancelled, calls: metadata.size + errors.size };
}

/* ======================================================================
   TAM AKIŞ
   ====================================================================== */
async function runPlmImageSync(input = {}) {
  const requests = (Array.isArray(input.requests) ? input.requests : [])
    .map(jobStore.normalizeItem).filter(item => item.plmId);
  const ingest = input.ingest;
  if (!ingest) throw syncError('Kanonik görsel alım yolu bağlanmadı.', 'PLM_IMAGE_INGEST_MISSING', 500);
  const checkpoint = input.checkpoint || null;
  const mode = input.mode === 'all' ? 'all' : 'missing';
  const overwriteManual = input.overwriteManual === true;
  const isCancelled = typeof input.isCancelled === 'function' ? input.isCancelled : () => false;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => {};
  const store = input.store;
  const imagemap = input.imagemap || {};
  const counts = jobStore.emptyCounts();
  const failures = [];
  const skipped = [];

  const note = patch => { counts.requested = requests.length; if (checkpoint) checkpoint.bump(patch); };
  const fail = failure => {
    const normalized = { plmId: clean(failure.plmId, 40), colourCode: clean(failure.colourCode, 40), colour: clean(failure.colour, 160), styleName: clean(failure.styleName, 300), code: clean(failure.code, 60), error: clean(failure.error, 400) };
    failures.push(normalized);
    counts.failed = failures.length;
    if (checkpoint) checkpoint.fail(normalized);
  };
  const phase = (status, text) => { if (checkpoint) checkpoint.phase(status, text); };

  counts.requested = requests.length;
  if (!requests.length) {
    return { status: jobStore.STATUS_COMPLETED, counts, failures, skipped, outcomes: [], linksUpdated: 0 };
  }

  // 0) Mod ve manuel sahiplik: metadata'ya HİÇ gitmeyecek kalemler burada
  //    düşer. Manuel görsel korunur; "eksikleri tamamla" modunda zaten
  //    kullanılabilir görseli olanlar istenmez.
  const decided = [];
  for (const request of requests) {
    const decision = ingest.decideBeforeFetch(request, { store, imagemap, mode, overwriteManual });
    if (decision.decision === ingestLib.DECISION_FETCH) { decided.push(decision); continue; }
    if (decision.decision === ingestLib.DECISION_MANUAL) { counts.manualPreserved += 1; skipped.push(decision); if (checkpoint) checkpoint.complete(decision); continue; }
    if (decision.decision === ingestLib.DECISION_CACHED) { counts.cacheHits += 1; skipped.push(decision); if (checkpoint) checkpoint.complete(decision); continue; }
    fail({ ...decision, error: decision.reason, code: decision.code || 'PLM_IMAGE_KEY_INVALID' });
  }
  if (checkpoint) checkpoint.set({ manualPreserved: counts.manualPreserved, cacheHits: counts.cacheHits });

  if (!decided.length) {
    phase(jobStore.STATUS_COMPLETED, '');
    return { status: failures.length ? jobStore.STATUS_PARTIAL : jobStore.STATUS_COMPLETED, counts, failures, skipped, outcomes: [], linksUpdated: 0 };
  }

  // 1) Çözümleme
  phase(jobStore.STATUS_RESOLVING, 'PLM çözümleniyor');
  const resolution = await resolveStyleRows(decided.map(item => item.plmId), {
    ...input, isCancelled, onProgress: progress => onProgress({ ...progress, stage: 'resolving' }),
  });
  counts.resolved = resolution.rows.size;
  counts.unresolved = resolution.errors.size;
  if (checkpoint) checkpoint.set({ resolved: counts.resolved, unresolved: counts.unresolved });

  const pending = [];
  for (const item of decided) {
    const row = resolution.rows.get(item.plmId);
    if (!row) {
      const detail = resolution.errors.get(item.plmId) || { code: 'CORENECTUM_STYLE_NOT_FOUND', error: `PLM ${item.plmId} GetStyleList verilerinde bulunamadı.` };
      fail({ ...item, ...detail });
      continue;
    }
    // Style ID istemciden değil, GetStyleList yanıtından (veya kayıtlı
    // linkten) gelir: istemcinin gönderdiği bir styleId'ye güvenilmez.
    pending.push({ ...item, styleId: row.styleId || item.styleId, styleName: item.styleName || row.styleName, styleListImageUrl: row.imageUrl, colors: row.colors });
  }
  if (!pending.length) {
    phase(jobStore.STATUS_PARTIAL, '');
    return { status: jobStore.STATUS_PARTIAL, counts, failures, skipped, outcomes: [], linksUpdated: 0, resolution };
  }

  // 2) Metadata (tekil styleId)
  phase(jobStore.STATUS_FETCHING_IMAGES, 'Renk görselleri okunuyor');
  const plan = api.uniqueStyleIdPlan(pending);
  const meta = await fetchStyleImageMetadata(plan.styleIds, {
    ...input, isCancelled, onProgress: progress => onProgress({ ...progress, stage: 'fetching-images' }),
  });
  counts.stylesProcessed = meta.metadata.size;
  counts.styleMetadataFailed = meta.errors.size;
  if (checkpoint) checkpoint.set({ stylesProcessed: counts.stylesProcessed, styleMetadataFailed: counts.styleMetadataFailed });

  // 3) Seçim + önbellek + indirme planı
  const downloads = [];
  const ready = [];
  for (const item of pending) {
    assertNotCancelled(isCancelled);
    const bucket = item.styleId ? meta.metadata.get(item.styleId) : null;
    const metaError = item.styleId ? meta.errors.get(item.styleId) : null;
    const selection = api.selectColourImage({
      colourCode: item.colourCode,
      optionImages: (bucket && bucket.optionImages) || [],
      styleImages: (bucket && bucket.styleImages) || [],
      styleListImageUrl: item.styleListImageUrl,
    });
    if (selection.sourceType === api.SOURCE_OPTION) counts.optionImagesFound += 1;
    else if (selection.sourceType === api.SOURCE_STYLE_DEFAULT || selection.sourceType === api.SOURCE_STYLE_LIST) counts.fallbacksUsed += 1;

    if (selection.sourceType === api.SOURCE_MISSING) {
      counts.missing += 1;
      // Görsel bulunamadı: MEVCUT geçerli görsel ASLA silinmez, kayıt
      // olduğu gibi kalır. Yalnız rapora düşer.
      if (metaError) fail({ ...item, ...metaError });
      else skipped.push({ ...item, decision: 'missing', reason: selection.reason });
      if (checkpoint) checkpoint.complete(item);
      continue;
    }

    const gated = ingest.decideBeforeWrite(item, selection, { store, overwriteManual });
    if (gated.decision === ingestLib.DECISION_CACHED) {
      counts.cacheHits += 1;
      skipped.push(gated);
      if (checkpoint) checkpoint.complete(item);
      continue;
    }
    if (gated.decision === ingestLib.DECISION_MANUAL) {
      counts.manualPreserved += 1;
      skipped.push(gated);
      if (checkpoint) checkpoint.complete(item);
      continue;
    }
    downloads.push({ ...item, selection, sourceType: selection.sourceType, sourceIdentity: selection.sourceIdentity, imageUrl: selection.imageUrl, colour: item.colour || selection.colour });
  }
  if (checkpoint) checkpoint.set({ optionImagesFound: counts.optionImagesFound, fallbacksUsed: counts.fallbacksUsed, missing: counts.missing, cacheHits: counts.cacheHits, manualPreserved: counts.manualPreserved });

  // 4) İndirme (sınırlı eşzamanlılık). Aynı Attachment birden çok renkte
  //    seçilmiş olabilir: bayt TEK kez indirilir.
  phase(jobStore.STATUS_DOWNLOADING, 'Görseller indiriliyor');
  const downloadImage = typeof input.downloadImage === 'function' ? input.downloadImage : null;
  if (!downloadImage) throw syncError('Görsel indirme motoru bağlanmadı.', 'PLM_IMAGE_DOWNLOADER_MISSING', 500);
  const byUrl = new Map();
  for (const item of downloads) {
    const identity = api.attachmentIdentity(item.imageUrl) || item.imageUrl;
    if (!byUrl.has(identity)) byUrl.set(identity, { url: item.imageUrl, items: [] });
    byUrl.get(identity).items.push(item);
  }
  const uniqueUrls = [...byUrl.values()];
  let downloaded = 0;

  const run = await runBounded(uniqueUrls, async task => {
    assertNotCancelled(isCancelled);
    const image = await downloadImage(task.url, { isCancelled });
    downloaded += 1;
    counts.downloadsCompleted = downloaded;
    counts.bytesDownloaded += Number(image.size) || 0;
    onProgress({ phase: 'Görseller indiriliyor', current: downloaded, total: uniqueUrls.length, model: task.items[0] && task.items[0].plmId, stage: 'downloading' });
    if (checkpoint) checkpoint.set({ downloadsCompleted: counts.downloadsCompleted, bytesDownloaded: counts.bytesDownloaded });
    return image;
  }, { concurrency: api.boundedConcurrency(input.downloadConcurrency, api.IMAGE_DOWNLOAD_CONCURRENCY), isCancelled });

  for (let index = 0; index < uniqueUrls.length; index += 1) {
    const result = run.results[index];
    const task = uniqueUrls[index];
    if (!result || result.cancelled) continue;
    if (!result.ok) {
      // TEK bir görselin başarısızlığı işi düşürmez.
      for (const item of task.items) fail({ ...item, code: clean(result.error && result.error.code, 60) || 'PLM_IMAGE_DOWNLOAD_FAILED', error: clean(result.error && result.error.message, 300) });
      continue;
    }
    for (const item of task.items) {
      ready.push({ ...item, buffer: result.value.buffer, mimeType: result.value.mimeType });
    }
  }

  // 5) Kanonik yazma
  let commit = { outcomes: [], linksUpdated: 0, counts: {}, overrides: { imagemap }, store, removedFiles: 0 };
  if (ready.length) {
    commit = ingest.commit(ready, { store, imagemap, overwriteManual, dropOldFiles: input.dropOldFiles === true });
    for (const outcome of commit.outcomes) {
      if (outcome.status === ingestLib.COMMIT_FAILED) fail({ ...outcome, error: outcome.error, code: outcome.code });
      else if (checkpoint) checkpoint.complete(outcome);
    }
    counts.manualPreserved += (commit.counts.manualPreserved || 0);
  }

  const cancelled = isCancelled() || run.cancelled;
  const status = cancelled ? jobStore.STATUS_CANCELLED
    : failures.length ? jobStore.STATUS_PARTIAL
      : jobStore.STATUS_COMPLETED;
  phase(status, '');

  return {
    status,
    counts,
    failures,
    skipped,
    outcomes: commit.outcomes,
    linksUpdated: commit.linksUpdated,
    overrides: commit.overrides,
    store: commit.store || store,
    removedFiles: commit.removedFiles || 0,
    resolution: { batchLog: resolution.batchLog, ambiguous: resolution.ambiguous },
    metadataCalls: meta.calls,
    uniqueDownloads: uniqueUrls.length,
  };
}

/* HAZIR PAKET AKIŞI — canlı senkronla AYNI kanonik alım yolunu kullanır.
   Fark yalnız baytların nereden geldiğidir: burada dosya sisteminden. */
async function runPackageImport(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const ingest = input.ingest;
  if (!ingest) throw syncError('Kanonik görsel alım yolu bağlanmadı.', 'PLM_IMAGE_INGEST_MISSING', 500);
  const readImage = typeof input.readImage === 'function' ? input.readImage : null;
  if (!readImage) throw syncError('Paket dosya okuyucusu bağlanmadı.', 'PLM_PACKAGE_READER_MISSING', 500);
  const checkpoint = input.checkpoint || null;
  const isCancelled = typeof input.isCancelled === 'function' ? input.isCancelled : () => false;
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => {};
  const counts = jobStore.emptyCounts();
  const failures = [];
  const ready = [];
  counts.requested = entries.length;

  const fail = failure => {
    const normalized = { plmId: clean(failure.plmId, 40), colourCode: clean(failure.colourCode, 40), colour: clean(failure.colour, 160), styleName: clean(failure.styleName, 300), code: clean(failure.code, 60), error: clean(failure.error, 400) };
    failures.push(normalized);
    counts.failed = failures.length;
    if (checkpoint) checkpoint.fail(normalized);
  };

  if (checkpoint) checkpoint.phase(jobStore.STATUS_DOWNLOADING, 'Paket görselleri alınıyor');
  let processed = 0;
  // Baytlar TEK TEK okunur: 5.876 görselin tamamını belleğe almak gereksiz ve
  // tehlikelidir (önizleme de bu yüzden bayt tutmaz).
  for (const entry of entries) {
    if (isCancelled()) break;
    processed += 1;
    try {
      const buffer = readImage(entry.fullPath);
      ready.push({ ...entry, buffer, mimeType: entry.mimeType });
      counts.downloadsCompleted += 1;
      counts.bytesDownloaded += Number(buffer && buffer.length) || 0;
      if (entry.sourceType === api.SOURCE_OPTION) counts.optionImagesFound += 1;
      else counts.fallbacksUsed += 1;
    } catch (error) {
      fail({ ...entry, code: 'PLM_PACKAGE_FILE_UNREADABLE', error: clean(error && error.message, 300) });
    }
    if (processed % 25 === 0 || processed === entries.length) {
      onProgress({ phase: 'Paket görselleri alınıyor', current: processed, total: entries.length, model: entry.plmId, stage: 'downloading' });
      if (checkpoint) checkpoint.set({ downloadsCompleted: counts.downloadsCompleted, bytesDownloaded: counts.bytesDownloaded });
    }
    // Bellek tavanı: biriken baytlar eşiği aşarsa ara yazma yapılır.
    if (counts.bytesDownloaded && ready.length >= (Number(input.commitBatchSize) || 200)) {
      const flushed = commitBatch(ingest, ready.splice(0, ready.length), input, counts, fail, checkpoint);
      if (flushed) input.imagemap = (flushed.overrides && flushed.overrides.imagemap) || input.imagemap;
      if (flushed && flushed.store) input.store = flushed.store;
    }
  }

  let last = null;
  if (ready.length) last = commitBatch(ingest, ready, input, counts, fail, checkpoint);

  const cancelled = isCancelled();
  const status = cancelled ? jobStore.STATUS_CANCELLED : failures.length ? jobStore.STATUS_PARTIAL : jobStore.STATUS_COMPLETED;
  if (checkpoint) checkpoint.phase(status, '');
  return {
    status,
    counts,
    failures,
    outcomes: (last && last.outcomes) || [],
    linksUpdated: counts.linksUpdated || 0,
    overrides: (last && last.overrides) || { imagemap: input.imagemap || {} },
    store: (last && last.store) || input.store,
  };
}

function commitBatch(ingest, batch, input, counts, fail, checkpoint) {
  const result = ingest.commit(batch, {
    store: input.store,
    imagemap: input.imagemap || {},
    overwriteManual: input.overwriteManual === true,
    dropOldFiles: input.dropOldFiles === true,
  });
  counts.linksUpdated = (counts.linksUpdated || 0) + (result.linksUpdated || 0);
  counts.manualPreserved += (result.counts.manualPreserved || 0);
  for (const outcome of result.outcomes) {
    if (outcome.status === ingestLib.COMMIT_FAILED) fail({ ...outcome, error: outcome.error, code: outcome.code });
    else if (checkpoint) checkpoint.complete(outcome);
  }
  input.store = result.store;
  if (result.overrides && result.overrides.imagemap) input.imagemap = result.overrides.imagemap;
  return result;
}

module.exports = {
  AUTH_CODES,
  syncError,
  isAuthFailure,
  isCancellation,
  resolveStyleRows,
  fetchStyleImageMetadata,
  runPlmImageSync,
  runPackageImport,
};
