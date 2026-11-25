'use strict';
// Fresh process storage proof: imports SQL adapter directly, never control DB.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {sqlite}=require('./sqlite-compat.cjs');
const db=sqlite(process.argv[2]);
try {
  assert(!Object.keys(require.cache).some(p=>p.endsWith('/local-db.js')));
  assert.equal(db.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  fs.writeFileSync(process.argv[3],JSON.stringify(db.read()));
} finally {db.close();}
