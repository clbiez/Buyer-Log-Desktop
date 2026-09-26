'use strict';

/* Çok cihazlı senaryoda bulunan hata: Shared Hub checkpoint onarımı yerel
   kaydı checkpoint kopyasıyla BÜTÜNÜYLE değiştiriyordu. Ortak ayar (master)
   kopyası yalnız ortak alanları taşıdığı için:
   - kaydın revizyon saati (_revision/_fieldRevisions) siliniyordu; aynı
     cihazın sonraki yerel yazımı baseRevision 0 ile gidiyor ve diğer
     cihazlarda "yol süresi" gibi ortak ayarlar sahte çakışmaya düşüyordu;
   - cihaza özel/iş alanları (settings.sourceFolders, overrides.notesmap)
     yerel önbellekten düşüyordu.
   Onarım artık checkpoint değerlerini yerel kayda birleştirir ve saati
   geri almaz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const policy = require('../server/lib/shared-sync-policy');
const { createLocalDb } = require('../server/lib/local-db');

test('Ortak ayar checkpoint kaydı overrides revizyon saatini yalnız ortak alanlar için taşır', () => {
  const state = { records: { 'store:overrides.json': {
    transitRules: [{ id: 'z' }], notesmap: { a: { Notes: 'iş verisi' } },
    storeRevisionMeta: { revision: 4 },
    _revision: 19, _fieldRevisions: { transitRules: 19, notesmap: 7, storeRevisionMeta: 19 },
  } } };
  const record = policy.masterRecordsFromState(state)['store:overrides.json'];
  assert.equal(record.notesmap, undefined);
  assert.equal(record._revision, 19);
  assert.deepEqual(record._fieldRevisions, { transitRules: 19, storeRevisionMeta: 19 });
});

test('Checkpoint birleşimi yerel alanları ve saati korur, checkpoint değerini alır', () => {
  const local = {
    transitRules: [{ id: 'eski' }], notesmap: { a: 1 }, sourceFolders: { u2: 'C:/kaynak' },
    _revision: 2, _fieldRevisions: { transitRules: 2, notesmap: 2, sourceFolders: 2 },
  };
  const remote = { transitRules: [{ id: 'mod' }], storeRevisionMeta: { revision: 9 }, _revision: 19, _fieldRevisions: { transitRules: 19 } };
  const merged = policy.mergeCheckpointRecord(local, remote);
  assert.deepEqual(merged.transitRules, [{ id: 'mod' }]);
  assert.deepEqual(merged.notesmap, { a: 1 });
  assert.deepEqual(merged.sourceFolders, { u2: 'C:/kaynak' });
  assert.equal(merged._revision, 19);
  assert.equal(merged._fieldRevisions.transitRules, 19);
  assert.equal(merged._fieldRevisions.notesmap, 2);
  // Eski checkpoint (saatsiz) yerel saati geri almaz.
  const legacy = policy.mergeCheckpointRecord(local, { transitRules: [{ id: 'mod' }] });
  assert.equal(legacy._revision, 2);
  assert.equal(legacy._fieldRevisions.transitRules, 2);
  assert.deepEqual(policy.mergeCheckpointRecord(null, remote), remote);
});

test('Onarımdan sonraki yerel yazım checkpoint saatini taban alır (baseRevision 0 değil)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ckpt-'));
  try {
    const db = createLocalDb(path.join(dir, 'L.db'));
    await db.queuePatch({ id: 'store:overrides.json', patch: { transitRules: [], notesmap: {} } });
    const remote = { transitRules: [{ id: 'mod' }], _revision: 19, _fieldRevisions: { transitRules: 19 } };
    await db.transaction(async next => {
      next.records['store:overrides.json'] = policy.mergeCheckpointRecord(next.records['store:overrides.json'], remote);
      next.revision = Math.max(Number(next.revision) || 0, policy.checkpointRecordRevision(remote));
    });
    await db.queuePatch({ id: 'store:overrides.json', patch: { transitRules: [{ id: 'mod' }, { id: 'z' }] } });
    const state = await db.read();
    const last = state.journal[state.journal.length - 1];
    assert.equal(last.baseRevision, 19);
    assert.ok(last.revision > 19);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Sunucu checkpoint onarımı kaydı ezmez, birleştirir ve saati ilerletir', () => {
  const source = require('./helpers/server-source')();
  const start = source.indexOf('async function applyMissingCheckpointRecords');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.match(body, /next\.records\[id\] = area === 'master'\s*\? sharedSyncPolicy\.mergeCheckpointRecord\(next\.records\[id\], remoteRecords\[id\]\)/);
  assert.match(body, /next\.revision = Math\.max\(Number\(next\.revision\) \|\| 0, sharedSyncPolicy\.checkpointRecordRevision\(remoteRecords\[id\]\)\)/);
});
