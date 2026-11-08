'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./harness');
const { B, envelopeBytes } = require('./runtime');
let seed = 0;
function items(count = 6, sizes = [8192, 32768, 131072]) {
  const offset = (seed++) * 10000;
  return h.fixture.fixture(count, sizes).map((i, n) => ({ ...i, plmId: String(8000000 + offset + n), styleId: String(9000000 + offset + n), urlId: offset + n, contentTag: offset + n }));
}
function drained(c) {
  const x = c.runtime.snapshot();
  assert.equal(x.reservedBytes, 0); assert.equal(x.activePermits, 0); assert.equal(x.waitingCount, 0);
  assert.equal(x.buffers, 0); assert.equal(x.stagedBytes, 0); assert.equal(x.scopes, 0);
  assert.ok(x.peakReservedBytes <= x.limitBytes);
  assert.equal(c.transport.stats.active, 0); assert.equal(c.transport.stats.retainedBodies, 0);
}
function equalBytes(xs) { for (const [n, o] of h.output(xs).entries()) assert.equal(o.hash, h.fixture.hash(h.fixture.png(xs[n].size, xs[n].contentTag))); }
function seedAuto(xs) {
  const ingest = h.baseIngest.createPlmImageIngest({ ownership: h.owner, getImage: h.user.getCollectionImage, saveImage: h.user.saveCollectionImage, deleteImage: h.user.deleteCollectionImage,
    readImageBytes: found => fs.readFileSync(found.full), patchLinks: h.db.patchPlmImageLinks });
  return ingest.commit(xs.map((i, n) => ({ ...i, buffer: h.fixture.png(512, 999 + n), sourceType: 'OPTION', sourceIdentity: `old-${n}` })), h.snapshot());
}

test('RED/GREEN: shared admission precedes any transport, both sync jobs finish with one envelope', { timeout: 15000 }, async () => {
  const hold = h.gate(), opened = h.gate();
  const xs = items(4);
  const arm = process.env.INT03_ARM || 'after';
  const a = h.context(xs.slice(0, 2), { arm, runtimeOptions: { limitBytes: envelopeBytes }, transportHooks: { onOpen() { opened.resolve(); }, spec: () => ({ beforeBody: hold.promise, chunked: true }) } });
  const b = h.context(xs.slice(2), { arm, runtime: a.runtime, transportHooks: { spec: () => ({ beforeBody: hold.promise, chunked: true }) } });
  const jobs = [a.run(), b.run()];
  await opened.promise; await h.tick();
  try {
    assert.equal(a.transport.stats.starts + b.transport.stats.starts, 1, 'full budget must block transport dispatch');
    assert.ok(a.runtime.snapshot().waitingCount > 0);
    assert.equal(a.runtime.snapshot().reservedBytes, envelopeBytes);
  } finally { hold.resolve(); await Promise.all(jobs); }
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map(r => r.status), ['completed', 'completed']);
  assert.equal(a.metrics.patchCalls, 1); assert.equal(b.metrics.patchCalls, 1);
  equalBytes(xs); drained(a); drained(b);
});

test('source lifecycle proof: onWritten is unused and bounded results retain buffers', async () => {
  let written = 0;
  const r = await h.baseQueue.runBounded([1, 2, 3], async n => ({ buffer: Buffer.alloc(512, n) }), { concurrency: 2, onWritten() { written++; } });
  assert.equal(written, 0); assert.equal(r.results.filter(x => Buffer.isBuffer(x.value.buffer)).length, 3);
});

test('slow canonical consumer keeps permit, a second sync waits without blocking the commit', { timeout: 15000 }, async () => {
  const hold = h.gate(), committing = h.gate();
  const a = h.context(items(2), { runtimeOptions: { limitBytes: envelopeBytes }, beforeCommitEntry: async () => { committing.resolve(); await hold.promise; } });
  const pa = a.run(); await committing.promise;
  const b = h.context(items(2), { runtime: a.runtime }); const pb = b.run();
  await h.tick();
  try {
    assert.equal(b.transport.stats.starts, 0); assert.ok(a.runtime.snapshot().waitingCount > 0);
    assert.equal(a.runtime.snapshot().buffers, 1); assert.equal(a.runtime.snapshot().reservedBytes, envelopeBytes);
  } finally { hold.resolve(); }
  assert.equal((await pa).status, 'completed'); assert.equal((await pb).status, 'completed'); drained(a); drained(b);
});

