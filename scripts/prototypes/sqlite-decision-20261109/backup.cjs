'use strict';
// Isolated offline/quiescent backup lower bound; NOT production backup protocol.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { open } = require('./adapters.cjs');
const { projection, hash } = require('./workload.cjs');
async function backupRestore(db, engine, folder, expected) {
  // Checkpoint SQLite while no writer exists. JSON has already compacted.
  if (engine === 'sqlite') db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = await fs.mkdtemp(path.join(path.dirname(folder), 'backup-'));
  const restored = await fs.mkdtemp(path.join(path.dirname(folder), 'restore-'));
  const started = performance.now(), manifest = [];
  try {
    for (const name of (await fs.readdir(folder)).sort()) {
      // Leases are runtime ownership, never portable backup state.
      if (!/^(BuyerLogLocal\.db($|\.bak$|\.wal($|\.)|\.compacting$)|prototype\.sqlite($|-wal$))/.test(name)) continue;
      const source = path.join(folder,name), dest = path.join(backup,name);
      const st = await fs.stat(source); if (!st.isFile()) continue;
      await fs.copyFile(source,dest);
      const h=await fs.open(dest,'r+'); try { await h.sync(); } finally { await h.close(); }
      manifest.push({name,bytes:st.size,sha256:crypto.createHash('sha256').update(await fs.readFile(dest)).digest('hex')});
    }
    await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest));
    const manifestHandle = await fs.open(path.join(backup,'manifest.json'),'r+');
    try { await manifestHandle.sync(); } finally { await manifestHandle.close(); }
    const dir = await fs.open(backup,'r'); try { await dir.sync(); } finally { await dir.close(); }
    const backupMs=performance.now()-started;
    const restoreStart=performance.now();
    for(const f of manifest) {
      const bytes=await fs.readFile(path.join(backup,f.name));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.sha256);
      await fs.writeFile(path.join(restored,f.name),bytes);
    }
    const copyRestoreMs=performance.now()-restoreStart;
    const restoredDb=open(engine,restored); await restoredDb.ensure();
    try {
      assert.equal(hash(projection(await restoredDb.records())),expected,'Backup business oracle');
      assert.deepEqual(await restoredDb.eventIds(), await db.eventIds(),'Backup event identity');
      assert.deepEqual(await restoredDb.counts(), await db.counts(),'Backup counts');
      assert.equal(await restoredDb.pendingCount(),await db.pendingCount(),'Backup pending');
      if(engine==='sqlite') assert.equal(restoredDb.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    } finally { restoredDb.close(); }
    return {mode:'quiescent-full-family-copy-fsync-manifest',backupMs,copyRestoreMs,
      restoreReadyVerifyMs:performance.now()-restoreStart,bytes:manifest.reduce((n,f)=>n+f.bytes,0),manifest,
      businessAndEventIdentityRestored:true,productionBackupParity:false};
  } finally { await fs.rm(backup,{recursive:true,force:true}); await fs.rm(restored,{recursive:true,force:true}); }
}
module.exports={backupRestore};
