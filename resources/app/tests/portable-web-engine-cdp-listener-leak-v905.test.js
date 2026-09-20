'use strict';

/*
 * CDP LISTENER LEAK — "11 close listeners added to [CdpClient]"
 *
 * Bulunan kusur: kayıt (recording) modu context.syncPages()'i her 180ms'de bir
 * çağırıyordu (setInterval, önceki tur BEKLENMEDEN). Yeni görülen bir hedefi
 * bağlamak (attachTargetClient → Target.attachToTarget, sonra PortablePage
 * init()'inin Page.enable/Runtime.enable) birkaç CDP round-trip'i tutar ve
 * 180ms'den uzun sürebilir. Bu pencerede aynı hedef için üst üste gelen
 * syncPages() turları PortableContext._addTarget'ı PARALEL çağırıyordu:
 * ikisi de "existing" kontrolünde hedefin henüz _pages'e eklenmediğini görüyor,
 * ikisi de kendi CdpSessionClient'ını kuruyordu. Her CdpSessionClient kurulumu
 * PAYLAŞILAN browserClient'a ('session-event','close') için 2 dinleyici
 * ekliyor; yetim kalan kopya hiç kapanmadığı için dinleyicileri de hiç
 * kaldırılmıyordu.
 *
 * Bu testler _addTarget'ın artık REZERVASYONLU olduğunu — aynı targetId için
 * üst üste gelen çağrıların TEK bir attach'ı paylaştığını — doğrudan CDP
 * protokolü üzerinden kanıtlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const engine = require('../server/lib/portable-web-engine');

function websocketFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]);
  const head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(body.length, 2);
  return Buffer.concat([head, body]);
}

function consumeClientFrames(state, chunk, onMessage) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  while (state.buffer.length >= 2) {
    const masked = Boolean(state.buffer[1] & 0x80); let length = state.buffer[1] & 0x7f, offset = 2;
    if (length === 126) { if (state.buffer.length < 4) return; length = state.buffer.readUInt16BE(2); offset = 4; }
    if (!masked || state.buffer.length < offset + 4 + length) return;
    const mask = state.buffer.subarray(offset, offset + 4), body = state.buffer.subarray(offset + 4, offset + 4 + length);
    const decoded = Buffer.alloc(length); for (let i = 0; i < length; i += 1) decoded[i] = body[i] ^ mask[i % 4];
    state.buffer = state.buffer.subarray(offset + 4 + length);
    if ((state.opcode || 1) !== 8) onMessage(JSON.parse(decoded.toString('utf8')));
  }
}

/*
 * Sahte CDP tarayıcı sunucusu (flat Target session modu). `targets` çağıran
 * tarafından ANLIK olarak değiştirilebilir (yeni bir sekme "belirir"), ve
 * `attachDelayMs` ile Target.attachToTarget cevabı bilerek geciktirilir —
 * gerçek dünyada birkaç CDP round-trip'inin (Page.enable, Runtime.enable,
 * binding/init-script kurulumu) alacağı süreyi simüle eder. `attachCounts`
 * her targetId için kaç KEZ attach isteği geldiğini sayar.
 */
function startFakeCdpServer() {
  const sockets = new Set();
  let targets = [];
  let attachDelayMs = 0;
  const attachCounts = new Map();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let handshake = Buffer.alloc(0), upgraded = false; const state = { buffer: Buffer.alloc(0) };
    socket.on('data', chunk => {
      if (!upgraded) {
        handshake = Buffer.concat([handshake, chunk]); const split = handshake.indexOf('\r\n\r\n'); if (split < 0) return;
        const head = handshake.subarray(0, split).toString('utf8'), key = /Sec-WebSocket-Key:\s*([^\r\n]+)/i.exec(head)[1].trim();
        const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        upgraded = true; chunk = handshake.subarray(split + 4);
      }
      if (!chunk.length) return;
      consumeClientFrames(state, chunk, message => {
        const reply = (result) => socket.write(websocketFrame({ id: message.id, result, ...(message.sessionId ? { sessionId: message.sessionId } : {}) }));
        if (message.method === 'Target.getTargets') { reply({ targetInfos: targets }); return; }
        if (message.method === 'Target.attachToTarget') {
          const targetId = message.params && message.params.targetId;
          attachCounts.set(targetId, (attachCounts.get(targetId) || 0) + 1);
          const sessionId = `session-${targetId}-${attachCounts.get(targetId)}`;
          setTimeout(() => reply({ sessionId }), attachDelayMs);
          return;
        }
        // Page.enable / Runtime.enable / diğer her şey: hemen boş cevap.
        reply({});
      });
    });
  });
  return {
    server, sockets,
    listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)),
    close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }),
    port: () => server.address().port,
    setTargets: (next) => { targets = next; },
    setAttachDelayMs: (ms) => { attachDelayMs = ms; },
    attachCountOf: (targetId) => attachCounts.get(targetId) || 0,
  };
}

