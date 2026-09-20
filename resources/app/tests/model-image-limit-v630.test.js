'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');

test('v6.30 Source Data Settings exposes a manual KB image limit',()=>{
  // v7.81: Veri Yönetimi → Araçlar → Depolama ve bakım.
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'imagelimit'/);
  assert.match(DM_UI, /openModelImageLimitModal\(\)/);
  assert.match(APP,/id="_modelImageLimitInput" type="number" min="1" max="1024"/);
  assert.match(APP,/fetch\('\/api\/model-images\/settings',\{method:'PUT'/);
  assert.match(SERVER,/app\.put\('\/api\/model-images\/settings', userAccess\.requireArea\('source'\)/);
});

test('v6.30 persisted image limit drives browser and server image storage',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-image-limit-'));
  const old=process.env.BUYER_LOG_LOCAL_DATA_ROOT;
  process.env.BUYER_LOG_LOCAL_DATA_ROOT=temp;
  const modulePath=require.resolve('../server/user-data');delete require.cache[modulePath];
  const data=require('../server/user-data');
  try{
    assert.equal(data.getModelImageSettings().maxKb,5);
    assert.equal(data.saveModelImageSettings({maxKb:17}).maxBytes,17*1024);
    assert.equal(data.getModelImageSettings().maxKb,17);
  }finally{
    delete require.cache[modulePath];
    if(old==null)delete process.env.BUYER_LOG_LOCAL_DATA_ROOT;else process.env.BUYER_LOG_LOCAL_DATA_ROOT=old;
    fs.rmSync(temp,{recursive:true,force:true});
  }
  assert.match(SERVER,/collectCoreNectumStyleLinks\(req\.currentUser\.id,items,\{\s*\.\.\.getModelImageSettings\(\),\s*onProgress:/);
  // v9.53: degisken adi degisti; korunan sey kalici sinirin optimize'a gecirilmesi.
  // v11.00: ayri coreNectumOptimizeImage turu kaldirildi; sinir artik indirme
  // ve optimize'i tek ifadede yapan toplu hatta maxBytes olarak geciyor.
  assert.match(CONNECTOR,/coreNectumBulkImages\(page,capture,imageRecords,6,\{[^}]*maxBytes:imageMaxBytes\}/);
});
