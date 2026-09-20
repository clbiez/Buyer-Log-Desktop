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

test('v6.09 browser-level ws endpoint uses flat Target sessions without node:http', async () => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let handshake = Buffer.alloc(0), upgraded = false; const state = { buffer:Buffer.alloc(0) };
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
        let result = {};
        if (message.method === 'Target.getTargets') result = { targetInfos:[{ targetId:'page-1', type:'page', url:'http://localhost:4173' }] };
        if (message.method === 'Target.attachToTarget') result = { sessionId:'session-page-1' };
        socket.write(websocketFrame({ id:message.id, result, ...(message.sessionId ? { sessionId:message.sessionId } : {}) }));
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  try {
    browser = await engine.connectOverCDP(`ws://127.0.0.1:${port}/devtools/browser/test`);
    assert.equal(browser.contexts()[0].pages().length, 1);
    assert.equal(browser.contexts()[0].pages()[0].url(), 'http://localhost:4173');
    assert.equal(browser.contexts()[0].pages()[0].client.sessionId, 'session-page-1');
  } finally {
    browser?.browserClient?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});
