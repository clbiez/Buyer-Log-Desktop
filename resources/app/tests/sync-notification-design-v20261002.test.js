'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,'public',name),'utf8');

test('sync runtime uses Buyer Log standard edge notification instead of custom popup',()=>{
  const sync=read('plm-sync-guide.js');
  const css=read('plm-sync-guide.css');
  assert.match(sync,/window\.showToast\(message,\{kind:'info'/);
  assert.match(sync,/kindLabel:t\('BİLGİLENDİRME','INFORMATION'\)/);
  assert.match(sync,/close\.update\?\./);
  assert.match(sync,/if\(watched\)panel=progressFor\(path,usesBrowser\(path,init\)\)/);
  assert.doesNotMatch(sync,/blSyncGuideProgress/);
  assert.doesNotMatch(css,/\.blSyncGuideProgress/);
});

test('standard notification supports in-place state updates',()=>{
  const ui=read('ui-primitives.js');
  assert.match(ui,/const update=\(nextMessage,nextOptions=\{\}\)=>/);
  assert.match(ui,/close\.update=update/);
  assert.match(ui,/liveOptions=\{\.\.\.liveOptions,\.\.\.nextOptions\}/);
  assert.match(ui,/data-ui-feedback-close/);
});

test('edge notification stack reserves space above PLM operations strip',()=>{
  const ops=read('plm-operations.js');
  const experience=read('experience.css');
  assert.match(ops,/--plm-ops-strip-offset/);
  assert.match(ops,/getBoundingClientRect\(\)\.height/);
  assert.match(experience,/bottom:calc\(18px \+ var\(--plm-ops-strip-offset,0px\)\)/);
});

test('sync guide assets are normal HTML tags, not literal escaped newlines',()=>{
  const index=read('index.html');
  assert.doesNotMatch(index,/buyerlog-guide\.js[^\n]*<\/script>\\n<link rel="stylesheet" href="plm-sync-guide\.css/);
  assert.match(index,/plm-sync-guide\.css\?v=__BL_ASSET_VERSION__&rev=2/);
  assert.match(index,/plm-sync-guide\.js\?v=__BL_ASSET_VERSION__&rev=2/);
});
