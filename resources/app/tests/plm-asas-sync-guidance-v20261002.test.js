'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(ROOT,'public',name),'utf8');

test('PLM/ASAS senkron rehberi tarayıcı ön koşulunu ve kalıcı tercihi içerir',()=>{
  const ui=read('plm-sync-guide.js');
  assert.match(ui,/buyerlog\.syncGuide\.dismissed\.v1/);
  assert.match(ui,/\/api\/browser-debug\/status/);
  assert.match(ui,/connectionState==='READY'/);
  assert.match(ui,/edge:\/\/inspect\/#devices/);
  assert.match(ui,/chrome:\/\/inspect\/#devices/);
  assert.match(ui,/Allow Remote Debugging/);
  assert.match(ui,/data-syncguide-never/);
  assert.match(ui,/data-plm-sync-category/);
  assert.match(ui,/import-asas/);
  assert.match(ui,/import-plm/);
});

test('rehber uygulama kabuğunda yüklenir ve stil dosyası bağlıdır',()=>{
  const index=read('index.html');
  assert.match(index,/plm-sync-guide\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(index,/plm-sync-guide\.js\?v=__BL_ASSET_VERSION__/);
});
