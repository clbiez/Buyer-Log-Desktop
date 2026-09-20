'use strict';

/* v7.01 — Quotations Status değiştirilemiyor sorunu.
 *
 * Kök neden: PATCH /api/quotations/:id/status route'u merkezi IAM
 * yetkisi olarak QUOTATIONS.APPROVE arıyordu. Diğer tüm quotation edit
 * route'ları (PUT /:id, PATCH /:id/editors, POST /merge) QUOTATIONS.EDIT
 * kullanıyor ve quotations-store.setStatus zaten kendi ownership tabanlı
 * kontrolünü (owner/editor/moderator) yapıyor. Sahibi/editörü olan ama
 * ayrıca APPROVE yetkisine sahip olmayan kullanıcı için istek qCanEditRequest
 * tarafından UI'da editable gösteriliyor, ama sunucu setStatus'a hiç
 * ulaşmadan 403 ile reddediyordu — kullanıcı seçim yapabiliyor gibi
 * görünüyor, kayıt sessizce başarısız oluyor, refresh'te eski status
 * geri geliyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

test('v7.01 status route diğer quotation edit route\'larıyla aynı merkezi yetkiyi kullanır', () => {
  const match = SERVER_SRC.match(/app\.patch\('\/api\/quotations\/:id\/status',\s*userAccess\.requireCapability\('([^']+)'\)/);
  assert.ok(match, 'status route bulunamadı');
  assert.equal(match[1], 'QUOTATIONS.EDIT', 'status route PUT /:id ve PATCH /:id/editors ile aynı QUOTATIONS.EDIT yetkisini kullanmalı');
});

test('v7.01 editor/owner status değişikliği sunucu store seviyesinde kalıcı olur', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-quotation-status-v701-'));
  process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'server', 'lib', 'quotations-store.js'))];
    const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
    const owner = { id: 'owner-1', role: 'user', displayName: 'Owner' };
    const editor = { id: 'editor-1', role: 'user', displayName: 'Editor' };
    const viewer = { id: 'viewer-1', role: 'user', displayName: 'Viewer' };

    const req = store.createRequest(owner, {
      source: 'collection', manufacturers: [{ name: 'A', email: 'a@x.com' }],
      items: [{ modelKey: 'M1', manufacturer: 'A', orderCode: '1', price: '10.00' }],
    });
    store.setEditors(owner, req.id, [editor.id], [owner.id, editor.id, viewer.id]);

    const closed = store.setStatus(editor, req.id, 'closed');
    assert.equal(closed.status, 'closed', 'editor status\'u değiştirebilmeli');
    const reloaded = store.loadStore().requests.find(r => r.id === req.id);
    assert.equal(reloaded.status, 'closed', 'yeniden yüklenen kayıt yeni status\'u korumalı');

    assert.throws(() => store.setStatus(viewer, req.id, 'active'),
      /QUOTATION_EDIT_DENIED|yetkiniz/, 'view-only kullanıcı status değiştirememeli');
    const stillClosed = store.loadStore().requests.find(r => r.id === req.id);
    assert.equal(stillClosed.status, 'closed', 'reddedilen istek mevcut status\'u ezmemeli');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('v7.01 qChangeStatus başarılı save sonrası yeni status ile render eder, eskiyi geri yazmaz', () => {
  const start = UI_SRC.indexOf('async function qChangeStatus(');
  assert.ok(start >= 0, 'qChangeStatus bulunamadı');
  const brace = UI_SRC.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = brace; i < UI_SRC.length; i += 1) {
    if (UI_SRC[i] === '{') depth += 1;
    else if (UI_SRC[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = UI_SRC.slice(brace + 1, end);

  const savedIdx = body.indexOf('qReplaceRequest(');
  const renderIdx = Math.max(body.indexOf('qRenderWorkspaceAll('), body.indexOf('qRenderDetail()'));
  assert.ok(savedIdx >= 0 && renderIdx > savedIdx,
    'qReplaceRequest sunucu yanıtıyla state\'i güncelledikten SONRA render tetiklenmeli, aksi halde eski state render edilir');
  assert.match(body, /qReplaceRequest\(data\.request\|\|/, 'sunucudan dönen canonical request önceliklidir');
});
