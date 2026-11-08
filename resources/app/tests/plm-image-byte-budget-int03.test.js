'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-int03-test-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT);
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const service = require('../server/lib/plm-image-sync-service');
const budgetLib = require('../server/lib/plm-image-byte-budget-int03');
const ingestLib = require('../server/lib/plm-image-ingest');
const ownership = require('../server/lib/plm-image-ownership');
const MiB = 1024 * 1024;
const attach = id => `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${id}`;
function image(size, tag = 1) {
  const buffer = Buffer.alloc(size, tag);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(buffer);
  return { buffer, mimeType: 'image/png', size };
}
function inputFor(count, ingest, downloadImage) {
  return {
    requests: Array.from({ length: count }, (_, i) => ({ plmId: String(9100000 + i), colourCode: 'TST', colour: 'SYNTHETIC' })),
    mode: 'all', ingest, downloadImage,
    styleListLookup: async codes => ({ data: { coreNectumResultData: { styleListResult: codes.map(code => ({
      plmCode: code, styleId: code, model: { imageUrl: attach(code) },
    })) } } }),
    styleImagesLookup: async () => ({ data: { styleImages: { StyleImages: [] }, styleOptionImages: { OptionImages: [] } } }),
  };
}
function simpleIngest(commit) {
  return {
    decideBeforeFetch: request => ({ ...request, decision: 'fetch' }),
    decideBeforeWrite: item => ({ ...item, decision: 'fetch' }),
    commit,
  };
}
test('INT-03: successful downloads do not accumulate job-sized Buffer roots before the single canonical commit', async () => {
  let calls = 0;
  const ingest = simpleIngest(entries => {
    const roots = new Set(entries.map(entry => Object.getOwnPropertyDescriptor(entry, 'buffer').value).filter(Buffer.isBuffer));
    const bytes = [...roots].reduce((sum, buffer) => sum + buffer.length, 0);
    assert.ok(bytes <= 20 * MiB, `job retains ${bytes} bytes before commit`);
    assert.equal(entries.length, 12);
    for (const entry of entries) assert.equal(entry.buffer.length, 2 * MiB);
    calls += 1;
    return { outcomes: [], counts: {}, linksUpdated: 0 };
  });
  const result = await service.runPlmImageSync(inputFor(12, ingest, async () => image(2 * MiB)));
  assert.equal(result.counts.downloadsCompleted, 12);
  assert.equal(calls, 1, 'registry/dedup/dropOldFiles keep the original single commit boundary');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
test('INT-03: weighted FIFO budget, queued cancellation and idempotent release', async () => {
  const budget = budgetLib.createByteBudget(10);
  const first = await budget.acquire(7);
  let cancelled = false;
  const queued = budget.acquire(5, () => cancelled);
  const rejected = assert.rejects(queued, { code: 'PLM_JOB_CANCELLED' });
  cancelled = true;
  await rejected;
  assert.equal(budget.snapshot().waiting, 0);
  const small = await budget.acquire(3);
  assert.equal(budget.snapshot().used, 10);
  let acquired = false;
  const next = budget.acquire(8).then(permit => { acquired = true; return permit; });
  first.release(); first.release();
  await tick();
  assert.equal(acquired, false);
  small.release();
  (await next).release();
  assert.deepEqual(budget.snapshot(), { limit: 10, used: 0, peak: 10, waiting: 0 });
  await assert.rejects(budget.acquire(11), RangeError);
});

test('INT-03: multiple jobs share the reservation through slow commit and clean private staging', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('buyerlog-plm-int03-'));
  let finishCommit;
  let commitStarted;
  const started = new Promise(resolve => { commitStarted = resolve; });
  const slow = new Promise(resolve => { finishCommit = resolve; });
  let downloads = 0;
  const ingest = simpleIngest(async entries => {
    assert.ok(budgetLib.imageByteBudget.snapshot().used >= budgetLib.COMMIT_BYTES);
    for (const entry of entries) assert.ok(entry.buffer.length);
    commitStarted();
    await slow;
    return { outcomes: [], counts: {}, linksUpdated: 0 };
  });
  const first = service.runPlmImageSync(inputFor(10, ingest, async () => { downloads++; return image(MiB + downloads); }));
  await started;
  let cancelled = false;
  const second = service.runPlmImageSync({
    ...inputFor(20, ingest, async () => { downloads++; await tick(); return image(2 * MiB); }),
    isCancelled: () => cancelled,
  });
  // The 216 MiB commit leaves room for one 40 MiB download, never eight.
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.ok(budgetLib.imageByteBudget.snapshot().used <= budgetLib.PROCESS_BYTES);
  cancelled = true;
  finishCommit();
  const result = await Promise.all([first, second]);
  assert.equal(result[1].status, 'cancelled');
  assert.equal(budgetLib.imageByteBudget.snapshot().used, 0);
  assert.equal(budgetLib.imageByteBudget.snapshot().waiting, 0);
  assert.ok(budgetLib.imageByteBudget.snapshot().peak <= budgetLib.PROCESS_BYTES);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('buyerlog-plm-int03-')), before);
});

