'use strict';
/* Sentetik portable Buyer Log kurulumu: gerçek eski launcher dosyaları, güncel
 * stage-0/launcher-core ve imzalı release yapısındaki çekirdekler. Electron
 * yerine sahte "app" nesnesiyle gerçek launcher modülleri ayrı süreçte çalışır. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),child=require('node:child_process'),crypto=require('node:crypto');
const F=require('../../electron/manual-patch/files');
const APP=path.resolve(__dirname,'../..');
const LEGACY_10=path.join(__dirname,'..','fixtures','legacy-launcher-1.0.0');
const LEGACY_11=path.join(__dirname,'..','fixtures','legacy-launcher-1.1.0');
const KEYS=JSON.stringify({keys:[{publicKey:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}]});

/* Uygulama çekirdeğinin main.js'i: launcher'ın verdiği ortamı kaydeder, deneme
 * sağlığını onaylar ve (istenirse) gerçek main.js gibi sağlıklı oturumda
 * launcher altyapısını launcher-host ile eşitler. */
function mainSource(version){
  return `'use strict';
const fs=require('fs'),path=require('path');
const portable=path.dirname(process.execPath),local=path.join(portable,'data','local');
const rec={version:${JSON.stringify(version)},updater:process.env.BUYER_LOG_UPDATER_VERSION||'',host:process.env.BUYER_LOG_LAUNCHER_HOST||'',launcherId:process.env.BUYER_LOG_LAUNCHER_ID||'',trial:Boolean(process.env.BUYER_LOG_UPDATE_HEALTH_TOKEN),core:process.env.BUYER_LOG_ACTIVE_APP_CORE};
if(process.env.TEST_MAIN_WRITE_DB)fs.writeFileSync(path.join(local,'BuyerLogLocal.db'),process.env.TEST_MAIN_WRITE_DB);
if(process.env.TEST_MAIN_THROW===rec.version)throw new Error('synthetic main failure');
if(rec.trial){
  rec.health=global.__buyerLogLauncherHealthReady({version:rec.version,backendReady:true,rendererReady:true,localDbReady:true});
  rec.writesAllowed=require('./update/trial-backend').createTrialWritePolicy({env:{...process.env,BUYER_LOG_LOCAL_DATA_ROOT:local}}).isConfirmed();
}
if(process.env.TEST_SYNC==='1'){
  const stateFile=path.join(local,'updater','state.json'),state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{activation:null};
  if(!state.activation){
    try{rec.sync=require('./update/launcher-host').createLauncherHost({bootstrapCore:process.env.BUYER_LOG_BOOTSTRAP_APP_CORE,portableRoot:portable}).install({sourceCore:path.resolve(__dirname,'..'),sourceVersion:rec.version});}
    catch(error){rec.syncError=error.code||error.message;}
  }
}
fs.appendFileSync(process.env.TEST_OUT,JSON.stringify(rec)+'\\n');
`;
}

