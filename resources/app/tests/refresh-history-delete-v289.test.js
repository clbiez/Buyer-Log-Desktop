'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-refresh-history-v289-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('ASAS & ANTREPO history records can be deleted with optimistic revision control', () => {
  const first = db.addRefreshHistory({ createdAt: '2026-07-27T08:00:00.000Z', details: [{ source: 'ASAS', ocode: '1' }] });
  const second = db.addRefreshHistory({ createdAt: '2026-07-27T09:00:00.000Z', details: [{ source: 'ANTREPO', ocode: '2' }] });
  const before = db.loadRefreshHistory();
  assert.equal(before.items.length, 2);
  assert.equal(before._revision, 2);

  const saved = db.deleteRefreshHistory(first.id, before._revision);
  assert.equal(saved._revision, 3);
  assert.deepEqual(saved.items.map(item => item.id), [second.id]);
  assert.throws(
    () => db.deleteRefreshHistory(second.id, before._revision),
    err => err && err.code === 'REVISION_CONFLICT' && err.currentRevision === 3,
  );
  assert.throws(
    () => db.deleteRefreshHistory('missing', saved._revision),
    err => err && err.code === 'REFRESH_HISTORY_NOT_FOUND' && err.statusCode === 404,
  );
});

// Bu UI ve i18n mekanizması index.html'den app-main.js'e taşındı; TR/EN metinleri artık
// data-i18n-tr/en özniteliği değil, JS ternary/sözlük girdisi (appLang tabanlı).
test('history button is renamed in both languages and selected records expose a delete action', () => {
  const appMain = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
  assert.match(appMain, /title: en \? 'ASAS & ANTREPO History' : 'ASAS & ANTREPO Geçmişi'/);
  assert.match(appMain, /id="sourceRefreshHistDelete"/);
  assert.match(appMain, /#i-trash/);
  assert.match(appMain, /fetchJSON\(`\/api\/refresh-history\/\$\{encodeURIComponent\(rec\.id\)\}`/);
  assert.match(appMain, /expectedRevision:_sourceRefreshHistoryState\.revision/);
  assert.match(server, /app\.delete\('\/api\/refresh-history\/:id'/);
  assert.match(server, /deleteRefreshHistory\(req\.params\.id, requestRevision\(req\), sourceUserId\(req\)\)/);
});
