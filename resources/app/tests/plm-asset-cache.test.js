'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
test('normal PLM sync skips usable existing images unless force/rebuild is requested',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
  assert.match(src,/plmImageUsable/); assert.match(src,/forceImages|rebuildImageCache/); assert.match(src,/needImage/);
  assert.doesNotMatch(src,/Sync Now[^\n]{0,120}full image rebuild/i);
});
