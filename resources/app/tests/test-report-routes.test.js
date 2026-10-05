'use strict';
/* Test Raporu Aktarımı — sunucu: parse (kalıcı yazmaz) → commit (onaylanan
   kalem, ek, iz). Geçici veri klasöründe gerçek express ile koşar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-test-reports-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = DATA;
const express = require('express');
const checklistSupplierStore = require('../server/lib/checklist-supplier-store');
const store = require('../server/lib/test-reports/store');
const register = require('../server/routes/test-report-routes');

const FIX = path.join(__dirname, 'fixtures', 'test-reports');
const audits = [];
function app() {
  const a = express();
  a.use((req, _res, next) => { req.currentUser = { id: 'u1', displayName: 'Demo User' }; next(); });
  register(a, {
    express, checklistSupplierStore,
    automationError: (res, err) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code }),
    userAccess: { requireAnyArea: () => (_req, _res, next) => next(), appendAudit: (...args) => audits.push(args) },
  });
  return a;
}
async function withServer(fn) {
  const server = app().listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { return await fn(base); } finally { server.close(); }
}
async function post(base, url, body) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
function file(name) { return { name, base64: fs.readFileSync(path.join(FIX, name)).toString('base64') }; }

test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

test('parse önizleme yazmaz; commit rapor, ek ve iz yazar; karar iki kez işlenmez', async () => {
  await withServer(async base => {
    const parsed = await post(base, '/api/test-reports/parse', { files: [file('B-labright-result-364790.msg'), file('C-decision-1360191-barcha.msg')] });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.reports.length, 2);
    assert.equal(fs.existsSync(store.FILE), false, 'önizleme kalıcı yazmaz');
    assert.ok(parsed.body.files.every(f => f.status === 'parsed'));

    const items = [
      { talepNo: '364790', orderKey: '1374537|KK.TSH,FT-UKRAYNA|Q6K', itemId: 'tests', context: { orderCode: '1374537', checklistName: 'Tests' } },
      { talepNo: '3467719', orderKey: '1360191|KK.BDY,BARCHA-4-YD|XYZ', itemId: 'tests' },
    ];
    const committed = await post(base, '/api/test-reports/commit', { sessionId: parsed.body.sessionId, items, typeMap: { 'ON URETIM BILESEN': 'tests' } });
    assert.equal(committed.status, 200);
    const b = committed.body.results.find(r => r.talepNo === '364790');
    assert.equal(b.attachments.length, 2, 'Lang1 + Lang2 eklendi');
    assert.ok(checklistSupplierStore.getAttachmentPath(b.attachments[0].id));
    assert.equal(committed.body.typeMap['ON URETIM BILESEN'].itemId, 'tests');
    const saved = store.read();
    assert.equal(saved.links['364790'].orderKey, items[0].orderKey);
    assert.equal(saved.events.length, 2);
    assert.equal(saved.events[0].by, 'Demo User', 'onaylayan kullanıcı izde');
    assert.ok(saved.events[0].sourceFiles.some(n => /Lang1/.test(n)), 'kaynak dosya izde');
    assert.ok(audits.some(a => a[1] === 'TEST_REPORT_IMPORT' && a[2] === '3467719'));

    // Aynı oturum tekrar kullanılamaz.
    const again = await post(base, '/api/test-reports/commit', { sessionId: parsed.body.sessionId, items });
    assert.equal(again.status, 410);

    // Aynı karar maili yeniden bırakılır: karar ve ek tekrarlanmaz.
    const reparsed = await post(base, '/api/test-reports/parse', { files: [file('C-decision-1360191-barcha.msg')] });
    const second = await post(base, '/api/test-reports/commit', { sessionId: reparsed.body.sessionId, items: [items[1]] });
    assert.equal(second.body.results[0].newDecisions, 0);
    assert.equal(second.body.results[0].decisionsSkipped, 1);
    assert.equal(second.body.results[0].attachments.length, 0);
    assert.equal(store.read().reports['3467719'].kararlar.length, 1);

    // Buying bekleniyor kararı satırda görev olarak döner.
    const taste = await post(base, '/api/test-reports/parse', { files: [file('C-decision-1380959-taste.msg')] });
    await post(base, '/api/test-reports/commit', { sessionId: taste.body.sessionId, items: [{ talepNo: '3465774', orderKey: '1380959|PNT,TASTE-YD|NNV', itemId: 'tests' }] });
    const tasks = await (await fetch(base + '/api/test-reports/tasks')).json();
    assert.equal(tasks.tasks.length, 2);
    assert.equal(tasks.tasks[0].orderKey, '1380959|PNT,TASTE-YD|NNV');
    assert.equal(tasks.tasks[0].aciklama, 'görsel iletebilir misiniz');
  });
});

test('önizlemede olmayan talep no ve süresi dolan oturum reddedilir', async () => {
  await withServer(async base => {
    const parsed = await post(base, '/api/test-reports/parse', { files: [file('A-TestRequestResultReport_4459415.pdf')] });
    const bad = await post(base, '/api/test-reports/commit', { sessionId: parsed.body.sessionId, items: [{ talepNo: '9999999', orderKey: 'x', itemId: 'tests' }] });
    assert.equal(bad.status, 400);
    const expired = await post(base, '/api/test-reports/commit', { sessionId: 'nope', items: [] });
    assert.equal(expired.status, 410);
  });
});
