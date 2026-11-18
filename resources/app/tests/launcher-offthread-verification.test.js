'use strict';
// The selected core's full integrity scan ran synchronously on the Electron main
// thread after the launch notice. It now runs the same verifier in a worker;
// integrity failures still stop the launch and worker faults fall back to the
// synchronous scan, so verification is never skipped.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {inventory,integrityBytes}=require('../electron/manual-patch/files');
const {verifyPackagedCore}=require('../electron/manual-patch/core-verification');
const source=fs.readFileSync(path.join(__dirname,'../electron/launcher-core.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async(check)=>{for(let i=0;i<400&&!check();i++)await new Promise(resolve=>setTimeout(resolve,10));};

test('packaged verification checks each directory around its traversal and reads every file on every launch',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-core-scan-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const version='7.0.362',directory=path.join(root,'public','vendor');
  fs.mkdirSync(directory,{recursive:true});
  fs.mkdirSync(path.join(root,'electron'));
  for(let index=0;index<12;index++)fs.writeFileSync(path.join(directory,`file-${index}.js`),'valid');
  fs.writeFileSync(path.join(directory,'file-11.js'),Buffer.alloc(1024*1024+7,5));
  fs.writeFileSync(path.join(root,'electron','app-integrity.json'),integrityBytes(inventory(root),version));
  const directoryChecks=new Map(),contentReads=new Map();
  const lstat=fs.lstatSync,open=fs.openSync;
  t.mock.method(fs,'lstatSync',(file,...args)=>{
    const stat=lstat(file,...args);
    if(stat.isDirectory())directoryChecks.set(file,(directoryChecks.get(file)||0)+1);
    return stat;
  });
  t.mock.method(fs,'openSync',(file,...args)=>{
    if(typeof file==='string'&&path.dirname(file)===directory)contentReads.set(file,(contentReads.get(file)||0)+1);
    return open(file,...args);
  });
  assert.equal(verifyPackagedCore(root,version).fileCount,12);
  assert.equal(directoryChecks.get(directory),2);
  assert.deepEqual([...contentReads.values()],Array(12).fill(1));
  const changed=path.join(directory,'file-0.js'),times=fs.statSync(changed);
  fs.writeFileSync(changed,'other');
  fs.utimesSync(changed,times.atime,times.mtime);
  assert.throws(()=>verifyPackagedCore(root,version),{code:'UPDATE_CORE_INTEGRITY'});
});

test('a packaged directory replaced by a link is rejected before any linked content is read',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-core-linked-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const core=path.join(root,'core'),directory=path.join(core,'public'),target=path.join(root,'target');
  fs.mkdirSync(directory,{recursive:true});
  fs.mkdirSync(path.join(core,'electron'));
  for(let index=0;index<4;index++)fs.writeFileSync(path.join(directory,`file-${index}.js`),'valid');
  fs.writeFileSync(path.join(core,'electron','app-integrity.json'),integrityBytes(inventory(core),'7.0.362'));
  fs.renameSync(directory,target);
  fs.symlinkSync(target,directory,process.platform==='win32'?'junction':'dir');
  const open=fs.openSync;
  t.mock.method(fs,'openSync',(file,...args)=>{
    assert.notEqual(typeof file==='string'&&path.dirname(file),directory,'the scanner must not open a file in the linked directory');
    return open(file,...args);
  });
  assert.throws(()=>verifyPackagedCore(core,'7.0.362'),{code:'PATCH_PATH_UNSAFE'});
});

