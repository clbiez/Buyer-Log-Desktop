'use strict';

/*
 * LCW AI HTTP istemcisi — AI istekleri DOĞRUDAN API'ye gider (tarayıcı/DOM
 * yok). Yalnız iki izinli uç nokta vardır; yönlendirme izlenmez (token başka
 * bir hosta taşınamaz).
 *
 * 401 → token geçersiz sayılır, tarayıcı oturumundan sessizce yenisi okunur
 *       ve istek BİR KEZ tekrarlanır. İkinci 401 → "oturum yenilenmeli".
 * Log'a yalnız olay adı, HTTP durumu, kod ve süre yazılır; Authorization
 * başlığı, token, prompt veya cevap metni asla yazılmaz.
 */
const config = require('./lcwai-config');
const { lcwAiError, isLcwAiError, errorForHttpStatus, errorForTransport } = require('./lcwai-errors');
const { readSseResponse } = require('./lcwai-sse');
const files = require('./lcwai-files');

const ALLOWED_URLS = new Set(Object.values(config.ENDPOINTS));

function assertAllowedUrl(value) {
  const url = String(value || '');
  if (!ALLOWED_URLS.has(url)) throw lcwAiError('BAD_REQUEST', { detail: 'endpoint-not-allowed' });
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== config.API_HOST) throw lcwAiError('BAD_REQUEST', { detail: 'host-not-allowed' });
  return url;
}

/* Dış iptal + toplam süre + sessizlik süresi tek AbortController'da
   birleşir; `reason()` iptalin nedenini söyler. */
function createDeadline({ signal, totalMs, idleMs, firstChunkMs }) {
  const controller = new AbortController();
  let reason = '';
  const abort = why => { if (!reason) { reason = why; try { controller.abort(); } catch (_) {} } };
  const onExternal = () => abort('cancelled');
  if (signal) { if (signal.aborted) abort('cancelled'); else signal.addEventListener('abort', onExternal, { once: true }); }
  const total = totalMs ? setTimeout(() => abort('timeout'), totalMs) : null;
  let idle = firstChunkMs ? setTimeout(() => abort('timeout'), firstChunkMs) : null;
  return {
    signal: controller.signal,
    reason: () => reason,
    activity() {
      if (!idleMs) return;
      clearTimeout(idle);
      idle = setTimeout(() => abort('idle'), idleMs);
    },
    dispose() { clearTimeout(total); clearTimeout(idle); if (signal) signal.removeEventListener('abort', onExternal); },
  };
}

/* İptal/zaman aşımı nedeni biliniyorsa hata ona göre adlandırılır; aksi
   hâlde katmanın kendi hatası korunur. */
function failureFor(error, reason) {
  if (reason === 'cancelled') return lcwAiError('CANCELLED');
  if (reason === 'timeout') return lcwAiError('TIMEOUT');
  if (reason === 'idle') return lcwAiError('STREAM_INTERRUPTED');
  return isLcwAiError(error) ? error : errorForTransport(error);
}

