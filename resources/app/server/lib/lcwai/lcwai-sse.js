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
/* Olayları tek bir cevaba indirger.
   - İçerik: chunkType "content" (doğrulanan biçim) ve içerik taşıyan diğer
     türler (text/delta/message…); alan adı content | delta | text | message.
   - Cevaba KARIŞMAYANLAR: düşünme/reasoning, başlık (generateTitle), durum,
     kullanım/metadata parçaları.
   - Tamamlanma yalnız İÇERİK akışının complete'i ile sayılır; başlık
     parçasının isComplete'i cevabı bitirmez (canlıda sohbet boş kalıyordu).
   - types: tür → adet özeti (teşhis; metin içermez). */
const NON_ANSWER_TYPES = /reason|think|title|status|usage|meta|tool|progress|heartbeat|ping/;
function chunkText(payload) {
  for (const key of ['content', 'delta', 'text', 'message']) if (typeof payload[key] === 'string') return payload[key];
  return '';
}
function createChunkAccumulator({ maxChars = 200000 } = {}) {
  const state = { text: '', chunks: 0, reasoningChunks: 0, complete: false, done: false, finishReason: '', metadata: null, truncated: false, types: {} };
  function apply(event) {
    const raw = String(event && event.data != null ? event.data : '').trim();
    if (!raw) return { kind: 'empty' };
    if (raw === '[DONE]') { state.done = true; return { kind: 'done' }; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch (_) { throw lcwAiError('INVALID_RESPONSE', { detail: 'sse-json' }); }
    if (!payload || typeof payload !== 'object') return { kind: 'empty' };
    const type = String(payload.chunkType || '').toLowerCase();
    const typeKey = type || 'untyped';
    state.types[typeKey] = (state.types[typeKey] || 0) + 1;
    if (type === 'error' || payload.error) {
      throw lcwAiError('UNAVAILABLE', { detail: typeof payload.error === 'string' ? payload.error : 'stream-error' });
    }
    const nonAnswer = NON_ANSWER_TYPES.test(type);
    let delta = '';
    if (nonAnswer) {
      if (/reason|think/.test(type)) state.reasoningChunks += 1;
    } else if (type !== 'complete') {
      delta = chunkText(payload);
      if (delta) {
        const room = Math.max(0, maxChars - state.text.length);
        if (delta.length > room) { delta = delta.slice(0, room); state.truncated = true; }
        state.text += delta;
        state.chunks += 1;
      }
    }
    if (!nonAnswer && (payload.isComplete === true || type === 'complete')) {
      state.complete = true;
      state.finishReason = String(payload.finishReason || state.finishReason || '');
    }
    // chatId hangi parçada gelirse gelsin alınır (başlık parçası dahil).
    if (payload.metadata && typeof payload.metadata === 'object') {
      const meta = payload.metadata;
      state.metadata = {
        chatId: meta.chatId == null ? (state.metadata && state.metadata.chatId) || null : String(meta.chatId),
        modelKey: meta.modelKey == null ? (state.metadata && state.metadata.modelKey) || '' : String(meta.modelKey),
      };
    }
    if (state.complete && !nonAnswer && (payload.isComplete === true || type === 'complete')) return { kind: 'complete', delta };
    return { kind: delta ? 'content' : (type || 'other'), delta };
  }
  return { apply, state };
}
const typeSummary = types => Object.entries(types || {}).map(([key, count]) => `${key}:${count}`).join(',');

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
    // [DONE] yalnız içerik geldiyse ya da içerik akışı tamamlandıysa okumayı
    // bitirir; başlık akışının erken [DONE]'ı cevabı kesmez.
    if (accumulator.state.done && (accumulator.state.text || accumulator.state.complete)) break;
    accumulator.state.done = false;
  }
  parser.feed(decoder.decode());
  parser.end();
  if (failure) throw failure;
  const state = accumulator.state;
  if (!state.text) {
    // İçeriksiz akış asla sessiz başarı sayılmaz; tür özeti teşhis içindir.
    throw lcwAiError(state.complete || Object.keys(state.types).length ? 'INVALID_RESPONSE' : 'STREAM_INTERRUPTED', { detail: `empty-answer types=${typeSummary(state.types)}` });
  }
  if (!state.complete && !state.done && !Object.keys(state.types).includes('complete')) {
    // İçerik geldi ama tamamlanma işareti yok: yarım cevap.
    throw lcwAiError('STREAM_INTERRUPTED', { detail: `types=${typeSummary(state.types)}` });
  }
  return {
    text: state.text,
    finishReason: state.finishReason || (state.done ? 'stop' : ''),
    metadata: state.metadata,
    chunks: state.chunks,
    types: typeSummary(state.types),
    truncated: state.truncated,
  };
}

module.exports = { createSseParser, createChunkAccumulator, readSseResponse, iterateStream };
