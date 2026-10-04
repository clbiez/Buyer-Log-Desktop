'use strict';
/* Genel LCW AI çalışma alanı: Knowledge katmanı, sohbet (chatId), bağlam
   sağlayıcıları, güvenli Markdown ve navigasyon. Bağlama özel "LCW AI'dan
   Destek Al" alanlarının aynı motoru kullandığı da burada korunur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const config = require('../server/lib/lcwai/lcwai-config');
const knowledge = require('../server/lib/lcwai/lcwai-knowledge');
const prompts = require('../server/lib/lcwai/lcwai-prompt');
const { createLcwAiAuth } = require('../server/lib/lcwai/lcwai-auth');
const { createLcwAiClient } = require('../server/lib/lcwai/lcwai-client');
const { createLcwAiEngine } = require('../server/lib/lcwai/lcwai-engine');
const { lcwAiError } = require('../server/lib/lcwai/lcwai-errors');
const Markdown = require('../public/lcwai-markdown.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function makeToken() {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc({ iss: config.KEYCLOAK.issuer, azp: config.KEYCLOAK.clientId, exp: Math.floor(Date.now() / 1000) + 300 })}.${Buffer.from('sig' + Math.random()).toString('base64url')}`;
}
const chunk = obj => `data: ${JSON.stringify(obj)}\n\n`;
const sse = (text, chatId) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); c.enqueue(e.encode(chunk({ content: text, chunkType: 'content' }) + chunk({ isComplete: true, chunkType: 'complete', finishReason: 'stop', metadata: { chatId, modelKey: 'gpt-6-sol' } }) + 'data: [DONE]\n\n')); c.close(); } }), { status: 200 });
function provider(tokens) { const q = tokens.slice(); return { async readToken(owner, { isUsable }) { const t = q.shift(); if (!t || !isUsable(t)) throw lcwAiError('SESSION_EXPIRED'); return { token: t }; } }; }

test('Knowledge: formül, kural ve otomasyon bilgisi GERÇEK motorlardan türetilir', () => {
  const formula = knowledge.moduleKnowledge('calculated-column', 'tr');
  const engine = require('../public/formula-engine.js');
  assert.ok(formula.includes(engine.buildAiPrompt({ lang: 'tr', columns: [], request: '' }).split('\n')[0]), 'formula-engine buildAiPrompt kaynaklı');
  assert.doesNotMatch(formula, /TABLOSUNUN SÜTUNLARI|CEVAP BİÇİMİ/, 'çalışma zamanı sütunları ve cevap biçimi bilgiye girmez');
  const rules = knowledge.moduleKnowledge('rules', 'tr');
  assert.match(rules, /Teslimat sonucu/);
  assert.match(rules, /ALAN ANLAMLARI[\s\S]*yetişme sonucu/, 'alan anlamları cp-rules-engine DERIVED_FIELDS.meaning kaynaklı');
  const automations = knowledge.moduleKnowledge('automations', 'en');
  assert.match(automations, /BUYERLOG_AUTOMATION/);
  assert.match(automations, /SEND_EMAIL/, 'eylemler ai-capability-registry kaynaklı');
  for (const key of Object.keys(knowledge.MODULES)) assert.ok(knowledge.moduleKnowledge(key, 'tr').length <= knowledge.MODULE_BUDGET_CHARS + 1, key);
  assert.match(knowledge.KNOWLEDGE_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test('Knowledge: yalnız ilgili modüller dinamik seçilir, bütün dokümantasyon gönderilmez', () => {
  assert.deepEqual(knowledge.selectModules({ task: 'Backlog’daki gecikmeleri analiz et' }), ['backlog']);
  assert.deepEqual(knowledge.selectModules({ task: 'Bu maili daha profesyonel yaz' }), []);
  assert.deepEqual(knowledge.selectModules({ source: 'rules', task: 'x' }), ['rules']);
  assert.ok(knowledge.selectModules({ task: 'formül kural otomasyon backlog sipariş koleksiyon' }).length <= knowledge.MAX_MODULES);
  assert.deepEqual(knowledge.selectModules({ task: 'Backlog gecikmeleri', exclude: ['backlog'] }), []);
});

test('sohbet prompt: ilk mesaj = sistem + global + modül + bağlam + mesaj; devam mesajı tekrar göndermez', () => {
  const first = prompts.buildChatPrompt({ message: 'Backlog’daki gecikmeleri analiz et', lang: 'tr', contexts: [{ label: 'CP — görünen', screen: 'cp', summary: '2 kayıt', filters: { Sezon: '26S' }, columns: ['PO', 'Durum'], rows: [['PO-1', 'Yolda'], ['PO-2', 'Üretimde']], totalRows: 2 }] });
  assert.match(first.prompt, /LCW AI genel kurumsal asistanı/);
  assert.match(first.prompt, /BUYER LOG BİLGİSİ/);
  assert.match(first.prompt, /MODÜL BİLGİSİ: Backlog/);
  assert.match(first.prompt, /BUYER LOG BAĞLAMI[\s\S]*Sezon=26S[\s\S]*PO\tDurum\nPO-1\tYolda/);
  assert.match(first.prompt, /=== KULLANICI MESAJI ===\nBacklog’daki/);
  const next = prompts.buildChatPrompt({ message: 'Peki ilk üçü?', lang: 'tr', firstMessage: false, sentModules: ['backlog'] });
  assert.equal(next.prompt, 'Peki ilk üçü?', 'devam: yalnız mesaj (geçmiş LCW AI’da)');
  const plain = prompts.buildChatPrompt({ message: 'Bana X konusunda açıklama yap', lang: 'tr' });
  assert.doesNotMatch(plain.prompt, /=== BUYER LOG BAĞLAMI|=== MODÜL BİLGİSİ/, 'bağlamsız normal soru');
  const many = prompts.formatContextBlock({ label: 'x', columns: ['a'], rows: Array.from({ length: 500 }, (_, i) => [i]), totalRows: 500 }, false);
  assert.match(many, /500 satırın 200 tanesi gösteriliyor/);
});

test('motor.chat: yeni sohbet chatId=null + başlık; ikinci mesaj aynı chatId; modül bilgisi tekrar gitmez', async () => {
  const bodies = [];
  const auth = createLcwAiAuth({ provider: provider([makeToken()]) });
  const client = createLcwAiClient({ auth, fetch: async (url, init) => { bodies.push(JSON.parse(init.body)); return sse('cevap', 'chat-42'); } });
  const engine = createLcwAiEngine({ auth, client });
  const first = await engine.chat('u1', { message: 'Backlog gecikmelerini analiz et', lang: 'tr' });
  assert.equal(first.chatId, 'chat-42');
  assert.equal(bodies[0].chatId, null);
  assert.equal(bodies[0].generateTitle, true);
  assert.match(bodies[0].content, /MODÜL BİLGİSİ: Backlog/);
  const second = await engine.chat('u1', { chatId: first.chatId, message: 'Backlog için ilk üçü hangisi?', lang: 'tr' });
  assert.equal(bodies[1].chatId, 'chat-42');
  assert.equal(bodies[1].generateTitle, false);
  assert.doesNotMatch(bodies[1].content, /MODÜL BİLGİSİ|BUYER LOG BİLGİSİ/);
  assert.equal(second.text, 'cevap');
});

test('motor.chat: ekler mesaja gider; token yoksa giriş gerekli; 401 sonrası yenilenip tekrar denenir', async () => {
  let body = null;
  const auth = createLcwAiAuth({ provider: provider([makeToken()]) });
  const client = createLcwAiClient({ auth, fetch: async (url, init) => { body = JSON.parse(init.body); return sse('ok', 'c1'); } });
  await createLcwAiEngine({ auth, client }).chat('u1', { message: 'karşılaştır', attachments: [{ blobName: 'conversation-files/a', contentType: 'text/plain', fileName: 'a.txt', size: 1, url: '/api/chat/attachments/a' }, { blobName: 'conversation-files/b', contentType: 'text/plain', fileName: 'b.txt', size: 1, url: '/api/chat/attachments/b' }] });
  assert.equal(body.attachments.length, 2);
  const noToken = createLcwAiAuth({ provider: { async readToken() { throw lcwAiError('BROWSER_UNAVAILABLE'); } } });
  await assert.rejects(createLcwAiEngine({ auth: noToken, client: createLcwAiClient({ auth: noToken, fetch: async () => sse('x', 'c') }) }).chat('u1', { message: 'merhaba' }), error => error.code === 'LCWAI_BROWSER_UNAVAILABLE' && error.action === 'login');
  let calls = 0;
  const auth401 = createLcwAiAuth({ provider: provider([makeToken(), makeToken()]) });
  const client401 = createLcwAiClient({ auth: auth401, fetch: async () => (++calls === 1 ? new Response('', { status: 401 }) : sse('yenilendi', 'c2')) });
  assert.equal((await createLcwAiEngine({ auth: auth401, client: client401 }).chat('u1', { message: 'x' })).text, 'yenilendi');
  await assert.rejects(createLcwAiEngine({ auth, client }).chat('u1', { message: '  ' }), error => error.code === 'LCWAI_BAD_REQUEST');
});

test('kota hatası LCW AI’ın kendi açıklamasını (temizlenmiş) taşır', () => {
  const { errorForHttpStatus, publicError } = require('../server/lib/lcwai/lcwai-errors');
  const error = errorForHttpStatus(429, { body: JSON.stringify({ message: 'Storage quota exceeded: 50 MB / 50 MB <b>' }), upload: true });
  assert.equal(error.code, 'LCWAI_QUOTA_EXCEEDED');
  assert.equal(publicError(error).remoteMessage, 'Storage quota exceeded: 50 MB / 50 MB b');
});

test('Markdown: tablo/kod/liste görüntülenir; ham HTML, olay öznitelikleri ve javascript: bağlantıları etkisiz', () => {
  const html = Markdown.render('# Özet\n| A | B |\n|---|---|\n| 1 | <img src=x onerror=alert(1)> |\n\n```html\n<script>alert(1)</script>\n```\n<script>alert(2)</script>\n[x](javascript:alert(1)) [lcw](https://lcwaikiki.com/a?b=1&c=2)\n- **kalın**', { copyLabel: 'Copy' });
  assert.match(html, /<table>/);
  assert.match(html, /data-lcwai-previewable="html"/);
  assert.match(html, /data-lcwai-code-copy>Copy</);
  assert.doesNotMatch(html, /<script|<img|<a href="javascript/i, 'gerçek etiket yok; kaçışlanmış metin kalır');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<a href="https:\/\/lcwaikiki\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">lcw<\/a>/);
  assert.match(html, /<li><strong>kalın<\/strong><\/li>/);
});

test('istemci: chat() NDJSON akışı, createConversation/continueConversation; bağlam sağlayıcı kaydı', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const text = [{ type: 'progress', phase: 'streaming', delta: 'Mer', chars: 3 }, { type: 'result', result: { chatId: 'c9', text: 'Merhaba', model: { label: 'GPT-6 Sol' } } }].map(e => JSON.stringify(e)).join('\n') + '\n';
    return new Response(text, { status: 200 });
  };
  const window = { appLang: 'tr', fetch: fetchImpl, BLUI: { notify: () => () => {} } };
  vm.runInContext(read('public/lcwai-assistant.js'), vm.createContext({ window, fetch: fetchImpl, AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout, console, Promise, JSON, Date, Error, Map, Set, encodeURIComponent }));
  const AI = window.BuyerLogAI;
  const deltas = [];
  const first = await AI.createConversation({ message: 'selam', onProgress: e => deltas.push(e.delta) });
  assert.equal(first.chatId, 'c9');
  await AI.continueConversation(first.chatId, { message: 'devam', contexts: [{ label: 'x' }] });
  assert.deepEqual(bodies.map(b => b.chatId), [null, 'c9']);
  assert.deepEqual(deltas, ['Mer']);
  assert.equal(AI.registerContextProvider({ id: 'test', screen: 'cp', label: { tr: 'Test', en: 'Test' }, getOptions: () => [{ id: 'rows', label: 'Satırlar' }], build: id => ({ label: 'Test', rows: [[id]] }) }), true);
  assert.equal(AI.registerContextProvider({ id: 'bad' }), false);
  const groups = JSON.parse(JSON.stringify(AI.getAvailableContext({ preferScreen: 'cp' })));
  assert.equal(groups[0].options[0].id, 'test:rows');
  const built = await AI.buildContext('test:rows');
  assert.equal(built.screen, 'cp');
  assert.equal(built.rows[0][0], 'rows');
});

test('navigasyon: LCW AI bağımsız modül (sol menü + üst çubuk), lazy yüklenir, herkese açık', () => {
  const INDEX = read('public/index.html'), APP = read('public/app-main.js'), PERF = read('public/perf-runtime.js'), ACCESS = read('public/user-access-ui.js'), CHAT = read('public/lcwai-chat.js');
  assert.match(INDEX, /<button data-tab="lcwai"[^>]*><svg class="ic"><use href="#i-robot"\/><\/svg><span data-i18n-tr="LCW AI" data-i18n-en="LCW AI">/);
  assert.match(INDEX, /<section id="view-lcwai">\s*<div class="lcwaiChatPage" id="lcwaiChatPage"/);
  assert.match(INDEX, /id="lcwaiTopBtn"/);
  assert.match(APP, /closest\('#lcwaiTopBtn'\)\)\{event\.preventDefault\(\);switchTab\('lcwai'\);/);
  assert.match(APP, /if\(tab!=='lcwai'&&typeof window\.BLCanAccessArea/);
  assert.match(APP, /ensureFeature\('lcwaiChat'\)\.then\(\(\)=>\{\s*if\(currentActiveTab\(\)==='lcwai'\)return window\.initLcwAiChat\?\.\(\);/);
  assert.match(APP, /window\.BL_LCWAI_LAST_TAB=previousTab/);
  assert.match(APP, /lcwai:\{tr:'LCW AI',en:'LCW AI',group:'home'\}/);
  assert.match(PERF, /lcwaiChat:\['lcwai-assistant\.js\?rev=1','lcwai-markdown\.js\?rev=1','lcwai-chat\.js\?rev=1'\]/);
  assert.match(ACCESS, /if \(key === 'lcwai'\) return true;/);
  // Tek motor: genel çalışma alanı kendi AI istemcisini yazmaz.
  assert.doesNotMatch(CHAT, /fetch\(|'\/api\/lcwai|mym\.prod|access_token/);
  assert.match(CHAT, /api\.chat\(\{/);
  assert.match(CHAT, /api\.uploadFile\(files\[index\]\)/);
  assert.match(CHAT, /api\.buildContext\(id\)/);
  assert.match(CHAT, /window\.BLMarkdown\.render/);
  assert.doesNotMatch(CHAT, /localStorage\.|sessionStorage\./, 'sohbet içeriği tarayıcı deposuna yazılmaz');
});

test('genel ve bağlama özel AI aynı motoru kullanır; bağlama özel alanlar duruyor', () => {
  for (const file of ['public/formula-columns.js', 'public/cp-overview-assistant.js', 'public/ai-automation-import.js']) assert.match(read(file), /AI\.mountAssistant\(host, \{/, file);
  const routes = read('server/routes/lcwai-routes.js');
  assert.match(routes, /engineOf\(\)\.chat\(owner/);
  assert.match(routes, /engineOf\(\)\.ask\(owner/);
  assert.equal((read('server/lib/lcwai/index.js').match(/createLcwAiAuth\(/g) || []).length, 1, 'tek auth');
});
