'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const browser=require('../server/lib/agent-browser-connector');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');
const ENGINE=fs.readFileSync(path.join(ROOT,'server','lib','portable-web-engine.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const AUTO=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');

test('v5.64 reads the active CDP endpoint from the normal Edge user-data directory',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bl-edge-'));
  fs.writeFileSync(path.join(dir,'DevToolsActivePort'),'9333\n/devtools/browser/test-id\n','utf8');
  assert.deepEqual(browser.readDevToolsActivePort(dir),{port:9333,browserPath:'/devtools/browser/test-id',userDataDir:dir});
  fs.rmSync(dir,{recursive:true,force:true});
});

test('existing Edge profile is required and managed-profile fallback is disabled',()=>{
  assert.match(CONNECTOR,/async function connectExistingEdge/);
  assert.match(CONNECTOR,/function managedFallbackEnabled\(\) \{ return false; \}/);
  assert.doesNotMatch(CONNECTOR,/BL_ALLOW_MANAGED_EDGE_FALLBACK/);
  assert.match(CONNECTOR,/BROWSER_INTEGRATION_NOT_READY/);
  assert.match(CONNECTOR,/connectPreferredEdge/);
  assert.doesNotMatch(CONNECTOR,/if \(port && await cdpReady\(port\)\) return \{ endpoint:`http:\/\/127\.0\.0\.1:\$\{port\}`/);
});

test('v5.64 opens automation tabs from the Buyer Log tab so the Edge profile is preserved',()=>{
  assert.match(ENGINE,/async newPageFrom\(referencePage, url = 'about:blank'\)/);
  assert.match(ENGINE,/window\.open/);
  assert.match(CONNECTOR,/pageForCurrentBuyerLogProfile/);
  assert.match(CONNECTOR,/context\.newPageFrom\(buyerLogPage/);
  assert.match(CONNECTOR,/await pageForCurrentBuyerLogProfile\(context,target\.href\)/);
});

test('v5.64 recorder instrumentation is limited to recorded tabs, not every existing Edge tab',()=>{
  assert.match(CONNECTOR,/async function installRecorderOnPage/);
  assert.doesNotMatch(CONNECTOR,/context\.addInitScript\(recorderInstaller\)/);
  assert.match(CONNECTOR,/rec\.targetIds\.has\(page\.openerId\)/);
  assert.match(CONNECTOR,/installRecorderOnPage\(page\)/);
});

/* v6.36: Agent arayüzü kaldırıldı; kurulum akışı yalnız Automations'ta yaşıyor. */
test('v5.64 no-code setup is available from Automation browser settings',()=>{
  for(const route of ['/api/automations/browser/status','/api/automations/browser/prepare-existing-edge']) assert.ok(SERVER.includes(route),route);
  for(const ui of [AUTO]){
    assert.match(ui,/Mevcut Edge profilini bağla/);
    assert.match(ui,/Bağlantıyı kontrol et/);
    assert.match(ui,/Allow remote debugging for this browser instance/);
  }
  // v5.88: #devices yerine doğrudan ilgili sayfa açılır — kullanıcılar soldaki
  // "Remote debugging" bölümüne geçmesi gerektiğini fark etmiyordu.
  assert.match(CONNECTOR,/edge:\/\/inspect\/#remote-debugging/);
  assert.doesNotMatch(CONNECTOR,/edge:\/\/inspect\/#devices/);
  // Kutu hiç yoksa ne yapılacağı da söylenmeli (eski Edge sürümü).
  assert.match(CONNECTOR,/Microsoft Edge hakkında/);
});