test('chunked unknown length, false lengths, MIME, encoding and malformed headers fail closed', { timeout: 30000 }, async () => {
  const cases = [
    [{ chunked: true }, null], [{ length: 512, size: 513 }, 'PLM_IMAGE_LENGTH_MISMATCH'],
    [{ length: 513, size: 512 }, 'PLM_IMAGE_LENGTH_MISMATCH'], [{ length: B + 1 }, 'PLM_IMAGE_TOO_LARGE'],
    [{ chunked: true, size: B + 512 }, 'PLM_IMAGE_TOO_LARGE'], [{ length: '512,512' }, 'PLM_IMAGE_LENGTH_INVALID'],
    [{ length: 0 }, 'PLM_IMAGE_EMPTY'], [{ invalid: true }, 'PLM_IMAGE_INVALID_TYPE'],
    [{ headers: { 'content-encoding': 'gzip' } }, 'INT03_UNEXPECTED_ENCODING'],
  ];
  for (const [spec, code] of cases) {
    const xs = items(1, [512]); const c = h.context(xs, { transportHooks: { spec: () => spec } });
    const r = await c.run();
    assert.equal(r.status, code ? 'partial' : 'completed', JSON.stringify(spec));
    if (code) assert.equal(r.failures[0].code, code);
    else equalBytes(xs);
    assert.equal(c.transport.stats.starts, 1); drained(c);
  }
});

test('existing 20 MiB image cap is accepted intact, no lower acceptance limit', { timeout: 30000 }, async () => {
  const xs = items(1, [B]); const c = h.context(xs, { transportHooks: { spec: () => ({ chunked: true }) } });
  const r = await c.run(); assert.equal(r.status, 'completed'); equalBytes(xs); drained(c);
  assert.ok(c.transport.stats.writableBackpressure > 0);
});

test('retry settles the failed stream and clears its body before the next attempt, one reservation', async () => {
  const xs = items(1, [131072]); let c;
  c = h.context(xs, { transportHooks: { spec: (i, n) => n === 1 ? { failAt: 16384 } : {}, onOpen(i, n) {
    if (n === 2) { assert.equal(c.transport.stats.settled, 1); assert.equal(c.transport.stats.retainedBodies, 0); assert.equal(c.runtime.snapshot().activePermits, 1); }
  } } });
  const r = await c.run(); assert.equal(r.status, 'completed'); assert.equal(c.transport.stats.starts, 2); equalBytes(xs); drained(c);
});

test('abort removes a queued sync without dispatching or affecting the active sync', async () => {
  const opened = h.gate(), hold = h.gate();
  const a = h.context(items(1), { runtimeOptions: { limitBytes: envelopeBytes }, transportHooks: { onOpen() { opened.resolve(); }, spec: () => ({ beforeBody: hold.promise }) } });
  const pa = a.run(); await opened.promise;
  const controller = new AbortController();
  const b = h.context(items(2), { runtime: a.runtime, signal: controller.signal }); const pb = b.run();
  await h.tick(); controller.abort();
  const rb = await pb; assert.equal(rb.status, 'cancelled'); assert.equal(b.transport.stats.starts, 0);
  assert.equal(a.runtime.snapshot().reservedBytes, envelopeBytes); hold.resolve();
  assert.equal((await pa).status, 'completed'); drained(a); drained(b);
});

test('active abort retains reservation until transport and Buffer users actually settle', { timeout: 15000 }, async () => {
  const hold = h.gate(), opened = h.gate(); const controller = new AbortController();
  const c = h.context(items(2, [524288]), { signal: controller.signal, runtimeOptions: { limitBytes: envelopeBytes },
    transportHooks: { onOpen() { opened.resolve(); }, spec: () => ({ chunked: true, chunkDelay: 1, settleGate: hold.promise }) } });
  let finished = false; const p = c.run().finally(() => { finished = true; });
  await opened.promise; await h.delay(5); controller.abort(); await h.tick();
  try { assert.equal(finished, false); assert.equal(c.runtime.snapshot().reservedBytes, envelopeBytes); assert.equal(c.transport.stats.active, 1); }
  finally { hold.resolve(); }
  const r = await p; assert.equal(r.status, 'cancelled'); assert.equal(c.transport.stats.starts, 1); drained(c);
});

