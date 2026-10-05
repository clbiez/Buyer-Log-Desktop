'use strict';

/*
 * LCWAIEngine — Buyer Log'un TEK AI motoru.
 *
 *   ask()          bağlam + istek → LCW AI → (sözleşmeli) öneri
 *   askWithFiles() dosyaları yükler, aynı ask() yoluna ekler olarak verir
 *   cancel()       süren isteği iptal eder
 *   getStatus()    oturum/model durumu (token içermez)
 *
 * Modül bağımsızdır: Hesaplanan Sütun, Kurallar ve Otomasyon bugün; Order,
 * Development, Backlog, Dashboard, Mail, doküman analizi yarın aynı yoldan
 * geçer. Motor hiçbir şeyi KAYDETMEZ; öneriyi döndürür, uygulamak her zaman
 * modülün önizleme + kullanıcı onayı adımıdır.
 */
const crypto = require('crypto');
const config = require('./lcwai-config');
const { lcwAiError, isLcwAiError } = require('./lcwai-errors');
const prompts = require('./lcwai-prompt');

function clean(value) { return String(value == null ? '' : value).trim(); }
function safeRequestId(value) {
  const id = clean(value).replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 64);
  return id || crypto.randomBytes(8).toString('hex');
}

function createLcwAiEngine(options = {}) {
  const auth = options.auth;
  const client = options.client;
  if (!auth || !client) throw new TypeError('LCW AI engine requires auth and client.');
  const active = new Map(); // owner -> Map(requestId -> AbortController)

  function ownerRequests(ownerId) {
    const key = clean(ownerId) || 'default';
    if (!active.has(key)) active.set(key, new Map());
    return active.get(key);
  }
  function emit(onProgress, event) { if (typeof onProgress === 'function') { try { onProgress(event); } catch (_) {} } }

  async function run(ownerId, input, work) {
    const requests = ownerRequests(ownerId);
    if (requests.size >= config.LIMITS.maxConcurrentPerOwner) throw lcwAiError('BUSY');
    const requestId = safeRequestId(input.requestId);
    if (requests.has(requestId)) throw lcwAiError('BUSY');
    const controller = new AbortController();
    const external = input.signal;
    const onExternal = () => controller.abort();
    if (external) { if (external.aborted) controller.abort(); else external.addEventListener('abort', onExternal, { once: true }); }
    requests.set(requestId, controller);
    try { return await work(requestId, controller.signal); }
    finally {
      requests.delete(requestId);
      if (external) external.removeEventListener('abort', onExternal);
    }
  }

  async function askInternal(ownerId, input, requestId, signal, attachments) {
    const task = clean(input.task);
    if (!task) throw lcwAiError('BAD_REQUEST', { detail: 'empty-task' });
    if (task.length > config.LIMITS.maxTaskChars) throw lcwAiError('BAD_REQUEST', { detail: 'task-too-long' });
    const built = prompts.buildPrompt({ source: input.source, task, context: input.context, guide: input.guide, lang: input.lang });
    emit(input.onProgress, { phase: 'sending', requestId });
    let chars = 0;
    const result = await client.sendMessage(ownerId, {
      content: built.prompt,
      attachments,
      modelKey: input.modelKey,
      reasoningLevel: input.reasoningLevel,
      signal,
      onDelta: delta => { chars += delta.length; emit(input.onProgress, { phase: 'streaming', requestId, delta, chars }); },
    });
    const structured = prompts.parseStructured(result.text, built.source);
    const model = config.modelInfo(result.modelKey) || config.modelInfo(config.DEFAULT_MODEL);
    return {
      requestId,
      source: built.source,
      text: result.text,
      data: built.contract && structured.ok ? structured.data : null,
      structured: { expected: Boolean(built.contract), ok: built.contract ? structured.ok : true, errors: structured.errors.slice(0, 10), partial: built.contract && !structured.ok ? structured.data : null },
      model: { key: model.key, label: model.label },
      finishReason: result.finishReason,
      truncated: Boolean(result.truncated || built.truncated),
    };
  }

  function ask(ownerId, input = {}) {
    return run(ownerId, input, (requestId, signal) => askInternal(ownerId, input, requestId, signal, input.attachments));
  }

  /* Dosyalar önce LCW AI'a yüklenir, sonra mesaja ek olarak verilir. Bir
     dosya yüklenemezse istek hiç gönderilmez (yarım bağlamla cevap üretmek
     kullanıcıyı yanıltır). */
  function askWithFiles(ownerId, input = {}) {
    const list = Array.isArray(input.files) ? input.files : [];
    if (list.length > config.LIMITS.maxFilesPerRequest) return Promise.reject(lcwAiError('BAD_REQUEST', { detail: 'too-many-files' }));
    return run(ownerId, input, async (requestId, signal) => {
      const attachments = Array.isArray(input.attachments) ? input.attachments.slice() : [];
      for (let index = 0; index < list.length; index++) {
        emit(input.onProgress, { phase: 'uploading', requestId, index, total: list.length });
        attachments.push(await client.uploadFile(ownerId, list[index], { signal }));
      }
      return askInternal(ownerId, input, requestId, signal, attachments);
    });
  }

  /* Genel sohbet (Global LCW AI). LCW AI sohbet geçmişini chatId ile
     kendisi tutar; burada yalnız "bu sohbete hangi modül bilgisi zaten
     gönderildi" bilgisi bellekte tutulur ki devam mesajlarında tekrar
     gönderilmesin (token). Sohbet içeriği saklanmaz. */
  const conversations = new Map(); // owner -> Map(chatId -> { sentModules:Set, updatedAt })
  const MAX_CONVERSATIONS = 50;
  function conversationStore(ownerId) {
    const key = clean(ownerId) || 'default';
    if (!conversations.has(key)) conversations.set(key, new Map());
    return conversations.get(key);
  }
  function chat(ownerId, input = {}) {
    return run(ownerId, input, async (requestId, signal) => {
      const message = clean(input.message);
      const attachments = Array.isArray(input.attachments) ? input.attachments : [];
      if (!message && !attachments.length) throw lcwAiError('BAD_REQUEST', { detail: 'empty-message' });
      const chatId = clean(input.chatId) || null;
      const store = conversationStore(ownerId);
      const known = chatId ? store.get(chatId) : null;
      const built = prompts.buildChatPrompt({
        message: message || (input.lang === 'en' ? 'Analyse the attached file(s).' : 'Ekli dosyaları incele.'),
        contexts: input.contexts,
        lang: input.lang,
        firstMessage: !chatId,
        sentModules: known ? [...known.sentModules] : [],
        outputInstruction: input.outputInstruction,
      });
      emit(input.onProgress, { phase: 'sending', requestId, modules: built.modules });
      let chars = 0;
      const result = await client.sendMessage(ownerId, {
        content: built.prompt,
        chatId,
        attachments,
        /* Başlık üretimi kapalı: generateTitle=true akışa başlık parçaları ve
           erken [DONE] karıştırıp canlıda sohbeti boş bırakıyordu. Bağlama özel
           çağrıların kanıtlanmış yolu (false) kullanılır; LCW AI geçmişinde
           sohbet yine oluşur. */
        generateTitle: false,
        modelKey: input.modelKey,
        reasoningLevel: input.reasoningLevel,
        signal,
        onDelta: delta => { chars += delta.length; emit(input.onProgress, { phase: 'streaming', requestId, delta, chars }); },
      });
      const nextChatId = (result.metadata && result.metadata.chatId) || chatId;
      if (nextChatId) {
        const entry = store.get(nextChatId) || { sentModules: new Set(), updatedAt: 0 };
        built.modules.forEach(key => entry.sentModules.add(key));
        entry.updatedAt = Date.now();
        store.set(nextChatId, entry);
        if (store.size > MAX_CONVERSATIONS) {
          const oldest = [...store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
          if (oldest) store.delete(oldest[0]);
        }
      }
      const model = config.modelInfo(result.modelKey) || config.modelInfo(config.DEFAULT_MODEL);
      return {
        requestId,
        chatId: nextChatId,
        text: result.text,
        model: { key: model.key, label: model.label },
        finishReason: result.finishReason,
        modules: built.modules,
        truncated: Boolean(result.truncated || built.truncated),
      };
    });
  }

  function uploadFile(ownerId, file, opts = {}) { return client.uploadFile(ownerId, file, opts); }

  function cancel(ownerId, requestId) {
    const requests = ownerRequests(ownerId);
    if (requestId) {
      const controller = requests.get(safeRequestId(requestId));
      if (!controller) return false;
      controller.abort();
      return true;
    }
    for (const controller of requests.values()) controller.abort();
    return requests.size > 0;
  }

  async function getStatus(ownerId, { refresh = true } = {}) {
    const session = refresh && typeof auth.refreshStatus === 'function' ? await auth.refreshStatus(ownerId) : auth.status(ownerId);
    return { ...session, activeRequests: ownerRequests(ownerId).size, config: config.publicConfig() };
  }

  return {
    ask, askWithFiles, chat, uploadFile, cancel, getStatus,
    login: ownerId => auth.login(ownerId),
    disconnect: ownerId => { cancel(ownerId); return auth.disconnect(ownerId); },
    isLcwAiError,
  };
}

module.exports = { createLcwAiEngine, safeRequestId };
