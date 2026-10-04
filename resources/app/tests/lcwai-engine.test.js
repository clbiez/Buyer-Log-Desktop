'use strict';
/* LCW AI merkezi motoru — SSE, auth/401, dosya, iptal, sözleşme ve sır
   sızıntısı testleri. Ağ ve tarayıcı tamamen sahtedir. */
const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../server/lib/lcwai/lcwai-config');
const { createSseParser, createChunkAccumulator, readSseResponse } = require('../server/lib/lcwai/lcwai-sse');
const { createLcwAiAuth, validateAccessToken } = require('../server/lib/lcwai/lcwai-auth');
const { createLcwAiClient } = require('../server/lib/lcwai/lcwai-client');
const { createLcwAiEngine } = require('../server/lib/lcwai/lcwai-engine');
const files = require('../server/lib/lcwai/lcwai-files');
const prompts = require('../server/lib/lcwai/lcwai-prompt');
const { publicError, lcwAiError } = require('../server/lib/lcwai/lcwai-errors');

function makeToken(claims = {}) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { iss: config.KEYCLOAK.issuer, azp: config.KEYCLOAK.clientId, typ: 'Bearer', exp: Math.floor(Date.now() / 1000) + 300, sub: 'user-1', ...claims };
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.${Buffer.from('signature-' + Math.random()).toString('base64url')}`;
}
function sseBody(parts) {
  const encoder = new TextEncoder();
  return new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
}
function sseResponse(parts, status = 200) { return new Response(sseBody(parts), { status, headers: { 'Content-Type': 'text/event-stream' } }); }
const chunk = obj => `data: ${JSON.stringify(obj)}\n\n`;
const COMPLETE = chunk({ isComplete: true, finishReason: 'stop', chunkType: 'complete', metadata: { chatId: 'c-1', modelKey: 'gpt-6-sol' } });

function fakeProvider(tokens) {
  const queue = tokens.slice();
  const calls = { read: 0, login: 0 };
  return {
    calls,
    async readToken(owner, { isUsable }) { calls.read++; const token = queue.shift(); if (!token || !isUsable(token)) throw lcwAiError('SESSION_EXPIRED'); return { token, source: 'test' }; },
    async login() { calls.login++; return { token: queue.shift(), source: 'test-login' }; },
  };
}

test('SSE parser: bölünmüş paketler, CRLF, çok satırlı data ve yorumlar', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.feed(': keep-alive\r\ndata: {"a"');
  parser.feed(':1}\r');
  parser.feed('\n\r\ndata: line1\ndata: line2\n\nevent: custom\ndata: x\n');
  parser.end();
  assert.deepEqual(events, [
    { event: 'message', data: '{"a":1}' },
    { event: 'message', data: 'line1\nline2' },
    { event: 'custom', data: 'x' },
  ]);
});

test('SSE: content chunk birleştirme, reasoning metne karışmaz, complete metadata', async () => {
  const result = await readSseResponse(sseBody([
    chunk({ content: 'Mer', isComplete: false, chunkType: 'content' }),
    chunk({ content: 'düşünüyor', isComplete: false, chunkType: 'reasoning' }),
    chunk({ content: 'haba', isComplete: false, chunkType: 'content' }),
    COMPLETE, 'data: [DONE]\n\n',
  ]));
  assert.equal(result.text, 'Merhaba');
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.metadata, { chatId: 'c-1', modelKey: 'gpt-6-sol' });
  assert.equal(result.chunks, 2);
});

test('SSE: [DONE] akışı bitirir; sonrası okunmaz, complete olmadan kesilen akış hatadır', async () => {
  const done = await readSseResponse(sseBody([chunk({ content: 'ok', chunkType: 'content' }), 'data: [DONE]\n\n', chunk({ content: 'SONRA', chunkType: 'content' })]));
  assert.equal(done.text, 'ok');
  await assert.rejects(readSseResponse(sseBody([chunk({ content: 'yarım', chunkType: 'content' })])), error => error.code === 'LCWAI_STREAM_INTERRUPTED');
  await assert.rejects(readSseResponse(sseBody(['data: {bozuk json\n\n'])), error => error.code === 'LCWAI_INVALID_RESPONSE');
  const acc = createChunkAccumulator({ maxChars: 3 });
  acc.apply({ data: JSON.stringify({ content: 'abcdef', chunkType: 'content' }) });
  assert.equal(acc.state.text, 'abc');
  assert.equal(acc.state.truncated, true);
});

test('token doğrulama: realm, istemci ve süre zorunlu', () => {
  assert.equal(validateAccessToken(makeToken()).ok, true);
  assert.equal(validateAccessToken(`Bearer ${makeToken()}`).ok, true);
  assert.equal(validateAccessToken(makeToken({ iss: 'https://keycloak.lcwaikiki.com/auth/realms/other' })).reason, 'issuer');
  assert.equal(validateAccessToken(makeToken({ azp: 'corenectum', aud: 'account' })).reason, 'client');
  assert.equal(validateAccessToken(makeToken({ exp: Math.floor(Date.now() / 1000) + 5 })).reason, 'expired');
  assert.equal(validateAccessToken('abc').reason, 'format');
});

test('401 → token geçersiz sayılır, tarayıcıdan YENİ token okunur ve istek bir kez tekrarlanır', async () => {
  const first = makeToken(), second = makeToken();
  const provider = fakeProvider([first, second]);
  const auth = createLcwAiAuth({ provider });
  const seen = [];
  const client = createLcwAiClient({ auth, fetch: async (url, init) => {
    seen.push(init.headers.Authorization);
    return seen.length === 1 ? new Response('', { status: 401 }) : sseResponse([chunk({ content: 'tamam', chunkType: 'content' }), COMPLETE]);
  } });
  const result = await client.sendMessage('u1', { content: 'merhaba' });
  assert.equal(result.text, 'tamam');
  assert.deepEqual(seen, [`Bearer ${first}`, `Bearer ${second}`]);
  assert.equal(provider.calls.read, 2);
  assert.equal(auth.status('u1').state, 'connected');
});

test('401 iki kez → SESSION_EXPIRED; yönlendirme izlenmez; 403/429/5xx kodlanır', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken(), makeToken()]) });
  const client = createLcwAiClient({ auth, fetch: async () => new Response('', { status: 401 }) });
  await assert.rejects(client.sendMessage('u1', { content: 'x' }), error => error.code === 'LCWAI_SESSION_EXPIRED' && error.action === 'login');
  for (const [status, code] of [[403, 'LCWAI_FORBIDDEN'], [429, 'LCWAI_RATE_LIMITED'], [503, 'LCWAI_UNAVAILABLE'], [302, 'LCWAI_UNAVAILABLE']]) {
    const auth2 = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
    const c2 = createLcwAiClient({ auth: auth2, fetch: async (url, init) => { assert.equal(init.redirect, 'manual'); return new Response('', { status, headers: status === 302 ? { Location: 'https://evil.example/' } : {} }); } });
    await assert.rejects(c2.sendMessage('u1', { content: 'x' }), error => error.code === code);
  }
  const auth3 = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  const c3 = createLcwAiClient({ auth: auth3, fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(c3.sendMessage('u1', { content: 'x' }), error => error.code === 'LCWAI_NETWORK');
});

test('oturum yoksa AUTH_REQUIRED, açılmış oturum düşerse SESSION_EXPIRED', async () => {
  const auth = createLcwAiAuth({ provider: { async readToken() { throw lcwAiError('BROWSER_UNAVAILABLE'); } } });
  await assert.rejects(auth.getAuthorization('u1'), error => error.code === 'LCWAI_BROWSER_UNAVAILABLE');
  assert.equal(auth.status('u1').state, 'disconnected');
  let now = Date.now();
  const auth2 = createLcwAiAuth({ now: () => now, provider: { async login() { return { token: makeToken({ exp: Math.floor(now / 1000) + 300 }) }; }, async readToken() { throw lcwAiError('SESSION_EXPIRED'); } } });
  await auth2.login('u1');
  assert.equal(auth2.status('u1').state, 'connected');
  now += 10 * 60 * 1000;
  assert.equal(auth2.status('u1').state, 'expired');
  await assert.rejects(auth2.getAuthorization('u1'), error => error.code === 'LCWAI_SESSION_EXPIRED');
});

test('iptal edilen istek CANCELLED döner ve motor kaydını temizler', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  const client = createLcwAiClient({ auth, fetch: (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) });
  const engine = createLcwAiEngine({ auth, client });
  const pending = engine.ask('u1', { requestId: 'r1', source: 'calculated-column', task: 'Margin % hesapla' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await engine.getStatus('u1', { refresh: false })).activeRequests, 1);
  assert.equal(engine.cancel('u1', 'r1'), true);
  await assert.rejects(pending, error => error.code === 'LCWAI_CANCELLED');
  assert.equal((await engine.getStatus('u1', { refresh: false })).activeRequests, 0);
});

test('zaman aşımı ve yarıda kesilen akış ayrı kodlanır', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken(), makeToken()]) });
  const slow = createLcwAiClient({ auth, timeouts: { firstChunkMs: 30, idleMs: 30, totalMs: 1000 }, fetch: (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) });
  await assert.rejects(slow.sendMessage('u1', { content: 'x' }), error => error.code === 'LCWAI_TIMEOUT');
  const encoder = new TextEncoder();
  const stalled = createLcwAiClient({ auth, timeouts: { firstChunkMs: 1000, idleMs: 30, totalMs: 1000 }, fetch: async (url, init) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(chunk({ content: 'ya', chunkType: 'content' }))); init.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))); },
  }), { status: 200 }) });
  await assert.rejects(stalled.sendMessage('u1', { content: 'x' }), error => error.code === 'LCWAI_STREAM_INTERRUPTED');
});

test('mesaj payload: doğrulanmış biçim, model merkezi config\'ten, başlık üretimi kapalı', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  let sent = null, headers = null, target = '';
  const client = createLcwAiClient({ auth, fetch: async (url, init) => { target = url; sent = JSON.parse(init.body); headers = init.headers; return sseResponse([chunk({ content: 'x', chunkType: 'content' }), COMPLETE]); } });
  await client.sendMessage('u1', { content: 'Merhaba', modelKey: 'olmayan-model', reasoningLevel: 'medium' });
  assert.equal(target, 'https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/messages');
  assert.deepEqual(Object.keys(sent).sort(), ['attachments', 'chatId', 'content', 'generateTitle', 'imageGenerationEnabled', 'modelKey', 'reasoningEnabled', 'reasoningLevel', 'visionEnabled', 'webSearchEnabled'].sort());
  assert.equal(sent.modelKey, config.DEFAULT_MODEL);
  assert.equal(sent.reasoningLevel, 'Medium');
  assert.equal(sent.chatId, null);
  assert.equal(sent.generateTitle, false);
  assert.equal(headers.Accept, 'text/event-stream');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('dosya yükleme: multipart file alanı, Türkçe ad korunur, ek eşlemesi yalnız izinli alanlar', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  let form = null, target = '';
  const client = createLcwAiClient({ auth, fetch: async (url, init) => {
    target = url; form = init.body;
    return Response.json({ sessionId: 's', fileId: 'f', blobName: 'conversation-files/abc', fileName: 'İşleyiş.txt', contentType: 'text/plain', size: 5, url: '/api/chat/attachments/abc', secretExtra: 'x' });
  } });
  const attachment = await client.uploadFile('u1', { buffer: Buffer.from('hello'), fileName: 'C:\\temp\\İşleyiş.txt', contentType: 'text/plain' });
  assert.equal(target, 'https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/files/upload');
  assert.ok(form instanceof FormData);
  const file = form.get('file');
  assert.equal(file.name, 'İşleyiş.txt');
  assert.equal(file.type, 'text/plain');
  assert.equal(await file.text(), 'hello');
  assert.deepEqual(attachment, { blobName: 'conversation-files/abc', contentType: 'text/plain', fileName: 'İşleyiş.txt', size: 5, url: '/api/chat/attachments/abc' });
  assert.throws(() => files.validateUpload({ buffer: Buffer.from('x'), fileName: 'a.exe', contentType: 'application/x-msdownload' }), error => error.code === 'LCWAI_FILE_TYPE_NOT_ALLOWED');
  assert.throws(() => files.validateUpload({ buffer: Buffer.alloc(config.LIMITS.maxFileBytes + 1), fileName: 'a.txt' }), error => error.code === 'LCWAI_FILE_TOO_LARGE');
  assert.throws(() => files.toAttachment({ blobName: '', url: '/x' }), error => error.code === 'LCWAI_UPLOAD_FAILED');
  assert.throws(() => files.toAttachment({ blobName: 'b', url: 'https://evil.example/x?y' }), error => error.code === 'LCWAI_UPLOAD_FAILED');
});

test('askWithFiles: yüklenen ekler mesaja eklenir; kota hatası anlaşılır kodla döner', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  let body = null;
  const client = createLcwAiClient({ auth, fetch: async (url, init) => {
    if (url.endsWith('/upload')) return Response.json({ blobName: 'conversation-files/1', fileName: 'a.txt', contentType: 'text/plain', size: 3, url: '/api/chat/attachments/1' });
    body = JSON.parse(init.body);
    return sseResponse([chunk({ content: 'özet', chunkType: 'content' }), COMPLETE]);
  } });
  const engine = createLcwAiEngine({ auth, client });
  const progress = [];
  const result = await engine.askWithFiles('u1', { source: 'document-analysis', task: 'Özetle', files: [{ buffer: Buffer.from('abc'), fileName: 'a.txt', contentType: 'text/plain' }], onProgress: event => progress.push(event.phase) });
  assert.equal(result.text, 'özet');
  assert.deepEqual(body.attachments, [{ blobName: 'conversation-files/1', contentType: 'text/plain', fileName: 'a.txt', size: 3, url: '/api/chat/attachments/1' }]);
  assert.ok(progress.includes('uploading') && progress.includes('streaming'));
  const quotaClient = createLcwAiClient({ auth, fetch: async () => new Response('Storage quota exceeded', { status: 429 }) });
  await assert.rejects(quotaClient.uploadFile('u1', { buffer: Buffer.from('a'), fileName: 'a.txt' }), error => error.code === 'LCWAI_QUOTA_EXCEEDED');
});

test('yapılandırılmış cevap: kod bloğu/çevre metin toleransı, geçersiz JSON ve şema uyumsuzluğu güvenli', () => {
  const ok = prompts.parseStructured('Tabii:\n```json\n{"explanation":"Marj","formula":"([Retail]-[Cost])/[Retail]","warnings":"dikkat","extra":1}\n```', 'calculated-column');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data, { explanation: 'Marj', formula: '([Retail]-[Cost])/[Retail]', columnName: '', warnings: ['dikkat'] });
  const invalid = prompts.parseStructured('{"formula": "[A] + ', 'calculated-column');
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, ['no-json']);
  const mismatch = prompts.parseStructured('{"explanation":"x","rules":[]}', 'automations');
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.includes('missing:code'));
  assert.equal(prompts.parseStructured('serbest metin', 'reports').ok, true, 'sözleşmesiz kaynak serbest metin alır');
  assert.deepEqual(prompts.extractJsonObject('önce {"a":"} değil {","b":2} sonra'), { a: '} değil {', b: 2 });
});

test('motor: geçersiz JSON var olan öneriyi bozmaz → data null, ham metin yedek ayıklama için döner', async () => {
  const auth = createLcwAiAuth({ provider: fakeProvider([makeToken()]) });
  const client = createLcwAiClient({ auth, fetch: async () => sseResponse([chunk({ content: 'Formül: ```[A]-[B]```', chunkType: 'content' }), COMPLETE]) });
  const result = await createLcwAiEngine({ auth, client }).ask('u1', { source: 'calculated-column', task: 'fark' });
  assert.equal(result.data, null);
  assert.equal(result.structured.ok, false);
  assert.equal(result.text, 'Formül: ```[A]-[B]```');
  assert.deepEqual(result.model, { key: 'gpt-6-sol', label: 'GPT-6 Sol' });
});

test('prompt builder: bağlam + rehber + istek birleşir; satır verisi ve sırlar ayıklanır', () => {
  const token = makeToken();
  const built = prompts.buildPrompt({
    source: 'rules', lang: 'tr', task: 'MB’ye 14 günden az kalan siparişleri kırmızı yap', guide: `REHBER\nAuthorization: Bearer ${token}`,
    context: { availableFields: ['Yüklemeye kalan gün'], accessToken: token, password: 'x', sampleRows: [{ order: 'PO-1' }], nested: { note: `jwt ${token}` } },
  });
  assert.match(built.prompt, /KULLANICI İSTEĞİ[\s\S]*14 günden az/);
  assert.match(built.prompt, /Yüklemeye kalan gün/);
  assert.match(built.prompt, /"formula": string/);
  assert.ok(!built.prompt.includes(token), 'token prompt\'a girmez');
  assert.ok(!/PO-1|sampleRows|password/.test(built.prompt), 'satır verisi ve parola anahtarı atılır');
  assert.equal(built.contract, 'rules');
});

test('güvenlik: access token log\'a, hata nesnesine, status\'a ve public hataya sızmaz', async () => {
  const token = makeToken();
  const logs = [];
  const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of Object.keys(originalConsole)) console[level] = (...args) => logs.push(args.map(String).join(' '));
  try {
    const auth = createLcwAiAuth({ provider: fakeProvider([token]) });
    const client = createLcwAiClient({ auth, logger: event => logs.push(JSON.stringify(event)), fetch: async () => new Response(`denied for Bearer ${token}`, { status: 403 }) });
    let caught;
    try { await client.sendMessage('u1', { content: 'x' }); } catch (error) { caught = error; }
    assert.equal(caught.code, 'LCWAI_FORBIDDEN');
    const surfaces = [JSON.stringify(publicError(caught)), JSON.stringify(caught), String(caught.message), JSON.stringify(auth.status('u1')), ...logs];
    for (const text of surfaces) assert.ok(!text.includes(token) && !/Bearer\s+ey/i.test(text), `sızıntı: ${text.slice(0, 80)}`);
    const err = lcwAiError('NETWORK', { detail: `Authorization: Bearer ${token}` });
    assert.ok(!err.detail.includes(token));
    assert.ok(!('detail' in publicError(err)), 'teknik ayrıntı renderer\'a gitmez');
  } finally { Object.assign(console, originalConsole); }
});