test('abort during a non-interruptible canonical consumer waits and commits completed downloads', async () => {
  const hold = h.gate(), begun = h.gate(); const controller = new AbortController();
  const xs = items(2); const c = h.context(xs, { signal: controller.signal, runtimeOptions: { limitBytes: envelopeBytes }, beforeCommitEntry: async () => { begun.resolve(); await hold.promise; } });
  let finished = false; const p = c.run().finally(() => { finished = true; });
  await begun.promise; controller.abort(); await h.tick();
  try { assert.equal(finished, false); assert.equal(c.runtime.snapshot().activePermits, 1); assert.equal(c.runtime.snapshot().buffers, 1); }
  finally { hold.resolve(); }
  const r = await p; assert.equal(r.status, 'cancelled'); assert.equal(c.metrics.patchCalls, 1); equalBytes(xs); drained(c);
});

test('manual ownership, URL/content dedup, source cache and no-op revision survive staging', async () => {
  const xs = items(6);
  xs[2].urlId = xs[1].urlId; xs[2].contentTag = xs[1].contentTag; xs[2].size = xs[1].size;
  xs[4].contentTag = xs[3].contentTag; xs[4].size = xs[3].size;
  const manual = h.user.saveCollectionImage({ rowId: 'manual', mimeType: 'image/png', filename: 'manual.png', base64: h.fixture.png(512, 4242).toString('base64') });
  h.db.patchPlmImageLinks([{ ...xs[0], imageRef: manual.id }]);
  const before = h.snapshot(); const files = h.user.readCollectionImageIndex().length;
  const c = h.context(xs); const r = await c.run();
  assert.equal(r.status, 'completed'); assert.equal(r.counts.manualPreserved, 1); assert.equal(c.transport.stats.starts, 4);
  assert.equal(h.snapshot().imagemap[h.baseIngest.canonicalKeyFor(xs[0])], manual.id);
  assert.equal(h.user.readCollectionImageIndex().length - files, 3);
  assert.equal(h.snapshot().revision - before.revision, 1);
  assert.equal(h.output(xs)[1].ref, h.output(xs)[2].ref); assert.equal(h.output(xs)[3].ref, h.output(xs)[4].ref);
  const next = h.context(xs); const again = await next.run();
  assert.equal(again.status, 'completed'); assert.equal(next.transport.stats.starts, 0); assert.equal(h.snapshot().revision - before.revision, 1); drained(c); drained(next);
});

test('partial download failure checkpoints only durable successes; retry can resume the failed identity', async () => {
  const xs = items(5); const bad = xs[2].urlId;
  const c = h.context(xs, { transportHooks: { spec: i => i.urlId === bad ? { invalid: true } : {} } });
  const r = await c.run(); assert.equal(r.status, 'partial'); assert.equal(r.failures.length, 1); assert.equal(r.outcomes.length, 4);
  assert.equal(h.output(xs)[2].hash, null); equalBytes(xs.filter((_, i) => i !== 2));
  assert.equal(c.metrics.checkpoints.filter(x => x.kind === 'complete').length, 4); drained(c);
  const retry = h.context(xs); const rr = await retry.run(); assert.equal(rr.status, 'completed'); assert.equal(retry.transport.stats.starts, 1); equalBytes(xs); drained(retry);
});

test('single patch failure rolls back all new files, preserves owners and revision, no completed checkpoint', async () => {
  const xs = items(4); const before = h.snapshot(); const files = h.user.readCollectionImageIndex().length;
  const c = h.context(xs, { patchFailure: true });
  await assert.rejects(c.run(), { code: 'SYNTHETIC_PATCH_FAILURE' });
  assert.equal(h.user.readCollectionImageIndex().length, files); assert.equal(h.snapshot().revision, before.revision);
  assert.deepEqual(h.snapshot().store, before.store); assert.equal(c.metrics.checkpoints.filter(x => x.kind === 'complete').length, 0); drained(c);
});

