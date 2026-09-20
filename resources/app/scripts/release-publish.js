'use strict';
const fs=require('fs');
const path=require('path');
const C=require('./release-common');

function args(argv){const out={channel:'test',bump:'',source:'',notes:'',buildOnly:false,allowDirty:false};for(let i=0;i<argv.length;i+=1){const a=argv[i];if(a==='--channel')out.channel=String(argv[++i]||'');else if(a==='--bump')out.bump=String(argv[++i]||'');else if(a==='--patch')out.bump='patch';else if(a==='--minor')out.bump='minor';else if(a==='--major')out.bump='major';else if(a==='--source')out.source=String(argv[++i]||'');else if(a==='--notes')out.notes=String(argv[++i]||'');else if(a==='--build-only')out.buildOnly=true;else if(a==='--allow-dirty')out.allowDirty=true;else C.fail('Bilinmeyen argüman: '+a,'RELEASE_ARG_INVALID');}return out;}
async function main(){
  const opt=args(process.argv.slice(2));if(opt.channel!=='test')C.fail('Yeni build yalnız TEST kanalına publish edilir. STABLE için release:promote kullanın.','RELEASE_CHANNEL_POLICY');
  if(!opt.allowDirty)C.assertGitClean();
  let pkg=C.readPackage(),version=pkg.version,pending=C.readJson(C.PENDING_FILE,null);
  if(opt.bump){
    if(!['patch','minor','major'].includes(opt.bump))C.fail('Bump türü patch/minor/major olmalı.','RELEASE_BUMP_INVALID');
    if(pending&&pending.version===pkg.version&&pending.bump===opt.bump){version=pkg.version;}
    else {version=C.nextVersion(opt.bump);C.writePackageVersion(version);C.atomicWriteJson(C.PENDING_FILE,{schemaVersion:1,version,bump:opt.bump,createdAt:new Date().toISOString()});}
  } else if(pending&&pending.version!==pkg.version){C.fail('Bekleyen release state package version ile eşleşmiyor.','RELEASE_PENDING_MISMATCH');}
  C.runSmokeTests();
  const built=await C.buildArtifact(version,opt.notes);
  console.log(`Build OK: ${built.artifactName} · ${built.sha256}`);
  if(opt.buildOnly){console.log('Build-only: publish yapılmadı.');return;}
  const source=C.releaseSource(opt.source);if(!source)C.fail('Release source yapılandırılmamış. --source veya BUYER_LOG_RELEASE_SOURCE kullanın.','RELEASE_SOURCE_REQUIRED');
  const published=await C.publishManifest(source,'test',built);
  if(fs.existsSync(C.PENDING_FILE))fs.rmSync(C.PENDING_FILE,{force:true});
  console.log(`TEST publish OK: ${published.manifest.version}`);console.log(`Source: ${path.resolve(source)}`);
}
if(require.main===module)main().catch(error=>{console.error(`[${error.code||'RELEASE_FAILED'}] ${error.message}`);process.exitCode=1;});
module.exports={args,main};
