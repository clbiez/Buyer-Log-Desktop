'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const LAUNCHER=fs.readFileSync(path.join(ROOT,'electron','launcher-core.js'),'utf8');
const MAIN=fs.readFileSync(path.join(ROOT,'electron','main.js'),'utf8');
const UPDATE_UI=fs.readFileSync(path.join(ROOT,'public','update-test-ui.js'),'utf8');

test('launcher tek kopya kilidini deneme rollback ve aktivasyondan ÖNCE alır',()=>{
  const lock=LAUNCHER.indexOf('app.requestSingleInstanceLock()');
  assert.ok(lock>0);
  assert.ok(lock<LAUNCHER.indexOf('lifecycle.rollbackExistingTrial()'));
  assert.ok(lock<LAUNCHER.indexOf('lifecycle.activatePending()'));
  assert.ok(lock<LAUNCHER.indexOf("require(path.join(selected.appCoreRoot,'electron','main.js'))"));
});

test('ikinci kopya güncelleme durumuna dokunmadan kapanır',()=>{
  assert.match(LAUNCHER,/if\(!primaryInstance\)\{[\s\S]*?app\.exit\(0\);\s*\}else\{\s*const lifecycle=createLauncherState/);
});

test('launcher kilidi main.js ile aynı userData (electron-profile) yoluyla alır',()=>{
  assert.ok(LAUNCHER.includes("app.setPath('userData',paths.electronProfileRoot)"));
  assert.ok(LAUNCHER.includes('desktopPaths(resolvePortableRoot({packaged:true,execPath:process.execPath}))'));
  assert.ok(MAIN.includes("app.setPath('userData', paths.electronProfileRoot)"));
  assert.ok(MAIN.includes('app.requestSingleInstanceLock()'));
});

test('Check for Updates penceresi engellenen sürüm için moderatöre Tekrar Dene sunar',()=>{
  assert.ok(UPDATE_UI.includes('data-update-retry'));
  assert.ok(UPDATE_UI.includes("code === 'UPDATE_FAILED_VERSION_BLOCKED'"));
  assert.ok(UPDATE_UI.includes('api.retry({userId:userId(),version,channel})'));
  assert.match(UPDATE_UI,/function canRetry\(status\) \{\s*if \(!isModerator\(\)/);
});

test('canlı: kilidi alamayan ikinci kopya trial rollback/aktivasyon çalıştırmaz',()=>{
  const Module=require('node:module');
  const os=require('node:os');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bl-launcher-'));
  const calls=[];
  const fakeApp={
    isPackaged:true,
    setPath:(name,value)=>calls.push(['setPath',name,value]),
    requestSingleInstanceLock:()=>{calls.push(['lock']);return false;},
    exit:code=>calls.push(['exit',code]),
    relaunch:()=>calls.push(['relaunch']),
  };
  const statePath=require.resolve('../electron/update/launcher-state');
  const launcherPath=require.resolve('../electron/launcher-core.js');
  const hostPath=require.resolve('../electron/launcher.js');
  const originalLoad=Module._load;
  const originalExecPath=process.execPath;
  delete require.cache[launcherPath];delete require.cache[hostPath];
  Module._load=function(request,parent,isMain){
    if(request==='electron')return {app:fakeApp};
    if(parent&&parent.filename===launcherPath&&Module._resolveFilename(request,parent)===statePath){
      return {createLauncherState:()=>{calls.push(['createLauncherState']);throw new Error('ikinci kopya güncelleme durumuna dokunmamalı');}};
    }
    return originalLoad.apply(this,arguments);
  };
  Object.defineProperty(process,'execPath',{value:path.join(tmp,'BuyerLog.exe'),configurable:true,writable:true});
  try{
    require(hostPath);
  }finally{
    Module._load=originalLoad;
    Object.defineProperty(process,'execPath',{value:originalExecPath,configurable:true,writable:true});
    delete require.cache[launcherPath];delete require.cache[hostPath];delete global.__buyerLogLauncherHost;
  }
  assert.deepEqual(calls.map(c=>c[0]),['setPath','lock','exit']);
  assert.equal(calls[0][2],path.join(tmp,'data','electron-profile'));
  assert.equal(calls[2][1],0);
  fs.rmSync(tmp,{recursive:true,force:true});
});
