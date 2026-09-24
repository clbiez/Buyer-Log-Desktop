'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { readJson,atomicWriteJson,ensureDir }=require('./json-store');

function createLauncherState(options={}){
  const bootstrapCore=path.resolve(options.bootstrapCore||'');
  const portableRoot=path.resolve(options.portableRoot||'');
  const localUpdaterRoot=path.join(portableRoot,'data','local','updater');
  const versionsRoot=path.join(portableRoot,'.buyerlog-versions');
  const currentFile=path.join(localUpdaterRoot,'current.json');
  const stateFile=path.join(localUpdaterRoot,'state.json');
  const localDataRoot=path.join(portableRoot,'data','local');
  const dbBackupRoot=path.join(localUpdaterRoot,'db-backups');
  ensureDir(localUpdaterRoot);ensureDir(versionsRoot);ensureDir(dbBackupRoot);
  const now=typeof options.now==='function'?options.now:()=>new Date().toISOString();
  const makeToken=typeof options.makeToken==='function'?options.makeToken:()=>crypto.randomBytes(24).toString('hex');
  function packageVersion(core){const pkg=readJson(path.join(core,'package.json'),null);return pkg&&String(pkg.version||'').trim()||'';}
  function validManagedCore(candidate,version=''){
    try{const core=path.resolve(candidate),root=path.resolve(versionsRoot);if(core!==bootstrapCore&&!(core===root||core.startsWith(root+path.sep)))return false;if(!fs.existsSync(path.join(core,'electron','main.js')))return false;const found=packageVersion(core);return Boolean(found&&(!version||found===version));}catch(_){return false;}
  }
  function bootstrapPointer(){return {schemaVersion:1,version:packageVersion(bootstrapCore),appCoreRoot:bootstrapCore,source:'bootstrap',updatedAt:now()};}
  function currentPointer(){const raw=readJson(currentFile,null);if(raw&&raw.schemaVersion===1&&validManagedCore(raw.appCoreRoot,raw.version))return raw;return bootstrapPointer();}
  function writePointer(pointer){const next={schemaVersion:1,version:String(pointer.version||''),appCoreRoot:path.resolve(pointer.appCoreRoot),source:pointer.source||'managed',updatedAt:now()};if(!validManagedCore(next.appCoreRoot,next.version))throw Object.assign(new Error('Active app core doğrulanamadı.'),{code:'UPDATE_ACTIVE_CORE_INVALID'});atomicWriteJson(currentFile,next);return next;}
  function defaultState(){const v=packageVersion(bootstrapCore);return {schemaVersion:1,state:'IDLE',currentVersion:v,lastKnownGoodVersion:v,pending:null,activation:null,failedVersions:{}};}
  function readState(){const s=readJson(stateFile,null);return s&&s.schemaVersion===1?s:defaultState();}
  function writeState(patch){const next={...readState(),...patch,schemaVersion:1};atomicWriteJson(stateFile,next);return next;}
  function failedRecord(activation,reason){const state=readState(),failed={...(state.failedVersions||{})};if(activation&&activation.version)failed[activation.version]={sha256:activation.sha256||'',failedAt:now(),reason:String(reason||'health-check-failed').slice(0,200)};return failed;}
  const DB_ROLLBACK_FILES=['BuyerLogLocal.db','BuyerLogLocal.db.bak','BuyerLogLocal.db.wal'];
  function snapshotLocalDb(token){
    const root=path.join(dbBackupRoot,String(token));ensureDir(root);const files=[];
    for(const name of DB_ROLLBACK_FILES){const source=path.join(localDataRoot,name),exists=fs.existsSync(source);files.push({name,exists});if(exists)fs.copyFileSync(source,path.join(root,name));}
    atomicWriteJson(path.join(root,'manifest.json'),{schemaVersion:1,createdAt:now(),files});return {root,files};
  }
  function restoreLocalDb(snapshot){
    if(!snapshot||!snapshot.root||!Array.isArray(snapshot.files))return;const root=path.resolve(snapshot.root);if(!(root===dbBackupRoot||root.startsWith(path.resolve(dbBackupRoot)+path.sep)))throw Object.assign(new Error('DB rollback yolu güvenli değil.'),{code:'UPDATE_DB_ROLLBACK_PATH'});
    ensureDir(localDataRoot);
    for(const item of snapshot.files){const name=String(item&&item.name||'');if(!DB_ROLLBACK_FILES.includes(name))continue;const target=path.join(localDataRoot,name),source=path.join(root,name);if(item.exists){if(!fs.existsSync(source))throw Object.assign(new Error('DB rollback yedeği eksik: '+name),{code:'UPDATE_DB_ROLLBACK_MISSING'});const tmp=target+'.rollback-'+process.pid;fs.copyFileSync(source,tmp);try{fs.rmSync(target,{force:true});}catch(_){}fs.renameSync(tmp,target);}else{try{fs.rmSync(target,{force:true});}catch(_){}}}
  }
  function removeDbSnapshot(snapshot){try{if(snapshot&&snapshot.root)fs.rmSync(snapshot.root,{recursive:true,force:true});}catch(_){}}
  function rollbackTo(activation,reason){
    const previous=activation&&activation.previous&&validManagedCore(activation.previous.appCoreRoot,activation.previous.version)?activation.previous:bootstrapPointer();
    if(activation&&activation.dbSnapshot)restoreLocalDb(activation.dbSnapshot);
    writePointer(previous);writeState({state:'ROLLBACK',activation:null,pending:null,currentVersion:previous.version,lastKnownGoodVersion:previous.version,failedVersions:failedRecord(activation,reason),lastError:{code:'UPDATE_HEALTH_FAILED',message:'Yeni sürüm başlatılamadı; önceki sürüme ve veri checkpointine dönüldü.'}});removeDbSnapshot(activation&&activation.dbSnapshot);return previous;
  }
  function rollbackExistingTrial(){const state=readState(),a=state.activation;if(!a||a.status!=='trial')return null;return {failed:a,restored:rollbackTo(a,'previous-launch-unconfirmed')};}
  function activatePending(){
    const state=readState(),pending=state.pending;if(!pending||!pending.ready)return null;
    if(!validManagedCore(pending.appCoreRoot,pending.version)){writeState({state:'FAILED',pending:null,lastError:{code:'UPDATE_PENDING_INVALID',message:'Hazır update klasörü doğrulanamadı.'}});return null;}
    const previous=currentPointer(),token=makeToken();
    let dbSnapshot=null;try{dbSnapshot=snapshotLocalDb(token);}catch(error){writeState({state:'FAILED',lastError:{code:'UPDATE_DB_CHECKPOINT_FAILED',message:'Yerel veri rollback checkpointi alınamadı; update uygulanmadı.'}});return null;}
    let next;try{next=writePointer({version:pending.version,appCoreRoot:pending.appCoreRoot,source:'managed'});}catch(error){removeDbSnapshot(dbSnapshot);throw error;}
    const activation={status:'trial',token,version:pending.version,sha256:pending.sha256||'',previous,dbSnapshot,startedAt:now(),pid:process.pid};
    writeState({state:'INSTALLING',activation,currentVersion:pending.version});return {activation,selected:next};
  }
  function confirmHealth(expectedToken,info={}){
    const state=readState(),trial=state.activation;if(!trial||trial.status!=='trial'||trial.token!==expectedToken)return false;
    if(String(info.version||'')!==trial.version)return false;
    if(info.backendReady!==true||info.rendererReady!==true||info.localDbReady!==true)return false;
    writeState({state:'SUCCESS',activation:null,pending:null,currentVersion:trial.version,lastKnownGoodVersion:trial.version,lastError:null,lastHealthAt:now()});removeDbSnapshot(trial.dbSnapshot);return true;
  }
  return {bootstrapCore,portableRoot,localDataRoot,localUpdaterRoot,versionsRoot,currentFile,stateFile,packageVersion,validManagedCore,bootstrapPointer,currentPointer,writePointer,readState,writeState,rollbackExistingTrial,activatePending,rollbackNow:rollbackTo,confirmHealth};
}
module.exports={createLauncherState};
