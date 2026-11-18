'use strict';
// Field logs (updater.log) showed the selected core's SHA-256 scan taking 50-120 s
// after the disk cache went cold, against 2-5 s on an immediate relaunch. The
// launcher now reads files over several lanes. These tests pin that the parallel
// scan keeps every check of the sequential one: same inventory, same hashes, same
// error codes for changed, extra, missing, linked and swapped files.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const F=require('../electron/manual-patch/files');
const {verifyPackagedCore,verifyPackagedCoreParallel}=require('../electron/manual-patch/core-verification');
const VERSION='7.0.362';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async check=>{for(let i=0;i<400&&!check();i++)await new Promise(resolve=>setTimeout(resolve,10));};

function sealedCore(t,{files=24}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-parallel-verify-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const core=path.join(root,'core');
  for(const dir of ['electron','public/vendor','server/lib','node_modules/pkg/lib'])fs.mkdirSync(path.join(core,dir),{recursive:true});
  for(let i=0;i<files;i++){
    const dir=['public/vendor','server/lib','node_modules/pkg/lib'][i%3];
    fs.writeFileSync(path.join(core,dir,`file-${i}.js`),`module.exports=${i};`);
  }
  fs.writeFileSync(path.join(core,'public','vendor','large.bin'),Buffer.alloc(1024*1024+9,7));
  fs.writeFileSync(path.join(core,'electron','app-integrity.json'),F.integrityBytes(F.inventory(core),VERSION));
  return {root,core};
}
async function bothReject(core,code){
  assert.throws(()=>verifyPackagedCore(core,VERSION),{code});
  await assert.rejects(verifyPackagedCoreParallel(core,VERSION),{code});
}

test('the parallel scan returns the same inventory and verdict as the sequential scan',async t=>{
  const {core}=sealedCore(t,{files:220});
  const exclude=rel=>rel==='electron/app-integrity.json';
  assert.deepEqual(await F.inventoryParallel(core,{exclude,concurrency:6}),F.inventory(core,{exclude}));
  const sync=verifyPackagedCore(core,VERSION),parallel=await verifyPackagedCoreParallel(core,VERSION,{concurrency:6});
  assert.equal(parallel.fileCount,sync.fileCount);assert.equal(parallel.core,sync.core);assert.equal(parallel.verified,true);
});

test('a same-size, same-time content change, an extra file and a missing file fail with the same code',async t=>{
  const {core}=sealedCore(t);
  const changed=path.join(core,'server','lib','file-1.js'),times=fs.statSync(changed),original=fs.readFileSync(changed);
  fs.writeFileSync(changed,Buffer.from(original.toString().replace('1','9')));fs.utimesSync(changed,times.atime,times.mtime);
  await bothReject(core,'UPDATE_CORE_INTEGRITY');
  fs.writeFileSync(changed,original);
  fs.writeFileSync(path.join(core,'public','vendor','planted.js'),'x');
  await bothReject(core,'UPDATE_CORE_INTEGRITY');
  fs.rmSync(path.join(core,'public','vendor','planted.js'));
  fs.rmSync(path.join(core,'node_modules','pkg','lib','file-2.js'));
  await bothReject(core,'UPDATE_CORE_INTEGRITY');
});

test('a linked directory is rejected by the parallel scan before any file is opened',{skip:process.platform==='win32'},async t=>{
  const {root,core}=sealedCore(t);
  const directory=path.join(core,'server','lib'),target=path.join(root,'target');
  fs.renameSync(directory,target);fs.symlinkSync(target,directory,'dir');
  // The tree walk runs before any content lane starts.
  let lanes=0;class CountingWorker{constructor(){lanes++;throw new Error('no lane expected');}}
  assert.throws(()=>verifyPackagedCore(core,VERSION),{code:'PATCH_PATH_UNSAFE'});
  await assert.rejects(verifyPackagedCoreParallel(core,VERSION,{Worker:CountingWorker}),{code:'PATCH_PATH_UNSAFE'});
  assert.equal(lanes,0);
});

test('a file swapped after it was listed fails the identity check in a worker lane',async t=>{
  const {root,core}=sealedCore(t,{files:220});
  const victim=path.join(core,'server','lib','file-1.js'),lstat=fs.lstatSync;let swapped=false;
  t.mock.method(fs,'lstatSync',(file,...args)=>{
    const stat=lstat(file,...args);
    if(file===victim&&!swapped){swapped=true;fs.renameSync(victim,path.join(root,'old.js'));fs.copyFileSync(path.join(root,'old.js'),victim);}
    return stat;
  });
  await assert.rejects(verifyPackagedCoreParallel(core,VERSION),{code:'PATCH_PATH_UNSAFE'});
  assert.equal(swapped,true);
});