function createLcwAiClient(options = {}) {
  const auth = options.auth;
  if (!auth || typeof auth.getAuthorization !== 'function') throw new TypeError('LCW AI auth is required.');
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : (...args) => fetch(...args);
  const log = typeof options.logger === 'function' ? options.logger : () => {};
  const timeouts = { ...config.TIMEOUTS, ...(options.timeouts || {}) };

  function safeLog(event, details = {}) {
    // Yalnız sayısal/kod alanları: metin, başlık, token geçmez.
    const out = { event };
    for (const key of ['status', 'code', 'ms', 'attempt', 'chunks', 'bytes']) if (details[key] != null) out[key] = details[key];
    try { log(out); } catch (_) {}
  }

  async function send(ownerId, url, buildInit, { signal, upload = false } = {}) {
    const endpoint = assertAllowedUrl(url);
    let authorization = await auth.getAuthorization(ownerId);
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal && signal.aborted) throw lcwAiError('CANCELLED');
      const init = buildInit();
      const started = Date.now();
      let response;
      try {
        response = await fetchImpl(endpoint, {
          ...init,
          method: 'POST',
          redirect: 'manual',
          cache: 'no-store',
          signal,
          headers: { ...init.headers, Authorization: authorization, Origin: config.WEB_ORIGIN, Referer: `${config.WEB_ORIGIN}/` },
        });
      } catch (error) {
        throw errorForTransport(error, { reason: signal && signal.aborted ? 'cancelled' : '' });
      }
      safeLog(upload ? 'LCWAI_UPLOAD_HTTP' : 'LCWAI_MESSAGE_HTTP', { status: response.status, ms: Date.now() - started, attempt });
      if (response.status === 401 && attempt === 1) {
        try { await response.body?.cancel?.(); } catch (_) {}
        const rejected = auth.invalidate(ownerId, authorization);
        authorization = await auth.getAuthorization(ownerId, { forceRefresh: true, rejectedFingerprint: rejected });
        continue;
      }
      if (response.status === 401) { auth.invalidate(ownerId, authorization); throw lcwAiError('SESSION_EXPIRED', { remoteStatus: 401 }); }
      if (response.status >= 300 && response.status < 400) throw lcwAiError('UNAVAILABLE', { remoteStatus: response.status, detail: 'redirect-blocked' });
      if (!response.ok) {
        let body = '';
        try { body = (await response.text()).slice(0, 400); } catch (_) {}
        throw errorForHttpStatus(response.status, { body, upload, retryAfter: response.headers?.get?.('retry-after') });
      }
      return response;
    }
    throw lcwAiError('SESSION_EXPIRED');
  }

  function messagePayload(input = {}) {
    const content = String(input.content == null ? '' : input.content);
    if (!content.trim()) throw lcwAiError('BAD_REQUEST', { detail: 'empty-content' });
    if (content.length > config.LIMITS.maxPromptChars) throw lcwAiError('BAD_REQUEST', { detail: 'prompt-too-long' });
    const attachments = files.normalizeAttachments(input.attachments);
    const model = config.modelInfo(config.resolveModelKey(input.modelKey));
    return {
      chatId: input.chatId ? String(input.chatId) : null,
      content,
      modelKey: model.key,
      generateTitle: input.generateTitle == null ? config.DEFAULTS.generateTitle : Boolean(input.generateTitle),
      reasoningEnabled: input.reasoningEnabled == null ? config.DEFAULTS.reasoningEnabled : Boolean(input.reasoningEnabled),
      reasoningLevel: config.resolveReasoningLevel(input.reasoningLevel),
      webSearchEnabled: false,
      visionEnabled: attachments.some(item => /^image\//.test(item.contentType)) && Boolean(model.vision),
      imageGenerationEnabled: false,
      attachments,
    };
  }

  /* Tek mesaj; SSE akışı okunur. onDelta her içerik parçasında çağrılır
     (canlı gösterim için); dönüş tamamlanmış cevaptır. */
  async function sendMessage(ownerId, input = {}) {
    const payload = messagePayload(input);
    const deadline = createDeadline({ signal: input.signal, totalMs: timeouts.totalMs, idleMs: timeouts.idleMs, firstChunkMs: timeouts.firstChunkMs });
    const started = Date.now();
    try {
      const response = await send(ownerId, config.ENDPOINTS.messages, () => ({
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
      }), { signal: deadline.signal });
      const result = await readSseResponse(response.body, {
        maxChars: config.LIMITS.maxResponseChars,
        onActivity: () => deadline.activity(),
        onDelta: (delta, state) => { if (typeof input.onDelta === 'function') { try { input.onDelta(delta, { chars: state.text.length }); } catch (_) {} } },
      });
      safeLog('LCWAI_MESSAGE_DONE', { ms: Date.now() - started, chunks: result.chunks });
      return { ...result, modelKey: (result.metadata && result.metadata.modelKey) || payload.modelKey };
    } catch (error) {
      const failure = failureFor(error, deadline.reason());
      safeLog('LCWAI_MESSAGE_FAILED', { code: failure.code, ms: Date.now() - started });
      throw failure;
    } finally { deadline.dispose(); }
  }

  async function uploadFile(ownerId, file, { signal } = {}) {
    const valid = files.validateUpload(file);
    const deadline = createDeadline({ signal, totalMs: timeouts.uploadMs });
    try {
      const response = await send(ownerId, config.ENDPOINTS.upload, () => {
        const { form } = files.buildUploadForm(valid);
        return { headers: { Accept: 'application/json' }, body: form };
      }, { signal: deadline.signal, upload: true });
      let json;
      try { json = await response.json(); } catch (_) { throw lcwAiError('UPLOAD_FAILED', { detail: 'upload-json' }); }
      safeLog('LCWAI_UPLOAD_DONE', { bytes: valid.size });
      return files.toAttachment(json, valid);
    } catch (error) {
      const failure = failureFor(error, deadline.reason());
      if (failure.shortCode === 'NETWORK') throw lcwAiError('UPLOAD_FAILED', { detail: 'network' });
      throw failure;
    } finally { deadline.dispose(); }
  }

  return { sendMessage, uploadFile, messagePayload };
}

module.exports = { createLcwAiClient, assertAllowedUrl, createDeadline, failureFor, ALLOWED_URLS };
