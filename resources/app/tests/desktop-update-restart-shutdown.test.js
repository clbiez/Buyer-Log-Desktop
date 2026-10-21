'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const MAIN=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');



test('shutdown cannot hang on a busy backend: bounded bridge request and a hard exit deadline',()=>{
  const clear=MAIN.slice(MAIN.indexOf('async function clearOabBackendAuthorization'),MAIN.indexOf('function oabAuthSelectionValue'));
  assert.match(clear,/signal:\s*AbortSignal\.timeout\(\d+\)/);
  const quit=MAIN.slice(MAIN.indexOf("app.on('before-quit'"),MAIN.indexOf('app.whenReady()'));
  assert.match(quit,/Promise\.race\(\[shutdown\(\),/);
  assert.match(quit,/SHUTDOWN_DEADLINE_MS/);
  assert.match(quit,/app\.exit\(0\)/);
  const deadline=Number((MAIN.match(/const SHUTDOWN_DEADLINE_MS\s*=\s*(\d+)/)||[])[1]);
  // Must outlast the bounded backend stop (6 s graceful + 10 s taskkill) so the tree is not orphaned.
  assert.ok(deadline>=17000&&deadline<=30000,`deadline ${deadline}`);
});
