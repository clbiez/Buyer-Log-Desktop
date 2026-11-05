'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {createStartupTransition}=require('../electron/startup-transition');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function sender(capture){
  return Object.assign(new EventEmitter(),{isDestroyed:()=>false,capturePage:capture||asyncImage});
}
async function asyncImage(){return {isEmpty:()=>false,getSize:()=>({width:8,height:4}),toBitmap:()=>Buffer.alloc(128)};}

test('login frame is one-shot, belongs to its own window, expires and releases destruction listeners',async()=>{
  let clock=0;const vault=createStartupTransition({now:()=>clock,ttlMs:1000}),a=sender(),b=sender();
  assert.equal(await vault.prepare(a,8,4),true);
  assert.equal(vault.take(b),null);
  assert.equal(vault.take(a).bgra.length,128);
  assert.equal(vault.take(a),null);
  assert.equal(a.listenerCount('destroyed'),0);
  await vault.prepare(a,8,4);clock=1001;assert.equal(vault.take(a),null);
  await vault.prepare(a,8,4);a.emit('destroyed');assert.equal(vault.take(a),null);
});
test('invalid sizes, failed capture and a hanging capture do not retain a frame or block login',async()=>{
  const vault=createStartupTransition({captureTimeoutMs:5});
  for(const [w,h] of [[0,4],[8193,4],[8192,8192]])assert.equal(await vault.prepare(sender(),w,h),false);
  for(const capture of [async()=>{throw Error('capture');},()=>new Promise(()=>{})]){
    const a=sender(capture);assert.equal(await vault.prepare(a,8,4),false);assert.equal(vault.take(a),null);assert.equal(a.listenerCount('destroyed'),0);
  }
});
test('a superseded or already-consumed pending capture never recreates a frame',async()=>{
  const pending=[];const a=sender(()=>new Promise(resolve=>pending.push(resolve))),vault=createStartupTransition();
  const first=vault.prepare(a,8,4),second=vault.prepare(a,8,4);
  pending[1](await asyncImage());assert.equal(await second,true);
  pending[0](await asyncImage());assert.equal(await first,false);
  assert.ok(vault.take(a));assert.equal(vault.take(a),null);
  const third=vault.prepare(a,8,4);assert.equal(vault.take(a),null);
  pending[2](await asyncImage());assert.equal(await third,false);assert.equal(vault.take(a),null);
});
function motion({reduced=false,hidden=false,off=false,software=false}={}){
  const calls=[],doc={readyState:'loading',visibilityState:hidden?'hidden':'visible',body:{dataset:{}},documentElement:{dataset:{blMotion:off?'off':'on',blRender:software?'software':'gpu'}},addEventListener(){},getElementById:()=>({dataset:{}})};
  const root={document:doc,innerWidth:8,innerHeight:4,matchMedia:()=>({matches:reduced}),setTimeout,clearTimeout,BLMotionPlusTheme:{run:(...args)=>{calls.push(args);return true;}},buyerLogDesktop:{takeStartupTransition:async()=>({width:8,height:4,bgra:[]})}};
  vm.runInNewContext(read('public/motion-plus.js'),{window:root});
  return {root,doc,calls,api:root.BLMotionPlus};
}
test('both startup transitions force the shared chain renderer; all motion guards bypass it',async()=>{
  const s=motion(),update=()=>{};
  assert.equal(s.api.startup(update),true);assert.equal(s.calls[0][0],update);assert.equal(s.calls[0][2].startup,true);
  await s.api.arrive();assert.equal(s.calls.length,2);assert.equal(s.calls[1][2].shot.width,8);
  for(const config of [{reduced:true},{hidden:true},{off:true},{software:true}]){
    const s=motion(config);assert.equal(s.api.startup(update),false);await s.api.arrive();assert.equal(s.calls.length,0);
  }
});
test('a late login frame cannot cover a startup curtain that is being dismissed',async()=>{
  const s=motion();let resolve;
  s.root.buyerLogDesktop.takeStartupTransition=()=>new Promise(r=>resolve=r);
  const arrive=s.api.arrive();s.api.startup(()=>{});resolve({width:8,height:4});await arrive;
  assert.equal(s.calls.length,1);
});
test('login clears revealed credentials before capture; startup captures before removing the real trivia screen',()=>{
  const login=read('public/select-user.html'),start=login.indexOf('// Clear even a revealed password'),tail=login.slice(start);
  assert.ok(tail.indexOf("$('password').value = ''")<tail.indexOf('prepareNavigation'));
  assert.ok(tail.indexOf('prepareNavigation')<tail.indexOf("location.replace('/')"));
  assert.doesNotMatch(tail.slice(0,tail.indexOf('return;')),/blLeaving|280/);
  const index=read('public/index.html'),dismiss=index.slice(index.indexOf('function dismiss(){'),index.indexOf('async function recover('));
  assert.doesNotMatch(read('public/motion-plus.js'),/if\(doc\.getElementById\?\.\('blBootGuard'\)\)arrive\(\);/);
  assert.match(dismiss,/BLMotionPlus\?\.startup\?\.\(reveal\)/);assert.match(dismiss,/function reveal\(\)\{[\s\S]*el\.remove\(\)/);
  const main=read('electron/main.js'),ipc=main.slice(main.indexOf("ipcMain.handle('buyerlog:startup-transition'"),main.indexOf("ipcMain.handle('buyerlog:workspace-snapshot'"));
  assert.match(ipc,/trustedBuyerLogIpcSender\(event\)/);assert.match(ipc,/pathname!=='\/select-user.html'/);assert.match(ipc,/startupTransition\.take\(event.sender\)/);
  assert.doesNotMatch(read('electron/startup-transition.js'),/writeFile|console\.|localStorage|sessionStorage/);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('arrival holds the first trivia paint until the login canvas covers it, and runs only once',async()=>{
  const s=motion();let take,release,takes=0;
  s.root.buyerLogDesktop.takeStartupTransition=()=>{takes++;return new Promise(resolve=>take=resolve);};
  s.root.BLMotionPlusTheme.run=(update)=>{release=update;return true;};
  const arriving=s.api.arrive();
  assert.equal(s.doc.documentElement.dataset.blStartupArrival,'pending');
  await settle();take({width:8,height:4});await arriving;
  assert.equal(s.doc.documentElement.dataset.blStartupArrival,'pending','canvas must be installed before trivia is revealed');
  release();assert.equal(s.doc.documentElement.dataset.blStartupArrival,undefined);
  await s.api.arrive();assert.equal(takes,1,'DOMContentLoaded must not replay arrival');
});
test('arrival timeout releases trivia and a late login frame never covers it',async()=>{
  const s=motion();let take,timeout;
  s.root.setTimeout=fn=>{timeout=fn;return 1;};s.root.clearTimeout=()=>{};
  s.root.buyerLogDesktop.takeStartupTransition=()=>new Promise(resolve=>take=resolve);
  const arriving=s.api.arrive();await settle();timeout();await arriving;
  assert.equal(s.doc.documentElement.dataset.blStartupArrival,undefined);
  take({width:8,height:4});await settle();assert.equal(s.calls.length,0);
});
test('missing, rejected or disabled arrival opens trivia without a held paint',async()=>{
  for(const take of [async()=>null,async()=>{throw Error('ipc');}]){
    const s=motion();s.root.buyerLogDesktop.takeStartupTransition=take;await s.api.arrive();
    assert.equal(s.doc.documentElement.dataset.blStartupArrival,undefined);assert.equal(s.calls.length,0);
  }
  for(const config of [{reduced:true},{hidden:true},{off:true},{software:true}]){
    const s=motion(config);await s.api.arrive();assert.equal(s.doc.documentElement.dataset.blStartupArrival,undefined);
  }
});
test('real document starts arrival at body mount, before DOMContentLoaded and the first trivia paint',()=>{
  const index=read('public/index.html'),head=index.slice(0,index.indexOf('</head>'));
  assert.ok(head.includes('src="motion-plus-theme.js?'));
  assert.ok(head.includes('src="motion-plus.js?'));
  assert.match(index,/<script>window.BLBootGuard\?\.mount\(\);window.BLMotionPlus\?\.arrive\(\);<\/script>/);
  assert.match(read('public/ui-startup.css'),/html\[data-bl-startup-arrival="pending"\] body\{[^}]*opacity:0/);
});
