'use strict';
const fs = require('node:fs/promises');
const { createLocalDb } = require('../../server/lib/local-db');
const { createCollectionDeltaService } = require('../../server/lib/collection-delta-commit');
const [file, point] = process.argv.slice(2);
const original = fs.open;
const gate = async () => { process.send(point); await new Promise(() => {}); };
fs.open = async (target, flags, ...args) => {
  const handle = await original(target, flags, ...args);
  if (target !== file + '.wal' || flags !== 'a') return handle;
  return {
    close: handle.close.bind(handle),
    writeFile: async (...input) => { if (point === 'before-write') await gate(); return handle.writeFile(...input); },
    sync: async () => { await handle.sync(); if (point === 'after-sync') await gate(); },
  };
};
const service = createCollectionDeltaService({ db: createLocalDb(file), actorId: 'editor', assertAuthority: context => ({ ownerId: context.ownerId, sourceGeneration: 7, canView: true, canEdit: true }) });
service.commit({ version: 1, namespace: 'collection-workspaces', ownerId: 'alice', sourceGeneration: 7, baseStructureRevision: 10, transactionId: 'crash', mode: 'row-cas-v1', patches: [{ rowId: '1', field: 'cx_a', baseRowRevision: 0, base: { present: true, value: 'base' }, incoming: { present: true, value: 'crashed' } }] }).catch(error => { console.error(error); process.exitCode = 1; process.disconnect(); });
