'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const shape = require('../electron/lcwai-request-shape');

test('LCW AI web isteği: yalnız alan adları ve türler loglanır, değer asla', () => {
  const body = {
    chatId: null, content: 'GİZLİ-METİN', modelKey: 'gpt-6-sol', sessionId: 'SESSION-SECRET',
    attachments: [{ fileId: 'FILE-SECRET', sessionId: 'SESSION-SECRET', size: 12 }, { fileId: 'FILE-2' }],
    visionEnabled: true,
  };
  const line = shape.describeRequest({
    method: 'POST', url: 'https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/messages?x=SECRET',
    requestHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer TOKEN-SECRET' },
    uploadData: [{ bytes: Buffer.from(JSON.stringify(body)) }],
  });
  assert.equal(line, 'LCWAI_WEB_REQUEST POST /chat/messages json={chatId:null,content:string,modelKey:string,sessionId:string,attachments:[{fileId:string,sessionId:string,size:number}]x2,visionEnabled:boolean}');
  assert.ok(!/SECRET|GİZLİ|gpt-6/.test(line));
});

test('LCW AI web isteği: multipart yalnız alan adlarını verir; ilgisiz/GET istekler atlanır', () => {
  const boundary = '----x';
  const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="gizli.png"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n--${boundary}\r\nContent-Disposition: form-data; name="sessionId"\r\n\r\nSESSION-SECRET\r\n--${boundary}--`;
  const line = shape.describeRequest({ method: 'POST', url: 'https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/files/upload', requestHeaders: { 'content-type': `multipart/form-data; boundary=${boundary}` }, uploadData: [{ bytes: Buffer.from(multipart) }] });
  assert.equal(line, 'LCWAI_WEB_REQUEST POST /chat/files/upload multipart=file(file),sessionId');
  assert.equal(shape.describeRequest({ method: 'GET', url: 'https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/x' }), '');
  assert.equal(shape.describeRequest({ method: 'POST', url: 'https://example.com/lcw/gpt/api/chat/messages' }), '');
  assert.equal(shape.apiPath('https://mym.prod.lcwaikiki.com/lcw/gpt/api/chat/7e9a3932-d7e3-4eea-a9aa-ef537abc0cd1/files'), '/chat/:id/files');
});

test('Electron: tanılama penceresi konsoldan açılır, yalnız güvenilir göndericiye ve yapı logu ile', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8');
  assert.match(preload, /openLcwAiWebDiagnostics:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('buyerlog:lcwai-web-diagnostics'\)/);
  assert.match(main, /ipcMain\.handle\('buyerlog:lcwai-web-diagnostics',[\s\S]{0,200}trustedBuyerLogIpcSender\(event\)/);
  assert.match(main, /lcwAiRequestShape\.describeRequest\(/);
  // Dinleyici pencere kapanınca kaldırılır (oturum kalıcıdır).
  assert.match(main, /webRequest\.onBeforeRequest\(LCWAI_WEB_DIAG_FILTER, null\)/);
});
