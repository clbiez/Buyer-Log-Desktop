'use strict';
// Producer only. The installed consumer never loads code from an archive.
const fs=require('node:fs'),path=require('node:path');
const S=require('../electron/manual-patch/signature'),F=require('../electron/manual-patch/files');
const {createZipFromDirectory}=require('../electron/update/zip');
const {loadTrustedKeys}=require('../electron/update/signature');
const childProcess=require('node:child_process');
const INTEGRITY='electron/app-integrity.json';
const order=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0;
function immutable(){S.fail('PATCH_BOOTSTRAP_REQUIRED','Bu değişiklik için imzalı tam kurulum gerekli.','This change requires a signed full installation.');}
function buildPatch({baseRoot,sourceRoot,out,sequence,sourceCommit,privateKey,releaseNotes,acceptedBefore={},previousManifest=null}){
 baseRoot=path.resolve(baseRoot);sourceRoot=path.resolve(sourceRoot);out=path.resolve(out);
 const anchor=F.readBootstrap(baseRoot),base=new Map(F.inventory(baseRoot).map(file=>[file.path,file])),target=new Map(F.inventory(sourceRoot).map(file=>[file.path,file]));
 const pkg=JSON.parse(F.bytes(baseRoot,'package.json')),nextPkg=JSON.parse(F.bytes(sourceRoot,'package.json'));
 if(pkg.version!==nextPkg.version)immutable();
 if(previousManifest){
  acceptedBefore=historyFrom(previousManifest,baseRoot,sequence);
  const previous=new Map(previousManifest.files.map(file=>[file.path,file]));
  const runtimePaths=[...new Set([...previous.keys(),...target.keys()])].filter(relative=>S.mutablePath(relative)&&!relative.startsWith('public/release-notes/'));
  if(!runtimePaths.some(relative=>previous.get(relative)?.sha256!==target.get(relative)?.sha256))S.fail('PATCH_NO_RUNTIME_CHANGES','Önceki imzalı yamadan sonra çalışma zamanı değişmedi.','Runtime has not changed since the previous signed patch.');
 }
 target.set(F.ANCHOR,base.get(F.ANCHOR));
 // Generated immutable kernel comes from the installed full-bootstrap base.
 for(const relative of F.BOOTSTRAP_FILES.filter(file=>file.includes('/kernel/')))target.set(relative,base.get(relative));
 target.delete(INTEGRITY);
 for(const relative of new Set([...base.keys(),...target.keys()])){
  if(relative===INTEGRITY||S.mutablePath(relative))continue;
  if(!base.get(relative)||!target.get(relative)||base.get(relative).sha256!==target.get(relative).sha256)immutable();
 }
 const changes=[];
 for(const relative of [...new Set([...base.keys(),...target.keys(),...Object.keys(acceptedBefore)])].sort()){
  if(!S.mutablePath(relative))continue;
  const before=base.get(relative),after=target.get(relative),history=acceptedBefore[relative];
  if(before?.sha256===after?.sha256&&!history)continue;
  const hashes=[...new Set([before?.sha256||null,after?.sha256||null,...(history||[])])].sort((a,b)=>(a||'')<(b||'')?-1:(a||'')>(b||'')?1:0);
  changes.push({path:relative,kind:after?'replace':'delete',beforeSha256:hashes});
 }
 if(!changes.some(change=>!change.path.startsWith('public/release-notes/')))S.fail('PATCH_NO_RUNTIME_CHANGES','Yayımlanacak çalışma zamanı değişikliği yok.','There are no runtime changes to publish.');
 const files=[...target.values()].sort(order),integrity=F.integrityBytes(files,pkg.version);
 files.push({path:INTEGRITY,size:integrity.length,sha256:F.sha(integrity)});files.sort(order);
 fs.mkdirSync(out,{recursive:true});const temp=fs.mkdtempSync(path.join(out,'.signed-patch-build-'));
 const payload=path.join(temp,'payload');fs.mkdirSync(payload);
 try{
  for(const change of changes)if(change.kind==='replace'){
   const file=path.join(payload,...change.path.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,F.bytes(sourceRoot,change.path));
  }
  const name=`BuyerLog-SignedPatch-${pkg.version}-${sequence}.zip`,archive=path.join(temp,name);
  createZipFromDirectory(payload,archive,{rootPrefix:'payload'});
  const zipBytes=fs.readFileSync(archive);
  const manifest=S.signManifest({schema:S.SCHEMA,product:S.PRODUCT,sequence,baseVersion:pkg.version,baseSourceCommit:anchor.sourceCommit,sourceCommit,minimumBootstrapVersion:S.BOOTSTRAP_VERSION,
   bootstrapSha256:F.bootstrapHash(baseRoot),artifact:{name,size:zipBytes.length,sha256:F.sha(zipBytes)},files,changes,releaseNotes},privateKey);
  S.verifyManifest(manifest,loadTrustedKeys(baseRoot));
  const manifestName=name.replace(/\.zip$/,'.json'),manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  for(const [filename,buffer]of [[name,zipBytes],[manifestName,manifestBytes]]){
   const destination=path.join(out,filename);
   if(fs.existsSync(destination)){if(F.sha(fs.readFileSync(destination))!==F.sha(buffer))S.fail('PATCH_OUTPUT_IMMUTABLE','Aynı yama sırası farklı içerikle mevcut.','The same patch sequence already has different content.');}
   else fs.writeFileSync(destination,buffer,{flag:'wx'});
  }
  return {manifest,manifestFile:path.join(out,manifestName),archiveFile:path.join(out,name)};
 }finally{
  // Only the exact mkdtemp child under the resolved output directory is owned.
  const relative=path.relative(out,temp);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(temp)!==out)throw Error('Unsafe producer cleanup');
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
function historyFrom(previous,baseRoot,sequence){
 const anchor=F.readBootstrap(baseRoot),acceptedBefore={};
 if(sequence===1){if(previous)S.fail('PATCH_HISTORY_INVALID','İlk yama geçmiş içeremez.','The first patch cannot have a predecessor.');return acceptedBefore;}
 if(!previous)S.fail('PATCH_HISTORY_REQUIRED','Önceki imzalı yama tanımı gerekli.','The previous signed patch manifest is required.');
 S.verifyManifest(previous,loadTrustedKeys(baseRoot));
 if(previous.sequence!==sequence-1||previous.baseVersion!==JSON.parse(F.bytes(baseRoot,'package.json')).version||previous.baseSourceCommit!==anchor.sourceCommit||previous.bootstrapSha256!==F.bootstrapHash(baseRoot))S.fail('PATCH_HISTORY_INVALID','Yama geçmişi bu kurulum ve sıra ile uyuşmuyor.','Patch history does not match this installation and sequence.');
 const files=new Map(previous.files.map(file=>[file.path,file.sha256]));
 for(const change of previous.changes)acceptedBefore[change.path]=[...new Set([...change.beforeSha256,files.get(change.path)||null])];
 return acceptedBefore;
}
function main(argv=process.argv.slice(2)){
 const opts={};for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||!argv[i+1]||Object.hasOwn(opts,argv[i]))throw Error('Invalid signed-patch arguments');opts[argv[i]]=argv[i+1];}
 const allowed=['--base-app','--source-app','--out','--sequence','--source-commit','--notes','--previous'];
 if(Object.keys(opts).some(key=>!allowed.includes(key))||allowed.slice(0,6).some(key=>!opts[key]))throw Error('Usage: signed-manual-patch.js --base-app <verified extracted app> --source-app <app> --out <dir> --sequence <n> --source-commit <sha> --notes <TR/EN JSON> [--previous <signed manifest>]');
 const sequence=Number(opts['--sequence']),baseRoot=path.resolve(opts['--base-app']);
 const sourceRoot=path.resolve(opts['--source-app']),git=args=>childProcess.execFileSync('git',args,{cwd:sourceRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const repoRoot=git(['rev-parse','--show-toplevel']),relative=path.relative(repoRoot,sourceRoot).split(path.sep).join('/');
 if(git(['rev-parse','HEAD'])!==opts['--source-commit']||git(['status','--porcelain','--untracked-files=normal','--',relative||'.']))S.fail('PATCH_SOURCE_INVALID','Yalnız onaylanan temiz kaynak commitinden yama üretilebilir.','A patch can only be built from the approved clean source commit.');
 const previousManifest=opts['--previous']?F.readJsonStrict(opts['--previous']):null,acceptedBefore=historyFrom(previousManifest,baseRoot,sequence);
 const pem=process.env.BUYER_LOG_RELEASE_SIGNING_KEY;
 if(!pem)S.fail('PATCH_SIGNING_KEY_REQUIRED','Yayıncı imza anahtarı gerekli.','A publisher signing key is required.');
 const result=buildPatch({baseRoot,sourceRoot,out:opts['--out'],sequence,sourceCommit:opts['--source-commit'],releaseNotes:F.readJsonStrict(opts['--notes']),acceptedBefore,previousManifest,privateKey:pem});
 console.log(JSON.stringify({archive:result.archiveFile,manifest:result.manifestFile,sequence,sourceCommit:result.manifest.sourceCommit,sha256:result.manifest.artifact.sha256}));return result;
}
if(require.main===module){try{main();}catch(error){console.error(`[${error.code||'PATCH_BUILD_FAILED'}] ${error.message}`);process.exitCode=1;}}
module.exports={buildPatch,historyFrom,main};
