'use strict';

// Test-only transport and commit. No network, disk, ownership or revision API.
const assert = require('node:assert/strict');
const { png, hash } = require('./plm-image-memory-fixture');
const tick = () => new Promise(resolve => setImmediate(resolve));

function gate() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function image(budget, item, options = {}) {
  return budget.withImage({
    contentLength: options.unknown ? undefined : item.size,
    maxImageBytes: options.maxImageBytes || item.size,
    validationCopyBytes: item.size,
    commitCopyBytes: item.size,
    signal: options.signal,
  }, async permit => {
    let source, body, validationCopy, commitCopy;
    try {
      options.onStage?.('download', permit);
      options.signal?.throwIfAborted();
      if (options.fail === 'download') throw new Error('synthetic download failure');
      source = png(item.size, item.contentTag);
      const length = options.bodySize ?? source.length;
      // In production this check must precede chunk retention; this fake has
      // no socket buffers. Fixture generation scratch is outside this model.
      permit.checkBodySize(length);
      body = Buffer.concat([source.subarray(0, length)], length);
      permit.checkBodySize(length, { complete: true });
      source = null;
      options.onStage?.('validation', permit);
      validationCopy = Buffer.from(body);
      await tick();
      assert.ok(validationCopy.equals(body));
      options.signal?.throwIfAborted();
      if (options.fail === 'validation') throw new Error('synthetic validation failure');
      validationCopy = null;
      options.onStage?.('commit-wait', permit);
      if (options.beforeCommit) await options.beforeCommit;
      options.signal?.throwIfAborted();
      commitCopy = Buffer.from(body);
      options.onStage?.('commit', permit);
      if (options.commit) await (typeof options.commit === 'function' ? options.commit() : options.commit);
      if (options.fail === 'commit') throw new Error('synthetic commit failure');
      return { size: body.length, hash: hash(body), id: item.plmId };
    } finally {
      // Drop every modeled Buffer before withImage refunds the reservation.
      source = body = validationCopy = commitCopy = null;
      options.onStage?.('dropped', permit);
    }
  });
}

module.exports = { image, gate, tick };