test('a directory replaced during traversal cannot pass the parallel scan',async t=>{
  const {root,core}=sealedCore(t);
  const directory=path.join(core,'public','vendor'),readdir=fs.readdirSync;
  t.mock.method(fs,'readdirSync',(name,...args)=>{
    const entries=readdir(name,...args);
    if(name===directory){const moved=path.join(root,'moved');fs.renameSync(directory,moved);fs.cpSync(moved,directory,{recursive:true});}
    return entries;
  });
  await assert.rejects(verifyPackagedCoreParallel(core,VERSION),{code:'PATCH_PATH_UNSAFE'});
});

test('content is hashed in several worker lanes and the profile names only relative paths',async t=>{
  const {core}=sealedCore(t,{files:220});
  const result=await verifyPackagedCoreParallel(core,VERSION,{concurrency:4});
  const {profile}=result;
  assert.equal(profile.lanes,4);assert.equal(profile.files,result.fileCount);
  assert.ok(profile.bytes>1024*1024);assert.ok(profile.slowest.length<=5);
  for(const entry of profile.slowest)assert.ok(!path.isAbsolute(entry.path)&&!entry.path.includes(core),entry.path);
  assert.ok(Number.isFinite(profile.walkMs)&&Number.isFinite(profile.fileMsP95));
});

test('small trees stay on one lane and a lane that cannot start falls back to a full sequential scan',async t=>{
  const {core}=sealedCore(t,{files:220});
  class Broken{constructor(){throw new Error('worker unavailable');}}
  const fallback=await verifyPackagedCoreParallel(core,VERSION,{concurrency:4,Worker:Broken});
  assert.equal(fallback.profile.lanes,1);assert.equal(fallback.fileCount,verifyPackagedCore(core,VERSION).fileCount);
  const small=sealedCore(t,{files:12});
  assert.equal((await verifyPackagedCoreParallel(small.core,VERSION,{concurrency:8})).profile.lanes,1);
});

test('a lane fault is never treated as success: a changed file still fails after the sequential fallback',async t=>{
  const {core}=sealedCore(t,{files:220});
  fs.appendFileSync(path.join(core,'server','lib','file-1.js'),' ');
  const {EventEmitter}=require('node:events');
  class Crashing extends EventEmitter{constructor(){super();setImmediate(()=>this.emit('error',new Error('lane crashed')));}terminate(){}}
  await assert.rejects(verifyPackagedCoreParallel(core,VERSION,{concurrency:4,Worker:Crashing}),{code:'UPDATE_CORE_INTEGRITY'});
});

