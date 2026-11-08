'use strict';
// The nine #895 tests and all five future client contracts are retained verbatim.
require('./fixtures/ana12-request-lifecycle/preparation/diagnose.test.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const root=__dirname+'/fixtures/ana12-request-lifecycle/preparation/';
const provenance=require('./fixtures/ana12-request-lifecycle/preparation/provenance.json');
test('inherited assertions and fixture remain byte-identical to pinned #895 inputs',()=>{
  for(const name of ['contracts.cjs','diagnose.test.cjs','fixture.json']){
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root+name)).digest('hex'),provenance.originalSha256[name],name);
  }
});
