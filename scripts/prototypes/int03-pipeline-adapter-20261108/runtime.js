'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { helper } = require('./pinned');
const B = 20 * 1024 * 1024; // Existing downloader acceptance cap, unchanged.
const OLD = 50 * 1024 * 1024; // Existing collection-image acceptance cap.
const IO = 1024 * 1024; // Contract: bounded stream/TLS/scratch overhead per admission.
const envelope = Object.freeze({ maxImageBytes: B, validationCopyBytes: 0,
  commitCopyBytes: 2 * (4 * Math.ceil(B / 3)) + B + OLD + IO });
const envelopeBytes = helper.planImageReservation(envelope).totalBytes;
function cancelled() { return Object.assign(new Error('Synthetic job cancelled'), { code: 'PLM_JOB_CANCELLED' }); }
function error(code) { return Object.assign(new Error(code), { code }); }
function createRuntime({ directory, limitBytes = envelopeBytes * 2, stageLimitBytes = 512 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(stageLimitBytes) || stageLimitBytes < B) throw error('INT03_STAGE_CONFIG');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const budget = helper.createByteBudget({ limitBytes });
  let stagedBytes = 0, peakStagedBytes = 0, buffers = 0, peakBuffers = 0;
  let tail = Promise.resolve();
  const scopes = new Set();
  const events = [];
  function event(name, detail = {}) { if (events.length < 12000) events.push({ name, ...detail, ...budget.snapshot(), buffers, stagedBytes }); }
  function buffer(delta) { buffers += delta; peakBuffers = Math.max(peakBuffers, buffers); }
  function scope() {
    const dir = fs.mkdtempSync(path.join(directory, 'stage-'));
    const files = new Map();
    scopes.add(dir);
    return {
      async stage(image) {
        const bytes = image.buffer.length;
        // A full spool fails closed; it never waits for the job's own final commit.
        if (bytes + stagedBytes > stageLimitBytes) throw error('INT03_STAGE_QUOTA');
        const file = path.join(dir, crypto.randomUUID());
        stagedBytes += bytes; peakStagedBytes = Math.max(peakStagedBytes, stagedBytes);
        files.set(file, bytes);
        try {
          const fd = await fs.promises.open(file, 'wx', 0o600);
          try { await fd.writeFile(image.buffer); await fd.sync(); } finally { await fd.close(); }
          event('staged', { bytes });
          return Object.freeze({ file, bytes, mimeType: image.mimeType });
        } catch (e) { throw e; } // Scope cleanup owns even partially written files.
      },
      read(handle) {
        if (!files.has(handle.file) || files.get(handle.file) !== handle.bytes) throw error('INT03_STAGE_HANDLE');
        const stat = fs.statSync(handle.file);
        if (!stat.isFile() || stat.size !== handle.bytes || stat.size > B) throw error('INT03_STAGE_SIZE');
        return fs.readFileSync(handle.file);
      },
      close() {
        fs.rmSync(dir, { recursive: true });
        for (const size of files.values()) stagedBytes -= size;
        files.clear(); scopes.delete(dir); event('scope-closed');
      },
    };
  }
  async function serialCommit(work) {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    try { return await work(); } finally { unlock(); }
  }
  return { budget, scope, serialCommit, envelope, envelopeBytes, event, buffer, events,
    async withEntry(entry, read, work) {
      // No permit is held while waiting for admission or the commit serializer.
      return budget.withImage(envelope, async permit => {
        let bytes;
        try {
          bytes = read(entry.stage); buffer(1); event('commit-read');
          return await work(bytes, permit);
        } finally { if (bytes) buffer(-1); bytes = null; event('commit-dropped'); }
      });
    },
    snapshot() { return { ...budget.snapshot(), stagedBytes, peakStagedBytes, buffers, peakBuffers, scopes: scopes.size }; },
  };
}
module.exports = { createRuntime, envelope, envelopeBytes, B, OLD, IO, error, cancelled };
