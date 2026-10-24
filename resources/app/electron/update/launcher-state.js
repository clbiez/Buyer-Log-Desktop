'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { readJson,atomicWriteJson,atomicWriteBuffer,ensureDir,syncDirectory }=require('./json-store');
const { compareSemver }=require('./semver');
const { ledgerFile,readTrialBackend }=require('./trial-backend');

function versionKey(version){return String(version||'').replace(/[^0-9A-Za-z._-]/g,'_');}
function isNewerVersion(a,b){try{return compareSemver(a,b)>0;}catch(_){return false;}}

function readStateFile(file,missing=null){
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('Invalid state file');
    const s=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if(!s||typeof s!=='object'||Array.isArray(s)||s.schemaVersion!==1)throw Error('Invalid state schema');
    if(Object.hasOwn(s,'manualPatchWatermarks')){
      const values=s.manualPatchWatermarks;
      if(!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([key,n])=>!/^\d+\.\d+\.\d+:[a-f0-9]{40}$/.test(key)||!Number.isSafeInteger(n)||n<0))throw Error('Invalid watermark');
    }
    return s;
  }catch(error){
    if(error.code==='ENOENT')return missing;
    throw Object.assign(new Error('Güncelleme durumu bozuk; dosya korundu. / Update state is corrupt; the file was preserved.'),{code:'UPDATE_STATE_INVALID',cause:error});
  }
}

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
  /* Pointer'lar mutlak yol taşır. Klasör başka bir bilgisayara/kullanıcıya
     kopyalanınca (C:\Users\<kaynak>\...) bu yol hedefte geçersizdir ve launcher
     sessizce eski bootstrap çekirdeğine düşüyordu (7.0.178 saha olayı). Aynı
     sürüm bu kurulumun .buyerlog-versions klasöründe doğrulanabiliyorsa oraya
     yeniden bağlanır; doğrulanamıyorsa eski davranış (bootstrap) korunur. */
  function localizeManagedCore(candidate,version=''){
    if(validManagedCore(candidate,version))return path.resolve(candidate);
    const parts=String(candidate||'').split(/[\\/]+/).filter(Boolean),index=parts.lastIndexOf('.buyerlog-versions'),keys=[];
    if(index>=0&&parts[index+1])keys.push(parts[index+1]);
    if(version)keys.push(versionKey(version));
    for(const key of keys){if(key==='.'||key==='..')continue;const local=path.join(versionsRoot,key,'app');if(validManagedCore(local,version))return local;}
    return '';
  }
  function localizePointer(pointer){if(!pointer)return null;const local=localizeManagedCore(pointer.appCoreRoot,pointer.version);return local?{...pointer,appCoreRoot:local}:null;}
  function currentPointer(){
    const raw=readJson(currentFile,null),boot=bootstrapPointer();
    const local=raw&&raw.schemaVersion===1?localizePointer(raw):null;
    if(!local)return boot;
    // Eski bir klasörün üstüne yeni tam paket konduysa, eski yönetilen sürüm
    // yeni bootstrap çekirdeğini gölgelemez.
    if(path.resolve(local.appCoreRoot)!==bootstrapCore&&isNewerVersion(boot.version,local.version))return boot;
    return local;
  }
  function writePointer(pointer){const next={schemaVersion:1,version:String(pointer.version||''),appCoreRoot:path.resolve(pointer.appCoreRoot),source:pointer.source||'managed',updatedAt:now()};if(!validManagedCore(next.appCoreRoot,next.version))throw Object.assign(new Error('Active app core doğrulanamadı.'),{code:'UPDATE_ACTIVE_CORE_INVALID'});atomicWriteJson(currentFile,next);return next;}
  function defaultState(){const v=packageVersion(bootstrapCore);return {schemaVersion:1,state:'IDLE',currentVersion:v,lastKnownGoodVersion:v,pending:null,activation:null,failedVersions:{}};}
  function readState(){return readStateFile(stateFile,defaultState());}
  function writeState(patch){const next={...readState(),...patch,schemaVersion:1};atomicWriteJson(stateFile,next);return next;}
  function failedRecord(activation,reason){const state=readState(),failed={...(state.failedVersions||{})};if(activation&&activation.version)failed[activation.version]={sha256:activation.sha256||'',failedAt:now(),reason:String(reason||'health-check-failed').slice(0,200),...(activation.manualPatch?{manualPatch:activation.manualPatch}:{})};return failed;}
  const DB_ROLLBACK_FILES=['BuyerLogLocal.db','BuyerLogLocal.db.bak','BuyerLogLocal.db.wal','BuyerLogLocal.db.wal.bak'];
  const RECOVERY_MEMBERS=[...DB_ROLLBACK_FILES,'current.json','state.json'];
  const recoveryFile=path.join(localUpdaterRoot,'rollback-intent.json');
  const transition=(event,detail={})=>{if(typeof options.onTransition==='function')options.onTransition(event,detail);};
  const failure=(code,message)=>Object.assign(new Error(message),{code});
  function fingerprint(file){
    try{
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink())throw failure('UPDATE_DB_ROLLBACK_INVALID','Checkpoint üyesi normal bir dosya olmalı. / Checkpoint member must be a regular file.');
      const buffer=fs.readFileSync(file);return {exists:true,size:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex')};
    }catch(error){if(error.code==='ENOENT')return {exists:false,size:0,sha256:null};throw error;}
  }
  const same=(a,b)=>Boolean(a&&b&&a.exists===b.exists&&a.size===b.size&&a.sha256===b.sha256);
  function strictJson(file,code='UPDATE_DB_ROLLBACK_INVALID'){
    try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
    catch(error){throw Object.assign(failure(code,'Güncelleme kurtarma kaydı okunamadı. / Update recovery record could not be read.'),{cause:error});}
  }
  function checkpointRoot(snapshot){
    const root=path.resolve(String(snapshot&&snapshot.root||'')),base=path.resolve(dbBackupRoot),relative=path.relative(base,root);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||relative.split(path.sep).length!==1)throw failure('UPDATE_DB_ROLLBACK_PATH','DB geri alma yolu güvenli değil. / DB rollback path is unsafe.');
    try{
      const stat=fs.lstatSync(root),real=fs.realpathSync(root),realBase=fs.realpathSync(base);
      if(!stat.isDirectory()||stat.isSymbolicLink()||path.dirname(real)!==realBase)throw failure('UPDATE_DB_ROLLBACK_PATH','DB geri alma yolu güvenli değil. / DB rollback path is unsafe.');
    }catch(error){if(error.code==='ENOENT')throw failure('UPDATE_DB_ROLLBACK_MISSING','DB geri alma yedeği eksik. / DB rollback checkpoint is missing.');throw error;}
    return root;
  }
  function memberList(files){
    if(!Array.isArray(files)||files.length!==DB_ROLLBACK_FILES.length||new Set(files.map(item=>item&&item.name)).size!==DB_ROLLBACK_FILES.length
      ||files.some(item=>!item||!DB_ROLLBACK_FILES.includes(item.name)||typeof item.exists!=='boolean'))throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint üye listesi geçersiz. / DB checkpoint member list is invalid.');
    return DB_ROLLBACK_FILES.map(name=>files.find(item=>item.name===name));
  }
  function snapshotLocalDb(token){
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/.test(String(token)))throw failure('UPDATE_DB_ROLLBACK_PATH','Checkpoint kimliği geçersiz. / Invalid checkpoint identity.');
    const root=path.join(dbBackupRoot,String(token));ensureDir(root);
    const files=[];
    for(const name of DB_ROLLBACK_FILES){
      const source=path.join(localDataRoot,name),before=fingerprint(source),destination=path.join(root,name);
      if(before.exists){fs.copyFileSync(source,destination);const fd=fs.openSync(destination,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!same(before,fingerprint(destination)))throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint kopyası doğrulanamadı. / DB checkpoint copy could not be verified.');}
      files.push({name,...before});
    }
    atomicWriteJson(path.join(root,'manifest.json'),{schemaVersion:3,createdAt:now(),files});syncDirectory(root);
    return {root,formatVersion:3,files};
  }
  function validateSnapshot(snapshot){
    const root=checkpointRoot(snapshot),files=memberList(snapshot.files),manifest=strictJson(path.join(root,'manifest.json'));
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||![1,3].includes(manifest.schemaVersion))throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint sürümü geçersiz. / Invalid DB checkpoint version.');
    const saved=memberList(manifest.files),legacy=manifest.schemaVersion===1&&snapshot.formatVersion==null;
    if(!legacy&&(manifest.schemaVersion!==3||snapshot.formatVersion!==3))throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint kimliği uyuşmuyor. / DB checkpoint identity does not match.');
    return {root,legacy,files:files.map((item,index)=>{
      const recorded=saved[index],actual=fingerprint(path.join(root,item.name));
      if(item.exists!==recorded.exists)throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint üyeleri uyuşmuyor. / DB checkpoint members do not match.');
      if(item.exists&&!actual.exists)throw failure('UPDATE_DB_ROLLBACK_MISSING','DB checkpoint üyesi eksik: '+item.name+' / DB checkpoint member is missing.');
      if(!legacy&&(!same(item,recorded)||!same(recorded,actual))||legacy&&actual.exists!==item.exists)throw failure('UPDATE_DB_ROLLBACK_INVALID','DB checkpoint boyutu veya özeti uyuşmuyor. / DB checkpoint size or digest does not match.');
      return {name:item.name,...actual};
    })};
  }
  function backendPids(){
    const runtime=path.join(portableRoot,'data','portable-localappdata','BuyerLog','runtime','watchdog.json');
    if(!fs.existsSync(runtime))return [];
    const record=strictJson(runtime,'UPDATE_DB_ROLLBACK_BUSY');
    if(!record||typeof record!=='object'||Array.isArray(record))throw failure('UPDATE_DB_ROLLBACK_BUSY','Yerel sunucu kimliği okunamadı. / Local server identity could not be read.');
    return [record.watchdogPid,record.serverPid].map(Number).filter(pid=>Number.isInteger(pid)&&pid>0);
  }
  function assertOffline(pids=[],token=''){
    const ledger=token?readTrialBackend(localDataRoot,token):null;
    for(const pid of new Set([...pids,...backendPids(),...(ledger?[ledger.watchdogPid,ledger.serverPid].filter(Boolean):[])])){
      try{process.kill(pid,0);throw failure('UPDATE_DB_ROLLBACK_BUSY','Yerel sunucu durmadan geri alma yapılamaz. / Rollback requires the local server to stop.');}
      catch(error){if(error.code!=='ESRCH')throw error;}
    }
  }
  function targetFor(name){
    if(DB_ROLLBACK_FILES.includes(name))return path.join(localDataRoot,name);
    if(name==='current.json')return currentFile;
    if(name==='state.json')return stateFile;
    throw failure('UPDATE_DB_ROLLBACK_INVALID','Kurtarma hedefi geçersiz. / Invalid recovery target.');
  }
  function desiredPointer(previous){
    const local=localizePointer(previous)||bootstrapPointer();
    if(!validManagedCore(local.appCoreRoot,local.version))throw failure('UPDATE_ACTIVE_CORE_INVALID','Önceki uygulama çekirdeği doğrulanamadı. / Previous app core could not be verified.');
    return {schemaVersion:1,version:String(local.version||''),appCoreRoot:path.resolve(local.appCoreRoot),source:local.source||'managed',updatedAt:now()};
  }
  function recoverRollback(){
    const intent=strictJson(recoveryFile);
    if(!intent||typeof intent!=='object'||Array.isArray(intent))throw failure('UPDATE_DB_ROLLBACK_INVALID','Geri alma niyeti geçersiz. / Invalid rollback intent.');
    const snapshotRoot=checkpointRoot({root:intent.snapshotRoot});
    if(intent.schemaVersion!==1||intent.kind!=='rollback'||!intent.activation||!intent.previous||!Array.isArray(intent.members)
      ||intent.members.length!==RECOVERY_MEMBERS.length||intent.members.some((item,i)=>!item||typeof item!=='object'||item.name!==RECOVERY_MEMBERS[i])
      ||intent.stageRoot!==path.join(snapshotRoot,'restore'))throw failure('UPDATE_DB_ROLLBACK_INVALID','Geri alma niyeti geçersiz. / Invalid rollback intent.');
    if(!validManagedCore(intent.previous.appCoreRoot,intent.previous.version))throw failure('UPDATE_ACTIVE_CORE_INVALID','Önceki uygulama çekirdeği doğrulanamadı. / Previous app core could not be verified.');
    const stageStat=fs.lstatSync(intent.stageRoot);
    if(!stageStat.isDirectory()||stageStat.isSymbolicLink())throw failure('UPDATE_DB_ROLLBACK_PATH','Kurtarma hazırlık yolu güvenli değil. / Recovery staging path is unsafe.');
    const pointerStage=strictJson(path.join(intent.stageRoot,'current.json')),stateStage=strictJson(path.join(intent.stageRoot,'state.json'));
    if(pointerStage.version!==intent.previous.version||pointerStage.appCoreRoot!==intent.previous.appCoreRoot||stateStage.currentVersion!==intent.previous.version||stateStage.activation!==null)throw failure('UPDATE_DB_ROLLBACK_INVALID','Kurtarma sürüm kimlikleri uyuşmuyor. / Recovery version identities do not match.');
    if(intent.activation.backendFenceVersion!==1)throw failure('UPDATE_DB_ROLLBACK_LEGACY_UNVERIFIED','Eski denemenin yazıcı kimliği doğrulanamıyor; checkpoint korundu. / The legacy trial writer identity cannot be verified; checkpoint preserved.');
    assertOffline(intent.backendPids||[],intent.activation.token);
    // Verify every staged byte and every live generation before any replacement.
    // Third-party changes after interruption are conflicts, never silent overwrites.
    for(const item of intent.members){
      for(const meta of [item.before,item.after])if(!meta||typeof meta.exists!=='boolean'||!Number.isSafeInteger(meta.size)||meta.size<0||(meta.exists?!/^[a-f0-9]{64}$/.test(meta.sha256):meta.size!==0||meta.sha256!==null))throw failure('UPDATE_DB_ROLLBACK_INVALID','Kurtarma dosya kimliği geçersiz. / Recovery file identity is invalid.');
      if(!DB_ROLLBACK_FILES.includes(item.name)&&!item.after.exists)throw failure('UPDATE_DB_ROLLBACK_INVALID','Kurtarma sürüm dosyası eksik. / Recovery version file is missing.');
      const staged=fingerprint(path.join(intent.stageRoot,item.name)),current=fingerprint(targetFor(item.name));
      if(!same(staged,item.after))throw failure('UPDATE_DB_ROLLBACK_INVALID','Hazırlanmış geri alma verisi bozuk. / Staged rollback data is corrupt.');
      if(!same(current,item.before)&&!same(current,item.after))throw failure('UPDATE_DB_ROLLBACK_CONFLICT','Geri alma sırasında veri değişti; dosyalar korundu. / Data changed during rollback; files were preserved.');
    }
    for(const item of intent.members){
      const target=targetFor(item.name);
      if(!same(fingerprint(target),item.after)){
        if(item.after.exists)atomicWriteBuffer(target,fs.readFileSync(path.join(intent.stageRoot,item.name)));
        else{try{fs.unlinkSync(target);}catch(error){if(error.code!=='ENOENT')throw error;}syncDirectory(path.dirname(target));}
      }
      transition('rollback-member',{name:item.name});
    }
    for(const item of intent.members)if(!same(fingerprint(targetFor(item.name)),item.after))throw failure('UPDATE_DB_ROLLBACK_CONFLICT','Geri alma doğrulanamadı. / Rollback verification failed.');
    fs.unlinkSync(recoveryFile);syncDirectory(localUpdaterRoot);
    removeDbSnapshot({root:snapshotRoot});
    removeTrialLedger(intent.activation.token);
    return {failed:intent.activation,restored:intent.previous};
  }
  function removeTrialLedger(token){try{const file=ledgerFile(localDataRoot,token);fs.unlinkSync(file);syncDirectory(path.dirname(file));}catch(error){if(error.code!=='ENOENT')console.warn('[UPDATER] Inactive trial ledger retained for later cleanup.');}}
  function removeDbSnapshot(snapshot){try{if(snapshot&&snapshot.root){const root=checkpointRoot(snapshot);fs.rmSync(root,{recursive:true,force:true});syncDirectory(dbBackupRoot);}}catch(_){} }
  function rollbackTo(activation,reason){
    if(fs.existsSync(recoveryFile))return recoverRollback().restored;
    if(!activation||!activation.dbSnapshot)throw failure('UPDATE_DB_ROLLBACK_INVALID','Geri alma checkpointi gerekli. / Rollback checkpoint is required.');
    if(activation.backendFenceVersion!==1)throw failure('UPDATE_DB_ROLLBACK_LEGACY_UNVERIFIED','Eski denemenin yazıcı kimliği doğrulanamıyor; checkpoint korundu. / The legacy trial writer identity cannot be verified; checkpoint preserved.');
    assertOffline(activation.backendPids||[],activation.token);
    const checkpoint=validateSnapshot(activation.dbSnapshot),previous=desiredPointer(activation.previous),state=readState(),stageRoot=path.join(checkpoint.root,'restore');ensureDir(stageRoot);
    const members=[];
    for(const item of checkpoint.files){
      const staged=path.join(stageRoot,item.name);
      if(item.exists){fs.copyFileSync(path.join(checkpoint.root,item.name),staged);const fd=fs.openSync(staged,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
      else try{fs.unlinkSync(staged);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!same(fingerprint(staged),item))throw failure('UPDATE_DB_ROLLBACK_INVALID','Geri alma hazırlığı doğrulanamadı. / Rollback staging could not be verified.');
      members.push({name:item.name,before:fingerprint(targetFor(item.name)),after:{exists:item.exists,size:item.size,sha256:item.sha256}});
    }
    const finalState={...state,schemaVersion:1,state:'ROLLBACK',activation:null,pending:null,currentVersion:previous.version,lastKnownGoodVersion:previous.version,
      failedVersions:failedRecord(activation,reason),lastError:{code:'UPDATE_HEALTH_FAILED',message:'Yeni sürüm başlatılamadı; önceki sürüme ve veri checkpointine dönüldü. / The new version failed; the previous version and data checkpoint were restored.',...(activation.manualPatch?{manualPatch:activation.manualPatch}:{})},
      ...(checkpoint.legacy?{rollbackLegacyCheckpoint:true}:{})};
    for(const [name,value]of [['current.json',previous],['state.json',finalState]]){
      const staged=path.join(stageRoot,name);atomicWriteJson(staged,value);members.push({name,before:fingerprint(targetFor(name)),after:fingerprint(staged)});
    }
    syncDirectory(stageRoot);
    atomicWriteJson(recoveryFile,{schemaVersion:1,kind:'rollback',activation,previous,snapshotRoot:checkpoint.root,stageRoot,members,backendPids:activation.backendPids||[],reason:String(reason||'health-check-failed'),createdAt:now()});
    transition('rollback-intent');
    return recoverRollback().restored;
  }
  function rollbackExistingTrial(){
    if(fs.existsSync(recoveryFile))return recoverRollback();
    const state=readState(),a=state.activation;if(!a||a.status!=='trial')return null;
    return {failed:a,restored:rollbackTo(a,a.rollbackReason||'previous-launch-unconfirmed')};
  }
  function requestRollback(activation,reason){
    const state=readState();if(!activation||!state.activation||state.activation.token!==activation.token)return false;
    writeState({state:'ROLLBACK_PENDING',activation:{...state.activation,rollbackReason:String(reason||'health-check-failed'),backendPids:backendPids()}});
    return true;
  }
  function activatePending(){
    const state=readState(),pending=state.pending;if(!pending||!pending.ready)return null;
    const pendingCore=localizeManagedCore(pending.appCoreRoot,pending.version);
    if(!pendingCore){writeState({state:'FAILED',pending:null,lastError:{code:'UPDATE_PENDING_INVALID',message:'Hazır update klasörü doğrulanamadı.'}});return null;}
    assertOffline();
    const serverEntry=path.join(pendingCore,'server','server.js');
    if(fs.existsSync(serverEntry)&&!fs.readFileSync(serverEntry,'utf8').startsWith("require('./lib/update-trial-backend').waitForTrialBackend();")){writeState({state:'FAILED',lastError:{code:'UPDATE_RECOVERY_PROTOCOL_REQUIRED',message:'Bu paket güvenli geri alma protokolünü desteklemiyor; güncel imzalı paketi seçin. / This package lacks the safe rollback protocol; select a current signed package.'}});return null;}
    const previous=currentPointer(),token=makeToken();
    let dbSnapshot=null;try{dbSnapshot=snapshotLocalDb(token);}catch(error){writeState({state:'FAILED',lastError:{code:'UPDATE_DB_CHECKPOINT_FAILED',message:'Yerel veri rollback checkpointi alınamadı; update uygulanmadı.'}});return null;}
    const activation={status:'trial',backendFenceVersion:1,token,version:pending.version,sha256:pending.sha256||'',previous,dbSnapshot,startedAt:now(),pid:process.pid,...(pending.manualPatch?{manualPatch:pending.manualPatch}:{})};
    // Journal the trial before selecting its app core. A restart can always
    // recover an interrupted pointer transition from this durable checkpoint.
    writeState({state:'INSTALLING',activation,currentVersion:pending.version});
    transition('activation-state');
    const next=writePointer({version:pending.version,appCoreRoot:pendingCore,source:'managed'});
    transition('activation-pointer');
    return {activation,selected:next};
  }

  function confirmHealth(expectedToken,info={}){
    const state=readState(),trial=state.activation;if(!trial||trial.status!=='trial'||trial.token!==expectedToken||state.state==='ROLLBACK_PENDING'||trial.rollbackReason||fs.existsSync(recoveryFile))return false;
    if(String(info.version||'')!==trial.version)return false;
    if(info.backendReady!==true||info.rendererReady!==true||info.localDbReady!==true)return false;
    const failed={...(state.failedVersions||{})};if(failed[trial.version]?.sha256===trial.sha256)delete failed[trial.version];
    writeState({state:'SUCCESS',activation:null,pending:null,currentVersion:trial.version,lastKnownGoodVersion:trial.version,failedVersions:failed,lastError:null,lastHealthAt:now(),lastConfirmedTrial:{token:trial.token,version:trial.version,appCoreRoot:currentPointer().appCoreRoot}});removeDbSnapshot(trial.dbSnapshot);removeTrialLedger(trial.token);return true;
  }
  return {bootstrapCore,portableRoot,localDataRoot,localUpdaterRoot,versionsRoot,currentFile,stateFile,packageVersion,validManagedCore,bootstrapPointer,currentPointer,writePointer,readState,writeState,rollbackExistingTrial,activatePending,rollbackNow:rollbackTo,requestRollback,confirmHealth};
}
module.exports={createLauncherState,readStateFile};