// ---- Launcher wiring ----
const source=fs.readFileSync(path.join(__dirname,'../electron/launcher-core.js'),'utf8');
function trustedRoot(t,body){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-parallel-launcher-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'manual-patch'));
  fs.writeFileSync(path.join(root,'manual-patch','core-verification.js'),body);
  return root;
}
function launcher({trusted,paintNever=false}){
  const calls=[],notices=[],logs=[],scripts=[];
  const pointer={appCoreRoot:'/portable/.buyerlog-versions/current/app',version:'7.0.313'};
  const app=Object.assign(new EventEmitter(),{isPackaged:true,setPath(){},requestSingleInstanceLock:()=>true,
    whenReady:()=>Promise.resolve(),exit:code=>calls.push('exit:'+code),quit(){},relaunch(){}});
  class Notice extends EventEmitter{
    constructor(options){super();this.options=options;notices.push(this);
      this.webContents=Object.assign(new EventEmitter(),{executeJavaScript:code=>{scripts.push(code);return Promise.resolve();}});}
    loadURL(url){this.url=url;return Promise.resolve();}
    show(){calls.push('show');}
    isDestroyed(){return Boolean(this.destroyed);}
    destroy(){this.destroyed=true;calls.push('destroy');this.emit('closed');}
  }
  const lifecycle={rollbackExistingTrial:()=>null,readState:()=>({pending:null}),currentPointer:()=>pointer,activatePending:()=>null};
  // The 3 s first-paint budget runs at test speed.
  const fastTimeout=(fn,ms,...args)=>setTimeout(fn,ms===3000?5:ms,...args);
  const context={__dirname:trusted,module:{exports:{}},global:{},setTimeout:fastTimeout,clearTimeout,setImmediate,
    process:{env:{},execPath:'/portable/BuyerLog.exe',pid:4242,ppid:1,uptime:()=>1},require:name=>{
      if(name==='fs')return {readFileSync:()=>'{"launcherVersion":"1.2.1"}',mkdirSync(){},appendFileSync:(_file,line)=>logs.push(JSON.parse(line))};
      if(name==='path')return path;
      if(name==='electron')return {app,BrowserWindow:Notice,dialog:{showErrorBox:()=>calls.push('error')}};
      if(name==='./portable-paths')return {resolvePortableRoot:()=>'/portable',desktopPaths:()=>({electronProfileRoot:'/profile'})};
      if(name==='./update/launcher-state')return {createLauncherState:()=>lifecycle};
      if(name==='./update/semver')return {compareSemver:()=>0};
      if(name==='./manual-patch/manager')return {createInstalledManager:()=>({})};
      if(name==='./manual-patch/core-verification')return {verifyPackagedCore:()=>calls.push('main-thread-verify')};
      if(name===path.join(pointer.appCoreRoot,'electron/main.js')){calls.push('main');return;}
      if(name==='worker_threads')return require('node:worker_threads');
      throw new Error('Unexpected require: '+name);
    }};
  vm.runInNewContext(source,context);context.module.exports.start();
  if(!paintNever)setImmediate(()=>notices[0]&&notices[0].emit('ready-to-show'));
  return {calls,notices,logs,scripts};
}

test('the launcher worker uses the parallel verifier and records its profile with the process id',async t=>{
  const trusted=trustedRoot(t,`exports.verifyPackagedCore=()=>{throw new Error('sequential path must not run');};
exports.verifyPackagedCoreParallel=async(core,version,options)=>({verified:true,profile:{files:3,lanes:options.concurrency==='auto'?6:0,slowest:[{path:'public/a.js',ms:9}]}});`);
  const f=launcher({trusted});
  await until(()=>f.calls.includes('main'));
  assert.equal(f.calls.includes('main-thread-verify'),false);
  const profile=f.logs.find(entry=>entry.event==='core-verify-profile');
  assert.ok(profile,'profile logged');assert.equal(profile.lanes,6,'the launcher asks for automatic lane sizing');assert.equal(profile.files,3);
  assert.ok(f.logs.every(entry=>entry.pid===4242),'every launcher log line names its process');
  const environment=f.logs.find(entry=>entry.event==='launch-environment');
  assert.deepEqual(environment.install,{kind:'local',drive:''});assert.equal(environment.launcherVersion,'1.2.1');
});

test('an integrity failure from the parallel verifier still blocks the launch',async t=>{
  const trusted=trustedRoot(t,`exports.verifyPackagedCore=()=>({verified:true});
exports.verifyPackagedCoreParallel=async()=>{throw Object.assign(new Error('changed'),{code:'UPDATE_CORE_INTEGRITY'});};`);
  const f=launcher({trusted});
  await until(()=>f.calls.includes('exit:1'));
  assert.equal(f.calls.includes('main'),false);assert.ok(f.calls.includes('error'));
  assert.equal(f.calls.includes('main-thread-verify'),false,'a real integrity failure is not retried');
});

test('a slow first paint keeps the notice: it is shown, not destroyed, and catches up with the current step',async t=>{
  const trusted=trustedRoot(t,`exports.verifyPackagedCoreParallel=async()=>{await new Promise(r=>setTimeout(r,60));return {verified:true,profile:null};};`);
  const f=launcher({trusted,paintNever:true});
  await until(()=>f.logs.some(entry=>entry.event==='launch-step'&&entry.step==='verify'));
  assert.ok(f.logs.some(entry=>entry.event==='launch-notice-slow'));
  assert.equal(f.logs.some(entry=>entry.event==='launch-notice-failed'),false);
  assert.equal(f.notices[0].isDestroyed(),false,'the window stays for the whole verification');
  assert.ok(f.calls.includes('show'));
  // The page finishes loading late and is moved to the step already running.
  f.notices[0].webContents.emit('did-finish-load');
  assert.ok(f.scripts.some(code=>code.includes('step("verify")')));
  await until(()=>f.calls.includes('main'));
  assert.equal(f.calls.includes('destroy'),false);
});