module.exports=function launcherFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-launcher-migration-'));
  t.after(()=>{const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('bl-launcher-migration-'))throw Error('Unsafe fixture cleanup');fs.rmSync(resolved,{recursive:true,force:true});});
  const portable=path.join(root,'installed'),base=path.join(portable,'resources','app'),local=path.join(portable,'data','local'),db=path.join(local,'BuyerLogLocal.db');
  const stateFile=path.join(local,'updater','state.json'),currentFile=path.join(local,'updater','current.json'),pointerFile=path.join(local,'updater','launcher.json'),out=path.join(root,'launches.jsonl');
  const write=(folder,relative,value)=>{const file=path.join(folder,...relative.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  const seal=(folder,version)=>write(folder,'electron/app-integrity.json',F.integrityBytes(F.inventory(folder),version));
  function appFiles(folder,version){
    write(folder,'package.json',JSON.stringify({name:'buyer-log-desktop',version,main:'electron/launcher.js'}));
    write(folder,'electron/main.js',mainSource(version));write(folder,'public/index.html','<h1>Buyer Log '+version+'</h1>');
    write(folder,'server/server.js',"require('./lib/update-trial-backend').waitForTrialBackend();\nmodule.exports=true;\n");
    for(const name of ['shared-file-transaction.js','lease-worker-registry.js','update-trial-backend.js'])write(folder,'server/lib/'+name,fs.readFileSync(path.join(APP,'server/lib',name)));
  }
  /* Güncel kaynak ağacından üretilen release çekirdeği (launcher 1.2.0 ve üstü). */
  function releaseCore(folder,version,{launcherVersion,minimumActivationLauncher}={}){
    appFiles(folder,version);
    for(const relative of F.BOOTSTRAP_FILES.filter(file=>!file.includes('/kernel/')))write(folder,relative,fs.readFileSync(path.join(APP,...relative.split('/'))));
    for(const relative of ['electron/update/launcher-host.js'])write(folder,relative,fs.readFileSync(path.join(APP,...relative.split('/'))));
    write(folder,'electron/update/release-signing-keys.json',KEYS);
    if(launcherVersion||minimumActivationLauncher){const info=JSON.parse(fs.readFileSync(path.join(APP,'electron/update/launcher-version.json'),'utf8'));write(folder,'electron/update/launcher-version.json',JSON.stringify({...info,...(launcherVersion?{launcherVersion}:{}),...(minimumActivationLauncher?{minimumActivationLauncher}:{})}));}
    F.stampBootstrap(folder,crypto.createHash('sha1').update(version).digest('hex'));seal(folder,version);return folder;
  }
  /* 7.0.294 tam kurulumu: gerçek updater 1.0.0 launcher dosyaları. */
  function legacy10Bootstrap(version='7.0.294'){
    appFiles(base,version);fs.cpSync(path.join(LEGACY_10,'electron'),path.join(base,'electron'),{recursive:true});seal(base,version);
  }
  /* 7.0.295–7.0.300 tam kurulumu: updater 1.1.0 giriş dosyası, launcher-core yok. */
  function legacy11Bootstrap(version='7.0.300'){
    releaseCore(base,version);fs.rmSync(path.join(base,'electron','launcher-core.js'));fs.rmSync(path.join(base,'electron','update','launcher-version.json'));
    write(base,'electron/launcher.js',fs.readFileSync(path.join(LEGACY_11,'electron','launcher.js')));fs.rmSync(path.join(base,'electron','update','launcher-host.js'));seal(base,version);
  }
  function stagePending(version,options={}){
    const core=releaseCore(path.join(portable,'.buyerlog-versions',version,'app'),version,options);
    const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{schemaVersion:1,state:'IDLE',currentVersion:'',lastKnownGoodVersion:'',activation:null,failedVersions:{}};
    write(local,'updater/state.json',JSON.stringify({...state,state:'READY_TO_INSTALL',pending:{version,sha256:'a'.repeat(64),channel:'stable',ready:true,versionRoot:path.dirname(core),appCoreRoot:core,preparedAt:new Date().toISOString()}}));
    return core;
  }
  function launch(env={}){
    const script=path.join(root,'launch.cjs');
    fs.writeFileSync(script,`const Module=require('node:module'),load=Module._load;Module._load=function(id){if(id==='electron')return {app:{isPackaged:true,setPath(){},requestSingleInstanceLock(){return true;},exit(){},quit(){},relaunch(){}},dialog:{}};return load.apply(this,arguments)};Object.defineProperty(process,'execPath',{value:${JSON.stringify(path.join(portable,'BuyerLog.exe'))}});require(${JSON.stringify(path.join(base,'electron','launcher.js'))});`);
    const before=fs.existsSync(out)?fs.readFileSync(out,'utf8').split('\n').filter(Boolean).length:0;
    const clean={...process.env};for(const key of Object.keys(clean))if(key.startsWith('BUYER_LOG_'))delete clean[key];
    const result=child.spawnSync(process.execPath,[script],{encoding:'utf8',env:{...clean,...env,TEST_OUT:out},timeout:30000});
    const lines=fs.existsSync(out)?fs.readFileSync(out,'utf8').split('\n').filter(Boolean):[];
    return {...result,record:lines.length>before?JSON.parse(lines[lines.length-1]):null};
  }
  const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  fs.mkdirSync(local,{recursive:true});fs.writeFileSync(db,'acknowledged business data');
  return {root,portable,base,local,db,stateFile,currentFile,pointerFile,write,seal,releaseCore,legacy10Bootstrap,legacy11Bootstrap,stagePending,launch,json,APP,LEGACY_10,LEGACY_11,
    state:()=>json(stateFile),pointer:()=>json(pointerFile),sha:file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
};
