'use strict';

/* Canlı hata (7.0.251): yerel DB büyüyünce sync her turda
   "Invalid string length" ile düşüyor, "View Conflicts" de "Sync çakışmaları
   okunamadı" diyordu. Sebep: anlık görüntü, iş hash'i ve çakışma listesi tek
   dev JSON.stringify ile üretiliyordu; V8 tek string'i ~512 MB'ta keser.
   Testler bu sınırı, durumun TAMAMINI tek seferde serileştiren çağrıyı
   RangeError ile reddederek taklit eder. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { jsonToBuffer, jsonSha256, jsonPreview, parseJsonBuffer } = require('../server/lib/large-json');
const { createLocalDb, summarizeConflict } = require('../server/lib/local-db');

function tempDb(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-large-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'BuyerLogLocal.db');
}
const isWholeState = value => value && typeof value === 'object' && !Array.isArray(value) && 'syncLedger' in value && 'journal' in value;
const isWholeBusiness = value => value && typeof value === 'object' && !Array.isArray(value) && 'records' in value && 'tombstones' in value && 'assets' in value;
function simulateStringLimit(t) {
  const original = JSON.stringify;
  JSON.stringify = function guarded(value, ...rest) {
    if (isWholeState(value) || isWholeBusiness(value)) throw new RangeError('Invalid string length');
    return original.call(this, value, ...rest);
  };
  t.after(() => { JSON.stringify = original; });
}

test('parçalı serileştirme JSON.stringify ile bayt bayt aynıdır', () => {
  const value = { a: [1, { b: 'x\ny', c: undefined, d: () => 1 }, null, [], {}], e: new Date(0), f: 'ş "\\', g: { h: { i: { j: [1, 2, { k: 3 }] } } }, u: undefined };
  for (const indent of [0, 2]) for (const expandDepth of [0, 1, 2, 3, Infinity]) {
    assert.equal(jsonToBuffer(value, { indent, expandDepth }).toString('utf8'), JSON.stringify(value, null, indent));
  }
  const crypto = require('node:crypto');
  assert.equal(jsonSha256(value), crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'));
});

test('büyük tampon parça parça çözülür (string sınırına takılmadan)', () => {
  const value = { records: { a: { x: 'é"\\', n: [1, -2.5e3, true, null] }, b: {} }, list: [[], {}, 'z'], deviceId: 'dev' };
  const buffer = Buffer.from(JSON.stringify(value, null, 2));
  assert.deepEqual(parseJsonBuffer(buffer, { directMaxBytes: 4 }), value);
  assert.throws(() => parseJsonBuffer(Buffer.from('{"a":1,}'), { directMaxBytes: 2 }), SyntaxError);
});

test('önizleme dev değeri gezmeden kısaltır', () => {
  const preview = jsonPreview({ rows: Array.from({ length: 50000 }, (_, i) => ({ i })) }, 120);
  assert.equal(preview.truncated, true);
  assert.equal(preview.text.length, 120);
});

test('yerel DB: tam durum tek string olarak serileştirilemese de yazma, sıkıştırma ve okuma çalışır', async t => {
  const file = tempDb(t);
  const db = createLocalDb(file);
  await db.queuePatch({ id: 'store:a', patch: { value: 'ilk' } });
  simulateStringLimit(t);
  // transaction → tam anlık görüntü yazar (eskiden RangeError).
  await db.transaction(async state => { state.migrations.check = true; });
  for (let i = 0; i < 5; i += 1) await db.queuePatch({ id: `store:${i}`, patch: { value: i } });
  await db.markSynced((await db.pending()).map(item => item.eventId));
  const stats = await db.stats();
  assert.match(stats.businessHash, /^[0-9a-f]{64}$/);
  await db.compact({ keepUploadedTail: 100 });
  const reopened = createLocalDb(file);
  const state = await reopened.read();
  assert.equal(state.records['store:4'].value, 4);
  assert.equal(state.migrations.check, true);
  assert.equal(reopened.getDeviceId(), db.getDeviceId());
});

test('çakışma listesi sınırlı özet döner; çözülen çakışmanın dev değerleri atılır', async t => {
  const file = tempDb(t);
  const db = createLocalDb(file);
  const big = 'x'.repeat(50000);
  await db.queuePatch({ id: 'store:doc', patch: { body: big + 'yerel' } });
  const local = (await db.read()).records['store:doc']._revision;
  await db.applyDelta({ id: 'store:doc', eventId: 'remote-1', patch: { body: big + 'uzak' }, revision: local + 1, baseRevision: 0, deviceId: 'peer' });
  const [summary] = await db.listConflictSummaries();
  assert.ok(summary, 'çakışma listelenir');
  assert.equal(summary.field, 'body');
  assert.equal(summary.current.truncated, true);
  assert.ok(summary.current.preview.length <= 4000);
  assert.ok(summary.incoming.preview.length <= 4000);
  await db.resolveConflict(summary.conflictId, 'incoming');
  const stored = (await db.read()).conflicts.find(item => item.conflictId === summary.conflictId);
  assert.equal(stored.resolved, true);
  assert.equal(stored.current, undefined);
  assert.equal(stored.incoming, undefined);
  assert.equal((await db.read()).records['store:doc'].body, big + 'uzak');
  assert.deepEqual(await db.listConflictSummaries(), []);
  assert.equal(summarizeConflict({ conflictId: 'c', incoming: { delete: true } }).current.missing, true);
});

test('sunucu: çakışma ucu özet döndürür', () => {
  const source = require('./helpers/server-source')();
  assert.match(source, /async function allSyncConflicts\(profile\) \{[\s\S]{0,400}listConflictSummaries/);
  assert.match(source, /conflict: summarizeConflict\(conflict\), conflicts: await allSyncConflicts/);
});

test('istemci: "View Conflicts" çakışmaları ayrıntılı listeler ve çözdürür', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const body = ui.slice(ui.indexOf('async function openSyncStatusModal('), ui.indexOf("document.getElementById('syncStatusBtn')?.addEventListener"));
  assert.match(body, /data-sync-conflicts-panel/);
  assert.match(body, /\/api\/sync-conflicts\/\$\{encodeURIComponent\(id\)\}\/resolve/);
  assert.match(body, /data-resolve="current"[\s\S]{0,200}data-resolve="incoming"/);
  assert.doesNotMatch(body, /açık conflict kaydı/, 'yalnız sayı gösteren eski toast kalmamalı');
});

test('istemci: geçici betik yükleme hatası bir kez yeniden denenir', () => {
  const perf = fs.readFileSync(path.join(__dirname, '..', 'public', 'perf-runtime.js'), 'utf8');
  assert.match(perf, /async function loadScriptWithRetry\(rawSrc\)/);
  assert.match(perf, /for\(const file of files\)await loadScriptWithRetry\(file\)/);
});