function canonical() {
  const directory = fs.mkdtempSync(path.join(root, 'canonical-'));
  const files = new Map();
  let imagemap = {};
  let store = ownership.emptyStore();
  let revision = 0;
  let sequence = 0;
  const deleted = [];
  const ingest = ingestLib.createPlmImageIngest({
    ownership: { ...ownership, saveOwnership: value => { store = value; return value; } },
    getImage: ref => files.has(ref) ? { full: path.join(directory, ref), item: files.get(ref) } : null,
    readImageBytes: found => fs.readFileSync(found.full),
    saveImage: ({ base64, mimeType }) => {
      const id = `ci_${++sequence}`, buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(path.join(directory, id), buffer);
      const item = { id, size: buffer.length, mimeType, url: `/api/collection-images/${id}`, updatedAt: String(sequence) };
      files.set(id, item);
      return item;
    },
    deleteImage: ref => { deleted.push(ref); fs.unlinkSync(path.join(directory, ref)); return files.delete(ref); },
    patchLinks: links => {
      if (api.failPatch) throw new Error('synthetic registry failure');
      revision++;
      imagemap = { ...imagemap };
      for (const link of links) imagemap[ingestLib.canonicalKeyFor(link)] = link.imageRef;
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  const api = { ingest, deleted, failPatch: false,
    state: () => ({ store, imagemap }),
    snapshot: () => ({ imagemap, revision, files: [...files.keys()].map(ref => [ref, fs.readFileSync(path.join(directory, ref)).toString('hex')]) }),
  };
  return api;
}
test('INT-03: staged single commit preserves exact content, hash dedup, manual ownership, registry revision and deferred deletion', async () => {
  const live = canonical(), eager = canonical();
  let seq = 0;
  const input = inputFor(5, live.ingest, async () => image(1024 + (seq++ % 2), 7));
  const oldEntries = input.requests.slice(0, 4).map((item, index) => ({ ...item, ...image(2048, 2 + index), sourceType: 'STYLE_LIST', sourceIdentity: 'old' }));
  for (const fixture of [live, eager]) fixture.ingest.commit(oldEntries, { ...fixture.state() });
  // An unknown ownership record means a user-owned image and must be skipped.
  const manual = input.requests[4];
  for (const fixture of [live, eager]) {
    fixture.state().imagemap[ingestLib.canonicalKeyFor(manual)] = fixture.state().imagemap[ingestLib.canonicalKeyFor(input.requests[0])];
  }
  let baselineEntries;
  const originalCommit = live.ingest.commit;
  live.ingest.commit = (entries, options) => {
    assert.equal(live.deleted.length, 0, 'no early commit may remove original files');
    baselineEntries = entries.map(entry => {
      const plain = Object.fromEntries(Object.keys(entry).filter(key => key !== 'buffer').map(key => [key, entry[key]]));
      return { ...plain, buffer: Buffer.from(entry.buffer) };
    });
    return originalCommit(entries, options);
  };
  const result = await service.runPlmImageSync({ ...input, ...live.state(), dropOldFiles: true });
  const baseline = eager.ingest.commit(baselineEntries, { ...eager.state(), dropOldFiles: true });
  assert.equal(result.counts.manualPreserved, 1);
  assert.equal(result.outcomes.length, 4);
  assert.deepEqual(result.outcomes, baseline.outcomes);
  assert.equal(result.linksUpdated, baseline.linksUpdated);
  assert.equal(result.removedFiles, baseline.removedFiles);
  assert.equal(result.removedFiles, 3, 'manual reference keeps one old file; three unused originals are deleted only in the final commit');
  assert.deepEqual(live.snapshot(), eager.snapshot());
  const owners = value => JSON.parse(JSON.stringify(value, (key, val) => (key === 'at' || /At$/.test(key)) ? undefined : val));
  assert.deepEqual(owners(live.state().store), owners(eager.state().store));
});

test('INT-03: failed commit releases budget and staging; registry failure keeps originals', async () => {
  const live = canonical();
  const input = inputFor(3, live.ingest, async () => image(2048));
  live.ingest.commit(input.requests.map(item => ({ ...item, ...image(1024), sourceIdentity: 'old', sourceType: 'STYLE_LIST' })), live.state());
  const before = live.snapshot();
  live.failPatch = true;
  await assert.rejects(service.runPlmImageSync({ ...input, ...live.state(), dropOldFiles: true }), /synthetic registry failure/);
  assert.deepEqual(live.snapshot(), before);
  assert.equal(budgetLib.imageByteBudget.snapshot().used, 0);
});

test('INT-03: download failure and cancellation keep successful partial results without leaking permits', async () => {
  let attempt = 0, commits = 0, cancelled = false;
  const ingest = simpleIngest(entries => {
    commits++;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].buffer.length, 1024);
    return { outcomes: [], counts: {}, linksUpdated: 0 };
  });
  const result = await service.runPlmImageSync({
    ...inputFor(10, ingest, async () => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error('synthetic failed download'), { code: 'ECONNRESET' });
      cancelled = true;
      return image(1024);
    }), downloadConcurrency: 1, isCancelled: () => cancelled,
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.failures.length, 1);
  assert.equal(commits, 1);
  assert.equal(budgetLib.imageByteBudget.snapshot().used, 0);
});

