'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const S=require('./signature'),F=require('./files');
const {loadTrustedKeys}=require('../update/signature');
const {compareSemver}=require('../update/semver');
const {createLauncherState,readStateFile}=require('../update/launcher-state');
const {atomicWriteJson,atomicWriteBuffer,syncDirectory}=require('../update/json-store');
const {listZipEntries,extractZipSafe}=require('../update/zip');
const INTEGRITY='electron/app-integrity.json';
function manifestHash(m){return F.sha(Buffer.from(JSON.stringify([S.signedPayload(m).toString('base64'),m.signature])));}
function mismatch(code='PATCH_BASE_MISMATCH'){S.fail(code,'Yama kurulu sürümle uyuşmuyor; güncel imzalı paketi seçin.','The patch does not match this installation; select a current signed package.');}
function createInstalledManager({bootstrapCore,trustRoot=bootstrapCore,portableRoot,onTransition=()=>{},beforeCommit=null}){
 // trustRoot: imza anahtarları, bootstrap.json ve doğrulayıcı dosyaları (çalışan launcher);
 // bootstrapCore: kurulum kökü (sürüm pointer'ı ve geri dönüş çekirdeği).
 bootstrapCore=path.resolve(bootstrapCore);trustRoot=path.resolve(trustRoot);portableRoot=path.resolve(portableRoot);
 const versionsRoot=path.join(portableRoot,'.buyerlog-versions'),stateFile=path.join(portableRoot,'data/local/updater/state.json');
 function readState(){try{return readStateFile(stateFile);}catch(_){mismatch('PATCH_STATE_INVALID');}}
 function authenticate(m){
  S.verifyManifest(m,loadTrustedKeys(trustRoot));F.readBootstrap(trustRoot);
  if(compareSemver(S.BOOTSTRAP_VERSION,m.minimumBootstrapVersion)<0||F.bootstrapHash(trustRoot)!==m.bootstrapSha256)mismatch('PATCH_BOOTSTRAP_REQUIRED');
 }
 function managedCore(core){
  const relative=path.relative(versionsRoot,path.resolve(core)),parts=relative.split(path.sep);
  if(parts.length!==2||!/^manual-[A-Za-z0-9._-]+$/.test(parts[0])||parts[1]!=='app')mismatch('PATCH_PATH_UNSAFE');
  let folder=versionsRoot;for(const part of ['',...parts]){if(part)folder=path.join(folder,part);const stat=fs.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink())mismatch('PATCH_PATH_UNSAFE');}
  return path.resolve(core);
 }
 function verifyCore(core,m){
  for(const expected of m.files){const actual=F.metadata(core,expected.path);if(actual.size!==expected.size||actual.sha256!==expected.sha256)mismatch('PATCH_FILE_MISMATCH');}
  if(F.inventory(core,{exclude:relative=>relative===F.RECEIPT}).length!==m.files.length)mismatch('PATCH_FILE_MISMATCH');
 }
 function verifyStaged(pending){
  const core=managedCore(pending.appCoreRoot),receipt=F.readJsonStrict(F.regularFile(core,F.RECEIPT)),m=receipt.manifest;
  authenticate(m);
  if(pending.version!==m.baseVersion||pending.sha256!==m.artifact.sha256||pending.manualPatch?.sequence!==m.sequence||pending.manualPatch.manifestSha256!==manifestHash(m))mismatch('PATCH_STAGED_INVALID');
  const state=readState(),key=m.baseVersion+':'+m.baseSourceCommit;
  if(state?.manualPatchWatermarks?.[key]!==m.sequence)mismatch('PATCH_REPLAY');
  verifyCore(core,m);return {manifest:m,core};
 }
 function verifyInstalled(selected){
  const core=managedCore(selected.appCoreRoot),receipt=F.readJsonStrict(F.regularFile(core,F.RECEIPT)),m=receipt.manifest;
  authenticate(m);
  if(selected.version!==m.baseVersion||(readState()?.manualPatchWatermarks?.[m.baseVersion+':'+m.baseSourceCommit]||0)<m.sequence)mismatch('PATCH_REPLAY');
  verifyCore(core,m);return {manifest:m,core};
 }
 function context(m){
  authenticate(m);const saved=readState(),lifecycle=createLauncherState({bootstrapCore,portableRoot}),current=lifecycle.currentPointer(),anchor=F.readBootstrap(current.appCoreRoot);
  if(current.version!==m.baseVersion||anchor.sourceCommit!==m.baseSourceCommit)mismatch();
  if(saved?.activation)S.fail('PATCH_UPDATE_BUSY','Önce mevcut güncelleme denemesini tamamlayın.','Complete the current update trial first.');
  const key=m.baseVersion+':'+m.baseSourceCommit,watermark=saved?.manualPatchWatermarks?.[key]||0;
  if(m.sequence<=watermark){
   if(saved?.pending?.ready&&saved.pending.manualPatch?.manifestSha256===manifestHash(m)){verifyStaged(saved.pending);return {alreadyPrepared:true,pending:saved.pending};}
   S.fail('PATCH_REPLAY','Bu yama sırası daha önce kabul edildi; eski yama uygulanamaz.','This patch sequence was already accepted; an older patch cannot be applied.');
  }
  if(saved?.pending)S.fail('PATCH_UPDATE_BUSY','Bekleyen güncellemeyi önce tamamlayın.','Complete the pending update first.');
  return {lifecycle,current,key,saved,savedHash:F.sha(Buffer.from(JSON.stringify(saved)))};
 }
 function preview(m){const state=context(m);return {sequence:m.sequence,baseVersion:m.baseVersion,sourceCommit:m.sourceCommit,releaseNotes:m.releaseNotes,changes:m.changes.length,alreadyPrepared:state.alreadyPrepared===true};}
 function apply(m,archiveFile){
  context(m); // Signature and installed trust boundary precede any archive read.
  const kernel=require(path.join(trustRoot,'electron/manual-patch/kernel/shared-file-transaction.js'));
  return kernel.withFileLeaseSync(stateFile,()=>{
   const c=context(m);if(c.alreadyPrepared)return {ok:true,alreadyPrepared:true,pending:c.pending};
   const sourceCore=c.current.appCoreRoot,files=new Map(m.files.map(file=>[file.path,file]));
   for(const change of m.changes){let before=null;try{before=F.metadata(sourceCore,change.path).sha256;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!change.beforeSha256.includes(before))mismatch('PATCH_FILE_CONFLICT');
   }
   const archiveStat=fs.lstatSync(archiveFile);if(!archiveStat.isFile()||archiveStat.isSymbolicLink()||archiveStat.size!==m.artifact.size)mismatch('PATCH_ARCHIVE_MISMATCH');
   const archiveBytes=fs.readFileSync(archiveFile);if(F.sha(archiveBytes)!==m.artifact.sha256)mismatch('PATCH_ARCHIVE_MISMATCH');
   const changes=m.changes.filter(change=>change.kind==='replace');
   const stage=fs.mkdtempSync(path.join(versionsRoot,'.manual-stage-')),nonce=crypto.randomUUID(),payload=path.join(stage,'unpacked'),core=path.join(stage,'app');
   fs.writeFileSync(path.join(stage,'.owner'),nonce,{flag:'wx'});let renamed=false;
   try{
    const cachedArchive=path.join(stage,'verified.zip');atomicWriteBuffer(cachedArchive,archiveBytes);
    const listing=listZipEntries(cachedArchive,{maxFiles:S.MAX_FILES,maxBytes:S.MAX_BYTES}),expected=new Set(changes.map(change=>'payload/'+change.path)),seen=new Set();
    for(const entry of listing.entries){if(!expected.has(entry.name)||seen.has(entry.name)||entry.uncompressed!==files.get(entry.name.slice(8)).size)mismatch('PATCH_ARCHIVE_MISMATCH');seen.add(entry.name);}
    if(seen.size!==expected.size)mismatch('PATCH_ARCHIVE_MISMATCH');
    extractZipSafe(cachedArchive,payload,{maxFiles:S.MAX_FILES,maxBytes:S.MAX_BYTES});
    const changed=new Set(changes.map(change=>change.path));
    for(const expectedFile of m.files){
     let buffer;
     if(expectedFile.path===INTEGRITY)buffer=F.integrityBytes(m.files,m.baseVersion);
     else buffer=F.bytes(changed.has(expectedFile.path)?path.join(payload,'payload'):sourceCore,expectedFile.path);
     if(buffer.length!==expectedFile.size||F.sha(buffer)!==expectedFile.sha256)mismatch('PATCH_FILE_MISMATCH');
     atomicWriteBuffer(path.join(core,...expectedFile.path.split('/')),buffer);
    }
    atomicWriteJson(path.join(core,...F.RECEIPT.split('/')),{schemaVersion:1,manifest:m});verifyCore(core,m);
    const final=path.join(versionsRoot,`manual-${m.sequence}-${m.artifact.sha256.slice(0,16)}-${crypto.randomBytes(4).toString('hex')}`);
    if(path.dirname(final)!==path.resolve(versionsRoot))mismatch('PATCH_PATH_UNSAFE');fs.renameSync(stage,final);syncDirectory(versionsRoot);renamed=true;
    onTransition('candidate-staged');beforeCommit?.();
    if(F.sha(Buffer.from(JSON.stringify(readState())))!==c.savedHash)mismatch('PATCH_STATE_CHANGED');
    kernel.assertHeldFileLeases();
    const pending={ready:true,version:m.baseVersion,sha256:m.artifact.sha256,appCoreRoot:path.join(final,'app'),manualPatch:{sequence:m.sequence,sourceCommit:m.sourceCommit,baseSourceCommit:m.baseSourceCommit,manifestSha256:manifestHash(m)}};
    c.lifecycle.writeState({state:'READY_TO_INSTALL',pending,manualPatchWatermarks:{...(c.saved?.manualPatchWatermarks||{}),[c.key]:m.sequence}});
    kernel.assertHeldFileLeases();onTransition('pending-committed');return {ok:true,pending};
   }finally{
    // A renamed candidate may be referenced by an uncertain state write. Keep it.
    if(!renamed){const relative=path.relative(versionsRoot,stage);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(stage)!==path.resolve(versionsRoot)||fs.readFileSync(path.join(stage,'.owner'),'utf8')!==nonce)throw Error('Unsafe patch cleanup');fs.rmSync(stage,{recursive:true,force:true});}
   }
  });
 }
 return {preview,apply,verifyStaged,verifyInstalled};
}
module.exports={createInstalledManager,manifestHash};
