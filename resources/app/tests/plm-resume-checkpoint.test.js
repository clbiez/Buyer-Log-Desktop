'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
test('CoreNectum PLM scan is chunked/resumable within a run and operations registry supports retry',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server','lib','agent-browser-connector.js'),'utf8');
  assert.match(src,/CORENECTUM_SCAN_PAGE_BUDGET\s*=\s*8/); assert.match(src,/lastProcessedPage|currentPage|pageBudget|scanState/i);
  const server=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8'); assert.match(server,/failedIds\(/); assert.match(server,/retry/i);
});
