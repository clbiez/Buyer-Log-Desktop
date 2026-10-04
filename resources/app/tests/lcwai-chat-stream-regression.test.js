'use strict';
/* Regresyon (canlı, v7.0.235): genel LCW AI sohbeti "LCW AI düşünüyor…" da
   kalıyordu — akış tamamlanıyor ama metin boş dönüyor, hata da gösterilmiyordu.
   Başlık üretimi (generateTitle) açıkken akışa başlık parçaları / erken
   [DONE] karışabiliyor ya da içerik farklı bir chunkType ile geliyor. Okuyucu
   bunları tolere etmeli; içeriksiz akış ASLA sessiz başarı sayılmamalı. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSseResponse } = require('../server/lib/lcwai/lcwai-sse');

const body = parts => new ReadableStream({ start(c) { const e = new TextEncoder(); for (const p of parts) c.enqueue(e.encode(p)); c.close(); } });
const ev = obj => `data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`;

test('başlık parçaları ve erken [DONE] içeriği yutmaz', async () => {
  const result = await readSseResponse(body([
    ev({ chunkType: 'title', content: 'Dikkat edilecek siparişler', isComplete: false }),
    ev({ chunkType: 'title', isComplete: true }),
    ev('[DONE]'),
    ev({ chunkType: 'content', content: 'Merhaba', isComplete: false }),
    ev({ chunkType: 'complete', isComplete: true, finishReason: 'stop', metadata: { chatId: 'c1', modelKey: 'gpt-6-sol' } }),
    ev('[DONE]'),
  ]));
  assert.equal(result.text, 'Merhaba');
  assert.equal(result.metadata.chatId, 'c1');
});

test('içerik farklı chunkType / alan adıyla gelirse de toplanır; düşünme ve başlık metne karışmaz', async () => {
  const result = await readSseResponse(body([
    ev({ chunkType: 'reasoning', content: 'düşünüyorum' }),
    ev({ chunkType: 'text', content: 'Bir ' }),
    ev({ chunkType: 'delta', delta: 'iki ' }),
    ev({ chunkType: 'message', text: 'üç' }),
    ev({ chunkType: 'title', content: 'Başlık' }),
    ev({ isComplete: true, chunkType: 'complete', metadata: { chatId: 'c2' } }),
    ev('[DONE]'),
  ]));
  assert.equal(result.text, 'Bir iki üç');
});

test('içeriksiz tamamlanan akış sessiz başarı değildir: anlaşılır hata', async () => {
  await assert.rejects(readSseResponse(body([
    ev({ chunkType: 'title', content: 'Başlık' }),
    ev({ isComplete: true, chunkType: 'complete', metadata: { chatId: 'c3' } }),
    ev('[DONE]'),
  ])), error => error.code === 'LCWAI_INVALID_RESPONSE' && /types=title:1,complete:1/.test(error.detail));
});

test('genel sohbet başlık üretimini kapalı gönderir (kanıtlanmış yol); boş cevap istemcide hata olur', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'lcwai', 'lcwai-engine.js'), 'utf8');
  assert.match(engine, /generateTitle: false,/);
  const chat = fs.readFileSync(path.join(__dirname, '..', 'public', 'lcwai-chat.js'), 'utf8');
  assert.match(chat, /if \(!String\(result\.text \|\| ''\)\.trim\(\)\)/);
  assert.match(chat, /last && last\.role === 'ai' && \(last\.error \|\| !last\.text\)/, 'yeniden dene boş/hatalı cevabı kaldırır, yığmaz');
});
