'use strict';

/* v9.42 — TROY PO İNDİRME SERVİSİ: binary/base64/JSON-Base64/bayt-dizisi
 * cevap ayrıştırma, HTML/hata gövdesinin kaydedilmemesi, uzantı sırası
 * (Content-Disposition → Content-Type → magic-byte), dosya adı temizliği,
 * "(1)/(2)" ÜRETİLMEMESİ (yeniden indirme aynı yolun üstüne yazar).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function connectorError(message, code, statusCode, details) { return Object.assign(new Error(message), { code, statusCode, details }); }
function safeOwner(value) { return String(value == null ? '' : value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default'; }

// PO'ları os.homedir()/Downloads/Buyer Log PO altına yazar; testte gerçek ev
// dizinini kirletmemek için os.homedir'ı geçici bir klasöre yönlendiriyoruz.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-po-home-'));
const realHomedir = os.homedir;
os.homedir = () => tmpHome;

let authResults;
let requestHandler;
const sessionPath = require.resolve('../server/lib/troy-session-service');
require.cache[sessionPath] = {
  id: sessionPath, filename: sessionPath, loaded: true, exports: {
    getFreshAuthorization: async () => authResults,
    troyRequest: async (ownerId, headers, url, method, body, options) => {
      const resolved = await requestHandler(url, method, body, options);
      if (resolved.status === 401 || resolved.status === 403) throw connectorError('Troy oturumu sona ermiş görünüyor.', 'TROY_UNAUTHORIZED', 401);
      return resolved;
    },
    connectorError, safeOwner,
  },
};
const troyPoService = require('../server/lib/troy-po-service');

test.after(() => { os.homedir = realHomedir; });
test.beforeEach(() => { authResults = { ok: true, headers: { Authorization: 'Bearer test' } }; });

function b64Of(buffer) { return buffer.toString('base64'); }

test('v9.42 sanitizeWindowsFilename tüm geçersiz karakterleri temizler, baştaki/sondaki nokta-boşluğu kırpar', () => {
  assert.equal(troyPoService.sanitizeWindowsFilename('A<B>C:D"E/F\\G|H?I*J'), 'A_B_C_D_E_F_G_H_I_J');
  assert.equal(troyPoService.sanitizeWindowsFilename('  . ad. . '), 'ad');
});

test('v9.42 poBaseName: Style Name varsa "Style - PO Code", yoksa "PO Code"', () => {
  assert.equal(troyPoService.poBaseName('1289819', 'Kids Tee'), 'Kids Tee - PO 1289819');
  assert.equal(troyPoService.poBaseName('1289819', ''), 'PO 1289819');
});

test('v9.42 uzantı sırası: Content-Disposition önce, sonra Content-Type, sonra magic-byte', () => {
  assert.equal(troyPoService.extensionFromContentDisposition('attachment; filename="rapor.pdf"'), 'pdf');
  assert.equal(troyPoService.extensionFromContentDisposition(''), '');
  assert.equal(troyPoService.extensionFromContentType('application/pdf'), 'pdf');
  assert.equal(troyPoService.extensionFromContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
  assert.equal(troyPoService.sniffFileSignature(Buffer.from('%PDF-1.4')), 'pdf');
  assert.equal(troyPoService.sniffFileSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'xlsx');
});

test('v9.42 JSON-sarmalı base64 ve bayt-dizisi cevaplar doğru çözülür, HTML/hata gövdesi kaydedilmez', () => {
  const pdfBytes = Buffer.from('%PDF-1.4 örnek içerik');
  assert.deepEqual(troyPoService.unwrapPoBuffer(Buffer.from(JSON.stringify({ fileName: 'x.pdf', fileBase64: b64Of(pdfBytes) })), 'application/json'), pdfBytes);
  assert.deepEqual(troyPoService.unwrapPoBuffer(Buffer.from(JSON.stringify([...pdfBytes])), 'application/json'), pdfBytes);
  assert.equal(troyPoService.looksLikeErrorBody('text/html', Buffer.from('<html>error</html>')), true);
  assert.equal(troyPoService.looksLikeErrorBody('application/json', Buffer.from(JSON.stringify({ error: 'yok' }))), true);
});

test('v9.42 downloadPO: PDF binary yanıtı doğru dosya adıyla diske yazılır', async () => {
  const pdfBytes = Buffer.from('%PDF-1.4 test order 9101');
  requestHandler = () => ({ ok: true, status: 200, statusText: 'OK', contentType: 'application/pdf', contentDisposition: '', base64: b64Of(pdfBytes) });
  const result = await troyPoService.downloadPO('u1', '9101', { styleName: 'Kids Tee' });
  assert.equal(result.ok, true);
  assert.equal(result.fileName, 'Kids Tee - PO 9101.pdf');
  assert.ok(fs.existsSync(result.filePath));
  assert.deepEqual(fs.readFileSync(result.filePath), pdfBytes);
});

test('v9.42 downloadPO: HTML hata gövdesi diske YAZILMAZ', async () => {
  requestHandler = () => ({ ok: true, status: 200, statusText: 'OK', contentType: 'text/html', contentDisposition: '', base64: b64Of(Buffer.from('<html>oturum sona erdi</html>')) });
  await assert.rejects(() => troyPoService.downloadPO('u1', '9102', { styleName: 'X' }), err => err.code === 'TROY_PO_INVALID_RESPONSE');
  assert.equal(troyPoService.findExistingPoFile('9102', 'X'), null);
});

test('v9.42 downloadPO: 401\'de bir kez sessiz yeniden dener, sonra başarır', async () => {
  let attempt = 0;
  const pdfBytes = Buffer.from('%PDF-1.4 retry-ok');
  requestHandler = () => {
    attempt += 1;
    if (attempt === 1) return { ok: false, status: 401, statusText: 'Unauthorized' };
    return { ok: true, status: 200, statusText: 'OK', contentType: 'application/pdf', contentDisposition: '', base64: b64Of(pdfBytes) };
  };
  const result = await troyPoService.downloadPO('u1', '9103', { styleName: 'Retry' });
  assert.equal(result.ok, true);
  assert.equal(attempt, 2);
});

test('v9.42 downloadPO: aynı Style Name + Order Code ile yeniden indirme AYNI yolun üstüne yazar ("(1)" üretilmez)', async () => {
  const firstBytes = Buffer.from('%PDF-1.4 first');
  requestHandler = () => ({ ok: true, status: 200, statusText: 'OK', contentType: 'application/pdf', contentDisposition: '', base64: b64Of(firstBytes) });
  const first = await troyPoService.downloadPO('u1', '9104', { styleName: 'Re Down' });

  const secondBytes = Buffer.from('%PDF-1.4 second, longer content than first');
  requestHandler = () => ({ ok: true, status: 200, statusText: 'OK', contentType: 'application/pdf', contentDisposition: '', base64: b64Of(secondBytes) });
  const second = await troyPoService.downloadPO('u1', '9104', { styleName: 'Re Down' });

  assert.equal(first.filePath, second.filePath, 'aynı deterministik yol, "(1)" gibi bir varyant yok');
  assert.deepEqual(fs.readFileSync(second.filePath), secondBytes, 'ikinci indirme dosyanın üstüne yazmış olmalı');

  const foundAfter = fs.readdirSync(path.dirname(first.filePath)).filter(name => name.includes('Re Down'));
  assert.equal(foundAfter.length, 1, 'aynı temel adla ikinci bir dosya oluşmamalı');
});

test('v9.42 findExistingPoFile: dosya varsa bulur, yoksa null döner', async () => {
  assert.equal(troyPoService.findExistingPoFile('9999-yok', 'Style'), null);
  const pdfBytes = Buffer.from('%PDF-1.4 status-check');
  requestHandler = () => ({ ok: true, status: 200, statusText: 'OK', contentType: 'application/pdf', contentDisposition: '', base64: b64Of(pdfBytes) });
  const result = await troyPoService.downloadPO('u1', '9105', { styleName: 'Status Check' });
  const found = troyPoService.findExistingPoFile('9105', 'Status Check');
  assert.equal(found.filePath, result.filePath);
});