test('manual writer during async staged commit causes CAS conflict and rollback instead of overwrite', async () => {
  const xs = items(2); let manual;
  const c = h.context(xs, { beforeCommitEntry: async () => {
    if (manual) return;
    manual = h.user.saveCollectionImage({ rowId: 'race', mimeType: 'image/png', filename: 'manual.png', base64: h.fixture.png(512, 7878).toString('base64') });
    h.db.patchPlmImageLinks([{ ...xs[0], imageRef: manual.id }]);
  } });
  const files = h.user.readCollectionImageIndex().length;
  await assert.rejects(c.run(), { code: 'INT03_CANONICAL_CONFLICT' });
  assert.equal(h.snapshot().imagemap[h.baseIngest.canonicalKeyFor(xs[0])], manual.id);
  assert.equal(h.user.readCollectionImageIndex().length, files + 1); drained(c);
});

test('dropOldFiles true/false keeps aliased and future referenced old files until the single patch succeeds', async () => {
  for (const dropOldFiles of [true, false]) {
    const xs = items(3); const seeded = seedAuto(xs.slice(0, 2));
    const [shared, orphan] = seeded.outcomes.map(x => x.imageRef);
    h.db.patchPlmImageLinks([{ plmId: String(7000000 + seed), colourCode: 'ALIAS', colour: 'SYNTHETIC', imageRef: shared }]);
    const c = h.context(xs, { dropOldFiles }); const r = await c.run();
    assert.equal(r.status, 'completed'); assert.ok(h.user.getCollectionImage(shared)); assert.equal(Boolean(h.user.getCollectionImage(orphan)), !dropOldFiles);
    assert.equal(r.removedFiles, dropOldFiles ? 1 : 0); equalBytes(xs); drained(c);
  }
});

test('staging quota fails closed without waiting for all downloads or changing per-image acceptance', async () => {
  const c = h.context(items(3, [10 * 1024 * 1024]), { runtimeOptions: { stageLimitBytes: B } });
  const r = await c.run(); assert.equal(r.status, 'partial'); assert.equal(r.failures.length, 1); assert.equal(r.failures[0].code, 'INT03_STAGE_QUOTA');
  assert.equal(r.outcomes.length, 2); drained(c);
});

test.after(() => h.cleanup());

test('timeout destroys transport but does not refund before the producer settles', { timeout: 10000 }, async () => {
  const hold = h.gate(), opened = h.gate();
  const c = h.context(items(1), { downloadOptions: { maxAttempts: 1, timeoutMs: 1000 }, transportHooks: { onOpen() { opened.resolve(); }, spec: () => ({ beforeBody: hold.promise }) } });
  const p = c.run(); await opened.promise; await h.delay(1100);
  try { assert.equal(c.runtime.snapshot().activePermits, 1); assert.equal(c.transport.stats.active, 1); }
  finally { hold.resolve(); }
  const r = await p; assert.equal(r.status, 'partial'); assert.equal(r.failures[0].code, 'PLM_IMAGE_TIMEOUT'); drained(c);
});

test('fatal staged-read failure after saving a predecessor rolls back the entire unpatched group', async () => {
  const xs = items(3); let n = 0;
  const files = h.user.readCollectionImageIndex().length; const before = h.snapshot();
  const c = h.context(xs, { beforeCommitEntry: async entry => { if (++n === 1) {
    const stageDir = require('node:path').dirname(entry.stage.file);
    const others = fs.readdirSync(stageDir).map(x => require('node:path').join(stageDir, x)).filter(x => x !== entry.stage.file);
    for (const other of others) fs.truncateSync(other, 0);
  } } });
  await assert.rejects(c.run(), { code: 'INT03_STAGE_SIZE' });
  assert.equal(h.user.readCollectionImageIndex().length, files); assert.equal(h.snapshot().revision, before.revision); drained(c);
});

