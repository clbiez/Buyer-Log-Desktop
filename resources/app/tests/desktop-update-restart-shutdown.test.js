'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const MAIN=fs.readFileSync(path.join(__dirname,'../electron/main.js'),'utf8');
const {createAgentOfficeBackground}=require('../electron/agent-office-background');

test('an update restart is a real quit even while tray background monitoring hides closed windows',()=>{
  // Field report: "Restart" after an update only hid the window in tray mode, so
  // the app neither exited nor relaunched and stayed in Task Manager.
  assert.match(MAIN,/isQuitting:\(\)=>quitting\|\|restarting\|\|updateRelaunchRequested/);
  let updateRelaunchRequested=false;const app=new EventEmitter();app.quit=()=>{};
  class Win extends EventEmitter{hide(){this.hidden=true;}show(){}isMinimized(){return false;}focus(){}}
  const win=new Win();
  const runtime=createAgentOfficeBackground({app,BrowserWindow:{getAllWindows:()=>[win]},Tray:class{setToolTip(){}on(){}setContextMenu(){}destroy(){}},Menu:{buildFromTemplate:x=>x},Notification:class{static isSupported(){return false;}},icon:'i',isAppWindow:()=>true,isQuitting:()=>updateRelaunchRequested});
  runtime.set(true,'tr');
  let prevented=0;win.emit('close',{preventDefault:()=>prevented++});assert.equal(prevented,1,'ordinary close still hides to tray');
  updateRelaunchRequested=true;win.hidden=false;win.emit('close',{preventDefault:()=>prevented++});
  assert.equal(prevented,1,'update restart close is not swallowed');assert.notEqual(win.hidden,true);
  runtime.dispose();
});

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