test('a directory replaced during traversal cannot pass verification even when its file hashes match',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-core-directory-swap-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const core=path.join(root,'core'),directory=path.join(core,'public');
  fs.mkdirSync(directory,{recursive:true});
  fs.mkdirSync(path.join(core,'electron'));
  for(let index=0;index<4;index++)fs.writeFileSync(path.join(directory,`file-${index}.js`),'valid');
  fs.writeFileSync(path.join(core,'electron','app-integrity.json'),integrityBytes(inventory(core),'7.0.362'));
  const readdir=fs.readdirSync;
  t.mock.method(fs,'readdirSync',(name,...args)=>{
    const entries=readdir(name,...args);
    if(name===directory){
      const moved=path.join(root,'moved');
      fs.renameSync(directory,moved);
      fs.cpSync(moved,directory,{recursive:true});
    }
    return entries;
  });
  assert.throws(()=>verifyPackagedCore(core,'7.0.362'),{code:'PATCH_PATH_UNSAFE'});
});
function trustedRoot(body){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-offthread-verify-'));
  fs.mkdirSync(path.join(root,'manual-patch'));
  fs.writeFileSync(path.join(root,'manual-patch','core-verification.js'),body);
  return root;
}
function fixture({pending=false,locked=true,corrupt=false,trusted='/trusted/electron'}={}){
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
  const context={__dirname:trusted,module:{exports:{}},global:{},setTimeout,clearTimeout,setImmediate,
    process:{env:{},execPath:'/portable/BuyerLog.exe',pid:1,uptime:()=>1},require:name=>{
      if(name==='fs')return {readFileSync:()=>'{"launcherVersion":"1.2.0"}',mkdirSync(){},appendFileSync(){}};
      if(name==='path')return path;
      if(name==='electron')return {app,BrowserWindow:Notice,dialog:{showErrorBox:()=>calls.push('error')}};
      if(name==='./portable-paths')return {resolvePortableRoot:()=>'/portable',desktopPaths:()=>({electronProfileRoot:'/profile'})};
      if(name==='./update/launcher-state')return {createLauncherState:()=>lifecycle};
      if(name==='./update/semver')return {compareSemver:()=>0};
      if(name==='./manual-patch/manager')return {createInstalledManager:()=>({})};
      if(name==='./manual-patch/core-verification')return {verifyPackagedCore:core=>{calls.push('verify:'+core);if(corrupt)throw Object.assign(new Error('changed'),{code:'UPDATE_CORE_INTEGRITY'});}};
      if(name===path.join(pointer.appCoreRoot,'electron/main.js')){calls.push('main');return;}
      if(name==='worker_threads')return require('node:worker_threads');
      throw new Error('Unexpected require: '+name);
    }};
  vm.runInNewContext(source,context);context.module.exports.start();
  return {calls,notices,app};
}

test('an intact core is verified off the main thread and the app core loads', async () => {
  const f=fixture({trusted:trustedRoot("exports.verifyPackagedCore=()=>({verified:true});")});
  await tick();f.notices[0].emit('ready-to-show');
  await until(()=>f.calls.includes('main'));
  assert.equal(f.calls.at(-1),'main');
  assert.equal(f.calls.filter(call=>call.startsWith('verify:')).length,0,'the main-thread scan did not run');
});
test('an integrity failure in the worker still blocks the launch', async () => {
  const f=fixture({trusted:trustedRoot("exports.verifyPackagedCore=()=>{throw Object.assign(new Error('changed'),{code:'UPDATE_CORE_INTEGRITY'});};")});
  await tick();f.notices[0].emit('ready-to-show');
  await until(()=>f.calls.includes('exit:1'));
  assert.equal(f.calls.includes('main'),false);assert.ok(f.calls.includes('error'));
  assert.equal(f.calls.filter(call=>call.startsWith('verify:')).length,0,'a real integrity failure is not retried on the main thread');
});
test('a worker fault falls back to the synchronous verifier instead of skipping it', async () => {
  const f=fixture({trusted:trustedRoot("throw new Error('worker module broken');")});
  await tick();f.notices[0].emit('ready-to-show');
  await until(()=>f.calls.includes('main'));
  assert.equal(f.calls.filter(call=>call.startsWith('verify:')).length,1);
  assert.equal(f.calls.at(-1),'main');
});
test('a corrupt core is still blocked when the worker falls back', async () => {
  const f=fixture({corrupt:true,trusted:trustedRoot("throw new Error('worker module broken');")});
  await tick();f.notices[0].emit('ready-to-show');
  await until(()=>f.calls.includes('exit:1'));
  assert.equal(f.calls.includes('main'),false);
});

test('during the off-thread wait the launch survives a closed notice and catches second instances', async () => {
  const f=fixture({trusted:trustedRoot("const start=Date.now();while(Date.now()-start<150){}exports.verifyPackagedCore=()=>({verified:true});")});
  await tick();f.notices[0].emit('ready-to-show');
  await until(()=>f.app.listenerCount('window-all-closed')===1);
  assert.equal(f.app.listenerCount('second-instance'),1,'second instance is handled while main.js is not loaded');
  f.app.emit('second-instance');
  await until(()=>f.calls.includes('main'));
  assert.equal(f.app.listenerCount('window-all-closed'),0,'temporary listeners are removed before main.js registers its own');
  assert.equal(f.app.listenerCount('second-instance'),0);
});