test('entry storage failure stays partial and explicit overwriteManual remains effective', async () => {
  const xs = items(3); const files = h.user.readCollectionImageIndex().length;
  const c = h.context(xs, { failSave: payload => payload.rowId.includes(xs[1].plmId) });
  const r = await c.run(); assert.equal(r.status, 'partial'); assert.equal(r.failures[0].code, 'SYNTHETIC_STORAGE_FAILURE');
  assert.equal(c.metrics.patchCalls, 1); assert.equal(h.user.readCollectionImageIndex().length - files, 2); drained(c);
  const manual = h.user.saveCollectionImage({ rowId: 'overwrite', mimeType: 'image/png', filename: 'manual.png', base64: h.fixture.png(512, 9090).toString('base64') });
  const more = items(1); h.db.patchPlmImageLinks([{ ...more[0], imageRef: manual.id }]);
  const overwrite = h.context(more); overwrite.input.overwriteManual = true;
  assert.equal((await overwrite.run()).status, 'completed'); equalBytes(more); drained(overwrite);
});

test('a later entry retaining the old reference prevents early dropOldFiles deletion', async () => {
  const xs = items(2); xs[1].size = 512; xs[1].contentTag = 999;
  const old = seedAuto(xs.slice(0, 1)).outcomes[0].imageRef;
  h.db.patchPlmImageLinks([{ ...xs[1], imageRef: old }]);
  h.owner.rememberAutomatic([{ key: h.baseIngest.canonicalKeyFor(xs[1]), owner: 'plm', imageRef: old, sourceType: 'OPTION', sourceIdentity: 'old-future', hash: h.fixture.hash(h.fixture.png(512, 999)) }]);
  const c = h.context(xs, { dropOldFiles: true }); const r = await c.run();
  assert.equal(r.status, 'completed'); assert.equal(r.outcomes[1].status, 'unchanged');
  assert.equal(h.output(xs)[1].ref, old); assert.ok(h.user.getCollectionImage(old)); assert.equal(r.removedFiles, 0); equalBytes(xs); drained(c);
});

test('candidate writes the real checkpoint only after durable links and resumes just the failed identity', async () => {
  const jobs = require('../../../resources/app/server/lib/plm-image-job-store');
  const xs = items(5); const id = 'int03-staged-durable-resume';
  const checkpoint = jobs.createCheckpoint({ jobId: id, userId: 'synthetic', items: xs, mode: 'all' });
  const c = h.context(xs, { checkpoint, transportHooks: { spec: i => i.urlId === xs[2].urlId ? { invalid: true } : {} } });
  const r = await c.run(); checkpoint.finish(r.status);
  assert.equal(r.status, 'partial'); const disk = jobs.readRecord(id); assert.equal(disk.done.length, 4);
  const resumed = jobs.resumeCheckpoint(id); assert.deepEqual(resumed.pending().map(x => x.plmId), [xs[2].plmId]);
  assert.deepEqual(jobs.retryItems(id).map(x => x.plmId), [xs[2].plmId]);
  const retry = h.context(xs.slice(2, 3), { checkpoint: resumed }); const rr = await retry.run(); resumed.finish(rr.status);
  assert.equal(jobs.readRecord(id).done.length, 5); assert.equal(retry.transport.stats.starts, 1); equalBytes(xs); drained(c); drained(retry);
});

test('ownership-only unchanged commit still revalidates CAS before persisting owners', async () => {
  const xs = items(1, [512]); xs[0].contentTag = 999;
  const seeded = seedAuto(xs); const old = seeded.outcomes[0].imageRef;
  let manual;
  const c = h.context(xs, { beforeCommitEntry: async () => {
    manual = h.user.saveCollectionImage({ rowId: 'unchanged-race', mimeType: 'image/png', filename: 'manual.png', base64: h.fixture.png(512, 7777).toString('base64') });
    h.db.patchPlmImageLinks([{ ...xs[0], imageRef: manual.id }]);
    h.owner.rememberManual([{ key: h.baseIngest.canonicalKeyFor(xs[0]), imageRef: manual.id }]);
  } });
  await assert.rejects(c.run(), { code: 'INT03_CANONICAL_CONFLICT' });
  assert.equal(c.metrics.patchCalls, 0); assert.equal(h.snapshot().imagemap[h.baseIngest.canonicalKeyFor(xs[0])], manual.id);
  assert.equal(h.snapshot().store.manual[h.baseIngest.canonicalKeyFor(xs[0])].imageRef, manual.id);
  assert.ok(h.user.getCollectionImage(old)); drained(c);
});
