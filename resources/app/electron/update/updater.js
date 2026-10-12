'use strict';
const fs=require('fs');
const path=require('path');
const { parseReleaseManifest }=require('./manifest');
const { compareSemver }=require('./semver');
const { sha256File }=require('./crypto');
const { extractZipSafe }=require('./zip');
const { readJson,atomicWriteJson,ensureDir }=require('./json-store');
const { FolderReleaseProvider,expandEnv }=require('./folder-provider');
const { GitHubReleaseProvider,parseGitHubSource }=require('./github-provider');
const { loadTrustedKeys,verifyManifestSignature }=require('./signature');

const STATES=Object.freeze({IDLE:'IDLE',CHECKING:'CHECKING',UPDATE_AVAILABLE:'UPDATE_AVAILABLE',DOWNLOADING:'DOWNLOADING',VERIFYING:'VERIFYING',READY_TO_INSTALL:'READY_TO_INSTALL',INSTALLING:'INSTALLING',SUCCESS:'SUCCESS',FAILED:'FAILED',ROLLBACK:'ROLLBACK'});
function updaterError(message,code='UPDATE_FAILED',extra={}){return Object.assign(new Error(message),{code,...extra});}
function sanitizeSource(value){return String(value||'').trim().slice(0,4096);}
function defaultState(currentVersion){return {schemaVersion:1,state:STATES.IDLE,currentVersion,lastKnownGoodVersion:currentVersion,lastSuccessfulCheck:null,lastCheck:null,latestVersion:null,pending:null,activation:null,failedVersions:{},lastError:null};}
function diskFreeBytes(dir){try{const info=fs.statfsSync(dir);return Number(info.bavail)*Number(info.bsize);}catch(_){return null;}}
function rmSafe(target){try{fs.rmSync(target,{recursive:true,force:true});}catch(_){} }

