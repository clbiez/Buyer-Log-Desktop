'use strict';
// Observation only. Keep returned promises and errors intact. Logs are buffered
// in RAM; method wrappers still affect scheduling, allocation and runtime cost.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function install(record, config) {
  const within = candidate => typeof candidate === 'string' && candidate.startsWith(path.dirname(config.file) + path.sep);
  const ownerPath = path.join(config.file + '.write-lock', 'owner.json');
  const value = data => {
    try { const o = JSON.parse(String(data));
      if (!o.token && !o.generation) return undefined;
      return { token: o.token, generation: o.generation, instanceId: o.instanceId, pid: o.pid,
        threadId: o.threadId, createdAt: o.createdAt, renewedAt: o.renewedAt, expiresAt: o.expiresAt };
    } catch { return undefined; }
  };
  const errorDetail = error => ({ code: error.code, message: error.message });
  let serial = 0;
  const observe = (p, event, detail, success) => {
    p.then(result => { record(event + ':ok', { ...detail, ...(success?.(result) || {}) }); },
      error => record(event + ':error', { ...detail, ...errorDetail(error) }));
    return p;
  };
  const wrapHandle = (h, file) => {
    for (const method of ['writeFile', 'sync', 'close']) {
      const original = h[method].bind(h);
      h[method] = (...args) => {
        const detail = { io: ++serial, file, fd: h.fd, method,
          ...(method === 'writeFile' ? { bytes: Buffer.byteLength(args[0]), metadata: value(args[0]) } : {}) };
        record('handle:begin', detail);
        try { return observe(original(...args), 'handle', detail); }
        catch (error) { record('handle:error', { ...detail, ...errorDetail(error) }); throw error; }
      };
    }
    return h;
  };
  for (const method of ['open', 'readFile', 'writeFile', 'rename', 'unlink', 'mkdir', 'rmdir']) {
    const original = fsp[method].bind(fsp);
    fsp[method] = (...args) => {
      if (!within(args[0]) && !within(args[1])) return original(...args);
      const detail = { io: ++serial, method, file: String(args[0]),
        ...(method === 'rename' ? { destination: String(args[1]) } : {}),
        ...(method === 'open' ? { flags: args[1] } : {}),
        ...(method === 'writeFile' && args[0] === ownerPath ? { metadata: value(args[1]) } : {}) };
      record('io:begin', detail);
      try { return observe(original(...args), 'io', detail, result => {
        if (method === 'open') { wrapHandle(result, String(args[0])); return { fd: result.fd }; }
        if (method === 'readFile' && args[0] === ownerPath) return { metadata: value(result),
          rawHash: crypto.createHash('sha256').update(result).digest('hex') };
      }); } catch (error) { record('io:error', { ...detail, ...errorDetail(error) }); throw error; }
    };
  }
  const readSync = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (file !== ownerPath) return readSync.call(this, file, ...args);
    try { const result = readSync.call(this, file, ...args); record('owner:sync-read', { file, metadata: value(result) }); return result; }
    catch (error) { record('owner:sync-read:error', { file, ...errorDetail(error) }); throw error; }
  };
  const log = console.log;
  console.log = (...args) => { if (String(args[0]).startsWith('[LEASE]')) record('lease:log', { text: args.join(' ') }); return log(...args); };
  const leaseModule = require('../../../resources/app/server/lib/shared-file-transaction');
  const original = leaseModule.withFileLeaseAsync;
  let scope = 0;
  leaseModule.withFileLeaseAsync = (file, operation, ...settings) => {
    const id = ++scope;
    record('lease:requested', { scope: id, file });
    const result = original(file, lease => {
      const identity = { scope: id, token: lease.token, generation: lease.generation, file };
      record('lease:acquired', identity);
      for (const method of ['assertOwned', 'assertOwnedAsync', 'renew', 'finishOperation', 'drainRenewal']) {
        const originalMethod = lease[method].bind(lease);
        lease[method] = (...args) => {
          const detail = { ...identity, method, call: ++serial };
          record('lease:method:begin', detail);
          try {
            const p = originalMethod(...args);
            if (p?.then) return observe(p, 'lease:method', detail);
            record('lease:method:ok', detail); return p;
          } catch (error) { record('lease:method:error', { ...detail, ...errorDetail(error) }); throw error; }
        };
      }
      record('callback:begin', identity);
      try {
        const p = operation(lease);
        if (p?.then) return observe(p, 'callback', identity);
        record('callback:ok', identity); return p;
      } catch (error) { record('callback:error', { ...identity, ...errorDetail(error) }); throw error; }
    }, ...settings);
    return observe(result, 'lease:released', { scope: id, file });
  };
  record('instrumentation', { mode: 'observational', buffered: true,
    limitations: 'Additional callbacks/allocations/JSON parsing affect timing; not a transparent measurement. No TTL/heartbeat/timeout changes.' });
}
module.exports = { install };
