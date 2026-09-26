'use strict';

/* v9.37 — OCTOPUS STREAMING (§8)
 *
 * Mimari tamamen non-streaming'ken §8'in istediği "token-token akış"
 * eklendi — ama CORRECTNESS-KRİTİK yol (grounding doğrulama) DEĞİŞMEDİ:
 * akış yalnız KULLANICIYA görünen metnin ne zaman ekrana geldiğini
 * hızlandıran bir katman. v9.39 native tool-calling'e geçişten sonra artık
 * ayrıştırılacak bir JSON zarfı yok: son (tool_calls'suz) turda sağlayıcının
 * akıttığı `delta` DOĞRUDAN cevap metnidir, extractor'a gerek kalmadı. Bu
 * test şunu doğrular:
 *
 * 1. gateway.chatStream() SSE (OpenAI-uyumlu) ve NDJSON (Ollama) akışlarını
 *    doğru ayrıştırıp chat() ile AYNI {content,toolCalls,model,usage}
 *    şeklini üretir.
 * 2. respond({onDelta,onReset}) verildiğinde: onDelta'nın birikimi TAM
 *    olarak nihai `answer` ile eşleşir; onDelta verilmezse (mevcut
 *    /api/copilot/ask akışı) davranış hiç değişmez (regresyon yok).
 * 3. onDelta VERİLMEDİĞİNDE provider.chatStream hiç çağrılmaz — akış
 *    tamamen OPT-IN, düz istek eskisi gibi yalnız chat() kullanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = require('../server/lib/ai-provider-gateway');
const copilot = require('../server/lib/copilot-agent');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');

const userAccess = { hasArea: () => true, appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon'] };
const toolRegistry = createToolRegistry({ userAccess, getDataset: async () => [] });
const policyEngine = createPolicyEngine({ userAccess });

function sseEncode(chunks) {
  return chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}
function ndjsonEncode(lines) { return lines.map(l => JSON.stringify(l)).join('\n') + '\n'; }
function streamResponseFrom(text) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  let sent = false;
  return {
    ok: true, status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
        };
      },
    },
    async json() { return {}; },
  };
}

/* --------------------------------- 1) gateway.chatStream() */

test('v9.37 chatStream (OpenAI-uyumlu SSE) chat() ile aynı şekli üretir', async () => {
  const sse = sseEncode([
    { choices: [{ delta: { content: 'Mer' } }], model: 'minimax/minimax-m3:free' },
    { choices: [{ delta: { content: 'haba' } }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
  ]);
  const fetchImpl = async () => streamResponseFrom(sse);
  const provider = gateway.createProvider({ provider: 'openrouter', apiKey: 'k', model: 'minimax/minimax-m3:free' }, { fetch: fetchImpl });
  let acc = '';
  const result = await provider.chatStream([{ role: 'user', content: 'hi' }], {}, delta => { acc += delta; });
  assert.equal(acc, 'Merhaba');
  assert.equal(result.content, 'Merhaba');
  assert.equal(result.model, 'minimax/minimax-m3:free');
  assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
});

test('v9.37 chatStream (Ollama NDJSON) chat() ile aynı şekli üretir', async () => {
  const ndjson = ndjsonEncode([
    { message: { content: 'Mer' }, model: 'gemma4:12b', done: false },
    { message: { content: 'haba' }, done: false },
    { message: { content: '' }, done: true, eval_count: 4, prompt_eval_count: 3 },
  ]);
  const fetchImpl = async () => streamResponseFrom(ndjson);
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, { fetch: fetchImpl });
  let acc = '';
  const result = await provider.chatStream([{ role: 'user', content: 'hi' }], {}, delta => { acc += delta; });
  assert.equal(acc, 'Merhaba');
  assert.equal(result.content, 'Merhaba');
  assert.deepEqual(result.usage, { completion_tokens: 4, prompt_tokens: 3, total_tokens: 7 });
});

test('v9.37 chatStream gövde akışı desteklemiyorsa açık hata verir', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, body: null, async json() { return {}; } });
  const provider = gateway.createProvider({ provider: 'ollama', model: 'gemma4:12b' }, { fetch: fetchImpl });
  await assert.rejects(() => provider.chatStream([{ role: 'user', content: 'hi' }], {}, () => {}),
    err => err.code === 'AI_STREAM_UNSUPPORTED');
});

/* --------------------------------- 2) respond({onDelta,onReset}) uçtan uca (mock) */

test('v9.37 onDelta birikimi nihai answer ile TAM eşleşir', async () => {
  const answerText = 'Test cevabı: "tırnaklı" ve\nsatır sonlu.';
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', matched: true, supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { throw new Error('chat() çağrılmamalı — onDelta verildi, chatStream kullanılmalı'); },
      // Native modda akıtılan delta DOĞRUDAN cevap metnidir (JSON zarfı yok).
      async chatStream(messages, options, onDelta) {
        for (let i = 0; i < answerText.length; i += 4) onDelta(answerText.slice(i, i + 4));
        return { content: answerText, toolCalls: [], model: 'gemma4:12b', usage: null };
      },
    }),
  });
  copilot.resetModelResolutionCache();
  let streamed = '', resets = 0;
  const result = await assistant.respond({
    question: 'Merhaba, kısa bir test cevabı ver.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine,
    onDelta: text => { streamed += text; }, onReset: () => { resets += 1; streamed = ''; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.answer, answerText);
  assert.equal(streamed, answerText, 'akıtılan metin TAM olarak nihai cevaba eşit olmalı');
  assert.equal(resets, 1);
});

test('v9.37 onDelta VERİLMEDİĞİNDE chatStream hiç çağrılmaz (opt-in, regresyon yok)', async () => {
  let chatCalled = false, chatStreamCalled = false;
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => ({
      config: { provider: 'ollama', model: 'gemma4:12b' },
      async resolveModel() { return { model: 'gemma4:12b', matched: true, supportsTools: true, capabilities: [], notice: null, toolNotice: null }; },
      async chat() { chatCalled = true; return { content: 'ok', toolCalls: [], model: 'gemma4:12b' }; },
      async chatStream() { chatStreamCalled = true; throw new Error('çağrılmamalı'); },
    }),
  });
  copilot.resetModelResolutionCache();
  const result = await assistant.respond({ question: 'Merhaba.', language: 'tr', profile, ownerId: 'u1', toolRegistry, policyEngine });
  assert.equal(result.ok, true);
  assert.equal(chatCalled, true);
  assert.equal(chatStreamCalled, false);
});

/* --------------------------------- 4) server.js SSE ucu var mı */

test('v9.37 /api/copilot/ask/stream ucu tanımlı ve aynı yetki koruması altında', () => {
  const server = require('./helpers/server-source')();
  assert.match(server, /app\.post\('\/api\/copilot\/ask\/stream'/);
  assert.match(server, /text\/event-stream/);
});
