'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const PS=fs.readFileSync(path.join(ROOT,'server','lib','OpenBuyerLogManaged.ps1'),'utf8');
const CONNECTOR=fs.readFileSync(path.join(ROOT,'server','lib','agent-browser-connector.js'),'utf8');

test('v5.58 managed Edge native-quotes portable profile and startup URL arguments',()=>{
  assert.match(PS,/function Quote-NativeArgument/);
  assert.match(PS,/\$profileArg\s*=\s*'--user-data-dir='\s*\+\s*\(Quote-NativeArgument \$ProfileDir\)/);
  assert.match(PS,/\$urlArg\s*=\s*Quote-NativeArgument \$Url/);
  assert.doesNotMatch(PS,/"--user-data-dir=\$ProfileDir"/);
});

test('v5.58 startup cleans only the characteristic legacy malformed-tab group',()=>{
  assert.match(PS,/function Close-LegacyMalformedTabs/);
  for(const token of ['log','beta','chatgpt','agent'])assert.ok(PS.includes(token),token);
  assert.match(PS,/\$legacy\.Count -lt 3/,'a lone similarly named intranet tab must not be closed');
  assert.match(PS,/\/json\/close\//);
  assert.match(PS,/Close-LegacyMalformedTabs[\s\S]*Open-CdpTab/);
});

test('connector never launches a managed Edge (v10.14: legacy .bat kaldırıldı, bağlayıcı iddiaları korundu)',()=>{
  assert.match(CONNECTOR,/function managedCdpPort\(\)/);
  assert.match(CONNECTOR,/function managedProfileDir\(\)/);
  assert.doesNotMatch(CONNECTOR,/async function launchManagedEdge/);
  assert.match(CONNECTOR,/function managedFallbackEnabled\(\) \{ return false; \}/);
});
