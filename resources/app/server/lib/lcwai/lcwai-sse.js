'use strict';

/*
 * LCW AI SSE (text/event-stream) okuyucusu — saf ve test edilebilir.
 *
 * Akış biçimi (doğrulandı):
 *   data: {"content":"…","isComplete":false,"chunkType":"content"}
 *   data: {"isComplete":true,"finishReason":"stop","chunkType":"complete","metadata":{…}}
 *   data: [DONE]
 *
 * Parser SSE standardına uyar: satırlar \n, \r\n ya da \r ile biter; bir olay
 * boş satırla kapanır; birden çok `data:` satırı \n ile birleştirilir; `:` ile
 * başlayan satırlar yorumdur. Ağ paketleri olayların ortasından bölünebilir,
 * bu yüzden tampon yalnız tamamlanmış olayları dışarı verir.
 */
const { lcwAiError } = require('./lcwai-errors');

function createSseParser(onEvent) {
  let buffer = '';
  let dataLines = [];
  let eventName = '';
  let pendingCr = false;
  const dispatch = () => {
    if (!dataLines.length) { eventName = ''; return; }
    const data = dataLines.join('\n');
    dataLines = [];
    const name = eventName || 'message';
    eventName = '';
    onEvent({ event: name, data });
  };
  const handleLine = line => {
    if (line === '') { dispatch(); return; }
    if (line[0] === ':') return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value[0] === ' ') value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
  };
  return {
    feed(text) {
      let chunk = String(text == null ? '' : text);
      if (pendingCr && chunk[0] === '\n') chunk = chunk.slice(1);
      pendingCr = false;
      buffer += chunk;
      let index;
      while ((index = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, index);
        const sep = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
        // \r tamponun sonundaysa \n bir sonraki pakette gelebilir.
        if (buffer[index] === '\r' && index === buffer.length - 1) pendingCr = true;
        buffer = buffer.slice(index + sep);
        handleLine(line);
      }
    },
    end() {
      if (buffer) { handleLine(buffer); buffer = ''; }
      dispatch();
    },
  };
}

/* Olayları tek bir cevaba indirger. Yalnız `content` parçaları cevaba girer;
   düşünme/reasoning parçaları sayılır ama metne karışmaz. */
function createChunkAccumulator({ maxChars = 200000 } = {}) {
  const state = { text: '', chunks: 0, reasoningChunks: 0, complete: false, done: false, finishReason: '', metadata: null, truncated: false };
  function apply(event) {
    const raw = String(event && event.data != null ? event.data : '').trim();
    if (!raw) return { kind: 'empty' };
    if (raw === '[DONE]') { state.done = true; return { kind: 'done' }; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch (_) { throw lcwAiError('INVALID_RESPONSE', { detail: 'sse-json' }); }
    if (!payload || typeof payload !== 'object') return { kind: 'empty' };
    const type = String(payload.chunkType || '').toLowerCase();
    if (type === 'error' || payload.error) {
      throw lcwAiError('UNAVAILABLE', { detail: typeof payload.error === 'string' ? payload.error : 'stream-error' });
    }
    let delta = '';
    if ((type === 'content' || (!type && typeof payload.content === 'string')) && typeof payload.content === 'string') {
      delta = payload.content;
      const room = Math.max(0, maxChars - state.text.length);
      if (delta.length > room) { delta = delta.slice(0, room); state.truncated = true; }
      state.text += delta;
      state.chunks += 1;
    } else if (/reason|think/.test(type)) {
      state.reasoningChunks += 1;
    }
    if (payload.isComplete === true || type === 'complete') {
      state.complete = true;
      state.finishReason = String(payload.finishReason || state.finishReason || '');
      if (payload.metadata && typeof payload.metadata === 'object') {
        state.metadata = {
          chatId: payload.metadata.chatId == null ? null : String(payload.metadata.chatId),
          modelKey: payload.metadata.modelKey == null ? '' : String(payload.metadata.modelKey),
        };
      }
      return { kind: 'complete', delta };
    }
    return { kind: delta ? 'content' : (type || 'other'), delta };
  }
  return { apply, state };
}

async function* iterateStream(body) {
  if (!body) return;
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally { try { reader.releaseLock(); } catch (_) {} }
  }
  if (typeof body[Symbol.asyncIterator] === 'function') { for await (const value of body) yield value; return; }
  if (typeof body === 'string' || body instanceof Uint8Array) yield body;
}

/* Gövdeyi okur, her içerik parçasında onDelta çağırır ve tamamlanmış cevabı
   döndürür. [DONE] ya da `complete` gelmeden akış biterse cevap YARIM sayılır
   (STREAM_INTERRUPTED) — yarım bir JSON'u "öneri" diye göstermek, var olan
   ayarı bozmaya giden yoldur. */
async function readSseResponse(body, { onDelta, maxChars, onActivity } = {}) {
  const decoder = new TextDecoder('utf-8');
  const accumulator = createChunkAccumulator({ maxChars });
  let failure = null;
  const parser = createSseParser(event => {
    if (failure) return;
    try {
      const result = accumulator.apply(event);
      if (result.delta && typeof onDelta === 'function') onDelta(result.delta, accumulator.state);
    } catch (error) { failure = error; }
  });
  for await (const part of iterateStream(body)) {
    if (typeof onActivity === 'function') onActivity();
    parser.feed(typeof part === 'string' ? part : decoder.decode(part, { stream: true }));
    if (failure) throw failure;
    if (accumulator.state.done) break;
  }
  parser.feed(decoder.decode());
  parser.end();
  if (failure) throw failure;
  const state = accumulator.state;
  if (!state.complete && !state.done) throw lcwAiError('STREAM_INTERRUPTED');
  if (!state.complete && state.done && !state.text) throw lcwAiError('INVALID_RESPONSE', { detail: 'empty-stream' });
  return {
    text: state.text,
    finishReason: state.finishReason || (state.done ? 'stop' : ''),
    metadata: state.metadata,
    chunks: state.chunks,
    truncated: state.truncated,
  };
}

module.exports = { createSseParser, createChunkAccumulator, readSseResponse, iterateStream };