class BuyerLogUpdater{
  constructor(options={}){
    this.currentVersion=String(options.currentVersion||''); this.updaterVersion=String(options.updaterVersion||'1.0.0');
    this.appCoreRoot=path.resolve(options.appCoreRoot); this.portableRoot=path.resolve(options.portableRoot); this.localDataRoot=path.resolve(options.localDataRoot);
    this.packaged=options.packaged===true; this.log=typeof options.log==='function'?options.log:()=>{}; this.running=null; this.runningKey='';
    this.opsRoot=path.join(this.portableRoot,'.buyerlog-updater'); this.versionsRoot=path.join(this.portableRoot,'.buyerlog-versions');
    this.localRoot=path.join(this.localDataRoot,'updater'); this.configFile=path.join(this.localRoot,'config.json'); this.stateFile=path.join(this.localRoot,'state.json');
    this.currentFile=path.join(this.localRoot,'current.json'); this.logFile=path.join(this.localRoot,'updater.log'); this.cacheRoot=path.join(this.opsRoot,'cache'); this.stagingRoot=path.join(this.opsRoot,'staging');
    [this.opsRoot,this.versionsRoot,this.localRoot,this.cacheRoot,this.stagingRoot].forEach(ensureDir);
    if(!fs.existsSync(this.stateFile)) atomicWriteJson(this.stateFile,defaultState(this.currentVersion));
    this.cleanup();
  }
  appendLog(event,meta={}){
    const clean={}; for(const [k,v] of Object.entries(meta||{})){if(/token|secret|password|cookie|authorization/i.test(k))continue;clean[k]=v;}
    const line=JSON.stringify({at:new Date().toISOString(),event,...clean}); try{fs.appendFileSync(this.logFile,line+'\n','utf8');}catch(_){} this.log('Updater: '+event+(clean.code?' · '+clean.code:''));
  }
  trustedKeys(){return loadTrustedKeys(this.appCoreRoot);}
  state(){const value=readJson(this.stateFile,null);return value&&value.schemaVersion===1?value:defaultState(this.currentVersion);}
  saveState(patch){const next={...this.state(),...patch,currentVersion:this.currentVersion};atomicWriteJson(this.stateFile,next);return next;}
  config(base={}){
    const local=readJson(this.configFile,{})||{};
    const bundled=readJson(path.join(this.appCoreRoot,'electron','update','release-source.json'),{})||{};
    const migration=String(bundled.githubSource||'');
    if(migration)parseGitHubSource(migration);
    const prior=local.releaseSource??process.env.BUYER_LOG_RELEASE_SOURCE??base.releaseSource??'';
    const source=migration&&prior&&!String(prior).startsWith('github:')?migration:(prior||migration);
    const channel=String(local.channel||process.env.BUYER_LOG_UPDATE_CHANNEL||base.channel||'stable').toLowerCase();
    return {enabled:(local.enabled??base.enabled??true)!==false,provider:String(source).startsWith('github:')?'github':'folder',releaseSource:sanitizeSource(source),channel:['stable','test'].includes(channel)?channel:'stable',checkIntervalHours:Math.max(1,Number(local.checkIntervalHours??base.checkIntervalHours??6)||6),startupDelayMs:Math.max(0,Number(local.startupDelayMs??base.startupDelayMs??0)||0)};
  }
  configure(patch,base={}){
    const before=this.config(base), next={...before};
    if(Object.prototype.hasOwnProperty.call(patch,'enabled'))next.enabled=patch.enabled!==false;
    if(Object.prototype.hasOwnProperty.call(patch,'releaseSource'))next.releaseSource=sanitizeSource(patch.releaseSource);
    if(Object.prototype.hasOwnProperty.call(patch,'channel')){const c=String(patch.channel||'').toLowerCase();if(!['stable','test'].includes(c))throw updaterError('Update channel geçersiz.','UPDATE_CHANNEL_INVALID');next.channel=c;}
    atomicWriteJson(this.configFile,next); this.appendLog('config-updated',{channel:next.channel,source:next.releaseSource?'<configured>':'<empty>'}); return next;
  }
  status(base={},effectiveChannel=''){
    const config=this.config(base),state=this.state();
    return {enabled:config.enabled,configured:Boolean(config.releaseSource),releaseSource:config.releaseSource,channel:effectiveChannel||config.channel,currentVersion:this.currentVersion,updaterVersion:this.updaterVersion,state:state.state,lastSuccessfulCheck:state.lastSuccessfulCheck,lastCheck:state.lastCheck,latestVersion:state.latestVersion,pendingVersion:state.pending&&state.pending.version||null,pendingReady:Boolean(state.pending&&state.pending.ready),mandatory:Boolean(state.pending&&state.pending.mandatory),releaseNotes:state.pending&&state.pending.releaseNotes||'',lastError:state.lastError||null,failedVersions:state.failedVersions||{}};
  }
  async _run(fn,key){while(this.running){if(this.runningKey===key)return this.running;await this.running.catch(()=>{});}this.runningKey=key;this.running=(async()=>{try{return await fn();}finally{this.running=null;this.runningKey='';}})();return this.running;}
  async checkAndStage(options={}){const config=this.config(options.baseConfig||{}),key=JSON.stringify([config.releaseSource,config.enabled,options.channel||config.channel,options.manual===true,options.allowDevelopment===true,options.retryFailed===true,options.retryVersion||'',options.retrySha256||'',options.retryChannel||'']);return this._run(()=>this._checkAndStage(options),key);}
  async _checkAndStage(options={}){
    const base=options.baseConfig||{},config=this.config(base),channel=String(options.channel||config.channel||'stable');
    if(!this.packaged&&!options.allowDevelopment)return {ok:true,disabled:true,reason:'development',...this.status(base,channel)};
    if(!config.enabled)return {ok:true,disabled:true,reason:'disabled',...this.status(base,channel)};
    if(!config.releaseSource){const st=this.saveState({state:STATES.IDLE,lastCheck:new Date().toISOString(),lastError:null});return {ok:true,unconfigured:true,...this.status(base,channel),state:st.state};}
    this.saveState({state:STATES.CHECKING,lastCheck:new Date().toISOString(),lastError:null}); this.appendLog('check-started',{channel,currentVersion:this.currentVersion,source:expandEnv(config.releaseSource)});
    try{
      const provider=config.provider==='github'?new GitHubReleaseProvider(config.releaseSource,{timeoutMs:5000}):new FolderReleaseProvider(config.releaseSource,{timeoutMs:5000}),loaded=await provider.readManifest(channel),manifest=parseReleaseManifest(JSON.parse(loaded.raw),channel);
      // Authenticity before any download: keys come from the RUNNING app core only.
      const signature=verifyManifestSignature(manifest,this.trustedKeys());
      await options.assertCheckAuthority?.();
      this.appendLog(signature.verified?'signature-ok':'signature-not-enforced',{version:manifest.version,keyId:signature.keyId||''});
      if(compareSemver(this.updaterVersion,manifest.minimumUpdaterVersion)<0)throw updaterError('Bu release daha yeni updater altyapısı gerektiriyor.','UPDATE_UPDATER_TOO_OLD',{required:manifest.minimumUpdaterVersion});
      const cmp=compareSemver(manifest.version,this.currentVersion),now=new Date().toISOString();
      if(cmp<=0){this.saveState({state:STATES.IDLE,lastSuccessfulCheck:now,latestVersion:manifest.version,lastError:null});this.appendLog('check-current',{channel,discoveredVersion:manifest.version});return {ok:true,current:true,manifest,...this.status(base,channel)};}
      const state=this.state(),failed=state.failedVersions&&state.failedVersions[manifest.version];
      if(options.retryFailed&&(options.manual!==true||options.retryVersion!==manifest.version||options.retrySha256!==manifest.sha256||options.retryChannel!==channel||!failed||failed.sha256!==manifest.sha256))throw updaterError('Yeniden denenecek sürüm veya kanal değişti. Güncel paketi kontrol edip yeniden seçin.','UPDATE_RETRY_TARGET_CHANGED');
      const staged=state.pending?.ready===true&&state.pending.version===manifest.version&&state.pending.sha256===manifest.sha256;
      if(failed&&failed.sha256===manifest.sha256&&!options.retryFailed&&!staged){this.saveState({state:STATES.FAILED,lastSuccessfulCheck:now,latestVersion:manifest.version,lastError:{code:'UPDATE_FAILED_VERSION_BLOCKED',message:'Bu sürüm önceki health check sırasında başarısız oldu.'}});return {ok:false,blocked:true,manifest,...this.status(base,channel)};}
      this.saveState({state:STATES.UPDATE_AVAILABLE,lastSuccessfulCheck:now,latestVersion:manifest.version,lastError:null});
      this.appendLog('update-available',{channel,discoveredVersion:manifest.version});
      await this.prepare(provider,manifest,options);
      return {ok:true,available:true,manifest,...this.status(base,channel)};
    }catch(error){
      const cause=error&&error.cause||null;
      const detail={code:error.code||'UPDATE_CHECK_FAILED',message:String(error.message||'Güncelleme kontrolü başarısız oldu.').slice(0,500)};
      const transportCode=String(error.transportCode||cause&&cause.code||'').slice(0,120);
      const transportMessage=String(error.transportMessage||cause&&cause.message||'').slice(0,500);
      const transport=String(error.transport||cause&&cause.transport||'').slice(0,80);
      const artifactSource=String(error.artifactSource||cause&&cause.artifactSource||'').slice(0,80);
      if(transportCode)detail.transportCode=transportCode;
      if(transportMessage)detail.transportMessage=transportMessage;
      if(transport)detail.transport=transport;
      if(artifactSource)detail.artifactSource=artifactSource;
      this.saveState({state:STATES.FAILED,lastError:detail});this.appendLog('check-failed',detail);if(options.manual)throw Object.assign(error,detail);return {ok:false,offline:true,error:detail,...this.status(base,channel)};
    }
  }
  async prepare(provider,manifest,options={}){
    verifyManifestSignature(manifest,this.trustedKeys());
    const versionKey=manifest.version.replace(/[^0-9A-Za-z._-]/g,'_'),cacheFile=path.join(this.cacheRoot,`${versionKey}-${manifest.sha256.slice(0,12)}.zip`),partial=cacheFile+'.partial';
    let reuse=false;
    if(fs.existsSync(cacheFile)){const hash=await sha256File(cacheFile);reuse=hash===manifest.sha256;if(!reuse)rmSafe(cacheFile);}
    if(!reuse){
      this.saveState({state:STATES.DOWNLOADING});rmSafe(partial);this.appendLog('download-started',{version:manifest.version});
      try{
        await provider.copyArtifact(manifest.channel,manifest.artifact,partial,manifest.version);
      }catch(error){
        rmSafe(partial);
        throw updaterError('Update paketi kopyalanamadı.','UPDATE_DOWNLOAD_FAILED',{
          cause:error,
          transportCode:String(error&&error.code||'').slice(0,120),
          transportMessage:String(error&&error.message||'').slice(0,500),
          transport:String(error&&error.transport||'').slice(0,80),
          artifactSource:String(error&&error.artifactSource||'').slice(0,80),
        });
      }
      fs.renameSync(partial,cacheFile);
    }
    const stat=fs.statSync(cacheFile);if(stat.size!==manifest.size){rmSafe(cacheFile);throw updaterError('Update paket boyutu manifest ile eşleşmiyor.','UPDATE_SIZE_MISMATCH');}
    this.saveState({state:STATES.VERIFYING});const actual=await sha256File(cacheFile);if(actual!==manifest.sha256){rmSafe(cacheFile);throw updaterError('Update SHA-256 doğrulaması başarısız.','UPDATE_SHA256_MISMATCH');}this.appendLog('checksum-ok',{version:manifest.version});
    const free=diskFreeBytes(this.opsRoot);if(free!=null&&free<manifest.size*3)throw updaterError('Update için yeterli boş disk alanı yok.','UPDATE_DISK_SPACE');
    const versionRoot=path.join(this.versionsRoot,versionKey),appTarget=path.join(versionRoot,'app'),releaseFile=path.join(versionRoot,'release.json');
    if(fs.existsSync(appTarget)){
      const existing=readJson(releaseFile,null);if(!existing||existing.sha256!==manifest.sha256)throw updaterError('Aynı version için farklı binary zaten mevcut.','UPDATE_VERSION_IMMUTABLE');
    }else{
      const stage=path.join(this.stagingRoot,versionKey+'.partial-'+process.pid+'-'+Date.now());rmSafe(stage);ensureDir(stage);
      try{extractZipSafe(cacheFile,stage,{maxFiles:30000,maxBytes:1024*1024*1024});const appDir=path.join(stage,'app'),pkg=readJson(path.join(appDir,'package.json'),null);if(!pkg||pkg.version!==manifest.version)throw updaterError('Artifact package.json version manifest ile eşleşmiyor.','UPDATE_PACKAGE_VERSION_MISMATCH');for(const required of ['electron/main.js','server/server.js','public/index.html'])if(!fs.existsSync(path.join(appDir,...required.split('/'))))throw updaterError('Update paketi eksik: '+required,'UPDATE_PACKAGE_INCOMPLETE');ensureDir(this.versionsRoot);fs.renameSync(stage,versionRoot);atomicWriteJson(releaseFile,manifest);}catch(error){rmSafe(stage);throw error;}
    }
    await options.assertCheckAuthority?.();
    const pending={version:manifest.version,sha256:manifest.sha256,channel:manifest.channel,mandatory:manifest.mandatory,releaseNotes:manifest.releaseNotes,ready:true,versionRoot,appCoreRoot:appTarget,preparedAt:new Date().toISOString()};
    this.saveState({state:STATES.READY_TO_INSTALL,pending,lastError:null});this.appendLog('ready-to-install',{version:manifest.version});this.cleanup();return pending;
  }
  cleanup(){
    const st=this.state(),keep=new Set([this.currentVersion,st.lastKnownGoodVersion,st.pending&&st.pending.version].filter(Boolean));
    try{for(const name of fs.readdirSync(this.versionsRoot)){if(keep.has(name))continue;const release=readJson(path.join(this.versionsRoot,name,'release.json'),null);if(release&&keep.has(release.version))continue;rmSafe(path.join(this.versionsRoot,name));}}catch(_){}
    try{for(const name of fs.readdirSync(this.cacheRoot)){const full=path.join(this.cacheRoot,name);if(name.includes('.partial')){rmSafe(full);continue;}const retained=[...keep].some(version=>name.startsWith(String(version).replace(/[^0-9A-Za-z._-]/g,'_')+'-'));if(!retained)rmSafe(full);}}catch(_){}
    try{for(const name of fs.readdirSync(this.stagingRoot)){if(name.includes('.partial-'))rmSafe(path.join(this.stagingRoot,name));}}catch(_){}
  }
}
module.exports={BuyerLogUpdater,STATES,defaultState,updaterError};
