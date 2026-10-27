'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'../electron/launcher-core.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({pending=false,locked=true,corrupt=false}={}){
  const calls=[],notices=[];
  const pointer={appCoreRoot:'/portable/.buyerlog-versions/current/app',version:'7.0.313'};
  const app=Object.assign(new EventEmitter(),{isPackaged:true,setPath:name=>calls.push(name),requestSingleInstanceLock:()=>locked,
    whenReady:()=>Promise.resolve(),exit:code=>calls.push('exit:'+code),quit(){},relaunch(){}});
  class Notice extends EventEmitter{
    constructor(options){super();this.options=options;this.webContents=new EventEmitter();notices.push(this);}
    loadURL(url){this.url=url;return Promise.resolve();}
    show(){calls.push('show');}
    isDestroyed(){return Boolean(this.destroyed);}
    destroy(){this.destroyed=true;this.emit('closed');}
  }
  const lifecycle={rollbackExistingTrial:()=>calls.push('rollback')&&null,readState:()=>({pending:pending?{ready:true,appCoreRoot:'/pending',version:'7.0.314'}:null}),
    currentPointer:()=>pointer,activatePending:()=>{calls.push('activate');return null;}};
  const context={__dirname:'/trusted/electron',module:{exports:{}},global:{},setTimeout,clearTimeout,setImmediate,
    process:{env:{},execPath:'/portable/BuyerLog.exe',pid:1},require:name=>{
      if(name==='fs')return {readFileSync:()=>'{"launcherVersion":"1.2.0"}',mkdirSync(){},appendFileSync(){}};
      if(name==='path')return path;
      if(name==='electron')return {app,BrowserWindow:Notice,dialog:{showErrorBox:()=>calls.push('error')}};
      if(name==='./portable-paths')return {resolvePortableRoot:()=>'/portable',desktopPaths:()=>({electronProfileRoot:'/profile'})};
      if(name==='./update/launcher-state')return {createLauncherState:()=>lifecycle};
      if(name==='./update/semver')return {compareSemver:()=>0};
      if(name==='./manual-patch/manager')return {createInstalledManager:()=>({})};
      if(name==='./manual-patch/core-verification')return {verifyPackagedCore:core=>{calls.push('verify:'+core);if(corrupt)throw Object.assign(new Error('changed'),{code:'UPDATE_CORE_INTEGRITY'});}};
      if(name===path.join(pointer.appCoreRoot,'electron/main.js')){calls.push('main');return;}
      throw new Error('Unexpected require: '+name);
    }};
  vm.runInNewContext(source,context);context.module.exports.start();
  return {calls,notices,app};
}
test('notice paints before rollback/verification; ordinary launch hashes its core once',async()=>{
  const f=fixture();await tick();
  assert.equal(f.notices.length,1);assert.ok(!f.calls.includes('rollback'));
  assert.match(decodeURIComponent(f.notices[0].url),/Buyer Log açılıyor…/);
  assert.match(decodeURIComponent(f.notices[0].url),/Buyer Log is opening…/);
  assert.equal(f.notices[0].options.webPreferences.sandbox,true);
  f.notices[0].emit('ready-to-show');await tick();await tick();
  assert.ok(f.calls.indexOf('show')<f.calls.indexOf('rollback'));
  assert.equal(f.calls.filter(call=>call.startsWith('verify:')).length,1);
  assert.equal(f.calls.at(-1),'main');
});
test('a pending activation still validates the rollback target before activation',async()=>{
  const f=fixture({pending:true});await tick();f.notices[0].emit('ready-to-show');await tick();await tick();
  assert.ok(f.calls.indexOf('verify:/portable/.buyerlog-versions/current/app')<f.calls.indexOf('activate'));
  assert.ok(f.calls.includes('verify:/pending'));
});
test('a corrupt core remains blocked after the early notice',async()=>{
  const f=fixture({corrupt:true});await tick();f.notices[0].emit('ready-to-show');await tick();await tick();
  assert.equal(f.calls.includes('main'),false);assert.ok(f.calls.includes('exit:1'));assert.ok(f.calls.includes('error'));
});
test('a second instance opens no notice and never runs rollback or verification',async()=>{
  const f=fixture({locked:false});await tick();
  assert.equal(f.notices.length,0);assert.ok(f.calls.includes('exit:0'));
  assert.equal(f.calls.includes('rollback'),false);
});
test('older or rolled-back cores close the notice when their own first window appears',async()=>{
  const f=fixture();await tick();f.notices[0].emit('ready-to-show');await tick();await tick();
  const legacyWindow=new EventEmitter();f.app.emit('browser-window-created',{},legacyWindow);
  assert.equal(f.notices[0].isDestroyed(),false);
  legacyWindow.emit('show');assert.equal(f.notices[0].isDestroyed(),true);
  assert.equal(f.app.listenerCount('browser-window-created'),0);
});
