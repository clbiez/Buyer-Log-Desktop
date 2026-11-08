'use strict';
const fs = require('node:fs');
const { cancelled, error, OLD } = require('./runtime');
const queue = require('./plm-image-download-queue.candidate');
const service = require('./plm-image-sync-service.candidate');
const ingestLib = require('./plm-image-ingest.candidate');
function createIngest(deps) {
  return ingestLib.createPlmImageIngest({ ...deps,
    readImageBytes(found) {
      // Collection images accept up to 50 MiB, wider than the PLM downloader.
      // Bound before allocation. Root needs a stable handle/size guarantee too.
      const fd = fs.openSync(found.full, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size > OLD) throw error('INT03_OLD_IMAGE_LIMIT');
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const n = fs.readSync(fd, bytes, offset, size - offset, offset);
          if (!n) throw error('INT03_OLD_IMAGE_CHANGED');
          offset += n;
        }
        if (fs.fstatSync(fd).size !== size) throw error('INT03_OLD_IMAGE_CHANGED');
        return bytes;
      } finally { fs.closeSync(fd); }
    },
  });
}
async function run(input, runtime) {
  if (!runtime || !input.transport || !input.snapshot) throw error('INT03_ADAPTER_CONTRACT');
  const scope = runtime.scope();
  const isCancelled = () => Boolean(input.signal?.aborted || input.isCancelled?.());
  let downloadsActive = 0;
  const pipeline = {
    async downloadAndStage(url) {
      try {
        return await runtime.budget.withImage({ ...runtime.envelope, signal: input.signal }, async permit => {
          let image = null, active = false;
          try {
            if (isCancelled()) throw cancelled();
            downloadsActive++; active = true; runtime.event('transport-admitted');
            image = await queue.downloadImage(url, { ...input.downloadOptions,
              signal: input.signal, isCancelled, permit, runtime, transport: input.transport,
            });
            runtime.buffer(1); runtime.event('download-validated');
            // Stage writes and fsync settle before releasing the Buffer permit.
            const stage = await scope.stage(image);
            return { stage, size: image.size, mimeType: image.mimeType, attempts: image.attempts };
          } finally {
            if (image) runtime.buffer(-1);
            image = null; if (active) downloadsActive--; runtime.event('download-dropped');
          }
        });
      } catch (e) {
        if (e.code === 'PLM_IMAGE_BUDGET_CANCELLED') throw cancelled();
        throw e;
      }
    },
    async commit(ingest, entries, options) {
      return runtime.serialCommit(async () => {
        runtime.event('canonical-begin');
        const result = await ingest.commitStaged(entries, options, {
          snapshot: input.snapshot,
          withEntry: (entry, work) => runtime.withEntry(entry, h => scope.read(h), async buffer => {
            // A non-interruptible consumer keeps admission until it really settles.
            if (input.beforeCommitEntry) await input.beforeCommitEntry(entry);
            return work(buffer);
          }),
        });
        runtime.event('canonical-end');
        return result;
      });
    },
  };
  try {
    return await service.runPlmImageSync({ ...input, isCancelled, pipeline,
      // Retain the service's required downloader contract; pipeline owns bytes.
      downloadImage: queue.downloadImage });
  } finally {
    if (downloadsActive !== 0) throw error('INT03_UNSETTLED_DOWNLOADS');
    scope.close();
  }
}
module.exports = { run, createIngest };