test('v7.75 aynı hedef için üst üste gelen syncPages() turları TEK attach paylaşır', async () => {
  const fake = startFakeCdpServer();
  await fake.listen();
  fake.setTargets([]); // açılışta hiç sekme yok
  let browser;
  try {
    browser = await engine.connectOverCDP(`ws://127.0.0.1:${fake.port()}/devtools/browser/test`);
    const context = browser.contexts()[0];
    assert.equal(context.pages().length, 0);

    // Yeni bir sekme "belirir" ve onu bağlamak gerçekçi biçimde YAVAŞ (birkaç
    // CDP round-trip'i simülasyonu).
    fake.setTargets([{ targetId: 'page-new', type: 'page', url: 'http://localhost/new' }]);
    fake.setAttachDelayMs(120);

    // Kayıt modunun 180ms'lik zamanlayıcısının önceki turu BEKLEMEDEN yeni bir
    // tur başlatmasıyla AYNI durum: syncPages() üst üste, art arda (await
    // EDİLMEDEN) çağrılır.
    const overlapping = [context.syncPages(), context.syncPages(), context.syncPages()];
    await Promise.all(overlapping);

    assert.equal(fake.attachCountOf('page-new'), 1,
      'aynı hedef İKİ KEZ attach edilmemeli — üst üste gelen turlar aynı devam eden bağlantıyı paylaşmalı');
    assert.equal(context.pages().filter(page => page.targetId === 'page-new').length, 1,
      'hedef için tam olarak BİR PortablePage olmalı');

    // browserClient: PortableBrowser.init() 1 'close' dinleyicisi ekler; TEK
    // CdpSessionClient (yetim kopya YOKSA) 1 daha ekler ('session-event' ile
    // birlikte 2 dinleyici, ama burada yalnız 'close' sayılıyor). Bir yetim
    // kopya olsaydı bu sayı 3'e çıkardı.
    assert.equal(browser.browserClient.listenerCount('close'), 2,
      'paylaşılan browserClient üzerinde yetim bir CdpSessionClient dinleyicisi kalmamalı');
    assert.equal(browser.browserClient.listenerCount('session-event'), 1);
  } finally {
    try { browser?.browserClient?.close(); } catch (_) {}
    await fake.close();
  }
});

test('v7.75 kayıt modunun 180ms zamanlayıcısı gibi tekrarlanan hızlı polling MaxListeners uyarısı üretmez', async () => {
  const fake = startFakeCdpServer();
  await fake.listen();
  fake.setTargets([]);
  let browser;
  const warnings = [];
  const onWarning = (warning) => { if (warning && warning.name === 'MaxListenersExceededWarning') warnings.push(warning); };
  process.on('warning', onWarning);
  try {
    browser = await engine.connectOverCDP(`ws://127.0.0.1:${fake.port()}/devtools/browser/test`);
    const context = browser.contexts()[0];

    fake.setTargets([{ targetId: 'page-a', type: 'page', url: 'http://localhost/a' }]);
    fake.setAttachDelayMs(60);

    // Gerçek kayıt zamanlayıcısının simülasyonu: bir öncekini beklemeden
    // 15ms arayla 15 kez syncPages() tetikle (>180ms'lik toplam pencerede
    // aynı YENİ hedefi defalarca yakalamaya çalışır).
    const calls = [];
    for (let i = 0; i < 15; i += 1) { calls.push(context.syncPages().catch(() => {})); await new Promise(r => setTimeout(r, 15)); }
    await Promise.all(calls);
    // process 'warning' olayı asenkron yayılabilir; bir tık bekle.
    await new Promise(r => setTimeout(r, 50));

    assert.equal(fake.attachCountOf('page-a'), 1, 'tek hedef yalnız bir kez attach edilmeli');
    assert.equal(warnings.length, 0, 'MaxListenersExceededWarning ÜRETİLMEMELİ');
    assert.ok(browser.browserClient.listenerCount('close') <= 2,
      `close dinleyici sayısı sınırlı kalmalı, görülen: ${browser.browserClient.listenerCount('close')}`);
  } finally {
    process.off('warning', onWarning);
    try { browser?.browserClient?.close(); } catch (_) {}
    await fake.close();
  }
});

test('v7.75 hedef kapanınca CdpSessionClient dinleyicileri gerçekten kaldırılır (temizlik regresyonu)', async () => {
  const fake = startFakeCdpServer();
  await fake.listen();
  fake.setTargets([{ targetId: 'page-1', type: 'page', url: 'http://localhost/1' }]);
  let browser;
  try {
    browser = await engine.connectOverCDP(`ws://127.0.0.1:${fake.port()}/devtools/browser/test`);
    const context = browser.contexts()[0];
    assert.equal(context.pages().length, 1);
    assert.equal(browser.browserClient.listenerCount('close'), 2);

    // Kullanıcı sekmeyi doğrudan Edge'de kapattı: hedef artık listede yok.
    fake.setTargets([]);
    await context.syncPages();

    assert.equal(context.pages().length, 0);
    assert.equal(browser.browserClient.listenerCount('close'), 1,
      'kapanan hedefin CdpSessionClient dinleyicisi kaldırılmalı, yalnız browserClient kendi dinleyicisi kalmalı');
    assert.equal(browser.browserClient.listenerCount('session-event'), 0);
  } finally {
    try { browser?.browserClient?.close(); } catch (_) {}
    await fake.close();
  }
});

test('v7.75 iki FARKLI hedef aynı anda keşfedilirse ikisi de doğru bağlanır (rezervasyon yalnız aynı targetId’yi tekilleştirir)', async () => {
  const fake = startFakeCdpServer();
  await fake.listen();
  fake.setTargets([]);
  let browser;
  try {
    browser = await engine.connectOverCDP(`ws://127.0.0.1:${fake.port()}/devtools/browser/test`);
    const context = browser.contexts()[0];

    fake.setTargets([
      { targetId: 'page-x', type: 'page', url: 'http://localhost/x' },
      { targetId: 'page-y', type: 'page', url: 'http://localhost/y' },
    ]);
    fake.setAttachDelayMs(80);

    await Promise.all([context.syncPages(), context.syncPages()]);

    assert.equal(fake.attachCountOf('page-x'), 1);
    assert.equal(fake.attachCountOf('page-y'), 1);
    assert.equal(context.pages().length, 2);
    assert.equal(browser.browserClient.listenerCount('close'), 3, '1 (browserClient) + 2 (iki ayrı CdpSessionClient)');
  } finally {
    try { browser?.browserClient?.close(); } catch (_) {}
    await fake.close();
  }
});