test('INT-03: real stream rejects large declared/unknown bodies and cancellation destroys the active request', async () => {
  const http = require('node:http');
  const https = require('node:https');
  const queue = require('../server/lib/plm-image-download-queue');
  let activeClosed;
  const closed = new Promise(resolve => { activeClosed = resolve; });
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'image/png');
    if (req.url === '/declared') { res.setHeader('Content-Length', '99999999'); res.end(); return; }
    if (req.url === '/overflow') { res.write(image(1024).buffer); res.end(image(2048).buffer); return; }
    if (req.url === '/slow' || req.url === '/timeout') {
      res.write(image(1024).buffer);
      if (req.url === '/slow') req.on('close', activeClosed);
      return;
    }
    // No Content-Length: chunked response exercises the actual accumulator.
    res.write(image(1024).buffer.subarray(0, 500));
    res.end(image(1024).buffer.subarray(500));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const original = https.get;
  https.get = (options, callback) => http.get({ host: '127.0.0.1', port: server.address().port, path: options.path }, callback);
  try {
    const ok = await queue.httpGetImage('https://synthetic.invalid/unknown', { maxBytes: 2048 });
    assert.deepEqual(ok.buffer, image(1024).buffer);
    assert.equal(ok.headers['content-length'], undefined);
    for (const route of ['declared', 'overflow']) {
      await assert.rejects(queue.httpGetImage(`https://synthetic.invalid/${route}`, { maxBytes: 2048 }), { code: 'PLM_IMAGE_TOO_LARGE' });
    }
    let cancel = false;
    const active = queue.httpGetImage('https://synthetic.invalid/slow', { isCancelled: () => cancel });
    const rejected = assert.rejects(active, { code: 'PLM_JOB_CANCELLED' });
    await new Promise(resolve => setTimeout(resolve, 30));
    cancel = true;
    await rejected;
    await closed;
    await assert.rejects(queue.httpGetImage('https://synthetic.invalid/timeout', { timeoutMs: 1000 }), { code: 'PLM_IMAGE_TIMEOUT' });
    await assert.rejects(queue.downloadImage(attach('oversize'), {
      maxBytes: 1024, request: async () => ({ ...image(2048), contentType: 'image/png' }),
    }), { code: 'PLM_IMAGE_TOO_LARGE' });
  } finally {
    https.get = original;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('INT-03: cancellation interrupts retry backoff without another request', async () => {
  const queue = require('../server/lib/plm-image-download-queue');
  let cancelled = false, calls = 0;
  const active = queue.downloadImage(attach('retry-cancel'), {
    isCancelled: () => cancelled, baseDelayMs: 1000, random: () => 1,
    request: async () => {
      calls++;
      throw Object.assign(new Error('synthetic retryable failure'), { code: 'PLM_IMAGE_HTTP_ERROR', status: 503 });
    },
  });
  const rejection = assert.rejects(active, { code: 'PLM_JOB_CANCELLED' });
  const timer = setTimeout(() => { cancelled = true; }, 30);
  try { await rejection; } finally { clearTimeout(timer); }
  assert.equal(calls, 1);
});

test('INT-03: staging preserves bytes, bounds lazy cache, detects missing files, and is private', async () => {
  const stage = await budgetLib.createImageStaging();
  try {
    const a = image(1234), b = image(5678, 4);
    const first = await stage.write(a), second = await stage.write(b);
    // Windows ACLs do not expose POSIX mode bits. Byte/cache/error assertions
    // below still run there; permissions are checked on POSIX hosts.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.dirname(first.file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
    }
    const entry = stage.entry({}, first);
    assert.deepEqual(entry.buffer, a.buffer);
    assert.equal(entry.buffer, entry.buffer);
    assert.deepEqual(stage.entry({}, second).buffer, b.buffer);
    fs.unlinkSync(first.file);
    assert.throws(() => entry.buffer, { code: 'ENOENT' });
    await assert.rejects(stage.write(image(21 * MiB)), { code: 'PLM_IMAGE_TOO_LARGE' });
  } finally { await stage.close(); }
});

test('INT-03: reservation copy envelope follows canonical maximum original size', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/user-data.js'), 'utf8');
  assert.match(source, /const RAW_COLLECTION_IMAGE_MAX_BYTES = 50 \* 1024 \* 1024/);
  const copies = 2 * budgetLib.IMAGE_BYTES + 50 * MiB + Math.ceil(budgetLib.IMAGE_BYTES / 3) * 4 * 2 + 3 * budgetLib.IMAGE_BYTES;
  assert.ok(copies <= budgetLib.COMMIT_BYTES);
});

test('INT-03: staging write failure remains partial and releases permits', async () => {
  const write = fs.promises.writeFile;
  let failed = false;
  fs.promises.writeFile = async (file, ...args) => {
    if (!failed && String(file).includes('buyerlog-plm-int03-')) {
      failed = true;
      throw Object.assign(new Error('synthetic staging disk full'), { code: 'ENOSPC' });
    }
    return write.call(fs.promises, file, ...args);
  };
  try {
    const live = canonical();
    const result = await service.runPlmImageSync({ ...inputFor(3, live.ingest, async () => image(1024)), ...live.state() });
    assert.equal(result.status, 'partial');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].code, 'ENOSPC');
    assert.equal(result.outcomes.length, 2);
    assert.equal(budgetLib.imageByteBudget.snapshot().used, 0);
  } finally { fs.promises.writeFile = write; }
});
